import * as THREE from 'three';
import { compile, Field, quatEuler, qrot, type Prim, type V3 } from './sdf';
import { meshField, bakeSurface, type Paint, type Tint } from './mesher';
import { bakedPainterlyMaterial } from './PainterlyMaterial';

/**
 * A code-sculpted model: primitives + paints + a skeleton, split into mesh
 * pieces that are meshed at their own resolution (a face needs finer clay
 * than a coat).
 *
 * Primitives are written in the REST pose (arms hanging, legs straight,
 * facing +Z, feet on y = 0). A skinned piece is meshed in a BIND pose where
 * some bones are turned (arms out, legs apart) so limbs don't fuse to the
 * body, then bound, then put back to rest. Rigid pieces (head, hands) are
 * meshed in rest pose and parented to their bone.
 */

export interface BoneDef {
  name: string;
  parent: string | null;
  /** Rest-pose position in model space. */
  pos: V3;
  /** Bind-pose local rotation (Euler XYZ, radians) for skinned pieces. */
  bind?: V3;
}

export interface PieceDef {
  name: string;
  /** Grid cell size (m): ~0.01 for bodies, ~0.0035 for faces. */
  cell: number;
  /** Skinned to the whole skeleton, or rigidly attached to `bone`. */
  skinned?: boolean;
  bone?: string;
  /** Override the automatic bounds. */
  min?: V3;
  max?: V3;
}

export interface Extra {
  bone: string;
  /** Made at assembly time (never in a meshing worker). Positioned in model space. */
  make: () => THREE.Object3D;
}

const srgb = new THREE.Color();
/** '#rrggbb' or 0xrrggbb (sRGB) -> linear RGB triple. */
export function lin(c: string | number): V3 {
  srgb.set(c as THREE.ColorRepresentation);
  return [srgb.r, srgb.g, srgb.b];
}

export class Sculpt {
  readonly paints: Paint[] = [];
  readonly tints: Tint[] = [];
  readonly prims: Prim[] = [];
  readonly bones: BoneDef[] = [];
  readonly pieces: PieceDef[] = [];
  readonly extras: Extra[] = [];
  /** Defaults applied to the next primitives. */
  piece = 'body';
  bone = 'root';
  valueRamp: [number, number, number] = [0, 1.6, 0.7];
  hipY?: number;
  kneeY?: number;

  addPaint(p: Paint): number {
    this.paints.push(p);
    return this.paints.length - 1;
  }

  add<T extends Prim>(p: T): T {
    p.piece ??= this.piece;
    p.bone ??= this.bone;
    this.prims.push(p);
    return p;
  }

  tint(t: Tint): void {
    t.piece ??= this.piece;
    t.bone ??= this.bone;
    this.tints.push(t);
  }

  boneDef(name: string): BoneDef {
    const b = this.bones.find((x) => x.name === name);
    if (!b) throw new Error(`Sculpt: no bone "${name}"`);
    return b;
  }
}

/** Bind-pose world transform of each bone: [quaternion, position]. */
function bindPose(s: Sculpt): Map<string, { q: [number, number, number, number]; p: V3 }> {
  const out = new Map<string, { q: [number, number, number, number]; p: V3 }>();
  const get = (name: string): { q: [number, number, number, number]; p: V3 } => {
    const hit = out.get(name);
    if (hit) return hit;
    const b = s.boneDef(name);
    const lq = b.bind ? quatEuler(...b.bind) : ([0, 0, 0, 1] as [number, number, number, number]);
    if (!b.parent) {
      const r = { q: lq, p: b.pos };
      out.set(name, r);
      return r;
    }
    const par = get(b.parent);
    const pb = s.boneDef(b.parent);
    const off = qrot(par.q, [b.pos[0] - pb.pos[0], b.pos[1] - pb.pos[1], b.pos[2] - pb.pos[2]]);
    const r = { q: qmul(par.q, lq), p: [par.p[0] + off[0], par.p[1] + off[1], par.p[2] + off[2]] as V3 };
    out.set(name, r);
    return r;
  };
  for (const b of s.bones) get(b.name);
  return out;
}

function qmul(a: [number, number, number, number], b: [number, number, number, number]): [number, number, number, number] {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}

/** 3x4 row-major: bind-space point -> rest-space point, for one bone. */
function toRestMatrix(rest: V3, bind: { q: [number, number, number, number]; p: V3 }): Float64Array {
  const qi: [number, number, number, number] = [-bind.q[0], -bind.q[1], -bind.q[2], bind.q[3]];
  const ex = qrot(qi, [1, 0, 0]), ey = qrot(qi, [0, 1, 0]), ez = qrot(qi, [0, 0, 1]);
  // R = rotation by qi: columns ex, ey, ez.
  const R = [ex[0], ey[0], ez[0], ex[1], ey[1], ez[1], ex[2], ey[2], ez[2]];
  const t = [
    rest[0] - (R[0] * bind.p[0] + R[1] * bind.p[1] + R[2] * bind.p[2]),
    rest[1] - (R[3] * bind.p[0] + R[4] * bind.p[1] + R[5] * bind.p[2]),
    rest[2] - (R[6] * bind.p[0] + R[7] * bind.p[1] + R[8] * bind.p[2]),
  ];
  return new Float64Array([R[0], R[1], R[2], t[0], R[3], R[4], R[5], t[1], R[6], R[7], R[8], t[2]]);
}

export interface BuiltSculpt {
  root: THREE.Group;
  bones: Map<string, THREE.Object3D>;
  stats: { piece: string; verts: number; tris: number; ms: number }[];
}

/** One meshed piece as plain arrays (transferable from a worker). */
export interface PieceMesh {
  piece: string;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  colors: Float32Array;
  paint: Float32Array;
  skinIndex?: Uint16Array;
  skinWeight?: Float32Array;
  ms: number;
}

/** The slow, pure part: mesh and bake every piece. Safe to run in a worker. */
export function meshSculpt(s: Sculpt): PieceMesh[] {
  const bind = bindPose(s);
  const restMats = new Map<string, Float64Array>();
  for (const b of s.bones) restMats.set(b.name, toRestMatrix(b.pos, bind.get(b.name)!));
  const boneIndex = new Map<string, number>();
  s.bones.forEach((b, i) => boneIndex.set(b.name, i));
  const out: PieceMesh[] = [];
  for (const piece of s.pieces) {
    const t0 = performance.now();
    const prims = s.prims.filter((p) => p.piece === piece.name);
    if (!prims.length) continue;
    const posed = !!piece.skinned;
    const compiled = prims.map((p, i) => compile(p, i, posed ? restMats.get(p.bone ?? 'root') ?? null : null));
    const field = new Field(compiled);
    let min = piece.min, max = piece.max;
    if (!min || !max) {
      const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
      for (const c of compiled) {
        if (c.sub) continue;
        for (let a = 0; a < 3; a++) {
          lo[a] = Math.min(lo[a], c.bc[a] - c.br);
          hi[a] = Math.max(hi[a], c.bc[a] + c.br);
        }
      }
      const pad = piece.cell * 2;
      min ??= [lo[0] - pad, lo[1] - pad, lo[2] - pad];
      max ??= [hi[0] + pad, hi[1] + pad, hi[2] + pad];
    }
    const mesh = meshField(field, min, max, piece.cell);
    const baked = bakeSurface(field, mesh, {
      paints: s.paints,
      tints: s.tints.filter((t) => t.piece === piece.name),
      bones: posed ? boneIndex : undefined,
      hipY: s.hipY,
      kneeY: s.kneeY,
      valueRamp: s.valueRamp,
      toRestOf: posed ? (b) => restMats.get(b) ?? null : undefined,
    });
    out.push({ piece: piece.name, ...mesh, ...baked, ms: Math.round(performance.now() - t0) });
  }
  return out;
}

/** Turns meshed pieces into a rigged THREE object (fast). */
export function assembleSculpt(s: Sculpt, meshes: PieceMesh[]): BuiltSculpt {
  const root = new THREE.Group();
  const boneObjs = new Map<string, THREE.Bone>();
  for (const b of s.bones) {
    const bone = new THREE.Bone();
    bone.name = b.name;
    boneObjs.set(b.name, bone);
  }
  for (const b of s.bones) {
    const bone = boneObjs.get(b.name)!;
    if (b.parent) {
      const p = s.boneDef(b.parent);
      bone.position.set(b.pos[0] - p.pos[0], b.pos[1] - p.pos[1], b.pos[2] - p.pos[2]);
      boneObjs.get(b.parent)!.add(bone);
    } else {
      bone.position.set(...b.pos);
      root.add(bone);
    }
  }
  const stats: BuiltSculpt['stats'] = [];
  const material = bakedPainterlyMaterial();
  for (const m of meshes) {
    const piece = s.pieces.find((p) => p.name === m.piece)!;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(m.colors, 3));
    geo.setAttribute('paint', new THREE.BufferAttribute(m.paint, 4));
    geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
    let obj: THREE.Mesh;
    if (piece.skinned) {
      geo.setAttribute('skinIndex', new THREE.BufferAttribute(m.skinIndex!, 4));
      geo.setAttribute('skinWeight', new THREE.BufferAttribute(m.skinWeight!, 4));
      obj = new THREE.SkinnedMesh(geo, material);
      root.add(obj);
    } else {
      const bone = s.boneDef(piece.bone ?? 'root');
      geo.translate(-bone.pos[0], -bone.pos[1], -bone.pos[2]);
      obj = new THREE.Mesh(geo, material);
      boneObjs.get(bone.name)!.add(obj);
    }
    geo.computeBoundingSphere();
    obj.name = `piece_${piece.name}`;
    obj.castShadow = true;
    obj.receiveShadow = true;
    stats.push({ piece: piece.name, verts: m.positions.length / 3, tris: m.indices.length / 3, ms: m.ms });
  }

  // Bind skinned pieces in the bind pose, then return the bones to rest.
  const skinned = root.children.filter((c): c is THREE.SkinnedMesh => (c as THREE.SkinnedMesh).isSkinnedMesh);
  if (skinned.length) {
    for (const b of s.bones) {
      if (b.bind) boneObjs.get(b.name)!.rotation.set(...b.bind);
    }
    root.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(s.bones.map((b) => boneObjs.get(b.name)!));
    for (const m of skinned) m.bind(skeleton);
    for (const b of s.bones) boneObjs.get(b.name)!.rotation.set(0, 0, 0);
    root.updateMatrixWorld(true);
    // Skinned bounds follow the bones; keep them from being culled while animating.
    for (const m of skinned) m.frustumCulled = false;
  }
  for (const e of s.extras) {
    const bone = s.boneDef(e.bone);
    const o = e.make();
    o.position.x -= bone.pos[0];
    o.position.y -= bone.pos[1];
    o.position.z -= bone.pos[2];
    boneObjs.get(e.bone)!.add(o);
  }
  return { root, bones: boneObjs as Map<string, THREE.Object3D>, stats };
}

/** Meshes, paints and rigs a sculpt on this thread. Slow (hundreds of ms to seconds): build once, then clone. */
export function buildSculpt(s: Sculpt): BuiltSculpt {
  return assembleSculpt(s, meshSculpt(s));
}
