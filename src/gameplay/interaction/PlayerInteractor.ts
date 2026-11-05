import * as THREE from 'three';
import { Component } from '@/entities/Component';
import { RAPIER } from '@/physics/PhysicsWorld';
import { RigidBodyComponent } from '@/physics/RigidBodyComponent';
import { Interactable } from './Interactable';

const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const MAX_RANGE = 4;

/**
 * Lets the player use whatever is under the crosshair. Each frame it casts a
 * ray from the camera, remembers the Interactable it hits (if within that
 * thing's range) and tells the HUD what to show. The interact key is consumed
 * on the fixed step so it lines up with the rest of the simulation.
 */
export class PlayerInteractor extends Component {
  /** Runs after FirstPersonCamera (100) so the ray uses this frame's camera. */
  order = 110;
  target: Interactable | null = null;
  private lastPrompt: string | null = null;
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });

  update(): void {
    this.refreshTarget();
  }

  fixedUpdate(): void {
    if (!this.game.input.wasPressed('interact')) return;
    this.refreshTarget();
    this.target?.interact(this.entity);
    this.refreshTarget();
  }

  /** Re-aim from the current camera pose. Public so tests can drive it headlessly. */
  refreshTarget(): void {
    const cam = this.game.renderer.camera;
    cam.updateMatrixWorld();
    cam.getWorldPosition(_origin);
    cam.getWorldDirection(_dir);
    this.ray.origin = { x: _origin.x, y: _origin.y, z: _origin.z };
    this.ray.dir = { x: _dir.x, y: _dir.y, z: _dir.z };

    const body = this.entity.get(RigidBodyComponent)?.body;
    const hit = this.game.physics.world.castRay(
      this.ray,
      MAX_RANGE,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      undefined,
      body,
    );
    let target: Interactable | null = null;
    if (hit) {
      const ia = this.game.physics.ownerOf(hit.collider)?.get(Interactable);
      if (ia && ia.enabled && hit.timeOfImpact <= ia.range && ia.accepts(hit.collider)) target = ia;
    }
    this.target = target;
    const prompt = target ? target.prompt : null;
    if (prompt !== this.lastPrompt) {
      this.lastPrompt = prompt;
      this.game.events.emit('interact:focus', { prompt });
    }
  }

  onDetach(): void {
    if (this.lastPrompt !== null) this.game.events.emit('interact:focus', { prompt: null });
  }
}
