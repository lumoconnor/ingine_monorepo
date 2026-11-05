/**
 * Dialogue data format. Trees are authored as JSON in src/content/dialogue/
 * and checked twice: TypeScript checks the shape when the JSON is imported
 * (`satisfies DialogueTree`), and `validateTree` checks what types can't:
 * node references, condition/effect names and their parameters.
 *
 *   {
 *     "id": "bram",
 *     "speaker": "Old Bram",
 *     "start": [
 *       { "if": [{ "if": "flag", "flag": "key_returned" }], "node": "thanks" },
 *       { "node": "intro" }
 *     ],
 *     "nodes": {
 *       "intro": {
 *         "text": "Hello, {player}.",
 *         "choices": [
 *           { "text": "Need help?", "next": "lost" },
 *           { "text": "Bye.", "next": null }
 *         ]
 *       }
 *     }
 *   }
 */

/** `{ "if": "<registered condition>", ...params }`. `not: true` inverts it. */
export interface Condition {
  if: string;
  not?: boolean;
  [param: string]: unknown;
}

/** `{ "do": "<registered effect>", ...params }` */
export interface Effect {
  do: string;
  [param: string]: unknown;
}

export interface Choice {
  text: string;
  /** Node to go to. `null` (or omitted) ends the conversation. */
  next?: string | null;
  /** Only offered when every condition passes. */
  if?: Condition[];
  /** Run when picked, before moving on. */
  do?: Effect[];
}

export interface DialogueNode {
  text: string;
  /** Overrides the tree's speaker for this line. */
  speaker?: string;
  /** Run when the node is shown. */
  do?: Effect[];
  /** Player responses. If absent, the line gets a single Continue (with `next`) or Leave. */
  choices?: Choice[];
  /** Used when there are no choices. */
  next?: string | null;
}

/** First rule whose conditions all pass picks the opening node. A rule without `if` always passes. */
export interface StartRule {
  if?: Condition[];
  node: string;
}

export interface DialogueTree {
  id: string;
  speaker: string;
  start: string | StartRule[];
  nodes: Record<string, DialogueNode>;
}
