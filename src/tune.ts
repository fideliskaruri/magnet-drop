// Live tunables. Physics, the world, effects and sound read `TUNE` every step, so the
// slider panel can change them mid-run. Values persist in localStorage.

export interface Tune {
  baseSpeed: number;
  pull: number;
  damping: number;
  maxVy: number;
  launchSpeed: number;
  launchBoost: number;
  railReach: number;
  recover: number;
  backBounce: number;
  bounce: number;
  neutralPull: number;
  tunnelGrip: number;
  gateGap: number;
  juice: number;
  volume: number;
  showZones: number;
}

export const DEFAULTS: Tune = {
  baseSpeed: 190,
  pull: 850,
  damping: 1.4,
  maxVy: 420,
  launchSpeed: 380,
  launchBoost: 60,
  railReach: 28,
  recover: 110,
  backBounce: 120,
  bounce: 0.35,
  neutralPull: 0.12,
  tunnelGrip: 0.55,
  gateGap: 1,
  juice: 1,
  volume: 1,
  showZones: 0,
};

export interface Slider {
  key: keyof Tune;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  toggle?: boolean;
}

export interface SliderGroup {
  title: string;
  sliders: Slider[];
}

export const SLIDER_GROUPS: SliderGroup[] = [
  {
    title: 'Movement',
    sliders: [
      { key: 'baseSpeed', label: 'Base speed', hint: 'How fast the world scrolls at the start, px/s', min: 100, max: 340, step: 5 },
      { key: 'pull', label: 'Vertical pull', hint: 'Acceleration toward the attracting rail', min: 300, max: 2000, step: 25 },
      { key: 'damping', label: 'Vertical drag', hint: 'Lower keeps more momentum (longer arcs)', min: 0, max: 4, step: 0.05 },
      { key: 'maxVy', label: 'Top vertical speed', hint: 'Hard cap on up and down speed', min: 200, max: 900, step: 10 },
      { key: 'recover', label: 'Recovery speed', hint: 'Extra forward speed while you are behind your spot', min: 0, max: 260, step: 5 },
    ],
  },
  {
    title: 'Magnets',
    sliders: [
      { key: 'launchSpeed', label: 'Launch speed', hint: 'Kick when you flip off a surface', min: 150, max: 800, step: 10 },
      { key: 'launchBoost', label: 'Launch forward kick', hint: 'Forward speed added by a launch', min: 0, max: 200, step: 5 },
      { key: 'railReach', label: 'Rail reach', hint: 'Rails grab harder within this distance, px', min: 0, max: 80, step: 2 },
      { key: 'neutralPull', label: 'Neutral zone pull', hint: 'Share of the pull left inside neutral zones', min: 0, max: 1, step: 0.02 },
      { key: 'tunnelGrip', label: 'Tunnel wall grip', hint: 'Speed kept while scraping a tunnel wall', min: 0.3, max: 1, step: 0.05 },
    ],
  },
  {
    title: 'Gates',
    sliders: [
      { key: 'gateGap', label: 'Gap between gates', hint: 'Scales the space between gates (new gates only)', min: 0.6, max: 1.8, step: 0.05 },
      { key: 'backBounce', label: 'Knock-back', hint: 'Backward speed when you hit a gate face', min: 40, max: 300, step: 5 },
      { key: 'bounce', label: 'Bounciness', hint: 'Bounce off iron, paddles and the pendulum', min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    title: 'Feel',
    sliders: [
      { key: 'juice', label: 'Effects', hint: 'Shake, flashes and camera kicks', min: 0, max: 2, step: 0.1 },
      { key: 'volume', label: 'Volume', hint: 'Master volume', min: 0, max: 1.5, step: 0.05 },
      { key: 'showZones', label: 'Show field zones', hint: 'Outline rail reach and neutral zones', min: 0, max: 1, step: 1, toggle: true },
    ],
  },
];

export const TUNE_KEY = 'magnetdrop.proto-b.settings';

export const TUNE: Tune = { ...DEFAULTS };

export function loadTune(): void {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(TUNE_KEY) : null;
    if (!raw) return;
    const saved = JSON.parse(raw) as Partial<Record<keyof Tune, unknown>>;
    for (const k of Object.keys(DEFAULTS) as (keyof Tune)[]) {
      const v = saved[k];
      if (typeof v === 'number' && Number.isFinite(v)) TUNE[k] = v;
    }
  } catch {
    // Bad or blocked storage: keep the defaults.
  }
}

export function saveTune(): void {
  try {
    localStorage.setItem(TUNE_KEY, JSON.stringify(TUNE));
  } catch {
    // Storage blocked: the values still apply for this session.
  }
}

export function resetTune(): void {
  Object.assign(TUNE, DEFAULTS);
  try {
    localStorage.removeItem(TUNE_KEY);
  } catch {
    // Ignore.
  }
}

/** Only the values that differ from the defaults. */
export function changedTune(): Partial<Tune> {
  const out: Partial<Tune> = {};
  for (const k of Object.keys(DEFAULTS) as (keyof Tune)[]) if (TUNE[k] !== DEFAULTS[k]) out[k] = TUNE[k];
  return out;
}
