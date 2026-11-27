import * as THREE from 'three';
import type { Game } from '@ingine/engine/core/Game';
import { Entity } from '@ingine/engine/entities/Entity';
import { RAPIER } from '@ingine/engine/physics/PhysicsWorld';
import { RigidBodyComponent } from '@ingine/engine/physics/RigidBodyComponent';
import { Npc } from '@ingine/engine/gameplay/components/Npc';
import { Wander } from '@ingine/engine/gameplay/components/Wander';
import { Interactable } from '@ingine/engine/gameplay/interaction/Interactable';
import type { DialogueSystem } from '@ingine/engine/dialogue/DialogueSystem';
import { makeLabel } from '@ingine/engine/render/labels';
import type { Teleports } from '../Teleports';
import { sceneById, type Vec3 } from '../scenes';
import { box, cylinder, decor, label, mat, sign, tree } from './kit';
import { buildReturnPad } from './hub';
import { BallQuest, DogAnim, PupBrain, RocketShow, SpookyGhost, type RocketParts } from './buddiesPlay';

export { BallQuest } from './buddiesPlay';

/**
 * Buddies park: a homage to the Buddies movies (the talking golden retriever
 * puppies from the Air Bud spin-offs), built in our own greybox style.
 *
 * Fernfield's park, with the five pups wandering round the sports field and
 * Buddy and Molly on a picnic blanket by the sign. Each pup has lost the ball
 * for their sport, and each ball is in a corner themed on one of the sequels:
 * a snowy hill (Snow Buddies), a rocket on its pad (Space Buddies), a
 * Christmas corner (Santa Buddies), a spooky house (Spooky Buddies) and a
 * pyramid to climb (Treasure Buddies), plus a cape stand (Super Buddies).
 * Pick a ball up by walking over it and its pup comes running for it. Then
 * play fetch: the pup drops the ball at your feet, you throw it, it races
 * after it. With every ball home, the big red button sends the pups to space.
 * The game itself is in buddiesPlay.ts.
 */

type At = (x: number, y: number, z: number) => Vec3;

const GOLD = 0xd9a441;
const GOLD_LIGHT = 0xeec67a;

export interface PupDef {
  id: string;
  name: string;
  sport: string;
  /** What the ball is called in messages. */
  ball: string;
  /** Where the pup's lost ball is (scene-relative surface point). */
  lostAt: Vec3;
}

export const PUPS: PupDef[] = [
  { id: 'budderball', name: 'Budderball', sport: 'football', ball: 'football', lostAt: [-38, 2.2, -15] },
  { id: 'rosebud', name: 'Rosebud', sport: 'soccer', ball: 'soccer ball', lostAt: [-36, 0, -47] },
  { id: 'mudbud', name: 'Mudbud', sport: 'volleyball', ball: 'volleyball', lostAt: [38, 0.1, -51] },
  { id: 'buddha', name: 'Buddha', sport: 'baseball', ball: 'baseball', lostAt: [0, 3.2, -70] },
  { id: 'b_dawg', name: 'B-Dawg', sport: 'basketball', ball: 'basketball', lostAt: [41.5, 0.3, -15] },
];

export function buildBuddies(game: Game, teleports: Teleports, index: number): BallQuest {
  const s = sceneById('buddies')!;
  const [ox, oy, oz] = s.origin;
  const at: At = (x, y, z) => [ox + x, oy + y, oz + z];

  park(game, at);
  sports(game, at);
  snowHill(game, at);
  const rocket = rocketPad(game, at);
  christmas(game, at);
  const ghost = spookyHouse(game, at);
  pyramid(game, at);
  capeStand(game, at);
  buildReturnPad(game, teleports, s, index);

  // Buddy and Molly on the picnic blanket by the sign.
  addDog(game, { id: 'buddy', name: 'Buddy', s: 1.0, at: at(-6.2, 0.04, -1), facingDeg: 25, sitting: true, groundY: oy });
  addDog(game, { id: 'molly', name: 'Molly', s: 0.92, fur: GOLD_LIGHT, at: at(-4.4, 0.04, -0.4), facingDeg: -10, sitting: true, groundY: oy });

  const quest = game.addSystem(new BallQuest(s.origin));
  quest.init(game);
  quest.rocket = new RocketShow(game, quest, rocket);
  quest.ghost = new SpookyGhost(game, ghost, new THREE.Vector3(...at(40.8, 1.0, -53.8)), new THREE.Vector3(...at(38, 0, -51)), 3.8);
  launchConsole(game, at, quest.rocket);
  // The pups trot round the sports field, each starting at a different point.
  const loop: [number, number][] = [
    [-9, -16],
    [9, -16],
    [10, -27],
    [9, -38],
    [-9, -38],
    [-10, -27],
  ].map(([x, z]) => {
    const p = at(x, 0, z);
    return [p[0], p[2]];
  });
  PUPS.forEach((p, i) => {
    const start = at(loop[i][0] - ox, 0, loop[i][1] - oz);
    const e = addDog(game, { id: p.id, name: p.name, s: 0.65, at: start, facingDeg: 0, path: loop, startAt: i / PUPS.length, groundY: oy, accessory: p.id });
    quest.addPup(game, p, e, at(...p.lostAt));
  });
  return quest;
}

// --- The park ------------------------------------------------------------------

function park(game: Game, at: At): void {
  box(game, [120, 1, 110], at(0, -0.5, -32), 0x86c46e, 'buddies-grass');
  // A path from the arrival to the field.
  decor(game, new THREE.BoxGeometry(3, 0.02, 12), mat(0xd9c9a0, { roughness: 1 }), at(0, 0.01, -6), 'path', false);
  sign(game, 'WELCOME TO FERNFIELD', at(0, 3.2, -1.6), { width: 7, height: 1, bg: '#2e6b3a', fg: '#fff6d8', letterSpacing: 3 });
  for (const x of [-3.8, 3.8]) box(game, [0.25, 3.8, 0.25], at(x, 1.9, -1.7), 0x5a3c22, 'sign-post');
  label(game, 'Home of the Buddies', at(0, 4.1, -1.6), 0.9, '#fff3c4');
  // The picnic blanket, with a bowl and a bone.
  decor(game, new THREE.BoxGeometry(3.4, 0.03, 2.6), mat(0xd84b4b, { roughness: 1 }), at(-5.3, 0.02, -0.7), 'blanket', false);
  for (let i = 0; i < 4; i++) decor(game, new THREE.BoxGeometry(3.42, 0.035, 0.18), mat(0xffffff, { roughness: 1 }), at(-5.3, 0.022, -1.75 + i * 0.7), 'blanket-stripe', false);
  decor(game, new THREE.CylinderGeometry(0.22, 0.17, 0.1, 20), mat(0x3a6fd8), at(-3.7, 0.08, -1.6), 'bowl');
  // Trees round the edge.
  for (const [x, z, k] of [[-22, 2, 1.3], [22, 2, 1.2], [-25, -30, 1.4], [25, -32, 1.3], [-12, -58, 1.2], [14, -58, 1.3], [-50, -30, 1.1], [50, -32, 1.2]])
    tree(game, at(x, 0, z)[0], at(0, 0, z)[2], k);
  // Benches facing the field.
  for (const [x, z, r] of [[-15, -27, 90], [15, -27, -90]]) {
    box(game, [2.2, 0.12, 0.6], at(x, 0.48, z), 0x8b5a2b, 'bench', [0, r, 0]);
    box(game, [2.2, 0.5, 0.08], at(x + (r > 0 ? -0.28 : 0.28), 0.8, z), 0x8b5a2b, 'bench-back', [0, r, 0]);
  }
}

/** One sports corner per pup round the field. */
function sports(game: Game, at: At): void {
  // The field itself: a lighter rectangle with white lines.
  decor(game, new THREE.BoxGeometry(18, 0.02, 20), mat(0x9fd47f, { roughness: 1 }), at(0, 0.012, -27), 'field', false);
  const line = mat(0xffffff, { roughness: 1 });
  decor(game, new THREE.BoxGeometry(18, 0.025, 0.12), line, at(0, 0.015, -27), 'line', false);
  decor(game, new THREE.TorusGeometry(2.2, 0.06, 4, 40).rotateX(Math.PI / 2), line, at(0, 0.015, -27), 'circle', false);
  // Football goalposts (Budderball).
  const yellow = mat(0xf2d13a);
  for (const x of [-1.6, 1.6]) cylinder(game, 0.08, 5, at(x, 2.5, -15.5), yellow, 'goalpost', 10);
  box(game, [3.3, 0.16, 0.16], at(0, 1.6, -15.5), 0xf2d13a, 'crossbar');
  // A soccer goal (Rosebud), pink netting.
  for (const x of [-2, 2]) box(game, [0.12, 1.6, 0.12], at(x, 0.8, -38.5), 0xffffff, 'goal-post');
  box(game, [4.1, 0.12, 0.12], at(0, 1.6, -38.5), 0xffffff, 'goal-bar');
  decor(game, new THREE.BoxGeometry(4, 1.6, 0.03), new THREE.MeshStandardMaterial({ color: 0xf6a5c8, transparent: true, opacity: 0.45 }), at(0, 0.8, -39.6), 'goal-net', false);
  // A volleyball net with a mud puddle (Mudbud).
  for (const z of [-24, -30]) cylinder(game, 0.06, 2.4, at(-14, 1.2, z), mat(0xdddddd, { metalness: 0.5 }), 'net-pole', 10);
  decor(game, new THREE.BoxGeometry(0.03, 0.8, 6), new THREE.MeshStandardMaterial({ color: 0x222222, transparent: true, opacity: 0.5 }), at(-14, 1.9, -27), 'volley-net', false);
  decor(game, new THREE.CylinderGeometry(2.2, 2.2, 0.02, 30), mat(0x6b4a2b, { roughness: 0.3 }), at(-17.5, 0.012, -27), 'mud', false);
  label(game, "Mudbud's mud (do not drink)", at(-17.5, 1.0, -27), 0.6);
  // Home plate and a backstop (Buddha).
  decor(game, new THREE.CylinderGeometry(0.35, 0.35, 0.03, 5), mat(0xffffff), at(14, 0.02, -30), 'home-plate', false);
  box(game, [4, 2.6, 0.1], at(14, 1.3, -32), 0x7a7f88, 'backstop');
  // A hoop (B-Dawg).
  cylinder(game, 0.08, 3.05, at(14, 1.525, -20), mat(0x333333, { metalness: 0.5 }), 'hoop-post', 10);
  box(game, [1.8, 1.05, 0.06], at(14, 3.3, -20.4), 0xffffff, 'backboard');
  decor(game, new THREE.TorusGeometry(0.23, 0.02, 8, 24).rotateX(Math.PI / 2), mat(0xe8641c), at(14, 3.05, -20.1), 'rim', false);
}

// --- Sequel corners ------------------------------------------------------------------

function cornerSign(game: Game, text: string, p: Vec3, bg: string): void {
  sign(game, text, [p[0], p[1] + 2.6, p[2]], { width: 4.2, height: 0.7, bg, fg: '#ffffff' });
  box(game, [0.15, 2.4, 0.15], [p[0], p[1] + 1.2, p[2] - 0.08], 0x5a3c22, 'corner-post');
}

/** Snow Buddies: a snowy hill, a snowman and a sled. The football is on top of the hill. */
function snowHill(game: Game, at: At): void {
  decor(game, new THREE.CylinderGeometry(10, 10, 0.04, 40), mat(0xf4f8ff, { roughness: 1 }), at(-38, 0.02, -15), 'snow', false);
  // The hill: stacked discs you can walk up (each 0.4 m).
  [7, 5.6, 4.2, 3, 1.8].forEach((r, i) => cylinder(game, r, 0.44, at(-38, 0.22 + i * 0.44, -15), mat(0xf4f8ff, { roughness: 1 }), 'snow-tier', 32));
  // A snowman.
  const snow = mat(0xffffff, { roughness: 1 });
  decor(game, new THREE.SphereGeometry(0.8, 16, 12), snow, at(-31, 0.75, -9), 'snowman');
  decor(game, new THREE.SphereGeometry(0.55, 16, 12), snow, at(-31, 1.9, -9), 'snowman');
  decor(game, new THREE.SphereGeometry(0.38, 16, 12), snow, at(-31, 2.7, -9), 'snowman');
  decor(game, new THREE.ConeGeometry(0.07, 0.4, 8).rotateX(Math.PI / 2), mat(0xf28c28), at(-31, 2.7, -8.55), 'carrot');
  // A dog sled.
  box(game, [0.9, 0.12, 2.2], at(-29, 0.35, -19), 0x8b5a2b, 'sled');
  for (const x of [-0.42, 0.42]) box(game, [0.06, 0.06, 2.6], at(-29 + x, 0.06, -19), 0x444444, 'runner');
  cornerSign(game, 'SNOW BUDDIES', at(-30, 0, -6), '#4f8fd8');
}

/** Space Buddies: a rocket on its launch pad, ready to fly. The basketball is on the pad. */
function rocketPad(game: Game, at: At): RocketParts {
  cylinder(game, 6, 0.3, at(38, 0.15, -15), mat(0x7a7f88, { roughness: 0.8 }), 'launch-pad', 32);
  // Scorch marks.
  decor(game, new THREE.CylinderGeometry(2.4, 2.4, 0.02, 24), mat(0x3a3d44, { roughness: 1 }), at(38, 0.31, -15), 'scorch', false);
  const white = mat(0xf2f2f2, { roughness: 0.5 });
  const red = mat(0xd03a3a, { roughness: 0.5 });
  // Everything that flies, built round the pad's top centre.
  const group = new THREE.Group();
  group.position.set(...at(38, 0.3, -15));
  const part = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };
  part(new THREE.CylinderGeometry(1.4, 1.4, 9, 24), white, 0, 1.2 + 4.5, 0);
  part(new THREE.ConeGeometry(1.4, 3, 24), red, 0, 1.2 + 9 + 1.5, 0);
  part(new THREE.CylinderGeometry(1.45, 1.45, 0.5, 24), red, 0, 1.2 + 6.8, 0);
  part(new THREE.CylinderGeometry(1.1, 1.4, 0.6, 24), mat(0x555a63, { metalness: 0.6 }), 0, 1.0, 0);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    part(new THREE.BoxGeometry(0.12, 2.4, 1.4), red, Math.cos(a) * 1.8, 1.6, Math.sin(a) * 1.8).rotation.y = -a;
    const b = a + Math.PI / 4;
    part(new THREE.CylinderGeometry(0.18, 0.18, 1.2, 10), mat(0x444444), Math.cos(b) * 1.0, 0.6, Math.sin(b) * 1.0);
  }
  // A round window, facing the field, with a pup looking out once they're aboard.
  part(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 24).rotateZ(Math.PI / 2), mat(0x7fc4ff, { emissive: 0x2a6aa0, emissiveIntensity: 0.4 }), -1.42, 7.2, 0);
  const face = dogModel({ s: 1.5, accessory: 'b_dawg' }).head;
  face.rotation.y = -Math.PI / 2;
  face.position.set(-1.62, 7.2, 0);
  group.add(face);
  // The flame: a cone pointing down from the engine bell.
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.95, 3, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xffa630, transparent: true, opacity: 0.85, depthWrite: false }));
  flame.geometry.rotateX(Math.PI).translate(0, -1.5, 0);
  flame.position.y = 0.7;
  const core = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff3b0, depthWrite: false }));
  core.geometry.rotateX(Math.PI).translate(0, -1, 0);
  flame.add(core);
  group.add(flame);
  game.world.spawn(new Entity('rocket', group));
  // The gantry beside it.
  box(game, [1.2, 12, 1.2], at(45.5, 6, -15), 0xd8a03a, 'gantry');
  cornerSign(game, 'SPACE BUDDIES', at(31, 0, -9), '#2a2f5a');
  return { group, flame, face, base: new THREE.Vector3(...at(38, 0.3, -15)) };
}

/** Mission control: a console with a big red button, by the field side of the pad, looking at the rocket. */
function launchConsole(game: Game, at: At, rocket: RocketShow): void {
  const desk = box(game, [0.9, 1.0, 1.6], at(29.6, 0.5, -15), 0x3a3f4a, 'launch-console', [0, 0, 0]);
  decor(game, new THREE.BoxGeometry(0.7, 0.04, 1.3), mat(0x2a6a9a, { emissive: 0x1a4a7a, emissiveIntensity: 0.6 }), at(29.6, 1.02, -15.2), 'console-screen', false);
  decor(game, new THREE.CylinderGeometry(0.2, 0.22, 0.12, 20), mat(0xe02a2a, { emissive: 0x7a0a0a, emissiveIntensity: 0.6 }), at(29.6, 1.08, -14.55), 'launch-button');
  desk.add(new Interactable({ prompt: () => rocket.prompt(), range: 2.8, onInteract: () => rocket.press() }));
  label(game, 'LAUNCH (E)', at(29.6, 1.7, -15), 0.7, '#ffd0d0');
}

/** Santa Buddies: a Christmas tree with presents and a North Pole signpost. The soccer ball is among the presents. */
function christmas(game: Game, at: At): void {
  decor(game, new THREE.CylinderGeometry(8, 8, 0.03, 40), mat(0xffffff, { roughness: 1 }), at(-38, 0.015, -50), 'snow', false);
  cylinder(game, 0.35, 1.2, at(-38, 0.6, -52), mat(0x6b4426), 'xmas-trunk', 10);
  const green = new THREE.MeshStandardMaterial({ color: 0x2f7a3a, roughness: 0.9, flatShading: true });
  [[2.6, 2.4, 2.2], [2.0, 2.0, 3.8], [1.3, 1.8, 5.2]].forEach(([r, h, y]) => decor(game, new THREE.ConeGeometry(r, h, 10), green, at(-38, y, -52), 'xmas-tree'));
  decor(game, new THREE.OctahedronGeometry(0.35), mat(0xffd84a, { emissive: 0xffc400, emissiveIntensity: 0.8 }), at(-38, 6.35, -52), 'xmas-star');
  const colors = [0xd03a3a, 0x3a6fd8, 0xf2c14e, 0x8a3ad0, 0x3ab06f];
  for (const [i, [x, z, w]] of [[-40.5, -49.5, 0.8], [-39.3, -48.6, 0.6], [-35.4, -49.8, 0.9], [-36.6, -48.4, 0.5], [-41.6, -51.6, 0.7]].entries()) {
    box(game, [w, w * 0.8, w], at(x, (w * 0.8) / 2, z), colors[i], 'present');
    decor(game, new THREE.BoxGeometry(w + 0.02, w * 0.8 + 0.02, 0.1), mat(0xffffff), at(x, (w * 0.8) / 2, z), 'ribbon', false);
  }
  // A striped North Pole post.
  for (let k = 0; k < 8; k++) decor(game, new THREE.CylinderGeometry(0.15, 0.15, 0.4, 16), mat(k % 2 ? 0xffffff : 0xd03a3a), at(-32, 0.2 + k * 0.4, -46), 'pole');
  decor(game, new THREE.SphereGeometry(0.22, 12, 8), mat(0xffd84a), at(-32, 3.4, -46), 'pole-top');
  cornerSign(game, 'SANTA BUDDIES', at(-31, 0, -55), '#b02a2a');
}

/** Spooky Buddies: a little haunted house with pumpkins. The volleyball is inside. */
function spookyHouse(game: Game, at: At): THREE.Group {
  const wall = 0x4a3f55;
  const cx = 38;
  const cz = -51;
  // Floor, walls with a doorway facing the field (west), and a pointy roof.
  box(game, [8, 0.1, 8], at(cx, 0.05, cz), 0x3a3024, 'spooky-floor');
  box(game, [8, 4, 0.3], at(cx, 2, cz - 4), wall, 'spooky-wall');
  box(game, [8, 4, 0.3], at(cx, 2, cz + 4), wall, 'spooky-wall');
  box(game, [0.3, 4, 8], at(cx + 4, 2, cz), wall, 'spooky-wall');
  box(game, [0.3, 4, 2.6], at(cx - 4, 2, cz - 2.7), wall, 'spooky-wall');
  box(game, [0.3, 4, 2.6], at(cx - 4, 2, cz + 2.7), wall, 'spooky-wall');
  box(game, [0.3, 1.2, 2.8], at(cx - 4, 3.4, cz), wall, 'spooky-lintel');
  decor(game, new THREE.ConeGeometry(6.2, 3.6, 4).rotateY(Math.PI / 4), mat(0x2a2233), at(cx, 5.8, cz), 'spooky-roof');
  // Glowing windows and pumpkins.
  const glow = mat(0xffd06a, { emissive: 0xffa020, emissiveIntensity: 0.9 });
  for (const z of [-2.2, 2.2]) decor(game, new THREE.BoxGeometry(0.05, 0.9, 0.8), glow, at(cx - 4.17, 2.4, cz + z), 'spooky-window', false);
  for (const [x, z, r] of [[-5.5, -2.5, 0.45], [-5.2, 2.6, 0.35], [-6, 1.5, 0.3]]) {
    decor(game, new THREE.SphereGeometry(r, 14, 10), mat(0xf28c28, { roughness: 0.7 }), at(cx + x, r * 0.85, cz + z), 'pumpkin').object3d.scale.set(1, 0.85, 1);
    decor(game, new THREE.CylinderGeometry(0.04, 0.05, 0.15, 6), mat(0x4a7a2a), at(cx + x, r * 1.7 + 0.05, cz + z), 'stem');
  }
  // A friendly ghost in the corner (it moves: see SpookyGhost).
  const ghost = new THREE.Group();
  const sheet = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.8, 6, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, emissive: 0x8090b0, emissiveIntensity: 0.3 }));
  ghost.add(sheet);
  const black = mat(0x111111, { roughness: 0.3 });
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), black);
    eye.scale.set(1, 1.4, 0.5);
    eye.position.set(sx * 0.14, 0.38, 0.37);
    ghost.add(eye);
  }
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), black);
  mouth.scale.set(1, 1.3, 0.4);
  mouth.position.set(0, 0.12, 0.39);
  ghost.add(mouth);
  ghost.position.set(...at(cx + 2.8, 1.0, cz - 2.8));
  game.world.spawn(new Entity('ghost', ghost));
  cornerSign(game, 'SPOOKY BUDDIES', at(cx - 7, 0, cz + 5), '#5a3a7a');
  return ghost;
}

/** Treasure Buddies: a stepped pyramid on sand. The baseball is on the top. */
function pyramid(game: Game, at: At): void {
  decor(game, new THREE.CylinderGeometry(11, 11, 0.03, 40), mat(0xe6cf94, { roughness: 1 }), at(0, 0.015, -70), 'sand', false);
  const stone = 0xd9b870;
  [8, 6.4, 4.8, 3.2, 1.6].forEach((w, i) => box(game, [w, 0.64, w], at(0, 0.32 + i * 0.64, -70), stone, 'pyramid-tier'));
  // A couple of palms and a treasure chest.
  for (const [x, z] of [[-8, -64], [8.5, -75]]) {
    cylinder(game, 0.2, 4, at(x, 2, z), mat(0x8b6a48), 'palm-trunk', 8);
    for (let k = 0; k < 5; k++) {
      const leaf = decor(game, new THREE.BoxGeometry(2.2, 0.05, 0.5), mat(0x3a9a4a), at(x, 4.0, z), 'palm-leaf');
      leaf.object3d.rotation.set(0, (k / 5) * Math.PI * 2, -0.35);
      leaf.object3d.position.x += Math.cos((k / 5) * Math.PI * 2) * 0.9;
      leaf.object3d.position.z -= Math.sin((k / 5) * Math.PI * 2) * 0.9;
    }
  }
  box(game, [1.2, 0.7, 0.8], at(6, 0.35, -64), 0x7a4a22, 'chest');
  decor(game, new THREE.BoxGeometry(1.0, 0.1, 0.6), mat(0xffd84a, { metalness: 0.6, emissive: 0x6a5000, emissiveIntensity: 0.4 }), at(6, 0.75, -64), 'gold');
  cornerSign(game, 'TREASURE BUDDIES', at(-9, 0, -57), '#b8862f');
}

/** Super Buddies: a little stand of capes, one per pup. */
function capeStand(game: Game, at: At): void {
  box(game, [3.2, 0.3, 1.2], at(22, 0.15, -44), 0x7b5cff, 'cape-stand');
  const colors = [0xd03a3a, 0xf6a5c8, 0x3a6fd8, 0xf2c14e, 0x2a2a2a];
  colors.forEach((c, i) => {
    const x = 20.8 + i * 0.6;
    box(game, [0.05, 1.4, 0.05], at(x, 1.0, -44), 0xdddddd, 'cape-hook');
    decor(game, new THREE.BoxGeometry(0.45, 0.8, 0.02), mat(c), at(x, 1.2, -43.95), 'cape');
  });
  cornerSign(game, 'SUPER BUDDIES', at(22, 0, -42), '#7b5cff');
}

// --- Dogs ------------------------------------------------------------------------

/** A golden retriever from simple shapes, facing +Z. `s` = scale (1 ≈ grown-up, 0.55 ≈ pup). */
export function dogModel(o: { s: number; fur?: number; sitting?: boolean; accessory?: string }): { root: THREE.Group; head: THREE.Group; tail: THREE.Group } {
  const root = new THREE.Group();
  const s = o.s;
  const fur = mat(o.fur ?? GOLD, { roughness: 0.85 });
  const light = mat(GOLD_LIGHT, { roughness: 0.85 });
  const dark = mat(0x2a1c12, { roughness: 0.4 });
  const m = (geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root) => {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x * s, y * s, z * s);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  // The tail hangs off a pivot at its base, so it can wag (DogAnim swings the pivot).
  const wagger = (y: number, z: number, tilt: number) => {
    const half = 0.2;
    const pivot = new THREE.Group();
    pivot.position.set(0, (y - Math.cos(tilt) * half) * s, (z - Math.sin(tilt) * half) * s);
    root.add(pivot);
    const t = m(new THREE.CylinderGeometry(0.03 * s, 0.05 * s, 0.4 * s, 8), fur, 0, Math.cos(tilt) * half, Math.sin(tilt) * half, pivot);
    t.rotation.x = tilt;
    return pivot;
  };
  let neckY: number;
  let tail: THREE.Group;
  if (o.sitting) {
    const body = m(new THREE.SphereGeometry(0.28 * s, 16, 12), fur, 0, 0.32, -0.05);
    body.scale.set(0.9, 1.25, 1);
    m(new THREE.SphereGeometry(0.16 * s, 12, 10), light, 0, 0.36, 0.14).scale.set(1, 1.3, 0.7);
    for (const sx of [-1, 1]) {
      m(new THREE.CylinderGeometry(0.05 * s, 0.05 * s, 0.32 * s, 8), fur, sx * 0.1, 0.16, 0.16);
      m(new THREE.SphereGeometry(0.06 * s, 10, 8), fur, sx * 0.1, 0.03, 0.2);
      m(new THREE.SphereGeometry(0.11 * s, 10, 8), fur, sx * 0.16, 0.1, -0.12).scale.set(0.7, 1, 1.3);
    }
    tail = wagger(0.06, -0.38, -1.3);
    neckY = 0.62;
  } else {
    const body = m(new THREE.CapsuleGeometry(0.16 * s, 0.42 * s, 6, 12), fur, 0, 0.42, 0);
    body.rotation.x = Math.PI / 2;
    for (const [x, z] of [[-0.1, 0.22], [0.1, 0.22], [-0.1, -0.22], [0.1, -0.22]]) m(new THREE.CylinderGeometry(0.05 * s, 0.05 * s, 0.3 * s, 8), fur, x, 0.15, z);
    tail = wagger(0.55, -0.42, -0.9);
    neckY = 0.56;
  }
  const head = new THREE.Group();
  head.position.set(0, (o.sitting ? 0.78 : 0.66) * s, (o.sitting ? 0.1 : 0.36) * s);
  root.add(head);
  m(new THREE.SphereGeometry(0.17 * s, 16, 12), fur, 0, 0, 0, head);
  m(new THREE.BoxGeometry(0.16 * s, 0.12 * s, 0.18 * s), light, 0, -0.05, 0.15, head);
  m(new THREE.SphereGeometry(0.04 * s, 10, 8), dark, 0, -0.01, 0.25, head);
  for (const sx of [-1, 1]) {
    const ear = m(new THREE.SphereGeometry(0.09 * s, 10, 8), mat(0xc0882f, { roughness: 0.9 }), sx * 0.15, -0.04, -0.02, head);
    ear.scale.set(0.45, 1.3, 0.9);
    m(new THREE.SphereGeometry(0.028 * s, 8, 6), dark, sx * 0.07, 0.05, 0.14, head);
  }
  m(new THREE.BoxGeometry(0.06 * s, 0.02 * s, 0.06 * s), mat(0xe86a7a), 0, -0.12, 0.2, head);

  // What each pup wears.
  const neck = (material: THREE.Material, tube = 0.03) => {
    const ring = m(new THREE.TorusGeometry(0.15 * s, tube * s, 6, 20), material, 0, neckY, o.sitting ? 0.06 : 0.27);
    ring.rotation.x = Math.PI / 2 - (o.sitting ? 0.2 : 0.6);
    return ring;
  };
  switch (o.accessory) {
    case 'budderball': {
      // A red football shirt and eye black.
      const shirt = m(new THREE.CylinderGeometry(0.2 * s, 0.22 * s, 0.32 * s, 16, 1, true), mat(0xc8302c), 0, 0.42, 0);
      shirt.rotation.x = Math.PI / 2;
      (shirt.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      for (const sx of [-1, 1]) m(new THREE.BoxGeometry(0.05 * s, 0.015 * s, 0.01 * s), dark, sx * 0.07, 0.01, 0.165, head);
      break;
    }
    case 'rosebud': {
      const bow = mat(0xf26aa8);
      // A big pink bow on top of her head.
      for (const sx of [-1, 1]) m(new THREE.ConeGeometry(0.08 * s, 0.16 * s, 10), bow, sx * 0.08, 0.18, 0, head).rotation.z = (sx * Math.PI) / 2;
      m(new THREE.SphereGeometry(0.04 * s, 8, 6), bow, 0, 0.18, 0, head);
      break;
    }
    case 'mudbud': {
      neck(mat(0x2f6fd8), 0.045);
      // Muddy paws.
      for (const sx of [-1, 1]) m(new THREE.SphereGeometry(0.055 * s, 8, 6), mat(0x5a3c22), sx * 0.1, 0.03, 0.22);
      break;
    }
    case 'buddha': {
      const ring = neck(mat(0x6a3a1a), 0.012);
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        const bead = new THREE.Mesh(new THREE.SphereGeometry(0.028 * s, 8, 6), mat(k % 2 ? 0xc8902a : 0x8a3a2a));
        bead.position.set(Math.cos(a) * 0.15 * s, Math.sin(a) * 0.15 * s, 0);
        ring.add(bead);
      }
      break;
    }
    case 'b_dawg': {
      neck(mat(0xd8dde4, { metalness: 0.9, roughness: 0.2 }), 0.018);
      const tag = m(new THREE.BoxGeometry(0.09 * s, 0.1 * s, 0.015 * s), mat(0xffd84a, { metalness: 0.8, roughness: 0.2 }), 0, neckY - 0.12, o.sitting ? 0.2 : 0.38);
      tag.rotation.x = 0.3;
      break;
    }
  }
  return { root, head, tail };
}

function addDog(
  game: Game,
  o: { id: string; name: string; s: number; fur?: number; at: Vec3; facingDeg: number; sitting?: boolean; path?: [number, number][]; startAt?: number; groundY: number; accessory?: string },
): Entity {
  const { root, head, tail } = dogModel({ s: o.s, fur: o.fur, sitting: o.sitting, accessory: o.accessory });
  const holder = new THREE.Group();
  holder.position.set(...o.at);
  holder.add(root);
  const tag = makeLabel(o.name, { scale: 0.6, color: '#ffe7a8' });
  tag.position.y = (o.sitting ? 1.15 : 0.95) * o.s + 0.15;
  holder.add(tag);
  const e = new Entity(o.id, holder);
  e.tags.add('npc');
  e.tags.add('dog');
  const h = 0.8 * o.s;
  e.add(
    new RigidBodyComponent({
      type: o.path ? 'kinematicPosition' : 'fixed',
      colliders: [RAPIER.ColliderDesc.capsule(Math.max(0.05, h / 2 - 0.2 * o.s), 0.2 * o.s).setTranslation(0, h / 2, 0)],
    }),
  );
  const npc = e.add(new Npc(o.id, o.name, o.id, root, head, THREE.MathUtils.degToRad(o.facingDeg), (o.sitting ? 0.78 : 0.66) * o.s));
  if (o.path) {
    e.add(new Wander({ path: o.path, stops: [0, 3], groundAt: () => o.groundY, speed: 1.0, pause: [2, 5], startAt: o.startAt, seed: o.id.length * 13 }));
    e.add(new PupBrain(head, o.s, o.groundY));
  }
  e.add(new DogAnim(root, tail, o.s, !!o.sitting));
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
