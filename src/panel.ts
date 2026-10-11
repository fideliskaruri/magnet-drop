import { sound } from './audio.ts';
import type { Game } from './game.ts';
import { changedTune, DEFAULTS, resetTune, saveTune, SLIDER_GROUPS, TUNE, type Slider } from './tune.ts';

// The tuning panel: a gear button (or the T key) opens it and pauses the game.
// Every change applies live and is saved, so a reload keeps your values.

let open = false;
let setOpenFn: (v: boolean) => void = () => {};

export function isPanelOpen(): boolean {
  return open;
}

export function closePanel(): void {
  setOpenFn(false);
}

const GEAR =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3.5h-4L10.7 6a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1c.5.4 1.1.7 1.7 1l.3 2.5h4l.3-2.5c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/></svg>';

function decimals(step: number): number {
  const s = String(step);
  return s.includes('.') ? s.length - s.indexOf('.') - 1 : 0;
}

function format(sl: Slider, v: number): string {
  if (sl.toggle) return v ? 'On' : 'Off';
  return v.toFixed(decimals(sl.step));
}

export function installPanel(game: Game): void {
  const button = document.createElement('button');
  button.id = 'tune-toggle';
  button.type = 'button';
  button.tabIndex = -1;
  button.innerHTML = GEAR;
  button.title = 'Tune the physics (T)';
  button.setAttribute('aria-label', 'Open tuning panel');

  const panel = document.createElement('div');
  panel.id = 'tune';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Tuning');

  const head = document.createElement('div');
  head.className = 'tune-head';
  head.innerHTML = '<div><h2>Tuning</h2><p>The game is paused while this is open. Changes apply live and are saved on this device.</p></div>';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'tune-close';
  close.textContent = 'Close';
  head.append(close);
  panel.append(head);

  const rows = new Map<keyof typeof TUNE, { input: HTMLInputElement; value: HTMLElement; row: HTMLElement; sl: Slider }>();
  for (const group of SLIDER_GROUPS) {
    const h = document.createElement('h3');
    h.textContent = group.title;
    panel.append(h);
    for (const sl of group.sliders) {
      const row = document.createElement('label');
      row.className = 'tune-row';
      row.dataset.key = sl.key;
      const top = document.createElement('div');
      top.className = 'tune-top';
      const name = document.createElement('span');
      name.className = 'tune-name';
      name.textContent = sl.label;
      const value = document.createElement('span');
      value.className = 'tune-value';
      top.append(name, value);
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(sl.min);
      input.max = String(sl.max);
      input.step = String(sl.step);
      input.name = sl.key;
      const hint = document.createElement('div');
      hint.className = 'tune-hint';
      hint.textContent = `${sl.hint}. Default ${format(sl, DEFAULTS[sl.key])}.`;
      row.append(top, input, hint);
      panel.append(row);
      rows.set(sl.key, { input, value, row, sl });
      input.addEventListener('input', () => {
        TUNE[sl.key] = Number(input.value);
        saveTune();
        paint(sl.key);
        applied(sl);
      });
    }
  }

  const note = document.createElement('p');
  note.className = 'tune-note';
  note.textContent = 'The fairness check only covers the defaults. Other values can make some patterns impossible.';
  const actions = document.createElement('div');
  actions.className = 'tune-actions';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Reset to defaults';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy values';
  actions.append(reset, copy);
  const status = document.createElement('p');
  status.className = 'tune-status';
  status.setAttribute('aria-live', 'polite');
  panel.append(note, actions, status);

  function paint(key: keyof typeof TUNE): void {
    const r = rows.get(key)!;
    r.input.value = String(TUNE[key]);
    r.value.textContent = format(r.sl, TUNE[key]);
    r.row.classList.toggle('changed', TUNE[key] !== DEFAULTS[key]);
  }
  function paintAll(): void {
    for (const key of rows.keys()) paint(key);
  }
  function applied(sl: Slider | null): void {
    if (!sl || sl.zones) game.world.refit();
    if (!sl || sl.key === 'volume') sound()?.applyVolume();
    status.textContent = '';
  }

  function setOpen(v: boolean): void {
    open = v;
    panel.hidden = !v;
    button.setAttribute('aria-expanded', String(v));
    if (v) {
      paintAll();
      status.textContent = '';
    }
  }

  setOpenFn = setOpen;

  // Keep panel presses away from the window listener that flips polarity.
  for (const el of [button, panel]) {
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
  }
  button.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    setOpen(!open);
  });
  close.addEventListener('click', () => setOpen(false));
  reset.addEventListener('click', () => {
    resetTune();
    paintAll();
    applied(null);
    status.textContent = 'Back to the defaults.';
  });
  copy.addEventListener('click', () => {
    const text = JSON.stringify(changedTune(), null, 2);
    navigator.clipboard?.writeText(text).then(
      () => (status.textContent = text === '{}' ? 'Copied. Nothing differs from the defaults.' : 'Copied the values that differ from the defaults.'),
      () => (status.textContent = `Copy was blocked. Values: ${text}`),
    ) ?? (status.textContent = `Values: ${text}`);
  });

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyT') {
        e.stopImmediatePropagation();
        setOpen(!open);
      } else if (open && e.code === 'Escape') {
        e.stopImmediatePropagation();
        setOpen(false);
      } else if (open) {
        // Arrow keys and space belong to the sliders while the panel is open.
        e.stopImmediatePropagation();
      }
    },
    { capture: true },
  );

  document.body.append(button, panel);
}
