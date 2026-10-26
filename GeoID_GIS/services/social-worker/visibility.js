/**
 * Visibility a member can carry elsewhere, and reach they can see.
 *
 *   GET /s/badge/:handle.svg   an embeddable profile badge for a CV or lab page,
 *                              for members who opted in to a public profile
 *   POST /v1/posts/:id/seen    the app counts a view (once per reader per day;
 *                              the author's own views never count)
 *   POST /v1/posts/:id/shared  the share button was used
 *   GET /v1/posts/:id/reach    views, link visits, shares, saves, reshares,
 *                              reactions and comments, for the AUTHOR only
 *   GET /v1/directory?field=   people who opted in to a public profile, by field
 *   GET /s/people/:field       the same as a public page search engines can read
 *
 * Counts, never lists: nobody can see who viewed a post.
 */
import { now, str, fail, requireUser, currentUser, parse, tags, canSeePost, usersById, publicUser } from "./lib.js";
import { all, one, run } from "./collab.js";

const DAY = 86400;
const dayOf = (t) => Math.floor(t / DAY);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const site = (env) => String(env.SITE_ORIGIN || "https://geoidinitiative.com").replace(/\/$/, "");
const self = (env) => String(env.SELF_ORIGIN || "https://social.geoidinitiative.com").replace(/\/$/, "");
export const BOT_UA = /bot|crawler|spider|facebookexternalhit|slack|whatsapp|telegram|discord|linkedin|embedly|preview|skype|vkshare|pinterest|redditbot|mastodon/i;

async function sha(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function bump(env, postId, col, t = now()) {
  await run(env, `INSERT INTO post_stats (post_id, day, ${col}) VALUES (?, ?, 1)
    ON CONFLICT(post_id, day) DO UPDATE SET ${col} = ${col} + 1`, postId, dayOf(t));
}

/** reach.js calls this when a share page is opened by a person (not a link-preview bot). */
export async function countLinkVisit(env, request, postId) {
  if (BOT_UA.test(request.headers.get("user-agent") || "")) return;
  await bump(env, postId, "link_visits");
}

async function seen(ctx) {
  const env = ctx.env;
  const viewer = await currentUser(ctx);
  if (!viewer) return { ok: true };                     // anonymous reads are not counted
  const post = await one(env, "SELECT id, author_id, visibility, team_id, community_id, project_id, removed_at FROM posts WHERE id = ?", ctx.params.id);
  if (!post || post.author_id === viewer.id || !(await canSeePost(env, viewer, post))) return { ok: true };
  const t = now();
  const key = await sha(`${post.id}|${viewer.id}|${dayOf(t)}`);
  const fresh = await run(env, "INSERT OR IGNORE INTO post_seen (key, day) VALUES (?, ?)", key, dayOf(t));
  if (Number(fresh?.meta?.changes || 0)) await bump(env, post.id, "views", t);
  return { ok: true };
}

async function shared(ctx) {
  const env = ctx.env;
  const viewer = await currentUser(ctx);
  const post = await one(env, "SELECT * FROM posts WHERE id = ?", ctx.params.id);
  if (post && (await canSeePost(env, viewer, post))) await bump(env, post.id, "shares");
  return { ok: true };
}

async function reach(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  const post = await one(env, "SELECT * FROM posts WHERE id = ?", ctx.params.id);
  if (!post || post.author_id !== user.id) fail(404, "Not found.");
  const since = dayOf(now()) - 29;
  const days = await all(env, "SELECT day, views, link_visits, shares FROM post_stats WHERE post_id = ? AND day >= ? ORDER BY day", post.id, since);
  const total = await one(env, "SELECT COALESCE(SUM(views),0) AS views, COALESCE(SUM(link_visits),0) AS link_visits, COALESCE(SUM(shares),0) AS shares FROM post_stats WHERE post_id = ?", post.id);
  const saves = (await one(env, "SELECT COUNT(*) AS n FROM bookmarks WHERE post_id = ?", post.id))?.n || 0;
  return {
    total: { ...total, saves, reactions: post.reaction_count, comments: post.comment_count, reshares: post.repost_count || 0, forks: post.fork_count },
    last_30_days: Array.from({ length: 30 }, (_, i) => {
      const d = days.find((x) => x.day === since + i);
      return { day: (since + i) * DAY, views: d?.views || 0, link_visits: d?.link_visits || 0, shares: d?.shares || 0 };
    }),
  };
}

// ── The badge ──────────────────────────────────────────────────────────────

const svg = (body) => new Response(body, { headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=3600",
  "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" } });

/** Text trimmed to roughly fit `px` at ~7.2 px a character. */
const fit = (s, px, per = 7.2) => { const n = Math.floor(px / per); const t = String(s || ""); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export function badgeSvg({ name, handle, headline, line }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="96" viewBox="0 0 420 96" role="img" aria-label="${esc(name)} on GeoID Network">
<title>${esc(name)} on GeoID Network</title>
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7b5cff"/><stop offset="0.5" stop-color="#ff3ec8"/><stop offset="1" stop-color="#3fb5ff"/></linearGradient></defs>
<rect width="420" height="96" rx="12" fill="#080014"/><rect x="0.5" y="0.5" width="419" height="95" rx="11.5" fill="none" stroke="#2a2340"/>
<circle cx="48" cy="48" r="26" fill="url(#g)"/><path d="M26 44h44M28 54h40M33 63h30M33 34h30" stroke="#080014" stroke-width="3.2" stroke-linecap="round"/>
<text x="88" y="38" font-family="system-ui,Segoe UI,Helvetica,Arial,sans-serif" font-size="17" font-weight="700" fill="#f8f4ff">${esc(fit(name, 300, 9.2))}</text>
<text x="88" y="58" font-family="system-ui,Segoe UI,Helvetica,Arial,sans-serif" font-size="12.5" fill="#b9b1cc">${esc(fit(headline || `@${handle}`, 310))}</text>
<text x="88" y="78" font-family="system-ui,Segoe UI,Helvetica,Arial,sans-serif" font-size="11.5" fill="#ff7ad9">${esc(fit(line, 310, 6.8))}</text>
</svg>`;
}

async function badge(ctx) {
  const env = ctx.env;
  const handle = String(ctx.params.file || "").replace(/\.svg$/i, "").toLowerCase();
  const u = await one(env, "SELECT * FROM users WHERE handle = ? AND public_profile = 1 AND email NOT LIKE 'erased:%'", handle);
  if (!u) return svg(badgeSvg({ name: "GeoID Network", handle: "", headline: "This profile isn't public.", line: "geoidinitiative.com/social" }));
  const sch = parse(u.scholar_json, {});
  const reviews = (await one(env, "SELECT COUNT(*) AS n FROM reviewers WHERE user_id = ? AND submitted_at IS NOT NULL", u.id))?.n || 0;
  const bits = [sch.works ? `${sch.works} works` : "", sch.h_index != null ? `h-index ${sch.h_index}` : "", reviews ? `${reviews} reviews given` : "", "GeoID Network"].filter(Boolean);
  return svg(badgeSvg({ name: u.name || `@${u.handle}`, handle: u.handle, headline: u.headline || u.institution, line: bits.join(" · ") }));
}

// ── The directory ──────────────────────────────────────────────────────────

async function directoryRows(env, field, limit = 60) {
  const tag = tags([field])[0];
  if (!tag) return [];
  return all(env,
    `SELECT * FROM users u WHERE u.public_profile = 1 AND u.email NOT LIKE 'erased:%' AND u.suspended_until < ?
       AND (EXISTS (SELECT 1 FROM json_each(u.interests_json) WHERE value = ?) OR EXISTS (SELECT 1 FROM json_each(u.skills_json) WHERE value = ?))
     ORDER BY u.orcid_verified DESC, u.updated_at DESC LIMIT ?`, now(), tag, tag, limit);
}

async function directory(ctx) {
  const env = ctx.env;
  const field = str(ctx.url.searchParams.get("field"), 40);
  if (!field) {
    // The fields people have opted in under, with how many.
    const rows = await all(env,
      `SELECT j.value AS tag, COUNT(DISTINCT u.id) AS n FROM users u, json_each(u.interests_json) j
        WHERE u.public_profile = 1 AND u.email NOT LIKE 'erased:%' GROUP BY j.value ORDER BY n DESC LIMIT 40`);
    return { fields: rows };
  }
  const rows = await directoryRows(env, field);
  return { field: tags([field])[0], items: rows.map((r) => ({ ...publicUser(env, r), headline: r.headline })) };
}

async function directoryPage(ctx) {
  const env = ctx.env;
  const field = tags([decodeURIComponent(ctx.params.field || "")])[0] || "";
  const rows = field ? await directoryRows(env, field, 200) : [];
  const title = `People in ${field.replace(/-/g, " ")} on GeoID Network`;
  const app = `${site(env)}/social/#/people?directory=${encodeURIComponent(field)}`;
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(`${rows.length} Earth scientists in ${field.replace(/-/g, " ")} who chose a public profile on GeoID Network.`)}">
${rows.length ? "" : '<meta name="robots" content="noindex">'}<link rel="canonical" href="${esc(`${self(env)}/s/people/${encodeURIComponent(field)}`)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:image" content="${esc(`${site(env)}/assets/social/network.jpg`)}">
</head><body style="margin:0;padding:32px 16px;font:16px/1.55 system-ui,sans-serif;background:#05070d;color:#eef2f8">
<main style="max-width:720px;margin:0 auto"><p>GeoID Network</p><h1>${esc(title)}</h1>
<p>Members who chose a public profile and list ${esc(field.replace(/-/g, " "))} among their fields.</p>
<ul style="list-style:none;padding:0">${rows.map((r) => `<li style="padding:10px 0;border-bottom:1px solid #222"><a style="color:#7fd7ff" href="${esc(`${self(env)}/s/u/${encodeURIComponent(r.handle)}`)}">${esc(r.name || `@${r.handle}`)}</a><br><span style="color:#aab">${esc(r.headline || r.institution || "")}</span></li>`).join("")}</ul>
<p><a style="color:#7fd7ff" href="${esc(app)}">Browse on GeoID Network</a></p></main></body></html>`;
  return new Response(body, { status: rows.length ? 200 : 404, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=600",
    "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" } });
}

export const routes = [
  ["GET", "/s/badge/:file", badge],
  ["GET", "/s/people/:field", directoryPage],
  ["POST", "/v1/posts/:id/seen", seen],
  ["POST", "/v1/posts/:id/shared", shared],
  ["GET", "/v1/posts/:id/reach", reach],
  ["GET", "/v1/directory", directory],
];
