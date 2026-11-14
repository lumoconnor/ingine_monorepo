import * as THREE from 'three';
import { registerModels } from '@ingine/engine/render/models/ModelRegistry';

/** The basketball: an orange ball with dark seams, centred on the origin (held in the palm). */
export const BALL_RADIUS = 0.12;
const leather = new THREE.MeshStandardMaterial({ color: 0xd8642a, roughness: 0.75 });
const seam = new THREE.MeshStandardMaterial({ color: 0x1b1410, roughness: 0.9 });

export function basketball(): THREE.Group {
  const g = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 24, 16), leather);
  ball.castShadow = true;
  g.add(ball);
  const ring = (rx: number, ry: number) => {
    const t = new THREE.Mesh(new THREE.TorusGeometry(BALL_RADIUS * 1.003, 0.004, 4, 40), seam);
    t.rotation.set(rx, ry, 0);
    g.add(t);
  };
  ring(0, 0);
  ring(0, Math.PI / 2);
  ring(Math.PI / 2, 0);
  return g;
}

registerModels({
  basketball: { kind: 'held', build: basketball, lie: [0, 0, 0] },
});
