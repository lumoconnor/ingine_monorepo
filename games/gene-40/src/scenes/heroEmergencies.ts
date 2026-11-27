import * as THREE from 'three';
import type { Game } from '@ingine/engine/core/Game';
import type { System } from '@ingine/engine/core/System';
import { Entity } from '@ingine/engine/entities/Entity';
import { RAPIER } from '@ingine/engine/physics/PhysicsWorld';
import { RigidBodyComponent } from '@ingine/engine/physics/RigidBodyComponent';
import { PlayerController } from '@ingine/engine/gameplay/player/PlayerController';
import type { Vec3 } from '../scenes';
import { catModel } from './murph';
import { label, mat } from './kit';
import type { HeroPowers, Mission, PowerId } from './heroPowers';

/**
 * Hero city's one goal, SAVE HERO CITY, as a chain of steps (STEPS): take a
 * power, use it on the emergency it's for, which opens the next power. Only
 * one beam is lit at a time (a power station's, or the red one over an
 * emergency) and the top panel always says what to do next. The emergencies,
 * called in with a siren:
 *
 *  - Falling kitten (swing): a kitten on a roof ledge slips as you come near.
 *    Catch it before it reaches the street.
 *  - Burning building (flight): cats at three burning windows. Fly to each
 *    before the timer runs out.
 *  - Ring race (flight): ten rings through the skyline. Beat Captain
 *    Whiskers' time.
 *  - Runaway bus (super strength): a driverless bus rolls down the avenue at
 *    the plaza. Stand in its way, throw a car at it or slam the road by it.
 *
 * Fail one and it resets for another go.
 */

export type EmergencyId = 'kitten' | 'fire' | 'race' | 'bus';

interface Def {
  id: EmergencyId;
  needs: PowerId;
  title: string;
  alert: string;
}

export const EMERGENCIES: Def[] = [
  { id: 'kitten', needs: 'swing', title: 'Kitten on a ledge', alert: 'EMERGENCY! A kitten is about to fall off a roof. Swing over and catch it!' },
  { id: 'fire', needs: 'fly', title: 'Building on fire', alert: 'EMERGENCY! A building is on fire with cats at the windows. Fly them out!' },
  { id: 'race', needs: 'fly', title: "Captain Whiskers' ring race", alert: "CHALLENGE! Captain Whiskers bets you can't fly his ring course in time. Fly through the first ring to start." },
  { id: 'bus', needs: 'strength', title: 'Runaway bus', alert: 'EMERGENCY! A runaway bus is heading for the plaza. Stop it!' },
];

/** What the scene hands over: the places each emergency happens. */
export interface EmergencySites {
  /** A roof-edge spot facing the avenue, and the street below it. */
  ledge: { top: Vec3; street: Vec3 };
  /** The burning face: three window spots (just outside the wall) and which way the wall faces. */
  fire: { windows: Vec3[]; normal: Vec3 };
  /** Ring centres in order, and the direction to face through each. */
  rings: { at: Vec3; facing: number }[];
  /** The bus route: start, and where it would hit the plaza. */
  bus: { from: Vec3; to: Vec3 };
}

/**
 * The one goal: save Hero city. One step at a time, in this order: each power
 * gets you to the emergency it's for, and handling that opens the next power.
 */
type Step = { power: PowerId } | { emergency: EmergencyId };
export const STEPS: Step[] = [{ power: 'swing' }, { emergency: 'kitten' }, { power: 'fly' }, { emergency: 'fire' }, { emergency: 'race' }, { power: 'strength' }, { emergency: 'bus' }];

const NEXT_TEXT: Record<string, string> = {
  swing: 'take SWING from the station by the HERO CITY sign',
  kitten: 'catch the kitten falling off the roof (red beam)',
  fly: 'swing up to the blue beam on the rooftops for FLIGHT',
  fire: 'fly the cats out of the burning building (red beam)',
  race: "fly Captain Whiskers' ring course in 30 s (first ring by the sign)",
  strength: 'fly to the green beam on top of Hero HQ for SUPER STRENGTH',
  bus: 'stop the runaway bus before it hits the plaza (red beam)',
  saved: 'go and tell Captain Whiskers',
};

const KITTEN_FALL = { trigger: 45, gravity: 7, maxSpeed: 9, catchRadius: 2.6 };
const FIRE = { trigger: 70, time: 75, reach: 2.6 };
const RACE = { par: 30, radius: 4.6 };
const BUS = { speed: 9, half: new THREE.Vector3(1.35, 1.6, 5.6) };

type State = 'locked' | 'waiting' | 'active' | 'done';

export class HeroEmergencies implements System, Mission {
  readonly name = 'hero-emergencies';
  private game!: Game;
  readonly state: Record<EmergencyId, State> = { kitten: 'locked', fire: 'locked', race: 'locked', bus: 'locked' };
  /** The one the city is calling about right now. */
  current: EmergencyId | null = null;
  /** Call emergencies in by themselves (the checks turn this off and call them in by hand). */
  auto = true;
  private gap = 0;
  private panel!: HTMLDivElement;
  private beacon!: THREE.Mesh;
  /** Counters for the checks. */
  fails = 0;
  raceBest = Infinity;

  // Falling kitten.
  private kitten!: { root: THREE.Group; shout: Entity; y: number; vy: number; falling: boolean; resetIn: number; grace: number };
  // Fire.
  private fire!: { cats: { root: THREE.Group; at: THREE.Vector3; saved: boolean; fur: number }[]; flames: THREE.Mesh[]; smoke: THREE.Mesh[]; t: number; lit: boolean };
  // Race.
  private race!: { rings: THREE.Mesh[]; next: number; t: number; running: boolean };
  // Bus.
  private bus!: { entity: Entity; body: RAPIER.RigidBody; pos: THREE.Vector3; dir: THREE.Vector3; moving: boolean; stopped: boolean; resetIn: number; wait: number };

  constructor(
    private powers: HeroPowers,
    private sites: EmergencySites,
  ) {}

  init(game: Game): void {
    if (this.game) return;
    this.game = game;
    this.panel = document.createElement('div');
    this.panel.classList.add('gene-alert');
    Object.assign(this.panel.style, {
      position: 'absolute',
      top: '54px',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '6px 14px',
      borderRadius: '10px',
      background: 'rgba(150,20,40,0.8)',
      color: '#fff',
      font: '700 15px system-ui, sans-serif',
      display: 'none',
      pointerEvents: 'none',
      zIndex: '4',
      whiteSpace: 'nowrap',
    });
    document.getElementById('app')?.appendChild(this.panel);
    this.beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 1.1, 220, 16, 1, true).translate(0, 110, 0),
      new THREE.MeshBasicMaterial({ color: 0xff3040, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.beacon.visible = false;
    game.renderer.scene.add(this.beacon);

    this.buildKitten();
    this.buildFire();
    this.buildRace();
    this.buildBus();

    game.events.on('heroes:power', () => this.unlock());
    game.events.on('heroes:slam', () => this.onSlam());
    game.events.on('teleport', () => this.render());
    this.unlock();
  }

  private here(): boolean {
    return (this.game.getSystem('teleports') as { current?: string } | undefined)?.current === 'heroes';
  }

  private player(): PlayerController | undefined {
    return this.game.world.find('player')?.get(PlayerController);
  }

  private chest(): THREE.Vector3 | null {
    const p = this.player()?.entity.object3d.position;
    return p ? _chest.set(p.x, p.y + 1.1, p.z) : null;
  }

  get done(): number {
    return EMERGENCIES.filter((e) => this.state[e.id] === 'done').length;
  }

  // --- The mission ------------------------------------------------------------------

  private stepDone(st: Step): boolean {
    return 'power' in st ? this.powers.owned.has(st.power) : this.state[st.emergency] === 'done';
  }

  /** The step you're on, or null once the city is saved. */
  get step(): Step | null {
    return STEPS.find((st) => !this.stepDone(st)) ?? null;
  }

  allows(id: PowerId): boolean {
    const i = STEPS.findIndex((st) => 'power' in st && st.power === id);
    return STEPS.slice(0, i).every((st) => this.stepDone(st));
  }

  next(): string {
    const st = this.step;
    return NEXT_TEXT[st ? ('power' in st ? st.power : st.emergency) : 'saved'];
  }

  progress(): { done: number; total: number } {
    return { done: STEPS.filter((st) => this.stepDone(st)).length, total: STEPS.length };
  }

  /** Something moved on: refresh the beams and the panel, and say what's next. */
  private advanced(): void {
    this.powers.refreshStations();
    this.powers.render();
    const st = this.step;
    if (!st) {
      this.game.state.setFlag('heroes.saved');
      this.game.events.emit('notify', { text: 'HERO CITY IS SAVED! Go and tell Captain Whiskers.' });
      this.game.events.emit('heroes:citySaved', {});
    } else if ('power' in st) this.game.events.emit('notify', { text: `Next: ${this.next()}.` });
  }

  // --- The queue -------------------------------------------------------------------

  private unlock(): void {
    for (const e of EMERGENCIES) if (this.state[e.id] === 'locked' && this.powers.owned.has(e.needs)) this.state[e.id] = 'waiting';
    if (!this.current) this.gap = Math.min(this.gap || 3, 3);
    this.render();
    this.advanced();
  }

  /** Call in the next waiting emergency. Public for the checks (skips the pause). */
  callNext(): EmergencyId | null {
    // Only the step you're on: the city calls them in one at a time, in order.
    const st = this.step;
    const next = st && 'emergency' in st && this.state[st.emergency] === 'waiting' ? EMERGENCIES.find((e) => e.id === st.emergency)! : null;
    if (!next) return null;
    this.current = next.id;
    this.state[next.id] = 'active';
    this.game.events.emit('notify', { text: next.alert });
    this.game.events.emit('heroes:alert', { id: next.id });
    this.beacon.visible = true;
    this.beacon.position.copy(this.where(next.id));
    this.render();
    return next.id;
  }

  private where(id: EmergencyId): THREE.Vector3 {
    const s = this.sites;
    if (id === 'kitten') return _w.set(s.ledge.street[0], s.ledge.street[1], s.ledge.street[2]);
    if (id === 'fire') return _w.set(s.fire.windows[0][0], 0, s.fire.windows[0][2]).setY(this.sites.ledge.street[1]);
    if (id === 'race') return _w.set(...s.rings[0].at).setY(this.sites.ledge.street[1]);
    return _w.copy(this.bus.pos).setY(this.sites.ledge.street[1]);
  }

  private succeed(id: EmergencyId, text: string): void {
    this.state[id] = 'done';
    if (this.current === id) this.current = null;
    this.beacon.visible = false;
    this.gap = 4;
    this.game.events.emit('notify', { text });
    this.game.events.emit('heroes:saved', { id, done: this.done, total: EMERGENCIES.length });
    this.render();
    this.advanced();
  }

  private fail(text: string): void {
    this.fails++;
    this.game.events.emit('notify', { text });
    this.game.events.emit('heroes:failed', {});
  }

  preFixedUpdate(dt: number): void {
    if (!this.here()) return;
    if (this.auto && !this.current && this.gap > 0) {
      this.gap -= dt;
      if (this.gap <= 0) this.callNext();
    }
    this.stepKitten(dt);
    this.stepFire(dt);
    this.stepRace(dt);
    this.stepBus(dt);
  }

  // --- Falling kitten --------------------------------------------------------------------

  private buildKitten(): void {
    const { top } = this.sites.ledge;
    const { root } = catModel({ fur: 0xe08a3c, s: 1.2, sitting: true });
    const g = new THREE.Group();
    g.add(root);
    g.position.set(...top);
    this.game.renderer.scene.add(g);
    const shout = label(this.game, 'HELP!', [top[0], top[1] + 1.1, top[2]], 1.8, '#ff6070');
    shout.object3d.visible = false;
    g.visible = false;
    this.kitten = { root: g, shout, y: top[1], vy: 0, falling: false, resetIn: 0, grace: 0 };
  }

  private placeKitten(): void {
    const k = this.kitten;
    const { top } = this.sites.ledge;
    k.root.position.set(...top);
    k.y = top[1];
    k.vy = 0;
    k.falling = false;
    k.root.rotation.set(0, 0, 0);
    // A moment to get ready before it slips again.
    k.grace = 2.5;
  }

  /** Start the kitten falling (for the checks). */
  dropKitten(): void {
    if (this.current !== 'kitten' || this.kitten.falling) return;
    this.kitten.falling = true;
    // Off the edge, towards the street.
    const { top, street } = this.sites.ledge;
    this.kitten.root.position.x += Math.sign(street[0] - top[0]) * 1.2;
    this.kitten.root.position.z += Math.sign(street[2] - top[2]) * 1.2;
    this.game.events.emit('heroes:kittenFall', {});
  }

  private stepKitten(dt: number): void {
    const k = this.kitten;
    const active = this.current === 'kitten';
    k.root.visible = active;
    k.shout.object3d.visible = active;
    if (!active) return;
    k.shout.object3d.position.set(k.root.position.x, k.root.position.y + 1.6, k.root.position.z);
    if (k.resetIn > 0) {
      k.resetIn -= dt;
      if (k.resetIn <= 0) this.placeKitten();
      return;
    }
    const chest = this.chest();
    if (!chest) return;
    // Get to it (on the ledge or in mid-air) and it's safe.
    if (chest.distanceTo(k.root.position) < KITTEN_FALL.catchRadius) {
      k.falling = false;
      this.placeKitten();
      this.game.events.emit('heroes:catch', {});
      this.powers.addToBasket(0xe08a3c);
      this.succeed('kitten', 'Caught it! The kitten is safe, waiting in the basket on the plaza.');
      return;
    }
    if (!k.falling) {
      k.grace = Math.max(0, k.grace - dt);
      const d = Math.hypot(chest.x - k.root.position.x, chest.z - k.root.position.z);
      if (d < KITTEN_FALL.trigger && k.grace === 0) this.dropKitten();
      return;
    }
    k.vy = Math.min(KITTEN_FALL.maxSpeed, k.vy + KITTEN_FALL.gravity * dt);
    k.y -= k.vy * dt;
    k.root.position.y = k.y;
    k.root.rotation.z += dt * 4;
    const floor = this.sites.ledge.street[1];
    if (k.y <= floor) {
      k.root.position.y = floor;
      k.root.rotation.z = 0;
      k.falling = false;
      k.resetIn = 3;
      this.fail('It landed on its feet (cats do), but it is not happy. It climbs back up. Catch it this time!');
    }
  }

  // --- Burning building --------------------------------------------------------------------

  private buildFire(): void {
    const scene = this.game.renderer.scene;
    const [nx, , nz] = this.sites.fire.normal;
    const yaw = Math.atan2(nx, nz);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    const smokeMat = new THREE.MeshBasicMaterial({ color: 0x333338, transparent: true, opacity: 0.45, depthWrite: false });
    const flames: THREE.Mesh[] = [];
    const smoke: THREE.Mesh[] = [];
    const cats = this.sites.fire.windows.map((w, i) => {
      // The window glowing orange, flames licking out beside the cat, smoke rising.
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 2.6), new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
      glow.position.set(w[0] - nx * 0.4, w[1] + 0.9, w[2] - nz * 0.4);
      glow.rotation.y = yaw;
      scene.add(glow);
      flames.push(glow);
      for (const side of [-1.6, 1.6]) {
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.4, 8, 1, true), side < 0 ? flameMat : coreMat);
        f.position.set(w[0] + Math.cos(yaw) * side, w[1] + 0.6, w[2] - Math.sin(yaw) * side);
        scene.add(f);
        flames.push(f);
      }
      for (let k = 0; k < 3; k++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(1.2, 10, 8), smokeMat);
        s.position.set(w[0], w[1] + 2 + k * 2.2, w[2]);
        s.userData.base = s.position.clone();
        s.userData.phase = k / 3 + i;
        scene.add(s);
        smoke.push(s);
      }
      const fur = [0x9a9aa2, 0xf4f1ea, 0x2b2b30][i % 3];
      const { root } = catModel({ fur, s: 0.85, sitting: true });
      const g = new THREE.Group();
      g.add(root);
      g.position.set(...w);
      g.rotation.y = yaw;
      scene.add(g);
      // A little sill to sit on.
      const sill = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.9), mat(0xd9d4c7));
      sill.position.set(w[0], w[1] - 0.06, w[2]);
      sill.rotation.y = yaw;
      scene.add(sill);
      return { root: g, at: new THREE.Vector3(...w), saved: false, fur };
    });
    this.fire = { cats, flames, smoke, t: 0, lit: false };
    this.showFire(false);
  }

  private showFire(on: boolean): void {
    for (const m of [...this.fire.flames, ...this.fire.smoke]) m.visible = on;
    for (const c of this.fire.cats) c.root.visible = on && !c.saved;
  }

  private stepFire(dt: number): void {
    const f = this.fire;
    const active = this.current === 'fire';
    if (active !== f.lit) {
      f.lit = active;
      if (active) for (const c of f.cats) c.saved = false;
      f.t = 0;
      this.showFire(active);
    }
    if (!active) return;
    const chest = this.chest();
    if (!chest) return;
    const near = Math.hypot(chest.x - f.cats[0].at.x, chest.z - f.cats[0].at.z) < FIRE.trigger;
    if (near || f.t > 0) f.t += dt;
    for (const c of f.cats) {
      if (c.saved || chest.distanceTo(c.at) > FIRE.reach) continue;
      c.saved = true;
      c.root.visible = false;
      this.powers.addToBasket(c.fur);
      const left = f.cats.filter((q) => !q.saved).length;
      this.game.events.emit('heroes:catch', {});
      if (left) this.game.events.emit('notify', { text: `Got one! ${left} more at the windows.` });
    }
    if (f.cats.every((c) => c.saved)) {
      this.showFire(false);
      this.succeed('fire', `Every cat out in ${Math.round(f.t)} seconds, and the fire's out. Hero!`);
      return;
    }
    if (f.t > FIRE.time) {
      this.fail('Too slow: the fire brigade got there first. The fire flares up again. Try again!');
      for (const c of f.cats) c.saved = false;
      f.t = 0;
      this.showFire(true);
    }
    this.render();
  }

  // --- Ring race ------------------------------------------------------------------------

  private buildRace(): void {
    const rings = this.sites.rings.map((r, i) => {
      const m = new THREE.Mesh(
        new THREE.TorusGeometry(RACE.radius, 0.32, 10, 40),
        new THREE.MeshStandardMaterial({ color: 0xffd84a, emissive: 0xffc400, emissiveIntensity: 0.6, transparent: true, opacity: 0.9 }),
      );
      m.position.set(...r.at);
      m.rotation.y = r.facing;
      m.name = `race-ring-${i}`;
      m.visible = false;
      this.game.renderer.scene.add(m);
      return m;
    });
    this.race = { rings, next: 0, t: 0, running: false };
  }

  private stepRace(dt: number): void {
    const r = this.race;
    const active = this.current === 'race';
    for (const [i, m] of r.rings.entries()) {
      m.visible = active;
      const mat = m.material as THREE.MeshStandardMaterial;
      const isNext = i === r.next;
      mat.emissiveIntensity = isNext ? 1.6 : 0.25;
      mat.opacity = isNext ? 1 : i < r.next ? 0.15 : 0.55;
    }
    if (!active) return;
    if (r.running) r.t += dt;
    const chest = this.chest();
    if (!chest) return;
    const ring = r.rings[r.next];
    if (chest.distanceTo(ring.position) < RACE.radius) {
      if (r.next === 0) {
        r.running = true;
        r.t = 0;
        this.game.events.emit('notify', { text: `Go! ${r.rings.length} rings. Captain Whiskers' time: ${RACE.par} seconds.` });
      }
      this.game.events.emit('heroes:ring', { n: r.next + 1, of: r.rings.length });
      r.next++;
      if (r.next === r.rings.length) {
        const t = r.t;
        r.next = 0;
        r.running = false;
        this.raceBest = Math.min(this.raceBest, t);
        if (t <= RACE.par) this.succeed('race', `${t.toFixed(1)} seconds! You beat Captain Whiskers. He is pretending not to mind.`);
        else this.fail(`${t.toFixed(1)} seconds. Captain Whiskers did it in ${RACE.par}. Back to the first ring and try again!`);
      }
    }
    // Way too slow: start over.
    if (r.running && r.t > RACE.par * 2) {
      r.running = false;
      r.next = 0;
      this.fail('The race timed out. Fly through the first ring to try again.');
    }
    this.render();
  }

  // --- Runaway bus ------------------------------------------------------------------------

  private buildBus(): void {
    const g = new THREE.Group();
    const paint = mat(0xf2c230, { roughness: 0.5, metalness: 0.2 });
    const glass = mat(0x2a3550, { roughness: 0.2, metalness: 0.5 });
    const h = BUS.half;
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      g.add(mesh);
    };
    // Long side along z; the front faces +z (the way it drives).
    add(new THREE.BoxGeometry(h.x * 2, h.y * 2 - 0.5, h.z * 2), paint, 0, 0.25, 0);
    add(new THREE.BoxGeometry(h.x * 2 + 0.04, 0.8, h.z * 2 - 1), glass, 0, 0.7, -0.2);
    add(new THREE.BoxGeometry(h.x * 2 - 0.3, 1.0, 0.05), glass, 0, 0.6, h.z + 0.01);
    add(new THREE.BoxGeometry(h.x * 2 - 0.6, 0.35, 0.06), mat(0x1a1a1c), 0, 1.35, h.z + 0.02);
    for (const z of [-h.z + 1.4, h.z - 1.6]) for (const x of [-h.x, h.x]) add(new THREE.CylinderGeometry(0.55, 0.55, 0.35, 16).rotateZ(Math.PI / 2), mat(0x1a1a1c), x, -h.y + 0.55, z);
    const from = this.sites.bus.from;
    g.position.set(...from);
    const e = new Entity('runaway-bus', g);
    e.add(new RigidBodyComponent({ type: 'kinematicPosition', colliders: [RAPIER.ColliderDesc.cuboid(h.x, h.y, h.z)] }));
    this.game.world.spawn(e);
    const body = e.get(RigidBodyComponent)!.body;
    const dir = new THREE.Vector3(this.sites.bus.to[0] - from[0], 0, this.sites.bus.to[2] - from[2]).normalize();
    g.rotation.y = Math.atan2(dir.x, dir.z);
    this.bus = { entity: e, body, pos: new THREE.Vector3(...from), dir, moving: false, stopped: false, resetIn: 0, wait: 0 };
    this.parkBus();
    this.bus.wait = 0;
  }

  private parkBus(): void {
    const b = this.bus;
    b.pos.set(...this.sites.bus.from);
    b.moving = false;
    b.stopped = false;
    // A few seconds' grace before it rolls again.
    b.wait = 3;
    _q.setFromEuler(new THREE.Euler(0, Math.atan2(b.dir.x, b.dir.z), 0));
    b.body.setTranslation({ x: b.pos.x, y: b.pos.y, z: b.pos.z }, true);
    b.body.setRotation(_q, true);
  }

  /** Stop the bus (super strength, a thrown car, a slam). */
  private stopBus(how: string): void {
    const b = this.bus;
    if (!b.moving) return;
    b.moving = false;
    b.stopped = true;
    // It rocks to a halt, nose down.
    _q.setFromEuler(new THREE.Euler(0.06, Math.atan2(b.dir.x, b.dir.z), 0));
    b.body.setNextKinematicRotation(_q);
    this.game.events.emit('heroes:busStop', {});
    this.succeed('bus', how);
  }

  private onSlam(): void {
    if (this.current !== 'bus' || !this.bus.moving) return;
    const p = this.player()?.entity.object3d.position;
    if (p && Math.hypot(p.x - this.bus.pos.x, p.z - this.bus.pos.z) < 12) this.stopBus('Your slam cracked the road and the bus stopped dead. Nobody spilled their coffee.');
  }

  private stepBus(dt: number): void {
    const b = this.bus;
    const active = this.current === 'bus';
    if (!active) {
      if (b.moving) this.parkBus();
      return;
    }
    if (b.resetIn > 0) {
      b.resetIn -= dt;
      if (b.resetIn <= 0) this.parkBus();
      return;
    }
    const chest = this.chest();
    if (!chest) return;
    if (!b.moving && !b.stopped) {
      // It sets off once you're near enough to see it coming.
      b.wait = Math.max(0, b.wait - dt);
      if (b.wait === 0 && Math.hypot(chest.x - b.pos.x, chest.z - b.pos.z) < 90) {
        b.moving = true;
        this.game.events.emit('heroes:busGo', {});
      }
      return;
    }
    if (!b.moving) return;
    b.pos.addScaledVector(b.dir, BUS.speed * dt);
    b.body.setNextKinematicTranslation({ x: b.pos.x, y: b.pos.y, z: b.pos.z });
    // In your way: you hold it back with your bare hands.
    const front = _w.copy(b.pos).addScaledVector(b.dir, BUS.half.z + 0.8);
    const feet = this.player()!.entity.object3d.position;
    if (Math.hypot(feet.x - front.x, feet.z - front.z) < 2.2 && Math.abs(feet.y - (b.pos.y - BUS.half.y)) < 2) {
      this.stopBus('You stopped a bus with your bare hands. The passengers are clapping.');
      return;
    }
    // Hit by something you threw.
    for (const t of this.powers.throwables) {
      if (t === this.powers.held) continue;
      const rb = t.entity.get(RigidBodyComponent)?.body;
      if (!rb) continue;
      const v = rb.linvel();
      if (Math.hypot(v.x, v.y, v.z) < 6) continue;
      const p = rb.translation();
      _local.set(p.x - b.pos.x, p.y - b.pos.y, p.z - b.pos.z);
      const along = _local.dot(b.dir);
      const side = Math.abs(_local.x * b.dir.z - _local.z * b.dir.x);
      if (Math.abs(along) < BUS.half.z + 1.5 && side < BUS.half.x + 1.5 && Math.abs(_local.y) < BUS.half.y + 1.5) {
        this.stopBus(`Direct hit! A flying ${t.kind} stopped the bus. Insurance will be interesting.`);
        return;
      }
    }
    // Made it to the plaza: it crashes into the sign.
    const to = this.sites.bus.to;
    _local.set(to[0] - b.pos.x, 0, to[2] - b.pos.z);
    if (_local.dot(b.dir) <= 0) {
      b.moving = false;
      b.resetIn = 3;
      this.fail('The bus rolled into the plaza. Everyone jumped clear, but that was close. It is back at the top of the avenue: stop it this time!');
    }
  }

  // --- Panel and beacon ------------------------------------------------------------------------

  update(time: { elapsed: number }): void {
    const pulse = 0.22 + 0.12 * Math.sin(time.elapsed * 6);
    (this.beacon.material as THREE.MeshBasicMaterial).opacity = pulse;
    for (const s of this.fire.smoke) {
      if (!s.visible) continue;
      const base = s.userData.base as THREE.Vector3;
      const k = (time.elapsed * 0.25 + (s.userData.phase as number)) % 1;
      s.position.set(base.x, base.y + k * 6, base.z);
      s.scale.setScalar(0.6 + k * 1.4);
    }
    for (const [i, f] of this.fire.flames.entries()) {
      if (!f.visible) continue;
      if (f.geometry.type === 'PlaneGeometry') (f.material as THREE.MeshBasicMaterial).opacity = 0.75 + 0.2 * Math.sin(time.elapsed * 13 + i);
      else f.scale.set(1, 0.85 + 0.3 * Math.abs(Math.sin(time.elapsed * 9 + i * 1.7)), 1);
    }
  }

  render(): void {
    const here = this.here();
    const id = this.current;
    this.panel.style.display = here && id ? 'block' : 'none';
    if (!id) return;
    const def = EMERGENCIES.find((e) => e.id === id)!;
    let extra = '';
    if (id === 'fire') {
      const left = this.fire.cats.filter((c) => !c.saved).length;
      extra = this.fire.t > 0 ? `  ·  ${left} cats left  ·  ${Math.max(0, Math.ceil(FIRE.time - this.fire.t))} s` : '';
    }
    if (id === 'race') extra = this.race.running ? `  ·  ring ${this.race.next + 1} / ${this.race.rings.length}  ·  ${this.race.t.toFixed(1)} s (beat ${RACE.par})` : '  ·  fly through the first ring';
    this.panel.textContent = `🚨 ${def.title}${extra}  ·  follow the red beam`;
  }
}

const _chest = new THREE.Vector3();
const _w = new THREE.Vector3();
const _local = new THREE.Vector3();
const _q = new THREE.Quaternion();

declare module '@ingine/engine/core/EventBus' {
  interface GameEvents {
    'heroes:alert': { id: EmergencyId };
    'heroes:saved': { id: EmergencyId; done: number; total: number };
    'heroes:failed': Record<string, never>;
    'heroes:kittenFall': Record<string, never>;
    'heroes:catch': Record<string, never>;
    'heroes:citySaved': Record<string, never>;
    'heroes:ring': { n: number; of: number };
    'heroes:busGo': Record<string, never>;
    'heroes:busStop': Record<string, never>;
  }
}
