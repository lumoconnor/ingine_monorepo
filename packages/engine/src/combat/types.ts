import type * as THREE from 'three';
import type { Entity } from '../entities/Entity';

/**
 * Combat data shapes shared by the combat system, Damageable and content.
 * Everything a hit carries is plain data, so attacks can be described in JSON
 * (see docs: "Combat system architecture").
 */

/** Registered in src/content/combat/damage-types.json. */
export interface DamageTypeDef {
  name: string;
  /** Hit zones don't change it (fire, falling, blasts). */
  ignoresZones?: boolean;
  /** Armour resistances don't apply (falling). */
  ignoresResist?: boolean;
}

/** One portion of damage of one type. A hit can carry several (a flaming arrow: pierce + fire). */
export interface DamagePacket {
  type: string;
  amount: number;
}

export interface Hit {
  /** Who caused it; null for the world (falls, hazards). */
  attacker: Entity | null;
  packets: DamagePacket[];
  /** Hurtbox zone that was struck (head, torso, limbs), or null when none applies. */
  zone: string | null;
  /** What did it, for events and logs: "fists", "fall", "fire pit". */
  source: string;
  /** World-space impact point and direction of travel, when known. */
  point?: THREE.Vector3;
  direction?: THREE.Vector3;
  /** How it was delivered (sweep, hitscan, projectile, area). Only melee (sweep) can be parried. */
  delivery?: string;
  /** Statuses it may cause (bleeding, burning). */
  status?: StatusSpec[];
}

/** A status a hit may cause: `chance` (default 1) is scaled by how much of the hit got through. */
export interface StatusSpec {
  id: string;
  seconds: number;
  chance?: number;
}

export interface HitResult {
  /** Health actually removed (after zones, resistances, clamping). */
  damage: number;
  /** Damage per packet type after modifiers, before clamping. */
  byType: Record<string, number>;
  health: number;
  killed: boolean;
  /** What happened on the way: blocked, parried, guardbreak, armour. */
  tags: string[];
  /** Statuses this hit started or extended. */
  statuses: string[];
}
