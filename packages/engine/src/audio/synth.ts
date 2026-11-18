/**
 * Tiny synthesis helpers: every sound is made on the fly with WebAudio, so
 * there are no audio files to ship. Each helper schedules one short sound at
 * time `t` into `out` and cleans up after itself.
 */

export interface NoiseOpts {
  dur: number;
  type: BiquadFilterType;
  freq: number;
  freqEnd?: number;
  q?: number;
  gain: number;
  /** Seconds to reach full loudness (default 5 ms). */
  attack?: number;
}

export interface ToneOpts {
  dur: number;
  type: OscillatorType;
  freq: number;
  freqEnd?: number;
  gain: number;
  attack?: number;
  /** Optional detuned twin (cents) for a fuller sound. */
  detune?: number;
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

/** One second of white noise per context, reused by every noise burst. */
function whiteNoise(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}

/** A burst of filtered noise with a fast attack and an exponential tail (steps, swishes, pops). */
export function noise(ctx: BaseAudioContext, out: AudioNode, t: number, o: NoiseOpts): void {
  const src = ctx.createBufferSource();
  src.buffer = whiteNoise(ctx);
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = o.type;
  f.frequency.setValueAtTime(o.freq, t);
  if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t + o.dur);
  f.Q.value = o.q ?? 1;
  const g = ctx.createGain();
  const a = o.attack ?? 0.005;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a + 0.01, o.dur));
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 0.5);
  src.stop(t + o.dur + 0.05);
}

/** A decaying tone (bings, plucks, thumps). */
export function tone(ctx: BaseAudioContext, out: AudioNode, t: number, o: ToneOpts): void {
  const g = ctx.createGain();
  const a = o.attack ?? 0.004;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a + 0.01, o.dur));
  g.connect(out);
  const voices = o.detune ? [-o.detune / 2, o.detune / 2] : [0];
  for (const cents of voices) {
    const osc = ctx.createOscillator();
    osc.type = o.type;
    osc.detune.value = cents;
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, t + o.dur);
    osc.connect(g);
    osc.start(t);
    osc.stop(t + o.dur + 0.05);
  }
}

/** A held note with a soft attack and release (pads, organ). */
export function pad(ctx: BaseAudioContext, out: AudioNode, t: number, o: { dur: number; type: OscillatorType; freq: number; gain: number; attack?: number; release?: number; detune?: number; cutoff?: number }): void {
  const a = o.attack ?? 0.4;
  const r = o.release ?? 0.6;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.gain, t + a);
  g.gain.setValueAtTime(o.gain, t + Math.max(a, o.dur - r));
  g.gain.linearRampToValueAtTime(0, t + o.dur);
  let into: AudioNode = g;
  if (o.cutoff) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = o.cutoff;
    f.connect(g);
    into = f;
  }
  g.connect(out);
  const voices = o.detune ? [-o.detune / 2, o.detune / 2] : [0];
  for (const cents of voices) {
    const osc = ctx.createOscillator();
    osc.type = o.type;
    osc.detune.value = cents;
    osc.frequency.value = o.freq;
    osc.connect(into);
    osc.start(t);
    osc.stop(t + o.dur + 0.05);
  }
}

/** MIDI note number to frequency (A4 = 69 = 440 Hz). */
export const midiHz = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);
