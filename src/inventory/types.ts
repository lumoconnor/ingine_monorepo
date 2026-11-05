import type { Effect } from '@/dialogue/types';

/**
 * Item catalogue format (src/content/items.json), keyed by item id.
 * Checked by TypeScript (`satisfies Record<string, ItemDef>`) and at startup
 * by `validateItems`.
 */
export type ItemCategory = 'quest' | 'consumable' | 'misc' | 'currency' | 'weapon' | 'ammo' | 'armour';

export interface ItemDef {
  name: string;
  description: string;
  /** One of CATEGORIES. (Typed as string because JSON imports widen literals; validateItems checks it.) */
  category: ItemCategory | (string & {});
  /** Which 3D model to show in the world and render as the icon (a model id: see render/models/ModelRegistry.ts). */
  model: string;
  /** Model id shown in flight when fired or thrown (arrows). Defaults to `model`. */
  flightModel?: string;
  /** How many fit in one inventory slot. Defaults: quest 1, others 20. Currency isn't slotted. */
  maxStack?: number;
  /** Effects run by the Use button: the dialogue effects plus `consume`. */
  use?: Effect[];
  /** Use button label, e.g. "Drink". Defaults to "Use". */
  useLabel?: string;
  /** Readable text: adds a Read button. */
  text?: string;
  /** Makes it a weapon (see combat/weaponTypes.ts). Weapons are kept as instances. */
  weapon?: import('@/combat/weaponTypes').WeaponDef;
  /** For ammo: what it does when it hits (overrides the weapon's payload). */
  payload?: import('@/combat/weaponTypes').PayloadDef;
  /** Makes it wearable (see combat/Armour.ts). */
  armour?: import('@/combat/Armour').ArmourDef;
  /** Inherit every field from another item, then override (variants: "extends": "rifle"). */
  extends?: string;
}

export const CATEGORIES: ItemCategory[] = ['quest', 'consumable', 'misc', 'currency', 'weapon', 'ammo', 'armour'];

/** Quest items and money can't be dropped. */
export function canDrop(def: ItemDef): boolean {
  return def.category !== 'quest' && def.category !== 'currency';
}

export function stackSize(def: ItemDef): number {
  return def.maxStack ?? (def.category === 'quest' || def.category === 'armour' ? 1 : def.category === 'ammo' ? 60 : 20);
}

/** Weapons are kept one by one with their own state; a weapon that is also thrown (grenades) stacks. */
export function isInstanced(def: ItemDef | undefined): boolean {
  return !!def?.weapon && def.weapon.stack !== true;
}
