/**
 * The project, seen from the map.
 *
 * The bridge writes to the project on import, extraction, processing and
 * meshing, and the Research Hub can see all of it — but the GIS sidebar could
 * not. From the globe there was no project name, no study area, no count of
 * what had been produced and no way back to it, so the three surfaces read as
 * three applications that happen to share a window.
 *
 * This is the panel that makes them one. It reads the store and shows nothing
 * it cannot verify: with no project open it says so and offers the way to
 * open one, rather than displaying an empty shape that looks broken.
 */

const REFRESH_MS = 4000;
let timer = null;

function byId(id) { return document.getElementById(id); }

async function store() {
  const seam = window.GeoIDResearch?.store;
  if (seam) return seam;
  try {
    const stamp = new URL(import.meta.url).search;
    return await import(`./research/project-store.js${stamp}`);
  } catch (error) {
    return null;
  }
}

/** Counts by kind, so "what has this project got" is one line. */
export function summarise(records) {
  const counts = new Map();
  (records || []).forEach((r) => {
    const kind = r?.kind || "other";
    counts.set(kind, (counts.get(kind) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/** The most recent entries, newest first, without trusting the file order. */
export function recent(records, limit = 5) {
  return (records || [])
    .filter((r) => r && (r.name || r.path))
    .slice()
    .sort((a, b) => String(b.registered_at || b.timestamp || "")
      .localeCompare(String(a.registered_at || a.timestamp || "")))
    .slice(0, limit);
}

function areaText(meta) {
  const a = meta?.study_area;
  if (!a) return null;
  const nums = [a.min_lat, a.max_lat, a.min_lon, a.max_lon].map(Number);
  if (!nums.every(Number.isFinite)) return null;
  const [minLat, maxLat, minLon, maxLon] = nums;
  if (minLat === 0 && maxLat === 0 && minLon === 0 && maxLon === 0) return null;
  return `${minLat.toFixed(2)}–${maxLat.toFixed(2)}°N, ${minLon.toFixed(2)}–${maxLon.toFixed(2)}°E`;
}

async function render() {
  const host = byId("gis-project-body");
  if (!host) return;
  const s = await store();
  const active = s?.getActive?.();
  if (!active) {
    host.innerHTML = "";
    const line = document.createElement("div");
    line.className = "gis-metric";
    line.textContent = "No project open. The Research Hub opens or creates one; "
      + "until then imports and results stay in this session only.";
    host.appendChild(line);
    const open = document.createElement("button");
    open.type = "button";
    open.className = "button";
    open.textContent = "Open the Research Hub";
    open.addEventListener("click", () => window.GeoIDModeManager?.setMode?.("research"));
    host.appendChild(open);
    return;
  }

  let records = [];
  try {
    records = await s.listData();
  } catch (error) {
    records = [];
  }

  host.innerHTML = "";
  const name = document.createElement("div");
  name.className = "gis-project-name";
  name.textContent = active.meta?.name || active.folder || "project";
  host.appendChild(name);

  const area = areaText(active.meta);
  const areaRow = document.createElement("div");
  areaRow.className = "gis-metric";
  areaRow.textContent = area ? `Study area ${area}` : "No study area set — draw one and it is captured.";
  host.appendChild(areaRow);
  if (area) {
    const frame = document.createElement("button");
    frame.type = "button";
    frame.className = "button";
    frame.textContent = "Frame the study area";
    frame.addEventListener("click", () => window.GeoIDResearch?.bridge?.frameStudyArea?.());
    host.appendChild(frame);
  }

  const counts = summarise(records);
  const totals = document.createElement("div");
  totals.className = "gis-metric";
  totals.textContent = counts.length
    ? counts.map(([kind, n]) => `${n} ${kind}`).join(" · ")
    : "Nothing recorded yet.";
  host.appendChild(totals);

  const list = document.createElement("div");
  list.className = "gis-project-recent";
  recent(records).forEach((r) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "gis-tool-item";
    const label = document.createElement("b");
    label.textContent = r.name || r.path;
    const kind = document.createElement("span");
    kind.textContent = `${r.kind || "file"}${r.tool ? ` · ${r.tool}` : ""}`;
    row.append(label, kind);
    row.title = `Show ${r.name || r.path} on the globe`;
    row.addEventListener("click", () => window.GeoIDResearch?.bridge?.sendToGlobe?.(r));
    list.appendChild(row);
  });
  host.appendChild(list);
}

export function init() {
  if (!byId("gis-project-body")) return;
  void render();
  // Polled rather than subscribed: the store announces on its own writes, and
  // the things this panel reports are also written by the Studio and the Hub,
  // in other realms this module never hears from.
  if (timer) clearInterval(timer);
  timer = setInterval(() => { void render(); }, REFRESH_MS);
}

if (typeof window !== "undefined") {
  window.GeoIDProjectPanel = { init, render, summarise, recent };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}
