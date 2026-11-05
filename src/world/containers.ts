import * as THREE from 'three';
import type { Game } from '@/core/Game';
import { Entity } from '@/entities/Entity';
import { Component } from '@/entities/Component';
import type { FrameTime } from '@/core/Time';
import { RAPIER } from '@/physics/PhysicsWorld';
import { RigidBodyComponent } from '@/physics/RigidBodyComponent';
import { buildModel, modelPart } from '@/render/models/ModelRegistry';
import { CHEST_SIZE } from './propModels';
import { Interactable } from '@/gameplay/interaction/Interactable';
import { Lock, type LockOptions } from '@/gameplay/components/Lock';
import { Items, itemLabel } from '@/content/items';

type Vec3 = [number, number, number];

export const lootedFlag = (id: string) => `world.looted.${id}`;

const OPEN_ANGLE = -1.85;

/** Lid animation; open once looted (state lives in WorldState, so loading a save just works). */
class Chest extends Component {
  private angle = 0;
  constructor(readonly id: string, private lid: THREE.Object3D, private ia: () => Interactable) {
    super();
  }
  get looted(): boolean {
    return this.game.state.hasFlag(lootedFlag(this.id));
  }
  update(time: FrameTime): void {
    const target = this.looted ? OPEN_ANGLE : 0;
    this.angle += (target - this.angle) * (1 - Math.exp(-Math.min(time.delta, 0.1) * 7));
    this.lid.rotation.x = this.angle;
    this.ia().enabled = !this.looted;
  }
}

export interface ChestOptions {
  /** Unique id: remembers that it was emptied (`world.looted.<id>`). */
  id: string;
  /** Centre of the base, on the floor. */
  position: Vec3;
  /** Which way the front faces: 0 = +Z, 90 = +X. */
  facingDeg: number;
  contents: { item: string; count?: number }[];
  lock?: LockOptions;
}

/**
 * A chest. E opens it and takes everything inside; the lid stays open after.
 * With `lock`, it needs a key first.
 */
export function addChest(game: Game, o: ChestOptions): Entity {
  for (const c of o.contents) if (!(c.item in Items)) throw new Error(`Chest "${o.id}": unknown item "${c.item}"`);
  const { w, h, d, lidH } = CHEST_SIZE;
  const root = new THREE.Group();
  root.position.set(...o.position);
  root.rotation.y = THREE.MathUtils.degToRad(o.facingDeg);
  const model = buildModel('chest');
  root.add(model);
  // Everything visible in `body`, so a lock can rattle it.
  const body = modelPart(model, 'body');
  const lid = modelPart(model, 'lid');
  modelPart(model, 'hasp').visible = !o.lock;
  modelPart(model, 'lock_hasp').visible = !!o.lock;
  modelPart(model, 'lock_plate').visible = !!o.lock;

  const e = new Entity(`chest:${o.id}`, root);
  e.tags.add('chest');
  e.add(
    new RigidBodyComponent({
      type: 'fixed',
      colliders: [RAPIER.ColliderDesc.cuboid(w / 2, (h + lidH) / 2, d / 2).setTranslation(0, (h + lidH) / 2, 0)],
    }),
  );
  const lock = o.lock ? e.add(new Lock(o.lock, body)) : null;
  const ia = e.add(
    new Interactable({
      prompt: () => lock?.prompt('chest') ?? 'Open chest',
      onInteract: () => {
        if (lock && !lock.tryUnlock()) return;
        const state = game.state;
        state.setFlag(lootedFlag(o.id));
        if (o.contents.length === 0) game.events.emit('notify', { text: 'Empty.' });
        for (const c of o.contents) {
          state.addItem(c.item, c.count ?? 1);
          game.events.emit('notify', { text: `Found ${itemLabel(c.item, c.count ?? 1)}` });
        }
      },
    }),
  );
  e.add(new Chest(o.id, lid, () => ia));
  game.world.spawn(e);
  return e;
}
