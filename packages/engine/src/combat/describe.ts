import type { VarValue } from '../core/WorldState';
import type { ItemDef } from '../inventory/types';
import { Items } from '../inventory/catalog';
import { DamageTypes } from './registry';
import { resolveMode } from './blocks';

/** A short stats line for the inventory, from the weapon data. */
export function weaponSummary(def: ItemDef, data?: Record<string, VarValue>): string {
  const w = def.weapon!;
  const m = resolveMode(w, Object.keys(w.modes)[0]);
  const ammoDef = w.ammo?.[0] ? Items[w.ammo[0]] : undefined;
  const pay = m.payload ?? ammoDef?.payload;
  const dmg = pay?.damage.map((d) => `${d.amount} ${DamageTypes[d.type]?.name.toLowerCase() ?? d.type}`).join(' + ');
  const parts = [dmg ? `Damage ${dmg}` : ''];
  const f = m.feeder;
  if (f?.capacity) {
    const loaded = typeof data?.loaded === 'number' ? data.loaded : f.capacity;
    parts.push(`${loaded} / ${f.capacity} loaded${ammoDef ? ` (${ammoDef.name.toLowerCase()})` : ''}`);
  } else if (f?.kind === 'sequence') {
    parts.push(data?.loaded === 0 ? 'Not loaded' : 'Loaded');
  }
  return `\n\n${parts.filter(Boolean).join(' · ')}`;
}
