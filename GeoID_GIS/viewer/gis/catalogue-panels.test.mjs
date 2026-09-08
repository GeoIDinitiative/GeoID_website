#!/usr/bin/env node
/**
 * Every dataset is on exactly one list.
 *
 * The catalogue used to be one list of everything, sorted by the format its
 * datasets arrive in. Now a dataset names its home, `catalogue-panels.js`
 * mounts a list per home, and `polygons.js` draws what is left — and there are
 * two ways for that to go wrong, neither of which looks wrong on screen:
 *
 * - a dataset drawn TWICE, so a tick in one panel silently changes the other;
 * - a dataset drawn NOWHERE, still in the catalogue, still loadable by id, and
 *   on no list anybody can find.
 *
 * Both are one edit away — a home spelled differently from the panel that
 * mounts it, a host removed from the page, a new dataset given a home nobody
 * built. So the invariant is checked rather than remembered.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GROUPS, HOMES, DATASETS, grouped, launchDatasets, noteDatasetChoice }
  from "./global-data.js";

const HERE = dirname(fileURLToPath(import.meta.url));

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const html = readFileSync(join(HERE, "../index.html"), "utf8");
const panelSource = readFileSync(
  fileURLToPath(new URL("./catalogue-panels.js", import.meta.url)), "utf8");
const panels = readFileSync(join(HERE, "catalogue-panels.js"), "utf8");
const polygons = readFileSync(join(HERE, "polygons.js"), "utf8");

/* ── every home is real ──────────────────────────────────────────────────── */

const homesUsed = [...new Set(DATASETS.map((d) => d.home).filter(Boolean))];
check("every home a dataset names is a home the registry knows",
  homesUsed.every((home) => HOMES[home]),
  homesUsed.filter((home) => !HOMES[home]).join(", ") || homesUsed.join(", "));

Object.entries(HOMES).forEach(([home, hostId]) => {
  // A registered home with no host in the page is a list that mounts nothing,
  // and the datasets that named it are unreachable.
  check(`the page carries a host for ${home}`,
    html.includes(`id="${hostId}"`), hostId);
  // The status line is derived from the host id, so it has to be there too or
  // "added / taken off the globe" is said into nothing.
  check(`and a status line beside it`,
    html.includes(`id="${hostId.replace(/-catalogue$/, "-status")}"`));
  /**
   * A HOME MUST HOLD SOMETHING, from EITHER source.
   *
   * This counted shipped datasets alone, which was right while every home had
   * files in it — and the soil map has none: it is a baked tile pyramid, which
   * `global-data.js` cannot describe because it is not a file, so it arrives
   * through this module's own TILED registry instead. Counting only one of the
   * two sources called a fully populated tab empty.
   *
   * The invariant that matters is unchanged and is the reason the check exists
   * at all: no home is a heading over nothing.
   */
  const tiled = new RegExp(`"${home}":\\s*\\[`).test(panelSource);
  const files = DATASETS.filter((d) => d.home === home).map((d) => d.id);
  check(`and at least one dataset lives there`,
    files.length > 0 || tiled,
    files.length ? files.join(", ") : "from the TILED registry");
});

/* ── exactly one list each ───────────────────────────────────────────────── */

check("the home panels draw only datasets that named them",
  /\.filter\(\(entry\) => entry\.home === home\)/.test(panels));
check("and the Vectors tab draws only the ones that named none",
  /\.filter\(\(entry\) => !entry\.home\)/.test(polygons));
check("so no dataset is drawn twice, and none is drawn nowhere",
  DATASETS.every((d) => (d.home ? Boolean(HOMES[d.home]) : true)),
  `${DATASETS.filter((d) => d.home).length} homed, `
  + `${DATASETS.filter((d) => !d.home).length} in Vectors & Shapes`);

/* ── the page loads the thing that fills them ────────────────────────────── */

check("the page loads catalogue-panels.js",
  /src="gis\/catalogue-panels\.js/.test(html));
// Script tags only: the markup still NAMES the retired modules in a comment
// saying where their contents went, which is the comment doing its job.
check("and no longer loads the panels it replaced",
  !/src="[^"]*(?:tectonics-panel|locations-panel)\.js/.test(html));

/* ── the water layers moved, and the tab they moved into says so ─────────── */

const water = DATASETS.filter((d) => d.home === "hydrology").map((d) => d.id);
check("coastlines, rivers and lakes are under Hydrology",
  ["coastline-10m", "rivers-10m", "lakes-10m"].every((id) => water.includes(id)),
  water.join(", "));
check("the Hydrology group exists in the catalogue", GROUPS.includes("Hydrology"));
// Renaming the heading without renaming the id is deliberate: three other
// files address this section by id.
check("the Sea Level section is titled Hydrology",
  /id="sea-level-section"[\s\S]{0,1200}<span>Hydrology<\/span>/.test(html));
check("and keeps its id, which toolbox.js and mode-manager.js address it by",
  html.includes('id="sea-level-section"'));

/* ── nothing is left pointing at a group that no longer exists ───────────── */

const declared = new Set(DATASETS.map((d) => d.group));
check("every dataset's group is one the catalogue lists",
  [...declared].every((g) => GROUPS.includes(g)),
  [...declared].filter((g) => !GROUPS.includes(g)).join(", ") || "all known");
check("and every listed group still has something in it",
  grouped().length === GROUPS.length,
  grouped().map((g) => `${g.group}:${g.entries.length}`).join(" "));

/* ── what is on the globe when the page opens ─────────────────────────────
   A `defaultOn` entry is a claim that the map is better with it than without
   it for somebody who has asked for nothing. It must stay a DEFAULT: getting
   a layer back the morning after taking it off is the app overruling a
   decision, which is what `restoreSources` already refuses to do about a feed
   somebody unticked. */
{
  const defaults = DATASETS.filter((d) => d.defaultOn);
  check("the plate boundaries are on at launch",
    defaults.some((d) => d.id === "plate-boundaries"),
    defaults.map((d) => d.id).join(", ") || "none");
  /* Faint on purpose: 241 segments across the planet at full strength is a net
     drawn OVER the map, and the point of them is to be underneath what you are
     reading. */
  const plates = DATASETS.find((d) => d.id === "plate-boundaries");
  check("at 30%", plates.opacity === 0.3, String(plates.opacity));
  check("and every launch default declares the weight it opens at",
    defaults.every((d) => Number.isFinite(d.opacity)),
    defaults.filter((d) => !Number.isFinite(d.opacity)).map((d) => d.id).join(", ") || "all do");
  /* A launch default is a live fetch and seconds of geometry on every load, so
     it is a decision rather than something to accumulate. */
  check("and there are few enough of them to be a decision",
    defaults.length <= 3, `${defaults.length}`);

  /* The memory, driven through the exported seam rather than by writing the
     key: a stub localStorage is all it needs. */
  const store = new Map();
  globalThis.window = { localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  } };
  check("with nothing stored, the default is on",
    launchDatasets().includes("plate-boundaries"));
  noteDatasetChoice("plate-boundaries", false);
  check("unticking it is remembered", !launchDatasets().includes("plate-boundaries"),
    store.get("geoid-gis:catalogue-off") || "");
  noteDatasetChoice("plate-boundaries", true);
  check("and ticking it again puts it back", launchDatasets().includes("plate-boundaries"));
  /* Only a launch default has anything to override, so nothing else is stored
     — a list of every tick anybody ever made is a different feature. */
  noteDatasetChoice("coastline", false);
  check("an ordinary dataset writes nothing",
    !(store.get("geoid-gis:catalogue-off") || "").includes("coastline"),
    store.get("geoid-gis:catalogue-off") || "");

  /* Storage that throws is a private window, and it must not take the layer
     down with it. */
  globalThis.window = { localStorage: {
    getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); },
  } };
  check("a refused storage still opens with the default",
    launchDatasets().includes("plate-boundaries"));
  let threw = false;
  try { noteDatasetChoice("plate-boundaries", false); } catch (e) { threw = true; }
  check("and recording a choice into it does not throw", !threw);
  delete globalThis.window;
}

/* ── the launch loader waits for what the IMPORTER needs ──────────────────
   `importFileList` marks a layer `error` and RETURNS when there is no viewer
   scene to hang its group off -- it does not throw, so addDataset answers ok
   over an import that produced nothing. Measured at launch before this: the
   plate boundaries registered, took their 30%, and carried no geometry, while
   the identical call by hand a minute later loaded all 241 segments. */
{
  const panels = readFileSync(join(HERE, "catalogue-panels.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  check("it waits for the viewer's scene, not only the import manager",
    /!window\.GeoIDImportManager\?\.importFileList \|\| !window\.GeoIDViewer\?\.scene/.test(panels));
  check("and the retry is bounded", /tries >= 40/.test(panels));

  const data = readFileSync(join(HERE, "global-data.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  check("a default that lands in error is taken off rather than left as a dead row",
    /landed\?\.status === "error"/.test(data) && /removeLayer\?\.\(landed\.id\)/.test(data));
  check("and the weight is applied to any entry, not only one with a colourBy",
    /if \(layer && Number\.isFinite\(entry\.opacity\)\)/.test(data));

  /* A launch default had no gesture behind it, so it takes neither the camera
     nor the spin. Both exist because an import IS a gesture -- you framed it
     and stopped the globe in order to look at what you just added. Measured
     before this: the plates landed and isSpinPaused came back true on a page
     nobody had touched, and framing a global layer throws the opening camera
     out to the whole planet on every load. */
  check("a launch default does not frame the camera or stop the globe",
    /\.\.\.\(launch \? \{ frame: false, hold: false \} : \{\}\)/.test(data));
  check("and the loader asks for that", /addDataset\(id, \(\) => \{\}, \{ launch: true \}\)/.test(data));
  const importer = readFileSync(join(HERE, "import-manager.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  check("which the importer honours", /if \(options\.hold !== false\) holdTheGlobe\(\);/.test(importer));
}

/* ── the cyclone tracks, and what left the Hazards tab to make room ────────
   "Lets add hurricane historical tracks to the GUI under the hazards tab.
   Note the EONET datasets should not be in the hazards tab - remove these -
   they are already covered in the events tab." */
{
  const tracks = DATASETS.find((d) => d.id === "cyclone-tracks");
  check("the cyclone tracks are in the catalogue", Boolean(tracks));
  check("filed under Hazards", tracks && tracks.home === "hazards" && tracks.group === "Hazards",
    tracks && `${tracks.home} / ${tracks.group}`);
  /* Baked and published, not fetched live: the source shapefile is one feature
     per three-hour segment and its longitudes run past 180. */
  check("it reads the baked file rather than the publisher's shapefile",
    tracks && tracks.path === "/data/global/cyclone-tracks.geojson", tracks && tracks.path);
  check("and it is not marked live", tracks && !tracks.live);
  check("it cites IBTrACS and the paper",
    tracks && /IBTrACS/.test(tracks.licence) && /Knapp/.test(tracks.licence));

  /* Cut on the published scale rather than on this file's own quantiles: a
     quantile of 6,246 peak winds puts a boundary at 62 or 71 knots and calls
     it a class. */
  check("classed on explicit edges", Array.isArray(tracks && tracks.colourRange?.edges));
  check("which are Saffir-Simpson in knots",
    JSON.stringify(tracks.colourRange.edges), JSON.stringify([64, 83, 96, 113, 137]));

  const data = readFileSync(join(HERE, "global-data.js"), "utf8");
  /* ONE definition of the scale. The live storm markers band by the same list,
     so the archive and the feed agree about where a category begins. */
  check("taken from the feed's own constant, not written out again",
    /edges: SAFFIR_SIMPSON_KTS/.test(data)
    && /import \{ SAFFIR_SIMPSON_KTS \}/.test(data));
  check("and the catalogue passes edges through to the paint",
    /edges: spec\.edges \|\| null/.test(data));
  const dialog = readFileSync(join(HERE, "symbology-dialog.js"), "utf8");
  check("which paintByRange forwards to buildSymbology",
    /buildSymbology\(values, \{ method, classes, ramp, reverse, edges \}\)/.test(dialog));

  /* The tab it sits in, and what came out of it. */
  const html = readFileSync(join(HERE, "..", "index.html"), "utf8");
  check("the Hazards tab hosts the catalogue", /id="hazards-catalogue"/.test(html));
  check("with the status line its home derives", /id="hazards-status"/.test(html));
  check("and no live feed is offered from Hazards any more",
    !/data-feed-toggle/.test(html));
  /* The machinery went with the markup — it polled every 900 ms for boxes that
     can no longer exist. */
  const events = readFileSync(join(HERE, "events.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  check("and its polling went with it", !/syncFeedProxies/.test(events));
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
