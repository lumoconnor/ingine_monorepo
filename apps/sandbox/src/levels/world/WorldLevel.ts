import * as THREE from 'three';
import type { Game } from '@ingine/engine/core/Game';
import type { Level } from '@ingine/engine/world/Level';
import { Entity } from '@ingine/engine/entities/Entity';
import { Component } from '@ingine/engine/entities/Component';
import { RAPIER } from '@ingine/engine/physics/PhysicsWorld';
import { RigidBodyComponent } from '@ingine/engine/physics/RigidBodyComponent';
import { TerrainStreamer } from '@ingine/engine/world/terrain/TerrainStreamer';
import { WaterBody } from '@ingine/engine/world/water/WaterGrid';
import { addBridge } from '@ingine/engine/world/bridges';
import { addLabel } from '@ingine/engine/world/builders';
import { SITE_INFO } from './sites';
import { buildSettlements } from './buildSettlements';
import { buildOutposts, Dormancy } from './buildOutposts';
import { Forest, oakGeometry, pineGeometry, bushGeometry } from '@ingine/engine/world/vegetation/Forest';
import { StaticBatch } from '@ingine/engine/world/StaticBatch';
import { addChest } from '@ingine/engine/world/containers';
import { createPlayer } from '@ingine/engine/gameplay/player/createPlayer';
import { PlayerController } from '@ingine/engine/gameplay/player/PlayerController';
import { generateWorld, type WorldMap } from './WorldGen';
import { WorldMapUi } from './WorldMapUi';

/** The world everyone gets unless they pick another seed. */
export const DEFAULT_WORLD_SEED = 20261112;

/**
 * The procedurally generated sandbox (`?level=world`, optionally `&seed=N`).
 * The whole world is generated from the seed when the level loads, then the
 * terrain streams in chunks around the player. See the plan doc for the
 * layers still to come (forests, secrets, loot).
 */
export class WorldLevel implements Level {
  readonly name = 'Procedural World';
  map!: WorldMap;
  private savedFog: [number, number] | null = null;
  private savedFar = 0;

  constructor(readonly seed = DEFAULT_WORLD_SEED) {}

  load(game: Game): void {
    this.map = generateWorld({ seed: this.seed });
    const map = this.map;
    console.info(`[world] seed ${this.seed}: generated in ${map.genMs.toFixed(0)} ms`);

    // See much further than the playground: mountains on the horizon.
    const r = game.renderer;
    const fog = r.scene.fog as THREE.Fog;
    this.savedFog = [fog.near, fog.far];
    this.savedFar = r.camera.far;
    fog.near = 260;
    fog.far = 2100;
    r.camera.far = 3200;
    r.camera.updateProjectionMatrix();

    const terrain = new Entity('terrain');
    terrain.tags.add('terrain');
    // Follow the physics body, not the interpolated mesh, so a teleport gets ground under it on the very next step.
    let ctrl: PlayerController | undefined;
    terrain.add(
      new TerrainStreamer({
        source: map,
        // The grid is 1 m: full detail close by, the old 2 m look a little further out.
        lods: [
          { within: 140, step: 1 },
          { within: 400, step: 2 },
          { within: Infinity, step: 4 },
        ],
        initialFocus: map.spawn,
        focus: () => ctrl?.feetPosition,
      }),
    );
    game.world.spawn(terrain);

    const water = new Entity('world-water');
    water.tags.add('water');
    water.add(new WaterBody({ water: map.water, ground: map.grid }));
    game.world.spawn(water);

    for (const b of map.net.bridges) {
      addBridge(game, { from: [b.ax, b.az], to: [b.bx, b.bz], y: b.y, width: b.width, pierDepth: b.y - b.water + 2.5 });
    }
    // Woods. Trunks get colliders near the player only.
    const woods = new Entity('forest');
    woods.add(
      new Forest({
        kinds: [
          { geometry: pineGeometry(), trunk: { radius: 0.24, height: 3.2 } },
          { geometry: oakGeometry(), trunk: { radius: 0.32, height: 4.2 } },
          { geometry: bushGeometry() },
        ],
        trees: map.trees,
        focus: () => ctrl?.feetPosition ?? map.spawn,
      }),
    );
    game.world.spawn(woods);

    // Villages and the town, bandit camps and ruined fortresses.
    buildSettlements(game, map);
    buildOutposts(game, map);
    for (const s of map.sites) {
      const settled = s.kind === 'village' || s.kind === 'town';
      if (settled) addLabel(game, `${s.name} · ${SITE_INFO[s.kind].label}`, [s.x, s.y + 7, s.z], 2.2, SITE_INFO[s.kind].color);
    }

    this.addCaches(game);
    this.addBorder(game);

    ctrl = createPlayer(game, map.spawn.clone(), map.spawnYaw).get(PlayerController);
    const minder = new Entity('world-minder');
    minder.add(new Dormancy());
    minder.add(new KeepAboveGround(map));
    minder.add(new WorldMapUi(map));
    game.world.spawn(minder);
  }

  unload(game: Game): void {
    const r = game.renderer;
    if (this.savedFog) {
      const fog = r.scene.fog as THREE.Fog;
      [fog.near, fog.far] = this.savedFog;
    }
    r.camera.far = this.savedFar;
    r.camera.updateProjectionMatrix();
  }

  /** Hidden caches: a chest with a little cairn of stones beside it. */
  private addCaches(game: Game): void {
    const b = new StaticBatch();
    const stone = [0x8d887d, 0x9a958a, 0x7f7a70];
    for (const c of this.map.caches) {
      addChest(game, { id: c.id, position: [c.x, c.y, c.z], facingDeg: THREE.MathUtils.radToDeg(c.facing), contents: c.contents });
      // The cairn: three stones stacked, smallest on top, a stride to one side.
      const sx = c.x + Math.cos(c.facing) * 1.4;
      const sz = c.z - Math.sin(c.facing) * 1.4;
      let y = this.map.heightAt(sx, sz) - 0.05;
      [0.75, 0.55, 0.35].forEach((s, i) => {
        b.box(s, s * 0.6, s * 0.9, sx, y + s * 0.3, sz, stone[i], { yaw: c.facing + i * 0.7 });
        y += s * 0.6;
      });
    }
    if (this.map.caches.length) b.build(game, 'caches');
  }

  /** Invisible walls just inside the edge of the map. */
  private addBorder(game: Game): void {
    const g = this.map.grid;
    const half = g.size / 2;
    const t = 4;
    const h = 600;
    const inset = 6;
    const border = new Entity('world-border');
    border.add(
      new RigidBodyComponent({
        type: 'fixed',
        colliders: [
          RAPIER.ColliderDesc.cuboid(half, h, t).setTranslation(0, h / 2, -half + inset - t),
          RAPIER.ColliderDesc.cuboid(half, h, t).setTranslation(0, h / 2, half - inset + t),
          RAPIER.ColliderDesc.cuboid(t, h, half).setTranslation(-half + inset - t, h / 2, 0),
          RAPIER.ColliderDesc.cuboid(t, h, half).setTranslation(half - inset + t, h / 2, 0),
        ],
      }),
    );
    game.world.spawn(border);
  }
}

/**
 * Safety net: if the player ever ends up under the ground (a save from a
 * different seed, a bad teleport), lift them back onto it.
 */
class KeepAboveGround extends Component {
  order = 100;
  constructor(private map: WorldMap) {
    super();
  }

  lateFixedUpdate(): void {
    const ctrl = this.game.world.find('player')?.get(PlayerController);
    if (!ctrl) return;
    const p = ctrl.feetPosition;
    const ground = this.map.heightAt(p.x, p.z);
    // (Swimmers dive, but never below the bed.)
    if (p.y < ground - 1) ctrl.placeAt(new THREE.Vector3(p.x, ground + 0.1, p.z), ctrl.yaw, ctrl.pitch);
  }
}
