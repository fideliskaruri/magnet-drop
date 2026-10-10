import { haptic, sfx, unlockAudio } from './audio.ts';
import {
  AUTO_READY,
  BEST_KEY,
  CAMERA_ANCHOR,
  CAMERA_MIN_SPEED,
  CAMERA_MIN_SPEED_DELAY,
  COLORS,
  DEATH_FREEZE,
  ORB_RADIUS,
  RESTART_LOCK,
  SCORE_DIVISOR,
  VIEW_H,
  VIEW_W,
} from './config.ts';
import { Fx } from './fx.ts';
import { flip, step } from './physics.ts';
import type { GameStateName, Orb } from './types.ts';
import { World } from './world.ts';

const LAUNCH_HITSTOP = 0.035;

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
  /** Set by the dev hook to make runs reproducible. */
  seedOverride: number | null = null;
  forcedPatterns: number[] = [];
  private taps = 0;
  private trailTick = 0;

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
    this.setState('playing');
  }

  private setState(s: GameStateName): void {
    this.state = s;
    this.stateTime = 0;
  }

  private die(): void {
    if (this.state !== 'playing') return;
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
        // A stall death happens just below the view; burst on the edge so you see where you went.
        const by = Math.min(this.orb.y, this.camY + VIEW_H - ORB_RADIUS);
        this.fx.burst(this.orb.x, by, this.orb.polarity === 'red' ? COLORS.red : COLORS.blue);
        this.fx.shake(8, 0.25);
        sfx.death();
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

    const ev = step(this.orb, this.world.magnets, this.world.spikes, dt);
    if (ev === 'dead') {
      this.die();
      return;
    }
    if (ev === 'stick') {
      sfx.stick();
      haptic(5);
      this.fx.pulse(this.orb.x, this.orb.y, this.color(), 18, 0.1, 2);
    }

    if (++this.trailTick % 2 === 0) this.fx.pushTrail(this.orb.x, this.orb.y);

    // The camera only ever climbs (toward -y). Lag below the view and the rising edge catches you.
    let cam = Math.min(this.camY, this.orb.y - VIEW_H * CAMERA_ANCHOR);
    if (this.runTime > CAMERA_MIN_SPEED_DELAY) cam = Math.min(cam, this.camY - CAMERA_MIN_SPEED * dt);
    this.camY = cam;
    if (this.orb.y - ORB_RADIUS > this.camY + VIEW_H) {
      this.die();
      return;
    }
    this.world.update(this.camY);
    this.score = Math.max(this.score, Math.floor(-this.orb.y / SCORE_DIVISOR));
  }

  private doFlip(): void {
    const launched = flip(this.orb);
    const c = this.color();
    this.fx.pulse(this.orb.x, this.orb.y, c);
    sfx.flip(this.orb.polarity);
    if (launched) {
      this.launches++;
      this.hitstop = LAUNCH_HITSTOP;
      this.fx.pulse(this.orb.x, this.orb.y, c, 55, 0.25, 4);
      this.fx.shake(6, 0.12);
      sfx.launch();
      haptic(20);
    } else {
      haptic(8);
    }
  }

  color(): string {
    return this.orb.polarity === 'red' ? COLORS.red : COLORS.blue;
  }
}
