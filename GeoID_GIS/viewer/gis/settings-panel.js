/**
 * Settings: Earth Engine, natively, with no second process.
 *
 * A service-account key cannot live in a page — but Earth Engine does not
 * require one. Its REST API accepts an OAuth bearer token, and the browser
 * flow that produces one uses a **Client ID**, which is public by design: it
 * is safe in a page precisely because the redirect-origin allowlist in the
 * Google console, not secrecy, is what protects it. That is the same rule
 * `google-credentials.js` already enforces for the Docs workspace — it stores
 * a Client ID and THROWS on anything shaped like a secret.
 *
 * So this panel holds two public values in localStorage (per browser, because
 * a credential is the person rather than the study) and nothing else. The
 * token itself is obtained by signing in, lives in memory, and expires.
 */

const STORE_KEY = "geoid:earth-engine";

const FIELDS = [
  {
    name: "clientId",
    label: "Google OAuth Client ID",
    hint: "From the Google Cloud console, type \"Web application\". Public by "
      + "design — it is the redirect-origin allowlist that protects it, not secrecy. "
      + "A client SECRET is refused.",
  },
  {
    name: "project",
    label: "Earth Engine project",
    hint: "The Cloud project Earth Engine is enabled on, e.g. geoid-504623.",
  },
];

/** A client secret in a page is a published secret; refuse it by shape. */
export function looksSecret(value) {
  const v = String(value || "").trim();
  return v.startsWith("GOCSPX-") || (/^[A-Za-z0-9_-]{24}$/.test(v) && !v.endsWith(".apps.googleusercontent.com"));
}

// The project this deployment uses. A project id is not a credential — it
// appears in every request URL — so it ships as the default and saves a step.
// The Client ID is NOT here and cannot be: it is per-deployment, it lives in
// the Google console beside the redirect-origin allowlist that protects it,
// and inventing one would produce a sign-in that fails with a confusing error
// rather than an honest empty field.
// Both ship: a Client ID travels in the sign-in URL of every request that
// uses it, and a project id is in every REST path. Neither is a secret —
// what protects this pair is the Authorised JavaScript origins list in the
// Google console, which is why the app checks the page's origin first.
const DEFAULTS = {
  clientId: "473900633008-n15n9va0orhq6v0f5g83bjbeq6r6jhh9.apps.googleusercontent.com",
  project: "geoid-504623",
};

export function read() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORE_KEY) || "null") || {};
    // The temporary-token field is gone, but a token saved while it existed
    // would sit in this browser for ever with no UI left to clear it -- and it
    // used to take precedence over sign-in, so it would silently shadow OAuth
    // and expire an hour later looking like a new bug. Drop it on read.
    if (stored.accessToken) {
      delete stored.accessToken;
      window.localStorage.setItem(STORE_KEY, JSON.stringify(stored));
    }
    return { ...DEFAULTS, ...stored };
  } catch (error) {
    return { ...DEFAULTS };
  }
}

export function write(next) {
  if (looksSecret(next.clientId)) {
    throw new Error("that looks like a client SECRET — a secret in a page is a published secret");
  }
  window.localStorage.setItem(STORE_KEY, JSON.stringify({ ...read(), ...next }));
  return read();
}

function byId(id) { return document.getElementById(id); }

function say(text) {
  const node = byId("gis-settings-status");
  if (node) node.textContent = text;
}

function refresh() {
  const host = byId("gis-settings-keys");
  if (!host) return;
  const current = read();
  host.innerHTML = "";
  FIELDS.forEach((field) => {
    const row = document.createElement("div");
    row.className = "gis-setting-row";
    const label = document.createElement("label");
    label.textContent = field.label;
    label.setAttribute("for", `gis-setting-${field.name}`);
    const input = document.createElement("input");
    input.id = `gis-setting-${field.name}`;
    input.className = "input";
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.value = current[field.name] || "";
    input.placeholder = field.name === "clientId"
      ? "…apps.googleusercontent.com" : "project id";
    const note = document.createElement("span");
    note.className = "gis-setting-hint";
    note.textContent = field.hint;
    row.append(label, input, note);
    host.appendChild(row);
  });

  const actions = document.createElement("div");
  actions.className = "gis-btn-row";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "button primary";
  save.textContent = "Save";
  save.addEventListener("click", () => {
    try {
      const next = write({
        clientId: byId("gis-setting-clientId").value.trim(),
        project: byId("gis-setting-project").value.trim(),
      });
      say(next.clientId && next.project
        ? "Saved. Earth Engine will ask you to sign in when a layer needs it — "
          + "the token lives in memory and expires; nothing secret is stored."
        : "Saved. Both fields are needed before Earth Engine can be called.");
    } catch (error) {
      say(error.message);
    }
  });
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "button";
  clear.textContent = "Clear";
  clear.addEventListener("click", () => {
    window.localStorage.removeItem(STORE_KEY);
    refresh();
    say("Cleared from this browser.");
  });
  /**
   * Signing in is its own action, with its own button.
   *
   * It used to happen as a side effect of pressing Fetch, which meant a failed
   * sign-in presented as a broken fetch — and that is most of why a console
   * misconfiguration took a session to identify rather than a minute. A popup
   * that the user asked for, reporting its own outcome, separates "you are not
   * signed in" from "the data request failed" for good.
   *
   * The popup must be opened by a real click. Browsers block one that a
   * background callback tries to open, so this can never be moved into an
   * automatic retry.
   */
  const signIn = document.createElement("button");
  signIn.type = "button";
  signIn.className = "button";
  signIn.textContent = "Sign in to Earth Engine";
  signIn.addEventListener("click", async () => {
    const ee = window.GeoIDEarthEngine;
    if (!ee?.token) { say("The Earth Engine client is not loaded on this page."); return; }
    signIn.disabled = true;
    say("Opening Google sign-in…");
    try {
      await ee.token({ interactive: true });
      say("Signed in. Earth Engine requests will work from now on, and the token "
        + "refreshes itself — you should not need to do this again on this browser.");
    } catch (error) {
      // Google's own text blames the app and never names the origin, which is
      // the fact that resolves it nine times in ten.
      say(`Sign-in failed: ${error.message}`);
    } finally {
      signIn.disabled = false;
    }
  });

  actions.append(save, signIn, clear);
  host.appendChild(actions);

  const ready = current.clientId && current.project;
  // The origin is half of every OAuth failure and is never in the error text.
  const origin = window.location.origin;
  const httpBad = window.location.protocol === "http:"
    && !["localhost", "127.0.0.1"].includes(window.location.hostname);
  say(httpBad
    ? `This page is served from ${origin}, which Google will not sign in from — `
      + "over http it accepts only localhost and 127.0.0.1. Open the same server "
      + `at http://localhost:${window.location.port || 80}/.`
    : ready
      // A condition, not an instruction. The page cannot see the console, so
      // it names what must be true there and stops short of nagging about it
      // — the first sign-in is the test, and its error says which half failed.
      ? `Ready. This page is ${origin}; that exact string must be an Authorised `
        + "JavaScript origin for the Client ID, or Google returns error 400."
      : "Not configured. Earth Engine needs a Client ID and a project; neither is a secret.");
}

// Where this panel sits in the sidebar is decided by TAB_ORDER in toolbox.js,
// which is the list that builds the column. Two earlier attempts asserted it
// from here on a timer instead, and both were no-ops that could only ever have
// made the ordering flicker: this panel's parent is `gis-panel-host`, and by
// the time the timer fired it was the only child left in it -- everything else
// having been appended into the toolbox above. Nothing to move, nowhere to
// move it to.

export function init() {
  if (!byId("gis-settings-keys")) return;
  byId("gis-settings-refresh")?.addEventListener("click", refresh);
  refresh();
}

if (typeof window !== "undefined") {
  window.GeoIDSettings = { init, refresh, read, write, looksSecret };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}
