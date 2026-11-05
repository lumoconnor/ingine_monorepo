import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { System } from '../core/System';
import type { Entity } from '../entities/Entity';
import { RAPIER } from '../physics/PhysicsWorld';
import { HURTBOX_QUERY } from '../physics/groups';
import { Damageable } from './Damageable';
import type { DamagePacket, Hit, HitResult } from './types';
import type { DeliveryDef, PayloadDef } from './weaponTypes';
import { runAll } from '../dialogue/registry';

/** Small seeded PRNG (mulberry32): same seed, same fight. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TraceOptions {
  /** Body to ignore (the attacker's own). */
  exclude?: RAPIER.RigidBody;
  /** 0 = a thin ray (hitscan); > 0 = a ball swept along the line (melee). */
  radius?: number;
  /** Targets already struck by this swing: passed through without effect. */
  skip?: Set<Damageable>;
}

/** What a trace found first along its line. */
export interface TraceHit {
  /** Distance along the line, metres. */
  distance: number;
  point: THREE.Vector3;
  collider: RAPIER.Collider;
  entity: Entity | undefined;
  /** Set when it struck something that can be hurt. */
  target: Damageable | null;
  zone: string | null;
}

export interface AttackSpec {
  attacker: Entity | null;
  source: string;
  packets: DamagePacket[];
  /** Push given to loose physics objects that are struck (N·s). */
  impulse?: number;
  /** For onHit effects and statuses. */
  payload?: PayloadDef;
  /** Delivery kind (sweep, hitscan...), copied onto each hit. */
  delivery?: string;
}

/** Everything a delivery needs to send one attack. */
export interface DeliverySpec {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  spreadDeg: number;
  /** 0..1 charge (bow draw, throw strength). */
  charge: number;
  /** Seconds a fuse has already burned (cooked grenade). */
  cooked: number;
  attack: AttackSpec;
  exclude?: RAPIER.RigidBody;
  /** The weapon item and the ammo it fired (projectiles look like their ammo; arrows can be recovered). */
  item?: string | null;
  ammo?: string | null;
}

const _dir = new THREE.Vector3();
const _p = new THREE.Vector3();
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const _up = new THREE.Vector3();
const _u = new THREE.Vector3();
const _v = new THREE.Vector3();
const _shot = new THREE.Vector3();

type DeliveryRunner = (combat: CombatSystem, d: DeliveryDef, s: DeliverySpec) => void;

/** How each delivery kind runs. Its parameters are declared in blocks.ts. */
export const Deliveries: Record<string, DeliveryRunner> = {
  hitscan: (combat, d, s) => {
    const pellets = Math.max(1, d.pellets ?? 1);
    for (let i = 0; i < pellets; i++) {
      combat.spreadDir(s.dir, s.spreadDeg, _shot);
      combat.strike(s.origin, _shot, d.range ?? 100, { ...s.attack, impulse: (s.attack.impulse ?? 0) / pellets }, { exclude: s.exclude });
    }
  },
};

export function registerDeliveryRunner(kind: string, run: DeliveryRunner): void {
  Deliveries[kind] = run;
}

/**
 * Owns combat's shared machinery: the seeded RNG, and the traces every
 * delivery uses to find what an attack touched. Hurtboxes are sensors on
 * their own layer, so traces do two passes: hit zones, then solid geometry,
 * and a zone only counts if nothing solid is in front of it.
 */
export class CombatSystem implements System {
  readonly name = 'combat';
  game!: Game;
  rng: () => number;
  private projectiles: import('./projectiles').Projectile[] = [];
  private blasts: { mesh: THREE.Mesh; light: THREE.PointLight; age: number; radius: number }[] = [];

  constructor(seed = 1) {
    this.rng = mulberry32(seed);
  }

  init(game: Game): void {
    this.game = game;
    game.events.on('combat:explosion', ({ point, radius }) => this.showBlast(point, radius));
    game.events.on('level:loaded', () => this.clearProjectiles());
    game.events.on('game:loaded', () => this.clearProjectiles());
  }

  addProjectile(p: import('./projectiles').Projectile): void {
    this.projectiles.push(p);
    this.game.renderer.scene.add(p.mesh);
  }

  /** Projectiles in flight (tests, debugging). */
  get inFlight(): readonly import('./projectiles').Projectile[] {
    return this.projectiles;
  }

  clearProjectiles(): void {
    for (const p of this.projectiles) p.mesh.removeFromParent();
    this.projectiles = [];
  }

  /** After the physics step: move everything in flight. */
  postFixedUpdate(dt: number): void {
    if (!this.projectiles.length) return;
    for (const p of this.projectiles) p.step(dt);
    this.projectiles = this.projectiles.filter((p) => {
      if (p.done) p.mesh.removeFromParent();
      return !p.done;
    });
  }

  private showBlast(point: { x: number; y: number; z: number }, radius: number): void {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    mesh.position.set(point.x, point.y, point.z);
    const light = new THREE.PointLight(0xffa040, 60, radius * 4, 2);
    light.position.copy(mesh.position);
    this.game.renderer.scene.add(mesh, light);
    this.blasts.push({ mesh, light, age: 0, radius });
  }

  update(time: import('../core/Time').FrameTime): void {
    const dt = Math.min(time.delta, 0.1);
    this.blasts = this.blasts.filter((b) => {
      b.age += dt;
      const t = b.age / 0.45;
      b.mesh.scale.setScalar(0.3 + b.radius * 0.5 * Math.min(1, t * 1.6));
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.85 * (1 - t));
      b.light.intensity = Math.max(0, 60 * (1 - t * 1.5));
      if (t < 1) return true;
      b.mesh.removeFromParent();
      b.light.removeFromParent();
      b.mesh.geometry.dispose();
      (b.mesh.material as THREE.Material).dispose();
      return false;
    });
  }

  reseed(seed: number): void {
    this.rng = mulberry32(seed);
  }

  /** First thing along origin + dir * range, preferring hit zones over the solid body they sit in. */
  trace(origin: THREE.Vector3, dir: THREE.Vector3, range: number, opts: TraceOptions = {}): TraceHit | null {
    const world = this.game.physics.world;
    const d = _dir.copy(dir).normalize();
    const r = opts.radius ?? 0;
    const cast = (flags: number, groups: number | undefined, pred?: (c: RAPIER.Collider) => boolean) => {
      if (r <= 0) {
        const ray = new RAPIER.Ray(origin, d);
        const h = world.castRay(ray, range, true, flags, groups, undefined, opts.exclude, pred);
        return h ? { collider: h.collider, distance: h.timeOfImpact } : null;
      }
      const h = world.castShape(origin, IDENTITY, { x: d.x * range, y: d.y * range, z: d.z * range }, new RAPIER.Ball(r), 0, 1, true, flags, groups, undefined, opts.exclude, pred);
      return h ? { collider: h.collider, distance: h.time_of_impact * range } : null;
    };
    // Colliders with default groups match every group query, so also insist on a real hurtbox.
    const isHurtbox = (c: RAPIER.Collider) => this.game.physics.ownerOf(c)?.get(Damageable)?.zoneOf(c) != null;
    const zoneHit = cast(RAPIER.QueryFilterFlags.EXCLUDE_SOLIDS, HURTBOX_QUERY, isHurtbox);
    const solid = cast(RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined);
    const owner = (c: RAPIER.Collider) => this.game.physics.ownerOf(c);
    const make = (h: { collider: RAPIER.Collider; distance: number }, zone: boolean): TraceHit => {
      const entity = owner(h.collider);
      const target = entity?.get(Damageable) ?? null;
      const point = new THREE.Vector3().copy(origin).addScaledVector(d, h.distance);
      return {
        distance: h.distance,
        point,
        collider: h.collider,
        entity,
        target,
        // Struck the solid body: zone by height (capsule bodies), or torso for something with hurtboxes.
        zone: zone && target ? target.zoneOf(h.collider) : (target?.solidZone(point) ?? null),
      };
    };
    if (zoneHit) {
      const zoneOwner = owner(zoneHit.collider);
      // The solid body a zone belongs to doesn't block it; anything else in front does.
      if (!solid || solid.distance >= zoneHit.distance - 0.02 || owner(solid.collider) === zoneOwner) return make(zoneHit, true);
    }
    return solid ? make(solid, false) : null;
  }

  /**
   * Trace and apply an attack: damages a Damageable, pushes loose objects,
   * and reports an impact on anything else. Returns the hit result, if any.
   */
  strike(origin: THREE.Vector3, dir: THREE.Vector3, range: number, spec: AttackSpec, opts: TraceOptions = {}): { trace: TraceHit | null; result: HitResult | null } {
    const t = this.trace(origin, dir, range, opts);
    if (!t) return { trace: null, result: null };
    if (t.target && opts.skip?.has(t.target)) return { trace: t, result: null };
    const direction = _p.copy(dir).normalize().clone();
    const body = t.collider.parent();
    if (spec.impulse && body && body.isDynamic()) {
      body.applyImpulseAtPoint({ x: direction.x * spec.impulse, y: direction.y * spec.impulse, z: direction.z * spec.impulse }, t.point, true);
    }
    if (t.target && !t.target.dead) {
      const hit: Hit = { attacker: spec.attacker, packets: spec.packets, zone: t.zone, source: spec.source, point: t.point, direction, delivery: spec.delivery, status: spec.payload?.status };
      const result = t.target.applyHit(hit);
      if (spec.payload?.onHit && spec.attacker?.name === 'player') runAll({ game: this.game, tree: 'combat' }, spec.payload.onHit);
      return { trace: t, result };
    }
    this.game.events.emit('combat:impact', { source: spec.source, point: { x: t.point.x, y: t.point.y, z: t.point.z } });
    return { trace: t, result: null };
  }

  /**
   * Random direction within a cone of `deg` half-angle around `dir`. The
   * angle off centre is uniform, so shots cluster toward the middle (half
   * land within half the cone) while never leaving it.
   */
  spreadDir(dir: THREE.Vector3, deg: number, out: THREE.Vector3): THREE.Vector3 {
    out.copy(dir).normalize();
    if (deg <= 0) return out;
    const off = this.rng() * deg * (Math.PI / 180);
    const cos = Math.cos(off);
    const sin = Math.sin(off);
    const phi = this.rng() * Math.PI * 2;
    const a = Math.abs(out.y) < 0.99 ? _up.set(0, 1, 0) : _up.set(1, 0, 0);
    const u = _u.crossVectors(out, a).normalize();
    const v = _v.crossVectors(out, u);
    return out.multiplyScalar(cos).addScaledVector(u, sin * Math.cos(phi)).addScaledVector(v, sin * Math.sin(phi));
  }

  /** Send an attack with a delivery block (see the runners: hitscan here, projectile and area in projectiles.ts). */
  deliver(d: DeliveryDef, s: DeliverySpec): void {
    const run = Deliveries[d.kind];
    if (!run) throw new Error(`No runner for delivery "${d.kind}"`);
    s.attack.delivery ??= d.kind;
    run(this, d, s);
  }

  /** Damage an entity directly (falls, hazards, effects). */
  damage(target: Entity, hit: Hit): HitResult | null {
    return target.get(Damageable)?.applyHit(hit) ?? null;
  }
}
