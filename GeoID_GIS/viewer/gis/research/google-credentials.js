/**
 * Google credentials for the hub.
 *
 * **Only the OAuth Client ID is ever stored here, and only the Client ID is
 * ever needed.** Google's browser token flow is built for public clients: the
 * Client ID identifies the app, the redirect-origin allowlist in the Google
 * console is what actually protects it, and no secret is involved. The *client
 * secret* belongs to server-side flows; anything shipped to a browser is
 * readable by whoever loads the page, so putting one in this static site would
 * publish it. `rejectSecret()` below exists so the UI can say that plainly
 * rather than quietly accepting a field it must not keep.
 *
 * Stored per browser (localStorage), not in the project folder. A project is
 * meant to be moved, shared and opened by the desktop app; credentials are the
 * person, not the study, and should not travel with it.
 */

const KEY = "geoid-gis:google-credentials";

const EMPTY = { clientId: "", apiKey: "", updatedAt: "" };

/** Shapes that are a client *secret* rather than a client ID. */
const SECRET_SHAPES = [
  /^GOCSPX-/i,               // current Google client-secret prefix
  /^[A-Za-z0-9_-]{24}$/,     // legacy 24-char secrets
];

/** A Client ID always ends in .apps.googleusercontent.com. */
export function looksLikeClientId(value) {
  return /\.apps\.googleusercontent\.com$/.test(String(value || "").trim());
}

export function looksLikeSecret(value) {
  const text = String(value || "").trim();
  if (!text || looksLikeClientId(text)) return false;
  return SECRET_SHAPES.some((re) => re.test(text));
}

export function load() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) || "null");
    if (!saved || typeof saved !== "object") return { ...EMPTY };
    return { ...EMPTY, ...saved };
  } catch (error) {
    return { ...EMPTY };
  }
}

/**
 * Save the Client ID (and optional API key). Throws on anything that looks like
 * a secret — a refusal, not a warning, because the whole point is that it never
 * reaches storage.
 */
export function save({ clientId = "", apiKey = "" }) {
  const id = String(clientId).trim();
  const key = String(apiKey).trim();
  if (looksLikeSecret(id) || looksLikeSecret(key)) {
    throw new Error(
      "That looks like an OAuth client *secret*. Secrets must never be stored "
      + "in a page served to a browser — anyone loading the site could read it. "
      + "The browser flow needs only the Client ID, which ends in "
      + ".apps.googleusercontent.com.");
  }
  if (id && !looksLikeClientId(id)) {
    throw new Error("A Client ID ends in .apps.googleusercontent.com.");
  }
  const next = { clientId: id, apiKey: key, updatedAt: new Date().toISOString() };
  window.localStorage.setItem(KEY, JSON.stringify(next));
  announce(next);
  return next;
}

export function clear() {
  window.localStorage.removeItem(KEY);
  announce({ ...EMPTY });
}

export function isConfigured() {
  return Boolean(load().clientId);
}

const listeners = [];
export function onChange(fn) {
  listeners.push(fn);
  return () => {
    const at = listeners.indexOf(fn);
    if (at >= 0) listeners.splice(at, 1);
  };
}
function announce(state) {
  listeners.forEach((fn) => { try { fn(state); } catch (error) { /* listener's problem */ } });
}

// ── Embedding ────────────────────────────────────────────────────────────────

/**
 * The frame URL for a Google document.
 *
 * Verified against a real public Sheet rather than assumed: `docs.google.com`
 * sends **no `X-Frame-Options`** and no `frame-ancestors` in its CSP, and both
 * `/edit` and `/preview` render inside a cross-origin iframe. `/edit` brings
 * the whole editor, and edits when the browser is signed in to Google;
 * `/preview` is read-only and lighter.
 *
 * (An earlier version of this hub claimed Google refused to be framed at all.
 * It does not, and the nested window is on that evidence.)
 */
export function frameUrl(url, { mode = "edit" } = {}) {
  const text = String(url || "").trim();
  if (!text) return "";
  // Drive files that are not native Docs get Drive's own preview endpoint.
  const drive = text.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (drive) return `https://drive.google.com/file/d/${drive[1]}/preview`;
  // Anything already published-to-web embeds as it is.
  if (/\/pub(html)?\b/.test(text)) {
    return text.includes("embedded=") || text.includes("widget=")
      ? text
      : `${text}${text.includes("?") ? "&" : "?"}embedded=true`;
  }
  const native = text.match(
    /docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([^/]+)/);
  if (!native) return text;
  const [, kind, id] = native;
  if (mode === "preview") return `https://docs.google.com/${kind}/d/${id}/preview`;
  return `https://docs.google.com/${kind}/d/${id}/edit?rm=minimal`;
}
