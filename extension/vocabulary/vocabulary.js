import { send, onVocabularyChanged, getSettings, el, toast, download, formatDate, relativeTime, hostOf, stars, STATUS_LABEL, ENRICH_LABEL, ankiTsv } from '../shared/rpc.js';

const $ = (id) => document.getElementById(id);
let items = [];
let selectedId = location.hash ? location.hash.slice(1) : null;
let settings = {};
let searchTimer = null;

function filters() {
  return { query: $('q').value.trim(), status: $('f-status').value, enrichment: $('f-enrich').value, language: $('f-lang').value, sort: $('f-sort').value };
}

async function renderStats() {
  const s = await send('STATS');
  const cefr = s.byLanguage?.ja && !s.byLanguage?.en ? ['N5', 'N4', 'N3', 'N2', 'N1'] : ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const max = Math.max(1, ...cefr.map((c) => s.byCefr[c] || 0));
  const stats = $('stats');
  stats.replaceChildren(
    el('div', { class: 'stat' }, [el('div', { class: 'num', text: s.total }), el('div', { class: 'lbl', text: `từ trong kho${s.byLanguage?.ja ? ` · ${s.byLanguage.ja} tiếng Nhật` : ''}` })]),
    el('div', { class: 'stat' }, [el('div', { class: 'num', text: s.today }), el('div', { class: 'lbl', text: 'lưu hôm nay' })]),
    el('div', { class: 'stat' }, [el('div', { class: 'num', text: s.week }), el('div', { class: 'lbl', text: 'lưu 7 ngày qua' })]),
    el('div', { class: 'stat' }, [el('div', { class: 'num', text: s.exposures }), el('div', { class: 'lbl', text: 'ngữ cảnh đã gặp' })]),
    el('div', { class: 'stat' }, [el('div', { class: 'num', text: s.byEnrichment.done || 0 }), el('div', { class: 'lbl', text: `AI xong · ${s.pending} chờ` })]),
    el('div', { class: 'stat' }, [
      el('div', { class: 'lbl', text: 'Phân bố CEFR' }),
      el('div', { class: 'bars' }, cefr.map((c) => el('div', { class: 'bar', style: `height:${Math.round(((s.byCefr[c] || 0) / max) * 100)}%`, title: `${c}: ${s.byCefr[c] || 0}` }, [el('span', { text: c })]))),
    ]),
  );
  $('pending-count').textContent = s.pending ? `(${s.pending})` : '';
  $('btn-run-ai').classList.toggle('hidden', !s.pending);
}

async function renderSuggest() {
  const rows = await send('FREQUENT_LOOKUPS', { params: { min: 3, limit: 15 } });
  $('suggest').classList.toggle('hidden', !rows.length);
  $('suggest-chips').replaceChildren(...rows.map((r) => el('button', {
    class: 'chip',
    title: `Đã tra ${r.count} lần · ${r.sites.join(', ')}`,
    onclick: async () => {
      await send('SAVE_VOCABULARY', { surface: r.surfaces[r.surfaces.length - 1] || r.lemma, sentence: '', paragraph: '', url: '', pageTitle: '' });
      toast(`Đã lưu “${r.lemma}”`);
    },
  }, [r.lemma, el('small', { text: `×${r.count}` })])));
}

async function renderList() {
  const res = await send('LIST_VOCABULARY', { params: filters() });
  items = res.items;
  $('count').textContent = `${res.total} từ`;
  const list = $('list');
  list.replaceChildren(...items.map((v) => {
    const meaning = v.enrichment?.meaningInContext || v.enrichment?.meaningVi || v.quickMeaning || '';
    return el('li', { class: v.id === selectedId ? 'active' : '', dataset: { id: v.id }, onclick: () => select(v.id) }, [
      el('span', { class: 'w' }, [el('span', { class: `dot ${v.enrichmentStatus}` }), v.lemma, v.reading ? el('span', { class: 'muted', style: 'font-weight:400;margin-left:4px', text: `【${v.reading}】` }) : null]),
      el('span', { class: 'meta', text: `${v.language === 'ja' ? 'JA · ' : ''}${(v.enrichment?.cefr || v.enrichment?.level) ? (v.enrichment.cefr || v.enrichment.level) + ' · ' : ''}${v.exposureCount > 1 ? v.exposureCount + ' lần · ' : ''}${relativeTime(v.createdAt)}` }),
      el('span', { class: 'm', text: meaning }),
    ]);
  }));
  if (!items.length) list.appendChild(el('li', { class: 'muted', text: 'Không có từ nào khớp.' }));
}

async function select(id) {
  selectedId = id;
  history.replaceState(null, '', `#${id}`);
  document.querySelectorAll('#list li').forEach((li) => li.classList.toggle('active', li.dataset.id === id));
  await renderDetail();
}

function highlight(sentence, surface) {
  const container = el('div', { class: 's' });
  if (!sentence) { container.textContent = '(không có câu)'; return container; }
  const idx = surface ? sentence.toLowerCase().indexOf(surface.toLowerCase()) : -1;
  if (idx < 0) { container.textContent = sentence; return container; }
  container.append(sentence.slice(0, idx), el('mark', { text: sentence.slice(idx, idx + surface.length) }), sentence.slice(idx + surface.length));
  return container;
}

async function renderDetail() {
  const box = $('detail');
  if (!selectedId) { box.replaceChildren(el('div', { class: 'placeholder muted', text: 'Chọn một từ ở danh sách bên trái.' })); return; }
  let data;
  try { data = await send('GET_VOCABULARY', { id: selectedId }); } catch (err) {
    box.replaceChildren(el('div', { class: 'placeholder muted', text: err.message }));
    return;
  }
  const { vocabulary: v, exposures, lookups } = data;
  const e = v.enrichment;

  const statusSelect = el('select', { class: 'input', style: 'width:auto', onchange: async (ev) => { await send('UPDATE_VOCABULARY', { id: v.id, patch: { status: ev.target.value } }); toast('Đã cập nhật'); } },
    Object.entries(STATUS_LABEL).map(([k, label]) => el('option', { value: k, text: label, selected: v.status === k })));

  const head = el('div', { class: 'd-head' }, [
    el('span', { class: 'd-word', text: v.lemma }),
    v.reading ? el('span', { class: 'd-ipa', text: `【${v.reading}】` }) : null,
    v.ipa ? el('span', { class: 'd-ipa', text: v.ipa }) : null,
    v.audio ? el('button', { class: 'audio-btn', title: 'Nghe', text: '🔊', onclick: () => new Audio(v.audio).play().catch(() => {}) }) : null,
    v.surface.toLowerCase() !== v.lemma ? el('span', { class: 'muted', text: `(gặp dạng “${v.surface}”)` }) : null,
  ]);
  const tags = el('div', { class: 'd-tags' }, [
    e?.partOfSpeech ? el('span', { class: 'badge gray', text: e.partOfSpeech }) : null,
    (e?.cefr || e?.level) ? el('span', { class: 'badge', text: e.cefr || e.level }) : null,
    v.language === 'ja' ? el('span', { class: 'badge gray', text: 'tiếng Nhật' }) : null,
    e ? el('span', { class: 'stars', title: `AI đánh giá độ đáng học: ${e.learningPriority}/5`, text: stars(e.learningPriority) }) : null,
    e?.isProperNoun ? el('span', { class: 'badge warn', text: 'tên riêng' }) : null,
    el('span', { class: `badge ${v.enrichmentStatus === 'done' ? 'ok' : v.enrichmentStatus === 'failed' ? 'danger' : 'warn'}`, text: ENRICH_LABEL[v.enrichmentStatus] || v.enrichmentStatus }),
    el('span', { class: 'muted small', text: `lưu ${formatDate(v.createdAt)} · gặp ${exposures.length} lần${lookups ? ` · tra ${lookups.count} lần` : ''}` }),
  ]);
  const actions = el('div', { class: 'd-actions' }, [
    statusSelect,
    el('button', { class: 'btn small', text: e ? 'Chạy lại AI' : 'Chạy AI cho từ này', onclick: async (ev) => {
      ev.target.disabled = true;
      try { await send('ENRICH_ONE', { id: v.id }); toast('AI đã cập nhật'); } catch (err) { toast(err.message, 5000); }
      ev.target.disabled = false;
    } }),
    el('button', { class: 'btn small danger', text: 'Xóa từ', onclick: async () => {
      if (!confirm(`Xóa “${v.lemma}” và ${exposures.length} ngữ cảnh?`)) return;
      await send('DELETE_VOCABULARY', { id: v.id });
      selectedId = null;
      history.replaceState(null, '', ' ');
      toast('Đã xóa');
    } }),
  ]);

  const sections = [];
  if (e) {
    sections.push(el('div', { class: 'd-section' }, [
      el('h3', { text: 'Nghĩa trong câu bạn gặp' }),
      el('div', { class: 'd-main', text: e.meaningInContext || e.meaningVi }),
      e.meaningVi && e.meaningVi !== e.meaningInContext ? el('div', { class: 'd-sub', text: `Nghĩa chung: ${e.meaningVi}` }) : null,
      e.definitionEn ? el('div', { class: 'd-sub', text: e.definitionEn }) : null,
      e.notes ? el('div', { class: 'd-note', text: e.notes }) : null,
    ]));
    if (e.collocations?.length) sections.push(el('div', { class: 'd-section' }, [el('h3', { text: 'Collocations' }), el('div', { class: 'chips-inline' }, e.collocations.map((c) => el('span', { text: c })))]));
    if (e.example) sections.push(el('div', { class: 'd-section' }, [el('h3', { text: 'Ví dụ khác' }), el('div', { text: e.example }), e.exampleVi ? el('div', { class: 'd-sub', text: e.exampleVi }) : null]));
    if (e.synonyms?.length || e.wordFamily?.length) sections.push(el('div', { class: 'd-section' }, [
      el('h3', { text: 'Liên quan' }),
      e.synonyms?.length ? el('div', {}, [el('b', { text: 'Đồng nghĩa: ' }), e.synonyms.join(', ')]) : null,
      e.wordFamily?.length ? el('div', {}, [el('b', { text: 'Họ từ: ' }), e.wordFamily.join(', ')]) : null,
    ]));
  } else {
    sections.push(el('div', { class: 'd-section' }, [
      el('h3', { text: 'Nghĩa nhanh' }),
      el('div', { class: 'd-main', text: v.quickMeaning || '—' }),
      ...(v.quickDict || []).slice(0, 4).map((d) => el('div', { class: 'd-sub', text: `${d.pos}: ${d.terms.join(', ')}` })),
      v.enrichmentError ? el('div', { class: 'err', text: `Lỗi AI: ${v.enrichmentError}` }) : null,
      !settings.geminiApiKey ? el('div', { class: 'd-note' }, ['Thêm Gemini API key trong ', el('a', { href: '../options/options.html', text: 'Cài đặt' }), ' để AI giải thích nghĩa theo ngữ cảnh, collocation và ví dụ.']) : null,
    ]));
  }

  sections.push(el('div', { class: 'd-section' }, [
    el('h3', { text: `Bạn đã gặp từ này ở đâu (${exposures.length})` }),
    ...exposures.map((x) => el('div', { class: 'exposure' }, [
      highlight(x.sentence, x.surface),
      e?.sentenceVi && x.id === exposures[exposures.length - 1].id ? el('div', { class: 'd-sub', text: e.sentenceVi }) : null,
      el('div', { class: 'meta' }, [
        x.url ? el('a', { href: x.url, target: '_blank', rel: 'noopener', text: x.pageTitle || hostOf(x.url) || x.url, title: x.url }) : el('span', { text: x.pageTitle || 'Không rõ nguồn' }),
        x.url ? el('span', { text: hostOf(x.url) }) : null,
        el('span', { text: formatDate(x.encounteredAt) }),
        el('button', { class: 'btn small', text: 'Xóa', onclick: async () => { await send('DELETE_EXPOSURE', { id: x.id }); } }),
      ]),
    ])),
  ]));

  box.replaceChildren(head, tags, actions, ...sections);
}

async function refreshAll() {
  settings = await getSettings();
  await Promise.all([renderStats(), renderList(), renderSuggest()]);
  if (selectedId) await renderDetail();
}

$('q').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderList, 150); });
for (const id of ['f-lang', 'f-status', 'f-enrich', 'f-sort']) $(id).addEventListener('change', renderList);

$('btn-run-ai').addEventListener('click', async () => {
  $('btn-run-ai').disabled = true;
  try {
    const r = await send('PROCESS_QUEUE', { max: 10 });
    if (r.skipped === 'no-key') toast('Chưa có Gemini API key (xem Cài đặt)', 4000);
    else if (r.skipped) toast(`AI đang bận (${r.skipped})`);
    else toast(`AI xong ${r.done} từ, lỗi ${r.failed}, còn ${r.remaining}`, 4000);
  } catch (err) { toast(err.message, 5000); }
  $('btn-run-ai').disabled = false;
});

$('btn-export').addEventListener('click', async () => {
  const data = await send('EXPORT');
  download(`readlex-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2));
});
$('btn-export-anki').addEventListener('click', async () => {
  const data = await send('EXPORT');
  const byId = {};
  for (const x of data.exposures) (byId[x.vocabularyId] ||= []).push(x);
  for (const k of Object.keys(byId)) byId[k].sort((a, b) => a.encounteredAt - b.encounteredAt);
  download(`readlex-anki-${new Date().toISOString().slice(0, 10)}.tsv`, ankiTsv(data.vocabulary, byId), 'text/tab-separated-values');
});
$('btn-import').addEventListener('click', () => $('file-import').click());
$('file-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const r = await send('IMPORT', { data });
    toast(`Đã nhập ${r.vocabulary} từ, ${r.exposures} ngữ cảnh (bỏ qua ${r.skipped} trùng)`, 5000);
  } catch (err) { toast(`Import lỗi: ${err.message}`, 5000); }
  e.target.value = '';
});

onVocabularyChanged(() => refreshAll());
window.addEventListener('hashchange', () => { selectedId = location.hash.slice(1) || null; renderDetail(); renderList(); });
refreshAll();
