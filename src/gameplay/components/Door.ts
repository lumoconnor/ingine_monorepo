import * as THREE from 'three';
import { Component } from '@/entities/Component';
import { RAPIER } from '@/physics/PhysicsWorld';
import { RigidBodyComponent } from '@/physics/RigidBodyComponent';
import { PLATFORM_GROUPS } from '@/physics/groups';
import { movesIntoPlayer } from '@/physics/queries';
import type { Activatable } from './Activatable';

export type DoorKind = 'swing' | 'slide';

export interface DoorOptions {
  kind: DoorKind;
  width: number;
  height: number;
  thickness: number;
  /** Seconds to fully open or close. */
  duration?: number;
  /** Swing doors: how far they open, in degrees. */
  swingDeg?: number;
  /** Slide doors: where the door goes when open, in the door's local frame (metres). */
  slide?: THREE.Vector3;
}

const smooth = (x: number) => x * x * (3 - 2 * x);
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * A door driven by a kinematic body. The entity's transform is the closed
 * pose: for swing doors the origin is the hinge (bottom of the hinge edge, the
 * door extends along local +X); for sliding doors it's the bottom centre.
 *
 * Doors live on the platform collision layer, so the player controller treats
 * them exactly like moving platforms: it slides along them and gets pushed
 * if one moves into it. On top of that a door never moves into the player:
 * if its next pose would overlap the player it waits.
 */
export class Door extends Component implements Activatable {
  /** Same slot as moving platforms: before the player, so it sees the new pose. */
  order = -100;
  /** 0 = closed, 1 = open. */
  openness = 0;
  target = 0;
  /** Swing direction: +1 opens toward local -Z, -1 toward +Z. */
  swingSign = 1;
  /** True on a step where the door wanted to move but the player was in the way. */
  blocked = false;

  private rb!: RigidBodyComponent;
  private closedPos = new THREE.Vector3();
  private closedRot = new THREE.Quaternion();
  private localCenter: THREE.Vector3;
  private probe: RAPIER.Cuboid;
  private pos = new THREE.Vector3();
  private rot = new THREE.Quaternion();
  private curPos = new THREE.Vector3();
  private curRot = new THREE.Quaternion();
  private curCenter = new THREE.Vector3();

  constructor(readonly opts: DoorOptions) {
    super();
    const { kind, width: w, height: h, thickness: t } = opts;
    this.localCenter = kind === 'swing' ? new THREE.Vector3(w / 2, h / 2, 0) : new THREE.Vector3(0, h / 2, 0);
    this.probe = new RAPIER.Cuboid(w / 2, h / 2, t / 2);
  }

  /** The collider a door entity should be built with (matches the probe and pivot). */
  static colliderDesc(o: Pick<DoorOptions, 'kind' | 'width' | 'height' | 'thickness'>): RAPIER.ColliderDesc {
    const d = RAPIER.ColliderDesc.cuboid(o.width / 2, o.height / 2, o.thickness / 2).setFriction(0.3);
    return o.kind === 'swing' ? d.setTranslation(o.width / 2, o.height / 2, 0) : d.setTranslation(0, o.height / 2, 0);
  }

  get isOn(): boolean {
    return this.target === 1;
  }
  get busy(): boolean {
    return this.openness !== this.target;
  }

  onAttach(): void {
    this.rb = this.entity.require(RigidBodyComponent);
    for (const col of this.rb.colliders) col.setCollisionGroups(PLATFORM_GROUPS);
    this.closedPos.copy(this.entity.object3d.position);
    this.closedRot.copy(this.entity.object3d.quaternion);
  }

  activate(command: 'toggle' | 'on' | 'off' = 'toggle', user?: { object3d: { position: { x: number; y: number; z: number } } }): void {
    const open = command === 'toggle' ? this.target === 0 : command === 'on';
    if (open && this.openness === 0 && user) {
      // Swing away from whoever is opening it.
      _v.copy(user.object3d.position as THREE.Vector3).sub(this.closedPos).applyQuaternion(_q.copy(this.closedRot).invert());
      this.swingSign = _v.z >= 0 ? 1 : -1;
    }
    this.target = open ? 1 : 0;
  }

  fixedUpdate(dt: number): void {
    this.blocked = false;
    if (this.openness === this.target) return;
    const step = dt / (this.opts.duration ?? 0.9);
    const next = this.target > this.openness ? Math.min(this.target, this.openness + step) : Math.max(this.target, this.openness - step);
    this.poseAt(next, this.pos, this.rot);
    this.poseAt(this.openness, this.curPos, this.curRot);

    _v.copy(this.localCenter).applyQuaternion(this.rot).add(this.pos);
    this.curCenter.copy(this.localCenter).applyQuaternion(this.curRot).add(this.curPos);
    if (movesIntoPlayer(this.game, this.probe, this.curCenter, this.curRot, _v, this.rot)) {
      this.blocked = true;
      return;
    }
    this.openness = next;
    this.rb.body.setNextKinematicTranslation(this.pos);
    this.rb.body.setNextKinematicRotation(this.rot);
  }

  /** Save hook (see SaveSystem): open/closed and which way it swung. */
  saveState(): { open: boolean; swing: number } {
    return { open: this.target === 1, swing: this.swingSign };
  }

  loadState(s: { open?: boolean; swing?: number }): void {
    this.target = this.openness = s.open ? 1 : 0;
    this.swingSign = s.swing === -1 ? -1 : 1;
    this.poseAt(this.openness, this.pos, this.rot);
    this.rb.teleport(this.pos, this.rot);
  }

  private poseAt(openness: number, outPos: THREE.Vector3, outRot: THREE.Quaternion): void {
    const e = smooth(openness);
    if (this.opts.kind === 'swing') {
      outPos.copy(this.closedPos);
      const angle = THREE.MathUtils.degToRad(this.opts.swingDeg ?? 100) * e * this.swingSign;
      outRot.copy(this.closedRot).multiply(_q.setFromAxisAngle(_up, angle));
    } else {
      const slide = this.opts.slide ?? new THREE.Vector3(this.opts.width, 0, 0);
      outPos.copy(slide).multiplyScalar(e).applyQuaternion(this.closedRot).add(this.closedPos);
      outRot.copy(this.closedRot);
    }
  }
}
