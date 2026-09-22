// The study call-to-action on set pages: one obvious default (Learn), a few quick links, the rest in a sheet.
import { isPracticeOnly } from '../session';
import { launch, unavailable, useStudyPicker, type StudyTarget } from './StudyPicker';
import type { CardContent, StudyMode } from '../types';

const QUICK: Array<{ mode: StudyMode; label: string }> = [{ mode: 'flash', label: 'Flashcards' }, { mode: 'write', label: 'Write' }, { mode: 'listen', label: 'Listen' }];

export function QuickModes({ target, onMore }: { target: StudyTarget; onMore: () => void }) {
  return (
    <div className="quick-modes">
      {QUICK.map((q) => <span key={q.mode}><button type="button" disabled={!!unavailable(q.mode, target.cards)} onClick={() => launch(target, q.mode)}>{q.label}</button><i aria-hidden="true">·</i></span>)}
      <button type="button" className="more-modes" aria-label="More study modes" disabled={!target.cards.length} onClick={onMore}>More modes</button>
    </div>
  );
}

// Learn concentrates on what still needs work: words that are new or due. Once everything is
// scheduled and nothing is due, it becomes a practice run over the whole set.
export function learnPlan(cards: CardContent[]): { cards: CardContent[]; label: string } {
  const focus = cards.filter((c) => !isPracticeOnly(c));
  const studied = cards.filter((c) => c.schedule.state !== 0).length;
  const label = !studied ? 'Start learning' : focus.length ? 'Continue learning' : 'Practice again';
  const some = focus.length > 0 && focus.length < cards.length;
  return { cards: focus.length ? focus : cards, label: some ? `${label} · ${focus.length} ${focus.length === 1 ? 'word' : 'words'}` : label };
}

export function StudyActions({ cards, title, returnTo }: { cards: CardContent[]; title: string; returnTo: string }) {
  const { open, picker } = useStudyPicker();
  const plan = learnPlan(cards);
  const all: StudyTarget = { cards, title, returnTo };
  return (
    <div className="study-cta">
      <button className="btn primary block" disabled={!cards.length} onClick={() => launch({ cards: plan.cards, title, returnTo }, 'learn')}>{plan.label}</button>
      <QuickModes target={all} onMore={() => open(all)} />
      {picker}
    </div>
  );
}
