import { DT, MAX_FRAME_DT } from './config.ts';
import { installDebugHook, recordFrameWork } from './debug.ts';
import { Game } from './game.ts';
import { Renderer } from './render.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('Missing #game canvas.');

const game = new Game();
const renderer = new Renderer(canvas);
renderer.resize();
window.addEventListener('resize', () => renderer.resize());

window.addEventListener(
  'pointerdown',
  (e) => {
    e.preventDefault();
    game.tap();
  },
  { passive: false },
);
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowDown') {
    e.preventDefault();
    game.tap();
  }
});
window.addEventListener('contextmenu', (e) => e.preventDefault());

if (import.meta.env.DEV) installDebugHook(game);

let last = performance.now();
let acc = 0;

function frame(now: number): void {
  const workStart = performance.now();
  acc += Math.min((now - last) / 1000, MAX_FRAME_DT);
  last = now;
  while (acc >= DT) {
    game.update(DT);
    acc -= DT;
  }
  renderer.render(game, acc / DT, now / 1000);
  if (import.meta.env.DEV) recordFrameWork(performance.now() - workStart);
  requestAnimationFrame(frame);
}

// A hidden tab stops rAF; don't replay the gap as physics when it comes back.
document.addEventListener('visibilitychange', () => {
  last = performance.now();
  acc = 0;
});

requestAnimationFrame(frame);
