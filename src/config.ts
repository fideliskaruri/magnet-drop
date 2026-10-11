// Every tuning constant lives here. Units: px, seconds.
export const VIEW_W = 360;
export const VIEW_H = 640;

export const PHYSICS_HZ = 120;
export const DT = 1 / PHYSICS_HZ;
export const MAX_FRAME_DT = 0.1;

export const ORB_RADIUS = 11;
export const GRAVITY = 700;
export const TERMINAL_FALL = 380;
export const MAX_SPEED = 900;
export const AIR_DAMPING_X = 0.6;

export const WALL_RESTITUTION = 0.4;
export const REPEL_BOUNCE = 0.6;

export const POINT_STRENGTH = 3000;
export const RAIL_STRENGTH = 2600;
export const RAIL_FIELD = 110;
export const LAUNCH_SPEED = 620;

export const SPIKE_FORGIVENESS = 2;

export const CAMERA_ANCHOR = 0.35;
export const CAMERA_MIN_SPEED = 60;
export const CAMERA_MIN_SPEED_DELAY = 2;

// Endless gates. Each gate is one barrier of spikes with a single gap, plus the magnets that get you there.
// Difficulty only moves through these discrete tiers so `pnpm sim` can prove every gate the generator can make.
/** First gate index (0-based) of each tier. */
export const TIER_STARTS = [0, 6, 16, 30] as const;
/** Width of the gap in the spike barrier, per tier. */
export const GAP_WIDTHS = [150, 124, 104, 88] as const;
/** Empty space between one gate's bottom and the next gate's top, per tier. */
export const GATE_SPACING = [150, 130, 115, 100] as const;
/** Where the first gate starts below the orb's spawn point. */
export const FIRST_GATE_TOP = 240;

export const DEATH_FREEZE = 0.06;
export const RESTART_LOCK = 0.6;
export const AUTO_READY = 1.5;

export const TRAIL_LENGTH = 20;
export const BEST_KEY = 'magnetdrop.endless.best';
/** Seconds the score number pops after you clear a gate. */
export const SCORE_POP = 0.25;
/** Every this many gates the score chimes and flashes. */
export const MILESTONE = 10;

export const COLORS = {
  bg: '#070b18',
  grid: 'rgba(80, 110, 170, 0.09)',
  wall: '#1a2236',
  red: '#ff4a2e',
  blue: '#2ee6ff',
  spike: '#ffe14a',
  spikeBase: '#8a7a2a',
  text: '#e8eefc',
  dim: '#7a86a8',
  chrome: '#2a3040',
} as const;
