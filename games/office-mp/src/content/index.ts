import type { ItemDef } from '@ingine/engine/inventory/types';
import type { DamageTypeDef } from '@ingine/engine/combat/types';
import type { WeaponDef } from '@ingine/engine/combat/weaponTypes';
import type { FactionDef } from '@ingine/engine/combat/ai/factions';
import { registerItems } from '@ingine/engine/inventory/catalog';
import { registerDamageType } from '@ingine/engine/combat/registry';
import { registerFaction } from '@ingine/engine/combat/ai/factions';
import { setUnarmed } from '@ingine/engine/combat/Combatant';
import items from './items.json';
import damageTypes from './combat/damage-types.json';
import factions from './combat/factions.json';
import unarmed from './combat/unarmed.json';
import './models';

/**
 * Hands this game's content to the engine. Must run before `game.init()`.
 * The combat files are the engine's basics (the player can still punch);
 * nothing in the office fights back.
 */
export function registerContent(): void {
  for (const [id, def] of Object.entries(damageTypes as Record<string, DamageTypeDef>)) registerDamageType(id, def);
  for (const [id, def] of Object.entries(factions as Record<string, FactionDef>)) registerFaction(id, structuredClone(def));
  setUnarmed(unarmed as WeaponDef);
  registerItems(items satisfies Record<string, ItemDef>);
}
