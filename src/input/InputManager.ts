import type { Game } from '@/core/Game';
import type { System } from '@/core/System';
import { defaultBindings, type Action, type Bindings } from '@/config/bindings';

/** Actions that keep working while gameplay input is blocked. */
const UI_ACTIONS = new Set<Action>(['toggleDebug', 'toggleFullscreen', 'inventory', 'quickSave', 'quickLoad']);

/**
 * Keyboard + mouse input with pointer lock, mapped to logical Actions.
 *
 * - `isDown(action)`    : held this frame
 * - `wasPressed(action)`: went down since the last fixed step consumed it
 * - `consumeLook()`     : accumulated mouse delta (pixels) since last call
 *
 * Presses are latched until a fixed step reads them so quick taps are never
 * lost when the render rate is higher than the simulation rate.
 */
export class InputManager implements System {
  readonly name = 'input';
  private game!: Game;
  private down = new Set<string>();
  private pressed = new Set<Action>();
  private keyToActions = new Map<string, Action[]>();
  private lookX = 0;
  private lookY = 0;
  private _locked = false;
  private dragMode = false;
  private menu = false;
  /** Re-capturing the mouse after a menu: a failure means "pause", not "switch to drag mode". */
  private relocking = false;
  private relockFailedAt = -1e9;
  /** On-screen (touch) controls: actions held by a finger, the stick, and look in radians. */
  private virtual = new Set<Action>();
  private stickX = 0;
  private stickY = 0;
  private touchYaw = 0;
  private touchPitch = 0;
  private touchMode = false;

  /**
   * Set by TouchControls on phones and tablets: "play" starts touch mode
   * (on-screen stick and buttons) instead of capturing the mouse.
   */
  preferTouch = false;

  /**
   * While true (e.g. in a conversation), gameplay actions read as released,
   * movement is zero and mouse look is swallowed. UI keys still work.
   */
  gameplayBlocked = false;

  /** Mouse sensitivity in radians per pixel. */
  sensitivity = 0.0022;
  invertY = false;

  constructor(private bindings: Bindings = defaultBindings) {
    this.rebuildKeyMap();
  }

  get locked(): boolean {
    return this._locked;
  }

  init(game: Game): void {
    this.game = game;
    window.addEventListener('keydown', this.onKeyDown, { capture: true });
    window.addEventListener('keyup', this.onKeyUp, { capture: true });
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('pointerlockerror', this.onLockError);
    document.addEventListener('contextmenu', (e) => this._locked && e.preventDefault());
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown, { capture: true });
    window.removeEventListener('keyup', this.onKeyUp, { capture: true });
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.removeEventListener('pointerlockerror', this.onLockError);
  }

  /**
   * Capture the mouse. If the browser or an embedding frame refuses pointer
   * lock, fall back to "drag to look" (hold the left button and move).
   */
  async requestPointerLock(target: HTMLElement): Promise<void> {
    if (this.preferTouch) {
      this.enterDragMode(true);
      return;
    }
    this.dragMode = false;
    const req = target.requestPointerLock as (opts?: object) => Promise<void> | void;
    try {
      // unadjustedMovement gives raw mouse input where supported.
      await req.call(target, { unadjustedMovement: true });
      return;
    } catch {
      /* try again without options */
    }
    try {
      await req.call(target);
    } catch {
      this.enterDragMode();
    }
  }

  /** True while a menu (inventory) has freed the cursor. The game still counts as "playing". */
  get menuOpen(): boolean {
    return this.menu;
  }

  /**
   * Free the mouse cursor for a menu without leaving the game: pointer lock
   * is released, but no 'input:pointerlock' event fires, so the pause screen
   * stays hidden.
   */
  openMenu(): void {
    if (this.menu) return;
    this.menu = true;
    this.down.clear();
    this.pressed.clear();
    this.clearTouch();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /**
   * Back to the game. `resume` re-captures the mouse (call it from a key or
   * click handler: browsers only allow that in response to user input). If
   * capture fails, or `resume` is false, the game pauses as if Esc was pressed.
   */
  closeMenu(target: HTMLElement, resume: boolean): void {
    if (!this.menu) return;
    this.menu = false;
    this.down.clear();
    this.pressed.clear();
    this.clearTouch();
    if (this.dragMode) {
      if (!resume) this.exitDragMode();
      return;
    }
    const pause = () => {
      if (this.relocking) this.relockFailedAt = performance.now();
      this.relocking = false;
      if (document.pointerLockElement || this.menu || !this._locked) return;
      this._locked = false;
      this.game.events.emit('input:pointerlock', { locked: false });
    };
    if (!resume) return pause();
    this.relocking = true;
    try {
      const r = (target.requestPointerLock as () => Promise<void> | void).call(target);
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(pause);
    } catch {
      pause();
    }
  }

  /** True when mouse look works by dragging because pointer lock is unavailable. */
  get dragLook(): boolean {
    return this.dragMode;
  }

  /** True while playing with on-screen touch controls (no pointer lock, no cursor). */
  get touch(): boolean {
    return this.touchMode;
  }

  /** Leave play (touch mode or drag-to-look) for the pause screen, like Esc does. */
  pause(): void {
    if (this.dragMode) this.exitDragMode();
    else if (document.pointerLockElement) document.exitPointerLock();
  }

  private enterDragMode(touch = false): void {
    if (this.dragMode || document.pointerLockElement) return;
    this.dragMode = true;
    this.touchMode = touch;
    this._locked = true;
    this.game.events.emit('input:pointerlock', { locked: true });
  }

  private exitDragMode(): void {
    if (!this.dragMode) return;
    this.dragMode = false;
    this.touchMode = false;
    this._locked = false;
    this.down.clear();
    this.pressed.clear();
    this.clearTouch();
    this.game.events.emit('input:pointerlock', { locked: false });
  }

  // --- On-screen controls (TouchControls drives these) ---

  /**
   * A finger went down on an action button. Counts as a press straight away
   * (latched like a key, so holds start on the same frame as taps) and stays
   * held until `virtualUp`.
   */
  virtualDown(action: Action): void {
    if (!this._locked || (this.menu && !UI_ACTIONS.has(action))) return;
    if (this.virtual.has(action)) return;
    this.virtual.add(action);
    this.pressed.add(action);
    this.game.events.emit('input:pressed', { action });
  }

  virtualUp(action: Action): void {
    this.virtual.delete(action);
  }

  /** Virtual stick in [-1, 1]: x = strafe right, y = forward. */
  setStick(x: number, y: number): void {
    this.stickX = x;
    this.stickY = y;
  }

  /** Touch look, already in radians (positive yaw = turn right, positive pitch = look down). */
  addTouchLook(yaw: number, pitch: number): void {
    if (!this._locked || this.menu) return;
    this.touchYaw += yaw;
    this.touchPitch += pitch;
  }

  private clearTouch(): void {
    this.virtual.clear();
    this.stickX = this.stickY = 0;
    this.touchYaw = this.touchPitch = 0;
  }

  setBindings(bindings: Bindings): void {
    this.bindings = bindings;
    this.rebuildKeyMap();
  }

  isDown(action: Action): boolean {
    if (this.gameplayBlocked && !UI_ACTIONS.has(action)) return false;
    if (this.virtual.has(action)) return true;
    for (const key of this.bindings[action]) if (this.down.has(key)) return true;
    return false;
  }

  /** True once per press; call from fixed-step gameplay code. */
  wasPressed(action: Action): boolean {
    if (this.pressed.has(action)) {
      this.pressed.delete(action);
      return !this.gameplayBlocked || UI_ACTIONS.has(action);
    }
    return false;
  }

  /** Forget presses not yet consumed (e.g. the key that closed a menu shouldn't also jump). */
  clearPressed(): void {
    this.pressed.clear();
  }

  /** Peek without consuming (for UI). */
  peekPressed(action: Action): boolean {
    return this.pressed.has(action);
  }

  /** Movement axes in [-1, 1]: x = strafe right, y = forward. */
  moveAxis(): { x: number; y: number } {
    const x = (this.isDown('moveRight') ? 1 : 0) - (this.isDown('moveLeft') ? 1 : 0);
    const y = (this.isDown('moveForward') ? 1 : 0) - (this.isDown('moveBack') ? 1 : 0);
    if (this.gameplayBlocked || (this.stickX === 0 && this.stickY === 0)) return { x, y };
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    return { x: clamp(x + this.stickX), y: clamp(y + this.stickY) };
  }

  /** Returns accumulated look delta in radians and resets it. */
  consumeLook(): { yaw: number; pitch: number } {
    const out = {
      yaw: -this.lookX * this.sensitivity - this.touchYaw,
      pitch: -(this.lookY * this.sensitivity + this.touchPitch) * (this.invertY ? -1 : 1),
    };
    this.lookX = 0;
    this.lookY = 0;
    this.touchYaw = 0;
    this.touchPitch = 0;
    if (this.gameplayBlocked) out.yaw = out.pitch = 0;
    return out;
  }

  private rebuildKeyMap(): void {
    this.keyToActions.clear();
    for (const [action, keys] of Object.entries(this.bindings) as [Action, string[]][]) {
      for (const k of keys) {
        const list = this.keyToActions.get(k) ?? [];
        list.push(action);
        this.keyToActions.set(k, list);
      }
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Escape' && this.dragMode) {
      this.exitDragMode();
      return;
    }
    const actions = this.keyToActions.get(e.code);
    if (actions && this._locked) {
      // Stop the browser from scrolling / opening find bar etc. while playing.
      // (Ctrl/Cmd+W can't be blocked outside fullscreen; see README.)
      e.preventDefault();
    }
    // Always (re)mark as down, including auto-repeats: that lets keys recover
    // after the macOS Cmd quirk below wipes them.
    this.down.add(e.code);
    if (e.repeat) return;
    actions?.forEach((a) => {
      this.pressed.add(a);
      this.game.events.emit('input:pressed', { action: a });
    });
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
    // macOS does not deliver keyup for other keys while Cmd is held, so
    // anything released during a Cmd-crouch would stay stuck. Reset instead;
    // keys still held are re-added by their auto-repeat keydown.
    if (e.code === 'MetaLeft' || e.code === 'MetaRight') this.down.clear();
  };

  private onBlur = (): void => {
    this.down.clear();
    this.pressed.clear();
    this.clearTouch();
  };

  private onMouseMove = (e: MouseEvent): void => {
    // Touch mode: browsers also send emulated mouse events for taps; ignore them.
    if (!this._locked || this.touchMode) return;
    if (this.dragMode && (e.buttons & 1) === 0) return;
    this.lookX += e.movementX;
    this.lookY += e.movementY;
  };

  /** Mouse buttons act like keys named Mouse0..Mouse2, but only while playing (not on menus). */
  private onMouseDown = (e: MouseEvent): void => {
    if (!this._locked || this.menu || this.touchMode) return;
    const code = `Mouse${e.button}`;
    this.down.add(code);
    this.keyToActions.get(code)?.forEach((a) => {
      this.pressed.add(a);
      this.game.events.emit('input:pressed', { action: a });
    });
  };

  private onMouseUp = (e: MouseEvent): void => {
    this.down.delete(`Mouse${e.button}`);
  };

  private onLockError = (): void => {
    if (this.menu) return;
    if (performance.now() - this.relockFailedAt < 1000) return; // already handled
    if (this.relocking) {
      this.relockFailedAt = performance.now();
      this.relocking = false;
      this._locked = false;
      this.game.events.emit('input:pointerlock', { locked: false });
      return;
    }
    this.enterDragMode();
  };

  private onLockChange = (): void => {
    if (this.dragMode) return;
    // Leaving lock for a menu isn't a pause; the menu decides what happens on close.
    if (this.menu) return;
    this.relocking = false;
    this._locked = document.pointerLockElement != null;
    this.down.clear();
    this.pressed.clear();
    this.game.events.emit('input:pointerlock', { locked: this._locked });
  };
}
