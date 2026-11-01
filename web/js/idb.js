// Minimal IndexedDB helper shared by the page and the database worker.
// Stores: meta (install state), files (package files as Blobs, keyed "<slot>/<path>"),
//         user (bookmarks, saved searches, settings).
const DB_NAME = 'policehq';
const DB_VERSION = 1;
let dbPromise = null;

export function openIDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of ['meta', 'files', 'user']) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openIDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then(v => { out = v; });
    t.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('IndexedDB transaction aborted'));
  }));
}

export const idbGet = (store, key) => tx(store, 'readonly', s => s.get(key));
export const idbPut = (store, key, value) => tx(store, 'readwrite', s => { s.put(value, key); });
export const idbDelete = (store, key) => tx(store, 'readwrite', s => { s.delete(key); });
export const idbClear = (store) => tx(store, 'readwrite', s => { s.clear(); });

/** Delete every key starting with prefix. */
export function idbDeletePrefix(store, prefix) {
  return tx(store, 'readwrite', s => {
    s.delete(IDBKeyRange.bound(prefix, prefix + '￿'));
  });
}

export function idbKeys(store, prefix = '') {
  return tx(store, 'readonly', s => prefix
    ? s.getAllKeys(IDBKeyRange.bound(prefix, prefix + '￿'))
    : s.getAllKeys());
}
