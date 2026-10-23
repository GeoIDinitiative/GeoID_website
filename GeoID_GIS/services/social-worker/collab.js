/**
 * Small helpers shared by the collaboration modules (communities, teams,
 * projects, reviews, messages, moderation, reputation). They live here rather
 * than in lib.js so the two halves of the Worker could be written at once
 * without both editing the same file; nothing in here decides a rule.
 */
import { readJson, decodeCursor, encodeCursor, PAGE, int } from "./lib.js";

export const body = (ctx) => readJson(ctx.request);
export const param = (ctx, name) => ctx.url.searchParams.get(name);

export async function all(env, sql, ...binds) {
  return (await env.DB.prepare(sql).bind(...binds).all()).results || [];
}
export async function one(env, sql, ...binds) {
  return env.DB.prepare(sql).bind(...binds).first();
}
export async function run(env, sql, ...binds) {
  return env.DB.prepare(sql).bind(...binds).run();
}

/** A page size from ?limit=, 1..50, defaulting to PAGE. */
export function limitOf(ctx, max = 50) {
  return Math.min(Math.max(int(param(ctx, "limit"), PAGE), 1), max);
}

/**
 * Keyset paging for `ORDER BY <timeCol> DESC, <idCol> DESC`: the SQL to append
 * after a WHERE and its binds. Keyset rather than OFFSET so a page does not
 * shift when something new arrives while somebody is scrolling.
 */
export function cursorClause(ctx, timeCol, idCol) {
  const c = decodeCursor(param(ctx, "cursor"));
  if (!c) return { sql: "", binds: [] };
  return { sql: ` AND (${timeCol} < ? OR (${timeCol} = ? AND ${idCol} < ?))`, binds: [c.at, c.at, c.id] };
}

/** rows fetched with LIMIT n+1 -> { items (n), next }. `key` maps a row to {created_at, id}. */
export function paged(rows, limit, key = (r) => r) {
  const more = rows.length > limit;
  const items = rows.slice(0, limit);
  return { items, next: more && items.length ? encodeCursor(key(items[items.length - 1])) : null };
}

/** "Ash Cloud Group!" -> "ash-cloud-group". */
export function slugify(text) {
  return String(text || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 40);
}
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

/** true/false from a JSON boolean or "1"/"0"/"true"/"false". */
export function bool(value, fallback = false) {
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  return fallback;
}
