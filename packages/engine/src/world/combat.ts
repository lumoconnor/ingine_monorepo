import * as THREE from 'three';
import type { Game } from '../core/Game';
import { Entity } from '../entities/Entity';
import { Component } from '../entities/Component';
import type { FrameTime } from '../core/Time';
import { RAPIER } from '../physics/PhysicsWorld';
import { RigidBodyComponent } from '../physics/RigidBodyComponent';
import { Damageable } from '../combat/Damageable';
import { TrainingDummy } from '../combat/TrainingDummy';
import { HazardVolume } from '../combat/HazardVolume';
import type { DamagePacket } from '../combat/types';
import { buildModel, modelPart, modelParts } from '../render/models/ModelRegistry';
import './propModels';

type Vec3 = [number, number, number];

export interface DummyOptions {
  /** Entity name and kill flag id (`killed.<id>`). */
  id: string;
  title: string;
  /** Feet position. */
  position: Vec3;
  facingDeg?: number;
  maxHealth?: number;
  resist?: Record<string, number>;
  color?: number;
}

/**
 * A man-sized practice dummy on a post: head, torso and limbs are separate
 * hit zones (head x2, limbs x0.6 by default).
 */
export function addDummy(game: Game, o: DummyOptions): Entity {
  const root = new THREE.Group();
  root.position.set(...o.position);
  root.rotation.y = THREE.MathUtils.degToRad(o.facingDeg ?? 0);
  const model = buildModel('training_dummy');
  root.add(model);
  if (o.color !== undefined) model.traverse((m) => m.name === 'straw' && (((m as THREE.Mesh).material as THREE.MeshStandardMaterial).color.setHex(o.color!)));
  // Everything above the base topples when it goes down.
  const figure = modelPart(model, 'figure');

  const entity = new Entity(o.id, root);
  entity.tags.add('dummy');
  entity.add(
    new RigidBodyComponent({
      type: 'fixed',
      colliders: [RAPIER.ColliderDesc.cylinder(0.89, 0.2).setTranslation(0, 0.9, 0)],
    }),
  );
  entity.add(
    new Damageable({
      id: o.id,
      maxHealth: o.maxHealth ?? 100,
      resist: o.resist,
      hurtboxes: [
        { zone: 'head', desc: RAPIER.ColliderDesc.ball(0.16).setTranslation(0, 1.62, 0) },
        { zone: 'torso', desc: RAPIER.ColliderDesc.cylinder(0.33, 0.27).setTranslation(0, 1.12, 0) },
        { zone: 'limbs', desc: RAPIER.ColliderDesc.cuboid(0.5, 0.06, 0.07).setTranslation(0, 1.38, 0) },
        { zone: 'limbs', desc: RAPIER.ColliderDesc.cuboid(0.12, 0.38, 0.12).setTranslation(0, 0.44, 0) },
      ],
    }),
  );
  entity.add(new TrainingDummy(o.title, figure, 2.05));
  game.world.spawn(entity);
  return entity;
}

export interface FirePitOptions {
  name: string;
  /** Centre, on the ground. */
  position: Vec3;
  /** Damage per second while standing in it. */
  perSecond?: DamagePacket[];
}

/** Flames flicker: scale and light intensity wobble on a few sine waves. */
class Flicker extends Component {
  private t = Math.random() * 10;
  constructor(private flames: THREE.Object3D[], private light: THREE.PointLight) {
    super();
  }
  update(time: FrameTime): void {
    this.t += time.delta;
    const t = this.t;
    this.flames.forEach((f, i) => {
      const s = 1 + 0.18 * Math.sin(t * 9 + i * 2.1) + 0.1 * Math.sin(t * 23 + i);
      f.scale.set(1, s, 1);
    });
    this.light.intensity = 9 + 2.5 * Math.sin(t * 11) + 1.5 * Math.sin(t * 27);
  }
}

/** A ring of stones with burning coals: walk in and it burns. */
export function addFirePit(game: Game, o: FirePitOptions): Entity {
  const root = new THREE.Group();
  root.position.set(...o.position);
  const model = buildModel('fire_pit');
  root.add(model);
  const flames = modelParts(model, 'flame');
  const light = new THREE.PointLight(0xff9a4a, 10, 9, 1.6);
  light.position.y = 0.9;
  root.add(light);

  const e = new Entity(o.name, root);
  e.tags.add('hazard');
  e.add(new HazardVolume({ source: o.name, perSecond: o.perSecond ?? [{ type: 'fire', amount: 25 }], halfExtents: [0.8, 0.7, 0.8], status: [{ id: 'burning', seconds: 2.5 }] }));
  e.add(new Flicker(flames, light));
  game.world.spawn(e);
  return e;
}
