import type { System } from '@ingine/engine/core/System';

/** At most this many messages at once: older ones drop off the top. */
export const MAX_TOASTS = 3;

/**
 * Everything that shows at the top centre, in one column so nothing overlaps:
 * the world's score panel (.gene-panel), Hero city's emergency line
 * (.gene-alert), then the pop-up messages (the engine's .toasts), newest at
 * the bottom. Each world creates its own panel with absolute positioning;
 * this moves them into the column as they appear. The column has a height
 * cap and only the newest few messages show, so it can never cover the
 * screen.
 */
export class GeneTopStack implements System {
  readonly name = 'gene-top-stack';
  readonly column: HTMLDivElement;
  private observer: MutationObserver | null = null;

  constructor(private container: HTMLElement) {
    this.column = document.createElement('div');
    this.column.className = 'gene-top';
    const css = document.createElement('style');
    css.textContent = `
      .gene-top { position: absolute; top: 14px; left: 50%; transform: translateX(-50%); z-index: 6;
        display: flex; flex-direction: column; align-items: center; gap: 6px;
        width: max-content; max-width: min(92vw, 760px); max-height: 42vh; overflow: hidden; pointer-events: none; }
      .gene-top > .gene-panel, .gene-top > .gene-alert, .gene-top > .toasts {
        position: static !important; top: auto !important; left: auto !important; transform: none !important;
        max-width: 100%; box-sizing: border-box; }
      .gene-top > .gene-panel { order: 0; white-space: normal !important; text-align: center; }
      .gene-top > .gene-alert { order: 1; white-space: normal !important; text-align: center; }
      .gene-top > .toasts { order: 2; display: flex; flex-direction: column; align-items: center; gap: 6px; }
      .gene-top .toast { max-width: min(80vw, 560px); text-align: center; }
      .gene-top .toast:nth-last-child(n+${MAX_TOASTS + 1}) { display: none; }
    `;
    document.head.appendChild(css);
    container.appendChild(this.column);
  }

  init(): void {
    this.adopt();
    this.observer = new MutationObserver(() => this.adopt());
    this.observer.observe(this.container, { childList: true, subtree: true });
  }

  dispose(): void {
    this.observer?.disconnect();
  }

  /** Pull any panels, alerts and the message list that aren't in the column yet into it. */
  private adopt(): void {
    for (const el of this.container.querySelectorAll<HTMLElement>('.gene-panel, .gene-alert, .toasts')) {
      if (el.parentElement !== this.column) this.column.appendChild(el);
    }
  }
}
