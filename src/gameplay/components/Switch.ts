import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Component } from '@/entities/Component';
import type { Entity } from '@/entities/Entity';
import type { FrameTime } from '@/core/Time';
import { Interactable } from '@/gameplay/interaction/Interactable';

export type SwitchState = 'on' | 'off' | 'busy';

export interface SwitchOptions {
  prompt: string | (() => string);
  onUse: (user: Entity) => void;
  /** Drives the visuals: lever position / lamp colour. */
  state: () => SwitchState;
  /** Lever: the handle pivot to tilt. */
  handle?: THREE.Object3D;
  /** Button: the lamp whose colour shows the state, and the cap that dips when pressed. */
  lamp?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  cap?: THREE.Object3D;
  /** Restrict which of the entity's colliders count as the switch. */
  colliders?: () => RAPIER.Collider[];
}

const LAMP = { on: new THREE.Color(0x3ee07a), off: new THREE.Color(0xe0503e), busy: new THREE.Color(0xf2b23a) };
/** Lever handles stick out along +Z; negative X rotation tilts them up (on). */
const LEVER_ANGLE = -0.65;

/**
 * A lever or push button. It owns no logic of its own: `onUse` decides what it
 * does (open a door, call a lift...) and `state` tells it what to display.
 */
export class Switch extends Component {
  private pressAnim = 0;
  private capRest = 0;

  constructor(private opts: SwitchOptions) {
    super();
  }

  onAttach(): void {
    this.entity.add(
      new Interactable({
        prompt: this.opts.prompt,
        colliders: this.opts.colliders,
        onInteract: (user) => {
          this.pressAnim = 1;
          this.opts.onUse(user);
        },
      }),
    );
    if (this.opts.cap) this.capRest = this.opts.cap.position.z;
    if (this.opts.handle) this.opts.handle.rotation.x = this.opts.state() === 'on' ? LEVER_ANGLE : -LEVER_ANGLE;
  }

  update(time: FrameTime): void {
    const state = this.opts.state();
    const k = 1 - Math.exp(-time.delta * 12);
    if (this.opts.handle) {
      const want = state === 'on' ? LEVER_ANGLE : -LEVER_ANGLE;
      this.opts.handle.rotation.x += (want - this.opts.handle.rotation.x) * k;
    }
    if (this.opts.lamp) {
      const c = LAMP[state];
      const m = this.opts.lamp.material;
      m.color.copy(c);
      m.emissive.copy(c);
      m.emissiveIntensity = state === 'busy' ? 0.6 + 0.4 * Math.sin(time.elapsed * 10) : 0.9;
    }
    if (this.opts.cap) {
      this.pressAnim = Math.max(0, this.pressAnim - time.delta * 5);
      this.opts.cap.position.z = this.capRest - 0.025 * Math.sin(this.pressAnim * Math.PI);
    }
  }
}
