import type { DialogueTree } from '@ingine/engine/dialogue/types';
import mira from './mira.json';
import bram from './bram.json';
import tess from './tess.json';
import villagerA from './villager-a.json';
import villagerB from './villager-b.json';
import villagerC from './villager-c.json';
import guard from './guard.json';
import merchant from './merchant.json';

/**
 * Every dialogue tree in the game. `satisfies` makes TypeScript check each
 * JSON file against the DialogueTree type at build time; DialogueSystem then
 * validates references, conditions and effects when it registers them.
 */
export const dialogueTrees = [
  mira satisfies DialogueTree,
  bram satisfies DialogueTree,
  tess satisfies DialogueTree,
  // Generic people in the procedural world; {npc.*} words come from each speaker.
  villagerA satisfies DialogueTree,
  villagerB satisfies DialogueTree,
  villagerC satisfies DialogueTree,
  guard satisfies DialogueTree,
  merchant satisfies DialogueTree,
] as DialogueTree[];
