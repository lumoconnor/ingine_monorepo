import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Component } from '../../entities/Component';
import { RAPIER } from '../../physics/PhysicsWorld';

/** One tree (or bush) in the world. */
export interface TreeInstance {
  x: number;
  /** Ground height at the base. */
  y: number;
  z: number;
  /** Index into the forest's kinds. */
  kind: number;
  scale: number;
  yaw: number;
  /** 0..1, picks a shade of the kind's colours. */
  tint: number;
}

export interface TreeKind {
  /** One geometry with vertex colours, base at y = 0, for scale 1. */
  geometry: THREE.BufferGeometry;
  /** Trunk collider for scale 1 (none for bushes). */
  trunk?: { radius: number; height: number };
}

export interface ForestOptions {
  kinds: TreeKind[];
  trees: TreeInstance[];
  /** Side of a drawing region, metres: one instanced mesh per kind per region. Default 256. */
  region?: number;
  /** Trunks get colliders within this distance of the focus. Default 70 m. */
  colliderRadius?: number;
  /** Regions further than this aren't drawn (the fog has them by then). Default 1100 m. */
  drawDistance?: number;
  /** Regions within this distance cast shadows. Default 260 m. */
  shadowDistance?: number;
  focus: () => THREE.Vector3 | undefined;
}

/** Collider cells, metres. */
const CELL = 32;

/**
 * A whole map's worth of trees. Drawn as instanced meshes per region (so
 * regions behind you are culled), with trunk colliders only near the focus,
 * added and dropped as it moves, like the terrain's.
 */
export class Forest extends Component {
  /** Live trunk colliders (tests). */
  colliderCount = 0;
  readonly root = new THREE.Group();

  private cells = new Map<string, TreeInstance[]>();
  private regionMeshes: { mesh: THREE.InstancedMesh; x: number; z: number; r: number }[] = [];
  private visTimer = 0;
  private bodies = new Map<string, RAPIER.RigidBody>();
  private material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });

  constructor(private o: ForestOptions) {
    super();
  }

  onAttach(): void {
    const R = this.o.region ?? 256;
    const regions = new Map<string, TreeInstance[][]>();
    for (const t of this.o.trees) {
      const key = `${Math.floor(t.x / R)},${Math.floor(t.z / R)}`;
      let byKind = regions.get(key);
      if (!byKind) regions.set(key, (byKind = this.o.kinds.map(() => [])));
      byKind[t.kind].push(t);
      if (this.o.kinds[t.kind].trunk) {
        const ck = `${Math.floor(t.x / CELL)},${Math.floor(t.z / CELL)}`;
        let cell = this.cells.get(ck);
        if (!cell) this.cells.set(ck, (cell = []));
        cell.push(t);
      }
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    for (const byKind of regions.values()) {
      byKind.forEach((list, k) => {
        if (!list.length) return;
        const mesh = new THREE.InstancedMesh(this.o.kinds[k].geometry, this.material, list.length);
        list.forEach((t, i) => {
          q.setFromAxisAngle(up, t.yaw);
          mesh.setMatrixAt(i, m.compose(p.set(t.x, t.y - 0.15, t.z), q, s.setScalar(t.scale)));
          // A little light/dark variety between trees.
          const v = 0.82 + t.tint * 0.3;
          mesh.setColorAt(i, c.setRGB(v, v, v * (0.95 + t.tint * 0.1)));
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.root.add(mesh);
        const bs = mesh.boundingSphere!;
        this.regionMeshes.push({ mesh, x: bs.center.x, z: bs.center.z, r: bs.radius });
      });
    }
    this.entity.object3d.add(this.root);
  }

  onDetach(): void {
    for (const b of this.bodies.values()) this.game.physics.world.removeRigidBody(b);
    this.bodies.clear();
    this.root.removeFromParent();
  }

  /** Regions: hide far ones, and only near ones cast shadows. Checked a few times a second. */
  update(time: { delta: number }): void {
    this.visTimer -= time.delta;
    if (this.visTimer > 0) return;
    this.visTimer = 0.4;
    const f = this.o.focus();
    if (!f) return;
    const far = this.o.drawDistance ?? 1100;
    const shadow = this.o.shadowDistance ?? 260;
    for (const m of this.regionMeshes) {
      const d = Math.max(0, Math.hypot(m.x - f.x, m.z - f.z) - m.r);
      m.mesh.visible = d < far;
      m.mesh.castShadow = d < shadow;
    }
  }

  fixedUpdate(): void {
    const f = this.o.focus();
    if (!f) return;
    const r = this.o.colliderRadius ?? 70;
    const keep = r + CELL;
    const world = this.game.physics.world;
    // Drop cells left behind.
    for (const [key, body] of this.bodies) {
      const [cx, cz] = key.split(',').map(Number);
      if (Math.hypot((cx + 0.5) * CELL - f.x, (cz + 0.5) * CELL - f.z) > keep + CELL) {
        this.colliderCount -= body.numColliders();
        world.removeRigidBody(body);
        this.bodies.delete(key);
      }
    }
    // Add cells coming into range.
    const n = Math.ceil(r / CELL) + 1;
    const fx = Math.floor(f.x / CELL);
    const fz = Math.floor(f.z / CELL);
    for (let dz = -n; dz <= n; dz++) {
      for (let dx = -n; dx <= n; dx++) {
        const key = `${fx + dx},${fz + dz}`;
        if (this.bodies.has(key)) continue;
        const trees = this.cells.get(key);
        if (!trees) continue;
        if (Math.hypot((fx + dx + 0.5) * CELL - f.x, (fz + dz + 0.5) * CELL - f.z) > r + CELL * 0.71) continue;
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
        for (const t of trees) {
          const tr = this.o.kinds[t.kind].trunk!;
          const h = tr.height * t.scale;
          world.createCollider(RAPIER.ColliderDesc.cylinder(h / 2, tr.radius * t.scale).setTranslation(t.x, t.y + h / 2 - 0.3, t.z), body);
        }
        this.colliderCount += trees.length;
        this.bodies.set(key, body);
      }
    }
  }
}

// --- Greybox tree models -------------------------------------------------------

function colored(geo: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** A conifer: a trunk and three stacked cones. ~9 m tall at scale 1. */
export function pineGeometry(trunk = 0x5a4130, needles = 0x2f5a35): THREE.BufferGeometry {
  const parts = [colored(new THREE.CylinderGeometry(0.14, 0.24, 3.2, 6).translate(0, 1.6, 0), trunk)];
  for (const [y, r, h] of [[2.2, 2.3, 3.4], [4.0, 1.8, 3.0], [5.7, 1.2, 2.8]]) {
    parts.push(colored(new THREE.ConeGeometry(r, h, 7, 1).translate(0, y + h / 2, 0), needles));
  }
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

/** A broadleaf: a trunk and a lumpy round crown. ~8 m tall at scale 1. */
export function oakGeometry(trunk = 0x5e4632, leaves = 0x4c7a3a): THREE.BufferGeometry {
  const crown = new THREE.IcosahedronGeometry(2.6, 0);
  // Lumpy: push vertices in and out a little, deterministically.
  const p = crown.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.12 * Math.sin(x * 3.1 + z * 2.3) * Math.cos(y * 2.7);
    p.setXYZ(i, x * k, y * k * 0.85, z * k);
  }
  const parts = [
    colored(new THREE.CylinderGeometry(0.22, 0.34, 4.2, 7).translate(0, 2.1, 0), trunk),
    colored(crown.translate(0, 5.2, 0), leaves),
  ];
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

/** A bush: a squashed lump. No collider. */
export function bushGeometry(leaves = 0x557a3f): THREE.BufferGeometry {
  const g = colored(new THREE.IcosahedronGeometry(0.9, 0).scale(1.2, 0.7, 1.1).translate(0, 0.45, 0), leaves);
  g.computeVertexNormals();
  return g;
}
