// Pattern fairness check. Runs the real physics headless.
// For each pattern and entry point: does doing nothing fail, and can a beam search over
// flip decisions (one choice every DECISION seconds) clear it?
// Usage: node --experimental-strip-types scripts/sim.ts [patternNumber] [key=value ...]
import { DT, PATTERN_GAP } from '../src/config.ts';
import { PATTERNS } from '../src/patterns.ts';
import { flip, step } from '../src/physics.ts';
import { TUNE } from '../src/tune.ts';
import type { Magnet, Orb, Polarity } from '../src/types.ts';
import { fitZones, zoneClashes, zoneOf } from '../src/zones.ts';

const DECISION = 0.1;
const STEPS = Math.round(DECISION / DT);
const BEAM = 4000;
const MAX_T = 8;

const clone = (o: Orb): Orb => ({ ...o, stuck: o.stuck ? { ...o.stuck } : null });

function start(x0: number, pol: Polarity): Orb {
  return { x: x0, y: -120, vx: 0, vy: TUNE.terminalFall * 0.8, prevX: x0, prevY: -120, polarity: pol, stuck: null };
}

function advance(pi: number, orb: Orb, steps: number): 'dead' | 'clear' | 'ok' {
  const p = PATTERNS[pi]!;
  for (let i = 0; i < steps; i++) {
    if (step(orb, p.magnets, p.spikes, DT) === 'dead') return 'dead';
    if (orb.y > p.height + 20) return 'clear';
  }
  return 'ok';
}

function noFlip(pi: number, x0: number, pol: Polarity): boolean {
  return advance(pi, start(x0, pol), Math.round(MAX_T / DT)) === 'clear';
}

/** Minimum flips needed to clear, or -1 if no flip sequence works. */
function solve(pi: number, x0: number, pol: Polarity): number {
  let beam: { orb: Orb; flips: number }[] = [{ orb: start(x0, pol), flips: 0 }];
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
      beam.sort((a, b) => b.orb.y - a.orb.y);
      beam = beam.slice(0, BEAM);
    }
    if (best >= 0) break;
  }
  return best;
}

// Any `key=value` argument overrides a tunable, e.g. `pnpm sim gravity=700 zoneGap=0`.
const args = process.argv.slice(2);
for (const arg of args.filter((x) => x.includes('='))) {
  const [k, v] = arg.split('=');
  if (!(k! in TUNE) || !Number.isFinite(Number(v))) throw new Error(`Unknown tunable or bad value: ${arg}`);
  TUNE[k as keyof typeof TUNE] = Number(v);
}

// Zones depend on the neighbouring patterns, so fit each pattern between every possible
// pattern above and below it and simulate with the smallest reach each magnet can end up with.
type Placed = { index: number; magnets: Magnet[] };
function place(index: number, top: number): Placed {
  const ms = PATTERNS[index]!.magnets.map((m): Magnet => (m.kind === 'point' ? { ...m, y: m.y + top } : { ...m, ay: m.ay + top, by: m.by + top }));
  return { index, magnets: ms };
}
const worst = PATTERNS.map((p) => p.magnets.map(() => Infinity));
const clashes: string[] = [];
for (let i = 0; i < PATTERNS.length; i++) {
  for (let above = 0; above < PATTERNS.length; above++) {
    for (let below = 0; below < PATTERNS.length; below++) {
      const a = place(above, 0);
      const topI = PATTERNS[above]!.height + PATTERN_GAP;
      const mid = place(i, topI);
      const b = place(below, topI + PATTERNS[i]!.height + PATTERN_GAP);
      // Same order the world uses: fit (above, mid) when mid spawns, then (mid, below).
      fitZones([], a.magnets);
      fitZones(a.magnets, mid.magnets);
      fitZones(mid.magnets, b.magnets);
      for (const c of zoneClashes([...a.magnets, ...mid.magnets, ...b.magnets])) {
        if (clashes.length < 5) clashes.push(`${above + 1}/${i + 1}/${below + 1} space ${c.space.toFixed(1)}`);
      }
      mid.magnets.forEach((m, k) => (worst[i]![k] = Math.min(worst[i]![k]!, m.reach)));
      // The pattern below can also shrink the middle one, so record after both fits.
    }
  }
}
PATTERNS.forEach((p, i) => p.magnets.forEach((m, k) => (m.reach = worst[i]![k]!)));
console.log(`zones: gap ${TUNE.zoneGap}px, ${clashes.length ? `CLASHES ${clashes.join(', ')}` : 'no two zones closer than the gap in any pattern pairing'}`);

const patternArg = args.find((x) => !x.includes('='));
const only = patternArg ? Number(patternArg) - 1 : -1;
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
      `  reach ${PATTERNS[pi]!.magnets.map((m) => Math.round(zoneOf(m))).join('/')}` +
      (unsolved.length ? `  UNSOLVED: ${unsolved.join(' ')}` : ''),
  );
}
