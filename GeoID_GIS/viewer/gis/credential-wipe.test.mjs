/**
 * Checks for the credential wipe.
 *
 *     node GeoID_GIS/viewer/gis/credential-wipe.test.mjs
 *
 * The rule worth pinning is what it must NOT do: a wipe that takes somebody's
 * project, their layer bookmarks or their theme with it is a wipe nobody will
 * run twice. So the check is on both sides — every credential goes, and
 * everything that is not one stays.
 */
const storage = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  },
};
globalThis.document = { querySelector: () => null, dispatchEvent: () => true };
globalThis.CustomEvent = class { constructor(t, i) { this.type = t; this.detail = i?.detail; } };

const { wipeCredentials, storedCredentials } = await import("./credential-wipe.js");

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const CREDENTIALS = [
  "geoid-gis:gee-endpoint",
  "geoid-gis:google-credentials",
  "geoid-gis:sidecar",
  "geoid-gis:atlas-endpoint",
];
// Everything else a reader has: their work, their preferences, their session.
const KEEP = [
  "geoid-gis:last-project",
  "geoid-gis:view-mode",
  "geoid-gis:tool-favourites",
  "geoid-gis:event-sources-off",
  "earth-gis-study-areas-v1",
  "earth-gis-pins-v1",
  "geoid-studio:folds",
  "geoid:membership",
  "geoid-tle-stations",
];

const seed = () => {
  storage.clear();
  CREDENTIALS.forEach((k) => storage.set(k, "SECRET-VALUE-something"));
  KEEP.forEach((k) => storage.set(k, "mine"));
};

// ── 1. Every credential goes ───────────────────────────────────────────────

seed();
const gone = wipeCredentials({ everything: true });
for (const k of CREDENTIALS) check(`${k} is cleared`, !storage.has(k));
// The rule is that a report is never the stored VALUE — not that it avoids
// particular words. "the local sidecar and its token" is a description of what
// was cleared, which is exactly what a log line should say.
check("it reports what it cleared, and never a stored value",
  gone.length === 4 && gone.every((g) => !g.includes("SECRET-VALUE")),
  gone.join(", "));

// ── 2. And NOTHING else does ──────────────────────────────────────────────

// A wipe that takes somebody's project or their pins with it is one nobody
// runs twice, and the damage is silent.
for (const k of KEEP) check(`${k} SURVIVES`, storage.get(k) === "mine");

// ── 3. It says what is there, without saying what it is ───────────────────

seed();
const held = storedCredentials();
check("it lists what is held", held.length === 4, JSON.stringify(held.map((h) => h.key)));
check("...naming the keys and what they are for, never the values",
  held.every((h) => h.key && h.what && !("value" in h)), JSON.stringify(held[0]));

// ── 4. Clearing an empty store is a no-op rather than an error ────────────

storage.clear();
check("an empty store clears to nothing", wipeCredentials({ everything: true }).length === 0);

console.log(`\n${failures ? `${failures} failed` : "all passed"}`);
process.on("exit", () => { process.exitCode = failures ? 1 : 0; });
