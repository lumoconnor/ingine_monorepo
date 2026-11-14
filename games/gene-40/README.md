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

Worlds planned: axe throwing, Arup office, Murph Land, star islands, hero city,
buddies park, ballpark, hoops court, tattoo parlour.
