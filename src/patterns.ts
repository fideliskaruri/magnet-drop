import type { Magnet, Pattern, Polarity, SpikeRow } from './types.ts';

const pt = (x: number, y: number, polarity: Polarity, r = 18, field = 200): Magnet => ({ kind: 'point', x, y, r, field, polarity });
const rail = (ax: number, ay: number, bx: number, by: number, polarity: Polarity, r = 6): Magnet => ({ kind: 'rail', ax, ay, bx, by, r, polarity });
/** A ceiling of spikes hanging down, tips at `tipY`. The orb rises into these. */
const ceiling = (x0: number, x1: number, tipY: number, h = 18): SpikeRow => ({ x: x0, y: tipY - h, w: x1 - x0, h, dir: 'down' });

// Pattern-local coordinates: x across the 360 px playfield, y down from the pattern top.
// The orb rises, so it enters each pattern at the bottom (y = height) and leaves through the top (y = 0).
export const PATTERNS: Pattern[] = [
  {
    name: 'Open rise',
    height: 420,
    magnets: [pt(260, 220, 'red', 20, 170)],
    spikes: [],
  },
  {
    name: 'Pull past',
    height: 480,
    magnets: [pt(20, 360, 'red', 14, 150), pt(300, 290, 'blue', 20, 270)],
    spikes: [ceiling(0, 190, 110)],
  },
  {
    name: 'Push past',
    height: 440,
    magnets: [pt(290, 270, 'blue', 20, 230)],
    spikes: [ceiling(150, 360, 100)],
  },
  {
    name: 'Catch and fling',
    height: 500,
    magnets: [pt(20, 410, 'blue', 14, 150), pt(150, 330, 'red', 24, 230)],
    spikes: [ceiling(0, 240, 100)],
  },
  {
    name: 'Ping-pong',
    height: 540,
    magnets: [pt(36, 390, 'blue', 20, 180), pt(324, 250, 'red', 20, 180)],
    spikes: [ceiling(0, 130, 90), ceiling(230, 360, 90)],
  },
  {
    name: 'Rail slide',
    height: 560,
    magnets: [pt(160, 520, 'red', 16, 260), rail(16, 440, 16, 140, 'red')],
    spikes: [ceiling(90, 360, 230)],
  },
  {
    name: 'Rail launch',
    height: 520,
    magnets: [rail(10, 430, 250, 270, 'blue')],
    spikes: [ceiling(0, 255, 100)],
  },
  {
    name: 'Corridor',
    height: 620,
    magnets: [rail(110, 550, 110, 190, 'red'), rail(250, 550, 250, 190, 'blue')],
    spikes: [ceiling(0, 145, 90), ceiling(215, 360, 90)],
  },
  {
    name: 'Slalom',
    height: 720,
    magnets: [pt(40, 600, 'red', 18, 210), pt(320, 430, 'blue', 18, 210), pt(40, 270, 'red', 18, 210), pt(320, 110, 'blue', 18, 210)],
    spikes: [ceiling(140, 220, 480, 16), ceiling(140, 220, 320, 16), ceiling(140, 220, 160, 16)],
  },
  {
    name: 'Rest',
    height: 360,
    magnets: [pt(205, 190, 'blue', 16, 150)],
    spikes: [],
  },
];

export const TUTORIAL_COUNT = 3;