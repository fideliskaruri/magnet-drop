export type Polarity = 'red' | 'blue';

export interface PointMagnet {
  kind: 'point';
  x: number;
  y: number;
  r: number;
  field: number;
  polarity: Polarity;
}

export interface Rail {
  kind: 'rail';
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number;
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
  height: number;
  magnets: Magnet[];
  spikes: SpikeRow[];
}

export interface PlacedPattern {
  index: number;
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

export type PowerKind = 'boost' | 'shield' | 'phase';

/** A collectible power-up token floating in the arena. */
export interface Pickup {
  kind: PowerKind;
  x: number;
  y: number;
  /** Spawn position, so the bob animation has a fixed anchor. */
  homeX: number;
  homeY: number;
  taken: boolean;
}
