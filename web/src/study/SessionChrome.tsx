// Pieces every study screen shares: the top bar, the practice-only note, review submission and the
// pool of wrong answers for multiple choice.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, queuedReviewCount, submitReview } from '../api';
import { isPracticeOnly } from '../session';
import { Icon } from '../components/Icon';
import type { CardContent, Rating } from '../types';
import { distinctLemmas, toDistractor, vocabToDistractor, type Distractor } from './answers';

export function SessionHeader({ onClose, progress, counter, label }: { onClose: () => void; progress?: number; counter?: ReactNode; label: string }) {
  return (
    <>
      <div className="review-top">
        <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        {progress !== undefined ? <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><div style={{ width: `${Math.min(100, progress * 100)}%` }} /></div> : <div className="grow" />}
        {counter !== undefined && <span className="counter">{counter}</span>}
      </div>
      <div className="row session-label"><span className="grow">{label}</span><SyncState /></div>
    </>
  );
}

// Ratings are queued on the device first, so say so when any are still waiting rather than leaving
// the learner wondering whether their answers were kept.
function SyncState() {
  const [waiting, setWaiting] = useState(queuedReviewCount());
  useEffect(() => {
    const update = () => setWaiting(queuedReviewCount());
    window.addEventListener('readlex:queue', update);
    return () => window.removeEventListener('readlex:queue', update);
  }, []);
  if (!waiting) return null;
  return <span className="sync-pending" title="Your answers are saved on this device and will be sent as soon as the server is reachable">{waiting} waiting to sync</span>;
}

export const PracticeNote = ({ card }: { card: CardContent }) => (isPracticeOnly(card) ? <p className="muted small center practice-note">Practice only — this word isn't due, so your review schedule won't change.</p> : null);

// FSRS only hears about words that are new or due. Anything else is practice.
export function recordReview(card: CardContent, rating: Rating, durationMs: number, onError: (message: string) => void) {
  if (isPracticeOnly(card)) return;
  submitReview({ cardId: card.cardId, rating, durationMs }).catch((err) => onError((err as Error).message));
}

// Wrong options come from the session first; small sessions borrow words from the rest of the library.
// Returns null while that extra request is in flight so options never reshuffle under the learner.
export function useDistractorPool(cards: CardContent[], enabled: boolean): Distractor[] | null {
  const own = useMemo(() => cards.map(toDistractor), [cards]);
  const needsMore = enabled && [...new Set(cards.map((c) => c.language))].some((lang) => distinctLemmas(own, lang) < 8);
  const [extra, setExtra] = useState<Distractor[] | null>(needsMore ? null : []);
  useEffect(() => {
    if (!needsMore) return;
    let alive = true;
    const timeout = setTimeout(() => { if (alive) setExtra((e) => e ?? []); }, 4000);
    api.vocabulary({ limit: 120, sort: 'newest' }).then((r) => { if (alive) setExtra(r.items.map(vocabToDistractor)); }).catch(() => { if (alive) setExtra([]); });
    return () => { alive = false; clearTimeout(timeout); };
  }, []);
  return useMemo(() => (extra === null ? null : [...own, ...extra]), [own, extra]);
}
