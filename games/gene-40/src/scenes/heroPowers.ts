import * as THREE from 'three';
import type { Game } from '@ingine/engine/core/Game';
import type { System } from '@ingine/engine/core/System';
import { Entity } from '@ingine/engine/entities/Entity';
import { RAPIER } from '@ingine/engine/physics/PhysicsWorld';
import { RigidBodyComponent } from '@ingine/engine/physics/RigidBodyComponent';
import { PlayerController } from '@ingine/engine/gameplay/player/PlayerController';
import { PlayerCombat } from '@ingine/engine/combat/PlayerCombat';
import { PlayerConfig } from '@ingine/engine/config/player';
import type { AudioSystem } from '@ingine/engine/audio/AudioSystem';
import type { Vec3 } from '../scenes';
import { catModel } from './murph';
import { label, mat } from './kit';

/**
 * Hero city's powers. You arrive with the hero suit (a big jump and a fast
 * run) and earn three powers, one after another, each from a station the
 * last power gets you to:
 *
 *  - Swing (plaza): hold right mouse (or G) to shoot a line at a building
 *    and swing from it. Let go to fly off with your speed.
 *  - Flight (a rooftop): press Space in the air to fly where you look.
 *    W to go, Shift to boost, dive to go faster. C slams you into the ground.
 *  - Super strength (the top of Hero HQ): click (or E) a car to lift it
 *    over your head, click again to throw it.
 *
 * It runs before the player controller each fixed step, so it shapes the
 * controller's velocity and tuning rather than replacing its movement.
 * Powers only work in Hero city.
 */

export type PowerId = 'swing' | 'fly' | 'strength';

export const POWERS: { id: PowerId; name: string; hint: string; color: number }[] = [
  { id: 'swing', name: 'SWING', hint: 'Hold right mouse or G', color: 0xff5c8a },
  { id: 'fly', name: 'FLIGHT', hint: 'Space in the air, then look where you want to go. C in the air slams you down', color: 0x4fb3ff },
  { id: 'strength', name: 'SUPER STRENGTH', hint: 'Click a car to lift it, click again to throw', color: 0x3fd17a },
];

/** The city's to-do list (heroEmergencies.ts): which power you may take now, and what to do next. */
export interface Mission {
  allows(id: PowerId): boolean;
  /** One line: what to do next. */
  next(): string;
  progress(): { done: number; total: number };
}

export interface Station {
  id: PowerId;
  /** Centre of the station, at its base. */
  pos: THREE.Vector3;
  orb: THREE.Mesh;
  /** A tall beam of light above the station that's next to collect. */
  beacon: THREE.Mesh;
}

/** Something super strength can lift: a parked car, a bin. */
export interface Throwable {
  entity: Entity;
  kind: 'car' | 'bin';
  /** Half its size, for holding it over your head. */
  half: THREE.Vector3;
}

const KITTEN_FUR = [0xf4f1ea, 0x9a9aa2, 0xd9b48a, 0x2b2b30, 0xe08a3c, 0xc9c3b8, 0x7a5536, 0xf0d9a8];

/** Swing and flight tuning (m, m/s, m/s^2). */
const SWING = { range: 90, reel: 2.5, pump: 12, maxSpeed: 40, hop: 3, gravity: 42, pull: 16 };
const FLY = { cruise: 17, boost: 34, dive: 40, strafe: 9, climb: 9, response: 2.6 };
const SLAM = { speed: 48, radius: 13 };
const THROW = { speed: 34, reach: 7 };

export class HeroPowers implements System {
  readonly name = 'hero-powers';
  private game!: Game;
  private ready = false;
  readonly owned = new Set<PowerId>();
  readonly throwables: Throwable[] = [];
  /** Cats rescued so far (they wait in the basket). */
  saved = 0;
  mission: Mission | null = null;
  private basket: Vec3 = [0, 0, 0];
  private panel!: HTMLDivElement;
  private lines!: HTMLCanvasElement;
  private keyG = false;
  private grabKey = false;

  /** The swing line: where it's hooked and how long it is. */
  swing: { anchor: THREE.Vector3; len: number; t: number } | null = null;
  private swingWasHeld = false;
  flying = false;
  slamming = false;
  held: Throwable | null = null;
  /** Counters for the checks. */
  swings = 0;
  throws = 0;
  slams = 0;
  topSpeed = 0;

  // Feel.
  private speed = 0;
  private roll = 0;
  private shake = 0;
  private rope!: THREE.Mesh;
  private hook!: THREE.Mesh;
  private rings: { mesh: THREE.Mesh; t: number }[] = [];
  private wind: { gain: GainNode; src: AudioBufferSourceNode } | null = null;

  constructor(readonly stations: Station[]) {}

  init(game: Game): void {
    if (this.ready) return;
    this.ready = true;
    this.game = game;
    this.panel = document.createElement('div');
    this.panel.classList.add('gene-panel');
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
    const app = document.getElementById('app');
    app?.appendChild(this.panel);
    // Speed lines: streaks from the edges of the screen when you're going fast.
    this.lines = document.createElement('canvas');
    Object.assign(this.lines.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '2', opacity: '0' });
    app?.appendChild(this.lines);

    // Raw keys, like H in Teleports (the engine's action table is closed). F is taken by fullscreen.
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    };
    window.addEventListener('keydown', (e) => {
      if (e.repeat || typing(e)) return;
      if (e.code === 'KeyG') this.keyG = true;
      if (e.code === 'KeyE') this.grabKey = true;
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyG') this.keyG = false;
    });
    window.addEventListener('blur', () => (this.keyG = false));
    game.events.on('teleport', () => this.reset());
    game.events.on('player:landed', ({ fallSpeed }) => this.landed(fallSpeed));

    const ropeMat = mat(0xff5c8a, { emissive: 0xff5c8a, emissiveIntensity: 0.6 });
    this.rope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 6).translate(0, 0.5, 0), ropeMat);
    this.rope.frustumCulled = false;
    this.hook = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), ropeMat);
    this.rope.visible = this.hook.visible = false;
    game.renderer.scene.add(this.rope, this.hook);
  }

  // --- Building blocks the scene hands us ------------------------------------------

  setBasket(p: Vec3): void {
    this.basket = p;
    const [x, y, z] = p;
    const wicker = mat(0xb5874e, { roughness: 1 });
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.3, 0.8, 24, 1, true), wicker);
    shell.material.side = THREE.DoubleSide;
    shell.position.set(x, y + 0.4, z);
    shell.castShadow = true;
    this.game.world.spawn(new Entity('kitten-basket', shell));
    const cushion = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.1, 24), mat(0xe8c7d8, { roughness: 1 }));
    cushion.position.set(x, y + 0.05, z);
    this.game.renderer.scene.add(cushion);
    label(this.game, 'Rescued cats', [x, y + 2.1, z], 0.8);
  }

  /** A rescued cat goes to wait in the basket on the plaza. */
  addToBasket(fur?: number): void {
    const n = this.saved++;
    const { root } = catModel({ fur: fur ?? KITTEN_FUR[n % KITTEN_FUR.length], s: 0.9, sitting: true });
    const g = new THREE.Group();
    const a = n * 1.3;
    const r = n === 0 ? 0 : 0.85;
    g.position.set(this.basket[0] + Math.cos(a) * r, this.basket[1] + 0.1, this.basket[2] + Math.sin(a) * r);
    g.rotation.y = -a;
    g.add(root);
    const e = new Entity('rescued-cat', g);
    e.tags.add('kitten');
    this.game.world.spawn(e);
    this.render();
  }

  addThrowable(t: Throwable): void {
    this.throwables.push(t);
  }

  /** The next power to collect, if any. */
  get nextPower(): PowerId | null {
    return POWERS.find((p) => !this.owned.has(p.id))?.id ?? null;
  }

  // --- Helpers ---------------------------------------------------------------------

  private player(): PlayerController | undefined {
    return this.game.world.find('player')?.get(PlayerController);
  }

  private here(): boolean {
    return (this.game.getSystem('teleports') as { current?: string } | undefined)?.current === 'heroes';
  }

  private emit(name: 'heroes:swing' | 'heroes:fly' | 'heroes:lift' | 'heroes:throw', on = true): void {
    this.game.events.emit(name, { on });
  }

  /** Grant a power (also used by the checks). */
  grant(id: PowerId): void {
    if (this.owned.has(id)) return;
    this.owned.add(id);
    const p = POWERS.find((q) => q.id === id)!;
    this.game.events.emit('notify', { text: `${p.name}! ${p.hint}.` });
    this.game.events.emit('heroes:power', { power: id });
    this.refreshStations();
    this.render();
  }

  /** Can you take this power now? (The next one, once the city's emergencies before it are handled.) */
  canTake(id: PowerId): boolean {
    return id === this.nextPower && (this.mission?.allows(id) ?? true);
  }

  /** Light the beam over the one station you're meant to go to now, if any. */
  refreshStations(): void {
    for (const st of this.stations) {
      const has = this.owned.has(st.id);
      (st.orb.material as THREE.MeshStandardMaterial).emissiveIntensity = has ? 0.25 : this.canTake(st.id) ? 1.4 : 0.6;
      st.beacon.visible = this.canTake(st.id);
    }
  }

  /** Leaving or arriving: let go of everything and set the controller back. */
  private reset(): void {
    if (this.held) this.drop(new THREE.Vector3());
    this.swing = null;
    this.flying = false;
    this.slamming = false;
    const ctrl = this.player();
    if (ctrl) {
      ctrl.fovScale = 1;
      // Fists and weapons are for the other worlds: here a click is for cars.
      const pc = ctrl.entity.get(PlayerCombat);
      if (pc) pc.enabled = !this.here();
    }
    this.tune();
    this.refreshStations();
    this.render();
  }

  /** The controller's tuning for where you are and what you're doing. */
  private tune(): void {
    const ctrl = this.player();
    if (!ctrl) return;
    const c = ctrl.cfg;
    c.jumpHeight = PlayerConfig.jumpHeight;
    c.sprintSpeed = PlayerConfig.sprintSpeed;
    c.walkSpeed = PlayerConfig.walkSpeed;
    c.airAccel = PlayerConfig.airAccel;
    c.airMaxSpeedFactor = PlayerConfig.airMaxSpeedFactor;
    c.gravity = PlayerConfig.gravity;
    if (!this.here()) return;
    // The hero suit: a big jump and a fast run, from the moment you arrive.
    c.jumpHeight = 8;
    c.walkSpeed = 6;
    c.sprintSpeed = 12;
    c.airAccel = 16;
    c.airMaxSpeedFactor = 1.3;
    if (this.swing) {
      // Heavier on the line: snappier arcs.
      c.airAccel = 7;
      c.gravity = SWING.gravity;
    }
    if (this.flying) {
      c.gravity = 0;
      c.airAccel = 0;
    }
  }

  // --- The fixed step ------------------------------------------------------------------

  preFixedUpdate(dt: number): void {
    const grabKey = this.grabKey;
    this.grabKey = false;
    const ctrl = this.player();
    if (!ctrl || !this.here()) {
      this.swingWasHeld = false;
      return;
    }
    // (Only take the click here: other worlds' bats and balls need it.)
    const grab = this.game.input.wasPressed('attack') || grabKey;
    const feet = ctrl.entity.object3d.position;
    const v = ctrl.velocity;
    const input = this.game.input;

    // Stations: walk up to the one you're sent to, to take its power.
    for (const st of this.stations) {
      if (this.canTake(st.id) && Math.hypot(feet.x - st.pos.x, feet.z - st.pos.z) < 1.5 && Math.abs(feet.y - st.pos.y) < 2.5) this.grant(st.id);
    }

    // Swing: hold to hook, let go to fly off.
    const held = (this.keyG || input.isDown('altAttack')) && this.owned.has('swing');
    if (held && !this.swingWasHeld && !this.swing) this.attach(ctrl);
    if (!held && this.swing) this.release(ctrl);
    this.swingWasHeld = held;
    if (this.swing) this.swingStep(ctrl, dt);

    // Flight: Space in the air takes off; touching down lands.
    if (this.owned.has('fly')) {
      if (!this.flying && !ctrl.grounded && !this.swing && !this.slamming && ctrl.timeInAir > 0.15 && input.peekPressed('jump') && input.wasPressed('jump')) this.takeOff(ctrl);
      if (!this.slamming && !ctrl.grounded && ctrl.timeInAir > 0.1 && input.wasPressed('crouch')) this.startSlam(ctrl);
      if (this.flying) this.flyStep(ctrl, dt);
      if (this.slamming) {
        v.set(v.x * 0.9, -SLAM.speed, v.z * 0.9);
        if (ctrl.grounded) this.slamming = false;
      }
    }

    // Super strength: lift, carry over your head, throw.
    if (this.owned.has('strength') && grab) {
      if (this.held) this.throwHeld(ctrl);
      else this.lift(ctrl);
    }
    if (this.held) this.carry(ctrl);

    this.tune();
    this.topSpeed = Math.max(this.topSpeed, v.length());
  }

  // --- Swing ---------------------------------------------------------------------------

  /** Where a swing line would hook from here: what you aim at if it's well above you, else a wall ahead and up (aim assist), else whatever you aimed at. */
  findAnchor(ctrl: PlayerController): THREE.Vector3 | null {
    const cam = this.game.renderer.camera;
    cam.updateMatrixWorld();
    cam.getWorldPosition(_eye);
    cam.getWorldDirection(_dir);
    const feetY = ctrl.entity.object3d.position.y;
    const hit = this.cast(ctrl, _eye, _dir, SWING.range);
    const aimed = hit && hit.y > feetY + 2.5 && hit.distanceTo(_eye) > 3 ? hit : null;
    // Up high where you aim makes a good swing: take it.
    if (aimed && aimed.y > feetY + 10) return aimed;
    // Aim assist: up and ahead, then a little either side.
    let best: THREE.Vector3 | null = null;
    let bestScore = -Infinity;
    for (const yawOff of [0, -0.35, 0.35, -0.7, 0.7])
      for (const pitch of [0.75, 0.5, 1.0]) {
        const yaw = ctrl.yaw + yawOff;
        _ray.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
        const hit = this.cast(ctrl, _eye, _ray, SWING.range);
        if (!hit || hit.y < feetY + 4) continue;
        const d = hit.distanceTo(_eye);
        // Prefer straight ahead and a good long line.
        const score = Math.min(d, 45) - Math.abs(yawOff) * 25;
        if (score > bestScore) {
          bestScore = score;
          best = hit;
        }
      }
    return best ?? aimed;
  }

  private cast(ctrl: PlayerController, from: THREE.Vector3, dir: THREE.Vector3, range: number): THREE.Vector3 | null {
    const body = ctrl.entity.get(RigidBodyComponent)?.body;
    const ray = new RAPIER.Ray({ x: from.x, y: from.y, z: from.z }, { x: dir.x, y: dir.y, z: dir.z });
    const hit = this.game.physics.world.castRay(ray, range, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS | RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC, undefined, undefined, body);
    return hit ? from.clone().addScaledVector(dir, hit.timeOfImpact) : null;
  }

  private attach(ctrl: PlayerController): void {
    const anchor = this.findAnchor(ctrl);
    if (!anchor) {
      this.game.events.emit('notify', { text: 'Nothing to swing from. Get near the buildings.' });
      return;
    }
    this.swingFrom(ctrl, anchor);
  }

  /** Hook a point and start swinging. Public for the checks. */
  swingFrom(ctrl: PlayerController, anchor: THREE.Vector3): void {
    const chest = _chest.copy(ctrl.entity.object3d.position).setY(ctrl.entity.object3d.position.y + 1.2);
    const dist = chest.distanceTo(anchor);
    // Short enough that the bottom of the arc clears the street: a long line yanks you up into it.
    const len = Math.min(dist * 0.9, (anchor.y - ctrl.entity.object3d.position.y) * 0.8);
    this.swing = { anchor: anchor.clone(), len: Math.max(4, len), t: 0 };
    this.flying = false;
    this.slamming = false;
    const v = ctrl.velocity;
    // Off the ground with a hop and a tug towards the line.
    if (ctrl.grounded) v.y = Math.max(v.y, 9);
    _to.subVectors(anchor, chest).setY(0);
    if (_to.lengthSq() > 1) v.addScaledVector(_to.normalize(), 5);
    this.swings++;
    this.emit('heroes:swing', true);
  }

  private swingStep(ctrl: PlayerController, dt: number): void {
    const s = this.swing!;
    s.t += dt;
    const v = ctrl.velocity;
    const chest = _chest.copy(ctrl.entity.object3d.position);
    chest.y += 1.2;
    const d = _to.subVectors(chest, s.anchor);
    const dist = d.length();
    const n = d.divideScalar(dist);
    // Swung up level with the hook (or past it): let go and sail on.
    if (chest.y > s.anchor.y - 1 && s.t > 0.3) {
      this.release(ctrl);
      return;
    }
    s.len = Math.max(4, s.len - SWING.reel * dt);
    if (dist > s.len) {
      // The line is taut: no moving away from the hook, and pull back to its length.
      // (Radial speed: never outwards, and inwards just enough to close the gap.)
      const radial = v.dot(n);
      const want = -Math.min((dist - s.len) * 5, SWING.pull);
      if (radial > want) v.addScaledVector(n, want - radial);
      // Pump: a push along the arc, so every swing gains speed.
      _t.copy(v).addScaledVector(n, -v.dot(n));
      if (_t.lengthSq() > 1) v.addScaledVector(_t.normalize(), SWING.pump * dt);
    }
    const sp = v.length();
    if (sp > SWING.maxSpeed) v.multiplyScalar(SWING.maxSpeed / sp);
  }

  private release(ctrl: PlayerController): void {
    if (!this.swing) return;
    this.swing = null;
    const v = ctrl.velocity;
    v.y += SWING.hop;
    _to.set(v.x, 0, v.z);
    if (_to.lengthSq() > 1) v.addScaledVector(_to.normalize(), 2);
    this.emit('heroes:swing', false);
  }

  // --- Flight ------------------------------------------------------------------------

  private takeOff(ctrl: PlayerController): void {
    this.flying = true;
    ctrl.velocity.y = Math.max(ctrl.velocity.y, 3);
    this.emit('heroes:fly', true);
  }

  /** Start flying (for the checks). */
  fly(): void {
    const ctrl = this.player();
    if (ctrl && this.owned.has('fly')) this.takeOff(ctrl);
  }

  private flyStep(ctrl: PlayerController, dt: number): void {
    const input = this.game.input;
    const v = ctrl.velocity;
    const axis = input.moveAxis();
    const fwd = _dir.set(-Math.sin(ctrl.yaw) * Math.cos(ctrl.pitch), Math.sin(ctrl.pitch), -Math.cos(ctrl.yaw) * Math.cos(ctrl.pitch));
    const right = _ray.set(Math.cos(ctrl.yaw), 0, -Math.sin(ctrl.yaw));
    let speed = 0;
    if (axis.y > 0) {
      speed = (input.isDown('sprint') ? FLY.boost : FLY.cruise) * axis.y;
      // Diving: the steeper, the faster.
      if (fwd.y < -0.15) speed += -fwd.y * FLY.dive;
    } else if (axis.y < 0) speed = -5;
    _t.copy(fwd).multiplyScalar(speed).addScaledVector(right, axis.x * FLY.strafe);
    if (input.isDown('jump')) _t.y += FLY.climb;
    // Momentum: you lean into a turn rather than snapping to it.
    v.lerp(_t, 1 - Math.exp(-dt * FLY.response));
  }

  private landed(fallSpeed: number): void {
    if (!this.here()) return;
    const ctrl = this.player();
    const fast = this.flying && ctrl && ctrl.velocity.length() > 22;
    if (this.slamming || fast || (this.owned.has('fly') && fallSpeed > 40)) this.slam(Math.min(1, Math.max(0.5, fallSpeed / SLAM.speed)));
    if (this.flying) this.emit('heroes:fly', false);
    this.flying = false;
    this.slamming = false;
  }

  private startSlam(ctrl: PlayerController): void {
    this.flying = false;
    this.slamming = true;
    if (this.swing) this.release(ctrl);
    ctrl.velocity.y = -SLAM.speed;
  }

  /** The ground slam: a shockwave that throws cars and bins around. Public for the checks. */
  /** Shake the camera (a stomp nearby, thunder overhead). */
  quake(k: number): void {
    this.shake = Math.max(this.shake, k);
  }

  slam(strength = 1): void {
    const ctrl = this.player();
    if (!ctrl) return;
    const feet = ctrl.entity.object3d.position;
    this.slams++;
    this.shake = Math.max(this.shake, 0.5 + 0.5 * strength);
    for (const t of this.throwables) {
      if (t === this.held) continue;
      const body = t.entity.get(RigidBodyComponent)?.body;
      if (!body) continue;
      const p = body.translation();
      const dx = p.x - feet.x;
      const dz = p.z - feet.z;
      const dist = Math.hypot(dx, dz);
      if (dist > SLAM.radius || Math.abs(p.y - feet.y) > 4) continue;
      const f = (1 - dist / SLAM.radius) * strength;
      const m = body.mass();
      const k = dist > 0.1 ? 1 / dist : 0;
      body.applyImpulse({ x: dx * k * 12 * f * m, y: (6 + 8 * f) * m, z: dz * k * 12 * f * m }, true);
      body.applyTorqueImpulse({ x: (Math.random() - 0.5) * m * 3 * f, y: 0, z: (Math.random() - 0.5) * m * 3 * f }, true);
    }
    // A ring of dust racing out.
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.18, 6, 40).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.8, depthWrite: false }));
    ring.position.set(feet.x, feet.y + 0.2, feet.z);
    this.game.renderer.scene.add(ring);
    this.rings.push({ mesh: ring, t: 0 });
    this.game.events.emit('heroes:slam', { strength });
  }

  // --- Super strength ------------------------------------------------------------------

  /** What you're looking at that you could lift, if anything. */
  lookingAt(ctrl: PlayerController): Throwable | null {
    const cam = this.game.renderer.camera;
    cam.getWorldPosition(_eye);
    cam.getWorldDirection(_dir);
    const body = ctrl.entity.get(RigidBodyComponent)?.body;
    const ray = new RAPIER.Ray({ x: _eye.x, y: _eye.y, z: _eye.z }, { x: _dir.x, y: _dir.y, z: _dir.z });
    const hit = this.game.physics.world.castRay(ray, THROW.reach, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, body);
    const owner = hit ? this.game.physics.ownerOf(hit.collider) : undefined;
    return (owner && this.throwables.find((t) => t.entity === owner)) || null;
  }

  private lift(ctrl: PlayerController): void {
    const t = this.lookingAt(ctrl);
    if (t) this.pickUp(t);
  }

  /** Lift something over your head. Public for the checks. */
  pickUp(t: Throwable): void {
    const rb = t.entity.get(RigidBodyComponent);
    if (!rb) return;
    rb.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    for (const c of rb.colliders) c.setSensor(true);
    this.held = t;
    this.emit('heroes:lift', true);
    this.render();
  }

  private carry(ctrl: PlayerController): void {
    const rb = this.held!.entity.get(RigidBodyComponent)!;
    const feet = ctrl.entity.object3d.position;
    const fx = -Math.sin(ctrl.yaw);
    const fz = -Math.cos(ctrl.yaw);
    // Over your head, a little in front, long side across your shoulders.
    rb.body.setNextKinematicTranslation({ x: feet.x + fx * 1.8, y: feet.y + 3.0 + this.held!.half.y, z: feet.z + fz * 1.8 });
    _q.setFromEuler(_euler.set(0, ctrl.yaw, 0));
    rb.body.setNextKinematicRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
  }

  private throwHeld(ctrl: PlayerController): void {
    const cam = this.game.renderer.camera;
    cam.getWorldDirection(_dir);
    const v = _t.copy(_dir).multiplyScalar(THROW.speed);
    v.y += 4;
    v.add(ctrl.velocity);
    this.drop(v);
    this.throws++;
    this.emit('heroes:throw', true);
  }

  private drop(velocity: THREE.Vector3): void {
    const t = this.held;
    if (!t) return;
    this.held = null;
    const rb = t.entity.get(RigidBodyComponent);
    if (rb) {
      rb.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      for (const c of rb.colliders) c.setSensor(false);
      rb.body.setLinvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);
      rb.body.setAngvel({ x: (Math.random() - 0.5) * 3, y: (Math.random() - 0.5) * 2, z: (Math.random() - 0.5) * 3 }, true);
    }
    this.render();
  }

  // --- Each frame: the line, the camera, speed lines, wind -------------------------------------

  update(time: { delta: number }): void {
    const dt = Math.min(time.delta, 0.1);
    const ctrl = this.player();
    const here = this.here() && !!ctrl;
    const cam = this.game.renderer.camera;

    // The swing line, from your hand to the hook.
    const s = this.swing;
    this.rope.visible = this.hook.visible = here && !!s;
    if (s) {
      cam.getWorldPosition(_eye);
      cam.getWorldDirection(_dir);
      const right = _to.set(-_dir.z, 0, _dir.x).normalize();
      const hand = _eye.addScaledVector(_dir, 0.9).addScaledVector(right, 0.35).setY(_eye.y - 0.45);
      const along = _t.subVectors(s.anchor, hand);
      this.rope.position.copy(hand);
      this.rope.scale.set(1, along.length(), 1);
      this.rope.quaternion.setFromUnitVectors(_up, along.normalize());
      this.hook.position.copy(s.anchor);
    }

    // Slam rings.
    for (const r of this.rings) {
      r.t += dt;
      const k = r.t / 0.6;
      r.mesh.scale.setScalar(1 + k * SLAM.radius);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.8 * (1 - k));
    }
    for (const r of this.rings.filter((q) => q.t > 0.6)) {
      this.game.renderer.scene.remove(r.mesh);
      r.mesh.geometry.dispose();
    }
    this.rings = this.rings.filter((q) => q.t <= 0.6);

    const v = ctrl?.velocity;
    const sp = here && v ? v.length() : 0;
    this.speed += (sp - this.speed) * (1 - Math.exp(-dt * 6));

    if (here && ctrl && v) {
      // Wider view the faster you go.
      ctrl.fovScale = 1 + Math.min(0.32, Math.max(0, (this.speed - 10) / 70));
      // Bank into turns while swinging or flying.
      const airborne = !!s || this.flying;
      const rightX = Math.cos(ctrl.yaw);
      const rightZ = -Math.sin(ctrl.yaw);
      const side = v.x * rightX + v.z * rightZ;
      const target = airborne ? Math.max(-0.28, Math.min(0.28, -side / 50)) : 0;
      this.roll += (target - this.roll) * (1 - Math.exp(-dt * 5));
      if (Math.abs(this.roll) > 1e-4) cam.rotateZ(this.roll);
      if (this.shake > 0.01) {
        const a = this.shake * 0.35;
        cam.position.x += (Math.random() - 0.5) * a;
        cam.position.y += (Math.random() - 0.5) * a;
        cam.position.z += (Math.random() - 0.5) * a;
        cam.rotateZ((Math.random() - 0.5) * this.shake * 0.04);
      }
    } else this.roll = 0;
    this.shake *= Math.exp(-dt * 5);

    this.drawLines(here ? Math.min(0.85, Math.max(0, (this.speed - 16) / 22)) : 0);
    this.updateWind(here ? Math.min(1, Math.max(0, (this.speed - 8) / 35)) : 0);
  }

  private drawLines(amount: number): void {
    const c = this.lines;
    c.style.opacity = amount.toFixed(2);
    if (amount <= 0.01) return;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const g = c.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.hypot(cx, cy);
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2;
      const r0 = R * (0.55 + Math.random() * 0.25);
      const r1 = r0 + R * (0.12 + Math.random() * 0.25);
      g.lineWidth = 1 + Math.random() * 2;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      g.stroke();
    }
  }

  /** A rush of wind that rises with your speed. */
  private updateWind(level: number): void {
    const audio = this.game.getSystem<AudioSystem>('audio');
    const ctx = audio?.ctx;
    if (!ctx) return;
    if (!this.wind) {
      if (level <= 0) return;
      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 700;
      filter.Q.value = 0.6;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(ctx.destination);
      src.start();
      this.wind = { gain, src };
    }
    const on = audio.sfxOn ? level * level * 0.22 : 0;
    this.wind.gain.gain.setTargetAtTime(on, ctx.currentTime, 0.1);
  }

  render(): void {
    const here = this.here();
    this.panel.style.display = here ? 'block' : 'none';
    const m = this.mission;
    if (!m) return;
    const { done, total } = m.progress();
    this.panel.textContent = done === total ? `HERO CITY SAVED!   ·   Next: ${m.next()}` : `SAVE HERO CITY  ${done} / ${total}   ·   Next: ${m.next()}`;
  }
}

const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _to = new THREE.Vector3();
const _t = new THREE.Vector3();
const _ray = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _euler = new THREE.Euler();

declare module '@ingine/engine/core/EventBus' {
  interface GameEvents {
    'heroes:power': { power: PowerId };
    'heroes:swing': { on: boolean };
    'heroes:fly': { on: boolean };
    'heroes:lift': { on: boolean };
    'heroes:throw': { on: boolean };
    'heroes:slam': { strength: number };
  }
}
