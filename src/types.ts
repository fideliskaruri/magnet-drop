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
}

export type Magnet = PointMagnet | Rail;

/** A row of triangles. Tips point toward `dir`; the base sits on the opposite edge of the box. */
export interface SpikeRow {
  x: number;
  y: number;
  w: number;
  h: number;
  dir: 'up' | 'down' | 'left' | 'right';
}

export interface Pattern {
  name: string;
  /** 0 easy, 1 medium, 2 hard. Drives the difficulty ramp in `World`. */
  tier: number;
  height: number;
  magnets: Magnet[];
  spikes: SpikeRow[];
}

export interface PlacedPattern {
  index: number;
  tier: number;
  top: number;
  height: number;
  magnets: Magnet[];
  spikes: SpikeRow[];
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
