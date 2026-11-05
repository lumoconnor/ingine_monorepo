import { Component } from '@/entities/Component';
import type { Saveable } from '@/core/SaveSystem';
import { Items } from '@/content/items';
import { DamageTypes, registerModifier } from './registry';

/** An item you can wear (items.json `armour` block). */
export interface ArmourDef {
  /** One piece per slot: head, body, legs... */
  slot: string;
  /** Hit zones it protects (head, torso, limbs). */
  covers: string[];
  /** Share of each damage type it stops, 0..1. */
  resist: Record<string, number>;
  /** Walking speed multiplier while worn (mail is heavy). */
  move?: number;
}

/**
 * What someone is wearing. For the player the pieces are inventory items
 * (worn from the inventory screen; dropping one takes it off). For NPCs
 * (phase 5) pass the pieces in directly with `fromInventory: false`.
 *
 * Damage step 25 (after hit zones, before natural resistances): a hit on a
 * covered zone loses the piece's share of each type. Hits with no zone
 * (blasts, fire) meet whatever covers the torso.
 */
export class Armour extends Component implements Saveable {
  /** slot -> item id */
  worn: Record<string, string> = {};

  constructor(private opts: { pieces?: string[]; fromInventory?: boolean } = {}) {
    super();
    for (const id of opts.pieces ?? []) {
      const a = Items[id]?.armour;
      if (a) this.worn[a.slot] = id;
    }
  }

  private get fromInventory(): boolean {
    return this.opts.fromInventory ?? true;
  }

  isWorn(item: string): boolean {
    const a = Items[item]?.armour;
    return !!a && this.worn[a.slot] === item;
  }

  /** Puts it on (replacing whatever was in that slot). */
  wear(item: string): boolean {
    const a = Items[item]?.armour;
    if (!a) return false;
    if (this.fromInventory && this.game.state.itemCount(item) <= 0) return false;
    this.worn[a.slot] = item;
    this.game.events.emit('combat:armour', { entity: this.entity, item, on: true });
    return true;
  }

  takeOff(item: string): boolean {
    const a = Items[item]?.armour;
    if (!a || this.worn[a.slot] !== item) return false;
    delete this.worn[a.slot];
    this.game.events.emit('combat:armour', { entity: this.entity, item, on: false });
    return true;
  }

  /** The piece protecting a zone, if any. */
  pieceFor(zone: string): ArmourDef | null {
    for (const id of Object.values(this.worn)) {
      const a = Items[id]?.armour;
      if (a?.covers.includes(zone)) return a;
    }
    return null;
  }

  /** Product of the worn pieces' `move`. */
  get moveScale(): number {
    return Object.values(this.worn).reduce((m, id) => m * (Items[id]?.armour?.move ?? 1), 1);
  }

  fixedUpdate(): void {
    // Dropped or used up: it comes off.
    if (!this.fromInventory) return;
    for (const id of Object.values(this.worn)) if (this.game.state.itemCount(id) <= 0) this.takeOff(id);
  }

  saveState(): unknown {
    return { worn: { ...this.worn } };
  }

  loadState(s: { worn?: Record<string, string> }): void {
    this.worn = {};
    for (const id of Object.values(s?.worn ?? {})) if (Items[id]?.armour && (!this.fromInventory || this.game.state.itemCount(id) > 0)) this.worn[Items[id].armour!.slot] = id;
  }
}

registerModifier({
  name: 'armour',
  order: 25,
  apply: ({ hit, target, packets, tags }) => {
    const ar = target.entity.get(Armour);
    if (!ar) return;
    const piece = ar.pieceFor(hit.zone ?? 'torso');
    if (!piece) return;
    let stopped = 0;
    for (const p of packets) {
      if (DamageTypes[p.type]?.ignoresResist) continue;
      const r = Math.min(1, Math.max(0, piece.resist[p.type] ?? 0));
      stopped += p.amount * r;
      p.amount *= 1 - r;
    }
    if (stopped > 0) tags.add('armour');
  },
});
