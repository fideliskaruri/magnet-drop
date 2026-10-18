import { isPanelOpen } from './panel.ts';
import { TUNE, type Tune } from './tune.ts';
import { zoneClashes } from './zones.ts';
import { audioStats, renderOffline, SOUND_NAMES, type AudioStats, type RenderResult, type SoundName } from './audio.ts';
import type { Game } from './game.ts';
import { GateStream } from './gates.ts';
import type { GateSpec, PlacedGate } from './types.ts';
import { clearAnalytics, events, flush, summary, type AnalyticsEvent, type Summary } from './analytics.ts';

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
    magnets: number;
    saws: number;
    /** Gates dropped through, clean passes in a row, and the last pass. */
    cleared: number;
    combo: number;
    cleanPasses: number;
    kicks: number;
    lastPass: { index: number; clean: boolean; x: number } | null;
    deathCause: string;
    /** The next gate to clear (index and family). */
    next: number | null;
    nextFamily: string | null;
    runTime: number;
  };
  /** Fix the seed and pin the first gates for the next run. */
  setup(seed: number, forcedGates?: GateSpec[]): void;
  /** Live gates near the camera with their solids, magnets, saws and machine state. */
  gates(): PlacedGate[];
  /** Local analytics: raw events and the summary the panel shows. */
  analytics(): { events: AnalyticsEvent[]; summary: Summary };
  clearAnalytics(): void;
  /** The first n gate specs a seed would generate. */
  preview(seed: number, n: number): GateSpec[];
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
  /** Live tunables plus the fitted zones of every live magnet. */
  tune(): { values: Tune; reaches: number[]; clashes: number; paused: boolean };
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
    tune() {
      return { values: { ...TUNE }, reaches: game.world.magnets.map((m) => m.reach), clashes: zoneClashes(game.world.magnets).length, paused: isPanelOpen() };
    },
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
        magnets: game.world.magnets.length,
        saws: game.world.saws.length,
        cleared: game.cleared,
        combo: game.combo,
        cleanPasses: game.cleanPasses,
        kicks: game.kicks,
        lastPass: game.lastPass,
        deathCause: game.deathCause,
        next: game.world.next()?.index ?? null,
        nextFamily: game.world.next()?.spec.family ?? null,
        runTime: game.runTime,
      };
    },
    setup(seed, forcedGates = []) {
      game.seedOverride = seed;
      game.forcedGates = forcedGates;
    },
    gates() {
      return game.world.placed;
    },
    analytics() {
      flush();
      return { events: events(), summary: summary() };
    },
    clearAnalytics,
    preview(seed, n) {
      const s = new GateStream(seed);
      return Array.from({ length: n }, () => s.next());
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
