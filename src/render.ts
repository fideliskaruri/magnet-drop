import { COLORS, JUICE, ORB_RADIUS, TRAIL_LENGTH, VIEW_H, VIEW_W } from './config.ts';
import { P_DOT, P_SHARD, P_SPARK } from './fx.ts';
import type { Fx } from './fx.ts';
import type { Game } from './game.ts';
import { altProgress, barrierY } from './gates.ts';
import { attracts, closestPoint, doorU, fieldU } from './physics.ts';
import { THEME } from './theme.ts';
import { TUNE } from './tune.ts';
import type { Magnet, PlacedGate, Polarity, Rail, Saw, Solid } from './types.ts';

const TAU = Math.PI * 2;
const GOLDEN = 2.399963;
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
  g.addColorStop(0.2, hexA(color, 0.5));
  g.addColorStop(0.5, hexA(color, 0.12));
  g.addColorStop(1, hexA(color, 0));
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  return c;
}

/** Screen-sized radial edge darkening, pre-rendered small and stretched. */
function vignetteSprite(alpha: number): Canvas {
  const w = 90;
  const h = 160;
  const { c, x } = makeCanvas(w, h);
  const r = Math.hypot(w / 2, h / 2);
  const g = x.createRadialGradient(w / 2, h / 2, r * 0.4, w / 2, h / 2, r);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${alpha})`);
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  return c;
}

const TILE_H = 240;

/** One repeating tile of riveted dark-steel wall plates. */
function plateTile(): Canvas {
  const { c, x } = makeCanvas(VIEW_W, TILE_H);
  x.fillStyle = THEME.bg;
  x.fillRect(0, 0, VIEW_W, TILE_H);
  const rows: [number, number[]][] = [
    [0, [0, 180, 360]],
    [120, [0, 90, 270, 360]],
  ];
  let alt = 0;
  for (const [y, xs] of rows) {
    for (let i = 0; i + 1 < xs.length; i++) {
      const x0 = xs[i]!;
      const x1 = xs[i + 1]!;
      const w = x1 - x0;
      x.fillStyle = alt++ % 2 === 0 ? THEME.plateA : THEME.plateB;
      x.fillRect(x0 + 1, y + 1, w - 2, 118);
      // Brushed grain, very faint.
      x.fillStyle = 'rgba(255,255,255,0.012)';
      for (let k = 0; k < 10; k++) x.fillRect(x0 + 2, y + 6 + k * 11 + ((i * 7 + k * 3) % 5), w - 4, 1);
      // Seams: dark gap, lit top-left inner edge.
      x.fillStyle = THEME.seamLight;
      x.fillRect(x0 + 1, y + 1, w - 2, 1);
      x.fillRect(x0 + 1, y + 1, 1, 118);
      x.fillStyle = THEME.seam;
      x.fillRect(x0, y, w, 1);
      x.fillRect(x0, y + 119, w, 1);
      x.fillRect(x0, y, 1, 120);
      x.fillRect(x1 - 1, y, 1, 120);
      for (const [rx, ry] of [
        [x0 + 8, y + 8],
        [x1 - 8, y + 8],
        [x0 + 8, y + 112],
        [x1 - 8, y + 112],
      ] as const) {
        x.fillStyle = THEME.seam;
        x.beginPath();
        x.arc(rx + 0.6, ry + 0.8, 2.4, 0, TAU);
        x.fill();
        x.fillStyle = THEME.rivet;
        x.beginPath();
        x.arc(rx, ry, 2.2, 0, TAU);
        x.fill();
        x.fillStyle = THEME.rivetLight;
        x.beginPath();
        x.arc(rx - 0.7, ry - 0.7, 0.9, 0, TAU);
        x.fill();
      }
    }
  }
  return c;
}

/** The orb's metal shell, without its colour core. */
function orbBodySprite(): Canvas {
  const { c, x } = makeCanvas(64, 64);
  const s = 64 / (ORB_RADIUS * 2);
  x.scale(s, s);
  const r = ORB_RADIUS;
  const g = x.createRadialGradient(r - 4, r - 4.5, 0.5, r, r, r);
  g.addColorStop(0, THEME.orbLight);
  g.addColorStop(0.55, '#9aa1ab');
  g.addColorStop(1, THEME.orbDark);
  x.fillStyle = g;
  x.beginPath();
  x.arc(r, r, r, 0, TAU);
  x.fill();
  x.strokeStyle = 'rgba(11,13,16,0.6)';
  x.lineWidth = 0.8;
  x.stroke();
  return c;
}

/** A spinning saw blade with a muted warning edge. */
function sawSprite(): Canvas {
  const size = 128;
  const { c, x } = makeCanvas(size, size);
  const R = size / 2 - 2;
  x.translate(size / 2, size / 2);
  x.beginPath();
  const teeth = 14;
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * TAU;
    const a1 = ((i + 0.55) / teeth) * TAU;
    x.lineTo(Math.cos(a0) * R * 0.8, Math.sin(a0) * R * 0.8);
    x.lineTo(Math.cos(a1) * R, Math.sin(a1) * R);
  }
  x.closePath();
  const g = x.createRadialGradient(-R * 0.3, -R * 0.3, 2, 0, 0, R);
  g.addColorStop(0, '#c4cbd4');
  g.addColorStop(1, '#5d646e');
  x.fillStyle = g;
  x.fill();
  x.strokeStyle = THEME.hazard;
  x.lineWidth = 3;
  x.stroke();
  x.fillStyle = THEME.housing;
  x.beginPath();
  x.arc(0, 0, R * 0.36, 0, TAU);
  x.fill();
  x.strokeStyle = THEME.bevel;
  x.lineWidth = 3;
  x.stroke();
  x.fillStyle = THEME.ironDark;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU;
    x.beginPath();
    x.arc(Math.cos(a) * R * 0.58, Math.sin(a) * R * 0.58, R * 0.08, 0, TAU);
    x.fill();
  }
  return c;
}

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private dpr = 1;
  private readonly glow = new Map<string, Canvas>();
  private readonly vignette: Canvas;
  private readonly tile: Canvas;
  private readonly orbBody: Canvas;
  private readonly saw: Canvas;
  private hazardPattern: CanvasPattern | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not supported in this browser.');
    this.canvas = canvas;
    this.ctx = ctx;
    for (const c of [COLORS.red, COLORS.blue, COLORS.text, COLORS.hazard]) this.glow.set(c, glowSprite(c));
    this.vignette = vignetteSprite(THEME.vignette * 2);
    this.tile = plateTile();
    this.orbBody = orbBodySprite();
    this.saw = sawSprite();
    const { c, x } = makeCanvas(16, 16);
    x.fillStyle = '#15171b';
    x.fillRect(0, 0, 16, 16);
    x.fillStyle = THEME.hazard;
    x.beginPath();
    x.moveTo(0, 16);
    x.lineTo(8, 0);
    x.lineTo(16, 0);
    x.lineTo(8, 16);
    x.closePath();
    x.fill();
    this.hazardPattern = ctx.createPattern(c, 'repeat');
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
    ctx.fillStyle = '#07080a';
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

    this.background(g, g.state === 'ready' ? time * 20 : camY);

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
      this.walls(camY);
      for (const gate of g.world.placed) {
        if (gate.top + gate.height < top || gate.top > bottom) continue;
        this.gateBack(gate, time, camY, g.state !== 'dying');
      }
      if (!fx.reduced || playing) for (const m of g.world.magnets) if (magnetVisible(m, top, bottom)) this.fieldParticles(m, g, time);
      for (const gate of g.world.placed) {
        if (gate.top + gate.height < top || gate.top > bottom) continue;
        this.gateFront(gate, g, ox, oy, time);
      }
      for (const m of g.world.magnets) if (magnetVisible(m, top, bottom)) this.magnet(m, g, ox, oy, time);
      for (const sw of g.world.saws) if (sw.y + sw.r > top && sw.y - sw.r < bottom) this.sawBlade(sw, g, ox, oy, time);
      if (playing) this.fieldStreaks(g, ox, oy, time);
      if (fx.dim > 0.01) {
        ctx.globalAlpha = fx.dim * 0.6;
        ctx.fillStyle = '#050607';
        ctx.fillRect(-200, camY - 200, VIEW_W + 400, VIEW_H + 400);
        ctx.globalAlpha = 1;
      }
      this.trail(g, heat);
      this.ghosts(fx);
      // Pulses and particles go under the orb so it always stays visible.
      this.effects(fx);
      if (!(g.state === 'dying' && g.exploded)) {
        this.speedLines(fx, ox, oy, colorOf(g.orb.polarity));
        this.orb(ox, oy, g.orb.polarity, g.orb.stuck !== null, time, fx, g.orb.vx, g.orb.vy);
      }
      this.popups(fx);
      ctx.restore();
    }

    this.overlays(g, oy - camY, time);
    ctx.restore();

    if (g.state === 'ready') this.menu(g, time);
    else this.hud(g);
  }

  private background(g: Game, scroll: number): void {
    const { ctx } = this;
    const fx = g.fx;
    const off = -(((scroll % TILE_H) + TILE_H) % TILE_H);
    for (let y = off; y < VIEW_H; y += TILE_H) ctx.drawImage(this.tile, 0, y);

    // Milestone number, huge and hollow, stamped faintly behind the playfield.
    if (fx.milestoneAge < 1.2 && fx.milestoneText) {
      const t = fx.milestoneAge / 1.2;
      const sc = 1.15 - 0.15 * easeOut(Math.min(1, t * 3));
      ctx.save();
      ctx.translate(VIEW_W / 2, VIEW_H * 0.42);
      ctx.scale(sc, sc);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '900 110px system-ui, sans-serif';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.22 * (1 - t);
      ctx.strokeStyle = COLORS.text;
      ctx.strokeText(fx.milestoneText, 0, 0);
      ctx.restore();
    }
  }

  /** The machine's side frame, which the orb bounces off. */
  private walls(camY: number): void {
    const { ctx } = this;
    const y0 = camY - 200;
    const h = VIEW_H + 400;
    ctx.fillStyle = THEME.housing;
    ctx.fillRect(-60, y0, 64, h);
    ctx.fillRect(VIEW_W - 4, y0, 64, h);
    ctx.fillStyle = THEME.bevel;
    ctx.fillRect(3, y0, 1, h);
    ctx.fillRect(VIEW_W - 4, y0, 1, h);
  }

  /** Tracks and hint text, drawn under the field particles. */
  private gateBack(gate: PlacedGate, time: number, camY: number, showHint: boolean): void {
    const { ctx } = this;
    const m = gate.machine;
    if (m.type === 'slab') {
      const x0 = m.x0 - m.w / 2 - 6;
      const x1 = m.x1 + m.w / 2 + 6;
      ctx.fillStyle = THEME.seam;
      ctx.fillRect(x0, m.y - 3, x1 - x0, 6);
      ctx.fillStyle = THEME.seamLight;
      ctx.fillRect(x0, m.y - 3, x1 - x0, 1);
      ctx.fillStyle = THEME.rivet;
      for (let x = x0 + 6; x < x1; x += 18) ctx.fillRect(x, m.y - 1, 2, 2);
    }
    for (const sw of gate.saws) {
      if (sw.period <= 0) continue;
      ctx.strokeStyle = THEME.seam;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sw.ax, sw.ay);
      ctx.lineTo(sw.bx, sw.by);
      ctx.stroke();
      ctx.strokeStyle = hexA(THEME.hazard, 0.25);
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (gate.hint && showHint) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '800 12px system-ui, sans-serif';
      const y = gate.top - 18;
      // Fade out as it scrolls up toward the score.
      const fade = Math.max(0, Math.min(1, (y - camY - 70) / 60));
      const w = ctx.measureText(gate.hint).width + 22;
      ctx.globalAlpha = fade;
      ctx.fillStyle = 'rgba(11,13,16,0.75)';
      ctx.fillRect(VIEW_W / 2 - w / 2, y - 11, w, 22);
      ctx.strokeStyle = THEME.bevel;
      ctx.lineWidth = 1;
      ctx.strokeRect(VIEW_W / 2 - w / 2 + 0.5, y - 10.5, w - 1, 21);
      ctx.fillStyle = COLORS.text;
      ctx.globalAlpha = (0.75 + 0.25 * Math.sin(time * 3)) * fade;
      ctx.fillText(gate.hint, VIEW_W / 2, y + 0.5);
      ctx.globalAlpha = 1;
    }
    if (TUNE.showZones) {
      // Clean-pass bands on each opening.
      const b = barrierY(gate);
      ctx.fillStyle = hexA(COLORS.text, 0.12);
      for (const l of gate.lanes) {
        const c = (l.x0 + l.x1) / 2;
        const q = (l.x1 - l.x0) / 4;
        ctx.fillRect(c - q, b - 2, q * 2, 4);
      }
    }
  }

  /** Doors, arms, steel shelves, iron slabs and the alternating warning lights. */
  private gateFront(gate: PlacedGate, g: Game, ox: number, oy: number, time: number): void {
    const playing = g.state === 'playing';
    for (const sd of gate.solids) {
      if (sd.kind === 'steel') this.steel(sd);
      else if (sd.kind === 'slab') this.slab(sd);
      else if (sd.kind === 'arm') this.arm(sd);
      else this.door(sd, g, ox, oy, time, playing);
    }
    const m = gate.machine;
    if (m.type === 'iris') {
      for (const hx of [m.lx, m.rx]) this.bolt(hx, m.y, 6);
    } else if (m.type === 'alt') {
      const p = altProgress(gate, g.runTime);
      const warn = p > 0.65;
      const blink = g.fx.reduced ? true : Math.floor(time * 8) % 2 === 0;
      for (const idx of m.doors) {
        const d = gate.solids[idx];
        if (!d || d.polarity === null) continue;
        const cx = (d.ax + d.bx) / 2;
        const cy = Math.min(d.ay, d.by) - d.r - 10;
        const next = otherColor(d.polarity);
        // Progress needle toward the next swap.
        this.ctx.strokeStyle = THEME.seam;
        this.ctx.lineWidth = 3;
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, 7, 0, TAU);
        this.ctx.stroke();
        this.ctx.strokeStyle = next;
        this.ctx.globalAlpha = 0.8;
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, 7, -Math.PI / 2, -Math.PI / 2 + p * TAU);
        this.ctx.stroke();
        this.ctx.globalAlpha = 1;
        this.lamp(cx, cy, warn && blink ? next : colorOf(d.polarity), warn ? 0.9 : 0.5);
      }
    }
  }

  private capsule(s: Solid, width: number, color: string): void {
    const { ctx } = this;
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(s.ax, s.ay);
    ctx.lineTo(s.bx, s.by);
    ctx.stroke();
  }

  /** Lit top edge of a capsule. */
  private bevelLine(s: Solid, offset: number, color: string, alpha: number): void {
    const { ctx } = this;
    const dx = s.bx - s.ax;
    const dy = s.by - s.ay;
    const L = Math.hypot(dx, dy) || 1;
    let nx = -dy / L;
    let ny = dx / L;
    if (ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.ax + nx * offset, s.ay + ny * offset);
    ctx.lineTo(s.bx + nx * offset, s.by + ny * offset);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private steel(s: Solid): void {
    this.capsule(s, s.r * 2 + 2, THEME.seam);
    this.capsule(s, s.r * 2, THEME.ironDark);
    this.capsule(s, s.r * 2 - 3, THEME.iron);
    this.bevelLine(s, s.r * 0.45, COLORS.steel, 0.35);
  }

  private bolt(x: number, y: number, r: number): void {
    const { ctx } = this;
    ctx.fillStyle = THEME.housing;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = THEME.bevel;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = THEME.rivetLight;
    ctx.beginPath();
    ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.3, 0, TAU);
    ctx.fill();
  }

  private lamp(x: number, y: number, color: string, k: number): void {
    const { ctx } = this;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.35 * k;
    ctx.drawImage(this.glow.get(color)!, x - 14, y - 14, 28, 28);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = THEME.housing;
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.5 + 0.5 * k;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /** Heavy neutral iron block. */
  private slab(s: Solid): void {
    const { ctx } = this;
    const x0 = Math.min(s.ax, s.bx) - s.r;
    const x1 = Math.max(s.ax, s.bx) + s.r;
    const y0 = s.ay - s.r;
    const h = s.r * 2;
    ctx.fillStyle = THEME.seam;
    ctx.fillRect(x0 - 1, y0 - 1, x1 - x0 + 2, h + 2);
    ctx.fillStyle = THEME.ironDark;
    ctx.fillRect(x0, y0, x1 - x0, h);
    ctx.fillStyle = THEME.iron;
    ctx.fillRect(x0 + 2, y0 + 2, x1 - x0 - 4, h - 4);
    ctx.fillStyle = hexA(COLORS.steel, 0.35);
    ctx.fillRect(x0 + 2, y0 + 2, x1 - x0 - 4, 1);
    // Cross-hatched weight plate and rivets.
    ctx.strokeStyle = THEME.ironDark;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0 + 8; x < x1 - 4; x += 8) {
      ctx.moveTo(x, y0 + 4);
      ctx.lineTo(x - 4, y0 + h - 4);
    }
    ctx.stroke();
    for (const rx of [x0 + 5, x1 - 5]) {
      ctx.fillStyle = THEME.rivetLight;
      ctx.beginPath();
      ctx.arc(rx, s.ay, 1.6, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = THEME.dim;
    ctx.font = '800 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FE', (x0 + x1) / 2, s.ay + 0.5);
  }

  /** Iris arm: an iron blade with a core stripe in the iris colour. */
  private arm(s: Solid): void {
    this.capsule(s, s.r * 2 + 2, THEME.seam);
    this.capsule(s, s.r * 2, THEME.housing);
    this.bevelLine(s, s.r * 0.5, THEME.bevel, 0.9);
    if (s.polarity) {
      const c = colorOf(s.polarity);
      this.ctx.globalAlpha = 0.85;
      this.capsule(s, Math.max(2, s.r * 0.5), c);
      this.ctx.globalAlpha = 1;
    }
  }

  /**
   * Magnetic shutter. Same colour as the orb: a solid bar that pushes you off.
   * Opposite colour: an open energy curtain that pulls you through, with chevrons flowing down.
   */
  private door(s: Solid, g: Game, ox: number, oy: number, time: number, playing: boolean): void {
    const { ctx } = this;
    if (!s.polarity) return;
    const c = colorOf(s.polarity);
    const open = playing && attracts(g.orb.polarity, s.polarity);
    const near = playing ? doorU(s, ox, oy).u : 0;
    if (open) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.12 + 0.25 * near;
      this.capsule(s, s.r * 2 + 8, c);
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 2;
      ctx.strokeStyle = c;
      ctx.setLineDash([3, 5]);
      ctx.lineDashOffset = -time * 20;
      ctx.beginPath();
      ctx.moveTo(s.ax, s.ay);
      ctx.lineTo(s.bx, s.by);
      ctx.stroke();
      ctx.setLineDash([]);
      // Chevrons pointing down: this way through.
      const L = Math.hypot(s.bx - s.ax, s.by - s.ay);
      const n = Math.max(1, Math.floor(L / 22));
      const f = (time * 1.2) % 1;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const k = (i + 0.5) / n;
        const x = s.ax + (s.bx - s.ax) * k;
        const y = s.ay + (s.by - s.ay) * k - 6 + f * 8;
        ctx.moveTo(x - 4, y - 3);
        ctx.lineTo(x, y + 1);
        ctx.lineTo(x + 4, y - 3);
      }
      ctx.globalAlpha = 0.5 * (1 - Math.abs(f - 0.5) * 2) + 0.15;
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    } else {
      this.capsule(s, s.r * 2 + 2, THEME.seam);
      this.capsule(s, s.r * 2, THEME.housing);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.18 + 0.3 * near;
      this.capsule(s, s.r * 2 + 6, c);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.9;
      this.capsule(s, Math.max(2, s.r * 0.8), c);
      ctx.globalAlpha = 1;
      this.bevelLine(s, s.r * 0.7, THEME.bevel, 0.9);
    }
    // Housing caps at both ends.
    this.bolt(s.ax, s.ay, s.r + 2);
    this.bolt(s.bx, s.by, s.r + 2);
  }

  /** Field particles drifting along the field lines: inward if the magnet pulls you, outward if it pushes. */
  private fieldParticles(m: Magnet, g: Game, time: number): void {
    const { ctx } = this;
    const c = colorOf(m.polarity);
    const pull = g.state !== 'playing' || attracts(g.orb.polarity, m.polarity);
    const rate = g.fx.reduced ? 0.12 : 0.35;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = c;
    if (m.kind === 'point') {
      const span = Math.max(8, m.reach - m.r - 4);
      for (let i = 0; i < 12; i++) {
        let f = (time * rate + i * 0.3819) % 1;
        if (pull) f = 1 - f;
        const a = i * GOLDEN + Math.floor(time * rate + i * 0.3819) * 1.1;
        const rr = m.r + 4 + f * span;
        const x = m.x + Math.cos(a) * rr;
        const y = m.y + Math.sin(a) * rr;
        ctx.globalAlpha = 0.28 * Math.sin(Math.PI * f);
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
    } else {
      const dx = m.bx - m.ax;
      const dy = m.by - m.ay;
      const L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L;
      const ny = dx / L;
      const n = Math.min(16, Math.max(6, Math.round(L / 14)));
      const span = Math.max(8, m.reach);
      for (let i = 0; i < n; i++) {
        let f = (time * rate + i * 0.618) % 1;
        if (pull) f = 1 - f;
        const k = ((i * 0.618 + Math.floor(time * rate + i * 0.618) * 0.37) % 1 + 1) % 1;
        const side = i % 2 === 0 ? 1 : -1;
        const d = m.r + 3 + f * span;
        const x = m.ax + dx * k + nx * d * side;
        const y = m.ay + dy * k + ny * d * side;
        ctx.globalAlpha = 0.24 * Math.sin(Math.PI * f);
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (TUNE.showZones) this.zone(m, c);
  }

  private zone(m: Magnet, c: string): void {
    const { ctx } = this;
    ctx.strokeStyle = c;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 6]);
    ctx.beginPath();
    if (m.kind === 'point') ctx.arc(m.x, m.y, m.reach, 0, TAU);
    else this.railOutlinePath(m, m.r + m.reach);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  private railOutlinePath(m: Rail, zone: number): void {
    const a = Math.atan2(m.by - m.ay, m.bx - m.ax);
    this.ctx.arc(m.ax, m.ay, zone, a + Math.PI / 2, a + (3 * Math.PI) / 2);
    this.ctx.arc(m.bx, m.by, zone, a - Math.PI / 2, a + Math.PI / 2);
    this.ctx.closePath();
  }

  /** Iron housing with a glowing core. Flippers carry an arrow showing which way they kick. */
  private magnet(m: Magnet, g: Game, ox: number, oy: number, time: number): void {
    const { ctx } = this;
    const fx = g.fx;
    const c = colorOf(m.polarity);
    const held = g.orb.stuck?.magnet === m;
    const pulls = attracts(g.orb.polarity, m.polarity);
    const { cx, cy } = closestPoint(m, ox, oy);
    const u = g.state === 'playing' ? fieldU(m, Math.hypot(cx - ox, cy - oy)) : 0;
    const hot = Math.min(1, 0.35 + 0.08 * fx.beat + 0.4 * u + (held ? 0.3 : 0));

    if (m.kind === 'point') {
      const R = m.r + 3;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = hot * 0.45;
      const gr = m.r * 2.6;
      ctx.drawImage(this.glow.get(c)!, m.x - gr, m.y - gr, gr * 2, gr * 2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = THEME.seam;
      ctx.beginPath();
      ctx.arc(m.x + 1, m.y + 1.5, R + 1, 0, TAU);
      ctx.fill();
      ctx.fillStyle = THEME.housing;
      ctx.beginPath();
      ctx.arc(m.x, m.y, R, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = THEME.bevel;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(m.x, m.y, R - 1, Math.PI * 0.95, Math.PI * 1.95);
      ctx.stroke();
      // Coil ring.
      ctx.fillStyle = '#121519';
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r * 0.66, 0, TAU);
      ctx.fill();
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i * Math.PI) / 2;
        ctx.fillStyle = THEME.rivetLight;
        ctx.beginPath();
        ctx.arc(m.x + Math.cos(a) * (R - 3.5), m.y + Math.sin(a) * (R - 3.5), 1.3, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = c;
      ctx.globalAlpha = 0.75 + 0.25 * hot;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r * (0.42 + 0.03 * Math.sin(time * 5) + (held ? 0.06 : 0)), 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#121519';
      ctx.font = `900 ${Math.round(m.r * 0.6)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(m.polarity === 'red' ? '+' : '−', m.x, m.y + 0.5);
    } else {
      const seg = { ax: m.ax, ay: m.ay, bx: m.bx, by: m.by, r: m.r } as Solid;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = hot * 0.22;
      this.capsule(seg, m.r * 2 + 12, c);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      this.capsule(seg, m.r * 2 + 6, THEME.seam);
      this.capsule(seg, m.r * 2 + 4, THEME.housing);
      this.bevelLine(seg, m.r + 1, THEME.bevel, 1);
      ctx.globalAlpha = 0.75 + 0.25 * hot;
      this.capsule(seg, Math.max(2.5, m.r * 0.9), c);
      ctx.globalAlpha = 1;
      // Coil bands along the rail.
      const L = Math.hypot(m.bx - m.ax, m.by - m.ay);
      const n = Math.floor(L / 12);
      ctx.strokeStyle = '#121519';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const nx = -(m.by - m.ay) / (L || 1);
      const ny = (m.bx - m.ax) / (L || 1);
      for (let i = 1; i < n; i++) {
        const k = i / n;
        const x = m.ax + (m.bx - m.ax) * k;
        const y = m.ay + (m.by - m.ay) * k;
        ctx.moveTo(x - nx * m.r * 0.5, y - ny * m.r * 0.5);
        ctx.lineTo(x + nx * m.r * 0.5, y + ny * m.r * 0.5);
      }
      ctx.stroke();
      if (m.kick) {
        this.bolt(m.ax, m.ay, m.r + 3);
        // Kick arrow beside the paddle.
        const mx = (m.ax + m.bx) / 2 + m.kick.x * (m.r + 12);
        const my = (m.ay + m.by) / 2 + m.kick.y * (m.r + 12);
        const kx = m.kick.x;
        const ky = m.kick.y;
        ctx.strokeStyle = c;
        ctx.globalAlpha = 0.45 + 0.4 * hot;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(mx - kx * 6, my - ky * 6);
        ctx.lineTo(mx + kx * 6, my + ky * 6);
        ctx.moveTo(mx + kx * 6 - (kx * 4 - ky * 4), my + ky * 6 - (ky * 4 + kx * 4));
        ctx.lineTo(mx + kx * 6, my + ky * 6);
        ctx.lineTo(mx + kx * 6 - (kx * 4 + ky * 4), my + ky * 6 - (ky * 4 - kx * 4));
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        this.bolt(m.ax, m.ay, m.r + 2);
        this.bolt(m.bx, m.by, m.r + 2);
      }
    }

    // Flip cue: every magnet that now pulls you rings once, softly.
    if (fx.flipCue > 0 && pulls && u > 0) {
      const t = 1 - fx.flipCue;
      ctx.globalAlpha = fx.flipCue * 0.6;
      ctx.strokeStyle = c;
      ctx.lineWidth = 1.5;
      if (m.kind === 'point') {
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r + 6 + t * 16, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  private sawBlade(sw: Saw, g: Game, ox: number, oy: number, time: number): void {
    const { ctx } = this;
    const gap = Math.hypot(sw.x - ox, sw.y - oy) - sw.r - ORB_RADIUS;
    const danger = g.state === 'playing' ? Math.max(0, 1 - gap / 60) : 0;
    const killer = g.deathSaw === sw;
    if (danger > 0 || killer) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = killer ? 0.7 : 0.35 * danger;
      const gr = sw.r * 2.2;
      ctx.drawImage(this.glow.get(COLORS.hazard)!, sw.x - gr, sw.y - gr, gr * 2, gr * 2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    ctx.save();
    ctx.translate(sw.x, sw.y);
    ctx.rotate(time * (g.fx.reduced ? 3 : 11));
    ctx.drawImage(this.saw, -sw.r, -sw.r, sw.r * 2, sw.r * 2);
    ctx.restore();
  }

  /** Directional streaks from orb to magnet when a field is strong. */
  private fieldStreaks(g: Game, ox: number, oy: number, time: number): void {
    const { ctx } = this;
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'lighter';
    for (const m of g.world.magnets) {
      const { cx, cy } = closestPoint(m, ox, oy);
      const dx = cx - ox;
      const dy = cy - oy;
      const d = Math.hypot(dx, dy);
      const u = fieldU(m, d);
      if (u < 0.35 || d < 1) continue;
      const k = (u - 0.35) / 0.65;
      const ux = dx / d;
      const uy = dy / d;
      const px = -uy;
      const py = ux;
      const pull = attracts(g.orb.polarity, m.polarity);
      const span = d - m.r - ORB_RADIUS;
      if (span <= 4) continue;
      ctx.strokeStyle = colorOf(m.polarity);
      ctx.globalAlpha = 0.15 + 0.35 * k;
      ctx.lineWidth = 1 + k;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        let f = (time * (0.8 + u * 1.4) + i / 3) % 1;
        if (!pull) f = 1 - f;
        const along = ORB_RADIUS + 2 + f * span;
        const lateral = (i - 1) * 6 * (1 - f * 0.6);
        const len = 4 + k * 12;
        const sx = ox + ux * along + px * lateral;
        const sy = oy + uy * along + py * lateral;
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + ux * len * (pull ? 1 : -1), sy + uy * len * (pull ? 1 : -1));
      }
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
    // Stretches (wider, brighter) right after a launch.
    const stretch = fx.streakTime > 0 ? 0.4 : 0;
    for (let i = 1; i < n; i++) {
      const k = (start + i) % TRAIL_LENGTH;
      const x = fx.trailX[k]!;
      const y = fx.trailY[k]!;
      const a = i / n;
      ctx.globalAlpha = a * (0.28 + 0.1 * heat + stretch * 0.5);
      ctx.lineWidth = ORB_RADIUS * (1.1 + stretch) * a;
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
      ctx.globalAlpha = 0.3 * (1 - t);
      ctx.strokeStyle = gh.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(gh.x, gh.y, ORB_RADIUS * (1 - 0.3 * t), 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Short speed streaks behind the orb right after a launch. */
  private speedLines(fx: Fx, ox: number, oy: number, color: string): void {
    if (fx.streakTime <= 0) return;
    const { ctx } = this;
    const k = Math.min(1, fx.streakTime / 0.3);
    const dx = fx.streakDx;
    const dy = fx.streakDy;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const lat = (i - 2) * 6;
      const startBack = ORB_RADIUS + 4 + (i % 3) * 6;
      const len = (24 + ((i * 37) % 5) * 10) * k;
      const sx = ox - dx * startBack - dy * lat;
      const sy = oy - dy * startBack + dx * lat;
      ctx.strokeStyle = i % 2 ? COLORS.steel : color;
      ctx.globalAlpha = 0.45 * k;
      ctx.lineWidth = i === 2 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - dx * len, sy - dy * len);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  private orb(x: number, y: number, p: Polarity, stuck: boolean, time: number, fx: Fx, vx: number, vy: number): void {
    const { ctx } = this;
    const c = colorOf(p);
    const pop = fx.orbPop;

    // Core glow, kept small: the orb is metal, the core is the only neon.
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, 0.32 + 0.25 * pop + (stuck ? 0.15 : 0));
    const gr = ORB_RADIUS * (2.4 + 0.8 * pop);
    ctx.drawImage(this.glow.get(c)!, x - gr, y - gr, gr * 2, gr * 2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.translate(x, y);
    if (fx.squashAge < 0.4 && fx.squash > 0) {
      const q = fx.squash * Math.exp(-fx.squashAge * 9) * Math.cos(fx.squashAge * 36);
      const a = Math.atan2(fx.squashNy, fx.squashNx);
      ctx.rotate(a);
      ctx.scale(1 - q, 1 + q * 0.7);
      ctx.rotate(-a);
    } else if (!stuck) {
      const sp = Math.hypot(vx, vy);
      const k = Math.min(0.25, sp / 2600);
      if (k > 0.02) {
        const a = Math.atan2(vy, vx);
        ctx.rotate(a);
        ctx.scale(1 + k, 1 / (1 + k));
        ctx.rotate(-a);
      }
    }
    const sc = 1 + pop * 0.18;
    ctx.scale(sc, sc);

    const R = ORB_RADIUS;
    ctx.drawImage(this.orbBody, -R, -R, R * 2, R * 2);
    if (fx.orbWhite > 0) {
      ctx.fillStyle = COLORS.text;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // Recessed socket and glowing core.
    ctx.fillStyle = '#20252c';
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.56, 0, TAU);
    ctx.fill();
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(0, 0, R * (0.4 + (stuck ? 0.05 * Math.sin(time * 20) : 0) + 0.08 * pop), 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.arc(-R * 0.12, -R * 0.12, R * 0.12, 0, TAU);
    ctx.fill();
    ctx.restore();

    // Wind-up ring while stuck, in the colour a tap would switch to.
    if (stuck) {
      const t = Math.min(1, fx.squashAge / 0.35);
      ctx.strokeStyle = otherColor(p);
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.75;
      ctx.lineCap = 'round';
      const a0 = time * 7;
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
      ctx.globalAlpha = (1 - t) * 0.8;
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
        ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
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
      const sc = p.age < 0.1 ? 1.3 - (p.age / 0.1) * 0.3 : 1;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(sc, sc);
      ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      ctx.font = `800 ${p.size}px system-ui, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = THEME.bg;
      ctx.strokeText(p.text, 0, 0);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
    }
  }

  /** Screen-space layers: vignette, the machine's crusher edge at the top, and flash. */
  private overlays(g: Game, orbScreenY: number, time: number): void {
    const { ctx } = this;
    const fx = g.fx;
    ctx.globalAlpha = 1;
    ctx.drawImage(this.vignette, 0, 0, VIEW_W, VIEW_H);
    if (g.state !== 'ready') {
      // The top edge is the machine closing in. It warns louder as you fall behind.
      const d = g.state === 'playing' ? Math.max(0, Math.min(1, 1 - orbScreenY / JUICE.dangerZone)) : 0;
      const caught = g.state === 'dying' && g.deathCause === 'camera';
      const k = caught ? 1 : d;
      const throb = fx.reduced ? 1 : 0.75 + 0.25 * Math.sin(time * 12);
      if (k > 0) {
        const grad = ctx.createLinearGradient(0, 0, 0, 70 + 50 * k);
        grad.addColorStop(0, hexA(THEME.hazard, 0.4 * k * throb));
        grad.addColorStop(1, hexA(THEME.hazard, 0));
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, VIEW_W, 70 + 50 * k);
      }
      ctx.fillStyle = THEME.housing;
      ctx.fillRect(0, 0, VIEW_W, 9);
      if (this.hazardPattern) {
        ctx.save();
        ctx.globalAlpha = 0.35 + 0.6 * k;
        ctx.translate(fx.reduced ? 0 : -((time * 12) % 16), 0);
        ctx.fillStyle = this.hazardPattern;
        ctx.fillRect(0, 1, VIEW_W + 16, 6);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = THEME.bevel;
      ctx.fillRect(0, 8, VIEW_W, 1);
    }
    const fa = fx.flashAlpha();
    if (fa > 0.003) {
      ctx.globalAlpha = fa;
      ctx.fillStyle = fx.flashColor;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    ctx.globalAlpha = 1;
  }

  private shadowText(text: string, x: number, y: number, fill: string): void {
    const { ctx } = this;
    ctx.fillStyle = '#000000';
    ctx.globalAlpha = 0.55;
    ctx.fillText(text, x + 1, y + 2);
    ctx.globalAlpha = 1;
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
  }

  private hud(g: Game): void {
    const { ctx } = this;
    const fx = g.fx;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const pop = easeOut(fx.scorePop);
    ctx.translate(VIEW_W / 2, 42);
    ctx.scale(1 + pop * 0.25, 1 + pop * 0.25);
    ctx.font = '800 32px system-ui, sans-serif';
    this.shadowText(g.score.toLocaleString('en-US'), 0, 0, COLORS.text);
    ctx.restore();
    if (g.state === 'playing' && g.combo >= 2) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '800 12px system-ui, sans-serif';
      ctx.globalAlpha = 0.85;
      this.shadowText(`CLEAN ×${g.combo}`, VIEW_W / 2, 68, COLORS.text);
      ctx.restore();
    }

    if (g.state === 'dying' && g.stateTime > 0.25) {
      const t = Math.min(1, (g.stateTime - 0.25) / 0.12);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.translate(VIEW_W / 2, VIEW_H * 0.55);
      const sc = 1.2 - 0.2 * easeOut(t);
      ctx.scale(sc, sc);
      ctx.globalAlpha = t;
      const best = g.score >= g.best && g.score > 0;
      ctx.font = '900 34px system-ui, sans-serif';
      const label = best ? 'NEW BEST' : g.deathCause === 'camera' ? 'CAUGHT' : 'WRECKED';
      this.shadowText(label, 0, -20, best ? COLORS.hazard : COLORS.text);
      ctx.font = '700 13px system-ui, sans-serif';
      ctx.fillStyle = COLORS.dim;
      ctx.fillText(g.deathCause === 'camera' ? 'The machine caught you. Keep falling.' : 'Saw blade. Wait for it to pass.', 0, 10);
      ctx.fillText(`${g.cleared} ${g.cleared === 1 ? 'gate' : 'gates'} · best ${g.best}`, 0, 30);
      ctx.fillStyle = COLORS.text;
      ctx.font = '800 14px system-ui, sans-serif';
      ctx.fillText('TAP TO RETRY', 0, 58);
      ctx.restore();
    }
  }

  private menu(g: Game, time: number): void {
    const { ctx } = this;
    const fx = g.fx;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(11,13,16,0.55)';
    ctx.fillRect(30, 110, VIEW_W - 60, 210);
    ctx.strokeStyle = THEME.bevel;
    ctx.lineWidth = 1;
    ctx.strokeRect(30.5, 110.5, VIEW_W - 61, 209);
    ctx.font = '900 46px system-ui, sans-serif';
    this.shadowText('MAGNET', VIEW_W / 2, 150, COLORS.text);
    this.shadowText('DROP', VIEW_W / 2, 196, COLORS.text);
    ctx.fillStyle = COLORS.hazard;
    ctx.font = '800 12px system-ui, sans-serif';
    ctx.fillText('PROTOTYPE A · DROP', VIEW_W / 2, 234);
    ctx.fillStyle = COLORS.dim;
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.fillText('BEST', VIEW_W / 2, 264);
    ctx.fillStyle = COLORS.text;
    ctx.font = '800 26px system-ui, sans-serif';
    ctx.fillText(g.best.toLocaleString('en-US'), VIEW_W / 2, 292);
    const pol: Polarity = Math.floor(time * 1.25) % 2 === 0 ? 'blue' : 'red';
    this.orb(VIEW_W / 2, 400 + Math.sin(time * 3) * 5, pol, false, time, fx, 0, 0);
    ctx.globalAlpha = 0.55 + 0.45 * Math.sin(time * 4);
    ctx.fillStyle = COLORS.text;
    ctx.font = '800 18px system-ui, sans-serif';
    ctx.fillText('TAP', VIEW_W / 2, 446);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(11,13,16,0.6)';
    ctx.fillRect(20, 516, VIEW_W - 40, 96);
    ctx.fillStyle = COLORS.dim;
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillText('Tap to flip polarity. Opposites attract, same colours push.', VIEW_W / 2, 534);
    ctx.fillText('Drop through the gates. A clean centre pass is a bonus.', VIEW_W / 2, 554);
    ctx.fillText('Keep falling: the machine above will catch you.', VIEW_W / 2, 574);
    ctx.fillText('Press T or the gear to tune and see stats.', VIEW_W / 2, 594);
    ctx.restore();
  }
}

function magnetVisible(m: Magnet, top: number, bottom: number): boolean {
  if (m.kind === 'point') return m.y + m.reach > top && m.y - m.reach < bottom;
  const z = m.r + m.reach;
  return Math.max(m.ay, m.by) + z > top && Math.min(m.ay, m.by) - z < bottom;
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}
