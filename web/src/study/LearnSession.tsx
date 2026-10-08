// Learn: rounds of a few words, each round in three phases (Meet, Choose, Write), driven by the
// engine in learn.ts. The UI only renders the current step and reports results; one FSRS review per
// word is sent when the word passes its last phase.
import { useEffect, useMemo, useRef, useState } from 'react';
import { clearSession, loadProgress, saveProgress, type Session } from '../session';
import { navigate } from '../router';
import { Icon, type IconName } from '../components/Icon';
import { MODE_LABEL, RATING_LABEL, type CardContent } from '../types';
import { buildChoices, type Distractor } from './answers';
import { PHASES, answer, createLearn, currentStep, currentWord, nextRound, phaseCount, progress, ratingFor, type LearnState, type LearnWord, type Step, type StepResult } from './learn';
import { Flashcard } from './Flashcard';
import { ChoiceExercise, WriteExercise, type ExerciseResult } from './exercises';
import { PracticeNote, SessionHeader, recordReview } from './SessionChrome';
import { launch } from '../components/StudyPicker';
import { SessionExit } from '../components/NextStep';

type SavedWord = Omit<LearnWord, 'card'> & { cardId: string };
interface SavedLearn { kind: 'learn'; state: Omit<LearnState, 'words'> & { words: SavedWord[] } }

const PHASE_META: Record<Step, { label: string; icon: IconName }> = {
  meet: { label: 'Meet', icon: 'book' },
  choose: { label: 'Choose', icon: 'listChecks' },
  write: { label: 'Write', icon: 'keyboard' },
};

// The three phases of the round: ticked once the whole group has passed them, the current one highlighted.
function PhaseBar({ step }: { step: Step }) {
  const at = PHASES.indexOf(step);
  return (
    <ol className="phase-bar" aria-label="Phases of this round">
      {PHASES.map((p, i) => (
        <li key={p} className={i < at ? 'done' : i === at ? 'now' : ''} aria-current={i === at ? 'step' : undefined}>
          <Icon name={i < at ? 'check' : PHASE_META[p].icon} size={13} /><span>{PHASE_META[p].label}</span>
        </li>
      ))}
    </ol>
  );
}

export function LearnSession({ session, pool }: { session: Session; pool: Distractor[] }) {
  const caps = useMemo(() => ({ canChoose: (card: CardContent, what: 'word' | 'meaning') => buildChoices(card, pool, what).length >= 2 }), [pool]);
  // The engine state is plain data, so a refresh can carry a half-finished round across. Only the
  // card ids are stored; the cards themselves come back from the session.
  const [state, setState] = useState<LearnState>(() => {
    const fresh = createLearn(session.cards, caps);
    const saved = loadProgress<SavedLearn>();
    if (!saved || saved.kind !== 'learn' || !saved.state || saved.state.words.length !== fresh.words.length) return fresh;
    try {
      const byId = new Map(fresh.words.map((w) => [w.card.cardId, w.card]));
      const words = saved.state.words.map(({ cardId, ...w }) => { const card = byId.get(cardId); return card ? { ...w, card } : null; });
      if (words.some((w) => !w)) return fresh;
      return { ...saved.state, words: words as LearnWord[] };
    } catch { return fresh; }
  });
  const [finished, setFinished] = useState<LearnWord[]>(() => state.words.filter((w) => w.done));
  const [error, setError] = useState('');
  const [turn, setTurn] = useState(0);
  const spent = useRef(new Map<string, number>());
  const shownAt = useRef(Date.now());
  useEffect(() => { shownAt.current = Date.now(); }, [turn]);
  useEffect(() => {
    saveProgress({ kind: 'learn', state: { ...state, words: state.words.map(({ card, ...w }) => ({ ...w, cardId: card.cardId })) } } satisfies SavedLearn);
  }, [state]);

  const exit = () => { clearSession(); navigate(session.returnTo || '/'); };
  const word = currentWord(state);
  const step = currentStep(state);

  const report = (result: StepResult) => {
    if (!word) return;
    const total = (spent.current.get(word.card.cardId) || 0) + (Date.now() - shownAt.current);
    spent.current.set(word.card.cardId, total);
    const out = answer(state, result);
    if (out.completed) {
      const rating = ratingFor(out.completed);
      if (rating) recordReview(out.completed.card, rating, total, setError);
      setFinished((f) => [...f, out.completed!]);
    }
    setState(out.state);
    setTurn((t) => t + 1);
  };
  const fromExercise = (r: ExerciseResult) => report(r);

  if (state.phase === 'finished') {
    const clean = finished.filter((w) => w.mistakes === 0).length;
    const shaky = finished.filter((w) => w.mistakes > 0).sort((a, b) => b.mistakes - a.mistakes);
    return (
      <div className="summary">
        <div className="summary-badge"><Icon name="check" size={30} /></div>
        <h1>Nice work!</h1>
        <p className="muted">{finished.length} {finished.length === 1 ? 'word' : 'words'} practiced · {state.asked} questions · {clean} without a mistake</p>
        {shaky.length > 0 && (
          <div className="card summary-list"><div className="block-label">Worth another look</div>
            <ul>{shaky.slice(0, 8).map((w) => <li key={w.card.cardId}><b>{w.card.lemma}</b><span className="muted small">{w.mistakes} {w.mistakes === 1 ? 'miss' : 'misses'} · rated {RATING_LABEL[ratingFor(w) || 1]}</span></li>)}</ul>
            <button className="btn block" onClick={() => launch({ cards: shaky.map((w) => ({ ...w.card, schedule: { ...w.card.schedule, state: w.card.schedule.state || 1, due: Date.now() + 60000 } })), title: `Words to revisit · ${shaky.length} ${shaky.length === 1 ? 'word' : 'words'}`, returnTo: session.returnTo || '/' }, 'learn')}>{shaky.length === 1 ? 'Practice this word again' : `Practice these ${shaky.length} words again`}</button>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <SessionExit returnTo={session.returnTo || '/'} onExit={exit} />
      </div>
    );
  }

  if (state.phase === 'checkpoint') {
    const roundWords = state.rounds[state.round].map((i) => state.words[i]);
    return (
      <div className="review">
        <SessionHeader onClose={exit} progress={progress(state)} counter={`${Math.round(progress(state) * 100)}%`} label={`${MODE_LABEL.learn} · ${session.title}`} />
        <div className="card checkpoint">
          <div className="eyebrow"><Icon name="zap" size={16} />Round {state.round + 1} of {state.rounds.length} complete</div>
          <ul>{roundWords.map((w) => <li key={w.card.cardId}><Icon name="check" size={16} /><b>{w.card.lemma}</b><span className="muted">{w.card.back.meaning}</span></li>)}</ul>
          <button className="btn primary block" autoFocus onClick={() => { setState(nextRound(state)); setTurn((t) => t + 1); }}>Continue</button>
        </div>
      </div>
    );
  }

  if (!word || !step) return null;
  const card = word.card;
  const count = phaseCount(state);
  return (
    <div className="review">
      <SessionHeader onClose={exit} progress={progress(state)} counter={`${PHASE_META[step].label} · ${Math.min(count.done + 1, count.total)}/${count.total}`} label={`${MODE_LABEL.learn} · ${session.title}`} />
      <PhaseBar step={step} />
      {step === 'meet' && <MeetStep key={turn} card={card} onDone={() => report('seen')} />}
      {step === 'choose' && <ChoiceExercise key={turn} card={card} pool={pool} kind={word.chooseKind === 'context' ? 'context' : 'pickMeaning'} onDone={fromExercise} />}
      {step === 'write' && <WriteExercise key={turn} card={card} onDone={fromExercise} />}
      {word.pos === 0 && <PracticeNote card={card} />}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

// The first meeting with a word: guess, flip, then move on. Nothing is graded here.
function MeetStep({ card, onDone }: { card: CardContent; onDone: () => void }) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!seen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' && !e.repeat && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); onDone(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [seen, onDone]);
  return (
    <>
      <Flashcard card={card} direction="word" enterFlips={false} onSeen={() => setSeen(true)} />
      <div className="exercise-foot steady">
        {seen ? <button className="btn primary block" onClick={onDone}>Got it</button>
          : <p className="muted small center flip-help">Guess the meaning, then flip the card</p>}
      </div>
    </>
  );
}
