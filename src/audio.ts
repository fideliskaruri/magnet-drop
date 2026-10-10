import type { Polarity } from './types.ts';

// All sounds are synthesised, so there are no asset files to load.
let ctx: AudioContext | null = null;

/** Must be called from a user gesture (browser autoplay rules). */
export function unlockAudio(): void {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

function tone(type: OscillatorType, f0: number, f1: number, dur: number, gain: number): void {
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(dur: number, gain: number, cutoff: number): void {
  if (!ctx) return;
  const t = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(cutoff, t);
  filter.frequency.exponentialRampToValueAtTime(120, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  src.connect(filter).connect(g).connect(ctx.destination);
  src.start(t);
}

export const sfx = {
  flip(p: Polarity): void {
    tone('square', p === 'red' ? 620 : 440, p === 'red' ? 520 : 360, 0.045, 0.05);
  },
  stick(): void {
    tone('sine', 220, 160, 0.08, 0.08);
  },
  launch(): void {
    tone('sawtooth', 180, 50, 0.22, 0.12);
    noise(0.15, 0.12, 2400);
  },
  death(): void {
    noise(0.45, 0.3, 4000);
    tone('triangle', 300, 40, 0.4, 0.12);
  },
  /** Rising whoosh: the dive kicks in. */
  boost(): void {
    tone('sawtooth', 120, 900, 0.35, 0.09);
    noise(0.4, 0.14, 5000);
    later(0.05, () => tone('square', 523, 1046, 0.12, 0.04));
  },
  /** Bright two-note chime. */
  shield(): void {
    tone('triangle', 784, 784, 0.12, 0.1);
    later(0.08, () => tone('triangle', 1175, 1175, 0.22, 0.09));
  },
  /** Wobbly shimmer that drifts down and back up. */
  phase(): void {
    tone('sine', 900, 300, 0.18, 0.08);
    later(0.15, () => tone('sine', 300, 1200, 0.25, 0.07));
  },
  /** Glassy crack when the shield breaks. */
  save(): void {
    noise(0.25, 0.22, 9000);
    tone('triangle', 1400, 500, 0.2, 0.1);
  },
  smash(): void {
    noise(0.12, 0.18, 6000);
    tone('square', 260, 90, 0.08, 0.05);
  },
  /** Two quick ticks: a timed power-up is about to end. */
  warn(): void {
    tone('square', 1000, 1000, 0.04, 0.04);
    later(0.18, () => tone('square', 1000, 1000, 0.04, 0.04));
  },
  expire(): void {
    tone('sine', 600, 200, 0.18, 0.07);
  },
};

function later(sec: number, fn: () => void): void {
  setTimeout(fn, sec * 1000);
}

export function haptic(pattern: number | number[]): void {
  if ('vibrate' in navigator) navigator.vibrate(pattern);
}
