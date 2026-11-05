import damageTypesJson from '@/content/combat/damage-types.json';
import type { DamagePacket, DamageTypeDef, Hit, StatusSpec } from './types';
import type { Damageable } from './Damageable';

/**
 * Combat's extension points. Like the dialogue registry, each entry is data
 * plus a function, and games add their own without touching the engine:
 *
 *   registerDamageType('arcane', { name: 'Arcane' })
 *   registerModifier({ name: 'backstab', order: 25, apply: (ctx) => { ... } })
 */

export const DamageTypes: Record<string, DamageTypeDef> = { ...(damageTypesJson as Record<string, DamageTypeDef>) };

export function registerDamageType(id: string, def: DamageTypeDef): void {
  DamageTypes[id] = def;
}

export interface ModifierContext {
  hit: Hit;
  target: Damageable;
  /** The packets being applied. Modifiers change `amount` in place. */
  packets: DamagePacket[];
  /** Notes for the result and the HUD ("blocked", "parried"). */
  tags: Set<string>;
}

/**
 * One step of the damage pipeline. Steps run in `order` (lowest first) on a
 * copy of the hit's packets before health changes. Built in: block/parry
 * (10, combat/blocking.ts), zone (20), armour items (25, combat/Armour.ts),
 * resist (30).
 */
export interface DamageModifier {
  name: string;
  order: number;
  apply(ctx: ModifierContext): void;
}

const modifiers: DamageModifier[] = [];

export function registerModifier(m: DamageModifier): void {
  const i = modifiers.findIndex((x) => x.name === m.name);
  if (i !== -1) modifiers.splice(i, 1);
  modifiers.push(m);
  modifiers.sort((a, b) => a.order - b.order);
}

export function damageModifiers(): readonly DamageModifier[] {
  return modifiers;
}

// Built-in steps.
registerModifier({
  name: 'zone',
  order: 20,
  apply: ({ hit, target, packets }) => {
    if (!hit.zone) return;
    const mult = target.zoneMultiplier(hit.zone);
    for (const p of packets) if (!DamageTypes[p.type]?.ignoresZones) p.amount *= mult;
  },
});

registerModifier({
  name: 'resist',
  order: 30,
  apply: ({ target, packets }) => {
    for (const p of packets) {
      if (DamageTypes[p.type]?.ignoresResist) continue;
      const r = target.resist[p.type] ?? 0;
      p.amount *= 1 - Math.min(1, Math.max(-1, r));
    }
  },
});

/** Throws on packets with unknown types or bad amounts (content mistakes show up at once). */
export function checkPackets(where: string, packets: DamagePacket[]): void {
  for (const p of packets) {
    if (!(p.type in DamageTypes)) throw new Error(`${where}: unknown damage type "${p.type}" (known: ${Object.keys(DamageTypes).join(', ')})`);
    if (!(typeof p.amount === 'number' && Number.isFinite(p.amount) && p.amount >= 0)) throw new Error(`${where}: damage amount must be a number >= 0`);
  }
}

/**
 * Lasting conditions: bleeding, burning. Each deals `damage.perSecond` in
 * ticks of `interval` seconds while it lasts. `stack: "add"` adds the new
 * time to what's left (cut twice, bleed longer), up to `maxSeconds`;
 * "refresh" takes the longer of the two. `endsInWater` puts it out.
 */
export interface StatusDef {
  name: string;
  damage?: DamagePacket & { perSecond?: number };
  interval?: number;
  stack?: 'add' | 'refresh';
  maxSeconds?: number;
  endsInWater?: boolean;
}

export const Statuses: Record<string, StatusDef> = {
  bleeding: { name: 'Bleeding', damage: { type: 'bleed', amount: 0, perSecond: 2.5 }, interval: 0.5, stack: 'add', maxSeconds: 20 },
  burning: { name: 'Burning', damage: { type: 'fire', amount: 0, perSecond: 7 }, interval: 0.5, stack: 'refresh', maxSeconds: 10, endsInWater: true },
};

export function registerStatus(id: string, def: StatusDef): void {
  Statuses[id] = def;
}

export function checkStatuses(where: string, list: StatusSpec[] | undefined): void {
  for (const s of list ?? []) {
    if (!(s.id in Statuses)) throw new Error(`${where}: unknown status "${s.id}" (known: ${Object.keys(Statuses).join(', ')})`);
    if (!(typeof s.seconds === 'number' && s.seconds > 0)) throw new Error(`${where}: status "${s.id}" needs seconds > 0`);
  }
}
