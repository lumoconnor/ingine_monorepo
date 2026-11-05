import * as THREE from 'three';
import { Component } from '@/entities/Component';
import { PlayerController } from '@/gameplay/player/PlayerController';
import { CombatConfig } from '@/config/combat';
import { Items } from '@/inventory/catalog';
import { Damageable } from './Damageable';
import { Combatant } from './Combatant';
import { Armour } from './Armour';

const DEG = Math.PI / 180;
const _o = new THREE.Vector3();

/**
 * The player's brain for combat: turns input into Combatant intents (left
 * and right mouse: attack, and aim or guard; R, slots 1 to 4), aims from the camera, applies recoil
 * to the view and aiming to the FOV, and owns the player-only rules: fall
 * damage, and dying then waking up at the spawn point.
 */
export class PlayerCombat extends Component {
  /** Before the Combatant (105) so intents are fresh. */
  order = 104;
  private deadTimer = 0;
  private ctrl!: PlayerController;
  private health!: Damageable;
  private fighter!: Combatant;
  private get armour(): Armour | null {
    return this.entity.get(Armour) ?? null;
  }
  private unsubs: (() => void)[] = [];
  /** Recoil still to be applied to the view (radians), spread over a few frames. */
  private kickPitch = 0;
  private kickYaw = 0;
  /** Part of each kick settles back on its own (the rest you pull down yourself). */
  private settle = 0;

  onAttach(): void {
    this.ctrl = this.entity.require(PlayerController);
    this.health = this.entity.require(Damageable);
    this.fighter = this.entity.require(Combatant);
    this.health.inWater = () => this.ctrl.swimming;
    this.fighter.aimer = (o, d) => {
      const cam = this.game.renderer.camera;
      cam.updateMatrixWorld();
      cam.getWorldPosition(o);
      cam.getWorldDirection(d);
    };
    const ev = this.game.events;
    this.unsubs.push(
      ev.on('player:landed', ({ fallSpeed }) => this.onLanded(fallSpeed)),
      ev.on('combat:killed', ({ target }) => {
        if (target !== this.entity) return;
        this.deadTimer = CombatConfig.player.deathTime;
        this.game.input.gameplayBlocked = true;
      }),
      // Brought back some other way (a save loaded, a script): give the controls back.
      ev.on('combat:revived', ({ target }) => {
        if (target !== this.entity || this.deadTimer <= 0) return;
        this.deadTimer = 0;
        this.game.input.gameplayBlocked = false;
      }),
      ev.on('combat:fired', ({ attacker, item }) => {
        if (attacker !== this.entity || !item) return;
        const r = Items[item]?.weapon?.handling?.recoil;
        if (!r) return;
        this.kickPitch += r.pitch * DEG;
        this.settle += r.pitch * DEG * 0.45;
        this.kickYaw += (this.game.getSystem<import('./CombatSystem').CombatSystem>('combat')!.rng() * 2 - 1) * (r.yaw ?? 0) * DEG;
      }),
      // Picking up your first weapon while empty-handed draws it.
      ev.on('state:changed', ({ kind, key }) => {
        if (kind !== 'item' || this.fighter.equipped || !Items[key]?.weapon) return;
        const inst = this.game.state.instancesOf(key).at(-1);
        if (inst && this.game.state.instancesOf().filter((i) => Items[i.item]?.weapon).length === 1) this.fighter.equip(inst.uid);
      }),
      ev.on('combat:dry', ({ entity, reason }) => {
        if (entity !== this.entity) return;
        const text = { empty: 'Click. Empty.', 'no ammo': 'No ammunition for this.', jammed: 'Jammed. Press R to clear it.', misfire: 'Misfire!', winded: 'Too winded to swing.' }[reason];
        ev.emit('notify', { text });
      }),
    );
  }

  onDetach(): void {
    this.unsubs.forEach((u) => u());
  }

  get dead(): boolean {
    return this.health.dead;
  }

  /** The weapons you carry, in the order you got them: slots 1 to 4. */
  weaponSlots(): string[] {
    const st = this.game.state;
    const out = st.instancesOf().filter((i) => Items[i.item]?.weapon).map((i) => i.uid);
    // Stackable throwables take a slot too, by item.
    for (const [item, n] of st.inventory()) if (n > 0 && Items[item]?.weapon?.stack) out.push(`stack:${item}`);
    return out;
  }

  fixedUpdate(dt: number): void {
    const input = this.game.input;
    const i = this.fighter.intents;
    if (this.health.dead) {
      this.deadTimer -= dt;
      if (this.deadTimer <= 0) this.wakeUp();
      i.attack = i.alt = false;
      return;
    }
    i.attack = input.isDown('attack');
    i.alt = input.isDown('altAttack');
    i.attackPressed ||= input.wasPressed('attack');
    i.altPressed ||= input.wasPressed('altAttack');
    i.reload ||= input.wasPressed('reload');
    if (input.wasPressed('cycleAmmo')) {
      const next = this.fighter.cycleAmmo();
      const f = this.fighter;
      if (next) this.game.events.emit('notify', { text: `Next: ${Items[next]?.name ?? next}` });
      else if (f.weapon.ammo && f.weapon.ammo.length > 1) this.game.events.emit('notify', { text: 'No other ammunition for this.' });
    }
    (['slot1', 'slot2', 'slot3', 'slot4'] as const).forEach((a, n) => {
      if (!input.wasPressed(a)) return;
      const uid = this.weaponSlots()[n];
      if (!uid) return;
      this.fighter.equip(this.fighter.equipped === uid ? null : uid);
    });

    // Aiming and handling slow you and zoom the view.
    const h = this.fighter.weapon.handling;
    this.ctrl.fovScale = this.fighter.aiming ? (h?.ads ?? 1) : 1;
    this.ctrl.speedScale =
      (h?.move ?? 1) * (this.fighter.aiming ? (h?.adsMove ?? 1) : 1) * (this.fighter.state === 'blocking' ? 0.6 : 1) * (this.armour?.moveScale ?? 1);

    // Recoil: most of the kick lands within ~60 ms; you pull it back down yourself.
    const k = 1 - Math.exp(-dt * 40);
    const dp = this.kickPitch * k;
    const dy = this.kickYaw * k;
    this.ctrl.pitch = Math.min(this.ctrl.pitch + dp, 85 * DEG);
    this.ctrl.yaw += dy;
    this.kickPitch -= dp;
    this.kickYaw -= dy;
    // The settling part comes back down over a quarter second, once the kick has landed.
    if (Math.abs(this.kickPitch) < 0.002 && this.settle > 0) {
      const back = Math.min(this.settle, this.settle * (1 - Math.exp(-dt * 9)) + 0.0004);
      this.ctrl.pitch -= back;
      this.settle -= back;
    }
  }

  private onLanded(fallSpeed: number): void {
    const f = CombatConfig.fall;
    const c = this.ctrl.cfg;
    const height = (fallSpeed * fallSpeed) / (2 * c.gravity * c.fallGravityMultiplier);
    if (height <= f.safeHeight || this.ctrl.swimming) return;
    const amount = ((height - f.safeHeight) / (f.lethalHeight - f.safeHeight)) * this.health.maxHealth;
    this.health.applyHit({ attacker: null, packets: [{ type: 'fall', amount }], zone: null, source: 'fall', point: this.entity.object3d.getWorldPosition(_o).clone() });
  }

  private wakeUp(): void {
    this.ctrl.respawn();
    this.health.revive();
    this.fighter.cancel();
    this.fighter.stamina = this.fighter.maxStamina;
    this.kickPitch = this.kickYaw = this.settle = 0;
    this.game.input.gameplayBlocked = false;
    this.game.input.clearPressed();
    this.game.events.emit('notify', { text: 'You come to, back where you started.' });
  }
}
