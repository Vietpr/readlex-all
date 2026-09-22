// Learn: mixed practice driven by the engine in learn.ts. The UI only renders the current step and
// reports results; one FSRS review per word is sent when the word finishes its climb.
import { useEffect, useMemo, useRef, useState } from 'react';
import { clearSession, loadProgress, saveProgress, type Session } from '../session';
import { navigate } from '../router';
import { speechAvailable } from '../speech';
import { Icon, type IconName } from '../components/Icon';
import { RATING_LABEL, type CardContent } from '../types';
import { buildChoices, type Distractor } from './answers';
import { answer, createLearn, currentStep, currentWord, nextRound, progress, ratingFor, type LearnState, type LearnWord, type Step, type StepResult } from './learn';
import { Flashcard } from './Flashcard';
import { ChoiceExercise, ListenExercise, WriteExercise, type ExerciseResult } from './exercises';
import { PracticeNote, SessionHeader, recordReview } from './SessionChrome';
import { launch } from '../components/StudyPicker';

// The rungs a word climbs, shown to the learner so the first meeting has a visible destination.
interface SavedLearn { kind: string; words: Array<Omit<LearnWord, 'card'> & { cardId: string }>; rounds: number[][]; round: number; queue: number[]; phase: LearnState['phase']; asked: number }

const STEP_META: Record<Step, { label: string; icon: IconName; coming: string }> = {
  study: { label: 'Meet', icon: 'book', coming: '' },
  choice: { label: 'Choose', icon: 'listChecks', coming: 'pick the meaning' },
  context: { label: 'Context', icon: 'quote', coming: 'fill in the sentence' },
  write: { label: 'Write', icon: 'keyboard', coming: 'write it from memory' },
  listen: { label: 'Listen', icon: 'headphones', coming: 'listen and type' },
};

function StepLadder({ ladder, pos }: { ladder: Step[]; pos: number }) {
  if (ladder.length < 2) return null;
  return (
    <ol className="step-ladder" aria-label="Steps for this word">
      {ladder.map((s, i) => (
        <li key={s} className={i < pos ? 'done' : i === pos ? 'now' : ''} aria-current={i === pos ? 'step' : undefined}>
          <Icon name={i < pos ? 'check' : STEP_META[s].icon} size={13} /><span>{STEP_META[s].label}</span>
        </li>
      ))}
    </ol>
  );
}

export function LearnSession({ session, pool }: { session: Session; pool: Distractor[] }) {
  const caps = useMemo(() => ({
    canChoose: (card: CardContent, what: 'word' | 'meaning') => buildChoices(card, pool, what).length >= 2,
    listen: speechAvailable() || session.cards.some((c) => !!c.audio && !c.audio.includes('translate_tts')),
  }), [pool]);
  // The engine state is plain data, so a refresh can carry a half-climbed word across. Only the
  // card ids are stored; the cards themselves come back from the session.
  const [state, setState] = useState<LearnState>(() => {
    const fresh = createLearn(session.cards, caps);
    const saved = loadProgress<SavedLearn>();
    if (!saved || saved.kind !== 'learn' || saved.words.length !== fresh.words.length) return fresh;
    try {
      const byId = new Map(fresh.words.map((w) => [w.card.cardId, w]));
      const words = saved.words.map((w) => { const base = byId.get(w.cardId); return base ? { ...base, ...w, card: base.card } : null; });
      if (words.some((w) => !w)) return fresh;
      return { ...fresh, words: words as LearnWord[], rounds: saved.rounds, round: saved.round, queue: saved.queue, phase: saved.phase, asked: saved.asked };
    } catch { return fresh; }
  });
  const [finished, setFinished] = useState<LearnWord[]>(() => state.words.filter((w) => w.done));
  const [error, setError] = useState('');
  const [turn, setTurn] = useState(0);
  const spent = useRef(new Map<string, number>());
  const shownAt = useRef(Date.now());
  useEffect(() => { shownAt.current = Date.now(); }, [turn]);
  useEffect(() => {
    saveProgress({ kind: 'learn', words: state.words.map(({ card, ...w }) => ({ ...w, cardId: card.cardId })), rounds: state.rounds, round: state.round, queue: state.queue, phase: state.phase, asked: state.asked });
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
            <button className="btn block" onClick={() => launch({ cards: shaky.map((w) => ({ ...w.card, schedule: { ...w.card.schedule, state: w.card.schedule.state || 1, due: Date.now() + 60000 } })), title: `${shaky.length} to practise`, returnTo: session.returnTo || '/' }, 'learn')}>Practise these {shaky.length} {shaky.length === 1 ? 'word' : 'words'}</button>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <button className="btn primary block" onClick={exit}>{session.returnTo === '/' ? 'Back to Today' : 'Done'}</button>
      </div>
    );
  }

  if (state.phase === 'checkpoint') {
    const roundWords = state.rounds[state.round].map((i) => state.words[i]);
    return (
      <div className="review">
        <SessionHeader onClose={exit} progress={progress(state)} counter={`${Math.round(progress(state) * 100)}%`} label={`Learn · ${session.title}`} />
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
  return (
    <div className="review">
      <SessionHeader onClose={exit} progress={progress(state)} counter={`${state.words.filter((w) => w.done).length}/${state.words.length}`} label={`Learn · ${session.title}`} />
      <StepLadder ladder={word.ladder} pos={word.pos} />
      {step === 'study' && <StudyStep key={turn} card={card} next={word.ladder[word.pos + 1] || null} straightBack={state.queue.length === 1} onDone={() => report('seen')} />}
      {step === 'choice' && <ChoiceExercise key={turn} card={card} pool={pool} kind="pickMeaning" onDone={fromExercise} />}
      {step === 'context' && <ChoiceExercise key={turn} card={card} pool={pool} kind="context" onDone={fromExercise} />}
      {step === 'write' && <WriteExercise key={turn} card={card} onDone={fromExercise} />}
      {step === 'listen' && <ListenExercise key={turn} card={card} onDone={fromExercise} />}
      {word.pos === word.start && <PracticeNote card={card} />}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

// The first meeting with a word: guess, flip, then move on to be tested. Nothing is graded here.
function StudyStep({ card, next, straightBack, onDone }: { card: CardContent; next: Step | null; straightBack: boolean; onDone: () => void }) {
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
        {/* other words are interleaved, so only promise "next" when this word really is the one coming back */}
        {seen ? <button className="btn primary block" onClick={onDone}>{!next ? 'Got it — done with this word' : straightBack ? `Next: ${STEP_META[next].coming}` : `Got it — later: ${STEP_META[next].coming}`}</button>
          : <p className="muted small center flip-help">Guess the meaning, then flip the card</p>}
      </div>
    </>
  );
}
