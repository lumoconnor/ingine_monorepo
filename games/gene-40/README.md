# Gene's 40th

A birthday present: a party plaza with portals to themed worlds. Built on the
office test game, so it's multiplayer with spatial voice (one person hosts,
friends join with the link).

    npm run dev:gene      # http://localhost:5175
    npm run check:gene    # headless checks (local dev server + signalling broker)

Published at `/gene/` on the repo's GitHub Pages site.

## How it fits together

- Every world lives in **one map**, 600 m apart along +X (`src/scenes.ts`), past
  the fog and well past voice range. Teleporting just moves the player, so the
  room, voice and everyone's avatars keep working without level loads.
- `src/Teleports.ts`: step onto a pad and you're moved, with a flash. You land
  beside the destination's return pad (never on it), and a pad fires once per
  step-on. **H** goes back to the plaza from anywhere. Arriving somewhere also
  makes it your respawn point.
- `src/scenes/hub.ts`: the plaza (cake, portal ring, balloons, bunting), plus the
  "coming soon" island each unbuilt world shows and its return pad.
- `src/scenes/kit.ts`: small greybox helpers (pads, cylinders, trees, labels).

## Adding a world

1. Write `src/scenes/<id>.ts` exporting a builder `(game, teleports, index)`
   that builds around `scene.origin` and calls `buildReturnPad`.
2. Register it in `builders` in `src/GeneWorld.ts` and set `built: true` in
   `src/scenes.ts`.

Built: axe throwing (`src/scenes/axes.ts`: three lanes, rack gives 5 axes, ring scoring 6/4/3/2/1 plus killshot 8, best round kept in this browser).

Built: Arup office (`src/scenes/arup.ts`): big floor above the city, you step out of the lift facing the ARUP sign; Aurora (project manager, meeting room), Chris (open plan), Renee (kitchen), Big Liz (a friendly giant lizard doing laps of the atrium). What they say lives in `src/content/chatter.ts`: edit the lists, each talk opens on a random line.

Built: Murph Land (`src/scenes/murph.ts`): cat paradise for Gene's cat Murphy. Giant Murphy statue, Murphy himself on a royal cushion, four climbable cat trees with ziplines, giant yarn balls, box, food bowl and toy mouse. 35 Murphy coins lying on surfaces (walk over to collect); find them all and Murphy makes you an honorary cat. Six more cats to chat with. Murphy's colours are FUR/STRIPE at the top of the file.

Worlds planned: Arup office, Murph Land, star islands, hero city,
buddies park, ballpark, hoops court, tattoo parlour.
