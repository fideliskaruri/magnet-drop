import { ORB_RADIUS, SPIKE_FORGIVENESS, VIEW_W } from './config.ts';
import { TUNE } from './tune.ts';
import type { Magnet, Orb, Polarity, SpikeRow } from './types.ts';

export type StepEvent = 'none' | 'stick' | 'bounce' | 'wall' | 'dead';

export function attracts(orb: Polarity, magnet: Polarity): boolean {
  return orb !== magnet;
}

/** Closest point on the magnet's core (centre for points, segment for rails). */
export function closestPoint(m: Magnet, x: number, y: number): { cx: number; cy: number } {
  if (m.kind === 'point') return { cx: m.x, cy: m.y };
  const dx = m.bx - m.ax;
  const dy = m.by - m.ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - m.ax) * dx + (y - m.ay) * dy) / len2));
  return { cx: m.ax + dx * t, cy: m.ay + dy * t };
}

/** 0..1 field intensity at distance d from the core, before squaring. */
export function fieldU(m: Magnet, d: number): number {
  const u = m.kind === 'point' ? 1 - d / m.reach : 1 - (d - m.r) / m.reach;
  return Math.max(0, Math.min(1, u));
}

export function flip(orb: Orb): boolean {
  orb.polarity = orb.polarity === 'red' ? 'blue' : 'red';
  const s = orb.stuck;
  if (!s || attracts(orb.polarity, s.magnet.polarity)) return false;
  // Keep the tangential slide, replace the normal part with the launch.
  const vt = orb.vx * -s.ny + orb.vy * s.nx;
  orb.vx = -s.ny * vt + s.nx * TUNE.launchSpeed;
  orb.vy = s.nx * vt + s.ny * TUNE.launchSpeed;
  orb.stuck = null;
  return true;
}

export function step(orb: Orb, magnets: readonly Magnet[], spikes: readonly SpikeRow[], dt: number): StepEvent {
  orb.prevX = orb.x;
  orb.prevY = orb.y;
  let event: StepEvent = 'none';

  if (orb.stuck) {
    stepStuck(orb, dt);
  } else {
    let ax = 0;
    let ay = TUNE.gravity;
    for (const m of magnets) {
      const { cx, cy } = closestPoint(m, orb.x, orb.y);
      const dx = cx - orb.x;
      const dy = cy - orb.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-6) continue;
      const u = fieldU(m, d);
      if (u <= 0) continue;
      const k = (m.kind === 'point' ? TUNE.pointStrength : TUNE.railStrength) * u;
      const s = attracts(orb.polarity, m.polarity) ? 1 : -TUNE.repelScale;
      ax += (s * k * dx) / d;
      ay += (s * k * dy) / d;
    }
    orb.vx += ax * dt;
    orb.vy += ay * dt;
    orb.vx *= Math.exp(-TUNE.airDamping * dt);
    if (orb.vy > TUNE.terminalFall) orb.vy -= (orb.vy - TUNE.terminalFall) * Math.min(1, 3 * dt);
    const sp = Math.hypot(orb.vx, orb.vy);
    if (sp > TUNE.maxSpeed) {
      orb.vx *= TUNE.maxSpeed / sp;
      orb.vy *= TUNE.maxSpeed / sp;
    }
    orb.x += orb.vx * dt;
    orb.y += orb.vy * dt;

    for (const m of magnets) {
      const { cx, cy } = closestPoint(m, orb.x, orb.y);
      let nx = orb.x - cx;
      let ny = orb.y - cy;
      const d = Math.hypot(nx, ny);
      const minD = m.r + ORB_RADIUS;
      if (d >= minD) continue;
      if (d < 1e-6) {
        nx = 0;
        ny = -1;
      } else {
        nx /= d;
        ny /= d;
      }
      orb.x = cx + nx * minD;
      orb.y = cy + ny * minD;
      const vn = orb.vx * nx + orb.vy * ny;
      if (attracts(orb.polarity, m.polarity)) {
        orb.vx -= vn * nx;
        orb.vy -= vn * ny;
        orb.stuck = { magnet: m, nx, ny };
        event = 'stick';
        break;
      }
      if (vn < 0) {
        orb.vx -= (1 + TUNE.repelBounce) * vn * nx;
        orb.vy -= (1 + TUNE.repelBounce) * vn * ny;
        event = 'bounce';
      }
    }
  }

  if (orb.x < ORB_RADIUS) {
    orb.x = ORB_RADIUS;
    if (orb.vx < 0) {
      orb.vx = -orb.vx * TUNE.wallBounce;
      if (event === 'none') event = 'wall';
    }
  } else if (orb.x > VIEW_W - ORB_RADIUS) {
    orb.x = VIEW_W - ORB_RADIUS;
    if (orb.vx > 0) {
      orb.vx = -orb.vx * TUNE.wallBounce;
      if (event === 'none') event = 'wall';
    }
  }

  for (const row of spikes) {
    if (hitsSpikes(row, orb.x, orb.y, ORB_RADIUS - SPIKE_FORGIVENESS)) return 'dead';
  }
  return event;
}

/** Whether the orb overlaps any spike row, using the same forgiving hitbox as `step`. */
export function touchingSpikes(orb: Orb, spikes: readonly SpikeRow[]): boolean {
  return spikes.some((row) => hitsSpikes(row, orb.x, orb.y, ORB_RADIUS - SPIKE_FORGIVENESS));
}

/** Held against an attracting magnet: slide along its surface under gravity. */
function stepStuck(orb: Orb, dt: number): void {
  const s = orb.stuck!;
  const m = s.magnet;
  // Perched exactly on top is a perfect balance that never resolves; tip it over.
  if (s.ny < -0.999) orb.vx += (orb.x >= closestPoint(m, orb.x, orb.y).cx ? 30 : -30) * dt;
  orb.vy += TUNE.gravity * dt;
  let vn = orb.vx * s.nx + orb.vy * s.ny;
  if (vn < 0) vn = 0;
  orb.vx -= vn * s.nx;
  orb.vy -= vn * s.ny;
  const damp = Math.exp(-1.5 * dt);
  orb.vx *= damp;
  orb.vy *= damp;
  orb.x += orb.vx * dt;
  orb.y += orb.vy * dt;

  const { cx, cy } = closestPoint(m, orb.x, orb.y);
  let nx = orb.x - cx;
  let ny = orb.y - cy;
  const d = Math.hypot(nx, ny) || 1;
  nx /= d;
  ny /= d;
  const minD = m.r + ORB_RADIUS;
  orb.x = cx + nx * minD;
  orb.y = cy + ny * minD;
  const vn2 = orb.vx * nx + orb.vy * ny;
  orb.vx -= vn2 * nx;
  orb.vy -= vn2 * ny;
  s.nx = nx;
  s.ny = ny;
}

export interface Tri {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  tx: number;
  ty: number;
}

export const TOOTH = 16;

/** The triangles of a spike row: base corners (a, b) and tip t. */
export function spikeTriangles(row: SpikeRow): Tri[] {
  const horizontal = row.dir === 'up' || row.dir === 'down';
  const span = horizontal ? row.w : row.h;
  const n = Math.max(1, Math.round(span / TOOTH));
  const tw = span / n;
  const tris: Tri[] = [];
  for (let i = 0; i < n; i++) {
    const o = i * tw;
    switch (row.dir) {
      case 'up':
        tris.push({ ax: row.x + o, ay: row.y + row.h, bx: row.x + o + tw, by: row.y + row.h, tx: row.x + o + tw / 2, ty: row.y });
        break;
      case 'down':
        tris.push({ ax: row.x + o, ay: row.y, bx: row.x + o + tw, by: row.y, tx: row.x + o + tw / 2, ty: row.y + row.h });
        break;
      case 'left':
        tris.push({ ax: row.x + row.w, ay: row.y + o, bx: row.x + row.w, by: row.y + o + tw, tx: row.x, ty: row.y + o + tw / 2 });
        break;
      case 'right':
        tris.push({ ax: row.x, ay: row.y + o, bx: row.x, by: row.y + o + tw, tx: row.x + row.w, ty: row.y + o + tw / 2 });
        break;
    }
  }
  return tris;
}

export function hitsSpikes(row: SpikeRow, x: number, y: number, r: number): boolean {
  if (x + r < row.x || x - r > row.x + row.w || y + r < row.y || y - r > row.y + row.h) return false;
  for (const t of spikeTriangles(row)) {
    if (circleTri(x, y, r, t)) return true;
  }
  return false;
}

function circleTri(px: number, py: number, r: number, t: Tri): boolean {
  if (pointInTri(px, py, t)) return true;
  const r2 = r * r;
  return (
    segDist2(px, py, t.ax, t.ay, t.bx, t.by) < r2 ||
    segDist2(px, py, t.bx, t.by, t.tx, t.ty) < r2 ||
    segDist2(px, py, t.tx, t.ty, t.ax, t.ay) < r2
  );
}

function pointInTri(px: number, py: number, t: Tri): boolean {
  const d1 = (px - t.bx) * (t.ay - t.by) - (t.ax - t.bx) * (py - t.by);
  const d2 = (px - t.tx) * (t.by - t.ty) - (t.bx - t.tx) * (py - t.ty);
  const d3 = (px - t.ax) * (t.ty - t.ay) - (t.tx - t.ax) * (py - t.ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const qx = ax + dx * t - px;
  const qy = ay + dy * t - py;
  return qx * qx + qy * qy;
}
