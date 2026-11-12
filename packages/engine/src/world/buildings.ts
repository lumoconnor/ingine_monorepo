import * as THREE from 'three';
import type { StaticBatch } from './StaticBatch';
import type { Doorway } from './machinery';

/**
 * Grey-box architecture built into a StaticBatch: houses you can walk into,
 * towers, curtain walls, fences, market stalls and wells. Every builder works
 * in a local frame (x across, z depth, front of the building at local +Z)
 * placed at (x, z) and turned by `yaw` (0 = the front faces world +Z).
 */

export interface HouseColors {
  wall: number;
  roof: number;
  /** Corner posts, lintels, sills. */
  trim: number;
  /** Plinth and steps. */
  base: number;
}

export interface HouseSpec {
  x: number;
  z: number;
  yaw: number;
  /** Outside width (local x) and depth (local z), metres. */
  w: number;
  d: number;
  /** Top of the floor. */
  floorY: number;
  /** Lowest ground under the footprint: the plinth reaches below it. */
  groundY: number;
  /** Ground in front of the door, for steps. Defaults to groundY. */
  doorGroundY?: number;
  /** Eaves height above the floor. */
  wallH: number;
  roof: 'gable' | 'flat';
  /** Ridge height above the eaves (gable roofs). */
  roofH?: number;
  /** Turn the ridge to run across the building instead of front to back. */
  ridgeAcross?: boolean;
  colors: HouseColors;
  /** Door opening in the front wall; omit for a solid building. */
  door?: { width: number; height: number; offset?: number };
  /** Hollow with a floor, ceiling and a little furniture (needs `door`). */
  interior?: boolean;
  chimney?: boolean;
  /** Battlements around a flat roof. */
  crenels?: boolean;
  windows?: boolean;
}

const T = 0.25;
const PANE = 0x2a313b;
const WOOD = 0x6b4f33;
const CLOTH = 0x9b8c6c;

/** Local frame helper: place pieces relative to a building. */
function frame(x: number, z: number, yaw: number) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return {
    /** World (x, z) of a local (lx, lz). */
    at: (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c],
    yaw,
  };
}

/**
 * A house, hall, chapel or keep. Returns the doorway (for addDoor) when it
 * has one; the door itself is a separate moving entity.
 */
export function buildHouse(b: StaticBatch, s: HouseSpec): Doorway | null {
  const f = frame(s.x, s.z, s.yaw);
  const box = (w: number, h: number, d: number, lx: number, y: number, lz: number, color: number, collide = true) => {
    const [x, z] = f.at(lx, lz);
    b.box(w, h, d, x, y, z, color, { yaw: s.yaw, collide });
  };
  const { w, d, floorY: y0, wallH: H, colors: col } = s;
  const hw = w / 2;
  const hd = d / 2;

  // Plinth: the floor (its top is the floor) reaching down into the ground.
  const baseBottom = s.groundY - 0.6;
  box(w + 0.3, y0 - baseBottom, d + 0.3, 0, (y0 + baseBottom) / 2, 0, col.base);

  const hollow = !!(s.interior && s.door);
  if (!hollow) {
    box(w, H, d, 0, y0 + H / 2, 0, col.wall);
  } else {
    // Back and side walls.
    box(w, H, T, 0, y0 + H / 2, -hd + T / 2, col.wall);
    box(T, H, d - 2 * T, -hw + T / 2, y0 + H / 2, 0, col.wall);
    box(T, H, d - 2 * T, hw - T / 2, y0 + H / 2, 0, col.wall);
  }
  // Front wall, around the door.
  if (s.door) {
    const dw = s.door.width;
    const dh = s.door.height;
    const off = s.door.offset ?? 0;
    const l = off - dw / 2;
    const r = off + dw / 2;
    if (hollow) {
      box(l + hw, H, T, (-hw + l) / 2, y0 + H / 2, hd - T / 2, col.wall);
      box(hw - r, H, T, (r + hw) / 2, y0 + H / 2, hd - T / 2, col.wall);
      box(dw, H - dh, T, off, y0 + dh + (H - dh) / 2, hd - T / 2, col.wall);
    } else {
      // A solid building still shows a (shut) door.
      box(dw, dh, 0.08, off, y0 + dh / 2, hd + 0.04, WOOD, false);
    }
    // Lintel and jambs.
    box(dw + 0.3, 0.18, T + 0.08, off, y0 + dh + 0.09, hd - T / 2, col.trim, false);
    for (const sx of [l - 0.07, r + 0.07]) box(0.14, dh, T + 0.06, sx, y0 + dh / 2, hd - T / 2, col.trim, false);
    // Steps up from the street when the floor sits high.
    const below = y0 - (s.doorGroundY ?? s.groundY);
    const steps = Math.ceil(Math.max(0, below - 0.12) / 0.3);
    for (let i = 0; i < steps; i++) {
      const top = y0 - (i + 1) * (below / (steps + 1));
      const depth = 0.4 * (i + 1);
      box(dw + 0.6, top - (s.doorGroundY ?? s.groundY) + 0.5, depth, off, (top + (s.doorGroundY ?? s.groundY) - 0.5) / 2, hd + 0.15 + depth / 2, col.base);
    }
  }

  if (hollow) {
    // Ceiling (so the roof isn't see-through from inside) and some furniture.
    const ch = Math.min(H, 3.1);
    box(w - 2 * T, 0.12, d - 2 * T, 0, y0 + ch - 0.06, 0, col.trim);
    const ix = hw - T - 0.1;
    const iz = hd - T - 0.1;
    box(1.0, 0.5, 2.0, -ix + 0.5, y0 + 0.25, -iz + 1.0, CLOTH); // bed
    box(1.2, 0.08, 0.8, ix - 0.9, y0 + 0.74, -iz + 1.6, WOOD); // table top
    box(0.9, 0.7, 0.5, ix - 0.9, y0 + 0.35, -iz + 1.6, WOOD, false); // table legs (as a block)
    box(0.5, 0.9, 0.5, ix - 0.3, y0 + 0.45, -iz + 0.3, WOOD); // chest of drawers
  }

  // Roof.
  const top = y0 + H;
  if (s.roof === 'gable') {
    const rh = s.roofH ?? Math.min(w, d) * 0.45;
    const across = !!s.ridgeAcross;
    const rw = (across ? d : w) + 0.7;
    const rd = (across ? w : d) + 0.7;
    const [x, z] = f.at(0, 0);
    b.gable(rw, rd, rh, x, top, z, col.roof, { yaw: s.yaw + (across ? Math.PI / 2 : 0) });
    // Gable-end wall infill under the roof triangle is the roof's own end face.
  } else {
    box(w + 0.2, 0.3, d + 0.2, 0, top + 0.15, 0, col.trim);
    if (s.crenels) crenellate(b, f, w, d, top + 0.3, col.wall);
  }
  if (s.chimney) {
    const rh = s.roofH ?? Math.min(w, d) * 0.45;
    box(0.7, rh + 1.2, 0.7, hw * 0.55, top + (rh + 1.2) / 2 - 0.2, -hd * 0.35, col.base);
  }
  // Corner posts.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.22, H, 0.22, sx * (hw - 0.06), y0 + H / 2, sz * (hd - 0.06), col.trim, false);

  if (s.windows) {
    const rows = H > 4.5 ? [1.5, Math.min(H - 1.2, 4.4)] : [1.5];
    const pane = (lx: number, lz: number, along: 'x' | 'z', y: number) => {
      const out = along === 'x' ? [0.8, 0.9, 0.06] : [0.06, 0.9, 0.8];
      box(out[0], out[1], out[2], lx, y, lz, PANE, false);
      box(along === 'x' ? 1.0 : 0.12, 0.1, along === 'x' ? 0.12 : 1.0, lx, y - 0.5, lz, col.trim, false);
    };
    for (const y of rows) {
      for (const sx of [-1, 1]) {
        for (let k = 0; k < Math.max(1, Math.floor(d / 4)); k++) pane(sx * (hw + 0.02), -hd + ((k + 0.5) * d) / Math.max(1, Math.floor(d / 4)), 'z', y0 + y);
      }
      // Front: either side of the door.
      const off = s.door?.offset ?? 0;
      for (const lx of [off - hw / 2 - 0.4, off + hw / 2 + 0.4]) if (Math.abs(lx) < hw - 0.7) pane(lx, hd + 0.02, 'x', y0 + y);
    }
  }

  if (!s.door) return null;
  const off = s.door.offset ?? 0;
  const [cx, cz] = f.at(off, hd - T / 2);
  const [hx, hz] = f.at(off - s.door.width / 2, hd - T / 2);
  return {
    center: [cx, y0, cz],
    hinge: [hx, y0, hz],
    yawDeg: THREE.MathUtils.radToDeg(s.yaw),
    width: s.door.width,
    height: s.door.height,
  };
}

function crenellate(b: StaticBatch, f: ReturnType<typeof frame>, w: number, d: number, y: number, color: number): void {
  const merlon = (lx: number, lz: number, along: boolean) => {
    const [x, z] = f.at(lx, lz);
    b.box(along ? 0.7 : 0.4, 0.8, along ? 0.4 : 0.7, x, y + 0.4, z, color, { yaw: f.yaw });
  };
  for (const sz of [-1, 1]) {
    const n = Math.max(2, Math.round(w / 1.4));
    for (let i = 0; i < n; i++) merlon(-w / 2 + 0.35 + (i * (w - 0.7)) / (n - 1), sz * (d / 2 - 0.2), true);
  }
  for (const sx of [-1, 1]) {
    const n = Math.max(2, Math.round(d / 1.4));
    for (let i = 1; i < n - 1; i++) merlon(sx * (w / 2 - 0.2), -d / 2 + 0.35 + (i * (d - 0.7)) / (n - 1), false);
  }
}

export interface TowerSpec {
  x: number;
  z: number;
  yaw?: number;
  /** Side of the square tower. */
  size: number;
  /** Height above `groundY`. */
  height: number;
  groundY: number;
  color: number;
  /** Pointed roof colour, or battlements when omitted. */
  roof?: number;
  /** A ruin: no top, just a few jagged stubs of wall (this seeds their heights). */
  broken?: number;
}

export function buildTower(b: StaticBatch, s: TowerSpec): void {
  const yaw = s.yaw ?? 0;
  const f = frame(s.x, s.z, yaw);
  const bottom = s.groundY - 1;
  const h = s.height + (s.groundY - bottom);
  b.box(s.size, h, s.size, s.x, bottom + h / 2, s.z, s.color, { yaw });
  const top = s.groundY + s.height;
  if (s.broken !== undefined) {
    // Jagged stubs round the rim instead of a parapet.
    let r = s.broken >>> 0 || 1;
    const rnd = () => ((r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 4294967296);
    const n = Math.max(3, Math.round(s.size / 0.9));
    for (let side = 0; side < 4; side++) {
      for (let i = 0; i < n; i++) {
        if (rnd() < 0.35) continue;
        const u = -s.size / 2 + ((i + 0.5) * s.size) / n;
        const h = 0.3 + rnd() * 1.6;
        const a = (side * Math.PI) / 2;
        const lx = Math.cos(a) * u + Math.sin(a) * (s.size / 2 - 0.25);
        const lz = -Math.sin(a) * u + Math.cos(a) * (s.size / 2 - 0.25);
        const [x, z] = f.at(lx, lz);
        b.box(s.size / n, h, 0.5, x, top + h / 2, z, s.color, { yaw: yaw + a });
      }
    }
  } else if (s.roof !== undefined) {
    b.box(s.size + 0.5, 0.35, s.size + 0.5, s.x, top + 0.17, s.z, s.color, { yaw });
    b.pyramid(s.size + 0.8, s.size + 0.8, s.size * 0.9, s.x, top + 0.35, s.z, s.roof, { yaw });
  } else {
    b.box(s.size + 0.4, 0.35, s.size + 0.4, s.x, top + 0.17, s.z, s.color, { yaw });
    crenellate(b, f, s.size + 0.4, s.size + 0.4, top + 0.35, s.color);
  }
  // Arrow slits on each face.
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const [x, z] = f.at(Math.sin(a) * (s.size / 2 + 0.02), Math.cos(a) * (s.size / 2 + 0.02));
    for (const y of [s.height * 0.45, s.height * 0.75]) b.box(0.2, 0.9, 0.06, x, s.groundY + y, z, PANE, { yaw: yaw + a, collide: false });
  }
}

export interface WallRunSpec {
  from: [number, number];
  to: [number, number];
  /** Height of the walk-top above the ground. */
  height: number;
  thickness: number;
  color: number;
  /** Ground height (the wall follows it in short pieces). */
  groundAt: (x: number, z: number) => number;
  crenels?: boolean;
}

/** A curtain wall or palisade that follows the ground in ~4 m pieces. */
export function buildWallRun(b: StaticBatch, s: WallRunSpec): void {
  const [x0, z0] = s.from;
  const dx = s.to[0] - x0;
  const dz = s.to[1] - z0;
  const len = Math.hypot(dx, dz);
  if (len < 0.5) return;
  const yaw = Math.atan2(dx, dz) + Math.PI / 2;
  const n = Math.max(1, Math.round(len / 4));
  const piece = len / n;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = x0 + dx * t;
    const z = z0 + dz * t;
    // Rest on the lowest ground under this piece so there are no gaps.
    let g = Infinity;
    for (const u of [-0.5, 0, 0.5]) g = Math.min(g, s.groundAt(x + (dx / len) * piece * u, z + (dz / len) * piece * u));
    const bottom = g - 1;
    const top = g + s.height;
    b.box(piece + 0.02, top - bottom, s.thickness, x, (top + bottom) / 2, z, s.color, { yaw });
    if (s.crenels) {
      const m = Math.max(1, Math.round(piece / 1.4));
      for (let k = 0; k < m; k++) {
        const u = -0.5 + (k + 0.5) / m;
        for (const side of [-1, 1]) {
          const ox = x + (dx / len) * piece * u + Math.sin(yaw) * side * (s.thickness / 2 - 0.15);
          const oz = z + (dz / len) * piece * u + Math.cos(yaw) * side * (s.thickness / 2 - 0.15);
          b.box(0.7, 0.8, 0.3, ox, top + 0.4, oz, s.color, { yaw, collide: side === 1 });
        }
      }
    }
  }
}

/** A post-and-rail fence along a line. */
export function buildFence(b: StaticBatch, from: [number, number], to: [number, number], groundAt: (x: number, z: number) => number, color = WOOD): void {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const len = Math.hypot(dx, dz);
  if (len < 0.5) return;
  const yaw = Math.atan2(dx, dz) + Math.PI / 2;
  const n = Math.max(1, Math.round(len / 2.5));
  for (let i = 0; i <= n; i++) {
    const x = from[0] + (dx * i) / n;
    const z = from[1] + (dz * i) / n;
    const g = groundAt(x, z);
    b.box(0.14, 1.3, 0.14, x, g + 0.4, z, color, { collide: false });
    if (i < n) {
      const mx = from[0] + (dx * (i + 0.5)) / n;
      const mz = from[1] + (dz * (i + 0.5)) / n;
      const mg = groundAt(mx, mz);
      for (const y of [0.45, 0.9]) b.box(len / n, 0.1, 0.06, mx, mg + y, mz, color, { yaw, collide: y > 0.5 });
    }
  }
}

/** A market stall: counter, four posts and a cloth awning. Front at local +Z. */
export function buildStall(b: StaticBatch, x: number, z: number, yaw: number, groundY: number, cloth: number): void {
  const f = frame(x, z, yaw);
  const put = (w: number, h: number, d: number, lx: number, y: number, lz: number, color: number, collide = true) => {
    const [px, pz] = f.at(lx, lz);
    b.box(w, h, d, px, y, pz, color, { yaw, collide });
  };
  put(2.6, 0.95, 0.7, 0, groundY + 0.47, 0.6, WOOD);
  for (const sx of [-1.3, 1.3]) for (const sz of [-0.9, 0.95]) put(0.1, 2.4, 0.1, sx, groundY + 1.2, sz, WOOD, false);
  const [px, pz] = f.at(0, 0);
  b.gable(2.0, 3.0, 0.5, px, groundY + 2.4, pz, cloth, { yaw: yaw + Math.PI / 2, collide: false });
  // A few crates of goods.
  put(0.5, 0.4, 0.4, -0.7, groundY + 1.15, 0.6, 0xb98a4b, false);
  put(0.4, 0.3, 0.4, 0.5, groundY + 1.1, 0.55, 0x8fae5a, false);
}

/** A stone well with a little roof. */
export function buildWell(b: StaticBatch, x: number, z: number, groundY: number, stone: number, roof: number): void {
  b.cylinder(1.1, 0.9, x, groundY - 0.2, z, stone, { segments: 12 });
  b.cylinder(0.85, 0.02, x, groundY + 0.6, z, PANE, { collide: false, segments: 12 });
  for (const s of [-1, 1]) b.box(0.14, 2.2, 0.14, x + s * 0.95, groundY + 1.1, z, WOOD, { collide: false });
  b.box(2.1, 0.1, 0.1, x, groundY + 1.7, z, WOOD, { collide: false });
  b.gable(1.4, 2.4, 0.6, x, groundY + 2.2, z, roof, { yaw: Math.PI / 2, collide: false });
}
