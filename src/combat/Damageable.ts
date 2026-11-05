import { Component } from '@/entities/Component';
import { RAPIER } from '@/physics/PhysicsWorld';
import { RigidBodyComponent } from '@/physics/RigidBodyComponent';
import { HURTBOX_GROUPS } from '@/physics/groups';
import type { Saveable } from '@/core/SaveSystem';
import type { Entity } from '@/entities/Entity';
import { checkPackets, damageModifiers, Statuses } from './registry';
import type { Hit, HitResult, StatusSpec } from './types';

/** A status under way on someone. */
export interface ActiveStatus {
  id: string;
  remaining: number;
  /** Time to the next damage tick. */
  next: number;
  attacker: Entity | null;
  source: string;
}

export interface HurtboxSpec {
  /** Zone name; its multiplier comes from `zones`. */
  zone: string;
  /** Shape and offset (relative to the entity's body). Made a sensor on the hurtbox layer. */
  desc: RAPIER.ColliderDesc;
}

export interface DamageableOptions {
  /** Stable id: when it dies the world flag `killed.<id>` is set (quests and dialogue can check it). */
  id?: string;
  maxHealth: number;
  /** Zone damage multipliers. Default: head 2, torso 1, limbs 0.6. */
  zones?: Record<string, number>;
  /** Resistance per damage type, 0..1 (0.6 = takes 40%). Negative = weakness. */
  resist?: Record<string, number>;
  /** Hit zones. Needs a RigidBodyComponent on the entity, added before this. */
  hurtboxes?: HurtboxSpec[];
  /**
   * Instead of hurtboxes: the zone from where a hit lands on the solid body
   * (a capsule player): `(point) => 'head' | 'torso' | 'limbs'`.
   */
  zoneAt?: (point: { x: number; y: number; z: number }) => string | null;
}

export const DEFAULT_ZONES: Record<string, number> = { head: 2, torso: 1, limbs: 0.6 };
export const killedFlag = (id: string) => `killed.${id}`;

/**
 * Anything that can be hurt: the player, enemies, training dummies, later
 * breakable doors. Holds health and hit zones, runs the damage pipeline
 * (registry modifiers) and reports through events:
 * combat:hit, combat:killed, combat:healed, combat:revived.
 *
 * It decides nothing about what death looks like; whoever owns the entity
 * listens for combat:killed (the player respawns, a dummy falls over).
 */
export class Damageable extends Component implements Saveable {
  readonly maxHealth: number;
  health: number;
  readonly zones: Record<string, number>;
  resist: Record<string, number>;
  /** Ignores all damage (cutscenes, tests). */
  invulnerable = false;
  /** Bleeding, burning... (see registry Statuses). */
  readonly statuses = new Map<string, ActiveStatus>();
  /** Set by whoever knows (the player's controller): standing or swimming in water puts fires out. */
  inWater: () => boolean = () => false;
  private hurtboxZones = new Map<number, string>();
  private hurtboxColliders: RAPIER.Collider[] = [];

  constructor(readonly opts: DamageableOptions) {
    super();
    this.maxHealth = opts.maxHealth;
    this.health = opts.maxHealth;
    this.zones = { ...DEFAULT_ZONES, ...opts.zones };
    this.resist = { ...opts.resist };
  }

  get dead(): boolean {
    return this.health <= 0;
  }

  onAttach(): void {
    if (!this.opts.hurtboxes?.length) return;
    const rb = this.entity.require(RigidBodyComponent);
    for (const hb of this.opts.hurtboxes) {
      const col = this.game.physics.world.createCollider(hb.desc.setSensor(true).setCollisionGroups(HURTBOX_GROUPS), rb.body);
      this.game.physics.registerCollider(col, this.entity);
      this.hurtboxZones.set(col.handle, hb.zone);
      this.hurtboxColliders.push(col);
    }
  }

  onDetach(): void {
    const physics = this.game.physics;
    for (const col of this.hurtboxColliders) {
      physics.unregisterCollider(col);
      // Already gone if the body was removed first (entity destroyed).
      try {
        if (col.isValid()) physics.world.removeCollider(col, false);
      } catch {
        /* removed with its body */
      }
    }
    this.hurtboxColliders = [];
    this.hurtboxZones.clear();
  }

  get hasZones(): boolean {
    return this.hurtboxZones.size > 0;
  }

  /** Zone for a hit on the solid body: by height if `zoneAt` is set, else torso when it has hurtboxes. */
  solidZone(point: { x: number; y: number; z: number }): string | null {
    if (this.opts.zoneAt) return this.opts.zoneAt(point);
    return this.hasZones ? 'torso' : null;
  }

  /** The zone a hurtbox collider stands for, or null if it isn't one of ours. */
  zoneOf(collider: RAPIER.Collider): string | null {
    return this.hurtboxZones.get(collider.handle) ?? null;
  }

  zoneMultiplier(zone: string): number {
    return this.zones[zone] ?? 1;
  }

  /** Runs the hit through the damage pipeline and applies it. */
  applyHit(hit: Hit): HitResult {
    const packets = hit.packets.map((p) => ({ ...p }));
    const result: HitResult = { damage: 0, byType: {}, health: this.health, killed: false, tags: [], statuses: [] };
    if (this.dead || this.invulnerable) return result;
    checkPackets(`hit from ${hit.source}`, packets);
    const tags = new Set<string>();
    const raw = packets.reduce((a, p) => a + p.amount, 0);
    for (const m of damageModifiers()) m.apply({ hit, target: this, packets, tags });
    result.tags = [...tags];
    let total = 0;
    for (const p of packets) {
      const a = Math.max(0, p.amount);
      result.byType[p.type] = (result.byType[p.type] ?? 0) + a;
      total += a;
    }
    const before = this.health;
    this.health = Math.max(0, this.health - total);
    result.damage = before - this.health;
    result.health = this.health;
    result.killed = before > 0 && this.health <= 0;
    // Statuses take hold in proportion to how much of the hit got through:
    // a blocked cut or one turned by mail rarely bleeds.
    if (hit.status && !result.killed && raw > 0) {
      const through = Math.min(1, total / raw);
      for (const st of hit.status) {
        if (this.rng() < (st.chance ?? 1) * through && this.addStatus(st, hit.attacker, hit.source)) result.statuses.push(st.id);
      }
    }
    if (result.killed) this.statuses.clear();
    const events = this.game.events;
    events.emit('combat:hit', { hit, target: this.entity, result });
    if (result.killed) {
      if (this.opts.id) this.game.state.setFlag(killedFlag(this.opts.id));
      events.emit('combat:killed', { target: this.entity, attacker: hit.attacker, source: hit.source });
    }
    return result;
  }

  private rng(): number {
    return this.game.getSystem<import('./CombatSystem').CombatSystem>('combat')?.rng() ?? Math.random();
  }

  /** Starts or extends a status. Returns false if it doesn't apply (dead, unknown). */
  addStatus(spec: StatusSpec, attacker: Entity | null = null, source = spec.id): boolean {
    const def = Statuses[spec.id];
    if (!def || this.dead || this.invulnerable) return false;
    if (def.endsInWater && this.inWater()) return false;
    const max = def.maxSeconds ?? 30;
    const cur = this.statuses.get(spec.id);
    if (cur) {
      cur.remaining = Math.min(max, def.stack === 'add' ? cur.remaining + spec.seconds : Math.max(cur.remaining, spec.seconds));
      cur.attacker = attacker ?? cur.attacker;
    } else {
      this.statuses.set(spec.id, { id: spec.id, remaining: Math.min(max, spec.seconds), next: def.interval ?? 0.5, attacker, source });
      this.game.events.emit('combat:status', { target: this.entity, status: spec.id, on: true });
    }
    return true;
  }

  /** Ends a status (bandages, a draught, water). Returns whether it was on. */
  cure(id: string): boolean {
    if (!this.statuses.delete(id)) return false;
    this.game.events.emit('combat:status', { target: this.entity, status: id, on: false });
    return true;
  }

  hasStatus(id: string): boolean {
    return this.statuses.has(id);
  }

  fixedUpdate(dt: number): void {
    if (!this.statuses.size) return;
    if (this.dead) return void this.statuses.clear();
    for (const st of [...this.statuses.values()]) {
      const def = Statuses[st.id];
      if (def.endsInWater && this.inWater()) {
        this.cure(st.id);
        continue;
      }
      const interval = def.interval ?? 0.5;
      st.remaining -= dt;
      st.next -= dt;
      if (st.next <= 0 && def.damage) {
        st.next += interval;
        const amount = (def.damage.perSecond ?? 0) * interval + (def.damage.amount ?? 0);
        this.applyHit({ attacker: st.attacker, packets: [{ type: def.damage.type, amount }], zone: null, source: def.name.toLowerCase(), delivery: 'status' });
        if (this.dead) return;
      }
      if (st.remaining <= 0) this.cure(st.id);
    }
  }

  /** Restores up to `amount` health; returns how much it restored. Does nothing when dead. */
  heal(amount: number): number {
    if (this.dead) return 0;
    const before = this.health;
    this.health = Math.min(this.maxHealth, this.health + Math.max(0, amount));
    const healed = this.health - before;
    if (healed > 0) this.game.events.emit('combat:healed', { target: this.entity, amount: healed, health: this.health });
    return healed;
  }

  /** Back to full health (respawn, a dummy standing up again). */
  revive(): void {
    this.health = this.maxHealth;
    this.statuses.clear();
    this.game.events.emit('combat:revived', { target: this.entity });
  }

  saveState(): unknown {
    return { health: this.health };
  }

  loadState(state: { health?: number }): void {
    const h = state?.health;
    // A save taken while dying comes back alive at full health rather than mid-death.
    const wasDead = this.dead;
    this.health = typeof h === 'number' && h > 0 ? Math.min(this.maxHealth, h) : this.maxHealth;
    if (wasDead) this.game.events.emit('combat:revived', { target: this.entity });
    else this.game.events.emit('combat:healed', { target: this.entity, amount: 0, health: this.health });
  }
}
