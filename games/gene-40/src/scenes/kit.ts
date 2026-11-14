import * as THREE from 'three';
import type { Game } from '@ingine/engine/core/Game';
import { Entity } from '@ingine/engine/entities/Entity';
import { addBox, addLabel } from '@ingine/engine/world/builders';
import { RAPIER } from '@ingine/engine/physics/PhysicsWorld';
import { RigidBodyComponent } from '@ingine/engine/physics/RigidBodyComponent';
import type { Teleports } from '../Teleports';
import type { Vec3 } from '../scenes';

/** Small greybox helpers shared by every scene. */

export const mat = (color: number, o: { roughness?: number; metalness?: number; emissive?: number; emissiveIntensity?: number } = {}) =>
  new THREE.MeshStandardMaterial({
    color,
    roughness: o.roughness ?? 0.7,
    metalness: o.metalness ?? 0,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.emissiveIntensity ?? 1,
  });

/** A mesh with no collider. */
export function decor(game: Game, geo: THREE.BufferGeometry, m: THREE.Material, position: Vec3, name = 'decor', shadows = true): Entity {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(...position);
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
  const e = new Entity(name, mesh);
  game.world.spawn(e);
  return e;
}

/** A solid upright cylinder (cake tiers, pads, posts). `position` is its centre. */
export function cylinder(game: Game, radius: number, height: number, position: Vec3, m: THREE.Material, name = 'cylinder', segments = 32): Entity {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, segments), m);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const e = new Entity(name, mesh);
  e.add(new RigidBodyComponent({ type: 'fixed', colliders: [RAPIER.ColliderDesc.cylinder(height / 2, radius).setFriction(0.8)] }));
  game.world.spawn(e);
  return e;
}

export const box = (game: Game, size: Vec3, position: Vec3, color: number, name = 'box', rotationDeg?: Vec3) =>
  addBox(game, { name, size, position, color, rotationDeg });

export const label = (game: Game, text: string, position: Vec3, scale = 1, color?: string) => addLabel(game, text, position, scale, color);

const padTop = 0.12;

/**
 * A teleport pad: a low glowing disc with a ring and a sign. Walk onto it to
 * travel. Returns the pad's centre (top surface).
 */
export function teleportPad(
  game: Game,
  teleports: Teleports,
  o: { at: Vec3; color: number; title: string; subtitle?: string; to: Vec3; toYaw: number; sceneId: string; arch?: boolean; facingDeg?: number },
): Vec3 {
  const [x, y, z] = o.at;
  cylinder(game, 1.4, padTop, [x, y + padTop / 2, z], mat(0x3a3f4a, { roughness: 0.4, metalness: 0.4 }), 'pad-base');
  decor(game, new THREE.CylinderGeometry(1.15, 1.15, 0.02, 40), mat(o.color, { emissive: o.color, emissiveIntensity: 0.9 }), [x, y + padTop + 0.01, z], 'pad-glow', false);
  const ring = new THREE.TorusGeometry(1.3, 0.05, 8, 48).rotateX(Math.PI / 2);
  decor(game, ring, mat(0xffffff, { emissive: o.color, emissiveIntensity: 1.4 }), [x, y + padTop + 0.03, z], 'pad-ring', false);
  // A soft column of light so pads read from across the plaza.
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.1, 3.2, 32, 1, true),
    new THREE.MeshBasicMaterial({ color: o.color, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
  );
  beam.position.set(x, y + padTop + 1.6, z);
  game.world.spawn(new Entity('pad-beam', beam));
  if (o.arch !== false) {
    // An arch behind the pad (relative to `facingDeg`, the way you walk on), holding the sign.
    const f = THREE.MathUtils.degToRad(o.facingDeg ?? 0);
    const back: Vec3 = [x - Math.sin(f) * 1.9, y, z - Math.cos(f) * 1.9];
    const side = (s: number): Vec3 => [back[0] + Math.cos(f) * 1.7 * s, y + 1.75, back[2] - Math.sin(f) * 1.7 * s];
    for (const s of [-1, 1]) box(game, [0.3, 3.5, 0.3], side(s), o.color, 'arch-post', [0, o.facingDeg ?? 0, 0]);
    box(game, [3.7, 0.35, 0.35], [back[0], y + 3.6, back[2]], o.color, 'arch-top', [0, o.facingDeg ?? 0, 0]);
  }
  label(game, o.title, [x, y + 4.7, z], 1.9);
  if (o.subtitle) label(game, o.subtitle, [x, y + 4.0, z], 1.0, '#fff3c4');
  teleports.add({ position: [x, y + padTop, z], radius: 1.0, to: o.to, toYaw: o.toYaw, sceneId: o.sceneId });
  return [x, y + padTop, z];
}

/** Deterministic random, so every player sees the same world. */
export function seeded(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export function tree(game: Game, x: number, z: number, scale = 1, y = 0): void {
  cylinder(game, 0.22 * scale, 1.6 * scale, [x, y + 0.8 * scale, z], mat(0x7a5536), 'trunk', 10);
  const leaves = new THREE.IcosahedronGeometry(1.4 * scale, 1);
  decor(game, leaves, new THREE.MeshStandardMaterial({ color: 0x4f9a4a, roughness: 0.85, flatShading: true }), [x, y + 2.6 * scale, z], 'leaves');
}

/**
 * A flat sign: text drawn on a canvas, on a plane facing +Z (rotate with
 * `yawDeg`). Visual only. `width` in metres; height follows the canvas.
 */
export function sign(
  game: Game,
  text: string,
  position: Vec3,
  o: { width: number; height: number; yawDeg?: number; bg?: string; fg?: string; font?: string; letterSpacing?: number },
): Entity {
  const px = 256;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(px * o.width);
  canvas.height = Math.round(px * o.height);
  const g = canvas.getContext('2d')!;
  g.fillStyle = o.bg ?? '#ffffff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = o.fg ?? '#111111';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = o.font ?? `700 ${Math.round(canvas.height * 0.62)}px system-ui, Helvetica, Arial, sans-serif`;
  if (o.letterSpacing && 'letterSpacing' in g) (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${o.letterSpacing}px`;
  g.fillText(text, canvas.width / 2, canvas.height / 2 + canvas.height * 0.03);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(o.width, o.height), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
  mesh.position.set(...position);
  mesh.rotation.y = THREE.MathUtils.degToRad(o.yawDeg ?? 0);
  const e = new Entity(`sign:${text}`, mesh);
  game.world.spawn(e);
  return e;
}
