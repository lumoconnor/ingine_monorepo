import type { Game } from '@ingine/engine/core/Game';
import type { System } from '@ingine/engine/core/System';
import type { VoiceChat } from './VoiceChat';

/**
 * Bottom-left mic indicator: whether you're being heard, how to talk, and
 * a level meter so you can see your mic works.
 */
export class VoiceHud implements System {
  readonly name = 'voice-hud';
  private game!: Game;
  private root = document.createElement('div');
  private text!: HTMLSpanElement;
  private fill!: HTMLDivElement;

  constructor(private container: HTMLElement) {}

  init(game: Game): void {
    this.game = game;
    this.root.className = 'voice-hud hidden';
    this.root.innerHTML = `<span class="voice-dot"></span><span class="voice-text"></span><div class="voice-meter"><div></div></div>`;
    this.container.appendChild(this.root);
    this.text = this.root.querySelector('.voice-text')!;
    this.fill = this.root.querySelector('.voice-meter div')!;
    game.events.on('voice:state', ({ mic, mode, muted, transmitting }) => {
      this.root.classList.toggle('hidden', mic === 'off');
      this.root.classList.toggle('live', transmitting);
      this.root.classList.toggle('muted', muted || mic === 'unavailable');
      this.text.textContent =
        mic === 'asking'
          ? 'Allow the microphone to talk'
          : mic === 'unavailable'
            ? 'No microphone: listening only'
            : muted
              ? 'Muted (M to unmute)'
              : mode === 'open'
                ? transmitting
                  ? 'Open mic (B for push-to-talk)'
                  : 'Open mic'
                : transmitting
                  ? 'Talking'
                  : 'Hold V to talk (B for open mic)';
    });
  }

  update(): void {
    const v = this.game.getSystem<VoiceChat>('voice');
    if (!v) return;
    this.fill.style.width = `${Math.min(100, v.selfLevel * 400)}%`;
  }
}
