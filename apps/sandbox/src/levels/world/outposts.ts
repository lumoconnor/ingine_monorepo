import { mulberry32, subSeed } from '@ingine/engine/procgen/random';
import type { WorldMap } from './WorldGen';
import type { Site } from './sites';
import type { Tower, WallLine } from './settlements';

/**
 * Bandit camps and ruined fortresses: what stands there and who guards it.
 * Pure data from the seed, like settlements.ts; buildOutposts.ts builds it.
 *
 * - Camp: tents round a fire inside a rough palisade (open where the path
 *   comes in), a lookout platform with a ladder, crates, a chest in the
 *   leader's tent. Swordsmen by the fire, a marksman up the lookout.
 * - Ruin: a broken curtain wall with breaches and stumps of towers round
 *   a roofless keep, rubble everywhere. Deserters hold it, a marksman on the
 *   tallest tower.
 */

export interface Tent {
  x: number;
  z: number;
  yaw: number;
  w: number;
  d: number;
  h: number;
  color: number;
}

export interface Block {
  /** A loose box: rubble, crates, logs, broken wall. */
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  yaw: number;
  color: number;
  collide: boolean;
}

export interface Guard {
  id: string;
  archetype: string;
  x: number;
  /** Feet height (on the ground or up on something). */
  y: number;
  z: number;
  facing: number;
}

export interface Outpost {
  site: string;
  kind: 'camp' | 'ruin';
  tents: Tent[];
  blocks: Block[];
  walls: (WallLine & { color: number; crenels: boolean })[];
  towers: (Tower & { broken: boolean })[];
  /** Camp lookout: platform centre, deck height above ground, facing (ladder side is +Z local). */
  lookout?: { x: number; z: number; yaw: number; y: number; deck: number };
  fire?: { x: number; z: number; y: number };
  chest?: { id: string; x: number; y: number; z: number; facing: number; contents: { item: string; count: number }[] };
  guards: Guard[];
}

const CANVAS = [0x8b7d5e, 0x7a6c50, 0x9a8a66, 0x6f6448, 0x857a5a];
const WOOD = 0x6b4f33;
const LOG = 0x5e4630;
const CRATE = 0x9a7a4e;
export const RUIN_STONE = 0x9a958a;
const RUBBLE = [0x8d887d, 0x7f7a70, 0xa29d92];

export function layoutOutposts(map: WorldMap, sites: Site[]): Outpost[] {
  const out: Outpost[] = [];
  for (const s of sites) {
    if (s.kind === 'camp') out.push(camp(map, s));
    else if (s.kind === 'ruin') out.push(ruin(map, s));
  }
  return out;
}

/** Angles (from the site centre) where roads and paths cross radius `r`. */
function exitsAt(map: WorldMap, s: Site, r: number): number[] {
  const exits: number[] = [];
  for (const road of map.net.roads) {
    const p = road.points;
    for (let k = 1; k < p.length; k++) {
      const da = Math.hypot(p[k - 1].x - s.x, p[k - 1].z - s.z);
      const db = Math.hypot(p[k].x - s.x, p[k].z - s.z);
      if ((da - r) * (db - r) <= 0 && da !== db) {
        const t = (r - da) / (db - da);
        exits.push(Math.atan2(p[k - 1].z + (p[k].z - p[k - 1].z) * t - s.z, p[k - 1].x + (p[k].x - p[k - 1].x) * t - s.x));
      }
    }
  }
  return exits;
}

/** Does any road or path come within `clear` metres (plus its half-width) of segment p-q? */
function crossesRoad(map: WorldMap, p: [number, number], q: [number, number], clear: number): boolean {
  const dx = q[0] - p[0];
  const dz = q[1] - p[1];
  const l2 = dx * dx + dz * dz || 1;
  for (const r of map.net.roads) {
    for (const pt of r.points) {
      if (Math.abs(pt.x - p[0]) > 40 || Math.abs(pt.z - p[1]) > 40) continue;
      const t = Math.max(0, Math.min(1, ((pt.x - p[0]) * dx + (pt.z - p[1]) * dz) / l2));
      if (Math.hypot(pt.x - p[0] - dx * t, pt.z - p[1] - dz * t) < r.width / 2 + clear) return true;
    }
  }
  return false;
}

const angDist = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

function camp(map: WorldMap, s: Site): Outpost {
  const rand = mulberry32(subSeed(map.seed, 'outpost:' + s.id));
  const between = (a: number, b: number) => a + rand() * (b - a);
  const pick = <T>(a: T[]): T => a[Math.floor(rand() * a.length)];
  const g = (x: number, z: number) => map.heightAt(x, z);
  const at = (a: number, r: number): [number, number] => [s.x + Math.cos(a) * r, s.z + Math.sin(a) * r];
  const face = (x: number, z: number) => Math.atan2(s.x - x, s.z - z);
  const o: Outpost = { site: s.id, kind: 'camp', tents: [], blocks: [], walls: [], towers: [], guards: [] };

  const R = 13.5;
  const exits = exitsAt(map, s, R);
  if (!exits.length) exits.push(rand() * Math.PI * 2);
  const open = (a: number) => exits.some((e) => angDist(a, e) < 3.2 / R);

  // Fire and the logs round it.
  o.fire = { x: s.x, z: s.z, y: g(s.x, s.z) };
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + rand() * 0.6;
    const [x, z] = at(a, 2.3);
    o.blocks.push({ x, y: g(x, z) + 0.16, z, w: 1.8, h: 0.32, d: 0.32, yaw: a + Math.PI / 2 + 0.2, color: LOG, collide: true });
  }

  // The lookout goes just inside the palisade, beside the way in.
  const la = exits[0] + (rand() < 0.5 ? -1 : 1) * 0.55;

  // Tents in a ring, mouths to the fire, away from the way in.
  const tentCount = 3 + Math.floor(rand() * 3);
  const taken: number[] = [...exits, la];
  for (let k = 0; k < tentCount; k++) {
    let a = 0;
    for (let t = 0; t < 30; t++) {
      a = rand() * Math.PI * 2;
      if (taken.every((e) => angDist(a, e) > 0.75)) break;
    }
    taken.push(a);
    const big = k === 0;
    const [x, z] = at(a, big ? 8.2 : between(6.5, 8.5));
    o.tents.push({ x, z, yaw: face(x, z), w: big ? 3.6 : 2.6, d: big ? 4.4 : 3, h: big ? 2.4 : 1.7, color: pick(CANVAS) });
    if (big) {
      // The leader's chest beside the mouth of the big tent.
      const yaw = face(x, z);
      const cx = x + Math.sin(yaw) * 2.9 + Math.cos(yaw) * 1.2;
      const cz = z + Math.cos(yaw) * 2.9 - Math.sin(yaw) * 1.2;
      o.chest = {
        id: `${s.id}:chest`, x: cx, y: g(cx, cz), z: cz, facing: yaw,
        contents: [{ item: 'gold', count: 12 + Math.floor(rand() * 18) }, { item: pick(['bandage', 'healing_draught', 'arrows']), count: 2 + Math.floor(rand() * 3) }],
      };
    }
  }

  // Crates and barrels by the tents.
  for (let k = 0; k < 5; k++) {
    const a = rand() * Math.PI * 2;
    if (exits.some((e) => angDist(a, e) < 0.5)) continue;
    const [x, z] = at(a, between(4.2, 5.2));
    const sz = between(0.5, 0.8);
    o.blocks.push({ x, y: g(x, z) + sz / 2, z, w: sz, h: sz, d: sz, yaw: rand() * 3, color: CRATE, collide: true });
  }

  // Palisade: a ring of stakes, open where paths come in.
  const sides = 18;
  const a0 = rand();
  for (let k = 0; k < sides; k++) {
    const aA = a0 + (k / sides) * Math.PI * 2;
    const aB = a0 + ((k + 1) / sides) * Math.PI * 2;
    if (open(aA) || open(aB) || open((aA + aB) / 2) || crossesRoad(map, at(aA, R), at(aB, R), 1.2)) continue;
    // A couple of fallen-down stretches.
    if (rand() < 0.12) continue;
    o.walls.push({ from: at(aA, R), to: at(aB, R), height: between(2.2, 2.8), thickness: 0.4, color: WOOD, crenels: false });
  }

  const [lx, lz] = at(la, R - 3.2);
  const deck = 3.6;
  o.lookout = { x: lx, z: lz, yaw: face(lx, lz), y: g(lx, lz), deck };

  // Bandits: by the fire, at the way in, up the lookout; a chief at bigger camps.
  const fireGuards = 1 + Math.floor(rand() * 2);
  for (let k = 0; k < fireGuards; k++) {
    const a = rand() * Math.PI * 2;
    const [x, z] = at(a, 3.4);
    o.guards.push({ id: `${s.id}:bandit-${k}`, archetype: 'sword_bandit', x, y: g(x, z), z, facing: face(x, z) });
  }
  {
    const e = exits[0];
    const [x, z] = at(e + 0.12, R - 2);
    o.guards.push({ id: `${s.id}:gate`, archetype: 'sword_bandit', x, y: g(x, z), z, facing: Math.atan2(Math.cos(e), Math.sin(e)) });
  }
  o.guards.push({ id: `${s.id}:lookout`, archetype: 'musket_bandit', x: lx, y: g(lx, lz) + deck, z: lz, facing: Math.atan2(lx - s.x, lz - s.z) });
  if (tentCount >= 4) {
    const t = o.tents[0];
    const x = t.x + Math.sin(t.yaw) * 3;
    const z = t.z + Math.cos(t.yaw) * 3;
    o.guards.push({ id: `${s.id}:chief`, archetype: 'bandit_chief', x, y: g(x, z), z, facing: t.yaw });
  }
  return o;
}

function ruin(map: WorldMap, s: Site): Outpost {
  const rand = mulberry32(subSeed(map.seed, 'outpost:' + s.id));
  const between = (a: number, b: number) => a + rand() * (b - a);
  const pick = <T>(a: T[]): T => a[Math.floor(rand() * a.length)];
  const g = (x: number, z: number) => map.heightAt(x, z);
  const o: Outpost = { site: s.id, kind: 'ruin', tents: [], blocks: [], walls: [], towers: [], guards: [] };

  const yaw = rand() * Math.PI * 2;
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const L = (lx: number, lz: number): [number, number] => [s.x + lx * c + lz * sn, s.z - lx * sn + lz * c];
  const half = 13;
  const exits = exitsAt(map, s, half * 1.15);

  // The curtain wall, side by side, in ~3 m pieces of uneven height with breaches.
  const corners: [number, number][] = [[-half, -half], [half, -half], [half, half], [-half, half]];
  for (let k = 0; k < 4; k++) {
    const [ax, az] = corners[k];
    const [bx, bz] = corners[(k + 1) % 4];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.round(len / 3);
    for (let i = 0; i < n; i++) {
      const p = L(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n);
      const q = L(ax + ((bx - ax) * (i + 1)) / n, az + ((bz - az) * (i + 1)) / n);
      const mid = Math.atan2((p[1] + q[1]) / 2 - s.z, (p[0] + q[0]) / 2 - s.x);
      // Keep the way in open, knock a few holes in the rest.
      if (exits.some((e) => angDist(mid, e) < 0.28) || crossesRoad(map, p, q, 1.8)) continue;
      if (i > 0 && i < n - 1 && rand() < 0.16) {
        // A breach: a low heap of fallen stone.
        const m: [number, number] = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        o.blocks.push({ x: m[0], y: g(...m) + 0.3, z: m[1], w: 2.4, h: 0.6, d: 1.8, yaw: yaw + k * (Math.PI / 2), color: pick(RUBBLE), collide: true });
        continue;
      }
      o.walls.push({ from: p, to: q, height: between(1.4, 5.5), thickness: 1.6, color: RUIN_STONE, crenels: rand() < 0.25 });
    }
  }
  // Towers at the corners, all broken; one stands taller.
  const tall = Math.floor(rand() * 4);
  corners.forEach(([x, z], k) => {
    const [tx, tz] = L(x, z);
    o.towers.push({ x: tx, z: tz, yaw, size: 4.4, height: k === tall ? 8.5 : between(3, 6.5), groundY: g(tx, tz), roofed: false, broken: true });
  });

  // The keep: four broken walls round a roofless hall, door toward the way in.
  const kx = between(-3, 3);
  const kz = -between(1, 3);
  const kh = 5;
  const keepWalls: [[number, number], [number, number]][] = [
    [[kx - kh, kz - kh], [kx + kh, kz - kh]],
    [[kx + kh, kz - kh], [kx + kh, kz + kh]],
    [[kx - kh, kz + kh], [kx - kh, kz - kh]],
    [[kx - kh, kz + kh], [kx - 1.2, kz + kh]],
    [[kx + 1.2, kz + kh], [kx + kh, kz + kh]],
  ];
  for (const [a, b] of keepWalls) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(len / 2.5));
    for (let i = 0; i < n; i++) {
      if (rand() < 0.1) continue;
      const p = L(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n);
      const q = L(a[0] + ((b[0] - a[0]) * (i + 1)) / n, a[1] + ((b[1] - a[1]) * (i + 1)) / n);
      // The path runs right up to the middle of the ruin: let it through.
      if (crossesRoad(map, p, q, 1.4)) continue;
      o.walls.push({ from: p, to: q, height: between(2, 7), thickness: 1.2, color: RUIN_STONE, crenels: false });
    }
  }
  // The chest in the keep's back corner.
  {
    const [x, z] = L(kx + kh - 2, kz - kh + 1.8);
    o.chest = { id: `${s.id}:chest`, x, y: g(x, z), z, facing: yaw, contents: [{ item: 'gold', count: 20 + Math.floor(rand() * 25) }, { item: pick(['steel_helm', 'healing_draught', 'grenade']), count: 1 }] };
  }

  // Deserters: two in the courtyard, one in the keep, a marksman on the tall tower.
  const yard: [number, number][] = [[half - 5, half - 5], [-half + 5, half - 4], [kx, kz]];
  yard.forEach(([lx, lz], k) => {
    const [x, z] = L(lx, lz);
    o.guards.push({ id: `${s.id}:deserter-${k}`, archetype: k === 2 ? 'bandit_chief' : 'sword_bandit', x, y: g(x, z), z, facing: yaw + rand() * 6 });
  });
  const t = o.towers[tall];
  o.guards.push({ id: `${s.id}:tower`, archetype: 'musket_bandit', x: t.x, y: t.groundY + t.height, z: t.z, facing: Math.atan2(t.x - s.x, t.z - s.z) });
  // Rubble inside and out.
  for (let k = 0; k < 26; k++) {
    const lx = between(-half - 4, half + 4);
    const lz = between(-half - 4, half + 4);
    if (Math.abs(lx - kx) < 1.6 && lz > kz) continue; // keep the keep's doorway clear
    const [x, z] = L(lx, lz);
    // Not on anyone's feet, or on the chest.
    if (o.guards.some((q) => Math.hypot(q.x - x, q.z - z) < 1.8) || (o.chest && Math.hypot(o.chest.x - x, o.chest.z - z) < 1.8)) continue;
    const w = between(0.5, 1.6);
    const h = between(0.3, 0.9);
    o.blocks.push({ x, y: g(x, z) + h / 2 - 0.1, z, w, h, d: between(0.5, 1.4), yaw: rand() * 3, color: pick(RUBBLE), collide: w > 0.9 });
  }
  return o;
}
