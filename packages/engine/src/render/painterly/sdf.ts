/**
 * Signed distance "clay" for sculpting characters and props in code.
 *
 * A sculpt is an ordered list of primitives (ellipsoids, tapered capsules,
 * rounded boxes) that are smoothly added to or carved out of the shape. Each
 * primitive also carries a paint (which material it is) and a bone (which
 * part of the skeleton it moves with), so the mesher can colour the surface
 * and skin it without any UVs or weight painting.
 *
 * Units are metres. Everything here is plain math so it runs anywhere
 * (browser, worker, node) and is deterministic.
 */

export type V3 = [number, number, number];

export interface Clip {
  /** Plane normal in the primitive's local frame; keeps the side the normal points away from. */
  n: V3;
  /** Keep points where dot(n, p) < o. */
  o: number;
  /** Softness of the cut (m). */
  k?: number;
}

export interface Displace {
  /** Amplitude (m). */
  amp: number;
  /** Frequency per axis (1/m), local frame. Uneven values make folds/locks. */
  freq: V3;
  /** Noise seed offset. */
  seed?: number;
}

interface PrimBase {
  /** Smooth blend radius with what came before (m). */
  k?: number;
  /** 'add' (default) or 'sub' (carve). */
  op?: 'add' | 'sub';
  /** Paint id (index into the sculpt's palette). */
  paint?: number;
  /** Bone name this primitive moves with. */
  bone?: string;
  /** For skirts and coat tails: how much of the nearest leg's motion it takes at its hem (0..1). */
  legFollow?: number;
  /** Rotation (quaternion x,y,z,w) of the local frame. */
  rot?: [number, number, number, number];
  clip?: Clip[];
  displace?: Displace;
  /** Make a hollow layer of this thickness (m) instead of a solid. */
  shell?: number;
  /** Which mesh piece it belongs to ('body', 'head', ...). Defaults to the sculpt's current piece. */
  piece?: string;
}

export interface Ellipsoid extends PrimBase {
  type: 'ellipsoid';
  c: V3;
  r: V3;
}

/** A capsule whose radius changes from a to b ("round cone"). */
export interface Cone extends PrimBase {
  type: 'cone';
  a: V3;
  b: V3;
  ra: number;
  rb: number;
}

export interface RBox extends PrimBase {
  type: 'box';
  c: V3;
  /** Half extents. */
  h: V3;
  /** Corner rounding (m). */
  r: number;
}

export type Prim = Ellipsoid | Cone | RBox;

// ---------------------------------------------------------------- noise

const PERM = new Uint8Array(512);
{
  let s = 0x2c9277b5;
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0;
    const j = s % (i + 1);
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}

function hash3(x: number, y: number, z: number): number {
  return PERM[(PERM[(PERM[x & 255] + y) & 255] + z) & 255] / 127.5 - 1;
}

/** Smooth 3D value noise in [-1, 1]. */
export function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = fz * fz * (3 - 2 * fz);
  const a = hash3(xi, yi, zi);
  const b = hash3(xi + 1, yi, zi);
  const c = hash3(xi, yi + 1, zi);
  const d = hash3(xi + 1, yi + 1, zi);
  const e = hash3(xi, yi, zi + 1);
  const f = hash3(xi + 1, yi, zi + 1);
  const g = hash3(xi, yi + 1, zi + 1);
  const h = hash3(xi + 1, yi + 1, zi + 1);
  const x1 = a + (b - a) * u;
  const x2 = c + (d - c) * u;
  const x3 = e + (f - e) * u;
  const x4 = g + (h - g) * u;
  const y1 = x1 + (x2 - x1) * v;
  const y2 = x3 + (x4 - x3) * v;
  return y1 + (y2 - y1) * w;
}

/** Two octaves: enough for lumpy cloth and clumped hair. */
export function fbm3(x: number, y: number, z: number): number {
  return noise3(x, y, z) * 0.7 + noise3(x * 2.13 + 17.1, y * 2.13 - 4.3, z * 2.13 + 9.7) * 0.3;
}

// ---------------------------------------------------------------- compiled form

/**
 * A primitive ready to evaluate: a 3x4 affine (bind space -> local), the
 * shape parameters and a bounding sphere (in bind space) for culling.
 */
export interface Compiled {
  src: Prim;
  index: number;
  kind: 0 | 1 | 2;
  sub: boolean;
  k: number;
  /** Row-major 3x4: local = M * [p, 1]. */
  m: Float64Array;
  /** Shape params. Ellipsoid: rx ry rz. Cone: ax ay az bx by bz ra rb (local). Box: hx hy hz r. */
  q: Float64Array;
  bc: V3;
  br: number;
  clip: Clip[] | null;
  disp: Displace | null;
  shell: number;
  paint: number;
  bone: string;
}

/** Rotate v by unit quaternion q. */
export function qrot(q: [number, number, number, number], v: V3): V3 {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}

/** Quaternion from Euler XYZ (radians), same order as THREE.Euler default. */
export function quatEuler(x: number, y: number, z: number): [number, number, number, number] {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

/**
 * Compile a primitive. `toRest` maps a bind-space point to rest space for
 * this primitive's bone (row-major 3x4); identity if the piece isn't posed.
 */
export function compile(p: Prim, index: number, toRest: Float64Array | null): Compiled {
  // local = R^T (rest - c)
  const q = p.rot ?? [0, 0, 0, 1];
  const qi: [number, number, number, number] = [-q[0], -q[1], -q[2], q[3]];
  const ex = qrot(qi, [1, 0, 0]);
  const ey = qrot(qi, [0, 1, 0]);
  const ez = qrot(qi, [0, 0, 1]);
  // R^T as a matrix: columns are R^T e_i => rows of R^T are...
  // We want L such that L*v = qrot(qi, v); its columns are ex, ey, ez.
  const L = [ex[0], ey[0], ez[0], ex[1], ey[1], ez[1], ex[2], ey[2], ez[2]];
  let origin: V3;
  let params: number[];
  let kind: 0 | 1 | 2;
  let br: number;
  if (p.type === 'ellipsoid') {
    origin = p.c;
    params = [...p.r];
    kind = 0;
    br = Math.max(...p.r);
  } else if (p.type === 'box') {
    origin = p.c;
    params = [...p.h, p.r];
    kind = 2;
    br = Math.hypot(...p.h) + p.r;
  } else {
    origin = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
    const la = qrot(qi, [p.a[0] - origin[0], p.a[1] - origin[1], p.a[2] - origin[2]]);
    const lb = qrot(qi, [p.b[0] - origin[0], p.b[1] - origin[1], p.b[2] - origin[2]]);
    params = [...la, ...lb, p.ra, p.rb];
    kind = 1;
    br = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]) / 2 + Math.max(p.ra, p.rb);
  }
  // M0: rest -> local = L*(rest - origin)
  const t = [
    -(L[0] * origin[0] + L[1] * origin[1] + L[2] * origin[2]),
    -(L[3] * origin[0] + L[4] * origin[1] + L[5] * origin[2]),
    -(L[6] * origin[0] + L[7] * origin[1] + L[8] * origin[2]),
  ];
  const m = new Float64Array(12);
  const T = toRest ?? new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
  // m = M0 * T
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += L[r * 3 + k] * T[k * 4 + c];
      if (c === 3) s += t[r];
      m[r * 4 + c] = s;
    }
  }
  // Bounding sphere centre in bind space: inverse of T applied to origin.
  const bc = invApply(T, origin);
  const pad = (p.displace?.amp ?? 0) * 1.5 + (p.k ?? 0) + (p.shell ?? 0);
  return {
    src: p,
    index,
    kind,
    sub: p.op === 'sub',
    k: p.k ?? 0,
    m,
    q: new Float64Array(params),
    bc,
    br: br + pad,
    clip: p.clip?.length ? p.clip : null,
    disp: p.displace ?? null,
    shell: p.shell ?? 0,
    paint: p.paint ?? 0,
    bone: p.bone ?? 'root',
  };
}

function invApply(T: Float64Array, v: V3): V3 {
  // T is rigid (rotation + translation): inverse = R^T (v - t)
  const x = v[0] - T[3], y = v[1] - T[7], z = v[2] - T[11];
  return [T[0] * x + T[4] * y + T[8] * z, T[1] * x + T[5] * y + T[9] * z, T[2] * x + T[6] * y + T[10] * z];
}

/** Distance from a bind-space point to one compiled primitive. */
export function primDist(c: Compiled, x: number, y: number, z: number): number {
  const m = c.m;
  const lx = m[0] * x + m[1] * y + m[2] * z + m[3];
  const ly = m[4] * x + m[5] * y + m[6] * z + m[7];
  const lz = m[8] * x + m[9] * y + m[10] * z + m[11];
  const q = c.q;
  let d: number;
  if (c.kind === 0) {
    // Ellipsoid (iq's bound, good near the surface).
    const ax = lx / q[0], ay = ly / q[1], az = lz / q[2];
    const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
    const bx = lx / (q[0] * q[0]), by = ly / (q[1] * q[1]), bz = lz / (q[2] * q[2]);
    const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
    d = k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(q[0], q[1], q[2]);
  } else if (c.kind === 1) {
    d = roundCone(lx, ly, lz, q[0], q[1], q[2], q[3], q[4], q[5], q[6], q[7]);
  } else {
    const qx = Math.abs(lx) - q[0], qy = Math.abs(ly) - q[1], qz = Math.abs(lz) - q[2];
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
    d = Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - q[3];
  }
  if (c.disp) {
    const f = c.disp.freq;
    const s = c.disp.seed ?? c.index * 7.31;
    d += c.disp.amp * fbm3(lx * f[0] + s, ly * f[1] - s * 0.7, lz * f[2] + s * 1.3);
  }
  if (c.shell) d = Math.abs(d + c.shell * 0.5) - c.shell * 0.5;
  if (c.clip) {
    for (const cl of c.clip) {
      const pd = cl.n[0] * lx + cl.n[1] * ly + cl.n[2] * lz - cl.o;
      d = cl.k ? smax(d, pd, cl.k) : Math.max(d, pd);
    }
  }
  return d;
}

/** Round cone between a (radius ra) and b (radius rb). */
function roundCone(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r1: number, r2: number): number {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  if (l2 < 1e-12) return Math.hypot(px - ax, py - ay, pz - az) - Math.max(r1, r2);
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const y = pax * bax + pay * bay + paz * baz;
  const z = y - l2;
  const wx = pax * l2 - bax * y, wy = pay * l2 - bay * y, wz = paz * l2 - baz * y;
  const x2 = wx * wx + wy * wy + wz * wz;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

/** Field of a set of compiled primitives, in order. */
export class Field {
  constructor(readonly prims: Compiled[]) {}

  /**
   * The primitives that can matter within `r` of a point, for evaluations
   * whose |distance| stays under `reach`. Much faster to evaluate locally.
   */
  near(x: number, y: number, z: number, r: number, reach: number): Field {
    const keep = this.prims.filter((c) => Math.hypot(x - c.bc[0], y - c.bc[1], z - c.bc[2]) - c.br < r + reach + c.k);
    return new Field(keep);
  }

  /** Signed distance at a point. */
  dist(x: number, y: number, z: number): number {
    let d = 1e9;
    const ps = this.prims;
    for (let i = 0; i < ps.length; i++) {
      const c = ps[i];
      const dx = x - c.bc[0], dy = y - c.bc[1], dz = z - c.bc[2];
      const lb = Math.sqrt(dx * dx + dy * dy + dz * dz) - c.br;
      if (c.sub) {
        if (d > 1e8 || lb > c.k - d) continue;
        d = smax(d, -primDist(c, x, y, z), c.k);
      } else {
        if (lb > d + c.k) continue;
        d = smin(d, primDist(c, x, y, z), c.k);
      }
    }
    return d;
  }
}
