import { COLORS, JUICE, TRAIL_LENGTH } from './config.ts';
import { TUNE } from './tune.ts';

export const P_DOT = 0;
export const P_SPARK = 1;
export const P_SHARD = 2;

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  color: string;
  size: number;
  kind: number;
  rot: number;
  spin: number;
  drag: number;
  gravity: number;
}

export interface Pulse {
  x: number;
  y: number;
  age: number;
  life: number;
  r0: number;
  r1: number;
  color: string;
  width: number;
  /** Delay before the ring starts (for staggered shockwaves). */
  delay: number;
}

export interface Popup {
  text: string;
  x: number;
  y: number;
  age: number;
  life: number;
  color: string;
  size: number;
}

export interface Ghost {
  x: number;
  y: number;
  age: number;
  life: number;
  color: string;
}

function pool<T>(n: number, make: () => T): T[] {
  const a: T[] = [];
  for (let i = 0; i < n; i++) a.push(make());
  return a;
}

const TAU = Math.PI * 2;

function noise(t: number, seed: number): number {
  return Math.sin(t * 37 + seed) * 0.6 + Math.sin(t * 59 + seed * 2.3) * 0.3 + Math.sin(t * 91 + seed * 4.1) * 0.1;
}

function reducedMotionQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && 'matchMedia' in window ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
}

export class Fx {
  // Trail ring buffer.
  readonly trailX = new Float32Array(TRAIL_LENGTH);
  readonly trailY = new Float32Array(TRAIL_LENGTH);
  trailHead = 0;
  trailLen = 0;

  readonly particles: Particle[] = pool(JUICE.particleCap, () => ({
    x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1, color: COLORS.text as string, size: 1, kind: P_DOT, rot: 0, spin: 0, drag: 3, gravity: 0,
  }));
  particleCount = 0;
  readonly pulses: Pulse[] = pool(JUICE.pulseCap, () => ({ x: 0, y: 0, age: 0, life: 1, r0: 0, r1: 1, color: COLORS.text as string, width: 1, delay: 0 }));
  pulseCount = 0;
  readonly popups: Popup[] = pool(JUICE.popupCap, () => ({ text: '', x: 0, y: 0, age: 0, life: 1, color: COLORS.text as string, size: 14 }));
  popupCount = 0;
  readonly ghosts: Ghost[] = pool(JUICE.ghostCap, () => ({ x: 0, y: 0, age: 0, life: 1, color: COLORS.text as string }));
  ghostCount = 0;

  reduced = false;
  /** Real seconds since boot (drives shake noise and the flash limiter). */
  clock = 0;
  /** Slow-motion factor for debris after a death. */
  fxTimeScale = 1;
  slowmo = 0;

  // Camera.
  trauma = 0;
  kickX = 0;
  kickY = 0;
  zoomPunch = 0;
  zoomHold = 0;
  zoomHoldTarget = 0;
  camX = 0;
  camY = 0;
  camAngle = 0;
  camZoom = 1;

  // Screen flash.
  flash = 0;
  flashColor: string = COLORS.text;
  lastBigFlash = -10;
  readonly flashTimes: number[] = [];

  // Orb feedback.
  orbPop = 0;
  orbWhite = 0;
  squash = 0;
  squashAge = 1;
  squashNx = 0;
  squashNy = -1;
  splitTime = 0;
  splitDx = 0;
  splitDy = 0;
  streakTime = 0;
  streakDx = 0;
  streakDy = 1;
  flipCue = 0;
  dim = 0;
  dimTarget = 0;

  // HUD and background.
  scorePop = 0;
  milestoneText = '';
  milestoneAge = 10;
  beatPhase = 0;
  beat = 0;
  heat = 0;
  deathRowFlash = 0;

  // Measurements for the dev hook.
  maxShakePx = 0;
  maxFlashAlpha = 0;
  maxZoomDev = 0;

  constructor() {
    const q = reducedMotionQuery();
    if (q) {
      this.reduced = q.matches;
      q.addEventListener('change', (e) => {
        this.reduced = e.matches;
      });
    }
  }

  reset(): void {
    this.trailHead = this.trailLen = 0;
    this.particleCount = this.pulseCount = this.popupCount = this.ghostCount = 0;
    this.trauma = this.kickX = this.kickY = this.zoomPunch = this.zoomHold = this.zoomHoldTarget = 0;
    this.flash = 0;
    this.orbPop = this.orbWhite = this.squash = 0;
    this.squashAge = 1;
    this.splitTime = this.streakTime = this.flipCue = 0;
    this.dim = this.dimTarget = 0;
    this.slowmo = 0;
    this.fxTimeScale = 1;
    this.deathRowFlash = 0;
    this.milestoneAge = 10;
    this.scorePop = 0;
  }

  resetStats(): void {
    this.maxShakePx = this.maxFlashAlpha = this.maxZoomDev = 0;
    this.flashTimes.length = 0;
  }

  pushTrail(x: number, y: number): void {
    this.trailX[this.trailHead] = x;
    this.trailY[this.trailHead] = y;
    this.trailHead = (this.trailHead + 1) % TRAIL_LENGTH;
    if (this.trailLen < TRAIL_LENGTH) this.trailLen++;
  }

  // ---------- Primitives ----------

  addTrauma(t: number): void {
    this.trauma = Math.min(1, this.trauma + t);
  }

  kick(dx: number, dy: number, px: number): void {
    if (this.reduced) return;
    this.kickX += dx * px * TUNE.juice;
    this.kickY += dy * px * TUNE.juice;
  }

  pulse(x: number, y: number, color: string, r1: number, life: number, width: number, r0 = 11, delay = 0): void {
    if (this.pulseCount >= this.pulses.length) return;
    const p = this.pulses[this.pulseCount++]!;
    p.x = x;
    p.y = y;
    p.age = 0;
    p.life = life;
    p.r0 = r0;
    p.r1 = r1;
    p.color = color;
    p.width = width;
    p.delay = delay;
  }

  particle(x: number, y: number, vx: number, vy: number, life: number, color: string, size: number, kind: number, drag = 3, gravity = 0): void {
    if (this.particleCount >= this.particles.length) return;
    const p = this.particles[this.particleCount++]!;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.age = 0;
    p.life = life;
    p.color = color;
    p.size = size;
    p.kind = kind;
    p.rot = Math.random() * TAU;
    p.spin = (Math.random() * 2 - 1) * 14;
    p.drag = drag;
    p.gravity = gravity;
  }

  /** `n` particles in a cone around angle `a` (`spread` radians either side). */
  spray(x: number, y: number, a: number, spread: number, n: number, sp0: number, sp1: number, color: string, kind: number, life = 0.4, size = 2): void {
    for (let i = 0; i < n; i++) {
      const ang = a + (Math.random() * 2 - 1) * spread;
      const sp = sp0 + Math.random() * (sp1 - sp0);
      this.particle(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, life * (0.6 + Math.random() * 0.6), color, size * (0.6 + Math.random() * 0.8), kind);
    }
  }

  popup(text: string, x: number, y: number, color: string, size: number, life = 0.7): void {
    if (this.popupCount >= this.popups.length) return;
    const p = this.popups[this.popupCount++]!;
    p.text = text;
    p.x = x;
    p.y = y;
    p.age = 0;
    p.life = life;
    p.color = color;
    p.size = size;
  }

  ghost(x: number, y: number, color: string, life: number): void {
    if (this.ghostCount >= this.ghosts.length) return;
    const g = this.ghosts[this.ghostCount++]!;
    g.x = x;
    g.y = y;
    g.age = 0;
    g.life = life;
    g.color = color;
  }

  /** Full-screen flash. Rate limited so there are never more than 3 per second. */
  bigFlash(color: string, strength: number): boolean {
    if (this.clock - this.lastBigFlash < JUICE.flashMinGap) return false;
    this.lastBigFlash = this.clock;
    this.flashTimes.push(this.clock);
    if (this.flashTimes.length > 64) this.flashTimes.shift();
    this.flash = Math.max(this.flash, strength);
    this.flashColor = color;
    return true;
  }

  // ---------- Game events ----------

  onStart(x: number, y: number, color: string): void {
    this.pulse(x, y, color, 260, 0.5, 6);
    this.pulse(x, y, COLORS.text, 140, 0.35, 3, 11, 0.06);
    if (!this.reduced) this.zoomPunch = 0.04;
    this.orbPop = 1;
    this.popup('GO', x, y + 46, COLORS.text, 26, 0.6);
  }

  onFlip(x: number, y: number, color: string, heat: number): void {
    this.pulse(x, y, color, 24 + heat * 6, 0.14, 2);
    this.spray(x, y, 0, Math.PI, 3 + Math.round(heat * 3), 60, 160, color, P_SPARK, 0.2, 1.4);
    this.orbPop = Math.max(this.orbPop, 0.45);
    this.flipCue = 1;
    this.addTrauma(0.03);
  }

  onStick(x: number, y: number, nx: number, ny: number, color: string, speed: number, heat: number): void {
    const hard = Math.min(1, speed / 500);
    this.pulse(x - nx * 11, y - ny * 11, color, 30 + hard * 26, 0.2, 3 + hard * 2);
    // Sparks skid both ways along the surface.
    const ta = Math.atan2(nx, -ny);
    const n = 4 + Math.round(hard * 6 + heat * 3);
    const sp1 = 320 + hard * 200;
    this.spray(x - nx * 9, y - ny * 9, ta, 0.35, n >> 1, 120, sp1, color, P_SPARK, 0.3, 1.8);
    this.spray(x - nx * 9, y - ny * 9, ta + Math.PI, 0.35, n >> 1, 120, sp1, color, P_SPARK, 0.3, 1.8);
    this.squash = 0.28 + hard * 0.22;
    this.squashAge = 0;
    this.squashNx = nx;
    this.squashNy = ny;
    this.orbWhite = 0.05;
    this.addTrauma(0.04 + hard * 0.1);
    this.kick(-nx, -ny, 2 + hard * 3);
  }

  onLaunch(x: number, y: number, vx: number, vy: number, color: string, heat: number, chain: number): void {
    const sp = Math.hypot(vx, vy) || 1;
    const dx = vx / sp;
    const dy = vy / sp;
    const back = Math.atan2(-dy, -dx);
    this.pulse(x, y, color, 70 + heat * 30, 0.3, 6);
    this.pulse(x, y, COLORS.text, 46 + heat * 20, 0.22, 3, 11, 0.05);
    this.pulse(x, y, color, 110 + heat * 40, 0.42, 2, 20, 0.1);
    this.spray(x, y, back, 0.5, 10 + Math.round(heat * 6), 200, 480, color, P_SPARK, 0.3, 2);
    this.spray(x, y, back, 1.2, 8, 60, 200, COLORS.text, P_DOT, 0.35, 2.4);
    this.orbWhite = 0.045;
    this.orbPop = 1;
    this.splitTime = 0.22;
    this.splitDx = -dy;
    this.splitDy = dx;
    this.streakTime = 0.3;
    this.streakDx = dx;
    this.streakDy = dy;
    this.addTrauma(0.2 + Math.min(chain, 5) * 0.02);
    this.kick(dx, dy, 5 + heat * 3);
    if (!this.reduced) this.zoomPunch = -0.02;
  }

  onBounce(x: number, y: number, nx: number, ny: number, color: string, speed: number): void {
    if (speed < 60) return;
    const s = Math.min(1, speed / 500);
    this.spray(x - nx * 10, y - ny * 10, Math.atan2(ny, nx), 0.9, 4 + Math.round(s * 8), 60, 200 + s * 200, color, P_SPARK, 0.25, 1.6);
    this.pulse(x - nx * 10, y - ny * 10, color, 18 + s * 14, 0.14, 2, 4);
    this.addTrauma(0.03 + s * 0.07);
    this.kick(-nx, -ny, 1 + s * 3);
  }

  onNearMiss(x: number, y: number, sx: number, sy: number): void {
    const a = Math.atan2(y - sy, x - sx);
    this.spray(sx, sy, a, 0.8, 10, 120, 320, COLORS.hazard, P_SPARK, 0.3, 1.8);
    this.popup('CLOSE', x, y - 26, COLORS.hazard, 16, 0.6);
    this.addTrauma(0.14);
    this.orbPop = Math.max(this.orbPop, 0.5);
  }

  onGate(x: number, y: number, color: string, clean: boolean, combo: number): void {
    this.scorePop = Math.max(this.scorePop, clean ? 0.8 : 0.5);
    if (clean) {
      this.pulse(x, y, color, 40, 0.25, 2);
      this.popup(combo > 1 ? `CLEAN x${combo}` : 'CLEAN +1', x, y - 30, COLORS.text, 14 + Math.min(combo, 6), 0.7);
    }
  }

  onChain(chain: number, x: number, y: number, color: string): void {
    this.popup(`x${chain}`, x, y - 30, color, 16 + Math.min(chain, 6) * 3, 0.7);
  }

  onMilestone(score: number, x: number, y: number, color: string, big: boolean): void {
    this.scorePop = 1;
    this.milestoneText = score.toLocaleString('en-US');
    this.milestoneAge = 0;
    this.pulse(x, y, color, 420, 0.7, 4, 20);
    this.spray(x, y, 0, Math.PI, 18, 150, 380, COLORS.text, P_DOT, 0.5, 2.2);
    this.addTrauma(big ? 0.2 : 0.1);
    if (big) this.bigFlash(color, 0.5);
  }

  onDeathHit(): void {
    this.orbWhite = 0.08;
    this.dimTarget = 0.4;
    this.deathRowFlash = 0.5;
  }

  onExplode(x: number, y: number, color: string): void {
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * TAU + Math.random() * 0.3;
      const sp = 140 + Math.random() * 340;
      this.particle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.6 + Math.random() * 0.5, i % 3 === 0 ? COLORS.text : color, 2 + Math.random() * 2.5, P_DOT);
    }
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * TAU;
      const sp = 160 + Math.random() * 280;
      this.particle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.9 + Math.random() * 0.5, i % 2 ? color : '#c7d0e6', 5 + Math.random() * 6, P_SHARD, 2, 260);
    }
    this.spray(x, y, 0, Math.PI, 30, 300, 700, color, P_SPARK, 0.45, 2.6);
    this.pulse(x, y, COLORS.text, 90, 0.3, 8);
    this.pulse(x, y, color, 170, 0.6, 5, 11, 0.06);
    this.pulse(x, y, color, 300, 0.9, 2, 30, 0.14);
    this.bigFlash(COLORS.text, 0.6);
    this.addTrauma(0.55);
    if (!this.reduced) this.zoomHoldTarget = 0.04;
    this.slowmo = 0.35;
  }

  // ---------- Update ----------

  update(dt: number, heat: number): void {
    this.clock += dt;
    this.heat = heat;
    this.slowmo = Math.max(0, this.slowmo - dt);
    this.fxTimeScale = this.slowmo > 0 ? 0.4 + 0.6 * (1 - this.slowmo / 0.35) : 1;
    const fdt = dt * this.fxTimeScale;

    for (let i = 0; i < this.pulseCount; ) {
      const p = this.pulses[i]!;
      if (p.delay > 0) p.delay -= fdt;
      else p.age += fdt;
      if (p.age >= p.life) swapOut(this.pulses, i, --this.pulseCount);
      else i++;
    }
    for (let i = 0; i < this.particleCount; ) {
      const p = this.particles[i]!;
      p.age += fdt;
      if (p.age >= p.life) {
        swapOut(this.particles, i, --this.particleCount);
        continue;
      }
      const k = Math.exp(-p.drag * fdt);
      p.vx *= k;
      p.vy = p.vy * k + p.gravity * fdt;
      p.x += p.vx * fdt;
      p.y += p.vy * fdt;
      p.rot += p.spin * fdt;
      i++;
    }
    for (let i = 0; i < this.popupCount; ) {
      const p = this.popups[i]!;
      p.age += dt;
      p.y -= 30 * dt;
      if (p.age >= p.life) swapOut(this.popups, i, --this.popupCount);
      else i++;
    }
    for (let i = 0; i < this.ghostCount; ) {
      const g = this.ghosts[i]!;
      g.age += fdt;
      if (g.age >= g.life) swapOut(this.ghosts, i, --this.ghostCount);
      else i++;
    }

    this.trauma = Math.max(0, this.trauma - JUICE.traumaDecay * dt);
    const kd = Math.exp(-14 * dt);
    this.kickX *= kd;
    this.kickY *= kd;
    this.zoomPunch *= Math.exp(-9 * dt);
    this.zoomHold += (this.zoomHoldTarget - this.zoomHold) * Math.min(1, 6 * dt);
    this.flash = Math.max(0, this.flash - dt * 3.2);
    this.orbPop = Math.max(0, this.orbPop - dt * 6);
    this.orbWhite = Math.max(0, this.orbWhite - dt);
    this.squashAge += dt;
    this.splitTime = Math.max(0, this.splitTime - dt);
    this.streakTime = Math.max(0, this.streakTime - dt);
    this.flipCue = Math.max(0, this.flipCue - dt * 3);
    this.scorePop = Math.max(0, this.scorePop - dt * 3);
    this.milestoneAge += dt;
    this.deathRowFlash = Math.max(0, this.deathRowFlash - dt);
    this.dim += (this.dimTarget - this.dim) * Math.min(1, 8 * dt);

    const bpm = JUICE.bpmMin + (JUICE.bpmMax - JUICE.bpmMin) * heat;
    this.beatPhase = (this.beatPhase + (dt * bpm) / 60) % 1;
    this.beat = this.reduced ? 0 : Math.exp(-7 * this.beatPhase);

    // Trauma shake: amplitude is trauma squared, driven by smooth noise.
    const m = (this.reduced ? JUICE.reducedShake : 1) * TUNE.juice;
    const s = this.trauma * this.trauma * m;
    this.camX = JUICE.maxShake * s * noise(this.clock, 1.3) + this.kickX;
    this.camY = JUICE.maxShake * s * noise(this.clock, 7.9) + this.kickY;
    this.camAngle = this.reduced ? 0 : JUICE.maxShakeAngle * s * noise(this.clock, 4.4);
    this.camZoom = 1 + (this.zoomPunch + this.zoomHold) * TUNE.juice;
    this.maxShakePx = Math.max(this.maxShakePx, Math.hypot(this.camX, this.camY));
    this.maxZoomDev = Math.max(this.maxZoomDev, Math.abs(this.camZoom - 1));
  }

  /** Overlay alpha for the current flash, already scaled for reduced motion. */
  flashAlpha(): number {
    const a = Math.min(1, Math.min(1, this.flash) * JUICE.flashMaxAlpha * TUNE.juice * (this.reduced ? JUICE.reducedFlash : 1));
    if (a > this.maxFlashAlpha) this.maxFlashAlpha = a;
    return a;
  }
}

function swapOut<T>(arr: T[], i: number, last: number): void {
  const tmp = arr[i]!;
  arr[i] = arr[last]!;
  arr[last] = tmp;
}
