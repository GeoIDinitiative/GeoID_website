/**
 * The feed registry and its conversions.
 *
 * Everything here is a rule that fails SILENTLY on a map: a magnitude read
 * from the wrong field is null rather than an error, a time read in seconds
 * puts every earthquake in 1970 with the ordering intact, and a depth taken as
 * an elevation is a plausible number that means something else. So each is
 * pinned against a record shaped exactly like the one USGS serves.
 */

import {
  SOURCES, FEED_GROUPS, sourceById, sourcesInGroup, activeGroups, groupState,
  defaultEnabled, usgsPoints, magnitudeSize, recencyOpacity,
  MAGNITUDE_RAMP, magnitudeColour, restoreSources, gdacsPoints, gdacsUrl,
  resolveColour, liftForAltitude, dotSizePx, nearSizePx, isQuake, publisherOf,
  sourcesOff, restoreActive, stormCategory, stormScale, stormLabel, STORM_BASE_CAP,
  SAFFIR_SIMPSON_KTS,
  MARKER_LIFT_MAX, MARKER_LIFT_M, DOT_CAP_FAR, DOT_CAP_NEAR,
}  from "./event-sources.js";
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;

function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass += 1; console.log(`PASS ${name}`); } else {
    fail += 1;
    console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  }
}

const ok = (name, got) => check(name, Boolean(got), true);

/* ── the registry ─────────────────────────────────────────────────────────── */

check("every source has an id, a label and a licence",
  SOURCES.filter((s) => s.id && s.label && s.licence).length, SOURCES.length);
check("ids are unique", new Set(SOURCES.map((s) => s.id)).size, SOURCES.length);
check("every usgs source carries a url",
  SOURCES.filter((s) => s.kind === "usgs" && !s.url).length, 0);
check("sourceById finds one", sourceById("quakes-day")?.kind, "usgs");
check("sourceById refuses an unknown id", sourceById("nope"), null);
// The default must draw something: a mode that opens empty reads as broken.
ok("something is on by default", defaultEnabled().length > 0);
ok("seismicity is on by default", defaultEnabled().includes("quakes-day"));

/* ── the subsections ──────────────────────────────────────────────────────── */

check("every source names a group that exists",
  SOURCES.filter((s) => !FEED_GROUPS.some((g) => g.id === s.group)).length, 0);
// A group with no rows renders an empty fold, which reads as something broken
// rather than as something absent.
check("no group is declared and left empty", activeGroups().length, FEED_GROUPS.length);
check("every group carries a label and a note",
  FEED_GROUPS.filter((g) => g.label && g.note).length, FEED_GROUPS.length);
ok("seismicity holds the three USGS windows",
  sourcesInGroup("seismic").filter((s) => s.kind === "usgs").length === 3);
// Everything here HAPPENED, with a time and a place. Faults and plate
// boundaries were briefly rows in this list; they are permanent features of
// the ground, so they are vector layers like a coastline is, and they live in
// global-data.js under Tectonics with every other one.
check("nothing here is a standing feature rather than an event",
  SOURCES.filter((s) => !["eonet", "usgs", "gdacs"].includes(s.kind)).length, 0);
check("faults are not offered as a feed", sourceById("faults"), null);
check("nor are plate boundaries", sourceById("plates"), null);
check("every source names a category to colour and group by",
  SOURCES.filter((s) => !s.category).length, 0);
// EONET's own earthquakes category is empty almost always and would double
// every USGS event that it did carry, under a different id.
check("EONET earthquakes is not offered beside the USGS feeds",
  SOURCES.some((s) => s.kind === "eonet" && s.category === "earthquakes"), false);
check("wildfires are still offered",
  SOURCES.some((s) => s.kind === "eonet" && s.category === "wildfires"), true);

/* ── the master toggle's three states ─────────────────────────────────────── */

const seismic = sourcesInGroup("seismic").map((s) => s.id);
check("all on", groupState("seismic", (id) => seismic.includes(id)),
  { total: 3, on: 3, all: true, none: false, indeterminate: false });
check("all off", groupState("seismic", () => false),
  { total: 3, on: 0, all: false, none: true, indeterminate: false });
// The state that matters: a box showing "off" over a group with one of three
// rows on is saying something false about the map.
check("some on is neither", groupState("seismic", (id) => id === seismic[0]),
  { total: 3, on: 1, all: false, none: false, indeterminate: true });
check("an unknown group is empty rather than an error",
  groupState("nope", () => true), { total: 0, on: 0, all: false, none: true, indeterminate: false });

/* ── restoring a remembered choice ───────────────────────────────────────── */

/**
 * The bug this section exists for: EONET was ONE row (`"eonet"`) covering every
 * category, and splitting it into a row per category renamed that id out of
 * existence. A plain `filter(sourceById)` then dropped it, so anybody who had
 * used the mode before the split came back with the earthquakes and nothing
 * else — no error, the panel and the globe agreeing with each other and both
 * wrong.
 */
const eonetIds = SOURCES.filter((s) => s.kind === "eonet").map((s) => s.id);

check("nothing stored gives the defaults",
  [...restoreSources(null)].sort(), defaultEnabled().sort());
check("rubbish stored gives the defaults",
  [...restoreSources("wat")].sort(), defaultEnabled().sort());
// EVERY source is a default. A row that ships off is a row somebody has to
// find before the feed can show what it says it shows.
check("and the defaults are every source", defaultEnabled().length, SOURCES.length);

/* ── what is remembered is what was switched OFF ─────────────────────────── */
// The whole reason for the shape. A stored ON-list is a record of what EXISTED
// when it was written, so a source added since is absent from it and reads as
// "switched off" for ever. Measured on a real set stored before the flood and
// severe-storm rows shipped: the entire Storms and water group came back off,
// on a page nobody had touched.
const off = restoreSources({ off: ["eonet-drought"] });
check("an explicit off stays off", off.has("eonet-drought"), false);
check("and everything else is on", off.size, SOURCES.length - 1);
check("a source added LATER is on, because it is in no off-list",
  ["gdacs-floods", "eonet-severeStorms", "eonet-floods"].every((id) => off.has(id)),
  true);
check("an off-list naming a source that no longer exists is ignored, not fatal",
  restoreSources({ off: ["gone"] }).size, SOURCES.length);
check("an empty off-list is every source",
  restoreSources({ off: [] }).size, SOURCES.length);
// Every feed off is a state somebody can hold. Refusing to draw nothing is the
// MODE's question (restoreActive), not this one.
check("all of them off is respected rather than second-guessed",
  restoreSources({ off: defaultEnabled() }).size, 0);
check("the complement is what gets written",
  sourcesOff(new Set(defaultEnabled().filter((id) => id !== "eonet-snow"))),
  ["eonet-snow"]);
check("and nothing off writes nothing", sourcesOff(new Set(defaultEnabled())), []);

/* ── the legacy on-list turns everything on, once ────────────────────────── */
// In that format a missing id means "switched off" OR "did not exist yet", and
// nothing stored tells them apart. Reading it as a decision is what kept new
// feeds dark. This supersedes the one-row EONET expansion, which was the same
// repair written narrowly for one rename.
check("a legacy on-list opens everything",
  [...restoreSources(["quakes-day", "eonet-wildfires"])].sort(),
  defaultEnabled().sort());
check("including the old one-row EONET",
  eonetIds.every((id) => restoreSources(["eonet", "quakes-day"]).has(id)), true);
check("and the id that no longer names a source is not kept",
  restoreSources(["eonet", "quakes-day"]).has("eonet"), false);
check("a legacy list of nothing recognisable still opens everything",
  [...restoreSources(["gone", "also-gone"])].sort(), defaultEnabled().sort());

/* ── and events.js writes that shape, pinned on its source ───────────────── */
// The storage shape has one owner. If `rememberSources` ever writes the live
// set again instead of its complement, every check above goes on passing while
// the fault comes straight back.
const eventsSrc = readFileSync(new URL("./events.js", import.meta.url), "utf8");
check("the off-list is written, never the on-list",
  /setItem\(STORE_KEY, JSON\.stringify\(sourcesOff\(enabled\)\)\)/.test(eventsSrc), true);
check("under a NEW key, so a cached page mid-deploy cannot read one as the other",
  /STORE_KEY = "geoid-gis:event-sources-off"/.test(eventsSrc), true);
check("and the old key is read once and retired",
  /removeItem\(LEGACY_STORE_KEY\)/.test(eventsSrc), true);

/* ── the USGS conversion ──────────────────────────────────────────────────── */

const source = sourceById("quakes-day");
const feed = {
  features: [
    {
      id: "us7000abcd",
      geometry: { type: "Point", coordinates: [-117.5, 34.2, 12.34] },
      properties: {
        mag: 4.6, place: "10 km SW of Somewhere", time: 1745000000000,
        url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd",
        felt: 42, tsunami: 0, title: "M 4.6 - 10 km SW of Somewhere",
      },
    },
    // A real record with no determined magnitude.
    {
      id: "us7000efgh",
      geometry: { type: "Point", coordinates: [140.1, 35.6, 0] },
      properties: { mag: null, place: "Off Honshu", time: 1745000100000, tsunami: 1 },
    },
    // Rubbish that must not become a marker at 0°N 0°E.
    { id: "broken", geometry: { type: "Point", coordinates: [null, null] }, properties: {} },
    { id: "no-geometry", properties: { mag: 3 } },
  ],
};

const points = usgsPoints(feed, source);
check("unplaceable records are dropped, not defaulted", points.length, 2);

const [first, second] = points;
check("longitude is the FIRST coordinate", first.lon, -117.5);
check("latitude is the second", first.lat, 34.2);
// The trap: the third coordinate is a depth in km, not an elevation.
check("depth comes from the third coordinate", first.depthKm, 12.34);
check("magnitude is carried", first.magnitude, 4.6);
// Epoch MILLISECONDS. A thousandfold error orders correctly and dates wrongly.
check("time is kept in milliseconds", first.timeMs, 1745000000000);
check("the year is this century", new Date(first.timeMs).getUTCFullYear() > 2000, true);
check("the id is the USGS id, so feeds merge", first.id, "us7000abcd");
check("every point is filed under earthquakes", first.categoryId, "earthquakes");
check("the source is recorded on the point", first.sourceId, "quakes-day");
check("the detail line reads", first.detail, "M 4.6 · 12 km deep · 10 km SW of Somewhere");

check("a null magnitude is null, not zero", second.magnitude, null);
check("and it says so rather than printing M null",
  second.detail.startsWith("magnitude undetermined"), true);
check("tsunami is a flag, not a count", second.tsunami, true);
check("a missing title falls back to the place", second.title, "Off Honshu");

// A zero depth is a real reading — the surface — and must survive the guard
// that drops missing ones.
check("zero depth is kept", second.depthKm, 0);

check("an empty payload is an empty list", usgsPoints(null, source), []);
check("a payload with no features is too", usgsPoints({}, source), []);

/* ── marker size ──────────────────────────────────────────────────────────── */

const base = 6;
const near = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;

check("no magnitude is the base size", magnitudeSize(null, base), base);
check("nothing is smaller than the base", magnitudeSize(1, base) >= base, true);
check("an M2.5 — the smallest the day feed publishes — IS the base",
  magnitudeSize(2.5, base), base);
check("nothing is more than four times it", magnitudeSize(9.5, base) <= base * 4, true);
check("and an M8.5 is exactly that", near(magnitudeSize(8.5, base), base * 4), true);
ok("bigger earthquakes are bigger", magnitudeSize(7, base) > magnitudeSize(4, base));

/**
 * The size law, which is the point of this function.
 *
 * Magnitude is logarithmic, so an even mapping is a fixed RATIO per magnitude
 * unit — a fixed number of pixels per unit spends the range on the difference
 * between an M2.5 and an M4 and has nothing left for M6 to M8. The chosen
 * compression is a doubling of width every three units.
 */
check("width doubles every three magnitude units",
  near(magnitudeSize(5.5, base) / magnitudeSize(2.5, base), 2), true);
check("and again for the next three",
  near(magnitudeSize(8.5, base) / magnitudeSize(5.5, base), 2), true);
// The ratio is the same wherever it is measured, which a linear law cannot do.
const ratios = [3, 4, 5, 6, 7].map((m) => magnitudeSize(m + 1, base) / magnitudeSize(m, base));
check("one step is one ratio, anywhere in the range",
  ratios.every((r) => near(r, ratios[0], 1e-12)), true);
check("that ratio is the cube root of two", near(ratios[0], 2 ** (1 / 3)), true);
// Monotonic across the whole usable range, or two bands could swap.
let monotone = true;
for (let m = 1; m < 9; m += 0.5) {
  if (magnitudeSize(m + 0.5, base) < magnitudeSize(m, base)) monotone = false;
}
check("size never falls as magnitude rises", monotone, true);
check("the base scales the whole curve", magnitudeSize(6, 12), magnitudeSize(6, 6) * 2);

/* ── magnitude as a colour ────────────────────────────────────────────────── */

const rgbOf = (hexColour) => [1, 3, 5].map((i) => parseInt(hexColour.slice(i, i + 2), 16));

check("the ramp is ordered by magnitude",
  MAGNITUDE_RAMP.every((s, i) => i === 0 || s.m > MAGNITUDE_RAMP[i - 1].m), true);
check("below the ramp takes its low end", magnitudeColour(0.5), magnitudeColour(2.0));
check("above it takes the high end", magnitudeColour(11), magnitudeColour(8.0));
// An undetermined magnitude is usually a small unreviewed event; painting it
// mid-ramp states something the record does not.
check("no magnitude takes the low end, not the middle",
  magnitudeColour(null), magnitudeColour(2.0));
check("a stop returns itself exactly", magnitudeColour(5.0), "#ffbe28");
// Halfway between two stops is halfway between two colours, or the ramp has
// bands in it rather than a gradient.
check("it interpolates between stops", magnitudeColour(4.25), "#d5c82b");
check("every value is a six-digit hex",
  [1, 2, 3.7, 5, 6.2, 7, 9].every((m) => /^#[0-9a-f]{6}$/.test(magnitudeColour(m))), true);
// GREEN to RED, the reading every hazard map has trained people in.
const ramp = [2, 3.5, 5, 6.5, 8].map((m) => rgbOf(magnitudeColour(m)));
check("red rises all the way up the ramp",
  ramp.every((c, i) => i === 0 || c[0] >= ramp[i - 1][0]), true);
check("and green falls all the way up it",
  ramp.every((c, i) => i === 0 || c[1] <= ramp[i - 1][1]), true);
check("the small end is unmistakably green", ramp[0][1] > ramp[0][0] && ramp[0][1] > ramp[0][2], true);
check("the big end is unmistakably red", ramp[4][0] > ramp[4][1] && ramp[4][0] > ramp[4][2], true);
// The middle must not be mud: interpolating green straight to red crosses a
// dark olive exactly where the M5s are, so the ramp goes through yellow.
const middle = rgbOf(magnitudeColour(5));
check("the middle of the ramp is bright, not olive", middle[0] > 200 && middle[1] > 150, true);
// It moves in HUE, not in brightness. Ending in a dark crimson is the obvious
// way to say "more" and the wrong way to say it on a black globe: multiplied
// by the recency fade, an older M8 came out #170003 -- the largest earthquake
// on the map, drawn nearly invisible.
check("every stop stays luminous",
  ramp.every((c) => Math.max(...c) >= 200), true);
ok("and survives the recency floor",
  ramp.every((c) => Math.max(...c) * recencyOpacity(0, 1, 1) > 120));

/* ── recency ──────────────────────────────────────────────────────────────── */

const now = 1745000000000;
const day = 24 * 3600 * 1000;
check("right now is full strength", recencyOpacity(now, now, day), 1);
check("a full window back is the floor", recencyOpacity(now - day, now, day), 0.65);
check("older than the window stays at the floor",
  recencyOpacity(now - 10 * day, now, day), 0.65);
check("half a window back is halfway", recencyOpacity(now - day / 2, now, day), 0.825);
// A clock skew must not brighten something past full.
check("a future timestamp is clamped, not amplified",
  recencyOpacity(now + day, now, day), 1);
check("no timestamp gets a sensible middle", recencyOpacity(null, now, day), 0.82);

/* ── GDACS floods ────────────────────────────────────────────────────────── */

{
  const payload = { features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [138.78, -35.45] },
      properties: { eventtype: "FL", eventid: 102938, name: "Flood in Australia",
        alertlevel: "Orange", fromdate: "2026-08-24T01:00:00", todate: "2026-08-26T01:00:00",
        url: { report: "https://www.gdacs.org/report.aspx?eventid=102938" } } },
    { type: "Feature", geometry: { type: "Point", coordinates: [null, 3] }, properties: {} },
  ] };
  const points = gdacsPoints(payload, { id: "gdacs-floods" });
  check("a GDACS flood converts with its alert level in the title",
    points.length === 1 && points[0].title === "Flood in Australia — Orange alert", true);
  check("its id is namespaced against every other registry",
    points[0].id === "gdacs:102938", true);
  check("the flood wears EONET's flood category so the symbols agree",
    points[0].categoryId === "floods", true);
  check("the report link and the window's end survive",
    points[0].link.includes("102938") && points[0].date === "2026-08-26T01:00:00", true);
  check("a feature with no coordinates is dropped, not a crash",
    gdacsPoints({ features: [{ geometry: {} }] }, { id: "x" }).length === 0, true);
  check("the url asks SEARCH for FL with all alert levels",
    /SEARCH\?fromDate=\d{4}-\d{2}-\d{2}&toDate=\d{4}-\d{2}-\d{2}&alertlevel=Green;Orange;Red&eventlist=FL$/.test(gdacsUrl()), true);
}

/* ── the symbology the legend promises has to reach the globe ──────────────
   Reported: "aside from the earthquakes, none of the EONET live events have
   the symbologies mapped as they should be as shown in the legend." Two
   independent causes, and both were silent. */
{
  /* A CSS custom property is fine in the panel and unreadable by THREE, which
     warns and keeps white. Measured against the live skin: the panel drew
     #ff2bd6 and #00e5ff, the markers #ffffff. */
  check("a var() is resolved against the document's own skin",
    resolveColour("var(--skin-chrome)", () => "#ff2bd6"), "#ff2bd6");
  check("whitespace inside the var() is not part of the name",
    resolveColour("var( --skin-data )", (n) => (n === "--skin-data" ? "#00e5ff" : "")), "#00e5ff");
  check("a plain colour is passed straight through",
    resolveColour("#ff6b2c"), "#ff6b2c");
  check("a var() with a fallback uses it when the skin says nothing",
    resolveColour("var(--nope, #123456)", () => ""), "#123456");
  /* Returning the var() text is better than returning white: THREE warns on
     it, so an unresolvable colour is visible in the console rather than
     silently drawn as the wrong thing. */
  check("an unresolvable var() with no fallback is not quietly turned white",
    resolveColour("var(--nope)", () => ""), "var(--nope)");

  /* And the glyphs. The earthquakes had their own texture -- three concentric
     rings, the one the panel shows -- while every other category shared one
     soft round blob, so a legend offering a triangle, a diamond, a ring and a
     bar drew four identical dots. */
  const src = readFileSync(new URL("./events.js", import.meta.url), "utf8");
  check("the marker map is the category's own symbol",
    /map: isQuakeBand\(key\) \? quakeTexture\(\) : glyphTexture\(symbolFor\(key\)\)/.test(src),
    true);
  /* The whole SYMBOL, not its character: one that carries a painter has a
     `glyph` too — its fallback — and passing that would hand the drawn mark
     whatever texture the fallback character had already built. */
  check("and it is keyed by what is drawn rather than by the stand-in character",
    /const key = symbol\?\.mark \? `mark:\$\{symbol\.mark\}` :/.test(src), true);
  check("one texture per GLYPH, so two categories drawn with the same symbol share it",
    /glyphSprites\.has\(key\)/.test(src) && /glyphSprites\.set\(key, built\)/.test(src), true);
  check("the one-blob-for-everything texture is gone", /markerTexture\s*\(\s*\)\s*\{/.test(src), false);
  /* Drawn over imagery at a few pixels: a thin white glyph on a pale coast is
     invisible, so the outline is not decoration. */
  check("the glyph is stroked as well as filled", /strokeText\(/.test(src) && /fillText\(/.test(src), true);
  /* Painted white and tinted by the material, exactly as the quake rings are,
     or every category would need its own canvas. */
  check("the glyph is painted white and tinted by the material",
    /ctx\.fillStyle = "#ffffff"/.test(src), true);

  /* `textBaseline: "middle"` centres the EM BOX, and a geometric glyph does
     not fill it the way a letter does. Measured on the first cut: the wildfire
     dot came out 6 px of ink near the top of the canvas and NOTHING in the
     lower half, and the flood bar sat entirely below the middle -- both
     centred exactly as asked, both a smudge in the corner of an 8 px sprite.
     After fitting, every glyph's ink centres on the canvas centre. */
  check("the glyph is fitted to its own ink, not to the em box",
    /const probe = ctx\.getImageData\(0, 0, canvas\.width, canvas\.height\)\.data/.test(src)
    && /ctx\.clearRect\(0, 0, canvas\.width, canvas\.height\)/.test(src), true);

  /* Banding by magnitude used to mean "did not come from EONET", which was
     true of the seismicity and of nothing else -- until the GDACS floods
     arrived with a source id, no magnitude, and landed in the quake-3 band:
     drawn with the earthquake's rings and coloured from the middle of the
     magnitude ramp. */
  check("only something with a magnitude is banded by magnitude",
    /event\.categoryId !== "earthquakes" \|\| !Number\.isFinite\(event\.magnitude\)/.test(src),
    true);

  /* A pulse on every category is a map that will not sit still to be read; it
     belongs on the feeds reporting something still happening. */
  check("what breathes is decided by the symbol table, not by a condition",
    /points\.userData\.pulse = isQuakeBand\(key\) \|\| Boolean\(symbolFor\(key\)\.pulse\)/.test(src),
    true);
  check("the volcanoes are red and they pulse",
    /volcanoes: \{ colour: "#ff2d2d", glyph: "▲", label: "Volcanoes", pulse: true \}/.test(src),
    true);
  check("and the wildfires are an orange round dot",
    /wildfires: \{ colour: "#ff6b2c", glyph: "●", label: "Wildfires" \}/.test(src), true);
  check("the floods are a dot too, in their own blue",
    /floods: \{ colour: "#2f6bff", glyph: "●", label: "Floods" \}/.test(src), true);
}

/* ── a sprite is centred on its point, which is half a symbol of float ─────
   THREE.Points draws a screen-aligned quad centred on the coordinate, so half
   the symbol is always above the ground it marks. Invisible while the symbol
   is small and glaring once it is not: at 8.9 px the volcanoes were reported
   as fine, and at 34 px -- the size asked for so they would stay distinct
   close in -- every category was reported as floating. Seventeen pixels at
   20 km altitude is about 750 m of apparent height. */
{
  const src = readFileSync(new URL("./events.js", import.meta.url), "utf8");
  check("a category glyph stands on its point rather than straddling it",
    src.includes("bring its BASE to the canvas' own centre")
    && src.includes("const offY = -(inkH * scale) / 2 - (centreY - size / 2) * scale;"),
    true);
  /* A THREE.Points quad is square, so a 1:2 canvas would be squashed into it:
     the ink lives in the upper half of a square instead. */
  check("on a square canvas, with the ink fitted to half its height",
    /canvas\.height = size;/.test(src) && /\(size \* 0\.46\) \/ inkH/.test(src), true);
  check("and the sprite is asked for at twice the size to buy that half back",
    /const GLYPH_FOOT_SCALE = 2;/.test(src)
    && /: GLYPH_FOOT_SCALE;/.test(src), true);
  /* Concentric rings mean energy radiating FROM a point. Standing them on the
     epicentre would say something else -- the one symbol here whose meaning is
     that it is centred. */
  check("the earthquake rings keep their centre",
    /rings keep their centre/.test(src), true);
}

/* ── the base cap belongs to the multiplier, not to the pulse ─────────────
   It read `pulsing ? …` because for a long time the only thing that breathed
   was the seismicity -- and the seismicity is the only thing that multiplies
   this base, by 2.1 to 6.8 for magnitude and symbol. The cap stops a
   close-range M8 reaching 103 px; it was never about breathing. Giving the
   volcanoes a pulse therefore capped them at eight pixels with nothing to
   multiply it back: measured at 20 km, every other category was 34 px and the
   volcanoes 8.9. */
{
  const src = readFileSync(new URL("./events.js", import.meta.url), "utf8");
  check("the base is capped for what is about to be multiplied",
    /const from = cap \? Math\.min\(size, cap\) : size;/.test(src), true);
  /* Per BAND, not one number for everything that multiplies: a storm's symbol
     carries more detail than a ring and goes small sooner, so it caps higher. */
  check("and each band caps at its own value, not everything that pulses",
    /points\.userData\.baseCap = isQuakeBand\(key\) \? QUAKE_BASE_CAP/.test(src)
    && /isStormBand\(key\) \? STORM_BASE_CAP : null;/.test(src), true);
  check("so a category dot keeps the size the view gave it",
    !/const from = pulsing \? Math\.min/.test(src), true);
}

/* ── the annotation, and the rule that stops it becoming a mess ───────────
   Events cluster: the densest square degree in the live feed held 20 of them.
   Three rules decide what gets a name, and the source is where they live. */
{
  const src = readFileSync(new URL("./events.js", import.meta.url), "utf8");
  check("only close in", /altitudeMetres > LABEL_ALTITUDE_M/.test(src)
    && /const LABEL_ALTITUDE_M = 150000/.test(src), true);
  check("only a few, taken nearest the middle of the view",
    /if \(used >= LABEL_MAX\) break;/.test(src)
    && /Math\.hypot\(x - width \/ 2, y - height \/ 2\)/.test(src), true);
  check("and never overlapping — a label that cannot be placed is not drawn",
    /const clashes = placed\.some/.test(src)
    && /if \(clashes\) \{ chip\.style\.display = "none"; continue; \}/.test(src), true);
  /* Measured over the Aleutians at 150, 80, 40 and 15 km: 7 to 8 chips and
     zero overlapping pairs at every one. */
  check("nothing behind the globe is named", /world\.dot\(camera\.position\) <= 0/.test(src), true);
  /* The chips are DOM and outlive the frame loop unless taken down with it. */
  check("switching the feed off takes the chips down",
    /if \(!active\) \{ sizeFrame = null; hideLabels\(\); return; \}/.test(src), true);
  check("and they never eat a click meant for the marker",
    /pointer-events:none/.test(src), true);
}

/* ── the markers as you come down ──────────────────────────────────────────
   "These event symbols suffer as we zoom in — they become less distinct...
   note these event location dots should be tight to surface (currently
   float)." Both were one measurement away. */
{
  const KM = (units) => (units / 3.2) * 6371;

  /* THE CLEARANCE IS A GROUND MEASUREMENT, NOT A CAMERA ONE. It was a flat
     11.9 km, then a fraction of the altitude -- which fixed the close range
     and left the middle distance exactly as wrong: measured against the
     rendered terrain over Nevados del Chillan at 123 km, the marker sat
     2,490 m above the ground. What the lift is for is the sampler disagreeing
     with the drawn mesh, measured at the same place and time as 20 m. */
  check("thirty metres, which is what it is for", MARKER_LIFT_M, 30);
  check("and the same thirty at every altitude", (() => {
    const at = [8e6, 1e6, 1.23e5, 3e4, 3e3, 100].map(liftForAltitude);
    return at.every((v) => v === at[0]);
  })(), true);
  check("which is 30 m on the ground, not 30 units of anything",
    Math.round(KM(MARKER_LIFT_MAX) * 1000), 30);
  /* It covers the 20 m the sampler and the mesh were measured to differ by,
     and nothing is hidden by having almost none: the markers do not depth
     test. */
  check("comfortably over the disagreement it exists for",
    KM(MARKER_LIFT_MAX) * 1000 >= 20, true);
  check("and nowhere near the old kilometres", KM(MARKER_LIFT_MAX) < 0.05, true);

  /* THE GLOBE'S PROJECTED RADIUS IS THE WRONG VARIABLE CLOSE IN: measured, it
     runs 815 px at a thousand kilometres and 945 at three, so `globePx *
     0.022` pinned the size at its cap through the whole close range while the
     imagery gained three hundred times the detail. */
  check("the far field is unchanged — the projection still decides it",
    +dotSizePx(434, 8_000_000).toFixed(1), 9.5);
  check("nothing is added above a thousand kilometres", nearSizePx(2_000_000), 0);
  check("and the near field grows where the projection has stopped",
    dotSizePx(945, 10_000) > dotSizePx(945, 1_000_000), true);
  check("reaching the near cap by twenty kilometres",
    +dotSizePx(945, 20_000).toFixed(1), DOT_CAP_NEAR);
  check("and never going past it", dotSizePx(1e6, 100) <= DOT_CAP_NEAR, true);
  check("a distant marker still stays clickable", dotSizePx(1, 8_000_000) >= 4, true);
  /* The two rules must meet without a step, or the markers jump at 1000 km. */
  check("the two rules meet smoothly at the hand-over", (() => {
    const above = dotSizePx(815, 1_010_000);
    const below = dotSizePx(815, 990_000);
    return Math.abs(above - below) < 0.5;
  })(), true);
  check("the far cap is what the near ramp starts from", nearSizePx(1_000_000 - 1) >= DOT_CAP_FAR, true);
}

/* ── the selection ring, anchored the way the symbol it circles is ─────────
   A category glyph STANDS ON its point -- the ink lives in the upper half of
   its canvas with the base on the coordinate -- while the earthquake rings
   stay centred. A ring centred on the coordinate therefore circles the right
   PLACE and the wrong PICTURE: reported on a flood, and the screenshot is a
   ring with the dot sitting on its top edge. The numbers below are what put
   the ring around the ink rather than around the coordinate. */
{
  const src = readFileSync(new URL("./events.js", import.meta.url), "utf8");
  const num = (name) => {
    const hit = new RegExp(`const ${name} = ([^;]+);`).exec(src);
    if (!hit) return NaN;
    // The constants are written as their own derivation.
    return Function(`"use strict";
      const GLYPH_FOOT_SCALE = ${/const GLYPH_FOOT_SCALE = ([\d.]+);/.exec(src)?.[1]};
      const GLYPH_INK = ${/const GLYPH_INK = ([\d.]+);/.exec(src)?.[1]};
      const INK_HEIGHT = GLYPH_INK * GLYPH_FOOT_SCALE;
      return (${hit[1]});`)();
  };
  const ink = num("INK_HEIGHT");
  const diameter = num("RING_DIAMETER");
  const foot = num("HALO_FOOT_SCALE");

  check("the ring is chosen by the same test the marker's texture is",
    /const foot = !isQuakeBand\(markerKey\(event\)\);/.test(src)
    && /map: ringTexture\(foot\)/.test(src), true);
  check("and the halo remembers which it is wearing",
    /halo\.userData\.foot = foot;/.test(src), true);
  check("the floor is on the dot, so the proportion holds at every size",
    /const dot = Math\.max\(9, px > 0 \? dotSizePx\(px, altitude\) : 8\);/.test(src),
    true);

  /* WHAT THE SOURCE ACTUALLY DRAWS, read back out of it rather than restated:
     the canvas fraction ringTexture puts the foot ring's centre at, and the
     fraction it gives its radius. */
  const drawn = (expr) => Function(`"use strict";
    const size = 1;
    const INK_HEIGHT = ${ink}; const HALO_FOOT_SCALE = ${foot};
    const RING_DIAMETER = ${diameter};
    return (${expr});`)();
  const centreFraction = drawn(
    /const cy = foot\s*\?\s*size \* \(([^)]+)\)/.exec(src)[1]);
  const radiusFraction = drawn(
    /const radius = foot \? (.+?) : size \* 0\.33;/.exec(src)[1]);

  /* The ink stands on the point, so its centre is half its height above it —
     and the quad's own centre IS the coordinate, so a canvas fraction f from
     the top sits (0.5 - f) sprite-widths above it. Derived here from the
     MARKER's constants and checked against what the ring is drawn at. */
  const wanted = 0.5 - (ink / 2) / foot;
  check("the ring's centre lands on the ink's centre",
    +centreFraction.toFixed(4), +wanted.toFixed(4));
  check("and its radius is half the diameter the centred ring draws",
    +radiusFraction.toFixed(4), +(diameter / 2 / foot).toFixed(4));
  check("it circles the ink rather than sitting inside it", diameter > ink, true);
  /* THE WHOLE REASON THE FOOT SPRITE IS BIGGER. At the centred scale the ring
     runs off the top of its own canvas and is drawn with a bite out of it. */
  const glow = 0.20 * (2 / 3) / 2;          // half the wide glow's line width
  check("and it fits inside the canvas, glow included",
    centreFraction - radiusFraction - glow > 0, true);
  check("with room below the coordinate too",
    centreFraction + radiusFraction + glow < 1, true);
  check("which the centred scale would not have given it",
    (0.5 - (ink / 2) / 2) - (diameter / 2 / 2) - glow < 0, true);
}

/* ── "should we really have a spectrogram for a flood event?" ──────────────
   No. `event.sourceId` means "did not come from EONET", which was true of the
   seismicity and of nothing else until GDACS arrived -- and read as "is an
   earthquake" it put magnitude and depth rows on a flood card, counted floods
   as earthquakes in the status line, labelled a GDACS link as the USGS
   record, and FETCHED A SEISMOGRAM. Measured on "Flood in China -- Orange
   alert": a trace from a station 687 km away, under a spectrogram, annotated
   "P read from the trace". The category is what the question is about. */
{
  const quake = usgsPoints({ features: [{
    id: "us7000abcd",
    geometry: { type: "Point", coordinates: [-122.8, 38.8, 5.2] },
    properties: { mag: 4.4, place: "Northern California", time: 1_700_000_000_000,
      url: "https://earthquake.usgs.gov/x" },
  }] }, { id: "quakes-day" })[0];
  const flood = gdacsPoints({ features: [{
    geometry: { type: "Point", coordinates: [116, 28] },
    properties: { eventid: 1104081, name: "Flood in China", alertlevel: "Orange",
      url: { report: "https://gdacs.org/x" } },
  }] }, { id: "gdacs-floods" })[0];

  check("both feeds stamp a source id, which is why it cannot be the test",
    [Boolean(quake.sourceId), Boolean(flood.sourceId)], [true, true]);
  check("an earthquake is one", isQuake(quake), true);
  check("a GDACS flood is not, however it is filed", isQuake(flood), false);
  check("nor is an EONET event, which carries no source id at all",
    isQuake({ categoryId: "wildfires" }), false);
  check("and nothing at all is not an earthquake", isQuake(null), false);

  /* A flood has no magnitude, so the OLD test would have banded it as a quake
     AND shown it seismic rows -- the same fault in two places. */
  check("the flood the report was about carries no magnitude",
    Number.isFinite(flood.magnitude), false);

  /* One map for the publisher, because the credit row and the card's link name
     the same organisation and drifted: the link said USGS over a GDACS flood. */
  check("the flood's record is GDACS's", publisherOf({ kind: "gdacs" }), "GDACS (EC JRC)");
  check("the earthquake's is the USGS's",
    publisherOf({ kind: "usgs" }), "USGS earthquake catalogue");
  check("and an EONET event's is NASA's", publisherOf({ kind: "eonet" }), "NASA EONET");
  check("a card with no feed record still names somebody", publisherOf(null), "NASA EONET");
}

/* The card and the trace must ask the category, not the registry. */
{
  const src = readFileSync(new URL("./events.js", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  check("the seismogram is fetched for an earthquake and nothing else",
    /if \(isQuake\(event\) && window\.GeoIDEarthData\?\.seismogramNear\) void showTrace\(event\);/
      .test(code), true);
  check("the magnitude and depth rows are an earthquake's",
    /const seismic = isQuake\(event\) \? `/.test(code), true);
  check("the count says earthquakes and means them",
    /const seismic = events\.filter\(isQuake\)\.length;/.test(code), true);
  check("and the natural events include the ones with a source id",
    /events\.filter\(\(e\) => !isQuake\(e\)\)\.map\(\(e\) => e\.categoryTitle\)/.test(code), true);
  check("the link names the feed's own publisher, briefly",
    /Open the \$\{publisherOf\(source, \{ short: true \}\)\} record/.test(code), true);
  /**
   * `sourceId` keeps its one real job — looking the FEED up for its credit,
   * which is as true of GDACS as of the USGS — and has no other reader. Any
   * new one is a decision about what kind of event this is, taken on a field
   * that does not answer that.
   */
  const uses = code.match(/\bevent\.sourceId\b/g) || [];
  check("sourceId is read twice, both times to find the feed record",
    uses.length, 2);
  check("and that is the only line it appears on",
    /const source = event\.sourceId \? sourceById\(event\.sourceId\) : null;/.test(code),
    true);
}

/* ── the feed is on when the page opens ────────────────────────────────────
   A default is the state somebody gets before they have chosen anything, and
   it is not a state to keep re-imposing. Only an explicit off is remembered as
   off; anything else -- nothing stored, storage that refuses to be read, a
   value from some future version -- opens armed. */
{
  check("nothing stored opens armed", restoreActive(null), true);
  check("and so does storage that gave us nothing", restoreActive(undefined), true);
  check("an explicit off is honoured", restoreActive("0"), false);
  check("however it was spelled", restoreActive("false"), false);
  check("an explicit on is honoured", restoreActive("1"), true);
  /* The failure that matters is the wrong DIRECTION: a value nobody wrote must
     not read as "switched off", or one stray key turns the feature off for a
     visitor who never touched it. */
  check("and anything unrecognised opens armed rather than off",
    restoreActive("yes-please"), true);
}

/* The launch arm takes the feed and none of the furniture. Each of these is a
   decision about the opening state of the whole page that nobody made by
   loading it, and each is argued at the branch that skips it. */
{
  const src = readFileSync(new URL("./events.js", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  check("a launch does not unfold the sidebar section",
    /if \(active && row && !launch\) row\.open = true;/.test(code), true);
  check("nor open the corner drop-down",
    /if \(active && panel && !launch\) \{/.test(code), true);
  check("nor stop the globe", /if \(!launch\) \{\s*window\.GeoIDModeManager\?\.setSpin/.test(code), true);
  check("it waits for the viewer rather than assuming one",
    /if \(!window\.GeoIDViewer\) \{/.test(code) && /armTries >= 40/.test(code), true);
  check("and only arms over a globe",
    /if \(mode && mode !== "gis"\) return;/.test(code), true);
  /* Leaving GIS is the app moving, not a choice about the feed: stored, it
     would switch the feed off for good the first time somebody opened the
     Model page. */
  check("leaving GIS is not remembered as switching it off",
    /setActive\(false, \{ remember: false \}\);/.test(code), true);
  check("and coming back brings it with you",
    /if \(event\.detail\?\.mode === "gis" && !active\) armOnLaunch\(\);/.test(code), true);
  check("the launch arm itself is not remembered as a choice either",
    /setActive\(true, \{ remember: false, launch: true \}\);/.test(code), true);
  /* The gestures ARE remembered, and they go through the same default. */
  check("a gesture is remembered", /if \(remember\) rememberActive\(active\);/.test(code), true);
}

/* ── the selection ring follows the ground, like every other marker ────────
   The halo is its own object in the spin frame rather than a member of
   `markers`, so the relief watcher's traversal never reached it: it kept the
   position it was built with while the exaggeration TAPERED on the way in and
   the ground came down without it. Measured at 3 km altitude, the halo sat at
   radius 3.26561 against its own marker at 3.20003 -- 65 km above it, long out
   of frame -- which is the reported "drops from view at a certain altitude". */
{
  const src = readFileSync(new URL("./events.js", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  check("the halo records the PLACE it is on, not just a position",
    /halo\.userData\.place = \{ lat: event\.lat, lon: event\.lon \};/.test(code), true);
  check("and the relief watcher puts it back on it",
    /if \(halo\?\.userData\?\.place\)/.test(code)
    && /markerPoint\(viewer, halo\.userData\.place\.lat, halo\.userData\.place\.lon\)/.test(code),
    true);
  /* Into the TRUTH, like the clouds: the geometry holds the truth minus
     whatever is round the back, and the cull rewrites it next frame. */
  check("written into the truth rather than the geometry",
    /truth\[0\] = v\.x; truth\[1\] = v\.y; truth\[2\] = v\.z;/.test(code), true);
  /* Both are sampled through the SAME call, so the ring cannot land anywhere
     its own dot did not. */
  const calls = (code.match(/markerPoint\(viewer, /g) || []).length;
  check("the ring and the dots are placed by one function", calls >= 2, true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;

/* ── the tropical-cyclone symbol ───────────────────────────────────────────
   Every other category here is a font character, which is right when a shape
   that means the category already exists in a typeface. A cyclone does not:
   the one Unicode has is U+1F300, which browsers render as a COLOUR emoji, so
   it would ignore the tint every other marker takes. So this one is a file,
   used by both the marker texture and the list. */
{
  const src = readFileSync(new URL("./events.js", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  check("the storms carry the cyclone file rather than a character",
    /severeStorms: \{\s*colour: "#ffffff", glyph: "◉", mark: CYCLONE_ICON/.test(code), true);
  check("and the emoji cyclone is not used anywhere", !/\u{1F300}/u.test(code), true);

  /* Resolved against the MODULE, not the document: the viewer is two
     directories below the site root, so a document-relative path resolves
     inside GeoID_GIS/viewer/ and 404s. */
  check("the file is resolved against import.meta.url",
    /new URL\("\.\.\/\.\.\/\.\.\/assets\/cyclone_icon\.png", import\.meta\.url\)/.test(code),
    true);
  /* The ink fit READS the canvas back, and a tainted canvas throws on
     getImageData — which is how a moved asset silently takes a symbol out. */
  check("and loaded cross-origin, because the canvas is read back",
    /image\.crossOrigin = "anonymous";/.test(code), true);

  /* THE FILE ARRIVES LATE. A marker built before it lands falls back to the
     category's own character rather than to nothing: an empty sprite and a
     category that failed to load look identical, and one of them is a bug. */
  check("a character stands in until the file lands",
    /if \(img\) image\(img, px, dx, dy\);\s*else character\(px, dx, dy\);/.test(code), true);
  check("and the texture is rebuilt in place when it does",
    /function rebuild\(\)/.test(code) && /if \(built\) built\.needsUpdate = true;/.test(code),
    true);
  check("a file that never arrives is not polled for",
    /image\.onerror = \(\) => \{ entry\.waiting\.length = 0; \};/.test(code), true);

  /* The list masks with the SAME file. A legend that disagrees with the
     markers is the fault this feed has already been reported for. */
  check("the panel rows mask with the file rather than drawing a character",
    /const mask = `url\(\$\{symbol\.mark\}\) center\/contain no-repeat`;/.test(code), true);
  check("as a mask, so it takes the row's colour like a character does",
    /background:currentColor;-webkit-mask:/.test(code), true);
  check("and every row goes through it",
    !/event-glyph" style="color:\$\{symbol\.colour\}">\$\{symbol\.glyph\}/.test(code), true);
  /* Four call sites: three inside templates, one assigned to a variable. */
  const spans = (code.match(/glyphSpan\(symbol\)/g) || []).length;
  check("all four of them", spans - 1, 4);   // less the definition itself

  /* The file is an opaque WHITE silhouette on transparency with the eye
     punched out of its alpha, which is why nothing here recolours it: white is
     what the marker material tints, and the alpha is what the row masks with.
     Asserted on the FILE, so replacing it with a black icon fails here rather
     than on the globe. */
  const png = readFileSync(new URL("../../../assets/cyclone_icon.png", import.meta.url));
  check("the icon file is there", png.length > 0, true);
  check("and it is a PNG, which is what carries the alpha",
    png.slice(1, 4).toString("latin1"), "PNG");
  /* Colour type 6 is RGBA — type 2 (RGB) has no alpha to mask or punch. */
  check("with an alpha channel", png[25], 6);
}

/* ── how big a storm is drawn ──────────────────────────────────────────────
   "The storm icons should be larger for hurricanes (dynamically size icons
   relative to magnitude of storm) - currently these icons are far too small to
   be seen." EONET gives every severe-storm event a wind speed in KNOTS —
   measured on the live feed, 30 to 110 across six storms, every one carrying a
   value — and knots are what Saffir–Simpson is defined in. */
{
  /* The scale's own thresholds, so a Category 3 is one because 96 knots is
     where that category starts, not because a ramp put it there. */
  check("below hurricane strength is band 0", stormCategory(63), 0);
  check("64 knots is a Category 1", stormCategory(64), 1);
  check("83 is a 2", stormCategory(83), 2);
  check("96 is a 3", stormCategory(96), 3);
  check("113 is a 4", stormCategory(113), 4);
  check("137 is a 5", stormCategory(137), 5);
  check("and it never runs past 5", stormCategory(200), 5);
  /* A storm with no published wind is not a category 0 — that is a claim the
     feed did not make, and it is what `markerKey` falls back on. */
  check("no wind speed is no category", stormCategory(null), null);
  check("nor is a non-number", stormCategory("strong"), null);

  /* The live feed's own storms, by name, so a threshold that moves shows up as
     the wrong category for a storm somebody can look up. */
  check("Hurricane Lowell at 110 kts is a Category 3", stormCategory(110), 3);
  check("Hurricane Marie at 65 kts is a Category 1", stormCategory(65), 1);
  check("Tropical Storm Edouard at 30 kts is band 0", stormCategory(30), 0);

  /* SIZE. Bigger than a category dot whatever the strength, because the
     cyclone is a spiral and needs area to be a shape at all. */
  check("even the weakest storm is drawn larger than a plain category dot",
    stormScale(0) > 2, true);
  check("and a Category 5 is larger again", stormScale(5) > stormScale(0), true);
  check("monotonic across the scale",
    [0, 1, 2, 3, 4, 5].every((c, i, a) => i === 0 || stormScale(c) > stormScale(a[i - 1])),
    true);
  check("a Category 5 is a bit over twice a tropical storm",
    +(stormScale(5) / stormScale(0)).toFixed(2), 2.25);
  /* Clamped, so a bad band cannot ask for a sprite the driver will not draw. */
  check("an unknown band is drawn at the base size", stormScale(null), stormScale(0));
  check("and nothing goes past the top of the scale", stormScale(99), stormScale(5));

  /* The cap that stops the ZOOM multiplying on top of the strength. On the
     hardware this file records, a sprite past 255 is clamped, and past that
     the multiplier stops meaning anything. */
  const near = 34;   // DOT_CAP_NEAR, the biggest base a marker is given
  check("a close-range Category 5 stays inside what a driver will draw",
    Math.min(near, STORM_BASE_CAP) * stormScale(5) < 255, true);
  check("and the cap is what holds it there", STORM_BASE_CAP < near, true);

  /* The label the card reads by. */
  check("a hurricane is named by its category",
    stormLabel(3, 110), "Category 3 hurricane — 110 kts");
  check("and below that it is a tropical storm",
    stormLabel(0, 30), "Tropical storm — 30 kts");
  check("with no wind speed it still says what it is", stormLabel(null), "Severe storm");
}

/* And the wiring: the magnitude has to survive the conversion, and the bands
   have to reach the marker's own size. */
{
  const src = readFileSync(new URL("./events.js", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  /* It used to be dropped in `latestPoint`, which is why every storm was the
     same mark whatever it was doing. */
  check("the point keeps the magnitude EONET published with it",
    /magnitudeValue: Number\.isFinite\(g\.magnitudeValue\) \? g\.magnitudeValue : null/.test(code),
    true);
  check("the storms are banded by it",
    /const band = stormCategory\(event\.magnitudeValue\);/.test(code), true);
  /* A storm with no published wind keeps the plain category key rather than
     being filed as a tropical depression. */
  check("and one with no wind speed stays an unbanded storm",
    /return band === null \? "severeStorms" : `storm-\$\{band\}`;/.test(code), true);
  check("a banded key still finds the cyclone symbol",
    /if \(key\.startsWith\("storm-"\)\) return SYMBOLS\.severeStorms;/.test(code), true);
  check("and the band decides the size",
    /isStormBand\(key\) \? stormScale\(bandNumber\(key\)\)/.test(code), true);
  /* The card says the strength the marker is drawn at, or the reader is left
     inferring it from the size of a symbol. */
  check("the card states the strength", /<dt>Strength<\/dt>/.test(code), true);
}

/* ── the selection ring is sized from the MARKER, not from the dot ─────────
   It used to be `dot * 3`, which assumes every marker is drawn at
   `dot * GLYPH_FOOT_SCALE`. That stopped being true the moment a category got
   a size of its own: measured on Hurricane Marie, a 40.2 px ring around a
   50.3 px symbol — inside the thing it is meant to encircle — and the same
   40.2 around the Category 3's 70.4. */
{
  const src = readFileSync(new URL("./events.js", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  check("the ring asks the marker's own cloud how big it is",
    /function markerSpriteFor\(key\)/.test(code)
    && /node\.name === `eonet-\$\{key\}`/.test(code), true);
  check("and the halo remembers which cloud it belongs to",
    /halo\.userData\.markerKey = markerKey\(event\);/.test(code), true);
  check("the size is that marker's, times the ring's own ratio",
    /halo\.material\.size = marker\s*\* \(halo\.userData\.foot \? HALO_OVER_MARKER_FOOT : HALO_OVER_MARKER_CENTRED\);/
      .test(code), true);
  /* Derived, not chosen: the foot ratio IS the one the texture's geometry was
     built at, which is why the measured ring-on-ink holds at any marker size. */
  check("the foot ratio is the texture's own",
    /const HALO_OVER_MARKER_FOOT = HALO_FOOT_SCALE \/ GLYPH_FOOT_SCALE;/.test(code), true);
  /* The markers are rebuilt on every refresh, so a selection can outlive its
     cloud for a frame — and a ring of size 0 is a ring that vanished. */
  check("with the old arithmetic kept for when the cloud is not there",
    /if \(marker > 0\) \{/.test(code), true);

  /* DECLARATION ORDER. A const evaluated before HALO_FOOT_SCALE exists is a
     temporal dead zone error at module load, which takes the whole feed out —
     and `node --check` parses without evaluating, so it passes either way. */
  const foot = code.indexOf("const HALO_FOOT_SCALE = 3;");
  const ratio = code.indexOf("const HALO_OVER_MARKER_FOOT");
  check("and the ratio is declared after what it is derived from",
    foot > 0 && ratio > foot, true);
}

/* ── one definition of the scale, shared with the historical tracks ────────
   The 13,513-storm IBTrACS archive is classed on the same thresholds the live
   markers band by, so a Category 3 on the map now and a Category 3 in 1972 are
   the same colour for the same reason. Written out twice they would eventually
   cut intensity at two different numbers. */
{
  check("the thresholds are exported, ascending, in knots",
    JSON.stringify(SAFFIR_SIMPSON_KTS), JSON.stringify([64, 83, 96, 113, 137]));
  /* And `stormCategory` is DERIVED from them rather than repeating them: every
     threshold must be the exact wind at which its own category begins. */
  SAFFIR_SIMPSON_KTS.forEach((floor, i) => {
    check(`${floor} kt is the floor of category ${i + 1}`, stormCategory(floor), i + 1);
    check(`and one knot under it is still ${i}`, stormCategory(floor - 1), i);
  });
  check("below the first threshold is band 0", stormCategory(SAFFIR_SIMPSON_KTS[0] - 1), 0);
  check("and the top threshold is the top band",
    stormCategory(SAFFIR_SIMPSON_KTS[SAFFIR_SIMPSON_KTS.length - 1]),
    SAFFIR_SIMPSON_KTS.length);
}

/**
 * THE VERDICT, AT THE END OF THE FILE.
 *
 * It used to sit a third of the way down, straight after the recency checks —
 * so the checks below it RAN, printed, counted into `fail`, and were never
 * looked at again: the exit code had already been decided. Measured by
 * appending a deliberately failing check to the last line, the file exited 0
 * and the suite reported it green.
 *
 * The same shape as this repo's own note about `geoprocessing.test.mjs`,
 * whose summary calls `process.exit` and silently skips anything appended
 * after it. Either way the rule is the same: A TEST FILE'S VERDICT IS ITS
 * LAST STATEMENT. Anything after it is decoration.
 */
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
