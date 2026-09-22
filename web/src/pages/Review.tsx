import { useEffect, useMemo, useRef, useState } from 'react';
import { getConfig, setConfig } from '../api';
import { navigate } from '../router';
import { takeSession, clearSession, isPracticeOnly, loadProgress, saveProgress, type Session } from '../session';
import { pronounce } from '../speech';
import { Icon } from '../components/Icon';
import { MODE_LABEL, RATING_HINT, RATING_KEY, RATING_LABEL, type CardContent, type FlashDirection, type Rating, type StudyMode } from '../types';
import { buildChoices, type Distractor } from '../study/answers';
import { Flashcard } from '../study/Flashcard';
import { ChoiceExercise, ListenExercise, WriteExercise, type ExerciseResult } from '../study/exercises';
import { LearnSession } from '../study/LearnSession';
import { MatchGame } from '../study/MatchGame';
import { SprintGame } from '../study/SprintGame';
import { PracticeNote, SessionHeader, recordReview, useDistractorPool } from '../study/SessionChrome';

export function Review() {
  const session = useMemo(() => takeSession(), []);
  if (!session) return <div className="summary"><p>No study session in progress.</p><button className="btn primary" onClick={() => navigate('/')}>Back to Today</button></div>;
  return <Study session={session} />;
}

function Study({ session }: { session: Session }) {
  const needsChoices = session.mode === 'learn' || session.mode === 'quiz' || session.mode === 'context' || session.mode === 'sprint';
  const pool = useDistractorPool(session.cards, needsChoices);
  if (session.mode === 'match') return <MatchGame session={session} />;
  if (pool === null) return <div className="review"><p className="muted center">Getting your words ready…</p></div>;
  if (session.mode === 'sprint') return <SprintGame session={session} pool={pool} />;
  if (session.mode === 'learn') return <LearnSession session={session} pool={pool} />;
  return <LinearSession session={session} pool={pool} />;
}

// Flashcards, Multiple choice, Write, Listen and Context challenge: one card after another.
// A missed card comes back later in the same session (at most twice).
interface Item { card: CardContent; attempts: number }
// What a refresh has to bring back: where you were, what you answered, and the cards an "Again"
// pushed to the end. Cards themselves come from the session, so only ids are stored.
interface LinearProgress { kind: 'linear'; mode: StudyMode; index: number; done: Record<Rating, number>; skipped: number; queue: Array<{ cardId: string; attempts: number }> }

function LinearSession({ session, pool }: { session: Session; pool: Distractor[] }) {
  const mode = session.mode;
  const usable = useMemo(() => (mode === 'context' ? session.cards.filter((c) => !!c.front.cloze) : session.cards), []);
  const restored = useMemo(() => loadProgress<LinearProgress>(), []);
  const saved = restored && restored.kind === 'linear' && restored.mode === mode ? restored : null;
  const [queue, setQueue] = useState<Item[]>(() => {
    const byId = new Map(usable.map((c) => [c.cardId, c]));
    const restored = (saved?.queue || []).map((q) => ({ card: byId.get(q.cardId)!, attempts: q.attempts })).filter((q) => q.card);
    return restored.length ? restored : usable.map((card) => ({ card, attempts: 0 }));
  });
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState<Record<Rating, number>>(saved?.done || { 1: 0, 2: 0, 3: 0, 4: 0 });
  const [skipped, setSkipped] = useState(saved?.skipped || 0);
  const [error, setError] = useState('');
  const [direction, setDirection] = useState<FlashDirection>(() => getConfig().flashDirection);
  const [contextInput, setContextInput] = useState(() => getConfig().contextInput);
  // a restored index can never point past the cards that actually came back
  useEffect(() => { if (saved && saved.index > 0) setIndex(Math.min(saved.index, queue.length)); }, []);
  const shownAt = useRef(Date.now());
  const current = queue[index];
  useEffect(() => { shownAt.current = Date.now(); }, [index]);
  // a refresh mid-session picks up here instead of dumping the learner back to Today
  useEffect(() => { saveProgress({ kind: 'linear', mode, index, done, skipped, queue: queue.map((q) => ({ cardId: q.card.cardId, attempts: q.attempts })) }); }, [index, done, skipped, queue]);

  const back = session.returnTo || '/';
  const exit = () => { clearSession(); navigate(back); };

  const rate = (rating: Rating) => {
    if (!current) return;
    setDone((d) => ({ ...d, [rating]: d[rating] + 1 }));
    setError('');
    recordReview(current.card, rating, Date.now() - shownAt.current, setError);
    if (rating === 1 && current.attempts < 2) setQueue((q) => [...q, { card: current.card, attempts: current.attempts + 1 }]);
    setIndex((i) => i + 1);
  };
  const fromExercise = (r: ExerciseResult) => { if (r === 'skip') { setSkipped((n) => n + 1); setIndex((i) => i + 1); } else rate(r === 'correct' ? 3 : 1); };

  if (!usable.length) {
    return <div className="summary"><h1>Nothing to practice here</h1><p className="muted">Context challenge uses the sentences you saved words from, and none of these words has one yet.</p><button className="btn primary block" onClick={exit}>Back</button></div>;
  }

  if (index >= queue.length) {
    const rated = Object.values(done).reduce((a, b) => a + b, 0);
    const counted = usable.some((c) => !isPracticeOnly(c));
    return (
      <div className="summary">
        <div className="summary-badge"><Icon name="check" size={30} /></div>
        <h1>{counted ? 'Review complete' : 'Practice complete'}</h1>
        <p className="muted">{usable.length} {usable.length === 1 ? 'card' : 'cards'} · {rated} answers · {rated - done[1]} remembered{skipped ? ` · ${skipped} skipped` : ''}</p>
        {mode === 'flash'
          ? <div className="summary-grid">{([1, 2, 3, 4] as Rating[]).map((r) => <div key={r} className={`r${r}`}>{RATING_LABEL[r]}<b>{done[r]}</b></div>)}</div>
          : <div className="summary-grid two"><div className="r3">Correct<b>{rated - done[1]}</b></div><div className="r1">Missed<b>{done[1]}</b></div></div>}
        {error && <p className="error">{error}</p>}
        <button className="btn primary block" onClick={exit}>{back === '/' ? 'Back to Today' : 'Done'}</button>
      </div>
    );
  }

  const card = current.card;
  // with no other word of that language to offer as a wrong option, a choice question becomes a typed one
  const canChoose = buildChoices(card, pool, 'word').length >= 2;
  return (
    <div className="review">
      <SessionHeader onClose={exit} progress={index / queue.length} counter={`${index + 1}/${queue.length}`} label={`${MODE_LABEL[mode]} · ${session.title}`} />
      {mode === 'flash' && (
        <>
          <Segmented label="Card direction" value={direction} onChange={(v) => { setDirection(v); setConfig({ flashDirection: v }); }}
            options={[{ value: 'word', label: 'Word → Meaning' }, { value: 'meaning', label: 'Meaning → Word' }, { value: 'context', label: 'Context' }]} />
          <FlashMode key={`${index}:${direction}`} card={card} direction={direction} onRate={rate} />
        </>
      )}
      {mode === 'quiz' && (canChoose ? <ChoiceExercise key={index} card={card} pool={pool} kind="pickWord" onDone={fromExercise} /> : <WriteExercise key={index} card={card} onDone={fromExercise} />)}
      {mode === 'write' && <WriteExercise key={index} card={card} onDone={fromExercise} />}
      {mode === 'listen' && <ListenExercise key={index} card={card} onDone={fromExercise} />}
      {mode === 'context' && (
        <>
          <Segmented label="Answer by" value={contextInput} onChange={(v) => { setContextInput(v); setConfig({ contextInput: v }); }} options={[{ value: 'choose', label: 'Choose' }, { value: 'type', label: 'Type it' }]} />
          <p className="muted small center context-hint">{contextInput === 'type' ? 'Type the exact form the sentence needs.' : 'Pick the word — any form counts.'}</p>
          {contextInput === 'type' || !canChoose ? <WriteExercise key={`${index}:type`} card={card} variant="context" onDone={fromExercise} /> : <ChoiceExercise key={`${index}:choose`} card={card} pool={pool} kind="context" onDone={fromExercise} />}
        </>
      )}
      <PracticeNote card={card} />
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return <div className="segmented" role="radiogroup" aria-label={label}>{options.map((o) => <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''}
    // after a mouse/touch choice give the keyboard back to the card, so Space flips it (keyboard users keep their focus)
    onClick={(e) => { onChange(o.value); if (e.detail > 0) e.currentTarget.blur(); }}>{o.label}</button>)}</div>;
}

function FlashMode({ card, direction, onRate }: { card: CardContent; direction: FlashDirection; onRate: (r: Rating) => void }) {
  const [seen, setSeen] = useState(false);
  const practice = isPracticeOnly(card);
  useEffect(() => {
    if (!seen) return;
    const onKey = (e: KeyboardEvent) => { if (['1', '2', '3', '4'].includes(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) onRate(Number(e.key) as Rating); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <>
      <Flashcard card={card} direction={direction} onSeen={() => { setSeen(true); if (getConfig().autoPlay) pronounce(card.lemma, card.language, card.audio); }} />
      <div className="exercise-foot flash-foot">
        {seen ? (
          <div className="ratings" role="group" aria-label="How well did you remember it?">
            {([1, 2, 3, 4] as Rating[]).map((r) => (
              <button key={r} className={`r${r}`} onClick={() => onRate(r)} title={RATING_HINT[r]}>
                {RATING_LABEL[r]}<small>{practice ? RATING_HINT[r] : card.intervals?.[RATING_KEY[r]] || ''}</small>
              </button>
            ))}
          </div>
        ) : (
          <p className="muted small center flip-help">Flip the card, then rate how well you knew it</p>
        )}
      </div>
      {seen && <p className="muted small center rating-legend">Again = didn't know it · Hard = recalled with effort · Good = recalled it · Easy = knew it instantly</p>}
      <p className="muted small center shortcuts">Space to flip · hold to peek · 1–4 to rate</p>
    </>
  );
}
