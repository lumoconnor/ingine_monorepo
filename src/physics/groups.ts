/**
 * Rapier collision groups: 16-bit "member of" mask in the high half, 16-bit
 * "collides with" mask in the low half. Most colliders keep the default
 * (member of everything, collide with everything).
 */
export const Layer = {
  platform: 1 << 1,
  player: 1 << 2,
  /** Things you can aim at but never bump into (zipline ropes). */
  interactOnly: 1 << 3,
  /** Combat hit zones (sensors). Only combat traces see them. */
  hurtbox: 1 << 4,
} as const;

export const groups = (memberships: number, filter: number): number => ((memberships & 0xffff) << 16) | (filter & 0xffff);

/** Moving platforms: their own layer, still collide with everything (crates etc). */
export const PLATFORM_GROUPS = groups(Layer.platform, 0xffff);
/** Character-controller queries: everything except moving platforms. */
export const PLAYER_WORLD_QUERY = groups(Layer.player, 0xffff & ~Layer.platform);
/** Queries against moving platforms only. */
export const PLAYER_PLATFORM_QUERY = groups(Layer.player, Layer.platform);
/** Only found by unfiltered queries (the interaction ray); invisible to the character controller. */
export const INTERACT_ONLY_GROUPS = groups(Layer.interactOnly, Layer.interactOnly);
/** Hurtbox sensors: only found by HURTBOX_QUERY (every other query excludes sensors anyway). */
export const HURTBOX_GROUPS = groups(Layer.hurtbox, Layer.hurtbox);
/** Combat traces looking for hit zones. */
export const HURTBOX_QUERY = groups(Layer.hurtbox, Layer.hurtbox);
