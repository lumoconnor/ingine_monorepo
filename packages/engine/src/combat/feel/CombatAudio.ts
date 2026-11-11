import * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { System } from '../../core/System';
import type { Entity } from '../../entities/Entity';
import { Items } from '../../inventory/catalog';

const _p = new THREE.Vector3();
const _r = new THREE.Vector3();

type Voice = (ctx: AudioContext, out: AudioNode, t: number, v: number) => void;

/** Pitch of the sound being made (set per play: no two swings or shots sound quite alike). */
let PITCH = 1;

/** A burst of white noise through a filter, with a fast attack and an exponential tail. */
function noise(ctx: AudioContext, out: AudioNode, t: number, o: { dur: number; type: BiquadFilterType; freq: number; freqEnd?: number; q?: number; gain: number }): void {
  const n = Math.ceil(ctx.sampleRate * o.dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = o.type;
  f.frequency.setValueAtTime(o.freq * PITCH, t);
  if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd * PITCH, t + o.dur);
  f.Q.value = o.q ?? 1;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(f).connect(g).connect(out);
  src.start(t);
  src.stop(t + o.dur + 0.05);
}

/** A decaying tone (thumps, twangs, rings). */
function tone(ctx: AudioContext, out: AudioNode, t: number, o: { dur: number; type: OscillatorType; freq: number; freqEnd?: number; gain: number }): void {
  const osc = ctx.createOscillator();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.freq * PITCH, t);
  if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd * PITCH, t + o.dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + o.dur + 0.05);
}

/** Every combat sound, synthesised (no audio files to ship). `v` is loudness 0..1. */
export const Sounds: Record<string, Voice> = {
  swing: (c, o, t, v) => noise(c, o, t, { dur: 0.18, type: 'bandpass', freq: 500, freqEnd: 1800, q: 1.2, gain: 0.35 * v }),
  /** A heavy blade coming down: lower, longer, with some weight under it. */
  swing_heavy: (c, o, t, v) => {
    noise(c, o, t, { dur: 0.3, type: 'bandpass', freq: 320, freqEnd: 1300, q: 1.1, gain: 0.5 * v });
    tone(c, o, t, { dur: 0.22, type: 'sine', freq: 90, freqEnd: 55, gain: 0.25 * v });
  },
  /** A fist or a thrown thing: short and soft. */
  swing_light: (c, o, t, v) => noise(c, o, t, { dur: 0.1, type: 'bandpass', freq: 900, freqEnd: 2000, q: 0.9, gain: 0.22 * v }),
  /** The effort before a blow: cloth and breath as the arm draws back. */
  effort: (c, o, t, v) => noise(c, o, t, { dur: 0.14, type: 'lowpass', freq: 520, freqEnd: 260, gain: 0.16 * v }),
  punch: (c, o, t, v) => tone(c, o, t, { dur: 0.1, type: 'sine', freq: 140, freqEnd: 60, gain: 0.6 * v }),
  flesh: (c, o, t, v) => {
    tone(c, o, t, { dur: 0.14, type: 'sine', freq: 110, freqEnd: 50, gain: 0.7 * v });
    noise(c, o, t, { dur: 0.08, type: 'lowpass', freq: 1400, gain: 0.3 * v });
  },
  straw: (c, o, t, v) => noise(c, o, t, { dur: 0.12, type: 'highpass', freq: 1800, gain: 0.3 * v }),
  clang: (c, o, t, v) => {
    for (const [f, g] of [[620, 0.25], [1430, 0.18], [2310, 0.12], [3170, 0.08]]) tone(c, o, t, { dur: 0.35, type: 'triangle', freq: f * (0.98 + Math.random() * 0.04), gain: g * v });
    noise(c, o, t, { dur: 0.05, type: 'highpass', freq: 3000, gain: 0.2 * v });
  },
  parry: (c, o, t, v) => {
    for (const [f, g] of [[880, 0.3], [1760, 0.2], [2640, 0.14], [3960, 0.08]]) tone(c, o, t, { dur: 0.7, type: 'sine', freq: f, gain: g * v });
    noise(c, o, t, { dur: 0.06, type: 'highpass', freq: 2500, gain: 0.35 * v });
  },
  pistol: (c, o, t, v) => {
    noise(c, o, t, { dur: 0.28, type: 'lowpass', freq: 5000, freqEnd: 400, gain: 0.8 * v });
    tone(c, o, t, { dur: 0.12, type: 'sine', freq: 160, freqEnd: 50, gain: 0.6 * v });
  },
  musket: (c, o, t, v) => {
    noise(c, o, t, { dur: 0.05, type: 'highpass', freq: 2500, gain: 0.25 * v }); // the flint and pan
    noise(c, o, t + 0.05, { dur: 0.75, type: 'lowpass', freq: 3000, freqEnd: 150, gain: 1.0 * v });
    tone(c, o, t + 0.05, { dur: 0.3, type: 'sine', freq: 100, freqEnd: 35, gain: 0.8 * v });
  },
  bow: (c, o, t, v) => {
    tone(c, o, t, { dur: 0.16, type: 'triangle', freq: 220, freqEnd: 120, gain: 0.35 * v });
    noise(c, o, t, { dur: 0.22, type: 'bandpass', freq: 900, freqEnd: 400, q: 2, gain: 0.15 * v });
  },
  /** Shot or arrow into wood, earth, stone, metal. */
  hit_wood: (c, o, t, v) => {
    tone(c, o, t, { dur: 0.08, type: 'triangle', freq: 260, freqEnd: 120, gain: 0.3 * v });
    noise(c, o, t, { dur: 0.05, type: 'bandpass', freq: 1800, q: 2, gain: 0.2 * v });
  },
  hit_dirt: (c, o, t, v) => noise(c, o, t, { dur: 0.12, type: 'lowpass', freq: 700, freqEnd: 200, gain: 0.4 * v }),
  hit_stone: (c, o, t, v) => {
    noise(c, o, t, { dur: 0.06, type: 'highpass', freq: 2200, gain: 0.28 * v });
    tone(c, o, t, { dur: 0.05, type: 'square', freq: 900, freqEnd: 500, gain: 0.07 * v });
  },
  hit_metal: (c, o, t, v) => {
    for (const [f, g] of [[1250, 0.2], [2870, 0.14], [4310, 0.08]]) tone(c, o, t, { dur: 0.25, type: 'sine', freq: f, gain: g * v });
  },
  /** Heard at your own ear when your shot or arrow finds its mark, however far off. */
  confirm: (c, o, t, v) => {
    tone(c, o, t, { dur: 0.05, type: 'sine', freq: 420, freqEnd: 240, gain: 0.3 * v });
    noise(c, o, t, { dur: 0.03, type: 'bandpass', freq: 2400, q: 3, gain: 0.12 * v });
  },
  confirm_head: (c, o, t, v) => {
    tone(c, o, t, { dur: 0.07, type: 'sine', freq: 640, freqEnd: 300, gain: 0.34 * v });
    noise(c, o, t, { dur: 0.04, type: 'bandpass', freq: 3200, q: 3, gain: 0.16 * v });
  },
  /** The one that puts them down. */
  kill: (c, o, t, v) => {
    tone(c, o, t, { dur: 0.22, type: 'sine', freq: 150, freqEnd: 48, gain: 0.55 * v });
    noise(c, o, t + 0.01, { dur: 0.12, type: 'lowpass', freq: 900, freqEnd: 200, gain: 0.25 * v });
  },
  thunk: (c, o, t, v) => tone(c, o, t, { dur: 0.09, type: 'square', freq: 180, freqEnd: 90, gain: 0.15 * v }),
  blast: (c, o, t, v) => {
    noise(c, o, t, { dur: 1.4, type: 'lowpass', freq: 1800, freqEnd: 60, gain: 1.0 * v });
    tone(c, o, t, { dur: 0.6, type: 'sine', freq: 70, freqEnd: 25, gain: 0.9 * v });
  },
  click: (c, o, t, v) => tone(c, o, t, { dur: 0.03, type: 'square', freq: 2200, gain: 0.12 * v }),
  ratchet: (c, o, t, v) => noise(c, o, t, { dur: 0.06, type: 'bandpass', freq: 2600, q: 4, gain: 0.25 * v }),
};

/**
 * Combat sounds: swings, hits (flesh, straw, metal), blocks and parries,
 * shots, bows, blasts, reloads, dry clicks. Synthesised with Web Audio and
 * placed by distance and side (pan) from the listener. Starts on the first
 * key or click (browsers need that), and stays silent where audio isn't
 * available, so it never affects the game.
 */
export class CombatAudio implements System {
  readonly name = 'combat-audio';
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private game!: Game;
  /** How many sounds were asked for (for checks; counts even without audio). */
  played: Record<string, number> = {};
  volume = 0.6;

  init(game: Game): void {
    this.game = game;
    const start = () => this.start();
    window.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', start, { once: true });
    const ev = game.events;
    ev.on('combat:attack', ({ attacker }) => {
      const item = this.itemOf(attacker);
      const kind = item ? Object.values(Items[item]?.weapon?.modes ?? {})[0]?.delivery?.kind : 'sweep';
      // The wind-up is the tell: the whoosh waits for the blade to move (combat:swing).
      if (kind === 'sweep') this.play('effort', attacker, item ? 1 : 0.6);
    });
    ev.on('combat:swing', ({ attacker, item, mode, charge }) => {
      if (!item) return this.play('swing_light', attacker);
      if (mode === 'heavy' || charge > 0) return this.play('swing_heavy', attacker, 0.8 + 0.2 * charge);
      this.play('swing', attacker);
    });
    ev.on('combat:fired', ({ attacker, item }) => {
      const sound = item === 'musket' ? 'musket' : item === 'longbow' ? 'bow' : item === 'grenade' ? 'swing_light' : item && Items[item]?.weapon ? 'pistol' : null;
      if (sound) this.play(sound, attacker);
    });
    ev.on('combat:hit', ({ hit, target, result }) => {
      if (hit.delivery === 'status' || hit.delivery === 'hazard' || hit.delivery === 'area') return;
      const at = hit.point ?? target.object3d.position;
      const t = result.tags;
      if (t.includes('parried')) return this.play('parry', at);
      if (t.includes('blocked') || (t.includes('armour') && result.damage < 8)) this.play('clang', at, 0.8);
      if (result.damage > 0) this.play(target.tags.has('dummy') ? 'straw' : hit.source === 'fists' ? 'punch' : 'flesh', at, Math.min(1, 0.5 + result.damage / 50));
      // Your own shots: a hit far away is too faint to hear, so it's also confirmed at your ear.
      const ranged = hit.delivery === 'hitscan' || hit.delivery === 'projectile';
      if (ranged && result.damage > 0 && hit.attacker?.name === 'player' && target !== hit.attacker) this.playHere(hit.zone === 'head' ? 'confirm_head' : 'confirm', 0.8);
    });
    ev.on('combat:killed', ({ target, attacker }) => {
      if (attacker?.name === 'player' && target !== attacker && !target.tags.has('dummy')) this.playHere('kill', 0.8);
    });
    ev.on('combat:impact', ({ point, surface, delivery }) => {
      const s = surface ?? 'stone';
      // A blade on stone or metal rings; on anything else it thuds like a shot would.
      if (delivery === 'sweep' && (s === 'stone' || s === 'metal')) return this.play('clang', point, 0.55);
      this.play(Sounds[`hit_${s}`] ? `hit_${s}` : 'thunk', point, 0.7);
    });
    ev.on('combat:explosion', ({ point }) => this.play('blast', point));
    ev.on('combat:dry', ({ entity }) => this.play('click', entity));
    ev.on('combat:reload', ({ entity, step }) => this.play(step ? 'ratchet' : 'click', entity, 0.7));
  }

  private itemOf(e: Entity): string | null {
    const c = e.getAll().find((x) => 'itemId' in x) as { itemId?: string | null } | undefined;
    return c?.itemId ?? null;
  }

  /** Create the audio context (needs a user gesture in browsers). */
  start(): void {
    if (this.ctx) return;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      // A gentle limiter so a blast doesn't clip.
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      this.master.connect(comp).connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  /** Play a sound at the listener: no distance, no side. */
  playHere(name: string, loud = 1): void {
    this.play(name, this.game.renderer.camera.position, loud);
  }

  /** Play a sound at an entity or a point: quieter with distance, panned to its side. */
  play(name: string, at: Entity | { x: number; y: number; z: number }, loud = 1): void {
    this.played[name] = (this.played[name] ?? 0) + 1;
    const ctx = this.ctx;
    const voice = Sounds[name];
    if (!ctx || !this.master || !voice || ctx.state === 'closed') return;
    const p = 'object3d' in at ? at.object3d.getWorldPosition(_p) : _p.set(at.x, at.y, at.z);
    const cam = this.game.renderer.camera;
    const d = cam.position.distanceTo(p);
    const gain = loud / (1 + d / 10);
    if (gain < 0.01) return;
    _r.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const side = d > 0.5 ? THREE.MathUtils.clamp(_r.dot(p.clone().sub(cam.position).normalize()), -1, 1) : 0;
    const pan = ctx.createStereoPanner();
    pan.pan.value = side * 0.8;
    pan.connect(this.master);
    try {
      // A little different every time, in pitch and loudness.
      PITCH = 0.94 + Math.random() * 0.12;
      voice(ctx, pan, ctx.currentTime + 0.005, gain * (0.88 + Math.random() * 0.12));
    } catch {
      /* audio isn't essential */
    }
  }
}
