// Assemble what a flashcard shows, from vocabulary + exposures + enrichment (nothing is stored twice).
import type { CardRow, Exposure, Vocabulary } from './types';

export function ttsUrl(text: string, lang: string): string {
  return `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(text)}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function clozeSentence(sentence: string, surface: string, lemma: string): { cloze: string; answer: string } | null {
  if (!sentence) return null;
  for (const candidate of [surface, lemma].filter(Boolean)) {
    const re = new RegExp(escapeRegExp(candidate), 'i');
    const m = sentence.match(re);
    if (m && m.index !== undefined) {
      return { cloze: sentence.slice(0, m.index) + '______' + sentence.slice(m.index + m[0].length), answer: m[0] };
    }
  }
  return null;
}

export interface CardContent {
  cardId: string;
  vocabularyId: string;
  language: string;
  lemma: string;
  reading: string;
  surface: string;
  ipa: string | null;
  audio: string;
  status: string;
  enrichmentStatus: string;
  front: { sentence: string; cloze: string | null; answer: string; pageTitle: string; url: string; hint: string };
  back: {
    meaning: string;
    meaningVi: string;
    meaningInContext: string;
    sentenceVi: string;
    definitionEn: string;
    partOfSpeech: string;
    level: string;
    collocations: string[];
    example: string;
    exampleVi: string;
    synonyms: string[];
    wordFamily: string[];
    notes: string;
    learningPriority: number;
    isProperNoun: boolean;
    quickDict: Array<{ pos: string; terms: string[] }>;
  };
  exposureCount: number;
  savedAt: number;
  schedule: { state: number; due: number; reps: number; lapses: number; lastReview: number | null; scheduledDays: number };
  intervals?: Record<string, string>;
}

export function cardContent(v: Vocabulary, exposures: Exposure[], card: CardRow, intervals?: Record<string, string>): CardContent {
  const e = v.enrichment;
  const primary = exposures[0];
  const cloze = primary ? clozeSentence(primary.sentence, primary.surface || v.surface, v.lemma) : null;
  const level = e?.cefr || e?.level || '';
  return {
    cardId: card.id,
    vocabularyId: v.id,
    language: v.language,
    lemma: v.lemma,
    reading: v.reading || e?.reading || '',
    surface: v.surface,
    ipa: v.ipa || e?.ipa || null,
    audio: v.audio || ttsUrl(v.lemma, v.language),
    status: v.status,
    enrichmentStatus: v.enrichmentStatus,
    front: {
      sentence: primary?.sentence || '',
      cloze: cloze ? cloze.cloze : null,
      answer: cloze ? cloze.answer : v.surface,
      pageTitle: primary?.pageTitle || '',
      url: primary?.url || '',
      hint: [e?.partOfSpeech, level].filter(Boolean).join(' · '),
    },
    back: {
      meaning: v.userMeaning || e?.meaningInContext || e?.meaningVi || v.quickMeaning || '',
      meaningVi: e?.meaningVi || '',
      meaningInContext: e?.meaningInContext || '',
      sentenceVi: e?.sentenceVi || '',
      definitionEn: e?.definitionEn || '',
      partOfSpeech: e?.partOfSpeech || '',
      level,
      collocations: e?.collocations || [],
      example: e?.example || '',
      exampleVi: e?.exampleVi || '',
      synonyms: e?.synonyms || [],
      wordFamily: e?.wordFamily || [],
      notes: e?.notes || '',
      learningPriority: e?.learningPriority || 0,
      isProperNoun: !!e?.isProperNoun,
      quickDict: v.quickDict || [],
    },
    exposureCount: v.exposureCount,
    savedAt: v.createdAt,
    schedule: { state: card.state, due: card.due, reps: card.reps, lapses: card.lapses, lastReview: card.last_review, scheduledDays: card.scheduled_days },
    intervals,
  };
}
