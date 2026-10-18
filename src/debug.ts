import { events, summary, type Summary } from './analytics.ts';
import { audioStats, renderOffline, SOUND_NAMES, type AudioStats, type RenderResult, type SoundName } from './audio.ts';
import type { Game } from './game.ts';
import { catalogue, GateStream } from './gates.ts';
import { isPanelOpen } from './panel.ts';
import { pullAccel, zoneAt } from './physics.ts';
import { TUNE, type Tune } from './tune.ts';
import type { GateSpec, Polarity } from './types.ts';

export interface Snapshot {
  state: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Vertical field acceleration right now (negative = up). */
  ay: number;
  polarity: Polarity;
  stuck: boolean;
  /** -1 stuck to something above, +1 below, 0 free. */
  stuckDir: number;
  score: number;
  best: number;
  camX: number;
  /** Orb x on screen (px from the left edge of the playfield). */
  screenX: number;
  speed: number;
  t: number;
  gatesCleared: number;
  streak: number;
  centres: number;
  launches: number;
  knocks: number;
  flips: number;
  deathCause: string;
  hint: string;
  /** Next gate the orb hasn't passed. */
  gate: number | null;
  family: string | null;
  gateX: number | null;
}

export interface DebugHook {
  snapshot(): Snapshot;
  gates(): { index: number; family: string; v: number[]; x: number; width: number; keyX: number; scored: boolean; centre: boolean | null; touched: boolean }[];
  /** Fix the seed (null = random) and pin the first gates for the next run. */
  setup(seed: number | null, forcedGates?: GateSpec[]): void;
  /** Move the orb (teleport, for tests). */
  place(x: number, y: number, vx?: number, vy?: number): void;
  /** The first n gate specs a seed would generate. */
  preview(seed: number, n: number): GateSpec[];
  catalogue(): GateSpec[];
  frameWork(): number[];
  resetFrameWork(): void;
  setTimeScale(s: number): void;
  setStress(on: boolean): void;
  juice(): { reduced: boolean; maxShakePx: number; maxFlashAlpha: number; flashTimes: number[]; particles: number };
  resetJuiceStats(): void;
  tune(): { values: Tune; paused: boolean };
  analytics(): { events: Record<string, unknown>[]; summary: Summary };
  audio(): AudioStats;
  soundNames(): readonly SoundName[];
  renderSound(name: SoundName): Promise<RenderResult>;
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
      const o = game.orb;
      const sim = game.sim;
      const g = game.world.upcoming(o.x);
      return {
        state: game.state,
        x: o.x,
        y: o.y,
        vx: o.vx,
        vy: o.vy,
        ay: pullAccel(o, zoneAt(sim.gates, o.x, o.y)),
        polarity: o.polarity,
        stuck: o.stuck !== null,
        stuckDir: o.stuck ? o.stuck.dir : 0,
        score: game.score,
        best: game.best,
        camX: sim.camX,
        screenX: o.x - sim.camX,
        speed: sim.speed,
        t: sim.t,
        gatesCleared: game.gatesCleared,
        streak: game.streak,
        centres: game.centres,
        launches: game.launches,
        knocks: game.knocks,
        flips: game.flips,
        deathCause: game.deathCause,
        hint: game.hint,
        gate: g ? g.index : null,
        family: g ? g.spec.family : null,
        gateX: g ? g.x : null,
      };
    },
    gates() {
      return game.world.gates.map((g) => ({
        index: g.index,
        family: g.spec.family,
        v: g.spec.v.slice(),
        x: g.x,
        width: g.width,
        keyX: g.keyX,
        scored: g.scored,
        centre: g.centre,
        touched: g.touched,
      }));
    },
    setup(seed, forcedGates = []) {
      game.seedOverride = seed;
      game.forcedGates = forcedGates;
      if (game.state === 'ready') game.resetRun();
    },
    place(x, y, vx, vy) {
      const o = game.orb;
      o.x = o.prevX = x;
      o.y = o.prevY = y;
      if (vx !== undefined) o.vx = vx;
      if (vy !== undefined) o.vy = vy;
      o.stuck = null;
    },
    preview(seed, n) {
      const s = new GateStream(seed);
      return Array.from({ length: n }, (_, i) => s.next(i));
    },
    catalogue,
    frameWork() {
      return [...work];
    },
    resetFrameWork() {
      work.length = 0;
    },
    setTimeScale(s) {
      debugState.timeScale = s;
    },
    setStress(on) {
      game.stress = on;
    },
    juice() {
      const fx = game.fx;
      return { reduced: fx.reduced, maxShakePx: fx.maxShakePx, maxFlashAlpha: fx.maxFlashAlpha, flashTimes: [...fx.flashTimes], particles: fx.particleCount };
    },
    resetJuiceStats() {
      game.fx.resetStats();
    },
    tune() {
      return { values: { ...TUNE }, paused: isPanelOpen() };
    },
    analytics() {
      const list = events();
      return { events: list as unknown as Record<string, unknown>[], summary: summary(list) };
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
