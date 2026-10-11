import { GateStream } from './gates.ts';
import type { Game } from './game.ts';
import type { GateSpec } from './types.ts';

export interface DebugHook {
  snapshot(): {
    state: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    polarity: string;
    stuck: boolean;
    score: number;
    best: number;
    camY: number;
    launches: number;
    /** Gate the orb is in (index, family, tier, top and pass line). */
    gate: number | null;
    family: string | null;
    tier: number | null;
    gateTop: number | null;
    passY: number | null;
    scorePop: number;
    magnets: number;
    spikes: number;
  };
  /** Fix the seed and pin the first gates for the next run. */
  setup(seed: number, forcedGates?: GateSpec[]): void;
  /** The first n gate specs a seed would generate. */
  preview(seed: number, n: number): GateSpec[];
  /** Milliseconds of update + render work per frame, oldest first (last 600 frames). */
  frameWork(): number[];
}

declare global {
  interface Window {
    __md?: DebugHook;
  }
}

const work: number[] = [];

export function recordFrameWork(ms: number): void {
  work.push(ms);
  if (work.length > 600) work.shift();
}

/** Dev-only read access for browser tests. Not included in production builds. */
export function installDebugHook(game: Game): void {
  window.__md = {
    snapshot() {
      const g = game.world.gateAt(game.orb.y);
      return {
        state: game.state,
        x: game.orb.x,
        y: game.orb.y,
        vx: game.orb.vx,
        vy: game.orb.vy,
        polarity: game.orb.polarity,
        stuck: game.orb.stuck !== null,
        score: game.score,
        best: game.best,
        camY: game.camY,
        launches: game.launches,
        gate: g ? g.index : null,
        family: g ? g.spec.family : null,
        tier: g ? g.spec.tier : null,
        gateTop: g ? g.top : null,
        passY: g ? g.passY : null,
        scorePop: game.scorePop,
        magnets: game.world.magnets.length,
        spikes: game.world.spikes.length,
      };
    },
    setup(seed, forcedGates = []) {
      game.seedOverride = seed;
      game.forcedGates = forcedGates;
    },
    preview(seed, n) {
      const s = new GateStream(seed);
      return Array.from({ length: n }, () => s.next());
    },
    frameWork() {
      return [...work];
    },
  };
}
