// Offline English-Vietnamese dictionary (OVDP "Từ điển Anh-Việt", ~118k words + ~236k phrases),
// packaged as gzip'd JSON shards under dict/en-vi/. A shard is loaded on first use, decompressed
// with DecompressionStream and kept in memory, so a hover lookup costs ~1 ms and needs no network.
// See scripts/build-dict.py for the format.

import { lemmatize } from './lemmatizer.js';

const MAX_CACHED_SHARDS = 40;
const shardCache = new Map();
let indexPromise = null;

async function loadIndex() {
  if (!indexPromise) {
    indexPromise = fetch(chrome.runtime.getURL('dict/en-vi/index.json'))
      .then((r) => (r.ok ? r.json() : null))
      .then((idx) => (idx ? { ...idx, sets: { w: new Set(idx.shards.w), p: new Set(idx.shards.p) } } : null))
      .catch(() => null);
  }
  return indexPromise;
}

export function prefixOf(key) {
  return (key.slice(0, 2).replace(/[^a-z0-9]/g, '_') + '__').slice(0, 2);
}

async function loadShard(kind, prefix) {
  const index = await loadIndex();
  if (!index || !index.sets[kind].has(prefix)) return null;
  const cacheKey = `${kind}/${prefix}`;
  if (!shardCache.has(cacheKey)) {
    const promise = (async () => {
      const res = await fetch(chrome.runtime.getURL(`dict/en-vi/${kind}/${prefix}.json.gz`));
      if (!res.ok || !res.body) return null;
      const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
      return JSON.parse(await new Response(stream).text());
    })().catch((err) => { console.warn('ReadLex: shard load failed', cacheKey, err); return null; });
    shardCache.set(cacheKey, promise);
    if (shardCache.size > MAX_CACHED_SHARDS) shardCache.delete(shardCache.keys().next().value);
  }
  return shardCache.get(cacheKey);
}

async function getRaw(kind, key) {
  const shard = await loadShard(kind, prefixOf(key));
  return shard && Object.prototype.hasOwnProperty.call(shard, key) ? shard[key] : null;
}

export async function isAvailable() {
  return !!(await loadIndex());
}

export async function dictionaryInfo() {
  const idx = await loadIndex();
  return idx ? { name: idx.name, words: idx.words, phrases: idx.phrases, builtAt: idx.builtAt, license: idx.license } : null;
}

// Single word: exact form, then lemma, then hyphen variants.
export async function lookupWord(word) {
  const key = String(word || '').toLowerCase().trim();
  if (!key) return null;
  const candidates = [key];
  const lemma = lemmatize(key);
  if (lemma && lemma !== key) candidates.push(lemma);
  if (key.includes('-')) candidates.push(key.replace(/-/g, ''), key.replace(/-/g, ' '));
  if (key.includes('’') || key.includes("'")) candidates.push(key.replace(/[’']/g, ''));
  const found = [];
  for (const c of candidates) {
    const raw = await getRaw(/\s/.test(c) ? 'p' : 'w', c);
    if (raw) found.push({ headword: c, raw, entry: parseEntry(raw, c), viaLemma: c !== key });
    if (found.length >= 2) break;
  }
  if (!found.length) return null;
  // "tariffs" has only a thin specialised entry while "tariff" has the full one: prefer general senses
  return found.find((f) => f.entry.groups.some((g) => g.senses.length)) || found[0];
}

// Phrase of 2-3 words: exact, then with each word lemmatised ("takes off" -> "take off").
export async function lookupPhrase(text) {
  const key = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const parts = key.split(' ');
  if (parts.length < 2 || parts.length > 3) return null;
  const candidates = [key, parts.map((p) => lemmatize(p) || p).join(' ')];
  for (const c of [...new Set(candidates)]) {
    const raw = await getRaw('p', c);
    if (raw) return { headword: c, raw, entry: parseEntry(raw, c), viaLemma: c !== key };
  }
  return null;
}

// Entry text format (Hồ Ngọc Đức / OVDP):
//   @headword /ipa/           first line, optional IPA
//   *  <part of speech>       starts a group of senses
//   - <meaning>               a sense
//   =<example>+<translation>  example for the previous sense
//   !<idiom>                  idiom / phrase, followed by its own "- meaning" lines
//   @Chuyên ngành <field>     specialised-field section, "-meaning" lines follow
export function parseEntry(raw, key = '') {
  const entry = { headword: key, ipa: '', groups: [], fields: [], idioms: [] };
  let current = null;
  let seenHeadword = false;
  const lines = String(raw || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const c = line[0];
    if (c === '@') {
      const body = line.slice(1).trim();
      const ipaMatch = body.match(/\/[^/]+\//);
      const ipa = ipaMatch ? ipaMatch[0] : '';
      const name = (ipaMatch ? body.slice(0, ipaMatch.index) : body).trim();
      const isField = /^(chuyên ngành|lĩnh vực)\b/i.test(body);
      if (isField) {
        current = { name: body.replace(/^Chuyên ngành\s*/i, '').replace(/^Lĩnh vực:?\s*/i, '').trim(), senses: [] };
        entry.fields.push(current);
      } else if (!seenHeadword) {
        seenHeadword = true;
        entry.headword = name || key;
        entry.ipa = ipa;
        current = null;
      } else if (name.toLowerCase() === entry.headword.toLowerCase() || (key && name.toLowerCase() === key.toLowerCase())) {
        if (!entry.ipa && ipa) entry.ipa = ipa; // merged duplicate entry
        current = null;
      } else {
        current = { name: body.replace(/^Chuyên ngành\s*/i, '').replace(/^Lĩnh vực:?\s*/i, '').trim(), senses: [] };
        entry.fields.push(current);
      }
      continue;
    }
    if (c === '*') {
      let pos = line.slice(1).trim();
      let firstSense = null;
      const plus = pos.indexOf('+');
      if (plus > 0) { firstSense = pos.slice(plus + 1).trim(); pos = pos.slice(0, plus).split(',')[0].trim(); }
      current = { pos, senses: [] };
      entry.groups.push(current);
      if (firstSense) current.senses.push({ vi: firstSense, examples: [] });
      continue;
    }
    if (c === '!') {
      current = { phrase: line.slice(1).trim(), senses: [] };
      entry.idioms.push(current);
      continue;
    }
    if (c === '-') {
      if (!current) { current = { pos: '', senses: [] }; entry.groups.push(current); }
      current.senses.push({ vi: line.slice(1).trim(), examples: [] });
      continue;
    }
    if (c === '=') {
      const body = line.slice(1);
      const plus = body.indexOf('+');
      const example = { en: (plus >= 0 ? body.slice(0, plus) : body).trim(), vi: plus >= 0 ? body.slice(plus + 1).trim() : '' };
      const last = current && current.senses[current.senses.length - 1];
      if (last) last.examples.push(example);
      else if (current) current.senses.push({ vi: '', examples: [example] });
      continue;
    }
    if (c === '/' && !entry.ipa && /\/$/.test(line)) { entry.ipa = line; continue; }
    // continuation of the previous sense
    const last = current && current.senses[current.senses.length - 1];
    if (last) last.vi = (last.vi ? last.vi + ' ' : '') + line.replace(/^\+/, '').trim();
  }
  return entry;
}

const POS_SHORT = {
  'danh từ': 'danh từ', 'ngoại động từ': 'ngoại đt', 'nội động từ': 'nội đt', 'động từ': 'động từ',
  'tính từ': 'tính từ', 'phó từ': 'phó từ', 'giới từ': 'giới từ', 'liên từ': 'liên từ', 'đại từ': 'đại từ',
  'thán từ': 'thán từ', 'mạo từ': 'mạo từ', 'trợ động từ': 'trợ đt', 'danh từ số nhiều': 'dt số nhiều',
};

function shortPos(pos) {
  const p = String(pos || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!p) return '';
  if (POS_SHORT[p]) return POS_SHORT[p];
  return p.length > 22 ? p.slice(0, 20) + '…' : p;
}

// Compact view for the popup: up to `maxLines` lines of "label: sense; sense; sense".
export function summarize(entry, { maxLines = 4, maxSenses = 3 } = {}) {
  const lines = [];
  const clip = (t) => (t.length > 170 ? t.slice(0, 168).replace(/[,;\s]+\S*$/, '') + '…' : t);
  // groups with a part of speech first (merged duplicate entries sometimes start with an unlabeled one)
  const groups = [...entry.groups].sort((a, b) => (b.pos ? 1 : 0) - (a.pos ? 1 : 0));
  for (const g of groups) {
    const senses = g.senses.map((s) => s.vi).filter(Boolean);
    if (!senses.length) continue;
    lines.push({ label: shortPos(g.pos), text: clip(senses.slice(0, maxSenses).join('; ')) });
    if (lines.length >= maxLines) break;
  }
  const fieldLimit = lines.length ? 1 : 2;
  let fieldsAdded = 0;
  for (const f of entry.fields) {
    if (fieldsAdded >= fieldLimit || lines.length >= maxLines) break;
    const senses = [...new Set(f.senses.map((s) => s.vi).filter(Boolean))];
    if (!senses.length) continue;
    lines.push({ label: shortPos(f.name), text: clip(senses.slice(0, maxSenses).join('; ')), field: true });
    fieldsAdded += 1;
  }
  let example = null;
  for (const g of entry.groups) {
    for (const s of g.senses) { if (s.examples.length && s.examples[0].en) { example = s.examples[0]; break; } }
    if (example) break;
  }
  const idiom = entry.idioms.length ? { phrase: entry.idioms[0].phrase, text: entry.idioms[0].senses.map((s) => s.vi).filter(Boolean).slice(0, 2).join('; ') } : null;
  const totalSenses = entry.groups.reduce((n, g) => n + g.senses.length, 0) + entry.fields.reduce((n, f) => n + f.senses.length, 0);
  return { ipa: entry.ipa, lines, example, idiom, totalSenses, groupCount: entry.groups.length, fieldCount: entry.fields.length, idiomCount: entry.idioms.length };
}
