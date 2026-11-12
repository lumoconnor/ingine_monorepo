import * as THREE from 'three';
import { Component } from '../../entities/Component';
import type { FrameTime } from '../../core/Time';
import { RAPIER } from '../../physics/PhysicsWorld';
import type { HeightGrid } from '../../procgen/HeightGrid';

/** What the streamer needs from a generated world. */
export interface TerrainSource {
  readonly grid: HeightGrid;
  /** Vertex colour for the ground at grid vertex (ix, iz). `normal` is the surface normal there. */
  colorAt(ix: number, iz: number, normal: THREE.Vector3, out: THREE.Color): void;
}

export interface TerrainLod {
  /** Use this level while the chunk's nearest edge is within this many metres of the focus. */
  within: number;
  /** Vertex stride in grid cells (1 = every grid vertex). */
  step: number;
}

export interface TerrainStreamerOptions {
  source: TerrainSource;
  /** Chunk side in metres; must be a whole number of grid cells. Default 128. */
  chunkSize?: number;
  /** Nearest first. The last level should reach Infinity. */
  lods?: TerrainLod[];
  /** Chunks within this distance of the focus get a physics collider. Default 160 m. */
  physicsRadius?: number;
  /** ...and keep it until they're this far away. Default 240 m. */
  physicsKeep?: number;
  /** Mesh rebuild time allowed per frame, ms (at least one chunk always builds). Default 3. */
  budgetMs?: number;
  /** Where detail is needed. Default: the player's position. */
  focus?: () => THREE.Vector3 | undefined;
  /** Where to start before the focus exists (the spawn point). */
  initialFocus?: THREE.Vector3;
  material?: THREE.Material;
}

const DEFAULT_LODS: TerrainLod[] = [
  { within: 200, step: 1 },
  { within: 450, step: 2 },
  { within: 900, step: 4 },
  { within: Infinity, step: 8 },
];

interface Chunk {
  cx: number;
  cz: number;
  /** World-space centre. */
  x: number;
  z: number;
  mesh: THREE.Mesh | null;
  lod: number;
  body: RAPIER.RigidBody | null;
  collider: RAPIER.Collider | null;
}

const _n = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * Streams a large HeightGrid as square chunks around the player:
 *
 * - Every chunk always has a render mesh. Its detail (LOD) depends on
 *   distance; changes are rebuilt a few per frame, nearest first. Skirts hide
 *   the cracks where two detail levels meet.
 * - Only chunks near the player get a Rapier heightfield collider, built from
 *   exactly the grid vertices the nearest mesh uses. Collider upkeep runs in
 *   the fixed step, before physics, so a teleport never lands on thin air.
 *
 * Put it on an entity tagged 'terrain'; colliders are registered to that
 * entity so hits read as terrain.
 */
export class TerrainStreamer extends Component {
  readonly chunkSize: number;
  readonly chunksPerSide: number;
  private readonly cellsPerChunk: number;
  private readonly lods: TerrainLod[];
  private readonly physicsRadius: number;
  private readonly physicsKeep: number;
  private readonly budgetMs: number;
  private readonly material: THREE.Material;
  private chunks: Chunk[] = [];
  private queue: Chunk[] = [];
  private lastEval = new THREE.Vector3(Infinity, 0, Infinity);
  private lastPhysics = new THREE.Vector3(Infinity, 0, Infinity);
  private focusPoint = new THREE.Vector3();

  constructor(private opts: TerrainStreamerOptions) {
    super();
    const grid = opts.source.grid;
    this.chunkSize = opts.chunkSize ?? 128;
    this.cellsPerChunk = Math.round(this.chunkSize / grid.cell);
    this.chunksPerSide = Math.round(grid.size / this.chunkSize);
    if (Math.abs(this.cellsPerChunk * grid.cell - this.chunkSize) > 1e-6 || this.chunksPerSide * this.chunkSize !== grid.size) {
      throw new Error('TerrainStreamer: chunkSize must divide the grid size and be a whole number of cells');
    }
    this.lods = opts.lods ?? DEFAULT_LODS;
    for (const l of this.lods) {
      if (this.cellsPerChunk % l.step) throw new Error(`TerrainStreamer: LOD step ${l.step} must divide ${this.cellsPerChunk}`);
    }
    this.physicsRadius = opts.physicsRadius ?? 160;
    this.physicsKeep = opts.physicsKeep ?? 240;
    this.budgetMs = opts.budgetMs ?? 3;
    this.material =
      opts.material ?? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  }

  onAttach(): void {
    const grid = this.opts.source.grid;
    for (let cz = 0; cz < this.chunksPerSide; cz++) {
      for (let cx = 0; cx < this.chunksPerSide; cx++) {
        this.chunks.push({
          cx,
          cz,
          x: grid.minX + (cx + 0.5) * this.chunkSize,
          z: grid.minZ + (cz + 0.5) * this.chunkSize,
          mesh: null,
          lod: -1,
          body: null,
          collider: null,
        });
      }
    }
    // Build everything at its right detail up front so the first frame has no pop-in.
    const f = this.opts.initialFocus ?? new THREE.Vector3(grid.minX + grid.size / 2, 0, grid.minZ + grid.size / 2);
    this.focusPoint.copy(f);
    this.evaluate(f);
    while (this.queue.length) this.buildMesh(this.queue.shift()!);
    this.updatePhysics(f, true);
  }

  onDetach(): void {
    for (const c of this.chunks) {
      this.dropCollider(c);
      if (c.mesh) {
        c.mesh.removeFromParent();
        c.mesh.geometry.dispose();
      }
    }
    this.chunks = [];
    this.queue = [];
    if (!this.opts.material) this.material.dispose();
  }

  /** Number of chunks that currently have a collider (for checks and the debug overlay). */
  get colliderCount(): number {
    return this.chunks.filter((c) => c.collider).length;
  }

  /** Chunks still waiting for a detail change. */
  get pending(): number {
    return this.queue.length;
  }

  /** LOD index of the chunk containing (x, z), or -1 outside. */
  lodAt(x: number, z: number): number {
    const c = this.chunkAt(x, z);
    return c ? c.lod : -1;
  }

  fixedUpdate(): void {
    const f = this.currentFocus();
    if (!f) return;
    this.updatePhysics(f, false);
  }

  update(_time: FrameTime): void {
    const f = this.currentFocus();
    if (!f) return;
    if (Math.hypot(f.x - this.lastEval.x, f.z - this.lastEval.z) > 16) this.evaluate(f);
    const t0 = performance.now();
    while (this.queue.length) {
      this.buildMesh(this.queue.shift()!);
      if (performance.now() - t0 > this.budgetMs) break;
    }
  }

  // ---------------------------------------------------------------------------

  private currentFocus(): THREE.Vector3 | undefined {
    const f = this.opts.focus ? this.opts.focus() : this.game.world.find('player')?.object3d.position;
    if (f) this.focusPoint.copy(f);
    return f ? this.focusPoint : undefined;
  }

  private chunkAt(x: number, z: number): Chunk | undefined {
    const grid = this.opts.source.grid;
    const cx = Math.floor((x - grid.minX) / this.chunkSize);
    const cz = Math.floor((z - grid.minZ) / this.chunkSize);
    if (cx < 0 || cz < 0 || cx >= this.chunksPerSide || cz >= this.chunksPerSide) return undefined;
    return this.chunks[cz * this.chunksPerSide + cx];
  }

  /** Distance in XZ from a point to the nearest point of a chunk. */
  private distTo(c: Chunk, p: THREE.Vector3): number {
    const h = this.chunkSize / 2;
    const dx = Math.max(0, Math.abs(p.x - c.x) - h);
    const dz = Math.max(0, Math.abs(p.z - c.z) - h);
    return Math.hypot(dx, dz);
  }

  private evaluate(f: THREE.Vector3): void {
    this.lastEval.copy(f);
    const want: { c: Chunk; d: number }[] = [];
    for (const c of this.chunks) {
      const d = this.distTo(c, f);
      const lod = this.lods.findIndex((l) => d <= l.within);
      const target = lod === -1 ? this.lods.length - 1 : lod;
      if (target !== c.lod) want.push({ c, d });
    }
    want.sort((a, b) => a.d - b.d);
    this.queue = want.map((w) => w.c);
  }

  private targetLod(c: Chunk): number {
    const d = this.distTo(c, this.lastEval);
    const lod = this.lods.findIndex((l) => d <= l.within);
    return lod === -1 ? this.lods.length - 1 : lod;
  }

  private buildMesh(c: Chunk): void {
    const lod = this.targetLod(c);
    if (lod === c.lod && c.mesh) return;
    const geo = this.buildGeometry(c, this.lods[lod].step);
    if (c.mesh) {
      c.mesh.geometry.dispose();
      c.mesh.geometry = geo;
    } else {
      c.mesh = new THREE.Mesh(geo, this.material);
      c.mesh.name = `terrain-${c.cx}-${c.cz}`;
      c.mesh.position.set(c.x, 0, c.z);
      c.mesh.receiveShadow = true;
      c.mesh.castShadow = false;
      c.mesh.matrixAutoUpdate = false;
      c.mesh.updateMatrix();
      this.entity.object3d.add(c.mesh);
    }
    c.lod = lod;
  }

  private buildGeometry(c: Chunk, step: number): THREE.BufferGeometry {
    const { grid } = this.opts.source;
    const src = this.opts.source;
    const segs = this.cellsPerChunk / step;
    const verts = segs + 1;
    const ix0 = c.cx * this.cellsPerChunk;
    const iz0 = c.cz * this.cellsPerChunk;
    const half = this.chunkSize / 2;
    // Skirt depth grows with vertex spacing: coarser neighbours can sit further off.
    const skirt = 1 + step * grid.cell * 1.5;

    const perimeter = segs * 4;
    const total = verts * verts + perimeter;
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);

    const put = (i: number, gx: number, gz: number, dy: number) => {
      const y = grid.at(gx, gz);
      pos[i * 3] = (gx - ix0) * grid.cell - half;
      pos[i * 3 + 1] = y - dy;
      pos[i * 3 + 2] = (gz - iz0) * grid.cell - half;
      grid.normalAt(gx, gz, _n);
      nor[i * 3] = _n.x;
      nor[i * 3 + 1] = _n.y;
      nor[i * 3 + 2] = _n.z;
      src.colorAt(gx, gz, _n, _c);
      col[i * 3] = _c.r;
      col[i * 3 + 1] = _c.g;
      col[i * 3 + 2] = _c.b;
    };

    for (let j = 0; j < verts; j++) {
      for (let i = 0; i < verts; i++) put(j * verts + i, ix0 + i * step, iz0 + j * step, 0);
    }

    const idx: number[] = [];
    for (let j = 0; j < segs; j++) {
      for (let i = 0; i < segs; i++) {
        const a = j * verts + i;
        const b = a + 1;
        const cc = a + verts;
        const d = cc + 1;
        // Same diagonal (b-c) as the Rapier heightfield.
        idx.push(a, cc, b, b, cc, d);
      }
    }

    // Skirt: walk the edge counter-clockwise (seen from above) and hang a strip below it.
    const ring: number[] = [];
    for (let i = 0; i < segs; i++) ring.push(i); // north edge (j = 0), +x
    for (let j = 0; j < segs; j++) ring.push(j * verts + segs); // east edge, +z
    for (let i = segs; i > 0; i--) ring.push(segs * verts + i); // south edge, -x
    for (let j = segs; j > 0; j--) ring.push(j * verts); // west edge, -z
    const base = verts * verts;
    ring.forEach((top, k) => {
      const i = top % verts;
      const j = Math.floor(top / verts);
      put(base + k, ix0 + i * step, iz0 + j * step, skirt);
      // Keep the top vertex's normal so the skirt shades like the ground above it.
      nor.copyWithin((base + k) * 3, top * 3, top * 3 + 3);
    });
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k];
      const b = ring[(k + 1) % ring.length];
      const qa = base + k;
      const qb = base + ((k + 1) % ring.length);
      // Wind so the strip faces outward: (b - a) x down must point away from the centre.
      const dx = pos[b * 3] - pos[a * 3];
      const dz = pos[b * 3 + 2] - pos[a * 3 + 2];
      const mx = (pos[a * 3] + pos[b * 3]) / 2;
      const mz = (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2;
      if (dz * mx - dx * mz > 0) idx.push(a, b, qa, b, qb, qa);
      else idx.push(a, qa, b, b, qa, qb);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(total > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }

  private updatePhysics(f: THREE.Vector3, force: boolean): void {
    if (!force && Math.hypot(f.x - this.lastPhysics.x, f.z - this.lastPhysics.z) < 4) return;
    this.lastPhysics.copy(f);
    for (const c of this.chunks) {
      const d = this.distTo(c, f);
      if (!c.collider && d <= this.physicsRadius) this.addCollider(c);
      else if (c.collider && d > this.physicsKeep) this.dropCollider(c);
    }
  }

  private addCollider(c: Chunk): void {
    const { grid } = this.opts.source;
    const n = this.cellsPerChunk;
    const N = n + 1;
    const ix0 = c.cx * n;
    const iz0 = c.cz * n;
    // Rapier wants a column-major matrix: rows run along z, columns along x.
    const heights = new Float32Array(N * N);
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) heights[j + i * N] = grid.at(ix0 + i, iz0 + j);
    }
    const physics = this.game.physics;
    c.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(c.x, 0, c.z));
    c.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.heightfield(n, n, heights, { x: this.chunkSize, y: 1, z: this.chunkSize }).setFriction(0.8),
      c.body,
    );
    physics.registerCollider(c.collider, this.entity);
  }

  private dropCollider(c: Chunk): void {
    if (!c.body) return;
    const physics = this.game.physics;
    if (c.collider) physics.unregisterCollider(c.collider);
    physics.world.removeRigidBody(c.body);
    c.body = null;
    c.collider = null;
  }
}
