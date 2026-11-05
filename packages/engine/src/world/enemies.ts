import * as THREE from 'three';
import type { Game } from '../core/Game';
import { Entity } from '../entities/Entity';
import { RAPIER } from '../physics/PhysicsWorld';
import { RigidBodyComponent } from '../physics/RigidBodyComponent';
import { Items } from '../inventory/catalog';
import { Damageable, killedFlag } from '../combat/Damageable';
import { Combatant } from '../combat/Combatant';
import { Armour } from '../combat/Armour';
import { LocalBag } from '../combat/Bag';
import { Perception } from '../combat/ai/Perception';
import { NpcBody } from '../combat/ai/NpcBody';
import { NpcRig } from '../combat/ai/NpcRig';
import { EnemyBrain, type Archetype } from '../combat/ai/EnemyBrain';
import { Factions } from '../combat/ai/factions';

type Vec3 = [number, number, number];

export const Archetypes: Record<string, Archetype> = {};

export function registerArchetype(id: string, def: Archetype): void {
  Archetypes[id] = def;
}

/** Checks archetypes at startup: known factions, items, styles. */
export function validateArchetypes(): void {
  const errs: string[] = [];
  for (const [id, a] of Object.entries(Archetypes)) {
    if (!Factions[a.faction]) errs.push(`${id}: unknown faction "${a.faction}"`);
    for (const it of [...Object.keys(a.carry ?? {}), ...(a.armour ?? []), ...(a.draw ? [a.draw] : [])]) if (!Items[it]) errs.push(`${id}: unknown item "${it}"`);
    if (a.draw && !(a.carry?.[a.draw] > 0)) errs.push(`${id}: draws "${a.draw}" but doesn't carry one`);
    for (const p of a.armour ?? []) if (!Items[p]?.armour) errs.push(`${id}: "${p}" isn't armour`);
    if (!['melee', 'ranged'].includes(a.style)) errs.push(`${id}: style must be melee or ranged`);
  }
  if (errs.length) throw new Error(`Enemy archetypes are invalid:\n  ${errs.join('\n  ')}`);
}

export interface EnemyOptions {
  /** Stable id: entity name, kill flag `killed.<id>`, save key. */
  id: string;
  archetype: string;
  /** Feet position; also where it stands guard. */
  position: Vec3;
  facingDeg?: number;
}

const HEIGHT = 1.78;
const RADIUS = 0.3;

/** An enemy from an archetype: body, senses, brain, weapon and kit. */
export function addEnemy(game: Game, o: EnemyOptions): Entity {
  const a = Archetypes[o.archetype];
  if (!a) throw new Error(`Unknown archetype "${o.archetype}"`);
  const root = new THREE.Group();
  root.position.set(...o.position);
  const yaw = THREE.MathUtils.degToRad(o.facingDeg ?? 0);
  root.rotation.y = yaw;
  const e = new Entity(o.id, root);
  e.tags.add('enemy');
  const half = (HEIGHT - 2 * RADIUS) / 2;
  e.add(
    new RigidBodyComponent({
      type: 'kinematicPosition',
      colliders: [RAPIER.ColliderDesc.capsule(half, RADIUS).setTranslation(0, half + RADIUS, 0)],
    }),
  );
  e.add(
    new Damageable({
      id: o.id,
      maxHealth: a.health,
      zoneAt: (p) => {
        const h = p.y - e.object3d.position.y;
        return h > HEIGHT - 0.3 ? 'head' : h > 0.9 ? 'torso' : 'limbs';
      },
    }),
  );
  const bag = new LocalBag(a.carry);
  // Its gun comes loaded.
  for (const inst of bag.instancesOf()) {
    const fm = Items[inst.item]?.weapon;
    if (fm?.ammo?.length) {
      inst.data.loaded = 1;
      inst.data.ammoType = fm.ammo[0];
    }
  }
  e.add(new Combatant({ faction: a.faction, bag, windupScale: a.windupScale ?? 1.8 }));
  e.add(new Perception({ sight: a.sight }));
  e.add(new NpcBody(yaw));
  e.add(new EnemyBrain(o.archetype, a, new THREE.Vector3(...o.position), yaw, bag));
  e.add(new Armour({ pieces: a.armour, fromInventory: false }));
  const hex = (s: string | undefined, d: number) => (s ? parseInt(s, 16) : d);
  e.add(new NpcRig({ tunic: hex(a.look?.tunic, 0x6e3b2a), hood: hex(a.look?.hood, 0x3b2a1f) }));
  game.world.spawn(e);
  // Killed in an earlier visit (the save says so): lies where it fell.
  if (game.state.hasFlag(killedFlag(o.id))) e.get(EnemyBrain)!.loadState({ dead: true });
  return e;
}
