import { BREATHER_AFTER_TIER, PATTERN_GAP, TIER_UNLOCK, VIEW_H } from './config.ts';
import { PATTERNS, TUTORIAL_COUNT } from './patterns.ts';
import type { Magnet, PlacedPattern, SpikeRow } from './types.ts';

const FIRST_TOP = 240;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class World {
  placed: PlacedPattern[] = [];
  magnets: Magnet[] = [];
  spikes: SpikeRow[] = [];
  private rand: () => number;
  private count = 0;
  private last = -1;
  private nextTop = FIRST_TOP;
  private readonly bottoms: number[] = [];
  private readonly forced: number[];

  /** `forced` pins the first pattern indices (used by tests and the simulator). */
  constructor(seed: number, forced: number[] = []) {
    this.rand = mulberry32(seed);
    this.forced = forced;
  }

  /** Keep patterns spawned two screens below the camera and drop ones well above it. */
  update(camY: number): void {
    let changed = false;
    while (this.nextTop < camY + VIEW_H * 2) {
      this.spawn();
      changed = true;
    }
    const before = this.placed.length;
    this.placed = this.placed.filter((p) => p.top + p.height > camY - 200);
    if (changed || this.placed.length !== before) {
      this.magnets = this.placed.flatMap((p) => p.magnets);
      this.spikes = this.placed.flatMap((p) => p.spikes);
    }
  }

  private pick(): number {
    const n = this.count++;
    if (n < this.forced.length) return this.forced[n]!;
    if (this.forced.length === 0 && n < TUTORIAL_COUNT) return n;
    const lastTier = this.last >= 0 ? PATTERNS[this.last]!.tier : 0;
    const maxTier = lastTier >= BREATHER_AFTER_TIER ? 0 : TIER_UNLOCK.filter((u) => n >= u).length - 1;
    // Pattern 0 is the bare opening drop; it never comes back.
    const pool: number[] = [];
    for (let i = 1; i < PATTERNS.length; i++) if (i !== this.last && PATTERNS[i]!.tier <= maxTier) pool.push(i);
    return pool[Math.floor(this.rand() * pool.length)]!;
  }

  private spawn(): void {
    const index = this.pick();
    this.last = index;
    const p = PATTERNS[index]!;
    const top = this.nextTop;
    this.bottoms.push(top + p.height);
    this.placed.push({
      index,
      tier: p.tier,
      top,
      height: p.height,
      magnets: p.magnets.map((m) =>
        m.kind === 'point' ? { ...m, y: m.y + top } : { ...m, ay: m.ay + top, by: m.by + top },
      ),
      spikes: p.spikes.map((s) => ({ ...s, y: s.y + top })),
    });
    this.nextTop = top + p.height + PATTERN_GAP;
  }

  patternAt(y: number): PlacedPattern | undefined {
    return this.placed.find((p) => y >= p.top && y < p.top + p.height + PATTERN_GAP);
  }

  /** How many patterns have newly been cleared now that the orb is at `y`. */
  passed(y: number): number {
    let n = 0;
    while (this.bottoms.length && y > this.bottoms[0]!) {
      this.bottoms.shift();
      n++;
    }
    return n;
  }
}
