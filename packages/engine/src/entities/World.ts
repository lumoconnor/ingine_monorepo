import type { Game } from '../core/Game';
import type { FrameTime } from '../core/Time';
import type { Component } from './Component';
import { Entity } from './Entity';

/**
 * Owns all live entities and drives their components. A level populates the
 * World; unloading a level clears it. Later this is where spatial partitioning
 * / cell streaming for the open world will hook in.
 */
export class World {
  private entities = new Map<number, Entity>();
  private components: Component[] = [];
  private sortDirty = false;

  constructor(private game: Game) {}

  spawn(entity: Entity): Entity {
    if (entity.world) throw new Error(`Entity ${entity.name} already spawned`);
    entity.world = this;
    this.entities.set(entity.id, entity);
    this.game.renderer.scene.add(entity.object3d);
    for (const c of entity.getAll()) this.attachComponent(c);
    return entity;
  }

  destroy(entity: Entity): void {
    if (entity.world !== this) return;
    for (const c of [...entity.getAll()]) this.detachComponent(c);
    entity.object3d.removeFromParent();
    this.entities.delete(entity.id);
    entity.world = null;
  }

  clear(): void {
    for (const e of [...this.entities.values()]) this.destroy(e);
  }

  find(name: string): Entity | undefined {
    for (const e of this.entities.values()) if (e.name === name) return e;
    return undefined;
  }

  findByTag(tag: string): Entity[] {
    return [...this.entities.values()].filter((e) => e.tags.has(tag));
  }

  /** Every live entity (a snapshot, safe to destroy while iterating). */
  all(): Entity[] {
    return [...this.entities.values()];
  }

  get count(): number {
    return this.entities.size;
  }

  /** @internal */
  attachComponent(c: Component): void {
    c.game = this.game;
    this.components.push(c);
    this.sortDirty = true;
    c.onAttach?.();
  }

  /** @internal */
  detachComponent(c: Component): void {
    const i = this.components.indexOf(c);
    if (i !== -1) this.components.splice(i, 1);
    c.onDetach?.();
  }

  fixedUpdate(dt: number): void {
    this.sort();
    for (const c of this.components) if (c.enabled) c.fixedUpdate?.(dt);
  }

  lateFixedUpdate(dt: number): void {
    for (const c of this.components) if (c.enabled) c.lateFixedUpdate?.(dt);
  }

  update(time: FrameTime): void {
    this.sort();
    for (const c of this.components) if (c.enabled) c.update?.(time);
  }

  private sort(): void {
    if (!this.sortDirty) return;
    this.components.sort((a, b) => a.order - b.order);
    this.sortDirty = false;
  }
}
