import { Peer, type DataConnection, type MediaConnection, type PeerJSOption } from 'peerjs';

export type { MediaConnection };
import { makeRoomCode, normaliseRoomCode } from './codes';

/**
 * A room: one browser hosts, the others join with a short code. There is no
 * game server. A public signalling broker introduces the browsers, and after
 * that everything goes directly between them over WebRTC.
 *
 * Data uses a star: every client connects only to the host, and the host
 * relays messages addressed to other players. Media (voice) can go directly
 * between any two players with `call`.
 *
 * This module knows nothing about the engine. It moves JSON messages and
 * media streams between named players.
 */

/** Where the signalling broker is. Leave out to use the free PeerJS cloud broker. */
export interface SignallingConfig {
  host: string;
  port: number;
  path?: string;
  secure?: boolean;
}

export interface RoomOptions {
  /** Prefixes broker ids so different games never meet in the same room. Letters, digits and dashes. */
  appId: string;
  /** This player's display name. */
  name: string;
  signalling?: SignallingConfig;
  /** STUN/TURN servers. Defaults to the broker's (public STUN). */
  iceServers?: RTCIceServer[];
  /** Give up joining after this many ms. */
  timeoutMs?: number;
}

export interface PeerInfo {
  id: string;
  name: string;
  isHost: boolean;
}

/** Who a message goes to: everyone else, the host, or one player by id. */
export type Target = 'all' | 'host' | string;

export interface SendOptions {
  /**
   * Unordered delivery for frequent updates (positions), so one late packet
   * doesn't hold up the newer ones behind it.
   */
  fast?: boolean;
}

type Handler = (data: any, from: PeerInfo) => void;

/** What travels over the data channels. */
type Wire =
  | { k: 'hello'; name: string }
  | { k: 'welcome'; you: string; host: PeerInfo; peers: PeerInfo[] }
  | { k: 'joined'; peer: PeerInfo }
  | { k: 'left'; id: string }
  | { k: 'msg'; ch: string; to: Target; from?: string; d: unknown }
  | { k: 'ping' };

/** Keep-alive interval, and how long without hearing from someone before they count as gone. */
const PING_MS = 2000;
const SILENCE_MS = 20000;

export type RoomEvent = 'peer-joined' | 'peer-left' | 'closed';

export class RoomError extends Error {
  constructor(
    readonly reason: 'no-room' | 'code-taken' | 'broker' | 'timeout' | 'network',
    message: string,
  ) {
    super(message);
  }
}

const peerOptions = (o: RoomOptions): PeerJSOption => ({
  ...(o.signalling ?? {}),
  ...(o.iceServers ? { config: { iceServers: o.iceServers } } : {}),
  debug: 1,
});

const brokerId = (appId: string, code: string) => `${appId}-room-${code}`;

export class Room {
  /** Other players (not including you), by id. */
  readonly peers = new Map<string, PeerInfo>();
  readonly self: PeerInfo;
  private handlers = new Map<string, Set<Handler>>();
  private listeners = new Map<RoomEvent, Set<(peer: PeerInfo | null) => void>>();
  private callHandlers = new Set<(call: MediaConnection, from: PeerInfo) => void>();
  /** Host: one reliable and one fast connection per client. Client: the two to the host. */
  private links = new Map<string, { reliable?: DataConnection; fast?: DataConnection }>();
  private closed = false;
  /** When we last heard anything from each connection (host: per client; client: the host). */
  private lastSeen = new Map<string, number>();
  private pinger: ReturnType<typeof setInterval>;

  private constructor(
    private peer: Peer,
    readonly code: string,
    self: PeerInfo,
    private hostInfo: PeerInfo,
  ) {
    this.self = self;
    peer.on('call', (call) => {
      const from = this.peers.get(call.peer);
      if (!from) return call.close();
      for (const h of this.callHandlers) h(call, from);
    });
    peer.on('disconnected', () => {
      // Lost the broker. Existing connections keep working; reconnect so new players can still join.
      if (!this.closed && !peer.destroyed) peer.reconnect();
    });
    // A closed tab or a dropped connection doesn't always close the WebRTC
    // channel promptly, so everyone pings and silence counts as leaving.
    this.pinger = setInterval(() => this.heartbeat(), PING_MS);
    // Leave cleanly when the tab closes, so the others find out at once.
    window.addEventListener('pagehide', this.onPageHide);
  }

  private onPageHide = (): void => this.close();

  private heartbeat(): void {
    const now = Date.now();
    for (const [id, link] of this.links) {
      put(link.reliable, { k: 'ping' } satisfies Wire);
      const seen = this.lastSeen.get(id);
      if (seen !== undefined && now - seen > SILENCE_MS) {
        if (this.isHost) this.dropClient(id);
        else this.close();
      }
    }
  }

  private heard(id: string): void {
    this.lastSeen.set(id, Date.now());
  }

  get isHost(): boolean {
    return this.self.isHost;
  }

  get host(): PeerInfo {
    return this.hostInfo;
  }

  /** Everyone in the room, you included, host first. */
  everyone(): PeerInfo[] {
    const all = [this.self, ...this.peers.values()];
    return all.sort((a, b) => Number(b.isHost) - Number(a.isHost));
  }

  // --- Creating and joining ------------------------------------------------

  /** Opens a new room and waits for players. Resolves once the broker has registered the code. */
  static async host(opts: RoomOptions): Promise<Room> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = makeRoomCode();
      try {
        const peer = await openPeer(brokerId(opts.appId, code), opts);
        const self: PeerInfo = { id: peer.id, name: opts.name, isHost: true };
        const room = new Room(peer, code, self, self);
        peer.on('connection', (conn) => room.acceptClient(conn));
        return room;
      } catch (e) {
        if (e instanceof RoomError && e.reason === 'code-taken') continue;
        throw e;
      }
    }
    throw new RoomError('code-taken', 'Could not find a free room code. Try again.');
  }

  /** Joins a room by its code. Resolves once the host has welcomed you. */
  static async join(rawCode: string, opts: RoomOptions): Promise<Room> {
    const code = normaliseRoomCode(rawCode);
    const peer = await openPeer(undefined, opts);
    const hostId = brokerId(opts.appId, code);
    const timeout = opts.timeoutMs ?? 15000;
    try {
      return await new Promise<Room>((resolve, reject) => {
        const fail = (err: RoomError) => {
          clearTimeout(timer);
          reject(err);
        };
        const timer = setTimeout(() => fail(new RoomError('timeout', `Couldn't reach room ${code}. Check the code, or the host's connection.`)), timeout);
        peer.on('error', (err: Error & { type?: string }) => {
          if (err.type === 'peer-unavailable') fail(new RoomError('no-room', `There's no room ${code}. Check the code.`));
          else fail(new RoomError('network', err.message));
        });
        const reliable = peer.connect(hostId, { label: 'reliable', reliable: true, serialization: 'json' });
        const fast = peer.connect(hostId, { label: 'fast', reliable: false, serialization: 'json' });
        reliable.on('open', () => reliable.send({ k: 'hello', name: opts.name } satisfies Wire));
        reliable.on('error', (err) => fail(new RoomError('network', err.message)));
        reliable.on('data', (raw) => {
          const w = raw as Wire;
          if (w.k !== 'welcome') return;
          clearTimeout(timer);
          const self: PeerInfo = { id: w.you, name: opts.name, isHost: false };
          const room = new Room(peer, code, self, w.host);
          room.peers.set(w.host.id, w.host);
          for (const p of w.peers) if (p.id !== self.id) room.peers.set(p.id, p);
          room.links.set(w.host.id, { reliable, fast });
          room.heard(w.host.id);
          room.wireClient(reliable);
          room.wireClient(fast);
          reliable.on('close', () => room.close());
          resolve(room);
        });
      });
    } catch (e) {
      peer.destroy();
      throw e;
    }
  }

  // --- Messages --------------------------------------------------------------

  /** Listen for messages on a channel. Returns an unsubscribe function. */
  on(channel: string, handler: Handler): () => void {
    let set = this.handlers.get(channel);
    if (!set) this.handlers.set(channel, (set = new Set()));
    set.add(handler);
    return () => set!.delete(handler);
  }

  /** Room-level events: someone joined or left, or the room closed (host gone). */
  onEvent(type: RoomEvent, fn: (peer: PeerInfo | null) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  /**
   * Send a JSON-serialisable message. A message to 'host' sent by the host
   * (or to your own id) is delivered locally, so game code can treat the host
   * like any other player.
   */
  send(to: Target, channel: string, data: unknown, opts: SendOptions = {}): void {
    if (this.closed) return;
    const self = this.self.id;
    if (to === self || (to === 'host' && this.isHost)) {
      this.deliver(channel, data, self);
      return;
    }
    const kind = opts.fast ? 'fast' : 'reliable';
    if (this.isHost) {
      const msg: Wire = { k: 'msg', ch: channel, to, from: self, d: data };
      if (to === 'all') for (const link of this.links.values()) put(link[kind], msg);
      else put(this.links.get(to)?.[kind], msg);
    } else {
      put(this.links.get(this.hostInfo.id)?.[kind], { k: 'msg', ch: channel, to, d: data } satisfies Wire);
    }
  }

  // --- Media -----------------------------------------------------------------

  /** Start a media call (voice) directly to another player. */
  call(peerId: string, stream: MediaStream): MediaConnection | null {
    if (this.closed || !this.peers.has(peerId)) return null;
    return this.peer.call(peerId, stream, { metadata: { from: this.self.id } });
  }

  /** Incoming media calls. The handler answers (or closes) them. */
  onCall(handler: (call: MediaConnection, from: PeerInfo) => void): () => void {
    this.callHandlers.add(handler);
    return () => this.callHandlers.delete(handler);
  }

  /** Leave the room (as host, this ends it for everyone). */
  leave(): void {
    this.close();
  }

  // --- Internals -------------------------------------------------------------

  private emit(type: RoomEvent, peer: PeerInfo | null): void {
    for (const fn of this.listeners.get(type) ?? []) fn(peer);
  }

  private deliver(channel: string, data: unknown, fromId: string): void {
    const from = fromId === this.self.id ? this.self : this.peers.get(fromId);
    if (!from) return;
    for (const h of this.handlers.get(channel) ?? []) {
      try {
        h(data, from);
      } catch (e) {
        console.error(`[net] handler for "${channel}" failed`, e);
      }
    }
  }

  /** Host: a client opened a connection (two per client: reliable and fast). */
  private acceptClient(conn: DataConnection): void {
    const kind = conn.label === 'fast' ? 'fast' : 'reliable';
    const link = this.links.get(conn.peer) ?? {};
    link[kind] = conn;
    this.links.set(conn.peer, link);
    conn.on('data', (raw) => this.onHostData(conn, raw as Wire));
    conn.on('close', () => this.dropClient(conn.peer));
    conn.on('error', () => this.dropClient(conn.peer));
  }

  private onHostData(conn: DataConnection, w: Wire): void {
    const id = conn.peer;
    this.heard(id);
    if (w.k === 'ping') return;
    if (w.k === 'hello') {
      const info: PeerInfo = { id, name: String(w.name).slice(0, 24) || 'Player', isHost: false };
      conn.send({ k: 'welcome', you: id, host: this.self, peers: [...this.peers.values()] } satisfies Wire);
      for (const [other, link] of this.links) if (other !== id) put(link.reliable, { k: 'joined', peer: info } satisfies Wire);
      this.peers.set(id, info);
      this.emit('peer-joined', info);
      return;
    }
    if (w.k !== 'msg' || !this.peers.has(id)) return;
    const relay: Wire = { k: 'msg', ch: w.ch, to: w.to, from: id, d: w.d };
    const kind = conn.label === 'fast' ? 'fast' : 'reliable';
    if (w.to === 'host' || w.to === this.self.id) this.deliver(w.ch, w.d, id);
    else if (w.to === 'all') {
      this.deliver(w.ch, w.d, id);
      for (const [other, link] of this.links) if (other !== id) put(link[kind], relay);
    } else put(this.links.get(w.to)?.[kind], relay);
  }

  private dropClient(id: string): void {
    const link = this.links.get(id);
    if (!link) return;
    this.links.delete(id);
    this.lastSeen.delete(id);
    link.reliable?.close();
    link.fast?.close();
    const info = this.peers.get(id);
    if (!info) return;
    this.peers.delete(id);
    for (const l of this.links.values()) put(l.reliable, { k: 'left', id } satisfies Wire);
    this.emit('peer-left', info);
  }

  /** Client: messages from the host. */
  private wireClient(conn: DataConnection): void {
    conn.on('data', (raw) => {
      const w = raw as Wire;
      this.heard(this.hostInfo.id);
      if (w.k === 'joined') {
        if (w.peer.id === this.self.id) return;
        this.peers.set(w.peer.id, w.peer);
        this.emit('peer-joined', w.peer);
      } else if (w.k === 'left') {
        const info = this.peers.get(w.id);
        if (!info) return;
        this.peers.delete(w.id);
        this.emit('peer-left', info);
      } else if (w.k === 'msg') {
        this.deliver(w.ch, w.d, w.from ?? this.hostInfo.id);
      }
    });
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.pinger);
    window.removeEventListener('pagehide', this.onPageHide);
    for (const link of this.links.values()) {
      link.reliable?.close();
      link.fast?.close();
    }
    this.links.clear();
    this.peer.destroy();
    this.emit('closed', null);
  }
}

/** Sends only on an open connection (one still opening, or already closed, drops it). */
function put(conn: DataConnection | undefined, msg: Wire): void {
  if (conn?.open) conn.send(msg);
}

/** Registers with the broker under `id` (or a random id). */
function openPeer(id: string | undefined, opts: RoomOptions): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, peerOptions(opts)) : new Peer(peerOptions(opts));
    const timer = setTimeout(() => {
      peer.destroy();
      reject(new RoomError('broker', "Couldn't reach the signalling broker. Check your connection."));
    }, opts.timeoutMs ?? 15000);
    peer.once('open', () => {
      clearTimeout(timer);
      resolve(peer);
    });
    peer.once('error', (err: Error & { type?: string }) => {
      clearTimeout(timer);
      peer.destroy();
      reject(
        err.type === 'unavailable-id'
          ? new RoomError('code-taken', 'Room code already in use.')
          : new RoomError('broker', `Signalling broker: ${err.message}`),
      );
    });
  });
}
