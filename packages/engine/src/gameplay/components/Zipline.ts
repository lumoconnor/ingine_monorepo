import * as THREE from 'three';
import { Component } from '../../entities/Component';

const _ap = new THREE.Vector3();

/**
 * A rope between two anchors that the player can hang from and slide along.
 * Like ladders, it's a movement mode in PlayerController, not physics: the
 * rope only tells the controller where it is.
 */
export class Zipline extends Component {
  static readonly all = new Set<Zipline>();

  readonly a: THREE.Vector3;
  readonly b: THREE.Vector3;
  /** Unit direction from a to b. */
  readonly dir: THREE.Vector3;
  readonly length: number;

  constructor(a: THREE.Vector3, b: THREE.Vector3) {
    super();
    this.a = a.clone();
    this.b = b.clone();
    this.length = a.distanceTo(b);
    this.dir = b.clone().sub(a).normalize();
  }

  onAttach(): void {
    Zipline.all.add(this);
  }
  onDetach(): void {
    Zipline.all.delete(this);
  }

  /** Parameter (0 at a, 1 at b) of the closest point on the rope to p. */
  closestT(p: THREE.Vector3): number {
    return THREE.MathUtils.clamp(_ap.subVectors(p, this.a).dot(this.dir) / this.length, 0, 1);
  }

  pointAt(t: number, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.a).addScaledVector(this.dir, t * this.length);
  }

  distanceTo(p: THREE.Vector3): number {
    return this.pointAt(this.closestT(p), _ap).distanceTo(p);
  }
}
