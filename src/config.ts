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
export const BEST_KEY = 'magnetdrop.powerups.best';

// Power-ups. Tokens sit in the empty gap between patterns, so grabbing one never puts you inside a hazard.
export const PICKUP_RADIUS = 14;
/** Extra reach on top of orb + token radius, so a near miss on a phone still counts. */
export const PICKUP_GRACE = 6;
/** Tokens inside this distance drift toward the orb. */
export const PICKUP_PULL_RADIUS = 70;
export const PICKUP_PULL_SPEED = 260;
/** Chance that a gap after a regular pattern holds a token. The gap after the tutorial always does. */
export const PICKUP_CHANCE = 0.6;
/** Tokens keep this far from the side walls. */
export const PICKUP_MARGIN = 50;

/** Booster: a straight power dive that smashes spikes and ignores magnets. */
export const BOOST_SPEED = 720;
export const BOOST_TIME = 1.4;
/** After the dive, keep diving until the orb reaches a gap between patterns, then release at this speed. */
export const BOOST_RELEASE_VY = 300;
/** Spike immunity right after a dive ends. */
export const BOOST_GRACE = 0.4;

/** Phaser: spikes pass through you; magnets still work, so you keep full control. */
export const PHASE_TIME = 5;

/** Shield: lasts until it saves you once, from spikes or from the screen catching you. */
export const SHIELD_BOUNCE = 420;
export const SHIELD_GRACE = 0.9;
/** Where the orb lands below the top edge after the shield saves it from the screen. */
export const SHIELD_CATCH_DROP = 120;

/** Seconds before a timed power-up ends when it starts blinking. */
export const POWER_WARN = 1;

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
  boost: '#5dff7a',
  shield: '#f4f7ff',
  phase: '#b46bff',
} as const;
