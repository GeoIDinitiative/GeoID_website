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
const DEFAULTS = { clientId: "", project: "geoid-504623" };

export function read() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORE_KEY) || "null");
    return { ...DEFAULTS, ...(stored || {}) };
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
    input.placeholder = field.name === "clientId" ? "…apps.googleusercontent.com" : "project id";
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
  actions.append(save, clear);
  host.appendChild(actions);

  const ready = current.clientId && current.project;
  say(ready ? "Earth Engine is configured for this browser."
    : "Not configured. Earth Engine needs a Client ID and a project; neither is a secret.");
}

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
