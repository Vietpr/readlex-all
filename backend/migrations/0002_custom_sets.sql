-- User-created sets and a user-editable meaning. A set is only a grouping: words keep their single FSRS card.
CREATE TABLE IF NOT EXISTS custom_sets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS custom_sets_user ON custom_sets(user_id, updated_at);

CREATE TABLE IF NOT EXISTS custom_set_items (
  set_id TEXT NOT NULL REFERENCES custom_sets(id) ON DELETE CASCADE,
  vocabulary_id TEXT NOT NULL REFERENCES vocabulary(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (set_id, vocabulary_id)
);
CREATE INDEX IF NOT EXISTS custom_set_items_vocab ON custom_set_items(vocabulary_id);

ALTER TABLE vocabulary ADD COLUMN user_meaning TEXT;
