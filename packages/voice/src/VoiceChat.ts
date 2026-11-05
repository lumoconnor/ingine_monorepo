import * as THREE from 'three';

import type { Game } from '@ingine/engine/core/Game';
import type { System } from '@ingine/engine/core/System';
import type { FrameTime } from '@ingine/engine/core/Time';
import { RAPIER } from '@ingine/engine/physics/PhysicsWorld';
import { RigidBodyComponent } from '@ingine/engine/physics/RigidBodyComponent';
import { groups, Layer } from '@ingine/engine/physics/groups';
import type { MediaConnection, PeerInfo, Room } from '@ingine/net/Room';

/** Tells voice where each player's mouth is. @ingine/multiplayer's NetSystem implements it. */
export interface SpatialSource {
  speakerPosition(peerId: string, out: THREE.Vector3): boolean;
}

export type MicMode = 'push-to-talk' | 'open';
export type MicState = 'off' | 'asking' | 'on' | 'unavailable';

export interface VoiceOptions {
  spatial: SpatialSource;
  /** KeyboardEvent.code values. */
  keys?: { talk?: string; toggleMode?: string; mute?: string };
  mode?: MicMode;
  /** Within this distance a voice is at full volume (m). */
  fullVolumeDistance?: number;
  /** How fast voices fade with distance past that (1 = natural inverse falloff). */
  rolloff?: number;
  /** Beyond this, you can't hear them at all (m). */
  hearingRange?: number;
  /** Walls and closed doors between you muffle and quieten voices. */
  occlusion?: boolean;
}

/** Per-player voice as it reaches you. */
interface Remote {
  peer: PeerInfo;
  call: MediaConnection;
  audio?: HTMLAudioElement;
  source?: MediaStreamAudioSourceNode;
  analyser?: AnalyserNode;
  filter?: BiquadFilterNode;
  gain?: GainNode;
  panner?: PannerNode;
  /** 0..1 how loud they are right now (before distance), for speaking indicators. */
  level: number;
  speakingHold: number;
  occluded: boolean;
  /** Distance factor applied on top of the panner: 1 in range, fading to 0 at hearingRange. */
  rangeGain: number;
  volume: number;
  distance: number;
}

const OCCLUDED_CUTOFF = 650; // Hz: speech through a wall
const OPEN_CUTOFF = 18000;
const OCCLUDED_GAIN = 0.35;
const SPEAKING_LEVEL = 0.015;
/** Queries that hit walls, floors and doors but not pickups, ropes or hit zones. */
const OCCLUSION_QUERY = groups(Layer.player, 0xffff);

const _pos = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _buf = new Float32Array(512);

/**
 * Voice chat over a room. Every player sends their microphone directly to
 * every other player (a mesh of WebRTC calls: fine for small groups), and
 * each listener's own game decides how a voice sounds:
 *
 * - 3D position: an HRTF panner at the speaker's head, so voices come from
 *   where people are and turn with your view.
 * - Distance: full volume up close, fading out, silent past hearingRange.
 * - Walls: if level geometry is between you, the voice is muffled (low-pass)
 *   and quieter, so a closed meeting room sounds closed.
 *
 * Controls: hold V to talk (push-to-talk), B switches to open mic and back,
 * M mutes your mic. Without a microphone you can still listen.
 */
export class VoiceChat implements System {
  readonly name = 'voice';
  private game!: Game;
  private room: Room | null = null;
  readonly ctx: AudioContext;
  private out: MediaStreamAudioDestinationNode;
  private gate: GainNode;
  private selfAnalyser: AnalyserNode;
  private mic: MediaStream | null = null;
  private remotes = new Map<string, Remote>();
  private unsub: (() => void)[] = [];
  private keys: Required<NonNullable<VoiceOptions['keys']>>;
  private opts: Required<Omit<VoiceOptions, 'keys' | 'spatial'>> & { spatial: SpatialSource };

  micState: MicState = 'off';
  mode: MicMode;
  muted = false;
  private talkHeld = false;
  /** 0..1 your own mic level (whether or not you're sending). */
  selfLevel = 0;
  /** Called when someone's speaking level changes noticeably (for avatar rings, the player list). */
  onSpeaking: (peerId: string, level: number) => void = () => {};

  constructor(opts: VoiceOptions) {
    this.opts = {
      mode: 'push-to-talk',
      fullVolumeDistance: 1.5,
      rolloff: 1.3,
      hearingRange: 30,
      occlusion: true,
      ...opts,
    };
    this.keys = { talk: 'KeyV', toggleMode: 'KeyB', mute: 'KeyM', ...opts.keys };
    this.mode = this.opts.mode;
    this.ctx = new AudioContext();
    this.out = this.ctx.createMediaStreamDestination();
    this.gate = this.ctx.createGain();
    this.gate.gain.value = 0;
    this.selfAnalyser = this.ctx.createAnalyser();
    this.selfAnalyser.fftSize = 512;
    this.gate.connect(this.out);
  }

  init(game: Game): void {
    this.game = game;
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    // Browsers start audio suspended until the page is interacted with.
    const resume = () => void this.ctx.resume();
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
  }

  /** True while your voice is going out. */
  get transmitting(): boolean {
    return this.micState === 'on' && !this.muted && (this.mode === 'open' || this.talkHeld);
  }

  /** Join the room's voice: ask for the mic, call everyone already here, answer whoever calls. */
  async start(room: Room): Promise<void> {
    this.stop();
    this.room = room;
    void this.ctx.resume();
    this.unsub.push(
      room.onCall((call, from) => {
        call.answer(this.out.stream);
        this.track(from, call);
      }),
      room.onEvent('peer-left', (p) => this.drop(p!.id)),
      room.onEvent('closed', () => this.stop()),
    );
    this.micState = 'asking';
    this.emitState();
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const src = this.ctx.createMediaStreamSource(this.mic);
      src.connect(this.selfAnalyser);
      src.connect(this.gate);
      this.micState = 'on';
    } catch {
      this.micState = 'unavailable';
    }
    this.emitState();
    if (this.room !== room) return; // stopped while asking
    // Newcomers call the players already here; those players answer. One call per pair.
    for (const peer of room.peers.values()) {
      const call = room.call(peer.id, this.out.stream);
      if (call) this.track(peer, call);
    }
  }

  stop(): void {
    for (const u of this.unsub) u();
    this.unsub = [];
    for (const id of [...this.remotes.keys()]) this.drop(id);
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
    this.room = null;
    this.micState = 'off';
  }

  setMode(mode: MicMode): void {
    this.mode = mode;
    this.emitState();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.emitState();
  }

  /** Per-player volume, 0..2 (1 = normal). */
  setPeerVolume(peerId: string, volume: number): void {
    const r = this.remotes.get(peerId);
    if (r) r.volume = THREE.MathUtils.clamp(volume, 0, 2);
  }

  /** What each voice is doing right now (debug readout and checks). */
  debugState(): Record<string, { name: string; level: number; distance: number; occluded: boolean; gain: number; cutoff: number; connected: boolean }> {
    const out: ReturnType<VoiceChat['debugState']> = {};
    for (const [id, r] of this.remotes) {
      out[id] = {
        name: r.peer.name,
        level: r.level,
        distance: r.distance,
        occluded: r.occluded,
        gain: r.gain?.gain.value ?? 0,
        cutoff: r.filter?.frequency.value ?? 0,
        connected: !!r.source,
      };
    }
    return out;
  }

  // --- Per frame -----------------------------------------------------------------

  update(time: FrameTime): void {
    const dt = Math.min(time.delta, 0.1);
    // Gate: open while transmitting (short fade avoids clicks).
    this.gate.gain.setTargetAtTime(this.transmitting ? 1 : 0, this.ctx.currentTime, 0.015);
    this.selfLevel = this.mic ? rms(this.selfAnalyser) : 0;

    // Listener = the camera.
    const cam = this.game.renderer.camera;
    cam.updateMatrixWorld();
    cam.getWorldPosition(_pos);
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    _up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const L = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(_pos.x, t, 0.02);
      L.positionY.setTargetAtTime(_pos.y, t, 0.02);
      L.positionZ.setTargetAtTime(_pos.z, t, 0.02);
      L.forwardX.setTargetAtTime(_fwd.x, t, 0.02);
      L.forwardY.setTargetAtTime(_fwd.y, t, 0.02);
      L.forwardZ.setTargetAtTime(_fwd.z, t, 0.02);
      L.upX.setTargetAtTime(_up.x, t, 0.02);
      L.upY.setTargetAtTime(_up.y, t, 0.02);
      L.upZ.setTargetAtTime(_up.z, t, 0.02);
    } else {
      L.setPosition(_pos.x, _pos.y, _pos.z);
      L.setOrientation(_fwd.x, _fwd.y, _fwd.z, _up.x, _up.y, _up.z);
    }

    const head = new THREE.Vector3();
    for (const [id, r] of this.remotes) {
      if (!r.panner || !r.gain || !r.filter || !r.analyser) continue;
      const known = this.opts.spatial.speakerPosition(id, head);
      if (known) {
        r.panner.positionX.setTargetAtTime(head.x, t, 0.03);
        r.panner.positionY.setTargetAtTime(head.y, t, 0.03);
        r.panner.positionZ.setTargetAtTime(head.z, t, 0.03);
        r.distance = head.distanceTo(_pos);
        r.occluded = this.opts.occlusion && this.blocked(_pos, head, r.distance);
      }
      // Fade out over the last 20% of the hearing range.
      const range = this.opts.hearingRange;
      r.rangeGain = known ? THREE.MathUtils.clamp((range - r.distance) / (range * 0.2), 0, 1) : 0;
      const target = r.volume * r.rangeGain * (r.occluded ? OCCLUDED_GAIN : 1);
      r.gain.gain.setTargetAtTime(target, t, 0.08);
      r.filter.frequency.setTargetAtTime(r.occluded ? OCCLUDED_CUTOFF : OPEN_CUTOFF, t, 0.08);

      const level = rms(r.analyser);
      r.level = level;
      r.speakingHold = level > SPEAKING_LEVEL ? 0.3 : Math.max(0, r.speakingHold - dt);
      this.onSpeaking(id, r.speakingHold > 0 ? Math.min(1, level * 8) : 0);
    }
  }

  // --- Internals -------------------------------------------------------------

  private blocked(from: THREE.Vector3, to: THREE.Vector3, dist: number): boolean {
    if (dist < 0.4) return false;
    const world = this.game.physics.world;
    const body = this.game.world.find('player')?.get(RigidBodyComponent)?.body;
    _dir.subVectors(to, from).divideScalar(dist);
    const hit = world.castRay(
      new RAPIER.Ray(from, _dir),
      dist - 0.35, // stop short of their head
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      OCCLUSION_QUERY,
      undefined,
      body,
    );
    return !!hit;
  }

  private track(peer: PeerInfo, call: MediaConnection): void {
    this.drop(peer.id);
    const r: Remote = {
      peer,
      call,
      level: 0,
      speakingHold: 0,
      occluded: false,
      rangeGain: 0,
      volume: 1,
      distance: Infinity,
    };
    this.remotes.set(peer.id, r);
    call.on('stream', (stream) => {
      if (r.source || this.remotes.get(peer.id) !== r) return; // PeerJS can fire this twice
      // Chrome only feeds a remote WebRTC stream into Web Audio if a media
      // element is also playing it; keep a muted one.
      r.audio = new Audio();
      r.audio.muted = true;
      r.audio.srcObject = stream;
      void r.audio.play().catch(() => {});

      const ctx = this.ctx;
      r.source = ctx.createMediaStreamSource(stream);
      r.analyser = ctx.createAnalyser();
      r.analyser.fftSize = 512;
      r.filter = ctx.createBiquadFilter();
      r.filter.type = 'lowpass';
      r.filter.frequency.value = OPEN_CUTOFF;
      r.gain = ctx.createGain();
      r.gain.gain.value = 0;
      r.panner = new PannerNode(ctx, {
        panningModel: 'HRTF',
        distanceModel: 'inverse',
        refDistance: this.opts.fullVolumeDistance,
        rolloffFactor: this.opts.rolloff,
        maxDistance: this.opts.hearingRange,
      });
      r.source.connect(r.analyser);
      r.source.connect(r.filter).connect(r.gain).connect(r.panner).connect(ctx.destination);
    });
    call.on('close', () => {
      if (this.remotes.get(peer.id) === r) this.drop(peer.id);
    });
    call.on('error', () => {
      if (this.remotes.get(peer.id) === r) this.drop(peer.id);
    });
  }

  private drop(id: string): void {
    const r = this.remotes.get(id);
    if (!r) return;
    this.remotes.delete(id);
    r.panner?.disconnect();
    r.gain?.disconnect();
    r.filter?.disconnect();
    r.source?.disconnect();
    if (r.audio) r.audio.srcObject = null;
    r.call.close();
    this.onSpeaking(id, 0);
  }

  private onKey = (e: KeyboardEvent): void => {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    const down = e.type === 'keydown';
    if (e.code === this.keys.talk) {
      this.talkHeld = down;
      this.emitState();
    } else if (down && !e.repeat && e.code === this.keys.toggleMode) {
      this.setMode(this.mode === 'open' ? 'push-to-talk' : 'open');
    } else if (down && !e.repeat && e.code === this.keys.mute) {
      this.setMuted(!this.muted);
    }
  };

  private emitState(): void {
    this.game?.events.emit('voice:state', {
      mic: this.micState,
      mode: this.mode,
      muted: this.muted,
      transmitting: this.transmitting,
    });
  }

  dispose(): void {
    this.stop();
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    void this.ctx.close();
  }
}

/** Root-mean-square of what the analyser hears right now, 0..1. */
function rms(a: AnalyserNode): number {
  const n = Math.min(a.fftSize, _buf.length);
  const buf = _buf.subarray(0, n);
  a.getFloatTimeDomainData(buf);
  let s = 0;
  for (let i = 0; i < n; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / n);
}

declare module '@ingine/engine/core/EventBus' {
  interface GameEvents {
    'voice:state': { mic: MicState; mode: MicMode; muted: boolean; transmitting: boolean };
  }
}
