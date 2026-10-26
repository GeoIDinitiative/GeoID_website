/**
 * A profile in a minute: the member's ORCID iD, looked up in OpenAlex.
 *
 * POST /v1/me/import-scholar reads the OpenAlex author record behind the
 * member's ORCID iD (verified or self-declared) and:
 *   - adds their works as publication items on the profile (by DOI, or
 *     title when there is none; nothing they already listed is duplicated).
 *     They count as verified only when the ORCID iD is: anybody can type
 *     somebody else's iD, nobody can sign in as them;
 *   - adds their main research topics to their interests (they can remove
 *     any), and fills an empty institution;
 *   - keeps works, citations and h-index for the profile;
 *   - finds their co-authors who are on the Network (by ORCID iD), so
 *     following them is one press.
 * Nothing runs without the member asking, and nothing is shared that OpenAlex
 * does not already publish.
 */
import { now, str, id, fail, requireUser, rateLimit, parse, tags, usersById } from "./lib.js";
import { all, one, run } from "./collab.js";

const OPENALEX = "https://api.openalex.org";
const MAILTO = "geoid.network@geoidinitiative.com";
const MAX_WORKS = 100;
const ORCID_RE = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

async function getJson(fetcher, u) {
  const r = await fetcher(u, { headers: { accept: "application/json", "user-agent": `GeoIDNetwork/1.0 (mailto:${MAILTO})` } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`OpenAlex answered ${r.status}`);
  return r.json();
}

const shortId = (u) => String(u || "").split("/").pop();
const doiOf = (d) => String(d || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").toLowerCase();
const orcidOf = (u) => String(u || "").replace(/^https?:\/\/orcid\.org\//i, "").toUpperCase();
const norm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** A topic's display name as a Network tag: "Volcanic processes and hazards" -> "volcanic-processes-and-hazards". */
export function topicTag(name) {
  return tags([String(name || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)])[0] || "";
}

/** Read the author and their newest works. */
export async function readScholar(fetcher, orcid) {
  const author = await getJson(fetcher, `${OPENALEX}/authors/orcid:${orcid}?mailto=${MAILTO}`);
  if (!author) return null;
  const aid = shortId(author.id);
  const works = [];
  let cursor = "*";
  while (cursor && works.length < MAX_WORKS) {
    const page = await getJson(fetcher, `${OPENALEX}/works?filter=author.id:${aid}&sort=publication_year:desc&per-page=50&cursor=${encodeURIComponent(cursor)}`
      + `&select=id,doi,title,publication_year,primary_location,authorships,cited_by_count,type&mailto=${MAILTO}`);
    works.push(...(page?.results || []));
    cursor = page?.meta?.next_cursor || null;
    if (!page?.results?.length) break;
  }
  return { author, works: works.slice(0, MAX_WORKS) };
}

async function importScholar(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const orcid = String(user.orcid || "").toUpperCase();
  if (!ORCID_RE.test(orcid)) fail(400, "Add your ORCID iD to your profile first.");
  const fetcher = env.fetchImpl || fetch;
  const read = await readScholar(fetcher, orcid);
  if (!read) fail(404, "OpenAlex has no author record for that ORCID iD yet.");
  const { author, works } = read;
  const verified = user.orcid_verified ? 1 : 0;
  const t = now();

  // Works -> publication items, skipping what is already listed.
  const mine = await all(env, "SELECT doi, title FROM profile_items WHERE user_id = ? AND kind = 'publication'", user.id);
  const haveDoi = new Set(mine.map((m) => doiOf(m.doi)).filter(Boolean));
  const haveTitle = new Set(mine.map((m) => norm(m.title)));
  let added = 0;
  const statements = [];
  for (const [i, w] of works.entries()) {
    const doi = doiOf(w.doi);
    if (!w.title || (doi && haveDoi.has(doi)) || haveTitle.has(norm(w.title))) continue;
    haveDoi.add(doi); haveTitle.add(norm(w.title));
    const venue = str(w.primary_location?.source?.display_name || "", 160);
    statements.push(env.DB.prepare(
      `INSERT INTO profile_items (id, user_id, kind, title, detail, url, doi, year, verified, visibility, sort, source, created_at)
        VALUES (?, ?, 'publication', ?, ?, ?, ?, ?, ?, 'public', ?, 'openalex', ?)`,
    ).bind(id("pi"), user.id, str(w.title, 300), venue, doi ? `https://doi.org/${doi}` : str(w.primary_location?.landing_page_url || "", 300),
      doi, w.publication_year || null, verified, 1000 + i, t));
    added += 1;
  }
  if (statements.length) await env.DB.batch(statements);

  // Topics -> interests (the strongest few, merged); institution if empty.
  const topics = (author.topics || []).slice(0, 8).map((tp) => ({ name: str(tp.display_name, 80), count: tp.count || 0, tag: topicTag(tp.display_name) }))
    .filter((tp) => tp.tag);
  const interests = parse(user.interests_json, []);
  const merged = [...new Set([...interests, ...topics.slice(0, 6).map((tp) => tp.tag)])].slice(0, 20);
  const inst = author.last_known_institutions?.[0]?.display_name || "";
  const scholar = {
    works: author.works_count || 0, cited_by: author.cited_by_count || 0, h_index: author.summary_stats?.h_index ?? null,
    i10: author.summary_stats?.i10_index ?? null, topics, institution: str(inst, 160), imported_at: t,
    openalex: `https://openalex.org/${shortId(author.id)}`,
  };
  await run(env, `UPDATE users SET openalex_id = ?, scholar_json = ?, interests_json = ?,
      institution = CASE WHEN institution = '' THEN ? ELSE institution END, updated_at = ? WHERE id = ?`,
    shortId(author.id), JSON.stringify(scholar), JSON.stringify(merged), str(inst, 160), t, user.id);

  // Co-authors on the Network, by ORCID iD; the ones the member already follows are left out.
  const counts = new Map();
  for (const w of works) {
    for (const a of w.authorships || []) {
      const o = orcidOf(a.author?.orcid);
      if (o && o !== orcid) counts.set(o, (counts.get(o) || 0) + 1);
    }
  }
  const orcids = [...counts.keys()].slice(0, 400);
  let coauthors = [];
  if (orcids.length) {
    const rows = await all(env,
      `SELECT id, orcid FROM users WHERE orcid IN (${orcids.map(() => "?").join(",")}) AND id != ? AND email NOT LIKE 'erased:%'
         AND id NOT IN (SELECT target_id FROM follows WHERE follower_id = ? AND target_type = 'user')`,
      ...orcids, user.id, user.id);
    const people = await usersById(env, rows.map((r) => r.id));
    coauthors = rows.filter((r) => people[r.id]).map((r) => ({ user: people[r.id], shared_works: counts.get(String(r.orcid).toUpperCase()) || 0 }))
      .sort((a, b) => b.shared_works - a.shared_works).slice(0, 30);
  }
  return { added, works_found: works.length, verified: !!verified, scholar, interests: merged, coauthors };
}

/** GET /v1/users/:handle/scholar -- the imported record, for the profile. */
async function scholarOf(ctx) {
  const row = await one(ctx.env, "SELECT scholar_json, orcid_verified FROM users WHERE handle = ? AND email NOT LIKE 'erased:%'", String(ctx.params.handle || "").toLowerCase());
  if (!row) fail(404, "No such person.");
  const s = parse(row.scholar_json, {});
  return s.imported_at ? { ...s, orcid_verified: !!row.orcid_verified } : { imported_at: null };
}

export const routes = [
  ["POST", "/v1/me/import-scholar", importScholar],
  ["GET", "/v1/users/:handle/scholar", scholarOf],
];
