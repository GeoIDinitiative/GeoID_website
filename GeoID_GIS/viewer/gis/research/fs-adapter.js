/**
 * A tiny filesystem interface, and two implementations.
 *
 * The store talks to this rather than to `FileSystemDirectoryHandle` directly
 * for one practical reason: `showDirectoryPicker` opens a native dialog that a
 * headless browser cannot drive, so without a seam here everything downstream
 * of the picker -- the whole project layout, the schema, the registry -- would
 * be untestable. The in-memory adapter lets all of that be checked exactly,
 * leaving only the picker itself for a manual look.
 *
 * Paths are POSIX-style and relative to the adapter's root: "metadata/project.json".
 */

function parts(path) {
  return String(path).split("/").filter(Boolean);
}

// ── Real: File System Access API ──────────────────────────────────────────────

export function directoryAdapter(rootHandle) {
  async function dirFor(segments, create) {
    let handle = rootHandle;
    for (const segment of segments) {
      handle = await handle.getDirectoryHandle(segment, { create });
    }
    return handle;
  }

  return {
    kind: "disk",
    name: rootHandle.name,

    async ensureDir(path) {
      await dirFor(parts(path), true);
    },

    async writeFile(path, contents) {
      const segments = parts(path);
      const name = segments.pop();
      const dir = await dirFor(segments, true);
      const file = await dir.getFileHandle(name, { create: true });
      const stream = await file.createWritable();
      await stream.write(contents);
      await stream.close();
    },

    async readFile(path) {
      const segments = parts(path);
      const name = segments.pop();
      const dir = await dirFor(segments, false);
      const file = await dir.getFileHandle(name, { create: false });
      return (await file.getFile()).text();
    },

    async exists(path) {
      const segments = parts(path);
      if (!segments.length) return true;
      const name = segments.pop();
      try {
        const dir = await dirFor(segments, false);
        try {
          await dir.getDirectoryHandle(name, { create: false });
          return true;
        } catch (error) {
          await dir.getFileHandle(name, { create: false });
          return true;
        }
      } catch (error) {
        return false;
      }
    },

    /** @returns {Promise<Array<{name: string, kind: "file"|"directory"}>>} */
    async list(path = "") {
      const dir = await dirFor(parts(path), false);
      const out = [];
      for await (const [name, handle] of dir.entries()) {
        out.push({ name, kind: handle.kind });
      }
      return out.sort((a, b) => (a.kind === b.kind
        ? a.name.localeCompare(b.name)
        : a.kind === "directory" ? -1 : 1));
    },

    async remove(path) {
      const segments = parts(path);
      const name = segments.pop();
      const dir = await dirFor(segments, false);
      await dir.removeEntry(name, { recursive: true });
    },
  };
}

// ── In-memory, for tests ──────────────────────────────────────────────────────

export function memoryAdapter(name = "memory") {
  // Directories are tracked explicitly, so an empty one still exists -- which
  // matters here, because most of a fresh project's tree is empty directories.
  const dirs = new Set([""]);
  const files = new Map();

  function addDirs(path) {
    const segments = parts(path);
    for (let i = 1; i <= segments.length; i += 1) {
      dirs.add(segments.slice(0, i).join("/"));
    }
  }

  return {
    kind: "memory",
    name,

    async ensureDir(path) { addDirs(path); },

    async writeFile(path, contents) {
      const segments = parts(path);
      segments.pop();
      addDirs(segments.join("/"));
      // Stored as given rather than stringified: a Blob would become the text
      // "[object Blob]", which looks written and reads back as nonsense.
      files.set(parts(path).join("/"), contents);
    },

    async readFile(path) {
      const key = parts(path).join("/");
      if (!files.has(key)) throw new Error(`no such file: ${path}`);
      return files.get(key);
    },

    async exists(path) {
      const key = parts(path).join("/");
      return files.has(key) || dirs.has(key);
    },

    async list(path = "") {
      const base = parts(path).join("/");
      const prefix = base ? `${base}/` : "";
      const seen = new Map();
      for (const key of dirs) {
        if (!key || !key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (!rest || rest.includes("/")) continue;
        seen.set(rest, "directory");
      }
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (!rest || rest.includes("/")) continue;
        seen.set(rest, "file");
      }
      return [...seen.entries()]
        .map(([entryName, kind]) => ({ name: entryName, kind }))
        .sort((a, b) => (a.kind === b.kind
          ? a.name.localeCompare(b.name)
          : a.kind === "directory" ? -1 : 1));
    },

    async remove(path) {
      const key = parts(path).join("/");
      files.delete(key);
      dirs.delete(key);
      for (const other of [...files.keys()]) {
        if (other.startsWith(`${key}/`)) files.delete(other);
      }
      for (const other of [...dirs]) {
        if (other.startsWith(`${key}/`)) dirs.delete(other);
      }
    },
  };
}


// ── Browser storage ──────────────────────────────────────────────────────────

/**
 * The same tree, kept in IndexedDB instead of on disk.
 *
 * `showDirectoryPicker` needs a **secure context**, and it does not exist in
 * Firefox or Safari at all. So the whole Research Hub was unusable unless you
 * happened to be in Chrome on https or localhost -- open the very same server
 * on http://0.0.0.0:8125 and no project could ever be created, which read as
 * every page being broken.
 *
 * IndexedDB has neither restriction. This is not a substitute for the folder
 * -- nothing here is visible to the desktop app, and clearing site data throws
 * it away -- so callers must say so plainly and offer the export. It is the
 * difference between a hub that works and one that does not.
 */

const DB_NAME = "geoid-projects";
const STORE = "tree";
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // Key is the full path; `kind` distinguishes a directory record from a
        // file, so an empty directory still exists -- most of a fresh project's
        // tree is empty directories.
        db.createObjectStore(STORE, { keyPath: "path" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(db, mode, run) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    let result;
    try { result = run(store); } catch (error) { reject(error); return; }
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

const asPromise = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export async function indexedDbAdapter(name = "browser storage") {
  const db = await openDb();

  const putDirs = async (path) => {
    const segments = parts(path);
    await tx(db, "readwrite", (store) => {
      for (let i = 1; i <= segments.length; i += 1) {
        store.put({ path: segments.slice(0, i).join("/"), kind: "directory" });
      }
    });
  };

  return {
    kind: "indexeddb",
    name,

    async ensureDir(path) { await putDirs(path); },

    async writeFile(path, contents) {
      const segments = parts(path);
      segments.pop();
      if (segments.length) await putDirs(segments.join("/"));
      // Stored as given. A Blob survives structured clone, so binary imports
      // round-trip without being stringified into "[object Blob]".
      await tx(db, "readwrite", (store) =>
        store.put({ path: parts(path).join("/"), kind: "file", contents }));
    },

    async readFile(path) {
      const key = parts(path).join("/");
      const record = await tx(db, "readonly", (store) => asPromise(store.get(key)));
      if (!record || record.kind !== "file") throw new Error(`no such file: ${path}`);
      return record.contents;
    },

    async exists(path) {
      const key = parts(path).join("/");
      const record = await tx(db, "readonly", (store) => asPromise(store.get(key)));
      return Boolean(record);
    },

    async list(path = "") {
      const base = parts(path).join("/");
      const prefix = base ? `${base}/` : "";
      const keys = await tx(db, "readonly", (store) => asPromise(store.getAll()));
      const seen = new Map();
      for (const record of keys) {
        if (!record.path.startsWith(prefix) || record.path === base) continue;
        const rest = record.path.slice(prefix.length);
        if (!rest || rest.includes("/")) continue;
        seen.set(rest, record.kind);
      }
      return [...seen.entries()]
        .map(([entryName, kind]) => ({ name: entryName, kind }))
        .sort((a, b) => (a.kind === b.kind
          ? a.name.localeCompare(b.name)
          : a.kind === "directory" ? -1 : 1));
    },

    async remove(path) {
      const key = parts(path).join("/");
      const all = await tx(db, "readonly", (store) => asPromise(store.getAll()));
      await tx(db, "readwrite", (store) => {
        store.delete(key);
        for (const record of all) {
          if (record.path.startsWith(`${key}/`)) store.delete(record.path);
        }
      });
    },
  };
}
