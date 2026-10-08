// Recall sprint: a 45-second speed round. Practice only — it never sends a review, because answering
// fast under a clock says little about long-term memory.
import { useEffect, useMemo, useRef, useState } from 'react';
import { clearSession, type Session } from '../session';
import { navigate } from '../router';
import { Icon } from '../components/Icon';
import { MODE_LABEL, type CardContent } from '../types';
import { buildChoices, cardMeaning, shuffle, type Distractor } from './answers';
import { SessionHeader } from './SessionChrome';
import { launch } from '../components/StudyPicker';

const ROUND_MS = 45_000;
const BEST_KEY = 'readlex.sprintBest';

interface Question { card: CardContent; prompt: string; kind: 'meaning' | 'context'; options: string[] }

function readBest(): number {
  try { const raw = Number(localStorage.getItem(BEST_KEY) || 0); return Number.isFinite(raw) ? raw : 0; } catch { return 0; }
}

// Wrong options come from the same pool the other modes use (same language, no duplicates, same part
// of speech first), so a Japanese word never hides among English ones.
function buildQuestion(cards: CardContent[], pool: Distractor[], index: number): Question {
  const card = cards[index % cards.length];
  const useContext = !!card.front.cloze && index % 2 === 1;
  return {
    card,
    kind: useContext ? 'context' : 'meaning',
    prompt: useContext ? (card.front.cloze || '') : cardMeaning(card),
    options: buildChoices(card, pool, 'word'),
  };
}

export function SprintGame({ session, pool }: { session: Session; pool: Distractor[] }) {
  const playable = useMemo(() => shuffle(session.cards.filter((c) => !!cardMeaning(c) && buildChoices(c, pool, 'word').length >= 2)), [session.cards, pool]);
  const [phase, setPhase] = useState<'ready' | 'playing' | 'done'>('ready');
  const [qIndex, setQIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [missed, setMissed] = useState<CardContent[]>([]);
  const [remaining, setRemaining] = useState(ROUND_MS);
  const [best, setBest] = useState(() => readBest());
  const startedAt = useRef(0);
  const scoreRef = useRef(0);          // the clock's callback needs the live score without restarting the interval
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exit = () => { clearSession(); navigate(session.returnTo || '/'); };
  const question = useMemo(() => (playable.length ? buildQuestion(playable, pool, qIndex) : null), [playable, pool, qIndex]);

  useEffect(() => {
    if (phase !== 'playing') return;
    const tick = window.setInterval(() => {
      const left = Math.max(0, ROUND_MS - (performance.now() - startedAt.current));
      setRemaining(left);
      if (left > 0) return;
      window.clearInterval(tick);
      const next = Math.max(readBest(), scoreRef.current);
      try { localStorage.setItem(BEST_KEY, String(next)); } catch { /* private mode */ }
      setBest(next);
      setPhase('done');
    }, 80);
    return () => window.clearInterval(tick);
  }, [phase]);

  useEffect(() => () => { if (advanceTimer.current) clearTimeout(advanceTimer.current); }, []);

  useEffect(() => {
    if (phase !== 'playing' || picked || !question) return;
    const onKey = (e: KeyboardEvent) => {
      const i = Number(e.key) - 1;
      if (i >= 0 && i < question.options.length && !e.metaKey && !e.ctrlKey && !e.altKey) choose(question.options[i]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const start = () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    setQIndex(0); setPicked(null); setScore(0); setCorrect(0); setWrong(0); setStreak(0); setBestStreak(0); setMissed([]); setRemaining(ROUND_MS);
    scoreRef.current = 0;
    startedAt.current = performance.now();
    setPhase('playing');
  };

  const choose = (option: string) => {
    if (phase !== 'playing' || picked || !question) return;
    setPicked(option);
    const ok = option === question.card.lemma;
    if (ok) {
      const nextStreak = streak + 1;
      const bonus = Math.min(100, Math.max(0, nextStreak - 1) * 10);
      setCorrect((n) => n + 1);
      setStreak(nextStreak);
      setBestStreak((n) => Math.max(n, nextStreak));
      scoreRef.current += 100 + bonus;
      setScore(scoreRef.current);
    } else {
      setWrong((n) => n + 1);
      setStreak(0);
      setMissed((list) => list.some((c) => c.cardId === question.card.cardId) ? list : [...list, question.card]);
    }
    // a wrong answer needs time to read the right one; a correct one can move straight on
    advanceTimer.current = setTimeout(() => { setPicked(null); setQIndex((n) => n + 1); }, ok ? 420 : 1200);
  };

  const header = <SessionHeader onClose={exit} label={`${MODE_LABEL.sprint} · ${session.title}`} counter={phase === 'playing' ? <span className="sprint-clock"><Icon name="timer" size={15} />{Math.ceil(remaining / 1000)}s</span> : undefined} />;

  if (playable.length < 1) {
    return <div className="review">{header}<div className="card match-intro"><h1>Recall sprint needs more words</h1><p className="muted">Choose a set with at least two words that already have a meaning.</p><button className="btn primary block" onClick={exit}>Back</button></div></div>;
  }

  if (phase === 'ready') {
    return (
      <div className="review">
        {header}
        <div className="card sprint-intro">
          <div className="match-icon"><Icon name="timer" size={28} /></div>
          <h1>45-second recall sprint</h1>
          <p className="muted">Use meanings and sentences to pick the word as quickly as you can. Build a streak for bonus points.</p>
          <div className="sprint-rules"><span><b>+100</b> correct</span><span><b>+bonus</b> streak</span><span><b>0</b> effect on your schedule</span></div>
          {best > 0 && <p className="small"><Icon name="trophy" size={14} /> Best score: <b>{best}</b></p>}
          <button className="btn primary block" autoFocus onClick={start}>Start sprint</button>
          <p className="muted small">A fast practice game, not a scheduled review.</p>
        </div>
      </div>
    );
  }

  if (phase === 'done') {
    const total = correct + wrong;
    const accuracy = total ? Math.round((correct / total) * 100) : 0;
    return (
      <div className="summary sprint-done">
        <div className="summary-badge pop"><Icon name="zap" size={30} /></div>
        <h1>{score > 0 && score >= best ? 'New best!' : 'Sprint complete'}</h1>
        <div className="sprint-score">{score}</div>
        <p className="muted">{correct} correct · {accuracy}% accuracy · best streak {bestStreak}</p>
        {missed.length > 0 && (
          <div className="card summary-list"><div className="block-label">Review these next</div>
            <ul>{missed.slice(0, 6).map((c) => <li key={c.cardId}><b>{c.lemma}</b><span className="muted small">{cardMeaning(c)}</span></li>)}</ul>
            <button className="btn block" onClick={() => launch({ cards: missed, title: `Words to revisit · ${missed.length} ${missed.length === 1 ? 'word' : 'words'}`, returnTo: session.returnTo || '/' }, 'learn')}>{missed.length === 1 ? 'Practice this word again' : `Practice these ${missed.length} words again`}</button>
          </div>
        )}
        <div className="row summary-actions"><button className="btn primary grow" onClick={start}>Play again</button><button className="btn grow" onClick={exit}>Done</button></div>
        <p className="muted small">Practice only — your review schedule is unchanged.</p>
      </div>
    );
  }

  if (!question) return null;
  const answer = question.card.lemma;
  return (
    <div className="review sprint">
      {header}
      <div className="sprint-hud"><span><b>{score}</b> pts</span><span className={streak >= 3 ? 'hot' : ''}><Icon name="flame" size={15} />{streak} streak</span></div>
      <div className="flashcard static sprint-card">
        <div className="card-face">
          <div className="hint">{question.kind === 'context' ? 'Which word completes the sentence?' : 'Which word matches this meaning?'}</div>
          {question.kind === 'context' ? <p className="cloze sprint-prompt">{question.prompt}</p> : <div className="quiz-q sprint-prompt">{question.prompt}</div>}
          <div className="options sprint-options" role="group" aria-label="Answers">
            {question.options.map((o, i) => (
              <button key={o} disabled={!!picked} className={picked ? (o === answer ? 'correct' : o === picked ? 'wrong' : '') : ''} onClick={() => choose(o)}>
                <kbd>{i + 1}</kbd><span>{o}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
