import { useEffect, useState } from 'react';
import { api, todayKey } from '../api';
import { loadTodayPlan, type PlanStep } from '../plan';
import { Icon } from '../components/Icon';
import { launch, useStudyPicker } from '../components/StudyPicker';
import type { CardContent, StatsResponse, TodayResponse } from '../types';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Monday to Sunday of the current week: which days had a review, and where today is.
function WeekStrip({ perDay }: { perDay: StatsResponse['perDay'] }) {
  const today = todayKey();
  const monday = new Date(`${today}T00:00:00`);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const days = WEEKDAYS.map((label, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const key = dayKey(d);
    return { label, key, studied: (perDay[key]?.reviews || 0) > 0, isToday: key === today };
  });
  return (
    <ol className="week-strip" aria-label="Days studied this week">
      {days.map((d) => (
        <li key={d.key} className={`${d.studied ? 'studied' : ''}${d.isToday ? ' today' : ''}`}>
          <span>{d.label}</span>
          <i>{d.studied && <Icon name="check" size={16} />}</i>
          <span className="sr-only">{d.studied ? 'studied' : d.isToday ? 'today, not studied yet' : 'not studied'}</span>
        </li>
      ))}
    </ol>
  );
}

function WordChips({ cards }: { cards: CardContent[] }) {
  return (
    <div className="today-word-preview" aria-label="A few of these words">
      {cards.slice(0, 5).map((c) => <a key={c.cardId} href={`#/library/${c.vocabularyId}`} lang={c.language}>{c.lemma}</a>)}
      {cards.length > 5 && <a className="more-chip" href={`#/library/sets/${todayKey()}`}>+{cards.length - 5} more</a>}
    </div>
  );
}

export function Today() {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [todaySet, setTodaySet] = useState<CardContent[]>([]);
  const [steps, setSteps] = useState<PlanStep[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [error, setError] = useState('');
  const { open, picker } = useStudyPicker();

  const load = async () => {
    setError('');
    try {
      const [plan, s] = await Promise.all([loadTodayPlan(), api.stats().catch(() => null)]);
      setData(plan.data);
      setTodaySet(plan.todaySet);
      setSteps(plan.steps);
      setStats(s);
    } catch (err) { setError((err as Error).message); }
  };
  useEffect(() => { load(); }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  if (error) return <div><h1>{greeting}</h1><p className="error">{error}</p><button className="btn" onClick={load}>Try again</button></div>;
  if (!data) return <div><h1>{greeting}</h1><p className="muted">Loading…</p></div>;

  const todo = steps.filter((s) => !s.done);
  const next = todo[0];
  const totalWords = stats ? stats.totals.total : null;
  // nothing saved, nothing scheduled: the first thing to do is get a word in, not "you're all caught up"
  const firstRun = totalWords === 0 && !steps.length;

  if (firstRun) {
    return (
      <div>
        <div className="today-head"><h1>{greeting}</h1><p className="muted">Let's get your first words in.</p></div>
        <section className="card first-run" data-testid="first-run">
          <div className="plan-eyebrow">Welcome to ReadLex</div>
          <div className="plan-title">Nothing to study yet</div>
          <p className="muted">ReadLex turns the words you meet while reading into flashcards. Start any way you like:</p>
          <div className="first-run-steps">
            <a className="btn primary" href="#/library?add=1"><Icon name="plus" size={18} />Add your first word</a>
            <a className="btn" href="#/library/my"><Icon name="folder" size={18} />Create a set</a>
          </div>
          <p className="muted small">Or install the ReadLex extension and save words as you read; they land here automatically. The AI explanations are optional and use <a href="#/settings">your own Gemini key</a>.</p>
        </section>
        {picker}
      </div>
    );
  }

  const sub = todo.length > 1 ? `${todo.length} small things for today, one after another.` : todo.length === 1 ? 'Just one more thing for today.' : "A little practice today makes tomorrow's reading easier.";
  const streak = stats?.streak ?? null;

  return (
    <div className="today-page">
      <div className="today-main">
        <div className="today-head"><h1>{greeting}</h1><p className="muted">{sub}</p></div>

        <section className="card plan" data-testid="plan">
          {!next && (
            <div className="plan-step is-next" data-testid="all-done">
              <span className="plan-num done"><Icon name="check" size={20} /></span>
              <div className="plan-body">
                <div className="plan-title">{steps.length ? "You're done for today!" : 'Nothing to study today'}</div>
                <p className="muted">{steps.length ? 'ReadLex brings each word back when it is due.' : 'No cards are due. Keep reading and save new words with the ReadLex extension.'} Want more? <a href="#/library">Practice one of your sets</a>.</p>
              </div>
            </div>
          )}
          {steps.map((s, i) => (s === next ? (
            <div key={s.id} className="plan-step is-next" data-testid={`${s.id}-card`}>
              <span className="plan-num">{i + 1}</span>
              <div className="plan-body">
                <div className="plan-eyebrow">Up next</div>
                <div className="plan-title">{s.title}</div>
                <p className="muted">{s.hint}</p>
                {s.id === 'saved' && <WordChips cards={todaySet} />}
                <div className="plan-actions">
                  <button className="btn primary big" onClick={() => launch(s.target, s.mode)}>{s.cta}<Icon name="arrowRight" size={20} /></button>
                  <button type="button" className="text-btn more-modes" onClick={() => open(s.all)}>{s.id === 'review' ? 'Review another way' : 'Study another way'}</button>
                </div>
              </div>
            </div>
          ) : (
            <div key={s.id} className={`plan-step${s.done ? ' is-done' : ''}`} data-testid={`${s.id}-card`}>
              <span className={`plan-num${s.done ? ' done' : ''}`}>{s.done ? <Icon name="check" size={18} /> : i + 1}</span>
              <div className="plan-body">
                <div className="plan-row-title">{s.title}</div>
                {s.id === 'saved' ? <WordChips cards={todaySet} /> : <div className="muted small">{s.hint}</div>}
              </div>
              {s.done
                ? s.id === 'saved' && <button className="btn small" onClick={() => open(s.all)}>Practice again</button>
                : <button className="btn" onClick={() => launch(s.target, s.mode)}>{s.id === 'review' ? 'Review now' : 'Learn now'}</button>}
            </div>
          )))}
        </section>

        {!todaySet.length && <p className="muted small plan-tip">No words saved today yet. Keep reading and save new words with the ReadLex extension; they show up here on their own.</p>}
      </div>

      <aside className="today-side">
        {stats && (
          <section className="card side-card" data-testid="week-card">
            <h2>This week</h2>
            <WeekStrip perDay={stats.perDay} />
            <p className="muted small">
              {streak ? <><Icon name="flame" size={14} className="flame" /> {streak}-day streak. </> : null}
              {data.counts.reviewedToday > 0 ? 'You have studied today.' : streak ? 'Study once today to keep it going.' : 'Study once today to start a streak.'}
            </p>
          </section>
        )}
        <section className="card side-card" data-testid="today-stats">
          <h2>Today</h2>
          <div className="mini-stats">
            <div><b>{data.counts.savedToday}</b><span>{data.counts.savedToday === 1 ? 'word saved' : 'words saved'}</span></div>
            <div><b>{data.counts.reviewedToday}</b><span>{data.counts.reviewedToday === 1 ? 'review' : 'reviews'}</span></div>
          </div>
          {data.counts.pendingEnrichment > 0 && <p className="muted small side-note"><Icon name="sparkles" size={15} />{data.counts.pendingEnrichment} {data.counts.pendingEnrichment === 1 ? 'word is' : 'words are'} waiting for an AI explanation.</p>}
        </section>
        {!data.hasGeminiKey && <section className="card side-card notice"><b>Add your Gemini API key</b><div className="muted small">ReadLex uses it to explain words in context. <a href="#/settings">Open Settings</a></div></section>}
      </aside>
      {picker}
    </div>
  );
}
