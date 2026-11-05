import type { Entity } from './Entity';
import type { Game } from '@/core/Game';
import type { FrameTime } from '@/core/Time';

/**
 * Behaviour attached to an Entity. Override only the hooks you need.
 *
 * - `fixedUpdate` runs at the fixed simulation rate, before the physics step.
 * - `lateFixedUpdate` runs right after the physics step (character movement).
 * - `update` runs once per rendered frame (visuals, interpolation, camera).
 *
 * `order` controls execution order within a tick (lower first). For example
 * moving platforms run before the player so the player can ride them.
 */
export abstract class Component {
  entity!: Entity;
  game!: Game;
  enabled = true;
  order = 0;

  /** Called once when attached to an entity that is in the world. */
  onAttach?(): void;
  /** Called when the component or its entity is removed. Free resources here. */
  onDetach?(): void;
  fixedUpdate?(dt: number): void;
  /**
   * Runs each fixed step AFTER the physics world has stepped, so every body
   * is at its new pose. Character movement lives here.
   */
  lateFixedUpdate?(dt: number): void;
  update?(time: FrameTime): void;
}

export type ComponentClass<T extends Component> = abstract new (...args: any[]) => T;
