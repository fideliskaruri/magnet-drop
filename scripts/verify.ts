// End-to-end checks in a real headless browser with real taps.
// Needs the dev server running (pnpm dev). Usage: pnpm verify [baseUrl]
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { AUDIO } from '../src/config.ts';
import type { DebugHook } from '../src/debug.ts';

type Snap = ReturnType<DebugHook['snapshot']>;

const BASE = process.argv[2] ?? 'http://localhost:5180/';
const OUT = join(tmpdir(), 'agent-scratch', 'magnet-drop-sound');
mkdirSync(OUT, { recursive: true });

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
}

const snap = (page: Page): Promise<Snap> => page.evaluate(() => window.__md!.snapshot());
const tap = (page: Page): Promise<void> => page.touchscreen.tap(195, 500);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const audio = (page: Page): Promise<ReturnType<DebugHook['audio']>> => page.evaluate(() => window.__md!.audio());
const mix = (page: Page): Promise<ReturnType<DebugHook['mix']>> => page.evaluate(() => window.__md!.mix());
const dbfs = (v: number): string => (v > 0 ? `${(20 * Math.log10(v)).toFixed(1)} dBFS` : '-inf');
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
  const au0 = await audio(page);
  check('audio-running-after-tap', au0.state === 'running' && !au0.muted && au0.persistentNodes > 0, `context=${au0.state} muted=${au0.muted} persistent nodes=${au0.persistentNodes}`);

  // 2b. Mute button: toggles sound, never flips polarity, survives a reload.
  const box = await page.locator('#mute').boundingBox();
  const bx = (box?.x ?? 0) + (box?.width ?? 0) / 2;
  const by = (box?.y ?? 0) + (box?.height ?? 0) / 2;
  const polBefore = (await snap(page)).polarity;
  await page.touchscreen.tap(bx, by);
  await sleep(200);
  const mutedSnap = await snap(page);
  const mutedAudio = await audio(page);
  await shot(page, '02b-muted');
  await page.reload();
  await page.waitForFunction(() => window.__md !== undefined);
  const mutedAfterReload = (await audio(page)).muted;
  const label = await page.locator('#mute').getAttribute('aria-label');
  await tap(page);
  await sleep(100);
  const stillMuted = await audio(page);
  await page.touchscreen.tap(bx, by);
  await sleep(150);
  const unmuted = await audio(page);
  check(
    'mute-toggle',
    mutedSnap.polarity === polBefore && mutedAudio.muted && mutedAfterReload && label === 'Turn sound on' && stillMuted.muted && stillMuted.state !== 'running' && !unmuted.muted && unmuted.state === 'running',
    `polarity ${polBefore}->${mutedSnap.polarity}, muted=${mutedAudio.muted}, after reload muted=${mutedAfterReload} (${label}), tap while muted ctx=${stillMuted.state}, unmuted ctx=${unmuted.state}`,
  );

  // 2c. Offline renders of every sound through the real output chain: audible, no clipping, voices released.
  const names = await page.evaluate(() => window.__md!.soundNames());
  const renders = [];
  for (const n of names) renders.push(await page.evaluate((x) => window.__md!.renderSound(x), n));
  for (const r of renders) console.log(`      ${r.name.padEnd(13)} peak ${dbfs(r.peak).padStart(11)}  rms ${dbfs(r.rms).padStart(11)}`);
  const quiet = renders.filter((r) => r.peak < 0.05 || r.rms < 0.002);
  const hot = renders.filter((r) => r.peak >= 0.99 || r.clipped > 0);
  const leaked = renders.filter((r) => r.voicesAfter !== 0 && !r.name.startsWith('layer') && r.name !== 'everything');
  const worst = renders.find((r) => r.name === 'everything');
  check('sounds-audible', renders.length === names.length && quiet.length === 0, quiet.map((r) => `${r.name} ${dbfs(r.peak)}`).join(', ') || `${renders.length} sounds all above -26 dBFS peak`);
  check('sounds-not-clipping', hot.length === 0, hot.map((r) => `${r.name} ${dbfs(r.peak)}`).join(', ') || `loudest single ${dbfs(Math.max(...renders.filter((r) => r.name !== 'everything').map((r) => r.peak)))}, everything at once ${dbfs(worst?.peak ?? 0)}`);
  check('voices-released', leaked.length === 0, leaked.map((r) => r.name).join(', ') || 'every one-shot freed its voice when done');

  // 3. Attract vs repel on pattern 1 (red magnet at x=260, orb falls at x=180).
  await startRun(page, [0]);
  let a = await waitFor(page, (x) => x.patternTop !== null && x.y > x.patternTop + 80, 3000);
  await sleep(250);
  const attractMix = await mix(page);
  let b = await snap(page);
  const attractVx = b.vx;
  check('attract-pulls-toward', a !== null && attractVx > 20, `blue orb vx=${attractVx.toFixed(1)} (magnet is to the right)`);
  await startRun(page, [0]);
  await tap(page);
  a = await waitFor(page, (x) => x.patternTop !== null && x.y > x.patternTop + 80, 3000);
  await sleep(250);
  const repelMix = await mix(page);
  b = await snap(page);
  await shot(page, '03-repel');
  check('field-sound-follows', attractMix.attract > 0.2 && attractMix.repel === 0 && repelMix.repel > 0.2 && repelMix.attract === 0, `blue near red: hum=${attractMix.attract.toFixed(2)} buzz=${attractMix.repel.toFixed(2)}; red near red: hum=${repelMix.attract.toFixed(2)} buzz=${repelMix.repel.toFixed(2)}`);
  check('repel-pushes-away', a !== null && b.polarity === 'red' && b.vx < -20, `red orb vx=${b.vx.toFixed(1)}`);

  // 4. Stick and launch on pattern 4 (red magnet the blue orb falls onto).
  await startRun(page, [3]);
  const stuck = await waitFor(page, (x) => x.stuck, 4000);
  await sleep(150);
  const stuckMix = await mix(page);
  await shot(page, '04-stuck');
  await tap(page);
  await sleep(80);
  const afterLaunch = await snap(page);
  const speed = Math.hypot(afterLaunch.vx, afterLaunch.vy);
  await sleep(120);
  await shot(page, '04-launched');
  check('stuck-sound', stuckMix.stuck === 1 && stuckMix.attract === 0, `stuck layer=${stuckMix.stuck} hum=${stuckMix.attract}`);
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
  let peakDanger = 0;
  let stallDeath: Snap | null = null;
  const stallEnd = Date.now() + 12000;
  while (Date.now() < stallEnd) {
    const x = await snap(page);
    if (x.state === 'dying') {
      stallDeath = x;
      break;
    }
    peakDanger = Math.max(peakDanger, (await mix(page)).danger);
    await sleep(16);
  }
  check('stall-danger-sound', peakDanger > 0.6, `danger layer peaked at ${peakDanger.toFixed(2)} before the screen caught the orb`);
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
  let maxOut = 0;
  let maxVoices = 0;
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    await tap(page);
    const x = await snap(page);
    maxMagnets = Math.max(maxMagnets, x.magnets);
    maxSpikes = Math.max(maxSpikes, x.spikes);
    maxScore = Math.max(maxScore, x.score);
    const au = await audio(page);
    maxOut = Math.max(maxOut, au.outputPeak);
    maxVoices = Math.max(maxVoices, au.voices);
    await sleep(150 + Math.random() * 500);
  }
  const mash = await audio(page);
  check('live-output', maxOut > 0.02 && maxOut < 1, `live output peak ${dbfs(maxOut)} while playing (audible, under full scale)`);
  check('bounded-voices', maxVoices <= AUDIO.maxVoices + 1 && mash.peakVoices <= AUDIO.maxVoices + 1, `max concurrent voices sampled=${maxVoices}, engine peak=${mash.peakVoices}, cap=${AUDIO.maxVoices} (+1 for death), dropped=${mash.dropped}`);
  // Let it fall back to the ready screen; the per-frame mix updates must not create nodes, and every voice must free up.
  await waitFor(page, (x) => x.state === 'ready', 6000);
  await sleep(1500);
  const idle0 = await audio(page);
  await sleep(1500);
  const idle1 = await audio(page);
  check('no-per-frame-nodes', idle1.nodesCreated === idle0.nodesCreated && idle1.voices === 0, `nodes created during 1.5 s of frames: ${idle1.nodesCreated - idle0.nodesCreated}, voices still playing: ${idle1.voices}, total nodes ever: ${idle1.nodesCreated}`);
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
