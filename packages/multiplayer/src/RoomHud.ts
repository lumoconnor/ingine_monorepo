import type { Game } from '@ingine/engine/core/Game';
import type { System } from '@ingine/engine/core/System';
import { colourFor } from './RemoteAvatar';
import { inviteLink } from './Lobby';
import type { NetSystem } from './NetSystem';
import './events';

/**
 * Top-right panel: the room code, a copy-invite button (usable when the
 * mouse is free, e.g. after Esc), and who's here. Speaking players are
 * highlighted when voice is on.
 */
export class RoomHud implements System {
  readonly name = 'room-hud';
  private game!: Game;
  private root = document.createElement('div');
  private list!: HTMLUListElement;
  private key = '';

  constructor(private container: HTMLElement) {}

  init(game: Game): void {
    this.game = game;
    this.root.className = 'mp-room hidden';
    this.root.innerHTML = `
      <div class="mp-room-head"><span class="mp-code"></span><button class="mp-copy" type="button">Copy invite link</button></div>
      <ul class="mp-players"></ul>
      <div class="mp-closed hidden"></div>`;
    this.container.appendChild(this.root);
    this.list = this.root.querySelector('ul')!;
    const copy = this.root.querySelector<HTMLButtonElement>('.mp-copy')!;
    copy.addEventListener('click', async () => {
      const room = this.net()?.room;
      if (!room) return;
      try {
        await navigator.clipboard.writeText(inviteLink(room.code));
        copy.textContent = 'Copied';
      } catch {
        copy.textContent = inviteLink(room.code);
      }
      setTimeout(() => (copy.textContent = 'Copy invite link'), 2000);
    });
    game.events.on('net:attached', ({ code }) => {
      this.root.classList.remove('hidden');
      this.root.querySelector('.mp-code')!.textContent = `Room ${code}`;
    });
    game.events.on('net:closed', ({ reason }) => {
      const el = this.root.querySelector('.mp-closed')!;
      el.textContent = reason;
      el.classList.remove('hidden');
    });
  }

  private net(): NetSystem | undefined {
    return this.game.getSystem<NetSystem>('net');
  }

  update(): void {
    const net = this.net();
    const room = net?.room;
    if (!room) return;
    const rows = room.everyone().map((p) => {
      const self = p.id === room.self.id;
      const speaking = self ? false : (net!.avatar(p.id)?.speaking ?? 0) > 0;
      return { id: p.id, label: `${p.name}${self ? ' (you)' : ''}${p.isHost ? ' · host' : ''}`, speaking };
    });
    const key = JSON.stringify(rows);
    if (key === this.key) return;
    this.key = key;
    this.list.replaceChildren(
      ...rows.map((r) => {
        const li = document.createElement('li');
        li.classList.toggle('speaking', r.speaking);
        const dot = document.createElement('i');
        dot.style.background = `#${colourFor(r.id).toString(16).padStart(6, '0')}`;
        li.append(dot, r.label);
        return li;
      }),
    );
  }
}
