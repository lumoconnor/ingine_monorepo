/**
 * Something a switch can drive: a door, a lift, later a drawbridge or a trap.
 * Switches only know this interface, so new kinds of machinery need no
 * changes to the switch code.
 */
export interface Activatable {
  /** Toggle by default; 'on' / 'off' force a state. `user` lets doors swing away from whoever opened them. */
  activate(command?: 'toggle' | 'on' | 'off', user?: { object3d: { position: { x: number; y: number; z: number } } }): void;
  /** True when on (door open / lift at its far stop). */
  readonly isOn: boolean;
  /** True while moving between states. */
  readonly busy: boolean;
}
