import * as THREE from 'three';
import type { Game } from '@ingine/engine/core/Game';
import type { System } from '@ingine/engine/core/System';
import { Entity } from '@ingine/engine/entities/Entity';
import { RAPIER } from '@ingine/engine/physics/PhysicsWorld';
import { RigidBodyComponent } from '@ingine/engine/physics/RigidBodyComponent';
import { Npc } from '@ingine/engine/gameplay/components/Npc';
import { Wander } from '@ingine/engine/gameplay/components/Wander';
import { Interactable } from '@ingine/engine/gameplay/interaction/Interactable';
import { PlayerController } from '@ingine/engine/gameplay/player/PlayerController';
import type { DialogueSystem } from '@ingine/engine/dialogue/DialogueSystem';
import { makeLabel } from '@ingine/engine/render/labels';
import { addZipline } from '@ingine/engine/world/builders';
import type { Teleports } from '../Teleports';
import { sceneById, type Vec3 } from '../scenes';
import { box, cylinder, decor, label, mat, seeded, sign, tree } from './kit';
import { buildReturnPad } from './hub';

/**
 * Murph Land: a cat paradise for Gene's cat Murphy. A giant statue of Murphy
 * on a plinth (with Murphy himself lounging beside it), four cat trees you can
 * climb with ziplines between them, giant yarn balls, a giant cardboard box,
 * a giant food bowl and a toy mouse. Murphy coins lie on the ground, on the
 * cat-tree platforms and inside the box: find them all. Cats wander about and
 * are happy to chat.
 *
 * Murphy is drawn as a ginger tabby until we know what he really looks like:
 * change FUR / STRIPE below.
 */

/** Murphy's colours. */
const FUR = 0xe08a3c;
const STRIPE = 0xb05f22;
const CREAM = 0xf6e3c6;

type At = (x: number, y: number, z: number) => Vec3;

export function buildMurph(game: Game, teleports: Teleports, index: number): MurphCoins {
  const s = sceneById('murph')!;
  const [ox, oy, oz] = s.origin;
  const at: At = (x, y, z) => [ox + x, oy + y, oz + z];

  ground(game, at);
  statue(game, at);
  const trees = [
    [-18, -14],
    [18, -14],
    [-18, -46],
    [18, -46],
  ] as const;
  const platformTops: Vec3[] = [];
  trees.forEach(([x, z], i) => platformTops.push(...catTree(game, at, x, z, i)));
  ziplines(game, at);
  toys(game, at);
  cats(game, at, oy);
  buildReturnPad(game, teleports, s, index);

  const coins = game.addSystem(new MurphCoins(at(0, 0, 0)));
  coins.init(game);
  for (const p of coinSpots(at, platformTops)) coins.add(game, p);
  return coins;
}

// --- Land ----------------------------------------------------------------------

function ground(game: Game, at: At): void {
  box(game, [100, 1, 100], at(0, -0.5, -25), 0x9ad28a, 'murph-grass');
  // A soft sandy path from the arrival to the statue, with paw prints.
  decor(game, new THREE.BoxGeometry(4, 0.02, 34), mat(0xf1dfb8, { roughness: 1 }), at(0, 0.01, -9), 'path', false);
  const paw = mat(0xc9a77c, { roughness: 1 });
  for (let k = 0; k < 12; k++) {
    const z = 3 - k * 2.4;
    const x = k % 2 ? 0.5 : -0.5;
    decor(game, new THREE.CylinderGeometry(0.22, 0.22, 0.01, 16), paw, at(x, 0.025, z), 'paw', false);
    for (let t = 0; t < 4; t++) {
      const a = -0.9 + t * 0.6;
      decor(game, new THREE.CylinderGeometry(0.08, 0.08, 0.01, 10), paw, at(x + Math.sin(a) * 0.3, 0.025, z - Math.cos(a) * 0.3), 'toe', false);
    }
  }
  sign(game, 'MURPH LAND', at(0, 3.2, -1.5), { width: 5, height: 1, bg: '#f28cb1', fg: '#ffffff' });
  for (const sx of [-1, 1]) cylinder(game, 0.15, 3.7, at(sx * 2.6, 1.85, -1.55), mat(0xffffff), 'sign-post', 10);
  label(game, 'Find every Murphy coin! Climb the cat trees, ride the ziplines, talk to the cats.', at(0, 2.2, 2), 0.55, '#fff3c4');
  // Flowers and trees round the edge.
  const rand = seeded(7);
  for (let i = 0; i < 40; i++) {
    const a = rand() * Math.PI * 2;
    const r = 38 + rand() * 9;
    const p = at(Math.sin(a) * r, 0, -25 + Math.cos(a) * r);
    tree(game, p[0], p[2], 0.9 + rand() * 0.6, p[1]);
  }
  const petal = [0xff8fb1, 0xffd166, 0xb48cff, 0xffffff];
  for (let i = 0; i < 70; i++) {
    const x = (rand() - 0.5) * 80;
    const z = -25 + (rand() - 0.5) * 80;
    if (Math.abs(x) < 3 && z > -26) continue;
    decor(game, new THREE.SphereGeometry(0.12, 8, 6), mat(petal[i % 4]), at(x, 0.1, z), 'flower', false);
  }
}

/** A cat built from simple shapes, facing +Z, sitting or standing. `s` = scale (1 ≈ a big house cat). */
export function catModel(o: { fur: number; stripe?: number; belly?: number; s: number; sitting?: boolean }): { root: THREE.Group; head: THREE.Group } {
  const root = new THREE.Group();
  const fur = mat(o.fur, { roughness: 0.85 });
  const stripe = o.stripe !== undefined ? mat(o.stripe, { roughness: 0.85 }) : null;
  const belly = mat(o.belly ?? CREAM, { roughness: 0.85 });
  const s = o.s;
  const m = (geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root) => {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x * s, y * s, z * s);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  if (o.sitting) {
    const body = m(new THREE.SphereGeometry(0.2 * s, 16, 12), fur, 0, 0.2, -0.02);
    body.scale.set(1, 1.25, 1);
    m(new THREE.SphereGeometry(0.12 * s, 12, 10), belly, 0, 0.22, 0.1).scale.set(1, 1.4, 0.7);
    for (const sx of [-1, 1]) m(new THREE.SphereGeometry(0.06 * s, 10, 8), belly, sx * 0.07, 0.04, 0.14);
    const tail = m(new THREE.TorusGeometry(0.17 * s, 0.035 * s, 8, 16, Math.PI * 1.2), fur, 0, 0.04, -0.02);
    tail.rotation.x = Math.PI / 2;
    // Tabby stripes: short bands across the back.
    if (stripe)
      for (const y of [0.18, 0.27, 0.36]) {
        const band = m(new THREE.TorusGeometry(0.2 * s, 0.014 * s, 6, 16, Math.PI * 0.7), stripe, 0, y, -0.02);
        band.rotation.set(Math.PI / 2, 0, Math.PI + Math.PI * 0.15);
        band.scale.set(1.0, 1.0, 1);
      }
  } else {
    const body = m(new THREE.CapsuleGeometry(0.11 * s, 0.32 * s, 6, 12), fur, 0, 0.24, 0);
    body.rotation.x = Math.PI / 2;
    for (const [x, z] of [[-0.07, 0.15], [0.07, 0.15], [-0.07, -0.15], [0.07, -0.15]]) m(new THREE.CylinderGeometry(0.035 * s, 0.035 * s, 0.17 * s, 8), fur, x, 0.085, z);
    const tail = m(new THREE.CylinderGeometry(0.025 * s, 0.03 * s, 0.32 * s, 8), fur, 0, 0.38, -0.3);
    tail.rotation.x = -0.6;
    if (stripe) for (const z of [-0.1, 0, 0.1]) m(new THREE.TorusGeometry(0.112 * s, 0.015 * s, 6, 20), stripe, 0, 0.24, z);
  }
  const head = new THREE.Group();
  head.position.set(0, (o.sitting ? 0.5 : 0.36) * s, (o.sitting ? 0.05 : 0.27) * s);
  root.add(head);
  m(new THREE.SphereGeometry(0.13 * s, 16, 12), fur, 0, 0, 0, head);
  m(new THREE.SphereGeometry(0.065 * s, 10, 8), belly, 0, -0.04, 0.09, head).scale.set(1.3, 0.8, 0.8);
  for (const sx of [-1, 1]) {
    const ear = m(new THREE.ConeGeometry(0.05 * s, 0.1 * s, 4), fur, sx * 0.075, 0.12, -0.01, head);
    ear.rotation.z = -sx * 0.25;
    m(new THREE.SphereGeometry(0.025 * s, 8, 6), mat(0x2b5a2b, { roughness: 0.3 }), sx * 0.05, 0.02, 0.11, head);
  }
  m(new THREE.SphereGeometry(0.018 * s, 8, 6), mat(0xe58aa0), 0, -0.02, 0.135, head);
  if (stripe) m(new THREE.BoxGeometry(0.02 * s, 0.01 * s, 0.1 * s), stripe, 0, 0.125, 0.0, head);
  return { root, head };
}

function statue(game: Game, at: At): void {
  // Plinth (x -4..4, z -34..-26) with steps up its east side.
  box(game, [8, 1.6, 8], at(0, 0.8, -30), 0xd9cfbd, 'plinth');
  for (let k = 0; k < 3; k++) {
    const h = 0.4 * (k + 1);
    box(game, [0.7, h, 3], at(4.35 + (2 - k) * 0.7, h / 2, -30), 0xcfc4af, 'plinth-step');
  }
  sign(game, 'MURPHY', at(0, 0.85, -25.98), { width: 3.2, height: 0.7, bg: '#d9cfbd', fg: '#7a4a1d' });
  const { root } = catModel({ fur: FUR, stripe: STRIPE, s: 14, sitting: true });
  root.position.set(...at(0, 1.6, -31));
  game.world.spawn(new Entity('murphy-statue', root));
  // Collider for the statue's body so you can't walk through it.
  const solid = new Entity('murphy-statue-solid');
  solid.object3d.position.set(...at(0, 1.6 + 3.5, -31.3));
  solid.add(new RigidBodyComponent({ type: 'fixed', colliders: [RAPIER.ColliderDesc.capsule(1.6, 2.8)] }));
  game.world.spawn(solid);
  label(game, 'Murphy, King of Murph Land', at(0, 10.6, -31), 1.4, '#ffe066');
}

/** A climbable cat tree: a carpeted post with platforms spiralling up to a big top deck. Returns platform tops. */
function catTree(game: Game, at: At, x: number, z: number, i: number): Vec3[] {
  const carpet = [0xe8d6b8, 0xd9b8e0, 0xb8d9e8, 0xf2c4a8][i];
  const tops: Vec3[] = [];
  box(game, [3.4, 0.4, 3.4], at(x, 0.2, z), carpet, 'cat-tree-base');
  cylinder(game, 0.5, 10.2, at(x, 5.1, z), mat(0xc7a57a, { roughness: 1 }), 'cat-tree-post', 16);
  const steps = 9;
  for (let k = 0; k < steps; k++) {
    const a = (k / 2.5) * Math.PI + i;
    const y = 0.4 + 0.9 * (k + 1);
    const px = x + Math.cos(a) * 1.55;
    const pz = z + Math.sin(a) * 1.55;
    cylinder(game, 0.85, 0.16, at(px, y - 0.08, pz), mat(carpet, { roughness: 1 }), 'cat-tree-step', 20);
    tops.push(at(px, y, pz));
  }
  const topY = 0.4 + 0.9 * (steps + 1);
  cylinder(game, 2.3, 0.24, at(x, topY - 0.12, z), mat(carpet, { roughness: 1 }), 'cat-tree-top', 28);
  // A little dome house on top, and a dangling toy.
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.0, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(carpet, { roughness: 1 }));
  dome.position.set(...at(x - 1.0, topY, z - 0.6));
  dome.castShadow = true;
  game.world.spawn(new Entity('cat-tree-dome', dome));
  tops.push(at(x + 1.2, topY, z + 0.6));
  return tops;
}

/** Top deck height of the cat trees (see catTree). */
const TREE_TOP = 0.4 + 0.9 * 10;

function ziplines(game: Game, at: At): void {
  const lines: [Vec3, Vec3][] = [
    [at(-16.2, TREE_TOP + 2.4, -13.4), at(14.2, 2.6, -16)],
    [at(16.2, TREE_TOP + 2.4, -46.6), at(-13.5, 2.6, -44)],
    [at(-18.6, TREE_TOP + 2.4, -44.4), at(-6, 2.6, -24)],
    [at(18.6, TREE_TOP + 2.4, -15.6), at(6, 2.6, -36)],
  ];
  for (const [from, to] of lines) addZipline(game, { from, to });
}

function ball(game: Game, at: At, x: number, z: number, r: number, color: number, band: number): void {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 20), mat(color, { roughness: 0.95 }));
  mesh.position.set(...at(x, r, z));
  mesh.castShadow = true;
  const e = new Entity('yarn-ball', mesh);
  e.add(new RigidBodyComponent({ type: 'fixed', colliders: [RAPIER.ColliderDesc.ball(r)] }));
  game.world.spawn(e);
  // Wound strands: rings at a few angles.
  for (let k = 0; k < 5; k++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.005, r * 0.03, 6, 40), mat(band, { roughness: 0.95 }));
    ring.rotation.set(k * 0.7, k * 1.1, 0);
    ring.position.copy(mesh.position);
    game.world.spawn(new Entity('yarn', ring));
  }
  // A loose strand trailing across the grass.
  const pts = [new THREE.Vector3(...at(x + r * 0.9, 0.05, z + 0.3))];
  for (let k = 1; k < 8; k++) pts.push(new THREE.Vector3(...at(x + r + k * 0.8, 0.05, z + Math.sin(k) * 0.8)));
  const strand = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.06, 6), mat(band));
  game.world.spawn(new Entity('yarn-strand', strand));
}

function toys(game: Game, at: At): void {
  ball(game, at, -9, -8, 2.5, 0xe25d6b, 0xb83a49);
  ball(game, at, 10, -24, 3, 0x5aa0e0, 0x3a78b8);
  ball(game, at, -11, -38, 2, 0xb48cff, 0x8a62d6);

  // Giant cardboard box, open top, a doorway on the front.
  const bx = 12;
  const bz = -38;
  const card = 0xc89c62;
  box(game, [6, 4, 0.2], at(bx, 2, bz - 3), card, 'cardboard');
  box(game, [0.2, 4, 6], at(bx - 3, 2, bz), card, 'cardboard');
  box(game, [0.2, 4, 6], at(bx + 3, 2, bz), card, 'cardboard');
  box(game, [2.3, 4, 0.2], at(bx - 1.85, 2, bz + 3), card, 'cardboard');
  box(game, [2.3, 4, 0.2], at(bx + 1.85, 2, bz + 3), card, 'cardboard');
  box(game, [1.4, 1.9, 0.2], at(bx, 3.05, bz + 3), card, 'cardboard');
  // Flaps folded open, and tape.
  for (const sx of [-1, 1]) box(game, [0.2, 0.15, 6], at(bx + sx * 3.9, 4.0, bz), card, 'flap', [0, 0, sx * 70]);
  decor(game, new THREE.BoxGeometry(6.05, 0.3, 0.22), mat(0xd9c39a), at(bx, 3.85, bz + 3), 'tape', false);
  sign(game, 'THIS SIDE UP', at(bx + 3.11, 2.2, bz), { width: 3, height: 0.6, yawDeg: 90, bg: '#c89c62', fg: '#4a3420' });

  // Giant food bowl full of kibble.
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(3, 2.4, 1.2, 32, 1, true), mat(0xff8fb1, { roughness: 0.4 }));
  bowl.position.set(...at(-4, 0.6, -50));
  (bowl.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  game.world.spawn(new Entity('bowl', bowl));
  cylinder(game, 3.0, 0.9, at(-4, 0.45, -50), mat(0x9a6a3a, { roughness: 1 }), 'kibble-heap', 32);
  const rand = seeded(5);
  for (let k = 0; k < 60; k++) {
    const a = rand() * Math.PI * 2;
    const r = rand() * 2.6;
    decor(game, new THREE.DodecahedronGeometry(0.22, 0), mat(k % 2 ? 0x8a5a2e : 0xa8743a), at(-4 + Math.cos(a) * r, 0.95, -50 + Math.sin(a) * r), 'kibble');
  }
  sign(game, 'MURPHY', at(-4, 0.75, -46.98), { width: 2, height: 0.5, bg: '#ff8fb1', fg: '#ffffff' });

  // A big toy mouse with a string tail.
  const mouse = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), mat(0x9aa0a6, { roughness: 0.9 }));
  mouse.scale.set(1.2, 0.9, 1.8);
  mouse.position.set(...at(7, 0.9, -6));
  mouse.castShadow = true;
  const me = new Entity('toy-mouse', mouse);
  me.add(new RigidBodyComponent({ type: 'fixed', colliders: [RAPIER.ColliderDesc.cuboid(1.1, 0.85, 1.7)] }));
  game.world.spawn(me);
  for (const sx of [-1, 1]) decor(game, new THREE.CylinderGeometry(0.45, 0.45, 0.08, 16).rotateX(Math.PI / 2), mat(0xf2b8c6), at(7 + sx * 0.6, 1.8, -4.6), 'mouse-ear');
  decor(game, new THREE.SphereGeometry(0.15, 10, 8), mat(0xe58aa0), at(7, 0.95, -4.25), 'mouse-nose');
  const tailPts = [new THREE.Vector3(...at(7, 0.5, -7.7)), new THREE.Vector3(...at(7.6, 0.1, -9.5)), new THREE.Vector3(...at(6.4, 0.06, -11))];
  game.world.spawn(new Entity('mouse-tail', new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tailPts), 20, 0.07, 6), mat(0xe58aa0))));

  // Cushions to flop on.
  for (const [x, z, c] of [[-4, -20, 0xffd166], [4, -21, 0x7bd389], [-14, -26, 0xff8fb1], [15, -30, 0xb48cff]] as const) {
    box(game, [2.2, 0.35, 2.2], at(x, 0.175, z), c, 'cushion');
  }
  // Murphy's royal cushion beside the plinth.
  box(game, [1.6, 0.3, 1.6], at(5.6, 0.15, -24.4), 0x8b1e3f, 'royal-cushion');
}

// --- Cats ----------------------------------------------------------------------

export function addCat(
  game: Game,
  o: { id: string; name: string; fur: number; stripe?: number; belly?: number; s: number; at: Vec3; facingDeg: number; sitting?: boolean; path?: [number, number][]; groundY: number },
): Entity {
  const { root, head } = catModel({ fur: o.fur, stripe: o.stripe, belly: o.belly, s: o.s, sitting: o.sitting });
  const holder = new THREE.Group();
  holder.position.set(...o.at);
  holder.add(root);
  const tag = makeLabel(o.name, { scale: 0.55, color: '#ffe7a8' });
  tag.position.y = (o.sitting ? 0.85 : 0.75) * o.s;
  holder.add(tag);
  const e = new Entity(o.id, holder);
  e.tags.add('npc');
  e.tags.add('cat');
  const h = 0.5 * o.s;
  e.add(
    new RigidBodyComponent({
      type: o.path ? 'kinematicPosition' : 'fixed',
      colliders: [RAPIER.ColliderDesc.capsule(Math.max(0.05, h / 2 - 0.15 * o.s), 0.15 * o.s).setTranslation(0, h / 2, 0)],
    }),
  );
  const npc = e.add(new Npc(o.id, o.name, o.id, root, head, THREE.MathUtils.degToRad(o.facingDeg), (o.sitting ? 0.5 : 0.36) * o.s));
  if (o.path) e.add(new Wander({ path: o.path, groundAt: () => o.groundY, speed: 0.7, pause: [2, 6], seed: o.id.length * 7 }));
  e.add(
    new Interactable({
      prompt: `Talk to ${o.name}`,
      range: 3,
      onInteract: () => game.getSystem<DialogueSystem>('dialogue')?.start(o.id, e, npc),
    }),
  );
  game.world.spawn(e);
  return e;
}

function cats(game: Game, at: At, oy: number): void {
  const loop = (pts: [number, number][]) =>
    pts.map(([x, z]) => {
      const p = at(x, 0, z);
      return [p[0], p[2]] as [number, number];
    });
  // Murphy himself, on his royal cushion.
  addCat(game, { id: 'murphy', name: 'Murphy', fur: FUR, stripe: STRIPE, s: 1.8, at: at(5.6, 0.3, -24.4), facingDeg: -20, sitting: true, groundY: oy });
  addCat(game, { id: 'biscuit', name: 'Biscuit', fur: 0xd9b48a, s: 1.5, at: at(-4, 0.35, -20), facingDeg: 20, sitting: true, groundY: oy });
  addCat(game, { id: 'mochi', name: 'Mochi', fur: 0xf4f1ea, belly: 0xffffff, s: 1.5, at: at(12, 0, -38), facingDeg: 0, sitting: true, groundY: oy });
  addCat(game, {
    id: 'pickles',
    name: 'Pickles',
    fur: 0x3a3a3a,
    belly: 0xf4f1ea,
    s: 1.6,
    at: at(-6, 0, -12),
    facingDeg: 0,
    path: loop([[-6, -12], [-14, -18], [-8, -28], [-2, -16]]),
    groundY: oy,
  });
  addCat(game, {
    id: 'noodle',
    name: 'Noodle',
    fur: 0x8a8f99,
    stripe: 0x5c616a,
    s: 1.7,
    at: at(8, 0, -14),
    facingDeg: 0,
    path: loop([[8, -14], [14, -20], [8, -32], [4, -24]]),
    groundY: oy,
  });
  addCat(game, { id: 'sir_pounce', name: 'Sir Pounce', fur: 0xf2f2f2, stripe: 0x2a2a2a, s: 1.5, at: at(-17.2, 0.4, -12.7), facingDeg: 30, sitting: true, groundY: oy });
  addCat(game, {
    id: 'pepper',
    name: 'Pepper',
    fur: 0x2a2a2a,
    s: 1.5,
    at: at(-2, 0, -40),
    facingDeg: 0,
    path: loop([[-2, -40], [6, -44], [2, -52], [-10, -46]]),
    groundY: oy,
  });
}

// --- Coins ---------------------------------------------------------------------

/** Where the coins lie: always on a surface (ground, platforms, the plinth, inside the box). */
function coinSpots(at: At, platformTops: Vec3[]): Vec3[] {
  const ground: [number, number][] = [
    [0, -3], [0, -8], [-0.6, -13], [0.6, -18],
    [-9, -12.5], [-4.5, -8], [7, -10], [11, -6],
    [10, -19], [14, -27], [-14, -32], [-11, -42],
    [-4, -45], [6, -52], [-20, -30], [20, -30],
    [-24, -6], [24, -6], [0, -56], [-28, -50],
  ];
  const spots: Vec3[] = ground.map(([x, z]) => at(x, 0, z));
  // On the cat trees: every third step, and each top deck.
  platformTops.forEach((p, k) => {
    if (k % 10 === 9 || k % 10 === 4) spots.push(p);
  });
  // On the plinth, beside the statue's paws.
  spots.push(at(-3, 1.6, -27), at(3, 1.6, -27));
  // Inside the box (the floor is the ground).
  spots.push(at(11, 0, -39.5), at(13.5, 0, -37), at(12, 0, -36.2));
  // On the cushions.
  spots.push(at(-14, 0.35, -26), at(15, 0.35, -30));
  return spots;
}

let coinTexture: THREE.Texture | null = null;
/** Murphy's face stamped on a gold coin. */
function murphyFace(): THREE.Texture {
  if (coinTexture) return coinTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f2c14e';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#b8860b';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(64, 64, 58, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#c98f1a';
  // Ears and head.
  g.beginPath();
  g.moveTo(34, 50); g.lineTo(40, 22); g.lineTo(56, 40);
  g.moveTo(94, 50); g.lineTo(88, 22); g.lineTo(72, 40);
  g.fill();
  g.beginPath();
  g.arc(64, 64, 32, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#7a4a10';
  g.beginPath(); g.arc(52, 60, 4, 0, Math.PI * 2); g.arc(76, 60, 4, 0, Math.PI * 2); g.fill();
  g.font = '700 22px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText('M', 64, 88);
  coinTexture = new THREE.CanvasTexture(c);
  coinTexture.colorSpace = THREE.SRGBColorSpace;
  return coinTexture;
}

/**
 * Murphy coins: they lie flat where they are (nothing floats or spins). Walk
 * over one to pick it up. A counter shows how many you've found; finding them
 * all makes you an honorary cat (Murphy has something to say about it).
 */
export class MurphCoins implements System {
  readonly name = 'murph-coins';
  private game!: Game;
  readonly coins: { entity: Entity; pos: THREE.Vector3; taken: boolean }[] = [];
  found = 0;
  private panel!: HTMLDivElement;
  private ready = false;
  private unsub: (() => void) | null = null;

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
      background: 'rgba(60,30,10,0.7)',
      color: '#ffe7a8',
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

  add(game: Game, surface: Vec3): void {
    const r = 0.24;
    const t = 0.04;
    const gold = new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.35, metalness: 0.4, emissive: 0x3a2600, emissiveIntensity: 0.4 });
    const face = new THREE.MeshStandardMaterial({ map: murphyFace(), roughness: 0.35, metalness: 0.3, emissive: 0x3a2600, emissiveIntensity: 0.4 });
    // Cylinder groups: side, top, bottom.
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, t, 28), [gold, face, gold]);
    // Lying flat, resting on the surface, turned a little at random.
    mesh.position.set(surface[0], surface[1] + t / 2, surface[2]);
    mesh.rotation.y = (this.coins.length * 2.399) % (Math.PI * 2);
    mesh.castShadow = true;
    const e = new Entity('murphy-coin', mesh);
    e.tags.add('murphy-coin');
    game.world.spawn(e);
    this.coins.push({ entity: e, pos: mesh.position.clone(), taken: false });
  }

  get total(): number {
    return this.coins.length;
  }

  preFixedUpdate(): void {
    const ctrl = this.game.world.find('player')?.get(PlayerController);
    if (!ctrl) return;
    const feet = ctrl.entity.object3d.position;
    if (Math.abs(feet.x - this.origin[0]) > 80 || Math.abs(feet.z - this.origin[2]) > 100) return;
    for (const c of this.coins) {
      if (c.taken) continue;
      if (Math.hypot(feet.x - c.pos.x, feet.z - c.pos.z) < 0.8 && c.pos.y - feet.y > -0.4 && c.pos.y - feet.y < 1.2) this.take(c);
    }
  }

  private take(c: { entity: Entity; taken: boolean }): void {
    c.taken = true;
    this.game.world.destroy(c.entity);
    this.found++;
    const all = this.found === this.total;
    this.game.events.emit('notify', { text: all ? 'Every Murphy coin! Go and see Murphy.' : `Murphy coin! ${this.found} / ${this.total}` });
    this.game.events.emit('murph:coin', { found: this.found, total: this.total });
    if (all) this.game.state.setFlag('murph.allCoins');
    this.render();
  }

  private render(): void {
    const here = (this.game.getSystem('teleports') as { current?: string } | undefined)?.current === 'murph';
    this.panel.style.display = here ? 'block' : 'none';
    this.panel.textContent = `Murphy coins: ${this.found} / ${this.total}`;
  }
}

declare module '@ingine/engine/core/EventBus' {
  interface GameEvents {
    'murph:coin': { found: number; total: number };
  }
}
