// Match: a timed pairing game. It is practice only and never sends anything to the review schedule,
// because recognising a pair on a board is not the same as recalling a word.
// Tiles pair either by tapping one then the other, or by dragging a tile onto one in the other column.
import { useEffect, useMemo, useRef, useState } from 'react';
import { clearSession, type Session } from '../session';
import { navigate } from '../router';
import { Icon } from '../components/Icon';
import { MODE_LABEL, type CardContent } from '../types';
import { cardMeaning, pickMatchCards, shuffle } from './answers';
import { SessionHeader } from './SessionChrome';
import './match.css';

const PAIRS = 6;
const PENALTY_MS = 2000;
const BEST_KEY = 'readlex.matchBest';
// A pointer has to travel this far before a press becomes a drag; anything shorter is a plain tap.
const DRAG_THRESHOLD_PX = 6;
const RETURN_MS = 220;

const readBest = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(BEST_KEY) || '{}'); } catch { return {}; } };
export function formatTime(ms: number): string {
  const total = Math.max(0, ms);
  const m = Math.floor(total / 60000), s = Math.floor(total / 1000) % 60, cs = Math.floor(total / 10) % 100;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

type Side = 'word' | 'meaning';
interface Pick { side: Side; id: string }
interface Board { cards: CardContent[]; words: CardContent[]; meanings: CardContent[] }
// Everything about the gesture in flight lives in a ref: pointer moves arrive far more often than React needs to render.
interface Drag extends Pick { pointerId: number; el: HTMLButtonElement; startX: number; startY: number; active: boolean; over: Pick | null }
const deal = (cards: CardContent[]): Board => { const picked = pickMatchCards(cards, PAIRS); return { cards: picked, words: shuffle(picked), meanings: shuffle(picked) }; };
const samePick = (a: Pick | null, b: Pick | null) => a?.id === b?.id && a?.side === b?.side;
const tileAt = (x: number, y: number): Pick | null => {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('.match-tile');
  if (!el?.dataset.pair || (el.dataset.side !== 'word' && el.dataset.side !== 'meaning')) return null;
  return { side: el.dataset.side, id: el.dataset.pair };
};

export function MatchGame({ session }: { session: Session }) {
  const [board, setBoard] = useState<Board>(() => deal(session.cards));
  const [phase, setPhase] = useState<'ready' | 'playing' | 'done'>('ready');
  const [selected, setSelected] = useState<Pick | null>(null);
  const [matched, setMatched] = useState<string[]>([]);
  const [wrong, setWrong] = useState<string[]>([]);
  const [misses, setMisses] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [best, setBest] = useState<{ previous: number | null; isNew: boolean }>({ previous: null, isNew: false });
  const [announce, setAnnounce] = useState('');
  const [dragging, setDragging] = useState<Pick | null>(null);
  const [dropTarget, setDropTarget] = useState<Pick | null>(null);
  const startedAt = useRef(0);
  const drag = useRef<Drag | null>(null);
  // The click that follows a completed drag must not count as a tap on the dragged tile.
  const swallowClick = useRef(false);
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

  const playable = (id: string) => phase === 'playing' && !matched.includes(id) && !wrong.length;

  // One tile from each column has been put together, by tap or by drop.
  const pair = (a: Pick, b: Pick) => {
    if (a.id === b.id) {
      const next = [...matched, a.id];
      setMatched(next);
      setSelected(null);
      setAnnounce(`Matched ${board.cards.find((c) => c.cardId === a.id)?.lemma}`);
      if (next.length === pairs) finish(misses);
    } else {
      setWrong([a.id + ':' + a.side, b.id + ':' + b.side]);
      setMisses((m) => m + 1);
      setAnnounce('Not a match');
      setTimeout(() => { setWrong([]); setSelected(null); }, 420);
    }
  };

  const tap = (side: Side, id: string) => {
    if (!playable(id)) return;
    if (!selected || selected.side === side) { setSelected(selected && selected.id === id && selected.side === side ? null : { side, id }); return; }
    pair(selected, { side, id });
  };

  // Drag: press, move past the threshold, and the tile follows the pointer until it is released over the other column.
  const pointerDown = (e: React.PointerEvent<HTMLButtonElement>, side: Side, id: string) => {
    if (drag.current || !playable(id) || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag.current = { side, id, pointerId: e.pointerId, el: e.currentTarget, startX: e.clientX, startY: e.clientY, active: false, over: null };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not supported */ }
  };
  const pointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
    if (!d.active) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      d.active = true;
      // Let the pointer "see through" the tile it is carrying, so elementFromPoint finds the tile underneath.
      d.el.style.pointerEvents = 'none';
      d.el.style.transition = 'none';
      setDragging({ side: d.side, id: d.id });
    }
    d.el.style.transform = `translate(${dx}px, ${dy}px) scale(1.04)`;
    const under = tileAt(e.clientX, e.clientY);
    const over = under && under.side !== d.side && !matched.includes(under.id) ? under : null;
    if (!samePick(over, d.over)) { d.over = over; setDropTarget(over); }
  };
  const pointerEnd = (e: React.PointerEvent<HTMLButtonElement>, dropped: boolean) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    try { d.el.releasePointerCapture(d.pointerId); } catch { /* already released */ }
    if (!d.active) return; // a plain tap: the click handler takes it from here, exactly as before
    swallowClick.current = true;
    setTimeout(() => { swallowClick.current = false; }, 0);
    d.el.style.pointerEvents = '';
    setDragging(null);
    setDropTarget(null);
    const target = dropped ? d.over : null;
    if (target) {
      d.el.style.transition = '';
      d.el.style.transform = '';
      pair({ side: d.side, id: d.id }, target);
      return;
    }
    // Dropped on nothing: glide back home. styles.css disables tile transitions under prefers-reduced-motion, so it snaps there.
    d.el.style.transition = `transform ${RETURN_MS}ms ease`;
    d.el.style.transform = '';
    setTimeout(() => { d.el.style.transition = ''; }, RETURN_MS + 40);
  };
  const click = (side: Side, id: string) => {
    if (swallowClick.current) { swallowClick.current = false; return; }
    tap(side, id);
  };

  const total = elapsed + misses * PENALTY_MS;
  const header = <SessionHeader onClose={exit} label={`${MODE_LABEL.match} · ${session.title}`} counter={phase === 'ready' ? undefined : <span className="match-timer"><Icon name="timer" size={15} />{formatTime(total)}</span>} />;
  const tileClass = (side: Side, id: string) => `match-tile is-${side}${matched.includes(id) ? ' matched' : ''}${selected?.side === side && selected.id === id ? ' selected' : ''}${wrong.includes(`${id}:${side}`) ? ' wrong' : ''}${dragging?.side === side && dragging.id === id ? ' dragging' : ''}${dropTarget?.side === side && dropTarget.id === id ? ' drop-target' : ''}`;
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

  const tileProps = (side: Side, c: CardContent) => ({
    'data-pair': c.cardId,
    'data-side': side,
    className: tileClass(side, c.cardId),
    disabled: matched.includes(c.cardId),
    'aria-pressed': selected?.side === side && selected.id === c.cardId,
    onClick: () => click(side, c.cardId),
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => pointerDown(e, side, c.cardId),
    onPointerMove: pointerMove,
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => pointerEnd(e, true),
    onPointerCancel: (e: React.PointerEvent<HTMLButtonElement>) => pointerEnd(e, false),
  });

  return (
    <div className={`review match${dragging ? ' is-dragging' : ''}`}>
      {header}
      <div className="match-status"><span>{matched.length} / {pairs} matched</span>{misses > 0 && <span className="muted">{misses} wrong · +{(misses * PENALTY_MS) / 1000}s</span>}</div>
      <p className="match-hint">Drag a word onto its meaning, or tap one then the other.</p>
      <div className="match-board">
        <div className="match-col" role="group" aria-label="Words">
          {board.words.map((c, i) => <button key={c.cardId} {...tileProps('word', c)} style={{ gridColumn: 1, gridRow: i + 1 }} lang={c.language}>{c.lemma}</button>)}
        </div>
        <div className="match-col" role="group" aria-label="Meanings">
          {board.meanings.map((c, i) => <button key={c.cardId} {...tileProps('meaning', c)} style={{ gridColumn: 2, gridRow: i + 1 }} title={cardMeaning(c)}><span>{cardMeaning(c)}</span></button>)}
        </div>
      </div>
      <span className="sr-only" aria-live="polite">{announce}</span>
    </div>
  );
}
