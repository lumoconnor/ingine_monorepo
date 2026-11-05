import type { ItemDef } from '@/inventory/types';
import type { DamageTypeDef } from '@/combat/types';
import type { WeaponDef } from '@/combat/weaponTypes';
import type { Archetype } from '@/combat/ai/EnemyBrain';
import type { FactionDef } from '@/combat/ai/factions';
import type { ModelOverride } from '@/render/models/ModelRegistry';
import { registerItems } from '@/inventory/catalog';
import { registerDamageType } from '@/combat/registry';
import { registerFaction } from '@/combat/ai/factions';
import { setUnarmed } from '@/combat/Combatant';
import { registerArchetype } from '@/world/enemies';
import { registerModelOverrides } from '@/render/models/ModelRegistry';
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
