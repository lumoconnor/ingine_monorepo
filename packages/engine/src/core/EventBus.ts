/**
 * Minimal strongly-typed pub/sub. Systems talk to each other through events
 * instead of holding direct references, which keeps modules decoupled as the
 * game grows (UI, audio, quests, achievements can all just listen).
 *
 * Add new events to `GameEvents` below.
 */
export interface GameEvents {
  'input:pointerlock': { locked: boolean };
  /** Fired synchronously inside the keydown handler (counts as a user gesture). */
  'input:pressed': { action: import('../config/bindings').Action };
  'player:jumped': { position: { x: number; y: number; z: number } };
  'player:landed': { fallSpeed: number };
  'player:crouch': { crouched: boolean };
  /** What the player is looking at changed: prompt text, or null when nothing usable is in reach. */
  'interact:focus': { prompt: string | null };
  'interact:used': { name: string };
  'player:underwater': { underwater: boolean };
  'player:swim': { swimming: boolean };
  'level:loaded': { name: string };
  /** WorldState changed (flag, var, item, or a whole save loaded). */
  'state:changed': { kind: 'flag' | 'var' | 'item' | 'load'; key: string };
  /** Short on-screen message, e.g. "Got Rusty key" or "New task: ...". */
  notify: { text: string };
  'dialogue:start': { npc: string; speaker: string };
  /** A line to show. `choices` are already filtered by their conditions. */
  'dialogue:line': {
    speaker: string;
    text: string;
    choices: { text: string; seen: boolean }[];
  };
  'dialogue:end': { npc: string };
  'inventory:open': Record<string, never>;
  'inventory:close': Record<string, never>;
  'game:saved': { auto: boolean };
  'game:loaded': Record<string, never>;
  'debug:toggle': { visible: boolean };
  /** An attack started (swing, shot, throw). */
  'combat:attack': { attacker: import('../entities/Entity').Entity; source: string };
  /** A Damageable took a hit (result.damage may be 0, e.g. fully resisted). */
  'combat:hit': {
    hit: import('../combat/types').Hit;
    target: import('../entities/Entity').Entity;
    result: import('../combat/types').HitResult;
  };
  /** An attack struck something that can't be hurt (wall, crate). */
  'combat:impact': { source: string; point: { x: number; y: number; z: number } };
  'combat:killed': { target: import('../entities/Entity').Entity; attacker: import('../entities/Entity').Entity | null; source: string };
  'combat:healed': { target: import('../entities/Entity').Entity; amount: number; health: number };
  'combat:revived': { target: import('../entities/Entity').Entity };
  /** A combatant drew a weapon (item id) or put it away (null). */
  'combat:equip': { entity: import('../entities/Entity').Entity; item: string | null };
  /** A shot or throw left (after any trigger delay). */
  'combat:fired': { attacker: import('../entities/Entity').Entity; item: string | null; mode: string };
  /** Pulled the trigger and nothing happened. */
  'combat:dry': { entity: import('../entities/Entity').Entity; reason: 'empty' | 'no ammo' | 'jammed' | 'misfire' | 'winded' };
  /** An NPC spotted an enemy and shouts to its allies. */
  'ai:alert': { from: import('../entities/Entity').Entity; target: import('../entities/Entity').Entity; point: { x: number; y: number; z: number } };
  /** A piece of armour was put on or taken off. */
  'combat:armour': { entity: import('../entities/Entity').Entity; item: string; on: boolean };
  /** A status (bleeding, burning) started or ended on someone. */
  'combat:status': { target: import('../entities/Entity').Entity; status: string; on: boolean };
  /** A melee attack met a parry: `attacker` is staggered. */
  'combat:parried': { defender: import('../entities/Entity').Entity; attacker: import('../entities/Entity').Entity };
  /** Knocked off balance (parried, guard broken): can't act for a moment. */
  'combat:staggered': { entity: import('../entities/Entity').Entity; seconds: number; reason: string };
  /** Something blew up (for the view shake and effects). */
  'combat:explosion': { point: { x: number; y: number; z: number }; radius: number };
  /** A reload (or one of its steps) started. */
  'combat:reload': { entity: import('../entities/Entity').Entity; item: string | null; step: string | null };
}

type Handler<T> = (payload: T) => void;

export class EventBus<Events extends object = GameEvents> {
  private handlers = new Map<keyof Events, Set<Handler<any>>>();

  on<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => this.off(type, handler);
  }

  off<K extends keyof Events>(type: K, handler: Handler<Events[K]>): void {
    this.handlers.get(type)?.delete(handler);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    this.handlers.get(type)?.forEach((h) => h(payload));
  }

  clear(): void {
    this.handlers.clear();
  }
}
