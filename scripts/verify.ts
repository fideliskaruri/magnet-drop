// End-to-end checks in a real headless browser with real taps.
// Needs the dev server running (pnpm dev). Usage: pnpm verify [baseUrl]
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { AUDIO, CEIL, FLOOR, MID } from '../src/config.ts';
import type { DebugHook } from '../src/debug.ts';
import { TUTORIAL } from '../src/gates.ts';
import { DEFAULTS } from '../src/tune.ts';
import type { Family, GateSpec } from '../src/types.ts';

type Snap = ReturnType<DebugHook['snapshot']>;

const BASE = process.argv[2] ?? 'http://localhost:5182/';
const OUT = join(tmpdir(), 'agent-scratch', 'magnet-drop-proto-b');
mkdirSync(OUT, { recursive: true });

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
}

const snap = (page: Page): Promise<Snap> => page.evaluate(() => window.__md!.snapshot());
const tap = (page: Page): Promise<void> => page.touchscreen.tap(420, 220);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const audio = (page: Page): Promise<ReturnType<DebugHook['audio']>> => page.evaluate(() => window.__md!.audio());
const dbfs = (v: number): string => (v > 0 ? `${(20 * Math.log10(v)).toFixed(1)} dBFS` : '-inf');
const shot = (page: Page, name: string): Promise<Buffer> => page.screenshot({ path: join(OUT, `${name}.png`) });

const gate = (family: Family, v: number[], tier = 3): GateSpec => ({ family, tier, v });
// wall[0] opens at the top: an orb held to the floor runs into its lower block and gets pushed off the left edge.
const WALL_TOP = gate('wall', [0]);
const WALL_MID = gate('wall', [1]);
// splitter[1,1]: the upper lane is blocked by a grinder.
const GRINDER = gate('splitter', [1, 1]);

async function waitFor(page: Page, pred: (s: Snap) => boolean, timeoutMs: number): Promise<Snap | null> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const s = await snap(page);
    if (pred(s)) return s;
    await sleep(16);
  }
  return null;
}

async function boot(page: Page): Promise<void> {
  await page.reload();
  await page.waitForFunction(() => window.__md !== undefined);
}

/** Back to the ready screen, then start a run on the given gates. The start tap launches off the floor as red (pull up). */
async function startRun(page: Page, gates: GateSpec[], seed = 1): Promise<void> {
  await boot(page);
  await page.evaluate(([s, g]) => window.__md!.setup(s as number, g as GateSpec[]), [seed, gates] as const);
  await tap(page);
  await waitFor(page, (s) => s.state === 'playing', 1000);
}

/** Hold the orb at a fixed height through gate i (for each i) by re-placing it between frames. */
function holdThrough(page: Page, ys: number[]): Promise<void> {
  return page.evaluate(async (heights) => {
    const md = window.__md!;
    for (let i = 0; i < heights.length; i++) {
      await new Promise<void>((resolve) => {
        const end = performance.now() + 15000;
        const id = setInterval(() => {
          const s = md.snapshot();
          const g = md.gates().find((q) => q.index === i);
          if (!g || g.scored || s.state !== 'playing' || performance.now() > end) {
            clearInterval(id);
            resolve();
            return;
          }
          if (s.x > g.x - 150) md.place(s.x, heights[i]!, undefined, 0);
        }, 4);
      });
    }
  }, ys);
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
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
  await page.evaluate(() => localStorage.clear());
  await boot(page);
  await sleep(400);
  let s = await snap(page);
  await shot(page, '01-ready');
  const rotateHidden = await page.locator('#rotate').isHidden();
  check('boot', s.state === 'ready' && s.stuck && s.stuckDir === 1 && errors.length === 0 && rotateHidden, `state=${s.state} resting on the floor=${s.stuck && s.stuckDir === 1} rotate hint hidden in landscape=${rotateHidden} errors=${errors.length}`);

  // 2. Start launches off the floor; flip reverses the vertical pull; the arc is smooth (no snapping).
  await page.evaluate((g) => window.__md!.setup(1, g), [WALL_MID, WALL_MID, WALL_MID]);
  await tap(page);
  s = (await waitFor(page, (x) => x.state === 'playing', 1000)) ?? (await snap(page));
  const started = s;
  await sleep(140);
  const rising = await snap(page);
  await page.evaluate(() => {
    const w = window as unknown as { __rec: Snap[]; __recOn: boolean };
    w.__rec = [];
    w.__recOn = true;
    const loop = (): void => {
      if (!w.__recOn) return;
      w.__rec.push(window.__md!.snapshot());
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  await sleep(60);
  await tap(page);
  await sleep(40);
  const flipped = await snap(page);
  await sleep(500);
  const rec = await page.evaluate(() => {
    const w = window as unknown as { __rec: Snap[]; __recOn: boolean };
    w.__recOn = false;
    return w.__rec;
  });
  await shot(page, '02-arc');
  check('start-launch', started.state === 'playing' && started.polarity === 'red' && started.launches === 1 && rising.vy < -100, `polarity=${started.polarity} launches=${started.launches} vy shortly after=${rising.vy.toFixed(0)}`);
  check('flip-reverses-pull', rising.ay < 0 && flipped.polarity === 'blue' && flipped.ay > 0, `red ay=${rising.ay.toFixed(0)} -> blue ay=${flipped.ay.toFixed(0)}`);
  let maxAccel = 0;
  let free = 0;
  for (let i = 1; i < rec.length; i++) {
    const a = rec[i - 1]!;
    const b = rec[i]!;
    const dt = b.t - a.t;
    if (dt <= 0 || a.stuck || b.stuck || b.y < CEIL + 45 || b.y > FLOOR - 45) continue;
    free++;
    maxAccel = Math.max(maxAccel, Math.abs(b.vy - a.vy) / dt);
  }
  const vys = rec.map((r) => r.vy);
  const crossing = vys.findIndex((v, i) => i > 0 && vys[i - 1]! < 0 && v >= 0);
  const between = vys.filter((v) => v > -150 && v < 150).length;
  check(
    'arc-not-snap',
    free > 6 && maxAccel < DEFAULTS.pull * 1.25 + DEFAULTS.damping * DEFAULTS.maxVy && crossing > 0 && between >= 2,
    `${free} free frames, max |dvy/dt|=${maxAccel.toFixed(0)} px/s2 (pull ${DEFAULTS.pull}), vy turned over at frame ${crossing} with ${between} frames in -150..150`,
  );

  // 3. Rail stick and launch: red rides up and sticks to the ceiling rail; a flip launches it down.
  await startRun(page, [WALL_TOP, WALL_TOP, WALL_TOP]);
  const onCeil = await waitFor(page, (x) => x.stuck && x.stuckDir === -1, 3000);
  await sleep(150);
  await shot(page, '03-ceiling-stuck');
  await tap(page);
  await sleep(30);
  const launched = await snap(page);
  await sleep(90);
  await shot(page, '03-launched');
  check(
    'rail-stick-and-launch',
    onCeil !== null && launched.launches === 2 && !launched.stuck && launched.vy > DEFAULTS.launchSpeed * 0.7,
    `stuck to ceiling=${onCeil !== null} launches=${launched.launches} vy after flip=${launched.vy.toFixed(0)} (launchSpeed ${DEFAULTS.launchSpeed})`,
  );

  // 4. Scoring: a centre pass is +2, an off-centre pass +1. Then held on the floor against a wall: pushed off the left edge.
  await page.evaluate(() => localStorage.clear());
  await startRun(page, [WALL_MID, WALL_MID, WALL_TOP]);
  await holdThrough(page, [MID, MID + 45]);
  const scored = await snap(page);
  await shot(page, '04-scored');
  check('gate-score-and-centre', scored.score === 3 && scored.gatesCleared === 2 && scored.centres === 1, `score=${scored.score} gates=${scored.gatesCleared} centre passes=${scored.centres} (expected 3/2/1)`);
  if (scored.polarity === 'red') await tap(page);
  let peakEdge = 0;
  let camDeath: Snap | null = null;
  const camEnd = Date.now() + 12000;
  while (Date.now() < camEnd) {
    const x = await snap(page);
    if (x.state === 'dying') {
      camDeath = x;
      break;
    }
    peakEdge = Math.max(peakEdge, (await page.evaluate(() => window.__md!.mix())).danger);
    if (x.screenX < 60) await shot(page, '04-pushed');
    await sleep(30);
  }
  await sleep(150);
  await shot(page, '04-death-camera');
  check('pushed-off-left', camDeath !== null && camDeath.deathCause === 'camera' && peakEdge > 0.5, `died=${camDeath !== null} cause=${camDeath?.deathCause} edge danger peaked ${peakEdge.toFixed(2)}`);
  await sleep(250);
  const t0 = Date.now();
  await tap(page);
  const back = await waitFor(page, (x) => x.state === 'playing', 1000);
  const restartMs = Date.now() - t0;
  check('restart-under-1s', back !== null && back.score === 0 && restartMs < 1000, `restart took ${restartMs} ms (after the 300 ms lockout), score reset to ${back?.score}`);
  await boot(page);
  const best = (await snap(page)).best;
  const keys = await page.evaluate(() => Object.keys(localStorage));
  check('best-persists', best === 3 && keys.includes('magnetdrop.proto-b.best'), `best after reload=${best} keys=${keys.join(',')}`);

  // 5. Hazard death: red (pull up) placed in the upper lane of a splitter whose upper lane holds a grinder.
  await startRun(page, [GRINDER]);
  const near = await waitFor(page, (x) => x.gateX !== null && x.gateX - x.x < 260, 5000);
  if (near?.gateX != null) await page.evaluate((gx) => window.__md!.place(gx + 30, 52, undefined, 0), near.gateX);
  const hz = await waitFor(page, (x) => x.state === 'dying', 4000);
  await sleep(120);
  await shot(page, '05-death-hazard');
  check('hazard-death', hz !== null && hz.deathCause === 'hazard', `died=${hz !== null} cause=${hz?.deathCause}`);

  // 6. Every gate family on screen (the orb is held at mid height so it reaches each gate).
  const families: [Family, number[]][] = [
    ['wall', [1]],
    ['dual', [0, 1, 1]],
    ['pinball', [1, 1]],
    ['splitter', [2, 1]],
    ['tunnel', [1, 1, 1]],
    ['door', [1, 0]],
    ['pendulum', [1, 1]],
    ['rails', [1, 0, 1]],
  ];
  let wrong = 0;
  for (const [family, v] of families) {
    await startRun(page, [gate(family, v), WALL_MID]);
    const at = await waitFor(page, (x) => x.gateX !== null, 3000);
    // Hold the orb mid-height until the gate is well on screen.
    await page.evaluate(
      (y) =>
        new Promise<void>((resolve) => {
          const md = window.__md!;
          const end = performance.now() + 6000;
          const id = setInterval(() => {
            const s = md.snapshot();
            if (s.state !== 'playing' || s.gateX === null || s.gateX - s.camX < 330 || performance.now() > end) {
              clearInterval(id);
              resolve();
              return;
            }
            md.place(s.x, y, undefined, 0);
          }, 4);
        }),
      MID - 40,
    );
    await sleep(120);
    await shot(page, `06-${family}`);
    if (at?.family !== family) {
      wrong++;
      console.log(`      ${family}: next gate was ${at?.family}`);
    }
  }
  check('gate-screens', wrong === 0, `${families.length} families shown, wrong gate in ${wrong}, saved to ${OUT}`);

  // 6b. Generation: deterministic per seed, the fixed tutorial first, every family appears later.
  const runs = await page.evaluate(() => [window.__md!.preview(7, 60), window.__md!.preview(7, 60), window.__md!.preview(8, 60)]);
  const [r7, r7b, r8] = runs.map((r) => JSON.stringify(r));
  const tut = runs[0]!.slice(0, TUTORIAL.length).map((g) => `${g.family}${g.v.join('')}`).join(',');
  const tutWant = TUTORIAL.map((g) => `${g.family}${g.v.join('')}`).join(',');
  const famLate = new Set(runs[0]!.slice(TUTORIAL.length).map((g) => g.family));
  const tiers = runs[0]!.map((g) => g.tier);
  check('seeded-generation', r7 === r7b && r7 !== r8, `same seed identical=${r7 === r7b}, other seed differs=${r7 !== r8}`);
  check('tutorial-then-ramp', tut === tutWant && famLate.size === 8 && tiers.every((t, i) => i === 0 || t >= tiers[i - 1]!), `tutorial ${tut}; ${famLate.size} families after it; tiers ${tiers.join('')}`);

  // 7. Sound: offline renders through the real output chain are audible and never clip.
  const names = await page.evaluate(() => window.__md!.soundNames());
  const renders = [];
  for (const n of names) renders.push(await page.evaluate((x) => window.__md!.renderSound(x), n));
  const quiet = renders.filter((r) => r.peak < 0.05 || r.rms < 0.002);
  const hot = renders.filter((r) => r.peak >= 0.99 || r.clipped > 0);
  check('sounds-audible', quiet.length === 0, quiet.map((r) => `${r.name} ${dbfs(r.peak)}`).join(', ') || `${renders.length} sounds all audible`);
  check('sounds-not-clipping', hot.length === 0, hot.map((r) => `${r.name} ${dbfs(r.peak)}`).join(', ') || `loudest ${dbfs(Math.max(...renders.map((r) => r.peak)))}`);

  // 8. Real play: random taps for 20 s on generated courses, auto-restarting. Per-frame work must stay small.
  await page.evaluate(() => window.__md!.setup(null, []));
  await page.evaluate(() => window.__md!.resetFrameWork());
  let maxScore = 0;
  let maxVoices = 0;
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    await tap(page);
    const x = await snap(page);
    maxScore = Math.max(maxScore, x.score);
    maxVoices = Math.max(maxVoices, (await audio(page)).voices);
    await sleep(150 + Math.random() * 450);
  }
  await shot(page, '08-play');
  const frames = await page.evaluate(() => window.__md!.frameWork());
  frames.sort((a, b) => a - b);
  const p95 = frames[Math.floor(frames.length * 0.95)] ?? 0;
  check('frame-work', frames.length > 100 && p95 < 8, `p95 update+render=${p95.toFixed(2)} ms over ${frames.length} frames (budget 8 ms), best score while mashing=${maxScore}`);
  check('bounded-voices', maxVoices <= AUDIO.maxVoices + 1, `max concurrent voices=${maxVoices}, cap=${AUDIO.maxVoices}`);
  await waitFor(page, (x) => x.state === 'ready', 20000);
  await sleep(1000);
  const idle0 = await audio(page);
  await sleep(1500);
  const idle1 = await audio(page);
  check('no-per-frame-nodes', idle1.nodesCreated === idle0.nodesCreated, `audio nodes created during 1.5 s of frames: ${idle1.nodesCreated - idle0.nodesCreated}`);

  // 9. Every effect at once: frame budget and the 3 flashes per second limiter.
  await startRun(page, [WALL_MID, WALL_MID]);
  await page.evaluate(() => {
    window.__md!.setStress(true);
    window.__md!.resetFrameWork();
    window.__md!.resetJuiceStats();
  });
  await sleep(3000);
  await shot(page, '09-stress');
  await sleep(3000);
  const stressFrames = await page.evaluate(() => window.__md!.frameWork());
  const juice = await page.evaluate(() => window.__md!.juice());
  await page.evaluate(() => window.__md!.setStress(false));
  stressFrames.sort((a, b) => a - b);
  const sp95 = stressFrames[Math.floor(stressFrames.length * 0.95)] ?? 0;
  check('frame-work-all-effects', stressFrames.length > 60 && sp95 < 8, `p95=${sp95.toFixed(2)} ms over ${stressFrames.length} frames, peak particles=${juice.particles}`);
  const ft = juice.flashTimes;
  let worst = 0;
  for (let i = 0; i < ft.length; i++) worst = Math.max(worst, ft.filter((t) => t >= ft[i]! && t < ft[i]! + 1).length);
  check('flash-limit', ft.length > 3 && worst <= 3, `${ft.length} big flashes in 6 s of nonstop requests, worst 1 s window=${worst} (limit 3), max shake ${juice.maxShakePx.toFixed(1)} px`);

  // 10. Analytics: the events from this session are recorded locally and the summary adds up.
  const an = await page.evaluate(() => window.__md!.analytics());
  const kinds = new Set(an.events.map((e) => e.event as string));
  const stored = await page.evaluate(() => (localStorage.getItem('magnetdrop.proto-b.analytics') ?? '').length);
  const deathEv = an.events.find((e) => e.event === 'death' && e.cause === 'camera');
  const gateEv = an.events.find((e) => e.event === 'gate_clear');
  const sm = an.summary;
  check(
    'analytics-events',
    ['session_start', 'run_start', 'gate_clear', 'death', 'restart'].every((k) => kinds.has(k)) && stored > 0 && deathEv !== undefined && 'gateType' in deathEv && 'runMs' in deathEv && gateEv !== undefined && 'type' in gateEv && 'clean' in gateEv,
    `${an.events.length} events, kinds ${[...kinds].join(',')}, sample death ${JSON.stringify(deathEv)}`,
  );
  check(
    'analytics-summary',
    sm.runs > 5 && sm.deaths > 3 && sm.sessions >= 1 && sm.retryAfterDeathRate > 0 && sm.retryAfterDeathRate <= 1 && sm.deathsBeforeGate3Share >= 0 && sm.deathsBeforeGate3Share <= 1 && sm.distinctDays === 1 && (sm.deathsByGateType.wall ?? 0) >= 1,
    JSON.stringify({ runs: sm.runs, deaths: sm.deaths, runsPerSession: sm.runsPerSession, medianGates: sm.medianGatesCleared, retry: sm.retryAfterDeathRate, early: sm.deathsBeforeGate3Share, byType: sm.deathsByGateType, reach: sm.reachPct, days: sm.distinctDays }),
  );

  // 11. Tuning panel: pauses, Stats section, sliders apply and persist, reset works.
  await startRun(page, [WALL_MID, WALL_MID]);
  await sleep(300);
  await page.keyboard.press('KeyT');
  const q0 = await snap(page);
  await sleep(500);
  const q1 = await snap(page);
  const paused = (await page.evaluate(() => window.__md!.tune())).paused;
  check('panel-pauses', paused && (await page.locator('#tune').isVisible()) && q0.x === q1.x && q0.y === q1.y, `open=${paused} orb x ${q0.x.toFixed(1)} -> ${q1.x.toFixed(1)} over 500 ms`);
  const statRows = await page.locator('#tune .tune-stats dt').count();
  const statText = (await page.locator('#tune .tune-stats').textContent()) ?? '';
  await page.evaluate(() => {
    const el = document.querySelector<HTMLInputElement>('#tune input[name="baseSpeed"]')!;
    el.value = '230';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const tuned = (await page.evaluate(() => window.__md!.tune())).values.baseSpeed;
  await shot(page, '11-panel');
  await page.locator('#tune').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.getByRole('button', { name: 'Copy stats JSON' }).click();
  await sleep(150);
  const status = (await page.locator('#tune .tune-status').textContent()) ?? '';
  await shot(page, '11-panel-stats');
  check('panel-stats', statRows >= 6 && /run/i.test(statText) && status.length > 0, `${statRows} stat rows, copy status "${status}"`);
  check('slider-applies', tuned === 230, `baseSpeed=${tuned}`);
  await page.keyboard.press('Escape');
  await sleep(300);
  const q2 = await snap(page);
  check('panel-closes-and-resumes', !(await page.evaluate(() => window.__md!.tune())).paused && q2.x !== q1.x, `orb x ${q1.x.toFixed(1)} -> ${q2.x.toFixed(1)}`);
  await boot(page);
  const persisted = (await page.evaluate(() => window.__md!.tune())).values.baseSpeed;
  await page.locator('#tune-toggle').tap();
  await sleep(100);
  await page.locator('#tune').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.getByRole('button', { name: 'Reset to defaults' }).click();
  const reset = (await page.evaluate(() => window.__md!.tune())).values;
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Clear stats' }).click();
  await sleep(150);
  const afterClear = await page.evaluate(() => window.__md!.analytics().events.length);
  await page.keyboard.press('Escape');
  check('tune-persists-and-resets', persisted === 230 && JSON.stringify(reset) === JSON.stringify(DEFAULTS), `after reload baseSpeed=${persisted}; after reset defaults=${JSON.stringify(reset) === JSON.stringify(DEFAULTS)}`);
  check('clear-stats', afterClear <= 1, `events after clear=${afterClear}`);

  // 12. Portrait phone: rotate hint shown, still playable letterboxed.
  const portrait = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const pp = await portrait.newPage();
  pp.on('pageerror', (e) => errors.push(e.message));
  await pp.goto(BASE);
  await pp.waitForFunction(() => window.__md !== undefined);
  const hintShown = await pp.locator('#rotate').isVisible();
  await pp.touchscreen.tap(195, 420);
  await sleep(600);
  const ps = await pp.evaluate(() => window.__md!.snapshot());
  await pp.screenshot({ path: join(OUT, '12-portrait.png') });
  check('portrait', hintShown && ps.state === 'playing', `rotate hint visible=${hintShown} state after tap=${ps.state}`);
  await portrait.close();

  check('no-console-errors', errors.length === 0, errors.slice(0, 5).join(' | ') || 'none');
} catch (e) {
  check('script', false, String(e));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots in ${OUT}`);
process.exit(failed.length ? 1 : 0);
