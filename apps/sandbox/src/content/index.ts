import type { ItemDef } from '@ingine/engine/inventory/types';
import type { DamageTypeDef } from '@ingine/engine/combat/types';
import type { WeaponDef } from '@ingine/engine/combat/weaponTypes';
import type { Archetype } from '@ingine/engine/combat/ai/EnemyBrain';
import type { FactionDef } from '@ingine/engine/combat/ai/factions';
import type { ModelOverride } from '@ingine/engine/render/models/ModelRegistry';
import { registerItems } from '@ingine/engine/inventory/catalog';
import { registerDamageType } from '@ingine/engine/combat/registry';
import { registerFaction } from '@ingine/engine/combat/ai/factions';
import { setUnarmed } from '@ingine/engine/combat/Combatant';
import { registerArchetype } from '@ingine/engine/world/enemies';
import { registerModelOverrides } from '@ingine/engine/render/models/ModelRegistry';
import items from './items.json';
import damageTypes from './combat/damage-types.json';
import factions from './combat/factions.json';
import unarmed from './combat/unarmed.json';
import archetypes from './combat/archetypes.json';
import models from './models.json';

export { dialogueTrees } from './dialogue';

/**
 * Hands this game's content to the engine. The engine never imports from
 * src/content; everything game-specific arrives through these register calls,
 * which must run before `game.init()` (validators run there).
 */
export function registerContent(): void {
  for (const [id, def] of Object.entries(damageTypes as Record<string, DamageTypeDef>)) registerDamageType(id, def);
  for (const [id, def] of Object.entries(factions as Record<string, FactionDef>)) registerFaction(id, structuredClone(def));
  setUnarmed(unarmed as WeaponDef);
  registerItems(items satisfies Record<string, ItemDef>);
  for (const [id, def] of Object.entries(archetypes as Record<string, Archetype>)) registerArchetype(id, def);
  registerModelOverrides(models as Record<string, ModelOverride>);
}
