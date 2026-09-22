// Pure helpers for the exercises: answer checking, a small diff, and building multiple-choice options.
// No React and no browser APIs in here, so scripts/test-study-logic.mjs can run it under node.
import type { CardContent, Vocabulary } from '../types';

// Case, width (NFKC), katakana/hiragana and punctuation do not matter; the letters themselves do.
export function norm(s: string): string {
  return s.normalize('NFKC').toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/[\s'’‘`´.,!?;:"“”()[\]{}\-‐–—_/、。・「」]+/g, ' ')
    .trim();
}

export type AnswerKind = 'write' | 'context' | 'listen';

// write:   the prompt is the meaning, so any known form of the word proves recall.
// context: the prompt is the sentence with a gap, and the gap has exactly one right filler.
// listen:  only what was actually spoken, which is the dictionary form (or its reading).
export function acceptedAnswers(card: CardContent, kind: AnswerKind = 'write'): string[] {
  if (kind === 'context') {
    const gap = card.front.answer || card.surface || card.lemma;
    // the kana fills the gap only when the sentence used the dictionary form
    const reading = card.language === 'ja' && norm(gap) === norm(card.lemma) ? card.reading : '';
    return [...new Set([gap, reading].filter(Boolean))];
  }
  const raw = kind === 'listen' ? [card.lemma, card.language === 'ja' ? card.reading : ''] : [card.lemma, card.front.answer, card.surface, card.language === 'ja' ? card.reading : ''];
  return [...new Set(raw.filter(Boolean))];
}

export function isCorrect(card: CardContent, value: string, kind: AnswerKind = 'write'): boolean {
  const v = norm(value);
  return !!v && acceptedAnswers(card, kind).some((a) => norm(a) === v);
}

export interface DiffPart { text: string; ok: boolean }

function lcsFlags(a: string[], b: string[]): { a: boolean[]; b: boolean[] } {
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const fa = new Array<boolean>(n).fill(false), fb = new Array<boolean>(m).fill(false);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { fa[i] = true; fb[j] = true; i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  return { a: fa, b: fb };
}

function toParts(chars: string[], flags: boolean[]): DiffPart[] {
  const parts: DiffPart[] = [];
  chars.forEach((ch, k) => {
    const last = parts[parts.length - 1];
    if (last && last.ok === flags[k]) last.text += ch; else parts.push({ text: ch, ok: flags[k] });
  });
  return parts;
}

// Character diff for "Your answer" / "Correct answer". Compared without case, shown as typed.
export function diffAnswer(given: string, expected: string): { given: DiffPart[]; expected: DiffPart[]; common: number } {
  const g = Array.from(given.trim()), e = Array.from(expected);
  const flags = lcsFlags(g.map((c) => c.toLowerCase()), e.map((c) => c.toLowerCase()));
  return { given: toParts(g, flags.a), expected: toParts(e, flags.b), common: flags.a.filter(Boolean).length };
}

// Of the accepted forms, show the one closest to what was typed ("contemplatin" -> "contemplating", not "contemplate").
export function closestAnswer(card: CardContent, given: string, kind: AnswerKind = 'write'): string {
  const options = acceptedAnswers(card, kind).filter((a) => card.language !== 'ja' || a !== card.reading || /^[぀-ヿ\s]+$/.test(given.trim()));
  let best = options[0] || card.lemma, bestScore = -1;
  for (const o of options) {
    const score = diffAnswer(given, o).common - Math.abs(Array.from(o).length - Array.from(given.trim()).length) * 0.01;
    if (score > bestScore) { best = o; bestScore = score; }
  }
  return given.trim() ? best : options[0] || card.lemma;   // "I don't know" must show what this exercise accepts
}

export function cardMeaning(card: CardContent): string {
  const b = card.back;
  return b.meaning || b.meaningVi || b.definitionEn || b.quickDict[0]?.terms.slice(0, 3).join(', ') || '';
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Hide the word inside a definition or hint so the prompt does not contain its own answer.
export function maskWord(text: string, card: CardContent): string {
  let out = text;
  for (const w of [card.front.answer, card.surface, card.lemma].filter((x) => x && x.length > 1).sort((a, b) => b.length - a.length)) out = out.replace(new RegExp(escapeRe(w), 'gi'), '_____');
  return out;
}

// Split a sentence around the saved word so it can be highlighted.
export function splitAround(sentence: string, word: string): [string, string, string] | null {
  if (!sentence || !word) return null;
  const i = sentence.toLowerCase().indexOf(word.toLowerCase());
  return i < 0 ? null : [sentence.slice(0, i), sentence.slice(i, i + word.length), sentence.slice(i + word.length)];
}

export interface Distractor { lemma: string; meaning: string; language: string; pos: string }
export const toDistractor = (c: CardContent): Distractor => ({ lemma: c.lemma, meaning: cardMeaning(c), language: c.language, pos: c.back.partOfSpeech || '' });
export const vocabToDistractor = (v: Vocabulary): Distractor => ({ lemma: v.lemma, language: v.language, pos: v.enrichment?.partOfSpeech || '',
  meaning: v.userMeaning || v.enrichment?.meaningInContext || v.enrichment?.meaningVi || v.quickMeaning || '' });

export type Rand = () => number;
export function shuffle<T>(items: T[], rand: Rand = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Options for one question. `what` says what the options are: words (dictionary forms) or meanings.
// Wrong options come from the same language, never repeat, and prefer the same part of speech.
export function buildChoices(card: CardContent, pool: Distractor[], what: 'word' | 'meaning', rand: Rand = Math.random, count = 4): string[] {
  const right = what === 'word' ? card.lemma : cardMeaning(card);
  if (!right) return [];
  const seen = new Set([norm(right)]);
  const pos = (card.back.partOfSpeech || '').toLowerCase();
  const candidates: Array<{ text: string; samePos: boolean }> = [];
  for (const d of shuffle(pool, rand)) {
    if (d.language !== card.language || norm(d.lemma) === norm(card.lemma)) continue;
    const text = what === 'word' ? d.lemma : d.meaning;
    if (!text || seen.has(norm(text))) continue;
    seen.add(norm(text));
    candidates.push({ text, samePos: !!pos && d.pos.toLowerCase() === pos });
  }
  const wrong = [...candidates.filter((c) => c.samePos), ...candidates.filter((c) => !c.samePos)].slice(0, count - 1).map((c) => c.text);
  return shuffle([right, ...wrong], rand);
}

export function distinctLemmas(pool: Distractor[], language: string): number {
  return new Set(pool.filter((d) => d.language === language).map((d) => norm(d.lemma))).size;
}

// Cards usable in a Match game: a word and a meaning, neither repeated on the board.
export function pickMatchCards(cards: CardContent[], size = 6, rand: Rand = Math.random): CardContent[] {
  const words = new Set<string>(), meanings = new Set<string>();
  const out: CardContent[] = [];
  for (const c of shuffle(cards, rand)) {
    const m = norm(cardMeaning(c)), w = `${c.language}:${norm(c.lemma)}`;
    if (!m || words.has(w) || meanings.has(m)) continue;
    words.add(w); meanings.add(m); out.push(c);
    if (out.length === size) break;
  }
  return out;
}
