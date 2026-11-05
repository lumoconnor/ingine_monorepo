import * as THREE from 'three';
import type { Game } from '../core/Game';
import { Entity } from '../entities/Entity';
import { RAPIER } from '../physics/PhysicsWorld';
import { RigidBodyComponent, type BodyType } from '../physics/RigidBodyComponent';
import { gridMaterial, worldScaleBoxUVs } from '../render/materials';
import { makeLabel } from '../render/labels';
import { Ladder } from '../gameplay/components/Ladder';
import { WaterVolume } from '../gameplay/components/WaterVolume';
import { Zipline } from '../gameplay/components/Zipline';
import { Interactable } from '../gameplay/interaction/Interactable';
import { INTERACT_ONLY_GROUPS } from '../physics/groups';

/**
 * Level-building helpers for grey-box geometry. Every helper creates a
 * render mesh and a matching collider so what you see is what you collide with.
 */

type Vec3 = [number, number, number];

export interface BoxOptions {
  name?: string;
  size: Vec3;
  /** Centre position. */
  position: Vec3;
  /** Euler rotation in degrees (XYZ). */
  rotationDeg?: Vec3;
  color: number;
  body?: BodyType;
  /** Mass density for dynamic bodies. */
  density?: number;
  friction?: number;
}

export function addBox(game: Game, o: BoxOptions): Entity {
  const [w, h, d] = o.size;
  const geo = new THREE.BoxGeometry(w, h, d);
  worldScaleBoxUVs(geo, w, h, d);
  const mesh = new THREE.Mesh(geo, gridMaterial(o.color));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(...o.position);
  if (o.rotationDeg) {
    const r = o.rotationDeg.map(THREE.MathUtils.degToRad) as Vec3;
    mesh.rotation.set(...r);
  }
  const e = new Entity(o.name ?? 'box', mesh);
  e.add(
    new RigidBodyComponent({
      type: o.body ?? 'fixed',
      colliders: [
        RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
          .setDensity(o.density ?? 1)
          .setFriction(o.friction ?? 0.7),
      ],
    }),
  );
  game.world.spawn(e);
  return e;
}

/** Project UVs per-triangle onto its dominant axis plane (metres). Non-indexed geometry only. */
function planarUVs(geo: THREE.BufferGeometry): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array((pos.count) * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (let j = 0; j < 3; j++) {
      const p = [a, b, c][j];
      let u: number, v: number;
      if (ay >= ax && ay >= az) { u = p.x; v = p.z; }
      else if (ax >= az) { u = p.z; v = p.y; }
      else { u = p.x; v = p.y; }
      uv[(i + j) * 2] = u;
      uv[(i + j) * 2 + 1] = v;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

export interface WedgeOptions {
  name?: string;
  /** Position of the bottom edge centre (the end you start walking up from). */
  position: Vec3;
  /** Direction the ramp ascends, as yaw in degrees (0 = toward -Z). */
  yawDeg?: number;
  width: number;
  height: number;
  angleDeg: number;
  color: number;
}

/** A ramp (triangular prism) with an exact slope angle. Collider is a convex hull. */
export function addWedge(game: Game, o: WedgeOptions): Entity {
  const run = o.height / Math.tan(THREE.MathUtils.degToRad(o.angleDeg));
  const hw = o.width / 2;
  // Local space: bottom edge at z=0, ascends toward -Z.
  const p = {
    bl: [-hw, 0, 0], br: [hw, 0, 0],
    fl: [-hw, 0, -run], fr: [hw, 0, -run],
    tl: [-hw, o.height, -run], tr: [hw, o.height, -run],
  } as const;
  const tris: (readonly number[])[][] = [
    [p.bl, p.br, p.tr], [p.bl, p.tr, p.tl], // slope
    [p.fl, p.tl, p.tr], [p.fl, p.tr, p.fr], // back wall
    [p.bl, p.fl, p.fr], [p.bl, p.fr, p.br], // bottom
    [p.bl, p.tl, p.fl], // left side
    [p.br, p.fr, p.tr], // right side
  ];
  const arr = new Float32Array(tris.flat(2) as number[]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  geo.computeVertexNormals();
  planarUVs(geo);

  const mesh = new THREE.Mesh(geo, gridMaterial(o.color));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(...o.position);
  mesh.rotation.y = THREE.MathUtils.degToRad(o.yawDeg ?? 0);

  const hull = new Float32Array([p.bl, p.br, p.fl, p.fr, p.tl, p.tr].flat() as number[]);
  const desc = RAPIER.ColliderDesc.convexHull(hull);
  if (!desc) throw new Error('Failed to build wedge hull');

  const e = new Entity(o.name ?? `ramp-${o.angleDeg}`, mesh);
  e.add(new RigidBodyComponent({ type: 'fixed', colliders: [desc.setFriction(0.8)] }));
  game.world.spawn(e);
  return e;
}

/** Add a floating billboard label (visual only, no collider). */
export function addLabel(game: Game, text: string, position: Vec3, scale = 1, color?: string): Entity {
  const s = makeLabel(text, { scale, color });
  s.position.set(...position);
  const e = new Entity(`label:${text}`, s);
  game.world.spawn(e);
  return e;
}

export interface LadderOptions {
  /** Bottom-centre of the ladder, on the wall face. */
  position: Vec3;
  /** Direction the ladder faces (away from the wall), as yaw in degrees: 0 = +Z, 90 = +X, 180 = -Z, -90 = -X. */
  facingDeg: number;
  height: number;
  width?: number;
  color?: number;
}

const ladderMaterial = new Map<number, THREE.MeshStandardMaterial>();

/** A climbable ladder on a wall: two rails and rungs every 30cm (visual only; the wall collides). */
export function addLadder(game: Game, o: LadderOptions): Entity {
  const width = o.width ?? 0.6;
  const color = o.color ?? 0x8a5a33;
  let mat = ladderMaterial.get(color);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
    ladderMaterial.set(color, mat);
  }
  const group = new THREE.Group();
  const standoff = 0.08; // rails sit slightly off the wall
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, o.height + 0.25, 0.07), mat);
    rail.position.set((side * width) / 2, (o.height + 0.25) / 2, standoff);
    rail.castShadow = true;
    group.add(rail);
  }
  const rungGeo = new THREE.CylinderGeometry(0.025, 0.025, width, 8);
  rungGeo.rotateZ(Math.PI / 2);
  for (let y = 0.3; y < o.height + 0.05; y += 0.3) {
    const rung = new THREE.Mesh(rungGeo, mat);
    rung.position.set(0, y, standoff);
    rung.castShadow = true;
    group.add(rung);
  }
  group.position.set(...o.position);
  group.rotation.y = THREE.MathUtils.degToRad(o.facingDeg);
  const e = new Entity('ladder', group);
  e.tags.add('ladder');
  e.add(new Ladder(width, o.height));
  game.world.spawn(e);
  return e;
}

export interface WaterOptions {
  /** Footprint corners (x, z) and the surface height. */
  min: [number, number];
  max: [number, number];
  surfaceY: number;
  /** Lowest point the water reaches (the floor). */
  bottomY: number;
  color?: number;
  /** Flow velocity (x, z) in m/s, for rivers. */
  current?: [number, number];
}

let waterTexture: THREE.CanvasTexture | null = null;
/** Soft light streaks, tiled every 4m; scrolled by WaterVolume to show the current. */
function getWaterTexture(): THREE.CanvasTexture {
  if (waterTexture) return waterTexture;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.strokeStyle = 'rgba(160, 205, 235, 0.9)';
  g.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const x = rnd() * size, y = rnd() * size, len = 10 + rnd() * 26;
    g.lineWidth = 1 + rnd() * 2;
    for (const dx of [-size, 0, size]) {
      g.beginPath();
      g.moveTo(x + dx, y);
      g.lineTo(x + dx + len, y + (rnd() - 0.5) * 2);
      g.stroke();
    }
  }
  waterTexture = new THREE.CanvasTexture(c);
  waterTexture.wrapS = waterTexture.wrapT = THREE.RepeatWrapping;
  waterTexture.colorSpace = THREE.SRGBColorSpace;
  return waterTexture;
}

/** A box of swimmable water with a rippling, see-through surface. */
export function addWater(game: Game, o: WaterOptions): Entity {
  const w = o.max[0] - o.min[0];
  const d = o.max[1] - o.min[1];
  const geo = new THREE.PlaneGeometry(w, d, Math.ceil(w * 2), Math.ceil(d * 2));
  const flowing = !!o.current && (o.current[0] !== 0 || o.current[1] !== 0);
  let map: THREE.Texture | null = null;
  if (flowing) {
    map = getWaterTexture().clone();
    map.repeat.set(w / 4, d / 4);
    // Streaks are drawn along u; turn them to follow the current.
    map.center.set(0.5, 0.5);
    map.rotation = Math.atan2(o.current![1], o.current![0]);
    map.needsUpdate = true;
  }
  const mat = new THREE.MeshStandardMaterial({
    map,
    color: o.color ?? 0x2f86c0,
    transparent: true,
    opacity: 0.6,
    roughness: 0.12,
    metalness: 0.05,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((o.min[0] + o.max[0]) / 2, o.surfaceY, (o.min[1] + o.max[1]) / 2);
  mesh.receiveShadow = true;
  const e = new Entity('water', mesh);
  e.tags.add('water');
  e.add(
    new WaterVolume(
      new THREE.Vector3(o.min[0], o.bottomY, o.min[1]),
      new THREE.Vector3(o.max[0], o.surfaceY, o.max[1]),
      new THREE.Vector3(o.current?.[0] ?? 0, 0, o.current?.[1] ?? 0),
    ),
  );
  game.world.spawn(e);
  return e;
}

export interface ZiplineOptions {
  /** Rope anchor points (where it attaches to the posts), world space. */
  from: Vec3;
  to: Vec3;
  /** Height of the posts the rope hangs from (they stand on whatever is below each anchor). */
  postHeight?: number;
}

const ropeMat = new THREE.MeshStandardMaterial({ color: 0x5a5a5a, roughness: 0.5, metalness: 0.2 });
const armMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.85 });

/**
 * A zipline: a cable between two posts. Grab it with E (or jump into it),
 * slide down, pull hand over hand with W, let go with Space.
 */
export function addZipline(game: Game, o: ZiplineOptions): Entity {
  const a = new THREE.Vector3(...o.from);
  const b = new THREE.Vector3(...o.to);
  const len = a.distanceTo(b);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const dir = b.clone().sub(a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

  const root = new THREE.Group();
  root.position.copy(mid);
  root.quaternion.copy(q);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, len, 8), ropeMat);
  cable.castShadow = true;
  root.add(cable);

  const e = new Entity('zipline', root);
  e.tags.add('zipline');
  // Fat invisible capsule along the cable so it's easy to aim at; the player never collides with it.
  e.add(
    new RigidBodyComponent({
      type: 'fixed',
      colliders: [RAPIER.ColliderDesc.capsule(len / 2, 0.18).setCollisionGroups(INTERACT_ONLY_GROUPS)],
    }),
  );
  const zip = e.add(new Zipline(a, b));
  e.add(
    new Interactable({
      prompt: 'Grab zipline',
      range: 3,
      onInteract: (user) => {
        const ctrl = user.getAll().find((c) => 'grabZipline' in c) as unknown as { grabZipline(z: Zipline): void } | undefined;
        ctrl?.grabZipline(zip);
      },
    }),
  );
  game.world.spawn(e);

  // Posts: a pole under each anchor with a short arm the cable hangs from.
  const postH = o.postHeight ?? 2.6;
  for (const p of [a, b]) {
    // Off to the side of the cable, so riders popping off the end don't hit it.
    const flat = new THREE.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(0.65);
    addBox(game, { name: 'zipline-pole', size: [0.16, postH, 0.16], position: [p.x + flat.x, p.y + 0.15 - postH / 2, p.z + flat.z], color: 0x6b4a2f });
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.6), armMat);
    arm.position.set(p.x + flat.x / 2, p.y + 0.1, p.z + flat.z / 2);
    arm.lookAt(p.x, p.y + 0.1, p.z);
    arm.castShadow = true;
    const pe = new Entity('zipline-post', new THREE.Group());
    pe.object3d.add(arm);
    game.world.spawn(pe);
  }
  return e;
}
