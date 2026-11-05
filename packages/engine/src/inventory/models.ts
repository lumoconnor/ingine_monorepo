import * as THREE from 'three';
import { registerModels, buildModel, type ModelDef } from '../render/models/ModelRegistry';
import './weaponModels';

/**
 * Greybox item meshes, registered as model ids (see render/models/ModelRegistry).
 * Each builder returns the item lying at rest on a surface at
 * y = 0 (the way it sits on a table or the ground), roughly centred on the
 * origin. The same mesh is used in the world and to render the inventory icon.
 */
const mat = (color: number, roughness = 0.7, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

const brass = mat(0xa8743a, 0.45, 0.6);
const gold = mat(0xd9a93a, 0.35, 0.8);
const glass = new THREE.MeshStandardMaterial({ color: 0x6f8f3a, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 });
const label = mat(0xe8dcb5, 0.9);
const redGlass = new THREE.MeshStandardMaterial({ color: 0xa3192a, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.88 });
const cork = mat(0x9b7a52, 0.9);
const appleRed = mat(0xb5262a, 0.45);
const stem = mat(0x5a3d22, 0.9);
const leaf = mat(0x4f8a35, 0.8);
const paper = mat(0xeee6cf, 0.95);
const ink = mat(0x3a3a46, 0.9);
const iron = mat(0x34383e, 0.5, 0.5);
const darkHole = mat(0x0c0d10, 1);

function group(...meshes: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  for (const m of meshes) {
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  return o;
}

const ItemModels: Record<string, () => THREE.Object3D> = {
  key: () => {
    const s = 1.6;
    const ring = at(new THREE.Mesh(new THREE.TorusGeometry(0.05 * s, 0.014 * s, 8, 20), brass), -0.08 * s, 0, 0);
    const shaft = at(new THREE.Mesh(new THREE.BoxGeometry(0.14 * s, 0.02 * s, 0.02 * s), brass), 0.03 * s, 0, 0);
    const bit = at(new THREE.Mesh(new THREE.BoxGeometry(0.02 * s, 0.05 * s, 0.02 * s), brass), 0.09 * s, -0.03 * s, 0);
    const key = group(ring, shaft, bit);
    // Modelled upright in XY; lay it flat with its thickness resting on the surface.
    key.rotation.x = -Math.PI / 2;
    key.position.y = 0.014 * s;
    return group(key);
  },
  iron_key: () => {
    const s = 1.8;
    const bow = at(new THREE.Mesh(new THREE.BoxGeometry(0.07 * s, 0.016 * s, 0.07 * s), iron), -0.08 * s, 0, 0);
    const hole = at(new THREE.Mesh(new THREE.BoxGeometry(0.03 * s, 0.018 * s, 0.03 * s), darkHole), -0.08 * s, 0.001, 0);
    const shaft = at(new THREE.Mesh(new THREE.BoxGeometry(0.15 * s, 0.016 * s, 0.018 * s), iron), 0.03 * s, 0, 0);
    const bit1 = at(new THREE.Mesh(new THREE.BoxGeometry(0.018 * s, 0.016 * s, 0.045 * s), iron), 0.09 * s, 0, 0.028 * s);
    const bit2 = at(new THREE.Mesh(new THREE.BoxGeometry(0.018 * s, 0.016 * s, 0.03 * s), iron), 0.06 * s, 0, 0.02 * s);
    const k = group(bow, hole, shaft, bit1, bit2);
    k.position.y = 0.008 * s;
    return group(k);
  },
  coins: () => {
    const g = new THREE.Group();
    const geo = new THREE.CylinderGeometry(0.022, 0.022, 0.006, 20);
    const spots: [number, number, number][] = [[0, 0, 0], [0.004, 0, 0.001], [-0.002, 0, -0.002], [0.05, 0, 0.02], [-0.03, 0, 0.035]];
    const heights = [0, 1, 2, 0, 0];
    spots.forEach(([x, , z], i) => {
      const c = at(new THREE.Mesh(geo, gold), x, 0.003 + heights[i] * 0.006, z);
      c.rotation.y = i;
      c.castShadow = true;
      g.add(c);
    });
    return g;
  },
  bottle: () => {
    // Lying on its side, like it rolled over.
    const body = at(new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.18, 16), glass), 0, 0, 0);
    const shoulder = at(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.038, 0.05, 16), glass), 0, 0.115, 0);
    const neck = at(new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.06, 12), glass), 0, 0.17, 0);
    const top = at(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 10), cork), 0, 0.205, 0);
    const lab = at(new THREE.Mesh(new THREE.CylinderGeometry(0.0385, 0.0385, 0.07, 16, 1, true), label), 0, -0.01, 0);
    const b = group(body, shoulder, neck, top, lab);
    b.rotation.z = Math.PI / 2;
    b.position.y = 0.038;
    return group(b);
  },
  flask: () => {
    // A squat round flask standing upright.
    const bulb = at(new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), redGlass), 0, 0.045, 0);
    bulb.scale.y = 0.92;
    const neck = at(new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.016, 0.045, 12), redGlass), 0, 0.1, 0);
    const top = at(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.013, 0.02, 10), cork), 0, 0.13, 0);
    return group(bulb, neck, top);
  },
  apple: () => {
    const fruit = at(new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 12), appleRed), 0, 0.037, 0);
    fruit.scale.set(1, 0.9, 1);
    const st = at(new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.025, 6), stem), 0, 0.078, 0);
    st.rotation.z = 0.25;
    const lf = at(new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), leaf), 0.012, 0.085, 0);
    lf.scale.set(1.6, 0.25, 0.8);
    return group(fruit, st, lf);
  },
  note: () => {
    const sheet = at(new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.002, 0.2), paper), 0, 0.001, 0);
    const g = group(sheet);
    for (let i = 0; i < 6; i++) {
      const w = i === 5 ? 0.05 : 0.09 + ((i * 37) % 3) * 0.008;
      const line = at(new THREE.Mesh(new THREE.BoxGeometry(w, 0.0005, 0.006), ink), -0.055 + w / 2 + 0.005, 0.0023, -0.07 + i * 0.026);
      g.add(line);
    }
    return g;
  },
};

registerModels(Object.fromEntries(Object.entries(ItemModels).map(([id, build]) => [id, { kind: 'rest', build } satisfies ModelDef])));

/** An item's model as it lies in the world (and in its icon). */
export function buildItemModel(model: string): THREE.Object3D {
  return buildModel(model, 'rest');
}
