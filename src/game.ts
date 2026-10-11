import { haptic, sfx, unlockAudio } from './audio.ts';
import {
  AUTO_READY,
  BEST_KEY,
  CAMERA_ANCHOR,
  CAMERA_MIN_SPEED,
  CAMERA_MIN_SPEED_DELAY,
  COLORS,
  DEATH_FREEZE,
  JUICE,
  ORB_RADIUS,
  RESTART_LOCK,
  SCORE_DIVISOR,
  VIEW_H,
  VIEW_W,
} from './config.ts';
import { Fx } from './fx.ts';
import { flip, hitsSpikes, step } from './physics.ts';
import type { GameStateName, Orb, SpikeRow } from './types.ts';
import { World } from './world.ts';

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
  /** 0..1, rises with depth, speed and launch chains. Drives visual intensity only. */
  heat = 0;
  /** Dev hook: minimum heat (for screenshots of deep runs). */
  heatFloor = 0;
  chain = 0;
  nearMisses = 0;
  /** Dev hook: fire every effect continuously to measure the frame budget. */
  stress = false;
  /** Set by the dev hook to make runs reproducible. */
  seedOverride: number | null = null;
  forcedPatterns: number[] = [];
  /** The spike row that killed the orb (rendered white hot). */
  deathRow: SpikeRow | null = null;
  private taps = 0;
  private trailTick = 0;
  private lastLaunchAt = -10;
  private nextMilestone: number = JUICE.milestoneEvery;
  private nearRow: SpikeRow | null = null;
  private nearCooldown = 0;
  private stressClock = 0;

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
    this.heat = 0;
    this.chain = 0;
    this.nearMisses = 0;
    this.lastLaunchAt = -10;
    this.nextMilestone = JUICE.milestoneEvery;
    this.nearRow = null;
    this.nearCooldown = 0;
    this.deathRow = null;
    this.setState('playing');
    this.fx.onStart(this.orb.x, this.orb.y, this.color());
  }

  private setState(s: GameStateName): void {
    this.state = s;
    this.stateTime = 0;
  }

  private die(row: SpikeRow | null): void {
    if (this.state !== 'playing') return;
    this.setState('dying');
    this.orb.stuck = null;
    this.deathRow = row;
    this.fx.onDeathHit();
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
      this.fx.update(dt, 0);
      if (taps > 0) this.startRun();
      return;
    }

    if (this.state === 'dying') {
      if (!this.exploded && this.stateTime >= DEATH_FREEZE) {
        this.exploded = true;
        this.fx.onExplode(this.orb.x, this.orb.y, this.color());
        sfx.death();
      }
      this.fx.update(dt, this.heat);
      if (taps > 0 && this.stateTime >= RESTART_LOCK) this.startRun();
      else if (this.stateTime >= AUTO_READY) {
        this.fx.reset();
        this.setState('ready');
      }
      return;
    }

    // playing
    for (let i = 0; i < taps; i++) this.doFlip();
    this.updateHeat(dt);
    this.fx.update(dt, this.heat);
    if (this.stress) this.stressTick(dt);
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      this.orb.prevX = this.orb.x;
      this.orb.prevY = this.orb.y;
      return;
    }
    this.runTime += dt;

    const preSpeed = Math.hypot(this.orb.vx, this.orb.vy);
    const preVx = this.orb.vx;
    const preVy = this.orb.vy;
    const ev = step(this.orb, this.world.magnets, this.world.spikes, dt);
    if (ev === 'dead') {
      this.die(this.findHitRow());
      return;
    }
    const o = this.orb;
    if (ev === 'stick' && o.stuck) {
      sfx.stick();
      haptic(5);
      this.fx.onStick(o.x, o.y, o.stuck.nx, o.stuck.ny, this.color(), preSpeed, this.heat);
      if (preSpeed > JUICE.stickHitstopSpeed) this.hitstop = JUICE.stickHitstop;
    } else if (ev === 'bounce' || ev === 'wall') {
      // Impact normal from the velocity change.
      const dvx = o.vx - preVx;
      const dvy = o.vy - preVy;
      const dv = Math.hypot(dvx, dvy);
      if (dv > 1) this.fx.onBounce(o.x, o.y, dvx / dv, dvy / dv, ev === 'wall' ? COLORS.text : this.color(), dv * 0.6);
    }
    this.checkNearMiss(dt);

    if (++this.trailTick % 2 === 0) this.fx.pushTrail(o.x, o.y);
    if (this.fx.streakTime > 0 && this.trailTick % 4 === 0) this.fx.ghost(o.x, o.y, this.color(), 0.22);

    let cam = Math.max(this.camY, o.y - VIEW_H * CAMERA_ANCHOR);
    if (this.runTime > CAMERA_MIN_SPEED_DELAY) cam = Math.max(cam, this.camY + CAMERA_MIN_SPEED * dt);
    this.camY = cam;
    if (o.y + ORB_RADIUS < this.camY) {
      this.die(null);
      return;
    }
    this.world.update(this.camY);
    this.score = Math.max(this.score, Math.floor(o.y / SCORE_DIVISOR));
    if (this.score >= this.nextMilestone) {
      const m = this.nextMilestone;
      this.nextMilestone += JUICE.milestoneEvery;
      this.fx.onMilestone(m, o.x, o.y, this.color(), m % JUICE.bigMilestoneEvery === 0);
    }
  }

  private updateHeat(dt: number): void {
    const depth = Math.min(1, this.score / JUICE.heatDepth);
    const speed = Math.min(1, Math.hypot(this.orb.vx, this.orb.vy) / 700);
    if (this.runTime - this.lastLaunchAt > JUICE.chainWindow) this.chain = 0;
    const chainH = Math.min(this.chain, 5) / 5;
    const target = Math.max(this.heatFloor, Math.min(1, depth * 0.6 + speed * 0.2 + chainH * 0.3));
    this.heat += (target - this.heat) * Math.min(1, 2 * dt);
  }

  private findHitRow(): SpikeRow | null {
    for (const row of this.world.spikes) if (hitsSpikes(row, this.orb.x, this.orb.y, ORB_RADIUS)) return row;
    return null;
  }

  /** Grazing a spike row without touching it. Fires once when the orb leaves the danger margin. */
  private checkNearMiss(dt: number): void {
    this.nearCooldown = Math.max(0, this.nearCooldown - dt);
    const o = this.orb;
    let near: SpikeRow | null = null;
    if (!o.stuck) {
      for (const row of this.world.spikes) {
        if (hitsSpikes(row, o.x, o.y, ORB_RADIUS + JUICE.nearMissMargin)) {
          near = row;
          break;
        }
      }
    }
    const left = this.nearRow;
    if (left && near !== left && this.nearCooldown <= 0) {
      const sx = Math.max(left.x, Math.min(o.x, left.x + left.w));
      const sy = Math.max(left.y, Math.min(o.y, left.y + left.h));
      this.nearMisses++;
      this.nearCooldown = JUICE.nearMissCooldown;
      this.fx.onNearMiss(o.x, o.y, sx, sy);
      haptic(6);
    }
    this.nearRow = near;
  }

  private stressTick(dt: number): void {
    this.stressClock += dt;
    if (this.stressClock < 0.1) return;
    this.stressClock = 0;
    const { x, y } = this.orb;
    const c = this.color();
    this.fx.onFlip(x, y, c, this.heat);
    this.fx.onStick(x, y, 0, -1, c, 500, this.heat);
    this.fx.onLaunch(x, y, 300, -500, c, this.heat, 4);
    this.fx.onBounce(x, y, 1, 0, c, 400);
    this.fx.onNearMiss(x, y, x + 20, y);
    this.fx.onChain(4, x, y, c);
    this.fx.onMilestone(500, x, y, c, true);
    this.fx.onExplode(x, y + 80, c);
    this.fx.slowmo = 0;
    this.fx.zoomHoldTarget = 0;
    for (let i = 0; i < 3; i++) this.fx.ghost(x + i * 8, y, c, 0.22);
  }

  private doFlip(): void {
    const launched = flip(this.orb);
    const c = this.color();
    const o = this.orb;
    this.fx.onFlip(o.x, o.y, c, this.heat);
    sfx.flip(o.polarity);
    if (launched) {
      this.launches++;
      this.chain = this.runTime - this.lastLaunchAt <= JUICE.chainWindow ? this.chain + 1 : 1;
      this.lastLaunchAt = this.runTime;
      this.hitstop = JUICE.launchHitstop;
      this.fx.onLaunch(o.x, o.y, o.vx, o.vy, c, this.heat, this.chain);
      if (this.chain >= 2) this.fx.onChain(this.chain, o.x, o.y, c);
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
