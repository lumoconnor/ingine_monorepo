/// <reference lib="webworker" />
import { sculptCharacter, type CharacterSpec } from './character';
import { meshSculpt } from './sculpt';

/** Meshes characters off the main thread. In: {id, spec}. Out: {id, meshes} with transferred buffers. */
self.onmessage = (e: MessageEvent<{ id: string; spec: CharacterSpec }>) => {
  const { id, spec } = e.data;
  try {
    const meshes = meshSculpt(sculptCharacter(spec));
    const transfer: Transferable[] = [];
    for (const m of meshes) for (const a of [m.positions, m.normals, m.indices, m.colors, m.paint, m.skinIndex, m.skinWeight]) if (a) transfer.push(a.buffer);
    (self as unknown as Worker).postMessage({ id, meshes }, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String((err as Error)?.stack ?? err) });
  }
};
