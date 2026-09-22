export interface Enrichment {
  lemma: string; reading: string; level: string; partOfSpeech: string; ipa: string; meaningVi: string; meaningInContext: string;
  sentenceVi: string; definitionEn: string; cefr: string; collocations: string[]; example: string; exampleVi: string;
  synonyms: string[]; wordFamily: string[]; notes: string; learningPriority: number; isProperNoun: boolean; model?: string; enrichedAt?: number;
}
export interface Vocabulary {
  id: string; language: 'en' | 'ja'; kind: string; lemma: string; surface: string; reading: string; status: string;
  quickMeaning: string | null; quickDict: Array<{ pos: string; terms: string[] }>; ipa: string | null; audio: string | null;
  enrichment: Enrichment | null; enrichmentStatus: string; enrichmentError: string | null; exposureCount: number; note: string | null; userMeaning: string | null;
  createdAt: number; updatedAt: number;
}
export interface Exposure { id: string; vocabularyId: string; surface: string; sentence: string; paragraph: string; url: string; pageTitle: string; encounteredAt: number }
export interface CardContent {
  cardId: string; vocabularyId: string; language: string; lemma: string; reading: string; surface: string; ipa: string | null; audio: string;
  status: string; enrichmentStatus: string;
  front: { sentence: string; cloze: string | null; answer: string; pageTitle: string; url: string; hint: string };
  back: { meaning: string; meaningVi: string; meaningInContext: string; sentenceVi: string; definitionEn: string; partOfSpeech: string; level: string;
    collocations: string[]; example: string; exampleVi: string; synonyms: string[]; wordFamily: string[]; notes: string; learningPriority: number; isProperNoun: boolean;
    quickDict: Array<{ pos: string; terms: string[] }> };
  exposureCount: number;
  savedAt: number;
  schedule: { state: number; due: number; reps: number; lapses: number; lastReview: number | null; scheduledDays: number };
  intervals?: Record<string, string>;
}
// What POST /api/v1/define returns per word the learner is typing in.
export interface Definition { term: string; lemma: string; reading: string; ipa: string; partOfSpeech: string; meaningVi: string; definitionEn: string; usage: string; notUsed: string; example: string; exampleVi: string; level: string; unknown: boolean }
export interface CustomSet { id: string; name: string; description: string; words: number; studied: number; due: number; containsWord?: number; updated_at?: number }
export interface DailySet { date: string; words: number; studied: number; fresh: number; due: number }
export interface TodayResponse {
  ok: boolean; now: number; today: string; due: CardContent[]; new: CardContent[]; estimatedMinutes: number; hasGeminiKey: boolean;
  counts: { savedToday: number; savedYesterday: number; reviewedToday: number; newTotal: number; dueTotal: number; reviewTotal: number; pendingEnrichment: number };
}
export interface RecallWindow { reviews: number; again: number }
export interface StatsResponse {
  ok: boolean; streak: number; totals: Record<string, number>; perDay: Record<string, { reviews: number; again: number }>; savedPerDay: Record<string, number>; byLevel: Record<string, number>;
  recall: { d7: RecallWindow; d30: RecallWindow; all: RecallWindow };
}
export interface DifficultItem { again: number; reviews: number; lastAgainAt: number; card: CardContent }
export interface ReviewResult { ok: boolean; cardId: string; state: number; due: number; scheduledDays: number; intervals: Record<string, string>; error?: string }
export type Rating = 1 | 2 | 3 | 4;
export const RATING_LABEL: Record<Rating, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };
export const RATING_KEY: Record<Rating, string> = { 1: 'again', 2: 'hard', 3: 'good', 4: 'easy' };
export const RATING_HINT: Record<Rating, string> = { 1: "Didn't know it", 2: 'Recalled with effort', 3: 'Recalled it', 4: 'Knew it instantly' };
export const STATE_LABEL: Record<number, string> = { 0: 'New', 1: 'Learning', 2: 'Review', 3: 'Relearning' };
export const STATUS_LABEL: Record<string, string> = { new: 'New', learning: 'Learning', known: 'Known', ignored: 'Ignored' };
// One card, one FSRS schedule: every mode below is only a different way to look at the same cards.
export type StudyMode = 'learn' | 'flash' | 'write' | 'listen' | 'quiz' | 'context' | 'match' | 'sprint';
export type FlashDirection = 'word' | 'meaning' | 'context';
export const MODE_LABEL: Record<StudyMode, string> = { learn: 'Learn', flash: 'Flashcards', write: 'Write', listen: 'Listen', quiz: 'Quick quiz', context: 'In context', match: 'Match', sprint: 'Recall sprint' };
