// Promise wrapper around IndexedDB. All persistent data of the extension lives here.
//
// Stores:
//   vocabulary  - one row per lemma (word or phrase)
//   exposures   - every sentence/page where a vocabulary item was saved
//   lookups     - how often a lemma was looked up (hover / selection), even if never saved
//   cache       - translation lookups (Google / dictionary) with timestamp
//   outbox      - pending sync operations for the (future) backend

const DB_NAME = 'readlex';
const DB_VERSION = 1;
let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('vocabulary')) {
        const s = db.createObjectStore('vocabulary', { keyPath: 'id' });
        s.createIndex('lemma', 'lemma');
        s.createIndex('createdAt', 'createdAt');
        s.createIndex('status', 'status');
        s.createIndex('enrichmentStatus', 'enrichmentStatus');
      }
      if (!db.objectStoreNames.contains('exposures')) {
        const s = db.createObjectStore('exposures', { keyPath: 'id' });
        s.createIndex('vocabularyId', 'vocabularyId');
        s.createIndex('encounteredAt', 'encounteredAt');
      }
      if (!db.objectStoreNames.contains('lookups')) {
        const s = db.createObjectStore('lookups', { keyPath: 'lemma' });
        s.createIndex('lastSeenAt', 'lastSeenAt');
        s.createIndex('count', 'count');
      }
      if (!db.objectStoreNames.contains('cache')) {
        const s = db.createObjectStore('cache', { keyPath: 'key' });
        s.createIndex('cachedAt', 'cachedAt');
      }
      if (!db.objectStoreNames.contains('outbox')) {
        db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(name, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const store = tx.objectStore(name);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    Promise.resolve()
      .then(() => fn(store))
      .then((r) => { result = r; })
      .catch((err) => { try { tx.abort(); } catch (_) { /* ignore */ } reject(err); });
  });
}

export const db = {
  get: (store, key) => withStore(store, 'readonly', (s) => promisify(s.get(key))),
  getAll: (store, query, count) => withStore(store, 'readonly', (s) => promisify(s.getAll(query, count))),
  getAllByIndex: (store, index, query) => withStore(store, 'readonly', (s) => promisify(s.index(index).getAll(query))),
  put: (store, value) => withStore(store, 'readwrite', (s) => promisify(s.put(value))),
  bulkPut: (store, values) => withStore(store, 'readwrite', (s) => { values.forEach((v) => s.put(v)); }),
  delete: (store, key) => withStore(store, 'readwrite', (s) => promisify(s.delete(key))),
  bulkDelete: (store, keys) => withStore(store, 'readwrite', (s) => { keys.forEach((k) => s.delete(k)); }),
  count: (store) => withStore(store, 'readonly', (s) => promisify(s.count())),
  clear: (store) => withStore(store, 'readwrite', (s) => promisify(s.clear())),
};

export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
