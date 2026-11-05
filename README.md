# ingine

A first-person web engine (**Three.js** rendering, **Rapier** physics via
`@dimforge/rapier3d-compat`, **TypeScript + Vite**) and the games built on it.
Movement, interaction, machinery, combat, dialogue, inventory and saves live in
the engine; each game supplies its own content, levels and tuning.

## Repo layout

```
packages/engine/   @ingine/engine: all engine code (src/ below). Never imports game content.
apps/sandbox/      @ingine/sandbox: the playground level, its test content, and the headless checks.
                   The engine's test bed, and the template for a new game.
games/             (coming) one folder per game, set up like apps/sandbox.
```

npm workspaces link them, so `@ingine/engine` always means the engine source in
this repo. Games import engine modules by path, for example
`import { Game } from '@ingine/engine/core/Game'`.

## Run it

```bash
npm install
npm run dev        # the sandbox at http://localhost:5173
npm run build      # type-check + production build into apps/sandbox/dist/
npm run typecheck  # every package
npm run check      # all headless checks (starts its own dev server)
npm run check -- movement water   # just some of them
```

The checks live in `apps/sandbox/scripts/*-check.cjs` and use the preinstalled
Playwright Chromium. Each steps the simulation deterministically and prints
PASS/FAIL lines; `npm run check` reports which failed. Run them after any
engine change, since they are what "the engine still works" means.

## Controls

| Input | Action |
|---|---|
| Mouse | Look (click the page to capture the mouse) |
| W A S D / arrows | Move |
| Space | Jump (hold for full height, tap for a short hop) |
| Shift (hold) | Sprint |
| Ctrl / Cmd / C | Crouch (hold) |
| Steep slopes (over 46°) | You slide down them; A/D steer, Space hops off |
| In deep water | W/S swim where you look (look down to dive), Space up, Ctrl/C down, Shift fast swim; swim into a low edge to climb out. Rivers have a current that carries you (sprint-swim to beat the rapids) |
| Ziplines | E (or jump into the cable) to grab; you slide downhill, W pulls hand over hand, Space lets go |
| Walk into a ladder | Grab it; W/S climb (look down and W also goes down), A/D shuffle, Space jumps off |
| Left click | Attack: punch, swing (hold for a heavy blow), shoot. Hold to draw a bow or cook a grenade; let go to loose or throw |
| Right click | Aim down the sights (pistol), or guard with a sword or fists. Raising it just as a blow lands parries |
| R / T | Reload, or nock an arrow / switch arrows (plain or fire) |
| 1 - 4 | Draw a weapon you carry (press again to put it away) |
| E | Use what's under the crosshair: open/close doors, pull levers, press buttons, run lifts, talk to people, pick things up |
| Tab / I | Inventory (pauses the game): click an item to Use / Read / Drop. Tab closes, Esc pauses |
| F5 / F9 | Save / load. The game also autosaves; the start screen offers Continue or New game |
| In a conversation | 1-9 picks a reply; or wheel / W S to highlight and click, E, Space or Enter. Esc leaves |
| F | Fullscreen |
| Backspace | Respawn |
| `` ` `` or F3 | Toggle debug readout |
| Esc | Release the mouse |

> **Ctrl/Cmd + W closes the browser tab.** Browsers don't let a page block it
> unless the page is fullscreen with Keyboard Lock (Chromium). So: press **F**
> for fullscreen (Ctrl+W becomes safe in Chrome/Edge), or crouch with **C**.
> A "Leave site?" prompt is also enabled as a safety net once you've played.

### Touch (phones and tablets)

On a touch device the game shows on-screen controls instead of capturing the mouse
(`src/input/TouchControls.ts`, styles in `src/ui/touch.css`). Force them on a desktop with
`?touch=1`, or off with `?touch=0`.

- Left side: floating move stick (appears under your thumb). Drag past the ring to sprint.
- Right side: drag to look. Dragging on Attack or Guard also turns the camera.
- Buttons press on touchdown, like keys, so holds (heavy swing, bow draw, guard) start instantly.
- Crouch: tap toggles, hold is crouch-while-held (swim down). Use glows when something is in reach.
- Top row: weapon slots 1-4, Bag (inventory, with a close button), fullscreen, pause.
- Fullscreen: a button on the start screen (all devices) and in the touch bar. iPhone Safari has no
  page fullscreen, so it shows a hint instead. Check: `npm run check -- touch`.

## Architecture

Engine source, in `packages/engine/` (sandbox-only files are marked):

```
src/
  [sandbox] main.ts          bootstrap: create Game, add systems, load level, start (apps/sandbox/src)
  core/
    Game.ts                  owns systems + World; fixed-timestep loop (60 Hz) with render interpolation
    System.ts                interface for global modules (input, physics, renderer, HUD, later audio/AI/save)
    EventBus.ts              typed pub/sub between systems (add new events to GameEvents)
    WorldState.ts            game.state: flags, variables and item counts; save/load as plain JSON
    SaveSystem.ts            save/load to localStorage (autosave, F5/F9, Continue / New game), Saveable components
    Time.ts                  FIXED_DT, FrameTime
  entities/
    Entity.ts                scene node + bag of Components (+ tags)
    Component.ts             per-entity behaviour: onAttach / fixedUpdate / update / onDetach, ordered by `order`
    World.ts                 spawns/destroys entities, drives components
  input/InputManager.ts      keyboard/mouse -> logical Actions, pointer lock, latched presses
  physics/
    PhysicsWorld.ts          Rapier init/step, collider -> Entity lookup
    RigidBodyComponent.ts    body + colliders for an entity; interpolated transform sync
  render/
    Renderer.ts              WebGL renderer, scene, camera, sun + shadows following the player
    materials.ts, labels.ts  grey-box grid materials, billboard labels
    models/ModelRegistry.ts  model ids -> meshes: greybox builders today, glTF files from content/models.json later
  gameplay/
    player/                  PlayerController (movement), FirstPersonCamera (look/bob/FOV), createPlayer factory
    components/              MovingPlatform (+ pingPong / orbit / spin motion helpers), Ladder,
                             Door (swing / slide), Lift (two-stop, switch-driven), Switch (lever / button), WaterVolume, Zipline
    interaction/             Interactable (anything usable with E) + PlayerInteractor (crosshair ray, HUD prompt)
  combat/
    types.ts, registry.ts    damage packets / hits; damage types (content/combat/damage-types.json) and the modifier pipeline
    Damageable.ts            health, hit zones (hurtbox sensors), statuses (bleeding, burning), applyHit / heal / cure / revive
    CombatSystem.ts          seeded RNG; trace (hit zones vs solid geometry), strike, deliver (delivery runners), projectiles in flight
    weaponTypes.ts, blocks.ts  weapon data format; registered triggers / feeders / deliveries / arcs and their validation
    Combatant.ts             the fighter, player or NPC: intents in, weapon state machine (combos, charge, reloads, feeders)
    projectiles.ts           arrows and grenades in flight (stick / bounce / fuse), area blasts with falloff and cover
    blocking.ts, Armour.ts   damage steps: guard and parry (10), worn armour (25); Armour is the worn-items component
    PlayerCombat.ts          player brain: input to intents, slots, recoil, aiming; fall damage, death and waking up
    FistViewmodel.ts         what you hold: fist or weapon model, swings, kick, reload dip, bow draw
    describe.ts, HazardVolume.ts, TrainingDummy.ts
    Bag.ts                   where a Combatant's weapons and ammo live: the player's inventory, or an NPC's LocalBag
    feel/                    presentation only: CombatFeel (hit-stop, view shake), CombatFx (particles), CombatAudio (synth sounds)
    ai/                      enemies: Perception (sight, hearing, shouts), EnemyBrain (utility AI), NpcBody (movement), NpcRig (looks), factions
  dialogue/
    types.ts                 the JSON format for conversations (DialogueTree / Node / Choice / Condition / Effect)
    registry.ts              conditions (flag, hasItem, var, visited) and effects (setFlag, giveItem, notify...)
    validate.ts              load-time checks: node refs, known verbs, params, unreachable nodes
    DialogueSystem.ts        runs a conversation, frames the camera, reports lines on the EventBus
  inventory/
    types.ts, validate.ts    item definition format + load-time checks
    catalog.ts               the item catalogue (`Items`, `itemLabel`); filled by the game with `registerItems`
    models.ts, icons.ts      greybox item models (registered by id) and icons rendered from them
    weaponModels.ts          greybox weapon (held), kit (resting) and arrow (flight) models
    pickups.ts               addItemPickup (level items with stable ids), dropped items, restore on load
    InventorySystem.ts       open/close (pause + free mouse), slots, use, drop
  [sandbox] content/         the game's data (apps/sandbox/src/content). Engine code never imports from here (see "Engine vs game content")
    index.ts                 registerContent(): hands items, damage types, factions, unarmed, archetypes, model overrides to the engine
    dialogue/*.json          conversations (index.ts type-checks each one with `satisfies DialogueTree`)
    items.json               item catalogue (type-checked with `satisfies`)
    models.json              model id -> real model file (.glb/.gltf); empty = all greybox
  world/
    Level.ts                 level contract (load/unload)
    builders.ts              addBox / addWedge / addLabel / addLadder grey-box helpers (mesh + matching collider)
    npcs.ts                  addNpc (placeholder character + Talk prompt) / addItemPickup
    propModels.ts            greybox prop models (chest, training_dummy, fire_pit, lever, button_pedestal, lift_panel)
    combat.ts                addDummy (training dummy with head/torso/limb zones) / addFirePit
    enemies.ts               addEnemy from an archetype (content/combat/archetypes.json), archetype validation
    machinery.ts             addWall (with doorways) / addDoor / addLever / addButton / addLift
    terrain/Terrain.ts       height-function terrain tile: mesh + trimesh collider
    [sandbox] levels/PlaygroundLevel.ts  the movement test level (apps/sandbox/src/levels)
  config/
    bindings.ts              action -> key bindings
    player.ts                every movement tunable in one place
    combat.ts                player health, fall damage heights
  ui/                        HUD overlay, DialogueUi (conversation panel + notifications), InventoryUi, styles
  utils/noise.ts             seeded simplex noise / fBm
```

### Key ideas

- **Fixed timestep.** Gameplay and physics tick at 60 Hz regardless of display
  rate; visuals interpolate between ticks, so 144 Hz monitors are smooth and
  physics is deterministic.
- **Systems vs Components.** Systems are global singletons (one physics world,
  one renderer). Components are behaviour on a specific entity. New features
  are usually a new Component, a new System, or both.
- **Actions, not keys.** Gameplay asks `input.isDown('sprint')`, so rebinding
  and gamepad support only touch `config/bindings.ts` / `InputManager`.
- **Events for cross-cutting stuff.** e.g. `player:landed` drives the camera
  dip now and footstep audio / fall damage later.
- **Data-driven tuning.** All movement numbers are in `config/player.ts`. For
  live tuning, open the browser console: `player.cfg.jumpHeight = 2`.

### Physics: why Rapier

The player is a **kinematic** capsule moved by Rapier's character controller
(not a physics-simulated ball), so movement is fully game-feel controlled while
Rapier handles the hard parts: wall sliding, max slope angle, auto-stepping
stairs, snapping to the ground on the way down, and pushing dynamic objects.
Moving platforms are kinematic bodies on their own collision layer. Rapier's
character controller gets wedged when it touches moving kinematic bodies, so
it never sees them; `PlayerController` handles platforms itself, after the
physics step so they are always where they really are: ride (move rigidly
with the platform under you), push (slide out of any platform that moved into
you, so a shuttle shoves you aside), then sweep your own motion against
platforms with slide and step-up. `scripts/platform-check.cjs` stress-tests it.
Ladders are a climb zone in front of a wall (`addLadder`); `scripts/ladder-check.cjs`
climbs up and down each one.

### Interaction, doors and switches

Anything with an `Interactable` component can be used with **E**: the player's
`PlayerInteractor` ray-casts from the camera, finds the entity that owns the
collider it hits, and the HUD shows `[E] <prompt>`. Doors are kinematic bodies
on the platform layer, so the player collides with them exactly like moving
platforms. A door opens away from whoever opened it, and a door or lift never
moves into the player: it compares its distance to the player before and
after each step and waits if it would close the gap (`physics/queries.ts`).
Switches only know the `Activatable` interface (`activate`, `isOn`, `busy`),
so anything new (drawbridge, trap, light) can be wired to a lever without
touching switch code. `scripts/door-check.cjs` walks through every door and
rides both switch lifts.

### Dialogue and world state

Conversations are data: one JSON file per tree in `apps/sandbox/src/content/dialogue/`.
A tree picks its opening node from `start` rules (first rule whose conditions
pass), each node has a line and up to 9 choices, and choices or nodes can
have conditions (`"if"`) and effects (`"do"`):

```json
{ "text": "Here you go.", "next": "returned",
  "do": [{ "do": "takeItem", "item": "key_rusty" }, { "do": "giveItem", "item": "gold", "count": 10 }] }
```

Content is checked twice: TypeScript checks every file's shape against
`DialogueTree` at build time, and `validateTree` checks what types can't
(every `next` exists, conditions and effects are registered with the right
parameters, item ids exist, no unreachable nodes) and fails loudly at startup.
Engine verbs live in `dialogue/registry.ts`; a game adds its own with
`registerCondition` / `registerEffect` before `game.init()`, and they are
immediately usable (and validated) in JSON.

All state lives in `game.state` (`WorldState`): flags, variables and items.
The dialogue system records its own bookkeeping there too
(`dialogue.visited.<tree>.<node>`, `dialogue.seen.<tree>.<node>.<i>`), so
`toJSON()` / `load()` is a complete save. Text can show state with `{var.x}`
and `{item.gold}`.

While talking, gameplay input is blocked (`input.gameplayBlocked`), the
camera eases onto the speaker's face and the NPC turns to you. The
conversation ends with Esc or if you end up more than 4 m away. The UI only
listens to `dialogue:*` events, so it can be restyled or replaced freely.
In the playground, Mira and Tess stand by the spawn and Old Bram is outside
the door house; his key is on the table inside. `scripts/dialogue-check.cjs`
plays through the whole task.

### Items, inventory and saving

Items are defined in `apps/sandbox/src/content/items.json` (name, description, category,
model, optional `maxStack`, `use`, `useLabel`, `text`), type-checked at build
time and validated at startup. `use` lists the same effects as dialogue plus
`consume`, so a cider is just
`"use": [{ "do": "notify", "text": "..." }, { "do": "consume" }]`.
Notes with `text` get a Read button. Quest items and money can't be dropped.

Items in the world rest on surfaces like real objects: no hovering or
spinning. Place them with `addItemPickup(game, { id, item, position, yawDeg })`
where `position` is the point on the surface. The `id` lets saves remember a
taken item (`world.taken.<id>` flag). Inventory icons are rendered from the
same 3D models, so there's no icon art to keep in sync.

Saves go to `localStorage`: WorldState, the player's pose, dropped items, and
every component with `saveState()` / `loadState()` (doors and lifts so far).
The game autosaves after using something or finishing a conversation, and
every 30 s of play. `scripts/inventory-check.cjs` covers pickups, the
inventory screen, dropping, and a save/load round trip.

### Models

Everything you see that isn't level blockout is built from a **model id**:
items (`"model"` in items.json, plus `"flightModel"` for what flies when
it's fired, e.g. arrows), held weapons (the item's model, or
`weapon.view.model`), and props (`chest`, `training_dummy`, `fire_pit`,
`lever`, `button_pedestal`, `lift_panel`). `render/models/ModelRegistry.ts`
turns an id into a mesh with `buildModel(id)`; `buildModel(id, 'rest')`
lays a held weapon down on a surface.

Today every id is a procedural greybox registered in code. To use real art,
put the file under `public/` and list it in `apps/sandbox/src/content/models.json`:

```json
{ "longsword": { "src": "models/longsword.glb", "scale": 1, "rotation": [0, 0, 0] } }
```

It loads at startup and replaces the greybox everywhere that id appears (the
world, the icon, the hand). A file that fails to load logs a warning and the
greybox stays; an id that doesn't exist is a startup error, like other content.
Conventions a replacement must follow: metres, +Y up; weapons modelled as held
(grip at the origin, pointing down -Z; `lie` sets how it rests on a table);
items modelled resting on y = 0; props with the origin at the base centre,
front facing +Z. Props have named parts the code animates, which the file must
contain: chest `body`, `lid`, `hasp`, `lock_hasp`, `lock_plate`;
training_dummy `figure`; lever `handle`; button_pedestal and lift_panel
`cap`, `lamp`; fire_pit flames are any nodes named `flame*`. Colliders and hit
zones stay in code, so keep a replacement about the same size. NPC bodies
aren't model ids yet (they need a rig and animations).

### Keys, locks and chests

`Lock` (gameplay/components/Lock.ts) goes on anything with an Interactable:
`addDoor(game, { ..., lock: { id, key } })` or `addChest(game, { id, contents, lock })`.
Without the key the prompt says "Locked door" and trying it rattles it and
explains; with the key it says "Unlock door (Rusty key)". Unlocked state is
the flag `unlocked.<id>`, so it saves, and dialogue can unlock things with
`{ "do": "setFlag", "flag": "unlocked.storeroom" }` (Bram does this when you
return his key). `consumeKey: true` uses the key up. Chests give their
contents on E and stay open (`world.looted.<id>`).
`scripts/lock-check.cjs` covers locked/unlocked doors, chests and saves.

### Combat (phase 1: health and hits)

Design: the "Combat system architecture" doc in the project. Phase 1 builds
the target side and one simple attack:

- `Damageable` holds health and hit zones. Zones are sensor colliders on
  `Layer.hurtbox`; every existing query excludes sensors, so movement,
  interaction and drops never see them. Default multipliers: head x2,
  torso x1, limbs x0.6. `resist` per damage type (the armoured dummy takes
  40% blunt). Dying sets `killed.<id>`.
- A hit is plain data: `{ attacker, packets: [{ type, amount }], zone, source }`.
  `applyHit` runs it through the registered modifiers (`zone`, `resist`;
  `registerModifier` adds more) and emits `combat:hit` / `combat:killed`.
- `CombatSystem.trace` casts twice, hit zones then solid geometry, and only
  counts a zone with nothing solid in front of it. `strike` applies it and
  pushes loose objects. Weapons in phase 2 will all go through these.
- Player: 100 health, no regeneration. Falls are free up to 4 m and lethal
  at 16 m. Death shows a screen for 2.5 s, then you wake at the spawn point
  with full health. Healing: draughts (+50), cider (+10), apples (+5).
- Content verbs: effects `heal`, `damage`; conditions `killed`, `health`.
- Health is saved through `Saveable` (no save format change yet).
- `scripts/combat-check.cjs` covers zones, resistances, reach, blocking,
  dummies resetting, fire, falls, death and respawn, healing and saves.

### Weapons (phases 2 and 3)

A weapon is an item with a `weapon` block in items.json. Each attack mode
is a trigger (press, hold, burst, combo, charge) + timing + feeder
(magazine, single-load, sequence, self) + delivery (sweep, hitscan,
projectile, area) + payload (damage packets, impulse, onHit effects). Every
kind is registered in combat/blocks.ts and checked at startup, so a typo in
the JSON fails loudly. `extends` makes variants; ammo items carry their own
payload, which overrides the weapon's.

- Weapons are item instances (`longsword#1`) with their own data (rounds
  loaded, jammed). Throwables with `weapon.stack` (grenades) stay counted.
  Save format v2; v1 saves migrate.
- `Combatant` is shared by the player and (phase 5) NPCs: a brain sets
  intents, the Combatant runs the weapon. Bare hands are content/combat/unarmed.json.
- In the yard: longsword (3-swing combo, hold for an overhead), pistol
  (8-round magazine, aim with right click), longbow (hold to draw: damage
  scales with the draw, arrows stick where they land and E pulls them out),
  frag grenades (hold to cook, 3.5 s fuse, bounce, blast falls off with
  distance and solid things shelter you). A magazine weapon you find is
  loaded; a bow is not.
- Checks: `scripts/weapons-check.cjs` (sword, pistol, instances, saves) and
  `scripts/projectile-check.cjs` (bow, arrows, grenades, blasts).

### Stamina, guarding, armour, bleeding and burning (phase 4)

- Stamina (Combatant, 100): melee swings cost 12 (fists 7, mode `stamina`
  overrides; a charged swing up to 1.5x), and blocked hits cost
  `staminaPerHit` + a third of what was stopped. It returns at 30/s after
  0.9 s of rest (slower while guarding). At 0 you can't swing, and the next
  blocked hit breaks your guard (you stagger for 0.9 s).
- Guard: hold right mouse with a weapon that has a `block` profile and no
  aim or secondary mode (longsword, fists). Covers 70° in front; each damage
  type loses `block.reduce` (a sword stops 85% of a cut and none of a
  bullet). A melee hit in the first `parryWindow` s (sword 0.18) is parried:
  no damage, the attacker staggers 1.1 s. Re-raising within 0.35 s gives no
  parry window, so it can't be spammed.
- Armour: items with an `armour` block (`slot`, `covers` zones, `resist` per
  type, `move`). Wear and take off from the inventory; one piece per slot;
  dropping it takes it off; saved. Yard table: leather cap, steel helm, mail
  hauberk (torso and limbs, slows to 93%), ballistic vest (torso only).
  Hits with no zone (blasts, fire) meet the torso piece.
- Statuses (registry `Statuses`, `registerStatus`): bleeding (2.5/s, time
  adds up, max 20 s) and burning (7 fire/s, refreshes, water puts it out).
  Payloads list `status: [{ id, seconds, chance }]`; the chance is scaled by
  how much of the hit got through, so mail or a guard rarely lets a cut
  bleed. Bandages and draughts stop bleeding (effect `cure`). The fire pit
  and fire arrows set you alight.
- `scripts/defence-check.cjs` covers all of it.

### Enemies (phase 5)

A bandit camp south of the playground (around -20, 60): a sword bandit by
the fire and a marksman with a flintlock musket on the rocks.

- Content: `content/combat/archetypes.json` (health, faction, what they
  carry and draw, armour, speeds, preferred range, sight, aggression, block
  and parry chance, when to flee, how slow their wind-ups are, aim time and
  error, loot chances) and `factions.json` (who is hostile to whom).
  `addEnemy(game, { id, archetype, position, facingDeg })` builds one.
- Same parts as the player: Damageable (zones by hit height on the capsule),
  Combatant (with its own LocalBag, so its musket and cartridges are its own),
  Armour. On top: Perception, EnemyBrain, NpcBody, NpcRig.
- Perception: a 120° view cone with line of sight; awareness builds faster
  up close and half as fast if you crouch; shots are heard (`weapon.noise`:
  pistol 45 m, musket 70, bow 8); being hit reveals the attacker; a bandit
  that spots you alerts allies within 30 m. Out of sight for 15 s, they lose
  you and search where they saw you last, then go back to their posts.
- EnemyBrain (utility AI): every 0.25 s it scores idle, investigate, engage,
  reload, retreat, flee and return, with a bonus for the current choice.
  Melee: close in, circle, swing (combos, the odd heavy), guard or time a
  parry against your swings, back off when winded, flinch when hit hard
  mid-swing. Ranged: shoulder and aim (0.9 s, the tell), fire, reload the
  five-step flintlock sequence, retreat if you rush it first.
- Enemy wind-ups are 2.2x slower than yours, so a swing can be read and
  parried. Tags over heads: "?" while noticing, "!" once hunting you, and
  wounds. Dead enemies fall, stop blocking the way, and drop their kit
  (the musket as it was, loaded or not); saves keep them dead.
- No navmesh yet: they steer straight at you and around what's in front.
- `scripts/enemy-check.cjs` covers stealth, spotting, shouts, attacks,
  shooting and reloading, parrying, loot, saves, losing you and hearing.

### Feel (phase 6)

Nothing here changes the simulation; it all listens to `combat:*` events.

- Hit-stop (CombatFeel): a landed melee blow near-freezes time for 50 ms
  (90 ms on a kill, 120 ms on a parry, 60 ms when you take a big hit), via
  `game.timeScale`, on real time.
- View shake: trauma from your own shots (by recoil), blows you take, and
  blasts nearby; shake grows with trauma squared and fades in about a
  second. Recoil: 45% of each kick settles back by itself.
- Viewmodel: the weapon lags behind fast turns on a spring and bobs as you
  walk (both calmer while aiming); the longsword rests lower and angled.
- CombatFx: one instanced mesh of puffs: dust on world impacts, blood (straw
  from dummies), sparks off blocks, armour and parries, gun smoke, blast debris.
- CombatAudio: every sound synthesised with Web Audio (no files): swings,
  flesh, straw, clangs, parry ring, pistol, musket (pan flash then boom),
  bow, blasts, reload ratchets, dry clicks. Quieter with distance, panned by
  side; starts on the first key or click.
- HUD: a red arc shows which way a blow came from; enemies flash when hit.
- `scripts/feel-check.cjs` covers it.

### Known limits / next steps

- Terrain is a single 500 m tile with a trimesh collider. For the open world
  this becomes streamed chunks (same height function, per-chunk LOD), likely
  with Rapier heightfield colliders.
- Rapier's WASM is inlined in the bundle (~2 MB gzipped). Fine for now;
  can switch to the non-compat package to load the `.wasm` separately.

## Engine vs game content

This codebase is on its way to becoming a reusable engine with games built on
top (plan: "Reusable engine structure proposal" doc). The rule already holds:
**engine code never imports `apps/sandbox/src/content/`**. A game hands its data over at
startup, before `game.init()`:

| What | How the game provides it |
|---|---|
| Items | `registerItems(json)` (`inventory/catalog.ts`) |
| Damage types, factions, bare hands | `registerDamageType`, `registerFaction`, `setUnarmed` |
| Enemy archetypes | `registerArchetype` (`world/enemies.ts`) |
| Real-art model files | `registerModelOverrides(json)` |
| Dialogue trees | `new DialogueSystem(trees)` |
| Dialogue / item-use verbs | `registerCondition`, `registerEffect` |
| Events | augment `GameEvents`: `declare module '@ingine/engine/core/EventBus' { interface GameEvents { 'quest:done': { id: string } } }` |
| Input actions | augment `ActionMap` in `@ingine/engine/config/bindings`, then `game.input.setBindings({ ...defaultBindings, castSpell: ['KeyQ'] })` |
| Save slot | `new SaveSystem({ key: 'my-game.save' })` |

`apps/sandbox/src/content/index.ts` (`registerContent`) does all of this for the playground.
`config/player.ts`, `config/combat.ts` and `config/bindings.ts` are engine
defaults a game may override. The greybox model builders (`inventory/models.ts`,
`inventory/weaponModels.ts`, `world/propModels.ts`) are engine defaults too: a
game imports them for their side effect, as the sandbox's `main.ts` does, and
can replace any of them with real art via `registerModelOverrides`.

### Starting a new game

Copy `apps/sandbox` to `games/<name>`, rename the package in its
`package.json`, replace `src/content/` and `src/levels/` with your own, give
`SaveSystem` its own `key`, and run `npm install` at the root.
