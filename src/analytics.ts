// Local-only playtest analytics. Nothing leaves the device: events go to localStorage and the tuning panel
// shows a summary. Prototype A and Prototype B record the same events and the same summary, so their
// numbers can be compared directly.

export const ANALYTICS_KEY = 'magnetdrop.proto-a.analytics';
const MAX_EVENTS = 5000;
/** A new session starts after this long with no events. */
const SESSION_IDLE_MS = 30 * 60 * 1000;
/** Restarting within this long of dying counts as a retry. */
const RETRY_MS = 10 * 1000;

export type EventName = 'session_start' | 'run_start' | 'gate_clear' | 'death' | 'restart';

export interface AnalyticsEvent {
  t: number;
  sessionId: string;
  event: EventName;
  [key: string]: unknown;
}

let sessionId = '';
let lastT = 0;
/** In-memory copy, so a gate clear never parses the whole log mid-run. */
let cache: AnalyticsEvent[] | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function load(): AnalyticsEvent[] {
  if (cache) return cache;
  cache = read();
  return cache;
}

function read(): AnalyticsEvent[] {
  try {
    const raw = localStorage.getItem(ANALYTICS_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? (list as AnalyticsEvent[]) : [];
  } catch {
    return [];
  }
}

/** Write the log now. */
export function flush(): void {
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
  if (!cache) return;
  if (cache.length > MAX_EVENTS) cache = cache.slice(-MAX_EVENTS);
  try {
    localStorage.setItem(ANALYTICS_KEY, JSON.stringify(cache));
  } catch {
    // Storage full or blocked: analytics are best effort.
  }
}

/** Record an event. Starts a new session first if this is the first event or the last one was 30+ min ago. */
export function track(event: Exclude<EventName, 'session_start'>, data: Record<string, unknown> = {}): void {
  const list = load();
  const now = Date.now();
  if (!sessionId) {
    const last = list[list.length - 1];
    if (last && now - last.t < SESSION_IDLE_MS) {
      sessionId = last.sessionId;
      lastT = last.t;
    }
  }
  if (!sessionId || now - lastT >= SESSION_IDLE_MS) {
    sessionId = `${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    list.push({ t: now, sessionId, event: 'session_start' });
  }
  list.push({ ...data, t: now, sessionId, event });
  lastT = now;
  // Deaths are written at once; frequent events are batched so writing never lands mid-run.
  if (event === 'death') flush();
  else if (flushTimer === null) flushTimer = setTimeout(flush, 1500);
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', flush);

export function events(): AnalyticsEvent[] {
  return [...load()];
}

export function clearAnalytics(): void {
  try {
    localStorage.removeItem(ANALYTICS_KEY);
  } catch {
    // ignore
  }
  cache = [];
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
  sessionId = '';
  lastT = 0;
}

export interface Summary {
  events: number;
  sessions: number;
  runs: number;
  runsPerSession: number;
  medianGatesCleared: number;
  deaths: number;
  /** Share of deaths followed by a restart within 10 s. */
  retryAfterDeathRate: number;
  medianSessionMinutes: number;
  /** Share of deaths before clearing gate 3. */
  deathsBeforeGate3: number;
  deathsByGateType: Record<string, number>;
  deathsByCause: Record<string, number>;
  /** Share of runs that cleared at least 5, 10 and 20 gates. */
  reached5: number;
  reached10: number;
  reached20: number;
  /** Number of different calendar days with a session (a second day means the player came back). */
  sessionDays: number;
  returnedOnAnotherDay: boolean;
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const ratio = (a: number, b: number): number => (b ? Math.round((a / b) * 1000) / 1000 : 0);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function summary(list: AnalyticsEvent[] = load()): Summary {
  const sessions = new Map<string, { first: number; last: number }>();
  for (const e of list) {
    const s = sessions.get(e.sessionId);
    if (s) s.last = e.t;
    else sessions.set(e.sessionId, { first: e.t, last: e.t });
  }
  // Gates cleared per run: count gate_clear events between one run_start and the next.
  const runGates: number[] = [];
  let current = -1;
  const deaths: AnalyticsEvent[] = [];
  let retries = 0;
  for (let i = 0; i < list.length; i++) {
    const e = list[i]!;
    if (e.event === 'run_start') {
      if (current >= 0) runGates.push(current);
      current = 0;
    } else if (e.event === 'gate_clear' && current >= 0) {
      current = Math.max(current, num(e.gate) + 1);
    } else if (e.event === 'death') {
      deaths.push(e);
    } else if (e.event === 'restart' && num(e.msSinceDeath) <= RETRY_MS) {
      retries++;
    }
  }
  if (current >= 0) runGates.push(current);
  const byType: Record<string, number> = {};
  const byCause: Record<string, number> = {};
  for (const d of deaths) {
    const k = String(d.gateType ?? 'unknown');
    byType[k] = (byType[k] ?? 0) + 1;
    const c = String(d.cause ?? 'unknown');
    byCause[c] = (byCause[c] ?? 0) + 1;
  }
  const days = new Set([...sessions.values()].map((s) => new Date(s.first).toDateString()));
  const runs = runGates.length;
  return {
    events: list.length,
    sessions: sessions.size,
    runs,
    runsPerSession: ratio(runs, sessions.size),
    medianGatesCleared: median(runGates),
    deaths: deaths.length,
    retryAfterDeathRate: ratio(retries, deaths.length),
    medianSessionMinutes: Math.round(median([...sessions.values()].map((s) => (s.last - s.first) / 60000)) * 10) / 10,
    deathsBeforeGate3: ratio(deaths.filter((d) => num(d.gate) < 3).length, deaths.length),
    deathsByGateType: byType,
    deathsByCause: byCause,
    reached5: ratio(runGates.filter((g) => g >= 5).length, runs),
    reached10: ratio(runGates.filter((g) => g >= 10).length, runs),
    reached20: ratio(runGates.filter((g) => g >= 20).length, runs),
    sessionDays: days.size,
    returnedOnAnotherDay: days.size > 1,
  };
}
