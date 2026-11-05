/**
 * Combat tunables for the player. Tone: grounded and lethal (few hits to
 * kill, falls hurt). Weapons are data: items.json (weapon blocks) and
 * content/combat/unarmed.json for bare hands.
 */
export const CombatConfig = {
  player: {
    maxHealth: 100,
    /** Seconds on the "You died" screen before waking up at the spawn point. */
    deathTime: 2.5,
  },
  /**
   * Falls: drops up to safeHeight are free; damage then grows linearly with
   * the height fallen, to a full-health hit at lethalHeight (metres). Height
   * is worked out from the landing speed and the player's falling gravity.
   */
  fall: {
    safeHeight: 4,
    lethalHeight: 16,
  },
};
