// Every tuning constant lives here. Units: px, seconds.
export const VIEW_W = 360;
export const VIEW_H = 640;

export const PHYSICS_HZ = 120;
export const DT = 1 / PHYSICS_HZ;
export const MAX_FRAME_DT = 0.1;

export const ORB_RADIUS = 11;
/** Colour the orb starts every run with (the tutorial gates are built around it). */
export const START_POLARITY = 'red' as const;
// Speeds, forces, zone sizes and bounces live in tune.ts so the tuning panel can change them live.

// Saw blades only count once they are this far inside the orb's drawn edge.
export const SAW_FORGIVENESS = 4;

// The top edge glows red once the orb is this close to being caught by the camera.
export const STALL_WARN = 0.16;

export const CAMERA_ANCHOR = 0.35;
export const CAMERA_MIN_SPEED_DELAY = 2;
/** Camera push stops ramping after this many points. */
export const CAMERA_RAMP_CAP = 60;

// Gates. The first TUTORIAL_GATES are fixed, then difficulty moves through discrete tiers
// so pnpm sim can prove every gate the generator can make.
export const TUTORIAL_GATES = 5;
/** First gate index (0-based) of each tier. */
export const TIER_STARTS = [0, 12, 22, 36] as const;
/** Empty space between one gate's bottom and the next gate's top, per tier. */
export const GATE_SPACING = [150, 140, 130, 120] as const;
/** Magnet strength multiplier per tier (stronger fields deeper down). */
export const TIER_GAIN = [1, 1.1, 1.2, 1.3] as const;
/** Where the first gate starts below the orb's spawn point. */
export const FIRST_GATE_TOP = 200;
export const DEATH_FREEZE = 0.06;
export const RESTART_LOCK = 0.35;
export const AUTO_READY = 1.5;

export const TRAIL_LENGTH = 26;
export const BEST_KEY = 'magnetdrop.proto-a.best';
export const MUTED_KEY = 'magnetdrop.proto-a.muted';

// Visual feedback only. None of these touch physics.
export const JUICE = {
  launchHitstop: 0.06,
  stickHitstop: 0.012,
  /** Sticks slower than this don't freeze. */
  stickHitstopSpeed: 220,
  /** Shake in px and radians at trauma 1 (amplitude is trauma squared). */
  maxShake: 7,
  maxShakeAngle: 0.01,
  traumaDecay: 2.2,
  /** Shake multiplier under prefers-reduced-motion. */
  reducedShake: 0.2,
  reducedFlash: 0.25,
  /** Big full-screen flashes are at least this far apart (no more than 3 per second). */
  flashMinGap: 0.34,
  flashMaxAlpha: 0.14,
  nearMissMargin: 10,
  nearMissCooldown: 0.5,
  /** Score is one point per gate, plus one per clean centre pass. */
  milestoneEvery: 10,
  bigMilestoneEvery: 50,
  chainWindow: 2.2,
  /** Score at which depth heat maxes out. */
  heatDepth: 40,
  bpmMin: 96,
  bpmMax: 160,
  particleCap: 420,
  pulseCap: 48,
  popupCap: 12,
  ghostCap: 10,
  dangerZone: 130,
} as const;

// Sound design. Levels are linear gains before the master limiter.
export const AUDIO = {
  /** Every musical sound sits on A minor pentatonic from this root. */
  rootHz: 220,
  masterGain: 0.85,
  sfxGain: 1.8,
  layerGain: 0.55,
  /** Concurrent one-shot sounds. Extra ones are dropped (death always plays). */
  maxVoices: 10,
  /** How far left/right the orb's x position pans its sounds (0..1). */
  pan: 0.45,
  /** Seconds for the continuous layers to glide to a new level. */
  layerSmoothing: 0.05,
  /** Flips closer together than this climb the scale. */
  comboWindow: 0.7,
  comboMax: 9,
  /** Launches closer together than this climb the launch chord. */
  launchChainWindow: 3,
  launchChainMax: 6,
  /** Impact speed (px/s) that plays a stick, bounce or wall hit at full force. */
  impactFull: 520,
  milestoneEvery: 10,
  /** Saw danger starts this far (px, edge to edge) from a blade. */
  sawDangerRange: 50,
  /** Stall danger starts when the orb is this close (px) to the top of the screen. */
  stallDangerRange: 150,
  /** Passing within this gap (px) of a saw and surviving plays the near-miss sound. */
  nearMissGap: 9,
  hum: 0.1,
  repel: 0.12,
  stuck: 0.13,
  wind: 0.14,
  danger: 0.13,
} as const;

export { THEME as COLORS } from './theme.ts';
