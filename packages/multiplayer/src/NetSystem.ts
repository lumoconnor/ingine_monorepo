import * as THREE from 'three';
import type { Game } from '@ingine/engine/core/Game';
import type { System } from '@ingine/engine/core/System';
import type { FrameTime } from '@ingine/engine/core/Time';
import type { Entity } from '@ingine/engine/entities/Entity';
import { PlayerController } from '@ingine/engine/gameplay/player/PlayerController';
import {
  allPickups,
  collectPickup,
  findPickup,
  ItemPickup,
  setPickupAuthority,
  spawnPickup,
  type PickupAuthority,
  type PickupSpec,
} from '@ingine/engine/inventory/pickups';
import { itemLabel } from '@ingine/engine/inventory/catalog';
import type { PeerInfo, Room } from '@ingine/net/Room';
import { RemoteAvatar, type PoseSample } from './RemoteAvatar';
import './events';

/** Poses sent per second. Avatars are interpolated between them. */
const POSE_RATE = 20;

/**
 * Plays an engine game inside an @ingine/net room.
 *
 * - Movement: each player moves themselves and sends their pose 20 times a
 *   second; everyone else draws them interpolated 100 ms behind. (Trusting
 *   clients with their own position is fine for co-op among friends.)
 * - Shared world: the host decides who gets each pickup, so two players
 *   can't take the same mug, and places every dropped item. Players who
 *   join late get the host's current list of items lying around.
 *
 * Add it before `game.init()`, then `attach(room)` once connected.
 */
export class NetSystem implements System, PickupAuthority {
  readonly name = 'net';
  private game!: Game;
  room: Room | null = null;
  private avatars = new Map<string, RemoteAvatar>();
  private sendTimer = 0;
  private nextDropId = 1;
  private unsub: (() => void)[] = [];
  /** Messages handled, by channel (for checks and the debug readout). */
  readonly stats = { posesIn: 0, posesOut: 0 };

  init(game: Game): void {
    this.game = game;
  }

  /** Start playing in a room. */
  attach(room: Room): void {
    this.detach();
    this.room = room;
    const g = this.game;
    setPickupAuthority(g, this);

    for (const peer of room.peers.values()) this.addAvatar(peer);
    this.unsub.push(
      room.onEvent('peer-joined', (p) => {
        this.addAvatar(p!);
        g.events.emit('net:peer-joined', { id: p!.id, name: p!.name });
        g.events.emit('notify', { text: `${p!.name} joined` });
      }),
      room.onEvent('peer-left', (p) => {
        this.removeAvatar(p!.id);
        g.events.emit('net:peer-left', { id: p!.id, name: p!.name });
        g.events.emit('notify', { text: `${p!.name} left` });
      }),
      room.onEvent('closed', () => {
        g.events.emit('net:closed', { reason: room.isHost ? 'You closed the room.' : 'The host left, so the room has closed.' });
        this.detach();
      }),
      room.on('pose', (s: PoseSample, from) => {
        this.stats.posesIn++;
        this.avatars.get(from.id)?.push(s, now());
      }),
      // Host: the requests.
      room.on('take', (m: { id: string }, from) => room.isHost && this.hostTake(m.id, from)),
      room.on('drop', (m: { spec: PickupSpec }, from) => room.isHost && this.hostDrop(m.spec, from)),
      room.on('sync', (_m, from) => room.isHost && room.send(from.id, 'world', { pickups: this.pickupSpecs() })),
      // Everyone: the host's decisions.
      room.on('world', (m: { pickups: PickupSpec[] }) => !room.isHost && this.loadWorld(m.pickups)),
      room.on('taken', (m: { id: string; by: string }) => this.onTaken(m.id, m.by)),
      room.on('spawned', (m: { spec: PickupSpec }) => !room.isHost && spawnPickup(g, m.spec)),
      room.on('denied', () => g.events.emit('notify', { text: 'Someone got there first' })),
    );
    // Ask the host for the world as it is now (items already taken or dropped).
    if (!room.isHost) room.send('host', 'sync', {});
    g.events.emit('net:attached', { code: room.code, host: room.isHost });
  }

  detach(): void {
    for (const u of this.unsub) u();
    this.unsub = [];
    for (const id of [...this.avatars.keys()]) this.removeAvatar(id);
    if (this.game) setPickupAuthority(this.game, null);
    this.room = null;
  }

  avatar(id: string): RemoteAvatar | undefined {
    return this.avatars.get(id);
  }

  avatarList(): RemoteAvatar[] {
    return [...this.avatars.values()];
  }

  /** Where a player's voice comes from: their avatar's head. */
  speakerPosition(id: string, out: THREE.Vector3): boolean {
    const a = this.avatars.get(id);
    if (!a) return false;
    out.copy(a.headWorld);
    return true;
  }

  // Runs every frame, even while the local game is paused (inventory open),
  // so other players keep moving.
  update(time: FrameTime): void {
    const room = this.room;
    if (!room) return;
    const t = now();
    for (const a of this.avatars.values()) a.update(t, time.delta);

    this.sendTimer += time.delta;
    if (this.sendTimer < 1 / POSE_RATE) return;
    this.sendTimer %= 1 / POSE_RATE;
    if (!room.peers.size) return;
    const player = this.game.world.find('player');
    const ctrl = player?.get(PlayerController);
    if (!player || !ctrl) return;
    const p = player.object3d.position;
    const pose: PoseSample = {
      t,
      p: [round(p.x), round(p.y), round(p.z)],
      yaw: round(ctrl.yaw),
      pitch: round(ctrl.pitch),
      crouch: ctrl.crouched,
    };
    room.send('all', 'pose', pose, { fast: true });
    this.stats.posesOut++;
  }

  // --- Pickups (PickupAuthority) ----------------------------------------------

  requestTake(_e: Entity, spec: PickupSpec): void {
    if (spec.id) this.room?.send('host', 'take', { id: spec.id });
  }

  requestDrop(spec: PickupSpec): void {
    if (!this.room) return void spawnPickup(this.game, spec);
    this.room.send('host', 'drop', { spec });
  }

  private hostTake(id: string, by: PeerInfo): void {
    const room = this.room!;
    if (!findPickup(this.game, id)) return room.send(by.id, 'denied', { id });
    room.send('all', 'taken', { id, by: by.id });
    this.onTaken(id, by.id);
  }

  private hostDrop(spec: PickupSpec, by: PeerInfo): void {
    const room = this.room!;
    const placed: PickupSpec = { ...spec, id: `drop-${room.self.id.slice(-4)}-${this.nextDropId++}` };
    spawnPickup(this.game, placed);
    room.send('all', 'spawned', { spec: placed, by: by.id });
  }

  /** Someone was given a pickup: it goes in their bag if it's us, and disappears for everyone. */
  private onTaken(id: string, by: string): void {
    const g = this.game;
    const room = this.room;
    if (!room) return;
    const e = findPickup(g, id);
    if (by === room.self.id) {
      if (e) collectPickup(g, e);
      return;
    }
    if (!e) return;
    const spec = e.get(ItemPickup)!.spec;
    g.world.destroy(e);
    const who = room.peers.get(by)?.name ?? 'Someone';
    g.events.emit('notify', { text: `${who} picked up ${itemLabel(spec.item, spec.count ?? 1)}` });
  }

  private pickupSpecs(): PickupSpec[] {
    return allPickups(this.game).map((e) => e.get(ItemPickup)!.spec);
  }

  /** A late joiner replaces their freshly loaded items with what's really lying around. */
  private loadWorld(specs: PickupSpec[]): void {
    for (const e of allPickups(this.game)) this.game.world.destroy(e);
    for (const s of specs) spawnPickup(this.game, s);
  }

  private addAvatar(peer: PeerInfo): void {
    if (this.avatars.has(peer.id)) return;
    const a = new RemoteAvatar(peer.id, peer.name);
    this.avatars.set(peer.id, a);
    this.game.world.spawn(a.entity);
  }

  private removeAvatar(id: string): void {
    const a = this.avatars.get(id);
    if (!a) return;
    this.avatars.delete(id);
    this.game.world.destroy(a.entity);
  }

  dispose(): void {
    this.room?.leave();
    this.detach();
  }
}

const now = () => performance.now() / 1000;
const round = (v: number) => Math.round(v * 1000) / 1000;
