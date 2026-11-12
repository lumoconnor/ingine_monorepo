import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Game } from '../core/Game';
import { Entity } from '../entities/Entity';
import { RAPIER } from '../physics/PhysicsWorld';
import { RigidBodyComponent } from '../physics/RigidBodyComponent';
import { gridMaterial, worldScaleBoxUVs } from '../render/materials';

export interface BatchPieceOptions {
  /** Add a collider for it (default true). */
  collide?: boolean;
  /** Turn about the vertical axis, radians (0 = local +Z faces world +Z). */
  yaw?: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Collects lots of static grey-box pieces (a whole village) and turns them
 * into one mesh per colour and one fixed body with all the colliders. A few
 * dozen draw calls for a town instead of thousands.
 */
export class StaticBatch {
  private geos = new Map<number, THREE.BufferGeometry[]>();
  private colliders: RAPIER.ColliderDesc[] = [];
  /** Pieces added so far (for stats and tests). */
  pieces = 0;

  /** A box centred at (x, y, z). */
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: number, o: BatchPieceOptions = {}): void {
    if (w < 1e-3 || h < 1e-3 || d < 1e-3) return;
    const geo = new THREE.BoxGeometry(w, h, d);
    worldScaleBoxUVs(geo, w, h, d);
    const yaw = o.yaw ?? 0;
    this.add(geo, x, y, z, yaw, color);
    if (o.collide ?? true) {
      _q.setFromAxisAngle(_up, yaw);
      this.colliders.push(
        RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(x, y, z).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }),
      );
    }
  }

  /**
   * A gable roof: a triangular prism `w` wide (across the ridge), `d` long
   * (along the ridge, local Z), `h` tall, with its base centred at (x, y, z).
   */
  gable(w: number, d: number, h: number, x: number, y: number, z: number, color: number, o: BatchPieceOptions = {}): void {
    const hw = w / 2;
    const hd = d / 2;
    const slope = Math.hypot(hw, h);
    // Two sloped faces and two triangular ends, each with its own normals and metre UVs.
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const quad = (a: number[], b: number[], c: number[], e: number[], uvs: number[]) => {
      const i = pos.length / 3;
      pos.push(...a, ...b, ...c, ...e);
      uv.push(...uvs);
      idx.push(i, i + 2, i + 1, i, i + 3, i + 2);
    };
    quad([-hw, 0, hd], [-hw, 0, -hd], [0, h, -hd], [0, h, hd], [0, 0, d, 0, d, slope, 0, slope]);
    quad([hw, 0, -hd], [hw, 0, hd], [0, h, hd], [0, h, -hd], [0, 0, d, 0, d, slope, 0, slope]);
    for (const s of [1, -1]) {
      const i = pos.length / 3;
      pos.push(-hw * s, 0, hd * s, hw * s, 0, hd * s, 0, h, hd * s);
      uv.push(0, 0, w, 0, hw, h);
      idx.push(i, i + 1, i + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const yaw = o.yaw ?? 0;
    this.add(geo, x, y, z, yaw, color);
    if (o.collide ?? true) {
      _q.setFromAxisAngle(_up, yaw);
      const pts = new Float32Array([-hw, 0, -hd, hw, 0, -hd, -hw, 0, hd, hw, 0, hd, 0, h, -hd, 0, h, hd]);
      const c = RAPIER.ColliderDesc.convexHull(pts);
      if (c) this.colliders.push(c.setTranslation(x, y, z).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }));
    }
  }

  /** A four-sided pyramid roof (towers), base centred at (x, y, z). */
  pyramid(w: number, d: number, h: number, x: number, y: number, z: number, color: number, o: BatchPieceOptions = {}): void {
    const geo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).toNonIndexed();
    geo.rotateY(Math.PI / 4);
    geo.scale(w, h, d);
    geo.translate(0, h / 2, 0);
    // Rough metre UVs: planar from the side.
    const p = geo.attributes.position as THREE.BufferAttribute;
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      uv[i * 2] = p.getX(i) + p.getZ(i);
      uv[i * 2 + 1] = p.getY(i);
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const yaw = o.yaw ?? 0;
    this.add(withIndex(geo), x, y, z, yaw, color);
    if (o.collide ?? true) {
      _q.setFromAxisAngle(_up, yaw);
      const pts = new Float32Array([-w / 2, 0, -d / 2, w / 2, 0, -d / 2, -w / 2, 0, d / 2, w / 2, 0, d / 2, 0, h, 0]);
      const c = RAPIER.ColliderDesc.convexHull(pts);
      if (c) this.colliders.push(c.setTranslation(x, y, z).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }));
    }
  }

  /** An upright cylinder (wells, posts), base centred at (x, y, z). */
  cylinder(r: number, h: number, x: number, y: number, z: number, color: number, o: BatchPieceOptions & { segments?: number } = {}): void {
    const geo = new THREE.CylinderGeometry(r, r, h, o.segments ?? 10, 1);
    geo.translate(0, h / 2, 0);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * r, uv.getY(i) * h);
    this.add(geo, x, y, z, 0, color);
    if (o.collide ?? true) this.colliders.push(RAPIER.ColliderDesc.cylinder(h / 2, r).setTranslation(x, y + h / 2, z));
  }

  /** Builds the meshes and the body, spawns them as one entity, and empties the batch. */
  build(game: Game, name: string): Entity {
    const root = new THREE.Group();
    for (const [color, list] of this.geos) {
      const geo = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!geo) continue;
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, gridMaterial(color));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
    }
    const e = new Entity(name, root);
    if (this.colliders.length) e.add(new RigidBodyComponent({ type: 'fixed', colliders: this.colliders }));
    game.world.spawn(e);
    this.geos.clear();
    this.colliders = [];
    return e;
  }

  private add(geo: THREE.BufferGeometry, x: number, y: number, z: number, yaw: number, color: number): void {
    _q.setFromAxisAngle(_up, yaw);
    geo.applyMatrix4(_m.compose(_p.set(x, y, z), _q, _s));
    if (!geo.index) geo = withIndex(geo);
    let list = this.geos.get(color);
    if (!list) this.geos.set(color, (list = []));
    list.push(geo);
    this.pieces++;
  }
}

/** mergeGeometries wants every part indexed (or none). */
function withIndex(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  if (geo.index) return geo;
  const n = geo.attributes.position.count;
  const idx = new Array<number>(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  geo.setIndex(idx);
  return geo;
}
