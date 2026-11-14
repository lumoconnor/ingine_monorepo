import * as THREE from 'three';
import type { Game } from '@ingine/engine/core/Game';
import type { System } from '@ingine/engine/core/System';
import { Entity } from '@ingine/engine/entities/Entity';
import { RAPIER } from '@ingine/engine/physics/PhysicsWorld';
import { RigidBodyComponent } from '@ingine/engine/physics/RigidBodyComponent';
import { PlayerController } from '@ingine/engine/gameplay/player/PlayerController';
import { PlayerConfig } from '@ingine/engine/config/player';
import type { Teleports } from '../Teleports';
import { sceneById, type Vec3 } from '../scenes';
import { box, cylinder, decor, label, mat, seeded, sign, tree } from './kit';
import { buildReturnPad } from './hub';
import { addCat, catModel } from './murph';

/**
 * Hero city: an original superhero town. Four power stations on the plaza
 * each give you a power, and you keep every power you collect:
 *
 *  - Super jump: jump eight metres and run faster.
 *  - Flight: hold Space in the air to fly up, let go to glide, C to drop.
 *  - Dash: Q bursts you forward, on the ground or in the air.
 *  - Grapple: G fires a line at whatever you aim at and reels you in.
 *
 * Eight kittens are stuck on rooftops (one right on top of Hero HQ): reach
 * each one to rescue it and it's waiting in the basket on the plaza. Captain
 * Whiskers, the city's caped cat, keeps an eye on things.
 *
 * Powers only work in Hero city: they switch off when you leave and come back
 * when you return.
 */

type At = (x: number, y: number, z: number) => Vec3;

export type PowerId = 'jump' | 'fly' | 'dash' | 'grapple';

export const POWERS: { id: PowerId; name: string; hint: string; color: number; x: number }[] = [
  { id: 'jump', name: 'SUPER JUMP', hint: 'Jump sky high', color: 0x3fd17a, x: -9 },
  { id: 'fly', name: 'FLIGHT', hint: 'Hold Space in the air', color: 0x4fb3ff, x: -3 },
  { id: 'dash', name: 'DASH', hint: 'Press Q', color: 0xffc94a, x: 3 },
  { id: 'grapple', name: 'GRAPPLE', hint: 'Aim and press G', color: 0xff5c8a, x: 9 },
];

const HQ_HEIGHT = 80;

export function buildHeroes(game: Game, teleports: Teleports, index: number): HeroPowers {
  const s = sceneById('heroes')!;
  const [ox, oy, oz] = s.origin;
  const at: At = (x, y, z) => [ox + x, oy + y, oz + z];

  streets(game, at);
  const roofs = city(game, at);
  hq(game, at);
  const stations = powerStations(game, at);
  buildReturnPad(game, teleports, s, index);

  // Captain Whiskers, in a cape, by the kitten basket.
  const captain = addCat(game, { id: 'captain_whiskers', name: 'Captain Whiskers', fur: 0x3a3a44, belly: 0xffffff, s: 1.6, at: at(-15, 0, 3), facingDeg: 50, sitting: true, groundY: oy });
  // A red cape down his back (the model faces +Z) and a gold collar clasp.
  const cape = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.8, 0.03), mat(0xd7263d, { roughness: 0.6 }));
  cape.position.set(0, 0.4, -0.38);
  cape.rotation.x = 0.22;
  cape.castShadow = true;
  const clasp = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 8, 20).rotateX(Math.PI / 2), mat(0xffd84a, { metalness: 0.5, roughness: 0.3 }));
  clasp.position.set(0, 0.68, -0.03);
  captain.object3d.children[0]?.add(clasp);
  captain.object3d.children[0]?.add(cape);

  const powers = game.addSystem(new HeroPowers(stations));
  powers.init(game);
  powers.setBasket(at(-11, 0, 4.5));
  for (const p of kittenSpots(at, roofs)) powers.addKitten(game, p);
  return powers;
}

// --- Streets ------------------------------------------------------------------

function streets(game: Game, at: At): void {
  box(game, [210, 1, 190], at(0, -0.5, -55), 0x55585f, 'hero-asphalt');
  // The plaza: a pale tiled square with the power stations.
  decor(game, new THREE.BoxGeometry(40, 0.04, 30), mat(0xd9d4c7, { roughness: 0.9 }), at(0, 0.02, -2), 'plaza', false);
  decor(game, new THREE.CircleGeometry(4.5, 40).rotateX(-Math.PI / 2), mat(0x7b5cff, { roughness: 0.6 }), at(0, 0.05, -10), 'plaza-star-bg', false);
  decor(game, starShape(3.6), mat(0xffd84a, { roughness: 0.5, emissive: 0x3a2a00, emissiveIntensity: 0.5 }), at(0, 0.06, -10), 'plaza-star', false);
  // The avenue to HQ, with dashed centre lines.
  const dash = mat(0xf4f0e0, { roughness: 1 });
  for (let z = -22; z > -140; z -= 6) decor(game, new THREE.BoxGeometry(0.3, 0.02, 3), dash, at(0, 0.01, z), 'lane', false);
  sign(game, 'HERO CITY', at(0, 3.6, -16.5), { width: 6, height: 1.1, bg: '#7b5cff', fg: '#ffffff', letterSpacing: 6 });
  for (const x of [-3.2, 3.2]) box(game, [0.25, 4.2, 0.25], at(x, 2.1, -16.6), 0x3a2f7a, 'sign-post');
  // A few street trees and lamps around the plaza.
  for (const x of [-19, 19]) for (const z of [-14, -4, 6]) tree(game, at(x, 0, z)[0], at(0, 0, z)[2], 0.9);
  for (const [x, z] of [[-12, -15], [12, -15], [-12, 11], [12, 11]]) lamp(game, at(x, 0, z));
}

function lamp(game: Game, p: Vec3): void {
  cylinder(game, 0.09, 4.4, [p[0], p[1] + 2.2, p[2]], mat(0x2d2f36, { metalness: 0.5, roughness: 0.4 }), 'lamp-post', 10);
  decor(game, new THREE.SphereGeometry(0.32, 16, 12), mat(0xfff2c0, { emissive: 0xffe9a0, emissiveIntensity: 1.2 }), [p[0], p[1] + 4.6, p[2]], 'lamp', false);
}

function starShape(r: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const rr = i % 2 ? r * 0.45 : r;
    const x = Math.sin(a) * rr;
    const y = Math.cos(a) * rr;
    if (i) s.lineTo(x, y);
    else s.moveTo(x, y);
  }
  return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2);
}

// --- Buildings ----------------------------------------------------------------

let facade: HTMLCanvasElement | null = null;
/** One window cell: a pale wall with a dark glass pane (tinted by the material colour). */
function facadeCanvas(): HTMLCanvasElement {
  if (facade) return facade;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#2a3550';
  g.fillRect(10, 12, 44, 38);
  g.fillStyle = '#56709a';
  g.fillRect(10, 12, 44, 8);
  facade = c;
  return c;
}

/** A solid tower block with windows on its sides and a plain flat roof. Returns the roof centre. */
function building(game: Game, centre: Vec3, w: number, d: number, h: number, color: number, name = 'building'): Vec3 {
  const tex = (along: number) => {
    const t = new THREE.CanvasTexture(facadeCanvas());
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(Math.max(1, Math.round(along / 3.5)), Math.max(1, Math.round(h / 3.5)));
    return new THREE.MeshStandardMaterial({ map: t, color, roughness: 0.75 });
  };
  const sideX = tex(d);
  const sideZ = tex(w);
  const roof = mat(0x6d6f75, { roughness: 0.95 });
  // Box faces: +x, -x, +y, -y, +z, -z.
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [sideX, sideX, roof, roof, sideZ, sideZ]);
  mesh.position.set(centre[0], centre[1] + h / 2, centre[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const e = new Entity(name, mesh);
  e.tags.add('building');
  e.add(new RigidBodyComponent({ type: 'fixed', colliders: [RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setFriction(0.8)] }));
  game.world.spawn(e);
  return [centre[0], centre[1] + h, centre[2]];
}

export interface Roof {
  top: Vec3;
  w: number;
  d: number;
}

/**
 * A grid of blocks with an avenue down the middle to Hero HQ. The layout is
 * seeded, so every player sees the same skyline.
 */
function city(game: Game, at: At): Roof[] {
  const rand = seeded(4242);
  const palette = [0xb8c4d6, 0xd6c2a8, 0xa8c8c0, 0xc9b0c9, 0xd8d0b8, 0x9fb3cc, 0xe0b8a0];
  const roofs: Roof[] = [];
  const xs = [-72, -48, -24, 24, 48, 72];
  const zs = [12, -12, -36, -60, -84, -108, -132];
  for (const x of xs)
    for (const z of zs) {
      if (Math.abs(x) <= 24 && z > -24) continue; // the plaza
      const w = 13 + Math.floor(rand() * 5);
      const d = 13 + Math.floor(rand() * 5);
      // Lower near the plaza, taller further out.
      const far = Math.min(1, (Math.abs(x) / 72 + -z / 132) / 1.6);
      const h = Math.round(10 + rand() * 18 + far * 30);
      const top = building(game, at(x, 0, z), w, d, h, palette[Math.floor(rand() * palette.length)]);
      roofs.push({ top, w, d });
      roofProps(game, top, w, d, rand);
    }
  // A low diner by the plaza: a super jump gets you onto its roof.
  const diner = building(game, at(-31, 0, 4), 10, 9, 6, 0xe86a5a, 'hero-diner');
  sign(game, 'HERO DINER', [diner[0] + 5.06, 4.6, diner[2]], { width: 6, height: 1, yawDeg: 90, bg: '#fff3c4', fg: '#c8303a' });
  roofs.unshift({ top: diner, w: 10, d: 9 });
  return roofs;
}

function roofProps(game: Game, top: Vec3, w: number, d: number, rand: () => number): void {
  const [x, y, z] = top;
  const r = rand();
  if (r < 0.4) {
    // A water tower on four legs.
    const tx = x + (rand() - 0.5) * (w - 6);
    const tz = z - d / 2 + 3;
    for (const [lx, lz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) box(game, [0.18, 2.4, 0.18], [tx + lx, y + 1.2, tz + lz], 0x5a4632, 'tower-leg');
    cylinder(game, 1.5, 2.6, [tx, y + 2.4 + 1.3, tz], mat(0x8b6a48, { roughness: 0.9 }), 'water-tank', 20);
    decor(game, new THREE.ConeGeometry(1.65, 0.9, 20), mat(0x5a4632), [tx, y + 2.4 + 2.6 + 0.45, tz], 'tank-roof');
  } else if (r < 0.75) {
    // Air-con units.
    for (let i = 0; i < 2; i++) box(game, [2, 1.1, 1.4], [x - w / 2 + 2.5 + i * 3, y + 0.55, z + d / 2 - 2.2], 0xc9ccd2, 'aircon');
  } else {
    // A rooftop garden bed.
    box(game, [w * 0.5, 0.5, 2], [x, y + 0.25, z - d / 2 + 2], 0x7a5536, 'planter');
    decor(game, new THREE.BoxGeometry(w * 0.5 - 0.3, 0.3, 1.7), mat(0x5aa04a, { roughness: 1 }), [x, y + 0.6, z - d / 2 + 2], 'planter-grass', false);
  }
}

/** Hero HQ: a tall tower at the end of the avenue, with a star on its face. */
function hq(game: Game, at: At): void {
  const top = building(game, at(0, 0, -60), 18, 18, HQ_HEIGHT, 0x6b56d6, 'hero-hq');
  // A crown ring around the roof edge (decor, so it doesn't snag you landing).
  decor(game, new THREE.TorusGeometry(12.6, 0.35, 8, 4).rotateX(Math.PI / 2).rotateY(Math.PI / 4), mat(0xffd84a, { emissive: 0x6a5000, emissiveIntensity: 0.6 }), [top[0], top[1] + 0.2, top[2]], 'hq-crown', false);
  const face = (y: number) => [top[0], y, top[2] + 9.05] as Vec3;
  const star = new THREE.Mesh(starShape(5).rotateX(Math.PI / 2), mat(0xffd84a, { emissive: 0xffc400, emissiveIntensity: 0.7 }));
  star.position.set(...face(HQ_HEIGHT - 12));
  star.material.side = THREE.DoubleSide;
  game.world.spawn(new Entity('hq-star', star));
  sign(game, 'HERO HQ', face(HQ_HEIGHT - 22), { width: 12, height: 2.4, bg: '#3a2f7a', fg: '#ffd84a', letterSpacing: 10 });
  // A landing pad on top.
  decor(game, new THREE.CylinderGeometry(4, 4, 0.04, 40), mat(0x3a3f4a), [top[0], top[1] + 0.02, top[2]], 'helipad', false);
  label(game, 'H', [top[0], top[1] + 0.2, top[2] + 3.2], 1.6, '#ffd84a');
  // Doors at street level.
  box(game, [5, 4, 0.2], at(0, 2, -50.95), 0x2a2250, 'hq-doors');
}

// --- Power stations -------------------------------------------------------------

export interface Station {
  id: PowerId;
  /** Centre of the station, on the ground. */
  pos: THREE.Vector3;
  orb: THREE.Mesh;
}

function powerStations(game: Game, at: At): Station[] {
  return POWERS.map((p) => {
    const g = at(p.x, 0, -3);
    cylinder(game, 0.7, 1.0, [g[0], g[1] + 0.5, g[2]], mat(0x3a3f4a, { roughness: 0.4, metalness: 0.4 }), 'station-plinth', 24);
    decor(game, new THREE.CylinderGeometry(0.72, 0.72, 0.06, 24), mat(p.color, { emissive: p.color, emissiveIntensity: 0.8 }), [g[0], g[1] + 1.03, g[2]], 'station-rim', false);
    // The power sits in a shallow cup on top (resting, not floating).
    decor(game, new THREE.CylinderGeometry(0.34, 0.24, 0.14, 20), mat(0x22252c), [g[0], g[1] + 1.13, g[2]], 'station-cup');
    const orb = decor(game, new THREE.SphereGeometry(0.28, 24, 18), mat(p.color, { emissive: p.color, emissiveIntensity: 1.4, roughness: 0.2 }), [g[0], g[1] + 1.38, g[2]], `power-${p.id}`, false)
      .object3d as THREE.Mesh;
    label(game, p.name, [g[0], g[1] + 2.4, g[2]], 1.0);
    label(game, p.hint, [g[0], g[1] + 2.0, g[2]], 0.6, '#fff3c4');
    return { id: p.id, pos: new THREE.Vector3(...g), orb };
  });
}

// --- Kittens --------------------------------------------------------------------

function kittenSpots(at: At, roofs: Roof[]): Vec3[] {
  // A spread of heights: a couple you can super-jump to, the rest need flight or the grapple.
  const sorted = [...roofs].sort((a, b) => a.top[1] - b.top[1]);
  // sorted[0] is the diner (6 m).
  const picks = [0, 5, 12, 18, 24, 29, sorted.length - 1].map((i) => sorted[Math.min(i, sorted.length - 1)]);
  const spots = picks.map((r) => [r.top[0] + r.w * 0.25, r.top[1], r.top[2] + r.d * 0.25] as Vec3);
  spots.push(at(4, HQ_HEIGHT, -64)); // right on top of Hero HQ
  return spots;
}

interface Kitten {
  entity: Entity;
  pos: THREE.Vector3;
  saved: boolean;
}

const KITTEN_FUR = [0xf4f1ea, 0x9a9aa2, 0xd9b48a, 0x2b2b30, 0xe08a3c, 0xc9c3b8, 0x7a5536, 0xf0d9a8];

// --- Powers -----------------------------------------------------------------------

/**
 * The powers and the kitten rescue. Runs before the player controller each
 * fixed step, so it shapes the controller's velocity and tuning rather than
 * replacing its movement.
 */
export class HeroPowers implements System {
  readonly name = 'hero-powers';
  private game!: Game;
  private ready = false;
  readonly owned = new Set<PowerId>();
  readonly kittens: Kitten[] = [];
  saved = 0;
  private basket: Vec3 = [0, 0, 0];
  private panel!: HTMLDivElement;
  private unsub: (() => void) | null = null;
  private keys = { dash: false, grapple: false };
  private dashTime = 0;
  private dashCooldown = 0;
  private readonly dashDir = new THREE.Vector3();
  /** The grapple: where it's hooked, and for how long. */
  grapple: { point: THREE.Vector3; t: number } | null = null;
  private rope!: THREE.Line;
  private hook!: THREE.Mesh;
  /** Counters for the checks. */
  dashes = 0;
  grapples = 0;

  constructor(readonly stations: Station[]) {}

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
      background: 'rgba(30,20,70,0.75)',
      color: '#ffe98a',
      font: '600 16px system-ui, sans-serif',
      display: 'none',
      pointerEvents: 'none',
      zIndex: '4',
      whiteSpace: 'nowrap',
    });
    document.getElementById('app')?.appendChild(this.panel);
    // Raw keys, like H in Teleports (the engine's action table is closed). F is taken by fullscreen.
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.code === 'KeyQ') this.keys.dash = true;
      if (e.code === 'KeyG') this.keys.grapple = true;
    });
    this.unsub = game.events.on('teleport', () => {
      this.grapple = null;
      this.dashTime = 0;
      this.applyTuning();
      this.render();
    });

    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.rope = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xff5c8a }));
    this.rope.frustumCulled = false;
    this.rope.visible = false;
    this.hook = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), mat(0xff5c8a, { emissive: 0xff5c8a }));
    this.hook.visible = false;
    game.renderer.scene.add(this.rope, this.hook);
  }

  dispose(): void {
    this.unsub?.();
  }

  setBasket(p: Vec3): void {
    this.basket = p;
    // A big wicker basket for rescued kittens.
    const [x, y, z] = p;
    const wicker = mat(0xb5874e, { roughness: 1 });
    const ring = new THREE.CylinderGeometry(1.6, 1.3, 0.8, 24, 1, true);
    const shell = new THREE.Mesh(ring, wicker);
    shell.material.side = THREE.DoubleSide;
    shell.position.set(x, y + 0.4, z);
    shell.castShadow = true;
    this.game.world.spawn(new Entity('kitten-basket', shell));
    decor(this.game, new THREE.CylinderGeometry(1.3, 1.3, 0.1, 24), mat(0xe8c7d8, { roughness: 1 }), [x, y + 0.05, z], 'basket-cushion', false);
    label(this.game, 'Rescued kittens', [x, y + 2.1, z], 0.8);
  }

  addKitten(game: Game, roof: Vec3): void {
    const i = this.kittens.length;
    const { root } = catModel({ fur: KITTEN_FUR[i % KITTEN_FUR.length], s: 0.9, sitting: true });
    const g = new THREE.Group();
    g.position.set(...roof);
    g.rotation.y = i * 1.3;
    g.add(root);
    const help = label(game, 'Help!', [roof[0], roof[1] + 1.1, roof[2]], 0.7, '#ffd84a');
    const e = new Entity('kitten', g);
    e.tags.add('kitten');
    game.world.spawn(e);
    this.kittens.push({ entity: e, pos: new THREE.Vector3(...roof), saved: false });
    (e as Entity & { help?: Entity }).help = help;
  }

  get total(): number {
    return this.kittens.length;
  }

  private player(): PlayerController | undefined {
    return this.game.world.find('player')?.get(PlayerController);
  }

  private here(): boolean {
    return (this.game.getSystem('teleports') as { current?: string } | undefined)?.current === 'heroes';
  }

  /** Grant a power (also used by the checks). */
  grant(id: PowerId): void {
    if (this.owned.has(id)) return;
    this.owned.add(id);
    const st = this.stations.find((s) => s.id === id);
    if (st) (st.orb.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.25;
    const p = POWERS.find((q) => q.id === id)!;
    const all = this.owned.size === POWERS.length;
    this.game.events.emit('notify', { text: all ? 'Every power! The city is yours.' : `Power up: ${p.name.toLowerCase()}! ${p.hint}.` });
    this.game.events.emit('heroes:power', { power: id });
    this.applyTuning();
    this.render();
  }

  /** Tune the controller for the powers you have, but only in Hero city. */
  private applyTuning(): void {
    const ctrl = this.player();
    if (!ctrl) return;
    const c = ctrl.cfg;
    c.jumpHeight = PlayerConfig.jumpHeight;
    c.sprintSpeed = PlayerConfig.sprintSpeed;
    c.walkSpeed = PlayerConfig.walkSpeed;
    c.airAccel = PlayerConfig.airAccel;
    c.airMaxSpeedFactor = PlayerConfig.airMaxSpeedFactor;
    if (!this.here()) return;
    if (this.owned.has('jump')) {
      c.jumpHeight = 8;
      c.walkSpeed = 6;
      c.sprintSpeed = 11;
      c.airAccel = 16;
      c.airMaxSpeedFactor = 1.3;
    }
    if (this.owned.has('fly')) {
      c.airAccel = 30;
      c.airMaxSpeedFactor = 1.8;
    }
  }

  preFixedUpdate(dt: number): void {
    const keys = this.keys;
    this.keys = { dash: false, grapple: false };
    const ctrl = this.player();
    if (!ctrl || !this.here()) return;
    const feet = ctrl.entity.object3d.position;
    const v = ctrl.velocity;
    const input = this.game.input;

    // Stations: walk up to one to take its power.
    for (const st of this.stations) {
      if (!this.owned.has(st.id) && Math.hypot(feet.x - st.pos.x, feet.z - st.pos.z) < 1.35 && Math.abs(feet.y - st.pos.y) < 2) this.grant(st.id);
    }

    // Kittens: reach one to rescue it.
    for (const k of this.kittens) {
      if (!k.saved && Math.hypot(feet.x - k.pos.x, feet.z - k.pos.z) < 1.6 && Math.abs(feet.y - k.pos.y) < 2.2) this.rescue(k);
    }

    // Grapple: G fires along your aim; G again (or jump) lets go.
    if (keys.grapple && this.owned.has('grapple')) {
      if (this.grapple) this.grapple = null;
      else this.fireGrapple();
    }
    if (this.grapple) {
      const g = this.grapple;
      g.t += dt;
      const eye = _eye.copy(feet).setY(feet.y + 1.4);
      const to = _to.subVectors(g.point, eye);
      const dist = to.length();
      if (dist < 2.2 || g.t > 3 || (input.wasPressed('jump') && g.t > 0.2)) {
        // Let go with a hop, so you pop up over a ledge you were pulled to.
        v.y = Math.max(v.y, 7);
        this.grapple = null;
      } else {
        v.copy(to.multiplyScalar(Math.min(24, dist * 3) / dist));
      }
    }

    // Dash: a short burst along your view (level), on a cooldown.
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    if (keys.dash && this.owned.has('dash') && this.dashCooldown === 0) {
      this.dashDir.set(-Math.sin(ctrl.yaw), 0, -Math.cos(ctrl.yaw));
      this.dashTime = 0.3;
      this.dashCooldown = 0.75;
      this.dashes++;
      this.grapple = null;
    }
    if (this.dashTime > 0) {
      this.dashTime -= dt;
      v.x = this.dashDir.x * 24;
      v.z = this.dashDir.z * 24;
      if (!ctrl.grounded) v.y = Math.max(v.y, 0.4);
    }

    // Flight: hold jump in the air to climb, let go to glide, crouch to drop.
    if (this.owned.has('fly') && !ctrl.grounded && !this.grapple) {
      if (input.isDown('jump')) v.y = Math.min(v.y + 46 * dt, 9);
      else if (!input.isDown('crouch')) v.y = Math.max(v.y, -3);
    }
  }

  private fireGrapple(): void {
    const cam = this.game.renderer.camera;
    cam.updateMatrixWorld();
    cam.getWorldPosition(_eye);
    cam.getWorldDirection(_dir);
    const body = this.player()?.entity.get(RigidBodyComponent)?.body;
    const ray = new RAPIER.Ray({ x: _eye.x, y: _eye.y, z: _eye.z }, { x: _dir.x, y: _dir.y, z: _dir.z });
    const hit = this.game.physics.world.castRay(ray, 80, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, body);
    if (!hit || hit.timeOfImpact < 2.5) {
      this.game.events.emit('notify', { text: 'Nothing to grab there.' });
      return;
    }
    this.grappleAt(_eye.clone().addScaledVector(_dir, hit.timeOfImpact));
  }

  /** Hook a point and start reeling in. Public for the checks. */
  grappleAt(point: THREE.Vector3): void {
    this.grapple = { point: point.clone(), t: 0 };
    this.grapples++;
    this.dashTime = 0;
  }

  private rescue(k: Kitten): void {
    k.saved = true;
    this.saved++;
    const n = this.saved - 1;
    // Off the roof and into the basket.
    const a = n * 0.8;
    const r = n === 0 ? 0 : 0.85;
    k.entity.object3d.position.set(this.basket[0] + Math.cos(a) * r, this.basket[1] + 0.1, this.basket[2] + Math.sin(a) * r);
    k.entity.object3d.rotation.y = -a;
    const help = (k.entity as Entity & { help?: Entity }).help;
    if (help) this.game.world.destroy(help);
    const all = this.saved === this.total;
    this.game.events.emit('notify', { text: all ? 'Every kitten is safe. City saved!' : `Kitten rescued! ${this.saved} / ${this.total}` });
    this.game.events.emit('heroes:kitten', { saved: this.saved, total: this.total });
    if (all) this.game.state.setFlag('heroes.allKittens');
    this.render();
  }

  update(): void {
    const g = this.grapple;
    this.rope.visible = this.hook.visible = !!g;
    if (!g) return;
    const cam = this.game.renderer.camera;
    cam.getWorldPosition(_eye);
    cam.getWorldDirection(_dir);
    // From just below and right of the view, so the line reads as coming from your hand.
    const right = _to.set(-_dir.z, 0, _dir.x).normalize();
    const hand = _eye.addScaledVector(_dir, 0.5).addScaledVector(right, 0.25).setY(_eye.y - 0.25);
    const pos = this.rope.geometry.attributes.position as THREE.BufferAttribute;
    pos.setXYZ(0, hand.x, hand.y, hand.z);
    pos.setXYZ(1, g.point.x, g.point.y, g.point.z);
    pos.needsUpdate = true;
    this.hook.position.copy(g.point);
  }

  private render(): void {
    const here = this.here();
    this.panel.style.display = here ? 'block' : 'none';
    const powers = POWERS.filter((p) => this.owned.has(p.id)).map((p) => p.name.toLowerCase());
    this.panel.textContent = `Kittens rescued: ${this.saved} / ${this.total}   ·   Powers: ${powers.length ? powers.join(', ') : 'visit a station'}`;
  }
}

const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _to = new THREE.Vector3();

declare module '@ingine/engine/core/EventBus' {
  interface GameEvents {
    'heroes:power': { power: PowerId };
    'heroes:kitten': { saved: number; total: number };
  }
}
