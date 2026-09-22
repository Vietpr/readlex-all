import { send, onVocabularyChanged, getSettings, el, toast } from '../shared/rpc.js';

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
$('link-key').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
$('btn-run-ai').addEventListener('click', async () => {
  $('btn-run-ai').disabled = true;
  try {
    const r = await send('PROCESS_QUEUE', { max: 5 });
    if (r.skipped === 'no-key') toast('Chưa có Gemini API key');
    else toast(`AI xong ${r.done || 0} từ, còn ${r.remaining || 0}`);
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
    currentHost = tab?.url ? new URL(tab.url).hostname : '';
  } catch (_) { currentHost = ''; }
  if (!currentHost || /^(chrome|edge|about|file):/.test(currentHost)) {
    $('site-row').classList.add('hidden');
    return;
  }
  $('site-host').textContent = currentHost;
  $('site-toggle').checked = !(settings.disabledSites || []).includes(currentHost);
}

function hoverLabel() {
  const m = { hover: 'rê chuột', alt: 'Alt + rê chuột', ctrl: 'Ctrl + rê chuột', off: 'hover tắt' };
  const t = { sentence: 'câu', word: 'từ', both: 'câu + từ' };
  if (settings.hoverMode === 'off') return m.off;
  return `${m[settings.hoverMode] || ''} · ${t[settings.hoverTarget || 'sentence']}`;
}

async function renderStats() {
  const s = await send('STATS');
  $('stat-today').textContent = s.today;
  $('stat-week').textContent = s.week;
  $('stat-total').textContent = s.total;
  $('stat-pending').textContent = s.pending;
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
    $('list-title').textContent = items.length ? 'Lưu gần đây' : 'Lưu hôm nay';
  } else {
    $('list-title').textContent = q ? `Kết quả (${total})` : `Lưu hôm nay (${total})`;
  }
  const list = $('list');
  list.replaceChildren();
  for (const v of items) {
    const meaning = v.enrichment?.meaningInContext || v.enrichment?.meaningVi || v.quickMeaning || '';
    list.appendChild(el('li', { onclick: () => openPage(`vocabulary/vocabulary.html#${v.id}`) }, [
      el('span', { class: `dot ${v.enrichmentStatus}`, title: v.enrichmentStatus }),
      el('span', { class: 'word', text: v.lemma }),
      el('span', { class: 'meaning', text: meaning }),
    ]));
  }
  $('empty').classList.toggle('hidden', items.length > 0);
  list.classList.toggle('hidden', items.length === 0);
}

async function renderSync() {
  try {
    const st = await send('SYNC_STATE');
    const line = $('sync-line');
    if (!st.configured && !st.hasUrl) { line.classList.add('hidden'); return; }
    line.classList.remove('hidden');
    if (!st.configured) { line.textContent = 'Server: cần đăng nhập lại (Cài đặt)'; return; }
    line.textContent = st.lastError ? `Server: lỗi (${st.lastError}) · ${st.pending} chờ gửi` : `Server: ${st.pending ? st.pending + ' chờ gửi' : 'đã đồng bộ'}${st.lastSyncAt ? ' · ' + new Date(st.lastSyncAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : ''}`;
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
