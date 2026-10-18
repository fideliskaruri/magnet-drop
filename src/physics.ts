import { ORB_RADIUS, SAW_FORGIVENESS, VIEW_W } from './config.ts';
import { TUNE } from './tune.ts';
import type { Magnet, Orb, Polarity, Saw, Solid } from './types.ts';

// Pure physics: no DOM. Shared by the game and `scripts/sim.ts`.

export type StepEvent = 'none' | 'stick' | 'bounce' | 'kick' | 'wall' | 'dead';

export interface Scene {
  magnets: readonly Magnet[];
  solids: readonly Solid[];
  saws: readonly Saw[];
}

/** What the orb touched this step (filled in when passed to `step`). */
export interface Hit {
  magnet: Magnet | null;
  solid: Solid | null;
  saw: Saw | null;
}

export function attracts(orb: Polarity, magnet: Polarity): boolean {
  return orb !== magnet;
}

export function closestOnSegment(ax: number, ay: number, bx: number, by: number, x: number, y: number): { cx: number; cy: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
  return { cx: ax + dx * t, cy: ay + dy * t };
}

/** Closest point on the magnet's core (centre for points, segment for rails). */
export function closestPoint(m: Magnet, x: number, y: number): { cx: number; cy: number } {
  if (m.kind === 'point') return { cx: m.x, cy: m.y };
  return closestOnSegment(m.ax, m.ay, m.bx, m.by, x, y);
}

/** 0..1 field intensity at distance d from the core. */
export function fieldU(m: Magnet, d: number): number {
  const u = m.kind === 'point' ? 1 - d / m.reach : 1 - (d - m.r) / m.reach;
  return Math.max(0, Math.min(1, u));
}

/** 0..1 pull of a door on an orb at (x, y). Doors only act on an orb above them. */
export function doorU(d: Solid, x: number, y: number): { u: number; cx: number; cy: number } {
  const { cx, cy } = closestOnSegment(d.ax, d.ay, d.bx, d.by, x, y);
  if (y >= cy) return { u: 0, cx, cy };
  const dist = Math.hypot(cx - x, cy - y) - d.r - ORB_RADIUS;
  return { u: Math.max(0, Math.min(1, 1 - dist / TUNE.doorReach)), cx, cy };
}

/** Whether a solid blocks an orb of this colour. Doors let the opposite colour through. */
export function blocks(s: Solid, p: Polarity): boolean {
  return !(s.kind === 'door' && s.polarity !== null && attracts(p, s.polarity));
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

export function sawHits(s: Saw, x: number, y: number): boolean {
  const r = s.r + ORB_RADIUS - SAW_FORGIVENESS;
  const dx = x - s.x;
  const dy = y - s.y;
  return dx * dx + dy * dy < r * r;
}

export function step(orb: Orb, scene: Scene, dt: number, hit?: Hit): StepEvent {
  orb.prevX = orb.x;
  orb.prevY = orb.y;
  let event: StepEvent = 'none';
  if (hit) hit.magnet = hit.solid = hit.saw = null;

  if (orb.stuck) {
    stepStuck(orb, dt);
  } else {
    let ax = 0;
    let ay = TUNE.gravity;
    let cushion = 0;
    for (const m of scene.magnets) {
      const { cx, cy } = closestPoint(m, orb.x, orb.y);
      const dx = cx - orb.x;
      const dy = cy - orb.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-6) continue;
      const u = fieldU(m, d);
      if (u <= 0) continue;
      const k = (m.kind === 'point' ? TUNE.pointStrength : TUNE.railStrength) * m.gain * u;
      const s = attracts(orb.polarity, m.polarity) ? 1 : -TUNE.repelScale;
      ax += (s * k * dx) / d;
      ay += (s * k * dy) / d;
    }
    for (const sd of scene.solids) {
      if (sd.kind !== 'door' || sd.polarity === null) continue;
      const { u, cx, cy } = doorU(sd, orb.x, orb.y);
      if (u <= 0) continue;
      const dx = cx - orb.x;
      const dy = cy - orb.y;
      const d = Math.hypot(dx, dy) || 1;
      const pull = attracts(orb.polarity, sd.polarity);
      const k = TUNE.doorPull * u * (pull ? 1 : -TUNE.repelScale);
      ax += (k * dx) / d;
      ay += (k * dy) / d;
      if (!pull) cushion = Math.max(cushion, u);
    }
    orb.vx += ax * dt;
    orb.vy += ay * dt;
    orb.vx *= Math.exp(-TUNE.airDamping * dt);
    // A door pushing you off cushions the fall instead of bouncing you forever.
    if (cushion > 0) orb.vy *= Math.exp(-4 * cushion * dt);
    if (orb.vy > TUNE.terminalFall) orb.vy -= (orb.vy - TUNE.terminalFall) * Math.min(1, 3 * dt);
    const sp = Math.hypot(orb.vx, orb.vy);
    if (sp > TUNE.maxSpeed) {
      orb.vx *= TUNE.maxSpeed / sp;
      orb.vy *= TUNE.maxSpeed / sp;
    }
    orb.x += orb.vx * dt;
    orb.y += orb.vy * dt;

    for (const m of scene.magnets) {
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
      if (hit) hit.magnet = m;
      if (attracts(orb.polarity, m.polarity)) {
        orb.vx -= vn * nx;
        orb.vy -= vn * ny;
        orb.stuck = { magnet: m, nx, ny };
        event = 'stick';
        break;
      }
      if (m.kind === 'rail' && m.kick) {
        // Flipper paddle in your own colour: it swings and kicks you away.
        orb.vx = m.kick.x * TUNE.flipperKick;
        orb.vy = m.kick.y * TUNE.flipperKick;
        event = 'kick';
        continue;
      }
      if (vn < 0) {
        orb.vx -= (1 + TUNE.repelBounce) * vn * nx;
        orb.vy -= (1 + TUNE.repelBounce) * vn * ny;
        event = 'bounce';
      }
    }
  }

  // Solids push the orb out even while it is stuck, so moving parts never swallow it.
  for (const sd of scene.solids) {
    if (!blocks(sd, orb.polarity)) continue;
    const { cx, cy } = closestOnSegment(sd.ax, sd.ay, sd.bx, sd.by, orb.x, orb.y);
    let nx = orb.x - cx;
    let ny = orb.y - cy;
    const d = Math.hypot(nx, ny);
    const minD = sd.r + ORB_RADIUS;
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
    if (orb.stuck) continue;
    const vn = orb.vx * nx + orb.vy * ny;
    if (vn < 0) {
      const door = sd.kind === 'door';
      const b = door ? TUNE.repelBounce : TUNE.wallBounce;
      orb.vx -= (1 + b) * vn * nx;
      orb.vy -= (1 + b) * vn * ny;
      if (event === 'none' && vn < -40) event = door ? 'bounce' : 'wall';
      if (hit) hit.solid = sd;
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

  for (const s of scene.saws) {
    if (sawHits(s, orb.x, orb.y)) {
      if (hit) hit.saw = s;
      return 'dead';
    }
  }
  return event;
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
