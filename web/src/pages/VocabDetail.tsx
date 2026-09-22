import { useEffect, useState } from 'react';
import { api, formatDate, hostOf } from '../api';
import { navigate } from '../router';
import { pronounce, pronounceSentence } from '../speech';
import { Icon } from '../components/Icon';
import { SpeakButton } from '../components/CardView';
import { RATING_LABEL, STATE_LABEL, type CardContent, type CustomSet, type Exposure, type Rating, type Vocabulary } from '../types';

function highlight(sentence: string, surface: string) {
  const idx = surface ? sentence.toLowerCase().indexOf(surface.toLowerCase()) : -1;
  if (idx < 0) return <>{sentence}</>;
  return <>{sentence.slice(0, idx)}<mark>{sentence.slice(idx, idx + surface.length)}</mark>{sentence.slice(idx + surface.length)}</>;
}

export function VocabDetail({ id }: { id: string }) {
  const [v, setV] = useState<Vocabulary | null>(null);
  const [exposures, setExposures] = useState<Exposure[]>([]);
  const [card, setCard] = useState<CardContent | null>(null);
  const [reviews, setReviews] = useState<Array<{ rating: number; reviewed_at: number }>>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ lemma: '', reading: '', meaning: '', note: '' });
  const [sets, setSets] = useState<CustomSet[]>([]);
  const loadSets = () => api.customSets(id).then((r) => setSets(r.sets)).catch(() => {});
  useEffect(() => { loadSets(); }, [id]);
  const startEdit = () => { if (!v) return; setDraft({ lemma: v.lemma, reading: v.reading || '', meaning: v.userMeaning || v.enrichment?.meaningInContext || v.enrichment?.meaningVi || v.quickMeaning || '', note: v.note || '' }); setEditing(true); setError(''); };
  const saveEdit = async () => {
    if (!v) return;
    const auto = v.enrichment?.meaningInContext || v.enrichment?.meaningVi || v.quickMeaning || '';
    try {
      await api.patch(v.id, { lemma: draft.lemma, reading: draft.reading, note: draft.note, meaning: draft.meaning.trim() === auto ? (v.userMeaning ?? null) : draft.meaning });
      setEditing(false);
      await load();
    } catch (err) { setError((err as Error).message); }
  };
  const deleteWord = async () => {
    if (!v || !confirm(`Delete “${v.lemma}” with its sentences and review history? This cannot be undone.`)) return;
    try { await api.deleteWord(v.id); navigate('/library'); } catch (err) { setError((err as Error).message); }
  };
  const toggleSet = async (set: CustomSet) => {
    if (set.containsWord) await api.removeFromSet(set.id, id); else await api.addToSet(set.id, [id]);
    loadSets();
  };
  const load = async () => {
    try { const r = await api.detail(id); setV(r.vocabulary); setExposures(r.exposures); setCard(r.card); setReviews(r.reviews); setError(''); } catch (err) { setError((err as Error).message); }
  };
  useEffect(() => { load(); }, [id]);

  const goBack = () => (history.length > 1 ? history.back() : navigate('/library'));
  if (error && !v) return <div><p className="error">{error}</p><button className="btn" onClick={() => navigate('/library')}>Back to Library</button></div>;
  if (!v) return <p className="muted">Loading…</p>;
  const e = v.enrichment;
  const level = e?.cefr || e?.level || '';
  return (
    <div>
      <div className="row">
        <button className="back-link grow" onClick={goBack}><Icon name="arrowLeft" size={16} />Back</button>
        <button className="icon-btn" onClick={startEdit} aria-label="Edit word" title="Edit"><Icon name="pencil" size={18} /></button>
        <button className="icon-btn danger" onClick={deleteWord} aria-label="Delete word" title="Delete word"><Icon name="trash" size={18} /></button>
      </div>
      {editing && (
        <section className="card edit-word">
          <div className="field"><label>Word</label><input className="input" value={draft.lemma} onChange={(e) => setDraft({ ...draft, lemma: e.target.value })} autoCapitalize="off" /></div>
          {v.language === 'ja' && <div className="field"><label>Reading</label><input className="input" value={draft.reading} onChange={(e) => setDraft({ ...draft, reading: e.target.value })} /></div>}
          <div className="field"><label>Meaning shown on your cards</label><input className="input" value={draft.meaning} onChange={(e) => setDraft({ ...draft, meaning: e.target.value })} /><span className="muted small">Leave empty to go back to the AI meaning.</span></div>
          <div className="field"><label>Your note</label><textarea className="input" rows={2} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></div>
          {error && <p className="error">{error}</p>}
          <div className="row"><button className="btn primary small" onClick={saveEdit}>Save changes</button><button className="btn small" onClick={() => setEditing(false)}>Cancel</button></div>
        </section>
      )}
      <div className="answer-row detail-head">
        <span className="detail-word">{v.lemma}</span>
        {v.reading && <span className="reading">【{v.reading}】</span>}
        <SpeakButton label="Play pronunciation" onClick={() => pronounce(v.lemma, v.language, card?.audio)} />
      </div>
      <div className="sub-row">{v.ipa && <span className="ipa">{v.ipa}</span>}{e?.partOfSpeech && <span className="muted">{e.partOfSpeech}</span>}{v.surface.toLowerCase() !== v.lemma.toLowerCase() && <span className="muted">seen as “{v.surface}”</span>}</div>
      <div className="badges">
        {level && <span className="badge">{level}</span>}
        <span className="badge gray">{v.language === 'ja' ? 'Japanese' : 'English'}</span>
        {e?.isProperNoun && <span className="badge gray">Proper noun</span>}
        {v.enrichmentStatus !== 'done' && <span className="badge warn">AI explanation pending</span>}
      </div>

      <section className="card">
        <div className="meaning">{v.userMeaning || e?.meaningInContext || e?.meaningVi || v.quickMeaning || '—'}</div>
        {v.userMeaning && (e?.meaningInContext || e?.meaningVi) && <div className="muted">AI: {e?.meaningInContext || e?.meaningVi}</div>}
        {!v.userMeaning && e?.meaningVi && e.meaningVi !== e.meaningInContext && <div className="muted">Also: {e.meaningVi}</div>}
        {v.note && <div className="note"><b>Your note · </b>{v.note}</div>}
        {e?.definitionEn && <div className="muted">{e.definitionEn}</div>}
        {!e && v.quickDict.slice(0, 3).map((d, i) => <div key={i} className="muted small">{d.pos}: {d.terms.join(', ')}</div>)}
        {e?.notes && <div className="block"><div className="block-label">When to use it</div><div className="note">{e.notes}</div></div>}
        {e?.collocations?.length ? <div className="block"><div className="block-label">Collocations</div><div className="chips">{e.collocations.map((c) => <span key={c}>{c}</span>)}</div></div> : null}
        {e?.example && <div className="block"><div className="block-label">Example</div><div>{e.example}</div>{e.exampleVi && <div className="muted">{e.exampleVi}</div>}</div>}
        {e?.synonyms?.length ? <div className="block"><div className="block-label">Synonyms</div><div>{e.synonyms.join(', ')}</div></div> : null}
        {e?.wordFamily?.length ? <div className="block"><div className="block-label">Word family</div><div>{e.wordFamily.join(', ')}</div></div> : null}
      </section>

      <h2>Where you met this word <span className="muted small">{exposures.length}</span></h2>
      {exposures.map((x) => (
        <div key={x.id} className="exposure">
          <div className="sentence-row"><span>{highlight(x.sentence || '(no sentence saved)', x.surface)}</span>{x.sentence && <SpeakButton label="Play sentence" onClick={() => pronounceSentence(x.sentence, v.language)} />}</div>
          {e?.sentenceVi && x.id === exposures[exposures.length - 1].id && <div className="muted small">{e.sentenceVi}</div>}
          <div className="meta">{x.url ? <a href={x.url} target="_blank" rel="noopener">{x.pageTitle || hostOf(x.url)}</a> : <span>{x.pageTitle || 'Unknown source'}</span>}<span>{formatDate(x.encounteredAt)}</span>
            <button className="link-btn" onClick={async () => { if (!confirm('Remove this sentence?')) return; try { await api.deleteExposure(x.id); await load(); } catch (err) { setError((err as Error).message); } }}>Remove</button></div>
        </div>
      ))}

      <h2>My Sets</h2>
      <section className="card">
        {sets.length ? <div className="chips selectable">{sets.map((st) => <button key={st.id} className={st.containsWord ? 'on' : ''} onClick={() => toggleSet(st)}>{st.containsWord ? <Icon name="check" size={14} /> : <Icon name="plus" size={14} />}{st.name}</button>)}</div>
          : <div className="muted small">You have no sets yet. <a href="#/library/my">Create one</a> to group words your own way.</div>}
      </section>

      <h2>Review schedule</h2>
      <section className="card">
        {card && <div>{STATE_LABEL[card.schedule.state]} · {card.schedule.state === 0 ? 'not studied yet' : card.schedule.due <= Date.now() ? 'due now' : `next review ${formatDate(card.schedule.due)}`} · {card.schedule.reps} {card.schedule.reps === 1 ? 'review' : 'reviews'}{card.schedule.lapses ? ` · forgotten ${card.schedule.lapses}×` : ''}</div>}
        {reviews.length > 0 && <div className="muted small">Recent answers: {reviews.slice(0, 8).map((r) => RATING_LABEL[r.rating as Rating]).join(' · ')}</div>}
        <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
          <select className="input auto" value={v.status} onChange={async (ev) => { const r = await api.patch(v.id, { status: ev.target.value }); setV(r.vocabulary); }}>
            <option value="new">New</option><option value="learning">Learning</option><option value="known">I know this word</option><option value="ignored">Ignore (never review)</option>
          </select>
          <button className="btn small" disabled={busy} onClick={async () => { setBusy(true); try { await api.enrich(v.id); await load(); } catch (err) { setError((err as Error).message); } setBusy(false); }}>{busy ? 'Working…' : e ? 'Regenerate explanation' : 'Explain with AI'}</button>
        </div>
        {error && <p className="error">{error}</p>}
      </section>
    </div>
  );
}
