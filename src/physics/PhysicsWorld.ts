import RAPIER from '@dimforge/rapier3d-compat';
import type { Game } from '@/core/Game';
import type { System } from '@/core/System';
import type { Entity } from '@/entities/Entity';

export { RAPIER };

/** Things that want a callback right after each physics step (e.g. transform sync). */
export interface PhysicsStepListener {
  beforePhysicsStep?(): void;
  afterPhysicsStep?(): void;
}

/**
 * Wraps the Rapier world. Rapier is a WebAssembly physics engine; this system
 * initialises it, steps it at the fixed rate, and keeps a lookup from Rapier
 * colliders back to game Entities so gameplay code can ask "what did I hit?".
 */
export class PhysicsWorld implements System {
  readonly name = 'physics';
  world!: RAPIER.World;
  private colliderOwners = new Map<number, Entity>();
  private listeners = new Set<PhysicsStepListener>();

  constructor(private gravity = { x: 0, y: -9.81, z: 0 }) {}

  async init(_game: Game): Promise<void> {
    await RAPIER.init();
    this.world = new RAPIER.World(this.gravity);
  }

  postFixedUpdate(dt: number): void {
    this.world.timestep = dt;
    for (const l of this.listeners) l.beforePhysicsStep?.();
    this.world.step();
    for (const l of this.listeners) l.afterPhysicsStep?.();
  }

  addStepListener(l: PhysicsStepListener): void {
    this.listeners.add(l);
  }

  removeStepListener(l: PhysicsStepListener): void {
    this.listeners.delete(l);
  }

  /** Associate a collider with the entity that owns it. */
  registerCollider(collider: RAPIER.Collider, owner: Entity): void {
    this.colliderOwners.set(collider.handle, owner);
  }

  unregisterCollider(collider: RAPIER.Collider): void {
    this.colliderOwners.delete(collider.handle);
  }

  ownerOf(collider: RAPIER.Collider | null | undefined): Entity | undefined {
    return collider ? this.colliderOwners.get(collider.handle) : undefined;
  }

  dispose(): void {
    this.world?.free();
  }
}
