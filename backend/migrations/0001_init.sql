-- ReadLex schema (multi-user). Mirrors the extension's model (docs/PLAN.md) plus users, sessions, FSRS cards and reviews.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  gemini_key_enc TEXT,                       -- AES-GCM encrypted, never returned to clients
  gemini_model TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
  settings TEXT NOT NULL DEFAULT '{}',
  role TEXT NOT NULL DEFAULT 'user',         -- user | admin
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'web',          -- web | extension
  label TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS vocabulary (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  language TEXT NOT NULL DEFAULT 'en',
  kind TEXT NOT NULL DEFAULT 'word',
  lemma TEXT NOT NULL,
  surface TEXT NOT NULL,
  reading TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  quick_meaning TEXT,
  quick_dict TEXT NOT NULL DEFAULT '[]',
  ipa TEXT,
  audio TEXT,
  enrichment TEXT,
  enrichment_status TEXT NOT NULL DEFAULT 'pending',
  enrichment_error TEXT,
  enrichment_attempts INTEGER NOT NULL DEFAULT 0,
  exposure_count INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS vocabulary_user_lang_lemma ON vocabulary(user_id, language, lemma);
CREATE INDEX IF NOT EXISTS vocabulary_user_created ON vocabulary(user_id, created_at);
CREATE INDEX IF NOT EXISTS vocabulary_enrichment ON vocabulary(enrichment_status);

CREATE TABLE IF NOT EXISTS exposures (
  id TEXT PRIMARY KEY,
  vocabulary_id TEXT NOT NULL REFERENCES vocabulary(id) ON DELETE CASCADE,
  surface TEXT NOT NULL DEFAULT '',
  sentence TEXT NOT NULL DEFAULT '',
  paragraph TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  page_title TEXT NOT NULL DEFAULT '',
  encountered_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS exposures_vocab ON exposures(vocabulary_id);

CREATE TABLE IF NOT EXISTS lookups (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  lemma TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  surfaces TEXT NOT NULL DEFAULT '[]',
  sites TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (user_id, language, lemma)
);

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vocabulary_id TEXT NOT NULL UNIQUE REFERENCES vocabulary(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'cloze',
  state INTEGER NOT NULL DEFAULT 0,
  due INTEGER NOT NULL,
  stability REAL NOT NULL DEFAULT 0,
  difficulty REAL NOT NULL DEFAULT 0,
  elapsed_days INTEGER NOT NULL DEFAULT 0,
  scheduled_days INTEGER NOT NULL DEFAULT 0,
  learning_steps INTEGER NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  last_review INTEGER,
  suspended INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cards_user_due ON cards(user_id, due);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  vocabulary_id TEXT NOT NULL,
  rating INTEGER NOT NULL,
  state_before INTEGER NOT NULL,
  due_before INTEGER,
  stability REAL NOT NULL,
  difficulty REAL NOT NULL,
  elapsed_days INTEGER NOT NULL,
  scheduled_days INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  reviewed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS reviews_user_time ON reviews(user_id, reviewed_at);
CREATE INDEX IF NOT EXISTS reviews_card ON reviews(card_id);

CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  op TEXT NOT NULL,
  client_created_at INTEGER,
  received_at INTEGER NOT NULL,
  vocabulary_id TEXT,
  result TEXT
);

CREATE TABLE IF NOT EXISTS rate_events (
  key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_events_key ON rate_events(key, created_at);

CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
