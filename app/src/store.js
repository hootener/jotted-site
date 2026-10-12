// Jot persistence. Every store exposes the same async interface:
//   newJot() -> jot (no I/O)
//   listJots() -> Promise<[{id, createdAt, updatedAt, strokeCount}]> newest first
//   loadJot(id) -> Promise<jot | null>
//   saveJot(jot) -> Promise<jot>
//   deleteJot(id) -> Promise<void>
import { ulid } from './ulid.js';

const INDEX_KEY = 'jotted:index';
const JOT_PREFIX = 'jotted:jot:';

export function newJot(now = Date.now) {
  const t = now();
  return {
    id: ulid(t),
    createdAt: t,
    updatedAt: t,
    view: { x: 0, y: 0, scale: 1 },
    paper: 'none',
    theme: 'dark',
    strokes: [],
  };
}

export function normalizeJot(jot, id) {
  if (!jot || typeof jot !== 'object' || jot.id !== id) return null;
  jot.strokes ??= [];
  jot.view ??= { x: 0, y: 0, scale: 1 };
  jot.paper ??= 'none';
  jot.theme ??= 'dark';
  return jot;
}

/** Picks the file-backed store when running inside Electron, else localStorage. */
export function createStore() {
  if (globalThis.jotted?.jots) return createBridgeStore(globalThis.jotted.jots);
  return createLocalStorageStore(globalThis.localStorage);
}

/** Store backed by a preload bridge (Electron). The bridge does the file I/O. */
export function createBridgeStore(bridge, now = Date.now) {
  return {
    newJot: () => newJot(now),
    async listJots() {
      const list = await bridge.list();
      return list.sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async loadJot(id) {
      return normalizeJot(await bridge.load(id), id);
    },
    async saveJot(jot) {
      jot.updatedAt = now();
      await bridge.save(jot.id, jot);
      return jot;
    },
    async deleteJot(id) {
      await bridge.remove(id);
    },
  };
}

/** Store backed by Web Storage (browser build). */
export function createLocalStorageStore(storage, now = Date.now) {
  function readJSON(key, fallback) {
    try {
      const raw = storage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  function readIndex() {
    const idx = readJSON(INDEX_KEY, []);
    return Array.isArray(idx) ? idx : [];
  }
  function writeIndex(index) {
    storage.setItem(INDEX_KEY, JSON.stringify(index));
  }

  return {
    newJot: () => newJot(now),
    async listJots() {
      return readIndex().slice().sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async loadJot(id) {
      return normalizeJot(readJSON(JOT_PREFIX + id, null), id);
    },
    async saveJot(jot) {
      jot.updatedAt = now();
      storage.setItem(JOT_PREFIX + jot.id, JSON.stringify(jot));
      const entry = {
        id: jot.id,
        createdAt: jot.createdAt,
        updatedAt: jot.updatedAt,
        strokeCount: jot.strokes.length,
      };
      const index = readIndex().filter((e) => e.id !== jot.id);
      index.push(entry);
      writeIndex(index);
      return jot;
    },
    async deleteJot(id) {
      storage.removeItem(JOT_PREFIX + id);
      writeIndex(readIndex().filter((e) => e.id !== id));
    },
  };
}
