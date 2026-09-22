// Lookups for the hover / selection popup.
//
// 1. Offline dictionary (dict/en-vi, no network): single words and 2-3 word phrases. Instant.
// 2. Network, only for text the offline dictionary does not have (long phrases, sentences,
//    rare words): Google Translate (clients5 "dict-chrome-ex", then the "gtx" endpoint), MyMemory
//    as a last resort; Free Dictionary API only to fill in a missing IPA. Cached 30 days.
// Gemini is never used here: it is too slow and rate-limited for hover.

import { db } from './db.js';
import { lookupWord as offlineWord, lookupPhrase as offlinePhrase, summarize } from './offline-dict.js';
import { scan as jaScan, hasJapanese, firstMeaning as jaFirstMeaning } from './ja-dict.js';

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const WORD_RE = /^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ'’-]*$/;

export function isSingleWord(text) {
  return WORD_RE.test(text);
}

// Google TTS (unofficial) - played by the content script, fetched by the background as a fallback.
export function ttsUrl(text, lang = 'en') {
  return `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(text)}`;
}

async function fetchWithTimeout(url, { timeout = 4000, ...init } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export function detectSource(text) {
  return hasJapanese(text) ? 'ja' : 'en';
}

// Japanese: scan from the start of the text (hover) or require the whole selection to be one word.
async function lookupJapanese(text, kind, target) {
  const result = await jaScan(text, { allowSingleKana: kind === 'ja-phrase' }).catch(() => null);
  const whole = result && result.matchedLength === Array.from(text).length;
  if (result && (kind === 'scan' || whole)) {
    const first = result.results[0];
    const headword = first ? first.headword : result.kanji ? result.kanji.literal : result.matched;
    return {
      text, source: 'ja', target, isWord: true, kind,
      matched: result.matched, matchedLength: result.matchedLength,
      ja: { matched: result.matched, results: result.results, kanji: result.kanji },
      headword, reading: first ? first.reading : '',
      translation: jaFirstMeaning(result), dict: [], definitions: [], ipa: null,
      audio: ttsUrl(headword, 'ja'), offline: null, provider: 'offline-ja', error: null,
    };
  }
  if (kind === 'scan') return { text, source: 'ja', target, isWord: true, kind, matched: '', matchedLength: 0, ja: null, translation: null, dict: [], definitions: [], ipa: null, audio: null, offline: null, provider: null, error: null };
  return null; // fall through to Google
}

export async function lookup(text, { source = 'auto', target = 'vi', kind = 'word' } = {}) {
  const normalized = kind === 'scan' ? String(text || '') : String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) throw new Error('Empty text');
  if (normalized.length > 1000) throw new Error('Đoạn văn quá dài (tối đa 1000 ký tự)');
  if (source === 'auto') source = detectSource(normalized);

  if (source === 'ja' && (kind === 'scan' || kind === 'ja-phrase' || kind === 'word')) {
    const ja = await lookupJapanese(normalized, kind === 'word' ? 'ja-phrase' : kind, target);
    if (ja) return ja;
  }

  const isWord = source === 'en' && isSingleWord(normalized);
  let offline = null;
  if (source === 'en' && target === 'vi') {
    try {
      offline = isWord ? await offlineWord(normalized) : await offlinePhrase(normalized);
    } catch (err) {
      console.warn('ReadLex: offline lookup failed', err);
    }
  }

  const base = {
    text: normalized,
    isWord,
    source,
    target,
    translation: null,
    dict: [],
    definitions: [],
    baseForm: null,
    ipa: offline?.entry.ipa || null,
    audio: isWord ? ttsUrl(normalized, source) : null,
    kind,
    offline: offline ? { headword: offline.headword, viaLemma: !!offline.viaLemma, ...summarize(offline.entry) } : null,
    provider: offline ? 'offline' : null,
    error: null,
  };

  if (offline && (isWord || base.offline.lines.length)) {
    // Words: the offline entry is the answer. Phrases: also fetch the Google translation below.
    base.translation = firstMeaning(base.offline);
    if (isWord) return base;
  }

  const key = `${source}:${target}:${normalized.toLowerCase()}`;
  const cached = await db.get('cache', key).catch(() => null);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return { ...base, ...cached.value, offline: base.offline, ipa: base.ipa || cached.value.ipa || null, audio: base.audio || cached.value.audio || null, fromCache: true };
  }

  const [gt, dict] = await Promise.allSettled([
    translateWithFallback(normalized, source, target, isWord),
    isWord && !base.ipa && source === 'en' ? freeDictionary(normalized) : Promise.resolve(null),
  ]);
  const net = {
    translation: gt.status === 'fulfilled' ? gt.value.translation : null,
    dict: gt.status === 'fulfilled' ? gt.value.dict : [],
    baseForm: gt.status === 'fulfilled' ? gt.value.baseForm : null,
    provider: gt.status === 'fulfilled' ? gt.value.provider : base.provider,
    ipa: base.ipa || (dict.status === 'fulfilled' && dict.value ? dict.value.ipa : null),
    audio: base.audio || (dict.status === 'fulfilled' && dict.value ? dict.value.audio : null),
    definitions: dict.status === 'fulfilled' && dict.value ? dict.value.definitions : [],
    error: gt.status === 'rejected' ? (gt.reason?.message || String(gt.reason)) : null,
  };
  if (!net.error) await db.put('cache', { key, value: net, cachedAt: Date.now() }).catch(() => {});
  const result = { ...base, ...net };
  if (!result.translation && base.offline) result.translation = firstMeaning(base.offline);
  return result;
}

function firstMeaning(summary) {
  const line = summary?.lines?.[0];
  if (!line) return null;
  return line.text.split(';')[0].trim() || null;
}

async function translateWithFallback(text, sl, tl, isWord) {
  const providers = isWord ? [googleGtx, googleChromeEx, myMemory] : [googleChromeEx, googleGtx, myMemory];
  let lastError = null;
  for (const provider of providers) {
    try {
      return await provider(text, sl, tl);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Không dịch được');
}

// Fast endpoint used by Google's own dictionary extension. Returns ["translation"] or [["translation","src"]].
async function googleChromeEx(q, sl, tl) {
  const url = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${sl}&tl=${tl}&q=${encodeURIComponent(q)}`;
  const data = await fetchWithTimeout(url, { timeout: 4000 });
  const strings = [];
  (function walk(v) { if (typeof v === 'string') strings.push(v); else if (Array.isArray(v)) v.forEach(walk); })(data);
  const translation = (strings[0] || '').trim();
  if (!translation) throw new Error('Google (chrome-ex): empty');
  return { translation, dict: [], baseForm: null, provider: 'google-chrome-ex' };
}

// Classic endpoint with a small dictionary (part of speech + alternatives) for single words.
async function googleGtx(q, sl, tl) {
  const params = new URLSearchParams({ client: 'gtx', sl, tl, dj: '1', q });
  params.append('dt', 't');
  params.append('dt', 'bd');
  const data = await fetchWithTimeout(`https://translate.googleapis.com/translate_a/single?${params.toString()}`, { timeout: 3500 });
  const translation = (data.sentences || []).map((s) => s.trans || '').join('').trim();
  if (!translation) throw new Error('Google (gtx): empty');
  const dict = (data.dict || []).map((d) => ({ pos: d.pos || '', terms: (d.terms || []).slice(0, 6), baseForm: d.base_form || null }));
  return { translation, dict, baseForm: dict[0]?.baseForm || null, provider: 'google-gtx' };
}

async function myMemory(q, sl, tl) {
  const data = await fetchWithTimeout(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${sl}|${tl}`, { timeout: 6000 });
  const translation = data?.responseData?.translatedText;
  if (!translation || /QUERY LENGTH LIMIT|INVALID/i.test(translation)) throw new Error('MyMemory: no translation');
  return { translation, dict: [], baseForm: null, provider: 'mymemory' };
}

async function freeDictionary(word) {
  let entries;
  try {
    entries = await fetchWithTimeout(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`, { timeout: 2500 });
  } catch (_) {
    return null;
  }
  if (!Array.isArray(entries) || !entries.length) return null;
  let ipa = null;
  let audio = null;
  for (const entry of entries) {
    for (const ph of entry.phonetics || []) {
      if (!ipa && ph.text) ipa = ph.text;
      if (!audio && ph.audio) audio = ph.audio;
      if (ph.text && ph.audio && /-us\.mp3$/.test(ph.audio)) { ipa = ph.text; audio = ph.audio; }
    }
    if (!ipa && entry.phonetic) ipa = entry.phonetic;
  }
  const definitions = [];
  for (const entry of entries) {
    for (const m of entry.meanings || []) {
      const d = m.definitions?.[0];
      if (!d) continue;
      definitions.push({ partOfSpeech: m.partOfSpeech, definition: d.definition, example: d.example || null });
      if (definitions.length >= 3) break;
    }
    if (definitions.length >= 3) break;
  }
  return { ipa, audio, definitions };
}

// Fetch an audio clip in the background (pages with a strict CSP cannot play the Google URL directly).
export async function fetchAudioDataUrl(url) {
  if (!/^https:\/\/(translate\.google\.com|api\.dictionaryapi\.dev)\//.test(url)) throw new Error('URL không được phép');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    let binary = '';
    for (let i = 0; i < buf.length; i += 0x8000) binary += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return `data:${res.headers.get('content-type') || 'audio/mpeg'};base64,${btoa(binary)}`;
  } finally {
    clearTimeout(timer);
  }
}

export async function pruneCache() {
  const rows = await db.getAll('cache');
  const cutoff = Date.now() - CACHE_TTL_MS;
  const stale = rows.filter((r) => r.cachedAt < cutoff).map((r) => r.key);
  if (stale.length) await db.bulkDelete('cache', stale);
  return stale.length;
}

export async function clearCache() {
  await db.clear('cache');
}
