import * as THREE from 'three';
import { Component } from '@/entities/Component';
import type { Entity } from '@/entities/Entity';
import type { Saveable } from '@/core/SaveSystem';
import { RigidBodyComponent } from '@/physics/RigidBodyComponent';
import { Items } from '@/inventory/catalog';
import { spawnPickup } from '@/inventory/pickups';
import { Damageable } from '../Damageable';
import { Combatant } from '../Combatant';
import { LocalBag } from '../Bag';
import type { CombatSystem } from '../CombatSystem';
import { Perception } from './Perception';
import { NpcBody } from './NpcBody';

/** One kind of enemy, from src/content/combat/archetypes.json. */
export interface Archetype {
  name: string;
  faction: string;
  health: number;
  /** melee: close in and swing; ranged: keep its distance, shoot, reload. */
  style: 'melee' | 'ranged' | (string & {});
  /** What it carries (weapons, ammo, coins): its LocalBag, and its loot. */
  carry: Record<string, number>;
  /** The weapon it fights with. */
  draw?: string;
  armour?: string[];
  look?: { tunic?: string; hood?: string };
  walkSpeed?: number;
  runSpeed?: number;
  /** Preferred distance band to its target (m). */
  range?: number[];
  sight?: number;
  /** 0..1: how often it attacks (melee). */
  aggression?: number;
  /** Chance to raise its guard against a swing it sees coming, and to time it as a parry. */
  blockChance?: number;
  parryChance?: number;
  /** Runs when health falls below this share (0 = never). */
  fleeAt?: number;
  /** Its wind-ups are this much slower than yours, so you can read them. */
  windupScale?: number;
  /** Ranged: seconds spent aiming before a shot, and aim error (degrees). */
  aimTime?: number;
  aimError?: number;
  /** Chance each carried item is dropped as loot when it dies (default 1). */
  dropChance?: Record<string, number>;
}

/** What the brain is doing; chosen by scoring each option (utility AI). */
export type Activity = 'idle' | 'investigate' | 'engage' | 'reload' | 'retreat' | 'flee' | 'return' | 'dead';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _aim = new THREE.Vector3();

/**
 * The thinking part of an enemy. Every quarter second it scores what it
 * could do (stand guard, investigate a noise, fight, reload, back off, run,
 * go home) from what its Perception knows, its health, stamina and weapon,
 * and picks the best, with a little stickiness so it doesn't dither. Every
 * tick it then acts on that choice by steering its NpcBody and setting its
 * Combatant's intents, exactly like the player's input does.
 *
 * Melee fighters close to sword range, circle, attack with combos and the
 * odd heavy, raise a guard (or time a parry) against swings they see coming,
 * and back off to get their breath. Musket men keep their distance, take a
 * moment to aim (a visible tell), fire, and retreat to reload if you rush them.
 */
export class EnemyBrain extends Component implements Saveable {
  order = 103;
  activity: Activity = 'idle';
  readonly home: THREE.Vector3;
  readonly homeYaw: number;
  /** Aiming at a point (ranged), for the rig to shoulder the gun. */
  aimingAt = 0;
  private body!: NpcBody;
  private eyes!: Perception;
  private fighter!: Combatant;
  private health!: Damageable;
  private thinkTimer = 0;
  private attackCooldown = 1;
  private heavyHold = 0;
  private guardUntil = 0;
  private guardFrom = 0;
  private lastSeenAttack = -1;
  private attackSerial = 0;
  private strafe = 1;
  private strafeTimer = 0;
  private investigateUntil = 0;
  private fled = false;
  private fleeUntil = 0;
  private clock = 0;
  private aimTimer = 0;
  private aimOffset = new THREE.Vector3();
  private lookAround = 0;
  private unsubs: (() => void)[] = [];
  private looted = false;

  constructor(
    readonly archetypeId: string,
    readonly arch: Archetype,
    home: THREE.Vector3,
    homeYaw: number,
    readonly bag: LocalBag,
  ) {
    super();
    this.home = home.clone();
    this.homeYaw = homeYaw;
  }

  get title(): string {
    return this.arch.name;
  }

  onAttach(): void {
    this.body = this.entity.require(NpcBody);
    this.eyes = this.entity.require(Perception);
    this.fighter = this.entity.require(Combatant);
    this.health = this.entity.require(Damageable);
    this.fighter.aimer = (o, d) => this.aim(o, d);
    const ev = this.game.events;
    this.unsubs.push(
      ev.on('combat:killed', ({ target }) => target === this.entity && this.die(true)),
      ev.on('combat:attack', ({ attacker }) => {
        if (attacker === this.eyes.target) this.attackSerial++;
      }),
      // Hurt mid-swing: a hard blow knocks it off its stroke.
      ev.on('combat:hit', ({ target, result }) => {
        if (target !== this.entity || this.health.dead) return;
        const st = this.fighter.state;
        if (result.damage >= 18 && (st === 'windup' || st === 'charging' || st === 'idle' || st === 'reloading')) this.fighter.stagger(0.35, 'flinch');
      }),
    );
    this.equipWeapon();
  }

  onDetach(): void {
    this.unsubs.forEach((u) => u());
  }

  private equipWeapon(): void {
    const draw = this.arch.draw;
    if (draw) this.fighter.equip(this.bag.instancesOf(draw)[0]?.uid ?? draw);
  }

  private get rng(): () => number {
    return this.game.getSystem<CombatSystem>('combat')!.rng;
  }

  private get pos(): THREE.Vector3 {
    return this.body.position;
  }

  /** Where attacks come from (its eyes) and go (its target, with aim error for guns). */
  private aim(o: THREE.Vector3, d: THREE.Vector3): void {
    this.eyes.eye(o);
    const t = this.eyes.target;
    if (t && this.activity !== 'flee') {
      const p = this.eyes.canSee ? Perception.aimPoint(t, _aim) : _aim.copy(this.eyes.lastSeen);
      if (this.arch.style === 'ranged') p.add(this.aimOffset);
      d.copy(p).sub(o).normalize();
    } else {
      d.set(Math.sin(this.body.yaw), 0, Math.cos(this.body.yaw));
    }
  }

  // --- choosing --------------------------------------------------------------

  private choose(): Activity {
    const e = this.eyes;
    const f = this.fighter;
    const hp = this.health.health / this.health.maxHealth;
    const ranged = this.arch.style === 'ranged';
    const t = e.target;
    const dist = t ? this.pos.distanceTo(t.object3d.position) : Infinity;
    const loaded = !ranged || f.loaded() > 0;
    const s: Partial<Record<Activity, number>> = {};
    s.idle = 0.1;
    s.return = !t && this.pos.distanceTo(this.home) > 2.5 ? 0.25 : 0;
    s.investigate = !t && e.noise && e.now - e.noiseTime < 12 ? 0.5 : 0;
    if (t) {
      // Fight, unless it's time to run or reload.
      s.engage = 0.7 + (e.canSee ? 0.2 : 0);
      if (ranged && !loaded) {
        const close = THREE.MathUtils.clamp(1 - (dist - 3) / 5, 0, 1);
        s.reload = 0.85 * (1 - close);
        s.retreat = 0.9 * close;
      }
      const flee = this.arch.fleeAt ?? 0;
      if (flee > 0 && hp < flee && !this.fled) s.flee = 1.2;
      if (this.activity === 'flee' && e.now < this.fleeUntil) s.flee = 1.2;
      // Out of breath: give ground for a moment.
      if (!ranged && f.stamina < 18 && dist < 4) s.retreat = 0.8;
    }
    // Stick with what it's doing unless something is clearly better.
    if (s[this.activity] !== undefined) s[this.activity]! += 0.08;
    let best: Activity = 'idle';
    for (const [k, v] of Object.entries(s) as [Activity, number][]) if (v > (s[best] ?? 0)) best = k;
    if (best === 'flee' && this.activity !== 'flee') {
      this.fled = true;
      this.fleeUntil = e.now + 8;
    }
    if (best === 'investigate' && this.activity !== 'investigate') this.investigateUntil = 0;
    return best;
  }

  // --- acting ----------------------------------------------------------------

  fixedUpdate(dt: number): void {
    this.clock += dt;
    const i = this.fighter.intents;
    i.attack = i.alt = false;
    if (this.health.dead) return;
    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = 0.25;
      this.activity = this.choose();
    }
    // Lost its target since it last thought: think again now.
    if (!this.eyes.target && (this.activity === 'engage' || this.activity === 'retreat' || this.activity === 'flee')) this.activity = this.choose();
    this.body.desired.set(0, 0, 0);
    this.aimingAt = 0;
    switch (this.activity) {
      case 'idle':
        return this.idle(dt);
      case 'return':
        if (this.goTo(this.home, this.arch.walkSpeed ?? 1.6, 0.8)) this.body.targetYaw = this.homeYaw;
        return;
      case 'investigate':
        return this.investigate(dt);
      case 'engage':
        return this.arch.style === 'ranged' ? this.shoot(dt) : this.melee(dt);
      case 'reload':
        return this.reload();
      case 'retreat':
        return this.retreat(dt);
      case 'flee':
        return this.flee();
    }
  }

  private idle(dt: number): void {
    // Stands its post, now and then glancing about.
    this.lookAround -= dt;
    if (this.lookAround <= 0) {
      this.lookAround = 2.5 + this.rng() * 3;
      this.body.targetYaw = this.homeYaw + (this.rng() - 0.5) * 1.4;
    }
    if (this.eyes.awareness > 0.25 && this.eyes.glimpse) {
      // Something caught its eye: turn to look.
      const g = this.eyes.glimpse.object3d.position;
      this.body.faceTowards(g.x, g.z);
    }
  }

  /** Walk or run toward a point; true when within `near`. */
  private goTo(p: THREE.Vector3, speed: number, near: number, ignore?: Entity): boolean {
    const me = this.pos;
    _v.set(p.x - me.x, 0, p.z - me.z);
    const d = _v.length();
    if (d <= near) return true;
    _v.divideScalar(d);
    const body = ignore?.get(RigidBodyComponent)?.body;
    this.body.clearDirection(_v, 1.3, body);
    this.body.desired.copy(_v).multiplyScalar(speed * Math.min(1, d / 1.5 + 0.3));
    this.body.targetYaw = Math.atan2(_v.x, _v.z);
    return false;
  }

  private investigate(dt: number): void {
    const n = this.eyes.noise;
    if (!n) return;
    if (this.investigateUntil === 0) {
      if (this.goTo(n, this.arch.walkSpeed ?? 1.6, 1.5)) this.investigateUntil = this.clock + 4;
      return;
    }
    // Got there: look around, then give up.
    this.idle(dt);
    if (this.clock > this.investigateUntil) this.eyes.noise = null;
  }

  private melee(dt: number): void {
    const t = this.eyes.target!;
    const f = this.fighter;
    const i = f.intents;
    const tp = t.object3d.position;
    const me = this.pos;
    const dist = Math.hypot(tp.x - me.x, tp.z - me.z);
    const [near, far] = this.arch.range ?? [1.3, 1.8];
    if (!this.eyes.canSee) {
      // Lost sight: go where it saw you last.
      this.goTo(this.eyes.lastSeen, this.arch.runSpeed ?? 4.4, 1, t);
      return;
    }
    this.body.faceTowards(tp.x, tp.z);
    this.attackCooldown -= dt;
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeTimer = 1.5 + this.rng() * 2;
      this.strafe = this.rng() < 0.5 ? -1 : 1;
    }

    // Defend: a swing coming its way from close by.
    const foe = t.get(Combatant);
    const swinging = foe && (foe.state === 'windup' || foe.state === 'active' || foe.state === 'charging') && foe.currentMode?.delivery.kind === 'sweep';
    if (swinging && dist < 3.2 && this.lastSeenAttack !== this.attackSerial && f.canBlock() && (f.state === 'idle' || f.state === 'blocking')) {
      this.lastSeenAttack = this.attackSerial;
      if (this.rng() < (this.arch.blockChance ?? 0) && f.stamina > 15) {
        const parry = this.rng() < (this.arch.parryChance ?? 0);
        // A parry is timed to the blow; a plain block goes up at once.
        const left = foe.state === 'windup' ? (1 - foe.progress) * (foe.currentMode?.timing?.windup ?? 0.15) : 0;
        this.guardFrom = this.clock + (parry ? Math.max(0, left - 0.06) : 0);
        this.guardUntil = this.clock + left + 0.45;
      }
    }
    if (this.clock < this.guardUntil) {
      i.alt = this.clock >= this.guardFrom;
      // Give a little ground while guarding.
      if (dist < far) this.body.desired.set(me.x - tp.x, 0, me.z - tp.z).normalize().multiplyScalar(0.6);
      return;
    }

    // Close in, keep the distance, circle.
    if (dist > far) {
      _v.set(tp.x - me.x, 0, tp.z - me.z).normalize();
      this.body.clearDirection(_v, 1.3, t.get(RigidBodyComponent)?.body);
      this.body.desired.copy(_v).multiplyScalar(dist > 5 ? (this.arch.runSpeed ?? 4.4) : (this.arch.walkSpeed ?? 1.6) * 1.4);
      this.body.targetYaw = Math.atan2(tp.x - me.x, tp.z - me.z);
    } else {
      _v.set(tp.x - me.x, 0, tp.z - me.z).normalize();
      _w.set(_v.z, 0, -_v.x).multiplyScalar(this.strafe * 0.7);
      if (dist < near) _w.addScaledVector(_v, -1.2);
      this.body.desired.copy(_w);
    }

    // Attack when in reach, with breath to spare.
    const reach = far + 0.3;
    if (this.heavyHold > 0) {
      this.heavyHold -= dt;
      i.attack = true;
      return;
    }
    if (dist <= reach && f.state === 'idle' && this.attackCooldown <= 0 && f.stamina > 25) {
      const agg = this.arch.aggression ?? 0.6;
      this.attackCooldown = THREE.MathUtils.lerp(1.8, 0.7, agg) + this.rng() * 0.8;
      i.attackPressed = true;
      i.attack = true;
      if (this.rng() < 0.12) this.heavyHold = 0.75;
    } else if (f.state === 'recovery' && this.rng() < 0.03 * (this.arch.aggression ?? 0.6)) {
      // Follow up with the next swing of the combo.
      i.attackPressed = true;
    }
  }

  private shoot(dt: number): void {
    const t = this.eyes.target!;
    const f = this.fighter;
    const i = f.intents;
    const tp = t.object3d.position;
    const me = this.pos;
    const dist = Math.hypot(tp.x - me.x, tp.z - me.z);
    const [, far] = this.arch.range ?? [7, 30];
    if (!this.eyes.canSee || dist > far) {
      // Find a line of fire: move toward where it last saw you.
      this.aimTimer = 0;
      this.goTo(this.eyes.lastSeen, this.arch.walkSpeed ?? 1.5, 3, t);
      return;
    }
    this.body.faceTowards(tp.x, tp.z);
    if (f.loaded() <= 0 || (f.state !== 'idle' && f.state !== 'recovery')) {
      this.aimTimer = 0;
      return;
    }
    // Shoulder the gun and take aim: the tell. Moving targets are harder to hit.
    if (this.aimTimer === 0) {
      const err = (this.arch.aimError ?? 1.5) * (Math.PI / 180) * dist;
      this.aimOffset.set((this.rng() - 0.5) * 2 * err, (this.rng() - 0.5) * 2 * err * 0.6, (this.rng() - 0.5) * 2 * err);
    }
    this.aimTimer += dt;
    this.aimingAt = Math.min(1, this.aimTimer / (this.arch.aimTime ?? 0.8));
    i.alt = true;
    if (this.aimTimer >= (this.arch.aimTime ?? 0.8) && f.state === 'idle' && f.aiming) {
      i.attackPressed = true;
      this.aimTimer = 0;
    }
  }

  private reload(): void {
    const t = this.eyes.target;
    if (t) this.body.faceTowards(t.object3d.position.x, t.object3d.position.z);
    const f = this.fighter;
    if (f.state === 'idle' && f.loaded() <= 0) f.intents.reload = true;
  }

  private retreat(dt: number): void {
    const t = this.eyes.target;
    if (!t) return;
    const tp = t.object3d.position;
    const me = this.pos;
    _v.set(me.x - tp.x, 0, me.z - tp.z).normalize();
    this.body.clearDirection(_v, 1.5);
    this.body.desired.copy(_v).multiplyScalar(this.arch.style === 'ranged' ? (this.arch.runSpeed ?? 4) : (this.arch.walkSpeed ?? 1.6));
    // Back off facing you (a fighter), or turn and run (a musket man).
    if (this.arch.style === 'ranged') this.body.targetYaw = Math.atan2(_v.x, _v.z);
    else this.body.faceTowards(tp.x, tp.z);
    void dt;
  }

  private flee(): void {
    const t = this.eyes.target;
    if (!t) return;
    const tp = t.object3d.position;
    const me = this.pos;
    _v.set(me.x - tp.x, 0, me.z - tp.z).normalize();
    this.body.clearDirection(_v, 2);
    this.body.desired.copy(_v).multiplyScalar(this.arch.runSpeed ?? 4.4);
    this.body.targetYaw = Math.atan2(_v.x, _v.z);
  }

  // --- death and loot --------------------------------------------------------

  private die(dropLoot: boolean): void {
    this.activity = 'dead';
    this.body.setLimp(true);
    this.fighter.cancel();
    if (dropLoot && !this.looted) this.dropLoot();
  }

  /** What it carried lands by the body: its weapon (as it was, loaded or not), ammo, coins, armour. */
  private dropLoot(): void {
    this.looted = true;
    const p = this.pos;
    const chance = this.arch.dropChance ?? {};
    const items = [...this.bag.contents(), ...(this.arch.armour ?? []).map((a) => ({ item: a, count: 1, data: undefined }))];
    items.forEach((it, n) => {
      if (!(it.item in Items)) return;
      if (this.rng() > (chance[it.item] ?? 1)) return;
      const a = (n / Math.max(1, items.length)) * Math.PI * 2 + 0.6;
      spawnPickup(this.game, {
        item: it.item,
        count: it.count,
        data: it.data,
        position: [p.x + Math.cos(a) * 0.7, p.y + 0.02, p.z + Math.sin(a) * 0.7],
        yawDeg: (a * 180) / Math.PI,
      });
    });
    this.bag.clear();
  }

  saveState(): unknown {
    const p = this.pos;
    return { dead: this.health.dead, looted: this.looted, pos: [p.x, p.y, p.z], yaw: this.body.yaw };
  }

  loadState(s: { dead?: boolean; looted?: boolean; pos?: number[]; yaw?: number }): void {
    if (!s) return;
    const wasDead = this.activity === 'dead';
    this.eyes.target = null;
    this.eyes.noise = null;
    this.eyes.awareness = 0;
    if (s.pos) this.body.teleport(new THREE.Vector3(s.pos[0], s.pos[1], s.pos[2]), s.yaw ?? this.homeYaw);
    if (s.dead) {
      // Damageable just restored full health (it does for the living); a body stays a body.
      this.health.health = 0;
      this.health.statuses.clear();
      this.looted = true;
      this.bag.clear();
      this.die(false);
      return;
    }
    if (wasDead) {
      // Alive in the save: up again, with its kit back.
      this.body.setLimp(false);
      this.looted = false;
      this.bag.clear();
      for (const [item, n] of Object.entries(this.arch.carry)) this.bag.add(item, n);
      this.equipWeapon();
    }
    this.activity = 'idle';
    this.fled = false;
  }
}
