// Helpers shared by the extension pages (popup, options, vocabulary).

export function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (resp) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!resp) return reject(new Error('No response from the extension background'));
      if (!resp.ok) return reject(new Error(resp.error || 'Unknown error'));
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
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function relativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${plural(m, 'minute')} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${plural(h, 'hour')} ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${plural(d, 'day')} ago`;
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

// Inline stroke icons (24px grid, currentColor) for markup built in JS.
const ICONS = {
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  plus: ['M12 5v14', 'M5 12h14'],
  audio: ['M11 5 6 9H3v6h3l5 4z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M18.5 5.5a9 9 0 0 1 0 13'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6.5 7l1 13h9l1-13'],
  sparkle: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', 'M19 16v4', 'M17 18h4'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
};
export function icon(name, size = 18, strokeWidth = 2) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  const attrs = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': strokeWidth, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  for (const d of ICONS[name] || []) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

export function stars(n) {
  const v = Math.max(0, Math.min(5, Number(n) || 0));
  return '★'.repeat(v) + '☆'.repeat(5 - v);
}

export const STATUS_LABEL = { new: 'New', learning: 'Learning', known: 'Known', ignored: 'Ignored' };
export const ENRICH_LABEL = { pending: 'Waiting for AI', processing: 'AI is working', done: 'Explained by AI', failed: 'AI failed', skipped: 'AI skipped' };

// "1 word" / "2 words"; pass `many` for irregular plurals.
export function plural(n, one, many = `${one}s`) {
  return `${n} ${Number(n) === 1 ? one : many}`;
}

let toastTimer = null;
export function toast(text, ms = 2500) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
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
