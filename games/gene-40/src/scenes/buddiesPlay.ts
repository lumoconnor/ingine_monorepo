import * as THREE from 'three';
import type { Game } from '@ingine/engine/core/Game';
import type { System } from '@ingine/engine/core/System';
import { Component } from '@ingine/engine/entities/Component';
import { Entity } from '@ingine/engine/entities/Entity';
import { RAPIER } from '@ingine/engine/physics/PhysicsWorld';
import { RigidBodyComponent } from '@ingine/engine/physics/RigidBodyComponent';
import { Npc } from '@ingine/engine/gameplay/components/Npc';
import { Wander } from '@ingine/engine/gameplay/components/Wander';
import { PlayerController } from '@ingine/engine/gameplay/player/PlayerController';
import { Combatant } from '@ingine/engine/combat/Combatant';
import type { Vec3 } from '../scenes';
import { PUP_BALL_R, restingBall } from '../content/pupBalls';
import type { PupDef } from './buddies';

/**
 * What makes Buddies park play: the pups' brains (they run to you, chase a
 * thrown ball and bring it back), their wagging tails and bouncy trot, the
 * lost-ball quest, fetch, the rocket launch (Space Buddies) and the spooky
 * house's ghost.
 */

const G = 9.8;
/** Thrown ball: speed at no wind-up and at full wind-up (m/s), and how far above where you look it leaves. */
const THROW_MIN = 8;
const THROW_MAX = 21;
const THROW_LIFT_DEG = 12;
const CHARGE_TIME = 1.2;
/** Pup running speeds (m/s). */
const CHASE_SPEED = 7.5;
const RETURN_SPEED = 5.5;
const COME_SPEED = 5.5;
/** Seconds a pup waits by a ball it dropped for you before it takes it back. */
const OFFER_TIME = 30;
const BEST_KEY = 'gene40.buddies.fetch';
/** The park's grass, scene-relative: a thrown ball stays on it. */
const BOUNDS = { x0: -58, x1: 58, z0: -85, z1: 21 };

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

/** Hits on the park's solid things only (not the player or the dogs, which are kinematic). */
const SOLID = RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;

/** Ground height under (x, z), looking down from `fromY` (so it steps up low ledges, not walls). */
function groundBelow(game: Game, x: number, z: number, fromY: number, fallback: number): number {
  const hit = game.physics.world.castRay(new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 }), 6, false, SOLID);
  return hit ? fromY - hit.timeOfImpact : fallback;
}

// --- Dogs: brains and bodies ----------------------------------------------------------

interface Task {
  target: () => THREE.Vector3 | null;
  speed: number;
  near: number;
  /** Called on arrival; return false to keep going (chasing something that moves). */
  onArrive: () => boolean | void;
}

/**
 * A pup's legs: walks its Wander loop until given a task, then runs straight
 * to a point (a ball, the player, the rocket), up the pyramid and snow hill
 * tiers on the way. `resume()` trots it back to its loop.
 */
export class PupBrain extends Component {
  task: Task | null = null;
  /** Sits still facing the player (waiting for a throw). */
  waiting = false;
  private rb!: RigidBodyComponent;
  private npc?: Npc;
  private wander?: Wander;

  constructor(
    readonly head: THREE.Object3D,
    readonly scale: number,
    private baseY: number,
  ) {
    super();
  }

  onAttach(): void {
    this.rb = this.entity.get(RigidBodyComponent)!;
    this.npc = this.entity.get(Npc);
    this.wander = this.entity.get(Wander);
  }

  /** Off its loop: running somewhere or waiting. */
  get busy(): boolean {
    return !!this.task || this.waiting || this.wander?.enabled === false;
  }

  /** Excited: running for something, or waiting for a throw. */
  get excited(): boolean {
    return !!this.task || this.waiting;
  }

  runTo(target: () => THREE.Vector3 | null, speed: number, onArrive: () => boolean | void = () => true, near = 0.4): void {
    if (this.wander) this.wander.enabled = false;
    this.waiting = false;
    this.task = { target, speed, near, onArrive };
  }

  hold(): void {
    if (this.wander) this.wander.enabled = false;
    this.task = null;
    this.waiting = true;
  }

  /** Back to the loop: trot to where it left it, then carry on walking it. */
  resume(): void {
    this.waiting = false;
    if (!this.wander) {
      this.task = null;
      return;
    }
    const home = this.wander.position(new THREE.Vector3());
    home.y = this.baseY;
    this.runTo(() => home, 3.2, () => {
      if (this.wander) this.wander.enabled = true;
    }, 0.12);
  }

  /** Straight there (the rocket's door, the checks). */
  place(p: THREE.Vector3): void {
    this.rb.teleport(p, this.entity.object3d.quaternion);
    this.entity.object3d.position.copy(p);
  }

  get position(): THREE.Vector3 {
    const t = this.rb.body.translation();
    return _w.set(t.x, t.y, t.z);
  }

  fixedUpdate(dt: number): void {
    const player = this.game.world.find('player')?.get(PlayerController);
    if (this.waiting && player) {
      const me = this.rb.body.translation();
      const f = player.feetPosition;
      this.npc?.face(Math.atan2(f.x - me.x, f.z - me.z));
      return;
    }
    const task = this.task;
    if (!task || this.npc?.talking) return;
    const t = task.target();
    if (!t) return;
    const me = this.rb.body.translation();
    const dx = t.x - me.x;
    const dz = t.z - me.z;
    const d = Math.hypot(dx, dz);
    if (d <= task.near) {
      if (task.onArrive() !== false && this.task === task) this.task = null;
      return;
    }
    const step = Math.min(d, task.speed * dt);
    const nx = me.x + (dx / d) * step;
    const nz = me.z + (dz / d) * step;
    const gy = groundBelow(this.game, nx, nz, me.y + 0.75, this.baseY);
    // Hop up ledges quickly, drop off them a little slower.
    const ny = gy > me.y ? Math.min(gy, me.y + 6 * dt) : Math.max(gy, me.y - 9 * dt);
    this.rb.body.setNextKinematicTranslation(_v.set(nx, ny, nz));
    this.npc?.face(Math.atan2(dx, dz));
  }
}

/** Wagging tail and a bouncy trot, from how fast the dog is going. */
export class DogAnim extends Component {
  private last = new THREE.Vector3();
  private speed = 0;
  private phase = Math.random() * 10;
  private wag = Math.random() * 10;
  private started = false;

  constructor(
    private root: THREE.Object3D,
    private tail: THREE.Object3D,
    private s: number,
    private sitting: boolean,
  ) {
    super();
  }

  update(time: { delta: number }): void {
    const dt = Math.min(time.delta, 0.1);
    if (dt <= 0) return;
    const p = this.entity.object3d.position;
    if (!this.started) {
      this.started = true;
      this.last.copy(p);
    }
    const v = Math.hypot(p.x - this.last.x, p.z - this.last.z) / dt;
    this.last.copy(p);
    this.speed += (Math.min(v, 12) - this.speed) * Math.min(1, dt * 8);
    const brain = this.entity.get(PupBrain);
    const player = this.game.world.find('player')?.object3d.position;
    const near = !!player && Math.hypot(player.x - p.x, player.z - p.z) < 4;
    const excited = brain?.excited || this.speed > 4;
    // Faster and wider when excited, a lazy sway when someone's near, a slow one otherwise.
    const rate = excited ? 17 : near ? 11 : 6;
    const amp = excited ? 0.85 : near ? 0.6 : 0.35;
    this.wag += dt * rate;
    this.tail.rotation.y = Math.sin(this.wag) * amp;
    if (this.sitting) return;
    const moving = this.speed > 0.3;
    this.phase += dt * (5 + this.speed * 2.2);
    const k = Math.min(1, this.speed / 3);
    const bob = moving ? Math.abs(Math.sin(this.phase)) * (0.05 + 0.1 * k) * this.s : 0;
    this.root.position.y += (bob - this.root.position.y) * Math.min(1, dt * 20);
    const pitch = moving ? Math.sin(this.phase * 2) * 0.08 * k : 0;
    this.root.rotation.x += (pitch - this.root.rotation.x) * Math.min(1, dt * 20);
  }
}

// --- The ball quest and fetch ----------------------------------------------------------

type Play = 'idle' | 'offered' | 'held' | 'flying' | 'returning';

interface PupState {
  def: PupDef;
  dog: Entity;
  brain: PupBrain;
  ball: THREE.Group;
  /** Where the lost ball rests. */
  lostAt: THREE.Vector3;
  state: 'lost' | 'carried' | 'home';
  /** Fetch, once the ball's home. */
  play: Play;
  item: string;
  /** Seconds in the current play state. */
  t: number;
  /** Not again for a while after giving up on you. */
  cooldown: number;
}

interface Flying {
  pup: PupState;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  from: THREE.Vector3;
  landed: THREE.Vector3 | null;
  r: number;
  t: number;
}

/**
 * The lost-ball quest, then fetch. Walk over a lost ball to pick it up (you
 * can carry several) and its pup comes bounding over to get it. Once a pup
 * has its ball back it drops it at your feet: pick it up, hold the attack
 * button to wind up, let go to throw, and the pup races after it and brings
 * it back. A pup with its ball wanders with it, and drops it for you again
 * when you walk up empty-handed.
 */
export class BallQuest implements System {
  readonly name = 'ball-quest';
  private game!: Game;
  private ready = false;
  readonly pups: PupState[] = [];
  returned = 0;
  fetches = 0;
  best = 0;
  /** The last throw, for the checks. */
  lastThrow: { pup: string; metres: number } | null = null;
  flying: Flying | null = null;
  rocket: RocketShow | null = null;
  ghost: SpookyGhost | null = null;
  private taught = false;
  private panel!: HTMLDivElement;
  private meter!: HTMLDivElement;
  private meterFill!: HTMLDivElement;
  private unsubs: (() => void)[] = [];

  constructor(private origin: Vec3) {}

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
      background: 'rgba(40,80,30,0.75)',
      color: '#fff3c4',
      font: '600 16px system-ui, sans-serif',
      display: 'none',
      pointerEvents: 'none',
      zIndex: '4',
      whiteSpace: 'nowrap',
    });
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
    Object.assign(this.meterFill.style, { position: 'absolute', left: '0', right: '0', bottom: '0', height: '0%', background: 'linear-gradient(#d84b4b, #ffd84a)' });
    this.meter.appendChild(this.meterFill);
    const app = document.getElementById('app');
    app?.appendChild(this.panel);
    app?.appendChild(this.meter);
    this.unsubs.push(game.events.on('teleport', ({ scene }) => (scene !== 'buddies' && this.putAway(), this.render())));
    this.unsubs.push(
      game.events.on('combat:swing', ({ attacker, item, charge }) => {
        if (attacker !== this.player()) return;
        const p = this.pups.find((q) => q.item === item && q.play === 'held');
        if (p) this.throwBall(p, charge);
      }),
    );
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
  }

  get total(): number {
    return this.pups.length;
  }

  addPup(game: Game, def: PupDef, dog: Entity, lostAt: Vec3): void {
    const ball = restingBall(def.sport);
    ball.position.set(...lostAt);
    game.world.spawn(new Entity(`ball:${def.sport}`, ball));
    this.pups.push({ def, dog, brain: dog.get(PupBrain)!, ball, lostAt: new THREE.Vector3(...lostAt), state: 'lost', play: 'idle', item: `pup_${def.sport}`, t: 0, cooldown: 0 });
  }

  private player(): Entity | undefined {
    return this.game.world.find('player') ?? undefined;
  }

  private here(): boolean {
    return (this.game.getSystem('teleports') as { current?: string } | undefined)?.current === 'buddies';
  }

  private inPark(p: THREE.Vector3): boolean {
    return Math.abs(p.x - this.origin[0]) < 90 && Math.abs(p.z - this.origin[2] + 32) < 70;
  }

  /** The player's feet, while they're in the park. */
  private feet(): THREE.Vector3 | null {
    const f = this.player()?.get(PlayerController)?.feetPosition;
    return f && this.inPark(f) ? f : null;
  }

  preFixedUpdate(dt: number): void {
    this.rocket?.tick(dt);
    this.ghost?.tick(dt);
    this.updateMeter();
    if (this.flying) this.stepBall(this.flying, dt);
    const feet = this.feet();
    if (!feet) return;
    for (const p of this.pups) {
      p.t += dt;
      p.cooldown = Math.max(0, p.cooldown - dt);
      if (p.state === 'lost') {
        const b = p.lostAt;
        if (Math.hypot(feet.x - b.x, feet.z - b.z) < 0.9 && feet.y - b.y > -0.5 && feet.y - b.y < 1.2) this.pickUp(p);
      } else if (p.state === 'carried') {
        const d = p.brain.position;
        if (Math.hypot(feet.x - d.x, feet.z - d.z) < 2.6 && Math.abs(feet.y - d.y) < 1.5) this.giveBack(p);
      } else this.fetchTick(p, feet);
    }
  }

  // The quest.

  private pickUp(p: PupState): void {
    p.state = 'carried';
    p.ball.removeFromParent();
    this.game.events.emit('notify', { text: `Found ${p.def.name}'s ${p.def.ball}! Here comes ${p.def.name}...` });
    this.game.events.emit('buddies:ball', { pup: p.def.id, state: 'carried' });
    // The pup's seen it, and comes bounding over (if it's not off in space).
    if (!this.rocket?.active) p.brain.runTo(() => this.feet(), COME_SPEED, () => false, 1.6);
    this.render();
  }

  private giveBack(p: PupState): void {
    p.state = 'home';
    this.returned++;
    this.game.state.setFlag(`buddies.${p.def.id}`);
    const all = this.returned === this.total;
    if (all) this.game.state.setFlag('buddies.all');
    this.game.events.emit('buddies:ball', { pup: p.def.id, state: 'home' });
    const feet = this.feet();
    if (feet) this.offer(p, feet);
    else this.toFeet(p);
    const play = this.taught ? 'Throw it!' : 'Pick it up and throw it: hold to wind up, let go to throw.';
    this.taught = true;
    this.game.events.emit('notify', {
      text: all
        ? `Every Buddy has their ball back! The pups want to go to space: press the launch button by the rocket.`
        : `${p.def.name} has the ${p.def.ball} back! ${this.returned} / ${this.total}. ${p.def.name} drops it at your feet. ${play}`,
    });
    this.render();
  }

  // Fetch.

  /** The ball sits at the pup's feet and goes where it goes. */
  private toFeet(p: PupState): void {
    p.ball.scale.setScalar(1);
    p.ball.rotation.set(0, 0, 0);
    p.ball.position.set(0.35, 0, 0.45);
    p.dog.object3d.add(p.ball);
    p.play = 'idle';
    p.t = 0;
  }

  /** In the pup's mouth. */
  private toMouth(p: PupState): void {
    const s = p.brain.scale;
    p.ball.scale.setScalar(0.55);
    p.ball.rotation.set(0, 0, 0);
    p.ball.position.set(0, -0.11 * s - (PUP_BALL_R[p.def.sport] ?? 0.17) * 0.55, 0.3 * s);
    p.brain.head.add(p.ball);
  }

  /** Drop the ball on the ground just in front of you, between you and the pup, and sit. */
  private offer(p: PupState, feet: THREE.Vector3): void {
    const d = p.brain.position;
    const dx = d.x - feet.x;
    const dz = d.z - feet.z;
    const l = Math.hypot(dx, dz) || 1;
    const x = feet.x + (dx / l) * 1.1;
    const z = feet.z + (dz / l) * 1.1;
    const y = groundBelow(this.game, x, z, feet.y + 0.6, feet.y);
    p.ball.scale.setScalar(1);
    p.ball.position.set(x, y, z);
    this.game.renderer.scene.add(p.ball);
    p.play = 'offered';
    p.t = 0;
    p.brain.hold();
  }

  private holding(): PupState | undefined {
    return this.pups.find((q) => q.play === 'held' || q.play === 'flying' || q.play === 'returning');
  }

  private fetchTick(p: PupState, feet: THREE.Vector3): void {
    if (this.rocket?.active) return;
    switch (p.play) {
      case 'idle': {
        // Wanders with its ball. Walk up empty-handed and it drops it for you.
        if (p.cooldown > 0 || p.brain.busy || this.holding() || this.pups.some((q) => q.play === 'offered')) return;
        const d = p.brain.position;
        if (Math.hypot(feet.x - d.x, feet.z - d.z) < 3.2 && Math.abs(feet.y - d.y) < 1.5 && !this.player()?.get(Combatant)?.itemId) {
          this.offer(p, feet);
          this.game.events.emit('buddies:fetch', { pup: p.def.id, phase: 'drop' });
        }
        return;
      }
      case 'offered': {
        const b = p.ball.position;
        if (!this.holding() && Math.hypot(feet.x - b.x, feet.z - b.z) < 0.9 && Math.abs(feet.y - b.y) < 1.3) {
          this.pickToThrow(p);
          return;
        }
        // Waited long enough, or you wandered off: it takes the ball back.
        if (p.t > OFFER_TIME || Math.hypot(feet.x - b.x, feet.z - b.z) > 25) {
          this.toFeet(p);
          p.cooldown = 20;
          p.brain.resume();
        }
        return;
      }
    }
  }

  private pickToThrow(p: PupState): void {
    const player = this.player();
    if (!player) return;
    p.ball.removeFromParent();
    const st = this.game.state;
    if (!st.itemCount(p.item)) st.addItem(p.item, 1);
    player.get(Combatant)?.equip(p.item);
    p.play = 'held';
    p.t = 0;
    p.brain.hold();
    this.render();
  }

  /** Back to its pup, out of your hand (leaving the park, the rocket). */
  private putAway(): void {
    for (const p of this.pups) {
      if (p.state === 'lost') continue;
      if (p.state === 'carried') {
        p.brain.resume();
        continue;
      }
      if (p.play === 'idle') continue;
      if (p.play === 'held') this.dropItem(p);
      if (this.flying?.pup === p) this.flying = null;
      this.toFeet(p);
      p.brain.resume();
    }
  }

  private dropItem(p: PupState): void {
    const cb = this.player()?.get(Combatant);
    if (cb?.itemId === p.item) cb.equip(null);
    this.game.state.removeItem(p.item, this.game.state.itemCount(p.item));
  }

  /** Let go of the button: the ball leaves your hand and the pup's off. Public for the checks. */
  throwBall(p: PupState, charge: number): void {
    const ctrl = this.player()?.get(PlayerController);
    if (!ctrl || p.play !== 'held') return;
    const cam = this.game.renderer.camera;
    const eye = cam.getWorldPosition(new THREE.Vector3());
    const look = cam.getWorldDirection(new THREE.Vector3());
    const flat = new THREE.Vector3(look.x, 0, look.z);
    if (flat.lengthSq() < 1e-6) flat.set(-Math.sin(ctrl.yaw), 0, -Math.cos(ctrl.yaw));
    flat.normalize();
    const pitch = Math.asin(THREE.MathUtils.clamp(look.y, -1, 1));
    const launch = THREE.MathUtils.clamp(pitch + THREE.MathUtils.degToRad(THROW_LIFT_DEG), THREE.MathUtils.degToRad(-10), THREE.MathUtils.degToRad(70));
    const speed = THROW_MIN + (THROW_MAX - THROW_MIN) * THREE.MathUtils.clamp(charge, 0, 1);
    const pos = eye.clone().addScaledVector(flat, 0.45).add(new THREE.Vector3(0, -0.15, 0));
    const vel = flat.clone().multiplyScalar(Math.cos(launch) * speed);
    vel.y = Math.sin(launch) * speed;
    this.dropItem(p);
    const r = PUP_BALL_R[p.def.sport] ?? 0.17;
    // Fly the ball itself: centred, so lift its mesh back down.
    p.ball.scale.setScalar(1);
    p.ball.position.copy(pos);
    p.ball.children[0].position.y = 0;
    this.game.renderer.scene.add(p.ball);
    this.flying = { pup: p, pos, vel, from: ctrl.feetPosition.clone(), landed: null, r, t: 0 };
    p.play = 'flying';
    p.t = 0;
    // And it's off like a shot.
    p.brain.runTo(() => this.flying?.pos ?? null, CHASE_SPEED, () => this.tryCatch(p), 0.45);
    this.game.events.emit('buddies:fetch', { pup: p.def.id, phase: 'throw' });
    this.render();
  }

  private stepBall(b: Flying, dt: number): void {
    b.t += dt;
    const n = 4;
    const h = dt / n;
    const ox = this.origin[0];
    const oz = this.origin[2];
    for (let i = 0; i < n; i++) {
      b.vel.y -= G * h;
      // Into anything solid along the way (the rocket pad, the house, the goal posts): bounce off it.
      const d = _v.copy(b.vel).multiplyScalar(h);
      const len = d.length();
      if (len > 1e-6) {
        d.divideScalar(len);
        const hit = this.game.physics.world.castRayAndGetNormal(new RAPIER.Ray(b.pos, d), len + b.r, true, SOLID);
        if (hit && hit.normal.y < 0.6) {
          const nrm = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
          b.pos.addScaledVector(d, Math.max(0, hit.timeOfImpact - b.r));
          const into = b.vel.dot(nrm);
          if (into < 0) b.vel.addScaledVector(nrm, -1.5 * into);
          b.vel.multiplyScalar(0.8);
        } else b.pos.addScaledVector(d, len);
      }
      // The ground (or a tier, a roof...): land, bounce, roll.
      const gy = groundBelow(this.game, b.pos.x, b.pos.z, b.pos.y + 0.3, this.origin[1]);
      if (b.pos.y - b.r <= gy) {
        b.pos.y = gy + b.r;
        if (!b.landed) b.landed = b.pos.clone();
        if (b.vel.y < 0) b.vel.y = b.vel.y < -1.2 ? -b.vel.y * 0.45 : 0;
        const f = Math.max(0, 1 - 2.2 * h);
        b.vel.x *= f;
        b.vel.z *= f;
      }
      // Stays on the park's grass.
      const lx = b.pos.x - ox;
      const lz = b.pos.z - oz;
      if (lx < BOUNDS.x0 || lx > BOUNDS.x1) {
        b.pos.x = ox + THREE.MathUtils.clamp(lx, BOUNDS.x0, BOUNDS.x1);
        b.vel.x *= -0.5;
      }
      if (lz < BOUNDS.z0 || lz > BOUNDS.z1) {
        b.pos.z = oz + THREE.MathUtils.clamp(lz, BOUNDS.z0, BOUNDS.z1);
        b.vel.z *= -0.5;
      }
    }
    const g = b.pup.ball;
    g.position.copy(b.pos);
    // Spins as it flies and rolls.
    g.rotation.x += Math.hypot(b.vel.x, b.vel.z) * dt * 3;
    // Lost somewhere odd: it turns up by its pup.
    if (b.t > 25) {
      const p = b.pup;
      this.flying = null;
      p.ball.children[0].position.y = PUP_BALL_R[p.def.sport] ?? 0.17;
      this.toMouth(p);
      this.bringBack(p);
    }
  }

  private tryCatch(p: PupState): boolean {
    const b = this.flying;
    if (!b || b.pup !== p) return true;
    // Snaps it up once it's low enough to reach.
    const low = b.pos.y - groundBelow(this.game, b.pos.x, b.pos.z, b.pos.y + 0.3, this.origin[1]) < 0.7;
    if (!low || Math.hypot(b.vel.x, b.vel.z) > 6) return false;
    const metres = b.landed ? Math.hypot(b.landed.x - b.from.x, b.landed.z - b.from.z) : Math.hypot(b.pos.x - b.from.x, b.pos.z - b.from.z);
    this.flying = null;
    p.ball.children[0].position.y = PUP_BALL_R[p.def.sport] ?? 0.17;
    this.lastThrow = { pup: p.def.id, metres };
    this.toMouth(p);
    this.game.events.emit('buddies:fetch', { pup: p.def.id, phase: 'catch' });
    this.bringBack(p);
    return true;
  }

  private bringBack(p: PupState): void {
    p.play = 'returning';
    p.t = 0;
    p.brain.runTo(() => this.feet(), RETURN_SPEED, () => {
      const feet = this.feet();
      if (!feet) return false;
      this.fetched(p, feet);
      return true;
    }, 1.5);
  }

  private fetched(p: PupState, feet: THREE.Vector3): void {
    this.fetches++;
    const m = Math.round(this.lastThrow?.metres ?? 0);
    const record = m > this.best;
    if (record) {
      this.best = m;
      try {
        localStorage.setItem(BEST_KEY, String(m));
      } catch {
        /* private window: the best just isn't kept */
      }
    }
    if (this.fetches >= 5) this.game.state.setFlag('buddies.fetch');
    this.offer(p, feet);
    const praise = ['Good dog!', 'Who is a good pup?', 'Again! Again!', 'Fetched!', 'Woof!'][this.fetches % 5];
    this.game.events.emit('notify', { text: `${praise} ${p.def.name} brings the ${p.def.ball} back. ${m} m throw${record ? ' - a new best!' : ''}` });
    this.game.events.emit('buddies:fetch', { pup: p.def.id, phase: 'drop' });
    this.render();
  }

  // The rocket takes everyone; this hands the balls back first.

  /** Called by the rocket before the pups board. */
  boardAll(): void {
    this.putAway();
    for (const p of this.pups) if (p.state === 'home' && p.play !== 'idle') this.toFeet(p);
  }

  update(): void {
    /* the ball moves in preFixedUpdate */
  }

  private updateMeter(): void {
    const cb = this.player()?.get(Combatant);
    const charging = !!cb && !!cb.itemId?.startsWith('pup_') && cb.heldTime > 0 && this.here();
    this.meter.style.display = charging ? 'block' : 'none';
    if (charging) this.meterFill.style.height = `${Math.round(Math.min(1, cb!.heldTime / CHARGE_TIME) * 100)}%`;
  }

  /** The panel's line (the rocket's countdown takes it over). */
  render(override?: string): void {
    const here = this.here();
    this.panel.style.display = here ? 'block' : 'none';
    if (!here) this.meter.style.display = 'none';
    if (override) {
      this.panel.textContent = override;
      return;
    }
    if (this.rocket?.active) return;
    const carrying = this.pups.filter((p) => p.state === 'carried').map((p) => p.def.ball);
    const parts = [`Balls returned: ${this.returned} / ${this.total}`];
    if (carrying.length) parts.push(`Carrying: ${carrying.join(', ')}`);
    if (this.fetches || this.best) parts.push(`Fetches: ${this.fetches}`, `Longest throw: ${this.best} m`);
    this.panel.textContent = parts.join('   ·   ');
  }
}

// --- Space Buddies: the launch -------------------------------------------------------------

export interface RocketParts {
  /** Everything that flies, origin at the pad's top centre. */
  group: THREE.Group;
  flame: THREE.Mesh;
  /** A pup's face at the porthole, shown while they're aboard. */
  face: THREE.Object3D;
  base: THREE.Vector3;
}

type RocketPhase = 'ready' | 'board' | 'count' | 'lift' | 'space' | 'land';

interface Puff {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  max: number;
  grow: number;
}

/**
 * The big red button: once every pup has its ball, they run aboard, the
 * countdown runs from ten, and the rocket lifts off in smoke and flame, goes
 * out of sight, and comes back down to land on its pad, pups and all.
 */
export class RocketShow {
  phase: RocketPhase = 'ready';
  t = 0;
  /** Count shown (10 .. 1). */
  count = 10;
  launches = 0;
  /** Height above the pad (checks). */
  height = 0;
  private boarded = new Set<string>();
  private puffs: Puff[] = [];
  private puffMat: THREE.MeshStandardMaterial;

  constructor(
    private game: Game,
    private quest: BallQuest,
    private parts: RocketParts,
  ) {
    this.puffMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 1, transparent: true, opacity: 0.6, depthWrite: false });
    const geo = new THREE.SphereGeometry(1, 10, 8);
    for (let i = 0; i < 48; i++) {
      const mesh = new THREE.Mesh(geo, this.puffMat.clone());
      mesh.visible = false;
      game.renderer.scene.add(mesh);
      this.puffs.push({ mesh, vel: new THREE.Vector3(), life: 0, max: 1, grow: 1 });
    }
    parts.flame.visible = false;
    parts.face.visible = false;
  }

  get active(): boolean {
    return this.phase !== 'ready';
  }

  prompt(): string {
    if (this.active) return 'Launch in progress!';
    return this.quest.returned < this.quest.total ? `Launch the rocket (${this.quest.returned} / ${this.quest.total} balls found)` : 'LAUNCH THE ROCKET!';
  }

  press(): void {
    if (this.active) return;
    if (this.quest.returned < this.quest.total) {
      this.game.events.emit('notify', { text: `The pups won't go to space without their balls. ${this.quest.total - this.quest.returned} still to find!` });
      return;
    }
    this.quest.boardAll();
    this.boarded.clear();
    this.phase = 'board';
    this.t = 0;
    this.game.events.emit('notify', { text: 'All aboard! The Buddies are going to SPACE!' });
    this.game.events.emit('buddies:rocket', { phase: 'board' });
    const base = this.parts.base;
    this.quest.pups.forEach((p, i) => {
      // Each runs to the foot of the rocket, then hops in.
      const a = Math.PI + (i - 2) * 0.35;
      const door = new THREE.Vector3(base.x + Math.cos(a) * 2.2, base.y, base.z + Math.sin(a) * 2.2);
      p.brain.runTo(() => door, 6.5, () => {
        this.board(p.dog);
        return true;
      }, 0.3);
    });
  }

  private board(dog: Entity): void {
    dog.object3d.visible = false;
    this.boarded.add(dog.name);
    this.game.events.emit('buddies:fetch', { pup: dog.name, phase: 'board' });
  }

  tick(dt: number): void {
    this.tickPuffs(dt);
    if (this.phase === 'ready') return;
    this.t += dt;
    const g = this.parts.group;
    const base = this.parts.base;
    switch (this.phase) {
      case 'board': {
        // Stragglers get a lift.
        if (this.t > 9) for (const p of this.quest.pups) if (!this.boarded.has(p.dog.name)) this.board(p.dog);
        if (this.boarded.size >= this.quest.pups.length) {
          this.parts.face.visible = true;
          this.phase = 'count';
          this.t = 0;
          this.count = 10;
          this.say();
        }
        return;
      }
      case 'count': {
        const n = 10 - Math.floor(this.t);
        if (n !== this.count && n > 0) {
          this.count = n;
          this.say();
        }
        // Venting smoke for the last few seconds.
        if (n <= 3 && Math.random() < 0.5) this.puff(base, 2.5, 1.5);
        if (this.t >= 10) {
          this.phase = 'lift';
          this.t = 0;
          this.parts.flame.visible = true;
          this.quest.render('LIFTOFF!');
          this.game.events.emit('buddies:rocket', { phase: 'liftoff' });
        }
        return;
      }
      case 'lift': {
        const u = Math.max(0, this.t - 0.8);
        this.height = 1.8 * u * u;
        g.position.y = base.y + this.height;
        g.position.x = base.x + (this.t < 1 ? (Math.random() - 0.5) * 0.06 : 0);
        this.flicker(1.2 + Math.min(1.5, u * 0.5));
        if (Math.random() < 0.7) this.puff(new THREE.Vector3(base.x, base.y + Math.max(0, this.height - 1), base.z), 1.2, this.height < 4 ? 2.2 : 1);
        if (this.height > 170) {
          this.phase = 'space';
          this.t = 0;
          g.visible = false;
          this.parts.flame.visible = false;
          this.quest.render('The Buddies are in space!');
          this.game.events.emit('notify', { text: 'The Buddies are in SPACE! One small step for dog...' });
        }
        return;
      }
      case 'space': {
        if (this.t > 5) {
          this.phase = 'land';
          this.t = 0;
          g.visible = true;
          this.parts.flame.visible = true;
          this.quest.render('Here they come!');
          this.game.events.emit('buddies:rocket', { phase: 'descent' });
        }
        return;
      }
      case 'land': {
        const T = 10;
        const u = Math.min(1, this.t / T);
        this.height = 140 * (1 - u) * (1 - u);
        g.position.set(base.x, base.y + this.height, base.z);
        this.flicker(0.8 + 0.6 * (1 - u));
        if (this.height < 12 && Math.random() < 0.6) this.puff(new THREE.Vector3(base.x, base.y, base.z), 1.5, 2.5);
        if (u >= 1) this.landed();
        return;
      }
    }
  }

  private landed(): void {
    const base = this.parts.base;
    this.phase = 'ready';
    this.height = 0;
    this.launches++;
    this.parts.flame.visible = false;
    this.parts.face.visible = false;
    this.parts.group.position.copy(base);
    for (let k = 0; k < 14; k++) this.puff(base, 3, 3);
    // Everyone hops out and runs off to play.
    this.quest.pups.forEach((p, i) => {
      const a = Math.PI + (i - 2) * 0.5;
      p.brain.place(new THREE.Vector3(base.x + Math.cos(a) * 2.4, base.y - 0.3, base.z + Math.sin(a) * 2.4));
      p.dog.object3d.visible = true;
      p.brain.resume();
    });
    this.game.state.setFlag('buddies.space');
    this.game.events.emit('notify', { text: 'Touchdown! The Buddies are back from space. Happy 40th, Gene!' });
    this.game.events.emit('buddies:rocket', { phase: 'landed' });
    this.quest.render();
  }

  private say(): void {
    this.quest.render(`T-minus ${this.count}`);
    this.game.events.emit('buddies:rocket', { phase: 'count', n: this.count });
  }

  private flicker(len: number): void {
    const f = this.parts.flame;
    const k = 0.85 + Math.random() * 0.3;
    f.scale.set(k, len * (0.9 + Math.random() * 0.2), k);
  }

  private puff(at: THREE.Vector3, spread: number, size: number): void {
    const p = this.puffs.find((q) => q.life <= 0);
    if (!p) return;
    const a = Math.random() * Math.PI * 2;
    p.mesh.position.set(at.x + Math.cos(a) * spread * Math.random(), at.y + 0.3, at.z + Math.sin(a) * spread * Math.random());
    p.vel.set(Math.cos(a) * 3, 0.6 + Math.random(), Math.sin(a) * 3);
    p.max = p.life = 1.6 + Math.random();
    p.grow = size;
    p.mesh.scale.setScalar(0.3 * size);
    p.mesh.visible = true;
  }

  private tickPuffs(dt: number): void {
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      const k = 1 - p.life / p.max;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(1 - dt * 1.2);
      p.mesh.scale.setScalar((0.3 + k) * p.grow);
      (p.mesh.material as THREE.MeshStandardMaterial).opacity = 0.6 * (1 - k);
      if (p.life <= 0) p.mesh.visible = false;
    }
  }
}

// --- Spooky Buddies: the ghost -------------------------------------------------------------

/**
 * The spooky house's ghost floats in its corner until you step inside, then
 * swoops right up to your face: BOO! It goes back to its corner and waits for
 * you to leave and come back.
 */
export class SpookyGhost {
  phase: 'idle' | 'swoop' | 'hold' | 'back' = 'idle';
  t = 0;
  boos = 0;
  private armed = true;
  private clock = 0;
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();

  constructor(
    private game: Game,
    private ghost: THREE.Object3D,
    private home: THREE.Vector3,
    /** The house's floor, centre and half-size. */
    private centre: THREE.Vector3,
    private half: number,
  ) {}

  tick(dt: number): void {
    this.clock += dt;
    this.t += dt;
    const g = this.ghost;
    const mat = (g.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const player = this.game.world.find('player')?.get(PlayerController);
    const f = player?.feetPosition;
    const inside = !!f && Math.abs(f.x - this.centre.x) < this.half && Math.abs(f.z - this.centre.z) < this.half && f.y - this.centre.y < 2;
    if (!inside && this.phase === 'idle') this.armed = true;
    switch (this.phase) {
      case 'idle': {
        g.position.set(this.home.x, this.home.y + Math.sin(this.clock * 1.6) * 0.15, this.home.z);
        g.rotation.y = Math.sin(this.clock * 0.7) * 0.6;
        g.scale.setScalar(1);
        mat.opacity = 0.55 + 0.15 * Math.sin(this.clock * 2.3);
        if (inside && this.armed) {
          this.armed = false;
          this.phase = 'swoop';
          this.t = 0;
          this.from.copy(g.position);
          this.boos++;
          this.game.events.emit('buddies:boo', {});
        }
        return;
      }
      case 'swoop': {
        // Right up to your face.
        const cam = this.game.renderer.camera;
        const eye = cam.getWorldPosition(_v);
        const look = cam.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
        this.to.copy(eye).addScaledVector(look, 1.5).add(new THREE.Vector3(0, -0.45, 0));
        const u = Math.min(1, this.t / 0.4);
        const e = 1 - (1 - u) * (1 - u);
        g.position.lerpVectors(this.from, this.to, e);
        g.lookAt(eye.x, g.position.y, eye.z);
        g.scale.setScalar(1 + 0.2 * e);
        mat.opacity = 0.85;
        if (u >= 1) {
          this.phase = 'hold';
          this.t = 0;
          this.game.events.emit('notify', { text: 'BOO!' });
        }
        return;
      }
      case 'hold': {
        g.position.y = this.to.y + Math.sin(this.t * 30) * 0.03;
        g.rotation.z = Math.sin(this.t * 18) * 0.15;
        if (this.t > 0.8) {
          this.phase = 'back';
          this.t = 0;
          this.from.copy(g.position);
          g.rotation.z = 0;
          this.game.events.emit('notify', { text: 'Hee hee! Sorry. The volleyball? I was just keeping it warm.' });
        }
        return;
      }
      case 'back': {
        const u = Math.min(1, this.t / 1.6);
        g.position.lerpVectors(this.from, this.home, u * u * (3 - 2 * u));
        g.scale.setScalar(1.2 - 0.2 * u);
        mat.opacity = 0.85 - 0.25 * u;
        if (u >= 1) {
          this.phase = 'idle';
          this.t = 0;
        }
        return;
      }
    }
  }
}

declare module '@ingine/engine/core/EventBus' {
  interface GameEvents {
    'buddies:ball': { pup: string; state: 'carried' | 'home' };
    'buddies:fetch': { pup: string; phase: 'throw' | 'catch' | 'drop' | 'board' };
    'buddies:rocket': { phase: 'board' | 'count' | 'liftoff' | 'descent' | 'landed'; n?: number };
    'buddies:boo': Record<string, never>;
  }
}
