/**
 * What you find where. Each table is a list of entries; a roll picks one by
 * weight and a count in its range. Chests roll a table a few times (repeats
 * stack). Tables are plain data so they're easy to tune.
 */

export interface LootEntry {
  item: string;
  weight: number;
  min: number;
  max: number;
}

export type LootTable = 'house' | 'shelf' | 'camp' | 'ruin' | 'cache';

export const LOOT: Record<LootTable, { rolls: [number, number]; entries: LootEntry[] }> = {
  /** A villager's chest: household odds and ends. */
  house: {
    rolls: [1, 3],
    entries: [
      { item: 'gold', weight: 5, min: 2, max: 9 },
      { item: 'bandage', weight: 3, min: 1, max: 2 },
      { item: 'apple', weight: 3, min: 1, max: 4 },
      { item: 'cider', weight: 2, min: 1, max: 2 },
      { item: 'arrows', weight: 1, min: 4, max: 10 },
      { item: 'healing_draught', weight: 1, min: 1, max: 1 },
    ],
  },
  /** Something left on a table. */
  shelf: {
    rolls: [1, 1],
    entries: [
      { item: 'apple', weight: 4, min: 1, max: 1 },
      { item: 'cider', weight: 3, min: 1, max: 1 },
      { item: 'bandage', weight: 2, min: 1, max: 1 },
      { item: 'gold', weight: 2, min: 1, max: 3 },
    ],
  },
  /** A bandit leader's stash. */
  camp: {
    rolls: [2, 4],
    entries: [
      { item: 'gold', weight: 6, min: 8, max: 25 },
      { item: 'musket_cartridges', weight: 2, min: 2, max: 6 },
      { item: 'arrows', weight: 2, min: 6, max: 14 },
      { item: 'bandage', weight: 2, min: 1, max: 3 },
      { item: 'healing_draught', weight: 2, min: 1, max: 2 },
      { item: 'leather_cap', weight: 1, min: 1, max: 1 },
      { item: 'grenade', weight: 1, min: 1, max: 2 },
    ],
  },
  /** Old soldiers' kit in a ruined keep. */
  ruin: {
    rolls: [2, 4],
    entries: [
      { item: 'gold', weight: 5, min: 15, max: 40 },
      { item: 'steel_helm', weight: 2, min: 1, max: 1 },
      { item: 'mail_hauberk', weight: 1, min: 1, max: 1 },
      { item: 'longbow', weight: 1, min: 1, max: 1 },
      { item: 'fire_arrows', weight: 2, min: 3, max: 8 },
      { item: 'healing_draught', weight: 2, min: 1, max: 2 },
      { item: 'grenade', weight: 1, min: 1, max: 3 },
    ],
  },
  /** A hidden cache: the best odds in the world. */
  cache: {
    rolls: [3, 5],
    entries: [
      { item: 'gold', weight: 5, min: 30, max: 80 },
      { item: 'healing_draught', weight: 3, min: 1, max: 3 },
      { item: 'fire_arrows', weight: 2, min: 6, max: 12 },
      { item: 'grenade', weight: 2, min: 2, max: 4 },
      { item: 'mail_hauberk', weight: 1, min: 1, max: 1 },
      { item: 'steel_helm', weight: 1, min: 1, max: 1 },
      { item: 'pistol', weight: 1, min: 1, max: 1 },
      { item: 'pistol_rounds', weight: 2, min: 8, max: 16 },
      { item: 'longbow', weight: 1, min: 1, max: 1 },
    ],
  },
};

/** Roll a table: a list of { item, count } with repeats merged. */
export function rollLoot(table: LootTable, rand: () => number): { item: string; count: number }[] {
  const t = LOOT[table];
  const rolls = t.rolls[0] + Math.floor(rand() * (t.rolls[1] - t.rolls[0] + 1));
  const total = t.entries.reduce((s, e) => s + e.weight, 0);
  const out = new Map<string, number>();
  for (let r = 0; r < rolls; r++) {
    let x = rand() * total;
    const e = t.entries.find((e) => (x -= e.weight) <= 0) ?? t.entries[0];
    const n = e.min + Math.floor(rand() * (e.max - e.min + 1));
    out.set(e.item, (out.get(e.item) ?? 0) + n);
  }
  // Gear isn't stacked: one helmet is plenty.
  return [...out].map(([item, count]) => ({ item, count: ['steel_helm', 'mail_hauberk', 'longbow', 'pistol', 'leather_cap'].includes(item) ? 1 : count }));
}
