// End-to-end checks in a real headless browser with real taps.
// Needs the dev server running (pnpm dev --port 5193). Usage: pnpm verify [baseUrl]
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { BEST_KEY } from '../src/config.ts';
import type { DebugHook } from '../src/debug.ts';
import type { Family, GateSpec } from '../src/types.ts';

type Snap = ReturnType<DebugHook['snapshot']>;

const BASE = process.argv[2] ?? 'http://localhost:5193/';
const OUT = join(tmpdir(), 'agent-scratch', 'magnet-drop-endless');
mkdirSync(OUT, { recursive: true });

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
}

const snap = (page: Page): Promise<Snap> => page.evaluate(() => window.__md!.snapshot());
const tap = (page: Page): Promise<void> => page.touchscreen.tap(195, 500);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const shot = (page: Page, name: string): Promise<Buffer> => page.screenshot({ path: join(OUT, `${name}.png`) });

const gate = (family: Family, v: number[], o: Partial<GateSpec> = {}): GateSpec => ({ family, tier: 0, v, mirror: false, swap: false, ...o });

// Idle (never tapping) the blue orb dropped at x=180:
// - drift[1,0]: red magnet on the left pulls it left. With swap the magnet is blue and pushes it right.
const DRIFT = gate('drift', [1, 0]);
// - perch[1,0]: a red magnet right under the spawn, gap under it. The orb lands and sticks.
const PERCH = gate('perch', [1, 0]);
// - drift[3,0] swapped: pushed right into the gap at x=310, a free point. drift[0,0] swapped: pushed onto the spikes.
const FREE = gate('drift', [3, 0], { swap: true });
const KILL = gate('drift', [0, 0], { swap: true });

async function waitFor(page: Page, pred: (s: Snap) => boolean, timeoutMs: number): Promise<Snap | null> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const s = await snap(page);
    if (pred(s)) return s;
    await sleep(16);
  }
  return null;
}

/** Back to the ready screen, then start a run on the given gates. */
async function startRun(page: Page, gates: GateSpec[], seed = 1): Promise<void> {
  await page.reload();
  await page.waitForFunction(() => window.__md !== undefined);
  await page.evaluate(([s, g]) => window.__md!.setup(s as number, g as GateSpec[]), [seed, gates] as const);
  await tap(page);
  await waitFor(page, (s) => s.state === 'playing', 1000);
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

try {
  // 1. Boot
  await page.goto(BASE);
  await page.waitForFunction(() => window.__md !== undefined);
  await sleep(300);
  let s = await snap(page);
  await shot(page, '01-ready');
  check('boot', s.state === 'ready' && errors.length === 0, `state=${s.state} errors=${errors.length}`);

  // 2. Start and flip
  await page.evaluate((g) => window.__md!.setup(1, g), [DRIFT]);
  await tap(page);
  s = (await waitFor(page, (x) => x.state === 'playing', 1000)) ?? (await snap(page));
  const p0 = s.polarity;
  await tap(page);
  await sleep(50);
  const p1 = (await snap(page)).polarity;
  await shot(page, '02-flipped-red');
  await tap(page);
  await sleep(50);
  const p2 = (await snap(page)).polarity;
  check('start-and-flip', s.state === 'playing' && p0 === 'blue' && p1 === 'red' && p2 === 'blue', `${s.state} ${p0}->${p1}->${p2}`);

  // 3. Attract vs repel: the same drift gate with the magnet's colour swapped. The orb drops at x=180;
  // record which way it first leaves the centre line.
  const drifted = (x: Snap): boolean => Math.abs(x.x - 180) > 15;
  await startRun(page, [DRIFT]);
  let b = await waitFor(page, drifted, 3000);
  check('attract-pulls-toward', b !== null && b.x < 165 && b.vx < 0, `blue orb x=${b?.x.toFixed(0)} vx=${b?.vx.toFixed(1)} (red magnet on the left)`);
  await startRun(page, [{ ...DRIFT, swap: true }]);
  b = await waitFor(page, drifted, 3000);
  await sleep(150);
  await shot(page, '03-repel');
  check('repel-pushes-away', b !== null && b.x > 195 && b.vx > 0, `blue orb x=${b?.x.toFixed(0)} vx=${b?.vx.toFixed(1)} (blue magnet on the left)`);

  // 4. Stick and launch on the perch.
  await startRun(page, [PERCH]);
  const stuck = await waitFor(page, (x) => x.stuck, 4000);
  await sleep(150);
  await shot(page, '04-stuck');
  await tap(page);
  await sleep(80);
  const afterLaunch = await snap(page);
  const speed = Math.hypot(afterLaunch.vx, afterLaunch.vy);
  await sleep(120);
  await shot(page, '04-launched');
  check('stick-and-launch', stuck !== null && afterLaunch.launches === 1 && !afterLaunch.stuck && speed >= 550, `stuck=${stuck !== null} launches=${afterLaunch.launches} speed=${speed.toFixed(0)}`);

  // 5. Scoring: two free gates then a fatal one, no taps. Score must be exactly 2, one point per gap.
  await page.evaluate(() => localStorage.clear());
  await startRun(page, [FREE, FREE, KILL]);
  const one = await waitFor(page, (x) => x.score === 1, 4000);
  const pop = one?.scorePop ?? 0;
  const dead = await waitFor(page, (x) => x.state === 'dying', 6000);
  const deathScore = dead?.score ?? -1;
  await sleep(800);
  await shot(page, '05-death');
  check('score-per-gate', one !== null && pop > 0 && deathScore === 2, `pop on first point=${pop.toFixed(2)} score at death=${deathScore}`);
  const t0 = Date.now();
  await tap(page);
  const back = await waitFor(page, (x) => x.state === 'playing', 1000);
  check('restart-under-1s', back !== null && back.score === 0 && Date.now() - t0 < 1000, `restart took ${Date.now() - t0} ms, score reset to ${back?.score}`);
  await page.reload();
  await page.waitForFunction(() => window.__md !== undefined);
  const best = (await snap(page)).best;
  const stored = await page.evaluate((k) => localStorage.getItem(k), BEST_KEY);
  await shot(page, '05-menu-best');
  check('best-persists', best === 2 && stored === '2', `best after reload=${best}, ${BEST_KEY}=${stored}`);

  // 6. Stall pressure: hang on the perch and get scrolled off the top.
  await startRun(page, [PERCH]);
  const hung = await waitFor(page, (x) => x.stuck, 4000);
  const stallDeath = await waitFor(page, (x) => x.state === 'dying', 12000);
  check('stall-kills', hung !== null && stallDeath !== null && stallDeath.stuck === false, `stuck=${hung !== null} died=${stallDeath !== null} at y=${stallDeath?.y.toFixed(0)} camY=${stallDeath?.camY.toFixed(0)}`);

  // 7. Generation: deterministic per seed, different across seeds, ramps up in difficulty.
  const runs = await page.evaluate(() => [window.__md!.preview(7, 40), window.__md!.preview(7, 40), window.__md!.preview(8, 40)]);
  const [r7, r7b, r8] = runs.map((r) => JSON.stringify(r));
  const tiers = runs[0]!.map((g) => g.tier);
  const lateFamilies = new Set(runs[0]!.slice(30).map((g) => g.family));
  const repeats = runs[0]!.filter((g, i) => i > 0 && g.family === runs[0]![i - 1]!.family).length;
  check('seeded-generation', r7 === r7b && r7 !== r8, `same seed identical=${r7 === r7b}, other seed differs=${r7 !== r8}`);
  check(
    'difficulty-ramp',
    tiers[0] === 0 && tiers[39] === 3 && tiers.every((t, i) => i === 0 || t >= tiers[i - 1]!) && lateFamilies.size >= 4 && repeats === 0,
    `tiers ${tiers.join('')}, ${lateFamilies.size} families after gate 30, back-to-back repeats=${repeats}`,
  );

  let wrongScreens = 0;
  // 8. Screenshot every family at the easiest and hardest tier (camera frames the gate on entry).
  for (const family of ['drift', 'twin', 'perch', 'rail', 'slope', 'corridor'] as Family[]) {
    for (const tier of [family === 'corridor' ? 2 : family === 'rail' || family === 'slope' ? 1 : 0, 3]) {
      await startRun(page, [gate(family, [0, 0, 0], { tier })]);
      const x = await waitFor(page, (q) => q.gateTop !== null, 3000);
      await sleep(100);
      await shot(page, `08-${family}-t${tier}`);
      if (x?.family !== family || x.tier !== tier) wrongScreens += 1;
      if (x?.family !== family || x.tier !== tier) check(`screen-${family}-t${tier}`, false, `orb is in ${x?.family} t${x?.tier}`);
    }
  }
  check('family-screens', wrongScreens === 0, `12 screens, wrong gate in ${wrongScreens}, saved to ${OUT}`);

  // 9. Long session: mash taps for 20 s on random seeds, auto-restarting. Object counts must stay bounded
  // and per-frame work small. (Headless Edge caps rAF at 30 fps, so we time update + render work, not frame intervals.)
  await page.reload();
  await page.waitForFunction(() => window.__md !== undefined);
  let maxMagnets = 0;
  let maxSpikes = 0;
  let maxScore = 0;
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    await tap(page);
    const x = await snap(page);
    maxMagnets = Math.max(maxMagnets, x.magnets);
    maxSpikes = Math.max(maxSpikes, x.spikes);
    maxScore = Math.max(maxScore, x.score);
    await sleep(150 + Math.random() * 500);
  }
  await shot(page, '09-mash');
  const frames = await page.evaluate(() => window.__md!.frameWork());
  frames.sort((x, y) => x - y);
  const p95 = frames[Math.floor(frames.length * 0.95)] ?? 0;
  check('bounded-objects', maxMagnets <= 12 && maxSpikes <= 12, `max magnets=${maxMagnets} spikes=${maxSpikes} best score=${maxScore}`);
  check('frame-work', frames.length > 100 && p95 < 8, `p95 update+render=${p95.toFixed(2)} ms over ${frames.length} frames (budget 8 ms)`);
  check('no-console-errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${OUT}`);
process.exit(failed.length ? 1 : 0);
