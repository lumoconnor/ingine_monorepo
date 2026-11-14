import * as THREE from 'three';
import type { Game } from '@ingine/engine/core/Game';
import type { Level } from '@ingine/engine/world/Level';
import { createPlayer } from '@ingine/engine/gameplay/player/createPlayer';
import type { Teleports } from './Teleports';
import { SCENES } from './scenes';
import { buildHub, buildPlaceholder } from './scenes/hub';
import { buildAxes } from './scenes/axes';
import { buildArup } from './scenes/arup';
import { buildMurph } from './scenes/murph';

/** Each built scene registers a builder here; the rest get a "coming soon" island. */
const builders: Record<string, (game: Game, teleports: Teleports, index: number) => void> = {
  axes: buildAxes,
  arup: buildArup,
  murph: buildMurph,
};

/**
 * Gene's whole world in one map: the party plaza at the origin and every
 * scene 600 m apart along +X (see scenes.ts).
 */
export class GeneWorld implements Level {
  readonly name = "Gene's 40th";

  constructor(private teleports: Teleports) {}

  load(game: Game): void {
    buildHub(game, this.teleports);
    SCENES.forEach((s, i) => (builders[s.id] ?? ((g, t, n) => buildPlaceholder(g, t, s, n)))(game, this.teleports, i));
    // Arrive on the south side of the plaza, spread out so friends don't stand inside each other.
    const x = (Math.random() - 0.5) * 3;
    createPlayer(game, new THREE.Vector3(x, 0.05, 13), 0);
  }
}
