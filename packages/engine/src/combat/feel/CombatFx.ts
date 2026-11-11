import * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { System } from '../../core/System';
import type { FrameTime } from '../../core/Time';
import { Items } from '../../inventory/catalog';
import { RigidBodyComponent } from '../../physics/RigidBodyComponent';

const MAX = 400;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  life: number;
  size: number;
  grow: number;
  gravity: number;
  color: THREE.Color;
  drag: number;
}

/** Puff recipes: colour, how many, how fast, how long. */
const Puffs = {
  dust: { color: 0x9c8f78, n: 6, speed: 1.6, life: 0.5, size: 0.05, grow: 0.25, gravity: -0.4, drag: 3 },
  sparks: { color: 0xffd27a, n: 9, speed: 5, life: 0.22, size: 0.018, grow: 0, gravity: 9, drag: 1 },
  blood: { color: 0x7a1414, n: 7, speed: 2.2, life: 0.45, size: 0.03, grow: 0.05, gravity: 8, drag: 2 },
  straw: { color: 0xd8bf7a, n: 7, speed: 2.4, life: 0.6, size: 0.03, grow: 0, gravity: 5, drag: 2.5 },
  smoke: { color: 0xc9c9c4, n: 10, speed: 1.2, life: 1.6, size: 0.07, grow: 0.5, gravity: -0.3, drag: 1.5 },
  debris: { color: 0x5a5046, n: 24, speed: 9, life: 1.0, size: 0.06, grow: 0, gravity: 12, drag: 0.6 },
  splinters: { color: 0xb08a55, n: 7, speed: 3.2, life: 0.55, size: 0.022, grow: 0, gravity: 9, drag: 1.5 },
  dirt: { color: 0x5c4a33, n: 8, speed: 2.6, life: 0.5, size: 0.035, grow: 0.05, gravity: 9, drag: 1.5 },
  chips: { color: 0xa9a59c, n: 6, speed: 3.4, life: 0.4, size: 0.02, grow: 0, gravity: 10, drag: 1 },
} as const;

/** What flies off each kind of surface when something strikes it. */
const SurfacePuffs: Record<string, PuffKind[]> = {
  stone: ['dust', 'chips'],
  wood: ['splinters'],
  dirt: ['dirt', 'dust'],
  metal: ['sparks'],
};

const TRACER_SPEED = 280;
const TRACER_LENGTH = 9;
const MAX_MARKS = 48;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);

interface Tracer {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  dir: THREE.Vector3;
  length: number;
  /** Metres its head has travelled. */
  head: number;
}
export type PuffKind = keyof typeof Puffs;

/**
 * Small particle effects for combat, all from one instanced mesh: dust where
 * a shot or blade hits the world, blood (or straw, from dummies) where it hits
 * someone, sparks off a block or a parry, gun smoke, blast debris. Pure feel.
 */
export class CombatFx implements System {
  readonly name = 'combat-fx';
  private game!: Game;
  private mesh!: THREE.InstancedMesh;
  private parts: Particle[] = [];
  private tracers: Tracer[] = [];
  private tracerGeo = new THREE.BoxGeometry(0.012, 0.012, 1);
  private tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending });
  /** Marks left where shots and blades struck things that stay put; the oldest go first. */
  private marks: THREE.Mesh[] = [];
  private markGeo = new THREE.CircleGeometry(1, 10);
  private markMat = new THREE.MeshBasicMaterial({ color: 0x15120f, transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

  init(game: Game): void {
    this.game = game;
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    game.renderer.scene.add(this.mesh);
    const ev = game.events;
    ev.on('combat:impact', ({ point, surface, delivery, normal, fixed }) => {
      const n = normal ? _a.set(normal.x, normal.y, normal.z) : undefined;
      for (const kind of SurfacePuffs[surface ?? 'stone'] ?? SurfacePuffs.stone) this.puff(kind, point, delivery === 'sweep' ? 0.7 : 1, n);
      // Steel on stone throws sparks.
      if (delivery === 'sweep' && (surface ?? 'stone') === 'stone') this.puff('sparks', point, 0.7, n);
      if (normal && fixed && delivery === 'hitscan') this.mark(point, normal);
    });
    ev.on('combat:tracer', ({ attacker, from, to }) => this.tracer(attacker?.name === 'player', from, to));
    ev.on('level:loaded', () => this.clearMarks());
    ev.on('game:loaded', () => this.clearMarks());
    ev.on('combat:hit', ({ hit, target, result }) => {
      if (!hit.point || hit.delivery === 'status' || hit.delivery === 'hazard') return;
      const t = result.tags;
      if (t.includes('parried')) return this.puff('sparks', hit.point, 2);
      if (t.includes('blocked') || (t.includes('armour') && result.damage < 8)) this.puff('sparks', hit.point);
      if (result.damage <= 0) return;
      this.puff(target.tags.has('dummy') ? 'straw' : 'blood', hit.point, Math.min(2, 0.6 + result.damage / 40), hit.direction);
    });
    ev.on('combat:fired', ({ attacker, item }) => {
      const d = item ? Items[item]?.weapon : undefined;
      const kind = d && Object.values(d.modes)[0]?.delivery?.kind;
      if (kind !== 'hitscan') return;
      // Smoke from the muzzle, about where the shot left.
      const cam = attacker.name === 'player' ? this.game.renderer.camera : null;
      const o = new THREE.Vector3();
      const dir = new THREE.Vector3();
      if (cam) {
        cam.getWorldPosition(o);
        cam.getWorldDirection(dir);
        o.addScaledVector(dir, 0.7).y -= 0.12;
      } else {
        const b = attacker.get(RigidBodyComponent)?.body.translation();
        if (!b) return;
        dir.set(0, 0, 1).applyQuaternion(attacker.object3d.quaternion);
        o.set(b.x, b.y + 1.45, b.z).addScaledVector(dir, 1.1);
      }
      this.puff('smoke', o, item === 'musket' ? 1.8 : 0.6, dir);
    });
    ev.on('combat:explosion', ({ point }) => {
      this.puff('debris', point, 1);
      this.puff('smoke', point, 3);
    });
  }

  /** Spawn a puff at `at`, `scale` times the usual amount, thrown mostly along `dir` if given. */
  puff(kind: PuffKind, at: { x: number; y: number; z: number }, scale = 1, dir?: THREE.Vector3): void {
    const r = Puffs[kind];
    const n = Math.round(r.n * scale);
    for (let i = 0; i < n; i++) {
      if (this.parts.length >= MAX) this.parts.shift();
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).normalize().multiplyScalar(r.speed * (0.4 + Math.random() * 0.8));
      if (dir) v.addScaledVector(dir, r.speed * 0.5);
      this.parts.push({
        pos: new THREE.Vector3(at.x, at.y, at.z),
        vel: v,
        age: 0,
        life: r.life * (0.7 + Math.random() * 0.6),
        size: r.size * (0.7 + Math.random() * 0.6),
        grow: r.grow,
        gravity: r.gravity,
        drag: r.drag,
        color: _c.set(r.color).clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.1),
      });
    }
  }

  /** A bullet's streak: a short bright line that runs from the muzzle to where the shot stopped. */
  private tracer(mine: boolean, from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): void {
    _a.set(from.x, from.y, from.z);
    _b.set(to.x, to.y, to.z);
    if (mine) {
      // Yours leaves from the gun, low and right of the eye, and meets the line of the shot.
      const cam = this.game.renderer.camera;
      _a.add(_p.set(0.14, -0.13, -0.6).applyQuaternion(cam.quaternion));
    }
    const length = _a.distanceTo(_b);
    if (length < 2.5) return;
    const mesh = new THREE.Mesh(this.tracerGeo, this.tracerMat);
    mesh.frustumCulled = false;
    const dir = _b.clone().sub(_a).divideScalar(length);
    mesh.quaternion.setFromUnitVectors(_z, dir);
    this.game.renderer.scene.add(mesh);
    const t: Tracer = { mesh, from: _a.clone(), dir, length, head: Math.min(length, 1.5) };
    this.tracers.push(t);
    this.placeTracer(t);
  }

  private placeTracer(t: Tracer): void {
    const tail = Math.max(0, t.head - TRACER_LENGTH);
    const head = Math.min(t.head, t.length);
    t.mesh.scale.set(1, 1, Math.max(0.01, head - tail));
    t.mesh.position.copy(t.from).addScaledVector(t.dir, (head + tail) / 2);
  }

  /** A dark mark on a surface that stays put. */
  private mark(point: { x: number; y: number; z: number }, normal: { x: number; y: number; z: number }): void {
    let m = this.marks.length >= MAX_MARKS ? this.marks.shift()! : null;
    if (!m) {
      m = new THREE.Mesh(this.markGeo, this.markMat);
      this.game.renderer.scene.add(m);
    }
    _a.set(normal.x, normal.y, normal.z).normalize();
    m.position.set(point.x, point.y, point.z).addScaledVector(_a, 0.004);
    m.quaternion.setFromUnitVectors(_z, _a);
    m.scale.setScalar(0.022 + Math.random() * 0.01);
    this.marks.push(m);
  }

  private clearMarks(): void {
    for (const m of this.marks) m.removeFromParent();
    this.marks = [];
    for (const t of this.tracers) t.mesh.removeFromParent();
    this.tracers = [];
  }

  get marksLeft(): number {
    return this.marks.length;
  }

  get tracersLive(): number {
    return this.tracers.length;
  }

  get live(): number {
    return this.parts.length;
  }

  update(time: FrameTime): void {
    const dt = Math.min(time.delta, 0.1);
    if (this.tracers.length) {
      this.tracers = this.tracers.filter((t) => {
        t.head += TRACER_SPEED * dt;
        if (t.head - TRACER_LENGTH >= t.length) return void t.mesh.removeFromParent(), false;
        this.placeTracer(t);
        return true;
      });
    }
    this.parts = this.parts.filter((p) => (p.age += dt) < p.life);
    let i = 0;
    for (const p of this.parts) {
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      const k = p.age / p.life;
      const size = (p.size + p.grow * k) * (1 - k * k * 0.6);
      _m.compose(p.pos, _q, _s.setScalar(size));
      this.mesh.setMatrixAt(i, _m);
      this.mesh.setColorAt(i, _c.copy(p.color).multiplyScalar(1 - k * 0.5));
      i++;
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    void _p;
  }
}
