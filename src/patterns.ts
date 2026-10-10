import type { Magnet, Pattern, Polarity, SpikeRow } from './types.ts';

const pt = (x: number, y: number, polarity: Polarity, r = 18, field = 200): Magnet => ({ kind: 'point', x, y, r, field, polarity });
const rail = (ax: number, ay: number, bx: number, by: number, polarity: Polarity, r = 6): Magnet => ({ kind: 'rail', ax, ay, bx, by, r, polarity });
const floor = (x0: number, x1: number, y: number, h = 18): SpikeRow => ({ x: x0, y, w: x1 - x0, h, dir: 'up' });

// Pattern-local coordinates: x across the 360 px playfield, y down from the pattern top.
export const PATTERNS: Pattern[] = [
  {
    name: 'Open drop',
    height: 420,
    magnets: [pt(260, 200, 'red', 20, 170)],
    spikes: [],
  },
  {
    name: 'Pull past',
    height: 480,
    magnets: [pt(20, 120, 'red', 14, 150), pt(300, 190, 'blue', 20, 270)],
    spikes: [floor(0, 190, 370)],
  },
  {
    name: 'Push past',
    height: 440,
    magnets: [pt(290, 170, 'blue', 20, 230)],
    spikes: [floor(150, 360, 340)],
  },
  {
    name: 'Catch and fling',
    height: 500,
    magnets: [pt(20, 90, 'blue', 14, 150), pt(150, 170, 'red', 24, 230)],
    spikes: [floor(0, 240, 400)],
  },
  {
    name: 'Ping-pong',
    height: 540,
    magnets: [pt(36, 150, 'blue', 20, 180), pt(324, 290, 'red', 20, 180)],
    spikes: [floor(0, 130, 450), floor(230, 360, 450)],
  },
  {
    name: 'Rail slide',
    height: 560,
    magnets: [pt(160, 40, 'red', 16, 260), rail(16, 120, 16, 420, 'red')],
    spikes: [floor(90, 360, 330)],
  },
  {
    name: 'Rail launch',
    height: 520,
    magnets: [rail(10, 90, 250, 250, 'blue')],
    spikes: [floor(0, 255, 420)],
  },
  {
    name: 'Corridor',
    height: 620,
    magnets: [rail(110, 70, 110, 430, 'red'), rail(250, 70, 250, 430, 'blue')],
    spikes: [floor(0, 145, 530), floor(215, 360, 530)],
  },
  {
    name: 'Slalom',
    height: 720,
    magnets: [pt(40, 120, 'red', 18, 210), pt(320, 290, 'blue', 18, 210), pt(40, 450, 'red', 18, 210), pt(320, 610, 'blue', 18, 210)],
    spikes: [floor(140, 220, 240, 16), floor(140, 220, 400, 16), floor(140, 220, 560, 16)],
  },
  {
    name: 'Rest',
    height: 360,
    magnets: [pt(205, 170, 'blue', 16, 150)],
    spikes: [],
  },
];

export const TUTORIAL_COUNT = 3;
