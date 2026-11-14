import * as THREE from 'three';
import { registerModels } from '@ingine/engine/render/models/ModelRegistry';

/**
 * The throwing axe. Held: grip at the origin, handle forward along -Z with the
 * head at its far end, blade up (+Y), like the engine's held weapons. In
 * flight (and stuck in the board): the blade's edge is at the origin and
 * leads along +Z, with the handle hanging down (-Y), so a stuck axe has its
 * edge sunk in the wood and its handle hanging below the head.
 */
const wood = new THREE.MeshStandardMaterial({ color: 0xa87a4a, roughness: 0.75 });
const steel = new THREE.MeshStandardMaterial({ color: 0xc4ccd4, roughness: 0.35, metalness: 0.3 });
const band = new THREE.MeshStandardMaterial({ color: 0x2b2b2f, roughness: 0.6 });

function part(geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Handle along -Z from the origin; head at z = -0.36, blade edge up. */
function axe(): THREE.Group {
  const g = new THREE.Group();
  g.add(part(new THREE.BoxGeometry(0.03, 0.022, 0.42), wood, 0, 0, -0.19));
  g.add(part(new THREE.BoxGeometry(0.034, 0.026, 0.08), band, 0, 0, 0.0)); // grip wrap
  // Head: a wedge-ish block, wider at the edge.
  g.add(part(new THREE.BoxGeometry(0.022, 0.07, 0.05), steel, 0, 0.03, -0.37));
  g.add(part(new THREE.BoxGeometry(0.012, 0.11, 0.07), steel, 0, 0.09, -0.37));
  g.add(part(new THREE.BoxGeometry(0.03, 0.03, 0.04), steel, 0, -0.01, -0.37)); // poll
  return g;
}

registerModels({
  throwing_axe: { kind: 'held', build: axe, lie: [0, 0, Math.PI / 2] },
  throwing_axe_flight: {
    kind: 'flight',
    build: () => {
      // Turn the held axe a quarter about X: the edge (+Y) now leads along +Z
      // and the handle hangs down (-Y), the way a thrown axe sits in a board.
      const a = axe();
      a.rotation.x = Math.PI / 2;
      // The edge was at (0, 0.145, -0.37); after the turn it's at (0, 0.37, 0.145). Put it
      // 5 cm behind the origin: the engine sinks a stuck projectile ~9 cm, and this keeps
      // most of the head showing.
      a.position.set(0, -0.37, -0.195);
      const g = new THREE.Group();
      g.add(a);
      return g;
    },
  },
});
