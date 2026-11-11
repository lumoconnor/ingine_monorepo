import * as THREE from 'three';
import { Component } from '../../entities/Component';
import type { FrameTime } from '../../core/Time';
import { Items } from '../../inventory/catalog';
import { Arcs } from '../blocks';
import { Combatant } from '../Combatant';

const DEG = Math.PI / 180;
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _v = new THREE.Vector3();
const _qi = new THREE.Quaternion();

/** How hard each thing moves the view. */
export const FeelConfig = {
  /** Max view shake at full trauma (degrees) and how fast trauma fades (per second). */
  shakeDeg: 3.2,
  shakeDecay: 1.6,
  /** Trauma: your gun firing (per degree of recoil pitch), being hit (per damage), blasts (at the centre). */
  traumaPerRecoil: 0.05,
  traumaPerDamage: 0.008,
  traumaBlast: 0.9,
  /** The view leans with a swing: this much of the arc's yaw and pitch, and roll per degree of yaw. */
  swingFollow: 0.035,
  swingRoll: 0.03,
  /** A landed blow kicks the view along the cut, degrees: a light hit, and the most a heavy or a kill gives. */
  hitKick: 0.7,
  hitKickMax: 1.8,
  /** Being struck throws the view the way the blow went: degrees per point of damage, and the most. */
  hurtKick: 0.09,
  hurtKickMax: 5,
  /** The kick's spring: how fast it snaps back (rad/s). */
  kickOmega: 17,
};

/**
 * The player's sense of impact through the camera, all presentation and none
 * of it in the simulation: the view leans with your own swings, kicks along
 * the cut when a blow lands, is thrown the way a blow that hits you was
 * going, and shakes (trauma that fades) for guns and blasts. Runs after the
 * camera has posed itself. The freeze when a blow lands is the fighter's own
 * (Combatant.hitPause): only the blade hangs, the world carries on.
 */
export class CombatFeel extends Component {
  /** After FirstPersonCamera (100), before the viewmodel (120). */
  order = 101;
  trauma = 0;
  /** The kick, as pitch (x), yaw (y) and roll (z) in radians, on a spring back to rest. */
  readonly kick = new THREE.Vector3();
  private kickVel = new THREE.Vector3();
  /** The lean that follows a swing (pitch, yaw, roll), eased. */
  private lean = new THREE.Vector3();
  private t = 0;
  private fighter: Combatant | null = null;
  private unsubs: (() => void)[] = [];

  onAttach(): void {
    const ev = this.game.events;
    const me = this.entity;
    this.fighter = this.entity.get(Combatant) ?? null;
    this.unsubs.push(
      ev.on('combat:fired', ({ attacker, item }) => {
        if (attacker !== me || !item) return;
        const r = Items[item]?.weapon?.handling?.recoil?.pitch ?? 0;
        this.addTrauma(r * FeelConfig.traumaPerRecoil);
      }),
      ev.on('combat:hit', ({ hit, target, result }) => {
        if (hit.delivery === 'status' || hit.delivery === 'hazard') return;
        if (target === me && result.damage > 0) {
          this.addTrauma(result.damage * FeelConfig.traumaPerDamage);
          this.hurtKick(hit.direction, result.damage);
        } else if (hit.attacker === me && hit.delivery === 'sweep') {
          if (result.tags.includes('parried')) return;
          const landed = result.damage > 0 || result.tags.includes('blocked');
          if (landed) this.swingKick(result.killed ? FeelConfig.hitKickMax : Math.min(FeelConfig.hitKickMax, FeelConfig.hitKick * (0.6 + result.damage / 60)));
          this.addTrauma(result.killed ? 0.12 : 0.04);
        }
      }),
      ev.on('combat:parried', ({ defender, attacker }) => {
        if (defender !== me && attacker !== me) return;
        this.addTrauma(defender === me ? 0.2 : 0.35);
        // Your blade thrown back, or theirs off yours.
        this.swingKick(defender === me ? -0.8 : -FeelConfig.hitKickMax);
      }),
      ev.on('combat:explosion', ({ point, radius }) => {
        const d = this.entity.object3d.position.distanceTo(_v.set(point.x, point.y, point.z));
        this.addTrauma(FeelConfig.traumaBlast * Math.max(0, 1 - d / (radius * 4)));
      }),
    );
  }

  onDetach(): void {
    this.unsubs.forEach((u) => u());
  }

  addTrauma(n: number): void {
    this.trauma = Math.min(1, this.trauma + Math.max(0, n));
  }

  /** Kick the view `deg` degrees along the way the blade is travelling right now (negative: back against it). */
  private swingKick(deg: number): void {
    const f = this.fighter;
    const m = f?.currentMode;
    let yaw = 0;
    let pitch = -1;
    if (f && m?.delivery.kind === 'sweep') {
      const arc = Arcs[f.step ?? m.delivery.arc ?? 'jab'] ?? Arcs.jab;
      const p = f.progress;
      const a = arc(Math.max(0, p - 0.05));
      const b = arc(Math.min(1, p + 0.05));
      const l = Math.hypot(b.yaw - a.yaw, b.pitch - a.pitch);
      // A thrust or a jab has no sideways travel: it punches straight in (a small nod).
      if (l > 1) {
        yaw = (b.yaw - a.yaw) / l;
        pitch = (b.pitch - a.pitch) / l;
      }
    }
    this.impulse(pitch * deg * DEG, yaw * deg * DEG, -yaw * deg * 0.5 * DEG);
  }

  /** Thrown the way the blow was going: seen from the camera, sideways turns and rolls the view, head-on knocks it up. */
  private hurtKick(direction: THREE.Vector3 | undefined, damage: number): void {
    const deg = Math.min(FeelConfig.hurtKickMax, 0.8 + damage * FeelConfig.hurtKick);
    if (!direction) return this.impulse(deg * 0.6 * DEG, 0, 0);
    const cam = this.game.renderer.camera;
    _v.copy(direction).applyQuaternion(_qi.copy(cam.quaternion).invert());
    // Camera space: +x right, -z ahead. A blow travelling +x (from your left) throws the view right.
    this.impulse((0.35 + 0.4 * Math.max(0, _v.z)) * deg * DEG, -_v.x * deg * 0.6 * DEG, -_v.x * deg * 0.8 * DEG);
  }

  /** Set the kick spring moving so it peaks at about this pitch, yaw and roll (radians). */
  private impulse(pitch: number, yaw: number, roll: number): void {
    // A critically damped spring kicked with velocity v peaks at v / (omega * e).
    const k = FeelConfig.kickOmega * Math.E;
    this.kickVel.x += pitch * k;
    this.kickVel.y += yaw * k;
    this.kickVel.z += roll * k;
  }

  update(time: FrameTime): void {
    const dt = Math.min(time.delta, 0.1);
    this.t += dt;
    const cam = this.game.renderer.camera;

    // The view leans with the swing: back with the wind-up, through with the cut.
    const f = this.fighter;
    const m = f?.currentMode;
    let ly = 0;
    let lp = 0;
    if (f && m?.delivery.kind === 'sweep' && (f.state === 'windup' || f.state === 'active' || f.state === 'recovery')) {
      const arc = Arcs[f.step ?? m.delivery.arc ?? 'jab'] ?? Arcs.jab;
      const p = f.progressAt(time.alpha);
      const a = f.state === 'windup' ? arc(0) : f.state === 'active' ? arc(p) : arc(f.swingEnd);
      const amt = f.state === 'windup' ? p : f.state === 'active' ? 1 : 1 - p;
      ly = a.yaw * DEG * FeelConfig.swingFollow * amt;
      lp = a.pitch * DEG * FeelConfig.swingFollow * amt;
    }
    const k = 1 - Math.exp(-dt * 22);
    this.lean.x += (lp - this.lean.x) * k;
    this.lean.y += (ly - this.lean.y) * k;
    this.lean.z += (-ly * (FeelConfig.swingRoll / FeelConfig.swingFollow) - this.lean.z) * k;

    // The kick: a critically damped spring back to rest (sub-stepped so a long frame can't blow it up).
    const w = FeelConfig.kickOmega;
    for (let r = dt; r > 0; r -= 1 / 240) {
      const h = Math.min(r, 1 / 240);
      this.kickVel.addScaledVector(this.kick, -w * w * h).multiplyScalar(Math.max(0, 1 - 2 * w * h));
      this.kick.addScaledVector(this.kickVel, h);
    }

    let px = this.lean.x + this.kick.x;
    let py = this.lean.y + this.kick.y;
    // A bow held at full draw starts to wander: a little after two seconds, worse as your arm tires.
    if (f && f.state === 'charging' && f.heldFull > 0 && f.currentMode?.delivery.kind === 'projectile' && !f.currentMode.trigger.cook) {
      const tired = 1 - f.stamina / f.maxStamina;
      const amt = (THREE.MathUtils.clamp((f.heldFull - 2) / 3, 0, 1) * 0.5 + tired * tired * 0.7) * DEG;
      px += (Math.sin(this.t * 2.3) + Math.sin(this.t * 3.7 + 1) * 0.5) * amt;
      py += (Math.sin(this.t * 1.7 + 2) + Math.sin(this.t * 4.1) * 0.5) * amt;
    }
    let pz = this.lean.z + this.kick.z;
    this.trauma = Math.max(0, this.trauma - FeelConfig.shakeDecay * dt);
    if (this.trauma > 0) {
      // Shake grows with the square of trauma: small knocks barely move it, a blast rattles you.
      const s = this.trauma * this.trauma * FeelConfig.shakeDeg * DEG;
      const n = (fr: number, o: number) => Math.sin(this.t * fr + o) * 0.6 + Math.sin(this.t * fr * 2.3 + o * 1.7) * 0.4;
      px += n(31, 0) * s;
      py += n(27, 4) * s;
      pz += n(23, 9) * s * 0.6;
    }
    if (Math.abs(px) + Math.abs(py) + Math.abs(pz) < 1e-6) return;
    cam.quaternion.multiply(_q.setFromEuler(_e.set(px, py, pz)));
  }
}
