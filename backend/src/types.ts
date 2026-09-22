export type Env = {
  DB: D1Database;
  ENCRYPTION_KEY?: string;     // secret: encrypts users' Gemini keys at rest
  SIGNUP_MODE?: string;        // open | invite | closed  (default open)
  INVITE_CODE?: string;        // required when SIGNUP_MODE=invite
  GEMINI_MOCK?: string;        // "1" = fake Gemini (tests / local dev)
  ALLOWED_ORIGINS?: string;
  RESEND_API_KEY?: string;     // secret: password-reset emails via Resend
  MAIL_FROM?: string;          // e.g. "ReadLex <no-reply@your-domain.com>"
  WEB_URL?: string;            // e.g. https://user.github.io/readlex/  (used in reset links)
};

export interface UserRow {
  id: string; email: string; password_hash: string; password_salt: string; display_name: string;
  gemini_key_enc: string | null; gemini_model: string; settings: string; role: string; created_at: number; updated_at: number;
}
export interface SessionRow { id: string; user_id: string; token_hash: string; kind: string; label: string; created_at: number; last_used_at: number; expires_at: number }
export interface AuthUser { id: string; email: string; displayName: string; role: string; geminiModel: string; hasGeminiKey: boolean; settings: Record<string, unknown>; createdAt: number }

export function rowToUser(r: UserRow): AuthUser {
  return { id: r.id, email: r.email, displayName: r.display_name, role: r.role, geminiModel: r.gemini_model, hasGeminiKey: !!r.gemini_key_enc, settings: safeJson(r.settings, {}), createdAt: r.created_at };
}

export type Language = 'en' | 'ja';

export interface Enrichment {
  lemma: string;
  reading: string;
  level: string;
  partOfSpeech: string;
  ipa: string;
  meaningVi: string;
  meaningInContext: string;
  sentenceVi: string;
  definitionEn: string;
  cefr: string;
  collocations: string[];
  example: string;
  exampleVi: string;
  synonyms: string[];
  wordFamily: string[];
  notes: string;
  learningPriority: number;
  isProperNoun: boolean;
  model?: string;
  enrichedAt?: number;
}

export interface VocabularyRow {
  id: string;
  user_id: string;
  language: Language;
  kind: string;
  lemma: string;
  surface: string;
  reading: string;
  status: string;
  quick_meaning: string | null;
  quick_dict: string;
  ipa: string | null;
  audio: string | null;
  enrichment: string | null;
  enrichment_status: string;
  enrichment_error: string | null;
  enrichment_attempts: number;
  exposure_count: number;
  note: string | null;
  user_meaning: string | null;
  created_at: number;
  updated_at: number;
}

export interface ExposureRow {
  id: string;
  vocabulary_id: string;
  surface: string;
  sentence: string;
  paragraph: string;
  url: string;
  page_title: string;
  encountered_at: number;
}

export interface CardRow {
  id: string;
  user_id: string;
  vocabulary_id: string;
  type: string;
  state: number;
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  last_review: number | null;
  suspended: number;
  created_at: number;
  updated_at: number;
}

// Shape used by the extension and the web app (camelCase, JSON columns parsed).
export interface Vocabulary {
  id: string;
  language: Language;
  kind: string;
  lemma: string;
  surface: string;
  reading: string;
  status: string;
  quickMeaning: string | null;
  quickDict: Array<{ pos: string; terms: string[] }>;
  ipa: string | null;
  audio: string | null;
  enrichment: Enrichment | null;
  enrichmentStatus: string;
  enrichmentError: string | null;
  enrichmentAttempts: number;
  exposureCount: number;
  note: string | null;
  userMeaning: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Exposure {
  id: string;
  vocabularyId: string;
  surface: string;
  sentence: string;
  paragraph: string;
  url: string;
  pageTitle: string;
  encounteredAt: number;
}

export function rowToVocabulary(r: VocabularyRow): Vocabulary {
  return {
    id: r.id,
    language: r.language,
    kind: r.kind,
    lemma: r.lemma,
    surface: r.surface,
    reading: r.reading || '',
    status: r.status,
    quickMeaning: r.quick_meaning,
    quickDict: safeJson(r.quick_dict, []),
    ipa: r.ipa,
    audio: r.audio,
    enrichment: r.enrichment ? safeJson<Enrichment | null>(r.enrichment, null) : null,
    enrichmentStatus: r.enrichment_status,
    enrichmentError: r.enrichment_error,
    enrichmentAttempts: r.enrichment_attempts,
    exposureCount: r.exposure_count,
    note: r.note,
    userMeaning: r.user_meaning ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function rowToExposure(r: ExposureRow): Exposure {
  return {
    id: r.id,
    vocabularyId: r.vocabulary_id,
    surface: r.surface,
    sentence: r.sentence,
    paragraph: r.paragraph,
    url: r.url,
    pageTitle: r.page_title,
    encounteredAt: r.encountered_at,
  };
}

export function safeJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
