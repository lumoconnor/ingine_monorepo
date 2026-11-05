import * as THREE from 'three';

/**
 * Prototype ("grey-box") materials: a 1m grid texture so distances, heights
 * and speeds are easy to judge while tuning movement. Swap for real art later.
 */
let gridTexture: THREE.Texture | null = null;

export function getGridTexture(): THREE.Texture {
  if (gridTexture) return gridTexture;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#d9d9d9';
  ctx.fillRect(0, 0, size, size);
  // Subtle half-tile checker
  ctx.fillStyle = '#cdcdcd';
  ctx.fillRect(0, 0, size / 2, size / 2);
  ctx.fillRect(size / 2, size / 2, size / 2, size / 2);
  // Grid lines
  ctx.strokeStyle = '#8a8a8a';
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, size, size);
  ctx.strokeStyle = '#b0b0b0';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(size / 2, 0);
  ctx.lineTo(size / 2, size);
  ctx.moveTo(0, size / 2);
  ctx.lineTo(size, size / 2);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  gridTexture = tex;
  return tex;
}

const cache = new Map<number, THREE.MeshStandardMaterial>();

/** Grid material tinted with a colour. UVs are expected in metres. */
export function gridMaterial(color: number): THREE.MeshStandardMaterial {
  let m = cache.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, map: getGridTexture(), roughness: 0.85, metalness: 0 });
    cache.set(color, m);
  }
  return m;
}

/** Rescale a BoxGeometry's UVs so 1 UV unit == 1 metre on every face. */
export function worldScaleBoxUVs(geo: THREE.BoxGeometry, w: number, h: number, d: number): void {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 verts each, 1 segment).
  const scale: [number, number][] = [
    [d, h], [d, h],
    [w, d], [w, d],
    [w, h], [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * scale[f][0], uv.getY(i) * scale[f][1]);
    }
  }
  uv.needsUpdate = true;
}

export const Palette = {
  ground: 0x7fa36b,
  neutral: 0xc8c8c8,
  ramp: 0xe0b36a,
  rampSteep: 0xd9735b,
  stairs: 0x8fb3d9,
  jump: 0xb59ad6,
  platform: 0x5fc2a8,
  platformAlt: 0xf08a5d,
  crate: 0xb8865b,
  tunnel: 0x9a9a9a,
} as const;
