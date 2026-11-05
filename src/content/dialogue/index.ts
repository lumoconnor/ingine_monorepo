import type { DialogueTree } from '@/dialogue/types';
import mira from './mira.json';
import bram from './bram.json';
import tess from './tess.json';

/**
 * Every dialogue tree in the game. `satisfies` makes TypeScript check each
 * JSON file against the DialogueTree type at build time; DialogueSystem then
 * validates references, conditions and effects when it registers them.
 */
export const dialogueTrees = [
  mira satisfies DialogueTree,
  bram satisfies DialogueTree,
  tess satisfies DialogueTree,
] as DialogueTree[];
