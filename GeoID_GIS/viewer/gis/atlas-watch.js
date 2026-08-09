/**
 * Atlas's watcher — the live feeds, checked on a timer, against your study area.
 *
 * Atlas can already answer "anything happening nearby?" on demand. This turns
 * that into standing surveillance: poll the open connectors on an interval,
 * decide what is genuinely worth interrupting someone for, and push it through
 * `GeoIDAtlas.notify` so the alert arrives where they are already looking.
 *
 * Three rules decide everything, and each exists because the naive version is
 * actively harmful:
 *
 * 1. **The first poll never alerts.** It establishes what is already out there.
 *    Without this, opening the app on a global study area greets you with two
 *    thousand earthquake alerts, and you stop reading them — which is worse than
 *    no monitoring at all.
 * 2. **Only new events alert.** Every feature is keyed by a stable id, and the
 *    seen-set persists into the project, so a reload does not re-announce the
 *    same eruption.
 * 3. **Only significant events alert.** A magnitude floor for earthquakes, a
 *    severity floor for weather; a feed of every M0.5 tremor is noise wearing
 *    the clothes of information.
 *
 * The decision is a pure function (`triage`) so it can be tested against known
 * inputs without a network — the polling around it is the only impure part.
 *
 * Honest limitation, stated in the UI too: this runs **in the page**, so it
 * watches only while a tab is open, and browsers throttle background timers.
 * Persistent watching belongs in the sidecar, which already outlives a click;
 * this is the same logic, ready to move there.
 */

const STAMP = new URL(import.meta.url).search || "";
const STATE_PATH = "metadata/atlas_watch.json";

/** The default interval. Long enough to be a good citizen of free public APIs. */
export const DEFAULT_INTERVAL_MIN = 10;

export const DEFAULT_CONFIG = {
  intervalMin: DEFAULT_INTERVAL_MIN,
  minMagnitude: 4.0,                       // earthquakes worth a look
  severities: ["Severe", "Extreme"],       // NWS alert levels worth a look
};

/**
 * What each feed is, how to identify one of its features, and what makes one
 * worth interrupting for. Adding a source is a row here.
 */
export const WATCH_SOURCES = [
  {
    connector: "usgs-earthquakes",
    label: "earthquake",
    key: (f) => f.properties?.url || `${f.geometry?.coordinates}|${f.properties?.time}`,
    significant: (f, cfg) => Number(f.properties?.magnitude ?? 0) >= cfg.minMagnitude,
    describe: (f) => `M${Number(f.properties?.magnitude ?? 0).toFixed(1)} — `
      + `${f.properties?.place || "unknown location"}`,
  },
  {
    connector: "nws-alerts",
    label: "weather alert",
    key: (f) => `${f.properties?.event}|${f.properties?.area}|${f.properties?.effective}`,
    significant: (f, cfg) => cfg.severities.includes(f.properties?.severity),
    describe: (f) => `${f.properties?.event} (${f.properties?.severity}) — `
      + `${f.properties?.area || ""}`.trim(),
  },
  {
    connector: "eonet-volcanoes",
    label: "volcanic event",
    key: (f) => f.properties?.eventId || f.properties?.title,
    significant: () => true,               // a tracked eruption is always news
    describe: (f) => f.properties?.title || "volcanic event",
  },
  {
    connector: "eonet-wildfires",
    label: "wildfire",
    key: (f) => f.properties?.eventId || f.properties?.title,
    significant: () => true,
    describe: (f) => f.properties?.title || "wildfire",
  },
];

/**
 * Decide what to announce from one feed's features. Pure: no clock, no network,
 * no storage — everything it needs is an argument, which is what makes the three
 * rules above testable rather than hoped for.
 *
 * @param {Array} features   the connector's GeoJSON features
 * @param {object} source    a WATCH_SOURCES entry
 * @param {Set<string>} seen keys already known (mutated: new keys are added)
 * @param {object} cfg       thresholds
 * @param {boolean} baseline true on the first pass — record, never announce
 * @returns {{alerts: Array<{key, text}>, added: number}}
 */
export function triage(features, source, seen, cfg, baseline) {
  const alerts = [];
  let added = 0;
  for (const feature of features || []) {
    const key = String(source.key(feature) ?? "");
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    added += 1;
    // Rule 1: the first pass is a baseline, so nothing from it interrupts.
    if (baseline) continue;
    // Rule 3: new is not the same as significant.
    if (!source.significant(feature, cfg)) continue;
    alerts.push({ key, text: source.describe(feature) });
  }
  return { alerts, added };
}

// ── The loop around it ───────────────────────────────────────────────────────

let timer = null;
let running = false;
let config = { ...DEFAULT_CONFIG };
let seen = new Map();       // connector -> Set of keys
let baseline = true;
let lastRun = null;
let lastError = null;

function store() { return window.GeoIDResearch?.store; }

async function loadState() {
  const s = store();
  if (!s?.getActive?.()) return;
  const saved = await s.readJson(STATE_PATH, null).catch(() => null);
  if (!saved) return;
  config = { ...DEFAULT_CONFIG, ...(saved.config || {}) };
  baseline = saved.baseline !== false;
  seen = new Map(Object.entries(saved.seen || {}).map(([k, v]) => [k, new Set(v)]));
}

async function saveState() {
  const s = store();
  if (!s?.getActive?.()) return;
  // Bounded: a busy feed would otherwise grow this file without limit.
  const trimmed = Object.fromEntries([...seen.entries()]
    .map(([k, set]) => [k, [...set].slice(-500)]));
  await s.writeJson(STATE_PATH, {
    config, baseline, seen: trimmed, updated_at: new Date().toISOString(),
  }).catch(() => {});
}

/** One pass over every source. Returns the alerts it decided to raise. */
export async function sweep() {
  const { runConnector, studyBbox } = await import(`./research/connectors.js${STAMP}`);
  const active = store()?.getActive?.();
  const bbox = studyBbox(active?.meta?.study_area);
  const raised = [];
  let reachable = 0;
  for (const source of WATCH_SOURCES) {
    if (!seen.has(source.connector)) seen.set(source.connector, new Set());
    try {
      const result = await runConnector(source.connector, { bbox });
      reachable += 1;
      const { alerts } = triage(result.geojson.features, source,
        seen.get(source.connector), config, baseline);
      alerts.forEach((a) => raised.push({ ...a, label: source.label }));
    } catch (error) {
      // One unreachable feed must not stop the others, and a transient outage
      // is not worth interrupting anyone about.
      lastError = `${source.connector}: ${error.message}`;
    }
  }
  const wasBaseline = baseline;
  if (reachable) baseline = false;      // only leave baseline once something answered
  lastRun = new Date().toISOString();
  await saveState();
  if (wasBaseline || !raised.length) return [];

  const bits = raised.slice(0, 8)
    .map((a) => `• ${a.text}`)
    .join("\n");
  window.GeoIDAtlas?.notify?.(
    `**${raised.length} new ${raised.length === 1 ? "event" : "events"}** near your study area:\n`
    + bits + (raised.length > 8 ? `\n…and ${raised.length - 8} more.` : ""),
    [["Fetch them into the project", () => window.GeoIDResearch?.setPage?.("Ingest Seismic Geophysics")]],
  );
  return raised;
}

export async function start(options = {}) {
  await loadState();
  config = { ...config, ...options };
  stop();
  running = true;
  await sweep();                                   // establishes the baseline
  timer = setInterval(() => { void sweep(); },
    Math.max(1, config.intervalMin) * 60 * 1000);
  await saveState();
  return status();
}

export function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  running = false;
}

export function status() {
  return {
    running,
    intervalMin: config.intervalMin,
    minMagnitude: config.minMagnitude,
    severities: config.severities,
    baseline,
    lastRun,
    lastError,
    known: [...seen.entries()].reduce((n, [, set]) => n + set.size, 0),
    sources: WATCH_SOURCES.map((s) => s.label),
  };
}
