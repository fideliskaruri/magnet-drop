import { FIRST_GATE_TOP, VIEW_H } from './config.ts';
import { GateStream, placeGate } from './gates.ts';
import type { GateSpec, Magnet, PlacedGate, SpikeRow } from './types.ts';
import { fitZones } from './zones.ts';

export class World {
  placed: PlacedGate[] = [];
  magnets: Magnet[] = [];
  spikes: SpikeRow[] = [];
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
      this.spikes = this.placed.flatMap((p) => p.spikes);
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

  /** How many barriers the orb has newly dropped below now that it is at `y`. One point each. */
  passed(y: number): number {
    let n = 0;
    for (let g = this.gate(this.scored); g && y > g.passY; g = this.gate(this.scored)) {
      this.scored++;
      n++;
    }
    return n;
  }
}