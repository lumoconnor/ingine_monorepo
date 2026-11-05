import type { EventBus } from './EventBus';

export type VarValue = number | string | boolean;

/**
 * One particular item with its own state, e.g. a pistol with 5 rounds loaded
 * and 80% condition. Weapons and armour are instances; arrows and apples are
 * plain counts.
 */
export interface ItemInstance {
  uid: string;
  item: string;
  data: Record<string, VarValue>;
}

export interface WorldStateSnapshot {
  flags: string[];
  vars: Record<string, VarValue>;
  items: Record<string, number>;
  /** Added in save format v2. */
  instances?: ItemInstance[];
  nextUid?: number;
}

/**
 * Global game state that content (dialogue, quests, triggers) reads and
 * writes: boolean flags, named variables, and the player's item counts.
 * Everything is plain data so it serialises straight into a save file.
 *
 * Emits 'state:changed' on every change so UI and other systems can react.
 */
export class WorldState {
  private flags = new Set<string>();
  private vars = new Map<string, VarValue>();
  private items = new Map<string, number>();
  private instances = new Map<string, ItemInstance>();
  private nextUid = 1;
  /**
   * Which items are kept as instances. Set by the inventory from the item
   * catalogue; core code doesn't know item definitions.
   */
  isInstanced: (item: string) => boolean = () => false;

  constructor(private events: EventBus) {}

  hasFlag(flag: string): boolean {
    return this.flags.has(flag);
  }

  setFlag(flag: string, on = true): void {
    if (this.flags.has(flag) === on) return;
    if (on) this.flags.add(flag);
    else this.flags.delete(flag);
    this.events.emit('state:changed', { kind: 'flag', key: flag });
  }

  clearFlag(flag: string): void {
    this.setFlag(flag, false);
  }

  getVar(name: string): VarValue | undefined {
    return this.vars.get(name);
  }

  setVar(name: string, value: VarValue): void {
    if (this.vars.get(name) === value) return;
    this.vars.set(name, value);
    this.events.emit('state:changed', { kind: 'var', key: name });
  }

  addVar(name: string, delta: number): void {
    const cur = this.vars.get(name);
    this.setVar(name, (typeof cur === 'number' ? cur : 0) + delta);
  }

  itemCount(item: string): number {
    let n = this.items.get(item) ?? 0;
    for (const i of this.instances.values()) if (i.item === item) n++;
    return n;
  }

  /** Adds (or with a negative count, removes) items. Instanced items get fresh instances. */
  addItem(item: string, count = 1): void {
    if (count === 0) return;
    if (this.isInstanced(item)) {
      if (count > 0) for (let k = 0; k < count; k++) this.addInstance(item);
      else for (const inst of this.instancesOf(item).reverse().slice(0, -count)) this.removeInstance(inst.uid);
      return;
    }
    const n = Math.max(0, this.itemCount(item) + count);
    if (n === 0) this.items.delete(item);
    else this.items.set(item, n);
    this.events.emit('state:changed', { kind: 'item', key: item });
  }

  /** Removes up to `count`; returns how many were actually removed. */
  removeItem(item: string, count = 1): number {
    const have = this.itemCount(item);
    const n = Math.min(have, count);
    this.addItem(item, -n);
    return n;
  }

  /** Creates an instance (e.g. a picked-up sword); returns its uid. */
  addInstance(item: string, data: Record<string, VarValue> = {}): string {
    const uid = `${item}#${this.nextUid++}`;
    this.instances.set(uid, { uid, item, data: { ...data } });
    this.events.emit('state:changed', { kind: 'item', key: item });
    return uid;
  }

  removeInstance(uid: string): ItemInstance | undefined {
    const inst = this.instances.get(uid);
    if (!inst) return undefined;
    this.instances.delete(uid);
    this.events.emit('state:changed', { kind: 'item', key: inst.item });
    return inst;
  }

  instance(uid: string): ItemInstance | undefined {
    return this.instances.get(uid);
  }

  /** Instances of one item, or of everything, oldest first. */
  instancesOf(item?: string): ItemInstance[] {
    return [...this.instances.values()].filter((i) => item === undefined || i.item === item);
  }

  /** Changes one value on an instance (ammo loaded, condition). Doesn't emit: it changes every shot. */
  setInstanceData(uid: string, key: string, value: VarValue): void {
    const inst = this.instances.get(uid);
    if (inst) inst.data[key] = value;
  }

  /** All items with a non-zero count (instances counted too), for inventory UI and debugging. */
  inventory(): [string, number][] {
    const out = new Map(this.items);
    for (const i of this.instances.values()) out.set(i.item, (out.get(i.item) ?? 0) + 1);
    return [...out.entries()];
  }

  toJSON(): WorldStateSnapshot {
    return {
      flags: [...this.flags],
      vars: Object.fromEntries(this.vars),
      items: Object.fromEntries(this.items),
      instances: [...this.instances.values()].map((i) => ({ uid: i.uid, item: i.item, data: { ...i.data } })),
      nextUid: this.nextUid,
    };
  }

  load(s: WorldStateSnapshot): void {
    this.flags = new Set(s.flags);
    this.vars = new Map(Object.entries(s.vars));
    this.items = new Map(Object.entries(s.items));
    this.instances = new Map((s.instances ?? []).map((i) => [i.uid, { uid: i.uid, item: i.item, data: { ...i.data } }]));
    this.nextUid = s.nextUid ?? 1;
    // A v1 save may hold a count of something that is now instanced: turn it into instances.
    for (const [item, n] of [...this.items]) {
      if (!this.isInstanced(item)) continue;
      this.items.delete(item);
      for (let k = 0; k < n; k++) {
        const uid = `${item}#${this.nextUid++}`;
        this.instances.set(uid, { uid, item, data: {} });
      }
    }
    this.events.emit('state:changed', { kind: 'load', key: '' });
  }

  reset(): void {
    this.load({ flags: [], vars: {}, items: {}, instances: [], nextUid: 1 });
  }
}
