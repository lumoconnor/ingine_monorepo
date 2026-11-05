import * as THREE from 'three';
import { Component } from '@/entities/Component';
import { WaterVolume } from '@/gameplay/components/WaterVolume';

const _cam = new THREE.Vector3();
const WATER_FOG = new THREE.Color(0x1d5f86);

/**
 * When the camera dips below a water surface: blue fog that closes in, and a
 * HUD tint (via the 'player:underwater' event). Runs after the camera moves.
 */
export class UnderwaterEffect extends Component {
  order = 105;
  underwater = false;
  private airFog: THREE.Fog | null = null;
  private waterFog = new THREE.Fog(WATER_FOG, 0.5, 22);
  private airBackground: THREE.Color | THREE.Texture | null = null;

  update(): void {
    const r = this.game.renderer;
    r.camera.getWorldPosition(_cam);
    const w = WaterVolume.at(_cam);
    const under = !!w && _cam.y < w.surfaceY - 0.02;
    if (under === this.underwater) return;
    this.underwater = under;
    if (under) {
      this.airFog = r.scene.fog as THREE.Fog;
      this.airBackground = r.scene.background as THREE.Color;
      r.scene.fog = this.waterFog;
      r.scene.background = WATER_FOG;
    } else {
      r.scene.fog = this.airFog;
      r.scene.background = this.airBackground;
    }
    this.game.events.emit('player:underwater', { underwater: under });
  }
}
