/**
 * Hazards ▸ Infrastructure ▸ What is inside.
 *
 * The page's half of `infrastructure.js`: it turns whatever is on the globe
 * into the two things that module reads -- a hazard READER (`value at a
 * point` plus the scheme its values are classed on) and the infrastructure
 * SOURCES (features per catalogue row) -- and draws the readout under the
 * Infrastructure list. Atlas reaches the same reading through
 * `window.GeoIDInfrastructure.ask` (atlas-runner's `infrastructure_exposed`).
 *
 * A footprint is any of:
 *  - a map the risk reader reads (risk-reader.js `riskMaps`): a flood or
 *    sea-level sheet, the landslide forecast, the river zones, a cyclone,
 *    seismic or volcanic risk grid, the volcanic buffers, storm tracks -- and
 *    the Atlas ash deposit, classed here on its own impact classes;
 *  - any other polygon layer: a fire perimeter, a weather alert, an imported
 *    hazard zone -- "inside or not", since it carries no severity;
 *  - the drawn study area alone.
 * and may be cut to a study area ("Within"), so a global cyclone grid can be
 * read for one coast.
 *
 * THE POINT LAYERS ARE READ EVEN WHEN THEY ARE NOT TICKED. Cities, seaports
 * and airports are small shipped files, and "which ports are in this flood"
 * should not first require three ticks; they are fetched once and kept. The
 * heavy and the live ones -- railways, roads, bridges, buildings, cables --
 * are counted when they are on the globe, and the readout says which were.
 */

import * as THREE from "../vendor/three.module.js";
import { latLonToVector3 } from "./geo-utils.js?v=20261025-f5a5da0";
import { DATASETS, layerForDataset, addDataset, datasetById } from "./global-data.js?v=20261025-f5a5da0";
import { dataUrl } from "./data-base.js?v=20261025-f5a5da0";
import { riskMaps, areaFor, ringsBox, RIVER_ZONE_SCHEME, VOLCANIC_ZONE_SCHEME } from "./risk-reader.js?v=20261025-f5a5da0";
import { polygonsOf, polygonIndex, insideAny, gridValueAt, boxOf } from "./exposure.js?v=20261025-f5a5da0";
import { SCHEMES, schemeForLayerName, bandScheme, chanceScheme, windLookup, riskLayerKind }
  from "./risk-assessment.js?v=20261025-f5a5da0";
import {
  INSIDE_SCHEME, ASH_SCHEME, exposeSource, summarise, describe, exposureCsv, classColour, featureBox,
} from "./infrastructure.js?v=20261025-f5a5da0";
import { refreshPolygonOptions, promptDrawTool } from "./extent-picker.js?v=20261025-f5a5da0";
import { boxSpanDeg, BRIDGE_TIERS, BUILDING_MAX_SPAN } from "./research/connectors.js?v=20261025-f5a5da0";

const search = new URL(import.meta.url).search;
const byId = (id) => document.getElementById(id);
const featuresOf = (l) => l?._allFeatures || l?.features || l?.collection?.features || [];
const say = (m) => { const n = byId("infra-status"); if (n) n.textContent = m || ""; };

/** The rows this reads, in the order the readout lists them. */
const HOME = "infrastructure";
const PLURALS = {
  "infra-places": ["City or town", "Cities and towns"],
  "ne-urban-10m": ["Urban area", "Urban areas"],
  "conn-osm-places": ["OSM place", "OSM places"],
  "conn-osm-city-outlines": ["City outline", "City outlines"],
  "infra-railways": ["Railway line", "Railway lines"],
  "conn-osm-bridges": ["Bridge", "Bridges"],
  "conn-cable-landings": ["Cable landing station", "Cable landing stations"],
};
/** Small shipped files read whether or not they are ticked. */
const ALWAYS = new Set(["infra-places", "infra-ports", "infra-airports"]);

const fetched = new Map();
async function shippedFeatures(entry) {
  if (!fetched.has(entry.id)) {
    fetched.set(entry.id, fetch(await dataUrl(entry.path))
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((fc) => fc.features || [])
      .catch((e) => { fetched.delete(entry.id); throw e; }));
  }
  return fetched.get(entry.id);
}

const datasetLabel = (id) => datasetById(id)?.label || id;

export function infrastructureEntries() {
  return DATASETS.filter((d) => d.home === HOME && !d.hidden);
}

const isInfrastructureLayer = (layer) => infrastructureEntries().some((e) => layerForDataset(e) === layer);

/** Every infrastructure source there is something to read for: `[{id, noun, plural, features, onGlobe}]`. */
export async function infrastructureSources({ fetchMissing = true } = {}) {
  const out = [];
  for (const entry of infrastructureEntries()) {
    const layer = layerForDataset(entry);
    let features = layer ? featuresOf(layer) : null;
    if (!features?.length && fetchMissing && ALWAYS.has(entry.id)) {
      try { features = await shippedFeatures(entry); } catch { features = null; }
    }
    if (!features?.length) continue;
    const [noun, pl] = PLURALS[entry.id] || [entry.featureNoun, `${entry.featureNoun}s`];
    out.push({ id: entry.id, noun, plural: pl, features, onGlobe: Boolean(layer) });
  }
  return out;
}

/* ── footprints ─────────────────────────────────────────────────────────── */

const shown = (l) => l.visible !== false && l.object3D?.visible !== false;
const isPolygonLayer = (l) => featuresOf(l).some((f) => /Polygon/.test(f?.geometry?.type || ""));

/** Every footprint on the globe: `[{ value, label, layer, kind }]`. */
export function footprintChoices() {
  const out = [];
  const seen = new Set();
  for (const m of riskMaps()) {
    if (isInfrastructureLayer(m.layer)) continue;
    seen.add(m.layer);
    const ash = /^ash deposit/i.test(m.layer.name);
    out.push({ value: `layer:${m.layer.id}`, label: m.layer.name, layer: m.layer, kind: ash ? "ash" : m.kind });
  }
  for (const layer of window.GeoIDImportManager?.getLayers?.() || []) {
    if (seen.has(layer) || layer.status !== "loaded" || !shown(layer) || isInfrastructureLayer(layer)) continue;
    if (!isPolygonLayer(layer)) continue;
    out.push({ value: `layer:${layer.id}`, label: layer.name, layer, kind: "polygons" });
  }
  const drawing = window.GeoIDViewer?.getExtractionGeometry?.("study") || window.GeoIDViewer?.getExtractionGeometry?.();
  if (drawing?.vertices?.length >= 3) out.push({ value: "drawn", label: "The drawn area", layer: null, kind: "area" });
  return out;
}

/** Words a reader uses for a hazard, to the layer names and kinds that carry it. */
const HAZARD_WORDS = [
  [/\bflood|inundat|water depth/, /flood|inundation|water depth/i],
  [/\bsea.?level/, /^sea level/i],
  [/\bash|tephra|erupt/, /ash/i],
  [/\blandslide|slope|debris/, /landslide/i],
  [/\bcyclone|hurricane|typhoon|storm/, /cyclone|hurricane|storm|track/i],
  [/\bvolcan/, /volcan/i],
  [/\bseismic|earthquake|quake/, /seismic|earthquake/i],
  [/\bfire|wildfire|burn/, /fire|burn/i],
  [/\briver/, /river/i],
  [/\balert|warning/, /alert|warning/i],
];

/**
 * Which footprint a phrase means: a layer named in it, else a hazard word,
 * else "drawn" for "the drawn area", else the newest hazard map. Null when
 * there is nothing on the globe to read.
 */
export function matchFootprint(text, choices = footprintChoices()) {
  const q = String(text || "").toLowerCase().trim();
  if (!choices.length) return null;
  if (q) {
    const named = choices.find((c) => c.label && q.includes(c.label.toLowerCase()));
    if (named) return named;
    for (const [word, name] of HAZARD_WORDS) {
      if (!word.test(q)) continue;
      const hit = [...choices].reverse().find((c) => c.layer && name.test(c.label));
      if (hit) return hit;
    }
    if (/\b(drawn|study area|this area|my area|the area)\b/.test(q)) {
      const area = choices.find((c) => c.kind === "area")
        || [...choices].reverse().find((c) => c.layer?.ext === "drawn");
      if (area) return area;
    }
    if (HAZARD_WORDS.some(([word]) => word.test(q))) return null;
  }
  const hazards = choices.filter((c) => c.kind !== "area" && c.kind !== "polygons");
  return hazards[hazards.length - 1] || choices[choices.length - 1];
}

const unwrap = (x) => (x > 180 ? x - 360 : x);

function rasterReader(layer, kind) {
  const r = layer.raster;
  let scheme = kind === "ash" ? ASH_SCHEME : kind === "riverzones" ? RIVER_ZONE_SCHEME : schemeForLayerName(layer.name);
  const dry = scheme === SCHEMES.flood || scheme === SCHEMES.sealevel || scheme === RIVER_ZONE_SCHEME || scheme === ASH_SCHEME;
  if (!scheme) {
    let lo = Infinity; let hi = -Infinity;
    for (const v of r.band) {
      if (!Number.isFinite(v) || v <= -1e30 || (r.noData != null && v === r.noData)) continue;
      if (v < lo) lo = v; if (v > hi) hi = v;
    }
    scheme = bandScheme(lo, hi, { measure: r.unit ? `Value (${r.unit})` : "Value", unit: r.unit || "", hazard: layer.name });
  }
  // Dry ground on a flood sheet, no zone, no ash: written as no-data, read as
  // zero ON the sheet -- not exposed -- so only ground OFF it is unmapped.
  const values = dry
    ? Float32Array.from(r.band, (v) => (!Number.isFinite(v) || v <= -1e30 || (r.noData != null && v === r.noData) ? 0 : v))
    : r.band;
  const grid = { width: r.width, height: r.height, bounds: r.bounds };
  return { scheme, read: gridValueAt(grid, values, { noData: dry ? null : r.noData ?? null }), extent: boxOf(r.bounds) };
}

function polygonReader(features, valueOf, scheme) {
  const polys = polygonsOf({ features }).map((p) => ({
    ...p,
    coords: p.coords.map((ring) => ring.map(([x, y]) => [unwrap(x), y])),
    box: { ...p.box, west: unwrap(p.box.west), east: unwrap(p.box.east) },
  }));
  const index = polygonIndex(polys, { bucketDeg: 0.5 });
  return { scheme, read: (lon, lat) => valueOf(index.at(lon, lat)?.feature?.properties || null), extent: polys.length ? ringsBox(polys) : null };
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** A footprint as `{ scheme, read, extent, label }`. */
export function readerFor(choice, within = null) {
  let reader;
  if (choice.kind === "area" || (!choice.layer && choice.value)) {
    const area = areaFor(choice.value);
    reader = { scheme: INSIDE_SCHEME, read: (lon, lat) => (insideAny(lon, lat, area.polys) ? 1 : null), extent: ringsBox(area.polys) };
  } else {
    const { layer, kind } = choice;
    if (layer.raster?.band && layer.raster.width) reader = rasterReader(layer, kind);
    else if (kind === "forecast") {
      const src = window.GeoIDLandslidePipeline?.exposureSource?.();
      if (!src) throw new Error("Run the landslide forecast first.");
      const step = Math.max(0, src.step());
      let fos;
      try { fos = src.fosAt(step); } finally { src.restore(); }
      const [[w, s], , [e, n]] = src.ring;
      reader = { scheme: SCHEMES.landslide, read: gridValueAt(src.grid, fos, { mask: src.model }), extent: { west: w, south: s, east: e, north: n } };
    } else if (kind === "risk") {
      const feats = featuresOf(layer);
      const k = riskLayerKind(layer.name, feats[0]?.properties || {});
      const hazard = { cyclone: "Tropical cyclone", seismic: "Earthquake", volcanic: "Volcanic ashfall", risk: layer.name }[k];
      reader = polygonReader(feats, (p) => (p ? (num(p.p_yr) ?? 0) : null), chanceScheme(hazard, "Annual chance of reaching here"));
    } else if (kind === "zones") {
      const feats = [...featuresOf(layer)].sort((a, b) => Number(a.properties.zone) - Number(b.properties.zone));
      reader = polygonReader(feats, (p) => (p ? Number(p.zone) : -1), VOLCANIC_ZONE_SCHEME);
    } else if (kind === "wind") {
      if (!within) throw new Error("Storm tracks cover the oceans: choose an area under Within to read them for.");
      const box = ringsBox(areaFor(within).polys);
      const lookup = windLookup(featuresOf(layer), box, { reachKm: 200 });
      reader = { scheme: SCHEMES.wind, read: (lon, lat) => lookup.at(lon, lat), extent: box };
    } else {
      reader = polygonReader(featuresOf(layer), (p) => (p ? 1 : null), INSIDE_SCHEME);
    }
  }
  reader.label = choice.label;
  if (within) {
    const area = areaFor(within);
    const inner = reader.read;
    reader.read = (lon, lat) => (insideAny(lon, lat, area.polys) ? inner(lon, lat) : null);
    const b = ringsBox(area.polys);
    const e = reader.extent;
    reader.extent = e ? { west: Math.max(e.west, b.west), east: Math.min(e.east, b.east), south: Math.max(e.south, b.south), north: Math.min(e.north, b.north) } : b;
    reader.area = area.label || "the study area";
  }
  return reader;
}

/* ── reading ────────────────────────────────────────────────────────────── */

/**
 * Infrastructure inside a footprint. `footprint` is a choice value
 * ("layer:<id>", "drawn") or a phrase; `within` an area choice or null.
 */
export async function assess({ footprint, within = null, top = 25 } = {}) {
  const choices = footprintChoices();
  const choice = choices.find((c) => c.value === footprint) || matchFootprint(footprint, choices);
  if (!choice) throw new Error("There is no hazard map or area on the globe to read. Develop a hazard map, or draw an area.");
  const reader = readerFor(choice, within || null);
  const sources = await infrastructureSources();
  const results = sources.map((s) => exposeSource(s, reader.read, reader.scheme, { extent: reader.extent }));
  const summary = summarise(results, reader.scheme, { hazard: choice.label, area: reader.area || "", top });
  summary.extent = reader.extent;
  summary.read = sources.map((s) => ({ id: s.id, plural: s.plural, onGlobe: s.onGlobe }));
  // What was NOT read, by what it is rather than by row: "roads" once, not the
  // global roads and the live roads as two long labels.
  summary.notRead = [...new Set(infrastructureEntries().filter((e) => !sources.some((s) => s.id === e.id))
    .map((e) => (PLURALS[e.id]?.[1] || `${e.featureNoun}s`).toLowerCase()))];
  summary.text = describe(summary);
  return summary;
}

/**
 * Fetch the live structures over a footprint, so they are read with it:
 * bridges where the box is small enough to ask for, buildings where it is a
 * district. Says what it skipped and why.
 */
export async function fetchStructures(extent, { bridges = true, buildings = false, onStatus = say } = {}) {
  if (!extent) return [];
  const bbox = { minLon: extent.west, minLat: extent.south, maxLon: extent.east, maxLat: extent.north };
  const span = boxSpanDeg(bbox);
  const notes = [];
  const want = [];
  if (bridges) {
    if (span <= BRIDGE_TIERS[BRIDGE_TIERS.length - 1].maxSpan) want.push("conn-osm-bridges");
    else notes.push(`bridges: the footprint is ${span.toFixed(1)}° across, too wide to ask OpenStreetMap for`);
  }
  if (buildings) {
    if (span <= BUILDING_MAX_SPAN) want.push("conn-osm-buildings");
    else notes.push(`buildings: fetched over a district only (under ${BUILDING_MAX_SPAN}°); this footprint is ${span.toFixed(2)}°`);
  }
  for (const id of want) {
    /**
     * A LIVE LAYER FETCHED FOR ANOTHER PLACE is not this footprint's: bridges
     * over Pittsburgh on the globe would otherwise stop Houston's being asked
     * for, and the reading would say "no bridges" over a city of thousands.
     * The live rows follow the area by design, so it is replaced, and said.
     */
    const have = layerForDataset(id);
    if (have) {
      const feats = featuresOf(have);
      const boxes = feats.map(featureBox).filter(Boolean);
      const covers = boxes.length && Math.min(...boxes.map((b) => b.west)) <= extent.west + 0.05
        && Math.max(...boxes.map((b) => b.east)) >= extent.east - 0.05
        && Math.min(...boxes.map((b) => b.south)) <= extent.south + 0.05
        && Math.max(...boxes.map((b) => b.north)) >= extent.north - 0.05;
      if (covers) continue;
      window.GeoIDImportManager?.removeLayer?.(have.id);
      notes.push(`${datasetLabel(id)} on the globe was for another area, so it was fetched again over this footprint`);
    }
    const out = await addDataset(id, onStatus, { bbox });
    if (!out.ok) notes.push(out.message);
  }
  return notes;
}

/**
 * The one call Atlas makes: a phrase in, a paragraph out. Bridges (and
 * buildings, if asked) are fetched over the footprint first when they are
 * small enough to ask for.
 */
export async function ask({ hazard = "", area = "", bridges = false, buildings = false, onStatus = () => {} } = {}) {
  const choices = footprintChoices();
  const choice = matchFootprint(hazard || area, choices);
  if (!choice) {
    return {
      text: hazard
        ? `There is no ${hazard} map on the globe to read. ${choices.length ? `On the globe now: ${choices.map((c) => c.label).join("; ")}.` : "Develop one (Hazards), or draw an area."}`
        : "There is no hazard map or drawn area on the globe to read infrastructure against. Develop a hazard map in Hazards, or draw an area.",
      summary: null,
    };
  }
  const within = area && choice.kind !== "area" && /\b(drawn|study area|this area|my area)\b/i.test(area) ? "drawn" : null;
  let notes = [];
  if (bridges || buildings) {
    onStatus("Fetching structures over the footprint…");
    notes = await fetchStructures(readerFor(choice, within).extent, { bridges, buildings, onStatus });
  }
  onStatus("Reading infrastructure inside the footprint…");
  const summary = await assess({ footprint: choice.value, within });
  state.summary = summary;
  render(summary);
  const missing = summary.notRead.length ? ` Counted when ticked on in Hazards ▸ Infrastructure: ${summary.notRead.join(", ")}.` : "";
  return { text: summary.text + missing + (notes.length ? ` (${notes.join("; ")}.)` : ""), summary };
}

/**
 * The camera over a point, through the spin and the tilt group so it lands on
 * the ground the markers stand on -- social-bridge.js's flight, which is the
 * viewer's own `flyCameraTo` given a direction. The viewer has no lat/lon
 * flight of its own.
 */
export function flyToPoint(lat, lon, altMetres = 60000) {
  const viewer = window.GeoIDViewer;
  if (!viewer?.camera) return false;
  const dir = latLonToVector3(lat, lon, 1);
  const spin = viewer.getSpinDeltaRadians?.();
  if (Number.isFinite(spin)) dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), spin);
  const group = viewer.earthSceneGroup || null;
  if (group) {
    group.updateMatrixWorld(true);
    dir.applyMatrix4(new THREE.Matrix4().extractRotation(group.matrixWorld));
  }
  const end = dir.normalize().multiplyScalar(viewer.camera.position.length());
  const settle = () => viewer.setZoomAltitudeMetres?.(altMetres);
  if (typeof viewer.flyCameraTo === "function" && viewer.flyCameraTo(end, { onComplete: settle })) return true;
  viewer.camera.position.copy(end);
  viewer.controls?.update?.();
  settle();
  return true;
}

/* ── the readout ────────────────────────────────────────────────────────── */

const state = { summary: null };

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => { if (v != null && v !== false) n.setAttribute(k, v); });
  children.flat().forEach((c) => { if (c != null && c !== "") n.append(c instanceof Node ? c : document.createTextNode(String(c))); });
  return n;
}

const fmt = (n) => Math.round(n).toLocaleString("en-GB");

function render(summary) {
  const host = byId("infra-result");
  if (!host) return;
  const { scheme } = summary;
  const rows = [];
  rows.push(el("p", { class: "compact-copy", style: "margin:0.35rem 0 0.25rem;" }, summary.text));
  // By layer, by class: one row per source that has anything inside.
  const table = el("table", { class: "infra-table", style: "width:100%;border-collapse:collapse;font-size:0.78rem;" });
  const head = el("tr", {}, el("th", { style: "text-align:left;padding:2px 4px;" }, "Layer"),
    ...scheme.classes.map((c, k) => el("th", { title: `${c.label} (${c.threshold})`, style: "padding:2px 4px;text-align:right;" },
      el("span", { style: `display:inline-block;width:0.65rem;height:0.65rem;border-radius:2px;background:${classColour(scheme, k)};` }))));
  table.append(head);
  for (const s of summary.sources) {
    const km = s.km ? s.km.reduce((a, b) => a + b, 0) : 0;
    if (!s.total && km < 0.05) continue;
    table.append(el("tr", {},
      el("td", { style: "padding:2px 4px;" }, s.plural),
      ...scheme.classes.map((c, k) => el("td", { style: "padding:2px 4px;text-align:right;" },
        s.count[k] ? fmt(s.count[k]) : "–", s.km?.[k] >= 0.05 ? el("span", { style: "opacity:0.7;" }, ` · ${fmt(s.km[k])} km`) : ""))));
  }
  if (table.rows.length > 1) rows.push(table);
  if (summary.top.length) {
    const list = el("ol", { class: "infra-list", style: "margin:0.4rem 0 0;padding-left:1.1rem;font-size:0.8rem;" });
    for (const i of summary.top) {
      const item = el("li", { style: "cursor:pointer;margin:1px 0;", title: "Fly there" },
        el("span", { style: `display:inline-block;width:0.6rem;height:0.6rem;border-radius:50%;margin-right:0.3rem;background:${classColour(scheme, i.k)};` }),
        el("strong", {}, i.name || i.type), i.name ? ` — ${i.type}` : "",
        scheme.classes.length > 1 ? el("span", { style: "opacity:0.7;" }, ` · ${scheme.classes[i.k].label.split(" — ")[0]}`) : "");
      item.addEventListener("click", () => { if (i.at) flyToPoint(i.at[1], i.at[0]); });
      list.append(item);
    }
    rows.push(list);
    if (summary.total > summary.top.length) rows.push(el("p", { class: "compact-copy", style: "opacity:0.75;margin:0.2rem 0 0;" }, `…and ${fmt(summary.total - summary.top.length)} more in the CSV.`));
  }
  if (summary.notRead.length) {
    rows.push(el("p", { class: "compact-copy", style: "opacity:0.75;margin:0.3rem 0 0;" },
      `Counted when ticked on: ${summary.notRead.join(", ")}.`));
  }
  const csv = el("button", { type: "button", class: "button secondary" }, "Exposed infrastructure — CSV");
  csv.disabled = !summary.total;
  csv.addEventListener("click", () => void import(`./extraction.js${search}`)
    .then(({ downloadText }) => downloadText("geoid_infrastructure_exposed.csv", exposureCsv(summary), "text/csv")));
  rows.push(el("div", { class: "gis-btn-row" }, csv));
  host.replaceChildren(...rows);
}

function refreshFootprints() {
  const select = byId("infra-footprint");
  if (!select) return;
  const was = select.value;
  const choices = footprintChoices();
  const sig = choices.map((c) => `${c.value}|${c.label}`).join("\n");
  if (select.dataset.sig === sig && select.options.length) return;
  select.dataset.sig = sig;
  select.replaceChildren(...(choices.length ? choices : [{ value: "", label: "No hazard map or drawn area yet" }])
    .map((c) => el("option", { value: c.value }, c.label)));
  if (choices.some((c) => c.value === was)) select.value = was;
  else if (choices.length) select.value = matchFootprint("", choices).value;
  byId("infra-run").disabled = !choices.length;
}

async function run() {
  const btn = byId("infra-run");
  btn.disabled = true;
  try {
    const within = byId("infra-within").value || null;
    say("Reading infrastructure inside the footprint…");
    // What the fetch could not do is said AFTER the reading, not wiped by
    // it: a busy Overpass used to leave a count with no bridges and no word.
    let notes = [];
    if (byId("infra-bridges").checked) {
      const choice = footprintChoices().find((c) => c.value === byId("infra-footprint").value);
      if (choice) notes = await fetchStructures(readerFor(choice, within).extent, { bridges: true });
    }
    const summary = await assess({ footprint: byId("infra-footprint").value, within });
    state.summary = summary;
    render(summary);
    say(notes.join("; "));
  } catch (error) {
    say(`Could not read the infrastructure: ${error.message}`);
  } finally {
    btn.disabled = !footprintChoices().length;
  }
}

function build(host) {
  const footprint = el("select", { id: "infra-footprint", class: "input", "aria-label": "Footprint" });
  const within = el("select", { id: "infra-within", class: "input", "aria-label": "Within" });
  const bridges = el("input", { type: "checkbox", id: "infra-bridges" });
  const draw = el("button", { type: "button", class: "button secondary" }, "Draw an area");
  draw.addEventListener("click", () => { promptDrawTool(); say("Draw the area and press Done; it joins both lists."); });
  const go = el("button", { type: "button", id: "infra-run", class: "button" }, "What is inside?");
  go.addEventListener("click", () => void run());
  const clear = el("button", { type: "button", class: "button secondary" }, "Clear");
  clear.addEventListener("click", () => { state.summary = null; byId("infra-result").replaceChildren(); say(""); });
  const row = (label, control, title) => { const r = el("div", { class: "row", title }); r.append(el("label", { for: control.id }, label), control); return r; };
  host.replaceChildren(
    el("p", { class: "compact-copy", style: "margin:0.6rem 0 0.3rem;" },
      "Which cities, ports, airports, bridges, roads and railways stand inside a hazard footprint, worst first. Cities, ports and airports are always read; the rest when they are on the globe."),
    row("Footprint", footprint, "Every hazard map the risk reader reads, the Atlas ash deposit, any polygon layer, and the drawn area."),
    row("Within", within, "Cut the footprint to a study area — a global risk grid read for one coast."),
    el("div", { class: "row", title: "Fetch OpenStreetMap bridges over the footprint first (road and rail bridges over a region, every bridge over a town)." },
      el("label", { for: "infra-bridges" }, "Bridges"), el("span", {}, bridges, " fetch over the footprint")),
    el("div", { class: "gis-btn-row" }, go, draw, clear),
    el("p", { id: "infra-status", class: "compact-copy", "aria-live": "polite", style: "margin:0.25rem 0 0;opacity:0.8;" }),
    el("div", { id: "infra-result" }),
  );
  const refresh = () => {
    try { refreshPolygonOptions(within, within.value || "", { allLayers: true }); } catch { /* later */ }
    if (![...within.options].some((o) => o.value === "")) within.prepend(el("option", { value: "" }, "The whole footprint"));
    refreshFootprints();
  };
  refresh();
  within.value = "";
  window.addEventListener("geoid-gis:layers-changed", refresh);
  window.GeoIDImportManager?.onChange?.(refresh);
  setInterval(refreshFootprints, 3000);
}

function install() {
  const host = byId("infrastructure-exposure");
  if (!host || host.dataset.built) return false;
  host.dataset.built = "1";
  build(host);
  return true;
}

if (typeof window !== "undefined") {
  window.GeoIDInfrastructure = {
    assess, ask, footprintChoices, matchFootprint, fetchStructures, infrastructureSources,
    result: () => state.summary, flyToPoint,
  };
  let tries = 0;
  const attempt = () => { if (!install() && tries++ < 60) setTimeout(attempt, 250); };
  attempt();
}
