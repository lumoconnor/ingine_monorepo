import * as THREE from 'three';
import type { Game } from '../core/Game';
import { Entity } from '../entities/Entity';
import { RAPIER } from '../physics/PhysicsWorld';
import { RigidBodyComponent } from '../physics/RigidBodyComponent';
import { gridMaterial, worldScaleBoxUVs } from '../render/materials';

export interface BridgeOptions {
  /** Deck ends at ground level on each bank (x, z); the deck is level at `y`. */
  from: [number, number];
  to: [number, number];
  /** Height of the walking surface. */
  y: number;
  width: number;
  /** How far the piers reach below the deck (to the river bed). Default 6. */
  pierDepth?: number;
  color?: number;
}

/**
 * A greybox timber bridge: a level deck between two banks with side rails
 * and piers. The deck runs a little past each end so it beds into the bank.
 * Colliders: the deck and both rails.
 */
export function addBridge(game: Game, o: BridgeOptions): Entity {
  const dx = o.to[0] - o.from[0];
  const dz = o.to[1] - o.from[1];
  const span = Math.hypot(dx, dz);
  const length = span + 3;
  const thick = 0.4;
  const railH = 1.0;
  const railT = 0.14;
  const deckMat = gridMaterial(o.color ?? 0x8a6a45);
  const railMat = gridMaterial(0x6b4f33);

  const root = new THREE.Group();
  root.position.set((o.from[0] + o.to[0]) / 2, o.y, (o.from[1] + o.to[1]) / 2);
  // Local +Z runs along the bridge.
  root.rotation.y = Math.atan2(dx, dz);

  const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    worldScaleBoxUVs(geo, w, h, d);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    root.add(m);
  };
  box(o.width, thick, length, 0, -thick / 2, 0, deckMat);
  const side = o.width / 2 - railT / 2;
  for (const s of [-1, 1]) {
    box(railT, 0.12, length, s * side, railH, 0, railMat);
    const posts = Math.max(2, Math.round(length / 2.5));
    for (let i = 0; i <= posts; i++) box(railT, railH, railT, s * side, railH / 2, -length / 2 + (i / posts) * length, railMat);
  }
  const depth = o.pierDepth ?? 6;
  const piers = Math.max(0, Math.round(span / 9) - 1);
  for (let i = 1; i <= piers; i++) {
    const z = -span / 2 + (i / (piers + 1)) * span;
    for (const s of [-1, 1]) box(0.35, depth, 0.35, s * (o.width / 2 - 0.3), -thick - depth / 2, z, railMat);
    box(o.width, 0.25, 0.3, 0, -thick - 0.4, z, railMat);
  }

  const e = new Entity('bridge', root);
  e.tags.add('bridge');
  e.add(
    new RigidBodyComponent({
      type: 'fixed',
      colliders: [
        RAPIER.ColliderDesc.cuboid(o.width / 2, thick / 2, length / 2).setTranslation(0, -thick / 2, 0).setFriction(0.8),
        RAPIER.ColliderDesc.cuboid(railT / 2, railH / 2, length / 2).setTranslation(-side, railH / 2, 0),
        RAPIER.ColliderDesc.cuboid(railT / 2, railH / 2, length / 2).setTranslation(side, railH / 2, 0),
      ],
    }),
  );
  game.world.spawn(e);
  return e;
}
