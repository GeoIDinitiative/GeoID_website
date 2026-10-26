/**
 * The member's own view of the external job board: filters, saved searches
 * with alerts, and a reminder before a saved advert closes.
 *
 * NO SCORES. The board itself is unranked (importer.js); what a member wants
 * is theirs to say -- field, career stage, region, remote, closing soon --
 * and the same filters serve the list, a saved search and its alert.
 */
import { now, str, id, fail, requireUser, rateLimit, readJson, parse, int, notify } from "./lib.js";
import { all, one, run } from "./collab.js";
import { openListingSql } from "./posts.js";

const DAY = 86400;
const MAX_SEARCHES = 20;

/** Fields, as the words that mark them in a title or advert (word starts, case-insensitive). */
export const FIELDS = {
  volcanology: ["volcan", "magma", "eruption", "tephra"],
  seismology: ["seism", "earthquake"],
  geophysics: ["geophysic", "gravity", "magnetotelluric", "geodes", "geodetic"],
  geology: ["geolog", "tectonic", "sediment", "stratigraph", "petrolog", "mineral", "geochem", "geomorpholog"],
  hydrology: ["hydrolog", "flood", "groundwater", "river", "catchment", "water resource"],
  cryosphere: ["glaci", "cryospher", "ice sheet", "sea ice", "polar", "permafrost", "antarctic", "arctic"],
  climate: ["climate", "atmospher", "meteorolog", "weather", "air quality"],
  oceans: ["ocean", "marine", "coastal", "sea level"],
  "remote-sensing": ["remote sensing", "earth observation", "insar", "satellite", "lidar"],
  gis: ["gis", "geospatial", "geographic information", "mapping"],
  hazards: ["hazard", "landslide", "risk", "tsunami", "wildfire", "resilience"],
  soils: ["soil"],
  geography: ["geograph"],
};
export const STAGES = {
  phd: { label: "PhD / studentship", types: ["studentship"], words: ["phd", "studentship", "doctoral"] },
  postdoc: { label: "Postdoc / research staff", types: ["fellowship"], words: ["postdoc", "post-doc", "research associate", "research fellow", "research scientist"] },
  faculty: { label: "Lecturer / faculty", types: [], words: ["lecturer", "professor", "faculty", "tenure"] },
  internship: { label: "Internship", types: ["internship"], words: ["intern"] },
  industry: { label: "Industry / consultancy", types: ["consultancy"], words: ["consultant", "engineer", "analyst", "geologist", "hydrologist", "manager"] },
};

const like = (w) => `%${String(w).replace(/[%_]/g, "")}%`;
const TEXT = "(p.title || ' ' || p.body || ' ' || COALESCE(json_extract(p.meta_json, '$.org'), ''))";

/** A query object, cleaned. */
export function cleanQuery(raw = {}) {
  const q = {};
  const text = str(raw.q, 80);
  if (text) q.q = text;
  if (FIELDS[raw.field]) q.field = raw.field;
  if (STAGES[raw.stage]) q.stage = raw.stage;
  const region = str(raw.region, 60);
  if (region) q.region = region;
  if (raw.remote === true || raw.remote === "1" || raw.remote === 1) q.remote = true;
  const closing = int(raw.closing, 0);
  if ([7, 14, 30].includes(closing)) q.closing = closing;
  return q;
}

/** Push the filters for `q` onto where/binds. */
export function applyJobFilters(q, where, binds, t = now()) {
  if (q.q) { where.push(`${TEXT} LIKE ?`); binds.push(like(q.q)); }
  if (q.field) {
    const words = FIELDS[q.field];
    where.push(`(EXISTS (SELECT 1 FROM post_tags pt WHERE pt.post_id = p.id AND pt.tag = ?) OR ${words.map(() => `${TEXT} LIKE ?`).join(" OR ")})`);
    binds.push(q.field, ...words.map(like));
  }
  if (q.stage) {
    const s = STAGES[q.stage];
    const parts = [...s.types.map(() => "json_extract(p.meta_json, '$.type') = ?"), ...s.words.map(() => "p.title LIKE ?")];
    where.push(`(${parts.join(" OR ")})`);
    binds.push(...s.types, ...s.words.map(like));
  }
  if (q.region) { where.push("(p.place_name LIKE ? OR p.body LIKE ?)"); binds.push(like(q.region), like(q.region)); }
  if (q.remote) where.push("(p.place_name LIKE '%remote%' OR p.place_name LIKE '%hybrid%' OR p.place_name LIKE '%home%' OR p.body LIKE '%remote work%')");
  if (q.closing) {
    where.push("json_extract(p.meta_json, '$.deadline') IS NOT NULL AND json_extract(p.meta_json, '$.deadline') <= ?");
    binds.push(t + q.closing * DAY);
  }
}

/** The query object a feed request carries (?q=&field=&stage=&region=&remote=&closing=). */
export function queryFromParams(params) {
  return cleanQuery(Object.fromEntries(["q", "field", "stage", "region", "remote", "closing"].map((k) => [k, params.get(k)])));
}

/** Words describing a query, for the alert's text and the list of searches. */
export function describe(q) {
  return [q.q ? `“${q.q}”` : "", q.field ? q.field.replace("-", " ") : "", q.stage ? STAGES[q.stage].label : "",
    q.region || "", q.remote ? "remote" : "", q.closing ? `closing within ${q.closing} days` : ""].filter(Boolean).join(", ") || "every external advert";
}

/** Open external adverts matching `q`, newer than `since`. */
export async function matching(env, q, since, t = now(), limit = 50) {
  const where = ["p.removed_at IS NULL", "p.visibility = 'public'", "p.kind = 'opportunity'", "p.created_at > ?"];
  const binds = [since];
  const open = openListingSql(t);
  where.push(open.sql); binds.push(...open.binds);
  applyJobFilters(q, where, binds, t);
  return all(env, `SELECT p.id, p.title FROM posts p WHERE ${where.join(" AND ")} ORDER BY p.created_at DESC LIMIT ?`, ...binds, limit);
}

// ── Routes ─────────────────────────────────────────────────────────────────

const shape = (r) => ({ id: r.id, name: r.name, query: parse(r.query_json, {}), alert: r.alert, describe: describe(parse(r.query_json, {})), created_at: r.created_at });

async function listSearches(ctx) {
  const user = await requireUser(ctx);
  return { items: (await all(ctx.env, "SELECT * FROM saved_searches WHERE user_id = ? ORDER BY created_at DESC", user.id)).map(shape),
    fields: Object.keys(FIELDS), stages: Object.fromEntries(Object.entries(STAGES).map(([k, v]) => [k, v.label])) };
}

async function saveSearch(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const b = await readJson(ctx.request);
  const n = (await one(env, "SELECT COUNT(*) AS n FROM saved_searches WHERE user_id = ?", user.id))?.n || 0;
  if (n >= MAX_SEARCHES) fail(409, `You can keep up to ${MAX_SEARCHES} saved searches.`);
  const q = cleanQuery(b.query || {});
  const alert = ["daily", "weekly", "off"].includes(b.alert) ? b.alert : "daily";
  const row = { id: id("ss"), user_id: user.id, name: str(b.name, 80) || describe(q), query_json: JSON.stringify(q), alert, last_sent_at: now(), created_at: now() };
  await run(env, "INSERT INTO saved_searches (id, user_id, name, query_json, alert, last_sent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    row.id, row.user_id, row.name, row.query_json, row.alert, row.last_sent_at, row.created_at);
  return shape(row);
}

async function patchSearch(ctx) {
  const user = await requireUser(ctx);
  const r = await one(ctx.env, "SELECT * FROM saved_searches WHERE id = ? AND user_id = ?", ctx.params.id, user.id);
  if (!r) fail(404, "Not found.");
  const b = await readJson(ctx.request);
  if (["daily", "weekly", "off"].includes(b.alert)) await run(ctx.env, "UPDATE saved_searches SET alert = ? WHERE id = ?", b.alert, r.id);
  if (b.name) await run(ctx.env, "UPDATE saved_searches SET name = ? WHERE id = ?", str(b.name, 80), r.id);
  return shape(await one(ctx.env, "SELECT * FROM saved_searches WHERE id = ?", r.id));
}

async function deleteSearch(ctx) {
  const user = await requireUser(ctx);
  await run(ctx.env, "DELETE FROM saved_searches WHERE id = ? AND user_id = ?", ctx.params.id, user.id);
  return { ok: true };
}

// ── The daily jobs (cron.js DAILY) ─────────────────────────────────────────

/** Alerts: one notification per search with something new (weekly ones on Mondays). */
export async function runJobAlerts(env, t = now()) {
  const monday = new Date(t * 1000).getUTCDay() === 1;
  const searches = await all(env, `SELECT * FROM saved_searches WHERE alert = 'daily' ${monday ? "OR alert = 'weekly'" : ""}`);
  let sent = 0;
  for (const s of searches) {
    const found = await matching(env, parse(s.query_json, {}), s.last_sent_at, t);
    await run(env, "UPDATE saved_searches SET last_sent_at = ? WHERE id = ?", t, s.id);
    if (!found.length) continue;
    await notify(env, s.user_id, "job_alert", null, "search", s.id,
      `${found.length}${found.length >= 50 ? "+" : ""} new for “${s.name}”: ${found[0].title}${found.length > 1 ? " and more" : ""}`);
    sent += 1;
  }
  return { searches: searches.length, sent };
}

/** A saved opportunity closing within three days: one reminder. */
export async function runDeadlineReminders(env, t = now()) {
  const due = await all(env,
    `SELECT b.user_id, p.id, p.title, json_extract(p.meta_json, '$.deadline') AS deadline FROM bookmarks b JOIN posts p ON p.id = b.post_id
      WHERE p.kind = 'opportunity' AND p.removed_at IS NULL
        AND json_extract(p.meta_json, '$.deadline') BETWEEN ? AND ?
        AND NOT EXISTS (SELECT 1 FROM deadline_reminders d WHERE d.user_id = b.user_id AND d.post_id = p.id)`, t, t + 3 * DAY);
  for (const r of due) {
    const days = Math.max(0, Math.ceil((r.deadline - t) / DAY));
    await notify(env, r.user_id, "deadline", null, "post", r.id, `Closes ${days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`}: ${r.title}`);
    await run(env, "INSERT OR IGNORE INTO deadline_reminders (user_id, post_id, sent_at) VALUES (?, ?, ?)", r.user_id, r.id, t);
  }
  return { reminded: due.length };
}

export const routes = [
  ["GET", "/v1/me/searches", listSearches],
  ["POST", "/v1/me/searches", saveSearch],
  ["PATCH", "/v1/me/searches/:id", patchSearch],
  ["DELETE", "/v1/me/searches/:id", deleteSearch],
];
