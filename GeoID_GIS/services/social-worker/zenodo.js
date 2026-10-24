/**
 * Publish to Zenodo: a post's files, deposited in the member's OWN Zenodo
 * account, with a DOI. This is the other half of keeping R2 light: a paper,
 * dataset or poster lives at CERN for good, is citable, and the post links to
 * it -- which also makes the member's work findable outside the Network.
 *
 * The member connects Zenodo once (OAuth). Tokens are stored encrypted with
 * AES-GCM under ZENODO_TOKEN_KEY; nothing here can act on their account
 * except through the routes below, and only on their own posts.
 *
 * A DOI CANNOT BE WITHDRAWN. So the default is a DRAFT deposit, which the
 * member reviews on Zenodo and publishes there; `publish: true` does it from
 * here only when they asked in so many words (the composer confirms first).
 *
 * Setup (the owner, once): register an application at
 *   https://zenodo.org/account/settings/applications/  (sandbox.zenodo.org to test)
 * with redirect URI  <SELF_ORIGIN>/v1/zenodo/callback  and scopes
 * deposit:write deposit:actions, then set ZENODO_CLIENT_ID (var),
 * ZENODO_CLIENT_SECRET and ZENODO_TOKEN_KEY (secrets). Until then the routes
 * answer "not configured" and the button is not offered.
 */
import { fail, now, str, parse, id, sign, verify, requireUser, rateLimit, readJson } from "./lib.js";
import { one, run } from "./collab.js";

const base = (env) => String(env.ZENODO_BASE || "https://zenodo.org").replace(/\/$/, "");
const self = (env) => String(env.SELF_ORIGIN || "").replace(/\/$/, "");
const site = (env) => String(env.SITE_ORIGIN || "https://geoidinitiative.com").replace(/\/$/, "");
const fetchOf = (env) => env.fetchImpl || fetch;
const stateSecret = (env) => env.SOCIAL_JWT_SECRET || env.JWT_SECRET || "";
export const zenodoConfigured = (env) => !!(env.ZENODO_CLIENT_ID && env.ZENODO_CLIENT_SECRET && env.ZENODO_TOKEN_KEY);

// ── Token encryption ───────────────────────────────────────────────────────

const enc = new TextEncoder();
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function aesKey(env) {
  // ZENODO_TOKEN_KEY is any secret string; it is hashed to a 256-bit key.
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(String(env.ZENODO_TOKEN_KEY)));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function seal(env, text) {
  if (!text) return "";
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(env), enc.encode(text));
  return `${b64(iv)}.${b64(ct)}`;
}
export async function unseal(env, sealed) {
  if (!sealed) return "";
  const [iv, ct] = String(sealed).split(".");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(env), unb64(ct));
  return new TextDecoder().decode(pt);
}

// ── Mapping a post onto Zenodo's metadata (pure, tested) ───────────────────

const UPLOAD_TYPE = { paper: "publication", dataset: "dataset", poster: "poster", repo: "software", analysis: "other", workflow: "software", model: "software" };
const LICENCES = { "CC-BY-4.0": "cc-by-4.0", "CC-BY-SA-4.0": "cc-by-sa-4.0", "CC0-1.0": "cc0-1.0", "CC-BY-NC-4.0": "cc-by-nc-4.0", "MIT": "mit", "Apache-2.0": "apache-2.0" };

/** Zenodo deposition metadata for a post and its author. */
export function depositMetadata(env, post, author, overrides = {}) {
  const type = overrides.upload_type || UPLOAD_TYPE[post.kind] || "other";
  // Zenodo wants "Family, Given"; the last word is taken as the family name.
  const words = String(author.name || "").trim().split(/\s+/).filter(Boolean);
  const creator = { name: words.length > 1 ? `${words[words.length - 1]}, ${words.slice(0, -1).join(" ")}` : (words[0] || `@${author.handle}`) };
  if (author.orcid && author.orcid_verified) creator.orcid = author.orcid;
  if (author.institution) creator.affiliation = str(author.institution, 200);
  const meta = {
    title: str(overrides.title || post.title || String(post.body || "").slice(0, 120) || "Untitled", 250),
    upload_type: type,
    description: String(overrides.description || post.body || post.title || "Shared on the GeoID Network.").slice(0, 10000)
      .replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]).replace(/\n/g, "<br>"),
    creators: [creator],
    keywords: parse(post.tags_json, []).slice(0, 20).map((t) => str(t, 60)),
    license: LICENCES[post.licence] || "cc-by-4.0",
    access_right: "open",
    related_identifiers: [{ identifier: `${self(env)}/s/p/${encodeURIComponent(post.id)}`, relation: "isDocumentedBy", resource_type: "other" }],
  };
  if (type === "publication") meta.publication_type = overrides.publication_type || "preprint";
  if (type === "image") meta.image_type = "figure";
  return meta;
}

// ── Tokens for a member ────────────────────────────────────────────────────

async function tokenFor(env, userId, t = now()) {
  const row = await one(env, "SELECT * FROM zenodo_links WHERE user_id = ?", userId);
  if (!row) return null;
  if (row.expires_at && row.expires_at - 60 > t) return unseal(env, row.token_enc);
  if (!row.expires_at) return unseal(env, row.token_enc);
  // Expired: refresh once.
  const refresh = await unseal(env, row.refresh_enc);
  if (!refresh) return null;
  const tok = await exchange(env, { grant_type: "refresh_token", refresh_token: refresh });
  await store(env, userId, tok, t);
  return tok.access_token;
}

async function exchange(env, form) {
  const r = await fetchOf(env)(`${base(env)}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...form, client_id: env.ZENODO_CLIENT_ID, client_secret: env.ZENODO_CLIENT_SECRET,
      redirect_uri: `${self(env)}/v1/zenodo/callback` }).toString(),
  });
  if (!r.ok) fail(502, `Zenodo refused the sign-in (${r.status}).`);
  return r.json();
}

async function store(env, userId, tok, t = now()) {
  await run(env,
    `INSERT INTO zenodo_links (user_id, token_enc, refresh_enc, expires_at, scope, connected_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET token_enc = excluded.token_enc, refresh_enc = excluded.refresh_enc,
       expires_at = excluded.expires_at, scope = excluded.scope`,
    userId, await seal(env, tok.access_token), await seal(env, tok.refresh_token || ""),
    tok.expires_in ? t + Number(tok.expires_in) : 0, str(tok.scope, 200), t);
}

// ── Routes ─────────────────────────────────────────────────────────────────

async function status(ctx) {
  const user = await requireUser(ctx);
  const env = ctx.env;
  const row = zenodoConfigured(env) ? await one(env, "SELECT connected_at FROM zenodo_links WHERE user_id = ?", user.id) : null;
  return { configured: zenodoConfigured(env), connected: !!row, sandbox: /sandbox/.test(base(env)) };
}

async function connect(ctx) {
  const user = await requireUser(ctx);
  const env = ctx.env;
  if (!zenodoConfigured(env)) fail(503, "Publishing to Zenodo isn't set up on this server yet.");
  const state = await sign({ sub: user.id, aud: "zenodo", exp: now() + 600, n: id("z") }, stateSecret(env));
  const q = new URLSearchParams({
    client_id: env.ZENODO_CLIENT_ID, response_type: "code", scope: "deposit:write deposit:actions",
    redirect_uri: `${self(env)}/v1/zenodo/callback`, state,
  });
  return { authorize_url: `${base(env)}/oauth/authorize?${q}` };
}

/** The browser comes back here from Zenodo -- no bearer token, the signed state says who. */
async function callback(ctx) {
  const env = ctx.env;
  const back = (q) => Response.redirect(`${site(env)}/social/#/settings?zenodo=${q}`, 302);
  if (!zenodoConfigured(env)) return back("unavailable");
  const claims = await verify(ctx.url.searchParams.get("state"), stateSecret(env), { audience: "zenodo" });
  const code = ctx.url.searchParams.get("code");
  if (!claims || !code) return back("refused");
  try {
    const tok = await exchange(env, { grant_type: "authorization_code", code });
    await store(env, claims.sub, tok);
  } catch (error) {
    return back("failed");
  }
  return back("connected");
}

async function disconnect(ctx) {
  const user = await requireUser(ctx);
  await run(ctx.env, "DELETE FROM zenodo_links WHERE user_id = ?", user.id);
  return { ok: true };
}

/**
 * POST /v1/posts/:id/zenodo {upload_type?, publication_type?, publish?: bool}
 * Deposit the post's uploaded files (and metadata) in the author's Zenodo.
 */
async function deposit(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  if (!zenodoConfigured(env)) fail(503, "Publishing to Zenodo isn't set up on this server yet.");
  const post = await one(env, "SELECT * FROM posts WHERE id = ? AND removed_at IS NULL", ctx.params.id);
  if (!post || post.author_id !== user.id) fail(404, "Not found.");
  const files = parse(post.media_json, []);
  if (!files.length) fail(400, "Zenodo needs at least one file. Attach the paper, dataset or poster to the post first.");
  const token = await tokenFor(env, user.id);
  if (!token) fail(409, "Connect your Zenodo account in Settings first.");
  const body = await readJson(ctx.request).catch(() => ({}));
  const auth = { Authorization: `Bearer ${token}` };
  const api = (path, init = {}) => fetchOf(env)(`${base(env)}/api${path}`, { ...init, headers: { ...auth, ...(init.headers || {}) } });

  const created = await api("/deposit/depositions", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  if (!created.ok) fail(502, `Zenodo didn't create the record (${created.status}).`);
  const dep = await created.json();
  for (const f of files) {
    const row = await one(env, "SELECT * FROM media WHERE key = ? AND owner_id = ?", f.key, user.id);
    if (!row) continue;
    const obj = await env.MEDIA.get(row.key);
    if (!obj) continue;
    const name = encodeURIComponent((row.name || row.key.split("/").pop()).replace(/[^\w .-]+/g, "_").slice(0, 120) || "file");
    const put = await fetchOf(env)(`${dep.links.bucket}/${name}`, { method: "PUT", headers: { ...auth, "content-type": "application/octet-stream" }, body: obj.body });
    if (!put.ok) fail(502, `Zenodo didn't take the file ${decodeURIComponent(name)} (${put.status}).`);
  }
  const author = await one(env, "SELECT * FROM users WHERE id = ?", user.id);
  const meta = depositMetadata(env, post, author, body || {});
  const put = await api(`/deposit/depositions/${dep.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ metadata: meta }) });
  if (!put.ok) fail(502, `Zenodo didn't accept the description (${put.status}).`);
  let record = await put.json();
  let state = "draft";
  if (body && body.publish === true) {
    const pub = await api(`/deposit/depositions/${dep.id}/actions/publish`, { method: "POST" });
    if (!pub.ok) fail(502, `Zenodo didn't publish it (${pub.status}). The draft is in your Zenodo account.`);
    record = await pub.json();
    state = "published";
  }
  const doi = str(record.doi || record.metadata?.prereserve_doi?.doi || "", 120);
  const url = str(record.links?.html || record.links?.latest_html || "", 300);
  const t = now();
  await run(env,
    `INSERT INTO zenodo_deposits (id, post_id, user_id, status, doi, url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, doi = excluded.doi, url = excluded.url, updated_at = excluded.updated_at`,
    String(dep.id), post.id, user.id, state, doi, url, t, t);
  // A published DOI is the post's own source from now on.
  if (state === "published" && doi) {
    const sources = parse(post.sources_json, []);
    if (!sources.some((s) => s.doi === doi)) sources.push({ label: "Zenodo", url, doi, licence: post.licence || "" });
    await run(env, "UPDATE posts SET sources_json = ?, updated_at = ? WHERE id = ?", JSON.stringify(sources), t, post.id);
  }
  return { id: String(dep.id), status: state, doi, url, reserved_doi: state === "draft" ? doi : "" };
}

export const routes = [
  ["GET", "/v1/zenodo", status],
  ["POST", "/v1/zenodo/connect", connect],
  ["GET", "/v1/zenodo/callback", callback],
  ["DELETE", "/v1/zenodo", disconnect],
  ["POST", "/v1/posts/:id/zenodo", deposit],
];
