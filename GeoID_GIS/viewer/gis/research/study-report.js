/**
 * A study area's risk report, written as a document the reader then finishes.
 *
 * The risk reader answers "who is at risk here, from what" for every study
 * area drawn on the GIS page, map by map. That answer lives in a floating
 * window and dies with the session; a report wants it laid out once, with the
 * ground it is about, and left in the project for somebody to write around.
 * This is the pure half: the geo-context arithmetic (area, extent, a lattice
 * of points inside the polygons, what the sampled layers say there, the
 * nearest named places) and the Markdown the page puts in front of the
 * reader. Nothing here fetches, draws or touches a document.
 *
 * THE NUMBERS ARE THE READER'S, NOT RE-DERIVED. Every figure under "Findings"
 * is read off the assessment the risk reader produced — the same object its
 * window, CSV and print report read — so the document cannot disagree with
 * the window it was written from. What this module adds is arrangement,
 * comparison across hazards, and the context those readings sit in.
 */

import { sphericalPolygonAreaKm2 } from "../geo-utils.js?v=20261025-7ceef37";

const EARTH_KM = 6371.0088;

/* ── geometry ─────────────────────────────────────────────────────────── */

/** Every ring of `polys` ({coords: [[lon,lat]...]...}) as [[lon, lat]...]. */
function outerRings(polys) {
  return (polys || []).map((p) => p.coords?.[0] || []).filter((r) => r.length >= 3);
}

/** Even-odd point in polygon, holes included. `lon` and the rings agree in frame. */
export function pointInPolys(lon, lat, polys) {
  for (const p of polys || []) {
    let inside = false;
    for (const ring of p.coords || []) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
        if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    if (inside) return true;
  }
  return false;
}

/** Area (km², holes subtracted), box and an area-weighted centroid. */
export function areaGeometry(polys) {
  let areaKm2 = 0; let w = Infinity; let e = -Infinity; let s = Infinity; let n = -Infinity;
  let cx = 0; let cy = 0; let wt = 0;
  for (const p of polys || []) {
    (p.coords || []).forEach((ring, k) => {
      if (ring.length < 3) return;
      const a = sphericalPolygonAreaKm2(ring.map(([lon, lat]) => ({ lat, lon })), EARTH_KM);
      areaKm2 += k === 0 ? a : -a;
      if (k !== 0) return;
      let rx = 0; let ry = 0;
      for (const [lon, lat] of ring) {
        rx += lon; ry += lat;
        if (lon < w) w = lon; if (lon > e) e = lon; if (lat < s) s = lat; if (lat > n) n = lat;
      }
      cx += (rx / ring.length) * a; cy += (ry / ring.length) * a; wt += a;
    });
  }
  if (!Number.isFinite(w)) return null;
  return {
    areaKm2: Math.max(0, areaKm2),
    box: { west: w, east: e, south: s, north: n },
    centroid: wt > 0 ? { lat: cy / wt, lon: cx / wt } : { lat: (s + n) / 2, lon: (w + e) / 2 },
  };
}

/**
 * A lattice of points INSIDE the polygons, about `target` of them, square in
 * ground distance (the longitude step stretched by 1/cos(lat)). The points a
 * context reading is taken at: enough to say what an area is, few enough to
 * read at once.
 */
export function latticeInside(polys, target = 400) {
  const g = areaGeometry(polys);
  if (!g) return [];
  const { box } = g;
  const midLat = (box.north + box.south) / 2;
  const k = Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
  const spanLat = Math.max(1e-6, box.north - box.south);
  const spanLon = Math.max(1e-6, (box.east - box.west) * k);
  // The bounding box holds more than the polygon, so ask for more and keep
  // the ones inside; one pass, then a denser one if the shape is thin.
  for (const factor of [1, 3, 9]) {
    const step = Math.sqrt((spanLat * spanLon) / (target * factor));
    const out = [];
    for (let lat = box.south + step / 2; lat < box.north; lat += step) {
      for (let x = box.west * k + step / 2; x < box.east * k; x += step) {
        const lon = x / k;
        if (pointInPolys(lon, lat, polys)) out.push({ lat, lon });
      }
    }
    if (out.length >= Math.min(target / 4, 20) || factor === 9) return out.length ? out : [g.centroid];
  }
  return [g.centroid];
}

/** min / mean / max / p10 / p90 of the finite values, and how many there were. */
export function summarise(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const q = (p) => v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))];
  return { n: v.length, min: v[0], max: v[v.length - 1], mean: v.reduce((s, x) => s + x, 0) / v.length, p10: q(0.1), p50: q(0.5), p90: q(0.9) };
}

/** Each distinct name's share of the samples, most common first. */
export function tally(names, { top = 6 } = {}) {
  const counts = new Map();
  let n = 0;
  for (const name of names) {
    if (name == null || name === "") continue;
    counts.set(name, (counts.get(name) || 0) + 1);
    n += 1;
  }
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .map(([name, count]) => ({ name, share: count / n }));
  return { n, rows: rows.slice(0, top), more: Math.max(0, rows.length - top) };
}

/** Great-circle distance in km. */
export function haversineKm(a, b) {
  const r = (d) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat); const dLon = r(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The named places a reader would place the area by: those INSIDE it first
 * (largest first), then the nearest outside, each with its distance and a
 * compass bearing from the centroid. `places` rows are the gazetteer's.
 */
export function placesFor(places, polys, centroid, { inside = 6, near = 6, maxKm = 300 } = {}) {
  const within = []; const around = [];
  for (const p of places || []) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    const km = haversineKm(centroid, p);
    if (km > maxKm * 3) continue;
    if (pointInPolys(p.lon, p.lat, polys)) within.push({ ...p, km });
    else if (km <= maxKm) around.push({ ...p, km, bearing: compass(centroid, p) });
  }
  const weight = (p) => (Number(p.population) || 0) + (Number.isFinite(p.lod) ? (6 - p.lod) * 1e5 : 0);
  within.sort((a, b) => weight(b) - weight(a) || a.km - b.km);
  around.sort((a, b) => a.km - b.km);
  return { inside: within.slice(0, inside), insideMore: Math.max(0, within.length - inside), near: around.slice(0, near) };
}

/** N, NE, E… from a to b. */
export function compass(a, b) {
  const r = (d) => (d * Math.PI) / 180;
  const y = Math.sin(r(b.lon - a.lon)) * Math.cos(r(b.lat));
  const x = Math.cos(r(a.lat)) * Math.sin(r(b.lat)) - Math.sin(r(a.lat)) * Math.cos(r(b.lat)) * Math.cos(r(b.lon - a.lon));
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];
}

/* ── formatting ───────────────────────────────────────────────────────── */

export const fmtPeople = (v) => (Number.isFinite(v) ? (v >= 1000 ? Math.round(v).toLocaleString("en-GB") : v >= 10 ? Math.round(v).toString() : v >= 0.5 ? v.toFixed(1) : v > 0 ? "<1" : "0") : "—");
export const fmtPct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(x >= 0.1 ? 0 : 1)}%` : "—");
const fmtKm2 = (v) => (Number.isFinite(v) ? (v >= 100 ? Math.round(v).toLocaleString("en-GB") : v.toFixed(v >= 1 ? 1 : 3)) : "—");
const fmtDeg = (v, pos, neg) => (Number.isFinite(v) ? `${Math.abs(v).toFixed(4)}°${v >= 0 ? pos : neg}` : "—");
const fmtNum = (v, d = 2) => (Number.isFinite(v) ? (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-GB") : v.toFixed(d)) : "—");
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const row = (cells) => `| ${cells.map(cell).join(" | ")} |`;
export function slug(text) { return String(text || "area").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 48) || "area"; }

/** A short fingerprint of what the report was built from, to tell when it is stale. */
export function readingsSignature(readings) {
  return (readings || []).filter((r) => r.assessment)
    .map((r) => `${r.key}@${r.assessment.generated}`).sort().join(";");
}

/* ── the document ─────────────────────────────────────────────────────── */

function breakdownTable(b) {
  const lines = [row(["Level", "Class", "People", "Share of the area's people", "Area km²"]), "|---|---|---:|---:|---:|"];
  for (const c of b.byClass) lines.push(row([c.level || "—", c.label, fmtPeople(c.people), fmtPct(c.shareOfArea), fmtKm2(c.areaKm2)]));
  lines.push(row(["", "Not exposed", fmtPeople(b.notExposed), fmtPct(b.total ? b.notExposed / b.total : NaN), ""]));
  lines.push(row(["", "No reading (off the map)", fmtPeople(b.noReading), fmtPct(b.total ? b.noReading / b.total : NaN), fmtKm2(b.noReadingAreaKm2)]));
  return lines.join("\n");
}

function statsLine(b) {
  const s = b.stats || {};
  if (!Number.isFinite(s.mean)) return null;
  const u = b.scheme.unit ? ` ${b.scheme.unit}` : "";
  return `People-weighted ${b.scheme.measure.toLowerCase()}: mean ${fmtNum(s.mean)}${u}, median ${fmtNum(s.median)}${u}, `
    + `10–90% ${fmtNum(s.p10)}–${fmtNum(s.p90)}${u} (range ${fmtNum(s.min)}–${fmtNum(s.max)}${u}).`;
}

/**
 * The report as Markdown. `area` is `{ name, polys }`; `context` is what the
 * page measured (`elevation`, `climate`, `units`, `places`, each may be
 * absent); `readings` are the risk reader's for this area. The ✎ sections are
 * the reader's, left as prompts rather than invented prose.
 */
export function buildReport({ area, context = {}, readings = [], project = null, generated = new Date() }) {
  const geo = areaGeometry(area.polys);
  const done = readings.filter((r) => r.assessment);
  const date = generated.toISOString().slice(0, 10);
  const ref = `SR-${date.replace(/-/g, "")}-${slug(area.name).slice(0, 12).toUpperCase()}`;
  const out = [];
  const say = (...lines) => out.push(...lines);
  say(`<!-- geoid-study-report area="${cell(area.id || area.name)}" signature="${cell(readingsSignature(readings))}" generated="${generated.toISOString()}" -->`);
  say(`# Risk to people — ${area.name}`, "");
  say(`*Draft prepared ${generated.toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" })} · reference ${ref}${project ? ` · project ${project}` : ""}*`, "");
  say("> Every number below was read by GeoID from the maps on the globe at the time shown; "
    + "the sections marked ✎ are yours to write. Rebuild from the GIS page to refresh the numbers — your ✎ text is kept.", "");

  // ── summary
  say("## Summary", "");
  const pop = done[0]?.assessment?.breakdowns?.[0];
  if (pop) say(`- **${fmtPeople(pop.total)} people** live in the study area (${fmtKm2(pop.areaKm2)} km², ${fmtNum(pop.density, 0)} per km²; WorldPop 2020).`);
  else if (geo) say(`- The study area covers ${fmtKm2(geo.areaKm2)} km².`);
  if (!done.length) say("- No hazard map has been read over this area yet: tick hazard maps on the GIS page and the risk reader reads each one here.");
  const ranked = done.map((r) => ({ r, b: r.assessment.breakdowns[0] }))
    .filter(({ b }) => b && !b.scheme.bands)
    .sort((x, y) => (y.b.veryHighHigh || 0) - (x.b.veryHighHigh || 0));
  if (ranked.length) {
    const top = ranked[0];
    say(`- ${ranked.length} hazard map${ranked.length === 1 ? "" : "s"} read. The most people at very high or high risk: **${top.r.assessment.hazard}** — ${fmtPeople(top.b.veryHighHigh)} people (${fmtPct(top.b.total ? top.b.veryHighHigh / top.b.total : NaN)} of the area).`);
  }
  for (const r of done) if (r.assessment.summaryText) say(`- ${r.assessment.summaryText}`);
  say("");

  // ── context
  say("## The study area", "");
  if (geo) {
    say(row(["", ""]), "|---|---|");
    say(row(["Centre", `${fmtDeg(geo.centroid.lat, "N", "S")}, ${fmtDeg(geo.centroid.lon, "E", "W")}`]));
    say(row(["Extent", `${fmtDeg(geo.box.west, "E", "W")} to ${fmtDeg(geo.box.east, "E", "W")}, ${fmtDeg(geo.box.south, "N", "S")} to ${fmtDeg(geo.box.north, "N", "S")}`]));
    say(row(["Area", `${fmtKm2(geo.areaKm2)} km²${area.polys.length > 1 ? ` in ${area.polys.length} polygons` : ""}`]));
    const el = context.elevation;
    if (el) say(row(["Elevation", `${fmtNum(el.min, 0)} to ${fmtNum(el.max, 0)} m, mean ${fmtNum(el.mean, 0)} m (relief ${fmtNum(el.max - el.min, 0)} m; ${el.n} points, streamed DEM)`]));
    const cl = context.climate;
    if (cl && Number.isFinite(cl.tempC)) say(row(["Climate", `mean 2 m temperature ${cl.tempC.toFixed(1)} °C, surface pressure ${(cl.pressurePa / 1000).toFixed(1)} kPa at the centre (NASA POWER / MERRA-2, 2001–2020, downscaled to the ground)`]));
    if (pop) say(row(["Population", `${fmtPeople(pop.total)} (${fmtNum(pop.density, 0)} per km², WorldPop 2020 constrained 1 km)`]));
    say("");
  }
  const pl = context.places;
  if (pl && (pl.inside.length || pl.near.length)) {
    if (pl.inside.length) say(`**Named places inside:** ${pl.inside.map((p) => `${p.name}${p.type ? ` (${String(p.type).toLowerCase()})` : ""}`).join(", ")}${pl.insideMore ? `, and ${pl.insideMore} more` : ""}.`, "");
    if (pl.near.length) say(`**Nearest outside:** ${pl.near.map((p) => `${p.name} ${Math.round(p.km)} km ${p.bearing}`).join(", ")}.`, "");
  }
  for (const u of context.units || []) {
    if (!u.tally?.rows?.length) continue;
    say(`**${u.layer}** under the area (${u.tally.n} sample points): `
      + `${u.tally.rows.map((t) => `${t.name} ${fmtPct(t.share)}`).join("; ")}${u.tally.more ? `; and ${u.tally.more} more` : ""}.`, "");
  }
  say("## Setting", "", WRITING.Setting, "");

  // ── findings
  if (done.length) {
    say("## Findings by hazard", "");
    for (const r of done) {
      const a = r.assessment;
      say(`### ${a.hazard} — ${a.layer}${a.frame ? ` (${a.frame})` : ""}`, "");
      if (a.summaryText) say(a.summaryText, "");
      a.breakdowns.forEach((b, k) => {
        say(`**${b.scheme.measure}${b.scheme.unit ? ` (${b.scheme.unit})` : ""}**${k ? " — second reading" : ""}`, "");
        if (b.scheme.definition) say(`*${b.scheme.definition}*`, "");
        say(breakdownTable(b), "");
        const s = statsLine(b);
        if (s) say(`- ${s}`);
        if (Number.isFinite(b.expectedPerYear)) say(`- Expected people reached in an average year: **${fmtPeople(b.expectedPerYear)}**.`);
        if (b.edgeShare > 0.05) say(`- ${fmtPct(b.edgeShare)} of the people are in cells the area only partly covers; their count is shared by area.`);
        say("");
      });
      if (a.byPolygon?.length > 1) {
        say(row(["Polygon", "People", "Area km²", "Exposed", "Share exposed"]), "|---|---:|---:|---:|---:|");
        for (const p of a.byPolygon) say(row([p.name, fmtPeople(p.breakdown.total), fmtKm2(p.breakdown.areaKm2), fmtPeople(p.breakdown.exposed), fmtPct(p.breakdown.exposedShare)]));
        say("");
      }
      if (a.hazardNote) say(`> ${a.hazardNote}`, "");
      if (a.source) say(`*Source: ${a.source}.*`, "");
    }
  }

  // ── comparison
  if (done.length > 1) {
    say("## Across hazards", "");
    say(row(["Hazard map", "People exposed", "Very high + high", "Share of the area", "Expected per year"]), "|---|---:|---:|---:|---:|");
    for (const r of done) {
      const b = r.assessment.breakdowns[0];
      say(row([`${r.assessment.hazard} — ${r.assessment.layer}`, fmtPeople(b.exposed), b.scheme.bands ? "n/a (value bands)" : fmtPeople(b.veryHighHigh),
        fmtPct(b.total ? (b.scheme.bands ? b.exposed : b.veryHighHigh) / b.total : NaN), Number.isFinite(b.expectedPerYear) ? fmtPeople(b.expectedPerYear) : "—"]));
    }
    say("", "*A person can be exposed to several hazards; the rows are not added.*", "");
  }

  // ── method
  say("## Method and data", "");
  say("- **Population:** WorldPop 2020 constrained 1 km counts; a cell the area only partly covers contributes its area share.");
  say("- **Hazard levels:** each map's own published scheme, stated with its threshold beside each class above. People on ground a map does not cover are counted as *no reading*, never as safe.");
  const seen = new Set();
  for (const r of done) {
    const s = r.assessment.source;
    if (s && !seen.has(s)) { seen.add(s); say(`- **${r.assessment.hazard}:** ${s}.`); }
  }
  if (context.elevation) say("- **Elevation:** the streamed DEM (Mapzen Terrain Tiles, AWS Open Data) at the sample points.");
  if (context.climate) say("- **Climate:** NASA POWER (MERRA-2) 2001–2020 annual means, lapse-rate downscaled to the ground.");
  if (context.places) say("- **Places:** GeoID's gazetteer (Natural Earth, Wikidata, Smithsonian GVP).");
  say("");
  for (const title of ["Limitations", "Discussion", "Recommendations"]) say(`## ${title}`, "", WRITING[title], "");
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

/**
 * THE SECTIONS THAT ARE THE READER'S. Each holds only its prompt when built,
 * and a rebuild keeps whatever the reader has put there instead; every other
 * section is the numbers, and a rebuild replaces it whole — so a refreshed
 * reading can never leave a stale figure behind in a paragraph somebody wrote.
 */
export const WRITING = {
  Setting: "✎ *Describe the setting: what the area is, who lives there, what it is used for.*",
  Limitations: "✎ *What the numbers cannot say here: model scales, data dates, what was not mapped.*",
  Discussion: "✎ *What the findings mean for this place.*",
  Recommendations: "✎ *What should be done, by whom, and how soon.*",
};

/** `## Title` → its body (without the heading), for a Markdown document. */
export function sectionsOf(md) {
  const map = new Map();
  for (const part of String(md).split(/^(?=## )/m)) {
    const m = /^## (.+)\n?/.exec(part);
    if (m) map.set(m[1].trim(), part.slice(m[0].length).trim());
  }
  return map;
}

/** The rebuilt document with the reader's writing sections carried across. */
export function mergeWriting(oldMd, newMd) {
  const before = sectionsOf(oldMd);
  return String(newMd).split(/^(?=## )/m).map((part) => {
    const m = /^## (.+)\n?/.exec(part);
    if (!m) return part;
    const title = m[1].trim();
    const kept = before.get(title);
    if (!(title in WRITING) || !kept || kept === WRITING[title]) return part;
    return `## ${title}\n\n${kept}\n\n`;
  }).join("");
}

/* ── Markdown to HTML (preview and print) ─────────────────────────────── */

function esc(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/** Inline: **bold**, *italic*, `code`; escaped first, so nothing in the text is markup. */
export function inline(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
}

/** Headings, paragraphs, lists, tables, block quotes and comments — what a report uses. */
export function markdownToHtml(md) {
  const lines = String(md).split(/\r?\n/);
  const out = [];
  let i = 0;
  const splitRow = (l) => l.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
  while (i < lines.length) {
    const line = lines[i];
    if (/^<!--.*-->$/.test(line.trim())) { i += 1; continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i += 1; continue; }
    if (/^\|/.test(line.trim()) && /^\|?\s*:?-{3,}/.test((lines[i + 1] || "").trim())) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) => (/^-+:$/.test(c) ? "right" : "left"));
      i += 2;
      const body = [];
      while (i < lines.length && /^\|/.test(lines[i].trim())) { body.push(splitRow(lines[i])); i += 1; }
      const th = head.some((c) => c) ? `<thead><tr>${head.map((c, k) => `<th style="text-align:${align[k] || "left"}">${inline(c)}</th>`).join("")}</tr></thead>` : "";
      out.push(`<table>${th}<tbody>${body.map((r) => `<tr>${r.map((c, k) => `<td style="text-align:${align[k] || "left"}">${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const q = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, "")); i += 1; }
      out.push(`<blockquote>${inline(q.join(" "))}</blockquote>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^[-*]\s+/, "")); i += 1; }
      out.push(`<ul>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</ul>`);
      continue;
    }
    if (line.trim()) {
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|[-*]\s|>|\|)/.test(lines[i]) && !/^<!--/.test(lines[i].trim())) { para.push(lines[i]); i += 1; }
      out.push(`<p>${inline(para.join(" "))}</p>`);
      continue;
    }
    i += 1;
  }
  return out.join("\n");
}

/** A self-contained, print-ready page for the browser's Save as PDF. */
export function printableHtml(md, title) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
@page { size: A4; margin: 18mm 16mm; }
body { font: 10.5pt/1.5 "Helvetica Neue", Arial, sans-serif; color: #1b1d22; max-width: 52rem; margin: 2rem auto; padding: 0 1rem; }
h1 { font-size: 20pt; margin: 0 0 0.3rem; } h2 { font-size: 13pt; margin: 1.6rem 0 0.4rem; border-bottom: 1px solid #ccd; padding-bottom: 0.2rem; }
h3 { font-size: 11pt; margin: 1.2rem 0 0.3rem; } table { border-collapse: collapse; width: 100%; margin: 0.4rem 0 0.8rem; font-size: 9.5pt; }
th, td { border-bottom: 1px solid #dde; padding: 0.25rem 0.4rem; } th { background: #f2f3f7; }
blockquote { margin: 0.6rem 0; padding: 0.4rem 0.8rem; border-left: 3px solid #8a8fa8; color: #444; background: #f7f7fa; }
code { font-family: Menlo, monospace; font-size: 9pt; } em { color: #444; }
@media print { body { margin: 0; } h2 { break-after: avoid; } table { break-inside: avoid; } }
</style></head><body>
${markdownToHtml(md)}
<script>if (location.hash === "#print") setTimeout(function () { window.print(); }, 300);</script>
</body></html>`;
}
