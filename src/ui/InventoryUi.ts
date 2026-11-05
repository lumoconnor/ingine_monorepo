import type { Game } from '@/core/Game';
import type { System } from '@/core/System';
import type { InventorySystem, Slot } from '@/inventory/InventorySystem';
import { itemIcon } from '@/inventory/icons';
import { canDrop } from '@/inventory/types';
import { Combatant } from '@/combat/Combatant';
import { Armour } from '@/combat/Armour';
import { DamageTypes } from '@/combat/registry';
import { weaponSummary } from '@/combat/describe';
import { Items } from '@/content/items';

const CATEGORY_LABEL: Record<string, string> = {
  quest: 'Quest item',
  weapon: 'Weapon',
  ammo: 'Ammunition',
  armour: 'Armour',
  consumable: 'Consumable',
  misc: 'Item',
};

/**
 * The inventory screen: a grid of slots with icons, and a details pane with
 * Use / Read / Drop. Click to select. Tab closes, Esc pauses.
 */
export class InventoryUi implements System {
  readonly name = 'inventory-ui';
  private game!: Game;
  private inv!: InventorySystem;
  private root: HTMLDivElement;
  private grid: HTMLDivElement;
  private details: HTMLDivElement;
  private money: HTMLDivElement;
  private selected: string | null = null;
  private reading = false;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'inventory hidden';
    this.root.innerHTML = `
      <div class="inv-panel">
        <header><h2>Inventory</h2><div class="inv-money"></div></header>
        <div class="inv-body">
          <div class="inv-grid"></div>
          <div class="inv-details"></div>
        </div>
        <footer>Tab to close · Esc to pause</footer>
      </div>`;
    container.appendChild(this.root);
    this.grid = this.root.querySelector('.inv-grid')!;
    this.details = this.root.querySelector('.inv-details')!;
    this.money = this.root.querySelector('.inv-money')!;
  }

  init(game: Game): void {
    this.game = game;
    this.inv = game.getSystem<InventorySystem>('inventory')!;
    game.events.on('inventory:open', () => {
      this.reading = false;
      this.root.classList.remove('hidden');
      this.render();
    });
    game.events.on('inventory:close', () => this.root.classList.add('hidden'));
    game.events.on('state:changed', ({ kind }) => {
      if (this.inv.isOpen && (kind === 'item' || kind === 'load')) this.render();
    });
    window.addEventListener('keydown', (e) => {
      if (this.inv.isOpen && e.code === 'Escape') this.inv.close(false);
    });
  }

  private render(): void {
    const slots = this.inv.slots();
    if (this.selected && !slots.some((s) => s.key === this.selected)) {
      this.selected = null;
      this.reading = false;
    }
    this.selected ??= slots[0]?.key ?? null;

    this.money.replaceChildren(
      ...this.inv.currencies().map((c) => {
        const el = document.createElement('span');
        const img = document.createElement('img');
        img.src = itemIcon(c.item);
        img.alt = '';
        el.append(img, `${c.count} ${c.def.name}`);
        return el;
      }),
    );

    const cells: HTMLElement[] = slots.map((s) => this.cell(s));
    // Pad to full rows so the grid reads as a bag with empty space.
    const total = Math.max(15, Math.ceil(slots.length / 5) * 5);
    for (let i = slots.length; i < total; i++) {
      const empty = document.createElement('div');
      empty.className = 'inv-slot empty';
      cells.push(empty);
    }
    this.grid.replaceChildren(...cells);
    this.renderDetails();
  }

  private cell(s: Slot): HTMLElement {
    const b = document.createElement('button');
    b.className = 'inv-slot';
    b.classList.toggle('selected', s.key === this.selected);
    b.classList.toggle('equipped', (!!s.uid && this.equippedUid() === s.uid) || !!this.armour()?.isWorn(s.item));
    b.title = s.def.name;
    const img = document.createElement('img');
    img.src = itemIcon(s.item);
    img.alt = s.def.name;
    b.appendChild(img);
    if (s.count > 1) {
      const n = document.createElement('span');
      n.className = 'count';
      n.textContent = String(s.count);
      b.appendChild(n);
    }
    b.addEventListener('click', () => {
      if (this.selected !== s.key) this.reading = false;
      this.selected = s.key;
      this.render();
    });
    return b;
  }

  private armour(): Armour | null {
    return this.game.world.find('player')?.get(Armour) ?? null;
  }

  private equippedUid(): string | null {
    return this.game.world.find('player')?.get(Combatant)?.equipped ?? null;
  }

  private renderDetails(): void {
    const key = this.selected;
    const inst = key ? this.game.state.instance(key) : undefined;
    const id = inst ? inst.item : key;
    if (!id) {
      this.details.innerHTML = '<p class="inv-empty">Your bag is empty. Look for things to pick up with E.</p>';
      return;
    }
    const def = Items[id];
    const have = this.game.state.itemCount(id);
    this.details.innerHTML = `
      <img class="inv-big" alt="">
      <h3></h3>
      <div class="inv-cat"></div>
      <p class="inv-desc"></p>
      <pre class="inv-note hidden"></pre>
      <div class="inv-actions"></div>`;
    this.details.querySelector<HTMLImageElement>('.inv-big')!.src = itemIcon(id);
    this.details.querySelector('h3')!.textContent = have > 1 && !inst ? `${def.name} ×${have}` : def.name;
    this.details.querySelector('.inv-cat')!.textContent = CATEGORY_LABEL[def.category] ?? def.category;
    this.details.querySelector('.inv-desc')!.textContent = def.description + (def.weapon ? weaponSummary(def, inst?.data) : '') + (def.armour ? armourSummary(def.armour) : '');
    const note = this.details.querySelector<HTMLPreElement>('.inv-note')!;
    if (def.text && this.reading) {
      note.textContent = def.text;
      note.classList.remove('hidden');
    }

    const actions = this.details.querySelector('.inv-actions')!;
    const button = (label: string, onClick: () => void, primary = false) => {
      const b = document.createElement('button');
      b.textContent = label;
      if (primary) b.className = 'primary';
      b.addEventListener('click', onClick);
      actions.appendChild(b);
    };
    if (def.use) button(def.useLabel ?? 'Use', () => this.inv.use(id), true);
    if (def.weapon) {
      const combatant = this.game.world.find('player')?.get(Combatant);
      const uid = inst?.uid ?? null;
      const on = !!uid && combatant?.equipped === uid;
      button(on ? 'Put away' : 'Equip', () => {
        combatant?.equip(on ? null : uid ?? id);
        this.render();
      }, true);
    }
    if (def.armour) {
      const ar = this.armour();
      const on = !!ar?.isWorn(id);
      button(on ? 'Take off' : 'Wear', () => {
        if (on) ar?.takeOff(id);
        else ar?.wear(id);
        this.render();
      }, true);
    }
    if (def.text) {
      button(this.reading ? 'Put away' : 'Read', () => {
        this.reading = !this.reading;
        this.renderDetails();
      }, !def.use);
    }
    if (canDrop(def)) button('Drop', () => this.inv.drop(id, inst?.uid));
    if (def.category === 'quest') {
      const hint = document.createElement('span');
      hint.className = 'inv-hint';
      hint.textContent = "Quest items can't be dropped.";
      actions.appendChild(hint);
    }
  }
}

function armourSummary(a: import('@/combat/Armour').ArmourDef): string {
  const zones = a.covers.map((z) => (z === 'limbs' ? 'arms and legs' : z)).join(', ');
  const stops = Object.entries(a.resist)
    .filter(([, r]) => r > 0)
    .sort((x, y) => y[1] - x[1])
    .map(([t, r]) => `${DamageTypes[t]?.name.toLowerCase() ?? t} ${Math.round(r * 100)}%`)
    .join(', ');
  return `\n\nCovers: ${zones}. Stops ${stops}.${a.move && a.move < 1 ? ` Slows you to ${Math.round(a.move * 100)}%.` : ''}`;
}
