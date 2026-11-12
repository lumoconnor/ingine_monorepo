import { MinHeap } from '@ingine/engine/procgen/MinHeap';
import { mulberry32, subSeed } from '@ingine/engine/procgen/random';
import type { WorldMap } from './WorldGen';
import type { Site } from './sites';

/**
 * Settlement layouts: what stands where in each village and the town.
 * Pure data, made from the seed with the rest of the world; WorldLevel turns
 * it into buildings, doors and people (see buildSettlements.ts).
 *
 * Each settlement follows a template. Buildings line the roads that run
 * through it and face them, ring the square at its middle, then fill in
 * behind, each one only if every door can still be walked to from the square.
 * The town can have a stone wall with gates where the roads come in, and a
 * castle on the side away from the roads.
 */

export type BuildingKind = 'cottage' | 'house' | 'longhouse' | 'barn' | 'inn' | 'smithy' | 'hall' | 'chapel' | 'keep';

export interface Building {
  id: string;
  kind: BuildingKind;
  x: number;
  z: number;
  /** 0 = front (door) faces +Z. */
  yaw: number;
  w: number;
  d: number;
  floorY: number;
  groundY: number;
  doorGroundY: number;
  wallH: number;
  roofH: number;
  roof: 'gable' | 'flat';
  ridgeAcross: boolean;
  /** Enterable buildings have a door and an inside. */
  enterable: boolean;
  chimney: boolean;
  crenels: boolean;
  /** Index into the settlement's palette. */
  style: number;
  /** Where to stand outside the door (villager paths use it). */
  front: [number, number];
}

export interface Tower {
  x: number;
  z: number;
  yaw: number;
  size: number;
  height: number;
  groundY: number;
  roofed: boolean;
}

export interface WallLine {
  from: [number, number];
  to: [number, number];
  height: number;
  thickness: number;
}

export interface Prop {
  kind: 'well' | 'stall' | 'fence';
  x: number;
  z: number;
  yaw: number;
  y: number;
  /** Fences: the far end. */
  to?: [number, number];
  color?: number;
}

export type VillagerRole = 'villager' | 'guard' | 'merchant';

export interface Villager {
  id: string;
  name: string;
  role: VillagerRole;
  dialogue: string;
  color: number;
  skin: number;
  hat?: { color: number; kind: 'cap' | 'helm' | 'hood' };
  /** Standing spot (guards, merchants) or the first point of their walk. */
  x: number;
  z: number;
  facing: number;
  /** A loop to walk, or empty to stand still. */
  path: [number, number][];
  stops: number[];
}

export interface Settlement {
  site: string;
  template: string;
  /** "a walled town with a castle", for the map and dialogue. */
  describe: string;
  square: { x: number; z: number; r: number };
  buildings: Building[];
  towers: Tower[];
  walls: WallLine[];
  props: Prop[];
  villagers: Villager[];
  palette: Palette[];
}

export interface Palette {
  wall: number;
  roof: number;
  trim: number;
  base: number;
}

const VILLAGE_PALETTES: Palette[] = [
  { wall: 0xd9ccb0, roof: 0xb39556, trim: 0x5e4630, base: 0x8a8479 },
  { wall: 0xcdb791, roof: 0x9c8248, trim: 0x4f3a28, base: 0x7f796f },
  { wall: 0xe3d9c4, roof: 0x6f4b36, trim: 0x5a4330, base: 0x8a8479 },
  { wall: 0xb89f7c, roof: 0xa88b4c, trim: 0x463325, base: 0x77726a },
];
const TOWN_PALETTES: Palette[] = [
  { wall: 0xe0d5bd, roof: 0x9a4a32, trim: 0x4f3a28, base: 0x8d8a82 },
  { wall: 0xd2c3a3, roof: 0x8a3f2c, trim: 0x5a4330, base: 0x8d8a82 },
  { wall: 0xa9a49a, roof: 0x4f5660, trim: 0x3e3a35, base: 0x7d7a73 },
  { wall: 0xe8dfcc, roof: 0x5b4334, trim: 0x4f3a28, base: 0x8d8a82 },
  { wall: 0xc4b08a, roof: 0x9a4a32, trim: 0x463325, base: 0x8d8a82 },
];
export const STONE = 0xa9a49a;
export const STONE_DARK = 0x86817a;
const STALL_CLOTH = [0xb5452f, 0x3f6fa0, 0xd6b24a, 0x5d8a4a, 0x8a4f8a, 0xe2e0d6];

interface Template {
  name: string;
  describe: string;
  squareR: number;
  /** Building sizes to draw from, with weights. */
  kinds: [BuildingKind, number][];
  /** How many buildings to aim for: [min, max]. */
  count: [number, number];
  villagers: [number, number];
  walled: boolean;
  castle: boolean;
  stalls: number;
  /** Fenced paddocks behind some buildings. */
  paddocks: boolean;
}

const VILLAGE_TEMPLATES: Template[] = [
  {
    name: 'green', describe: 'a village around a green', squareR: 9,
    kinds: [['cottage', 5], ['house', 3], ['longhouse', 1], ['smithy', 1], ['inn', 1]],
    count: [7, 11], villagers: [4, 6], walled: false, castle: false, stalls: 0, paddocks: false,
  },
  {
    name: 'roadside', describe: 'a village strung along the road', squareR: 6,
    kinds: [['cottage', 4], ['house', 4], ['inn', 1], ['smithy', 1]],
    count: [6, 10], villagers: [3, 5], walled: false, castle: false, stalls: 1, paddocks: false,
  },
  {
    name: 'farmstead', describe: 'a farming hamlet', squareR: 7,
    kinds: [['cottage', 3], ['longhouse', 2], ['barn', 3]],
    count: [5, 8], villagers: [3, 4], walled: false, castle: false, stalls: 0, paddocks: true,
  },
];

const TOWN_TEMPLATES: Template[] = [
  {
    name: 'walled-castle', describe: 'a walled town with a castle', squareR: 15,
    kinds: [['house', 6], ['cottage', 2], ['longhouse', 2], ['inn', 1], ['smithy', 1]],
    count: [24, 34], villagers: [10, 14], walled: true, castle: true, stalls: 6, paddocks: false,
  },
  {
    name: 'walled-market', describe: 'a walled market town', squareR: 16,
    kinds: [['house', 6], ['cottage', 2], ['longhouse', 2], ['inn', 2], ['smithy', 1]],
    count: [26, 36], villagers: [10, 14], walled: true, castle: false, stalls: 8, paddocks: false,
  },
  {
    name: 'open-market', describe: 'an open market town', squareR: 16,
    kinds: [['house', 6], ['cottage', 3], ['longhouse', 2], ['inn', 2], ['smithy', 1], ['barn', 1]],
    count: [24, 34], villagers: [10, 14], walled: false, castle: false, stalls: 8, paddocks: true,
  },
  {
    name: 'castle-town', describe: 'a market town under a castle', squareR: 14,
    kinds: [['house', 5], ['cottage', 3], ['longhouse', 2], ['inn', 1], ['smithy', 1]],
    count: [22, 30], villagers: [10, 13], walled: false, castle: true, stalls: 5, paddocks: false,
  },
];

/** Footprint ranges per kind: [wMin, wMax, dMin, dMax, wallH, storeys]. */
const SIZES: Record<BuildingKind, [number, number, number, number, number]> = {
  cottage: [5, 6.5, 5, 6, 2.9],
  house: [6, 8, 6.5, 8.5, 5.4],
  longhouse: [6, 7, 10, 13, 3.1],
  barn: [7, 9, 9, 12, 4.2],
  inn: [9, 11, 8, 10, 5.6],
  smithy: [6, 7, 6, 7.5, 3.1],
  hall: [12, 14, 9, 11, 6.2],
  chapel: [7, 8, 12, 14, 6.5],
  keep: [11, 12, 11, 12, 13],
};

const FIRST = ['Ada', 'Bren', 'Cass', 'Dov', 'Edda', 'Finn', 'Gwen', 'Hob', 'Isla', 'Jory', 'Kit', 'Lena', 'Mott', 'Nell', 'Oda', 'Pip', 'Quin', 'Rook', 'Sela', 'Tam', 'Ula', 'Vey', 'Wynn', 'Yuri', 'Ansel', 'Berta', 'Col', 'Dara', 'Ewan', 'Fay', 'Gil', 'Hester', 'Ivo', 'Joan', 'Lark', 'Mabry', 'Ned', 'Orla', 'Perrin', 'Rosa', 'Silas', 'Tilda', 'Wat'];
const CLOTHES = [0x7a5c3e, 0x5d6b4a, 0x8a6f4b, 0x6b4f6b, 0x4d6278, 0x9a7b55, 0x7d4f3a, 0x5b6f6a, 0xa38c63, 0x6e5a48];
const SKINS = [0xe8c2a0, 0xd9a983, 0xc68f66, 0xa8714d, 0x8a5a3c, 0xf0d0b4];
const GUARD = 0x7d2f2a;

/** Size of a layout cell, metres. */
const CELL = 1;
// Cell states.
const FREE = 0;
const ROAD = 1;
const SQUARE = 2;
const BUILT = 3;
const OUT = 4;

/** Lay out every village and the town. */
export function layoutSettlements(map: WorldMap, sites: Site[]): Settlement[] {
  const out: Settlement[] = [];
  const used = new Set<string>();
  for (const s of sites) {
    if (s.kind !== 'village' && s.kind !== 'town') continue;
    out.push(layout(map, s, used));
  }
  return out;
}

function layout(map: WorldMap, site: Site, usedNames: Set<string>): Settlement {
  const rand = mulberry32(subSeed(map.seed, 'settle:' + site.id));
  const pick = <T>(a: T[]): T => a[Math.floor(rand() * a.length)];
  const between = (a: number, b: number) => a + rand() * (b - a);
  const town = site.kind === 'town';
  const tpl = pick(town ? TOWN_TEMPLATES : VILLAGE_TEMPLATES);
  const palette = town ? TOWN_PALETTES : VILLAGE_PALETTES;
  const R = site.radius;
  const g = map.grid;
  const ground = (x: number, z: number) => g.heightAt(x, z);

  // --- The layout grid ---------------------------------------------------
  const N = Math.ceil((2 * (R + 6)) / CELL);
  const ox = site.x - (N * CELL) / 2;
  const oz = site.z - (N * CELL) / 2;
  const cells = new Uint8Array(N * N);
  const cx = (i: number) => ox + (i + 0.5) * CELL;
  const cz = (j: number) => oz + (j + 0.5) * CELL;
  const toCell = (x: number, z: number) => {
    const i = Math.floor((x - ox) / CELL);
    const j = Math.floor((z - oz) / CELL);
    return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
  };
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = cx(i);
      const z = cz(j);
      const wet = map.water.sample(x, ground(x, z) + 0.2, z, 0);
      if (Math.hypot(x - site.x, z - site.z) > R + 4 || wet) cells[j * N + i] = OUT;
    }
  }
  /** Mark every cell within `r` of segment a-b. */
  const stamp = (ax: number, az: number, bx: number, bz: number, r: number, v: number, only?: number) => {
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - r - ox) / CELL));
    const i1 = Math.min(N - 1, Math.floor((Math.max(ax, bx) + r - ox) / CELL));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - r - oz) / CELL));
    const j1 = Math.min(N - 1, Math.floor((Math.max(az, bz) + r - oz) / CELL));
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const px = cx(i);
        const pz = cz(j);
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
        if (Math.hypot(px - ax - dx * t, pz - az - dz * t) > r) continue;
        const k = j * N + i;
        if (only !== undefined && cells[k] !== only) continue;
        cells[k] = v;
      }
    }
  };

  // Roads through the site.
  const roadLines: { pts: { x: number; z: number }[]; hw: number }[] = [];
  for (const r of map.net.roads) {
    const pts = r.points.filter((p) => Math.hypot(p.x - site.x, p.z - site.z) < R + 12);
    if (pts.length < 2) continue;
    for (let k = 1; k < r.points.length; k++) {
      const a = r.points[k - 1];
      const b = r.points[k];
      if (Math.hypot(a.x - site.x, a.z - site.z) > R + 12 && Math.hypot(b.x - site.x, b.z - site.z) > R + 12) continue;
      stamp(a.x, a.z, b.x, b.z, r.width / 2 + 1.2, ROAD);
    }
    roadLines.push({ pts: r.points.map((p) => ({ x: p.x, z: p.z })), hw: r.width / 2 });
  }
  // The square.
  const sq = { x: site.x, z: site.z, r: tpl.squareR };
  stamp(sq.x, sq.z, sq.x, sq.z, sq.r, SQUARE);

  const buildings: Building[] = [];
  const towers: Tower[] = [];
  const walls: WallLine[] = [];
  const props: Prop[] = [];

  /** Inner limit for buildings (inside the town wall, on the flattened ground). */
  const wallR = R - 3;
  const buildR = tpl.walled ? wallR - 3.5 : R - 2;

  // --- Footprints ----------------------------------------------------------
  /** Cells covered by a rotated rectangle grown by `m`. */
  const footprint = (x: number, z: number, yaw: number, w: number, d: number, m: number): number[] | null => {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const ext = Math.hypot(w, d) / 2 + m;
    const ks: number[] = [];
    for (let j = Math.floor((z - ext - oz) / CELL); j <= Math.floor((z + ext - oz) / CELL); j++) {
      for (let i = Math.floor((x - ext - ox) / CELL); i <= Math.floor((x + ext - ox) / CELL); i++) {
        if (i < 0 || j < 0 || i >= N || j >= N) return null;
        const dx = cx(i) - x;
        const dz = cz(j) - z;
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        if (Math.abs(lx) <= w / 2 + m && Math.abs(lz) <= d / 2 + m) ks.push(j * N + i);
      }
    }
    return ks;
  };
  const local = (x: number, z: number, yaw: number, lx: number, lz: number): [number, number] => [
    x + lx * Math.cos(yaw) + lz * Math.sin(yaw),
    z - lx * Math.sin(yaw) + lz * Math.cos(yaw),
  ];
  /** Is every cell free (and within the build radius)? */
  const clear = (ks: number[] | null): boolean => {
    if (!ks) return false;
    for (const k of ks) {
      if (cells[k] !== FREE) return false;
      const i = k % N;
      const j = (k - i) / N;
      if (Math.hypot(cx(i) - site.x, cz(j) - site.z) > buildR) return false;
    }
    return true;
  };

  // --- Reachability: can you still walk to every door? ---------------------
  const fronts: number[] = [];
  const reachable = (extra: number[], blocked: number[]): boolean => {
    const blockedSet = new Set(blocked);
    const seen = new Uint8Array(N * N);
    // Start on open ground near the middle of the square (the well is at its very centre).
    let start = -1;
    for (let q = 0; q < 16 && start < 0; q++) {
      const a = (q / 16) * Math.PI * 2;
      const k = toCell(sq.x + Math.cos(a) * 3, sq.z + Math.sin(a) * 3);
      if (k >= 0 && cells[k] !== BUILT && cells[k] !== OUT && !blockedSet.has(k)) start = k;
    }
    if (start < 0) return false;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      const i = k % N;
      const j = (k - i) / N;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const nk = nj * N + ni;
        if (seen[nk] || cells[nk] === BUILT || cells[nk] === OUT || blockedSet.has(nk)) continue;
        seen[nk] = 1;
        stack.push(nk);
      }
    }
    return [...fronts, ...extra].every((k) => seen[k]);
  };

  let doorSeq = 0;
  /** Try to put a building here; true if it fits and every door stays reachable. */
  const tryPlace = (kind: BuildingKind, x: number, z: number, yaw: number, w: number, d: number, opts: { enterable?: boolean; style?: number; roof?: 'gable' | 'flat'; crenels?: boolean } = {}): Building | null => {
    const ks = footprint(x, z, yaw, w, d, 0.8);
    if (!clear(ks)) return null;
    // The spot in front of the door must be open ground.
    const front = local(x, z, yaw, 0, d / 2 + 1.8);
    const fk = toCell(front[0], front[1]);
    if (fk < 0 || cells[fk] === BUILT || cells[fk] === OUT) return null;
    if (!reachable([fk], ks!)) return null;
    for (const k of ks!) cells[k] = BUILT;
    // Keep the doorstep clear of later buildings.
    const step = footprint(front[0], front[1], yaw, 2.2, 2.4, 0)!;
    for (const k of step) if (cells[k] === FREE) cells[k] = ROAD;
    fronts.push(fk);

    let lo = Infinity;
    let hi = -Infinity;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) {
      const [px, pz] = local(x, z, yaw, (sx * w) / 2, (sz * d) / 2);
      const h = ground(px, pz);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    const [, , , , wallH] = SIZES[kind];
    const b: Building = {
      id: `${site.id}:${kind}-${doorSeq++}`,
      kind, x, z, yaw, w, d,
      floorY: hi + 0.15,
      groundY: lo,
      doorGroundY: ground(...local(x, z, yaw, 0, d / 2 + 0.8)),
      wallH,
      roofH: kind === 'barn' ? w * 0.5 : Math.min(w, d) * between(0.38, 0.5),
      roof: opts.roof ?? 'gable',
      ridgeAcross: kind !== 'longhouse' && kind !== 'barn' && kind !== 'chapel' && rand() < 0.5,
      enterable: opts.enterable ?? kind !== 'barn',
      chimney: kind !== 'barn' && kind !== 'chapel' && opts.roof !== 'flat' && rand() < 0.6,
      crenels: !!opts.crenels,
      style: opts.style ?? Math.floor(rand() * palette.length),
      front,
    };
    buildings.push(b);
    return b;
  };
  const size = (kind: BuildingKind): [number, number] => {
    const [w0, w1, d0, d1] = SIZES[kind];
    return [between(w0, w1), between(d0, d1)];
  };
  const kindPick = (): BuildingKind => {
    const total = tpl.kinds.reduce((s, [, w]) => s + w, 0);
    let t = rand() * total;
    for (const [k, w] of tpl.kinds) if ((t -= w) <= 0) return k;
    return tpl.kinds[0][0];
  };
  // Inns and smithies: at most one or two each.
  const counts: Partial<Record<BuildingKind, number>> = {};
  const limit: Partial<Record<BuildingKind, number>> = { inn: town ? 2 : 1, smithy: 1 };
  const nextKind = (): BuildingKind => {
    for (let t = 0; t < 10; t++) {
      const k = kindPick();
      if ((counts[k] ?? 0) < (limit[k] ?? Infinity)) return k;
    }
    return 'cottage';
  };
  const placed = (b: Building | null) => {
    if (b) counts[b.kind] = (counts[b.kind] ?? 0) + 1;
    return b;
  };

  // --- Town wall and gates ---------------------------------------------------
  /** Angles (from the centre) where roads leave the site. */
  const exits: number[] = [];
  for (const l of roadLines) {
    for (let k = 1; k < l.pts.length; k++) {
      const a = l.pts[k - 1];
      const b = l.pts[k];
      const da = Math.hypot(a.x - site.x, a.z - site.z);
      const db = Math.hypot(b.x - site.x, b.z - site.z);
      if ((da - wallR) * (db - wallR) <= 0) {
        const t = (wallR - da) / (db - da || 1);
        exits.push(Math.atan2(a.z + (b.z - a.z) * t - site.z, a.x + (b.x - a.x) * t - site.x));
      }
    }
  }
  if (tpl.walled) {
    const sides = 16;
    const gateHalf = 4.5 / wallR; // radians either side of a road
    const gate = (a: number) => exits.some((e) => Math.abs(Math.atan2(Math.sin(a - e), Math.cos(a - e))) < gateHalf + 0.02);
    const P = (a: number): [number, number] => [site.x + Math.cos(a) * wallR, site.z + Math.sin(a) * wallR];
    const ground0 = site.y;
    const a0 = rand() * Math.PI * 2;
    for (let k = 0; k < sides; k++) {
      const aA = a0 + (k / sides) * Math.PI * 2;
      const aB = a0 + ((k + 1) / sides) * Math.PI * 2;
      // Split this side around any gates; walk it in small steps.
      let runStart: number | null = null;
      const STEPS = 24;
      for (let q = 0; q <= STEPS; q++) {
        const a = aA + ((aB - aA) * q) / STEPS;
        const open = gate(a);
        if (!open && runStart === null) runStart = a;
        if ((open || q === STEPS) && runStart !== null) {
          const end = open ? aA + ((aB - aA) * (q - 1)) / STEPS : a;
          if (end > runStart + 1e-4) walls.push({ from: P(runStart), to: P(end), height: 6, thickness: 2.2 });
          if (open) {
            // Gate towers either side of the opening.
            const e = exits.find((x) => Math.abs(Math.atan2(Math.sin(a - x), Math.cos(a - x))) < gateHalf + 0.03)!;
            for (const s of [-1, 1]) {
              const ta = e + s * (gateHalf + 2.2 / wallR);
              const [tx, tz] = P(ta);
              if (!towers.some((t) => Math.hypot(t.x - tx, t.z - tz) < 3)) {
                towers.push({ x: tx, z: tz, yaw: -ta, size: 4.4, height: 9, groundY: Math.min(ground(tx, tz), ground0), roofed: true });
              }
            }
          }
          runStart = null;
        }
      }
      // Corner towers, unless a gate is right there.
      const [tx, tz] = P(aA);
      if (!gate(aA) && !towers.some((t) => Math.hypot(t.x - tx, t.z - tz) < 8)) {
        towers.push({ x: tx, z: tz, yaw: -aA, size: 3.6, height: 7.5, groundY: ground(tx, tz), roofed: k % 4 === 0 });
      }
    }
    for (const w of walls) stamp(w.from[0], w.from[1], w.to[0], w.to[1], w.thickness / 2 + 0.6, BUILT);
    for (const t of towers) stamp(t.x, t.z, t.x, t.z, t.size * 0.75, BUILT);
  }

  // --- Castle ---------------------------------------------------------------
  let castle: { x: number; z: number; yaw: number; half: number; gate: [number, number] } | null = null;
  if (tpl.castle) {
    // On the side of town furthest from any road.
    let best = 0;
    let bestGap = -1;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 24) {
      const gap = exits.length ? Math.min(...exits.map((e) => Math.abs(Math.atan2(Math.sin(a - e), Math.cos(a - e))))) : Math.PI;
      if (gap > bestGap) {
        bestGap = gap;
        best = a;
      }
    }
    const half = 12;
    for (const dist of [R * 0.52, R * 0.46, R * 0.58, R * 0.4]) {
      const x = site.x + Math.cos(best) * dist;
      const z = site.z + Math.sin(best) * dist;
      // The castle gate faces the town centre.
      const yaw = Math.atan2(site.x - x, site.z - z);
      const ks = footprint(x, z, yaw, half * 2 + 2, half * 2 + 2, 0);
      if (!ks || ks.some((k) => cells[k] !== FREE)) continue;
      if (ks.some((k) => Math.hypot(cx(k % N) - site.x, cz(Math.floor(k / N)) - site.z) > (tpl.walled ? wallR - 2 : R + 2))) continue;
      castle = { x, z, yaw, half, gate: local(x, z, yaw, 0, half + 2.5) };
      break;
    }
    if (castle) {
      const { x, z, yaw, half: h } = castle;
      const corner = (lx: number, lz: number) => local(x, z, yaw, lx, lz);
      const cg = Math.min(...[[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]].map(([a, b]) => ground(...corner(a * h, b * h))));
      // Curtain wall, gate in the front (local +Z) side.
      const cw = (a: [number, number], b: [number, number]) => walls.push({ from: corner(...a), to: corner(...b), height: 7, thickness: 2 });
      cw([-h, -h], [h, -h]);
      cw([-h, -h], [-h, h]);
      cw([h, -h], [h, h]);
      cw([-h, h], [-3.2, h]);
      cw([3.2, h], [h, h]);
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const [tx, tz] = corner(a * h, b * h);
        towers.push({ x: tx, z: tz, yaw, size: 4.6, height: 10, groundY: cg, roofed: b < 0 });
      }
      for (const s of [-1, 1]) {
        const [tx, tz] = corner(s * 5, h);
        towers.push({ x: tx, z: tz, yaw, size: 3.6, height: 9, groundY: cg, roofed: true });
      }
      // Block the castle's walls; the yard inside stays walkable.
      for (const [a, b] of [[[-h, -h], [h, -h]], [[-h, -h], [-h, h]], [[h, -h], [h, h]], [[-h, h], [-3.2, h]], [[3.2, h], [h, h]]] as [number, number][][]) {
        const p = corner(...a);
        const q = corner(...b);
        stamp(p[0], p[1], q[0], q[1], 1.2, BUILT);
      }
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const [tx, tz] = corner(a * h, b * h);
        stamp(tx, tz, tx, tz, 3.4, BUILT);
      }
      for (const s of [-1, 1]) {
        const [tx, tz] = corner(s * 5, h);
        stamp(tx, tz, tx, tz, 2.0, BUILT);
      }
      // A lane from the town to the castle gate, and the yard.
      stamp(castle.gate[0], castle.gate[1], sq.x, sq.z, 2.2, ROAD, FREE);
      const yard = footprint(x, z, yaw, 2 * h - 3, 2 * h - 3, 0)!;
      for (const k of yard) if (cells[k] === FREE) cells[k] = SQUARE;
      // The keep at the back of the yard, its door to the gate.
      const [kx, kz] = corner(0, -h + 7.5);
      for (const k of footprint(kx, kz, yaw, 12, 12, 0.6)!) if (cells[k] === SQUARE) cells[k] = FREE;
      const keep = tryPlace('keep', kx, kz, yaw, 11, 11, { enterable: true, roof: 'flat', crenels: true, style: 0 });
      if (keep) keep.chimney = false;
    }
  }

  // --- Landmarks on the square --------------------------------------------------
  const facing = (x: number, z: number) => Math.atan2(sq.x - x, sq.z - z);
  /** A spot on the edge of the square, facing in, away from the roads. */
  const squareEdge = (dist: number, avoid: number[]): number => {
    let best = 0;
    let bestGap = -1;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 36) {
      const gap = Math.min(Math.PI, ...[...exits, ...avoid].map((e) => Math.abs(Math.atan2(Math.sin(a - e), Math.cos(a - e)))));
      if (gap > bestGap) {
        bestGap = gap;
        best = a;
      }
    }
    void dist;
    return best;
  };
  const landmarkAngles: number[] = [];
  if (town) {
    const kinds: BuildingKind[] = castle ? ['hall'] : ['hall', 'chapel'];
    for (const kind of kinds) {
      const a = squareEdge(0, landmarkAngles);
      const [w, d] = size(kind);
      const dist = sq.r + 1.5 + d / 2;
      const x = sq.x + Math.cos(a) * dist;
      const z = sq.z + Math.sin(a) * dist;
      if (placed(tryPlace(kind, x, z, facing(x, z), w, d, { style: kind === 'chapel' ? 2 : 0 }))) landmarkAngles.push(a);
    }
  }
  // Well in the middle; stalls around the square.
  props.push({ kind: 'well', x: sq.x, z: sq.z, yaw: 0, y: ground(sq.x, sq.z) });
  stamp(sq.x, sq.z, sq.x, sq.z, 1.6, BUILT);
  const stallSpots: { x: number; z: number; yaw: number }[] = [];
  for (let k = 0; k < tpl.stalls; k++) {
    const a = (k / Math.max(1, tpl.stalls)) * Math.PI * 2 + rand() * 0.3;
    const r = sq.r * 0.62;
    const x = sq.x + Math.cos(a) * r;
    const z = sq.z + Math.sin(a) * r;
    const ks = footprint(x, z, facing(x, z), 3.0, 2.4, 0.3);
    if (!ks || ks.some((q) => cells[q] !== SQUARE)) continue;
    // Stalls must not cut the square in two.
    const yaw = facing(x, z) + Math.PI; // counter faces outward, to the passers-by
    for (const q of ks) cells[q] = BUILT;
    if (!reachable([], [])) {
      for (const q of ks) cells[q] = SQUARE;
      continue;
    }
    props.push({ kind: 'stall', x, z, yaw, y: ground(x, z), color: pick(STALL_CLOTH) });
    stallSpots.push({ x, z, yaw });
  }

  // --- Buildings along the roads, then round the square, then behind --------------
  const target = Math.round(between(...tpl.count));
  const total = () => buildings.filter((b) => b.kind !== 'keep').length;
  for (const l of roadLines) {
    for (const side of [-1, 1]) {
      let gapLeft = 2 + rand() * 4;
      for (let k = 1; k < l.pts.length && total() < target; k++) {
        const a = l.pts[k - 1];
        const b = l.pts[k];
        const seg = Math.hypot(b.x - a.x, b.z - a.z);
        if (seg < 1e-3) continue;
        const tx = (b.x - a.x) / seg;
        const tz = (b.z - a.z) / seg;
        // Normal toward this side.
        const nx = -tz * side;
        const nz = tx * side;
        let s = 0;
        while (s < seg) {
          const px = a.x + tx * s;
          const pz = a.z + tz * s;
          const dc = Math.hypot(px - sq.x, pz - sq.z);
          if (dc < sq.r + 2 || dc > buildR) {
            s += 1;
            continue;
          }
          if (gapLeft > 0) {
            gapLeft -= 1;
            s += 1;
            continue;
          }
          const kind = nextKind();
          const [w, d] = size(kind);
          const off = l.hw + 2.2 + d / 2;
          const x = px + nx * off + tx * (w / 2);
          const z = pz + nz * off + tz * (w / 2);
          const yaw = Math.atan2(-nx, -nz);
          if (placed(tryPlace(kind, x, z, yaw, w, d))) {
            s += w + 1.5;
            gapLeft = rand() < 0.25 ? 3 + rand() * 6 : rand() * 2;
          } else s += 1.5;
        }
      }
    }
  }
  // Round the square.
  for (let tries = 0; tries < 40 && total() < target; tries++) {
    const a = rand() * Math.PI * 2;
    const kind = nextKind();
    const [w, d] = size(kind);
    const dist = sq.r + 2.4 + d / 2;
    const x = sq.x + Math.cos(a) * dist;
    const z = sq.z + Math.sin(a) * dist;
    placed(tryPlace(kind, x, z, facing(x, z), w, d));
  }
  // Infill: anywhere left, facing the nearest open ground.
  for (let tries = 0; tries < 400 && total() < target; tries++) {
    const a = rand() * Math.PI * 2;
    const dist = sq.r + 6 + rand() * (buildR - sq.r - 6);
    const x = sq.x + Math.cos(a) * dist;
    const z = sq.z + Math.sin(a) * dist;
    const kind = nextKind();
    const [w, d] = size(kind);
    const base = facing(x, z) + Math.round(rand() * 4) * (Math.PI / 2) * (rand() < 0.5 ? 1 : 0);
    for (const turn of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
      if (placed(tryPlace(kind, x, z, base + turn, w, d))) break;
    }
  }
  // Paddocks: fenced yards behind barns and longhouses.
  if (tpl.paddocks) {
    for (const b of buildings) {
      if (b.kind !== 'barn' && b.kind !== 'longhouse') continue;
      const pw = b.w + 4;
      const pd = 8 + rand() * 4;
      const [px, pz] = local(b.x, b.z, b.yaw, 0, -(b.d / 2 + 1.5 + pd / 2));
      const ks = footprint(px, pz, b.yaw, pw, pd, 0.5);
      if (!clear(ks)) continue;
      for (const k of ks!) cells[k] = BUILT;
      if (!reachable([], [])) {
        for (const k of ks!) cells[k] = FREE;
        continue;
      }
      const c = (lx: number, lz: number) => local(px, pz, b.yaw, lx, lz);
      const corners = [c(-pw / 2, -pd / 2), c(pw / 2, -pd / 2), c(pw / 2, pd / 2), c(-pw / 2, pd / 2)];
      for (let q = 0; q < 4; q++) {
        const p = corners[q];
        const n = corners[(q + 1) % 4];
        props.push({ kind: 'fence', x: p[0], z: p[1], to: n, yaw: 0, y: 0 });
      }
    }
  }

  // --- People ---------------------------------------------------------------
  const walkable = (k: number) => cells[k] !== BUILT && cells[k] !== OUT;
  // Keep walkers a little off the walls: one cell of clearance from buildings.
  const clearance = new Uint8Array(N * N);
  for (let k = 0; k < N * N; k++) {
    if (!walkable(k)) continue;
    const i = k % N;
    const j = (k - i) / N;
    let ok = 1;
    for (let dj = -1; dj <= 1 && ok; dj++) for (let di = -1; di <= 1; di++) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= N || nj >= N || !walkable(nj * N + ni)) {
        ok = 0;
        break;
      }
    }
    clearance[k] = ok;
  }
  const route = (from: [number, number], to: [number, number]): [number, number][] | null => {
    const s = nearestOpen(toCell(...from));
    const t = nearestOpen(toCell(...to));
    if (s < 0 || t < 0) return null;
    const cost = new Float64Array(N * N).fill(Infinity);
    const prev = new Int32Array(N * N).fill(-1);
    const done = new Uint8Array(N * N);
    const heap = new MinHeap(1024);
    cost[s] = 0;
    heap.push(s, 0);
    const tx = t % N;
    const tz = (t - tx) / N;
    while (heap.size) {
      const [k] = heap.pop();
      if (done[k]) continue;
      done[k] = 1;
      if (k === t) break;
      const i = k % N;
      const j = (k - i) / N;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const nk = nj * N + ni;
        if (!clearance[nk]) continue;
        // No corner cutting.
        if (di && dj && (!clearance[j * N + ni] || !clearance[nj * N + i])) continue;
        const c = cost[k] + (di && dj ? 1.414 : 1) * (cells[nk] === ROAD || cells[nk] === SQUARE ? 1 : 1.6);
        if (c < cost[nk]) {
          cost[nk] = c;
          prev[nk] = k;
          heap.push(nk, c + Math.hypot(ni - tx, nj - tz));
        }
      }
    }
    if (prev[t] < 0 && s !== t) return null;
    const ks: number[] = [];
    for (let k = t; k >= 0; k = prev[k]) {
      ks.push(k);
      if (k === s) break;
    }
    ks.reverse();
    // String-pull: keep only the corners.
    const pts: [number, number][] = [];
    let anchor = 0;
    pts.push([cx(ks[0] % N), cz(Math.floor(ks[0] / N))]);
    for (let q = 2; q < ks.length; q++) {
      if (!sight(ks[anchor], ks[q])) {
        anchor = q - 1;
        pts.push([cx(ks[anchor] % N), cz(Math.floor(ks[anchor] / N))]);
      }
    }
    const last = ks[ks.length - 1];
    pts.push([cx(last % N), cz(Math.floor(last / N))]);
    return pts;
  };
  function nearestOpen(k: number): number {
    if (k < 0) return -1;
    if (clearance[k]) return k;
    const i = k % N;
    const j = (k - i) / N;
    for (let r = 1; r < 6; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        const ni = i + di;
        const nj = j + dj;
        if (ni >= 0 && nj >= 0 && ni < N && nj < N && clearance[nj * N + ni]) return nj * N + ni;
      }
    }
    return -1;
  }
  function sight(a: number, b: number): boolean {
    const ai = a % N;
    const aj = (a - ai) / N;
    const bi = b % N;
    const bj = (b - bi) / N;
    const steps = Math.ceil(Math.hypot(bi - ai, bj - aj) * 3);
    for (let q = 1; q < steps; q++) {
      const t = q / steps;
      const i = Math.round(ai + (bi - ai) * t);
      const j = Math.round(aj + (bj - aj) * t);
      if (!clearance[j * N + i]) return false;
    }
    return true;
  }

  const villagers: Villager[] = [];
  const nameOf = (): string => {
    for (let t = 0; t < 50; t++) {
      const n = pick(FIRST);
      if (!usedNames.has(n)) {
        usedNames.add(n);
        return n;
      }
    }
    for (;;) {
      const n = pick(FIRST) + ' ' + pick(['Miller', 'Cooper', 'Thatcher', 'Fletcher', 'Mason', 'Wright', 'Tanner', 'Weaver', 'Carter', 'Shepherd']);
      if (!usedNames.has(n)) {
        usedNames.add(n);
        return n;
      }
    }
  };
  const homes = buildings.filter((b) => b.enterable && b.kind !== 'keep');
  const want = Math.round(between(...tpl.villagers));
  const plaza = (): [number, number] => {
    const a = rand() * Math.PI * 2;
    const r = 2.5 + rand() * (sq.r - 3);
    return [sq.x + Math.cos(a) * r, sq.z + Math.sin(a) * r];
  };
  let vid = 0;
  for (let n = 0; n < want && homes.length; n++) {
    const home = homes[n % homes.length];
    const other = homes[Math.floor(rand() * homes.length)];
    // They wait beside a door, not in front of it.
    const porch = (b: Building): [number, number] => local(b.x, b.z, b.yaw, (rand() < 0.5 ? -1 : 1) * Math.min(b.w / 2 - 0.5, 2.2), b.d / 2 + 1.6);
    const stopsAt: [number, number][] = [porch(home), plaza(), other === home ? plaza() : porch(other), plaza()];
    const path: [number, number][] = [];
    const stops: number[] = [];
    let ok = true;
    for (let q = 0; q < stopsAt.length && ok; q++) {
      const leg = route(stopsAt[q], stopsAt[(q + 1) % stopsAt.length]);
      if (!leg) ok = false;
      else {
        if (path.length) leg.shift();
        path.push(...leg);
        stops.push(path.length - 1);
      }
    }
    if (!ok || path.length < 3) continue;
    // The loop closes on its first point; drop the duplicate.
    if (Math.hypot(path[0][0] - path[path.length - 1][0], path[0][1] - path[path.length - 1][1]) < 0.01) {
      path.pop();
      stops[stops.length - 1] = 0;
    }
    villagers.push({
      id: `${site.id}:v${vid++}`,
      name: nameOf(),
      role: 'villager',
      dialogue: pick(['villager-a', 'villager-b', 'villager-c']),
      color: pick(CLOTHES),
      skin: pick(SKINS),
      hat: rand() < 0.35 ? { color: pick(CLOTHES), kind: rand() < 0.5 ? 'cap' : 'hood' } : undefined,
      x: path[0][0], z: path[0][1], facing: 0,
      path, stops,
    });
  }
  // Merchants behind the stalls.
  for (const st of stallSpots.slice(0, 4)) {
    const [x, z] = local(st.x, st.z, st.yaw, 0, -0.35);
    villagers.push({
      id: `${site.id}:m${vid++}`, name: nameOf(), role: 'merchant', dialogue: 'merchant',
      color: pick(CLOTHES), skin: pick(SKINS), hat: rand() < 0.5 ? { color: pick(CLOTHES), kind: 'cap' } : undefined,
      x, z, facing: st.yaw, path: [], stops: [],
    });
  }
  // Guards at the town gates and the castle gate.
  if (town) {
    const posts: { x: number; z: number; yaw: number }[] = [];
    if (tpl.walled) {
      for (const e of exits) {
        const r = wallR - 3.5;
        const x = site.x + Math.cos(e + 3.2 / wallR) * r;
        const z = site.z + Math.sin(e + 3.2 / wallR) * r;
        posts.push({ x, z, yaw: Math.atan2(Math.cos(e), Math.sin(e)) });
      }
    }
    if (castle) {
      const [x, z] = local(castle.x, castle.z, castle.yaw, 2.2, castle.half + 2.4);
      posts.push({ x, z, yaw: castle.yaw });
    }
    for (const p of posts.slice(0, 5)) {
      const k = toCell(p.x, p.z);
      if (k < 0 || !walkable(k)) continue;
      villagers.push({
        id: `${site.id}:g${vid++}`, name: nameOf(), role: 'guard', dialogue: 'guard',
        color: GUARD, skin: pick(SKINS), hat: { color: 0x9aa0a6, kind: 'helm' },
        x: p.x, z: p.z, facing: p.yaw, path: [], stops: [],
      });
    }
  }

  const describe = tpl.castle && !castle ? tpl.describe.replace(/ with a castle| under a castle/, '') : tpl.describe;
  return { site: site.id, template: tpl.name, describe, square: sq, buildings, towers, walls, props, villagers, palette };
}
