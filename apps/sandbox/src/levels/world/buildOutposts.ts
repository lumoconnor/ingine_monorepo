import * as THREE from 'three';
import type { Game } from '@ingine/engine/core/Game';
import { Component } from '@ingine/engine/entities/Component';
import { StaticBatch } from '@ingine/engine/world/StaticBatch';
import { buildTower, buildWallRun } from '@ingine/engine/world/buildings';
import { addLadder } from '@ingine/engine/world/builders';
import { addFirePit } from '@ingine/engine/world/combat';
import { addChest } from '@ingine/engine/world/containers';
import { addEnemy } from '@ingine/engine/world/enemies';
import { PlayerController } from '@ingine/engine/gameplay/player/PlayerController';
import { RigidBodyComponent } from '@ingine/engine/physics/RigidBodyComponent';
import { NpcBody } from '@ingine/engine/combat/ai/NpcBody';
import { EnemyBrain } from '@ingine/engine/combat/ai/EnemyBrain';
import { Perception } from '@ingine/engine/combat/ai/Perception';
import { NpcRig } from '@ingine/engine/combat/ai/NpcRig';
import { Combatant } from '@ingine/engine/combat/Combatant';
import type { WorldMap } from './WorldGen';
import { RUIN_STONE } from './outposts';

const WOOD = 0x6b4f33;
const deg = THREE.MathUtils.radToDeg;

/** Builds the bandit camps and ruined fortresses, and the bandits in them. */
export function buildOutposts(game: Game, map: WorldMap): void {
  const ground = (x: number, z: number) => map.heightAt(x, z);
  for (const o of map.outposts) {
    const b = new StaticBatch();
    for (const t of o.tents) {
      const y = ground(t.x, t.z);
      b.gable(t.w, t.d, t.h, t.x, y - 0.05, t.z, t.color, { yaw: t.yaw });
      // A pole at the mouth.
      b.box(0.08, t.h + 0.3, 0.08, t.x + Math.sin(t.yaw) * (t.d / 2 + 0.05), y + (t.h + 0.3) / 2 - 0.05, t.z + Math.cos(t.yaw) * (t.d / 2 + 0.05), WOOD, { collide: false });
    }
    for (const k of o.blocks) b.box(k.w, k.h, k.d, k.x, k.y, k.z, k.color, { yaw: k.yaw, collide: k.collide });
    for (const w of o.walls) {
      buildWallRun(b, { from: w.from, to: w.to, height: w.height, thickness: w.thickness, color: w.color, groundAt: ground, crenels: w.crenels });
      if (o.kind === 'camp') {
        // Sharpened stake tips along the palisade.
        const len = Math.hypot(w.to[0] - w.from[0], w.to[1] - w.from[1]);
        const n = Math.round(len / 0.45);
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n;
          const x = w.from[0] + (w.to[0] - w.from[0]) * t;
          const z = w.from[1] + (w.to[1] - w.from[1]) * t;
          b.pyramid(0.42, 0.42, 0.5, x, ground(x, z) + w.height, z, WOOD, { collide: false, yaw: Math.atan2(w.to[0] - w.from[0], w.to[1] - w.from[1]) });
        }
      }
    }
    for (const t of o.towers) {
      buildTower(b, { x: t.x, z: t.z, yaw: t.yaw, size: t.size, height: t.height, groundY: t.groundY, color: RUIN_STONE, broken: t.broken ? hash(o.site + t.x) : undefined });
    }
    let ladder: { position: [number, number, number]; facingDeg: number; height: number } | null = null;
    if (o.lookout) {
      const { x, z, yaw, y, deck } = o.lookout;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const L = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
      for (const [px, pz] of [[-1.15, -1.15], [1.15, -1.15], [-1.15, 1.15], [1.15, 1.15]]) {
        const [wx, wz] = L(px, pz);
        b.box(0.24, deck + 1.1, 0.24, wx, y + (deck + 1.1) / 2 - 0.1, wz, WOOD, { collide: true });
      }
      b.box(2.6, 0.2, 2.6, x, y + deck - 0.1, z, WOOD, { yaw });
      // Rails on three sides; the ladder side (front, facing the camp) is open.
      for (const [lx, lz, w, d] of [[0, -1.2, 2.5, 0.08], [-1.2, 0, 0.08, 2.5], [1.2, 0, 0.08, 2.5]] as const) {
        const [wx, wz] = L(lx, lz);
        b.box(w, 0.1, d, wx, y + deck + 1.0, wz, WOOD, { yaw });
        b.box(w, 1.0, d, wx, y + deck + 0.5, wz, WOOD, { yaw, collide: true });
      }
      // A plank backing for the ladder to lean on.
      const [bx, bz] = L(0, 1.2);
      b.box(0.9, deck, 0.1, bx, y + deck / 2, bz, WOOD, { yaw });
      const [lx, lz] = L(0, 1.25);
      ladder = { position: [lx, y, lz], facingDeg: deg(yaw), height: deck + 0.2 };
    }
    b.build(game, `outpost:${o.site}`);
    if (ladder) addLadder(game, { ...ladder, color: WOOD });
    if (o.fire) addFirePit(game, { name: `fire:${o.site}`, position: [o.fire.x, o.fire.y, o.fire.z] });
    if (o.chest) addChest(game, { id: o.chest.id, position: [o.chest.x, o.chest.y, o.chest.z], facingDeg: deg(o.chest.facing), contents: o.chest.contents });
    for (const g of o.guards) {
      addEnemy(game, { id: g.id, archetype: g.archetype, position: [g.x, g.y + 0.05, g.z], facingDeg: deg(g.facing) });
    }
  }
}

/** Components that make an enemy act; switched off while it's far away. */
const ACTIVE = [NpcBody, EnemyBrain, Perception, Combatant, NpcRig];
const WAKE = 130;
const SLEEP = 145;

/**
 * Enemies far from the player sleep: the terrain only has colliders near
 * the player, so an enemy out there would fall through the world. Runs
 * before everything else each step.
 */
export class Dormancy extends Component {
  order = -500;
  /** Enemies awake right now (tests). */
  awake = 0;

  fixedUpdate(): void {
    const p = this.game.world.find('player')?.get(PlayerController)?.feetPosition;
    if (!p) return;
    let awake = 0;
    for (const e of this.game.world.all()) {
      if (!e.tags.has('enemy')) continue;
      // The physics position: the mesh only catches up when a frame is drawn.
      const q = e.get(RigidBodyComponent)?.body.translation() ?? e.object3d.position;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      const comps = e.getAll().filter((c) => ACTIVE.some((K) => c instanceof K));
      const on = comps[0]?.enabled ?? true;
      const want = on ? d < SLEEP : d < WAKE;
      if (want !== on) for (const c of comps) c.enabled = want;
      if (want) awake++;
    }
    this.awake = awake;
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
