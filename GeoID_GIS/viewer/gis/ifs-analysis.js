/**
 * ECMWF IFS analysis, 2011–2026, as a shaded sheet on the globe — the GFS
 * fields' sibling for the past: pick a variable and a time, see it over the
 * world, and the view or a drawn area gets the grid's own resolution.
 *
 * WHERE IT COMES FROM. Read keyless and directly from the browser: Beyond
 * Weather's Icechunk repository on the AWS Open Data registry answers CORS,
 * and `vendor/icechunk.js` (icechunk-js) turns "array, timestep" into the
 * one S3 object holding it. No sidecar, no Worker, no copy on R2 — the
 * archive is 1.3 TB, and a timestep is one global chunk anyway.
 *
 * WHAT A PULL COSTS (measured from here, us-east-2):
 * - opening the repository: the 80 KB `repo` file and an 8 KB snapshot, ~1 s,
 *   once a page;
 * - the first time of a variable: its ~0.5 MB chunk manifest, once a page;
 * - each time after that: one chunk, 0.05–0.36 MB for a surface field (two for
 *   a wind), ~0.2–0.6 s; ~7 MB for an upper-air field, whose 18 levels share
 *   one chunk, so 850 hPa costs the whole column.
 * The area asked for does NOT change the bytes — it changes the lattice the
 * reduced grid is regridded onto (`ifs-grid.js`): a degree over the world, the
 * grid's own ~0.28° over the view once it is less than a hemisphere, or over
 * a drawn area. That is the multi-resolution, and it is free after the chunk.
 *
 * LIMITS, said on the card and in the drawer: an ANALYSIS, not a reanalysis
 * (IFS upgrades in 2015, 2016 and 2023 show as steps; ERA5 is the record for
 * trends); no precipitation (an analysis holds no accumulations); bit-rounded
 * to a few mantissa bits per variable; N320 is coarser than the model's own
 * grid; ends 2026-09-30 18 UTC and is not updated.
 */

import * as THREE from "../vendor/three.module.js";
import {
  WORLD, sampleScalar, rampPalette, wrapLon, compassPoint, beaufort, isGlobal,
} from "./flow-field.js?v=20261024-3e1ba5c";
import { shadingMesh, disposeMesh, layerShown, currentViewBox } from "./flow-layer.js?v=20261024-3e1ba5c";
import { refreshPolygonOptions, resolvePolygonExtent } from "./extent-picker.js?v=20261024-3e1ba5c";
import {
  IFS_REPO, IFS_REGISTRY, IFS_CREDIT, IFS_VARIABLES, T0_MS, LAST_MS, STEP_MS, POINTS,
  timeIndex, reducedGrid, latticeFor, regrid, rangeOf, decodeBlosc, asFloat32, levelOffset, windFrom,
  featherWeight, underAlpha,
} from "./ifs-grid.js?v=20261024-3e1ba5c";

const LAYER_NAME = "ECMWF IFS analysis";
/** One opacity for the sheet wherever it is, patch or world (see `underAlpha`). */
const ALPHA = 0.55;
const STATUS_ID = "ifs-analysis-status";
const DRAWER_ID = "ifs-analysis-controls";
/** The whole sphere: the analysis has the poles, and so does the sheet. */
const EARTH = Object.freeze({ west: -180, east: 180, south: -90, north: 90 });

const byId = (id) => document.getElementById(id);
const manager = () => window.GeoIDImportManager;

export const settings = {
  variable: "t2m",
  timeMs: LAST_MS,
  // "view": the world, refined over the view; "world": the world alone;
  // "drawn" / "layer:<id>": that area alone, at the grid's own spacing.
  area: "view",
};

/** The one live layer and what it is drawing. */
let live = null;

function say(message) {
  const node = byId(STATUS_ID);
  if (node) node.textContent = message || "";
}

/* ── the repository ────────────────────────────────────────────────────── */

let opening = null;
let lib = null;

/** Open the repository once a page; a failure is forgotten so a retry can try again. */
function repo() {
  opening ??= (async () => {
    lib = await import(new URL("../vendor/icechunk.js", import.meta.url).href);
    const store = await lib.IcechunkStore.open(IFS_REPO);
    const pl = store.getMetadata("/2m_temperature")?.attributes?.GRIB_pl;
    if (!Array.isArray(pl)) throw new Error("the archive did not describe its grid");
    return { store, grid: reducedGrid(pl), snapshot: store.session?.getSnapshotId?.() || null };
  })();
  opening.catch(() => { opening = null; });
  return opening;
}

/**
 * One timestep of one array (one level of it, for an upper-air field), as the
 * flat reduced-grid Float32Array. Kept for the page, a handful at a time: the
 * slider back to a time already seen costs nothing.
 */
const chunks = new Map();
const CHUNK_CACHE = 8;

async function readChunk(array, index, level) {
  const key = `${array}|${index}|${level ?? ""}`;
  if (chunks.has(key)) return chunks.get(key);
  const { store } = await repo();
  const meta = store.getMetadata(`/${array}`);
  const upper = meta?.shape?.length === 3;
  const raw = await store.get(`/${array}/c/${index}/0${upper ? "/0" : ""}`);
  let values;
  if (!raw) {
    // Never written: the array's fill value, NaN, everywhere.
    values = new Float32Array(POINTS).fill(NaN);
  } else {
    const zstd = (src, size) => lib.zstdDecompress(src, new Uint8Array(size));
    const all = asFloat32(decodeBlosc(raw, { zstd }));
    // A copy of the one level, so the 39 MB column is not what the cache holds.
    values = upper ? all.slice(levelOffset(level), levelOffset(level) + POINTS) : all;
  }
  chunks.set(key, values);
  while (chunks.size > CHUNK_CACHE) chunks.delete(chunks.keys().next().value);
  return values;
}

/**
 * The chosen variable at the chosen time over a box, on the box's lattice:
 * a field `flow-field.js` samples like any of its own (`scalars.value`, and
 * `u`/`v` for a wind).
 */
async function fetchField(box) {
  const def = IFS_VARIABLES[settings.variable];
  const t = timeIndex(settings.timeMs);
  const { grid } = await repo();
  const parts = await Promise.all(def.arrays.map((a) => readChunk(a, t.index, def.level)));
  const { nx, ny, deg } = latticeFor(box);
  const scalars = {};
  if (parts.length === 2) {
    const u = regrid(grid, parts[0], box, nx, ny);
    const v = regrid(grid, parts[1], box, nx, ny);
    const speed = new Float32Array(u.length);
    for (let k = 0; k < u.length; k += 1) speed[k] = Math.hypot(u[k], v[k]);
    Object.assign(scalars, { value: speed, u, v });
  } else {
    scalars.value = regrid(grid, parts[0], box, nx, ny, def.convert || null);
  }
  const range = rangeOf(scalars.value);
  return {
    ...box, nx, ny, deg, global: isGlobal(box), scalars,
    time: t.iso, index: t.index, variable: settings.variable, ...range,
  };
}

/* ── drawing ───────────────────────────────────────────────────────────── */

function legend() {
  const def = IFS_VARIABLES[settings.variable];
  const t = timeIndex(settings.timeMs);
  return {
    label: `${def.label} — ${t.iso.replace("T", " ").replace(":00Z", " UTC")} (ECMWF IFS analysis)`,
    min: def.ramp[0][0], max: def.ramp.at(-1)[0], unit: def.unit, palette: rampPalette(def.ramp),
  };
}

function stack() {
  return [live?.area, live?.view, live?.world].filter(Boolean);
}

function rebuild() {
  if (!live?.group) return;
  disposeMesh(live.worldShade);
  disposeMesh(live.fineShade);
  live.worldShade = null;
  live.fineShade = null;
  const ramp = IFS_VARIABLES[settings.variable].ramp;
  const valueAt = (lat, lon) => sampleScalar(stack(), "value", lat, lon);
  const fine = live.area || live.view;
  /**
   * The patch fades in over its edge and the world sheet under it fades out
   * by exactly as much, so the two composite to ALPHA everywhere: no pale band
   * where they meet.
   */
  if (live.world) {
    const worldAlpha = fine
      ? (lat, lon) => underAlpha(ALPHA, featherWeight(fine, lat, lon))
      : ALPHA;
    live.worldShade = shadingMesh(EARTH, valueAt, ramp, worldAlpha);
    live.worldShade.userData.renderLift = 0;
    live.group.add(live.worldShade);
  }
  if (fine) {
    live.fineShade = shadingMesh(fine, valueAt, ramp, (lat, lon) => ALPHA * featherWeight(fine, lat, lon));
    live.fineShade.userData.renderLift = 0.25;
    live.group.add(live.fineShade);
  }
  if (live.layer) {
    live.layer.legendInfo = legend();
    live.layer.metadata = metadata();
    window.GeoIDLayerHierarchy?.render?.();
  }
  window.dispatchEvent(new CustomEvent("geoid-gis:layers-changed", { detail: { reason: "ifs" } }));
}

function km(deg) { return `${Math.round(deg * 111)} km`; }

function describe() {
  if (!live) return "";
  const def = IFS_VARIABLES[settings.variable];
  const field = live.area || live.view || live.world;
  if (!field) return "";
  const dp = def.unit === "m³/m³" ? 2 : def.unit === "dam" ? 0 : 1;
  return `${def.label} · ${field.time.replace("T", " ").replace(":00Z", " UTC")} · ~${km(field.deg)} lattice`
    + `${live.area ? ` over ${live.areaName || "the area"}` : ""} · `
    + `${field.min.toFixed(dp)}–${field.max.toFixed(dp)} ${def.unit}`;
}

function metadata() {
  const def = IFS_VARIABLES[settings.variable];
  const t = timeIndex(settings.timeMs);
  const field = live?.area || live?.view || live?.world;
  return {
    ...(live?.layer?.metadata || {}),
    format: "Icechunk Zarr v3 (N320 reduced Gaussian, Blosc-zstd, bit-rounded float32), "
      + `regridded bilinearly to a ${field ? field.deg.toFixed(2) : "1.00"}° lat/lon lattice`,
    source: `${IFS_REPO} · arrays ${def.arrays.join(" + ")}${def.level ? ` @ ${def.level} hPa` : ""}`
      + ` · timestep ${t.index} (${t.iso})${live?.snapshot ? ` · snapshot ${live.snapshot}` : ""}`,
    crs: "EPSG:4326",
    cellCount: field ? field.nx * field.ny : undefined,
    citation: `ECMWF IFS Analysis N320 - Beyond Weather Icechunk Zarr, Registry of Open Data on AWS, `
      + `${IFS_REGISTRY} (accessed ${new Date().toISOString().slice(0, 10)}). © ECMWF, CC BY 4.0.`,
  };
}

/* ── the area ──────────────────────────────────────────────────────────── */

/** The fine field the settings ask for: a drawn area, the view, or none. */
async function refreshFine() {
  if (!live) return;
  const ticket = (live.fineTicket = (live.fineTicket || 0) + 1);
  const mode = settings.area;
  let box = null;
  let name = null;
  if (mode === "view") {
    box = currentViewBox();
  } else if (mode !== "world") {
    const got = resolvePolygonExtent(mode);
    if (got?.error) { say(got.error); return; }
    if (got) {
      box = { west: got.west, east: got.east, south: got.south, north: got.north };
      name = got.reusedFrom || "the drawn area";
    }
  }
  try {
    const field = box ? await fetchField(box) : null;
    if (!live || ticket !== live.fineTicket) return;
    live.view = mode === "view" ? field : null;
    live.area = mode !== "view" && mode !== "world" ? field : null;
    live.areaName = name;
    rebuild();
    say(describe());
  } catch (error) {
    say(`The finer lattice did not arrive (${error.message}); drawing the world's.`);
  }
}

/** Follow the camera, as the GFS fields do: refine once the view settles. */
function watchView() {
  clearInterval(live?.viewTimer);
  if (!live) return;
  let was = null;
  live.viewTimer = setInterval(() => {
    if (!live || settings.area !== "view" || document.hidden || !layerShown(live.layer)) return;
    if (!(manager()?.getLayers?.() || []).includes(live.layer)) { stop(); return; }
    const box = currentViewBox();
    const key = box ? [box.west, box.east, box.south, box.north].map((x) => x.toFixed(1)).join() : "world";
    if (key === was) return;
    was = key;
    clearTimeout(live.refineTimer);
    live.refineTimer = setTimeout(() => { void refreshFine(); }, 900);
  }, 600);
}

/* ── adding and removing ───────────────────────────────────────────────── */

export async function add() {
  if (live?.layer) return live.layer;
  if (!manager()?.addDerivedLayer) throw new Error("the globe is not ready yet");
  say("Opening the ECMWF archive on AWS…");
  live = {};
  let world;
  try {
    const { snapshot } = await repo();
    live.snapshot = snapshot;
    say(`Reading ${IFS_VARIABLES[settings.variable].label.toLowerCase()} for the world…`);
    world = await fetchField(EARTH);
  } catch (error) {
    live = null;
    say("");
    throw new Error(`the ECMWF archive did not answer (${error.message}) — check the connection and try again`);
  }
  if (!live) throw new Error("cancelled");
  live.world = world;
  const group = new THREE.Group();
  group.name = LAYER_NAME;
  live.group = group;
  const layer = manager().addDerivedLayer(LAYER_NAME, {
    object3D: group,
    georeferenced: true,
    bounds: { minX: -180, maxX: 180, minY: -90, maxY: 90 },
    home: "weather",
    legendInfo: legend(),
    info: {
      source: IFS_CREDIT,
      summary: "ECMWF's operational analysis — the IFS model's best estimate of the atmosphere at "
        + "00, 06, 12 and 18 UTC, every day since 2011 — read from the open archive on AWS and "
        + "regridded from its N320 grid (~31 km). An analysis, not a reanalysis: model upgrades show "
        + "as steps, and there is no precipitation in it.",
    },
  }, "flow");
  if (!layer) { live = null; throw new Error("the globe would not take the layer"); }
  layer.groundPick = false;
  live.layer = layer;
  layer.metadata = metadata();
  rebuild();
  say(describe());
  watchView();
  void refreshFine();
  return layer;
}

function stop() {
  if (!live) return;
  clearInterval(live.viewTimer);
  clearTimeout(live.refineTimer);
  disposeMesh(live.worldShade);
  disposeMesh(live.fineShade);
  live = null;
}

export function remove() {
  const layer = live?.layer;
  stop();
  if (layer) manager()?.removeLayer?.(layer.id);
  say("");
}

export function layerOf() {
  const layer = live?.layer || null;
  return layer && (manager()?.getLayers?.() || []).includes(layer) ? layer : null;
}

/** Fetch again after a new variable or time; the world first, then the finer field. */
async function reload() {
  if (!live) return;
  const ticket = (live.reloadTicket = (live.reloadTicket || 0) + 1);
  const t = timeIndex(settings.timeMs);
  const def = IFS_VARIABLES[settings.variable];
  say(`Reading ${def.label.toLowerCase()} for ${t.iso.replace("T", " ").replace(":00Z", " UTC")}…`
    + (def.mb > 2 ? ` (~${def.mb} MB: all 18 levels share one chunk)` : ""));
  try {
    const world = await fetchField(EARTH);
    if (!live || ticket !== live.reloadTicket) return;
    live.world = world;
    live.view = null;
    live.area = null;
    rebuild();
    say(describe());
    void refreshFine();
  } catch (error) {
    say(`The ECMWF archive did not answer (${error.message}).`);
  }
}

/* ── reading it back ───────────────────────────────────────────────────── */

function valueText(def, v) {
  const dp = def.unit === "m³/m³" ? 2 : def.unit === "dam" ? 0 : 1;
  return `${v.toFixed(dp)} ${def.unit}`;
}

/** One line for the hover tag; null where the sheet has nothing. */
export function readAt(lat, lon) {
  if (!live?.layer || !layerShown(live.layer)) return null;
  const def = IFS_VARIABLES[settings.variable];
  const v = sampleScalar(stack(), "value", lat, lon);
  if (!Number.isFinite(v)) return null;
  let line = `IFS ${def.label}: ${valueText(def, v)}`;
  if (def.arrays.length === 2) {
    const w = windFrom(sampleScalar(stack(), "u", lat, lon), sampleScalar(stack(), "v", lat, lon));
    line += ` from ${compassPoint(w.from)}`;
  }
  return line;
}

/** The click card: the value, when and how it was sampled, and the archive's caveats. */
export function probeAt(lat, lon) {
  if (!live?.layer || !layerShown(live.layer)) return false;
  const def = IFS_VARIABLES[settings.variable];
  const st = stack();
  const v = sampleScalar(st, "value", lat, lon);
  if (!Number.isFinite(v)) return false;
  const field = st.find((f) => sampleScalar([f], "value", lat, lon) === v) || live.world;
  const t = timeIndex(settings.timeMs);
  const rows = [[def.label, valueText(def, v)]];
  if (def.arrays.length === 2) {
    const w = windFrom(sampleScalar(st, "u", lat, lon), sampleScalar(st, "v", lat, lon));
    rows.push(["Direction", `from ${w.from.toFixed(0)}° (${compassPoint(w.from)})`]);
    const b = beaufort(w.speed);
    if (b && settings.variable === "wind10") rows.push(["Beaufort", `force ${b.number} — ${b.name}`]);
  }
  rows.push(["Analysis time", t.iso.replace("T", " ").replace(":00Z", " UTC")]);
  rows.push(["Sampled", `${field === live.world ? "the world's 1° lattice" : `a ${field.deg.toFixed(2)}° lattice`}, `
    + "bilinear from the N320 reduced Gaussian grid (~31 km)"]);
  window.GeoIDViewer?.showFeatureCard?.({
    source_layer: LAYER_NAME,
    soil: true,
    type: "ECMWF IFS analysis",
    rock_type: `${def.label}: ${valueText(def, v)}`,
    lithology: null, name: null,
    description: "ECMWF's operational analysis at that hour",
    extra_rows: rows,
    origin: IFS_CREDIT,
    rows: [["Note", "An analysis, not a reanalysis: IFS upgrades (May 2015, March 2016, June 2023) "
      + "show as steps, so use ERA5 for trends. Values are bit-rounded to a few significant bits; "
      + "N320 is coarser than the model's own grid. No precipitation in this archive."]],
  }, lat, wrapLon(lon));
  return true;
}

/* ── the drawer under the row ──────────────────────────────────────────── */

function option(value, label, selected) {
  const o = document.createElement("option");
  o.value = String(value);
  o.textContent = label;
  if (selected) o.selected = true;
  return o;
}

function row(label, control) {
  const r = document.createElement("label");
  r.className = "row";
  const span = document.createElement("span");
  span.textContent = label;
  r.append(span, control);
  return r;
}

function buildDrawer() {
  if (byId(DRAWER_ID)) return;
  const host = document.createElement("div");
  host.id = DRAWER_ID;
  host.hidden = true;
  // The wind and hazard drawers' own classes, so every theme dresses it alike.
  host.className = "control-stack flow-controls";

  const what = document.createElement("select");
  what.className = "input";
  what.id = "ifs-variable";
  for (const [k, def] of Object.entries(IFS_VARIABLES)) {
    what.appendChild(option(k, def.mb > 2 ? `${def.label} (~${Math.round(def.mb)} MB)` : def.label, k === settings.variable));
  }
  what.addEventListener("change", () => { settings.variable = what.value; void reload(); });
  host.appendChild(row("Variable", what));

  /**
   * TIME ON ONE LINE: ◀◀ ◀ [date] [18Z] ▶ ▶▶. The steppers and the hour are
   * the catalogue's own small pills (`gis-catalogue-sym`, the Symbology button
   * beside every row); the hour pill cycles 00→06→12→18 within the day, the
   * arrows step 6 h and a day across days. Measured at the panel's narrowest
   * (20rem, 191 px of drawer) six controls at the panel's type size do not
   * fit with a whole date, so when the line would overflow the day-steps
   * (◀◀ ▶▶) step aside, and at the very narrowest (a phone held landscape,
   * where ◀ [date] [18Z] ▶ still needs ~205 px of 179) the hour pill does too:
   * ◀ ▶ still move the hour and the status line names it. Never a wrap.
   *
   * A `label.row` like its neighbours, tied to the date with `for`, so a click
   * on the words opens the date and never presses a stepper.
   */
  const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);
  const day = document.createElement("input");
  day.type = "date";
  day.className = "input";
  day.id = "ifs-date";
  day.min = fmt(T0_MS);
  day.max = fmt(LAST_MS);
  day.setAttribute("aria-label", "Analysis date (UTC)");
  // A whole date at the panel's type size, and never more than the line has.
  day.style.cssText = "flex:1 1 0;min-width:6.6rem;width:0";
  const pill = (glyph, title) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gis-catalogue-sym";
    b.textContent = glyph;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.style.padding = "0.15rem 0.24rem";
    return b;
  };
  const hour = pill("18Z", "Analysis hour (UTC) — click for the next of 00, 06, 12, 18");
  hour.id = "ifs-hour";
  hour.style.flex = "0 0 auto";
  const show = () => {
    day.value = fmt(settings.timeMs);
    hour.textContent = `${String(new Date(settings.timeMs).getUTCHours()).padStart(2, "0")}Z`;
  };
  const go = (ms) => {
    settings.timeMs = timeIndex(ms).ms;
    show();
    void reload();
  };
  day.addEventListener("change", () => {
    const ms = Date.parse(`${day.value}T${String(new Date(settings.timeMs).getUTCHours()).padStart(2, "0")}:00:00Z`);
    if (Number.isFinite(ms)) go(ms);
  });
  hour.addEventListener("click", () => {
    const h = new Date(settings.timeMs).getUTCHours();
    go(settings.timeMs + (h === 18 ? -3 : 1) * STEP_MS);
  });
  const step = (glyph, by) => {
    const b = pill(glyph, `${Math.abs(by) / 3_600_000} h ${by > 0 ? "later" : "earlier"}`);
    b.style.flex = "0 0 auto";
    b.addEventListener("click", () => go(settings.timeMs + by));
    return b;
  };
  const dayBack = step("◀◀", -4 * STEP_MS);
  const dayOn = step("▶▶", 4 * STEP_MS);
  // Itself a `.row`, so the panel's `.row > .input` rule dresses the date
  // exactly as it dresses every other control; laid out as a line. Width 0
  // with a 100% minimum: full width when laid out, but nothing toward the
  // drawer's intrinsic size, so a narrow panel makes the LINE overflow (which
  // `fit` sees) rather than widening the whole drawer past the panel.
  const line = document.createElement("div");
  line.className = "row";
  line.style.cssText = "flex-direction:row;align-items:center;gap:0.2rem;margin:0;width:0;min-width:100%";
  line.append(dayBack, step("◀", -STEP_MS), day, hour, step("▶", STEP_MS), dayOn);
  const fit = () => {
    if (!line.clientWidth) return;
    const over = () => line.scrollWidth > line.clientWidth + 1;
    dayBack.hidden = false; dayOn.hidden = false; hour.hidden = false;
    if (over()) { dayBack.hidden = true; dayOn.hidden = true; }
    if (over()) hour.hidden = true;
  };
  if (typeof ResizeObserver === "function") new ResizeObserver(fit).observe(line);
  show();
  const time = document.createElement("label");
  time.className = "row";
  time.htmlFor = "ifs-date";
  const label = document.createElement("span");
  label.textContent = "Time (UTC)";
  time.append(label, line);
  host.appendChild(time);

  const area = document.createElement("select");
  area.className = "input";
  area.id = "ifs-area";
  area.appendChild(option("view", "World, finer over the view", settings.area === "view"));
  area.appendChild(option("world", "World only (1°)", settings.area === "world"));
  area.appendChild(option("drawn", "Drawn area", settings.area === "drawn"));
  area.addEventListener("focus", () => refreshPolygonOptions(area, settings.area, { allLayers: true }));
  area.addEventListener("change", () => {
    settings.area = area.value;
    if (live) {
      live.view = null;
      live.area = null;
      rebuild();
      void refreshFine();
    }
  });
  host.appendChild(row("Area", area));

  // One line of what is drawn; the archive's detail and limits live in the
  // row's ⓘ card, where every other catalogue row keeps its own.
  const status = document.createElement("p");
  status.id = STATUS_ID;
  status.className = "compact-copy";
  host.appendChild(status);
  document.body.appendChild(host);
}

function install() {
  if (typeof document === "undefined") return;
  buildDrawer();
  window.GeoIDIFS = { add, remove, layerOf, readAt, probeAt, settings, state: () => live };
  window.dispatchEvent(new CustomEvent("geoid-gis:catalogue-changed"));
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
}
