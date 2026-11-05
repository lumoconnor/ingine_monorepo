import * as THREE from 'three';
import type { Game } from './Game';
import type { System } from './System';
import type { FrameTime } from './Time';
import type { WorldStateSnapshot } from './WorldState';
import { PlayerController } from '@/gameplay/player/PlayerController';
import type { DialogueSystem } from '@/dialogue/DialogueSystem';
import { droppedPickups, restorePickups, type PickupSpec } from '@/inventory/pickups';

/** Components with persistent state (doors, lifts...) implement these two methods. */
export interface Saveable {
  saveState(): unknown;
  loadState(state: any): void;
}
const isSaveable = (c: object): c is Saveable => 'saveState' in c && 'loadState' in c;

export interface SaveData {
  /** 2 added item instances (weapons with their own ammo/condition). Version 1 saves still load. */
  version: 1 | 2;
  savedAt: number;
  state: WorldStateSnapshot;
  player: { feet: [number, number, number]; yaw: number; pitch: number };
  /** Items the player dropped. Level items are tracked by `world.taken.*` flags in `state`. */
  dropped: PickupSpec[];
  /** Saveable component states keyed by entity name (+ #n for repeats). */
  machines: Record<string, unknown>;
}

/** Default storage key. It predates format v2; kept so existing saves are found. */
const DEFAULT_KEY = 'owrpg.save.v1';
const AUTOSAVE_EVERY = 30;

/**
 * Save / load to browser storage. Everything the game needs is plain data:
 * WorldState (flags, vars, items, taken pickups), the player's pose, dropped
 * items, and any component implementing Saveable.
 *
 * Saves automatically after using things and finishing conversations, and
 * every 30 s of play. F5 saves, F9 loads.
 */
export class SaveSystem implements System {
  readonly name = 'save';
  private game!: Game;
  /** The world as freshly loaded: "New game" restores this. */
  private baseline: SaveData | null = null;
  private timer = 0;
  private pending = false;
  private warned = false;
  /** localStorage key. Each game should pass its own so games don't share saves. */
  private readonly key: string;

  constructor(options: { key?: string } = {}) {
    this.key = options.key ?? DEFAULT_KEY;
  }

  init(game: Game): void {
    this.game = game;
    game.events.on('level:loaded', () => {
      this.baseline = this.capture();
    });
    game.events.on('interact:used', () => (this.pending = true));
    game.events.on('dialogue:end', () => (this.pending = true));
    game.events.on('input:pressed', ({ action }) => {
      if (!game.input.locked) return;
      if (action === 'quickSave') this.save(false);
      else if (action === 'quickLoad') this.load();
    });
  }

  update(time: FrameTime): void {
    const g = this.game;
    const playing = g.input.locked && !g.paused && !g.getSystem<DialogueSystem>('dialogue')?.isActive;
    if (!playing) return;
    this.timer += time.delta;
    if (this.pending || this.timer >= AUTOSAVE_EVERY) this.save(true);
  }

  hasSave(): boolean {
    return this.read() !== null;
  }

  save(auto: boolean): boolean {
    this.pending = false;
    this.timer = 0;
    try {
      localStorage.setItem(this.key, JSON.stringify(this.capture()));
    } catch {
      if (!auto || !this.warned) this.game.events.emit('notify', { text: "Can't save here: browser storage is unavailable" });
      this.warned = true;
      return false;
    }
    if (!auto) this.game.events.emit('notify', { text: 'Game saved' });
    this.game.events.emit('game:saved', { auto });
    return true;
  }

  load(): boolean {
    const data = this.read();
    if (!data) {
      this.game.events.emit('notify', { text: 'No saved game' });
      return false;
    }
    this.apply(data);
    this.game.events.emit('notify', { text: 'Game loaded' });
    return true;
  }

  /** Forget the save and put the world back as it was when the level loaded. */
  newGame(): void {
    try {
      localStorage.removeItem(this.key);
    } catch {
      /* nothing to clear */
    }
    if (this.baseline) this.apply(this.baseline);
  }

  capture(): SaveData {
    const g = this.game;
    const ctrl = g.world.find('player')?.get(PlayerController);
    const feet = ctrl?.feetPosition ?? new THREE.Vector3();
    const machines: Record<string, unknown> = {};
    this.eachSaveable((key, c) => (machines[key] = c.saveState()));
    return {
      version: 2,
      savedAt: Date.now(),
      state: g.state.toJSON(),
      player: { feet: [feet.x, feet.y, feet.z], yaw: ctrl?.yaw ?? 0, pitch: ctrl?.pitch ?? 0 },
      dropped: droppedPickups(g).map((s) => ({ ...s })),
      machines,
    };
  }

  apply(data: SaveData): void {
    const g = this.game;
    g.getSystem<DialogueSystem>('dialogue')?.end();
    g.state.load(data.state);
    restorePickups(g, data.dropped ?? []);
    this.eachSaveable((key, c) => {
      if (key in data.machines) c.loadState(data.machines[key]);
    });
    const ctrl = g.world.find('player')?.get(PlayerController);
    ctrl?.placeAt(new THREE.Vector3(...data.player.feet), data.player.yaw, data.player.pitch);
    this.timer = 0;
    this.pending = false;
    g.events.emit('game:loaded', {});
  }

  private read(): SaveData | null {
    try {
      const raw = localStorage.getItem(this.key);
      const data = raw ? (JSON.parse(raw) as SaveData) : null;
      return data?.version === 1 || data?.version === 2 ? data : null;
    } catch {
      return null;
    }
  }

  /** Visits Saveable components with a stable key: entity name, plus #n when names repeat. */
  private eachSaveable(fn: (key: string, c: Saveable) => void): void {
    const seen = new Map<string, number>();
    for (const e of this.game.world.all()) {
      e.getAll().forEach((c, i) => {
        if (!isSaveable(c)) return;
        const base = `${e.name}/${i}`;
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        fn(n ? `${base}#${n}` : base, c);
      });
    }
  }
}
