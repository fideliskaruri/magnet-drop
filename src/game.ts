import { haptic, SILENT_MIX, sound, unlockAudio, type DeathCause, type Mix } from './audio.ts';
import {
  AUDIO,
  AUTO_READY,
  BEST_KEY,
  CAMERA_ANCHOR,
  CAMERA_MIN_SPEED,
  CAMERA_MIN_SPEED_DELAY,
  COLORS,
  DEATH_FREEZE,
  ORB_RADIUS,
  RESTART_LOCK,
  MAX_SPEED,
  SCORE_DIVISOR,
  VIEW_H,
  VIEW_W,
} from './config.ts';
import { Fx } from './fx.ts';
import { attracts, closestPoint, fieldU, flip, step } from './physics.ts';
import type { GameStateName, Orb, SpikeRow } from './types.ts';
import { World } from './world.ts';

const LAUNCH_HITSTOP = 0.035;

/** Edge-to-edge gap between the orb and a spike row's bounding box. */
function spikeGap(row: SpikeRow, x: number, y: number): number {
  const dx = Math.max(row.x - x, 0, x - (row.x + row.w));
  const dy = Math.max(row.y - y, 0, y - (row.y + row.h));
  return Math.hypot(dx, dy) - ORB_RADIUS;
}

function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

export class Game {
  state: GameStateName = 'ready';
  orb: Orb = Game.freshOrb();
  world = new World(1);
  fx = new Fx();
  camY = 0;
  prevCamY = 0;
  score = 0;
  best = loadBest();
  stateTime = 0;
  runTime = 0;
  hitstop = 0;
  exploded = false;
  launches = 0;
  deathCause: DeathCause = 'spikes';
  /** Set by the dev hook to make runs reproducible. */
  seedOverride: number | null = null;
  forcedPatterns: number[] = [];
  private taps = 0;
  private trailTick = 0;
  // Sound state: these only drive audio and never touch the simulation.
  private readonly mixOut: Mix = { ...SILENT_MIX };
  private stuckTime = 0;
  private lastFlipAt = -1;
  private combo = 0;
  private lastLaunchAt = -1;
  private launchChain = 0;
  private nextMilestone = AUDIO.milestoneEvery;
  private bestAtStart = 0;
  private passedBest = false;
  private nearArmed = false;

  private static freshOrb(): Orb {
    const x = VIEW_W / 2;
    return { x, y: 0, vx: 0, vy: 0, prevX: x, prevY: 0, polarity: 'blue', stuck: null };
  }

  tap(): void {
    unlockAudio();
    this.taps++;
  }

  private startRun(): void {
    const seed = this.seedOverride ?? Math.floor(Math.random() * 2 ** 31);
    this.world = new World(seed, this.forcedPatterns);
    this.orb = Game.freshOrb();
    this.camY = this.prevCamY = this.orb.y - VIEW_H * CAMERA_ANCHOR;
    this.world.update(this.camY);
    this.fx.reset();
    this.score = 0;
    this.runTime = 0;
    this.hitstop = 0;
    this.launches = 0;
    this.exploded = false;
    this.stuckTime = 0;
    this.lastFlipAt = -1;
    this.combo = 0;
    this.lastLaunchAt = -1;
    this.launchChain = 0;
    this.nextMilestone = AUDIO.milestoneEvery;
    this.bestAtStart = this.best;
    this.passedBest = false;
    this.nearArmed = false;
    this.deathCause = 'spikes';
    this.setState('playing');
    sound()?.start();
  }

  private setState(s: GameStateName): void {
    this.state = s;
    this.stateTime = 0;
  }

  private die(cause: DeathCause): void {
    if (this.state !== 'playing') return;
    this.deathCause = cause;
    this.setState('dying');
    this.orb.stuck = null;
    haptic([30, 40, 30]);
    if (this.score > this.best) {
      this.best = this.score;
      try {
        localStorage.setItem(BEST_KEY, String(this.best));
      } catch {
        // Private mode can block storage; the best score just won't persist.
      }
    }
  }

  update(dt: number): void {
    this.prevCamY = this.camY;
    this.stateTime += dt;
    const taps = this.taps;
    this.taps = 0;

    if (this.state === 'ready') {
      this.fx.update(dt);
      if (taps > 0) this.startRun();
      return;
    }

    if (this.state === 'dying') {
      if (!this.exploded && this.stateTime >= DEATH_FREEZE) {
        this.exploded = true;
        this.fx.burst(this.orb.x, this.orb.y, this.orb.polarity === 'red' ? COLORS.red : COLORS.blue);
        this.fx.shake(8, 0.25);
        sound()?.death(this.deathCause);
      }
      if (this.exploded) this.fx.update(dt);
      if (taps > 0 && this.stateTime >= RESTART_LOCK) this.startRun();
      else if (this.stateTime >= AUTO_READY) {
        this.fx.reset();
        this.setState('ready');
      }
      return;
    }

    // playing
    for (let i = 0; i < taps; i++) this.doFlip();
    this.fx.update(dt);
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      this.orb.prevX = this.orb.x;
      this.orb.prevY = this.orb.y;
      return;
    }
    this.runTime += dt;

    const preVx = this.orb.vx;
    const preSpeed = Math.hypot(this.orb.vx, this.orb.vy);
    const ev = step(this.orb, this.world.magnets, this.world.spikes, dt);
    if (ev === 'dead') {
      this.die('spikes');
      return;
    }
    this.stuckTime = this.orb.stuck ? this.stuckTime + dt : 0;
    if (ev === 'bounce') sound()?.bounce(preSpeed / AUDIO.impactFull, this.pan());
    else if (ev === 'wall') sound()?.wall(Math.abs(preVx) / AUDIO.impactFull, this.pan());
    if (ev === 'stick') {
      sound()?.stick(preSpeed / AUDIO.impactFull, this.orb.stuck?.magnet.polarity ?? 'red', this.pan());
      haptic(5);
      this.fx.pulse(this.orb.x, this.orb.y, this.color(), 18, 0.1, 2);
    }

    if (++this.trailTick % 2 === 0) this.fx.pushTrail(this.orb.x, this.orb.y);

    let cam = Math.max(this.camY, this.orb.y - VIEW_H * CAMERA_ANCHOR);
    if (this.runTime > CAMERA_MIN_SPEED_DELAY) cam = Math.max(cam, this.camY + CAMERA_MIN_SPEED * dt);
    this.camY = cam;
    if (this.orb.y + ORB_RADIUS < this.camY) {
      this.die('stall');
      return;
    }
    this.world.update(this.camY);
    this.score = Math.max(this.score, Math.floor(this.orb.y / SCORE_DIVISOR));
    this.scoreSounds();
    this.nearMissCheck();
  }

  private scoreSounds(): void {
    while (this.score >= this.nextMilestone) {
      sound()?.milestone(Math.round(this.nextMilestone / AUDIO.milestoneEvery) - 1);
      this.nextMilestone += AUDIO.milestoneEvery;
    }
    if (!this.passedBest && this.bestAtStart > 0 && this.score > this.bestAtStart) {
      this.passedBest = true;
      sound()?.best();
    }
  }

  private nearestSpikeGap(): number {
    let gap = Infinity;
    for (const row of this.world.spikes) gap = Math.min(gap, spikeGap(row, this.orb.x, this.orb.y));
    return gap;
  }

  /** Arm when the orb skims spikes, fire once it has clearly got away. */
  private nearMissCheck(): void {
    const gap = this.nearestSpikeGap();
    if (gap < AUDIO.nearMissGap) this.nearArmed = true;
    else if (this.nearArmed && gap > AUDIO.nearMissGap * 4) {
      this.nearArmed = false;
      sound()?.nearMiss(this.pan());
    }
  }

  private pan(): number {
    return (this.orb.x / VIEW_W) * 2 - 1;
  }

  /** Levels for the continuous sound layers. Reuses one object, so it allocates nothing per frame. */
  mix(): Readonly<Mix> {
    const m = this.mixOut;
    if (this.state !== 'playing') {
      Object.assign(m, SILENT_MIX);
      return m;
    }
    let pull = 0;
    let push = 0;
    if (!this.orb.stuck) {
      for (const mag of this.world.magnets) {
        const { cx, cy } = closestPoint(mag, this.orb.x, this.orb.y);
        const u = fieldU(mag, Math.hypot(cx - this.orb.x, cy - this.orb.y));
        if (u <= 0) continue;
        if (attracts(this.orb.polarity, mag.polarity)) pull = Math.max(pull, u);
        else push = Math.max(push, u);
      }
    }
    const spike = 1 - Math.max(0, this.nearestSpikeGap()) / AUDIO.spikeDangerRange;
    const stall = 1 - (this.orb.y - this.camY) / AUDIO.stallDangerRange;
    m.attract = pull;
    m.repel = push;
    m.stuck = this.orb.stuck ? 1 : 0;
    m.stuckTime = this.stuckTime;
    m.speed = Math.hypot(this.orb.vx, this.orb.vy) / MAX_SPEED;
    m.danger = Math.max(0, Math.min(1, Math.max(spike, stall)));
    return m;
  }

  private doFlip(): void {
    const launched = flip(this.orb);
    const c = this.color();
    this.fx.pulse(this.orb.x, this.orb.y, c);
    const now = this.runTime;
    this.combo = this.lastFlipAt >= 0 && now - this.lastFlipAt < AUDIO.comboWindow ? Math.min(this.combo + 1, AUDIO.comboMax) : 0;
    this.lastFlipAt = now;
    sound()?.flip(this.orb.polarity, this.combo, this.pan());
    if (launched) {
      this.launchChain = this.lastLaunchAt >= 0 && now - this.lastLaunchAt < AUDIO.launchChainWindow ? Math.min(this.launchChain + 1, AUDIO.launchChainMax) : 0;
      this.lastLaunchAt = now;
      this.launches++;
      this.hitstop = LAUNCH_HITSTOP;
      this.fx.pulse(this.orb.x, this.orb.y, c, 55, 0.25, 4);
      this.fx.shake(6, 0.12);
      sound()?.launch(this.launchChain, this.pan());
      haptic(20);
    } else {
      haptic(8);
    }
  }

  color(): string {
    return this.orb.polarity === 'red' ? COLORS.red : COLORS.blue;
  }
}
