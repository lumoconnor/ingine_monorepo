import * as THREE from 'three';
import type { Game } from '@ingine/engine/core/Game';
import { Entity } from '@ingine/engine/entities/Entity';
import type { Teleports } from '../Teleports';
import { HUB, SCENES, type SceneDef, type Vec3, yawToward } from '../scenes';
import { box, cylinder, decor, label, mat, seeded, teleportPad, tree } from './kit';

/** Ring radius of the portal pads around the cake. */
const RING = 17;
const PLAZA = 26;

/** Where on the ring a scene's portal sits (angle 0 = +Z, the spawn side, is left free). */
export function portalAngle(i: number): number {
  // Seven portals spread over the circle, leaving a gap at the south (spawn) side.
  const gap = THREE.MathUtils.degToRad(70);
  return Math.PI + (i - (SCENES.length - 1) / 2) * ((Math.PI * 2 - gap) / (SCENES.length - 1));
}

/** Where you land coming back to the hub from scene `i`: just inside its portal, facing the cake. */
export function hubReturnPoint(i: number): { to: Vec3; yaw: number } {
  const a = portalAngle(i);
  const to: Vec3 = [Math.sin(a) * (RING - 3.4), 0.05, Math.cos(a) * (RING - 3.4)];
  return { to, yaw: yawToward(to, [0, 0, 0]) };
}

/** Where you land arriving in a scene: a few metres in front of its return pad. */
export function sceneArrival(s: SceneDef): { to: Vec3; yaw: number; padAt: Vec3 } {
  const [x, y, z] = s.origin;
  return { to: [x, y + 0.05, z + 6], yaw: 0, padAt: [x, y, z + 10] };
}

/**
 * The party plaza: a giant birthday cake in the middle, portals in a ring
 * around it, balloons, bunting and trees. You arrive on the south side,
 * looking at the cake.
 */
export function buildHub(game: Game, teleports: Teleports): void {
  const [ox, , oz] = HUB.origin;

  // Grass, then a round stone plaza on top.
  box(game, [240, 1, 240], [ox, -0.5, oz], 0x6f9a5b, 'grass');
  decor(game, new THREE.CylinderGeometry(PLAZA, PLAZA, 0.04, 64), mat(0xd9cfbd, { roughness: 0.9 }), [ox, 0.02, oz], 'plaza', false);
  decor(game, new THREE.TorusGeometry(PLAZA, 0.18, 6, 96).rotateX(Math.PI / 2), mat(0xb3a58c), [ox, 0.04, oz], 'plaza-edge', false);

  cake(game);
  for (let i = 0; i < SCENES.length; i++) portal(game, teleports, SCENES[i], i);
  balloons(game);
  bunting(game);
  scenery(game);

  // Arrive on the south side looking at the cake.
  const spawn: Vec3 = [ox, 0.05, oz + 13];
  teleports.setHubArrival(spawn, yawToward(spawn, [ox, 0, oz]));
  label(game, 'Walk onto a portal to visit a world. Press H to come back here.', [ox, 2.4, oz + 21], 0.55, '#fff3c4');
}

function cake(game: Game): void {
  const sponge = mat(0xf6d7a7);
  const icing = mat(0xfff7f0, { roughness: 0.4 });
  const pink = mat(0xf28cb1, { roughness: 0.5 });
  // Three tiers; you can climb onto the bottom one.
  const tiers: [number, number][] = [
    [5, 1.2],
    [3.6, 1.1],
    [2.3, 1.0],
  ];
  let y = 0;
  for (const [r, h] of tiers) {
    cylinder(game, r, h, [0, y + h / 2, 0], sponge, 'cake');
    // Icing lip and a band of sprinkles-pink.
    decor(game, new THREE.CylinderGeometry(r + 0.04, r + 0.04, 0.12, 48), icing, [0, y + h - 0.06, 0], 'icing');
    decor(game, new THREE.CylinderGeometry(r + 0.03, r + 0.03, 0.18, 48), pink, [0, y + h * 0.35, 0], 'cake-band');
    y += h;
  }
  // A "4" and a "0" as big candles, built from blocks.
  const wax = 0x5fb8ff;
  const s = 0.32; // stroke
  const h = 1.7;
  const base = y + 0.05;
  const four = (x: number) => {
    box(game, [s, h, s], [x + 0.45, base + h / 2, 0], wax, 'candle'); // right stem
    box(game, [s, h * 0.55, s], [x - 0.35, base + h * 0.72, 0], wax, 'candle'); // left arm
    box(game, [1.1, s, s], [x + 0.05, base + h * 0.42, 0], wax, 'candle'); // crossbar
  };
  const zero = (x: number) => {
    // An oval ring standing on its edge.
    const o = decor(game, new THREE.TorusGeometry(0.5, s / 2, 12, 36), mat(wax), [x, base + h / 2, 0], 'candle');
    o.object3d.scale.set(1, h / (1 + s), 1);
  };
  four(-0.8);
  zero(0.8);
  // Flames on top.
  const flame = new THREE.MeshBasicMaterial({ color: 0xffb030 });
  for (const x of [-0.35, 0.8]) {
    const f = decor(game, new THREE.ConeGeometry(0.12, 0.34, 10), flame, [x, base + h + 0.2, 0], 'flame', false);
    f.object3d.scale.set(1, 1.2, 1);
  }
  const glow = new THREE.PointLight(0xffb84a, 14, 14, 1.8);
  glow.position.set(0.2, base + h + 0.6, 0);
  const e = new Entity('cake-glow');
  e.object3d.add(glow);
  game.world.spawn(e);
  label(game, 'Happy 40th, Gene!', [0, base + h + 2.2, 0], 3.4, '#ffe066');
}

function portal(game: Game, teleports: Teleports, s: SceneDef, i: number): void {
  const a = portalAngle(i);
  const at: Vec3 = [Math.sin(a) * RING, 0, Math.cos(a) * RING];
  const arrive = sceneArrival(s);
  teleportPad(game, teleports, {
    at,
    color: s.color,
    title: s.name,
    subtitle: s.built ? s.blurb : `${s.blurb} (coming soon)`,
    to: arrive.to,
    toYaw: arrive.yaw,
    sceneId: s.id,
    facingDeg: THREE.MathUtils.radToDeg(a),
  });
}

function balloons(game: Game): void {
  const rand = seeded(40);
  const colours = [0xff5d73, 0xffc94a, 0x4fb3ff, 0x7bd389, 0xb48cff, 0xff9f43];
  const string = new THREE.LineBasicMaterial({ color: 0xeeeeee });
  // Clusters tied to weights between the portals.
  for (let i = 0; i < SCENES.length; i++) {
    const a = (portalAngle(i) + portalAngle(Math.min(i + 1, SCENES.length - 1))) / 2 + (i === SCENES.length - 1 ? 0.35 : 0);
    const bx = Math.sin(a) * (RING + 3);
    const bz = Math.cos(a) * (RING + 3);
    box(game, [0.35, 0.3, 0.35], [bx, 0.15, bz], 0x555a66, 'balloon-weight');
    for (let k = 0; k < 5; k++) {
      const top: Vec3 = [bx + (rand() - 0.5) * 1.4, 3 + rand() * 1.6, bz + (rand() - 0.5) * 1.4];
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 14), mat(colours[(i + k) % colours.length], { roughness: 0.3 }));
      m.scale.set(1, 1.18, 1);
      m.position.set(...top);
      m.castShadow = true;
      game.world.spawn(new Entity('balloon', m));
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(bx, 0.3, bz), new THREE.Vector3(top[0], top[1] - 0.5, top[2])]);
      game.world.spawn(new Entity('balloon-string', new THREE.Line(g, string)));
    }
  }
}

function bunting(game: Game): void {
  // Strings of flags from the cake candles out to poles at the plaza edge.
  const colours = [0xff5d73, 0xffc94a, 0x4fb3ff, 0x7bd389, 0xffffff];
  const flagGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.22, 0, 0), new THREE.Vector3(0.22, 0, 0), new THREE.Vector3(0, -0.45, 0)]);
  flagGeo.computeVertexNormals();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const pole: Vec3 = [Math.sin(a) * (PLAZA - 1.5), 0, Math.cos(a) * (PLAZA - 1.5)];
    cylinder(game, 0.08, 6, [pole[0], 3, pole[2]], mat(0xeeeeee), 'bunting-pole', 8);
    const from = new THREE.Vector3(0, 6.2, 0);
    const to = new THREE.Vector3(pole[0], 5.9, pole[2]);
    const n = 22;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const p = from.clone().lerp(to, t);
      p.y -= Math.sin(t * Math.PI) * 1.4; // sag
      pts.push(p);
    }
    game.world.spawn(new Entity('bunting-line', new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xdddddd }))));
    for (let k = 2; k < n; k += 2) {
      const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color: colours[k % colours.length], side: THREE.DoubleSide }));
      flag.position.copy(pts[k]);
      flag.rotation.y = -a + Math.PI / 2;
      game.world.spawn(new Entity('flag', flag));
    }
  }
}

function scenery(game: Game): void {
  const rand = seeded(1984);
  for (let i = 0; i < 46; i++) {
    const a = rand() * Math.PI * 2;
    const r = PLAZA + 5 + rand() * 50;
    tree(game, Math.sin(a) * r, Math.cos(a) * r, 0.8 + rand() * 0.8);
  }
  // Benches facing the cake.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const x = Math.sin(a) * 9;
    const z = Math.cos(a) * 9;
    const yaw = THREE.MathUtils.radToDeg(a);
    box(game, [1.8, 0.08, 0.5], [x, 0.45, z], 0xa0703f, 'bench', [0, yaw, 0]);
    box(game, [1.6, 0.42, 0.4], [x, 0.21, z], 0x6b6f78, 'bench-leg', [0, yaw, 0]);
  }
}

/** A scene that isn't built yet: a small themed island with a sign and the way home. */
export function buildPlaceholder(game: Game, teleports: Teleports, s: SceneDef, i: number): void {
  const [x, y, z] = s.origin;
  box(game, [40, 1, 40], [x, y - 0.5, z], 0x7c8a6e, `${s.id}-ground`);
  decor(game, new THREE.CylinderGeometry(6, 6, 0.04, 48), mat(s.color, { roughness: 0.8 }), [x, y + 0.02, z - 4], 'placeholder-disc', false);
  label(game, s.name, [x, y + 4.2, z - 4], 2.2, '#ffe066');
  label(game, 'Coming soon!', [x, y + 2.8, z - 4], 1.1);
  buildReturnPad(game, teleports, s, i);
}

/** The pad that takes you back to the plaza, behind where you arrive. */
export function buildReturnPad(game: Game, teleports: Teleports, s: SceneDef, i: number): void {
  const { padAt } = sceneArrival(s);
  const back = hubReturnPoint(i);
  teleportPad(game, teleports, {
    at: padAt,
    color: HUB.color,
    title: 'Back to the party',
    to: back.to,
    toYaw: back.yaw,
    sceneId: HUB.id,
    facingDeg: 0,
  });
}
