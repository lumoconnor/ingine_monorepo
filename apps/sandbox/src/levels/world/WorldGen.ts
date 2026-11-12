import * as THREE from 'three';
import { Noise2D } from '@ingine/engine/utils/noise';
import { HeightGrid } from '@ingine/engine/procgen/HeightGrid';
import { ridged, smoothstep } from '@ingine/engine/procgen/fractal';
import { hash2, subSeed } from '@ingine/engine/procgen/random';
import type { TerrainSource } from '@ingine/engine/world/terrain/TerrainStreamer';
import type { WaterGrid } from '@ingine/engine/world/water/WaterGrid';
import { generateWater, type Hydrology } from './hydrology';
import { placeSites, type Site } from './sites';
import { buildRoads, type RoadNet } from './roads';
import { layoutSettlements, type Settlement } from './settlements';

/** Ground types. Later layers (forests, villages, camps) read these to decide what goes where. */
export const Biome = {
  Meadow: 0,
  DryGrass: 1,
  Forest: 2,
  Alpine: 3,
  Rock: 4,
  Snow: 5,
  /** Under a river or lake. */
  Water: 6,
  /** Sand and gravel at the water's edge. */
  Shore: 7,
  /** Road or path surface. */
  Road: 8,
} as const;
export type Biome = (typeof Biome)[keyof typeof Biome];

export const BIOME_INFO: { name: string; color: number }[] = [
  { name: 'Meadow', color: 0x7ea65a },
  { name: 'Dry grass hills', color: 0xa3a862 },
  { name: 'Forest floor', color: 0x557d3c },
  { name: 'Alpine scrub', color: 0x7f8a68 },
  { name: 'Rock', color: 0x8a8378 },
  { name: 'Snow', color: 0xeef1f4 },
  { name: 'Water', color: 0x3a7fae },
  { name: 'Shore', color: 0xc2b588 },
  { name: 'Road', color: 0x9a8160 },
];

/** Ground colour under water (gravel and silt); the water surface is drawn over it. */
const BED_COLOR = new THREE.Color(0x857a5c);

export interface WorldSettings {
  seed: number;
  /** Side length in metres. Default 2048. */
  size?: number;
  /** Height grid spacing in metres. Default 2. */
  cell?: number;
}

/** Heights where the look of the land changes, in metres. */
const SNOW_LINE = 165;
const ALPINE_LINE = 112;
const DRY_HILLS = 46;

const palette = BIOME_INFO.map((b) => new THREE.Color(b.color));

/**
 * The generated world: a height grid plus the maps later layers build on.
 * Same seed, same world, on every machine.
 *
 * Layers so far: land shape, lakes/rivers/waterfalls (hydrology.ts), site
 * spots (sites.ts), roads and bridges (roads.ts), then biomes. Buildings,
 * dressing and loot will each add a pass that reads and edits these maps.
 */
export class WorldMap implements TerrainSource {
  readonly grid: HeightGrid;
  /** 0..1 per grid vertex: drives forest vs open grass. */
  readonly moisture: Float32Array;
  /** Biome per grid vertex. */
  readonly biome: Uint8Array;
  /** Water surface height over each grid vertex (NaN = dry). */
  readonly wet: Float32Array;
  hydro!: Hydrology;
  /** Where things are (or will be) built. */
  sites: Site[] = [];
  net: RoadNet = { roads: [], bridges: [], mask: new Float32Array(0) };
  /** What stands in each village and the town. */
  settlements: Settlement[] = [];
  readonly spawn = new THREE.Vector3();
  spawnYaw = 0;
  /** Generation time in ms (for the debug map). */
  genMs = 0;

  constructor(readonly seed: number, size: number, cell: number) {
    this.grid = new HeightGrid(-size / 2, -size / 2, size, cell);
    const n = this.grid.n * this.grid.n;
    this.moisture = new Float32Array(n);
    this.biome = new Uint8Array(n);
    this.wet = new Float32Array(n).fill(NaN);
  }

  get water(): WaterGrid {
    return this.hydro.water;
  }

  /** Blend weights of each ground look at a vertex: shared by the colours and the biome map. */
  private layers(ix: number, iz: number, ny: number) {
    const g = this.grid;
    const i = iz * g.n + ix;
    const h = g.heights[i];
    const m = this.moisture[i];
    const steep = 1 - ny;
    // Snow line wobbles a little so it isn't a contour line.
    const snowLine = SNOW_LINE + (hash2(this.seed, ix >> 4, iz >> 4) - 0.5) * 18;
    const wl = this.wet[i];
    const wet = wl === wl;
    return {
      road: this.net.mask.length ? this.net.mask[i] : 0,
      bed: wet ? smoothstep(wl - h, -0.05, 0.25) : 0,
      shore: wet ? 1 - smoothstep(h - wl, 0.2, 0.75) : 0,
      dry: smoothstep(h, DRY_HILLS - 12, DRY_HILLS + 18) * (1 - smoothstep(m, 0.45, 0.7)),
      forest: smoothstep(m, 0.52, 0.66) * (1 - smoothstep(h, ALPINE_LINE - 15, ALPINE_LINE + 5)),
      alpine: smoothstep(h, ALPINE_LINE - 12, ALPINE_LINE + 14),
      rock: smoothstep(steep, 0.2, 0.34),
      snow: smoothstep(h, snowLine - 10, snowLine + 6) * (1 - smoothstep(steep, 0.28, 0.42)),
    };
  }

  colorAt(ix: number, iz: number, normal: THREE.Vector3, out: THREE.Color): void {
    const w = this.layers(ix, iz, normal.y);
    out.copy(palette[Biome.Meadow]);
    out.lerp(palette[Biome.DryGrass], w.dry);
    out.lerp(palette[Biome.Forest], w.forest);
    out.lerp(palette[Biome.Alpine], w.alpine);
    out.lerp(palette[Biome.Rock], w.rock);
    out.lerp(palette[Biome.Snow], w.snow);
    out.lerp(palette[Biome.Shore], w.shore * (1 - w.rock * 0.7));
    out.lerp(palette[Biome.Road], w.road);
    out.lerp(BED_COLOR, w.bed);
    // Per-patch brightness jitter breaks up large flat areas.
    const j = 0.94 + hash2(this.seed ^ 0x51ed, ix >> 1, iz >> 1) * 0.1;
    out.multiplyScalar(j);
  }

  /** @internal Fill the biome map from the same weights the colours use. */
  classify(): void {
    const g = this.grid;
    const n = new THREE.Vector3();
    for (let iz = 0; iz < g.n; iz++) {
      for (let ix = 0; ix < g.n; ix++) {
        g.normalAt(ix, iz, n);
        const w = this.layers(ix, iz, n.y);
        let b: Biome = Biome.Meadow;
        if (w.dry > 0.5) b = Biome.DryGrass;
        if (w.forest > 0.5) b = Biome.Forest;
        if (w.alpine > 0.5) b = Biome.Alpine;
        if (w.rock > 0.5) b = Biome.Rock;
        if (w.snow > 0.5) b = Biome.Snow;
        if (w.shore > 0.5) b = Biome.Shore;
        if (w.road > 0.5) b = Biome.Road;
        if (w.bed > 0.5) b = Biome.Water;
        this.biome[iz * g.n + ix] = b;
      }
    }
  }

  biomeAt(x: number, z: number): Biome {
    const { ix, iz } = this.grid.toGrid(x, z);
    const n = this.grid.n - 1;
    return this.biome[Math.min(n, Math.max(0, iz)) * this.grid.n + Math.min(n, Math.max(0, ix))] as Biome;
  }

  heightAt(x: number, z: number): number {
    return this.grid.heightAt(x, z);
  }

  /** A cheap fingerprint of the generated world (determinism checks). */
  checksum(): number {
    let h = 0;
    const H = this.grid.heights;
    for (let i = 0; i < H.length; i += 97) h = (Math.imul(h, 31) + Math.round(H[i] * 100)) | 0;
    for (let i = 0; i < this.biome.length; i += 89) h = (Math.imul(h, 31) + this.biome[i]) | 0;
    const L = this.water.level;
    for (let i = 0; i < L.length; i += 13) if (L[i] === L[i]) h = (Math.imul(h, 31) + Math.round(L[i] * 100)) | 0;
    for (const s of this.sites) h = (Math.imul(h, 31) + Math.round(s.x * 7 + s.z * 13 + s.y * 100)) | 0;
    for (const r of this.net.roads) h = (Math.imul(h, 31) + r.points.length) | 0;
    for (const st of this.settlements) {
      for (const b of st.buildings) h = (Math.imul(h, 31) + Math.round(b.x * 7 + b.z * 13 + b.yaw * 100 + b.w * 10)) | 0;
      for (const v of st.villagers) h = (Math.imul(h, 31) + v.path.length + Math.round(v.x * 3)) | 0;
    }
    return h >>> 0;
  }
}

/**
 * Land shape, in metres above a base of ~20:
 *
 * - a continental field decides where the highlands are; the world's rim is
 *   always mountainous so the map has a natural border
 * - ridged noise makes mountain ranges with valleys between them
 * - fbm hills roll across the mid-lands
 * - gentle undulation everywhere else (the grassy fields)
 * - domain warping bends it all so nothing lines up with the axes
 *
 * The middle of the map is kept low and open: that's where the player starts.
 */
export function generateWorld(settings: WorldSettings): WorldMap {
  const t0 = performance.now();
  const size = settings.size ?? 2048;
  const cell = settings.cell ?? 2;
  const seed = settings.seed >>> 0;
  const map = new WorldMap(seed, size, cell);
  const half = size / 2;

  const nWarp = new Noise2D(subSeed(seed, 'warp'));
  const nCont = new Noise2D(subSeed(seed, 'continent'));
  const nRidge = new Noise2D(subSeed(seed, 'ridges'));
  const nHillMask = new Noise2D(subSeed(seed, 'hill-mask'));
  const nHill = new Noise2D(subSeed(seed, 'hills'));
  const nField = new Noise2D(subSeed(seed, 'fields'));
  const nMoist = new Noise2D(subSeed(seed, 'moisture'));

  map.grid.fill((x, z) => {
    const wx = x + nWarp.fbm(x * 0.0016, z * 0.0016, 3) * 140;
    const wz = z + nWarp.fbm(x * 0.0016 + 31.7, z * 0.0016 - 12.3, 3) * 140;

    const cont = nCont.fbm(wx * 0.0008, wz * 0.0008, 3);
    const rim = smoothstep(Math.max(Math.abs(x), Math.abs(z)) / half, 0.74, 0.96);
    const centre = 1 - smoothstep(Math.hypot(x, z), 160, 420);
    const mountainMask = Math.max(smoothstep(cont, 0.02, 0.42), rim) * (1 - centre);

    // Broad massifs with sharp crests: uplift under the whole range, ridges on top.
    const r = ridged(nRidge, wx * 0.0015, wz * 0.0015, 5);
    const mountains = (r * r * 175 + r * 25 + 22) * mountainMask;

    const hillMask = smoothstep(nHillMask.fbm(wx * 0.0011, wz * 0.0011, 2), -0.5, 0.3);
    const hills = (nHill.fbm(wx * 0.0032, wz * 0.0032, 4) * 0.5 + 0.5) * 42 * hillMask * (1 - 0.6 * mountainMask);

    // Fields still roll: long gentle swells plus small bumps underfoot.
    const fields =
      nField.fbm(x * 0.0045, z * 0.0045, 3) * 6 + nField.fbm(x * 0.013, z * 0.013, 3) * 1.8 + nField.fbm(x * 0.06, z * 0.06, 2) * 0.3;

    return 20 + cont * 10 + hills + mountains + fields + rim * 40;
  });

  // Lakes, rivers and waterfalls (carves the grid). Keep the lake away from the middle, where you start.
  const g = map.grid;
  map.hydro = generateWater(g, seed, { x: 0, z: 0, r: 260 });
  const W = map.water;
  for (let iz = 0; iz < g.n; iz++) {
    for (let ix = 0; ix < g.n; ix++) map.wet[iz * g.n + ix] = W.levelAt(g.minX + ix * cell, g.minZ + iz * cell);
  }
  const nearWater = waterDistance(W);

  // Moisture: low-frequency noise, wetter in low ground and along rivers.
  for (let iz = 0; iz < g.n; iz++) {
    for (let ix = 0; ix < g.n; ix++) {
      const x = g.minX + ix * cell;
      const z = g.minZ + iz * cell;
      const i = iz * g.n + ix;
      const m = nMoist.fbm(x * 0.0028, z * 0.0028, 4) * 0.5 + 0.5;
      const lowWet = 1 - smoothstep(g.heights[i], 25, 90);
      const wd = nearWater[Math.round(iz / 2) * W.n + Math.round(ix / 2)];
      const river = wd < 0 ? 0 : Math.max(0, 1 - wd / 16) * 0.3;
      map.moisture[i] = Math.min(1, m * 0.85 + lowWet * 0.15 + river);
    }
  }

  map.classify();
  findSpawn(map);

  // Sites and the roads between them (both reshape the ground), then the biomes once more.
  map.sites = placeSites(map, nearWater);
  map.net = buildRoads(map, map.sites);
  map.classify();
  map.settlements = layoutSettlements(map, map.sites);
  map.spawn.y = g.heightAt(map.spawn.x, map.spawn.z) + 0.05;
  map.genMs = performance.now() - t0;
  return map;
}

/** Nearest gentle, open meadow to the centre, spiralling outward. */
function findSpawn(map: WorldMap): void {
  const g = map.grid;
  const waterDist = waterDistance(map.water);
  const c = (g.n - 1) / 2;
  const maxR = Math.round(400 / g.cell);
  for (let r = 0; r <= maxR; r += 2) {
    const steps = Math.max(1, Math.round(r * 2));
    for (let s = 0; s < steps; s++) {
      const a = (s / steps) * Math.PI * 2;
      const ix = Math.round(c + Math.cos(a) * r);
      const iz = Math.round(c + Math.sin(a) * r);
      if (map.biome[iz * g.n + ix] !== Biome.Meadow) continue;
      // Dry feet: no water within ~24 m.
      const w = map.water;
      const wd = waterDist[Math.round(iz / 2) * w.n + Math.round(ix / 2)];
      if (wd >= 0 && wd < 6) continue;
      // Flat over a few metres around, not just at the point.
      let ok = true;
      for (let dz = -3; dz <= 3 && ok; dz++) for (let dx = -3; dx <= 3 && ok; dx++) if (g.slopeDegAt(ix + dx, iz + dz) > 9) ok = false;
      if (!ok) continue;
      const x = g.minX + ix * g.cell;
      const z = g.minZ + iz * g.cell;
      map.spawn.set(x, g.heightAt(x, z) + 0.05, z);
      // Face the most distant high ground: mountains on the horizon make a good first view.
      map.spawnYaw = bestView(map, x, z);
      return;
    }
  }
  map.spawn.set(0, g.heightAt(0, 0) + 0.05, 0);
}

function bestView(map: WorldMap, x: number, z: number): number {
  let best = 0;
  let bestH = -Infinity;
  for (let k = 0; k < 16; k++) {
    const yaw = (k / 16) * Math.PI * 2;
    // Player yaw 0 looks down -Z; positive yaw turns left.
    const dx = -Math.sin(yaw);
    const dz = -Math.cos(yaw);
    // Distant peaks score, a hill right in front of your face doesn't.
    let h = 0;
    for (let d = 300; d <= 900; d += 100) h += map.heightAt(x + dx * d, z + dz * d);
    for (let d = 20; d <= 160; d += 20) h -= 3 * Math.max(0, map.heightAt(x + dx * d, z + dz * d) - map.heightAt(x, z));
    if (h > bestH) {
      bestH = h;
      best = yaw;
    }
  }
  return best;
}

/** Per water-grid vertex: distance in cells to the nearest water (-1 = further than 40 cells). */
export function waterDistance(w: WaterGrid): Int16Array {
  const N = w.n;
  const d = new Int16Array(N * N).fill(-1);
  const q: number[] = [];
  for (let i = 0; i < N * N; i++) if (w.level[i] === w.level[i]) {
    d[i] = 0;
    q.push(i);
  }
  for (let k = 0; k < q.length; k++) {
    const c = q[k];
    if (d[c] >= 40) continue;
    const x = c % N;
    const z = (c / N) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const n = nz * N + nx;
      if (d[n] < 0) {
        d[n] = d[c] + 1;
        q.push(n);
      }
    }
  }
  return d;
}
