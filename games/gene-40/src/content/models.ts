import * as THREE from 'three';
import { registerModels, type ModelDef } from '@ingine/engine/render/models/ModelRegistry';

/**
 * Greybox office items. Like the engine's item models, each lies at rest on a
 * surface at y = 0, roughly centred on the origin.
 */
const mat = (color: number, roughness = 0.6, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

const group = (...parts: THREE.Object3D[]) => {
  const g = new THREE.Group();
  g.add(...parts);
  return g;
};

const OfficeItems: Record<string, () => THREE.Object3D> = {
  mug: () => {
    const ceramic = mat(0xf2efe8, 0.35);
    const body = mesh(new THREE.CylinderGeometry(0.042, 0.038, 0.095, 20), ceramic, 0, 0.0475, 0);
    const coffee = mesh(new THREE.CylinderGeometry(0.037, 0.037, 0.004, 20), mat(0x3b2416, 0.2), 0, 0.085, 0);
    const handle = mesh(new THREE.TorusGeometry(0.026, 0.008, 8, 16, Math.PI), ceramic, 0.042, 0.05, 0);
    handle.rotation.z = -Math.PI / 2;
    return group(body, coffee, handle);
  },
  stapler: () => {
    const red = mat(0xc4232b, 0.4, 0.1);
    const metal = mat(0x9aa0a8, 0.35, 0.8);
    const base = mesh(new THREE.BoxGeometry(0.17, 0.018, 0.045), mat(0x22252b, 0.5), 0, 0.009, 0);
    const arm = mesh(new THREE.BoxGeometry(0.16, 0.026, 0.04), red, 0.004, 0.034, 0);
    arm.rotation.z = 0.06;
    const hinge = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.042, 12), metal, -0.075, 0.026, 0);
    hinge.rotation.x = Math.PI / 2;
    return group(base, arm, hinge);
  },
  keycard: () => {
    const card = mesh(new THREE.BoxGeometry(0.086, 0.004, 0.054), mat(0xf4f6f8, 0.4), 0, 0.002, 0);
    const stripe = mesh(new THREE.BoxGeometry(0.086, 0.0012, 0.012), mat(0x2b6fd6, 0.4), 0, 0.0046, -0.016);
    const photo = mesh(new THREE.BoxGeometry(0.02, 0.0012, 0.024), mat(0x8c96a3, 0.6), -0.026, 0.0046, 0.008);
    const lanyard = mesh(new THREE.TorusGeometry(0.06, 0.004, 6, 30), mat(0x2b6fd6, 0.8), 0, 0.004, -0.085);
    lanyard.rotation.x = Math.PI / 2;
    lanyard.scale.set(1, 1.4, 1);
    return group(card, stripe, photo, lanyard);
  },
  notebook: () => {
    const cover = mat(0x2f5d50, 0.7);
    const pages = mesh(new THREE.BoxGeometry(0.148, 0.012, 0.208), mat(0xf3eedd, 0.9), 0.002, 0.009, 0);
    const back = mesh(new THREE.BoxGeometry(0.152, 0.003, 0.212), cover, 0, 0.0015, 0);
    const front = mesh(new THREE.BoxGeometry(0.152, 0.003, 0.212), cover, 0, 0.0165, 0);
    const g = group(pages, back, front);
    for (let i = 0; i < 9; i++) {
      const ring = mesh(new THREE.TorusGeometry(0.008, 0.0015, 6, 12), mat(0xb8bcc2, 0.3, 0.9), -0.076, 0.009, -0.09 + i * 0.0225);
      ring.rotation.x = Math.PI / 2;
      ring.rotation.y = Math.PI / 2;
      g.add(ring);
    }
    return g;
  },
};

registerModels(Object.fromEntries(Object.entries(OfficeItems).map(([id, build]) => [id, { kind: 'rest', build } satisfies ModelDef])));
import './axeModels';
