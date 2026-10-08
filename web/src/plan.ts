// Today's plan: the short list of things worth doing today, in order. The Today page draws it and
// the end of a session uses it to offer the next step, so both always agree.
import { api, flushReviewQueue, getConfig, queuedReviewCount, todayKey } from './api';
import { isPracticeOnly } from './session';
import type { StudyTarget } from './components/StudyPicker';
import type { CardContent, StudyMode, TodayResponse } from './types';

const words = (n: number) => `${n} ${n === 1 ? 'word' : 'words'}`;

export interface PlanStep {
  id: 'review' | 'saved' | 'backlog';
  title: string;
  hint: string;
  cta: string;
  mode: StudyMode;
  target: StudyTarget;   // what the main button starts
  all: StudyTarget;      // what "another way" offers in the mode picker
  done: boolean;
}

export function todayPlan(data: TodayResponse, todaySet: CardContent[]): PlanStep[] {
  const steps: PlanStep[] = [];
  const due = data.due;
  const review: StudyTarget = { cards: due, title: "Today's review", returnTo: '/' };
  if (due.length) {
    const minutes = Math.max(1, Math.round(due.length * 0.4));
    steps.push({ id: 'review', title: `Review ${due.length} due ${due.length === 1 ? 'card' : 'cards'}`, hint: `About ${minutes} min. Flip each card and rate yourself; ReadLex schedules when you see it next.`, cta: 'Start review', mode: 'flash', target: review, all: review, done: false });
  } else if (data.counts.reviewedToday > 0) {
    steps.push({ id: 'review', title: 'Due cards reviewed', hint: `${data.counts.reviewedToday} ${data.counts.reviewedToday === 1 ? 'review' : 'reviews'} today.`, cta: '', mode: 'flash', target: review, all: review, done: true });
  }

  if (todaySet.length) {
    const saved: StudyTarget = { cards: todaySet, title: `Saved today · ${words(todaySet.length)}`, returnTo: '/' };
    const focus = todaySet.filter((c) => !isPracticeOnly(c));
    const started = todaySet.some((c) => c.schedule.state !== 0);
    if (focus.length) {
      steps.push({ id: 'saved', title: started ? `Keep learning ${words(focus.length)} saved today` : `Learn ${focus.length} new ${focus.length === 1 ? 'word' : 'words'} saved today`, hint: 'Three steps, a few words at a time: meet each word, choose the right answer, then write it from memory.',
        cta: started ? 'Continue learning' : 'Start learning', mode: 'learn', target: { ...saved, cards: focus }, all: saved, done: false });
    } else {
      steps.push({ id: 'saved', title: `Learned ${words(todaySet.length)} saved today`, hint: 'They come back when they are due for review.', cta: '', mode: 'learn', target: saved, all: saved, done: true });
    }
  }

  const dayStart = new Date(`${todayKey()}T00:00:00`).getTime();
  const backlog = data.new.filter((c) => c.savedAt < dayStart);
  if (backlog.length) {
    const earlier: StudyTarget = { cards: backlog, title: `Earlier words · ${words(backlog.length)}`, returnTo: '/' };
    steps.push({ id: 'backlog', title: `Catch up on ${words(backlog.length)} from earlier days`, hint: 'Saved, but not studied yet.', cta: 'Start learning', mode: 'learn', target: earlier, all: earlier, done: false });
  }
  return steps;
}

export async function loadTodayPlan(): Promise<{ data: TodayResponse; todaySet: CardContent[]; steps: PlanStep[] }> {
  const [data, set] = await Promise.all([api.today(getConfig()), api.set(todayKey()).catch(() => null)]);
  const todaySet = set ? set.cards : [];
  return { data, todaySet, steps: todayPlan(data, todaySet) };
}

// After a session: the next thing still open today. Answers that have not reached the server yet
// would make the plan lie (the cards just rated would still look due), so then there is no suggestion.
export async function nextStepAfterSession(): Promise<PlanStep | null> {
  await flushReviewQueue().catch(() => 0);
  if (queuedReviewCount() > 0) return null;
  const { steps } = await loadTodayPlan();
  return steps.find((s) => !s.done) || null;
}
