export type Polarity = 'red' | 'blue';

/** Gate families. `wall` is the plain one-opening gate used by the tutorial. */
export type Family = 'wall' | 'dual' | 'pinball' | 'splitter' | 'tunnel' | 'door' | 'pendulum' | 'rails';

export const FAMILIES: readonly Family[] = ['wall', 'dual', 'pinball', 'splitter', 'tunnel', 'door', 'pendulum', 'rails'];

/** Everything that decides a gate. All choices are discrete so the simulator can enumerate them. */
export interface GateSpec {
  family: Family;
  tier: number;
  /** Family-specific choice indices (see gates.ts). */
  v: number[];
}

/** What a shape is, for collision rules and drawing. */
export type ShapeKind =
  | 'iron' // fixed iron block; horizontal faces are magnetic rails you can rest on
  | 'plate' // thin splitter divider
  | 'tunnel' // tunnel wall: magnetic, grips the orb
  | 'lock' // dual-gate polarity lock: solid only for the wrong polarity, only from the left
  | 'door' // repulsion door slab: solid only from the left
  | 'paddle' // pinball paddle (capsule rotating about a hinge)
  | 'rod' // pendulum rod (capsule)
  | 'mass' // pendulum mass (circle)
  | 'grinder'; // dangerous machinery: lethal

export const RECT = 0;
export const CAPSULE = 1;
export const CIRCLE = 2;

/**
 * A collision shape in world space. Rects use x, y, w, h. Capsules run from (x, y) to (x2, y2) with radius r.
 * Circles are centred on (x, y) with radius r. Moving shapes report their surface velocity through a linear
 * velocity (vx, vy) plus a rotation `omega` about (px, py).
 */
export interface Shape {
  type: number;
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  x2: number;
  y2: number;
  r: number;
  vx: number;
  vy: number;
  px: number;
  py: number;
  omega: number;
  /** Takes part in collisions right now (locks that are open and doors that are open are off). */
  on: boolean;
  /** Polarity the shape reacts to, for drawing (null = plain iron). */
  pol: Polarity | null;
}

/** A region that changes the field. */
export interface Zone {
  kind: 'neutral' | 'tunnel';
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What the orb is resting on. dir is the pull direction that presses it in (+1 down, -1 up). */
export interface Stuck {
  dir: number;
  /** null = the ceiling or floor rail. */
  shape: Shape | null;
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

/** A gate placed in the world, with its live state. */
export interface Gate {
  index: number;
  spec: GateSpec;
  /** World x of the gate's left edge. */
  x: number;
  width: number;
  /** World x where the centre-pass bonus is judged. */
  keyX: number;
  shapes: Shape[];
  zones: Zone[];
  /** Family-specific live state (paddle angles, door opening, pendulum angle...). */
  s: number[];
  /** The orb touched one of this gate's shapes. */
  touched: boolean;
  scored: boolean;
  /** Result of the centre check at keyX: null until the orb crosses it. */
  centre: boolean | null;
}

export type GameStateName = 'ready' | 'playing' | 'dying';
