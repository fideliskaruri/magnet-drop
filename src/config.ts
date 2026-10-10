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

export const PATTERN_GAP = 120;

export const DEATH_FREEZE = 0.06;
export const RESTART_LOCK = 0.6;
export const AUTO_READY = 1.5;

export const TRAIL_LENGTH = 20;
export const SCORE_DIVISOR = 10;
export const BEST_KEY = 'magnetdrop.best';

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
