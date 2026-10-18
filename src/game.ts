import { track } from './analytics.ts';
import { haptic, SILENT_MIX, sound, unlockAudio, type DeathCause, type Mix } from './audio.ts';
import {
  AUDIO,
  AUTO_READY,
  BEST_KEY,
  CAMERA_ANCHOR,
  CAMERA_MIN_SPEED_DELAY,
  COLORS,
  DEATH_FREEZE,
  JUICE,
  ORB_RADIUS,
  RESTART_LOCK,
  START_POLARITY,
  VIEW_H,
  VIEW_W,
} from './config.ts';
import { Fx } from './fx.ts';
import { cameraPush, type MachineEvent } from './gates.ts';
import { attracts, closestPoint, doorU, fieldU, flip, step, type Hit } from './physics.ts';
import type { GameStateName, GateSpec, Orb, PlacedGate, Saw } from './types.ts';
import { TUNE } from './tune.ts';
import { World, type Pass } from './world.ts';

function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

/** Edge-to-edge gap between the orb and a saw blade. */
function sawGap(s: Saw, x: number, y: number): number {
  return Math.hypot(s.x - x, s.y - y) - s.r - ORB_RADIUS;
}

export class Game {
  state: GameStateName = 'ready';
  orb: Orb = Game.freshOrb();
  world = new World(1);
  fx = new Fx();
  camY = 0;
  prevCamY = 0;
  /** Points: one per gate, plus one per clean centre pass. */
  score = 0;
  /** Gates dropped through this run. */
  cleared = 0;
  /** Clean passes in a row. */
  combo = 0;
  bestCombo = 0;
  cleanPasses = 0;
  best = loadBest();
  stateTime = 0;
  runTime = 0;
  hitstop = 0;
  exploded = false;
  launches = 0;
  kicks = 0;
  /** 0..1, rises with depth, speed and launch chains. Drives visual intensity only. */
  heat = 0;
  /** Dev hook: minimum heat (for screenshots of deep runs). */
  heatFloor = 0;
  chain = 0;
  nearMisses = 0;
  /** Dev hook: fire every effect continuously to measure the frame budget. */
  stress = false;
  deathCause: DeathCause = 'camera';
  /** Gate the orb was trying to clear when it died. */
  deathGate: PlacedGate | null = null;
  /** The saw that killed the orb (drawn hot). */
  deathSaw: Saw | null = null;
  /** Set by the dev hook to make runs reproducible. */
  seedOverride: number | null = null;
  forcedGates: GateSpec[] = [];
  /** The last gate passed, and whether it was clean (for the HUD and checks). */
  lastPass: { index: number; clean: boolean; x: number } | null = null;
  private taps = 0;
  private trailTick = 0;
  private lastLaunchAt = -10;
  private nextMilestone: number = JUICE.milestoneEvery;
  private deathAt = 0;
  private readonly hit: Hit = { magnet: null, solid: null, saw: null };
  private readonly passes: Pass[] = [];
  private readonly machineEvents: { gate: PlacedGate; ev: MachineEvent }[] = [];
  // Sound state: these only drive audio and never touch the simulation.
  private readonly mixOut: Mix = { ...SILENT_MIX };
  private stuckTime = 0;
  private lastFlipAt = -1;
  private flipCombo = 0;
  private lastSoundLaunchAt = -1;
  private launchChain = 0;
  private nextSoundMilestone: number = AUDIO.milestoneEvery;
  private bestAtStart = 0;
  private passedBest = false;
  private nearArmed = false;

  private static freshOrb(): Orb {
    const x = VIEW_W / 2;
    return { x, y: 0, vx: 0, vy: 0, prevX: x, prevY: 0, polarity: START_POLARITY, stuck: null };
  }

  tap(): void {
    unlockAudio();
    this.taps++;
  }

  private startRun(): void {
    if (this.deathAt > 0) track('restart', { msSinceDeath: Date.now() - this.deathAt });
    this.deathAt = 0;
    const seed = this.seedOverride ?? Math.floor(Math.random() * 2 ** 31);
    this.world = new World(seed, this.forcedGates);
    this.orb = Game.freshOrb();
    this.camY = this.prevCamY = this.orb.y - VIEW_H * CAMERA_ANCHOR;
    this.world.update(this.camY);
    this.fx.reset();
    this.score = 0;
    this.cleared = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.cleanPasses = 0;
    this.lastPass = null;
    this.runTime = 0;
    this.hitstop = 0;
    this.launches = 0;
    this.kicks = 0;
    this.exploded = false;
    this.heat = 0;
    this.chain = 0;
    this.nearMisses = 0;
    this.lastLaunchAt = -10;
    this.nextMilestone = JUICE.milestoneEvery;
    this.deathSaw = null;
    this.deathGate = null;
    this.stuckTime = 0;
    this.lastFlipAt = -1;
    this.flipCombo = 0;
    this.lastSoundLaunchAt = -1;
    this.launchChain = 0;
    this.nextSoundMilestone = AUDIO.milestoneEvery;
    this.bestAtStart = this.best;
    this.passedBest = false;
    this.nearArmed = false;
    this.deathCause = 'camera';
    this.setState('playing');
    this.fx.onStart(this.orb.x, this.orb.y, this.color());
    sound()?.start();
    track('run_start', { seed });
  }

  private setState(s: GameStateName): void {
    this.state = s;
    this.stateTime = 0;
  }

  private die(cause: DeathCause, saw: Saw | null): void {
    if (this.state !== 'playing') return;
    this.deathCause = cause;
    this.setState('dying');
    this.orb.stuck = null;
    this.deathSaw = saw;
    // A saw belongs to the gate it guards, even when it sits just under that gate's pass line.
    this.deathGate = (saw && this.world.placed.find((g) => g.saws.includes(saw))) || this.world.next() || null;
    this.deathAt = Date.now();
    this.fx.onDeathHit();
    haptic(cause === 'hazard' ? [30, 40, 30] : 30);
    track('death', {
      cause,
      gate: this.cleared,
      gateType: this.deathGate?.spec.family ?? 'none',
      score: this.score,
      runMs: Math.round(this.runTime * 1000),
    });
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
        sound()?.death(this.deathCause);
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

    const o = this.orb;
    this.world.step(o, this.runTime, dt, this.machineEvents);
    for (const { gate, ev } of this.machineEvents) this.machineSound(gate, ev);

    const preSpeed = Math.hypot(o.vx, o.vy);
    const preVx = o.vx;
    const preVy = o.vy;
    const ev = step(o, this.world, dt, this.hit);
    if (ev === 'dead') {
      this.die('hazard', this.hit.saw);
      return;
    }
    this.stuckTime = o.stuck ? this.stuckTime + dt : 0;
    if (ev === 'bounce') sound()?.bounce(preSpeed / AUDIO.impactFull, this.pan());
    else if (ev === 'wall') sound()?.wall(Math.hypot(o.vx - preVx, o.vy - preVy) / AUDIO.impactFull, this.pan());
    if (ev === 'stick' && o.stuck) {
      sound()?.stick(preSpeed / AUDIO.impactFull, o.stuck.magnet.polarity, this.pan());
      haptic(5);
      this.fx.onStick(o.x, o.y, o.stuck.nx, o.stuck.ny, this.color(), preSpeed, this.heat);
      if (preSpeed > JUICE.stickHitstopSpeed) this.hitstop = JUICE.stickHitstop;
    } else if (ev === 'kick') {
      this.kicks++;
      sound()?.kick(this.pan());
      haptic(12);
      const sp = Math.hypot(o.vx, o.vy) || 1;
      this.fx.onBounce(o.x, o.y, -o.vx / sp, -o.vy / sp, this.color(), 420);
      this.fx.streakTime = 0.2;
      this.fx.streakDx = o.vx / sp;
      this.fx.streakDy = o.vy / sp;
    } else if (ev === 'bounce' || ev === 'wall') {
      // Impact normal from the velocity change.
      const dvx = o.vx - preVx;
      const dvy = o.vy - preVy;
      const dv = Math.hypot(dvx, dvy);
      if (dv > 1) this.fx.onBounce(o.x, o.y, dvx / dv, dvy / dv, ev === 'wall' ? COLORS.steel : this.color(), dv * 0.6);
    }

    if (++this.trailTick % 2 === 0) this.fx.pushTrail(o.x, o.y);
    if (this.fx.streakTime > 0 && this.trailTick % 4 === 0) this.fx.ghost(o.x, o.y, this.color(), 0.22);

    let cam = Math.max(this.camY, o.y - VIEW_H * CAMERA_ANCHOR);
    if (this.runTime > CAMERA_MIN_SPEED_DELAY) cam = Math.max(cam, this.camY + cameraPush(this.cleared) * dt);
    this.camY = cam;
    if (o.y + ORB_RADIUS < this.camY) {
      this.die('camera', null);
      return;
    }
    this.world.update(this.camY);
    this.world.passed(o, this.passes);
    for (const p of this.passes) this.onPass(p);
    if (this.score >= this.nextMilestone) {
      const m = this.nextMilestone;
      this.nextMilestone += JUICE.milestoneEvery;
      this.fx.onMilestone(m, o.x, o.y, this.color(), m % JUICE.bigMilestoneEvery === 0);
    }
    this.scoreSounds();
    this.nearMissCheck();
  }

  /** One point per gate, one more for a clean centre pass. Clean passes in a row build the combo. */
  private onPass(p: Pass): void {
    this.cleared++;
    this.score += 1;
    if (p.clean) {
      this.score += 1;
      this.combo++;
      this.cleanPasses++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      sound()?.clean(this.combo);
    } else {
      this.combo = 0;
      sound()?.gate(this.pan());
    }
    if (p.gate.solids.some((s) => s.kind === 'door')) sound()?.door(this.pan());
    this.lastPass = { index: p.gate.index, clean: p.clean, x: p.x };
    this.fx.onGate(this.orb.x, this.orb.y, this.color(), p.clean, this.combo);
    track('gate_clear', { gate: p.gate.index, type: p.gate.spec.family, clean: p.clean });
  }

  private machineSound(g: PlacedGate, ev: MachineEvent): void {
    // Only gates on screen make noise.
    const b = g.passY;
    if (b < this.camY - 40 || g.top > this.camY + VIEW_H + 40) return;
    const pan = this.pan();
    if (ev === 'iris-open') sound()?.iris(true, pan);
    else if (ev === 'iris-close') sound()?.iris(false, pan);
    else if (ev === 'tick') sound()?.tick(pan);
    else if (ev === 'slab') sound()?.slab(pan);
  }

  private updateHeat(dt: number): void {
    const depth = Math.min(1, this.cleared / JUICE.heatDepth);
    const speed = Math.min(1, Math.hypot(this.orb.vx, this.orb.vy) / 700);
    if (this.runTime - this.lastLaunchAt > JUICE.chainWindow) this.chain = 0;
    const chainH = Math.min(this.chain, 5) / 5;
    const target = Math.max(this.heatFloor, Math.min(1, depth * 0.6 + speed * 0.2 + chainH * 0.3));
    this.heat += (target - this.heat) * Math.min(1, 2 * dt);
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
    this.fx.onGate(x, y, c, true, 3);
    this.fx.onChain(4, x, y, c);
    this.fx.onMilestone(500, x, y, c, true);
    this.fx.onExplode(x, y + 80, c);
    this.fx.slowmo = 0;
    this.fx.zoomHoldTarget = 0;
    for (let i = 0; i < 3; i++) this.fx.ghost(x + i * 8, y, c, 0.22);
  }
  private stressClock = 0;

  private scoreSounds(): void {
    while (this.score >= this.nextSoundMilestone) {
      sound()?.milestone(Math.round(this.nextSoundMilestone / AUDIO.milestoneEvery) - 1);
      this.nextSoundMilestone += AUDIO.milestoneEvery;
    }
    if (!this.passedBest && this.bestAtStart > 0 && this.score > this.bestAtStart) {
      this.passedBest = true;
      sound()?.best();
    }
  }

  private nearestSawGap(): number {
    let gap = Infinity;
    for (const s of this.world.saws) gap = Math.min(gap, sawGap(s, this.orb.x, this.orb.y));
    return gap;
  }

  /** Arm when the orb skims a saw, fire once it has clearly got away. */
  private nearMissCheck(): void {
    const gap = this.nearestSawGap();
    if (gap < AUDIO.nearMissGap) this.nearArmed = true;
    else if (this.nearArmed && gap > AUDIO.nearMissGap * 4) {
      this.nearArmed = false;
      this.nearMisses++;
      const s = this.world.saws.reduce<Saw | null>((a, b) => (!a || sawGap(b, this.orb.x, this.orb.y) < sawGap(a, this.orb.x, this.orb.y) ? b : a), null);
      if (s) this.fx.onNearMiss(this.orb.x, this.orb.y, s.x, s.y);
      sound()?.nearMiss(this.pan());
      haptic(6);
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
    const o = this.orb;
    if (!o.stuck) {
      for (const mag of this.world.magnets) {
        const { cx, cy } = closestPoint(mag, o.x, o.y);
        const u = fieldU(mag, Math.hypot(cx - o.x, cy - o.y));
        if (u <= 0) continue;
        if (attracts(o.polarity, mag.polarity)) pull = Math.max(pull, u);
        else push = Math.max(push, u);
      }
      for (const d of this.world.solids) {
        if (d.kind !== 'door' || d.polarity === null) continue;
        const { u } = doorU(d, o.x, o.y);
        if (u <= 0) continue;
        if (attracts(o.polarity, d.polarity)) pull = Math.max(pull, u * 0.7);
        else push = Math.max(push, u * 0.7);
      }
    }
    const saw = 1 - Math.max(0, this.nearestSawGap()) / AUDIO.sawDangerRange;
    const stall = 1 - (o.y - this.camY) / AUDIO.stallDangerRange;
    m.attract = pull;
    m.repel = push;
    m.stuck = o.stuck ? 1 : 0;
    m.stuckTime = this.stuckTime;
    m.speed = Math.min(1, Math.hypot(o.vx, o.vy) / TUNE.maxSpeed);
    m.danger = Math.max(0, Math.min(1, Math.max(saw, stall)));
    return m;
  }

  private doFlip(): void {
    const launched = flip(this.orb);
    const c = this.color();
    const o = this.orb;
    this.fx.onFlip(o.x, o.y, c, this.heat);
    const now = this.runTime;
    this.flipCombo = this.lastFlipAt >= 0 && now - this.lastFlipAt < AUDIO.comboWindow ? Math.min(this.flipCombo + 1, AUDIO.comboMax) : 0;
    this.lastFlipAt = now;
    sound()?.flip(o.polarity, this.flipCombo, this.pan());
    if (launched) {
      this.launchChain = this.lastSoundLaunchAt >= 0 && now - this.lastSoundLaunchAt < AUDIO.launchChainWindow ? Math.min(this.launchChain + 1, AUDIO.launchChainMax) : 0;
      this.lastSoundLaunchAt = now;
      this.launches++;
      this.chain = this.runTime - this.lastLaunchAt <= JUICE.chainWindow ? this.chain + 1 : 1;
      this.lastLaunchAt = this.runTime;
      this.hitstop = JUICE.launchHitstop;
      this.fx.onLaunch(o.x, o.y, o.vx, o.vy, c, this.heat, this.chain);
      if (this.chain >= 2) this.fx.onChain(this.chain, o.x, o.y, c);
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
