/**
 * Remembering the projects folder between sessions.
 *
 * A `FileSystemDirectoryHandle` is structured-cloneable, so IndexedDB can hold
 * it — localStorage cannot, it only takes strings. Permission does not survive
 * a reload, so the handle comes back needing `queryPermission`, and asking to
 * re-grant it needs a user gesture; the store handles that, this file only
 * keeps the handle.
 */

const DB_NAME = "geoid-research";
const DB_VERSION = 1;
const STORE = "handles";
const ROOT_KEY = "projects-root";

function openDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const result = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result.result ?? null);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function saveRootHandle(handle) {
  try {
    await withStore("readwrite", (store) => store.put(handle, ROOT_KEY));
  } catch (error) {
    // Not being able to remember the folder is a smaller problem than not
    // being able to use it, so this never blocks opening a project.
    console.warn("[research] could not remember the projects folder:", error.message);
  }
}

export async function loadRootHandle() {
  try {
    return await withStore("readonly", (store) => store.get(ROOT_KEY));
  } catch (error) {
    return null;
  }
}

export async function clearRootHandle() {
  try {
    await withStore("readwrite", (store) => store.delete(ROOT_KEY));
  } catch (error) { /* nothing stored, nothing to clear */ }
}
