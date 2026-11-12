import * as THREE from 'three';
import { Sculpt, lin, buildSculpt, type BoneDef } from './sculpt';
import type { Prim, V3, Clip } from './sdf';
import { quatEuler } from './sdf';
import type { Paint } from './mesher';
import { bakedPainterlyMaterial } from './PainterlyMaterial';

/**
 * The character kit: a parametric, stylised human (big hands, strong heads,
 * long limbs) plus a wardrobe of garments that work in any setting. A
 * character is a JSON-friendly `CharacterSpec`; `buildCharacter` sculpts,
 * paints and rigs it.
 *
 * Rig contract (bone names; every bone rests with zero rotation, facing +Z,
 * feet on y = 0):
 *   root > hips > spine > chest > neck > head
 *   chest > arm_l > forearm_l > hand_l      (left = +X)
 *   chest > arm_r > forearm_r > hand_r > grip_r (weapon socket, not a bone)
 *   hips > leg_l > shin_l > foot_l, and the same for _r
 *   head > helm (socket for worn headgear)
 * Rotating arm_* about X swings the arm (negative = forward), the same
 * convention the greybox rig uses.
 */

export type GarmentType =
  | 'shirt' | 'tunic' | 'coat' | 'vest' | 'apron' | 'trousers' | 'skirt' | 'boots' | 'shoes'
  | 'belt' | 'satchel' | 'scarf' | 'mask' | 'hood' | 'flatcap' | 'kerchief' | 'mantle' | 'bracers' | 'gloves' | 'sash';

export interface Garment {
  type: GarmentType;
  color: string;
  /** Mottled second colour (wear, dye variation). */
  color2?: string;
  /** Buttons, buckles, piping. */
  trim?: string;
  gloss?: number;
  sleeves?: 'long' | 'short' | 'rolled' | 'none';
  /** Hem height for coats, tunics, skirts, aprons (m from the floor, at 1.78 m tall). */
  hem?: number;
}

export interface CharacterSpec {
  /** Metres. */
  height?: number;
  build?: {
    shoulders?: number;
    chest?: number;
    belly?: number;
    hips?: number;
    limbs?: number;
    hands?: number;
    head?: number;
    neck?: number;
    /** Forward hunch, 0..1. */
    stoop?: number;
  };
  face?: {
    length?: number;
    jaw?: number;
    chin?: number;
    cheeks?: number;
    nose?: number;
    noseWidth?: number;
    noseHook?: number;
    brow?: number;
    ears?: number;
    mouth?: number;
    lips?: number;
    /** 0 young .. 1 old: jowls, bags, sallower skin. */
    age?: number;
  };
  skin: string;
  /** Flush colour on nose, cheeks, knuckles. */
  flush?: string;
  eyes?: string;
  hair?: { style: 'cropped' | 'bun' | 'balding' | 'swept' | 'none'; color: string };
  beard?: { style: 'full' | 'walrus' | 'stubble'; color: string };
  brows?: string;
  outfit: Garment[];
  hands?: 'relaxed' | 'fist';
}

type Side = 1 | -1;
const DEG = Math.PI / 180;

/** Keep the part of a primitive above world height y (its centre is at cy, no rotation). */
const above = (cy: number, y: number, k = 0): Clip => ({ n: [0, -1, 0], o: cy - y, k });
const below = (cy: number, y: number, k = 0): Clip => ({ n: [0, 1, 0], o: y - cy, k });

export function sculptCharacter(spec: CharacterSpec): Sculpt {
  const s = new Sculpt();
  const b = spec.build ?? {};
  const f = spec.face ?? {};
  const u = (spec.height ?? 1.78) / 1.78;
  const sw = b.shoulders ?? 1, cw = b.chest ?? 1, belly = b.belly ?? 0, hw = b.hips ?? 1;
  const lt = b.limbs ?? 1, hs = (b.hands ?? 1.15) * 1.12, hd = (b.head ?? 1) * 1.05, stoop = b.stoop ?? 0;
  const age = f.age ?? 0;
  const S = (x: number, y: number, z: number): V3 => [x * u, y * u, z * u];

  // ------------------------------------------------------------ landmarks
  const st = stoop;
  const hipJ = (x: Side): V3 => S(0.095 * hw * x, 0.9, 0);
  const knee = (x: Side): V3 => S(0.1 * hw * x, 0.5, 0.012);
  const ankle = (x: Side): V3 => S(0.1 * hw * x, 0.085, -0.015);
  const chestC: V3 = S(0, 1.29 - st * 0.03, 0.035 * st);
  const shoulder = (x: Side): V3 => S(0.185 * sw * x, 1.44 - st * 0.05, -0.012 + 0.07 * st);
  const elbow = (x: Side): V3 => { const p = shoulder(x); return [p[0] + 0.018 * x * u, p[1] - 0.29 * u, p[2] - 0.01 * u]; };
  const wrist = (x: Side): V3 => { const p = elbow(x); return [p[0] + 0.004 * x * u, p[1] - 0.255 * u, p[2] + 0.025 * u]; };
  const neckBase: V3 = S(0, 1.47 - st * 0.05, -0.015 + 0.08 * st);
  const headPivot: V3 = S(0, 1.6 - st * 0.08, 0.0 + 0.15 * st);
  const headC: V3 = [headPivot[0], headPivot[1] + 0.09 * u * hd, headPivot[2] + 0.005];
  s.hipY = 0.92 * u;
  s.kneeY = 0.45 * u;
  s.valueRamp = [0.15 * u, 1.55 * u, 0.62];

  // ------------------------------------------------------------ skeleton
  const bones: BoneDef[] = [
    { name: 'root', parent: null, pos: [0, 0, 0] },
    { name: 'hips', parent: 'root', pos: S(0, 0.96, 0) },
    { name: 'spine', parent: 'hips', pos: S(0, 1.06, 0.005) },
    { name: 'chest', parent: 'spine', pos: chestC },
    { name: 'neck', parent: 'chest', pos: neckBase },
    { name: 'head', parent: 'neck', pos: headPivot },
  ];
  for (const [x, n] of [[1, 'l'], [-1, 'r']] as const) {
    bones.push(
      // Arms out and legs apart while meshing so they don't fuse to the body.
      { name: `arm_${n}`, parent: 'chest', pos: shoulder(x), bind: [0, 0, x * 38 * DEG] },
      { name: `forearm_${n}`, parent: `arm_${n}`, pos: elbow(x), bind: [-14 * DEG, 0, 0] },
      { name: `hand_${n}`, parent: `forearm_${n}`, pos: wrist(x) },
      { name: `leg_${n}`, parent: 'hips', pos: hipJ(x), bind: [0, 0, x * 7 * DEG] },
      { name: `shin_${n}`, parent: `leg_${n}`, pos: knee(x) },
      { name: `foot_${n}`, parent: `shin_${n}`, pos: ankle(x) },
    );
  }
  s.bones.push(...bones);
  s.pieces.push(
    { name: 'body', cell: 0.011 * u, skinned: true },
    { name: 'head', cell: 0.0042 * u * hd, bone: 'head' },
    { name: 'hand_l', cell: 0.0038 * u * hs, bone: 'hand_l' },
    { name: 'hand_r', cell: 0.0038 * u * hs, bone: 'hand_r' },
  );

  // ------------------------------------------------------------ paints
  const skinCol = lin(spec.skin);
  const flush = lin(spec.flush ?? mixHex(spec.skin, '#c0504a', 0.45));
  const skin = s.addPaint({ color: skinCol, color2: flush, mottle: 0.18, mottleFreq: 22, sss: 1, gloss: 0.12, brush: 0.55, edge: 0.5 });
  const lips = s.addPaint({ color: lin(mixHex(spec.skin, '#9a4a46', 0.35)), sss: 1, gloss: 0.3, brush: 0.4, edge: 0.4 });
  const hairCol = spec.hair?.color ?? spec.brows ?? '#3a2a20';
  const hair = s.addPaint({ color: lin(hairCol), color2: lin(mixHex(hairCol, '#ffffff', 0.1)), mottle: 0.3, mottleFreq: 50, gloss: 0.3, brush: 1, edge: 0.8 });
  const brows = s.addPaint({ color: lin(spec.brows ?? mixHex(hairCol, '#000000', 0.15)), brush: 0.8, edge: 0.6 });
  const beardP = spec.beard ? s.addPaint({ color: lin(spec.beard.color), color2: lin(mixHex(spec.beard.color, '#ffffff', 0.2)), mottle: 0.3, mottleFreq: 60, gloss: 0.2, brush: 1, edge: 0.8 }) : hair;
  const garmentPaint = (g: Garment, extra: Partial<Paint> = {}) =>
    s.addPaint({ color: lin(g.color), color2: g.color2 ? lin(g.color2) : lin(mixHex(g.color, '#000000', 0.12)), mottle: g.color2 ? 0.45 : 0.3, mottleFreq: 9, gloss: g.gloss ?? 0, brush: 1, edge: 1, ...extra });
  const trimPaint = (g: Garment) => s.addPaint({ color: lin(g.trim ?? '#b89a5a'), gloss: 0.7, metal: g.trim ? 0.4 : 0.6, brush: 0.4, edge: 1.5 });

  const has = (t: GarmentType) => spec.outfit.find((g) => g.type === t);

  // ------------------------------------------------------------ body shapes
  const add = (p: Prim) => s.add(p);
  /** Torso volume, inflated by t. */
  const torso = (t: number, paint: number, extra: Partial<Prim> = {}, parts: ('pelvis' | 'belly' | 'chest' | 'yoke')[] = ['pelvis', 'belly', 'chest', 'yoke']) => {
    const e = extra as object;
    if (parts.includes('pelvis')) add({ type: 'ellipsoid', c: S(0, 0.96, -0.005), r: [0.158 * hw * u + t, 0.12 * u + t, 0.112 * u + t], paint, bone: 'hips', k: 0.04 * u, ...e });
    if (parts.includes('belly')) add({ type: 'ellipsoid', c: S(0, 1.09, 0.008 + belly * 0.05), r: [(0.142 + belly * 0.04) * cw * u + t, 0.135 * u + t, (0.1 + belly * 0.07) * u + t], paint, bone: 'spine', k: 0.05 * u, ...e });
    if (parts.includes('chest')) add({ type: 'ellipsoid', c: chestC, r: [0.163 * cw * sw * u + t, 0.17 * u + t, (0.112 + 0.012 * belly) * u + t], paint, bone: 'chest', k: 0.05 * u, rot: quatEuler(st * 0.35, 0, 0), ...e });
    if (parts.includes('yoke')) add({ type: 'cone', a: [shoulder(1)[0] - 0.035 * u, shoulder(1)[1] + 0.005 * u, shoulder(1)[2]], b: [shoulder(-1)[0] + 0.035 * u, shoulder(-1)[1] + 0.005 * u, shoulder(-1)[2]], ra: 0.05 * u + t, rb: 0.05 * u + t, paint, bone: 'chest', k: 0.06 * u, ...e });
  };
  const upperArm = (x: Side, t: number, paint: number, to = 1, extra: Partial<Prim> = {}) => {
    const a = shoulder(x), e = elbow(x);
    const end: V3 = [a[0] + (e[0] - a[0]) * to, a[1] + (e[1] - a[1]) * to, a[2] + (e[2] - a[2]) * to];
    add({ type: 'ellipsoid', c: [a[0] + 0.008 * x * u, a[1] - 0.02 * u, a[2]], r: [0.047 * u * lt + t, 0.06 * u + t, 0.05 * u * lt + t], paint, bone: x > 0 ? 'arm_l' : 'arm_r', k: 0.03 * u, ...(extra as object) });
    add({ type: 'cone', a, b: end, ra: 0.045 * u * lt + t, rb: (0.045 - 0.008 * to) * u * lt + t, paint, bone: x > 0 ? 'arm_l' : 'arm_r', k: 0.02 * u, ...(extra as object) });
  };
  const foreArm = (x: Side, t: number, paint: number, from = 0, to = 1, extra: Partial<Prim> = {}) => {
    const e = elbow(x), w = wrist(x);
    const a: V3 = [e[0] + (w[0] - e[0]) * from, e[1] + (w[1] - e[1]) * from, e[2] + (w[2] - e[2]) * from];
    const bb: V3 = [e[0] + (w[0] - e[0]) * to, e[1] + (w[1] - e[1]) * to, e[2] + (w[2] - e[2]) * to];
    const r0 = 0.042 * u * lt, r1 = 0.03 * u * lt;
    add({ type: 'cone', a, b: bb, ra: r0 + (r1 - r0) * from + t, rb: r0 + (r1 - r0) * to + t, paint, bone: x > 0 ? 'forearm_l' : 'forearm_r', k: 0.02 * u, ...(extra as object) });
    if (from === 0) add({ type: 'ellipsoid', c: [e[0] + (w[0] - e[0]) * 0.22, e[1] + (w[1] - e[1]) * 0.22, e[2] + (w[2] - e[2]) * 0.22 + 0.005 * u], r: [0.042 * u * lt + t, 0.07 * u + t, 0.042 * u * lt + t], paint, bone: x > 0 ? 'forearm_l' : 'forearm_r', k: 0.03 * u, ...(extra as object) });
  };
  const thigh = (x: Side, t: number, paint: number, extra: Partial<Prim> = {}) => {
    add({ type: 'cone', a: hipJ(x), b: knee(x), ra: 0.085 * hw * u * lt + t, rb: 0.055 * u * lt + t, paint, bone: x > 0 ? 'leg_l' : 'leg_r', k: 0.05 * u, ...(extra as object) });
  };
  const shin = (x: Side, t: number, paint: number, toY = 0.085, extra: Partial<Prim> = {}) => {
    const k0 = knee(x), a0 = ankle(x);
    const tt = (0.5 - toY) / (0.5 - 0.085);
    const end: V3 = [k0[0] + (a0[0] - k0[0]) * tt, k0[1] + (a0[1] - k0[1]) * tt, k0[2] + (a0[2] - k0[2]) * tt];
    const bone = x > 0 ? 'shin_l' : 'shin_r';
    add({ type: 'cone', a: k0, b: end, ra: 0.053 * u * lt + t, rb: (0.053 - 0.018 * tt) * u * lt + t, paint, bone, k: 0.03 * u, ...(extra as object) });
    add({ type: 'ellipsoid', c: [k0[0], 0.36 * u, k0[2] - 0.025 * u], r: [0.048 * u * lt + t, 0.1 * u + t, 0.05 * u * lt + t], paint, bone, k: 0.04 * u, ...(extra as object) });
  };
  const foot = (x: Side, t: number, paint: number, extra: Partial<Prim> = {}) => {
    const a = ankle(x);
    const bone = x > 0 ? 'foot_l' : 'foot_r';
    const c = { type: 'cone' as const, a: [a[0], 0.055 * u, a[2] - 0.035 * u] as V3, b: [a[0] + 0.01 * x * u, 0.04 * u, a[2] + 0.15 * u] as V3, ra: 0.048 * u + t, rb: 0.04 * u + t, paint, bone, k: 0.03 * u, ...(extra as object) };
    const cy = (c.a[1] + c.b[1]) / 2;
    add({ ...c, clip: [above(cy, 0, 0.004)] });
    add({ type: 'cone', a: [a[0], 0.06 * u, a[2]], b: [a[0], a[1] + 0.04 * u, a[2]], ra: 0.042 * u + t, rb: 0.036 * u + t, paint, bone, k: 0.03 * u, clip: [above(0.08 * u, 0, 0.004)], ...(extra as object) });
  };

  // ------------------------------------------------------------ outerwear that carves (must come first)
  const coat = has('coat');
  if (coat) {
    const p = garmentPaint(coat);
    const hem = (coat.hem ?? 0.42) * u;
    // Coat skirt: flared, vertical folds, takes some of the legs' swing.
    add({ type: 'cone', a: S(0, 1.02, 0), b: [0, hem + 0.02 * u, -0.01 * u], ra: 0.175 * hw * u, rb: 0.235 * hw * u, paint: p, bone: 'hips', legFollow: 0.55, k: 0.03 * u, displace: { amp: 0.007 * u, freq: [28, 5, 28] }, clip: [above((1.02 * u + hem) / 2, hem, 0.01)] });
    // Open at the front from the waist down.
    add({ type: 'box', op: 'sub', c: [0, (hem + 1.0 * u) / 2 - 0.05 * u, 0.2 * u], h: [0.028 * u, (1.0 * u - hem) / 2 + 0.06 * u, 0.12 * u], r: 0.01, k: 0.01, bone: 'hips', rot: quatEuler(0, 0, 0) });
  }
  const hood = has('hood');

  // ------------------------------------------------------------ garments
  for (const g of spec.outfit) {
    switch (g.type) {
      case 'shirt':
      case 'tunic':
      case 'coat': {
        const p = garmentPaint(g);
        const t = (g.type === 'shirt' ? 0.006 : g.type === 'tunic' ? 0.011 : 0.016) * u;
        const folds = { amp: 0.0035 * u, freq: [14, 34, 14] as V3 };
        torso(t, p, { displace: { amp: 0.002 * u, freq: [20, 20, 20] } });
        const sl = g.sleeves ?? 'long';
        for (const x of [1, -1] as Side[]) {
          if (sl === 'none') continue;
          upperArm(x, t + 0.002 * u, p, sl === 'short' ? 0.55 : 1, { displace: folds });
          if (sl === 'long') foreArm(x, t + 0.001 * u, p, 0, 0.92, { displace: folds });
          if (sl === 'rolled') {
            foreArm(x, t + 0.012 * u, p, 0.02, 0.2, { displace: { amp: 0.004 * u, freq: [40, 40, 40] } });
          }
          if (g.type === 'coat' && sl === 'long') foreArm(x, t + 0.012 * u, p, 0.72, 0.9);
        }
        if (g.type === 'tunic') {
          const hem = (g.hem ?? 0.72) * u;
          add({ type: 'cone', a: S(0, 1.02, 0), b: [0, hem, -0.005 * u], ra: (0.165 * hw + 0.012) * u, rb: (0.19 * hw + 0.01) * u, paint: p, bone: 'hips', legFollow: 0.7, k: 0.04 * u, displace: { amp: 0.005 * u, freq: [30, 6, 30] }, clip: [above((1.02 * u + hem) / 2, hem, 0.008)] });
        }
        if (g.type === 'coat') {
          // Standing collar and lapels.
          add({ type: 'cone', a: [neckBase[0], neckBase[1] - 0.01 * u, neckBase[2]], b: [neckBase[0], neckBase[1] + 0.07 * u, neckBase[2] - 0.01 * u], ra: 0.07 * u, rb: 0.064 * u, paint: p, bone: 'chest', k: 0.02 * u, clip: [{ n: [0, 0, 1], o: 0.035 * u, k: 0.01 }] });
          const tp = trimPaint(g);
          for (let i = 0; i < 3; i++) add({ type: 'ellipsoid', c: [-0.035 * u, (1.22 - i * 0.09) * u, chestC[2] + (0.135 + (i === 2 ? -0.005 : 0)) * u + t * 0.6 + belly * 0.05 * u], r: [0.009 * u, 0.009 * u, 0.005 * u], paint: tp, bone: i === 2 ? 'spine' : 'chest', k: 0.002 });
        }
        if (g.type === 'shirt') {
          add({ type: 'cone', a: neckBase, b: [neckBase[0], neckBase[1] + 0.04 * u, neckBase[2]], ra: 0.062 * u, rb: 0.056 * u, paint: p, bone: 'chest', k: 0.015 * u, clip: [{ n: [0, 0, 1], o: 0.03 * u, k: 0.01 }] });
        }
        break;
      }
      case 'vest': {
        const p = garmentPaint(g);
        add({ type: 'ellipsoid', c: S(0, 1.09, 0.008 + belly * 0.05), r: [(0.142 + belly * 0.04) * cw * u + 0.014 * u, 0.135 * u + 0.014 * u, (0.1 + belly * 0.07) * u + 0.014 * u], paint: p, bone: 'spine', k: 0.05 * u, clip: [above(1.09 * u, 0.99 * u, 0.01)] });
        add({ type: 'ellipsoid', c: chestC, r: [0.163 * cw * sw * u + 0.014 * u, 0.17 * u + 0.014 * u, (0.112 + 0.012 * belly) * u + 0.014 * u], paint: p, bone: 'chest', k: 0.05 * u, rot: quatEuler(st * 0.35, 0, 0), clip: [below(chestC[1], 1.42 * u, 0.02)] });
        const tp = trimPaint(g);
        for (let i = 0; i < 4; i++) {
          const y = (1.3 - i * 0.075) * u;
          add({ type: 'ellipsoid', c: [0, y, (i < 2 ? chestC[2] + 0.125 : 0.122 + belly * 0.115) * u + 0.004 * u], r: [0.007 * u, 0.007 * u, 0.006 * u], paint: tp, bone: i < 2 ? 'chest' : 'spine', k: 0.002 });
        }
        break;
      }
      case 'apron': {
        const p = garmentPaint(g);
        const hem = (g.hem ?? 0.4) * u;
        const top = 1.32 * u;
        const skirt = has('skirt');
        const mid = (1.04 * u + hem) / 2;
        // Lower panel: follows the skirt's flare (or the legs), front half only.
        add({ type: 'cone', a: S(0, 1.04, 0.012 + belly * 0.03), b: [0, hem, (skirt ? 0.0 : 0.03) * u], ra: (0.155 * hw + 0.03) * u + belly * 0.035 * u, rb: (skirt ? 0.29 * hw : 0.2 * hw) * u, paint: p, bone: 'hips', legFollow: 0.6, k: 0.01 * u, displace: { amp: 0.004 * u, freq: [24, 6, 24] }, clip: [{ n: [0, 0, -1], o: -0.02 * u, k: 0.004 }, { n: [1, 0, 0], o: 0.17 * u, k: 0.01 }, { n: [-1, 0, 0], o: 0.17 * u, k: 0.01 }, above(mid, hem, 0.006)] });
        // Bib over the chest.
        add({ type: 'ellipsoid', c: [chestC[0], chestC[1] - 0.03 * u, chestC[2]], r: [0.163 * cw * sw * u + 0.012 * u, 0.17 * u, (0.112 + 0.012 * belly) * u + 0.012 * u], paint: p, bone: 'chest', k: 0.01 * u, clip: [{ n: [0, 0, -1], o: -0.06 * u, k: 0.004 }, below(chestC[1] - 0.03 * u, top, 0.004), { n: [1, 0, 0], o: 0.09 * u }, { n: [-1, 0, 0], o: 0.09 * u }] });
        void top;
        // Waist ties.
        add({ type: 'ellipsoid', c: S(0, 1.02, 0.005 + belly * 0.04), r: [(0.155 * hw + 0.02) * u + belly * 0.035 * u, 0.12 * u, (0.11 + belly * 0.06) * u + 0.02 * u], paint: p, bone: 'spine', k: 0.005, clip: [above(1.02 * u, 1.0 * u), below(1.02 * u, 1.035 * u)] });
        break;
      }
      case 'trousers': {
        const p = garmentPaint(g);
        const t = 0.01 * u;
        torso(t, p, {}, ['pelvis']);
        for (const x of [1, -1] as Side[]) {
          thigh(x, t, p, { displace: { amp: 0.003 * u, freq: [12, 30, 12] } });
          shin(x, t * 0.8, p, 0.1, { displace: { amp: 0.003 * u, freq: [12, 30, 12] } });
        }
        break;
      }
      case 'skirt': {
        const p = garmentPaint(g);
        const hem = (g.hem ?? 0.14) * u;
        add({ type: 'cone', a: S(0, 1.04, 0.0), b: [0, hem, -0.01 * u], ra: (0.155 * hw + 0.015) * u + belly * 0.03 * u, rb: 0.28 * hw * u, paint: p, bone: 'hips', legFollow: 0.5, k: 0.05 * u, displace: { amp: 0.009 * u, freq: [30, 4, 30] }, clip: [above((1.04 * u + hem) / 2, hem, 0.008)] });
        torso(0.012 * u, p, {}, ['pelvis']);
        break;
      }
      case 'boots': {
        const p = garmentPaint(g, { gloss: g.gloss ?? 0.45, edge: 1.4 });
        for (const x of [1, -1] as Side[]) {
          foot(x, 0.012 * u, p);
          const k0 = knee(x), a0 = ankle(x);
          add({ type: 'cone', a: [a0[0], 0.06 * u, a0[2]], b: [k0[0], 0.36 * u, k0[2] - 0.01 * u], ra: 0.05 * u, rb: 0.062 * u * lt, paint: p, bone: x > 0 ? 'shin_l' : 'shin_r', k: 0.02 * u, displace: { amp: 0.0025 * u, freq: [10, 30, 10] } });
          add({ type: 'cone', a: [k0[0], 0.34 * u, k0[2] - 0.015 * u], b: [k0[0], 0.385 * u, k0[2] - 0.015 * u], ra: 0.068 * u * lt, rb: 0.07 * u * lt, paint: p, bone: x > 0 ? 'shin_l' : 'shin_r', k: 0.006 });
          // Sole.
          add({ type: 'box', c: [ankle(x)[0] + 0.005 * x * u, 0.012 * u, ankle(x)[2] + 0.055 * u], h: [0.04 * u, 0.01 * u, 0.11 * u], r: 0.012 * u, paint: s.addPaint({ color: lin('#2a2420'), brush: 0.6 }), bone: x > 0 ? 'foot_l' : 'foot_r', k: 0.008 });
        }
        break;
      }
      case 'shoes': {
        const p = garmentPaint(g, { gloss: g.gloss ?? 0.35 });
        for (const x of [1, -1] as Side[]) foot(x, 0.008 * u, p);
        break;
      }
      case 'belt': {
        const p = garmentPaint(g, { gloss: g.gloss ?? 0.4, edge: 1.4 });
        const y = 1.0 * u;
        add({ type: 'ellipsoid', c: [0, y, 0.002 * u + belly * 0.035 * u], r: [(0.158 * hw + 0.028) * u + belly * 0.03 * u, 0.2 * u, (0.112 + 0.028) * u + belly * 0.06 * u], paint: p, bone: 'hips', k: 0.004, clip: [above(y, y - 0.022 * u, 0.002), below(y, y + 0.022 * u, 0.002)] });
        add({ type: 'box', c: [0, y, (0.142 + 0.008) * u + belly * 0.095 * u], h: [0.028 * u, 0.024 * u, 0.006 * u], r: 0.004 * u, paint: trimPaint(g), bone: 'hips', k: 0.003 });
        break;
      }
      case 'sash': {
        const p = garmentPaint(g);
        const y = 1.02 * u;
        add({ type: 'ellipsoid', c: [0, y, belly * 0.04 * u], r: [(0.158 * hw + 0.03) * u + belly * 0.035 * u, 0.2 * u, 0.142 * u + belly * 0.065 * u], paint: p, bone: 'hips', k: 0.006, displace: { amp: 0.004 * u, freq: [40, 40, 40] }, clip: [above(y, y - 0.04 * u, 0.006), below(y, y + 0.035 * u, 0.006)] });
        add({ type: 'cone', a: [0.15 * u, y - 0.02 * u, 0.05 * u], b: [0.17 * u, y - 0.3 * u, 0.06 * u], ra: 0.03 * u, rb: 0.04 * u, paint: p, bone: 'hips', legFollow: 0.4, k: 0.02 * u, displace: { amp: 0.006 * u, freq: [30, 10, 30] }, rot: undefined });
        break;
      }
      case 'satchel': {
        const p = garmentPaint(g, { gloss: g.gloss ?? 0.35 });
        // A strap that wraps the torso: a thin diagonal slice of a shell around it.
        const n = new THREE.Vector3(0.62, 0.78, 0).normalize();
        const c = chestC;
        const o = 0;
        add({ type: 'ellipsoid', c: [c[0], c[1] - 0.06 * u, c[2]], r: [0.175 * cw * sw * u + 0.02 * u, 0.3 * u, (0.12 + 0.015 * belly) * u + 0.018 * u + belly * 0.03 * u], paint: p, bone: 'chest', k: 0.004, clip: [{ n: [n.x, n.y, 0], o: o + 0.018 * u, k: 0.002 }, { n: [-n.x, -n.y, 0], o: -o + 0.018 * u, k: 0.002 }] });
        // The bag on the right hip.
        add({ type: 'box', c: S(-0.2 * hw, 0.92, 0.02), h: [0.028 * u, 0.075 * u, 0.1 * u], r: 0.018 * u, rot: quatEuler(0, 0, -0.08), paint: p, bone: 'hips', legFollow: 0.3, k: 0.01 * u, displace: { amp: 0.002 * u, freq: [30, 30, 30] } });
        add({ type: 'box', c: S(-0.228 * hw, 0.96, 0.02), h: [0.006 * u, 0.045 * u, 0.098 * u], r: 0.006 * u, rot: quatEuler(0, 0, -0.08), paint: p, bone: 'hips', k: 0.004 });
        add({ type: 'box', c: S(-0.236 * hw, 0.93, 0.02), h: [0.004 * u, 0.012 * u, 0.012 * u], r: 0.003 * u, paint: trimPaint(g), bone: 'hips', k: 0.002 });
        break;
      }
      case 'mantle': {
        const p = garmentPaint(g);
        const c: V3 = [0, shoulder(1)[1] - 0.06 * u, chestC[2] - 0.005 * u];
        add({ type: 'ellipsoid', c, r: [0.235 * sw * u, 0.17 * u, 0.152 * u + belly * 0.02 * u], paint: p, bone: 'chest', k: 0.015 * u, displace: { amp: 0.008 * u, freq: [30, 6, 30] }, clip: [above(c[1], c[1] - 0.12 * u, 0.01)] });
        break;
      }
      case 'scarf': {
        const p = garmentPaint(g);
        const nb = neckBase;
        add({ type: 'cone', a: [nb[0], nb[1] - 0.005 * u, nb[2]], b: [nb[0], nb[1] + 0.07 * u, nb[2] + 0.01 * u], ra: 0.085 * u, rb: 0.07 * u, paint: p, bone: 'chest', k: 0.02 * u, displace: { amp: 0.009 * u, freq: [40, 40, 40] } });
        add({ type: 'cone', a: [0.04 * u, nb[1] - 0.02 * u, nb[2] + 0.08 * u], b: [0.06 * u, nb[1] - 0.25 * u, chestC[2] + 0.13 * u], ra: 0.03 * u, rb: 0.026 * u, paint: p, bone: 'chest', k: 0.02 * u, displace: { amp: 0.004 * u, freq: [40, 12, 40] } });
        break;
      }
      case 'bracers': {
        const p = garmentPaint(g, { gloss: g.gloss ?? 0.45, edge: 1.4 });
        for (const x of [1, -1] as Side[]) foreArm(x, 0.012 * u, p, 0.5, 1.0);
        break;
      }
      default:
        break;
    }
  }

  // ------------------------------------------------------------ the body itself (shows where nothing covers it)
  torso(0, skin);
  add({ type: 'cone', a: [neckBase[0], neckBase[1] - 0.02 * u, neckBase[2]], b: [headPivot[0], headPivot[1] + 0.02 * u, headPivot[2] - 0.02 * u], ra: 0.054 * u * (b.neck ?? 1), rb: 0.046 * u * (b.neck ?? 1), paint: skin, bone: 'neck', k: 0.05 * u });
  for (const x of [1, -1] as Side[]) {
    upperArm(x, 0, skin);
    foreArm(x, 0, skin);
    thigh(x, 0, skin);
    shin(x, 0, skin);
    foot(x, 0, skin);
  }

  // ------------------------------------------------------------ head (rigid, finer clay)
  s.piece = 'head';
  s.bone = 'head';
  const H = (x: number, y: number, z: number): V3 => [headC[0] + x * hd * u, headC[1] + y * hd * u, headC[2] + z * hd * u];
  const hr = (r: number) => r * hd * u;
  const fl = f.length ?? 1, jaw = f.jaw ?? 1, chin = f.chin ?? 1, cheeks = f.cheeks ?? 1;
  const nose = f.nose ?? 1, nw = f.noseWidth ?? 1, hook = f.noseHook ?? 0, brow = f.brow ?? 1, ears = f.ears ?? 1, mouth = f.mouth ?? 1;
  const lipsZ = f.lips ?? 1;

  if (hood) {
    const p = garmentPaint(hood);
    add({ type: 'ellipsoid', c: H(0, 0.018, -0.012), r: [hr(0.1), hr(0.118), hr(0.122)], paint: p, k: 0.02, displace: { amp: hr(0.004), freq: [40, 20, 40] } });
    add({ type: 'cone', a: H(0, -0.05, -0.05), b: H(0, -0.2, -0.07), ra: hr(0.098), rb: hr(0.14), paint: p, k: hr(0.03), displace: { amp: hr(0.006), freq: [30, 10, 30] }, clip: [above(H(0, -0.125, 0)[1], H(0, -0.19, 0)[1], 0.01)] });
    // Opening for the face.
    add({ type: 'ellipsoid', op: 'sub', c: H(0, -0.025, 0.105), r: [hr(0.074), hr(0.1), hr(0.09)], k: hr(0.012) });
  }
  // Skull, face mass, jaw.
  add({ type: 'ellipsoid', c: H(0, 0.02, -0.012), r: [hr(0.074), hr(0.088), hr(0.098)], paint: skin, k: 0 });
  add({ type: 'ellipsoid', c: H(0, -0.028 * fl, 0.028), r: [hr(0.066), hr(0.074 * fl), hr(0.071)], paint: skin, k: hr(0.03) });
  add({ type: 'ellipsoid', c: H(0, 0.042, 0.042), r: [hr(0.066), hr(0.052), hr(0.056)], paint: skin, k: hr(0.03) });
  for (const x of [1, -1]) add({ type: 'ellipsoid', c: H(0.04 * x, -0.052 * fl, 0.046), r: [hr(0.03 * (1.1 - age * 0.2)), hr(0.034), hr(0.034)], paint: skin, k: hr(0.03) });
  for (const x of [1, -1]) {
    add({ type: 'cone', a: H(0.054 * jaw * x, -0.06 * fl, -0.012), b: H(0.016 * x, -0.112 * fl, 0.058), ra: hr(0.02 * jaw), rb: hr(0.019), paint: skin, k: hr(0.03) });
  }
  add({ type: 'ellipsoid', c: H(0, -0.11 * fl, 0.066), r: [hr(0.024 * chin), hr(0.021), hr(0.019 * chin)], paint: skin, k: hr(0.025) });
  // Cheekbones, brow ridge, muzzle.
  for (const x of [1, -1]) add({ type: 'ellipsoid', c: H(0.046 * x, -0.014, 0.06), r: [hr(0.022 * cheeks), hr(0.014), hr(0.018)], paint: skin, k: hr(0.02) });
  add({ type: 'ellipsoid', c: H(0, 0.024, 0.074), r: [hr(0.058), hr(0.015 * brow), hr(0.019 * brow)], paint: skin, k: hr(0.022) });
  add({ type: 'ellipsoid', c: H(0, -0.062 * fl, 0.072), r: [hr(0.034 * mouth), hr(0.03), hr(0.028)], paint: skin, k: hr(0.02) });
  if (age > 0.3) {
    for (const x of [1, -1]) add({ type: 'ellipsoid', c: H(0.042 * x, -0.075 * fl, 0.045), r: [hr(0.022), hr(0.026 * age), hr(0.02)], paint: skin, k: hr(0.025) });
  }
  // Eye sockets.
  for (const x of [1, -1]) add({ type: 'ellipsoid', op: 'sub', c: H(0.031 * x, 0.002, 0.088), r: [hr(0.019), hr(0.0135), hr(0.016)], k: hr(0.012) });
  // Eyes (separate glossy balls), lids over them.
  const eyeR = hr(0.0112);
  for (const x of [1, -1]) {
    const ec = H(0.031 * x, 0.001, 0.0745);
    s.extras.push({ bone: 'head', make: () => eyeball(eyeR, spec.eyes ?? '#5a6e7a', ec) });
    add({ type: 'ellipsoid', c: ec, r: [eyeR * 1.13, eyeR * 1.13, eyeR * 1.13], paint: skin, k: hr(0.003), clip: [{ n: [0, -1, -0.15], o: -eyeR * (0.3 - age * 0.25), k: hr(0.0015) }] });
    add({ type: 'ellipsoid', c: ec, r: [eyeR * 1.07, eyeR * 1.07, eyeR * 1.05], paint: skin, k: hr(0.003), clip: [{ n: [0, 1, -0.1], o: -eyeR * 0.72, k: hr(0.0015) }] });
    if (age > 0.3) add({ type: 'ellipsoid', c: [ec[0], ec[1] - eyeR * 1.1, ec[2] + eyeR * 0.3], r: [eyeR * 1.0, eyeR * 0.45 * age, eyeR * 0.6], paint: skin, k: hr(0.006) });
  }
  // Nose: bridge, tip, wings, a hook if it has one.
  add({ type: 'cone', a: H(0, 0.014, 0.088), b: H(0, -0.03 * fl, 0.108 + 0.014 * (nose - 1)), ra: hr(0.0075), rb: hr(0.0105 * nw), paint: skin, k: hr(0.012) });
  add({ type: 'ellipsoid', c: H(0, -0.032 * fl, 0.106 + 0.014 * (nose - 1)), r: [hr(0.012 * nw), hr(0.011), hr(0.012)], paint: skin, k: hr(0.008) });
  for (const x of [1, -1]) add({ type: 'ellipsoid', c: H(0.0125 * nw * x, -0.036 * fl, 0.094 + 0.006 * (nose - 1)), r: [hr(0.009), hr(0.008), hr(0.009)], paint: skin, k: hr(0.006) });
  if (hook > 0) add({ type: 'ellipsoid', c: H(0, -0.004, 0.1 + 0.008 * (nose - 1)), r: [hr(0.0075), hr(0.013), hr(0.006 + 0.004 * hook)], paint: skin, k: hr(0.008) });
  for (const x of [1, -1]) add({ type: 'ellipsoid', op: 'sub', c: H(0.0075 * nw * x, -0.043 * fl, 0.101 + 0.008 * (nose - 1)), r: [hr(0.0045), hr(0.003), hr(0.005)], k: hr(0.003) });
  // Mouth.
  const my = -0.059 * fl;
  add({ type: 'ellipsoid', c: H(0, my + 0.004, 0.095), r: [hr(0.02 * mouth), hr(0.0065 * lipsZ), hr(0.009)], paint: lips, k: hr(0.005) });
  add({ type: 'ellipsoid', c: H(0, my - 0.0075, 0.093), r: [hr(0.017 * mouth), hr(0.0075 * lipsZ), hr(0.0095)], paint: lips, k: hr(0.005) });
  add({ type: 'ellipsoid', op: 'sub', c: H(0, my - 0.0015, 0.104), r: [hr(0.021 * mouth), hr(0.0014), hr(0.011)], k: hr(0.0025) });
  const mask = has('mask');
  if (mask) {
    const p = garmentPaint(mask);
    const c = H(0, -0.07, 0.025);
    add({ type: 'ellipsoid', c, r: [hr(0.074), hr(0.07), hr(0.088)], paint: p, k: hr(0.008), displace: { amp: hr(0.003), freq: [20, 60, 20] }, clip: [{ n: [0, 0.93, -0.37], o: hr(0.016), k: hr(0.006) }] });
  }
  // Ears.
  for (const x of [1, -1]) {
    add({ type: 'ellipsoid', c: H(0.073 * x, -0.01, -0.004), r: [hr(0.009 * ears), hr(0.027 * ears), hr(0.017 * ears)], rot: quatEuler(0, x * -0.35, x * 0.08), paint: skin, k: hr(0.006) });
    add({ type: 'ellipsoid', op: 'sub', c: H(0.08 * x, -0.008, -0.002), r: [hr(0.004 * ears), hr(0.017 * ears), hr(0.01 * ears)], rot: quatEuler(0, x * -0.35, 0), k: hr(0.003) });
  }
  // Neck stub, hidden inside the collar and body neck.
  add({ type: 'cone', a: H(0, -0.06, -0.02), b: [headPivot[0], headPivot[1] - 0.05 * u, headPivot[2] - 0.02 * u], ra: hr(0.05), rb: 0.05 * u * (b.neck ?? 1), paint: skin, k: hr(0.03) });
  // Brows.
  for (const x of [1, -1]) {
    add({ type: 'ellipsoid', c: H(0.03 * x, 0.025, 0.088), r: [hr(0.021), hr(0.0055), hr(0.009)], rot: quatEuler(0, x * 0.25, x * (-0.12 + age * 0.3)), paint: brows, k: hr(0.003), displace: { amp: hr(0.0012), freq: [300, 120, 300] } });
  }
  // Hair.
  const hairStyle = spec.hair?.style ?? 'none';
  const covered = has('hood') || has('flatcap') || has('kerchief');
  if (hairStyle !== 'none') {
    const locks = { amp: hr(0.0035), freq: [70, 26, 70] as V3 };
    const c = H(0, 0.024, -0.014);
    const hairShell: Prim = { type: 'ellipsoid', c, r: [hr(0.08), hr(0.094), hr(0.104)], paint: hair, k: hr(0.006), displace: locks, clip: [{ n: [0, -0.6, 0.8], o: hr(0.045), k: hr(0.01) }, { n: [0, -1, 0], o: hr(0.05), k: hr(0.01) }] };
    if (hairStyle === 'cropped' || hairStyle === 'bun' || hairStyle === 'swept') add(hairShell);
    if (hairStyle === 'bun' && !covered) add({ type: 'ellipsoid', c: H(0, 0.06, -0.105), r: [hr(0.036), hr(0.033), hr(0.032)], paint: hair, k: hr(0.012), displace: { amp: hr(0.003), freq: [60, 60, 60] } });
    if (hairStyle === 'swept') {
      add({ type: 'ellipsoid', c: H(0.012, 0.07, 0.02), r: [hr(0.068), hr(0.04), hr(0.08)], rot: quatEuler(-0.25, 0, -0.1), paint: hair, k: hr(0.02), displace: { amp: hr(0.004), freq: [50, 20, 30] } });
      add({ type: 'cone', a: H(0, 0.03, -0.1), b: H(0, -0.12, -0.115), ra: hr(0.026), rb: hr(0.013), paint: hair, k: hr(0.02), displace: { amp: hr(0.003), freq: [60, 20, 60] } });
    }
    if (hairStyle === 'balding') {
      add({ ...hairShell, r: [hr(0.081), hr(0.094), hr(0.104)], clip: [{ n: [0, 1, 0], o: hr(0.004), k: hr(0.01) }, { n: [0, -1, 0], o: hr(0.06), k: hr(0.01) }, { n: [0, 0, 1], o: hr(0.02), k: hr(0.02) }] });
    }
  }
  const cap = has('flatcap');
  if (cap) {
    const p = garmentPaint(cap);
    add({ type: 'ellipsoid', c: H(0, 0.072, 0.005), r: [hr(0.09), hr(0.045), hr(0.108)], rot: quatEuler(0.12, 0, 0), paint: p, k: hr(0.01), displace: { amp: hr(0.002), freq: [30, 30, 30] }, clip: [above(H(0, 0.072, 0)[1], H(0, 0.035, 0)[1], 0.003)] });
    add({ type: 'ellipsoid', c: H(0, 0.052, 0.085), r: [hr(0.078), hr(0.009), hr(0.05)], rot: quatEuler(0.3, 0, 0), paint: p, k: hr(0.012), clip: [{ n: [0, 0, -1], o: 0 }] });
  }
  const kerchief = has('kerchief');
  if (kerchief) {
    const p = garmentPaint(kerchief);
    add({ type: 'ellipsoid', c: H(0, 0.026, -0.016), r: [hr(0.084), hr(0.099), hr(0.108)], paint: p, k: hr(0.006), displace: { amp: hr(0.003), freq: [40, 40, 40] }, clip: [{ n: [0, -0.35, 0.94], o: hr(0.045), k: hr(0.008) }, { n: [0, -1, 0], o: hr(0.035), k: hr(0.01) }] });
    add({ type: 'ellipsoid', c: H(0, 0.005, -0.108), r: [hr(0.026), hr(0.02), hr(0.02)], paint: p, k: hr(0.01), displace: { amp: hr(0.003), freq: [60, 60, 60] } });
    add({ type: 'cone', a: H(0, -0.005, -0.112), b: H(0.02, -0.07, -0.118), ra: hr(0.012), rb: hr(0.018), paint: p, k: hr(0.008), displace: { amp: hr(0.002), freq: [60, 30, 60] } });
  }
  if (spec.beard?.style === 'full' || spec.beard?.style === 'walrus') {
    const full = spec.beard.style === 'full';
    if (full) {
      const c = H(0, -0.09 * fl, 0.05);
      add({ type: 'ellipsoid', c, r: [hr(0.064), hr(0.058), hr(0.052)], paint: beardP, k: hr(0.01), displace: { amp: hr(0.005), freq: [70, 20, 70] }, clip: [{ n: [0, 0, -1], o: hr(0.03), k: hr(0.02) }, { n: [0, 0.55, 0.83], o: hr(0.008), k: hr(0.01) }] });
    }
    // Moustache.
    for (const x of [1, -1]) add({ type: 'cone', a: H(0.004 * x, my + 0.014, 0.103), b: H(0.034 * x, my - 0.012, 0.088), ra: hr(0.009), rb: hr(0.006), paint: beardP, k: hr(0.006), displace: { amp: hr(0.0025), freq: [120, 60, 120] } });
  }
  // Face colour: flush on nose and cheeks, shadow round the eyes, stubble.
  s.tint({ c: H(0, -0.03, 0.11), r: hr(0.03), color: flush, amount: 0.25 + age * 0.2, only: [skin] });
  for (const x of [1, -1]) {
    s.tint({ c: H(0.045 * x, -0.035, 0.075), r: hr(0.03), color: flush, amount: 0.2, only: [skin] });
    s.tint({ c: H(0.031 * x, 0.004, 0.09), r: hr(0.022), color: lin(mixHex(spec.skin, '#5a3a4a', 0.45)), amount: 0.35 + age * 0.2, only: [skin] });
  }
  if (spec.beard?.style === 'stubble') {
    s.tint({ c: H(0, -0.09 * fl, 0.06), r: hr(0.065), color: lin(mixHex(spec.skin, spec.beard.color, 0.5)), amount: 0.5, only: [skin] });
  }

  // ------------------------------------------------------------ hands (rigid, finest clay)
  for (const x of [1, -1] as Side[]) {
    const n = x > 0 ? 'l' : 'r';
    s.piece = `hand_${n}`;
    s.bone = `hand_${n}`;
    const gloves = has('gloves');
    const hp = gloves ? garmentPaint(gloves, { gloss: 0.4 }) : skin;
    handShape(s, wrist(x), x, hs * u, spec.hands ?? 'relaxed', hp);
    if (!gloves) s.tint({ c: [wrist(x)[0] - x * 0.02 * hs * u, wrist(x)[1] - 0.09 * hs * u, wrist(x)[2]], r: 0.05 * hs * u, color: flush, amount: 0.25, only: [skin] });
    if (x < 0) {
      const w = wrist(x);
      s.extras.push({
        bone: 'hand_r',
        make: () => {
          const grip = new THREE.Group();
          grip.name = 'grip_r';
          grip.position.set(w[0] - x * 0.022 * hs * u, w[1] - 0.095 * hs * u, w[2]);
          return grip;
        },
      });
    }
  }
  s.extras.push({
    bone: 'head',
    make: () => {
      const helm = new THREE.Group();
      helm.name = 'helm';
      helm.position.set(...headC);
      helm.scale.setScalar(hd * u * 0.97);
      return helm;
    },
  });
  s.piece = 'body';
  s.bone = 'root';
  return s;
}

/** A hand hanging down from the wrist: palm toward the body, thumb forward. */
function handShape(s: Sculpt, w: V3, side: Side, k: number, pose: 'relaxed' | 'fist', paint: number): void {
  // In hand space +X is toward the palm (toward the body): flip for the left hand.
  const X = (x: number) => -side * x;
  const at = (x: number, y: number, z: number): V3 => [w[0] + X(x) * k, w[1] + y * k, w[2] + z * k];
  const add = (p: Prim) => s.add(p);
  add({ type: 'cone', a: at(0, 0.02, 0), b: at(0, -0.02, 0), ra: 0.026 * k, rb: 0.027 * k, paint, k: 0.01 * k });
  add({ type: 'box', c: at(0.001, -0.05, 0.002), h: [0.009 * k, 0.034 * k, 0.03 * k], r: 0.012 * k, paint, k: 0.016 * k });
  // Thenar pad.
  add({ type: 'ellipsoid', c: at(0.013, -0.035, 0.022), r: [0.012 * k, 0.025 * k, 0.014 * k], paint, k: 0.01 * k });
  const fingers: [number, number][] = [[0.026, 0.074], [0.009, 0.082], [-0.009, 0.078], [-0.025, 0.063]];
  const curls = pose === 'fist' ? [1.55, 1.75, 1.1] : [0.22, 0.4, 0.28];
  fingers.forEach(([z, len], i) => {
    let px = 0, py = -0.085, pz = z;
    let ang = (pose === 'fist' ? 0 : 0.05 * i);
    const segs = [0.46, 0.31, 0.23];
    let r = 0.0098 - i * 0.0004;
    for (let j = 0; j < 3; j++) {
      ang += curls[j] * (pose === 'fist' ? 1 : 1 + i * 0.12);
      const l = len * segs[j];
      const nx = px + Math.sin(ang) * l, ny = py - Math.cos(ang) * l;
      const nz = pz + (pose === 'fist' ? 0 : -z * 0.08 * j);
      const r2 = r * 0.86;
      add({ type: 'cone', a: at(px, py, pz), b: at(nx, ny, nz), ra: r * k, rb: r2 * k, paint, k: 0.004 * k });
      // Knuckle bump.
      if (j === 0) add({ type: 'ellipsoid', c: at(px - 0.004, py, pz), r: [0.009 * k, 0.009 * k, 0.009 * k], paint, k: 0.008 * k });
      px = nx; py = ny; pz = nz; r = r2;
    }
  });
  // Thumb.
  const tb = pose === 'fist' ? [[0.018, -0.03, 0.03], [0.034, -0.062, 0.03], [0.036, -0.088, 0.012]] : [[0.016, -0.028, 0.032], [0.03, -0.055, 0.048], [0.036, -0.078, 0.056]];
  add({ type: 'cone', a: at(0.006, -0.012, 0.02), b: at(tb[0][0], tb[0][1], tb[0][2]), ra: 0.014 * k, rb: 0.012 * k, paint, k: 0.01 * k });
  add({ type: 'cone', a: at(tb[0][0], tb[0][1], tb[0][2]), b: at(tb[1][0], tb[1][1], tb[1][2]), ra: 0.0115 * k, rb: 0.0105 * k, paint, k: 0.004 * k });
  add({ type: 'cone', a: at(tb[1][0], tb[1][1], tb[1][2]), b: at(tb[2][0], tb[2][1], tb[2][2]), ra: 0.0102 * k, rb: 0.0088 * k, paint, k: 0.004 * k });
}

/** A glossy painted eyeball looking down +Z. */
function eyeball(r: number, iris: string, at: V3): THREE.Mesh {
  const geo = new THREE.SphereGeometry(r, 20, 14);
  geo.rotateX(Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const paint = new Float32Array(pos.count * 4);
  const ic = lin(iris), sclera = lin('#d9cfc0'), dark = lin('#1a1412'), rimC = lin(mixHex(iris, '#000000', 0.55));
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i) / r;
    const a = Math.acos(Math.max(-1, Math.min(1, z)));
    let c: V3;
    if (a < 0.24) c = dark;
    else if (a < 0.5) c = a > 0.43 ? rimC : ic;
    else c = sclera.map((v) => v * (0.75 + 0.25 * Math.max(0, z))) as V3;
    col.set(c, i * 3);
    paint.set([0, 1, 0, 0.05], i * 4);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('paint', new THREE.BufferAttribute(paint, 4));
  const m = new THREE.Mesh(geo, bakedPainterlyMaterial());
  m.position.set(...at);
  m.name = 'eye';
  return m;
}

function mixHex(a: string, b: string, t: number): string {
  const ca = new THREE.Color(a), cb = new THREE.Color(b);
  return '#' + ca.lerp(cb, t).getHexString();
}

export interface BuiltCharacter {
  root: THREE.Group;
  bones: Map<string, THREE.Object3D>;
  stats: { piece: string; verts: number; tris: number; ms: number }[];
}

export function buildCharacter(spec: CharacterSpec): BuiltCharacter {
  return buildSculpt(sculptCharacter(spec));
}
