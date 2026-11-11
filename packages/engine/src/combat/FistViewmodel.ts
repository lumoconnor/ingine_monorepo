import * as THREE from 'three';
import { Component } from '../entities/Component';
import { FIXED_DT, type FrameTime } from '../core/Time';
import { Items } from '../inventory/catalog';
import { buildModel, hasModel } from '../render/models/ModelRegistry';
import { Arcs } from './blocks';
import { Combatant } from './Combatant';
import { PlayerCombat } from './PlayerCombat';
import { PlayerController } from '../gameplay/player/PlayerController';

const DEG = Math.PI / 180;
const _guardPos = new THREE.Vector3(0.16, -0.14, -0.46);
const _hand0 = new THREE.Vector3(0.14, -0.22, -0.36);
const _fwd = new THREE.Vector3(0, 0, -1);
const _right = new THREE.Vector3(1, 0, 0);
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _d = new THREE.Vector3();
const _t = new THREE.Vector3();
const smooth = (x: number) => {
  const c = THREE.MathUtils.clamp(x, 0, 1);
  return c * c * (3 - 2 * c);
};

/** Camera-space direction of an arc sample (the same ray the hit trace uses). */
function arcDir(a: { yaw: number; pitch: number }, out: THREE.Vector3): THREE.Vector3 {
  const y = a.yaw * DEG;
  const p = a.pitch * DEG;
  return out.set(-Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
}

type ArcFn = (t: number) => { yaw: number; pitch: number };

/**
 * A hand-held blade pose for a point on a swing: the hand rides out along
 * the swing, the blade points from the hand to where the hit trace is at
 * that moment, and its edge leads in the direction of travel.
 */
function bladePose(arc: ArcFn, p: number, cocked: number, pos: THREE.Vector3, quat: THREE.Quaternion): void {
  const d = arcDir(arc(p), _d);
  const a0 = arc(0);
  const a1 = arc(1);
  // A thrust barely moves sideways: the hand drives forward instead.
  const lunge = Math.abs(a1.yaw - a0.yaw) + Math.abs(a1.pitch - a0.pitch) < 20 ? 1 : 0;
  pos.set(_hand0.x + d.x * 0.22, _hand0.y + d.y * 0.16, _hand0.z - lunge * 0.14 * Math.sin(Math.min(1, p * 1.4) * Math.PI * 0.5));
  // Pointing at the trace 1.3 m out; cocked back, it swings out to the side and up.
  _z.copy(d).multiplyScalar(1.3).sub(pos).normalize();
  if (cocked > 0) {
    _t.copy(d).sub(_fwd).multiplyScalar(0.5).add(_y.set(0, 0.25, 0.45 + lunge * 0.1));
    _z.addScaledVector(_t, cocked).normalize();
    // Out to the side the swing starts from, and up; a thrust draws back.
    pos.add(_y.set(0.06 + d.x * 0.08, 0.06 + Math.max(0, d.y) * 0.12, -0.04 + lunge * 0.08).multiplyScalar(cocked));
  }
  // Edge first: the blade's flat faces across the direction of travel.
  arcDir(arc(Math.min(1, p + 0.02)), _t).sub(arcDir(arc(Math.max(0, p - 0.02)), _x));
  if (_t.lengthSq() < 1e-5) _t.copy(_right);
  _z.negate(); // model -Z runs along the blade
  _x.copy(_t).addScaledVector(_z, -_t.dot(_z)).normalize();
  _y.crossVectors(_z, _x);
  quat.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
}

/**
 * What you see in your hands: the drawn weapon (or a fist when unarmed),
 * posed from the Combatant's state. Pure feel, it never affects the
 * simulation: swings follow the same arcs the hit traces use, guns kick
 * back on each shot and dip while reloading, aiming brings the sights in.
 */
export class FistViewmodel extends Component {
  /** After the camera and combat. */
  order = 120;
  private pivot = new THREE.Group();
  private holder = new THREE.Group();
  private fist = new THREE.Group();
  private flash: THREE.Mesh;
  private flashLight = new THREE.PointLight(0xffc070, 0, 6, 2);
  private model: THREE.Object3D | null = null;
  private shownItem: string | null | undefined = undefined;
  private fighter!: Combatant;
  private player!: PlayerCombat;
  private aimBlend = 0;
  private guard = 0;
  private stagger = 0;
  /** Sway: the weapon lags a little behind where you look, and bobs as you walk. */
  private ctrl!: PlayerController;
  private lastYaw = 0;
  private lastPitch = 0;
  private sway = new THREE.Vector2();
  private swayVel = new THREE.Vector2();
  private bob = 0;
  private bobAmt = 0;
  private restPos = new THREE.Vector3();
  private restRot = new THREE.Euler();
  private restQuat = new THREE.Quaternion();
  private poseQ = new THREE.Quaternion();
  private poseQ2 = new THREE.Quaternion();
  private posePos = new THREE.Vector3();
  private posePos2 = new THREE.Vector3();
  private drawPos: THREE.Vector3 | null = null;
  private drawBlend = 0;
  private sightPos = new THREE.Vector3(0, -0.11, -0.4);
  private fistRest = new THREE.Vector3(0.22, -0.34, -0.3);
  /** Cross-fade out of the last pose when a light wind-up turns into a held heavy. */
  private fade = 0;
  private fadePos = new THREE.Vector3();
  private fadeQuat = new THREE.Quaternion();
  private lastPos = new THREE.Vector3();
  private lastQuat = new THREE.Quaternion();
  private lastState = 'idle';

  constructor() {
    super();
    this.flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, depthTest: false }),
    );
    this.flash.renderOrder = 21;
  }

  onAttach(): void {
    this.fighter = this.entity.require(Combatant);
    this.player = this.entity.require(PlayerCombat);
    this.ctrl = this.entity.require(PlayerController);
    this.lastYaw = this.ctrl.yaw;
    this.lastPitch = this.ctrl.pitch;
    const skin = new THREE.MeshStandardMaterial({ color: 0xd9a888, roughness: 0.8 });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x4d5a6b, roughness: 0.9 });
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.22), sleeve);
    fore.position.z = 0.12;
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.065, 0.075), skin);
    hand.position.z = -0.025;
    this.fist.add(fore, hand);
    this.fist.rotation.set(0.05, 0.12, 0);
    this.pivot.add(this.fist, this.holder, this.flashLight);
    const cam = this.game.renderer.camera;
    if (!cam.parent) this.game.renderer.scene.add(cam);
    cam.add(this.pivot);
  }

  onDetach(): void {
    this.pivot.removeFromParent();
  }

  /** Swap the held model when the weapon changes. */
  private refreshModel(): void {
    const item = this.fighter.itemId;
    if (item === this.shownItem) return;
    this.shownItem = item;
    this.model?.removeFromParent();
    this.model = null;
    const def = item ? Items[item] : undefined;
    const view = def?.weapon?.view;
    const name = view?.model ?? def?.model;
    if (!def || !name) return;
    this.model = hasModel(name) ? buildModel(name) : new THREE.Group();
    this.model.scale.setScalar(view?.scale ?? 1);
    // Drawn on top of the world so it never clips into walls.
    this.model.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.renderOrder = 20;
        o.castShadow = false;
        o.material = (o.material as THREE.Material).clone();
        (o.material as THREE.Material).depthTest = false;
      }
    });
    this.fist.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.renderOrder = 20;
        (o.material as THREE.Material).depthTest = false;
      }
    });
    const p = view?.position ?? [0.22, -0.24, -0.4];
    const r = view?.rotation ?? [0, 0, 0];
    this.restPos.set(p[0], p[1], p[2]);
    this.restRot.set(r[0] * DEG, r[1] * DEG, r[2] * DEG);
    this.restQuat.setFromEuler(this.restRot);
    this.drawPos = view?.draw ? new THREE.Vector3(view.draw[0], view.draw[1], view.draw[2]) : null;
    const sp = view?.sight ?? [0, -0.11, p[2]];
    this.sightPos.set(sp[0], sp[1], sp[2]);
    this.holder.add(this.model);
    // Muzzle at the front of the model.
    const box = new THREE.Box3().setFromObject(this.model);
    this.flash.position.set(0, (box.max.y + box.min.y) / 2 + 0.01, box.min.z - 0.03);
    this.model.add(this.flash);
  }

  update(time: FrameTime): void {
    this.refreshModel();
    const f = this.fighter;
    const dt = Math.min(time.delta, 0.1);
    const dead = this.player.dead;
    this.pivot.visible = !dead;
    const st = f.state;
    // Between fixed steps: where the swing, draw and kick will be by the time this frame shows.
    const prog = f.progressAt(time.alpha);
    const chargeNow = f.chargeAt(time.alpha);
    const sinceShot = f.sinceShot + time.alpha * FIXED_DT;
    if (st === 'charging' && this.lastState === 'windup' && this.model) {
      this.fade = 1;
      this.fadePos.copy(this.lastPos);
      this.fadeQuat.copy(this.lastQuat);
    }
    this.lastState = st;
    const m = f.currentMode;
    const melee = m?.delivery.kind === 'sweep';
    const arcName = f.step ?? m?.delivery.arc ?? 'jab';
    const arc = Arcs[arcName] ?? Arcs.jab;
    // Fists: the whole view jabs along the arc (it's straight ahead).
    let swing = 0;
    if (st === 'windup') swing = prog;
    else if (st === 'active') swing = 1;
    else if (st === 'recovery') swing = 1 - prog;
    if (!melee) swing = 0;
    const a = arc(st === 'windup' ? 0 : st === 'active' ? prog : 1);
    const fistSwing = this.model ? 0 : swing;
    // Guard comes up fast; a stagger knocks the view about.
    const k = 1 - Math.exp(-dt * 18);
    this.guard += ((st === 'blocking' ? 1 : 0) - this.guard) * k;
    this.stagger += ((st === 'staggered' ? 1 : 0) - this.stagger) * (1 - Math.exp(-dt * 10));
    const wob = this.stagger * Math.sin(performance.now() / 45) * 4 * DEG;
    // Sway: a spring pulled by how fast you turn (less while aiming).
    if (dt > 0) {
      let dy = this.ctrl.yaw - this.lastYaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const dp = this.ctrl.pitch - this.lastPitch;
      this.lastYaw = this.ctrl.yaw;
      this.lastPitch = this.ctrl.pitch;
      const calm = 1 - this.aimBlend * 0.8;
      this.swayVel.x += THREE.MathUtils.clamp(-dy / dt, -6, 6) * 0.012 * calm;
      this.swayVel.y += THREE.MathUtils.clamp(-dp / dt, -6, 6) * 0.012 * calm;
      // Critically-damped-ish return to centre.
      for (let r = dt; r > 0; r -= 1 / 240) {
        const h = Math.min(r, 1 / 240);
        this.swayVel.x += (-120 * this.sway.x - 18 * this.swayVel.x) * h;
        this.swayVel.y += (-120 * this.sway.y - 18 * this.swayVel.y) * h;
        this.sway.x += this.swayVel.x * h;
        this.sway.y += this.swayVel.y * h;
      }
      this.sway.clampScalar(-0.12, 0.12);
      const speed = this.ctrl.grounded ? this.ctrl.horizontalSpeed : 0;
      this.bobAmt += (Math.min(1.4, speed / 4.5) - this.bobAmt) * (1 - Math.exp(-dt * 8));
      this.bob += dt * speed * 1.9;
    }
    const bobX = Math.cos(this.bob) * 0.012 * this.bobAmt * (1 - this.aimBlend * 0.85);
    const bobY = -Math.abs(Math.sin(this.bob)) * 0.014 * this.bobAmt * (1 - this.aimBlend * 0.85);
    this.pivot.position.set(this.sway.x * 0.35 + bobX, this.sway.y * 0.35 + bobY, 0);
    this.pivot.rotation.set(
      a.pitch * DEG * fistSwing * 0.8 - this.stagger * 6 * DEG + this.sway.y,
      a.yaw * DEG * fistSwing * 0.8 + wob + this.sway.x,
      wob - this.sway.x * 0.5,
    );

    // Unarmed: the fist jabs out and back, hidden at rest; raised to guard.
    if (!this.model) {
      this.fist.visible = swing > 0.01 || this.guard > 0.02;
      const ext = st === 'active' ? 1 : swing;
      const g = this.guard;
      this.fist.position.set(this.fistRest.x - 0.13 * ext - 0.07 * g, this.fistRest.y + 0.16 * ext + 0.15 * g, this.fistRest.z - 0.24 * ext - 0.12 * g);
      this.fist.rotation.set(0.05 + 0.6 * g, 0.12 - 0.3 * g, 0);
      return;
    }
    this.fist.visible = false;

    this.aimBlend += ((f.aiming ? 1 : 0) - this.aimBlend) * (1 - Math.exp(-dt * 14));
    const pos = this.holder.position.copy(this.restPos);
    const rot = this.holder.rotation.copy(this.restRot);
    // Aim down sights: bring it to the centre, sights at the eye.
    pos.lerp(this.sightPos, this.aimBlend);
    // A blade: cocked back in the windup (or while a heavy is held), then
    // it follows the hit trace, then settles back.
    const held = f.chargingMode;
    const heldArc = held?.delivery.kind === 'sweep' ? (Arcs[held.delivery.arc ?? 'overhead'] ?? null) : null;
    let poseAmt = 0;
    if (melee && (st === 'windup' || st === 'active' || st === 'recovery')) {
      const fromHeld = f.currentMode?.trigger.kind === 'charge';
      if (st === 'windup') {
        // Into the cocked pose (already there after holding a heavy).
        poseAmt = fromHeld ? 1 : smooth(Math.min(1, prog * 1.25));
        bladePose(arc, 0, 1, this.posePos, this.poseQ);
      } else if (st === 'active') {
        poseAmt = 1;
        const p = prog;
        bladePose(arc, p, 0, this.posePos, this.poseQ);
        // Uncoil out of the windup over the first part of the cut.
        const u = smooth(p / 0.3);
        if (u < 1) {
          bladePose(arc, 0, 1, this.posePos2, this.poseQ2);
          this.poseQ.slerpQuaternions(this.poseQ2, this.poseQ, u);
          this.posePos.lerpVectors(this.posePos2, this.posePos, u);
        }
      } else {
        poseAmt = 1 - smooth(prog);
        bladePose(arc, 1, 0, this.posePos, this.poseQ);
      }
    } else if (heldArc && (st === 'pending' || st === 'charging')) {
      // Holding for a heavy: the blade starts lifting the moment you press.
      const h = st === 'pending' ? 0.45 * smooth(f.pendingHold()?.t ?? 0) : 0.45 + 0.55 * smooth(chargeNow * 1.4);
      poseAmt = h;
      bladePose(heldArc, 0, 1, this.posePos, this.poseQ);
      if (st === 'charging' && f.charge >= 1) this.posePos.y += Math.sin(performance.now() / 30) * 0.002;
    }
    if (poseAmt > 0.001) {
      pos.lerp(this.posePos, poseAmt);
      rot.setFromQuaternion(this.poseQ2.slerpQuaternions(this.restQuat, this.poseQ, poseAmt));
    }
    // Guarding with a blade: held across the body, edge out.
    if (this.guard > 0.001) {
      const g = this.guard;
      pos.lerp(_guardPos, g);
      // Blade turned to point left across the view, tip a little raised.
      rot.x += (8 * DEG - rot.x) * g;
      rot.y += (72 * DEG - rot.y) * g;
      rot.z += (-18 * DEG - rot.z) * g;
    }
    // Shots kick it up and back.
    const kick = Math.exp(-sinceShot * 18);
    pos.z += 0.06 * kick;
    rot.x += 9 * DEG * kick * (1 - this.aimBlend * 0.6);
    // Drawing it, and reloading: it dips out of view.
    const dip = st === 'equipping' ? 1 - prog : st === 'reloading' ? Math.sin(Math.min(1, prog) * Math.PI) * 0.9 + 0.1 : 0;
    pos.y -= 0.22 * dip;
    rot.x -= 35 * DEG * dip;
    // A bow or a throw pulls back while charging; a bow comes in toward the
    // eye as it's drawn, the arrow just left of the crosshair.
    const charging = st === 'charging' && !heldArc;
    const drawT = charging ? chargeNow : 0;
    this.drawBlend += ((charging ? 1 : 0) - this.drawBlend) * (1 - Math.exp(-dt * 16));
    if (this.drawPos) pos.lerp(this.drawPos, this.drawBlend);
    else pos.z += 0.04 * drawT;
    // A bow draws its string and shows the nocked arrow.
    const ud = this.model.userData;
    ud.draw?.(drawT);
    ud.nocked?.(st !== 'reloading' && st !== 'equipping' && f.loaded() > 0);

    if (this.fade > 0) {
      const k = smooth(this.fade);
      pos.lerp(this.fadePos, k);
      this.holder.quaternion.slerp(this.fadeQuat, k);
      this.fade = Math.max(0, this.fade - dt / 0.12);
    }
    this.lastPos.copy(pos);
    this.lastQuat.copy(this.holder.quaternion);

    const flashOn = f.sinceShot < 0.05;
    this.flash.visible = flashOn;
    this.flashLight.intensity = flashOn ? 6 : 0;
    this.flashLight.position.copy(pos).z -= 0.3;
  }
}
