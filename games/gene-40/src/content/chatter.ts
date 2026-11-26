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
  /** Said instead, every time, once this flag is set (e.g. after finding every coin). */
  special?: { flag: string; text: string };
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
  if (c.special) {
    nodes.special = { text: c.special.text, choices: [{ text: 'Anything else?', next: 'line0' }, { text: 'See you!', next: null }] };
    start.unshift({ if: [{ if: 'flag', flag: c.special.flag }], node: 'special' });
  }
  for (let k = 0; k < n - 1; k++) start.push({ if: [{ if: 'chance', p: 1 / (n - k) }], node: `line${k}` });
  start.push({ node: `line${n - 1}` });
  return { id: c.id, speaker: c.speaker, start, nodes };
}

export const CHATTER: ChatterDef[] = [
  {
    id: 'aurora',
    speaker: 'Aurora',
    hello: "Gene! Happy 40th! I've added it to the programme as a key milestone. It's on the critical path, so no slipping.",
    lines: [
      "Quick one: can we take this offline? And by offline I mean to the cake.",
      "Your birthday is green on the RAG status. Cake is amber. Big Liz ate the contingency.",
      "I've updated the Gantt chart. Turning 40 now has a two-week float. Use it wisely.",
      "Action items from today: one, eat cake. Two, see item one.",
      "Scope creep is when a cake for 10 becomes a cake for 40. Which, to be fair, it now is.",
      "I don't run late. I re-baseline.",
      "Lessons learned register, entry 214: never book the atrium when Big Liz is doing laps.",
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
  ...catChatter(),
  {
    id: 'captain_whiskers',
    speaker: 'Captain Whiskers',
    hello: "Citizen Gene! Happy 40th! Eight kittens are stuck on the rooftops. Grab SWING from the station by the sign, then follow the beams of light: every power gets you to the next one.",
    lines: [
      'My superpower? Landing on my feet. Every time. Even from Hero HQ. Do not test this.',
      'The cape is not for flying. The cape is for drama.',
      'Swinging tip: hold on through the bottom of the arc, let go on the way up. Physics is on your side. Mostly.',
      'Flying is easy. Look where you want to go and hold W. Shift if you are in a hurry. Dive if you are showing off.',
      'Press C in the air and you come down like a dropped piano. The cars do not enjoy it. I do.',
      "Super strength is on the roof of Hero HQ. Somebody parked their car badly on the avenue. Teach them a lesson.",
      "One kitten is right on top of Hero HQ. Don't ask me how. Kittens are a mystery.",
      'Every hero needs a nemesis. Mine is the vacuum cleaner.',
    ],
    special: { flag: 'heroes.allKittens', text: 'Every kitten home safe! Gene, you are an official hero of the city. Here is your medal. It is a bottle cap. It is very shiny.' },
  },
  {
    // Luke's two-year-old. She only ever says one thing.
    id: 'annie',
    speaker: 'Annie',
    hello: 'I NEED A SNACK',
    lines: ['I NEED A SNACK'],
  },
  {
    id: 'rex',
    speaker: 'Rex',
    hello: "RAWR! Happy 40th, Gene! I'm Rex, the mascot. Grab a ball from the rack courtside. Hold to power up, let go to shoot, and look at the rim. Beat your best in the 60-second shootout!",
    lines: [
      'People ask if a dinosaur can dunk. Look at my arms. Next question.',
      "Look at the rim, not the ball. The ball goes where your eyes go. Mostly.",
      "Beyond the arc is three points. In the corners too. Live a little.",
      'I have been the mascot here for sixty-six million years. Give or take.',
      "Bank shots count! The board's glass. Very forgiving glass.",
      'My jersey says 40 in your honour. It used to say 4. I added a zero. Nobody noticed.',
      'Free throws: line up in the paint, look at the front of the rim, and half power. Swish.',
      "The crowd goes wild when you hit a three. The crowd is me. I go wild.",
    ],
    special: { flag: 'hoops.fifteen', text: "FIFTEEN POINTS in a shootout?! Gene, that's a franchise record. I'm getting your number painted on my tail." },
  },
  {
    id: 'nimbus',
    speaker: 'Nimbus',
    hello: "Oh! A visitor! Happy 40th, Gene! I'm Nimbus. Ten stars are hiding on the islands. Hop, bounce and climb, and if you fall in the sea, you'll pop back at the last flag you touched.",
    lines: [
      "Don't be scared of the spinning disc. Be a little scared of the spinning disc.",
      'The bounce pad on the east island sends you WAY up. Lean into it.',
      "I'm mostly water vapour and enthusiasm.",
      'The beam on the west side is narrow. Walk, don\'t run. I ran once. I rained for a week.',
      'There is a star on the cloud stair. My cousin Cumulus built it. He has never heard of handrails.',
      "Have you checked that pillar that has a platform going round and round? Just saying.",
      "Forty years! That's at least eleven thousand sunsets. I was in most of them.",
    ],
    special: { flag: 'stars.all', text: "ALL TEN STARS! Gene, I'm so happy I could drizzle. You are officially a Star Islands champion!" },
  },
  ...buddiesChatter(),
];

/** Murph Land's cats. Every cat shares a pool of cat thoughts plus a few of its own. */
function catChatter(): ChatterDef[] {
  const pool = [
    'Meow. (Translation: the red dot is real and I WILL catch it one day.)',
    "I knocked a cup off the table this morning. It's called science.",
    "Have you seen the giant box? It's the best box. I've been in it six hours.",
    'Mrrp. (Translation: you may pet me exactly twice. Three is assault.)',
    'Murphy says if you collect every Murphy coin, something wonderful happens. I think it\'s treats.',
    'The zipline? Terrifying. Ten out of ten. Would scream again.',
    'I sat on the giant yarn ball and it rolled. I have never felt so betrayed.',
    "It's 3am somewhere. Time for zoomies.",
  ];
  const cats: [string, string, string, string[]][] = [
    ['biscuit', 'Biscuit', "Mew! Happy birthday, Gene! Murphy told us you were coming. He told us SEVERAL times.", ['I am made of approximately forty percent nap.']],
    ['mochi', 'Mochi', "Oh, hello. You found my box. It's my box. Happy birthday though.", ["If it fits, I sits. If it doesn't fit, I sits harder."]],
    ['pickles', 'Pickles', 'Prrrt! A visitor! Are you the birthday human? You smell like cake.', ['I once chased my own tail for an hour. I won.']],
    ['noodle', 'Noodle', "Meow meow. I'm Noodle. I'm long. That's the whole thing.", ['Stretch report: currently 1.4 metres. New record.']],
    ['sir_pounce', 'Sir Pounce', 'Hark, birthday human! Sir Pounce, Knight of the Sunbeam, at your service.', ['I guard the cat tree. From what? Birds. Leaves. Mostly leaves.']],
    ['pepper', 'Pepper', "Hssss... oh, it's Gene. Sorry. Happy birthday. I hiss at everyone, it's not personal.", ['The cucumber incident of last spring is not to be discussed.']],
  ];
  const out: ChatterDef[] = cats.map(([id, speaker, hello, own], i) => ({
    id,
    speaker,
    hello,
    // Each cat gets its own lines plus a rotating slice of the pool.
    lines: [...own, ...pool.slice(i % pool.length), ...pool.slice(0, i % pool.length)].slice(0, 6),
  }));
  out.push({
    id: 'murphy',
    speaker: 'Murphy',
    hello: "Ah. Gene. Welcome to Murph Land, my kingdom. Happy fortieth. You may collect my coins. All of them. I'll be watching.",
    lines: [
      'Every coin in this land bears my face. As it should.',
      'I have commissioned a statue of myself. It is accurate. Perhaps slightly too modest.',
      'The other cats are my loyal subjects. Biscuit is head of naps.',
      'Dinner is at five. It was also at four. It is always dinner.',
      'Forty years, Gene. In cat years that is... still less than me. I am ageless.',
      'You may scratch behind my ears. That is an honour few receive.',
    ],
    special: { flag: 'murph.allCoins', text: "Every last coin! Gene, you are now an honorary cat. Royal decree. Happy birthday, my favourite human." },
  });
  return out;
}


/** Buddies park: the pups, Buddy and Molly. Each pup has a special line once their ball is back. */
function buddiesChatter(): ChatterDef[] {
  return [
    {
      id: 'budderball',
      speaker: 'Budderball',
      hello: "Happy birthday, Gene! Is there cake? I can smell cake. I can ALWAYS smell cake. Also I lost my football. Have you seen it? It was near the snow.",
      lines: [
        'Pull my paw. ...No? Smart. Very smart.',
        "I'm not hungry. I'm just checking the bowl is still there. Every five minutes.",
        "Football is easy. You run, you catch, you fall over, everybody claps.",
        'My brothers say I eat too much. I say they eat too little. We are both right.',
      ],
      special: { flag: 'buddies.budderball', text: "MY FOOTBALL! Gene, you're the best. If I find a sandwich today, you get half. Maybe a third. Now THROW IT. Please. Throw it." },
    },
    {
      id: 'rosebud',
      speaker: 'Rosebud',
      hello: "Hi Gene! Happy birthday! Somebody has to keep these boys out of trouble, and it's me. Have you seen my soccer ball? I think it rolled near the big Christmas tree.",
      lines: [
        "Pink isn't just a colour. It's a lifestyle.",
        'I can out-dribble every one of my brothers. Ask them. Actually, don\'t, they\'ll lie.',
        'Mudbud, if you roll in that puddle again, I am telling Mom.',
        "Being the only girl means I'm automatically in charge. That's the rule. I made it.",
      ],
      special: { flag: 'buddies.rosebud', text: "My soccer ball! Thanks, Gene. You're an honorary Buddy now. That means you have to wear a bow. I don't make the rules. (I do make the rules.) Rule one: you throw, I fetch." },
    },
    {
      id: 'mudbud',
      speaker: 'Mudbud',
      hello: "Heya Gene! Happy birthday! Wanna roll in some mud? No? More for me. Oh, and my volleyball's gone. Last time I saw it, I was hiding in the spooky house. Not scared. Just... visiting.",
      lines: [
        'A bath? No thank you. I am perfectly dirty the way I am.',
        'Fun fact: mud is just water that tried harder.',
        'I spiked a volleyball so hard once it landed in next week.',
        'Rosebud says I smell. I say I smell AMAZING.',
      ],
      special: { flag: 'buddies.mudbud', text: "My volleyball! And it's even got a bit of mud on it. Perfect. You get me, Gene. Throw it in the puddle! ...Please?" },
    },
    {
      id: 'buddha',
      speaker: 'Buddha',
      hello: 'Greetings, Gene, and happy birthday. Forty is a wise number. My baseball has journeyed to the top of the pyramid. It will come back when the time is right. Or when you go and get it.',
      lines: [
        'A ball that is thrown must come down. Unless it lands on a pyramid.',
        'Breathe in. Breathe out. Now fetch.',
        'The squirrel does not run from the dog. The dog runs after the squirrel. Think about it.',
        'Patience, my brothers. Also, where did Budderball put the treats?',
      ],
      special: { flag: 'buddies.buddha', text: 'You have returned my baseball. The universe is in balance. Also, I am very happy. Throw it, and I shall return it. That is the way.' },
    },
    {
      id: 'b_dawg',
      speaker: 'B-Dawg',
      hello: "Yo yo yo, it's B-Dawg in the house! Happy birthday Gene, forty and fly! Someone shot my basketball into space. Well, onto the rocket pad. Same thing.",
      lines: [
        "I got the bling, I got the swing, I got the... hold on, I'm still working on that one.",
        'Nothing but net. And sometimes the backboard. And sometimes the bench.',
        "Gene's forty and still got game. Respect.",
        "My chain says B. It stands for B-Dawg. Also Buddy, Ball, Bacon. Mostly bacon.",
      ],
      special: { flag: 'buddies.b_dawg', text: "My ball's back! Gene, you're the MVP. Most Valuable Pal. Up top! ...Okay, paw top. Now chuck it long, I got wheels." },
    },
    {
      id: 'buddy',
      speaker: 'Buddy',
      hello: "Welcome to Fernfield, Gene! Happy 40th! The pups have lost their balls all over the park again. If you find them, they'll be ever so grateful. And so will my ears.",
      lines: [
        'In my day I played basketball, football, soccer, volleyball and baseball. Not all at once. Mostly.',
        'Five puppies is a lot of puppies. I counted. Twice.',
        "Molly says I'm a soft touch. I say I'm a good sport.",
        "There's no rule that says a dog can't play. Look it up.",
      ],
      special: { flag: 'buddies.all', text: "Every ball found! Gene, you're part of the pack now. Happy birthday, from all seven of us. Now the pups want to go to space. Of course they do. The launch button's by the rocket." },
    },
    {
      id: 'molly',
      speaker: 'Molly',
      hello: "Hello, Gene, happy birthday! Please excuse the pups. They're lovely. They're just also everywhere.",
      lines: [
        "If you see Mudbud near the puddle, please don't let him in the picnic basket.",
        'Rosebud keeps the boys in line. She gets that from me.',
        'Buddha meditated for an hour this morning. Then he chased his tail for two.',
        "Forty is a lovely age. In dog years it's... actually, let's not do the maths.",
      ],
      special: { flag: 'buddies.all', text: "You found every ball! Thank you, Gene. Now they'll finally have a nap. Oh, who am I kidding." },
    },
  ];
}
