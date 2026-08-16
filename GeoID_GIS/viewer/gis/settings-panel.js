/**
 * Settings: the credentials the GIS needs, held where they can be held.
 *
 * A browser cannot keep a secret. Anything typed into a page served from disk
 * is readable by anything else on that page, so a Google Earth Engine service
 * account cannot live here — it lives in the sidecar, in a file outside git at
 * mode 0600, and the credentialed call is made on that side. This panel is the
 * way IN to that store and deliberately not a way out: the value is posted
 * once and every reply is masked to the last four characters.
 *
 * The same store already holds the model keys, with the same rules, so this
 * adds a row rather than a mechanism.
 */

const KEYS = [
  {
    name: "EE_PROJECT",
    label: "Earth Engine project",
    hint: "The Cloud project the service account belongs to, e.g. geoid-504623.",
    secret: false,
  },
  {
    name: "EE_SERVICE_ACCOUNT",
    label: "Service account",
    hint: "The account's email address, ending in .iam.gserviceaccount.com.",
    secret: false,
  },
  {
    name: "EE_PRIVATE_KEY",
    label: "Private key",
    hint: "The PEM from the account's JSON key file. It is written to the "
      + "sidecar at mode 0600 and never returned to this page.",
    secret: true,
  },
];

let client = null;

async function sidecar() {
  if (client) return client;
  const stamp = new URL(import.meta.url).search;
  client = await import(`./research/sidecar.js${stamp}`);
  return client;
}

function byId(id) { return document.getElementById(id); }

function say(text) {
  const node = byId("gis-settings-status");
  if (node) node.textContent = text;
}

async function refresh() {
  const host = byId("gis-settings-keys");
  if (!host) return;
  host.innerHTML = "";
  let status = null;
  try {
    const api = await sidecar();
    status = await api.atlasKeys();
  } catch (error) {
    say("The sidecar is not connected. Earth Engine needs it: a credential "
      + "cannot be kept in a page, so it is kept in that process. Start it with "
      + "python3 serve.py and connect from the Research Hub.");
    return;
  }

  KEYS.forEach((key) => {
    const state = status?.[key.name] || {};
    const row = document.createElement("div");
    row.className = "gis-setting-row";

    const label = document.createElement("label");
    label.textContent = key.label;
    label.setAttribute("for", `gis-setting-${key.name}`);

    const input = document.createElement("input");
    input.id = `gis-setting-${key.name}`;
    input.className = "input";
    input.type = key.secret ? "password" : "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    // Never the value: a configured key shows only that it is configured.
    input.placeholder = state.configured
      ? `configured (${state.hint || "set"}${state.source === "environment" ? ", from the environment" : ""})`
      : "not set";

    const save = document.createElement("button");
    save.type = "button";
    save.className = "button";
    save.textContent = "Save";
    save.addEventListener("click", async () => {
      const value = input.value.trim();
      if (!value) { say(`${key.label}: nothing typed.`); return; }
      try {
        const api = await sidecar();
        await api.saveAtlasKey(key.name, value);
        input.value = "";                 // out of the DOM as soon as it is sent
        say(`${key.label} saved to the sidecar.`);
        void refresh();
      } catch (error) {
        say(`Could not save ${key.label}: ${error.message}`);
      }
    });

    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "button";
    clear.textContent = "Clear";
    clear.disabled = !state.configured || state.source === "environment";
    clear.title = state.source === "environment"
      ? "This one comes from the environment; unset it there."
      : "Remove this credential from the sidecar";
    clear.addEventListener("click", async () => {
      try {
        const api = await sidecar();
        await api.deleteAtlasKey(key.name);
        say(`${key.label} removed.`);
        void refresh();
      } catch (error) {
        say(`Could not remove ${key.label}: ${error.message}`);
      }
    });

    const note = document.createElement("span");
    note.className = "gis-setting-hint";
    note.textContent = key.hint;

    const actions = document.createElement("div");
    actions.className = "gis-btn-row";
    actions.append(save, clear);
    row.append(label, input, actions, note);
    host.appendChild(row);
  });

  const configured = KEYS.filter((k) => status?.[k.name]?.configured).length;
  say(configured === KEYS.length
    ? "Earth Engine is configured. Imagery requests are made by the sidecar."
    : `${configured} of ${KEYS.length} Earth Engine settings in place.`);
}

export function init() {
  if (!byId("gis-settings-keys")) return;
  byId("gis-settings-refresh")?.addEventListener("click", () => { void refresh(); });
  void refresh();
}

if (typeof window !== "undefined") {
  window.GeoIDSettings = { init, refresh, KEYS };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}
