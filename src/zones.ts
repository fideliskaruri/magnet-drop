import { ORB_RADIUS } from './config.ts';
import { TUNE } from './tune.ts';
import type { Magnet } from './types.ts';

// Each magnet's zone is the area where it pulls or pushes. Patterns author a reach for
// round magnets; `fitZones` scales it by the tuner and then shrinks zones that would come
// closer than `TUNE.zoneGap` to each other, so two zones never touch.

/** Distance from the core centre (or rail line) to the zone edge. */
export function zoneOf(m: Magnet): number {
  return m.kind === 'point' ? m.reach : m.r + m.reach;
}

function wanted(m: Magnet): number {
  return m.kind === 'point' ? m.field * TUNE.fieldScale : TUNE.railField;
}

/** Smallest reach that still pulls a little before the orb touches the core. */
function minReach(m: Magnet): number {
  return m.kind === 'point' ? m.r + ORB_RADIUS + 4 : ORB_RADIUS + 4;
}

function segPoint(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(ax + dx * t - px, ay + dy * t - py);
}

/** Distance between two magnet cores (centre points or rail segments). Rails never cross. */
export function coreDistance(a: Magnet, b: Magnet): number {
  if (a.kind === 'point' && b.kind === 'point') return Math.hypot(a.x - b.x, a.y - b.y);
  if (a.kind === 'point' && b.kind === 'rail') return segPoint(a.x, a.y, b.ax, b.ay, b.bx, b.by);
  if (a.kind === 'rail' && b.kind === 'point') return segPoint(b.x, b.y, a.ax, a.ay, a.bx, a.by);
  if (a.kind === 'rail' && b.kind === 'rail') {
    return Math.min(
      segPoint(a.ax, a.ay, b.ax, b.ay, b.bx, b.by),
      segPoint(a.bx, a.by, b.ax, b.ay, b.bx, b.by),
      segPoint(b.ax, b.ay, a.ax, a.ay, a.bx, a.by),
      segPoint(b.bx, b.by, a.ax, a.ay, a.bx, a.by),
    );
  }
  return Infinity;
}

/**
 * Give `fresh` magnets their tuned reach, then shrink pairs until no two zones are closer
 * than the gap. `placed` magnets keep the reach they already have, so earlier fits hold.
 */
export function fitZones(placed: readonly Magnet[], fresh: readonly Magnet[]): void {
  for (const m of fresh) m.reach = Math.max(minReach(m), wanted(m));
  const ms = [...placed, ...fresh];
  for (let pass = 0; pass < 12; pass++) {
    let clean = true;
    for (let i = 0; i < ms.length; i++) {
      for (let j = i + 1; j < ms.length; j++) {
        const a = ms[i]!;
        const b = ms[j]!;
        const excess = zoneOf(a) + zoneOf(b) + TUNE.zoneGap - coreDistance(a, b);
        if (excess <= 0.01) continue;
        const sa = a.reach - minReach(a);
        const sb = b.reach - minReach(b);
        if (sa + sb <= 0) continue;
        clean = false;
        const k = Math.min(1, excess / (sa + sb));
        a.reach -= sa * k;
        b.reach -= sb * k;
      }
    }
    if (clean) break;
  }
}

/** Pairs whose zones still come closer than the gap (only possible when the cores themselves are that close). */
export function zoneClashes(ms: readonly Magnet[]): { a: Magnet; b: Magnet; space: number }[] {
  const out: { a: Magnet; b: Magnet; space: number }[] = [];
  for (let i = 0; i < ms.length; i++) {
    for (let j = i + 1; j < ms.length; j++) {
      const a = ms[i]!;
      const b = ms[j]!;
      const space = coreDistance(a, b) - zoneOf(a) - zoneOf(b);
      if (space < TUNE.zoneGap - 0.5) out.push({ a, b, space });
    }
  }
  return out;
}
