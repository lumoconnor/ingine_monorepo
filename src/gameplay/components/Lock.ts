import * as THREE from 'three';
import { Component } from '@/entities/Component';
import type { FrameTime } from '@/core/Time';
import { Items } from '@/inventory/catalog';

export interface LockOptions {
  /** Unique id. Unlocked state is the WorldState flag `unlocked.<id>`, so it saves and dialogue can set it. */
  id: string;
  /** Item id of the key that opens it. */
  key: string;
  /** Use the key up (it stays in the lock). Default false: keys are kept. */
  consumeKey?: boolean;
  /** What the player is told when they try it without the key. */
  lockedText?: string;
}

export const unlockedFlag = (id: string) => `unlocked.${id}`;

const RATTLE_TIME = 0.3;

/**
 * A lock on a door, chest or anything else with an Interactable. Unlocking
 * needs the key item in the inventory; once unlocked it stays unlocked
 * (stored as a flag, so saves and dialogue effects can change it).
 * Trying it without the key rattles `visual`.
 */
export class Lock extends Component {
  private rattle = 0;
  private rest = new THREE.Vector3();

  constructor(
    readonly opts: LockOptions,
    /** Wiggled on a failed attempt. Should be a child that nothing else moves. */
    private visual?: THREE.Object3D,
  ) {
    super();
    if (!(opts.key in Items)) throw new Error(`Lock "${opts.id}": unknown key item "${opts.key}"`);
  }

  get locked(): boolean {
    return !this.game.state.hasFlag(unlockedFlag(this.opts.id));
  }

  get hasKey(): boolean {
    return this.game.state.itemCount(this.opts.key) > 0;
  }

  get keyName(): string {
    return Items[this.opts.key].name;
  }

  /** Prompt while locked; null when unlocked (use the thing's own prompt). */
  prompt(noun: string): string | null {
    if (!this.locked) return null;
    return this.hasKey ? `Unlock ${noun} (${this.keyName})` : `Locked ${noun}`;
  }

  /** True if it's (now) unlocked. Without the key: rattles, says so, returns false. */
  tryUnlock(): boolean {
    if (!this.locked) return true;
    const g = this.game;
    if (!this.hasKey) {
      this.rattle = RATTLE_TIME;
      g.events.emit('notify', { text: this.opts.lockedText ?? "It's locked. You need a key." });
      return false;
    }
    g.state.setFlag(unlockedFlag(this.opts.id));
    if (this.opts.consumeKey) {
      g.state.removeItem(this.opts.key, 1);
      g.events.emit('notify', { text: `Unlocked. The ${this.keyName} stays in the lock.` });
    } else {
      g.events.emit('notify', { text: `Unlocked with ${this.keyName}` });
    }
    return true;
  }

  onAttach(): void {
    if (this.visual) this.rest.copy(this.visual.position);
  }

  update(time: FrameTime): void {
    if (!this.visual || this.rattle <= 0) return;
    this.rattle = Math.max(0, this.rattle - time.delta);
    const k = this.rattle / RATTLE_TIME;
    this.visual.position.copy(this.rest);
    this.visual.position.x += Math.sin(this.rattle * 90) * 0.012 * k;
    this.visual.position.z += Math.sin(this.rattle * 70) * 0.008 * k;
  }
}
