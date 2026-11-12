import * as THREE from 'three';
import { Component } from '../../entities/Component';
import type { Entity } from '../../entities/Entity';
import type { FrameTime } from '../../core/Time';
import type { Speaker } from '../../dialogue/DialogueSystem';

/** Turn speed toward / back from the player (1/s, exponential). */
const TURN_RATE = 6;
/** Notices the player within this range and turns its head. */
const NOTICE_RANGE = 6;

const _p = new THREE.Vector3();

/**
 * A character you can talk to. Holds which dialogue tree it uses and turns
 * to face the player while talking (and glances at them when they're near).
 */
export class Npc extends Component implements Speaker {
  /** Words dialogue can use as `{npc.key}` (generic villagers: their name, their village). */
  vars: Record<string, string> = {};
  /** Name tag, shown only within `tagRange` metres. */
  tag: THREE.Object3D | null = null;
  tagRange = Infinity;
  private talkingTo: Entity | null = null;
  private bodyYaw: number;
  private headYaw = 0;

  constructor(
    readonly id: string,
    readonly displayName: string,
    readonly dialogue: string,
    /** The rotating visual (body), child of the entity's object. */
    private body: THREE.Object3D,
    private head: THREE.Object3D,
    private homeYaw: number,
    private eyeHeight = 1.62,
  ) {
    super();
    this.bodyYaw = homeYaw;
  }

  get talking(): boolean {
    return this.talkingTo !== null;
  }

  focusPoint(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.entity.object3d.position).setY(this.entity.object3d.position.y + this.eyeHeight);
  }

  /** The way they face when not talking (walkers turn as they go). */
  face(yaw: number): void {
    this.homeYaw = yaw;
  }

  setTalking(withEntity: Entity | null): void {
    this.talkingTo = withEntity;
  }

  update(time: FrameTime): void {
    const dt = Math.min(time.delta, 0.1);
    const k = 1 - Math.exp(-dt * TURN_RATE);
    const me = this.entity.object3d.position;
    const player = this.talkingTo ?? this.game.world.find('player') ?? null;
    let toPlayer: number | null = null;
    if (player) {
      _p.copy(player.object3d.position).sub(me);
      if (this.tag) this.tag.visible = this.talking || _p.length() < this.tagRange;
      // Yaw convention matches Object3D.rotation.y: 0 faces +Z.
      if (Math.hypot(_p.x, _p.z) < NOTICE_RANGE) toPlayer = Math.atan2(_p.x, _p.z);
    }

    // Body turns fully only while talking; otherwise just the head follows (±70°).
    const bodyTarget = this.talking && toPlayer !== null ? toPlayer : this.homeYaw;
    this.bodyYaw += wrap(bodyTarget - this.bodyYaw) * k;
    this.body.rotation.y = this.bodyYaw;

    let headTarget = 0;
    if (toPlayer !== null) {
      const rel = wrap(toPlayer - this.bodyYaw);
      if (Math.abs(rel) < 1.9) headTarget = THREE.MathUtils.clamp(rel, -1.2, 1.2);
    }
    this.headYaw += (headTarget - this.headYaw) * k;
    this.head.rotation.y = this.headYaw;
  }
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
