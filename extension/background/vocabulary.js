// Vocabulary store: one row per lemma, many exposures (sentence + page) per row.
// Shape mirrors the API the future backend will expose, so syncing later is a thin layer.

import { db, uuid } from './db.js';
import { lemmatize } from './lemmatizer.js';
import { lookup } from './translate.js';

export function normalizeSurface(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'“”‘’(\[{<«]+|[\s"'“”‘’)\]}>».,;:!?…]+$/g, '')
    .trim();
}

export function computeLemma(surface, language = 'en') {
  if (language === 'ja') return surface;
  const s = surface.toLowerCase();
  if (/\s/.test(s)) return s;
  return lemmatize(s) || s;
}

export async function findByLemma(lemma, language = null) {
  const rows = await db.getAllByIndex('vocabulary', 'lemma', lemma);
  return rows.find((v) => !language || (v.language || 'en') === language) || rows[0] || null;
}

export async function findBySurface(surface, language = 'en') {
  const lemma = computeLemma(surface, language);
  let vocab = await findByLemma(lemma, language);
  if (!vocab && language === 'en' && lemma !== surface.toLowerCase()) vocab = await findByLemma(surface.toLowerCase(), language);
  return vocab;
}

async function broadcast(extra = {}) {
  try { await chrome.runtime.sendMessage({ type: 'VOCABULARY_CHANGED', ...extra }); } catch (_) { /* no listener */ }
  updateBadge().catch(() => {});
}

export async function updateBadge() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const rows = await db.getAll('vocabulary');
  const today = rows.filter((v) => v.createdAt >= start.getTime()).length;
  await chrome.action.setBadgeBackgroundColor({ color: '#17202b' });
  await chrome.action.setBadgeText({ text: today ? String(today) : '' });
}

export async function saveVocabulary(payload) {
  const surface = normalizeSurface(payload.surface);
  if (!surface) throw new Error('There is no word to save');
  if (surface.length > 200) throw new Error('The selection is too long to save as vocabulary');

  const now = Date.now();
  const language = payload.language === 'ja' ? 'ja' : 'en';
  const lemma = language === 'ja' ? (payload.lemma || surface) : computeLemma(surface);
  let vocab = await findByLemma(lemma, language);
  let created = false;

  if (!vocab) {
    const lk = payload.lookupResult || (await lookup(surface, { source: language, kind: language === 'ja' ? 'ja-phrase' : 'word' }).catch(() => null));
    vocab = {
      id: uuid(),
      language,
      kind: language === 'ja' ? (Array.from(surface).length > 6 ? 'phrase' : 'word') : /\s/.test(surface) ? 'phrase' : 'word',
      lemma,
      surface,
      reading: payload.reading || lk?.reading || '',
      status: 'new',              // new | learning | known | ignored
      quickMeaning: lk?.translation || null,
      quickDict: lk?.dict?.length
        ? lk.dict
        : (lk?.offline?.lines || []).map((l) => ({ pos: l.label, terms: l.text.split(';').map((t) => t.trim()).filter(Boolean) })),
      ipa: lk?.ipa || null,
      audio: lk?.audio || null,
      enrichment: null,
      enrichmentStatus: 'pending', // pending | processing | done | failed | skipped
      enrichmentError: null,
      enrichmentAttempts: 0,
      exposureCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    created = true;
  }

  const existing = await db.getAllByIndex('exposures', 'vocabularyId', vocab.id);
  const sentence = String(payload.sentence || '').trim();
  const duplicate = existing.find((e) => e.url === (payload.url || '') && e.sentence === sentence);
  let exposure = duplicate || null;
  if (!duplicate) {
    exposure = {
      id: uuid(),
      vocabularyId: vocab.id,
      surface,
      sentence,
      paragraph: String(payload.paragraph || '').slice(0, 2000),
      url: payload.url || '',
      pageTitle: payload.pageTitle || '',
      encounteredAt: now,
    };
    await db.put('exposures', exposure);
    vocab.exposureCount = existing.length + 1;
  }
  vocab.updatedAt = now;
  await db.put('vocabulary', vocab);
  await enqueueOutbox('vocabulary.save', { vocabulary: vocab, exposure });
  await broadcast({ vocabularyId: vocab.id });
  return { vocabulary: vocab, exposure, created, duplicateExposure: !!duplicate };
}

export async function undoSave({ vocabularyId, exposureId, created }) {
  if (created && vocabularyId) {
    await deleteVocabulary(vocabularyId);
    return { removed: 'vocabulary' };
  }
  if (exposureId) {
    await db.delete('exposures', exposureId);
    const vocab = await db.get('vocabulary', vocabularyId);
    if (vocab) {
      vocab.exposureCount = Math.max(0, (vocab.exposureCount || 1) - 1);
      await db.put('vocabulary', vocab);
    }
    await broadcast({ vocabularyId });
    return { removed: 'exposure' };
  }
  return { removed: null };
}

export async function deleteVocabulary(id) {
  const exposures = await db.getAllByIndex('exposures', 'vocabularyId', id);
  await db.bulkDelete('exposures', exposures.map((e) => e.id));
  await db.delete('vocabulary', id);
  await enqueueOutbox('vocabulary.delete', { id });
  await broadcast({ vocabularyId: id, deleted: true });
}

export async function deleteExposure(id) {
  const exposure = await db.get('exposures', id);
  if (!exposure) return;
  await db.delete('exposures', id);
  const vocab = await db.get('vocabulary', exposure.vocabularyId);
  if (vocab) {
    vocab.exposureCount = Math.max(0, (vocab.exposureCount || 1) - 1);
    await db.put('vocabulary', vocab);
  }
  await broadcast({ vocabularyId: exposure.vocabularyId });
}

export async function updateVocabulary(id, patch) {
  const vocab = await db.get('vocabulary', id);
  if (!vocab) throw new Error('Word not found');
  const allowed = ['status', 'lemma', 'surface', 'quickMeaning', 'enrichmentStatus', 'note'];
  for (const k of allowed) if (k in patch) vocab[k] = patch[k];
  vocab.updatedAt = Date.now();
  await db.put('vocabulary', vocab);
  await enqueueOutbox('vocabulary.update', { id, patch });
  await broadcast({ vocabularyId: id });
  return vocab;
}

// Move everything from `removeId` into `keepId` (used when enrichment reveals the same lemma).
export async function mergeVocabulary(keepId, removeId) {
  if (keepId === removeId) return;
  const keep = await db.get('vocabulary', keepId);
  const remove = await db.get('vocabulary', removeId);
  if (!keep || !remove) return;
  const exposures = await db.getAllByIndex('exposures', 'vocabularyId', removeId);
  await db.bulkPut('exposures', exposures.map((e) => ({ ...e, vocabularyId: keepId })));
  keep.exposureCount = (await db.getAllByIndex('exposures', 'vocabularyId', keepId)).length;
  if (!keep.enrichment && remove.enrichment) {
    keep.enrichment = remove.enrichment;
    keep.enrichmentStatus = 'done';
  }
  if (!keep.ipa && remove.ipa) keep.ipa = remove.ipa;
  if (!keep.audio && remove.audio) keep.audio = remove.audio;
  keep.updatedAt = Date.now();
  await db.put('vocabulary', keep);
  await db.delete('vocabulary', removeId);
  await broadcast({ vocabularyId: keepId });
}

export async function listVocabulary({ query = '', status = '', enrichment = '', language = '', sort = 'newest', limit = 0, offset = 0, since = 0 } = {}) {
  let rows = await db.getAll('vocabulary');
  const q = query.trim().toLowerCase();
  if (language) rows = rows.filter((v) => (v.language || 'en') === language);
  if (q) {
    rows = rows.filter((v) =>
      v.lemma.toLowerCase().includes(q) ||
      (v.reading || '').includes(q) ||
      v.surface.toLowerCase().includes(q) ||
      (v.quickMeaning || '').toLowerCase().includes(q) ||
      (v.enrichment?.meaningVi || '').toLowerCase().includes(q) ||
      (v.enrichment?.meaningInContext || '').toLowerCase().includes(q));
  }
  if (status) rows = rows.filter((v) => v.status === status);
  if (enrichment) rows = rows.filter((v) => v.enrichmentStatus === enrichment);
  if (since) rows = rows.filter((v) => v.createdAt >= since);
  const sorters = {
    newest: (a, b) => b.createdAt - a.createdAt,
    oldest: (a, b) => a.createdAt - b.createdAt,
    alpha: (a, b) => a.lemma.localeCompare(b.lemma),
    exposures: (a, b) => (b.exposureCount || 0) - (a.exposureCount || 0) || b.createdAt - a.createdAt,
    priority: (a, b) => (b.enrichment?.learningPriority || 0) - (a.enrichment?.learningPriority || 0) || b.createdAt - a.createdAt,
  };
  rows.sort(sorters[sort] || sorters.newest);
  const total = rows.length;
  if (offset) rows = rows.slice(offset);
  if (limit) rows = rows.slice(0, limit);
  return { total, items: rows };
}

export async function getVocabularyDetail(id) {
  const vocab = await db.get('vocabulary', id);
  if (!vocab) throw new Error('Word not found');
  const exposures = (await db.getAllByIndex('exposures', 'vocabularyId', id)).sort((a, b) => b.encounteredAt - a.encounteredAt);
  const lookups = (await db.get('lookups', vocab.lemma)) || null;
  return { vocabulary: vocab, exposures, lookups };
}

export async function recordLookup(text, { url = '', title = '', language = 'en' } = {}) {
  const surface = normalizeSurface(text);
  if (!surface || /\s/.test(surface)) return null;
  const lemma = computeLemma(surface, language);
  const now = Date.now();
  const row = (await db.get('lookups', lemma)) || { lemma, count: 0, firstSeenAt: now, lastSeenAt: now, surfaces: [], sites: [] };
  row.count += 1;
  row.lastSeenAt = now;
  const s = surface.toLowerCase();
  if (!row.surfaces.includes(s)) row.surfaces = [...row.surfaces, s].slice(-10);
  let host = '';
  try { host = new URL(url).hostname; } catch (_) { /* ignore */ }
  if (host && !row.sites.includes(host)) row.sites = [...row.sites, host].slice(-10);
  await db.put('lookups', row);
  return row;
}

export async function getLookup(text, language = 'en') {
  const surface = normalizeSurface(text);
  if (!surface) return null;
  return (await db.get('lookups', computeLemma(surface, language))) || null;
}

export async function frequentLookups({ min = 3, limit = 20 } = {}) {
  const rows = await db.getAll('lookups');
  const vocab = await db.getAll('vocabulary');
  const saved = new Set(vocab.map((v) => v.lemma));
  return rows
    .filter((r) => r.count >= min && !saved.has(r.lemma))
    .sort((a, b) => b.count - a.count || b.lastSeenAt - a.lastSeenAt)
    .slice(0, limit);
}

export async function stats() {
  const vocab = await db.getAll('vocabulary');
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const byStatus = {};
  const byCefr = {};
  const byEnrichment = {};
  const byLanguage = {};
  for (const v of vocab) {
    byStatus[v.status] = (byStatus[v.status] || 0) + 1;
    byEnrichment[v.enrichmentStatus] = (byEnrichment[v.enrichmentStatus] || 0) + 1;
    byLanguage[v.language || 'en'] = (byLanguage[v.language || 'en'] || 0) + 1;
    const c = v.enrichment?.cefr || v.enrichment?.level || '?';
    byCefr[c] = (byCefr[c] || 0) + 1;
  }
  return {
    total: vocab.length,
    today: vocab.filter((v) => v.createdAt >= startOfDay.getTime()).length,
    week: vocab.filter((v) => v.createdAt >= weekAgo).length,
    exposures: await db.count('exposures'),
    lookups: await db.count('lookups'),
    byStatus,
    byCefr,
    byEnrichment,
    byLanguage,
    pending: (byEnrichment.pending || 0) + (byEnrichment.processing || 0),
  };
}

export async function exportAll() {
  return {
    app: 'readlex',
    version: 1,
    exportedAt: new Date().toISOString(),
    vocabulary: await db.getAll('vocabulary'),
    exposures: await db.getAll('exposures'),
    lookups: await db.getAll('lookups'),
  };
}

export async function importAll(data) {
  if (!data || data.app !== 'readlex' || !Array.isArray(data.vocabulary)) throw new Error('This file is not a ReadLex backup');
  const existing = await db.getAll('vocabulary');
  const byLemma = new Map(existing.map((v) => [v.lemma, v]));
  const idMap = new Map();
  const vocabToPut = [];
  for (const v of data.vocabulary) {
    const dup = byLemma.get(v.lemma);
    if (dup) { idMap.set(v.id, dup.id); continue; }
    idMap.set(v.id, v.id);
    vocabToPut.push(v);
    byLemma.set(v.lemma, v);
  }
  const exposuresToPut = (data.exposures || [])
    .filter((e) => idMap.has(e.vocabularyId))
    .map((e) => ({ ...e, vocabularyId: idMap.get(e.vocabularyId) }));
  await db.bulkPut('vocabulary', vocabToPut);
  await db.bulkPut('exposures', exposuresToPut);
  if (Array.isArray(data.lookups)) await db.bulkPut('lookups', data.lookups);
  // recount exposures
  const all = await db.getAll('vocabulary');
  const exps = await db.getAll('exposures');
  const counts = {};
  for (const e of exps) counts[e.vocabularyId] = (counts[e.vocabularyId] || 0) + 1;
  await db.bulkPut('vocabulary', all.map((v) => ({ ...v, exposureCount: counts[v.id] || 0 })));
  await broadcast();
  return { vocabulary: vocabToPut.length, exposures: exposuresToPut.length, skipped: data.vocabulary.length - vocabToPut.length };
}

export async function clearAllData() {
  for (const store of ['vocabulary', 'exposures', 'lookups', 'outbox']) await db.clear(store);
  await broadcast();
}

// ---- backend sync (inactive until a backend URL is configured in settings) ----

async function backend() {
  const { settings } = await chrome.storage.local.get('settings');
  if (!settings?.backendUrl || !settings?.backendToken) return null;
  return { url: settings.backendUrl.replace(/\/$/, ''), token: settings.backendToken };
}

async function backendFetch(path, { method = 'GET', body = null, timeout = 15000, url = null, token = null } = {}) {
  const be = url ? { url: url.replace(/\/$/, ''), token: token || '' } : await backend();
  if (!be) throw new Error('Not signed in to the server');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${be.url}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(be.token ? { Authorization: `Bearer ${be.token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (res.status === 401 && !url) {
      // session expired or revoked: forget the token so the UI asks to log in again
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...(settings || {}), backendToken: '' } });
      await setSyncState({ lastError: 'Your session expired. Sign in again in Settings', lastErrorAt: Date.now() });
    }
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function backendLogin({ url, email, password, register = false, inviteCode = '' }) {
  const base = String(url || '').trim().replace(/\/$/, '');
  if (!base) throw new Error('The server address is missing');
  const label = `extension · ${navigator.platform || 'device'}`;
  const data = register
    ? await backendFetch('/api/v1/auth/register', { method: 'POST', url: base, body: { email, password, inviteCode, kind: 'extension' } })
    : await backendFetch('/api/v1/auth/login', { method: 'POST', url: base, body: { email, password, kind: 'extension', label } });
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...(settings || {}), backendUrl: base, backendToken: data.token, backendEmail: data.user.email } });
  await setSyncState({ lastError: null });
  scheduleFlush();
  return data.user;
}

export async function backendLogout() {
  try { await backendFetch('/api/v1/auth/logout', { method: 'POST' }); } catch (_) { /* ignore */ }
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...(settings || {}), backendToken: '', backendEmail: '' } });
}

export async function backendMe() {
  return backendFetch('/api/v1/auth/me');
}

export async function backendSetGemini({ apiKey, model }) {
  return backendFetch('/api/v1/me/gemini', { method: 'PUT', body: { apiKey, model } });
}

async function setSyncState(patch) {
  const { syncState } = await chrome.storage.local.get('syncState');
  await chrome.storage.local.set({ syncState: { ...(syncState || {}), ...patch } });
}

export async function syncState() {
  const { syncState: st } = await chrome.storage.local.get('syncState');
  const { settings } = await chrome.storage.local.get('settings');
  return { ...(st || {}), pending: await db.count('outbox'), configured: !!(await backend()), hasUrl: !!settings?.backendUrl, email: settings?.backendEmail || '' };
}

let flushTimer = null;
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; flushOutbox().catch(() => {}); }, 400);
}

export async function enqueueOutbox(op, payload) {
  if (!(await backend())) return;
  await db.put('outbox', { op, payload, createdAt: Date.now(), attempts: 0 });
  scheduleFlush();
}

let flushing = false;
export async function flushOutbox() {
  if (flushing) return { skipped: 'running' };
  if (!(await backend())) return { sent: 0, remaining: 0 };
  flushing = true;
  try {
    const items = (await db.getAll('outbox')).sort((a, b) => a.id - b.id);
    let sent = 0;
    for (const item of items) {
      try {
        const data = await backendFetch('/api/v1/sync', { method: 'POST', body: { op: item.op, payload: item.payload, clientCreatedAt: item.createdAt } });
        if (item.op === 'vocabulary.save' && data?.vocabularyId && item.payload?.vocabulary?.id) {
          const local = await db.get('vocabulary', item.payload.vocabulary.id);
          if (local && local.serverId !== data.vocabularyId) { local.serverId = data.vocabularyId; await db.put('vocabulary', local); }
        }
        await db.delete('outbox', item.id);
        sent += 1;
      } catch (err) {
        item.attempts = (item.attempts || 0) + 1;
        item.lastError = err.message;
        await db.put('outbox', item);
        await setSyncState({ lastError: err.message, lastErrorAt: Date.now() });
        if (item.attempts >= 50) await db.delete('outbox', item.id);
        break;
      }
    }
    if (sent) await setSyncState({ lastSyncAt: Date.now(), lastError: null });
    return { sent, remaining: (await db.count('outbox')) };
  } finally {
    flushing = false;
  }
}

// Copy Gemini results produced on the server into the local copy (popup / vocabulary page).
export async function pullEnriched({ max = 15 } = {}) {
  if (!(await backend())) return { pulled: 0 };
  const rows = (await db.getAll('vocabulary')).filter((v) => v.serverId && v.enrichmentStatus !== 'done').slice(0, max);
  let pulled = 0;
  for (const v of rows) {
    try {
      const data = await backendFetch(`/api/v1/vocabulary/${encodeURIComponent(v.serverId)}`);
      const sv = data?.vocabulary;
      if (!sv) continue;
      if (sv.enrichmentStatus === 'done' && sv.enrichment) {
        const fresh = await db.get('vocabulary', v.id);
        if (!fresh) continue;
        fresh.enrichment = sv.enrichment;
        fresh.enrichmentStatus = 'done';
        fresh.enrichmentError = null;
        if (!fresh.ipa && sv.ipa) fresh.ipa = sv.ipa;
        if (!fresh.reading && sv.reading) fresh.reading = sv.reading;
        fresh.updatedAt = Date.now();
        await db.put('vocabulary', fresh);
        pulled += 1;
      } else if (sv.enrichmentStatus === 'failed') {
        const fresh = await db.get('vocabulary', v.id);
        if (fresh) { fresh.enrichmentStatus = 'failed'; fresh.enrichmentError = sv.enrichmentError || 'Server: AI failed'; await db.put('vocabulary', fresh); }
      }
    } catch (err) {
      if (/HTTP 404/.test(err.message)) { const fresh = await db.get('vocabulary', v.id); if (fresh) { delete fresh.serverId; await db.put('vocabulary', fresh); } }
      else break;
    }
  }
  if (pulled) await broadcast();
  return { pulled };
}

export async function backendHealth(url = null) {
  return backendFetch('/api/v1/health', { timeout: 10000, ...(url ? { url } : {}) });
}

// Push everything the extension has (export format) to the server; server dedupes by lemma.
export async function backendImport() {
  const data = await exportAll();
  const result = await backendFetch('/api/v1/import', { method: 'POST', body: data, timeout: 120000 });
  // the server tells us which id each local word got
  const idMap = result?.idMap || {};
  const local = await db.getAll('vocabulary');
  const updates = local.filter((v) => idMap[v.id]).map((v) => ({ ...v, serverId: idMap[v.id] }));
  if (updates.length) await db.bulkPut('vocabulary', updates);
  await setSyncState({ lastSyncAt: Date.now(), lastError: null, lastImportAt: Date.now() });
  return result;
}
