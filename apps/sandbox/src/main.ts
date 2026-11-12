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
import { prebuildCharacters } from '@ingine/engine/render/painterly/characters';

async function main(): Promise<void> {
  registerContent();
  const container = document.getElementById('app')!;
  const game = new Game(container);
  game.addSystem(new CombatSystem());
  game.addSystem(new CombatFx());
  game.addSystem(new CombatAudio());
  game.addSystem(new Hud(container));
  game.addSystem(new TouchControls(container));
  game.addSystem(new DialogueSystem(dialogueTrees));
  game.addSystem(new DialogueUi(container));
  game.addSystem(new InventorySystem());
  game.addSystem(new InventoryUi(container));
  game.addSystem(new SaveSystem());

  await game.init();
  // Real art listed in content/models.json replaces the greybox (nothing listed yet).
  await loadModelAssets();
  // Sculpt the painterly characters (content/characters.json) before the level spawns them.
  await prebuildCharacters();
  await game.loadLevel(new PlaygroundLevel());
  game.start();
  // P toggles the oil-paint filter (remembered).
  const paintKey = 'ingine.paintFilter';
  try {
    game.renderer.paintFilter = localStorage.getItem(paintKey) === '1';
  } catch {
    /* storage blocked */
  }
  addEventListener('keydown', (e) => {
    if (e.code !== 'KeyP' || e.repeat) return;
    game.renderer.paintFilter = !game.renderer.paintFilter;
    try {
      localStorage.setItem(paintKey, game.renderer.paintFilter ? '1' : '0');
    } catch {
      /* storage blocked */
    }
  });

  // Handy for live-tuning from the dev console, e.g.
  //   player.cfg.jumpHeight = 2; player.cfg.sprintSpeed = 10
  Object.assign(window, {
    game,
    player: game.world.find('player')?.get(PlayerController),
    dialogue: game.getSystem('dialogue'),
    inventory: game.getSystem('inventory'),
    saves: game.getSystem('save'),
    combat: game.getSystem('combat'),
  });
}

main().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML(
    'beforeend',
    `<pre style="position:fixed;inset:20px;color:#f88;white-space:pre-wrap">${String(err?.stack ?? err)}</pre>`,
  );
});
