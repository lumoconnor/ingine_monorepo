import { Game } from '@/core/Game';
import { Hud } from '@/ui/Hud';
import { TouchControls } from '@/input/TouchControls';
import { PlaygroundLevel } from '@/world/levels/PlaygroundLevel';
import { PlayerController } from '@/gameplay/player/PlayerController';
import { DialogueSystem } from '@/dialogue/DialogueSystem';
import { DialogueUi } from '@/ui/DialogueUi';
import { dialogueTrees } from '@/content/dialogue';
import { InventorySystem } from '@/inventory/InventorySystem';
import { InventoryUi } from '@/ui/InventoryUi';
import { SaveSystem } from '@/core/SaveSystem';
import { CombatSystem } from '@/combat/CombatSystem';
import '@/combat/projectiles';
import { CombatFx } from '@/combat/feel/CombatFx';
import { CombatAudio } from '@/combat/feel/CombatAudio';
import '@/combat/blocking';
import '@/combat/Armour';
import '@/inventory/models';
import '@/world/propModels';
import { loadModelAssets } from '@/render/models/ModelRegistry';

async function main(): Promise<void> {
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
  await game.loadLevel(new PlaygroundLevel());
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
  });
}

main().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML(
    'beforeend',
    `<pre style="position:fixed;inset:20px;color:#f88;white-space:pre-wrap">${String(err?.stack ?? err)}</pre>`,
  );
});
