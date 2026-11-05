import * as THREE from 'three';
import { Component } from '@/entities/Component';
import { RAPIER } from '@/physics/PhysicsWorld';
import { RigidBodyComponent } from '@/physics/RigidBodyComponent';

const GRAVITY = 22;
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();

/**
 * Moves an NPC's capsule like the player's: Rapier's character controller
 * against the world, gravity, steps and slopes. A brain sets `desired`
 * (horizontal m/s) and `targetYaw`; the body accelerates and turns toward
 * them. No navmesh: brains steer with `clearDirection` around what's in the way.
 */
export class NpcBody extends Component {
  /** After brains (103) and Combatant (105). */
  order = 106;
  readonly desired = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw: number;
  targetYaw: number;
  /** rad/s */
  turnRate = 8;
  accel = 14;
  grounded = false;
  /** Set when dead: no more moving, and the capsule stops blocking. */
  limp = false;
  private vy = 0;
  private rb!: RigidBodyComponent;
  private collider!: RAPIER.Collider;
  private kcc!: RAPIER.KinematicCharacterController;

  constructor(facing = 0) {
    super();
    this.yaw = this.targetYaw = facing;
  }

  onAttach(): void {
    this.rb = this.entity.require(RigidBodyComponent);
    this.collider = this.rb.colliders[0];
    const kcc = this.game.physics.world.createCharacterController(0.02);
    kcc.setUp({ x: 0, y: 1, z: 0 });
    kcc.setMaxSlopeClimbAngle((46 * Math.PI) / 180);
    kcc.enableAutostep(0.35, 0.2, false);
    kcc.enableSnapToGround(0.3);
    kcc.setSlideEnabled(true);
    kcc.setApplyImpulsesToDynamicBodies(true);
    this.kcc = kcc;
  }

  onDetach(): void {
    this.game.physics.world.removeCharacterController(this.kcc);
  }

  get position(): THREE.Vector3 {
    const t = this.rb.body.translation();
    return _p.set(t.x, t.y, t.z);
  }

  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  /** Face a point (yaw only). */
  faceTowards(x: number, z: number): void {
    const p = this.position;
    if (Math.hypot(x - p.x, z - p.z) > 0.05) this.targetYaw = Math.atan2(x - p.x, z - p.z);
  }

  /**
   * A direction close to `dir` (flat, normalised) that isn't blocked within
   * `look` metres at knee and chest height, trying wider angles both ways.
   * `ignore` (the target) never counts as blocking.
   */
  clearDirection(dir: THREE.Vector3, look = 1.3, ignore?: RAPIER.RigidBody): THREE.Vector3 {
    const world = this.game.physics.world;
    const p = this.position;
    const blocked = (d: THREE.Vector3) =>
      [0.45, 1.2].some((h) => {
        const ray = new RAPIER.Ray({ x: p.x, y: p.y + h, z: p.z }, d);
        const hit = world.castRay(ray, look, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, this.rb.body, (c) => c.parent() !== ignore);
        return !!hit;
      });
    if (!blocked(dir)) return dir;
    for (const a of [0.6, -0.6, 1.2, -1.2, 1.8, -1.8]) {
      _d.copy(dir).applyAxisAngle(THREE.Object3D.DEFAULT_UP, a);
      if (!blocked(_d)) return dir.copy(_d);
    }
    return dir;
  }

  fixedUpdate(dt: number): void {
    if (this.limp) return;
    // Turn.
    let dy = this.targetYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += THREE.MathUtils.clamp(dy, -this.turnRate * dt, this.turnRate * dt);
    // Accelerate toward the wanted velocity.
    const k = Math.min(1, this.accel * dt);
    this.velocity.x += (this.desired.x - this.velocity.x) * k;
    this.velocity.z += (this.desired.z - this.velocity.z) * k;
    this.vy = this.grounded ? -1 : this.vy - GRAVITY * dt;
    _d.set(this.velocity.x * dt, this.vy * dt, this.velocity.z * dt);
    this.kcc.computeColliderMovement(this.collider, _d, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    const m = this.kcc.computedMovement();
    this.grounded = this.kcc.computedGrounded();
    const t = this.rb.body.translation();
    const next = { x: t.x + m.x, y: t.y + m.y, z: t.z + m.z };
    this.rb.body.setTranslation(next, true);
    this.rb.body.setNextKinematicTranslation(next);
    const q = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw);
    this.rb.body.setRotation(q, true);
    this.rb.body.setNextKinematicRotation(q);
    this.game.physics.world.propagateModifiedBodyPositionsToColliders();
    // What actually happened (walls stop you).
    if (dt > 0) {
      this.velocity.x = m.x / dt;
      this.velocity.z = m.z / dt;
    }
  }

  /** Go limp (dead): stop, and let people walk over the body. */
  setLimp(on: boolean): void {
    this.limp = on;
    this.desired.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.collider.setSensor(on);
  }

  teleport(pos: THREE.Vector3, yaw: number): void {
    this.yaw = this.targetYaw = yaw;
    this.rb.teleport(pos, new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw));
    this.vy = 0;
    this.velocity.set(0, 0, 0);
  }
}
