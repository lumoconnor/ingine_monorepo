import '@ingine/engine/ui/styles.css';
import { Game } from '@ingine/engine/core/Game';
import { Hud } from '@ingine/engine/ui/Hud';
import { TouchControls } from '@ingine/engine/input/TouchControls';
import { PlaygroundLevel } from './levels/PlaygroundLevel';
import { PlayerController } from '@ingine/engine/gameplay/player/PlayerController';
import { DialogueSystem } from '@ingine/engine/dialogue/DialogueSystem';
import { DialogueUi } from '@ingine/engine/ui/DialogueUi';
import { registerContent, dialogueTrees } from './content';
import { InventorySystem } from '@ingine/engine/inventory/InventorySystem';
import { InventoryUi } from '@ingine/engine/ui/InventoryUi';
import { SaveSystem } from '@ingine/engine/core/SaveSystem';
import { CombatSystem } from '@ingine/engine/combat/CombatSystem';
import '@ingine/engine/combat/projectiles';
import { CombatFx } from '@ingine/engine/combat/feel/CombatFx';
import { CombatAudio } from '@ingine/engine/combat/feel/CombatAudio';
import '@ingine/engine/combat/blocking';
import '@ingine/engine/combat/Armour';
import '@ingine/engine/inventory/models';
import '@ingine/engine/world/propModels';
import { loadModelAssets } from '@ingine/engine/render/models/ModelRegistry';
import type { Level } from '@ingine/engine/world/Level';
import { WorldLevel, DEFAULT_WORLD_SEED } from './levels/world/WorldLevel';

/**
 * `?level=world` opens the procedurally generated world (`&seed=N` picks
 * another one); anything else is the movement playground.
 */
function pickLevel(): { level: Level; saveKey?: string } {
  const params = new URLSearchParams(location.search);
  if (params.get('level') === 'world') {
    const raw = parseInt(params.get('seed') ?? '', 10);
    const seed = Number.isFinite(raw) ? raw >>> 0 : DEFAULT_WORLD_SEED;
    document.title = `Open World RPG — Procedural World (seed ${seed})`;
    // Each world keeps its own save so positions never carry across worlds.
    return { level: new WorldLevel(seed), saveKey: `ingine.world.${seed}` };
  }
  return { level: new PlaygroundLevel() };
}

async function main(): Promise<void> {
  registerContent();
  const container = document.getElementById('app')!;
  const game = new Game(container);
  const { level, saveKey } = pickLevel();
  game.addSystem(new CombatSystem());
  game.addSystem(new CombatFx());
  game.addSystem(new CombatAudio());
  game.addSystem(new Hud(container));
  game.addSystem(new TouchControls(container));
  game.addSystem(new DialogueSystem(dialogueTrees));
  game.addSystem(new DialogueUi(container));
  game.addSystem(new InventorySystem());
  game.addSystem(new InventoryUi(container));
  game.addSystem(new SaveSystem({ key: saveKey }));

  await game.init();
  // Real art listed in content/models.json replaces the greybox (nothing listed yet).
  await loadModelAssets();
  await game.loadLevel(level);
  game.start();

  // Handy for live-tuning from the dev console, e.g.
  //   player.cfg.jumpHeight = 2; player.cfg.sprintSpeed = 10
  Object.assign(window, {
    game,
    player: game.world.find('player')?.get(PlayerController),
    dialogue: game.getSystem('dialogue'),
    inventory: game.getSystem('inventory'),
    saves: game.getSystem('save'),
    combat: game.getSystem('combat'),
    worldgen: level instanceof WorldLevel ? level : undefined,
  });
}

main().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML(
    'beforeend',
    `<pre style="position:fixed;inset:20px;color:#f88;white-space:pre-wrap">${String(err?.stack ?? err)}</pre>`,
  );
});
