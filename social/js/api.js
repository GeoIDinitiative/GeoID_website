/**
 * The one door to the GeoID Network API (CONTRACT.md in
 * GeoID_GIS/services/social-worker).
 *
 * WHO IS ASKING. The site session is an httpOnly cookie on the auth Worker's
 * origin and never reaches the social origin, so this asks the auth Worker for
 * a one-hour `aud: "social"` token and sends it as a Bearer. The token is held
 * in memory only -- not storage -- and refreshed a minute before it expires.
 *
 * LOCAL DEVELOPMENT, and only on a localhost page:
 *   localStorage['geoid:social-base']     = 'http://localhost:8790'  (a wrangler dev)
 *   localStorage['geoid:social-dev-user'] = 'someone@example.com'    (X-Dev-User, no token)
 *   localStorage['geoid:social-mock']     = '1'                      (in-page mock, dev-mock.js)
 */
import * as membership from "/GeoID_GIS/viewer/gis/membership.js";

const LOCAL = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(location.hostname);

function ls(key) {
  try { return localStorage.getItem(key) || ""; } catch (error) { return ""; }
}

export function base() {
  if (LOCAL) {
    const override = ls("geoid:social-base");
    if (override) return override.replace(/\/$/, "");
  }
  const meta = document.querySelector('meta[name="geoid-social"]');
  return String(meta?.content || "").replace(/\/$/, "");
}

export const devUser = () => (LOCAL ? ls("geoid:social-dev-user") : "");
export const mockOn = () => LOCAL && ls("geoid:social-mock") === "1";

export class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

// ── The token ──────────────────────────────────────────────────────────────

let token = "";
let tokenExp = 0;
let pending = null;

/** True when there is any way of being signed in here. */
export function maybeSignedIn() {
  if (mockOn()) return ls("geoid:social-mock-anon") !== "1";
  if (devUser()) return true;
  try { return !!membership.state().signedIn; } catch (error) { return false; }
}

async function getToken(force = false) {
  const nowS = Date.now() / 1000;
  if (!force && token && tokenExp - 60 > nowS) return token;
  if (!maybeSignedIn()) return "";
  const auth = membership.authService();
  if (!auth) return "";
  if (pending) return pending;
  pending = (async () => {
    try {
      const res = await fetch(`${auth}/auth/social-token`, { method: "POST", credentials: "include" });
      if (!res.ok) { token = ""; tokenExp = 0; return ""; }
      const data = await res.json();
      token = String(data.token || "");
      tokenExp = Number(data.expires) || nowS + 3000;
      return token;
    } catch (error) {
      token = ""; tokenExp = 0;
      return "";
    } finally {
      pending = null;
    }
  })();
  return pending;
}

export function forgetToken() { token = ""; tokenExp = 0; }
try { membership.onChange(() => forgetToken()); } catch (error) { /* fine */ }

// ── Requests ───────────────────────────────────────────────────────────────

function qs(query) {
  if (!query) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v == null || v === "" || v === false) continue;
    p.set(k, v === true ? "1" : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

let mock = null;
async function viaMock(method, path, query, body) {
  if (!mock) mock = await import("./dev-mock.js?v=20261023-3c2cf02");
  const { status, data } = await mock.handle(method, path, query || {}, body);
  if (status >= 400) throw new ApiError(status, (data && data.error) || `HTTP ${status}`, data);
  return data;
}

/**
 * request("GET", "/v1/feed", { query, body, form, raw })
 * Resolves with the parsed JSON; rejects with ApiError (status 0 = network).
 */
export async function request(method, path, { query, body, form, raw = false } = {}) {
  if (mockOn()) {
    const data = await viaMock(method, path, query, form ? Object.fromEntries(form.entries()) : body);
    return data;
  }
  const root = base();
  if (!root) throw new ApiError(0, "GeoID Network is not configured on this page.");
  const send = async (retry) => {
    const headers = {};
    const dev = devUser();
    if (dev) headers["X-Dev-User"] = dev;
    else {
      const t = await getToken(retry);
      if (t) headers.Authorization = `Bearer ${t}`;
    }
    let payload;
    if (form) payload = form;
    else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(`${root}${path}${qs(query)}`, { method, headers, body: payload });
    } catch (error) {
      throw new ApiError(0, "Could not reach GeoID Network. Check your connection and try again.");
    }
    // A 401 with a token in hand may be a token that just lapsed: one retry
    // with a fresh one, then believe it.
    if (res.status === 401 && !retry && !dev && token) {
      forgetToken();
      return send(true);
    }
    if (raw && res.ok) return res;
    let data = null;
    const type = res.headers.get("content-type") || "";
    if (type.includes("json")) { try { data = await res.json(); } catch (error) { data = null; } }
    if (!res.ok) {
      throw new ApiError(res.status, (data && data.error) || `The server answered ${res.status}.`, data);
    }
    return data;
  };
  return send(false);
}

export const get = (path, query) => request("GET", path, { query });
export const post = (path, body) => request("POST", path, { body: body || {} });
export const patch = (path, body) => request("PATCH", path, { body: body || {} });
export const del = (path, body) => request("DELETE", path, body ? { body } : {});

/** Upload an image or PDF -> {key, url, type, bytes}. */
export function upload(file, { scope = "", alt = "" } = {}) {
  const form = new FormData();
  form.append("file", file);
  if (scope) form.append("scope", scope);
  if (alt) form.append("alt", alt);
  if (mockOn()) return viaMock("POST", "/v1/media", {}, { file, scope, alt });
  return request("POST", "/v1/media", { form });
}

/**
 * Fetch a protected media file (a review draft, a team file) WITH the
 * Bearer, as a blob URL -- a plain <a href> to the API would arrive without
 * credentials and be refused.
 */
export async function mediaBlobUrl(url) {
  if (mockOn()) return url;
  const root = base();
  const path = String(url).startsWith(root) ? String(url).slice(root.length) : null;
  if (!path) return url;
  const res = await request("GET", path, { raw: true });
  return URL.createObjectURL(await res.blob());
}

/** Turn a media key into the URL the API serves it at. */
export function mediaUrl(key) {
  if (!key) return "";
  if (mockOn()) return mock?.mediaUrl?.(key) || "";
  return `${base()}/v1/media/${encodeURIComponent(key)}`;
}

export function signInUrl() {
  return membership.signInUrl(location.href);
}
export function authConfigured() {
  return !!membership.authService() || !!devUser() || mockOn();
}
