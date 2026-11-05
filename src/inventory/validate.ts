import { Effects, checkParam } from '@/dialogue/registry';
import { CATEGORIES, type ItemDef } from './types';
import './models';
import { hasModel, modelIds, modelDef, validateModelOverrides } from '@/render/models/ModelRegistry';
import { checkPayload, validateWeapon } from '@/combat/blocks';
import { DamageTypes } from '@/combat/registry';

/** Checks the item catalogue; throws one error listing every problem. */
export function validateItems(items: Record<string, ItemDef>): void {
  const errors: string[] = [];
  for (const [id, d] of Object.entries(items)) {
    const err = (msg: string) => errors.push(`${id}: ${msg}`);
    if (!/^[a-z0-9_]+$/.test(id)) err('ids must be lower_snake_case');
    if (!d.name) err('missing "name"');
    if (!d.description) err('missing "description"');
    if (!CATEGORIES.includes(d.category as never)) err(`"category" must be one of ${CATEGORIES.join(', ')}`);
    if (!hasModel(d.model)) err(`unknown model "${d.model}" (known: ${modelIds().join(', ')})`);
    else if (modelDef(d.model)!.kind === 'prop' || modelDef(d.model)!.kind === 'flight') err(`model "${d.model}" is a ${modelDef(d.model)!.kind} model, not an item model`);
    if (d.flightModel !== undefined && !hasModel(d.flightModel)) err(`unknown flightModel "${d.flightModel}"`);
    if (d.weapon?.view?.model !== undefined && !hasModel(d.weapon.view.model)) err(`unknown weapon.view.model "${d.weapon.view.model}"`);
    if (d.maxStack !== undefined && !(Number.isInteger(d.maxStack) && d.maxStack > 0)) err('"maxStack" must be a positive whole number');
    if (d.text !== undefined && typeof d.text !== 'string') err('"text" must be a string');
    if (d.useLabel !== undefined && !d.use) err('"useLabel" without "use"');
    if (d.category === 'currency' && d.use) err('currency can\'t have "use"');
    d.use?.forEach((e, i) => {
      const def = Effects[e?.do];
      if (!def) return err(`use[${i}]: unknown effect "${e?.do}"`);
      for (const [k, spec] of Object.entries(def.params)) {
        const msg = checkParam(spec, e[k]);
        if (msg) err(`use[${i}]: "${k}" ${msg}`);
      }
      for (const k of Object.keys(e)) if (k !== 'do' && !(k in def.params)) err(`use[${i}]: unknown parameter "${k}"`);
    });
  }
  for (const [id, d] of Object.entries(items)) {
    if (d.weapon) validateWeapon(errors, id, d.weapon, (a) => items[a]?.category === 'ammo');
    if (d.category === 'weapon' && !d.weapon) errors.push(`${id}: category "weapon" needs a "weapon" block`);
    if (d.payload) checkPayload(errors, id, d.payload);
    if (d.category === 'armour' && !d.armour) errors.push(`${id}: category "armour" needs an "armour" block`);
    if (d.armour) {
      const a = d.armour;
      if (!a.slot) errors.push(`${id}: armour needs a "slot"`);
      if (!Array.isArray(a.covers) || !a.covers.length) errors.push(`${id}: armour needs "covers" (zones: head, torso, limbs)`);
      for (const [t, r] of Object.entries(a.resist ?? {})) {
        if (!(t in DamageTypes)) errors.push(`${id}: armour resist: unknown damage type "${t}"`);
        if (!(typeof r === 'number' && r >= 0 && r <= 1)) errors.push(`${id}: armour resist "${t}" must be 0..1`);
      }
    }
  }
  errors.push(...validateModelOverrides());
  if (errors.length) throw new Error(`Item catalogue is invalid:\n  ${errors.join('\n  ')}`);
}
