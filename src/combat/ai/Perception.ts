import * as THREE from 'three';
import { Component } from '@/entities/Component';
import type { Entity } from '@/entities/Entity';
import { RAPIER } from '@/physics/PhysicsWorld';
import { RigidBodyComponent } from '@/physics/RigidBodyComponent';
import { PlayerController } from '@/gameplay/player/PlayerController';
import { Items } from '@/content/items';
import { Damageable } from '../Damageable';
import { Combatant } from '../Combatant';
import { isHostile } from './factions';

const _eye = new THREE.Vector3();
const _to = new THREE.Vector3();
const _fwd = new THREE.Vector3();

export interface PerceptionOptions {
  /** How far it can see (m) in good conditions, and its field of view (degrees). */
  sight?: number;
  fov?: number;
  /** Multiplies how far it hears noises. */
  hearing?: number;
  /** Allies within this range (m) are told when it spots an enemy. */
  shout?: number;
}

/**
 * What an NPC knows about enemies: sight (a cone, line of sight, and an
 * awareness that builds faster the closer and more visible you are; crouching
 * halves it), hearing (shots and explosions; louder weapons carry further),
 * pain (being hit reveals who did it), and shouts from allies.
 *
 * Brains read `target`, `canSee`, `lastSeen` and `noise`. Awareness:
 * 0 = unaware, rising while it can see you, 1 = it knows (target set).
 */
export class Perception extends Component {
  /** Before brains (103). */
  order = 102;
  target: Entity | null = null;
  awareness = 0;
  canSee = false;
  readonly lastSeen = new THREE.Vector3();
  lastSeenTime = -99;
  /** Something heard and not yet explained: where, and when. */
  noise: THREE.Vector3 | null = null;
  noiseTime = -99;
  /** Seconds since the target was last in sight. */
  get sinceSeen(): number {
    return this.clock - this.lastSeenTime;
  }
  readonly sight: number;
  readonly fov: number;
  private clock = 0;
  private me!: Combatant;
  private unsubs: (() => void)[] = [];
  /** Whoever it can see this tick (may not be aware of them yet). */
  private glimpsed: Entity | null = null;

  constructor(private opts: PerceptionOptions = {}) {
    super();
    this.sight = opts.sight ?? 26;
    this.fov = opts.fov ?? 120;
  }

  onAttach(): void {
    this.me = this.entity.require(Combatant);
    const ev = this.game.events;
    this.unsubs.push(
      ev.on('combat:fired', ({ attacker, item }) => {
        if (!attacker || attacker === this.entity || !this.hostileTo(attacker)) return;
        const def = item ? Items[item]?.weapon : undefined;
        const loud = (def?.noise ?? 30) * (this.opts.hearing ?? 1);
        const p = attacker.object3d.position;
        if (this.dist(p) <= loud) this.hear(p, attacker);
      }),
      ev.on('combat:explosion', ({ point }) => {
        if (this.dist(_to.set(point.x, point.y, point.z)) <= 50 * (this.opts.hearing ?? 1)) this.hear(_to, null);
      }),
      // Pain: whoever hurt it is the enemy now, seen or not.
      ev.on('combat:hit', ({ hit, target }) => {
        if (target !== this.entity || !hit.attacker || hit.attacker === this.entity || this.health?.dead) return;
        if (!this.hostileTo(hit.attacker)) return;
        this.know(hit.attacker, hit.attacker.object3d.position, true);
      }),
      ev.on('ai:alert', ({ from, target, point }) => {
        if (from === this.entity || this.target || this.health?.dead) return;
        const fc = from.get(Combatant);
        if (!fc || fc.faction !== this.me.faction) return;
        if (this.dist(from.object3d.position) > (this.opts.shout ?? 30)) return;
        this.know(target, new THREE.Vector3(point.x, point.y, point.z), false);
      }),
    );
  }

  onDetach(): void {
    this.unsubs.forEach((u) => u());
  }

  private get health(): Damageable | undefined {
    return this.entity.get(Damageable);
  }

  private hostileTo(e: Entity): boolean {
    const c = e.get(Combatant);
    return !!c && isHostile(this.me.faction, c.faction);
  }

  private dist(p: THREE.Vector3): number {
    return this.entity.object3d.position.distanceTo(p);
  }

  private hear(p: THREE.Vector3, who: Entity | null): void {
    if (this.health?.dead) return;
    this.noise = p.clone();
    this.noiseTime = this.clock;
    // A shot nearby is enough to know someone's out there.
    this.awareness = Math.max(this.awareness, 0.6);
    if (who && this.target === who) return;
    if (who && this.dist(p) < 12) this.know(who, p, false);
  }

  /** Becomes fully aware of `who`, last known at `p`. */
  know(who: Entity, p: THREE.Vector3, seen: boolean): void {
    const fresh = this.target !== who;
    this.target = who;
    this.awareness = 1;
    this.lastSeen.copy(p);
    if (seen || fresh) this.lastSeenTime = this.clock;
    if (fresh) this.game.events.emit('ai:alert', { from: this.entity, target: who, point: { x: p.x, y: p.y, z: p.z } });
  }

  /** Where its eyes are. */
  eye(out: THREE.Vector3): THREE.Vector3 {
    const b = this.entity.get(RigidBodyComponent)!.body.translation();
    return out.set(b.x, b.y + 1.6, b.z);
  }

  /** Can it see this point from its eyes (nothing solid in between but `who`)? */
  lineOfSight(to: THREE.Vector3, who?: Entity): boolean {
    this.eye(_eye);
    _to.copy(to).sub(_eye);
    const d = _to.length();
    if (d < 1e-3) return true;
    const ray = new RAPIER.Ray(_eye, _to.normalize());
    const own = this.entity.get(RigidBodyComponent)!.body;
    const hit = this.game.physics.world.castRay(ray, d, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, own);
    if (!hit) return true;
    return !!who && this.game.physics.ownerOf(hit.collider) === who;
  }

  /** The point it looks and aims at on someone: the middle of the chest. */
  static aimPoint(e: Entity, out: THREE.Vector3): THREE.Vector3 {
    const b = e.get(RigidBodyComponent)?.body.translation();
    const p = b ? out.set(b.x, b.y, b.z) : e.object3d.getWorldPosition(out);
    const ctrl = e.get(PlayerController);
    return p.setY(p.y + (ctrl?.crouched ? 0.65 : 1.15));
  }

  fixedUpdate(dt: number): void {
    this.clock += dt;
    if (this.health?.dead) {
      this.target = null;
      this.canSee = false;
      return;
    }
    // Drop a dead target.
    if (this.target && (this.target.get(Damageable)?.dead || !this.target.world)) {
      this.target = null;
      this.awareness = 0.3;
    }
    _fwd.set(0, 0, 1).applyQuaternion(this.entity.object3d.quaternion).setY(0).normalize();
    this.eye(_eye);
    const eye = _eye.clone();
    let best: Entity | null = null;
    let bestD = Infinity;
    for (const e of this.game.world.all()) {
      if (e === this.entity) continue;
      const c = e.get(Combatant);
      if (!c || !isHostile(this.me.faction, c.faction) || e.get(Damageable)?.dead) continue;
      const p = Perception.aimPoint(e, new THREE.Vector3());
      const d = p.distanceTo(eye);
      if (d > this.sight || d >= bestD) continue;
      _to.copy(p).sub(eye).setY(0).normalize();
      // Inside its field of view, or so close it'd feel you there.
      if (d > 2 && _fwd.dot(_to) < Math.cos(((this.fov / 2) * Math.PI) / 180)) continue;
      if (!this.lineOfSight(p, e)) continue;
      best = e;
      bestD = d;
    }
    this.glimpsed = best;
    this.canSee = !!best && (best === this.target || !this.target);
    if (best) {
      const p = Perception.aimPoint(best, new THREE.Vector3());
      if (best === this.target) {
        this.lastSeen.copy(p);
        this.lastSeenTime = this.clock;
      } else if (!this.target) {
        // Noticing takes a moment: quicker up close, slower if you're crouched.
        const crouched = best.get(PlayerController)?.crouched;
        const rate = (1 / (0.15 + bestD / 12)) * (crouched ? 0.45 : 1);
        this.awareness = Math.min(1, this.awareness + rate * dt);
        if (this.awareness >= 1) this.know(best, p, true);
      }
    } else if (!this.target) {
      this.awareness = Math.max(0, this.awareness - 0.12 * dt);
    }
    // Lost them for good.
    if (this.target && this.sinceSeen > 15) {
      this.noise = this.lastSeen.clone();
      this.noiseTime = this.clock;
      this.target = null;
      this.awareness = 0.5;
    }
  }

  get now(): number {
    return this.clock;
  }

  /** Who it can see this tick, aware or not (for "?" over its head). */
  get glimpse(): Entity | null {
    return this.glimpsed;
  }
}
