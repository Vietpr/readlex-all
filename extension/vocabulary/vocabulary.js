import { send, onVocabularyChanged, getSettings, el, icon, toast, download, formatDate, hostOf, plural, STATUS_LABEL, ENRICH_LABEL, ankiTsv } from '../shared/rpc.js';

const $ = (id) => document.getElementById(id);
let items = [];
let selectedId = location.hash ? location.hash.slice(1) : null;
let settings = {};
let searchTimer = null;

function filters() {
  return { query: $('q').value.trim(), status: $('f-status').value, language: $('f-lang').value, sort: $('f-sort').value };
}

// "today", "yesterday", "Oct 3" (with the year once it is not this year)
function dayLabel(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (ts >= start.getTime()) return 'today';
  if (ts >= start.getTime() - 24 * 60 * 60 * 1000) return 'yesterday';
  const sameYear = d.getFullYear() === start.getFullYear();
  return d.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

// A chip only for words the AI has not explained yet; finished words carry no marker.
function statusChip(status) {
  if (status === 'pending' || status === 'processing') return el('span', { class: 'badge warn', text: 'AI pending' });
  if (status === 'failed') return el('span', { class: 'badge danger', text: 'AI failed' });
  return null;
}

async function renderStats() {
  const s = await send('STATS');
  $('stats').textContent = `${plural(s.total, 'word')} · ${s.today} saved today · ${s.week} in the last 7 days`;

  const fact = (num, label) => el('div', { class: 'fact' }, [el('b', { text: String(num) }), el('span', { text: label })]);
  $('stats-panel').replaceChildren(...[
    fact(s.exposures, s.exposures === 1 ? 'sentence met' : 'sentences met'),
    fact(s.byEnrichment.done || 0, 'explained by AI'),
    fact(s.pending, 'waiting for AI'),
    s.byLanguage?.ja ? fact(s.byLanguage.ja, s.byLanguage.ja === 1 ? 'Japanese word' : 'Japanese words') : null,
  ].filter(Boolean));
  $('pending-count').textContent = s.pending ? `(${s.pending})` : '';
  $('btn-run-ai').classList.toggle('hidden', !s.pending);
}

async function renderSuggest() {
  const rows = await send('FREQUENT_LOOKUPS', { params: { min: 3, limit: 15 } });
  $('suggest').classList.toggle('hidden', !rows.length);
  $('suggest-chips').replaceChildren(...rows.map((r) => el('button', {
    type: 'button',
    class: 'chip',
    title: `Save “${r.lemma}” · looked up ${plural(r.count, 'time')}${r.sites.length ? ' on ' + r.sites.join(', ') : ''}`,
    onclick: async () => {
      await send('SAVE_VOCABULARY', { surface: r.surfaces[r.surfaces.length - 1] || r.lemma, sentence: '', paragraph: '', url: '', pageTitle: '' });
      toast(`Saved “${r.lemma}”`);
    },
  }, [icon('plus', 14, 2.6), el('span', { class: 'word', lang: 'en', text: r.lemma }), el('small', { text: plural(r.count, 'time') })])));
}

async function renderList() {
  const res = await send('LIST_VOCABULARY', { params: filters() });
  items = res.items;
  $('count').textContent = plural(res.total, 'word');
  const list = $('list');
  list.replaceChildren(...items.map((v) => {
    const meaning = v.enrichment?.meaningInContext || v.enrichment?.meaningVi || v.quickMeaning || '';
    const info = [v.language === 'ja' ? 'Japanese' : '', v.exposureCount > 1 ? `met ${v.exposureCount} times` : '', `saved ${formatDate(v.createdAt)}`].filter(Boolean).join(' · ');
    const active = v.id === selectedId;
    return el('li', { class: active ? 'active' : '', dataset: { id: v.id } }, [
      el('a', { class: 'item', href: `#${v.id}`, title: info, 'aria-current': active ? 'true' : null, onclick: (ev) => { ev.preventDefault(); select(v.id); } }, [
        el('span', { class: 'text' }, [
          el('span', { class: 'w', lang: v.language === 'ja' ? 'ja' : 'en' }, [
            el('span', { class: 'lemma', text: v.lemma }),
            v.reading ? el('span', { class: 'reading', text: v.reading }) : null,
          ]),
          el('span', { class: 'm', text: meaning }),
        ]),
        statusChip(v.enrichmentStatus),
        el('span', { class: 'meta', text: dayLabel(v.createdAt) }),
      ]),
    ]);
  }));
  if (!items.length) list.appendChild(el('li', { class: 'none', text: 'No words match.' }));
}

async function select(id) {
  selectedId = id;
  history.replaceState(null, '', `#${id}`);
  document.querySelectorAll('#list li').forEach((li) => {
    const active = li.dataset.id === id;
    li.classList.toggle('active', active);
    const link = li.querySelector('a');
    if (link) { if (active) link.setAttribute('aria-current', 'true'); else link.removeAttribute('aria-current'); }
  });
  await renderDetail();
  // Narrow screens stack the detail card under the list: bring it into view.
  const box = $('detail');
  if (box.offsetTop > $('list').offsetTop + 40) {
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' });
  }
}

function highlight(sentence, surface, lang) {
  const container = el('p', { class: 's', lang });
  if (!sentence) { container.textContent = '(no sentence)'; container.removeAttribute('lang'); return container; }
  const idx = surface ? sentence.toLowerCase().indexOf(surface.toLowerCase()) : -1;
  if (idx < 0) { container.textContent = sentence; return container; }
  container.append(sentence.slice(0, idx), el('mark', { text: sentence.slice(idx, idx + surface.length) }), sentence.slice(idx + surface.length));
  return container;
}

async function renderDetail() {
  const box = $('detail');
  if (!selectedId) { box.replaceChildren(el('div', { class: 'placeholder muted', text: 'Pick a word from the list to see its details.' })); return; }
  let data;
  try { data = await send('GET_VOCABULARY', { id: selectedId }); } catch (err) {
    box.replaceChildren(el('div', { class: 'placeholder muted', text: err.message }));
    return;
  }
  const { vocabulary: v, exposures, lookups } = data;
  const e = v.enrichment;
  const lang = v.language === 'ja' ? 'ja' : 'en';

  const head = el('div', { class: 'd-head' }, [
    el('h2', { class: 'd-word', lang, text: v.lemma }),
    v.reading ? el('span', { class: 'd-ipa', lang: 'ja', text: `【${v.reading}】` }) : null,
    v.ipa ? el('span', { class: 'd-ipa', text: v.ipa }) : null,
    v.audio ? el('button', { type: 'button', class: 'icon-btn audio-btn', 'aria-label': 'Play pronunciation', title: 'Play pronunciation', onclick: () => new Audio(v.audio).play().catch(() => {}) }, [icon('audio', 20)]) : null,
    v.surface.toLowerCase() !== v.lemma ? el('span', { class: 'muted', text: `seen as “${v.surface}”` }) : null,
  ]);
  const tags = el('div', { class: 'd-tags' }, [
    e?.partOfSpeech ? el('span', { class: 'badge', text: e.partOfSpeech }) : null,
    v.language === 'ja' ? el('span', { class: 'badge', text: 'Japanese' }) : null,
    el('span', { class: 'badge info', text: `met ${plural(exposures.length, 'time')}` }),
    e?.isProperNoun ? el('span', { class: 'badge warn', text: 'proper noun' }) : null,
    v.enrichmentStatus !== 'done' ? el('span', { class: `badge ${v.enrichmentStatus === 'failed' ? 'danger' : 'warn'}`, text: ENRICH_LABEL[v.enrichmentStatus] || v.enrichmentStatus }) : null,
    el('span', { class: 'when', text: `saved ${formatDate(v.createdAt)}${lookups ? ` · looked up ${plural(lookups.count, 'time')}` : ''}` }),
  ]);

  const sections = [];
  if (e) {
    sections.push(el('section', { class: 'd-section' }, [
      el('h3', { text: 'Meaning in your sentence' }),
      el('div', { class: 'd-main', text: e.meaningInContext || e.meaningVi }),
      e.meaningVi && e.meaningVi !== e.meaningInContext ? el('div', { class: 'd-sub', text: `General meaning: ${e.meaningVi}` }) : null,
      e.definitionEn ? el('div', { class: 'd-sub', lang: 'en', text: e.definitionEn }) : null,
      e.notes ? el('div', { class: 'd-note', text: e.notes }) : null,
    ]));
  } else {
    sections.push(el('section', { class: 'd-section' }, [
      el('h3', { text: 'Quick meaning' }),
      el('div', { class: 'd-main', text: v.quickMeaning || '—' }),
      ...(v.quickDict || []).slice(0, 4).map((d) => el('div', { class: 'd-sub', text: `${d.pos}: ${d.terms.join(', ')}` })),
      v.enrichmentError ? el('div', { class: 'err', text: `AI error: ${v.enrichmentError}` }) : null,
      !settings.geminiApiKey && !settings.backendUrl ? el('div', { class: 'd-note' }, ['Add a Gemini key in ', el('a', { href: '../options/options.html#ai', text: 'Settings' }), ' so AI can explain the meaning in your sentence, with common collocations and examples.']) : null,
    ]));
  }

  sections.push(el('section', { class: 'd-section boxes' }, [
    el('h3', { text: `Where you met this word (${exposures.length})` }),
    ...exposures.map((x) => el('div', { class: 'exposure' }, [
      highlight(x.sentence, x.surface, lang),
      e?.sentenceVi && x.id === exposures[exposures.length - 1].id ? el('div', { class: 'd-sub', text: e.sentenceVi }) : null,
      el('div', { class: 'meta' }, [
        x.url ? el('a', { href: x.url, target: '_blank', rel: 'noopener', text: x.pageTitle || hostOf(x.url) || x.url, title: x.url }) : el('span', { text: x.pageTitle || 'Unknown source' }),
        el('span', { text: [x.url ? hostOf(x.url) : '', dayLabel(x.encounteredAt)].filter(Boolean).join(' · ') }),
        el('button', { type: 'button', class: 'link-btn remove', text: 'Delete this sentence', onclick: async () => { await send('DELETE_EXPOSURE', { id: x.id }); } }),
      ]),
    ])),
  ]));

  if (e && (e.collocations?.length || e.synonyms?.length || e.wordFamily?.length)) {
    sections.push(el('section', { class: 'd-section boxes' }, [
      el('h3', { text: e.collocations?.length ? 'Common collocations' : 'Related words' }),
      e.collocations?.length ? el('div', { class: 'chips-inline', lang }, e.collocations.map((c) => el('span', { text: c }))) : null,
      e.synonyms?.length ? el('div', { class: 'related' }, ['Similar words: ', el('span', { lang, text: e.synonyms.join(', ') })]) : null,
      e.wordFamily?.length ? el('div', { class: 'related' }, ['Word family: ', el('span', { lang, text: e.wordFamily.join(', ') })]) : null,
    ]));
  }
  if (e?.example) {
    sections.push(el('section', { class: 'd-section' }, [
      el('h3', { text: 'More examples' }),
      el('div', { class: 'd-example', lang, text: e.example }),
      e.exampleVi ? el('div', { class: 'd-sub', text: e.exampleVi }) : null,
    ]));
  }

  const statusGroup = el('fieldset', { class: 'seg' }, [
    el('legend', { class: 'sr-only', text: 'Word status' }),
    ...Object.entries(STATUS_LABEL).map(([k, label]) => el('label', {}, [
      el('input', { type: 'radio', name: 'word-status', value: k, checked: v.status === k, onchange: async (ev) => {
        if (!ev.target.checked) return;
        await send('UPDATE_VOCABULARY', { id: v.id, patch: { status: k } });
        toast('Status updated');
      } }),
      label,
    ])),
  ]);
  const foot = el('div', { class: 'd-foot' }, [
    statusGroup,
    el('button', { type: 'button', class: 'btn small', onclick: async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      try { await send('ENRICH_ONE', { id: v.id }); toast('AI updated this word'); } catch (err) { toast(err.message, 5000); }
      btn.disabled = false;
    } }, [icon('sparkle', 16), e ? 'Run AI again' : 'Run AI for this word']),
    el('span', { class: 'spacer' }),
    el('button', { type: 'button', class: 'btn ghost danger', onclick: async () => {
      if (!confirm(`Delete “${v.lemma}” and its ${plural(exposures.length, 'sentence')}?`)) return;
      await send('DELETE_VOCABULARY', { id: v.id });
      selectedId = null;
      history.replaceState(null, '', ' ');
      toast('Word deleted');
      renderDetail();
    } }, [icon('trash', 18), 'Delete this word']),
  ]);

  box.replaceChildren(el('div', { class: 'd-top' }, [head, tags]), ...sections, foot);
}

async function refreshAll() {
  settings = await getSettings();
  await Promise.all([renderStats(), renderList(), renderSuggest()]);
  if (selectedId) await renderDetail();
}

$('q').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderList, 150); });
for (const id of ['f-lang', 'f-status', 'f-sort']) $(id).addEventListener('change', renderList);

// Language chips drive the (hidden) #f-lang select.
function syncLangChips() {
  for (const chip of document.querySelectorAll('#lang-chips .pill')) chip.setAttribute('aria-pressed', String(chip.dataset.lang === $('f-lang').value));
}
for (const chip of document.querySelectorAll('#lang-chips .pill')) {
  chip.addEventListener('click', () => {
    $('f-lang').value = chip.dataset.lang;
    syncLangChips();
    renderList();
  });
}
$('f-lang').addEventListener('change', syncLangChips);

$('btn-run-ai').addEventListener('click', async () => {
  $('btn-run-ai').disabled = true;
  try {
    const r = await send('PROCESS_QUEUE', { max: 10 });
    if (r.skipped === 'no-key') toast('No Gemini key yet (see Settings)', 4000);
    else if (r.skipped) toast(`AI is not running right now (${r.skipped})`);
    else toast(`AI explained ${plural(r.done, 'word')}, ${r.failed} failed, ${r.remaining} left`, 4000);
  } catch (err) { toast(err.message, 5000); }
  $('btn-run-ai').disabled = false;
});

// "Backup & export" menu: a <details> that closes after an action, on Escape and on outside clicks.
const backupMenu = $('backup-menu');
const closeBackupMenu = () => { backupMenu.open = false; };
document.addEventListener('click', (ev) => { if (backupMenu.open && !backupMenu.contains(ev.target)) closeBackupMenu(); });
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && backupMenu.open) { closeBackupMenu(); backupMenu.querySelector('summary').focus(); }
});

$('btn-export').addEventListener('click', async () => {
  closeBackupMenu();
  const data = await send('EXPORT');
  download(`readlex-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2));
});
$('btn-export-anki').addEventListener('click', async () => {
  closeBackupMenu();
  const data = await send('EXPORT');
  const byId = {};
  for (const x of data.exposures) (byId[x.vocabularyId] ||= []).push(x);
  for (const k of Object.keys(byId)) byId[k].sort((a, b) => a.encounteredAt - b.encounteredAt);
  download(`readlex-anki-${new Date().toISOString().slice(0, 10)}.tsv`, ankiTsv(data.vocabulary, byId), 'text/tab-separated-values');
});
$('btn-import').addEventListener('click', () => { closeBackupMenu(); $('file-import').click(); });
$('file-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const r = await send('IMPORT', { data });
    toast(`Imported ${plural(r.vocabulary, 'word')} and ${plural(r.exposures, 'sentence')} (${plural(r.skipped, 'duplicate')} skipped)`, 5000);
  } catch (err) { toast(`Could not import the file: ${err.message}`, 5000); }
  e.target.value = '';
});

onVocabularyChanged(() => refreshAll());
window.addEventListener('hashchange', () => { selectedId = location.hash.slice(1) || null; renderDetail(); renderList(); });
refreshAll();
