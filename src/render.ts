import { CAMERA_ANCHOR, COLORS, ORB_RADIUS, RAIL_FIELD, STALL_WARN, VIEW_H, VIEW_W } from './config.ts';
import type { Game } from './game.ts';
import { attracts, closestPoint, fieldU, spikeTriangles } from './physics.ts';
import type { Magnet, Polarity, SpikeRow } from './types.ts';

const colorOf = (p: Polarity): string => (p === 'red' ? COLORS.red : COLORS.blue);

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not supported in this browser.');
    this.canvas = canvas;
    this.ctx = ctx;
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
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#03050c';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const s = this.scale * this.dpr;
    const shake = g.fx.shakeOffset();
    ctx.setTransform(s, 0, 0, s, this.ox * this.dpr, this.oy * this.dpr);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, VIEW_W, VIEW_H);
    ctx.clip();
    ctx.translate(shake.x, shake.y);

    const playing = g.state === 'playing';
    const camY = playing ? g.prevCamY + (g.camY - g.prevCamY) * alpha : g.camY;
    const ox = playing ? g.orb.prevX + (g.orb.x - g.orb.prevX) * alpha : g.orb.x;
    const oy = playing ? g.orb.prevY + (g.orb.y - g.orb.prevY) * alpha : g.orb.y;

    this.background(camY);

    if (g.state !== 'ready') {
      ctx.save();
      ctx.translate(0, -camY);
      const top = camY - 60;
      const bottom = camY + VIEW_H + 60;
      for (const m of g.world.magnets) if (magnetVisible(m, top, bottom)) this.magnetHalo(m);
      for (const row of g.world.spikes) if (row.y + row.h > top && row.y < bottom) this.spikes(row);
      for (const m of g.world.magnets) if (magnetVisible(m, top, bottom)) this.magnet(m, time);
      if (playing) this.fieldHints(g, ox, oy, time);
      this.trail(g);
      const blink = g.grace > 0 && Math.floor(time * 16) % 2 === 0;
      if (!(g.state === 'dying' && g.exploded) && !blink) this.orb(ox, oy, g.orb.polarity, g.orb.stuck !== null, time);
      if (playing && g.shield) this.shieldRing(ox, oy, time);
      this.effects(g);
      ctx.restore();
    }

    this.walls();
    if (playing) this.stallWarning(oy - camY);

    if (g.fx.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${(g.fx.flash / 0.18) * 0.12})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }

    ctx.restore();

    if (g.state === 'ready') this.menu(g, time);
    else this.hud(g);
  }

  private background(camY: number): void {
    const { ctx } = this;
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.strokeStyle = COLORS.grid;
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
  }

  private walls(): void {
    const { ctx } = this;
    ctx.fillStyle = COLORS.wall;
    ctx.fillRect(0, 0, 3, VIEW_H);
    ctx.fillRect(VIEW_W - 3, 0, 3, VIEW_H);
  }

  private magnetHalo(m: Magnet): void {
    const { ctx } = this;
    const c = colorOf(m.polarity);
    ctx.save();
    if (m.kind === 'point') {
      const grad = ctx.createRadialGradient(m.x, m.y, m.r, m.x, m.y, m.field);
      grad.addColorStop(0, hexA(c, 0.16));
      grad.addColorStop(1, hexA(c, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.field, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.lineCap = 'round';
      ctx.strokeStyle = hexA(c, 0.05);
      for (const w of [RAIL_FIELD * 2, RAIL_FIELD * 1.2, RAIL_FIELD * 0.6]) {
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(m.ax, m.ay);
        ctx.lineTo(m.bx, m.by);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private magnet(m: Magnet, time: number): void {
    const { ctx } = this;
    const c = colorOf(m.polarity);
    ctx.save();
    ctx.shadowColor = c;
    ctx.shadowBlur = 16;
    if (m.kind === 'point') {
      ctx.fillStyle = '#0d1222';
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = c;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r * (0.35 + 0.05 * Math.sin(time * 6)), 0, Math.PI * 2);
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
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 10]);
      ctx.lineDashOffset = -time * 30;
      ctx.beginPath();
      ctx.moveTo(m.ax, m.ay);
      ctx.lineTo(m.bx, m.by);
      ctx.stroke();
    }
    ctx.restore();
  }

  private spikes(row: SpikeRow): void {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = COLORS.spike;
    ctx.strokeStyle = COLORS.spikeBase;
    ctx.lineWidth = 1;
    ctx.shadowColor = COLORS.spike;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    for (const t of spikeTriangles(row)) {
      ctx.moveTo(t.ax, t.ay);
      ctx.lineTo(t.tx, t.ty);
      ctx.lineTo(t.bx, t.by);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** Streaks between orb and magnet, flowing toward it when attracting and away when repelling. */
  private fieldHints(g: Game, ox: number, oy: number, time: number): void {
    const { ctx } = this;
    ctx.save();
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
      ctx.strokeStyle = hexA(colorOf(m.polarity), 0.25 + 0.6 * u);
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
    ctx.restore();
  }

  private trail(g: Game): void {
    const { ctx } = this;
    const pts = g.fx.trail;
    if (pts.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    const c = g.color();
    for (let i = 1; i < pts.length; i++) {
      const a = i / pts.length;
      ctx.strokeStyle = hexA(c, a * 0.6);
      ctx.lineWidth = ORB_RADIUS * 1.4 * a;
      ctx.beginPath();
      ctx.moveTo(pts[i - 1]!.x, pts[i - 1]!.y);
      ctx.lineTo(pts[i]!.x, pts[i]!.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  private orb(x: number, y: number, p: Polarity, stuck: boolean, time: number): void {
    const { ctx } = this;
    const c = colorOf(p);
    ctx.save();
    ctx.shadowColor = c;
    ctx.shadowBlur = stuck ? 26 : 18;
    const grad = ctx.createRadialGradient(x - 4, y - 4, 1, x, y, ORB_RADIUS);
    grad.addColorStop(0, '#9aa3b8');
    grad.addColorStop(0.5, '#3a4256');
    grad.addColorStop(1, '#141824');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, ORB_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x, y, ORB_RADIUS * (0.42 + (stuck ? 0.08 * Math.sin(time * 20) : 0)), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hexA(c, 0.9);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, ORB_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private shieldRing(x: number, y: number, time: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = 'rgba(232,238,252,0.7)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.lineDashOffset = -time * 20;
    ctx.beginPath();
    ctx.arc(x, y, ORB_RADIUS + 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** Red glow along the top edge as the camera closes in on a stalled orb. */
  private stallWarning(screenY: number): void {
    const near = VIEW_H * STALL_WARN;
    if (screenY >= near) return;
    const k = Math.min(1, (near - screenY) / (near + ORB_RADIUS));
    const { ctx } = this;
    const h = VIEW_H * CAMERA_ANCHOR * 0.6;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, hexA(COLORS.red, 0.45 * k));
    grad.addColorStop(1, hexA(COLORS.red, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VIEW_W, h);
  }

  private effects(g: Game): void {
    const { ctx } = this;
    ctx.save();
    for (const p of g.fx.pulses) {
      const t = p.age / p.life;
      ctx.strokeStyle = hexA(p.color, 1 - t);
      ctx.lineWidth = p.width * (1 - t) + 0.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, ORB_RADIUS + (p.maxR - ORB_RADIUS) * easeOut(t), 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const p of g.fx.particles) {
      const t = p.age / p.life;
      ctx.fillStyle = hexA(p.color, 1 - t);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 - t * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private hud(g: Game): void {
    const { ctx } = this;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = COLORS.text;
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    ctx.font = '800 30px system-ui, sans-serif';
    ctx.fillText(g.score.toLocaleString('en-US'), VIEW_W / 2, 22);
    if (g.state === 'playing') {
      this.shieldIcon(22, 30, g.shield);
      if (g.messageTime > 0) {
        ctx.globalAlpha = Math.min(1, g.messageTime / 0.3);
        ctx.font = '800 14px system-ui, sans-serif';
        ctx.fillStyle = COLORS.text;
        ctx.fillText(g.message, VIEW_W / 2, 62);
        ctx.globalAlpha = 1;
      }
    }
    if (g.state === 'dying' && g.stateTime > 0.6) {
      ctx.font = '700 14px system-ui, sans-serif';
      ctx.fillStyle = COLORS.dim;
      ctx.fillText(g.score >= g.best && g.score > 0 ? 'NEW BEST · TAP TO RETRY' : 'TAP TO RETRY', VIEW_W / 2, VIEW_H * 0.55);
    }
    ctx.restore();
  }

  private shieldIcon(x: number, y: number, ready: boolean): void {
    const { ctx } = this;
    ctx.save();
    ctx.shadowBlur = 0;
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
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.text;
    ctx.shadowColor = COLORS.blue;
    ctx.shadowBlur = 18;
    ctx.font = '900 40px system-ui, sans-serif';
    ctx.fillText('MAGNET', VIEW_W / 2, 150);
    ctx.shadowColor = COLORS.red;
    ctx.fillText('DROP', VIEW_W / 2, 194);
    ctx.shadowBlur = 0;
    ctx.fillStyle = COLORS.dim;
    ctx.font = '800 12px system-ui, sans-serif';
    ctx.fillText('EASY', VIEW_W / 2, 226);
    ctx.shadowBlur = 0;
    ctx.fillStyle = COLORS.dim;
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.fillText('BEST', VIEW_W / 2, 262);
    ctx.fillStyle = COLORS.text;
    ctx.font = '800 26px system-ui, sans-serif';
    ctx.fillText(g.best.toLocaleString('en-US'), VIEW_W / 2, 290);
    const pol: Polarity = Math.floor(time * 1.25) % 2 === 0 ? 'blue' : 'red';
    this.orb(VIEW_W / 2, 400 + Math.sin(time * 3) * 6, pol, false, time);
    ctx.globalAlpha = 0.55 + 0.45 * Math.sin(time * 4);
    ctx.fillStyle = COLORS.text;
    ctx.font = '800 18px system-ui, sans-serif';
    ctx.fillText('TAP', VIEW_W / 2, 450);
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.dim;
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillText('Tap to flip polarity. Opposites attract.', VIEW_W / 2, 560);
    ctx.fillText('Your shield blocks one spike hit and comes back.', VIEW_W / 2, 580);
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
