// Live tunables. Physics, the world, effects and sound read `TUNE` every frame, so the
// slider panel can change them mid-run. Values persist in localStorage.

export interface Tune {
  gravity: number;
  terminalFall: number;
  maxSpeed: number;
  launchSpeed: number;
  airDamping: number;
  pointStrength: number;
  railStrength: number;
  repelScale: number;
  fieldScale: number;
  railField: number;
  zoneGap: number;
  repelBounce: number;
  wallBounce: number;
  cameraSpeed: number;
  shieldRecharge: number;
  juice: number;
  volume: number;
  showZones: number;
}

/** The values every earlier variant shipped with, kept for comparison. */
export const ORIGINAL: Tune = {
  gravity: 700,
  terminalFall: 380,
  maxSpeed: 900,
  launchSpeed: 620,
  airDamping: 0.6,
  pointStrength: 3000,
  railStrength: 2600,
  repelScale: 1,
  fieldScale: 1,
  railField: 110,
  zoneGap: 0,
  repelBounce: 0.6,
  wallBounce: 0.4,
  cameraSpeed: 60,
  shieldRecharge: 5,
  juice: 1,
  volume: 1,
  showZones: 0,
};

export const DEFAULTS: Tune = {
  gravity: 560,
  terminalFall: 300,
  maxSpeed: 700,
  launchSpeed: 520,
  airDamping: 0.9,
  pointStrength: 3000,
  railStrength: 2600,
  repelScale: 0.65,
  fieldScale: 0.75,
  railField: 80,
  zoneGap: 16,
  repelBounce: 0.45,
  wallBounce: 0.4,
  cameraSpeed: 50,
  shieldRecharge: 5,
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
  /** Changing it reshapes the magnet zones, so live magnets are refitted. */
  zones?: boolean;
  toggle?: boolean;
}

export interface SliderGroup {
  title: string;
  sliders: Slider[];
}

export const SLIDER_GROUPS: SliderGroup[] = [
  {
    title: 'Speed',
    sliders: [
      { key: 'gravity', label: 'Gravity', hint: 'How hard the orb falls', min: 200, max: 1200, step: 10 },
      { key: 'terminalFall', label: 'Max fall speed', hint: 'Falling eases toward this', min: 120, max: 700, step: 10 },
      { key: 'maxSpeed', label: 'Top speed', hint: 'Hard cap on any movement', min: 300, max: 1400, step: 10 },
      { key: 'launchSpeed', label: 'Launch speed', hint: 'Kick when you flip off a magnet', min: 200, max: 1000, step: 10 },
      { key: 'airDamping', label: 'Side drag', hint: 'How fast sideways drift dies', min: 0, max: 3, step: 0.05 },
    ],
  },
  {
    title: 'Magnets',
    sliders: [
      { key: 'pointStrength', label: 'Round magnet pull', hint: 'Force at the centre of a round magnet', min: 500, max: 6000, step: 50 },
      { key: 'railStrength', label: 'Rail pull', hint: 'Force next to a rail', min: 500, max: 6000, step: 50 },
      { key: 'repelScale', label: 'Same colour push', hint: 'Push strength as a share of the pull', min: 0, max: 1.5, step: 0.05 },
      { key: 'fieldScale', label: 'Round zone size', hint: 'Share of each magnet\u2019s designed reach', min: 0.3, max: 1.3, step: 0.05, zones: true },
      { key: 'railField', label: 'Rail zone size', hint: 'Reach out from a rail, in pixels', min: 20, max: 160, step: 5, zones: true },
      { key: 'zoneGap', label: 'Gap between zones', hint: 'Zones shrink to keep at least this apart', min: 0, max: 80, step: 2, zones: true },
      { key: 'repelBounce', label: 'Same colour bounce', hint: 'Bounce off a same colour magnet', min: 0, max: 1, step: 0.05 },
      { key: 'wallBounce', label: 'Wall bounce', hint: 'Bounce off the side walls', min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    title: 'Run',
    sliders: [
      { key: 'cameraSpeed', label: 'Screen push', hint: 'Slowest the screen scrolls, so you can\u2019t hang forever', min: 0, max: 160, step: 5 },
      { key: 'shieldRecharge', label: 'Shield recharge', hint: 'Gates to clear before the shield is back', min: 1, max: 15, step: 1 },
    ],
  },
  {
    title: 'Feel',
    sliders: [
      { key: 'juice', label: 'Effects', hint: 'Shake, flashes and zoom', min: 0, max: 2, step: 0.1 },
      { key: 'volume', label: 'Volume', hint: 'Master volume', min: 0, max: 1.5, step: 0.05 },
      { key: 'showZones', label: 'Show zone edges', hint: 'Outline where each pull starts', min: 0, max: 1, step: 1, zones: true, toggle: true },
    ],
  },
];

export const TUNE_KEY = 'magnetdrop.endless-tuner.settings';

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
