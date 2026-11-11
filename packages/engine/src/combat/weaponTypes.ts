import type { Effect } from '../dialogue/types';

/**
 * The weapon data format (the `weapon` block of an item in items.json).
 *
 * A weapon is a set of attack modes. Each mode picks one trigger (when it
 * fires), timing (how long it commits you), feeder (what it costs and how
 * it reloads), delivery (how it finds what it hit) and payload (what the hit
 * does). Every `kind` is registered in combat/blocks.ts, which also checks
 * the parameters at startup. Nothing here knows about eras: a longbow and a
 * rifle differ only in which kinds they pick and the numbers.
 */

export interface WeaponDef {
  /** Thrown weapons (grenades) stack like ammo instead of being kept one by one. */
  stack?: boolean;
  /** How far away (m) a shot or swing is heard; default by delivery (guns 45, bows 10, melee 6). */
  noise?: number;
  /** Ammo item ids this weapon accepts, in order of preference. */
  ammo?: string[];
  modes: Record<string, AttackModeDef>;
  handling?: HandlingDef;
  /** Melee blocking (phase 4). */
  block?: BlockDef;
  /** How it is held in first person. */
  view?: ViewDef;
}

export interface AttackModeDef {
  /** Copy every field of another mode, then override (a burst mode reusing "primary"). */
  use?: string;
  /** Which button: attack (left) or altAttack (right). Default: attack, or altAttack for "secondary". */
  input?: 'attack' | 'altAttack';
  trigger: TriggerDef;
  timing?: TimingDef;
  feeder?: FeederDef;
  delivery: DeliveryDef;
  /** Ammo with a payload overrides this one. */
  payload?: PayloadDef;
  /** Stamina per attack (phase 4). */
  stamina?: number;
}

export interface TriggerDef {
  /** press | hold-auto | burst | charge | combo */
  kind: string;
  /** hold-auto, burst: rounds per minute. */
  rpm?: number;
  /** burst: rounds per burst. */
  count?: number;
  /** charge: seconds held before it counts (shorter is a tap), and seconds to full power. */
  min?: number;
  max?: number;
  /** combo: the swings in order (names of arcs), and seconds after a swing during which another click continues it. */
  steps?: string[];
  window?: number;
  /** combo: a queued swing may start once this fraction of the recovery has passed (default 1: wait it all out). */
  cancel?: number;
  /** combo: the last step hits harder and leaves you open longer (multipliers). */
  finisher?: { damage?: number; recovery?: number };
  /** Delay between pulling the trigger and the shot (a flintlock's pan flash). */
  delay?: number;
  /** Chance per shot of a misfire (the shot is lost) or a jam (needs clearing with reload). */
  misfire?: number;
  jam?: number;
  /** charge: holding past the fuse means it goes off in your hand (grenades). */
  cook?: boolean;
  /** charge: stamina per second while held (drawing a bow, phase 4). */
  holdStamina?: number;
}

export interface TimingDef {
  /** Melee: seconds before the blow lands, the blow itself, and the follow-through. */
  windup?: number;
  active?: number;
  recovery?: number;
  /** Melee: metres you step forward as the blow goes in. */
  lunge?: number;
}

export interface FeederDef {
  /** none | magazine | single-load | sequence | self */
  kind: string;
  /** magazine / single-load: rounds held. */
  capacity?: number;
  /** magazine: seconds for an empty reload, and for one with a round still in. */
  reload?: number;
  tactical?: number;
  /** single-load: seconds per round. */
  loadTime?: number;
  /** sequence: named steps with seconds each (powder, ball, ram, prime). */
  steps?: (string | number)[][];
  /** Attacking stops a reload part way (single-load keeps rounds already in). */
  interruptible?: boolean;
}

export interface DeliveryDef {
  /** sweep | hitscan | projectile | area */
  kind: string;
  /** sweep: metres from the eye, ball radius, and which arc (see blocks.ts ARCS). */
  reach?: number;
  radius?: number;
  arc?: string;
  /** hitscan: maximum range (m), pellets per shot. */
  range?: number;
  pellets?: number;
  /** Where a projectile leaves from, [right, up] of the eye in metres (default [0.12, -0.08]). */
  hand?: number[];
  /** hitscan / projectile: cone half-angle in degrees, from the hip and aimed, plus bloom per shot. */
  spread?: { hip: number; ads?: number; bloomPerShot?: number; bloomMax?: number; recover?: number };
  /** projectile: launch speed (m/s), or [min, max] scaled by charge. */
  speed?: number | number[];
  /** projectile: gravity multiplier (1 = normal), air drag per second. */
  gravity?: number;
  drag?: number;
  /** projectile: what happens on contact. */
  onImpact?: string;
  /** projectile: seconds until it goes off, then what it does. */
  fuse?: number;
  then?: DeliveryDef;
  /** area: blast radius (m), damage falloff, and whether walls shelter you. */
  falloff?: string;
  lineOfSight?: boolean;
}

export interface DamageDef {
  type: string;
  amount: number;
  /** charge: damage multiplier at full charge (1 at none). */
  chargeScale?: number;
}

export interface PayloadDef {
  damage: DamageDef[];
  /** Push on what it hits (N·s). */
  impulse?: number;
  /** Statuses it may cause (bleeding, burning): chance (default 1) scales with how much of the hit got through. */
  status?: { id: string; seconds: number; chance?: number }[];
  /** Any registered effect (setFlag, notify...), run when it hits something that can be hurt. */
  onHit?: Effect[];
}

export interface HandlingDef {
  /** Aiming down sights: FOV multiplier (0.7 = zoom in). Needs altAttack free (no secondary mode). */
  ads?: number;
  /** Walking speed multiplier while it is drawn (and while aiming, adsMove). */
  move?: number;
  adsMove?: number;
  /** View kick per shot, degrees: pitch up, and random yaw either way. */
  recoil?: { pitch: number; yaw?: number };
}

export interface BlockDef {
  /** Fraction of each damage type taken away while blocking. */
  reduce: Record<string, number>;
  /** Seconds at the start of a block that count as a parry (no damage, attacker staggered). */
  parryWindow?: number;
  /** Stamina per blocked hit. */
  staminaPerHit?: number;
}

export interface ViewDef {
  /** Item model to hold (defaults to the item's own model). */
  model?: string;
  /** Offset from the eye (right, up, forward is negative), Euler degrees, scale. */
  position?: number[];
  rotation?: number[];
  scale?: number;
  /** Where it sits while aiming down sights (sights on the crosshair). */
  sight?: number[];
  /** Where it moves while charging (a bow drawn in toward the eye). */
  draw?: number[];
}
