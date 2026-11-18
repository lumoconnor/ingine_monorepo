import type { Game } from '../core/Game';
import type { System } from '../core/System';
import type { DialogueSystem } from '../dialogue/DialogueSystem';

/**
 * Conversation panel plus on-screen notifications. Pure view: it renders
 * 'dialogue:line' events and calls DialogueSystem.choose().
 *
 * Lines can type out letter by letter (`typeSpeed`), with a 'dialogue:char'
 * event per letter; E, Space, Enter or a click shows the rest at once.
 *
 *   1-9            pick a reply
 *   W/S, wheel     move the highlight     E, Space, Enter, click   pick it
 *   Esc            leave (releases the mouse)
 */
export class DialogueUi implements System {
  readonly name = 'dialogue-ui';
  private dialogue!: DialogueSystem;
  private panel: HTMLDivElement;
  private speaker: HTMLDivElement;
  private text: HTMLParagraphElement;
  private list: HTMLOListElement;
  private toasts: HTMLDivElement;
  private count = 0;
  private highlight = 0;
  private open = false;
  private game!: Game;
  /** The line being typed out, how much of it shows, and the frame driving it. */
  private full = '';
  private shown = 0;
  private typeStart = 0;
  private raf = 0;
  private speakerName = '';

  /**
   * `typeSpeed`: letters per second to type each line out at (old-RPG style),
   * emitting 'dialogue:char' per letter for talk blips. 0 shows lines at once.
   */
  constructor(container: HTMLElement, private opts: { typeSpeed?: number } = {}) {
    const root = document.createElement('div');
    root.className = 'hud dialogue-layer';
    root.innerHTML = `
      <div class="toasts"></div>
      <div class="dialogue hidden">
        <div class="speaker"></div>
        <p class="line"></p>
        <ol class="choices"></ol>
        <div class="dialogue-help">1-9 or wheel + click to reply · Esc to leave</div>
      </div>`;
    container.appendChild(root);
    this.panel = root.querySelector('.dialogue')!;
    this.speaker = root.querySelector('.speaker')!;
    this.text = root.querySelector('.line')!;
    this.list = root.querySelector('.choices')!;
    this.toasts = root.querySelector('.toasts')!;
  }

  init(game: Game): void {
    this.game = game;
    this.dialogue = game.getSystem<DialogueSystem>('dialogue')!;
    game.events.on('dialogue:start', () => {
      this.open = true;
      this.panel.classList.remove('hidden');
    });
    game.events.on('dialogue:end', () => {
      this.open = false;
      this.stopTyping();
      this.panel.classList.add('hidden');
    });
    game.events.on('dialogue:line', (line) => this.show(line));
    game.events.on('notify', ({ text }) => this.toast(text));

    window.addEventListener('keydown', this.onKey);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('mousedown', this.onMouseDown);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('mousedown', this.onMouseDown);
  }

  private show(line: { speaker: string; text: string; choices: { text: string; seen: boolean }[] }): void {
    this.speaker.textContent = line.speaker;
    this.speakerName = line.speaker;
    this.full = line.text;
    this.stopTyping();
    if ((this.opts.typeSpeed ?? 0) > 0) {
      this.shown = 0;
      this.text.textContent = '';
      this.typeStart = performance.now();
      this.raf = requestAnimationFrame(this.typeTick);
    } else {
      this.shown = line.text.length;
      this.text.textContent = line.text;
    }
    this.list.replaceChildren(
      ...line.choices.map((c, i) => {
        const li = document.createElement('li');
        li.innerHTML = `<kbd>${i + 1}</kbd><span></span>`;
        li.querySelector('span')!.textContent = c.text;
        li.classList.toggle('seen', c.seen);
        // Clickable directly when the cursor is free (drag-to-look mode).
        li.addEventListener('mouseenter', () => this.setHighlight(i));
        li.addEventListener('click', (e) => {
          e.stopPropagation();
          this.pick(i);
        });
        return li;
      }),
    );
    this.count = line.choices.length;
    // Start on the first reply not yet explored.
    const fresh = line.choices.findIndex((c) => !c.seen);
    this.setHighlight(fresh < 0 ? 0 : fresh);
    // Restart the fade-in.
    this.panel.classList.remove('fade');
    void this.panel.offsetWidth;
    this.panel.classList.add('fade');
  }

  /** True while a line is still typing out. */
  get typing(): boolean {
    return this.shown < this.full.length;
  }

  private typeTick = (now: number): void => {
    const want = Math.min(this.full.length, Math.floor(((now - this.typeStart) / 1000) * (this.opts.typeSpeed ?? 40)));
    while (this.shown < want) {
      const ch = this.full[this.shown];
      this.game.events.emit('dialogue:char', { speaker: this.speakerName, char: ch, index: this.shown });
      this.shown++;
    }
    this.text.textContent = this.full.slice(0, this.shown);
    this.raf = this.typing ? requestAnimationFrame(this.typeTick) : 0;
  };

  /** Show the rest of the line now (a click or E while it's typing). */
  finishTyping(): void {
    this.stopTyping();
    this.shown = this.full.length;
    this.text.textContent = this.full;
  }

  private stopTyping(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private setHighlight(i: number): void {
    if (this.count === 0) return;
    this.highlight = (i + this.count) % this.count;
    [...this.list.children].forEach((li, j) => li.classList.toggle('active', j === this.highlight));
  }

  private pick(i: number): void {
    if (!this.open || i < 0 || i >= this.count) return;
    this.dialogue.choose(i);
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.open || e.repeat) return;
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (digit) return this.pick(Number(digit[1]) - 1);
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        return this.setHighlight(this.highlight - 1);
      case 'KeyS':
      case 'ArrowDown':
        return this.setHighlight(this.highlight + 1);
      case 'KeyE':
      case 'Space':
      case 'Enter':
      case 'NumpadEnter':
        if (this.typing) return this.finishTyping();
        return this.pick(this.highlight);
    }
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.open || e.deltaY === 0) return;
    this.setHighlight(this.highlight + Math.sign(e.deltaY));
  };

  private onMouseDown = (e: MouseEvent): void => {
    // With pointer lock the cursor is hidden, so a click picks the highlighted reply.
    if (!this.open || e.button !== 0 || !document.pointerLockElement) return;
    if (this.typing) return this.finishTyping();
    this.pick(this.highlight);
  };

  private toast(text: string): void {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    this.toasts.appendChild(el);
    setTimeout(() => el.classList.add('out'), 3200);
    setTimeout(() => el.remove(), 3700);
    while (this.toasts.children.length > 4) this.toasts.firstElementChild!.remove();
  }
}
