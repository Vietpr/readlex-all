// The chosen cards are handed to the study page in memory, and mirrored into sessionStorage so that
// a refresh — or a phone dropping the tab — does not end the session. Only this tab sees it, and it
// expires, so a session can never come back days later against a schedule that has moved on.
import type { CardContent, StudyMode } from './types';

export interface Session { cards: CardContent[]; title: string; mode: StudyMode; returnTo: string; startedAt: number }

const KEY = 'readlex.session';
const PROGRESS_KEY = 'readlex.session.progress';
const VERSION = 2;          // bump when the session or progress blobs change shape (2: Learn phases)
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

let current: Session | null = null;
let progress: unknown = null;

// The cards are written once; only the small progress blob is rewritten on every answer.
function persistSession() {
  try {
    if (current) sessionStorage.setItem(KEY, JSON.stringify({ v: VERSION, session: current }));
    else sessionStorage.removeItem(KEY);
  } catch { /* private mode: the session simply stays in memory */ }
}
function persistProgress() {
  try {
    if (progress == null) sessionStorage.removeItem(PROGRESS_KEY);
    else sessionStorage.setItem(PROGRESS_KEY, JSON.stringify({ v: VERSION, progress }));
  } catch { /* private mode */ }
}

export function startSession(cards: CardContent[], title: string, mode: StudyMode, returnTo = '/') {
  current = { cards, title, mode, returnTo, startedAt: Date.now() };
  progress = null;
  persistSession();
  persistProgress();
}

export function takeSession(): Session | null {
  if (current) {
    if (Date.now() - (current.startedAt || 0) > MAX_AGE_MS) { clearSession(); return null; }
    return current;
  }
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { v?: number; session?: Session };
    const s = saved.session;
    if (saved.v !== VERSION || !s || !Array.isArray(s.cards) || !s.cards.length || Date.now() - (s.startedAt || 0) > MAX_AGE_MS) {
      clearSession();
      return null;
    }
    current = s;
    try {
      const p = JSON.parse(sessionStorage.getItem(PROGRESS_KEY) || 'null') as { v?: number; progress?: unknown } | null;
      progress = p && p.v === VERSION ? p.progress : null;
    } catch { progress = null; }
    return current;
  } catch { return null; }
}

export function clearSession() {
  current = null;
  progress = null;
  try { sessionStorage.removeItem(KEY); sessionStorage.removeItem(PROGRESS_KEY); } catch { /* private mode */ }
}

// Each mode owns the shape of its own progress; anything unreadable just starts that session over.
export function saveProgress(data: unknown) { progress = data; persistProgress(); }
export function loadProgress<T>(): T | null { return (progress as T) ?? null; }

// Cards already in the schedule and not due yet are practice-only: rating them would distort FSRS.
export const isPracticeOnly = (card: CardContent) => card.schedule.state !== 0 && card.schedule.due > Date.now();
