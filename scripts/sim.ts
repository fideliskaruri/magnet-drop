// Fairness proof for Prototype A's gate generator. Runs the real physics and machinery headless.
//
// 1. Catalogue: every gate the generator can produce, at every tier, from 18 entry points
//    (9 x positions, both orb colours). Mirror and colour swap are covered because the entry set is
//    mirror-symmetric and includes both colours. Timed gates (alternating doors, moving saws) are also
//    tried at four phases of their cycle, since time is part of the gate. A beam search over flips (one
//    choice every DECISION seconds) must clear each one.
// 2. Runs: whole generated runs, tutorial first, gate after gate, starting like the game does, with the
//    camera chasing you. The beam search must clear RUN_GATES gates in a row for every seed.
//
// Zones are fitted the way the game fits them. In the catalogue each gate gets the smallest zones
// any neighbouring gate above or below could squeeze it to, and no two zones may come closer than the gap.
//
// Usage: pnpm sim [all|gates|runs] [seedCount] [key=value ...]   (key=value overrides a tunable)
import { CAMERA_ANCHOR, CAMERA_MIN_SPEED_DELAY, DT, FIRST_GATE_TOP, GATE_SPACING, ORB_RADIUS, START_POLARITY, TIER_STARTS, VIEW_H, VIEW_W } from '../src/config.ts';
import { buildGate, cameraPush, catalogue, GateStream, isTimed, placeGate, stepGate } from '../src/gates.ts';
import { flip, step, type Scene } from '../src/physics.ts';
import { TUNE } from '../src/tune.ts';
import type { GateSpec, Magnet, Orb, Pattern, PlacedGate, Polarity } from '../src/types.ts';
import { fitZones, zoneClashes } from '../src/zones.ts';

const DECISION = 0.1;
const STEPS = Math.round(DECISION / DT);
const BEAM = 3000;
const MAX_T = 10;
const RUN_BEAM = 1200;
const RUN_GATES = 60;
const PHASES = [0, 0.25, 0.5, 0.75];

const clone = (o: Orb): Orb => ({ ...o, stuck: o.stuck ? { ...o.stuck } : null });
const specName = (s: GateSpec): string => `${s.family}[${s.variant}]t${s.tier}${s.mirror ? 'm' : ''}${s.swap ? 's' : ''}`;

function start(x0: number, pol: Polarity): Orb {
  return { x: x0, y: -120, vx: 0, vy: TUNE.terminalFall * 0.8, prevX: x0, prevY: -120, polarity: pol, stuck: null };
}

/** A stretch of gates with the physics scene they make. Gate machinery is mutable; nodes save and restore it. */
interface Course {
  gates: PlacedGate[];
  scene: Scene;
}

function course(gates: PlacedGate[]): Course {
  return { gates, scene: { magnets: gates.flatMap((g) => g.magnets), solids: gates.flatMap((g) => g.solids), saws: gates.flatMap((g) => g.saws) } };
}

const saveState = (gs: readonly PlacedGate[]): number[] => gs.flatMap((g) => g.state);
function loadState(gs: readonly PlacedGate[], s: readonly number[]): void {
  let k = 0;
  for (const g of gs) for (let i = 0; i < g.state.length; i++) g.state[i] = s[k++]!;
}
const stateKey = (s: readonly number[]): string => s.map((v) => Math.round(v * 10)).join(':');

/** Step machinery then physics, like the game. */
function tick(c: Course, orb: Orb, t: number): boolean {
  for (const g of c.gates) stepGate(g, orb, t, DT);
  return step(orb, c.scene, DT) !== 'dead';
}

interface Node {
  orb: Orb;
  state: number[];
  flips: number;
}

/** Minimum flips needed to clear, or -1 if no flip sequence works. */
function solve(c: Course, clearY: number, x0: number, pol: Polarity): number {
  const init = saveState(c.gates);
  let beam: Node[] = [{ orb: start(x0, pol), state: init, flips: 0 }];
  let best = -1;
  let t = 0;
  for (; t < MAX_T && beam.length; t += DECISION) {
    const next = new Map<string, Node>();
    for (const s of beam) {
      for (const doFlip of [false, true]) {
        const o = clone(s.orb);
        loadState(c.gates, s.state);
        if (doFlip) flip(o);
        const flips = s.flips + (doFlip ? 1 : 0);
        let r: 'dead' | 'clear' | 'ok' = 'ok';
        for (let i = 0; i < STEPS; i++) {
          if (!tick(c, o, t + i * DT)) {
            r = 'dead';
            break;
          }
          if (o.y > clearY) {
            r = 'clear';
            break;
          }
        }
        if (r === 'dead') continue;
        if (r === 'clear') {
          if (best < 0 || flips < best) best = flips;
          continue;
        }
        const state = saveState(c.gates);
        const key = keyOf(o, stateKey(state));
        const prev = next.get(key);
        if (!prev || prev.flips > flips) next.set(key, { orb: o, state, flips });
      }
    }
    beam = [...next.values()];
    if (beam.length > BEAM) {
      beam.sort((a, b) => b.orb.y - a.orb.y);
      beam = beam.slice(0, BEAM);
    }
    if (best >= 0) break;
  }
  loadState(c.gates, init);
  return best;
}

/** Whether simply falling with no flips clears (the "idle" route). */
function idleClears(c: Course, clearY: number, x0: number, pol: Polarity): boolean {
  const init = saveState(c.gates);
  const o = start(x0, pol);
  let ok = false;
  for (let i = 0; i < MAX_T / DT; i++) {
    if (!tick(c, o, i * DT)) break;
    if (o.y > clearY) {
      ok = true;
      break;
    }
  }
  loadState(c.gates, init);
  return ok;
}

const keyOf = (o: Orb, extra = ''): string =>
  `${Math.round(o.x / 3)},${Math.round(o.y / 3)},${Math.round(o.vx / 25)},${Math.round(o.vy / 25)},${o.polarity},${o.stuck ? 1 : 0},${extra}`;

const variants = (s: GateSpec): GateSpec[] => [false, true].flatMap((mirror) => [false, true].map((swap) => ({ ...s, mirror, swap })));

/** Gate magnets moved down by dy. */
function shifted(p: Pattern, dy: number): Magnet[] {
  return p.magnets.map((m): Magnet => (m.kind === 'point' ? { ...m, y: m.y + dy } : { ...m, ay: m.ay + dy, by: m.by + dy }));
}

/**
 * Fit each canonical gate against every gate that could sit above or below it, at the tightest spacing,
 * and keep the smallest reach each magnet ever gets. Returns those reaches and the number of zone clashes.
 */
function fitCatalogue(specs: GateSpec[]): { reaches: Map<string, number[]>; clashes: number } {
  const all = specs.flatMap(variants).map((s) => buildGate(s));
  const gap = Math.min(...GATE_SPACING);
  const reaches = new Map<string, number[]>();
  let clashes = 0;
  const sample: string[] = [];
  for (const spec of specs) {
    const mid = buildGate(spec);
    fitZones([], mid.magnets);
    const worst = mid.magnets.map((m) => m.reach);
    for (const other of all) {
      const above = shifted(other, 0);
      fitZones([], above);
      const m1 = shifted(mid, other.height + gap);
      fitZones(above, m1);
      const m2 = shifted(mid, 0);
      fitZones([], m2);
      const below = shifted(other, mid.height + gap);
      fitZones(m2, below);
      for (const [ms, pair] of [
        [m1, [...above, ...m1]],
        [m2, [...m2, ...below]],
      ] as const) {
        ms.forEach((m, k) => (worst[k] = Math.min(worst[k]!, m.reach)));
        const n = zoneClashes(pair).length;
        clashes += n;
        if (n && sample.length < 5) sample.push(specName(spec));
      }
    }
    reaches.set(specName(spec), worst);
  }
  console.log(`Zones: gap ${TUNE.zoneGap}px, ${clashes ? `CLASHES in ${sample.join(', ')}` : 'no two zones closer than the gap with any neighbouring gate'}.`);
  return { reaches, clashes };
}

function checkCatalogue(): number {
  const { reaches, clashes } = fitCatalogue(catalogue());
  // SIM_ONLY=iris,rail limits the solve to some families (zones are still fitted against all of them).
  const only = process.env.SIM_ONLY?.split(',');
  const specs = catalogue().filter((sp) => !only || only.includes(sp.family));
  const starts = [20, 60, 100, 140, 180, 220, 260, 300, 340];
  console.log(`Catalogue: ${specs.length} canonical gates (x4 with mirror and colour swap), ${starts.length * 2} entries each, timed gates at ${PHASES.length} phases.`);
  const rows = new Map<string, { gates: number; entries: number; idleFail: number; flips: number[]; unsolved: string[] }>();
  let unsolvedTotal = 0;
  let total = 0;
  const t0 = Date.now();
  for (const spec of specs) {
    const g = placeGate(0, spec, 0);
    const worst = reaches.get(specName(spec))!;
    g.magnets.forEach((m, k) => (m.reach = worst[k]!));
    const c = course([g]);
    const clearY = g.top + g.height + 20;
    const period = g.machine.type === 'alt' ? g.machine.period : Math.max(0, ...g.saws.map((s) => s.period));
    const phases = isTimed(g) ? PHASES.map((p) => p * period) : [0];
    const key = `${spec.family.padEnd(14)} tier ${spec.tier}`;
    const row = rows.get(key) ?? { gates: 0, entries: 0, idleFail: 0, flips: [], unsolved: [] };
    rows.set(key, row);
    row.gates++;
    for (const phase of phases) {
      g.phase = phase;
      for (const x0 of starts) {
        for (const pol of ['red', 'blue'] as Polarity[]) {
          row.entries++;
          total++;
          if (!idleClears(c, clearY, x0, pol)) row.idleFail++;
          const f = solve(c, clearY, x0, pol);
          if (f < 0) {
            row.unsolved.push(`${specName(spec)}@${x0}${pol[0]}${phases.length > 1 ? `p${phase.toFixed(2)}` : ''}`);
            unsolvedTotal++;
          } else row.flips.push(f);
        }
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
  console.log(`Catalogue: ${total - unsolvedTotal}/${total} gate entries solvable in ${((Date.now() - t0) / 1000).toFixed(1)} s.\n`);
  return unsolvedTotal + clashes;
}

interface RunState extends Node {
  cam: number;
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
  // Fields and machinery never reach past a neighbouring gate, so each gate only needs itself and its neighbours.
  const near = gates.map((_, i) => course(gates.slice(Math.max(0, i - 1), i + 2)));
  const gateIndexAt = (y: number): number => {
    let k = 0;
    while (k < gates.length - 1 && y >= gates[k + 1]!.top) k++;
    return k;
  };
  const clearedAt = (y: number): number => {
    let n = 0;
    while (n < gates.length && y > gates[n]!.passY) n++;
    return n;
  };
  const goal = gates[RUN_GATES - 1]!.passY;
  const x = VIEW_W / 2;
  const orb0: Orb = { x, y: 0, vx: 0, vy: 0, prevX: x, prevY: 0, polarity: START_POLARITY, stuck: null };
  let beam: RunState[] = [{ orb: orb0, state: saveState(gates), cam: -VIEW_H * CAMERA_ANCHOR, flips: 0 }];
  let t = 0;
  let deepest = 0;
  while (beam.length) {
    const next = new Map<string, RunState>();
    for (const s of beam) {
      for (const doFlip of [false, true]) {
        const o = clone(s.orb);
        loadState(gates, s.state);
        if (doFlip) flip(o);
        let cam = s.cam;
        let dead = false;
        let tt = t;
        for (let i = 0; i < STEPS; i++) {
          if (!tick(near[gateIndexAt(o.y)]!, o, tt)) {
            dead = true;
            break;
          }
          tt += DT;
          const prevCam = cam;
          cam = Math.max(cam, o.y - VIEW_H * CAMERA_ANCHOR);
          if (tt > CAMERA_MIN_SPEED_DELAY) cam = Math.max(cam, prevCam + cameraPush(clearedAt(o.y)) * DT);
          if (o.y + ORB_RADIUS < cam) {
            dead = true;
            break;
          }
        }
        if (dead) continue;
        const flips = s.flips + (doFlip ? 1 : 0);
        if (o.y > goal) return { cleared: RUN_GATES, flips, seconds: t + DECISION, failedAt: '' };
        const k = gateIndexAt(o.y);
        const state = saveState(gates);
        const local = saveState(gates.slice(Math.max(0, k - 1), k + 2));
        const key = keyOf(o, `${Math.round(cam / 8)},${stateKey(local)}`);
        const prev = next.get(key);
        if (!prev || prev.flips > flips) next.set(key, { orb: o, state, cam, flips });
      }
    }
    beam = prune([...next.values()], RUN_BEAM);
    if (beam.length) deepest = Math.max(deepest, beam[0]!.orb.y);
    t += DECISION;
  }
  const k = gateIndexAt(deepest);
  return { cleared: clearedAt(deepest), flips: -1, seconds: t, failedAt: `gate ${k} ${specName(gates[k]!.spec)}` };
}

function checkRuns(seeds: number): number {
  console.log(`Runs: ${seeds} generated runs of ${RUN_GATES} gates with the camera chasing (tutorial, then tiers start at gates ${TIER_STARTS.join(', ')}).`);
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
