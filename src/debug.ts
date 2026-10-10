import { ORB_RADIUS } from './config.ts';
import type { Game } from './game.ts';
import { hitsSpikes } from './physics.ts';
import type { PowerKind } from './types.ts';

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
    /** Power-up state. */
    boost: number;
    boosting: boolean;
    phase: number;
    shield: boolean;
    grace: number;
    collected: number;
    saves: number;
    smashed: number;
    /** The orb overlaps a spike row right now (only survivable with a power-up). */
    inSpikes: boolean;
    inGap: boolean;
    pickups: { kind: PowerKind; x: number; y: number }[];
    pickupsSpawned: number;
  };
  /** Fix the seed and the first pattern indices (0-based) for the next run. */
  setup(seed: number, forcedPatterns?: number[]): void;
  /** Place a power-up token relative to the orb. It is collected through normal play. */
  spawnPickup(kind: PowerKind, dx: number, dy: number): void;
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
      const o = game.orb;
      const p = game.world.patternAt(o.y);
      return {
        state: game.state,
        x: o.x,
        y: o.y,
        vx: o.vx,
        vy: o.vy,
        polarity: o.polarity,
        stuck: o.stuck !== null,
        score: game.score,
        best: game.best,
        camY: game.camY,
        launches: game.launches,
        pattern: p ? p.index : null,
        patternTop: p ? p.top : null,
        magnets: game.world.magnets.length,
        spikes: game.world.spikes.length,
        boost: game.boost,
        boosting: game.boosting,
        phase: game.phase,
        shield: game.shield,
        grace: game.grace,
        collected: game.collected,
        saves: game.saves,
        smashed: game.smashed,
        inSpikes: game.world.spikes.some((r) => hitsSpikes(r, o.x, o.y, ORB_RADIUS - 2)),
        inGap: game.world.inGap(o.y),
        pickups: game.world.pickups.filter((k) => !k.taken).map((k) => ({ kind: k.kind, x: k.x, y: k.y })),
        pickupsSpawned: game.world.pickupsSpawned,
      };
    },
    setup(seed, forcedPatterns = []) {
      game.seedOverride = seed;
      game.forcedPatterns = forcedPatterns;
    },
    spawnPickup(kind, dx, dy) {
      game.world.addPickup(kind, game.orb.x + dx, game.orb.y + dy);
    },
    frameWork() {
      return [...work];
    },
  };
}
