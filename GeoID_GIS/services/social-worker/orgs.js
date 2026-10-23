/**
 * Identity and institutions: organisations, verified affiliations, mentoring
 * and the first-run welcome. (Publication and ORCID checks are in verify.js.)
 *
 * ORGANISATIONS are universities, surveys, companies and agencies. Anybody
 * signed in may propose one; it is drawn as unverified until a site admin
 * verifies it. Members declare an affiliation by joining; the creator is the
 * first admin, and admins may post opportunities "as" the organisation.
 *
 * A VERIFIED AFFILIATION is not something a member can claim: it is computed
 * here, from the sign-in address (users.email) against a verified org's
 * domains, subdomains included. The address and its domain never leave this
 * file -- the only output is a 0/1 on the membership row and its copy on the
 * users row that publicUser() draws. Everything else is self-declared and
 * labelled so.
 */
import {
  fail, now, id, str, url, int, tags, parse, requireUser, currentUser, isAdmin, publicUser,
  usersById, userByHandle, blockedBetween, NOT_BLOCKED, VISIBLE_POSTS, visibleBinds, notify, audit,
  rateLimit, avatarUrl,
} from "./lib.js";
import { body, all, one, run, param, slugify, SLUG_RE, bool, cursorClause, paged, limitOf } from "./collab.js";
import { routes as postRoutes, shapePosts } from "./posts.js";

export const ORG_KINDS = ["university", "survey", "company", "agency", "nonprofit", "other"];
const ORG_ROLES = ["admin", "member"];
const ORG_POST_KINDS = ["opportunity", "event", "challenge"];
const MAX_DOMAINS = 10;
const MAX_PENDING_PROPOSALS = 5;

// Addresses anybody can have prove nothing about where somebody works.
const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "pm.me",
  "gmx.com", "gmx.net", "mail.com", "yandex.com", "yandex.ru", "qq.com", "163.com", "126.com", "zoho.com",
  "fastmail.com", "hey.com", "tutanota.com"]);
// "ac.uk", "edu.au", "co.jp": a registry suffix, not an institution.
const GENERIC_SECOND_LEVEL = new Set(["ac", "co", "com", "edu", "gov", "govt", "org", "net", "nhs", "mod", "sch", "police", "mil", "res"]);

// ── Domains: the only place an email address is read ──────────────────────

/** The part after the @, lower-cased, or "". Internal only. */
function emailDomain(email) {
  const text = String(email || "").toLowerCase();
  const at = text.lastIndexOf("@");
  return at > 0 && !text.startsWith("erased:") ? text.slice(at + 1) : "";
}

/** "a.geo.leeds.ac.uk" -> ["a.geo.leeds.ac.uk", "geo.leeds.ac.uk", "leeds.ac.uk", "ac.uk"]. */
export function domainSuffixes(domain) {
  const labels = String(domain || "").split(".").filter(Boolean);
  const out = [];
  for (let i = 0; i <= labels.length - 2; i += 1) out.push(labels.slice(i).join("."));
  return out;
}

/** Does an address at `addressDomain` belong to `orgDomain`? Subdomains count; lookalikes do not. */
export function domainMatches(addressDomain, orgDomain) {
  const a = String(addressDomain || "").toLowerCase();
  const d = String(orgDomain || "").toLowerCase();
  return !!a && !!d && (a === d || a.endsWith(`.${d}`));
}

/**
 * The domains an org may claim: host names only, at most 10, never a free
 * mail provider or a bare registry suffix. Refused loudly so the proposer
 * knows why rather than finding a domain silently dropped.
 */
export function cleanDomains(list) {
  const raw = Array.isArray(list) ? list : String(list || "").split(/[\s,]+/);
  const out = [];
  for (const item of raw) {
    let d = str(item, 120).toLowerCase().replace(/^https?:\/\//, "").replace(/^.*@/, "").replace(/\/.*$/, "").replace(/\.$/, "");
    if (!d) continue;
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) || d.split(".").some((l) => l.startsWith("-") || l.endsWith("-"))) {
      fail(400, `"${d}" is not a domain name like leeds.ac.uk.`);
    }
    d = d.replace(/^www\./, "");
    const labels = d.split(".");
    if (FREE_MAIL.has(d) || (labels.length === 2 && GENERIC_SECOND_LEVEL.has(labels[0]))) {
      fail(400, `"${d}" can't identify an organisation: anybody can have an address there.`);
    }
    if (!out.includes(d)) out.push(d);
  }
  if (out.length > MAX_DOMAINS) fail(400, `At most ${MAX_DOMAINS} domains.`);
  return out;
}

/** 1 if `userRow`'s sign-in address is at one of a VERIFIED org's domains. */
function affiliationVerified(org, domains, userRow) {
  if (!org || !org.verified || org.removed_at) return 0;
  const at = emailDomain(userRow?.email);
  return domains.some((d) => domainMatches(at, d)) ? 1 : 0;
}

// ── The affiliation copy on users ──────────────────────────────────────────

// Is users.aff_org_id still a live membership? (Used inside UPDATE users.)
const LIVE = `EXISTS (SELECT 1 FROM org_members m JOIN orgs o ON o.id = m.org_id
  WHERE m.org_id = users.aff_org_id AND m.user_id = users.id AND o.removed_at IS NULL)`;

/**
 * Bring the shown affiliation in step with the membership rows: keep it while
 * it is live, otherwise fall back to another membership (verified first),
 * then copy slug/name/verified for publicUser(). `where` selects the users.
 */
function syncStatements(DB, where, ...binds) {
  return [
    DB.prepare(`UPDATE users SET aff_org_id = (
        SELECT m.org_id FROM org_members m JOIN orgs o ON o.id = m.org_id
         WHERE m.user_id = users.id AND o.removed_at IS NULL ORDER BY m.verified DESC, m.created_at LIMIT 1)
      WHERE (${where}) AND (aff_org_id IS NULL OR NOT ${LIVE})`).bind(...binds),
    DB.prepare(`UPDATE users SET
        aff_slug = COALESCE((SELECT slug FROM orgs WHERE id = users.aff_org_id), ''),
        aff_name = COALESCE((SELECT name FROM orgs WHERE id = users.aff_org_id), ''),
        aff_verified = COALESCE((SELECT verified FROM org_members WHERE org_id = users.aff_org_id AND user_id = users.id), 0)
      WHERE ${where}`).bind(...binds),
  ];
}

const syncUser = (env, userId) => env.DB.batch(syncStatements(env.DB, "id = ?", userId));
const recountStatement = (DB, orgId) =>
  DB.prepare("UPDATE orgs SET member_count = (SELECT COUNT(*) FROM org_members WHERE org_id = ?) WHERE id = ?").bind(orgId, orgId);

/**
 * Recompute every member's verified flag for one org (after it is verified,
 * unverified, or its domains change), its member count, and the copies on
 * users and posts.
 */
async function recomputeOrg(env, orgId) {
  const org = await one(env, "SELECT * FROM orgs WHERE id = ?", orgId);
  const domains = parse(org?.domains_json, []);
  const members = await all(env,
    "SELECT m.user_id, m.verified, u.email FROM org_members m JOIN users u ON u.id = m.user_id WHERE m.org_id = ?", orgId);
  const statements = [];
  for (const m of members) {
    const v = affiliationVerified(org, domains, m);
    if (v !== m.verified) {
      statements.push(env.DB.prepare("UPDATE org_members SET verified = ? WHERE org_id = ? AND user_id = ?").bind(v, orgId, m.user_id));
    }
  }
  statements.push(recountStatement(env.DB, orgId));
  statements.push(env.DB.prepare("UPDATE posts SET org_slug = ?, org_name = ? WHERE org_id = ?").bind(org.slug, org.name, orgId));
  statements.push(...syncStatements(env.DB, "id IN (SELECT user_id FROM org_members WHERE org_id = ?) OR aff_org_id = ?", orgId, orgId));
  await env.DB.batch(statements);
}

// ── Shapes and lookups ─────────────────────────────────────────────────────

export function orgShape(env, row, extra = {}) {
  return {
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    description: row.description,
    website: row.website,
    logo: avatarUrl(env, row.logo_key),
    domains: parse(row.domains_json, []),
    location: row.location,
    verified: !!row.verified,
    verified_at: row.verified_at || null,
    member_count: row.member_count,
    created_at: row.created_at,
    ...extra,
  };
}

async function findOrg(env, slug) {
  const row = await one(env, "SELECT * FROM orgs WHERE slug = ?", String(slug || "").toLowerCase());
  if (!row || row.removed_at) fail(404, "No such organisation.");
  return row;
}

async function membershipOf(env, orgId, userId) {
  if (!userId) return null;
  return one(env, "SELECT * FROM org_members WHERE org_id = ? AND user_id = ?", orgId, userId);
}

/** Org admin or site admin; otherwise 403. */
async function requireOrgAdmin(ctx, user, org) {
  const m = await membershipOf(ctx.env, org.id, user.id);
  if ((m && m.role === "admin") || isAdmin(ctx.env, user)) return m;
  return fail(403, "Only an admin of this organisation can do that.");
}

async function adminCount(env, orgId) {
  return (await one(env, "SELECT COUNT(*) AS n FROM org_members WHERE org_id = ? AND role = 'admin'", orgId)).n;
}

/** As with avatars: only a public image the caller uploaded can be a logo. */
async function logoKey(env, user, raw) {
  const key = str(raw, 200);
  if (!key) return "";
  const media = await one(env, "SELECT * FROM media WHERE key = ?", key);
  if (!media || media.owner_id !== user.id) fail(400, "Upload the logo first.");
  if (media.scope !== "public" || !String(media.type).startsWith("image/")) fail(400, "A logo must be a public image.");
  return key;
}

function kindOf(value) {
  const kind = value == null || value === "" ? "other" : String(value);
  if (!ORG_KINDS.includes(kind)) fail(400, `kind must be one of: ${ORG_KINDS.join(", ")}.`);
  return kind;
}

const writeDomains = (DB, orgId, domains) => [
  DB.prepare("DELETE FROM org_domains WHERE org_id = ?").bind(orgId),
  ...domains.map((d) => DB.prepare("INSERT OR IGNORE INTO org_domains (domain, org_id) VALUES (?, ?)").bind(d, orgId)),
];

/** Verified orgs whose domains cover this user's sign-in address. Never says which address. */
async function orgsMatchingAddress(env, userRow) {
  const suffixes = domainSuffixes(emailDomain(userRow?.email));
  if (!suffixes.length) return [];
  return all(env,
    `SELECT DISTINCT o.* FROM org_domains d JOIN orgs o ON o.id = d.org_id
      WHERE d.domain IN (${suffixes.map(() => "?").join(",")}) AND o.verified = 1 AND o.removed_at IS NULL
      ORDER BY o.name LIMIT 5`, ...suffixes);
}

// ── Organisations ──────────────────────────────────────────────────────────

/** GET /v1/orgs?q=&kind=&verified=1&pending=1&mine=1&cursor= */
async function listOrgs(ctx) {
  const { env } = ctx;
  const viewer = await currentUser(ctx);
  const where = ["o.removed_at IS NULL"];
  const binds = [];
  const q = str(param(ctx, "q"), 100);
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push("(o.name LIKE ? ESCAPE '\\' OR o.slug LIKE ? ESCAPE '\\' OR o.location LIKE ? ESCAPE '\\' OR o.domains_json LIKE ? ESCAPE '\\')");
    binds.push(like, like, like, like);
  }
  const kind = param(ctx, "kind");
  if (kind) { where.push("o.kind = ?"); binds.push(kindOf(kind)); }
  if (param(ctx, "verified") === "1") where.push("o.verified = 1");
  // The verification queue: unverified proposals, for the people who verify.
  if (param(ctx, "pending") === "1") {
    if (!isAdmin(env, viewer)) fail(403, "Only site admins see the verification queue.");
    where.push("o.verified = 0");
  }
  if (param(ctx, "mine") === "1") {
    if (!viewer) fail(401, "Sign in to see your organisations.");
    where.push("EXISTS (SELECT 1 FROM org_members m WHERE m.org_id = o.id AND m.user_id = ?)");
    binds.push(viewer.id);
  }
  // A directory reads best verified-first and alphabetical, so the cursor is
  // an offset rather than a time.
  const offset = Math.max(0, int(param(ctx, "cursor"), 0));
  const limit = limitOf(ctx);
  const rows = await all(env,
    `SELECT o.* FROM orgs o WHERE ${where.join(" AND ")} ORDER BY o.verified DESC, o.member_count DESC, o.name, o.id LIMIT ? OFFSET ?`,
    ...binds, limit + 1, offset);
  const mine = viewer ? new Set((await all(env, "SELECT org_id FROM org_members WHERE user_id = ?", viewer.id)).map((r) => r.org_id)) : new Set();
  return {
    items: rows.slice(0, limit).map((r) => orgShape(env, r, { member: mine.has(r.id) })),
    next: rows.length > limit ? String(offset + limit) : null,
  };
}

/** POST /v1/orgs -- propose an organisation. It starts unverified; the proposer is its first admin. */
async function createOrg(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const b = await body(ctx);
  const name = str(b.name, 120);
  if (name.length < 2) fail(400, "An organisation needs a name.");
  const slug = b.slug ? str(b.slug, 40).toLowerCase() : slugify(name);
  if (!SLUG_RE.test(slug)) fail(400, "The short address is 2 to 40 lower-case letters, numbers and dashes.");
  if (await one(env, "SELECT 1 FROM orgs WHERE slug = ?", slug)) fail(409, "That short address is taken.");
  const same = await one(env, "SELECT slug FROM orgs WHERE lower(name) = lower(?) AND removed_at IS NULL", name);
  if (same) fail(409, `There is already an organisation called that: /o/${same.slug}. Join it instead.`);
  const pending = (await one(env,
    "SELECT COUNT(*) AS n FROM orgs WHERE created_by = ? AND verified = 0 AND removed_at IS NULL", user.id)).n;
  if (pending >= MAX_PENDING_PROPOSALS) fail(409, `You have ${pending} organisations waiting to be verified already.`);
  const website = url(b.website);
  if (str(b.website) && !website) fail(400, "The website must be an http(s) link.");
  const domains = cleanDomains(b.domains);
  const t = now();
  const row = {
    id: id("o"), slug, name, kind: kindOf(b.kind), description: str(b.description, 2000), website,
    logo_key: await logoKey(env, user, b.logo_key ?? b.logo), domains_json: JSON.stringify(domains),
    location: str(b.location, 120),
  };
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO orgs (id, slug, name, kind, description, website, logo_key, domains_json, location,
        created_by, member_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
      .bind(row.id, row.slug, row.name, row.kind, row.description, row.website, row.logo_key, row.domains_json,
        row.location, user.id, t, t),
    ...writeDomains(env.DB, row.id, domains),
    // Unverified, so the creator's own affiliation is self-declared for now.
    env.DB.prepare("INSERT INTO org_members (org_id, user_id, role, verified, created_at) VALUES (?, ?, 'admin', 0, ?)").bind(row.id, user.id, t),
    ...syncStatements(env.DB, "id = ?", user.id),
  ]);
  return orgDetail(ctx, await findOrg(env, slug), user);
}

async function orgDetail(ctx, org, viewer) {
  const { env } = ctx;
  const m = await membershipOf(env, org.id, viewer?.id);
  const siteAdmin = isAdmin(env, viewer);
  const following = viewer ? !!(await one(env,
    "SELECT 1 FROM follows WHERE follower_id = ? AND target_type = 'org' AND target_id = ?", viewer.id, org.id)) : false;
  const followers = (await one(env, "SELECT COUNT(*) AS n FROM follows WHERE target_type = 'org' AND target_id = ?", org.id)).n;
  const adminRows = await all(env,
    `SELECT u.* FROM org_members m JOIN users u ON u.id = m.user_id WHERE m.org_id = ? AND m.role = 'admin'
      ${viewer ? `AND ${NOT_BLOCKED("u.id")}` : ""} ORDER BY m.created_at LIMIT 10`,
    org.id, ...(viewer ? [viewer.id, viewer.id] : []));
  const postRows = await all(env,
    `SELECT p.* FROM posts p WHERE p.org_id = ? AND ${VISIBLE_POSTS} ORDER BY p.created_at DESC LIMIT 10`,
    org.id, ...visibleBinds(viewer));
  return {
    org: orgShape(env, org),
    counts: { members: org.member_count, followers },
    admins: adminRows.map((r) => publicUser(env, r)),
    posts: await shapePosts(env, viewer, postRows),
    viewer: viewer ? {
      member: !!m, role: m ? m.role : null, verified: !!m?.verified, following,
      can_edit: (!!m && m.role === "admin") || siteAdmin, can_post: !!m && m.role === "admin", site_admin: siteAdmin,
      // Name and domains of a verified org are the site admins' to change.
      locked: !!org.verified && !siteAdmin,
    } : null,
  };
}

async function getOrg(ctx) {
  const viewer = await currentUser(ctx);
  const org = await findOrg(ctx.env, ctx.params.slug);
  return orgDetail(ctx, org, viewer);
}

async function patchOrg(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const org = await findOrg(env, ctx.params.slug);
  await requireOrgAdmin(ctx, user, org);
  const siteAdmin = isAdmin(env, user);
  const b = await body(ctx);
  const has = (k) => b[k] !== undefined;
  const set = {};
  if (has("name")) {
    const name = str(b.name, 120);
    if (name.length < 2) fail(400, "An organisation needs a name.");
    if (name !== org.name) set.name = name;
  }
  let domains = null;
  if (has("domains")) {
    domains = cleanDomains(b.domains);
    if (JSON.stringify(domains) === org.domains_json) domains = null;
    else set.domains_json = JSON.stringify(domains);
  }
  if (org.verified && !siteAdmin && (set.name || domains)) {
    fail(403, "A verified organisation's name and domains are changed by the site admins. Report the page to ask.");
  }
  if (has("kind")) set.kind = kindOf(b.kind);
  if (has("description")) set.description = str(b.description, 2000);
  if (has("location")) set.location = str(b.location, 120);
  if (has("website")) {
    set.website = url(b.website);
    if (str(b.website) && !set.website) fail(400, "The website must be an http(s) link.");
  }
  if (has("logo_key") || has("logo")) set.logo_key = await logoKey(env, user, b.logo_key ?? b.logo);
  const cols = Object.keys(set);
  if (cols.length) {
    set.updated_at = now(); cols.push("updated_at");
    await env.DB.batch([
      env.DB.prepare(`UPDATE orgs SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).bind(...cols.map((c) => set[c]), org.id),
      ...(domains ? writeDomains(env.DB, org.id, domains) : []),
    ]);
    if (set.name || domains) await recomputeOrg(env, org.id);
    if (siteAdmin && org.verified && (set.name || domains)) {
      await audit(env, user.id, "org_edit_locked", "org", org.slug, { name: set.name || undefined, domains: domains || undefined });
    }
  }
  return orgDetail(ctx, await findOrg(env, org.slug), user);
}

/** POST /v1/orgs/:slug/verify {verified} -- site admins only; audited. */
async function verifyOrg(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  if (!isAdmin(env, user)) fail(403, "Only site admins verify organisations.");
  await rateLimit(ctx, user);
  const org = await findOrg(env, ctx.params.slug);
  const b = await body(ctx);
  const on = bool(b.verified, true);
  await run(env, "UPDATE orgs SET verified = ?, verified_by = ?, verified_at = ?, updated_at = ? WHERE id = ?",
    on ? 1 : 0, on ? user.id : null, on ? now() : null, now(), org.id);
  await recomputeOrg(env, org.id);
  await audit(env, user.id, on ? "org_verify" : "org_unverify", "org", org.slug, { note: str(b.note, 500) });
  for (const a of await all(env, "SELECT user_id FROM org_members WHERE org_id = ? AND role = 'admin'", org.id)) {
    await notify(env, a.user_id, "moderation", user.id, "org", org.slug,
      on ? `${org.name} is now a verified organisation` : `${org.name} is no longer verified`);
  }
  return orgDetail(ctx, await findOrg(env, org.slug), user);
}

/** DELETE /v1/orgs/:slug -- site admins, or the org's own admin while it is unverified. */
async function removeOrg(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const org = await findOrg(env, ctx.params.slug);
  const m = await membershipOf(env, org.id, user.id);
  if (!isAdmin(env, user) && !(m && m.role === "admin" && !org.verified)) {
    fail(403, "Only site admins can remove a verified organisation.");
  }
  const members = await all(env, "SELECT user_id FROM org_members WHERE org_id = ?", org.id);
  await env.DB.batch([
    env.DB.prepare("UPDATE orgs SET removed_at = ?, verified = 0 WHERE id = ?").bind(now(), org.id),
    env.DB.prepare("DELETE FROM org_members WHERE org_id = ?").bind(org.id),
    env.DB.prepare("DELETE FROM org_domains WHERE org_id = ?").bind(org.id),
    env.DB.prepare("DELETE FROM follows WHERE target_type = 'org' AND target_id = ?").bind(org.id),
    env.DB.prepare("UPDATE posts SET org_id = NULL, org_slug = '', org_name = '' WHERE org_id = ?").bind(org.id),
    ...members.flatMap((r) => syncStatements(env.DB, "id = ?", r.user_id)),
  ]);
  await audit(env, user.id, "org_remove", "org", org.slug, { name: org.name });
  return { ok: true };
}

// ── Membership (the affiliation itself) ────────────────────────────────────

/** POST /v1/orgs/:slug/join -- declare an affiliation. Verified if the sign-in address matches. */
async function joinOrg(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const org = await findOrg(env, ctx.params.slug);
  const existing = await membershipOf(env, org.id, user.id);
  const fresh = await one(env, "SELECT * FROM users WHERE id = ?", user.id);
  const verified = affiliationVerified(org, parse(org.domains_json, []), fresh);
  if (!existing) {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO org_members (org_id, user_id, role, verified, created_at) VALUES (?, ?, 'member', ?, ?)")
        .bind(org.id, user.id, verified, now()),
      recountStatement(env.DB, org.id),
    ]);
  }
  // Shown on cards: this one if none is shown yet, or if it is verified and
  // the one shown now is not.
  if (!fresh.aff_org_id || (verified && !fresh.aff_verified)) {
    await run(env, "UPDATE users SET aff_org_id = ? WHERE id = ?", org.id, user.id);
  }
  await syncUser(env, user.id);
  return { ok: true, member: true, role: existing ? existing.role : "member", verified: !!verified };
}

async function leaveOrg(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const org = await findOrg(env, ctx.params.slug);
  const m = await membershipOf(env, org.id, user.id);
  if (!m) return { ok: true, member: false };
  if (m.role === "admin" && org.member_count > 1 && await adminCount(env, org.id) <= 1) {
    fail(409, "You are this organisation's only admin. Make somebody else an admin first.");
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM org_members WHERE org_id = ? AND user_id = ?").bind(org.id, user.id),
    recountStatement(env.DB, org.id),
    ...syncStatements(env.DB, "id = ?", user.id),
  ]);
  return { ok: true, member: false };
}

/** GET /v1/orgs/:slug/members?cursor= -- [{user, role, verified}], newest first. */
async function listMembers(ctx) {
  const { env } = ctx;
  const viewer = await currentUser(ctx);
  const org = await findOrg(env, ctx.params.slug);
  const limit = limitOf(ctx);
  const c = cursorClause(ctx, "m.created_at", "m.user_id");
  const rows = await all(env,
    `SELECT u.*, m.role AS m_role, m.verified AS m_verified, m.created_at AS m_at, m.user_id AS m_uid
       FROM org_members m JOIN users u ON u.id = m.user_id
      WHERE m.org_id = ? ${viewer ? `AND ${NOT_BLOCKED("u.id")}` : ""}${c.sql}
      ORDER BY m.created_at DESC, m.user_id DESC LIMIT ?`,
    org.id, ...(viewer ? [viewer.id, viewer.id] : []), ...c.binds, limit + 1);
  const { items, next } = paged(rows, limit, (r) => ({ created_at: r.m_at, id: r.m_uid }));
  return { items: items.map((r) => ({ user: publicUser(env, r), role: r.m_role, verified: !!r.m_verified, since: r.m_at })), next };
}

/** POST /v1/orgs/:slug/members/:handle {role} -- org admins promote or demote. */
async function setMemberRole(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const org = await findOrg(env, ctx.params.slug);
  await requireOrgAdmin(ctx, user, org);
  const b = await body(ctx);
  const role = String(b.role || "");
  if (!ORG_ROLES.includes(role)) fail(400, `role must be one of: ${ORG_ROLES.join(", ")}.`);
  const person = await userByHandle(env, ctx.params.handle);
  const m = person && await membershipOf(env, org.id, person.id);
  if (!m) fail(404, "That person is not a member of this organisation.");
  if (m.role === "admin" && role !== "admin" && await adminCount(env, org.id) <= 1) {
    fail(409, "An organisation needs at least one admin.");
  }
  await run(env, "UPDATE org_members SET role = ? WHERE org_id = ? AND user_id = ?", role, org.id, person.id);
  await audit(env, user.id, "org_role", "org", org.slug, { handle: person.handle, role });
  if (role === "admin" && m.role !== "admin") {
    await notify(env, person.id, "invite", user.id, "org", org.slug, `You are now an admin of ${org.name}`);
  }
  return { ok: true, role };
}

async function removeMember(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const org = await findOrg(env, ctx.params.slug);
  await requireOrgAdmin(ctx, user, org);
  const person = await userByHandle(env, ctx.params.handle);
  const m = person && await membershipOf(env, org.id, person.id);
  if (!m) fail(404, "That person is not a member of this organisation.");
  if (m.role === "admin" && await adminCount(env, org.id) <= 1) fail(409, "An organisation needs at least one admin.");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM org_members WHERE org_id = ? AND user_id = ?").bind(org.id, person.id),
    recountStatement(env.DB, org.id),
    ...syncStatements(env.DB, "id = ?", person.id),
  ]);
  await audit(env, user.id, "org_remove_member", "org", org.slug, { handle: person.handle });
  return { ok: true };
}

/**
 * POST /v1/orgs/:slug/posts -- an org admin posts an opportunity (or event,
 * challenge) as the organisation. The post itself is made by posts.js's own
 * create route, so every rule there (fields, visibility, rate limit) holds;
 * this only stamps the organisation on it afterwards.
 */
async function postAsOrg(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const org = await findOrg(env, ctx.params.slug);
  const m = await membershipOf(env, org.id, user.id);
  if (!m || m.role !== "admin") fail(403, "Only an admin of this organisation can post as it.");
  const b = await body(ctx);
  const kind = b.kind == null ? "opportunity" : String(b.kind);
  if (!ORG_POST_KINDS.includes(kind)) fail(400, `An organisation posts: ${ORG_POST_KINDS.join(", ")}.`);
  const meta = b.meta && typeof b.meta === "object" && !Array.isArray(b.meta) ? { ...b.meta } : {};
  if (kind === "opportunity" && !str(meta.org)) meta.org = org.name;
  const create = postRoutes.find(([method, pattern]) => method === "POST" && pattern === "/v1/posts")[2];
  const inner = {
    ...ctx,
    params: {},
    _user: user,
    request: new Request(ctx.request.url, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...b, kind, meta }),
    }),
  };
  const created = await create(inner);
  await run(env, "UPDATE posts SET org_id = ?, org_slug = ?, org_name = ? WHERE id = ?", org.id, org.slug, org.name, created.id);
  // Followers of the organisation hear about what it posts publicly.
  if (created.visibility === "public") {
    const followers = await all(env,
      "SELECT follower_id FROM follows WHERE target_type = 'org' AND target_id = ? LIMIT 1000", org.id);
    for (const f of followers) {
      await notify(env, f.follower_id, "project_update", user.id, "post", created.id, `${org.name}: ${str(created.title || created.body, 120)}`);
    }
  }
  return { ...created, org: { slug: org.slug, name: org.name } };
}

// ── The caller's own affiliations ──────────────────────────────────────────

/** GET /v1/me/orgs -- memberships, which one cards show, and verified orgs matching the sign-in address. */
async function myOrgs(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const fresh = await one(env, "SELECT * FROM users WHERE id = ?", user.id);
  const rows = await all(env,
    `SELECT o.*, m.role AS m_role, m.verified AS m_verified FROM org_members m JOIN orgs o ON o.id = m.org_id
      WHERE m.user_id = ? AND o.removed_at IS NULL ORDER BY m.verified DESC, o.name`, user.id);
  const joined = new Set(rows.map((r) => r.id));
  // "Your sign-in address matches X" is said to its owner only, and names the
  // organisation, not the address.
  const suggested = (await orgsMatchingAddress(env, fresh)).filter((o) => !joined.has(o.id))
    .map((o) => ({ slug: o.slug, name: o.name, kind: o.kind }));
  return {
    items: rows.map((r) => ({ org: orgShape(env, r), role: r.m_role, verified: !!r.m_verified, primary: r.id === fresh.aff_org_id })),
    suggested,
    next: null,
  };
}

/** PATCH /v1/me/affiliation {org: slug|null} -- which membership cards show (null shows none). */
async function setAffiliation(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const b = await body(ctx);
  if (b.org == null || b.org === "") {
    await run(env, "UPDATE users SET aff_org_id = NULL, aff_slug = '', aff_name = '', aff_verified = 0 WHERE id = ?", user.id);
    return myOrgs(ctx);
  }
  const org = await findOrg(env, b.org);
  if (!(await membershipOf(env, org.id, user.id))) fail(400, "Join the organisation first.");
  await run(env, "UPDATE users SET aff_org_id = ? WHERE id = ?", org.id, user.id);
  await syncUser(env, user.id);
  return myOrgs(ctx);
}

// ── Mentoring ──────────────────────────────────────────────────────────────

const OPEN_MENTORING = ["requested", "active"];
const MENTORING_STATUS = ["requested", "active", "declined", "withdrawn", "ended"];

/** PATCH /v1/me/mentoring {open, topics} */
async function setMentoring(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const b = await body(ctx);
  const set = {};
  if (b.open !== undefined) set.mentoring_open = bool(b.open) ? 1 : 0;
  if (b.topics !== undefined) set.mentoring_topics_json = JSON.stringify(tags(b.topics));
  const cols = Object.keys(set);
  if (cols.length) {
    await run(env, `UPDATE users SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE id = ?`,
      ...cols.map((c) => set[c]), now(), user.id);
  }
  const fresh = await one(env, "SELECT mentoring_open, mentoring_topics_json FROM users WHERE id = ?", user.id);
  return { open: !!fresh.mentoring_open, topics: parse(fresh.mentoring_topics_json, []) };
}

async function mentoringShape(env, rows, viewer) {
  const people = await usersById(env, rows.flatMap((r) => [r.mentee_id, r.mentor_id]));
  return rows.map((r) => ({
    id: r.id,
    mentee: people[r.mentee_id] || null,
    mentor: people[r.mentor_id] || null,
    role: r.mentor_id === viewer.id ? "mentor" : "mentee",
    topic: r.topic,
    message: r.message,
    status: r.status,
    conversation_id: r.status === "active" ? r.conversation_id : null,
    created_at: r.created_at,
    responded_at: r.responded_at,
  }));
}

/** GET /v1/mentoring/requests?role=mentor|mentee&status= */
async function listMentoring(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const role = param(ctx, "role");
  const where = role === "mentor" ? "mentor_id = ?" : role === "mentee" ? "mentee_id = ?" : "(mentor_id = ? OR mentee_id = ?)";
  const binds = role === "mentor" || role === "mentee" ? [user.id] : [user.id, user.id];
  const status = param(ctx, "status");
  if (status && !MENTORING_STATUS.includes(status)) fail(400, `status must be one of: ${MENTORING_STATUS.join(", ")}.`);
  const limit = limitOf(ctx);
  const c = cursorClause(ctx, "created_at", "id");
  const rows = await all(env,
    `SELECT * FROM mentoring_requests WHERE ${where} ${status ? "AND status = ?" : ""}${c.sql}
      ORDER BY created_at DESC, id DESC LIMIT ?`, ...binds, ...(status ? [status] : []), ...c.binds, limit + 1);
  const { items, next } = paged(rows, limit);
  return { items: await mentoringShape(env, items, user), next };
}

/** POST /v1/mentoring/requests {handle, topic, message} */
async function requestMentoring(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const b = await body(ctx);
  const mentor = await userByHandle(env, str(b.handle, 40).replace(/^@/, ""));
  if (!mentor || String(mentor.email).startsWith("erased:")) fail(404, "No such person.");
  if (mentor.id === user.id) fail(400, "You can't ask yourself.");
  if (await blockedBetween(env, user.id, mentor.id)) fail(403, "You can't ask this person.");
  if (!mentor.mentoring_open) fail(409, "This member is not taking mentoring requests at the moment.");
  const open = await one(env,
    `SELECT id, status FROM mentoring_requests WHERE mentee_id = ? AND mentor_id = ? AND status IN (${OPEN_MENTORING.map(() => "?").join(",")})`,
    user.id, mentor.id, ...OPEN_MENTORING);
  if (open) fail(409, open.status === "active" ? "They are already mentoring you." : "You have already asked; they haven't answered yet.");
  const t = now();
  const row = { id: id("mr"), topic: str(b.topic, 120), message: str(b.message, 2000) };
  await run(env,
    `INSERT INTO mentoring_requests (id, mentee_id, mentor_id, topic, message, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'requested', ?, ?)`, row.id, user.id, mentor.id, row.topic, row.message, t, t);
  await notify(env, mentor.id, "mentoring", user.id, "user", user.handle,
    `${user.name} asked you for mentoring${row.topic ? ` on ${row.topic}` : ""}`);
  const saved = await one(env, "SELECT * FROM mentoring_requests WHERE id = ?", row.id);
  return (await mentoringShape(env, [saved], user))[0];
}

/**
 * Open (or reuse) the conversation an accepted mentoring request lives in:
 * the pair's existing direct conversation when there is one -- messages.js
 * keeps one per pair -- otherwise a new one, active for both.
 */
async function mentoringConversation(env, mentor, mentee, topic) {
  const t = now();
  const existing = await one(env,
    `SELECT c.id FROM conversations c
       JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = ?
       JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = ?
      WHERE c.kind = 'dm' LIMIT 1`, mentor.id, mentee.id);
  const text = `Mentoring request accepted${topic ? `: ${topic}` : ""}. This conversation is where you two can talk.`;
  if (existing) {
    await env.DB.batch([
      env.DB.prepare("UPDATE conversation_members SET status = 'active' WHERE conversation_id = ? AND user_id IN (?, ?)").bind(existing.id, mentor.id, mentee.id),
      env.DB.prepare("INSERT INTO messages (id, conversation_id, sender_id, body, created_at) VALUES (?, ?, ?, ?, ?)").bind(id("m"), existing.id, mentor.id, text, t),
      env.DB.prepare("UPDATE conversations SET last_at = ? WHERE id = ?").bind(t, existing.id),
    ]);
    return existing.id;
  }
  const convId = id("cv");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO conversations (id, kind, title, created_by, last_at, created_at) VALUES (?, 'dm', '', ?, ?, ?)").bind(convId, mentor.id, t, t),
    env.DB.prepare("INSERT INTO conversation_members (conversation_id, user_id, status, last_read) VALUES (?, ?, 'active', ?)").bind(convId, mentor.id, t),
    env.DB.prepare("INSERT INTO conversation_members (conversation_id, user_id, status, last_read) VALUES (?, ?, 'active', 0)").bind(convId, mentee.id),
    env.DB.prepare("INSERT INTO messages (id, conversation_id, sender_id, body, created_at) VALUES (?, ?, ?, ?, ?)").bind(id("m"), convId, mentor.id, text, t),
  ]);
  return convId;
}

/** POST /v1/mentoring/requests/:id/respond {accept} -- the mentor. */
async function respondMentoring(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const r = await one(env, "SELECT * FROM mentoring_requests WHERE id = ?", ctx.params.id);
  if (!r || r.mentor_id !== user.id) fail(404, "No such request.");
  if (r.status !== "requested") fail(409, "That request has already been answered.");
  const accept = bool((await body(ctx)).accept);
  const mentee = await one(env, "SELECT * FROM users WHERE id = ?", r.mentee_id);
  const t = now();
  if (accept) {
    if (await blockedBetween(env, user.id, mentee.id)) fail(403, "You can't mentor this person.");
    const convId = await mentoringConversation(env, user, mentee, r.topic);
    await run(env, "UPDATE mentoring_requests SET status = 'active', conversation_id = ?, responded_at = ?, updated_at = ? WHERE id = ?",
      convId, t, t, r.id);
    await notify(env, mentee.id, "mentoring", user.id, "conversation", convId, `${user.name} accepted your mentoring request`);
  } else {
    await run(env, "UPDATE mentoring_requests SET status = 'declined', responded_at = ?, updated_at = ? WHERE id = ?", t, t, r.id);
    // Declining is said once, quietly, without a reason.
    await notify(env, mentee.id, "mentoring", user.id, "user", user.handle, `${user.name} can't take on your mentoring request right now`);
  }
  const saved = await one(env, "SELECT * FROM mentoring_requests WHERE id = ?", r.id);
  return (await mentoringShape(env, [saved], user))[0];
}

/** POST /v1/mentoring/requests/:id/close -- the mentee withdraws a request; either side ends an active one. */
async function closeMentoring(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const r = await one(env, "SELECT * FROM mentoring_requests WHERE id = ?", ctx.params.id);
  if (!r || (r.mentor_id !== user.id && r.mentee_id !== user.id)) fail(404, "No such request.");
  let status = null;
  if (r.status === "requested" && r.mentee_id === user.id) status = "withdrawn";
  else if (r.status === "active") status = "ended";
  else fail(409, "There is nothing to close.");
  await run(env, "UPDATE mentoring_requests SET status = ?, updated_at = ? WHERE id = ?", status, now(), r.id);
  const saved = await one(env, "SELECT * FROM mentoring_requests WHERE id = ?", r.id);
  return (await mentoringShape(env, [saved], user))[0];
}

/**
 * For reputation.js: mentoring a member accepted counts, as mentor, whether
 * still active or since ended. The details are between the two people, so it
 * is counted but not named.
 */
export async function mentoringEvidence(env, userId) {
  const rows = await all(env,
    "SELECT id FROM mentoring_requests WHERE mentor_id = ? AND status IN ('active', 'ended') ORDER BY responded_at DESC", userId);
  return rows.map(() => ({ type: "mentoring", id: null, title: "Mentored a member (the details are private)" }));
}

// ── The welcome ────────────────────────────────────────────────────────────

/** A profile with nothing on it yet: no headline, no interests, no study areas. */
async function isBare(env, row) {
  if (str(row.headline) || parse(row.interests_json, []).length) return false;
  return !(await one(env, "SELECT 1 FROM study_areas WHERE user_id = ? LIMIT 1", row.id));
}

/**
 * GET /v1/me/onboarding -- whether to show the welcome, and what to suggest:
 * communities by interest, people who opted in to the matcher and share an
 * interest (each with its reason), and verified organisations that match the
 * sign-in address.
 */
async function getOnboarding(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const row = await one(env, "SELECT * FROM users WHERE id = ?", user.id);
  const interests = parse(row.interests_json, []);
  const mine = JSON.stringify(interests);
  const bare = await isBare(env, row);
  const done = !!row.onboarding_done;

  const overlap = (col) => `(SELECT COUNT(*) FROM json_each(${col}) j WHERE j.value IN (SELECT value FROM json_each(?)))`;
  const communities = await all(env,
    `SELECT c.*, ${overlap("c.tags_json")} AS overlap FROM communities c
      WHERE c.visibility IN ('open', 'approval') AND c.parent_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM community_members cm WHERE cm.community_id = c.id AND cm.user_id = ?)
      ORDER BY overlap DESC, c.member_count DESC, c.name LIMIT 6`, mine, user.id);

  let people = [];
  if (interests.length) {
    const rows = await all(env,
      `SELECT u.*, ${overlap("u.interests_json")} AS overlap FROM users u
        WHERE u.match_opt_in = 1 AND u.id != ? AND u.suspended_until <= ? AND u.email NOT LIKE 'erased:%'
          AND ${NOT_BLOCKED("u.id")}
          AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.target_type = 'user' AND f.target_id = u.id)
          AND ${overlap("u.interests_json")} > 0
        ORDER BY overlap DESC, u.updated_at DESC LIMIT 8`,
      mine, user.id, now(), user.id, user.id, user.id, mine);
    people = rows.map((r) => {
      const shared = parse(r.interests_json, []).filter((t) => interests.includes(t));
      return { user: publicUser(env, r), reasons: [`Also interested in ${shared.slice(0, 4).map((t) => `#${t}`).join(", ")} (self-declared)`] };
    });
  }
  const joined = new Set((await all(env, "SELECT org_id FROM org_members WHERE user_id = ?", user.id)).map((r) => r.org_id));
  const orgs = (await orgsMatchingAddress(env, row)).filter((o) => !joined.has(o.id))
    .map((o) => ({ slug: o.slug, name: o.name, kind: o.kind, reason: "Your sign-in address belongs to this verified organisation." }));
  return {
    show: bare && !done,
    done,
    bare,
    suggestions: {
      communities: communities.map((c) => {
        const ctags = parse(c.tags_json, []);
        return {
          slug: c.slug, name: c.name, description: c.description, member_count: c.member_count, visibility: c.visibility, tags: ctags,
          reasons: c.overlap ? [`Matches your interests: ${ctags.filter((t) => interests.includes(t)).map((t) => `#${t}`).join(", ")}`] : [],
        };
      }),
      people,
      orgs,
    },
    note: "Suggestions explain themselves and are not a ranking of anybody's ability.",
  };
}

/** POST /v1/me/onboarding {done} -- finished or skipped (done: true), or show it again (done: false). */
async function setOnboarding(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const done = bool((await body(ctx)).done, true);
  await run(env, "UPDATE users SET onboarding_done = ? WHERE id = ?", done ? now() : 0, user.id);
  return { ok: true, done };
}

// ── Erasure and export (called from profiles.js) ───────────────────────────

/**
 * What DELETE /v1/me must also do for this module's tables. An org the
 * member alone administered keeps existing for its other members; a site
 * admin can appoint a new admin.
 */
export function identityErasureStatements(DB, userId) {
  const p = (sql, ...binds) => DB.prepare(sql).bind(...binds);
  return [
    p("DELETE FROM item_verifications WHERE user_id = ?", userId),
    p("DELETE FROM mentoring_requests WHERE mentee_id = ? OR mentor_id = ?", userId, userId),
    p(`UPDATE orgs SET member_count = (SELECT COUNT(*) FROM org_members m WHERE m.org_id = orgs.id AND m.user_id != ?)
        WHERE id IN (SELECT org_id FROM org_members WHERE user_id = ?)`, userId, userId),
    p("DELETE FROM org_members WHERE user_id = ?", userId),
    p(`UPDATE users SET aff_org_id = NULL, aff_slug = '', aff_name = '', aff_verified = 0,
         mentoring_open = 0, mentoring_topics_json = '[]', onboarding_done = 0 WHERE id = ?`, userId),
  ];
}

/** This module's rows for GET /v1/me/export. Other people appear by handle. */
export async function identityExport(env, userId) {
  return {
    org_memberships: await all(env,
      "SELECT o.slug, o.name, m.role, m.verified, m.created_at FROM org_members m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = ?", userId),
    orgs_proposed: await all(env, "SELECT slug, name, verified, created_at FROM orgs WHERE created_by = ?", userId),
    mentoring_requests: await all(env,
      `SELECT r.id, r.topic, r.message, r.status, r.created_at, r.responded_at,
              (SELECT handle FROM users WHERE id = r.mentor_id) AS mentor, (SELECT handle FROM users WHERE id = r.mentee_id) AS mentee
         FROM mentoring_requests r WHERE r.mentor_id = ? OR r.mentee_id = ?`, userId, userId),
    publication_checks: await all(env, "SELECT * FROM item_verifications WHERE user_id = ?", userId),
  };
}

export const routes = [
  ["GET", "/v1/orgs", listOrgs],
  ["POST", "/v1/orgs", createOrg],
  ["GET", "/v1/orgs/:slug", getOrg],
  ["PATCH", "/v1/orgs/:slug", patchOrg],
  ["DELETE", "/v1/orgs/:slug", removeOrg],
  ["POST", "/v1/orgs/:slug/verify", verifyOrg],
  ["POST", "/v1/orgs/:slug/join", joinOrg],
  ["POST", "/v1/orgs/:slug/leave", leaveOrg],
  ["GET", "/v1/orgs/:slug/members", listMembers],
  ["POST", "/v1/orgs/:slug/members/:handle", setMemberRole],
  ["DELETE", "/v1/orgs/:slug/members/:handle", removeMember],
  ["POST", "/v1/orgs/:slug/posts", postAsOrg],
  ["GET", "/v1/me/orgs", myOrgs],
  ["PATCH", "/v1/me/affiliation", setAffiliation],
  ["PATCH", "/v1/me/mentoring", setMentoring],
  ["GET", "/v1/mentoring/requests", listMentoring],
  ["POST", "/v1/mentoring/requests", requestMentoring],
  ["POST", "/v1/mentoring/requests/:id/respond", respondMentoring],
  ["POST", "/v1/mentoring/requests/:id/close", closeMentoring],
  ["GET", "/v1/me/onboarding", getOnboarding],
  ["POST", "/v1/me/onboarding", setOnboarding],
];
