import type { Game } from '@ingine/engine/core/Game';
import type { System } from '@ingine/engine/core/System';
import { TouchControls } from '@ingine/engine/input/TouchControls';
import type { Teleports } from './Teleports';
import type { HeroPowers } from './scenes/heroes';

/**
 * Phone buttons for the party's own keys, on top of the engine's touch
 * controls: Home (H) away from the plaza, Swing (hold G) in hero city once
 * you have it, and hold-to-talk (V) once the mic is on. Hero city's other
 * powers use the engine's own buttons: Jump in the air flies, Crouch in the
 * air slams, Attack lifts and throws.
 */
export class GeneTouch implements System {
  readonly name = 'gene-touch';

  constructor(private touch: TouchControls, private teleports: Teleports) {}

  init(game: Game): void {
    // Each world's score panel sits top centre: on phones, below the button row.
    const css = document.createElement('style');
    css.textContent = `body.touch-ui .gene-panel { top: calc(64px + env(safe-area-inset-top)) !important; font-size: 13px !important; max-width: 38vw; white-space: normal !important; text-align: center; }
      body.touch-ui .gene-alert { top: calc(128px + env(safe-area-inset-top)) !important; font-size: 12px !important; max-width: 60vw; white-space: normal !important; text-align: center; }`;
    document.head.appendChild(css);
    const t = this.touch;
    const talk = t.addButton({ label: 'Talk<small>hold</small>', key: 'KeyV' });
    const swing = t.addButton({ label: 'Swing<small>hold</small>', key: 'KeyG' });
    const home = t.addButton({ label: 'Home', key: 'KeyH' });
    talk.classList.add('hidden');
    const place = () => {
      const scene = this.teleports.current;
      const owned = game.getSystem<HeroPowers>('hero-powers')?.owned;
      home.classList.toggle('hidden', scene === 'hub');
      swing.classList.toggle('hidden', scene !== 'heroes' || !owned?.has('swing'));
    };
    place();
    game.events.on('teleport', place);
    game.events.on('heroes:power', place);
    game.events.on('voice:state', ({ mic, muted }) => talk.classList.toggle('hidden', mic !== 'on' || muted));
  }
}
