// Procedural gates. Pure: no DOM, shared by the game and `scripts/sim.ts`.
// A gate is one spike barrier with a single gap plus a few magnets. Every choice is picked from a small
// discrete set, so `catalogue()` can list every gate the generator can ever produce (up to mirror and
// colour swap, which the simulator covers by testing mirrored entry points and both orb colours).
import { GAP_WIDTHS, GATE_SPACING, TIER_STARTS, VIEW_W } from './config.ts';
import type { Family, GateSpec, Magnet, Pattern, PlacedGate, Polarity, SpikeRow } from './types.ts';

const SPIKE_H = 18;
const BOTTOM_PAD = 30;

const pt = (x: number, y: number, polarity: Polarity, r = 18, field = 220): Magnet => ({ kind: 'point', x, y, r, field, polarity });
const rail = (ax: number, ay: number, bx: number, by: number, polarity: Polarity, r = 6): Magnet => ({ kind: 'rail', ax, ay, bx, by, r, polarity });

/** A full-width spike barrier at y with one gap of width gw centred on gx (pushed inside the walls). */
function barrier(y: number, gx: number, gw: number): SpikeRow[] {
  const gl = Math.max(0, Math.min(VIEW_W - gw, gx - gw / 2));
  const gr = gl + gw;
  const rows: SpikeRow[] = [];
  if (gl >= 8) rows.push({ x: 0, y, w: gl, h: SPIKE_H, dir: 'up' });
  if (VIEW_W - gr >= 8) rows.push({ x: gr, y, w: VIEW_W - gr, h: SPIKE_H, dir: 'up' });
  return rows;
}

const DRIFT_GAPS = [150, 200, 250, 310];
const TWIN_GAPS = [60, 120, 180, 240, 300];
const LEFT = 0;
const RIGHT = VIEW_W;

interface FamilyDef {
  name: string;
  minTier: number;
  /** Number of options for each choice in GateSpec.v. */
  dims: number[];
  build(v: number[], gw: number): { magnets: Magnet[]; barrierY: number; gapX: number };
}

export const FAMILIES: Record<Family, FamilyDef> = {
  // One wall magnet: pull toward it or push away from it to line up with the gap.
  drift: {
    name: 'Drift',
    minTier: 0,
    dims: [DRIFT_GAPS.length, 2],
    build: ([g = 0, y = 0]) => ({ magnets: [pt(110, [110, 170][y]!, 'red', 18, 330)], barrierY: 380, gapX: DRIFT_GAPS[g]! }),
  },
  // A magnet on each wall at different heights, same or opposite colours.
  twin: {
    name: 'Twin',
    minTier: 0,
    dims: [TWIN_GAPS.length, 2],
    build: ([g = 0, p = 0]) => ({
      magnets: [pt(28, 110, 'red', 18, 240), pt(332, 240, p === 0 ? 'blue' : 'red', 18, 240)],
      barrierY: 450,
      gapX: TWIN_GAPS[g]!,
    }),
  },
  // A big magnet over the barrier. Dodge it, or catch it and fling off.
  perch: {
    name: 'Perch',
    minTier: 0,
    dims: [2, 2],
    build: ([m = 0, g = 0]) => {
      const mx = [130, 180][m]!;
      return { magnets: [pt(mx, 170, 'red', 22, 300)], barrierY: 400, gapX: [mx, RIGHT][g]! };
    },
  },
  // A rail down one wall under a steering magnet: slide along the rail or get shoved off it.
  rail: {
    name: 'Rail',
    minTier: 1,
    dims: [2, 2, 2],
    build: ([l = 0, g = 0, p = 0]) => ({
      magnets: [pt(190, 50, p === 0 ? 'blue' : 'red', 16, 260), rail(16, 140, 16, 140 + [200, 260][l]!, 'red')],
      barrierY: 460,
      gapX: [LEFT, RIGHT][g]!,
    }),
  },
  // A sloped rail to ride down and launch off.
  slope: {
    name: 'Slope',
    minTier: 1,
    dims: [2, 2],
    build: ([e = 0, s = 0]) => ({ magnets: [rail(10, [60, 110][s]!, [200, 250][e]!, 230, 'red')], barrierY: 400, gapX: RIGHT }),
  },
  // Two vertical rails around the gap.
  corridor: {
    name: 'Corridor',
    minTier: 2,
    dims: [2, 2],
    build: ([c = 0, p = 0]) => {
      const len = [200, 260][c]!;
      return {
        magnets: [rail(120, 60, 120, 60 + len, 'red'), rail(240, 60, 240, 60 + len, p === 0 ? 'blue' : 'red')],
        barrierY: 440,
        gapX: 180,
      };
    },
  },
};

export const FAMILY_NAMES = Object.keys(FAMILIES) as Family[];

export function tierOf(index: number): number {
  let t = 0;
  for (let i = 0; i < TIER_STARTS.length; i++) if (index >= TIER_STARTS[i]!) t = i;
  return t;
}

export function spacingOf(tier: number): number {
  return GATE_SPACING[Math.min(tier, GATE_SPACING.length - 1)]!;
}

const flipPol = (p: Polarity): Polarity => (p === 'red' ? 'blue' : 'red');

/** Turn a spec into gate-local geometry (x across the playfield, y down from the gate top). */
export function buildGate(spec: GateSpec): Pattern {
  const def = FAMILIES[spec.family];
  const gw = GAP_WIDTHS[Math.min(spec.tier, GAP_WIDTHS.length - 1)]!;
  const { magnets, barrierY, gapX } = def.build(spec.v, gw);
  const mx = (x: number): number => (spec.mirror ? VIEW_W - x : x);
  const pol = (p: Polarity): Polarity => (spec.swap ? flipPol(p) : p);
  const out: Magnet[] = magnets.map((m) =>
    m.kind === 'point' ? { ...m, x: mx(m.x), polarity: pol(m.polarity) } : { ...m, ax: mx(m.ax), bx: mx(m.bx), polarity: pol(m.polarity) },
  );
  return {
    name: def.name,
    height: barrierY + SPIKE_H + BOTTOM_PAD,
    passY: barrierY + SPIKE_H,
    magnets: out,
    spikes: barrier(barrierY, mx(gapX), gw),
  };
}

/** Place a gate in world space. `nextTop` is where the following gate starts. */
export function placeGate(index: number, spec: GateSpec, top: number): PlacedGate & { nextTop: number } {
  const p = buildGate(spec);
  return {
    index,
    spec,
    top,
    height: p.height,
    passY: top + p.passY,
    magnets: p.magnets.map((m) => (m.kind === 'point' ? { ...m, y: m.y + top } : { ...m, ay: m.ay + top, by: m.by + top })),
    spikes: p.spikes.map((s) => ({ ...s, y: s.y + top })),
    nextTop: top + p.height + spacingOf(spec.tier),
  };
}

/** Every canonical spec (not mirrored, colours not swapped) for every tier. */
export function catalogue(): GateSpec[] {
  const out: GateSpec[] = [];
  for (let tier = 0; tier < TIER_STARTS.length; tier++) {
    for (const family of FAMILY_NAMES) {
      const def = FAMILIES[family];
      if (tier < def.minTier) continue;
      const total = def.dims.reduce((a, b) => a * b, 1);
      for (let n = 0; n < total; n++) {
        const v: number[] = [];
        let r = n;
        for (const d of def.dims) {
          v.push(r % d);
          r = Math.floor(r / d);
        }
        out.push({ family, tier, v, mirror: false, swap: false });
      }
    }
  }
  return out;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic endless sequence of gate specs for one run. */
export class GateStream {
  private readonly rand: () => number;
  private readonly forced: GateSpec[];
  private count = 0;
  private last: Family | null = null;

  /** `forced` pins the first specs (used by browser checks). */
  constructor(seed: number, forced: GateSpec[] = []) {
    this.rand = mulberry32(seed);
    this.forced = forced;
  }

  next(): GateSpec {
    const index = this.count++;
    const f = this.forced[index];
    if (f) {
      this.last = f.family;
      return f;
    }
    const tier = tierOf(index);
    const open = FAMILY_NAMES.filter((n) => FAMILIES[n].minTier <= tier && n !== this.last);
    const family = open[Math.floor(this.rand() * open.length)]!;
    this.last = family;
    const v = FAMILIES[family].dims.map((d) => Math.floor(this.rand() * d));
    return { family, tier, v, mirror: this.rand() < 0.5, swap: this.rand() < 0.5 };
  }
}
