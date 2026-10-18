// Local-only play analytics. Nothing leaves the device: events go to localStorage and nowhere else.
// Same event names and summary fields as Prototype A, so the two can be compared side by side.

export const ANALYTICS_KEY = 'magnetdrop.proto-b.analytics';
const SESSION_KEY = 'magnetdrop.proto-b.session';
const MAX_EVENTS = 5000;
/** A new session starts after this long without an event. */
const SESSION_IDLE_MS = 30 * 60 * 1000;
/** A restart this soon after a death counts as a retry. */
const RETRY_MS = 10_000;

export type AnalyticsEventName = 'session_start' | 'run_start' | 'gate_clear' | 'death' | 'restart';

export interface AnalyticsEvent {
  t: number;
  sessionId: string;
  event: AnalyticsEventName;
  [k: string]: unknown;
}

export interface Summary {
  events: number;
  sessions: number;
  runs: number;
  deaths: number;
  runsPerSession: number;
  medianGatesCleared: number;
  retryAfterDeathRate: number;
  medianSessionMs: number;
  deathsBeforeGate3Share: number;
  deathsByGateType: Record<string, number>;
  deathsByCause: Record<string, number>;
  /** Percent (0..100) of runs that cleared at least 5, 10 and 20 gates. */
  reachPct: { 5: number; 10: number; 20: number };
  distinctDays: number;
}

let cache: AnalyticsEvent[] | null = null;
let session: { id: string; last: number } | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function load(): AnalyticsEvent[] {
  if (cache) return cache;
  const s = storage();
  try {
    const raw = s?.getItem(ANALYTICS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? (parsed as AnalyticsEvent[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function save(): void {
  const s = storage();
  if (!s || !cache) return;
  try {
    s.setItem(ANALYTICS_KEY, JSON.stringify(cache));
  } catch {
    // Storage full or blocked: keep counting in memory.
  }
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function currentSession(now: number): string {
  if (!session) {
    try {
      const raw = storage()?.getItem(SESSION_KEY);
      if (raw) session = JSON.parse(raw) as { id: string; last: number };
    } catch {
      session = null;
    }
  }
  if (!session || now - session.last > SESSION_IDLE_MS) {
    session = { id: newId(), last: now };
    push({ t: now, sessionId: session.id, event: 'session_start' });
  }
  session.last = now;
  try {
    storage()?.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Ignore.
  }
  return session.id;
}

function push(e: AnalyticsEvent): void {
  const list = load();
  list.push(e);
  if (list.length > MAX_EVENTS) list.splice(0, list.length - MAX_EVENTS);
}

/** Record an event. Starts a new session first if the last one went idle. */
export function track(event: Exclude<AnalyticsEventName, 'session_start'>, data: Record<string, unknown> = {}): void {
  const t = Date.now();
  const sessionId = currentSession(t);
  push({ ...data, t, sessionId, event });
  save();
}

export function events(): readonly AnalyticsEvent[] {
  return load();
}

export function clearAnalytics(): void {
  cache = [];
  session = null;
  const s = storage();
  try {
    s?.removeItem(ANALYTICS_KEY);
    s?.removeItem(SESSION_KEY);
  } catch {
    // Ignore.
  }
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const a = xs.slice().sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

const round = (v: number, d = 3): number => Math.round(v * 10 ** d) / 10 ** d;

export function summary(list: readonly AnalyticsEvent[] = load()): Summary {
  const sessions = new Map<string, { first: number; last: number; runs: number }>();
  const days = new Set<string>();
  const gatesPerRun: number[] = [];
  const deathsByGateType: Record<string, number> = {};
  const deathsByCause: Record<string, number> = {};
  let runs = 0;
  let deaths = 0;
  let early = 0;
  let retries = 0;
  let lastDeathT: number | null = null;
  let current = -1;
  const sorted = list.slice().sort((a, b) => a.t - b.t);

  for (const e of sorted) {
    let s = sessions.get(e.sessionId);
    if (!s) {
      s = { first: e.t, last: e.t, runs: 0 };
      sessions.set(e.sessionId, s);
    }
    s.first = Math.min(s.first, e.t);
    s.last = Math.max(s.last, e.t);
    const d = new Date(e.t);
    days.add(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
    switch (e.event) {
      case 'run_start':
        if (current >= 0) gatesPerRun.push(current);
        current = 0;
        runs++;
        s.runs++;
        break;
      case 'gate_clear':
        if (current >= 0) current++;
        break;
      case 'death': {
        deaths++;
        const g = typeof e['gate'] === 'number' ? e['gate'] : current;
        if (g < 3) early++;
        const type = typeof e['gateType'] === 'string' ? e['gateType'] : 'unknown';
        deathsByGateType[type] = (deathsByGateType[type] ?? 0) + 1;
        const cause = typeof e['cause'] === 'string' ? e['cause'] : 'unknown';
        deathsByCause[cause] = (deathsByCause[cause] ?? 0) + 1;
        if (current >= 0) gatesPerRun.push(typeof e['gate'] === 'number' ? e['gate'] : current);
        current = -1;
        lastDeathT = e.t;
        break;
      }
      case 'restart': {
        const ms = typeof e['msSinceDeath'] === 'number' ? e['msSinceDeath'] : lastDeathT !== null ? e.t - lastDeathT : Infinity;
        if (ms <= RETRY_MS) retries++;
        lastDeathT = null;
        break;
      }
      default:
        break;
    }
  }
  if (current >= 0) gatesPerRun.push(current);

  const reach = (n: number): number => (gatesPerRun.length ? round((100 * gatesPerRun.filter((g) => g >= n).length) / gatesPerRun.length, 1) : 0);
  const sessionMs = [...sessions.values()].map((s) => s.last - s.first);
  return {
    events: list.length,
    sessions: sessions.size,
    runs,
    deaths,
    runsPerSession: sessions.size ? round(runs / sessions.size, 2) : 0,
    medianGatesCleared: median(gatesPerRun),
    retryAfterDeathRate: deaths ? round(retries / deaths) : 0,
    medianSessionMs: Math.round(median(sessionMs)),
    deathsBeforeGate3Share: deaths ? round(early / deaths) : 0,
    deathsByGateType,
    deathsByCause,
    reachPct: { 5: reach(5), 10: reach(10), 20: reach(20) },
    distinctDays: days.size,
  };
}
