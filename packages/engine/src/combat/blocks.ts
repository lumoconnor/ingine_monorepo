import { Effects, checkParam, type ParamSpec } from '../dialogue/registry';
import { DamageTypes, checkStatuses } from './registry';
import type { AttackModeDef, DeliveryDef, PayloadDef, WeaponDef } from './weaponTypes';

/**
 * The registered building blocks of an attack mode. Each kind lists the
 * parameters it accepts so weapon JSON is checked at startup; games add
 * their own kinds with registerTrigger / registerFeeder / registerDelivery /
 * registerArc. How a kind behaves lives with whoever runs it: triggers and
 * feeders in Combatant, deliveries in CombatSystem.
 */

type Spec = Record<string, ParamSpec | 'any'>;
interface KindDef {
  params: Spec;
}

const num = (optional = true): ParamSpec => ({ type: 'number', optional });

export const Triggers: Record<string, KindDef> = {
  press: { params: { delay: num(), misfire: num(), jam: num() } },
  'hold-auto': { params: { rpm: num(false), delay: num(), misfire: num(), jam: num() } },
  burst: { params: { rpm: num(false), count: num(false), misfire: num(), jam: num() } },
  charge: { params: { min: num(), max: num(false), cook: 'any', holdStamina: num(), misfire: num() } },
  combo: { params: { steps: 'any', window: num() } },
};

export const Feeders: Record<string, KindDef> = {
  none: { params: {} },
  magazine: { params: { capacity: num(false), reload: num(false), tactical: num(), interruptible: 'any' } },
  'single-load': { params: { capacity: num(false), loadTime: num(false), interruptible: 'any' } },
  sequence: { params: { steps: 'any', interruptible: 'any' } },
  self: { params: {} },
};

export const Deliveries: Record<string, KindDef> = {
  sweep: { params: { reach: num(false), radius: num(), arc: { type: 'string' } } },
  hitscan: { params: { range: num(false), pellets: num(), spread: 'any' } },
  projectile: { params: { speed: 'any', gravity: num(), drag: num(), onImpact: { type: 'string', optional: true }, fuse: num(), then: 'any', spread: 'any', pellets: num(), hand: 'any' } },
  area: { params: { radius: num(false), falloff: { type: 'string', optional: true }, lineOfSight: 'any' } },
};

/** Swing paths for `sweep`: yaw/pitch offsets in degrees from the aim, for progress 0..1. Positive yaw = left. */
export type Arc = (p: number) => { yaw: number; pitch: number };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const Arcs: Record<string, Arc> = {
  jab: () => ({ yaw: 0, pitch: 0 }),
  thrust: (p) => ({ yaw: lerp(4, 0, p), pitch: lerp(-6, 0, p) }),
  slash_r: (p) => ({ yaw: lerp(-55, 55, p), pitch: lerp(12, -14, p) }),
  slash_l: (p) => ({ yaw: lerp(55, -55, p), pitch: lerp(12, -14, p) }),
  overhead: (p) => ({ yaw: lerp(6, -4, p), pitch: lerp(60, -45, p) }),
};

export function registerTrigger(kind: string, def: KindDef): void {
  Triggers[kind] = def;
}
export function registerFeeder(kind: string, def: KindDef): void {
  Feeders[kind] = def;
}
export function registerDelivery(kind: string, def: KindDef): void {
  Deliveries[kind] = def;
}
export function registerArc(name: string, arc: Arc): void {
  Arcs[name] = arc;
}

/** The mode with `use` resolved (copy another mode, then override). */
export function resolveMode(w: WeaponDef, name: string, seen = new Set<string>()): AttackModeDef {
  const m = w.modes[name];
  if (!m.use) return m;
  if (seen.has(name)) throw new Error(`mode "${name}": "use" loops`);
  seen.add(name);
  const base = resolveMode(w, m.use, seen);
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(m)) {
    if (k === 'use') continue;
    const b = (base as unknown as Record<string, unknown>)[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && b && typeof b === 'object' ? { ...b, ...v } : v;
  }
  return out as unknown as AttackModeDef;
}

function checkKind(errs: string[], where: string, table: Record<string, KindDef>, block: { kind?: unknown } | undefined, what: string): void {
  if (!block || typeof block.kind !== 'string') return void errs.push(`${where}: needs a ${what} with a "kind"`);
  const def = table[block.kind];
  if (!def) return void errs.push(`${where}: unknown ${what} "${block.kind}" (known: ${Object.keys(table).join(', ')})`);
  for (const [k, spec] of Object.entries(def.params)) {
    if (spec === 'any') continue;
    const msg = checkParam(spec, (block as Record<string, unknown>)[k]);
    if (msg) errs.push(`${where}: ${what} "${k}" ${msg}`);
  }
  for (const k of Object.keys(block)) if (k !== 'kind' && !(k in def.params)) errs.push(`${where}: ${what} "${block.kind}" has unknown parameter "${k}"`);
}

export function checkPayload(errs: string[], where: string, p: PayloadDef | undefined): void {
  if (!p) return;
  if (!Array.isArray(p.damage)) return void errs.push(`${where}: payload needs a "damage" list`);
  p.damage.forEach((d, i) => {
    if (!(d.type in DamageTypes)) errs.push(`${where}: damage[${i}] unknown type "${d.type}" (known: ${Object.keys(DamageTypes).join(', ')})`);
    if (!(typeof d.amount === 'number' && d.amount >= 0)) errs.push(`${where}: damage[${i}] "amount" must be a number >= 0`);
  });
  p.onHit?.forEach((e, i) => {
    if (!Effects[e?.do]) errs.push(`${where}: onHit[${i}] unknown effect "${e?.do}"`);
  });
  try {
    checkStatuses(where, p.status);
  } catch (e) {
    errs.push((e as Error).message);
  }
}

function checkDelivery(errs: string[], where: string, d: DeliveryDef | undefined): void {
  checkKind(errs, where, Deliveries, d, 'delivery');
  if (!d) return;
  if (d.kind === 'sweep' && d.arc && d.arc !== 'step' && !Arcs[d.arc]) errs.push(`${where}: unknown arc "${d.arc}" (known: step, ${Object.keys(Arcs).join(', ')})`);
  if (d.then) checkDelivery(errs, `${where} then`, d.then);
}

/** Checks a weapon block; pushes readable errors. `ammoOk` says whether an id is an ammo item. */
export function validateWeapon(errs: string[], id: string, w: WeaponDef, ammoOk: (id: string) => boolean): void {
  const where = (m: string) => `${id}.${m}`;
  if (!w.modes || !Object.keys(w.modes).length) return void errs.push(`${id}: weapon needs at least one mode`);
  w.ammo?.forEach((a) => {
    if (!ammoOk(a)) errs.push(`${id}: ammo "${a}" is not an ammo item`);
  });
  for (const name of Object.keys(w.modes)) {
    let m: AttackModeDef;
    try {
      m = resolveMode(w, name);
    } catch (e) {
      errs.push(`${id}: ${(e as Error).message}`);
      continue;
    }
    if (m.use && !w.modes[m.use]) errs.push(`${where(name)}: "use" names unknown mode "${m.use}"`);
    checkKind(errs, where(name), Triggers, m.trigger, 'trigger');
    if (m.feeder) checkKind(errs, where(name), Feeders, m.feeder, 'feeder');
    checkDelivery(errs, where(name), m.delivery);
    checkPayload(errs, where(name), m.payload);
    if (m.trigger?.kind === 'combo') {
      const steps = m.trigger.steps;
      if (!Array.isArray(steps) || !steps.length) errs.push(`${where(name)}: combo needs "steps"`);
      else steps.forEach((s) => !Arcs[s] && errs.push(`${where(name)}: combo step "${s}" is not an arc`));
    }
    if (m.feeder?.kind === 'sequence') {
      const ok = Array.isArray(m.feeder.steps) && m.feeder.steps.every((s) => Array.isArray(s) && s.length === 2 && typeof s[0] === 'string' && typeof s[1] === 'number');
      if (!ok) errs.push(`${where(name)}: sequence "steps" must be [["name", seconds], ...]`);
    }
    const needsAmmo = m.feeder && ['magazine', 'single-load', 'sequence'].includes(m.feeder.kind);
    if (needsAmmo && !w.ammo?.length) errs.push(`${where(name)}: a ${m.feeder!.kind} feeder needs an "ammo" list`);
    if (!m.payload && !w.ammo?.length) errs.push(`${where(name)}: needs a payload (or ammo that carries one)`);
  }
  const v = w.view;
  if (v?.position && v.position.length !== 3) errs.push(`${id}: view.position must be [x, y, z]`);
  if (v?.rotation && v.rotation.length !== 3) errs.push(`${id}: view.rotation must be [x, y, z] degrees`);
}
