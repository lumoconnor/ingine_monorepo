import * as THREE from 'three';
import type { Game } from '../core/Game';
import { Entity } from '../entities/Entity';
import { RAPIER } from '../physics/PhysicsWorld';
import { RigidBodyComponent } from '../physics/RigidBodyComponent';
import { makeLabel } from '../render/labels';
import { Interactable } from '../gameplay/interaction/Interactable';
import { Npc } from '../gameplay/components/Npc';
import { Wander, type WanderOptions } from '../gameplay/components/Wander';
import type { DialogueSystem } from '../dialogue/DialogueSystem';

type Vec3 = [number, number, number];

export interface NpcOptions {
  /** Unique id; also the entity name. */
  id: string;
  name: string;
  /** Dialogue tree id (see src/content/dialogue). */
  dialogue: string;
  /** Feet position. */
  position: Vec3;
  /** Which way they face when idle: 0 = +Z, 90 = +X, 180 = -Z, -90 = -X. */
  facingDeg: number;
  color: number;
  /** Walk a loop instead of standing still. */
  wander?: WanderOptions;
  /** Words their dialogue can use as `{npc.key}`. */
  vars?: Record<string, string>;
  /** Show the name tag only within this range (crowds). Default: always. */
  tagRange?: number;
  /** Skin tone and a hat or helmet, for telling generic villagers apart. */
  skin?: number;
  hat?: { color: number; kind: 'cap' | 'helm' | 'hood' };
}

const skinDefault = new THREE.MeshStandardMaterial({ color: 0xe0b48f, roughness: 0.8 });
const skins = new Map<number, THREE.MeshStandardMaterial>();
const cloth = new Map<number, THREE.MeshStandardMaterial>();
const mat = (cache: Map<number, THREE.MeshStandardMaterial>, color: number, roughness: number, metalness = 0) => {
  let m = cache.get(color);
  if (!m) cache.set(color, (m = new THREE.MeshStandardMaterial({ color, roughness, metalness })));
  return m;
};
const dark = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.6 });

/** A placeholder character: capsule body, head with a nose (so you can see where it looks), name tag. */
export function addNpc(game: Game, o: NpcOptions): Entity {
  const root = new THREE.Group();
  root.position.set(...o.position);
  const skin = o.skin === undefined ? skinDefault : mat(skins, o.skin, 0.8);

  const body = new THREE.Group();
  root.add(body);
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.3, 0.75, 4, 12),
    mat(cloth, o.color, 0.75),
  );
  torso.position.y = 0.3 + 0.375 + 0.05;
  torso.castShadow = true;
  body.add(torso);

  const head = new THREE.Group();
  head.position.y = 1.58;
  body.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), skin);
  skull.castShadow = true;
  head.add(skull);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.1), skin);
  nose.position.set(0, -0.02, 0.2);
  head.add(nose);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), dark);
    eye.position.set(side * 0.075, 0.04, 0.175);
    head.add(eye);
  }

  if (o.hat) {
    const helm = o.hat.kind === 'helm';
    const hat = new THREE.Mesh(
      o.hat.kind === 'cap'
        ? new THREE.CylinderGeometry(0.17, 0.2, 0.12, 12)
        : new THREE.SphereGeometry(0.225, 14, 8, 0, Math.PI * 2, 0, Math.PI * (helm ? 0.5 : 0.62)),
      mat(cloth, o.hat.color, helm ? 0.4 : 0.8, helm ? 0.6 : 0),
    );
    hat.position.y = o.hat.kind === 'cap' ? 0.17 : 0.02;
    hat.castShadow = true;
    head.add(hat);
  }

  const tag = makeLabel(o.name, { scale: 0.7, color: '#ffe7a8' });
  tag.position.y = 2.15;
  root.add(tag);

  const e = new Entity(o.id, root);
  e.tags.add('npc');
  e.add(
    new RigidBodyComponent({
      type: o.wander ? 'kinematicPosition' : 'fixed',
      colliders: [RAPIER.ColliderDesc.capsule(0.55, 0.3).setTranslation(0, 0.85, 0)],
    }),
  );
  const npc = e.add(new Npc(o.id, o.name, o.dialogue, body, head, THREE.MathUtils.degToRad(o.facingDeg)));
  if (o.vars) npc.vars = o.vars;
  if (o.tagRange !== undefined) {
    npc.tag = tag;
    npc.tagRange = o.tagRange;
    tag.visible = false;
  }
  if (o.wander) e.add(new Wander(o.wander));
  e.add(
    new Interactable({
      prompt: `Talk to ${o.name}`,
      range: 3,
      onInteract: () => game.getSystem<DialogueSystem>('dialogue')?.start(o.dialogue, e, npc),
    }),
  );
  game.world.spawn(e);
  return e;
}
