import * as THREE from 'three';
import type { System } from '@/core/System';

/**
 * Owns the WebGL renderer, the root scene and the active camera. Handles
 * resize and pixel ratio. Post-processing would plug in here later.
 */
export class Renderer implements System {
  readonly name = 'renderer';
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly webgl: THREE.WebGLRenderer;
  readonly sun: THREE.DirectionalLight;
  /** Max device pixel ratio; lower for performance. */
  maxPixelRatio = 2;

  constructor(readonly container: HTMLElement) {
    this.webgl = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, this.maxPixelRatio));
    this.webgl.setSize(container.clientWidth, container.clientHeight);
    this.webgl.outputColorSpace = THREE.SRGBColorSpace;
    this.webgl.toneMapping = THREE.ACESFilmicToneMapping;
    this.webgl.toneMappingExposure = 1.0;
    this.webgl.shadowMap.enabled = true;
    this.webgl.shadowMap.type = THREE.PCFShadowMap;
    this.webgl.domElement.tabIndex = 0;
    container.appendChild(this.webgl.domElement);

    this.camera = new THREE.PerspectiveCamera(
      75,
      container.clientWidth / container.clientHeight,
      0.05,
      2000,
    );

    // Environment: sky colour, fog, ambient + sun.
    const sky = new THREE.Color(0x9cc4e4);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 80, 420);

    const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x4a5a3a, 1.1);
    this.scene.add(hemi);

    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    this.sun.position.set(60, 100, 40);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    // Tight frustum around the player = small shadow texels, so only a tiny
    // bias is needed. Large normal bias detaches shadows from object bases.
    const s = 45;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 20, far: 220 });
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.004;
    this.scene.add(this.sun, this.sun.target);

    window.addEventListener('resize', this.onResize);
  }

  /** Keep the shadow frustum centred on a point (the player) so shadows stay crisp. */
  followShadows(target: THREE.Vector3): void {
    const offset = new THREE.Vector3(60, 100, 40);
    // Snap to texel-ish grid to reduce shadow shimmering while moving.
    const snap = 0.5;
    const x = Math.round(target.x / snap) * snap;
    const z = Math.round(target.z / snap) * snap;
    this.sun.position.set(x + offset.x, target.y + offset.y, z + offset.z);
    this.sun.target.position.set(x, target.y, z);
  }

  render(): void {
    this.webgl.render(this.scene, this.camera);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.webgl.dispose();
  }

  private onResize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, this.maxPixelRatio));
    this.webgl.setSize(w, h);
  };
}
