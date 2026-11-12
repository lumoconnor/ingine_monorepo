import { Field, primDist, fbm3, type V3, type Compiled } from './sdf';

/**
 * Turns a distance field into a smooth triangle mesh (naive surface nets on
 * a sparse grid, vertices projected onto the true surface), then bakes the
 * "hand-painted" look into vertex colours: paint zones, soft colour tints,
 * ambient occlusion, cavity darks and edge highlights. It also works out
 * skin weights from which primitive each vertex sits on.
 */

export interface Paint {
  /** Linear RGB. */
  color: V3;
  /** Second colour, mottled in with low-frequency noise. */
  color2?: V3;
  mottle?: number;
  /** Noise frequency for the mottle (1/m). */
  mottleFreq?: number;
  /** Subsurface warmth at the light's terminator (skin ~1). */
  sss?: number;
  /** 0 = chalky, 1 = glossy (leather, metal, eyes). */
  gloss?: number;
  metal?: number;
  /** Brush stroke strength in the shader (0..1, default 1). */
  brush?: number;
  /** How strongly edges get painted highlights (default 1). */
  edge?: number;
}

/** A colour-only influence: blush, dirt, stubble shadow. Has no shape. */
export interface Tint {
  c: V3;
  r: number;
  color: V3;
  amount: number;
  /** Only affect these paints (ids). */
  only?: number[];
  piece?: string;
  /** Bind-space toRest is applied per bone; tints live in rest space of this bone. */
  bone?: string;
}

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface BakeOptions {
  paints: Paint[];
  tints: Tint[];
  /** Bone name -> index, for skinning. Omit for rigid pieces. */
  bones?: Map<string, number>;
  /** Hip height (bind space) where legFollow starts. */
  hipY?: number;
  kneeY?: number;
  /** Value falloff toward the feet: [y at darkest, y at full, darkest factor]. */
  valueRamp?: [number, number, number];
  /** Maps a bind-space point to rest space (for tints, value ramp, brush coords). Identity when omitted. */
  toRestOf?: (bone: string) => Float64Array | null;
}

export interface Baked {
  colors: Float32Array;
  paint: Float32Array;
  skinIndex?: Uint16Array;
  skinWeight?: Float32Array;
}

const SQRT3 = Math.sqrt(3);

export function meshField(field: Field, min: V3, max: V3, cell: number): MeshData {
  const F = 4;
  const nx = Math.ceil((max[0] - min[0]) / cell / F) * F + 1;
  const ny = Math.ceil((max[1] - min[1]) / cell / F) * F + 1;
  const nz = Math.ceil((max[2] - min[2]) / cell / F) * F + 1;
  const cnx = (nx - 1) / F + 1, cny = (ny - 1) / F + 1, cnz = (nz - 1) / F + 1;
  const coarse = new Float32Array(cnx * cny * cnz);
  const cc = cell * F;
  for (let k = 0; k < cnz; k++)
    for (let j = 0; j < cny; j++)
      for (let i = 0; i < cnx; i++)
        coarse[i + cnx * (j + cny * k)] = field.dist(min[0] + i * cc, min[1] + j * cc, min[2] + k * cc);

  const vals = new Float32Array(nx * ny * nz).fill(NaN);
  const near = cc * SQRT3 * 1.25;
  for (let k = 0; k < cnz - 1; k++)
    for (let j = 0; j < cny - 1; j++)
      for (let i = 0; i < cnx - 1; i++) {
        let m = Infinity;
        for (let c = 0; c < 8; c++) {
          const v = coarse[i + (c & 1) + cnx * (j + ((c >> 1) & 1) + cny * (k + (c >> 2)))];
          m = Math.min(m, Math.abs(v));
        }
        if (m > near) continue;
        const local = field.near(min[0] + (i + 0.5) * cc, min[1] + (j + 0.5) * cc, min[2] + (k + 0.5) * cc, cc * SQRT3 * 0.5, near + cc * SQRT3);
        for (let kk = 0; kk <= F; kk++)
          for (let jj = 0; jj <= F; jj++)
            for (let ii = 0; ii <= F; ii++) {
              const fi = i * F + ii, fj = j * F + jj, fk = k * F + kk;
              const idx = fi + nx * (fj + ny * fk);
              if (vals[idx] === vals[idx]) continue;
              vals[idx] = local.dist(min[0] + fi * cell, min[1] + fj * cell, min[2] + fk * cell);
            }
      }
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const idx = i + nx * (j + ny * k);
        if (vals[idx] !== vals[idx]) vals[idx] = coarse[Math.round(i / F) + cnx * (Math.round(j / F) + cny * Math.round(k / F))];
      }

  // One vertex per cell that the surface crosses.
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cellVert = new Int32Array(cx * cy * cz).fill(-1);
  const pos: number[] = [];
  const corner = new Float32Array(8);
  const EDGES = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  for (let k = 0; k < cz; k++)
    for (let j = 0; j < cy; j++)
      for (let i = 0; i < cx; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = vals[i + (c & 1) + nx * (j + ((c >> 1) & 1) + ny * (k + (c >> 2)))];
          corner[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [a, b] of EDGES) {
          const va = corner[a], vb = corner[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          const ax = a & 1, ay = (a >> 1) & 1, az = a >> 2;
          const bx = b & 1, by = (b >> 1) & 1, bz = b >> 2;
          sx += ax + (bx - ax) * t;
          sy += ay + (by - ay) * t;
          sz += az + (bz - az) * t;
          n++;
        }
        cellVert[i + cx * (j + cy * k)] = pos.length / 3;
        pos.push(min[0] + (i + sx / n) * cell, min[1] + (j + sy / n) * cell, min[2] + (k + sz / n) * cell);
      }

  // Pull vertices onto the real surface and take normals from the field.
  const vcount = pos.length / 3;
  const positions = new Float32Array(pos);
  const normals = new Float32Array(vcount * 3);
  const h = cell * 0.25;
  const g: V3 = [0, 0, 0];
  const buckets = new LocalFields(field, 0.06, 0.03);
  for (let v = 0; v < vcount; v++) {
    let x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    const x0 = x, y0 = y, z0 = z;
    const lf = buckets.at(x, y, z);
    for (let it = 0; it < 2; it++) {
      const d = lf.dist(x, y, z);
      grad(lf, x, y, z, h, g);
      const l2 = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
      if (l2 < 1e-8) break;
      x -= (d * g[0]) / l2;
      y -= (d * g[1]) / l2;
      z -= (d * g[2]) / l2;
      if (Math.abs(d) < cell * 0.02) break;
    }
    // Don't let a vertex wander out of its neighbourhood (thin features).
    const dx = x - x0, dy = y - y0, dz = z - z0;
    const dl = Math.hypot(dx, dy, dz);
    if (dl > cell) {
      x = x0 + (dx / dl) * cell;
      y = y0 + (dy / dl) * cell;
      z = z0 + (dz / dl) * cell;
    }
    positions[v * 3] = x;
    positions[v * 3 + 1] = y;
    positions[v * 3 + 2] = z;
    grad(lf, x, y, z, cell * 0.5, g);
    const l = Math.hypot(g[0], g[1], g[2]) || 1;
    normals[v * 3] = g[0] / l;
    normals[v * 3 + 1] = g[1] / l;
    normals[v * 3 + 2] = g[2] / l;
  }

  // Quads across every grid edge with a sign change.
  const idx: number[] = [];
  const cv = (i: number, j: number, k: number) => cellVert[i + cx * (j + cy * k)];
  const quad = (a: number, b: number, c: number, d: number) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    // Split along the shorter diagonal.
    const dac = dist2(positions, a, c), dbd = dist2(positions, b, d);
    const tris = dac < dbd ? [a, b, c, a, c, d] : [a, b, d, b, c, d];
    for (let t = 0; t < 6; t += 3) {
      const p = tris[t], q = tris[t + 1], r = tris[t + 2];
      // Orient each triangle by the field's normal.
      const ux = positions[q * 3] - positions[p * 3], uy = positions[q * 3 + 1] - positions[p * 3 + 1], uz = positions[q * 3 + 2] - positions[p * 3 + 2];
      const wx = positions[r * 3] - positions[p * 3], wy = positions[r * 3 + 1] - positions[p * 3 + 1], wz = positions[r * 3 + 2] - positions[p * 3 + 2];
      const nx_ = uy * wz - uz * wy, ny_ = uz * wx - ux * wz, nz_ = ux * wy - uy * wx;
      const sn = (normals[p * 3] + normals[q * 3] + normals[r * 3]) * nx_ + (normals[p * 3 + 1] + normals[q * 3 + 1] + normals[r * 3 + 1]) * ny_ + (normals[p * 3 + 2] + normals[q * 3 + 2] + normals[r * 3 + 2]) * nz_;
      if (sn >= 0) idx.push(p, q, r);
      else idx.push(p, r, q);
    }
  };
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const v0 = vals[i + nx * (j + ny * k)] < 0;
        if (i < cx && j > 0 && k > 0 && j < cy && k < cz) {
          if (v0 !== vals[i + 1 + nx * (j + ny * k)] < 0) quad(cv(i, j - 1, k - 1), cv(i, j, k - 1), cv(i, j, k), cv(i, j - 1, k));
        }
        if (j < ny - 1 && i > 0 && k > 0 && i < cx && k < cz && j < cy) {
          if (v0 !== vals[i + nx * (j + 1 + ny * k)] < 0) quad(cv(i - 1, j, k - 1), cv(i, j, k - 1), cv(i, j, k), cv(i - 1, j, k));
        }
        if (k < nz - 1 && i > 0 && j > 0 && i < cx && j < cy && k < cz) {
          if (v0 !== vals[i + nx * (j + ny * (k + 1))] < 0) quad(cv(i - 1, j - 1, k), cv(i, j - 1, k), cv(i, j, k), cv(i - 1, j, k));
        }
      }
  return { positions, normals, indices: new Uint32Array(idx) };
}

/** Local fields cached per grid bucket (size `cell`), each holding prims within `reach`. */
class LocalFields {
  private map = new Map<number, Field>();
  constructor(private field: Field, private cell: number, private reach: number) {}
  at(x: number, y: number, z: number): Field {
    const c = this.cell;
    const i = Math.floor(x / c), j = Math.floor(y / c), k = Math.floor(z / c);
    const key = (i + 512) + (j + 512) * 1024 + (k + 512) * 1048576;
    let f = this.map.get(key);
    if (!f) {
      f = this.field.near((i + 0.5) * c, (j + 0.5) * c, (k + 0.5) * c, c * SQRT3 * 0.5, this.reach);
      this.map.set(key, f);
    }
    return f;
  }
}

function dist2(p: Float32Array, a: number, b: number): number {
  const x = p[a * 3] - p[b * 3], y = p[a * 3 + 1] - p[b * 3 + 1], z = p[a * 3 + 2] - p[b * 3 + 2];
  return x * x + y * y + z * z;
}

/** Tetrahedral gradient: 4 evaluations instead of 6. */
function grad(f: Field, x: number, y: number, z: number, h: number, out: V3): void {
  const a = f.dist(x + h, y - h, z - h);
  const b = f.dist(x - h, y - h, z + h);
  const c = f.dist(x - h, y + h, z - h);
  const d = f.dist(x + h, y + h, z + h);
  out[0] = (a - b - c + d) / (4 * h);
  out[1] = (-a - b + c + d) / (4 * h);
  out[2] = (-a + b - c + d) / (4 * h);
}

function smooth01(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function apply(T: Float64Array | null | undefined, x: number, y: number, z: number): V3 {
  if (!T) return [x, y, z];
  return [T[0] * x + T[1] * y + T[2] * z + T[3], T[4] * x + T[5] * y + T[6] * z + T[7], T[8] * x + T[9] * y + T[10] * z + T[11]];
}

/** Bakes paint, lighting-independent shading and skin weights per vertex. */
export function bakeSurface(field: Field, mesh: MeshData, o: BakeOptions): Baked {
  const n = mesh.positions.length / 3;
  const colors = new Float32Array(n * 3);
  const paint = new Float32Array(n * 4);
  const skinIndex = o.bones ? new Uint16Array(n * 4) : undefined;
  const skinWeight = o.bones ? new Float32Array(n * 4) : undefined;
  const P = mesh.positions, N = mesh.normals;
  const prims = field.prims;
  const dists = new Float64Array(prims.length);
  const [vr0, vr1, vrMin] = o.valueRamp ?? [0, 1, 1];
  const boneW = new Map<string, number>();
  const buckets = new LocalFields(field, 0.06, 0.14);
  for (let v = 0; v < n; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const lf = buckets.at(x, y, z);
    const nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2];
    // Distances to nearby additive primitives.
    let dmin = Infinity;
    for (let i = 0; i < prims.length; i++) {
      const c = prims[i];
      dists[i] = Infinity;
      if (c.sub) continue;
      const lb = Math.hypot(x - c.bc[0], y - c.bc[1], z - c.bc[2]) - c.br;
      if (lb > 0.06) continue;
      const d = primDist(c, x, y, z);
      dists[i] = d;
      if (d < dmin) dmin = d;
    }
    // Paint: the primitive the vertex sits on, blended over a few mm.
    let r = 0, g = 0, b = 0, sss = 0, gloss = 0, metal = 0, brush = 0, edgeAmt = 0, wsum = 0;
    let owner: Compiled | null = null;
    let ownerD = Infinity;
    for (let i = 0; i < prims.length; i++) {
      const d = dists[i];
      if (d === Infinity) continue;
      if (d < ownerD) {
        ownerD = d;
        owner = prims[i];
      }
      const w = Math.exp(-(d - dmin) / 0.0018);
      if (w < 1e-3) continue;
      const pt = o.paints[prims[i].paint] ?? o.paints[0];
      let cr = pt.color[0], cg = pt.color[1], cb = pt.color[2];
      if (pt.color2 && pt.mottle) {
        const f = pt.mottleFreq ?? 18;
        const m = smooth01(-0.4, 0.6, fbm3(x * f, y * f, z * f)) * pt.mottle;
        cr += (pt.color2[0] - cr) * m;
        cg += (pt.color2[1] - cg) * m;
        cb += (pt.color2[2] - cb) * m;
      }
      r += cr * w;
      g += cg * w;
      b += cb * w;
      sss += (pt.sss ?? 0) * w;
      gloss += (pt.gloss ?? 0) * w;
      metal += (pt.metal ?? 0) * w;
      brush += (pt.brush ?? 1) * w;
      edgeAmt += (pt.edge ?? 1) * w;
      wsum += w;
    }
    if (wsum > 0) {
      r /= wsum; g /= wsum; b /= wsum; sss /= wsum; gloss /= wsum; metal /= wsum; brush /= wsum; edgeAmt /= wsum;
    } else {
      r = g = b = 0.5;
      brush = 1;
    }
    const ownerPaint = owner?.paint ?? 0;
    const ownerBone = owner?.bone ?? 'root';
    const T = o.toRestOf?.(ownerBone) ?? null;
    const [rx, ry, rz] = apply(T, x, y, z);

    // Tints (blush, dirt, stubble), in rest space.
    for (const t of o.tints) {
      if (t.only && !t.only.includes(ownerPaint)) continue;
      const dd = Math.hypot(rx - t.c[0], ry - t.c[1], rz - t.c[2]);
      if (dd >= t.r) continue;
      const a = t.amount * smooth01(t.r, 0, dd);
      r += (t.color[0] - r) * a;
      g += (t.color[1] - g) * a;
      b += (t.color[2] - b) * a;
    }

    // Ambient occlusion from the field (a few steps out along the normal).
    let occ = 0;
    let wgt = 1;
    for (let s = 1; s <= 5; s++) {
      const hh = 0.008 * s * s * 0.6;
      const d = lf.dist(x + nx * hh, y + ny * hh, z + nz * hh);
      occ += (hh - Math.max(d, 0)) * wgt;
      wgt *= 0.6;
    }
    const ao = Math.min(1, Math.max(0, 1 - occ * 14));
    // Curvature (Laplacian of the field): convex edges catch paint highlights, creases go dark.
    const e = 0.008;
    // Tetrahedral Laplacian (4 taps + centre).
    const lap = (lf.dist(x + e, y - e, z - e) + lf.dist(x - e, y - e, z + e) + lf.dist(x - e, y + e, z - e) + lf.dist(x + e, y + e, z + e) - 4 * lf.dist(x, y, z)) / (2 * e * e);
    const convex = smooth01(45, 160, lap) * edgeAmt;
    const crease = smooth01(-10, -70, lap);

    // Occlusion darkens toward a deeper, more saturated version of the colour (not grey).
    const dark = 1 - ao * (1 - crease * 0.6);
    const sat = 1.0 - Math.min(1, dark * 1.2) * 0.55;
    r = r * (sat + (1 - sat) * r * 1.4);
    g = g * (sat + (1 - sat) * g * 1.4);
    b = b * (sat + (1 - sat) * b * 1.4);
    // Brightest values toward the head: the painter's spotlight on the face.
    const ramp = vrMin + (1 - vrMin) * smooth01(vr0, vr1, ry);
    r *= ramp;
    g *= ramp;
    b *= ramp;
    // Painted edge highlights (lighter and a touch warmer).
    r += (1 - r) * convex * 0.16;
    g += (1 - g) * convex * 0.14;
    b += (1 - b) * convex * 0.1;

    colors[v * 3] = r;
    colors[v * 3 + 1] = g;
    colors[v * 3 + 2] = b;
    paint[v * 4] = sss;
    paint[v * 4 + 1] = gloss;
    paint[v * 4 + 2] = metal;
    paint[v * 4 + 3] = brush;

    if (o.bones && skinIndex && skinWeight) {
      boneW.clear();
      for (let i = 0; i < prims.length; i++) {
        const d = dists[i];
        if (d === Infinity) continue;
        const w = Math.exp(-(d - dmin) / 0.012);
        if (w < 1e-3) continue;
        const c = prims[i];
        const follow = c.src.legFollow ?? 0;
        if (follow > 0 && o.hipY !== undefined && o.kneeY !== undefined) {
          const f = follow * smooth01(o.hipY, o.kneeY, y);
          const side = smooth01(-0.05, 0.05, x);
          boneW.set(c.bone, (boneW.get(c.bone) ?? 0) + w * (1 - f));
          boneW.set('leg_l', (boneW.get('leg_l') ?? 0) + w * f * side);
          boneW.set('leg_r', (boneW.get('leg_r') ?? 0) + w * f * (1 - side));
        } else boneW.set(c.bone, (boneW.get(c.bone) ?? 0) + w);
      }
      const top = [...boneW.entries()].filter(([name]) => o.bones!.has(name)).sort((a, b) => b[1] - a[1]).slice(0, 4);
      let tot = 0;
      for (const [, w] of top) tot += w;
      if (!top.length) top.push(['root', 1]), (tot = 1);
      for (let s = 0; s < 4; s++) {
        const e2 = top[s];
        skinIndex[v * 4 + s] = e2 ? o.bones.get(e2[0]) ?? 0 : 0;
        skinWeight[v * 4 + s] = e2 ? e2[1] / tot : 0;
      }
    }
  }
  return { colors, paint, skinIndex, skinWeight };
}
