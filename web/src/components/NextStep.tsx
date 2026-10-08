// The end of a session: say what is still open today and offer to carry straight on, so the learner
// never has to go back to Today just to find the next button.
import { useEffect, useState } from 'react';
import { nextStepAfterSession, type PlanStep } from '../plan';
import { Icon } from './Icon';
import { launch } from './StudyPicker';

export function SessionExit({ returnTo, onExit }: { returnTo: string; onExit: () => void }) {
  const fromToday = returnTo === '/';
  const [next, setNext] = useState<PlanStep | null | undefined>(fromToday ? undefined : null);
  useEffect(() => {
    if (!fromToday) return;
    let alive = true;
    nextStepAfterSession().then((s) => { if (alive) setNext(s); }).catch(() => { if (alive) setNext(null); });
    return () => { alive = false; };
  }, []);

  if (next === undefined) return <p className="muted small center next-step-wait" role="status">Checking what's left for today…</p>;
  if (!next) return <button className="btn primary block big" onClick={onExit}>{fromToday ? 'Back to Today' : 'Done'}</button>;
  return (
    <div className="card next-step" data-testid="next-step">
      <div className="plan-eyebrow">Up next</div>
      <div className="plan-title">{next.title}</div>
      <button className="btn primary block big" onClick={() => launch(next.target, next.mode)}>{next.cta}<Icon name="arrowRight" size={20} /></button>
      <button type="button" className="text-btn" onClick={onExit}>Later, back to Today</button>
    </div>
  );
}
