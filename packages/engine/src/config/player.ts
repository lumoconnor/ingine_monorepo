/**
 * All player movement tunables in one place. Units: metres, seconds, degrees.
 * Tweak these live from the browser console via `window.game` (see main.ts).
 */
export const PlayerConfig = {
  // Body
  radius: 0.35,
  standHeight: 1.8,
  crouchHeight: 1.1,
  /** Eye height measured from the feet. */
  standEyeHeight: 1.65,
  crouchEyeHeight: 0.95,
  /** Seconds to blend the camera between stand and crouch eye heights. */
  crouchTransitionTime: 0.12,

  // Speeds (m/s)
  walkSpeed: 4.5,
  sprintSpeed: 7.5,
  crouchSpeed: 2.2,
  climbSpeed: 3.0,
  /** Backpedal speed multiplier. */
  backwardsMultiplier: 0.75,

  // Acceleration (m/s^2)
  groundAccel: 50,
  groundDecel: 40,
  airAccel: 10,
  /** Fraction of the wish-direction speed achievable in air control. */
  airMaxSpeedFactor: 1.0,

  // Vertical
  gravity: 24,
  /** Apex height of a standing jump (m). */
  jumpHeight: 1.25,
  /** Extra gravity multiplier when falling, for a less floaty arc. */
  fallGravityMultiplier: 1.35,
  /** Shortened jump when Space is released early (multiplier on gravity while rising). */
  jumpCutGravityMultiplier: 2.0,
  maxFallSpeed: 55,
  /** Grace period to still jump after walking off a ledge. */
  coyoteTime: 0.12,
  /** Remember a jump press this long before landing. */
  jumpBufferTime: 0.12,

  // Terrain handling (Rapier character controller)
  maxSlopeClimbDeg: 46,
  minSlopeSlideDeg: 50,
  /** Max height of a step the player walks up without jumping. */
  stepHeight: 0.42,
  stepMinWidth: 0.15,
  snapToGroundDistance: 0.35,

  // Sliding on slopes steeper than maxSlopeClimbDeg
  /** Fraction of gravity that pulls you down a slope (1 = frictionless ice). */
  slideGravityScale: 0.9,
  /** Velocity damping per second while sliding. */
  slideFriction: 0.35,
  /** Sideways steering while sliding (m/s^2). Can never push you uphill. */
  slideSteerAccel: 7,
  maxSlideSpeed: 16,
  /** Small gap the controller keeps from obstacles. */
  skinWidth: 0.02,
  /** Mass used when pushing dynamic bodies (crates). */
  pushMass: 80,

  // Water
  /** Feet this far below the surface (m) and you start swimming. */
  swimDepth: 1.15,
  /** Where you float when treading water: feet this far below the surface (eyes just above it). */
  floatDepth: 1.4,
  swimSpeed: 3.2,
  swimSprintSpeed: 5.2,
  /** How quickly swim velocity follows input (1/s). Higher = snappier, lower = floatier. */
  swimResponse: 4,
  /** Extra drag (1/s) when plunging in fast, e.g. diving from a height. */
  waterEntryDrag: 9,
  /** Slow drift up toward the surface when idle underwater (m/s). */
  buoyancy: 1.0,
  /** Walking speed multiplier in water deeper than your knees. */
  wadeSpeedFactor: 0.65,
  /** Fraction of a river's current that pushes you while wading (scaled by depth). */
  wadeCurrentFactor: 0.6,
  /** Highest ledge above the surface you can haul yourself onto from the water. */
  climbOutHeight: 1.1,
  /** How fast you haul yourself up out of the water (m/s). */
  mantleSpeed: 4.0,

  // Ziplines
  /** Feet hang this far below the cable (hands just above the head). */
  zipHang: 2.05,
  /** Fraction of gravity that pulls you along a sloped cable. */
  zipGravityScale: 0.8,
  /** Rolling friction (m/s^2) and air drag (per m/s, per second). */
  zipFriction: 0.5,
  zipDrag: 0.012,
  maxZipSpeed: 14,
  /** Hand-over-hand pulling speed on flat or uphill cable (m/s). */
  zipPullSpeed: 1.8,
  /** Auto-grab when your hands pass within this distance of a cable while airborne. */
  zipGrabRadius: 0.5,

  // Camera
  fovDeg: 75,
  sprintFovBoostDeg: 6,
  headBobAmplitude: 0.045,
  headBobFrequency: 1.9,
  /** Camera dip on landing: how far the view drops per m/s of fall speed above landingDipMinSpeed (m), clamped. */
  landingDipScale: 0.016,
  landingDipMinSpeed: 3,
  maxLandingDip: 0.3,
  /** The view also nods down by this many radians per metre of dip. */
  landingDipPitch: 0.3,
  pitchLimitDeg: 89,
};

export type PlayerTuning = typeof PlayerConfig;
