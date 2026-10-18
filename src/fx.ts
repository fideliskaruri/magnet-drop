import { COLORS, JUICE, TRAIL_LENGTH } from './config.ts';
import { TUNE } from './tune.ts';

// Pooled visual effects. Restrained on purpose: the look is industrial, not a light show.

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

  reduced = false;
  clock = 0;

  trauma = 0;
  kickX = 0;
  kickY = 0;
  camX = 0;
  camY = 0;
  camAngle = 0;

  flash = 0;
  flashColor: string = COLORS.white;
  lastBigFlash = -10;
  readonly flashTimes: number[] = [];

  orbPop = 0;
  squash = 0;
  squashAge = 1;
  squashNx = 0;
  squashNy = -1;
  /** Stretch trail after a strong launch. */
  streakTime = 0;
  streakDx = 0;
  streakDy = 1;
  /** Field pulse ring from a flip (0..1, decays). */
  flipCue = 0;
  dim = 0;
  dimTarget = 0;
  scorePop = 0;

  maxShakePx = 0;
  maxFlashAlpha = 0;

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
    this.particleCount = this.pulseCount = this.popupCount = 0;
    this.trauma = this.kickX = this.kickY = 0;
    this.flash = 0;
    this.orbPop = this.squash = 0;
    this.squashAge = 1;
    this.streakTime = this.flipCue = 0;
    this.dim = this.dimTarget = 0;
    this.scorePop = 0;
  }

  resetStats(): void {
    this.maxShakePx = this.maxFlashAlpha = 0;
    this.flashTimes.length = 0;
  }

  pushTrail(x: number, y: number): void {
    this.trailX[this.trailHead] = x;
    this.trailY[this.trailHead] = y;
    this.trailHead = (this.trailHead + 1) % TRAIL_LENGTH;
    if (this.trailLen < TRAIL_LENGTH) this.trailLen++;
  }

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
    this.pulse(x, y, color, 120, 0.4, 3);
    this.orbPop = 1;
  }

  /** Flip: a quick field pulse from the orb. */
  onFlip(x: number, y: number, color: string): void {
    this.pulse(x, y, color, 40, 0.18, 2);
    this.orbPop = Math.max(this.orbPop, 0.5);
    this.flipCue = 1;
  }

  onStick(x: number, y: number, nx: number, ny: number, color: string, speed: number): void {
    const hard = Math.min(1, speed / 500);
    if (hard < 0.15) return;
    const ta = Math.atan2(nx, -ny);
    const n = 2 + Math.round(hard * 6);
    this.spray(x, y, ta, 0.35, n >> 1, 80, 200 + hard * 150, color, P_SPARK, 0.25, 1.5);
    this.spray(x, y, ta + Math.PI, 0.35, n >> 1, 80, 200 + hard * 150, color, P_SPARK, 0.25, 1.5);
    this.squash = 0.15 + hard * 0.15;
    this.squashAge = 0;
    this.squashNx = nx;
    this.squashNy = ny;
    this.addTrauma(0.04 + hard * 0.08);
  }

  /** Strong surface launch: stretch trail and a camera kick (hit-stop is the game's job). */
  onLaunch(x: number, y: number, vx: number, vy: number, color: string): void {
    const sp = Math.hypot(vx, vy) || 1;
    const dx = vx / sp;
    const dy = vy / sp;
    const back = Math.atan2(-dy, -dx);
    this.pulse(x, y, color, 56, 0.26, 3);
    this.spray(x, y, back, 0.45, 8, 160, 380, color, P_SPARK, 0.3, 1.8);
    this.orbPop = 1;
    this.streakTime = 0.25;
    this.streakDx = dx;
    this.streakDy = dy;
    this.addTrauma(0.18);
    this.kick(dx, dy, 6);
  }

  onBounce(x: number, y: number, nx: number, ny: number, color: string, speed: number): void {
    if (speed < 60) return;
    const s = Math.min(1, speed / 500);
    this.spray(x, y, Math.atan2(ny, nx), 0.9, 3 + Math.round(s * 5), 60, 160 + s * 160, color, P_SPARK, 0.22, 1.4);
    this.addTrauma(0.04 + s * 0.1);
    this.kick(nx, ny, 2 + s * 3);
  }

  /** Gate cleared: a compact score pop. */
  onGate(text: string, x: number, y: number, color: string): void {
    this.scorePop = 1;
    this.popup(text, x, y - 22, color, 14, 0.6);
  }

  onMilestone(x: number, y: number, color: string, big: boolean): void {
    this.scorePop = 1;
    this.pulse(x, y, color, 200, 0.5, 2, 20);
    if (big) this.bigFlash(color, 0.5);
  }

  /** Death: immediate, readable, short. */
  onDeath(x: number, y: number, color: string, hazard: boolean): void {
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU + Math.random() * 0.3;
      const sp = 100 + Math.random() * 240;
      this.particle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.5 + Math.random() * 0.4, i % 3 === 0 ? COLORS.text : color, 2 + Math.random() * 2, P_DOT);
    }
    if (hazard) {
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * TAU;
        const sp = 120 + Math.random() * 200;
        this.particle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.8, '#9aa3b1', 4 + Math.random() * 4, P_SHARD, 2, 260);
      }
    }
    this.pulse(x, y, color, 110, 0.4, 3);
    this.bigFlash(hazard ? COLORS.hazard : COLORS.white, 0.6);
    this.addTrauma(hazard ? 0.5 : 0.3);
    this.dimTarget = 0.35;
  }

  // ---------- Update ----------

  update(dt: number): void {
    this.clock += dt;
    for (let i = 0; i < this.pulseCount; ) {
      const p = this.pulses[i]!;
      if (p.delay > 0) p.delay -= dt;
      else p.age += dt;
      if (p.age >= p.life) swapOut(this.pulses, i, --this.pulseCount);
      else i++;
    }
    for (let i = 0; i < this.particleCount; ) {
      const p = this.particles[i]!;
      p.age += dt;
      if (p.age >= p.life) {
        swapOut(this.particles, i, --this.particleCount);
        continue;
      }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy = p.vy * k + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      i++;
    }
    for (let i = 0; i < this.popupCount; ) {
      const p = this.popups[i]!;
      p.age += dt;
      p.y -= 24 * dt;
      if (p.age >= p.life) swapOut(this.popups, i, --this.popupCount);
      else i++;
    }

    this.trauma = Math.max(0, this.trauma - JUICE.traumaDecay * dt);
    const kd = Math.exp(-14 * dt);
    this.kickX *= kd;
    this.kickY *= kd;
    this.flash = Math.max(0, this.flash - dt * 4);
    this.orbPop = Math.max(0, this.orbPop - dt * 6);
    this.squashAge += dt;
    this.streakTime = Math.max(0, this.streakTime - dt);
    this.flipCue = Math.max(0, this.flipCue - dt * 4);
    this.scorePop = Math.max(0, this.scorePop - dt * 4);
    this.dim += (this.dimTarget - this.dim) * Math.min(1, 8 * dt);

    const m = (this.reduced ? JUICE.reducedShake : 1) * TUNE.juice;
    const s = this.trauma * this.trauma * m;
    this.camX = JUICE.maxShake * s * noise(this.clock, 1.3) + this.kickX;
    this.camY = JUICE.maxShake * s * noise(this.clock, 7.9) + this.kickY;
    this.camAngle = this.reduced ? 0 : JUICE.maxShakeAngle * s * noise(this.clock, 4.4);
    this.maxShakePx = Math.max(this.maxShakePx, Math.hypot(this.camX, this.camY));
  }

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
