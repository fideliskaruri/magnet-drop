export type Polarity = 'red' | 'blue';

export interface PointMagnet {
  kind: 'point';
  x: number;
  y: number;
  r: number;
  /** Designed reach, before the tuner scales it. */
  field: number;
  /** Live reach after tuning and fitting (see zones.ts). */
  reach: number;
  polarity: Polarity;
  /** Strength multiplier. Deeper tiers have stronger fields. */
  gain: number;
}

export interface Rail {
  kind: 'rail';
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number;
  /** Live reach out from the rail surface after tuning and fitting (see zones.ts). */
  reach: number;
  polarity: Polarity;
  gain: number;
  /** Flipper paddles: touching one in its own colour kicks the orb along this unit vector. */
  kick: { x: number; y: number } | null;
}

export type Magnet = PointMagnet | Rail;

/**
 * A solid capsule (a thick line segment) the orb collides with.
 * - steel: neutral shelves and posts, always solid.
 * - door: a magnetic shutter. The opposite colour pulls you through it; your own colour is solid and pushes you off.
 * - arm: one of the two hinged iris arms (neutral, solid, moves).
 * - slab: the heavy iron block of an iron gate (neutral, solid, moves).
 */
export interface Solid {
  kind: 'steel' | 'door' | 'arm' | 'slab';
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number;
  /** Doors and arms have a colour, steel and iron do not. */
  polarity: Polarity | null;
}

/** A spinning saw, the only deadly machinery. Patrols from a to b and back over `period` seconds (static when a = b). */
export interface Saw {
  x: number;
  y: number;
  r: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  period: number;
}

/** Moving or switching parts of a gate, a pure function of the gate state and run time. Parts are indices into the gate's solids. */
export type Machine =
  | { type: 'none' }
  /** Two arms hinged at (lx, y) and (rx, y). They swing open when the orb is the iris colour. State: [open 0..1]. */
  | { type: 'iris'; lx: number; rx: number; y: number; len: number; polarity: Polarity; arms: [number, number] }
  /** Every door swaps colour each `period` seconds. `base` holds each door's colour at cycle 0. */
  | { type: 'alt'; period: number; doors: number[]; base: Polarity[] }
  /** An iron slab slides on a track between x0 and x1 (its centre), pulled toward the end magnet that matches the orb's colour. State: [x, vx]. */
  | { type: 'slab'; x0: number; x1: number; y: number; w: number; redLeft: boolean; slab: number };

export type Family =
  | 'learn-attract'
  | 'learn-repel'
  | 'learn-launch'
  | 'learn-polarity'
  | 'learn-mixed'
  | 'polarity'
  | 'iris'
  | 'flipper'
  | 'rail'
  | 'alternating'
  | 'iron';

/** Everything that decides a gate. All choices are discrete so the simulator can enumerate them. */
export interface GateSpec {
  family: Family;
  tier: number;
  /** Which layout of the family. */
  variant: number;
  mirror: boolean;
  /** Swap every colour. */
  swap: boolean;
}

/** An opening the orb can drop through, as an x range on the pass line. Used for the clean centre bonus. */
export interface Lane {
  x0: number;
  x1: number;
}

export interface Pattern {
  name: string;
  height: number;
  /** Pattern-local y of the barrier's lowest edge. Dropping below it scores the gate. */
  passY: number;
  magnets: Magnet[];
  solids: Solid[];
  saws: Saw[];
  machine: Machine;
  lanes: Lane[];
  /** Tutorial text, drawn above the gate. */
  hint: string;
  /** Starting machine state. */
  state: number[];
}

export interface PlacedGate {
  index: number;
  spec: GateSpec;
  name: string;
  top: number;
  height: number;
  passY: number;
  magnets: Magnet[];
  solids: Solid[];
  saws: Saw[];
  machine: Machine;
  lanes: Lane[];
  hint: string;
  /** Mutable machine state (see Machine). */
  state: number[];
  /** Time offset for timed parts, so neighbouring gates don't tick in step. */
  phase: number;
}

export interface Stuck {
  magnet: Magnet;
  nx: number;
  ny: number;
}

export interface Orb {
  x: number;
  y: number;
  vx: number;
  vy: number;
  prevX: number;
  prevY: number;
  polarity: Polarity;
  stuck: Stuck | null;
}

export type GameStateName = 'ready' | 'playing' | 'dying';
