import * as THREE from 'three';
import { mulberry32 } from '../../utils/noise';

/**
 * The painterly surface shader: a MeshStandardMaterial (so it keeps shadows,
 * fog, skinning and every light type) with four changes.
 *
 * 1. Brush strokes. A tiling stroke texture, projected three ways from the
 *    mesh's own rest-pose coordinates (no UVs, and it doesn't swim when the
 *    character moves), varies the colour's value and temperature.
 * 2. Painted light. N.L is wrapped and pushed toward two soft value steps
 *    (lit / shadow), and the strokes jitter where the step falls, so the
 *    edge between light and shadow looks brushed instead of airbrushed.
 * 3. Warm terminator, cool shadow. Skin (and anything with `sss` paint) gets
 *    a saturated warm band where light turns to shadow; the indirect light
 *    is pushed more saturated so shadows read as coloured, not grey.
 * 4. Rim. A thin view-dependent rim in the sky colour separates the shape
 *    from the background, like a painter's edge light.
 *
 * Per-vertex inputs: `color` (baked paint) and `paint` (x sss, y gloss,
 * z metal, w brush strength). Meshes without `paint` use the material's
 * defaults.
 */

export interface PainterlyLook {
  /** How much N.L wraps around (0 = physical, 0.5 = soft). */
  wrap: number;
  /** 0 = smooth, 1 = two clear value steps. */
  steps: number;
  /** Width of each step's soft edge. */
  stepSoft: number;
  /** Brush jitter of the light/shadow edge. */
  edgeJitter: number;
  /** Brush strength on colour (value +-). */
  brushValue: number;
  /** Brush strength on colour temperature. */
  brushHue: number;
  /** Strokes per metre. */
  brushScale: number;
  /** Terminator colour for skin-like paint (multiplies light). */
  terminator: THREE.Color;
  /** Saturation boost of indirect light (1 = none). */
  shadowSaturation: number;
  rim: number;
  rimColor: THREE.Color;
}

export const defaultLook = (): PainterlyLook => ({
  wrap: 0.35,
  steps: 0.75,
  stepSoft: 0.08,
  edgeJitter: 0.35,
  brushValue: 0.22,
  brushHue: 0.06,
  brushScale: 9,
  terminator: new THREE.Color(1.0, 0.42, 0.28),
  shadowSaturation: 1.35,
  rim: 0.22,
  rimColor: new THREE.Color(0.75, 0.85, 1.0),
});

let strokeTex: THREE.DataTexture | null = null;

/**
 * A tiling texture of overlapping brush dabs. R and G are two stroke layers
 * at different angles; B is fine canvas tooth. Generated once, 256x256.
 */
export function brushTexture(): THREE.DataTexture {
  if (strokeTex) return strokeTex;
  const S = 256;
  const rand = mulberry32(911);
  const layers = [new Float32Array(S * S).fill(0.5), new Float32Array(S * S).fill(0.5)];
  for (let L = 0; L < 2; L++) {
    const f = layers[L];
    const baseAngle = L === 0 ? 0.6 : -0.9;
    for (let n = 0; n < 650; n++) {
      const cx = rand() * S, cy = rand() * S;
      const ang = baseAngle + (rand() - 0.5) * 0.9;
      const len = 10 + rand() * 26;
      const wid = 2.5 + rand() * 5;
      const val = rand();
      const alpha = 0.35 + rand() * 0.4;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const R = Math.ceil(len + wid);
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const u = dx * ca + dy * sa;
          const v = -dx * sa + dy * ca;
          // A dab: soft rounded stroke, a bit heavier at its start, with bristle streaks.
          const t = u / len;
          if (Math.abs(t) > 1) continue;
          const taper = 1 - Math.abs(t) ** 3;
          const w = wid * (0.75 + 0.25 * (1 - t)) * taper;
          if (Math.abs(v) > w) continue;
          const bristle = 0.75 + 0.25 * Math.sin(v * 2.7 + n);
          const a = alpha * (1 - (Math.abs(v) / w) ** 4) * bristle;
          const x = (((Math.round(cx + dx) % S) + S) % S);
          const y = (((Math.round(cy + dy) % S) + S) % S);
          const i = x + y * S;
          f[i] += (val - f[i]) * a;
        }
    }
  }
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    data[i * 4] = Math.round(layers[0][i] * 255);
    data[i * 4 + 1] = Math.round(layers[1][i] * 255);
    data[i * 4 + 2] = Math.round((0.5 + (rand() - 0.5) * 0.5) * 255);
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  strokeTex = tex;
  return tex;
}

/** Shared uniforms, so one call retunes every painterly material at once. */
export const painterlyUniforms = {
  uBrush: { value: null as THREE.Texture | null },
  uWrap: { value: 0 },
  uSteps: { value: 0 },
  uStepSoft: { value: 0 },
  uEdgeJitter: { value: 0 },
  uBrushValue: { value: 0 },
  uBrushHue: { value: 0 },
  uBrushScale: { value: 0 },
  uTerminator: { value: new THREE.Color() },
  uShadowSat: { value: 1 },
  uRim: { value: 0 },
  uRimColor: { value: new THREE.Color() },
};

export function setPainterlyLook(look: Partial<PainterlyLook>): void {
  const l = { ...currentLook, ...look };
  currentLook = l;
  const u = painterlyUniforms;
  u.uWrap.value = l.wrap;
  u.uSteps.value = l.steps;
  u.uStepSoft.value = l.stepSoft;
  u.uEdgeJitter.value = l.edgeJitter;
  u.uBrushValue.value = l.brushValue;
  u.uBrushHue.value = l.brushHue;
  u.uBrushScale.value = l.brushScale;
  u.uTerminator.value.copy(l.terminator);
  u.uShadowSat.value = l.shadowSaturation;
  u.uRim.value = l.rim;
  u.uRimColor.value.copy(l.rimColor);
}

let currentLook = defaultLook();
setPainterlyLook(currentLook);

const VERT_PARS = /* glsl */ `
attribute vec4 paint;
varying vec4 vPaint;
varying vec3 vPaintPos;
varying vec3 vPaintNrm;
`;

const FRAG_PARS = /* glsl */ `
uniform sampler2D uBrush;
uniform float uWrap, uSteps, uStepSoft, uEdgeJitter, uBrushValue, uBrushHue, uBrushScale, uShadowSat, uRim;
uniform vec3 uTerminator, uRimColor;
varying vec4 vPaint;
varying vec3 vPaintPos;
varying vec3 vPaintNrm;
float gBrush = 0.5;
float gSss = 0.0;

vec3 paintTriplanar(vec3 p, vec3 n) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z + 1e-5);
  vec3 a = texture2D(uBrush, p.zy).rgb;
  vec3 b = texture2D(uBrush, p.xz + 0.37).rgb;
  vec3 c = texture2D(uBrush, p.xy + 0.71).rgb;
  return a * w.x + b * w.y + c * w.z;
}

float painterlyNdl(float ndl) {
  float w = (ndl + uWrap) / (1.0 + uWrap);
  w += (gBrush - 0.5) * uEdgeJitter;
  float stepped = smoothstep(0.0, uStepSoft, w) * 0.55 + smoothstep(0.42 - uStepSoft, 0.42 + uStepSoft, w) * 0.45;
  return mix(clamp(w, 0.0, 1.0), stepped, uSteps);
}
`;

/** Replace physical N.L with the painted version, and add the warm terminator. */
function patchedLightsChunk(): string {
  const src = THREE.ShaderChunk.lights_physical_pars_fragment;
  const from = /float dotNL = saturate\( dot\( geometryNormal, directLight\.direction \) \);\s*vec3 irradiance = dotNL \* directLight\.color;/;
  if (!from.test(src)) {
    console.warn('painterly: three.js lighting chunk changed; using physical lighting');
    return src;
  }
  return src.replace(
    from,
    `float rawNL = dot( geometryNormal, directLight.direction );
	float dotNL = painterlyNdl( rawNL );
	vec3 irradiance = dotNL * directLight.color;
	// Warm, saturated band where light turns to shadow (skin, wax, leaves).
	float term = smoothstep( 0.0, 0.25, dotNL ) * ( 1.0 - smoothstep( 0.3, 0.75, dotNL ) );
	irradiance *= mix( vec3( 1.0 ), uTerminator * 1.35, term * gSss * 0.6 );`,
  );
}

let lightsChunk: string | null = null;

export interface PainterlyMaterialOptions {
  color?: THREE.ColorRepresentation;
  vertexColors?: boolean;
  roughness?: number;
  metalness?: number;
  /** Defaults when the mesh has no `paint` attribute. */
  sss?: number;
  brush?: number;
  map?: THREE.Texture | null;
  side?: THREE.Side;
  /** Coordinates for strokes: 'object' (rest pose, default) or 'world' (static scenery). */
  space?: 'object' | 'world';
}

/** A painterly material. Use `vertexColors` for meshes baked by the sculpt kit. */
export function painterlyMaterial(o: PainterlyMaterialOptions = {}): THREE.MeshStandardMaterial {
  painterlyUniforms.uBrush.value = brushTexture();
  const m = new THREE.MeshStandardMaterial({
    color: o.color ?? 0xffffff,
    vertexColors: o.vertexColors ?? false,
    roughness: o.roughness ?? 0.82,
    metalness: o.metalness ?? 0,
    map: o.map ?? null,
    side: o.side ?? THREE.FrontSide,
  });
  const defaults = new THREE.Vector4(o.sss ?? 0, 0, o.metalness ?? 0, o.brush ?? 1);
  const world = o.space === 'world';
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, painterlyUniforms);
    lightsChunk ??= patchedLightsChunk();
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vPaint = vec4(${defaults.x.toFixed(3)}, ${defaults.y.toFixed(3)}, ${defaults.z.toFixed(3)}, ${defaults.w.toFixed(3)});
        #ifdef PAINTERLY_ATTR
          vPaint = paint;
        #endif
        ${world ? 'vPaintPos = (modelMatrix * vec4(position, 1.0)).xyz; vPaintNrm = normalize(mat3(modelMatrix) * normal);' : 'vPaintPos = position; vPaintNrm = normal;'}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <lights_physical_pars_fragment>', lightsChunk)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 br = paintTriplanar(vPaintPos * uBrushScale, normalize(vPaintNrm));
          float strength = vPaint.w;
          gBrush = mix(0.5, br.r * 0.6 + br.g * 0.4, strength);
          gSss = vPaint.x;
          float v = (br.r - 0.5) * 1.2 + (br.b - 0.5) * 0.35;
          diffuseColor.rgb *= 1.0 + v * uBrushValue * strength;
          // Strokes drift warm and cool, as mixed paint does.
          float t = (br.g - 0.5) * uBrushHue * strength * 2.0;
          diffuseColor.rgb *= vec3(1.0 + t, 1.0, 1.0 - t);
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.32, vPaint.y);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        metalnessFactor = max(metalnessFactor, vPaint.z);`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          // Coloured shadows: push indirect light away from grey.
          vec3 ind = reflectedLight.indirectDiffuse;
          float l = dot(ind, vec3(0.299, 0.587, 0.114));
          reflectedLight.indirectDiffuse = max(vec3(0.0), mix(vec3(l), ind, uShadowSat));
        }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          float ndv = saturate(dot(normal, normalize(vViewPosition)));
          float rim = smoothstep(0.55, 1.0, 1.0 - ndv) * (0.6 + 0.8 * gBrush);
          outgoingLight += uRimColor * rim * uRim * (0.35 + 0.65 * diffuseColor.rgb);
        }
        #include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => `painterly-${world ? 'w' : 'o'}-${defaults.toArray().join(',')}`;
  // Material.copy doesn't carry onBeforeCompile, so clones are rebuilt from the factory.
  m.clone = function (this: THREE.MeshStandardMaterial) {
    const c = painterlyMaterial(o);
    THREE.MeshStandardMaterial.prototype.copy.call(c, this);
    return c;
  } as never;
  return m;
}

/** Variant for meshes baked by the sculpt kit: vertex colours and the `paint` attribute. */
export function bakedPainterlyMaterial(): THREE.MeshStandardMaterial {
  const m = painterlyMaterial({ vertexColors: true });
  m.defines = { ...(m.defines ?? {}), PAINTERLY_ATTR: '' };
  const prev = m.customProgramCacheKey;
  m.customProgramCacheKey = () => prev.call(m) + '-baked';
  return m;
}
