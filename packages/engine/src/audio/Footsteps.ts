import type { Game } from '../core/Game';
import type { System } from '../core/System';
import { PlayerController } from '../gameplay/player/PlayerController';
import { registerSounds, type AudioSystem } from './AudioSystem';
import { noise, tone } from './synth';

/** What you can be walking on. Games map the ground under you to one of these with `surfaceAt`. */
export type Surface = 'stone' | 'grass' | 'wood' | 'carpet' | 'tile' | 'metal' | 'dirt' | 'snow' | 'sand';

/**
 * Footstep sounds: a soft heel, a scuff and a little body for each surface.
 * `v` is loudness, `pitch` nudges each step so a walk never sounds looped.
 */
registerSounds({
  step_stone: (c, o, t, v, p) => {
    noise(c, o, t, { dur: 0.07, type: 'bandpass', freq: 1900 * p, q: 1.4, gain: 0.32 * v });
    tone(c, o, t, { dur: 0.06, type: 'sine', freq: 120 * p, freqEnd: 70, gain: 0.25 * v });
  },
  step_tile: (c, o, t, v, p) => {
    noise(c, o, t, { dur: 0.05, type: 'bandpass', freq: 2600 * p, q: 2, gain: 0.3 * v });
    tone(c, o, t, { dur: 0.05, type: 'triangle', freq: 340 * p, freqEnd: 220, gain: 0.12 * v });
  },
  step_wood: (c, o, t, v, p) => {
    tone(c, o, t, { dur: 0.09, type: 'triangle', freq: 190 * p, freqEnd: 120, gain: 0.32 * v });
    noise(c, o, t, { dur: 0.06, type: 'bandpass', freq: 1200 * p, q: 1.2, gain: 0.2 * v });
  },
  step_grass: (c, o, t, v, p) => {
    noise(c, o, t, { dur: 0.12, type: 'bandpass', freq: 3200 * p, freqEnd: 1800, q: 0.8, gain: 0.22 * v, attack: 0.015 });
    tone(c, o, t, { dur: 0.06, type: 'sine', freq: 95 * p, freqEnd: 60, gain: 0.18 * v });
  },
  step_dirt: (c, o, t, v, p) => {
    noise(c, o, t, { dur: 0.1, type: 'lowpass', freq: 1400 * p, q: 0.7, gain: 0.3 * v, attack: 0.01 });
    tone(c, o, t, { dur: 0.06, type: 'sine', freq: 100 * p, freqEnd: 60, gain: 0.2 * v });
  },
  step_sand: (c, o, t, v, p) => noise(c, o, t, { dur: 0.14, type: 'lowpass', freq: 2400 * p, freqEnd: 900, q: 0.6, gain: 0.25 * v, attack: 0.02 }),
  step_snow: (c, o, t, v, p) => {
    noise(c, o, t, { dur: 0.16, type: 'bandpass', freq: 900 * p, freqEnd: 600, q: 1.5, gain: 0.3 * v, attack: 0.03 });
    noise(c, o, t + 0.03, { dur: 0.08, type: 'highpass', freq: 4000, gain: 0.08 * v });
  },
  step_carpet: (c, o, t, v, p) => {
    noise(c, o, t, { dur: 0.08, type: 'lowpass', freq: 700 * p, q: 0.6, gain: 0.25 * v, attack: 0.012 });
    tone(c, o, t, { dur: 0.05, type: 'sine', freq: 85 * p, freqEnd: 60, gain: 0.15 * v });
  },
  step_metal: (c, o, t, v, p) => {
    for (const [f, g] of [[520, 0.12], [1180, 0.07], [2050, 0.04]]) tone(c, o, t, { dur: 0.16, type: 'triangle', freq: f * p, gain: g * v });
    noise(c, o, t, { dur: 0.04, type: 'highpass', freq: 3000, gain: 0.15 * v });
  },
  /** Leaving the ground: a short cloth-and-breath push. */
  jump: (c, o, t, v) => noise(c, o, t, { dur: 0.12, type: 'bandpass', freq: 700, freqEnd: 1300, q: 0.8, gain: 0.14 * v }),
  /** Landing: a thud that grows with the drop. */
  land: (c, o, t, v) => {
    tone(c, o, t, { dur: 0.14, type: 'sine', freq: 110, freqEnd: 45, gain: 0.45 * v });
    noise(c, o, t, { dur: 0.1, type: 'lowpass', freq: 900, gain: 0.3 * v });
  },
  swim: (c, o, t, v, p) => noise(c, o, t, { dur: 0.25, type: 'bandpass', freq: 800 * p, freqEnd: 400, q: 0.9, gain: 0.25 * v, attack: 0.04 }),
});

/**
 * Plays the player's footsteps: one every stride while walking on the
 * ground (quicker, louder strides when sprinting, softer when crouched),
 * a push when you jump and a thud when you land. The ground sound comes
 * from `surfaceAt` (set by the game; 'stone' by default). Needs an
 * AudioSystem ('audio').
 */
export class Footsteps implements System {
  readonly name = 'footsteps';
  private game!: Game;
  private audio: AudioSystem | null = null;
  private walked = 0;
  private left = false;
  private swimT = 0;
  /** Steps taken (for checks). */
  steps = 0;
  /** Metres per step while walking (sprinting stretches it). */
  stride = 1.8;
  surfaceAt: (feet: { x: number; y: number; z: number }) => Surface = () => 'stone';

  init(game: Game): void {
    this.game = game;
    this.audio = game.getSystem<AudioSystem>('audio') ?? null;
    game.events.on('player:jumped', () => this.audio?.play('jump', { volume: 0.8 }));
    game.events.on('player:landed', ({ fallSpeed }) => {
      if (fallSpeed < 2.5) return;
      const v = Math.min(1, 0.25 + fallSpeed / 14);
      this.audio?.play('land', { volume: v });
      // The ground you land on, too.
      const ctrl = this.player();
      if (ctrl) this.audio?.play(`step_${this.surfaceAt(ctrl.feetPosition)}`, { volume: v });
      this.walked = 0;
    });
  }

  private player(): PlayerController | undefined {
    return this.game.world.find('player')?.get(PlayerController);
  }

  postFixedUpdate(dt: number): void {
    const ctrl = this.player();
    if (!ctrl || !this.audio) return;
    if (ctrl.swimming) {
      const sp = Math.hypot(ctrl.velocity.x, ctrl.velocity.z);
      this.swimT += dt * Math.min(1, sp / 2);
      if (this.swimT > 0.7) {
        this.swimT = 0;
        this.audio.play('swim', { volume: 0.6, pitch: 0.9 + Math.random() * 0.2 });
      }
      return;
    }
    const onLadder = !!ctrl.ladder;
    if ((!ctrl.grounded && !onLadder) || ctrl.zipline) return;
    const speed = onLadder ? Math.abs(ctrl.velocity.y) : Math.hypot(ctrl.velocity.x, ctrl.velocity.z);
    if (speed < 0.4) {
      // Standing still: the next step comes as soon as you move.
      this.walked = Math.max(this.walked, this.stride * 0.6);
      return;
    }
    this.walked += speed * dt;
    const stride = onLadder ? 0.5 : ctrl.sprinting ? this.stride * 1.3 : this.stride;
    if (this.walked < stride) return;
    this.walked = 0;
    this.left = !this.left;
    this.steps++;
    const surface: Surface = onLadder ? 'metal' : this.surfaceAt(ctrl.feetPosition);
    const v = (ctrl.crouched ? 0.35 : ctrl.sprinting ? 0.85 : 0.6) * (onLadder ? 0.7 : 1);
    this.audio.play(`step_${surface}`, { volume: v, pitch: (this.left ? 0.96 : 1.04) * (0.95 + Math.random() * 0.1) });
  }
}
