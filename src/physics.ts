// Runner physics. Pure (no DOM): the game and the simulator share it.
// The orb auto-moves right; polarity sets the vertical pull: red is pulled UP to the blue ceiling rail,
// blue is pulled DOWN to the red floor rail (opposites attract).
import { ANCHOR, CAMERA_LEAD, CEIL, FLOOR, ORB_RADIUS, VIEW_W } from './config.ts';
import { updateGate } from './gates.ts';
import { TUNE } from './tune.ts';
import { CAPSULE, CIRCLE, RECT, type Gate, type Orb, type Polarity, type Shape } from './types.ts';

export interface Sim {
  orb: Orb;
  /** Run time in seconds. Moving machinery is a function of it, so replays are deterministic. */
  t: number;
  /** World x of the screen's left edge. */
  camX: number;
  /** Current scroll speed, px/s. */
  speed: number;
  gates: Gate[];
}

export type StepEvent = 'none' | 'stick' | 'bump' | 'knock' | 'camera' | 'hazard';

/** Details of the strongest contact in the last step (for effects and sound). */
export const contact = { speed: 0, nx: 0, ny: 0, x: 0, y: 0, gate: null as Gate | null, shape: null as Shape | null };

const R = ORB_RADIUS;
/** A gate face hit faster than this (px/s into the face) knocks the orb back. */
const KNOCK_MIN = 30;
/** Overlap left after resolving that counts as being crushed. */
const CRUSH = 5;
/** Horizontal speed relaxes toward its target at this rate (per second). */
const VX_RATE = 2.5;
const RAIL_GRAB = 1.5;
const TUNNEL_PULL = 0.7;
const TUNNEL_LAUNCH = 0.6;
const NEUTRAL_DAMP = 3;

export const dirOf = (p: Polarity): number => (p === 'red' ? -1 : 1);
export const other = (p: Polarity): Polarity => (p === 'red' ? 'blue' : 'red');

export function makeOrb(x: number, y: number, polarity: Polarity): Orb {
  return { x, y, vx: 0, vy: 0, prevX: x, prevY: y, polarity, stuck: null };
}

/** Which field zone the orb is in: 0 none, 1 neutral, 2 tunnel. */
export function zoneAt(gates: readonly Gate[], x: number, y: number): number {
  for (const g of gates) {
    if (x < g.x - 1 || x > g.x + g.width + 1) continue;
    for (const z of g.zones) if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) return z.kind === 'neutral' ? 1 : 2;
  }
  return 0;
}

/** Vertical acceleration the field puts on the orb right now. */
export function pullAccel(orb: Orb, zone: number): number {
  const dir = dirOf(orb.polarity);
  // Distance to the attracting rail; the pull firms up as the rail gets closer.
  const d = dir < 0 ? orb.y - R - CEIL : FLOOR - (orb.y + R);
  const close = 1 - Math.max(0, Math.min(1, d / (FLOOR - CEIL)));
  let a = dir * TUNE.pull * (0.85 + 0.3 * close);
  if (d < TUNE.railReach) a *= RAIL_GRAB;
  if (zone === 1) a *= TUNE.neutralPull;
  else if (zone === 2) a *= TUNNEL_PULL;
  return a;
}

/** Flip polarity. Flipping while stuck to a surface launches off it. Returns true for a launch. */
export function flip(sim: Sim): boolean {
  const o = sim.orb;
  const was = o.stuck;
  o.polarity = other(o.polarity);
  o.stuck = null;
  if (!was) return false;
  const nd = dirOf(o.polarity);
  const inTunnel = was.shape?.kind === 'tunnel';
  o.vy = nd * TUNE.launchSpeed * (inTunnel ? TUNNEL_LAUNCH : 1) + (was.shape ? was.shape.vy : 0);
  o.vx += TUNE.launchBoost;
  return true;
}

function surfaceVel(s: Shape, cx: number, cy: number, out: { x: number; y: number }): void {
  out.x = s.vx - s.omega * (cy - s.py);
  out.y = s.vy + s.omega * (cx - s.px);
}

const vs = { x: 0, y: 0 };
const hit = { nx: 0, ny: 0, pen: 0, cx: 0, cy: 0 };

/** Closest-point test of the orb against a shape. Fills `hit`; false if no overlap. */
export function overlap(s: Shape, x: number, y: number, r: number): boolean {
  if (s.type === RECT) {
    const cx = Math.max(s.x, Math.min(x, s.x + s.w));
    const cy = Math.max(s.y, Math.min(y, s.y + s.h));
    const dx = x - cx;
    const dy = y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) return false;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      hit.nx = dx / d;
      hit.ny = dy / d;
      hit.pen = r - d;
    } else {
      // Centre inside: leave by the nearest face.
      const l = x - s.x;
      const rr = s.x + s.w - x;
      const u = y - s.y;
      const b = s.y + s.h - y;
      const m = Math.min(l, rr, u, b);
      if (m === l) {
        hit.nx = -1;
        hit.ny = 0;
      } else if (m === rr) {
        hit.nx = 1;
        hit.ny = 0;
      } else if (m === u) {
        hit.nx = 0;
        hit.ny = -1;
      } else {
        hit.nx = 0;
        hit.ny = 1;
      }
      hit.pen = m + r;
    }
    hit.cx = cx;
    hit.cy = cy;
    return true;
  }
  let cx = s.x;
  let cy = s.y;
  if (s.type === CAPSULE) {
    const ex = s.x2 - s.x;
    const ey = s.y2 - s.y;
    const l2 = ex * ex + ey * ey;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - s.x) * ex + (y - s.y) * ey) / l2)) : 0;
    cx = s.x + ex * t;
    cy = s.y + ey * t;
  }
  const rr = r + s.r;
  const dx = x - cx;
  const dy = y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr) return false;
  const d = Math.sqrt(d2) || 1e-6;
  hit.nx = d2 > 1e-12 ? dx / d : 0;
  hit.ny = d2 > 1e-12 ? dy / d : -1;
  hit.pen = rr - d;
  hit.cx = cx + hit.nx * s.r;
  hit.cy = cy + hit.ny * s.r;
  return true;
}

/** Locks and doors only block an orb arriving from their left. */
function leftOnly(s: Shape): boolean {
  return s.kind === 'lock' || s.kind === 'door';
}

function stickable(s: Shape): boolean {
  return s.type === RECT && (s.kind === 'iron' || s.kind === 'plate' || s.kind === 'tunnel');
}

/** Gates near enough to the orb to touch it. */
function near(g: Gate, x: number): boolean {
  return x + R + 2 > g.x - 20 && x - R - 2 < g.x + g.width + 20;
}

/**
 * Advance one fixed step. Returns the most important thing that happened. `contact` holds the details.
 * Moving machinery within `active` px of the orb is advanced too.
 */
export function step(sim: Sim, dt: number): StepEvent {
  const o = sim.orb;
  sim.t += dt;
  for (const g of sim.gates) if (g.x < o.x + 760 && g.x + g.width > o.x - 420) updateGate(g, sim.t, o, dt);

  o.prevX = o.x;
  o.prevY = o.y;
  const dir = dirOf(o.polarity);
  const zone = zoneAt(sim.gates, o.x, o.y);

  // Forward: relax toward the scroll speed, faster while behind the orb's spot on screen.
  const anchor = ANCHOR * VIEW_W;
  const sx = o.x - sim.camX;
  let target = sim.speed + TUNE.recover * Math.max(-0.5, Math.min(1, (anchor - sx) / anchor));
  if (o.stuck?.shape?.kind === 'tunnel') target *= TUNE.tunnelGrip;
  o.vx += (target - o.vx) * (1 - Math.exp(-VX_RATE * dt));

  // Vertical: smooth pull with inertia, never a snap.
  if (!o.stuck) {
    o.vy += pullAccel(o, zone) * dt;
    o.vy *= Math.exp(-(TUNE.damping + (zone === 1 ? NEUTRAL_DAMP : 0)) * dt);
    if (o.vy > TUNE.maxVy) o.vy = TUNE.maxVy;
    else if (o.vy < -TUNE.maxVy) o.vy = -TUNE.maxVy;
  }

  o.x += o.vx * dt;
  o.y += o.vy * dt;

  // Resting on a surface: ride it until it ends.
  if (o.stuck) {
    const s = o.stuck.shape;
    if (!s) {
      o.y = dir > 0 ? FLOOR - R : CEIL + R;
      o.vy = 0;
    } else if (!s.on || o.x < s.x - R * 0.3 || o.x > s.x + s.w + R * 0.3) {
      o.stuck = null;
    } else {
      o.y = dir > 0 ? s.y - R : s.y + s.h + R;
      o.vy = s.vy;
    }
  }

  let ev: StepEvent = 'none';
  contact.speed = 0;
  contact.gate = null;
  contact.shape = null;

  const rails = (): StepEvent => {
    let e: StepEvent = 'none';
    if (o.y - R < CEIL) {
      o.y = CEIL + R;
      if (o.vy < 0) e = landRail(o, -1, dir);
    } else if (o.y + R > FLOOR) {
      o.y = FLOOR - R;
      if (o.vy > 0) e = landRail(o, 1, dir);
    }
    return e;
  };
  const re = rails();
  if (re !== 'none') ev = re;

  // Gate machinery. Two passes settle corners.
  for (let pass = 0; pass < 2; pass++) {
    for (const g of sim.gates) {
      if (!near(g, o.x)) continue;
      for (const s of g.shapes) {
        if (!s.on) continue;
        if (leftOnly(s) && o.x > s.x + s.w * 0.5) continue;
        if (!overlap(s, o.x, o.y, R)) continue;
        g.touched = true;
        if (s.kind === 'grinder') {
          contact.gate = g;
          contact.shape = s;
          contact.x = o.x;
          contact.y = o.y;
          return 'hazard';
        }
        if (leftOnly(s)) {
          hit.nx = -1;
          hit.ny = 0;
          hit.pen = o.x + R - s.x;
        }
        o.x += hit.nx * hit.pen;
        o.y += hit.ny * hit.pen;
        surfaceVel(s, hit.cx, hit.cy, vs);
        const rvx = o.vx - vs.x;
        const rvy = o.vy - vs.y;
        const vn = rvx * hit.nx + rvy * hit.ny;
        if (vn >= 0) continue;
        let e: StepEvent;
        if (hit.nx < -0.7 && vn < -KNOCK_MIN) {
          // Hit a gate face: knocked back, never killed.
          o.vx = vs.x - Math.max(TUNE.backBounce, -vn * TUNE.bounce);
          o.vy = o.vy - (1 + TUNE.bounce) * (rvy * hit.ny) * Math.abs(hit.ny);
          o.stuck = null;
          e = 'knock';
        } else if (stickable(s) && Math.abs(hit.ny) > 0.7 && hit.ny * dir < 0 && !o.stuck) {
          o.vy = vs.y;
          o.y = dir > 0 ? s.y - R : s.y + s.h + R;
          o.stuck = { dir, shape: s };
          e = 'stick';
        } else {
          const k = (1 + TUNE.bounce) * vn;
          o.vx -= k * hit.nx;
          o.vy -= k * hit.ny;
          if (Math.abs(hit.ny) > 0.7 && o.stuck && o.stuck.shape !== s) o.stuck = null;
          e = -vn > 40 ? 'bump' : 'none';
        }
        if (e !== 'none' && -vn >= contact.speed) {
          contact.speed = -vn;
          contact.nx = hit.nx;
          contact.ny = hit.ny;
          contact.x = hit.cx;
          contact.y = hit.cy;
          contact.gate = g;
          contact.shape = s;
          if (ev === 'none' || e === 'knock' || (e === 'stick' && ev === 'bump')) ev = e;
        }
      }
    }
    const r2 = rails();
    if (r2 !== 'none' && ev === 'none') ev = r2;
  }

  // Anything still deeply overlapping after resolving means the orb is being crushed.
  for (const g of sim.gates) {
    if (!near(g, o.x)) continue;
    for (const s of g.shapes) {
      if (!s.on || (leftOnly(s) && o.x > s.x + s.w * 0.5)) continue;
      if (overlap(s, o.x, o.y, R) && hit.pen > CRUSH) {
        contact.gate = g;
        contact.shape = s;
        contact.x = o.x;
        contact.y = o.y;
        return 'hazard';
      }
    }
  }

  // The world advances; the camera also follows an orb that runs too far ahead.
  sim.camX += sim.speed * dt;
  if (o.x - CAMERA_LEAD * VIEW_W > sim.camX) sim.camX = o.x - CAMERA_LEAD * VIEW_W;
  if (o.x + R < sim.camX) return 'camera';
  return ev;
}

function landRail(o: Orb, side: number, dir: number): StepEvent {
  const speed = Math.abs(o.vy);
  contact.speed = speed;
  contact.nx = 0;
  contact.ny = -side;
  contact.x = o.x;
  contact.y = side < 0 ? CEIL : FLOOR;
  if (side === dir) {
    o.vy = 0;
    if (!o.stuck) o.stuck = { dir, shape: null };
    return 'stick';
  }
  o.vy = -o.vy * TUNE.bounce;
  return speed > 40 ? 'bump' : 'none';
}

/** Vertical extent [top, bottom] a shape blocks at world x, or null. */
function blockedAt(s: Shape, x: number, out: { a: number; b: number }): boolean {
  if (s.type === RECT) {
    if (x < s.x || x > s.x + s.w) return false;
    out.a = s.y;
    out.b = s.y + s.h;
    return true;
  }
  if (s.type === CIRCLE) {
    const dx = x - s.x;
    if (Math.abs(dx) >= s.r) return false;
    const h = Math.sqrt(s.r * s.r - dx * dx);
    out.a = s.y - h;
    out.b = s.y + h;
    return true;
  }
  const x0 = Math.min(s.x, s.x2) - s.r;
  const x1 = Math.max(s.x, s.x2) + s.r;
  if (x < x0 || x > x1) return false;
  const ex = s.x2 - s.x;
  const t = Math.abs(ex) > 1e-6 ? Math.max(0, Math.min(1, (x - s.x) / ex)) : 0;
  const y = s.y + (s.y2 - s.y) * t;
  // Slanted capsules are thicker vertically.
  const ey = s.y2 - s.y;
  const len = Math.hypot(ex, ey) || 1;
  const half = (s.r * len) / Math.max(Math.abs(ex), s.r);
  out.a = y - half;
  out.b = y + half;
  return true;
}

const span = { a: 0, b: 0 };

/** The free opening around height y at world x (between machinery and the rails). Locks and doors don't count. */
export function freeSpan(gates: readonly Gate[], x: number, y: number): { top: number; bottom: number } {
  let top = CEIL;
  let bottom = FLOOR;
  for (const g of gates) {
    if (x < g.x - 40 || x > g.x + g.width + 40) continue;
    for (const s of g.shapes) {
      if (!s.on || leftOnly(s)) continue;
      if (!blockedAt(s, x, span)) continue;
      if (span.b <= y && span.b > top) top = span.b;
      else if (span.a >= y && span.a < bottom) bottom = span.a;
    }
  }
  return { top, bottom };
}
