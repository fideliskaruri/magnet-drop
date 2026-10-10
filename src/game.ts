import { haptic, sfx, unlockAudio } from './audio.ts';
import {
  AUTO_READY,
  BEST_KEY,
  BOOST_GRACE,
  BOOST_RELEASE_VY,
  BOOST_SPEED,
  BOOST_TIME,
  CAMERA_ANCHOR,
  CAMERA_MIN_SPEED,
  CAMERA_MIN_SPEED_DELAY,
  COLORS,
  DEATH_FREEZE,
  ORB_RADIUS,
  PHASE_TIME,
  PICKUP_GRACE,
  PICKUP_PULL_RADIUS,
  PICKUP_PULL_SPEED,
  PICKUP_RADIUS,
  POWER_WARN,
  RESTART_LOCK,
  SCORE_DIVISOR,
  SHIELD_BOUNCE,
  SHIELD_CATCH_DROP,
  SHIELD_GRACE,
  SPIKE_FORGIVENESS,
  TERMINAL_FALL,
  VIEW_H,
  VIEW_W,
} from './config.ts';
import { Fx } from './fx.ts';
import { flip, hitsSpikes, step, type StepMods } from './physics.ts';
import type { GameStateName, Orb, PowerKind, SpikeRow } from './types.ts';
import { World } from './world.ts';

const LAUNCH_HITSTOP = 0.035;

export const POWER_LABEL: Record<PowerKind, { name: string; hint: string; color: string }> = {
  boost: { name: 'BOOST', hint: 'Smash through everything', color: COLORS.boost },
  shield: { name: 'SHIELD', hint: 'Saves you once', color: COLORS.shield },
  phase: { name: 'PHASE', hint: 'Spikes cannot touch you', color: COLORS.phase },
};

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
  /** Seconds of booster dive left. */
  boost = 0;
  /** The dive timer ran out but the orb is still inside a pattern; keep diving until a gap. */
  boostHold = false;
  /** Seconds of phasing left. */
  phase = 0;
  shield = false;
  /** Short spike immunity after a shield save or a dive. */
  grace = 0;
  collected = 0;
  saves = 0;
  smashed = 0;
  /** Set by the dev hook to make runs reproducible. */
  seedOverride: number | null = null;
  forcedPatterns: number[] = [];
  private taps = 0;
  private trailTick = 0;
  private warned = { boost: false, phase: false };

  private static freshOrb(): Orb {
    const x = VIEW_W / 2;
    return { x, y: 0, vx: 0, vy: 0, prevX: x, prevY: 0, polarity: 'blue', stuck: null };
  }

  tap(): void {
    unlockAudio();
    this.taps++;
  }

  get boosting(): boolean {
    return this.boost > 0 || this.boostHold;
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
    this.boost = 0;
    this.boostHold = false;
    this.phase = 0;
    this.shield = false;
    this.grace = 0;
    this.collected = 0;
    this.saves = 0;
    this.smashed = 0;
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
    this.boost = 0;
    this.boostHold = false;
    this.phase = 0;
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
    this.tickPowers(dt);

    const boosting = this.boosting;
    if (boosting) {
      this.orb.stuck = null;
      this.orb.vx *= Math.exp(-8 * dt);
      this.orb.vy = BOOST_SPEED;
    }
    const mods: StepMods = {
      ignoreMagnets: boosting,
      spikeProof: boosting || this.phase > 0 || this.grace > 0,
      terminal: boosting ? BOOST_SPEED : TERMINAL_FALL,
    };
    const ev = step(this.orb, this.world.magnets, this.world.spikes, dt, mods);
    if (boosting) this.smashSpikes();
    if (ev === 'dead') {
      if (this.shield) this.shieldFromSpikes();
      else {
        this.die();
        return;
      }
    }
    if (ev === 'stick') {
      sfx.stick();
      haptic(5);
      this.fx.pulse(this.orb.x, this.orb.y, this.color(), 18, 0.1, 2);
    }

    if (++this.trailTick % 2 === 0) this.fx.pushTrail(this.orb.x, this.orb.y);
    this.collectPickups(dt);

    let cam = Math.max(this.camY, this.orb.y - VIEW_H * CAMERA_ANCHOR);
    if (this.runTime > CAMERA_MIN_SPEED_DELAY) cam = Math.max(cam, this.camY + CAMERA_MIN_SPEED * dt);
    this.camY = cam;
    if (this.orb.y + ORB_RADIUS < this.camY) {
      if (this.shield) this.shieldFromCamera();
      else {
        this.die();
        return;
      }
    }
    this.world.update(this.camY);
    this.score = Math.max(this.score, Math.floor(this.orb.y / SCORE_DIVISOR));
  }

  private tickPowers(dt: number): void {
    this.grace = Math.max(0, this.grace - dt);

    if (this.boost > 0) {
      this.boost -= dt;
      if (this.boost <= POWER_WARN && !this.warned.boost) {
        this.warned.boost = true;
        sfx.warn();
      }
      if (this.boost <= 0) {
        this.boost = 0;
        this.boostHold = true;
      }
    }
    if (this.boostHold && this.world.inGap(this.orb.y)) {
      this.boostHold = false;
      this.orb.vx = 0;
      this.orb.vy = BOOST_RELEASE_VY;
      this.grace = Math.max(this.grace, BOOST_GRACE);
      this.fx.pulse(this.orb.x, this.orb.y, COLORS.boost, 40, 0.25, 3);
      sfx.expire();
    }

    if (this.phase > 0) {
      this.phase -= dt;
      if (this.phase <= POWER_WARN && !this.warned.phase) {
        this.warned.phase = true;
        sfx.warn();
      }
      if (this.phase <= 0) {
        // Never turn solid inside a spike row: wait until the orb is clear.
        if (this.touchingSpike(ORB_RADIUS + 4)) this.phase = 1e-3;
        else {
          this.phase = 0;
          this.fx.pulse(this.orb.x, this.orb.y, COLORS.phase, 34, 0.2, 2);
          sfx.expire();
        }
      }
    }
  }

  private touchingSpike(r: number): SpikeRow | null {
    for (const row of this.world.spikes) if (hitsSpikes(row, this.orb.x, this.orb.y, r)) return row;
    return null;
  }

  private smashSpikes(): void {
    let row = this.touchingSpike(ORB_RADIUS + 2);
    while (row) {
      this.world.smash(row);
      this.smashed++;
      this.fx.shards(row.x + row.w / 2, row.y + row.h / 2, row.w, COLORS.spike);
      this.fx.shake(5, 0.1);
      sfx.smash();
      haptic(12);
      row = this.touchingSpike(ORB_RADIUS + 2);
    }
  }

  private shieldFromSpikes(): void {
    const row = this.touchingSpike(ORB_RADIUS - SPIKE_FORGIVENESS);
    const o = this.orb;
    o.x = o.prevX;
    o.y = o.prevY;
    o.stuck = null;
    const dir = row?.dir ?? 'up';
    if (dir === 'up') {
      o.vy = -SHIELD_BOUNCE;
      o.vx *= 0.5;
    } else if (dir === 'down') o.vy = SHIELD_BOUNCE;
    else o.vx = dir === 'left' ? -SHIELD_BOUNCE : SHIELD_BOUNCE;
    this.useShield();
  }

  private shieldFromCamera(): void {
    const o = this.orb;
    o.stuck = null;
    o.y = o.prevY = this.camY + SHIELD_CATCH_DROP;
    o.prevX = o.x;
    o.vy = BOOST_RELEASE_VY;
    this.useShield();
  }

  private useShield(): void {
    this.shield = false;
    this.saves++;
    this.grace = SHIELD_GRACE;
    this.hitstop = 0.06;
    this.fx.shards(this.orb.x, this.orb.y, ORB_RADIUS * 4, COLORS.shield);
    this.fx.pulse(this.orb.x, this.orb.y, COLORS.shield, 70, 0.35, 5);
    this.fx.text('SAVED', '', COLORS.shield, this.orb.x, this.orb.y - this.camY - 44);
    this.fx.shake(7, 0.18);
    this.fx.flash = 0.12;
    sfx.save();
    haptic([20, 30, 20]);
  }

  private collectPickups(dt: number): void {
    const o = this.orb;
    for (const k of this.world.pickups) {
      if (k.taken) continue;
      const dx = o.x - k.x;
      const dy = o.y - k.y;
      const d = Math.hypot(dx, dy);
      if (d < ORB_RADIUS + PICKUP_RADIUS + PICKUP_GRACE) {
        k.taken = true;
        this.activate(k.kind, k.x, k.y);
      } else if (d < PICKUP_PULL_RADIUS) {
        const sp = Math.min(d, PICKUP_PULL_SPEED * dt);
        k.x += (dx / d) * sp;
        k.y += (dy / d) * sp;
      }
    }
  }

  /** Apply a power-up. Also used by the dev hook. */
  activate(kind: PowerKind, x = this.orb.x, y = this.orb.y): void {
    const info = POWER_LABEL[kind];
    this.collected++;
    if (kind === 'boost') {
      this.boost = BOOST_TIME;
      this.boostHold = false;
      this.warned.boost = false;
      this.orb.stuck = null;
      this.fx.shake(6, 0.2);
      sfx.boost();
      haptic(30);
    } else if (kind === 'shield') {
      this.shield = true;
      sfx.shield();
      haptic(15);
    } else {
      this.phase = PHASE_TIME;
      this.warned.phase = false;
      sfx.phase();
      haptic(15);
    }
    this.fx.pulse(x, y, info.color, 60, 0.3, 4);
    this.fx.text(info.name, info.hint, info.color, x, y - this.camY - 44);
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
