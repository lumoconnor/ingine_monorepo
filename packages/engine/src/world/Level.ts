import type { Game } from '../core/Game';

/**
 * A Level builds a chunk of world: static geometry, entities, spawn points.
 * The open world will eventually be made of streamed cells that follow the
 * same contract; the playground is just the first one.
 */
export interface Level {
  readonly name: string;
  load(game: Game): void | Promise<void>;
  unload?(game: Game): void;
}
