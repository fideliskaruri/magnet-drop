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

export const TRAIL_LENGTH = 26;
export const SCORE_DIVISOR = 10;
export const BEST_KEY = 'magnetdrop.juice.best';

// Visual feedback only. None of these touch physics.
export const JUICE = {
  launchHitstop: 0.035,
  stickHitstop: 0.018,
  /** Sticks slower than this don't freeze. */
  stickHitstopSpeed: 220,
  /** Shake in px and radians at trauma 1 (amplitude is trauma squared). */
  maxShake: 16,
  maxShakeAngle: 0.03,
  traumaDecay: 1.5,
  /** Shake multiplier under prefers-reduced-motion. */
  reducedShake: 0.2,
  reducedFlash: 0.25,
  /** Big full-screen flashes are at least this far apart (no more than 3 per second). */
  flashMinGap: 0.34,
  flashMaxAlpha: 0.35,
  nearMissMargin: 10,
  nearMissCooldown: 0.5,
  milestoneEvery: 100,
  bigMilestoneEvery: 500,
  chainWindow: 2.2,
  /** Score at which depth heat maxes out. */
  heatDepth: 1500,
  bpmMin: 96,
  bpmMax: 160,
  particleCap: 420,
  pulseCap: 48,
  popupCap: 12,
  ghostCap: 10,
  dangerZone: 130,
} as const;

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
  /** Background at max heat. */
  bgHot: '#170826',
  white: '#ffffff',
} as const;
