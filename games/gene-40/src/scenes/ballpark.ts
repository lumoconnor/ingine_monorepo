import * as THREE from 'three';
import type { Game } from '@ingine/engine/core/Game';
import type { System } from '@ingine/engine/core/System';
import type { Entity } from '@ingine/engine/entities/Entity';
import { Entity as E } from '@ingine/engine/entities/Entity';
import { Interactable } from '@ingine/engine/gameplay/interaction/Interactable';
import { PlayerController } from '@ingine/engine/gameplay/player/PlayerController';
import { Combatant } from '@ingine/engine/combat/Combatant';
import type { Teleports } from '../Teleports';
import { sceneById, type Vec3 } from '../scenes';
import { box, cylinder, decor, label, mat, sign } from './kit';
import { buildReturnPad } from './hub';

/**
 * The ballpark: a big domed stadium with its roof rolled half open and a tall
 * tower peeking over the rim (the Toronto feel, no team marks). Grab a bat
 * from the rack, step into the batter's box, and the pitching machine throws
 * ten pitches. Click to swing: where you look aims it (left, right, how
 * high), and timing decides how hard you hit it and nudges it a little
 * (early pulls it towards left field, late pushes it right). Clear the outfield wall for a home run.
 * Bases are scored like a real hit: single 1, double 2, triple 3, homer 4.
 * Your best round is kept in this browser.
 */

type At = (x: number, y: number, z: number) => Vec3;

export const BAT = 'baseball_bat';
const PITCHES = 10;
/** Scene-relative: home plate, the mound, and the wall's distance from the plate. */
const PLATE: Vec3 = [0, 0, -4];
const MOUND_DIST = 18.4;
const WALL_R = 62;
const WALL_H = 3.6;
const BALL_R = 0.037;
const G = 9.8;
const PITCH_SPEED = 15;
/** Where a pitch crosses the plate (height). */
const ZONE_Y = 0.85;
/** Along the pitch line: the ball can be hit from this far in front of the plate to this far behind it. */
const HIT_EARLY = 1.1;
const HIT_LATE = 0.9;
/** How far (degrees) timing can pull or push a hit away from where you're looking. */
const SPRAY_TIMING = 14;
const BEST_KEY = 'gene40.ballpark.best';

const BLUE = 0x1d4fa3;
const NAVY = 0x13284f;

export function buildBallpark(game: Game, teleports: Teleports, index: number): Ballpark {
  const s = sceneById('ballpark')!;
  const [ox, oy, oz] = s.origin;
  const at: At = (x, y, z) => [ox + x, oy + y, oz + z];
  const plate = new THREE.Vector3(...at(...PLATE));

  field(game, at);
  stands(game, at);
  dome(game, at);
  const park = game.addSystem(new Ballpark(plate));
  park.init(game);
  park.setScoreboard(scoreboard(game, at));
  battingArea(game, at, park);
  buildReturnPad(game, teleports, s, index);
  return park;
}

// --- The field ----------------------------------------------------------------------

/** Direction from the plate for a spray angle (radians, 0 = straight to centre field = -Z, + = towards right field = +X). */
function sprayDir(angle: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(Math.sin(angle), 0, -Math.cos(angle));
}

function field(game: Game, at: At): void {
  const P = (dist: number, angle: number, y = 0): Vec3 => {
    const d = sprayDir(angle);
    return at(PLATE[0] + d.x * dist, y, PLATE[2] + d.z * dist);
  };
  // The ground everywhere (the warning track and stands sit on it).
  box(game, [220, 1, 220], at(0, -0.5, -40), 0x5a5f66, 'ballpark-ground');
  // Outfield grass: a quarter disc out to the wall, with mown stripes.
  const quarter = (r: number, color: number, y: number, name: string, order: number) => {
    const g = new THREE.CircleGeometry(r, 64, Math.PI / 4, Math.PI / 2).rotateX(-Math.PI / 2);
    // CircleGeometry's 0 angle is +X; after rotateX(-90) the quarter spans -Z ± 45°.
    decor(game, g, groundLayer(color, order), at(PLATE[0], y, PLATE[2]), name, false);
  };
  quarter(WALL_R + 4, 0xb48a5a, 0.01, 'warning-track', 1);
  quarter(WALL_R, 0x4f9a46, 0.015, 'outfield', 2);
  for (let k = 1; k < 8; k += 2) {
    const ring = new THREE.RingGeometry(k * 7.5, k * 7.5 + 3.75, 64, 1, Math.PI / 4, Math.PI / 2).rotateX(-Math.PI / 2);
    decor(game, ring, groundLayer(0x58a84e, 3), at(PLATE[0], 0.018, PLATE[2]), 'mow-stripe', false);
  }
  // Infield dirt and the infield grass diamond.
  quarter(29, 0xb07a4a, 0.02, 'infield-dirt', 4);
  const diamond = new THREE.PlaneGeometry(19.4, 19.4).rotateX(-Math.PI / 2).rotateY(Math.PI / 4);
  decor(game, diamond, groundLayer(0x4f9a46, 5), P(13.7, 0, 0.025), 'infield-grass', false);
  // The mound.
  cylinder(game, 2.7, 0.25, P(MOUND_DIST, 0, 0.125), mat(0xb07a4a, { roughness: 1 }), 'mound', 32);
  // Bases.
  const base = mat(0xffffff, { roughness: 0.7 });
  for (const [d, a] of [[27.4, Math.PI / 4], [27.4 * Math.SQRT2, 0], [27.4, -Math.PI / 4]] as const) {
    const p = P(d, a, 0.05);
    decor(game, new THREE.BoxGeometry(0.4, 0.08, 0.4), base, p, 'base').object3d.rotation.y = Math.PI / 4;
  }
  // Foul lines, from the plate to the wall.
  for (const a of [Math.PI / 4, -Math.PI / 4]) {
    const mid = P(WALL_R / 2, a, 0.03);
    const line = decor(game, new THREE.BoxGeometry(0.1, 0.01, WALL_R), mat(0xffffff, { roughness: 1 }), mid, 'foul-line', false);
    line.object3d.rotation.y = -a;
  }
  // The outfield wall: segments round the arc, padded blue, with distance marks.
  const n = 30;
  for (let k = 0; k < n; k++) {
    const a = -Math.PI / 4 + ((k + 0.5) / n) * (Math.PI / 2);
    const len = ((WALL_R + 0.4) * (Math.PI / 2)) / n + 0.05;
    const seg = box(game, [len, WALL_H, 0.6], P(WALL_R + 0.3, a, WALL_H / 2), BLUE, 'outfield-wall', [0, -THREE.MathUtils.radToDeg(a), 0]);
    seg.tags.add('outfield-wall');
  }
  for (const [a, txt] of [[-Math.PI / 4, '328'], [-Math.PI / 8, '375'], [0, '400'], [Math.PI / 8, '375'], [Math.PI / 4, '328']] as const) {
    const p = P(WALL_R - 0.05, a, 2.2);
    sign(game, txt, p, { width: 1.6, height: 0.8, yawDeg: -THREE.MathUtils.radToDeg(a), bg: '#1d4fa3', fg: '#ffffff' });
  }
  // Yellow foul poles.
  for (const a of [Math.PI / 4, -Math.PI / 4]) cylinder(game, 0.15, 14, P(WALL_R + 0.3, a, 7), mat(0xf2d13a), 'foul-pole', 10);
}

function stands(game: Game, at: At): void {
  // Tiered stands behind the outfield wall and round the infield, in blue seats.
  const seat = (c: number) => mat(c, { roughness: 0.8 });
  for (let tier = 0; tier < 6; tier++) {
    const r0 = WALL_R + 3 + tier * 3;
    const y = WALL_H + tier * 2.2;
    const ring = new THREE.RingGeometry(r0, r0 + 3, 64, 1, Math.PI / 4 - 0.15, Math.PI / 2 + 0.3).rotateX(-Math.PI / 2);
    decor(game, ring, seat(tier % 2 ? BLUE : 0x2a62c0), at(PLATE[0], y, PLATE[2]), 'stand', false);
    // Risers, so the tiers look solid.
    const riser = new THREE.CylinderGeometry(r0, r0, 2.2 + (tier ? 0 : WALL_H), 64, 1, true, Math.PI * 0.75 - 0.15, Math.PI / 2 + 0.3);
    decor(game, riser, mat(NAVY, { roughness: 0.9 }), at(PLATE[0], y - (2.2 + (tier ? 0 : WALL_H)) / 2, PLATE[2]), 'riser', false);
  }
  // Behind home plate and along the baselines: lower stands in a horseshoe.
  for (let tier = 0; tier < 6; tier++) {
    const r0 = 40 + tier * 3;
    const y = 1.2 + tier * 1.8;
    // Angles past the foul lines only (RingGeometry's angle 0 is +X; after the turn, angle θ points to (cos θ, -sin θ)).
    const ring = new THREE.RingGeometry(r0, r0 + 3, 64, 1, Math.PI - 0.25, Math.PI + 0.5).rotateX(-Math.PI / 2);
    // Centre this horseshoe on a point in front of the plate so it wraps behind it.
    decor(game, ring, seat(tier % 2 ? BLUE : 0x2a62c0), at(PLATE[0], y, PLATE[2] - 22), 'stand', false);
  }
  // A backstop net behind the plate, with a gap in the middle to walk through.
  const net = new THREE.MeshStandardMaterial({ color: 0x222222, transparent: true, opacity: 0.25, side: THREE.DoubleSide });
  for (const sx of [-1, 1]) {
    decor(game, new THREE.PlaneGeometry(5.5, 6), net, at(PLATE[0] + sx * 4.25, 3, PLATE[2] + 8), 'backstop-net', false);
    box(game, [5.5, 1.2, 0.4], at(PLATE[0] + sx * 4.25, 0.6, PLATE[2] + 8), NAVY, 'backstop-wall');
  }
  for (const sx of [-1, 1]) cylinder(game, 0.1, 6, at(PLATE[0] + sx * 1.5, 3, PLATE[2] + 8), mat(0x444444), 'backstop-post', 10);
}

/** The dome: ribs and panels over the stands, rolled half open, and a tall tower outside. */
function dome(game: Game, at: At): void {
  const centre = at(PLATE[0], 0, PLATE[2] - 30);
  const R = 105;
  const panel = new THREE.MeshStandardMaterial({ color: 0xd8dde4, roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide });
  // The closed half (behind home plate), as a quarter-sphere shell; the open half shows sky.
  const shell = new THREE.SphereGeometry(R, 48, 16, 0, Math.PI, 0, Math.PI / 2);
  const m = new THREE.Mesh(shell, panel);
  m.position.set(centre[0], centre[1] - 40, centre[2]);
  game.world.spawn(new E('dome-shell', m));
  // Ribs over the open half.
  const rib = mat(0xb8bec8, { metalness: 0.5, roughness: 0.4 });
  for (let k = 0; k <= 6; k++) {
    const a = (k / 6) * Math.PI;
    const t = new THREE.TorusGeometry(R, 0.8, 6, 48, Math.PI / 2).rotateY(a);
    const mesh = new THREE.Mesh(t, rib);
    mesh.position.set(centre[0], centre[1] - 40, centre[2]);
    game.world.spawn(new E('dome-rib', mesh));
  }
  // A tall tower outside, peeking over the rim.
  const tx = centre[0] + 90;
  const tz = centre[2] - 140;
  decor(game, new THREE.CylinderGeometry(3, 7, 180, 3), mat(0xc9ccd2), [tx, 90, tz], 'tower');
  decor(game, new THREE.CylinderGeometry(9, 9, 12, 24), mat(0xb8bec8), [tx, 120, tz], 'tower-pod');
  decor(game, new THREE.CylinderGeometry(0.8, 2, 70, 12), mat(0xd8dde4), [tx, 215, tz], 'tower-spire');
}

/** A big scoreboard over centre field; returns a function that redraws it. */
function scoreboard(game: Game, at: At): (lines: string[]) => void {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const g = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(20, 10), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.6 }));
  const p = at(PLATE[0], 24, PLATE[2] - WALL_R - 22);
  screen.position.set(...p);
  game.world.spawn(new E('scoreboard', screen));
  box(game, [21, 11, 0.6], [p[0], p[1], p[2] - 0.35], NAVY, 'scoreboard-frame');
  box(game, [1.2, p[1] - 5, 1.2], [p[0], (p[1] - 5) / 2, p[2] - 0.6], 0x444444, 'scoreboard-post');
  const draw = (lines: string[]) => {
    g.fillStyle = '#0b1a33';
    g.fillRect(0, 0, 1024, 512);
    g.fillStyle = '#1d4fa3';
    g.fillRect(0, 0, 1024, 110);
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.font = '700 72px system-ui, sans-serif';
    g.fillText("HAPPY 40TH, GENE!", 512, 80);
    g.fillStyle = '#ffd84a';
    g.font = '700 64px system-ui, sans-serif';
    lines.forEach((l, i) => g.fillText(l, 512, 200 + i * 100));
    tex.needsUpdate = true;
  };
  draw(['BATTER UP!', 'Grab a bat by home plate']);
  return draw;
}

/**
 * A flat ground layer (grass, dirt, stripes) lying a few mm over the one below.
 * Millimetres alone lose to depth precision at a distance and on phones, so the
 * layers flickered into each other (dirt and grass striping across the infield).
 * The polygon offset pulls each layer toward the camera by its order, so the
 * higher order always draws on top.
 */
function groundLayer(color: number, order: number, roughness = 1): THREE.MeshStandardMaterial {
  const m = mat(color, { roughness });
  m.polygonOffset = true;
  m.polygonOffsetFactor = -order;
  m.polygonOffsetUnits = -4 * order;
  return m;
}

function battingArea(game: Game, at: At, park: Ballpark): void {
  const [px, , pz] = PLATE;
  // Home plate, the batter's boxes and a bat rack by the backstop.
  const plate = new THREE.Shape([new THREE.Vector2(-0.22, 0), new THREE.Vector2(0.22, 0), new THREE.Vector2(0.22, -0.22), new THREE.Vector2(0, -0.43), new THREE.Vector2(-0.22, -0.22)]);
  const pg = new THREE.ShapeGeometry(plate).rotateX(-Math.PI / 2);
  decor(game, pg, groundLayer(0xffffff, 7, 0.7), at(px, 0.03, pz - 0.2), 'home-plate', false);
  decor(game, new THREE.CircleGeometry(4, 40).rotateX(-Math.PI / 2), groundLayer(0xb07a4a, 6), at(px, 0.028, pz), 'home-dirt', false);
  const chalk = mat(0xffffff, { roughness: 1 });
  for (const sx of [-1, 1]) {
    const cx = px + sx * 0.95;
    for (const [w, d, dx, dz] of [[1.2, 0.05, 0, -0.9], [1.2, 0.05, 0, 0.9], [0.05, 1.8, -0.6, 0], [0.05, 1.8, 0.6, 0]] as const)
      decor(game, new THREE.BoxGeometry(w, 0.01, d), chalk, at(cx + dx, 0.03, pz + dz), 'box-line', false);
  }
  label(game, "Batter's box", at(px - 0.95, 1.6, pz), 0.6, '#fff3c4');
  // The bat rack.
  const rack = box(game, [1.4, 1.0, 0.3], at(px - 4, 0.5, pz + 3), 0x3d2a1c, 'bat-rack');
  const wood = mat(0xc89a5e, { roughness: 0.55 });
  for (let k = 0; k < 4; k++) {
    const b = decor(game, new THREE.CylinderGeometry(0.03, 0.018, 0.86, 12), wood, at(px - 4.5 + k * 0.33, 1.28, pz + 3.05), 'rack-bat');
    b.object3d.rotation.z = 0.08;
  }
  rack.add(new Interactable({ prompt: () => park.rackPrompt(), range: 2.6, onInteract: (user) => park.grabBat(user) }));
  label(game, 'Bats (E)', at(px - 4, 2.1, pz + 3), 0.7);
  // The pitching machine on the mound, aimed at the plate.
  const m = at(px, 0.25, pz - MOUND_DIST);
  box(game, [0.9, 0.9, 0.9], [m[0], m[1] + 0.45, m[2]], 0x2a2f3a, 'pitch-machine');
  for (const sx of [-1, 1]) {
    const wheel = decor(game, new THREE.CylinderGeometry(0.28, 0.28, 0.12, 20).rotateZ(Math.PI / 2), mat(0x111111), [m[0] + sx * 0.3, m[1] + 1.1, m[2] + 0.1], 'machine-wheel');
    wheel.object3d.rotation.y = Math.PI / 2;
  }
  decor(game, new THREE.CylinderGeometry(0.08, 0.08, 0.6, 12).rotateX(Math.PI / 2), mat(0x666b75), [m[0], m[1] + 0.9, m[2] + 0.6], 'machine-chute');
  label(game, 'Pitching machine', [m[0], m[1] + 2.0, m[2]], 0.7);
  sign(game, 'BATTER UP', at(px, 5.6, pz + 8.05), { width: 3.2, height: 0.7, bg: '#1d4fa3', fg: '#ffffff' });
}

// --- The game -------------------------------------------------------------------------

type Result = 'strike' | 'foul' | 'out' | 'single' | 'double' | 'triple' | 'homer';
const BASES: Record<Result, number> = { strike: 0, foul: 0, out: 0, single: 1, double: 2, triple: 3, homer: 4 };
const WORDS: Record<Result, string> = { strike: 'Strike!', foul: 'Foul ball', out: 'Caught! Out.', single: 'Single!', double: 'Double!', triple: 'Triple!', homer: 'HOME RUN!' };

interface Ball {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  /** 'pitch' until hit, then 'hit'; done once it settles. */
  phase: 'pitch' | 'hit' | 'done';
  landed: boolean;
  /** Seconds it has been in play, for timeouts. */
  t: number;
}

export class Ballpark implements System {
  readonly name = 'ballpark';
  private game!: Game;
  private ready = false;
  private panel!: HTMLDivElement;
  private draw: (lines: string[]) => void = () => {};
  private unsubs: (() => void)[] = [];
  /** Pitches thrown this round, and their results. */
  readonly results: Result[] = [];
  /** Seconds until the next pitch (while a round is on). */
  private nextPitch = -1;
  roundOn = false;
  ball: Ball | null = null;
  /** Seconds left in the current swing's hitting window. */
  private swingT = 0;
  private swung = false;
  best = 0;
  /** For the checks: the last hit's exit speed, launch and spray angles (degrees) and how far it went. */
  lastHit: { speed: number; launch: number; spray: number; dist: number } | null = null;
  /** Fixed steps seen, for the checks. */
  ticks = 0;

  constructor(readonly plate: THREE.Vector3) {}

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
      background: 'rgba(19,40,79,0.8)',
      color: '#ffe98a',
      font: '600 16px system-ui, sans-serif',
      display: 'none',
      pointerEvents: 'none',
      zIndex: '4',
      whiteSpace: 'nowrap',
    });
    document.getElementById('app')?.appendChild(this.panel);
    this.unsubs.push(game.events.on('teleport', () => this.render()));
    this.unsubs.push(
      game.events.on('combat:swing', ({ attacker, item }) => {
        if (item !== BAT || attacker !== game.world.find('player')) return;
        this.swing();
      }),
    );
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
  }

  setScoreboard(draw: (lines: string[]) => void): void {
    this.draw = draw;
  }

  get score(): number {
    return this.results.reduce((a, r) => a + BASES[r], 0);
  }

  rackPrompt(): string {
    return this.roundOn ? 'Start over' : this.game.state.itemCount(BAT) ? 'Play ball! (10 pitches)' : 'Grab a bat';
  }

  /** E at the rack: a bat in hand and a fresh round of ten pitches. */
  grabBat(user: Entity): void {
    const st = this.game.state;
    if (!st.itemCount(BAT)) st.addItem(BAT, 1);
    user.get(Combatant)?.equip(BAT);
    this.results.length = 0;
    this.removeBall();
    this.roundOn = true;
    this.nextPitch = 2.5;
    this.game.events.emit('notify', { text: "Step into the batter's box. Here come ten pitches!" });
    this.render();
  }

  /** Where the batter stands: the box on the third-base side of the plate (scene x - 0.95). */
  get boxCentre(): THREE.Vector3 {
    return new THREE.Vector3(this.plate.x - 0.95, this.plate.y, this.plate.z);
  }

  private inBox(): boolean {
    const p = this.game.world.find('player')?.get(PlayerController)?.feetPosition;
    if (!p) return false;
    const b = this.boxCentre;
    return Math.abs(p.x - b.x) < 1.4 && Math.abs(p.z - b.z) < 1.6 && Math.abs(p.y - b.y) < 1;
  }

  private swing(): void {
    const b = this.ball;
    if (!b || b.phase !== 'pitch' || this.swung) return;
    this.swung = true;
    // The bat meets the ball the moment it comes round: judge contact right now,
    // and if the ball is still coming, it can run into the bat while it's out.
    const along = this.plate.z - b.pos.z;
    if (along < HIT_EARLY && along > -HIT_LATE) this.hit(b, along);
    else if (along >= HIT_EARLY) this.swingT = 0.2;
  }

  /** Start a pitch now. Public for the checks. */
  pitch(): void {
    this.removeBall();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * 2.2, 14, 10), mat(0xfaf6ec, { roughness: 0.5, emissive: 0x222222 }));
    mesh.castShadow = true;
    // Slightly oversized so it reads at speed.
    const start = new THREE.Vector3(this.plate.x, this.plate.y + 1.6, this.plate.z - MOUND_DIST + 1.0);
    const target = new THREE.Vector3(this.plate.x, this.plate.y + ZONE_Y, this.plate.z);
    const d = start.distanceTo(target);
    const t = d / PITCH_SPEED;
    // Aim so gravity brings it down into the zone.
    const vel = new THREE.Vector3().subVectors(target, start).divideScalar(t);
    vel.y += 0.5 * G * t;
    mesh.position.copy(start);
    this.game.renderer.scene.add(mesh);
    this.ball = { mesh, pos: start.clone(), vel, phase: 'pitch', landed: false, t: 0 };
    this.swung = false;
    this.swingT = 0;
    this.nextPitch = -1; // the next one is timed from this pitch's call
  }

  private removeBall(): void {
    if (this.ball) this.ball.mesh.removeFromParent();
    this.ball = null;
  }

  preFixedUpdate(dt: number): void {
    this.ticks++;
    // The last hit may still be rolling about the outfield: the next pitch doesn't wait for it.
    if (this.roundOn && (!this.ball || this.ball.phase !== 'pitch') && this.nextPitch >= 0) {
      this.nextPitch -= dt;
      if (this.nextPitch <= 0 && this.inBox()) this.pitch();
      else if (this.nextPitch <= 0) this.nextPitch = 0.5; // wait for the batter
    }
    const b = this.ball;
    if (!b) return;
    b.t += dt;
    // A simple flight: gravity, a bounce off the ground, and the outfield wall.
    b.vel.y -= G * dt;
    b.pos.addScaledVector(b.vel, dt);
    if (b.phase === 'pitch') {
      // Along the pitch line: > 0 means the ball is still in front of the plate.
      const along = this.plate.z - b.pos.z;
      if (this.swingT > 0) {
        this.swingT -= dt;
        if (along < HIT_EARLY && along > -HIT_LATE) this.hit(b, along);
      }
      if (b.phase === 'pitch' && along < -3) this.call('strike');
    } else if (b.phase === 'hit') {
      const fromPlate = Math.hypot(b.pos.x - this.plate.x, b.pos.z - this.plate.z);
      if (!b.landed && fromPlate > WALL_R && fromPlate < WALL_R + 1.2) {
        if (b.pos.y > WALL_H) {
          // Over the wall: call it by roughly where it would have come down.
          if (this.lastHit) this.lastHit.dist = fromPlate + Math.max(0, (b.vel.y + Math.sqrt(b.vel.y * b.vel.y + 2 * G * b.pos.y)) / G) * Math.hypot(b.vel.x, b.vel.z);
          const spray = Math.atan2(b.pos.x - this.plate.x, -(b.pos.z - this.plate.z));
          this.call(Math.abs(spray) <= Math.PI / 4 ? 'homer' : 'foul');
          return;
        }
        // Off the wall: back it comes.
        const n = new THREE.Vector3(b.pos.x - this.plate.x, 0, b.pos.z - this.plate.z).normalize();
        const into = b.vel.dot(n);
        if (into > 0) b.vel.addScaledVector(n, -1.6 * into);
        b.landed = true;
        this.lastHit && (this.lastHit.dist = fromPlate);
        this.call(this.judge(fromPlate, true));
        return;
      }
      if (b.pos.y <= this.plate.y + BALL_R && !b.landed) {
        b.landed = true;
        this.lastHit && (this.lastHit.dist = fromPlate);
        this.call(this.judge(fromPlate, false));
      }
    }
    // Once hit, it bounces and rolls to a stop on the grass.
    if (this.ball && this.ball.phase !== 'pitch' && b.pos.y <= this.plate.y + BALL_R) {
      b.pos.y = this.plate.y + BALL_R;
      b.vel.y = Math.abs(b.vel.y) * 0.35;
      b.vel.x *= 0.7;
      b.vel.z *= 0.7;
    }
    if (b.t > 8) this.removeBall();
  }

  update(): void {
    if (this.ball) this.ball.mesh.position.copy(this.ball.pos);
  }

  /** Contact! `along` is how far in front of the plate the ball was (early = positive). */
  private hit(b: Ball, along: number): void {
    // 0 = perfect timing, 1 = the edge of the window.
    const off = along >= 0 ? along / HIT_EARLY : along / HIT_LATE;
    const q = 1 - Math.min(1, Math.abs(off));
    const ctrl = this.game.world.find('player')?.get(PlayerController);
    const lookPitch = ctrl ? THREE.MathUtils.radToDeg(ctrl.pitch) : 0;
    const speed = 13 + 18 * q;
    const launch = THREE.MathUtils.clamp(14 + 18 * q + lookPitch * 0.6, -4, 50);
    // Where you're looking aims it; timing adds a little pull (early, to left field, -)
    // or push (late, to right field, +). Yaw 0 faces centre field and turning right
    // (towards +X) is negative yaw. Yaw piles up as you spin, so wrap it first.
    const lookYaw = ctrl ? -THREE.MathUtils.radToDeg(Math.atan2(Math.sin(ctrl.yaw), Math.cos(ctrl.yaw))) : 0;
    const spray = THREE.MathUtils.clamp(lookYaw - off * SPRAY_TIMING, -70, 70);
    const dir = sprayDir(THREE.MathUtils.degToRad(spray));
    const l = THREE.MathUtils.degToRad(launch);
    b.vel.set(dir.x * Math.cos(l) * speed, Math.sin(l) * speed, dir.z * Math.cos(l) * speed);
    b.phase = 'hit';
    this.swingT = 0;
    this.lastHit = { speed, launch, spray, dist: 0 };
    this.game.events.emit('ballpark:contact', { quality: q });
  }

  /** What a ball that first came down `dist` metres from the plate counts as. */
  private judge(dist: number, offWall: boolean): Result {
    const b = this.ball!;
    const spray = Math.atan2(b.pos.x - this.plate.x, -(b.pos.z - this.plate.z));
    if (Math.abs(spray) > Math.PI / 4) return 'foul';
    if (offWall) return 'double';
    if (dist < 12) return 'out';
    if (dist < 32) return 'single';
    if (dist < 48) return 'double';
    return 'triple';
  }

  private call(r: Result): void {
    const b = this.ball;
    if (b) b.phase = 'done';
    // A missed pitch has gone past the batter: take it away.
    if (r === 'strike') this.removeBall();
    this.results.push(r);
    this.game.events.emit('ballpark:result', { result: r, bases: BASES[r] });
    const n = this.results.length;
    const dist = this.lastHit && r !== 'strike' ? ` (${Math.round(this.lastHit.dist)} m)` : '';
    this.game.events.emit('notify', { text: `${WORDS[r]}${dist}  ${n} / ${PITCHES}` });
    this.draw([WORDS[r].toUpperCase(), `PITCH ${n}/${PITCHES}   BASES ${this.score}`]);
    if (n >= PITCHES) this.endRound();
    else this.nextPitch = 2.4;
    this.render();
  }

  private endRound(): void {
    this.roundOn = false;
    this.nextPitch = -1;
    const score = this.score;
    const record = score > this.best;
    if (record) {
      this.best = score;
      try {
        localStorage.setItem(BEST_KEY, String(score));
      } catch {
        /* private window: the best just isn't kept */
      }
    }
    const homers = this.results.filter((r) => r === 'homer').length;
    this.game.events.emit('notify', { text: `${record ? 'New best! ' : ''}${score} bases, ${homers} home run${homers === 1 ? '' : 's'}. Grab a bat to go again.` });
    this.draw([`FINAL: ${score} BASES`, `${homers} HOME RUN${homers === 1 ? '' : 'S'}   BEST ${this.best}`]);
  }

  private render(): void {
    const here = (this.game.getSystem('teleports') as { current?: string } | undefined)?.current === 'ballpark';
    this.panel.style.display = here ? 'block' : 'none';
    const n = this.results.length;
    this.panel.textContent = this.roundOn || n
      ? `Pitch ${Math.min(n + (this.roundOn ? 1 : 0), PITCHES)} / ${PITCHES}   ·   Bases: ${this.score}   ·   Best: ${this.best}`
      : `Grab a bat by home plate   ·   Best: ${this.best}`;
  }
}

declare module '@ingine/engine/core/EventBus' {
  interface GameEvents {
    'ballpark:contact': { quality: number };
    'ballpark:result': { result: string; bases: number };
  }
}
