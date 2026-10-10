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

export class Fx {
  trail: { x: number; y: number }[] = [];
  pulses: Pulse[] = [];
  particles: Particle[] = [];
  shakeMag = 0;
  shakeTime = 0;
  flash = 0;

  reset(): void {
    this.trail = [];
    this.pulses = [];
    this.particles = [];
    this.shakeMag = 0;
    this.shakeTime = 0;
    this.flash = 0;
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
