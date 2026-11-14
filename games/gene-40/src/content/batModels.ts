import * as THREE from 'three';
import { registerModels } from '@ingine/engine/render/models/ModelRegistry';

/**
 * The baseball bat. Held: grip at the origin, the bat running forward along
 * -Z to the barrel, like the engine's held weapons.
 */
const wood = new THREE.MeshStandardMaterial({ color: 0xc89a5e, roughness: 0.55 });
const tape = new THREE.MeshStandardMaterial({ color: 0x1d2a5a, roughness: 0.8 });

function bat(): THREE.Group {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, z: number) => {
    const mesh = new THREE.Mesh(geo.rotateX(Math.PI / 2), m);
    mesh.position.z = z;
    mesh.castShadow = true;
    g.add(mesh);
  };
  add(new THREE.CylinderGeometry(0.024, 0.024, 0.03, 16), wood, 0.1); // knob
  add(new THREE.CylinderGeometry(0.016, 0.016, 0.22, 12), tape, 0); // taped grip
  add(new THREE.CylinderGeometry(0.017, 0.03, 0.3, 16), wood, -0.26); // taper: +Y (top) ends up toward +Z, so the wide end is toward the barrel
  add(new THREE.CylinderGeometry(0.03, 0.035, 0.32, 16), wood, -0.57); // barrel
  add(new THREE.SphereGeometry(0.035, 16, 8), wood, -0.73); // rounded end
  return g;
}

registerModels({
  baseball_bat: { kind: 'held', build: bat, lie: [0, 0, Math.PI / 2] },
});
