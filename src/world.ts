import { FIRST_GATE_TOP, VIEW_H } from './config.ts';
import { GateStream, placeGate, stepGate, type MachineEvent } from './gates.ts';
import type { GateSpec, Magnet, Orb, PlacedGate, Saw, Solid } from './types.ts';
import { fitZones } from './zones.ts';

/** A gate the orb has just dropped through. */
export interface Pass {
  gate: PlacedGate;
  /** Orb x where it crossed the pass line. */
  x: number;
  /** Through the middle half of an opening. */
  clean: boolean;
}

export class World {
  placed: PlacedGate[] = [];
  magnets: Magnet[] = [];
  solids: Solid[] = [];
  saws: Saw[] = [];
  private readonly stream: GateStream;
  private count = 0;
  private nextTop = FIRST_GATE_TOP;
  private scored = 0;

  /** `forced` pins the first gate specs (used by browser checks). */
  constructor(seed: number, forced: GateSpec[] = []) {
    this.stream = new GateStream(seed, forced);
  }

  /** Keep gates spawned two screens below the camera and drop ones well above it. */
  update(camY: number): void {
    let changed = false;
    while (this.nextTop < camY + VIEW_H * 2) {
      const g = placeGate(this.count++, this.stream.next(), this.nextTop);
      // Fit against the gate above too, so zones never touch across the spacing.
      fitZones(this.placed[this.placed.length - 1]?.magnets ?? [], g.magnets);
      this.nextTop = g.nextTop;
      this.placed.push(g);
      changed = true;
    }
    const before = this.placed.length;
    this.placed = this.placed.filter((p) => p.top + p.height > camY - 200);
    if (changed || this.placed.length !== before) {
      this.magnets = this.placed.flatMap((p) => p.magnets);
      this.solids = this.placed.flatMap((p) => p.solids);
      this.saws = this.placed.flatMap((p) => p.saws);
    }
  }

  /** Move every live gate's machinery. Fills `out` with the events (for sound) and the gate they came from. */
  step(orb: Orb, t: number, dt: number, out: { gate: PlacedGate; ev: MachineEvent }[]): void {
    out.length = 0;
    for (const g of this.placed) {
      const ev = stepGate(g, orb, t, dt);
      if (ev !== 'none') out.push({ gate: g, ev });
    }
  }

  /** Re-fit every live magnet after a zone setting changes. */
  refit(): void {
    fitZones([], this.magnets);
  }

  gate(index: number): PlacedGate | undefined {
    return this.placed.find((p) => p.index === index);
  }

  gateAt(y: number): PlacedGate | undefined {
    for (let i = this.placed.length - 1; i >= 0; i--) if (y >= this.placed[i]!.top) return this.placed[i];
    return undefined;
  }

  /** The next gate the orb has not yet dropped through. */
  next(): PlacedGate | undefined {
    return this.gate(this.scored);
  }

  /** Fill `out` with the gates the orb newly dropped through this step. */
  passed(orb: Orb, out: Pass[]): void {
    out.length = 0;
    for (let g = this.gate(this.scored); g && orb.y > g.passY; g = this.gate(this.scored)) {
      this.scored++;
      const k = orb.y === orb.prevY ? 1 : (g.passY - orb.prevY) / (orb.y - orb.prevY);
      const x = orb.prevX + (orb.x - orb.prevX) * Math.max(0, Math.min(1, k));
      out.push({ gate: g, x, clean: isClean(g, x) });
    }
  }
}

/** Through the middle half of one of the gate's openings. */
export function isClean(g: { lanes: readonly { x0: number; x1: number }[] }, x: number): boolean {
  return g.lanes.some((l) => Math.abs(x - (l.x0 + l.x1) / 2) <= (l.x1 - l.x0) / 4);
}
