// Fairness proof for the endless generator. Runs the real physics headless.
//
// 1. Catalogue: every gate the generator can produce, at every tier, from 18 entry points
//    (9 x positions, both orb colours). Mirror and colour swap are covered because the entry set is
//    mirror-symmetric and includes both colours. A beam search over flips (one choice every DECISION
//    seconds) must clear each one.
// 2. Runs: whole generated runs, gate after gate, starting like the game does, with the camera chasing
//    you. The beam search must clear RUN_GATES gates in a row for every seed.
//
// Zones are fitted the way the game fits them. In the catalogue each gate gets the smallest zones
// any neighbouring gate above or below could squeeze it to, and no two zones may come closer than the gap.
//
// Usage: pnpm sim [all|gates|runs] [seedCount] [key=value ...]   (key=value overrides a tunable)
import { CAMERA_ANCHOR, CAMERA_MIN_SPEED_DELAY, DT, FIRST_GATE_TOP, GATE_SPACING, ORB_RADIUS, TIER_STARTS, VIEW_H, VIEW_W } from '../src/config.ts';
import { buildGate, catalogue, GateStream, placeGate } from '../src/gates.ts';
import { flip, step } from '../src/physics.ts';
import { TUNE } from '../src/tune.ts';
import type { GateSpec, Magnet, Orb, Pattern, PlacedGate, Polarity, SpikeRow } from '../src/types.ts';
import { fitZones, zoneClashes } from '../src/zones.ts';

const DECISION = 0.1;
const STEPS = Math.round(DECISION / DT);
const BEAM = 4000;
const MAX_T = 8;
const RUN_BEAM = 1500;
const RUN_GATES = 60;

const clone = (o: Orb): Orb => ({ ...o, stuck: o.stuck ? { ...o.stuck } : null });
const specName = (s: GateSpec): string => `${s.family}[${s.v.join(',')}]t${s.tier}${s.mirror ? 'm' : ''}${s.swap ? 's' : ''}`;

function start(x0: number, pol: Polarity): Orb {
  return { x: x0, y: -120, vx: 0, vy: TUNE.terminalFall * 0.8, prevX: x0, prevY: -120, polarity: pol, stuck: null };
}

interface Course {
  magnets: Magnet[];
  spikes: SpikeRow[];
  clearY: number;
}

function advance(c: Course, orb: Orb, steps: number): 'dead' | 'clear' | 'ok' {
  for (let i = 0; i < steps; i++) {
    if (step(orb, c.magnets, c.spikes, DT) === 'dead') return 'dead';
    if (orb.y > c.clearY) return 'clear';
  }
  return 'ok';
}

const keyOf = (o: Orb, extra = ''): string =>
  `${Math.round(o.x / 3)},${Math.round(o.y / 3)},${Math.round(o.vx / 25)},${Math.round(o.vy / 25)},${o.polarity},${o.stuck ? 1 : 0}${extra}`;

/** Minimum flips needed to clear, or -1 if no flip sequence works. */
function solve(c: Course, x0: number, pol: Polarity): number {
  let beam: { orb: Orb; flips: number }[] = [{ orb: start(x0, pol), flips: 0 }];
  let best = -1;
  for (let t = 0; t < MAX_T && beam.length; t += DECISION) {
    const next = new Map<string, { orb: Orb; flips: number }>();
    for (const s of beam) {
      for (const doFlip of [false, true]) {
        const o = clone(s.orb);
        if (doFlip) flip(o);
        const flips = s.flips + (doFlip ? 1 : 0);
        const r = advance(c, o, STEPS);
        if (r === 'dead') continue;
        if (r === 'clear') {
          if (best < 0 || flips < best) best = flips;
          continue;
        }
        const key = keyOf(o);
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

const variants = (s: GateSpec): GateSpec[] => [false, true].flatMap((mirror) => [false, true].map((swap) => ({ ...s, mirror, swap })));

/** Gate geometry moved down by dy. */
function shifted(p: Pattern, dy: number): Magnet[] {
  return p.magnets.map((m): Magnet => (m.kind === 'point' ? { ...m, y: m.y + dy } : { ...m, ay: m.ay + dy, by: m.by + dy }));
}

/**
 * Fit each canonical gate against every gate that could sit above or below it, at the tightest spacing,
 * and keep the smallest reach each magnet ever gets. Returns the number of zone clashes found.
 */
function fitCatalogue(specs: GateSpec[]): { built: Map<GateSpec, Pattern>; clashes: number } {
  const all = specs.flatMap(variants).map((s) => buildGate(s));
  const gap = Math.min(...GATE_SPACING);
  const built = new Map<GateSpec, Pattern>();
  let clashes = 0;
  const sample: string[] = [];
  for (const spec of specs) {
    const mid = buildGate(spec);
    fitZones([], mid.magnets);
    const worst = mid.magnets.map((m) => m.reach);
    for (const other of all) {
      // Neighbour above: it was fitted first, then this gate is fitted against it.
      const above = shifted(other, 0);
      fitZones([], above);
      const m1 = shifted(mid, other.height + gap);
      fitZones(above, m1);
      // Neighbour below: fitted against this gate, which can shrink this gate too.
      const m2 = shifted(mid, 0);
      fitZones([], m2);
      const below = shifted(other, mid.height + gap);
      fitZones(m2, below);
      for (const [ms, pair] of [[m1, [...above, ...m1]], [m2, [...m2, ...below]]] as const) {
        ms.forEach((m, k) => (worst[k] = Math.min(worst[k]!, m.reach)));
        const c = zoneClashes(pair).length;
        clashes += c;
        if (c && sample.length < 5) sample.push(specName(spec));
      }
    }
    mid.magnets.forEach((m, k) => (m.reach = worst[k]!));
    built.set(spec, mid);
  }
  console.log(`Zones: gap ${TUNE.zoneGap}px, ${clashes ? `CLASHES in ${sample.join(', ')}` : 'no two zones closer than the gap with any neighbouring gate'}.`);
  return { built, clashes };
}

function checkCatalogue(): number {
  const { built, clashes } = fitCatalogue(catalogue());
  // SIM_ONLY=drift,twin limits the solve to some families (zones are still fitted against all of them).
  const only = process.env.SIM_ONLY?.split(',');
  const specs = catalogue().filter((sp) => !only || only.includes(sp.family));
  const starts = [20, 60, 100, 140, 180, 220, 260, 300, 340];
  console.log(`Catalogue: ${specs.length} canonical gates (x4 with mirror and colour swap), ${starts.length * 2} entries each.`);
  const rows = new Map<string, { gates: number; entries: number; idleFail: number; flips: number[]; unsolved: string[] }>();
  let unsolvedTotal = 0;
  const t0 = Date.now();
  for (const spec of specs) {
    const p = [...built].find(([k]) => specName(k) === specName(spec))![1];
    const c: Course = { magnets: p.magnets, spikes: p.spikes, clearY: p.height + 20 };
    const key = `${spec.family.padEnd(9)} tier ${spec.tier}`;
    const row = rows.get(key) ?? { gates: 0, entries: 0, idleFail: 0, flips: [], unsolved: [] };
    rows.set(key, row);
    row.gates++;
    for (const x0 of starts) {
      for (const pol of ['red', 'blue'] as Polarity[]) {
        row.entries++;
        if (advance(c, start(x0, pol), Math.round(MAX_T / DT)) !== 'clear') row.idleFail++;
        const f = solve(c, x0, pol);
        if (f < 0) {
          row.unsolved.push(`${specName(spec)}@${x0}${pol[0]}`);
          unsolvedTotal++;
        } else row.flips.push(f);
      }
    }
  }
  for (const [key, r] of [...rows].sort(([a], [b]) => a.localeCompare(b))) {
    const avg = r.flips.length ? (r.flips.reduce((a, b) => a + b, 0) / r.flips.length).toFixed(1) : '-';
    const idle = `${Math.round((100 * r.idleFail) / r.entries)}%`.padStart(4);
    console.log(
      `  ${key}  gates ${String(r.gates).padStart(2)}  solvable ${String(r.entries - r.unsolved.length).padStart(3)}/${r.entries}  idle-fail ${idle}  min flips avg ${avg}` +
        (r.unsolved.length ? `\n    UNSOLVED: ${r.unsolved.join(' ')}` : ''),
    );
  }
  const total = specs.length * starts.length * 2;
  console.log(`Catalogue: ${total - unsolvedTotal}/${total} gate entries solvable in ${((Date.now() - t0) / 1000).toFixed(1)} s.\n`);
  return unsolvedTotal + clashes;
}

interface RunState {
  orb: Orb;
  cam: number;
  flips: number;
}

/**
 * Keep the deepest states, but spread across x columns, colours and stuck/free, so a long run doesn't
 * collapse onto one line that a later gate punishes.
 */
function prune(states: RunState[], max: number): RunState[] {
  states.sort((a, b) => b.orb.y - a.orb.y);
  if (states.length <= max) return states;
  const buckets = new Map<string, RunState[]>();
  for (const s of states) {
    const k = `${Math.floor(s.orb.x / 30)}${s.orb.polarity}${s.orb.stuck ? 1 : 0}${s.orb.vx > 0 ? 1 : 0}`;
    const b = buckets.get(k);
    if (b) b.push(s);
    else buckets.set(k, [s]);
  }
  const lists = [...buckets.values()];
  const out: RunState[] = [];
  for (let i = 0; out.length < max; i++) {
    let any = false;
    for (const l of lists) {
      if (i < l.length) {
        out.push(l[i]!);
        any = true;
        if (out.length >= max) break;
      }
    }
    if (!any) break;
  }
  return out.sort((a, b) => b.orb.y - a.orb.y);
}

/** Beam search through a whole generated run with the camera chasing. */
function solveRun(seed: number): { cleared: number; flips: number; seconds: number; failedAt: string } {
  const stream = new GateStream(seed);
  const gates: PlacedGate[] = [];
  let top = FIRST_GATE_TOP;
  for (let i = 0; i < RUN_GATES + 2; i++) {
    const g = placeGate(i, stream.next(), top);
    fitZones(gates[gates.length - 1]?.magnets ?? [], g.magnets);
    gates.push(g);
    top = g.nextTop;
  }
  // Fields never reach past a neighbouring gate, so each gate only needs itself and its neighbours.
  const near = gates.map((_, i) => {
    const gs = gates.slice(Math.max(0, i - 1), i + 2);
    return { magnets: gs.flatMap((g) => g.magnets), spikes: gs.flatMap((g) => g.spikes) };
  });
  const gateIndexAt = (y: number): number => {
    let k = 0;
    while (k < gates.length - 1 && y >= gates[k + 1]!.top) k++;
    return k;
  };
  const goal = gates[RUN_GATES - 1]!.passY;
  const x = VIEW_W / 2;
  let beam: RunState[] = [{ orb: { x, y: 0, vx: 0, vy: 0, prevX: x, prevY: 0, polarity: 'blue', stuck: null }, cam: -VIEW_H * CAMERA_ANCHOR, flips: 0 }];
  let t = 0;
  let deepest = 0;
  while (beam.length) {
    const next = new Map<string, RunState>();
    for (const s of beam) {
      for (const doFlip of [false, true]) {
        const o = clone(s.orb);
        if (doFlip) flip(o);
        let cam = s.cam;
        let dead = false;
        let tt = t;
        for (let i = 0; i < STEPS; i++) {
          const n = near[gateIndexAt(o.y)]!;
          if (step(o, n.magnets, n.spikes, DT) === 'dead') {
            dead = true;
            break;
          }
          tt += DT;
          const prevCam = cam;
          cam = Math.max(cam, o.y - VIEW_H * CAMERA_ANCHOR);
          if (tt > CAMERA_MIN_SPEED_DELAY) cam = Math.max(cam, prevCam + TUNE.cameraSpeed * DT);
          if (o.y + ORB_RADIUS < cam) {
            dead = true;
            break;
          }
        }
        if (dead) continue;
        const flips = s.flips + (doFlip ? 1 : 0);
        if (o.y > goal) return { cleared: RUN_GATES, flips, seconds: t + DECISION, failedAt: '' };
        const key = keyOf(o, `,${Math.round(cam / 8)}`);
        const prev = next.get(key);
        if (!prev || prev.flips > flips) next.set(key, { orb: o, cam, flips });
      }
    }
    beam = prune([...next.values()], RUN_BEAM);
    if (beam.length) deepest = Math.max(deepest, beam[0]!.orb.y);
    t += DECISION;
  }
  const k = gateIndexAt(deepest);
  const cleared = gates.filter((g) => g.passY < deepest).length;
  return { cleared, flips: -1, seconds: t, failedAt: `gate ${k} ${specName(gates[k]!.spec)}` };
}

function checkRuns(seeds: number): number {
  console.log(`Runs: ${seeds} generated runs of ${RUN_GATES} gates with the camera chasing (tiers start at gates ${TIER_STARTS.join(', ')}).`);
  let failed = 0;
  const t0 = Date.now();
  for (let seed = 1; seed <= seeds; seed++) {
    const r = solveRun(seed);
    if (r.cleared < RUN_GATES) failed++;
    console.log(
      `  seed ${String(seed).padStart(2)}  cleared ${String(r.cleared).padStart(2)}/${RUN_GATES}` +
        (r.flips >= 0 ? `  flips ${r.flips} (${(r.flips / RUN_GATES).toFixed(1)} per gate)  run time ${r.seconds.toFixed(0)} s` : `  STUCK at ${r.failedAt}`),
    );
  }
  console.log(`Runs: ${seeds - failed}/${seeds} cleared in ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
  return failed;
}

const args = process.argv.slice(2);
for (const arg of args.filter((x) => x.includes('='))) {
  const [k, v] = arg.split('=');
  if (!(k! in TUNE) || !Number.isFinite(Number(v))) throw new Error(`Unknown tunable or bad value: ${arg}`);
  TUNE[k as keyof typeof TUNE] = Number(v);
}
const plain = args.filter((x) => !x.includes('='));
const mode = plain[0] ?? 'all';
const seeds = Number(plain[1] ?? 12);
let bad = 0;
if (mode === 'all' || mode === 'gates') bad += checkCatalogue();
if (mode === 'all' || mode === 'runs') bad += checkRuns(seeds);
process.exit(bad ? 1 : 0);
