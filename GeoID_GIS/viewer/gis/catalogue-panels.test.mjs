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
import { GROUPS, HOMES, DATASETS, grouped } from "./global-data.js";

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

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
