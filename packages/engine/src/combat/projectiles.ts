import * as THREE from 'three';
import { Entity } from '../entities/Entity';
import { RAPIER } from '../physics/PhysicsWorld';
import { RigidBodyComponent } from '../physics/RigidBodyComponent';
import { INTERACT_ONLY_GROUPS } from '../physics/groups';
import { Interactable } from '../gameplay/interaction/Interactable';
import { Items, itemLabel } from '../inventory/catalog';
import { buildModel, modelDef } from '../render/models/ModelRegistry';
import '../inventory/models';

/** What flies: a flight model (arrows, along +Z) or a held one (a thrown grenade); anything else flies as an arrow. */
function projectileModel(id: string): THREE.Object3D {
  const kind = modelDef(id)?.kind;
  return buildModel(kind === 'flight' || kind === 'held' ? id : 'arrow');
}
import { Damageable } from './Damageable';
import { registerDeliveryRunner, type AttackSpec, type CombatSystem } from './CombatSystem';
import type { DeliveryDef } from './weaponTypes';
import { fuseInterval } from './Combatant';

const G = 9.81;
const _p = new THREE.Vector3();
const _seg = new THREE.Vector3();
const _n = new THREE.Vector3();
const _look = new THREE.Vector3();
const trailGeo = new THREE.BoxGeometry(0.007, 0.007, 1).translate(0, 0, -0.5);
const trailMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false });

/**
 * A thing in flight: arrow, ball, grenade. Simulated on the fixed step with
 * gravity and drag, tested along the segment it covered each step (so fast
 * arrows can't tunnel through a dummy), and on contact it stops, sticks or
 * bounces. A fuse sends its `then` delivery (usually an area) when it burns out.
 */
export class Projectile {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  /** Where it was a step ago, for drawing between steps. */
  readonly prev = new THREE.Vector3();
  age = 0;
  done = false;
  private resting = false;
  readonly mesh: THREE.Object3D;
  private spin = new THREE.Vector3();
  /** A thin streak behind a fast arrow, longer the faster it flies, so the eye can follow it. */
  private trail: THREE.Mesh | null = null;
  private fuseTick = 0;

  constructor(
    private combat: CombatSystem,
    readonly d: DeliveryDef,
    readonly attack: AttackSpec,
    origin: THREE.Vector3,
    velocity: THREE.Vector3,
    /** Seconds the fuse had already burned when it left the hand. */
    private cooked: number,
    private exclude: RAPIER.RigidBody | undefined,
    /** Ammo item it is made of (arrows can be picked back up). */
    readonly ammo: string | null,
    modelName: string,
  ) {
    this.pos.copy(origin);
    this.prev.copy(origin);
    this.vel.copy(velocity);
    this.mesh = projectileModel(modelName);
    this.mesh.position.copy(origin);
    if (d.onImpact !== 'bounce') {
      this.trail = new THREE.Mesh(trailGeo, trailMat);
      this.trail.scale.z = 0.01;
      this.mesh.add(this.trail);
    }
    if (d.onImpact === 'bounce') this.spin.set(combat.rng() * 12 - 6, combat.rng() * 12 - 6, combat.rng() * 12 - 6);
    this.orient();
  }

  /** Draw it part way between its last two steps. */
  render(alpha: number): void {
    if (this.done) return;
    if (this.trail) {
      // Grows out behind it over its first moments (so it never pokes back through the bow).
      const len = Math.min(this.vel.length() * 0.035, this.age * this.vel.length() * 0.8);
      const s = this.mesh.scale.z || 1;
      this.trail.scale.z = Math.max(0.01, len / s);
      this.trail.visible = len > 0.3;
    }
    this.mesh.position.lerpVectors(this.prev, this.pos, alpha);
  }

  private orient(): void {
    if (this.d.onImpact === 'bounce') return;
    if (this.vel.lengthSq() > 1e-6) this.mesh.lookAt(_look.copy(this.pos).add(this.vel));
  }

  step(dt: number): void {
    if (this.done) return;
    const d = this.d;
    this.age += dt;
    this.prev.copy(this.pos);
    if (d.fuse !== undefined && this.age + this.cooked >= d.fuse) return this.detonate();
    if (d.fuse !== undefined) {
      this.fuseTick -= dt;
      if (this.fuseTick <= 0) {
        const left = d.fuse - this.age - this.cooked;
        this.fuseTick = fuseInterval(left);
        this.combat.game.events.emit('combat:fusetick', { point: { x: this.pos.x, y: this.pos.y, z: this.pos.z }, left });
      }
    }
    if (this.resting) return;
    if (this.age > 20) return void (this.done = true);
    this.vel.y -= G * (d.gravity ?? 1) * dt;
    if (d.drag) this.vel.multiplyScalar(Math.max(0, 1 - d.drag * dt));
    _seg.copy(this.vel).multiplyScalar(dt);
    const len = _seg.length();
    // Ignore the thrower for the first moment so it can leave the hand.
    const exclude = this.age < 0.15 ? this.exclude : undefined;
    const t = len > 1e-6 ? this.combat.trace(this.pos, _seg, len, { exclude }) : null;
    if (!t) {
      this.pos.add(_seg);
      this.mesh.position.copy(this.pos);
      this.mesh.rotation.x += this.spin.x * dt;
      this.mesh.rotation.y += this.spin.y * dt;
      this.orient();
      return;
    }
    this.pos.copy(t.point);
    this.mesh.position.copy(this.pos);
    const kind = d.onImpact ?? 'stop';
    if (kind === 'bounce') return this.bounce(t.collider, _seg, len);
    // Arrows and balls hurt what they hit.
    const speed = this.vel.length();
    const dir = this.vel.clone().normalize();
    if (t.target && !t.target.dead) {
      t.target.applyHit({ attacker: this.attack.attacker, packets: this.attack.packets, zone: t.zone, source: this.attack.source, point: t.point.clone(), direction: dir, delivery: 'projectile', status: this.attack.payload?.status });
    } else {
      this.combat.game.events.emit('combat:impact', this.combat.impactOf(t, this.attack.source, 'projectile'));
    }
    const body = t.collider.parent();
    if (this.attack.impulse && body?.isDynamic()) body.applyImpulseAtPoint(dir.multiplyScalar(this.attack.impulse), t.point, true);
    this.done = true;
    if (kind === 'stick') this.stick(t.entity, t.target, speed);
  }

  /** Bounce off with some energy lost; settle once it's slow. */
  private bounce(collider: RAPIER.Collider, seg: THREE.Vector3, len: number): void {
    const world = this.combat.game.physics.world;
    const ray = new RAPIER.Ray(_p.copy(this.pos).addScaledVector(seg, -0.05 / len), seg.clone().normalize());
    const hit = world.castRayAndGetNormal(ray, 0.2, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, undefined, (c) => c.handle === collider.handle);
    _n.set(0, 1, 0);
    if (hit) _n.set(hit.normal.x, hit.normal.y, hit.normal.z);
    const vn = this.vel.dot(_n);
    if (Math.abs(vn) > 0.6) this.combat.game.events.emit('combat:bounce', { point: { x: this.pos.x, y: this.pos.y, z: this.pos.z }, speed: Math.abs(vn) });
    this.vel.addScaledVector(_n, -1.35 * vn).multiplyScalar(0.6);
    this.pos.addScaledVector(_n, 0.03);
    this.spin.multiplyScalar(0.6);
    if (this.vel.length() < 0.8 && _n.y > 0.6) {
      this.resting = true;
      this.vel.set(0, 0, 0);
    }
  }

  private detonate(): void {
    this.done = true;
    if (this.d.then) this.combat.deliver(this.d.then, { origin: this.pos.clone(), dir: new THREE.Vector3(0, 1, 0), spreadDeg: 0, charge: 0, cooked: 0, attack: { ...this.attack, delivery: undefined } });
  }

  /**
   * Arrows stay where they land. In the world they can be pulled out and
   * picked back up (E); in a target they're lost with it.
   */
  private stick(entity: Entity | undefined, target: Damageable | null, speed: number): void {
    const game = this.combat.game;
    const mesh = projectileModel(this.mesh.userData.model);
    // The tip (+Z) sinks in a little, more the faster it flew.
    const dir = this.vel.clone().normalize();
    const depth = Math.min(0.25, 0.05 + speed * 0.003);
    mesh.position.copy(this.pos).addScaledVector(dir, depth);
    mesh.lookAt(_look.copy(mesh.position).add(dir));
    if (target && entity) {
      entity.object3d.attach(mesh);
      return;
    }
    const e = new Entity(`stuck:${this.ammo ?? 'arrow'}`, mesh);
    e.tags.add('stuck-projectile');
    if (this.ammo && Items[this.ammo]) {
      const ammo = this.ammo;
      e.add(new RigidBodyComponent({ type: 'fixed', colliders: [RAPIER.ColliderDesc.ball(0.15).setTranslation(0, 0, -0.25).setCollisionGroups(INTERACT_ONLY_GROUPS)] }));
      e.add(
        new Interactable({
          prompt: `Pull out ${itemLabel(ammo)}`,
          onInteract: () => {
            game.state.addItem(ammo, 1);
            game.events.emit('notify', { text: `Picked up ${itemLabel(ammo)}` });
            game.world.destroy(e);
          },
        }),
      );
    }
    game.world.spawn(e);
  }
}

registerDeliveryRunner('projectile', (combat, d, s) => {
  const pellets = Math.max(1, d.pellets ?? 1);
  const sp = d.speed ?? 30;
  const speed = Array.isArray(sp) ? sp[0] + (sp[1] - sp[0]) * s.charge : sp;
  const ammo = s.ammo ?? null;
  const shot = (ammo && Items[ammo]) || (s.item && Items[s.item]) || null;
  const model = shot?.flightModel ?? shot?.model ?? 'arrow';
  for (let i = 0; i < pellets; i++) {
    const dir = combat.spreadDir(s.dir, s.spreadDeg, new THREE.Vector3());
    // Leaves from just in front of the eye, where the hand holds it: a little
    // right by default, `hand: [right, up]` in metres to move it (a bow's arrow
    // sits left of the grip).
    const right = new THREE.Vector3().crossVectors(dir, THREE.Object3D.DEFAULT_UP).normalize();
    const [hx = 0.12, hy = -0.08] = d.hand ?? [];
    const origin = s.origin.clone().addScaledVector(dir, 0.4).addScaledVector(right, hx).add(new THREE.Vector3(0, hy, 0));
    const p = new Projectile(combat, d, s.attack, origin, dir.multiplyScalar(speed), s.cooked, s.exclude, ammo, model);
    p.mesh.userData.model = model;
    combat.addProjectile(p);
  }
});

/**
 * A blast: everything with health within `radius` takes the payload, scaled
 * down with distance (linear falloff), unless something solid is in the way
 * (lineOfSight). Loose objects are thrown outwards.
 */
registerDeliveryRunner('area', (combat, d, s) => {
  const game = combat.game;
  const center = s.origin;
  const radius = d.radius ?? 5;
  game.events.emit('combat:explosion', { point: { x: center.x, y: center.y, z: center.z }, radius });
  const world = game.physics.world;
  for (const e of game.world.all()) {
    const target = e.get(Damageable);
    if (!target || target.dead) continue;
    const body = e.get(RigidBodyComponent)?.body;
    const t0 = body?.translation();
    // Aim at the middle of a body (about chest height for people and dummies).
    const aimPt = t0 ? _p.set(t0.x, t0.y + 1.0, t0.z) : e.object3d.getWorldPosition(_p).setY(e.object3d.position.y + 1);
    const dist = aimPt.distanceTo(center);
    if (dist > radius) continue;
    if (d.lineOfSight !== false && dist > 0.3) {
      const dir = aimPt.clone().sub(center).normalize();
      const ray = new RAPIER.Ray(center, dir);
      const hit = world.castRay(ray, dist, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
      // Sheltered if the first solid thing isn't the target itself.
      if (hit && game.physics.ownerOf(hit.collider) !== e && hit.timeOfImpact < dist - 0.4) continue;
    }
    const k = d.falloff === 'none' ? 1 : Math.max(0, 1 - dist / radius);
    target.applyHit({
      attacker: s.attack.attacker,
      packets: s.attack.packets.map((p) => ({ type: p.type, amount: p.amount * k })),
      zone: null,
      source: s.attack.source,
      delivery: 'area',
      status: s.attack.payload?.status,
      point: aimPt.clone(),
      direction: aimPt.clone().sub(center).normalize(),
    });
  }
  // Throw loose things.
  const push = s.attack.impulse ?? 0;
  if (push > 0) {
    world.intersectionsWithShape(center, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Ball(radius), (c) => {
      const b = c.parent();
      if (b?.isDynamic()) {
        const t = b.translation();
        const dir = new THREE.Vector3(t.x - center.x, t.y - center.y + 0.5, t.z - center.z);
        const dist = Math.max(0.5, dir.length());
        b.applyImpulse(dir.normalize().multiplyScalar((push * b.mass() * (1 - Math.min(1, dist / radius))) / 4), true);
      }
      return true;
    });
  }
});
