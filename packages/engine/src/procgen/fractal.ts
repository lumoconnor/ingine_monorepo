import type { Noise2D } from '../utils/noise';

/**
 * Ridged multifractal in [0, 1]: sharp crests where the noise crosses zero
 * and broad valleys between them. Each octave is weighted by the one above,
 * so detail gathers on the ridges and valley floors stay smooth.
 */
export function ridged(noise: Noise2D, x: number, y: number, octaves = 5, lacunarity = 2.1, gain = 0.5): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let weight = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(noise.noise(x * freq, y * freq));
    n *= n;
    n *= weight;
    weight = Math.min(1, Math.max(0, n * 2));
    sum += n * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Hermite smoothstep of `x` between `a` and `b`. */
export function smoothstep(x: number, a: number, b: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
