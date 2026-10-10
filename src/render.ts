import { BOOST_TIME, COLORS, ORB_RADIUS, PHASE_TIME, PICKUP_RADIUS, POWER_WARN, RAIL_FIELD, VIEW_H, VIEW_W } from './config.ts';
import { POWER_LABEL, type Game } from './game.ts';
import { attracts, closestPoint, fieldU, spikeTriangles } from './physics.ts';
import type { Magnet, Pickup, Polarity, PowerKind, SpikeRow } from './types.ts';

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
      for (const k of g.world.pickups) if (!k.taken && k.y > top && k.y < bottom) this.pickup(k, time);
      if (playing && !g.boosting) this.fieldHints(g, ox, oy, time);
      this.trail(g);
      if (!(g.state === 'dying' && g.exploded)) {
        if (playing && g.boosting) this.boostFlame(ox, oy, time);
        ctx.save();
        if (playing && g.phase > 0) ctx.globalAlpha = blinkOn(g.phase, time) ? 0.35 : 0.8;
        this.orb(ox, oy, g.orb.polarity, g.orb.stuck !== null, time);
        ctx.restore();
        if (playing) this.powerAura(g, ox, oy, time);
      }
      this.effects(g);
      ctx.restore();
      this.floatTexts(g);
    }

    this.walls();

    if (g.fx.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${(g.fx.flash / 0.18) * 0.12})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }

    ctx.restore();

    if (g.state === 'ready') this.menu(g, time);
    else this.hud(g, time);
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
    const c = g.boosting && g.state === 'playing' ? COLORS.boost : g.color();
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

  private pickup(k: Pickup, time: number): void {
    const { ctx } = this;
    const c = POWER_LABEL[k.kind].color;
    const y = k.y + Math.sin(time * 3 + k.homeX) * 3;
    const r = PICKUP_RADIUS;
    ctx.save();
    const grad = ctx.createRadialGradient(k.x, y, r * 0.5, k.x, y, r * 3);
    grad.addColorStop(0, hexA(c, 0.3));
    grad.addColorStop(1, hexA(c, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(k.x, y, r * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = c;
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#0d1222';
    ctx.strokeStyle = c;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const px = k.x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = hexA(c, 0.7);
    ctx.setLineDash([4, 6]);
    ctx.lineDashOffset = -time * 20;
    ctx.beginPath();
    ctx.arc(k.x, y, r + 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    powerIcon(ctx, k.kind, k.x, y, r * 0.62, c);
    ctx.fillStyle = c;
    ctx.font = '800 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(POWER_LABEL[k.kind].name, k.x, y + r + 9);
    ctx.restore();
  }

  /** Green exhaust above the orb while it dives. */
  private boostFlame(x: number, y: number, time: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const lx = x + (i - 2) * 4.5;
      const len = 26 + 22 * Math.abs(Math.sin(time * 23 + i * 1.7));
      const grad = ctx.createLinearGradient(lx, y, lx, y - len);
      grad.addColorStop(0, hexA(COLORS.boost, 0.85));
      grad.addColorStop(1, hexA(COLORS.boost, 0));
      ctx.strokeStyle = grad;
      ctx.lineWidth = i === 2 ? 5 : 3;
      ctx.beginPath();
      ctx.moveTo(lx, y - 4);
      ctx.lineTo(lx, y - len);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Shield bubble, phase outline and boost glow around the orb. */
  private powerAura(g: Game, x: number, y: number, time: number): void {
    const { ctx } = this;
    ctx.save();
    if (g.shield) {
      const r = ORB_RADIUS + 7 + Math.sin(time * 5) * 1;
      const grad = ctx.createRadialGradient(x - 4, y - 5, 1, x, y, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.05)');
      grad.addColorStop(0.8, 'rgba(244,247,255,0.12)');
      grad.addColorStop(1, 'rgba(244,247,255,0.35)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowColor = COLORS.shield;
      ctx.shadowBlur = 10;
      ctx.strokeStyle = hexA(COLORS.shield, 0.85);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r - 3, Math.PI * 1.1, Math.PI * 1.4);
      ctx.stroke();
    }
    if (g.phase > 0 && blinkOn(g.phase, time)) {
      ctx.strokeStyle = hexA(COLORS.phase, 0.9);
      ctx.shadowColor = COLORS.phase;
      ctx.shadowBlur = 12;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.lineDashOffset = time * 30;
      ctx.beginPath();
      ctx.arc(x, y, ORB_RADIUS + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (g.grace > 0 && !g.boosting) {
      ctx.strokeStyle = hexA(COLORS.text, Math.min(1, g.grace * 2) * 0.6);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, ORB_RADIUS + 12, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private floatTexts(g: Game): void {
    const { ctx } = this;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of g.fx.texts) {
      const k = t.age / t.life;
      const pop = Math.min(1, t.age / 0.12);
      ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      ctx.fillStyle = t.color;
      ctx.shadowColor = t.color;
      ctx.shadowBlur = 12;
      ctx.font = `900 ${Math.round(16 + 8 * pop)}px system-ui, sans-serif`;
      ctx.fillText(t.text, t.x, t.y);
      if (t.sub) {
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 6;
        ctx.fillStyle = COLORS.text;
        ctx.font = '700 12px system-ui, sans-serif';
        ctx.fillText(t.sub, t.x, t.y + 20);
      }
    }
    ctx.restore();
  }

  /** Active power-ups under the score, each ring draining as it runs out. */
  private powerBadges(g: Game, time: number): void {
    const items: { kind: PowerKind; frac: number; blink: boolean }[] = [];
    if (g.boosting) items.push({ kind: 'boost', frac: g.boost / BOOST_TIME, blink: !blinkOn(g.boost, time) });
    if (g.phase > 0) items.push({ kind: 'phase', frac: g.phase / PHASE_TIME, blink: !blinkOn(g.phase, time) });
    if (g.shield) items.push({ kind: 'shield', frac: 1, blink: false });
    const { ctx } = this;
    items.forEach((it, i) => {
      const x = VIEW_W / 2 + (i - (items.length - 1) / 2) * 38;
      const y = 76;
      const c = POWER_LABEL[it.kind].color;
      ctx.save();
      ctx.globalAlpha = it.blink ? 0.35 : 1;
      ctx.fillStyle = 'rgba(13,18,34,0.85)';
      ctx.beginPath();
      ctx.arc(x, y, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = hexA(c, 0.25);
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = c;
      ctx.beginPath();
      ctx.arc(x, y, 15, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, it.frac));
      ctx.stroke();
      powerIcon(ctx, it.kind, x, y, 8, c);
      ctx.restore();
    });
  }

  private hud(g: Game, time: number): void {
    if (g.state === 'playing') this.powerBadges(g, time);
    const { ctx } = this;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = COLORS.text;
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    ctx.font = '800 30px system-ui, sans-serif';
    ctx.fillText(g.score.toLocaleString('en-US'), VIEW_W / 2, 22);
    if (g.state === 'dying' && g.stateTime > 0.6) {
      ctx.font = '700 14px system-ui, sans-serif';
      ctx.fillStyle = COLORS.dim;
      ctx.fillText(g.score >= g.best && g.score > 0 ? 'NEW BEST · TAP TO RETRY' : 'TAP TO RETRY', VIEW_W / 2, VIEW_H * 0.55);
    }
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
    ctx.fillText('Tap to flip polarity. Opposites attract.', VIEW_W / 2, 548);
    const kinds: PowerKind[] = ['boost', 'shield', 'phase'];
    kinds.forEach((k, i) => {
      const x = VIEW_W / 2 + (i - 1) * 84;
      powerIcon(ctx, k, x - 24, 586, 7, POWER_LABEL[k].color);
      ctx.fillStyle = POWER_LABEL[k].color;
      ctx.font = '800 11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(POWER_LABEL[k].name, x - 13, 587);
    });
    ctx.restore();
  }
}

/** Blink during the last POWER_WARN seconds so the player sees it ending. */
function blinkOn(left: number, time: number): boolean {
  return left > POWER_WARN || Math.floor(time * 10) % 2 === 0;
}

/** Simple vector glyphs, so every device draws them the same. */
function powerIcon(ctx: CanvasRenderingContext2D, kind: PowerKind, x: number, y: number, s: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.5, s * 0.28);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (kind === 'boost') {
    for (const oy of [-0.45, 0.25]) {
      ctx.moveTo(x - s * 0.7, y + oy * s - s * 0.3);
      ctx.lineTo(x, y + oy * s + s * 0.35);
      ctx.lineTo(x + s * 0.7, y + oy * s - s * 0.3);
    }
    ctx.stroke();
  } else if (kind === 'shield') {
    ctx.moveTo(x, y - s * 0.9);
    ctx.lineTo(x + s * 0.75, y - s * 0.55);
    ctx.quadraticCurveTo(x + s * 0.7, y + s * 0.5, x, y + s * 0.95);
    ctx.quadraticCurveTo(x - s * 0.7, y + s * 0.5, x - s * 0.75, y - s * 0.55);
    ctx.closePath();
    ctx.globalAlpha = 0.35;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
  } else {
    // A ghost: round head, wavy hem.
    const w = s * 0.75;
    ctx.moveTo(x - w, y + s * 0.8);
    ctx.lineTo(x - w, y - s * 0.1);
    ctx.arc(x, y - s * 0.1, w, Math.PI, 0);
    ctx.lineTo(x + w, y + s * 0.8);
    for (let i = 0; i < 3; i++) {
      const x0 = x + w - (i * 2 * w) / 3;
      ctx.quadraticCurveTo(x0 - w / 3, y + s * 0.4, x0 - (2 * w) / 3, y + s * 0.8);
    }
    ctx.globalAlpha = 0.35;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
    ctx.fillStyle = '#0d1222';
    ctx.beginPath();
    ctx.arc(x - w * 0.38, y - s * 0.12, s * 0.13, 0, Math.PI * 2);
    ctx.arc(x + w * 0.38, y - s * 0.12, s * 0.13, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
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
