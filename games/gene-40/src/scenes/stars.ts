import * as THREE from 'three';
import type { Game } from '@ingine/engine/core/Game';
import type { System } from '@ingine/engine/core/System';
import { Entity } from '@ingine/engine/entities/Entity';
import { RAPIER } from '@ingine/engine/physics/PhysicsWorld';
import { RigidBodyComponent } from '@ingine/engine/physics/RigidBodyComponent';
import { MovingPlatform, orbit, pingPong, spin, type MotionFn } from '@ingine/engine/gameplay/components/MovingPlatform';
import { Npc } from '@ingine/engine/gameplay/components/Npc';
import { Interactable } from '@ingine/engine/gameplay/interaction/Interactable';
import { PlayerController } from '@ingine/engine/gameplay/player/PlayerController';
import type { DialogueSystem } from '@ingine/engine/dialogue/DialogueSystem';
import { makeLabel } from '@ingine/engine/render/labels';
import type { Teleports } from '../Teleports';
import { sceneById, type Vec3 } from '../scenes';
import { box, cylinder, decor, label, mat, sign, tree } from './kit';
import { buildReturnPad } from './hub';

/**
 * Star islands: an original first-person platformer. Grassy islands float
 * over the sea, joined by stepping stones, a shuttle platform, a lift, a
 * bounce pad, a spinning disc, a platform circling a pillar, a narrow beam
 * and a spiral cloud stair up to the star castle. Ten stars stand on top of
 * things along the way. Fall in the sea and you're back at the last flag you
 * touched. Nimbus, a friendly cloud, says hello at the start.
 *
 * The course, from the arrival (heading north, -Z):
 *   start island ─ stepping stones ─ meadow ─ shuttle east ─ bounce pad up to the high island
 *                                       │                                   └ stones ─ spinning disc ─ stones ─ cloud stair ─ castle
 *                                       └ lift up west ─ tower island ─ beam ─ beam island ─ stones ─┘
 *   plus a platform circling a pillar off the west side of the start island.
 */

type At = (x: number, y: number, z: number) => Vec3;

const SEA = -6;
const GRASS = 0x6cc35a;
const ROCK = 0x9b8468;
const CLOUD = 0xffffff;
const STONE = 0xc9c1b0;

export function buildStars(game: Game, teleports: Teleports, index: number): StarCourse {
  const s = sceneById('stars')!;
  const [ox, oy, oz] = s.origin;
  const at: At = (x, y, z) => [ox + x, oy + y, oz + z];
  const course = game.addSystem(new StarCourse(s.origin));
  course.init(game);
  const v = (x: number, y: number, z: number) => new THREE.Vector3(...at(x, y, z));

  sea(game, at);

  // --- Start island ---------------------------------------------------------
  island(game, at, 0, 0, 0, 14);
  course.checkpoint(game, at(-4, 0, 6), 'start', true);
  box(game, [2, 1, 2], at(6, 0.5, -4), STONE, 'step-block');
  box(game, [2, 2, 2], at(8.5, 1, -6.5), STONE, 'step-block');
  course.star(game, at(8.5, 2, -6.5));
  sign(game, 'STAR ISLANDS', at(0, 3.4, -2), { width: 6, height: 1.1, bg: '#4fb3ff', fg: '#ffffff', letterSpacing: 6 });
  for (const x of [-3.3, 3.3]) box(game, [0.25, 4, 0.25], at(x, 2, -2.1), 0x2f6fa8, 'sign-post');
  tree(game, at(-9, 0, -5)[0], at(0, 0, -5)[2], 1.1);
  tree(game, at(10, 0, 6)[0], at(0, 0, 6)[2], 0.9);
  nimbus(game, at(4.5, 0, 4));

  // A pillar off the west side, with a platform circling it that rises and falls.
  cylinder(game, 1.5, 14, at(-19, 1, -4), mat(STONE), 'pillar', 24);
  decor(game, new THREE.ConeGeometry(1.4, 4, 24).rotateX(Math.PI), mat(ROCK), at(-19, -8, -4), 'pillar-root');
  course.star(game, at(-19, 8, -4));
  platform(game, [2.6, 0.4, 2.6], orbit(v(-19, 4.2, -4), 4.0, 12, 3.8), 0xf2a541, 'orbit-platform');

  // --- Stepping stones to the meadow -----------------------------------------
  [0.4, 0.9, 1.4, 1.9, 2.4, 2.8].forEach((top, i) => stone(game, at(i % 2 ? 1.5 : -1.5, top, -17 - i * 3.5), 1.2));

  // --- Meadow (B) -------------------------------------------------------------
  island(game, at, 0, 3, -46, 8);
  course.checkpoint(game, at(3, 3, -41), 'meadow');
  course.star(game, at(-3, 3, -50));
  tree(game, at(4, 0, -51)[0], at(0, 0, -51)[2], 0.8, at(0, 3, 0)[1]);

  // East: a shuttle across to the bounce island.
  platform(game, [4, 0.4, 4], pingPong([v(11.5, 2.8, -46), v(24.5, 2.8, -46)], 3, 1.2), 0x4fb3ff, 'shuttle');
  label(game, 'All aboard!', at(11.5, 4.6, -46), 0.8);

  // --- Bounce island (C) -------------------------------------------------------
  island(game, at, 34, 3, -46, 7);
  course.checkpoint(game, at(31, 3, -42), 'bounce');
  course.star(game, at(37, 3, -44));
  course.bouncePad(game, at(34, 3, -50), new THREE.Vector3(0, 0, -1), 14, 8.5);
  label(game, 'Bounce!', at(34, 5.4, -50), 1.0);

  // --- High island (D) ---------------------------------------------------------
  island(game, at, 34, 13, -66, 6);
  course.checkpoint(game, at(36, 13, -63), 'high');
  course.star(game, at(35, 13, -69));
  stone(game, at(24.5, 13, -68), 1.1);

  // A spinning disc with a star near its rim.
  const disc = platformDisc(game, at(18, 12.8, -70), 3.5, 0.6, 0.4);
  course.star(game, [-2.4, 0.2, 0], disc);
  stone(game, at(12.5, 13.2, -73), 1.1);
  stone(game, at(8.8, 13.4, -75.2), 1.0);

  // --- West: a lift up to the tower island (E), then a beam to (G) -------------
  platform(game, [3, 0.4, 3], pingPong([v(-12, 2.8, -46), v(-12, 14.8, -46)], 2, 1.5), 0xff8fb1, 'lift');
  label(game, 'Going up', at(-12, 4.6, -46), 0.8);
  island(game, at, -20, 15, -46, 5);
  course.checkpoint(game, at(-21, 15, -43), 'tower');
  course.star(game, at(-22, 15, -48));
  // The beam: narrow, so take it slowly.
  box(game, [0.7, 0.4, 20], at(-20, 14.8, -61), 0xe0c08a, 'beam');
  island(game, at, -20, 15, -76, 5);
  course.star(game, at(-20, 15, -79));
  stone(game, at(-12.5, 14.3, -77), 1.0);
  stone(game, at(-8.6, 13.7, -77.5), 1.0);

  // --- Cloud stair island (I) and the castle (H) --------------------------------
  island(game, at, 0, 13, -78, 6);
  course.checkpoint(game, at(2.5, 13, -75), 'stair');
  cylinder(game, 1.2, 18, at(0, 13 + 9, -78), mat(0x8c6a48, { roughness: 0.9 }), 'stair-trunk', 16);
  // 25 cloud steps spiralling up around the trunk, 0.7 m apart, ending on the castle side.
  const steps = 25;
  const end = -Math.PI / 2; // -Z
  for (let k = 0; k < steps; k++) {
    const a = end - (steps - 1 - k) * 0.45;
    const y = 13 + 0.7 * (k + 1);
    const p = at(Math.cos(a) * 3.6, y, -78 + Math.sin(a) * 3.6);
    cloudStep(game, p, a);
    if (k === 12) course.star(game, p);
  }
  // A cloud bridge from the top step to the castle.
  for (let z = -83; z >= -91.5; z -= 1.4) cloudStep(game, at(0, 13 + 0.7 * steps, z), 0, 2.4);
  island(game, at, 0, 30.5, -100, 9);
  castle(game, at, 30.5);
  box(game, [3, 1, 3], at(0, 31, -104), 0xffe7a8, 'star-dais');
  course.star(game, at(0, 31.5, -104));

  buildReturnPad(game, teleports, s, index);
  return course;
}

// --- Pieces ---------------------------------------------------------------------

function sea(game: Game, at: At): void {
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x2f8fd8, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.92 }),
  );
  water.position.set(...at(0, SEA, -50));
  water.receiveShadow = true;
  game.world.spawn(new Entity('sea', water));
}

/** A floating island: a grass slab (top at `y`) over a rocky point. */
function island(game: Game, at: At, x: number, y: number, z: number, r: number): void {
  cylinder(game, r, 2, at(x, y - 1, z), mat(GRASS, { roughness: 0.95 }), 'island', 40);
  decor(game, new THREE.CylinderGeometry(r + 0.02, r * 0.92, 0.5, 40), mat(0x7a5a3a, { roughness: 1 }), at(x, y - 2.2, z), 'island-soil');
  decor(game, new THREE.ConeGeometry(r * 0.92, r * 1.3, 12).rotateX(Math.PI), mat(ROCK, { roughness: 1 }), at(x, y - 2.45 - r * 0.65, z), 'island-rock');
}

function stone(game: Game, top: Vec3, r: number): void {
  cylinder(game, r, 0.6, [top[0], top[1] - 0.3, top[2]], mat(STONE, { roughness: 0.9 }), 'stone', 20);
  decor(game, new THREE.ConeGeometry(r * 0.9, r * 1.6, 8).rotateX(Math.PI), mat(ROCK), [top[0], top[1] - 0.6 - r * 0.8, top[2]], 'stone-root');
}

/** A box platform that moves along `motion` and carries you. */
function platform(game: Game, size: Vec3, motion: MotionFn, color: number, name: string): Entity {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat(color, { roughness: 0.6 }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const e = new Entity(name, mesh);
  e.add(new RigidBodyComponent({ type: 'kinematicPosition', colliders: [RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2).setFriction(1)] }));
  e.add(new MovingPlatform(motion));
  game.world.spawn(e);
  return e;
}

/** A round disc spinning in place; its top is at centre.y + h/2. Returns the disc entity. */
function platformDisc(game: Game, centre: Vec3, r: number, radPerSec: number, h: number): Entity {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 40), mat(0x7b5cff, { roughness: 0.6 }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // A stripe so you can see it turn.
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(r * 2 - 0.2, 0.02, 0.4), mat(0xffd84a));
  stripe.position.y = h / 2 + 0.01;
  mesh.add(stripe);
  const e = new Entity('spin-disc', mesh);
  e.add(new RigidBodyComponent({ type: 'kinematicPosition', colliders: [RAPIER.ColliderDesc.cylinder(h / 2, r).setFriction(1)] }));
  e.add(new MovingPlatform(spin(new THREE.Vector3(...centre), radPerSec)));
  game.world.spawn(e);
  return e;
}

function cloudStep(game: Game, top: Vec3, angle: number, w = 1.9): void {
  // A flat-topped step (the collider) with puffs on its sides.
  // Local x (the width) points along `angle` in the XZ plane (outwards from the trunk on the stair).
  const e = box(game, [w, 0.5, 1.5], [top[0], top[1] - 0.25, top[2]], CLOUD, 'cloud-step', [0, -THREE.MathUtils.radToDeg(angle), 0]);
  e.tags.add('cloud-step');
  const puff = mat(CLOUD, { roughness: 1 });
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), puff);
    p.position.set((s * w) / 2, -0.15, 0);
    p.scale.set(1, 0.7, 1.1);
    e.object3d.add(p);
  }
}

function castle(game: Game, at: At, y: number): void {
  const wall = 0xf2e6d0;
  const roof = 0x4fb3ff;
  for (const [x, z] of [[-6, -95], [6, -95], [-6, -105], [6, -105]]) {
    cylinder(game, 1.3, 6, at(x, y + 3, z), mat(wall), 'castle-tower', 20);
    decor(game, new THREE.ConeGeometry(1.7, 2.6, 20), mat(roof), at(x, y + 7.3, z), 'castle-roof');
    decor(game, new THREE.BoxGeometry(0.05, 0.9, 0.7), mat(0xffd84a), at(x, y + 8.9, z + 0.35), 'pennant', false);
  }
  // Back wall with an arch shape, and a star sign.
  box(game, [10, 5, 1], at(0, y + 2.5, -107.5), wall, 'castle-wall');
  sign(game, 'STAR CASTLE', at(0, y + 4.2, -106.95), { width: 6, height: 1, bg: '#4fb3ff', fg: '#ffffff', letterSpacing: 6 });
}

/** Nimbus, a friendly cloud with a face, who greets you at the start. */
function nimbus(game: Game, p: Vec3): void {
  const root = new THREE.Group();
  root.position.set(...p);
  const body = new THREE.Group();
  root.add(body);
  const puff = mat(CLOUD, { roughness: 1 });
  const ball = (r: number, x: number, y: number, z: number, parent: THREE.Object3D = body) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), puff);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  // Nimbus sits on the grass like a heap of cushions.
  ball(0.75, 0, 0.7, 0);
  ball(0.55, -0.7, 0.55, 0);
  ball(0.55, 0.7, 0.55, 0);
  ball(0.5, 0, 0.5, -0.5);
  const head = new THREE.Group();
  head.position.set(0, 1.35, 0.15);
  body.add(head);
  ball(0.55, 0, 0, 0, head);
  ball(0.35, -0.45, 0.2, -0.05, head);
  ball(0.35, 0.45, 0.2, -0.05, head);
  const dark = mat(0x2a2f3a);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), dark);
    eye.position.set(sx * 0.18, 0.08, 0.5);
    head.add(eye);
    const blush = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), mat(0xffb3c7));
    blush.position.set(sx * 0.32, -0.08, 0.44);
    blush.scale.set(1, 0.6, 0.4);
    head.add(blush);
  }
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.022, 6, 14, Math.PI), dark);
  smile.position.set(0, -0.08, 0.52);
  smile.rotation.z = Math.PI;
  head.add(smile);
  const tag = makeLabel('Nimbus', { scale: 0.7, color: '#ffe7a8' });
  tag.position.set(0, 2.3, 0);
  root.add(tag);

  const e = new Entity('nimbus', root);
  e.tags.add('npc');
  e.add(new RigidBodyComponent({ type: 'fixed', colliders: [RAPIER.ColliderDesc.capsule(0.4, 0.75).setTranslation(0, 1.1, 0)] }));
  const npc = e.add(new Npc('nimbus', 'Nimbus', 'nimbus', body, head, THREE.MathUtils.degToRad(-30), 1.4));
  e.add(
    new Interactable({
      prompt: 'Talk to Nimbus',
      range: 3.5,
      onInteract: () => game.getSystem<DialogueSystem>('dialogue')?.start('nimbus', e, npc),
    }),
  );
  game.world.spawn(e);
}

// --- Stars --------------------------------------------------------------------------

function starGeometry(r: number): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const rr = i % 2 ? r * 0.45 : r;
    if (i) s.lineTo(Math.sin(a) * rr, Math.cos(a) * rr);
    else s.moveTo(Math.sin(a) * rr, Math.cos(a) * rr);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2 });
  g.translate(0, 0, -0.08);
  return g;
}

interface StarItem {
  /** The star and its stand. */
  group: THREE.Group;
  taken: boolean;
}

interface Checkpoint {
  id: string;
  pos: THREE.Vector3;
  flag: THREE.Mesh;
}

interface BouncePad {
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  /** Launch apex height above the pad (m) and forward speed (m/s). */
  height: number;
  forward: number;
}

const STAR_R = 0.6;
/** The star's two lower points sit this far below its centre. */
const STAR_FOOT = STAR_R * Math.cos((Math.PI * 4) / 5) * -1 + 0.05;
const STAND_H = 0.1;

/**
 * Stars, checkpoints, bounce pads and the splash back to the last flag.
 * Runs before the player controller each fixed step.
 */
export class StarCourse implements System {
  readonly name = 'star-course';
  private game!: Game;
  private ready = false;
  readonly stars: StarItem[] = [];
  readonly checkpoints: Checkpoint[] = [];
  readonly pads: BouncePad[] = [];
  found = 0;
  /** The flag you'll go back to if you fall in. */
  current: Checkpoint | null = null;
  private padCooldown = 0;
  private splashCooldown = 0;
  private panel!: HTMLDivElement;
  private unsub: (() => void) | null = null;
  /** Counters for the checks. */
  splashes = 0;
  bounces = 0;

  constructor(private origin: Vec3) {}

  init(game: Game): void {
    if (this.ready) return;
    this.ready = true;
    this.game = game;
    this.panel = document.createElement('div');
    Object.assign(this.panel.style, {
      position: 'absolute',
      top: '14px',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '8px 14px',
      borderRadius: '10px',
      background: 'rgba(20,60,110,0.72)',
      color: '#ffe98a',
      font: '600 16px system-ui, sans-serif',
      display: 'none',
      pointerEvents: 'none',
      zIndex: '4',
    });
    document.getElementById('app')?.appendChild(this.panel);
    this.unsub = game.events.on('teleport', () => this.render());
  }

  dispose(): void {
    this.unsub?.();
  }

  get total(): number {
    return this.stars.length;
  }

  /**
   * A star standing upright on a little stand that rests on the surface at
   * `surface` (world, or local to `parent` when it rides a moving platform).
   */
  star(game: Game, surface: Vec3, parent?: Entity): void {
    const g = new THREE.Group();
    g.position.set(...surface);
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, STAND_H, 24), mat(0xb8862f, { metalness: 0.5, roughness: 0.4 }));
    stand.position.y = STAND_H / 2;
    stand.castShadow = true;
    g.add(stand);
    const star = new THREE.Mesh(starGeometry(STAR_R), mat(0xffd23f, { emissive: 0xffb300, emissiveIntensity: 0.55, metalness: 0.3, roughness: 0.3 }));
    star.position.y = STAND_H + STAR_FOOT;
    star.rotation.y = (this.stars.length * 0.9) % Math.PI;
    star.castShadow = true;
    g.add(star);
    if (parent) parent.object3d.add(g);
    else game.world.spawn(new Entity('star', g));
    this.stars.push({ group: g, taken: false });
  }

  /** World position of a star's stand (its foot). */
  starPos(s: StarItem, out = new THREE.Vector3()): THREE.Vector3 {
    s.group.parent?.updateMatrixWorld(true);
    return s.group.getWorldPosition(out);
  }

  checkpoint(game: Game, ground: Vec3, id: string, start = false): void {
    const [x, y, z] = ground;
    cylinder(game, 0.07, 3.2, [x, y + 1.6, z], mat(0xdedede, { metalness: 0.6, roughness: 0.3 }), 'flagpole', 10);
    decor(game, new THREE.SphereGeometry(0.12, 10, 8), mat(0xffd84a), [x, y + 3.25, z], 'flag-knob');
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.6, 0.9), mat(start ? 0xffd84a : 0xd04040));
    flag.position.set(x, y + 2.8, z + 0.48);
    flag.castShadow = true;
    game.world.spawn(new Entity('flag', flag));
    const cp = { id, pos: new THREE.Vector3(x, y, z), flag };
    this.checkpoints.push(cp);
    if (start) this.current = cp;
  }

  bouncePad(game: Game, top: Vec3, dir: THREE.Vector3, height: number, forward: number): void {
    const [x, y, z] = top;
    cylinder(game, 1.1, 0.3, [x, y + 0.15, z], mat(0xff5c8a, { roughness: 0.4 }), 'bounce-pad', 24);
    decor(game, new THREE.TorusGeometry(1.0, 0.08, 8, 28).rotateX(Math.PI / 2), mat(0xffffff), [x, y + 0.31, z], 'bounce-ring', false);
    // An arrow painted on top, pointing where it sends you.
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.8, 3).rotateX(-Math.PI / 2), mat(0xffffff));
    arrow.scale.y = 0.05;
    arrow.position.set(x, y + 0.31, z);
    arrow.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI;
    game.world.spawn(new Entity('bounce-arrow', arrow));
    this.pads.push({ pos: new THREE.Vector3(x, y + 0.3, z), dir: dir.clone().normalize(), height, forward });
  }

  private here(): boolean {
    return (this.game.getSystem('teleports') as { current?: string } | undefined)?.current === 'stars';
  }

  preFixedUpdate(dt: number): void {
    const ctrl = this.game.world.find('player')?.get(PlayerController);
    if (!ctrl) return;
    const feet = ctrl.feetPosition;
    this.splashCooldown = Math.max(0, this.splashCooldown - dt);
    if (Math.abs(feet.x - this.origin[0]) > 150 || Math.abs(feet.z - this.origin[2]) > 200) return;

    // Fell in the sea: back to the last flag.
    if (feet.y < SEA + 1.5 && this.splashCooldown === 0) {
      const cp = this.current ?? this.checkpoints[0];
      if (cp) {
        ctrl.placeAt(_v.copy(cp.pos).add(_off.set(1.2, 0.05, 0)), ctrl.yaw, 0);
        this.splashes++;
        this.splashCooldown = 0.5;
        this.game.events.emit('notify', { text: 'Splash! Back to the last flag.' });
      }
      return;
    }

    // Flags.
    for (const cp of this.checkpoints) {
      if (cp !== this.current && Math.hypot(feet.x - cp.pos.x, feet.z - cp.pos.z) < 3 && Math.abs(feet.y - cp.pos.y) < 1.5) {
        this.current = cp;
        (cp.flag.material as THREE.MeshStandardMaterial).color.setHex(0xffd84a);
        this.game.events.emit('notify', { text: 'Checkpoint!' });
      }
    }

    // Bounce pads.
    this.padCooldown = Math.max(0, this.padCooldown - dt);
    if (this.padCooldown === 0) {
      for (const p of this.pads) {
        if (Math.hypot(feet.x - p.pos.x, feet.z - p.pos.z) < 1.05 && Math.abs(feet.y - p.pos.y) < 0.25) {
          const g = ctrl.cfg.gravity;
          ctrl.velocity.set(p.dir.x * p.forward, Math.sqrt(2 * g * p.height), p.dir.z * p.forward);
          this.padCooldown = 0.6;
          this.bounces++;
          this.game.events.emit('stars:bounce', {});
        }
      }
    }

    // Stars.
    for (const s of this.stars) {
      if (s.taken) continue;
      const p = this.starPos(s, _v);
      if (Math.hypot(feet.x - p.x, feet.z - p.z) < 1.0 && feet.y - p.y > -0.6 && feet.y - p.y < 1.4) this.take(s);
    }
  }

  private take(s: StarItem): void {
    s.taken = true;
    s.group.removeFromParent();
    this.found++;
    const all = this.found === this.total;
    this.game.events.emit('notify', { text: all ? 'Every star! Nimbus will want to hear about this.' : `Star! ${this.found} / ${this.total}` });
    this.game.events.emit('stars:star', { found: this.found, total: this.total });
    if (all) this.game.state.setFlag('stars.all');
    this.render();
  }

  private render(): void {
    this.panel.style.display = this.here() ? 'block' : 'none';
    this.panel.textContent = `Stars: ${this.found} / ${this.total}`;
  }
}

const _v = new THREE.Vector3();
const _off = new THREE.Vector3();

declare module '@ingine/engine/core/EventBus' {
  interface GameEvents {
    'stars:star': { found: number; total: number };
    'stars:bounce': Record<string, never>;
  }
}
