/**
 * LAND ICE (CPOM) — ice-sheet surface elevation change and mass change, year
 * by year since 1993, from the CPOM Land Ice Portal.
 *
 * The portal (UK Centre for Polar Observation and Modelling, ESA supported)
 * measures the ice sheets with radar altimetry — ERS-1, ERS-2, Envisat and
 * CryoSat-2, cross-checked against ICESat-2 — and its Antarctic product is the
 * ESA Antarctic Ice Sheet CCI's surface elevation change, archived at CEDA.
 * `services/bake-cpom-landice.py` reads the annual cumulative grids there and
 * writes one Int16 band per year, in the grid's OWN projection (EPSG:3031,
 * 5 km), plus a per-basin series in gigatonnes and a manifest.
 *
 * FETCHED THE WAY GFS IS: nothing is built into the page. The manifest says
 * which ice sheets exist and which years; the frames are range-read from the
 * COG one band at a time as the bar reaches them; and on opening, a one-byte
 * request asks CEDA whether a year newer than the bake now exists, so a stale
 * bake says so instead of passing for the latest. The CEDA listing itself
 * sends no CORS header, which is why the bake holds the list and the browser
 * only probes the next file.
 *
 * DRAWN IN ITS OWN PROJECTION. A lattice is laid over the grid in projected
 * metres and each vertex is carried back to lat/lon (`polar-stereo.js`); the
 * texture is the grid itself. So the pole is a vertex rather than a smeared
 * top row, and a cell lands where CPOM put it — checked against the lat/lon
 * arrays inside their own files (polar-stereo.test.mjs).
 *
 * GREENLAND IS A STUB. The manifest carries an entry per ice sheet; one the
 * portal has not published is listed with its status and no control. When the
 * bake gains it, the row appears with nothing changed here.
 */

import { dataUrl } from "./data-base.js?v=20261024-0b5ae30";
import { gridLattice, gridBounds } from "./polar-stereo.js?v=20261024-0b5ae30";

const MANIFEST = "/data/global/ice/cpom/manifest.json";
const LAYER_PREFIX = "Land ice (CPOM)";

/**
 * THE CLASSES, in metres for elevation and metres water equivalent for mass.
 *
 * Diverging and symmetric, red for loss and blue for gain, because the
 * subject is a sign: a ramp that ran light-to-dark would make the Amundsen Sea
 * and the interior's snowfall the same colour at different strengths. The
 * edges are wide at the ends because the field is: Thwaites has dropped tens
 * of metres where most of the plateau moved by centimetres, and a linear scale
 * would draw the continent one flat colour.
 */
export const KINDS = {
  sec: {
    title: "Surface elevation change",
    unit: "m",
    edges: [-20, -5, -2, -0.5, 0.5, 2, 5, 20],
  },
  mass: {
    title: "Mass change",
    unit: "m w.e.",
    edges: [-10, -3, -1, -0.25, 0.25, 1, 3, 10],
  },
};

/** RdBu, nine classes: loss red, near-zero pale, gain blue. */
export const PALETTE = [
  [103, 0, 31], [178, 24, 43], [214, 96, 77], [244, 165, 130],
  [247, 247, 247],
  [146, 197, 222], [67, 147, 195], [33, 102, 172], [5, 48, 97],
];

const fmt = (v) => (Math.abs(v) < 1 ? String(v) : String(Math.round(v)));
const signed = (v) => (v > 0 ? `+${fmt(v)}` : fmt(v));

/** Which class a value falls in, 0..edges.length. */
export function classOf(value, edges) {
  let k = 0;
  while (k < edges.length && value >= edges[k]) k += 1;
  return k;
}

/** Legend rows for a kind, in the shape `legendInfo` takes. */
export function legendFor(kind, since = "1993") {
  const { title, unit, edges } = KINDS[kind];
  const labels = PALETTE.map((_, i) => {
    if (i === 0) return `below ${signed(edges[0])} ${unit}`;
    if (i === edges.length) return `above ${signed(edges[edges.length - 1])} ${unit}`;
    return `${signed(edges[i - 1])} to ${signed(edges[i])} ${unit}`;
  });
  return {
    palette: PALETTE.map((c) => c.map((v) => v.toString(16).padStart(2, "0")).join("")),
    labels,
    values: labels,
    label: `${title} since ${since} (${unit})`,
    field: `${title} (${unit})`,
    unit,
    classed: true,
    categorical: false,
  };
}

/**
 * The value a cell is drawn at. Elevation is the band in metres; mass is that
 * times the cell's density (the bake's two-density model) over water's 1000,
 * i.e. metres of water equivalent. Null where there is no data.
 */
export function valueAt(raw, density, kind, { scale = 0.01, nodata = -32768 } = {}) {
  if (raw === nodata || !Number.isFinite(raw)) return null;
  const dh = raw * scale;
  if (kind !== "mass") return dh;
  if (density === nodata || !Number.isFinite(density) || density <= 0) return null;
  return (dh * density) / 1000;
}

/** One band painted into RGBA bytes, the grid's own size. */
export function paint(values, densities, kind, meta, out = null) {
  const edges = KINDS[kind].edges;
  const px = out || new Uint8ClampedArray(values.length * 4);
  for (let i = 0; i < values.length; i += 1) {
    const v = valueAt(values[i], densities ? densities[i] : null, kind, meta);
    const o = i * 4;
    if (v === null) { px[o + 3] = 0; continue; }
    const c = PALETTE[classOf(v, edges)];
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 225;
  }
  return px;
}

/** "202412" → "2024"; the last, partial year keeps its month. */
export function epochLabel(end, { last = false } = {}) {
  const year = end.slice(0, 4);
  const month = Number(end.slice(4, 6));
  if (month === 12 || !last) return year;
  const name = new Date(Date.UTC(2000, month - 1, 1)).toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  return `${name} ${year}`;
}

/**
 * THE GRAVIMETRIC LINE, LAID OVER THE ALTIMETRY ONE.
 *
 * The two series have different zeros — altimetry is change since January
 * 1993, the GRACE product mass relative to 2011 — and an offset between two
 * cumulative curves says nothing about either. So the GRACE curve is shifted
 * by one constant: the mean difference over the years both cover, with the
 * altimetry interpolated to GRACE's months. What remains to compare is the
 * SHAPE — the trend and its bends — which is the part that is measured.
 */
export function rebase(grav, years, values) {
  if (!grav || !grav.years?.length || !years?.length) return null;
  const at = (t) => {
    if (t < years[0] || t > years[years.length - 1]) return null;
    let i = 0;
    while (i < years.length - 2 && years[i + 1] < t) i += 1;
    const a = values[i]; const b = values[i + 1];
    if (a == null || b == null) return null;
    const f = (t - years[i]) / (years[i + 1] - years[i]);
    return a + (b - a) * f;
  };
  let sum = 0; let n = 0;
  grav.years.forEach((t, i) => {
    const alt = at(t);
    const g = grav.gt[i];
    if (alt != null && g != null) { sum += alt - g; n += 1; }
  });
  if (!n) return null;
  const shift = sum / n;
  return grav.gt.map((g) => (g == null ? null : g + shift));
}

/** The chart's choices: the sheet, its three regions, then every basin. */
export function seriesOptions(series) {
  const out = [];
  const total = Object.keys(series.regions).find((k) => !["East", "West", "Peninsula"].includes(k));
  if (total) out.push({ value: `region:${total}`, label: `All of ${total}` });
  ["West", "East", "Peninsula"].forEach((r) => {
    if (series.regions[r]) out.push({ value: `region:${r}`, label: `${r} Antarctica` });
  });
  [...series.basins].sort((a, b) => a.name.localeCompare(b.name)).forEach((b) => {
    out.push({ value: `basin:${b.id}`, label: `${b.name} — ${b.place}` });
  });
  return out;
}

/** The values behind one choice, plus the gravimetric line where there is one. */
export function seriesFor(series, choice) {
  const [kind, key] = String(choice || "").split(":");
  if (kind === "basin") {
    const b = series.basins.find((x) => String(x.id) === key);
    if (!b) return null;
    return { title: `${b.name} — ${b.place}`, mass: b.mass_gt, area: b.area_km2, grav: null, imbie: null };
  }
  const r = series.regions[key];
  if (!r) return null;
  const gravSeries = series.gravimetric?.series?.[key];
  const imbieSeries = series.imbie?.series?.[key];
  /**
   * GRACE's own zero is 2011, so it needs one constant to sit on a chart
   * that counts from 1993. It is fitted to IMBIE where IMBIE is drawn — both
   * measure MASS — and to the altimetry only where there is nothing else.
   * Fitted to the altimetry beside IMBIE, it borrowed the very offset the
   * chart exists to show and read as agreement.
   */
  const grav = gravSeries
    ? (imbieSeries
      ? rebase({ years: series.gravimetric.years, gt: gravSeries.gt }, series.imbie.years, imbieSeries.gt)
      : rebase({ years: series.gravimetric.years, gt: gravSeries.gt }, series.years, r.mass_gt))
    : null;
  return {
    title: key === "Antarctica" || !["East", "West", "Peninsula"].includes(key) ? `All of ${key}` : `${key} Antarctica`,
    mass: r.mass_gt, area: r.area_km2,
    grav: grav ? { years: series.gravimetric.years, gt: grav } : null,
    /**
     * IMBIE, re-zeroed by the bake at this product's own epoch (Jan 1993) —
     * a change of reference, not a fit, so a gap between the two lines is a
     * real disagreement and is drawn as one.
     */
    imbie: series.imbie?.series?.[key]
      ? { years: series.imbie.years, gt: series.imbie.series[key].gt, sigma: series.imbie.series[key].sigma_gt }
      : null,
  };
}

/** The lines: this layer's altimetry estimate, IMBIE's reconciled series, GRACE. */
export const ALT_COLOUR = "#4ea3ff";
export const IMBIE_COLOUR = "#5fd38d";
export const GRAV_COLOUR = "#f2a65a";

/** Round axis steps: 1, 2, 5 × 10^n, about five of them. */
export function niceStep(span) {
  const raw = Math.max(span, 1) / 5;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw);
}

/**
 * The basin chart as an SVG string — gigatonnes against year: this layer's
 * altimetry estimate (blue), IMBIE's reconciled series with its uncertainty
 * band (green) and GRACE (orange, dashed) where a region has them, and a
 * marker on the year the globe is showing. A key names each line, because
 * the blue one is NOT the IMBIE number and must not be readable as it.
 * Pure, so a test can read it.
 */
export function chartSvg(series, choice, { index = null, width = 300, height = 196 } = {}) {
  const s = seriesFor(series, choice);
  if (!s) return "";
  const years = series.years;
  const pad = { l: 44, r: 8, t: 34, b: 22 };
  const pts = s.mass.map((v, i) => [years[i], v]).filter(([, v]) => v != null);
  const gpts = s.grav ? s.grav.years.map((t, i) => [t, s.grav.gt[i]]).filter(([, v]) => v != null) : [];
  const ipts = s.imbie ? s.imbie.years.map((t, i) => [t, s.imbie.gt[i], s.imbie.sigma?.[i] ?? 0]) : [];
  const all = [...pts, ...gpts].map(([, v]) => v)
    .concat(ipts.flatMap(([, v, e]) => [v - e, v + e])).concat(0);
  let lo = Math.min(...all); let hi = Math.max(...all);
  if (hi - lo < 10) { hi += 5; lo -= 5; }
  const step = niceStep(hi - lo);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const x0 = 1992; const x1 = Math.ceil(years[years.length - 1]) + 0.5;
  const X = (t) => pad.l + ((t - x0) / (x1 - x0)) * (width - pad.l - pad.r);
  const Y = (v) => pad.t + ((hi - v) / (hi - lo)) * (height - pad.t - pad.b);
  const path = (p) => p.map(([t, v], i) => `${i ? "L" : "M"}${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join("");
  const grid = [];
  for (let v = lo; v <= hi + 1e-9; v += step) {
    grid.push(`<line x1="${pad.l}" x2="${width - pad.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="currentColor" stroke-opacity="${v === 0 ? 0.55 : 0.15}" stroke-width="1"/>`
      + `<text x="${pad.l - 4}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="currentColor" fill-opacity="0.75">${v.toLocaleString("en-GB")}</text>`);
  }
  const ticks = [];
  for (let t = 1995; t <= x1; t += 5) {
    ticks.push(`<text x="${X(t).toFixed(1)}" y="${height - 6}" text-anchor="middle" font-size="9" fill="currentColor" fill-opacity="0.75">${t}</text>`);
  }
  let marker = "";
  if (index != null && years[index] != null && s.mass[index] != null) {
    marker = `<line x1="${X(years[index]).toFixed(1)}" x2="${X(years[index]).toFixed(1)}" y1="${pad.t}" y2="${height - pad.b}" stroke="currentColor" stroke-opacity="0.45" stroke-dasharray="2 2"/>`
      + `<circle cx="${X(years[index]).toFixed(1)}" cy="${Y(s.mass[index]).toFixed(1)}" r="3" fill="${ALT_COLOUR}"/>`;
  }
  const band = ipts.length
    ? `<path d="${path(ipts.map(([t, v, e]) => [t, v + e]))}L${path([...ipts].reverse().map(([t, v, e]) => [t, v - e])).slice(1)}Z" `
      + `fill="${IMBIE_COLOUR}" fill-opacity="0.16" stroke="none"/>`
    : "";
  const key = [[ALT_COLOUR, "Altimetry (this layer)", ""]]
    .concat(ipts.length ? [[IMBIE_COLOUR, "IMBIE 2021", ""]] : [])
    .concat(gpts.length ? [[GRAV_COLOUR, "GRACE (CCI)", "4 3"]] : []);
  // Spaced by label length (about 4.4 px a character at 8 px), not evenly:
  // even slots put "IMBIE 2021" on top of the altimetry label.
  let kx = pad.l - 30;
  const keySvg = key.map(([c, label, dash]) => {
    const at = kx;
    kx += 15 + label.length * 4.4 + 12;
    return `<line x1="${at}" x2="${at + 12}" y1="18" y2="18" stroke="${c}" stroke-width="2"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`
      + `<text x="${at + 15}" y="21" font-size="8" fill="currentColor" fill-opacity="0.85">${label}</text>`;
  }).join("");
  return `<svg class="cpom-chart" viewBox="0 0 ${width} ${height}" width="100%" role="img" `
    + `aria-label="Mass change in gigatonnes since January 1993, ${s.title}">`
    + `<text x="${pad.l}" y="8" font-size="9" fill="currentColor" fill-opacity="0.75">Gt since Jan 1993</text>`
    + keySvg
    + grid.join("") + ticks.join("") + band
    + (ipts.length ? `<path d="${path(ipts)}" fill="none" stroke="${IMBIE_COLOUR}" stroke-width="1.6"/>` : "")
    + (gpts.length ? `<path d="${path(gpts)}" fill="none" stroke="${GRAV_COLOUR}" stroke-width="1.4" stroke-dasharray="4 3"/>` : "")
    + `<path d="${path(pts)}" fill="none" stroke="${ALT_COLOUR}" stroke-width="2"/>`
    + marker + "</svg>";
}

/* ── the browser half ─────────────────────────────────────────────────── */

const state = {
  manifest: null, series: {}, image: {}, density: {}, running: null, opening: false,
};
const byId = (id) => document.getElementById(id);
const say = (message) => { const n = byId("cpom-status"); if (n) n.textContent = message || ""; };

async function manifest() {
  if (!state.manifest) {
    state.manifest = fetch(`${MANIFEST}${new URL(import.meta.url).search}`)
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }
  return state.manifest;
}

async function seriesOf(region, spec) {
  if (!state.series[region]) {
    state.series[region] = fetch(await dataUrl(spec.series))
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }
  return state.series[region];
}

async function imageOf(region, spec) {
  if (!state.image[region]) {
    state.image[region] = (async () => {
      const { loadGeoTiffLibrary } = await import(`./geotiff-adapter.js${new URL(import.meta.url).search}`);
      const GeoTIFF = await loadGeoTiffLibrary();
      const url = await dataUrl(spec.raster);
      /**
       * RANGE READS FROM THE BUCKET, THE WHOLE FILE WHERE THERE ARE NONE.
       * Published, the COG is range-read a band at a time. Before it is
       * published it comes off the site itself, and `serve.py` (Python's
       * SimpleHTTPRequestHandler) ignores Range and answers 200 with every
       * byte — which geotiff.js's range source rejects as "Request failed".
       * The file is 16.5 MB for all 33 years, so reading it once is fine.
       */
      try {
        const tiff = await GeoTIFF.fromUrl(url);
        const image = await tiff.getImage();
        await image.readRasters({ samples: [0], window: [0, 0, 1, 1] });
        return image;
      } catch {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`the land-ice frames answered ${r.status}`);
        const tiff = await GeoTIFF.fromArrayBuffer(await r.arrayBuffer());
        return tiff.getImage();
      }
    })();
    state.image[region].catch(() => { state.image[region] = null; });
  }
  return state.image[region];
}

async function band(region, spec, index) {
  const image = await imageOf(region, spec);
  const [data] = await image.readRasters({ samples: [index] });
  return data;
}

/**
 * IS THERE A NEWER YEAR? One byte of the file a newer bake would read. CEDA's
 * download host sends CORS; a 404 is the normal answer and says nothing.
 */
async function probeNewer(spec) {
  if (!spec.next) return false;
  try {
    const r = await fetch(spec.next, { headers: { Range: "bytes=0-0" }, cache: "no-store" });
    return r.status === 206 || r.status === 200;
  } catch {
    return false;
  }
}

const gtText = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v)).toLocaleString("en-GB")} Gt`;

/**
 * WHY THE BLUE LINE IS NOT THE IMBIE NUMBER, in one paragraph built from the
 * bake's own reconciliation. Over the window both cover, the altimetry
 * estimate and IMBIE per region, and how far the sheet total moves under other
 * reasonable density rules — which is the cause: radar altimetry measures
 * VOLUME, and IMBIE's altimetry inputs turn it into mass with firn models
 * this layer does not have.
 */
export function reconcileText(series, region = "Antarctica") {
  const r = series?.reconcile;
  if (!r || r.imbie_gt?.[region] == null) return "";
  const to = epochLabel(r.to);
  const sens = Object.values(r.density_sensitivity_gt || {});
  return `Not the IMBIE number. ${region === "Antarctica" ? "For the whole sheet" : `For ${region} Antarctica`}, `
    + `Jan 1993 to ${to}: this altimetry estimate ${gtText(r.altimetry_gt[region])}, `
    + `IMBIE 2021 ${gtText(r.imbie_gt[region])}. Altimetry measures volume; turning it into mass needs `
    + `a density for every cell, and IMBIE uses firn-densification models where this layer uses a two-density rule`
    + (sens.length ? ` — other reasonable rules move the sheet total anywhere from ${gtText(Math.max(...sens))} to ${gtText(Math.min(...sens))}` : "")
    + `. Use the green line for mass; use this layer for where and when the surface changed.`;
}

function regionSummary(spec, series) {
  const last = spec.bands[spec.bands.length - 1];
  const total = series?.regions?.Antarctica?.mass_gt;
  const gt = total ? total[total.length - 1] : null;
  return `${spec.bands.length} years, ${epochLabel(spec.bands[0].end)}–${epochLabel(last.end, { last: true })}`
    + (gt != null ? ` · altimetry estimate ${gtText(gt)} since 1993 (not IMBIE — see the chart)` : "");
}

/** The sheets the portal covers, one row each; a pending one says so. */
async function renderSheets() {
  const host = byId("cpom-sheets");
  const m = await manifest();
  if (!host) return;
  host.textContent = "";
  if (!m) { say("The land-ice manifest could not be read."); return; }
  const select = byId("cpom-sheet");
  for (const [key, spec] of Object.entries(m.regions || {})) {
    const row = document.createElement("p");
    row.className = "compact-copy cpom-sheet-row";
    row.style.margin = "0.15rem 0";
    if (spec.status !== "published") {
      row.textContent = `${spec.label}: not yet published by the portal.`;
      row.style.opacity = "0.6";
      host.appendChild(row);
      continue;
    }
    const series = await seriesOf(key, spec);
    row.textContent = `${spec.label}: ${regionSummary(spec, series)}`;
    host.appendChild(row);
    if (select && ![...select.options].some((o) => o.value === key)) {
      const o = document.createElement("option");
      o.value = key; o.textContent = spec.label;
      select.appendChild(o);
    }
    if (await probeNewer(spec)) {
      const fresh = document.createElement("p");
      fresh.className = "compact-copy";
      fresh.style.margin = "0.1rem 0";
      fresh.textContent = `CEDA now holds a year newer than this bake — re-run services/bake-cpom-landice.py.`;
      host.appendChild(fresh);
    }
  }
}

async function renderChart(index = null) {
  const host = byId("cpom-chart");
  const pick = byId("cpom-basin");
  const region = byId("cpom-sheet")?.value;
  const m = await manifest();
  const spec = m?.regions?.[region];
  if (!host || !pick || !spec || spec.status !== "published") return;
  const series = await seriesOf(region, spec);
  if (!series) { host.textContent = "The basin series could not be read."; return; }
  if (pick.dataset.region !== region) {
    pick.dataset.region = region;
    pick.textContent = "";
    seriesOptions(series).forEach(({ value, label }) => {
      const o = document.createElement("option");
      o.value = value; o.textContent = label;
      pick.appendChild(o);
    });
  }
  const at = index ?? (state.running?.index ?? series.years.length - 1);
  host.innerHTML = chartSvg(series, pick.value, { index: at });
  const s = seriesFor(series, pick.value);
  const v = s?.mass?.[at];
  const note = byId("cpom-chart-note");
  if (note && s) {
    const when = epochLabel(series.epochs[at], { last: at === series.epochs.length - 1 });
    const [kind, key] = String(pick.value).split(":");
    const imbieAt = s.imbie ? s.imbie.gt[s.imbie.years.findIndex((t) => t >= series.years[at] - 0.05)] : null;
    note.textContent = (v == null ? `${when}: no value.` : `${when}: altimetry estimate ${gtText(v)} since Jan 1993`)
      + (imbieAt != null ? `, IMBIE ${gtText(imbieAt)}` : "")
      + ` over ${s.area.toLocaleString("en-GB")} km². `
      + (kind === "region" ? reconcileText(series, key) : "IMBIE and GRACE are published per region, not per basin.")
      + (s.grav ? ` Dashed: GRACE/GRACE-FO (ESA CCI), whose own zero is 2011, offset onto ${s.imbie ? "IMBIE" : "the altimetry"}.` : "")
      + (/Peninsula/.test(s.title) ? " Radar altimetry is least reliable over the Peninsula's mountains; the gravimetric line is the better guide there." : "");
  }
}

function metadataFor(spec, kind, series) {
  const d = series?.density;
  const density = d
    ? `Mass is elevation change × density: ${d.ice_kg_m3} kg/m³ (ice) where the cell has changed faster than `
      + `${d.dynamic_m_per_yr} m a year over the record, ${d.firn_kg_m3} kg/m³ (firn) elsewhere — after Shepherd et al. (2019); the threshold is GeoHUB's.`
    : "";
  const im = series?.imbie;
  return {
    reconciliation: reconcileText(series),
    comparison: im ? `IMBIE 2021 drawn for comparison: ${im.citation} ${im.licence}.` : "",
    source: `CPOM Land Ice Portal — ${spec.title || "surface elevation change"} (${spec.source || "multi-mission radar altimetry"}), `
      + `via the ESA Antarctic Ice Sheet CCI at CEDA`,
    // The Metadata tab shows Source, CRS, Format and Citation; the comparison
    // series is cited there too, because it is drawn beside this layer.
    citation: `${spec.citation} Licence: ${spec.licence}${spec.references ? ` Reference: ${spec.references}.` : ""}`
      + (im ? ` Compared with: ${im.citation} (${im.licence}).` : ""),
    crs: `${spec.crs} (drawn in its own grid; each vertex reprojected to the globe)`,
    format: `Cloud-Optimised GeoTIFF, Int16 centimetres, ${spec.grid.dx / 1000} km, one band per year`,
    cellCount: spec.grid.nx * spec.grid.ny,
    units: KINDS[kind].unit,
    summary: `${KINDS[kind].title} since January 1993, in ${KINDS[kind].unit}, on a ${spec.grid.dx / 1000} km grid. `
      + `GIA correction ${spec.gia || "as published"}. ${density} ${reconcileText(series)}`,
  };
}

function disposeMesh(mesh) {
  mesh?.parent?.remove(mesh);
  mesh?.traverse?.((n) => {
    n.geometry?.dispose?.();
    n.material?.map?.dispose?.();
    n.material?.dispose?.();
  });
}

/** Show a sheet on the globe, with the bar across its years. */
export async function show({ region = null, kind = null } = {}) {
  if (state.opening) return { already: true };
  state.opening = true;
  try {
    return await open_(region || byId("cpom-sheet")?.value || "antarctica", kind || byId("cpom-kind")?.value || "sec");
  } catch (error) {
    say(`Could not draw the land-ice frames: ${error?.message || error}`);
    return null;
  } finally {
    state.opening = false;
  }
}

async function open_(region, kind) {
  const m = await manifest();
  const spec = m?.regions?.[region];
  if (!spec || spec.status !== "published") { say("That ice sheet is not published yet."); return null; }
  const player = await import(`./timelapse-player.js${new URL(import.meta.url).search}`);
  if (state.running) player.stopPlayer();
  say("Reading the frames…");
  const [three, gee, series] = await Promise.all([
    import("../vendor/three.module.js"),
    import(`./gee.js${new URL(import.meta.url).search}`),
    seriesOf(region, spec),
  ]);
  const meta = { scale: spec.scale, nodata: spec.nodata };
  const last = spec.bands.length - 1;
  const densities = kind === "mass" ? await band(region, spec, spec.density_band) : null;
  const { nx, ny } = spec.grid;
  const canvas = document.createElement("canvas");
  canvas.width = nx; canvas.height = ny;
  const ctx = canvas.getContext("2d");
  const pixels = ctx.createImageData(nx, ny);
  const draw = async (i) => {
    paint(await band(region, spec, spec.bands[i].band), densities, kind, meta, pixels.data);
    ctx.putImageData(pixels, 0, 0);
  };
  await draw(last);

  /**
   * THE LATTICE: 160 × 160 over a 5,640 × 4,840 km grid is a vertex every
   * 35 km — finer than the relief under it needs and well under what the
   * coastline's curvature would show, at 26k vertices.
   */
  const bounds = gridBounds(spec.grid, spec.crs);
  const lattice = gridLattice(spec.grid, { sx: 160, sy: 160, crs: spec.crs });
  const mesh = await gee.drape(canvas.toDataURL(), bounds, { lattice });
  if (!mesh) { say("The globe is not ready yet."); return null; }
  // One texture, repainted per frame: the geometry never changes.
  const texture = new three.CanvasTexture(canvas);
  texture.colorSpace = three.SRGBColorSpace;
  mesh.traverse?.((n) => {
    if (!n.material || !("map" in n.material)) return;
    n.material.map?.dispose?.();
    n.material.map = texture;
    n.material.needsUpdate = true;
  });

  const name = `${LAYER_PREFIX} — ${spec.label}, ${KINDS[kind].title.toLowerCase()}`;
  (window.GeoIDImportManager?.getLayers?.() || [])
    .filter((l) => String(l.name || "").startsWith(LAYER_PREFIX))
    .forEach((l) => window.GeoIDImportManager?.removeLayer?.(l.id));
  const box = { minX: bounds.west, minY: bounds.south, maxX: bounds.east, maxY: bounds.north };
  const layer = window.GeoIDImportManager?.addDerivedLayer?.(name, {
    object3D: mesh, bounds: box, georeferenced: true,
    legendInfo: legendFor(kind),
    info: { summary: metadataFor(spec, kind, series).summary, citation: metadataFor(spec, kind, series).citation },
    home: "geology",
  }, "cpom");
  if (layer) {
    layer.metadata = { ...(layer.metadata || {}), ...metadataFor(spec, kind, series), importedAt: new Date().toISOString() };
    // Onto the globe itself — the drape is built in the globe's frame (gee.js).
    mesh.userData.geoidLayer = true;
    window.GeoIDViewer?.globe?.add?.(mesh);
    window.GeoIDLayerHierarchy?.render?.();
  }
  try {
    const { frameGlobeBounds } = await import(`./geo-utils.js${new URL(import.meta.url).search}`);
    // Over the pole rather than over the box's middle, which for a polar cap
    // is a point on the 75th parallel. The 140° span sets the distance: the
    // whole continent in view.
    frameGlobeBounds({ minX: -70, maxX: 70, minY: spec.crs === "EPSG:3031" ? -90 : 86, maxY: spec.crs === "EPSG:3031" ? -86 : 90 });
  } catch { /* framing is a courtesy */ }

  const epochs = spec.bands.map((b, i) => {
    const label = epochLabel(b.end, { last: i === last });
    return {
      date: b.end, label, index: i, year: Number(b.end.slice(0, 4)),
      from: `${b.start.slice(0, 4)}-${b.start.slice(4)}-01`, to: `${b.end.slice(0, 4)}-${b.end.slice(4)}-28`,
      tick: Number(b.end.slice(0, 4)) % 5 === 0 && b.end.endsWith("12"),
    };
  });
  state.running = { region, kind, index: last, layerId: layer?.id };
  await renderChart(last);
  await player.startPlayer({
    bounds, epochs, source: "none",
    noteFor: (e) => `${KINDS[kind].title} since Jan 1993, to ${e.label} (${KINDS[kind].unit})`,
    onStatus: say,
    startAt: last,
    interval: 900,
    owns: () => [(window.GeoIDImportManager?.getLayers?.() || []).find((l) => l.id === layer?.id)],
    onShow: async (index) => {
      await draw(index);
      texture.needsUpdate = true;
      if (state.running) state.running.index = index;
      renderChart(index);
    },
    onStop: () => {
      state.running = null;
      if (layer) window.GeoIDImportManager?.removeLayer?.(layer.id);
      disposeMesh(mesh);
      say("");
    },
  });
  say(`${spec.label}: ${regionSummary(spec, series)}. Drag the bar to step through the years.`);
  return { frames: epochs.length, layer };
}

function wire() {
  const run = byId("cpom-run");
  if (!run || run.dataset.wired) return;
  run.dataset.wired = "1";
  renderSheets().then(() => renderChart());
  run.addEventListener("click", () => show());
  byId("cpom-basin")?.addEventListener("change", () => renderChart());
  byId("cpom-sheet")?.addEventListener("change", () => renderChart());
  byId("cpom-kind")?.addEventListener("change", () => { if (state.running) show(); });
}

function whenHost(selector, place) {
  let tries = 0;
  const tick = () => {
    if (document.querySelector(selector)) { place(); return; }
    if ((tries += 1) < 50) window.setTimeout(tick, 300);
  };
  tick();
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.GeoIDLandIce = { show, renderChart, state };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => whenHost("#cpom-run", wire));
  else whenHost("#cpom-run", wire);
}
