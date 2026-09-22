import { useEffect, useState } from 'react';
import { api, formatSetDate, getConfig, todayKey } from '../api';
import { navigate } from '../router';
import { Icon } from '../components/Icon';
import { QuickModes, learnPlan } from '../components/StudyActions';
import { launch, useStudyPicker, type StudyTarget } from '../components/StudyPicker';
import type { CardContent, TodayResponse } from '../types';

export function Today() {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [todaySet, setTodaySet] = useState<CardContent[]>([]);
  const [streak, setStreak] = useState<number | null>(null);
  const [totalWords, setTotalWords] = useState<number | null>(null);
  const [error, setError] = useState('');
  const { open, picker } = useStudyPicker();

  const load = async () => {
    setError('');
    try {
      const [t, set, s] = await Promise.all([api.today(getConfig()), api.set(todayKey()).catch(() => null), api.stats().catch(() => null)]);
      setData(t);
      setTodaySet(set ? set.cards : []);
      if (s) { setStreak(s.streak); setTotalWords(s.totals.total); }
    } catch (err) { setError((err as Error).message); }
  };
  useEffect(() => { load(); }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  if (error) return <div><h1>{greeting}</h1><p className="error">{error}</p><button className="btn" onClick={load}>Try again</button></div>;
  if (!data) return <div><h1>{greeting}</h1><p className="muted">Loading…</p></div>;

  const due = data.due;
  const dayStartMs = new Date(`${todayKey()}T00:00:00`).getTime();
  const backlog = data.new.filter((c) => c.savedAt < dayStartMs);
  const minutes = Math.max(1, Math.round(due.length * 0.4));
  const review: StudyTarget = { cards: due, title: "Today's review", returnTo: '/' };
  const saved: StudyTarget = { cards: todaySet, title: `${formatSetDate(todayKey())} · ${todaySet.length} ${todaySet.length === 1 ? 'word' : 'words'}`, returnTo: '/' };
  const earlier: StudyTarget = { cards: backlog, title: 'Earlier words', returnTo: '/' };
  const plan = learnPlan(todaySet);
  // nothing saved, nothing scheduled: the first thing to do is get a word in, not "you're all caught up"
  const firstRun = totalWords === 0 && !due.length && !todaySet.length && !backlog.length;

  if (firstRun) {
    return (
      <div>
        <div className="today-head"><h1>{greeting}</h1><p className="muted">Let's get your first words in.</p></div>
        <section className="card first-run" data-testid="first-run">
          <div className="eyebrow"><Icon name="sparkles" size={16} />Welcome to ReadLex</div>
          <div className="focus-title">Nothing to study yet</div>
          <p className="muted">ReadLex turns the words you meet while reading into flashcards. Start any way you like:</p>
          <div className="first-run-steps">
            <a className="btn primary" href="#/library?add=1"><Icon name="plus" size={18} />Add your first word</a>
            <a className="btn" href="#/library/my"><Icon name="folder" size={18} />Create a set</a>
          </div>
          <p className="muted small">Or install the ReadLex extension and save words as you read — they land here automatically. The AI explanations are optional and use <a href="#/settings">your own Gemini key</a>.</p>
        </section>
        {picker}
      </div>
    );
  }

  return (
    <div>
      <div className="today-head"><h1>{greeting}</h1><p className="muted">A little practice today makes tomorrow's reading easier.</p></div>

      <section className="card focus-card" data-testid="review-card">
        <div className="eyebrow"><Icon name="repeat" size={16} />Today's review</div>
        {due.length ? (
          <>
            <div className="focus-num">{due.length} <span>{due.length === 1 ? 'card due' : 'cards due'}</span></div>
            <div className="muted">About {minutes} min · these answers update your review schedule</div>
            <button className="btn primary block" onClick={() => launch(review, 'flash')}>Start review</button>
            <div className="quick-modes"><button type="button" className="more-modes" onClick={() => open(review)}>Review another way</button></div>
          </>
        ) : (
          <>
            <div className="focus-title">You're all caught up!</div>
            <div className="muted">Nothing is due right now. ReadLex will bring words back when it's time. Want more? <a href="#/library/sets">Practice one of your sets</a>.</div>
          </>
        )}
      </section>

      <section className="card" data-testid="saved-card">
        <div className="row"><div className="eyebrow grow"><Icon name="calendar" size={16} />Today's words</div><b>{todaySet.length} {todaySet.length === 1 ? 'word' : 'words'} saved</b></div>
        {todaySet.length ? (
          <>
            <div className="muted">Words you've collected on {formatSetDate(todayKey())}</div>
            <div className="today-word-preview" aria-label="A few words saved today">
              {todaySet.slice(0, 5).map((c) => <a key={c.cardId} href={`#/library/${c.vocabularyId}`}>{c.lemma}</a>)}
              {todaySet.length > 5 && <span className="more-chip">+{todaySet.length - 5}</span>}
            </div>
            <div className="row saved-actions">
              <button className={`btn grow${due.length ? '' : ' primary'}`} onClick={() => launch({ ...saved, cards: plan.cards }, 'learn')}>{plan.label}</button>
              <button className="btn" onClick={() => navigate(`/library/sets/${todayKey()}`)}>View set</button>
            </div>
            <QuickModes target={saved} onMore={() => open(saved)} />
          </>
        ) : (
          <div className="muted">Keep reading and save new words with the ReadLex extension.</div>
        )}
      </section>

      {backlog.length > 0 && (
        <section className="card slim" data-testid="backlog-card">
          <div className="row"><div className="grow"><b>{backlog.length} {backlog.length === 1 ? 'word' : 'words'} not studied yet</b><div className="muted small">Saved on earlier days</div></div>
            <button className="btn" onClick={() => open(earlier)}>Study</button></div>
        </section>
      )}

      {!data.hasGeminiKey && <section className="card slim notice"><b>Add your Gemini API key</b><div className="muted small">ReadLex uses it to explain words in context. <a href="#/settings">Open Settings</a></div></section>}

      <h2>Today</h2>
      <div className="mini-stats">
        <div><b>{data.counts.savedToday}</b><span>words saved</span></div>
        <div><b>{data.counts.reviewedToday}</b><span>reviews completed</span></div>
        <div><b>{streak ?? '–'}</b><span><Icon name="flame" size={13} /> day streak</span></div>
      </div>
      {data.counts.pendingEnrichment > 0 && <p className="muted small">{data.counts.pendingEnrichment} {data.counts.pendingEnrichment === 1 ? 'word is' : 'words are'} waiting for an AI explanation.</p>}
      {picker}
    </div>
  );
}
