import type { TreeInstance } from '@ingine/engine/world/vegetation/Forest';
import { hash2, subSeed } from '@ingine/engine/procgen/random';
import { Noise2D } from '@ingine/engine/utils/noise';
import { Biome, type WorldMap } from './WorldGen';

export const TREE_PINE = 0;
export const TREE_OAK = 1;
export const TREE_BUSH = 2;

/** Spacing of the scatter grid, metres: one tree at most per cell. */
const CELL = 4.5;

/**
 * Where the trees grow. One candidate per 4.5 m cell, jittered; the chance
 * of a tree comes from the biome (thick in forest, a few in meadows, conifers
 * up high), a clumping noise so woods have glades and edges, and keep-outs:
 * water, roads, steep rock, and every site with a margin.
 */
export function plantForest(map: WorldMap): TreeInstance[] {
  const seed = subSeed(map.seed, 'forest');
  const g = map.grid;
  const noise = new Noise2D(seed);
  const half = g.size / 2;
  const trees: TreeInstance[] = [];
  // Sites keep clear (their own ground plus a margin).
  const clear = map.sites.map((s) => ({ x: s.x, z: s.z, r: s.radius + (s.kind === 'camp' ? 4 : 10) }));
  const n = { x: 0, y: 0, z: 0 };

  for (let z = -half + CELL; z < half - CELL; z += CELL) {
    for (let x = -half + CELL; x < half - CELL; x += CELL) {
      const cx = Math.floor(x / CELL);
      const cz = Math.floor(z / CELL);
      const px = x + hash2(seed, cx, cz) * CELL * 0.9;
      const pz = z + hash2(seed + 1, cx, cz) * CELL * 0.9;
      const { ix, iz } = g.toGrid(px, pz);
      if (ix < 1 || iz < 1 || ix >= g.n - 1 || iz >= g.n - 1) continue;
      const i = iz * g.n + ix;
      const b = map.biome[i];
      if (b === Biome.Water || b === Biome.Shore || b === Biome.Road || b === Biome.Snow || b === Biome.Rock) continue;
      // Near road surface, or under or right beside water.
      if (map.net.mask[i] > 0.01) continue;
      if (nearWet(map, ix, iz)) continue;
      g.normalAt(ix, iz, n);
      if (n.y < 0.78) continue;
      if (clear.some((c) => Math.abs(c.x - px) < c.r && Math.abs(c.z - pz) < c.r && Math.hypot(c.x - px, c.z - pz) < c.r)) continue;

      // Woods come in clumps.
      const clump = noise.noise(px / 90, pz / 90) * 0.6 + noise.noise(px / 23, pz / 23) * 0.4;
      const h = g.heights[i];
      let p = 0;
      if (b === Biome.Forest) p = 0.55 + clump * 0.45;
      else if (b === Biome.Alpine) p = 0.12 + clump * 0.15;
      else if (b === Biome.Meadow) p = clump > 0.35 ? 0.25 : 0.015;
      else if (b === Biome.DryGrass) p = clump > 0.5 ? 0.12 : 0.006;
      const r = hash2(seed + 2, cx, cz);
      if (r >= p) {
        // Bushes fill in at the edges of woods.
        if (r < p + 0.1 && (b === Biome.Forest || (b === Biome.Meadow && clump > 0.2))) {
          trees.push({ x: px, y: g.heightAt(px, pz), z: pz, kind: TREE_BUSH, scale: 0.7 + hash2(seed + 3, cx, cz) * 0.7, yaw: r * 40, tint: hash2(seed + 4, cx, cz) });
        }
        continue;
      }
      // Conifers up high and in the thick of the woods, broadleaves lower down.
      const pineChance = b === Biome.Alpine ? 1 : Math.min(1, Math.max(0, (h - 45) / 50)) * 0.8 + 0.2;
      const kind = hash2(seed + 5, cx, cz) < pineChance ? TREE_PINE : TREE_OAK;
      trees.push({
        x: px,
        y: g.heightAt(px, pz),
        z: pz,
        kind,
        scale: (kind === TREE_PINE ? 0.8 : 0.75) + hash2(seed + 3, cx, cz) * 0.6,
        yaw: hash2(seed + 6, cx, cz) * Math.PI * 2,
        tint: hash2(seed + 4, cx, cz),
      });
    }
  }
  return trees;
}

/** Is there water at or right next to this grid vertex? */
function nearWet(map: WorldMap, ix: number, iz: number): boolean {
  const n = map.grid.n;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const w = map.wet[(iz + dz) * n + ix + dx];
      if (w === w) return true;
    }
  }
  return false;
}

/** Remove trees within `r` of a point (secrets clear themselves a glade). */
export function clearTrees(trees: TreeInstance[], x: number, z: number, r: number): void {
  for (let k = trees.length - 1; k >= 0; k--) {
    const t = trees[k];
    if (Math.abs(t.x - x) < r && Math.abs(t.z - z) < r && Math.hypot(t.x - x, t.z - z) < r) trees.splice(k, 1);
  }
}
