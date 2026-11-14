import * as THREE from 'three';
import type { Game } from '@ingine/engine/core/Game';
import { Entity } from '@ingine/engine/entities/Entity';
import { RAPIER } from '@ingine/engine/physics/PhysicsWorld';
import { RigidBodyComponent } from '@ingine/engine/physics/RigidBodyComponent';
import { addNpc } from '@ingine/engine/world/npcs';
import { Npc } from '@ingine/engine/gameplay/components/Npc';
import { Wander } from '@ingine/engine/gameplay/components/Wander';
import { Interactable } from '@ingine/engine/gameplay/interaction/Interactable';
import type { DialogueSystem } from '@ingine/engine/dialogue/DialogueSystem';
import { addItemPickup } from '@ingine/engine/inventory/pickups';
import { makeLabel } from '@ingine/engine/render/labels';
import type { Teleports } from '../Teleports';
import { sceneById, type Vec3 } from '../scenes';
import { box, cylinder, decor, label, mat, seeded, sign } from './kit';
import { buildReturnPad } from './hub';

/**
 * The Arup office: a big open floor high above the city. You step out of the
 * middle lift into reception, facing the Arup sign. Aurora is on reception,
 * Chris is in the open-plan desks, Renee is in the kitchen and Big Liz (a
 * very large, very friendly lizard) does laps of the atrium.
 *
 * Plan (relative to the scene origin, metres, north is -Z):
 *
 *   z -20 ┌──────────────┬────────────────┬──────────────┐
 *         │  lounge      │  atrium        │  kitchen     │
 *   z  -8 ├──────────────┤  (Big Liz)     ├──────────────┤
 *         │  open plan   ├── reception ───┤  meeting rm  │
 *         │  (Chris)     │  ARUP (Aurora) │              │
 *   z  12 └──────────────┴───[ lifts ]────┴──────────────┘
 *        x -22          -8               8             22
 */

const W = 22;
const NZ = -20;
const SZ = 12;
/** Floor to ceiling: tall, so Big Liz fits. */
const H = 4.6;
const WALL = 0.2;

const C = {
  carpet: 0x4f5864,
  tiles: 0xd8d4cc,
  wall: 0xeeeae2,
  feature: 0xe61e2b,
  ceiling: 0xf4f4f2,
  wood: 0xc9a77c,
  metal: 0x8a9099,
  dark: 0x2a2e35,
  chair: 0x3d4a5c,
  sofa: 0x6d8fa6,
  plant: 0x4f8a45,
  pot: 0x9b6b4a,
  glass: 0xbfd8ea,
};

type At = (x: number, y: number, z: number) => Vec3;

export function buildArup(game: Game, teleports: Teleports, index: number): void {
  const s = sceneById('arup')!;
  const [ox, oy, oz] = s.origin;
  const at: At = (x, y, z) => [ox + x, oy + y, oz + z];

  shell(game, at);
  city(game, at);
  lifts(game, at);
  reception(game, at);
  openPlan(game, at);
  atrium(game, at);
  kitchen(game, at);
  meetingRoom(game, at);
  lounge(game, at);
  people(game, at);
  buildReturnPad(game, teleports, s, index);
}

// --- Building ------------------------------------------------------------------

/** Axis-aligned wall from a to b (x,z), full height, with door openings [from, to] along it. */
function wall(game: Game, at: At, a: [number, number], b: [number, number], color = C.wall, doors: [number, number][] = [], h = H): void {
  const alongX = a[1] === b[1];
  const from = alongX ? Math.min(a[0], b[0]) : Math.min(a[1], b[1]);
  const to = alongX ? Math.max(a[0], b[0]) : Math.max(a[1], b[1]);
  const fixed = alongX ? a[1] : a[0];
  const piece = (s: number, e: number, y0: number, y1: number) => {
    if (e - s < 0.01) return;
    const mid = (s + e) / 2;
    const size: Vec3 = alongX ? [e - s, y1 - y0, WALL] : [WALL, y1 - y0, e - s];
    box(game, size, alongX ? at(mid, (y0 + y1) / 2, fixed) : at(fixed, (y0 + y1) / 2, mid), color, 'wall');
  };
  let p = from;
  for (const [s, e] of [...doors].sort((x, y) => x[0] - y[0])) {
    piece(p, s, 0, h);
    piece(s, e, 2.3, h);
    p = e;
  }
  piece(p, to, 0, h);
}

/** A glass wall (see-through, solid) from a to b, with door gaps. */
function glassWall(game: Game, at: At, a: [number, number], b: [number, number], doors: [number, number][] = []): void {
  const alongX = a[1] === b[1];
  const from = alongX ? Math.min(a[0], b[0]) : Math.min(a[1], b[1]);
  const to = alongX ? Math.max(a[0], b[0]) : Math.max(a[1], b[1]);
  const fixed = alongX ? a[1] : a[0];
  const glass = new THREE.MeshStandardMaterial({ color: C.glass, transparent: true, opacity: 0.2, roughness: 0.05, depthWrite: false });
  const pane = (s: number, e: number) => {
    if (e - s < 0.01) return;
    const len = e - s;
    const mid = (s + e) / 2;
    const size: Vec3 = alongX ? [len, H, 0.04] : [0.04, H, len];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), glass);
    mesh.position.set(...(alongX ? at(mid, H / 2, fixed) : at(fixed, H / 2, mid)));
    const e2 = new Entity('glass', mesh);
    e2.add(new RigidBodyComponent({ type: 'fixed', colliders: [RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)] }));
    game.world.spawn(e2);
    // A frosted band at eye height so you notice the glass.
    const band: Vec3 = alongX ? [len, 0.12, 0.05] : [0.05, 0.12, len];
    decor(game, new THREE.BoxGeometry(...band), mat(0xffffff, { roughness: 0.4 }), alongX ? at(mid, 1.4, fixed) : at(fixed, 1.4, mid), 'frost', false);
  };
  let p = from;
  for (const [s, e] of [...doors].sort((x, y) => x[0] - y[0])) {
    pane(p, s);
    p = e;
  }
  pane(p, to);
  for (const x of [from, to]) box(game, alongX ? [0.1, H, 0.1] : [0.1, H, 0.1], alongX ? at(x, H / 2, fixed) : at(fixed, H / 2, x), C.metal, 'mullion');
}

/** Outside wall with a band of floor-to-ceiling windows. */
function windowWall(game: Game, at: At, a: [number, number], b: [number, number]): void {
  const alongX = a[1] === b[1];
  const from = alongX ? Math.min(a[0], b[0]) : Math.min(a[1], b[1]);
  const to = alongX ? Math.max(a[0], b[0]) : Math.max(a[1], b[1]);
  const fixed = alongX ? a[1] : a[0];
  const len = to - from;
  const mid = (from + to) / 2;
  const span = (y0: number, y1: number) => {
    const size: Vec3 = alongX ? [len, y1 - y0, WALL] : [WALL, y1 - y0, len];
    box(game, size, alongX ? at(mid, (y0 + y1) / 2, fixed) : at(fixed, (y0 + y1) / 2, mid), C.wall, 'outer-wall');
  };
  span(0, 0.5);
  span(H - 0.5, H);
  const n = Math.round(len / 3);
  for (let i = 0; i <= n; i++) {
    const s = from + (len * i) / n;
    box(game, alongX ? [0.14, H - 1, WALL] : [WALL, H - 1, 0.14], alongX ? at(s, H / 2, fixed) : at(fixed, H / 2, s), C.metal, 'mullion');
  }
  const size: Vec3 = alongX ? [len, H - 1, 0.03] : [0.03, H - 1, len];
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...size),
    new THREE.MeshStandardMaterial({ color: C.glass, transparent: true, opacity: 0.16, roughness: 0.05, depthWrite: false }),
  );
  mesh.position.set(...(alongX ? at(mid, H / 2, fixed) : at(fixed, H / 2, mid)));
  const e = new Entity('window', mesh);
  e.add(new RigidBodyComponent({ type: 'fixed', colliders: [RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)] }));
  game.world.spawn(e);
}

function shell(game: Game, at: At): void {
  box(game, [2 * W + 0.4, 0.3, SZ - NZ + 0.4], at(0, -0.15, (NZ + SZ) / 2), C.carpet, 'floor');
  const ceiling = box(game, [2 * W + 0.4, 0.2, SZ - NZ + 0.4], at(0, H + 0.1, (NZ + SZ) / 2), C.ceiling, 'ceiling');
  (ceiling.object3d as THREE.Mesh).castShadow = false;
  // Polished tiles in reception and the atrium.
  decor(game, new THREE.BoxGeometry(16, 0.01, 20), mat(C.tiles, { roughness: 0.35 }), at(0, 0.005, -2), 'tiles', false);

  windowWall(game, at, [-W, NZ], [W, NZ]);
  windowWall(game, at, [-W, NZ], [-W, SZ]);
  windowWall(game, at, [W, NZ], [W, SZ]);
  windowWall(game, at, [-W, SZ], [-6, SZ]);
  windowWall(game, at, [6, SZ], [W, SZ]);

  const panel = mat(0xffffff, { emissive: 0xfff6e0, emissiveIntensity: 0.9 });
  for (let x = -18; x <= 18; x += 4.5) for (let z = -17; z <= 9; z += 4.5) decor(game, new THREE.BoxGeometry(1.4, 0.02, 0.6), panel, at(x, H - 0.01, z), 'light', false);
  const lights = new Entity('office-fill');
  for (const [x, z] of [[-14, -2], [0, -10], [14, -10], [14, 2], [-14, -14], [0, 4]]) {
    const l = new THREE.PointLight(0xfff0d8, 20, 20, 1.6);
    l.position.set(...at(x, H - 0.4, z));
    lights.object3d.add(l);
  }
  game.world.spawn(lights);
}

/** The city far below the windows. */
function city(game: Game, at: At): void {
  const groundY = -60;
  decor(game, new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), mat(0x6f7d66, { roughness: 1 }), at(0, groundY, 0), 'ground', false);
  const m = mat(0x9aa3ad, { roughness: 0.9 });
  const rand = seeded(11);
  for (let i = 0; i < 80; i++) {
    const a = rand() * Math.PI * 2;
    const r = 55 + rand() * 170;
    const w = 10 + rand() * 18;
    const h = 20 + rand() * 90;
    decor(game, new THREE.BoxGeometry(w, h, w * (0.6 + rand() * 0.8)), m, at(Math.cos(a) * r, groundY + h / 2, Math.sin(a) * r), 'city', false);
  }
  decor(game, new THREE.BoxGeometry(2 * W + 0.4, -groundY, SZ - NZ + 0.4), mat(0x7e8a96, { roughness: 0.8 }), at(0, groundY / 2 - 0.3, (NZ + SZ) / 2), 'facade', false);
}

function lifts(game: Game, at: At): void {
  const z0 = 8.2; // lift lobby face
  const steel = mat(0xb8bec6, { roughness: 0.3, metalness: 0.6 });
  // Core blocks either side of the open car, and the car's back wall and ceiling.
  box(game, [4.7, H, SZ - z0], at(-3.65, H / 2, (z0 + SZ) / 2), 0x2f3540, 'lift-core');
  box(game, [4.7, H, SZ - z0], at(3.65, H / 2, (z0 + SZ) / 2), 0x2f3540, 'lift-core');
  box(game, [2.6, H, 0.3], at(0, H / 2, SZ - 0.15), 0x2f3540, 'lift-back');
  box(game, [2.6, H - 2.6, SZ - z0], at(0, 2.6 + (H - 2.6) / 2, (z0 + SZ) / 2), 0x2f3540, 'lift-head');
  // The open car: brushed walls, a handrail, and its doors slid aside.
  for (const sx of [-1, 1]) decor(game, new THREE.BoxGeometry(0.02, 2.6, 3.4), steel, at(sx * 1.29, 1.3, 9.95), 'car-wall');
  decor(game, new THREE.BoxGeometry(2.56, 2.6, 0.02), steel, at(0, 1.3, SZ - 0.31), 'car-back');
  decor(game, new THREE.BoxGeometry(2.0, 0.05, 0.05), mat(0x777777, { metalness: 0.5 }), at(0, 0.95, SZ - 0.38), 'handrail');
  decor(game, new THREE.BoxGeometry(2.56, 0.02, 3.4), mat(0xffffff, { emissive: 0xfff6e0, emissiveIntensity: 0.7 }), at(0, 2.58, 9.95), 'car-light', false);
  for (const sx of [-1, 1]) decor(game, new THREE.BoxGeometry(1.2, 2.3, 0.05), steel, at(sx * 1.95, 1.15, z0 - 0.03), 'lift-door-open');
  // Closed lifts either side.
  for (const x of [-3.9, 3.9]) {
    decor(game, new THREE.BoxGeometry(2.0, 2.3, 0.05), steel, at(x, 1.15, z0 - 0.03), 'lift-door');
    decor(game, new THREE.BoxGeometry(0.01, 2.3, 0.06), mat(0x555b63), at(x, 1.15, z0 - 0.03), 'lift-seam', false);
    decor(game, new THREE.BoxGeometry(0.1, 0.18, 0.03), mat(0x222222, { emissive: 0xffaa33, emissiveIntensity: 0.5 }), at(x + 1.2, 1.2, z0 - 0.05), 'lift-button', false);
  }
  label(game, 'Lifts', at(0, 3.3, z0 - 0.2), 0.7);
}

function reception(game: Game, at: At): void {
  // The feature wall with the sign, facing the lifts.
  wall(game, at, [-6, -1.2], [6, -1.2], C.wall);
  decor(game, new THREE.BoxGeometry(8.4, 2.4, 0.06), mat(0x1c1c1f, { roughness: 0.5 }), at(0, 2.95, -1.06), 'sign-panel');
  sign(game, 'ARUP', at(0, 3.25, -1.02), { width: 6.4, height: 1.6, bg: '#1c1c1f', fg: '#ffffff', letterSpacing: 40 });
  // Reception desk: a long counter with a raised top.
  box(game, [4.6, 1.05, 0.7], at(0, 0.525, 1.4), 0xf2f0ea, 'reception-desk');
  box(game, [4.8, 0.06, 0.9], at(0, 1.08, 1.4), C.wood, 'reception-top');
  box(game, [4.6, 0.04, 0.05], at(0, 0.2, 1.76), C.feature, 'reception-stripe');
  box(game, [0.55, 0.36, 0.03], at(-1.2, 1.3, 1.25), C.dark, 'reception-screen');
  // Birthday bunting over reception.
  label(game, 'Happy 40th, Gene!', at(0, 3.9, 2.5), 1.3, '#ffe066');
  const colours = [0xff5d73, 0xffc94a, 0x4fb3ff, 0x7bd389];
  for (let k = 0; k < 18; k++) {
    const x = -6.3 + k * 0.74;
    const y = 3.5 - Math.sin((k / 17) * Math.PI) * 0.5;
    const flag = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 3), mat(colours[k % 4]));
    flag.rotation.x = Math.PI;
    flag.position.set(...at(x, y, 2.6));
    game.world.spawn(new Entity('bunting', flag));
  }
  // Waiting sofas either side of the lobby.
  for (const sx of [-1, 1]) {
    box(game, [0.85, 0.42, 2.2], at(sx * 6.4, 0.21, 4.5), C.sofa, 'sofa');
    box(game, [0.2, 0.45, 2.2], at(sx * 6.75, 0.65, 4.5), C.sofa, 'sofa-back');
    plant(game, at, sx * 6.5, 7.4);
  }
  // A coffee table with magazines and a mug to pick up.
  box(game, [0.8, 0.38, 1.2], at(-5.1, 0.19, 4.5), C.wood, 'coffee-table');
  addItemPickup(game, { id: 'arup-mug-1', item: 'mug', position: at(-5.1, 0.38, 4.3), yawDeg: 40 });
  addItemPickup(game, { id: 'arup-notebook-1', item: 'notebook', position: at(-5.05, 0.38, 4.8), yawDeg: -12 });
}

/** A desk with its top centre at (x, z). */
function desk(game: Game, at: At, x: number, z: number, opts: { monitor?: boolean; chair?: 1 | -1 } = {}): void {
  const top = 0.76;
  box(game, [1.6, 0.04, 0.8], at(x, top - 0.02, z), C.wood, 'desk');
  for (const s of [-1, 1]) box(game, [0.04, top - 0.04, 0.72], at(x + s * 0.76, (top - 0.04) / 2, z), C.metal, 'desk-leg');
  if (opts.monitor) {
    const f = opts.chair ?? 1;
    box(game, [0.6, 0.36, 0.03], at(x, top + 0.3, z - 0.25 * f), C.dark, 'monitor');
    box(game, [0.06, 0.12, 0.06], at(x, top + 0.06, z - 0.25 * f), C.dark, 'monitor-stand');
  }
  if (opts.chair) chair(game, at, x, z + opts.chair * 0.7, opts.chair);
}

function chair(game: Game, at: At, x: number, z: number, facing: 1 | -1): void {
  box(game, [0.48, 0.07, 0.46], at(x, 0.47, z), C.chair, 'chair');
  box(game, [0.46, 0.5, 0.06], at(x, 0.78, z + facing * 0.22), C.chair, 'chair-back');
  box(game, [0.06, 0.43, 0.06], at(x, 0.215, z), C.metal, 'chair-post');
}

function plant(game: Game, at: At, x: number, z: number, scale = 1): void {
  box(game, [0.42 * scale, 0.45 * scale, 0.42 * scale], at(x, 0.225 * scale, z), C.pot, 'pot');
  const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42 * scale, 1), new THREE.MeshStandardMaterial({ color: C.plant, roughness: 0.8, flatShading: true }));
  leaves.castShadow = true;
  leaves.position.set(...at(x, 0.95 * scale, z));
  leaves.scale.set(1, 1.3, 1);
  game.world.spawn(new Entity('plant', leaves));
}

function openPlan(game: Game, at: At): void {
  // Four pods of facing desks, two rows.
  for (const x of [-19.5, -16, -12.5]) {
    for (const z of [-5, 2]) {
      desk(game, at, x, z, { monitor: true, chair: -1 });
      desk(game, at, x, z + 0.8, { monitor: true, chair: 1 });
      box(game, [1.6, 0.35, 0.04], at(x, 0.94, z + 0.4), 0x8fb3d9, 'screen');
    }
  }
  // Items on desks: they rest on the desk tops (0.76 m).
  const top = 0.76;
  addItemPickup(game, { id: 'arup-mug-2', item: 'mug', position: at(-19, top, -4.9), yawDeg: 30 });
  addItemPickup(game, { id: 'arup-stapler-1', item: 'stapler', position: at(-16.4, top, -4.9), yawDeg: 15 });
  addItemPickup(game, { id: 'arup-memo-1', item: 'memo', position: at(-12.2, top, 2.9), yawDeg: 22 });
  addItemPickup(game, { id: 'arup-keycard-1', item: 'keycard', position: at(-15.6, top, 2.1), yawDeg: -40 });
  // A big plan drawing on the wall: a bridge, naturally.
  sign(game, 'Bridge study, rev F', at(-21.85, 2.4, -1.5), { width: 3.6, height: 0.5, yawDeg: 90, bg: '#f4f1e8', fg: '#2a2e35' });
  plant(game, at, -9.5, -6.5);
  plant(game, at, -9.5, 6.5);
  plant(game, at, -21, 7.5);
}

function atrium(game: Game, at: At): void {
  // Open space with a big round rug, sofas and two tall planters.
  decor(game, new THREE.CylinderGeometry(4.2, 4.2, 0.02, 48), mat(0xc0563f, { roughness: 0.95 }), at(0, 0.015, -12), 'rug', false);
  for (const [x, z] of [[-6.5, -17.5], [6.5, -17.5]] as const) plant(game, at, x, z, 2.2);
  box(game, [3, 0.42, 0.9], at(0, 0.21, -18.6), C.sofa, 'sofa');
  box(game, [3, 0.5, 0.2], at(0, 0.65, -19.05), C.sofa, 'sofa-back');
  // Big Liz's step counter, because of course.
  sign(game, "BIG LIZ'S LAPS TODAY: 4,012", at(0, 3.2, -19.85), { width: 5, height: 0.6, bg: '#123', fg: '#7bd389' });
}

function kitchen(game: Game, at: At): void {
  wall(game, at, [8, -8], [W, -8], C.wall, [[10, 12]]);
  wall(game, at, [8, NZ], [8, -8], C.wall, [[-12, -10]]);
  decor(game, new THREE.BoxGeometry(14, 0.01, 12), mat(0xb9b2a5, { roughness: 0.5 }), at(15, 0.006, -14), 'kitchen-floor', false);
  // Counter along the north wall, fridge, coffee machine.
  box(game, [9, 0.9, 0.62], at(15, 0.45, NZ + 0.5), 0xd8d4cc, 'counter');
  box(game, [9, 0.04, 0.66], at(15, 0.92, NZ + 0.52), C.dark, 'worktop');
  box(game, [0.8, 1.9, 0.7], at(20.3, 0.95, NZ + 0.55), 0xe9ecef, 'fridge');
  box(game, [0.4, 0.5, 0.4], at(12, 1.19, NZ + 0.5), 0x2a2a2a, 'coffee-machine');
  decor(game, new THREE.BoxGeometry(0.3, 0.04, 0.02), mat(0x111111, { emissive: 0x33ff88, emissiveIntensity: 0.6 }), at(12, 1.33, NZ + 0.71), 'coffee-display', false);
  // Table with stools.
  box(game, [2.4, 0.04, 1.0], at(15, 0.74, -13), C.wood, 'kitchen-table');
  box(game, [0.1, 0.72, 0.1], at(15, 0.36, -13), C.metal, 'kitchen-table-leg');
  for (const x of [14, 16]) for (const z of [-13.8, -12.2]) box(game, [0.36, 0.5, 0.36], at(x, 0.25, z), C.chair, 'stool');
  // A cake box with a lonely fork (Renee knows).
  box(game, [0.4, 0.16, 0.4], at(15.5, 0.84, -13), 0xf2f0ea, 'cake-box');
  addItemPickup(game, { id: 'arup-apple-1', item: 'apple', position: at(14.4, 0.76, -12.9), yawDeg: 0 });
  addItemPickup(game, { id: 'arup-water-1', item: 'water', position: at(17.5, 0.94, NZ + 0.5), yawDeg: 0 });
  addItemPickup(game, { id: 'arup-mug-3', item: 'mug', position: at(12.5, 0.94, NZ + 0.5), yawDeg: 120 });
}

function meetingRoom(game: Game, at: At): void {
  glassWall(game, at, [9, -6], [W, -6]);
  glassWall(game, at, [9, -6], [9, 5], [[-1, 0.6]]);
  glassWall(game, at, [9, 5], [W, 5]);
  box(game, [5, 0.05, 1.6], at(15.5, 0.745, -0.5), C.wood, 'meeting-table');
  for (const x of [13.8, 17.2]) box(game, [0.12, 0.72, 1.0], at(x, 0.36, -0.5), C.metal, 'meeting-leg');
  for (const x of [13.8, 15.5, 17.2]) {
    chair(game, at, x, -1.7, -1);
    chair(game, at, x, 0.7, 1);
  }
  sign(game, 'Meeting room: "Big Ideas"', at(9.05, 2.6, -3), { width: 2.6, height: 0.35, yawDeg: -90, bg: '#ffffff', fg: '#e61e2b' });
  decor(game, new THREE.BoxGeometry(0.03, 1.2, 3), mat(0xfafafa, { roughness: 0.2 }), at(21.85, 1.6, -0.5), 'whiteboard');
  addItemPickup(game, { id: 'arup-notebook-2', item: 'notebook', position: at(15, 0.77, -0.2), yawDeg: 80 });
}

function lounge(game: Game, at: At): void {
  wall(game, at, [-W, -8], [-8, -8], C.wall, [[-14, -12]]);
  // A ping pong table and two beanbags.
  box(game, [2.74, 0.05, 1.52], at(-15, 0.76, -14), 0x1f5f8b, 'pingpong');
  box(game, [0.02, 0.15, 1.6], at(-15, 0.86, -14), 0xffffff, 'pingpong-net');
  for (const x of [-16.2, -13.8]) box(game, [0.1, 0.74, 1.2], at(x, 0.37, -14), C.dark, 'pingpong-leg');
  for (const [x, z, c] of [[-20, -18, 0xe8a33d], [-18.4, -18.6, 0x7b5cff]] as const) {
    const bag = cylinder(game, 0.5, 0.5, at(x, 0.25, z), mat(c, { roughness: 0.95 }), 'beanbag', 18);
    bag.object3d.scale.set(1, 1, 1);
  }
  plant(game, at, -21, -9);
}

// --- People ----------------------------------------------------------------------

/** Adds hair (a cap of colour over the top and back of the head) to an addNpc character. */
function headOf(e: Entity): THREE.Object3D {
  const body = e.object3d.children[0];
  return body.children[1];
}

function hair(e: Entity, color: number, style: 'short' | 'long' | 'bun'): void {
  const head = headOf(e);
  const m = mat(color, { roughness: 0.85 });
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.215, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), m);
  cap.rotation.x = -0.25;
  cap.position.set(0, 0.02, -0.02);
  cap.castShadow = true;
  head.add(cap);
  if (style === 'long') {
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.42, 0.12), m);
    back.position.set(0, -0.14, -0.13);
    head.add(back);
  }
  if (style === 'bun') {
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), m);
    bun.position.set(0, 0.17, -0.15);
    head.add(bun);
  }
}

/** A smile across the face; `huge` for Chris. */
function smile(e: Entity, huge = false): void {
  const head = headOf(e);
  const r = huge ? 0.1 : 0.06;
  const arc = new THREE.Mesh(new THREE.TorusGeometry(r, huge ? 0.018 : 0.012, 6, 16, Math.PI), mat(huge ? 0xffffff : 0x6b2a2a));
  arc.rotation.z = Math.PI;
  arc.position.set(0, huge ? -0.04 : -0.06, 0.19);
  head.add(arc);
  if (huge) {
    // Teeth: a white band inside the grin, with a dark outline.
    const lip = new THREE.Mesh(new THREE.TorusGeometry(r + 0.012, 0.007, 6, 16, Math.PI), mat(0x6b2a2a));
    lip.rotation.z = Math.PI;
    lip.position.set(0, -0.04, 0.188);
    head.add(lip);
  }
}

function people(game: Game, at: At): void {
  const aurora = addNpc(game, { id: 'aurora', name: 'Aurora', dialogue: 'aurora', position: at(0.4, 0, 0.5), facingDeg: 0, color: 0x6c4fa3, skin: 0xe8c3a0 });
  hair(aurora, 0x3b2316, 'long');
  smile(aurora);

  const chris = addNpc(game, { id: 'chris', name: 'Chris', dialogue: 'chris', position: at(-10.2, 0, -1.5), facingDeg: 90, color: 0x2f6fd6, skin: 0xf1caa6 });
  hair(chris, 0xf3d36b, 'short');
  smile(chris, true);

  const renee = addNpc(game, { id: 'renee', name: 'Renee', dialogue: 'renee', position: at(13, 0, NZ + 1.6), facingDeg: 0, color: 0x2e8a6a, skin: 0xd9a77e });
  hair(renee, 0x7a3b1d, 'bun');
  smile(renee);

  bigLiz(game, at);
}

/**
 * Big Liz: a three-and-a-half-metre friendly lizard in the spirit of the
 * classic city-stomping movie monsters (an original design: green, spiky
 * back, stubby arms, a tail). She does laps of the atrium and stops to chat.
 */
function bigLiz(game: Game, at: At): void {
  const green = mat(0x4f8a4a, { roughness: 0.75 });
  const belly = mat(0xb8c98a, { roughness: 0.8 });
  const spike = mat(0xdfe8d0, { roughness: 0.6 });
  const dark = mat(0x1d1d1d);
  const root = new THREE.Group();
  root.position.set(...at(-6, 0, -6));
  const body = new THREE.Group();
  root.add(body);
  const part = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = body) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  // Legs, body, belly, tail.
  for (const sx of [-1, 1]) {
    part(new THREE.CylinderGeometry(0.32, 0.38, 1.1, 12), green, sx * 0.45, 0.55, -0.05);
    part(new THREE.BoxGeometry(0.5, 0.18, 0.75), green, sx * 0.45, 0.09, 0.12);
  }
  const torso = part(new THREE.CapsuleGeometry(0.75, 1.2, 6, 16), green, 0, 1.85, -0.1);
  torso.rotation.x = -0.12;
  const tummy = part(new THREE.CapsuleGeometry(0.55, 1.0, 6, 14), belly, 0, 1.8, 0.28);
  tummy.rotation.x = -0.12;
  tummy.scale.set(1, 1, 0.6);
  for (let k = 0; k < 5; k++) {
    const seg = part(new THREE.SphereGeometry(0.5 - k * 0.08, 12, 10), green, 0, 0.8 - k * 0.1, -0.9 - k * 0.55);
    seg.scale.set(1, 0.85, 1.4);
  }
  // Back spikes down the spine and tail.
  for (let k = 0; k < 9; k++) {
    const y = 2.9 - k * 0.27;
    const z = -0.75 - Math.max(0, k - 4) * 0.45;
    const s = part(new THREE.ConeGeometry(0.16 - k * 0.008, 0.42 - k * 0.02, 4), spike, 0, y, z);
    s.rotation.x = -0.5;
  }
  // Stubby arms.
  for (const sx of [-1, 1]) {
    const arm = part(new THREE.CapsuleGeometry(0.12, 0.45, 4, 8), green, sx * 0.72, 2.15, 0.35);
    arm.rotation.x = -1.0;
  }
  // Head with a snout, eyes and a happy grin.
  const head = new THREE.Group();
  head.position.set(0, 3.15, 0.15);
  body.add(head);
  part(new THREE.SphereGeometry(0.45, 16, 12), green, 0, 0, 0, head);
  const snout = part(new THREE.BoxGeometry(0.55, 0.38, 0.55), green, 0, -0.08, 0.42, head);
  snout.rotation.x = 0.1;
  for (const sx of [-1, 1]) {
    part(new THREE.SphereGeometry(0.09, 10, 8), mat(0xffffff), sx * 0.22, 0.14, 0.33, head);
    part(new THREE.SphereGeometry(0.05, 8, 6), dark, sx * 0.23, 0.15, 0.41, head);
  }
  const grin = part(new THREE.TorusGeometry(0.2, 0.025, 6, 16, Math.PI), mat(0xffffff), 0, -0.2, 0.7, head);
  grin.rotation.z = Math.PI;
  // A tiny lanyard, which she is very proud of.
  part(new THREE.BoxGeometry(0.16, 0.22, 0.02), mat(0xffffff), 0, 2.25, 0.72);

  const tag = makeLabel('Big Liz', { scale: 0.8, color: '#ffe7a8' });
  tag.position.set(0, 3.95, 0);
  root.add(tag);

  const e = new Entity('big_liz', root);
  e.tags.add('npc');
  e.add(new RigidBodyComponent({ type: 'kinematicPosition', colliders: [RAPIER.ColliderDesc.capsule(1.1, 0.8).setTranslation(0, 1.9, -0.2)] }));
  const npc = e.add(new Npc('big_liz', 'Big Liz', 'big_liz', body, head, 0, 3.2));
  const oy = at(0, 0, 0)[1];
  const loop: [number, number][] = [
    [-6, -5.5],
    [6, -5.5],
    [6, -16],
    [-6, -16],
  ].map(([x, z]) => {
    const p = at(x, 0, z);
    return [p[0], p[2]];
  });
  e.add(new Wander({ path: loop, stops: [0, 2], groundAt: () => oy, speed: 0.9, pause: [2, 5], seed: 40 }));
  e.add(
    new Interactable({
      prompt: 'Talk to Big Liz',
      range: 4,
      onInteract: () => game.getSystem<DialogueSystem>('dialogue')?.start('big_liz', e, npc),
    }),
  );
  game.world.spawn(e);
}
