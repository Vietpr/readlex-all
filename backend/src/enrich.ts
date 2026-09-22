// Gemini enrichment (server side). Same prompts and JSON schema as the extension's enrich.js,
// so cards look identical whether a word was enriched locally or on the server.
import type { Enrichment, Env, Exposure, Vocabulary } from './types';

const MAX_ATTEMPTS = 5;

const SCHEMA = {
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
const SCHEMA_JA = {
  ...SCHEMA,
  required: ['lemma', 'reading', 'partOfSpeech', 'meaningVi', 'meaningInContext', 'level', 'collocations', 'example', 'exampleVi', 'learningPriority', 'isProperNoun'],
};

function promptEn(v: Vocabulary, exposures: Exposure[]): string {
  const primary = exposures[0];
  const others = exposures.slice(1, 4).map((e) => `- ${e.sentence}`).join('\n');
  const inContext = !!primary?.sentence;
  return [
    'You are an English vocabulary tutor for a Vietnamese learner who reads English news and articles.',
    inContext ? 'Analyze the target word or phrase AS IT IS USED in the given sentence and return JSON only.'
      : 'The learner typed this word in by hand, so there is no sentence. Explain the word itself and return JSON only.',
    '',
    `Target: "${v.surface}"`,
    v.lemma !== v.surface.toLowerCase() ? `Guessed base form: "${v.lemma}"` : '',
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
    inContext ? '- meaningInContext: the Vietnamese meaning exactly as used in the sentence.'
      : '- meaningInContext: the single most useful everyday Vietnamese meaning. There is no sentence, so do NOT invent one.',
    inContext ? '- sentenceVi: natural Vietnamese translation of the sentence.' : '- sentenceVi: empty string (there is no sentence).',
    '- definitionEn: short learner-friendly English definition (one sentence).',
    '- cefr: CEFR level of this sense.',
    '- collocations: 3 to 6 common collocations containing the lemma.',
    inContext ? '- example: ONE new natural example sentence (not the given one), 8-18 words.' : '- example: ONE natural example sentence using the word, 8-18 words.',
    '- exampleVi: Vietnamese translation of that example.',
    '- synonyms: up to 4 near-synonyms (empty array if none).',
    '- wordFamily: related forms (e.g. sustain, sustainable, sustainability), empty if none.',
    '- notes: 2-3 short sentences IN ENGLISH about USING the word: when it is used (register, what it goes with), when it is NOT used or which near-synonym learners wrongly swap it with. No Vietnamese here. Empty string only if there is genuinely nothing useful.',
    '- learningPriority: 1-5 how worth learning for a general adult reader (5 = very useful everyday/news word, 1 = too rare, technical, or a proper noun).',
    '- isProperNoun: true if the target is a name of a person, place, organisation, product.',
  ].filter(Boolean).join('\n');
}

function promptJa(v: Vocabulary, exposures: Exposure[]): string {
  const primary = exposures[0];
  const others = exposures.slice(1, 4).map((e) => `- ${e.sentence}`).join('\n');
  const inContext = !!primary?.sentence;
  return [
    'You are a Japanese vocabulary tutor for a Vietnamese learner who reads Japanese news and articles.',
    inContext ? 'Analyze the target word AS IT IS USED in the given sentence and return JSON only.'
      : 'The learner typed this word in by hand, so there is no sentence. Explain the word itself and return JSON only.',
    '',
    `Target (as found in text): "${v.surface}"`,
    v.lemma !== v.surface ? `Dictionary form guess: "${v.lemma}"` : '',
    v.reading ? `Reading guess: "${v.reading}"` : '',
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
    inContext ? '- meaningInContext: the Vietnamese meaning exactly as used in the sentence.'
      : '- meaningInContext: the single most useful everyday Vietnamese meaning. There is no sentence, so do NOT invent one.',
    inContext ? '- sentenceVi: natural Vietnamese translation of the sentence.' : '- sentenceVi: empty string (there is no sentence).',
    '- definitionEn: short English gloss (a few words).',
    '- level: JLPT level of this word: one of N5, N4, N3, N2, N1.',
    '- cefr: leave empty string.',
    '- ipa: leave empty string.',
    '- collocations: 3 to 6 common combinations containing the lemma, e.g. "本を買う", "切符を買う".',
    inContext ? '- example: ONE new natural Japanese example sentence (not the given one), 8-25 characters, plain form.'
      : '- example: ONE natural Japanese example sentence using the word, 8-25 characters, plain form.',
    '- exampleVi: Vietnamese translation of that example.',
    '- synonyms: up to 4 near-synonyms in Japanese (empty array if none).',
    '- wordFamily: related words sharing a kanji or stem, e.g. 買い物, 売買 (empty if none).',
    '- notes: 1-2 short sentences IN VIETNAMESE: Hán Việt reading of the kanji (e.g. 買 = MÃI), usage, register, confusions. Empty string if nothing useful.',
    '- learningPriority: 1-5 how worth learning for a general adult reader of Japanese news (5 = very common, 1 = rare / proper noun).',
    '- isProperNoun: true if the target is a name of a person, place, organisation, product.',
  ].filter(Boolean).join('\n');
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

// Filling in the meaning while the learner types a set: several words, one call, no context sentences.
const DEFINE_ITEM = {
  type: 'OBJECT',
  properties: {
    term: { type: 'STRING' },
    lemma: { type: 'STRING' },
    reading: { type: 'STRING' },
    ipa: { type: 'STRING' },
    partOfSpeech: { type: 'STRING' },
    meaningVi: { type: 'STRING' },
    definitionEn: { type: 'STRING' },
    usage: { type: 'STRING' },
    notUsed: { type: 'STRING' },
    example: { type: 'STRING' },
    exampleVi: { type: 'STRING' },
    level: { type: 'STRING' },
    unknown: { type: 'BOOLEAN' },
  },
  required: ['term', 'lemma', 'meaningVi', 'unknown'],
};
const DEFINE_SCHEMA = { type: 'OBJECT', properties: { items: { type: 'ARRAY', items: DEFINE_ITEM } }, required: ['items'] };

export interface Definition { term: string; lemma: string; reading: string; ipa: string; partOfSpeech: string; meaningVi: string; definitionEn: string; usage: string; notUsed: string; example: string; exampleVi: string; level: string; unknown: boolean }

function promptDefine(language: string, terms: string[]): string {
  const ja = language === 'ja';
  return [
    `You are a ${ja ? 'Japanese' : 'English'} vocabulary tutor for a Vietnamese learner.`,
    'The learner is typing these words into a flashcard set by hand, so there is no context sentence.',
    'Return JSON only: an "items" array with exactly ONE object per word, in the SAME ORDER as the list below.',
    '',
    'Words to define:',
    ...terms.map((t, i) => `${i + 1}. "${t}"`),
    '',
    'Field rules for each item:',
    '- term: the word exactly as it was given above, unchanged.',
    ja ? '- lemma: dictionary form (辞書形), e.g. 買いました -> 買う.' : '- lemma: dictionary base form, lowercase (verbs -> infinitive, nouns -> singular). For a phrase, the canonical phrase.',
    ja ? '- reading: reading of the lemma in hiragana (katakana for loanwords).' : '- reading: empty string.',
    ja ? '- ipa: empty string.' : '- ipa: IPA of the lemma, e.g. /səˈsteɪn/ (empty string for phrases if unnatural).',
    ja ? '- partOfSpeech: in Vietnamese, e.g. "động từ nhóm 1", "danh từ", "tính từ な".' : '- partOfSpeech: noun, verb, adjective, adverb, phrasal verb, idiom, preposition, ...',
    '- meaningVi: the Vietnamese meaning the learner needs, max ~12 words, most common sense first, senses separated by ";". This goes straight onto a flashcard, so keep it short and natural.',
    ja ? '- definitionEn: short English gloss (a few words).' : '- definitionEn: learner-friendly English definition, one sentence, covering the main sense(s).',
    ja ? '- usage: 1-2 sentences IN VIETNAMESE on when this word is used — register, typical subjects/objects, the situations it fits.'
      : '- usage: 1-2 sentences IN ENGLISH on WHEN this word is used — register (formal/neutral/informal), what it typically goes with, the situations it fits.',
    ja ? '- notUsed: 1 sentence IN VIETNAMESE on when NOT to use it, or the word learners confuse it with. Empty string if there is nothing worth saying.'
      : '- notUsed: 1 sentence IN ENGLISH on when NOT to use it, or the near-synonym learners wrongly swap it with. Empty string if there is nothing worth saying.',
    ja ? '- example: ONE natural Japanese example sentence using the word, 8-25 characters, plain form.' : '- example: ONE natural example sentence that shows that usage, 8-18 words.',
    '- exampleVi: Vietnamese translation of that example.',
    ja ? '- level: JLPT level of the word: one of N5, N4, N3, N2, N1.' : '- level: CEFR level of the word: one of A1, A2, B1, B2, C1, C2.',
    '- unknown: true only if this is not a real word (a typo or random letters); then leave meaningVi empty.',
  ].join('\n');
}

// One Gemini call for up to a handful of words; the order of `terms` is preserved, missing answers become `unknown`.
export async function defineTerms(env: Env, creds: GeminiCredentials, language: string, terms: string[]): Promise<Definition[]> {
  const raw = await callGemini(env, creds, promptDefine(language, terms), DEFINE_SCHEMA, { maxOutputTokens: 1024 + terms.length * 400 });
  const items = Array.isArray(raw.items) ? (raw.items as Array<Record<string, unknown>>) : [];
  const byTerm = new Map<string, Record<string, unknown>>();
  for (const it of items) { const t = str(it.term).toLowerCase(); if (t && !byTerm.has(t)) byTerm.set(t, it); }
  const alignedByPosition = items.length === terms.length;
  return terms.map((term, i) => {
    const it = byTerm.get(term.toLowerCase()) || (alignedByPosition ? items[i] : {}) || {};
    const meaningVi = str(it.meaningVi);
    return {
      term,
      lemma: str(it.lemma) || term,
      reading: str(it.reading),
      ipa: str(it.ipa),
      partOfSpeech: str(it.partOfSpeech),
      meaningVi,
      definitionEn: str(it.definitionEn),
      usage: str(it.usage),
      notUsed: str(it.notUsed),
      example: str(it.example),
      exampleVi: str(it.exampleVi),
      level: str(it.level),
      unknown: !meaningVi || it.unknown === true,
    };
  });
}

export class GeminiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface GeminiCredentials { apiKey: string; model: string }

export const DEFAULT_MODEL = 'gemini-2.5-flash';
const TIMEOUT_MS = 45000;
// "This model is currently experiencing high demand" (503) and rate limits (429) are normal on the
// free tier and usually clear within a second or two, so answer them with patience, not an error.
const RETRY_AFTER_MS = [700, 1600];
const busy = (status: number) => status === 503 || status === 429;

export async function callGemini(env: Env, creds: GeminiCredentials, prompt: string, schema: unknown, { maxOutputTokens = 4096 } = {}): Promise<Record<string, unknown>> {
  if (env.GEMINI_MOCK === '1') return mockAnswer(prompt);
  if (!creds.apiKey) throw new GeminiError(0, 'No Gemini API key on this account yet');
  const model = creds.model || DEFAULT_MODEL;
  const base: Record<string, unknown> = { temperature: 0.2, responseMimeType: 'application/json', responseSchema: schema, maxOutputTokens };
  // 2.5 models think before answering and the thoughts come out of the same output budget; our answer
  // is a small JSON object, so thinking only risks an empty candidate (finishReason MAX_TOKENS).
  const thinking = /2\.5-flash/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {};

  // the timer covers reading the body too: a stalled response must not hang the whole enrichment run
  const send = async (generationConfig: Record<string, unknown>) => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': creds.apiKey },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig }),
        signal: abort.signal,
      });
      return { ok: res.ok, status: res.status, body: await res.text() };
    } catch (err) {
      throw new GeminiError(0, abort.signal.aborted ? 'Gemini took too long to answer' : `Could not reach Gemini: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  };
  const errorOf = (body: string) => { try { return (JSON.parse(body) as { error?: { message?: string } }).error?.message || body.slice(0, 300); } catch { return body.slice(0, 300); } };

  let res = await send({ ...base, ...thinking });
  // A model that does not know thinkingConfig rejects the whole request; ask again the plain way
  // rather than failing every word on this account.
  if (!res.ok && res.status === 400 && Object.keys(thinking).length && /thinking|generation_?config/i.test(errorOf(res.body))) res = await send(base);
  for (const wait of RETRY_AFTER_MS) {
    if (!busy(res.status)) break;
    await new Promise((r) => setTimeout(r, wait));
    res = await send({ ...base, ...thinking });
  }
  if (!res.ok) {
    throw new GeminiError(res.status, busy(res.status)
      ? `${model} is busy right now (HTTP ${res.status}). Try again in a moment, or pick another model in Settings.`
      : `Gemini HTTP ${res.status}: ${errorOf(res.body)}`);
  }
  const text = res.body;
  const json = JSON.parse(text) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }> };
  const out = (json.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  if (!out) throw new GeminiError(502, `Gemini returned no content (${json.candidates?.[0]?.finishReason || 'empty'})`);
  try {
    return JSON.parse(out);
  } catch {
    const m = out.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new GeminiError(502, "Could not parse Gemini's JSON answer");
  }
}

function mockAnswer(prompt: string): Record<string, unknown> {
  const wanted = prompt.match(/^\d+\. "(.+)"$/gm);
  if (/Words to define:/.test(prompt) && wanted) {
    const ja = /Japanese vocabulary tutor/.test(prompt);
    return { items: wanted.map((line) => {
      const term = line.replace(/^\d+\. "/, '').replace(/"$/, '');
      const unknown = /^x{3,}$/i.test(term);
      return { term, lemma: term.toLowerCase(), reading: ja ? 'よみ' : '', ipa: ja ? '' : '/mɒk/', partOfSpeech: ja ? 'danh từ' : 'noun',
        meaningVi: unknown ? '' : `nghĩa mock của ${term}`, definitionEn: 'mock definition', usage: `Mock usage note for ${term}.`,
        notUsed: unknown ? '' : `Do not use ${term} for the mock case.`, example: `A mock sentence with ${term}.`,
        exampleVi: 'Ví dụ mock.', level: ja ? 'N3' : 'B1', unknown };
    }) };
  }
  const target = (prompt.match(/Target[^:]*: "([^"]+)"/) || [])[1] || 'word';
  const guess = (prompt.match(/(?:Guessed base form|Dictionary form guess): "([^"]+)"/) || [])[1];
  const ja = /Japanese vocabulary tutor/.test(prompt);
  return {
    lemma: guess || target, reading: ja ? 'よみ' : '', partOfSpeech: ja ? 'động từ' : 'verb', ipa: ja ? '' : '/mɒk/',
    meaningVi: 'nghĩa mock', meaningInContext: `nghĩa mock trong câu (${guess || target})`, sentenceVi: 'Câu dịch mock.', definitionEn: 'mock definition',
    cefr: ja ? '' : 'B2', level: ja ? 'N3' : '', collocations: [`${guess || target} growth`], example: 'Mock example sentence.', exampleVi: 'Ví dụ mock.',
    synonyms: [], wordFamily: [], notes: ja ? 'Ghi chú mock.' : 'Mock usage note: use it in the mock case, not the other one.', learningPriority: 4, isProperNoun: false,
  };
}

const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean).slice(0, 8) : []);

export function sanitize(raw: Record<string, unknown>, ja: boolean): Enrichment {
  const pri = Number(raw.learningPriority);
  return {
    lemma: ja ? str(raw.lemma) : str(raw.lemma).toLowerCase(),
    reading: str(raw.reading),
    level: str(raw.level),
    partOfSpeech: str(raw.partOfSpeech),
    ipa: str(raw.ipa),
    meaningVi: str(raw.meaningVi),
    meaningInContext: str(raw.meaningInContext),
    sentenceVi: str(raw.sentenceVi),
    definitionEn: str(raw.definitionEn),
    cefr: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(str(raw.cefr)) ? str(raw.cefr) : '',
    collocations: arr(raw.collocations),
    example: str(raw.example),
    exampleVi: str(raw.exampleVi),
    synonyms: arr(raw.synonyms),
    wordFamily: arr(raw.wordFamily),
    notes: str(raw.notes),
    learningPriority: Number.isFinite(pri) ? Math.min(5, Math.max(1, Math.round(pri))) : 3,
    isProperNoun: !!raw.isProperNoun,
  };
}

// Returns the enrichment or throws; the caller persists status/attempts.
export async function enrichVocabulary(env: Env, creds: GeminiCredentials, v: Vocabulary, exposures: Exposure[]): Promise<Enrichment> {
  const ja = v.language === 'ja';
  const raw = await callGemini(env, creds, ja ? promptJa(v, exposures) : promptEn(v, exposures), ja ? SCHEMA_JA : SCHEMA);
  const data = sanitize(raw, ja);
  return { ...data, model: env.GEMINI_MOCK === '1' ? 'mock' : creds.model || DEFAULT_MODEL, enrichedAt: Date.now() };
}

// Quick check used when a user saves a key.
export async function testGemini(env: Env, creds: GeminiCredentials): Promise<boolean> {
  const data = await callGemini(env, creds, 'Reply with JSON {"ok": true}.', { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] });
  return env.GEMINI_MOCK === '1' ? true : data.ok === true;
}

export { MAX_ATTEMPTS };
