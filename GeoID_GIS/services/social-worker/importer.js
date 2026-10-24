/**
 * Imported opportunities and events -- the Atlas Career Scanner, run for the
 * whole Network on the Worker, so the Opportunities and Events boards are not
 * an empty room on day one.
 *
 * THE MODEL (from ~/atlas-ai/hub/builtin_agents/career_scanner.py):
 *   - a curated list of sources (sources/jobs.json: the 75 employer pages that
 *     have actually yielded vacancies in Atlas's scans, plus job boards such as
 *     jobs.ac.uk read through a discipline-filtered search; sources/events.json:
 *     the calendars that returned events when probed);
 *   - each source read on a ROTA -- a few per 15-minute tick, oldest first, so
 *     no tick is long and every source is read about daily;
 *   - NO SCORES. The scanner's weighted keywords rank roles for one person;
 *     here a posting only has to be in a geoscience field (FIELDS, a plain
 *     yes/no), or come from a board whose discipline filter already chose
 *     the field. The rest are only remembered;
 *   - per-source yield kept (ever_yielded, consecutive_empty, last_error) and
 *     shown to admins at /v1/imports, green/amber/red as the Atlas widget
 *     does -- because CURATING A URL beats more parser code.
 *
 * WHAT IS POSTED. A public opportunity or event authored by the Network's own
 * account (@geoidnetwork), titled as the source titles it, with the source
 * named and linked ("Imported from British Geological Survey") and the apply
 * or event link on the post. Never into the Discover feed -- the boards and
 * anybody who follows @geoidnetwork see them. A posting the source stops
 * listing for three reads is marked gone; a past event or deadline is not
 * re-posted.
 */
import { now, str, id, fail, requireUser, isAdmin, readJson } from "./lib.js";
import { all, one, run } from "./collab.js";
import { insertStatements } from "./posts.js";
import { fetchJobs, fetchEvents, normUrl } from "./ats.js";
import JOB_SOURCES from "./sources/jobs.json" with { type: "json" };
import EVENT_SOURCES from "./sources/events.json" with { type: "json" };

const DAY = 86400;
const PER_TICK = 4;                 // sources read per 15-minute tick
const REREAD = 20 * 3600;           // a source is due again after ~a day
const MAX_NEW_PER_SOURCE = 12;      // a first read posts at most this many
const MAX_NEW_FROM_BOARD = 75;      // a board's discipline-filtered pages (ats.js BOARD_PAGES)
const BOT = { handle: "geoidnetwork", name: "GeoID Network", email: "network-bot@geoid.invalid" };

const term = (k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");

/**
 * Is a posting in a geoscience field at all? A plain yes or no -- NO SCORE.
 * The Atlas scanner's weights rank roles for one person's career; the
 * Network serves every member, so it asks only whether the field is
 * geoscience and leaves "is this for me?" to the reader. A word start
 * matches ("volcan" finds volcano and volcanology).
 */
export const FIELDS = [
  "volcan", "seism", "earthquake", "tsunami", "geohazard", "natural hazard", "landslide", "slope stability", "tephra", "lahar",
  "geolog", "geoscien", "geophysic", "geodes", "geodetic", "geomorpholog", "geochem", "geochron", "petrolog", "mineralog",
  "sediment", "stratigraph", "palaeo", "paleo", "tectonic", "structural geolog", "geotechnic", "geothermal", "rock mechanic",
  "hydrolog", "hydrogeolog", "groundwater", "flood", "drought", "river", "catchment", "glaci", "cryospher", "sea ice", "ice sheet",
  "permafrost", "polar", "antarctic", "arctic", "ocean", "marine geo", "coastal", "sea level", "climate", "atmospher",
  "meteorolog", "weather", "air quality", "wildfire", "earth observation", "remote sensing", "insar", "lidar", "gis",
  "geospatial", "geographic information", "physical geograph", "geograph", "soil", "earth science", "earth system",
  "environmental science", "planetary science", "mineral exploration", "mining geolog",
];
const FIELD_TERMS = FIELDS.map((k) => [k, term(k)]);

export const EXCLUDE = ["nurse", "cleaner", "janitor", "security guard", "receptionist", "sales representative",
  "account executive", "recruiter", "barista", "chef", "driver", "warehouse", "custodian", "electrician",
  "plumber", "teller", "cashier", "apprentice", "medical physics", "graduation ceremony"];

// "Drivers of change" is science; "HGV drivers" is not. Every other exclusion is a plain word start.
const EXCLUDE_TERMS = EXCLUDE.map((k) => (k === "driver" ? /\bdrivers?\b(?!\s+(?:of|and|behind|for)\b)/i : term(k)));

/**
 * {excluded, fields}: the field words a posting mentions (for its tags), and
 * whether it is a kind of job the Network never lists. Nothing is weighed.
 */
export function classifyPosting(text) {
  const t = String(text || "");
  if (EXCLUDE_TERMS.some((re) => re.test(t))) return { excluded: true, fields: [] };
  return { excluded: false, fields: FIELD_TERMS.filter(([, re]) => re.test(t)).map(([k]) => k) };
}

/** Tags for a post from the fields it mentions: the Network's own tag shape. */
function tagsFrom(hits) {
  const map = { volcan: "volcanology", seism: "seismology", earthquake: "seismology", landslide: "landslides", flood: "hydrology",
    hydrolog: "hydrology", "remote sensing": "remote-sensing", "earth observation": "earth-observation", insar: "insar",
    glaci: "cryosphere", cryospher: "cryosphere", "sea ice": "cryosphere", "ice sheet": "cryosphere", climate: "climate",
    geodes: "geodesy", geophysic: "geophysics", gis: "gis", geospatial: "gis", ocean: "oceanography", soil: "soil",
    geolog: "geology", tectonic: "tectonics", groundwater: "hydrology", hydrogeolog: "hydrology", atmospher: "atmosphere",
    meteorolog: "meteorology", weather: "meteorology", geograph: "geography", geomorpholog: "geomorphology" };
  const out = new Set();
  for (const h of hits) for (const [k, tag] of Object.entries(map)) if (h.startsWith(k) || k.startsWith(h)) out.add(tag);
  return [...out].slice(0, 6);
}

/** The Network's own account, made the first time it is needed. */
export async function botUser(env) {
  const found = await one(env, "SELECT * FROM users WHERE handle = ?", BOT.handle);
  if (found) return found;
  const t = now();
  await run(env,
    "INSERT INTO users (id, email, handle, name, headline, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    id("u"), BOT.email, BOT.handle, BOT.name, "Opportunities and events gathered from employers and societies, credited to each source", t, t);
  return one(env, "SELECT * FROM users WHERE handle = ?", BOT.handle);
}

/** Write the curated lists into import_sources (new ids only; an admin's disable sticks). */
export async function seedSources(env) {
  for (const [kind, list] of [["jobs", JOB_SOURCES.sources], ["events", EVENT_SOURCES.sources]]) {
    for (const s of list) {
      await run(env, "INSERT OR IGNORE INTO import_sources (id, kind, name, url, grp) VALUES (?, ?, ?, ?, ?)",
        `${kind}:${s.id}`, kind, str(s.name, 120), s.url, str(s.group, 80));
    }
  }
}

function jobPost(bot, source, p, hits, t) {
  const deadline = p.deadline ? Math.floor(Date.parse(p.deadline) / 1000) || null : null;
  // A board lists many employers: the employer is the posting's, the credit the board's.
  const org = p.org || source.name;
  const body = [
    `${p.title}${org ? ` at ${org}` : ""}${p.department ? `, ${p.department}` : ""}.`,
    p.location ? `Location: ${p.location}.` : "",
    p.salary ? `Salary: ${p.salary}.` : "",
    p.board ? `Listed on ${source.name}. Read the full advert and apply there.` : `Imported from ${source.name}'s careers page. Read the full advert and apply there.`,
  ].filter(Boolean).join("\n");
  return {
    id: id("p"), author_id: bot.id, kind: "opportunity", title: str(p.title, 200), body,
    tags_json: JSON.stringify(tagsFrom(hits)), lat: null, lon: null, loc_precision: "hidden", place_name: str(p.location, 120),
    world: "earth", scene_json: null, media_json: "[]",
    links_json: JSON.stringify([{ url: p.url, label: "Read the advert and apply", provider: "web", provider_label: source.name }]),
    licence: "all-rights-reserved", provenance: "unverified",
    sources_json: JSON.stringify([{ label: `Imported from ${source.name}`, url: p.url, doi: "", licence: "" }]),
    method_json: "{}", limitations: "Gathered automatically from the employer's own listing; check the advert for the details that matter.",
    meta_json: JSON.stringify({ type: /phd|studentship/i.test(p.title) ? "studentship" : /fellow/i.test(p.title) ? "fellowship" : /intern/i.test(p.title) ? "internship" : "job",
      org: str(org, 200), apply_url: p.url, ...(deadline ? { deadline } : {}), imported: true, source_id: source.id, source_name: str(source.name, 120), source_url: source.url }),
    visibility: "public", team_id: null, community_id: null, project_id: null, allow_fork: 0, forked_from: null,
    sponsored_by: "", created_at: t, updated_at: t,
  };
}

function eventPost(bot, source, e, hits, t) {
  const online = /online|virtual|webinar/i.test(`${e.location} ${e.title}`);
  const body = [e.description || `${e.title}.`, `Listed by ${source.name}. Details and registration on their page.`].filter(Boolean).join("\n\n");
  return {
    id: id("p"), author_id: bot.id, kind: "event", title: str(e.title, 200), body: str(body, 4000),
    tags_json: JSON.stringify(tagsFrom(hits)), lat: null, lon: null, loc_precision: "hidden", place_name: str(e.location, 120),
    world: "earth", scene_json: null, media_json: "[]",
    links_json: JSON.stringify(e.url ? [{ url: e.url, label: "Event page", provider: "web", provider_label: source.name }] : []),
    licence: "all-rights-reserved", provenance: "unverified",
    sources_json: JSON.stringify([{ label: `Imported from ${source.name}`, url: e.url || source.url, doi: "", licence: "" }]),
    method_json: "{}", limitations: "Gathered automatically from the organiser's calendar; check their page for changes.",
    meta_json: JSON.stringify({ starts_at: e.startsAt, ...(e.endsAt ? { ends_at: e.endsAt } : {}), where: str(e.location, 200),
      url: e.url || source.url, format: /workshop/i.test(e.title) ? "workshop" : /webinar/i.test(e.title) ? "webinar" : /school|course|training/i.test(e.title) ? "field-course" : "conference",
      online, imported: true, source_id: source.id, source_name: str(source.name, 120), source_url: source.url }),
    visibility: "public", team_id: null, community_id: null, project_id: null, allow_fork: 0, forked_from: null,
    sponsored_by: "", created_at: t, updated_at: t,
  };
}

/** Read one source and post what is new and relevant. */
export async function readSource(env, source, t = now(), { fetcher = fetch } = {}) {
  const bot = await botUser(env);
  let platform = "";
  let items = [];
  try {
    if (source.kind === "events") {
      const r = await fetchEvents(fetcher, source.url);
      platform = r.platform;
      items = r.events.filter((e) => e.startsAt > t).map((e) => ({ ...e, key: normUrl(e.url || `${source.url}#${e.uid || e.title}-${e.startsAt}`) }));
    } else {
      const r = await fetchJobs(fetcher, source.url);
      platform = r.platform;
      items = r.postings.filter((p) => p.url && p.title).map((p) => ({ ...p, key: normUrl(p.url) }));
    }
  } catch (error) {
    await run(env, "UPDATE import_sources SET last_run_at = ?, last_error = ?, platform = ?, consecutive_empty = consecutive_empty + 1 WHERE id = ?",
      t, str(error.message, 200), platform, source.id);
    return { id: source.id, error: str(error.message, 200) };
  }
  let posted = 0;
  for (const item of items) {
    const known = await one(env, "SELECT * FROM imported WHERE url_key = ?", item.key);
    if (known) {
      await run(env, "UPDATE imported SET last_seen = ?, gone_at = NULL WHERE url_key = ?", t, item.key);
      continue;
    }
    const text = source.kind === "events" ? `${item.title} ${item.description || ""}`
      : `${item.title} ${item.department || ""}`;
    const { excluded, fields } = classifyPosting(text);
    // A board's own discipline filter has already chosen the field; an employer's page needs a field word.
    const enough = !excluded && (item.board || fields.length > 0);
    let postId = null;
    if (enough && posted < (item.board ? MAX_NEW_FROM_BOARD : MAX_NEW_PER_SOURCE)) {
      const row = source.kind === "events" ? eventPost(bot, source, item, fields, t) : jobPost(bot, source, item, fields, t);
      await env.DB.batch(insertStatements(env.DB, row));
      postId = row.id;
      posted += 1;
    }
    await run(env, "INSERT INTO imported (url_key, source_id, post_id, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)",
      item.key, source.id, postId, t, t);
  }
  // Three reads without a posting it used to list: it has gone.
  await run(env, "UPDATE imported SET gone_at = ? WHERE source_id = ? AND gone_at IS NULL AND last_seen < ?", t, source.id, t - 3 * REREAD);
  await run(env,
    `UPDATE import_sources SET last_run_at = ?, platform = ?, last_count = ?, last_new = ?, last_error = '',
       ever_yielded = CASE WHEN ? > 0 THEN 1 ELSE ever_yielded END,
       consecutive_empty = CASE WHEN ? > 0 THEN 0 ELSE consecutive_empty + 1 END WHERE id = ?`,
    t, platform, items.length, posted, items.length, items.length, source.id);
  return { id: source.id, listed: items.length, posted };
}

/** The 15-minute tick: the next few sources that are due. */
export async function runImports(env, t = now(), { fetcher = fetch, perTick = PER_TICK } = {}) {
  await seedSources(env);
  const due = await all(env,
    "SELECT * FROM import_sources WHERE enabled = 1 AND last_run_at < ? ORDER BY last_run_at LIMIT ?", t - REREAD, perTick);
  const out = [];
  for (const s of due) out.push(await readSource(env, s, t, { fetcher }));
  return { read: out.length, results: out };
}

// ── Admin routes ───────────────────────────────────────────────────────────

async function requireAdmin(ctx) {
  const user = await requireUser(ctx);
  if (!isAdmin(ctx.env, user)) fail(403, "Admins only.");
  return user;
}

/** GET /v1/imports -- every source and how it is doing (green / amber / red). */
async function listSources(ctx) {
  await requireAdmin(ctx);
  await seedSources(ctx.env);
  const rows = await all(ctx.env, "SELECT * FROM import_sources ORDER BY kind, grp, name");
  return {
    items: rows.map((r) => ({
      ...r, enabled: !!r.enabled, ever_yielded: !!r.ever_yielded,
      health: r.last_error ? "red" : r.last_run_at && !r.last_count ? "amber" : r.last_count ? "green" : "grey",
    })),
  };
}

/** PATCH /v1/imports/:id {enabled?, url?} -- switch a source off, or point it at the real listing. */
async function patchSource(ctx) {
  await requireAdmin(ctx);
  const b = await readJson(ctx.request);
  const s = await one(ctx.env, "SELECT * FROM import_sources WHERE id = ?", ctx.params.id);
  if (!s) fail(404, "Not found.");
  if (b.enabled !== undefined) await run(ctx.env, "UPDATE import_sources SET enabled = ? WHERE id = ?", b.enabled ? 1 : 0, s.id);
  if (b.url) await run(ctx.env, "UPDATE import_sources SET url = ?, last_run_at = 0, consecutive_empty = 0, last_error = '' WHERE id = ?", str(b.url, 500), s.id);
  return one(ctx.env, "SELECT * FROM import_sources WHERE id = ?", s.id);
}

/** POST /v1/imports/:id/run -- read one source now. */
async function runOne(ctx) {
  await requireAdmin(ctx);
  const s = await one(ctx.env, "SELECT * FROM import_sources WHERE id = ?", ctx.params.id);
  if (!s) fail(404, "Not found.");
  return readSource(ctx.env, s, now(), { fetcher: ctx.env.fetchImpl || fetch });
}

export const routes = [
  ["GET", "/v1/imports", listSources],
  ["PATCH", "/v1/imports/:id", patchSource],
  ["POST", "/v1/imports/:id/run", runOne],
];
