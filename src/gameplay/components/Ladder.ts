import * as THREE from 'three';
import { Component } from '@/entities/Component';

const _local = new THREE.Vector3();
const _inv = new THREE.Matrix4();

/**
 * A climbable ladder. The entity's origin is the bottom-centre of the ladder
 * where it meets the wall; its local +Z axis points away from the wall
 * (toward the climber). The climb zone is a box in front of the ladder.
 * The ladder itself has no collider: the wall behind it does the blocking.
 */
export class Ladder extends Component {
  /** All ladders in the world (small list; the player checks each step). */
  static readonly all = new Set<Ladder>();

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    super();
  }

  onAttach(): void {
    Ladder.all.add(this);
  }

  onDetach(): void {
    Ladder.all.delete(this);
  }

  /** Unit vector pointing away from the wall, toward the climber. */
  get normal(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, 1).applyQuaternion(this.entity.object3d.quaternion);
  }

  /** A world point expressed in ladder space (x across, y up from the bottom, z out from the wall). */
  toLocal(world: THREE.Vector3, out = _local): THREE.Vector3 {
    this.entity.object3d.updateMatrixWorld();
    _inv.copy(this.entity.object3d.matrixWorld).invert();
    return out.copy(world).applyMatrix4(_inv);
  }

  /** Is a player's feet position inside the climb zone? */
  contains(feet: THREE.Vector3, radius: number): boolean {
    const p = this.toLocal(feet);
    return (
      Math.abs(p.x) <= this.width / 2 + 0.15 &&
      p.y >= -0.1 &&
      p.y <= this.height + 0.35 &&
      p.z >= -0.05 &&
      p.z <= radius + 0.45
    );
  }
}
