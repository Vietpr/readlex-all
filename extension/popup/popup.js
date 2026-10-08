import { send, onVocabularyChanged, getSettings, el, toast, plural } from '../shared/rpc.js';

const $ = (id) => document.getElementById(id);
let currentHost = '';
let settings = {};
let searchTimer = null;

function openPage(path) {
  chrome.tabs.create({ url: chrome.runtime.getURL(path) });
  window.close();
}

$('btn-vocab').addEventListener('click', () => openPage('vocabulary/vocabulary.html'));
$('btn-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
// Real links (so they are focusable and announce as links), but a popup must open them in a tab.
$('link-key').addEventListener('click', (e) => { e.preventDefault(); openPage('options/options.html#ai'); });
$('link-mode').addEventListener('click', (e) => { e.preventDefault(); openPage('options/options.html#re-chuot'); });
$('btn-run-ai').addEventListener('click', async () => {
  $('btn-run-ai').disabled = true;
  try {
    const r = await send('PROCESS_QUEUE', { max: 5 });
    if (r.skipped === 'no-key') toast('No Gemini key yet');
    else toast(`AI explained ${plural(r.done || 0, 'word')}, ${r.remaining || 0} left`);
  } catch (err) { toast(err.message); }
  $('btn-run-ai').disabled = false;
  refresh();
});

$('site-toggle').addEventListener('change', async (e) => {
  const list = new Set(settings.disabledSites || []);
  if (e.target.checked) list.delete(currentHost); else list.add(currentHost);
  settings = await send('SET_SETTINGS', { patch: { disabledSites: [...list] } });
});

$('search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderList, 150);
});

async function loadSite() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url ? new URL(tab.url) : null;
    currentHost = url && /^https?:$/.test(url.protocol) ? url.hostname : '';
  } catch (_) { currentHost = ''; }
  if (!currentHost) {
    $('site-row').classList.add('hidden');
    return;
  }
  $('site-host').textContent = currentHost;
  $('site-toggle').checked = !(settings.disabledSites || []).includes(currentHost);
}

// One plain sentence describing what hovering does right now, from the current settings.
function hoverLabel() {
  if (settings.hoverMode === 'off') {
    return settings.selectionMode === 'off'
      ? 'Hover is off. Select text and right-click to look up a word'
      : 'Hover is off. Select text to look up a word';
  }
  const how = { hover: 'Hover', alt: 'Hold Alt and hover', ctrl: 'Hold Ctrl and hover' }[settings.hoverMode] || 'Hover';
  const what = {
    sentence: 'to translate the sentence, hold Shift to look up a word',
    both: 'to translate the sentence and the word, hold Shift for the word only',
    word: 'to look up a word, hold Shift to translate the sentence',
  }[settings.hoverTarget || 'sentence'];
  return `${how} ${what}`;
}

async function renderStats() {
  const s = await send('STATS');
  const today = el('span', { id: 'stat-today', text: String(s.today), hidden: !(s.today > 0) });
  $('stat-line').replaceChildren(...(s.today > 0 ? ['You saved ', today, s.today === 1 ? ' word today' : ' words today'] : ['No words saved today yet', today]));
  $('stat-week').textContent = s.week;
  $('stat-total').textContent = s.total;
  $('stat-pending').textContent = s.pending;
  $('stat-pending-label').textContent = `${s.pending === 1 ? 'word' : 'words'} waiting for an AI explanation`;
  $('stat-pending-card').classList.toggle('hidden', !(s.pending > 0));
  $('btn-run-ai').classList.toggle('hidden', !(s.pending > 0 && settings.geminiApiKey));
}

async function renderList() {
  const q = $('search').value.trim();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const params = q ? { query: q, limit: 30 } : { since: startOfDay.getTime(), limit: 30 };
  let { items, total } = await send('LIST_VOCABULARY', { params });
  if (!q && !items.length) {
    ({ items, total } = await send('LIST_VOCABULARY', { params: { limit: 10 } }));
    $('list-title').textContent = items.length ? 'Recently saved' : 'Saved today';
  } else {
    $('list-title').textContent = q ? `${plural(total, 'word')} found` : 'Saved today';
  }
  const list = $('list');
  list.replaceChildren();
  for (const v of items) {
    const meaning = v.enrichment?.meaningInContext || v.enrichment?.meaningVi || v.quickMeaning || '';
    const path = `vocabulary/vocabulary.html#${v.id}`;
    list.appendChild(el('li', {}, [
      el('a', { href: `../${path}`, onclick: (e) => { e.preventDefault(); openPage(path); } }, [
        el('span', { class: 'word', lang: v.language === 'ja' ? 'ja' : 'en', text: v.lemma }),
        el('span', { class: 'meaning', text: meaning }),
        statusChip(v.enrichmentStatus),
      ]),
    ]));
  }
  $('empty').textContent = q
    ? 'No saved words match.'
    : 'No words yet. Hover over or select a word on a page, then press “Save word”.';
  $('empty').classList.toggle('hidden', items.length > 0);
  list.classList.toggle('hidden', items.length === 0);
}

// A chip only for words the AI has not explained yet; finished words carry no marker.
function statusChip(status) {
  if (status === 'pending' || status === 'processing') return el('span', { class: 'badge warn', text: 'AI pending' });
  if (status === 'failed') return el('span', { class: 'badge danger', text: 'AI failed' });
  return null;
}

async function renderSync() {
  try {
    const st = await send('SYNC_STATE');
    const line = $('sync-line');
    if (!st.configured && !st.hasUrl) { line.classList.add('hidden'); return; }
    line.classList.remove('hidden');
    if (!st.configured) { line.textContent = 'Sync: sign in again in Settings'; return; }
    const at = st.lastSyncAt ? ` at ${new Date(st.lastSyncAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : '';
    line.textContent = st.lastError
      ? `Sync error (${st.lastError}) · ${plural(st.pending, 'change')} waiting to send`
      : st.pending ? `Sync: ${plural(st.pending, 'change')} waiting to send` : `Synced with your account${at}`;
  } catch (_) { /* ignore */ }
}

async function refresh() {
  settings = await getSettings();
  $('no-key').classList.toggle('hidden', !!settings.geminiApiKey || !!settings.backendUrl);
  renderSync();
  $('hover-mode').textContent = hoverLabel();
  await Promise.all([renderStats(), renderList()]);
}

onVocabularyChanged(() => refresh());
(async () => {
  settings = await getSettings();
  await loadSite();
  await refresh();
})();
