import { COLORS, TRAIL_LENGTH } from './config.ts';

interface Pulse {
  x: number;
  y: number;
  age: number;
  life: number;
  maxR: number;
  color: string;
  width: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  color: string;
  size: number;
}

export interface FloatText {
  text: string;
  sub: string;
  color: string;
  x: number;
  y: number;
  age: number;
  life: number;
}

export class Fx {
  trail: { x: number; y: number }[] = [];
  pulses: Pulse[] = [];
  particles: Particle[] = [];
  texts: FloatText[] = [];
  shakeMag = 0;
  shakeTime = 0;
  flash = 0;

  reset(): void {
    this.trail = [];
    this.pulses = [];
    this.particles = [];
    this.texts = [];
    this.shakeMag = 0;
    this.shakeTime = 0;
    this.flash = 0;
  }

  /** A label that floats up from a point on screen (screen coordinates, kept below the score and badges). */
  text(text: string, sub: string, color: string, x: number, y: number): void {
    this.texts = this.texts.filter((t) => t.age > 0.4);
    this.texts.push({ text, sub, color, x: Math.max(80, Math.min(280, x)), y: Math.max(150, Math.min(560, y)), age: 0, life: 1.3 });
  }

  /** Fragments flung out across a width, for smashed spikes and a popped shield. */
  shards(x: number, y: number, width: number, color: string): void {
    const n = Math.max(8, Math.min(22, Math.round(width / 8)));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 80 + Math.random() * 220;
      this.particles.push({
        x: x + (Math.random() - 0.5) * width,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 60,
        age: 0,
        life: 0.4 + Math.random() * 0.35,
        color,
        size: 1.5 + Math.random() * 2,
      });
    }
  }

  pushTrail(x: number, y: number): void {
    this.trail.push({ x, y });
    if (this.trail.length > TRAIL_LENGTH) this.trail.shift();
  }

  pulse(x: number, y: number, color: string, maxR = 30, life = 0.12, width = 3): void {
    this.pulses.push({ x, y, age: 0, life, maxR, color, width });
  }

  shake(mag: number, time: number): void {
    this.shakeMag = Math.max(this.shakeMag, mag);
    this.shakeTime = Math.max(this.shakeTime, time);
  }

  burst(x: number, y: number, color: string): void {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 + Math.random() * 0.3;
      const sp = 120 + Math.random() * 260;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        age: 0,
        life: 0.5 + Math.random() * 0.4,
        color: i % 3 === 0 ? COLORS.text : color,
        size: 2 + Math.random() * 2.5,
      });
    }
    this.pulse(x, y, color, 70, 0.35, 4);
    this.flash = 0.18;
  }

  update(dt: number): void {
    for (const p of this.pulses) p.age += dt;
    this.pulses = this.pulses.filter((p) => p.age < p.life);
    for (const p of this.particles) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.exp(-3 * dt);
      p.vy *= Math.exp(-3 * dt);
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
    for (const t of this.texts) {
      t.age += dt;
      t.y -= 40 * dt;
    }
    this.texts = this.texts.filter((t) => t.age < t.life);
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      if (this.shakeTime <= 0) this.shakeMag = 0;
    }
    this.flash = Math.max(0, this.flash - dt);
  }

  shakeOffset(): { x: number; y: number } {
    if (this.shakeMag <= 0) return { x: 0, y: 0 };
    return { x: (Math.random() * 2 - 1) * this.shakeMag, y: (Math.random() * 2 - 1) * this.shakeMag };
  }
}
