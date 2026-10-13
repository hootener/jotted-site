// IndexedDB-backed jot store for the browser build. Same interface as the
// other stores. Migrates anything found in localStorage on first open.
import { newJot, normalizeJot } from './store.js?v=c12a0ee880';

const DB_NAME = 'jotted';
const DB_VERSION = 1;
const INDEX_KEY = 'jotted:index';
const JOT_PREFIX = 'jotted:jot:';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('jots')) db.createObjectStore('jots', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, stores, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const result = fn(t);
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function metaOf(jot) {
  return { id: jot.id, createdAt: jot.createdAt, updatedAt: jot.updatedAt, strokeCount: jot.strokes.length };
}

export function createIndexedDBStore(storage = globalThis.localStorage, now = Date.now) {
  let dbPromise = null;
  function db() {
    dbPromise ??= openDb().then(async (d) => {
      await migrateFromLocalStorage(d, storage);
      return d;
    });
    return dbPromise;
  }

  async function put(d, jot) {
    await tx(d, ['jots', 'meta'], 'readwrite', (t) => {
      t.objectStore('jots').put(jot);
      t.objectStore('meta').put(metaOf(jot));
    });
  }

  return {
    newJot: () => newJot(now),
    async listJots() {
      const d = await db();
      const all = await tx(d, ['meta'], 'readonly', (t) => t.objectStore('meta').getAll());
      return all.sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async loadJot(id) {
      const d = await db();
      const jot = await tx(d, ['jots'], 'readonly', (t) => t.objectStore('jots').get(id));
      return normalizeJot(jot ?? null, id);
    },
    async saveJot(jot) {
      jot.updatedAt = now();
      await put(await db(), jot);
      return jot;
    },
    async deleteJot(id) {
      const d = await db();
      await tx(d, ['jots', 'meta'], 'readwrite', (t) => {
        t.objectStore('jots').delete(id);
        t.objectStore('meta').delete(id);
      });
    },
  };

  async function migrateFromLocalStorage(d, storage) {
    if (!storage) return;
    let index;
    try {
      index = JSON.parse(storage.getItem(INDEX_KEY) || 'null');
    } catch {
      index = null;
    }
    if (!Array.isArray(index) || index.length === 0) return;
    for (const entry of index) {
      try {
        const jot = normalizeJot(JSON.parse(storage.getItem(JOT_PREFIX + entry.id) || 'null'), entry.id);
        if (jot) await put(d, jot);
      } catch { /* skip corrupt entries */ }
      storage.removeItem(JOT_PREFIX + entry.id);
    }
    storage.removeItem(INDEX_KEY);
  }
}
