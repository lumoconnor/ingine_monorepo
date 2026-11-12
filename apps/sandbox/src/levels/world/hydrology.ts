import { WaterGrid } from '@ingine/engine/world/water/WaterGrid';
import { mulberry32, subSeed } from '@ingine/engine/procgen/random';
import type { HeightGrid } from '@ingine/engine/procgen/HeightGrid';
import { MinHeap } from '@ingine/engine/procgen/MinHeap';

export interface RiverPoint {
  x: number;
  z: number;
  /** Water surface height. */
  level: number;
  /** Channel width, metres. */
  width: number;
}

export interface River {
  points: RiverPoint[];
  /** Index of the river this one flows into (-1: it reaches the lake). */
  joins: number;
}

export interface Waterfall {
  x: number;
  z: number;
  /** Height of the lip. */
  top: number;
  /** Total drop (a cascade of steps counts as one fall). */
  drop: number;
  /** Which river it's on. */
  river: number;
}

export interface Lake {
  x: number;
  z: number;
  level: number;
  /** Surface area, m². */
  area: number;
}

export interface Hydrology {
  water: WaterGrid;
  lake: Lake | null;
  rivers: River[];
  falls: Waterfall[];
}

/** Water grid spacing: two terrain cells. */
const W_STEP = 2;
/** Samples (2 m each) between waterfall steps on steep ground. */
const FALL_GAP = 12;
const WALL_SLOPE = 0.85;

/**
 * Lakes, rivers and waterfalls, carved into the height grid in place:
 *
 * 1. Lake: the lowest open basin away from the middle (where the player
 *    starts) is flooded to a level that gives a lake of sensible size, and
 *    its bed is deepened toward the middle.
 * 2. Drainage: a priority flood outward from the lake finds, for every
 *    point, the route water would take to reach it (over the lowest passes).
 * 3. Rivers: springs high in the mountains follow those routes down. Where
 *    two meet, the smaller joins the bigger; rivers widen as they gather.
 * 4. Levels: the water surface only ever goes down. On gentle ground it
 *    follows the land just below the banks; on steep ground it steps down in
 *    terraces, and each step is a waterfall. Where the route crosses a rise,
 *    the channel cuts a gorge through it.
 * 5. Carving: the channel, its banks and gorge walls are pressed into the
 *    height grid, and low banks get a small levee so water stays in its bed.
 */
export function generateWater(grid: HeightGrid, seed: number, avoid: { x: number; z: number; r: number }): Hydrology {
  const rand = mulberry32(subSeed(seed, 'water'));
  const wcell = grid.cell * W_STEP;
  const water = new WaterGrid(grid.minX, grid.minZ, grid.size, wcell);
  const N = water.n;
  const hAt = (ix: number, iz: number) => grid.at(ix * W_STEP, iz * W_STEP);
  const wx = (ix: number) => water.minX + ix * wcell;
  const wz = (iz: number) => water.minZ + iz * wcell;

  // --- 1. Lake --------------------------------------------------------------
  const lake = makeLake(grid, water, rand, avoid);

  // --- 2. Drainage toward the lake (or the lowest point if there is none) -----
  const parent = new Int32Array(N * N).fill(-1);
  const pathLen = new Float32Array(N * N);
  const done = new Uint8Array(N * N);
  const heap = new MinHeap(N * 4);
  const seeds: number[] = [];
  if (lake) {
    for (let i = 0; i < N * N; i++) if (lake.mask[i]) seeds.push(i);
  } else {
    let lowest = 0;
    for (let i = 0; i < N * N; i++) if (hAt(i % N, (i / N) | 0) < hAt(lowest % N, (lowest / N) | 0)) lowest = i;
    seeds.push(lowest);
  }
  for (const s of seeds) {
    done[s] = 1;
    heap.push(s, hAt(s % N, (s / N) | 0));
  }
  const prio = new Float32Array(N * N);
  const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (heap.size) {
    const [c, p] = heap.pop();
    const cx = c % N;
    const cz = (c / N) | 0;
    for (const [dx, dz] of NB) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const n = nz * N + nx;
      if (done[n]) continue;
      done[n] = 1;
      parent[n] = c;
      pathLen[n] = pathLen[c] + (dx && dz ? Math.SQRT2 : 1) * wcell;
      const q = Math.max(hAt(nx, nz), p);
      prio[n] = q;
      heap.push(n, q);
    }
  }

  // --- 3. Springs and the routes down ----------------------------------------
  type Cand = { i: number; score: number };
  const cands: Cand[] = [];
  for (let iz = 4; iz < N - 4; iz += 5) {
    for (let ix = 4; ix < N - 4; ix += 5) {
      const i = iz * N + ix;
      const h = hAt(ix, iz);
      if (h < 95 || h > 190 || pathLen[i] < 550 || pathLen[i] > 2400) continue;
      // Springs rise in high hollows, not on cliff faces.
      if (grid.slopeDegAt(ix * W_STEP, iz * W_STEP) > 24) continue;
      // Not right on the outer rim: the spring should feed the inner land.
      const edge = Math.max(Math.abs(wx(ix)), Math.abs(wz(iz))) / (grid.size / 2);
      if (edge > 0.82) continue;
      cands.push({ i, score: h * 2 - Math.abs(pathLen[i] - 1300) * 0.08 + rand() * 120 });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const sources: number[] = [];
  const want = 4 + Math.floor(rand() * 2);
  for (const c of cands) {
    if (sources.length >= want) break;
    const x = wx(c.i % N);
    const z = wz((c.i / N) | 0);
    if (sources.every((s) => Math.hypot(wx(s % N) - x, wz((s / N) | 0) - z) > 380)) sources.push(c.i);
  }

  // Flow: how many springs drain through each cell.
  const flow = new Uint8Array(N * N);
  for (const s of sources) for (let c = s; c !== -1; c = parent[c]) flow[c] = Math.min(255, flow[c] + 1);

  const owner = new Int32Array(N * N).fill(-1);
  const routes: { cells: number[]; joins: number }[] = [];
  sources
    .sort((a, b) => pathLen[b] - pathLen[a])
    .forEach((s, r) => {
      const cells: number[] = [];
      let joins = -1;
      for (let c = s; c !== -1; c = parent[c]) {
        cells.push(c);
        if (owner[c] !== -1) {
          joins = owner[c];
          break;
        }
        owner[c] = r;
        if (lake && lake.mask[c]) break;
      }
      routes.push({ cells, joins });
    });

  // --- 4. Smooth paths, widths and levels -------------------------------------
  const rivers: River[] = [];
  const falls: Waterfall[] = [];
  for (const route of routes) {
    if (route.cells.length < 8) {
      rivers.push({ points: [], joins: route.joins });
      continue;
    }
    let pts = route.cells.map((c) => ({ x: wx(c % N), z: wz((c / N) | 0), f: flow[c] }));
    for (let k = 0; k < 3; k++) pts = chaikin(pts);
    pts = resample(pts, grid.cell);

    let travelled = 0;
    const raw = pts.map((p, i) => {
      if (i) travelled += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
      const width = Math.min(16, 3 + 2.2 * p.f + 3 * Math.min(1, travelled / 800));
      return { ...p, width, ground: grid.heightAt(p.x, p.z) };
    });
    // Ground along the path, with dips under ±3 samples smoothed out (noise, not valleys).
    const ground = raw.map((_, i) => {
      let m = Infinity;
      for (let k = -3; k <= 3; k++) m = Math.min(m, raw[Math.min(raw.length - 1, Math.max(0, i + k))].ground);
      return m;
    });
    const end = route.joins >= 0 ? nearestLevel(rivers[route.joins], raw[raw.length - 1]) : lake?.level ?? -Infinity;

    const points: RiverPoint[] = [];
    let level = Infinity;
    for (let i = 0; i < raw.length; i++) {
      const p = raw[i];
      const bank = 0.5 + 0.04 * p.width;
      const target = ground[i] - bank;
      // Steepness of the land over ±10 m.
      const a = ground[Math.max(0, i - 5)];
      const b = ground[Math.min(raw.length - 1, i + 5)];
      const slope = (a - b) / 20;
      const prev = level;
      if (slope > 0.14 && level !== Infinity) {
        // Steep ground: the surface steps down instead of sliding. When the ground catches up with
        // the pool, drop in one go to the lowest bank over the next stretch, then hold there: falls
        // come at least FALL_GAP apart and the water never rises above its banks.
        if (target < level) {
          let m = target;
          for (let k = 1; k <= FALL_GAP && i + k < raw.length; k++) m = Math.min(m, ground[i + k] - bank);
          level = Math.max(end, Math.min(level, m));
        }
      } else level = Math.max(end, Math.min(level, target));
      if (prev !== Infinity && prev - level > 1.5) {
        // Steps a few metres apart are one cascade: report it once.
        const last = falls[falls.length - 1];
        if (last && last.river === rivers.length && Math.hypot(last.x - p.x, last.z - p.z) < 16 + last.drop * 0.3) {
          last.drop = last.top - level;
          last.x = p.x;
          last.z = p.z;
        } else falls.push({ x: p.x, z: p.z, top: prev, drop: prev - level, river: rivers.length });
      }
      points.push({ x: p.x, z: p.z, level, width: p.width });
    }
    rivers.push({ points, joins: route.joins });
  }

  // --- 5. Carve ---------------------------------------------------------------
  carve(grid, water, rivers, lake?.mask ?? null);
  return { water, lake: lake ? { x: lake.x, z: lake.z, level: lake.level, area: lake.area } : null, rivers, falls };
}

function nearestLevel(r: River, p: { x: number; z: number }): number {
  let best = Infinity;
  let lv = -Infinity;
  for (const q of r.points) {
    const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
    if (d < best) [best, lv] = [d, q.level];
  }
  return lv;
}

// ---------------------------------------------------------------------------

interface LakeResult {
  x: number;
  z: number;
  level: number;
  area: number;
  /** Per water-grid vertex: 1 inside the lake. */
  mask: Uint8Array;
}

function makeLake(grid: HeightGrid, water: WaterGrid, rand: () => number, avoid: { x: number; z: number; r: number }): LakeResult | null {
  const N = water.n;
  const wcell = water.cell;
  const hAt = (ix: number, iz: number) => grid.at(ix * W_STEP, iz * W_STEP);
  // Lowest smoothed spot in the inner lands, away from the start.
  let best = -1;
  let bestScore = Infinity;
  for (let iz = 8; iz < N - 8; iz += 6) {
    for (let ix = 8; ix < N - 8; ix += 6) {
      const x = water.minX + ix * wcell;
      const z = water.minZ + iz * wcell;
      if (Math.abs(x) > 650 || Math.abs(z) > 650) continue;
      if (Math.hypot(x - avoid.x, z - avoid.z) < avoid.r) continue;
      let s = 0;
      for (let k = -2; k <= 2; k++) for (let j = -2; j <= 2; j++) s += hAt(ix + j * 3, iz + k * 3);
      const score = s / 25 + rand() * 4;
      if (score < bestScore) [bestScore, best] = [score, iz * N + ix];
    }
  }
  if (best < 0) return null;
  const cx = best % N;
  const cz = (best / N) | 0;

  const minCells = (Math.PI * 55 * 55) / (wcell * wcell);
  const maxCells = (Math.PI * 170 * 170) / (wcell * wcell);
  let level = hAt(cx, cz) + 1.8;
  let mask = new Uint8Array(N * N);
  let count = 0;
  for (let it = 0; it < 40; it++) {
    mask = new Uint8Array(N * N);
    count = 0;
    let escaped = false;
    const stack = [best];
    mask[best] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      count++;
      const x = c % N;
      const z = (c / N) | 0;
      if (Math.abs(water.minX + x * wcell) > 800 || Math.abs(water.minZ + z * wcell) > 800) escaped = true;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const n = nz * N + nx;
        if (!mask[n] && hAt(nx, nz) < level) {
          mask[n] = 1;
          stack.push(n);
        }
      }
    }
    if (count > maxCells || escaped) level -= 0.35;
    else if (count < minCells) level += 0.35;
    else break;
  }
  if (count < minCells * 0.3) return null;

  // Distance to shore (cells), for a bed that deepens toward the middle.
  const dist = new Float32Array(N * N).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < N * N; i++) {
    if (!mask[i]) continue;
    const x = i % N;
    const z = (i / N) | 0;
    const shore = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => !mask[(z + dz) * N + (x + dx)]);
    if (shore) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q];
    const x = c % N;
    const z = (c / N) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = (z + dz) * N + (x + dx);
      if (mask[n] && dist[n] < 0) {
        dist[n] = dist[c] + 1;
        queue.push(n);
      }
    }
  }
  // Deepen the bed: the lake shelves gently, then drops to ~7 m.
  for (let iz = 0; iz < grid.n; iz++) {
    for (let ix = 0; ix < grid.n; ix++) {
      const jx = ix / W_STEP;
      const jz = iz / W_STEP;
      const a = Math.floor(jx);
      const b = Math.floor(jz);
      if (a < 0 || b < 0 || a >= N - 1 || b >= N - 1) continue;
      const i = b * N + a;
      if (!(mask[i] || mask[i + 1] || mask[i + N] || mask[i + N + 1])) continue;
      const fx = jx - a;
      const fz = jz - b;
      const d = (k: number) => Math.max(0, dist[k]);
      const dd = ((d(i) * (1 - fx) + d(i + 1) * fx) * (1 - fz) + (d(i + N) * (1 - fx) + d(i + N + 1) * fx) * fz) * wcell;
      const bed = level - Math.min(7, 0.5 + dd * 0.12);
      if (grid.at(ix, iz) > bed && (mask[i] && mask[i + 1] && mask[i + N] && mask[i + N + 1])) grid.set(ix, iz, bed);
    }
  }
  // Surface: the lake plus a margin (the ground hides what's outside the shore).
  const margin = 3;
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      let near = false;
      for (let k = -margin; k <= margin && !near; k++) for (let j = -margin; j <= margin && !near; j++) {
        const x = ix + j;
        const z = iz + k;
        if (x >= 0 && z >= 0 && x < N && z < N && mask[z * N + x]) near = true;
      }
      if (near) water.level[iz * N + ix] = level;
    }
  }
  return { x: water.minX + cx * wcell, z: water.minZ + cz * wcell, level, area: count * wcell * wcell, mask };
}

/** Press every river into the ground and write its surface and current into the water grid. */
function carve(grid: HeightGrid, water: WaterGrid, rivers: River[], lakeMask: Uint8Array | null): void {
  const G = grid.n;
  const S = new Float32Array(G * G).fill(Infinity); // distance outside the channel edge (negative inside)
  const SL = new Float32Array(G * G);
  const SD = new Float32Array(G * G);
  const SHW = new Float32Array(G * G);
  const FX = new Float32Array(G * G);
  const FZ = new Float32Array(G * G);
  // Far enough for a gorge wall to climb ~60 m before it meets the land.
  const reach = 72;

  const SR = new Int8Array(G * G).fill(-1);
  for (let ri = 0; ri < rivers.length; ri++) {
    const P = rivers[ri].points;
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      const hw = p.width / 2;
      const depth = Math.min(2.4, 0.9 + 0.1 * p.width);
      // Current: along the river, faster where the water surface falls (not counting waterfalls).
      const a = P[Math.max(0, i - 4)];
      const b = P[Math.min(P.length - 1, i + 4)];
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const drop = Math.max(0, a.level - b.level);
      const grad = drop > 3 ? 0 : drop / len;
      const speed = Math.min(3.8, 0.9 + grad * 45);
      const fx = ((b.x - a.x) / len) * speed;
      const fz = ((b.z - a.z) / len) * speed;
      const R = hw + reach;
      const x0 = Math.max(0, Math.floor((p.x - R - grid.minX) / grid.cell));
      const x1 = Math.min(G - 1, Math.ceil((p.x + R - grid.minX) / grid.cell));
      const z0 = Math.max(0, Math.floor((p.z - R - grid.minZ) / grid.cell));
      const z1 = Math.min(G - 1, Math.ceil((p.z + R - grid.minZ) / grid.cell));
      for (let iz = z0; iz <= z1; iz++) {
        const z = grid.minZ + iz * grid.cell;
        for (let ix = x0; ix <= x1; ix++) {
          const x = grid.minX + ix * grid.cell;
          const s = Math.hypot(x - p.x, z - p.z) - hw;
          const k = iz * G + ix;
          // Nearest channel wins; where two channels overlap (a tributary joining), the lower water does.
          const both = s < 0 && S[k] < 0 && SR[k] !== ri;
          if (both ? p.level < SL[k] : s < S[k]) {
            S[k] = s;
            SL[k] = p.level;
            SR[k] = ri;
            SD[k] = depth;
            SHW[k] = hw;
            FX[k] = fx;
            FZ[k] = fz;
          }
        }
      }
    }
  }

  const W = water.n;
  for (let iz = 0; iz < G; iz++) {
    for (let ix = 0; ix < G; ix++) {
      const k = iz * G + ix;
      const s = S[k];
      if (s >= reach) continue;
      const L = SL[k];
      const h = grid.at(ix, iz);
      const inLake = lakeMask && ix % W_STEP === 0 && iz % W_STEP === 0 && lakeMask[(iz / W_STEP) * W + ix / W_STEP];
      let nh: number;
      if (s < 0) {
        const t = (s + SHW[k]) / SHW[k];
        nh = Math.min(h, L - SD[k] * (1 - t * t));
      } else {
        nh = Math.min(h, L + s * WALL_SLOPE);
        // Levee: low ground beside the river is raised a touch so water stays in its bed.
        if (!inLake && s > 0.6 && s < 9 && nh < L + 0.45) nh = L + 0.45 + s * 0.04;
      }
      grid.set(ix, iz, nh);

      if (ix % W_STEP === 0 && iz % W_STEP === 0 && s < 7) {
        const w = (iz / W_STEP) * W + ix / W_STEP;
        // A river reaching the lake keeps the lake's level.
        if (!(water.level[w] === water.level[w]) || water.level[w] < L) {
          if (!(lakeMask && lakeMask[w])) {
            water.level[w] = L;
            water.flowX[w] = FX[k];
            water.flowZ[w] = FZ[k];
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------

type P = { x: number; z: number; f: number };

function chaikin(p: P[]): P[] {
  if (p.length < 3) return p;
  const out: P[] = [p[0]];
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i];
    const b = p[i + 1];
    out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25, f: a.f });
    out.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75, f: b.f });
  }
  out.push(p[p.length - 1]);
  return out;
}

function resample(p: P[], step: number): P[] {
  const out: P[] = [p[0]];
  let carry = 0;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i];
    const b = p[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    let t = step - carry;
    while (t <= len) {
      const u = t / len;
      out.push({ x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, f: u < 0.5 ? a.f : b.f });
      t += step;
    }
    carry = len - (t - step);
  }
  out.push(p[p.length - 1]);
  return out;
}
