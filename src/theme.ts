// The shared look of prototypes A and B: a dark industrial electromagnetic facility, not neon geometry.
// Neon (the polarity colours) is used sparingly: magnet cores, the orb core and field particles.
export const THEME = {
  /** Facility background. */
  bg: '#0b0d10',
  /** Dark-steel wall plates, alternating. */
  plate: '#161a20',
  plateAlt: '#1d222a',
  seam: '#0e1115',
  rivet: '#2b313b',
  /** Iron magnet housings and their bevel. */
  housing: '#2a2f38',
  bevel: '#3a414c',
  /** Glowing magnet cores. */
  red: '#e5484d',
  blue: '#3e9bff',
  /** Metallic orb shell gradient, highlight to shadow. */
  orbHi: '#d9dee6',
  orbLo: '#5b626d',
  /** Score and HUD text. */
  text: '#e8ecf1',
  dim: '#8a93a3',
  /** Rare dangerous machinery. */
  hazard: '#f2a33a',
  /** Neutral (unmagnetised) safe zones. */
  neutral: '#6b7480',
  /** Vignette strength at the corners (0..1). Kept very subtle. */
  vignette: 0.35,
} as const;
