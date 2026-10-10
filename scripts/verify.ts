// End-to-end checks in a real headless browser with real taps.
// Needs the dev server running (pnpm dev). Usage: pnpm verify [baseUrl]
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import type { DebugHook } from '../src/debug.ts';

type Snap = ReturnType<DebugHook['snapshot']>;

const BASE = process.argv[2] ?? 'http://localhost:5180/';
const OUT = join(tmpdir(), 'agent-scratch', 'magnet-drop');
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

async function waitFor(page: Page, pred: (s: Snap) => boolean, timeoutMs: number): Promise<Snap | null> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const s = await snap(page);
    if (pred(s)) return s;
    await sleep(16);
  }
  return null;
}

/** Back to the ready screen, then start a run on the given patterns. */
async function startRun(page: Page, patterns: number[], seed = 1): Promise<void> {
  await page.reload();
  await page.waitForFunction(() => window.__md !== undefined);
  await page.evaluate(([s, p]) => window.__md!.setup(s as number, p as number[]), [seed, patterns] as const);
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
  await page.evaluate(() => window.__md!.setup(1, [0]));
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

  // 3. Attract vs repel on pattern 1 (red magnet at x=260, orb falls at x=180).
  await startRun(page, [0]);
  let a = await waitFor(page, (x) => x.patternTop !== null && x.y > x.patternTop + 80, 3000);
  await sleep(250);
  let b = await snap(page);
  const attractVx = b.vx;
  check('attract-pulls-toward', a !== null && attractVx > 20, `blue orb vx=${attractVx.toFixed(1)} (magnet is to the right)`);
  await startRun(page, [0]);
  await tap(page);
  a = await waitFor(page, (x) => x.patternTop !== null && x.y > x.patternTop + 80, 3000);
  await sleep(250);
  b = await snap(page);
  await shot(page, '03-repel');
  check('repel-pushes-away', a !== null && b.polarity === 'red' && b.vx < -20, `red orb vx=${b.vx.toFixed(1)}`);

  // 4. Stick and launch on pattern 4 (red magnet the blue orb falls onto).
  await startRun(page, [3]);
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

  // 5. Death and fast restart on pattern 2 without flipping (blue magnet pushes the orb onto the shelf).
  await page.evaluate(() => localStorage.clear());
  await startRun(page, [1]);
  const dead = await waitFor(page, (x) => x.state === 'dying', 5000);
  const deathScore = dead?.score ?? 0;
  await sleep(200);
  await shot(page, '05-death');
  await sleep(450);
  const t0 = Date.now();
  await tap(page);
  const back = await waitFor(page, (x) => x.state === 'playing', 1000);
  const restartMs = Date.now() - t0;
  check('death', dead !== null, `died at score ${deathScore}`);
  check('restart-under-1s', back !== null && back.score < deathScore, `restart took ${restartMs} ms after the 650 ms lockout, score reset to ${back?.score}`);
  await page.reload();
  await page.waitForFunction(() => window.__md !== undefined);
  const best = (await snap(page)).best;
  check('best-persists', best === deathScore && best > 0, `best after reload=${best}`);

  // 6. Stall pressure: hang on the Rest magnet and get scrolled off the top.
  await startRun(page, [9]);
  await tap(page);
  const hung = await waitFor(page, (x) => x.stuck, 4000);
  const stallDeath = await waitFor(page, (x) => x.state === 'dying', 12000);
  check('stall-kills', hung !== null && stallDeath !== null, `stuck=${hung !== null} died=${stallDeath !== null} at y=${stallDeath?.y.toFixed(0)} camY=${stallDeath?.camY.toFixed(0)}`);

  // 7. Screenshot every pattern.
  for (let i = 0; i < 10; i++) {
    await startRun(page, [i, 9]);
    await sleep(650);
    await shot(page, `07-pattern-${String(i + 1).padStart(2, '0')}`);
  }
  check('pattern-screens', true, `saved to ${OUT}`);

  // 8. Long session: mash taps for 20 s, auto-restarting. Object counts must stay bounded and per-frame work small.
  // (Headless Edge caps rAF at 30 fps, so we measure update + render work time, not frame intervals.)
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
  const frames = await page.evaluate(() => window.__md!.frameWork());
  frames.sort((x, y) => x - y);
  const p95 = frames[Math.floor(frames.length * 0.95)] ?? 0;
  check('bounded-objects', maxMagnets <= 16 && maxSpikes <= 16, `max magnets=${maxMagnets} spikes=${maxSpikes} best score=${maxScore}`);
  check('frame-work', frames.length > 100 && p95 < 8, `p95 update+render=${p95.toFixed(2)} ms over ${frames.length} frames (budget 8 ms)`);
  check('no-console-errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${OUT}`);
process.exit(failed.length ? 1 : 0);
