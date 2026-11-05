import type { ItemInstance, VarValue } from '../core/WorldState';
import { Items } from '../inventory/catalog';
import { isInstanced } from '../inventory/types';

/**
 * Where a Combatant's weapons and ammo live. The player's is the WorldState
 * inventory (it already has these methods); an NPC carries a LocalBag of its
 * own, so its musket and cartridges never touch yours until you loot them.
 */
export interface Bag {
  itemCount(item: string): number;
  removeItem(item: string, count?: number): number;
  instance(uid: string): ItemInstance | undefined;
  instancesOf(item?: string): ItemInstance[];
  setInstanceData(uid: string, key: string, value: VarValue): void;
}

export class LocalBag implements Bag {
  private counts = new Map<string, number>();
  private instances: ItemInstance[] = [];
  private next = 1;

  /** `{ musket: 1, musket_balls: 12 }`: weapons become instances, the rest counts. */
  constructor(contents: Record<string, number> = {}) {
    for (const [item, n] of Object.entries(contents)) this.add(item, n);
  }

  add(item: string, n = 1, data: Record<string, VarValue> = {}): void {
    if (isInstanced(Items[item])) {
      for (let i = 0; i < n; i++) this.instances.push({ uid: `${item}#npc${this.next++}`, item, data: { ...data } });
    } else {
      this.counts.set(item, (this.counts.get(item) ?? 0) + n);
    }
  }

  itemCount(item: string): number {
    return (this.counts.get(item) ?? 0) + this.instances.filter((i) => i.item === item).length;
  }

  removeItem(item: string, count = 1): number {
    const have = this.counts.get(item) ?? 0;
    const n = Math.min(have, count);
    this.counts.set(item, have - n);
    return n;
  }

  instance(uid: string): ItemInstance | undefined {
    return this.instances.find((i) => i.uid === uid);
  }

  instancesOf(item?: string): ItemInstance[] {
    return item ? this.instances.filter((i) => i.item === item) : [...this.instances];
  }

  setInstanceData(uid: string, key: string, value: VarValue): void {
    const i = this.instance(uid);
    if (i) i.data[key] = value;
  }

  /** Everything in it, for loot: instances with their data, then counts. */
  contents(): { item: string; count: number; data?: Record<string, VarValue> }[] {
    return [
      ...this.instances.map((i) => ({ item: i.item, count: 1, data: { ...i.data } })),
      ...[...this.counts].filter(([, n]) => n > 0).map(([item, count]) => ({ item, count })),
    ];
  }

  clear(): void {
    this.counts.clear();
    this.instances = [];
  }
}
