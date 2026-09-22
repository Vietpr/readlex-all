// FSRS scheduling on top of ts-fsrs. One card per vocabulary item; reviews recorded per rating.
import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type Grade } from 'ts-fsrs';
import type { CardRow } from './types';

const params = generatorParameters({ enable_fuzz: true, enable_short_term: true, maximum_interval: 365 });
const scheduler = fsrs(params);

export const RATING_NAMES: Record<number, string> = { 1: 'again', 2: 'hard', 3: 'good', 4: 'easy' };

export function rowToCard(row: CardRow): Card {
  const empty = createEmptyCard(new Date(row.created_at));
  return {
    ...empty,
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as State,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
  };
}

export function cardToPatch(card: Card): Partial<CardRow> {
  return {
    state: card.state,
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    last_review: card.last_review ? card.last_review.getTime() : null,
  };
}

export function newCardFields(now: number): Partial<CardRow> {
  const c = createEmptyCard(new Date(now));
  return { ...cardToPatch(c), due: now };
}

export function review(row: CardRow, rating: number, now: Date) {
  const grade = Math.min(4, Math.max(1, Math.round(Number(rating) || 3))) as Grade;   // a missing or odd rating means "Good", never NaN
  const card = rowToCard(row);
  const result = scheduler.next(card, now, grade);
  return { card: result.card, log: result.log, grade };
}

// Human-readable interval for each of the four buttons ("10 phút", "3 ngày").
export function previewIntervals(row: CardRow, now: Date): Record<string, string> {
  const card = rowToCard(row);
  const out: Record<string, string> = {};
  for (const grade of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as Grade[]) {
    const r = scheduler.next(card, now, grade);
    out[RATING_NAMES[grade]] = humanInterval(r.card.due.getTime() - now.getTime());
  }
  return out;
}

export function humanInterval(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

export { State };
