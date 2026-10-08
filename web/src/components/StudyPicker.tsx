// Friendly study-mode chooser: one clear default, then optional practice modes and games.
import { useEffect, useRef, useState } from 'react';
import { navigate } from '../router';
import { startSession } from '../session';
import { cardMeaning } from '../study/answers';
import { Icon, type IconName } from './Icon';
import type { CardContent, StudyMode } from '../types';

export interface StudyTarget { cards: CardContent[]; title: string; returnTo: string }

export function launch(target: StudyTarget, mode: StudyMode) {
  if (!target.cards.length) return;
  startSession(target.cards, target.title, mode, target.returnTo);
  navigate(`/review?t=${Date.now()}`);
}

interface ModeDef { mode: StudyMode; label: string; hint: string; icon: IconName; tag?: string }
const LEARN: ModeDef = { mode: 'learn', label: 'Learn', hint: 'Three clear steps for every word: meet it, choose the right answer, then write it from memory.', icon: 'zap', tag: 'Recommended' };
const PRACTICE: ModeDef[] = [
  { mode: 'flash', label: 'Flashcards', hint: 'Flip terms, meanings and real reading context.', icon: 'layers' },
  { mode: 'write', label: 'Write', hint: 'Recall the word and type it from memory.', icon: 'keyboard' },
  { mode: 'listen', label: 'Listen', hint: 'Hear the word, then type what you heard.', icon: 'headphones' },
];
const GAMES: ModeDef[] = [
  { mode: 'match', label: 'Match', hint: 'Pair words and meanings against the clock.', icon: 'grid' },
  { mode: 'sprint', label: 'Recall sprint', hint: 'A 45-second speed round.', icon: 'timer' },
];

// Why a mode cannot be used with these cards ('' when it can).
export function unavailable(mode: StudyMode, cards: CardContent[]): string {
  if (!cards.length) return 'No words here yet';
  if (mode === 'match' && cards.filter((c) => cardMeaning(c)).length < 2) return 'Needs at least 2 words with a meaning';
  if (mode === 'sprint' && cards.filter((c) => cardMeaning(c)).length < 2) return 'Needs at least 2 words with a meaning';
  return '';
}

function ModeButton({ def, cards, onChoose, compact = false }: { def: ModeDef; cards: CardContent[]; onChoose: (m: StudyMode) => void; compact?: boolean }) {
  const why = unavailable(def.mode, cards);
  return (
    <button className={compact ? 'mode-card' : 'mode-hero'} data-mode={def.mode} disabled={!!why} onClick={() => onChoose(def.mode)}>
      <span className="mode-icon"><Icon name={def.icon} size={compact ? 20 : 22} /></span>
      <span className="mode-copy grow">
        <span className="mode-title"><b>{def.label}</b>{def.tag && <span className="badge">{def.tag}</span>}</span>
        <span className="muted small mode-hint">{why || def.hint}</span>
      </span>
      {!compact && <Icon name="chevronRight" size={18} className="muted" />}
    </button>
  );
}

export function StudyPicker({ target, onClose }: { target: StudyTarget; onClose: () => void }) {
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    sheet.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key !== 'Tab' || !sheet.current) return;
      const items = [...sheet.current.querySelectorAll<HTMLElement>('button:not(:disabled)')];
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; previous?.focus?.(); };
  }, []);

  const n = target.cards.length;
  const choose = (mode: StudyMode) => launch(target, mode);
  return (
    <div className="sheet-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet study-sheet" role="dialog" aria-modal="true" aria-labelledby="study-picker-title" ref={sheet}>
        <div className="sheet-grip" aria-hidden="true" />
        <div className="row sheet-head">
          <div className="grow">
            <h2 id="study-picker-title">How do you want to study?</h2>
            <div className="muted small">{/\d+ words?$/.test(target.title) ? target.title : `${target.title} · ${n} ${n === 1 ? 'word' : 'words'}`}</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>

        <ModeButton def={LEARN} cards={target.cards} onChoose={choose} />

        <div className="mode-section-label">Practice one skill</div>
        <div className="mode-grid">
          {PRACTICE.map((m) => <ModeButton key={m.mode} def={m} cards={target.cards} onChoose={choose} compact />)}
        </div>

        <div className="mode-section-label">Games</div>
        <div className="mode-grid games">
          {GAMES.map((m) => <ModeButton key={m.mode} def={m} cards={target.cards} onChoose={choose} compact />)}
        </div>

        <p className="muted small sheet-note"><b>Learn</b> is the best default for memory. The two games are practice only and never change a card's review schedule.</p>
      </div>
    </div>
  );
}

export function useStudyPicker() {
  const [target, setTarget] = useState<StudyTarget | null>(null);
  return { open: (t: StudyTarget) => { if (t.cards.length) setTarget(t); }, picker: target ? <StudyPicker target={target} onClose={() => setTarget(null)} /> : null };
}
