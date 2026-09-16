/**
 * The risk reader: people at risk, read off any risk map on the globe.
 *
 * A risk map says where and how badly; people are the other half of risk. This
 * module is the engine that every door onto that question uses — the risk
 * reader window (which assesses each map as it is developed), a layer's own
 * shield, and Hazards ▸ Exposure. It decides three things per map, and each is
 * read off the map rather than chosen by whoever asked:
 *
 *  1. WHAT KIND of map it is (`riskMapKind`): a factor of safety, a water
 *     depth, river corridor zones, an annual-chance grid (cyclone, seismic,
 *     volcanic), storm tracks, volcanic hazard buffers, the landslide forecast
 *     — or a raster whose direction is not known, which is banded by value and
 *     given no risk level.
 *  2. WHICH GROUND to read (`autoArea`): the drawn study area if there is one,
 *     else the last drawn polygon, else the map's own extent where the map is
 *     local (the forecast's area, a flood sheet built over a view), else it
 *     says so rather than reading a continent.
 *  3. HOW its numbers integrate against people (risk-assessment.js), with the
 *     map's own second readings where it carries them.
 *
 * WorldPop counts are cached per box, so a map that rebuilds — a flood sheet
 * refining as the view settles, a forecast stepping — is re-read against the
 * same people without a second range request.
 */

import {
  polygonsOf, polygonIndex, peopleOnGrid, polygonMask, cellKm2, boxOf,
} from "./exposure.js?v=20260916-74d3080";
import {
  SCHEMES, chanceScheme, bandScheme, schemeForLayerName, riskLayerKind, assessGrid, assessPopulation,
  groupByFeature, summarySentence, windLookup,
} from "./risk-assessment.js?v=20260916-74d3080";
import { resolvePolygonRings } from "./extent-picker.js?v=20260916-74d3080";

const search = new URL(import.meta.url).search;
const FORECAST_NAME = /^Landslide risk — forecast/;
const featuresOf = (l) => l?._allFeatures || l?.features || l?.collection?.features || [];

/* ── what kind of map ───────────────────────────────────────────────────── */

/**
 * `auto` is whether a map is read unasked when it is developed: a hazard map
 * is, a raster of something else (a DEM, soil thickness) is only on request.
 */
export function riskMapKind(layer) {
  if (!layer || layer.status !== "loaded") return null;
  const name = String(layer.name || "");
  if (/^Population density/.test(name)) return null;
  if (FORECAST_NAME.test(name) && window.GeoIDLandslidePipeline?.exposureSource?.()) return { kind: "forecast", auto: true, label: "Landslide forecast" };
  const feats = featuresOf(layer);
  if (layer.raster?.band && layer.raster.width) {
    if (/river corridor/i.test(name)) return { kind: "riverzones", auto: true, label: "River corridor zones" };
    const scheme = schemeForLayerName(name);
    if (scheme) return { kind: "grid", auto: true, label: scheme.hazard };
    return { kind: "bands", auto: false, label: "Value bands" };
  }
  if (feats.some((f) => Number.isFinite(Number(f?.properties?.p_yr)))) {
    return { kind: "risk", auto: true, label: { cyclone: "Tropical cyclone", seismic: "Earthquake", volcanic: "Volcanic ashfall", risk: "Annual chance" }[riskLayerKind(name, feats[0]?.properties || {})] };
  }
  if (feats.some((f) => Number.isFinite(Number(f?.properties?.zone)) && f?.properties?.outer_km !== undefined)) return { kind: "zones", auto: true, label: "Volcanic hazard zones" };
  if (feats.some((f) => Number(f?.properties?.peak_wind_kts) > 0)) return { kind: "wind", auto: true, label: "Storm tracks" };
  return null;
}

const isShown = (l) => l.visible !== false && l.object3D?.visible !== false;

/**
 * Every map on the globe the reader can read, in the order they were added.
 * Hidden ones too, flagged: a reading is kept while its map is switched off.
 */
export function riskMaps({ hidden = false } = {}) {
  return (window.GeoIDImportManager?.getLayers?.() || [])
    .map((layer) => ({ layer, visible: isShown(layer), ...(riskMapKind(layer) || {}) }))
    .filter((m) => m.kind && (hidden || m.visible));
}

/* ── one tab per hazard, and the frame on screen ────────────────────────── */

const specs = () => Object.entries(globalThis.__geoidRiskSpecs || {});

/**
 * WHICH HAZARD a layer is, as one key per tab. Several layers can be one map:
 * the cyclone risk grid and the estimate sheet that stands in for it; a
 * seismic or volcanic record and the frame plot the time-lapse draws over it.
 * Reading them as separate tabs showed one hazard twice.
 */
export function hazardKey(layer) {
  const name = String(layer?.name || "");
  if (FORECAST_NAME.test(name)) return "forecast";
  if (layer?.riskRecord) return `record:${layer.riskRecord}`;
  const spec = specs().find(([, sp]) => sp?.plotName === name || (sp?.name instanceof RegExp && sp.name.test(name)));
  if (spec) return `record:${spec[0]}`;
  if (/cyclone risk/i.test(name)) return "cyclone-risk";
  return `layer:${name}`;
}

/** What a tab is called: the hazard, not whichever layer happens to carry it. */
export function hazardTitle(key, layer, kindLabel) {
  if (key === "forecast") return "Landslide forecast";
  if (key === "cyclone-risk") return "Cyclone risk";
  if (key.startsWith("record:")) {
    const spec = globalThis.__geoidRiskSpecs?.[key.slice(7)];
    const name = spec?.plotName || layer?.name || "";
    return /seismic/i.test(name) ? "Seismic risk" : /full Holocene/i.test(name) ? "Volcanic risk (full record)" : /volcan/i.test(name) ? "Volcanic risk" : kindLabel || name;
  }
  return layer?.name || kindLabel || key;
}

/** The frame a layer is showing, in words, or null for a still map. */
export function frameLabelOf(layer, kind) {
  if (layer?.riskFrame?.label) return layer.riskFrame.last ? null : layer.riskFrame.label;
  if (layer?.riskRecord && layer.riskBand != null) {
    const spec = globalThis.__geoidRiskSpecs?.[layer.riskRecord];
    return spec?.bandLabel ? spec.bandLabel(layer.riskBand) : String(layer.riskBand);
  }
  if (kind === "forecast") {
    const src = window.GeoIDLandslidePipeline?.exposureSource?.();
    const t = src?.times?.[src.step()];
    return t ? `map of ${String(t).replace("T", " ")}` : null;
  }
  return null;
}

/**
 * Which member of a tab to read. A frame on screen beats the still map under
 * it; a shown layer beats a hidden one; a choice made in the tab beats both.
 */
export function readableMember(members, choice = "auto") {
  const list = members.filter((m) => m.kind);
  if (choice !== "auto") {
    const picked = list.find((m) => String(m.layer.id) === String(choice));
    if (picked) return picked;
  }
  const framed = (m) => Boolean(m.layer.riskFrame || m.layer.riskRecord);
  return list.find((m) => m.visible && framed(m)) || list.find((m) => m.visible) || list[list.length - 1] || null;
}

const boxesMeet = (a, b) => a && b && !(a.east < b.west || a.west > b.east || a.north < b.south || a.south > b.north);

/**
 * WHICH TAB TO FOLLOW, as a rule a reader can predict:
 *
 *  1. the tab chosen by hand, until something else is touched;
 *  2. the SHOWN map touched last, while the touch is recent — ticked on, its
 *     row or legend card opened, one of its features clicked, its reading
 *     changed, its frame stepped;
 *  3. else the top shown map in the draw order whose study area is in view;
 *  4. else the most severe shown map;
 *  5. else, nothing being shown, the map touched last.
 *
 * `tabs`: [{ key, hidden, touchedAt, touchedHow, order, areaBox, severity }].
 */
export function chooseFollowed(tabs, { explicitKey = null, viewBox = null, now = null, freshMs = 0 } = {}) {
  if (!tabs.length) return { tab: null, why: "" };
  const chosen = explicitKey && tabs.find((t) => t.key === explicitKey);
  if (chosen) return { tab: chosen, why: "chosen" };
  const shown = tabs.filter((t) => !t.hidden);
  // A touch is followed while it is recent: after that the camera decides again.
  const fresh = (t) => t.touchedAt > 0 && (!freshMs || now === null || now - t.touchedAt <= freshMs);
  const touched = shown.filter(fresh).sort((a, b) => b.touchedAt - a.touchedAt)[0];
  if (touched) return { tab: touched, why: touched.touchedHow || "touched" };
  const inView = viewBox ? shown.filter((t) => boxesMeet(t.areaBox, viewBox)) : shown;
  const top = [...inView].sort((a, b) => (b.order ?? -Infinity) - (a.order ?? -Infinity))[0];
  if (top && viewBox) return { tab: top, why: "top" };
  const severe = [...shown].sort((a, b) => (b.severity ?? -1) - (a.severity ?? -1))[0];
  if (severe) return { tab: severe, why: "severe" };
  const last = [...tabs].sort((a, b) => (b.touchedAt || 0) - (a.touchedAt || 0))[0];
  return { tab: last, why: "hidden" };
}

/** The reason in words, for the "Following" line. */
export const FOLLOW_REASONS = {
  chosen: "chosen here",
  new: "just developed",
  shown: "switched on",
  workspace: "opened in Workspace",
  legend: "opened in the legend",
  card: "a feature clicked",
  reading: "its reading changed",
  frame: "its frame stepped",
  drawer: "opened for it",
  top: "the top map in view",
  severe: "the most severe map shown",
  hidden: "hidden on the globe",
  touched: "last touched",
};

/* ── which ground ───────────────────────────────────────────────────────── */

const unwrap = (x) => (x > 180 ? x - 360 : x);

function areaFromRings(got) {
  const fc = got.maskFc || { type: "FeatureCollection", features: got.rings.map((r) => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [r.vertices.map((v) => [unwrap(v.lon), v.lat])] } })) };
  const polys = polygonsOf(fc).map((p) => ({ ...p, coords: p.coords.map((ring) => ring.map(([x, y]) => [unwrap(x), y])) }));
  polys.forEach((p) => {
    let w = Infinity; let e = -Infinity; let s = Infinity; let n = -Infinity;
    for (const [x, y] of p.coords[0]) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
    p.box = { west: w, east: e, south: s, north: n };
  });
  return polys.length ? { label: got.label, polys, layerId: got.layerId || null } : null;
}

function boxArea(box, label) {
  const ring = [[box.west, box.south], [box.east, box.south], [box.east, box.north], [box.west, box.north], [box.west, box.south]];
  const polys = polygonsOf({ features: [{ type: "Feature", properties: { name: label }, geometry: { type: "Polygon", coordinates: [ring] } }] });
  return { label, polys, own: true };
}

/** An explicitly chosen area: "drawn", or "layer:<id>". */
export function areaFor(choice) {
  const got = resolvePolygonRings(choice, { arm: false });
  if (!got || got.error) throw new Error(got?.error || "Pick a study area first.");
  const area = areaFromRings(got);
  if (!area) throw new Error("That area holds no polygon.");
  return area;
}

/** The largest map extent read as "its own area" when nothing is drawn. */
export const OWN_EXTENT_MAX_DEG = 6;
/** The widest VIEW read as the area when nothing is drawn and the map is not local. */
export const VIEW_EXTENT_MAX_DEG = 15;

/**
 * The ground a map is read over when nobody has chosen: what was drawn, else
 * the forecast's own box, else the map's own area where the map is local,
 * ELSE THE VIEW. Exposure is estimated for every risk map, unasked — that is
 * what makes it a property of the map rather than a button — so a global grid
 * with nothing drawn is read over the ground in view, and re-read as the view
 * settles somewhere else. A view wider than VIEW_EXTENT_MAX_DEG is a
 * continent, and a continent's people against a hazard grid is not a study:
 * null, and the reader says to zoom in or draw.
 */
export function autoArea(layer, kind, { viewBox = null } = {}) {
  const drawn = resolvePolygonRings("drawn", { arm: false });
  if (drawn && !drawn.error) {
    const area = areaFromRings(drawn);
    if (area) return area;
  }
  if (kind === "forecast") {
    const src = window.GeoIDLandslidePipeline?.exposureSource?.();
    if (src) {
      const [[w, s], , [e, n]] = src.ring;
      return boxArea({ west: w, south: s, east: e, north: n }, "the forecast's area");
    }
  }
  const b = boxOf(layer?.raster?.bounds || layer?.bounds);
  if (b && b.east - b.west <= OWN_EXTENT_MAX_DEG && b.north - b.south <= OWN_EXTENT_MAX_DEG) return boxArea(b, "the map's own extent");
  const v = viewArea(viewBox);
  if (v) return v;
  return null;
}

/**
 * The view as an area; null where it is too wide or unknown. Two spellings,
 * because the window keeps `{west, east, south, north}` and `chooseFollowed`
 * takes `[minLon, maxLon, minLat, maxLat]` — the fourth box vocabulary in
 * this tree, met again: the first version read the array alone and the
 * view never counted.
 */
export function viewArea(viewBox) {
  let w; let e; let s; let n;
  if (Array.isArray(viewBox)) { if (viewBox.length !== 4) return null; [w, e, s, n] = viewBox; }
  else if (viewBox && typeof viewBox === "object") ({ west: w, east: e, south: s, north: n } = viewBox);
  else return null;
  if (![w, e, s, n].every(Number.isFinite)) return null;
  if (!(e > w) || !(n > s) || e - w > VIEW_EXTENT_MAX_DEG || n - s > VIEW_EXTENT_MAX_DEG) return null;
  const area = boxArea({ west: w, south: s, east: e, north: n }, "the ground in view");
  area.fromView = true;
  return area;
}

/* ── people ─────────────────────────────────────────────────────────────── */

const popCache = new Map();

export function ringsBox(polys) {
  let w = Infinity; let e = -Infinity; let s = Infinity; let n = -Infinity;
  for (const p of polys) { w = Math.min(w, p.box.west); e = Math.max(e, p.box.east); s = Math.min(s, p.box.south); n = Math.max(n, p.box.north); }
  return { west: w, east: e, south: s, north: n };
}

/** WorldPop counts under a box, cached: a rebuilding map is read against the same people. */
export async function countsUnder(box) {
  const key = [box.west, box.south, box.east, box.north].map((v) => v.toFixed(4)).join(",");
  if (popCache.has(key)) return popCache.get(key);
  const { readCounts } = await import(`./worldpop.js${search}`);
  const pad = 1 / 120;
  const want = { west: box.west - pad, east: box.east + pad, south: box.south - pad, north: box.north + pad };
  // Once more on failure: the first range request against a cold bucket can fail.
  const read = await readCounts(want).catch(() => new Promise((r) => setTimeout(r, 800)).then(() => readCounts(want)));
  if (!read) throw new Error("WorldPop has no data under that area.");
  popCache.set(key, read);
  while (popCache.size > 6) popCache.delete(popCache.keys().next().value);
  return read;
}

/** People inside the polygons on population cells the hazard grid does not reach. */
function offGrid(pop, gb, polys) {
  const popMask = polygonMask({ width: pop.width, height: pop.height, bounds: pop.bounds }, polys);
  const pdx = (pop.bounds.east - pop.bounds.west) / pop.width; const pdy = (pop.bounds.north - pop.bounds.south) / pop.height;
  let people = 0; let areaKm2 = 0;
  for (let y = 0; y < pop.height; y += 1) {
    const lat = pop.bounds.north - (y + 0.5) * pdy;
    const km2 = cellKm2(pdx, pdy, lat);
    for (let x = 0; x < pop.width; x += 1) {
      const i = y * pop.width + x;
      if (!popMask[i]) continue;
      const lon = pop.bounds.west + (x + 0.5) * pdx;
      if (lon >= gb.west && lon <= gb.east && lat >= gb.south && lat <= gb.north) continue;
      const v = pop.band[i];
      if (Number.isFinite(v) && v > 0 && v < 1e30) people += v;
      areaKm2 += km2;
    }
  }
  return { people, areaKm2 };
}

const sourceOf = (layer) => [layer?.metadata?.source, layer?.metadata?.citation || layer?.info?.citation].filter(Boolean).join(" · ") || null;

/* ── the integrations ───────────────────────────────────────────────────── */

/** River corridor zones: the band holds the zone id (1 margin, 2 belt, 3 floodplain). */
export const RIVER_ZONE_SCHEME = {
  id: "riverzones", hazard: "River", measure: "River corridor zone", unit: "",
  definition: "Zones measured from the mean-flow water edge in multiples of the channel's own width (GRWL): the seasonal margin wets most years, the migration belt is where the channel moves, the floodplain is low ground within 5 m of the channel.",
  classes: [
    { level: "Very high", label: "Seasonal margin", threshold: "max(10 m, ¼ W) from the bank", test: (v) => v === 1 },
    { level: "High", label: "Migration belt", threshold: "3 W from the bank", test: (v) => v === 2 },
    { level: "Moderate", label: "Floodplain", threshold: "10 W, ≤ 5 m above the channel", test: (v) => v === 3 },
  ],
  notExposed: (v) => !(v >= 1 && v <= 3),
};

/** Volcanic hazard buffers: zone 0 (0–5 km) worst, zone 4 (35–50 km) least. */
export const VOLCANIC_ZONE_SCHEME = {
  id: "volcanicZones", hazard: "Volcanic", measure: "Distance zone from a vent", unit: "km",
  definition: "Schematic hazard zones round every Holocene volcano, after Etna Explorer's INGV-based bands. A distance ring, not a model: where a volcano's zones overlap the worst zone reaching a place is counted.",
  classes: [
    { level: "Very high", label: "Extreme Risk", threshold: "0–5 km", test: (v) => v === 0 },
    { level: "High", label: "Very High Risk", threshold: "5–10 km", test: (v) => v === 1 },
    { level: "Moderate", label: "High Risk", threshold: "10–20 km", test: (v) => v === 2 },
    { level: "Low", label: "Moderate Risk", threshold: "20–35 km", test: (v) => v === 3 },
    { level: "Very low", label: "Low Risk", threshold: "35–50 km", test: (v) => v === 4 },
  ],
  notExposed: (v) => v < 0,
};

async function gridBreakdowns(layer, area, scheme, { values = null, grid = null, mask0 = null, noData = null } = {}) {
  const r = layer?.raster;
  const g = grid || { width: r.width, height: r.height, bounds: r.bounds };
  const band = values || r.band;
  const gb = boxOf(g.bounds);
  const pop = await countsUnder(ringsBox(area.polys));
  const people = peopleOnGrid(pop, g);
  const maskOf = (polys) => {
    const m = polygonMask(g, polys);
    if (mask0) for (let i = 0; i < m.length; i += 1) if (!mask0[i]) m[i] = 0;
    return m;
  };
  const run = (polys, m) => assessGrid({ people, values: band, mask: m, width: g.width, height: g.height, bounds: g.bounds, scheme, noData, outside: offGrid(pop, gb, polys) });
  const mask = maskOf(area.polys);
  const main = run(area.polys, mask);
  const { groups, truncated } = groupByFeature(area.polys);
  const byPolygon = groups.length > 1 ? groups.map((q) => ({ name: q.name, breakdown: run(q.polys, maskOf(q.polys)) })) : [];
  return { main, byPolygon, truncated, pop, people, mask, run, maskOf };
}

async function assessRaster(layer, area, kind) {
  const r = layer.raster;
  let scheme = kind === "riverzones" ? RIVER_ZONE_SCHEME : schemeForLayerName(layer.name);
  if (!scheme) {
    const grid = { width: r.width, height: r.height, bounds: r.bounds };
    const mask = polygonMask(grid, area.polys);
    let lo = Infinity; let hi = -Infinity;
    for (let i = 0; i < mask.length; i += 1) {
      if (!mask[i]) continue;
      const v = r.band[i];
      if (!Number.isFinite(v) || v <= -1e30 || (r.noData != null && v === r.noData)) continue;
      if (v < lo) lo = v; if (v > hi) hi = v;
    }
    scheme = bandScheme(lo, hi, { measure: r.unit ? `Value (${r.unit})` : "Value", unit: r.unit || "", hazard: layer.name });
  }
  // A FLOOD SHEET AND THE RIVER ZONES WRITE NO-DATA FOR "NOTHING HERE": dry
  // ground, no zone. Inside the sheet that is a reading of zero -- not
  // exposed -- and only ground off the sheet is no reading. Read as no-data,
  // everyone on dry land would be reported as unmapped.
  const dryIsZero = scheme === SCHEMES.flood || scheme === RIVER_ZONE_SCHEME;
  let values = r.band;
  if (dryIsZero) {
    values = Float32Array.from(r.band, (v) => (!Number.isFinite(v) || v <= -1e30 || (r.noData != null && v === r.noData) ? 0 : v));
  }
  const g = await gridBreakdowns(layer, area, scheme, { values, noData: dryIsZero ? null : r.noData ?? null });
  return { breakdowns: [g.main], byPolygon: g.byPolygon, truncated: g.truncated, hazard: scheme.bands ? layer.name : scheme.hazard, layer: layer.name, source: sourceOf(layer) };
}

function trackFeatures() {
  const layers = window.GeoIDImportManager?.getLayers?.() || [];
  const tracks = layers.find((l) => l.status === "loaded" && featuresOf(l).some((f) => Number(f?.properties?.peak_wind_kts) > 0));
  return tracks ? featuresOf(tracks) : null;
}

function populationBreakdowns(pop, area, schemes) {
  const breakdowns = assessPopulation({ pop, polys: area.polys, schemes });
  const { groups, truncated } = groupByFeature(area.polys);
  const byPolygon = groups.length > 1 ? groups.map((g) => ({ name: g.name, breakdown: assessPopulation({ pop, polys: g.polys, schemes: [schemes[0]] })[0] })) : [];
  return { breakdowns, byPolygon, truncated };
}

function nearIndex(feats, box, pad = 0) {
  const near = feats.filter((f) => {
    const b = polygonsOf({ features: [f] })[0]?.box;
    return b && !(b.east < box.west - pad || b.west > box.east + pad || b.north < box.south - pad || b.south > box.north + pad);
  });
  return { near, index: polygonIndex(polygonsOf({ features: near }), { bucketDeg: 0.5 }) };
}

async function assessRisk(layer, area) {
  const box = ringsBox(area.polys);
  const pop = await countsUnder(box);
  const { near, index } = nearIndex(featuresOf(layer), box);
  const propsAt = (lon, lat) => index.at(lon, lat)?.feature?.properties || null;
  const kind = riskLayerKind(layer.name, near[0]?.properties || {});
  const hazard = { cyclone: "Tropical cyclone", seismic: "Earthquake", volcanic: "Volcanic ashfall", risk: layer.name }[kind];
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const frame = layer.riskFrame?.values && !layer.riskFrame.last ? layer.riskFrame : null;
  const frameName = frameLabelOf(layer, "risk");
  const schemes = [{
    scheme: chanceScheme(hazard, `${kind === "cyclone" ? "Annual chance of a storm within 200 km" : "Annual chance of reaching here"}${frameName ? ` — ${frameName}` : ""}`),
    // THE FRAME ON SCREEN, where the layer is drawing one: a byte a cell over
    // the world, p = v / 255. The full-record grid answers otherwise.
    valueAt: frame
      ? (lon, lat) => {
        const col = Math.min(frame.width - 1, Math.max(0, Math.floor(((lon + 180) / 360) * frame.width)));
        const row = Math.min(frame.height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * frame.height)));
        return frame.values[row * frame.width + col] / frame.scale;
      }
      : (lon, lat) => { const p = propsAt(lon, lat); return p ? (num(p.p_yr) ?? 0) : null; },
  }];
  let note = frame ? `The first reading is the frame on screen (${frame.label}); the others are the full record 1980–2025.${frame.thin ? " So few seasons are mostly sampling noise." : ""}` : null;
  if (kind === "cyclone") {
    schemes.push({
      scheme: chanceScheme("Tropical cyclone", "Annual chance of hurricane-force winds (≥ 64 kt) within 200 km",
        "The chance in any one year that a storm at hurricane force (one-minute sustained wind of 64 kt, 119 km/h, or more) passes within 200 km."),
      valueAt: (lon, lat) => { const p = propsAt(lon, lat); return p ? (num(p.p_hur_yr) ?? 0) : null; },
    });
    const tracks = trackFeatures();
    if (tracks) {
      const lookup = windLookup(tracks, box, { reachKm: 200 });
      schemes.push({ scheme: SCHEMES.wind, valueAt: (lon, lat) => lookup.at(lon, lat) });
    } else note = [note, "Tick Tropical cyclone tracks on to add the strongest storm on record, by wind speed."].filter(Boolean).join(" ");
  }
  if (kind === "seismic") schemes.push({ scheme: SCHEMES.magnitude, valueAt: (lon, lat) => { const p = propsAt(lon, lat); return p ? (p.none ? 0 : num(p.mag_max) ?? 0) : null; } });
  if (kind === "volcanic") schemes.push({ scheme: SCHEMES.vei, valueAt: (lon, lat) => { const p = propsAt(lon, lat); return p ? ((p.none || !(num(p.p_yr) > 0)) ? -1 : num(p.vei_max) ?? -1) : null; } });
  return { ...populationBreakdowns(pop, area, schemes), hazard, layer: layer.name, source: sourceOf(layer), hazardNote: note };
}

async function assessZones(layer, area) {
  const box = ringsBox(area.polys);
  const pop = await countsUnder(box);
  // Zones sorted innermost first, so the first polygon holding a point is the worst zone there.
  const feats = [...featuresOf(layer)].sort((a, b) => Number(a.properties.zone) - Number(b.properties.zone));
  const { index } = nearIndex(feats, box, 0.5);
  const schemes = [{ scheme: VOLCANIC_ZONE_SCHEME, valueAt: (lon, lat) => { const p = index.at(lon, lat)?.feature?.properties; return p ? Number(p.zone) : -1; } }];
  return { ...populationBreakdowns(pop, area, schemes), hazard: "Volcanic", layer: layer.name, source: sourceOf(layer) };
}

async function assessTracks(layer, area) {
  const box = ringsBox(area.polys);
  const pop = await countsUnder(box);
  const lookup = windLookup(featuresOf(layer), box, { reachKm: 200 });
  const schemes = [{ scheme: SCHEMES.wind, valueAt: (lon, lat) => lookup.at(lon, lat) }];
  const out = assessPopulation({ pop, polys: area.polys, schemes });
  const { groups, truncated } = groupByFeature(area.polys);
  const byPolygon = groups.length > 1 ? groups.map((g) => ({ name: g.name, breakdown: assessPopulation({ pop, polys: g.polys, schemes })[0] })) : [];
  return { breakdowns: out, byPolygon, truncated, hazard: "Tropical cyclone", layer: layer.name, source: sourceOf(layer),
    hazardNote: `${lookup.segments.toLocaleString("en-GB")} track segments within 200 km of the area.` };
}

/**
 * The forecast at the map on screen AND at its worst over the window: the
 * factor of safety moves map by map, and a reader wants both "now" and "at
 * worst". The time series stays in Hazards ▸ Exposure.
 */
async function assessForecast(area) {
  const src = window.GeoIDLandslidePipeline?.exposureSource?.();
  if (!src) throw new Error("Run the landslide forecast first.");
  const step = Math.max(0, src.step());
  let now;
  try { now = src.fosAt(step); } finally { src.restore(); }
  const time = String(src.times[step] ?? "").replace("T", " ");
  const at = await gridBreakdowns(null, area, { ...SCHEMES.landslide, measure: `Factor of safety at ${time || "this map"}` }, { values: now, grid: src.grid, mask0: src.model });
  const worst = assessGrid({ people: at.people, values: src.minFos, mask: at.mask, width: src.grid.width, height: src.grid.height, bounds: src.grid.bounds, scheme: { ...SCHEMES.landslide, measure: `Lowest factor of safety over ${src.times.length} maps` } });
  return { breakdowns: [at.main, worst], byPolygon: at.byPolygon, truncated: at.truncated, hazard: "Landslide", layer: src.label,
    source: "GeoID landslide forecast (static hydrogeological model)", hazardNote: `Map ${step + 1} of ${src.times.length}; the second reading is each cell's lowest factor of safety over the whole window.`, step };
}

/** A finished assessment object, as the view, the CSV and the report read it. */
export function assessmentOf(r, area) {
  const now = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  const localDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const { groups } = groupByFeature(area.polys);
  const shareOf = (b) => (b && b.total > 0 ? b.veryHighHigh / b.total : null);
  const mapGroups = groups.map((g, k) => ({
    name: g.name, rings: g.polys.map((q) => q.coords[0]),
    value: shareOf(groups.length > 1 ? r.byPolygon?.[k]?.breakdown : r.breakdowns[0]),
  }));
  const a = {
    area: area.label || "the study area",
    layer: r.layer, hazard: r.hazard, source: r.source, hazardNote: r.hazardNote || null,
    generated: now.toISOString(),
    generatedHuman: now.toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" }),
    generatedDate: localDate,
    reference: `RA-${localDate.replace(/-/g, "")}-${pad(now.getHours())}${pad(now.getMinutes())}`,
    mapGroups,
    breakdowns: r.breakdowns, byPolygon: r.byPolygon || [], polygonsTruncated: r.truncated || 0,
    polygonCount: Math.max(1, groups.length),
    ownArea: Boolean(area.own),
  };
  a.summaryText = summarySentence(a);
  return a;
}

/**
 * Read one map over an area. `choice` is "auto" (the reader decides), "drawn",
 * or "layer:<id>". Returns { assessment, area, kind } or throws a sentence.
 */
export async function assessLayer(layer, choice = "auto", { viewBox = null } = {}) {
  const k = riskMapKind(layer);
  if (!k) throw new Error(`${layer?.name || "That layer"} is not a map the risk reader can read.`);
  const area = choice === "auto" ? autoArea(layer, k.kind, { viewBox }) : areaFor(choice);
  if (!area) throw new Error(`Draw a study area, or zoom in past ${VIEW_EXTENT_MAX_DEG}° of view, to read the people at risk on this map.`);
  const r = k.kind === "forecast" ? await assessForecast(area)
    : k.kind === "risk" ? await assessRisk(layer, area)
      : k.kind === "zones" ? await assessZones(layer, area)
        : k.kind === "wind" ? await assessTracks(layer, area)
          : await assessRaster(layer, area, k.kind);
  const assessment = assessmentOf(r, area);
  assessment.frame = frameLabelOf(layer, k.kind);
  return { assessment, area, kind: k.kind, step: r.step };
}
