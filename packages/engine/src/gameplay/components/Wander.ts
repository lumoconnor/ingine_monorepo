import * as THREE from 'three';
import { Component } from '../../entities/Component';
import { RigidBodyComponent } from '../../physics/RigidBodyComponent';
import { mulberry32 } from '../../procgen/random';
import { Npc } from './Npc';
import { PlayerController } from '../player/PlayerController';

export interface WanderOptions {
  /** A loop of (x, z) points to walk around, clear of obstacles. */
  path: [number, number][];
  /** Path indices where they stop for a while (a door, the well, a stall). */
  stops?: number[];
  /** Ground height under a point. */
  groundAt: (x: number, z: number) => number;
  /** Walking speed, m/s. Default 1.1. */
  speed?: number;
  /** Seconds spent at each stop: [min, max]. Default [3, 9]. */
  pause?: [number, number];
  /** Where on the loop to start (0..1). */
  startAt?: number;
  seed?: number;
}

/** Doesn't walk into the player; stops this far from them. */
const PERSONAL_SPACE = 1.1;
/** Beyond this distance from the player, wanderers stand still (and cost nothing). */
const SLEEP_RANGE = 160;

const _p = new THREE.Vector3();

/**
 * Walks an NPC around a fixed loop, pausing at stops. Drives the NPC's
 * kinematic body and turns it to face where it's going. Stops while talking
 * and when the player stands in the way.
 */
export class Wander extends Component {
  /** Which segment of the path they're on (from point i to i+1). */
  segment = 0;
  /** Metres along the current segment. */
  along = 0;
  /** Seconds left at the current stop. */
  waiting = 0;
  /** Total metres walked (tests). */
  walked = 0;

  private rb!: RigidBodyComponent;
  private npc?: Npc;
  private rand: () => number;
  private stops: Set<number>;
  private lengths: number[];

  constructor(private o: WanderOptions) {
    super();
    this.rand = mulberry32(o.seed ?? 1);
    this.stops = new Set(o.stops ?? []);
    const p = o.path;
    this.lengths = p.map((a, i) => {
      const b = p[(i + 1) % p.length];
      return Math.hypot(b[0] - a[0], b[1] - a[1]);
    });
    // Start somewhere along the loop.
    const total = this.lengths.reduce((s, l) => s + l, 0);
    let t = (o.startAt ?? 0) * total;
    for (let i = 0; i < p.length; i++) {
      if (t <= this.lengths[i]) {
        this.segment = i;
        this.along = t;
        break;
      }
      t -= this.lengths[i];
    }
  }

  onAttach(): void {
    this.rb = this.entity.get(RigidBodyComponent)!;
    this.npc = this.entity.get(Npc);
    // Begin where the loop says, not where the entity was spawned.
    this.position(_p);
    this.entity.object3d.position.copy(_p);
    this.rb.teleport(_p, this.entity.object3d.quaternion);
  }

  /** Where the walker is now, (x, z). */
  position(out: THREE.Vector3): THREE.Vector3 {
    const p = this.o.path;
    const a = p[this.segment];
    const b = p[(this.segment + 1) % p.length];
    const len = this.lengths[this.segment] || 1;
    const t = Math.min(1, this.along / len);
    const x = a[0] + (b[0] - a[0]) * t;
    const z = a[1] + (b[1] - a[1]) * t;
    return out.set(x, this.o.groundAt(x, z), z);
  }

  fixedUpdate(dt: number): void {
    const p = this.o.path;
    if (p.length < 2) return;
    // The physics position, not the (interpolated) mesh: right even when frames aren't drawn.
    const pp = this.game.world.find('player')?.get(PlayerController)?.feetPosition;
    const me = this.rb.body.translation();
    if (pp && Math.hypot(pp.x - me.x, pp.z - me.z) > SLEEP_RANGE) return;
    if (this.npc?.talking) return;
    if (this.waiting > 0) {
      this.waiting -= dt;
      return;
    }

    const speed = this.o.speed ?? 1.1;
    let along = this.along + speed * dt;
    let seg = this.segment;
    let arrivedAt = -1;
    if (along >= this.lengths[seg]) {
      along -= this.lengths[seg];
      seg = (seg + 1) % p.length;
      arrivedAt = seg;
    }
    const a = p[seg];
    const b = p[(seg + 1) % p.length];
    const len = this.lengths[seg] || 1;
    const t = Math.min(1, along / len);
    const x = a[0] + (b[0] - a[0]) * t;
    const z = a[1] + (b[1] - a[1]) * t;

    // Don't walk into the player: wait for them to move.
    if (pp) {
      const dNext = Math.hypot(pp.x - x, pp.z - z);
      const dNow = Math.hypot(pp.x - me.x, pp.z - me.z);
      if (dNext < PERSONAL_SPACE && dNext < dNow && Math.abs(pp.y - me.y) < 2.5) return;
    }

    this.segment = seg;
    this.along = along;
    this.walked += speed * dt;
    this.rb.body.setNextKinematicTranslation(_p.set(x, this.o.groundAt(x, z), z));
    if (len > 0.05) this.npc?.face(Math.atan2(b[0] - a[0], b[1] - a[1]));
    if (arrivedAt >= 0 && this.stops.has(arrivedAt)) {
      const [lo, hi] = this.o.pause ?? [3, 9];
      this.waiting = lo + this.rand() * (hi - lo);
    }
  }
}
