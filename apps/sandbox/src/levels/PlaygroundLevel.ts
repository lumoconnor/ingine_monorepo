import * as THREE from 'three';
import { Entity } from '@ingine/engine/entities/Entity';
import type { Game } from '@ingine/engine/core/Game';
import type { Level } from '@ingine/engine/world/Level';
import { Noise2D } from '@ingine/engine/utils/noise';
import { createTerrain } from '@ingine/engine/world/terrain/Terrain';
import { addBox, addLabel, addLadder, addWater, addWedge, addZipline } from '@ingine/engine/world/builders';
import { Palette } from '@ingine/engine/render/materials';
import { createPlayer } from '@ingine/engine/gameplay/player/createPlayer';
import { MovingPlatform, orbit, pingPong, spin, type MotionFn } from '@ingine/engine/gameplay/components/MovingPlatform';
import { PlayerConfig } from '@ingine/engine/config/player';
import { addNpc } from '@ingine/engine/world/npcs';
import { addItemPickup } from '@ingine/engine/inventory/pickups';
import { addChest } from '@ingine/engine/world/containers';
import { addDummy, addFirePit } from '@ingine/engine/world/combat';
import { addEnemy } from '@ingine/engine/world/enemies';
import { addButton, addDoor, addLever, addLift, addWall, callState, leverState, toggleState } from '@ingine/engine/world/machinery';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * Movement test level. Layout around the spawn (facing north / -Z):
 *
 *   North : ramps of increasing steepness (walkable up to the max climb angle)
 *   East  : staircases with different step heights
 *   West  : jump-height boxes and gap-jump pillars, crouch tunnel
 *   South : moving platforms (horizontal, elevator, diagonal, orbit, spinner, 3D loop)
 *   Far west : the door house (E doors, lever vault door, button gate)
 *   Far east : switch-operated lift and ferry, swimming pool
 *   Far north: river with a current (slow stretch, rapids, beach)
 *   South-east: training yard (dummies, fire pit, weapons, armour, shooting range)
 *   South, past the platforms: a bandit camp (two bandits who fight back)
 *   Spawn: Mira and Tess (dialogue); Old Bram stands outside the door house,
 *          next to his locked storeroom (keys and chests)
 *   Beyond: procedural rolling hills (terrain mesh)
 */
export class PlaygroundLevel implements Level {
  readonly name = 'Movement Playground';
  /** Terrain height at (x, z), for placing things on the ground. */
  private ground: (x: number, z: number) => number = () => 0;

  load(game: Game): void {
    this.buildTerrain(game);
    this.buildRamps(game);
    this.buildStairs(game);
    this.buildJumpTests(game);
    this.buildCrouchAndCeiling(game);
    this.buildMovingPlatforms(game);
    this.buildCrates(game);
    this.buildLadders(game);
    this.buildDoorHouse(game);
    this.buildSwitchLifts(game);
    this.buildSlideTower(game);
    this.buildPool(game);
    this.buildRiver(game);
    this.buildZiplines(game);
    this.buildNpcs(game);
    this.buildLocks(game);
    this.buildTrainingYard(game);
    this.buildBanditCamp(game);

    createPlayer(game, v(0, 0.05, 8), 0);
    addLabel(game, 'Movement Playground', [0, 3.2, 2], 1.6, '#ffe7a8');
  }

  // ---------------------------------------------------------------------------

  private buildTerrain(game: Game): void {
    const noise = new Noise2D(20261101);
    const flatRadius = 58;
    const hill = (x: number, z: number, cx: number, cz: number, h: number, r: number) =>
      h * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (r * r));

    const height = (x: number, z: number) => {
      const d = Math.hypot(x, z);
      const t = THREE.MathUtils.smoothstep(d, flatRadius, flatRadius + 50);
      const n = noise.fbm(x * 0.008, z * 0.008, 5) * 0.5 + 0.5;
      const ridge = 1 - Math.abs(noise.noise(x * 0.004 + 10, z * 0.004 - 7));
      const hills = n * 38 + ridge * ridge * 30;
      const bumps = noise.fbm(x * 0.05, z * 0.05, 3) * 0.6;
      // A grassy test hill inside the playground for natural-slope walking.
      const testHill = hill(x, z, -44, 32, 8, 8);
      return t * (hills + bumps) + testHill;
    };

    this.ground = height;
    createTerrain(game, { size: 500, segments: 250, height });
    addLabel(game, 'Terrain hill', [-44, 10, 32], 1.2);
  }

  private buildRamps(game: Game): void {
    const angles = [15, 25, 35, 45, 50, 60];
    const h = 2.5;
    const w = 4;
    const startZ = -12;
    addLabel(game, `Ramps · walkable up to ${PlayerConfig.maxSlopeClimbDeg}°`, [0, 4.6, startZ - 2], 1.3, '#ffe7a8');
    angles.forEach((angle, i) => {
      const x = (i - (angles.length - 1) / 2) * 7;
      const run = h / Math.tan(THREE.MathUtils.degToRad(angle));
      const steep = angle > PlayerConfig.maxSlopeClimbDeg;
      addWedge(game, {
        position: [x, 0, startZ],
        width: w,
        height: h,
        angleDeg: angle,
        color: steep ? Palette.rampSteep : Palette.ramp,
      });
      addBox(game, {
        name: `ramp-top-${angle}`,
        size: [w, h, 4],
        position: [x, h / 2, startZ - run - 2],
        color: Palette.neutral,
      });
      addLabel(game, `${angle}°`, [x, 1.6, startZ + 0.6], 1.1, steep ? '#ffb3a1' : '#ffffff');
    });
  }

  private buildStairs(game: Game): void {
    const rises = [0.15, 0.25, 0.35, 0.5];
    const depth = 0.4;
    const width = 3.5;
    const totalHeight = 2.4;
    const startX = 14;
    addLabel(game, `Stairs · auto-step up to ${Math.round(PlayerConfig.stepHeight * 100)}cm`, [startX + 2, 4.4, 7], 1.3, '#ffe7a8');

    rises.forEach((rise, i) => {
      const z = i * 5;
      const steps = Math.round(totalHeight / rise);
      const top = steps * rise;
      for (let s = 0; s < steps; s++) {
        const hgt = (s + 1) * rise;
        addBox(game, {
          name: `stair-${rise}-${s}`,
          size: [depth, hgt, width],
          position: [startX + depth * s + depth / 2, hgt / 2, z],
          color: Palette.stairs,
        });
      }
      const landingX = startX + depth * steps + 1.5;
      addBox(game, { name: `stair-landing-${rise}`, size: [3, top, width], position: [landingX, top / 2, z], color: Palette.neutral });
      const tooHigh = rise > PlayerConfig.stepHeight;
      addLabel(game, `${Math.round(rise * 100)}cm steps${tooHigh ? ' (jump)' : ''}`, [startX - 0.8, 1.3, z], 0.9, tooHigh ? '#ffb3a1' : '#ffffff');
    });
  }

  private buildJumpTests(game: Game): void {
    // Ledge heights
    const heights = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
    const x = -16;
    addLabel(game, 'Ledge heights', [x, 4, 4], 1.3, '#ffe7a8');
    heights.forEach((hgt, i) => {
      const z = 14 - i * 4;
      addBox(game, { name: `ledge-${hgt}`, size: [2.5, hgt, 2.5], position: [x, hgt / 2, z], color: Palette.jump });
      addLabel(game, `${hgt.toFixed(2)}m`, [x + 1.6, hgt + 0.5, z], 0.9);
    });

    // Gap jumps: pillars heading west, gaps growing by 1m each.
    const gaps = [1, 2, 3, 4, 5];
    const pillarH = 1.5;
    const pillarW = 2;
    let px = -24;
    const z = -10;
    addBox(game, { name: 'gap-step', size: [2, 0.75, 2], position: [px + 2, 0.375, z], color: Palette.neutral });
    addLabel(game, 'Gap jumps →', [px, 3.2, z], 1.2, '#ffe7a8');
    addBox(game, { name: 'gap-pillar-0', size: [pillarW, pillarH, pillarW], position: [px, pillarH / 2, z], color: Palette.jump });
    gaps.forEach((gap, i) => {
      px -= pillarW + gap;
      addBox(game, { name: `gap-pillar-${i + 1}`, size: [pillarW, pillarH, pillarW], position: [px, pillarH / 2, z], color: Palette.jump });
      addLabel(game, `${gap}m gap`, [px + pillarW / 2 + gap / 2, pillarH + 1, z], 0.9);
    });
  }

  private buildCrouchAndCeiling(game: Game): void {
    // Crouch tunnel: 1.3m clearance (standing height 1.8m, crouched 1.1m)
    const cx = -8;
    const cz = 20;
    const len = 6;
    const inner = 2.5;
    const clearance = 1.3;
    for (const side of [-1, 1]) {
      addBox(game, {
        name: 'tunnel-wall',
        size: [0.5, clearance, len],
        position: [cx + side * (inner / 2 + 0.25), clearance / 2, cz],
        color: Palette.tunnel,
      });
    }
    addBox(game, { name: 'tunnel-roof', size: [inner + 1, 0.4, len], position: [cx, clearance + 0.2, cz], color: Palette.tunnel });
    addLabel(game, 'Crouch tunnel (1.3m)', [cx, 2.4, cz + len / 2 + 0.2], 1);

    // Low ceiling to test head bumps while jumping.
    addBox(game, { name: 'ceiling', size: [4, 0.3, 4], position: [0, 2.65, 20], color: Palette.neutral });
    addBox(game, { name: 'ceiling-post', size: [0.3, 2.5, 0.3], position: [-1.85, 1.25, 18.15], color: Palette.neutral });
    addBox(game, { name: 'ceiling-post', size: [0.3, 2.5, 0.3], position: [1.85, 1.25, 21.85], color: Palette.neutral });
    addLabel(game, 'Head-bump ceiling (2.5m)', [0, 3.3, 20], 0.9);
  }

  private buildMovingPlatforms(game: Game): void {
    addLabel(game, 'Moving platforms', [0, 4.2, 25], 1.3, '#ffe7a8');

    const platform = (name: string, size: [number, number, number], motion: MotionFn, color: number = Palette.platform) => {
      const e = addBox(game, { name, size, position: [0, -50, 0], color, body: 'kinematicPosition' });
      e.add(new MovingPlatform(motion));
      return e;
    };

    // 1. Horizontal shuttle
    platform('platform-horizontal', [4, 0.4, 4], pingPong([v(-22, 0.2, 31), v(-9, 0.2, 31)], 3));
    addLabel(game, 'Horizontal', [-15.5, 2.2, 28.5], 0.9);

    // 2. Elevator up to a tower
    platform('platform-elevator', [4, 0.4, 4], pingPong([v(0, 0.2, 31), v(0, 6, 31)], 2, 1.5), Palette.platformAlt);
    addBox(game, { name: 'tower', size: [4, 6.2, 4], position: [4.05, 3.1, 31], color: Palette.neutral });
    addLabel(game, 'Elevator', [0, 2.2, 28.5], 0.9);

    // 3. Diagonal through 3D space
    platform('platform-diagonal', [4, 0.4, 4], pingPong([v(12, 0.2, 29), v(20, 4.5, 39)], 2.5));
    addLabel(game, 'Diagonal (3D)', [12, 2.2, 26.5], 0.9);

    // 4. Orbit with vertical bob
    platform('platform-orbit', [3.5, 0.4, 3.5], orbit(v(-14, 1.6, 45), 6, 14, 1.2), Palette.platformAlt);
    addLabel(game, 'Orbit', [-14, 4.5, 45], 0.9);

    // 5. Spinner (rotates the rider)
    platform('platform-spinner', [7, 0.4, 7], spin(v(4, 0.2, 45), 0.7));
    addLabel(game, 'Spinner', [4, 2.2, 41], 0.9);

    // 6. Multi-waypoint loop in 3D
    platform(
      'platform-loop',
      [3.5, 0.4, 3.5],
      pingPong([v(16, 0.2, 45), v(24, 2.5, 45), v(24, 5, 53), v(16, 3, 53)], 2.5, 0.6),
      Palette.platformAlt,
    );
    addBox(game, { name: 'loop-perch', size: [3, 5.2, 3], position: [28, 2.6, 53], color: Palette.neutral });
    addLabel(game, '3D waypoints', [16, 2.2, 42], 0.9);
  }

  private buildLadders(game: Game): void {
    // A 10m lookout tower straight ahead of the ramps, ladder facing spawn.
    addBox(game, { name: 'ladder-tower', size: [3, 10, 3], position: [0, 5, -40], color: Palette.neutral });
    addLadder(game, { position: [0, 0, -38.5], facingDeg: 0, height: 10 });
    addLabel(game, 'Ladder tower (10m)', [0, 2.6, -38], 1.1, '#ffe7a8');

    // Up the side of the elevator tower (6.2m), on its far (+X) face.
    addLadder(game, { position: [6.05, 0, 31], facingDeg: 90, height: 6.2 });

    // Onto the 3D-waypoint perch (5.2m).
    addLadder(game, { position: [29.5, 0, 53], facingDeg: 90, height: 5.2 });

    // Back of the steepest ramp's top block (2.5m), a short one.
    const run60 = 2.5 / Math.tan(THREE.MathUtils.degToRad(60));
    addLadder(game, { position: [17.5, 0, -12 - run60 - 4], facingDeg: 180, height: 2.5 });
    addLabel(game, 'Ladder', [17.5, 3.2, -12 - run60 - 4.3], 0.8);
  }

  /**
   * A 10x10m walled yard with a door in every wall:
   *   south: wooden swing door (E)      east: sliding metal door (E)
   *   north: vault door, levers on both sides   west: gate, buttons on both sides
   */
  private buildDoorHouse(game: Game): void {
    const cx = -33;
    const cz = 14;
    const half = 5;
    const wall = { height: 3.5, thickness: 0.3, color: 0xb9a58c };
    const [x0, x1, z0, z1] = [cx - half, cx + half, cz - half, cz + half];

    const [south] = addWall(game, { ...wall, from: [x0, z1], to: [x1, z1], openings: [{ at: half, width: 1.2, height: 2.2 }] });
    const [east] = addWall(game, { ...wall, from: [x1, z1], to: [x1, z0], openings: [{ at: half, width: 1.4, height: 2.3 }] });
    const [north] = addWall(game, { ...wall, from: [x1, z0], to: [x0, z0], openings: [{ at: half, width: 2.4, height: 2.6 }] });
    const [west] = addWall(game, { ...wall, from: [x0, z0], to: [x0, z1], openings: [{ at: half, width: 1.6, height: 2.4 }] });

    addDoor(game, { doorway: south, kind: 'swing', color: 0x9c6b3f, interactable: true, name: 'door-wood' });
    addDoor(game, { doorway: east, kind: 'slide', slideTo: 'side', color: 0x7f8c99, interactable: true, duration: 0.7, name: 'door-sliding' });

    const vault = addDoor(game, { doorway: north, kind: 'slide', slideTo: 'side', thickness: 0.2, color: 0x5d6b78, duration: 1.8, name: 'door-vault' }).door;
    const leverX = cx + 2.1;
    for (const side of [-1, 1]) {
      addLever(game, {
        position: [leverX, 1.3, z0 + side * (wall.thickness / 2)],
        facingDeg: side < 0 ? 180 : 0,
        prompt: () => (vault.isOn ? 'Pull lever (close vault)' : 'Pull lever (open vault)'),
        onUse: (user) => vault.activate('toggle', user),
        state: leverState(vault),
        name: 'lever-vault',
      });
    }

    const gate = addDoor(game, { doorway: west, kind: 'slide', slideTo: 'up', thickness: 0.16, color: 0x6e5a4a, duration: 1.4, name: 'door-gate' }).door;
    for (const side of [-1, 1]) {
      addButton(game, {
        position: [x0 + side * 1.6, 0, cz - 1.5],
        facingDeg: side < 0 ? -90 : 90,
        prompt: () => (gate.isOn ? 'Close gate' : 'Open gate'),
        onUse: (user) => gate.activate('toggle', user),
        state: toggleState(gate),
        name: 'button-gate',
      });
    }

    addLabel(game, 'Door house', [cx, 5.2, z1 + 0.5], 1.3, '#ffe7a8');
    addLabel(game, 'Press E', [cx, 4.1, z1 + 0.3], 0.8);
    addLabel(game, 'Press E (sliding)', [x1 + 0.3, 4.1, cz], 0.8);
    addLabel(game, 'Lever vault', [cx, 4.1, z0 - 0.3], 0.8);
    addLabel(game, 'Button gate', [x0 - 0.3, 4.1, cz], 0.8);
  }

  /** Lifts that only move when you press a button: a tall lift and a ferry between two pillars. */
  private buildSwitchLifts(game: Game): void {
    // Lift: 8m shaft next to a deck. Call buttons at both landings and a panel on board.
    const lift = addLift(game, {
      name: 'lift-switch',
      a: [32, 0.15, -10],
      b: [32, 8.15, -10],
      size: [3, 0.3, 3],
      speed: 2.2,
      color: Palette.platformAlt,
      panel: { x: -1.2, z: -1.2, facingDeg: 45 },
    }).lift;
    addBox(game, { name: 'lift-deck', size: [4, 8.3, 4], position: [35.55, 4.15, -10], color: Palette.neutral });
    addButton(game, { position: [29.6, 0, -12.2], facingDeg: -90, prompt: 'Call lift', onUse: () => lift.call(0), state: callState(lift, 0), name: 'button-lift-bottom' });
    addButton(game, { position: [34.2, 8.3, -11.7], facingDeg: -90, prompt: 'Call lift', onUse: () => lift.call(1), state: callState(lift, 1), name: 'button-lift-top' });
    addLabel(game, 'Switch lift', [29.6, 2.6, -12.2], 1.0, '#ffe7a8');

    // Ferry: crosses a 9m gap between two 3m pillars when you press the button.
    addBox(game, { name: 'ferry-pillar-a', size: [3, 3, 3], position: [30.5, 1.5, -24], color: Palette.neutral });
    addBox(game, { name: 'ferry-pillar-b', size: [3, 3, 3], position: [45.6, 1.5, -24], color: Palette.neutral });
    addLadder(game, { position: [29, 0, -24], facingDeg: -90, height: 3 });
    const ferry = addLift(game, {
      name: 'ferry-switch',
      a: [33.55, 2.85, -24],
      b: [42.55, 2.85, -24],
      size: [3, 0.3, 3],
      speed: 2.5,
      color: Palette.platform,
      panel: { x: 0, z: -1.2, facingDeg: 0 },
      prompt: (l) => (l.target === 1 ? 'Ride back' : 'Ride across'),
    }).lift;
    addButton(game, { position: [31.4, 3, -25.2], facingDeg: -90, prompt: 'Call ferry', onUse: () => ferry.call(0), state: callState(ferry, 0), name: 'button-ferry-a' });
    addButton(game, { position: [44.7, 3, -25.2], facingDeg: 90, prompt: 'Call ferry', onUse: () => ferry.call(1), state: callState(ferry, 1), name: 'button-ferry-b' });
    addLabel(game, 'Switch ferry', [30.5, 5.4, -24], 1.0, '#ffe7a8');
  }

  /**
   * A 6m tower with a ladder and three slopes too steep to stand on (50°, 60°,
   * 70°) running down its sides: climb up, step off, slide down.
   */
  private buildSlideTower(game: Game): void {
    const [tx, tz, h, half] = [-22, -38, 6, 2];
    addBox(game, { name: 'slide-tower', size: [half * 2, h, half * 2], position: [tx, h / 2, tz], color: Palette.neutral });
    addLadder(game, { position: [tx + half, 0, tz], facingDeg: 90, height: h });
    const run = (deg: number) => h / Math.tan(THREE.MathUtils.degToRad(deg));
    // yawDeg is the direction each wedge ascends (0 = toward -Z).
    addWedge(game, { name: 'slide-50', position: [tx, 0, tz + half + run(50)], yawDeg: 0, width: 4, height: h, angleDeg: 50, color: Palette.rampSteep });
    addWedge(game, { name: 'slide-60', position: [tx - half - run(60), 0, tz], yawDeg: -90, width: 4, height: h, angleDeg: 60, color: Palette.rampSteep });
    addWedge(game, { name: 'slide-70', position: [tx, 0, tz - half - run(70)], yawDeg: 180, width: 4, height: h, angleDeg: 70, color: Palette.rampSteep });
    addLabel(game, 'Slide tower', [tx, h + 1.6, tz], 1.2, '#ffe7a8');
    addLabel(game, '50°', [tx, 1.6, tz + half + run(50) + 0.4], 1);
    addLabel(game, '60°', [tx - half - run(60) - 0.4, 1.6, tz], 1);
    addLabel(game, '70°', [tx, 1.6, tz - half - run(70) - 0.4], 1);
  }

  /**
   * A raised pool, 3.5m deep: ramp up to the deck, jump or dive in, a shallow
   * end to wade in, an underwater arch to swim through, a ladder and low
   * edges to climb out, and a diving tower.
   */
  private buildPool(game: Game): void {
    const deck = 4;
    const surface = 3.6;
    const stone = 0xd9d2c3;
    // Inner pool: x 34..46, z 12..20. Walkways 2m wide around it.
    addBox(game, { name: 'pool-deck-n', size: [16, deck, 2], position: [40, deck / 2, 11], color: stone });
    addBox(game, { name: 'pool-deck-s', size: [16, deck, 2], position: [40, deck / 2, 21], color: stone });
    addBox(game, { name: 'pool-deck-w', size: [2, deck, 8], position: [33, deck / 2, 16], color: stone });
    addBox(game, { name: 'pool-deck-e', size: [2, deck, 8], position: [47, deck / 2, 16], color: stone });
    addBox(game, { name: 'pool-floor', size: [12, 0.1, 8], position: [40, 0.05, 16], color: 0x9fd0e0 });
    // Shallow end: 1m deep shelf along the east side.
    addBox(game, { name: 'pool-shallow', size: [4, 2.6, 8], position: [44, 1.3, 16], color: 0x9fd0e0 });
    addWater(game, { min: [34, 12], max: [46, 20], surfaceY: surface, bottomY: 0 });

    // Ramp up to the west walkway.
    const run = deck / Math.tan(THREE.MathUtils.degToRad(30));
    addWedge(game, { name: 'pool-ramp', position: [32 - run, 0, 16], yawDeg: -90, width: 3, height: deck, angleDeg: 30, color: Palette.ramp });

    // Ladder out of the deep end (north wall, inside).
    addLadder(game, { position: [37, 0.1, 12], facingDeg: 0, height: deck - 0.1 });

    // Underwater arch to swim through.
    addBox(game, { name: 'pool-arch', size: [0.6, 2, 0.6], position: [38, 1.1, 14.4], color: 0x7fa7b8 });
    addBox(game, { name: 'pool-arch', size: [0.6, 2, 0.6], position: [38, 1.1, 17.6], color: 0x7fa7b8 });
    addBox(game, { name: 'pool-arch', size: [0.6, 0.5, 3.8], position: [38, 2.35, 16], color: 0x7fa7b8 });

    // Diving tower on the south walkway with a board out over the deep end.
    addBox(game, { name: 'dive-tower', size: [2, 2, 2], position: [36, deck + 1, 21], color: stone });
    addLadder(game, { position: [37, deck, 21], facingDeg: 90, height: 2 });
    addBox(game, { name: 'dive-board', size: [0.8, 0.12, 2.4], position: [36, deck + 1.94, 18.9], color: 0x3e8fd0 });

    addLabel(game, 'Pool', [40, deck + 3.2, 16], 1.4, '#ffe7a8');
    addLabel(game, 'Shallow end', [44, deck + 1.2, 16], 0.8);
    addLabel(game, 'Diving board', [36, deck + 3.2, 21], 0.8);
  }

  /**
   * A 50m river channel flowing east (+X): a slow stretch you can swim
   * against, rapids you can only beat by sprint-swimming, and a beach at the
   * end where the current washes you up so you can wade out.
   */
  private buildRiver(game: Game): void {
    const [x0, x1] = [-25, 25];
    const [z0, z1] = [-51, -45]; // inner channel
    const bank = 2.5;
    const surface = 2.2;
    const stone = 0xa89f8c;
    const zc = (z0 + z1) / 2;
    addBox(game, { name: 'river-bank-n', size: [x1 - x0 + 4, bank, 2], position: [(x0 + x1) / 2, bank / 2, z0 - 1], color: stone });
    addBox(game, { name: 'river-bank-s', size: [x1 - x0 + 4, bank, 2], position: [(x0 + x1) / 2, bank / 2, z1 + 1], color: stone });
    addBox(game, { name: 'river-end-w', size: [2, bank, z1 - z0], position: [x0 - 1, bank / 2, zc], color: stone });
    addBox(game, { name: 'river-end-e', size: [2, bank, z1 - z0], position: [x1 + 1, bank / 2, zc], color: stone });
    addBox(game, { name: 'river-bed', size: [x1 - x0, 0.1, z1 - z0], position: [(x0 + x1) / 2, 0.05, zc], color: 0x7d8f6a });
    // Beach: the bed rises to bank height over the last 6m.
    const beachStart = x1 - 6;
    addWedge(game, { name: 'river-beach', position: [beachStart, 0.1, zc], yawDeg: -90, width: z1 - z0, height: bank - 0.1, angleDeg: Math.atan2(bank - 0.1, 6) * (180 / Math.PI), color: 0xd8c690 });
    // Rocks in the rapids to dodge.
    for (const [x, z] of [[6, -49.5], [11, -46.8], [15, -49]]) {
      addBox(game, { name: 'river-rock', size: [1.1, 2.6, 1.1], position: [x, 1.3, z], rotationDeg: [0, 30, 0], color: 0x8f877a });
    }

    const water = (from: number, to: number, speed: number) =>
      addWater(game, { min: [from, z0], max: [to, z1], surfaceY: surface, bottomY: 0, current: [speed, 0], color: 0x2d7fae });
    water(x0, 0, 1.5); // slow: you can swim upstream (swim speed 3.2)
    water(0, beachStart, 3.8); // rapids: sprint-swim (5.2) to make headway
    water(beachStart, x1, 1.2); // beach

    // Ramp up to the south bank near the upstream end.
    const run = bank / Math.tan(THREE.MathUtils.degToRad(30));
    addWedge(game, { name: 'river-ramp', position: [-10, 0, z1 + 2 + run], yawDeg: 0, width: 3, height: bank, angleDeg: 30, color: Palette.ramp });

    addLabel(game, 'River (current →)', [-12, bank + 2.2, zc], 1.3, '#ffe7a8');
    addLabel(game, 'Rapids', [8, bank + 1.4, zc], 0.9);
    addLabel(game, 'Beach', [x1 - 3, bank + 1.4, zc], 0.9);
  }

  /**
   * Ziplines: ride from the 10m ladder tower down to the slide tower, then
   * pull hand over hand along a flat cable to a new pillar; and a long ride
   * from the switch-lift deck down to the pool.
   */
  private buildZiplines(game: Game): void {
    const hang = PlayerConfig.zipHang + 0.25; // cable height above the floor you start/land on
    // Ladder tower top (0, 10, -40) -> slide tower top (-22, 6, -38).
    addZipline(game, { from: [-1, 10 + hang, -40], to: [-20.8, 6 + hang, -38.2], postHeight: hang + 0.15 });
    // Flat cable: slide tower -> new pillar to the west (hand over hand).
    addBox(game, { name: 'zip-pillar', size: [3, 6, 3], position: [-36, 3, -38], color: Palette.neutral });
    addLadder(game, { position: [-37.5, 0, -38], facingDeg: -90, height: 6 });
    addZipline(game, { from: [-23.2, 6 + hang, -38], to: [-35, 6 + hang, -38], postHeight: hang + 0.15 });
    // Lift deck top (35.55, 8.3, -10) -> pool north walkway (40, 4, 11).
    addZipline(game, { from: [35.3, 8.3 + hang, -8.8], to: [39.6, 4 + hang, 10.6], postHeight: hang + 0.15 });

    addLabel(game, 'Zipline (E to grab)', [-1.5, 10 + hang + 0.8, -40], 0.9, '#ffe7a8');
    addLabel(game, 'Hand over hand (hold W)', [-24, 6 + hang + 0.8, -38], 0.8);
    addLabel(game, 'Zipline to the pool', [35.3, 8.3 + hang + 0.8, -8.8], 0.9, '#ffe7a8');
  }

  private buildCrates(game: Game): void {
    addLabel(game, 'Pushable crates', [7, 3.4, 13], 1);
    const crate = (x: number, y: number, z: number, s = 1) =>
      addBox(game, {
        name: 'crate',
        size: [s, s, s],
        position: [x, y, z],
        color: Palette.crate,
        body: 'dynamic',
        density: 40,
        friction: 0.6,
      });
    crate(6, 0.5, 12);
    crate(7.1, 0.5, 12);
    crate(6.55, 1.5, 12);
    crate(8.5, 0.35, 14, 0.7);
    crate(5.5, 0.35, 14.2, 0.7);
  }

  /**
   * Dialogue examples. Mira greets you, Old Bram gives a "find my key" task,
   * and Tess's lines change once the key is returned. The key is on a table
   * in the door house. Conversations live in src/content/dialogue/*.json.
   * Items rest naturally on surfaces (see addItemPickup).
   */
  private buildNpcs(game: Game): void {
    addNpc(game, { id: 'npc-mira', name: 'Mira', dialogue: 'mira', position: [3.2, 0, 4.6], facingDeg: -42, color: 0x3f7cac });
    addNpc(game, { id: 'npc-tess', name: 'Tess', dialogue: 'tess', position: [-3.2, 0, 4.6], facingDeg: 42, color: 0x9a4f7a });
    addNpc(game, { id: 'npc-bram', name: 'Old Bram', dialogue: 'bram', position: [-30.6, 0, 20.6], facingDeg: 90, color: 0x6f6a3c });

    // Bram's table in the south-west corner of the door house, with his key on it.
    const [tx, tz] = [-36.6, 17.7];
    addBox(game, { name: 'table-top', size: [1.2, 0.08, 0.7], position: [tx, 0.76, tz], color: 0x8a6a48 });
    for (const [dx, dz] of [[-0.52, -0.27], [0.52, -0.27], [-0.52, 0.27], [0.52, 0.27]]) {
      addBox(game, { name: 'table-leg', size: [0.07, 0.72, 0.07], position: [tx + dx, 0.36, tz + dz], color: 0x6b4a2f });
    }
    addItemPickup(game, { id: 'bram-key', item: 'key_rusty', position: [tx + 0.15, 0.8, tz + 0.05], yawDeg: 28 });
    addItemPickup(game, { id: 'bram-list', item: 'note_storeroom', position: [tx - 0.3, 0.8, tz - 0.04], yawDeg: -14 });

    // Tess's apple crate.
    addBox(game, { name: 'apple-crate', size: [0.7, 0.55, 0.5], position: [-4.7, 0.275, 4.1], color: 0x8a6a48 });
    addItemPickup(game, { id: 'crate-apple-1', item: 'apple', position: [-4.85, 0.55, 4.05], yawDeg: 20 });
    addItemPickup(game, { id: 'crate-apple-2', item: 'apple', position: [-4.6, 0.55, 4.2], yawDeg: 140 });
    addItemPickup(game, { id: 'crate-apple-3', item: 'apple', position: [-4.5, 0.55, 3.97], yawDeg: 260 });

    // A few coins left on top of the ladder tower, as a reward for climbing it.
    addItemPickup(game, { id: 'tower-coins', item: 'gold', count: 5, position: [0.9, 10, -40.9], yawDeg: 35 });
  }

  /**
   * Keys and locks. Bram's storeroom is locked with his Rusty key (he also
   * unlocks it himself once you return the key). Its chest holds an Iron key,
   * which opens the locked chest on top of the slide tower.
   */
  private buildLocks(game: Game): void {
    const [cx, cz, half] = [-24, 22, 2];
    const [x0, x1, z0, z1] = [cx - half, cx + half, cz - half, cz + half];
    const wall = { height: 2.8, thickness: 0.25, color: 0x9a8670 };
    addWall(game, { ...wall, from: [x0, z1], to: [x1, z1] });
    addWall(game, { ...wall, from: [x1, z1], to: [x1, z0] });
    addWall(game, { ...wall, from: [x1, z0], to: [x0, z0] });
    const [west] = addWall(game, { ...wall, from: [x0, z0], to: [x0, z1], openings: [{ at: half, width: 1.1, height: 2.1 }] });
    addBox(game, { name: 'storeroom-roof', size: [half * 2 + 0.5, 0.2, half * 2 + 0.5], position: [cx, wall.height + 0.1, cz], color: 0x6b4a2f });
    addDoor(game, {
      doorway: west,
      kind: 'swing',
      color: 0x8a5a32,
      interactable: true,
      name: 'door-storeroom',
      lock: { id: 'storeroom', key: 'key_rusty', lockedText: "Locked. Bram's storeroom; he must have the key." },
    });
    addLabel(game, "Bram's storeroom", [x0 - 0.3, 3.4, cz], 0.8, '#ffe7a8');

    // A lantern under the roof, so the inside isn't pitch black.
    const lantern = new THREE.Group();
    lantern.position.set(cx + 0.3, wall.height - 0.35, cz);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.14), new THREE.MeshStandardMaterial({ color: 0xffd08a, emissive: 0xffb04a, emissiveIntensity: 1.4 }));
    lantern.add(glow);
    const light = new THREE.PointLight(0xffc27a, 6, 7, 1.6);
    lantern.add(light);
    game.world.spawn(new Entity('storeroom-lantern', lantern));

    // Inside: cider stock and Bram's chest.
    addBox(game, { name: 'cider-barrel', size: [0.7, 0.9, 0.7], position: [x1 - 0.55, 0.45, z0 + 0.55], color: 0x7a5634 });
    addBox(game, { name: 'cider-barrel', size: [0.7, 0.9, 0.7], position: [x1 - 1.3, 0.45, z0 + 0.55], color: 0x7a5634 });
    addBox(game, { name: 'cider-barrel', size: [0.7, 0.9, 0.7], position: [x1 - 0.55, 1.35, z0 + 0.55], color: 0x6f4d2e });
    addChest(game, {
      id: 'storeroom-chest',
      position: [x1 - 0.5, 0, z1 - 0.8],
      facingDeg: -90,
      contents: [{ item: 'iron_key' }, { item: 'cider', count: 2 }],
    });

    // The Iron key's chest, on top of the slide tower (climb its ladder).
    addChest(game, {
      id: 'tower-chest',
      position: [-23.1, 6, -36.8],
      facingDeg: 90,
      contents: [{ item: 'gold', count: 15 }, { item: 'old_map' }],
      lock: { id: 'tower-chest', key: 'iron_key', consumeKey: true, lockedText: 'Locked. The keyhole is square and black with rust.' },
    });
  }

  /**
   * The training yard: punch or cut the dummies (head x2, limbs x0.6), see an
   * armoured one shrug off blunt damage, catch fire in the fire pit, patch up
   * with draughts and bandages. Tables of weapons, bow and grenades, and
   * armour; a shooting range to the west. Falls hurt too: try the ladder tower.
   */
  private buildTrainingYard(game: Game): void {
    const [cx, cz] = [38, 34];
    addLabel(game, 'Training yard', [cx, 4.2, cz - 4], 1.3, '#ffe7a8');
    addLabel(game, 'Left click to punch', [cx, 3.5, cz - 4], 0.8);
    addDummy(game, { id: 'dummy-1', title: 'Dummy', position: [cx - 4, 0, cz - 2], facingDeg: 180 });
    addDummy(game, { id: 'dummy-2', title: 'Dummy', position: [cx - 1, 0, cz - 2], facingDeg: 180 });
    addDummy(game, {
      id: 'dummy-armoured',
      title: 'Armoured (resists blunt)',
      position: [cx + 2.5, 0, cz - 2],
      facingDeg: 180,
      color: 0x8c949c,
      resist: { blunt: 0.6, slash: 0.7, pierce: 0.3 },
    });
    addFirePit(game, { name: 'fire pit', position: [cx + 1, 0, cz + 3.5] });
    addLabel(game, 'Fire pit (it burns)', [cx + 1, 2.2, cz + 3.5], 0.8, '#ffb3a1');

    const [tx, tz] = [cx - 4, cz + 3.5];
    addBox(game, { name: 'yard-table-top', size: [1.2, 0.08, 0.7], position: [tx, 0.76, tz], color: 0x8a6a48 });
    for (const [dx, dz] of [[-0.52, -0.27], [0.52, -0.27], [-0.52, 0.27], [0.52, 0.27]]) {
      addBox(game, { name: 'yard-table-leg', size: [0.07, 0.72, 0.07], position: [tx + dx, 0.36, tz + dz], color: 0x6b4a2f });
    }
    addItemPickup(game, { id: 'yard-draught-1', item: 'healing_draught', position: [tx - 0.2, 0.8, tz + 0.05] });
    addItemPickup(game, { id: 'yard-draught-2', item: 'healing_draught', position: [tx + 0.15, 0.8, tz - 0.1] });
    addItemPickup(game, { id: 'yard-bandages', item: 'bandage', count: 3, position: [tx + 0.42, 0.8, tz + 0.1], yawDeg: 20 });
    addLabel(game, 'Draughts and bandages', [tx, 1.7, tz], 0.7);

    // Weapons table: a longsword and a pistol with ammunition.
    const [wx, wz] = [cx + 5.5, cz + 1];
    addBox(game, { name: 'yard-weapon-table', size: [0.8, 0.08, 1.6], position: [wx, 0.76, wz], color: 0x8a6a48 });
    for (const [dx, dz] of [[-0.33, -0.72], [0.33, -0.72], [-0.33, 0.72], [0.33, 0.72]]) {
      addBox(game, { name: 'yard-table-leg', size: [0.07, 0.72, 0.07], position: [wx + dx, 0.36, wz + dz], color: 0x6b4a2f });
    }
    addItemPickup(game, { id: 'yard-longsword', item: 'longsword', position: [wx - 0.05, 0.8, wz + 0.05], yawDeg: 90 });
    addItemPickup(game, { id: 'yard-pistol', item: 'pistol', position: [wx + 0.15, 0.8, wz - 0.55], yawDeg: 70 });
    addItemPickup(game, { id: 'yard-rounds-1', item: 'pistol_rounds', count: 16, position: [wx - 0.2, 0.8, wz - 0.6], yawDeg: 10 });
    addItemPickup(game, { id: 'yard-rounds-2', item: 'pistol_rounds', count: 16, position: [wx - 0.2, 0.8, wz - 0.45], yawDeg: -15 });
    addLabel(game, 'Weapons', [wx, 1.8, wz], 0.8, '#ffe7a8');

    // Second table: longbow and arrows, grenades.
    const [bx, bz] = [wx, wz + 3];
    addBox(game, { name: 'yard-ranged-table', size: [0.8, 0.08, 1.6], position: [bx, 0.76, bz], color: 0x8a6a48 });
    for (const [dx, dz] of [[-0.33, -0.72], [0.33, -0.72], [-0.33, 0.72], [0.33, 0.72]]) {
      addBox(game, { name: 'yard-table-leg', size: [0.07, 0.72, 0.07], position: [bx + dx, 0.36, bz + dz], color: 0x6b4a2f });
    }
    addItemPickup(game, { id: 'yard-longbow', item: 'longbow', position: [bx, 0.8, bz + 0.1], yawDeg: 0 });
    addItemPickup(game, { id: 'yard-arrows-1', item: 'arrows', count: 12, position: [bx + 0.22, 0.8, bz - 0.5], yawDeg: 80 });
    addItemPickup(game, { id: 'yard-grenades', item: 'grenade', count: 3, position: [bx - 0.2, 0.8, bz - 0.55], yawDeg: 30 });
    addItemPickup(game, { id: 'yard-fire-arrows', item: 'fire_arrows', count: 6, position: [bx + 0.2, 0.8, bz + 0.6], yawDeg: 100 });
    addLabel(game, 'Bow and grenades', [bx, 1.8, bz], 0.8, '#ffe7a8');

    // Third table: armour, medieval and modern. Wear it from the inventory (Tab).
    const [ax, az] = [wx, bz + 3.2];
    addBox(game, { name: 'yard-armour-table', size: [0.8, 0.08, 1.6], position: [ax, 0.76, az], color: 0x8a6a48 });
    for (const [dx, dz] of [[-0.33, -0.72], [0.33, -0.72], [-0.33, 0.72], [0.33, 0.72]]) {
      addBox(game, { name: 'yard-table-leg', size: [0.07, 0.72, 0.07], position: [ax + dx, 0.36, az + dz], color: 0x6b4a2f });
    }
    addItemPickup(game, { id: 'yard-leather-cap', item: 'leather_cap', position: [ax - 0.15, 0.8, az - 0.6], yawDeg: 0 });
    addItemPickup(game, { id: 'yard-steel-helm', item: 'steel_helm', position: [ax + 0.15, 0.8, az - 0.3], yawDeg: 90 });
    addItemPickup(game, { id: 'yard-hauberk', item: 'mail_hauberk', position: [ax, 0.8, az + 0.15], yawDeg: 90 });
    addItemPickup(game, { id: 'yard-vest', item: 'ballistic_vest', position: [ax, 0.8, az + 0.58], yawDeg: 90 });
    addLabel(game, 'Armour (wear it from Tab)', [ax, 1.8, az], 0.8, '#ffe7a8');

    // Shooting range west of the yard: dummies at 10, 20 and 30 m from the firing line.
    const lineX = cx - 6;
    const rz = cz + 5;
    addBox(game, { name: 'yard-firing-line', size: [0.15, 0.04, 3], position: [lineX, 0.02, rz], color: 0xe8dcb5 });
    addLabel(game, 'Firing line', [lineX, 2.2, rz], 0.8, '#ffe7a8');
    // Staggered sideways so nearer ones don't stand in front of farther ones.
    for (const [d, dz] of [[10, -1.5], [20, 0], [30, 1.5]]) {
      addDummy(game, { id: `range-${d}`, title: `${d} m`, position: [lineX - d, 0, rz + dz], facingDeg: 90 });
    }
  }

  /**
   * Combat phase 5: a bandit camp south of the playground. A sword bandit
   * keeps watch by the fire and a marksman with a musket stands on the
   * rocks behind. They see and hear you (crouch to get closer unseen; shots
   * carry), fight back, guard and parry, and drop what they carry.
   */
  private buildBanditCamp(game: Game): void {
    const [cx, cz] = [-20, 60];
    const g = (x: number, z: number) => this.ground(x, z);
    addLabel(game, 'Bandit camp', [cx, g(cx, cz - 7) + 3.2, cz - 7], 1.1, '#ff9c8f');
    addLabel(game, 'They fight back: right click to guard, time it to parry', [cx, g(cx, cz - 7) + 2.6, cz - 7], 0.6);
    // A ring of logs round a small fire, two tents, crates, and a rocky perch.
    addFirePit(game, { name: 'camp fire', position: [cx, g(cx, cz), cz] });
    for (const [dx, dz, r] of [[-2.2, 0, 90], [2.2, 0.3, 80], [0, 2.3, 0]] as const) {
      addBox(game, { name: 'camp-log', size: [1.8, 0.32, 0.32], position: [cx + dx, g(cx + dx, cz + dz) + 0.16, cz + dz], rotationDeg: [0, r, 0], color: 0x6b4a2f });
    }
    for (const [tx, tz, r] of [[cx - 5, cz + 3, 20], [cx + 4.5, cz + 4, -25]] as const) {
      // Two ramps back to back make an A-frame tent.
      const run = 1.6 / Math.tan(THREE.MathUtils.degToRad(55));
      const y = THREE.MathUtils.degToRad(r);
      const [bx, bz] = [tx - Math.sin(y) * 2 * run, tz - Math.cos(y) * 2 * run];
      addWedge(game, { name: 'camp-tent', position: [tx, g(tx, tz), tz], width: 2.4, height: 1.6, angleDeg: 55, color: 0x8b7d5e, yawDeg: r });
      addWedge(game, { name: 'camp-tent', position: [bx, g(bx, bz), bz], width: 2.4, height: 1.6, angleDeg: 55, color: 0x7a6c50, yawDeg: r + 180 });
    }
    for (const [x, z, s] of [[cx + 3.2, cz - 2.2, 0.7], [cx + 3.9, cz - 1.6, 0.55], [cx - 3.6, cz - 2.5, 0.6]] as const) {
      addBox(game, { name: 'camp-crate', size: [s, s, s], position: [x, g(x, z) + s / 2, z], color: 0x9a7a4e, rotationDeg: [0, x * 13, 0] });
    }
    const [rx, rz] = [cx - 3, cz + 7.5];
    addBox(game, { name: 'camp-rock', size: [3.2, 1.1, 2.4], position: [rx, g(rx, rz) + 0.45, rz], color: 0x7d786f, rotationDeg: [0, 12, 0] });
    addBox(game, { name: 'camp-rock', size: [1.3, 0.55, 1.1], position: [rx + 2.1, g(rx + 2.1, rz - 0.6) + 0.22, rz - 0.6], color: 0x77736c, rotationDeg: [0, 40, 0] });

    addEnemy(game, { id: 'bandit-sword', archetype: 'sword_bandit', position: [cx + 1.2, g(cx + 1.2, cz - 2.6) + 0.05, cz - 2.6], facingDeg: 180 });
    addEnemy(game, { id: 'bandit-musket', archetype: 'musket_bandit', position: [rx, g(rx, rz) + 1.05, rz], facingDeg: 190 });
  }
}
