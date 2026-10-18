// Gate generator. Pure: no DOM, no randomness outside the seeded stream, and time comes from the run clock,
// so the simulator can enumerate every gate (`catalogue`) and replay moving ones deterministically.
import { CEIL, FLOOR, MID, TIER_STARTS, TUTORIAL_GATES } from './config.ts';
import { CAPSULE, CIRCLE, FAMILIES, RECT, type Family, type Gate, type GateSpec, type Orb, type Polarity, type Shape, type ShapeKind, type Zone } from './types.ts';

const TAU = Math.PI * 2;

/** Number of choices for each slot of `GateSpec.v`, per family. */
export const RANGES: Record<Family, readonly number[]> = {
  // opening: top, middle, bottom
  wall: [3],
  // divider centre; lane locks: natural, alternating, inverted; divider moving
  dual: [3, 3, 2],
  // paddles swapped; paddle length
  pinball: [2, 2],
  // blocked lane: none, upper, lower; blocker is a grinder
  splitter: [3, 2],
  // centre; long; narrow
  tunnel: [3, 2, 2],
  // opening centre; door polarity: red, blue
  door: [3, 2],
  // mirrored; free swing
  pendulum: [2, 2],
  // block count 3 or 4; first block on the ceiling or floor; tight gap
  rails: [2, 2, 2],
};

/** The lowest tier a spec can appear at. */
export function requiredTier(spec: GateSpec): number {
  const v = spec.v;
  const at = (i: number): number => v[i] ?? 0;
  switch (spec.family) {
    case 'wall':
      return 0;
    case 'dual':
      return Math.max(at(1) === 1 ? 1 : at(1) === 2 ? 2 : 0, at(2) ? 1 : 0);
    case 'pinball':
      return at(0) ? 2 : 0;
    case 'splitter':
      return at(1) ? (at(0) ? 2 : 99) : 0;
    case 'tunnel':
      return Math.max(at(1) ? 1 : 0, at(2) ? 2 : 0);
    case 'door':
      // A door whose colour fights the natural pull (blue high, red low) needs a two-flip approach.
      return (at(0) === 0 && at(1) === 1) || (at(0) === 2 && at(1) === 0) ? 1 : 0;
    case 'pendulum':
      return at(1) ? 2 : 1;
    case 'rails':
      return Math.max(at(0) ? 1 : 0, at(2) ? 2 : 0);
  }
}

/** Every distinct gate the generator can produce, at the lowest tier it can appear. */
export function catalogue(): GateSpec[] {
  const out: GateSpec[] = [];
  for (const family of FAMILIES) {
    const ranges = RANGES[family];
    const v = ranges.map(() => 0);
    for (;;) {
      const spec: GateSpec = { family, tier: 0, v: v.slice() };
      const t = requiredTier(spec);
      if (t <= 3) out.push({ ...spec, tier: t });
      let i = 0;
      while (i < ranges.length) {
        v[i] = (v[i] ?? 0) + 1;
        if ((v[i] ?? 0) < (ranges[i] ?? 1)) break;
        v[i] = 0;
        i++;
      }
      if (i === ranges.length) break;
    }
  }
  return out;
}

export function tierOf(index: number): number {
  let t = 0;
  for (let i = 0; i < TIER_STARTS.length; i++) if (index >= (TIER_STARTS[i] ?? 0)) t = i;
  return t;
}

/** The fixed tutorial: upper pull, lower pull, switch mid-arc, gate choice, pinball, recovery. */
export const TUTORIAL: readonly GateSpec[] = [
  { family: 'wall', tier: 0, v: [0] },
  { family: 'wall', tier: 0, v: [2] },
  { family: 'wall', tier: 0, v: [1] },
  { family: 'dual', tier: 0, v: [0, 0, 0] },
  { family: 'pinball', tier: 0, v: [0, 0] },
  { family: 'door', tier: 0, v: [1, 0] },
];

export const TUTORIAL_HINTS: readonly string[] = [
  'TAP TO FLIP: RED PULLS UP',
  'TAP AGAIN: BLUE PULLS DOWN',
  'FLIP MID-ARC TO HOLD THE MIDDLE',
  'MATCH THE LANE COLOUR',
  'PADDLES OPEN FOR ONE COLOUR',
  'WRONG COLOUR BOUNCES YOU. RECOVER!',
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATALOGUE = catalogue();

/** Seeded gate sequence: tutorial first, then random gates from the current tier, never the same family twice running. */
export class GateStream {
  private readonly rand: () => number;
  private lastFamily: Family | null = null;
  constructor(seed: number) {
    this.rand = mulberry32(seed);
  }

  next(index: number): GateSpec {
    if (index < TUTORIAL_GATES) {
      const s = TUTORIAL[index] ?? TUTORIAL[0]!;
      this.lastFamily = s.family;
      return { family: s.family, tier: 0, v: s.v.slice() };
    }
    const tier = tierOf(index);
    const families = FAMILIES.filter((f) => f !== this.lastFamily && CATALOGUE.some((c) => c.family === f && c.tier <= tier));
    // Plain walls are filler: half weight.
    let total = 0;
    for (const f of families) total += f === 'wall' ? 0.5 : 1;
    let r = this.rand() * total;
    let family = families[0]!;
    for (const f of families) {
      r -= f === 'wall' ? 0.5 : 1;
      if (r <= 0) {
        family = f;
        break;
      }
    }
    // New-this-tier variants get double weight so the difficulty step is felt.
    const options = CATALOGUE.filter((c) => c.family === family && c.tier <= tier);
    let wt = 0;
    for (const o of options) wt += o.tier === tier && tier > 0 ? 2 : 1;
    let q = this.rand() * wt;
    let pick = options[0]!;
    for (const o of options) {
      q -= o.tier === tier && tier > 0 ? 2 : 1;
      if (q <= 0) {
        pick = o;
        break;
      }
    }
    this.lastFamily = family;
    return { family, tier, v: pick.v.slice() };
  }
}

// ---------- Geometry ----------

const WALL_T = 28;
const WALL_OPEN = 130;
const WALL_CENTRES = [CEIL + WALL_OPEN / 2, MID, FLOOR - WALL_OPEN / 2] as const;

const DUAL_LEN = 170;
const DUAL_BLOCK = 44;
const DUAL_CENTRES = [MID, MID - 30, MID + 30] as const;
const DUAL_LOCK_W = 10;
export const DUAL_MOVE = 36;
export const DUAL_MOVE_PERIOD = 3.2;
export const DUAL_SWAP_PERIOD = 2.6;

export const PIN_HINGE = 200;
const PIN_LEN = [165, 180] as const;
const PIN_R = 7;
/** Open paddles swing up into a slot in the rail, so they never pinch the orb against it. */
export const PIN_OPEN = Math.PI / 2 + 0.06;
export const PIN_HINGE_SINK = 8;
export const PIN_CLOSED = 0.35;
const PIN_RATE = 7;

const SPLIT_LEN = 260;
const SPLIT_T = 14;
const SPLIT_UPPER = 125;
const SPLIT_LOWER = 235;

const TUNNEL_CENTRES = [MID, MID - 40, MID + 40] as const;

const DOOR_CENTRES = [100, MID, 260] as const;
const DOOR_OPEN = 120;
export const DOOR_RANGE = 260;
const DOOR_OPEN_RATE = 6;
const DOOR_CLOSE_RATE = 3;

export const PEND_PIVOT = 260;
const PEND_ROD = 175;
export const PEND_MASS_R = 28;
const PEND_TARGET = 0.85;
const PEND_K = 40;
const PEND_C = 6;
const PEND_FREE_AMP = 0.35;
const PEND_FREE_PERIOD = 2.6;
export const PEND_BLOCK_TOP = 240;
export const PEND_HOUSING_OFFSET = 150;

const RAIL_W = 44;
const RAIL_STEP = 190;

function shape(type: number, kind: ShapeKind, pol: Polarity | null = null): Shape {
  return { type, kind, x: 0, y: 0, w: 0, h: 0, x2: 0, y2: 0, r: 0, vx: 0, vy: 0, px: 0, py: 0, omega: 0, on: true, pol };
}

function rect(kind: ShapeKind, x: number, y: number, w: number, h: number, pol: Polarity | null = null): Shape {
  const s = shape(RECT, kind, pol);
  s.x = x;
  s.y = y;
  s.w = w;
  s.h = h;
  return s;
}

const at = (spec: GateSpec, i: number): number => spec.v[i] ?? 0;

/** Lay a gate out with its left edge at world x. */
export function buildGate(spec: GateSpec, index: number, x: number): Gate {
  const shapes: Shape[] = [];
  const zones: Zone[] = [];
  const s: number[] = [];
  let width = 0;
  let keyX = 0;
  switch (spec.family) {
    case 'wall': {
      const c = WALL_CENTRES[at(spec, 0)] ?? MID;
      const top = c - WALL_OPEN / 2;
      const bot = c + WALL_OPEN / 2;
      if (top > CEIL + 1) shapes.push(rect('iron', x, CEIL, WALL_T, top - CEIL));
      if (bot < FLOOR - 1) shapes.push(rect('iron', x, bot, WALL_T, FLOOR - bot));
      width = WALL_T;
      keyX = WALL_T / 2;
      break;
    }
    case 'dual': {
      const c = DUAL_CENTRES[at(spec, 0)] ?? MID;
      shapes.push(rect('iron', x, c - DUAL_BLOCK / 2, DUAL_LEN, DUAL_BLOCK));
      shapes.push(rect('lock', x, CEIL, DUAL_LOCK_W, 1, 'red'));
      shapes.push(rect('lock', x, CEIL, DUAL_LOCK_W, 1, 'blue'));
      width = DUAL_LEN;
      keyX = DUAL_LEN / 2;
      break;
    }
    case 'pinball': {
      const top = shape(CAPSULE, 'paddle');
      const bot = shape(CAPSULE, 'paddle');
      top.r = bot.r = PIN_R;
      shapes.push(top, bot);
      // [top angle, bottom angle, top omega, bottom omega]
      s.push(PIN_CLOSED, PIN_CLOSED, 0, 0);
      width = PIN_HINGE + 14;
      keyX = PIN_HINGE - 50;
      break;
    }
    case 'splitter': {
      shapes.push(rect('plate', x, SPLIT_UPPER - SPLIT_T / 2, SPLIT_LEN, SPLIT_T));
      shapes.push(rect('plate', x, SPLIT_LOWER - SPLIT_T / 2, SPLIT_LEN, SPLIT_T));
      zones.push({ kind: 'neutral', x, y: SPLIT_UPPER + SPLIT_T / 2, w: SPLIT_LEN, h: SPLIT_LOWER - SPLIT_UPPER - SPLIT_T });
      const blocked = at(spec, 0);
      const kind: ShapeKind = at(spec, 1) ? 'grinder' : 'iron';
      if (blocked === 1) shapes.push(rect(kind, x + 110, CEIL, 50, 72 - CEIL));
      if (blocked === 2) shapes.push(rect(kind, x + 110, FLOOR - 42, 50, 42));
      width = SPLIT_LEN;
      keyX = 200;
      break;
    }
    case 'tunnel': {
      const c = TUNNEL_CENTRES[at(spec, 0)] ?? MID;
      const h = at(spec, 2) ? 80 : 96;
      const len = at(spec, 1) ? 320 : 220;
      shapes.push(rect('tunnel', x, CEIL, len, c - h / 2 - CEIL));
      shapes.push(rect('tunnel', x, c + h / 2, len, FLOOR - (c + h / 2)));
      zones.push({ kind: 'tunnel', x, y: c - h / 2, w: len, h });
      width = len;
      keyX = len / 2;
      break;
    }
    case 'door': {
      const c = DOOR_CENTRES[at(spec, 0)] ?? MID;
      const pol: Polarity = at(spec, 1) ? 'blue' : 'red';
      const top = c - DOOR_OPEN / 2;
      const bot = c + DOOR_OPEN / 2;
      if (top > CEIL + 1) shapes.push(rect('iron', x, CEIL, WALL_T, top - CEIL));
      if (bot < FLOOR - 1) shapes.push(rect('iron', x, bot, WALL_T, FLOOR - bot));
      shapes.push(rect('door', x, top, WALL_T, DOOR_OPEN / 2, pol));
      shapes.push(rect('door', x, c, WALL_T, DOOR_OPEN / 2, pol));
      // [open fraction]
      s.push(0);
      width = WALL_T;
      keyX = WALL_T / 2;
      break;
    }
    case 'pendulum': {
      const rod = shape(CAPSULE, 'rod');
      rod.r = 5;
      const mass = shape(CIRCLE, 'mass');
      mass.r = PEND_MASS_R;
      shapes.push(rod, mass);
      shapes.push(rect('iron', x + PEND_PIVOT - 60, PEND_BLOCK_TOP, 120, FLOOR - PEND_BLOCK_TOP));
      // [angle, angular speed]
      s.push(pendTarget(spec, 'blue', 0), 0);
      width = PEND_PIVOT + 200;
      keyX = PEND_PIVOT;
      break;
    }
    case 'rails': {
      const n = at(spec, 0) ? 4 : 3;
      const gap = at(spec, 2) ? 128 : 150;
      for (let i = 0; i < n; i++) {
        const ceiling = (i + at(spec, 1)) % 2 === 0;
        if (ceiling) shapes.push(rect('iron', x + i * RAIL_STEP, CEIL, RAIL_W, FLOOR - gap - CEIL));
        else shapes.push(rect('iron', x + i * RAIL_STEP, CEIL + gap, RAIL_W, FLOOR - gap - CEIL));
      }
      width = (n - 1) * RAIL_STEP + RAIL_W;
      keyX = Math.floor((n - 1) / 2) * RAIL_STEP + RAIL_W / 2;
      break;
    }
  }
  const g: Gate = { index, spec, x, width, keyX: x + keyX, shapes, zones, s, touched: false, scored: false, centre: null };
  return g;
}

function pendTarget(spec: GateSpec, pol: Polarity, t: number): number {
  const side = (pol === 'blue' ? 1 : -1) * (at(spec, 0) ? -1 : 1);
  return side * PEND_TARGET + (at(spec, 1) ? PEND_FREE_AMP * Math.sin((TAU * t) / PEND_FREE_PERIOD) : 0);
}

/** Lane colour of the dual gate's upper lane right now. */
export function dualTopPolarity(spec: GateSpec, t: number): Polarity {
  const mode = at(spec, 1);
  if (mode === 2) return 'blue';
  if (mode === 1) return Math.floor(t / DUAL_SWAP_PERIOD) % 2 === 0 ? 'red' : 'blue';
  return 'red';
}

/** Which paddle is open for this polarity: true = the top one. */
export function pinballTopOpen(spec: GateSpec, pol: Polarity): boolean {
  return (pol === 'red') !== (at(spec, 0) === 1);
}

function moveToward(a: number, b: number, step: number): number {
  return a < b ? Math.min(b, a + step) : Math.max(b, a - step);
}

/** Advance a gate's machinery to run time t and reposition its shapes. */
export function updateGate(g: Gate, t: number, orb: Orb, dt: number): void {
  const spec = g.spec;
  const x = g.x;
  switch (spec.family) {
    case 'dual': {
      const c = DUAL_CENTRES[at(spec, 0)] ?? MID;
      const moving = at(spec, 2) === 1;
      const off = moving ? DUAL_MOVE * Math.sin((TAU * t) / DUAL_MOVE_PERIOD) : 0;
      const vy = moving ? ((DUAL_MOVE * TAU) / DUAL_MOVE_PERIOD) * Math.cos((TAU * t) / DUAL_MOVE_PERIOD) : 0;
      const block = g.shapes[0]!;
      block.y = c - DUAL_BLOCK / 2 + off;
      block.vy = vy;
      const topPol = dualTopPolarity(spec, t);
      const upper = g.shapes[1]!;
      const lower = g.shapes[2]!;
      upper.pol = topPol;
      lower.pol = topPol === 'red' ? 'blue' : 'red';
      upper.y = CEIL;
      upper.h = block.y - CEIL;
      lower.y = block.y + DUAL_BLOCK;
      lower.h = FLOOR - lower.y;
      upper.on = orb.polarity !== upper.pol;
      lower.on = orb.polarity !== lower.pol;
      break;
    }
    case 'pinball': {
      const topOpen = pinballTopOpen(spec, orb.polarity);
      const len = PIN_LEN[at(spec, 1)] ?? PIN_LEN[0];
      for (let i = 0; i < 2; i++) {
        const target = (i === 0) === topOpen ? PIN_OPEN : PIN_CLOSED;
        const a0 = g.s[i] ?? PIN_CLOSED;
        const a1 = moveToward(a0, target, PIN_RATE * dt);
        g.s[i] = a1;
        g.s[i + 2] = dt > 0 ? (a1 - a0) / dt : 0;
        const p = g.shapes[i]!;
        const hy = i === 0 ? CEIL - PIN_HINGE_SINK : FLOOR + PIN_HINGE_SINK;
        const sgn = i === 0 ? 1 : -1;
        p.x = p.px = x + PIN_HINGE;
        p.y = p.py = hy;
        p.x2 = p.x - len * Math.sin(a1);
        p.y2 = hy + sgn * len * Math.cos(a1);
        // Rotation rate about the hinge, in screen orientation (see Shape.omega).
        p.omega = sgn * (g.s[i + 2] ?? 0);
        p.pol = i === 0 ? (at(spec, 0) ? 'blue' : 'red') : at(spec, 0) ? 'red' : 'blue';
      }
      break;
    }
    case 'door': {
      const pol = at(spec, 1) ? 'blue' : 'red';
      const near = orb.x > x - DOOR_RANGE && orb.x < x + 60;
      const open = g.s[0] ?? 0;
      const next = near && orb.polarity === pol ? Math.min(1, open + DOOR_OPEN_RATE * dt) : Math.max(0, open - DOOR_CLOSE_RATE * dt);
      g.s[0] = next;
      const c = DOOR_CENTRES[at(spec, 0)] ?? MID;
      const half = (DOOR_OPEN / 2) * (1 - next);
      const up = g.shapes[g.shapes.length - 2]!;
      const dn = g.shapes[g.shapes.length - 1]!;
      up.y = c - DOOR_OPEN / 2;
      up.h = half;
      dn.y = c + DOOR_OPEN / 2 - half;
      dn.h = half;
      up.on = dn.on = half > 0.5;
      break;
    }
    case 'pendulum': {
      const target = pendTarget(spec, orb.polarity, t);
      let th = g.s[0] ?? 0;
      let om = g.s[1] ?? 0;
      om += (-PEND_K * (th - target) - PEND_C * om) * dt;
      th += om * dt;
      g.s[0] = th;
      g.s[1] = om;
      const px = x + PEND_PIVOT;
      const py = CEIL;
      const mx = px + PEND_ROD * Math.sin(th);
      const my = py + PEND_ROD * Math.cos(th);
      const rod = g.shapes[0]!;
      const mass = g.shapes[1]!;
      rod.x = rod.px = mass.px = px;
      rod.y = rod.py = mass.py = py;
      rod.x2 = mx;
      rod.y2 = my;
      // Angle grows clockwise on screen, so the screen-space rotation rate is -om.
      rod.omega = mass.omega = -om;
      mass.x = mx;
      mass.y = my;
      mass.vx = PEND_ROD * om * Math.cos(th);
      mass.vy = -PEND_ROD * om * Math.sin(th);
      break;
    }
    default:
      break;
  }
}

/** Deep copy for search: shapes and live state are independent of the original. */
export function cloneGate(g: Gate): Gate {
  return { ...g, shapes: g.shapes.map((s) => ({ ...s })), zones: g.zones, s: g.s.slice() };
}

/** Gate families that react to polarity and need the orb's live state (for drawing hints). */
export function familyLabel(f: Family): string {
  switch (f) {
    case 'wall':
      return 'Wall';
    case 'dual':
      return 'Dual-polarity gate';
    case 'pinball':
      return 'Pinball gate';
    case 'splitter':
      return 'Lane splitter';
    case 'tunnel':
      return 'Magnetic tunnel';
    case 'door':
      return 'Repulsion door';
    case 'pendulum':
      return 'Iron pendulum';
    case 'rails':
      return 'Alternating rails';
  }
}
