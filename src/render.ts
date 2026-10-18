import { CEIL, COLORS, FLOOR, JUICE, ORB_RADIUS, TRAIL_LENGTH, TUTORIAL_GATES, VIEW_H, VIEW_W } from './config.ts';
import { P_DOT, P_SHARD, P_SPARK } from './fx.ts';
import type { Fx } from './fx.ts';
import type { Game } from './game.ts';
import { dualTopPolarity, PEND_HOUSING_OFFSET, PEND_PIVOT, PIN_HINGE } from './gates.ts';
import { dirOf } from './physics.ts';
import { THEME } from './theme.ts';
import { TUNE } from './tune.ts';
import { CAPSULE, CIRCLE, type Gate, type Polarity, type Shape } from './types.ts';

const TAU = Math.PI * 2;
const colorOf = (p: Polarity): string => (p === 'red' ? THEME.red : THEME.blue);

type Canvas = HTMLCanvasElement;

function makeCanvas(w: number, h: number): { c: Canvas; x: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d');
  if (!x) throw new Error('Canvas 2D is not supported in this browser.');
  return { c, x };
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Soft radial glow, drawn additively instead of using shadowBlur every frame. */
function glowSprite(color: string): Canvas {
  const { c, x } = makeCanvas(64, 64);
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, hexA(color, 0.9));
  g.addColorStop(0.25, hexA(color, 0.4));
  g.addColorStop(0.6, hexA(color, 0.08));
  g.addColorStop(1, hexA(color, 0));
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return c;
}

/** Background wall: dark steel plates with seams and rivets. Tiles horizontally. */
const PLATE_W = 160;
const PLATE_H = 90;
function wallSprite(): Canvas {
  const w = PLATE_W * 4;
  const { c, x } = makeCanvas(w, VIEW_H);
  x.fillStyle = THEME.bg;
  x.fillRect(0, 0, w, VIEW_H);
  for (let row = 0; row * PLATE_H < VIEW_H; row++) {
    const off = row % 2 ? PLATE_W / 2 : 0;
    for (let col = -1; col * PLATE_W < w; col++) {
      const px = col * PLATE_W + off;
      const py = row * PLATE_H;
      x.fillStyle = (row + col) % 2 ? THEME.plate : THEME.plateAlt;
      x.fillRect(px + 2, py + 2, PLATE_W - 4, PLATE_H - 4);
      // Faint top-left sheen and bottom-right shade give the plate some thickness.
      x.fillStyle = 'rgba(255,255,255,0.025)';
      x.fillRect(px + 2, py + 2, PLATE_W - 4, 2);
      x.fillStyle = 'rgba(0,0,0,0.25)';
      x.fillRect(px + 2, py + PLATE_H - 4, PLATE_W - 4, 2);
      x.fillStyle = THEME.rivet;
      for (const [rx, ry] of [
        [8, 8],
        [PLATE_W - 8, 8],
        [8, PLATE_H - 8],
        [PLATE_W - 8, PLATE_H - 8],
      ] as const) {
        x.beginPath();
        x.arc(px + rx, py + ry, 1.6, 0, TAU);
        x.fill();
      }
    }
  }
  // Seams are the gaps between plates; darken them a touch more.
  x.globalCompositeOperation = 'destination-over';
  x.fillStyle = THEME.seam;
  x.fillRect(0, 0, w, VIEW_H);
  return c;
}

function vignetteSprite(): Canvas {
  const w = 160;
  const h = 90;
  const { c, x } = makeCanvas(w, h);
  const r = Math.hypot(w / 2, h / 2);
  const g = x.createRadialGradient(w / 2, h / 2, r * 0.5, w / 2, h / 2, r);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${THEME.vignette})`);
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  return c;
}

function hatchPattern(ctx: CanvasRenderingContext2D, color: string, alpha: number): CanvasPattern | null {
  const { c, x } = makeCanvas(12, 12);
  x.strokeStyle = hexA(color, alpha);
  x.lineWidth = 1.2;
  x.beginPath();
  x.moveTo(-3, 15);
  x.lineTo(15, -3);
  x.moveTo(-3, 3);
  x.lineTo(3, -3);
  x.moveTo(9, 15);
  x.lineTo(15, 9);
  x.stroke();
  return ctx.createPattern(c, 'repeat');
}

/** The orb's metal shell: radial gradient #d9dee6 → #5b626d. */
function orbSprite(): Canvas {
  const { c, x } = makeCanvas(64, 64);
  const s = 64 / (ORB_RADIUS * 2);
  x.scale(s, s);
  const r = ORB_RADIUS;
  const g = x.createRadialGradient(r - 4, r - 4, 1, r, r, r);
  g.addColorStop(0, THEME.orbHi);
  g.addColorStop(1, THEME.orbLo);
  x.fillStyle = g;
  x.beginPath();
  x.arc(r, r, r, 0, TAU);
  x.fill();
  x.strokeStyle = 'rgba(0,0,0,0.45)';
  x.lineWidth = 0.8;
  x.stroke();
  return c;
}

const RAIL_SEG = 80;

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private dpr = 1;
  private readonly glow = new Map<string, Canvas>();
  private readonly wall: Canvas;
  private readonly vignette: Canvas;
  private readonly orbShell: Canvas;
  private readonly neutralHatch: CanvasPattern | null;
  private readonly hazardHatch: CanvasPattern | null;
  private readonly fieldX: Float32Array;
  private readonly fieldY: Float32Array;
  private readonly fieldS: Float32Array;
  private lastTime = 0;
  /** Eases toward the field direction so the reverse on a flip reads as a sweep, not a jump. */
  private fieldFlow = 1;
  private hintSeen = '';
  private hintAge = 0;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not supported in this browser.');
    this.canvas = canvas;
    this.ctx = ctx;
    for (const c of [THEME.red, THEME.blue, COLORS.white, THEME.hazard]) this.glow.set(c, glowSprite(c));
    this.wall = wallSprite();
    this.vignette = vignetteSprite();
    this.orbShell = orbSprite();
    this.neutralHatch = hatchPattern(ctx, THEME.neutral, 0.22);
    this.hazardHatch = hatchPattern(ctx, THEME.hazard, 0.55);
    const n = JUICE.fieldParticles;
    this.fieldX = new Float32Array(n);
    this.fieldY = new Float32Array(n);
    this.fieldS = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.fieldX[i] = Math.random() * VIEW_W;
      this.fieldY[i] = CEIL + Math.random() * (FLOOR - CEIL);
      this.fieldS[i] = 0.4 + Math.random() * 0.6;
    }
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.scale = Math.min(w / VIEW_W, h / VIEW_H);
    this.ox = (w - VIEW_W * this.scale) / 2;
    this.oy = (h - VIEW_H * this.scale) / 2;
    document.body.classList.toggle('portrait', h > w);
  }

  render(g: Game, alpha: number, time: number): void {
    const { ctx } = this;
    const fx = g.fx;
    const dt = Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#050608';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const s = this.scale * this.dpr;
    ctx.setTransform(s, 0, 0, s, this.ox * this.dpr, this.oy * this.dpr);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, VIEW_W, VIEW_H);
    ctx.clip();

    const playing = g.state === 'playing';
    const o = g.orb;
    const camX = playing ? g.prevCamX + (g.sim.camX - g.prevCamX) * alpha : g.sim.camX;
    const ox = playing ? o.prevX + (o.x - o.prevX) * alpha : o.x;
    const oy = playing ? o.prevY + (o.y - o.prevY) * alpha : o.y;
    const pol = o.polarity;

    this.background(camX);
    this.field(dt, pol, playing ? g.sim.speed : 40, g.state === 'dying');

    ctx.save();
    ctx.translate(fx.camX, fx.camY);
    if (fx.camAngle) {
      ctx.translate(VIEW_W / 2, VIEW_H / 2);
      ctx.rotate(fx.camAngle);
      ctx.translate(-VIEW_W / 2, -VIEW_H / 2);
    }
    ctx.translate(-camX, 0);

    const left = camX - 60;
    const right = camX + VIEW_W + 60;
    for (const gate of g.world.gates) {
      if (gate.x + gate.width < left || gate.x > right) continue;
      this.gate(gate, g, time);
    }
    this.rails(camX, pol, time);
    if (TUNE.showZones) this.debugZones(g, left, right);

    if (fx.dim > 0.01) {
      ctx.globalAlpha = fx.dim * 0.6;
      ctx.fillStyle = '#000000';
      ctx.fillRect(camX - 40, -40, VIEW_W + 80, VIEW_H + 80);
      ctx.globalAlpha = 1;
    }
    this.trail(fx, pol);
    this.effects(fx);
    const dead = g.state === 'dying' && g.deathCause === 'hazard';
    if (!dead) this.orb(ox, oy, pol, fx, o.vx, o.vy, time, g.state !== 'ready');
    this.popups(fx);
    ctx.restore();

    this.edgeDanger(g);
    ctx.drawImage(this.vignette, 0, 0, VIEW_W, VIEW_H);
    const fa = fx.flashAlpha();
    if (fa > 0.004) {
      ctx.globalAlpha = fa;
      ctx.fillStyle = fx.flashColor;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.globalAlpha = 1;
    }
    this.hud(g, dt, time);
    ctx.restore();
  }

  // ---------- World ----------

  private background(camX: number): void {
    const { ctx } = this;
    const w = this.wall.width;
    const off = -((camX * 0.35) % w);
    ctx.drawImage(this.wall, off, 0);
    ctx.drawImage(this.wall, off + w, 0);
  }

  /** Subtle particles drifting in the pull direction. They reverse when the polarity flips. */
  private field(dt: number, pol: Polarity, speed: number, frozen: boolean): void {
    const { ctx } = this;
    const dir = dirOf(pol);
    this.fieldFlow += (dir - this.fieldFlow) * Math.min(1, dt * 10);
    const n = this.fieldX.length;
    const vy = frozen ? 0 : this.fieldFlow * 70;
    const vx = frozen ? 0 : -speed * 0.35;
    // Field lines in the pull colour: red pulls toward the blue ceiling and the reverse.
    ctx.fillStyle = hexA(dir < 0 ? THEME.blue : THEME.red, 0.35);
    for (let i = 0; i < n; i++) {
      const k = this.fieldS[i]!;
      let x = this.fieldX[i]! + vx * k * dt;
      let y = this.fieldY[i]! + vy * k * dt;
      if (x < 0) x += VIEW_W;
      if (y < CEIL) y += FLOOR - CEIL;
      if (y > FLOOR) y -= FLOOR - CEIL;
      this.fieldX[i] = x;
      this.fieldY[i] = y;
      const len = 3 + 5 * k;
      ctx.globalAlpha = 0.25 + 0.5 * k;
      ctx.fillRect(x, this.fieldFlow > 0 ? y - len : y, 1, len);
    }
    ctx.globalAlpha = 1;
  }

  /** The big ceiling and floor magnet rails. The ceiling core is blue (pulls red up), the floor red. */
  private rails(camX: number, pol: Polarity, time: number): void {
    const { ctx } = this;
    const up = pol === 'red';
    this.rail(camX, 0, CEIL, THEME.blue, up ? 1 : 0.35, time, true);
    this.rail(camX, FLOOR, VIEW_H - FLOOR, THEME.red, up ? 0.35 : 1, time, false);
    ctx.globalAlpha = 1;
  }

  private rail(camX: number, y: number, h: number, core: string, level: number, time: number, top: boolean): void {
    const { ctx } = this;
    const x0 = Math.floor((camX - 80) / RAIL_SEG) * RAIL_SEG;
    const x1 = camX + VIEW_W + 80;
    ctx.fillStyle = THEME.housing;
    ctx.fillRect(x0, y, x1 - x0, h);
    // Segment housings with bevels and rivets.
    for (let x = x0; x < x1; x += RAIL_SEG) {
      ctx.fillStyle = THEME.bevel;
      ctx.fillRect(x, y, 2, h);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x + RAIL_SEG - 2, y, 2, h);
      ctx.fillStyle = THEME.rivet;
      ctx.fillRect(x + 10, y + h / 2 - 1, 2, 2);
      ctx.fillRect(x + RAIL_SEG - 12, y + h / 2 - 1, 2, 2);
    }
    // Outer edge bevel.
    ctx.fillStyle = THEME.bevel;
    ctx.fillRect(x0, top ? y + h - 4 : y, x1 - x0, 1);
    // Glowing core strip along the inner face.
    const cy = top ? y + h - 3 : y + 1;
    const flicker = 0.92 + 0.08 * Math.sin(time * 9);
    ctx.globalAlpha = (0.35 + 0.65 * level) * flicker;
    ctx.fillStyle = core;
    ctx.fillRect(x0, cy, x1 - x0, 2);
    if (level > 0.5) {
      const grad = ctx.createLinearGradient(0, top ? y + h : y, 0, top ? y + h + 22 : y - 22);
      grad.addColorStop(0, hexA(core, 0.22 * level));
      grad.addColorStop(1, hexA(core, 0));
      ctx.fillStyle = grad;
      ctx.fillRect(x0, top ? y + h : y - 22, x1 - x0, 22);
    }
    ctx.globalAlpha = 1;
  }

  private gate(gate: Gate, g: Game, time: number): void {
    const { ctx } = this;
    for (const z of gate.zones) {
      if (z.kind === 'neutral') {
        ctx.fillStyle = hexA(THEME.neutral, 0.06);
        ctx.fillRect(z.x, z.y, z.w, z.h);
        if (this.neutralHatch) {
          ctx.fillStyle = this.neutralHatch;
          ctx.fillRect(z.x, z.y, z.w, z.h);
        }
        ctx.fillStyle = hexA(THEME.neutral, 0.7);
        ctx.font = '600 8px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('NEUTRAL', z.x + z.w / 2, z.y + z.h / 2);
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(z.x, z.y, z.w, z.h);
      }
    }
    if (gate.spec.family === 'dual') this.dualLanes(gate, g.sim.t);
    if (gate.spec.family === 'pendulum') this.pendulumHousing(gate, g.orb.polarity, gate.spec.v[0] === 1);
    if (gate.spec.family === 'pinball') this.pinballHinges(gate);
    for (const s of gate.shapes) this.shape(s, gate, g, time);
  }

  private dualLanes(gate: Gate, t: number): void {
    const { ctx } = this;
    const block = gate.shapes[0];
    if (!block) return;
    const top = dualTopPolarity(gate.spec, t);
    const bottom: Polarity = top === 'red' ? 'blue' : 'red';
    ctx.fillStyle = hexA(colorOf(top), 0.07);
    ctx.fillRect(gate.x, CEIL, gate.width, block.y - CEIL);
    ctx.fillStyle = hexA(colorOf(bottom), 0.07);
    ctx.fillRect(gate.x, block.y + block.h, gate.width, FLOOR - block.y - block.h);
  }

  private pendulumHousing(gate: Gate, pol: Polarity, mirror: boolean): void {
    // Two side magnets show which side the mass will swing toward.
    const { ctx } = this;
    const px = gate.x + PEND_PIVOT;
    const active = (pol === 'blue') !== mirror ? 1 : -1;
    for (const side of [-1, 1]) {
      const x = px + side * PEND_HOUSING_OFFSET - 14;
      const on = side === active;
      ctx.fillStyle = THEME.housing;
      ctx.fillRect(x, CEIL, 28, 26);
      ctx.strokeStyle = THEME.bevel;
      ctx.strokeRect(x + 0.5, CEIL + 0.5, 27, 25);
      ctx.globalAlpha = on ? 1 : 0.25;
      ctx.fillStyle = colorOf(pol === 'red' ? 'blue' : 'red');
      ctx.fillRect(x + 6, CEIL + 18, 16, 3);
      ctx.globalAlpha = 1;
    }
  }

  private pinballHinges(gate: Gate): void {
    const { ctx } = this;
    const x = gate.x + PIN_HINGE;
    ctx.fillStyle = '#000000';
    ctx.fillRect(x - 190, CEIL - 6, 190, 6);
    ctx.fillRect(x - 190, FLOOR, 190, 6);
  }

  private shape(s: Shape, gate: Gate, g: Game, time: number): void {
    const { ctx } = this;
    switch (s.kind) {
      case 'iron':
        this.housing(s.x, s.y, s.w, s.h);
        // Magnetic faces glow faintly in neutral iron grey.
        ctx.fillStyle = hexA(THEME.dim, 0.5);
        if (s.y > CEIL + 1) ctx.fillRect(s.x + 3, s.y + 1, s.w - 6, 1);
        if (s.y + s.h < FLOOR - 1) ctx.fillRect(s.x + 3, s.y + s.h - 2, s.w - 6, 1);
        break;
      case 'plate':
        ctx.fillStyle = '#3b424d';
        ctx.fillRect(s.x, s.y, s.w, s.h);
        ctx.fillStyle = THEME.bevel;
        ctx.fillRect(s.x, s.y, s.w, 1);
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(s.x, s.y + s.h - 1, s.w, 1);
        break;
      case 'tunnel': {
        this.housing(s.x, s.y, s.w, s.h);
        const topWall = s.y <= CEIL + 1;
        // Inner face: the top wall's core is blue (holds red), the bottom wall's red (holds blue).
        const core = topWall ? THEME.blue : THEME.red;
        const fy = topWall ? s.y + s.h - 3 : s.y + 1;
        const active = (g.orb.polarity === 'red') === topWall;
        ctx.globalAlpha = active ? 0.95 : 0.35;
        ctx.fillStyle = core;
        for (let x = s.x + 6; x < s.x + s.w - 14; x += 24) ctx.fillRect(x, fy, 16, 2);
        ctx.globalAlpha = 1;
        break;
      }
      case 'lock': {
        if (!s.pol) break;
        const c = colorOf(s.pol);
        if (s.on) {
          const pulse = 0.6 + 0.25 * Math.sin(time * 10);
          ctx.globalAlpha = pulse;
          ctx.fillStyle = c;
          ctx.fillRect(s.x, s.y, 3, s.h);
          ctx.globalAlpha = 0.18;
          ctx.fillRect(s.x + 3, s.y, s.w, s.h);
          ctx.globalAlpha = 1;
        } else {
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = c;
          for (let y = s.y; y < s.y + s.h; y += 8) ctx.fillRect(s.x, y, 2, 4);
          ctx.globalAlpha = 1;
        }
        // Lane emitter on the rail edge.
        const top = s.y <= CEIL + 1;
        ctx.fillStyle = THEME.housing;
        ctx.fillRect(s.x - 6, top ? CEIL : FLOOR - 8, 16, 8);
        ctx.fillStyle = c;
        ctx.fillRect(s.x - 3, top ? CEIL + 3 : FLOOR - 5, 10, 2);
        break;
      }
      case 'door': {
        if (s.h < 0.5) break;
        this.housing(s.x, s.y, s.w, s.h);
        const c = s.pol ? colorOf(s.pol) : THEME.dim;
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = c;
        ctx.fillRect(s.x + s.w / 2 - 2, s.y + 3, 4, Math.max(0, s.h - 6));
        ctx.globalAlpha = 1;
        break;
      }
      case 'paddle': {
        ctx.lineCap = 'round';
        ctx.strokeStyle = THEME.bevel;
        ctx.lineWidth = s.r * 2;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();
        ctx.strokeStyle = THEME.housing;
        ctx.lineWidth = s.r * 2 - 3;
        ctx.stroke();
        if (s.pol) {
          ctx.strokeStyle = colorOf(s.pol);
          ctx.globalAlpha = 0.85;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.lineCap = 'butt';
        ctx.fillStyle = THEME.rivet;
        ctx.beginPath();
        ctx.arc(s.x, s.y + (s.y < CEIL ? 8 : -8), 5, 0, TAU);
        ctx.fill();
        break;
      }
      case 'rod':
        ctx.strokeStyle = '#4a515c';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();
        ctx.fillStyle = THEME.bevel;
        ctx.fillRect(s.x - 10, CEIL - 2, 20, 8);
        break;
      case 'mass': {
        const grad = ctx.createRadialGradient(s.x - 8, s.y - 8, 2, s.x, s.y, s.r);
        grad.addColorStop(0, '#5a626e');
        grad.addColorStop(1, '#1d2128');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = THEME.bevel;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = THEME.rivet;
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * TAU + 0.6;
          ctx.fillRect(s.x + Math.cos(a) * s.r * 0.6 - 1, s.y + Math.sin(a) * s.r * 0.6 - 1, 2, 2);
        }
        break;
      }
      case 'grinder': {
        ctx.fillStyle = '#1a1612';
        ctx.fillRect(s.x, s.y, s.w, s.h);
        if (this.hazardHatch) {
          ctx.fillStyle = this.hazardHatch;
          ctx.fillRect(s.x, s.y, s.w, s.h);
        }
        // Spinning teeth on the exposed edge.
        const top = s.y <= CEIL + 1;
        const ey = top ? s.y + s.h : s.y;
        ctx.fillStyle = THEME.hazard;
        const phase = (time * 60) % 10;
        ctx.beginPath();
        for (let x = s.x - 10 + phase; x < s.x + s.w; x += 10) {
          const a = Math.max(s.x, x);
          const b = Math.min(s.x + s.w, x + 10);
          if (b <= a) continue;
          ctx.moveTo(a, ey);
          ctx.lineTo((a + b) / 2, ey + (top ? 6 : -6));
          ctx.lineTo(b, ey);
        }
        ctx.fill();
        const glow = this.glow.get(THEME.hazard);
        if (glow) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.25 + 0.1 * Math.sin(time * 12);
          ctx.drawImage(glow, s.x - 10, ey - 30, s.w + 20, 60);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        }
        break;
      }
    }
    void gate;
  }

  /** An iron housing: #2a2f38 body, #3a414c bevel, rivets. */
  private housing(x: number, y: number, w: number, h: number): void {
    const { ctx } = this;
    if (w <= 0 || h <= 0) return;
    ctx.fillStyle = THEME.housing;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = THEME.bevel;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x + w - 3, y + 1, 2, h - 2);
    if (w >= 20 && h >= 20) {
      ctx.fillStyle = THEME.rivet;
      ctx.fillRect(x + 4, y + 4, 2, 2);
      ctx.fillRect(x + w - 7, y + 4, 2, 2);
      ctx.fillRect(x + 4, y + h - 7, 2, 2);
      ctx.fillRect(x + w - 7, y + h - 7, 2, 2);
    }
  }

  private debugZones(g: Game, left: number, right: number): void {
    const { ctx } = this;
    ctx.lineWidth = 1;
    for (const gate of g.world.gates) {
      if (gate.x + gate.width < left || gate.x > right) continue;
      ctx.strokeStyle = 'rgba(255,255,0,0.6)';
      ctx.beginPath();
      ctx.moveTo(gate.keyX, CEIL);
      ctx.lineTo(gate.keyX, FLOOR);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,255,120,0.5)';
      for (const s of gate.shapes) {
        if (!s.on) continue;
        if (s.type === CAPSULE) {
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(s.x2, s.y2);
          ctx.stroke();
        } else if (s.type === CIRCLE) {
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, TAU);
          ctx.stroke();
        } else ctx.strokeRect(s.x, s.y, s.w, s.h);
      }
      ctx.fillStyle = 'rgba(255,255,0,0.8)';
      ctx.font = '9px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`#${gate.index} ${gate.spec.family} [${gate.spec.v.join(',')}]`, gate.x, CEIL + 10);
    }
  }

  // ---------- Orb and effects ----------

  private trail(fx: Fx, pol: Polarity): void {
    const { ctx } = this;
    const n = fx.trailLen;
    if (n < 2) return;
    const c = colorOf(pol);
    ctx.lineCap = 'round';
    let prevX = 0;
    let prevY = 0;
    for (let i = 0; i < n; i++) {
      const idx = (fx.trailHead - n + i + TRAIL_LENGTH * 2) % TRAIL_LENGTH;
      const x = fx.trailX[idx]!;
      const y = fx.trailY[idx]!;
      if (i > 0) {
        const k = i / n;
        ctx.globalAlpha = 0.28 * k;
        ctx.strokeStyle = c;
        ctx.lineWidth = 1 + ORB_RADIUS * 0.9 * k;
        ctx.beginPath();
        ctx.moveTo(prevX, prevY);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      prevX = x;
      prevY = y;
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
  }

  private effects(fx: Fx): void {
    const { ctx } = this;
    for (let i = 0; i < fx.pulseCount; i++) {
      const p = fx.pulses[i]!;
      if (p.delay > 0) continue;
      const k = p.age / p.life;
      const r = p.r0 + (p.r1 - p.r0) * (1 - (1 - k) * (1 - k));
      ctx.globalAlpha = (1 - k) * 0.55;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.width * (1 - k * 0.6);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.stroke();
    }
    for (let i = 0; i < fx.particleCount; i++) {
      const p = fx.particles[i]!;
      const k = 1 - p.age / p.life;
      ctx.globalAlpha = k;
      ctx.fillStyle = p.color;
      if (p.kind === P_DOT) ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      else if (p.kind === P_SPARK) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size * 0.6;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02);
        ctx.stroke();
      } else if (p.kind === P_SHARD) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  private orb(x: number, y: number, pol: Polarity, fx: Fx, vx: number, vy: number, time: number, live: boolean): void {
    const { ctx } = this;
    const c = colorOf(pol);
    const r = ORB_RADIUS * (1 + fx.orbPop * 0.18);
    // Stretch along the motion after a strong launch, squash on impact.
    ctx.save();
    ctx.translate(x, y);
    if (fx.streakTime > 0 && !fx.reduced) {
      const a = Math.atan2(fx.streakDy, fx.streakDx);
      const k = (fx.streakTime / 0.25) * 0.28 * TUNE.juice;
      ctx.rotate(a);
      ctx.scale(1 + k, 1 - k * 0.5);
      ctx.rotate(-a);
    } else if (fx.squashAge < 0.15 && !fx.reduced) {
      const a = Math.atan2(fx.squashNy, fx.squashNx);
      const k = fx.squash * (1 - fx.squashAge / 0.15) * 0.2 * TUNE.juice;
      ctx.rotate(a);
      ctx.scale(1 - k, 1 + k * 0.6);
      ctx.rotate(-a);
    }
    const glow = this.glow.get(c);
    if (glow) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.45 + 0.4 * fx.flipCue;
      ctx.drawImage(glow, -r * 2.6, -r * 2.6, r * 5.2, r * 5.2);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(this.orbShell, -r, -r, r * 2, r * 2);
    // Glowing core in the current polarity colour.
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.42, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.arc(-r * 0.12, -r * 0.12, r * 0.13, 0, TAU);
    ctx.fill();
    ctx.restore();
    if (!live) return;
    // Pull chevron: which way the field is pulling right now.
    const d = dirOf(pol);
    const bob = Math.sin(time * 8) * 1.5;
    const cy = y + d * (r + 8 + bob);
    ctx.strokeStyle = hexA(c, 0.8);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 5, cy - d * 3);
    ctx.lineTo(x, cy + d * 2);
    ctx.lineTo(x + 5, cy - d * 3);
    ctx.stroke();
    void vx;
    void vy;
  }

  private popups(fx: Fx): void {
    const { ctx } = this;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < fx.popupCount; i++) {
      const p = fx.popups[i]!;
      const k = p.age / p.life;
      ctx.globalAlpha = 1 - k * k;
      ctx.font = `700 ${Math.round(p.size * (1 + 0.25 * Math.max(0, 1 - k * 6)))}px system-ui, sans-serif`;
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y - 22);
    }
    ctx.globalAlpha = 1;
  }

  /** Warning glow on the left edge when the orb is about to be pushed off. */
  private edgeDanger(g: Game): void {
    if (g.state !== 'playing') return;
    const d = g.edgeDanger();
    if (d < 0.02) return;
    const { ctx } = this;
    const grad = ctx.createLinearGradient(0, 0, 70, 0);
    grad.addColorStop(0, hexA(THEME.hazard, 0.45 * d));
    grad.addColorStop(1, hexA(THEME.hazard, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, CEIL, 70, FLOOR - CEIL);
    ctx.fillStyle = hexA(THEME.hazard, 0.8 * d);
    ctx.fillRect(0, CEIL, 2, FLOOR - CEIL);
  }

  // ---------- HUD ----------

  private hud(g: Game, dt: number, time: number): void {
    const { ctx } = this;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (g.state === 'ready') {
      ctx.fillStyle = 'rgba(11,13,16,0.55)';
      ctx.fillRect(0, CEIL, VIEW_W, FLOOR - CEIL);
      ctx.fillStyle = THEME.text;
      ctx.font = '800 40px system-ui, sans-serif';
      ctx.fillText('MAGNET DROP', VIEW_W / 2, 120);
      ctx.fillStyle = THEME.dim;
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillText('PROTOTYPE B · RUNNER', VIEW_W / 2, 152);
      ctx.fillStyle = THEME.text;
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(time * 4);
      ctx.font = '700 16px system-ui, sans-serif';
      ctx.fillText('TAP TO START', VIEW_W / 2, 210);
      ctx.globalAlpha = 1;
      ctx.fillStyle = THEME.dim;
      ctx.font = '500 11px system-ui, sans-serif';
      ctx.fillText('Tap flips polarity:  red pulls up,  blue pulls down', VIEW_W / 2, 240);
      if (g.best > 0) ctx.fillText(`BEST ${g.best}`, VIEW_W / 2, 270);
      return;
    }
    // Score.
    const pop = 1 + g.fx.scorePop * 0.25;
    ctx.fillStyle = THEME.text;
    ctx.font = `800 ${Math.round(26 * pop)}px system-ui, sans-serif`;
    ctx.fillText(String(g.score), VIEW_W / 2, CEIL + 22);
    ctx.font = '600 9px system-ui, sans-serif';
    ctx.fillStyle = THEME.dim;
    ctx.textAlign = 'left';
    ctx.fillText(`BEST ${Math.max(g.best, g.score)}`, 10, CEIL + 12);
    if (g.streak >= 2) ctx.fillText(`CLEAN ×${g.streak}`, 10, CEIL + 24);
    ctx.textAlign = 'center';

    // Tutorial hint, fading in when it changes.
    if (g.state === 'playing' && g.hint) {
      if (g.hint !== this.hintSeen) {
        this.hintSeen = g.hint;
        this.hintAge = 0;
      }
      this.hintAge += dt;
      ctx.globalAlpha = Math.min(1, this.hintAge * 3) * 0.9;
      ctx.fillStyle = THEME.text;
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillText(g.hint, VIEW_W / 2, FLOOR - 16);
      ctx.globalAlpha = 1;
    }

    if (g.state === 'dying') {
      const k = Math.min(1, g.stateTime * 5);
      ctx.globalAlpha = k;
      ctx.fillStyle = 'rgba(11,13,16,0.6)';
      ctx.fillRect(0, 120, VIEW_W, 120);
      ctx.fillStyle = g.deathCause === 'hazard' ? THEME.hazard : THEME.text;
      ctx.font = '800 22px system-ui, sans-serif';
      ctx.fillText(g.deathCause === 'hazard' ? 'CAUGHT IN THE MACHINE' : 'PUSHED OFF', VIEW_W / 2, 150);
      ctx.fillStyle = THEME.text;
      ctx.font = '700 15px system-ui, sans-serif';
      ctx.fillText(g.newBest ? `NEW BEST  ${g.score}` : `SCORE ${g.score}   BEST ${g.best}`, VIEW_W / 2, 182);
      ctx.fillStyle = THEME.dim;
      ctx.font = '600 12px system-ui, sans-serif';
      if (g.stateTime > 0.3) ctx.fillText('TAP TO RETRY', VIEW_W / 2, 212);
      ctx.globalAlpha = 1;
    }
    void TUTORIAL_GATES;
  }
}
