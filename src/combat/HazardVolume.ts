import * as THREE from 'three';
import { Component } from '@/entities/Component';
import { RigidBodyComponent } from '@/physics/RigidBodyComponent';
import { Damageable } from './Damageable';
import { checkPackets } from './registry';
import type { DamagePacket, StatusSpec } from './types';

export interface HazardOptions {
  /** What it is, for events and death messages ("fire pit"). */
  source: string;
  /** Damage per second, by type. */
  perSecond: DamagePacket[];
  /** Box, centred on the entity: half extents in metres. Feet inside it count. */
  halfExtents: [number, number, number];
  /** Seconds between damage ticks. */
  interval?: number;
  /** Statuses it gives while you're in it (the fire pit sets you alight). */
  status?: StatusSpec[];
}

const _p = new THREE.Vector3();
const _c = new THREE.Vector3();

/**
 * Hurts every Damageable standing in it, in steady ticks: fire, acid, a
 * cloud of gas. Checks positions directly (no physics sensor), which is cheap
 * for the handful of hazards a scene has.
 */
export class HazardVolume extends Component {
  private timers = new Map<Damageable, number>();
  readonly interval: number;

  constructor(readonly opts: HazardOptions) {
    super();
    checkPackets(`hazard "${opts.source}"`, opts.perSecond);
    this.interval = opts.interval ?? 0.25;
  }

  contains(p: THREE.Vector3): boolean {
    this.entity.object3d.getWorldPosition(_c);
    const [hx, hy, hz] = this.opts.halfExtents;
    return Math.abs(p.x - _c.x) <= hx && Math.abs(p.y - _c.y) <= hy && Math.abs(p.z - _c.z) <= hz;
  }

  fixedUpdate(dt: number): void {
    for (const e of this.game.world.all()) {
      const d = e.get(Damageable);
      if (!d || d.dead || e === this.entity) continue;
      // The body's pose is this step's truth; the visual is interpolated and can lag.
      const t0 = e.get(RigidBodyComponent)?.body?.translation();
      if (t0) _p.set(t0.x, t0.y, t0.z);
      else e.object3d.getWorldPosition(_p);
      if (!this.contains(_p)) {
        this.timers.delete(d);
        continue;
      }
      // First tick lands at once: stepping into fire should hurt immediately.
      let t = (this.timers.get(d) ?? this.interval) + dt;
      while (t >= this.interval && !d.dead) {
        t -= this.interval;
        d.applyHit({
          attacker: null,
          packets: this.opts.perSecond.map((p) => ({ type: p.type, amount: p.amount * this.interval })),
          zone: null,
          source: this.opts.source,
          delivery: 'hazard',
          status: this.opts.status,
        });
      }
      this.timers.set(d, t);
    }
  }
}
