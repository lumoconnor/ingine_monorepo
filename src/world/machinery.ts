import * as THREE from 'three';
import type { Game } from '@/core/Game';
import { Entity } from '@/entities/Entity';
import { RAPIER } from '@/physics/PhysicsWorld';
import { RigidBodyComponent } from '@/physics/RigidBodyComponent';
import { gridMaterial, worldScaleBoxUVs } from '@/render/materials';
import { addBox } from '@/world/builders';
import { Door, type DoorKind } from '@/gameplay/components/Door';
import { Lift } from '@/gameplay/components/Lift';
import { MovingPlatform } from '@/gameplay/components/MovingPlatform';
import { Switch, type SwitchState } from '@/gameplay/components/Switch';
import type { Activatable } from '@/gameplay/components/Activatable';
import { Interactable } from '@/gameplay/interaction/Interactable';
import { Lock, type LockOptions } from '@/gameplay/components/Lock';
import { buildModel, modelPart } from '@/render/models/ModelRegistry';
import './propModels';

type SwitchLamp = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

/**
 * Builders for interactive grey-box pieces: walls with doorways, doors,
 * levers, call buttons and switch-driven lifts.
 */

type Vec3 = [number, number, number];
const deg = THREE.MathUtils.degToRad;

const darkMetal = new THREE.MeshStandardMaterial({ color: 0x40464e, roughness: 0.55, metalness: 0.2 });
const brass = new THREE.MeshStandardMaterial({ color: 0xd4aa4f, roughness: 0.4, metalness: 0.35 });

function box(w: number, h: number, d: number, mat: THREE.Material, castShadow = true): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = castShadow;
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

export interface Doorway {
  /** Centre of the opening at floor level, on the wall's centre line. */
  center: Vec3;
  /** Bottom of the opening's left jamb (looking at the wall's +Z/front side): a swing door's hinge. */
  hinge: Vec3;
  /** Wall yaw in degrees; use as the door's yaw. Local +X runs along the wall, +Z is its front. */
  yawDeg: number;
  width: number;
  height: number;
}

export interface WallOptions {
  /** Start and end of the wall's centre line on the ground (x, z). */
  from: [number, number];
  to: [number, number];
  height: number;
  thickness: number;
  color: number;
  /** Openings, each placed by the distance of its centre from `from`. */
  openings?: { at: number; width: number; height: number }[];
}

/** A straight wall with optional doorways (solid segments plus a lintel over each opening). */
export function addWall(game: Game, o: WallOptions): Doorway[] {
  const [x0, z0] = o.from;
  const dx = o.to[0] - x0;
  const dz = o.to[1] - z0;
  const length = Math.hypot(dx, dz);
  const ux = dx / length;
  const uz = dz / length;
  const yawDeg = THREE.MathUtils.radToDeg(Math.atan2(-dz, dx));
  const at = (s: number, y: number): Vec3 => [x0 + ux * s, y, z0 + uz * s];
  const segment = (s0: number, s1: number, y0: number, y1: number) => {
    if (s1 - s0 < 1e-3 || y1 - y0 < 1e-3) return;
    addBox(game, {
      name: 'wall',
      size: [s1 - s0, y1 - y0, o.thickness],
      position: at((s0 + s1) / 2, (y0 + y1) / 2),
      rotationDeg: [0, yawDeg, 0],
      color: o.color,
    });
  };

  const openings = [...(o.openings ?? [])].sort((a, b) => a.at - b.at);
  const doorways: Doorway[] = [];
  let cursor = 0;
  for (const op of openings) {
    const s0 = op.at - op.width / 2;
    const s1 = op.at + op.width / 2;
    segment(cursor, s0, 0, o.height);
    segment(s0, s1, op.height, o.height);
    cursor = s1;
    doorways.push({ center: at(op.at, 0), hinge: at(s0, 0), yawDeg, width: op.width, height: op.height });
  }
  segment(cursor, length, 0, o.height);
  return doorways;
}

// ---------------------------------------------------------------------------
// Doors
// ---------------------------------------------------------------------------

export interface DoorBuildOptions {
  doorway: Doorway;
  kind: DoorKind;
  thickness?: number;
  color: number;
  /** Swing doors: hinge on the right jamb instead of the left. */
  hingeRight?: boolean;
  /** Slide doors: 'side' slides along the wall into it, 'up' lifts like a portcullis. */
  slideTo?: 'side' | 'up';
  /** Open/close with the interact key (otherwise only switches drive it). */
  interactable?: boolean;
  duration?: number;
  name?: string;
  /** Needs a key to open the first time (interactable doors). */
  lock?: LockOptions;
}

export function addDoor(game: Game, o: DoorBuildOptions): { entity: Entity; door: Door } {
  const gap = 0.02;
  const w = o.doorway.width - gap * 2;
  const h = o.doorway.height - gap;
  const t = o.thickness ?? 0.1;
  const yaw = deg(o.doorway.yawDeg) + (o.hingeRight ? Math.PI : 0);

  const root = new THREE.Group();
  root.rotation.y = yaw;
  const along = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  if (o.kind === 'swing') {
    const hinge = o.hingeRight
      ? new THREE.Vector3(...o.doorway.hinge).addScaledVector(along, -o.doorway.width)
      : new THREE.Vector3(...o.doorway.hinge);
    root.position.copy(hinge).addScaledVector(along, gap);
  } else {
    root.position.set(...o.doorway.center);
  }

  // Everything visible goes in `panel`, so a lock can rattle it without fighting the physics sync on `root`.
  const panel = new THREE.Group();
  root.add(panel);
  const geo = new THREE.BoxGeometry(w, h, t);
  worldScaleBoxUVs(geo, w, h, t);
  const slab = new THREE.Mesh(geo, gridMaterial(o.color));
  slab.castShadow = slab.receiveShadow = true;
  slab.position.set(o.kind === 'swing' ? w / 2 : 0, h / 2, 0);
  panel.add(slab);

  if (o.kind === 'swing') {
    // Handles on both faces near the free edge, and two hinge knuckles.
    for (const side of [-1, 1]) {
      const knob = box(0.05, 0.05, 0.08, brass);
      knob.position.set(w - 0.12, 1.0, side * (t / 2 + 0.04));
      panel.add(knob);
      const grip = box(0.16, 0.035, 0.035, brass);
      grip.position.set(w - 0.17, 1.0, side * (t / 2 + 0.08));
      panel.add(grip);
    }
    for (const y of [0.3, h - 0.3]) {
      const k = box(0.05, 0.18, t + 0.03, darkMetal);
      k.position.set(0.01, y, 0);
      panel.add(k);
    }
  } else {
    // Horizontal bands so motion reads clearly.
    for (const y of [h * 0.25, h * 0.5, h * 0.75]) {
      const band = box(w, 0.06, t + 0.02, darkMetal, false);
      band.position.set(0, y, 0);
      panel.add(band);
    }
  }

  const entity = new Entity(o.name ?? `door-${o.kind}`, root);
  entity.tags.add('door');
  entity.add(new RigidBodyComponent({ type: 'kinematicPosition', colliders: [Door.colliderDesc({ kind: o.kind, width: w, height: h, thickness: t })] }));
  const slide =
    o.slideTo === 'up' ? new THREE.Vector3(0, h - 0.15, 0) : new THREE.Vector3(o.doorway.width - 0.1, 0, 0);
  const door = entity.add(new Door({ kind: o.kind, width: w, height: h, thickness: t, slide, duration: o.duration }));
  const lock = o.lock ? entity.add(new Lock(o.lock, panel)) : null;
  if (lock && o.kind === 'swing') {
    // A keyhole plate under each handle.
    for (const side of [-1, 1]) {
      const plate = box(0.06, 0.12, 0.012, darkMetal);
      plate.position.set(w - 0.12, 0.88, side * (t / 2 + 0.006));
      panel.add(plate);
    }
  }
  if (o.interactable) {
    entity.add(
      new Interactable({
        prompt: () => lock?.prompt('door') ?? (door.isOn ? 'Close door' : 'Open door'),
        onInteract: (user) => {
          if (lock && !lock.tryUnlock()) return;
          door.activate('toggle', user);
        },
      }),
    );
  }
  game.world.spawn(entity);
  return { entity, door };
}

// ---------------------------------------------------------------------------
// Switches
// ---------------------------------------------------------------------------

export interface SwitchBuildOptions {
  /** Base centre. Levers: on the wall face. Buttons: on the ground. */
  position: Vec3;
  /** Direction the switch faces (toward the player), yaw degrees: 0 = +Z, 90 = +X. */
  facingDeg: number;
  prompt: string | (() => string);
  onUse: (user: Entity) => void;
  state: () => SwitchState;
  name?: string;
}

/** Wall lever: a plate and a handle that flips up/down with the state. */
export function addLever(game: Game, o: SwitchBuildOptions): Entity {
  const root = new THREE.Group();
  root.position.set(...o.position);
  root.rotation.y = deg(o.facingDeg);
  const model = buildModel('lever');
  root.add(model);
  const handle = modelPart(model, 'handle');

  const e = new Entity(o.name ?? 'lever', root);
  e.tags.add('switch');
  e.add(
    new RigidBodyComponent({
      type: 'fixed',
      colliders: [RAPIER.ColliderDesc.cuboid(0.15, 0.24, 0.17).setTranslation(0, 0, 0.17)],
    }),
  );
  e.add(new Switch({ prompt: o.prompt, onUse: o.onUse, state: o.state, handle }));
  game.world.spawn(e);
  return e;
}

/** A free-standing pedestal with a big push button and a status lamp. */
export function addButton(game: Game, o: SwitchBuildOptions): Entity {
  const root = new THREE.Group();
  root.position.set(...o.position);
  root.rotation.y = deg(o.facingDeg);
  const model = buildModel('button_pedestal');
  root.add(model);
  const cap = modelPart(model, 'cap');
  const lamp = modelPart<SwitchLamp>(model, 'lamp');

  const e = new Entity(o.name ?? 'button', root);
  e.tags.add('switch');
  e.add(
    new RigidBodyComponent({
      type: 'fixed',
      colliders: [RAPIER.ColliderDesc.cuboid(0.17, 0.66, 0.17).setTranslation(0, 0.66, 0)],
    }),
  );
  e.add(new Switch({ prompt: o.prompt, onUse: o.onUse, state: o.state, lamp, cap }));
  game.world.spawn(e);
  return e;
}

// ---------------------------------------------------------------------------
// Switch-operated lifts
// ---------------------------------------------------------------------------

export interface LiftBuildOptions {
  name?: string;
  /** Deck centre at stop A and stop B. */
  a: Vec3;
  b: Vec3;
  size: Vec3;
  speed: number;
  color: number;
  /** Control post on the deck, local (x, z) from the deck centre, and the way it faces. */
  panel: { x: number; z: number; facingDeg: number };
  /** Prompt for the onboard panel. */
  prompt?: (lift: Lift) => string;
}

/**
 * A platform that only moves when a switch tells it to. Its control post is a
 * second collider on the same body (so it moves with the deck); only that
 * collider counts as the switch.
 */
export function addLift(game: Game, o: LiftBuildOptions): { entity: Entity; lift: Lift } {
  const [w, h, d] = o.size;
  const geo = new THREE.BoxGeometry(w, h, d);
  worldScaleBoxUVs(geo, w, h, d);
  const deck = new THREE.Mesh(geo, gridMaterial(o.color));
  deck.castShadow = deck.receiveShadow = true;
  deck.position.set(...o.a);

  // Hazard trim along the deck edges.
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.6 });
  const tw = 0.12;
  for (const [sx, sz, along] of [[0, 1, 'x'], [0, -1, 'x'], [1, 0, 'z'], [-1, 0, 'z']] as const) {
    const strip = new THREE.Mesh(
      along === 'x' ? new THREE.BoxGeometry(w + 0.01, 0.01, tw) : new THREE.BoxGeometry(tw, 0.01, d + 0.01),
      trimMat,
    );
    strip.position.set((sx * (w - tw)) / 2, h / 2 + 0.004, (sz * (d - tw)) / 2);
    strip.receiveShadow = true;
    deck.add(strip);
  }

  const postH = 1.0;
  const panelRoot = new THREE.Group();
  panelRoot.position.set(o.panel.x, h / 2, o.panel.z);
  panelRoot.rotation.y = deg(o.panel.facingDeg);
  const panel = buildModel('lift_panel');
  panelRoot.add(panel);
  const cap = modelPart(panel, 'cap');
  const lamp = modelPart<SwitchLamp>(panel, 'lamp');
  deck.add(panelRoot);

  const entity = new Entity(o.name ?? 'lift', deck);
  entity.tags.add('lift');
  const rb = entity.add(
    new RigidBodyComponent({
      type: 'kinematicPosition',
      colliders: [
        RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setFriction(0.8),
        RAPIER.ColliderDesc.cuboid(0.14, (postH + 0.15) / 2, 0.14).setTranslation(o.panel.x, h / 2 + (postH + 0.15) / 2, o.panel.z),
      ],
    }),
  );
  const lift = entity.add(new Lift(new THREE.Vector3(...o.a), new THREE.Vector3(...o.b), o.speed));
  entity.add(new MovingPlatform(lift.motion));
  entity.add(
    new Switch({
      prompt: () => (o.prompt ? o.prompt(lift) : lift.target === 1 ? 'Go down' : 'Go up'),
      onUse: () => lift.activate('toggle'),
      state: () => (lift.busy ? 'busy' : 'on'),
      lamp,
      cap,
      colliders: () => [rb.colliders[1]],
    }),
  );
  game.world.spawn(entity);
  return { entity, lift };
}

/** Switch state helper for a button that calls a lift to one stop. */
export function callState(lift: Lift, stop: 0 | 1): () => SwitchState {
  return () => (lift.stop === stop ? 'on' : lift.busy ? 'busy' : 'off');
}

/** Lever state: follows where the target is headed, so the handle flips the moment it's pulled. */
export function leverState(target: Activatable): () => SwitchState {
  return () => (target.isOn ? 'on' : 'off');
}

/** Switch state helper for something with an on/off state (doors). */
export function toggleState(target: Activatable): () => SwitchState {
  return () => (target.busy ? 'busy' : target.isOn ? 'on' : 'off');
}
