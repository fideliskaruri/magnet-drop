import { audioStats, renderOffline, SOUND_NAMES, type AudioStats, type RenderResult, type SoundName } from './audio.ts';
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
  resetFrameWork(): void;
  /** Slow motion for frame-by-frame screenshots (dev only). */
  setTimeScale(s: number): void;
  /** Force a minimum intensity, as if deep in a run. */
  setHeatFloor(h: number): void;
  /** Fire every effect repeatedly to stress the frame budget. */
  setStress(on: boolean): void;
  juice(): {
    heat: number;
    reduced: boolean;
    maxShakePx: number;
    maxFlashAlpha: number;
    maxZoomDev: number;
    flashTimes: number[];
    particles: number;
    nearMisses: number;
    chain: number;
  };
  resetJuiceStats(): void;
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

export const debugState = { timeScale: 1 };

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
    resetFrameWork() {
      work.length = 0;
    },
    setTimeScale(s) {
      debugState.timeScale = s;
    },
    setHeatFloor(h) {
      game.heatFloor = h;
    },
    setStress(on) {
      game.stress = on;
    },
    juice() {
      const fx = game.fx;
      return {
        heat: game.heat,
        reduced: fx.reduced,
        maxShakePx: fx.maxShakePx,
        maxFlashAlpha: fx.maxFlashAlpha,
        maxZoomDev: fx.maxZoomDev,
        flashTimes: [...fx.flashTimes],
        particles: fx.particleCount,
        nearMisses: game.nearMisses,
        chain: game.chain,
      };
    },
    resetJuiceStats() {
      game.fx.resetStats();
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
