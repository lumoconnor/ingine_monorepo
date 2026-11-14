/**
 * Tattoo flash: simple bold designs drawn on a canvas, so the same art can
 * go on the flash wall and on your skin. Each draws into a square of side
 * `s` with a transparent background (the classic look: black outline, a few
 * flat colours).
 */
export interface TattooDesign {
  id: string;
  name: string;
  draw: (g: CanvasRenderingContext2D, s: number) => void;
}

const INK = '#141414';

function outline(g: CanvasRenderingContext2D, s: number, w = 0.035): void {
  g.lineWidth = s * w;
  g.strokeStyle = INK;
  g.lineJoin = 'round';
  g.lineCap = 'round';
}

function banner(g: CanvasRenderingContext2D, s: number, text: string, y: number, color = '#f3e6c4'): void {
  const w = s * 0.86;
  const h = s * 0.17;
  const x = (s - w) / 2;
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x - s * 0.04, y + h * 0.15);
  g.lineTo(x + s * 0.06, y);
  g.lineTo(x + w - s * 0.06, y);
  g.lineTo(x + w + s * 0.04, y + h * 0.15);
  g.lineTo(x + w - s * 0.02, y + h * 0.55);
  g.lineTo(x + w + s * 0.04, y + h);
  g.lineTo(x - s * 0.04, y + h);
  g.lineTo(x + s * 0.02, y + h * 0.55);
  g.closePath();
  g.fill();
  outline(g, s, 0.022);
  g.stroke();
  g.fillStyle = INK;
  g.font = `900 ${Math.round(h * 0.62)}px Georgia, 'Times New Roman', serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, s / 2, y + h * 0.56);
}

function heart(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.beginPath();
  g.moveTo(cx, cy + r * 0.9);
  g.bezierCurveTo(cx - r * 1.6, cy - r * 0.1, cx - r * 0.9, cy - r * 1.3, cx, cy - r * 0.45);
  g.bezierCurveTo(cx + r * 0.9, cy - r * 1.3, cx + r * 1.6, cy - r * 0.1, cx, cy + r * 0.9);
  g.closePath();
}

function star(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, inner = 0.45): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * inner : r;
    g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.closePath();
}

export const TATTOOS: TattooDesign[] = [
  {
    id: 'heart',
    name: 'Heart',
    draw: (g, s) => {
      heart(g, s / 2, s * 0.42, s * 0.3);
      g.fillStyle = '#d7263d';
      g.fill();
      outline(g, s);
      g.stroke();
      banner(g, s, 'GENE', s * 0.5);
    },
  },
  {
    id: 'forty',
    name: 'Lucky 40',
    draw: (g, s) => {
      star(g, s / 2, s / 2, s * 0.44);
      g.fillStyle = '#f4c430';
      g.fill();
      outline(g, s);
      g.stroke();
      g.fillStyle = INK;
      g.font = `900 ${Math.round(s * 0.3)}px Georgia, serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('40', s / 2, s * 0.53);
    },
  },
  {
    id: 'anchor',
    name: 'Anchor',
    draw: (g, s) => {
      outline(g, s, 0.07);
      g.strokeStyle = INK;
      g.beginPath();
      g.moveTo(s / 2, s * 0.22);
      g.lineTo(s / 2, s * 0.82);
      g.moveTo(s * 0.32, s * 0.34);
      g.lineTo(s * 0.68, s * 0.34);
      g.moveTo(s * 0.2, s * 0.6);
      g.quadraticCurveTo(s * 0.26, s * 0.84, s / 2, s * 0.84);
      g.quadraticCurveTo(s * 0.74, s * 0.84, s * 0.8, s * 0.6);
      g.stroke();
      g.lineWidth = s * 0.05;
      g.beginPath();
      g.arc(s / 2, s * 0.15, s * 0.07, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = '#2b6cb0';
      g.lineWidth = s * 0.03;
      g.beginPath();
      g.moveTo(s * 0.3, s * 0.22);
      g.bezierCurveTo(s * 0.8, s * 0.3, s * 0.2, s * 0.55, s * 0.72, s * 0.7);
      g.stroke();
    },
  },
  {
    id: 'rose',
    name: 'Rose',
    draw: (g, s) => {
      g.fillStyle = '#3f8f4a';
      outline(g, s, 0.025);
      for (const [x, y, a] of [[0.34, 0.66, -0.6], [0.66, 0.68, 0.6]] as const) {
        g.save();
        g.translate(s * x, s * y);
        g.rotate(a);
        g.beginPath();
        g.ellipse(0, 0, s * 0.13, s * 0.06, 0, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.restore();
      }
      g.beginPath();
      g.moveTo(s / 2, s * 0.55);
      g.lineTo(s / 2, s * 0.92);
      g.stroke();
      g.fillStyle = '#c81d3a';
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.arc(s / 2, s * 0.38, s * (0.24 - i * 0.07), 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
    },
  },
  {
    id: 'cat',
    name: 'Murphy',
    draw: (g, s) => {
      g.fillStyle = '#e08a3c';
      outline(g, s);
      g.beginPath();
      g.moveTo(s * 0.2, s * 0.42);
      g.lineTo(s * 0.24, s * 0.12);
      g.lineTo(s * 0.42, s * 0.28);
      g.lineTo(s * 0.58, s * 0.28);
      g.lineTo(s * 0.76, s * 0.12);
      g.lineTo(s * 0.8, s * 0.42);
      g.quadraticCurveTo(s * 0.86, s * 0.82, s / 2, s * 0.84);
      g.quadraticCurveTo(s * 0.14, s * 0.82, s * 0.2, s * 0.42);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = INK;
      for (const x of [0.38, 0.62]) {
        g.beginPath();
        g.ellipse(s * x, s * 0.5, s * 0.04, s * 0.07, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#f29fb0';
      g.beginPath();
      g.moveTo(s * 0.46, s * 0.62);
      g.lineTo(s * 0.54, s * 0.62);
      g.lineTo(s / 2, s * 0.67);
      g.closePath();
      g.fill();
      g.lineWidth = s * 0.015;
      g.beginPath();
      for (const sx of [-1, 1]) for (const dy of [-0.02, 0.03]) {
        g.moveTo(s / 2 + sx * s * 0.1, s * (0.66 + dy));
        g.lineTo(s / 2 + sx * s * 0.32, s * (0.62 + dy * 2));
      }
      g.stroke();
    },
  },
  {
    id: 'swallow',
    name: 'Swallow',
    draw: (g, s) => {
      g.fillStyle = '#1f4e9c';
      outline(g, s);
      g.beginPath();
      g.moveTo(s * 0.1, s * 0.3);
      g.quadraticCurveTo(s * 0.4, s * 0.38, s * 0.5, s * 0.5);
      g.quadraticCurveTo(s * 0.6, s * 0.38, s * 0.9, s * 0.3);
      g.quadraticCurveTo(s * 0.7, s * 0.55, s * 0.58, s * 0.6);
      g.lineTo(s * 0.66, s * 0.9);
      g.lineTo(s * 0.5, s * 0.72);
      g.lineTo(s * 0.34, s * 0.9);
      g.lineTo(s * 0.42, s * 0.6);
      g.quadraticCurveTo(s * 0.3, s * 0.55, s * 0.1, s * 0.3);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = '#d7263d';
      g.beginPath();
      g.arc(s / 2, s * 0.5, s * 0.06, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    },
  },
  {
    id: 'dagger',
    name: 'Dagger',
    draw: (g, s) => {
      outline(g, s);
      g.fillStyle = '#c9ced6';
      g.beginPath();
      g.moveTo(s / 2, s * 0.95);
      g.lineTo(s * 0.43, s * 0.4);
      g.lineTo(s * 0.57, s * 0.4);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = '#f4c430';
      g.fillRect(s * 0.28, s * 0.33, s * 0.44, s * 0.07);
      g.strokeRect(s * 0.28, s * 0.33, s * 0.44, s * 0.07);
      g.fillStyle = '#6b3e26';
      g.fillRect(s * 0.45, s * 0.1, s * 0.1, s * 0.23);
      g.strokeRect(s * 0.45, s * 0.1, s * 0.1, s * 0.23);
      heart(g, s * 0.5, s * 0.6, s * 0.15);
      g.fillStyle = '#d7263d';
      g.fill();
      g.stroke();
    },
  },
  {
    id: 'skull',
    name: 'Party skull',
    draw: (g, s) => {
      outline(g, s);
      g.fillStyle = '#f2efe6';
      g.beginPath();
      g.arc(s / 2, s * 0.55, s * 0.26, Math.PI * 0.85, Math.PI * 2.15);
      g.lineTo(s * 0.64, s * 0.86);
      g.lineTo(s * 0.36, s * 0.86);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = INK;
      for (const x of [0.4, 0.6]) {
        g.beginPath();
        g.arc(s * x, s * 0.56, s * 0.06, 0, Math.PI * 2);
        g.fill();
      }
      g.beginPath();
      g.moveTo(s / 2, s * 0.64);
      g.lineTo(s * 0.47, s * 0.7);
      g.lineTo(s * 0.53, s * 0.7);
      g.fill();
      // A party hat, because forty.
      g.fillStyle = '#7b4bc4';
      g.beginPath();
      g.moveTo(s * 0.38, s * 0.33);
      g.lineTo(s / 2, s * 0.06);
      g.lineTo(s * 0.62, s * 0.33);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = '#f4c430';
      g.beginPath();
      g.arc(s / 2, s * 0.06, s * 0.04, 0, Math.PI * 2);
      g.fill();
    },
  },
];

/** A canvas with a design drawn on it (transparent background unless `bg` is given). */
export function tattooCanvas(id: string, size = 256, bg?: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  if (bg) {
    g.fillStyle = bg;
    g.fillRect(0, 0, size, size);
  }
  const d = TATTOOS.find((t) => t.id === id) ?? TATTOOS[0];
  const pad = size * 0.08;
  g.save();
  g.translate(pad, pad);
  d.draw(g, size - pad * 2);
  g.restore();
  return c;
}
