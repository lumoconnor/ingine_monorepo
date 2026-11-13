import type { Game } from '@ingine/engine/core/Game';
import { StaticBatch } from '@ingine/engine/world/StaticBatch';
import { buildFence, buildHouse, buildStall, buildTower, buildWallRun, buildWell } from '@ingine/engine/world/buildings';
import { addDoor } from '@ingine/engine/world/machinery';
import { addNpc } from '@ingine/engine/world/npcs';
import { addChest } from '@ingine/engine/world/containers';
import { addItemPickup } from '@ingine/engine/inventory/pickups';
import { mulberry32 } from '@ingine/engine/procgen/random';
import { rollLoot } from './loot';
import type { WorldMap } from './WorldGen';
import { STONE, STONE_DARK, type Building } from './settlements';

const DOORS: Partial<Record<Building['kind'], { width: number; height: number }>> = {
  keep: { width: 2.2, height: 3 },
  hall: { width: 1.8, height: 2.6 },
  chapel: { width: 1.6, height: 2.6 },
  inn: { width: 1.4, height: 2.3 },
  barn: { width: 2.8, height: 3 },
};
const DIRS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];

/**
 * Builds every settlement: one batched mesh-and-collider entity per village
 * for everything that never moves, plus a door entity per house and the
 * people.
 */
export function buildSettlements(game: Game, map: WorldMap): void {
  const ground = (x: number, z: number) => map.heightAt(x, z);
  const towns = map.sites.filter((s) => s.kind === 'town');
  for (const st of map.settlements) {
    const site = map.sites.find((s) => s.id === st.site)!;
    const batch = new StaticBatch();
    const doors: { id: string; doorway: ReturnType<typeof buildHouse>; color: number }[] = [];

    for (const b of st.buildings) {
      const pal = b.kind === 'keep' || b.kind === 'chapel' ? { ...st.palette[b.style], wall: STONE, base: STONE_DARK } : st.palette[b.style];
      const doorway = buildHouse(batch, {
        x: b.x, z: b.z, yaw: b.yaw, w: b.w, d: b.d,
        floorY: b.floorY, groundY: b.groundY, doorGroundY: b.doorGroundY,
        wallH: b.wallH, roof: b.roof, roofH: b.roofH, ridgeAcross: b.ridgeAcross,
        colors: pal,
        door: DOORS[b.kind] ?? { width: 1.2, height: 2.2 },
        interior: b.enterable,
        chimney: b.chimney,
        crenels: b.crenels,
        windows: b.kind !== 'barn',
      });
      if (b.enterable && doorway) doors.push({ id: b.id, doorway, color: pal.trim });
      if (b.kind === 'chapel') {
        // A bell tower at the back.
        const fx = b.x - Math.sin(b.yaw) * (b.d / 2 - 1.6);
        const fz = b.z - Math.cos(b.yaw) * (b.d / 2 - 1.6);
        buildTower(batch, { x: fx, z: fz, yaw: b.yaw, size: 3, height: b.wallH + 6, groundY: b.floorY, color: STONE, roof: pal.roof });
      }
    }
    for (const t of st.towers) {
      buildTower(batch, { x: t.x, z: t.z, yaw: t.yaw, size: t.size, height: t.height, groundY: t.groundY, color: STONE, roof: t.roofed ? st.palette[0].roof : undefined });
    }
    for (const w of st.walls) buildWallRun(batch, { from: w.from, to: w.to, height: w.height, thickness: w.thickness, color: STONE, groundAt: ground, crenels: true });
    for (const p of st.props) {
      if (p.kind === 'well') buildWell(batch, p.x, p.z, p.y, STONE, st.palette[0].roof);
      else if (p.kind === 'stall') buildStall(batch, p.x, p.z, p.yaw, p.y, p.color ?? 0xb5452f);
      else if (p.kind === 'fence' && p.to) buildFence(batch, [p.x, p.z], p.to, ground);
    }
    batch.build(game, `settlement:${st.site}`);

    // A little to find indoors: a chest by the bed in some houses, something left on the table in others.
    for (const h of st.buildings) {
      if (!h.enterable || h.kind === 'keep') continue;
      const rand = mulberry32(hashId(h.id + ':loot'));
      const ix = h.w / 2 - 0.35;
      const iz = h.d / 2 - 0.35;
      const at = (lx: number, lz: number): [number, number] => [h.x + lx * Math.cos(h.yaw) + lz * Math.sin(h.yaw), h.z - lx * Math.sin(h.yaw) + lz * Math.cos(h.yaw)];
      if (rand() < 0.35) {
        const [x, z] = at(-ix + 0.6, -iz + 2.5);
        addChest(game, { id: `${h.id}:chest`, position: [x, h.floorY, z], facingDeg: (h.yaw * 180) / Math.PI, contents: rollLoot('house', rand) });
      }
      if (rand() < 0.5) {
        const [{ item, count }] = rollLoot('shelf', rand);
        const [x, z] = at(ix - 0.9 + (rand() - 0.5) * 0.6, -iz + 1.6 + (rand() - 0.5) * 0.3);
        // Resting on the table top.
        addItemPickup(game, { id: `${h.id}:table`, item, count, position: [x, h.floorY + 0.78, z], yawDeg: rand() * 360 });
      }
    }

    for (const d of doors) {
      if (!d.doorway) continue;
      addDoor(game, { doorway: d.doorway, kind: 'swing', color: d.color, interactable: true, name: `door:${d.id}` });
    }

    // People. Their chat fills in local names.
    const nearest = (kind: 'camp' | 'ruin') => {
      let best = map.sites.find((s) => s.kind === kind);
      for (const s of map.sites) if (s.kind === kind && best && Math.hypot(s.x - site.x, s.z - site.z) < Math.hypot(best.x - site.x, best.z - site.z)) best = s;
      return best;
    };
    const dir = (x: number, z: number) => DIRS[((Math.round(Math.atan2(z - site.z, x - site.x) / (Math.PI / 4)) % 8) + 8) % 8];
    const camp = nearest('camp');
    const ruin = nearest('ruin');
    const vars = {
      place: site.name,
      describe: st.describe,
      town: nearestTown(towns, site)?.name ?? site.name,
      camp: camp?.name ?? 'the old hollow',
      campDir: camp ? dir(camp.x, camp.z) : 'hills',
      ruin: ruin?.name ?? 'the old keep',
    };
    for (const v of st.villagers) {
      addNpc(game, {
        id: `npc:${v.id}`,
        name: v.name,
        dialogue: v.dialogue,
        position: [v.x, ground(v.x, v.z), v.z],
        facingDeg: (v.facing * 180) / Math.PI,
        color: v.color,
        skin: v.skin,
        hat: v.hat,
        tagRange: 9,
        vars: { ...vars, name: v.name },
        wander: v.path.length > 1
          ? { path: v.path, stops: v.stops, groundAt: ground, seed: hashId(v.id), startAt: (hashId(v.id) % 1000) / 1000, speed: 1.0 + (hashId(v.id) % 5) * 0.06 }
          : undefined,
      });
    }
  }
}

function hashId(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The town nearest a place (itself, for a town): the one its people talk about. */
function nearestTown<T extends { x: number; z: number }>(towns: T[], at: { x: number; z: number }): T | undefined {
  let best: T | undefined;
  let bd = Infinity;
  for (const t of towns) {
    const d = Math.hypot(t.x - at.x, t.z - at.z);
    if (d < bd) [bd, best] = [d, t];
  }
  return best;
}
