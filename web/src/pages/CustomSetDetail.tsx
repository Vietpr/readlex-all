import { useEffect, useState } from 'react';
import { api, getConfig } from '../api';
import { navigate } from '../router';
import { Icon } from '../components/Icon';
import { StudyActions } from '../components/StudyActions';
import { SetProgress, StatePill } from '../components/SetProgress';
import { LanguageSelect, WordRowsEditor, blankRow, blankRows, filledRows, saveWordRows, useWordRows, type Lang } from '../components/WordRows';
import type { CardContent, Vocabulary } from '../types';

export function CustomSetDetail({ id }: { id: string }) {
  const [name, setName] = useState('');
  const [cards, setCards] = useState<CardContent[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => api.customSet(id).then((r) => { setName(r.set.name); setCards(r.cards); setError(''); }).catch((err) => setError((err as Error).message));
  useEffect(() => { load(); }, [id]);

  const rename = async () => {
    if (!draft.trim()) return;
    try { await api.updateSet(id, { name: draft.trim() }); setName(draft.trim()); setEditing(false); } catch (err) { setError((err as Error).message); }
  };
  // Deleting a set has always kept its words, which is a surprise when the words were typed into this
  // very set and now linger in Today — so say what will happen and offer both.
  const remove = async (withWords: boolean) => {
    setBusy(true);
    try {
      if (withWords) for (const c of cards || []) await api.deleteWord(c.vocabularyId);
      await api.deleteSet(id);
      navigate('/library/my');
    } catch (err) { setError((err as Error).message); setBusy(false); setConfirming(false); }
  };
  // a set that is all Japanese so far most likely continues in Japanese
  const language: Lang = cards?.length ? (cards.every((c) => c.language === 'ja') ? 'ja' : 'en') : getConfig().language === 'ja' ? 'ja' : 'en';

  return (
    <div>
      <button className="back-link" onClick={() => navigate('/library/my')}><Icon name="arrowLeft" size={16} />My Sets</button>
      {editing ? (
        <div className="row title-edit"><input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') setEditing(false); }} autoFocus maxLength={80} /><button className="btn primary small" onClick={rename}>Save</button><button className="btn small" onClick={() => setEditing(false)}>Cancel</button></div>
      ) : (
        <div className="row title-row"><h1 className="grow">{name || '…'}</h1>
          <button className="icon-btn" onClick={() => { setDraft(name); setEditing(true); }} aria-label="Rename set" title="Rename"><Icon name="pencil" size={18} /></button>
          <button className="icon-btn danger" onClick={() => setConfirming(true)} aria-label="Delete set" title="Delete set"><Icon name="trash" size={18} /></button></div>
      )}
      {error && <p className="error">{error}</p>}
      {confirming && (
        <section className="card delete-confirm" aria-label="Delete this set">
          <b>Delete “{name}”?</b>
          <p className="muted small">{cards?.length ? `Its ${cards.length} ${cards.length === 1 ? 'word stays' : 'words stay'} in your Library — and in Today — unless you delete them too.` : 'This set is empty.'}</p>
          <div className="row">
            <button className="btn" disabled={busy} onClick={() => remove(false)}>{cards?.length ? 'Delete set, keep the words' : 'Delete set'}</button>
            {!!cards?.length && <button className="btn danger" disabled={busy} onClick={() => remove(true)}>Delete set and its {cards.length} {cards.length === 1 ? 'word' : 'words'}</button>}
            <button className="btn" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </section>
      )}
      {cards && (
        <>
          <p className="muted lead">{cards.length} {cards.length === 1 ? 'word' : 'words'}</p>
          <SetProgress cards={cards} />
          <StudyActions cards={cards} title={name} returnTo={`/library/my/${id}`} />
          <div className="row section-head"><h2 className="grow">Words</h2>{!adding && <button className="btn small" onClick={() => setAdding(true)}><Icon name="plus" size={16} />Add words</button>}</div>
          {adding && <AddWordsPanel setId={id} defaultLanguage={language} exclude={new Set(cards.map((c) => c.vocabularyId))} onAdded={load} onClose={() => setAdding(false)} />}
          {(cards.length > 0 || !adding) && <ul className="word-list card">
            {cards.map((c) => (
              <li key={c.cardId} className="with-action">
                <span className="w" onClick={() => navigate(`/library/${c.vocabularyId}`)}>{c.lemma}{c.reading ? <span className="muted"> {c.reading}</span> : null}</span>
                <span className="m" onClick={() => navigate(`/library/${c.vocabularyId}`)}>{c.back.meaning}</span>
                <span className="meta">{c.back.level && <span className="level">{c.back.level}</span>}<StatePill card={c} /></span>
                <button className="icon-btn" aria-label={`Remove ${c.lemma} from this set`} title="Remove from set" onClick={async (e) => { e.stopPropagation(); await api.removeFromSet(id, c.vocabularyId); setCards((list) => (list || []).filter((x) => x.cardId !== c.cardId)); }}><Icon name="x" size={16} /></button>
              </li>
            ))}
            {!cards.length && <li className="muted empty">This set is empty. Use “Add words” to type new words or pick some from your library.</li>}
          </ul>}
        </>
      )}
    </div>
  );
}

// "Add words": type new words (the usual case) or pick words that are already in the library.
function AddWordsPanel({ setId, defaultLanguage, exclude, onAdded, onClose }: { setId: string; defaultLanguage: Lang; exclude: Set<string>; onAdded: () => Promise<unknown>; onClose: () => void }) {
  const [source, setSource] = useState<'new' | 'library'>('new');
  const [language, setLanguage] = useState<Lang>(defaultLanguage);
  const { rows, setRows } = useWordRows(blankRows(2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [added, setAdded] = useState(0);
  const n = filledRows(rows).length;

  const addTyped = async () => {
    if (!n) { setError('Type at least one word.'); return; }
    setBusy(true); setError('');
    try {
      const ids = await saveWordRows(language, rows);
      const r = await api.addToSet(setId, ids);
      await onAdded();
      setAdded((a) => a + r.added);
      setRows(blankRows(2));
    } catch (err) { setError((err as Error).message); }
    setBusy(false);
  };
  // a library search that finds nothing offers to type that word instead
  const typeInstead = (term: string) => { setRows([blankRow(term), blankRow()]); setSource('new'); };

  return (
    <section className="card add-words" aria-label="Add words to this set">
      <div className="row add-words-head">
        <div className="segmented grow" role="radiogroup" aria-label="Where do the words come from?">
          <button type="button" role="radio" aria-checked={source === 'new'} className={source === 'new' ? 'on' : ''} onClick={() => setSource('new')}>Type new words</button>
          <button type="button" role="radio" aria-checked={source === 'library'} className={source === 'library' ? 'on' : ''} onClick={() => setSource('library')}>Pick from library</button>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
      </div>
      {source === 'new' ? (
        <>
          <div className="composer-meta"><LanguageSelect value={language} onChange={setLanguage} /><p className="muted small grow add-words-hint">New words also go into your Library. Leave the meaning empty and the AI fills it in.</p></div>
          <WordRowsEditor language={language} rows={rows} onChange={setRows} autoFocus />
          {error && <p className="error">{error}</p>}
          <div className="composer-foot">
            <span className="muted small">{added ? `${added} ${added === 1 ? 'word' : 'words'} added to this set so far.` : ''}</span>
            <div className="row"><button className="btn" onClick={onClose} disabled={busy}>{added ? 'Done' : 'Cancel'}</button><button className="btn primary" onClick={addTyped} disabled={busy || !n}>{busy ? 'Adding…' : `Add ${n || ''} ${n === 1 ? 'word' : 'words'}`.replace('  ', ' ')}</button></div>
          </div>
        </>
      ) : (
        <WordPicker exclude={exclude} onAdd={async (ids) => { const r = await api.addToSet(setId, ids); await onAdded(); setAdded((a) => a + r.added); onClose(); }} onCancel={onClose} onTypeInstead={typeInstead} />
      )}
    </section>
  );
}

function WordPicker({ exclude, onAdd, onCancel, onTypeInstead }: { exclude: Set<string>; onAdd: (ids: string[]) => Promise<void>; onCancel: () => void; onTypeInstead: (term: string) => void }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Vocabulary[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;   // same race as the Library search: only the newest query may paint
    const t = setTimeout(() => {
      api.vocabulary({ query, limit: 100, sort: 'newest' })
        .then((r) => { if (current) setItems(r.items.filter((v) => !exclude.has(v.id))); })
        .catch(() => { if (current) setItems([]); });
    }, 200);
    return () => { current = false; clearTimeout(t); };
  }, [query]);
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const q = query.trim();
  return (
    <div className="picker">
      <input className="input" placeholder="Search your library" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      <ul className="pick-list">
        {(items || []).map((v) => (
          <li key={v.id}><label><input type="checkbox" checked={picked.has(v.id)} onChange={() => toggle(v.id)} /><b>{v.lemma}</b><span className="muted">{v.userMeaning || v.enrichment?.meaningInContext || v.enrichment?.meaningVi || v.quickMeaning || ''}</span></label></li>
        ))}
        {items && !items.length && (
          <li className="pick-empty">
            {q ? <><span className="muted small">Nothing in your library matches “{q}”.</span><button type="button" className="btn small" onClick={() => onTypeInstead(q)}><Icon name="plus" size={14} />Add “{q}” as a new word</button></>
              : <span className="muted small">Every word in your library is already in this set.</span>}
          </li>
        )}
        {!items && <li className="pick-empty"><span className="muted small">Loading…</span></li>}
      </ul>
      <div className="row"><button className="btn primary small" disabled={!picked.size || busy} onClick={async () => { setBusy(true); try { await onAdd([...picked]); } finally { setBusy(false); } }}>Add {picked.size || ''} {picked.size === 1 ? 'word' : 'words'}</button><button className="btn small" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}
