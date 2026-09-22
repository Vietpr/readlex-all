// ReadLex API on Cloudflare Workers + D1 (multi-user).
//   POST /api/v1/auth/register|login|logout, GET /auth/me, PUT/DELETE /me/gemini, tokens for the extension
//   POST /api/v1/sync            extension outbox (vocabulary.save / update / delete, lookup.record)
//   POST /api/v1/import          full export JSON from the extension
//   GET  /api/v1/vocabulary      list, GET /vocabulary/:id detail, PATCH, DELETE, POST /:id/enrich
//   GET  /api/v1/today           new + due flashcards with content and interval previews
//   POST /api/v1/reviews         one rating (or {reviews:[...]}) -> FSRS reschedule
//   GET  /api/v1/stats           counts, streak, last 30 days
// Cron (every 15 min): enrich pending words with each user's own Gemini key.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { CardRow, Env, Exposure, ExposureRow, SessionRow, UserRow, Vocabulary, VocabularyRow } from './types';
import { HttpError, rowToExposure, rowToUser, rowToVocabulary } from './types';
import { defineTerms, enrichVocabulary, GeminiError, MAX_ATTEMPTS, testGemini, type GeminiCredentials } from './enrich';
import { cardToPatch, newCardFields, previewIntervals, review } from './scheduler';
import { cardContent } from './content';
import { decryptSecret, encryptSecret, encryptionSource, hashPassword, maskKey, randomToken, sha256Hex, verifyPassword } from './auth';
import { mailConfigured, sendMail } from './mail';

const VERSION = '0.5.0';
const SESSION_DAYS = { web: 60, extension: 365 } as const;
type Ctx = { Bindings: Env; Variables: { user: UserRow; session: SessionRow } };
const app = new Hono<Ctx>();

// ---------- middleware ----------

app.use('*', async (c, next) => {
  const allowed = (c.env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean);
  return cors({
    origin: (origin) => (allowed.includes('*') || allowed.includes(origin) ? origin : ''),
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  })(c, next);
});

const PUBLIC = new Set(['/api/v1/health', '/api/v1/auth/register', '/api/v1/auth/login', '/api/v1/auth/forgot', '/api/v1/auth/reset']);

app.use('/api/*', async (c, next) => {
  if (c.req.method === 'OPTIONS' || PUBLIC.has(c.req.path)) return next();
  const auth = c.req.header('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return c.json({ ok: false, error: 'Not signed in' }, 401);
  const session = await c.env.DB.prepare('SELECT * FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).first<SessionRow>();
  if (!session || session.expires_at < Date.now()) return c.json({ ok: false, error: 'Your session has expired, please sign in again' }, 401);
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(session.user_id).first<UserRow>();
  if (!user) return c.json({ ok: false, error: 'This account no longer exists' }, 401);
  if (Date.now() - session.last_used_at > 60 * 60 * 1000) {
    const days = SESSION_DAYS[session.kind as keyof typeof SESSION_DAYS] || 60;
    c.executionCtx.waitUntil(c.env.DB.prepare('UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE id = ?').bind(Date.now(), Date.now() + days * 86400000, session.id).run());
  }
  c.set('user', user);
  c.set('session', session);
  return next();
});

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ ok: false, error: err.message }, err.status as 400);
  console.error(err);
  return c.json({ ok: false, error: err.message || 'Internal error' }, 500);
});

// ---------- helpers ----------

const now = () => Date.now();
const uuid = () => crypto.randomUUID();
const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
const normalizeEmail = (e: unknown) => String(e || '').trim().toLowerCase();

async function getVocabRow(db: D1Database, userId: string, id: string): Promise<VocabularyRow | null> {
  return db.prepare('SELECT * FROM vocabulary WHERE id = ? AND user_id = ?').bind(id, userId).first<VocabularyRow>();
}
async function findByLemma(db: D1Database, userId: string, language: string, lemma: string): Promise<VocabularyRow | null> {
  return db.prepare('SELECT * FROM vocabulary WHERE user_id = ? AND language = ? AND lemma = ?').bind(userId, language, lemma).first<VocabularyRow>();
}
async function exposuresOf(db: D1Database, vocabularyId: string): Promise<Exposure[]> {
  const { results } = await db.prepare('SELECT * FROM exposures WHERE vocabulary_id = ? ORDER BY encountered_at ASC').bind(vocabularyId).all<ExposureRow>();
  return results.map(rowToExposure);
}
async function cardOf(db: D1Database, vocabularyId: string): Promise<CardRow | null> {
  return db.prepare('SELECT * FROM cards WHERE vocabulary_id = ?').bind(vocabularyId).first<CardRow>();
}
function insertCardStmt(db: D1Database, userId: string, vocabularyId: string, ts: number) {
  const f = newCardFields(ts);
  return db.prepare(`INSERT OR IGNORE INTO cards (id, user_id, vocabulary_id, type, state, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, last_review, suspended, created_at, updated_at)
    VALUES (?, ?, ?, 'cloze', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)`)
    .bind(uuid(), userId, vocabularyId, f.state, f.due, f.stability, f.difficulty, f.elapsed_days, f.scheduled_days, f.learning_steps, f.reps, f.lapses, ts, ts);
}

async function createSession(db: D1Database, userId: string, kind: 'web' | 'extension', label: string) {
  const token = randomToken(32);
  const ts = now();
  const id = uuid();
  await db.prepare('INSERT INTO sessions (id, user_id, token_hash, kind, label, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, userId, await sha256Hex(token), kind, label.slice(0, 80), ts, ts, ts + SESSION_DAYS[kind] * 86400000).run();
  return { id, token, kind, label, expiresAt: ts + SESSION_DAYS[kind] * 86400000 };
}

async function geminiCreds(env: Env, user: UserRow): Promise<GeminiCredentials> {
  if (env.GEMINI_MOCK === '1') return { apiKey: 'mock', model: user.gemini_model };
  if (!user.gemini_key_enc) return { apiKey: '', model: user.gemini_model };
  try {
    return { apiKey: await decryptSecret(env, user.gemini_key_enc), model: user.gemini_model };
  } catch {
    // ENCRYPTION_KEY changed (or the row predates it): the stored key is unreadable for good.
    throw new GeminiError(0, 'Your saved Gemini API key could not be read — please enter it again in Settings');
  }
}

interface IncomingVocabulary {
  id?: string; language?: string; kind?: string; lemma?: string; surface?: string; reading?: string; status?: string;
  quickMeaning?: string | null; quickDict?: unknown; ipa?: string | null; audio?: string | null; enrichment?: unknown;
  enrichmentStatus?: string; exposureCount?: number; note?: string | null; createdAt?: number; updatedAt?: number;
  userMeaning?: string | null;   // typed by the user (web "Add word" / set composer): shown on the card instead of the AI meaning
}
interface IncomingExposure { id?: string; surface?: string; sentence?: string; paragraph?: string; url?: string; pageTitle?: string; encounteredAt?: number }

async function upsertVocabulary(db: D1Database, userId: string, v: IncomingVocabulary, exposure: IncomingExposure | null, ts: number): Promise<{ id: string; created: boolean; exposureAdded: boolean }> {
  const language = v.language === 'ja' ? 'ja' : 'en';
  const surface = String(v.surface || v.lemma || '').trim().slice(0, 200);
  const lemma = String(v.lemma || surface).trim().slice(0, 200);
  if (!lemma) throw new HttpError(400, 'Missing lemma');
  let row = await findByLemma(db, userId, language, lemma);
  let created = false;
  if (!row) {
    const clientId = typeof v.id === 'string' && /^[\w-]{1,64}$/.test(v.id) ? v.id : '';
    const id = clientId && !(await db.prepare('SELECT id FROM vocabulary WHERE id = ?').bind(clientId).first()) ? clientId : uuid();
    const enrichment = v.enrichment && typeof v.enrichment === 'object' ? JSON.stringify(v.enrichment) : null;
    const userMeaning = typeof v.userMeaning === 'string' && v.userMeaning.trim() ? v.userMeaning.trim().slice(0, 300) : null;
    await db.prepare(`INSERT INTO vocabulary (id, user_id, language, kind, lemma, surface, reading, status, quick_meaning, quick_dict, ipa, audio, enrichment, enrichment_status, enrichment_attempts, exposure_count, note, user_meaning, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`)
      .bind(id, userId, language, v.kind || (/\s/.test(surface) ? 'phrase' : 'word'), lemma, surface, v.reading || '', v.status || 'new',
        v.quickMeaning ?? null, JSON.stringify(Array.isArray(v.quickDict) ? v.quickDict : []), v.ipa ?? null, v.audio ?? null,
        enrichment, enrichment ? 'done' : 'pending', v.note ?? null, userMeaning, v.createdAt || ts, ts)
      .run();
    await insertCardStmt(db, userId, id, ts).run();
    row = await getVocabRow(db, userId, id);
    created = true;
  } else {
    if ((!row.quick_meaning && v.quickMeaning) || (!row.ipa && v.ipa) || (!row.reading && v.reading)) {
      await db.prepare("UPDATE vocabulary SET quick_meaning = COALESCE(quick_meaning, ?), ipa = COALESCE(ipa, ?), reading = CASE WHEN reading = '' THEN ? ELSE reading END, updated_at = ? WHERE id = ?")
        .bind(v.quickMeaning ?? null, v.ipa ?? null, v.reading || '', ts, row.id).run();
    }
    if (!row.enrichment && v.enrichment && typeof v.enrichment === 'object') {
      await db.prepare("UPDATE vocabulary SET enrichment = ?, enrichment_status = 'done', updated_at = ? WHERE id = ?").bind(JSON.stringify(v.enrichment), ts, row.id).run();
    }
    if (!row.user_meaning && typeof v.userMeaning === 'string' && v.userMeaning.trim()) {
      await db.prepare('UPDATE vocabulary SET user_meaning = ?, updated_at = ? WHERE id = ?').bind(v.userMeaning.trim().slice(0, 300), ts, row.id).run();
    }
    await insertCardStmt(db, userId, row.id, ts).run();
  }
  if (!row) throw new HttpError(500, 'Could not save the word');

  let exposureAdded = false;
  if (exposure && (exposure.sentence || exposure.url)) {
    const dup = await db.prepare('SELECT id FROM exposures WHERE vocabulary_id = ? AND url = ? AND sentence = ?').bind(row.id, exposure.url || '', exposure.sentence || '').first();
    if (!dup) {
      await db.prepare('INSERT INTO exposures (id, vocabulary_id, surface, sentence, paragraph, url, page_title, encountered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(uuid(), row.id, (exposure.surface || surface).slice(0, 200), (exposure.sentence || '').slice(0, 1000), (exposure.paragraph || '').slice(0, 2000), (exposure.url || '').slice(0, 2000), (exposure.pageTitle || '').slice(0, 300), exposure.encounteredAt || ts)
        .run();
      await db.prepare('UPDATE vocabulary SET exposure_count = (SELECT COUNT(*) FROM exposures WHERE vocabulary_id = ?), updated_at = ? WHERE id = ?').bind(row.id, ts, row.id).run();
      exposureAdded = true;
    }
  }
  return { id: row.id, created, exposureAdded };
}

async function mergeVocabulary(db: D1Database, keepId: string, removeId: string) {
  if (keepId === removeId) return;
  await db.batch([
    db.prepare('UPDATE exposures SET vocabulary_id = ? WHERE vocabulary_id = ?').bind(keepId, removeId),
    db.prepare('UPDATE OR IGNORE custom_set_items SET vocabulary_id = ? WHERE vocabulary_id = ?').bind(keepId, removeId),
    db.prepare('DELETE FROM vocabulary WHERE id = ?').bind(removeId),
    db.prepare('UPDATE vocabulary SET exposure_count = (SELECT COUNT(*) FROM exposures WHERE vocabulary_id = ?), updated_at = ? WHERE id = ?').bind(keepId, now(), keepId),
  ]);
}

// ---------- enrichment ----------

async function enrichOne(env: Env, user: UserRow, id: string, { force = false } = {}): Promise<Vocabulary | null> {
  const db = env.DB;
  const row = await getVocabRow(db, user.id, id);
  if (!row) return null;
  if (!force && row.enrichment_status === 'done') return rowToVocabulary(row);
  // "Regenerate explanation" is also the way out for a word that ran out of attempts
  if (force && row.enrichment_attempts > 0) { await db.prepare('UPDATE vocabulary SET enrichment_attempts = 0 WHERE id = ?').bind(id).run(); row.enrichment_attempts = 0; }
  const creds = await geminiCreds(env, user);
  if (!creds.apiKey) {
    await db.prepare("UPDATE vocabulary SET enrichment_status = 'pending', enrichment_error = 'No Gemini API key on this account yet', updated_at = ? WHERE id = ?").bind(now(), id).run();
    throw new GeminiError(0, 'No Gemini API key on this account yet');
  }
  // claim the row: when the cron and a request race, only one of them calls Gemini
  const claim = await db.prepare("UPDATE vocabulary SET enrichment_status = 'processing', updated_at = ? WHERE id = ? AND enrichment_status != 'processing'").bind(now(), id).run();
  if (!force && claim.meta?.changes === 0) return rowToVocabulary(row);
  const v = rowToVocabulary(row);
  const exposures = await exposuresOf(db, id);
  try {
    const data = await enrichVocabulary(env, creds, v, exposures);
    const isJa = v.language === 'ja';
    const sameScript = isJa ? /[぀-ヿ㐀-䶿一-鿿ー々]/.test(data.lemma) : /^[a-z][a-z'’-]*$/.test(data.lemma);
    const undoesDictionary = isJa && data.lemma === v.surface && v.lemma !== v.surface;
    let lemma = v.lemma;
    if (data.lemma && sameScript && !undoesDictionary && data.lemma !== v.lemma && v.kind === 'word' && !/\s/.test(data.lemma)) {
      const other = await findByLemma(db, user.id, v.language, data.lemma);
      if (!other || other.id === id) {
        lemma = data.lemma;
      } else {
        // merging deletes this row, and its card and reviews cascade with it, so only ever merge a word
        // the learner has never studied. Otherwise keep both words: renaming would collide with `other`.
        const studied = await db.prepare('SELECT reps FROM cards WHERE vocabulary_id = ?').bind(id).first<{ reps: number }>();
        if (!studied || studied.reps === 0) {
          if (!other.enrichment) await db.prepare("UPDATE vocabulary SET enrichment = ?, enrichment_status = 'done', enrichment_error = NULL, updated_at = ? WHERE id = ?").bind(JSON.stringify(data), now(), other.id).run();
          await mergeVocabulary(db, other.id, id);
          return rowToVocabulary((await getVocabRow(db, user.id, other.id))!);
        }
      }
    }
    await db.prepare(`UPDATE vocabulary SET enrichment = ?, enrichment_status = 'done', enrichment_error = NULL, lemma = ?,
        ipa = COALESCE(ipa, NULLIF(?, '')), reading = CASE WHEN reading = '' THEN ? ELSE reading END, updated_at = ? WHERE id = ?`)
      .bind(JSON.stringify(data), lemma, data.ipa || '', data.reading || '', now(), id).run();
    return rowToVocabulary((await getVocabRow(db, user.id, id))!);
  } catch (err) {
    // A rate limit or an unreachable Gemini is the account's problem, not the word's: it does not burn an attempt.
    const transient = err instanceof GeminiError && (err.status === 429 || err.status === 503 || err.status === 0);
    const attempts = transient ? row.enrichment_attempts : row.enrichment_attempts + 1;
    await db.prepare(`UPDATE vocabulary SET enrichment_status = ?, enrichment_error = ?,
        enrichment_attempts = ${transient ? 'enrichment_attempts' : 'enrichment_attempts + 1'}, updated_at = ? WHERE id = ?`)
      .bind(attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', (err as Error).message || String(err), now(), id).run();
    throw err;
  }
}

// `onlyUserId` keeps a request-triggered run on the caller's own words, and so on their own Gemini
// quota; the cron passes nothing and sweeps everybody.
async function processPending(env: Env, maxPerUser = 6, onlyUserId = ''): Promise<{ done: number; failed: number; users: number }> {
  const db = env.DB;
  await db.prepare("UPDATE vocabulary SET enrichment_status = 'pending' WHERE enrichment_status = 'processing' AND updated_at < ?").bind(now() - 3 * 60 * 1000).run();
  const { results: users } = await db.prepare(`SELECT DISTINCT u.* FROM users u JOIN vocabulary v ON v.user_id = u.id
      WHERE v.enrichment_status = 'pending' AND v.enrichment_attempts < ? ${onlyUserId ? 'AND u.id = ?' : ''}
      ${env.GEMINI_MOCK === '1' ? '' : 'AND u.gemini_key_enc IS NOT NULL'} ORDER BY u.created_at ASC LIMIT 20`)
    .bind(MAX_ATTEMPTS, ...(onlyUserId ? [onlyUserId] : [])).all<UserRow>();
  let done = 0;
  let failed = 0;
  for (const user of users) {
    const { results } = await db.prepare("SELECT id FROM vocabulary WHERE user_id = ? AND enrichment_status = 'pending' AND enrichment_attempts < ? ORDER BY created_at ASC LIMIT ?").bind(user.id, MAX_ATTEMPTS, maxPerUser).all<{ id: string }>();
    for (const { id } of results) {
      try { await enrichOne(env, user, id); done += 1; } catch (err) {
        failed += 1;
        if (err instanceof GeminiError && (err.status === 429 || err.status === 401 || err.status === 403 || err.status === 0)) break;
      }
    }
  }
  return { done, failed, users: users.length };
}

// ---------- public ----------

app.get('/', (c) => c.text(`ReadLex API ${VERSION}`));
app.get('/api/v1/health', (c) => c.json({ ok: true, version: VERSION, mock: c.env.GEMINI_MOCK === '1', signup: c.env.SIGNUP_MODE || 'open', mail: mailConfigured(c.env), encryption: encryptionSource(c.env), time: now() }));

// Simple abuse guard for public endpoints: at most `max` events per key per hour.
async function rateLimit(db: D1Database, key: string, max: number) {
  const since = now() - 60 * 60 * 1000;
  const row = await db.prepare('SELECT COUNT(*) AS n FROM rate_events WHERE key = ? AND created_at >= ?').bind(key, since).first<{ n: number }>();
  if ((row?.n || 0) >= max) throw new HttpError(429, 'Too many attempts, please try again in a few minutes');
  await db.batch([
    db.prepare('INSERT INTO rate_events (key, created_at) VALUES (?, ?)').bind(key, now()),
    db.prepare('DELETE FROM rate_events WHERE created_at < ?').bind(since - 60 * 60 * 1000),
  ]);
}
const clientIp = (c: { req: { header: (n: string) => string | undefined } }) => c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'local';

app.post('/api/v1/auth/register', async (c) => {
  const body = await c.req.json<{ email?: string; password?: string; inviteCode?: string; displayName?: string; kind?: string }>();
  const mode = c.env.SIGNUP_MODE || 'open';
  if (mode === 'closed') throw new HttpError(403, 'This server is not accepting new accounts');
  if (mode === 'invite' && (!c.env.INVITE_CODE || (body.inviteCode || '').trim() !== c.env.INVITE_CODE)) throw new HttpError(403, 'Invalid invite code');
  await rateLimit(c.env.DB, `register:${clientIp(c)}`, 10);
  const email = normalizeEmail(body.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Please enter a valid email address');
  if (!body.password || body.password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()) throw new HttpError(409, 'An account with this email already exists');
  const { hash, salt } = await hashPassword(body.password);
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  const id = uuid();
  const ts = now();
  await c.env.DB.prepare('INSERT INTO users (id, email, password_hash, password_salt, display_name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, email, hash, salt, String(body.displayName || '').slice(0, 80), (count?.n || 0) === 0 ? 'admin' : 'user', ts, ts).run();
  const session = await createSession(c.env.DB, id, body.kind === 'extension' ? 'extension' : 'web', body.kind === 'extension' ? 'extension' : 'web');
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
  return c.json({ ok: true, token: session.token, user: rowToUser(user!) });
});

app.post('/api/v1/auth/login', async (c) => {
  const body = await c.req.json<{ email?: string; password?: string; kind?: string; label?: string }>();
  const email = normalizeEmail(body.email);
  await rateLimit(c.env.DB, `login:${clientIp(c)}:${email}`, 30);
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();
  if (!user || !(await verifyPassword(String(body.password || ''), user.password_hash, user.password_salt))) throw new HttpError(401, 'Incorrect email or password');
  const kind = body.kind === 'extension' ? 'extension' : 'web';
  const session = await createSession(c.env.DB, user.id, kind, body.label || kind);
  return c.json({ ok: true, token: session.token, user: rowToUser(user) });
});

// Forgot / reset password. Always answers ok so email addresses cannot be probed.
app.post('/api/v1/auth/forgot', async (c) => {
  const body = await c.req.json<{ email?: string }>();
  const email = normalizeEmail(body.email);
  await rateLimit(c.env.DB, `forgot:${clientIp(c)}`, 10);
  if (!mailConfigured(c.env) && c.env.GEMINI_MOCK !== '1') return c.json({ ok: true, sent: false, mail: false, error: 'This server cannot send email yet. Contact the server admin to reset your password.' });
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();
  if (!user) return c.json({ ok: true, sent: true, mail: true });
  const token = randomToken(32);
  const ts = now();
  await c.env.DB.prepare('INSERT INTO password_resets (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').bind(uuid(), user.id, await sha256Hex(token), ts, ts + 60 * 60 * 1000).run();
  const link = `${(c.env.WEB_URL || '').replace(/\/$/, '')}/#/reset?token=${token}`;
  if (mailConfigured(c.env)) {
    await sendMail(c.env, email, 'Reset your ReadLex password', `You (or someone else) asked to reset your ReadLex password.\n\nOpen this link within 60 minutes to choose a new password:\n${link}\n\nIf this wasn't you, you can ignore this email.`);
    return c.json({ ok: true, sent: true, mail: true });
  }
  return c.json({ ok: true, sent: false, mail: false, devToken: token }); // local dev / tests only
});

app.post('/api/v1/auth/reset', async (c) => {
  const body = await c.req.json<{ token?: string; password?: string }>();
  if (!body.token) throw new HttpError(400, 'Missing reset code');
  if (!body.password || body.password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  const row = await c.env.DB.prepare('SELECT * FROM password_resets WHERE token_hash = ?').bind(await sha256Hex(body.token)).first<{ id: string; user_id: string; expires_at: number; used_at: number | null }>();
  if (!row || row.used_at || row.expires_at < now()) throw new HttpError(400, 'This reset link is invalid or has expired');
  const { hash, salt } = await hashPassword(body.password);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?').bind(hash, salt, now(), row.user_id),
    c.env.DB.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?').bind(now(), row.id),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(row.user_id),
  ]);
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(row.user_id).first<UserRow>();
  const session = await createSession(c.env.DB, row.user_id, 'web', 'web (after password reset)');
  return c.json({ ok: true, token: session.token, user: rowToUser(user!) });
});

// ---------- account ----------

app.post('/api/v1/auth/logout', async (c) => {
  await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(c.get('session').id).run();
  return c.json({ ok: true });
});
app.get('/api/v1/auth/me', (c) => c.json({ ok: true, user: rowToUser(c.get('user')), session: { kind: c.get('session').kind, label: c.get('session').label } }));

app.get('/api/v1/auth/tokens', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, kind, label, created_at, last_used_at, expires_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC').bind(c.get('user').id).all();
  return c.json({ ok: true, current: c.get('session').id, sessions: results });
});
app.post('/api/v1/auth/tokens', async (c) => {
  const body = await c.req.json<{ label?: string }>().catch(() => ({ label: '' }));
  const s = await createSession(c.env.DB, c.get('user').id, 'extension', body.label || 'extension');
  return c.json({ ok: true, token: s.token, id: s.id, expiresAt: s.expiresAt });
});
app.delete('/api/v1/auth/tokens/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').bind(c.req.param('id'), c.get('user').id).run();
  return c.json({ ok: true });
});

app.put('/api/v1/me/gemini', async (c) => {
  const body = await c.req.json<{ apiKey?: string; model?: string }>();
  const apiKey = String(body.apiKey || '').trim();
  const model = String(body.model || c.get('user').gemini_model || 'gemini-2.5-flash').trim().slice(0, 60);
  if (!apiKey) throw new HttpError(400, 'Missing API key');
  try {
    if (!(await testGemini(c.env, { apiKey, model }))) throw new Error('Gemini did not answer as expected');
  } catch (err) {
    throw new HttpError(400, `This key did not work: ${(err as Error).message}`);
  }
  await c.env.DB.prepare('UPDATE users SET gemini_key_enc = ?, gemini_model = ?, updated_at = ? WHERE id = ?').bind(await encryptSecret(c.env, apiKey), model, now(), c.get('user').id).run();
  c.executionCtx.waitUntil(processPending(c.env, 6, c.get('user').id).catch(() => {}));
  return c.json({ ok: true, hasGeminiKey: true, model, masked: maskKey(apiKey), mock: c.env.GEMINI_MOCK === '1' });
});
app.delete('/api/v1/me/gemini', async (c) => {
  await c.env.DB.prepare('UPDATE users SET gemini_key_enc = NULL, updated_at = ? WHERE id = ?').bind(now(), c.get('user').id).run();
  return c.json({ ok: true, hasGeminiKey: false });
});
app.patch('/api/v1/me', async (c) => {
  const body = await c.req.json<{ displayName?: string; settings?: Record<string, unknown>; password?: string; currentPassword?: string }>();
  const user = c.get('user');
  if (body.password) {
    if (!(await verifyPassword(String(body.currentPassword || ''), user.password_hash, user.password_salt))) throw new HttpError(401, 'Current password is incorrect');
    if (body.password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
    const { hash, salt } = await hashPassword(body.password);
    await c.env.DB.prepare('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?').bind(hash, salt, now(), user.id).run();
  }
  if (body.displayName !== undefined) await c.env.DB.prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?').bind(String(body.displayName).slice(0, 80), now(), user.id).run();
  if (body.settings) await c.env.DB.prepare('UPDATE users SET settings = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(body.settings).slice(0, 4000), now(), user.id).run();
  return c.json({ ok: true, user: rowToUser((await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first<UserRow>())!) });
});
app.delete('/api/v1/me', async (c) => {
  const body = await c.req.json<{ password?: string }>().catch(() => ({} as { password?: string }));
  const user = c.get('user');
  if (!(await verifyPassword(String(body.password || ''), user.password_hash, user.password_salt))) throw new HttpError(401, 'Incorrect password');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM reviews WHERE user_id = ?').bind(user.id),
    c.env.DB.prepare('DELETE FROM cards WHERE user_id = ?').bind(user.id),
    c.env.DB.prepare('DELETE FROM exposures WHERE vocabulary_id IN (SELECT id FROM vocabulary WHERE user_id = ?)').bind(user.id),
    c.env.DB.prepare('DELETE FROM vocabulary WHERE user_id = ?').bind(user.id),
    c.env.DB.prepare('DELETE FROM custom_set_items WHERE set_id IN (SELECT id FROM custom_sets WHERE user_id = ?)').bind(user.id),
    c.env.DB.prepare('DELETE FROM custom_sets WHERE user_id = ?').bind(user.id),
    c.env.DB.prepare('DELETE FROM lookups WHERE user_id = ?').bind(user.id),
    c.env.DB.prepare('DELETE FROM sync_log WHERE user_id = ?').bind(user.id),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
    c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);
  return c.json({ ok: true, deleted: true });
});

// ---------- sync / import ----------

app.post('/api/v1/sync', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ op?: string; payload?: Record<string, unknown>; clientCreatedAt?: number; ops?: Array<{ op: string; payload: Record<string, unknown>; clientCreatedAt?: number }> }>();
  const ops = body.ops || (body.op ? [{ op: body.op, payload: body.payload || {}, clientCreatedAt: body.clientCreatedAt }] : []);
  if (!ops.length) throw new HttpError(400, 'No operations given');
  if (ops.length > 100) throw new HttpError(400, 'At most 100 operations per request');
  const results: Array<Record<string, unknown>> = [];
  const toEnrich: string[] = [];
  for (const item of ops) {
    const ts = now();
    let result: Record<string, unknown> = {};
    try {
      switch (item.op) {
        case 'vocabulary.save': {
          const p = item.payload as { vocabulary?: IncomingVocabulary; exposure?: IncomingExposure | null };
          const r = await upsertVocabulary(c.env.DB, user.id, p.vocabulary || (item.payload as IncomingVocabulary), p.exposure || null, ts);
          if (r.created) toEnrich.push(r.id);
          result = { vocabularyId: r.id, created: r.created, exposureAdded: r.exposureAdded };
          break;
        }
        case 'vocabulary.update': {
          const p = item.payload as { id?: string; patch?: { status?: string; note?: string | null } };
          if (!p.id) throw new HttpError(400, 'Missing id');
          const row = await getVocabRow(c.env.DB, user.id, p.id);
          if (!row) { result = { ignored: true }; break; }
          const status = p.patch?.status && ['new', 'learning', 'known', 'ignored'].includes(p.patch.status) ? p.patch.status : row.status;
          await c.env.DB.prepare('UPDATE vocabulary SET status = ?, note = ?, updated_at = ? WHERE id = ?').bind(status, p.patch?.note ?? row.note, ts, p.id).run();
          result = { vocabularyId: p.id };
          break;
        }
        case 'vocabulary.delete': {
          const p = item.payload as { id?: string };
          if (!p.id) throw new HttpError(400, 'Missing id');
          await c.env.DB.prepare('DELETE FROM vocabulary WHERE id = ? AND user_id = ?').bind(p.id, user.id).run();
          result = { vocabularyId: p.id, deleted: true };
          break;
        }
        case 'lookup.record': {
          const p = item.payload as { language?: string; lemma?: string; surface?: string; site?: string; count?: number };
          if (!p.lemma) throw new HttpError(400, 'Missing lemma');
          const language = p.language === 'ja' ? 'ja' : 'en';
          const existing = await c.env.DB.prepare('SELECT * FROM lookups WHERE user_id = ? AND language = ? AND lemma = ?').bind(user.id, language, p.lemma).first<{ count: number; surfaces: string; sites: string; first_seen_at: number }>();
          const surfaces = new Set<string>(existing ? JSON.parse(existing.surfaces) : []);
          const sites = new Set<string>(existing ? JSON.parse(existing.sites) : []);
          if (p.surface) surfaces.add(p.surface);
          if (p.site) sites.add(p.site);
          await c.env.DB.prepare(`INSERT INTO lookups (user_id, language, lemma, count, first_seen_at, last_seen_at, surfaces, sites) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, language, lemma) DO UPDATE SET count = excluded.count, last_seen_at = excluded.last_seen_at, surfaces = excluded.surfaces, sites = excluded.sites`)
            .bind(user.id, language, p.lemma, (existing?.count || 0) + (p.count || 1), existing?.first_seen_at || ts, ts, JSON.stringify([...surfaces].slice(-10)), JSON.stringify([...sites].slice(-10))).run();
          result = { lemma: p.lemma };
          break;
        }
        default:
          throw new HttpError(400, `Unsupported operation: ${item.op}`);
      }
      results.push({ ok: true, op: item.op, ...result });
    } catch (err) {
      results.push({ ok: false, op: item.op, error: (err as Error).message });
    }
    await c.env.DB.prepare('INSERT INTO sync_log (user_id, op, client_created_at, received_at, vocabulary_id, result) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(user.id, item.op, item.clientCreatedAt || null, ts, (result.vocabularyId as string) || null, JSON.stringify(result).slice(0, 500)).run();
  }
  if (toEnrich.length) {
    const env = c.env;
    c.executionCtx.waitUntil((async () => {
      for (const id of toEnrich.slice(0, 3)) { try { await enrichOne(env, user, id); } catch (err) { console.warn('enrich failed', id, (err as Error).message); } }
    })());
  }
  const ok = results.every((r) => r.ok);
  return c.json({ ...(results.length === 1 ? results[0] : {}), results, ok }, ok ? 200 : 207);
});

app.post('/api/v1/import', async (c) => {
  const user = c.get('user');
  const data = await c.req.json<{ app?: string; vocabulary?: IncomingVocabulary[]; exposures?: Array<IncomingExposure & { vocabularyId?: string }>; lookups?: Array<{ lemma: string; count: number; firstSeenAt: number; lastSeenAt: number; surfaces?: string[]; sites?: string[] }> }>();
  if (!Array.isArray(data.vocabulary)) throw new HttpError(400, 'This file is not a ReadLex export');
  if (data.vocabulary.length > 5000) throw new HttpError(400, 'At most 5000 words per import');
  const ts = now();
  const idMap = new Map<string, string>();
  let created = 0;
  for (const v of data.vocabulary) {
    const r = await upsertVocabulary(c.env.DB, user.id, { ...v, id: undefined }, null, ts);
    if (v.id) idMap.set(v.id, r.id);
    if (r.created) created += 1;
  }
  let exposures = 0;
  for (const e of (data.exposures || []).slice(0, 20000)) {
    const serverId = e.vocabularyId ? idMap.get(e.vocabularyId) : null;
    if (!serverId) continue;
    const dup = await c.env.DB.prepare('SELECT id FROM exposures WHERE vocabulary_id = ? AND url = ? AND sentence = ?').bind(serverId, e.url || '', e.sentence || '').first();
    if (dup) continue;
    await c.env.DB.prepare('INSERT INTO exposures (id, vocabulary_id, surface, sentence, paragraph, url, page_title, encountered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(uuid(), serverId, (e.surface || '').slice(0, 200), (e.sentence || '').slice(0, 1000), (e.paragraph || '').slice(0, 2000), (e.url || '').slice(0, 2000), (e.pageTitle || '').slice(0, 300), e.encounteredAt || ts).run();
    exposures += 1;
  }
  await c.env.DB.prepare('UPDATE vocabulary SET exposure_count = (SELECT COUNT(*) FROM exposures WHERE exposures.vocabulary_id = vocabulary.id) WHERE user_id = ?').bind(user.id).run();
  for (const l of (data.lookups || []).slice(0, 5000)) {
    if (!l.lemma) continue;
    const language = /[぀-ヿ㐀-䶿一-鿿]/.test(l.lemma) ? 'ja' : 'en';
    await c.env.DB.prepare(`INSERT INTO lookups (user_id, language, lemma, count, first_seen_at, last_seen_at, surfaces, sites) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, language, lemma) DO UPDATE SET count = MAX(lookups.count, excluded.count), last_seen_at = MAX(lookups.last_seen_at, excluded.last_seen_at)`)
      .bind(user.id, language, l.lemma, l.count || 1, l.firstSeenAt || ts, l.lastSeenAt || ts, JSON.stringify(l.surfaces || []), JSON.stringify(l.sites || [])).run();
  }
  c.executionCtx.waitUntil(processPending(c.env, 6).catch(() => {}));
  const idMapOut: Record<string, string> = {};
  for (const [k, v] of idMap) idMapOut[k] = v;
  return c.json({ ok: true, vocabulary: data.vocabulary.length, created, exposures, idMap: idMapOut });
});

// ---------- vocabulary ----------

app.get('/api/v1/vocabulary', async (c) => {
  const user = c.get('user');
  const q = (c.req.query('query') || '').trim().toLowerCase();
  const status = c.req.query('status') || '';
  const language = c.req.query('language') || '';
  const enrichment = c.req.query('enrichment') || '';
  const sort = c.req.query('sort') || 'newest';
  const limit = Math.min(500, num(c.req.query('limit'), 100));
  const offset = num(c.req.query('offset'), 0);
  const since = num(c.req.query('since'), 0);
  const where: string[] = ['user_id = ?'];
  const binds: unknown[] = [user.id];
  if (q) { where.push("(lower(lemma) LIKE ? OR lower(surface) LIKE ? OR reading LIKE ? OR lower(COALESCE(quick_meaning, '')) LIKE ? OR lower(COALESCE(enrichment, '')) LIKE ?)"); binds.push(...Array(5).fill(`%${q}%`)); }
  if (status) { where.push('status = ?'); binds.push(status); }
  if (language) { where.push('language = ?'); binds.push(language); }
  if (enrichment) { where.push('enrichment_status = ?'); binds.push(enrichment); }
  if (since) { where.push('created_at >= ?'); binds.push(since); }
  const orderBy = ({ newest: 'created_at DESC', oldest: 'created_at ASC', alpha: 'lemma ASC', exposures: 'exposure_count DESC, created_at DESC' } as Record<string, string>)[sort] || 'created_at DESC';
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM vocabulary ${whereSql}`).bind(...binds).first<{ n: number }>();
  const { results } = await c.env.DB.prepare(`SELECT * FROM vocabulary ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).bind(...binds, limit, offset).all<VocabularyRow>();
  return c.json({ ok: true, total: total?.n || 0, items: results.map(rowToVocabulary) });
});

app.get('/api/v1/vocabulary/:id', async (c) => {
  const user = c.get('user');
  const row = await getVocabRow(c.env.DB, user.id, c.req.param('id'));
  if (!row) throw new HttpError(404, 'Word not found');
  const exposures = await exposuresOf(c.env.DB, row.id);
  const card = await cardOf(c.env.DB, row.id);
  const { results: reviews } = await c.env.DB.prepare('SELECT rating, reviewed_at, scheduled_days FROM reviews WHERE vocabulary_id = ? ORDER BY reviewed_at DESC LIMIT 20').bind(row.id).all();
  const lookups = await c.env.DB.prepare('SELECT count, first_seen_at, last_seen_at, sites FROM lookups WHERE user_id = ? AND language = ? AND lemma = ?').bind(user.id, row.language, row.lemma).first();
  const v = rowToVocabulary(row);
  return c.json({ ok: true, vocabulary: v, exposures: exposures.slice().reverse(), card: card ? cardContent(v, exposures, card, previewIntervals(card, new Date())) : null, reviews, lookups });
});

app.patch('/api/v1/vocabulary/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const row = await getVocabRow(c.env.DB, user.id, id);
  if (!row) throw new HttpError(404, 'Word not found');
  const patch = await c.req.json<{ status?: string; note?: string | null; suspended?: boolean; lemma?: string; reading?: string; meaning?: string | null }>();
  const status = patch.status && ['new', 'learning', 'known', 'ignored'].includes(patch.status) ? patch.status : row.status;
  const lemma = patch.lemma !== undefined ? String(patch.lemma).trim().slice(0, 200) : row.lemma;
  if (!lemma) throw new HttpError(400, 'The word cannot be empty');
  if (lemma !== row.lemma) {
    const clash = await findByLemma(c.env.DB, user.id, row.language, lemma);
    if (clash && clash.id !== id) throw new HttpError(409, `"${lemma}" is already in your library`);
  }
  const reading = patch.reading !== undefined ? String(patch.reading).trim().slice(0, 100) : row.reading;
  const meaning = patch.meaning === undefined ? row.user_meaning : String(patch.meaning ?? '').trim().slice(0, 500) || null;
  const note = patch.note === undefined ? row.note : String(patch.note ?? '').trim().slice(0, 2000) || null;
  await c.env.DB.prepare('UPDATE vocabulary SET status = ?, note = ?, lemma = ?, reading = ?, user_meaning = ?, updated_at = ? WHERE id = ?').bind(status, note, lemma, reading, meaning, now(), id).run();
  if (patch.suspended !== undefined) await c.env.DB.prepare('UPDATE cards SET suspended = ?, updated_at = ? WHERE vocabulary_id = ?').bind(patch.suspended ? 1 : 0, now(), id).run();
  return c.json({ ok: true, vocabulary: rowToVocabulary((await getVocabRow(c.env.DB, user.id, id))!) });
});

app.delete('/api/v1/vocabulary/:id', async (c) => {
  const owned = await getVocabRow(c.env.DB, c.get('user').id, c.req.param('id'));
  if (owned) await c.env.DB.prepare('DELETE FROM custom_set_items WHERE vocabulary_id = ?').bind(owned.id).run();
  await c.env.DB.prepare('DELETE FROM vocabulary WHERE id = ? AND user_id = ?').bind(c.req.param('id'), c.get('user').id).run();
  return c.json({ ok: true });
});

app.post('/api/v1/vocabulary/:id/enrich', async (c) => {
  try {
    const v = await enrichOne(c.env, c.get('user'), c.req.param('id'), { force: true });
    if (!v) throw new HttpError(404, 'Word not found');
    return c.json({ ok: true, vocabulary: v });
  } catch (err) {
    if (err instanceof GeminiError) throw new HttpError(err.status === 0 ? 400 : 502, err.message);
    throw err;
  }
});

// Meanings for words the learner is typing in (set composer, Add word). One Gemini call, nothing stored:
// the learner still has to accept what comes back by leaving it in the form.
app.post('/api/v1/define', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ language?: string; terms?: unknown }>().catch(() => ({} as { language?: string; terms?: unknown }));
  const language = body.language === 'ja' ? 'ja' : 'en';
  const terms = (Array.isArray(body.terms) ? body.terms : [])
    .map((t) => (typeof t === 'string' ? t.replace(/\s+/g, ' ').trim().slice(0, 100) : ''))
    .filter(Boolean)
    .slice(0, 20);
  if (!terms.length) throw new HttpError(400, 'Send at least one word to define');
  await rateLimit(c.env.DB, `define:${user.id}`, 200);
  try {
    const creds = await geminiCreds(c.env, user);
    if (!creds.apiKey) throw new GeminiError(0, 'Add your Gemini API key in Settings first, then try again');
    return c.json({ ok: true, language, mock: c.env.GEMINI_MOCK === '1', items: await defineTerms(c.env, creds, language, terms) });
  } catch (err) {
    if (err instanceof GeminiError) throw new HttpError(err.status === 0 ? 400 : 502, err.message);
    throw err;
  }
});

app.post('/api/v1/enrich/run', async (c) => c.json({ ok: true, ...(await processPending(c.env, Math.min(50, Math.max(1, num(c.req.query('max'), 6))), c.get('user').id)) }));

app.delete('/api/v1/exposures/:id', async (c) => {
  const user = c.get('user');
  const row = await c.env.DB.prepare('SELECT e.id, e.vocabulary_id FROM exposures e JOIN vocabulary v ON v.id = e.vocabulary_id WHERE e.id = ? AND v.user_id = ?').bind(c.req.param('id'), user.id).first<{ id: string; vocabulary_id: string }>();
  if (!row) throw new HttpError(404, 'Sentence not found');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM exposures WHERE id = ?').bind(row.id),
    c.env.DB.prepare('UPDATE vocabulary SET exposure_count = (SELECT COUNT(*) FROM exposures WHERE vocabulary_id = ?), updated_at = ? WHERE id = ?').bind(row.vocabulary_id, now(), row.vocabulary_id),
  ]);
  return c.json({ ok: true });
});

// ---------- custom sets (user-created groupings) ----------

interface CustomSetRow { id: string; user_id: string; name: string; description: string; created_at: number; updated_at: number }
const setName = (v: unknown) => String(v ?? '').trim().slice(0, 80);
async function getCustomSet(db: D1Database, userId: string, id: string) {
  const row = await db.prepare('SELECT * FROM custom_sets WHERE id = ? AND user_id = ?').bind(id, userId).first<CustomSetRow>();
  if (!row) throw new HttpError(404, 'Set not found');
  return row;
}

app.get('/api/v1/custom-sets', async (c) => {
  const user = c.get('user');
  const ts = now();
  const vocabId = c.req.query('vocabularyId') || '';
  const { results } = await c.env.DB.prepare(`SELECT s.id, s.name, s.description, s.created_at, s.updated_at,
      COUNT(i.vocabulary_id) AS words,
      COALESCE(SUM(CASE WHEN k.state IS NOT NULL AND k.state != 0 THEN 1 ELSE 0 END), 0) AS studied,
      COALESCE(SUM(CASE WHEN k.state IS NOT NULL AND k.state != 0 AND k.due <= ?1 THEN 1 ELSE 0 END), 0) AS due,
      COALESCE(SUM(CASE WHEN i.vocabulary_id = ?2 THEN 1 ELSE 0 END), 0) AS containsWord
      FROM custom_sets s LEFT JOIN custom_set_items i ON i.set_id = s.id LEFT JOIN cards k ON k.vocabulary_id = i.vocabulary_id
      WHERE s.user_id = ?3 GROUP BY s.id ORDER BY s.updated_at DESC`).bind(ts, vocabId, user.id).all();
  return c.json({ ok: true, sets: results });
});

app.post('/api/v1/custom-sets', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ name?: string; description?: string; vocabularyIds?: string[] }>();
  const name = setName(body.name);
  if (!name) throw new HttpError(400, 'Give the set a name');
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM custom_sets WHERE user_id = ?').bind(user.id).first<{ n: number }>();
  if ((count?.n || 0) >= 200) throw new HttpError(400, 'You can have at most 200 sets');
  const id = uuid();
  const ts = now();
  await c.env.DB.prepare('INSERT INTO custom_sets (id, user_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, user.id, name, String(body.description ?? '').trim().slice(0, 300), ts, ts).run();
  if (body.vocabularyIds?.length) await addSetItems(c.env.DB, user.id, id, body.vocabularyIds);
  return c.json({ ok: true, set: { id, name, words: body.vocabularyIds?.length || 0 } });
});

async function addSetItems(db: D1Database, userId: string, setId: string, ids: string[]): Promise<number> {
  const unique = [...new Set(ids.filter((x) => typeof x === 'string'))].slice(0, 1000);
  let added = 0;
  for (let i = 0; i < unique.length; i += 90) {
    const chunk = unique.slice(i, i + 90);
    const { results } = await db.prepare(`SELECT id FROM vocabulary WHERE user_id = ? AND id IN (${chunk.map(() => '?').join(',')})`).bind(userId, ...chunk).all<{ id: string }>();
    if (!results.length) continue;
    const ts = now();
    await db.batch(results.map((r) => db.prepare('INSERT OR IGNORE INTO custom_set_items (set_id, vocabulary_id, added_at) VALUES (?, ?, ?)').bind(setId, r.id, ts)));
    added += results.length;
  }
  await db.prepare('UPDATE custom_sets SET updated_at = ? WHERE id = ?').bind(now(), setId).run();
  return added;
}

app.get('/api/v1/custom-sets/:id', async (c) => {
  const user = c.get('user');
  const set = await getCustomSet(c.env.DB, user.id, c.req.param('id'));
  const { results } = await c.env.DB.prepare(`SELECT k.* FROM custom_set_items i JOIN cards k ON k.vocabulary_id = i.vocabulary_id
      WHERE i.set_id = ? AND k.user_id = ? ORDER BY i.added_at ASC LIMIT 1000`).bind(set.id, user.id).all<CardRow>();
  const cards = await buildCards(c.env.DB, user.id, results, now());
  return c.json({ ok: true, set: { id: set.id, name: set.name, description: set.description, createdAt: set.created_at }, cards, words: cards.length, studied: cards.filter((k) => k.schedule.state !== 0).length });
});

app.patch('/api/v1/custom-sets/:id', async (c) => {
  const user = c.get('user');
  const set = await getCustomSet(c.env.DB, user.id, c.req.param('id'));
  const body = await c.req.json<{ name?: string; description?: string }>();
  const name = body.name === undefined ? set.name : setName(body.name);
  if (!name) throw new HttpError(400, 'Give the set a name');
  const description = body.description === undefined ? set.description : String(body.description ?? '').trim().slice(0, 300);
  await c.env.DB.prepare('UPDATE custom_sets SET name = ?, description = ?, updated_at = ? WHERE id = ?').bind(name, description, now(), set.id).run();
  return c.json({ ok: true, set: { id: set.id, name, description } });
});

// Deleting a set never deletes words: they stay in the library with their review history.
app.delete('/api/v1/custom-sets/:id', async (c) => {
  const set = await getCustomSet(c.env.DB, c.get('user').id, c.req.param('id'));
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM custom_set_items WHERE set_id = ?').bind(set.id),
    c.env.DB.prepare('DELETE FROM custom_sets WHERE id = ?').bind(set.id),
  ]);
  return c.json({ ok: true });
});

app.post('/api/v1/custom-sets/:id/items', async (c) => {
  const user = c.get('user');
  const set = await getCustomSet(c.env.DB, user.id, c.req.param('id'));
  const body = await c.req.json<{ vocabularyIds?: string[] }>();
  if (!Array.isArray(body.vocabularyIds) || !body.vocabularyIds.length) throw new HttpError(400, 'No words given');
  return c.json({ ok: true, added: await addSetItems(c.env.DB, user.id, set.id, body.vocabularyIds) });
});

app.delete('/api/v1/custom-sets/:id/items/:vocabularyId', async (c) => {
  const set = await getCustomSet(c.env.DB, c.get('user').id, c.req.param('id'));
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM custom_set_items WHERE set_id = ? AND vocabulary_id = ?').bind(set.id, c.req.param('vocabularyId')),
    c.env.DB.prepare('UPDATE custom_sets SET updated_at = ? WHERE id = ?').bind(now(), set.id),
  ]);
  return c.json({ ok: true });
});

// ---------- study ----------

function dayStart(ts: number, tzOffsetMinutes: number): number {
  const local = ts + tzOffsetMinutes * 60000;
  return Math.floor(local / 86400000) * 86400000 - tzOffsetMinutes * 60000;
}
const dayKey = (ts: number, tz: number) => new Date(dayStart(ts, tz) + tz * 60000).toISOString().slice(0, 10);

// Build card contents with a constant number of queries (2 per 90 cards) instead of 2 per card:
// Workers Free allows ~50 D1 queries per request and users may study hundreds of words at once.
async function buildCards(db: D1Database, userId: string, cards: CardRow[], ts: number, { skipProperNouns = false } = {}) {
  if (!cards.length) return [];
  const vmap = new Map<string, VocabularyRow>();
  const emap = new Map<string, Exposure[]>();
  const ids = cards.map((c) => c.vocabulary_id);
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const ph = chunk.map(() => '?').join(',');
    const v = await db.prepare(`SELECT * FROM vocabulary WHERE user_id = ? AND id IN (${ph})`).bind(userId, ...chunk).all<VocabularyRow>();
    for (const r of v.results) vmap.set(r.id, r);
    const e = await db.prepare(`SELECT * FROM exposures WHERE vocabulary_id IN (${ph}) ORDER BY encountered_at ASC`).bind(...chunk).all<ExposureRow>();
    for (const r of e.results) { const list = emap.get(r.vocabulary_id) || []; list.push(rowToExposure(r)); emap.set(r.vocabulary_id, list); }
  }
  const out = [];
  for (const card of cards) {
    const vrow = vmap.get(card.vocabulary_id);
    if (!vrow) continue;
    const v = rowToVocabulary(vrow);
    if (skipProperNouns && v.enrichment?.isProperNoun && v.status === 'new') continue;
    out.push(cardContent(v, emap.get(v.id) || [], card, previewIntervals(card, new Date(ts))));
  }
  return out;
}

app.get('/api/v1/today', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const ts = now();
  const tz = num(c.req.query('tz'), 420);
  const limitNew = Math.min(500, num(c.req.query('limitNew'), 500));
  const limitDue = Math.min(500, num(c.req.query('limitDue'), 500));
  const language = c.req.query('language') || '';
  const langSql = language ? 'AND v.language = ?' : '';
  const langBind = language ? [language] : [];
  const { results: dueRows } = await db.prepare(`SELECT c.* FROM cards c JOIN vocabulary v ON v.id = c.vocabulary_id
      WHERE c.user_id = ? AND c.suspended = 0 AND c.state != 0 AND c.due <= ? AND v.status != 'ignored' ${langSql} ORDER BY c.due ASC LIMIT ?`).bind(user.id, ts, ...langBind, limitDue).all<CardRow>();
  const { results: newRows } = await db.prepare(`SELECT c.* FROM cards c JOIN vocabulary v ON v.id = c.vocabulary_id
      WHERE c.user_id = ? AND c.suspended = 0 AND c.state = 0 AND v.status != 'ignored' AND v.status != 'known' ${langSql}
      ORDER BY v.created_at DESC LIMIT ?`).bind(user.id, ...langBind, limitNew).all<CardRow>();
  const due = await buildCards(db, user.id, dueRows, ts);
  const fresh = await buildCards(db, user.id, newRows, ts, { skipProperNouns: true });
  const start = dayStart(ts, tz);
  const counts = await db.prepare(`SELECT
      (SELECT COUNT(*) FROM vocabulary WHERE user_id = ?1 AND created_at >= ?2) AS savedToday,
      (SELECT COUNT(*) FROM vocabulary WHERE user_id = ?1 AND created_at >= ?3 AND created_at < ?2) AS savedYesterday,
      (SELECT COUNT(*) FROM reviews WHERE user_id = ?1 AND reviewed_at >= ?2) AS reviewedToday,
      (SELECT COUNT(*) FROM cards WHERE user_id = ?1 AND state = 0) AS newTotal,
      (SELECT COUNT(*) FROM cards c JOIN vocabulary v ON v.id = c.vocabulary_id WHERE c.user_id = ?1 AND c.state != 0 AND c.due <= ?4 AND c.suspended = 0 AND v.status != 'ignored') AS dueTotal,
      (SELECT COUNT(*) FROM cards WHERE user_id = ?1 AND state = 2) AS reviewTotal,
      (SELECT COUNT(*) FROM vocabulary WHERE user_id = ?1 AND enrichment_status IN ('pending', 'processing')) AS pendingEnrichment`)
    .bind(user.id, start, start - 86400000, ts).first<Record<string, number>>();
  return c.json({ ok: true, now: ts, today: dayKey(ts, tz), due, new: fresh, counts, hasGeminiKey: !!user.gemini_key_enc || c.env.GEMINI_MOCK === '1', estimatedMinutes: Math.round((due.length * 0.4 + fresh.length * 0.8) * 10) / 10 });
});

// Daily Sets: saved words grouped by the user's local calendar day. A set is only a view;
// every word still has exactly one FSRS card.
app.get('/api/v1/sets', async (c) => {
  const user = c.get('user');
  const ts = now();
  const tz = num(c.req.query('tz'), 420);
  const language = c.req.query('language') || '';
  const { results } = await c.env.DB.prepare(`SELECT v.created_at, c.state, c.due FROM vocabulary v LEFT JOIN cards c ON c.vocabulary_id = v.id
      WHERE v.user_id = ? AND v.status != 'ignored' ${language ? 'AND v.language = ?' : ''} ORDER BY v.created_at DESC`).bind(user.id, ...(language ? [language] : [])).all<{ created_at: number; state: number | null; due: number | null }>();
  const sets = new Map<string, { date: string; words: number; studied: number; fresh: number; due: number }>();
  for (const r of results) {
    const key = dayKey(r.created_at, tz);
    const set = sets.get(key) || { date: key, words: 0, studied: 0, fresh: 0, due: 0 };
    set.words += 1;
    if (r.state && r.state !== 0) { set.studied += 1; if ((r.due || 0) <= ts) set.due += 1; } else set.fresh += 1;
    sets.set(key, set);
  }
  return c.json({ ok: true, today: dayKey(ts, tz), sets: [...sets.values()] });
});

app.get('/api/v1/sets/:date', async (c) => {
  const user = c.get('user');
  const ts = now();
  const tz = num(c.req.query('tz'), 420);
  const m = c.req.param('date').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new HttpError(400, 'Date must look like 2026-09-21');
  const start = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - tz * 60000;
  const { results } = await c.env.DB.prepare(`SELECT c.* FROM cards c JOIN vocabulary v ON v.id = c.vocabulary_id
      WHERE c.user_id = ? AND v.status != 'ignored' AND v.created_at >= ? AND v.created_at < ? ORDER BY v.created_at ASC LIMIT 1000`).bind(user.id, start, start + 86400000).all<CardRow>();
  const cards = await buildCards(c.env.DB, user.id, results, ts);
  return c.json({ ok: true, date: c.req.param('date'), cards, words: cards.length, studied: cards.filter((k) => k.schedule.state !== 0).length });
});

async function applyReview(db: D1Database, userId: string, input: { id?: string; cardId: string; rating: number; durationMs?: number; reviewedAt?: number }) {
  const card = await db.prepare('SELECT * FROM cards WHERE id = ? AND user_id = ?').bind(input.cardId, userId).first<CardRow>();
  if (!card) throw new HttpError(404, `Card not found: ${input.cardId}`);
  // The device gives every rating an id. If we have already applied it, the answer was simply lost
  // on the way back — report the schedule as it stands instead of scheduling the card a second time.
  const clientId = typeof input.id === 'string' && input.id.length <= 64 ? input.id : '';
  if (clientId) {
    const seen = await db.prepare('SELECT rating, card_id FROM reviews WHERE user_id = ? AND client_id = ?').bind(userId, clientId).first<{ rating: number; card_id: string }>();
    if (seen && seen.card_id === card.id) return { cardId: card.id, vocabularyId: card.vocabulary_id, rating: seen.rating, state: card.state, due: card.due, scheduledDays: card.scheduled_days, intervals: previewIntervals(card, new Date(now())), duplicate: true };
  }
  // A rating that waited in an offline queue carries its own timestamp, but it can never be older
  // than the card's last review or the scheduler has no interval to work with.
  const stamped = input.reviewedAt && input.reviewedAt <= now() + 60000 ? input.reviewedAt : now();
  const when = new Date(Math.max(stamped, card.last_review || 0));
  const { card: next, log, grade } = review(card, input.rating, when);
  const patch = cardToPatch(next);
  await db.batch([
    db.prepare('UPDATE cards SET state = ?, due = ?, stability = ?, difficulty = ?, elapsed_days = ?, scheduled_days = ?, learning_steps = ?, reps = ?, lapses = ?, last_review = ?, updated_at = ? WHERE id = ?')
      .bind(patch.state, patch.due, patch.stability, patch.difficulty, patch.elapsed_days, patch.scheduled_days, patch.learning_steps, patch.reps, patch.lapses, patch.last_review, when.getTime(), card.id),
    db.prepare('INSERT INTO reviews (id, user_id, card_id, vocabulary_id, rating, state_before, due_before, stability, difficulty, elapsed_days, scheduled_days, duration_ms, reviewed_at, client_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(uuid(), userId, card.id, card.vocabulary_id, grade, log.state, log.due.getTime(), log.stability, log.difficulty, log.elapsed_days, log.scheduled_days, Math.max(0, Math.round(input.durationMs || 0)), when.getTime(), clientId || null),
    db.prepare("UPDATE vocabulary SET status = CASE WHEN status = 'new' THEN 'learning' ELSE status END, updated_at = ? WHERE id = ?").bind(when.getTime(), card.vocabulary_id),
  ]);
  const updated = { ...card, ...patch } as CardRow;
  return { cardId: card.id, vocabularyId: card.vocabulary_id, rating: grade, state: next.state, due: next.due.getTime(), scheduledDays: next.scheduled_days, intervals: previewIntervals(updated, when) };
}

app.post('/api/v1/reviews', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ id?: string; cardId?: string; rating?: number; durationMs?: number; reviewedAt?: number; reviews?: Array<{ id?: string; cardId: string; rating: number; durationMs?: number; reviewedAt?: number }> }>();
  const items = body.reviews || (body.cardId ? [{ id: body.id, cardId: body.cardId, rating: body.rating || 3, durationMs: body.durationMs, reviewedAt: body.reviewedAt }] : []);
  if (!items.length) throw new HttpError(400, 'Missing cardId / rating');
  if (items.length > 500) throw new HttpError(400, 'At most 500 reviews per request');
  const results = [];
  for (const item of items) {
    try { results.push({ ok: true, ...(await applyReview(c.env.DB, user.id, item)) }); } catch (err) { results.push({ ok: false, cardId: item.cardId, error: (err as Error).message }); }
  }
  return c.json({ ...(results.length === 1 ? results[0] : {}), results, ok: results.every((r) => r.ok) });
});

app.get('/api/v1/stats', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const ts = now();
  const tz = num(c.req.query('tz'), 420);
  const span = Math.min(120, Math.max(30, num(c.req.query('days'), 30)));   // the web asks for 84 (a 12-week heatmap)
  const start = dayStart(ts, tz);
  const totals = await db.prepare(`SELECT
      (SELECT COUNT(*) FROM vocabulary WHERE user_id = ?1) AS total,
      (SELECT COUNT(*) FROM vocabulary WHERE user_id = ?1 AND language = 'ja') AS ja,
      (SELECT COUNT(*) FROM vocabulary WHERE user_id = ?1 AND created_at >= ?2) AS today,
      (SELECT COUNT(*) FROM vocabulary WHERE user_id = ?1 AND created_at >= ?3) AS week,
      (SELECT COUNT(*) FROM exposures WHERE vocabulary_id IN (SELECT id FROM vocabulary WHERE user_id = ?1)) AS exposures,
      (SELECT COUNT(*) FROM reviews WHERE user_id = ?1) AS reviews,
      (SELECT COUNT(*) FROM reviews WHERE user_id = ?1 AND rating = 1) AS again,
      (SELECT COUNT(*) FROM (SELECT MIN(reviewed_at) AS first FROM reviews WHERE user_id = ?1 GROUP BY card_id) WHERE first >= ?3) AS learnedWeek,
      (SELECT COUNT(*) FROM cards WHERE user_id = ?1 AND state = 0) AS cardsNew,
      (SELECT COUNT(*) FROM cards WHERE user_id = ?1 AND state IN (1, 3)) AS cardsLearning,
      (SELECT COUNT(*) FROM cards WHERE user_id = ?1 AND state = 2) AS cardsReview,
      (SELECT COUNT(*) FROM vocabulary WHERE user_id = ?1 AND enrichment_status = 'done') AS enriched,
      (SELECT COUNT(*) FROM vocabulary WHERE user_id = ?1 AND enrichment_status IN ('pending', 'processing')) AS pendingEnrichment`)
    .bind(user.id, start, start - 6 * 86400000).first<Record<string, number>>();
  const since = start - (span - 1) * 86400000;
  const { results: days } = await db.prepare('SELECT reviewed_at, rating FROM reviews WHERE user_id = ? AND reviewed_at >= ? ORDER BY reviewed_at ASC').bind(user.id, since).all<{ reviewed_at: number; rating: number }>();
  const keyOf = (t: number) => dayKey(t, tz);
  const perDay: Record<string, { reviews: number; again: number }> = {};
  const savedPerDay: Record<string, number> = {};
  for (let i = span - 1; i >= 0; i--) { const k = keyOf(start - i * 86400000); perDay[k] = { reviews: 0, again: 0 }; savedPerDay[k] = 0; }
  for (const r of days) { const k = keyOf(r.reviewed_at); if (perDay[k]) { perDay[k].reviews += 1; if (r.rating === 1) perDay[k].again += 1; } }
  const { results: saved } = await db.prepare('SELECT created_at FROM vocabulary WHERE user_id = ? AND created_at >= ?').bind(user.id, since).all<{ created_at: number }>();
  for (const r of saved) { const k = keyOf(r.created_at); if (k in savedPerDay) savedPerDay[k] += 1; }
  let streak = 0;
  for (let i = 0; i < span; i++) { const k = keyOf(start - i * 86400000); if (perDay[k]?.reviews > 0) streak += 1; else if (i > 0) break; }
  // Recall rate: a review counts as recalled when it was rated Hard, Good or Easy; Again is a miss.
  const sumDays = (n: number) => {
    const w = { reviews: 0, again: 0 };
    for (let i = 0; i < n; i++) { const d = perDay[keyOf(start - i * 86400000)]; if (d) { w.reviews += d.reviews; w.again += d.again; } }
    return w;
  };
  const recall = { d7: sumDays(7), d30: sumDays(30), all: { reviews: totals?.reviews || 0, again: totals?.again || 0 } };
  const { results: levels } = await db.prepare("SELECT COALESCE(NULLIF(json_extract(enrichment, '$.cefr'), ''), NULLIF(json_extract(enrichment, '$.level'), ''), '?') AS level, COUNT(*) AS n FROM vocabulary WHERE user_id = ? GROUP BY level").bind(user.id).all<{ level: string; n: number }>();
  return c.json({ ok: true, totals, perDay, savedPerDay, streak, recall, byLevel: Object.fromEntries(levels.map((l) => [l.level, l.n])) });
});

// Words that keep slipping: two or more "Again" answers in the last 90 days.
app.get('/api/v1/difficult', async (c) => {
  const user = c.get('user');
  const ts = now();
  const limit = Math.min(50, Math.max(1, num(c.req.query('limit'), 12)));
  const { results: rows } = await c.env.DB.prepare(`SELECT r.card_id AS cardId, SUM(CASE WHEN r.rating = 1 THEN 1 ELSE 0 END) AS again, COUNT(*) AS reviews,
        MAX(CASE WHEN r.rating = 1 THEN r.reviewed_at ELSE 0 END) AS lastAgainAt
      FROM reviews r JOIN cards c ON c.id = r.card_id JOIN vocabulary v ON v.id = c.vocabulary_id
      WHERE r.user_id = ? AND r.reviewed_at >= ? AND c.suspended = 0 AND v.status NOT IN ('ignored', 'known')
      GROUP BY r.card_id HAVING again >= 2 ORDER BY again DESC, lastAgainAt DESC LIMIT ?`).bind(user.id, ts - 90 * 86400000, limit).all<{ cardId: string; again: number; reviews: number; lastAgainAt: number }>();
  if (!rows.length) return c.json({ ok: true, items: [] });
  const { results: cardRows } = await c.env.DB.prepare(`SELECT * FROM cards WHERE user_id = ? AND id IN (${rows.map(() => '?').join(',')})`).bind(user.id, ...rows.map((r) => r.cardId)).all<CardRow>();
  const cards = new Map((await buildCards(c.env.DB, user.id, cardRows, ts)).map((k) => [k.cardId, k]));
  return c.json({ ok: true, items: rows.filter((r) => cards.has(r.cardId)).map((r) => ({ again: r.again, reviews: r.reviews, lastAgainAt: r.lastAgainAt, card: cards.get(r.cardId) })) });
});

app.get('/api/v1/lookups/frequent', async (c) => {
  const user = c.get('user');
  const min = num(c.req.query('min'), 3);
  const { results } = await c.env.DB.prepare(`SELECT l.language, l.lemma, l.count, l.last_seen_at, l.surfaces, l.sites FROM lookups l
      LEFT JOIN vocabulary v ON v.user_id = l.user_id AND v.language = l.language AND v.lemma = l.lemma
      WHERE l.user_id = ? AND v.id IS NULL AND l.count >= ? ORDER BY l.count DESC, l.last_seen_at DESC LIMIT 30`).bind(user.id, min).all();
  return c.json({ ok: true, items: results });
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(processPending(env, 6).then((r) => console.log('enrich cron', JSON.stringify(r))));
  },
};
