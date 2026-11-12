import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { buildCharacter, sculptCharacter, type CharacterSpec, type BuiltCharacter } from './character';
import { assembleSculpt, type PieceMesh } from './sculpt';

/**
 * Character ids -> specs (the game's characters.json), built lazily once and
 * cloned per use. Building is the slow part (a few hundred ms to a few
 * seconds per character), so `prebuildCharacters` can do it up front.
 */
const specs = new Map<string, CharacterSpec>();
const protos = new Map<string, BuiltCharacter>();

export function registerCharacters(table: Record<string, CharacterSpec>): void {
  for (const [id, spec] of Object.entries(table)) specs.set(id, spec);
}

export function hasCharacter(id: string): boolean {
  return specs.has(id);
}

function proto(id: string): BuiltCharacter {
  let p = protos.get(id);
  if (!p) {
    const spec = specs.get(id);
    if (!spec) throw new Error(`Unknown character "${id}" (known: ${[...specs.keys()].join(', ')})`);
    p = buildCharacter(spec);
    protos.set(id, p);
  }
  return p;
}

/**
 * Builds characters now (all registered ones by default) so spawning is
 * instant. Meshing runs in parallel web workers; falls back to this thread.
 */
export async function prebuildCharacters(ids: string[] = [...specs.keys()]): Promise<void> {
  const todo = ids.filter((id) => !protos.has(id) && specs.has(id));
  if (!todo.length) return;
  const n = Math.max(1, Math.min(todo.length, (navigator.hardwareConcurrency ?? 4) - 1, 6));
  let workers: Worker[] = [];
  try {
    workers = Array.from({ length: n }, () => new Worker(new URL('./characterWorker.ts', import.meta.url), { type: 'module' }));
  } catch {
    for (const id of todo) proto(id);
    return;
  }
  const queue = [...todo];
  await Promise.all(
    workers.map(async (w) => {
      while (queue.length) {
        const id = queue.shift()!;
        const spec = specs.get(id)!;
        try {
          const meshes = await new Promise<PieceMesh[]>((resolve, reject) => {
            w.onmessage = (e) => (e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.meshes));
            w.onerror = (e) => reject(new Error(e.message));
            w.postMessage({ id, spec });
          });
          protos.set(id, assembleSculpt(sculptCharacter(spec), meshes));
        } catch (err) {
          console.warn(`Character "${id}": worker failed (${(err as Error).message}); building on the main thread`);
          proto(id);
        }
      }
      w.terminate();
    }),
  );
}

/** Mesh stats of a built character (pieces, vertex and triangle counts, build ms). */
export function characterStats(id: string): BuiltCharacter['stats'] {
  return proto(id).stats;
}

export interface CharacterInstance {
  root: THREE.Object3D;
  bone(name: string): THREE.Object3D;
}

/** A fresh, independently posable copy of character `id`. */
export function spawnCharacter(id: string): CharacterInstance {
  const root = cloneSkinned(proto(id).root);
  // Each copy gets its own materials, so a hit flash only lights up this one.
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.material = (m.material as THREE.Material).clone();
  });
  const bones = new Map<string, THREE.Object3D>();
  root.traverse((o) => o.name && bones.set(o.name, o));
  return {
    root,
    bone(name) {
      const b = bones.get(name);
      if (!b) throw new Error(`Character "${id}" has no part "${name}"`);
      return b;
    },
  };
}

/** A relaxed standing pose: elbows soft, arms just off the body. */
export function restPose(c: CharacterInstance): void {
  c.bone('arm_l').rotation.set(0, 0, 0.07);
  c.bone('arm_r').rotation.set(0, 0, -0.07);
  c.bone('forearm_l').rotation.x = -0.15;
  c.bone('forearm_r').rotation.x = -0.15;
}
