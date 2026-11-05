/**
 * Logical actions -> physical keys (KeyboardEvent.code, or Mouse0-2 for buttons). Gameplay code only
 * ever asks about actions, never raw keys, so rebinding / gamepad support is
 * a change here and in InputManager only.
 */
export type Action =
  | 'moveForward'
  | 'moveBack'
  | 'moveLeft'
  | 'moveRight'
  | 'jump'
  | 'sprint'
  | 'crouch'
  | 'interact'
  | 'attack'
  | 'altAttack'
  | 'reload'
  | 'cycleAmmo'
  | 'slot1'
  | 'slot2'
  | 'slot3'
  | 'slot4'
  | 'inventory'
  | 'quickSave'
  | 'quickLoad'
  | 'toggleDebug'
  | 'toggleFullscreen'
  | 'respawn';

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
  toggleFullscreen: ['KeyF'],
  // R is reload now; respawning (getting unstuck) moved to Backspace.
  respawn: ['Backspace'],
};
