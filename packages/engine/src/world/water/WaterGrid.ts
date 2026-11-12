import * as THREE from 'three';
import { Component } from '../../entities/Component';
import { WaterVolume, type WaterField, type WaterSample } from '../../gameplay/components/WaterVolume';
import type { HeightGrid } from '../../procgen/HeightGrid';

/**
 * Rivers and lakes as a grid: a water surface height per vertex (NaN = no
 * water) and a flow velocity. The ground decides the shoreline: water exists
 * wherever the surface is above the terrain, so the grid can safely cover a
 * little more than the wet area.
 */
export class WaterGrid implements WaterField {
  readonly n: number;
  /** Surface height per vertex; NaN where there is no water. */
  readonly level: Float32Array;
  readonly flowX: Float32Array;
  readonly flowZ: Float32Array;

  constructor(
    readonly minX: number,
    readonly minZ: number,
    readonly size: number,
    readonly cell: number,
  ) {
    this.n = Math.round(size / cell) + 1;
    const len = this.n * this.n;
    this.level = new Float32Array(len).fill(NaN);
    this.flowX = new Float32Array(len);
    this.flowZ = new Float32Array(len);
  }

  index(ix: number, iz: number): number {
    return iz * this.n + ix;
  }

  /** Surface height at a world point (nearest valid vertices, bilinear), or NaN. */
  levelAt(x: number, z: number): number {
    const gx = (x - this.minX) / this.cell;
    const gz = (z - this.minZ) / this.cell;
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    if (ix < 0 || iz < 0 || ix >= this.n - 1 || iz >= this.n - 1) return NaN;
    const fx = gx - ix;
    const fz = gz - iz;
    const i = iz * this.n + ix;
    const L = this.level;
    const a = L[i];
    const b = L[i + 1];
    const c = L[i + this.n];
    const d = L[i + this.n + 1];
    // All four known: blend. Otherwise take the nearest known corner.
    if (a === a && b === b && c === c && d === d) {
      // A waterfall lip: don't blend across a big step, use the nearer side.
      const hi = Math.max(a, b, c, d);
      const lo = Math.min(a, b, c, d);
      if (hi - lo < 1.5) return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
    }
    const corners: [number, number][] = [
      [a, (fx * fx + fz * fz)],
      [b, ((1 - fx) ** 2 + fz * fz)],
      [c, (fx * fx + (1 - fz) ** 2)],
      [d, ((1 - fx) ** 2 + (1 - fz) ** 2)],
    ];
    let best = NaN;
    let bestD = Infinity;
    for (const [v, dd] of corners) if (v === v && dd < bestD) [best, bestD] = [v, dd];
    return best;
  }

  sample(x: number, y: number, z: number, above: number): WaterSample | null {
    const s = this.levelAt(x, z);
    if (!(s === s) || y > s + above) return null;
    const gx = Math.round((x - this.minX) / this.cell);
    const gz = Math.round((z - this.minZ) / this.cell);
    const i = Math.min(this.n - 1, Math.max(0, gz)) * this.n + Math.min(this.n - 1, Math.max(0, gx));
    return { surfaceY: s, current: new THREE.Vector3(this.flowX[i], 0, this.flowZ[i]) };
  }
}

export interface WaterBodyOptions {
  water: WaterGrid;
  /** The ground, for depth tinting and to skip cells that are dry. */
  ground: HeightGrid;
  /** Mesh chunk size in metres (default 128). */
  chunkSize?: number;
  shallowColor?: number;
  deepColor?: number;
  foamColor?: number;
}

const _c = new THREE.Color();

/**
 * Registers a WaterGrid so swimming, wading and the underwater effect see it,
 * and draws its surface: one mesh per chunk that has water, tinted darker
 * where deep and white where it runs fast or falls.
 */
export class WaterBody extends Component {
  private meshes: THREE.Mesh[] = [];
  private material: THREE.MeshStandardMaterial;

  constructor(private opts: WaterBodyOptions) {
    super();
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.78,
      roughness: 0.15,
      metalness: 0.05,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  }

  onAttach(): void {
    WaterVolume.fields.add(this.opts.water);
    const w = this.opts.water;
    const cells = Math.round((this.opts.chunkSize ?? 128) / w.cell);
    for (let cz = 0; cz < w.n - 1; cz += cells) {
      for (let cx = 0; cx < w.n - 1; cx += cells) {
        const mesh = this.buildChunk(cx, cz, Math.min(cells, w.n - 1 - cx), Math.min(cells, w.n - 1 - cz));
        if (mesh) {
          this.entity.object3d.add(mesh);
          this.meshes.push(mesh);
        }
      }
    }
  }

  onDetach(): void {
    WaterVolume.fields.delete(this.opts.water);
    for (const m of this.meshes) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    this.meshes = [];
    this.material.dispose();
  }

  get meshCount(): number {
    return this.meshes.length;
  }

  private buildChunk(cx: number, cz: number, nx: number, nz: number): THREE.Mesh | null {
    const { water: w, ground } = this.opts;
    const shallow = new THREE.Color(this.opts.shallowColor ?? 0x3f95b8);
    const deep = new THREE.Color(this.opts.deepColor ?? 0x1c4f78);
    const foam = new THREE.Color(this.opts.foamColor ?? 0xe8f2f6);
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const vmap = new Map<number, number>();
    const vert = (ix: number, iz: number): number => {
      const key = iz * w.n + ix;
      const had = vmap.get(key);
      if (had !== undefined) return had;
      const x = w.minX + ix * w.cell;
      const z = w.minZ + iz * w.cell;
      const y = w.level[key];
      const depth = y - ground.heightAt(x, z);
      const speed = Math.hypot(w.flowX[key], w.flowZ[key]);
      // Steps between neighbours mark a waterfall lip.
      let step = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const jx = ix + dx;
        const jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= w.n || jz >= w.n) continue;
        const o = w.level[jz * w.n + jx];
        if (o === o) step = Math.max(step, Math.abs(o - y));
      }
      _c.copy(shallow).lerp(deep, THREE.MathUtils.smoothstep(depth, 0.5, 4));
      _c.lerp(foam, Math.max(THREE.MathUtils.smoothstep(speed, 2.2, 4), THREE.MathUtils.smoothstep(step, 0.6, 2.5)) * 0.85);
      const i = pos.length / 3;
      pos.push(x, y, z);
      col.push(_c.r, _c.g, _c.b);
      vmap.set(key, i);
      return i;
    };
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const ix = cx + i;
        const iz = cz + j;
        const a = iz * w.n + ix;
        const b = a + 1;
        const c = a + w.n;
        const d = c + 1;
        const L = w.level;
        if (!(L[a] === L[a] && L[b] === L[b] && L[c] === L[c] && L[d] === L[d])) continue;
        // Skip cells whose water sits under the ground at every corner (the margin around a river).
        const g = (k: number, gx: number, gz: number) => L[k] < ground.heightAt(w.minX + gx * w.cell, w.minZ + gz * w.cell) - 0.05;
        if (g(a, ix, iz) && g(b, ix + 1, iz) && g(c, ix, iz + 1) && g(d, ix + 1, iz + 1)) continue;
        const va = vert(ix, iz);
        const vb = vert(ix + 1, iz);
        const vc = vert(ix, iz + 1);
        const vd = vert(ix + 1, iz + 1);
        idx.push(va, vc, vb, vb, vc, vd);
      }
    }
    if (!idx.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.name = 'water-surface';
    mesh.renderOrder = 1;
    return mesh;
  }
}
