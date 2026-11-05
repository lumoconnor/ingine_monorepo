import * as THREE from 'three';
import { Component } from '@/entities/Component';
import type { FrameTime } from '@/core/Time';
import { RAPIER, type PhysicsStepListener } from './PhysicsWorld';

export type BodyType = 'fixed' | 'dynamic' | 'kinematicPosition' | 'kinematicVelocity';

export interface RigidBodyOptions {
  type: BodyType;
  colliders: RAPIER.ColliderDesc[];
  /** Interpolate the visual between physics steps (default: true unless fixed). */
  interpolate?: boolean;
  /** Enable continuous collision detection for fast objects. */
  ccd?: boolean;
  linearDamping?: number;
  angularDamping?: number;
}

/**
 * Gives an Entity a Rapier rigid body + colliders. The body is created at the
 * entity's current object3d transform. Non-fixed bodies drive the object3d,
 * interpolated between fixed steps so motion is smooth on high-Hz displays.
 */
export class RigidBodyComponent extends Component implements PhysicsStepListener {
  body!: RAPIER.RigidBody;
  colliders: RAPIER.Collider[] = [];

  private prevPos = new THREE.Vector3();
  private currPos = new THREE.Vector3();
  private prevRot = new THREE.Quaternion();
  private currRot = new THREE.Quaternion();
  private interpolate: boolean;

  constructor(private opts: RigidBodyOptions) {
    super();
    this.interpolate = opts.interpolate ?? opts.type !== 'fixed';
  }

  onAttach(): void {
    const physics = this.game.physics;
    const o = this.entity.object3d;
    o.updateMatrixWorld();
    const p = o.position;
    const q = o.quaternion;

    const desc = {
      fixed: () => RAPIER.RigidBodyDesc.fixed(),
      dynamic: () => RAPIER.RigidBodyDesc.dynamic(),
      kinematicPosition: () => RAPIER.RigidBodyDesc.kinematicPositionBased(),
      kinematicVelocity: () => RAPIER.RigidBodyDesc.kinematicVelocityBased(),
    }[this.opts.type]()
      .setTranslation(p.x, p.y, p.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setCcdEnabled(this.opts.ccd ?? false)
      .setLinearDamping(this.opts.linearDamping ?? 0)
      .setAngularDamping(this.opts.angularDamping ?? 0.05);

    this.body = physics.world.createRigidBody(desc);
    for (const cd of this.opts.colliders) {
      const col = physics.world.createCollider(cd, this.body);
      physics.registerCollider(col, this.entity);
      this.colliders.push(col);
    }

    this.currPos.copy(p);
    this.prevPos.copy(p);
    this.currRot.copy(q);
    this.prevRot.copy(q);
    if (this.interpolate) physics.addStepListener(this);
  }

  onDetach(): void {
    const physics = this.game.physics;
    physics.removeStepListener(this);
    for (const c of this.colliders) physics.unregisterCollider(c);
    physics.world.removeRigidBody(this.body);
    this.colliders = [];
  }

  beforePhysicsStep(): void {
    this.prevPos.copy(this.currPos);
    this.prevRot.copy(this.currRot);
  }

  afterPhysicsStep(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.currPos.set(t.x, t.y, t.z);
    this.currRot.set(r.x, r.y, r.z, r.w);
  }

  /**
   * Re-read the body's pose as this step's result. Call after moving a
   * kinematic body directly (outside the physics step) so interpolation
   * ends at the right place.
   */
  syncFromBody(): void {
    this.afterPhysicsStep();
  }

  update(time: FrameTime): void {
    if (!this.interpolate) return;
    const o = this.entity.object3d;
    o.position.lerpVectors(this.prevPos, this.currPos, time.alpha);
    o.quaternion.slerpQuaternions(this.prevRot, this.currRot, time.alpha);
  }

  /** Teleport the body (and its visual) without interpolation smear. */
  teleport(pos: THREE.Vector3, rot?: THREE.Quaternion): void {
    this.body.setTranslation(pos, true);
    if (rot) this.body.setRotation(rot, true);
    if (this.body.isKinematic()) {
      this.body.setNextKinematicTranslation(pos);
      if (rot) this.body.setNextKinematicRotation(rot);
    }
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.prevPos.copy(pos);
    this.currPos.copy(pos);
    if (rot) {
      this.prevRot.copy(rot);
      this.currRot.copy(rot);
    }
  }
}
