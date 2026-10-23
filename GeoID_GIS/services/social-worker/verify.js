/**
 * Checks against outside records: a portfolio publication against Crossref,
 * and a member's ORCID iD through ORCID's own sign-in.
 *
 * "VERIFIED" MEANS SOMETHING WAS CHECKED. A profile item is marked verified
 * only when its DOI resolves at Crossref AND the member's name matches one of
 * the record's authors (family name + first initial, accents ignored). What
 * was compared is stored in item_verifications and shown beside the item, so
 * a reader can see the evidence rather than take the tick on trust. A check
 * that could not run (Crossref down) changes nothing.
 *
 * ORCID is gated entirely on ORCID_CLIENT_ID / ORCID_CLIENT_SECRET: without
 * them every ORCID route answers 503 and the page explains instead of
 * offering a button that cannot work.
 */
import {
  fail, now, id, str, parse, requireUser, sign, verify as verifyToken, audit, rateLimit,
} from "./lib.js";
import { all, one, run, param } from "./collab.js";

const CROSSREF = "https://api.crossref.org/works/";
const RECHECK_SECONDS = 30;
const ORCID_RE = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

// ── Names ──────────────────────────────────────────────────────────────────

// Letters NFKD does not take apart: "Ø" is not "O" plus a mark.
const FOLD = { ø: "o", ł: "l", đ: "d", ð: "d", þ: "th", æ: "ae", œ: "oe", ß: "ss", ı: "i" };

/** Lower-case, accents removed, apostrophes dropped, hyphens and dots as spaces -> tokens. */
export function nameTokens(text) {
  return String(text || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[øłđðþæœßı]/g, (c) => FOLD[c])
    .replace(/['’`]/g, "").replace(/[^a-z]+/g, " ").trim().split(" ").filter(Boolean);
}

/** A member's name as [given..., family...] tokens; "Family, Given" is turned round. */
function memberTokens(name) {
  const text = String(name || "");
  if (text.includes(",")) {
    const [family, given] = text.split(",", 2);
    return [...nameTokens(given), ...nameTokens(family)];
  }
  return nameTokens(text);
}

/**
 * Does the member's name match a Crossref author? The author's family name
 * must be the last word(s) of the member's name, and the first letters of
 * the given names must agree. "José Núñez-García" matches
 * {given: "J.", family: "Nunez Garcia"}; "Ana Smith" does not match
 * {given: "B.", family: "Smith"}.
 */
export function authorMatches(memberName, author) {
  const m = memberTokens(memberName);
  const family = nameTokens(author?.family);
  const given = nameTokens(author?.given);
  if (!family.length || !given.length || m.length <= family.length) return false;
  const tail = m.slice(m.length - family.length);
  if (tail.join(" ") !== family.join(" ")) return false;
  return m[0][0] === given[0][0];
}

/** "https://doi.org/10.1000/XYZ" or "doi:10.1000/xyz" -> "10.1000/xyz", or "". DOIs ignore case. */
export function normalDoi(raw) {
  const text = String(raw || "").trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "").toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(text) ? text.slice(0, 200) : "";
}

const authorName = (a) => [str(a?.given, 80), str(a?.family, 80)].filter(Boolean).join(" ") || str(a?.name, 120);

// ── Evidence ───────────────────────────────────────────────────────────────

function evidenceShape(row) {
  if (!row) return null;
  return {
    source: row.source,
    doi: row.doi,
    checked_at: row.checked_at,
    outcome: row.outcome,
    resolved: !!row.resolved,
    matched: !!row.matched,
    matched_author: row.matched_author,
    name_checked: row.name_checked,
    title: row.work_title,
    journal: row.container,
    year: row.year,
    authors: parse(row.authors_json, []),
  };
}

/** The newest check of each item, for profiles.js: { item_id: evidence }. One query. */
export async function verificationsForItems(env, ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return {};
  const rows = await all(env,
    `SELECT v.* FROM item_verifications v
      WHERE v.item_id IN (${unique.map(() => "?").join(",")})
        AND v.checked_at = (SELECT MAX(w.checked_at) FROM item_verifications w WHERE w.item_id = v.item_id)
      ORDER BY v.checked_at DESC`, ...unique);
  const out = {};
  for (const r of rows) if (!out[r.item_id]) out[r.item_id] = evidenceShape(r);
  return out;
}

/** Ask Crossref. { status: "ok", work } | { status: "not-found" } | { status: "error" }. */
async function crossref(env, doi) {
  const contact = str(env.CROSSREF_MAILTO, 200);
  const headers = {
    Accept: "application/json",
    // Crossref asks API users to say who they are; a mailto puts the calls in its "polite" pool.
    "User-Agent": `GeoHUB-Social/1.0 (${env.SITE_ORIGIN || "https://geoidinitiative.com"}${contact ? `; mailto:${contact}` : ""})`,
  };
  let res;
  try {
    const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined;
    res = await fetch(`${CROSSREF}${doi.split("/").map(encodeURIComponent).join("/")}`, { headers, signal });
  } catch (error) {
    return { status: "error" };
  }
  if (res.status === 404) return { status: "not-found" };
  if (!res.ok) return { status: "error" };
  try {
    const data = await res.json();
    return data && data.message ? { status: "ok", work: data.message } : { status: "error" };
  } catch (error) {
    return { status: "error" };
  }
}

/** POST /v1/me/items/:id/verify -- check a DOI item against Crossref. */
async function verifyItem(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const item = await one(env, "SELECT * FROM profile_items WHERE id = ?", ctx.params.id);
  if (!item || item.user_id !== user.id) fail(404, "No such entry.");
  const doi = normalDoi(item.doi);
  if (!doi) fail(400, "Only an entry with a DOI (like 10.1029/2020GL089000) can be checked.");
  const last = await one(env, "SELECT checked_at FROM item_verifications WHERE item_id = ? ORDER BY checked_at DESC LIMIT 1", item.id);
  if (last && now() - last.checked_at < RECHECK_SECONDS) fail(429, "That was checked moments ago. Try again in a minute.");

  const found = await crossref(env, doi);
  const fresh = await one(env, "SELECT name FROM users WHERE id = ?", user.id);
  const row = {
    id: id("iv"), item_id: item.id, user_id: user.id, source: "crossref", doi, name_checked: str(fresh.name, 120),
    resolved: 0, matched: 0, matched_author: "", work_title: "", container: "", year: null, authors_json: "[]",
    outcome: found.status === "error" ? "error" : "not-found", checked_at: now(),
  };
  if (found.status === "ok") {
    const w = found.work;
    const authors = Array.isArray(w.author) ? w.author : [];
    const hit = authors.find((a) => authorMatches(row.name_checked, a));
    const parts = w.issued?.["date-parts"]?.[0] || w.published?.["date-parts"]?.[0] || [];
    Object.assign(row, {
      resolved: 1,
      matched: hit ? 1 : 0,
      matched_author: hit ? [str(hit.family, 80), str(hit.given, 80)].filter(Boolean).join(", ") : "",
      work_title: str(Array.isArray(w.title) ? w.title[0] : w.title, 500),
      container: str(Array.isArray(w["container-title"]) ? w["container-title"][0] : w["container-title"], 300),
      year: Number.isFinite(Number(parts[0])) ? Number(parts[0]) : null,
      authors_json: JSON.stringify(authors.slice(0, 20).map(authorName).filter(Boolean)),
      outcome: hit ? "verified" : "name-mismatch",
    });
  }
  const statements = [env.DB.prepare(
    `INSERT INTO item_verifications (id, item_id, user_id, source, doi, name_checked, resolved, matched, matched_author,
       work_title, container, year, authors_json, outcome, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(row.id, row.item_id, row.user_id, row.source, row.doi, row.name_checked, row.resolved, row.matched, row.matched_author,
    row.work_title, row.container, row.year, row.authors_json, row.outcome, row.checked_at)];
  // An answer from Crossref decides the tick either way; no answer leaves it as it was.
  if (row.outcome !== "error") {
    statements.push(env.DB.prepare("UPDATE profile_items SET verified = ? WHERE id = ?").bind(row.matched, item.id));
  }
  await env.DB.batch(statements);
  const saved = await one(env, "SELECT * FROM profile_items WHERE id = ?", item.id);
  const message = {
    verified: "Verified: the DOI resolves and your name is on the author list.",
    "name-mismatch": "The DOI resolves, but no author on the record matches your name (family name and first initial).",
    "not-found": "Crossref has no record of that DOI.",
    error: "Crossref did not answer. Nothing was changed; try again later.",
  }[row.outcome];
  return {
    item: {
      id: saved.id, kind: saved.kind, title: saved.title, detail: saved.detail, url: saved.url, doi: saved.doi,
      year: saved.year, verified: !!saved.verified, visibility: saved.visibility,
    },
    verification: evidenceShape(row),
    message,
  };
}

/** GET /v1/me/items/:id/verifications -- every check of one of the caller's items, newest first. */
async function itemHistory(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const item = await one(env, "SELECT * FROM profile_items WHERE id = ?", ctx.params.id);
  if (!item || item.user_id !== user.id) fail(404, "No such entry.");
  const rows = await all(env, "SELECT * FROM item_verifications WHERE item_id = ? ORDER BY checked_at DESC LIMIT 20", item.id);
  return { items: rows.map(evidenceShape), next: null };
}

// ── ORCID ──────────────────────────────────────────────────────────────────

function orcidConfig(env) {
  if (!env.ORCID_CLIENT_ID || !env.ORCID_CLIENT_SECRET) fail(503, "ORCID linking is not set up yet.");
  const secret = env.SOCIAL_JWT_SECRET || env.JWT_SECRET;
  if (!secret) fail(503, "ORCID linking is not set up yet.");
  return {
    clientId: env.ORCID_CLIENT_ID,
    clientSecret: env.ORCID_CLIENT_SECRET,
    // https://sandbox.orcid.org while testing against ORCID's sandbox.
    base: String(env.ORCID_BASE || "https://orcid.org").replace(/\/$/, ""),
    redirectUri: `${String(env.SELF_ORIGIN || "").replace(/\/$/, "")}/v1/orcid/callback`,
    secret,
  };
}

/** GET /v1/orcid/status -- can the page offer "Verify with ORCID"? */
async function orcidStatus(ctx) {
  const { env } = ctx;
  return { enabled: !!(env.ORCID_CLIENT_ID && env.ORCID_CLIENT_SECRET && (env.SOCIAL_JWT_SECRET || env.JWT_SECRET)) };
}

/**
 * GET /v1/orcid/start -> { url }. The page navigates there itself: this API
 * is Bearer-only, and a navigation cannot carry the Bearer, so the signed-in
 * check happens here and the user it was for travels in a signed, 10-minute
 * `state` that the callback checks.
 */
async function orcidStart(ctx) {
  const { env } = ctx;
  const cfg = orcidConfig(env);
  const user = await requireUser(ctx);
  const nonce = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const state = await sign({ sub: user.id, aud: "orcid-state", exp: now() + 600, n: nonce }, cfg.secret);
  const q = new URLSearchParams({
    client_id: cfg.clientId, response_type: "code", scope: "/authenticate", redirect_uri: cfg.redirectUri, state,
  });
  return { url: `${cfg.base}/oauth/authorize?${q.toString()}` };
}

/** GET /v1/orcid/callback?code&state -- ORCID sends the browser here; we send it back to Settings. */
async function orcidCallback(ctx) {
  const { env } = ctx;
  const cfg = orcidConfig(env);
  const back = (result) => Response.redirect(
    `${String(env.SITE_ORIGIN || "").replace(/\/$/, "")}/social/#/settings?orcid=${encodeURIComponent(result)}`, 302);
  if (param(ctx, "error")) return back("cancelled");
  const claims = await verifyToken(param(ctx, "state"), cfg.secret, { audience: "orcid-state" });
  const code = str(param(ctx, "code"), 200);
  if (!claims || !claims.sub || !code) return back("expired");
  const user = await one(env, "SELECT * FROM users WHERE id = ?", claims.sub);
  if (!user || String(user.email).startsWith("erased:")) return back("expired");

  let token = null;
  try {
    const res = await fetch(`${cfg.base}/oauth/token`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: "authorization_code",
        code, redirect_uri: cfg.redirectUri,
      }).toString(),
    });
    if (res.ok) token = await res.json();
  } catch (error) {
    token = null;
  }
  const orcid = str(token?.orcid, 19).toUpperCase();
  if (!ORCID_RE.test(orcid)) return back("failed");
  // One person per iD: a second account cannot borrow somebody's verified ORCID.
  const other = await one(env, "SELECT id FROM users WHERE orcid = ? AND orcid_verified = 1 AND id != ?", orcid, user.id);
  if (other) return back("taken");
  await run(env, "UPDATE users SET orcid = ?, orcid_verified = 1, updated_at = ? WHERE id = ?", orcid, now(), user.id);
  await audit(env, user.id, "orcid_verified", "user", user.id, { orcid });
  return back("linked");
}

export const routes = [
  ["POST", "/v1/me/items/:id/verify", verifyItem],
  ["GET", "/v1/me/items/:id/verifications", itemHistory],
  ["GET", "/v1/orcid/status", orcidStatus],
  ["GET", "/v1/orcid/start", orcidStart],
  ["GET", "/v1/orcid/callback", orcidCallback],
];
