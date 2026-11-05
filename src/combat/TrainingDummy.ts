import * as THREE from 'three';
import { Component } from '@/entities/Component';
import type { FrameTime } from '@/core/Time';
import { makeLabel } from '@/render/labels';
import { Damageable } from './Damageable';

/**
 * A practice target: shows its health over its head, falls over when
 * "killed", and stands back up after a few seconds at full health.
 */
export class TrainingDummy extends Component {
  private health!: Damageable;
  private label: THREE.Sprite | null = null;
  private shown = -1;
  private fall = 0;
  private downTimer = 0;
  private unsubs: (() => void)[] = [];

  constructor(
    readonly title: string,
    /** The part that topples (pivots at its base). */
    private figure: THREE.Object3D,
    private labelHeight: number,
    private resetAfter = 4,
  ) {
    super();
  }

  onAttach(): void {
    this.health = this.entity.require(Damageable);
    this.unsubs.push(
      this.game.events.on('combat:killed', ({ target }) => {
        if (target === this.entity) this.downTimer = this.resetAfter;
      }),
    );
    this.refreshLabel();
  }

  onDetach(): void {
    this.unsubs.forEach((u) => u());
    this.disposeLabel();
  }

  fixedUpdate(dt: number): void {
    if (!this.health.dead) return;
    this.downTimer -= dt;
    if (this.downTimer <= 0) this.health.revive();
  }

  update(time: FrameTime): void {
    const target = this.health.dead ? 1 : 0;
    const k = 1 - Math.exp(-Math.min(time.delta, 0.1) * (target ? 9 : 5));
    this.fall += (target - this.fall) * k;
    // Tips backwards, away from whoever knocked it down.
    this.figure.rotation.x = -this.fall * (Math.PI / 2) * 0.92;
    this.refreshLabel();
  }

  private refreshLabel(): void {
    const hp = Math.ceil(this.health.health);
    if (hp === this.shown) return;
    this.shown = hp;
    this.disposeLabel();
    const text = this.health.dead ? `${this.title}: down` : `${this.title}  ${hp} / ${this.health.maxHealth}`;
    this.label = makeLabel(text, { scale: 0.32, color: this.health.dead ? '#ffb3a1' : '#ffffff' });
    this.label.position.set(0, this.labelHeight, 0);
    this.entity.object3d.add(this.label);
  }

  private disposeLabel(): void {
    if (!this.label) return;
    this.label.removeFromParent();
    this.label.material.map?.dispose();
    this.label.material.dispose();
    this.label = null;
  }
}
