import { Room, RoomError, type RoomOptions, type SignallingConfig } from '@ingine/net/Room';
import { normaliseRoomCode } from '@ingine/net/codes';

export interface LobbyOptions extends Omit<RoomOptions, 'name'> {
  container: HTMLElement;
  title: string;
  /** One line under the title. */
  subtitle?: string;
}

const NAME_KEY = 'ingine.mp.name';

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode: fine */
    }
  },
};

/**
 * `?signal=localhost:9000` (or `?signal=https://broker.example.com/path`) points
 * the game at another signalling broker: a local one for tests and offline
 * development, or your own instead of the public PeerJS cloud.
 */
export function signallingFromUrl(search = location.search): SignallingConfig | undefined {
  const raw = new URLSearchParams(search).get('signal');
  if (!raw) return undefined;
  const url = new URL(/^[a-z]+:\/\//.test(raw) ? raw : `http://${raw}`);
  const secure = url.protocol === 'https:';
  return { host: url.hostname, port: Number(url.port) || (secure ? 443 : 80), path: url.pathname || '/', secure };
}

/** The invite link for a room: this page with ?room=CODE. */
export function inviteLink(code: string): string {
  const u = new URL(location.href);
  u.searchParams.set('room', code);
  return u.toString();
}

/**
 * The first screen: pick a name, then host a room or join one by code. A
 * link with ?room=CODE fills in the code. Resolves with the connected room.
 * (Clicking Host or Join also counts as the page interaction browsers want
 * before they let voice audio play.)
 */
export function showLobby(opts: LobbyOptions): Promise<Room> {
  const params = new URLSearchParams(location.search);
  const presetCode = params.get('room') ?? '';
  const presetName = params.get('name') ?? store.get(NAME_KEY) ?? '';

  const root = document.createElement('div');
  root.className = 'mp-lobby';
  root.innerHTML = `
    <form class="mp-panel" autocomplete="off">
      <h1></h1>
      <p class="mp-sub"></p>
      <label>Your name <input name="name" maxlength="24" placeholder="e.g. Sam" required></label>
      <div class="mp-row">
        <button type="button" class="mp-host">Host a room</button>
      </div>
      <div class="mp-or"><span>or join a friend</span></div>
      <div class="mp-row">
        <input name="code" maxlength="8" placeholder="Room code" spellcheck="false" autocapitalize="characters">
        <button type="submit" class="mp-join">Join</button>
      </div>
      <p class="mp-status" role="status"></p>
      <p class="mp-note">Voice chat asks for your microphone. Headphones stop others hearing themselves through your speakers.</p>
    </form>`;
  root.querySelector('h1')!.textContent = opts.title;
  root.querySelector('.mp-sub')!.textContent = opts.subtitle ?? '';
  opts.container.appendChild(root);

  const form = root.querySelector('form')!;
  const nameEl = form.elements.namedItem('name') as HTMLInputElement;
  const codeEl = form.elements.namedItem('code') as HTMLInputElement;
  const status = root.querySelector<HTMLElement>('.mp-status')!;
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('button')];
  nameEl.value = presetName;
  codeEl.value = presetCode;
  (presetName ? (presetCode ? root.querySelector<HTMLButtonElement>('.mp-join')! : codeEl) : nameEl).focus();

  return new Promise<Room>((resolve) => {
    const go = async (mode: 'host' | 'join') => {
      const name = nameEl.value.trim();
      if (!name) {
        nameEl.focus();
        status.textContent = 'Pick a name first.';
        return;
      }
      const code = normaliseRoomCode(codeEl.value);
      if (mode === 'join' && !code) {
        codeEl.focus();
        status.textContent = 'Type the room code your friend gave you.';
        return;
      }
      store.set(NAME_KEY, name);
      buttons.forEach((b) => (b.disabled = true));
      status.textContent = mode === 'host' ? 'Opening a room…' : `Joining ${code}…`;
      try {
        const room = mode === 'host' ? await Room.host({ ...opts, name }) : await Room.join(code, { ...opts, name });
        root.remove();
        history.replaceState(null, '', inviteLink(room.code));
        resolve(room);
      } catch (e) {
        status.textContent = e instanceof RoomError ? e.message : `Something went wrong: ${(e as Error).message}`;
        buttons.forEach((b) => (b.disabled = false));
      }
    };
    root.querySelector('.mp-host')!.addEventListener('click', () => void go('host'));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void go('join');
    });
  });
}
