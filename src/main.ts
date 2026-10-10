import { isMuted, setHidden, setMuted, sound, unlockAudio } from './audio.ts';
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
// On touch screens only pointerup/touchend count as a user gesture, so retry the audio unlock there too.
window.addEventListener('pointerup', unlockAudio);
window.addEventListener('touchend', unlockAudio);

const SPEAKER = '<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>';
const ON = `${SPEAKER}<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;
const OFF = `${SPEAKER}<path d="M16 9l6 6M22 9l-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;
const muteButton = document.createElement('button');
muteButton.id = 'mute';
muteButton.type = 'button';
muteButton.tabIndex = -1;
function drawMute(): void {
  const m = isMuted();
  muteButton.innerHTML = `<svg viewBox="0 0 26 24" width="22" height="22" aria-hidden="true">${m ? OFF : ON}</svg>`;
  muteButton.setAttribute('aria-label', m ? 'Turn sound on' : 'Turn sound off');
  muteButton.setAttribute('aria-pressed', String(m));
  muteButton.title = m ? 'Sound off (M)' : 'Sound on (M)';
}
function toggleMute(): void {
  setMuted(!isMuted());
  drawMute();
}
// Stop the press here so it never reaches the window listener that flips polarity.
muteButton.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  toggleMute();
});
drawMute();
document.body.append(muteButton);
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !e.repeat) toggleMute();
});

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
  sound()?.setMix(game.mix());
  if (import.meta.env.DEV) recordFrameWork(performance.now() - workStart);
  requestAnimationFrame(frame);
}

// A hidden tab stops rAF; don't replay the gap as physics when it comes back.
document.addEventListener('visibilitychange', () => {
  last = performance.now();
  acc = 0;
  setHidden(document.hidden);
});

requestAnimationFrame(frame);
