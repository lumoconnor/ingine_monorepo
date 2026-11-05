import * as THREE from 'three';
import type { Game } from '@/core/Game';
import type { System } from '@/core/System';
import type { FrameTime } from '@/core/Time';
import type { Entity } from '@/entities/Entity';
import { PlayerController } from '@/gameplay/player/PlayerController';
import type { Choice, DialogueTree } from './types';
import { runAll, seenFlag, testAll, visitedFlag, type Context } from './registry';
import { validateTree } from './validate';

/** Anything with a talkable head: the dialogue frames the camera on it. */
export interface Speaker {
  /** World-space point to look at (roughly the eyes). */
  focusPoint(out: THREE.Vector3): THREE.Vector3;
  setTalking?(withEntity: Entity | null): void;
}

interface Active {
  tree: DialogueTree;
  npc: Entity;
  speaker: Speaker;
  node: string;
  /** Choices on screen, with their index in the node's list (for "seen"). */
  choices: { choice: Choice; index: number }[];
  ctx: Context;
}

/** How far the player may drift from the NPC before the conversation drops. */
const MAX_TALK_DISTANCE = 4;
/** Camera turn rate when framing the speaker (1/s, exponential). */
const FRAME_RATE = 7;

const _focus = new THREE.Vector3();
const _eye = new THREE.Vector3();

/**
 * Runs conversations. Content is data (see types.ts); this system walks the
 * tree, evaluates conditions, runs effects and reports each line on the
 * EventBus. It has no UI of its own: DialogueUi listens to the events and
 * calls `choose()`.
 *
 * Bookkeeping lives in WorldState as flags, so it saves with everything else:
 *   dialogue.visited.<tree>.<node>      node has been shown
 *   dialogue.seen.<tree>.<node>.<i>     choice i has been picked
 */
export class DialogueSystem implements System {
  readonly name = 'dialogue';
  private game!: Game;
  private trees = new Map<string, DialogueTree>();
  private active: Active | null = null;

  constructor(trees: DialogueTree[] = []) {
    trees.forEach((t) => this.register(t));
  }

  /** Validates and adds a tree. Throws with every problem listed. */
  register(tree: DialogueTree): void {
    validateTree(tree);
    if (this.trees.has(tree.id)) throw new Error(`Duplicate dialogue id "${tree.id}"`);
    this.trees.set(tree.id, tree);
  }

  has(id: string): boolean {
    return this.trees.has(id);
  }

  init(game: Game): void {
    this.game = game;
    game.events.on('input:pointerlock', ({ locked }) => {
      if (!locked) this.end();
    });
  }

  get isActive(): boolean {
    return this.active !== null;
  }

  /** Current node id (for tests and debugging). */
  get currentNode(): string | null {
    return this.active?.node ?? null;
  }

  start(treeId: string, npc: Entity, speaker: Speaker): boolean {
    if (this.active || this.game.paused) return false;
    const tree = this.trees.get(treeId);
    if (!tree) {
      console.warn(`No dialogue "${treeId}"`);
      return false;
    }
    const ctx: Context = { game: this.game, tree: tree.id };
    const node =
      typeof tree.start === 'string' ? tree.start : tree.start.find((r) => testAll(ctx, r.if))?.node;
    if (!node) return false;

    this.active = { tree, npc, speaker, node, choices: [], ctx };
    this.game.input.gameplayBlocked = true;
    const player = this.game.world.find('player') ?? null;
    speaker.setTalking?.(player);
    this.game.events.emit('dialogue:start', { npc: npc.name, speaker: tree.speaker });
    this.enter(node);
    return true;
  }

  /** Pick one of the choices currently on screen (0-based). */
  choose(i: number): void {
    const a = this.active;
    if (!a) return;
    const picked = a.choices[i];
    if (!picked) return;
    const { choice, index } = picked;
    // Auto choices (Continue / Leave) have index -1 and aren't tracked.
    if (index >= 0) this.game.state.setFlag(seenFlag(a.tree.id, a.node, index));
    runAll(a.ctx, choice.do);
    if (!this.active) return; // an effect may end the conversation
    if (typeof choice.next === 'string') this.enter(choice.next);
    else this.end();
  }

  end(): void {
    const a = this.active;
    if (!a) return;
    this.active = null;
    this.game.input.gameplayBlocked = false;
    // The key that picked "Leave" mustn't also reach gameplay (E would re-open the chat).
    this.game.input.clearPressed();
    a.speaker.setTalking?.(null);
    this.game.events.emit('dialogue:end', { npc: a.npc.name });
  }

  update(time: FrameTime): void {
    const a = this.active;
    if (!a) return;
    const player = this.game.world.find('player');
    const ctrl = player?.get(PlayerController);
    if (!player || !ctrl) return this.end();

    a.speaker.focusPoint(_focus);
    const cam = this.game.renderer.camera;
    cam.getWorldPosition(_eye);
    if (Math.hypot(_focus.x - _eye.x, _focus.z - _eye.z) > MAX_TALK_DISTANCE) return this.end();

    // Ease the view onto the speaker's face.
    const dx = _focus.x - _eye.x, dy = _focus.y - _eye.y, dz = _focus.z - _eye.z;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, Math.hypot(dx, dz));
    const k = 1 - Math.exp(-Math.min(time.delta, 0.1) * FRAME_RATE);
    let dyaw = yaw - ctrl.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    ctrl.yaw += dyaw * k;
    ctrl.pitch += (pitch - ctrl.pitch) * k;
  }

  private enter(id: string): void {
    const a = this.active!;
    const node = a.tree.nodes[id];
    a.node = id;
    runAll(a.ctx, node.do);
    if (!this.active) return;
    this.game.state.setFlag(visitedFlag(a.tree.id, id));

    if (node.choices) {
      a.choices = node.choices
        .map((choice, index) => ({ choice, index }))
        .filter(({ choice }) => testAll(a.ctx, choice.if));
    } else {
      a.choices = [];
    }
    if (a.choices.length === 0) {
      a.choices = [
        typeof node.next === 'string'
          ? { choice: { text: 'Continue', next: node.next }, index: -1 }
          : { choice: { text: 'Leave', next: null }, index: -1 },
      ];
    }

    this.game.events.emit('dialogue:line', {
      speaker: node.speaker ?? a.tree.speaker,
      text: this.format(node.text),
      choices: a.choices.map(({ choice, index }) => ({
        text: this.format(choice.text),
        // Grey out options already explored; leaving is never "seen".
        seen: index >= 0 && typeof choice.next === 'string' && this.game.state.hasFlag(seenFlag(a.tree.id, id, index)),
      })),
    });
  }

  /** `{var.name}` and `{item.id}` are replaced from WorldState. */
  private format(text: string): string {
    return text.replace(/\{(var|item)\.([\w.-]+)\}/g, (_, kind: string, key: string) =>
      kind === 'var' ? String(this.game.state.getVar(key) ?? '') : String(this.game.state.itemCount(key)),
    );
  }
}
