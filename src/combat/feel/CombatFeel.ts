import * as THREE from 'three';
import { Component } from '@/entities/Component';
import type { FrameTime } from '@/core/Time';
import { Items } from '@/inventory/catalog';

const DEG = Math.PI / 180;
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

/** How hard each thing shakes the view (trauma added, 0..1). */
export const FeelConfig = {
  /** Max view shake at full trauma (degrees) and how fast trauma fades (per second). */
  shakeDeg: 3.2,
  shakeDecay: 1.6,
  /** Hit-stop: a few hundredths of a second of near-freeze when a blow lands. Seconds, real time. */
  hitStop: { hit: 0.05, kill: 0.09, parried: 0.12, hurt: 0.06 },
  hitStopScale: 0.06,
  /** Trauma: your gun firing (per kg of recoil pitch), being hit (per damage), blasts (at the centre). */
  traumaPerRecoil: 0.05,
  traumaPerDamage: 0.012,
  traumaBlast: 0.9,
};

/**
 * The player's sense of impact, all presentation and none of it in the
 * simulation: view shake (trauma that fades; guns, blows taken, blasts
 * nearby), and hit-stop, a split second of near-freeze when your blow lands,
 * longer for a kill or a parry. Runs after the camera has posed itself.
 */
export class CombatFeel extends Component {
  /** After FirstPersonCamera (100), before the viewmodel (120). */
  order = 101;
  trauma = 0;
  private stopUntil = 0;
  private t = 0;
  private unsubs: (() => void)[] = [];

  onAttach(): void {
    const ev = this.game.events;
    const me = this.entity;
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
          if (result.damage >= 25) this.hitStop(FeelConfig.hitStop.hurt);
        } else if (hit.attacker === me && hit.delivery === 'sweep') {
          if (result.tags.includes('parried')) return;
          if (result.damage > 0 || result.tags.includes('blocked')) this.hitStop(result.killed ? FeelConfig.hitStop.kill : FeelConfig.hitStop.hit);
          this.addTrauma(result.killed ? 0.25 : 0.12);
        }
      }),
      ev.on('combat:parried', ({ defender, attacker }) => {
        if (defender !== me && attacker !== me) return;
        this.hitStop(FeelConfig.hitStop.parried);
        this.addTrauma(defender === me ? 0.2 : 0.35);
      }),
      ev.on('combat:explosion', ({ point, radius }) => {
        const d = this.entity.object3d.position.distanceTo(new THREE.Vector3(point.x, point.y, point.z));
        this.addTrauma(FeelConfig.traumaBlast * Math.max(0, 1 - d / (radius * 4)));
      }),
    );
  }

  onDetach(): void {
    this.unsubs.forEach((u) => u());
    this.game.timeScale = 1;
  }

  addTrauma(n: number): void {
    this.trauma = Math.min(1, this.trauma + Math.max(0, n));
  }

  /** Freeze the world (almost) for `seconds` of real time. */
  hitStop(seconds: number): void {
    const now = performance.now() / 1000;
    this.stopUntil = Math.max(this.stopUntil, now + seconds);
    this.game.timeScale = FeelConfig.hitStopScale;
  }

  get stopping(): boolean {
    return this.game.timeScale < 1;
  }

  update(time: FrameTime): void {
    // Hit-stop runs on real time, since game time is what it slows.
    if (this.game.timeScale < 1 && performance.now() / 1000 >= this.stopUntil) this.game.timeScale = 1;
    const dt = Math.min(time.delta / Math.max(this.game.timeScale, 0.01), 0.1);
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - FeelConfig.shakeDecay * dt);
    if (this.trauma <= 0) return;
    // Shake grows with the square of trauma: small knocks barely move it, a blast rattles you.
    const s = this.trauma * this.trauma * FeelConfig.shakeDeg * DEG;
    const n = (f: number, o: number) => Math.sin(this.t * f + o) * 0.6 + Math.sin(this.t * f * 2.3 + o * 1.7) * 0.4;
    _e.set(n(31, 0) * s, n(27, 4) * s, n(23, 9) * s * 0.6);
    const cam = this.game.renderer.camera;
    cam.quaternion.multiply(_q.setFromEuler(_e));
  }
}
