import * as THREE from 'three';
import type { Game } from '@/core/Game';
import type { System } from '@/core/System';
import { RAPIER } from '@/physics/PhysicsWorld';
import { RigidBodyComponent } from '@/physics/RigidBodyComponent';
import { groups, Layer } from '@/physics/groups';
import { PlayerController } from '@/gameplay/player/PlayerController';
import type { DialogueSystem } from '@/dialogue/DialogueSystem';
import { runAll } from '@/dialogue/registry';
import { Items, itemLabel } from '@/inventory/catalog';
import { canDrop, isInstanced, stackSize, type ItemDef } from './types';
import { validateArchetypes } from '@/world/enemies';
import { validateItems } from './validate';
import { spawnPickup, type PickupSpec } from './pickups';

export interface Slot {
  /** Selection key: the instance uid for weapons, else the item id. */
  key: string;
  item: string;
  def: ItemDef;
  count: number;
  /** Set for instanced items (weapons). */
  uid?: string;
}

/**
 * Ray filter for surfaces an item can rest on: static world geometry. Not
 * interact-only targets, sensors (water), or moving platforms and doors,
 * which would carry the item off or swing through it.
 */
const SOLID_QUERY = groups(Layer.player, 0xffff & ~Layer.platform);
const _down = new THREE.Vector3(0, -1, 0);
/** How far away you can place something by looking at it (metres from the eye). */
const DROP_REACH = 2.5;
/** Surfaces flatter than ~45° can hold an item. */
const FLAT_ENOUGH = 0.7;

/**
 * The player's bag. Items themselves are counts in `game.state`; this system
 * adds the rules on top (stacks, use, drop) and opens/closes the inventory
 * screen. Opening it pauses the game and frees the mouse. InventoryUi draws it.
 */
export class InventorySystem implements System {
  readonly name = 'inventory';
  private game!: Game;
  private _open = false;

  init(game: Game): void {
    this.game = game;
    validateItems(Items);
    validateArchetypes();
    game.state.isInstanced = (id) => isInstanced(Items[id]);
    game.events.on('input:pressed', ({ action }) => {
      if (action !== 'inventory') return;
      if (this._open) this.close(true);
      else this.open();
    });
    // Esc in drag-to-look mode, or anything else that pauses the game.
    game.events.on('input:pointerlock', ({ locked }) => {
      if (!locked && this._open) this.close(false);
    });
  }

  get isOpen(): boolean {
    return this._open;
  }

  open(): boolean {
    const g = this.game;
    if (this._open || !g.input.locked) return false;
    if (g.getSystem<DialogueSystem>('dialogue')?.isActive) return false;
    this._open = true;
    g.paused = true;
    g.input.gameplayBlocked = true;
    g.input.openMenu();
    g.events.emit('inventory:open', {});
    return true;
  }

  /** `resume`: back to playing (re-capture the mouse); otherwise drop to the pause screen. */
  close(resume: boolean): void {
    if (!this._open) return;
    const g = this.game;
    this._open = false;
    g.paused = false;
    g.input.gameplayBlocked = false;
    g.input.closeMenu(g.renderer.webgl.domElement, resume);
    g.events.emit('inventory:close', {});
  }

  /** Inventory slots (currency excluded), split into stacks. */
  slots(): Slot[] {
    const out: Slot[] = [];
    const state = this.game.state;
    for (const inst of state.instancesOf()) {
      const def = Items[inst.item];
      if (def) out.push({ key: inst.uid, item: inst.item, def, count: 1, uid: inst.uid });
    }
    for (const [item, total] of state.inventory()) {
      const def = Items[item];
      if (!def || def.category === 'currency' || isInstanced(def)) continue;
      const per = stackSize(def);
      for (let left = total; left > 0; left -= per) out.push({ key: item, item, def, count: Math.min(per, left) });
    }
    return out;
  }

  /** Money and other currencies, shown as totals rather than slots. */
  currencies(): { item: string; def: ItemDef; count: number }[] {
    return this.game.state
      .inventory()
      .filter(([id]) => Items[id]?.category === 'currency')
      .map(([item, count]) => ({ item, def: Items[item], count }));
  }

  use(item: string): boolean {
    const def = Items[item];
    if (!def?.use || this.game.state.itemCount(item) < 1) return false;
    runAll({ game: this.game, tree: 'item', item }, def.use);
    return true;
  }

  /**
   * Put one down where the player is looking: on the table, crate or ledge
   * under the crosshair if it's within reach, otherwise at the foot of the
   * wall or on the ground ahead.
   */
  drop(item: string, uid?: string): boolean {
    const def = Items[item];
    const g = this.game;
    if (!def || !canDrop(def) || g.state.itemCount(item) < 1) return false;
    const spot = this.dropSpot();
    if (!spot) return false;
    let data: PickupSpec['data'];
    if (isInstanced(def)) {
      // A particular weapon keeps its state (rounds loaded) on the ground.
      const inst = uid ? g.state.instance(uid) : g.state.instancesOf(item).at(-1);
      if (!inst) return false;
      g.state.removeInstance(inst.uid);
      data = { ...inst.data };
    } else {
      g.state.removeItem(item, 1);
    }
    spawnPickup(g, { item, count: 1, position: [spot.x, spot.y, spot.z], yawDeg: Math.random() * 360, data });
    g.events.emit('notify', { text: `Dropped ${itemLabel(item)}` });
    return true;
  }

  /** Where a dropped item would land (exposed for tests and a future placement preview). */
  dropSpot(): THREE.Vector3 | null {
    const g = this.game;
    const player = g.world.find('player');
    const ctrl = player?.get(PlayerController);
    if (!player || !ctrl) return null;
    const body = player.get(RigidBodyComponent)?.body;
    const world = g.physics.world;
    const flags = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
    const cast = (o: THREE.Vector3, d: THREE.Vector3, max: number) =>
      world.castRayAndGetNormal(new RAPIER.Ray(o, d), max, true, flags, SOLID_QUERY, undefined, body);

    // 1. Along the view ray: a surface facing up that's in reach.
    const cam = g.renderer.camera;
    cam.updateMatrixWorld();
    const eye = cam.getWorldPosition(new THREE.Vector3());
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const hit = cast(eye, dir, DROP_REACH);
    if (hit && hit.normal.y > FLAT_ENOUGH) {
      return eye.addScaledVector(dir, hit.timeOfImpact);
    }

    // 2. Otherwise drop straight down from just short of what we're looking at
    //    (a wall, a table's side) or from the end of reach, so it lands at the
    //    foot of it or on whatever is below.
    const along = hit ? Math.max(0, hit.timeOfImpact - 0.25) : DROP_REACH;
    const from = eye.clone().addScaledVector(dir, along);
    // Never search from above the eyes or below the feet (looking up / down a cliff).
    const feet = ctrl.feetPosition;
    from.y = THREE.MathUtils.clamp(from.y, feet.y + 0.3, eye.y);
    // Make sure the way from the eye to the drop column is clear (don't drop through a wall).
    const toFrom = from.clone().sub(eye);
    const len = toFrom.length();
    if (len > 1e-3) {
      const block = cast(eye, toFrom.normalize(), len);
      if (block) from.copy(eye).addScaledVector(toFrom, Math.max(0, block.timeOfImpact - 0.25));
    }
    const down = cast(from, _down, 30);
    if (down && down.normal.y > FLAT_ENOUGH) return from.setY(from.y - down.timeOfImpact);
    // 3. Nowhere sensible (over a drop-off, onto a steep slope): at the player's feet.
    return feet.clone();
  }
}
