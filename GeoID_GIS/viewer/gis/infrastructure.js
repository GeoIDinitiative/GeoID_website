/**
 * Infrastructure exposure: which ports, airports, bridges, roads, railways,
 * cities and buildings stand inside a hazard footprint, and how badly.
 *
 * The risk reader answers "how many PEOPLE" by integrating a hazard grid over
 * WorldPop. Infrastructure is the other half of what a hazard hits, and it is
 * not a density but a list of named things -- so this reads each FEATURE
 * against the hazard and classes it on the same scheme the people are classed
 * on (risk-assessment.js): a port in 1–2 m of water is in that scheme's "High"
 * class whether it was counted for people or for ships.
 *
 * Pure: a hazard arrives as `read(lon, lat) -> value | null` and a scheme, so
 * everything here runs in node and the page's glue (infrastructure-panel.js)
 * owns turning a layer into a reader. Coordinates are SIGNED degrees.
 *
 * How a feature is read, by geometry:
 *  - a POINT (port, airport, city) at itself;
 *  - a LINE (road, railway, bridge, cable) at every vertex and every segment's
 *    midpoint; its class is the worst any of them reaches, and its length is
 *    shared out between the classes segment by segment, so a readout can say
 *    "38 km of railway under 1–10 mm of ash" rather than "4 railways";
 *  - a POLYGON (building, urban area) at its outline's vertices and its
 *    centre; the worst wins -- a building half in the water is in the water.
 */

import { classIndex, LEVELS, LEVEL_COLOURS, formatCount } from "./risk-assessment.js?v=20261025-485690a";
import { DEPOSIT_CLASSES } from "./ash-plume.js?v=20261025-485690a";

/** A footprint with no values of its own: a drawn area, a fire perimeter, an alert. */
export const INSIDE_SCHEME = {
  id: "inside", hazard: "Footprint", measure: "Inside the footprint", unit: "",
  definition: "Whether the feature lies inside the footprint's polygons. The footprint carries no "
    + "severity of its own, so everything inside is counted alike.",
  classes: [{ level: "High", label: "Inside the footprint", threshold: "inside", test: (v) => v >= 1 }],
  notExposed: (v) => !(v >= 1),
};

/**
 * The ash deposit on the scheme its own classes already state (ash-plume.js),
 * worst first as every scheme is. The labels are the impacts -- airports close
 * at a dusting, roofs fail at 300 mm -- which is what an infrastructure
 * reading of ash is for.
 */
export const ASH_SCHEME = {
  id: "ash", hazard: "Volcanic ash", measure: "Ash deposit", unit: "mm",
  definition: "Thickness of ash on the ground at the end of the modelled eruption, from the "
    + "Atlas ash model. Each class is named by what that load does.",
  classes: DEPOSIT_CLASSES.map((c, k) => {
    const hi = DEPOSIT_CLASSES[k + 1]?.min ?? Infinity;
    return {
      level: LEVELS[DEPOSIT_CLASSES.length - 1 - k],
      label: c.label,
      threshold: hi === Infinity ? `≥ ${c.min} mm` : `${c.min}–${hi} mm`,
      test: (v) => v >= c.min && v < hi,
    };
  }).reverse(),
  notExposed: (v) => !(v >= DEPOSIT_CLASSES[0].min),
};

/** The colour a class is drawn in: its risk level's, else a band's grey ramp. */
export function classColour(scheme, k) {
  const level = scheme?.classes?.[k]?.level;
  if (level && LEVEL_COLOURS[level]) return LEVEL_COLOURS[level];
  const n = scheme?.classes?.length || 1;
  const t = n > 1 ? k / (n - 1) : 0;
  return `hsl(12, 70%, ${Math.round(38 + t * 40)}%)`;
}

/* ── reading one feature ──────────────────────────────────────────────── */

const RAD = Math.PI / 180;

/** Great-circle kilometres between two [lon, lat]. */
export function segmentKm([x1, y1], [x2, y2]) {
  const dLat = (y2 - y1) * RAD; const dLon = (x2 - x1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(y1 * RAD) * Math.cos(y2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function linesOf(g) {
  if (!g) return [];
  if (g.type === "LineString") return [g.coordinates];
  if (g.type === "MultiLineString") return g.coordinates;
  return [];
}

function ringsOf(g) {
  if (!g) return [];
  if (g.type === "Polygon") return [g.coordinates[0]];
  if (g.type === "MultiPolygon") return g.coordinates.map((p) => p[0]);
  return [];
}

/**
 * One feature against the hazard: `{ k, value, at, km }`.
 * `k` is its worst class (-1 off the map, -2 on it but not exposed), `value`
 * the reading there, `at` where that reading was taken, and for lines `km`
 * the length in each class (an array the length of the scheme's classes).
 */
export function readFeature(feature, read, scheme, { maxSamples = 600 } = {}) {
  const g = feature?.geometry;
  const n = scheme.classes.length;
  // How bad a reading is, lower worse: a class, then "on the map, not
  // exposed" (-2), then "off the map" (-1).
  const severity = (k) => (k >= 0 ? k : k === -2 ? n : n + 1);
  let best = { k: -1, value: null, at: null };
  const take = (lon, lat) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return -1;
    const v = read(lon, lat);
    const k = classIndex(scheme, v);
    if (best.at === null || severity(k) < severity(best.k)) best = { k, value: v, at: [lon, lat] };
    return k;
  };
  if (!g) return { ...best, km: null };
  if (g.type === "Point") {
    take(g.coordinates[0], g.coordinates[1]);
    return { ...best, km: null };
  }
  if (g.type === "MultiPoint") {
    g.coordinates.forEach(([x, y]) => take(x, y));
    return { ...best, km: null };
  }
  const lines = linesOf(g);
  if (lines.length) {
    const km = new Array(n).fill(0);
    const total = lines.reduce((s, l) => s + l.length, 0);
    const stride = Math.max(1, Math.ceil((total * 2) / maxSamples));
    for (const line of lines) {
      for (let i = 0; i < line.length; i += 1) {
        if (i % stride === 0 || i === line.length - 1) take(line[i][0], line[i][1]);
        if (i === 0) continue;
        const a = line[i - 1]; const b = line[i];
        // The antimeridian: a segment across it is not 359° of road.
        if (Math.abs(b[0] - a[0]) > 180) continue;
        const k = (i % stride === 0) ? take((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
          : classIndex(scheme, read((a[0] + b[0]) / 2, (a[1] + b[1]) / 2));
        if (k >= 0) km[k] += segmentKm(a, b);
      }
    }
    return { ...best, km };
  }
  const rings = ringsOf(g);
  for (const ring of rings) {
    const stride = Math.max(1, Math.ceil(ring.length / maxSamples));
    let sx = 0; let sy = 0; let m = 0;
    for (let i = 0; i < ring.length; i += stride) {
      take(ring[i][0], ring[i][1]);
      sx += ring[i][0]; sy += ring[i][1]; m += 1;
    }
    if (m) take(sx / m, sy / m);
  }
  return { ...best, km: null };
}

/* ── a whole layer ────────────────────────────────────────────────────── */

/** A feature's [west, south, east, north], from every coordinate it has. */
export function featureBox(feature) {
  let w = Infinity; let s = Infinity; let e = -Infinity; let n = -Infinity;
  (function walk(c) {
    if (typeof c?.[0] === "number") {
      if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0];
      if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1];
    } else if (Array.isArray(c)) c.forEach(walk);
  })(feature?.geometry?.coordinates);
  return Number.isFinite(w) ? { west: w, south: s, east: e, north: n } : null;
}

const meets = (a, b) => !b || (a && !(a.east < b.west || a.west > b.east || a.north < b.south || a.south > b.north));

/**
 * Every feature of one infrastructure source read against the hazard.
 * `extent` (signed `{west, south, east, north}`) skips features that cannot be
 * reached, which is what keeps 25,000 railway lines against a 30 km flood
 * sheet a few milliseconds rather than a few seconds.
 */
export function exposeSource(source, read, scheme, { extent = null } = {}) {
  const n = scheme.classes.length;
  const count = new Array(n).fill(0);
  const km = new Array(n).fill(0);
  const items = [];
  let lines = false;
  for (const f of source.features || []) {
    if (extent && !meets(featureBox(f), extent)) continue;
    const r = readFeature(f, read, scheme);
    if (r.km) {
      lines = true;
      r.km.forEach((v, k) => { km[k] += v; });
    }
    if (r.k < 0) continue;
    count[r.k] += 1;
    const p = f.properties || {};
    items.push({
      source: source.id, noun: source.noun,
      name: String(p.name || "").trim(), type: String(p.type || source.noun || ""),
      rank: Number.isFinite(Number(p.rank)) ? Number(p.rank) : 9,
      population: Number(p.population) > 0 ? Number(p.population) : null,
      critical: p.critical === true,
      k: r.k, value: r.value, at: r.at,
      km: r.km ? r.km.reduce((s, v) => s + v, 0) : null,
    });
  }
  return { id: source.id, noun: source.noun, plural: source.plural || `${source.noun}s`, count, km: lines ? km : null, total: items.length, items };
}

/**
 * Order the list a reader is shown: worst class first, then the critical
 * buildings, then the most important (rank 1 = a large port, a capital, a
 * motorway bridge), then the named before the unnamed, then the most people,
 * then by name.
 */
export function compareItems(a, b) {
  return (a.k - b.k)
    || (Number(b.critical) - Number(a.critical))
    || (a.rank - b.rank)
    || (Number(Boolean(b.name)) - Number(Boolean(a.name)))
    || ((b.population || 0) - (a.population || 0))
    || a.name.localeCompare(b.name);
}

/** The readings of every source, as one summary. */
export function summarise(results, scheme, { hazard = "", area = "", top = 25 } = {}) {
  const all = results.flatMap((r) => r.items).sort(compareItems);
  return {
    hazard, area, scheme,
    total: all.length,
    sources: results.map(({ items, ...rest }) => rest),
    top: all.slice(0, top),
    all,
  };
}

const plural = (n, one, many) => `${formatCount(n)} ${n === 1 ? one : many}`;

/**
 * The reading as a paragraph: what is inside, the worst first, and the named
 * things that matter most. Written for the Atlas chat and the panel alike.
 */
export function describe(summary, { names = 6 } = {}) {
  const { scheme } = summary;
  const where = [summary.hazard, summary.area].filter(Boolean).join(" over ");
  const parts = [];
  for (const s of summary.sources) {
    if (s.total) parts.push(plural(s.total, s.noun.toLowerCase(), s.plural.toLowerCase()));
    const km = s.km ? s.km.reduce((a, b) => a + b, 0) : 0;
    if (!s.total && km >= 0.05) parts.push(`${formatCount(Math.round(km))} km of ${s.plural.toLowerCase()}`);
    else if (s.km && km >= 0.05) parts[parts.length - 1] += ` (${formatCount(Math.round(km))} km)`;
  }
  if (!summary.total && !parts.length) {
    return `Nothing on the infrastructure layers stands inside ${where || "the footprint"}.`;
  }
  let text = `Inside ${where || "the footprint"}: ${parts.join(", ")}.`;
  if (scheme.classes.length > 1) {
    const worst = summary.all.length ? summary.all[0].k : -1;
    if (worst >= 0) {
      const inWorst = summary.all.filter((i) => i.k === worst).length;
      text += ` ${plural(inWorst, "is", "are")} in the worst class reached, ${scheme.classes[worst].label} (${scheme.classes[worst].threshold}).`;
    }
  }
  const named = summary.top.filter((i) => i.name).slice(0, names);
  if (named.length) {
    text += ` Most exposed: ${named.map((i) => `${i.name} (${i.type.toLowerCase()}${scheme.classes.length > 1 ? `, ${scheme.classes[i.k].label.split(" — ")[0]}` : ""})`).join("; ")}.`;
  }
  return text;
}

/** Every exposed feature as CSV, for the readout's export. */
export function exposureCsv(summary) {
  const q = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const rows = [["layer", "name", "type", "class", "threshold", "value", "unit", "length_km", "lon", "lat"]];
  for (const i of summary.all) {
    const c = summary.scheme.classes[i.k];
    rows.push([i.noun, i.name, i.type, c?.label, c?.threshold, Number.isFinite(i.value) ? +i.value.toPrecision(4) : "",
      summary.scheme.unit || "", i.km != null ? i.km.toFixed(2) : "", i.at?.[0]?.toFixed(5), i.at?.[1]?.toFixed(5)]);
  }
  return `# GeoID infrastructure exposure — ${summary.hazard || "footprint"}${summary.area ? ` over ${summary.area}` : ""}\n`
    + rows.map((r) => r.map(q).join(",")).join("\n");
}
