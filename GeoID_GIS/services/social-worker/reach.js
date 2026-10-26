/**
 * Reach: the GeoID Network on the open web, and a reason to come back.
 *
 * SHARE PAGES. The app is a hash-routed page, which no search engine or link
 * preview can read. So every public thing has a plain HTML page here --
 * /s/p/<post>, /s/o/<org>, /s/c/<community>, /s/u/<handle> -- carrying its
 * title, a description and the share card, which sends a person straight on
 * into the app. Only what anybody may already read is rendered: a public post,
 * an organisation, an open community, and a member's profile ONLY when they
 * opted in (users.public_profile). Anything else is the same 404 as nothing.
 * /s/sitemap.xml lists the indexable ones; robots.txt points at it.
 *
 * THE WEEKLY EMAIL. "New for you": opportunities and events in the member's
 * interests, the week's most-saved public posts, and people working near
 * their study areas. Mondays from DIGEST_HOUR_UTC; on by default, off in
 * Settings or with the one-click unsubscribe every email carries.
 */
import { countLinkVisit } from "./visibility.js";
import { now, str, parse, id, canSeePost } from "./lib.js";
import { all, one, run } from "./collab.js";
import { mailConfigured, envelope, sendEmail, siteLink } from "./mail.js";

const DAY = 86400;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const site = (env) => String(env.SITE_ORIGIN || "https://geoidinitiative.com").replace(/\/$/, "");
const self = (env) => String(env.SELF_ORIGIN || "https://social.geoidinitiative.com").replace(/\/$/, "");

/** One share page: the card's meta, then a link on into the app (and a refresh for people). */
export function sharePage(env, { title, description, appHash, path, index = true }) {
  const app = `${site(env)}/social/${appHash}`;
  const canonical = `${self(env)}${path}`;
  const image = `${site(env)}/assets/social/network.jpg`;
  const t = esc(str(title, 120) || "GeoID Network");
  const d = esc(str(description, 300) || "The GeoID Network: Earth scientists sharing work, finding mentors, projects, jobs and events.");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t} — GeoID Network</title>
<meta name="description" content="${d}">
${index ? "" : '<meta name="robots" content="noindex">\n'}<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="article"><meta property="og:site_name" content="GeoID Network">
<meta property="og:title" content="${t}"><meta property="og:description" content="${d}">
<meta property="og:url" content="${esc(canonical)}"><meta property="og:image" content="${esc(image)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}"><meta name="twitter:image" content="${esc(image)}">
<meta http-equiv="refresh" content="0; url=${esc(app)}">
</head><body style="margin:0;padding:32px 16px;font:17px/1.55 system-ui,sans-serif;background:#05070d;color:#eef2f8">
<main style="max-width:560px;margin:0 auto"><p>GeoID Network</p><h1>${t}</h1><p>${d}</p>
<p><a href="${esc(app)}" style="color:#7fd7ff">Open it on the GeoID Network</a></p></main></body></html>`;
}

const html = (body, status = 200) => new Response(body, {
  status,
  headers: {
    "content-type": "text/html; charset=utf-8",
    "cache-control": status === 200 ? "public, max-age=600" : "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src https:",
  },
});
const gone = (env) => html(sharePage(env, { title: "Not found", description: "That isn't public, or isn't there any more.", appHash: "#/", path: "/s/", index: false }), 404);

function summary(text, max = 280) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

async function sharePost(ctx) {
  const env = ctx.env;
  const post = await one(env, "SELECT * FROM posts WHERE id = ?", ctx.params.id);
  if (!post || !(await canSeePost(env, null, post))) return gone(env);
  await countLinkVisit(env, ctx.request, post.id);
  const author = await one(env, "SELECT name, handle FROM users WHERE id = ?", post.author_id);
  const by = author ? ` — ${author.name || `@${author.handle}`}` : "";
  return html(sharePage(env, {
    title: post.title || summary(post.body, 90) || "A post",
    description: `${summary(post.body)}${by}`,
    appHash: `#/post/${encodeURIComponent(post.id)}`,
    path: `/s/p/${encodeURIComponent(post.id)}`,
    // An unlisted post shares fine, but is not offered to search engines.
    index: post.visibility === "public",
  }));
}

async function shareOrg(ctx) {
  const env = ctx.env;
  const org = await one(env, "SELECT * FROM orgs WHERE slug = ? OR id = ?", ctx.params.id, ctx.params.id);
  if (!org) return gone(env);
  return html(sharePage(env, {
    title: org.name, description: summary(org.description) || `${org.name} on the GeoID Network.`,
    appHash: `#/o/${encodeURIComponent(org.slug)}`, path: `/s/o/${encodeURIComponent(org.slug)}`,
  }));
}

async function shareCommunity(ctx) {
  const env = ctx.env;
  const c = await one(env, "SELECT * FROM communities WHERE (slug = ? OR id = ?) AND visibility = 'open' AND parent_id IS NULL", ctx.params.id, ctx.params.id);
  if (!c) return gone(env);
  return html(sharePage(env, {
    title: c.name, description: summary(c.description) || `The ${c.name} community on the GeoID Network.`,
    appHash: `#/c/${encodeURIComponent(c.slug)}`, path: `/s/c/${encodeURIComponent(c.slug)}`,
  }));
}

async function shareUser(ctx) {
  const env = ctx.env;
  const u = await one(env, "SELECT * FROM users WHERE handle = ? AND public_profile = 1 AND email NOT LIKE 'erased:%'", ctx.params.id);
  if (!u) return gone(env);
  const bits = [u.headline, u.institution].filter(Boolean).join(" · ");
  return html(sharePage(env, {
    title: u.name || `@${u.handle}`, description: bits || `@${u.handle} on the GeoID Network.`,
    appHash: `#/u/${encodeURIComponent(u.handle)}`, path: `/s/u/${encodeURIComponent(u.handle)}`,
  }));
}

async function sitemap(ctx) {
  const env = ctx.env;
  const base = self(env);
  const posts = await all(env,
    "SELECT id, COALESCE(updated_at, created_at) AS t FROM posts WHERE visibility = 'public' AND removed_at IS NULL ORDER BY created_at DESC LIMIT 5000");
  const orgs = await all(env, "SELECT slug FROM orgs LIMIT 2000");
  const comms = await all(env, "SELECT slug FROM communities WHERE visibility = 'open' AND parent_id IS NULL LIMIT 2000");
  const users = await all(env, "SELECT handle FROM users WHERE public_profile = 1 AND email NOT LIKE 'erased:%' LIMIT 5000");
  const u = (path, t) => `<url><loc>${esc(base + path)}</loc>${t ? `<lastmod>${new Date(t * 1000).toISOString().slice(0, 10)}</lastmod>` : ""}</url>`;
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[
    ...posts.map((r) => u(`/s/p/${encodeURIComponent(r.id)}`, r.t)),
    ...orgs.map((r) => u(`/s/o/${encodeURIComponent(r.slug)}`)),
    ...comms.map((r) => u(`/s/c/${encodeURIComponent(r.slug)}`)),
    ...users.map((r) => u(`/s/u/${encodeURIComponent(r.handle)}`)),
  ].join("\n")}\n</urlset>`;
  return new Response(body, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}

function robots(ctx) {
  const base = self(ctx.env);
  return new Response(`User-agent: *\nAllow: /s/\nDisallow: /v1/\nSitemap: ${base}/s/sitemap.xml\n`, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

// ── The weekly email ───────────────────────────────────────────────────────

/** Monday, at or after the digest hour, and not already sent this week. */
export function weeklyDue(t, hour = 7) {
  const d = new Date(t * 1000);
  return d.getUTCDay() === 1 && d.getUTCHours() >= hour;
}

/** What goes in one member's weekly email: lines of {text, href}, best first. */
export async function weeklyLines(env, user, t) {
  const since = t - 7 * DAY;
  const interests = parse(user.interests_json, []).map((x) => String(x).toLowerCase()).slice(0, 12);
  const lines = [];
  const like = interests.map(() => "LOWER(p.tags_json) LIKE ?").join(" OR ");
  const binds = interests.map((x) => `%"${x.replace(/[%_"]/g, "")}"%`);
  // Opportunities and events in their topics (or the newest, if they named none).
  const kinds = await all(env,
    `SELECT p.id, p.kind, p.title FROM posts p
      WHERE p.visibility = 'public' AND p.removed_at IS NULL AND p.created_at > ? AND p.kind IN ('opportunity', 'event')
        AND p.author_id != ? ${interests.length ? `AND (${like})` : ""}
      ORDER BY p.created_at DESC LIMIT 8`, since, user.id, ...binds);
  for (const p of kinds) {
    lines.push({ text: `${p.kind === "event" ? "Event" : "Opportunity"}: ${str(p.title, 120)}`, href: siteLink(env, `#/post/${encodeURIComponent(p.id)}`) });
  }
  // The week's most-saved public posts.
  const saved = await all(env,
    `SELECT p.id, p.title, COUNT(b.user_id) AS n FROM posts p JOIN bookmarks b ON b.post_id = p.id
      WHERE p.visibility = 'public' AND p.removed_at IS NULL AND b.created_at > ? AND p.author_id != ?
      GROUP BY p.id ORDER BY n DESC LIMIT 4`, since, user.id).catch(() => []);
  for (const p of saved) {
    if (p.title) lines.push({ text: `Most saved this week: ${str(p.title, 120)}`, href: siteLink(env, `#/post/${encodeURIComponent(p.id)}`) });
  }
  // People who joined near their study areas: one line pointing at the map.
  const near = await one(env,
    `SELECT COUNT(DISTINCT sa2.user_id) AS n FROM study_areas sa1 JOIN study_areas sa2 ON sa2.user_id != sa1.user_id
      AND sa2.on_map = 1 AND sa2.world = sa1.world
      AND ABS(sa2.lat - sa1.lat) < 2 AND ABS(sa2.lon - sa1.lon) < 2 AND sa2.created_at > ?
      WHERE sa1.user_id = ?`, since, user.id).catch(() => null);
  if (near && near.n) lines.push({ text: `${near.n} ${near.n === 1 ? "person" : "people"} started working near your study areas`, href: siteLink(env, "#/map") });
  return lines;
}

/** The Monday send. Mirrors sendDigests: idempotent per member per week. */
export async function sendWeekly(env, t = now(), { fetchImpl = fetch, limit = 100 } = {}) {
  const out = { sent: 0, empty: 0, failed: 0, held: 0 };
  if (!mailConfigured(env)) return { ...out, held: -1 };
  const week = Math.floor(t / (7 * DAY));
  const due = await all(env,
    `SELECT u.* FROM users u LEFT JOIN mail_prefs mp ON mp.user_id = u.id
      WHERE COALESCE(mp.weekly, 1) = 1 AND mp.unsubscribed_at IS NULL
        AND u.email NOT LIKE 'erased:%' AND u.suspended_until <= ? AND COALESCE(mp.last_weekly_at, 0) < ?
      LIMIT ?`, t, t - 6 * DAY, limit);
  for (const user of due) {
    const stamp = () => run(env,
      `INSERT INTO mail_prefs (user_id, last_weekly_at, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET last_weekly_at = excluded.last_weekly_at`, user.id, t, t);
    const lines = await weeklyLines(env, user, t);
    if (!lines.length) { await stamp(); out.empty += 1; continue; }
    const mail = await envelope(env, user, {
      subject: "New for you on the GeoID Network this week",
      heading: "New for you this week",
      intro: "Opportunities, events and work in your topics:",
      lines,
      footer: "You get this weekly email while you're a member. Turn it off in Settings.",
    });
    if (!mail) { out.held += 1; continue; }
    try {
      await sendEmail(env, mail, { idempotencyKey: `w-${user.id}-${week}`, fetchImpl });
      await stamp();
      await run(env, "INSERT INTO mail_queue (id, user_id, kind, status, created_at, sent_at) VALUES (?, ?, 'weekly', 'sent', ?, ?)",
        id("mq"), user.id, t, t);
      out.sent += 1;
    } catch (error) {
      out.failed += 1;
    }
  }
  return out;
}

export const routes = [
  ["GET", "/s/p/:id", sharePost],
  ["GET", "/s/o/:id", shareOrg],
  ["GET", "/s/c/:id", shareCommunity],
  ["GET", "/s/u/:id", shareUser],
  ["GET", "/s/sitemap.xml", sitemap],
  ["GET", "/robots.txt", robots],
];
