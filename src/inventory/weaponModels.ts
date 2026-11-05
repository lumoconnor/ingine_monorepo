import * as THREE from 'three';
import { registerModels, type ModelDef } from '@/render/models/ModelRegistry';

/**
 * Weapon meshes, modelled as held: grip at the origin, pointing down -Z,
 * up is +Y. The first-person view uses them as they are; ItemModels lays
 * each one down on a surface (see layDown).
 */
const mat = (color: number, roughness = 0.7, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
// Low metalness: there's no environment map, so very metallic surfaces render black.
const steel = mat(0xc4ccd4, 0.35, 0.3);
const darkSteel = mat(0x4a5058, 0.5, 0.25);
const leather = mat(0x4a2f1d, 0.85);
const brassM = mat(0xa8743a, 0.45, 0.6);
const card = mat(0xb48a52, 0.9);
const cardDark = mat(0x6b4a2a, 0.9);

const olive = mat(0x4d5a35, 0.75);
const pitch = mat(0x1a1410, 0.95);

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
}
function cyl(r: number, len: number, m: THREE.Material, x = 0, y = 0, z = 0, axis: 'x' | 'y' | 'z' = 'z', seg = 12): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), m);
  mesh.position.set(x, y, z);
  if (axis === 'z') mesh.rotation.x = Math.PI / 2;
  if (axis === 'x') mesh.rotation.z = Math.PI / 2;
  return mesh;
}
function group(...parts: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  for (const p of parts) {
    p.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    g.add(p);
  }
  return g;
}

const WeaponModels: Record<string, { build: () => THREE.Object3D; /** Euler (radians) that lays it down. */ lie: [number, number, number] }> = {
  longsword: {
    lie: [0, 0, 0],
    build: () => {
      const blade = box(0.045, 0.008, 0.88, steel, 0, 0, -0.56);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.0225, 0.08, 4), steel);
      tip.rotation.set(-Math.PI / 2, Math.PI / 4, 0);
      tip.scale.set(1, 1, 0.18);
      tip.position.set(0, 0, -1.04);
      const fuller = box(0.012, 0.0085, 0.7, darkSteel, 0, 0, -0.5);
      return group(blade, tip, fuller, box(0.22, 0.022, 0.03, darkSteel, 0, 0, -0.11), cyl(0.017, 0.2, leather), new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 8), darkSteel).translateZ(0.115));
    },
  },
  pistol: {
    lie: [0, 0, Math.PI / 2],
    build: () => {
      const grip = box(0.03, 0.105, 0.045, darkSteel, 0, -0.045, 0.005);
      grip.rotation.x = -0.25;
      const slide = box(0.03, 0.035, 0.19, darkSteel, 0, 0.022, -0.06);
      const frame = box(0.026, 0.02, 0.16, mat(0x34383e, 0.6, 0.2), 0, 0.0, -0.05);
      const guard = box(0.008, 0.012, 0.05, darkSteel, 0, -0.02, -0.035);
      const sight = box(0.006, 0.008, 0.008, darkSteel, 0, 0.044, -0.145);
      return group(grip, slide, frame, guard, sight);
    },
  },
  longbow: {
    lie: [0, 0, Math.PI / 2],
    build: () => {
      // Upright in the left hand: limbs curve away from you (-Z), the string
      // runs tip to tip on your side. `userData.draw(t)` pulls the string back
      // (0 = at rest, 1 = full draw) and `userData.nocked(on)` shows the arrow.
      const wood = mat(0x8a5a2b, 0.6);
      const half = 0.74;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, -half, 0.02),
        new THREE.Vector3(0, -0.45, -0.1),
        new THREE.Vector3(0, -0.12, -0.15),
        new THREE.Vector3(0, 0.12, -0.15),
        new THREE.Vector3(0, 0.45, -0.1),
        new THREE.Vector3(0, half, 0.02),
      ]);
      const limbs = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.013, 6), wood);
      const grip = cyl(0.021, 0.14, leather, 0, 0, -0.15, 'y');
      const strMat = mat(0xe8e0c8, 0.9);
      const upper = cyl(0.0022, 1, strMat, 0, 0, 0, 'y', 4);
      const lower = cyl(0.0022, 1, strMat, 0, 0, 0, 'y', 4);
      const nock = arrow();
      nock.visible = false;
      const g = group(limbs, grip, upper, lower, nock);
      const top = new THREE.Vector3(0, half, 0.02);
      const bot = new THREE.Vector3(0, -half, 0.02);
      const mid = new THREE.Vector3();
      const span = (m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) => {
        m.position.copy(a).add(b).multiplyScalar(0.5);
        m.scale.set(1, a.distanceTo(b), 1);
        m.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, mid.copy(b).sub(a).normalize());
      };
      g.userData.draw = (t: number) => {
        const n = new THREE.Vector3(0, 0, 0.02 + 0.42 * t);
        span(upper, n, top);
        span(lower, bot, n);
        // The arrow rests on the grip, its tail at the string; tip forward.
        nock.position.set(0.018, 0, n.z - 0.38);
        nock.rotation.set(0, Math.PI, 0);
      };
      g.userData.nocked = (on: boolean) => (nock.visible = on);
      g.userData.draw(0);
      return g;
    },
  },
  musket: {
    lie: [0, 0, Math.PI / 2],
    build: () => {
      // Grip (wrist of the stock) at the origin; butt toward you, muzzle far down -Z.
      const walnut = mat(0x6b4426, 0.6);
      const stock = box(0.04, 0.07, 0.36, walnut, 0, -0.025, 0.2);
      stock.rotation.x = 0.12;
      const fore = box(0.034, 0.03, 0.68, walnut, 0, 0.004, -0.36);
      const barrel = cyl(0.011, 1.05, darkSteel, 0, 0.026, -0.46);
      const lock = box(0.012, 0.03, 0.09, darkSteel, 0.022, 0.012, -0.03);
      const cock = box(0.008, 0.035, 0.012, darkSteel, 0.024, 0.04, 0.0);
      const guard = box(0.006, 0.02, 0.06, brassM, 0, -0.028, -0.02);
      const sight = box(0.004, 0.008, 0.008, brassM, 0, 0.042, -0.96);
      return group(stock, fore, barrel, lock, cock, guard, sight);
    },
  },
  grenade: {
    lie: [0, 0, Math.PI / 2],
    build: () => {
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), olive);
      body.scale.y = 1.25;
      return group(body, cyl(0.012, 0.025, darkSteel, 0, 0.05, 0, 'y'), box(0.01, 0.06, 0.012, darkSteel, 0.018, 0.03, 0), cyl(0.008, 0.004, brassM, -0.015, 0.06, 0, 'x'));
    },
  },
};

/** An arrow along +Z (tip forward), for flight and for sticking out of things. */
function arrow(): THREE.Group {
  const shaft = cyl(0.004, 0.72, mat(0xb58a5a, 0.7), 0, 0, -0.06);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.05, 4), darkSteel);
  head.rotation.x = Math.PI / 2;
  head.position.z = 0.32;
  const fletch = (r: number) => {
    const f = box(0.002, 0.022, 0.09, mat(0xd9d2c0, 0.9), 0, 0, -0.38);
    f.rotation.z = r;
    f.position.set(Math.sin(r) * 0.009, Math.cos(r) * 0.009, -0.38);
    return f;
  };
  return group(shaft, head, fletch(0), fletch((2 * Math.PI) / 3), fletch((4 * Math.PI) / 3));
}

/** Flight models: arrows point along +Z (Object3D.lookAt aims +Z). */
const FlightModels: Record<string, () => THREE.Object3D> = {
  arrow,
  fire_arrow: () => {
    // Burning: a bright flame just behind the head.
    const a = arrow();
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffa040 }));
    flame.scale.set(1, 1, 2);
    flame.position.z = 0.26;
    a.add(flame);
    return a;
  },
};

/** Ammo and other small kit, modelled resting on a surface (y = 0 is the floor). */
const KitModels: Record<string, () => THREE.Object3D> = {
  ammo_box: () => {
    const b = group(box(0.09, 0.045, 0.06, card, 0, 0.0225, 0), box(0.0905, 0.012, 0.0605, cardDark, 0, 0.04, 0));
    return b;
  },
  arrows: () => {
    // A small bundle tied with string, lying on its side.
    const g = new THREE.Group();
    for (const [x, y, rz] of [[0, 0.006, 0.02], [0.011, 0.006, -0.03], [-0.011, 0.006, 0.0], [0.004, 0.016, 0.04]] as const) {
      const a = arrow();
      a.rotation.set(0, Math.PI / 2 + rz, 0);
      a.position.set(0, y, x);
      g.add(a);
    }
    g.add(box(0.012, 0.03, 0.04, mat(0x5a3d22, 0.9), -0.1, 0.012, 0));
    return g;
  },
  fire_arrows: () => {
    const g = KitModels.arrows();
    // Pitch-black rag wrapped behind each head.
    g.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry instanceof THREE.ConeGeometry) {
        const rag = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 5), pitch);
        rag.scale.set(1, 1, 2);
        rag.position.set(0, 0, -0.04);
        o.parent!.add(rag);
        rag.position.add(o.position);
      }
    });
    return g;
  },
  cartridges: () => {
    // A little bundle of paper cartridges tied with string.
    const paper = mat(0xd8cdb0, 0.95);
    const g = new THREE.Group();
    for (const [x, z] of [[0, 0], [0.018, 0.004], [-0.018, -0.003], [0.009, 0.019], [-0.009, 0.018]] as const) g.add(cyl(0.008, 0.06, paper, x, 0.008, z, 'x'));
    g.add(box(0.004, 0.02, 0.05, mat(0x5a3d22, 0.9), 0, 0.01, 0.008));
    return group(g);
  },
  bandage: () => {
    const roll = cyl(0.025, 0.05, mat(0xeee8dc, 0.95), 0, 0.025, 0, 'x');
    const tail = box(0.05, 0.002, 0.06, mat(0xeee8dc, 0.95), 0, 0.001, 0.045);
    return group(roll, tail);
  },
  leather_cap: () => {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x6b4426, 0.85));
    cap.scale.set(1, 0.85, 1.1);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.008, 6, 20), mat(0x4a2f1d, 0.85));
    band.rotation.x = Math.PI / 2;
    band.scale.set(1, 1.1, 1);
    band.position.y = 0.006;
    return group(cap, band);
  },
  steel_helm: () => {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), steel);
    dome.scale.set(1, 0.95, 1.12);
    // A sallet's tail sweeps out at the back.
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.15, 0.04, 16, 1, true, Math.PI * 0.6, Math.PI * 0.8), steel);
    tail.position.set(0, 0.015, 0.01);
    (tail.material as THREE.Material).side = THREE.DoubleSide;
    const ridge = box(0.008, 0.012, 0.2, darkSteel, 0, 0.1, 0);
    return group(dome, tail, ridge);
  },
  mail_hauberk: () => {
    // Folded in a heap: grey slabs with a ring-like sheen.
    const ring = mat(0x8d949b, 0.55, 0.35);
    const ringDark = mat(0x666c72, 0.6, 0.3);
    return group(box(0.34, 0.05, 0.26, ring, 0, 0.025, 0), box(0.3, 0.035, 0.2, ringDark, 0.01, 0.065, -0.01), box(0.12, 0.03, 0.08, ring, -0.1, 0.095, 0.03));
  },
  ballistic_vest: () => {
    const nylon = mat(0x2f3a2c, 0.9);
    const strap = mat(0x1d231b, 0.9);
    return group(
      box(0.36, 0.045, 0.3, nylon, 0, 0.0225, 0),
      box(0.33, 0.012, 0.03, strap, 0, 0.05, -0.06),
      box(0.33, 0.012, 0.03, strap, 0, 0.05, 0.06),
      box(0.09, 0.02, 0.06, nylon, 0.1, 0.055, 0.1),
    );
  },
  ammo_tin: () => group(box(0.12, 0.07, 0.07, olive, 0, 0.035, 0), box(0.03, 0.01, 0.02, brassM, 0, 0.075, 0)),
};

// Model ids. Held weapons lie down via `lie` when shown on a surface.
const table: Record<string, ModelDef> = {};
for (const [id, w] of Object.entries(WeaponModels)) table[id] = { kind: 'held', build: w.build, lie: w.lie };
for (const [id, build] of Object.entries(KitModels)) table[id] = { kind: 'rest', build };
for (const [id, build] of Object.entries(FlightModels)) table[id] = { kind: 'flight', build };
registerModels(table);
