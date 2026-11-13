import { MinHeap } from '@ingine/engine/procgen/MinHeap';
import { smoothstep } from '@ingine/engine/procgen/fractal';
import type { WorldMap } from './WorldGen';
import type { Site } from './sites';
import { LINE_STEP } from './hydrology';

export interface RoadPoint {
  x: number;
  z: number;
  /** Height of the road surface. */
  y: number;
  /** On a bridge deck. */
  bridge?: boolean;
}

export interface Road {
  kind: 'road' | 'path';
  width: number;
  points: RoadPoint[];
  /** Site ids (or 'spawn') this stretch was laid between. It may join an older road part-way. */
  from: string;
  to: string;
}

export interface Bridge {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Deck height. */
  y: number;
  width: number;
  length: number;
  /** Water surface under the middle of the span. */
  water: number;
}

export interface RoadNet {
  roads: Road[];
  bridges: Bridge[];
  /** Per grid vertex, 0..1: how much of the ground here is road surface. */
  mask: Float32Array;
}

const ROAD_W = 4.6;
const PATH_W = 2.4;
/** Pathfinding grid: the water grid (4 m). */

/**
 * Roads and paths between the sites:
 *
 * 1. The settlements are joined by the shortest set of roads that links
 *    them all, plus a loop or two where the road would be a long way round.
 *    Camps, ruins and the player's start get narrower paths to the nearest
 *    settlement.
 * 2. Each link is routed by A* over the land. Climbing costs far more than
 *    distance, so routes follow valleys and switchback up steep ground.
 *    Water is expensive (cross once, where it's narrow), and ground that is
 *    already road is cheap, so routes merge into a network instead of
 *    running side by side.
 * 3. Routes are smoothed, their height profile is evened out, and the
 *    surface is pressed into the terrain with soft shoulders.
 * 4. Where a route crosses water it becomes a bridge: a level deck from bank
 *    to bank with the road ramping up to meet it.
 */
export function buildRoads(map: WorldMap, sites: Site[]): RoadNet {
  const g = map.grid;
  const W = map.water;
  const N = W.n;
  const cell = W.cell;
  /** Height-grid cells per pathfinding cell. */
  const STEP = Math.round(W.cell / g.cell);
  const lakeLevel = map.hydro.lake?.level ?? NaN;

  // Per cell: walking height (water surface where wet), and what kind of ground it is.
  const H = new Float32Array(N * N);
  const wetCost = new Float32Array(N * N);
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const i = iz * N + ix;
      const h = g.at(ix * STEP, iz * STEP);
      const wl = W.level[i];
      const wet = wl === wl && wl > h + 0.15;
      H[i] = wet ? wl : h;
      if (wet) {
        const still = W.flowX[i] === 0 && W.flowZ[i] === 0 && Math.abs(wl - lakeLevel) < 0.01;
        wetCost[i] = still ? 400 : 60;
      }
    }
  }
  // Keep off the lips of waterfalls: no bridge belongs there.
  for (const f of map.hydro.falls) {
    const cx = Math.round((f.x - W.minX) / cell);
    const cz = Math.round((f.z - W.minZ) / cell);
    for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) {
      const x = cx + dx;
      const z = cz + dz;
      if (x >= 0 && z >= 0 && x < N && z < N && wetCost[z * N + x]) wetCost[z * N + x] = 400;
    }
  }

  const isRoad = new Uint8Array(N * N);
  /** Surface height of the road through each cell, so later roads join at the right height. */
  const surface = new Float32Array(N * N).fill(NaN);
  const cellOf = (x: number, z: number) => Math.round((z - W.minZ) / cell) * N + Math.round((x - W.minX) / cell);

  // --- 1. Which links to build -------------------------------------------------
  type Node = { id: string; x: number; z: number };
  const settlements: Node[] = sites.filter((s) => s.kind === 'town' || s.kind === 'village');
  const links: { a: Node; b: Node; kind: 'road' | 'path' }[] = [];
  if (settlements.length > 1) {
    // Prim's: grow the tree from the town.
    const inTree = [settlements[0]];
    const rest = settlements.slice(1);
    const treeEdges: [Node, Node][] = [];
    while (rest.length) {
      let best: [Node, number] | null = null;
      let bd = Infinity;
      for (const a of inTree) rest.forEach((b, j) => {
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d < bd) [bd, best] = [d, [a, j]];
      });
      const [a, j] = best!;
      const b = rest.splice(j, 1)[0];
      inTree.push(b);
      treeEdges.push([a, b]);
      links.push({ a, b, kind: 'road' });
    }
    // Loops: pairs that are close as the crow flies but far apart along the tree.
    const hops = (from: Node, to: Node): number => {
      const dist = new Map<Node, number>([[from, 0]]);
      const q = [from];
      while (q.length) {
        const c = q.shift()!;
        for (const [u, v] of treeEdges) {
          const o = u === c ? v : v === c ? u : null;
          if (o && !dist.has(o)) {
            dist.set(o, dist.get(c)! + Math.hypot(u.x - v.x, u.z - v.z));
            q.push(o);
          }
        }
      }
      return dist.get(to) ?? Infinity;
    };
    const extras: { a: Node; b: Node; d: number }[] = [];
    for (let i = 0; i < settlements.length; i++) for (let j = i + 1; j < settlements.length; j++) {
      const a = settlements[i];
      const b = settlements[j];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (!treeEdges.some(([u, v]) => (u === a && v === b) || (u === b && v === a)) && hops(a, b) > d * 2.2) extras.push({ a, b, d });
    }
    extras.sort((p, q) => p.d - q.d);
    for (const e of extras.slice(0, 2)) links.push({ a: e.a, b: e.b, kind: 'road' });
  }
  const nearest = (n: Node, pool: Node[]) => pool.reduce((p, c) => (Math.hypot(c.x - n.x, c.z - n.z) < Math.hypot(p.x - n.x, p.z - n.z) ? c : p));
  if (settlements.length) {
    for (const s of sites) if (s.kind === 'camp' || s.kind === 'ruin') links.push({ a: s, b: nearest(s, settlements), kind: 'path' });
    const start: Node = { id: 'spawn', x: map.spawn.x, z: map.spawn.z };
    links.push({ a: start, b: nearest(start, settlements), kind: 'path' });
  }

  // --- 2. Route each link --------------------------------------------------------
  const gScore = new Float32Array(N * N);
  const came = new Int32Array(N * N);
  const closed = new Uint8Array(N * N);
  const NB: [number, number, number][] = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
  ];
  const margin = Math.round(60 / cell);
  const route = (from: number, to: number): number[] => {
    gScore.fill(Infinity);
    closed.fill(0);
    came.fill(-1);
    const tx = to % N;
    const tz = (to / N) | 0;
    const heap = new MinHeap(4096);
    gScore[from] = 0;
    heap.push(from, 0);
    while (heap.size) {
      const [c] = heap.pop();
      if (c === to) break;
      if (closed[c]) continue;
      closed[c] = 1;
      const cx = c % N;
      const cz = (c / N) | 0;
      for (const [dx, dz, dl] of NB) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < margin || nz < margin || nx >= N - margin || nz >= N - margin) continue;
        const n = nz * N + nx;
        if (closed[n]) continue;
        const d = dl * cell;
        const grade = Math.abs(H[n] - H[c]) / d;
        // Climbing is what costs: a 10% grade doubles the price of a metre, 25% makes it 7x.
        let cost = d * (1 + 100 * grade * grade);
        if (grade > 0.4) cost *= 25;
        cost += wetCost[n];
        if (isRoad[n]) cost *= 0.3;
        const ng = gScore[c] + cost;
        if (ng < gScore[n]) {
          gScore[n] = ng;
          came[n] = c;
          heap.push(n, ng + 0.3 * cell * Math.hypot(nx - tx, nz - tz));
        }
      }
    }
    const out: number[] = [];
    for (let c = to; c !== -1; c = came[c]) out.push(c);
    return out.reverse();
  };

  const roads: Road[] = [];
  const bridges: Bridge[] = [];
  for (const link of links) {
    const cells = route(cellOf(link.a.x, link.a.z), cellOf(link.b.x, link.b.z));
    if (cells.length < 2 || cells[0] !== cellOf(link.a.x, link.a.z)) continue;
    // Only lay the stretches that aren't road yet; each new stretch starts and ends on what's there.
    let run: number[] = [];
    const flush = () => {
      if (run.length >= 2) {
        const road = makeRoad(map, run, link.kind, link.a.id, link.b.id, bridges, surface);
        roads.push(road);
        for (const p of road.points) {
          const c = cellOf(p.x, p.z);
          if (!(surface[c] === surface[c])) surface[c] = p.y;
        }
      }
      run = [];
    };
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (isRoad[c]) {
        if (run.length) {
          run.push(c);
          flush();
        }
      } else {
        if (!run.length && i > 0) run.push(cells[i - 1]);
        run.push(c);
      }
    }
    flush();
    for (const c of cells) isRoad[c] = 1;
  }

  // --- 3. Press into the terrain -------------------------------------------------
  const mask = carve(map, roads);
  // Road heights are final now: read them back so decks, markers and checks agree with the ground.
  for (const r of roads) for (const p of r.points) if (!p.bridge) p.y = g.heightAt(p.x, p.z);
  return { roads, bridges, mask };
}

/** Cells -> a smooth line with an even height profile; water crossings become bridges. */
function makeRoad(map: WorldMap, cells: number[], kind: 'road' | 'path', from: string, to: string, bridges: Bridge[], surface: Float32Array): Road {
  const g = map.grid;
  const W = map.water;
  const N = W.n;
  const width = kind === 'road' ? ROAD_W : PATH_W;
  let line = cells.map((c) => ({ x: W.minX + (c % N) * W.cell, z: W.minZ + ((c / N) | 0) * W.cell }));
  for (let k = 0; k < 3; k++) line = chaikin(line);
  line = resample(line, LINE_STEP);

  const ground = line.map((p) => g.heightAt(p.x, p.z));
  const level = line.map((p, i) => {
    const wl = W.levelAt(p.x, p.z);
    return wl === wl && wl > ground[i] + 0.1 ? wl : NaN;
  });
  const y = ground.slice();
  const pinned = new Uint8Array(line.length);

  // Wet runs, widened onto the banks; close runs merge into one span.
  const spans: [number, number][] = [];
  for (let i = 0; i < line.length; i++) {
    if (!(level[i] === level[i])) continue;
    let j = i;
    while (j + 1 < line.length && level[j + 1] === level[j + 1]) j++;
    const a = Math.max(0, i - 3);
    const b = Math.min(line.length - 1, j + 3);
    const last = spans[spans.length - 1];
    if (last && a - last[1] < 8) last[1] = b;
    else spans.push([a, b]);
    i = j;
  }
  for (const [a, b] of spans) {
    let wl = -Infinity;
    for (let i = a; i <= b; i++) if (level[i] === level[i]) wl = Math.max(wl, level[i]);
    const deck = Math.max(wl + 1.1, ground[a], ground[b]);
    const A = line[a];
    const B = line[b];
    for (let i = a; i <= b; i++) {
      // Straighten the crossing: a bridge is a straight deck.
      const t = (i - a) / (b - a);
      line[i] = { x: A.x + (B.x - A.x) * t, z: A.z + (B.z - A.z) * t };
      y[i] = deck;
      pinned[i] = 1;
    }
    bridges.push({ ax: A.x, az: A.z, bx: B.x, bz: B.z, y: deck, width: width + 0.6, length: Math.hypot(B.x - A.x, B.z - A.z), water: wl });
  }
  // The ends meet whatever is already there (a site's ground, an older road).
  pinned[0] = pinned[line.length - 1] = 1;
  const s0 = surface[cells[0]];
  const s1 = surface[cells[cells.length - 1]];
  if (s0 === s0) y[0] = s0;
  if (s1 === s1) y[line.length - 1] = s1;

  // Even out the profile: average each free point with its neighbours, many times.
  const tmp = new Float32Array(line.length);
  for (let pass = 0; pass < 40; pass++) {
    for (let i = 0; i < line.length; i++) {
      if (pinned[i]) {
        tmp[i] = y[i];
        continue;
      }
      tmp[i] = (y[i - 1] + y[i] * 2 + y[i + 1]) / 4;
    }
    for (let i = 0; i < line.length; i++) y[i] = tmp[i];
  }

  return {
    kind,
    width,
    from,
    to,
    points: line.map((p, i) => ({ x: p.x, z: p.z, y: y[i], ...(pinned[i] && i > 0 && i < line.length - 1 ? { bridge: true } : {}) })),
  };
}

/** Write road heights into the grid with soft shoulders; returns the surface mask. */
function carve(map: WorldMap, roads: Road[]): Float32Array {
  const g = map.grid;
  const G = g.n;
  const D = new Float32Array(G * G).fill(Infinity);
  const Y = new Float32Array(G * G);
  const HW = new Float32Array(G * G);
  const reach = 15;
  for (const r of roads) {
    const hw = r.width / 2;
    for (const p of r.points) {
      const R = hw + reach;
      const x0 = Math.max(0, Math.floor((p.x - R - g.minX) / g.cell));
      const x1 = Math.min(G - 1, Math.ceil((p.x + R - g.minX) / g.cell));
      const z0 = Math.max(0, Math.floor((p.z - R - g.minZ) / g.cell));
      const z1 = Math.min(G - 1, Math.ceil((p.z + R - g.minZ) / g.cell));
      for (let iz = z0; iz <= z1; iz++) {
        const z = g.minZ + iz * g.cell;
        for (let ix = x0; ix <= x1; ix++) {
          const d = Math.hypot(g.minX + ix * g.cell - p.x, z - p.z);
          const k = iz * G + ix;
          // A wide road wins over a path where they meet.
          if (d - hw < D[k] - HW[k]) {
            D[k] = d;
            Y[k] = p.y;
            HW[k] = hw;
          }
        }
      }
    }
  }
  const mask = new Float32Array(G * G);
  for (let k = 0; k < G * G; k++) {
    const d = D[k];
    if (d === Infinity) continue;
    const hw = HW[k];
    const h = g.heights[k];
    // Leave river beds and the lake alone: bridges carry the road there.
    const wl = map.wet[k];
    if (wl === wl && wl > h - 0.05) continue;
    const y = Y[k];
    // The bigger the cut or fill, the wider the shoulder.
    const shoulder = Math.min(reach - 1, 2.5 + Math.abs(y - h) * 1.6);
    const t = smoothstep(d, hw + 0.4, hw + 0.4 + shoulder);
    g.heights[k] = y + (h - y) * t;
    mask[k] = (1 - smoothstep(d, hw - 0.3, hw + 1.1)) * (hw > 2 ? 1 : 0.8);
  }
  return mask;
}

type P = { x: number; z: number };

function chaikin(p: P[]): P[] {
  if (p.length < 3) return p;
  const out: P[] = [p[0]];
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i];
    const b = p[i + 1];
    out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
    out.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
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
    if (len === 0) continue;
    let t = step - carry;
    while (t <= len) {
      const u = t / len;
      out.push({ x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u });
      t += step;
    }
    carry = len - (t - step);
  }
  out.push(p[p.length - 1]);
  return out;
}
