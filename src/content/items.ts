import type { ItemDef } from '@/inventory/types';
import items from './items.json';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep merge for `extends`: objects merge key by key, arrays and values replace. */
function merge(base: Json, over: Json): Json {
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(out[k]) ? merge(out[k] as Json, v) : v;
  return out;
}

/** Resolves `"extends": "other_id"` chains, so variants only list what differs. */
export function resolveExtends(raw: Record<string, ItemDef>): Record<string, ItemDef> {
  const done: Record<string, ItemDef> = {};
  const visiting = new Set<string>();
  const resolve = (id: string): ItemDef => {
    if (done[id]) return done[id];
    const def = raw[id];
    if (!def) throw new Error(`Item "${id}" extends unknown item`);
    if (!def.extends) return (done[id] = def);
    if (visiting.has(id)) throw new Error(`Item "${id}": "extends" loops`);
    visiting.add(id);
    const { extends: parent, ...rest } = def;
    const merged = merge(resolve(parent!) as unknown as Json, rest as unknown as Json) as unknown as ItemDef;
    visiting.delete(id);
    return (done[id] = merged);
  };
  for (const id of Object.keys(raw)) resolve(id);
  return done;
}

/**
 * Item catalogue. Dialogue, pickups and the inventory refer to items by
 * these ids. `satisfies` type-checks the JSON; `validateItems` (run by the
 * InventorySystem at startup) checks models, use-effects and weapons.
 */
export const Items: Record<string, ItemDef> = resolveExtends(items satisfies Record<string, ItemDef>);

export function itemLabel(id: string, count = 1): string {
  const def = Items[id];
  const name = def?.name ?? id;
  if (def?.category === 'currency') return `${count} ${name}`;
  return count === 1 ? name : `${name} ×${count}`;
}
