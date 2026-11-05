import type RAPIER from '@dimforge/rapier3d-compat';
import { Component } from '@/entities/Component';
import type { Entity } from '@/entities/Entity';

export interface InteractableOptions {
  /** Shown under the crosshair as "[E] <prompt>". A function lets it reflect state ("Open" / "Close"). */
  prompt: string | (() => string);
  onInteract: (user: Entity) => void;
  /** Max distance from the eye, in metres. */
  range?: number;
  /**
   * Only these colliders count as "looking at it". Useful when the entity has
   * other colliders too, e.g. the control post on a lift platform (looking at
   * the floor shouldn't offer "Use lift").
   */
  colliders?: () => RAPIER.Collider[];
}

/**
 * Marks an entity as something the player can use with the interact key.
 * The PlayerInteractor finds it by ray-casting from the camera and looking up
 * the owner of the collider it hits, so any entity with a collider can opt in.
 */
export class Interactable extends Component {
  range: number;

  constructor(private opts: InteractableOptions) {
    super();
    this.range = opts.range ?? 2.6;
  }

  get prompt(): string {
    const p = this.opts.prompt;
    return typeof p === 'function' ? p() : p;
  }

  accepts(collider: RAPIER.Collider): boolean {
    const only = this.opts.colliders?.();
    return !only || only.some((c) => c.handle === collider.handle);
  }

  interact(user: Entity): void {
    if (!this.enabled) return;
    this.opts.onInteract(user);
    this.game.events.emit('interact:used', { name: this.entity.name });
  }
}
