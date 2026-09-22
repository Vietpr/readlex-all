// How far along a group of words is. Sets are only views: the numbers come from each word's single FSRS card.
import type { CardContent } from '../types';

export type Stage = 'new' | 'learning' | 'review';
export const stageOf = (c: CardContent): Stage => (c.schedule.state === 0 ? 'new' : c.schedule.state === 2 ? 'review' : 'learning');
const STAGE_LABEL: Record<Stage, string> = { new: 'New', learning: 'Learning', review: 'Review' };

export function StatePill({ card }: { card: CardContent }) {
  const stage = stageOf(card);
  const due = stage !== 'new' && card.schedule.due <= Date.now();
  return <span className={`state-pill st-${stage}`} title={due ? 'Due for review now' : undefined}><i aria-hidden="true" />{STAGE_LABEL[stage]}{due && <em>due</em>}</span>;
}

export function SetProgress({ cards }: { cards: CardContent[] }) {
  if (!cards.length) return null;
  const count = (s: Stage) => cards.filter((c) => stageOf(c) === s).length;
  const fresh = count('new'), learning = count('learning'), review = count('review');
  const studied = learning + review;
  const percent = Math.round((studied / cards.length) * 100);
  return (
    <section className="card set-progress" data-testid="set-progress">
      <div className="set-stats">
        <div><b>{studied}</b><span>studied</span></div>
        <div><b>{fresh}</b><span>new</span></div>
        <div><b>{learning}</b><span>learning</span></div>
        <div><b>{review}</b><span>long-term review</span></div>
      </div>
      <div className="row progress-row">
        <div className="stack-bar grow" role="img" aria-label={`${percent}% studied: ${review} in long-term review, ${learning} learning, ${fresh} new`}>
          <div className="seg-review" style={{ flex: review || 0.0001 }} /><div className="seg-learning" style={{ flex: learning || 0.0001 }} /><div className="seg-new" style={{ flex: fresh || 0.0001 }} />
        </div>
        <b className="percent" title="Words you have studied at least once">{percent}% studied</b>
      </div>
    </section>
  );
}
