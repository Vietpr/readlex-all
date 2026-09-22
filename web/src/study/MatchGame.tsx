// Match: a timed pairing game. It is practice only and never sends anything to the review schedule,
// because recognising a pair on a board is not the same as recalling a word.
import { useEffect, useMemo, useRef, useState } from 'react';
import { clearSession, type Session } from '../session';
import { navigate } from '../router';
import { Icon } from '../components/Icon';
import type { CardContent } from '../types';
import { cardMeaning, pickMatchCards, shuffle } from './answers';
import { SessionHeader } from './SessionChrome';

const PAIRS = 6;
const PENALTY_MS = 2000;
const BEST_KEY = 'readlex.matchBest';

const readBest = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(BEST_KEY) || '{}'); } catch { return {}; } };
export function formatTime(ms: number): string {
  const total = Math.max(0, ms);
  const m = Math.floor(total / 60000), s = Math.floor(total / 1000) % 60, cs = Math.floor(total / 10) % 100;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

interface Board { cards: CardContent[]; words: CardContent[]; meanings: CardContent[] }
const deal = (cards: CardContent[]): Board => { const picked = pickMatchCards(cards, PAIRS); return { cards: picked, words: shuffle(picked), meanings: shuffle(picked) }; };

export function MatchGame({ session }: { session: Session }) {
  const [board, setBoard] = useState<Board>(() => deal(session.cards));
  const [phase, setPhase] = useState<'ready' | 'playing' | 'done'>('ready');
  const [selected, setSelected] = useState<{ side: 'word' | 'meaning'; id: string } | null>(null);
  const [matched, setMatched] = useState<string[]>([]);
  const [wrong, setWrong] = useState<string[]>([]);
  const [misses, setMisses] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [best, setBest] = useState<{ previous: number | null; isNew: boolean }>({ previous: null, isNew: false });
  const [announce, setAnnounce] = useState('');
  const startedAt = useRef(0);
  const pairs = board.cards.length;
  const exit = () => { clearSession(); navigate(session.returnTo || '/'); };

  useEffect(() => {
    if (phase !== 'playing') return;
    const timer = setInterval(() => setElapsed(performance.now() - startedAt.current), 41);
    return () => clearInterval(timer);
  }, [phase]);

  const start = () => { setMatched([]); setWrong([]); setSelected(null); setMisses(0); setElapsed(0); startedAt.current = performance.now(); setPhase('playing'); };
  const again = () => { setBoard(deal(session.cards)); setPhase('ready'); };

  const finish = (finalMisses: number) => {
    const time = performance.now() - startedAt.current + finalMisses * PENALTY_MS;
    setElapsed(time - finalMisses * PENALTY_MS);
    const all = readBest();
    const previous = typeof all[pairs] === 'number' ? all[pairs] : null;
    const isNew = previous === null || time < previous;
    if (isNew) { try { localStorage.setItem(BEST_KEY, JSON.stringify({ ...all, [pairs]: Math.round(time) })); } catch { /* private mode */ } }
    setBest({ previous, isNew });
    setPhase('done');
  };

  const tap = (side: 'word' | 'meaning', id: string) => {
    if (phase !== 'playing' || matched.includes(id) || wrong.length) return;
    if (!selected || selected.side === side) { setSelected(selected && selected.id === id && selected.side === side ? null : { side, id }); return; }
    if (selected.id === id) {
      const next = [...matched, id];
      setMatched(next);
      setSelected(null);
      setAnnounce(`Matched ${board.cards.find((c) => c.cardId === id)?.lemma}`);
      if (next.length === pairs) finish(misses);
    } else {
      setWrong([selected.id + ':' + selected.side, id + ':' + side]);
      setMisses((m) => m + 1);
      setAnnounce('Not a match');
      setTimeout(() => { setWrong([]); setSelected(null); }, 420);
    }
  };

  const total = elapsed + misses * PENALTY_MS;
  const header = <SessionHeader onClose={exit} label={`Match · ${session.title}`} counter={phase === 'ready' ? undefined : <span className="match-timer"><Icon name="timer" size={15} />{formatTime(total)}</span>} />;
  const tileClass = (side: 'word' | 'meaning', id: string) => `match-tile is-${side}${matched.includes(id) ? ' matched' : ''}${selected?.side === side && selected.id === id ? ' selected' : ''}${wrong.includes(`${id}:${side}`) ? ' wrong' : ''}`;
  const bestBefore = useMemo(() => readBest()[pairs] ?? null, [pairs, phase]);

  if (pairs < 2) {
    return <div className="review">{header}<div className="card match-intro"><h1>Match needs more words</h1><p className="muted">Pick a set with at least two words that already have a meaning.</p><button className="btn primary block" onClick={exit}>Back</button></div></div>;
  }

  if (phase === 'ready') {
    return (
      <div className="review">
        {header}
        <div className="card match-intro">
          <div className="match-icon"><Icon name="grid" size={28} /></div>
          <h1>Ready to play?</h1>
          <p className="muted">Match {pairs} words with their meanings as fast as you can. A wrong pair adds {PENALTY_MS / 1000} seconds.</p>
          {bestBefore !== null && <p className="small"><Icon name="trophy" size={14} /> Your best for {pairs} pairs: <b>{formatTime(bestBefore)}</b></p>}
          <button className="btn primary block" autoFocus onClick={start}>Start game</button>
          <p className="muted small">Just for practice — Match never changes your review schedule.</p>
        </div>
      </div>
    );
  }

  if (phase === 'done') {
    return (
      <div className="summary match-done">
        <div className="summary-badge pop"><Icon name="trophy" size={30} /></div>
        <h1>{best.isNew && best.previous !== null ? 'New best!' : 'Nice!'}</h1>
        <div className="match-time">{formatTime(total)}</div>
        <p className="muted">{pairs} pairs · {misses === 0 ? 'no wrong pairs' : `${misses} wrong ${misses === 1 ? 'pair' : 'pairs'} (+${(misses * PENALTY_MS) / 1000}s)`}</p>
        <p className="small">{best.previous === null ? 'First time on the board — this is your time to beat.' : best.isNew ? <>Previous best: {formatTime(best.previous)}</> : <>Best: <b>{formatTime(best.previous)}</b></>}</p>
        <div className="row summary-actions"><button className="btn primary grow" onClick={again}>Play again</button><button className="btn grow" onClick={exit}>Done</button></div>
        <p className="muted small">Practice only — your review schedule is unchanged.</p>
      </div>
    );
  }

  return (
    <div className="review match">
      {header}
      <div className="match-status"><span>{matched.length} / {pairs} matched</span>{misses > 0 && <span className="muted">{misses} wrong · +{(misses * PENALTY_MS) / 1000}s</span>}</div>
      <div className="match-board">
        <div className="match-col" role="group" aria-label="Words">
          {board.words.map((c, i) => <button key={c.cardId} data-pair={c.cardId} style={{ gridColumn: 1, gridRow: i + 1 }} className={tileClass('word', c.cardId)} lang={c.language} disabled={matched.includes(c.cardId)} aria-pressed={selected?.side === 'word' && selected.id === c.cardId} onClick={() => tap('word', c.cardId)}>{c.lemma}</button>)}
        </div>
        <div className="match-col" role="group" aria-label="Meanings">
          {board.meanings.map((c, i) => <button key={c.cardId} data-pair={c.cardId} style={{ gridColumn: 2, gridRow: i + 1 }} className={tileClass('meaning', c.cardId)} disabled={matched.includes(c.cardId)} aria-pressed={selected?.side === 'meaning' && selected.id === c.cardId} title={cardMeaning(c)} onClick={() => tap('meaning', c.cardId)}><span>{cardMeaning(c)}</span></button>)}
        </div>
      </div>
      <span className="sr-only" aria-live="polite">{announce}</span>
    </div>
  );
}
