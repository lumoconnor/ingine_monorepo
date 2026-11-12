/**
 * A square grid of heights covering the whole world: the single source of
 * truth for the ground. Generation layers (rivers, roads, flattened sites)
 * edit it in place; render meshes and physics colliders are both built from
 * its vertices, so what you see is exactly what you stand on.
 *
 * Vertex (ix, iz) sits at (minX + ix * cell, minZ + iz * cell). Each cell is
 * split into two triangles along the (ix+1, iz) - (ix, iz+1) diagonal, the
 * same split Rapier's heightfield uses, and `heightAt` follows it exactly.
 */
export class HeightGrid {
  /** Vertices per side. */
  readonly n: number;
  readonly heights: Float32Array;
  readonly maxX: number;
  readonly maxZ: number;

  constructor(
    readonly minX: number,
    readonly minZ: number,
    /** Side length in metres. */
    readonly size: number,
    /** Vertex spacing in metres. */
    readonly cell: number,
  ) {
    this.n = Math.round(size / cell) + 1;
    this.heights = new Float32Array(this.n * this.n);
    this.maxX = minX + size;
    this.maxZ = minZ + size;
  }

  /** Height at a vertex (clamped to the grid). */
  at(ix: number, iz: number): number {
    const n = this.n - 1;
    ix = ix < 0 ? 0 : ix > n ? n : ix;
    iz = iz < 0 ? 0 : iz > n ? n : iz;
    return this.heights[iz * this.n + ix];
  }

  set(ix: number, iz: number, h: number): void {
    this.heights[iz * this.n + ix] = h;
  }

  /** Fill every vertex from a function of world position. */
  fill(fn: (x: number, z: number) => number): void {
    const { n, minX, minZ, cell, heights } = this;
    for (let iz = 0; iz < n; iz++) {
      const z = minZ + iz * cell;
      for (let ix = 0; ix < n; ix++) heights[iz * n + ix] = fn(minX + ix * cell, z);
    }
  }

  /** Ground height at any world point, on the same triangles the collider uses. */
  heightAt(x: number, z: number): number {
    const gx = (x - this.minX) / this.cell;
    const gz = (z - this.minZ) / this.cell;
    const max = this.n - 1;
    const ix = Math.min(max - 1, Math.max(0, Math.floor(gx)));
    const iz = Math.min(max - 1, Math.max(0, Math.floor(gz)));
    const fx = Math.min(1, Math.max(0, gx - ix));
    const fz = Math.min(1, Math.max(0, gz - iz));
    const i = iz * this.n + ix;
    const h = this.heights;
    const a = h[i];
    const b = h[i + 1];
    const c = h[i + this.n];
    const d = h[i + this.n + 1];
    if (fx + fz <= 1) return a + (b - a) * fx + (c - a) * fz;
    return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  }

  /** Unit surface normal at a vertex, from central differences. */
  normalAt(ix: number, iz: number, out: { x: number; y: number; z: number }): void {
    const dx = this.at(ix + 1, iz) - this.at(ix - 1, iz);
    const dz = this.at(ix, iz + 1) - this.at(ix, iz - 1);
    const nx = -dx;
    const ny = 2 * this.cell;
    const nz = -dz;
    const l = Math.hypot(nx, ny, nz);
    out.x = nx / l;
    out.y = ny / l;
    out.z = nz / l;
  }

  /** Slope at a vertex in degrees. */
  slopeDegAt(ix: number, iz: number): number {
    const dx = (this.at(ix + 1, iz) - this.at(ix - 1, iz)) / (2 * this.cell);
    const dz = (this.at(ix, iz + 1) - this.at(ix, iz - 1)) / (2 * this.cell);
    return (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI;
  }

  /** Nearest vertex index for a world position. */
  toGrid(x: number, z: number): { ix: number; iz: number } {
    return {
      ix: Math.round((x - this.minX) / this.cell),
      iz: Math.round((z - this.minZ) / this.cell),
    };
  }
}
