import type { Game } from './game.ts';
import { World } from './world.ts';

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
    pattern: number | null;
    patternTop: number | null;
    magnets: number;
    spikes: number;
    shield: boolean;
    grace: number;
    shieldsUsed: number;
    patternsPassed: number;
  };
  /** Fix the seed and the first pattern indices (0-based) for the next run. `shield: false` starts it without a shield. */
  setup(seed: number, forcedPatterns?: number[], shield?: boolean): void;
  /** Tiers of the first `n` patterns a real run with this seed would spawn. */
  ramp(seed: number, n: number): number[];
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
      const p = game.world.patternAt(game.orb.y);
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
        pattern: p ? p.index : null,
        patternTop: p ? p.top : null,
        magnets: game.world.magnets.length,
        spikes: game.world.spikes.length,
        shield: game.shield,
        grace: game.grace,
        shieldsUsed: game.shieldsUsed,
        patternsPassed: game.patternsPassed,
      };
    },
    setup(seed, forcedPatterns = [], shield = true) {
      game.seedOverride = seed;
      game.forcedPatterns = forcedPatterns;
      game.startShield = shield;
    },
    ramp(seed, n) {
      const w = new World(seed);
      const tiers = new Map<number, number>();
      for (let y = 0; tiers.size < n; y += 100) {
        w.update(y);
        for (const p of w.placed) tiers.set(p.top, p.tier);
      }
      return [...tiers.values()].slice(0, n);
    },
    frameWork() {
      return [...work];
    },
  };
}
