// Pattern fairness check. Runs the real physics headless.
// For each pattern and entry point: does doing nothing fail, and can a beam search over
// flip decisions (one choice every DECISION seconds) clear it?
// Usage: node --experimental-strip-types scripts/sim.ts [patternNumber]
import { DT, TERMINAL_RISE } from '../src/config.ts';
import { PATTERNS } from '../src/patterns.ts';
import { flip, step } from '../src/physics.ts';
import type { Orb, Polarity } from '../src/types.ts';

const DECISION = 0.1;
const STEPS = Math.round(DECISION / DT);
const BEAM = 4000;
const MAX_T = 8;

const clone = (o: Orb): Orb => ({ ...o, stuck: o.stuck ? { ...o.stuck } : null });

/** Enter 120 px below the pattern bottom, already rising. */
function start(pi: number, x0: number, pol: Polarity): Orb {
  const y = PATTERNS[pi]!.height + 120;
  return { x: x0, y, vx: 0, vy: -TERMINAL_RISE * 0.8, prevX: x0, prevY: y, polarity: pol, stuck: null };
}

function advance(pi: number, orb: Orb, steps: number): 'dead' | 'clear' | 'ok' {
  const p = PATTERNS[pi]!;
  for (let i = 0; i < steps; i++) {
    if (step(orb, p.magnets, p.spikes, DT) === 'dead') return 'dead';
    if (orb.y < -20) return 'clear';
  }
  return 'ok';
}

function noFlip(pi: number, x0: number, pol: Polarity): boolean {
  return advance(pi, start(pi, x0, pol), Math.round(MAX_T / DT)) === 'clear';
}

/** Minimum flips needed to clear, or -1 if no flip sequence works. */
function solve(pi: number, x0: number, pol: Polarity): number {
  let beam: { orb: Orb; flips: number }[] = [{ orb: start(pi, x0, pol), flips: 0 }];
  let best = -1;
  for (let t = 0; t < MAX_T && beam.length; t += DECISION) {
    const next = new Map<string, { orb: Orb; flips: number }>();
    for (const s of beam) {
      for (const doFlip of [false, true]) {
        const o = clone(s.orb);
        if (doFlip) flip(o);
        const flips = s.flips + (doFlip ? 1 : 0);
        const r = advance(pi, o, STEPS);
        if (r === 'dead') continue;
        if (r === 'clear') {
          if (best < 0 || flips < best) best = flips;
          continue;
        }
        const key = `${Math.round(o.x / 3)},${Math.round(o.y / 3)},${Math.round(o.vx / 25)},${Math.round(o.vy / 25)},${o.polarity},${o.stuck ? 1 : 0}`;
        const prev = next.get(key);
        if (!prev || prev.flips > flips) next.set(key, { orb: o, flips });
      }
    }
    beam = [...next.values()];
    if (beam.length > BEAM) {
      beam.sort((a, b) => a.orb.y - b.orb.y);
      beam = beam.slice(0, BEAM);
    }
    if (best >= 0) break;
  }
  return best;
}

const only = process.argv[2] ? Number(process.argv[2]) - 1 : -1;
const starts = [20, 60, 100, 140, 180, 220, 260, 300, 340];
for (let pi = 0; pi < PATTERNS.length; pi++) {
  if (only >= 0 && pi !== only) continue;
  let total = 0;
  let idleFails = 0;
  const flipsNeeded: number[] = [];
  const unsolved: string[] = [];
  for (const x0 of starts) {
    for (const pol of ['red', 'blue'] as Polarity[]) {
      total++;
      if (!noFlip(pi, x0, pol)) idleFails++;
      const f = solve(pi, x0, pol);
      if (f < 0) unsolved.push(`${x0}${pol[0]}`);
      else flipsNeeded.push(f);
    }
  }
  const avg = flipsNeeded.length ? (flipsNeeded.reduce((a, b) => a + b, 0) / flipsNeeded.length).toFixed(1) : '-';
  console.log(
    `${String(pi + 1).padStart(2)} ${PATTERNS[pi]!.name.padEnd(16)} idle-fail ${String(idleFails).padStart(2)}/${total}  solvable ${String(total - unsolved.length).padStart(2)}/${total}  min flips avg ${avg}` +
      (unsolved.length ? `  UNSOLVED: ${unsolved.join(' ')}` : ''),
  );
}
