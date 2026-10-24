/**
 * The page half of the verification ledger (`atlas-ledger.js` is the pure
 * half): it RECORDS each total-risk reading as it is made, VERIFIES the
 * records whose window has passed against what was observed, KEEPS the
 * ledger, and shows it.
 *
 *   record   the total-risk card announces `geoid-gis:total-risk-computed`;
 *            every reading the ledger knows how to verify becomes a record.
 *   verify   at load and every half hour: the weather against Open-Meteo —
 *            the ERA5 archive once the window is six days old, its recent
 *            model analysis before that (marked provisional and replaced when
 *            the archive covers it) — and the events against NASA EONET and
 *            the USGS catalogue, asked about each place's own box and window.
 *   keep     in this browser (localStorage), and best-effort into an open
 *            project at metadata/atlas_ledger.json, so it travels with a study.
 *
 * No key of ours: every service here is open and CORS-friendly.
 */

import {
  VERIFY, recordFrom, addRecords, dueRecords, verifyEvent, verifyWeather,
  summarise, reportText, toCsv, eonetEvents, usgsEvents, weatherVars,
} from "./atlas-ledger.js?v=20261024-ef0852d";

const KEY = "geoid-gis:atlas-ledger";
const PROJECT_PATH = "metadata/atlas_ledger.json";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ARCHIVE_LAG = 6 * DAY;
const EVERY = 30 * 60_000;

let ledger = load();
let busy = false;
let lastStatus = "";

function load() {
  try {
    const got = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(got) ? got : [];
  } catch { return []; }
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(ledger)); } catch { /* a private window keeps it for the page */ }
  const store = window.GeoIDResearch?.store;
  if (store?.getActive?.()) store.writeJson?.(PROJECT_PATH, { kind: "geoid-atlas-ledger", saved: new Date().toISOString(), records: ledger }).catch(() => {});
  window.dispatchEvent(new CustomEvent("geoid-gis:atlas-ledger-changed", { detail: { count: ledger.length } }));
}

function say(text) {
  lastStatus = text;
}

/* ── recording ──────────────────────────────────────────────────────────── */

export function record({ terms, place, nowMs = Date.now(), horizon = 72 } = {}) {
  const fresh = (terms || []).map((t) => recordFrom(t, place, { issuedMs: nowMs, horizonHours: horizon })).filter(Boolean);
  if (!fresh.length) return 0;
  ledger = addRecords(ledger, fresh);
  save();
  return fresh.length;
}

/* ── verifying ──────────────────────────────────────────────────────────── */

const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Records grouped by place (to a tenth of a degree), so one request serves a place. */
function byPlace(records, extra = () => "") {
  const groups = new Map();
  for (const r of records) {
    const k = `${r.lat.toFixed(1)},${r.lon.toFixed(1)}|${extra(r)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups.values()];
}

async function verifyWeatherGroup(group, nowMs) {
  const lat = group[0].lat; const lon = group[0].lon;
  const fromMs = Math.min(...group.map((r) => r.fromMs));
  const toMs = Math.max(...group.map((r) => r.toMs));
  const archived = toMs + ARCHIVE_LAG <= nowMs;
  // CAPE is not in the ERA5 archive Open-Meteo serves; it is read from the
  // model analysis whatever the age, and that answer is final.
  const capeOnly = (r) => r.key === "cape";
  const sets = [
    { recs: group.filter((r) => !capeOnly(r)), archive: archived },
    { recs: group.filter(capeOnly), archive: false },
  ].filter((s) => s.recs.length);
  let done = 0;
  for (const s of sets) {
    const vars = weatherVars(s.recs);
    const host = s.archive ? "https://archive-api.open-meteo.com/v1/archive" : "https://api.open-meteo.com/v1/forecast";
    const url = `${host}?latitude=${lat}&longitude=${lon}&start_date=${ymd(fromMs)}&end_date=${ymd(toMs)}`
      + `&hourly=${vars.join(",")}&wind_speed_unit=ms&timezone=GMT`;
    let json;
    try { json = await getJson(url); } catch { continue; }
    const source = s.archive ? "Open-Meteo ERA5 archive" : "Open-Meteo model analysis";
    for (const r of s.recs) {
      const provisional = !s.archive && !capeOnly(r);
      const outcome = verifyWeather(r, json.hourly, { nowMs, source, provisional });
      if (outcome) { r.outcome = outcome; r.verifiedMs = nowMs; done += 1; }
    }
  }
  return done;
}

async function verifyEventGroup(group, nowMs) {
  const lat = group[0].lat; const lon = group[0].lon;
  const fromMs = Math.min(...group.map((r) => r.fromMs));
  const toMs = Math.max(...group.map((r) => r.toMs));
  const events = [];
  const sources = [];
  const cats = [...new Set(group.flatMap((r) => VERIFY[r.key].categories).filter((c) => c !== "earthquakes"))];
  if (cats.length) {
    const reach = Math.max(...group.map((r) => VERIFY[r.key].reachKm)) / 111 + 0.5;
    const bbox = [lon - reach / Math.max(0.2, Math.cos(lat * Math.PI / 180)), lat + reach,
      lon + reach / Math.max(0.2, Math.cos(lat * Math.PI / 180)), lat - reach].map((v) => v.toFixed(3)).join(",");
    try {
      const json = await getJson(`https://eonet.gsfc.nasa.gov/api/v3/events?status=all&start=${ymd(fromMs)}&end=${ymd(toMs + DAY)}`
        + `&category=${cats.join(",")}&bbox=${bbox}`);
      events.push(...eonetEvents(json));
      sources.push("NASA EONET");
    } catch { /* left unverified this pass */ }
  }
  if (group.some((r) => r.key === "aftershock")) {
    try {
      const json = await getJson(`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=5`
        + `&starttime=${new Date(fromMs).toISOString()}&endtime=${new Date(toMs).toISOString()}`
        + `&latitude=${lat}&longitude=${lon}&maxradiuskm=${VERIFY.aftershock.reachKm}`);
      events.push(...usgsEvents(json));
      sources.push("USGS");
    } catch { /* left unverified this pass */ }
  }
  let done = 0;
  for (const r of group) {
    const needsUsgs = r.key === "aftershock";
    if (needsUsgs ? !sources.includes("USGS") : !sources.includes("NASA EONET")) continue;
    r.outcome = verifyEvent(r, events, { nowMs, source: needsUsgs ? "USGS" : "NASA EONET" });
    r.verifiedMs = nowMs;
    done += 1;
  }
  return done;
}

export async function verify() {
  if (busy) return 0;
  const nowMs = Date.now();
  const due = dueRecords(ledger, nowMs, { archiveLagMs: ARCHIVE_LAG });
  if (!due.length) { say(ledger.length ? "Nothing due — every record is verified or still inside its window." : "The ledger is empty."); return 0; }
  busy = true;
  say(`Verifying ${due.length} record${due.length === 1 ? "" : "s"}…`);
  let done = 0;
  try {
    // A record the archive covers is never asked of the model analysis just
    // because a recent record at the same place shares its request.
    const archivable = (r) => (r.toMs + ARCHIVE_LAG <= nowMs ? "archive" : "recent");
    for (const g of byPlace(due.filter((r) => VERIFY[r.key].kind === "weather"), archivable)) done += await verifyWeatherGroup(g, nowMs);
    for (const g of byPlace(due.filter((r) => VERIFY[r.key].kind === "event"))) done += await verifyEventGroup(g, nowMs);
  } finally {
    busy = false;
  }
  if (done) save();
  say(`${done} of ${due.length} due record${due.length === 1 ? "" : "s"} verified${done < due.length ? " — the rest could not reach their source and wait for the next pass" : ""}.`);
  return done;
}

/* ── reading it back ────────────────────────────────────────────────────── */

function hazardKey(text) {
  if (!text) return null;
  const q = String(text).toLowerCase();
  if (VERIFY[q]) return q;
  const words = { rain: /rain|precip/, snow: /snow/, gust: /gust|wind|gale/, heat: /heat|hot/, cold: /cold|frost|freez/,
    cape: /cape|thunder|convect/, fire: /fire weather|red flag/, cyclone: /cyclone|hurricane|typhoon|storm/,
    flood: /flood/, slope: /landslide|slope/, eruption: /erupt|volcan/, ash: /\bash\b/, wildfire: /wildfire|bushfire/,
    aftershock: /aftershock|earthquake|quake/ };
  return Object.keys(words).find((k) => words[k].test(q)) || null;
}

export function stats(hazard = null) {
  return summarise(ledger, { key: hazardKey(hazard) });
}

export async function report(hazard = null) {
  if (dueRecords(ledger, Date.now(), { archiveLagMs: ARCHIVE_LAG }).length) await verify();
  const key = hazardKey(hazard);
  return reportText(summarise(ledger, { key }), { key });
}

export async function exportCsv() {
  // Through the app's one download path: it files the CSV into an open
  // project and keeps the membership gate on saving.
  const { downloadText } = await import("./extraction.js?v=20261024-ef0852d");
  return downloadText("atlas_verification_ledger.csv", toCsv(ledger), "text/csv");
}

export function clear() {
  ledger = [];
  save();
  say("The ledger is empty.");
}

/* ── no card ───────────────────────────────────────────────────────────────
 * The ledger had its own "How well the models have done" card under the
 * total-risk card. It was removed as redundant (2026-10-17): the ledger still
 * records and verifies in the background, and the assistant's verification
 * tool (window.GeoIDAtlasLedger) is how it is read.
 */

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("geoid-gis:total-risk-computed", (e) => { record(e.detail || {}); });
  setTimeout(() => void verify(), 5000);
  setInterval(() => void verify(), EVERY);
  window.GeoIDAtlasLedger = { record, verify, report, stats, exportCsv, clear, ledger: () => ledger };
}
