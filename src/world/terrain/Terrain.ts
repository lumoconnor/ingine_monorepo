import * as THREE from 'three';
import type { Game } from '@/core/Game';
import { Entity } from '@/entities/Entity';
import { RAPIER } from '@/physics/PhysicsWorld';
import { RigidBodyComponent } from '@/physics/RigidBodyComponent';
import { getGridTexture } from '@/render/materials';

export type HeightFn = (x: number, z: number) => number;

export interface TerrainOptions {
  /** World-space centre of this terrain tile. */
  center?: THREE.Vector2;
  /** Side length in metres. */
  size: number;
  /** Quads per side. */
  segments: number;
  height: HeightFn;
}

/**
 * Builds a terrain tile from a height function: a render mesh with
 * slope/height-based vertex colouring plus a matching static trimesh collider.
 *
 * For the open world this becomes one chunk in a streamed grid (same height
 * function, different centres, LOD by `segments`).
 */
export function createTerrain(game: Game, opts: TerrainOptions): Entity {
  const { size, segments, height } = opts;
  const cx = opts.center?.x ?? 0;
  const cz = opts.center?.y ?? 0;
  const verts = segments + 1;

  const positions = new Float32Array(verts * verts * 3);
  const uvs = new Float32Array(verts * verts * 2);
  const indices = new Uint32Array(segments * segments * 6);

  for (let iz = 0; iz < verts; iz++) {
    for (let ix = 0; ix < verts; ix++) {
      const i = iz * verts + ix;
      const x = cx - size / 2 + (ix / segments) * size;
      const z = cz - size / 2 + (iz / segments) * size;
      positions[i * 3] = x;
      positions[i * 3 + 1] = height(x, z);
      positions[i * 3 + 2] = z;
      uvs[i * 2] = x / 2;
      uvs[i * 2 + 1] = z / 2;
    }
  }
  let k = 0;
  for (let iz = 0; iz < segments; iz++) {
    for (let ix = 0; ix < segments; ix++) {
      const a = iz * verts + ix;
      const b = a + 1;
      const c = a + verts;
      const d = c + 1;
      // Counter-clockwise when viewed from above (+Y)
      indices[k++] = a; indices[k++] = c; indices[k++] = b;
      indices[k++] = b; indices[k++] = c; indices[k++] = d;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();

  // Colour by slope (rock on steep faces) and height (lighter grass up high).
  const normals = geo.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(verts * verts * 3);
  const grass = new THREE.Color(0x6f9a58);
  const grassHigh = new THREE.Color(0x9bb36c);
  const rock = new THREE.Color(0x8a8378);
  const col = new THREE.Color();
  for (let i = 0; i < verts * verts; i++) {
    const ny = normals.getY(i);
    const y = positions[i * 3 + 1];
    col.copy(grass).lerp(grassHigh, THREE.MathUtils.clamp(y / 25, 0, 1));
    col.lerp(rock, THREE.MathUtils.smoothstep(1 - ny, 0.18, 0.35));
    colors.set([col.r, col.g, col.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: getGridTexture(),
    roughness: 0.95,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;

  const entity = new Entity('terrain', mesh);
  entity.tags.add('terrain');
  entity.add(
    new RigidBodyComponent({
      type: 'fixed',
      colliders: [RAPIER.ColliderDesc.trimesh(positions, indices).setFriction(0.8)],
    }),
  );
  game.world.spawn(entity);
  return entity;
}
