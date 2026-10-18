// End-to-end checks for Prototype A in a real headless browser with real taps.
// Needs the dev server running (pnpm dev). Usage: pnpm verify [baseUrl]
// Every scenario pins its first gates with window.__md.setup, so the outcome of an idle (no taps) red orb
// dropped at x=180 is known in advance (the same physics the simulator runs).
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { AUDIO, BEST_KEY } from '../src/config.ts';
import type { DebugHook } from '../src/debug.ts';
import { DEFAULTS } from '../src/tune.ts';
import type { Family, GateSpec } from '../src/types.ts';

type Snap = ReturnType<DebugHook['snapshot']>;

const BASE = process.argv[2] ?? 'http://localhost:5181/';
const OUT = join(tmpdir(), 'agent-scratch', 'magnet-drop-proto-a');
mkdirSync(OUT, { recursive: true });
const ANALYTICS_KEY = 'magnetdrop.proto-a.analytics';

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
const gate0 = (page: Page): Promise<{ state: number[]; polarities: (string | null)[] }> =>
  page.evaluate(() => {
    const g = window.__md!.gates().find((x) => x.index === 0)!;
    return { state: [...g.state], polarities: g.solids.map((s) => s.polarity) };
  });

const spec = (family: Family, variant = 0, tier = 0, o: Partial<GateSpec> = {}): GateSpec => ({ family, tier, variant, mirror: false, swap: false, ...o });

// What an idle red orb dropped at x=180 does (worked out with the real physics):
// - learn-repel: a red magnet to the right pushes it left into the exit. Flipped to blue it is pulled right and sticks.
const REPEL = spec('learn-repel');
// - learn-launch: it sticks to the blue rail. A tap flips it to blue and the rail launches it.
const LAUNCH = spec('learn-launch');
// - learn-attract: the blue door pulls it straight down through the centre (a clean pass).
const ATTRACT = spec('learn-attract');
// - iris[3]: it sticks under the blue magnet above the iris and waits there until the screen catches it.
const TRAP = spec('iris', 3, 3);
// - polarity[3] tier 3: it drops through the blue door into the saw sweeping under the opening.
const SAW = spec('polarity', 3, 3);

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
  await page.evaluate(([s, p]) => window.__md!.setup(s as number, p as GateSpec[]), [seed, gates] as const);
  await tap(page);
  await waitFor(page, (s) => s.state === 'playing', 1000);
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

try {
  // 1. Boot on a clean device.
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.__md !== undefined);
  await sleep(300);
  let s = await snap(page);
  await shot(page, '01-menu');
  check('boot', s.state === 'ready' && errors.length === 0, `state=${s.state} errors=${errors.length}`);

  // 2. Start and flip.
  await page.evaluate((g) => window.__md!.setup(1, g), [REPEL]);
  await tap(page);
  s = (await waitFor(page, (x) => x.state === 'playing', 1000)) ?? (await snap(page));
  const p0 = s.polarity;
  await tap(page);
  await sleep(50);
  const p1 = (await snap(page)).polarity;
  await shot(page, '02-flipped-blue');
  await tap(page);
  await sleep(50);
  const p2 = (await snap(page)).polarity;
  check('start-and-flip', s.state === 'playing' && p0 === 'red' && p1 === 'blue' && p2 === 'red', `${s.state} ${p0}->${p1}->${p2}`);
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

  // 3. Attract vs repel on the repel lesson: a red magnet to the right of the drop line.
  const drifted = (x: Snap): boolean => Math.abs(x.x - 180) > 15;
  await startRun(page, [REPEL]);
  let b = await waitFor(page, drifted, 4000);
  const repelMix = await mix(page);
  await sleep(150);
  await shot(page, '03-repel');
  check('repel-pushes-away', b !== null && b.polarity === 'red' && b.x < 165 && b.vx < 0, `red orb x=${b?.x.toFixed(0)} vx=${b?.vx.toFixed(1)} (red magnet on the right)`);
  await startRun(page, [REPEL]);
  await tap(page);
  const pulled = await waitFor(page, (x) => x.x > 184, 4000);
  const attractMix = await mix(page);
  b = pulled && (await waitFor(page, drifted, 3000));
  const attractStuck = await waitFor(page, (x) => x.stuck, 3000);
  await shot(page, '03-attract-stuck');
  check('attract-pulls-toward', b !== null && b.polarity === 'blue' && b.x > 195 && b.vx > 0 && attractStuck !== null, `blue orb x=${b?.x.toFixed(0)} vx=${b?.vx.toFixed(1)}, stuck to the magnet=${attractStuck !== null}`);
  check('field-sound-follows', attractMix.attract > 0.2 && attractMix.repel === 0 && repelMix.repel > 0.2 && repelMix.attract === 0, `blue near red: hum=${attractMix.attract.toFixed(2)} buzz=${attractMix.repel.toFixed(2)}; red near red: hum=${repelMix.attract.toFixed(2)} buzz=${repelMix.repel.toFixed(2)}`);

  // 4. Stick and launch on the launch lesson's rail.
  await startRun(page, [LAUNCH]);
  const stuck = await waitFor(page, (x) => x.stuck, 4000);
  await sleep(150);
  const stuckMix = await mix(page);
  await shot(page, '04-stuck');
  await tap(page);
  await sleep(60);
  const afterLaunch = await snap(page);
  const speed = Math.hypot(afterLaunch.vx, afterLaunch.vy);
  await sleep(120);
  await shot(page, '04-launched');
  const launchCleared = await waitFor(page, (x) => x.cleared >= 1, 4000);
  check('stuck-sound', stuckMix.stuck === 1 && stuckMix.attract === 0, `stuck layer=${stuckMix.stuck} hum=${stuckMix.attract}`);
  check(
    'stick-and-launch',
    stuck !== null && afterLaunch.launches === 1 && !afterLaunch.stuck && speed >= DEFAULTS.launchSpeed * 0.85 && launchCleared !== null,
    `stuck=${stuck !== null} launches=${afterLaunch.launches} speed=${speed.toFixed(0)} (launch ${DEFAULTS.launchSpeed}), cleared the gate=${launchCleared !== null}`,
  );

  // 5. Scoring: +1 per gate, +1 for a clean centre pass, a combo for clean passes in a row.
  // Attract lesson (clean, straight down the middle), then the polarity lesson, then the launch lesson,
  // where the idle orb sticks and the screen catches it.
  await startRun(page, [ATTRACT, spec('learn-polarity')]);
  const first = await waitFor(page, (x) => x.cleared >= 1, 6000);
  await sleep(120);
  await shot(page, '05-clean-pass');
  const second = await waitFor(page, (x) => x.cleared >= 2, 6000);
  const pass2 = second?.lastPass;
  check(
    'gate-score-clean-bonus',
    first !== null && first.score === 2 && first.combo === 1 && first.lastPass?.clean === true && Math.abs(first.lastPass.x - 180) < 30,
    `after the first gate: score=${first?.score} combo=${first?.combo} clean=${first?.lastPass?.clean} at x=${first?.lastPass?.x.toFixed(0)}`,
  );
  check(
    'score-adds-up',
    second !== null && pass2 !== null && pass2 !== undefined && second.score === second.cleared + second.cleanPasses && second.combo === (pass2.clean ? 2 : 0),
    `after two gates: score=${second?.score} cleared=${second?.cleared} clean=${second?.cleanPasses} combo=${second?.combo} (second pass clean=${pass2?.clean} at x=${pass2?.x.toFixed(0)})`,
  );
  const caughtLaunch = await waitFor(page, (x) => x.state === 'dying', 20000);
  const runScore = caughtLaunch?.score ?? 0;
  await sleep(200);
  await shot(page, '05b-caught');
  check('stall-on-lesson-caught', caughtLaunch !== null && caughtLaunch.deathCause === 'camera', `idle on the launch lesson: died=${caughtLaunch !== null} cause=${caughtLaunch?.deathCause} score=${runScore}`);
  await page.reload();
  await page.waitForFunction(() => window.__md !== undefined);
  const best = (await snap(page)).best;
  const keys = await page.evaluate(() => Object.keys(localStorage));
  await shot(page, '05c-menu-best');
  check('best-persists', best === runScore && best >= 3 && keys.includes(BEST_KEY), `best after reload=${best} keys=${keys.join(',')}`);

  // 6. Camera catch: stuck under a magnet, never tapping. The crusher bar warns, then the screen takes you.
  await startRun(page, [TRAP]);
  const hung = await waitFor(page, (x) => x.stuck, 4000);
  let peakDanger = 0;
  let caught: Snap | null = null;
  let warned = false;
  const stallEnd = Date.now() + 15000;
  while (Date.now() < stallEnd) {
    const x = await snap(page);
    if (x.state === 'dying') {
      caught = x;
      break;
    }
    const d = (await mix(page)).danger;
    peakDanger = Math.max(peakDanger, d);
    if (!warned && d > 0.5) {
      await shot(page, '06a-camera-closing');
      warned = true;
    }
    await sleep(16);
  }
  await sleep(150);
  await shot(page, '06b-camera-death');
  check('stall-danger-sound', peakDanger > 0.6, `danger layer peaked at ${peakDanger.toFixed(2)} before the screen caught the orb`);
  check('camera-catch-death', hung !== null && caught !== null && caught.deathCause === 'camera', `stuck=${hung !== null} died=${caught !== null} cause=${caught?.deathCause} y=${caught?.y.toFixed(0)} camY=${caught?.camY.toFixed(0)}`);

  // 7. Hazard death (the saw under a tier 3 polarity gate), then a fast restart in the same page.
  await startRun(page, [SAW]);
  const sawDeath = await waitFor(page, (x) => x.state === 'dying', 8000);
  await sleep(200);
  await shot(page, '07-hazard-death');
  check('hazard-death', sawDeath !== null && sawDeath.deathCause === 'hazard', `died=${sawDeath !== null} cause=${sawDeath?.deathCause} at x=${sawDeath?.x.toFixed(0)}`);
  await sleep(250);
  const t0 = Date.now();
  await tap(page);
  const back = await waitFor(page, (x) => x.state === 'playing', 1000);
  const restartMs = Date.now() - t0;
  check('restart-under-1s', back !== null && back.score === 0 && restartMs < 1000, `restart took ${restartMs} ms from the tap (after a 450 ms look at the death), score reset to ${back?.score}`);
  await sleep(300);

  // 8. Each gate type, framed as the orb arrives, plus the thing that makes it that type.
  const types: { name: string; spec: GateSpec; taps?: boolean }[] = [
    { name: 'learn-attract', spec: ATTRACT },
    { name: 'learn-repel', spec: REPEL },
    { name: 'learn-launch', spec: LAUNCH },
    { name: 'learn-polarity', spec: spec('learn-polarity') },
    { name: 'learn-mixed', spec: spec('learn-mixed') },
    { name: 'polarity-t3-saw', spec: SAW },
    { name: 'iris', spec: spec('iris', 0, 1) },
    { name: 'iris-t3-magnet', spec: spec('iris', 2, 3) },
    { name: 'flipper-side', spec: spec('flipper', 0, 1) },
    { name: 'flipper-v', spec: spec('flipper', 2, 3) },
    { name: 'rail-zigzag', spec: spec('rail', 2, 1) },
    { name: 'rail-saw', spec: spec('rail', 3, 2) },
    { name: 'alternating-split', spec: spec('alternating', 1, 1) },
    { name: 'alternating-t3-saw', spec: spec('alternating', 3, 3) },
    { name: 'iron', spec: spec('iron', 0, 2) },
    { name: 'iron-t3', spec: spec('iron', 1, 3) },
  ];
  let wrongScreens = 0;
  for (const t of types) {
    await startRun(page, [t.spec]);
    const x = await waitFor(page, (q) => q.gateTop !== null && q.y > q.gateTop + 90, 4000);
    await sleep(80);
    await shot(page, `08-${t.name}`);
    if (x?.family !== t.spec.family || x.tier !== t.spec.tier) {
      wrongScreens += 1;
      check(`screen-${t.name}`, false, `orb is in ${x?.family} t${x?.tier}`);
    }
  }
  check('gate-type-screens', wrongScreens === 0, `${types.length} screens, wrong gate in ${wrongScreens}, saved to ${OUT}`);

  // 8b. Moving parts do what they claim.
  await startRun(page, [spec('iris', 0, 1)]);
  const irisOpen = await waitFor(page, (q) => q.cleared >= 1, 4000);
  const irisState = (await gate0(page)).state[0] ?? 0;
  await startRun(page, [spec('iris', 0, 1)]);
  await tap(page);
  await sleep(1800);
  const irisShut = (await gate0(page)).state[0] ?? 0;
  const irisBlocked = (await snap(page)).cleared === 0;
  check('iris-opens-for-its-colour', irisOpen !== null && irisState > 0.5 && irisShut < 0.05 && irisBlocked, `red orb: through=${irisOpen !== null} arms open=${irisState.toFixed(2)}; blue orb: arms=${irisShut.toFixed(2)} held above=${irisBlocked}`);

  await startRun(page, [spec('flipper', 0, 1)]);
  const kicked = await waitFor(page, (q) => q.kicks >= 1, 4000);
  await shot(page, '08b-flipper-kick');
  const kickedThrough = await waitFor(page, (q) => q.cleared >= 1, 4000);
  check('flipper-kicks-same-colour', kicked !== null && kickedThrough !== null, `kicks=${kicked?.kicks} cleared after the kick=${kickedThrough !== null}`);

  await startRun(page, [spec('alternating', 0, 1)]);
  const alt0 = await gate0(page);
  await sleep(2100);
  const alt1 = await gate0(page);
  check('alternating-swaps', JSON.stringify(alt0.polarities) !== JSON.stringify(alt1.polarities), `door colours ${alt0.polarities.filter(Boolean).join('/')} -> ${alt1.polarities.filter(Boolean).join('/')} over 2.1 s`);

  await startRun(page, [spec('iron', 0, 2)]);
  const slab0 = (await gate0(page)).state[0] ?? 0;
  await waitFor(page, (q) => q.cleared >= 1, 4000);
  const slab1 = (await gate0(page)).state[0] ?? 0;
  check('iron-slab-dragged', Math.abs(slab1 - slab0) > 40, `slab centre ${slab0.toFixed(0)} -> ${slab1.toFixed(0)} as the red orb arrived (end magnets drag it, the orb never touches it)`);

  // 8c. Generation: tutorial first, deterministic per seed, ramps up.
  const runs = await page.evaluate(() => [window.__md!.preview(7, 40), window.__md!.preview(7, 40), window.__md!.preview(8, 40)]);
  const [r7, r7b, r8] = runs.map((r) => JSON.stringify(r));
  const lessons = runs[0]!.slice(0, 5).map((g) => g.family);
  const tiers = runs[0]!.map((g) => g.tier);
  const lateFamilies = new Set(runs[0]!.slice(20).map((g) => g.family));
  const repeats = runs[0]!.filter((g, i) => i > 0 && g.family === runs[0]![i - 1]!.family).length;
  check('tutorial-first', lessons.join(',') === 'learn-attract,learn-repel,learn-launch,learn-polarity,learn-mixed' && JSON.stringify(runs[2]!.slice(0, 5)) === JSON.stringify(runs[0]!.slice(0, 5)), lessons.join(', '));
  check('seeded-generation', r7 === r7b && r7 !== r8, `same seed identical=${r7 === r7b}, other seed differs=${r7 !== r8}`);
  check(
    'difficulty-ramp',
    tiers[5] === 0 && tiers[39] === 3 && tiers.every((t, i) => i === 0 || t >= tiers[i - 1]!) && lateFamilies.size >= 4 && repeats === 0,
    `tiers ${tiers.join('')}, ${lateFamilies.size} families after gate 20 (${[...lateFamilies].join(' ')}), back-to-back repeats=${repeats}`,
  );

  // 9. Analytics recorded so far: shape of every event and sane summary numbers.
  const an = await page.evaluate(() => window.__md!.analytics());
  const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '[]') as unknown[], ANALYTICS_KEY);
  const ev = an.events;
  const count = (name: string): number => ev.filter((e) => e.event === name).length;
  const sessionIds = new Set(ev.map((e) => e.sessionId));
  const clears = ev.filter((e) => e.event === 'gate_clear');
  const deaths = ev.filter((e) => e.event === 'death');
  const restarts = ev.filter((e) => e.event === 'restart');
  const shapeOk =
    ev.every((e) => typeof e.t === 'number' && typeof e.sessionId === 'string') &&
    clears.every((e) => typeof e.gate === 'number' && typeof e.type === 'string' && typeof e.clean === 'boolean') &&
    deaths.every((e) => (e.cause === 'camera' || e.cause === 'hazard') && typeof e.gate === 'number' && typeof e.gateType === 'string' && typeof e.score === 'number' && typeof e.runMs === 'number') &&
    restarts.every((e) => typeof e.msSinceDeath === 'number' && (e.msSinceDeath as number) < 10000);
  console.log(`      events: ${['session_start', 'run_start', 'gate_clear', 'death', 'restart'].map((n) => `${n}=${count(n)}`).join(' ')}`);
  console.log(`      summary: ${JSON.stringify(an.summary)}`);
  const sawDeathEvent = deaths.find((e) => e.cause === 'hazard');
  check('analytics-events', count('session_start') === 1 && count('run_start') >= 20 && clears.length >= 10 && deaths.length >= 3 && restarts.length >= 1 && shapeOk && stored.length === ev.length, `${ev.length} events in ${sessionIds.size} session(s), stored ${stored.length}; shapes ok=${shapeOk}`);
  check('hazard-death-blames-its-gate', sawDeathEvent?.gateType === 'polarity', `saw death recorded against ${sawDeathEvent?.gateType} (the polarity gate it guards)`);
  const sm = an.summary;
  const in01 = (v: number): boolean => v >= 0 && v <= 1;
  check(
    'analytics-summary',
    sm.sessions === 1 &&
      sm.runs === count('run_start') &&
      sm.runsPerSession === sm.runs &&
      sm.deaths === deaths.length &&
      (sm.deathsByCause.camera ?? 0) >= 2 &&
      (sm.deathsByCause.hazard ?? 0) >= 1 &&
      Object.values(sm.deathsByGateType).reduce((a, v) => a + v, 0) === sm.deaths &&
      sm.retryAfterDeathRate > 0 &&
      in01(sm.retryAfterDeathRate) &&
      in01(sm.deathsBeforeGate3) &&
      in01(sm.reached5) &&
      sm.reached5 >= sm.reached10 &&
      sm.reached10 >= sm.reached20 &&
      sm.medianGatesCleared >= 0 &&
      sm.medianSessionMinutes > 0 &&
      sm.sessionDays === 1 &&
      !sm.returnedOnAnotherDay,
    `runs=${sm.runs} deaths=${sm.deaths} by cause ${JSON.stringify(sm.deathsByCause)} retry=${sm.retryAfterDeathRate} before gate 3=${sm.deathsBeforeGate3} median gates=${sm.medianGatesCleared} session=${sm.medianSessionMinutes} min`,
  );

  // 10. Long session: mash taps for 20 s on generated runs, auto-restarting. Bounded objects, voices and work.
  await page.reload();
  await page.waitForFunction(() => window.__md !== undefined);
  let maxMagnets = 0;
  let maxSaws = 0;
  let maxScore = 0;
  let maxOut = 0;
  let maxVoices = 0;
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    await tap(page);
    const x = await snap(page);
    maxMagnets = Math.max(maxMagnets, x.magnets);
    maxSaws = Math.max(maxSaws, x.saws);
    maxScore = Math.max(maxScore, x.score);
    const au = await audio(page);
    maxOut = Math.max(maxOut, au.outputPeak);
    maxVoices = Math.max(maxVoices, au.voices);
    await sleep(150 + Math.random() * 500);
  }
  const mash = await audio(page);
  check('live-output', maxOut > 0.02 && maxOut < 1, `live output peak ${dbfs(maxOut)} while playing (audible, under full scale)`);
  check('bounded-voices', maxVoices <= AUDIO.maxVoices + 1 && mash.peakVoices <= AUDIO.maxVoices + 1, `max concurrent voices sampled=${maxVoices}, engine peak=${mash.peakVoices}, cap=${AUDIO.maxVoices} (+1 for death), dropped=${mash.dropped}`);
  await waitFor(page, (x) => x.state === 'ready', 30000);
  await sleep(1500);
  const idle0 = await audio(page);
  await sleep(1500);
  const idle1 = await audio(page);
  check('no-per-frame-nodes', idle1.nodesCreated === idle0.nodesCreated && idle1.voices === 0, `nodes created during 1.5 s of frames: ${idle1.nodesCreated - idle0.nodesCreated}, voices still playing: ${idle1.voices}, total nodes ever: ${idle1.nodesCreated}`);
  const frames = await page.evaluate(() => window.__md!.frameWork());
  frames.sort((x, y) => x - y);
  const p95 = frames[Math.floor(frames.length * 0.95)] ?? 0;
  check('bounded-objects', maxMagnets <= 16 && maxSaws <= 6, `max magnets=${maxMagnets} saws=${maxSaws} best score while mashing=${maxScore}`);
  check('frame-work', frames.length > 100 && p95 < 8, `p95 update+render=${p95.toFixed(2)} ms over ${frames.length} frames (budget 8 ms)`);

  // 11. Juice: consecutive frames around a launch and a death, in slow motion.
  await startRun(page, [LAUNCH]);
  await waitFor(page, (x) => x.stuck, 4000);
  await sleep(120);
  await page.evaluate(() => window.__md!.setTimeScale(0.08));
  await tap(page);
  for (let i = 0; i < 6; i++) await shot(page, `11-launch-burst-${i}`);
  await page.evaluate(() => window.__md!.setTimeScale(1));
  await startRun(page, [SAW]);
  await waitFor(page, (x) => x.passY !== null && x.y > x.passY - 120, 6000);
  await page.evaluate(() => window.__md!.setTimeScale(0.08));
  await waitFor(page, (x) => x.state === 'dying', 30000);
  for (let i = 0; i < 6; i++) await shot(page, `11-death-burst-${i}`);
  await page.evaluate(() => window.__md!.setTimeScale(1));
  check('burst-frames', true, 'launch and death bursts saved');

  // 12. Every effect firing at once: frame budget and the flash limiter.
  await page.reload();
  await page.waitForFunction(() => window.__md !== undefined);
  await page.evaluate((g) => window.__md!.setup(1, g), [TRAP]);
  await tap(page);
  await page.evaluate(() => {
    window.__md!.setHeatFloor(1);
    window.__md!.setStress(true);
    window.__md!.resetFrameWork();
    window.__md!.resetJuiceStats();
  });
  const stressEnd = Date.now() + 8000;
  let peakParticles = 0;
  let shotStress = false;
  while (Date.now() < stressEnd) {
    await sleep(250);
    const j = await page.evaluate(() => window.__md!.juice());
    peakParticles = Math.max(peakParticles, j.particles);
    if (!shotStress && Date.now() > stressEnd - 4000) {
      await shot(page, '12-stress');
      shotStress = true;
    }
  }
  const stressFrames = await page.evaluate(() => window.__md!.frameWork());
  const stressJuice = await page.evaluate(() => window.__md!.juice());
  await page.evaluate(() => window.__md!.setStress(false));
  stressFrames.sort((x, y) => x - y);
  const sp95 = stressFrames[Math.floor(stressFrames.length * 0.95)] ?? 0;
  check('frame-work-all-effects', stressFrames.length > 100 && sp95 < 8, `p95=${sp95.toFixed(2)} ms max=${(stressFrames.at(-1) ?? 0).toFixed(2)} ms over ${stressFrames.length} frames, peak particles=${peakParticles}`);
  const ft = stressJuice.flashTimes;
  let worstWindow = 0;
  for (let i = 0; i < ft.length; i++) worstWindow = Math.max(worstWindow, ft.filter((t) => t >= ft[i]! && t < ft[i]! + 1).length);
  check('flash-limit', ft.length > 5 && worstWindow <= 3, `${ft.length} big flashes in 8 s of nonstop requests, worst 1 s window=${worstWindow} (limit 3)`);

  // 13. Tuning panel: pauses, sliders apply live, zones never touch, values persist, stats, reset.
  const tuneState = (): Promise<ReturnType<DebugHook['tune']>> => page.evaluate(() => window.__md!.tune());
  const slide = (key: string, v: number): Promise<void> =>
    page.evaluate(([k, val]) => {
      const el = document.querySelector<HTMLInputElement>(`#tune input[name="${k}"]`)!;
      el.value = String(val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, [key, v] as const);
  await startRun(page, [spec('learn-mixed'), REPEL], 1);
  await sleep(400);
  await page.keyboard.press('KeyT');
  const q0 = await snap(page);
  await sleep(600);
  const q1 = await snap(page);
  const u0 = await tuneState();
  check(
    'panel-pauses',
    u0.paused && (await page.locator('#tune').isVisible()) && q0.y === q1.y && q0.camY === q1.camY,
    `open=${u0.paused} orb y ${q0.y.toFixed(1)} -> ${q1.y.toFixed(1)} over 600 ms`,
  );
  const head = (await page.locator('#tune h2').boundingBox())!;
  await page.touchscreen.tap(head.x + head.width / 2, head.y + head.height / 2);
  await sleep(100);
  const q2 = await snap(page);
  check('panel-press-no-flip', q2.polarity === q1.polarity && (await tuneState()).paused, `polarity ${q1.polarity} -> ${q2.polarity}, panel still open`);
  check('defaults-no-clash', u0.clashes === 0 && JSON.stringify(u0.values) === JSON.stringify(DEFAULTS) && u0.reaches.length > 0, `clashes=${u0.clashes}, reaches ${u0.reaches.map((r) => r.toFixed(0)).join('/')}`);
  await slide('fieldScale', 1.3);
  await slide('zoneGap', 40);
  const big = await tuneState();
  await slide('fieldScale', 0.5);
  await slide('showZones', 1);
  await slide('gravity', 900);
  await slide('doorPull', 2000);
  const u1 = await tuneState();
  check(
    'slider-applies',
    u1.values.fieldScale === 0.5 && u1.values.gravity === 900 && u1.values.showZones === 1 && u1.values.doorPull === 2000 && u1.reaches.some((r, i) => r < u0.reaches[i]! - 1),
    `fieldScale=${u1.values.fieldScale} gravity=${u1.values.gravity} doorPull=${u1.values.doorPull}; reaches ${u0.reaches.map((r) => r.toFixed(0)).join('/')} -> ${u1.reaches.map((r) => r.toFixed(0)).join('/')}`,
  );
  check('zone-refit-no-clash', big.clashes === 0 && u1.clashes === 0, `field x1.3 gap 40: clashes=${big.clashes}; field x0.5: clashes=${u1.clashes}`);
  const changedRows = await page.locator('#tune .tune-row.changed').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.key).sort().join(','));
  check('changed-rows-marked', changedRows === 'doorPull,fieldScale,gravity,showZones,zoneGap', `rows marked changed: ${changedRows}`);
  await shot(page, '13-panel-phone');
  // Stats section: shows the analytics summary, copies it as JSON, clears it.
  const statsText = (await page.locator('#tune .tune-stats').textContent()) ?? '';
  await page.locator('#tune .tune-stats').scrollIntoViewIfNeeded();
  await shot(page, '13b-panel-stats');
  await page.getByRole('button', { name: 'Copy stats JSON' }).click();
  await sleep(200);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  let copied: { summary?: { runs?: number } } = {};
  try {
    copied = JSON.parse(clip) as typeof copied;
  } catch {
    // Not JSON: the check below fails.
  }
  check('stats-shown-and-copied', /runs/i.test(statsText) && (copied.summary?.runs ?? 0) >= 20, `panel stats "${statsText.slice(0, 90)}...", copied runs=${copied.summary?.runs}`);
  await page.getByRole('button', { name: 'Clear stats' }).click();
  await sleep(100);
  const afterClear = await page.evaluate(() => window.__md!.analytics());
  const storedAfter = await page.evaluate((k) => localStorage.getItem(k), ANALYTICS_KEY);
  check('stats-clear', afterClear.events.length === 0 && afterClear.summary.runs === 0 && (storedAfter === null || storedAfter === '[]'), `events after clear=${afterClear.events.length}, stored=${storedAfter}`);
  await page.locator('#tune').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.getByRole('button', { name: 'Copy values' }).click();
  await sleep(150);
  const statusText = (await page.locator('#tune .tune-status').first().textContent()) ?? '';
  check('copy-values', statusText.length > 0, statusText);
  await page.keyboard.press('Escape');
  await sleep(300);
  const q3 = await snap(page);
  check('panel-closes-and-resumes', !(await tuneState()).paused && !(await page.locator('#tune').isVisible()) && q3.y !== q1.y, `orb moving again: y ${q1.y.toFixed(1)} -> ${q3.y.toFixed(1)}`);
  await shot(page, '13c-zones-shown');
  await page.reload();
  await page.waitForFunction(() => window.__md !== undefined);
  const u2 = await tuneState();
  check('tune-persists', u2.values.fieldScale === 0.5 && u2.values.gravity === 900 && u2.values.zoneGap === 40, `after reload fieldScale=${u2.values.fieldScale} gravity=${u2.values.gravity} zoneGap=${u2.values.zoneGap}`);
  const tuneKeys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('magnetdrop.')));
  check('storage-keys', tuneKeys.length > 0 && tuneKeys.every((k) => k.startsWith('magnetdrop.proto-a.')), tuneKeys.join(', '));
  await page.locator('#tune-toggle').tap();
  await sleep(100);
  await page.locator('#tune').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.getByRole('button', { name: 'Reset to defaults' }).click();
  const u3 = await tuneState();
  check('tune-reset', JSON.stringify(u3.values) === JSON.stringify(DEFAULTS) && (await page.locator('#tune .tune-row.changed').count()) === 0, 'values back to defaults');
  const r0 = await snap(page);
  await page.touchscreen.tap(195, 120);
  await sleep(100);
  const r1 = await snap(page);
  check('game-press-closes-panel', !(await tuneState()).paused && r1.state === r0.state && r1.polarity === r0.polarity, `panel closed, state ${r0.state} -> ${r1.state}, polarity unchanged`);
  const wide = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await wide.goto(BASE);
  await wide.waitForFunction(() => window.__md !== undefined);
  await wide.keyboard.press('KeyT');
  await sleep(200);
  await shot(wide, '13d-panel-desktop');
  await wide.close();

  check('no-console-errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');

  // 14. Reduced motion: same launch and death, shake and flash must drop.
  const measure = async (p: Page): Promise<{ shake: number; flash: number; zoom: number; reduced: boolean }> => {
    let shake = 0;
    let flash = 0;
    let zoom = 0;
    let reduced = false;
    for (const launch of [true, false]) {
      await startRun(p, [launch ? LAUNCH : SAW]);
      await p.evaluate(() => window.__md!.resetJuiceStats());
      if (launch) {
        await waitFor(p, (x) => x.stuck, 4000);
        await tap(p);
        await sleep(500);
      } else {
        await waitFor(p, (x) => x.state === 'dying', 8000);
        await sleep(700);
      }
      const j = await p.evaluate(() => window.__md!.juice());
      shake = Math.max(shake, j.maxShakePx);
      flash = Math.max(flash, j.maxFlashAlpha);
      zoom = Math.max(zoom, j.maxZoomDev);
      reduced = j.reduced;
    }
    return { shake, flash, zoom, reduced };
  };
  const normal = await measure(page);
  const rmContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const rmPage = await rmContext.newPage();
  await rmPage.goto(BASE);
  await rmPage.waitForFunction(() => window.__md !== undefined);
  const rm = await measure(rmPage);
  await shot(rmPage, '14-reduced-motion-death');
  check(
    'reduced-motion',
    rm.reduced && !normal.reduced && normal.shake > 0 && rm.shake < normal.shake * 0.35 && rm.flash <= normal.flash * 0.35 && rm.zoom < 0.001,
    `normal shake=${normal.shake.toFixed(1)}px flash=${normal.flash.toFixed(2)} zoom=${normal.zoom.toFixed(3)} | reduced shake=${rm.shake.toFixed(1)}px flash=${rm.flash.toFixed(2)} zoom=${rm.zoom.toFixed(3)}`,
  );
  check('restrained-juice', normal.shake <= 10 && normal.flash <= 0.35, `normal launch+death: shake ${normal.shake.toFixed(1)}px (<=10), flash alpha ${normal.flash.toFixed(2)} (<=0.35)`);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${OUT}`);
process.exit(failed.length ? 1 : 0);
