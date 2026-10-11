import { AUDIO, MUTED_KEY } from './config.ts';
import { TUNE } from './tune.ts';
import type { Polarity } from './types.ts';

// All sounds are synthesised, so there are no asset files to load.
//
// Two kinds of sound:
// - Layers: a fixed set of always-running nodes (field hum, repel buzz, stuck tension, wind, danger)
//   whose levels follow the game every frame. Nothing is created per frame.
// - One-shots: short voices for events (flip, stick, launch...). Capped at AUDIO.maxVoices.
// Everything goes through a limiter so stacked sounds can't clip.

/** 0..1 levels that drive the continuous layers. */
export interface Mix {
  attract: number;
  repel: number;
  stuck: number;
  /** Seconds spent stuck to the current magnet. */
  stuckTime: number;
  speed: number;
  danger: number;
}

export const SILENT_MIX: Readonly<Mix> = { attract: 0, repel: 0, stuck: 0, stuckTime: 0, speed: 0, danger: 0 };

export type DeathCause = 'spikes' | 'stall';

const PENTA = [0, 3, 5, 7, 10] as const;

/** Frequency of a degree on the A minor pentatonic scale (degree 0 = root, 5 = octave). */
export function noteHz(degree: number): number {
  const oct = Math.floor(degree / 5);
  const st = PENTA[degree - oct * 5]! + 12 * oct;
  return AUDIO.rootHz * 2 ** (st / 12);
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

interface Voice {
  out: GainNode;
  t: number;
  sources: number;
}

export class SoundEngine {
  readonly ctx: BaseAudioContext;
  readonly master: GainNode;
  readonly analyser: AnalyserNode | null;
  voices = 0;
  peakVoices = 0;
  dropped = 0;
  nodesCreated = 0;
  readonly persistentNodes: number;
  private readonly sfxBus: GainNode;
  private readonly layerBus: GainNode;
  private readonly noise: AudioBuffer;
  private readonly lastPlayed = new Map<string, number>();
  private readonly paramCache = new Map<AudioParam, number>();
  private readonly layer: {
    humA: OscillatorNode;
    humB: OscillatorNode;
    humFilter: BiquadFilterNode;
    hum: GainNode;
    repelA: OscillatorNode;
    repelB: OscillatorNode;
    repelFilter: BiquadFilterNode;
    repel: GainNode;
    stuckOsc: OscillatorNode;
    stuckLfo: OscillatorNode;
    stuck: GainNode;
    windFilter: BiquadFilterNode;
    wind: GainNode;
    dangerLfo: OscillatorNode;
    danger: GainNode;
  };

  constructor(ctx: BaseAudioContext, withAnalyser = false) {
    this.ctx = ctx;
    const limiter = this.node(ctx.createDynamicsCompressor());
    limiter.threshold.value = -12;
    limiter.knee.value = 6;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    this.master = this.gain(AUDIO.masterGain);
    this.master.connect(limiter);
    if (withAnalyser) {
      this.analyser = this.node(ctx.createAnalyser());
      this.analyser.fftSize = 2048;
      limiter.connect(this.analyser).connect(ctx.destination);
    } else {
      this.analyser = null;
      limiter.connect(ctx.destination);
    }
    this.sfxBus = this.gain(AUDIO.sfxGain);
    this.sfxBus.connect(this.master);
    this.layerBus = this.gain(AUDIO.layerGain);
    this.layerBus.connect(this.master);

    // One shared second of white noise for every noisy sound.
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // Field hum: being pulled. Two saws an octave apart through a lowpass that opens as the pull grows.
    const hum = this.gain(0);
    const humFilter = this.filter('lowpass', 200, 3);
    const humA = this.osc('sawtooth', 110);
    const humB = this.osc('sawtooth', 220.6);
    humA.connect(humFilter);
    humB.connect(humFilter);
    humFilter.connect(hum).connect(this.layerBus);

    // Repel buzz: two slightly detuned squares beat against each other, an uneasy push.
    const repel = this.gain(0);
    const repelFilter = this.filter('bandpass', 700, 1.4);
    const repelA = this.osc('square', 147);
    const repelB = this.osc('square', 152.5);
    repelA.connect(repelFilter);
    repelB.connect(repelFilter);
    repelFilter.connect(repel).connect(this.layerBus);

    // Stuck tension: a held tone with a tremolo that speeds up the longer you hang on.
    const stuck = this.gain(0);
    const stuckTrem = this.gain(0.55);
    const stuckOsc = this.osc('triangle', noteHz(2));
    const stuckLfo = this.osc('sine', 5);
    const stuckDepth = this.gain(0.45);
    stuckLfo.connect(stuckDepth).connect(stuckTrem.gain);
    stuckOsc.connect(stuckTrem).connect(stuck).connect(this.layerBus);

    // Wind: filtered noise that rises with speed.
    const wind = this.gain(0);
    const windFilter = this.filter('bandpass', 400, 0.9);
    const windSrc = this.node(ctx.createBufferSource());
    windSrc.buffer = this.noise;
    windSrc.loop = true;
    windSrc.connect(windFilter).connect(wind).connect(this.layerBus);
    windSrc.start();

    // Danger: a pulsing tritone against the root, faster and louder as spikes or the screen top close in.
    const danger = this.gain(0);
    const dangerTrem = this.gain(0.5);
    const dangerA = this.osc('triangle', AUDIO.rootHz * 2 ** (6 / 12));
    const dangerB = this.osc('sine', AUDIO.rootHz * 2 ** (13 / 12));
    const dangerBGain = this.gain(0.4);
    const dangerLfo = this.osc('sine', 3);
    const dangerDepth = this.gain(0.5);
    dangerLfo.connect(dangerDepth).connect(dangerTrem.gain);
    dangerA.connect(dangerTrem);
    dangerB.connect(dangerBGain).connect(dangerTrem);
    dangerTrem.connect(danger).connect(this.layerBus);

    this.layer = { humA, humB, humFilter, hum, repelA, repelB, repelFilter, repel, stuckOsc, stuckLfo, stuck, windFilter, wind, dangerLfo, danger };
    this.persistentNodes = this.nodesCreated;
  }

  // ---------- node helpers ----------

  private node<T extends AudioNode>(n: T): T {
    this.nodesCreated++;
    return n;
  }

  private gain(v: number): GainNode {
    const g = this.node(this.ctx.createGain());
    g.gain.value = v;
    return g;
  }

  private filter(type: BiquadFilterType, f: number, q: number): BiquadFilterNode {
    const b = this.node(this.ctx.createBiquadFilter());
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }

  /** A persistent oscillator, started immediately. */
  private osc(type: OscillatorType, f: number): OscillatorNode {
    const o = this.node(this.ctx.createOscillator());
    o.type = type;
    o.frequency.value = f;
    o.start();
    return o;
  }

  // ---------- continuous layers ----------

  /** Glide a layer parameter, skipping tiny changes so the timeline doesn't fill with events. */
  private glide(p: AudioParam, v: number): void {
    const prev = this.paramCache.get(p);
    if (prev !== undefined && Math.abs(v - prev) <= Math.max(0.0005, Math.abs(prev) * 0.01)) return;
    this.paramCache.set(p, v);
    p.setTargetAtTime(v, this.ctx.currentTime, AUDIO.layerSmoothing);
  }

  setMix(m: Readonly<Mix>): void {
    const L = this.layer;
    const a = clamp01(m.attract);
    const r = clamp01(m.repel);
    const s = clamp01(m.speed);
    const d = clamp01(m.danger);
    const st = Math.min(m.stuckTime, 4);
    this.glide(L.hum.gain, AUDIO.hum * a ** 1.5);
    this.glide(L.humA.frequency, 110 * (1 + 0.6 * a));
    this.glide(L.humB.frequency, 220.6 * (1 + 0.6 * a));
    this.glide(L.humFilter.frequency, 220 + 2400 * a * a);
    this.glide(L.repel.gain, AUDIO.repel * r ** 1.5);
    this.glide(L.repelFilter.frequency, 600 + 1400 * r);
    this.glide(L.stuck.gain, AUDIO.stuck * clamp01(m.stuck));
    this.glide(L.stuckOsc.frequency, noteHz(2) * (1 + st * 0.045));
    this.glide(L.stuckLfo.frequency, 5 + st * 3);
    this.glide(L.wind.gain, AUDIO.wind * s * s);
    this.glide(L.windFilter.frequency, 300 + 2600 * s);
    this.glide(L.danger.gain, AUDIO.danger * d * d);
    this.glide(L.dangerLfo.frequency, 3 + 9 * d);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(muted ? 0 : AUDIO.masterGain * TUNE.volume, this.ctx.currentTime, 0.02);
  }

  private muted = false;

  /** Re-read the tuner volume. */
  applyVolume(): void {
    this.setMuted(this.muted);
  }

  // ---------- one-shot voices ----------

  /** Start a voice, or return null if it was played too recently or every voice is busy. */
  private begin(name: string, minGap: number, pan: number, essential = false): Voice | null {
    const t = this.ctx.currentTime;
    const last = this.lastPlayed.get(name);
    if (last !== undefined && t - last < minGap) return null;
    if (!essential && this.voices >= AUDIO.maxVoices) {
      this.dropped++;
      return null;
    }
    this.lastPlayed.set(name, t);
    const out = this.gain(1);
    const panner = this.node(this.ctx.createStereoPanner());
    panner.pan.value = Math.max(-1, Math.min(1, pan * AUDIO.pan));
    out.connect(panner).connect(this.sfxBus);
    this.voices++;
    this.peakVoices = Math.max(this.peakVoices, this.voices);
    return { out, t: t + 0.005, sources: 0 };
  }

  private track(v: Voice, src: AudioScheduledSourceNode): void {
    v.sources++;
    src.onended = () => {
      if (--v.sources === 0) {
        v.out.disconnect();
        this.voices--;
      }
    };
  }

  /** Enveloped tone: quick attack to `peak`, exponential decay over `dur`, pitch glides f0 -> f1. */
  private tone(v: Voice, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, delay = 0, attack = 0.004, dest: AudioNode = v.out): void {
    const t = v.t + delay;
    const o = this.node(this.ctx.createOscillator());
    const g = this.node(this.ctx.createGain());
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    this.track(v, o);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Enveloped filtered noise with a filter sweep f0 -> f1. */
  private hiss(v: Voice, type: BiquadFilterType, f0: number, f1: number, q: number, dur: number, peak: number, delay = 0, attack = 0.003): void {
    const t = v.t + delay;
    const src = this.node(this.ctx.createBufferSource());
    src.buffer = this.noise;
    const f = this.filter(type, f0, q);
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.node(this.ctx.createGain());
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(v.out);
    this.track(v, src);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  /** Polarity flip: a plucked note that climbs the scale while you keep flipping. Red sits a fifth above blue. */
  flip(p: Polarity, combo: number, pan: number): void {
    const v = this.begin('flip', 0.03, pan);
    if (!v) return;
    const red = p === 'red';
    const f = noteHz(combo + (red ? 8 : 5));
    this.tone(v, red ? 'square' : 'triangle', f * 1.5, f, 0.012, red ? 0.12 : 0.16, 0, 0.002);
    this.tone(v, red ? 'square' : 'triangle', f, f, 0.2, red ? 0.12 : 0.2, 0.01);
    this.tone(v, 'sine', f * 2, f * 2, 0.09, 0.07, 0.01);
    this.hiss(v, 'highpass', 5000, 5000, 0.7, 0.025, 0.07);
  }

  /** Stick: a heavy magnetic clank. Harder hits are louder and lower. */
  stick(impact: number, magnet: Polarity, pan: number): void {
    const v = this.begin('stick', 0.05, pan);
    if (!v) return;
    const i = 0.35 + 0.65 * clamp01(impact);
    const k = magnet === 'red' ? 1 : 1.12;
    this.tone(v, 'sine', 190 * k, 70 * k, 0.16, 0.5 * i);
    this.tone(v, 'sine', 1180 * k, 1150 * k, 0.22, 0.07 * i);
    this.tone(v, 'sine', 1730 * k, 1700 * k, 0.15, 0.05 * i);
    this.tone(v, 'sine', 2690 * k, 2650 * k, 0.08, 0.035 * i);
    this.hiss(v, 'bandpass', 2600, 1200, 1.2, 0.04, 0.35 * i);
  }

  /** Repel bounce: a springy boing that bends upward, away from the magnet. */
  bounce(impact: number, pan: number): void {
    const v = this.begin('bounce', 0.06, pan);
    if (!v) return;
    const i = 0.3 + 0.7 * clamp01(impact);
    this.tone(v, 'sine', 260, 560, 0.14, 0.3 * i);
    this.tone(v, 'triangle', 130, 280, 0.12, 0.14 * i);
  }

  /** Wall: a short muffled knock. */
  wall(impact: number, pan: number): void {
    const i = clamp01(impact);
    if (i < 0.08) return;
    const v = this.begin('wall', 0.07, pan);
    if (!v) return;
    this.tone(v, 'sine', 120, 60, 0.07, 0.35 * i);
    this.hiss(v, 'lowpass', 1400, 300, 0.7, 0.05, 0.3 * i);
  }

  /** Launch: sub kick, whoosh and a rising chord that climbs with chained launches. */
  launch(chain: number, pan: number): void {
    const v = this.begin('launch', 0.04, pan);
    if (!v) return;
    const base = chain * 2;
    this.tone(v, 'sine', 150, 42, 0.18, 0.55);
    this.hiss(v, 'bandpass', 500, 3200, 1.1, 0.28, 0.3, 0, 0.02);
    const sweep = this.filter('lowpass', 500, 4);
    sweep.frequency.setValueAtTime(500, v.t);
    sweep.frequency.exponentialRampToValueAtTime(5000, v.t + 0.12);
    sweep.connect(v.out);
    for (let k = 0; k < 3; k++) {
      const f = noteHz(base + 5 + k * 2);
      this.tone(v, 'sawtooth', f * 0.98, f, 0.32 - k * 0.05, 0.1, k * 0.028, 0.005, sweep);
    }
  }

  /** Death: spikes crunch, a stall gets swallowed. Both end on a falling minor sigh. */
  death(cause: DeathCause): void {
    const v = this.begin('death', 0.2, 0, true);
    if (!v) return;
    if (cause === 'spikes') {
      this.hiss(v, 'bandpass', 2400, 180, 0.9, 0.5, 0.7);
      this.tone(v, 'sawtooth', 240, 32, 0.5, 0.2);
      this.tone(v, 'sawtooth', 247, 30, 0.5, 0.2);
      this.tone(v, 'sine', 95, 30, 0.6, 0.6);
    } else {
      const dull = this.filter('lowpass', 3000, 2);
      dull.frequency.setValueAtTime(3000, v.t);
      dull.frequency.exponentialRampToValueAtTime(120, v.t + 0.6);
      dull.connect(v.out);
      this.tone(v, 'sawtooth', 440, 55, 0.65, 0.35, 0, 0.004, dull);
      this.tone(v, 'sawtooth', 446, 54, 0.65, 0.3, 0, 0.004, dull);
      this.tone(v, 'sine', 80, 35, 0.5, 0.45);
    }
    this.tone(v, 'triangle', noteHz(2), noteHz(2) * 0.97, 0.3, 0.13, 0.38, 0.02);
    this.tone(v, 'triangle', noteHz(0), noteHz(0) * 0.94, 0.55, 0.13, 0.58, 0.02);
  }

  /** Run start: a quick rising three-note figure. */
  start(): void {
    const v = this.begin('start', 0.3, 0);
    if (!v) return;
    for (let k = 0; k < 3; k++) this.tone(v, 'triangle', noteHz(5 + k * 2), noteHz(5 + k * 2), 0.16, 0.14, k * 0.055);
  }

  /** Dropping through a gate: a short bright two-note blip. */
  gate(pan: number): void {
    const v = this.begin('gate', 0.05, pan);
    if (!v) return;
    this.tone(v, 'sine', noteHz(12), noteHz(12), 0.12, 0.08);
    this.tone(v, 'sine', noteHz(14), noteHz(14), 0.16, 0.07, 0.05);
  }

  /** Every AUDIO.milestoneEvery points: a bell arpeggio that climbs with each milestone. */
  milestone(n: number): void {
    const v = this.begin('milestone', 0.3, 0);
    if (!v) return;
    const base = 5 + (n % 5);
    for (let k = 0; k < 3; k++) {
      const f = noteHz(base + k * 2);
      this.tone(v, 'sine', f, f, 0.5, 0.11, k * 0.07, 0.003);
      this.tone(v, 'sine', f * 2.76, f * 2.76, 0.18, 0.03, k * 0.07, 0.003);
    }
  }

  /** Passing your best score: a fast sparkle run. */
  best(): void {
    const v = this.begin('best', 1, 0);
    if (!v) return;
    for (let k = 0; k < 6; k++) {
      const f = noteHz(10 + k);
      this.tone(v, 'sine', f, f, 0.25, 0.08, k * 0.045);
      this.tone(v, 'triangle', f * 0.5, f * 0.5, 0.2, 0.05, k * 0.045);
    }
  }

  /** Surviving a close pass by spikes: a whoosh and a bright ting. */
  nearMiss(pan: number): void {
    const v = this.begin('near-miss', 0.4, pan);
    if (!v) return;
    this.hiss(v, 'highpass', 1500, 6000, 0.8, 0.16, 0.18, 0, 0.03);
    this.tone(v, 'sine', noteHz(17), noteHz(17), 0.3, 0.07, 0.04);
    this.tone(v, 'sine', noteHz(19), noteHz(19), 0.35, 0.06, 0.1);
  }

  /** Shield breaks: a glassy crack and a falling chime. */
  shieldBreak(pan: number): void {
    const v = this.begin('shield-break', 0.2, pan, true);
    if (!v) return;
    this.hiss(v, 'highpass', 6000, 2500, 0.9, 0.18, 0.3);
    this.tone(v, 'triangle', noteHz(15), noteHz(10), 0.3, 0.16);
    this.tone(v, 'sine', noteHz(12) * 2.76, noteHz(12) * 2.2, 0.25, 0.05);
  }

  /** Shield recharged: two rising bell notes. */
  shieldReady(): void {
    const v = this.begin('shield-ready', 0.5, 0);
    if (!v) return;
    this.tone(v, 'sine', noteHz(10), noteHz(10), 0.3, 0.1);
    this.tone(v, 'sine', noteHz(12), noteHz(12), 0.4, 0.1, 0.08);
  }
}

// ---------- live engine ----------

let ctx: AudioContext | null = null;
let engine: SoundEngine | null = null;
let muted = loadMuted();

function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

/** The live engine, or null before the first user gesture. */
export function sound(): SoundEngine | null {
  return engine;
}

/** Must be called from a user gesture (browser autoplay rules). */
export function unlockAudio(): void {
  if (!ctx) {
    try {
      ctx = new AudioContext({ latencyHint: 'interactive' });
      engine = new SoundEngine(ctx, import.meta.env.DEV);
      engine.setMuted(muted);
    } catch {
      ctx = null;
      engine = null;
      return;
    }
  }
  if (muted) {
    if (ctx.state === 'running') void ctx.suspend();
  } else if (ctx.state === 'suspended') void ctx.resume();
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(m: boolean): void {
  muted = m;
  try {
    localStorage.setItem(MUTED_KEY, m ? '1' : '0');
  } catch {
    // Private mode can block storage; the setting just won't persist.
  }
  if (!m) unlockAudio();
  if (!engine || !ctx) return;
  engine.setMuted(m);
  // Suspending while muted saves battery on phones.
  if (m) {
    const c = ctx;
    setTimeout(() => {
      if (muted && c.state === 'running') void c.suspend();
    }, 80);
  }
}

/** Pause audio while the tab is hidden; resume when it comes back. */
export function setHidden(hidden: boolean): void {
  if (!ctx) return;
  if (hidden) void ctx.suspend();
  else if (!muted) void ctx.resume();
}

export interface AudioStats {
  state: string;
  muted: boolean;
  voices: number;
  peakVoices: number;
  dropped: number;
  nodesCreated: number;
  persistentNodes: number;
  /** Peak absolute sample in the last analyser window (dev only). */
  outputPeak: number;
}

const scratch = new Float32Array(2048);

export function audioStats(): AudioStats {
  let outputPeak = 0;
  if (engine?.analyser) {
    engine.analyser.getFloatTimeDomainData(scratch);
    for (const s of scratch) outputPeak = Math.max(outputPeak, Math.abs(s));
  }
  return {
    state: ctx?.state ?? 'none',
    muted,
    voices: engine?.voices ?? 0,
    peakVoices: engine?.peakVoices ?? 0,
    dropped: engine?.dropped ?? 0,
    nodesCreated: engine?.nodesCreated ?? 0,
    persistentNodes: engine?.persistentNodes ?? 0,
    outputPeak,
  };
}

export function haptic(pattern: number | number[]): void {
  if ('vibrate' in navigator) navigator.vibrate(pattern);
}

// ---------- offline rendering (used by verify) ----------

export const SOUND_NAMES = ['flip-blue', 'flip-red', 'flip-combo', 'stick', 'bounce', 'wall', 'launch', 'launch-chain', 'death-spikes', 'death-stall', 'start', 'gate', 'milestone', 'best', 'near-miss', 'shield-break', 'shield-ready', 'layer-hum', 'layer-repel', 'layer-stuck', 'layer-wind', 'layer-danger', 'everything'] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

function trigger(e: SoundEngine, name: SoundName): void {
  const full: Mix = { attract: 1, repel: 1, stuck: 1, stuckTime: 4, speed: 1, danger: 1 };
  switch (name) {
    case 'flip-blue': return e.flip('blue', 0, 0);
    case 'flip-red': return e.flip('red', 0, 0);
    case 'flip-combo': return e.flip('red', AUDIO.comboMax, 1);
    case 'stick': return e.stick(1, 'red', 0);
    case 'bounce': return e.bounce(1, 0);
    case 'wall': return e.wall(1, -1);
    case 'launch': return e.launch(0, 0);
    case 'launch-chain': return e.launch(AUDIO.launchChainMax, 0);
    case 'death-spikes': return e.death('spikes');
    case 'death-stall': return e.death('stall');
    case 'start': return e.start();
    case 'gate': return e.gate(0);
    case 'milestone': return e.milestone(3);
    case 'best': return e.best();
    case 'near-miss': return e.nearMiss(0);
    case 'shield-break': return e.shieldBreak(0);
    case 'shield-ready': return e.shieldReady();
    case 'layer-hum': return e.setMix({ ...SILENT_MIX, attract: 1 });
    case 'layer-repel': return e.setMix({ ...SILENT_MIX, repel: 1 });
    case 'layer-stuck': return e.setMix({ ...SILENT_MIX, stuck: 1, stuckTime: 4 });
    case 'layer-wind': return e.setMix({ ...SILENT_MIX, speed: 1 });
    case 'layer-danger': return e.setMix({ ...SILENT_MIX, danger: 1 });
    case 'everything':
      // Worst case: every layer flat out with every one-shot fired at once.
      e.setMix(full);
      e.death('spikes');
      e.launch(AUDIO.launchChainMax, 0);
      e.stick(1, 'blue', 0);
      e.flip('red', AUDIO.comboMax, 0);
      e.bounce(1, 0);
      e.wall(1, 0);
      e.milestone(0);
      e.best();
      e.nearMiss(0);
      return;
  }
}

export interface RenderResult {
  name: SoundName;
  peak: number;
  rms: number;
  /** Fraction of samples at or above 0.99 full scale. */
  clipped: number;
  voicesAfter: number;
}

/** Render one sound through the full chain (limiter included) without a speaker. */
export async function renderOffline(name: SoundName, seconds = 1.5): Promise<RenderResult> {
  const rate = 44100;
  const oc = new OfflineAudioContext(2, Math.ceil(rate * seconds), rate);
  const e = new SoundEngine(oc);
  trigger(e, name);
  const buf = await oc.startRendering();
  let peak = 0;
  let sum = 0;
  let clip = 0;
  let n = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    for (const s of buf.getChannelData(c)) {
      const a = Math.abs(s);
      if (a > peak) peak = a;
      if (a >= 0.99) clip++;
      sum += s * s;
      n++;
    }
  }
  return { name, peak, rms: Math.sqrt(sum / n), clipped: clip / n, voicesAfter: e.voices };
}
