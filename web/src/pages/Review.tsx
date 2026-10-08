import { useEffect, useMemo, useRef, useState } from 'react';
import { getConfig } from '../api';
import { navigate } from '../router';
import { takeSession, clearSession, isPracticeOnly, loadProgress, saveProgress, type Session } from '../session';
import { pronounce } from '../speech';
import { Icon } from '../components/Icon';
import { SessionExit } from '../components/NextStep';
import { MODE_LABEL, RATING_HINT, RATING_KEY, RATING_LABEL, type CardContent, type FlashDirection, type Rating, type StudyMode } from '../types';
import type { Distractor } from '../study/answers';
import { Flashcard } from '../study/Flashcard';
import { ListenExercise, WriteExercise, type ExerciseResult } from '../study/exercises';
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
  const needsChoices = session.mode === 'learn' || session.mode === 'sprint';
  const pool = useDistractorPool(session.cards, needsChoices);
  if (session.mode === 'match') return <MatchGame session={session} />;
  if (pool === null) return <div className="review"><p className="muted center">Getting your words ready…</p></div>;
  if (session.mode === 'sprint') return <SprintGame session={session} pool={pool} />;
  if (session.mode === 'learn') return <LearnSession session={session} pool={pool} />;
  return <LinearSession session={session} pool={pool} />;
}

// Flashcards, Write and Listen: one card after another. A missed card comes back later in the same
// session (at most twice).
interface Item { card: CardContent; attempts: number }
// What a refresh has to bring back: where you were, what you answered, and the cards an "Again"
// pushed to the end. Cards themselves come from the session, so only ids are stored.
interface LinearProgress { kind: 'linear'; mode: StudyMode; index: number; done: Record<Rating, number>; skipped: number; queue: Array<{ cardId: string; attempts: number }> }

function LinearSession({ session, pool }: { session: Session; pool: Distractor[] }) {
  const mode = session.mode;
  const usable = session.cards;
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
  const direction = useMemo<FlashDirection>(() => getConfig().flashDirection, []);   // chosen in Settings ("Flashcard front")
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
  const later = () => {
    if (!current) return;
    setQueue((q) => [...q, { card: current.card, attempts: current.attempts }]);
    setIndex((i) => i + 1);
  };
  const fromExercise = (r: ExerciseResult) => { if (r === 'skip') { setSkipped((n) => n + 1); setIndex((i) => i + 1); } else rate(r === 'correct' ? 3 : 1); };

  if (index >= queue.length) {
    const rated = Object.values(done).reduce((a, b) => a + b, 0);
    const counted = usable.some((c) => !isPracticeOnly(c));
    return (
      <div className="summary">
        <div className="summary-badge"><Icon name="check" size={30} /></div>
        <h1>{!rated ? 'No more cards' : counted ? `${usable.length} ${usable.length === 1 ? 'card' : 'cards'} done!` : 'Practice complete!'}</h1>
        <p className="muted">{rated ? `You remembered ${rated - done[1]} of ${rated} answers${skipped ? `, and skipped ${skipped}` : ''}.` : `You skipped all ${skipped}, so nothing was rated.`}</p>
        {mode === 'flash'
          ? <div className="summary-grid">{([1, 2, 3, 4] as Rating[]).map((r) => <div key={r} className={`r${r}`}><b>{done[r]}</b>{RATING_LABEL[r]}</div>)}</div>
          : <div className="summary-grid two"><div className="r3"><b>{rated - done[1]}</b>Correct</div><div className="r1"><b>{done[1]}</b>Missed</div></div>}
        {error && <p className="error">{error}</p>}
        <SessionExit returnTo={back} onExit={exit} />
      </div>
    );
  }

  const card = current.card;
  return (
    <div className="review">
      <SessionHeader onClose={exit} progress={index / queue.length} counter={`${index + 1}/${queue.length}`} label={`${MODE_LABEL[mode]} · ${session.title}`} />
      {mode === 'flash' && <FlashMode key={index} card={card} direction={direction} onRate={rate} onLater={later} />}
      {mode === 'write' && <WriteExercise key={index} card={card} onDone={fromExercise} />}
      {mode === 'listen' && <ListenExercise key={index} card={card} onDone={fromExercise} />}
      <PracticeNote card={card} />
      {error && <p className="error">{error}</p>}
    </div>
  );
}

// The server words the next interval compactly ("10m", "26d", "2mo"); the button spells it out.
const UNIT: Record<string, [string, string]> = { m: ['min', 'min'], h: ['hour', 'hours'], d: ['day', 'days'], mo: ['month', 'months'], y: ['year', 'years'] };
export function nextInterval(text: string | undefined): string {
  const m = /^(<?\s*\d+(?:\.\d+)?)\s*(mo|m|h|d|y)$/.exec((text || '').trim());
  return m ? `in ${m[1]} ${UNIT[m[2]][m[1] === '1' ? 0 : 1]}` : text || '';
}

function FlashMode({ card, direction, onRate, onLater }: { card: CardContent; direction: FlashDirection; onRate: (r: Rating) => void; onLater: () => void }) {
  const [seen, setSeen] = useState(false);
  const practice = isPracticeOnly(card);
  useEffect(() => {
    if (!seen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (['1', '2', '3', '4'].includes(e.key)) onRate(Number(e.key) as Rating);
      if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); onLater(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <>
      <Flashcard card={card} direction={direction} onSeen={() => { setSeen(true); if (getConfig().autoPlay) pronounce(card.lemma, card.language, card.audio); }} />
      <div className="exercise-foot flash-foot">
        {seen ? (
          <>
          <p className="rating-ask">How well did you remember it?</p>
          <div className="ratings" role="group" aria-label="How well did you remember it?">
            {([1, 2, 3, 4] as Rating[]).map((r) => (
              <button key={r} className={`r${r}`} onClick={() => onRate(r)}>
                <b>{RATING_LABEL[r]}</b><span>{RATING_HINT[r]}</span>
                {/* a card that is due also says when this answer brings it back */}
                <small>{practice ? '' : nextInterval(card.intervals?.[RATING_KEY[r]])}</small>
              </button>
            ))}
          </div>
          <button type="button" className="text-btn later-btn" onClick={onLater}>Next, no rating — see it again later<Icon name="arrowRight" size={16} /></button>
          </>
        ) : (
          <p className="muted small center flip-help">Flip the card, then rate how well you knew it</p>
        )}
      </div>
      <p className="muted small center shortcuts">Space to flip · hold to peek · 1–4 to rate · → next</p>
    </>
  );
}
