import { FIRST_GATE_X, GATE_SPACING, TUTORIAL_GATES, VIEW_W } from './config.ts';
import { buildGate, GateStream, tierOf } from './gates.ts';
import { TUNE } from './tune.ts';
import type { Gate, GateSpec } from './types.ts';

/** Space between gates in the tutorial; the last tutorial gate gets extra room as a breather. */
const TUTORIAL_SPACING = 320;
const AFTER_TUTORIAL = 460;
const SPAWN_AHEAD = 520;
const CULL_BEHIND = 240;

/** Spawns gates ahead of the camera and drops them once they are well behind. */
export class World {
  readonly gates: Gate[] = [];
  private stream = new GateStream(1);
  private nextIndex = 0;
  private nextX = FIRST_GATE_X;
  private forced: readonly GateSpec[] = [];

  reset(seed: number, forced: readonly GateSpec[] = []): void {
    this.gates.length = 0;
    this.stream = new GateStream(seed);
    this.nextIndex = 0;
    this.nextX = FIRST_GATE_X;
    this.forced = forced;
    this.update(0);
  }

  update(camX: number): void {
    while (this.nextX < camX + VIEW_W + SPAWN_AHEAD) {
      const i = this.nextIndex;
      const forced = this.forced[i];
      const spec = forced ? { ...forced, v: forced.v.slice() } : this.stream.next(i);
      if (forced) this.stream.next(i);
      const g = buildGate(spec, i, this.nextX);
      this.gates.push(g);
      this.nextIndex++;
      this.nextX = g.x + g.width + this.spacingAfter(i);
    }
    while (this.gates.length && this.gates[0]!.x + this.gates[0]!.width < camX - CULL_BEHIND) this.gates.shift();
  }

  spacingAfter(index: number): number {
    if (index < TUTORIAL_GATES - 1) return TUTORIAL_SPACING;
    if (index === TUTORIAL_GATES - 1) return AFTER_TUTORIAL;
    return (GATE_SPACING[tierOf(index)] ?? GATE_SPACING[0]) * TUNE.gateGap;
  }

  /** The next gate the orb hasn't passed yet. */
  upcoming(x: number): Gate | null {
    for (const g of this.gates) if (g.x + g.width >= x) return g;
    return null;
  }
}
