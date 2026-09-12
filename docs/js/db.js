// IndexedDB Wrapper - Local-first data layer
// Stores: vocabulary, srs_cards, daily_words, daily_quiz, daily_progress,
//         reading_history, speaking_history, listening_history, kv, outbox

const DB_NAME = 'english-ai-workbench';
const DB_VERSION = 1;

const STORES = {
  vocabulary: { keyPath: 'id' },
  srs_cards: { keyPath: 'id' },
  daily_words: { keyPath: 'id', indexes: [{ name: 'date', keyPath: 'date' }] },
  daily_quiz: { keyPath: 'id', indexes: [{ name: 'date', keyPath: 'date' }] },
  daily_progress: { keyPath: 'date' },
  reading_history: { keyPath: 'id' },
  speaking_history: { keyPath: 'id' },
  listening_history: { keyPath: 'id' },
  kv: { keyPath: 'key' },
  outbox: { keyPath: 'id', autoIncrement: true },
};

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      for (const [name, cfg] of Object.entries(STORES)) {
        let store;
        if (!db.objectStoreNames.contains(name)) {
          store = db.createObjectStore(name, { keyPath: cfg.keyPath, autoIncrement: !!cfg.autoIncrement });
        } else {
          store = e.target.transaction.objectStore(name);
        }
        if (cfg.indexes) {
          for (const idx of cfg.indexes) {
            if (!store.indexNames.contains(idx.name)) {
              store.createIndex(idx.name, idx.keyPath, { unique: false });
            }
          }
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    const result = fn(store);
    t.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const DB = {
  async init() {
    await openDB();
  },

  async getAll(storeName) {
    const db = await openDB();
    const t = db.transaction(storeName, 'readonly');
    return reqToPromise(t.objectStore(storeName).getAll());
  },

  async get(storeName, key) {
    const db = await openDB();
    const t = db.transaction(storeName, 'readonly');
    return reqToPromise(t.objectStore(storeName).get(key));
  },

  async put(storeName, value) {
    const db = await openDB();
    const t = db.transaction(storeName, 'readwrite');
    return reqToPromise(t.objectStore(storeName).put(value));
  },

  async bulkPut(storeName, values) {
    if (!values || values.length === 0) return;
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(storeName, 'readwrite');
      const store = t.objectStore(storeName);
      values.forEach((v) => store.put(v));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },

  async delete(storeName, key) {
    const db = await openDB();
    const t = db.transaction(storeName, 'readwrite');
    return reqToPromise(t.objectStore(storeName).delete(key));
  },

  async clear(storeName) {
    const db = await openDB();
    const t = db.transaction(storeName, 'readwrite');
    return reqToPromise(t.objectStore(storeName).clear());
  },

  async queryByIndex(storeName, indexName, value) {
    const db = await openDB();
    const t = db.transaction(storeName, 'readonly');
    const idx = t.objectStore(storeName).index(indexName);
    return reqToPromise(idx.getAll(value));
  },

  // --- Key-value helpers ---
  async kvGet(key, defaultVal = null) {
    try {
      const row = await DB.get('kv', key);
      return row ? row.value : defaultVal;
    } catch (e) {
      return defaultVal;
    }
  },

  async kvSet(key, value) {
    return DB.put('kv', { key, value });
  },

  // --- Outbox (offline operation queue) ---
  async outboxEnqueue(type, payload) {
    return DB.put('outbox', { type, payload, ts: Date.now() });
  },

  async outboxAll() {
    const items = await DB.getAll('outbox');
    return items.sort((a, b) => a.ts - b.ts);
  },

  async outboxRemove(id) {
    return DB.delete('outbox', id);
  },

  async outboxCount() {
    const items = await DB.getAll('outbox');
    return items.length;
  },

  // --- Convenience: today's date string (local timezone) ---
  todayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  // --- Convenience: generate a local-only id ---
  localId(prefix) {
    return `${prefix}_local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  },
};
