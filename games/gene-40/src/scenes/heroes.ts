import * as THREE from 'three';
import type { Game } from '@ingine/engine/core/Game';
import { Entity } from '@ingine/engine/entities/Entity';
import { RAPIER } from '@ingine/engine/physics/PhysicsWorld';
import { RigidBodyComponent } from '@ingine/engine/physics/RigidBodyComponent';
import type { Teleports } from '../Teleports';
import { sceneById, type Vec3 } from '../scenes';
import { box, cylinder, decor, label, mat, seeded, sign, tree } from './kit';
import { buildReturnPad } from './hub';
import { addCat } from './murph';
import { HeroPowers, POWERS, type PowerId, type Station } from './heroPowers';
import { HeroEmergencies, type EmergencySites } from './heroEmergencies';

export { HeroPowers, POWERS, type PowerId } from './heroPowers';

/**
 * Hero city: an original superhero town, with one goal: SAVE HERO CITY. You
 * arrive in the hero suit (a big jump and a fast run), and work down one
 * chain (heroEmergencies.ts): take Swing on the plaza, catch a kitten falling
 * off a roof, swing up to a rooftop for Flight, fly cats out of a burning
 * building, fly Captain Whiskers' ring race, fly to the top of Hero HQ for
 * Super strength, stop a runaway bus. One beam marks where to go and the top
 * panel always says what's next. Rescued cats wait in the basket on the
 * plaza. Parked cars and bins line the streets for super strength and the
 * ground slam to throw around. Captain Whiskers, the city's caped cat, keeps
 * an eye on things.
 */

type At = (x: number, y: number, z: number) => Vec3;

const HQ_HEIGHT = 80;

export function buildHeroes(game: Game, teleports: Teleports, index: number): HeroPowers {
  const s = sceneById('heroes')!;
  const [ox, oy, oz] = s.origin;
  const at: At = (x, y, z) => [ox + x, oy + y, oz + z];

  streets(game, at);
  const roofs = city(game, at);
  hq(game, at);
  const stations = powerStations(game, at, roofs);
  buildReturnPad(game, teleports, s, index);

  // Captain Whiskers, in a cape, by the kitten basket.
  const captain = addCat(game, { id: 'captain_whiskers', name: 'Captain Whiskers', fur: 0x3a3a44, belly: 0xffffff, s: 1.6, at: at(-15, 0, 3), facingDeg: 50, sitting: true, groundY: oy });
  // A red cape down his back (the model faces +Z) and a gold collar clasp.
  const cape = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.8, 0.03), mat(0xd7263d, { roughness: 0.6 }));
  cape.position.set(0, 0.4, -0.38);
  cape.rotation.x = 0.22;
  cape.castShadow = true;
  const clasp = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 8, 20).rotateX(Math.PI / 2), mat(0xffd84a, { metalness: 0.5, roughness: 0.3 }));
  clasp.position.set(0, 0.68, -0.03);
  captain.object3d.children[0]?.add(clasp);
  captain.object3d.children[0]?.add(cape);

  const powers = game.addSystem(new HeroPowers(stations));
  powers.init(game);
  powers.setBasket(at(-11, 0, 4.5));
  streetStuff(game, at, powers);
  powers.render();
  const emergencies = game.addSystem(new HeroEmergencies(powers, emergencySites(at, roofs)));
  powers.mission = emergencies;
  emergencies.init(game);
  return powers;
}

// --- Streets ------------------------------------------------------------------

function streets(game: Game, at: At): void {
  box(game, [210, 1, 190], at(0, -0.5, -55), 0x55585f, 'hero-asphalt');
  // The plaza: a pale tiled square with the power stations.
  decor(game, new THREE.BoxGeometry(40, 0.04, 30), mat(0xd9d4c7, { roughness: 0.9 }), at(0, 0.02, -2), 'plaza', false);
  decor(game, new THREE.CircleGeometry(4.5, 40).rotateX(-Math.PI / 2), mat(0x7b5cff, { roughness: 0.6 }), at(0, 0.05, -10), 'plaza-star-bg', false);
  decor(game, starShape(3.6), mat(0xffd84a, { roughness: 0.5, emissive: 0x3a2a00, emissiveIntensity: 0.5 }), at(0, 0.06, -10), 'plaza-star', false);
  // The avenue to HQ, with dashed centre lines.
  const dash = mat(0xf4f0e0, { roughness: 1 });
  for (let z = -22; z > -140; z -= 6) decor(game, new THREE.BoxGeometry(0.3, 0.02, 3), dash, at(0, 0.01, z), 'lane', false);
  sign(game, 'HERO CITY', at(0, 3.6, -16.5), { width: 6, height: 1.1, bg: '#7b5cff', fg: '#ffffff', letterSpacing: 6 });
  for (const x of [-3.2, 3.2]) box(game, [0.25, 4.2, 0.25], at(x, 2.1, -16.6), 0x3a2f7a, 'sign-post');
  // A few street trees and lamps around the plaza.
  for (const x of [-19, 19]) for (const z of [-14, -4, 6]) tree(game, at(x, 0, z)[0], at(0, 0, z)[2], 0.9);
  for (const [x, z] of [[-12, -15], [12, -15], [-12, 11], [12, 11]]) lamp(game, at(x, 0, z));
}

function lamp(game: Game, p: Vec3): void {
  cylinder(game, 0.09, 4.4, [p[0], p[1] + 2.2, p[2]], mat(0x2d2f36, { metalness: 0.5, roughness: 0.4 }), 'lamp-post', 10);
  decor(game, new THREE.SphereGeometry(0.32, 16, 12), mat(0xfff2c0, { emissive: 0xffe9a0, emissiveIntensity: 1.2 }), [p[0], p[1] + 4.6, p[2]], 'lamp', false);
}

function starShape(r: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const rr = i % 2 ? r * 0.45 : r;
    const x = Math.sin(a) * rr;
    const y = Math.cos(a) * rr;
    if (i) s.lineTo(x, y);
    else s.moveTo(x, y);
  }
  return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2);
}

// --- Buildings ----------------------------------------------------------------

let facade: HTMLCanvasElement | null = null;
/** One window cell: a pale wall with a dark glass pane (tinted by the material colour). */
function facadeCanvas(): HTMLCanvasElement {
  if (facade) return facade;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#2a3550';
  g.fillRect(10, 12, 44, 38);
  g.fillStyle = '#56709a';
  g.fillRect(10, 12, 44, 8);
  facade = c;
  return c;
}

/** A solid tower block with windows on its sides and a plain flat roof. Returns the roof centre. */
function building(game: Game, centre: Vec3, w: number, d: number, h: number, color: number, name = 'building'): Vec3 {
  const tex = (along: number) => {
    const t = new THREE.CanvasTexture(facadeCanvas());
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(Math.max(1, Math.round(along / 3.5)), Math.max(1, Math.round(h / 3.5)));
    return new THREE.MeshStandardMaterial({ map: t, color, roughness: 0.75 });
  };
  const sideX = tex(d);
  const sideZ = tex(w);
  const roof = mat(0x6d6f75, { roughness: 0.95 });
  // Box faces: +x, -x, +y, -y, +z, -z.
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [sideX, sideX, roof, roof, sideZ, sideZ]);
  mesh.position.set(centre[0], centre[1] + h / 2, centre[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const e = new Entity(name, mesh);
  e.tags.add('building');
  e.add(new RigidBodyComponent({ type: 'fixed', colliders: [RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setFriction(0.8)] }));
  game.world.spawn(e);
  return [centre[0], centre[1] + h, centre[2]];
}

export interface Roof {
  top: Vec3;
  w: number;
  d: number;
}

/**
 * A grid of blocks with an avenue down the middle to Hero HQ. The layout is
 * seeded, so every player sees the same skyline.
 */
function city(game: Game, at: At): Roof[] {
  const rand = seeded(4242);
  const palette = [0xb8c4d6, 0xd6c2a8, 0xa8c8c0, 0xc9b0c9, 0xd8d0b8, 0x9fb3cc, 0xe0b8a0];
  const roofs: Roof[] = [];
  const xs = [-72, -48, -24, 24, 48, 72];
  const zs = [12, -12, -36, -60, -84, -108, -132];
  for (const x of xs)
    for (const z of zs) {
      if (Math.abs(x) <= 24 && z > -24) continue; // the plaza
      const w = 13 + Math.floor(rand() * 5);
      const d = 13 + Math.floor(rand() * 5);
      // Lower near the plaza, taller further out.
      const far = Math.min(1, (Math.abs(x) / 72 + -z / 132) / 1.6);
      const h = Math.round(10 + rand() * 18 + far * 30);
      const top = building(game, at(x, 0, z), w, d, h, palette[Math.floor(rand() * palette.length)]);
      roofs.push({ top, w, d });
      roofProps(game, top, w, d, rand);
    }
  // A low diner by the plaza: a super jump gets you onto its roof.
  const diner = building(game, at(-31, 0, 4), 10, 9, 6, 0xe86a5a, 'hero-diner');
  sign(game, 'HERO DINER', [diner[0] + 5.06, 4.6, diner[2]], { width: 6, height: 1, yawDeg: 90, bg: '#fff3c4', fg: '#c8303a' });
  roofs.unshift({ top: diner, w: 10, d: 9 });
  return roofs;
}

function roofProps(game: Game, top: Vec3, w: number, d: number, rand: () => number): void {
  const [x, y, z] = top;
  const r = rand();
  if (r < 0.4) {
    // A water tower on four legs.
    const tx = x + (rand() - 0.5) * (w - 6);
    const tz = z - d / 2 + 3;
    for (const [lx, lz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) box(game, [0.18, 2.4, 0.18], [tx + lx, y + 1.2, tz + lz], 0x5a4632, 'tower-leg');
    cylinder(game, 1.5, 2.6, [tx, y + 2.4 + 1.3, tz], mat(0x8b6a48, { roughness: 0.9 }), 'water-tank', 20);
    decor(game, new THREE.ConeGeometry(1.65, 0.9, 20), mat(0x5a4632), [tx, y + 2.4 + 2.6 + 0.45, tz], 'tank-roof');
  } else if (r < 0.75) {
    // Air-con units.
    for (let i = 0; i < 2; i++) box(game, [2, 1.1, 1.4], [x - w / 2 + 2.5 + i * 3, y + 0.55, z + d / 2 - 2.2], 0xc9ccd2, 'aircon');
  } else {
    // A rooftop garden bed.
    box(game, [w * 0.5, 0.5, 2], [x, y + 0.25, z - d / 2 + 2], 0x7a5536, 'planter');
    decor(game, new THREE.BoxGeometry(w * 0.5 - 0.3, 0.3, 1.7), mat(0x5aa04a, { roughness: 1 }), [x, y + 0.6, z - d / 2 + 2], 'planter-grass', false);
  }
}

/** Hero HQ: a tall tower at the end of the avenue, with a star on its face. */
function hq(game: Game, at: At): void {
  const top = building(game, at(0, 0, -60), 18, 18, HQ_HEIGHT, 0x6b56d6, 'hero-hq');
  // A crown ring around the roof edge (decor, so it doesn't snag you landing).
  decor(game, new THREE.TorusGeometry(12.6, 0.35, 8, 4).rotateX(Math.PI / 2).rotateY(Math.PI / 4), mat(0xffd84a, { emissive: 0x6a5000, emissiveIntensity: 0.6 }), [top[0], top[1] + 0.2, top[2]], 'hq-crown', false);
  const face = (y: number) => [top[0], y, top[2] + 9.05] as Vec3;
  const star = new THREE.Mesh(starShape(5).rotateX(Math.PI / 2), mat(0xffd84a, { emissive: 0xffc400, emissiveIntensity: 0.7 }));
  star.position.set(...face(HQ_HEIGHT - 12));
  star.material.side = THREE.DoubleSide;
  game.world.spawn(new Entity('hq-star', star));
  sign(game, 'HERO HQ', face(HQ_HEIGHT - 22), { width: 12, height: 2.4, bg: '#3a2f7a', fg: '#ffd84a', letterSpacing: 10 });
  // A landing pad on top.
  decor(game, new THREE.CylinderGeometry(4, 4, 0.04, 40), mat(0x3a3f4a), [top[0], top[1] + 0.02, top[2]], 'helipad', false);
  label(game, 'H', [top[0], top[1] + 0.2, top[2] + 3.2], 1.6, '#ffd84a');
  // Doors at street level.
  box(game, [5, 4, 0.2], at(0, 2, -50.95), 0x2a2250, 'hq-doors');
}


// --- Power stations -------------------------------------------------------------

/**
 * Swing on the plaza; Flight on a rooftop too high to jump to (swing up);
 * Super strength on top of Hero HQ (fly up).
 */
function powerStations(game: Game, at: At, roofs: Roof[]): Station[] {
  const [ox, oy, oz] = at(0, 0, 0);
  // The flight roof: the nearest one to the avenue that's well out of jumping reach.
  const flightRoof = roofs
    .filter((r) => r.top[1] - oy >= 24 && r.top[1] - oy <= 40)
    .sort((a, b) => Math.hypot(a.top[0] - ox, a.top[2] - (oz - 30)) - Math.hypot(b.top[0] - ox, b.top[2] - (oz - 30)))[0];
  const where: Record<PowerId, Vec3> = {
    swing: at(0, 0, -3),
    fly: [flightRoof.top[0] - flightRoof.w * 0.2, flightRoof.top[1], flightRoof.top[2] - flightRoof.d * 0.2],
    strength: at(-4, HQ_HEIGHT, -56),
  };
  return POWERS.map((p) => {
    const g = where[p.id];
    cylinder(game, 0.7, 1.0, [g[0], g[1] + 0.5, g[2]], mat(0x3a3f4a, { roughness: 0.4, metalness: 0.4 }), 'station-plinth', 24);
    decor(game, new THREE.CylinderGeometry(0.72, 0.72, 0.06, 24), mat(p.color, { emissive: p.color, emissiveIntensity: 0.8 }), [g[0], g[1] + 1.03, g[2]], 'station-rim', false);
    // The power sits in a shallow cup on top (resting, not floating).
    decor(game, new THREE.CylinderGeometry(0.34, 0.24, 0.14, 20), mat(0x22252c), [g[0], g[1] + 1.13, g[2]], 'station-cup');
    const orb = decor(game, new THREE.SphereGeometry(0.28, 24, 18), mat(p.color, { emissive: p.color, emissiveIntensity: 1.4, roughness: 0.2 }), [g[0], g[1] + 1.38, g[2]], `power-${p.id}`, false)
      .object3d as THREE.Mesh;
    label(game, p.name, [g[0], g[1] + 2.4, g[2]], 1.0);
    label(game, p.hint, [g[0], g[1] + 2.0, g[2]], 0.6, '#fff3c4');
    // A beam of light you can see from across the city.
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.9, 220, 16, 1, true).translate(0, 110 + 1.4, 0),
      new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    beacon.position.set(...g);
    beacon.name = `beacon-${p.id}`;
    game.renderer.scene.add(beacon);
    return { id: p.id, pos: new THREE.Vector3(...g), orb, beacon };
  });
}

// --- Cars and bins ------------------------------------------------------------------

const CAR_COLORS = [0xd7263d, 0xf2c230, 0x2f6fd6, 0xf1f1ee, 0x2f9e5a, 0x1f2430, 0xff8a3d, 0x8a5cd6];

/** A chunky little car: body, cabin, wheels. Length along x. Returns the model, centred on its collider. */
function carModel(color: number): THREE.Group {
  const g = new THREE.Group();
  const paint = mat(color, { roughness: 0.45, metalness: 0.3 });
  const glass = mat(0x2a3550, { roughness: 0.2, metalness: 0.5 });
  const tyre = mat(0x1a1a1c, { roughness: 0.9 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  add(new THREE.BoxGeometry(4.2, 0.65, 1.9), paint, 0, -0.22, 0);
  add(new THREE.BoxGeometry(2.3, 0.7, 1.72), glass, -0.2, 0.45, 0);
  add(new THREE.BoxGeometry(2.1, 0.08, 1.76), paint, -0.2, 0.82, 0);
  for (const x of [-1.35, 1.35]) for (const z of [-0.92, 0.92]) add(new THREE.CylinderGeometry(0.36, 0.36, 0.26, 14).rotateX(Math.PI / 2), tyre, x, -0.44, z);
  // Headlights and tail lights.
  for (const z of [-0.6, 0.6]) {
    add(new THREE.BoxGeometry(0.05, 0.16, 0.3), mat(0xfff6d0, { emissive: 0xfff0b0, emissiveIntensity: 0.6 }), 2.11, -0.12, z);
    add(new THREE.BoxGeometry(0.05, 0.14, 0.3), mat(0xc0202a, { emissive: 0x801010, emissiveIntensity: 0.5 }), -2.11, -0.12, z);
  }
  return g;
}

function binModel(): THREE.Group {
  const g = new THREE.Group();
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.32, 1.0, 16), mat(0x3d6b4a, { roughness: 0.7, metalness: 0.3 }));
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.08, 16), mat(0x2d4f37));
  lid.position.y = 0.52;
  for (const m of [can, lid]) {
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

/** Parked cars along the avenue and cross streets, bins round the plaza: all liftable, all throwable. */
function streetStuff(game: Game, at: At, powers: HeroPowers): void {
  const spawn = (name: string, kind: 'car' | 'bin', model: THREE.Group, p: Vec3, yaw: number, collider: RAPIER.ColliderDesc, half: THREE.Vector3) => {
    model.position.set(...p);
    model.rotation.y = yaw;
    const e = new Entity(name, model);
    e.tags.add('throwable');
    e.add(new RigidBodyComponent({ type: 'dynamic', ccd: true, colliders: [collider], linearDamping: 0.05, angularDamping: 0.3 }));
    game.world.spawn(e);
    powers.addThrowable({ entity: e, kind, half });
  };
  const rand = seeded(777);
  const cars: [number, number, number][] = [];
  // Both kerbs of the avenue, nose to tail, leaving HQ's front clear.
  // (The right kerb sits further out: the runaway bus comes down the right lane.)
  for (const z of [-24, -36, -78, -92, -106, -120]) for (const x of [-12.5, 13.8]) cars.push([x, z, Math.PI / 2]);
  // The cross street behind the plaza.
  for (const x of [-64, -40, 40, 64]) cars.push([x, -24, 0]);
  // Two right by the plaza, for a first throw.
  cars.push([-26, -10, Math.PI / 2], [26, 2, Math.PI / 2]);
  cars.forEach(([x, z, yaw], i) => {
    const color = CAR_COLORS[Math.floor(rand() * CAR_COLORS.length) % CAR_COLORS.length];
    spawn(
      'car',
      'car',
      carModel(i === 0 ? 0xf2c230 : color),
      at(x, 0.8, z),
      yaw + (rand() - 0.5) * 0.06,
      RAPIER.ColliderDesc.cuboid(2.1, 0.8, 0.95).setDensity(70).setFriction(0.7).setRestitution(0.1),
      new THREE.Vector3(2.1, 0.8, 0.95),
    );
  });
  for (const [x, z] of [[-17, -14], [17, -14], [-17, 10], [17, 10], [-6, 12], [6, 12]])
    spawn('bin', 'bin', binModel(), at(x, 0.5, z), 0, RAPIER.ColliderDesc.cylinder(0.5, 0.36).setDensity(60).setFriction(0.6), new THREE.Vector3(0.4, 0.5, 0.4));
}

// --- Where the emergencies happen ------------------------------------------------------

function emergencySites(at: At, roofs: Roof[]): EmergencySites {
  const [ox, oy, oz] = at(0, 0, 0);
  const rel = (r: Roof) => ({ x: r.top[0] - ox, z: r.top[2] - oz, h: r.top[1] - oy });
  const pick = (x: number, lo: number, hi: number) =>
    roofs
      .filter((r) => Math.abs(rel(r).x - x) < 1 && rel(r).z < -70)
      .sort((a, b) => Math.abs(rel(a).h - (lo + hi) / 2) - Math.abs(rel(b).h - (lo + hi) / 2))[0];
  // The kitten's ledge: a tower on the right of the avenue, on the edge facing it.
  const ledge = pick(24, 25, 45);
  const lx = ledge.top[0] - ledge.w / 2;
  // The burning building: on the left, its face to the avenue.
  const fire = pick(-24, 30, 50);
  const fx = fire.top[0] + fire.w / 2 + 0.45;
  const fh = fire.top[1] - oy;
  const windows: Vec3[] = [
    [fx, oy + Math.min(10, fh - 6), fire.top[2] + 4],
    [fx, oy + Math.min(18, fh - 4), fire.top[2]],
    [fx, oy + Math.min(26, fh - 2), fire.top[2] - 4],
  ];
  // The ring course: up off the plaza, a lap round Hero HQ above the rooftops, back down.
  const pts: Vec3[] = [at(0, 14, -8), at(0, 34, -24)];
  for (let deg = 45; deg <= 315; deg += 45) {
    const a = (deg * Math.PI) / 180;
    pts.push(at(32 * Math.sin(a), 55, -60 + 32 * Math.cos(a)));
  }
  pts.push(at(0, 22, -16));
  const rings = pts.map((p, i) => {
    const q = pts[Math.min(i + 1, pts.length - 1)];
    const prev = pts[Math.max(i - 1, 0)];
    const dx = i < pts.length - 1 ? q[0] - p[0] : p[0] - prev[0];
    const dz = i < pts.length - 1 ? q[2] - p[2] : p[2] - prev[2];
    return { at: p, facing: Math.atan2(dx, dz) };
  });
  return {
    ledge: { top: [lx + 0.5, ledge.top[1], ledge.top[2]], street: [lx - 2, oy, ledge.top[2]] },
    fire: { windows, normal: [1, 0, 0] },
    rings,
    bus: { from: at(10.8, 1.6, -135), to: at(10.8, 1.6, -20) },
  };
}
