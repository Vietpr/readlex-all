// A real two-sided card: tap or Space flips it, press and hold peeks at the back until you let go.
import { useEffect, useRef, useState } from 'react';
import type { CardContent, FlashDirection } from '../types';
import { CardBack, CardFront } from '../components/CardView';

const HOLD_MS = 320;      // how long a press must last before it becomes a peek
const MOVE_PX = 10;       // more movement than this is a scroll or a text selection, not a tap

// Audio buttons, links and the "More details" toggle live on the card but must never flip it.
const isControl = (t: EventTarget | null) => t instanceof Element && !!t.closest('button, a, input, summary, [data-no-flip]');

// `enterFlips` is off where Enter already means "continue" (the first step of Learn).
interface Props { card: CardContent; direction: FlashDirection; onSeen?: () => void; keyboard?: boolean; enterFlips?: boolean }

export function Flashcard({ card, direction, onSeen, keyboard = true, enterFlips = true }: Props) {
  const [flipped, setFlipped] = useState(false);
  const [peek, setPeek] = useState(false);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number; held: boolean } | null>(null);
  const swallowClick = useRef(false);
  const touch = useRef(false);
  const seen = useRef(false);
  const showBack = flipped || peek;

  useEffect(() => { if (showBack && !seen.current) { seen.current = true; onSeen?.(); } }, [showBack]);
  useEffect(() => () => { if (press.current) clearTimeout(press.current.timer); }, []);

  useEffect(() => {
    if (!keyboard) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== ' ' && !(enterFlips && e.key === 'Enter')) || e.repeat || e.metaKey || e.ctrlKey || e.altKey || isControl(e.target)) return;
      e.preventDefault();
      setFlipped((f) => !f);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboard, enterFlips]);

  const endPress = (cancelled: boolean) => {
    const p = press.current;
    if (!p) return;
    clearTimeout(p.timer);
    press.current = null;
    if (p.held) { setPeek(false); swallowClick.current = !cancelled; }
  };

  return (
    <div className="flip-scene">
      <div
        className={`flip-card${showBack ? ' is-back' : ''}${peek ? ' is-peek' : ''}`}
        role="group" aria-roledescription="flashcard" tabIndex={0}
        aria-label={`Flashcard, ${showBack ? 'answer' : 'question'} side. Press Space to flip, or hold to peek.`}
        onPointerDown={(e) => {
          touch.current = e.pointerType !== 'mouse';
          swallowClick.current = false;
          if ((e.pointerType === 'mouse' && e.button !== 0) || isControl(e.target)) return;
          const state = { x: e.clientX, y: e.clientY, held: false, timer: setTimeout(() => { state.held = true; setPeek(true); }, HOLD_MS) };
          press.current = state;
        }}
        onPointerMove={(e) => {
          const p = press.current;
          if (!p || p.held || Math.hypot(e.clientX - p.x, e.clientY - p.y) <= MOVE_PX) return;
          clearTimeout(p.timer);           // the finger is scrolling or the mouse is selecting text
          press.current = null;
          swallowClick.current = true;
        }}
        onPointerUp={() => endPress(false)}
        onPointerCancel={() => endPress(true)}
        onPointerLeave={() => endPress(true)}
        onContextMenu={(e) => { if (touch.current) e.preventDefault(); }}
        onClick={(e) => {
          if (isControl(e.target)) return;
          if (swallowClick.current) { swallowClick.current = false; return; }
          setFlipped((f) => !f);
        }}
      >
        <div className="flip-face front-face" inert={showBack} aria-hidden={showBack}><CardFront card={card} direction={direction} /></div>
        <div className="flip-face back-face" inert={!showBack} aria-hidden={!showBack}><CardBack card={card} /></div>
      </div>
      <span className="sr-only" aria-live="polite">{showBack ? `Answer: ${card.lemma}` : 'Question side'}</span>
    </div>
  );
}
