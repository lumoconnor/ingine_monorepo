import { mulberry32, subSeed } from '@ingine/engine/procgen/random';
import { smoothstep } from '@ingine/engine/procgen/fractal';
import { Biome, type WorldMap } from './WorldGen';

export type SiteKind = 'town' | 'village' | 'camp' | 'ruin';

export interface Site {
  /** Stable for a seed: `village-2`. Saves and loot will key off this. */
  id: string;
  kind: SiteKind;
  name: string;
  x: number;
  z: number;
  /** Height of the flattened ground. */
  y: number;
  /** Radius of the flattened ground, metres. */
  radius: number;
}

export const SITE_INFO: Record<SiteKind, { label: string; radius: number; color: string }> = {
  town: { label: 'Town', radius: 56, color: '#f2d27a' },
  village: { label: 'Village', radius: 30, color: '#f4efe1' },
  camp: { label: 'Bandit camp', radius: 16, color: '#e2573f' },
  ruin: { label: 'Ruined fortress', radius: 20, color: '#b9a7d6' },
};

/** Coarse search step, metres. */
const STEP = 16;

/**
 * Chooses where things will be built. Each kind scores the land for what it
 * wants, then spots are taken best-first with minimum spacing:
 *
 * - town: the biggest flat ground in the lowlands, close to a river or the lake
 * - villages: smaller flats, preferably near water, spread around the map
 * - bandit camps: small clearings in forest, well away from settlements
 * - ruined fortresses: hilltops that stand above their surroundings
 *
 * The ground under each site is flattened and blended into the terrain.
 * Buildings come in later milestones; for now a site is a spot and a name.
 */
export function placeSites(map: WorldMap, waterDist: Int16Array): Site[] {
  const rand = mulberry32(subSeed(map.seed, 'sites'));
  const g = map.grid;
  const W = map.water;
  const half = g.size / 2;
  const sites: Site[] = [];
  const names = new Set<string>();
  const name = (kind: SiteKind): string => {
    for (;;) {
      const n = makeName(kind, rand);
      if (!names.has(n)) {
        names.add(n);
        return n;
      }
    }
  };

  /** Height range over three rings out to `r`: how much levelling a site here would need. */
  const relief = (x: number, z: number, r: number): { relief: number; mean: number } => {
    let lo = Infinity;
    let hi = -Infinity;
    let sum = 0;
    let n = 0;
    for (const f of [0, 0.4, 0.75, 1]) {
      const k = f === 0 ? 1 : 10;
      for (let a = 0; a < k; a++) {
        const t = (a / k) * Math.PI * 2 + f;
        const h = g.heightAt(x + Math.cos(t) * r * f, z + Math.sin(t) * r * f);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
        sum += h;
        n++;
      }
    }
    return { relief: hi - lo, mean: sum / n };
  };
  /** Metres to the nearest water, or Infinity when further than ~160 m. */
  const water = (x: number, z: number): number => {
    const ix = Math.round((x - W.minX) / W.cell);
    const iz = Math.round((z - W.minZ) / W.cell);
    const d = waterDist[iz * W.n + ix];
    return d < 0 ? Infinity : d * W.cell;
  };

  interface Rule {
    kind: SiteKind;
    count: number;
    /** Keep within this many metres of the centre lines (the rim is mountains). */
    inner: number;
    maxRelief: number;
    /** Minimum distance to: same kind, other sites, the player's start. */
    gapSame: number;
    gapOther: number;
    gapSpawn: number;
    score(x: number, z: number, h: number, relief: number, water: number): number;
  }
  const rules: Rule[] = [
    {
      kind: 'town', count: 1, inner: 620, maxRelief: 9, gapSame: 0, gapOther: 0, gapSpawn: 150,
      score: (x, z, h, rel, w) => (h > 60 || w > 200 ? -Infinity : -rel * 4 - w * 0.08 - Math.hypot(x, z) * 0.012),
    },
    {
      kind: 'village', count: 3 + Math.floor(rand() * 3), inner: 800, maxRelief: 7, gapSame: 380, gapOther: 380, gapSpawn: 140,
      score: (_x, _z, h, rel, w) => (h > 85 ? -Infinity : -rel * 3 - Math.min(w, 200) * 0.06),
    },
    {
      kind: 'ruin', count: 2 + Math.floor(rand() * 2), inner: 780, maxRelief: 14, gapSame: 420, gapOther: 220, gapSpawn: 220,
      score: (x, z, h, rel) => {
        if (h < 45 || h > 150) return -Infinity;
        // Prominence: how far the spot stands above the land 90 m around it.
        let ring = 0;
        for (let a = 0; a < 8; a++) ring += g.heightAt(x + Math.cos(a * 0.785) * 90, z + Math.sin(a * 0.785) * 90);
        const prom = h - ring / 8;
        return prom < 8 ? -Infinity : prom * 2 - rel * 2;
      },
    },
    {
      kind: 'camp', count: 3, inner: 800, maxRelief: 6, gapSame: 320, gapOther: 260, gapSpawn: 260,
      score: (x, z, h, rel, w) => (h > 110 || w < 30 ? -Infinity : (map.biomeAt(x, z) === Biome.Forest ? 25 : 0) - rel * 3),
    },
  ];

  for (const rule of rules) {
    const r = SITE_INFO[rule.kind].radius;
    const cands: { x: number; z: number; y: number; s: number }[] = [];
    for (let z = -rule.inner; z <= rule.inner; z += STEP) {
      for (let x = -rule.inner; x <= rule.inner; x += STEP) {
        if (Math.max(Math.abs(x), Math.abs(z)) > half - 120) continue;
        const w = water(x, z);
        // Never build in or right beside water.
        if (w < r + 18) continue;
        const b = map.biomeAt(x, z);
        if (b === Biome.Rock || b === Biome.Snow || b === Biome.Water) continue;
        const rel = relief(x, z, r);
        if (rel.relief > rule.maxRelief) continue;
        const s = rule.score(x, z, g.heightAt(x, z), rel.relief, w);
        if (s === -Infinity) continue;
        cands.push({ x, z, y: rel.mean, s: s + rand() * 6 });
      }
    }
    cands.sort((a, b) => b.s - a.s);
    let placed = 0;
    for (const c of cands) {
      if (placed >= rule.count) break;
      if (Math.hypot(c.x - map.spawn.x, c.z - map.spawn.z) < rule.gapSpawn) continue;
      const clash = sites.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < (o.kind === rule.kind ? rule.gapSame : rule.gapOther));
      if (clash) continue;
      sites.push({ id: `${rule.kind}-${placed}`, kind: rule.kind, name: name(rule.kind), x: c.x, z: c.z, y: c.y, radius: r });
      placed++;
    }
  }

  for (const s of sites) flatten(map, s);
  return sites;
}

/** Level the ground under a site and ease it into the land around. */
function flatten(map: WorldMap, s: Site): void {
  const g = map.grid;
  const blend = Math.max(12, s.radius * 0.6);
  const R = s.radius + blend;
  const a = g.toGrid(s.x - R, s.z - R);
  const b = g.toGrid(s.x + R, s.z + R);
  for (let iz = Math.max(0, a.iz); iz <= Math.min(g.n - 1, b.iz); iz++) {
    for (let ix = Math.max(0, a.ix); ix <= Math.min(g.n - 1, b.ix); ix++) {
      const d = Math.hypot(g.minX + ix * g.cell - s.x, g.minZ + iz * g.cell - s.z);
      if (d >= R) continue;
      const wl = map.wet[iz * g.n + ix];
      if (wl === wl) continue;
      const t = smoothstep(d, s.radius, R);
      const h = g.at(ix, iz);
      g.set(ix, iz, s.y + (h - s.y) * t);
    }
  }
}

const START = ['Ald', 'Bram', 'Cor', 'Dun', 'El', 'Fen', 'Garr', 'Hal', 'Ives', 'Kel', 'Lor', 'Mar', 'Nor', 'Os', 'Pel', 'Rav', 'Sel', 'Tor', 'Wex', 'Yar'];
const END: Record<SiteKind, string[]> = {
  town: ['mere', 'ford', 'haven', 'bridge', 'gate', 'market'],
  village: ['by', 'stead', 'wick', 'ham', 'combe', 'well', 'thorpe', 'ley'],
  camp: ["'s Hollow", "'s Den", "'s Rest", "'s Cut"],
  ruin: [' Keep', ' Watch', ' Hold', ' Tor'],
};

function makeName(kind: SiteKind, rand: () => number): string {
  const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];
  return pick(START) + pick(END[kind]);
}
