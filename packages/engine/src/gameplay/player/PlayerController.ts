import * as THREE from 'three';
import { Component } from '../../entities/Component';
import { RAPIER } from '../../physics/PhysicsWorld';
import { RigidBodyComponent } from '../../physics/RigidBodyComponent';
import { PlayerConfig, type PlayerTuning } from '../../config/player';
import { MovingPlatform, type Carrier } from '../components/MovingPlatform';
import { Zipline } from '../components/Zipline';
import { WaterVolume } from '../components/WaterVolume';
import { Ladder } from '../components/Ladder';
import type { Entity } from '../../entities/Entity';
import { PLAYER_PLATFORM_QUERY, PLAYER_WORLD_QUERY } from '../../physics/groups';

const DEG = Math.PI / 180;
const _wish = new THREE.Vector3();
const _target = new THREE.Vector3();
const _feet = new THREE.Vector3();
const _vec = new THREE.Vector3();
const _push = new THREE.Vector3();
const _moved = new THREE.Vector3();
const _rest = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _n = new THREE.Vector3();
const _h = new THREE.Vector3();

const IDENTITY_ROT = { x: 0, y: 0, z: 0, w: 1 };

export type MoveState = 'idle' | 'walk' | 'sprint' | 'crouch' | 'air' | 'climb' | 'slide' | 'swim' | 'wade' | 'zip';

/**
 * First-person character movement on top of Rapier's kinematic character
 * controller (KCC). The KCC resolves collisions, slides along walls, climbs
 * slopes up to a max angle, auto-steps stairs and snaps down to the ground.
 * This component layers game feel on top: acceleration, sprint, crouch,
 * variable-height jumps, coyote time, jump buffering and platform riding.
 *
 * Movement runs in `lateFixedUpdate`, right AFTER the physics step, and the
 * result is written straight to the body, so moving platforms are always
 * seen where they really are this tick.
 *
 * Rapier's KCC gets wedged (zero movement, max iterations) when touching
 * kinematic bodies that move, so it only ever sees static/dynamic geometry.
 * Moving platforms are handled here with our own sweep + slide:
 *
 *   1. ride:  if standing on a platform, move rigidly with it (its delta this tick)
 *   2. push:  if a platform moved into us, slide out of it
 *   3. move:  own motion through the KCC (world), then swept against platforms
 *
 * The entity's origin is at the player's FEET.
 */
export class PlayerController extends Component {
  order = 10;
  readonly cfg: PlayerTuning = { ...PlayerConfig };

  // Look (written by FirstPersonCamera every frame, read here every step)
  yaw = 0;
  pitch = 0;

  // Public state for camera / HUD / animation / audio
  readonly velocity = new THREE.Vector3();
  grounded = false;
  crouched = false;
  sprinting = false;
  state: MoveState = 'idle';
  groundCarrier: Carrier | null = null;
  private groundCarrierEntity: Entity | null = null;
  private landedOnPlatform = false;
  /** The ladder we're climbing, if any. */
  ladder: Ladder | null = null;
  /** The cable we're hanging from, if any. */
  zipline: Zipline | null = null;
  /** Position along the cable (0..1) and speed along it (m/s, + toward its far end). */
  zipT = 0;
  zipSpeed = 0;
  private zipCooldown = 0;
  private zipWanted = new THREE.Vector3();
  /** In water deep enough to swim. */
  swimming = false;
  /** How far the feet are below the water surface (0 when not in water). */
  waterDepth = 0;
  water: WaterVolume | null = null;
  private swimTime = 0;
  /** Hauling out of the water onto a ledge: scripted climb, not a jump. */
  mantling = false;
  private mantleTop = 0;
  private mantleTime = 0;
  private mantleOverTime = 0;
  private mantleDir = new THREE.Vector3();
  /** On a slope too steep to stand on: gravity drags us down it. */
  sliding = false;
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  /** Surface normal of the slope we're sliding on. */
  readonly slideNormal = new THREE.Vector3(0, 1, 0);
  private ladderCooldown = 0;

  /** Set by combat: weapon handling slows you (aiming, heavy weapons). 1 = normal. */
  speedScale = 1;
  /** A shove from outside (stepping into a swing, a blow, a blast): m/s added to walking, fading in a fraction of a second. */
  readonly knock = new THREE.Vector3();
  /** Set by combat: aiming down sights narrows the view. 1 = normal FOV. */
  fovScale = 1;
  spawnPoint = new THREE.Vector3();
  spawnYaw = 0;

  private rb!: RigidBodyComponent;
  private collider!: RAPIER.Collider;
  private kcc!: RAPIER.KinematicCharacterController;
  private coyoteTimer = 0;
  private jumpBufferTimer = 0;
  private jumping = false;
  private airTime = 0;

  onAttach(): void {
    this.rb = this.entity.require(RigidBodyComponent);
    this.collider = this.rb.colliders[0];
    const c = this.cfg;
    const kcc = this.game.physics.world.createCharacterController(c.skinWidth);
    kcc.setUp({ x: 0, y: 1, z: 0 });
    kcc.setMaxSlopeClimbAngle(c.maxSlopeClimbDeg * DEG);
    kcc.setMinSlopeSlideAngle(c.minSlopeSlideDeg * DEG);
    kcc.enableAutostep(c.stepHeight, c.stepMinWidth, false);
    kcc.enableSnapToGround(c.snapToGroundDistance);
    kcc.setSlideEnabled(true);
    kcc.setApplyImpulsesToDynamicBodies(true);
    kcc.setCharacterMass(c.pushMass);
    this.kcc = kcc;
    this.spawnPoint.copy(this.entity.object3d.position);
  }

  onDetach(): void {
    this.game.physics.world.removeCharacterController(this.kcc);
  }

  /** Capsule cylinder half-height for a total height. */
  static halfHeightFor(height: number, radius: number): number {
    return Math.max(0.01, (height - 2 * radius) / 2);
  }

  get feetPosition(): THREE.Vector3 {
    const t = this.rb.body.translation();
    return _feet.set(t.x, t.y, t.z);
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  get timeInAir(): number {
    return this.airTime;
  }

  /** Shove the player: `speed` m/s along `dir` (flattened), fading out over about a third of a second. */
  shove(dir: { x: number; z: number }, speed: number): void {
    const l = Math.hypot(dir.x, dir.z);
    if (l < 1e-4) return;
    this.knock.x += (dir.x / l) * speed;
    this.knock.z += (dir.z / l) * speed;
    const k = this.knock.length();
    if (k > 10) this.knock.multiplyScalar(10 / k);
  }

  respawn(): void {
    this.knock.set(0, 0, 0);
    this.placeAt(this.spawnPoint, this.spawnYaw, 0);
  }

  /** Put the player somewhere at rest, dropping any ladder / zipline / platform (respawn, loading a save). */
  placeAt(feet: THREE.Vector3, yaw: number, pitch: number): void {
    this.rb.teleport(feet);
    this.game.physics.world.propagateModifiedBodyPositionsToColliders();
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = pitch;
    this.ladder = null;
    this.mantling = false;
    this.zipline = null;
    this.setCarrier(null);
  }

  lateFixedUpdate(dt: number): void {
    const input = this.game.input;

    if (input.wasPressed('respawn') || this.feetPosition.y < -60) this.respawn();

    // --- 1. Ride: move rigidly with the platform under us ------------------
    if (this.groundCarrier && !this.jumping) {
      this.yaw += this.groundCarrier.yawDelta;
      this.groundCarrier.carryDelta(this.feetPosition, _vec);
      // Static geometry can block the ride (e.g. carried into a wall).
      this.moveBy(_vec);
    }

    // --- 2. Push: get out of any platform that moved into us ----------------
    const pushedBy = this.depenetrate(_push);
    if (pushedBy.size) {
      this.moveBy(_push);
      // Stop pressing into whatever shoved us.
      const n = _push.clone().normalize();
      const into = this.velocity.dot(n);
      if (into < 0) this.velocity.addScaledVector(n, -into);
    }

    // --- 3. Own movement ---------------------------------------------------
    this.updateZiplineGrab(dt);
    this.updateWater(dt);
    this.updateCrouch(input.isDown('crouch') && !this.swimming);
    this.updateLadder(dt);
    if (this.zipline) this.updateZipVelocity(dt);
    else if (this.ladder) this.updateClimbVelocity();
    else if (this.mantling) this.updateMantleVelocity(dt);
    else if (this.swimming) this.updateSwimVelocity(dt);
    else if (this.sliding) this.updateSlideVelocity(dt);
    else this.updateVelocity(dt);

    _vec.copy(this.velocity).multiplyScalar(dt);
    if (this.knock.lengthSq() > 0) {
      if (!this.ladder && !this.zipline && !this.mantling) _vec.addScaledVector(this.knock, dt);
      this.knock.multiplyScalar(Math.exp(-dt * 8));
      if (this.knock.lengthSq() < 0.01) this.knock.set(0, 0, 0);
    }
    this.landedOnPlatform = false;
    const p0 = this.feetPosition.clone();
    const kccMoved = this.moveBy(_vec);
    const kccGrounded = this.kcc.computedGrounded();
    this.collidePlatforms(kccMoved);
    this.liftOutOfPlatformBelow();
    const moved = this.feetPosition.clone().sub(p0);
    if (this.zipline && this.zipWanted.lengthSq() > 1e-6 && moved.dot(this.zipWanted) < this.zipWanted.lengthSq() * 0.4) {
      // Something's in the way (a wall, a post): let go.
      this.releaseZipline(false);
    }

    // Bumped head on a ceiling: kill upward velocity.
    if (this.velocity.y > 0.5 && moved.y < this.velocity.y * dt * 0.5) this.velocity.y = 0;

    // Blocked by a wall in the air: bleed velocity so it doesn't build up.
    // (On the ground the KCC needs the full desired motion to climb steps.)
    if (!this.grounded && !this.swimming) {
      const mx = moved.x / dt;
      const mz = moved.z / dt;
      if (Math.hypot(mx, mz) < this.horizontalSpeed - 0.01) {
        this.velocity.x = mx;
        this.velocity.z = mz;
      }
    }

    this.rb.syncFromBody();
    this.updateGroundState(dt, kccGrounded);
    if (this.ladder && this.grounded && this.velocity.y < 0) this.ladder = null; // climbed down to the floor
    if (this.zipline) {
      this.grounded = false;
      this.sliding = false;
      this.swimming = false;
      this.setCarrier(null);
      this.state = 'zip';
      return;
    }
    if (this.mantling) {
      const feet = this.feetPosition;
      if (this.grounded && feet.y >= this.mantleTop - 0.05) {
        this.mantling = false; // made it onto the ledge
      } else {
        this.grounded = false;
        this.sliding = false;
        this.state = 'climb';
      }
    }
    if (this.mantling) {
      // handled above
    } else if (this.ladder) {
      this.grounded = false;
      this.sliding = false;
      this.state = 'climb';
    } else if (this.swimming) {
      this.grounded = false;
      this.sliding = false;
      this.setCarrier(null);
      this.state = 'swim';
    } else if (this.grounded && this.waterDepth > 0.45 && this.state !== 'crouch') {
      this.state = 'wade';
    }
  }

  // --- Ziplines ----------------------------------------------------------------

  /** Grab a cable (from the interact key, or when jumping into one). */
  grabZipline(zip: Zipline): void {
    if (this.zipline === zip) return;
    if (this.zipline) this.releaseZipline(false);
    const hands = _tmp.copy(this.feetPosition).setY(this.feetPosition.y + this.cfg.zipHang);
    this.zipline = zip;
    this.zipT = zip.closestT(hands);
    // Keep the momentum we had along the cable.
    this.zipSpeed = this.velocity.dot(zip.dir);
    this.ladder = null;
    this.mantling = false;
    this.jumping = false;
    this.setCarrier(null);
    if (this.crouched && this.canStand()) this.setCrouched(false);
    this.kcc.disableSnapToGround();
  }

  private releaseZipline(jump: boolean): void {
    const zip = this.zipline;
    if (!zip) return;
    this.zipline = null;
    this.zipCooldown = 0.5;
    this.kcc.enableSnapToGround(this.cfg.snapToGroundDistance);
    this.velocity.copy(zip.dir).multiplyScalar(this.zipSpeed);
    if (jump) {
      this.velocity.y = Math.max(this.velocity.y, 0) + 3;
      this.jumping = true;
      this.game.events.emit('player:jumped', { position: this.feetPosition.clone() });
    } else {
      this.velocity.y = Math.min(this.velocity.y, 0);
    }
  }

  /** While airborne, catch any cable our hands pass close to. */
  private updateZiplineGrab(dt: number): void {
    this.zipCooldown = Math.max(0, this.zipCooldown - dt);
    if (this.zipline || this.zipCooldown > 0 || this.grounded || this.ladder || this.mantling || this.swimming) return;
    const hands = _feet.copy(this.feetPosition);
    hands.y += this.cfg.zipHang;
    for (const zip of Zipline.all) {
      if (zip.distanceTo(hands) < this.cfg.zipGrabRadius) {
        this.grabZipline(zip);
        return;
      }
    }
  }

  /**
   * Hanging from a cable: gravity pulls you along its slope (minus friction
   * and drag), W/S pull hand over hand where it's flat or uphill, Space lets
   * go keeping your momentum, and you drop off at the ends.
   */
  private updateZipVelocity(dt: number): void {
    const c = this.cfg;
    const zip = this.zipline!;
    const input = this.game.input;
    this.sprinting = false;
    this.jumpBufferTimer = 0;

    if (input.wasPressed('jump')) {
      this.releaseZipline(true);
      this.updateVelocity(dt);
      return;
    }

    let s = this.zipSpeed;
    s += -c.gravity * c.zipGravityScale * zip.dir.y * dt;
    // Hand over hand: push toward where we're looking along the cable.
    const axis = input.moveAxis();
    if (axis.y !== 0) {
      const look = -Math.sin(this.yaw) * zip.dir.x - Math.cos(this.yaw) * zip.dir.z;
      const want = Math.sign(look || 1) * axis.y * c.zipPullSpeed;
      if ((want > 0 && s < want) || (want < 0 && s > want)) s += Math.sign(want) * Math.min(Math.abs(want - s), 4 * dt);
    }
    {
      // Friction and air drag: on a slope these balance gravity at terminal velocity.
      const loss = (c.zipFriction + c.zipDrag * s * s) * dt;
      s = Math.abs(s) <= loss ? 0 : s - Math.sign(s) * loss;
    }
    s = THREE.MathUtils.clamp(s, -c.maxZipSpeed, c.maxZipSpeed);
    this.zipSpeed = s;

    let t = this.zipT + (s * dt) / zip.length;
    if (t >= 1 || t <= 0) {
      // Off the end: let go, carrying our speed.
      this.zipT = THREE.MathUtils.clamp(t, 0, 1);
      this.releaseZipline(false);
      return;
    }
    this.zipT = t;
    // Head for the hang point, easing in from wherever we grabbed.
    zip.pointAt(t, _target);
    _target.y -= c.zipHang;
    this.zipWanted.subVectors(_target, this.feetPosition);
    if (this.zipWanted.length() > 0.35 + Math.abs(s) * dt) this.zipWanted.setLength(0.35 + Math.abs(s) * dt);
    this.velocity.copy(this.zipWanted).divideScalar(dt);
  }

  // --- Water -------------------------------------------------------------------

  /** Work out whether we're swimming, wading or dry. */
  private updateWater(_dt: number): void {
    const c = this.cfg;
    const feet = this.feetPosition;
    const w = WaterVolume.at(feet);
    this.water = w;
    this.waterDepth = w ? Math.max(0, w.surfaceY - feet.y) : 0;
    const was = this.swimming;
    let swim = !!w && !this.ladder && !this.mantling && this.waterDepth > (was ? c.swimDepth - 0.3 : c.swimDepth);
    if (swim && this.waterDepth < c.floatDepth) {
      // Shallow enough to stand: if there's floor under us, wade instead.
      const probe = this.probeGround();
      if (probe.gap < 0.1 && probe.normalY >= Math.cos(c.maxSlopeClimbDeg * DEG)) swim = false;
    }
    this.swimming = swim;
    if (swim !== was) {
      // Ground snapping would pin a swimmer to the pool floor.
      if (swim) this.kcc.disableSnapToGround();
      else this.kcc.enableSnapToGround(c.snapToGroundDistance);
      if (swim) {
        this.jumping = false;
        this.sliding = false;
      }
      this.game.events.emit('player:swim', { swimming: swim });
    }
  }

  /**
   * Swimming: W/S move where you look (look down to dive), A/D strafe,
   * Space swims up, Ctrl/C swims down. Without vertical input you float at
   * the surface (treading water) or drift slowly up toward it. Swimming
   * into a low ledge at the surface hauls you out onto it.
   */
  private updateSwimVelocity(dt: number): void {
    const c = this.cfg;
    const input = this.game.input;
    const axis = input.moveAxis();
    const water = this.water!;
    this.jumpBufferTimer = 0;
    this.sprinting = input.isDown('sprint') && axis.y > 0;
    const speed = this.sprinting ? c.swimSprintSpeed : c.swimSpeed;

    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    // forward (with pitch) and right
    _wish.set(-sy * cp * axis.y + cy * axis.x, sp * axis.y, -cy * cp * axis.y - sy * axis.x);
    const upDown = (input.isDown('jump') ? 1 : 0) - (input.isDown('crouch') ? 1 : 0);
    _wish.y += upDown;
    if (_wish.lengthSq() > 1) _wish.normalize();
    _wish.multiplyScalar(speed);

    const floatError = this.waterDepth - c.floatDepth; // > 0: below float level
    const atSurface = floatError < 0.35;
    // Can't swim up out of the water: near the surface, upward drive is capped
    // by the float spring (so looking up + W just keeps you at the surface).
    if (atSurface) _wish.y = Math.min(_wish.y, Math.max(0, floatError * 3));
    if (upDown === 0 && Math.abs(sp * axis.y) < 0.35) {
      if (atSurface) {
        // Tread water: settle at float height with a gentle bob.
        this.swimTime += dt;
        const bob = 0.04 * Math.sin(this.swimTime * 2);
        _wish.y = THREE.MathUtils.clamp((floatError + bob) * 3, -2, 1.5);
      } else if (axis.y === 0 && axis.x === 0) {
        _wish.y = c.buoyancy;
      }
    }

    const jumpPressed = input.wasPressed('jump');
    if (atSurface && (axis.y > 0 || jumpPressed) && this.tryClimbOut(water)) return;

    // The current carries you: swim relative to the moving water.
    _wish.add(water.current);
    const rel = _tmp.subVectors(this.velocity, water.current);
    const k = rel.length() > c.swimSprintSpeed + 0.5 || this.velocity.y < -c.swimSpeed - 0.5 ? c.waterEntryDrag : c.swimResponse;
    this.velocity.lerp(_wish, 1 - Math.exp(-k * dt));
  }

  /** At the surface facing a low ledge: boost up and forward onto it. */
  private tryClimbOut(water: WaterVolume): boolean {
    const c = this.cfg;
    const feet = this.feetPosition;
    // A ladder right here takes priority (it's the intended way out).
    for (const ladder of Ladder.all) if (ladder.contains(feet, c.radius + 0.3)) return false;
    _h.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const reach = c.radius + 0.45;
    const topStart = water.surfaceY + c.climbOutHeight + 0.2;
    this.ray.origin = { x: feet.x + _h.x * reach, y: topStart, z: feet.z + _h.z * reach };
    this.ray.dir = { x: 0, y: -1, z: 0 };
    const hit = this.game.physics.world.castRayAndGetNormal(
      this.ray, c.climbOutHeight + 0.6, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, PLAYER_WORLD_QUERY, this.collider, this.rb.body,
    );
    if (!hit || hit.timeOfImpact < 0.05 || hit.normal.y < Math.cos(c.maxSlopeClimbDeg * DEG)) return false;
    const topY = topStart - hit.timeOfImpact;
    // Anything from a shallow shelf just under the surface up to climbOutHeight above it.
    if (topY - feet.y < 0.15) return false;
    // Room to stand up there?
    const half = PlayerController.halfHeightFor(c.standHeight, c.radius);
    const blocked = this.game.physics.world.intersectionWithShape(
      { x: this.ray.origin.x, y: topY + 0.06 + half + c.radius, z: this.ray.origin.z },
      IDENTITY_ROT,
      new RAPIER.Capsule(half, c.radius - 0.02),
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      this.collider,
      this.rb.body,
    );
    if (blocked) return false;
    this.startMantle(topY, _h);
    this.swimming = false;
    this.jumping = false;
    this.kcc.enableSnapToGround(c.snapToGroundDistance);
    this.game.events.emit('player:swim', { swimming: false });
    this.updateMantleVelocity(0);
    return true;
  }

  private startMantle(topY: number, dir: THREE.Vector3): void {
    this.mantling = true;
    this.mantleTop = topY;
    this.mantleTime = 0;
    this.mantleOverTime = 0;
    this.mantleDir.copy(dir).setY(0).normalize();
  }

  /**
   * Climb straight up the wall at a steady speed until the feet clear the
   * ledge, then step forward onto it. No ballistic launch, so no overshoot.
   */
  private updateMantleVelocity(dt: number): void {
    const c = this.cfg;
    this.mantleTime += dt;
    const feet = this.feetPosition;
    const d = this.mantleDir;
    this.jumpBufferTimer = 0;
    this.sprinting = false;
    if (this.mantleTime > 1.5) {
      // Something's in the way: give up and fall back.
      this.mantling = false;
      this.velocity.set(0, 0, 0);
      return;
    }
    const clearance = this.mantleTop + 0.1 - feet.y;
    if (clearance > 0) {
      // Up the wall, pressing lightly toward it; ease off near the top.
      const vy = Math.min(c.mantleSpeed, clearance * 12 + 0.5);
      this.velocity.set(d.x * 0.4, vy, d.z * 0.4);
    } else {
      // Level with the ledge: move forward over it, and settle down once the
      // ledge is right under our centre (not just under the capsule's edge).
      this.ray.origin = { x: feet.x, y: feet.y + 0.05, z: feet.z };
      this.ray.dir = { x: 0, y: -1, z: 0 };
      const below = this.game.physics.world.castRayAndGetNormal(
        this.ray, 0.4, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, PLAYER_WORLD_QUERY, this.collider, this.rb.body,
      );
      this.mantleOverTime += dt;
      const over = (!!below && below.normal.y >= Math.cos(c.maxSlopeClimbDeg * DEG)) || this.mantleOverTime > 0.35;
      this.velocity.set(d.x * 2.5, over ? -2 : 0, d.z * 2.5);
    }
  }

  // --- Steep slopes ------------------------------------------------------------

  /**
   * On a slope steeper than we can stand on: gravity pulls us down along the
   * surface, input only steers sideways (never uphill), and Space hops off
   * away from the slope rather than up it, so it can't be climbed by jumping.
   */
  private updateSlideVelocity(dt: number): void {
    const c = this.cfg;
    const input = this.game.input;
    const n = this.slideNormal;
    const v = this.velocity;
    this.sprinting = false;
    this.jumpBufferTimer = 0;
    this.coyoteTimer = 0;

    // Downhill direction on the ground plane.
    _h.set(n.x, 0, n.z);
    if (_h.lengthSq() > 1e-8) _h.normalize();

    if (input.wasPressed('jump')) {
      const up = Math.sqrt(2 * c.gravity * c.jumpHeight) * 0.75;
      v.addScaledVector(_h, 3);
      v.y = Math.max(v.y, 0) + up;
      this.jumping = true;
      this.sliding = false;
      this.game.events.emit('player:jumped', { position: this.feetPosition.clone() });
      return;
    }

    // No motion into the surface.
    const into = v.dot(n);
    if (into < 0) v.addScaledVector(n, -into);

    // Gravity's component along the slope.
    const g = c.gravity * c.slideGravityScale;
    v.x += g * n.y * n.x * dt;
    v.y += -g * (1 - n.y * n.y) * dt;
    v.z += g * n.y * n.z * dt;

    // Steering: input along the slope, minus anything uphill.
    const axis = input.moveAxis();
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    _tmp.set(-sin * axis.y + cos * axis.x, 0, -cos * axis.y - sin * axis.x);
    if (_tmp.lengthSq() > 1e-6) {
      _tmp.normalize();
      const uphill = -_tmp.dot(_h);
      if (uphill > 0) _tmp.addScaledVector(_h, uphill);
      v.addScaledVector(_tmp, c.slideSteerAccel * dt);
    }

    v.multiplyScalar(Math.max(0, 1 - c.slideFriction * dt));
    if (v.length() > c.maxSlideSpeed) v.setLength(c.maxSlideSpeed);
    // Lean into the surface a little so we stay in contact over bumps.
    v.addScaledVector(n, -0.5);
  }

  /** Normal of the surface straight below the feet, if it's a too-steep slope we're resting on. */
  private steepSlopeBelow(probe: { gap: number; normalY: number }, out: THREE.Vector3): boolean {
    const c = this.cfg;
    const standCos = Math.cos((c.maxSlopeClimbDeg + 2) * DEG);
    // Must be touching something steep (but not a wall)...
    if (probe.gap > 0.15 || probe.normalY >= standCos || probe.normalY < 0.17) return false;
    // ...and the ground right under our centre must be steep too, so standing
    // on the edge of a box (where the probe hits the corner) doesn't count.
    const feet = this.feetPosition;
    this.ray.origin = { x: feet.x, y: feet.y + 0.1, z: feet.z };
    const hit = this.game.physics.world.castRayAndGetNormal(
      this.ray,
      1.3,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      this.collider,
      this.rb.body,
    );
    if (!hit || hit.normal.y >= standCos || hit.normal.y < 0.17) return false;
    out.set(hit.normal.x, hit.normal.y, hit.normal.z).normalize();
    return true;
  }

  // --- Ladders ---------------------------------------------------------------

  /** Grab, keep or let go of a ladder. */
  private updateLadder(dt: number): void {
    const input = this.game.input;
    this.ladderCooldown = Math.max(0, this.ladderCooldown - dt);
    const feet = this.feetPosition;
    const r = this.cfg.radius;

    if (this.ladder) {
      if (!this.ladder.contains(feet, r)) {
        this.ladder = null;
      } else if (input.wasPressed('jump')) {
        // Kick off the ladder, away from the wall.
        const n = this.ladder.normal;
        this.velocity.set(n.x * 4, 3.5, n.z * 4);
        this.ladder = null;
        this.ladderCooldown = 0.4;
        this.jumping = true;
        this.game.events.emit('player:jumped', { position: feet.clone() });
      }
      return;
    }
    if (this.ladderCooldown > 0 || this.mantling) return;

    const axis = input.moveAxis();
    // Forward direction on the ground plane.
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    for (const ladder of Ladder.all) {
      if (!ladder.contains(feet, r)) continue;
      const n = ladder.normal;
      const facing = -(fx * n.x + fz * n.z); // 1 = looking straight at the ladder
      const walkingInto = axis.y > 0 && facing > 0.35;
      // Falling past a ladder while facing it (e.g. stepping backwards off the
      // top) grabs it too. Walking forwards off the top doesn't.
      const fallingPast = !this.grounded && this.velocity.y < -1 && !this.jumping && facing > 0;
      if (walkingInto || fallingPast) {
        this.ladder = ladder;
        this.setCarrier(null);
        this.velocity.set(0, 0, 0);
        return;
      }
    }
  }

  /** On a ladder: W/S climb (look down to make W go down), A/D shuffle sideways, no gravity. */
  private updateClimbVelocity(): void {
    const c = this.cfg;
    const ladder = this.ladder!;
    const axis = this.game.input.moveAxis();
    const n = ladder.normal;
    const lookingDown = this.pitch < -0.6;
    const climb = axis.y * (lookingDown ? -1 : 1) * c.climbSpeed;
    // Ladder's right axis on the ground plane.
    const rx = n.z;
    const rz = -n.x;
    const side = axis.x * c.climbSpeed * 0.5;
    // Hold a fixed distance from the wall: settle there quickly after grabbing,
    // then stay put. (Constantly pushing into the wall made the capsule creep
    // and slide up over the top edge on its own.)
    const local = ladder.toLocal(this.feetPosition);
    const holdDistance = c.radius + 0.12;
    let inward = THREE.MathUtils.clamp((local.z - holdDistance) * 12, -3, 3);
    if (climb > 0 && local.y > ladder.height - 0.15) {
      // Reached the top: hand over to the same steady climb-over used when
      // hauling out of water (no pop above the ledge).
      this.startMantle(ladder.entity.object3d.position.y + ladder.height, _h.set(-n.x, 0, -n.z));
      this.ladder = null;
      this.ladderCooldown = 0.4;
      this.updateMantleVelocity(0);
      return;
    }
    this.velocity.set(rx * side - n.x * inward, climb, rz * side - n.z * inward);
    this.jumping = false;
    this.sprinting = false;
  }


  // -------------------------------------------------------------------------

  /**
   * Move the capsule by `delta` through Rapier's KCC against the static and
   * dynamic world (never moving platforms), applying the result immediately.
   */
  private moveBy(delta: THREE.Vector3, ignoreColliders?: Set<number>): THREE.Vector3 {
    const filter = ignoreColliders?.size ? (col: RAPIER.Collider) => !ignoreColliders.has(col.handle) : undefined;
    this.kcc.computeColliderMovement(this.collider, delta, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, PLAYER_WORLD_QUERY, filter);
    const m = this.kcc.computedMovement();
    _moved.set(m.x, m.y, m.z);
    this.translate(_moved);
    return _moved;
  }

  private translate(d: THREE.Vector3): void {
    const t = this.rb.body.translation();
    const next = { x: t.x + d.x, y: t.y + d.y, z: t.z + d.z };
    this.rb.body.setTranslation(next, true);
    this.rb.body.setNextKinematicTranslation(next);
    this.game.physics.world.propagateModifiedBodyPositionsToColliders();
  }

  /**
   * Sweep the capsule from `from` along `delta` against moving platforms only.
   * A cast starting within skin distance of a surface reports an immediate hit
   * even when moving away from it; such "hits" are skipped, otherwise the
   * capsule would stick to any platform it touches.
   */
  private castPlatforms(from: { x: number; y: number; z: number }, delta: THREE.Vector3): RAPIER.ColliderShapeCastHit | null {
    if (delta.lengthSq() < 1e-12) return null;
    const skip = new Set<number>();
    const shape = new RAPIER.Capsule(this.collider.halfHeight(), this.cfg.radius);
    for (let i = 0; i < 4; i++) {
      const hit = this.game.physics.world.castShape(
        from,
        this.collider.rotation(),
        { x: delta.x, y: delta.y, z: delta.z },
        shape,
        this.cfg.skinWidth,
        1,
        false,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        PLAYER_PLATFORM_QUERY,
        this.collider,
        this.rb.body,
        skip.size ? (col) => !skip.has(col.handle) : undefined,
      );
      if (!hit) return null;
      // normal1 is the platform's outward surface normal at the hit.
      const approach = -(delta.x * hit.normal1.x + delta.y * hit.normal1.y + delta.z * hit.normal1.z);
      if (approach > 1e-7) return hit;
      skip.add(hit.collider.handle);
    }
    return null;
  }

  /**
   * Re-trace the move the KCC just made (which ignored platforms) against
   * moving platforms: stop at a platform, slide along it, and step up onto
   * low ones. Returns the platform motion actually applied relative to `moved`.
   */
  private collidePlatforms(moved: THREE.Vector3): void {
    const c = this.cfg;
    // Rewind the KCC move, then replay it piecewise against platforms.
    _rest.copy(moved);
    this.translate(_tmp.copy(moved).negate());
    for (let iter = 0; iter < 3 && _rest.lengthSq() > 1e-10; iter++) {
      const start = this.collider.translation();
      const hit = this.castPlatforms(start, _rest);
      if (!hit) {
        this.translate(_rest);
        return;
      }
      const t = hit.time_of_impact;
      this.translate(_tmp.copy(_rest).multiplyScalar(t));
      _rest.multiplyScalar(1 - t);
      // Platform surface normal (points from the platform toward us).
      _n.set(hit.normal1.x, hit.normal1.y, hit.normal1.z).normalize();
      if (Math.abs(_n.y) < 0.3 && this.tryStepUp(_rest)) return;
      // Slide: drop the part of the remaining motion that goes into the platform.
      const into = _rest.dot(_n);
      if (into < 0) _rest.addScaledVector(_n, -into);
      if (_n.y >= Math.cos((c.maxSlopeClimbDeg + 2) * DEG)) this.landedOnPlatform = true;
    }
  }

  /** Try to climb onto a platform edge no taller than the step height. */
  private tryStepUp(rest: THREE.Vector3): boolean {
    if (!this.grounded) return false;
    const c = this.cfg;
    _h.set(rest.x, 0, rest.z);
    if (_h.lengthSq() < 1e-8) return false;
    _h.setLength(Math.max(_h.length(), c.radius * 0.5));
    const p0 = this.collider.translation();
    const up = _tmp.set(0, c.stepHeight, 0);
    if (this.castPlatforms(p0, up) || this.blockedByWorld(p0, up)) return false;
    const p1 = { x: p0.x, y: p0.y + c.stepHeight, z: p0.z };
    if (this.castPlatforms(p1, _h) || this.blockedByWorld(p1, _h)) return false;
    const p2 = { x: p1.x + _h.x, y: p1.y, z: p1.z + _h.z };
    const downHit = this.castPlatforms(p2, _tmp.set(0, -c.stepHeight, 0));
    if (!downHit || downHit.normal1.y < Math.cos(c.maxSlopeClimbDeg * DEG)) return false;
    const drop = c.stepHeight * downHit.time_of_impact;
    this.translate(_tmp.set(_h.x, c.stepHeight - drop, _h.z));
    rest.set(0, 0, 0);
    this.landedOnPlatform = true;
    return true;
  }

  private blockedByWorld(from: { x: number; y: number; z: number }, delta: THREE.Vector3): boolean {
    const hit = this.game.physics.world.castShape(
      from,
      this.collider.rotation(),
      { x: delta.x, y: delta.y, z: delta.z },
      new RAPIER.Capsule(this.collider.halfHeight(), this.cfg.radius),
      this.cfg.skinWidth,
      1,
      false,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      PLAYER_WORLD_QUERY,
      this.collider,
      this.rb.body,
    );
    return hit !== null;
  }

  /**
   * Kinematic bodies don't push kinematic characters on their own. Find any
   * moving platform we now overlap and return the smallest displacement that
   * separates us, plus the colliders involved (ignored while we slide out).
   */
  private depenetrate(out: THREE.Vector3): Set<number> {
    out.set(0, 0, 0);
    const hits = new Set<number>();
    const world = this.game.physics.world;
    const skin = this.cfg.skinWidth;
    world.intersectionsWithShape(
      this.collider.translation(),
      this.collider.rotation(),
      new RAPIER.Capsule(this.collider.halfHeight(), this.cfg.radius),
      (other) => {
        if (this.groundCarrierEntity && this.game.physics.ownerOf(other) === this.groundCarrierEntity) return true;
        const contact = this.collider.contactCollider(other, 0);
        if (!contact || contact.distance >= 0) return true;
        // normal1 points from us toward the platform; move the other way.
        const depth = -contact.distance + skin;
        out.x -= contact.normal1.x * depth;
        out.y -= contact.normal1.y * depth;
        out.z -= contact.normal1.z * depth;
        hits.add(other.handle);
        return true;
      },
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      PLAYER_PLATFORM_QUERY,
      this.collider,
      this.rb.body,
    );
    if (out.lengthSq() > 1) out.setLength(1); // never teleport far in one tick
    return hits;
  }

  /**
   * The KCC only sees static geometry, so walking off a ledge onto a flush
   * platform lets the capsule roll down around the ledge corner into the
   * platform. Pop back up onto any platform we've sunk into from above,
   * including the one we're riding (depenetrate() skips that one).
   */
  private liftOutOfPlatformBelow(): void {
    let up = 0;
    const minNormalY = Math.cos((this.cfg.maxSlopeClimbDeg + 2) * DEG);
    this.game.physics.world.intersectionsWithShape(
      this.collider.translation(),
      this.collider.rotation(),
      new RAPIER.Capsule(this.collider.halfHeight(), this.cfg.radius),
      (other) => {
        const contact = this.collider.contactCollider(other, 0);
        // normal1 points from us toward the platform: down means it's under us.
        if (!contact || contact.distance >= -1e-4 || -contact.normal1.y < minNormalY) return true;
        up = Math.max(up, -contact.distance / -contact.normal1.y);
        return true;
      },
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      PLAYER_PLATFORM_QUERY,
      this.collider,
      this.rb.body,
    );
    if (up > 0) {
      this.moveBy(_tmp.set(0, Math.min(up + this.cfg.skinWidth * 0.5, 0.5), 0));
      this.landedOnPlatform = true;
    }
  }

  private updateCrouch(wantCrouch: boolean): void {
    if (wantCrouch && !this.crouched) this.setCrouched(true);
    else if (!wantCrouch && this.crouched && this.canStand()) this.setCrouched(false);
  }

  /** Input -> velocity: acceleration, sprint, jump (with buffer + coyote time), gravity. */
  private updateVelocity(dt: number): void {
    const c = this.cfg;
    const input = this.game.input;

    if (input.wasPressed('jump')) this.jumpBufferTimer = c.jumpBufferTime;
    else this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt);
    this.coyoteTimer = this.grounded ? c.coyoteTime : Math.max(0, this.coyoteTimer - dt);

    const axis = input.moveAxis();
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // forward = (-sin, 0, -cos), right = (cos, 0, -sin)
    _wish.set(-sin * axis.y + cos * axis.x, 0, -cos * axis.y - sin * axis.x);
    if (_wish.lengthSq() > 1) _wish.normalize();
    const hasInput = _wish.lengthSq() > 0 || (this.water !== null && this.water.current.lengthSq() > 0 && this.waterDepth > 0.2);

    this.sprinting = !this.crouched && input.isDown('sprint') && axis.y > 0;
    let speed = this.crouched ? c.crouchSpeed : this.sprinting ? c.sprintSpeed : c.walkSpeed;
    if (axis.y < 0) speed *= c.backwardsMultiplier;
    speed *= this.speedScale;
    if (this.waterDepth > 0.45) {
      speed *= c.wadeSpeedFactor;
      this.sprinting = false;
    }
    _target.copy(_wish).multiplyScalar(speed);
    if (this.grounded && this.water && this.waterDepth > 0.2) {
      // Wading in a river: the deeper you are, the harder it pushes.
      const push = Math.min(1, this.waterDepth / c.swimDepth) * c.wadeCurrentFactor;
      _target.x += this.water.current.x * push;
      _target.z += this.water.current.z * push;
    }

    if (this.grounded) {
      this.moveTowardsXZ(_target, (hasInput ? c.groundAccel : c.groundDecel) * dt);
    } else if (hasInput) {
      // Air control: steer toward the wish direction but keep existing momentum.
      _target.multiplyScalar(c.airMaxSpeedFactor);
      const before = this.horizontalSpeed;
      this.moveTowardsXZ(_target, c.airAccel * dt);
      const cap = Math.max(before, _target.length());
      const now = this.horizontalSpeed;
      if (now > cap) {
        this.velocity.x *= cap / now;
        this.velocity.z *= cap / now;
      }
    }

    if (this.grounded && this.velocity.y < 0) this.velocity.y = -1; // keep contact

    if (this.jumpBufferTimer > 0 && (this.grounded || this.coyoteTimer > 0)) {
      this.velocity.y = Math.sqrt(2 * c.gravity * c.jumpHeight);
      if (this.groundCarrier) {
        // Inherit the platform's motion so jumping off a moving lift feels right.
        const v = this.groundCarrier.velocity;
        this.velocity.x += v.x;
        this.velocity.z += v.z;
        this.velocity.y += Math.max(0, v.y);
      }
      this.jumpBufferTimer = 0;
      this.coyoteTimer = 0;
      this.jumping = true;
      this.grounded = false;
      this.setCarrier(null);
      this.game.events.emit('player:jumped', { position: this.feetPosition.clone() });
    }

    let g = c.gravity;
    if (this.velocity.y < 0) g *= c.fallGravityMultiplier;
    else if (this.jumping && !input.isDown('jump')) g *= c.jumpCutGravityMultiplier;
    this.velocity.y = Math.max(-c.maxFallSpeed, this.velocity.y - g * dt);
  }

  private updateGroundState(dt: number, kccGrounded: boolean): void {
    if (this.landedOnPlatform && this.velocity.y < 0) this.velocity.y = -1;
    const c = this.cfg;
    const wasGrounded = this.grounded;
    const probe = this.probeGround();
    const falling = this.velocity.y <= 0;
    const near = probe.gap < 0.08;
    const walkable = probe.normalY >= Math.cos((c.maxSlopeClimbDeg + 2) * DEG);
    this.grounded = falling && (kccGrounded || this.landedOnPlatform || (near && walkable));
    this.sliding = !this.ladder && (falling || this.sliding) && !(near && walkable) && this.steepSlopeBelow(probe, this.slideNormal);
    if (this.sliding) {
      this.grounded = false;
      this.jumping = false;
    }

    // Ride whatever platform our feet rest on (an edge counts while we're on it).
    const platform = this.grounded && near ? (probe.owner?.get(MovingPlatform) ?? null) : null;
    this.setCarrier(platform ? probe.owner : null);

    if (this.grounded) {
      if (!wasGrounded) {
        this.game.events.emit('player:landed', { fallSpeed: Math.max(0, -this.velocity.y) });
      }
      this.jumping = false;
      this.airTime = 0;
    } else {
      this.airTime += dt;
    }

    this.state = this.sliding
      ? 'slide'
      : !this.grounded
      ? 'air'
      : this.crouched
        ? 'crouch'
        : this.horizontalSpeed < 0.1
          ? 'idle'
          : this.sprinting
            ? 'sprint'
            : 'walk';
  }

  private setCarrier(entity: Entity | null): void {
    this.groundCarrierEntity = entity;
    this.groundCarrier = entity?.get(MovingPlatform) ?? null;
  }

  private moveTowardsXZ(target: THREE.Vector3, maxDelta: number): void {
    const dx = target.x - this.velocity.x;
    const dz = target.z - this.velocity.z;
    const len = Math.hypot(dx, dz);
    if (len <= maxDelta || len === 0) {
      this.velocity.x = target.x;
      this.velocity.z = target.z;
    } else {
      this.velocity.x += (dx / len) * maxDelta;
      this.velocity.z += (dz / len) * maxDelta;
    }
  }

  private setCrouched(crouched: boolean): void {
    const c = this.cfg;
    const h = PlayerController.halfHeightFor(crouched ? c.crouchHeight : c.standHeight, c.radius);
    this.collider.setHalfHeight(h);
    this.collider.setTranslationWrtParent({ x: 0, y: h + c.radius, z: 0 });
    this.crouched = crouched;
    this.game.events.emit('player:crouch', { crouched });
  }

  /** Is there head-room to stand up? */
  private canStand(): boolean {
    const c = this.cfg;
    const h = PlayerController.halfHeightFor(c.standHeight, c.radius);
    const feet = this.feetPosition;
    const shape = new RAPIER.Capsule(h, c.radius - 0.02);
    const hit = this.game.physics.world.intersectionWithShape(
      { x: feet.x, y: feet.y + h + c.radius + 0.05, z: feet.z },
      IDENTITY_ROT,
      shape,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      this.collider,
      this.rb.body,
    );
    return hit === null;
  }

  /**
   * Sweep a ball (slightly narrower than the capsule) down from the bottom of
   * the capsule. Unlike a single centre ray this still finds the ground while
   * we stand on an edge, and it never touches walls we're leaning against.
   */
  private probeGround(): { collider: RAPIER.Collider | null; owner: Entity | null; gap: number; normalY: number } {
    const r = this.cfg.radius;
    const ballR = r * 0.9;
    const lift = 0.05;
    const feet = this.feetPosition;
    const start = { x: feet.x, y: feet.y + r + lift, z: feet.z };
    const hit = this.game.physics.world.castShape(
      start,
      IDENTITY_ROT,
      { x: 0, y: -1, z: 0 },
      new RAPIER.Ball(ballR),
      0,
      lift + (r - ballR) + 0.3,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      this.collider,
      this.rb.body,
    );
    if (!hit) return { collider: null, owner: null, gap: Infinity, normalY: 0 };
    const gap = hit.time_of_impact - lift - (r - ballR);
    return {
      collider: hit.collider,
      owner: this.game.physics.ownerOf(hit.collider) ?? null,
      gap,
      normalY: hit.normal1.y, // surface normal of what we hit
    };
  }
}
