import type { Game } from '../core/Game';
import type { System } from '../core/System';
import type { FrameTime } from '../core/Time';
import { PlayerController } from '../gameplay/player/PlayerController';
import type { SaveSystem } from '../core/SaveSystem';
import { Damageable } from '../combat/Damageable';
import { Combatant } from '../combat/Combatant';
import { PlayerCombat } from '../combat/PlayerCombat';
import { Items } from '../inventory/catalog';
import { Statuses } from '../combat/registry';
import * as THREE from 'three';

interface FloatingNumber {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  age: number;
}
const NUMBER_LIFE = 0.9;
const fullscreenElement = (): Element | null =>
  document.fullscreenElement ?? (document as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement ?? null;
const _v = new THREE.Vector3();

export interface HudOptions {
  /** Heading on the start screen. */
  title?: string;
  /** Rows for the start screen's controls table (input, what it does). Defaults to the full engine list. */
  controls?: [string, string][];
}

const escapeHtml = (t: string) =>
  t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const controlsTable = (rows: [string, string][]) =>
  `<table class="controls">${rows.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join('')}</table>`;

/**
 * DOM overlay: click-to-play screen, crosshair and a debug readout.
 * Also owns browser-level concerns (fullscreen, keyboard lock, leave-page guard).
 */
export class Hud implements System {
  readonly name = 'hud';
  private game!: Game;
  private root: HTMLDivElement;
  private overlay: HTMLDivElement;
  private debug: HTMLPreElement;
  private crosshair: HTMLDivElement;
  /** Four ticks around the dot, as far out as a shot can land (guns, bows). */
  private spreadEl: HTMLDivElement;
  private spreadGap = 0;
  private hint: HTMLDivElement;
  private prompt: HTMLDivElement;
  private promptText: string | null = null;
  private talking = false;
  private debugVisible = true;
  private hasPlayed = false;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;
  private healthEl!: HTMLDivElement;
  private healthFill!: HTMLDivElement;
  private healthText!: HTMLSpanElement;
  private hurtEl!: HTMLDivElement;
  private hitmarker!: HTMLDivElement;
  private numbersEl!: HTMLDivElement;
  private deathEl!: HTMLDivElement;
  private numbers: FloatingNumber[] = [];
  private hurt = 0;
  private marker = 0;
  private shownHp = -1;
  private weaponEl!: HTMLDivElement;
  private weaponKey = '';
  private staminaEl!: HTMLDivElement;
  private staminaFill!: HTMLDivElement;
  private statusEl!: HTMLDivElement;
  private statusKey = '';
  private msgEl!: HTMLDivElement;
  private msgTime = 0;
  private dirsEl!: HTMLDivElement;
  private dirs: { el: HTMLDivElement; from: THREE.Vector3; age: number }[] = [];

  constructor(container: HTMLElement, opts: HudOptions = {}) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="underwater hidden"></div>
      <div class="hurt"></div>
      <div class="crosshair"></div>
      <div class="spread hidden"><i class="n"></i><i class="e"></i><i class="s"></i><i class="w"></i></div>
      <div class="hitmarker"></div>
      <div class="numbers"></div>
      <div class="health"><div class="bars"><div class="bar"><div class="fill"></div></div><div class="sbar"><div class="sfill"></div></div></div><span class="hp">100</span><div class="statuses"></div></div>
      <div class="combat-msg"></div>
      <div class="dmg-dirs"></div>
      <div class="weapon hidden"><div class="wname"></div><div class="ammo"></div><div class="wbar hidden"><div class="wfill"></div></div><div class="wstep"></div><div class="slots"></div></div>
      <div class="death hidden"><div>You died</div><small></small></div>
      <div class="prompt hidden"><kbd>E</kbd><span></span></div>
      <pre class="debug"></pre>
      <div class="hint hidden">Mouse capture isn't available here, so hold the left button and drag to look.</div>
      <div class="overlay">
        <div class="panel">
          <h1>${escapeHtml(opts.title ?? 'Movement Playground')}</h1>
          <p class="status">Loading physics…</p>
          <button class="play" disabled>Click to play</button>
          <button class="newgame hidden">New game</button>
          <button class="fullscreen-btn">Fullscreen</button>
          ${opts.controls ? controlsTable(opts.controls) : `<table class="controls">
            <tr><td>Mouse</td><td>Look</td></tr>
            <tr><td>W A S D</td><td>Move</td></tr>
            <tr><td>Space</td><td>Jump (hold for higher)</td></tr>
            <tr><td>Shift (hold)</td><td>Sprint</td></tr>
            <tr><td>Ctrl / Cmd / C</td><td>Crouch</td></tr>
            <tr><td>Left click</td><td>Attack: punch, swing (hold for a heavy blow), shoot; hold to draw a bow or cook a grenade, release to loose or throw</td></tr>
            <tr><td>Right click</td><td>Aim (pistol), or guard with a sword or fists; raise it just as a blow lands to parry</td></tr>
            <tr><td>1 2 3 4 / R / T</td><td>Draw a weapon (again to put it away) / reload or nock / switch arrows</td></tr>
            <tr><td>E</td><td>Use: doors, levers, buttons, lifts, talk, pick up</td></tr>
            <tr><td>Tab / I</td><td>Inventory (pauses): use, read, drop items</td></tr>
            <tr><td>F5 / F9</td><td>Save / load (also autosaves)</td></tr>
            <tr><td>Talking</td><td>1-9 to reply, or wheel / W S + click or E. Esc leaves</td></tr>
            <tr><td>Water</td><td>W swims where you look, Space up, Ctrl/C down. Swim into a low edge to climb out</td></tr>
            <tr><td>Ziplines</td><td>E or jump to grab, W pulls on flat cable, Space lets go</td></tr>
            <tr><td>Steep slopes</td><td>You slide; A/D steer, Space hops off</td></tr>
            <tr><td>Ladders</td><td>Walk into one to grab. W/S climb, Space jumps off</td></tr>
            <tr><td>F</td><td>Fullscreen (makes Ctrl+W safe)</td></tr>
            <tr><td>Backspace</td><td>Respawn (if stuck)</td></tr>
            <tr><td>\` or F3</td><td>Toggle debug info</td></tr>
            <tr><td>Esc</td><td>Release mouse / pause</td></tr>
          </table>`}
        </div>
      </div>`;
    container.appendChild(this.root);
    this.overlay = this.root.querySelector('.overlay')!;
    this.debug = this.root.querySelector('.debug')!;
    this.crosshair = this.root.querySelector('.crosshair')!;
    this.spreadEl = this.root.querySelector('.spread')!;
    this.hint = this.root.querySelector('.hint')!;
    this.prompt = this.root.querySelector('.prompt')!;
    this.healthEl = this.root.querySelector('.health')!;
    this.healthFill = this.root.querySelector('.health .fill')!;
    this.healthText = this.root.querySelector('.health .hp')!;
    this.hurtEl = this.root.querySelector('.hurt')!;
    this.hitmarker = this.root.querySelector('.hitmarker')!;
    this.numbersEl = this.root.querySelector('.numbers')!;
    this.deathEl = this.root.querySelector('.death')!;
    this.weaponEl = this.root.querySelector('.weapon')!;
    this.staminaEl = this.root.querySelector('.health .sbar')!;
    this.staminaFill = this.root.querySelector('.health .sfill')!;
    this.statusEl = this.root.querySelector('.health .statuses')!;
    this.msgEl = this.root.querySelector('.combat-msg')!;
    this.dirsEl = this.root.querySelector('.dmg-dirs')!;
  }

  init(game: Game): void {
    this.game = game;
    const play = this.root.querySelector<HTMLButtonElement>('.play')!;
    const newGame = this.root.querySelector<HTMLButtonElement>('.newgame')!;
    const saves = () => game.getSystem<SaveSystem>('save');
    let continuing = false;
    play.addEventListener('click', () => {
      // First click of the session: pick up where the save left off.
      if (continuing) saves()?.load();
      continuing = false;
      newGame.classList.add('hidden');
      this.lock();
    });
    newGame.addEventListener('click', () => {
      saves()?.newGame();
      continuing = false;
      newGame.classList.add('hidden');
      this.lock();
    });
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.lock();
    });
    const fsBtn = this.root.querySelector<HTMLButtonElement>('.fullscreen-btn')!;
    fsBtn.addEventListener('click', () => void this.toggleFullscreen(false));
    const onFs = () => {
      fsBtn.textContent = fullscreenElement() ? 'Exit fullscreen' : 'Fullscreen';
    };
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);

    game.events.on('input:pointerlock', ({ locked }) => {
      this.overlay.classList.toggle('hidden', locked);
      if (!locked && this.hasPlayed) play.textContent = 'Resume';
      this.crosshair.classList.toggle('hidden', !locked);
      if (locked) this.hasPlayed = true;
      this.hint.classList.toggle('hidden', !(locked && game.input.dragLook && !game.input.touch));
      this.refreshPrompt();
    });

    const underwater = this.root.querySelector('.underwater')!;
    game.events.on('player:underwater', ({ underwater: u }) => underwater.classList.toggle('hidden', !u));

    game.events.on('interact:focus', ({ prompt }) => {
      this.promptText = prompt;
      this.refreshPrompt();
    });

    game.events.on('dialogue:start', () => {
      this.talking = true;
      this.refreshPrompt();
    });
    game.events.on('dialogue:end', () => {
      this.talking = false;
      this.refreshPrompt();
    });
    // The inventory screen counts as "talking" for the HUD: no prompt, no crosshair.
    game.events.on('inventory:open', () => {
      this.talking = true;
      this.refreshPrompt();
    });
    game.events.on('inventory:close', () => {
      this.talking = false;
      this.refreshPrompt();
    });

    game.events.on('level:loaded', () => {
      this.root.querySelector('.status')!.textContent = 'Ready.';
      play.disabled = false;
      if (saves()?.hasSave()) {
        continuing = true;
        play.textContent = 'Continue';
        newGame.classList.remove('hidden');
        this.root.querySelector('.status')!.textContent = 'Found a saved game.';
      }
    });

    game.events.on('input:pressed', ({ action }) => {
      if (action === 'toggleDebug') {
        this.debugVisible = !this.debugVisible;
        this.debug.classList.toggle('hidden', !this.debugVisible);
        game.events.emit('debug:toggle', { visible: this.debugVisible });
      } else if (action === 'toggleFullscreen' && game.input.locked) {
        this.toggleFullscreen();
      }
    });

    this.initCombat(game);

    // Ctrl/Cmd+W closes the tab and can't be intercepted outside fullscreen.
    // A leave-page prompt at least saves the session from an accidental crouch-walk.
    window.addEventListener('beforeunload', (e) => {
      if (this.hasPlayed) e.preventDefault();
    });

    this.crosshair.classList.add('hidden');
  }

  /** Health bar, red flash when hurt, hit marker and damage numbers, death screen. */
  private initCombat(game: Game): void {
    const isPlayer = (e: { name: string }) => e.name === 'player';
    game.events.on('combat:hit', ({ hit, target, result }) => {
      const tick = hit.delivery === 'status';
      if (isPlayer(target) && result.damage > 0) this.hurt = Math.min(1, this.hurt + (tick ? 0.12 : 0.25) + result.damage / 40);
      if (hit.attacker && isPlayer(hit.attacker) && !tick) {
        this.marker = 1;
        this.hitmarker.classList.toggle('kill', result.killed);
        this.hitmarker.classList.toggle('head', hit.zone === 'head');
        if (hit.point) this.spawnNumber(hit.point, result.damage, hit.zone === 'head');
      }
    });
    // Which way the blow came from: a red arc at the edge of the view.
    game.events.on('combat:hit', ({ hit, target, result }) => {
      if (!isPlayer(target) || !hit.attacker || isPlayer(hit.attacker) || (result.damage <= 0 && !result.tags.length)) return;
      const from = hit.attacker.object3d.position.clone();
      let d = this.dirs.find((x) => x.from.distanceTo(from) < 1.5);
      if (!d) {
        const el = document.createElement('div');
        el.className = 'dmg-dir';
        this.dirsEl.appendChild(el);
        d = { el, from, age: 0 };
        this.dirs.push(d);
      }
      d.from.copy(from);
      d.age = 0;
    });
    // Blocks and parries, yours and against you.
    game.events.on('combat:hit', ({ hit, target, result }) => {
      const mine = isPlayer(target);
      const byMe = !!hit.attacker && isPlayer(hit.attacker);
      if (!mine && !byMe) return;
      const t = result.tags;
      if (t.includes('parried')) this.combatMsg(mine ? 'Parried!' : 'They parried you', mine ? 'good' : 'bad');
      else if (t.includes('guardbreak')) this.combatMsg(mine ? 'Guard broken' : 'Guard broken!', mine ? 'bad' : 'good');
      else if (t.includes('blocked')) this.combatMsg(mine ? 'Blocked' : 'Blocked', mine ? 'good' : '');
      if (mine && result.statuses.includes('bleeding')) this.combatMsg('You\'re bleeding', 'bad');
    });
    game.events.on('combat:dry', ({ entity, reason }) => {
      if (isPlayer(entity) && reason === 'winded') this.combatMsg('Winded', 'bad');
    });
    game.events.on('combat:killed', ({ target, source }) => {
      if (!isPlayer(target)) return;
      const why: Record<string, string> = { fall: 'The fall was too much.', fists: 'Beaten.', bleeding: 'You bled out.', burning: 'You burned.' };
      this.deathEl.querySelector('small')!.textContent = why[source] ?? `Killed by the ${source}.`;
      this.deathEl.classList.remove('hidden');
    });
    game.events.on('combat:revived', ({ target }) => {
      if (isPlayer(target)) this.deathEl.classList.add('hidden');
    });
    game.events.on('game:loaded', () => {
      const d = game.world.find('player')?.get(Damageable);
      if (d && !d.dead) this.deathEl.classList.add('hidden');
    });
  }

  /** Bottom right: weapon name, rounds loaded / carried, reload or charge bar, slots. */
  private updateWeapon(): void {
    const player = this.game.world.find('player');
    const f = player?.get(Combatant);
    const pc = player?.get(PlayerCombat);
    if (!f || !pc) return;
    const item = f.itemId;
    const def = item ? Items[item] : undefined;
    const fm = f.feedMode();
    const loaded = fm ? f.loaded(fm[1]) : null;
    const cap = fm ? f.capacity(fm[1].feeder!) : null;
    const reserve = fm ? f.reserve() : null;
    const thrown = def?.weapon?.stack ? this.game.state.itemCount(item!) : null;
    const slots = pc.weaponSlots();
    const showBar = f.state === 'reloading' || f.state === 'charging';
    const key = [item, loaded, reserve, thrown, f.equipped, slots.join(','), f.state === 'reloading' ? f.reloadStep : '', showBar, this.game.input.locked].join('|');
    const bar = this.weaponEl.querySelector<HTMLDivElement>('.wbar')!;
    if (showBar) bar.querySelector<HTMLDivElement>('.wfill')!.style.width = `${Math.round(100 * (f.state === 'charging' ? f.charge : f.progress))}%`;
    if (key === this.weaponKey) return;
    this.weaponKey = key;
    this.weaponEl.classList.toggle('hidden', !this.game.input.locked || (!def && !slots.length));
    this.weaponEl.querySelector('.wname')!.textContent = def?.name ?? 'Fists';
    const ammo = this.weaponEl.querySelector('.ammo')!;
    ammo.textContent = cap !== null ? `${loaded} / ${reserve}` : thrown !== null ? `×${thrown}` : '';
    ammo.classList.toggle('empty', loaded === 0);
    bar.classList.toggle('hidden', !showBar);
    this.weaponEl.querySelector('.wstep')!.textContent = f.state === 'reloading' && f.reloadStep ? f.reloadStep : '';
    this.weaponEl.querySelector('.slots')!.replaceChildren(
      ...slots.slice(0, 4).map((uid, n) => {
        const el = document.createElement('span');
        const it = uid.startsWith('stack:') ? uid.slice(6) : this.game.state.instance(uid)?.item;
        el.textContent = `${n + 1} ${it ? (Items[it]?.name ?? it) : '?'}`;
        el.classList.toggle('on', uid === f.equipped);
        return el;
      }),
    );
  }

  /**
   * The spread ticks: placed on screen at the edge of the cone a shot can
   * leave in right now, so they open up from the hip and as you fire fast,
   * and close in when you aim down the sights.
   */
  private updateSpread(dt: number): void {
    const f = this.game.world.find('player')?.get(Combatant);
    const deg = f && f.itemId ? f.spreadDeg() : 0;
    const show = deg > 0 && !this.crosshair.classList.contains('hidden') && f!.state !== 'reloading' && f!.state !== 'equipping';
    this.spreadEl.classList.toggle('hidden', !show);
    // The ticks replace the dot (it comes back to mark something you can use).
    this.crosshair.classList.toggle('nodot', show);
    if (!show) return;
    const cam = this.game.renderer.camera;
    const halfH = window.innerHeight / 2;
    const px = (Math.tan(THREE.MathUtils.degToRad(deg)) / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) * halfH;
    // Quick to open on a shot, a touch slower to settle.
    const target = Math.max(5, px);
    this.spreadGap += (target - this.spreadGap) * (1 - Math.exp(-dt * (target > this.spreadGap ? 40 : 16)));
    this.spreadEl.style.setProperty('--gap', `${this.spreadGap.toFixed(1)}px`);
  }

  private combatMsg(text: string, kind: string): void {
    this.msgEl.textContent = text;
    this.msgEl.className = `combat-msg show ${kind}`;
    this.msgTime = 0.9;
  }

  /** Stamina under the health bar (only while it isn't full) and status chips beside it. */
  private updateVitals(dt: number): void {
    const player = this.game.world.find('player');
    const f = player?.get(Combatant);
    const d = player?.get(Damageable);
    if (f) {
      const k = f.stamina / f.maxStamina;
      this.staminaFill.style.width = `${Math.round(k * 100)}%`;
      this.staminaEl.classList.toggle('full', k >= 0.999);
      this.staminaEl.classList.toggle('out', f.stamina <= 0.01);
    }
    const key = d ? [...d.statuses.keys()].join(',') : '';
    if (key !== this.statusKey) {
      this.statusKey = key;
      this.statusEl.replaceChildren(
        ...[...(d?.statuses.keys() ?? [])].map((id) => {
          const el = document.createElement('span');
          el.className = `st ${id}`;
          el.textContent = Statuses[id]?.name ?? id;
          return el;
        }),
      );
    }
    const cam = this.game.renderer.camera;
    const yaw = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ').y;
    this.dirs = this.dirs.filter((d) => {
      d.age += dt;
      if (d.age > 1.4) {
        d.el.remove();
        return false;
      }
      // 0 = straight ahead, clockwise positive.
      const a = Math.atan2(d.from.x - cam.position.x, d.from.z - cam.position.z);
      const rel = -(a - yaw) + Math.PI;
      d.el.style.transform = `rotate(${rel}rad)`;
      d.el.style.opacity = String(Math.min(1, 1.6 * (1 - d.age / 1.4)));
      return true;
    });
    this.msgTime -= dt;
    if (this.msgTime <= 0 && this.msgEl.classList.contains('show')) this.msgEl.classList.remove('show');
  }

  private spawnNumber(point: THREE.Vector3, amount: number, head: boolean): void {
    const el = document.createElement('div');
    el.className = `num${head ? ' head' : ''}`;
    el.textContent = amount > 0 ? String(Math.round(amount)) : '0';
    this.numbersEl.appendChild(el);
    this.numbers.push({ el, pos: point.clone(), age: 0 });
  }

  private updateCombat(dt: number): void {
    const d = this.game.world.find('player')?.get(Damageable);
    if (d) {
      const hp = Math.ceil(d.health);
      if (hp !== this.shownHp) {
        this.shownHp = hp;
        this.healthFill.style.width = `${(100 * d.health) / d.maxHealth}%`;
        this.healthText.textContent = String(hp);
        this.healthEl.classList.toggle('low', d.health / d.maxHealth <= 0.3);
      }
    }
    this.healthEl.classList.toggle('hidden', !this.game.input.locked);
    this.updateWeapon();
    this.updateVitals(dt);
    this.hurt = Math.max(0, this.hurt - dt * 1.6);
    this.hurtEl.style.opacity = String(this.hurt);
    this.marker = Math.max(0, this.marker - dt * 5);
    this.hitmarker.style.opacity = String(this.marker);

    const cam = this.game.renderer.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.numbers = this.numbers.filter((n) => {
      n.age += dt;
      if (n.age >= NUMBER_LIFE) {
        n.el.remove();
        return false;
      }
      _v.copy(n.pos).setY(n.pos.y + 0.15 + n.age * 0.6).project(cam);
      const visible = _v.z < 1;
      n.el.style.display = visible ? '' : 'none';
      n.el.style.transform = `translate(${((_v.x + 1) / 2) * w}px, ${((1 - _v.y) / 2) * h}px) translate(-50%, -50%)`;
      n.el.style.opacity = String(1 - (n.age / NUMBER_LIFE) ** 2);
      return true;
    });
  }

  private refreshPrompt(): void {
    const show = this.promptText !== null && this.game.input.locked && !this.talking;
    this.prompt.classList.toggle('hidden', !show);
    this.crosshair.classList.toggle('hidden', !this.game.input.locked || this.talking);
    this.crosshair.classList.toggle('active', show);
    if (this.promptText !== null) this.prompt.querySelector('span')!.textContent = this.promptText;
  }

  private lock(): void {
    void this.game.input.requestPointerLock(this.game.renderer.webgl.domElement);
  }

  /**
   * Enter or leave fullscreen. `play`: also start / resume playing (the F key
   * does; the start screen's button doesn't). Works with Safari's webkit
   * prefix; iPhones have no page fullscreen at all, so that gets a hint instead.
   */
  async toggleFullscreen(play = true): Promise<void> {
    const nav = navigator as Navigator & { keyboard?: { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void } };
    const doc = document as Document & { webkitExitFullscreen?: () => Promise<void> | void };
    if (fullscreenElement()) {
      nav.keyboard?.unlock?.();
      try {
        await (document.exitFullscreen ? document.exitFullscreen() : doc.webkitExitFullscreen?.());
      } catch {
        /* already left */
      }
      return;
    }
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
    const req = el.requestFullscreen ?? el.webkitRequestFullscreen;
    try {
      if (!req) throw new Error('unsupported');
      await req.call(el);
    } catch {
      // Not allowed here (an embedded frame) or not supported (iPhone Safari).
      const iphone = /iPhone|iPod/.test(navigator.userAgent);
      this.game.events.emit('notify', {
        text: iphone
          ? "iPhone browsers can't go fullscreen. Turn the phone sideways, or use Share → Add to Home Screen"
          : "This page isn't allowed to go fullscreen here. Try opening it in its own tab",
      });
      return;
    }
    // Phones: play sideways. Only allowed while fullscreen, and not everywhere.
    if (this.game.input.preferTouch) {
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      o?.lock?.('landscape').catch(() => {});
    }
    // Keyboard Lock (Chromium) lets the page receive Ctrl+W etc. while fullscreen.
    try {
      await nav.keyboard?.lock?.();
    } catch {
      /* unsupported */
    }
    if (play) this.lock();
  }

  update(time: FrameTime): void {
    this.updateCombat(Math.min(time.delta, 0.1));
    this.updateSpread(Math.min(time.delta, 0.1));
    this.fpsFrames++;
    this.fpsTime += time.delta;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    if (!this.debugVisible) return;
    const ctrl = this.game.world.find('player')?.get(PlayerController);
    if (!ctrl) return;
    const p = ctrl.feetPosition;
    this.debug.textContent = [
      `fps       ${this.fps}`,
      `state     ${ctrl.state}`,
      `grounded  ${ctrl.grounded}${ctrl.groundCarrier ? ' (platform)' : ''}`,
      `speed     ${ctrl.horizontalSpeed.toFixed(2)} m/s`,
      `vel y     ${(ctrl.grounded ? 0 : ctrl.velocity.y).toFixed(2)} m/s`,
      `pos       ${p.x.toFixed(1)}, ${p.y.toFixed(2)}, ${p.z.toFixed(1)}`,
      `entities  ${this.game.world.count}`,
      `health    ${Math.ceil(this.game.world.find('player')?.get(Damageable)?.health ?? 0)}`,
      `items     ${this.game.state.inventory().map(([k, n]) => `${k}×${n}`).join(' ') || '-'}`,
    ].join('\n');
  }
}
