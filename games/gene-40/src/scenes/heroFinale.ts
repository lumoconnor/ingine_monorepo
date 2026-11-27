import * as THREE from 'three';
import type { Game } from '@ingine/engine/core/Game';
import { Entity } from '@ingine/engine/entities/Entity';
import { RAPIER } from '@ingine/engine/physics/PhysicsWorld';
import { RigidBodyComponent } from '@ingine/engine/physics/RigidBodyComponent';
import type { AudioSystem } from '@ingine/engine/audio/AudioSystem';
import { lizModel } from './arup';
import { label } from './kit';

/**
 * Hero city's finale: a storm rolls in and Big Liz (the friendly giant
 * lizard from the Arup office, six times her usual size and very upset)
 * stomps down the avenue behind Hero HQ. Throw cars at her and slam the
 * ground by her feet until she calms down and shrinks back to normal.
 */

// --- The storm ------------------------------------------------------------------------

const CLEAR = { sky: new THREE.Color(0x9cc4e4), fogNear: 80, fogFar: 420, sun: 2.4, hemi: 1.1 };
const STORM = { sky: new THREE.Color(0x262b36), fogNear: 30, fogFar: 170, sun: 0.45, hemi: 0.7 };
const RAIN = { drops: 1600, box: 70, height: 40, speed: 34, length: 1.2 };

/**
 * Dark clouds, rain and lightning. `on` fades it in or out over a few
 * seconds; `apply(false)` snaps it off at once (when you leave the city, so
 * the other worlds stay sunny).
 */
export class Storm {
  /** 0 = clear, 1 = full storm. */
  level = 0;
  on = false;
  private rain: THREE.LineSegments;
  private hemi: THREE.HemisphereLight | null;
  private flash = 0;
  private nextBolt = 4;
  private sound: { gain: GainNode } | null = null;

  constructor(private game: Game) {
    const pos = new Float32Array(RAIN.drops * 6);
    for (let i = 0; i < RAIN.drops; i++) {
      const x = (Math.random() - 0.5) * RAIN.box;
      const y = Math.random() * RAIN.height;
      const z = (Math.random() - 0.5) * RAIN.box;
      pos.set([x, y, z, x + 0.15, y + RAIN.length, z], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xb8c6d8, transparent: true, opacity: 0, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    game.renderer.scene.add(this.rain);
    this.hemi = (game.renderer.scene.children.find((c) => (c as THREE.HemisphereLight).isHemisphereLight) as THREE.HemisphereLight) ?? null;
  }

  /** Snap to clear (leaving the city) or back to where the storm was. */
  apply(here: boolean): void {
    if (!here) this.paint(0);
    else this.paint(this.level);
    this.rain.visible = here && this.level > 0.01;
  }

  update(dt: number, here: boolean): void {
    const target = this.on ? 1 : 0;
    this.level += Math.sign(target - this.level) * Math.min(Math.abs(target - this.level), dt / 4);
    if (!here) {
      this.rain.visible = false;
      this.rainSound(0);
      return;
    }
    // Lightning: a white flash now and then, thunder just after.
    if (this.level > 0.8) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) {
        this.flash = 1;
        this.nextBolt = 5 + Math.random() * 6;
        this.game.events.emit('heroes:thunder', {});
      }
    }
    this.flash = Math.max(0, this.flash - dt * 5);
    this.paint(this.level);
    // Rain falls around the camera and wraps round.
    this.rain.visible = this.level > 0.01;
    if (this.rain.visible) {
      const cam = this.game.renderer.camera.getWorldPosition(_v);
      this.rain.position.set(cam.x, cam.y - RAIN.height / 2, cam.z);
      (this.rain.material as THREE.LineBasicMaterial).opacity = 0.55 * this.level;
      const p = this.rain.geometry.attributes.position as THREE.BufferAttribute;
      const a = p.array as Float32Array;
      for (let i = 0; i < RAIN.drops; i++) {
        const k = i * 6;
        let y = a[k + 1] - RAIN.speed * dt;
        if (y < 0) y += RAIN.height;
        a[k + 1] = y;
        a[k + 4] = y + RAIN.length;
      }
      p.needsUpdate = true;
    }
    this.rainSound(this.level);
  }

  private paint(k: number): void {
    const scene = this.game.renderer.scene;
    const sky = _c.copy(CLEAR.sky).lerp(STORM.sky, k);
    if (this.flash > 0) sky.lerp(_white, this.flash * 0.6);
    if (scene.background instanceof THREE.Color) scene.background.copy(sky);
    const fog = scene.fog as THREE.Fog | null;
    if (fog) {
      fog.color.copy(sky);
      fog.near = THREE.MathUtils.lerp(CLEAR.fogNear, STORM.fogNear, k);
      fog.far = THREE.MathUtils.lerp(CLEAR.fogFar, STORM.fogFar, k);
    }
    this.game.renderer.sun.intensity = THREE.MathUtils.lerp(CLEAR.sun, STORM.sun, k);
    if (this.hemi) this.hemi.intensity = THREE.MathUtils.lerp(CLEAR.hemi, STORM.hemi, k) + this.flash * 1.5;
  }

  /** A soft hiss of rain. */
  private rainSound(level: number): void {
    const audio = this.game.getSystem<AudioSystem>('audio');
    const ctx = audio?.ctx;
    if (!ctx) return;
    if (!this.sound) {
      if (level <= 0) return;
      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 1800;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(ctx.destination);
      src.start();
      this.sound = { gain };
    }
    this.sound.gain.gain.setTargetAtTime(audio.sfxOn ? level * 0.06 : 0, ctx.currentTime, 0.2);
  }
}

// --- Big Liz ---------------------------------------------------------------------------

export const KAIJU = { scale: 6, hp: 100, carHit: 20, slamHit: 15, slamReach: 17, speed: 3.2, stompEvery: 4.5, stompReach: 18, radius: 5.5, height: 20 };

/** The giant Big Liz: walks the avenue behind Hero HQ, stomps, roars, and shrinks back when she's calmed down. */
export class Kaiju {
  readonly entity: Entity;
  readonly body: RAPIER.RigidBody;
  private model: THREE.Group;
  private head: THREE.Group;
  readonly pos: THREE.Vector3;
  hp = KAIJU.hp;
  awake = false;
  calmed = false;
  private yaw = 0;
  private t = 0;
  private stompIn = KAIJU.stompEvery;
  private hitCool = new Map<unknown, number>();
  private flinch = 0;
  private shrink = 0;
  private tag: Entity;
  private tagScale: THREE.Vector3 | null = null;

  constructor(
    private game: Game,
    private route: { x: number; y: number; zNear: number; zFar: number },
  ) {
    const { root, head } = lizModel();
    root.scale.setScalar(KAIJU.scale);
    this.model = root;
    this.head = head;
    const g = new THREE.Group();
    g.add(root);
    this.pos = new THREE.Vector3(route.x, route.y, route.zFar);
    g.position.copy(this.pos);
    this.entity = new Entity('kaiju-liz', g);
    this.entity.add(
      new RigidBodyComponent({ type: 'kinematicPosition', colliders: [RAPIER.ColliderDesc.capsule(6, 4).setTranslation(0, 10, -0.5).setSensor(true)] }),
    );
    game.world.spawn(this.entity);
    this.body = this.entity.get(RigidBodyComponent)!.body;
    this.tag = label(game, 'BIG LIZ', [this.pos.x, this.pos.y + 4.2, this.pos.z], 4, '#ffe7a8');
    this.hide();
  }

  private hide(): void {
    this.entity.object3d.visible = false;
    this.tag.object3d.visible = false;
    for (const c of this.entity.get(RigidBodyComponent)!.colliders) c.setSensor(true);
  }

  /** She stomps in (the fight starts). */
  wake(): void {
    this.hp = KAIJU.hp;
    this.awake = true;
    this.calmed = false;
    this.shrink = 0;
    this.model.scale.setScalar(KAIJU.scale);
    if (this.tagScale) this.tag.object3d.scale.copy(this.tagScale);
    this.pos.set(this.route.x, this.route.y, this.route.zFar);
    this.body.setTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, true);
    this.entity.object3d.visible = true;
    for (const c of this.entity.get(RigidBodyComponent)!.colliders) c.setSensor(false);
    this.game.events.emit('heroes:roar', {});
  }

  /** Take a hit. Returns true if that calmed her down. */
  hurt(amount: number, what: unknown): boolean {
    if (!this.awake || this.calmed) return false;
    const now = this.t;
    if ((this.hitCool.get(what) ?? -1) > now) return false;
    this.hitCool.set(what, now + 1.2);
    this.hp = Math.max(0, this.hp - amount);
    this.flinch = 1;
    this.game.events.emit('heroes:lizHit', { hp: this.hp });
    if (this.hp === 0) {
      this.calmed = true;
      this.awake = false;
      for (const c of this.entity.get(RigidBodyComponent)!.colliders) c.setSensor(true);
      return true;
    }
    return false;
  }

  /** Horizontal distance from her middle. */
  reach(p: { x: number; z: number }): number {
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
  }

  /** Step her: walk towards you along the avenue, face you, stomp now and then. Returns true on a stomp. */
  step(dt: number, player: THREE.Vector3): boolean {
    this.t += dt;
    if (!this.awake) return false;
    const want = THREE.MathUtils.clamp(player.z, this.route.zFar, this.route.zNear);
    const dz = want - this.pos.z;
    if (Math.abs(dz) > 4) this.pos.z += Math.sign(dz) * Math.min(Math.abs(dz), KAIJU.speed * dt);
    this.yaw = Math.atan2(player.x - this.pos.x, player.z - this.pos.z);
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
    _q.setFromEuler(_e.set(0, this.yaw, 0));
    this.body.setNextKinematicRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
    this.stompIn -= dt;
    if (this.stompIn <= 0) {
      this.stompIn = KAIJU.stompEvery;
      return true;
    }
    return false;
  }

  /** Each frame: waddle, flinch, shrink once calm, keep the name tag above her head. */
  update(dt: number): void {
    const top = (this.calmed ? THREE.MathUtils.lerp(KAIJU.scale, 1, this.shrink) : KAIJU.scale) * 3.9;
    this.tag.object3d.visible = this.entity.object3d.visible;
    this.tag.object3d.position.set(this.pos.x, this.pos.y + top + (this.calmed ? 0.6 : 2.5), this.pos.z);
    if (!this.entity.object3d.visible) return;
    this.flinch = Math.max(0, this.flinch - dt * 3);
    if (this.awake) {
      this.model.rotation.z = Math.sin(this.t * 2.4) * 0.05;
      this.model.rotation.x = -this.flinch * 0.25;
      this.head.rotation.x = -0.2 * Math.max(0, Math.sin(this.t * 0.7));
    }
    if (this.calmed && this.shrink < 1) {
      this.shrink = Math.min(1, this.shrink + dt / 2.5);
      this.model.scale.setScalar(THREE.MathUtils.lerp(KAIJU.scale, 1, this.shrink));
      // Her name tag shrinks with her.
      this.tagScale ??= this.tag.object3d.scale.clone();
      this.tag.object3d.scale.copy(this.tagScale).multiplyScalar(THREE.MathUtils.lerp(1, 0.25, this.shrink));
      this.model.rotation.set(0, 0, 0);
      this.head.rotation.x = 0;
    }
  }
}

const _v = new THREE.Vector3();
const _c = new THREE.Color();
const _white = new THREE.Color(0xffffff);
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

declare module '@ingine/engine/core/EventBus' {
  interface GameEvents {
    'heroes:storm': { on: boolean };
    'heroes:thunder': Record<string, never>;
    'heroes:roar': Record<string, never>;
    'heroes:stomp': Record<string, never>;
    'heroes:lizHit': { hp: number };
  }
}
