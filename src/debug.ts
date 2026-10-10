import { audioStats, renderOffline, SOUND_NAMES, type AudioStats, type RenderResult, type SoundName } from './audio.ts';
import type { Game } from './game.ts';

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
  };
  /** Fix the seed and the first pattern indices (0-based) for the next run. */
  setup(seed: number, forcedPatterns?: number[]): void;
  /** Milliseconds of update + render work per frame, oldest first (last 600 frames). */
  frameWork(): number[];
  audio(): AudioStats;
  /** Every sound and layer the engine can make, for offline rendering. */
  soundNames(): readonly SoundName[];
  /** Render one sound through the full output chain in an OfflineAudioContext. */
  renderSound(name: SoundName): Promise<RenderResult>;
  /** The levels the continuous layers are following right now. */
  mix(): { attract: number; repel: number; stuck: number; speed: number; danger: number };
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
      };
    },
    setup(seed, forcedPatterns = []) {
      game.seedOverride = seed;
      game.forcedPatterns = forcedPatterns;
    },
    frameWork() {
      return [...work];
    },
    audio: audioStats,
    soundNames: () => SOUND_NAMES,
    renderSound: (name) => renderOffline(name),
    mix() {
      const m = game.mix();
      return { attract: m.attract, repel: m.repel, stuck: m.stuck, speed: m.speed, danger: m.danger };
    },
  };
}
