import * as THREE from 'three';
import { Component } from '@/entities/Component';
import type { FrameTime } from '@/core/Time';

/**
 * A body of water: an axis-aligned box whose top is the surface. No collider;
 * the player controller asks `WaterVolume.at()` where the water is and swims.
 * The entity's object3d is the surface mesh, which ripples gently.
 */
export class WaterVolume extends Component {
  static readonly all = new Set<WaterVolume>();

  readonly min: THREE.Vector3;
  readonly max: THREE.Vector3;
  /** Flow velocity (m/s). Zero for still water; rivers push swimmers along. */
  readonly current: THREE.Vector3;
  private base?: Float32Array;

  constructor(min: THREE.Vector3, max: THREE.Vector3, current = new THREE.Vector3()) {
    super();
    this.min = min.clone();
    this.max = max.clone();
    this.current = current.clone();
  }

  get surfaceY(): number {
    return this.max.y;
  }

  onAttach(): void {
    WaterVolume.all.add(this);
  }
  onDetach(): void {
    WaterVolume.all.delete(this);
  }

  /** Does this volume's footprint contain (x, z), and is y below the surface (with some slack above)? */
  containsXZ(x: number, z: number): boolean {
    return x >= this.min.x && x <= this.max.x && z >= this.min.z && z <= this.max.z;
  }

  /** The water whose footprint contains this point and whose surface is above `y - above`. */
  static at(p: { x: number; y: number; z: number }, above = 0): WaterVolume | null {
    for (const w of WaterVolume.all) {
      if (w.containsXZ(p.x, p.z) && p.y <= w.max.y + above && p.y >= w.min.y - 0.5) return w;
    }
    return null;
  }

  update(time: FrameTime): void {
    const mesh = this.entity.object3d as THREE.Mesh;
    // Scroll the surface texture with the current so the flow is visible.
    const map = (mesh.material as THREE.MeshStandardMaterial).map;
    if (map && this.current.lengthSq() > 0) {
      // The plane's u runs along world +X and v along world -Z; one texture tile is 4m.
      map.offset.x = (map.offset.x - (this.current.x * time.delta) / 4) % 1;
      map.offset.y = (map.offset.y + (this.current.z * time.delta) / 4) % 1;
    }
    const geo = mesh.geometry as THREE.BufferGeometry | undefined;
    const pos = geo?.attributes.position as THREE.BufferAttribute | undefined;
    if (!pos) return;
    if (!this.base) this.base = (pos.array as Float32Array).slice();
    const t = time.elapsed;
    const a = pos.array as Float32Array;
    // Plane lies in XY before being rotated flat; z is "up" in its local space.
    for (let i = 0; i < pos.count; i++) {
      const x = this.base[i * 3];
      const y = this.base[i * 3 + 1];
      a[i * 3 + 2] = 0.025 * Math.sin(x * 0.9 + t * 1.3) + 0.02 * Math.sin(y * 1.3 - t * 1.7);
    }
    pos.needsUpdate = true;
    geo!.computeVertexNormals();
  }
}
