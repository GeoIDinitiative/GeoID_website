/**
 * The watcher's triage, against known inputs.
 *
 * These three rules are the difference between monitoring and spam, and each
 * fails *silently* when it breaks — you simply get alerts you shouldn't, or
 * miss ones you should, and nothing errors. So they are pinned here:
 *
 *   1. the first pass records and never announces (no 2000-alert greeting)
 *   2. an event already seen never announces twice (no re-announcing on reload)
 *   3. a new event below threshold never announces (no M0.5 tremor feed)
 *
 *   node GeoID_GIS/viewer/gis/atlas-watch.test.mjs
 */

import { triage, WATCH_SOURCES, DEFAULT_CONFIG } from "./atlas-watch.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const quakes = WATCH_SOURCES.find((s) => s.connector === "usgs-earthquakes");
const nws = WATCH_SOURCES.find((s) => s.connector === "nws-alerts");
const volcano = WATCH_SOURCES.find((s) => s.connector === "eonet-volcanoes");

const quake = (mag, url, place = "somewhere") => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [1, 2, 3] },
  properties: { magnitude: mag, url, place, time: "2026-08-10T00:00:00Z" },
});

// ── Rule 1: the first pass is a baseline ─────────────────────────────────────
{
  const seen = new Set();
  const { alerts, added } = triage(
    [quake(6.1, "a"), quake(5.2, "b")], quakes, seen, DEFAULT_CONFIG, true);
  check("baseline pass announces nothing", alerts.length === 0, `${alerts.length} alerts`);
  check("baseline pass still records what it saw", added === 2 && seen.size === 2,
    `added=${added} seen=${seen.size}`);
}

// ── Rule 2: only genuinely new events ────────────────────────────────────────
{
  const seen = new Set();
  triage([quake(6.1, "a")], quakes, seen, DEFAULT_CONFIG, true);      // baseline
  const first = triage([quake(6.1, "a"), quake(6.5, "b")], quakes, seen, DEFAULT_CONFIG, false);
  check("a new significant event announces once",
    first.alerts.length === 1 && first.alerts[0].key === "b",
    JSON.stringify(first.alerts));
  const second = triage([quake(6.1, "a"), quake(6.5, "b")], quakes, seen, DEFAULT_CONFIG, false);
  check("the same events do not announce again", second.alerts.length === 0,
    `${second.alerts.length} alerts`);
}

// ── Rule 3: new is not the same as significant ───────────────────────────────
{
  const seen = new Set();
  const { alerts } = triage(
    [quake(1.2, "tiny"), quake(4.0, "atThreshold"), quake(7.0, "big")],
    quakes, seen, DEFAULT_CONFIG, false);
  check("below-threshold magnitudes are recorded but never announced",
    alerts.length === 2 && !alerts.some((a) => a.key === "tiny"),
    alerts.map((a) => a.key).join(","));
  check("the threshold itself counts as significant",
    alerts.some((a) => a.key === "atThreshold"));
  check("a quiet event is still remembered, so it cannot alert later", seen.has("tiny"));
}

// ── Severity, for weather ────────────────────────────────────────────────────
{
  const seen = new Set();
  const alert = (event, severity, area) => ({
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [] },
    properties: { event, severity, area, effective: "2026-08-10T00:00:00Z" },
  });
  const { alerts } = triage(
    [alert("Flood Warning", "Severe", "A"), alert("Beach Hazard", "Minor", "B"),
      alert("Tornado Warning", "Extreme", "C")],
    nws, seen, DEFAULT_CONFIG, false);
  check("only severe and extreme weather announces",
    alerts.length === 2 && !alerts.some((a) => a.text.includes("Beach")),
    alerts.map((a) => a.text).join(" | "));
  check("the description carries event, severity and area",
    alerts[0].text.includes("Flood Warning") && alerts[0].text.includes("Severe"),
    alerts[0].text);
}

// ── Keys must be stable, or rule 2 silently fails ────────────────────────────
{
  const a = quake(5.0, "https://usgs/x");
  check("an earthquake keys on its permanent url",
    quakes.key(a) === "https://usgs/x", quakes.key(a));
  const v = { properties: { eventId: "EONET_5", title: "Etna" } };
  check("a volcanic event keys on its EONET id", volcano.key(v) === "EONET_5");
  const seen = new Set();
  const twice = [quake(5.0, "same"), quake(5.0, "same")];
  const { alerts } = triage(twice, quakes, seen, DEFAULT_CONFIG, false);
  check("a duplicate inside one response announces once", alerts.length === 1,
    `${alerts.length} alerts`);
}

// ── Every source must be well formed ─────────────────────────────────────────
WATCH_SOURCES.forEach((s) => {
  check(`${s.connector} declares key/significant/describe`,
    typeof s.key === "function" && typeof s.significant === "function"
    && typeof s.describe === "function" && !!s.label);
});

console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
