import type RAPIER from '@dimforge/rapier3d-compat';
import type { Game } from '../core/Game';
import { RigidBodyComponent } from './RigidBodyComponent';

type V = { x: number; y: number; z: number };
type Q = { x: number; y: number; z: number; w: number };

/**
 * Distance between `shape` placed at (pos, rot) and the player's collider
 * (negative when overlapping). Returns Infinity if the player is further
 * than `range` away or doesn't exist.
 *
 * Doors and lifts compare this before and after a move: if the move would
 * bring them into contact with the player, they wait instead of crushing the
 * player into a wall or the floor. Moving away from a touching player is fine.
 */
export function playerClearance(game: Game, shape: RAPIER.Shape, pos: V, rot: Q, range = 0.5): number {
  const col = game.world.find('player')?.get(RigidBodyComponent)?.colliders[0];
  if (!col) return Infinity;
  const contact = shape.contactShape(pos, rot, col.shape, col.translation(), col.rotation(), range);
  return contact ? contact.distance : Infinity;
}

/** Contact margin used by movers: closer than this counts as touching. */
export const TOUCH = 0.03;

/** True if moving `shape` from pose A to pose B pushes into the player. */
export function movesIntoPlayer(game: Game, shape: RAPIER.Shape, posA: V, rotA: Q, posB: V, rotB: Q): boolean {
  const after = playerClearance(game, shape, posB, rotB);
  if (after >= TOUCH) return false;
  const before = playerClearance(game, shape, posA, rotA);
  return after < before - 1e-5;
}
