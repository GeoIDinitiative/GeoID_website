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
import { GROUPS, HOMES, MIRRORS, DATASETS, grouped, launchDatasets, noteDatasetChoice }
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
  // A declared MIRROR is a row too: the volcanic-hazards home draws the
  // volcano row seen from Geology, with its own settings docked under it.
  const mirrored = (MIRRORS[home] || []).map((m) => m.id);
  check(`and at least one dataset lives there`,
    files.length > 0 || tiled || mirrored.length > 0,
    files.length ? files.join(", ") : mirrored.length ? `mirrored: ${mirrored.join(", ")}` : "from the TILED registry");
});

/* ── exactly one list each ───────────────────────────────────────────────── */

check("the home panels draw the datasets that named them, plus DECLARED mirrors",
  /\.filter\(\(entry\) => entry\.home === home \|\| mirrorOf\(home, entry\.id\)\)/.test(panels));
/* A mirror is a second door to one layer -- same tick, same layer, same
   Symbology -- declared in MIRRORS so "does this dataset appear once" is
   still a question about one file: once as itself, once per declared mirror,
   and nowhere else. */
check("every mirror names a real dataset in a real home",
  Object.entries(MIRRORS).every(([home, list]) => HOMES[home]
    && list.every((m) => DATASETS.some((d) => d.id === m.id))));
check("and a mirror docks its own settings, never the home's",
  /settings: mirrorOf\(home, entry\.id\)\?\.settings \?\? entry\.settings/.test(panels));
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
  /* THE ONE LIVE FEED OFFERED FROM HAZARDS SITS IN THIS SUBTAB, deliberately.
     A blanket proxy on every hazard subtab was removed for putting one dataset
     in two tabs; this one is kept because the reader of a cyclone archive is
     the likeliest person in the app to want what is on the ocean this morning.
     It is a second DOOR and not a second state — that half is pinned in
     event-sources.test.mjs, against events.js. Here the question is placement:
     inside the tropical-cyclone section, and nowhere else. */
  const body = html.slice(html.indexOf('<summary>Tropical cyclones</summary>'));
  const section = body.slice(0, body.indexOf("</details>"));
  check("the storm feed is reachable from the cyclone subtab, FIRST",
    section.indexOf('data-feed-proxy="eonet-severeStorms"') > 0
    && section.indexOf('data-feed-proxy=') < section.indexOf('id="hazards-catalogue"'));
  check("as a host Live's own row template fills, not a hand-written row",
    !/data-feed-toggle/.test(html) && /class="event-feed-rows" data-feed-proxy/.test(section));
  check("and the volcanic subtab has the eruption feed the same way",
    /id="volcanic-live-feed"[^>]*data-feed-proxy="eonet-volcanoes"/.test(html));
  check("two proxies in the page, one per hazard subtab that wants one",
    (html.match(/data-feed-proxy=/g) || []).length, 2);
  check("the volcanic subtab's buffers ship parked, under the mirrored row's name",
    /<div id="volcano-hazard-buffers" hidden>/.test(html)
    && /settings: "volcano-hazard-buffers"/.test(data));
  check("and the page loads the module that draws them",
    /src="gis\/volcanic-hazards\.js/.test(html));
  /* THE TRACKS' SETTINGS HANG UNDER THE TRACKS ROW. They are page markup the
     catalogue docks under the row while the layer is loaded and parks, hidden,
     when it is not -- so the page ships them parked, the entry names them,
     and both projections carry the name (the third field this trap has cost). */
  check("the plot-by and span block ships parked",
    /<div id="cyclone-timelapse" hidden>/.test(section));
  check("the tracks entry names it", /settings: "cyclone-timelapse"/.test(data));
  const panels = readFileSync(join(HERE, "catalogue-panels.js"), "utf8");
  check("and both projections carry it",
    /settings: (?:mirrorOf\(home, entry\.id\)\?\.settings \?\? )?entry\.settings/.test(panels)
    && /settings: entry\.settings/.test(polygons));
  const list = readFileSync(join(HERE, "catalogue-list.js"), "utf8");
  check("a docked block is rescued before the list is cleared",
    list.indexOf(".gis-catalogue-settings > [id]") < list.indexOf('host.textContent = ""'));
}

/* ── a dataset that plays over time carries its own button ───────────────── */
// `entry.play` is a SEAM, not a cyclone special case: the button goes on the
// row of the layer it animates, beside the tick that put that layer on the
// globe, and does not exist until it has been. That is what retired the two
// standing buttons and the paragraph telling the reader which box to tick
// first -- a control that acts on one layer, parked in the subsection instead,
// has to name that layer in words and then be kept in step with it.
{
  const list = readFileSync(join(HERE, "catalogue-list.js"), "utf8");
  const data = readFileSync(join(HERE, "global-data.js"), "utf8");
  const dialog = readFileSync(join(HERE, "symbology-dialog.js"), "utf8");

  /* ── a layer's alternative readings live on the SYMBOLOGY button ───────── */
  // Choosing between "every storm" and "only those that reached hurricane
  // force" is a COLOUR decision. It was a button on the catalogue row, beside
  // the one marked Symbology -- two controls for one idea, and reported as a
  // mess. The row draws no such button any more.
  check("the catalogue row draws no view button of its own",
    !/entry\.viewToggle/.test(list) && !/entry\.play/.test(list));
  check("the symbology dialog offers them instead",
    /const views = layer\.symbologyViews;/.test(dialog));
  check("and applies on CHANGE, so the difference is visible while choosing",
    /select\.addEventListener\("change", \(\) => \{\s*[\s\S]{0,220}views\.apply\(select\.value\)/
      .test(dialog));
  check("the layer carries them, not the catalogue: a dropped file reaches the same code",
    /landed\.symbologyViews = entry\.views;/.test(data));
  // The two cyclone entries and the two volcanic risk maps (windowed and full
  // record), which are the cyclone risk map's twins and take their readings
  // the same way.
  check("the four risk entries declare their readings",
    [...data.matchAll(/^\s{4}views: \{/gm)].length === 4);

  /* ── EVERY OPTION IS AN INSTANT REPAINT ───────────────────────────────── */
  // A choice that loads a different FILE is not a symbology: it drops the
  // layer, rebuilds it and paints it a beat later -- which is exactly how the
  // old button was reported ("it changes colours in stages").
  check("the tracks entry loads ONE file, with no variant swap",
    /path: "\/data\/global\/cyclone-tracks\.geojson"/.test(data)
    && !/TRACK_VIEWS/.test(data));
  const tracks = readFileSync(join(HERE, "cyclone-tracks-view.js"), "utf8");
  check("and its views repaint the loaded features",
    /layer\.repaint\?\.\(paint\.colourFor\)/.test(tracks));
  check("the default is by category",
    /currentView\(layers\) \{[\s\S]{0,120}\|\| "category"/.test(tracks));
  /* ── a derived layer that stands in for a dataset keeps its tab lit ───── */
  // While a cyclone season is on screen the whole-record layer is deliberately
  // hidden beneath it, and the derived season layer has no catalogue row -- so
  // the activity pass filed it under Workspace and the Hazards header went
  // DARK at the moment its data was most obviously on the globe.
  const activity = readFileSync(join(HERE, "section-activity.js"), "utf8");
  check("a derived layer naming a home lights that home's header",
    /if \(layer\.home\) \{[\s\S]{0,140}sectionForHome\(layer\.home\)/.test(activity));
  check("and it is read before the name guesses below it",
    activity.indexOf("if (layer.home)") < activity.indexOf('name.startsWith("Live satellites")'));
  const manager = readFileSync(join(HERE, "import-manager.js"), "utf8");
  check("addDerivedLayer carries the home its caller declares",
    /home: result\.home \|\| null,/.test(manager));
  for (const file of ["cyclone-timelapse.js", "cyclone-risk-raster.js"]) {
    check(`${file} declares one, so its frames light Hazards`,
      /home: "hazards",/.test(readFileSync(join(HERE, file), "utf8")));
  }

  // A VIEW IS THE COLOURING. Both were running -- the view's paint and then
  // `paintByRange` over the top -- so the key on load disagreed with the key
  // after a switch and back, and the second was the true one.
  check("an entry with views does not also run colourRange",
    /if \(layer && entry\.views\?\.apply\) \{[\s\S]{0,240}\} else if \(layer && entry\.colourRange\)/
      .test(data));

  /* ── a heading over the ONLY group says nothing ────────────────────────── */
  check("group headings are drawn only where there is more than one group",
    /const showGroups = groups\.size > 1;/.test(list));
  check("and the row loop honours that",
    /if \(showGroups && entry\.group/.test(list));

  // HURRICANE FORCE IS A PART OF A TRACK, not a class of storm. Both maps must
  // mean the same thing by it or they cannot be laid over each other.
  const bake = readFileSync(join(HERE, "..", "..", "services",
    "bake-cyclone-tracks.py"), "utf8");
  check("the hurricane tracks are runs AT hurricane force, not whole storms",
    /def hurricane_runs\(/.test(bake) && /wind >= HURRICANE_KTS/.test(bake));
  check("and a storm that re-intensifies gives more than one run",
    /if len\(run\) >= 2:/.test(bake));
  check("both maps cut hurricane force at the same knots",
    /HURRICANE_KTS = 64/.test(bake)
    && /HURRICANE_KTS = 64/.test(readFileSync(join(HERE, "..", "..", "services",
        "bake-cyclone-risk.py"), "utf8")));
  const lapse = readFileSync(join(HERE, "cyclone-timelapse.js"), "utf8");
  check("the risk map follows because the layer is there",
    /function followRisk\(\) \{\s*return Boolean\(riskLayer\(\)\);/.test(lapse));
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
