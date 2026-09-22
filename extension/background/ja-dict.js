// Offline Japanese dictionary (JMdict + KANJIDIC2 + OVDP Nhật-Việt) with Yomichan-style scanning:
// take the text that starts under the pointer, try the longest prefix first, deinflect it
// (買いました -> 買う) and look the candidates up. Shards are gzip'd JSON under dict/ja/.
// Format: scripts/build-dict-ja.py.

import { deinflect, posToTypes, candidateFits, T } from './ja-deinflect.js';

const BUCKETS = 512;
const MAX_SCAN = 16;
const MAX_CACHED_SHARDS = 60;
const shardCache = new Map();
let indexPromise = null;

export const JA_CHAR_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ々ー]/;
export const KANJI_RE = /[㐀-䶿一-鿿豈-﫿]/;
export const KANA_RE = /[぀-ヿｦ-ﾟー]/;

export function hasJapanese(text) {
  return JA_CHAR_RE.test(String(text || ''));
}

async function loadIndex() {
  if (!indexPromise) {
    indexPromise = fetch(chrome.runtime.getURL('dict/ja/index.json'))
      .then((r) => (r.ok ? r.json() : null))
      .then((idx) => (idx ? { ...idx, sets: { idx: new Set(idx.shards.idx), ent: new Set(idx.shards.ent), kanji: new Set(idx.shards.kanji) } } : null))
      .catch(() => null);
  }
  return indexPromise;
}

export async function dictionaryInfo() {
  const idx = await loadIndex();
  return idx ? { name: idx.name, entries: idx.entries, withVietnamese: idx.withVietnamese, kanji: idx.kanji, jmdictDate: idx.jmdictDate, builtAt: idx.builtAt } : null;
}

function bucketKey(key) {
  const cps = Array.from(key).slice(0, 2).map((c) => c.codePointAt(0));
  return (cps[0] * 31 + (cps[1] || 0)) % BUCKETS;
}

async function loadShard(kind, bucket) {
  const index = await loadIndex();
  if (!index || !index.sets[kind].has(bucket)) return null;
  const cacheKey = `${kind}/${bucket}`;
  if (!shardCache.has(cacheKey)) {
    const promise = (async () => {
      const res = await fetch(chrome.runtime.getURL(`dict/ja/${kind}/${bucket}.json.gz`));
      if (!res.ok || !res.body) return null;
      const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
      return JSON.parse(await new Response(stream).text());
    })().catch((err) => { console.warn('ReadLex: ja shard failed', cacheKey, err); return null; });
    shardCache.set(cacheKey, promise);
    if (shardCache.size > MAX_CACHED_SHARDS) shardCache.delete(shardCache.keys().next().value);
  }
  return shardCache.get(cacheKey);
}

async function idsFor(key) {
  const shard = await loadShard('idx', bucketKey(key));
  return shard && Object.prototype.hasOwnProperty.call(shard, key) ? shard[key] : [];
}

async function entriesFor(ids) {
  const byBucket = new Map();
  for (const id of ids) {
    const b = id % BUCKETS;
    if (!byBucket.has(b)) byBucket.set(b, []);
    byBucket.get(b).push(id);
  }
  const out = [];
  for (const [b, list] of byBucket) {
    const shard = await loadShard('ent', b);
    if (!shard) continue;
    for (const id of list) {
      const rec = shard[String(id)];
      if (rec) out.push({ id, kanji: rec[0], kana: rec[1], senses: rec[2], types: rec[3], vi: rec[4] || '' });
    }
  }
  return out;
}

const POS_LABEL = {
  n: 'danh từ', 'n-suf': 'hậu tố dt', 'n-pref': 'tiền tố dt', pn: 'đại từ', num: 'số từ', ctr: 'lượng từ',
  v1: 'đt ichidan', 'v1-s': 'đt ichidan', vs: 'dt + する', 'vs-i': 'đt する', 'vs-s': 'đt する', vk: 'đt 来る', vz: 'đt ずる',
  'adj-i': 'tính từ い', 'adj-ix': 'tính từ い', 'adj-na': 'tính từ な', 'adj-no': 'dt + の', 'adj-f': 'bổ nghĩa', 'adj-t': 'tt たる',
  'adj-pn': 'liên thể từ', adv: 'trạng từ', 'adv-to': 'trạng từ と', exp: 'cụm từ', prt: 'trợ từ', conj: 'liên từ', int: 'thán từ',
  pref: 'tiền tố', suf: 'hậu tố', 'aux-v': 'trợ động từ', aux: 'trợ từ', 'aux-adj': 'trợ tính từ', cop: 'hệ từ', unc: '',
  vt: 'tha đt', vi: 'tự đt',
};
function posLabel(tags) {
  const out = [];
  for (const t of tags || []) {
    if (t === 'vt' || t === 'vi') continue;
    let label = POS_LABEL[t];
    if (label === undefined) label = t.startsWith('v5') ? 'đt godan' : t.startsWith('v') ? 'động từ' : t;
    if (label && !out.includes(label)) out.push(label);
  }
  const tv = (tags || []).includes('vt') ? 'tha' : (tags || []).includes('vi') ? 'tự' : '';
  const s = out.slice(0, 2).join(', ');
  return tv && s ? `${s} (${tv})` : s;
}
const MISC_LABEL = { uk: 'thường viết kana', col: 'khẩu ngữ', hon: 'tôn kính', hum: 'khiêm nhường', pol: 'lịch sự', arch: 'cổ', sl: 'lóng', vulg: 'thô tục', derog: 'miệt thị', abbr: 'viết tắt', obs: 'cũ', fam: 'thân mật', male: 'nam giới', fem: 'nữ giới', chn: 'trẻ con', rare: 'hiếm' };

function formatEntry(e, cand, key) {
  const kanjiForms = e.kanji.map((k) => k[0]);
  const kanaForms = e.kana.map((k) => k[0]);
  const usuallyKana = e.senses.some((s) => (s[2] || []).includes('uk'));
  let headword;
  if (kanjiForms.includes(key)) headword = key;
  else if (kanjiForms.length && !usuallyKana) headword = (e.kanji.find((k) => k[1]) || e.kanji[0])[0];
  else headword = kanaForms.includes(key) ? key : (e.kana.find((k) => k[1]) || e.kana[0] || [''])[0];
  const reading = (e.kana.find((k) => k[1]) || e.kana[0] || [''])[0];
  const common = e.kanji.some((k) => k[1]) || e.kana.some((k) => k[1]);
  const viaKanji = kanjiForms.includes(key);
  const suru = key.endsWith('する') && !kanjiForms.includes(key) && !kanaForms.includes(key);
  return {
    id: e.id,
    headword: suru ? headword + 'する' : headword,
    reading: reading === headword ? '' : (suru ? reading + 'する' : reading),
    forms: kanjiForms.slice(0, 4),
    common,
    vi: e.vi,
    senses: e.senses.slice(0, 4).map((s) => ({ pos: s[0], posLabel: posLabel(s[0]), gloss: s[1], misc: (s[2] || []).map((m) => MISC_LABEL[m] || m) })),
    trail: cand.trail,
    score: (common ? 100 : 0) + (viaKanji ? 10 : 0) - cand.trail.length * 5 + (usuallyKana && !viaKanji ? 5 : 0),
  };
}

export async function kanjiInfo(ch) {
  if (!ch || !KANJI_RE.test(ch)) return null;
  const shard = await loadShard('kanji', ch.codePointAt(0) >> 6);
  const rec = shard && shard[ch];
  if (!rec) return null;
  return { literal: ch, meanings: rec[0], on: rec[1], kun: rec[2], jlpt: rec[3], grade: rec[4], freq: rec[5], strokes: rec[6] };
}

// Scan text that starts under the pointer. Returns { matched, matchedLength, results[], kanji? } or null.
export async function scan(text, { allowSingleKana = false } = {}) {
  const chars = Array.from(String(text || '')).slice(0, MAX_SCAN);
  if (!chars.length || !JA_CHAR_RE.test(chars[0])) return null;
  for (let len = chars.length; len >= 1; len--) {
    const s = chars.slice(0, len).join('');
    if (len === 1 && !allowSingleKana && !KANJI_RE.test(s)) break;
    const found = [];
    const seen = new Set();
    for (const cand of deinflect(s)) {
      const ids = await idsFor(cand.text);
      if (!ids.length) continue;
      for (const e of await entriesFor(ids)) {
        if (seen.has(e.id) || !candidateFits(cand, e.types)) continue;
        seen.add(e.id);
        found.push(formatEntry(e, cand, cand.text));
      }
    }
    if (found.length) {
      found.sort((a, b) => b.score - a.score);
      const kanji = KANJI_RE.test(chars[0]) ? await kanjiInfo(chars[0]) : null;
      return { matched: s, matchedLength: len, results: found.slice(0, 4), kanji };
    }
  }
  const kanji = await kanjiInfo(chars[0]);
  if (kanji) return { matched: chars[0], matchedLength: 1, results: [], kanji };
  return null;
}

// Best single-line meaning for quickMeaning / word lines.
export function firstMeaning(scanResult) {
  const r = scanResult?.results?.[0];
  if (r) return r.vi || r.senses[0]?.gloss.slice(0, 3).join('; ') || null;
  const k = scanResult?.kanji;
  return k ? k.meanings.slice(0, 3).join(', ') : null;
}
