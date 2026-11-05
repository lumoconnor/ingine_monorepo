import * as THREE from 'three';
import type { Component, ComponentClass } from './Component';
import type { World } from './World';

let nextId = 1;

/**
 * Anything that exists in the game world: the player, an NPC, a door, a
 * moving platform, a tree. An Entity is a scene-graph node plus a bag of
 * Components that give it behaviour.
 */
export class Entity {
  readonly id = nextId++;
  readonly object3d: THREE.Object3D;
  readonly tags = new Set<string>();
  world: World | null = null;
  private components: Component[] = [];

  constructor(public name: string, object3d: THREE.Object3D = new THREE.Group()) {
    this.object3d = object3d;
    this.object3d.name = name;
    this.object3d.userData.entityId = this.id;
  }

  add<T extends Component>(component: T): T {
    this.components.push(component);
    component.entity = this;
    if (this.world) this.world.attachComponent(component);
    return component;
  }

  remove(component: Component): void {
    const i = this.components.indexOf(component);
    if (i === -1) return;
    this.components.splice(i, 1);
    this.world?.detachComponent(component);
  }

  get<T extends Component>(type: ComponentClass<T>): T | undefined {
    return this.components.find((c) => c instanceof type) as T | undefined;
  }

  require<T extends Component>(type: ComponentClass<T>): T {
    const c = this.get(type);
    if (!c) throw new Error(`Entity "${this.name}" is missing component ${type.name}`);
    return c;
  }

  getAll(): readonly Component[] {
    return this.components;
  }
}
