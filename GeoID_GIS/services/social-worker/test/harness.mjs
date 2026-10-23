/**
 * The Worker, run in node against the real schema.
 *
 * D1 is SQLite, and node 22+ ships SQLite as node:sqlite, so the shim below is
 * the D1 surface the Worker uses (prepare/bind/first/all/run/batch) over an
 * in-memory database loaded from migrations/*.sql -- the same files wrangler
 * applies. R2 is a Map.
 *
 *   import { makeEnv, call } from "./harness.mjs";
 *   const env = makeEnv();
 *   const res = await call(env, "POST", "/v1/posts", { as: "ana@example.com", body: {...} });
 *   res.status, res.body
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../worker.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, "..", "migrations");

class Statement {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) {
    return new Statement(this.db, this.sql, args.map((a) => (a === undefined ? null : typeof a === "boolean" ? Number(a) : a)));
  }
  async first(column) {
    const row = this.db.prepare(this.sql).get(...this.args);
    if (!row) return null;
    const plain = { ...row };
    return column ? plain[column] : plain;
  }
  async all() {
    return { results: this.db.prepare(this.sql).all(...this.args).map((r) => ({ ...r })), success: true };
  }
  async run() {
    const info = this.db.prepare(this.sql).run(...this.args);
    return { success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  }
}

export function makeD1() {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  return {
    raw: db,
    prepare: (sql) => new Statement(db, sql),
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        db.exec("COMMIT");
        return out;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async exec(sql) { db.exec(sql); return { count: 1 }; },
  };
}

export function makeR2() {
  const store = new Map();
  return {
    store,
    async put(key, value, opts = {}) {
      const bytes = value instanceof ArrayBuffer ? new Uint8Array(value)
        : value instanceof Uint8Array ? value : new TextEncoder().encode(String(value));
      store.set(key, { bytes, httpMetadata: opts.httpMetadata || {} });
      return { key };
    },
    async get(key) {
      const hit = store.get(key);
      if (!hit) return null;
      return {
        body: new Blob([hit.bytes]).stream(),
        httpMetadata: hit.httpMetadata,
        size: hit.bytes.length,
        writeHttpMetadata(headers) {
          if (hit.httpMetadata.contentType) headers.set("content-type", hit.httpMetadata.contentType);
        },
        async arrayBuffer() { return hit.bytes.buffer; },
      };
    },
    async delete(key) { store.delete(key); },
  };
}

export function makeEnv(overrides = {}) {
  return {
    DB: makeD1(),
    MEDIA: makeR2(),
    JWT_SECRET: "test-secret",
    SELF_ORIGIN: "http://localhost:8790",
    SITE_ORIGIN: "http://localhost:8125",
    RETURN_ORIGINS: "http://localhost:8125",
    ADMINS: "admin@example.com",
    WRITES_PER_MIN: "1000",
    DEV_AUTH: "1",
    ...overrides,
  };
}

/**
 * One request. `as` signs in through DEV_AUTH (X-Dev-User at localhost);
 * `token` sends a Bearer instead; `form` sends multipart FormData.
 */
export async function call(env, method, path, { as, token, body, form, headers = {} } = {}) {
  const h = { Origin: "http://localhost:8125", ...headers };
  if (as) h["X-Dev-User"] = as;
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { payload = JSON.stringify(body); h["content-type"] = "application/json"; }
  const request = new Request(`http://localhost:8790${path}`, { method, headers: h, body: payload });
  const response = await worker.fetch(request, env);
  const type = response.headers.get("content-type") || "";
  const parsed = type.includes("json") ? await response.json() : await response.arrayBuffer();
  return { status: response.status, body: parsed, headers: response.headers };
}
