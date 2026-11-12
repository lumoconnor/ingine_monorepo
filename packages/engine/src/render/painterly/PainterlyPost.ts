import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { brushTexture } from './PainterlyMaterial';

/**
 * Full-screen paint filter: a generalised Kuwahara filter (8 soft sectors,
 * polynomial weights) that flattens small detail into strokes of colour
 * while keeping edges sharp, then a touch of canvas tooth and saturation.
 * It is what makes the frame read as oil paint rather than a 3D render.
 *
 * Cost scales with radius squared: radius 4 is ~80 taps per pixel. Fine on
 * desktop GPUs at 1080p; offer it as a setting on weaker hardware.
 */
const KuwaharaShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tCanvas: { value: null as THREE.Texture | null },
    uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
    uStep: { value: 1 },
    uHardness: { value: 90 },
    uSharpness: { value: 6 },
    uCanvas: { value: 0.035 },
    uSaturation: { value: 1.08 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    #define R 4
    uniform sampler2D tDiffuse;
    uniform sampler2D tCanvas;
    uniform vec2 uTexel;
    uniform float uStep, uHardness, uSharpness, uCanvas, uSaturation;
    varying vec2 vUv;
    void main() {
      vec4 m[8];
      vec3 s[8];
      for (int k = 0; k < 8; k++) { m[k] = vec4(0.0); s[k] = vec3(0.0); }
      float radius = float(R);
      float zeta = 2.0 / radius;
      float zeroCross = 0.58;
      float sinZ = sin(zeroCross);
      float eta = (zeta + cos(zeroCross)) / (sinZ * sinZ);
      for (int y = -R; y <= R; y++) {
        for (int x = -R; x <= R; x++) {
          vec2 v = vec2(float(x), float(y)) / radius;
          if (dot(v, v) > 1.0) continue;
          vec3 c = texture2D(tDiffuse, vUv + vec2(float(x), float(y)) * uTexel * uStep).rgb;
          // Compress highlights so a few hot pixels don't dominate the variance.
          c = c / (1.0 + c);
          float w[8];
          float sum = 0.0;
          float vxx = zeta - eta * v.x * v.x;
          float vyy = zeta - eta * v.y * v.y;
          float z;
          z = max(0.0, v.y + vxx); w[0] = z * z;
          z = max(0.0, -v.x + vyy); w[2] = z * z;
          z = max(0.0, -v.y + vxx); w[4] = z * z;
          z = max(0.0, v.x + vyy); w[6] = z * z;
          vec2 r = 0.70710678 * vec2(v.x - v.y, v.x + v.y);
          vxx = zeta - eta * r.x * r.x;
          vyy = zeta - eta * r.y * r.y;
          z = max(0.0, r.y + vxx); w[1] = z * z;
          z = max(0.0, -r.x + vyy); w[3] = z * z;
          z = max(0.0, -r.y + vxx); w[5] = z * z;
          z = max(0.0, r.x + vyy); w[7] = z * z;
          for (int k = 0; k < 8; k++) sum += w[k];
          float g = exp(-3.125 * dot(v, v)) / max(sum, 1e-5);
          for (int k = 0; k < 8; k++) {
            float wk = w[k] * g;
            m[k] += vec4(c * wk, wk);
            s[k] += c * c * wk;
          }
        }
      }
      // Weight sectors by how flat they are relative to the flattest one (never all zero).
      vec3 means[8];
      float sig[8];
      float minS = 1e9;
      for (int k = 0; k < 8; k++) {
        float wsum = max(m[k].w, 1e-6);
        means[k] = m[k].rgb / wsum;
        vec3 var = abs(s[k] / wsum - means[k] * means[k]);
        sig[k] = var.r + var.g + var.b;
        minS = min(minS, sig[k]);
      }
      vec4 acc = vec4(0.0);
      for (int k = 0; k < 8; k++) {
        float wk = 1.0 / (1.0 + pow(max(0.0, sig[k] - minS) * uHardness * 100.0, 0.5 * uSharpness) * 0.0 + pow((sig[k] + 1e-5) / (minS + 1e-5), 0.5 * uSharpness));
        acc += vec4(means[k] * wk, wk);
      }
      vec3 col = acc.rgb / max(acc.w, 1e-5);
      col = col / max(vec3(1e-4), 1.0 - col);
      // Canvas tooth and a little extra chroma.
      float tooth = texture2D(tCanvas, gl_FragCoord.xy / 180.0).b - 0.5;
      col *= 1.0 + tooth * uCanvas * 2.0;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = max(vec3(0.0), mix(vec3(l), col, uSaturation));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class PainterlyPost {
  enabled = true;
  readonly composer: EffectComposer;
  readonly pass: ShaderPass;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.pass = new ShaderPass(KuwaharaShader);
    this.pass.uniforms.tCanvas.value = brushTexture();
    this.composer.addPass(this.pass);
    this.composer.addPass(new OutputPass());
    const size = renderer.getSize(new THREE.Vector2());
    this.setSize(size.x, size.y);
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.pass.uniforms.uTexel.value.set(1 / (w * pr), 1 / (h * pr));
    // Keep the stroke size the same in CSS pixels on high-DPI screens.
    this.pass.uniforms.uStep.value = Math.max(1, pr * 0.75);
  }

  render(): void {
    this.composer.render();
  }
}
