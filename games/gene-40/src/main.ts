import '@ingine/engine/ui/styles.css';
import '@ingine/multiplayer/multiplayer.css';
import '@ingine/voice/voice.css';
import { Game } from '@ingine/engine/core/Game';
import { Hud } from '@ingine/engine/ui/Hud';
import { CombatSystem } from '@ingine/engine/combat/CombatSystem';
// Thrown things (the axes) fly as projectiles.
import '@ingine/engine/combat/projectiles';
import { InventorySystem } from '@ingine/engine/inventory/InventorySystem';
import { InventoryUi } from '@ingine/engine/ui/InventoryUi';
import '@ingine/engine/inventory/models';
import { NetSystem } from '@ingine/multiplayer/NetSystem';
import { RoomHud } from '@ingine/multiplayer/RoomHud';
import { showLobby, signallingFromUrl } from '@ingine/multiplayer/Lobby';
import { VoiceChat } from '@ingine/voice/VoiceChat';
import { VoiceHud } from '@ingine/voice/VoiceHud';
import { registerContent } from './content';
import { CHATTER, chatterTree, registerChatterVerbs } from './content/chatter';
import { DialogueSystem } from '@ingine/engine/dialogue/DialogueSystem';
import { DialogueUi } from '@ingine/engine/ui/DialogueUi';
import { GeneWorld } from './GeneWorld';
import { Teleports } from './Teleports';

/** Keeps this game's rooms apart from any other game using the same broker. */
const APP_ID = 'ingine-gene-40';

async function main(): Promise<void> {
  registerContent();
  registerChatterVerbs();
  const container = document.getElementById('app')!;
  const game = new Game(container);
  game.addSystem(new CombatSystem());
  game.addSystem(
    new Hud(container, {
      title: "Gene's 40th",
      controls: [
        ['Mouse', 'Look'],
        ['W A S D', 'Move'],
        ['Space / Shift / C', 'Jump / sprint / crouch'],
        ['Walk onto a portal', 'Visit a world'],
        ['H', 'Back to the party plaza'],
        ['E', 'Pick things up, talk'],
        ['Tab / I', 'Bag: read, use or drop items'],
        ['V (hold)', 'Talk (push-to-talk)'],
        ['B', 'Switch between push-to-talk and open mic'],
        ['M', 'Mute your microphone'],
        ['Esc', 'Free the mouse (to copy the invite link)'],
      ],
    }),
  );
  game.addSystem(new InventorySystem());
  game.addSystem(new InventoryUi(container));
  game.addSystem(new DialogueSystem(CHATTER.map(chatterTree)));
  game.addSystem(new DialogueUi(container));
  const net = game.addSystem(new NetSystem());
  game.addSystem(new RoomHud(container));
  const voice = game.addSystem(new VoiceChat({ spatial: net }));
  game.addSystem(new VoiceHud(container));
  // Light up the ring over whoever is talking.
  voice.onSpeaking = (id, level) => {
    const a = net.avatar(id);
    if (a) a.speaking = level;
  };

  const teleports = game.addSystem(new Teleports(container));

  await game.init();
  await game.loadLevel(new GeneWorld(teleports));
  game.start();

  // Handy from the dev console (and used by the headless checks).
  Object.assign(window, { game, net, voice, teleports, inventory: game.getSystem('inventory') });

  const room = await showLobby({
    container,
    title: 'Happy 40th, Gene!',
    subtitle: 'A party plaza with portals to worlds made for you. Play solo, or host a room and send friends the link.',
    appId: APP_ID,
    signalling: signallingFromUrl(),
  });
  net.attach(room);
  void voice.start(room);
}

main().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML(
    'beforeend',
    `<pre style="position:fixed;inset:20px;color:#f88;white-space:pre-wrap">${String(err?.stack ?? err)}</pre>`,
  );
});
