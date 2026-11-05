/** Frame timing info passed to every update. */
export interface FrameTime {
  /** Seconds since last rendered frame (clamped). */
  delta: number;
  /** Total seconds since the game started. */
  elapsed: number;
  /** Interpolation factor [0,1) between the last two fixed steps. */
  alpha: number;
}

/** Fixed simulation step. Physics & gameplay run at this rate regardless of display refresh. */
export const FIXED_DT = 1 / 60;
/** Never simulate more than this many fixed steps per frame (avoids the spiral of death). */
export const MAX_STEPS_PER_FRAME = 5;
