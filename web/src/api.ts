import { clearSession } from './session';
import type { CardContent, CustomSet, DailySet, Definition, DifficultItem, Exposure, FlashDirection, Rating, ReviewResult, StatsResponse, TodayResponse, Vocabulary } from './types';

export interface Config { apiUrl: string; token: string; email: string; language: '' | 'en' | 'ja'; accent: 'en-US' | 'en-GB' | 'en-AU'; speechRate: number; autoPlay: boolean; voiceEn: string; flashDirection: FlashDirection; contextInput: 'choose' | 'type' }
const CONFIG_KEY = 'readlex.config';
const QUEUE_KEY = 'readlex.reviewQueue';
// Baked in at build time (VITE_API_URL); when set, users never have to type the server address.
export const DEFAULT_API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) || (import.meta.env.DEV ? 'http://localhost:8787' : '');

export function getConfig(): Config {
  const base: Config = { apiUrl: DEFAULT_API_URL, token: '', email: '', language: '', accent: 'en-US', speechRate: 1, autoPlay: false, voiceEn: '', flashDirection: 'word', contextInput: 'choose' };
  try {
    const stored = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}') as Partial<Config>;
    return { ...base, ...stored, apiUrl: stored.apiUrl || DEFAULT_API_URL };
  } catch { return base; }
}
export function setConfig(patch: Partial<Config>): Config {
  const next = { ...getConfig(), ...patch };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
  return next;
}
// The server needs the offset in minutes; users only ever see the zone name.
export const tzOffset = () => -new Date().getTimezoneOffset();
export function timeZoneLabel(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time';
  const off = tzOffset();
  const sign = off >= 0 ? '+' : '-';
  const h = Math.floor(Math.abs(off) / 60);
  const m = Math.abs(off) % 60;
  return `${zone} (UTC${sign}${h}${m ? ':' + String(m).padStart(2, '0') : ''})`;
}
export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function formatSetDate(key: string, style: 'short' | 'long' = 'short'): string {
  const d = new Date(`${key}T00:00:00`);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', { month: style, day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function isConfigured(): boolean {
  const c = getConfig();
  return !!(c.apiUrl && c.token);
}

export class ApiError extends Error {
  status: number;
  data: unknown;   // the parsed body, so a caller can read per-item results out of a failed batch
  constructor(status: number, message: string, data: unknown = null) { super(message); this.status = status; this.data = data; }
}

async function request<T>(path: string, { method = 'GET', body, config }: { method?: string; body?: unknown; config?: Config } = {}): Promise<T> {
  const c = config || getConfig();
  if (!c.apiUrl) throw new ApiError(0, 'No server configured');
  let res: Response;
  try {
    res = await fetch(`${c.apiUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiError(0, `Can't reach the server (${(err as Error).message})`);
  }
  const data = await res.json().catch(() => null) as (T & { ok?: boolean; error?: string }) | null;
  if (res.status === 401 && !path.startsWith('/api/v1/auth/login') && !path.startsWith('/api/v1/auth/register') && c.token) {
    setConfig({ token: '' });
    clearSession();
    window.dispatchEvent(new Event('readlex:logout'));
  }
  if (!res.ok || (data && data.ok === false)) throw new ApiError(res.status, data?.error || `HTTP ${res.status}`, data);
  return data as T;
}

export interface AuthUser { id: string; email: string; displayName: string; role: string; geminiModel: string; hasGeminiKey: boolean; createdAt: number }

export const auth = {
  async login(apiUrl: string, email: string, password: string) {
    const r = await request<{ ok: boolean; token: string; user: AuthUser }>('/api/v1/auth/login', { method: 'POST', body: { email, password, kind: 'web', label: navigator.userAgent.slice(0, 60) }, config: { ...getConfig(), apiUrl, token: '' } });
    setConfig({ apiUrl, token: r.token, email: r.user.email });
    return r.user;
  },
  async register(apiUrl: string, email: string, password: string, inviteCode: string, displayName = '') {
    const r = await request<{ ok: boolean; token: string; user: AuthUser }>('/api/v1/auth/register', { method: 'POST', body: { email, password, inviteCode, displayName, kind: 'web' }, config: { ...getConfig(), apiUrl, token: '' } });
    setConfig({ apiUrl, token: r.token, email: r.user.email });
    return r.user;
  },
  async logout() {
    try { await request('/api/v1/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    setConfig({ token: '' });
    clearSession();
  },
  me: () => request<{ ok: boolean; user: AuthUser; session: { kind: string; label: string } }>('/api/v1/auth/me'),
  setGemini: (apiKey: string, model: string) => request<{ ok: boolean; hasGeminiKey: boolean; model: string; masked: string; mock?: boolean }>('/api/v1/me/gemini', { method: 'PUT', body: { apiKey, model } }),
  removeGemini: () => request<{ ok: boolean }>('/api/v1/me/gemini', { method: 'DELETE' }),
  changePassword: (currentPassword: string, password: string) => request<{ ok: boolean }>('/api/v1/me', { method: 'PATCH', body: { currentPassword, password } }),
  deleteAccount: (password: string) => request<{ ok: boolean }>('/api/v1/me', { method: 'DELETE', body: { password } }),
  health: (apiUrl: string) => request<{ ok: boolean; version: string; mock: boolean; signup: string; mail: boolean }>('/api/v1/health', { config: { ...getConfig(), apiUrl, token: '' } }),
  forgot: (apiUrl: string, email: string) => request<{ ok: boolean; sent: boolean; mail: boolean; devToken?: string; error?: string }>('/api/v1/auth/forgot', { method: 'POST', body: { email }, config: { ...getConfig(), apiUrl, token: '' } }),
  async reset(apiUrl: string, token: string, password: string) {
    const r = await request<{ ok: boolean; token: string; user: AuthUser }>('/api/v1/auth/reset', { method: 'POST', body: { token, password }, config: { ...getConfig(), apiUrl, token: '' } });
    setConfig({ apiUrl, token: r.token, email: r.user.email });
    return r.user;
  },
};

export const api = {
  today: (c: Config) => request<TodayResponse>(`/api/v1/today?tz=${tzOffset()}${c.language ? `&language=${c.language}` : ''}`),
  sets: (c: Config) => request<{ ok: boolean; today: string; sets: DailySet[] }>(`/api/v1/sets?tz=${tzOffset()}${c.language ? `&language=${c.language}` : ''}`),
  set: (date: string) => request<{ ok: boolean; date: string; cards: CardContent[]; words: number; studied: number }>(`/api/v1/sets/${date}?tz=${tzOffset()}`),
  sessions: () => request<{ ok: boolean; sessions: Array<{ id: string; kind: string; label: string; last_used_at: number }> }>('/api/v1/auth/tokens'),
  reviews: (items: Array<{ cardId: string; rating: Rating; durationMs?: number; reviewedAt?: number }>) => request<{ ok: boolean; results: ReviewResult[] }>('/api/v1/reviews', { method: 'POST', body: { reviews: items } }),
  vocabulary: (params: Record<string, string | number>) => request<{ ok: boolean; total: number; items: Vocabulary[] }>(`/api/v1/vocabulary?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined).map(([k, v]) => [k, String(v)])).toString()}`),
  detail: (id: string) => request<{ ok: boolean; vocabulary: Vocabulary; exposures: Exposure[]; card: CardContent | null; reviews: Array<{ rating: number; reviewed_at: number; scheduled_days: number }>; lookups: { count: number } | null }>(`/api/v1/vocabulary/${encodeURIComponent(id)}`),
  patch: (id: string, patch: { status?: string; note?: string | null; suspended?: boolean; lemma?: string; reading?: string; meaning?: string | null }) => request<{ ok: boolean; vocabulary: Vocabulary }>(`/api/v1/vocabulary/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
  enrich: (id: string) => request<{ ok: boolean; vocabulary: Vocabulary }>(`/api/v1/vocabulary/${encodeURIComponent(id)}/enrich`, { method: 'POST' }),
  deleteWord: (id: string) => request<{ ok: boolean }>(`/api/v1/vocabulary/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  deleteExposure: (id: string) => request<{ ok: boolean }>(`/api/v1/exposures/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  addWord: (w: { language: 'en' | 'ja'; word: string; reading?: string; meaning?: string; sentence?: string }) =>
    request<{ ok: boolean; vocabularyId: string; created: boolean }>('/api/v1/sync', { method: 'POST', body: { op: 'vocabulary.save', clientCreatedAt: Date.now(), payload: {
      vocabulary: { language: w.language, lemma: w.language === 'ja' ? w.word.trim() : w.word.trim().toLowerCase(), surface: w.word.trim(), reading: w.reading?.trim() || '', quickMeaning: w.meaning?.trim() || null, userMeaning: w.meaning?.trim() || null },
      exposure: w.sentence?.trim() ? { surface: w.word.trim(), sentence: w.sentence.trim(), paragraph: w.sentence.trim(), url: '', pageTitle: 'Added by hand', encounteredAt: Date.now() } : null } } }),
  customSets: (vocabularyId = '') => request<{ ok: boolean; sets: CustomSet[] }>(`/api/v1/custom-sets${vocabularyId ? `?vocabularyId=${encodeURIComponent(vocabularyId)}` : ''}`),
  createSet: (name: string, vocabularyIds: string[] = []) => request<{ ok: boolean; set: { id: string; name: string } }>('/api/v1/custom-sets', { method: 'POST', body: { name, vocabularyIds } }),
  customSet: (id: string) => request<{ ok: boolean; set: { id: string; name: string; description: string }; cards: CardContent[] }>(`/api/v1/custom-sets/${encodeURIComponent(id)}`),
  updateSet: (id: string, patch: { name?: string; description?: string }) => request<{ ok: boolean }>(`/api/v1/custom-sets/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
  deleteSet: (id: string) => request<{ ok: boolean }>(`/api/v1/custom-sets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  addToSet: (id: string, vocabularyIds: string[]) => request<{ ok: boolean; added: number }>(`/api/v1/custom-sets/${encodeURIComponent(id)}/items`, { method: 'POST', body: { vocabularyIds } }),
  removeFromSet: (id: string, vocabularyId: string) => request<{ ok: boolean }>(`/api/v1/custom-sets/${encodeURIComponent(id)}/items/${encodeURIComponent(vocabularyId)}`, { method: 'DELETE' }),
  // Ask the user's own Gemini key for the meaning of words being typed in. Nothing is stored server side.
  define: (language: 'en' | 'ja', terms: string[]) => request<{ ok: boolean; language: string; mock?: boolean; items: Definition[] }>('/api/v1/define', { method: 'POST', body: { language, terms } }),
  stats: (days = 30) => request<StatsResponse>(`/api/v1/stats?tz=${tzOffset()}&days=${days}`),
  difficult: (limit = 12) => request<{ ok: boolean; items: DifficultItem[] }>(`/api/v1/difficult?limit=${limit}`),
};

// ---- offline review queue ----
// Every rating goes through this queue, so one is never lost to a flaky network, to a session that
// expired, or to a second sync running at the same moment. An entry only leaves the queue once the
// server has answered for that entry.
interface QueuedReview { id: string; cardId: string; rating: Rating; durationMs: number; reviewedAt: number; tries?: number }
const QUEUE_MAX = 2000;         // a hard stop on runaway growth, far above any real backlog
const MAX_TRIES = 8;            // a rating the server keeps refusing must not jam every later sync
const BATCH = 100;

// The queue belongs to an account: signing in as someone else must not send — or throw away —
// ratings that belong to the previous one.
const queueKey = () => `${QUEUE_KEY}:${getConfig().email || 'anon'}`;
const keyOf = (e: QueuedReview) => e.id || `${e.cardId}:${e.reviewedAt}`;
const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

const memory: Record<string, QueuedReview[]> = {};
let storageOk = true;

function saveQueue(q: QueuedReview[]) {
  const key = queueKey();
  const trimmed = q.slice(-QUEUE_MAX);
  memory[key] = trimmed;
  try { localStorage.setItem(key, JSON.stringify(trimmed)); storageOk = true; } catch { storageOk = false; }
  try { window.dispatchEvent(new Event('readlex:queue')); } catch { /* not a browser */ }
}

function readQueue(): QueuedReview[] {
  const key = queueKey();
  if (!storageOk) return memory[key] || [];
  let list: QueuedReview[] = [];
  try { const raw = JSON.parse(localStorage.getItem(key) || '[]'); if (Array.isArray(raw)) list = raw; } catch { /* unreadable */ }
  try {
    // entries written before the queue was per-account and before entries carried an id
    const legacy = localStorage.getItem(QUEUE_KEY);
    if (legacy && getConfig().email) {
      const old = JSON.parse(legacy);
      if (Array.isArray(old) && old.length) list = [...old, ...list];
      localStorage.removeItem(QUEUE_KEY);
    }
  } catch { /* ignore */ }
  const clean = list.filter((e) => e && typeof e.cardId === 'string').map((e) => (e.id ? e : { ...e, id: newId() }));
  if (clean.length !== list.length || clean.some((e, i) => e !== list[i])) saveQueue(clean);
  return clean;
}

export function queuedReviewCount(): number { return readQueue().length; }

export async function submitReview(item: { cardId: string; rating: Rating; durationMs: number }): Promise<void> {
  saveQueue([...readQueue(), { ...item, reviewedAt: Date.now(), id: newId() }]);
  await flushReviewQueue();
}

// Flushes run one after another, never side by side: a rating given while a flush is in flight is
// sent by the next link in the chain instead of waiting for the next app start.
let chain: Promise<number> = Promise.resolve(0);
export function flushReviewQueue(): Promise<number> {
  chain = chain.then(runFlush, runFlush);
  return chain;
}

interface ItemResult { ok?: boolean; error?: string }
// A card that no longer exists can never be accepted, so it must leave the queue or it jams every
// later sync. Anything else stays for the next attempt.
const settledForGood = (r: ItemResult) => !!r.ok || /not found/i.test(r.error || '');

async function runFlush(): Promise<number> {
  let accepted = 0;
  for (let round = 0; round < 6; round++) {
    const batch = readQueue().slice(0, BATCH);
    if (!batch.length) break;
    let results: ItemResult[] | null = null;
    try {
      results = (await api.reviews(batch)).results;
    } catch (err) {
      const body = err instanceof ApiError ? (err.data as { results?: ItemResult[] } | null) : null;
      if (!body?.results) return accepted;   // offline, 401, 429, 5xx: keep everything and try later
      results = body.results;
    }
    const settled = new Set<string>();
    const refused = new Set<string>();
    batch.forEach((entry, i) => {
      const r = results?.[i];
      if (!r) return;
      if (r.ok) accepted += 1;
      if (settledForGood(r)) settled.add(keyOf(entry)); else refused.add(keyOf(entry));
    });
    if (!settled.size && !refused.size) return accepted;
    // re-read: ratings given while this batch was in flight must survive
    saveQueue(readQueue()
      .map((e) => (refused.has(keyOf(e)) ? { ...e, tries: (e.tries || 0) + 1 } : e))
      .filter((e) => !settled.has(keyOf(e)) && (e.tries || 0) < MAX_TRIES));
    if (!settled.size) return accepted;   // nothing got through; do not spin on the same batch
  }
  return accepted;
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} d ago`;
  return formatDate(ts);
}
export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
