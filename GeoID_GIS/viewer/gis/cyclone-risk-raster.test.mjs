/**
 * The animation's colour table and its frame note.
 *
 * Both are about the same thing: the animation must not say something the map
 * beside it does not, and it must not let a two-season estimate pass as a
 * hazard map.
 */
import { readFileSync } from "node:fs";
import { buildLut, noteFor, THIN_SEASONS } from "./cyclone-risk-raster.js";
import { riskEdges, RISK_LABELS } from "./cyclone-risk.js";

let pass = 0;
const failures = [];
function check(name, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass += 1;
  else failures.push(`${name}\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`);
}

/* ── the classes are the STATIC MAP'S, not a second copy ─────────────────── */
const edges = riskEdges();
const lut = buildLut();
check("a byte for every value", lut.length, 256 * 4);
const colourAt = (p) => {
  const v = Math.round(p * 255);
  return [lut[v * 4], lut[v * 4 + 1], lut[v * 4 + 2]];
};
// One class per edge plus the one below the first, exactly as the key has.
const bands = new Set();
for (let v = 1; v < 256; v += 1) bands.add(lut.slice(v * 4, v * 4 + 3).join(","));
check("one colour per class, and no more", bands.size, RISK_LABELS.length);
// A value either side of a published edge must land in different classes, or
// the animation is drawing a boundary the map does not have.
edges.forEach((edge, i) => {
  const below = colourAt(edge - 0.01).join(",");
  const above = colourAt(edge + 0.01).join(",");
  check(`edge ${i} (1 in ${[10, 5, 2, 1, 0.5][i]} years) separates two classes`,
    below !== above, true);
});

/* ── nothing is not the bottom class ─────────────────────────────────────── */
// A cell no storm has ever reached is OUTSIDE the map, not at the low end of
// it. Drawn opaque in the bottom class it would read as "rare", which is a
// reading of ground the record says nothing about.
check("a zero is transparent", lut[3], 0);
check("and the smallest real value is not", lut[1 * 4 + 3] > 0, true);

/* ── a frame says how much record it stands on ───────────────────────────── */
// One season gives P = 0.63 anywhere a single storm passed, because that is
// what one arrival in one year means. It is sampling noise wearing a
// probability's clothes, and a frame that does not say so is the map claiming
// a hazard estimate it has not got.
check("a one-season frame calls itself noise",
  /sampling noise/.test(noteFor({ year: 1980, count: 1 })), true);
check("and says how many seasons that is",
  /1 season\b/.test(noteFor({ year: 1980, count: 1 })), true);
check("plural for two", /2 seasons/.test(noteFor({ year: 1981, count: 2 })), true);
check("a long-record frame does not cry noise",
  /sampling noise/.test(noteFor({ year: 2025, count: 46 })), false);
check("and says what it is instead",
  /the estimate after 46 seasons/.test(noteFor({ year: 2025, count: 46 })), true);
check("the threshold is stated rather than buried", THIN_SEASONS, 10);

/* ── the bake writes what this reads, pinned on its source ───────────────── */
const bake = readFileSync(
  new URL("../../services/bake-cyclone-risk.py", import.meta.url), "utf8");
check("the raster is CUMULATIVE — the estimate, not the year's count",
  /per_year\[:i \+ 1\]\.sum\(axis=0\)/.test(bake), true);
check("and every band carries its own season, so nothing counts forward",
  /<Description>\{\}<\/Description>/.test(bake), true);
check("named hotlink-ok, or Cloudflare 403s a .tif by Referer",
  /cyclone-risk-cumulative\.hotlink-ok\.tif/.test(bake), true);
check("and its scratch is under a gitignored work directory",
  /\.cyclone-work/.test(bake), true);

/* ── the verdict is reported on EXIT, so ordering cannot discard a check ─── */
/* ── one drape per dataset, whatever the callers do ─────────────────────── */
/**
 * Two callers open this sequence within a couple of seconds of a tick -- the
 * catalogue applying the default view and `animated-layers` opening the bar --
 * through two guards in two files, and the race between them was measured
 * leaving TWO estimate drapes registered from ONE tick (Workspace ids 6 and 7),
 * with the first one's teardown lost under the sequence that replaced it. The
 * fix is at the RESOURCE, not another flag: a registration takes any stray off
 * first, so the guards can lose their race and the globe still holds one.
 *
 * `check(name, got, want)` here COMPARES -- it does not run a callback.
 */
{
  const raster = readFileSync(new URL("./cyclone-risk-raster.js", import.meta.url), "utf8");
  const risk = readFileSync(new URL("./cyclone-risk.js", import.meta.url), "utf8");
  const animated = readFileSync(new URL("./animated-layers.js", import.meta.url), "utf8");
  const lapse = readFileSync(new URL("./cyclone-timelapse.js", import.meta.url), "utf8");
  check("the sheet is registered under a NAMED constant",
    /addDerivedLayer\?\.\(\s*ESTIMATE_NAME,/.test(raster), true);
  check("and any stray sheet of that name is taken off FIRST",
    raster.indexOf("l.name === ESTIMATE_NAME") > 0
    && raster.indexOf("l.name === ESTIMATE_NAME") < raster.indexOf("addDerivedLayer?.(\n    ESTIMATE_NAME"), true);
  check("the default view opens the sequence under the seam's hold, as the risk's",
    /gate\(open, "cyclone-risk"\)/.test(risk), true);
  check("a held open claims the bar for whoever's it is when it lands",
    /async function hold\(work, id = null\)/.test(animated)
    && /if \(id && document\.getElementById\("geoid-timelapse"\)\) owner = id;/.test(animated), true);
  check("and the tracks' own rebuild names itself the same way",
    /gate\(work, "cyclone-tracks"\)/.test(lapse), true);
}

/* ── a dismissal is announced, never inferred ──────────────────────────── */
{
  const player = readFileSync(new URL("./timelapse-player.js", import.meta.url), "utf8");
  const animated = readFileSync(new URL("./animated-layers.js", import.meta.url), "utf8");
  check("the ✕ stops the player with a reason of its own",
    /stopPlayer\(\{ reason: "dismiss" \}\)/.test(player), true);
  check("and every stop announces its reason",
    /geoid-gis:timelapse-stopped.*detail: \{ reason \}/.test(player), true);
  check("animated-layers marks a dismissal from that announcement",
    /reason !== "dismiss" \|\| !owner\) return;\s*dismissed\.add\(owner\)/.test(animated), true);
  check("and no longer infers one from an empty poll",
    !/watchBar/.test(animated) && !/Gone without the layer going/.test(animated), true);
}

/* ── a bare "put it back" must not paint the estimate, and a stop completes ── */
{
  const risk = readFileSync(new URL("./cyclone-risk.js", import.meta.url), "utf8");
  const player = readFileSync(new URL("./timelapse-player.js", import.meta.url), "utf8");
  check("showClimatology leaves a layer wearing the estimate alone when nothing is named",
    /if \(!view && layer\.cycloneView === "estimate"\) return null;/.test(risk), true);
  check("and refuses a view the grid cannot paint",
    /if \(!VIEWS\[wanted\]\) return null;/.test(risk), true);
  check("a driver's onStop cannot abort the stop that runs it",
    /try \{ done\?\.\(\); \} catch/.test(player)
    && player.indexOf("try { done?.(); }") < player.indexOf('new CustomEvent("geoid-gis:timelapse-stopped"'), true);
}

/* ── the frames count bands the way the file is read ───────────────────── */
/**
 * geotiff.js samples are 0-based; the bake's VRT numbers its bands from 1.
 * `open()` reads the descriptions 0-based and the epochs counted from 1, so
 * every frame showed the estimate a season later than its label and the last
 * -- the one the bar OPENS on -- asked for sample 47 of 47 and failed, leaving
 * the two-season estimate on screen under "after 47 seasons". Measured on the
 * file: sample 0 is the thinnest estimate and sample 46 the full record.
 */
{
  const raster = readFileSync(new URL("./cyclone-risk-raster.js", import.meta.url), "utf8");
  check("epochs carry a 0-based sample index", /count: i \+ 1, band: i,/.test(raster), true);
  check("and the sheet is draped with the band the bar opens on",
    /frameCanvas\(seasons\.length - 1, lut\)/.test(raster), true);
  check("nothing asks for a band numbered from 1 any more",
    /frameCanvas\(1, lut\)|band: i \+ 1/.test(raster), false);
}

process.on("exit", () => {
  if (failures.length) {
    console.log(`✗  cyclone-risk-raster.test.mjs  —  ${pass} passed, ${failures.length} FAILED`);
    failures.forEach((f) => console.log(`   ${f}`));
    process.exitCode = 1;
  } else {
    console.log(`✓  cyclone-risk-raster.test.mjs  —  ${pass} passed`);
  }
});
