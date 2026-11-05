import * as THREE from 'three';
import { Component } from '@/entities/Component';
import type { FrameTime } from '@/core/Time';
import { makeLabel } from '@/render/labels';
import { Items } from '@/inventory/catalog';
import { buildModel, hasModel } from '@/render/models/ModelRegistry';
import { Arcs } from '../blocks';
import { Damageable } from '../Damageable';
import { Combatant } from '../Combatant';
import { Armour } from '../Armour';
import { NpcBody } from './NpcBody';
import { Perception } from './Perception';
import { EnemyBrain } from './EnemyBrain';

const mat = (color: number, roughness = 0.8, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const skin = mat(0xd5a583);
const DEG = Math.PI / 180;

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z);
  b.castShadow = true;
  return b;
}

/**
 * How an enemy looks and moves: a simple jointed figure (legs that walk,
 * an arm that swings the weapon along the same arcs its hits use, a gun
 * shouldered while it aims), topples when it dies, and shows a tag:
 * "?" while it's noticing you, "!" once it's after you, and its wounds.
 * Feel only: it never changes what happens.
 */
export class NpcRig extends Component {
  order = 121;
  private figure = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private torso!: THREE.Mesh;
  private head = new THREE.Group();
  private hand = new THREE.Group();
  private gun = new THREE.Group();
  private helm: THREE.Object3D | null = null;
  private mail: THREE.Mesh | null = null;
  private weaponShown: string | null | undefined = undefined;
  private phase = 0;
  private fall = 0;
  private label: THREE.Sprite | null = null;
  private labelKey = '';
  private f!: Combatant;
  private body!: NpcBody;
  private hp!: Damageable;
  private eyes!: Perception;
  private brain!: EnemyBrain;
  private flash = 0;
  private mats: THREE.MeshStandardMaterial[] = [];
  private unsub: (() => void) | null = null;

  constructor(private look: { tunic: number; hood: number }) {
    super();
  }

  onAttach(): void {
    this.f = this.entity.require(Combatant);
    this.body = this.entity.require(NpcBody);
    this.hp = this.entity.require(Damageable);
    this.eyes = this.entity.require(Perception);
    this.brain = this.entity.require(EnemyBrain);
    const tunic = mat(this.look.tunic);
    const trousers = mat(0x3a3530);
    const hood = mat(this.look.hood, 0.9);
    const fig = this.figure;
    for (const [leg, x] of [[this.legL, 0.11], [this.legR, -0.11]] as const) {
      leg.position.set(x, 0.92, 0);
      leg.add(box(0.14, 0.88, 0.15, trousers, 0, -0.44, 0));
      leg.add(box(0.15, 0.08, 0.24, mat(0x2a2018), 0, -0.88, 0.04));
      fig.add(leg);
    }
    this.torso = box(0.44, 0.62, 0.25, tunic, 0, 1.24, 0);
    fig.add(this.torso, box(0.46, 0.07, 0.27, mat(0x4a3220), 0, 0.96, 0));
    this.head.position.set(0, 1.66, 0);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), skin);
    skull.castShadow = true;
    // A hood, open at the front so you can see the face (and which way it looks).
    const cowl = new THREE.Mesh(new THREE.SphereGeometry(0.155, 14, 10, Math.PI * 0.8, Math.PI * 1.4, 0, Math.PI * 0.62), hood);
    (cowl.material as THREE.Material).side = THREE.DoubleSide;
    cowl.rotation.x = -0.2;
    cowl.position.z = -0.015;
    const nose = box(0.04, 0.05, 0.06, skin, 0, -0.01, 0.13);
    this.head.add(skull, cowl, nose);
    fig.add(this.head);
    for (const [arm, x] of [[this.armL, 0.28], [this.armR, -0.28]] as const) {
      arm.position.set(x, 1.5, 0);
      arm.add(box(0.11, 0.6, 0.12, tunic, 0, -0.3, 0));
      arm.add(box(0.09, 0.09, 0.1, skin, 0, -0.62, 0));
      fig.add(arm);
    }
    this.hand.position.set(0, -0.62, 0);
    this.armR.add(this.hand);
    this.gun.position.set(-0.12, 1.38, 0.18);
    fig.add(this.gun);
    this.entity.object3d.add(fig);
    // Its own copies of the materials, so a hit can flash just this one.
    fig.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
        o.material = o.material.clone();
        this.mats.push(o.material);
      }
    });
    this.unsub = this.game.events.on('combat:hit', ({ target, result, hit }) => {
      if (target === this.entity && result.damage > 0 && hit.delivery !== 'status') this.flash = 1;
    });
  }

  onDetach(): void {
    this.unsub?.();
  }

  /** Shows the drawn weapon (in hand, or held across the body for long guns) and worn armour. */
  private refresh(): void {
    const item = this.f.itemId;
    if (item !== this.weaponShown) {
      this.weaponShown = item;
      this.hand.clear();
      this.gun.clear();
      const name = item ? Items[item]?.model : null;
      if (name && hasModel(name)) {
        const m = buildModel(name);
        // Models point down -Z from the grip; in the hand the blade runs along the fist's +Z.
        m.rotation.y = Math.PI;
        m.traverse((o) => o instanceof THREE.Mesh && (o.castShadow = true));
        if (this.twoHanded) this.gun.add(m);
        else this.hand.add(m);
      }
    }
    const ar = this.entity.get(Armour);
    const helmItem = ar?.worn.head ?? null;
    if ((this.helm?.userData.item ?? null) !== helmItem) {
      this.helm?.removeFromParent();
      this.helm = null;
      if (helmItem) {
        const steel = helmItem === 'steel_helm';
        const h = new THREE.Mesh(
          new THREE.SphereGeometry(steel ? 0.16 : 0.155, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
          steel ? mat(0xc4ccd4, 0.35, 0.3) : mat(0x6b4426, 0.85),
        );
        h.position.y = 0.01;
        h.userData.item = helmItem;
        this.head.add(h);
        this.helm = h;
      }
    }
    const body = ar?.worn.body ?? null;
    if ((this.mail?.userData.item ?? null) !== body) {
      this.mail?.removeFromParent();
      this.mail = null;
      if (body) {
        this.mail = box(0.46, 0.5, 0.27, body === 'mail_hauberk' ? mat(0x8d949b, 0.55, 0.35) : mat(0x2f3a2c, 0.9), 0, 1.22, 0);
        this.mail.userData.item = body;
        this.figure.add(this.mail);
      }
    }
  }

  private get twoHanded(): boolean {
    const id = this.f.itemId;
    return !!id && !!Items[id]?.weapon?.handling?.ads && Items[id]?.model === 'musket';
  }

  update(time: FrameTime): void {
    this.refresh();
    const dt = Math.min(time.delta, 0.1);
    if (this.flash > 0 || this.mats[0]?.emissiveIntensity) {
      this.flash = Math.max(0, this.flash - dt * 9);
      for (const m of this.mats) {
        m.emissive.setRGB(0.9, 0.25, 0.2);
        m.emissiveIntensity = this.flash * 0.45;
      }
    }
    const f = this.f;
    const st = f.state;
    // Dead: fall over backwards.
    const down = this.hp.dead ? 1 : 0;
    this.fall += (down - this.fall) * (1 - Math.exp(-dt * (down ? 6 : 4)));
    this.figure.rotation.x = -this.fall * (Math.PI / 2) * 0.95;
    this.figure.position.y = this.fall * 0.12;

    // Walk.
    const speed = this.body.speed;
    this.phase += dt * speed * 2.6;
    const swing = Math.sin(this.phase) * Math.min(0.7, speed * 0.18) * (1 - this.fall);
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.set(-swing * 0.6, 0, 0.08);

    // Lean back when staggered.
    const reel = st === 'staggered' ? Math.sin(f.progress * Math.PI) : 0;
    this.torso.rotation.x = -0.25 * reel;
    this.head.rotation.x = -0.3 * reel;

    // The weapon arm.
    const m = f.currentMode;
    const arcName = f.step ?? m?.delivery.arc ?? 'jab';
    const arc = Arcs[arcName] ?? Arcs.jab;
    let ax = -0.55;
    let ay = 0;
    let az = 0;
    if (st === 'windup' && m?.delivery.kind === 'sweep') {
      // The tell: arm drawn back high before the blow.
      const k = f.progress;
      ax = THREE.MathUtils.lerp(-0.55, -2.5, k);
      ay = (arc(0).yaw * DEG) * 0.6 * k;
    } else if (st === 'active' && m?.delivery.kind === 'sweep') {
      const a = arc(f.progress);
      ax = THREE.MathUtils.lerp(-2.5, -0.7, f.progress);
      ay = a.yaw * DEG * 0.7;
    } else if (st === 'recovery' && m?.delivery.kind === 'sweep') {
      ax = THREE.MathUtils.lerp(-0.7, -0.55, f.progress);
      ay = arc(1).yaw * DEG * 0.7 * (1 - f.progress);
    } else if (st === 'charging') {
      ax = -2.7;
    } else if (st === 'blocking') {
      ax = -1.5;
      ay = -0.7;
      az = -0.9;
    }
    if (this.twoHanded) {
      // Musket: port arms; shouldered and levelled while aiming; upright to reload.
      const aim = st === 'recovery' ? 1 : this.brain.aimingAt;
      const reload = st === 'reloading' ? 1 : 0;
      this.gun.rotation.set(THREE.MathUtils.lerp(-0.9, 0, aim) - 0.7 * reload, 0, THREE.MathUtils.lerp(0.7, 0, Math.max(aim, reload)));
      this.gun.position.set(THREE.MathUtils.lerp(-0.12, -0.16, aim), THREE.MathUtils.lerp(1.3, 1.5, aim), THREE.MathUtils.lerp(0.18, 0.05, aim));
      this.armR.rotation.set(THREE.MathUtils.lerp(-0.9, -1.4, aim), 0, 0);
      this.armL.rotation.set(THREE.MathUtils.lerp(-1.1, -1.5, aim), -0.4, 0);
    } else {
      this.armR.rotation.set(ax, ay, az);
    }
    this.updateLabel();
  }

  private updateLabel(): void {
    const e = this.eyes;
    const hp = Math.ceil(this.hp.health);
    const hurt = hp < this.hp.maxHealth;
    const mark = this.hp.dead ? '' : e.target ? ' !' : e.awareness > 0.25 || this.brain.activity === 'investigate' ? ' ?' : '';
    const text = this.hp.dead ? `${this.brain.title} (dead)` : `${this.brain.title}${hurt ? `  ${hp}` : ''}${mark}`;
    const color = this.hp.dead ? '#bbbbbb' : e.target ? '#ff8f80' : mark ? '#ffd66b' : '#ffffff';
    const key = text + color;
    if (key === this.labelKey) return;
    this.labelKey = key;
    if (this.label) {
      (this.label.material as THREE.SpriteMaterial).map?.dispose();
      this.label.material.dispose();
      this.label.removeFromParent();
    }
    this.label = makeLabel(text, { scale: 0.34, color });
    this.label.position.y = this.hp.dead ? 0.6 : 2.15;
    this.entity.object3d.add(this.label);
  }
}
