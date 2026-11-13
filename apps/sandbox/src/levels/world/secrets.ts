import { mulberry32, subSeed } from '@ingine/engine/procgen/random';
import type { TreeInstance } from '@ingine/engine/world/vegetation/Forest';
import { Biome, layoutScale, type WorldMap } from './WorldGen';
import { clearTrees } from './forest';
import { rollLoot } from './loot';

export type CacheSpot = 'waterfall' | 'glade' | 'ledge' | 'shore' | 'hilltop';

/** A hidden cache: a chest off the beaten track, with a little cairn beside it. */
export interface Cache {
  id: string;
  spot: CacheSpot;
  x: number;
  y: number;
  z: number;
  facing: number;
  contents: { item: string; count: number }[];
}

/** What each spot sounds like in a hint (for later rumours and notes). */
export const CACHE_HINT: Record<CacheSpot, string> = {
  waterfall: 'at the foot of a waterfall',
  glade: 'in a glade deep in the woods',
  ledge: 'on a high mountain ledge',
  shore: 'on a quiet stretch of the lake shore',
  hilltop: 'under a cairn on a lonely hilltop',
};

/**
 * Hides caches round the world, each where a curious player might look and
 * a hurried one wouldn't: beside a waterfall's plunge pool, in a glade in
 * deep forest, on a mountain ledge, on the lake shore, on a bare hilltop.
 * Always away from roads and sites, and apart from each other.
 */
export function hideCaches(map: WorldMap, trees: TreeInstance[]): Cache[] {
  const rand = mulberry32(subSeed(map.seed, 'caches'));
  const g = map.grid;
  const half = g.size / 2 - 60;
  const caches: Cache[] = [];
  const n = { x: 0, y: 0, z: 0 };

  const roadDist = (x: number, z: number, max: number): number => {
    let best = Infinity;
    for (const r of map.net.roads) for (const p of r.points) {
      if (Math.abs(p.x - x) > max || Math.abs(p.z - z) > max) continue;
      best = Math.min(best, Math.hypot(p.x - x, p.z - z));
    }
    return best;
  };
  const dry = (x: number, z: number) => !map.water.sample(x, g.heightAt(x, z) + 0.3, z, 0);
  const flat = (x: number, z: number) => {
    const { ix, iz } = g.toGrid(x, z);
    g.normalAt(ix, iz, n);
    return n.y > 0.9;
  };
  const free = (x: number, z: number, roadGap: number) =>
    Math.abs(x) < half && Math.abs(z) < half &&
    dry(x, z) && flat(x, z) &&
    roadDist(x, z, roadGap) >= roadGap &&
    map.sites.every((s) => Math.hypot(s.x - x, s.z - z) > s.radius + 40) &&
    caches.every((c) => Math.hypot(c.x - x, c.z - z) > 220 * layoutScale(g)) &&
    Math.hypot(map.spawn.x - x, map.spawn.z - z) > 120 * layoutScale(g);
  const add = (spot: CacheSpot, x: number, z: number) => {
    clearTrees(trees, x, z, spot === 'glade' ? 7 : 3);
    caches.push({
      id: `cache-${caches.length}`,
      spot, x, y: g.heightAt(x, z), z,
      facing: rand() * Math.PI * 2,
      contents: rollLoot('cache', rand),
    });
  };
  /** Try random candidates from `gen` until one is free. */
  const place = (spot: CacheSpot, tries: number, gap: number, gen: () => [number, number] | null) => {
    // A smaller world has its roads closer together: keep the same share of land off-road.
    const roadGap = Math.max(25, gap * layoutScale(g));
    for (let t = 0; t < tries; t++) {
      const p = gen();
      if (p && free(p[0], p[1], roadGap)) {
        add(spot, p[0], p[1]);
        return true;
      }
    }
    return false;
  };
  const anywhere = (): [number, number] => [(rand() * 2 - 1) * half, (rand() * 2 - 1) * half];
  const biomeAt = (x: number, z: number) => map.biomeAt(x, z);

  // Beside the plunge pools of the tallest falls.
  const falls = [...map.hydro.falls].sort((a, b) => b.drop - a.drop).slice(0, 3);
  for (const f of falls) {
    const river = map.hydro.rivers[f.river];
    const below = river?.points.find((p) => p.level < f.top - f.drop + 0.5 && Math.hypot(p.x - f.x, p.z - f.z) < 30);
    if (!below) continue;
    place('waterfall', 40, 25, () => {
      const a = rand() * Math.PI * 2;
      const r = below.width / 2 + 2 + rand() * 6;
      return [below.x + Math.cos(a) * r, below.z + Math.sin(a) * r];
    });
  }
  // Glades deep in the woods: lots of forest all round.
  for (let k = 0; k < 2; k++) {
    place('glade', 400, 70, () => {
      const [x, z] = anywhere();
      if (biomeAt(x, z) !== Biome.Forest) return null;
      for (let a = 0; a < 6; a++) if (biomeAt(x + Math.cos(a) * 30, z + Math.sin(a) * 30) !== Biome.Forest) return null;
      return [x, z];
    });
  }
  // A ledge up in the mountains.
  place('ledge', 600, 60, () => {
    const [x, z] = anywhere();
    const b = biomeAt(x, z);
    return (b === Biome.Alpine || b === Biome.Rock) && g.heightAt(x, z) > 110 ? [x, z] : null;
  });
  // The lake shore, away from everything.
  if (map.hydro.lake) {
    const L = map.hydro.lake;
    place('shore', 120, 50, () => {
      const a = rand() * Math.PI * 2;
      for (let r = 10; r < 220; r += 2) {
        const x = L.x + Math.cos(a) * r;
        const z = L.z + Math.sin(a) * r;
        if (dry(x, z)) return [x + Math.cos(a) * 3, z + Math.sin(a) * 3];
      }
      return null;
    });
  }
  // Hilltops: higher than everything 60 m around.
  for (let k = 0; k < 2; k++) {
    place('hilltop', 500, 50, () => {
      const [x, z] = anywhere();
      const h = g.heightAt(x, z);
      if (h < 40 || h > 150) return null;
      for (let a = 0; a < 8; a++) if (g.heightAt(x + Math.cos(a * 0.785) * 60, z + Math.sin(a * 0.785) * 60) > h - 6) return null;
      return [x, z];
    });
  }
  return caches;
}
