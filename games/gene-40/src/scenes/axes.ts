import * as THREE from 'three';
import type { Game } from '@ingine/engine/core/Game';
import type { System } from '@ingine/engine/core/System';
import { Entity } from '@ingine/engine/entities/Entity';
import { Combatant } from '@ingine/engine/combat/Combatant';
import { Interactable } from '@ingine/engine/gameplay/interaction/Interactable';
import type { Teleports } from '../Teleports';
import { sceneById, type Vec3 } from '../scenes';
import { box, decor, label, mat } from './kit';
import { buildReturnPad } from './hub';

/**
 * Axe throwing: a timber hall with three lanes. Grab five axes at a lane's
 * rack (E), stand behind the red line and throw (hold the attack button to
 * wind up, let go to throw). Axes stick where they land and score by the ring
 * the blade lands in, the way league boards do: a blade on a line takes the
 * higher ring. The blue dots in the top corners are killshots.
 */

const AXE = 'throwing_axe';
export const AXES_PER_ROUND = 5;

/** Ring outer radii (m) and points, inside out. */
export const RINGS: [number, number][] = [
  [0.08, 6],
  [0.2, 4],
  [0.32, 3],
  [0.44, 2],
  [0.56, 1],
];
export const KILLSHOT = { points: 8, radius: 0.055, dx: 0.47, dy: 0.5 };

/** Lane layout relative to the scene origin. You arrive at z = +6 looking toward -Z. */
const LANE_X = [-4.2, 0, 4.2];
const LINE_Z = 0;
const BOARD_Z = -4.3; // front face
const BOARD_Y = 1.55; // bullseye height
const BOARD_W = 1.5;
const BOARD_H = 1.6;

export interface Board {
  center: THREE.Vector3;
}

/** Points for a blade landing at `p` on a board (0 if it missed the target). */
export function scoreAt(board: Board, p: { x: number; y: number; z: number }): number {
  const dx = p.x - board.center.x;
  const dy = p.y - board.center.y;
  if (Math.abs(p.z - board.center.z) > 0.2) return 0;
  // A blade is a few centimetres long: touching a line counts as the ring inside it.
  const touch = 0.012;
  for (const s of [-1, 1]) if (Math.hypot(dx - s * KILLSHOT.dx, dy - KILLSHOT.dy) <= KILLSHOT.radius + touch) return KILLSHOT.points;
  const r = Math.hypot(dx, dy);
  for (const [radius, pts] of RINGS) if (r <= radius + touch) return pts;
  return 0;
}

export function buildAxes(game: Game, teleports: Teleports, index: number): AxeRange {
  const s = sceneById('axes')!;
  const [ox, oy, oz] = s.origin;
  const at = (x: number, y: number, z: number): Vec3 => [ox + x, oy + y, oz + z];

  hall(game, at);
  const boards: Board[] = [];
  LANE_X.forEach((x, i) => boards.push(lane(game, at, x, i)));
  buildReturnPad(game, teleports, s, index);

  const range = game.addSystem(new AxeRange(boards, at(0, 0, 0)));
  range.init(game);
  // Racks need the range to start rounds.
  LANE_X.forEach((x) => rack(game, at, x + 1.15, range));
  return range;
}

function hall(game: Game, at: (x: number, y: number, z: number) => Vec3): void {
  const floor = 0x8a6a4a;
  const wall = 0x6e4f35;
  const W = 15;
  box(game, [W, 0.3, 30], at(0, -0.15, -2), floor, 'axe-floor');
  // Lounge floor behind the line, a little lighter, and a rug.
  decor(game, new THREE.BoxGeometry(W - 0.4, 0.01, 11), mat(0x9c7b56, { roughness: 0.9 }), at(0, 0.005, 6.5), 'lounge-floor', false);
  // Walls: back (behind the boards), sides, and the far end behind the lounge with a wide door.
  box(game, [W, 4, 0.3], at(0, 2, -6.2), wall, 'axe-back-wall');
  for (const sx of [-1, 1]) box(game, [0.3, 4, 30], at((sx * W) / 2, 2, -2), wall, 'axe-side-wall');
  box(game, [5, 4, 0.3], at(-5, 2, 12.9), wall, 'axe-end-wall');
  box(game, [5, 4, 0.3], at(5, 2, 12.9), wall, 'axe-end-wall');
  // Roof: beams and a ceiling that lets the light in through a skylight strip.
  for (let z = -5; z <= 12; z += 3) box(game, [W, 0.25, 0.25], at(0, 3.9, z), 0x4f3826, 'beam');
  const roof = box(game, [W, 0.2, 30], at(0, 4.15, -2), 0x5a4030, 'axe-roof');
  (roof.object3d as THREE.Mesh).castShadow = false;
  // Warm lights over the lanes and the lounge.
  const e = new Entity('axe-lights');
  for (const x of LANE_X) {
    const l = new THREE.PointLight(0xffd9a0, 16, 9, 1.6);
    l.position.set(...at(x, 3.4, -3.2));
    e.object3d.add(l);
  }
  const lounge = new THREE.PointLight(0xffd9a0, 22, 14, 1.6);
  lounge.position.set(...at(0, 3.4, 5));
  e.object3d.add(lounge);
  game.world.spawn(e);
  for (const x of LANE_X) decor(game, new THREE.BoxGeometry(0.5, 0.06, 0.5), mat(0xffffff, { emissive: 0xffe2b0, emissiveIntensity: 1.2 }), at(x, 3.75, -3.2), 'lamp', false);

  label(game, 'Axe throwing', at(0, 3.3, 1.0), 1.4, '#ffe066');
  label(game, 'Grab axes at the rack (E). Stand behind the red line. Hold to wind up, let go to throw.', at(0, 2.6, 1.0), 0.5, '#fff3c4');

  // Lounge: benches and a high table.
  for (const x of [-4.5, 4.5]) {
    box(game, [2.4, 0.08, 0.6], at(x, 0.46, 8), 0x3d2a1c, 'bench');
    box(game, [2.2, 0.42, 0.5], at(x, 0.21, 8), 0x2c2f36, 'bench-base');
  }
  box(game, [1.2, 0.06, 0.8], at(0, 1.05, 9.5), 0x3d2a1c, 'high-table');
  box(game, [0.1, 1.02, 0.1], at(0, 0.51, 9.5), 0x2c2f36, 'high-table-leg');
}

/** One lane: board, painted target, cage walls, red throw line. Returns its board. */
function lane(game: Game, at: (x: number, y: number, z: number) => Vec3, x: number, i: number): Board {
  // The board: vertical planks with a slightly different shade each.
  const planks = 6;
  const pw = BOARD_W / planks;
  for (let k = 0; k < planks; k++) {
    const shade = [0xc9a26b, 0xbf9861, 0xd2ab74][k % 3];
    box(game, [pw - 0.004, BOARD_H, 0.12], at(x - BOARD_W / 2 + pw * (k + 0.5), BOARD_Y, BOARD_Z - 0.06), shade, 'axe-board');
  }
  // Frame and a backing post.
  box(game, [BOARD_W + 0.2, 0.12, 0.2], at(x, BOARD_Y + BOARD_H / 2 + 0.06, BOARD_Z - 0.1), 0x3d2a1c, 'board-frame');
  box(game, [BOARD_W + 0.2, BOARD_Y - BOARD_H / 2, 0.2], at(x, (BOARD_Y - BOARD_H / 2) / 2, BOARD_Z - 0.1), 0x3d2a1c, 'board-stand');
  // Painted rings (outer first so the inner ones sit on top).
  const colours = [0xd23b3b, 0x1f1f1f, 0xf4efe6, 0x1f1f1f, 0xf4efe6];
  const ink = [...RINGS].reverse();
  ink.forEach(([r], k) => {
    const ring = new THREE.CircleGeometry(r, 48);
    decor(game, ring, mat(colours[ink.length - 1 - k], { roughness: 0.85 }), at(x, BOARD_Y, BOARD_Z + 0.001 + k * 0.0006), 'ring', false);
    // A thin dark line round each ring.
    decor(game, new THREE.RingGeometry(r - 0.006, r, 48), mat(0x1a1a1a), at(x, BOARD_Y, BOARD_Z + 0.0045), 'ring-line', false);
  });
  for (const s of [-1, 1]) {
    decor(game, new THREE.CircleGeometry(KILLSHOT.radius, 24), mat(0x2f6fd6), at(x + s * KILLSHOT.dx, BOARD_Y + KILLSHOT.dy, BOARD_Z + 0.002), 'killshot', false);
  }
  label(game, `Lane ${i + 1}`, at(x, BOARD_Y + BOARD_H / 2 + 0.3, BOARD_Z), 0.5);

  // Cage walls between lanes (half-height timber, mesh above).
  // Each lane builds the wall on its left; the last lane also builds its right one.
  for (const s of i === LANE_X.length - 1 ? [-1, 1] : [-1]) {
    const wx = x + s * 2.1;
    box(game, [0.12, 1.2, 4.8], at(wx, 0.6, BOARD_Z + 2.2), 0x5a4030, 'lane-wall');
    box(game, [0.12, 0.12, 4.8], at(wx, 3.0, BOARD_Z + 2.2), 0x5a4030, 'lane-wall-top');
    for (const zz of [BOARD_Z, BOARD_Z + 2.2, BOARD_Z + 4.4]) box(game, [0.12, 1.8, 0.12], at(wx, 2.1, zz), 0x5a4030, 'lane-post');
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(4.8, 1.8),
      new THREE.MeshStandardMaterial({ color: 0x9aa0a6, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }),
    );
    mesh.rotation.y = Math.PI / 2;
    mesh.position.set(...at(wx, 2.1, BOARD_Z + 2.2));
    game.world.spawn(new Entity('cage', mesh));
  }
  // The throw line.
  decor(game, new THREE.BoxGeometry(2.0, 0.012, 0.08), mat(0xd23b3b), at(x, 0.006, LINE_Z), 'throw-line', false);
  return { center: new THREE.Vector3(...at(x, BOARD_Y, BOARD_Z)) };
}

/** A wall rack holding five axes; E grabs them and starts a round. */
function rack(game: Game, at: (x: number, y: number, z: number) => Vec3, x: number, range: AxeRange): void {
  const z = LINE_Z + 0.7;
  const e = box(game, [0.5, 1.1, 0.12], at(x, 0.95, z), 0x3d2a1c, 'axe-rack');
  // Axes resting in the rack, heads up.
  const wood = mat(0xa87a4a);
  const steel = mat(0xc4ccd4, { roughness: 0.35, metalness: 0.3 });
  for (let k = 0; k < 5; k++) {
    const ax = x - 0.2 + k * 0.1;
    decor(game, new THREE.BoxGeometry(0.025, 0.42, 0.02), wood, at(ax, 1.0, z + 0.08), 'rack-axe');
    decor(game, new THREE.BoxGeometry(0.07, 0.05, 0.02), steel, at(ax + 0.02, 1.22, z + 0.08), 'rack-axe-head');
  }
  e.add(new Interactable({ prompt: () => range.rackPrompt(), range: 2.6, onInteract: (user) => range.startRound(user) }));
}

/**
 * Rounds and scoring for the player on this machine. Each throw is paired
 * with the next axe impact; the impact point gives the ring. Best round is
 * remembered in this browser.
 */
export class AxeRange implements System {
  readonly name = 'axe-range';
  private game!: Game;
  /** Points per throw this round (null while the axe is in the air). */
  throws: (number | null)[] = [];
  best = 0;
  rounds = 0;
  private panel!: HTMLDivElement;
  private unsubs: (() => void)[] = [];
  private ready = false;

  constructor(
    readonly boards: Board[],
    private origin: Vec3,
  ) {}

  init(game: Game): void {
    if (this.ready) return;
    this.ready = true;
    this.game = game;
    try {
      this.best = Number(localStorage.getItem('gene40.axes.best') ?? 0) || 0;
    } catch {
      /* storage blocked: start from 0 */
    }
    this.panel = document.createElement('div');
    this.panel.className = 'axe-panel';
    Object.assign(this.panel.style, {
      position: 'absolute',
      top: '14px',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '8px 14px',
      borderRadius: '10px',
      background: 'rgba(25,20,15,0.72)',
      color: '#fff',
      font: '600 15px system-ui, sans-serif',
      display: 'none',
      gap: '10px',
      alignItems: 'center',
      pointerEvents: 'none',
      zIndex: '4',
    });
    document.getElementById('app')?.appendChild(this.panel);
    const ev = game.events;
    this.unsubs.push(
      ev.on('combat:fired', ({ attacker, item }) => {
        if (item !== AXE || attacker.name !== 'player') return;
        this.throws.push(null);
        this.render();
      }),
      ev.on('combat:impact', (hit) => {
        if (hit.delivery !== 'projectile') return;
        const pending = this.throws.indexOf(null);
        if (pending === -1 || !this.near(hit.point)) return;
        this.land(pending, hit.point);
      }),
      ev.on('teleport', ({ scene }) => {
        // Leaving the hall: hand the axes back.
        if (scene !== 'axes') {
          const n = game.state.itemCount(AXE);
          if (n > 0) game.state.removeItem(AXE, n);
        }
        this.render();
      }),
    );
    this.render();
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
  }

  private near(p: { x: number; z: number }): boolean {
    return Math.abs(p.x - this.origin[0]) < 20 && Math.abs(p.z - this.origin[2]) < 20;
  }

  rackPrompt(): string {
    const thrown = this.throws.length;
    if (thrown === 0 && this.game.state.itemCount(AXE) === 0) return `Grab ${AXES_PER_ROUND} axes`;
    return 'Start a new round';
  }

  /** Fresh round: five axes in hand, last round's axes pulled out of the boards. */
  startRound(user: Entity): void {
    const st = this.game.state;
    st.removeItem(AXE, st.itemCount(AXE));
    st.addItem(AXE, AXES_PER_ROUND);
    for (const e of this.game.world.findByTag('stuck-projectile')) if (this.near(e.object3d.position)) this.game.world.destroy(e);
    this.throws = [];
    user.get(Combatant)?.equip(AXE);
    this.game.events.emit('notify', { text: `${AXES_PER_ROUND} axes. Stand behind the red line and throw!` });
    this.render();
  }

  get roundScore(): number {
    return this.throws.reduce<number>((a, b) => a + (b ?? 0), 0);
  }

  private land(i: number, point: { x: number; y: number; z: number }): void {
    let pts = 0;
    for (const b of this.boards) pts = Math.max(pts, scoreAt(b, point));
    this.throws[i] = pts;
    const word = pts === KILLSHOT.points ? 'KILLSHOT!' : pts === 6 ? 'BULLSEYE!' : pts === 0 ? 'Miss' : `${pts}`;
    this.game.events.emit('notify', { text: pts ? `+${pts}  ${word}` : word });
    this.game.events.emit('axes:scored', { points: pts, throwIndex: i });
    if (this.throws.length >= AXES_PER_ROUND && !this.throws.includes(null)) this.finish();
    this.render();
  }

  private finish(): void {
    this.rounds++;
    const score = this.roundScore;
    const record = score > this.best;
    if (record) {
      this.best = score;
      try {
        localStorage.setItem('gene40.axes.best', String(score));
      } catch {
        /* not saved: fine */
      }
    }
    setTimeout(() => {
      this.game.events.emit('notify', {
        text: record ? `New best: ${score} points! Grab more axes at the rack.` : `Round over: ${score} points. Grab more axes at the rack.`,
      });
    }, 900);
  }

  private render(): void {
    const inHall = (this.game.getSystem('teleports') as { current?: string } | undefined)?.current === 'axes';
    this.panel.style.display = inHall ? 'flex' : 'none';
    if (!inHall) return;
    const chips = Array.from({ length: AXES_PER_ROUND }, (_, k) => {
      const v = this.throws[k];
      const txt = v === undefined ? '·' : v === null ? '…' : String(v);
      const bg = v === undefined || v === null ? 'rgba(255,255,255,0.12)' : v >= 6 ? '#d23b3b' : v > 0 ? '#c9a26b' : '#555';
      return `<span style="display:inline-block;min-width:26px;text-align:center;padding:2px 6px;border-radius:6px;background:${bg}">${txt}</span>`;
    }).join('');
    this.panel.innerHTML = `<span>Round <b>${this.roundScore}</b></span>${chips}<span style="opacity:.8">Best ${this.best}</span>`;
  }
}

declare module '@ingine/engine/core/EventBus' {
  interface GameEvents {
    /** An axe landed: points for that throw (0 = missed the target). */
    'axes:scored': { points: number; throwIndex: number };
  }
}
