import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Every visible thing that isn't level blockout (items, weapons, projectiles,
 * props) is built from a model id. Content refers to ids only (items.json
 * `"model"`, weapon `view.model`, prop builders), and this registry turns an
 * id into a fresh Object3D.
 *
 * Today every id is backed by a procedural greybox builder registered in code.
 * To swap in real art, add an entry to the game's models.json (passed to
 * `registerModelOverrides`):
 *
 *   "longsword": { "src": "models/longsword.glb", "scale": 1 }
 *
 * The file (under public/) is loaded once at startup by `loadModelAssets` and
 * cloned per use; if it fails to load the greybox stays. Nothing else changes.
 *
 * Conventions a replacement model must follow (same as the greybox):
 * - Units are metres, +Y up.
 * - Kind "held" (weapons): grip at the origin, pointing down -Z. The resting
 *   pose on a table is made by rotating it by `lie` and sitting it on y = 0.
 * - Kind "rest" (small items): modelled lying on a surface at y = 0.
 * - Kind "prop": origin on the floor at the base centre, front facing +Z.
 * - `parts`: named nodes that code moves or hides (e.g. a chest's "lid"
 *   pivot). A replacement must contain nodes with those names.
 */

export type Euler3 = [number, number, number];

export interface ModelDef {
  build: () => THREE.Object3D;
  kind: 'held' | 'rest' | 'prop' | 'flight';
  /** Held models: rotation (radians) that lays it down on its side. */
  lie?: Euler3;
  /** Named nodes code looks up with `modelPart`. Checked at load. */
  parts?: string[];
}

/** One entry of src/content/models.json. */
export interface ModelOverride {
  /** Path to a .glb/.gltf, relative to the site root (public/). */
  src: string;
  scale?: number;
  /** Degrees, applied after loading, to match the conventions above. */
  rotation?: Euler3;
  offset?: Euler3;
  /** Replaces the code's `lie` for held models. Radians. */
  lie?: Euler3;
}

const defs = new Map<string, ModelDef>();
const loaded = new Map<string, THREE.Object3D>();
const overrideTable: Record<string, ModelOverride> = {};

/** Real art that replaces greybox builders, loaded by `loadModelAssets`. Call before it. */
export function registerModelOverrides(table: Record<string, ModelOverride>): void {
  Object.assign(overrideTable, table);
}

export function registerModels(table: Record<string, ModelDef>): void {
  for (const [id, def] of Object.entries(table)) {
    if (defs.has(id)) throw new Error(`Model "${id}" registered twice`);
    defs.set(id, def);
  }
}

export function hasModel(id: string): boolean {
  return defs.has(id);
}

export function modelDef(id: string): ModelDef | undefined {
  return defs.get(id);
}

export function modelIds(): string[] {
  return [...defs.keys()];
}

/** Whether `id` currently comes from an asset file rather than the greybox. */
export function isAssetModel(id: string): boolean {
  return loaded.has(id);
}

function source(id: string): THREE.Object3D {
  const def = defs.get(id);
  if (!def) throw new Error(`Unknown model "${id}" (known: ${modelIds().join(', ')})`);
  const asset = loaded.get(id);
  if (!asset) return def.build();
  const copy = asset.clone(true);
  // Props get their own materials: code recolours parts (a switch's lamp).
  if (def.kind === 'prop') copy.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
  });
  return copy;
}

const _box = new THREE.Box3();

/**
 * A new instance of model `id`. `pose: 'rest'` lays held models (weapons)
 * down on a surface at y = 0, centred; other kinds are already at rest.
 */
export function buildModel(id: string, pose: 'native' | 'rest' = 'native'): THREE.Object3D {
  const def = defs.get(id);
  const inner = source(id);
  if (pose === 'native' || def?.kind !== 'held') return inner;
  const lie = (loaded.has(id) && overrideTable[id]?.lie) || def.lie || [0, 0, 0];
  inner.rotation.set(...lie);
  const holder = new THREE.Group();
  holder.add(inner);
  holder.updateMatrixWorld(true);
  _box.setFromObject(inner);
  const c = _box.getCenter(new THREE.Vector3());
  inner.position.set(-c.x, -_box.min.y, -c.z);
  return holder;
}

/** A named node of a built model (see ModelDef.parts). */
export function modelPart<T extends THREE.Object3D = THREE.Object3D>(model: THREE.Object3D, name: string): T {
  const o = model.getObjectByName(name);
  if (!o) throw new Error(`Model is missing part "${name}"`);
  return o as T;
}

/** Every node whose name starts with `prefix` (e.g. "flame" for flame_0, flame_1...). */
export function modelParts(model: THREE.Object3D, prefix: string): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  model.traverse((o) => o.name.startsWith(prefix) && out.push(o));
  return out;
}

/** Checks models.json against the registered ids. Returns problems. */
export function validateModelOverrides(): string[] {
  const errors: string[] = [];
  for (const [id, o] of Object.entries(overrideTable)) {
    if (!defs.has(id)) errors.push(`models.json: "${id}" is not a known model id`);
    if (typeof o?.src !== 'string' || !o.src) errors.push(`models.json: "${id}" needs "src"`);
  }
  return errors;
}

/**
 * Loads every asset listed in models.json. Call once before building the
 * level. A file that fails to load (or lacks required parts) logs a warning
 * and the greybox is used instead, so a bad asset never stops the game.
 */
export async function loadModelAssets(): Promise<void> {
  const entries = Object.entries(overrideTable);
  for (const e of validateModelOverrides()) console.warn(e);
  if (!entries.length) return;
  const loader = new GLTFLoader();
  const base = import.meta.env.BASE_URL ?? '/';
  await Promise.all(
    entries.map(async ([id, o]) => {
      const def = defs.get(id);
      if (!def || !o?.src) return;
      try {
        const gltf = await loader.loadAsync(o.src.startsWith('http') || o.src.startsWith('data:') ? o.src : base + o.src);
        const root = new THREE.Group();
        const scene = gltf.scene;
        if (o.scale) scene.scale.setScalar(o.scale);
        if (o.rotation) scene.rotation.set(...(o.rotation.map((d) => THREE.MathUtils.degToRad(d)) as Euler3));
        if (o.offset) scene.position.set(...o.offset);
        scene.traverse((n) => {
          if ((n as THREE.Mesh).isMesh) n.castShadow = n.receiveShadow = true;
        });
        root.add(scene);
        const missing = (def.parts ?? []).filter((p) => !root.getObjectByName(p));
        if (missing.length) throw new Error(`missing parts ${missing.join(', ')}`);
        loaded.set(id, root);
      } catch (err) {
        console.warn(`Model "${id}": couldn't use ${o.src} (${(err as Error).message}); keeping the greybox`);
      }
    }),
  );
}
