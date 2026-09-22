-- A rating is queued on the device with its own id, so a retry after a lost response (or a second
-- tab flushing the same queue) must not apply FSRS twice. NULLs are ignored by a SQLite unique
-- index, so rows written before this migration are unaffected.
ALTER TABLE reviews ADD COLUMN client_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS reviews_user_client ON reviews(user_id, client_id) WHERE client_id IS NOT NULL;
