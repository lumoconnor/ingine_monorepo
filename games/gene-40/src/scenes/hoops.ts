import * as THREE from 'three';
import type { Game } from '@ingine/engine/core/Game';
import type { System } from '@ingine/engine/core/System';
import type { Entity } from '@ingine/engine/entities/Entity';
import { Entity as E } from '@ingine/engine/entities/Entity';
import { RAPIER } from '@ingine/engine/physics/PhysicsWorld';
import { RigidBodyComponent } from '@ingine/engine/physics/RigidBodyComponent';
import { Npc } from '@ingine/engine/gameplay/components/Npc';
import { Wander } from '@ingine/engine/gameplay/components/Wander';
import { Interactable } from '@ingine/engine/gameplay/interaction/Interactable';
import { PlayerController } from '@ingine/engine/gameplay/player/PlayerController';
import { Combatant } from '@ingine/engine/combat/Combatant';
import type { DialogueSystem } from '@ingine/engine/dialogue/DialogueSystem';
import { makeLabel } from '@ingine/engine/render/labels';
import type { Teleports } from '../Teleports';
import { sceneById, type Vec3 } from '../scenes';
import { BALL_RADIUS, basketball } from '../content/ballModels';
import { box, decor, label, mat, sign } from './kit';
import { buildReturnPad } from './hub';

/**
 * The hoops court: an indoor arena in red, black and silver with a hanging
 * scoreboard, in the spirit of a certain northern basketball team (no team
 * marks; the mascot is an original red dinosaur called Rex). Grab a ball
 * from the rack and shoot: hold the button to build power, let go to shoot.
 * The ball arcs up from where you look, so look at the rim. Real scoring:
 * the ball has to drop through the rim, off the board and the rim it
 * bounces like a ball. Two points inside the arc, three beyond it. The rack
 * also starts a 60-second shootout, and your best is kept in this browser.
 */

type At = (x: number, y: number, z: number) => Vec3;

export const BASKETBALL = 'basketball';
/** Court: 28 x 15 m, centred at z = -18 (scene-relative), long side along Z. */
const CZ = -18;
const HALF_L = 14;
const HALF_W = 7.5;
const RIM_Y = 3.05;
const RIM_R = 0.2286;
const RIM_TUBE = 0.012;
/** Rim centre from the baseline, and the board's face from the baseline. */
const RIM_IN = 1.575;
const BOARD_IN = 1.2;
const BOARD_W = 1.83;
const BOARD_BOTTOM = 2.9;
const BOARD_TOP = 3.97;
const THREE_PT = 6.75;
const CORNER_X = 6.6;
const G = 9.8;
/** Throw speed (m/s) at no charge and at full charge; the arc lifts this far above where you look. */
const SPEED_MIN = 6.5;
const SPEED_MAX = 10.5;
const LIFT_DEG = 38;
/** Seconds of holding to full power (the item's charge max). */
const CHARGE_TIME = 1.6;
const ROUND_TIME = 60;
/** How hard the friendly rim nudges a close ball towards the middle (m/s²). */
const ASSIST = 3;
const BEST_KEY = 'gene40.hoops.best';

const RED = 0xce1141;
const BLACK = 0x1b1b1f;
const SILVER = 0xa1a1a4;
const PURPLE = 0x5a2d82;

export function buildHoops(game: Game, teleports: Teleports, index: number): Hoops {
  const s = sceneById('hoops')!;
  const [ox, oy, oz] = s.origin;
  const at: At = (x, y, z) => [ox + x, oy + y, oz + z];

  arena(game, at);
  court(game, at);
  const hoops = [hoop(game, at, -1), hoop(game, at, 1)];
  const sys = game.addSystem(new Hoops(hoops));
  sys.init(game);
  sys.setScoreboard(jumbotron(game, at));
  rack(game, at, sys);
  rex(game, at);
  buildReturnPad(game, teleports, s, index);
  return sys;
}

// --- The arena -----------------------------------------------------------------------

function arena(game: Game, at: At): void {
  // The floor all round the court, and the walls of the building.
  box(game, [62, 1, 64], at(0, -0.5, -16), 0x2c2c33, 'arena-floor');
  const wallH = 20;
  box(game, [1, wallH, 64], at(-30.5, wallH / 2, -16), 0x3d3d47, 'arena-wall');
  box(game, [1, wallH, 64], at(30.5, wallH / 2, -16), 0x3d3d47, 'arena-wall');
  box(game, [62, wallH, 1], at(0, wallH / 2, -48.5), 0x3d3d47, 'arena-wall');
  box(game, [62, wallH, 1], at(0, wallH / 2, 16.5), 0x3d3d47, 'arena-wall');
  // The roof: no shadow, so the court stays lit.
  decor(game, new THREE.BoxGeometry(62, 0.6, 66), mat(0x30303a), at(0, wallH + 0.3, -16), 'arena-roof', false);
  // Lighting rigs over the court.
  for (const z of [-8, -18, -28])
    for (const x of [-9, 9]) {
      decor(game, new THREE.BoxGeometry(5, 0.3, 0.6), mat(0x444449), at(x, 16, z), 'light-rig', false);
      decor(game, new THREE.BoxGeometry(4.6, 0.08, 0.4), mat(0xffffff, { emissive: 0xfff4d8, emissiveIntensity: 1.2 }), at(x, 15.82, z), 'light', false);
    }

  // Stands: tiers along both sidelines and behind the far baseline, in rows of red and black.
  const tiers = 9;
  const tier = (i: number) => (i % 3 === 2 ? BLACK : RED);
  for (const sx of [-1, 1]) {
    for (let i = 0; i < tiers; i++) {
      const h = 0.5 + i * 0.55;
      const x = sx * (HALF_W + 3.5 + i * 1.0 + 0.5);
      box(game, [1, h, 40], at(x, h / 2, CZ), tier(i), 'stand');
    }
    // A low rail between the court and the first row.
    box(game, [0.2, 1, 36], at(sx * (HALF_W + 2.6), 0.5, CZ), SILVER, 'rail');
  }
  for (let i = 0; i < tiers; i++) {
    const h = 0.5 + i * 0.55;
    box(game, [26, h, 1], at(0, h / 2, CZ - HALF_L - 4.2 - i * 1.0), tier(i), 'stand');
  }
  // Banners on the walls.
  sign(game, 'HAPPY 40TH, GENE!', at(0, 13, -47.95), { width: 16, height: 2.2, bg: '#ce1141', fg: '#ffffff' });
  sign(game, 'GENE 40', at(-29.95, 12, -18), { width: 10, height: 2, yawDeg: 90, bg: '#1b1b1f', fg: '#ce1141' });
  sign(game, 'NORTH SIDE HOOPS', at(29.95, 12, -18), { width: 12, height: 2, yawDeg: -90, bg: '#1b1b1f', fg: '#ffffff' });
  // Championship banners hanging from the roof (made up, of course).
  const banners = ['GENE 40', 'BIRTHDAY CHAMPS', '1985', 'MVP GENE'];
  banners.forEach((t, i) => {
    const e = sign(game, t, at(-12 + i * 8, 17, -46), { width: 3, height: 1.2, bg: i % 2 ? '#5a2d82' : '#ce1141', fg: '#ffffff' });
    e.object3d.position.z += 0.2;
  });
  // The tunnel you come in by.
  sign(game, 'COURTSIDE  ·  HOOPS', at(0, 4.6, 16.0), { width: 6, height: 0.8, yawDeg: 180, bg: '#ce1141', fg: '#ffffff' });
}

function court(game: Game, at: At): void {
  // Wood, with the edges of the boards drawn in.
  decor(game, new THREE.PlaneGeometry(HALF_W * 2 + 4, HALF_L * 2 + 4).rotateX(-Math.PI / 2), mat(0xc99a5f, { roughness: 0.45 }), at(0, 0.004, CZ), 'court-wood', false);
  const plank = mat(0xb5864d, { roughness: 0.5 });
  for (let x = -HALF_W - 1.5; x <= HALF_W + 1.5; x += 1.1)
    decor(game, new THREE.PlaneGeometry(0.03, HALF_L * 2 + 4).rotateX(-Math.PI / 2), plank, at(x, 0.006, CZ), 'plank', false);
  const white = mat(0xffffff, { roughness: 0.6 });
  const line = (w: number, d: number, x: number, z: number) => decor(game, new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), white, at(x, 0.01, z), 'court-line', false);
  const ring = (r: number, x: number, z: number, start = 0, len = Math.PI * 2) =>
    decor(game, new THREE.RingGeometry(r - 0.025, r + 0.025, 64, 1, start, len).rotateX(-Math.PI / 2), white, at(x, 0.01, z), 'court-line', false);
  // Boundary and half-court.
  line(HALF_W * 2, 0.05, 0, CZ - HALF_L);
  line(HALF_W * 2, 0.05, 0, CZ + HALF_L);
  line(0.05, HALF_L * 2, -HALF_W, CZ);
  line(0.05, HALF_L * 2, HALF_W, CZ);
  line(HALF_W * 2, 0.05, 0, CZ);
  ring(1.8, 0, CZ);
  decor(game, new THREE.CircleGeometry(1.75, 48).rotateX(-Math.PI / 2), mat(RED, { roughness: 0.6 }), at(0, 0.008, CZ), 'centre-circle', false);
  const forty = sign(game, '40', at(0, 0.012, CZ), { width: 2.2, height: 1.4, bg: '#ce1141', fg: '#ffffff' });
  forty.object3d.rotation.set(-Math.PI / 2, 0, 0);
  // Each end: the painted key, the free-throw circle and the three-point line.
  const a = Math.acos(CORNER_X / THREE_PT);
  for (const end of [-1, 1]) {
    // end -1 is the near end (z = CZ + HALF_L), +1 the far end; `into` points from that baseline into the court.
    const base = CZ - end * HALF_L;
    const into = end;
    const rimZ = base + into * RIM_IN;
    const keyLen = 5.8;
    decor(game, new THREE.PlaneGeometry(4.9, keyLen).rotateX(-Math.PI / 2), mat(PURPLE, { roughness: 0.6 }), at(0, 0.008, base + (into * keyLen) / 2), 'key', false);
    line(0.05, keyLen, -2.45, base + (into * keyLen) / 2);
    line(0.05, keyLen, 2.45, base + (into * keyLen) / 2);
    line(4.9, 0.05, 0, base + into * keyLen);
    ring(1.8, 0, base + into * keyLen);
    // Arc: RingGeometry's angle t puts a point at (cos t, 0, -sin t) once laid flat.
    if (into > 0) ring(THREE_PT, 0, rimZ, Math.PI + a, Math.PI - 2 * a);
    else ring(THREE_PT, 0, rimZ, a, Math.PI - 2 * a);
    const cornerLen = RIM_IN + THREE_PT * Math.sin(a);
    for (const sx of [-1, 1]) line(0.05, cornerLen, sx * CORNER_X, base + (into * cornerLen) / 2);
  }
}

export interface Hoop {
  /** World position of the rim's centre. */
  rim: THREE.Vector3;
  /** World z of the backboard's face, and +1/-1: the way from the board out over the court. */
  boardZ: number;
  out: number;
}

/** A hoop at one end: `end` -1 near (the board faces -Z... out over the court toward -Z), +1 far. */
function hoop(game: Game, at: At, end: number): Hoop {
  const base = CZ - end * HALF_L;
  const out = end; // from the board toward the court
  const rimZ = base + out * RIM_IN;
  const boardZ = base + out * BOARD_IN;
  // Stanchion behind the baseline, padded, with an arm out to the board.
  const standZ = base - out * 1.4;
  box(game, [1.3, 1.0, 1.7], at(0, 0.5, standZ), BLACK, 'stanchion-base');
  box(game, [0.3, 3.4, 0.3], at(0, 2.2, standZ + out * 0.4), SILVER, 'stanchion-pole');
  decor(game, new THREE.BoxGeometry(0.2, 0.2, Math.abs(boardZ - (standZ + out * 0.4))), mat(SILVER), at(0, 3.75, (boardZ + standZ + out * 0.4) / 2 - out * 0.05), 'stanchion-arm');
  decor(game, new THREE.BoxGeometry(1.4, 1.0, 0.25), mat(RED), at(0, 1.4, standZ + out * 0.6), 'pad');
  // Glass board with a red outline and the shooter's square.
  const glass = new THREE.MeshStandardMaterial({ color: 0xdfefff, transparent: true, opacity: 0.35, roughness: 0.1, depthWrite: false });
  const bh = BOARD_TOP - BOARD_BOTTOM;
  decor(game, new THREE.BoxGeometry(BOARD_W, bh, 0.04), glass, at(0, BOARD_BOTTOM + bh / 2, boardZ - out * 0.02), 'backboard', false);
  const edge = mat(RED);
  const z = boardZ + out * 0.005;
  decor(game, new THREE.BoxGeometry(BOARD_W, 0.05, 0.02), edge, at(0, BOARD_TOP - 0.025, z), 'board-edge', false);
  decor(game, new THREE.BoxGeometry(BOARD_W, 0.05, 0.02), edge, at(0, BOARD_BOTTOM + 0.025, z), 'board-edge', false);
  for (const sx of [-1, 1]) decor(game, new THREE.BoxGeometry(0.05, bh, 0.02), edge, at((sx * BOARD_W) / 2 - sx * 0.025, BOARD_BOTTOM + bh / 2, z), 'board-edge', false);
  const sq = mat(0xffffff);
  decor(game, new THREE.BoxGeometry(0.59, 0.04, 0.02), sq, at(0, RIM_Y + 0.15 + 0.43, z), 'square', false);
  decor(game, new THREE.BoxGeometry(0.59, 0.04, 0.02), sq, at(0, RIM_Y + 0.15, z), 'square', false);
  for (const sx of [-1, 1]) decor(game, new THREE.BoxGeometry(0.04, 0.45, 0.02), sq, at(sx * 0.275, RIM_Y + 0.15 + 0.215, z), 'square', false);
  // The rim, its bracket and a net.
  const orange = mat(0xf26b1d, { roughness: 0.4, metalness: 0.3 });
  decor(game, new THREE.TorusGeometry(RIM_R, RIM_TUBE, 8, 40).rotateX(Math.PI / 2), orange, at(0, RIM_Y, rimZ), 'rim');
  decor(game, new THREE.BoxGeometry(0.12, 0.03, RIM_IN - BOARD_IN - RIM_R + 0.02), orange, at(0, RIM_Y, (boardZ + rimZ - out * RIM_R) / 2), 'rim-bracket');
  const net = new THREE.Mesh(
    new THREE.CylinderGeometry(RIM_R, RIM_R * 0.6, 0.42, 12, 3, true),
    new THREE.MeshStandardMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.85 }),
  );
  net.position.set(...at(0, RIM_Y - 0.21, rimZ));
  game.world.spawn(new E('net', net));
  return { rim: new THREE.Vector3(...at(0, RIM_Y, rimZ)), boardZ: at(0, 0, boardZ)[2], out };
}

/** A four-sided scoreboard hanging over centre court; returns a function that redraws it. */
function jumbotron(game: Game, at: At): (lines: string[]) => void {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 576;
  const g = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.65 });
  const body = mat(BLACK);
  // Box faces: +x, -x, +y, -y, +z, -z.
  const cube = new THREE.Mesh(new THREE.BoxGeometry(6, 3.4, 6), [face, face, body, body, face, face]);
  cube.position.set(...at(0, 11, CZ));
  game.world.spawn(new E('jumbotron', cube));
  decor(game, new THREE.BoxGeometry(6.4, 0.5, 6.4), mat(RED), at(0, 12.95, CZ), 'jumbotron-top', false);
  decor(game, new THREE.BoxGeometry(6.4, 0.3, 6.4), mat(SILVER), at(0, 9.15, CZ), 'jumbotron-bottom', false);
  for (const [x, z] of [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]]) decor(game, new THREE.CylinderGeometry(0.03, 0.03, 7, 6), mat(0x777777), at(x, 16.5, CZ + z), 'cable', false);
  const draw = (lines: string[]) => {
    g.fillStyle = '#111114';
    g.fillRect(0, 0, 1024, 576);
    g.fillStyle = '#ce1141';
    g.fillRect(0, 0, 1024, 130);
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.font = '800 84px system-ui, sans-serif';
    g.fillText('HAPPY 40TH, GENE!', 512, 96);
    g.fillStyle = '#ffd84a';
    g.font = '700 72px system-ui, sans-serif';
    lines.forEach((l, i) => g.fillText(l, 512, 250 + i * 110));
    tex.needsUpdate = true;
  };
  draw(['SHOOTOUT', 'Grab a ball courtside']);
  return draw;
}

function rack(game: Game, at: At, sys: Hoops): void {
  // A ball cart by the near sideline, at half court.
  const [x, z] = [-HALF_W - 1.3, CZ + 1.5];
  const cart = box(game, [0.7, 0.9, 1.4], at(x, 0.45, z), SILVER, 'ball-rack');
  for (let k = 0; k < 5; k++) {
    const b = basketball();
    b.position.set(...at(x, 0.9 + BALL_RADIUS, z - 0.5 + k * 0.25));
    b.rotation.y = k;
    game.world.spawn(new E('rack-ball', b));
  }
  cart.add(new Interactable({ prompt: () => sys.rackPrompt(), range: 2.6, onInteract: (user) => sys.grabBall(user) }));
  label(game, 'Balls (E)', at(x, 1.8, z), 0.7);
}

/**
 * Rex: the arena's mascot, an original big red dinosaur in a purple jersey
 * with a 40 on it. He prowls the near sideline and has opinions.
 */
function rex(game: Game, at: At): void {
  const red = mat(0xc8203a, { roughness: 0.7 });
  const belly = mat(0xf0c9a0, { roughness: 0.8 });
  const jersey = mat(PURPLE, { roughness: 0.7 });
  const white = mat(0xffffff);
  const dark = mat(0x111111);
  const root = new THREE.Group();
  root.position.set(...at(HALF_W + 1.4, 0, CZ + 6));
  const body = new THREE.Group();
  root.add(body);
  const part = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = body) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  // Long legs with clawed feet.
  for (const sx of [-1, 1]) {
    part(new THREE.CylinderGeometry(0.13, 0.16, 0.8, 10), red, sx * 0.22, 0.45, 0);
    part(new THREE.BoxGeometry(0.22, 0.1, 0.4), red, sx * 0.22, 0.05, 0.1);
    for (const cx of [-0.06, 0, 0.06]) {
      const c = part(new THREE.ConeGeometry(0.025, 0.1, 5), white, sx * 0.22 + cx, 0.05, 0.33);
      c.rotation.x = Math.PI / 2;
    }
  }
  // A leaning body in a jersey, a long tail.
  const torso = part(new THREE.CapsuleGeometry(0.32, 0.55, 6, 14), jersey, 0, 1.15, 0);
  torso.rotation.x = 0.25;
  const tum = part(new THREE.CapsuleGeometry(0.22, 0.4, 6, 12), belly, 0, 1.12, 0.17);
  tum.rotation.x = 0.25;
  tum.scale.set(1, 1, 0.5);
  // The jersey number, on a little patch.
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = '#5a2d82';
  g.fillRect(0, 0, 128, 96);
  g.fillStyle = '#ffffff';
  g.font = '800 72px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('40', 64, 52);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const patch = part(new THREE.PlaneGeometry(0.3, 0.22), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }), 0, 1.24, 0.33);
  patch.rotation.x = 0.25;
  patch.castShadow = false;
  for (let k = 0; k < 5; k++) {
    const seg = part(new THREE.SphereGeometry(0.22 - k * 0.035, 10, 8), red, 0, 0.95 - k * 0.07, -0.4 - k * 0.3);
    seg.scale.set(1, 0.9, 1.5);
  }
  // Little arms with claws.
  for (const sx of [-1, 1]) {
    const arm = part(new THREE.CapsuleGeometry(0.06, 0.3, 4, 8), red, sx * 0.34, 1.3, 0.25);
    arm.rotation.x = -1.1;
    const claw = part(new THREE.ConeGeometry(0.03, 0.12, 5), white, sx * 0.34, 1.2, 0.45);
    claw.rotation.x = 1.9;
  }
  // A head with a long snout, a crest, teeth and big friendly eyes.
  const head = new THREE.Group();
  head.position.set(0, 1.85, 0.12);
  body.add(head);
  part(new THREE.SphereGeometry(0.24, 14, 10), red, 0, 0, 0, head);
  const snout = part(new THREE.BoxGeometry(0.26, 0.2, 0.42), red, 0, -0.05, 0.28, head);
  snout.rotation.x = 0.08;
  for (let k = 0; k < 4; k++) {
    const crest = part(new THREE.ConeGeometry(0.05, 0.18, 4), mat(PURPLE), 0, 0.22 - k * 0.03, -0.05 - k * 0.1, head);
    crest.rotation.x = -0.6;
  }
  for (const sx of [-1, 1]) {
    part(new THREE.SphereGeometry(0.07, 10, 8), white, sx * 0.13, 0.08, 0.15, head);
    part(new THREE.SphereGeometry(0.04, 8, 6), dark, sx * 0.14, 0.09, 0.21, head);
    for (let k = 0; k < 3; k++) {
      const t = part(new THREE.ConeGeometry(0.018, 0.05, 4), white, sx * 0.1, -0.16, 0.2 + k * 0.1, head);
      t.rotation.x = Math.PI;
    }
  }
  const tag = makeLabel('Rex', { scale: 0.8, color: '#ffe7a8' });
  tag.position.set(0, 2.45, 0);
  root.add(tag);

  const e = new E('rex', root);
  e.tags.add('npc');
  e.add(new RigidBodyComponent({ type: 'kinematicPosition', colliders: [RAPIER.ColliderDesc.capsule(0.6, 0.35).setTranslation(0, 1.0, 0)] }));
  const npc = e.add(new Npc('rex', 'Rex', 'rex', body, head, 0, 2.0));
  const oy = at(0, 0, 0)[1];
  const path: [number, number][] = [
    [HALF_W + 1.4, CZ + 9],
    [HALF_W + 1.4, CZ - 9],
  ].map(([x, z]) => {
    const p = at(x, 0, z);
    return [p[0], p[2]];
  });
  e.add(new Wander({ path, stops: [0, 1], groundAt: () => oy, speed: 1.1, pause: [2, 5], seed: 40 }));
  e.add(new Interactable({ prompt: 'Talk to Rex', range: 3, onInteract: () => game.getSystem<DialogueSystem>('dialogue')?.start('rex', e, npc) }));
  game.world.spawn(e);
}

// --- The game -------------------------------------------------------------------------

interface Ball {
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  /** Seconds in the air, seconds since it first hit the floor (or -1), seconds since it went in (or -1). */
  t: number;
  floorT: number;
  madeT: number;
  points: number;
  /** Thrown during a shootout, before the buzzer. */
  inRound: boolean;
}

export class Hoops implements System {
  readonly name = 'hoops';
  private game!: Game;
  private ready = false;
  private panel!: HTMLDivElement;
  private meter!: HTMLDivElement;
  private meterFill!: HTMLDivElement;
  private draw: (lines: string[]) => void = () => {};
  private unsubs: (() => void)[] = [];
  ball: Ball | null = null;
  roundOn = false;
  timeLeft = 0;
  points = 0;
  makes = 0;
  shots = 0;
  best = 0;
  /** The last shot, for the checks: points it was worth, whether it went in, and where it was thrown from. */
  lastShot: { points: number; made: boolean; speed: number; launch: number } | null = null;
  private lastSecond = -1;

  constructor(readonly hoops: Hoop[]) {}

  init(game: Game): void {
    if (this.ready) return;
    this.ready = true;
    this.game = game;
    try {
      this.best = Number(localStorage.getItem(BEST_KEY)) || 0;
    } catch {
      this.best = 0;
    }
    this.panel = document.createElement('div');
    this.panel.classList.add('gene-panel');
    Object.assign(this.panel.style, {
      position: 'absolute',
      top: '14px',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '8px 14px',
      borderRadius: '10px',
      background: 'rgba(27,27,31,0.85)',
      color: '#ffffff',
      font: '600 16px system-ui, sans-serif',
      display: 'none',
      pointerEvents: 'none',
      zIndex: '4',
      whiteSpace: 'nowrap',
      borderBottom: '3px solid #ce1141',
    });
    // A power meter by the crosshair while you hold the button.
    this.meter = document.createElement('div');
    Object.assign(this.meter.style, {
      position: 'absolute',
      left: 'calc(50% + 40px)',
      top: 'calc(50% - 50px)',
      width: '10px',
      height: '100px',
      borderRadius: '5px',
      background: 'rgba(0,0,0,0.45)',
      border: '1px solid rgba(255,255,255,0.6)',
      display: 'none',
      pointerEvents: 'none',
      zIndex: '4',
      overflow: 'hidden',
    });
    this.meterFill = document.createElement('div');
    Object.assign(this.meterFill.style, { position: 'absolute', left: '0', right: '0', bottom: '0', height: '0%', background: 'linear-gradient(#ce1141, #ffd84a)' });
    this.meter.appendChild(this.meterFill);
    const app = document.getElementById('app');
    app?.appendChild(this.panel);
    app?.appendChild(this.meter);
    this.unsubs.push(game.events.on('teleport', () => this.render()));
    this.unsubs.push(
      game.events.on('combat:swing', ({ attacker, item, charge }) => {
        if (item !== BASKETBALL || attacker !== this.player()) return;
        this.shoot(charge);
      }),
    );
    this.render();
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
  }

  setScoreboard(draw: (lines: string[]) => void): void {
    this.draw = draw;
  }

  private player(): Entity | undefined {
    return this.game.world.find('player') ?? undefined;
  }

  private here(): boolean {
    return (this.game.getSystem('teleports') as { current?: string } | undefined)?.current === 'hoops';
  }

  rackPrompt(): string {
    return this.roundOn ? 'Start the shootout over' : this.game.state.itemCount(BASKETBALL) ? '60-second shootout' : 'Grab a ball';
  }

  /** E at the rack: a ball in hand, and a 60-second shootout. */
  grabBall(user: Entity): void {
    const st = this.game.state;
    if (!st.itemCount(BASKETBALL)) st.addItem(BASKETBALL, 1);
    this.removeBall();
    user.get(Combatant)?.equip(BASKETBALL);
    this.roundOn = true;
    this.timeLeft = ROUND_TIME;
    this.points = this.makes = this.shots = 0;
    this.lastSecond = -1;
    this.game.events.emit('notify', { text: 'Shootout! 60 seconds. Hold to power up, let go to shoot. 3 points from beyond the arc.' });
    this.render();
  }

  /** Let go of the button: the ball leaves your hand. Public for the checks. */
  shoot(charge: number): void {
    const player = this.player();
    const ctrl = player?.get(PlayerController);
    if (!player || !ctrl || this.ball) return;
    const cam = this.game.renderer.camera;
    const eye = cam.getWorldPosition(new THREE.Vector3());
    const look = cam.getWorldDirection(new THREE.Vector3());
    const flat = new THREE.Vector3(look.x, 0, look.z);
    if (flat.lengthSq() < 1e-6) flat.set(-Math.sin(ctrl.yaw), 0, -Math.cos(ctrl.yaw));
    flat.normalize();
    const lookPitch = Math.asin(THREE.MathUtils.clamp(look.y, -1, 1));
    const launch = THREE.MathUtils.clamp(lookPitch + THREE.MathUtils.degToRad(LIFT_DEG), THREE.MathUtils.degToRad(5), THREE.MathUtils.degToRad(80));
    const speed = SPEED_MIN + (SPEED_MAX - SPEED_MIN) * THREE.MathUtils.clamp(charge, 0, 1);
    const pos = eye.clone().addScaledVector(flat, 0.45).add(new THREE.Vector3(0, -0.12, 0));
    const vel = flat.clone().multiplyScalar(Math.cos(launch) * speed);
    vel.y = Math.sin(launch) * speed;
    // Worth three from beyond the arc (or out in the corners), from the nearer hoop.
    const feet = ctrl.feetPosition;
    const h = this.nearest(feet);
    const dx = feet.x - h.rim.x;
    const dz = feet.z - h.rim.z;
    const points = Math.hypot(dx, dz) > THREE_PT || Math.abs(dx) > CORNER_X ? 3 : 2;
    const mesh = basketball();
    mesh.position.copy(pos);
    this.game.renderer.scene.add(mesh);
    this.ball = { mesh, pos, vel, t: 0, floorT: -1, madeT: -1, points, inRound: this.roundOn && this.timeLeft > 0 };
    if (this.ball.inRound) this.shots++;
    this.lastShot = { points, made: false, speed, launch: THREE.MathUtils.radToDeg(launch) };
    // The ball's in the air, not in your hand.
    player.get(Combatant)?.equip(null);
    this.game.events.emit('hoops:shot', { points });
    this.render();
  }

  private nearest(p: THREE.Vector3): Hoop {
    return this.hoops.reduce((a, b) => (Math.hypot(p.x - b.rim.x, p.z - b.rim.z) < Math.hypot(p.x - a.rim.x, p.z - a.rim.z) ? b : a));
  }

  private removeBall(): void {
    if (this.ball) this.ball.mesh.removeFromParent();
    this.ball = null;
  }

  /** The rebound comes back to you (a friendly passer, always). */
  private giveBack(): void {
    const ball = this.ball;
    this.removeBall();
    const player = this.player();
    if (player && this.here() && this.game.state.itemCount(BASKETBALL)) player.get(Combatant)?.equip(BASKETBALL);
    if (ball?.inRound && this.timeLeft <= 0) this.endRound();
    this.render();
  }

  preFixedUpdate(dt: number): void {
    if (this.roundOn && this.timeLeft > 0) {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      const sec = Math.ceil(this.timeLeft);
      if (sec !== this.lastSecond) {
        this.lastSecond = sec;
        this.render();
      }
      // The buzzer: a shot already in the air still counts.
      if (this.timeLeft <= 0 && !(this.ball && this.ball.inRound)) this.endRound();
    }
    this.updateMeter();
    const b = this.ball;
    if (!b) return;
    b.t += dt;
    if (b.floorT >= 0) b.floorT += dt;
    if (b.madeT >= 0) b.madeT += dt;
    const n = 6;
    const h = dt / n;
    for (let i = 0; i < n; i++) this.step(b, h);
    if (b.madeT > 0.9 || b.floorT > 1.3 || b.t > 6) this.giveBack();
  }

  private step(b: Ball, dt: number): void {
    const R = BALL_RADIUS;
    const prevY = b.pos.y;
    b.vel.y -= G * dt;
    b.pos.addScaledVector(b.vel, dt);
    const floorY = this.hoops[0].rim.y - RIM_Y;
    if (b.pos.y < floorY + R) {
      b.pos.y = floorY + R;
      if (b.vel.y < 0) b.vel.y = -b.vel.y * 0.72;
      b.vel.x *= 0.92;
      b.vel.z *= 0.92;
      if (b.floorT < 0) b.floorT = 0;
    }
    for (const hp of this.hoops) {
      const rim = hp.rim;
      // The backboard: a slab facing out over the court.
      const front = (b.pos.z - hp.boardZ) * hp.out;
      if (front < R && front > -0.1 && Math.abs(b.pos.x - rim.x) < BOARD_W / 2 && b.pos.y > rim.y - RIM_Y + BOARD_BOTTOM - R && b.pos.y < rim.y - RIM_Y + BOARD_TOP + R) {
        b.pos.z = hp.boardZ + hp.out * R;
        if (b.vel.z * hp.out < 0) b.vel.z = -b.vel.z * 0.6;
      }
      // A friendly rim: a ball dropping just over the hoop drifts a little towards the middle.
      const hx = rim.x - b.pos.x;
      const hz = rim.z - b.pos.z;
      const hd = Math.hypot(hx, hz);
      if (b.vel.y < 0 && b.pos.y > rim.y && b.pos.y < rim.y + 0.6 && hd < 0.36 && hd > 1e-3) {
        b.vel.x += (hx / hd) * ASSIST * dt;
        b.vel.z += (hz / hd) * ASSIST * dt;
      }
      // The rim: a ring; bounce off its nearest point.
      const qx = b.pos.x - rim.x;
      const qz = b.pos.z - rim.z;
      const ql = Math.hypot(qx, qz) || 1e-6;
      const cx = rim.x + (qx / ql) * RIM_R;
      const cz = rim.z + (qz / ql) * RIM_R;
      const d = new THREE.Vector3(b.pos.x - cx, b.pos.y - rim.y, b.pos.z - cz);
      const dl = d.length();
      if (dl < R + RIM_TUBE && dl > 1e-6) {
        d.divideScalar(dl);
        b.pos.addScaledVector(d, R + RIM_TUBE - dl);
        const into = b.vel.dot(d);
        if (into < 0) b.vel.addScaledVector(d, -1.5 * into);
        b.vel.multiplyScalar(0.92);
      }
      // Through the hoop: the centre drops through the rim's circle.
      if (b.madeT < 0 && prevY >= rim.y && b.pos.y < rim.y && b.vel.y < 0 && Math.hypot(b.pos.x - rim.x, b.pos.z - rim.z) < RIM_R - 0.02) {
        b.madeT = 0;
        // The net takes the pace off it.
        b.vel.x *= 0.25;
        b.vel.z *= 0.25;
        b.vel.y *= 0.6;
        this.made(b);
      }
    }
    // The arena walls and the stands' rails keep it in.
    const o = this.hoops[0].rim;
    const lx = b.pos.x - o.x;
    if (Math.abs(lx) > HALF_W + 2.4) {
      b.pos.x = o.x + Math.sign(lx) * (HALF_W + 2.4);
      b.vel.x *= -0.5;
    }
  }

  private made(b: Ball): void {
    if (this.lastShot) this.lastShot.made = true;
    if (b.inRound) {
      this.points += b.points;
      this.makes++;
    }
    const words = b.points === 3 ? 'THREE!' : 'Swish! Two points.';
    this.game.events.emit('hoops:score', { points: b.points });
    this.game.events.emit('notify', { text: this.roundOn ? `${words}  ${this.points} points` : words });
    this.render();
  }

  private endRound(): void {
    if (!this.roundOn) return;
    this.roundOn = false;
    this.timeLeft = 0;
    if (this.points >= 15) this.game.state.setFlag('hoops.fifteen');
    const record = this.points > this.best;
    if (record) {
      this.best = this.points;
      try {
        localStorage.setItem(BEST_KEY, String(this.points));
      } catch {
        /* private window: the best just isn't kept */
      }
    }
    this.game.events.emit('notify', { text: `${record ? 'New best! ' : ''}Buzzer! ${this.points} points, ${this.makes} of ${this.shots}. Press E at the rack to go again.` });
    this.game.events.emit('hoops:end', { points: this.points });
    this.render();
  }

  update(): void {
    if (this.ball) this.ball.mesh.position.copy(this.ball.pos);
  }

  private updateMeter(): void {
    const cb = this.player()?.get(Combatant);
    const charging = !!cb && cb.itemId === BASKETBALL && cb.heldTime > 0 && this.here();
    this.meter.style.display = charging ? 'block' : 'none';
    if (charging) this.meterFill.style.height = `${Math.round(Math.min(1, cb!.heldTime / CHARGE_TIME) * 100)}%`;
  }

  private render(): void {
    const here = this.here();
    this.panel.style.display = here ? 'block' : 'none';
    if (!here) this.meter.style.display = 'none';
    const clock = (t: number) => `0:${String(Math.ceil(t)).padStart(2, '0')}`.replace('0:60', '1:00');
    if (this.roundOn) {
      this.panel.textContent = `Shootout ${clock(this.timeLeft)}   ·   Points: ${this.points}   ·   Best: ${this.best}`;
      this.draw([`${clock(this.timeLeft)}   ${this.points} PTS`, `${this.makes} OF ${this.shots}   BEST ${this.best}`]);
    } else if (this.shots) {
      this.panel.textContent = `Final: ${this.points} points (${this.makes} of ${this.shots})   ·   Best: ${this.best}`;
      this.draw([`FINAL: ${this.points} PTS`, `${this.makes} OF ${this.shots}   BEST ${this.best}`]);
    } else {
      this.panel.textContent = `Grab a ball from the rack courtside   ·   Best: ${this.best}`;
    }
  }
}

declare module '@ingine/engine/core/EventBus' {
  interface GameEvents {
    'hoops:shot': { points: number };
    'hoops:score': { points: number };
    'hoops:end': { points: number };
  }
}
