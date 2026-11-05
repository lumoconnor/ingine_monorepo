import * as THREE from 'three';
import { gridMaterial } from '../render/materials';
import { registerModels } from '../render/models/ModelRegistry';

/**
 * Greybox prop models, registered by id. Origin on the floor (or the wall
 * face, for levers) at the base centre, front facing +Z. The named parts are
 * what the gameplay code animates; a replacement model must keep those names.
 * Colliders and hit zones stay in the builders (world/*.ts), sized to match.
 */

const mat = (color: number, roughness = 0.85, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const metal = new THREE.MeshStandardMaterial({ color: 0x7a8490, roughness: 0.5, metalness: 0.25 });
const darkMetal = new THREE.MeshStandardMaterial({ color: 0x40464e, roughness: 0.55, metalness: 0.2 });
const brass = new THREE.MeshStandardMaterial({ color: 0xd4aa4f, roughness: 0.4, metalness: 0.35 });
const chestIron = new THREE.MeshStandardMaterial({ color: 0x3c4148, roughness: 0.55, metalness: 0.4 });
const chestBrass = new THREE.MeshStandardMaterial({ color: 0xb08a3e, roughness: 0.4, metalness: 0.6 });
const lampMaterial = () => new THREE.MeshStandardMaterial({ color: 0xe0503e, emissive: 0xe0503e, emissiveIntensity: 0.9 });

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, name = ''): THREE.Mesh {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = o.receiveShadow = true;
  o.name = name;
  return o;
}
function named<T extends THREE.Object3D>(o: T, name: string): T {
  o.name = name;
  return o;
}

/** Chest size, shared with its collider in world/containers.ts. */
export const CHEST_SIZE = { w: 0.9, h: 0.42, d: 0.55, lidH: 0.16 };

/**
 * Chest. Parts: "body" (rattles when locked), "lid" (pivot on the back
 * edge, rotates about X), "hasp" (shown when unlocked), "lock_hasp" and
 * "lock_plate" (shown when locked).
 */
function chest(): THREE.Object3D {
  const { w, h, d, lidH } = CHEST_SIZE;
  const wood = gridMaterial(0x7a5634);
  const root = new THREE.Group();
  const body = named(new THREE.Group(), 'body');
  root.add(body);
  body.add(mesh(new THREE.BoxGeometry(w, h, d), wood, 0, h / 2, 0));
  // Dark inside, seen when the lid is up.
  const inside = new THREE.Mesh(new THREE.BoxGeometry(w - 0.08, 0.004, d - 0.08), mat(0x1a120b, 1));
  inside.position.y = h + 0.002;
  body.add(inside);
  for (const x of [-w / 2 + 0.12, w / 2 - 0.12]) body.add(mesh(new THREE.BoxGeometry(0.05, h + 0.01, d + 0.02), chestIron, x, h / 2, 0));

  const lid = named(new THREE.Group(), 'lid');
  lid.position.set(0, h, -d / 2);
  body.add(lid);
  lid.add(mesh(new THREE.BoxGeometry(w, lidH, d), wood, 0, lidH / 2, d / 2));
  for (const x of [-w / 2 + 0.12, w / 2 - 0.12]) lid.add(mesh(new THREE.BoxGeometry(0.05, lidH + 0.01, d + 0.02), chestIron, x, lidH / 2, d / 2));
  // Hasp on the lid's front edge (iron, or brass when locked), and a lock plate on the body.
  lid.add(mesh(new THREE.BoxGeometry(0.08, 0.1, 0.02), chestIron, 0, 0.02, d + 0.01, 'hasp'));
  lid.add(mesh(new THREE.BoxGeometry(0.08, 0.1, 0.02), chestBrass, 0, 0.02, d + 0.01, 'lock_hasp'));
  body.add(mesh(new THREE.BoxGeometry(0.12, 0.12, 0.03), chestBrass, 0, h - 0.08, d / 2 + 0.015, 'lock_plate'));
  return root;
}

/**
 * Man-sized practice dummy on a post, feet at the origin, face toward +Z.
 * Parts: "figure" (everything that topples, pivot at its base); meshes named
 * "straw" take the optional tint.
 */
function trainingDummy(): THREE.Object3D {
  const root = new THREE.Group();
  const straw = mat(0xc9a868);
  const wood = mat(0x6b4a2f);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.06, 16), wood);
  base.position.y = 0.03;
  base.receiveShadow = true;
  root.add(base);
  const figure = named(new THREE.Group(), 'figure');
  figure.position.y = 0.06;
  root.add(figure);
  const part = (geo: THREE.BufferGeometry, m: THREE.Material, y: number, name = '') => figure.add(mesh(geo, m, 0, y - 0.06, 0, name)).children.at(-1)!;
  part(new THREE.CylinderGeometry(0.06, 0.07, 0.85, 10), wood, 0.45);
  part(new THREE.CylinderGeometry(0.25, 0.22, 0.64, 14), straw, 1.12, 'straw');
  part(new THREE.BoxGeometry(1.0, 0.09, 0.09), wood, 1.38);
  part(new THREE.SphereGeometry(0.15, 16, 12), straw, 1.62, 'straw');
  // A painted face, so you can tell which way it looks.
  const face = part(new THREE.BoxGeometry(0.12, 0.03, 0.02), mat(0x3a2a1c), 1.6);
  face.position.z = 0.145;
  return root;
}

/** Ring of stones with coals. Parts: "flame_0".."flame_4" (pivots at their base; flicker scales them in Y). */
function firePit(): THREE.Object3D {
  const root = new THREE.Group();
  const stone = mat(0x77736c, 0.95);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.17, 0), stone);
    s.position.set(Math.cos(a) * 0.85, 0.1, Math.sin(a) * 0.85);
    s.rotation.set(a, a * 2, 0);
    s.scale.y = 0.7;
    s.castShadow = true;
    root.add(s);
  }
  const coals = new THREE.Mesh(
    new THREE.CylinderGeometry(0.75, 0.75, 0.06, 20),
    new THREE.MeshStandardMaterial({ color: 0x3a140a, emissive: 0xff4a10, emissiveIntensity: 0.9, roughness: 1 }),
  );
  coals.position.y = 0.03;
  root.add(coals);
  const flameMat = new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0xff7a1a, emissiveIntensity: 2, transparent: true, opacity: 0.85, depthWrite: false });
  ([[0, 0, 0.9], [0.3, 0.15, 0.6], [-0.28, 0.2, 0.55], [0.05, -0.32, 0.65], [-0.2, -0.2, 0.5]] as const).forEach(([x, z, h], i) => {
    const pivot = named(new THREE.Group(), `flame_${i}`);
    pivot.position.set(x, 0.05, z);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.16, h, 10), flameMat);
    cone.position.y = h / 2;
    pivot.add(cone);
    root.add(pivot);
  });
  return root;
}

/** Wall lever, origin on the wall face. Parts: "handle" (pivot; sticks out along +Z, tilts about X). */
function lever(): THREE.Object3D {
  const root = new THREE.Group();
  const plate = mesh(new THREE.BoxGeometry(0.26, 0.4, 0.06), metal, 0, 0, 0.03);
  root.add(plate);
  const handle = named(new THREE.Group(), 'handle');
  handle.position.set(0, 0, 0.07);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.3, 10), darkMetal);
  rod.rotation.x = Math.PI / 2;
  rod.position.z = 0.15;
  rod.castShadow = true;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), brass);
  ball.position.z = 0.3;
  ball.castShadow = true;
  handle.add(rod, ball);
  root.add(handle);
  return root;
}

/** Angled control head (button + lamp) on top of a post of height `y`. */
function buttonHead(parent: THREE.Object3D, y: number): void {
  const head = new THREE.Group();
  head.position.y = y;
  head.rotation.x = -0.6; // tilt the face up toward the player
  head.add(mesh(new THREE.BoxGeometry(0.32, 0.26, 0.12), metal));
  const cap = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 20), mat(0xd8dde3, 0.4), -0.05, 0, 0.075, 'cap');
  cap.receiveShadow = false;
  cap.rotation.x = Math.PI / 2;
  head.add(cap);
  const lamp = named(new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), lampMaterial()), 'lamp');
  lamp.position.set(0.09, 0, 0.065);
  head.add(lamp);
  parent.add(head);
}

/** Post with a push button, factory-style. Parts: "cap" (moves back along its local Z when pressed), "lamp" (mesh recoloured by state). */
function buttonPost(postH: number, postW: number) {
  return (): THREE.Object3D => {
    const root = new THREE.Group();
    root.add(mesh(new THREE.BoxGeometry(postW, postH, postW), metal, 0, postH / 2, 0));
    buttonHead(root, postH);
    return root;
  };
}

const SWITCH_PARTS = ['cap', 'lamp'];

registerModels({
  chest: { kind: 'prop', build: chest, parts: ['body', 'lid', 'hasp', 'lock_hasp', 'lock_plate'] },
  training_dummy: { kind: 'prop', build: trainingDummy, parts: ['figure'] },
  fire_pit: { kind: 'prop', build: firePit },
  lever: { kind: 'prop', build: lever, parts: ['handle'] },
  /** Free-standing call button (1.05 m). */
  button_pedestal: { kind: 'prop', build: buttonPost(1.05, 0.22), parts: SWITCH_PARTS },
  /** The control post on a lift deck (1 m, slimmer). */
  lift_panel: { kind: 'prop', build: buttonPost(1.0, 0.18), parts: SWITCH_PARTS },
});
