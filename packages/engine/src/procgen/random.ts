/**
 * Seeded randomness for procedural generation. Everything derives from one
 * world seed, and each generation layer takes its own sub-seed so changing
 * one layer (say, more villages) doesn't reshuffle the others.
 */
export { mulberry32 } from '../utils/noise';

/** 32-bit FNV-1a hash of a string. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A stable seed for one named layer of a world: `subSeed(seed, 'rivers')`. */
export function subSeed(seed: number, label: string): number {
  return hash2i(seed, hashString(label), 0x9e3779b9);
}

/** Integer hash of three 32-bit values (seed, x, z) -> uint32. */
export function hash2i(seed: number, x: number, z: number): number {
  let h = Math.imul(seed ^ 0x27d4eb2d, 0x165667b1);
  h = Math.imul(h ^ Math.imul(x | 0, 0x27d4eb2f), 0x85ebca6b);
  h = Math.imul(h ^ Math.imul(z | 0, 0x165667b1), 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

/** Hash of (seed, x, z) as a float in [0, 1): per-cell jitter that never changes. */
export function hash2(seed: number, x: number, z: number): number {
  return hash2i(seed, x, z) / 4294967296;
}
