/**
 * Logical actions -> physical keys (KeyboardEvent.code, or Mouse0-2 for buttons). Gameplay code only
 * ever asks about actions, never raw keys, so rebinding / gamepad support is
 * a change here and in InputManager only.
 */
/**
 * Every logical action. A game adds its own by augmenting this interface and
 * binding keys with `game.input.setBindings({ ...defaultBindings, castSpell: ['KeyQ'] })`:
 *
 *   declare module '@ingine/engine/config/bindings' { interface ActionMap { castSpell: true } }
 */
export interface ActionMap {
  moveForward: true;
  moveBack: true;
  moveLeft: true;
  moveRight: true;
  jump: true;
  sprint: true;
  crouch: true;
  interact: true;
  attack: true;
  altAttack: true;
  reload: true;
  cycleAmmo: true;
  slot1: true;
  slot2: true;
  slot3: true;
  slot4: true;
  inventory: true;
  quickSave: true;
  quickLoad: true;
  toggleDebug: true;
  /** A level's map screen, if it has one. */
  toggleMap: true;
  toggleFullscreen: true;
  respawn: true;
}

export type Action = keyof ActionMap & string;

export type Bindings = Record<Action, string[]>;

export const defaultBindings: Bindings = {
  moveForward: ['KeyW', 'ArrowUp'],
  moveBack: ['KeyS', 'ArrowDown'],
  moveLeft: ['KeyA', 'ArrowLeft'],
  moveRight: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  // Ctrl / Cmd as requested, plus C as a safe alternative (see README: browsers
  // reserve Ctrl/Cmd+W to close the tab unless the game is fullscreen).
  crouch: ['ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight', 'KeyC'],
  interact: ['KeyE'],
  // Mouse buttons are reported as Mouse0 (left), Mouse1 (middle), Mouse2 (right).
  attack: ['Mouse0'],
  /** Aim down sights, guard (melee weapons and fists), or a weapon's secondary mode. */
  altAttack: ['Mouse2'],
  reload: ['KeyR'],
  cycleAmmo: ['KeyT'],
  // Weapon slots: your first four weapons, in the order you picked them up. Press again to put it away.
  slot1: ['Digit1'],
  slot2: ['Digit2'],
  slot3: ['Digit3'],
  slot4: ['Digit4'],
  inventory: ['Tab', 'KeyI'],
  quickSave: ['F5'],
  quickLoad: ['F9'],
  toggleDebug: ['Backquote', 'F3'],
  toggleMap: ['KeyM'],
  toggleFullscreen: ['KeyF'],
  // R is reload now; respawning (getting unstuck) moved to Backspace.
  respawn: ['Backspace'],
};
