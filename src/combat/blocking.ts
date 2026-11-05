import * as THREE from 'three';
import { registerModifier } from './registry';
import { Combatant } from './Combatant';

const _f = new THREE.Vector3();
const _in = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
/** A guard covers this half-angle in front of you (degrees). */
const GUARD_ARC = 70;

/**
 * Damage step 10: blocking and parrying. While a Combatant holds a guard,
 * a hit from in front loses the weapon's `block.reduce` share of each damage
 * type (a sword turns most of a cut, nothing of a bullet) and costs stamina:
 * `staminaPerHit` plus a third of what was stopped. Run out and the guard
 * breaks (you stagger). A melee hit in the first `parryWindow` seconds of a
 * guard is parried instead: no damage, and the attacker staggers.
 */
registerModifier({
  name: 'block',
  order: 10,
  apply: ({ hit, target, packets, tags }) => {
    const f = target.entity.get(Combatant);
    if (!f || f.state !== 'blocking' || !hit.delivery || hit.delivery === 'status' || hit.delivery === 'hazard') return;
    const b = f.weapon.block;
    if (!b) return;
    // Where it came from, flattened: the direction it travelled, or from the attacker to us.
    if (hit.direction) _in.copy(hit.direction).negate();
    else if (hit.attacker) _in.copy(hit.attacker.object3d.getWorldPosition(_a)).sub(target.entity.object3d.getWorldPosition(_b));
    else return;
    f.facing(_f);
    _f.y = 0;
    _in.y = 0;
    if (_f.lengthSq() < 1e-6 || _in.lengthSq() < 1e-6) return;
    if (_f.normalize().dot(_in.normalize()) < Math.cos((GUARD_ARC * Math.PI) / 180)) return;

    const other = hit.attacker?.get(Combatant);
    if (f.parrying && hit.delivery === 'sweep' && other) {
      for (const p of packets) p.amount = 0;
      tags.add('parried');
      other.stagger(1.1, 'parried');
      target.game.events.emit('combat:parried', { defender: target.entity, attacker: hit.attacker! });
      return;
    }
    let stopped = 0;
    for (const p of packets) {
      const r = Math.min(1, Math.max(0, b.reduce[p.type] ?? 0));
      stopped += p.amount * r;
      p.amount *= 1 - r;
    }
    if (stopped <= 0) return;
    tags.add('blocked');
    f.spendStamina((b.staminaPerHit ?? 10) + stopped / 3);
    if (f.stamina <= 0) {
      tags.add('guardbreak');
      f.stagger(0.9, 'guard broken');
    }
  },
});
