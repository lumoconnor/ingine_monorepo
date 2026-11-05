import * as THREE from 'three';
import type { Game } from '@ingine/engine/core/Game';
import type { Level } from '@ingine/engine/world/Level';
import { Entity } from '@ingine/engine/entities/Entity';
import { addBox } from '@ingine/engine/world/builders';
import { createPlayer } from '@ingine/engine/gameplay/player/createPlayer';
import { addItemPickup } from '@ingine/engine/inventory/pickups';
import { RAPIER } from '@ingine/engine/physics/PhysicsWorld';
import { RigidBodyComponent } from '@ingine/engine/physics/RigidBodyComponent';

type Vec3 = [number, number, number];

/** Floor plan, metres. North is -Z. The floor spans x -14..14, z -9..9. */
const W = 14;
const D = 9;
/** Floor to ceiling. */
const H = 3.2;
const WALL = 0.2;
const DOOR_H = 2.2;

const C = {
  carpet: 0x59636f,
  kitchenFloor: 0xb9b2a5,
  wall: 0xe7e3da,
  accent: 0x8fb3d9,
  meetingWall: 0xc9d6c4,
  ceiling: 0xf2f2f0,
  wood: 0xc9a77c,
  metal: 0x8a9099,
  dark: 0x2a2e35,
  chair: 0x3d4a5c,
  sofa: 0x6d8fa6,
  counter: 0xd8d4cc,
  fridge: 0xe9ecef,
  plant: 0x4f8a45,
  pot: 0x9b6b4a,
  city: 0x9aa3ad,
  ground: 0x6f7d66,
};

/**
 * One floor of an office building, for multiplayer testing:
 *
 *   North-west: kitchen (counter, fridge, table with a fruit bowl)
 *   West:       open-plan desks
 *   North-east: meeting room behind full-height walls (voices from inside
 *               sound muffled from the corridor: try it)
 *   East:       a private office, and a lounge with sofas
 *   South:      the lifts, where everyone arrives
 *
 * Outside the windows, the city is far below. Items are scattered on desks
 * and tables to pick up (E); they rest on surfaces, nothing floats.
 */
export class OfficeLevel implements Level {
  readonly name = 'Office floor';

  load(game: Game): void {
    this.shell(game);
    this.city(game);
    this.lifts(game);
    this.openPlan(game);
    this.kitchen(game);
    this.meetingRoom(game);
    this.privateOffice(game);
    this.lounge(game);
    this.items(game);

    // Arrive in front of the lifts, spread out a little so friends don't stand inside each other.
    const x = (Math.random() - 0.5) * 3;
    createPlayer(game, new THREE.Vector3(x, 0.05, 5), 0);
  }

  // --- Building ----------------------------------------------------------------

  private box(game: Game, size: Vec3, position: Vec3, color: number, name = 'office'): Entity {
    return addBox(game, { name, size, position, color });
  }

  /** A wall from (x1,z1) to (x2,z2) (axis-aligned), full height, with optional door openings along it. */
  private wall(game: Game, a: [number, number], b: [number, number], color = C.wall, doors: [number, number][] = []): void {
    const alongX = a[1] === b[1];
    const from = alongX ? Math.min(a[0], b[0]) : Math.min(a[1], b[1]);
    const to = alongX ? Math.max(a[0], b[0]) : Math.max(a[1], b[1]);
    const fixed = alongX ? a[1] : a[0];
    const cuts = [...doors].sort((p, q) => p[0] - q[0]);
    const piece = (s: number, e: number, y0: number, y1: number) => {
      if (e - s < 0.01) return;
      const len = e - s;
      const mid = (s + e) / 2;
      const size: Vec3 = alongX ? [len, y1 - y0, WALL] : [WALL, y1 - y0, len];
      const pos: Vec3 = alongX ? [mid, (y0 + y1) / 2, fixed] : [fixed, (y0 + y1) / 2, mid];
      this.box(game, size, pos, color, 'wall');
    };
    let at = from;
    for (const [s, e] of cuts) {
      piece(at, s, 0, H);
      piece(s, e, DOOR_H, H); // header over the doorway
      at = e;
    }
    piece(at, to, 0, H);
  }

  /** An outside wall with a band of windows (sill, glass, header, mullions). */
  private windowWall(game: Game, a: [number, number], b: [number, number]): void {
    const alongX = a[1] === b[1];
    const from = alongX ? Math.min(a[0], b[0]) : Math.min(a[1], b[1]);
    const to = alongX ? Math.max(a[0], b[0]) : Math.max(a[1], b[1]);
    const fixed = alongX ? a[1] : a[0];
    const len = to - from;
    const mid = (from + to) / 2;
    const span = (y0: number, y1: number, color: number) => {
      const size: Vec3 = alongX ? [len, y1 - y0, WALL] : [WALL, y1 - y0, len];
      const pos: Vec3 = alongX ? [mid, (y0 + y1) / 2, fixed] : [fixed, (y0 + y1) / 2, mid];
      this.box(game, size, pos, color, 'outer-wall');
    };
    const sill = 0.9;
    const head = 2.5;
    span(0, sill, C.wall);
    span(head, H, C.wall);
    // Mullions every 3 m.
    const n = Math.round(len / 3);
    for (let i = 0; i <= n; i++) {
      const s = from + (len * i) / n;
      const size: Vec3 = alongX ? [0.14, head - sill, WALL] : [WALL, head - sill, 0.14];
      const pos: Vec3 = alongX ? [s, (sill + head) / 2, fixed] : [fixed, (sill + head) / 2, s];
      this.box(game, size, pos, C.metal, 'mullion');
    }
    // Glass: see-through, but solid so nobody jumps out.
    const glassSize: Vec3 = alongX ? [len, head - sill, 0.03] : [0.03, head - sill, len];
    const glassPos: Vec3 = alongX ? [mid, (sill + head) / 2, fixed] : [fixed, (sill + head) / 2, mid];
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(...glassSize),
      new THREE.MeshStandardMaterial({ color: 0xbfd8ea, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.1, depthWrite: false }),
    );
    mesh.position.set(...glassPos);
    const e = new Entity('glass', mesh);
    e.add(new RigidBodyComponent({ type: 'fixed', colliders: [RAPIER.ColliderDesc.cuboid(glassSize[0] / 2, glassSize[1] / 2, glassSize[2] / 2)] }));
    game.world.spawn(e);
  }

  /** A mesh with no collider (light panels, skirting). */
  private decor(game: Game, geo: THREE.BufferGeometry, mat: THREE.Material, position: Vec3, name = 'decor'): Entity {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...position);
    const e = new Entity(name, m);
    game.world.spawn(e);
    return e;
  }

  private shell(game: Game): void {
    // Floor slab and ceiling. The ceiling doesn't cast shadows, so daylight
    // still reaches the floor (a stand-in for proper interior lighting).
    this.box(game, [2 * W + 0.4, 0.3, 2 * D + 0.4], [0, -0.15, 0], C.carpet, 'floor');
    const ceiling = this.box(game, [2 * W + 0.4, 0.2, 2 * D + 0.4], [0, H + 0.1, 0], C.ceiling, 'ceiling');
    (ceiling.object3d as THREE.Mesh).castShadow = false;
    // Kitchen floor tiles.
    this.decor(game, new THREE.BoxGeometry(8, 0.01, 5), new THREE.MeshStandardMaterial({ color: C.kitchenFloor, roughness: 0.5 }), [-10, 0.005, -6.5]);

    this.windowWall(game, [-W, -D], [W, -D]);
    this.windowWall(game, [-W, D], [-3, D]);
    this.windowWall(game, [3, D], [W, D]);
    this.windowWall(game, [-W, -D], [-W, D]);
    this.windowWall(game, [W, -D], [W, D]);

    // Ceiling light panels.
    const panel = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e0, emissiveIntensity: 0.9 });
    for (let x = -12; x <= 12; x += 4) for (let z = -6; z <= 6; z += 4) this.decor(game, new THREE.BoxGeometry(1.2, 0.02, 0.6), panel, [x, H - 0.01, z], 'light');

    // A little warm fill so walls facing away from the sun aren't flat grey.
    const fill = new THREE.PointLight(0xfff0d8, 18, 22, 1.6);
    fill.position.set(-6, 2.8, 0);
    const fill2 = fill.clone();
    fill2.position.set(8, 2.8, 2);
    const lights = new Entity('fill-lights');
    lights.object3d.add(fill, fill2);
    game.world.spawn(lights);
  }

  /** The city far below the windows. */
  private city(game: Game): void {
    const groundY = -40;
    this.decor(game, new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: C.ground, roughness: 1 }), [0, groundY, 0], 'ground');
    const m = new THREE.MeshStandardMaterial({ color: C.city, roughness: 0.9 });
    // A ring of blocks, deterministic so every player sees the same skyline.
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) {
      const ang = rand() * Math.PI * 2;
      const r = 45 + rand() * 160;
      const w = 10 + rand() * 18;
      const h = 15 + rand() * 70;
      this.decor(game, new THREE.BoxGeometry(w, h, w * (0.6 + rand() * 0.8)), m, [Math.cos(ang) * r, groundY + h / 2, Math.sin(ang) * r], 'city');
    }
    // This building's own facade below our floor.
    this.decor(game, new THREE.BoxGeometry(2 * W + 0.4, 40, 2 * D + 0.4), new THREE.MeshStandardMaterial({ color: 0x7e8a96, roughness: 0.8 }), [0, groundY / 2 - 0.3, 0], 'facade');
  }

  private lifts(game: Game): void {
    // Lift core in the middle of the south side.
    this.box(game, [6, H, 2.4], [0, H / 2, D - 1.2], C.accent, 'lift-core');
    const steel = new THREE.MeshStandardMaterial({ color: 0xb8bec6, roughness: 0.3, metalness: 0.8 });
    for (const x of [-1.5, 1.5]) {
      this.decor(game, new THREE.BoxGeometry(1.1, 2.1, 0.04), steel, [x, 1.05, D - 2.42], 'lift-door');
      this.decor(game, new THREE.BoxGeometry(0.01, 2.1, 0.045), new THREE.MeshStandardMaterial({ color: 0x555b63 }), [x, 1.05, D - 2.42], 'lift-seam');
    }
  }

  /** A desk with its top centre at (x, z); returns the top surface point. */
  private desk(game: Game, x: number, z: number, opts: { monitor?: boolean; chair?: 1 | -1 } = {}): Vec3 {
    const top = 0.76;
    this.box(game, [1.6, 0.04, 0.8], [x, top - 0.02, z], C.wood, 'desk');
    for (const s of [-1, 1]) this.box(game, [0.04, top - 0.04, 0.72], [x + s * 0.76, (top - 0.04) / 2, z], C.metal, 'desk-leg');
    if (opts.monitor) {
      this.box(game, [0.6, 0.36, 0.03], [x, top + 0.3, z - 0.25 * (opts.chair ?? 1)], C.dark, 'monitor');
      this.box(game, [0.06, 0.12, 0.06], [x, top + 0.06, z - 0.25 * (opts.chair ?? 1)], C.dark, 'monitor-stand');
    }
    if (opts.chair) this.chair(game, x, z + opts.chair * 0.7, opts.chair);
    return [x, top, z];
  }

  /** A chair; `facing` -1 faces south (+Z), 1 faces north. */
  private chair(game: Game, x: number, z: number, facing: 1 | -1): void {
    this.box(game, [0.48, 0.07, 0.46], [x, 0.47, z], C.chair, 'chair');
    this.box(game, [0.46, 0.5, 0.06], [x, 0.78, z + facing * 0.22], C.chair, 'chair-back');
    this.box(game, [0.06, 0.43, 0.06], [x, 0.215, z], C.metal, 'chair-post');
  }

  private plant(game: Game, x: number, z: number): void {
    this.box(game, [0.42, 0.45, 0.42], [x, 0.225, z], C.pot, 'pot');
    const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), new THREE.MeshStandardMaterial({ color: C.plant, roughness: 0.8, flatShading: true }));
    leaves.castShadow = true;
    leaves.position.set(x, 0.95, z);
    leaves.scale.set(1, 1.3, 1);
    game.world.spawn(new Entity('plant', leaves));
  }

  private openPlan(game: Game): void {
    // Two rows of desk pairs facing each other, three pods.
    for (const x of [-11.5, -8, -4.5]) {
      this.desk(game, x, -1.4, { monitor: true, chair: -1 });
      this.desk(game, x, -0.6, { monitor: true, chair: 1 });
      this.desk(game, x, 3.0, { monitor: true, chair: -1 });
      this.desk(game, x, 3.8, { monitor: true, chair: 1 });
    }
    // Low screens between facing desks.
    for (const x of [-11.5, -8, -4.5]) {
      this.box(game, [1.6, 0.35, 0.04], [x, 0.94, -1.0], C.accent, 'screen');
      this.box(game, [1.6, 0.35, 0.04], [x, 0.94, 3.4], C.accent, 'screen');
    }
    this.plant(game, -13.3, 1.2);
    this.plant(game, -2.6, -3.2);
    this.plant(game, -13.3, 7.8);
  }

  private kitchen(game: Game): void {
    // Walls: south side with a doorway, east side.
    this.wall(game, [-W, -4], [-6, -4], C.wall, [[-9.2, -7.8]]);
    this.wall(game, [-6, -D], [-6, -4], C.wall, [[-6.6, -5.2]]);
    // Counter along the north wall, fridge at its end.
    this.box(game, [5.2, 0.9, 0.62], [-11.2, 0.45, -8.55], C.counter, 'counter');
    this.box(game, [5.2, 0.04, 0.66], [-11.2, 0.92, -8.53], C.dark, 'worktop');
    this.box(game, [0.8, 1.9, 0.7], [-8.1, 0.95, -8.5], C.fridge, 'fridge');
    // Table and stools.
    this.box(game, [1.4, 0.04, 0.9], [-10.5, 0.74, -6.2], C.wood, 'kitchen-table');
    this.box(game, [0.08, 0.72, 0.08], [-10.5, 0.36, -6.2], C.metal, 'kitchen-table-leg');
    for (const [x, z] of [[-11.5, -6.2], [-9.5, -6.2]] as const) this.box(game, [0.36, 0.5, 0.36], [x, 0.25, z], C.chair, 'stool');
    // Fruit bowl.
    this.decor(game, new THREE.CylinderGeometry(0.17, 0.11, 0.07, 20), new THREE.MeshStandardMaterial({ color: 0x5a6f8a, roughness: 0.5 }), [-10.75, 0.795, -6.2], 'bowl');
  }

  private meetingRoom(game: Game): void {
    // Full-height walls so voices inside are muffled from outside.
    this.wall(game, [5, -2], [W, -2], C.meetingWall, [[6, 7.2]]);
    this.wall(game, [5, -D], [5, -2], C.meetingWall);
    // Long table, chairs either side.
    this.box(game, [4.2, 0.05, 1.4], [9.6, 0.745, -5.5], C.wood, 'meeting-table');
    for (const x of [8.2, 11]) this.box(game, [0.12, 0.72, 0.9], [x, 0.36, -5.5], C.metal, 'meeting-leg');
    for (const x of [8.4, 9.6, 10.8]) {
      this.chair(game, x, -6.55, -1);
      this.chair(game, x, -4.45, 1);
    }
    // Whiteboard on the west wall.
    this.decor(game, new THREE.BoxGeometry(0.03, 1.1, 2.4), new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.2 }), [5.12, 1.6, -5.5], 'whiteboard');
    this.plant(game, 13.3, -8.3);
  }

  private privateOffice(game: Game): void {
    this.wall(game, [8, 1], [W, 1], C.wall);
    this.wall(game, [8, 1], [8, 6], C.wall, [[2.4, 3.4]]);
    this.wall(game, [8, 6], [W, 6], C.wall);
    this.desk(game, 11.5, 3.2, { monitor: true, chair: -1 });
    this.box(game, [0.5, 1.8, 1.6], [13.6, 0.9, 4.6], C.wood, 'bookshelf');
  }

  private lounge(game: Game): void {
    // Two sofas facing a low coffee table.
    this.box(game, [2.2, 0.42, 0.85], [4.5, 0.21, 1.0], C.sofa, 'sofa');
    this.box(game, [2.2, 0.45, 0.2], [4.5, 0.65, 0.65], C.sofa, 'sofa-back');
    this.box(game, [2.2, 0.42, 0.85], [4.5, 0.21, 4.0], C.sofa, 'sofa');
    this.box(game, [2.2, 0.45, 0.2], [4.5, 0.65, 4.35], C.sofa, 'sofa-back');
    this.box(game, [1.2, 0.4, 0.7], [4.5, 0.2, 2.5], C.wood, 'coffee-table');
    this.plant(game, 6.8, -1.2);
    this.plant(game, -2.6, 6.2);
  }

  // --- Things to pick up --------------------------------------------------------

  private items(game: Game): void {
    const on = (p: Vec3, dx = 0, dz = 0): Vec3 => [p[0] + dx, p[1], p[2] + dz];
    const deskTop = (x: number, z: number): Vec3 => [x, 0.76, z];
    const add = (id: string, item: string, position: Vec3, yawDeg: number) => addItemPickup(game, { id, item, position, yawDeg });

    // Open plan.
    add('mug-1', 'mug', on(deskTop(-11.5, -1.4), 0.5, 0.1), 30);
    add('mug-2', 'mug', on(deskTop(-8, 3.8), -0.55, 0.15), -60);
    add('mug-3', 'mug', on(deskTop(-4.5, -0.6), 0.45, 0.05), 110);
    add('stapler-1', 'stapler', on(deskTop(-8, -1.4), -0.4, 0.1), 15);
    add('notebook-1', 'notebook', on(deskTop(-4.5, 3.0), -0.35, 0.05), -8);
    add('memo-1', 'memo', on(deskTop(-11.5, 3.8), 0.3, -0.05), 22);

    // Kitchen.
    add('apple-1', 'apple', [-10.8, 0.835, -6.2], 0);
    add('apple-2', 'apple', [-10.68, 0.835, -6.15], 130);
    add('water-1', 'water', [-12.4, 0.94, -8.55], 0);
    add('water-2', 'water', [-12.1, 0.94, -8.45], 0);
    add('mug-4', 'mug', [-10.1, 0.94, -8.5], 200);

    // Meeting room.
    add('keycard-1', 'keycard', [9.0, 0.77, -5.3], 35);
    add('notebook-2', 'notebook', [10.4, 0.77, -5.7], 95);
    add('memo-2', 'memo', [8.3, 0.77, -5.6], -20);

    // Private office and lounge.
    add('stapler-2', 'stapler', on(deskTop(11.5, 3.2), 0.4, -0.1), -35);
    add('keycard-2', 'keycard', [4.3, 0.4, 2.45], 70);
    add('mug-5', 'mug', [4.8, 0.4, 2.6], 10);
  }
}
