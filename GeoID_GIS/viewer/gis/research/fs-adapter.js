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
      files.set(parts(path).join("/"), String(contents));
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
