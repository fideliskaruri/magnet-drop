import { PATTERN_GAP, PICKUP_CHANCE, PICKUP_MARGIN, VIEW_H, VIEW_W } from './config.ts';
import { PATTERNS, TUTORIAL_COUNT } from './patterns.ts';
import type { Magnet, Pickup, PlacedPattern, PowerKind, SpikeRow } from './types.ts';

const FIRST_TOP = 240;
const KINDS: PowerKind[] = ['boost', 'shield', 'phase'];

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
  pickups: Pickup[] = [];
  /** Total tokens ever spawned this run. */
  pickupsSpawned = 0;
  private rand: () => number;
  /** Separate stream so power-ups don't change the pattern order for a seed. */
  private powerRand: () => number;
  private lastKind: PowerKind | null = null;
  private count = 0;
  private last = -1;
  private nextTop = FIRST_TOP;
  private readonly forced: number[];

  /** `forced` pins the first pattern indices (used by tests and the simulator). Forced runs get no random tokens. */
  constructor(seed: number, forced: number[] = []) {
    this.rand = mulberry32(seed);
    this.powerRand = mulberry32(seed ^ 0x5eed);
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
    this.pickups = this.pickups.filter((k) => !k.taken && k.y > camY - 200);
    if (changed || this.placed.length !== before) this.rebuild();
  }

  private rebuild(): void {
    this.magnets = this.placed.flatMap((p) => p.magnets);
    this.spikes = this.placed.flatMap((p) => p.spikes);
  }

  /** The booster breaks spike rows it dives through. */
  smash(row: SpikeRow): void {
    for (const p of this.placed) p.spikes = p.spikes.filter((s) => s !== row);
    this.rebuild();
  }

  addPickup(kind: PowerKind, x: number, y: number): Pickup {
    const k: Pickup = { kind, x, y, homeX: x, homeY: y, taken: false };
    this.pickups.push(k);
    this.pickupsSpawned++;
    return k;
  }

  private pick(): number {
    const n = this.count++;
    if (n < this.forced.length) return this.forced[n]!;
    if (this.forced.length === 0 && n < TUTORIAL_COUNT) return n;
    let i: number;
    do {
      i = TUTORIAL_COUNT + Math.floor(this.rand() * (PATTERNS.length - TUTORIAL_COUNT));
    } while (i === this.last);
    return i;
  }

  private spawn(): void {
    const n = this.count;
    const index = this.pick();
    this.last = index;
    const p = PATTERNS[index]!;
    const top = this.nextTop;
    this.placed.push({
      index,
      top,
      height: p.height,
      magnets: p.magnets.map((m) =>
        m.kind === 'point' ? { ...m, y: m.y + top } : { ...m, ay: m.ay + top, by: m.by + top },
      ),
      spikes: p.spikes.map((s) => ({ ...s, y: s.y + top })),
    });
    this.nextTop = top + p.height + PATTERN_GAP;
    if (this.forced.length === 0) this.maybeToken(n, top + p.height + PATTERN_GAP / 2);
  }

  /** The gap after the last tutorial pattern always gets a token; later gaps get one by chance. */
  private maybeToken(n: number, y: number): void {
    if (n < TUTORIAL_COUNT - 1) return;
    if (n >= TUTORIAL_COUNT && this.powerRand() > PICKUP_CHANCE) return;
    const options = KINDS.filter((k) => k !== this.lastKind);
    const kind = options[Math.floor(this.powerRand() * options.length)]!;
    this.lastKind = kind;
    const x = PICKUP_MARGIN + this.powerRand() * (VIEW_W - PICKUP_MARGIN * 2);
    this.addPickup(kind, x, y);
  }

  patternAt(y: number): PlacedPattern | undefined {
    return this.placed.find((p) => y >= p.top && y < p.top + p.height + PATTERN_GAP);
  }

  /** True when y is in the empty gap below a pattern (or above the first one). */
  inGap(y: number): boolean {
    if (y < FIRST_TOP) return true;
    return this.placed.some((p) => y >= p.top + p.height && y < p.top + p.height + PATTERN_GAP);
  }
}
