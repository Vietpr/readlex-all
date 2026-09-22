// Progress answers four questions: how much have I studied, how much do I remember, am I keeping
// it up, and which words need help.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { navigate } from '../router';
import { Icon } from '../components/Icon';
import { useStudyPicker } from '../components/StudyPicker';
import type { DifficultItem, RecallWindow, StatsResponse } from '../types';

const HEATMAP_DAYS = 84;   // 12 weeks
const rate = (w: RecallWindow): number | null => (w.reviews ? Math.round(((w.reviews - w.again) / w.reviews) * 100) : null);
const pct = (n: number | null) => (n === null ? '–' : `${n}%`);
const dayLabel = (key: string) => new Date(`${key}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function Bars({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(1, ...values);
  return <div className="bars">{values.map((n, i) => <div key={labels[i]} className={i === values.length - 1 ? 'today' : ''} style={{ height: `${(n / max) * 100}%` }} title={`${dayLabel(labels[i])}: ${n}`} />)}</div>;
}

// Weeks run left to right, days top to bottom starting on Monday; darker means more reviews.
function Heatmap({ perDay }: { perDay: StatsResponse['perDay'] }) {
  const keys = Object.keys(perDay).sort();
  const max = Math.max(1, ...keys.map((k) => perDay[k].reviews));
  const lead = keys.length ? (new Date(`${keys[0]}T00:00:00`).getDay() + 6) % 7 : 0;
  const cells: Array<string | null> = [...Array<null>(lead).fill(null), ...keys];
  const weeks: Array<Array<string | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const level = (n: number) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)));
  let lastMonth = -1;
  return (
    <div className="heatmap" role="img" aria-label={`Reviews per day over the last ${Math.round(keys.length / 7)} weeks`}>
      <div className="heat-days" aria-hidden="true"><span>Mon</span><span /><span>Wed</span><span /><span>Fri</span><span /><span>Sun</span></div>
      <div className="heat-weeks">
        {weeks.map((week, w) => {
          const first = week.find(Boolean) as string | undefined;
          const month = first ? new Date(`${first}T00:00:00`).getMonth() : lastMonth;
          const showMonth = month !== lastMonth && !!first;
          lastMonth = month;
          return (
            <div key={w} className="heat-week">
              <span className="heat-month" aria-hidden="true">{showMonth && first ? new Date(`${first}T00:00:00`).toLocaleDateString('en-US', { month: 'short' }) : ''}</span>
              {week.map((k, d) => (k ? <i key={k} className={`l${level(perDay[k].reviews)}`} title={`${dayLabel(k)}: ${perDay[k].reviews} ${perDay[k].reviews === 1 ? 'review' : 'reviews'}`} /> : <i key={`pad${d}`} className="pad" />))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Progress() {
  const [s, setS] = useState<StatsResponse | null>(null);
  const [difficult, setDifficult] = useState<DifficultItem[] | null>(null);
  const [error, setError] = useState('');
  const { open, picker } = useStudyPicker();
  useEffect(() => {
    api.stats(HEATMAP_DAYS).then(setS).catch((err) => setError((err as Error).message));
    api.difficult().then((r) => setDifficult(r.items)).catch(() => setDifficult([]));
  }, []);
  if (error) return <div><h1>Progress</h1><p className="error">{error}</p></div>;
  if (!s) return <div><h1>Progress</h1><p className="muted">Loading…</p></div>;

  const t = s.totals;
  const days = Object.keys(s.perDay).sort();
  const last30 = days.slice(-30);
  const learned = (t.cardsLearning || 0) + (t.cardsReview || 0);
  const levels = Object.entries(s.byLevel).filter(([k]) => k !== '?').sort();
  const maxL = Math.max(1, ...levels.map(([, n]) => n));
  const activeDays = days.filter((d) => s.perDay[d].reviews > 0).length;

  return (
    <div className="progress-page">
      <h1>Progress</h1>
      <div className="summary-tiles" data-testid="progress-summary">
        <div><b><Icon name="flame" size={20} className="flame" />{s.streak}</b><span>day streak</span></div>
        <div><b>{learned}</b><span>words learned</span><small>of {t.total} saved</small></div>
        <div><b>{pct(rate(s.recall.d30))}</b><span>recall rate</span><small>last 30 days</small></div>
        <div><b>{s.recall.d7.reviews}</b><span>reviews this week</span><small>{t.learnedWeek || 0} new {t.learnedWeek === 1 ? 'word' : 'words'} started</small></div>
      </div>

      <section className="card" data-testid="learning-progress">
        <div className="card-title"><b>Learning progress</b><span className="muted small">{t.total} {t.total === 1 ? 'word' : 'words'}</span></div>
        <div className="stack-bar" role="img" aria-label={`${t.cardsReview} in long-term review, ${t.cardsLearning} learning, ${t.cardsNew} new`}>
          <div className="seg-review" style={{ flex: t.cardsReview || 0.0001 }} /><div className="seg-learning" style={{ flex: t.cardsLearning || 0.0001 }} /><div className="seg-new" style={{ flex: t.cardsNew || 0.0001 }} />
        </div>
        <div className="stage-rows">
          <div><i className="seg-new" /><span>New</span><b>{t.cardsNew}</b><small>saved, not studied yet</small></div>
          <div><i className="seg-learning" /><span>Learning</span><b>{t.cardsLearning}</b><small>coming back within days</small></div>
          <div><i className="seg-review" /><span>Long-term review</span><b>{t.cardsReview}</b><small>spaced out over weeks and months</small></div>
        </div>
        <p className="muted small footnote">"Words learned" counts every word you have studied at least once (Learning + Long-term review).</p>
      </section>

      <section className="card" data-testid="activity">
        <div className="card-title"><b>Activity</b><span className="muted small">{activeDays} active {activeDays === 1 ? 'day' : 'days'} in 12 weeks</span></div>
        <Heatmap perDay={s.perDay} />
        <div className="heat-legend" aria-hidden="true"><span>Less</span><i className="l0" /><i className="l1" /><i className="l2" /><i className="l3" /><i className="l4" /><span>More</span></div>
      </section>

      <section className="card" data-testid="recall">
        <div className="card-title"><b>Recall rate</b></div>
        <div className="recall-grid">
          <div className="recall-main">{pct(rate(s.recall.d30))}</div>
          <div className="recall-rows">
            <div><span>Last 7 days</span><b>{pct(rate(s.recall.d7))}</b><small>{s.recall.d7.reviews} reviews</small></div>
            <div><span>Last 30 days</span><b>{pct(rate(s.recall.d30))}</b><small>{s.recall.d30.reviews} reviews</small></div>
            <div><span>All time</span><b>{pct(rate(s.recall.all))}</b><small>{s.recall.all.reviews} reviews</small></div>
          </div>
        </div>
        <p className="muted small footnote">The share of reviews you answered Hard, Good or Easy; Again counts as a miss. A rough guide to how reviews are going, not an exact measure of memory.</p>
      </section>

      <section className="card" data-testid="needs-attention">
        <div className="card-title"><b>Needs attention</b><span className="muted small">missed twice or more in 90 days</span></div>
        {difficult === null && <p className="muted small">Loading…</p>}
        {difficult && difficult.length === 0 && <p className="muted">Nothing is slipping right now. Words you miss repeatedly will show up here.</p>}
        {difficult && difficult.length > 0 && (
          <>
            <ul className="attention-list">
              {difficult.slice(0, 8).map((d) => (
                <li key={d.card.cardId} onClick={() => navigate(`/library/${d.card.vocabularyId}`)}>
                  <span className="w">{d.card.lemma}</span><span className="m">{d.card.back.meaning}</span><span className="again-count">Again {d.again}×</span>
                </li>
              ))}
            </ul>
            <button className="btn primary block" onClick={() => open({ cards: difficult.map((d) => d.card), title: 'Difficult words', returnTo: '/progress' })}>Practice difficult words</button>
          </>
        )}
      </section>

      <section className="card"><div className="card-title"><b>Words saved</b><span className="muted small">last 30 days · {t.week} this week</span></div><Bars values={last30.map((d) => s.savedPerDay[d] || 0)} labels={last30} /></section>
      {levels.length > 0 && (
        <section className="card"><div className="card-title"><b>Levels</b><span className="muted small">CEFR / JLPT</span></div>
          {levels.map(([k, n]) => <div key={k} className="level-row"><span className="level-name">{k}</span><div className="bar"><div style={{ width: `${(n / maxL) * 100}%` }} /></div><span className="muted small">{n}</span></div>)}
        </section>
      )}
      {t.pendingEnrichment > 0 && <p className="muted small">{t.pendingEnrichment} words are waiting for an AI explanation.</p>}
      {picker}
    </div>
  );
}
