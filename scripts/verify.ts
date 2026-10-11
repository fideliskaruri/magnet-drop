// End-to-end checks in a real headless browser with real taps.
// Needs the dev server running (pnpm dev). Usage: pnpm verify [baseUrl]
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { AUDIO } from '../src/config.ts';
import type { DebugHook } from '../src/debug.ts';
import { DEFAULTS } from '../src/tune.ts';
import type { Family, GateSpec } from '../src/types.ts';

type Snap = ReturnType<DebugHook['snapshot']>;

const BASE = process.argv[2] ?? 'http://localhost:5180/';
const OUT = join(tmpdir(), 'agent-scratch', 'magnet-drop-endless-tuner');
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
async function startRun(page: Page, gates: GateSpec[], seed = 1, shield = true): Promise<void> {
  await page.reload();
  await page.waitForFunction(() => window.__md !== undefined);
  await page.evaluate(([s, p, sh]) => window.__md!.setup(s as number, p as GateSpec[], sh as boolean), [seed, gates, shield] as const);
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

  // 3. Attract vs repel: drift gate with a red magnet on the left, orb dropped at x=180.
  // Blue is pulled left; flipped to red it is pushed right. Sample the field sound while it acts.
  const drifted = (x: Snap): boolean => Math.abs(x.x - 180) > 15;
  await startRun(page, [DRIFT]);
  let b = await waitFor(page, drifted, 3000);
  const attractMix = await mix(page);
  check('attract-pulls-toward', b !== null && b.x < 165 && b.vx < 0, `blue orb x=${b?.x.toFixed(0)} vx=${b?.vx.toFixed(1)} (red magnet on the left)`);
  await startRun(page, [DRIFT]);
  await tap(page);
  b = await waitFor(page, drifted, 3000);
  const repelMix = await mix(page);
  await sleep(150);
  await shot(page, '03-repel');
  check('field-sound-follows', attractMix.attract > 0.2 && attractMix.repel === 0 && repelMix.repel > 0.2 && repelMix.attract === 0, `blue near red: hum=${attractMix.attract.toFixed(2)} buzz=${attractMix.repel.toFixed(2)}; red near red: hum=${repelMix.attract.toFixed(2)} buzz=${repelMix.repel.toFixed(2)}`);
  check('repel-pushes-away', b !== null && b.polarity === 'red' && b.x > 195 && b.vx > 0, `red orb x=${b?.x.toFixed(0)} vx=${b?.vx.toFixed(1)}`);

  // 4. Stick and launch on the perch (red magnet right under the blue orb).
  await startRun(page, [PERCH]);
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

  // 5a. The shield: an idle fall onto the spikes, but the shield absorbs the hit and the run goes on.
  await startRun(page, [KILL, FREE, FREE, FREE, FREE, FREE, FREE, FREE, FREE, FREE]);
  s = await snap(page);
  const shieldAtStart = s.shield;
  const saved = await waitFor(page, (x) => x.shieldsUsed === 1, 5000);
  await sleep(120);
  await shot(page, '05a-shield-saved');
  const afterSave = await waitFor(page, (x) => x.grace <= 0 && x.score >= 1, 4000);
  check(
    'shield-saves-once',
    shieldAtStart && saved !== null && saved.state === 'playing' && !saved.shield && afterSave !== null && afterSave.state === 'playing',
    `shield at start=${shieldAtStart} used=${saved?.shieldsUsed} state after hit=${saved?.state} still playing past the spikes=${afterSave?.state === 'playing'}`,
  );

  // 5b. The shield comes back after clearing a few more gates (free drift gates, no taps needed).
  let back5: Snap | null = null;
  const until = Date.now() + 25000;
  while (Date.now() < until) {
    const x = await snap(page);
    if (x.state !== 'playing' || x.shield) {
      back5 = x;
      break;
    }
    if (x.stuck) await tap(page);
    await sleep(60);
  }
  await shot(page, '05b-shield-ready');
  check('shield-recharges', back5 !== null && back5.state === 'playing' && back5.shield, `state=${back5?.state} shield=${back5?.shield} gates scored=${back5?.score}`);

  // 5c. One point per gate: two free gates then a fatal one, no taps, no shield. Then a fast restart.
  await page.evaluate(() => localStorage.clear());
  await startRun(page, [FREE, FREE, KILL], 1, false);
  const one = await waitFor(page, (x) => x.score === 1, 6000);
  const dead = await waitFor(page, (x) => x.state === 'dying', 10000);
  const deathScore = dead?.score ?? 0;
  await sleep(200);
  await shot(page, '05-death');
  await sleep(450);
  const t0 = Date.now();
  await tap(page);
  const back = await waitFor(page, (x) => x.state === 'playing', 1000);
  const restartMs = Date.now() - t0;
  check('score-per-gate', one !== null && dead !== null && deathScore === 2, `score at death=${deathScore} (two free gates, then the spikes)`);
  check('restart-under-1s', back !== null && back.score < deathScore, `restart took ${restartMs} ms after the 650 ms lockout, score reset to ${back?.score}`);
  await page.reload();
  await page.waitForFunction(() => window.__md !== undefined);
  const best = (await snap(page)).best;
  const keys = await page.evaluate(() => Object.keys(localStorage));
  check('best-persists', best === deathScore && best > 0 && keys.includes('magnetdrop.endless-tuner.best'), `best after reload=${best} keys=${keys.join(',')}`);

  // 6. Stall pressure: hang on the perch and get scrolled off the top.
  await startRun(page, [PERCH]);
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

  // 7. Screenshot every family at its easiest and hardest tier (camera frames the gate on entry).
  let wrongScreens = 0;
  for (const family of ['drift', 'twin', 'perch', 'rail', 'slope', 'corridor'] as Family[]) {
    for (const tier of [family === 'corridor' ? 2 : family === 'rail' || family === 'slope' ? 1 : 0, 3]) {
      await startRun(page, [gate(family, [0, 0, 0], { tier })]);
      const x = await waitFor(page, (q) => q.gateTop !== null, 3000);
      await sleep(100);
      await shot(page, `07-${family}-t${tier}`);
      if (x?.family !== family || x.tier !== tier) {
        wrongScreens += 1;
        check(`screen-${family}-t${tier}`, false, `orb is in ${x?.family} t${x?.tier}`);
      }
    }
  }
  check('family-screens', wrongScreens === 0, `12 screens, wrong gate in ${wrongScreens}, saved to ${OUT}`);

  // 7b. Generation: deterministic per seed, different across seeds, ramps up in difficulty.
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
  // The slower tuner physics can keep an idle orb alive a while; the stall still ends it.
  await waitFor(page, (x) => x.state === 'ready', 30000);
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

  // 9. Juice: consecutive frames around a launch and a death, in slow motion.
  await startRun(page, [PERCH]);
  await waitFor(page, (x) => x.stuck, 4000);
  await sleep(120);
  await page.evaluate(() => window.__md!.setTimeScale(0.08));
  await tap(page);
  for (let i = 0; i < 8; i++) await shot(page, `09-launch-burst-${i}`);
  await page.evaluate(() => window.__md!.setTimeScale(1));
  await startRun(page, [KILL], 1, false);
  await waitFor(page, (x) => x.passY !== null && x.y > x.passY - 140, 6000);
  await page.evaluate(() => window.__md!.setTimeScale(0.08));
  await waitFor(page, (x) => x.state === 'dying', 30000);
  for (let i = 0; i < 10; i++) await shot(page, `09-death-burst-${i}`);
  await page.evaluate(() => window.__md!.setTimeScale(1));
  check('burst-frames', true, 'launch and death bursts saved');

  // 10. Deep run look: heat forced to max, mashing taps.
  await page.reload();
  await page.waitForFunction(() => window.__md !== undefined);
  await page.evaluate(() => window.__md!.setHeatFloor(1));
  await tap(page);
  let maxHeat = 0;
  for (let i = 0; i < 6; i++) {
    await sleep(350 + Math.random() * 300);
    await tap(page);
    await sleep(60);
    await shot(page, `10-hot-${i}`);
    maxHeat = Math.max(maxHeat, (await page.evaluate(() => window.__md!.juice())).heat);
  }
  check('heat-rises', maxHeat > 0.8, `max heat=${maxHeat.toFixed(2)} with the deep-run floor forced on`);

  // 11. Every effect firing at once: frame budget and the flash limiter.
  await page.reload();
  await page.waitForFunction(() => window.__md !== undefined);
  await page.evaluate((g) => window.__md!.setup(1, g), [PERCH]);
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
      await shot(page, '11-stress');
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

  // 13. Tuning panel: pauses, sliders apply live, zones never touch, values persist, reset works.
  const tuneState = (): Promise<ReturnType<DebugHook['tune']>> => page.evaluate(() => window.__md!.tune());
  const slide = (key: string, v: number): Promise<void> =>
    page.evaluate(([k, val]) => {
      const el = document.querySelector<HTMLInputElement>(`#tune input[name="${k}"]`)!;
      el.value = String(val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, [key, v] as const);
  await startRun(page, [gate('twin', [1, 0]), DRIFT], 1);
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
  // Press the panel itself (its heading), not a slider, which would rightly move.
  const head = (await page.locator('#tune h2').boundingBox())!;
  await page.touchscreen.tap(head.x + head.width / 2, head.y + head.height / 2);
  await sleep(100);
  const q2 = await snap(page);
  check('panel-press-no-flip', q2.polarity === q1.polarity && (await tuneState()).paused, `polarity ${q1.polarity} -> ${q2.polarity}, panel still open`);
  check('defaults-no-clash', u0.clashes === 0 && JSON.stringify(u0.values) === JSON.stringify(DEFAULTS), `clashes=${u0.clashes}, reaches ${u0.reaches.map((r) => r.toFixed(0)).join('/')}`);
  await slide('fieldScale', 1.3);
  await slide('zoneGap', 40);
  const big = await tuneState();
  await slide('fieldScale', 0.5);
  await slide('showZones', 1);
  await slide('gravity', 900);
  const u1 = await tuneState();
  check(
    'slider-applies',
    u1.values.fieldScale === 0.5 && u1.values.gravity === 900 && u1.values.showZones === 1 && u1.reaches.some((r, i) => r < u0.reaches[i]! - 1),
    `fieldScale=${u1.values.fieldScale} gravity=${u1.values.gravity}; reaches ${u0.reaches.map((r) => r.toFixed(0)).join('/')} -> ${u1.reaches.map((r) => r.toFixed(0)).join('/')}`,
  );
  check('zone-refit-no-clash', big.clashes === 0 && u1.clashes === 0, `field x1.3 gap 40: clashes=${big.clashes} reaches ${big.reaches.map((r) => r.toFixed(0)).join('/')}; field x0.5: clashes=${u1.clashes}`);
  const changedRows = await page.locator('#tune .tune-row.changed').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.key).sort().join(','));
  check('changed-rows-marked', changedRows === 'fieldScale,gravity,showZones,zoneGap', `rows marked changed: ${changedRows}`);
  await shot(page, '13-panel-phone');
  await page.locator('#tune').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.getByRole('button', { name: 'Copy values' }).click();
  await sleep(150);
  const statusText = (await page.locator('#tune .tune-status').textContent()) ?? '';
  await shot(page, '13b-panel-phone-bottom');
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
  await page.locator('#tune-toggle').tap();
  await sleep(100);
  await page.locator('#tune').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.getByRole('button', { name: 'Reset to defaults' }).click();
  const u3 = await tuneState();
  const stored = await page.evaluate(() => localStorage.getItem('magnetdrop.endless-tuner.settings'));
  check(
    'tune-reset',
    JSON.stringify(u3.values) === JSON.stringify(DEFAULTS) && (await page.locator('#tune .tune-row.changed').count()) === 0,
    `values back to defaults, stored=${stored}`,
  );
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

  // 12. Reduced motion: same launch and death, shake and flash must drop.
  const measure = async (p: Page): Promise<{ shake: number; flash: number; zoom: number; reduced: boolean }> => {
    let shake = 0;
    let flash = 0;
    let zoom = 0;
    let reduced = false;
    for (const launch of [true, false]) {
      await startRun(p, [launch ? PERCH : KILL], 1, false);
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
  await shot(rmPage, '12-reduced-motion-death');
  check(
    'reduced-motion',
    rm.reduced && !normal.reduced && rm.shake < normal.shake * 0.35 && rm.flash < normal.flash * 0.35 && rm.zoom < 0.001,
    `normal shake=${normal.shake.toFixed(1)}px flash=${normal.flash.toFixed(2)} zoom=${normal.zoom.toFixed(3)} | reduced shake=${rm.shake.toFixed(1)}px flash=${rm.flash.toFixed(2)} zoom=${rm.zoom.toFixed(3)}`,
  );
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${OUT}`);
process.exit(failed.length ? 1 : 0);
