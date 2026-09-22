// Gemini enrichment. Runs only after a word is saved (never on hover), paced to stay inside
// the free-tier rate limits, resumable across service-worker restarts via chrome.alarms.

import { db } from './db.js';
import { getSettings } from './settings.js';
import { findByLemma, mergeVocabulary, updateBadge } from './vocabulary.js';

const MIN_INTERVAL_MS = 6500;   // ~9 requests / minute
const MAX_ATTEMPTS = 5;
const STALE_PROCESSING_MS = 3 * 60 * 1000;

let lastCallAt = 0;
let running = false;
let pausedUntil = 0;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    lemma: { type: 'STRING' },
    partOfSpeech: { type: 'STRING' },
    ipa: { type: 'STRING' },
    meaningVi: { type: 'STRING' },
    meaningInContext: { type: 'STRING' },
    sentenceVi: { type: 'STRING' },
    definitionEn: { type: 'STRING' },
    cefr: { type: 'STRING', enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] },
    reading: { type: 'STRING' },
    level: { type: 'STRING' },
    collocations: { type: 'ARRAY', items: { type: 'STRING' } },
    example: { type: 'STRING' },
    exampleVi: { type: 'STRING' },
    synonyms: { type: 'ARRAY', items: { type: 'STRING' } },
    wordFamily: { type: 'ARRAY', items: { type: 'STRING' } },
    notes: { type: 'STRING' },
    learningPriority: { type: 'INTEGER' },
    isProperNoun: { type: 'BOOLEAN' },
  },
  required: ['lemma', 'partOfSpeech', 'meaningVi', 'meaningInContext', 'cefr', 'collocations', 'example', 'exampleVi', 'learningPriority', 'isProperNoun'],
};

const JA_SCHEMA = {
  ...RESPONSE_SCHEMA,
  required: ['lemma', 'reading', 'partOfSpeech', 'meaningVi', 'meaningInContext', 'level', 'collocations', 'example', 'exampleVi', 'learningPriority', 'isProperNoun'],
};

function buildPromptJa(vocab, exposures) {
  const primary = exposures[0];
  const others = exposures.slice(1, 4).map((e) => `- ${e.sentence}`).join('\n');
  return [
    'You are a Japanese vocabulary tutor for a Vietnamese learner who reads Japanese news and articles.',
    'Analyze the target word AS IT IS USED in the given sentence and return JSON only.',
    '',
    `Target (as found in text): "${vocab.surface}"`,
    vocab.lemma !== vocab.surface ? `Dictionary form guess: "${vocab.lemma}"` : '',
    vocab.reading ? `Reading guess: "${vocab.reading}"` : '',
    primary?.sentence ? `Sentence: "${primary.sentence}"` : 'Sentence: (none)',
    primary?.paragraph && primary.paragraph !== primary.sentence ? `Surrounding paragraph: "${primary.paragraph.slice(0, 600)}"` : '',
    others ? `Other sentences where the learner met it:\n${others}` : '',
    primary?.pageTitle ? `Page title: "${primary.pageTitle}"` : '',
    '',
    'Field rules:',
    '- lemma: dictionary form (辞書形) of the target, e.g. 買いました -> 買う, 静かな -> 静か.',
    '- reading: reading of the lemma in hiragana (katakana for loanwords).',
    '- partOfSpeech: in Vietnamese, e.g. "động từ nhóm 1", "danh từ", "tính từ い", "tính từ な", "phó từ", "trợ từ".',
    '- meaningVi: concise general Vietnamese meaning(s), max ~15 words, separate senses with ";".',
    '- meaningInContext: the Vietnamese meaning exactly as used in the sentence.',
    '- sentenceVi: natural Vietnamese translation of the sentence.',
    '- definitionEn: short English gloss (a few words).',
    '- level: JLPT level of this word: one of N5, N4, N3, N2, N1.',
    '- cefr: leave empty string.',
    '- ipa: leave empty string.',
    '- collocations: 3 to 6 common combinations containing the lemma, e.g. "本を買う", "切符を買う".',
    '- example: ONE new natural Japanese example sentence (not the given one), 8-25 characters, plain form.',
    '- exampleVi: Vietnamese translation of that example.',
    '- synonyms: up to 4 near-synonyms in Japanese (empty array if none).',
    '- wordFamily: related words sharing a kanji or stem, e.g. 買い物, 売買 (empty if none).',
    '- notes: 1-2 short sentences IN VIETNAMESE: Hán Việt reading of the kanji (e.g. 買 = MÃI), usage, register, confusions. Empty string if nothing useful.',
    '- learningPriority: 1-5 how worth learning for a general adult reader of Japanese news (5 = very common, 1 = rare / proper noun).',
    '- isProperNoun: true if the target is a name of a person, place, organisation, product.',
  ].filter(Boolean).join('\n');
}

function buildPrompt(vocab, exposures) {
  if (vocab.language === 'ja') return buildPromptJa(vocab, exposures);
  const primary = exposures[0];
  const others = exposures.slice(1, 4).map((e) => `- ${e.sentence}`).join('\n');
  return [
    'You are an English vocabulary tutor for a Vietnamese learner who reads English news and articles.',
    'Analyze the target word or phrase AS IT IS USED in the given sentence and return JSON only.',
    '',
    `Target: "${vocab.surface}"`,
    vocab.lemma !== vocab.surface.toLowerCase() ? `Guessed base form: "${vocab.lemma}"` : '',
    primary?.sentence ? `Sentence: "${primary.sentence}"` : 'Sentence: (none)',
    primary?.paragraph && primary.paragraph !== primary.sentence ? `Surrounding paragraph: "${primary.paragraph.slice(0, 700)}"` : '',
    others ? `Other sentences where the learner met it:\n${others}` : '',
    primary?.pageTitle ? `Page title: "${primary.pageTitle}"` : '',
    '',
    'Field rules:',
    '- lemma: dictionary base form of the target as used here, lowercase (verbs -> infinitive, nouns -> singular). For a phrase, the canonical phrase.',
    '- partOfSpeech: as used in the sentence (noun, verb, adjective, adverb, phrasal verb, idiom, preposition, ...).',
    '- ipa: IPA of the lemma, e.g. /səˈsteɪn/ (empty string for phrases if unnatural).',
    '- meaningVi: concise general Vietnamese meaning(s), max ~15 words, separate senses with ";".',
    '- meaningInContext: the Vietnamese meaning exactly as used in the sentence.',
    '- sentenceVi: natural Vietnamese translation of the sentence.',
    '- definitionEn: short learner-friendly English definition (one sentence).',
    '- cefr: CEFR level of this sense.',
    '- collocations: 3 to 6 common collocations containing the lemma.',
    '- example: ONE new natural example sentence (not the given one), 8-18 words.',
    '- exampleVi: Vietnamese translation of that example.',
    '- synonyms: up to 4 near-synonyms (empty array if none).',
    '- wordFamily: related forms (e.g. sustain, sustainable, sustainability), empty if none.',
    '- notes: 1-2 short sentences IN VIETNAMESE on usage, register, or confusions with similar words. Empty string if nothing useful.',
    '- learningPriority: 1-5 how worth learning for a general adult reader (5 = very useful everyday/news word, 1 = too rare, technical, or a proper noun).',
    '- isProperNoun: true if the target is a name of a person, place, organisation, product.',
  ].filter(Boolean).join('\n');
}

export async function callGemini({ apiKey, model }, prompt, { schema = RESPONSE_SCHEMA, temperature = 0.2 } = {}) {
  if (!apiKey) throw Object.assign(new Error('Chưa cấu hình Gemini API key'), { code: 'NO_KEY' });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      responseMimeType: 'application/json',
      ...(schema ? { responseSchema: schema } : {}),
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let message = text.slice(0, 300);
    try { message = JSON.parse(text)?.error?.message || message; } catch (_) { /* keep raw */ }
    throw Object.assign(new Error(`Gemini HTTP ${res.status}: ${message}`), { status: res.status });
  }
  let json;
  try { json = JSON.parse(text); } catch (_) { throw new Error('Gemini trả về dữ liệu không phải JSON'); }
  const parts = json.candidates?.[0]?.content?.parts || [];
  const out = parts.map((p) => p.text || '').join('').trim();
  if (!out) {
    const reason = json.candidates?.[0]?.finishReason || json.promptFeedback?.blockReason || 'empty';
    throw new Error(`Gemini không trả về nội dung (${reason})`);
  }
  try { return JSON.parse(out); } catch (_) {
    const m = out.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('Không parse được JSON từ Gemini');
  }
}

const str0 = (v) => (typeof v === 'string' ? v.trim() : '');

function sanitize(data) {
  const str = str0;
  const arr = (v) => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean).slice(0, 8) : []);
  const pri = Number(data.learningPriority);
  return {
    lemma: str(data.lemma).toLowerCase(),
    reading: str(data.reading),
    level: str(data.level),
    partOfSpeech: str(data.partOfSpeech),
    ipa: str(data.ipa),
    meaningVi: str(data.meaningVi),
    meaningInContext: str(data.meaningInContext),
    sentenceVi: str(data.sentenceVi),
    definitionEn: str(data.definitionEn),
    cefr: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(data.cefr) ? data.cefr : '',
    collocations: arr(data.collocations),
    example: str(data.example),
    exampleVi: str(data.exampleVi),
    synonyms: arr(data.synonyms),
    wordFamily: arr(data.wordFamily),
    notes: str(data.notes),
    learningPriority: Number.isFinite(pri) ? Math.min(5, Math.max(1, Math.round(pri))) : 3,
    isProperNoun: !!data.isProperNoun,
  };
}

async function pace() {
  const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

export async function enrichOne(vocabId, settings, { force = false } = {}) {
  const vocab = await db.get('vocabulary', vocabId);
  if (!vocab) return null;
  if (!force && vocab.enrichmentStatus === 'done') return vocab;

  vocab.enrichmentStatus = 'processing';
  vocab.updatedAt = Date.now();
  await db.put('vocabulary', vocab);

  const exposures = (await db.getAllByIndex('exposures', 'vocabularyId', vocab.id)).sort((a, b) => a.encounteredAt - b.encounteredAt);
  try {
    await pace();
    const isJa = vocab.language === 'ja';
    const raw = await callGemini({ apiKey: settings.geminiApiKey, model: settings.geminiModel }, buildPrompt(vocab, exposures), { schema: isJa ? JA_SCHEMA : RESPONSE_SCHEMA });
    const data = sanitize(raw);
    if (isJa) data.lemma = str0(raw.lemma); // keep original case / script for Japanese
    const fresh = (await db.get('vocabulary', vocab.id)) || vocab;
    fresh.enrichment = { ...data, model: settings.geminiModel, enrichedAt: Date.now() };
    fresh.enrichmentStatus = 'done';
    fresh.enrichmentError = null;
    fresh.updatedAt = Date.now();
    if (data.ipa && !fresh.ipa) fresh.ipa = data.ipa;
    if (isJa && data.reading && !fresh.reading) fresh.reading = data.reading;

    const newLemma = data.lemma;
    const sameScript = isJa ? /[぀-ヿ㐀-䶿一-鿿ー々]/.test(newLemma) : /^[a-z][a-z'’-]*$/.test(newLemma);
    // the dictionary already reduced the surface to a base form; do not let the model undo that
    const undoesDictionary = isJa && newLemma === fresh.surface && fresh.lemma !== fresh.surface;
    if (newLemma && sameScript && !undoesDictionary && newLemma !== fresh.lemma && fresh.kind === 'word' && !/\s/.test(newLemma)) {
      const other = await findByLemma(newLemma, fresh.language || 'en');
      if (other && other.id !== fresh.id) {
        await db.put('vocabulary', fresh);
        await mergeVocabulary(other.id, fresh.id);
        await notify(other.id);
        return other;
      }
      fresh.lemma = newLemma;
    }
    await db.put('vocabulary', fresh);
    await notify(fresh.id);
    return fresh;
  } catch (err) {
    const fresh = (await db.get('vocabulary', vocab.id)) || vocab;
    fresh.enrichmentAttempts = (fresh.enrichmentAttempts || 0) + 1;
    fresh.enrichmentError = err.message;
    if (err.code === 'NO_KEY') {
      fresh.enrichmentStatus = 'pending';
      fresh.enrichmentAttempts -= 1;
    } else if (err.status === 429 || err.status === 503) {
      fresh.enrichmentStatus = 'pending';
      pausedUntil = Date.now() + 60 * 1000;
    } else if (fresh.enrichmentAttempts >= MAX_ATTEMPTS) {
      fresh.enrichmentStatus = 'failed';
    } else {
      fresh.enrichmentStatus = 'pending';
    }
    fresh.updatedAt = Date.now();
    await db.put('vocabulary', fresh);
    await notify(fresh.id);
    throw err;
  }
}

async function notify(vocabularyId) {
  try { await chrome.runtime.sendMessage({ type: 'VOCABULARY_CHANGED', vocabularyId }); } catch (_) { /* no listener */ }
  updateBadge().catch(() => {});
}

export async function processQueue({ max = 25 } = {}) {
  if (running) return { skipped: 'running' };
  if (Date.now() < pausedUntil) return { skipped: 'paused' };
  running = true;
  try {
    const settings = await getSettings();
    if (!settings.autoEnrich) return { skipped: 'disabled' };
    if (settings.backendUrl && settings.serverEnrich !== false) return { skipped: 'server' };
    if (!settings.geminiApiKey) return { skipped: 'no-key' };

    // reset items stuck in "processing" (service worker was killed mid-request)
    const stuck = await db.getAllByIndex('vocabulary', 'enrichmentStatus', 'processing');
    for (const v of stuck) {
      if (Date.now() - v.updatedAt > STALE_PROCESSING_MS) {
        v.enrichmentStatus = 'pending';
        await db.put('vocabulary', v);
      }
    }
    const pending = (await db.getAllByIndex('vocabulary', 'enrichmentStatus', 'pending')).sort((a, b) => a.createdAt - b.createdAt);
    let done = 0;
    let failed = 0;
    for (const v of pending.slice(0, max)) {
      try {
        await enrichOne(v.id, settings);
        done += 1;
      } catch (err) {
        failed += 1;
        if (err.code === 'NO_KEY' || err.status === 429 || err.status === 503 || err.status === 401 || err.status === 403) break;
      }
    }
    return { done, failed, remaining: Math.max(0, pending.length - done - failed) };
  } finally {
    running = false;
  }
}

export async function testGemini({ apiKey, model }) {
  const data = await callGemini({ apiKey, model }, 'Reply with JSON {"ok": true, "model": "<your model name>"}.', {
    schema: { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' }, model: { type: 'STRING' } }, required: ['ok'] },
  });
  return data;
}
