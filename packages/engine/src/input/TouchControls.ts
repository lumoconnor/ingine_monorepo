import type { Game } from '../core/Game';
import type { System } from '../core/System';
import type { Action } from '../config/bindings';
import type { Hud } from '../ui/Hud';
import type { InventorySystem } from '../inventory/InventorySystem';
import '../ui/touch.css';

/** Look speed for a finger drag, radians per CSS pixel. */
const LOOK_PER_PX = 0.0052;
/** Stick travel in CSS pixels for full speed. */
const STICK_RADIUS = 56;
/** Drag the stick this far past its rim (and mostly forward) to sprint. */
const SPRINT_PAST = 1.35;
/** The left part of the screen is the stick's; the rest is look. */
const STICK_ZONE = 0.42;
/** A crouch tap toggles; holding it longer than this is crouch-while-held (e.g. swim down). */
const CROUCH_HOLD_MS = 280;

interface ButtonDef {
  action: Action;
  label: string;
  cls: string;
  /** Dragging a finger on this button also turns the camera (attack, guard). */
  look?: boolean;
}

const BUTTONS: ButtonDef[] = [
  { action: 'attack', label: 'Attack', cls: 'b-attack', look: true },
  { action: 'altAttack', label: 'Guard<small>Aim</small>', cls: 'b-alt', look: true },
  { action: 'jump', label: 'Jump', cls: 'b-jump' },
  { action: 'interact', label: 'Use', cls: 'b-use' },
  { action: 'crouch', label: 'Crouch', cls: 'b-crouch' },
  { action: 'reload', label: 'Reload', cls: 'b-reload' },
  { action: 'cycleAmmo', label: 'Ammo', cls: 'b-ammo' },
];

const TOP_BUTTONS: ButtonDef[] = [
  { action: 'slot1', label: '1', cls: 't-slot' },
  { action: 'slot2', label: '2', cls: 't-slot' },
  { action: 'slot3', label: '3', cls: 't-slot' },
  { action: 'slot4', label: '4', cls: 't-slot' },
  { action: 'inventory', label: 'Bag', cls: 't-bag' },
];

type Finger =
  | { kind: 'stick'; ox: number; oy: number }
  | { kind: 'look'; x: number; y: number }
  | { kind: 'button'; action: Action; el: HTMLElement; x: number; y: number; look: boolean; at: number };

/**
 * On-screen controls for phones and tablets: a floating move stick on the
 * left, drag anywhere else to look, and action buttons on the right.
 *
 * It only appears on touch devices (or with `?touch=1` in the URL; `?touch=0`
 * turns it off). Buttons press their action on touchdown, exactly like a key,
 * so holds (heavy swing, bow draw, guard) start without delay.
 */
export class TouchControls implements System {
  readonly name = 'touch';
  private game!: Game;
  private layer: HTMLDivElement;
  private stickBase: HTMLDivElement;
  private stickKnob: HTMLDivElement;
  private useBtn!: HTMLElement;
  private crouchBtn!: HTMLElement;
  private fsBtn!: HTMLElement;
  private fingers = new Map<number, Finger>();
  private enabled = false;
  private crouchLatched = false;

  constructor(private container: HTMLElement) {
    this.layer = document.createElement('div');
    this.layer.className = 'touch-layer hidden';
    const btn = (b: ButtonDef) => `<div class="tbtn ${b.cls}" data-action="${b.action}"${b.look ? ' data-look="1"' : ''}>${b.label}</div>`;
    this.layer.innerHTML = `
      <div class="stick"><div class="knob"></div></div>
      <div class="trotate">Turn your phone sideways for more room</div>
      <div class="tbuttons">${BUTTONS.map(btn).join('')}</div>
      <div class="ttop">${TOP_BUTTONS.map(btn).join('')}
        <div class="tbtn t-fs" data-ui="fullscreen" aria-label="Fullscreen"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg></div>
        <div class="tbtn t-pause" data-ui="pause" aria-label="Pause">❚❚</div>
      </div>`;
    this.stickBase = this.layer.querySelector('.stick')!;
    this.stickKnob = this.layer.querySelector('.knob')!;
  }

  /** Is this a phone or tablet? A URL flag overrides: ?touch=1 / ?touch=0. */
  static detect(): boolean {
    const flag = new URLSearchParams(location.search).get('touch');
    if (flag === '1') return true;
    if (flag === '0') return false;
    return matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && matchMedia('(hover: none)').matches);
  }

  init(game: Game): void {
    this.game = game;
    // Sit just above the HUD and below dialogue and inventory, which come later in the DOM.
    const hud = this.container.querySelector('.hud');
    if (hud) hud.after(this.layer);
    else this.container.appendChild(this.layer);

    this.useBtn = this.layer.querySelector('.b-use')!;
    this.crouchBtn = this.layer.querySelector('.b-crouch')!;
    this.fsBtn = this.layer.querySelector('.t-fs')!;

    this.layer.addEventListener('pointerdown', this.onDown);
    this.layer.addEventListener('pointermove', this.onMove);
    this.layer.addEventListener('pointerup', this.onUp);
    this.layer.addEventListener('pointercancel', this.onUp);
    this.layer.addEventListener('lostpointercapture', this.onUp);
    this.layer.addEventListener('contextmenu', (e) => e.preventDefault());
    // Cancel the taps' emulated click: buttons like pause hide this layer mid-tap,
    // and the click would land on whatever is underneath (the pause screen's "resume").
    const stop = (e: TouchEvent) => e.cancelable && e.preventDefault();
    this.layer.addEventListener('touchstart', stop, { passive: false });
    this.layer.addEventListener('touchend', stop, { passive: false });

    game.events.on('input:pointerlock', () => this.refresh());
    game.events.on('dialogue:start', () => this.layer.classList.add('busy'));
    game.events.on('dialogue:end', () => this.layer.classList.remove('busy'));
    game.events.on('inventory:open', () => {
      this.releaseAll();
      this.layer.classList.add('hidden');
      this.addInventoryClose();
    });
    game.events.on('inventory:close', () => this.refresh());
    game.events.on('interact:focus', ({ prompt }) => this.useBtn.classList.toggle('ready', prompt !== null));
    // The controller can stand you up by itself (jumping, ladders, water): keep the toggle honest.
    game.events.on('player:crouch', ({ crouched }) => {
      if (!crouched && this.crouchLatched) this.setCrouchLatch(false);
    });
    const onFs = () => this.fsBtn.classList.toggle('on', !!(document.fullscreenElement ?? (document as { webkitFullscreenElement?: Element }).webkitFullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);

    if (TouchControls.detect()) this.enable();
    else if (new URLSearchParams(location.search).get('touch') !== '0') {
      // Touchscreen laptops: switch over the first time someone actually taps.
      window.addEventListener('touchstart', () => this.enable(), { once: true, passive: true, capture: true });
    }
  }

  private enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.game.input.preferTouch = true;
    document.body.classList.add('touch-ui');
    // iOS pinch-zoom ignores touch-action; block its gesture events too.
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    // Phones have tiny, dense screens and slow GPUs: render at no more than 1.5x.
    const r = this.game.renderer;
    if (r.maxPixelRatio > 1.5) {
      r.maxPixelRatio = 1.5;
      window.dispatchEvent(new Event('resize'));
    }
    this.addHelp();
    const play = this.container.querySelector<HTMLButtonElement>('.overlay .play');
    if (play) {
      const retitle = () => play.textContent === 'Click to play' && (play.textContent = 'Tap to play');
      retitle();
      new MutationObserver(retitle).observe(play, { childList: true });
    }
    this.refresh();
  }

  /** Touch has no Tab key: give the inventory a close button. */
  private addInventoryClose(): void {
    const header = this.container.querySelector('.inventory .inv-panel header');
    if (!header || header.querySelector('.inv-close')) return;
    const b = document.createElement('button');
    b.className = 'inv-close';
    b.setAttribute('aria-label', 'Close');
    b.textContent = '×';
    b.addEventListener('click', () => this.game.getSystem<InventorySystem>('inventory')?.close(true));
    header.appendChild(b);
  }

  /** Swap the keyboard table on the start screen for touch instructions. */
  private addHelp(): void {
    const panel = this.container.querySelector('.overlay .panel');
    if (!panel || panel.querySelector('.touch-help')) return;
    const help = document.createElement('table');
    help.className = 'controls touch-help';
    help.innerHTML = `
      <tr><td>Left side</td><td>Move: touch and drag. Push past the ring to sprint</td></tr>
      <tr><td>Right side</td><td>Drag to look (also works while holding Attack or Guard)</td></tr>
      <tr><td>Attack</td><td>Tap to strike or shoot. Hold for a heavy blow, to draw a bow or cook a grenade</td></tr>
      <tr><td>Guard</td><td>Hold to block or aim; raise it just as a blow lands to parry</td></tr>
      <tr><td>Use</td><td>Doors, levers, talking, picking up. Glows when something is in reach</td></tr>
      <tr><td>Crouch</td><td>Tap to toggle, or hold (swim down)</td></tr>
      <tr><td>Jump</td><td>Hold for higher. Also swims up and lets go of ladders and ziplines</td></tr>
      <tr><td>1-4 / Bag</td><td>Draw a weapon / open the inventory</td></tr>
      <tr><td>Talking</td><td>Tap a reply</td></tr>
      <tr><td>❚❚</td><td>Pause</td></tr>`;
    panel.appendChild(help);
  }

  private refresh(): void {
    const show = this.enabled && this.game.input.touch && this.game.input.locked && !this.game.input.menuOpen;
    if (!show) this.releaseAll();
    this.layer.classList.toggle('hidden', !show);
  }

  // --- Pointers ------------------------------------------------------------

  private onDown = (e: PointerEvent): void => {
    e.preventDefault(); // no emulated mouse events, no text selection, no double-tap zoom
    const input = this.game.input;
    const target = (e.target as HTMLElement).closest<HTMLElement>('.tbtn');
    if (target) {
      const ui = target.dataset.ui;
      if (ui === 'pause') return input.pause();
      if (ui === 'fullscreen') return void this.game.getSystem<Hud>('hud')?.toggleFullscreen(false);
      const action = target.dataset.action as Action;
      this.capture(e);
      this.fingers.set(e.pointerId, { kind: 'button', action, el: target, x: e.clientX, y: e.clientY, look: !!target.dataset.look, at: performance.now() });
      target.classList.add('down');
      if (action === 'crouch') {
        // Pressing again while latched stands up; otherwise crouch now and decide on release.
        if (this.crouchLatched) this.setCrouchLatch(false);
        else input.virtualDown('crouch');
        return;
      }
      input.virtualDown(action);
      return;
    }
    if (this.layer.classList.contains('busy')) return;
    this.capture(e);
    const hasStick = [...this.fingers.values()].some((f) => f.kind === 'stick');
    if (!hasStick && e.clientX < window.innerWidth * STICK_ZONE) {
      // Floating stick: centred where the thumb lands (kept clear of the edges).
      const ox = Math.max(STICK_RADIUS + 8, e.clientX);
      const oy = Math.min(window.innerHeight - STICK_RADIUS - 8, Math.max(STICK_RADIUS + 8, e.clientY));
      this.fingers.set(e.pointerId, { kind: 'stick', ox, oy });
      this.stickBase.style.left = `${ox}px`;
      this.stickBase.style.top = `${oy}px`;
      this.stickBase.classList.add('active');
      this.updateStick(e.clientX, e.clientY, ox, oy);
    } else {
      this.fingers.set(e.pointerId, { kind: 'look', x: e.clientX, y: e.clientY });
    }
  };

  private onMove = (e: PointerEvent): void => {
    const f = this.fingers.get(e.pointerId);
    if (!f) return;
    if (f.kind === 'stick') return this.updateStick(e.clientX, e.clientY, f.ox, f.oy);
    if (f.kind === 'button' && !f.look) return;
    this.game.input.addTouchLook((e.clientX - f.x) * LOOK_PER_PX, (e.clientY - f.y) * LOOK_PER_PX);
    f.x = e.clientX;
    f.y = e.clientY;
  };

  private onUp = (e: PointerEvent): void => {
    const f = this.fingers.get(e.pointerId);
    if (!f) return;
    this.fingers.delete(e.pointerId);
    this.endFinger(f);
  };

  private endFinger(f: Finger): void {
    const input = this.game.input;
    if (f.kind === 'stick') {
      input.setStick(0, 0);
      input.virtualUp('sprint');
      this.stickBase.classList.remove('active', 'sprint');
      this.stickBase.style.left = this.stickBase.style.top = '';
      this.stickKnob.style.transform = '';
    } else if (f.kind === 'button') {
      f.el.classList.remove('down');
      if (f.action === 'crouch') {
        // A quick tap toggles crouch on; a long hold was crouch-while-held.
        if (!this.crouchLatched && input.isDown('crouch') && performance.now() - f.at < CROUCH_HOLD_MS) this.setCrouchLatch(true);
        else if (!this.crouchLatched) input.virtualUp('crouch');
        return;
      }
      input.virtualUp(f.action);
    }
  }

  private setCrouchLatch(on: boolean): void {
    this.crouchLatched = on;
    this.crouchBtn.classList.toggle('on', on);
    if (!on) this.game.input.virtualUp('crouch');
  }

  private updateStick(x: number, y: number, ox: number, oy: number): void {
    const dx = x - ox;
    const dy = y - oy;
    const dist = Math.hypot(dx, dy);
    const k = dist > STICK_RADIUS ? STICK_RADIUS / dist : 1;
    this.stickKnob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    // Small dead zone, then full analog range.
    const mag = dist < 6 ? 0 : Math.min(1, (dist - 6) / (STICK_RADIUS - 6));
    const nx = dist > 0 ? dx / dist : 0;
    const ny = dist > 0 ? dy / dist : 0;
    this.game.input.setStick(nx * mag, -ny * mag);
    const sprint = dist > STICK_RADIUS * SPRINT_PAST && -ny > 0.7;
    this.stickBase.classList.toggle('sprint', sprint);
    if (sprint) this.game.input.virtualDown('sprint');
    else this.game.input.virtualUp('sprint');
  }

  private capture(e: PointerEvent): void {
    try {
      this.layer.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
  }

  private releaseAll(): void {
    for (const f of this.fingers.values()) this.endFinger(f);
    this.fingers.clear();
    if (this.crouchLatched) this.setCrouchLatch(false);
  }
}
