import * as THREE from 'three';
import { registerModels } from '@ingine/engine/render/models/ModelRegistry';

/**
 * The baseball bat. Held: grip at the origin, the bat running forward along
 * -Z to the barrel, like the engine's held weapons.
 *
 * The wood is one lathed surface (rounded end, barrel, taper, handle, knob) so
 * there are no end caps meeting inside the bat: separate cylinders put two caps
 * on the same plane at each joint, which flickered as a dark ring on the bat.
 */
const wood = new THREE.MeshStandardMaterial({ color: 0xc89a5e, roughness: 0.55 });
const tape = new THREE.MeshStandardMaterial({ color: 0x1d2a5a, roughness: 0.8 });

/** Profile as [radius, distance from the grip toward the knob (+) or barrel (-)], barrel end first. */
const WOOD: [number, number][] = [
  [0, -0.77],
  [0.012, -0.768],
  [0.022, -0.762],
  [0.029, -0.753],
  [0.0335, -0.741],
  [0.035, -0.725],
  [0.035, -0.56],
  [0.0335, -0.48],
  [0.03, -0.41],
  [0.024, -0.32],
  [0.019, -0.22],
  [0.0165, -0.13],
  [0.016, -0.11],
  [0.016, 0.09],
  [0.019, 0.096],
  [0.024, 0.104],
  [0.025, 0.112],
  [0.022, 0.12],
  [0, 0.124],
];
/** The grip tape: a thin sleeve over the handle, flush with the wood at both ends. */
const TAPE: [number, number][] = [
  [0.016, -0.11],
  [0.0172, -0.106],
  [0.0172, 0.086],
  [0.016, 0.09],
];

function lathe(profile: [number, number][], m: THREE.Material): THREE.Mesh {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  // Lathe spins round +Y; turning +Y to +Z puts the knob behind the hand and the barrel ahead (-Z).
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(pts, 24).rotateX(Math.PI / 2), m);
  mesh.castShadow = true;
  return mesh;
}

function bat(): THREE.Group {
  const g = new THREE.Group();
  g.add(lathe(WOOD, wood), lathe(TAPE, tape));
  return g;
}

registerModels({
  baseball_bat: { kind: 'held', build: bat, lie: [0, 0, Math.PI / 2] },
});
