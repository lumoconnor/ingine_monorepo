import type { Game } from './Game';
import type { FrameTime } from './Time';

/**
 * A System is a global, long-lived module (input, physics, rendering, audio,
 * AI director, save/load...). Systems are registered on the Game in order and
 * receive lifecycle callbacks. Per-object behaviour belongs in Components.
 */
export interface System {
  readonly name: string;
  init?(game: Game): void | Promise<void>;
  /** Called before entity fixed updates each fixed step. */
  preFixedUpdate?(dt: number): void;
  /** Called after entity fixed updates each fixed step (e.g. physics step). */
  postFixedUpdate?(dt: number): void;
  /** Called once per rendered frame after entities update. */
  update?(time: FrameTime): void;
  dispose?(): void;
}
