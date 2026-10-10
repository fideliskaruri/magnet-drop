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
};

export function haptic(pattern: number | number[]): void {
  if ('vibrate' in navigator) navigator.vibrate(pattern);
}
