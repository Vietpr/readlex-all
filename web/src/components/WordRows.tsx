// The term–meaning row editor shared by "Create set" and "Add words": type words the way you would in a
// flashcard app, and let the AI fill the meanings in. Every row still becomes one ordinary library word
// with one review schedule.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { api } from '../api';
import { Icon } from './Icon';

export type Lang = 'en' | 'ja';
export interface WordRow { id: number; term: string; reading: string; meaning: string; insight?: Insight }
// What the AI said about the word, kept beside the row so the learner can read it before saving.
export interface Insight { definitionEn: string; usage: string; notUsed: string; example: string }

let nextId = 1;
export const blankRow = (term = ''): WordRow => ({ id: nextId++, term, reading: '', meaning: '' });
export const blankRows = (n = 2): WordRow[] => Array.from({ length: n }, () => blankRow());
export const filledRows = (rows: WordRow[]) => rows.filter((r) => r.term.trim());

export function useWordRows(initial: WordRow[] = blankRows()) {
  const [rows, setRows] = useState<WordRow[]>(initial);
  return { rows, setRows, reset: (next: WordRow[] = blankRows()) => setRows(next) };
}

// Saves the rows as library words (existing words are reused) and returns their ids in order.
export async function saveWordRows(language: Lang, rows: WordRow[]): Promise<string[]> {
  const ids: string[] = [];
  for (const row of filledRows(rows)) {
    const saved = await api.addWord({ language, word: row.term.trim(), reading: language === 'ja' ? row.reading.trim() : '', meaning: row.meaning.trim() });
    if (!ids.includes(saved.vocabularyId)) ids.push(saved.vocabularyId);
  }
  return ids;
}

export function LanguageSelect({ value, onChange, label = 'Language' }: { value: Lang; onChange: (l: Lang) => void; label?: string }) {
  return (
    <div className="field composer-language"><label>{label}</label>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value as Lang)}><option value="en">English</option><option value="ja">Japanese</option></select>
    </div>
  );
}

// The bulk button only ever sends rows whose meaning is still empty (the per-row button is an explicit
// ask, so it refills that one row). The answer is merged into the rows as they are *now* and a row the
// learner edited while the request was in flight is left exactly as they typed it.
const BATCH = 20;   // the server answers at most 20 words per call

export function useAiFill(language: Lang, rows: WordRow[], onChange: (rows: WordRow[]) => void) {
  const [busy, setBusy] = useState<number[]>([]);
  const [notice, setNotice] = useState<{ tone: 'error' | 'muted'; text: string } | null>(null);
  const latest = useRef(rows);
  latest.current = rows;
  const running = useRef(false);

  const fill = async (targets: WordRow[]) => {
    const wanted = targets.filter((r) => r.term.trim());
    if (!wanted.length || running.current) return;
    running.current = true;
    setBusy(wanted.map((r) => r.id));
    setNotice(null);
    const missed: string[] = [];
    let demo = false;
    try {
      for (let i = 0; i < wanted.length; i += BATCH) {
        const slice = wanted.slice(i, i + BATCH);
        // what each row held when we asked, so we can tell our own answer from the learner's typing
        const sent = new Map(slice.map((r) => [r.id, { term: r.term.trim(), meaning: r.meaning }]));
        const answer = await api.define(language, slice.map((x) => x.term.trim()));
        if (answer.mock) demo = true;
        const found = new Map(answer.items.map((it) => [it.term.trim().toLowerCase(), it]));
        onChange(latest.current.map((row) => {
          const asked = sent.get(row.id);
          // the learner may have retyped the term or written the meaning themselves while we were asking
          if (!asked || row.meaning !== asked.meaning || row.term.trim() !== asked.term) return row;
          const hit = found.get(asked.term.toLowerCase());
          if (!hit || hit.unknown || !hit.meaningVi) { missed.push(asked.term); return row; }
          return { ...row, meaning: hit.meaningVi, reading: language === 'ja' && !row.reading.trim() ? hit.reading : row.reading,
            insight: { definitionEn: hit.definitionEn, usage: hit.usage, notUsed: hit.notUsed, example: hit.example } };
        }));
      }
      const said = [
        demo ? 'This server runs a fake Gemini (GEMINI_MOCK), so these meanings are placeholders, not your key\u2019s answers.' : '',
        missed.length ? `No meaning came back for ${missed.map((m) => `“${m}”`).join(', ')} — check the spelling or write it yourself.` : '',
      ].filter(Boolean).join(' ');
      if (said) setNotice({ tone: 'muted', text: said });
    } catch (err) {
      setNotice({ tone: 'error', text: (err as Error).message });
    }
    running.current = false;
    setBusy([]);
  };
  return { fill, busy, notice, clearNotice: () => setNotice(null) };
}

// The part of the answer that does not fit on a flashcard: how the word is actually used.
export function WordInsight({ insight, onClose }: { insight: Insight; onClose?: () => void }) {
  const { definitionEn, usage, notUsed, example } = insight;
  if (!definitionEn && !usage && !notUsed && !example) return null;
  return (
    <div className="word-insight">
      {definitionEn && <p className="insight-def">{definitionEn}</p>}
      {usage && <p><b>When to use it · </b>{usage}</p>}
      {notUsed && <p><b>When not to · </b>{notUsed}</p>}
      {example && <p className="insight-example">“{example}”</p>}
      {onClose && <button type="button" className="icon-btn insight-close" onClick={onClose} aria-label="Hide this explanation"><Icon name="x" size={14} /></button>}
    </div>
  );
}

export function AiNotice({ notice }: { notice: { tone: 'error' | 'muted'; text: string } | null }) {
  if (!notice) return null;
  const needsKey = /gemini api key/i.test(notice.text);
  return (
    <p className={`small ai-notice ${notice.tone === 'error' ? 'error' : 'muted'}`}>
      {notice.text}{needsKey && <> <a href="#/settings">Open Settings</a></>}
    </p>
  );
}

export function WordRowsEditor({ language, rows, onChange, autoFocus = false }: { language: Lang; rows: WordRow[]; onChange: (rows: WordRow[]) => void; autoFocus?: boolean }) {
  const ja = language === 'ja';
  const { fill, busy, notice } = useAiFill(language, rows, onChange);
  const patch = (id: number, p: Partial<WordRow>) => onChange(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const add = () => onChange([...rows, blankRow()]);
  const remove = (id: number) => { if (rows.length > 1) onChange(rows.filter((r) => r.id !== id)); };
  // Enter in the last field of a row moves to the next row, adding one when needed (like a spreadsheet)
  const onLastFieldKey = (e: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (index === rows.length - 1) add();
    const editor = e.currentTarget.closest('.word-rows');
    setTimeout(() => editor?.querySelectorAll<HTMLInputElement>('.composer-row .composer-input:first-of-type')[index + 1]?.focus(), 0);
  };
  const empty = rows.filter((r) => r.term.trim() && !r.meaning.trim());
  const working = busy.length > 0;
  return (
    <div className="word-rows">
      <div className={`composer-columns${ja ? ' with-reading' : ''}`} aria-hidden="true"><span>Term</span>{ja && <span>Reading</span>}<span>Meaning</span><span /></div>
      <div className="composer-rows">
        {rows.map((row, index) => (
          <div className={`composer-row${ja ? ' with-reading' : ''}${busy.includes(row.id) ? ' filling' : ''}`} key={row.id}>
            <div className="composer-number">{index + 1}</div>
            <input className="composer-input" placeholder="Term" value={row.term} onChange={(e) => patch(row.id, { term: e.target.value })} autoCapitalize="off" lang={language} aria-label={`Term ${index + 1}`} autoFocus={autoFocus && index === 0} />
            {ja && <input className="composer-input" placeholder="Reading (kana)" value={row.reading} onChange={(e) => patch(row.id, { reading: e.target.value })} lang="ja" aria-label={`Reading ${index + 1}`} />}
            <input className="composer-input" placeholder="Meaning or definition" value={row.meaning} onChange={(e) => patch(row.id, { meaning: e.target.value })} aria-label={`Meaning ${index + 1}`} onKeyDown={(e) => onLastFieldKey(e, index)} />
            <span className="composer-row-actions">
              <button type="button" className="icon-btn composer-magic" onClick={() => fill([row])} disabled={!row.term.trim() || working} aria-label={`Fill meaning ${index + 1} with AI`} title="Fill this meaning with AI"><Icon name="sparkles" size={15} /></button>
              <button type="button" className="icon-btn composer-remove" onClick={() => remove(row.id)} disabled={rows.length <= 1} aria-label={`Remove card ${index + 1}`}><Icon name="trash" size={16} /></button>
            </span>
            {/* full width under the fields, after the buttons so it never pushes them out of the row */}
            {row.insight && <WordInsight insight={row.insight} onClose={() => patch(row.id, { insight: undefined })} />}
          </div>
        ))}
      </div>
      <div className="row composer-tools">
        <button type="button" className="composer-add" onClick={add}><Icon name="plus" size={16} />Add card</button>
        <button type="button" className="composer-ai" onClick={() => fill(empty)} disabled={!empty.length || working}>
          <Icon name="sparkles" size={16} />{working ? 'Asking AI…' : empty.length > 1 ? `Fill ${empty.length} meanings with AI` : 'Fill the meaning with AI'}
        </button>
      </div>
      <AiNotice notice={notice} />
    </div>
  );
}
