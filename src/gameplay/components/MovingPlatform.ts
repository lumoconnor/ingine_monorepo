import * as THREE from 'three';
import { Component } from '@/entities/Component';
import { RigidBodyComponent } from '@/physics/RigidBodyComponent';
import { PLATFORM_GROUPS } from '@/physics/groups';

/**
 * A motion function: given time in seconds, write the platform's pose.
 * Compose any movement you like (see the helpers below).
 */
export type MotionFn = (t: number, outPos: THREE.Vector3, outRot: THREE.Quaternion) => void;

/**
 * Anything the player can stand on and be carried by. The player controller
 * asks the surface it's standing on for a carry delta every fixed step.
 */
export interface Carrier {
  /** World-space displacement this step for a point resting on the surface. */
  carryDelta(point: THREE.Vector3, out: THREE.Vector3): THREE.Vector3;
  /** Rotation about world Y this step (radians), so riders turn with it. */
  readonly yawDelta: number;
  /** Surface velocity (m/s); inherited when jumping off. */
  readonly velocity: THREE.Vector3;
}

const _rel = new THREE.Vector3();
const _invQ = new THREE.Quaternion();
const _euler = new THREE.Euler();

/**
 * Drives a kinematic rigid body along a MotionFn. Runs before the player
 * (order -100) so the player sees this step's movement and can ride it.
 */
export class MovingPlatform extends Component implements Carrier {
  order = -100;
  time = 0;
  readonly velocity = new THREE.Vector3();
  yawDelta = 0;

  private rb!: RigidBodyComponent;
  private curPos = new THREE.Vector3();
  private curRot = new THREE.Quaternion();
  private nextPos = new THREE.Vector3();
  private nextRot = new THREE.Quaternion();
  private deltaRot = new THREE.Quaternion();

  constructor(private motion: MotionFn, startTime = 0) {
    super();
    this.time = startTime;
  }

  onAttach(): void {
    this.rb = this.entity.require(RigidBodyComponent);
    // Own collision layer: the player's character controller handles platforms
    // separately (see PlayerController).
    for (const col of this.rb.colliders) col.setCollisionGroups(PLATFORM_GROUPS);
    // Place the body at its t=0 pose immediately.
    this.motion(this.time, this.nextPos, this.nextRot);
    this.rb.teleport(this.nextPos, this.nextRot);
  }

  fixedUpdate(dt: number): void {
    const t = this.rb.body.translation();
    const r = this.rb.body.rotation();
    this.curPos.set(t.x, t.y, t.z);
    this.curRot.set(r.x, r.y, r.z, r.w);

    this.time += dt;
    this.motion(this.time, this.nextPos, this.nextRot);

    this.velocity.subVectors(this.nextPos, this.curPos).divideScalar(dt);
    this.deltaRot.multiplyQuaternions(this.nextRot, _invQ.copy(this.curRot).invert());
    _euler.setFromQuaternion(this.deltaRot, 'YXZ');
    this.yawDelta = _euler.y;

    this.rb.body.setNextKinematicTranslation(this.nextPos);
    this.rb.body.setNextKinematicRotation(this.nextRot);
  }

  carryDelta(point: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    _rel.subVectors(point, this.curPos).applyQuaternion(this.deltaRot);
    return out.copy(this.nextPos).add(_rel).sub(point);
  }
}

// ---------------------------------------------------------------------------
// Motion helpers
// ---------------------------------------------------------------------------

const smooth = (x: number) => x * x * (3 - 2 * x);

/**
 * Travel back and forth through waypoints at `speed` m/s, easing in/out of
 * each waypoint and pausing `pause` seconds at the ends. Works in any 3D
 * direction (horizontal, vertical, diagonal).
 */
export function pingPong(
  waypoints: THREE.Vector3[],
  speed: number,
  pause = 0.75,
  rotation = new THREE.Quaternion(),
): MotionFn {
  const pts = [...waypoints, ...waypoints.slice(1, -1).reverse()];
  const segs = pts.map((p, i) => {
    const j = (i + 1) % pts.length;
    // Pause on arriving at either end of the route.
    const arrivesAtEnd = j === 0 || j === waypoints.length - 1;
    return { a: p, b: pts[j], dur: p.distanceTo(pts[j]) / speed, pause: arrivesAtEnd ? pause : 0 };
  });
  const total = segs.reduce((s, g) => s + g.dur + g.pause, 0);
  return (t, outPos, outRot) => {
    let local = ((t % total) + total) % total;
    outRot.copy(rotation);
    for (const s of segs) {
      if (local < s.dur) {
        outPos.lerpVectors(s.a, s.b, smooth(local / s.dur));
        return;
      }
      local -= s.dur;
      if (local < s.pause) {
        outPos.copy(s.b);
        return;
      }
      local -= s.pause;
    }
    outPos.copy(segs[0].a);
  };
}

/** Circle around `center` in the XZ plane, optionally bobbing vertically. */
export function orbit(center: THREE.Vector3, radius: number, period: number, bob = 0): MotionFn {
  return (t, outPos, outRot) => {
    const a = (t / period) * Math.PI * 2;
    outPos.set(center.x + Math.cos(a) * radius, center.y + Math.sin(a * 2) * bob, center.z + Math.sin(a) * radius);
    outRot.identity();
  };
}

/** Spin in place around world Y. */
export function spin(center: THREE.Vector3, radiansPerSecond: number): MotionFn {
  const axis = new THREE.Vector3(0, 1, 0);
  return (t, outPos, outRot) => {
    outPos.copy(center);
    outRot.setFromAxisAngle(axis, t * radiansPerSecond);
  };
}
