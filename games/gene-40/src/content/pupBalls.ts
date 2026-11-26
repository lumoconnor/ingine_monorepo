import * as THREE from 'three';
import { registerModels } from '@ingine/engine/render/models/ModelRegistry';

/**
 * The Buddies pups' balls, one per sport, each centred on the origin (so it
 * sits in the palm when held). `PUP_BALL_R` is each one's radius, for resting
 * it on the ground and for its bounces.
 */
export const PUP_BALL_R: Record<string, number> = { football: 0.16, soccer: 0.17, volleyball: 0.17, baseball: 0.1, basketball: 0.18 };

const m = (color: number, roughness = 0.6, flat = false) => new THREE.MeshStandardMaterial({ color, roughness, flatShading: flat });

export function pupBall(sport: string): THREE.Group {
  const g = new THREE.Group();
  const add = (mesh: THREE.Mesh) => {
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  switch (sport) {
    case 'football': {
      add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 14), m(0x7a3e1c))).scale.set(1, 1, 1.75);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.01, 0.16), m(0xffffff))).position.y = 0.16;
      for (let k = -1; k <= 1; k++) add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.01, 0.012), m(0xffffff))).position.set(0, 0.162, k * 0.04);
      break;
    }
    case 'soccer': {
      add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 1), m(0xffffff, 0.5, true)));
      for (const [x, y, z] of [[0, 1, 0], [0.9, 0.3, 0.3], [-0.6, 0.3, 0.7], [0.2, 0.3, -0.95], [-0.7, -0.4, -0.5], [0.5, -0.8, 0.3], [0, -1, -0.2]]) {
        const p = add(new THREE.Mesh(new THREE.CircleGeometry(0.055, 5), m(0x222222)));
        const n = new THREE.Vector3(x, y, z).normalize();
        p.position.copy(n).multiplyScalar(0.168);
        p.lookAt(p.position.clone().add(n));
      }
      break;
    }
    case 'volleyball': {
      add(new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 14), m(0xf6f1e0, 0.5)));
      for (const [c, r] of [[0x2f6fd8, 0], [0xf2c14e, Math.PI / 2]] as const) add(new THREE.Mesh(new THREE.TorusGeometry(0.168, 0.02, 6, 30), m(c))).rotation.set(r, 0, 0.5);
      break;
    }
    case 'baseball': {
      add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), m(0xfaf6ec)));
      add(new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.008, 6, 30), m(0xd03a3a))).rotation.set(0.6, 0.4, 0);
      break;
    }
    case 'basketball': {
      add(new THREE.Mesh(new THREE.SphereGeometry(0.18, 20, 14), m(0xe8641c, 0.7)));
      for (const r of [0, Math.PI / 2]) add(new THREE.Mesh(new THREE.TorusGeometry(0.181, 0.008, 6, 30), m(0x222222))).rotation.set(0, r, 0);
      break;
    }
  }
  return g;
}

/** A ball resting on the ground: its bottom at y = 0 of the group. */
export function restingBall(sport: string): THREE.Group {
  const g = new THREE.Group();
  const b = pupBall(sport);
  b.position.y = PUP_BALL_R[sport] ?? 0.17;
  g.add(b);
  return g;
}

registerModels(Object.fromEntries(Object.keys(PUP_BALL_R).map((s) => [`pup_${s}`, { kind: 'held' as const, build: () => pupBall(s), lie: [0, 0, 0] as [number, number, number] }])));
