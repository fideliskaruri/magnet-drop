// The shared look of Prototype A and Prototype B: a dark industrial electromagnetic machine.
// Both prototypes use these exact values so the only difference between them is the movement model.
export const THEME = {
  /** Base background behind the steel plates. */
  bg: '#0b0d10',
  /** Dark-steel wall plates, alternating. */
  plateA: '#161a20',
  plateB: '#1d222a',
  /** Panel seams (dark) and their lit edge. */
  seam: '#0a0c0f',
  seamLight: '#242a33',
  rivet: '#2c323c',
  rivetLight: '#3a414c',
  /** 0..1 strength of the dark vignette at the screen edges (very subtle). */
  vignette: 0.35,
  /** Iron housings of magnets and machinery. */
  housing: '#2a2f38',
  bevel: '#3a414c',
  /** Glowing magnet cores. */
  red: '#e5484d',
  blue: '#3e9bff',
  /** Orb: metallic sphere, light to dark, with a glowing core in its polarity colour. */
  orbLight: '#d9dee6',
  orbDark: '#5b626d',
  /** Score and important text. */
  text: '#e8ecf1',
  /** Secondary text. */
  dim: '#8a93a0',
  /** Neutral (non-magnetic) heavy iron. */
  iron: '#4a515c',
  ironDark: '#30353e',
  /** Dangerous machinery: steel blades with a muted warning edge. */
  hazard: '#c98a2b',
  steel: '#9aa3ae',
} as const;
