// End-to-end checks in a real headless browser with real taps.
// Needs the dev server running (pnpm dev). Usage: pnpm verify [baseUrl]
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import type { DebugHook } from '../src/debug.ts';

type Snap = ReturnType<DebugHook['snapshot']>;

const BASE = process.argv[2] ?? 'http://localhost:5194/';
const OUT = join(tmpdir(), 'agent-scratch', 'magnet-drop-powerups');
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

  // P1. Natural spawning: the gap after the tutorial always holds a token, placed away from the walls.
  await startRun(page, []);
  s = (await waitFor(page, (x) => x.pickups.length > 0 || x.state !== 'playing', 4000)) ?? (await snap(page));
  const firstToken = s.pickups[0];
  // Tutorial patterns are 420, 480 and 440 tall with 120 px gaps, starting at y=240.
  const tutorialGap = 240 + 420 + 120 + 480 + 120 + 440 + 60;
  check(
    'token-after-tutorial',
    firstToken !== undefined && firstToken.y === tutorialGap && firstToken.x >= 50 && firstToken.x <= 310,
    `first token ${firstToken?.kind} at (${firstToken?.x.toFixed(0)}, ${firstToken?.y.toFixed(0)}), gap centre ${tutorialGap}`,
  );

  // P2. Shield vs spikes: pattern 2 kills an idle orb on its shelf. With a shield it survives the hit once.
  await startRun(page, [1]);
  await page.evaluate(() => window.__md!.spawnPickup('shield', 0, 40));
  const shielded = await waitFor(page, (x) => x.shield, 2000);
  await sleep(250);
  await shot(page, 'p2-shield-on');
  const saved = await waitFor(page, (x) => x.saves > 0 || x.state !== 'playing', 6000);
  await sleep(60);
  await shot(page, 'p2-shield-saved');
  await sleep(200);
  const afterSave = await snap(page);
  check(
    'shield-blocks-spikes',
    shielded !== null && saved !== null && saved.saves === 1 && saved.state === 'playing' && !saved.shield && afterSave.state === 'playing',
    `collected=${shielded !== null} saves=${saved?.saves} state at hit=${saved?.state} 250 ms later=${afterSave.state} vy=${afterSave.vy.toFixed(0)}`,
  );

  // P3. Shield vs the screen: stall on the Rest magnet; the shield catches the first scroll-off, the second one kills.
  await startRun(page, [9]);
  await tap(page);
  await waitFor(page, (x) => x.stuck, 4000);
  await page.evaluate(() => window.__md!.spawnPickup('shield', 0, 0));
  const shield2 = await waitFor(page, (x) => x.shield, 1000);
  const camSave = await waitFor(page, (x) => x.saves > 0 || x.state !== 'playing', 15000);
  const camSaveOk = camSave !== null && camSave.state === 'playing' && camSave.y > camSave.camY;
  const finalDeath = await waitFor(page, (x) => x.state === 'dying', 15000);
  check(
    'shield-blocks-screen-once',
    shield2 !== null && camSaveOk && finalDeath !== null && finalDeath.saves === 1,
    `saved at y=${camSave?.y.toFixed(0)} camY=${camSave?.camY.toFixed(0)}, later died=${finalDeath !== null} saves=${finalDeath?.saves}`,
  );

  // P4. Phase: same deadly shelf, but the orb falls straight through the spikes and keeps going.
  await startRun(page, [1]);
  await page.evaluate(() => window.__md!.spawnPickup('phase', 0, 40));
  const phased = await waitFor(page, (x) => x.phase > 0, 2000);
  const inside = await waitFor(page, (x) => x.inSpikes || x.state !== 'playing', 5000);
  await shot(page, 'p4-phase-in-spikes');
  const past = await waitFor(page, (x) => x.state !== 'playing' || (x.patternTop !== null && x.y > x.patternTop + 420), 4000);
  check(
    'phase-passes-spikes',
    phased !== null && inside !== null && inside.inSpikes && inside.state === 'playing' && past !== null && past.state === 'playing',
    `inside spikes while playing=${inside?.inSpikes && inside.state === 'playing'} reached y=${past?.y.toFixed(0)} state=${past?.state}`,
  );

  // P5. Phase runs out after about 5 s and the orb is solid again.
  await startRun(page, [0, 9]);
  await page.evaluate(() => window.__md!.spawnPickup('phase', 0, 30));
  await waitFor(page, (x) => x.phase > 0, 2000);
  const t5 = Date.now();
  await sleep(4300);
  await shot(page, 'p5-phase-ending');
  const ended = await waitFor(page, (x) => x.phase === 0, 3000);
  const phaseSecs = (Date.now() - t5) / 1000;
  check('phase-expires', ended !== null && phaseSecs > 4.4 && phaseSecs < 5.8, `phase lasted ${phaseSecs.toFixed(2)} s, state=${ended?.state}`);

  // P6. Boost: a straight power dive that ignores magnets and smashes the shelf, then hands control back in a gap.
  await startRun(page, [1]);
  await page.evaluate(() => window.__md!.spawnPickup('boost', 0, 40));
  const boosting = await waitFor(page, (x) => x.boosting, 2000);
  await sleep(150);
  const dive = await snap(page);
  await shot(page, 'p6-boost-dive');
  const smash = await waitFor(page, (x) => x.smashed > 0 || !x.boosting, 3000);
  await sleep(40);
  await shot(page, 'p6-boost-smash');
  const released = await waitFor(page, (x) => !x.boosting || x.state !== 'playing', 4000);
  check(
    'boost-dives',
    boosting !== null && dive.vy >= 700 && Math.abs(dive.vx) < 30,
    `vy=${dive.vy.toFixed(0)} vx=${dive.vx.toFixed(1)} (the blue magnet would normally push the orb sideways)`,
  );
  check('boost-smashes-spikes', smash !== null && smash.smashed >= 1 && smash.state === 'playing', `smashed=${smash?.smashed} state=${smash?.state}`);
  check(
    'boost-releases-in-gap',
    released !== null && released.state === 'playing' && released.inGap && Math.abs(released.vy - 300) < 30,
    `released at y=${released?.y.toFixed(0)} inGap=${released?.inGap} vy=${released?.vy.toFixed(0)}`,
  );

  // P7. A token close to the orb drifts in and gets collected without a perfect line.
  await startRun(page, [0, 9]);
  await page.evaluate(() => window.__md!.spawnPickup('shield', 50, 30));
  await sleep(120);
  await shot(page, 'p7-token-drift');
  const drifted = await waitFor(page, (x) => x.collected > 0, 2000);
  check('token-drifts-in', drifted !== null && drifted.shield, `collected=${drifted?.collected} from 58 px away`);

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
  let maxPickups = 0;
  let spawned = 0;
  let collectedNaturally = 0;
  let tokenShot = false;
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    await tap(page);
    const x = await snap(page);
    maxMagnets = Math.max(maxMagnets, x.magnets);
    maxSpikes = Math.max(maxSpikes, x.spikes);
    maxScore = Math.max(maxScore, x.score);
    maxPickups = Math.max(maxPickups, x.pickups.length);
    spawned = Math.max(spawned, x.pickupsSpawned);
    collectedNaturally = Math.max(collectedNaturally, x.collected);
    if (!tokenShot && x.state === 'playing' && x.pickups.some((k) => k.y > x.camY + 40 && k.y < x.camY + 600)) {
      tokenShot = true;
      await shot(page, '08-token-in-play');
    }
    await sleep(150 + Math.random() * 500);
  }
  const frames = await page.evaluate(() => window.__md!.frameWork());
  frames.sort((x, y) => x - y);
  const p95 = frames[Math.floor(frames.length * 0.95)] ?? 0;
  check('bounded-objects', maxMagnets <= 16 && maxSpikes <= 16 && maxPickups <= 6, `max magnets=${maxMagnets} spikes=${maxSpikes} tokens=${maxPickups} best score=${maxScore}`);
  check('tokens-spawn-in-play', spawned > 0, `tokens spawned in the last run=${spawned}, collected in the last run=${collectedNaturally}`);
  check('frame-work', frames.length > 100 && p95 < 8, `p95 update+render=${p95.toFixed(2)} ms over ${frames.length} frames (budget 8 ms)`);
  check('no-console-errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${OUT}`);
process.exit(failed.length ? 1 : 0);
