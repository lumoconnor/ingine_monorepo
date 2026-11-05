import * as THREE from 'three';
import type { Game } from '../../core/Game';
import { Entity } from '../../entities/Entity';
import { RAPIER } from '../../physics/PhysicsWorld';
import { RigidBodyComponent } from '../../physics/RigidBodyComponent';
import { PlayerConfig } from '../../config/player';
import { PlayerController } from './PlayerController';
import { FirstPersonCamera } from './FirstPersonCamera';
import { UnderwaterEffect } from './UnderwaterEffect';
import { PlayerInteractor } from '../interaction/PlayerInteractor';
import { Damageable } from '../../combat/Damageable';
import { PlayerCombat } from '../../combat/PlayerCombat';
import { Combatant } from '../../combat/Combatant';
import { Armour } from '../../combat/Armour';
import { CombatFeel } from '../../combat/feel/CombatFeel';
import { FistViewmodel } from '../../combat/FistViewmodel';
import { CombatConfig } from '../../config/combat';

/** Factory: assembles the player entity from its components. */
export function createPlayer(game: Game, spawn: THREE.Vector3, yaw = 0): Entity {
  const c = PlayerConfig;
  const half = PlayerController.halfHeightFor(c.standHeight, c.radius);

  const player = new Entity('player');
  player.tags.add('player');
  player.object3d.position.copy(spawn);

  player.add(
    new RigidBodyComponent({
      type: 'kinematicPosition',
      colliders: [
        RAPIER.ColliderDesc.capsule(half, c.radius)
          .setTranslation(0, half + c.radius, 0)
          .setFriction(0),
      ],
    }),
  );
  const ctrl = player.add(new PlayerController());
  ctrl.yaw = ctrl.spawnYaw = yaw;
  player.add(new FirstPersonCamera());
  player.add(new PlayerInteractor());
  player.add(new UnderwaterEffect());
  player.add(
    new Damageable({
      id: 'player',
      maxHealth: CombatConfig.player.maxHealth,
      // Head, torso or legs by where a blow lands on the capsule (crouching lowers the head).
      zoneAt: (p) => {
        const h = p.y - player.object3d.position.y;
        const top = ctrl.crouched ? c.crouchHeight : c.standHeight;
        return h > top - 0.32 ? 'head' : h > top * 0.48 ? 'torso' : 'limbs';
      },
    }),
  );
  player.add(new Combatant({ faction: 'player' }));
  player.add(new PlayerCombat());
  player.add(new FistViewmodel());
  // Last, so older saves (keyed by component position) still line up.
  player.add(new Armour());
  player.add(new CombatFeel());

  game.world.spawn(player);
  return player;
}
