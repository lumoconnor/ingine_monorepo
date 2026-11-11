import * as THREE from 'three';
import { Component } from '../entities/Component';
import type { Saveable } from '../core/SaveSystem';
import { RigidBodyComponent } from '../physics/RigidBodyComponent';
import { Items } from '../inventory/catalog';
import { Arcs, resolveMode } from './blocks';
import { Damageable } from './Damageable';
import type { Bag } from './Bag';
import type { CombatSystem } from './CombatSystem';
import type { AttackModeDef, FeederDef, PayloadDef, WeaponDef } from './weaponTypes';
import type { DamagePacket } from './types';
import { FIXED_DT } from '../core/Time';

/** Bare hands: the weapon used when nothing is held. The game sets it with `setUnarmed`. */
export const UNARMED = {} as WeaponDef;

export function setUnarmed(def: WeaponDef): void {
  for (const k of Object.keys(UNARMED)) delete (UNARMED as unknown as Record<string, unknown>)[k];
  Object.assign(UNARMED, structuredClone(def));
}

/** What the brain (player input or AI) wants this tick. `*Pressed` are edges, the rest are held. */
export interface Intents {
  attack: boolean;
  attackPressed: boolean;
  alt: boolean;
  altPressed: boolean;
  reload: boolean;
}

export type CombatState = 'idle' | 'pending' | 'charging' | 'windup' | 'active' | 'recovery' | 'reloading' | 'equipping' | 'blocking' | 'staggered';

type Input = 'attack' | 'altAttack';

/** Where an attack comes from and which way it points. The player uses the camera. */
export type Aimer = (origin: THREE.Vector3, dir: THREE.Vector3) => void;

const EQUIP_TIME = 0.35;

/** Seconds between a fuse's ticks with `left` seconds to go: about two a second, quickening to a rattle. */
export function fuseInterval(left: number): number {
  return THREE.MathUtils.clamp(left * 0.16, 0.07, 0.5);
}
const DEG = Math.PI / 180;
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * Anyone who fights: the player now, enemies in phase 5. Holds the drawn
 * weapon (an item instance, or bare hands) and runs its attack modes as a
 * small state machine driven by intents, so it never needs to know whether
 * a person or an AI is pressing the buttons.
 *
 *   idle -> windup -> active -> recovery -> idle     (melee and delayed shots)
 *   idle -> pending (tap or hold?) -> charging -> ... (heavy swings, bows, grenades)
 *   idle -> reloading -> idle;  any -> equipping -> idle
 *   idle -> blocking (alt held, weapon has a block) -> idle
 *   any -> staggered (parried, guard broken) -> idle
 *
 * Stamina: melee swings cost it (mode `stamina`, default 12 a swing, more
 * for a charged one), blocked hits cost it, and it comes back after a short
 * rest. With none left you can't swing, and a blocked hit breaks your guard.
 */
export class Combatant extends Component implements Saveable {
  order = 105;
  faction: string;
  /** Instance uid of the drawn weapon, or null for bare hands. */
  equipped: string | null = null;
  state: CombatState = 'idle';
  intents: Intents = { attack: false, attackPressed: false, alt: false, altPressed: false, reload: false };
  aimer: Aimer;
  /** Name of the running mode (primary, heavy...), for views. */
  mode: string | null = null;
  /** Seconds the current hold has lasted (charging, cooking). */
  get heldTime(): number {
    return this.state === 'charging' ? this.held : 0;
  }

  /** The last swing of a combo of two or more: the one that hits hardest. */
  get finishing(): boolean {
    const t = this.modeDef?.trigger;
    const n = t?.steps?.length ?? 0;
    return t?.kind === 'combo' && n > 1 && this.comboIndex === n - 1;
  }

  /** 0..1 how far through the current state, for views. */
  progress = 0;
  /** 0..1 charge of a charge mode (held time). */
  charge = 0;
  /** Current combo step (arc name). */
  step: string | null = null;
  /** Aiming down sights. */
  aiming = false;
  /** Extra spread from firing quickly, degrees. */
  bloom = 0;
  /** Name of the reload step under way (sequence feeders), for the HUD. */
  reloadStep: string | null = null;
  /** Seconds since the last shot, for the view's recoil. */
  sinceShot = 99;
  readonly maxStamina: number;
  stamina: number;
  /** Stamina per second once rested, and the rest it needs after spending. */
  staminaRegen = 30;
  staminaDelay = 0.9;
  private sinceSpend = 99;
  private blockStart = -99;
  private blockEnd = -99;
  private parryOk = false;

  private timer = 0;
  private duration = 0;
  private modeDef: AttackModeDef | null = null;
  private held = 0;
  private pendingInput: Input | null = null;
  private comboIndex = -1;
  private comboUntil = 0;
  private queued = false;
  /** Seconds a press is remembered when it can't be acted on yet (0 = not at all: NPCs). */
  inputBuffer = 0;
  private buffered: Record<'attack' | 'alt' | 'reload', number> = { attack: 0, alt: 0, reload: 0 };
  /** A light swing started on press that turns into this charge mode if the button stays down through its wind-up. */
  private upgrade: [string, AttackModeDef] | null = null;
  private upgradeRefund = 0;
  private burstLeft = 0;
  private pause = 0;
  /** How far along its arc (0..1) the last swing got, and whether it bounced off a guard or a wall. */
  swingEnd = 1;
  /** Multiplies every spread (the player's brain sets it: moving, in the air, crouched). */
  spreadScale = 1;
  /** Seconds held at full charge (a bow at full draw). */
  heldFull = 0;
  private fuseTick = 0;
  rebounded = false;
  private worldStruck = false;
  private struck = new Set<Damageable>();
  private sweepBlocked = false;
  private clock = 0;
  private reloadIndex = 0;
  private health: Damageable | null = null;

  /** Where its weapons and ammo are: the player's inventory, or an NPC's own LocalBag. */
  bag!: Bag;
  /** NPCs: wind-ups take this much longer, so a player can see a swing coming (and parry it). */
  windupScale = 1;

  constructor(private opts: { faction?: string; aimer?: Aimer; maxStamina?: number; bag?: Bag; windupScale?: number; inputBuffer?: number } = {}) {
    super();
    this.inputBuffer = opts.inputBuffer ?? 0;
    this.windupScale = opts.windupScale ?? 1;
    this.maxStamina = this.stamina = opts.maxStamina ?? 100;
    this.faction = opts.faction ?? 'neutral';
    this.aimer = opts.aimer ?? ((o, d) => this.defaultAim(o, d));
  }

  onAttach(): void {
    this.health = this.entity.get(Damageable) ?? null;
    this.bag = this.opts.bag ?? this.game.state;
  }

  private get combat(): CombatSystem {
    return this.game.getSystem<CombatSystem>('combat')!;
  }

  /** Item id of the drawn weapon, or null for bare hands. */
  get itemId(): string | null {
    const e = this.equipped;
    if (!e) return null;
    if (e.startsWith('stack:')) {
      const item = e.slice(6);
      return this.bag.itemCount(item) > 0 ? item : null;
    }
    return this.bag.instance(e)?.item ?? null;
  }

  get weapon(): WeaponDef {
    const id = this.itemId;
    return (id && Items[id]?.weapon) || UNARMED;
  }

  get busy(): boolean {
    return this.state !== 'idle';
  }

  /** The mode currently running (resolved). */
  get currentMode(): AttackModeDef | null {
    return this.modeDef;
  }

  /** Draw a weapon by instance uid (or an item id, picking one you carry), or null to put it away. */
  equip(uidOrItem: string | null): boolean {
    const state = this.bag;
    let uid: string | null = null;
    if (uidOrItem?.startsWith('stack:')) uidOrItem = uidOrItem.slice(6);
    if (uidOrItem) {
      uid = state.instance(uidOrItem) ? uidOrItem : (state.instancesOf(uidOrItem)[0]?.uid ?? null);
      if (!uid) {
        // Stackable throwables (grenades) aren't instances: hold one of the stack.
        if (Items[uidOrItem]?.weapon && state.itemCount(uidOrItem) > 0) uid = `stack:${uidOrItem}`;
        else return false;
      }
    }
    if (uid === this.equipped && this.state !== 'equipping') return true;
    this.equipped = uid;
    this.cancel();
    this.state = 'equipping';
    this.timer = this.duration = EQUIP_TIME;
    this.game.events.emit('combat:equip', { entity: this.entity, item: this.itemId });
    return true;
  }

  // --- per tick -------------------------------------------------------------

  fixedUpdate(dt: number): void {
    this.clock += dt;
    this.sinceShot += dt;
    const i = this.intents;
    if (this.health?.dead) {
      this.cancel();
      return;
    }
    // Remember presses for a moment, so one made just before a swing ends or a
    // weapon is ready still counts (taken up in idle(), or by whoever uses it first).
    const b = this.buffered;
    b.attack = i.attackPressed ? this.inputBuffer : Math.max(0, b.attack - dt);
    b.alt = i.altPressed ? this.inputBuffer : Math.max(0, b.alt - dt);
    b.reload = i.reload ? this.inputBuffer : Math.max(0, b.reload - dt);
    if (this.pause > 0) {
      this.pause -= dt;
      if (this.state === 'active' || this.state === 'recovery') {
        // A click in the freeze still chains the combo.
        if (this.modeDef?.trigger.kind === 'combo' && i.attackPressed) this.queue();
        i.attackPressed = i.altPressed = i.reload = false;
        return;
      }
      this.pause = 0;
    }
    // The weapon went away (dropped, thrown the last one): back to bare hands.
    if (this.equipped && !this.itemId) {
      this.equipped = null;
      this.cancel();
      this.game.events.emit('combat:equip', { entity: this.entity, item: null });
    }
    // Stamina comes back after a breather; slowly while holding a guard.
    this.sinceSpend += dt;
    if (this.sinceSpend >= this.staminaDelay) this.stamina = Math.min(this.maxStamina, this.stamina + this.staminaRegen * (this.state === 'blocking' ? 0.35 : 1) * dt);
    const w = this.weapon;
    const spread = this.primaryDelivery()?.spread;
    if (spread) this.bloom = Math.max(0, this.bloom - (spread.recover ?? 4) * dt);
    this.aiming = !!w.handling?.ads && i.alt && !this.modeFor('altAttack') && (this.state === 'idle' || this.state === 'recovery' || this.state === 'windup');

    switch (this.state) {
      case 'equipping':
        this.tick(dt) && this.toIdle();
        break;
      case 'idle':
        this.idle();
        break;
      case 'pending':
        this.updatePending(dt);
        break;
      case 'charging':
        this.updateCharging(dt);
        break;
      case 'windup':
        if (this.updateUpgrade(dt)) break;
        if (this.modeDef?.trigger.kind === 'combo' && i.attackPressed) this.queue();
        if (this.tick(dt)) this.release();
        break;
      case 'active':
        if (this.modeDef?.trigger.kind === 'combo' && i.attackPressed) this.queue();
        this.sweep(dt);
        if (this.tick(dt) || this.sweepBlocked) this.toRecovery();
        break;
      case 'recovery':
        // A queued combo swing cuts the follow-through short: blows flow into each other.
        if (this.queued && this.modeDef?.trigger.kind === 'combo' && this.progress >= (this.modeDef.trigger.cancel ?? 1)) {
          this.afterRecovery();
          break;
        }
        // Guard straight out of a swing's follow-through.
        if (i.alt && !i.attackPressed && !this.queued && this.modeDef?.delivery.kind === 'sweep' && this.canBlock()) {
          this.toIdle();
          this.startBlock();
          break;
        }
        if ((this.modeDef?.trigger.kind === 'combo') && i.attackPressed) this.queue();
        if (this.tick(dt)) this.afterRecovery();
        break;
      case 'reloading':
        this.updateReload(dt);
        break;
      case 'blocking':
        this.updateBlocking();
        break;
      case 'staggered':
        this.tick(dt) && this.toIdle();
        break;
    }
    this.progress = this.duration > 0 ? 1 - Math.max(0, this.timer) / this.duration : 0;
    i.attackPressed = i.altPressed = i.reload = false;
  }

  /**
   * Hit-stop, for this fighter only: its swing hangs for a moment where the
   * blow landed (the blade bites), while the rest of the world carries on.
   */
  hitPause(seconds: number): void {
    this.pause = Math.max(this.pause, seconds);
  }

  /** In a hit-stop right now. */
  get paused(): boolean {
    return this.pause > 0;
  }

  /** A click during a combo swing: the next one follows it. */
  private queue(): void {
    this.queued = true;
    this.buffered.attack = 0;
  }

  /**
   * A light swing that began on press, with a heavy on the same button: let
   * go during the wind-up and it stays a light swing; still holding when the
   * wind-up ends and it becomes the heavy, already part charged. Returns true
   * once it has turned into the charge.
   */
  private updateUpgrade(dt: number): boolean {
    if (!this.upgrade) return false;
    this.held += dt;
    const input = this.pendingInput === 'altAttack' ? this.intents.alt : this.intents.attack;
    if (!input) {
      this.upgrade = null;
      return false;
    }
    if (this.timer - dt > 0) return false;
    const [name, m] = this.upgrade;
    const held = this.held;
    // The light swing never happened: give back what it cost.
    this.stamina = Math.min(this.maxStamina, this.stamina + this.upgradeRefund);
    this.upgrade = null;
    this.step = null;
    this.startCharge(name, m, held);
    return true;
  }

  /** True while a light swing may still turn into a heavy (the button is still down in its wind-up). */
  get upgrading(): AttackModeDef | null {
    return this.state === 'windup' && this.upgrade ? this.upgrade[1] : null;
  }

  /**
   * `progress` (or `charge`, or `sinceShot`) as it will be `alpha` of a fixed
   * step from now, so views drawn between steps move smoothly.
   */
  progressAt(alpha: number): number {
    if (this.pause > 0 || this.duration <= 0 || this.state === 'charging' || this.state === 'blocking' || this.state === 'idle') return this.progress;
    return Math.min(1, this.progress + (alpha * FIXED_DT) / this.duration);
  }

  chargeAt(alpha: number): number {
    const t = this.modeDef?.trigger;
    if (this.state !== 'charging' || !t) return this.charge;
    const min = t.min ?? 0;
    const max = Math.max(min + 0.01, t.max ?? 1);
    return this.held < min ? 0 : Math.min(1, this.charge + (alpha * FIXED_DT) / (max - min));
  }

  /** Counts down; true when the state's time is up. */
  private tick(dt: number): boolean {
    this.timer -= dt;
    return this.timer <= 0;
  }

  private toIdle(): void {
    if (this.state === 'blocking') this.blockEnd = this.clock;
    this.state = 'idle';
    this.modeDef = null;
    this.mode = null;
    this.timer = this.duration = 0;
    this.charge = 0;
  }

  /** Stop whatever is under way (switching weapons, dying). Reload progress is lost. */
  cancel(): void {
    this.toIdle();
    this.queued = false;
    this.upgrade = null;
    this.burstLeft = 0;
    this.reloadStep = null;
    this.pendingInput = null;
    this.struck.clear();
  }

  private modesOn(input: Input): [string, AttackModeDef][] {
    const w = this.weapon;
    return Object.keys(w.modes)
      .map((n) => [n, resolveMode(w, n)] as [string, AttackModeDef])
      .filter(([n, m]) => (m.input ?? (n === 'secondary' ? 'altAttack' : 'attack')) === input);
  }

  private modeFor(input: Input): [string, AttackModeDef] | undefined {
    return this.modesOn(input)[0];
  }

  private primaryDelivery() {
    const w = this.weapon;
    const first = Object.keys(w.modes)[0];
    return first ? resolveMode(w, first).delivery : undefined;
  }

  private idle(): void {
    const i = this.intents;
    const b = this.buffered;
    if (i.reload || b.reload > 0) {
      b.reload = 0;
      return void this.startReload(true);
    }
    const attackPressed = i.attackPressed || b.attack > 0;
    // Hold the other button to guard, with a weapon that can (sword, fists).
    if (i.alt && !attackPressed && this.canBlock()) return this.startBlock();
    for (const input of ['attack', 'altAttack'] as Input[]) {
      const pressed = input === 'attack' ? attackPressed : i.altPressed || b.alt > 0;
      if (!pressed) continue;
      const modes = this.modesOn(input);
      if (!modes.length) continue;
      b[input === 'attack' ? 'attack' : 'alt'] = 0;
      const charge = modes.find(([, m]) => m.trigger.kind === 'charge');
      const tap = modes.find(([, m]) => m.trigger.kind !== 'charge');
      if (charge && tap && tap[1].delivery.kind === 'sweep' && (tap[1].timing?.windup ?? 0.1) > 0) {
        // A swing with a heavy behind it: the light swing starts at once, and
        // becomes the heavy if the button is still down when its wind-up ends.
        const before = this.stamina;
        this.begin(tap[0], tap[1]);
        if (this.state === 'windup') {
          this.upgrade = charge;
          this.upgradeRefund = before - this.stamina;
          this.pendingInput = input;
          this.held = 0;
        }
      } else if (charge && tap) {
        // Tap or hold? Decided on release, or once held long enough.
        this.state = 'pending';
        this.pendingInput = input;
        this.held = 0;
      } else if (charge) {
        this.startCharge(charge[0], charge[1]);
      } else if (tap) {
        this.begin(tap[0], tap[1]);
      }
      return;
    }
    // Automatic fire keeps going while held.
    const auto = this.modesOn('attack').find(([, m]) => m.trigger.kind === 'hold-auto');
    if (auto && i.attack && this.queuedAuto) this.begin(auto[0], auto[1]);
  }

  // --- guarding and stamina ----------------------------------------------------

  /** Has a block profile and nothing else on the other button (no aiming, no secondary attack). */
  canBlock(): boolean {
    const w = this.weapon;
    return !!w.block && !w.handling?.ads && !this.modeFor('altAttack');
  }

  private startBlock(): void {
    this.state = 'blocking';
    this.blockStart = this.clock;
    // Tapping block over and over doesn't keep the parry window open.
    this.parryOk = this.clock - this.blockEnd > 0.35;
    this.timer = this.duration = 0;
  }

  private updateBlocking(): void {
    const i = this.intents;
    if (!i.alt || !this.canBlock()) return this.toIdle();
    // Attack straight out of a guard.
    if (i.attackPressed || this.buffered.attack > 0) {
      this.toIdle();
      this.idle();
    }
  }

  /** In the opening moment of a block: a melee hit now is parried. */
  get parrying(): boolean {
    const w = this.weapon.block?.parryWindow ?? 0;
    return this.state === 'blocking' && this.parryOk && this.clock - this.blockStart <= w;
  }

  /** Seconds the guard has been up. */
  get blockTime(): number {
    return this.state === 'blocking' ? this.clock - this.blockStart : 0;
  }

  /** Uses stamina (down to 0). */
  spendStamina(n: number): void {
    if (n <= 0) return;
    this.stamina = Math.max(0, this.stamina - n);
    this.sinceSpend = 0;
  }

  /** Knocked off balance: whatever was under way stops and nothing can be done for a moment. */
  stagger(seconds: number, reason: string): void {
    if (this.health?.dead) return;
    const wasBlocking = this.state === 'blocking';
    this.cancel();
    if (wasBlocking) this.blockEnd = this.clock;
    this.state = 'staggered';
    this.timer = this.duration = seconds;
    this.game.events.emit('combat:staggered', { entity: this.entity, seconds, reason });
  }

  /** Which way it faces (the aimer's direction). */
  facing(out: THREE.Vector3): THREE.Vector3 {
    this.aimer(_o, out);
    return out;
  }

  /** hold-auto continues only while the trigger stays down after a shot. */
  private queuedAuto = false;
  private releaseEarly = false;

  /** While deciding tap or hold: the charge mode a hold turns into, and how far toward it (0..1). */
  pendingHold(): { mode: AttackModeDef; t: number } | null {
    if (this.state !== 'pending' || !this.pendingInput) return null;
    const c = this.modesOn(this.pendingInput).find(([, m]) => m.trigger.kind === 'charge');
    return c ? { mode: c[1], t: Math.min(1, this.held / Math.max(1e-3, c[1].trigger.min ?? 0.3)) } : null;
  }

  /** The charge mode being held (or about to be), for views. */
  get chargingMode(): AttackModeDef | null {
    return this.state === 'charging' ? this.modeDef : (this.pendingHold()?.mode ?? null);
  }

  private updatePending(dt: number): void {
    const held = this.pendingInput === 'altAttack' ? this.intents.alt : this.intents.attack;
    const modes = this.modesOn(this.pendingInput!);
    const charge = modes.find(([, m]) => m.trigger.kind === 'charge')!;
    const tap = modes.find(([, m]) => m.trigger.kind !== 'charge')!;
    this.held += dt;
    if (!held) {
      this.state = 'idle';
      this.begin(tap[0], tap[1]);
    } else if (this.held >= (charge[1].trigger.min ?? 0.3)) {
      this.startCharge(charge[0], charge[1], this.held);
    }
  }

  private startCharge(name: string, m: AttackModeDef, already = 0): void {
    if (!this.canFire(m)) return void this.outOfAmmo(m);
    this.state = 'charging';
    this.mode = name;
    this.modeDef = m;
    this.held = already;
    this.charge = 0;
    this.heldFull = 0;
    this.fuseTick = 0;
    this.releaseEarly = false;
    this.game.events.emit('combat:charge', { entity: this.entity, item: this.itemId, mode: name, full: false });
    this.pendingInput = (m.input ?? (name === 'secondary' ? 'altAttack' : 'attack')) as Input;
  }

  private updateCharging(dt: number): void {
    const m = this.modeDef!;
    const t = m.trigger;
    const held = this.pendingInput === 'altAttack' ? this.intents.alt : this.intents.attack;
    this.held += dt;
    const min = t.min ?? 0;
    const max = Math.max(min + 0.01, t.max ?? 1);
    const was = this.charge;
    this.charge = THREE.MathUtils.clamp((this.held - min) / (max - min), 0, 1);
    this.progress = this.charge;
    if (this.charge >= 1) {
      if (was < 1) this.game.events.emit('combat:charge', { entity: this.entity, item: this.itemId, mode: this.mode ?? '', full: true });
      this.heldFull += dt;
      // Holding a full draw is work: it drains you, and with nothing left the string slips.
      if (t.holdStamina) {
        this.spendStamina(t.holdStamina * dt);
        if (this.stamina <= 0) this.releaseEarly = true;
      }
    }
    // A cooking fuse ticks, faster as it runs down.
    if (t.cook && m.delivery.fuse !== undefined) {
      this.fuseTick -= dt;
      if (this.fuseTick <= 0) {
        const left = m.delivery.fuse - this.held;
        this.fuseTick = fuseInterval(left);
        this.aimer(_o, _d);
        this.game.events.emit('combat:fusetick', { point: { x: _o.x, y: _o.y - 0.2, z: _o.z }, left });
      }
    }
    // A cooked grenade held past its fuse goes off in your hand.
    const fuse = m.delivery.fuse;
    if (t.cook && fuse !== undefined && this.held >= fuse) {
      this.fire(m, 1, this.held);
      return this.toRecovery();
    }
    // Let go before the minimum: it still goes, as soon as the minimum is
    // reached (a quick flick of a bow), so a tap never just does nothing.
    if (!held) this.releaseEarly = true;
    if (this.releaseEarly && this.held >= min) this.begin(this.mode!, m, this.charge);
  }

  /** Start a mode: windup (melee or a delayed shot), or fire at once. */
  private begin(name: string, m: AttackModeDef, charge = 0): void {
    if (!this.canFire(m)) return this.outOfAmmo(m);
    const cost = (m.stamina ?? (m.delivery.kind === 'sweep' ? 12 : 0)) * (1 + 0.5 * charge);
    if (cost > 0) {
      if (this.stamina <= 0) {
        this.toIdle();
        this.game.events.emit('combat:dry', { entity: this.entity, reason: 'winded' });
        return;
      }
      this.spendStamina(cost);
    }
    this.mode = name;
    this.modeDef = m;
    this.charge = charge;
    this.queued = false;
    this.upgrade = null;
    this.struck.clear();
    this.sweepBlocked = false;
    this.worldStruck = false;
    this.rebounded = false;
    this.swingEnd = 1;
    if (m.trigger.kind === 'combo') {
      const steps = m.trigger.steps ?? ['jab'];
      this.comboIndex = this.clock <= this.comboUntil ? (this.comboIndex + 1) % steps.length : 0;
      this.step = steps[this.comboIndex];
    } else {
      this.step = m.delivery.arc && m.delivery.arc !== 'step' ? m.delivery.arc : null;
    }
    if (m.trigger.kind === 'burst') this.burstLeft = (m.trigger.count ?? 3) - 1;
    this.game.events.emit('combat:attack', { attacker: this.entity, source: this.sourceName() });
    const windup = (m.delivery.kind === 'sweep' ? (m.timing?.windup ?? 0.1) : (m.trigger.delay ?? 0)) * this.windupScale;
    if (windup > 0) {
      this.state = 'windup';
      this.timer = this.duration = windup;
    } else {
      this.release();
    }
  }

  /** The moment the attack lands or the shot leaves. */
  private release(): void {
    const m = this.modeDef!;
    if (m.delivery.kind === 'sweep') {
      this.state = 'active';
      this.timer = this.duration = Math.max(1 / 60, m.timing?.active ?? 0.1);
      this.sweepT = 0;
      this.game.events.emit('combat:swing', { attacker: this.entity, item: this.itemId, mode: this.mode ?? '', charge: this.charge });
      return;
    }
    this.fire(m, this.charge, 0);
    this.toRecovery();
  }

  private toRecovery(): void {
    const m = this.modeDef;
    if (!m) return this.toIdle();
    const t = m.trigger;
    const interval = t.rpm ? 60 / t.rpm : 0;
    // Bounced off a guard or a wall: a moment longer to gather the blade back.
    const fin = this.finishing ? (t.finisher?.recovery ?? 1) : 1;
    const rec = Math.max((m.timing?.recovery ?? 0) * fin, interval, 1 / 60) + (this.rebounded ? 0.15 : 0);
    if (m.delivery.kind === 'sweep') this.swingEnd = this.sweepT;
    this.state = 'recovery';
    this.timer = this.duration = rec;
  }

  private afterRecovery(): void {
    const m = this.modeDef!;
    const name = this.mode!;
    const t = m.trigger;
    if (t.kind === 'combo') {
      this.comboUntil = this.clock + (t.window ?? 0.3);
      const queued = this.queued;
      this.toIdle();
      // A click during the follow-through chains straight into the next swing.
      if (queued) this.begin(name, m);
      return;
    }
    if (t.kind === 'burst' && this.burstLeft > 0 && this.canFire(m)) {
      this.burstLeft--;
      this.fire(m, 0, 0);
      return this.toRecovery();
    }
    this.toIdle();
    this.queuedAuto = t.kind === 'hold-auto';
    if (this.queuedAuto && this.intents.attack) this.begin(name, m);
    // Empty after that shot: start reloading if there's ammo to load.
    if (this.state === 'idle' && !this.canFire(m) && this.hasReserve(m)) this.startReload(false);
  }

  // --- feeding ----------------------------------------------------------------

  private uidData(): Record<string, unknown> | null {
    return this.equipped && !this.equipped.startsWith('stack:') ? (this.bag.instance(this.equipped)?.data ?? null) : null;
  }

  /**
   * Rounds loaded (feeders with a capacity). A magazine weapon never touched
   * is fully loaded; a bow or a muzzle-loader you find is not.
   */
  loaded(m: AttackModeDef | null = this.feedMode()?.[1] ?? null): number {
    const f = m?.feeder;
    if (!f) return Infinity;
    if (f.kind === 'self') return this.itemId ? this.bag.itemCount(this.itemId) : 0;
    if (f.kind === 'none') return Infinity;
    const cap = this.capacity(f);
    const v = this.uidData()?.loaded;
    return typeof v === 'number' ? v : f.kind === 'magazine' ? cap : 0;
  }

  capacity(f: FeederDef): number {
    return f.kind === 'sequence' ? 1 : (f.capacity ?? 1);
  }

  private setLoaded(n: number): void {
    if (this.equipped) this.bag.setInstanceData(this.equipped, 'loaded', n);
  }

  /** The mode whose feeder this weapon reloads (the first one with ammo). */
  feedMode(): [string, AttackModeDef] | undefined {
    const w = this.weapon;
    for (const n of Object.keys(w.modes)) {
      const m = resolveMode(w, n);
      if (m.feeder && ['magazine', 'single-load', 'sequence'].includes(m.feeder.kind)) return [n, m];
    }
    return undefined;
  }

  /** Ammo item to load: what's in already if any is left, else the first kind you carry. */
  ammoItem(): string | null {
    const list = this.weapon.ammo ?? [];
    const pref = this.uidData()?.ammoPref;
    if (typeof pref === 'string' && list.includes(pref) && this.bag.itemCount(pref) > 0) return pref;
    const current = this.uidData()?.ammoType;
    if (typeof current === 'string' && this.bag.itemCount(current) > 0) return current;
    return list.find((a) => this.bag.itemCount(a) > 0) ?? (typeof current === 'string' ? current : (list[0] ?? null));
  }

  /** What's in the weapon now (the last ammo loaded), which decides what the next shot does. */
  loadedAmmo(): string | null {
    const t = this.uidData()?.ammoType;
    return typeof t === 'string' ? t : this.ammoItem();
  }

  /**
   * Switch to the next kind of ammo you carry (arrows, fire arrows). It's
   * used from the next load on. Returns the new choice, or null if there's
   * nothing else to switch to.
   */
  cycleAmmo(): string | null {
    const list = (this.weapon.ammo ?? []).filter((a) => this.bag.itemCount(a) > 0);
    if (!this.equipped || list.length < 2) return null;
    const now = this.ammoItem();
    const next = list[(list.indexOf(now ?? '') + 1) % list.length];
    this.bag.setInstanceData(this.equipped, 'ammoPref', next);
    return next;
  }

  /** Rounds of the right ammo carried (not loaded). */
  reserve(): number {
    return (this.weapon.ammo ?? []).reduce((n, a) => n + this.bag.itemCount(a), 0);
  }

  private hasReserve(_m: AttackModeDef): boolean {
    return this.reserve() > 0;
  }

  canFire(m: AttackModeDef): boolean {
    const f = m.feeder;
    if (!f || f.kind === 'none') return true;
    if (this.uidData()?.jammed) return false;
    return this.loaded(m) > 0;
  }

  private outOfAmmo(m: AttackModeDef): void {
    this.toIdle();
    if (this.uidData()?.jammed) {
      this.game.events.emit('combat:dry', { entity: this.entity, reason: 'jammed' });
      return;
    }
    if (m.feeder && this.hasReserve(m)) return this.startReload(false);
    this.game.events.emit('combat:dry', { entity: this.entity, reason: 'empty' });
  }

  startReload(manual: boolean): void {
    const fm = this.feedMode();
    if (!fm) return;
    const f = fm[1].feeder!;
    const data = this.uidData();
    if (data?.jammed) {
      // Clearing a jam: half a reload, rounds stay in.
      this.state = 'reloading';
      this.reloadStep = 'clear jam';
      this.reloadIndex = -1;
      this.timer = this.duration = (f.reload ?? f.loadTime ?? 1) * 0.5;
      return;
    }
    const loaded = this.loaded(fm[1]);
    if (loaded >= this.capacity(f) || this.reserve() <= 0) {
      if (manual && this.reserve() <= 0 && loaded < this.capacity(f)) this.game.events.emit('combat:dry', { entity: this.entity, reason: 'no ammo' });
      return;
    }
    this.state = 'reloading';
    this.mode = fm[0];
    this.modeDef = fm[1];
    this.reloadIndex = 0;
    if (f.kind === 'magazine') {
      this.reloadStep = 'reload';
      this.timer = this.duration = loaded > 0 ? (f.tactical ?? f.reload ?? 1.5) : (f.reload ?? 1.5);
    } else if (f.kind === 'single-load') {
      this.reloadStep = 'load';
      this.timer = this.duration = f.loadTime ?? 0.5;
    } else {
      const steps = (f.steps ?? [['load', 1]]) as [string, number][];
      this.reloadStep = steps[0][0];
      this.timer = steps[0][1];
      this.duration = steps[0][1];
    }
    this.game.events.emit('combat:reload', { entity: this.entity, item: this.itemId, step: this.reloadStep });
  }

  private takeAmmo(n: number): number {
    const st = this.bag;
    let left = n;
    const used = this.ammoItem();
    for (const a of [used, ...(this.weapon.ammo ?? [])]) {
      if (!a || left <= 0) continue;
      left -= st.removeItem(a, left);
    }
    if (used && this.equipped) st.setInstanceData(this.equipped, 'ammoType', used);
    return n - left;
  }

  private updateReload(dt: number): void {
    const f = this.modeDef?.feeder;
    const data = this.uidData();
    if (this.reloadIndex === -1) {
      if (this.tick(dt)) {
        if (this.equipped) this.bag.setInstanceData(this.equipped, 'jammed', false);
        this.reloadStep = null;
        this.toIdle();
      }
      return;
    }
    if (!f || !data) return this.toIdle();
    // Interruptible reloads stop when you attack (single-load keeps what's in).
    if (f.interruptible && this.intents.attackPressed && this.loaded(this.modeDef) > 0) {
      this.reloadStep = null;
      this.toIdle();
      this.idle();
      return;
    }
    if (!this.tick(dt)) return;
    const loaded = this.loaded(this.modeDef);
    const cap = this.capacity(f);
    if (f.kind === 'magazine') {
      this.setLoaded(loaded + this.takeAmmo(cap - loaded));
    } else if (f.kind === 'single-load') {
      this.setLoaded(loaded + this.takeAmmo(1));
      if (this.loaded(this.modeDef) < cap && this.reserve() > 0) {
        this.timer = this.duration = f.loadTime ?? 0.5;
        return;
      }
    } else {
      const steps = (f.steps ?? [['load', 1]]) as [string, number][];
      this.reloadIndex++;
      if (this.reloadIndex < steps.length) {
        this.reloadStep = steps[this.reloadIndex][0];
        this.timer = this.duration = steps[this.reloadIndex][1];
        this.game.events.emit('combat:reload', { entity: this.entity, item: this.itemId, step: this.reloadStep });
        return;
      }
      this.setLoaded(this.takeAmmo(1) > 0 ? 1 : 0);
    }
    this.reloadStep = null;
    this.toIdle();
    this.drawIfHeld();
  }

  /**
   * Still holding attack as a bow finishes nocking: go straight into the
   * draw rather than waiting for a fresh click.
   */
  private drawIfHeld(): void {
    if (!this.intents.attack) return;
    const modes = this.modesOn('attack');
    const charge = modes.find(([, m]) => m.trigger.kind === 'charge');
    if (charge && modes.length === 1 && this.canFire(charge[1])) this.startCharge(charge[0], charge[1]);
  }

  // --- delivering -----------------------------------------------------------

  private sourceName(): string {
    const id = this.itemId;
    return id ? (Items[id]?.name.toLowerCase() ?? id) : 'fists';
  }

  /** Payload with ammo overrides and charge applied. */
  private packets(m: AttackModeDef, charge: number): { packets: DamagePacket[]; payload: PayloadDef } {
    const ammo = m.feeder && m.feeder.kind !== 'self' ? this.loadedAmmo() : null;
    const payload = (ammo && Items[ammo]?.payload) || m.payload || { damage: [] };
    const fin = this.finishing ? (m.trigger.finisher?.damage ?? 1) : 1;
    const packets = payload.damage.map((d) => ({ type: d.type, amount: d.amount * (1 + ((d.chargeScale ?? 1) - 1) * charge) * fin }));
    return { packets, payload };
  }

  /** Current spread half-angle for a ranged mode, degrees. */
  spreadDeg(m: AttackModeDef | null = this.feedMode()?.[1] ?? this.modeDef): number {
    const s = m?.delivery.spread;
    if (!s) return 0;
    const base = this.aiming ? (s.ads ?? s.hip) : s.hip;
    return base * this.spreadScale + Math.min(this.bloom, s.bloomMax ?? 4);
  }

  /** Fire a ranged (or thrown) mode once. `cooked`: seconds already held (grenade fuse). */
  private fire(m: AttackModeDef, charge: number, cooked: number): void {
    const t = m.trigger;
    const f = m.feeder;
    const rng = this.combat.rng;
    const item = this.itemId;
    const ammo = f && f.kind !== 'self' && f.kind !== 'none' ? this.loadedAmmo() : null;
    // Use the round (or the thrown item) whatever happens next.
    if (f?.kind === 'self') {
      if (this.itemId) this.bag.removeItem(this.itemId, 1);
    } else if (f && f.kind !== 'none') {
      this.setLoaded(Math.max(0, this.loaded(m) - 1));
    }
    if (t.misfire && rng() < t.misfire) {
      this.game.events.emit('combat:dry', { entity: this.entity, reason: 'misfire' });
      return;
    }
    if (t.jam && rng() < t.jam && this.equipped) this.bag.setInstanceData(this.equipped, 'jammed', true);
    const { packets, payload } = this.packets(m, charge);
    this.aimer(_o, _d);
    const body = this.entity.get(RigidBodyComponent)?.body;
    const spread = this.spreadDeg(m);
    this.combat.deliver(m.delivery, {
      origin: _o,
      dir: _d,
      spreadDeg: spread,
      charge,
      cooked,
      attack: { attacker: this.entity, source: item ? (Items[item]?.name.toLowerCase() ?? item) : 'fists', packets, impulse: payload.impulse, payload },
      exclude: body,
      item,
      ammo,
    });
    const s = m.delivery.spread;
    if (s?.bloomPerShot) this.bloom = Math.min(s.bloomMax ?? 4, this.bloom + s.bloomPerShot);
    this.sinceShot = 0;
    this.game.events.emit('combat:fired', { attacker: this.entity, item, mode: this.mode ?? '' });
  }

  private sweepT = 0;

  /** Melee: move the blade along its arc this tick, striking each target once. */
  private sweep(dt: number): void {
    const m = this.modeDef!;
    const d = m.delivery;
    const arc = Arcs[this.step ?? d.arc ?? 'jab'] ?? Arcs.jab;
    const active = Math.max(1 / 60, m.timing?.active ?? 0.1);
    const from = this.sweepT;
    this.sweepT = Math.min(1, this.sweepT + dt / active);
    this.aimer(_o, _d);
    _right.crossVectors(_d, THREE.Object3D.DEFAULT_UP).normalize();
    _up.crossVectors(_right, _d).normalize();
    const { packets, payload } = this.packets(m, this.charge);
    const body = this.entity.get(RigidBodyComponent)?.body;
    // A few samples per tick so a fast swing can't skip past a thin target.
    for (let k = 1; k <= 3 && !this.sweepBlocked; k++) {
      const p = from + ((this.sweepT - from) * k) / 3;
      const a = arc(p);
      _dir.copy(_d).applyQuaternion(_q.setFromAxisAngle(_up, a.yaw * DEG));
      _dir.applyQuaternion(_q.setFromAxisAngle(_right, a.pitch * DEG));
      const r = this.combat.strike(
        _o,
        _dir,
        d.reach ?? 1.5,
        { attacker: this.entity, source: this.sourceName(), packets, impulse: payload.impulse, payload, delivery: 'sweep' },
        { exclude: body, radius: d.radius ?? 0.1, skip: this.struck, silent: this.worldStruck },
      );
      if (r.trace?.target) {
        this.struck.add(r.trace.target);
        const res = r.result;
        if (res) {
          const blocked = res.tags.includes('blocked') || res.tags.includes('parried');
          // The blade bites: longer for a harder blow, longest for the one that kills.
          if (res.damage > 0 || blocked) this.hitPause(res.killed ? 0.12 : THREE.MathUtils.clamp(0.025 + res.damage / 1600, 0.03, 0.09));
          // Turned by a guard: the swing ends there and bounces off.
          if (blocked && !res.killed && this.state === 'active') {
            this.sweepBlocked = true;
            this.rebounded = true;
            this.sweepT = p;
          }
        }
      } else if (r.trace && !r.trace.target) {
        this.worldStruck = true;
        // Steel on stone: the swing stops at a wall.
        if (r.trace.distance < (d.reach ?? 1.5) * 0.8) {
          this.sweepBlocked = true;
          this.rebounded = true;
          this.sweepT = p;
        }
      }
    }
    if (this.sweepT >= 1) this.timer = 0;
  }

  private defaultAim(o: THREE.Vector3, d: THREE.Vector3): void {
    const obj = this.entity.object3d;
    obj.getWorldPosition(o).y += 1.6;
    d.set(0, 0, 1).applyQuaternion(obj.quaternion);
  }

  saveState(): unknown {
    return { equipped: this.equipped };
  }

  loadState(s: { equipped?: string | null }): void {
    this.cancel();
    const uid = s?.equipped ?? null;
    this.equipped = uid && (this.bag.instance(uid) || uid.startsWith('stack:')) ? uid : null;
    this.game.events.emit('combat:equip', { entity: this.entity, item: this.itemId });
  }
}
