import type { Game } from '@/core/Game';
import type { VarValue } from '@/core/WorldState';
import { Items, itemLabel } from '@/inventory/catalog';
import { Damageable, killedFlag } from '@/combat/Damageable';
import { DamageTypes } from '@/combat/registry';

/**
 * The verbs dialogue (and later quests and triggers) can use. Each entry
 * declares its parameters so content is validated at load time, and a
 * function that runs it. Adding a new one here makes it available to every
 * JSON file: `{ "if": "name", ... }` or `{ "do": "name", ... }`.
 */

type ParamType = 'string' | 'number' | 'value' | 'op' | 'item' | 'damageType';

export interface ParamSpec {
  type: ParamType;
  optional?: boolean;
}

export interface Context {
  game: Game;
  /** Id of the tree being run, so `visited` can default to it. */
  tree: string;
  /** The item being used, when effects run from an item's Use button. */
  item?: string;
}

type Args = Record<string, any>;

export interface ConditionDef {
  params: Record<string, ParamSpec>;
  test(ctx: Context, a: Args): boolean;
}

export interface EffectDef {
  params: Record<string, ParamSpec>;
  /** Only meaningful when using an item (e.g. `consume`). */
  itemOnly?: boolean;
  run(ctx: Context, a: Args): void;
}

const OPS = ['==', '!=', '<', '<=', '>', '>='] as const;

function compare(a: VarValue | undefined, op: string, b: VarValue): boolean {
  switch (op) {
    case '==': return a === b;
    case '!=': return a !== b;
    case '<': return typeof a === 'number' && typeof b === 'number' && a < b;
    case '<=': return typeof a === 'number' && typeof b === 'number' && a <= b;
    case '>': return typeof a === 'number' && typeof b === 'number' && a > b;
    case '>=': return typeof a === 'number' && typeof b === 'number' && a >= b;
  }
  return false;
}

export const visitedFlag = (tree: string, node: string) => `dialogue.visited.${tree}.${node}`;
export const seenFlag = (tree: string, node: string, choice: number) => `dialogue.seen.${tree}.${node}.${choice}`;

export const Conditions: Record<string, ConditionDef> = {
  flag: {
    params: { flag: { type: 'string' } },
    test: ({ game }, a) => game.state.hasFlag(a.flag),
  },
  hasItem: {
    params: { item: { type: 'item' }, count: { type: 'number', optional: true } },
    test: ({ game }, a) => game.state.itemCount(a.item) >= (a.count ?? 1),
  },
  var: {
    params: { var: { type: 'string' }, op: { type: 'op', optional: true }, value: { type: 'value' } },
    test: ({ game }, a) => compare(game.state.getVar(a.var), a.op ?? '==', a.value),
  },
  /** Has the Damageable with this id ever been killed? (Training dummies count once.) */
  killed: {
    params: { id: { type: 'string' } },
    test: ({ game }, a) => game.state.hasFlag(killedFlag(a.id)),
  },
  /** Compare the player's health (in points): `{ "if": "health", "op": "<", "value": 50 }`. */
  health: {
    params: { op: { type: 'op', optional: true }, value: { type: 'number' } },
    test: ({ game }, a) => compare(playerHealth(game)?.health, a.op ?? '==', a.value),
  },
  /** Has the player seen this node (of this tree, or of `tree`)? */
  visited: {
    params: { node: { type: 'string' }, tree: { type: 'string', optional: true } },
    test: ({ game, tree }, a) => game.state.hasFlag(visitedFlag(a.tree ?? tree, a.node)),
  },
};

export const Effects: Record<string, EffectDef> = {
  setFlag: {
    params: { flag: { type: 'string' } },
    run: ({ game }, a) => game.state.setFlag(a.flag),
  },
  clearFlag: {
    params: { flag: { type: 'string' } },
    run: ({ game }, a) => game.state.clearFlag(a.flag),
  },
  setVar: {
    params: { var: { type: 'string' }, value: { type: 'value' } },
    run: ({ game }, a) => game.state.setVar(a.var, a.value),
  },
  addVar: {
    params: { var: { type: 'string' }, value: { type: 'number' } },
    run: ({ game }, a) => game.state.addVar(a.var, a.value),
  },
  giveItem: {
    params: { item: { type: 'item' }, count: { type: 'number', optional: true } },
    run: ({ game }, a) => {
      const n = a.count ?? 1;
      game.state.addItem(a.item, n);
      game.events.emit('notify', { text: `Received ${itemLabel(a.item, n)}` });
    },
  },
  takeItem: {
    params: { item: { type: 'item' }, count: { type: 'number', optional: true } },
    run: ({ game }, a) => {
      const n = game.state.removeItem(a.item, a.count ?? 1);
      if (n > 0) game.events.emit('notify', { text: `Gave ${itemLabel(a.item, n)}` });
    },
  },
  notify: {
    params: { text: { type: 'string' } },
    run: ({ game }, a) => game.events.emit('notify', { text: a.text }),
  },
  /** Restore the player's health, up to their maximum. */
  heal: {
    params: { amount: { type: 'number' } },
    run: ({ game }, a) => {
      const d = playerHealth(game);
      if (!d) return;
      const n = d.heal(a.amount);
      game.events.emit('notify', { text: n > 0 ? `+${Math.round(n)} health` : 'Already at full health' });
    },
  },
  /** End a status on the player (bandages stop bleeding): `{ "do": "cure", "status": "bleeding" }`. */
  cure: {
    params: { status: { type: 'string' } },
    run: ({ game }, a) => {
      if (playerHealth(game)?.cure(a.status)) game.events.emit('notify', { text: a.status === 'bleeding' ? 'The bleeding stops.' : a.status === 'burning' ? 'The flames go out.' : `No longer ${a.status}.` });
    },
  },
  /** Hurt the player (a trap in a chest, a poisoned drink). */
  damage: {
    params: { amount: { type: 'number' }, type: { type: 'damageType', optional: true } },
    run: ({ game }, a) => {
      playerHealth(game)?.applyHit({ attacker: null, packets: [{ type: a.type ?? 'blunt', amount: a.amount }], zone: null, source: 'effect' });
    },
  },
  /** Use up one of the item being used. */
  consume: {
    params: {},
    itemOnly: true,
    run: ({ game, item }) => {
      if (item) game.state.removeItem(item, 1);
    },
  },
};

/**
 * Adds a condition verb for every JSON file (dialogue, items, later quests).
 * Games call this before `game.init()` so validation knows the verb.
 */
export function registerCondition(name: string, def: ConditionDef): void {
  if (name in Conditions) throw new Error(`Condition "${name}" registered twice`);
  Conditions[name] = def;
}

/** Adds an effect verb (`{ "do": name, ... }`). Same rules as registerCondition. */
export function registerEffect(name: string, def: EffectDef): void {
  if (name in Effects) throw new Error(`Effect "${name}" registered twice`);
  Effects[name] = def;
}

function playerHealth(game: Game): Damageable | undefined {
  return game.world.find('player')?.get(Damageable);
}

/** Returns an error message, or null if `value` fits the parameter type. */
export function checkParam(spec: ParamSpec, value: unknown): string | null {
  if (value === undefined) return spec.optional ? null : 'is required';
  switch (spec.type) {
    case 'string':
      return typeof value === 'string' && value.length > 0 ? null : 'must be a non-empty string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'must be a number';
    case 'value':
      return ['string', 'number', 'boolean'].includes(typeof value) ? null : 'must be a string, number or boolean';
    case 'op':
      return (OPS as readonly unknown[]).includes(value) ? null : `must be one of ${OPS.join(' ')}`;
    case 'item':
      return typeof value === 'string' && value in Items ? null : `must be an item id (${Object.keys(Items).join(', ')})`;
    case 'damageType':
      return typeof value === 'string' && value in DamageTypes ? null : `must be a damage type (${Object.keys(DamageTypes).join(', ')})`;
  }
}

export function testAll(ctx: Context, conds: { if: string; not?: boolean }[] | undefined): boolean {
  if (!conds) return true;
  return conds.every((c) => Conditions[c.if].test(ctx, c) !== !!c.not);
}

export function runAll(ctx: Context, effects: { do: string }[] | undefined): void {
  effects?.forEach((e) => Effects[e.do].run(ctx, e));
}
