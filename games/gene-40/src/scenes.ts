/**
 * Every place in Gene's world. They all live in one big map, far enough apart
 * (600 m, past the fog) that you can't see one from another and voices don't
 * carry between them (voice range is 30 m). Teleport pads move you between
 * them, so multiplayer and voice keep working with no level loading.
 */
export type Vec3 = [number, number, number];

export interface SceneDef {
  id: string;
  /** Shown on the hub portal and when you arrive. */
  name: string;
  /** One line under the name on the portal. */
  blurb: string;
  /** Portal and theme colour. */
  color: number;
  /** Centre of the scene's ground, in world space. */
  origin: Vec3;
  /** False until its milestone is built: the scene shows a "coming soon" island. */
  built: boolean;
}

const at = (i: number): Vec3 => [600 * i, 0, 0];

export const HUB: SceneDef = { id: 'hub', name: 'Party plaza', blurb: 'The hub', color: 0xffc94a, origin: [0, 0, 0], built: true };

/** In portal order, clockwise around the plaza starting north. */
export const SCENES: SceneDef[] = [
  { id: 'axes', name: 'Axe throwing', blurb: 'Five throws. Beat your best.', color: 0xc8553d, origin: at(1), built: true },
  { id: 'arup', name: 'Arup office', blurb: 'Say hi to the team', color: 0xe61e2b, origin: at(2), built: true },
  { id: 'murph', name: 'Murph Land', blurb: 'A cat paradise for Murphy', color: 0xf2a541, origin: at(3), built: true },
  { id: 'stars', name: 'Star islands', blurb: 'Jump for the stars', color: 0x4fb3ff, origin: at(4), built: false },
  { id: 'heroes', name: 'Hero city', blurb: 'Grab a power, save the day', color: 0x7b5cff, origin: at(5), built: false },
  { id: 'buddies', name: 'Buddies park', blurb: 'Dogs, a ball and a treehouse', color: 0x5cbf6a, origin: at(6), built: false },
  { id: 'ballpark', name: 'Ballpark', blurb: 'Grab a bat and swing away', color: 0x1d4fa3, origin: at(8), built: false },
  { id: 'hoops', name: 'Hoops court', blurb: 'Shoot some buckets', color: 0xce1141, origin: at(9), built: false },
  { id: 'tattoo', name: 'Tattoo parlour', blurb: 'Pick some ink', color: 0x2f2f3a, origin: at(7), built: false },
];

export const ALL_SCENES = [HUB, ...SCENES];

export function sceneById(id: string): SceneDef | undefined {
  return ALL_SCENES.find((s) => s.id === id);
}

/** The scene whose area contains a world position (nearest origin). */
export function sceneAt(x: number, z: number): SceneDef {
  let best = HUB;
  let bestD = Infinity;
  for (const s of ALL_SCENES) {
    const d = (s.origin[0] - x) ** 2 + (s.origin[2] - z) ** 2;
    if (d < bestD) (best = s), (bestD = d);
  }
  return best;
}

/** Yaw (radians) that faces from one point toward another; 0 faces -Z. */
export function yawToward(from: Vec3, to: Vec3): number {
  return Math.atan2(-(to[0] - from[0]), -(to[2] - from[2]));
}
