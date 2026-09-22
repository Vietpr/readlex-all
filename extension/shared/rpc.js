// Helpers shared by the extension pages (popup, options, vocabulary).

export function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (resp) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!resp) return reject(new Error('Không nhận được phản hồi từ background'));
      if (!resp.ok) return reject(new Error(resp.error || 'Lỗi không xác định'));
      resolve(resp.data);
    });
  });
}

export function onVocabularyChanged(fn) {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'VOCABULARY_CHANGED') fn(msg);
  });
}

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return settings || {};
}

export function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function relativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const m = Math.round(diff / 60000);
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m} phút trước`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} ngày trước`;
  return formatDate(ts);
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return ''; }
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function stars(n) {
  const v = Math.max(0, Math.min(5, Number(n) || 0));
  return '★'.repeat(v) + '☆'.repeat(5 - v);
}

export const STATUS_LABEL = { new: 'Mới', learning: 'Đang học', known: 'Đã biết', ignored: 'Bỏ qua' };
export const ENRICH_LABEL = { pending: 'Chờ AI', processing: 'AI đang xử lý', done: 'AI xong', failed: 'AI lỗi', skipped: 'Bỏ qua AI' };

let toastTimer = null;
export function toast(text, ms = 2500) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

export function download(filename, content, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ankiTsv(vocabulary, exposuresById = {}) {
  const lines = [];
  for (const v of vocabulary) {
    const e = v.enrichment || {};
    const exposure = (exposuresById[v.id] || [])[0];
    const sentence = exposure?.sentence || e.example || '';
    const surface = exposure?.surface || v.surface;
    const cloze = sentence && surface ? sentence.replace(new RegExp(surface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '______') : v.lemma;
    const back = [
      `<b>${v.lemma}</b>${v.reading ? ' 【' + v.reading + '】' : ''}${v.ipa ? ' ' + v.ipa : ''}${e.partOfSpeech ? ' · ' + e.partOfSpeech : ''}`,
      e.meaningInContext || e.meaningVi || v.quickMeaning || '',
      e.example ? `<i>${e.example}</i>` : '',
      e.collocations?.length ? e.collocations.join(', ') : '',
    ].filter(Boolean).join('<br>');
    lines.push([cloze, back, v.enrichment?.cefr || v.enrichment?.level || ''].map((s) => String(s).replace(/\t/g, ' ').replace(/\n/g, ' ')).join('\t'));
  }
  return lines.join('\n');
}
