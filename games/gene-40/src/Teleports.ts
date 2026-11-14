import * as THREE from 'three';
import type { Game } from '@ingine/engine/core/Game';
import type { System } from '@ingine/engine/core/System';
import { PlayerController } from '@ingine/engine/gameplay/player/PlayerController';
import { HUB, sceneAt, sceneById, type Vec3 } from './scenes';

declare module '@ingine/engine/core/EventBus' {
  interface GameEvents {
    /** The player just teleported into a scene. */
    teleport: { scene: string };
  }
}

export interface Pad {
  /** Centre of the pad's top surface. */
  position: Vec3;
  radius: number;
  /** Where you land (feet) and which way you face. */
  to: Vec3;
  toYaw: number;
  /** The scene you arrive in (for the welcome message). */
  sceneId: string;
}

/**
 * Teleport pads: step onto one and you're moved to its destination with a
 * quick flash. You land beside the destination's return pad, never on it, and
 * a pad only fires once you've stepped onto it from off it, so nobody
 * ping-pongs. H goes back to the hub from anywhere.
 */
export class Teleports implements System {
  readonly name = 'teleports';
  private game!: Game;
  /** Public for the checks. */
  readonly pads: Pad[] = [];
  /** The pad the player is standing on, so it fires once per step-on. */
  private standingOn: Pad | null = null;
  private hubArrival: { to: Vec3; yaw: number } = { to: [0, 0.05, 10], yaw: 0 };
  private flash!: HTMLDivElement;
  private hubRequested = false;
  /** Fixed steps seen, for the checks. */
  ticks = 0;
  /** Times teleported, for the checks. */
  count = 0;
  /** Id of the scene the player is in now. */
  current = HUB.id;

  constructor(private container: HTMLElement) {}

  init(game: Game): void {
    this.game = game;
    // H: back to the plaza. A raw key rather than an engine action, since the
    // engine's binding table is closed (augmenting ActionMap breaks its defaults).
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyH' || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      this.hubRequested = true;
    });
    this.flash = document.createElement('div');
    Object.assign(this.flash.style, {
      position: 'absolute',
      inset: '0',
      background: '#fff8e6',
      opacity: '0',
      pointerEvents: 'none',
      transition: 'opacity 0.45s ease-out',
      zIndex: '5',
    });
    this.container.appendChild(this.flash);
  }

  add(pad: Pad): Pad {
    this.pads.push(pad);
    return pad;
  }

  /** Where H (and the hub's arrival) puts you. */
  setHubArrival(to: Vec3, yaw: number): void {
    this.hubArrival = { to, yaw };
  }

  private player(): PlayerController | undefined {
    return this.game.world.find('player')?.get(PlayerController);
  }

  /** Move the player (feet position) and announce the scene. */
  go(to: Vec3, yaw: number, sceneId?: string): void {
    const ctrl = this.player();
    if (!ctrl) return;
    ctrl.placeAt(new THREE.Vector3(...to), yaw, 0);
    // Respawning (Backspace, falling off) brings you back to where you last arrived.
    ctrl.spawnPoint.set(...to);
    ctrl.spawnYaw = yaw;
    this.count++;
    const scene = sceneById(sceneId ?? '') ?? sceneAt(to[0], to[2]);
    this.current = scene.id;
    this.game.events.emit('notify', { text: scene.built || scene === HUB ? `Welcome to ${scene.name}` : `${scene.name}: coming soon!` });
    this.game.events.emit('teleport', { scene: scene.id });
    // Flash: snap to bright, then fade.
    this.flash.style.transition = 'none';
    this.flash.style.opacity = '0.85';
    void this.flash.offsetWidth;
    this.flash.style.transition = 'opacity 0.45s ease-out';
    this.flash.style.opacity = '0';
  }

  goHub(): void {
    this.go(this.hubArrival.to, this.hubArrival.yaw, HUB.id);
  }

  preFixedUpdate(): void {
    this.ticks++;
    const ctrl = this.player();
    if (!ctrl) return;
    const wantHub = this.hubRequested;
    this.hubRequested = false;
    if (wantHub && !this.game.input.gameplayBlocked) {
      this.goHub();
      this.standingOn = null;
      return;
    }
    const on = this.padUnder(ctrl.entity.object3d.position) ?? null;
    // You always land beside a pad, so after a teleport nothing is under you.
    if (on && on !== this.standingOn) this.go(on.to, on.toYaw, on.sceneId);
    else this.standingOn = on;
  }

  private padUnder(feet: THREE.Vector3): Pad | undefined {
    return this.pads.find(
      (p) => Math.hypot(feet.x - p.position[0], feet.z - p.position[2]) < p.radius && Math.abs(feet.y - p.position[1]) < 0.6,
    );
  }
}
