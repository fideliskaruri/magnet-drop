// Procedural magnetic gates. Pure: no DOM, shared by the game and `scripts/sim.ts`.
// A gate is a barrier across the shaft: neutral steel shelves that slope down toward one or more openings,
// with magnetic machinery in or above the openings. Every choice is picked from a small discrete set, so
// `catalogue()` can list every gate the generator can ever produce (up to mirror and colour swap, which the
// simulator covers by testing mirrored entry points and both orb colours). Timed parts are a pure function of
// run time plus a per-gate phase, so the simulator can replay them exactly.
import { CAMERA_RAMP_CAP, GATE_SPACING, TIER_GAIN, TIER_STARTS, TUTORIAL_GATES, VIEW_W } from './config.ts';
import { TUNE } from './tune.ts';
import type { Family, GateSpec, Lane, Machine, Magnet, Orb, Pattern, PlacedGate, Polarity, Saw, Solid } from './types.ts';

const W = VIEW_W;
/** How far a shelf rises from its low end (at an opening) to its high end, at most. */
const SHELF_DROP = 26;
/** Space below the barrier before the gate ends. */
const BOTTOM_PAD = 40;
/** The orb counts as through once its centre is this far below the barrier line. */
const PASS_BELOW = 10;
/** Machinery reacts to the orb from this far above its barrier line. */
const REACT_ABOVE = 230;

const pt = (x: number, y: number, polarity: Polarity, field = 180, r = 16): Magnet => ({ kind: 'point', x, y, r, field, reach: field, polarity, gain: 1 });
const rail = (ax: number, ay: number, bx: number, by: number, polarity: Polarity, kick: { x: number; y: number } | null = null): Magnet => ({
  kind: 'rail',
  ax,
  ay,
  bx,
  by,
  r: 6,
  reach: 0,
  polarity,
  gain: 1,
  kick,
});
const steel = (ax: number, ay: number, bx: number, by: number, r = 6): Solid => ({ kind: 'steel', ax, ay, bx, by, r, polarity: null });
const door = (x0: number, x1: number, y: number, polarity: Polarity): Solid => ({ kind: 'door', ax: x0, ay: y, bx: x1, by: y, r: 7, polarity });
const saw = (ax: number, ay: number, bx = ax, by = ay, period = 0, r = 15): Saw => ({ x: ax, y: ay, r, ax, ay, bx, by, period });

/**
 * Steel shelves across the whole width at barrier line y, leaving the given openings (sorted x ranges).
 * Every shelf slopes down toward the openings beside it, so an orb that lands on steel rolls (slowly) to a way out.
 */
function shelves(y: number, openings: Lane[]): Solid[] {
  const out: Solid[] = [];
  let x = 0;
  let lowLeft = false;
  for (let i = 0; i <= openings.length; i++) {
    const end = openings[i]?.x0 ?? W;
    const lowRight = i < openings.length;
    const len = end - x;
    if (len > 2) {
      const drop = Math.min(SHELF_DROP, len * 0.22);
      if (lowLeft && lowRight) {
        const mid = (x + end) / 2;
        out.push(steel(x, y, mid, y - drop), steel(mid, y - drop, end, y));
      } else if (lowRight) {
        out.push(steel(x, y - drop, end, y));
      } else {
        out.push(steel(x, y, end, y - drop));
      }
    }
    const o = openings[i];
    if (o) {
      x = o.x1;
      lowLeft = true;
    }
  }
  return out;
}

interface Parts {
  /** Barrier line (gate-local y). */
  B: number;
  magnets?: Magnet[];
  solids?: Solid[];
  saws?: Saw[];
  machine?: Machine;
  /** State the machine starts in. */
  state?: number[];
  lanes: Lane[];
}

interface Variant {
  minTier: number;
  build(tier: number): Parts;
}

interface FamilyDef {
  name: string;
  /** Lowest tier the random stream may pick it at. Tutorial gates are never picked at random. */
  minTier: number;
  tutorial?: boolean;
  hint?: string;
  variants: Variant[];
}

const pick = <T>(list: readonly T[], tier: number): T => list[Math.min(tier, list.length - 1)]!;

// Polarity gate: two shutters side by side, red and blue. Each lets the opposite colour drop through and
// holds your own colour up on a cushion until you flip.
const POLARITY_HALF = [85, 75, 66, 58];
function polarityGate(tier: number, sx: number, extra: Partial<Parts> = {}): Parts {
  const B = 270;
  const dw = pick(POLARITY_HALF, tier);
  const lanes = [
    { x0: sx - dw, x1: sx },
    { x0: sx, x1: sx + dw },
  ];
  return {
    B,
    solids: [...shelves(B, [{ x0: sx - dw, x1: sx + dw }]), door(sx - dw, sx - 3, B, 'red'), door(sx + 3, sx + dw, B, 'blue'), steel(sx, B - 16, sx, B, 4)],
    lanes,
    ...extra,
  };
}

// Magnetic iris: two hinged arms that swing open while you carry the iris colour.
const IRIS_OPEN = [140, 120, 104, 92];
function irisGate(tier: number, cx: number, magnets: Magnet[] = []): Parts {
  const B = 250;
  const open = pick(IRIS_OPEN, tier);
  const lx = cx - open / 2;
  const rx = cx + open / 2;
  const solids = shelves(B, [{ x0: lx, x1: rx }]);
  const arms: [number, number] = [solids.length, solids.length + 1];
  solids.push({ kind: 'arm', ax: lx, ay: B, bx: cx, by: B, r: 6, polarity: 'red' }, { kind: 'arm', ax: rx, ay: B, bx: cx, by: B, r: 6, polarity: 'red' });
  return {
    B,
    magnets,
    solids,
    machine: { type: 'iris', lx, rx, y: B, len: open / 2 - 1, polarity: 'red', arms },
    state: [0],
    lanes: [{ x0: lx, x1: rx }],
  };
}

// Alternating gate: shutters that swap colour on a beat. Read the timing, or flip to match.
const ALT_PERIOD = [2, 1.8, 1.5, 1.3];
const ALT_WIDTH = [150, 130, 115, 100];
function altGate(tier: number, layout: 'single' | 'split' | 'off', withSaw = false): Parts {
  const B = 250;
  const w = pick(ALT_WIDTH, tier);
  const period = pick(ALT_PERIOD, tier);
  let lanes: Lane[];
  let doors: Solid[];
  const posts: Solid[] = [];
  if (layout === 'split') {
    const h = Math.round(w * 0.6);
    lanes = [
      { x0: 180 - h, x1: 180 },
      { x0: 180, x1: 180 + h },
    ];
    doors = [door(180 - h, 177, B, 'red'), door(183, 180 + h, B, 'blue')];
    posts.push(steel(180, B - 16, 180, B, 4));
  } else {
    const cx = layout === 'off' ? 120 : 180;
    lanes = [{ x0: cx - w / 2, x1: cx + w / 2 }];
    doors = [door(cx - w / 2, cx + w / 2, B, 'red')];
  }
  const solids = shelves(B, [{ x0: lanes[0]!.x0, x1: lanes[lanes.length - 1]!.x1 }]);
  const idx = doors.map((_, i) => solids.length + i);
  solids.push(...doors, ...posts);
  return {
    B,
    solids,
    // A saw sweeps under the opening: hover on a door in your own colour until it has passed.
    saws: withSaw ? [saw(lanes[0]!.x0 + 6, B + 32, lanes[lanes.length - 1]!.x1 - 6, B + 32, 3.2, 12)] : [],
    machine: { type: 'alt', period, doors: idx, base: doors.map((d) => d.polarity!) },
    lanes,
  };
}

// Neutral iron gate: a heavy slab on a track. You can't move it; the end magnet in your colour drags it.
const SLAB_W = [120, 130, 140, 150];
const TRACK_L = 30;
const TRACK_R = 330;
function ironGate(tier: number, above: boolean): Parts {
  const B = 260;
  const w = pick(SLAB_W, tier);
  const x0 = TRACK_L + w / 2;
  const x1 = TRACK_R - w / 2;
  const mid = (x0 + x1) / 2;
  const solids: Solid[] = [{ kind: 'slab', ax: mid - w / 2 + 9, ay: B, bx: mid + w / 2 - 9, by: B, r: 9, polarity: null }];
  const magnets = [pt(15, B, 'red', 130, 14), pt(W - 15, B, 'blue', 130, 14)];
  if (above) magnets.push(pt(180, B - 160, 'blue', 150));
  return {
    B,
    magnets,
    solids,
    machine: { type: 'slab', x0, x1, y: B, w, redLeft: true, slab: 0 },
    state: [mid, 0],
    lanes: [
      { x0: TRACK_L, x1: TRACK_R - w },
      { x0: TRACK_L + w, x1: TRACK_R },
    ],
  };
}

function railGate(variant: number): Parts {
  if (variant === 1) {
    const B = 330;
    return { B, magnets: [rail(14, 90, 170, 250, 'red')], solids: shelves(B, [{ x0: 240, x1: 310 }]), lanes: [{ x0: 240, x1: 310 }] };
  }
  if (variant === 2) {
    // Zigzag: ride one rail, flip across to the other, ride it out.
    const B = 400;
    return {
      B,
      magnets: [rail(14, 60, 170, 150, 'red'), rail(W - 14, 190, 190, 280, 'blue')],
      solids: shelves(B, [{ x0: 40, x1: 115 }]),
      lanes: [{ x0: 40, x1: 115 }],
    };
  }
  const B = 330;
  return {
    B,
    magnets: [rail(14, 60, 210, 230, 'red')],
    solids: shelves(B, [{ x0: 260, x1: 330 }]),
    saws: variant === 3 ? [saw(236, 268, 236, 268, 0, 14)] : [],
    lanes: [{ x0: 260, x1: 330 }],
  };
}

function flipperGate(variant: number): Parts {
  const B = 310;
  if (variant === 0) {
    // Side kicker: match the paddle and it kicks you toward the exit; the other colour sticks and slides.
    return {
      B,
      magnets: [rail(30, B - 160, 196, B - 110, 'red', { x: 0.55, y: -0.84 })],
      solids: shelves(B, [{ x0: 250, x1: 320 }]),
      lanes: [{ x0: 250, x1: 320 }],
    };
  }
  // V funnel: two paddles slope into a narrow centre exit.
  const right: Polarity = variant === 2 ? 'red' : 'blue';
  return {
    B,
    magnets: [rail(14, B - 180, 146, B - 96, 'red', { x: 0.3, y: -0.95 }), rail(W - 14, B - 180, W - 146, B - 96, right, { x: -0.3, y: -0.95 })],
    solids: shelves(B, [{ x0: 150, x1: 210 }]),
    lanes: [{ x0: 150, x1: 210 }],
  };
}

export const FAMILIES: Record<Family, FamilyDef> = {
  'learn-attract': {
    name: 'Attract',
    minTier: 0,
    tutorial: true,
    hint: 'OPPOSITE COLOURS ATTRACT',
    variants: [
      {
        minTier: 0,
        build: () => {
          const B = 230;
          return { B, solids: [...shelves(B, [{ x0: 120, x1: 240 }]), door(120, 240, B, 'blue')], lanes: [{ x0: 120, x1: 240 }] };
        },
      },
    ],
  },
  'learn-repel': {
    name: 'Repel',
    minTier: 0,
    tutorial: true,
    hint: 'SAME COLOURS PUSH APART',
    variants: [
      {
        minTier: 0,
        build: () => {
          const B = 300;
          return { B, magnets: [pt(215, B - 140, 'red', 190)], solids: shelves(B, [{ x0: 40, x1: 130 }]), lanes: [{ x0: 40, x1: 130 }] };
        },
      },
    ],
  },
  'learn-launch': {
    name: 'Launch',
    minTier: 0,
    tutorial: true,
    hint: 'STICK, THEN TAP TO LAUNCH',
    variants: [{ minTier: 0, build: () => ({ ...railGate(0), magnets: [rail(14, 60, 210, 230, 'blue')] }) }],
  },
  'learn-polarity': {
    name: 'Polarity',
    minTier: 0,
    tutorial: true,
    hint: 'DROP THROUGH THE OPPOSITE COLOUR',
    variants: [{ minTier: 0, build: () => polarityGate(0, 180) }],
  },
  'learn-mixed': {
    name: 'Mixed',
    minTier: 0,
    tutorial: true,
    hint: 'TAP TO FLIP · READ THE GATE',
    variants: [{ minTier: 0, build: () => polarityGate(0, 150, { magnets: [pt(250, 120, 'blue', 170)] }) }],
  },
  polarity: {
    name: 'Polarity',
    minTier: 0,
    variants: [
      { minTier: 0, build: (t) => polarityGate(t, 180) },
      { minTier: 0, build: (t) => polarityGate(t, 130) },
      { minTier: 2, build: (t) => polarityGate(t, 180, { magnets: [pt(180, 110, 'red', 170)] }) },
      { minTier: 3, build: (t) => polarityGate(t, 180, { saws: [saw(180 - pick(POLARITY_HALF, t) + 6, 302, 180 + pick(POLARITY_HALF, t) - 6, 302, 3.4, 12)] }) },
    ],
  },
  iris: {
    name: 'Iris',
    minTier: 0,
    variants: [
      { minTier: 0, build: (t) => irisGate(t, 180) },
      { minTier: 0, build: (t) => irisGate(t, 130) },
      { minTier: 1, build: (t) => irisGate(t, 180, [pt(300, 120, 'red', 160)]) },
      { minTier: 2, build: (t) => irisGate(t, 180, [pt(180, 90, 'blue', 150)]) },
    ],
  },
  rail: {
    name: 'Rail',
    minTier: 0,
    variants: [
      { minTier: 0, build: () => railGate(0) },
      { minTier: 0, build: () => railGate(1) },
      { minTier: 1, build: () => railGate(2) },
      { minTier: 2, build: () => railGate(3) },
    ],
  },
  flipper: {
    name: 'Flipper',
    minTier: 1,
    variants: [
      { minTier: 1, build: () => flipperGate(0) },
      { minTier: 1, build: () => flipperGate(1) },
      { minTier: 2, build: () => flipperGate(2) },
    ],
  },
  alternating: {
    name: 'Alternating',
    minTier: 1,
    variants: [
      { minTier: 1, build: (t) => altGate(t, 'single') },
      { minTier: 1, build: (t) => altGate(t, 'split') },
      { minTier: 2, build: (t) => altGate(t, 'off') },
      { minTier: 3, build: (t) => altGate(t, 'single', true) },
    ],
  },
  iron: {
    name: 'Iron',
    minTier: 2,
    variants: [
      { minTier: 2, build: (t) => ironGate(t, false) },
      { minTier: 3, build: (t) => ironGate(t, true) },
    ],
  },
};

export const FAMILY_NAMES = Object.keys(FAMILIES) as Family[];
const RANDOM_FAMILIES = FAMILY_NAMES.filter((f) => !FAMILIES[f].tutorial);
const TUTORIAL: Family[] = ['learn-attract', 'learn-repel', 'learn-launch', 'learn-polarity', 'learn-mixed'];

/** The gate type a family belongs to, for analytics and the HUD. Tutorial gates report their lesson. */
export function gateType(f: Family): string {
  return f;
}

export function tierOf(index: number): number {
  let t = 0;
  for (let i = 0; i < TIER_STARTS.length; i++) if (index >= TIER_STARTS[i]!) t = i;
  return t;
}

/** How fast the screen pushes down (px/s) once cleared gates are behind you. */
export function cameraPush(cleared: number): number {
  return TUNE.cameraSpeed + TUNE.cameraRamp * Math.min(cleared, CAMERA_RAMP_CAP);
}

export function spacingOf(tier: number): number {
  return pick(GATE_SPACING, tier);
}

const flipPol = (p: Polarity): Polarity => (p === 'red' ? 'blue' : 'red');

/** Turn a spec into gate-local geometry (x across the playfield, y down from the gate top). */
export function buildGate(spec: GateSpec): Pattern {
  const def = FAMILIES[spec.family];
  const v = def.variants[spec.variant] ?? def.variants[0]!;
  const p = v.build(spec.tier);
  const gain = pick(TIER_GAIN, spec.tier);
  const pattern: Pattern = {
    name: def.name,
    height: p.B + BOTTOM_PAD,
    passY: p.B + PASS_BELOW,
    magnets: (p.magnets ?? []).map((m) => ({ ...m, gain })),
    solids: p.solids ?? [],
    saws: p.saws ?? [],
    machine: p.machine ?? { type: 'none' },
    lanes: p.lanes,
    hint: def.hint ?? '',
    state: p.state ?? [],
  };
  return transform(pattern, spec.mirror, spec.swap, 0);
}

/** A deep copy of a pattern, mirrored left-right and/or colour-swapped, shifted down by dy. */
function transform(p: Pattern, mirror: boolean, swap: boolean, dy: number): Pattern {
  const mx = (x: number): number => (mirror ? W - x : x);
  const pol = (c: Polarity): Polarity => (swap ? flipPol(c) : c);
  const m = p.machine;
  let machine: Machine;
  if (m.type === 'iris') {
    machine = { ...m, lx: mirror ? W - m.rx : m.lx, rx: mirror ? W - m.lx : m.rx, y: m.y + dy, polarity: pol(m.polarity), arms: [m.arms[0], m.arms[1]] };
  } else if (m.type === 'alt') {
    machine = { ...m, doors: [...m.doors], base: m.base.map(pol) };
  } else if (m.type === 'slab') {
    machine = { ...m, x0: mirror ? W - m.x1 : m.x0, x1: mirror ? W - m.x0 : m.x1, y: m.y + dy, redLeft: m.redLeft !== mirror !== swap };
  } else {
    machine = { type: 'none' };
  }
  return {
    ...p,
    passY: p.passY + dy,
    magnets: p.magnets.map((g) =>
      g.kind === 'point'
        ? { ...g, x: mx(g.x), y: g.y + dy, polarity: pol(g.polarity) }
        : { ...g, ax: mx(g.ax), ay: g.ay + dy, bx: mx(g.bx), by: g.by + dy, polarity: pol(g.polarity), kick: g.kick && { x: mirror ? -g.kick.x : g.kick.x, y: g.kick.y } },
    ),
    solids: p.solids.map((s) => ({ ...s, ax: mx(s.ax), ay: s.ay + dy, bx: mx(s.bx), by: s.by + dy, polarity: s.polarity && pol(s.polarity) })),
    saws: p.saws.map((s) => ({ ...s, x: mx(s.x), y: s.y + dy, ax: mx(s.ax), ay: s.ay + dy, bx: mx(s.bx), by: s.by + dy })),
    machine,
    lanes: p.lanes.map((l) => (mirror ? { x0: W - l.x1, x1: W - l.x0 } : { ...l })).sort((a, b) => a.x0 - b.x0),
    state: [...p.state],
  };
}

/** Time offset for a gate's timed parts. Deterministic, so the simulator can replay runs. */
export function phaseOf(index: number): number {
  return ((index * 0.618034) % 1) * 4;
}

/** Place a gate in world space. `nextTop` is where the following gate starts. */
export function placeGate(index: number, spec: GateSpec, top: number): PlacedGate & { nextTop: number } {
  const p = transform(buildGate(spec), false, false, top);
  const g: PlacedGate & { nextTop: number } = {
    index,
    spec,
    name: p.name,
    top,
    height: p.height,
    passY: p.passY,
    magnets: p.magnets,
    solids: p.solids,
    saws: p.saws,
    machine: p.machine,
    lanes: p.lanes,
    hint: p.hint,
    state: p.state,
    phase: phaseOf(index),
    nextTop: top + p.height + spacingOf(spec.tier),
  };
  poseGate(g, 0);
  return g;
}

/** Copy a placed gate so the simulator can step it without touching the original. */
export function cloneGate(g: PlacedGate): PlacedGate {
  return { ...g, ...transform(g, false, false, 0), index: g.index, spec: g.spec, top: g.top, phase: g.phase };
}

export type MachineEvent = 'none' | 'iris-open' | 'iris-close' | 'tick' | 'slab';

/** The barrier line of a gate in world y. */
export function barrierY(g: PlacedGate): number {
  return g.passY - PASS_BELOW;
}

/** Whether the orb is close enough for the gate's machinery to react to it. */
export function reacts(g: PlacedGate, y: number): boolean {
  const b = barrierY(g);
  return y > b - REACT_ABOVE && y < b + 24;
}

/** Whether a gate has anything that moves or switches. */
export function isTimed(g: { machine: Machine; saws: readonly Saw[] }): boolean {
  return g.machine.type === 'alt' || g.saws.some((s) => s.period > 0);
}

/** Advance a gate's machinery by dt, then pose it for time t. */
export function stepGate(g: PlacedGate, orb: Orb, t: number, dt: number): MachineEvent {
  const m = g.machine;
  let ev: MachineEvent = 'none';
  if (m.type === 'iris') {
    const want = reacts(g, orb.y) && orb.polarity === m.polarity ? 1 : 0;
    const was = g.state[0] ?? 0;
    const k = TUNE.irisSpeed * dt;
    const now = was < want ? Math.min(want, was + k) : Math.max(want, was - k);
    g.state[0] = now;
    if (was === 0 && now > 0) ev = 'iris-open';
    else if (was === 1 && now < 1) ev = 'iris-close';
  } else if (m.type === 'alt') {
    if (altCycle(g, t) !== altCycle(g, t - dt)) ev = 'tick';
  } else if (m.type === 'slab') {
    let x = g.state[0] ?? (m.x0 + m.x1) / 2;
    let vx = g.state[1] ?? 0;
    if (reacts(g, orb.y)) {
      const target = (orb.polarity === 'red') === m.redLeft ? m.x0 : m.x1;
      if (Math.abs(target - x) > 0.5) vx += Math.sign(target - x) * TUNE.slabPull * dt;
    }
    vx *= Math.exp(-4 * dt);
    x += vx * dt;
    if (x <= m.x0 || x >= m.x1) {
      if (Math.abs(vx) > 60) ev = 'slab';
      x = Math.max(m.x0, Math.min(m.x1, x));
      vx = 0;
    }
    g.state[0] = x;
    g.state[1] = vx;
  }
  poseGate(g, t);
  return ev;
}

function altCycle(g: PlacedGate, t: number): number {
  return g.machine.type === 'alt' ? Math.floor((t + g.phase) / g.machine.period) : 0;
}

/** 0..1 progress through the current alternating cycle (for the warning light). */
export function altProgress(g: PlacedGate, t: number): number {
  if (g.machine.type !== 'alt') return 0;
  const c = (t + g.phase) / g.machine.period;
  return c - Math.floor(c);
}

/** Put every moving part where its state and the run time say it is. */
export function poseGate(g: PlacedGate, t: number): void {
  const m = g.machine;
  if (m.type === 'iris') {
    const phi = (g.state[0] ?? 0) * (Math.PI / 2) * 0.95;
    const c = Math.cos(phi) * m.len;
    const s = Math.sin(phi) * m.len;
    const l = g.solids[m.arms[0]]!;
    const r = g.solids[m.arms[1]]!;
    l.ax = m.lx;
    l.ay = m.y;
    l.bx = m.lx + c;
    l.by = m.y + s;
    r.ax = m.rx;
    r.ay = m.y;
    r.bx = m.rx - c;
    r.by = m.y + s;
    l.polarity = r.polarity = m.polarity;
  } else if (m.type === 'alt') {
    const odd = (altCycle(g, t) & 1) === 1;
    m.doors.forEach((d, i) => {
      const base = m.base[i]!;
      g.solids[d]!.polarity = odd ? flipPol(base) : base;
    });
  } else if (m.type === 'slab') {
    const x = g.state[0] ?? (m.x0 + m.x1) / 2;
    const s = g.solids[m.slab]!;
    s.ax = x - m.w / 2 + s.r;
    s.bx = x + m.w / 2 - s.r;
    s.ay = s.by = m.y;
  }
  for (const s of g.saws) {
    if (s.period <= 0) continue;
    const f = ((((t + g.phase) / s.period) % 1) + 1) % 1;
    const k = f < 0.5 ? f * 2 : 2 - f * 2;
    s.x = s.ax + (s.bx - s.ax) * k;
    s.y = s.ay + (s.by - s.ay) * k;
  }
}

/** Every canonical spec (not mirrored, colours not swapped) for every tier, tutorial gates included. */
export function catalogue(): GateSpec[] {
  const out: GateSpec[] = [];
  for (let tier = 0; tier < TIER_STARTS.length; tier++) {
    for (const family of FAMILY_NAMES) {
      const def = FAMILIES[family];
      if (def.tutorial ? tier > 0 : tier < def.minTier) continue;
      def.variants.forEach((v, variant) => {
        if (v.minTier <= tier) out.push({ family, tier, variant, mirror: false, swap: false });
      });
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

/** Deterministic endless sequence of gate specs for one run: the fixed tutorial, then random gates. */
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
    if (index < TUTORIAL_GATES) {
      const family = TUTORIAL[index]!;
      this.last = family;
      return { family, tier: 0, variant: 0, mirror: false, swap: false };
    }
    const tier = tierOf(index);
    const open = RANDOM_FAMILIES.filter((n) => FAMILIES[n].minTier <= tier && n !== this.last);
    const family = open[Math.floor(this.rand() * open.length)]!;
    this.last = family;
    const variants = FAMILIES[family].variants.flatMap((v, i) => (v.minTier <= tier ? [i] : []));
    const variant = variants[Math.floor(this.rand() * variants.length)]!;
    return { family, tier, variant, mirror: this.rand() < 0.5, swap: this.rand() < 0.5 };
  }
}
