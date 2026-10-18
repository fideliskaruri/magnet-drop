import { track } from './analytics.ts';
import { haptic, SILENT_MIX, sound, unlockAudio, type DeathCause, type Mix } from './audio.ts';
import {
  ANCHOR,
  AUDIO,
  AUTO_READY,
  BEST_KEY,
  CENTRE_BAND,
  COLORS,
  FLOOR,
  JUICE,
  ORB_RADIUS,
  RESTART_LOCK,
  SPEED_EASE,
  TIER_SPEED,
  TUTORIAL_GATES,
  VIEW_W,
} from './config.ts';
import { Fx, P_SPARK } from './fx.ts';
import { tierOf, TUTORIAL_HINTS } from './gates.ts';
import { contact, dirOf, flip, freeSpan, makeOrb, step, zoneAt, type Sim } from './physics.ts';
import { TUNE } from './tune.ts';
import type { GameStateName, Gate, GateSpec, Orb, Polarity } from './types.ts';
import { World } from './world.ts';

function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

const colorOf = (p: Polarity): string => (p === 'red' ? COLORS.red : COLORS.blue);

export class Game {
  state: GameStateName = 'ready';
  readonly world = new World();
  sim: Sim = { orb: makeOrb(0, 0, 'blue'), t: 0, camX: 0, speed: 0, gates: this.world.gates };
  readonly fx = new Fx();
  score = 0;
  best = loadBest();
  gatesCleared = 0;
  /** Consecutive gates cleared without touching any machinery. */
  streak = 0;
  bestStreak = 0;
  centres = 0;
  launches = 0;
  knocks = 0;
  flips = 0;
  hitstop = 0;
  /** Camera x before the last step, so the renderer can interpolate it. */
  prevCamX = 0;
  stateTime = 0;
  deathCause: DeathCause = 'camera';
  deathGate: Gate | null = null;
  newBest = false;
  /** Short hint shown for the tutorial gate ahead. */
  hint = 'TAP TO START';
  /** Seconds since the last knock (drives the repel buzz). */
  sinceKnock = 10;
  /** Dev hook: reproducible runs. */
  seedOverride: number | null = null;
  forcedGates: GateSpec[] = [];
  /** Dev hook: fire effects continuously to measure the frame budget. */
  stress = false;
  /** performance.now() of the last death, for the restart analytics. */
  private deathAtMs: number | null = null;
  private runStartMs = 0;
  private combo = 0;
  private lastFlipT = -10;
  private chain = 0;
  private lastLaunchT = -10;
  private bestCued = false;
  private stuckTime = 0;
  private trailTick = 0;

  constructor() {
    this.resetRun();
  }

  get orb(): Orb {
    return this.sim.orb;
  }

  /** Fresh world with the orb resting on the floor rail. */
  resetRun(): void {
    const seed = this.seedOverride ?? Math.floor(Math.random() * 2 ** 31);
    this.world.reset(seed, this.forcedGates);
    const orb = makeOrb(ANCHOR * VIEW_W, FLOOR - ORB_RADIUS, 'blue');
    orb.stuck = { dir: 1, shape: null };
    this.sim = { orb, t: 0, camX: 0, speed: TUNE.baseSpeed, gates: this.world.gates };
    this.fx.reset();
    this.score = this.gatesCleared = this.streak = this.bestStreak = this.centres = 0;
    this.launches = this.knocks = this.flips = 0;
    this.hitstop = 0;
    this.prevCamX = 0;
    this.stateTime = 0;
    this.deathGate = null;
    this.newBest = false;
    this.bestCued = false;
    this.combo = this.chain = 0;
    this.stuckTime = 0;
    this.sinceKnock = 10;
    this.hint = 'TAP TO START';
  }

  tap(): void {
    unlockAudio();
    if (this.state === 'ready') this.start();
    else if (this.state === 'playing') this.doFlip();
    else if (this.state === 'dying' && this.stateTime >= RESTART_LOCK) {
      this.resetRun();
      this.start();
    }
  }

  private start(): void {
    if (this.deathAtMs !== null) {
      track('restart', { msSinceDeath: Math.round(performance.now() - this.deathAtMs) });
      this.deathAtMs = null;
    }
    track('run_start', {});
    this.runStartMs = performance.now();
    this.state = 'playing';
    this.stateTime = 0;
    sound()?.start();
    this.fx.onStart(this.orb.x, this.orb.y, colorOf('red'));
    // The first tap is also the first flip: a launch off the floor.
    this.doFlip();
  }

  private pan(): number {
    return ((this.orb.x - this.sim.camX) / VIEW_W) * 2 - 1;
  }

  private doFlip(): void {
    const o = this.orb;
    const t = this.sim.t;
    this.combo = t - this.lastFlipT < AUDIO.comboWindow ? Math.min(this.combo + 1, AUDIO.comboMax) : 0;
    this.lastFlipT = t;
    this.flips++;
    const launched = flip(this.sim);
    const color = colorOf(o.polarity);
    sound()?.flip(o.polarity, this.combo, this.pan());
    this.fx.onFlip(o.x, o.y, color);
    if (launched) {
      this.chain = t - this.lastLaunchT < AUDIO.launchChainWindow ? Math.min(this.chain + 1, AUDIO.launchChainMax) : 0;
      this.lastLaunchT = t;
      this.launches++;
      this.hitstop = JUICE.launchHitstop;
      this.fx.onLaunch(o.x, o.y, o.vx, o.vy, color);
      sound()?.launch(this.chain, this.pan());
      haptic(20);
    } else {
      haptic(8);
    }
  }

  update(dt: number): void {
    this.fx.update(dt);
    this.stateTime += dt;
    if (this.stress) this.stressFx();
    if (this.state === 'dying') {
      if (this.stateTime >= AUTO_READY) {
        this.resetRun();
        this.state = 'ready';
      }
      return;
    }
    if (this.state !== 'playing') return;
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      return;
    }

    const sim = this.sim;
    const o = sim.orb;
    const target = TUNE.baseSpeed * (TIER_SPEED[tierOf(this.gatesCleared)] ?? 1);
    sim.speed += (target - sim.speed) * (1 - Math.exp(-SPEED_EASE * dt));
    this.prevCamX = sim.camX;
    const ev = step(sim, dt);
    this.world.update(sim.camX);
    this.sinceKnock += dt;
    this.stuckTime = o.stuck ? this.stuckTime + dt : 0;

    if (ev === 'camera' || ev === 'hazard') {
      this.die(ev);
      return;
    }
    const impact = Math.min(1, contact.speed / AUDIO.impactFull);
    if (ev === 'stick') {
      const magnet: Polarity = dirOf(o.polarity) < 0 ? 'blue' : 'red';
      sound()?.stick(impact, magnet, this.pan());
      this.fx.onStick(contact.x, contact.y, contact.nx, contact.ny, colorOf(magnet), contact.speed);
    } else if (ev === 'bump') {
      sound()?.bounce(impact, this.pan());
      this.fx.onBounce(contact.x, contact.y, contact.nx, contact.ny, '#9aa3b1', contact.speed);
    } else if (ev === 'knock') {
      this.knocks++;
      this.sinceKnock = 0;
      sound()?.wall(Math.max(0.4, impact), this.pan());
      this.fx.onBounce(contact.x, contact.y, contact.nx, contact.ny, '#c9d1dc', Math.max(200, contact.speed));
    }

    this.score_(sim);
    this.updateHint();

    if (++this.trailTick % 2 === 0) this.fx.pushTrail(o.x, o.y);
  }

  private score_(sim: Sim): void {
    const o = sim.orb;
    for (const g of sim.gates) {
      if (g.scored) continue;
      if (g.x > o.x + ORB_RADIUS) break;
      if (g.centre === null && o.x >= g.keyX) {
        const span = freeSpan(sim.gates, g.keyX, o.y);
        const half = (span.bottom - span.top) / 2;
        g.centre = Math.abs(o.y - (span.top + span.bottom) / 2) <= CENTRE_BAND * half;
      }
      if (o.x - ORB_RADIUS > g.x + g.width) this.clear(g);
    }
  }

  private clear(g: Gate): void {
    g.scored = true;
    const centre = g.centre === true;
    const clean = !g.touched;
    this.score += centre ? 2 : 1;
    this.gatesCleared++;
    if (centre) this.centres++;
    this.streak = clean ? this.streak + 1 : 0;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    track('gate_clear', { gate: g.index, type: g.spec.family, clean, centre });
    const o = this.orb;
    const pan = this.pan();
    sound()?.gate(pan);
    if (centre) sound()?.centre(pan);
    this.fx.onGate(centre ? '+2 CENTRE' : '+1', o.x, o.y, centre ? COLORS.text : COLORS.dim);
    if (this.gatesCleared % JUICE.milestoneEvery === 0) {
      sound()?.milestone(this.gatesCleared / JUICE.milestoneEvery);
      this.fx.onMilestone(o.x, o.y, colorOf(o.polarity), this.gatesCleared % JUICE.bigMilestoneEvery === 0);
    }
    if (!this.bestCued && this.best > 0 && this.score > this.best) {
      this.bestCued = true;
      sound()?.best();
    }
  }

  private updateHint(): void {
    const g = this.world.upcoming(this.orb.x);
    this.hint = g && g.index < TUTORIAL_GATES ? (TUTORIAL_HINTS[g.index] ?? '') : '';
  }

  private die(cause: DeathCause): void {
    const o = this.orb;
    this.state = 'dying';
    this.stateTime = 0;
    this.deathCause = cause;
    this.deathGate = cause === 'hazard' && contact.gate ? contact.gate : this.world.upcoming(o.x);
    this.deathAtMs = performance.now();
    track('death', {
      cause,
      gate: this.gatesCleared,
      gateType: this.deathGate?.spec.family ?? 'none',
      score: this.score,
      runMs: Math.round(this.deathAtMs - this.runStartMs),
    });
    if (this.score > this.best) {
      this.best = this.score;
      this.newBest = true;
      try {
        localStorage.setItem(BEST_KEY, String(this.best));
      } catch {
        // Storage blocked: best lasts for this session only.
      }
    }
    sound()?.death(cause);
    haptic(cause === 'hazard' ? [30, 40, 30] : 40);
    const x = cause === 'camera' ? Math.max(o.x, this.sim.camX + 8) : o.x;
    this.fx.onDeath(x, o.y, colorOf(o.polarity), cause === 'hazard');
  }

  /** How close the orb is to being pushed off the left edge (0..1). */
  edgeDanger(): number {
    const sx = this.orb.x - this.sim.camX;
    return Math.max(0, Math.min(1, 1 - (sx - ORB_RADIUS) / AUDIO.edgeDangerRange));
  }

  /** How close the orb is to dangerous machinery (0..1). */
  hazardDanger(): number {
    const o = this.orb;
    let best = 0;
    for (const g of this.sim.gates) {
      if (Math.abs(g.x - o.x) > 400) continue;
      for (const s of g.shapes) {
        if (s.kind !== 'grinder') continue;
        const dx = Math.max(s.x - o.x, 0, o.x - (s.x + s.w));
        const dy = Math.max(s.y - o.y, 0, o.y - (s.y + s.h));
        const d = Math.hypot(dx, dy) - ORB_RADIUS;
        best = Math.max(best, 1 - d / AUDIO.hazardDangerRange);
      }
    }
    return Math.max(0, Math.min(1, best));
  }

  /** Levels for the continuous sound layers. */
  mix(): Mix {
    if (this.state !== 'playing') return SILENT_MIX;
    const o = this.orb;
    const zone = zoneAt(this.sim.gates, o.x, o.y);
    return {
      attract: zone === 1 ? 0.15 : 0.35 + 0.5 * Math.min(1, Math.abs(o.vy) / TUNE.maxVy),
      repel: Math.max(0, 1 - this.sinceKnock * 3),
      stuck: o.stuck ? 0.6 : 0,
      stuckTime: this.stuckTime,
      speed: Math.min(1, Math.max(0, (o.vx - 100) / 300)),
      danger: Math.max(this.edgeDanger() * 0.9, this.hazardDanger()),
    };
  }

  private stressFx(): void {
    const o = this.orb;
    const f = this.fx;
    f.spray(o.x, o.y, 0, Math.PI, 12, 100, 400, colorOf(o.polarity), P_SPARK, 0.4, 2);
    f.pulse(o.x, o.y, COLORS.white, 80, 0.3, 3);
    f.popup('+1', o.x, o.y, COLORS.text, 14);
    f.bigFlash(COLORS.white, 1);
    f.addTrauma(0.3);
  }
}
