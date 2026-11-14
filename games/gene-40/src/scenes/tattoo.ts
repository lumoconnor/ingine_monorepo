import * as THREE from 'three';
import type { Game } from '@ingine/engine/core/Game';
import type { System } from '@ingine/engine/core/System';
import type { Entity } from '@ingine/engine/entities/Entity';
import { Entity as E } from '@ingine/engine/entities/Entity';
import { Interactable } from '@ingine/engine/gameplay/interaction/Interactable';
import { PlayerController } from '@ingine/engine/gameplay/player/PlayerController';
import { FistViewmodel } from '@ingine/engine/combat/FistViewmodel';
import { addNpc } from '@ingine/engine/world/npcs';
import type { Teleports } from '../Teleports';
import { sceneById, type Vec3 } from '../scenes';
import { TATTOOS, tattooCanvas } from '../content/tattooArt';
import { box, decor, label, mat, sign } from './kit';
import { buildReturnPad } from './hub';

/**
 * The tattoo parlour: Inkwell Tattoo, a little shop on a city street. Pick a
 * design off the flash wall, sit in the chair, and Inka inks it on your
 * forearm, where you see it in first person from then on. Your ink is kept
 * in this browser. (Nothing is permanent: a fresh design goes over the old.)
 */

type At = (x: number, y: number, z: number) => Vec3;

const W = 7; // half width of the shop
const FRONT = 2;
const BACK = -14;
const H = 3.6;
const INK_TIME = 3;
const INK_KEY = 'gene40.tattoo';

const CREAM = '#f3e6c4';

export function buildTattoo(game: Game, teleports: Teleports, index: number): TattooParlour {
  const s = sceneById('tattoo')!;
  const [ox, oy, oz] = s.origin;
  const at: At = (x, y, z) => [ox + x, oy + y, oz + z];
  street(game, at);
  shop(game, at);
  const sys = game.addSystem(new TattooParlour());
  sys.init(game);
  flashWall(game, at, sys);
  chair(game, at, sys);
  addNpc(game, { id: 'inka', name: 'Inka', dialogue: 'inka', position: at(5.2, 0, -9.4), facingDeg: -90, color: 0x1b1b1f, skin: 0xe8c3a6, hat: { color: 0x7b2d8e, kind: 'cap' } });
  buildReturnPad(game, teleports, s, index);
  return sys;
}

function street(game: Game, at: At): void {
  box(game, [60, 1, 40], at(0, -0.5, -4), 0x55585e, 'ground');
  // Pavement in front of the shop, then the road.
  decor(game, new THREE.PlaneGeometry(40, 9).rotateX(-Math.PI / 2), mat(0x9a9a96, { roughness: 0.95 }), at(0, 0.006, 6.5), 'pavement', false);
  decor(game, new THREE.PlaneGeometry(40, 6).rotateX(-Math.PI / 2), mat(0x2f3136, { roughness: 1 }), at(0, 0.006, 14), 'road', false);
  for (let x = -18; x <= 18; x += 4) decor(game, new THREE.PlaneGeometry(2, 0.15).rotateX(-Math.PI / 2), mat(0xf2f2f2), at(x, 0.01, 14), 'road-line', false);
  // Neighbours on either side (plain fronts).
  box(game, [10, 7, 16], at(-12.5, 3.5, -6), 0x7a5a48, 'neighbour');
  box(game, [10, 6, 16], at(12.5, 3, -6), 0x52606e, 'neighbour');
  sign(game, 'RECORDS', at(-12.5, 4.2, 2.05), { width: 4, height: 0.8, bg: '#2a2a2a', fg: '#f4c430' });
  sign(game, 'COFFEE', at(12.5, 3.8, 2.05), { width: 3.4, height: 0.8, bg: '#f3e6c4', fg: '#3b2416' });
  // A lamp post and a bench.
  box(game, [0.14, 4.2, 0.14], at(-5, 2.1, 9.2), 0x2a2a2a, 'lamp-post');
  decor(game, new THREE.SphereGeometry(0.25, 12, 8), mat(0xfff1c2, { emissive: 0xfff1c2, emissiveIntensity: 0.8 }), at(-5, 4.3, 9.2), 'lamp', false);
  box(game, [2, 0.45, 0.6], at(5, 0.225, 8.6), 0x6b4a2e, 'bench');
}

function shop(game: Game, at: At): void {
  const wall = 0x2b2533;
  const wh = H + 1.6;
  // Back and side walls, the front with a door in the middle and windows either side.
  box(game, [2 * W + 0.4, wh, 0.4], at(0, wh / 2, BACK - 0.2), wall, 'shop-wall');
  for (const sx of [-1, 1]) box(game, [0.4, wh, FRONT - BACK + 0.4], at(sx * (W + 0.2), wh / 2, (FRONT + BACK) / 2), wall, 'shop-wall');
  for (const sx of [-1, 1]) {
    // Front: low wall under the window, the window, and a header over it.
    const cx = sx * (W + 1.1) / 2;
    const w = W - 1.1 + 0.4;
    box(game, [w, 0.8, 0.4], at(cx, 0.4, FRONT + 0.2), wall, 'shop-front');
    decor(game, new THREE.BoxGeometry(w, 2.0, 0.05), new THREE.MeshStandardMaterial({ color: 0x9ec9e8, transparent: true, opacity: 0.25, roughness: 0.05, depthWrite: false }), at(cx, 1.8, FRONT + 0.2), 'window', false);
    box(game, [w, 0.04, 0.4], at(cx, 2.8, FRONT + 0.2), 0x111111, 'window-sill');
    // Invisible-ish: the glass still stops you.
    box(game, [w, 2.0, 0.05], at(cx, 1.8, FRONT + 0.25), 0x9ec9e8, 'window-glass').object3d.visible = false;
  }
  box(game, [2 * W + 0.4, wh - 2.8, 0.4], at(0, 2.8 + (wh - 2.8) / 2, FRONT + 0.2), wall, 'shop-front');
  // Inside faces: a warm plum wallpaper that glows a little, as if the shop lights were on.
  const paper = new THREE.MeshStandardMaterial({ color: 0x6b4a74, emissive: 0x3a2440, emissiveIntensity: 1, roughness: 0.9 });
  const inner = (w: number, p: Vec3, yawDeg: number) => {
    const e = decor(game, new THREE.PlaneGeometry(w, H), paper, p, 'wallpaper', false);
    e.object3d.rotation.y = THREE.MathUtils.degToRad(yawDeg);
  };
  inner(2 * W, at(0, H / 2, BACK + 0.005), 0);
  inner(FRONT - BACK, at(-W + 0.005, H / 2, (FRONT + BACK) / 2), 90);
  inner(FRONT - BACK, at(W - 0.005, H / 2, (FRONT + BACK) / 2), -90);
  // A dado rail round the room.
  for (const [w, p, r] of [[2 * W, at(0, 1.0, BACK + 0.02), 0], [FRONT - BACK, at(-W + 0.02, 1.0, (FRONT + BACK) / 2), 90], [FRONT - BACK, at(W - 0.02, 1.0, (FRONT + BACK) / 2), -90]] as const) {
    const e = decor(game, new THREE.BoxGeometry(w, 0.06, 0.03), mat(0x1a1420), p, 'dado', false);
    e.object3d.rotation.y = THREE.MathUtils.degToRad(r);
  }
  // The roof, with no shadow so the shop stays lit.
  decor(game, new THREE.BoxGeometry(2 * W + 1, 0.3, FRONT - BACK + 1), mat(0x1c1820), at(0, wh + 0.15, (FRONT + BACK) / 2), 'roof', false);
  // A ceiling inside, and lights.
  decor(game, new THREE.PlaneGeometry(2 * W, FRONT - BACK).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x4a3f55, emissive: 0x2c2434, roughness: 1 }), at(0, H, (FRONT + BACK) / 2), 'ceiling', false);
  for (const z of [-2, -7, -12]) decor(game, new THREE.CylinderGeometry(0.3, 0.3, 0.05, 16), mat(0xffffff, { emissive: 0xfff3d6, emissiveIntensity: 1 }), at(0, H - 0.03, z), 'ceiling-light', false);
  // Checkerboard floor.
  const black = mat(0x1a1a1a, { roughness: 0.4 });
  const white = mat(0xeeeeea, { roughness: 0.4 });
  const tile = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  for (let x = -W + 0.5; x < W; x += 1)
    for (let z = BACK + 0.5; z < FRONT; z += 1) {
      const m = (Math.round(x - 0.5) + Math.round(z - 0.5)) % 2 === 0 ? black : white;
      const t = new THREE.Mesh(tile, m);
      t.position.set(...at(x, 0.008, z));
      t.receiveShadow = true;
      game.world.spawn(new E('tile', t));
    }
  // Shop sign over the door, and a neon OPEN in the window.
  sign(game, 'INKWELL TATTOO', at(0, H + 0.7, FRONT + 0.42), { width: 6, height: 1, bg: '#1a1420', fg: '#ff4fa3', font: "900 150px Georgia, serif" });
  sign(game, 'OPEN', at(-4, 2.3, FRONT + 0.14), { width: 1.4, height: 0.5, bg: '#120a14', fg: '#ff4fa3' });
  sign(game, 'HAPPY 40TH GENE', at(4, 2.3, FRONT + 0.14), { width: 2.6, height: 0.5, bg: '#120a14', fg: '#5ee6ff' });
  label(game, 'Inkwell Tattoo', at(0, H + 1.6, FRONT + 0.4), 1.2);
  // Inside: a counter with a till, a sofa and a rug, a plant, framed art on the side walls.
  box(game, [3, 1.05, 0.8], at(-4.6, 0.525, -3.5), 0x4a2f3d, 'counter');
  box(game, [0.5, 0.3, 0.4], at(-5.3, 1.2, -3.5), 0x333333, 'till');
  decor(game, new THREE.BoxGeometry(0.2, 0.25, 0.02), mat(0xffffff), at(-4.2, 1.18, -3.5), 'card');
  box(game, [2.4, 0.45, 0.9], at(-5.4, 0.225, -10), 0x6e2a3a, 'sofa');
  box(game, [2.4, 0.6, 0.25], at(-5.4, 0.75, -10.4), 0x6e2a3a, 'sofa-back');
  decor(game, new THREE.PlaneGeometry(3, 2).rotateX(-Math.PI / 2), mat(0x7b2d8e, { roughness: 1 }), at(-5.2, 0.012, -9), 'rug', false);
  decor(game, new THREE.CylinderGeometry(0.22, 0.18, 0.4, 12), mat(0x9a5b3b), at(-6.4, 0.2, -12.9), 'pot');
  decor(game, new THREE.IcosahedronGeometry(0.45, 1), new THREE.MeshStandardMaterial({ color: 0x3f8f4a, flatShading: true }), at(-6.4, 0.75, -12.9), 'plant');
  const art = ['rose', 'swallow', 'anchor', 'skull'];
  art.forEach((id, i) => {
    const sx = i < 2 ? -1 : 1;
    const z = -5 - (i % 2) * 3.5;
    frame(game, id, at(sx * (W - 0.02), 2.0, z), 0.9, sx < 0 ? 90 : -90);
  });
  // A rack of ink bottles by the chair.
  box(game, [0.6, 1.0, 0.5], at(5.8, 0.5, -6.6), 0x2a2a2a, 'ink-cart');
  ['#d7263d', '#1f4e9c', '#f4c430', '#3f8f4a', '#141414'].forEach((c, i) =>
    decor(game, new THREE.CylinderGeometry(0.035, 0.035, 0.12, 10), mat(new THREE.Color(c).getHex()), at(5.6 + (i % 3) * 0.17, 1.06, -6.7 + Math.floor(i / 3) * 0.17), 'ink'),
  );
}

/** A framed design on a wall; `yawDeg` turns it to face into the room. */
function frame(game: Game, id: string, p: Vec3, size: number, yawDeg = 0): THREE.Mesh {
  const tex = new THREE.CanvasTexture(tattooCanvas(id, 256, CREAM));
  tex.colorSpace = THREE.SRGBColorSpace;
  const pic = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
  const border = new THREE.Mesh(new THREE.BoxGeometry(size + 0.1, size + 0.1, 0.03), mat(0x111111));
  border.position.z = -0.02;
  const g = new THREE.Group();
  g.add(border, pic);
  g.position.set(...p);
  g.rotation.y = THREE.MathUtils.degToRad(yawDeg);
  game.world.spawn(new E(`frame:${id}`, g));
  return pic;
}

/** The flash wall: every design, framed, on the back wall. E on one to choose it. */
function flashWall(game: Game, at: At, sys: TattooParlour): void {
  sign(game, 'FLASH  ·  PICK ONE', at(0, 3.15, BACK + 0.03), { width: 3.6, height: 0.4, bg: '#1a1420', fg: CREAM });
  TATTOOS.forEach((d, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const p = at(-2.4 + col * 1.6, 2.35 - row * 1.2, BACK + 0.05);
    frame(game, d.id, p, 0.95);
    // The E target: a thin slab in front of the frame.
    const hit = box(game, [1.0, 1.0, 0.06], [p[0], p[1], p[2] + 0.05], 0x000000, `flash:${d.id}`);
    hit.object3d.visible = false;
    hit.add(new Interactable({ prompt: () => (sys.chosen === d.id ? `${d.name} (chosen)` : `Choose ${d.name}`), range: 2.4, onInteract: () => sys.choose(d.id) }));
    label(game, d.name, [p[0], p[1] - 0.6, p[2] + 0.05], 0.45, CREAM);
  });
}

function chair(game: Game, at: At, sys: TattooParlour): void {
  const [x, z] = [3.6, -8.4];
  box(game, [0.5, 0.45, 0.5], at(x, 0.225, z), 0x333333, 'chair-base');
  box(game, [0.75, 0.15, 1.3], at(x, 0.55, z + 0.1), 0x111111, 'chair-seat');
  const back = box(game, [0.75, 0.9, 0.15], at(x, 0.95, z - 0.6), 0x111111, 'tattoo-chair', [-20, 0, 0]);
  for (const sx of [-1, 1]) box(game, [0.12, 0.1, 0.8], at(x + sx * 0.44, 0.78, z), 0x222222, 'chair-arm');
  decor(game, new THREE.CylinderGeometry(0.02, 0.02, 1.6, 6), mat(0x888888), at(x + 0.9, 0.8, z - 0.9), 'lamp-pole');
  decor(game, new THREE.ConeGeometry(0.18, 0.2, 16, 1, true), mat(0x222222), at(x + 0.6, 1.62, z - 0.6), 'lamp-shade');
  back.add(new Interactable({ prompt: () => sys.chairPrompt(), range: 2.6, onInteract: (user) => sys.sit(user) }));
  label(game, 'Tattoo chair (E)', at(x, 1.9, z), 0.6);
}

// --- The system -----------------------------------------------------------------------

export class TattooParlour implements System {
  readonly name = 'tattoo';
  private game!: Game;
  private ready = false;
  private panel!: HTMLDivElement;
  private unsubs: (() => void)[] = [];
  /** The design picked off the wall, and the one on your arm (if any). */
  chosen: string | null = null;
  inked: string | null = null;
  /** Seconds left in the chair (while being inked). */
  inking = 0;
  private sitter: Entity | null = null;
  private decal: THREE.Mesh | null = null;

  init(game: Game): void {
    if (this.ready) return;
    this.ready = true;
    this.game = game;
    try {
      this.inked = localStorage.getItem(INK_KEY);
    } catch {
      this.inked = null;
    }
    if (this.inked && !TATTOOS.some((t) => t.id === this.inked)) this.inked = null;
    this.panel = document.createElement('div');
    Object.assign(this.panel.style, {
      position: 'absolute',
      top: '14px',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '8px 14px',
      borderRadius: '10px',
      background: 'rgba(26,20,32,0.85)',
      color: CREAM,
      font: '600 16px system-ui, sans-serif',
      display: 'none',
      pointerEvents: 'none',
      zIndex: '4',
      whiteSpace: 'nowrap',
      borderBottom: '3px solid #ff4fa3',
    });
    document.getElementById('app')?.appendChild(this.panel);
    this.unsubs.push(
      game.events.on('teleport', () => {
        if (this.inked && !this.decal?.parent) this.applyInk();
        this.render();
      }),
    );
    this.applyInk();
    this.render();
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
  }

  private designName(id: string | null): string {
    return TATTOOS.find((t) => t.id === id)?.name ?? '';
  }

  choose(id: string): void {
    this.chosen = id;
    this.game.events.emit('notify', { text: `${this.designName(id)}: good choice. Sit in the chair when you're ready.` });
    this.render();
  }

  chairPrompt(): string {
    if (this.inking > 0) return 'Hold still...';
    return this.chosen ? `Get the ${this.designName(this.chosen)} tattoo` : 'Pick a design off the wall first';
  }

  /** E at the chair: sit, and Inka gets to work. */
  sit(user: Entity): void {
    if (this.inking > 0) return;
    if (!this.chosen) {
      this.game.events.emit('notify', { text: 'Pick a design off the flash wall first (the back wall).' });
      return;
    }
    const ctrl = user.get(PlayerController);
    if (ctrl) {
      // In the chair, looking down at your arm.
      const o = this.chairSeat();
      ctrl.placeAt(o, Math.PI / 2, -0.5);
    }
    this.sitter = user;
    this.inking = INK_TIME;
    this.game.events.emit('notify', { text: 'Bzzzzzz... Inka is inking. Hold still!' });
    this.game.events.emit('tattoo:start', { design: this.chosen });
    this.render();
  }

  private chairSeat(): THREE.Vector3 {
    const s = sceneById('tattoo')!;
    return new THREE.Vector3(s.origin[0] + 3.6, s.origin[1] + 0.62, s.origin[2] - 8.2);
  }

  preFixedUpdate(dt: number): void {
    if (this.inking <= 0) return;
    // Sit still: you stay in the chair while the needle buzzes.
    const ctrl = this.sitter?.get(PlayerController);
    if (ctrl && ctrl.feetPosition.distanceTo(this.chairSeat()) > 0.6) ctrl.placeAt(this.chairSeat(), ctrl.yaw, ctrl.pitch);
    this.inking = Math.max(0, this.inking - dt);
    if (this.inking === 0) this.finish();
  }

  private finish(): void {
    this.inked = this.chosen;
    try {
      if (this.inked) localStorage.setItem(INK_KEY, this.inked);
    } catch {
      /* private window: the ink washes off when you leave */
    }
    this.game.state.setFlag('tattoo.inked');
    this.applyInk();
    this.sitter = null;
    this.game.events.emit('notify', { text: `All done! Your ${this.designName(this.inked)} tattoo looks great. Hold right-click to raise your fists and admire it.` });
    this.game.events.emit('tattoo:done', { design: this.inked ?? '' });
    this.render();
  }

  /** Put the design on your forearm in first person (bare arm, rolled-up sleeve). */
  private applyInk(): void {
    const player = this.game.world.find('player');
    const fv = player?.get(FistViewmodel);
    const arm = fv?.fistModel;
    if (!arm || !this.inked) return;
    this.decal?.removeFromParent();
    const tex = new THREE.CanvasTexture(tattooCanvas(this.inked, 256));
    tex.colorSpace = THREE.SRGBColorSpace;
    const fore = arm.children[0] as THREE.Mesh | undefined;
    // The sleeve rolled up: bare skin, drawn over the world like the rest of the hand.
    if (fore) fore.material = new THREE.MeshStandardMaterial({ color: 0xd9a888, roughness: 0.8, depthTest: false });
    this.decal = new THREE.Mesh(new THREE.PlaneGeometry(0.058, 0.058).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.8, depthTest: false }));
    this.decal.renderOrder = 21;
    this.decal.name = 'tattoo';
    this.decal.position.set(0, 0.0305, 0.11);
    arm.add(this.decal);
  }

  private render(): void {
    const here = (this.game.getSystem('teleports') as { current?: string } | undefined)?.current === 'tattoo';
    this.panel.style.display = here ? 'block' : 'none';
    const mine = this.inked ? `Your ink: ${this.designName(this.inked)}` : 'No ink yet';
    this.panel.textContent = this.inking > 0
      ? `Inking your ${this.designName(this.chosen)}...`
      : this.chosen
        ? `Chosen: ${this.designName(this.chosen)}. Sit in the chair   ·   ${mine}`
        : `Pick a design off the flash wall   ·   ${mine}`;
  }
}

declare module '@ingine/engine/core/EventBus' {
  interface GameEvents {
    'tattoo:start': { design: string | null };
    'tattoo:done': { design: string };
  }
}
