import type { Game } from '@ingine/engine/core/Game';
import type { System } from '@ingine/engine/core/System';
import { registerSounds, type AudioSystem, type MusicTrack } from '@ingine/engine/audio/AudioSystem';
import type { Footsteps, Surface } from '@ingine/engine/audio/Footsteps';
import { noise, tone } from '@ingine/engine/audio/synth';
import { sceneAt } from './scenes';

/**
 * Sound for Gene's world: pickup jingles, little world sounds, a talk blip
 * per character while they speak (old-RPG style), which ground you're
 * walking on in each world, and a quiet tune per world. All synthesised.
 */

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];
const PENTATONIC = [0, 2, 4, 7, 9];

/** One gentle tune per world. Quiet: the music bus sits well under the effects. */
export const MUSIC: Record<string, MusicTrack> = {
  hub: { id: 'hub', bpm: 104, root: 60, scale: MAJOR, progression: [0, 5, 3, 4], pad: { type: 'triangle', gain: 0.14 }, bass: { type: 'sine', gain: 0.1 }, lead: { type: 'triangle', gain: 0.05, density: 0.3, decay: 0.35 }, beat: { gain: 0.05 }, seed: 1 },
  axes: { id: 'axes', bpm: 96, root: 62, scale: DORIAN, progression: [0, 0, 6, 3], pad: { type: 'triangle', gain: 0.1, cutoff: 1200 }, bass: { type: 'triangle', gain: 0.1 }, lead: { type: 'triangle', gain: 0.05, density: 0.4, decay: 0.22 }, beat: { gain: 0.05 }, seed: 2 },
  arup: { id: 'arup', bpm: 78, root: 65, scale: MAJOR, progression: [0, 3, 1, 4], pad: { type: 'sine', gain: 0.16, cutoff: 1200, detune: 14 }, bass: { type: 'sine', gain: 0.09 }, lead: { type: 'sine', gain: 0.05, density: 0.22, decay: 0.6 }, beat: { gain: 0.04 }, seed: 3 },
  murph: { id: 'murph', bpm: 112, root: 67, scale: PENTATONIC, progression: [0, 2, 3, 1], pad: { type: 'sine', gain: 0.1 }, bass: { type: 'sine', gain: 0.09 }, lead: { type: 'triangle', gain: 0.06, density: 0.42, decay: 0.16 }, seed: 4 },
  stars: { id: 'stars', bpm: 72, root: 64, scale: LYDIAN, progression: [0, 1, 0, 4], pad: { type: 'sine', gain: 0.16, cutoff: 2500, detune: 20 }, bass: { type: 'sine', gain: 0.07 }, lead: { type: 'sine', gain: 0.05, density: 0.25, octave: 2, decay: 1.2 }, seed: 5 },
  heroes: { id: 'heroes', bpm: 120, root: 58, scale: MIXOLYDIAN, progression: [0, 6, 3, 0], pad: { type: 'sawtooth', gain: 0.07, cutoff: 900 }, bass: { type: 'triangle', gain: 0.1 }, lead: { type: 'square', gain: 0.025, density: 0.3, decay: 0.3 }, beat: { gain: 0.07 }, seed: 6 },
  buddies: { id: 'buddies', bpm: 108, root: 69, scale: MAJOR, progression: [0, 3, 4, 3], pad: { type: 'triangle', gain: 0.08 }, bass: { type: 'sine', gain: 0.09 }, lead: { type: 'triangle', gain: 0.06, density: 0.45, decay: 0.25 }, beat: { gain: 0.05 }, seed: 7 },
  tattoo: { id: 'tattoo', bpm: 84, root: 57, scale: MINOR, progression: [0, 5, 2, 6], pad: { type: 'triangle', gain: 0.12, cutoff: 1100, detune: 12 }, bass: { type: 'sine', gain: 0.1 }, lead: { type: 'triangle', gain: 0.045, density: 0.25, decay: 0.5 }, beat: { gain: 0.05 }, seed: 8 },
  // The ballpark organ.
  ballpark: { id: 'ballpark', bpm: 116, root: 60, scale: MAJOR, progression: [0, 3, 4, 0], pad: { type: 'square', gain: 0.06, cutoff: 2200 }, bass: { type: 'sine', gain: 0.08 }, lead: { type: 'square', gain: 0.03, density: 0.35, decay: 0.3 }, seed: 9 },
  hoops: { id: 'hoops', bpm: 96, root: 52, scale: DORIAN, progression: [0, 0, 3, 4], pad: { type: 'triangle', gain: 0.08, cutoff: 1000 }, bass: { type: 'sawtooth', gain: 0.06 }, lead: { type: 'square', gain: 0.025, density: 0.3, decay: 0.2 }, beat: { gain: 0.09 }, seed: 10 },
};

/** What each world's ground sounds like (scene-relative x, y, z). */
function surfaceIn(scene: string, x: number, y: number, z: number): Surface {
  switch (scene) {
    case 'axes':
      return 'wood';
    case 'arup':
      return 'carpet';
    case 'murph':
      return y > 0.3 ? 'carpet' : 'grass';
    case 'stars':
      return y > 20 ? 'snow' : 'grass';
    case 'heroes':
      return 'stone';
    case 'buddies':
      if (x < -30 && z < 0 && z > -22) return 'snow';
      if (Math.abs(x) < 9 && z < -60) return 'sand';
      if (x > 34 && z < -45 && z > -57) return 'wood';
      return 'grass';
    case 'ballpark':
      if (z > -1) return 'stone';
      if (Math.hypot(x, z + 4) < 4.2) return 'dirt';
      return 'grass';
    case 'hoops':
      return Math.abs(x) < 9.5 && Math.abs(z + 18) < 16 ? 'wood' : 'stone';
    case 'tattoo':
      return Math.abs(x) < 7 && z < 2 && z > -14 ? 'tile' : 'stone';
    default:
      return 'stone';
  }
}

/** A voice per speaker: wave shape and pitch for their talk blips. */
const VOICES: Record<string, { type: 'square' | 'triangle' | 'sine' | 'sawtooth'; hz: number }> = {
  'Big Liz': { type: 'sawtooth', hz: 110 },
  Rex: { type: 'sawtooth', hz: 150 },
  Aurora: { type: 'triangle', hz: 330 },
  Renee: { type: 'triangle', hz: 360 },
  Chris: { type: 'square', hz: 220 },
  Annie: { type: 'sine', hz: 720 },
  Nimbus: { type: 'sine', hz: 520 },
  'Captain Whiskers': { type: 'square', hz: 280 },
  Murphy: { type: 'sine', hz: 600 },
  Buddy: { type: 'square', hz: 200 },
  Molly: { type: 'triangle', hz: 260 },
};

function voiceFor(speaker: string): { type: 'square' | 'triangle' | 'sine' | 'sawtooth'; hz: number } {
  if (VOICES[speaker]) return VOICES[speaker];
  // Everyone else (cats, pups): a voice from their name, so they always sound the same.
  let h = 0;
  for (const c of speaker) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const types = ['square', 'triangle', 'sine'] as const;
  return { type: types[h % 3], hz: 260 + (h % 9) * 40 };
}

registerSounds({
  /** A Murphy coin: the classic two-note bing. */
  coin: (c, o, t, v) => {
    tone(c, o, t, { dur: 0.09, type: 'square', freq: 988, gain: 0.12 * v });
    tone(c, o, t + 0.08, { dur: 0.35, type: 'square', freq: 1319, gain: 0.12 * v });
  },
  /** A star: a quick sparkling run up. */
  star: (c, o, t, v) => {
    [784, 988, 1175, 1568, 1976].forEach((f, i) => tone(c, o, t + i * 0.055, { dur: 0.4, type: 'triangle', freq: f, gain: 0.16 * v }));
    noise(c, o, t + 0.2, { dur: 0.35, type: 'highpass', freq: 7000, gain: 0.05 * v });
  },
  /** Every star found: a little fanfare. */
  fanfare: (c, o, t, v) => {
    [523, 659, 784, 1047].forEach((f, i) => tone(c, o, t + i * 0.12, { dur: i === 3 ? 0.9 : 0.2, type: 'square', freq: f, gain: 0.1 * v }));
  },
  /** Picking up a ball or any item: a soft pop and a rising blip. */
  pickup: (c, o, t, v) => {
    noise(c, o, t, { dur: 0.04, type: 'bandpass', freq: 1500, q: 2, gain: 0.25 * v });
    tone(c, o, t, { dur: 0.14, type: 'sine', freq: 520, freqEnd: 880, gain: 0.2 * v });
  },
  /** Handing a ball back: a happy two-note "woof!" and a chime. */
  woof: (c, o, t, v, p) => {
    tone(c, o, t, { dur: 0.13, type: 'sawtooth', freq: 320 * p, freqEnd: 180 * p, gain: 0.12 * v });
    noise(c, o, t, { dur: 0.1, type: 'bandpass', freq: 900 * p, q: 1.5, gain: 0.15 * v });
    tone(c, o, t + 0.18, { dur: 0.12, type: 'sawtooth', freq: 360 * p, freqEnd: 200 * p, gain: 0.1 * v });
    [1047, 1319].forEach((f, i) => tone(c, o, t + 0.3 + i * 0.09, { dur: 0.4, type: 'triangle', freq: f, gain: 0.12 * v }));
  },
  /** A pup's excited yip (off after a ball). */
  yip: (c, o, t, v, p) => {
    tone(c, o, t, { dur: 0.08, type: 'sawtooth', freq: 620 * p, freqEnd: 420 * p, gain: 0.1 * v });
    noise(c, o, t, { dur: 0.06, type: 'bandpass', freq: 1800 * p, q: 2, gain: 0.12 * v });
  },
  /** Mission control's countdown beep (higher on the last ones). */
  beep: (c, o, t, v, p) => tone(c, o, t, { dur: 0.16, type: 'square', freq: 880 * p, gain: 0.07 * v, attack: 0.005 }),
  /** Liftoff: a long low roar. */
  liftoff: (c, o, t, v) => {
    noise(c, o, t, { dur: 6, type: 'lowpass', freq: 500, freqEnd: 180, gain: 0.5 * v, attack: 0.6 });
    tone(c, o, t, { dur: 5, type: 'sawtooth', freq: 55, freqEnd: 38, gain: 0.08 * v, attack: 0.5 });
  },
  /** The rocket coming back down: a softer roar. */
  descent: (c, o, t, v) => noise(c, o, t, { dur: 9, type: 'lowpass', freq: 220, freqEnd: 420, gain: 0.3 * v, attack: 2 }),
  /** The ghost: a wobbly "ooOOOoo". */
  boo: (c, o, t, v) => {
    tone(c, o, t, { dur: 0.9, type: 'sine', freq: 300, freqEnd: 520, gain: 0.22 * v, attack: 0.08 });
    tone(c, o, t + 0.1, { dur: 0.8, type: 'triangle', freq: 310, freqEnd: 480, gain: 0.1 * v, attack: 0.1 });
    noise(c, o, t, { dur: 0.7, type: 'bandpass', freq: 600, q: 2, gain: 0.08 * v, attack: 0.1 });
  },
  meow: (c, o, t, v, p) => tone(c, o, t, { dur: 0.35, type: 'triangle', freq: 700 * p, freqEnd: 450 * p, gain: 0.16 * v, attack: 0.05 }),
  /** A hero power: a rising whoosh and chord. */
  powerup: (c, o, t, v) => {
    noise(c, o, t, { dur: 0.5, type: 'bandpass', freq: 400, freqEnd: 3000, q: 1.5, gain: 0.15 * v, attack: 0.1 });
    [392, 523, 659, 784].forEach((f, i) => tone(c, o, t + 0.1 + i * 0.07, { dur: 0.5, type: 'square', freq: f, gain: 0.07 * v }));
  },
  /** Hero city: the swing line firing (thwip!). */
  thwip: (c, o, t, v) => {
    noise(c, o, t, { dur: 0.12, type: 'bandpass', freq: 3200, freqEnd: 1400, q: 2, gain: 0.35 * v });
    tone(c, o, t, { dur: 0.1, type: 'triangle', freq: 1400, freqEnd: 700, gain: 0.12 * v });
  },
  /** Letting go of a line, taking off: a rising whoosh. */
  whoosh: (c, o, t, v) => noise(c, o, t, { dur: 0.45, type: 'bandpass', freq: 500, freqEnd: 1800, q: 0.9, gain: 0.3 * v, attack: 0.08 }),
  /** Lifting a car: a heavy creak and grunt. */
  heave: (c, o, t, v) => {
    tone(c, o, t, { dur: 0.3, type: 'sawtooth', freq: 90, freqEnd: 140, gain: 0.12 * v, attack: 0.03 });
    noise(c, o, t, { dur: 0.25, type: 'lowpass', freq: 600, gain: 0.25 * v });
  },
  /** A car thrown: a big low whoosh. */
  hurl: (c, o, t, v) => noise(c, o, t, { dur: 0.6, type: 'bandpass', freq: 300, freqEnd: 900, q: 0.7, gain: 0.45 * v, attack: 0.04 }),
  /** The ground slam: a boom and a rumble. */
  slam: (c, o, t, v) => {
    tone(c, o, t, { dur: 0.7, type: 'sine', freq: 90, freqEnd: 32, gain: 0.6 * v, attack: 0.005 });
    noise(c, o, t, { dur: 0.9, type: 'lowpass', freq: 900, freqEnd: 150, gain: 0.55 * v, attack: 0.005 });
    noise(c, o, t, { dur: 0.15, type: 'highpass', freq: 2500, gain: 0.2 * v });
  },
  /** Hero city: an emergency call, a two-tone siren. */
  siren: (c, o, t, v) => {
    for (let i = 0; i < 4; i++) tone(c, o, t + i * 0.32, { dur: 0.3, type: 'square', freq: i % 2 ? 660 : 880, gain: 0.05 * v, attack: 0.02 });
  },
  /** The runaway bus: a long horn. */
  horn: (c, o, t, v) => {
    tone(c, o, t, { dur: 0.9, type: 'sawtooth', freq: 220, gain: 0.08 * v, attack: 0.02 });
    tone(c, o, t, { dur: 0.9, type: 'sawtooth', freq: 277, gain: 0.06 * v, attack: 0.02 });
  },
  /** Something big stopping hard: a crunch. */
  crunch: (c, o, t, v) => {
    noise(c, o, t, { dur: 0.4, type: 'lowpass', freq: 1800, freqEnd: 300, gain: 0.5 * v });
    tone(c, o, t, { dur: 0.3, type: 'triangle', freq: 120, freqEnd: 50, gain: 0.3 * v });
  },
  boing: (c, o, t, v) => tone(c, o, t, { dur: 0.45, type: 'triangle', freq: 180, freqEnd: 720, gain: 0.25 * v }),
  /** The net: a soft swish. */
  swish: (c, o, t, v) => noise(c, o, t, { dur: 0.35, type: 'bandpass', freq: 2500, freqEnd: 900, q: 0.7, gain: 0.3 * v, attack: 0.04 }),
  /** Wood on leather: crack! */
  crack: (c, o, t, v) => {
    noise(c, o, t, { dur: 0.06, type: 'highpass', freq: 2000, gain: 0.5 * v });
    tone(c, o, t, { dur: 0.12, type: 'triangle', freq: 900, freqEnd: 400, gain: 0.25 * v });
  },
  /** The crowd goes wild (a homer, a three, a bullseye). */
  cheer: (c, o, t, v) => {
    noise(c, o, t, { dur: 1.6, type: 'bandpass', freq: 1100, freqEnd: 900, q: 0.5, gain: 0.22 * v, attack: 0.25 });
    noise(c, o, t + 0.1, { dur: 1.2, type: 'bandpass', freq: 2400, q: 0.8, gain: 0.08 * v, attack: 0.2 });
  },
  /** A miss or a strike: a soft low "bwomp". */
  aww: (c, o, t, v) => tone(c, o, t, { dur: 0.4, type: 'triangle', freq: 300, freqEnd: 200, gain: 0.12 * v, attack: 0.03 }),
  /** The tattoo needle: a buzzy hum (one second; the parlour plays three). */
  buzz: (c, o, t, v) => {
    tone(c, o, t, { dur: 1.0, type: 'sawtooth', freq: 120, gain: 0.05 * v, attack: 0.05 });
    tone(c, o, t, { dur: 1.0, type: 'square', freq: 241, gain: 0.025 * v, attack: 0.05 });
  },
  /** Done, success: a bright chime. */
  chime: (c, o, t, v) => [1047, 1319, 1568].forEach((f, i) => tone(c, o, t + i * 0.08, { dur: 0.7, type: 'sine', freq: f, gain: 0.14 * v })),
  /** Talk blips, one per wave shape. `pitch` carries the voice's note. */
  blip_square: (c, o, t, v, p) => tone(c, o, t, { dur: 0.05, type: 'square', freq: p, gain: 0.05 * v, attack: 0.002 }),
  blip_triangle: (c, o, t, v, p) => tone(c, o, t, { dur: 0.055, type: 'triangle', freq: p, gain: 0.11 * v, attack: 0.002 }),
  blip_sine: (c, o, t, v, p) => tone(c, o, t, { dur: 0.06, type: 'sine', freq: p, gain: 0.13 * v, attack: 0.002 }),
  blip_sawtooth: (c, o, t, v, p) => tone(c, o, t, { dur: 0.05, type: 'sawtooth', freq: p, gain: 0.05 * v, attack: 0.002 }),
});

export class GeneAudio implements System {
  readonly name = 'gene-audio';
  private audio!: AudioSystem;
  /** Talk blips played (for checks). */
  blips = 0;
  private sfxBtn: HTMLButtonElement | null = null;
  private musicBtn: HTMLButtonElement | null = null;

  constructor(private container: HTMLElement) {}

  init(game: Game): void {

    this.audio = game.getSystem<AudioSystem>('audio')!;
    const steps = game.getSystem<Footsteps>('footsteps');
    if (steps)
      steps.surfaceAt = (p) => {
        const s = sceneAt(p.x, p.z);
        return surfaceIn(s.id, p.x - s.origin[0], p.y - s.origin[1], p.z - s.origin[2]);
      };
    const ev = game.events;
    const play = (name: string, volume = 1, pitch = 1) => this.audio.play(name, { volume, pitch });
    ev.on('teleport', ({ scene }) => this.audio.music(MUSIC[scene] ?? MUSIC.hub));
    this.audio.music(MUSIC.hub);
    // Pickups.
    ev.on('murph:coin', () => play('coin'));
    ev.on('stars:star', ({ found, total }) => (found >= total ? (play('star'), this.audio.play('fanfare', { delay: 0.5 })) : play('star')));
    ev.on('stars:bounce', () => play('boing'));
    ev.on('buddies:ball', ({ state }) => (state === 'carried' ? play('pickup') : play('woof', 1, 0.9 + Math.random() * 0.25)));
    ev.on('buddies:fetch', ({ phase }) => (phase === 'throw' ? (play('whoosh', 0.5, 1.4), play('yip', 1, 0.9 + Math.random() * 0.3)) : phase === 'catch' ? play('yip', 0.9, 1.2) : phase === 'drop' ? play('woof', 0.8, 0.9 + Math.random() * 0.25) : play('yip', 0.7, 1.1)));
    ev.on('buddies:rocket', ({ phase, n }) => {
      if (phase === 'count') play('beep', 1, n !== undefined && n <= 3 ? 1.5 : 1);
      else if (phase === 'liftoff') (play('beep', 1, 2), play('liftoff'));
      else if (phase === 'descent') play('descent');
      else if (phase === 'landed') this.audio.play('fanfare', { delay: 0.3 });
    });
    ev.on('buddies:boo', () => play('boo'));
    ev.on('heroes:kitten', () => (play('pickup'), play('meow', 0.9, 0.9 + Math.random() * 0.3)));
    ev.on('heroes:power', () => play('powerup'));
    ev.on('heroes:swing', ({ on }) => (on ? play('thwip', 1, 0.9 + Math.random() * 0.2) : play('whoosh', 0.6)));
    ev.on('heroes:fly', ({ on }) => on && play('whoosh', 0.8, 0.8));
    ev.on('heroes:lift', () => play('heave'));
    ev.on('heroes:throw', () => play('hurl'));
    ev.on('heroes:alert', () => play('siren'));
    ev.on('heroes:saved', () => (play('chime'), play('cheer', 0.6)));
    ev.on('heroes:failed', () => play('aww'));
    ev.on('heroes:catch', () => (play('pickup'), play('meow', 0.9, 1.1)));
    ev.on('heroes:kittenFall', () => play('meow', 1, 1.4));
    ev.on('heroes:ring', ({ n }) => play('pickup', 0.8, 1 + n * 0.05));
    ev.on('heroes:busGo', () => play('horn'));
    ev.on('heroes:busStop', () => play('crunch'));
    ev.on('heroes:slam', ({ strength }) => play('slam', 0.6 + 0.4 * strength));
    ev.on('state:changed', ({ kind }) => kind === 'item' && play('pickup', 0.6));
    // Games.
    ev.on('axes:scored', ({ points }) => points >= 5 && play('cheer', 0.5));
    ev.on('ballpark:contact', ({ quality }) => play('crack', 0.6 + 0.4 * quality));
    ev.on('ballpark:result', ({ result }) => (result === 'homer' ? play('cheer') : result === 'strike' ? play('aww') : undefined));
    ev.on('hoops:score', ({ points }) => (play('swish'), points === 3 && play('cheer', 0.7)));
    ev.on('tattoo:start', () => [0, 1, 2].forEach((k) => this.audio.play('buzz', { delay: k })));
    ev.on('tattoo:done', () => play('chime'));
    // Talk blips: every other letter, skipping spaces and punctuation, a little tune per voice.
    ev.on('dialogue:char', ({ speaker, char, index }) => {
      if (index % 2 === 1 || !/[\p{L}\p{N}]/u.test(char)) return;
      const voice = voiceFor(speaker);
      const steps = [1, 1.122, 1.26, 0.891];
      this.blips++;
      this.audio.play(`blip_${voice.type}`, { volume: 0.8, pitch: voice.hz * steps[char.charCodeAt(0) % steps.length] });
    });
    this.addMenuButtons();
  }

  /** Esc menu: sound and music on/off (remembered in this browser). */
  private addMenuButtons(): void {
    const panel = this.container.querySelector('.overlay .panel');
    const anchor = panel?.querySelector('.fullscreen-btn');
    if (!panel || !anchor) return;
    const make = (cls: string, onClick: () => void) => {
      const b = document.createElement('button');
      b.className = cls;
      Object.assign(b.style, { display: 'inline-block', margin: '6px 4px 0', padding: '6px 12px', border: '0', borderRadius: '8px', background: '#3d4a66', color: '#fff', font: '600 14px system-ui, sans-serif', cursor: 'pointer' });
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
        this.refresh();
      });
      anchor.insertAdjacentElement('afterend', b);
      return b;
    };
    this.musicBtn = make('music-btn', () => {
      this.audio.start();
      this.audio.setMusic(!this.audio.musicOn);
    });
    this.sfxBtn = make('sfx-btn', () => {
      this.audio.start();
      this.audio.setSfx(!this.audio.sfxOn);
    });
    this.refresh();
  }

  private refresh(): void {
    if (this.sfxBtn) this.sfxBtn.textContent = `Sound: ${this.audio.sfxOn ? 'on' : 'off'}`;
    if (this.musicBtn) this.musicBtn.textContent = `Music: ${this.audio.musicOn ? 'on' : 'off'}`;
  }
}

