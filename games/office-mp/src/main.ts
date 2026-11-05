import '@ingine/engine/ui/styles.css';
import '@ingine/multiplayer/multiplayer.css';
import '@ingine/voice/voice.css';
import { Game } from '@ingine/engine/core/Game';
import { Hud } from '@ingine/engine/ui/Hud';
import { CombatSystem } from '@ingine/engine/combat/CombatSystem';
import { InventorySystem } from '@ingine/engine/inventory/InventorySystem';
import { InventoryUi } from '@ingine/engine/ui/InventoryUi';
import '@ingine/engine/inventory/models';
import { NetSystem } from '@ingine/multiplayer/NetSystem';
import { RoomHud } from '@ingine/multiplayer/RoomHud';
import { showLobby, signallingFromUrl } from '@ingine/multiplayer/Lobby';
import { VoiceChat } from '@ingine/voice/VoiceChat';
import { VoiceHud } from '@ingine/voice/VoiceHud';
import { registerContent } from './content';
import { OfficeLevel } from './OfficeLevel';

/** Keeps this game's rooms apart from any other game using the same broker. */
const APP_ID = 'ingine-office-mp';

async function main(): Promise<void> {
  registerContent();
  const container = document.getElementById('app')!;
  const game = new Game(container);
  game.addSystem(new CombatSystem());
  game.addSystem(
    new Hud(container, {
      title: 'Office floor',
      controls: [
        ['Mouse', 'Look'],
        ['W A S D', 'Move'],
        ['Space / Shift / C', 'Jump / sprint / crouch'],
        ['E', 'Pick things up'],
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
  const net = game.addSystem(new NetSystem());
  game.addSystem(new RoomHud(container));
  const voice = game.addSystem(new VoiceChat({ spatial: net }));
  game.addSystem(new VoiceHud(container));
  // Light up the ring over whoever is talking.
  voice.onSpeaking = (id, level) => {
    const a = net.avatar(id);
    if (a) a.speaking = level;
  };

  await game.init();
  await game.loadLevel(new OfficeLevel());
  game.start();

  // Handy from the dev console (and used by the headless checks).
  Object.assign(window, { game, net, voice, inventory: game.getSystem('inventory') });

  const room = await showLobby({
    container,
    title: 'Office floor',
    subtitle: 'Multiplayer test: walk around, pick things up, talk.',
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
