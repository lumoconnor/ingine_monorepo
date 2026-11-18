import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { System } from '../core/System';
import { midiHz, noise, pad, tone } from './synth';

/**
 * A sound: schedule it at time `t` into `out`. `v` is loudness 0..1 and
 * `pitch` a playback-rate style multiplier (1 = as written).
 */
export type SoundVoice = (ctx: BaseAudioContext, out: AudioNode, t: number, v: number, pitch: number) => void;

const sounds: Record<string, SoundVoice> = {};

/** Add (or replace) named sounds. Games register theirs at start-up; the engine registers footsteps. */
export function registerSounds(defs: Record<string, SoundVoice>): void {
  Object.assign(sounds, defs);
}

export function hasSound(name: string): boolean {
  return name in sounds;
}

/**
 * Background music, generated as it plays: a slow chord pad, a bass note on
 * the strong beats and a sparse melody picked from the scale, so a track is
 * a handful of numbers rather than a file. Deterministic per track (seeded),
 * with a little variation bar to bar.
 */
export interface MusicTrack {
  id: string;
  bpm: number;
  /** Root note (MIDI number, 60 = middle C). */
  root: number;
  /** The scale, in semitones above the root (e.g. major [0,2,4,5,7,9,11]). */
  scale: number[];
  /** Chord per bar: scale degree (0-based) the chord is built on. Loops. */
  progression: number[];
  pad?: { type: OscillatorType; gain: number; cutoff?: number; detune?: number };
  bass?: { type: OscillatorType; gain: number };
  /** Melody: chance per eighth note, octaves above the root, how long notes ring. */
  lead?: { type: OscillatorType; gain: number; density: number; octave?: number; decay?: number };
  /** A soft pulse: a muted kick on beats one and three and a quiet shaker. */
  beat?: { gain: number };
  seed?: number;
}

const _cam = new THREE.Vector3();
const _right = new THREE.Vector3();
const _to = new THREE.Vector3();

interface Playing {
  track: MusicTrack;
  bus: GainNode;
  next: number;
  step: number;
  rand: () => number;
}

/**
 * The engine's sound system: one audio context (created on the first click
 * or key press, as browsers require), a bus for effects and one for music,
 * named synthesised sounds with simple distance and left/right placement,
 * and the background-music player. Without WebAudio everything is a no-op,
 * though `played` still counts (for the checks).
 */
export class AudioSystem implements System {
  readonly name = 'audio';
  ctx: AudioContext | null = null;
  private game!: Game;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  /** How many times each sound was asked for (for checks; counts even with no audio). */
  played: Record<string, number> = {};
  /** Sounds that threw while being scheduled (a bad sound never stops the game). */
  errors = 0;
  /** The track asked for (playing once audio has started). */
  musicId: string | null = null;
  private wanted: MusicTrack | null = null;
  private playing: Playing | null = null;
  private fading: Playing[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  sfxVolume = 0.7;
  musicVolume = 0.32;
  sfxOn = true;
  musicOn = true;
  /** Sounds further than this (m) from the camera are silent. */
  hearing = 40;

  constructor(private storageKey = 'ingine.audio') {}

  init(game: Game): void {
    this.game = game;
    try {
      const s = JSON.parse(localStorage.getItem(this.storageKey) ?? '{}');
      if (typeof s.sfx === 'boolean') this.sfxOn = s.sfx;
      if (typeof s.music === 'boolean') this.musicOn = s.music;
    } catch {
      /* no saved settings */
    }
    const start = () => this.start();
    window.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', start, { once: true });
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    void this.ctx?.close();
  }

  /** Create the audio context (needs a user gesture in browsers). */
  start(): void {
    if (this.ctx) return;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = this.sfxOn ? this.sfxVolume : 0;
      this.sfxBus.connect(comp);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.musicOn ? this.musicVolume : 0;
      this.musicBus.connect(comp);
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      this.timer = setInterval(() => this.schedule(), 50);
      if (this.wanted) this.begin(this.wanted);
    } catch {
      this.ctx = null;
    }
  }

  private save(): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify({ sfx: this.sfxOn, music: this.musicOn }));
    } catch {
      /* private window: settings last this visit */
    }
  }

  /** Every registered sound's name. */
  get soundNames(): string[] {
    return Object.keys(sounds);
  }

  setSfx(on: boolean): void {
    this.sfxOn = on;
    this.sfxBus?.gain.setTargetAtTime(on ? this.sfxVolume : 0, this.ctx!.currentTime, 0.05);
    this.save();
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    this.musicBus?.gain.setTargetAtTime(on ? this.musicVolume : 0, this.ctx!.currentTime, 0.3);
    this.save();
  }

  /**
   * Play a named sound now. `at` places it in the world: quieter with
   * distance from the camera, and panned left or right.
   */
  play(name: string, o: { volume?: number; pitch?: number; at?: { x: number; y: number; z: number }; delay?: number } = {}): void {
    this.played[name] = (this.played[name] ?? 0) + 1;
    const voice = sounds[name];
    const ctx = this.ctx;
    if (!voice || !ctx || !this.sfxBus || !this.sfxOn) return;
    let v = o.volume ?? 1;
    let out: AudioNode = this.sfxBus;
    if (o.at) {
      const cam = this.game.renderer.camera;
      cam.getWorldPosition(_cam);
      _to.set(o.at.x - _cam.x, o.at.y - _cam.y, o.at.z - _cam.z);
      const d = _to.length();
      if (d > this.hearing) return;
      v *= Math.pow(1 - d / this.hearing, 1.6);
      if (d > 0.5 && ctx.createStereoPanner) {
        _right.set(1, 0, 0).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
        const p = ctx.createStereoPanner();
        p.pan.value = THREE.MathUtils.clamp(_to.normalize().dot(_right), -1, 1) * 0.8;
        p.connect(this.sfxBus);
        out = p;
      }
    }
    if (v < 0.01) return;
    try {
      voice(ctx, out, ctx.currentTime + 0.005 + (o.delay ?? 0), v, o.pitch ?? 1);
    } catch {
      this.errors++;
    }
  }

  /** Switch the background music (crossfades). null for silence. */
  music(track: MusicTrack | null): void {
    if (track?.id === this.musicId) return;
    this.musicId = track?.id ?? null;
    this.wanted = track;
    if (!this.ctx) return;
    if (this.playing) {
      const old = this.playing;
      old.bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.6);
      this.fading.push(old);
      setTimeout(() => {
        old.bus.disconnect();
        this.fading = this.fading.filter((f) => f !== old);
      }, 4000);
      this.playing = null;
    }
    if (track) this.begin(track);
  }

  private begin(track: MusicTrack): void {
    const ctx = this.ctx!;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0, ctx.currentTime);
    bus.gain.setTargetAtTime(1, ctx.currentTime + 0.2, 0.8);
    bus.connect(this.musicBus!);
    let s = (track.seed ?? 40) * 9973 + 7;
    const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
    this.playing = { track, bus, next: ctx.currentTime + 0.3, step: 0, rand };
  }

  /** Schedule the next quarter second of music (runs on a timer, so it keeps time while the game is paused). */
  private schedule(): void {
    const ctx = this.ctx;
    const p = this.playing;
    if (!ctx || !p) return;
    const eighth = 60 / p.track.bpm / 2;
    // Fell behind (tab in the background): skip ahead rather than play a burst.
    if (p.next < ctx.currentTime - 0.2) p.next = ctx.currentTime + 0.05;
    while (p.next < ctx.currentTime + 0.25) {
      this.playStep(p, p.next, eighth);
      p.step++;
      p.next += eighth;
    }
  }

  private playStep(p: Playing, t: number, eighth: number): void {
    const ctx = this.ctx!;
    const tr = p.track;
    const n = tr.scale.length;
    const noteOf = (deg: number) => tr.root + 12 * Math.floor(deg / n) + tr.scale[((deg % n) + n) % n];
    const inBar = p.step % 8;
    const bar = Math.floor(p.step / 8);
    const chordDeg = tr.progression[bar % tr.progression.length];
    const chord = [chordDeg, chordDeg + 2, chordDeg + 4];
    const out = p.bus;
    if (inBar === 0 && tr.pad) {
      for (const d of chord)
        pad(ctx, out, t, { dur: eighth * 8 + 0.3, type: tr.pad.type, freq: midiHz(noteOf(d)), gain: tr.pad.gain / 3, attack: eighth * 2, release: eighth * 3, detune: tr.pad.detune ?? 8, cutoff: tr.pad.cutoff ?? 1800 });
    }
    if (tr.bass && (inBar === 0 || inBar === 4)) {
      const f = midiHz(noteOf(chordDeg) - 12);
      tone(ctx, out, t, { dur: eighth * 3, type: tr.bass.type, freq: f, gain: tr.bass.gain, attack: 0.01 });
    }
    if (tr.lead && inBar !== 0 && p.rand() < tr.lead.density) {
      // Mostly chord tones, sometimes a passing note; lands on the chord.
      const pick = p.rand() < 0.7 ? chord[Math.floor(p.rand() * 3)] : chordDeg + Math.floor(p.rand() * 6);
      const f = midiHz(noteOf(pick) + 12 * (tr.lead.octave ?? 1));
      tone(ctx, out, t, { dur: tr.lead.decay ?? eighth * 2.5, type: tr.lead.type, freq: f, gain: tr.lead.gain, attack: 0.006 });
    }
    if (tr.beat) {
      if (inBar === 0 || inBar === 4) tone(ctx, out, t, { dur: 0.18, type: 'sine', freq: 90, freqEnd: 45, gain: tr.beat.gain });
      if (inBar % 2 === 1) noise(ctx, out, t, { dur: 0.05, type: 'highpass', freq: 6000, gain: tr.beat.gain * 0.35 });
    }
  }
}
