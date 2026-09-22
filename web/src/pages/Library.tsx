// Library is organised around sets: the automatic Daily Sets and the sets you make yourself.
// Words are inside sets; a search box at the top finds any word directly.
import { useEffect, useRef, useState } from 'react';
import { api, formatSetDate, getConfig, relativeTime } from '../api';
import { navigate, useRoute } from '../router';
import { Icon } from '../components/Icon';
import { DeleteWordButton } from '../components/DeleteWord';
import { AiNotice, LanguageSelect, WordInsight, WordRowsEditor, blankRows, filledRows, saveWordRows, useWordRows, type Insight, type Lang } from '../components/WordRows';
import type { CustomSet, DailySet, Vocabulary } from '../types';

export type LibraryTab = 'all' | 'sets' | 'my';

export function WordRow({ v, onDeleted }: { v: Vocabulary; onDeleted?: () => void }) {
  const e = v.enrichment;
  const open = () => navigate(`/library/${v.id}`);
  return (
    <li className={onDeleted ? 'with-action' : undefined} onClick={onDeleted ? undefined : open}>
      <span className="w" onClick={open}>{v.lemma}{v.reading ? <span className="muted"> {v.reading}</span> : null}</span>
      <span className="m" onClick={open}>{v.userMeaning || e?.meaningInContext || e?.meaningVi || v.quickMeaning || ''}</span>
      <span className="meta" onClick={open}>{[e?.cefr || e?.level, v.exposureCount > 1 ? `seen ${v.exposureCount}×` : '', relativeTime(v.createdAt)].filter(Boolean).join(' · ')}</span>
      {onDeleted && <DeleteWordButton id={v.id} lemma={v.lemma} onDeleted={onDeleted} />}
    </li>
  );
}

export function Library({ tab }: { tab: LibraryTab }) {
  const route = useRoute();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(route.query.get('add') === '1');
  const searching = query.trim().length > 0;
  return (
    <div>
      <h1>Library</h1>
      <div className="row library-search">
        <div className="search-box grow">
          <Icon name="search" size={18} className="muted" />
          <input className="input" placeholder="Search your words" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search your words" />
          {searching && <button type="button" className="icon-btn" onClick={() => setQuery('')} aria-label="Clear search"><Icon name="x" size={16} /></button>}
        </div>
        <button className="btn" onClick={() => setAdding((v) => !v)}><Icon name="plus" size={18} />Add word</button>
      </div>
      {adding && <AddWord onDone={(id) => { setAdding(false); if (id) navigate(`/library/${id}`); }} />}
      {searching ? <SearchResults query={query} /> : (
        <>
          <div className="tabs" role="tablist">
            <a href="#/library" className={tab === 'all' ? 'active' : ''}>All Sets</a>
            <a href="#/library/sets" className={tab === 'sets' ? 'active' : ''}>Daily Sets</a>
            <a href="#/library/my" className={tab === 'my' ? 'active' : ''}>My Sets</a>
          </div>
          {tab === 'all' && <><MySets /><h2>Daily Sets</h2><DailySets /></>}
          {tab === 'sets' && <DailySets />}
          {tab === 'my' && <MySets />}
        </>
      )}
    </div>
  );
}

function SearchResults({ query }: { query: string }) {
  const [items, setItems] = useState<Vocabulary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;   // a slower answer for an older query must not replace a newer one
    const t = setTimeout(async () => {
      try {
        const r = await api.vocabulary({ query: query.trim(), sort: 'newest', limit: 200 });
        if (!current) return;
        setItems(r.items); setTotal(r.total); setError('');
      } catch (err) { if (current) setError((err as Error).message); }
    }, 200);
    return () => { current = false; clearTimeout(t); };
  }, [query, reload]);
  if (error) return <p className="error">{error}</p>;
  if (!items) return <p className="muted">Searching…</p>;
  return (
    <>
      <div className="muted small list-count">{total} {total === 1 ? 'word matches' : 'words match'} “{query.trim()}”</div>
      <ul className="word-list card">
        {items.map((v) => <WordRow key={v.id} v={v} onDeleted={() => setReload((n) => n + 1)} />)}
        {!items.length && <li className="muted empty">No word in your library matches that. Use “Add word” to add it.</li>}
      </ul>
    </>
  );
}

function DailySets() {
  const [sets, setSets] = useState<DailySet[] | null>(null);
  const [today, setToday] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { api.sets(getConfig()).then((r) => { setSets(r.sets); setToday(r.today); }).catch((err) => setError((err as Error).message)); }, []);
  if (error) return <p className="error">{error}</p>;
  if (!sets) return <p className="muted">Loading…</p>;
  if (!sets.length) return <div className="card muted">Your daily sets will appear here. ReadLex groups the words you save while reading by day, automatically.</div>;
  return (
    <ul className="set-list">
      {sets.map((s) => (
        <li key={s.date} className="card set-item" onClick={() => navigate(`/library/sets/${s.date}`)}>
          <div className="set-date"><Icon name="calendar" size={18} /></div>
          <div className="grow">
            <div className="set-title">{formatSetDate(s.date)}{s.date === today ? <span className="badge">Today</span> : null}</div>
            <div className="muted small">{s.words} {s.words === 1 ? 'word' : 'words'} · {s.fresh === 0 ? 'all studied' : `${s.studied} studied · ${s.fresh} new`}{s.due ? ` · ${s.due} due` : ''}</div>
            <div className="set-bar"><div style={{ width: `${(s.studied / s.words) * 100}%` }} /></div>
          </div>
          <Icon name="chevronRight" className="muted" />
        </li>
      ))}
    </ul>
  );
}

// One word by hand: it lands in today's Daily Set like a word saved from the extension.
function AddWord({ onDone }: { onDone: (id?: string) => void }) {
  const [f, setF] = useState({ language: 'en' as Lang, word: '', reading: '', meaning: '', sentence: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'error' | 'muted'; text: string } | null>(null);
  const [insight, setInsight] = useState<Insight | null>(null);
  const latest = useRef(f);
  latest.current = f;
  const submit = async () => {
    if (!f.word.trim()) { setError('Type the word first.'); return; }
    setBusy(true);
    try { const r = await api.addWord(f); onDone(r.vocabularyId); } catch (err) { setError((err as Error).message); }
    setBusy(false);
  };
  const fillMeaning = async () => {
    const term = f.word.trim();
    if (!term) { setError('Type the word first.'); return; }
    const askedMeaning = f.meaning;   // what the learner had when they asked
    setAiBusy(true); setError(''); setNotice(null);
    try {
      const answer = await api.define(f.language, [term]);
      const hit = answer.items[0];
      if (!hit || hit.unknown || !hit.meaningVi) setNotice({ tone: 'muted', text: `No meaning came back for “${term}” — check the spelling or write it yourself.` });
      // never overwrite the learner: they may have moved on to another word, or written the meaning
      // themselves, while we were asking — and then the explanation is not about their word either
      else if (latest.current.word.trim() !== term || latest.current.meaning !== askedMeaning) { /* stale answer, drop it */ }
      else {
        setF((prev) => ({ ...prev, meaning: hit.meaningVi, reading: prev.language === 'ja' && !prev.reading.trim() ? hit.reading : prev.reading }));
        setInsight({ definitionEn: hit.definitionEn, usage: hit.usage, notUsed: hit.notUsed, example: hit.example });
      }
      if (answer.mock) setNotice({ tone: 'muted', text: 'This server runs a fake Gemini (GEMINI_MOCK), so this meaning is a placeholder, not your key’s answer.' });
    } catch (err) { setNotice({ tone: 'error', text: (err as Error).message }); }
    setAiBusy(false);
  };
  return (
    <div className="card add-word">
      <div className="row">
        <input className="input" placeholder="Word or phrase" value={f.word} onChange={(e) => setF({ ...f, word: e.target.value })} autoFocus autoCapitalize="off" />
        <select className="input auto" value={f.language} onChange={(e) => setF({ ...f, language: e.target.value as Lang })}><option value="en">English</option><option value="ja">Japanese</option></select>
      </div>
      {f.language === 'ja' && <input className="input" placeholder="Reading (かな), optional" value={f.reading} onChange={(e) => setF({ ...f, reading: e.target.value })} />}
      <input className="input" placeholder="Sentence where you met it (optional, used for the cloze card)" value={f.sentence} onChange={(e) => setF({ ...f, sentence: e.target.value })} />
      <div className="row ai-field">
        <input className="input grow" placeholder="Meaning (optional — AI fills it in if you leave it empty)" value={f.meaning} onChange={(e) => setF({ ...f, meaning: e.target.value })} />
        <button className="btn small ai-btn" onClick={fillMeaning} disabled={aiBusy || !f.word.trim()} title="Ask your Gemini key for the meaning"><Icon name="sparkles" size={15} />{aiBusy ? 'Asking AI…' : 'Fill with AI'}</button>
      </div>
      {insight && <WordInsight insight={insight} onClose={() => setInsight(null)} />}
      <AiNotice notice={notice} />
      {error && <p className="error">{error}</p>}
      <div className="row"><button className="btn primary small" onClick={submit} disabled={busy || aiBusy}>Add to today's set</button><button className="btn small" onClick={() => onDone()}>Cancel</button></div>
    </div>
  );
}

function MySets() {
  const [sets, setSets] = useState<CustomSet[] | null>(null);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState('');
  const load = () => api.customSets().then((r) => setSets(r.sets)).catch((err) => setError((err as Error).message));
  useEffect(() => { load(); }, []);
  return (
    <>
      {!composing && (
        <div className="set-create-bar">
          <div><b>Create your own set</b><div className="muted small">Type term–meaning pairs, or make an empty set and add words later.</div></div>
          <button className="btn primary" onClick={() => setComposing(true)}><Icon name="plus" size={18} />Create set</button>
        </div>
      )}
      {composing && <SetComposer onCancel={() => setComposing(false)} onCreated={(id) => navigate(`/library/my/${id}`)} />}
      {error && <p className="error">{error}</p>}
      {!sets && !error && <p className="muted">Loading…</p>}
      {sets && !sets.length && !composing && <div className="card muted">No sets yet. Create one for a topic, book or exam. Words still live in your Library and keep a single review schedule.</div>}
      <ul className="set-list">
        {(sets || []).map((s) => (
          <li key={s.id} className="card set-item" onClick={() => navigate(`/library/my/${s.id}`)}>
            <div className="set-date"><Icon name="folder" size={18} /></div>
            <div className="grow">
              <div className="set-title">{s.name}</div>
              <div className="muted small">{s.words} {s.words === 1 ? 'word' : 'words'}{s.words ? ` · ${s.studied} studied` : ''}{s.due ? ` · ${s.due} due` : ''}</div>
              {s.words > 0 && <div className="set-bar"><div style={{ width: `${(s.studied / s.words) * 100}%` }} /></div>}
            </div>
            <Icon name="chevronRight" className="muted" />
          </li>
        ))}
      </ul>
    </>
  );
}

function SetComposer({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState<Lang>(getConfig().language === 'ja' ? 'ja' : 'en');
  const { rows, setRows } = useWordRows(blankRows(2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const create = async () => {
    const name = title.trim();
    if (!name) { setError('Give your set a title.'); return; }
    setBusy(true); setError('');
    try {
      const ids = await saveWordRows(language, rows);
      const created = await api.createSet(name, ids);
      onCreated(created.set.id);
    } catch (err) { setError((err as Error).message); setBusy(false); }
  };
  const n = filledRows(rows).length;
  return (
    <section className="card set-composer" aria-label="Create a flashcard set">
      <div className="composer-head">
        <div><div className="eyebrow">New study set</div><h2>Create flashcards</h2><p className="muted small">Start with simple term–meaning pairs. A word you add here is the same word everywhere else in ReadLex, with one review schedule.</p></div>
        <button className="icon-btn" onClick={onCancel} aria-label="Close"><Icon name="x" /></button>
      </div>
      <div className="composer-meta">
        <div className="field grow"><label>Title</label><input className="input" placeholder="e.g. Business English · Week 1" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus maxLength={80} /></div>
        <LanguageSelect value={language} onChange={setLanguage} />
      </div>
      <WordRowsEditor language={language} rows={rows} onChange={setRows} />
      {error && <p className="error">{error}</p>}
      <div className="composer-foot"><span className="muted small">You can add more words any time from inside the set.</span><div className="row"><button className="btn" onClick={onCancel} disabled={busy}>Cancel</button><button className="btn primary" onClick={create} disabled={busy}>{busy ? 'Creating…' : n ? `Create set with ${n} ${n === 1 ? 'word' : 'words'}` : 'Create empty set'}</button></div></div>
    </section>
  );
}
