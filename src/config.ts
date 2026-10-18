// Every fixed constant lives here. Units: px, seconds. Live tunables are in tune.ts.
import { THEME } from './theme.ts';

/** Landscape logical playfield, letterboxed to fit the window. */
export const VIEW_W = 640;
export const VIEW_H = 360;

/** Inner faces of the ceiling and floor magnet rails. The band between them is where the orb flies. */
export const CEIL = 30;
export const FLOOR = 330;
export const MID = (CEIL + FLOOR) / 2;

export const PHYSICS_HZ = 120;
export const DT = 1 / PHYSICS_HZ;
export const MAX_FRAME_DT = 0.1;

export const ORB_RADIUS = 11;

/** Where the orb sits on screen (share of the width from the left) when it keeps pace. */
export const ANCHOR = 0.36;
/** The camera follows the orb once it gets this far right, so it never leaves the screen. */
export const CAMERA_LEAD = 0.55;
/** The left edge glows once the orb is this close (px) to being pushed off. */
export const EDGE_WARN = 120;

/** World x of the first gate. The orb starts at ANCHOR * VIEW_W. */
export const FIRST_GATE_X = 660;
/** The first gates are a fixed tutorial; the stream generates from here on. */
export const TUTORIAL_GATES = 6;
/** First gate index (0-based) of each procedural tier. Tier 0 starts after the tutorial. */
export const TIER_STARTS = [0, 14, 24, 38] as const;
/** Empty space between one gate's end and the next gate's start, per tier (scaled by TUNE.gateGap). */
export const GATE_SPACING = [300, 270, 250, 235] as const;
/** Forward speed multiplier per tier (times TUNE.baseSpeed). Modest. */
export const TIER_SPEED = [1, 1.05, 1.1, 1.17] as const;
/** The scroll speed eases toward the tier speed at this rate (per second). */
export const SPEED_EASE = 0.6;
/** A pass within this share of the opening's half-height from its centre earns the centre bonus. */
export const CENTRE_BAND = 0.3;

export const DEATH_FREEZE = 0.06;
/** Taps are ignored this long after a death, so a panicked tap doesn't skip the death. */
export const RESTART_LOCK = 0.3;
export const AUTO_READY = 1.6;

export const TRAIL_LENGTH = 22;
export const BEST_KEY = 'magnetdrop.proto-b.best';
export const MUTED_KEY = 'magnetdrop.proto-b.muted';

// Visual feedback only. None of these touch physics. Restrained: no heavy flashing.
export const JUICE = {
  /** Strong surface launch: ~60 ms hit-stop. */
  launchHitstop: 0.06,
  /** Shake in px and radians at trauma 1 (amplitude is trauma squared). */
  maxShake: 9,
  maxShakeAngle: 0.012,
  traumaDecay: 2,
  /** Shake multiplier under prefers-reduced-motion. */
  reducedShake: 0.2,
  reducedFlash: 0.25,
  /** Big full-screen flashes are at least this far apart (no more than 3 per second). */
  flashMinGap: 0.34,
  flashMaxAlpha: 0.18,
  milestoneEvery: 10,
  bigMilestoneEvery: 50,
  particleCap: 320,
  pulseCap: 32,
  popupCap: 10,
  ghostCap: 8,
  /** Background field particles that drift with the field direction. */
  fieldParticles: 70,
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
  /** How far left/right the orb's screen position pans its sounds (0..1). */
  pan: 0.35,
  /** Seconds for the continuous layers to glide to a new level. */
  layerSmoothing: 0.05,
  /** Flips closer together than this climb the scale. */
  comboWindow: 0.7,
  comboMax: 9,
  /** Launches closer together than this climb the launch chord. */
  launchChainWindow: 3,
  launchChainMax: 6,
  /** Impact speed (px/s) that plays a stick, bounce or wall hit at full force. */
  impactFull: 420,
  milestoneEvery: 10,
  /** Hazard danger starts this far (px, edge to edge) from dangerous machinery. */
  hazardDangerRange: 50,
  /** Edge danger starts when the orb is this close (px) to the left edge. */
  edgeDangerRange: 150,
  hum: 0.08,
  repel: 0.1,
  stuck: 0.1,
  wind: 0.12,
  danger: 0.13,
} as const;

/** Shorthands used by effects and the renderer. */
export const COLORS = {
  red: THEME.red,
  blue: THEME.blue,
  text: THEME.text,
  dim: THEME.dim,
  hazard: THEME.hazard,
  white: '#ffffff',
} as const;
