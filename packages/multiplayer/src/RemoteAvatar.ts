import * as THREE from 'three';
import { Entity } from '@ingine/engine/entities/Entity';
import { makeLabel } from '@ingine/engine/render/labels';
import { PlayerConfig } from '@ingine/engine/config/player';

/** One pose as another player sent it. */
export interface PoseSample {
  /** Sender's clock, seconds. */
  t: number;
  /** Feet position. */
  p: [number, number, number];
  yaw: number;
  pitch: number;
  crouch: boolean;
}

/** How far behind the newest pose avatars are drawn, so there are two samples to blend between. */
export const INTERP_DELAY = 0.1;

/** Bright, distinct colours; a player's colour comes from their id. */
const COLOURS = [0x4f9dff, 0xff7a59, 0x58c27d, 0xc77dff, 0xffc43d, 0x2ec4b6, 0xff5c8a, 0x9bc53d];
export function colourFor(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLOURS[h % COLOURS.length];
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/**
 * Another player as you see them: a capsule body, a head that turns and
 * tilts with their view, and their name above. Purely visual (no collider):
 * players walk through each other for now.
 */
export class RemoteAvatar {
  readonly entity: Entity;
  private head = new THREE.Group();
  private body: THREE.Mesh;
  private label: THREE.Sprite;
  private ring: THREE.Mesh;
  private samples: PoseSample[] = [];
  /** Sender clock minus our clock, smoothed, so their timestamps line up with ours. */
  private offset: number | null = null;
  private crouchBlend = 0;
  /** Where the voice comes from (world space), updated every frame. */
  readonly headWorld = new THREE.Vector3();
  speaking = 0;

  constructor(
    readonly id: string,
    readonly name: string,
  ) {
    const colour = colourFor(id);
    const root = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1f27, roughness: 0.3, metalness: 0.2 });

    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.85, 6, 14), skin);
    this.body.position.y = 0.28 + 0.85 / 2;
    this.body.castShadow = true;

    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 14), skin);
    skull.castShadow = true;
    // A visor shows which way they're looking (-Z is forward).
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.1), dark);
    visor.position.set(0, 0.02, -0.16);
    this.head.add(skull, visor);
    this.head.position.y = PlayerConfig.standEyeHeight;

    this.label = makeLabel(name, { scale: 0.75 });
    this.label.position.y = PlayerConfig.standHeight + 0.45;

    // Lights up while they talk.
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.16, 0.025, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0x7dff9b, transparent: true, opacity: 0 }),
    );
    this.ring.position.y = PlayerConfig.standHeight + 0.75;
    this.ring.rotation.x = Math.PI / 2; // lie flat, like a halo

    root.add(this.body, this.head, this.label, this.ring);
    this.entity = new Entity(`avatar:${id}`, root);
    this.entity.tags.add('remote-player');
  }

  push(s: PoseSample, now: number): void {
    // The fastest delivery seen is the best guess at the clock difference: a
    // late packet only means it was slow. Drift slowly back down so a
    // changing clock or route is followed too.
    const off = s.t - now;
    if (this.offset === null || off > this.offset) this.offset = off;
    else this.offset += (off - this.offset) * 0.002;
    const last = this.samples.at(-1);
    if (last && s.t <= last.t) return; // out of order (fast channel is unordered)
    this.samples.push(s);
    if (this.samples.length > 30) this.samples.shift();
    if (this.samples.length === 1) this.apply(s, s, 0, 1);
  }

  /** Draw them where they were INTERP_DELAY ago, blending between the two samples around that time. */
  update(now: number, dt: number): void {
    if (!this.samples.length || this.offset === null) return;
    const t = now + this.offset - INTERP_DELAY;
    let i = this.samples.findIndex((s) => s.t > t);
    if (i === -1) i = this.samples.length; // past the newest: hold it
    const a = this.samples[Math.max(0, i - 1)];
    const b = this.samples[Math.min(this.samples.length - 1, i)];
    const k = b.t > a.t ? THREE.MathUtils.clamp((t - a.t) / (b.t - a.t), 0, 1) : 1;
    this.apply(a, b, k, dt);
    if (i > 2) this.samples.splice(0, i - 2);

    const ringMat = this.ring.material as THREE.MeshBasicMaterial;
    ringMat.opacity += ((this.speaking > 0 ? 0.9 : 0) - ringMat.opacity) * Math.min(1, dt * 12);
    this.ring.scale.setScalar(1 + this.speaking * 0.6);
  }

  private apply(a: PoseSample, b: PoseSample, k: number, dt: number): void {
    const root = this.entity.object3d;
    root.position.lerpVectors(_a.fromArray(a.p), _b.fromArray(b.p), k);
    // Shortest way round for the yaw.
    let dy = b.yaw - a.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    root.rotation.y = a.yaw + dy * k;
    this.head.rotation.x = THREE.MathUtils.lerp(a.pitch, b.pitch, k);

    const c = PlayerConfig;
    this.crouchBlend += ((b.crouch ? 1 : 0) - this.crouchBlend) * Math.min(1, dt * 10);
    const height = THREE.MathUtils.lerp(c.standHeight, c.crouchHeight, this.crouchBlend);
    const eye = THREE.MathUtils.lerp(c.standEyeHeight, c.crouchEyeHeight, this.crouchBlend);
    this.body.scale.y = height / c.standHeight;
    this.body.position.y = (0.28 + 0.85 / 2) * this.body.scale.y;
    this.head.position.y = eye;
    this.label.position.y = height + 0.45;
    this.ring.position.y = height + 0.75;
    root.updateMatrixWorld();
    this.head.getWorldPosition(this.headWorld);
  }
}
