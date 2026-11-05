import * as THREE from 'three';
import { Component } from '../../entities/Component';
import { RigidBodyComponent } from '../../physics/RigidBodyComponent';
import { movesIntoPlayer } from '../../physics/queries';
import type { MotionFn } from './MovingPlatform';
import type { Activatable } from './Activatable';

const smooth = (x: number) => x * x * (3 - 2 * x);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/**
 * A platform that travels between two stops only when told to (by switches).
 * Pair it with a MovingPlatform using `lift.motion` so riding, carrying and
 * collision all work exactly like the automatic platforms.
 *
 * It won't descend onto the player: if the way down is blocked, it waits.
 */
export class Lift extends Component implements Activatable {
  /** Before MovingPlatform (-100), which reads `progress` through `motion`. */
  order = -110;
  /** 0 = at stop A, 1 = at stop B. */
  progress = 0;
  target: 0 | 1 = 0;
  blocked = false;
  /** Seconds to wait after a call before setting off (time to step on). */
  departDelay = 0.35;

  private rb!: RigidBodyComponent;
  private duration: number;
  private wait = 0;

  constructor(readonly a: THREE.Vector3, readonly b: THREE.Vector3, speed: number) {
    super();
    this.duration = a.distanceTo(b) / speed;
  }

  readonly motion: MotionFn = (_t, outPos, outRot) => {
    this.positionAt(this.progress, outPos);
    outRot.identity();
  };

  get isOn(): boolean {
    return this.target === 1;
  }
  get busy(): boolean {
    return this.progress !== this.target;
  }
  /** Which stop it's resting at, or null while travelling. */
  get stop(): 0 | 1 | null {
    return this.progress === 0 ? 0 : this.progress === 1 ? 1 : null;
  }

  onAttach(): void {
    this.rb = this.entity.require(RigidBodyComponent);
  }

  activate(command: 'toggle' | 'on' | 'off' = 'toggle'): void {
    this.call(command === 'toggle' ? (this.target === 1 ? 0 : 1) : command === 'on' ? 1 : 0);
  }

  /** Send the lift to stop 0 (A) or 1 (B). */
  call(stop: 0 | 1): void {
    if (stop === this.target) return;
    if (!this.busy) this.wait = this.departDelay;
    this.target = stop;
  }

  fixedUpdate(dt: number): void {
    this.blocked = false;
    if (!this.busy) return;
    if (this.wait > 0) {
      this.wait -= dt;
      return;
    }
    const step = dt / this.duration;
    const next = this.target > this.progress ? Math.min(1, this.progress + step) : Math.max(0, this.progress - step);
    this.positionAt(this.progress, _a);
    this.positionAt(next, _b);
    if (_b.y < _a.y - 1e-6) {
      // Going down: make sure nobody is underneath.
      const deck = this.rb.colliders[0];
      const r = deck.rotation();
      const t = deck.translation();
      _b.sub(_a).add(t as THREE.Vector3);
      if (movesIntoPlayer(this.game, deck.shape, t, r, _b, r)) {
        this.blocked = true;
        return;
      }
    }
    this.progress = next;
  }

  /** Save hook (see SaveSystem): which stop it's at (or heading to). */
  saveState(): { stop: 0 | 1 } {
    return { stop: this.target };
  }

  loadState(s: { stop?: number }): void {
    this.target = s.stop === 1 ? 1 : 0;
    this.progress = this.target;
    this.wait = 0;
  }

  private positionAt(p: number, out: THREE.Vector3): THREE.Vector3 {
    return out.lerpVectors(this.a, this.b, smooth(p));
  }
}
