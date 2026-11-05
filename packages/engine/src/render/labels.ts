import * as THREE from 'three';

/** Billboard text label (canvas sprite) for annotating test areas. */
export function makeLabel(text: string, opts: { scale?: number; color?: string } = {}): THREE.Sprite {
  const scale = opts.scale ?? 1;
  const font = 48;
  const pad = 16;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = `600 ${font}px system-ui, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const h = font + pad * 2;
  canvas.width = w;
  canvas.height = h;
  ctx.font = `600 ${font}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(15,18,24,0.72)';
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 14);
  ctx.fill();
  ctx.fillStyle = opts.color ?? '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pad, h / 2 + 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  const worldH = 0.45 * scale;
  sprite.scale.set((w / h) * worldH, worldH, 1);
  sprite.renderOrder = 10;
  return sprite;
}
