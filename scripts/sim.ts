// Fairness proof for the runner. Runs the real physics headless (src/physics.ts + src/gates.ts).
//
// 1. Gates: every catalogue gate (every family and variant, at its lowest tier) from 7 entry heights x both
//    polarities, at the slowest and fastest scroll speed, and for timed or moving gates at 4 clock phases.
//    The orb starts only the tightest gate spacing ahead of the gate. A beam search over flips (one choice
//    every DECISION seconds) must get it through without being pushed off the left edge or caught in machinery.
// 2. Runs: whole seeded runs exactly as the game builds them (tutorial, then the stream, with the speed
//    stepping up per tier). The beam search must clear RUN_GATES gates in a row for every seed.
//
// Time is the run clock, so moving machinery replays deterministically.
// Usage: pnpm sim [all|gates|runs] [seedCount] [family=name] [key=value ...]   (key=value overrides a tunable)
import { ANCHOR, CEIL, DT, FIRST_GATE_X, FLOOR, GATE_SPACING, MID, ORB_RADIUS, SPEED_EASE, TIER_SPEED, VIEW_W } from '../src/config.ts';
import { buildGate, catalogue, cloneGate, GateStream, tierOf } from '../src/gates.ts';
import { flip, makeOrb, step, type Sim } from '../src/physics.ts';
import { TUNE } from '../src/tune.ts';
import type { Gate, GateSpec, Orb, Polarity } from '../src/types.ts';
import { World } from '../src/world.ts';

const DECISION = 0.1;
const STEPS = Math.round(DECISION / DT);
const BEAM = 160;
// A case the narrow beam misses is retried wide before it counts as a failure.
const WIDE_BEAM = 1500;
const MAX_T = 9;
const RUN_BEAM = 200;
const RUN_GATES = 45;
const R = ORB_RADIUS;
const MIN_SPACING = Math.min(...GATE_SPACING);
const PHASES = [0, 0.65, 1.3, 1.95];
const ENTRY_Y = [CEIL + R, CEIL + 50, 110, MID, 250, FLOOR - 50, FLOOR - R];

const specName = (s: GateSpec): string => `${s.family}[${s.v.join(',')}]t${s.tier}`;

interface Node {
  sim: Sim;
  flips: number;
  knocks: number;
  cleared: number;
  /** Next pristine gate to bring into play (runs). */
  next: number;
}

function cloneSim(sim: Sim): Sim {
  const gates = sim.gates.map(cloneGate);
  const o: Orb = { ...sim.orb, stuck: null };
  const st = sim.orb.stuck;
  if (st) {
    let shape = null;
    if (st.shape) {
      for (let i = 0; i < sim.gates.length && !shape; i++) {
        const j = sim.gates[i]!.shapes.indexOf(st.shape);
        if (j >= 0) shape = gates[i]!.shapes[j] ?? null;
      }
    }
    o.stuck = { dir: st.dir, shape };
  }
  return { orb: o, t: sim.t, camX: sim.camX, speed: sim.speed, gates };
}

function key(n: Node): string {
  const o = n.sim.orb;
  let k = `${o.polarity[0]}${o.stuck ? o.stuck.dir : 0}|${Math.round(o.x / 8)}|${Math.round(o.y / 4)}|${Math.round(o.vy / 30)}|${Math.round(o.vx / 30)}|${n.cleared}`;
  for (const g of n.sim.gates) {
    if (g.x > o.x + 400 || g.x + g.width < o.x - 50) continue;
    for (const v of g.s) k += `|${Math.round(v * 5)}`;
  }
  return k;
}

type Extend = (n: Node) => boolean;

/** Advance a node by one decision. Returns null if the orb dies. */
function advance(n: Node, doFlip: boolean, extend: Extend | null): Node | null {
  const c: Node = { ...n, sim: cloneSim(n.sim) };
  if (doFlip) {
    flip(c.sim);
    c.flips++;
  }
  for (let i = 0; i < STEPS; i++) {
    if (extend && !extend(c)) return null;
    const ev = step(c.sim, DT);
    if (ev === 'camera' || ev === 'hazard') return null;
    if (ev === 'knock') c.knocks++;
  }
  return c;
}

/** Beam search. `done` decides success; `extend` adds gates and steers speed in run mode. */
function search(root: Node, done: (n: Node) => boolean, width: number, maxT: number, extend: Extend | null = null): Node | null {
  let beam: Node[] = [root];
  const t0 = root.sim.t;
  while (beam.length) {
    const seen = new Set<string>();
    const nextBeam: Node[] = [];
    for (const n of beam) {
      for (const f of [false, true]) {
        const c = advance(n, f, extend);
        if (!c) continue;
        if (done(c)) return c;
        const k = key(c);
        if (seen.has(k)) continue;
        seen.add(k);
        nextBeam.push(c);
      }
    }
    if (!nextBeam.length) return null;
    if (nextBeam[0]!.sim.t - t0 > maxT) return null;
    // Furthest along first; fewer flips break ties so the beam keeps calm lines too.
    nextBeam.sort((a, b) => b.cleared - a.cleared || b.sim.orb.x - a.sim.orb.x || a.flips - b.flips);
    beam = diverse(nextBeam, width);
  }
  return null;
}

/** Keep the best, but reserve room for each (polarity, height band) so the beam doesn't collapse onto one line. */
function diverse(list: Node[], width: number): Node[] {
  if (list.length <= width) return list;
  const out: Node[] = [];
  const perBucket = new Map<string, number>();
  const cap = Math.max(4, Math.floor(width / 12));
  const rest: Node[] = [];
  for (const n of list) {
    const o = n.sim.orb;
    const b = `${o.polarity}${Math.floor((o.y - CEIL) / 50)}`;
    const used = perBucket.get(b) ?? 0;
    if (used < cap) {
      perBucket.set(b, used + 1);
      out.push(n);
    } else rest.push(n);
    if (out.length >= width) return out;
  }
  for (const n of rest) {
    out.push(n);
    if (out.length >= width) break;
  }
  return out;
}

function entryNode(gate: Gate, y: number, pol: Polarity, speed: number, t0: number): Node {
  const x = gate.x - MIN_SPACING;
  const orb = makeOrb(x, y, pol);
  orb.vx = speed;
  if (y <= CEIL + R && pol === 'red') orb.stuck = { dir: -1, shape: null };
  if (y >= FLOOR - R && pol === 'blue') orb.stuck = { dir: 1, shape: null };
  const sim: Sim = { orb, t: t0, camX: x - ANCHOR * VIEW_W, speed, gates: [gate] };
  return { sim, flips: 0, knocks: 0, cleared: 0, next: 0 };
}

function timed(spec: GateSpec): boolean {
  const v = spec.v;
  if (spec.family === 'dual') return (v[1] ?? 0) === 1 || (v[2] ?? 0) === 1;
  if (spec.family === 'pendulum') return (v[1] ?? 0) === 1;
  return false;
}

function runGates(): boolean {
  const only = args.find((a) => a.startsWith('family='))?.slice(7);
  const specs = catalogue().filter((s) => !only || s.family === only);
  const speeds = [TUNE.baseSpeed * TIER_SPEED[0], TUNE.baseSpeed * TIER_SPEED[TIER_SPEED.length - 1]!];
  let cases = 0;
  let failed = 0;
  let maxFlips = 0;
  let knocked = 0;
  const byFamily = new Map<string, { cases: number; fail: number }>();
  const failures: string[] = [];
  const started = performance.now();
  for (const spec of specs) {
    const phases = timed(spec) ? PHASES : [0];
    for (const speed of speeds) {
      for (const t0 of phases) {
        for (const y of ENTRY_Y) {
          for (const pol of ['red', 'blue'] as const) {
            const gate = buildGate(spec, 0, 1000);
            const root = entryNode(gate, y, pol, speed, t0);
            const end = gate.x + gate.width + 30;
            const done = (n: Node) => n.sim.orb.x - R > end;
            const res = search(root, done, BEAM, MAX_T) ?? search(entryNode(buildGate(spec, 0, 1000), y, pol, speed, t0), done, WIDE_BEAM, MAX_T);
            cases++;
            const f = byFamily.get(spec.family) ?? { cases: 0, fail: 0 };
            f.cases++;
            if (!res) {
              failed++;
              f.fail++;
              failures.push(`${specName(spec)} y=${y} ${pol} speed=${speed.toFixed(0)} t0=${t0}`);
            } else {
              maxFlips = Math.max(maxFlips, res.flips);
              if (res.knocks) knocked++;
            }
            byFamily.set(spec.family, f);
          }
        }
      }
    }
  }
  const secs = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`Gates: ${specs.length} catalogue gates, ${cases} cases, ${cases - failed} cleared, ${failed} failed (${secs}s).`);
  for (const [fam, f] of byFamily) console.log(`  ${fam.padEnd(9)} ${String(f.cases - f.fail).padStart(4)}/${f.cases}`);
  console.log(`  Most flips on a solution: ${maxFlips}. Solutions that needed a knock-back: ${knocked}.`);
  for (const f of failures.slice(0, 40)) console.log(`  FAIL ${f}`);
  if (failures.length > 40) console.log(`  ... and ${failures.length - 40} more`);
  return failed === 0;
}

/** Same gate layout as World, but all gates up front so each search node can bring its own copies in. */
function runCourse(seed: number, n: number): Gate[] {
  const w = new World();
  const stream = new GateStream(seed);
  const gates: Gate[] = [];
  let x = FIRST_GATE_X;
  for (let i = 0; i < n; i++) {
    const g = buildGate(stream.next(i), i, x);
    gates.push(g);
    x = g.x + g.width + w.spacingAfter(i);
  }
  return gates;
}

function runRuns(seeds: number): boolean {
  let ok = 0;
  const started = performance.now();
  for (let seed = 1; seed <= seeds; seed++) {
    const course = runCourse(seed, RUN_GATES);
    const orb = makeOrb(ANCHOR * VIEW_W, FLOOR - R, 'blue');
    orb.stuck = { dir: 1, shape: null };
    const sim: Sim = { orb, t: 0, camX: 0, speed: TUNE.baseSpeed, gates: [] };
    const root: Node = { sim, flips: 0, knocks: 0, cleared: 0, next: 0 };
    // The game's first tap is a flip off the floor.
    flip(sim);
    root.flips = 1;
    const extend: Extend = (nd) => {
      const s = nd.sim;
      const o = s.orb;
      while (nd.next < course.length && course[nd.next]!.x < o.x + 800) s.gates.push(cloneGate(course[nd.next++]!));
      for (const g of s.gates) {
        if (!g.scored && o.x - R > g.x + g.width) {
          g.scored = true;
          nd.cleared++;
        }
      }
      while (s.gates.length && s.gates[0]!.x + s.gates[0]!.width < s.camX - 240) s.gates.shift();
      const target = TUNE.baseSpeed * (TIER_SPEED[tierOf(nd.cleared)] ?? 1);
      s.speed += (target - s.speed) * (1 - Math.exp(-SPEED_EASE * DT));
      return true;
    };
    extend(root);
    const res = search(root, (nd) => nd.cleared >= RUN_GATES, RUN_BEAM, 400, extend) ?? search(root, (nd) => nd.cleared >= RUN_GATES, WIDE_BEAM, 400, extend);
    const families = course.map((g) => g.spec.family[0]).join('');
    if (res) {
      ok++;
      console.log(`  seed ${String(seed).padStart(3)}: cleared ${RUN_GATES} gates in ${res.sim.t.toFixed(1)}s, ${res.flips} flips, ${res.knocks} knocks  ${families}`);
    } else console.log(`  seed ${String(seed).padStart(3)}: FAILED  ${families}`);
  }
  const secs = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`Runs: ${ok}/${seeds} seeds cleared ${RUN_GATES} gates (${secs}s).`);
  return ok === seeds;
}

const args = process.argv.slice(2);
const mode = args.find((a) => ['all', 'gates', 'runs'].includes(a)) ?? 'all';
const count = Number(args.find((a) => /^\d+$/.test(a)) ?? 12);
for (const a of args) {
  const m = /^(\w+)=(-?[\d.]+)$/.exec(a);
  if (!m) continue;
  const k = m[1] as keyof typeof TUNE;
  if (!(k in TUNE)) {
    console.error(`Unknown tunable ${k}.`);
    process.exit(2);
  }
  TUNE[k] = Number(m[2]);
  console.log(`Override ${k}=${TUNE[k]}`);
}

let pass = true;
if (mode === 'all' || mode === 'gates') pass = runGates() && pass;
if (mode === 'all' || mode === 'runs') pass = runRuns(count) && pass;
console.log(pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
