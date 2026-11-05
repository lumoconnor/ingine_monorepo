import * as THREE from 'three';
import type { Game } from '../core/Game';
import { Entity } from '../entities/Entity';
import { Component } from '../entities/Component';
import { RAPIER } from '../physics/PhysicsWorld';
import { RigidBodyComponent } from '../physics/RigidBodyComponent';
import { INTERACT_ONLY_GROUPS } from '../physics/groups';
import { Interactable } from '../gameplay/interaction/Interactable';
import { Items, itemLabel } from './catalog';
import { buildItemModel } from './models';
import type { VarValue } from '../core/WorldState';

type Vec3 = [number, number, number];

export interface PickupSpec {
  /**
   * Stable id for items placed by a level, so a save remembers they were
   * taken. Dropped items have none (the save stores them with their position).
   */
  id?: string;
  item: string;
  count?: number;
  /** The point on the surface it rests on (table top, ground). */
  position: Vec3;
  /** Which way it lies, in degrees, so items don't all line up the same way. */
  yawDeg?: number;
  /** For an instanced item (weapon): its own state, e.g. rounds loaded. */
  data?: Record<string, VarValue>;
}

export const takenFlag = (id: string) => `world.taken.${id}`;

/**
 * Lets something else decide who gets a pickup (a multiplayer host, so two
 * players can't both take the same mug). Without hooks, pickups work as in
 * single player: E takes the item at once, a drop lands at once.
 */
export interface PickupAuthority {
  /** The local player pressed E on this pickup. Call `collectPickup` if it's granted. */
  requestTake(entity: Entity, spec: PickupSpec): void;
  /** The local player dropped an item (already out of their bag). Spawn it, or ask someone to. */
  requestDrop(spec: PickupSpec): void;
}

const authorities = new WeakMap<Game, PickupAuthority>();

/** Install (or with null, remove) the pickup authority for a game. */
export function setPickupAuthority(game: Game, authority: PickupAuthority | null): void {
  if (authority) authorities.set(game, authority);
  else authorities.delete(game);
}

/** Every pickup lying in the world right now. */
export function allPickups(game: Game): Entity[] {
  return game.world.findByTag('pickup');
}

/** Finds a pickup by its id (level items and, in multiplayer, dropped ones). */
export function findPickup(game: Game, id: string): Entity | undefined {
  return allPickups(game).find((e) => e.get(ItemPickup)?.spec.id === id);
}

/** Puts the item in the local player's bag and removes it from the world. */
export function collectPickup(game: Game, e: Entity): void {
  const o = e.get(ItemPickup)!.spec;
  const count = o.count ?? 1;
  if (o.data && game.state.isInstanced(o.item)) game.state.addInstance(o.item, o.data);
  else game.state.addItem(o.item, count);
  if (o.id) game.state.setFlag(takenFlag(o.id));
  game.events.emit('notify', { text: `Picked up ${itemLabel(o.item, count)}` });
  game.world.destroy(e);
}

/** Puts a dropped item into the world, through the authority if there is one. */
export function placeDroppedItem(game: Game, spec: PickupSpec): void {
  const authority = authorities.get(game);
  if (authority) authority.requestDrop(spec);
  else spawnPickup(game, spec);
}

/** Marks an entity as an item lying in the world. */
export class ItemPickup extends Component {
  constructor(readonly spec: PickupSpec) {
    super();
  }
}

/** Level-placed pickups per game, so loading a save can put back what isn't taken. */
const levelPickups = new WeakMap<Game, Map<string, PickupSpec>>();

/**
 * Place an item in the level. Items rest on surfaces like real objects (no
 * hovering or spinning); look at one and press E to take it. Skipped if the
 * save says it was already taken.
 */
export function addItemPickup(game: Game, o: PickupSpec & { id: string }): Entity | null {
  let map = levelPickups.get(game);
  if (!map) levelPickups.set(game, (map = new Map()));
  if (map.has(o.id)) throw new Error(`Duplicate pickup id "${o.id}"`);
  map.set(o.id, o);
  return game.state.hasFlag(takenFlag(o.id)) ? null : spawnPickup(game, o);
}

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();

export function spawnPickup(game: Game, o: PickupSpec): Entity {
  const def = Items[o.item];
  if (!def) throw new Error(`Unknown item "${o.item}"`);
  const count = o.count ?? 1;
  const root = new THREE.Group();
  root.position.set(...o.position);
  root.rotation.y = THREE.MathUtils.degToRad(o.yawDeg ?? 0);
  const model = buildItemModel(def.model);
  root.add(model);

  // Aim target sized to the model, but never too small to look at.
  _box.setFromObject(model);
  _box.getSize(_size);
  _box.getCenter(_center);
  const radius = Math.max(0.13, _size.length() / 2);

  const e = new Entity(`pickup:${o.item}`, root);
  e.tags.add('pickup');
  e.add(new ItemPickup({ ...o, count }));
  e.add(
    new RigidBodyComponent({
      type: 'fixed',
      colliders: [
        RAPIER.ColliderDesc.ball(radius)
          .setTranslation(_center.x, Math.max(_center.y, 0.04), _center.z)
          .setCollisionGroups(INTERACT_ONLY_GROUPS),
      ],
    }),
  );
  e.add(
    new Interactable({
      prompt: `Pick up ${itemLabel(o.item, count)}`,
      onInteract: () => {
        const authority = authorities.get(game);
        if (authority) authority.requestTake(e, e.get(ItemPickup)!.spec);
        else collectPickup(game, e);
      },
    }),
  );
  game.world.spawn(e);
  return e;
}

/** Items the player has dropped (to save them). */
export function droppedPickups(game: Game): PickupSpec[] {
  return game.world
    .findByTag('pickup')
    .map((e) => e.get(ItemPickup)!.spec)
    .filter((s) => !s.id);
}

/** After loading a save: put level items back unless taken, and re-create dropped ones. */
export function restorePickups(game: Game, dropped: PickupSpec[]): void {
  for (const e of game.world.findByTag('pickup')) game.world.destroy(e);
  for (const spec of levelPickups.get(game)?.values() ?? []) {
    if (!game.state.hasFlag(takenFlag(spec.id!))) spawnPickup(game, spec);
  }
  for (const spec of dropped) if (spec.item in Items) spawnPickup(game, { ...spec, id: undefined });
}
