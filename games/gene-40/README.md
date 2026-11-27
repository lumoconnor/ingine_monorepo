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

Built: axe throwing (`src/scenes/axes.ts`: three lanes, rack gives 5 axes, ring scoring 6/4/3/2/1 plus killshot 8, best round kept in this browser; a gentle hand sway, `handling.sway` on the axe, makes the aim drift so you release on the beat).

Built: Arup office (`src/scenes/arup.ts`): big floor above the city, you step out of the lift facing the ARUP sign; Aurora (project manager, meeting room), Chris (open plan), Renee (kitchen), Big Liz (a friendly giant lizard doing laps of the atrium). What they say lives in `src/content/chatter.ts`: edit the lists, each talk opens on a random line.

Built: Murph Land (`src/scenes/murph.ts`): cat paradise for Gene's cat Murphy. Giant Murphy statue, Murphy himself on a royal cushion, four climbable cat trees with ziplines, giant yarn balls, box, food bowl and toy mouse. 35 Murphy coins lying on surfaces (walk over to collect); find them all and Murphy makes you an honorary cat. Six more cats to chat with. Murphy's colours are FUR/STRIPE at the top of the file.

Built: Hero city (`src/scenes/heroes.ts`, powers in `src/scenes/heroPowers.ts`, the mission and emergencies in `src/scenes/heroEmergencies.ts`): an original superhero town with a skyline, Hero HQ (80 m) and a diner. One goal, SAVE HERO CITY, as one chain of eight steps: take Swing on the plaza, catch a kitten that slips off a roof ledge as you come near, swing up to a rooftop for Flight, fly three cats out of a burning building (75 s), fly Captain Whiskers' ten-ring race (beat 30 s), fly to the top of HQ for Super strength, stop a runaway bus down the avenue (stand in its way, throw something at it, or slam beside it), then the finale: the sky fades to dark storm clouds with rain and lightning, the music turns minor and heavy, and Big Liz (six times her size) stomps up the avenue behind HQ; throw cars at her and slam by her feet until her grumpiness bar runs out and she shrinks back (`src/scenes/heroFinale.ts`). Only one beam is lit at a time (the next power station, or a pulsing red one over an emergency), and the top panel always reads `SAVE HERO CITY n / 8 · Next: ...`. A power station only works once the steps before it are done. Fail an emergency and it resets. Rescued cats wait in the basket on the plaza; Captain Whiskers gives you a medal once the city is saved (flag `heroes.saved`). Powers: you arrive in the hero suit (an 8 m jump and a fast run); Swing is hold right mouse or G (aim assist finds a wall ahead and up), Flight is Space in the air then fly where you look (W, Shift to boost, dive for speed; C in the air is a ground slam that throws cars), Super strength is click or E to lift a parked car or bin, click again to throw. The view widens with speed, banks while swinging and flying, shakes on a slam, and speed lines and wind come in when you're fast. Eighteen parked cars and six bins are physics objects (local to each player, not synced). Powers only work in Hero city, and fists are off there so a click is for cars. Fall damage is off in the whole game (`main.ts`).

Built: Star islands (`src/scenes/stars.ts`): an original first-person platformer over the sea. Stepping stones, a shuttle, a lift, a bounce pad, a spinning disc, a platform circling a pillar, a narrow beam and a spiral cloud stair up to the star castle. Ten stars stand on top of things; fall in the sea and you're back at the last flag you touched. Nimbus the cloud says hello. `scripts/stars-check.cjs` plays every jump for real.

Built: Buddies park (`src/scenes/buddies.ts`): a homage to the Buddies movies. Fernfield's park with Budderball, Rosebud, Mudbud, Buddha and B-Dawg trotting round the sports field and Buddy and Molly on a picnic blanket. Each pup's ball is lost in a sequel-themed corner (snowy hill, rocket pad, Christmas corner, spooky house, pyramid; plus a Super Buddies cape stand). Walk over a ball to pick it up, walk up to its pup to give it back.

Built: Ballpark (`src/scenes/ballpark.ts`): a domed downtown ballpark with a tall tower beside it. Walk through the backstop to the plate, press E at the bat rack for a bat, and step into the glowing circle in the batter's box: a whistle and the organ start the round, and the pitching machine throws ten pitches. Click to swing. Look where you want it to go: the hit follows your view left or right, and looking up a little lifts it over the wall. A well-timed swing flies far; early nudges it towards left field, late towards right. Each pitch is called (strike, foul, out, single, double, triple, home run) with its own sound (umpire, crowd groan, organ stabs per base, air horn and roar for a homer), a big word that pops up on screen, and the scoreboard flashing the call with the bases it reached lit on a diamond and a pitch-by-pitch line along the bottom. A home run sets off fireworks over the outfield. The best round of bases is kept.

Built: Hoops court (`src/scenes/hoops.ts`): an indoor arena in red, black and silver with a hanging scoreboard and Rex, an original red dinosaur mascot in a number 40 jersey. Press E at the ball rack courtside for a ball and a 60-second shootout. Hold the button to power up (a meter shows by the crosshair), let go to shoot; the ball arcs up from where you look. Real scoring: it has to drop through the rim, and it bounces off the glass and the rim. Two points inside the arc, three beyond it. Rebounds come back to your hand, and the best shootout is kept.

Built: Tattoo parlour (`src/scenes/tattoo.ts`, art in `src/content/tattooArt.ts`): Inkwell Tattoo, a little shop on a city street, with Annie the artist (Luke's two-year-old, on a step stool; all she says is "I NEED A SNACK"). Press E on a design on the flash wall (heart with a GENE banner, Lucky 40 star, anchor, rose, Murphy, swallow, dagger, party skull), then E at the chair: three seconds of buzzing and it's on your forearm. Hold right-click to raise your fists and see it. Your ink is kept in this browser, and a new design goes over the old one.

Every planned world is built.
