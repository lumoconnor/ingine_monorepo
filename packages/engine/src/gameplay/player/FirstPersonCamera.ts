import * as THREE from 'three';
import { Component } from '../../entities/Component';
import type { FrameTime } from '../../core/Time';
import { PlayerController } from './PlayerController';

const DEG = Math.PI / 180;
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * Drives the main camera from the player. Mouse look is applied every
 * rendered frame (not every physics step) so aiming feels instant. Adds
 * crouch eye-height blending, head bob, landing dip and sprint FOV kick.
 */
/** Landing-dip spring speed (rad/s): ~0.1s down, ~0.4s to recover. */
const DIP_OMEGA = 11;

export class FirstPersonCamera extends Component {
  order = 100;
  private ctrl!: PlayerController;
  private eyeHeight = 0;
  private bobPhase = 0;
  private bobAmount = 0;
  private dip = 0;
  private dipVel = 0;
  private unsub: (() => void) | null = null;

  onAttach(): void {
    this.ctrl = this.entity.require(PlayerController);
    this.eyeHeight = this.ctrl.cfg.standEyeHeight;
    this.unsub = this.game.events.on('player:landed', ({ fallSpeed }) => {
      const c = this.ctrl.cfg;
      const depth = Math.min((fallSpeed - c.landingDipMinSpeed) * c.landingDipScale, c.maxLandingDip);
      // A critically damped spring kicked with velocity v peaks at v / (omega * e).
      if (depth > 0) this.dipVel -= depth * DIP_OMEGA * Math.E;
    });
  }

  onDetach(): void {
    this.unsub?.();
  }

  update(time: FrameTime): void {
    const c = this.ctrl.cfg;
    const dt = Math.min(time.delta, 0.1);
    const cam = this.game.renderer.camera;

    // Look
    const look = this.game.input.consumeLook();
    this.ctrl.yaw += look.yaw;
    const lim = c.pitchLimitDeg * DEG;
    this.ctrl.pitch = THREE.MathUtils.clamp(this.ctrl.pitch + look.pitch, -lim, lim);

    // Eye height (smooth crouch)
    const targetEye = this.ctrl.crouched ? c.crouchEyeHeight : c.standEyeHeight;
    const k = 1 - Math.exp(-dt / Math.max(0.001, c.crouchTransitionTime / 3));
    this.eyeHeight += (targetEye - this.eyeHeight) * k;

    // Head bob scaled by ground speed
    const speed = this.ctrl.grounded ? this.ctrl.horizontalSpeed : 0;
    const bobTarget = Math.min(speed / c.walkSpeed, 1.6);
    this.bobAmount += (bobTarget - this.bobAmount) * (1 - Math.exp(-dt * 10));
    this.bobPhase += dt * speed * c.headBobFrequency;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * c.headBobAmplitude * this.bobAmount;
    const bobX = Math.cos(this.bobPhase) * c.headBobAmplitude * 0.5 * this.bobAmount;

    // Landing dip: critically-damped spring back to 0
    // (sub-stepped so a long frame can't make the spring explode)
    const stiffness = DIP_OMEGA * DIP_OMEGA;
    const damping = 2 * DIP_OMEGA;
    for (let remaining = dt; remaining > 0; remaining -= 1 / 240) {
      const h = Math.min(remaining, 1 / 240);
      this.dipVel += (-stiffness * this.dip - damping * this.dipVel) * h;
      this.dip += this.dipVel * h;
    }

    // Pose
    const feet = this.entity.object3d.position; // interpolated
    _euler.set(this.ctrl.pitch + this.dip * c.landingDipPitch, this.ctrl.yaw, 0);
    cam.quaternion.setFromEuler(_euler);
    cam.position.set(feet.x, feet.y + this.eyeHeight + bobY + this.dip, feet.z);
    // Side bob in camera-right direction
    cam.position.x += Math.cos(this.ctrl.yaw) * bobX;
    cam.position.z -= Math.sin(this.ctrl.yaw) * bobX;

    // Sprint FOV kick
    const targetFov = (c.fovDeg + (this.ctrl.sprinting && speed > c.walkSpeed ? c.sprintFovBoostDeg : 0)) * this.ctrl.fovScale;
    if (Math.abs(cam.fov - targetFov) > 0.01) {
      cam.fov += (targetFov - cam.fov) * (1 - Math.exp(-dt * 12));
      cam.updateProjectionMatrix();
    }

    this.game.renderer.followShadows(feet);
  }
}
