import { COLORS, JUICE, ORB_RADIUS, RAIL_FIELD, TRAIL_LENGTH, VIEW_H, VIEW_W } from './config.ts';
import { P_DOT, P_SHARD, P_SPARK } from './fx.ts';
import type { Fx } from './fx.ts';
import type { Game } from './game.ts';
import { attracts, closestPoint, fieldU, spikeTriangles } from './physics.ts';
import type { Magnet, Polarity, SpikeRow } from './types.ts';

const TAU = Math.PI * 2;
const colorOf = (p: Polarity): string => (p === 'red' ? COLORS.red : COLORS.blue);
const otherColor = (p: Polarity): string => (p === 'red' ? COLORS.blue : COLORS.red);

type Canvas = HTMLCanvasElement;

function makeCanvas(w: number, h: number): { c: Canvas; x: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d');
  if (!x) throw new Error('Canvas 2D is not supported in this browser.');
  return { c, x };
}

/** Soft radial glow, drawn additively instead of using shadowBlur every frame. */
function glowSprite(color: string): Canvas {
  const { c, x } = makeCanvas(128, 128);
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, hexA(color, 1));
  g.addColorStop(0.2, hexA(color, 0.55));
  g.addColorStop(0.5, hexA(color, 0.16));
  g.addColorStop(1, hexA(color, 0));
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  return c;
}

/** Screen-sized radial edge tint, pre-rendered small and stretched. */
function edgeSprite(color: string, alpha: number, inner: number): Canvas {
  const w = 90;
  const h = 160;
  const { c, x } = makeCanvas(w, h);
  const r = Math.hypot(w / 2, h / 2);
  const g = x.createRadialGradient(w / 2, h / 2, r * inner, w / 2, h / 2, r);
  g.addColorStop(0, hexA(color, 0));
  g.addColorStop(1, hexA(color, alpha));
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  return c;
}

function dangerSprite(): Canvas {
  const { c, x } = makeCanvas(4, 64);
  const g = x.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, hexA(COLORS.spike, 0.85));
  g.addColorStop(0.35, hexA('#ff7a1a', 0.35));
  g.addColorStop(1, hexA('#ff7a1a', 0));
  x.fillStyle = g;
  x.fillRect(0, 0, 4, 64);
  return c;
}

/** The orb's metal shell, without its colour core. */
function orbBodySprite(): Canvas {
  const { c, x } = makeCanvas(64, 64);
  const s = 64 / (ORB_RADIUS * 2);
  x.scale(s, s);
  const r = ORB_RADIUS;
  const g = x.createRadialGradient(r - 4, r - 4, 1, r, r, r);
  g.addColorStop(0, '#b4bdd2');
  g.addColorStop(0.5, '#3a4256');
  g.addColorStop(1, '#141824');
  x.fillStyle = g;
  x.beginPath();
  x.arc(r, r, r, 0, TAU);
  x.fill();
  return c;
}

function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const BG_COLD = rgbOf(COLORS.bg);
const BG_HOT = rgbOf(COLORS.bgHot);
const STREAKS = 26;
const RAIL_HALO = [RAIL_FIELD * 2, RAIL_FIELD * 1.2, RAIL_FIELD * 0.6];

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private dpr = 1;
  private readonly glow = new Map<string, Canvas>();
  private readonly edge = new Map<string, Canvas>();
  private readonly vignette: Canvas;
  private readonly danger: Canvas;
  private readonly orbBody: Canvas;
  private readonly spikePaths = new WeakMap<SpikeRow, Path2D>();
  private readonly streakX = new Float32Array(STREAKS);
  private readonly streakD = new Float32Array(STREAKS);
  private readonly streakP = new Float32Array(STREAKS);

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not supported in this browser.');
    this.canvas = canvas;
    this.ctx = ctx;
    for (const c of [COLORS.red, COLORS.blue, COLORS.white, COLORS.spike]) this.glow.set(c, glowSprite(c));
    this.edge.set(COLORS.red, edgeSprite(COLORS.red, 0.9, 0.45));
    this.edge.set(COLORS.blue, edgeSprite(COLORS.blue, 0.9, 0.45));
    this.vignette = edgeSprite('#000000', 0.85, 0.35);
    this.danger = dangerSprite();
    this.orbBody = orbBodySprite();
    for (let i = 0; i < STREAKS; i++) {
      this.streakX[i] = 8 + Math.random() * (VIEW_W - 16);
      this.streakD[i] = 0.3 + Math.random() * 0.7;
      this.streakP[i] = Math.random();
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
  }

  render(g: Game, alpha: number, time: number): void {
    const { ctx } = this;
    const fx = g.fx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#03050c';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const s = this.scale * this.dpr;
    ctx.setTransform(s, 0, 0, s, this.ox * this.dpr, this.oy * this.dpr);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, VIEW_W, VIEW_H);
    ctx.clip();

    const playing = g.state === 'playing';
    const camY = playing ? g.prevCamY + (g.camY - g.prevCamY) * alpha : g.camY;
    const ox = playing ? g.orb.prevX + (g.orb.x - g.orb.prevX) * alpha : g.orb.x;
    const oy = playing ? g.orb.prevY + (g.orb.y - g.orb.prevY) * alpha : g.orb.y;
    const heat = g.state === 'ready' ? 0 : g.heat;

    this.background(g, camY, heat);

    if (g.state !== 'ready') {
      // Camera: shake, kick, small rotation and zoom, all centred on the orb.
      const sx = ox;
      const sy = oy - camY;
      ctx.save();
      ctx.translate(sx + fx.camX, sy + fx.camY);
      ctx.rotate(fx.camAngle);
      ctx.scale(fx.camZoom, fx.camZoom);
      ctx.translate(-sx, -sy - camY);

      const top = camY - 80;
      const bottom = camY + VIEW_H + 80;
      for (const m of g.world.magnets) if (magnetVisible(m, top, bottom)) this.magnetHalo(m, fx);
      this.walls(camY);
      for (const row of g.world.spikes) if (row.y + row.h > top && row.y < bottom) this.spikes(row, g, ox, oy, fx);
      for (const m of g.world.magnets) if (magnetVisible(m, top, bottom)) this.magnet(m, g, ox, oy, time);
      if (playing) {
        this.fieldHints(g, ox, oy, time);
        this.tether(g, ox, oy, time);
      }
      if (fx.dim > 0.01) {
        ctx.globalAlpha = fx.dim;
        ctx.fillStyle = '#02030a';
        ctx.fillRect(-200, camY - 200, VIEW_W + 400, VIEW_H + 400);
        ctx.globalAlpha = 1;
      }
      this.trail(g, heat);
      this.ghosts(fx);
      // Pulses and particles go under the orb so it always stays visible.
      this.effects(fx);
      if (!(g.state === 'dying' && g.exploded)) {
        this.speedLines(fx, ox, oy, colorOf(g.orb.polarity));
        const blink = g.grace > 0 && Math.floor(time * 16) % 2 === 0;
        if (!blink) this.orb(ox, oy, g.orb.polarity, g.orb.stuck !== null, time, fx, g.orb.vx, g.orb.vy, heat);
        if (g.state === 'playing' && g.shield) this.shieldRing(ox, oy, time);
      }
      this.popups(fx);
      ctx.restore();
    }

    this.overlays(g, oy - camY, heat, time);
    ctx.restore();

    if (g.state === 'ready') this.menu(g, time);
    else this.hud(g, heat);
  }

  private background(g: Game, camY: number, heat: number): void {
    const { ctx } = this;
    const fx = g.fx;
    const r = Math.round(BG_COLD[0] + (BG_HOT[0] - BG_COLD[0]) * heat);
    const gg = Math.round(BG_COLD[1] + (BG_HOT[1] - BG_COLD[1]) * heat);
    const b = Math.round(BG_COLD[2] + (BG_HOT[2] - BG_COLD[2]) * heat);
    ctx.fillStyle = `rgb(${r},${gg},${b})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // Grid breathes on the beat (thin lines only, never a full-screen flash).
    ctx.strokeStyle = heat > 0.5 ? '#a060ff' : '#5a7ad0';
    ctx.globalAlpha = 0.07 + 0.05 * heat + fx.beat * (0.04 + 0.1 * heat);
    ctx.lineWidth = 1;
    const step = 40;
    const off = -(((camY % step) + step) % step);
    ctx.beginPath();
    for (let y = off; y < VIEW_H; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(VIEW_W, y);
    }
    for (let x = 0; x <= VIEW_W; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, VIEW_H);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Rising speed streaks, denser with speed and heat.
    if (!fx.reduced && g.state !== 'ready') {
      const speed = Math.hypot(g.orb.vx, g.orb.vy);
      const k = Math.min(1, Math.max(0, (speed - 200) / 500)) * 0.6 + heat * 0.5;
      if (k > 0.05) {
        const span = VIEW_H * 1.3;
        ctx.strokeStyle = heat > 0.5 ? '#d8b8ff' : '#b8d4ff';
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = Math.min(0.5, k * 0.4);
        ctx.beginPath();
        for (let i = 0; i < STREAKS; i++) {
          const d = this.streakD[i]!;
          const y = ((((this.streakP[i]! * span - camY * d * 1.6) % span) + span) % span) - VIEW_H * 0.15;
          const len = (20 + 110 * k) * d;
          const x = this.streakX[i]!;
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + len);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // Milestone number, huge and hollow, behind the playfield.
    if (fx.milestoneAge < 1.2 && fx.milestoneText) {
      const t = fx.milestoneAge / 1.2;
      const sc = 1.35 - 0.35 * easeOut(Math.min(1, t * 3));
      ctx.save();
      ctx.translate(VIEW_W / 2, VIEW_H * 0.42);
      ctx.scale(sc, sc);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '900 110px system-ui, sans-serif';
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.4 * (1 - t);
      ctx.strokeStyle = colorOf(g.orb.polarity);
      ctx.strokeText(fx.milestoneText, 0, 0);
      ctx.restore();
    }
  }

  private walls(camY: number): void {
    const { ctx } = this;
    ctx.fillStyle = COLORS.wall;
    ctx.fillRect(-60, camY - 200, 63, VIEW_H + 400);
    ctx.fillRect(VIEW_W - 3, camY - 200, 63, VIEW_H + 400);
  }

  private magnetHalo(m: Magnet, fx: Fx): void {
    const { ctx } = this;
    const c = colorOf(m.polarity);
    if (m.kind === 'point') {
      ctx.globalAlpha = 0.2 + 0.06 * fx.beat;
      ctx.drawImage(this.glow.get(c)!, m.x - m.field, m.y - m.field, m.field * 2, m.field * 2);
      ctx.globalAlpha = 1;
    } else {
      ctx.lineCap = 'round';
      ctx.strokeStyle = c;
      ctx.globalAlpha = 0.05;
      for (const w of RAIL_HALO) {
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(m.ax, m.ay);
        ctx.lineTo(m.bx, m.by);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  private magnet(m: Magnet, g: Game, ox: number, oy: number, time: number): void {
    const { ctx } = this;
    const fx = g.fx;
    const c = colorOf(m.polarity);
    const held = g.orb.stuck?.magnet === m;
    const pulls = attracts(g.orb.polarity, m.polarity);
    const { cx, cy } = closestPoint(m, ox, oy);
    const u = g.state === 'playing' ? fieldU(m, Math.hypot(cx - ox, cy - oy)) : 0;
    const hot = 0.5 + 0.2 * fx.beat + (pulls ? 0.5 * u : 0) + (held ? 0.4 : 0);

    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, hot);
    if (m.kind === 'point') {
      const gr = m.r * 3.4;
      ctx.drawImage(this.glow.get(c)!, m.x - gr, m.y - gr, gr * 2, gr * 2);
    } else {
      ctx.lineCap = 'round';
      ctx.strokeStyle = c;
      ctx.globalAlpha = Math.min(1, hot) * 0.35;
      ctx.lineWidth = m.r * 2 + 14;
      ctx.beginPath();
      ctx.moveTo(m.ax, m.ay);
      ctx.lineTo(m.bx, m.by);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    if (m.kind === 'point') {
      ctx.fillStyle = '#0d1222';
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, TAU);
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = c;
      ctx.stroke();
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r * (0.35 + 0.05 * Math.sin(time * 6) + 0.06 * fx.beat), 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#0d1222';
      ctx.font = `900 ${Math.round(m.r * 0.9)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(m.polarity === 'red' ? '+' : '−', m.x, m.y + 1);
    } else {
      ctx.lineCap = 'round';
      ctx.strokeStyle = c;
      ctx.lineWidth = m.r * 2;
      ctx.beginPath();
      ctx.moveTo(m.ax, m.ay);
      ctx.lineTo(m.bx, m.by);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 10]);
      ctx.lineDashOffset = -time * (30 + 60 * g.heat);
      ctx.beginPath();
      ctx.moveTo(m.ax, m.ay);
      ctx.lineTo(m.bx, m.by);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Flip cue: every magnet that now pulls you rings once.
    if (fx.flipCue > 0 && pulls && u > 0) {
      const t = 1 - fx.flipCue;
      ctx.globalAlpha = fx.flipCue;
      ctx.strokeStyle = c;
      ctx.lineWidth = 3;
      if (m.kind === 'point') {
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r + 4 + t * 22, 0, TAU);
        ctx.stroke();
      } else {
        ctx.lineWidth = m.r * 2 + 6 + t * 26;
        ctx.globalAlpha = fx.flipCue * 0.3;
        ctx.beginPath();
        ctx.moveTo(m.ax, m.ay);
        ctx.lineTo(m.bx, m.by);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  private spikePath(row: SpikeRow): Path2D {
    let p = this.spikePaths.get(row);
    if (!p) {
      p = new Path2D();
      for (const t of spikeTriangles(row)) {
        p.moveTo(t.ax, t.ay);
        p.lineTo(t.tx, t.ty);
        p.lineTo(t.bx, t.by);
        p.closePath();
      }
      this.spikePaths.set(row, p);
    }
    return p;
  }

  /** Spikes glow hotter as the orb gets close, so danger reads louder, never quieter. */
  private spikes(row: SpikeRow, g: Game, ox: number, oy: number, fx: Fx): void {
    const { ctx } = this;
    const path = this.spikePath(row);
    const dx = Math.max(row.x - ox, 0, ox - (row.x + row.w));
    const dy = Math.max(row.y - oy, 0, oy - (row.y + row.h));
    const danger = g.state === 'playing' ? Math.max(0, 1 - Math.hypot(dx, dy) / 80) : 0;
    const killer = g.deathRow === row && fx.deathRowFlash > 0;

    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = COLORS.spike;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 5 + 4 * danger;
    ctx.globalAlpha = 0.18 + 0.1 * fx.beat + 0.45 * danger + (killer ? 0.6 : 0);
    ctx.stroke(path);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = killer ? COLORS.white : COLORS.spike;
    ctx.fill(path);
    ctx.lineWidth = 1;
    ctx.strokeStyle = danger > 0.5 ? '#fff6c0' : COLORS.spikeBase;
    ctx.stroke(path);
  }

  /** Streaks between orb and magnet, flowing toward it when attracting and away when repelling. */
  private fieldHints(g: Game, ox: number, oy: number, time: number): void {
    const { ctx } = this;
    ctx.lineCap = 'round';
    for (const m of g.world.magnets) {
      const { cx, cy } = closestPoint(m, ox, oy);
      const dx = cx - ox;
      const dy = cy - oy;
      const d = Math.hypot(dx, dy);
      const u = fieldU(m, d);
      if (u <= 0 || d < 1) continue;
      const ux = dx / d;
      const uy = dy / d;
      const px = -uy;
      const py = ux;
      const pull = attracts(g.orb.polarity, m.polarity);
      const span = d - m.r - ORB_RADIUS;
      if (span <= 4) continue;
      ctx.strokeStyle = colorOf(m.polarity);
      ctx.globalAlpha = Math.min(1, 0.25 + 0.6 * u);
      ctx.lineWidth = 1.5 + u * 1.5;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        let f = (time * (0.6 + u * 1.6) + i / 4) % 1;
        if (!pull) f = 1 - f;
        const along = ORB_RADIUS + 2 + f * span;
        const lateral = (i - 1.5) * 5 * (1 - f * 0.6);
        const len = 5 + u * 10;
        const sx = ox + ux * along + px * lateral;
        const sy = oy + uy * along + py * lateral;
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + ux * len * (pull ? 1 : -1), sy + uy * len * (pull ? 1 : -1));
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Crackling arc to the strongest pulling magnet. */
  private tether(g: Game, ox: number, oy: number, time: number): void {
    if (g.orb.stuck) return;
    let best: Magnet | null = null;
    let bu = 0.35;
    let bx = 0;
    let by = 0;
    for (const m of g.world.magnets) {
      if (!attracts(g.orb.polarity, m.polarity)) continue;
      const { cx, cy } = closestPoint(m, ox, oy);
      const u = fieldU(m, Math.hypot(cx - ox, cy - oy));
      if (u > bu) {
        bu = u;
        best = m;
        bx = cx;
        by = cy;
      }
    }
    if (!best) return;
    const { ctx } = this;
    const dx = bx - ox;
    const dy = by - oy;
    const d = Math.hypot(dx, dy) || 1;
    const px = -dy / d;
    const py = dx / d;
    const n = 8;
    const amp = 3 + 6 * bu;
    ctx.globalCompositeOperation = 'lighter';
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass === 0 ? colorOf(best.polarity) : COLORS.white;
      ctx.lineWidth = pass === 0 ? 3 : 1;
      ctx.globalAlpha = (pass === 0 ? 0.35 : 0.5) * bu;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      for (let i = 1; i < n; i++) {
        const f = i / n;
        const o = Math.sin(i * 2.7 + time * 33) * Math.sin(i * 1.3 - time * 21) * amp * Math.sin(Math.PI * f);
        ctx.lineTo(ox + dx * f + px * o, oy + dy * f + py * o);
      }
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  private trail(g: Game, heat: number): void {
    const { ctx } = this;
    const fx = g.fx;
    const n = fx.trailLen;
    if (n < 2) return;
    ctx.lineCap = 'round';
    ctx.strokeStyle = g.color();
    const start = (fx.trailHead - n + TRAIL_LENGTH) % TRAIL_LENGTH;
    let px = fx.trailX[start]!;
    let py = fx.trailY[start]!;
    for (let i = 1; i < n; i++) {
      const k = (start + i) % TRAIL_LENGTH;
      const x = fx.trailX[k]!;
      const y = fx.trailY[k]!;
      const a = i / n;
      ctx.globalAlpha = a * (0.55 + 0.25 * heat);
      ctx.lineWidth = ORB_RADIUS * (1.5 + 0.5 * heat) * a;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(x, y);
      ctx.stroke();
      px = x;
      py = y;
    }
    ctx.globalAlpha = 1;
  }

  private ghosts(fx: Fx): void {
    const { ctx } = this;
    for (let i = 0; i < fx.ghostCount; i++) {
      const gh = fx.ghosts[i]!;
      const t = gh.age / gh.life;
      ctx.globalAlpha = 0.45 * (1 - t);
      ctx.strokeStyle = gh.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(gh.x, gh.y, ORB_RADIUS * (1 - 0.3 * t), 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Anime speed lines streaming behind the orb right after a launch. */
  private speedLines(fx: Fx, ox: number, oy: number, color: string): void {
    if (fx.streakTime <= 0) return;
    const { ctx } = this;
    const k = fx.streakTime / 0.3;
    const dx = fx.streakDx;
    const dy = fx.streakDy;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const lat = (i - 3) * 6;
      const startBack = ORB_RADIUS + 4 + (i % 3) * 6;
      const len = (30 + ((i * 37) % 5) * 12) * k;
      const sx = ox - dx * startBack - dy * lat;
      const sy = oy - dy * startBack + dx * lat;
      ctx.strokeStyle = i % 2 ? COLORS.white : color;
      ctx.globalAlpha = 0.7 * k;
      ctx.lineWidth = i === 3 ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - dx * len, sy - dy * len);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  private orb(x: number, y: number, p: Polarity, stuck: boolean, time: number, fx: Fx, vx: number, vy: number, heat: number): void {
    const { ctx } = this;
    const c = colorOf(p);
    const pop = fx.orbPop;

    // Glow.
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, 0.55 + 0.25 * heat + 0.3 * pop + (stuck ? 0.2 : 0));
    const gr = ORB_RADIUS * (3.6 + 1.2 * heat + 1.5 * pop);
    ctx.drawImage(this.glow.get(c)!, x - gr, y - gr, gr * 2, gr * 2);

    // Local chromatic split after a launch.
    if (fx.splitTime > 0) {
      const k = (fx.splitTime / 0.22) * 5;
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = COLORS.red;
      ctx.beginPath();
      ctx.arc(x + fx.splitDx * k, y + fx.splitDy * k, ORB_RADIUS + 1, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = COLORS.blue;
      ctx.beginPath();
      ctx.arc(x - fx.splitDx * k, y - fx.splitDy * k, ORB_RADIUS + 1, 0, TAU);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.translate(x, y);
    if (fx.squashAge < 0.4 && fx.squash > 0) {
      // Wobble flat against the magnet.
      const q = fx.squash * Math.exp(-fx.squashAge * 9) * Math.cos(fx.squashAge * 36);
      const a = Math.atan2(fx.squashNy, fx.squashNx);
      ctx.rotate(a);
      ctx.scale(1 - q, 1 + q * 0.7);
      ctx.rotate(-a);
    } else if (!stuck) {
      // Stretch along velocity.
      const sp = Math.hypot(vx, vy);
      const k = Math.min(0.38, sp / 2000);
      if (k > 0.02) {
        const a = Math.atan2(vy, vx);
        ctx.rotate(a);
        ctx.scale(1 + k, 1 / (1 + k));
        ctx.rotate(-a);
      }
    }
    const sc = 1 + pop * 0.3;
    ctx.scale(sc, sc);

    const R = ORB_RADIUS;
    if (fx.orbWhite > 0) {
      // Impact frame.
      ctx.fillStyle = COLORS.white;
      ctx.beginPath();
      ctx.arc(0, 0, R + 1, 0, TAU);
      ctx.fill();
    } else {
      ctx.drawImage(this.orbBody, -R, -R, R * 2, R * 2);
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(0, 0, R * (0.44 + (stuck ? 0.08 * Math.sin(time * 20) : 0) + 0.1 * pop), 0, TAU);
      ctx.fill();
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();

    // Wind-up ring while stuck, in the colour a tap would switch to.
    if (stuck) {
      const t = Math.min(1, fx.squashAge / 0.35);
      ctx.strokeStyle = otherColor(p);
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.85;
      ctx.lineCap = 'round';
      const a0 = time * 9;
      for (let i = 0; i < 3; i++) {
        const a = a0 + (i * TAU) / 3;
        ctx.beginPath();
        ctx.arc(x, y, R + 6 - 2 * t, a, a + 1.4 * t);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  private effects(fx: Fx): void {
    const { ctx } = this;
    for (let i = 0; i < fx.pulseCount; i++) {
      const p = fx.pulses[i]!;
      if (p.delay > 0) continue;
      const t = p.age / p.life;
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.width * (1 - t) + 0.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r0 + (p.r1 - p.r0) * easeOut(t), 0, TAU);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 0; i < fx.particleCount; i++) {
      const p = fx.particles[i]!;
      const t = p.age / p.life;
      ctx.globalAlpha = 1 - t;
      if (p.kind === P_SPARK) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
        ctx.stroke();
      } else if (p.kind === P_DOT) {
        const sz = p.size * (1 - t * 0.5);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - sz, p.y - sz, sz * 2, sz * 2);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < fx.particleCount; i++) {
      const p = fx.particles[i]!;
      if (p.kind !== P_SHARD) continue;
      const t = p.age / p.life;
      ctx.globalAlpha = 1 - t * t;
      ctx.fillStyle = p.color;
      const cs = Math.cos(p.rot) * p.size;
      const sn = Math.sin(p.rot) * p.size;
      ctx.beginPath();
      ctx.moveTo(p.x + cs, p.y + sn);
      ctx.lineTo(p.x - cs * 0.6 - sn * 0.5, p.y - sn * 0.6 + cs * 0.5);
      ctx.lineTo(p.x - cs * 0.4 + sn * 0.6, p.y - sn * 0.4 - cs * 0.6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private popups(fx: Fx): void {
    if (fx.popupCount === 0) return;
    const { ctx } = this;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (let i = 0; i < fx.popupCount; i++) {
      const p = fx.popups[i]!;
      const t = p.age / p.life;
      const sc = p.age < 0.12 ? 1.7 - (p.age / 0.12) * 0.7 : 1;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(sc, sc);
      ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      ctx.font = `900 italic ${p.size}px system-ui, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#03050c';
      ctx.strokeText(p.text, 0, 0);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
    }
  }

  /** Screen-space layers: vignette, polarity edge glow, stall danger and flash. */
  private overlays(g: Game, orbScreenY: number, heat: number, time: number): void {
    const { ctx } = this;
    const fx = g.fx;
    ctx.globalAlpha = 0.5 + 0.3 * heat;
    ctx.drawImage(this.vignette, 0, 0, VIEW_W, VIEW_H);
    if (g.state === 'playing') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(0.7, (0.12 + 0.3 * heat) * (0.75 + 0.25 * fx.beat) + 0.25 * fx.flipCue);
      ctx.drawImage(this.edge.get(g.color())!, 0, 0, VIEW_W, VIEW_H);
      ctx.globalCompositeOperation = 'source-over';

      const d = 1 - orbScreenY / JUICE.dangerZone;
      if (d > 0) {
        const k = Math.min(1, d);
        const throb = fx.reduced ? 0.8 : 0.7 + 0.3 * Math.sin(time * 12);
        ctx.globalAlpha = k * throb;
        ctx.drawImage(this.danger, 0, 0, VIEW_W, 90 + 60 * k);
        ctx.globalAlpha = k;
        ctx.fillStyle = COLORS.spike;
        const off = (time * 40) % 24;
        ctx.beginPath();
        for (let x = -24 + off; x < VIEW_W + 24; x += 24) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x + 12, 0);
          ctx.lineTo(x + 4, 7);
          ctx.lineTo(x - 8, 7);
          ctx.closePath();
        }
        ctx.fill();
      }
    }
    const fa = fx.flashAlpha();
    if (fa > 0.003) {
      ctx.globalAlpha = fa;
      ctx.fillStyle = fx.flashColor;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    ctx.globalAlpha = 1;
  }

  /** Score text with a red and cyan split that widens on milestones and with heat. */
  private splitText(text: string, x: number, y: number, split: number, fill: string): void {
    const { ctx } = this;
    ctx.fillStyle = '#000000';
    ctx.globalAlpha = 0.6;
    ctx.fillText(text, x + 1.5, y + 2.5);
    if (split > 0.3) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = COLORS.red;
      ctx.fillText(text, x - split, y);
      ctx.fillStyle = COLORS.blue;
      ctx.fillText(text, x + split, y);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
  }

  private hud(g: Game, heat: number): void {
    const { ctx } = this;
    const fx = g.fx;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const pop = easeOut(fx.scorePop);
    ctx.translate(VIEW_W / 2, 40);
    ctx.scale(1 + pop * 0.45, 1 + pop * 0.45);
    ctx.font = '900 32px system-ui, sans-serif';
    this.splitText(g.score.toLocaleString('en-US'), 0, 0, 1 + pop * 4 + heat * 1.5, COLORS.text);
    ctx.restore();
    if (g.state === 'playing') this.shieldIcon(24, 40, g.shield);

    if (g.state === 'dying' && g.stateTime > 0.6) {
      const t = Math.min(1, (g.stateTime - 0.6) / 0.15);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.translate(VIEW_W / 2, VIEW_H * 0.55);
      const sc = 1.5 - 0.5 * easeOut(t);
      ctx.scale(sc, sc);
      ctx.globalAlpha = t;
      const best = g.score >= g.best && g.score > 0;
      ctx.font = '900 italic 22px system-ui, sans-serif';
      this.splitText(best ? 'NEW BEST' : 'WRECKED', 0, -20, 2, best ? COLORS.spike : COLORS.text);
      ctx.font = '700 14px system-ui, sans-serif';
      ctx.fillStyle = COLORS.dim;
      ctx.fillText('TAP TO RETRY', 0, 12);
      ctx.restore();
    }
  }

  private shieldRing(x: number, y: number, time: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = 'rgba(232,238,252,0.75)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.lineDashOffset = -time * 20;
    ctx.beginPath();
    ctx.arc(x, y, ORB_RADIUS + 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private shieldIcon(x: number, y: number, ready: boolean): void {
    const { ctx } = this;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = ready ? COLORS.text : COLORS.chrome;
    ctx.fillStyle = ready ? 'rgba(232,238,252,0.18)' : 'rgba(0,0,0,0)';
    ctx.beginPath();
    ctx.moveTo(x, y - 10);
    ctx.lineTo(x + 9, y - 6);
    ctx.quadraticCurveTo(x + 8, y + 6, x, y + 11);
    ctx.quadraticCurveTo(x - 8, y + 6, x - 9, y - 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private menu(g: Game, time: number): void {
    const { ctx } = this;
    const fx = g.fx;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const sc = 1 + 0.04 * fx.beat;
    ctx.save();
    ctx.translate(VIEW_W / 2, 172);
    ctx.scale(sc, sc);
    ctx.font = '900 italic 46px system-ui, sans-serif';
    this.splitText('MAGNET', 0, -24, 2.5, COLORS.text);
    this.splitText('DROP', 0, 24, 2.5, COLORS.text);
    ctx.restore();
    ctx.fillStyle = COLORS.spike;
    ctx.font = '800 12px system-ui, sans-serif';
    ctx.fillText('TUNER', VIEW_W / 2, 230);
    ctx.fillStyle = COLORS.dim;
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.fillText('BEST', VIEW_W / 2, 262);
    ctx.fillStyle = COLORS.text;
    ctx.font = '800 26px system-ui, sans-serif';
    ctx.fillText(g.best.toLocaleString('en-US'), VIEW_W / 2, 290);
    const pol: Polarity = Math.floor(time * 1.25) % 2 === 0 ? 'blue' : 'red';
    this.orb(VIEW_W / 2, 400 + Math.sin(time * 3) * 6, pol, false, time, fx, 0, 0, 0);
    ctx.globalAlpha = 0.55 + 0.45 * Math.sin(time * 4);
    ctx.fillStyle = COLORS.text;
    ctx.font = '800 18px system-ui, sans-serif';
    ctx.fillText('TAP', VIEW_W / 2, 450);
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.dim;
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillText('Tap to flip polarity. Opposites attract.', VIEW_W / 2, 560);
    ctx.fillText('Your shield blocks one spike hit and comes back.', VIEW_W / 2, 580);
    ctx.fillText('Press T or the gear to tune the physics.', VIEW_W / 2, 600);
    ctx.restore();
  }
}

function magnetVisible(m: Magnet, top: number, bottom: number): boolean {
  if (m.kind === 'point') return m.y + m.field > top && m.y - m.field < bottom;
  return Math.max(m.ay, m.by) + RAIL_FIELD > top && Math.min(m.ay, m.by) - RAIL_FIELD < bottom;
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}
