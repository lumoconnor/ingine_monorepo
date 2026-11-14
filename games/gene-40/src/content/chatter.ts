import type { DialogueTree, DialogueNode } from '@ingine/engine/dialogue/types';
import { registerCondition } from '@ingine/engine/dialogue/registry';

/**
 * Characters who just say random stuff (Luke: "random stuff for now, we'll add
 * more later"). Each talk starts on a random line; "Anything else?" walks on
 * through the rest. To change what someone says, edit their list in
 * CHATTER below: no other code needs to change.
 */

let registered = false;
/** `{ "if": "chance", "p": 0.25 }`: passes with probability p. */
export function registerChatterVerbs(): void {
  if (registered) return;
  registered = true;
  registerCondition('chance', {
    params: { p: { type: 'number' } },
    test: (_ctx, a) => Math.random() < a.p,
  });
}

export interface ChatterDef {
  id: string;
  speaker: string;
  /** Said the first time you talk to them. */
  hello: string;
  lines: string[];
}

/** A tree that opens on `hello` once, then on a uniformly random line. */
export function chatterTree(c: ChatterDef): DialogueTree {
  const n = c.lines.length;
  const nodes: Record<string, DialogueNode> = {
    hello: { text: c.hello, choices: [{ text: 'Anything else?', next: 'line0' }, { text: 'See you!', next: null }] },
  };
  c.lines.forEach((text, i) => {
    nodes[`line${i}`] = {
      text,
      choices: [
        { text: 'Anything else?', next: `line${(i + 1) % n}` },
        { text: 'Ha! See you.', next: null },
      ],
    };
  });
  // Entry k passes with 1/(n-k), so every line is equally likely to open.
  const start: DialogueTree['start'] = [{ if: [{ if: 'visited', node: 'hello', not: true }], node: 'hello' }];
  for (let k = 0; k < n - 1; k++) start.push({ if: [{ if: 'chance', p: 1 / (n - k) }], node: `line${k}` });
  start.push({ node: `line${n - 1}` });
  return { id: c.id, speaker: c.speaker, start, nodes };
}

export const CHATTER: ChatterDef[] = [
  {
    id: 'aurora',
    speaker: 'Aurora',
    hello: "Welcome to Arup! Oh, it's you, Gene. Happy 40th! Sign in here. Actually, don't, it's your birthday.",
    lines: [
      "The lifts are being weird again. One of them only goes to floors that don't exist.",
      'Someone booked every meeting room for "focus time". All of them. For a month.',
      'If anyone asks, the plant by the window is called Kevin. Kevin is thriving.',
      "Big Liz is doing laps of the atrium again. She says it's her step count.",
      "Forty is nothing. That's like, two twenties. Totally fine.",
      'I put your name on the cake order. They spelled it "Jean". It\'s still cake.',
      'The printer and I have an understanding. I don\'t look at it, it doesn\'t jam.',
    ],
  },
  {
    id: 'chris',
    speaker: 'Chris',
    hello: "GENE! Happy birthday, mate! Forty! You don't look a day over thirty-nine!",
    lines: [
      "I've been smiling since 8am and honestly I don't know how to stop.",
      "Have you tried the new coffee machine? I've had four. I can hear colours.",
      'Big Liz stood on my keyboard yesterday. Best code I\'ve ever written.',
      'I renamed the shared drive folder to "FINAL_final_v3_actually_final". You\'re welcome.',
      "Team lunch on Friday. I've already picked the place. It's the same place.",
      'Life tip: say "great question" and you have five more seconds to think.',
      "I tried to high-five Big Liz once. I'm still recovering. Worth it.",
    ],
  },
  {
    id: 'renee',
    speaker: 'Renee',
    hello: "Gene! Happy birthday! There's cake in the fridge. Well. There's a fork in the fridge. The cake had a short life.",
    lines: [
      'Whoever keeps putting empty milk cartons back in the fridge: I know. I KNOW.',
      "This kettle has boiled more water than the North Sea. It's earned a holiday.",
      'Fun fact: the dishwasher is load-bearing. Do not open it during a meeting.',
      "I labelled my yoghurt. It's been gone two days. Big Liz has a guilty look.",
      "Forty's great. You get a free upgrade to 'distinguished'. It's in the contract.",
      "If you see a mug that says World's Okayest Colleague, it's mine. Don't.",
      'I asked for a standing desk. They gave me a stool and a pep talk.',
    ],
  },
  {
    id: 'big_liz',
    speaker: 'Big Liz',
    hello: 'RRROOOAAARRR! ...Sorry. Big Liz. Happy birthday, Gene. I stomp because I care.',
    lines: [
      'ROAR. (Translation: has anyone seen my lanyard? It was very small.)',
      'I only knocked over ONE meeting room. They rebuilt it with a higher ceiling. Respect.',
      'Atomic breath is fine for toast. Terrible for the smoke alarm.',
      'People say I have a big personality. Also a big tail. Mind the tail.',
      'I came up from the sea for the free biscuits and stayed for the pension.',
      'Forty is young! I am two hundred and twelve and I still have my own teeth. All four hundred.',
      'ROOOAAR. (Translation: happy birthday. Please clap.)',
    ],
  },
];
