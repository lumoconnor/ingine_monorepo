import * as THREE from 'three';
import { Component } from '@ingine/engine/entities/Component';
import { PlayerController } from '@ingine/engine/gameplay/player/PlayerController';
import { BIOME_INFO, type WorldMap } from './WorldGen';
import { SITE_INFO } from './sites';

const PX = 768;
const shallowWater = new THREE.Color(0x3f95b8);
const deepWater = new THREE.Color(0x1c4f78);

const css = `
.wmap{position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;gap:20px;
  background:rgba(10,14,18,.72);font:14px/1.4 system-ui,sans-serif;color:#e9edf1;padding:16px;box-sizing:border-box;flex-wrap:wrap}
.wmap.hidden{display:none}
.wmap-view{position:relative;width:min(78vh,92vw);aspect-ratio:1;border-radius:6px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.5)}
.wmap-view canvas{position:absolute;inset:0;width:100%;height:100%;image-rendering:auto}
.wmap-side{width:230px;display:flex;flex-direction:column;gap:12px}
.wmap-side h2{margin:0;font-size:18px}
.wmap-side .row{display:flex;gap:6px}
.wmap-side input{flex:1;min-width:0;padding:6px 8px;border-radius:4px;border:1px solid #556;background:#1b222b;color:#fff;font:inherit}
.wmap-side button{padding:6px 10px;border-radius:4px;border:0;background:#e2c27a;color:#1d1a12;font:inherit;font-weight:600;cursor:pointer}
.wmap-side button.alt{background:#3a4552;color:#e9edf1}
.wmap-legend{display:grid;grid-template-columns:14px 1fr;gap:4px 8px;align-items:center;font-size:13px}
.wmap-legend i{width:14px;height:14px;border-radius:3px;display:block}
.wmap-meta{font-size:12px;color:#aab4be}
`;

/**
 * Debug map of the generated world (M): the whole world from above with
 * hill shading, the player's position and heading, and a seed box that
 * regenerates the world.
 */
export class WorldMapUi extends Component {
  private root!: HTMLDivElement;
  private base!: HTMLCanvasElement;
  private overlay!: HTMLCanvasElement;
  private meta!: HTMLDivElement;
  private drawn = false;
  private isOpen = false;
  private offs: (() => void)[] = [];

  constructor(private map: WorldMap) {
    super();
  }

  onAttach(): void {
    const style = document.createElement('style');
    style.textContent = css;
    this.root = document.createElement('div');
    this.root.className = 'wmap hidden';
    this.root.innerHTML = `
      <div class="wmap-view"><canvas class="base"></canvas><canvas class="marker"></canvas></div>
      <div class="wmap-side">
        <h2>World map</h2>
        <label>Seed
          <div class="row"><input class="seed" inputmode="numeric" value="${this.map.seed}"><button class="go">Go</button></div>
        </label>
        <button class="alt random">Random seed</button>
        <div class="wmap-legend">${BIOME_INFO.map((b) => `<i style="background:#${b.color.toString(16).padStart(6, '0')}"></i><span>${b.name}</span>`).join('')}</div>
        <div class="wmap-legend"><i style="background:#fff;border:1.5px solid #1c4f78;border-radius:50%;box-sizing:border-box"></i><span>Waterfall</span>${Object.values(SITE_INFO).map((s) => `<i style="background:${s.color};border:1.5px solid #1a1d22;box-sizing:border-box;${s.label === 'Town' || s.label === 'Village' ? 'border-radius:50%' : ''}"></i><span>${s.label}</span>`).join('')}</div>
        <div class="wmap-meta"></div>
        <div class="wmap-meta">M or Esc to close</div>
      </div>`;
    this.root.prepend(style);
    document.body.appendChild(this.root);
    this.base = this.root.querySelector('canvas.base')!;
    this.overlay = this.root.querySelector('canvas.marker')!;
    this.meta = this.root.querySelector('.wmap-meta')!;
    this.base.width = this.base.height = this.overlay.width = this.overlay.height = PX;

    const input = this.root.querySelector<HTMLInputElement>('input.seed')!;
    const go = (seed: number) => {
      const u = new URL(location.href);
      u.searchParams.set('level', 'world');
      u.searchParams.set('seed', String(seed >>> 0));
      location.href = u.toString();
    };
    this.root.querySelector('button.go')!.addEventListener('click', () => {
      const v = parseInt(input.value.replace(/[^0-9]/g, ''), 10);
      if (Number.isFinite(v)) go(v);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') (this.root.querySelector('button.go') as HTMLButtonElement).click();
    });
    this.root.querySelector('button.random')!.addEventListener('click', () => go(Math.floor(Math.random() * 1e9)));

    this.offs.push(
      this.game.events.on('input:pressed', ({ action }) => {
        if (action !== 'toggleMap') return;
        if (this.isOpen) this.close(true);
        else this.open();
      }),
      this.game.events.on('input:pointerlock', ({ locked }) => {
        if (!locked && this.isOpen) this.close(false);
      }),
    );
    window.addEventListener('keydown', this.onKey);
  }

  onDetach(): void {
    this.offs.forEach((f) => f());
    window.removeEventListener('keydown', this.onKey);
    this.root.remove();
  }

  private onKey = (e: KeyboardEvent): void => {
    if (this.isOpen && e.code === 'Escape') this.close(false);
  };

  open(): void {
    const g = this.game;
    if (this.isOpen || !g.input.locked || g.paused) return;
    this.isOpen = true;
    g.paused = true;
    g.input.gameplayBlocked = true;
    g.input.openMenu();
    if (!this.drawn) this.drawBase();
    this.root.classList.remove('hidden');
    this.tick();
  }

  close(resume: boolean): void {
    if (!this.isOpen) return;
    const g = this.game;
    this.isOpen = false;
    g.paused = false;
    g.input.gameplayBlocked = false;
    g.input.closeMenu(g.renderer.webgl.domElement, resume);
    this.root.classList.add('hidden');
  }

  /** The game is paused while the map is open, so the marker redraws on its own frame loop. */
  private tick = (): void => {
    if (!this.isOpen) return;
    this.drawOverlay();
    requestAnimationFrame(this.tick);
  };

  /** Top-down colour + hill shading, one pixel per few metres. */
  private drawBase(): void {
    this.drawn = true;
    const ctx = this.base.getContext('2d')!;
    const img = ctx.createImageData(PX, PX);
    const g = this.map.grid;
    const n = new THREE.Vector3();
    const c = new THREE.Color();
    const light = new THREE.Vector3(-0.6, 0.7, -0.4).normalize();
    for (let py = 0; py < PX; py++) {
      const iz = Math.round((py / (PX - 1)) * (g.n - 1));
      for (let px = 0; px < PX; px++) {
        const ix = Math.round((px / (PX - 1)) * (g.n - 1));
        g.normalAt(ix, iz, n);
        this.map.colorAt(ix, iz, n, c);
        let shade = 0.55 + 0.6 * Math.max(0, n.dot(light));
        const wl = this.map.wet[iz * g.n + ix];
        const depth = wl - g.heights[iz * g.n + ix];
        if (depth > 0) {
          c.copy(shallowWater).lerp(deepWater, Math.min(1, depth / 5));
          shade = 1;
        }
        const o = (py * PX + px) * 4;
        img.data[o] = Math.min(255, c.r * 255 * shade);
        img.data[o + 1] = Math.min(255, c.g * 255 * shade);
        img.data[o + 2] = Math.min(255, c.b * 255 * shade);
        img.data[o + 3] = 255;
      }
    }
    // Colours are linear; the canvas wants sRGB-ish. A cheap gamma lift reads closer to the game.
    for (let i = 0; i < img.data.length; i += 4) {
      for (let k = 0; k < 3; k++) img.data[i + k] = Math.round(255 * Math.pow(img.data[i + k] / 255, 1 / 2.2));
    }
    ctx.putImageData(img, 0, 0);
    // Waterfalls
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1c4f78';
    ctx.lineWidth = 1.5;
    for (const f of this.map.hydro.falls) {
      const x = ((f.x - g.minX) / g.size) * PX;
      const y = ((f.z - g.minZ) / g.size) * PX;
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Roads (already tinted in the ground colours; a line makes them readable at this scale), bridges, sites.
    const X = (x: number) => ((x - g.minX) / g.size) * PX;
    const Z = (z: number) => ((z - g.minZ) / g.size) * PX;
    ctx.lineJoin = ctx.lineCap = 'round';
    for (const r of this.map.net.roads) {
      ctx.beginPath();
      r.points.forEach((q, i) => (i ? ctx.lineTo(X(q.x), Z(q.z)) : ctx.moveTo(X(q.x), Z(q.z))));
      ctx.strokeStyle = r.kind === 'road' ? '#e9d7ae' : 'rgba(233,215,174,0.8)';
      ctx.lineWidth = r.kind === 'road' ? 2.4 : 1.3;
      ctx.setLineDash(r.kind === 'road' ? [] : [4, 3]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const b of this.map.net.bridges) {
      ctx.beginPath();
      ctx.moveTo(X(b.ax), Z(b.az));
      ctx.lineTo(X(b.bx), Z(b.bz));
      ctx.strokeStyle = '#4a3320';
      ctx.lineWidth = 5;
      ctx.lineCap = 'butt';
      ctx.stroke();
      ctx.strokeStyle = '#d9b27c';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    // Settlements: walls, then building footprints.
    const px = PX / g.size;
    for (const st of this.map.settlements) {
      ctx.lineCap = 'butt';
      ctx.strokeStyle = '#5d5a55';
      for (const w of st.walls) {
        ctx.lineWidth = Math.max(1.5, w.thickness * px);
        ctx.beginPath();
        ctx.moveTo(X(w.from[0]), Z(w.from[1]));
        ctx.lineTo(X(w.to[0]), Z(w.to[1]));
        ctx.stroke();
      }
      ctx.fillStyle = '#5d5a55';
      for (const t of st.towers) ctx.fillRect(X(t.x) - (t.size * px) / 2, Z(t.z) - (t.size * px) / 2, t.size * px, t.size * px);
      for (const b of st.buildings) {
        ctx.save();
        ctx.translate(X(b.x), Z(b.z));
        // World yaw turns +Z toward +X; on the map +Z is down, so the canvas angle is -yaw.
        ctx.rotate(-b.yaw);
        ctx.fillStyle = b.kind === 'keep' ? '#6f6a63' : '#8d4b36';
        ctx.fillRect((-b.w * px) / 2, (-b.d * px) / 2, Math.max(1.2, b.w * px), Math.max(1.2, b.d * px));
        ctx.restore();
      }
    }
    // Camps and ruins: their walls.
    for (const o of this.map.outposts) {
      ctx.lineCap = 'butt';
      ctx.strokeStyle = o.kind === 'camp' ? '#5a3f28' : '#6f6a63';
      for (const w of o.walls) {
        ctx.lineWidth = Math.max(1, w.thickness * px);
        ctx.beginPath();
        ctx.moveTo(X(w.from[0]), Z(w.from[1]));
        ctx.lineTo(X(w.to[0]), Z(w.to[1]));
        ctx.stroke();
      }
    }
    ctx.lineCap = 'round';

    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const s of this.map.sites) {
      const settled = s.kind === 'village' || s.kind === 'town';
      const info = SITE_INFO[s.kind];
      const x = X(s.x);
      const y = Z(s.z);
      const r = s.kind === 'town' ? 7 : 5;
      if (settled) {
        // The buildings show where it is; just a small dot for the square.
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = info.color;
        ctx.strokeStyle = '#1a1d22';
        ctx.lineWidth = 1;
        ctx.fill();
        ctx.stroke();
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(15,18,24,0.85)';
        ctx.strokeText(s.name, x, y - (s.kind === 'town' ? 20 : 13));
        ctx.fillStyle = '#fff';
        ctx.fillText(s.name, x, y - (s.kind === 'town' ? 20 : 13));
        continue;
      }
      ctx.beginPath();
      if (s.kind === 'camp') {
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r, y + r * 0.8);
        ctx.lineTo(x - r, y + r * 0.8);
        ctx.closePath();
      } else if (s.kind === 'ruin') ctx.rect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
      else ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = info.color;
      ctx.strokeStyle = '#1a1d22';
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(15,18,24,0.85)';
      ctx.strokeText(s.name, x, y - r - 5);
      ctx.fillStyle = '#fff';
      ctx.fillText(s.name, x, y - r - 5);
    }
  }

  private drawOverlay(): void {
    const ctx = this.overlay.getContext('2d')!;
    ctx.clearRect(0, 0, PX, PX);
    const player = this.game.world.find('player');
    const ctrl = player?.get(PlayerController);
    if (!player || !ctrl) return;
    const g = this.map.grid;
    const p = ctrl.feetPosition;
    const px = ((p.x - g.minX) / g.size) * PX;
    const py = ((p.z - g.minZ) / g.size) * PX;
    // Facing: yaw 0 looks toward -Z (up on the map); positive yaw turns left.
    const a = -ctrl.yaw;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(a);
    ctx.scale(1.8, 1.8);
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(7, 7);
    ctx.lineTo(0, 3);
    ctx.lineTo(-7, 7);
    ctx.closePath();
    ctx.fillStyle = '#ff4d3d';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    this.meta.textContent =
      `Position ${p.x.toFixed(0)}, ${p.z.toFixed(0)} · height ${p.y.toFixed(0)} m · ` +
      `world ${g.size} m · generated in ${this.map.genMs.toFixed(0)} ms`;
  }
}
