#!/usr/bin/env node
/**
 * One list holds the tectonics datasets, and it is the one under Geology.
 *
 * Plate boundaries, active faults and stress measurements moved out of Data ·
 * Vectors & Shapes — filing a plate boundary next to a coastline says what
 * format it arrives in, not what it is. The move is only a move if the Vectors
 * tab stops drawing them: two lists for one dataset is how a tick in one place
 * fails to explain the tick already showing in the other, and nothing about
 * that looks wrong until you have both panels open at once.
 *
 * The invariant is cheap to state and easy to break by adding a dataset, so it
 * is checked rather than remembered.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GROUPS, grouped, DATASETS } from "./global-data.js";
import { TECTONICS_GROUP } from "./tectonics-panel.js";

const HERE = dirname(fileURLToPath(import.meta.url));

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

check("the group the panel claims is a group the catalogue has",
  GROUPS.includes(TECTONICS_GROUP), TECTONICS_GROUP);

const tectonics = grouped().find(({ group }) => group === TECTONICS_GROUP);
check("and it holds datasets", Boolean(tectonics?.entries?.length),
  `${tectonics?.entries?.length || 0} entries`);
check("which are the tectonic ones",
  tectonics.entries.map((e) => e.id).join(", ")
    === "plate-boundaries, active-faults, stress-vectors",
  tectonics.entries.map((e) => e.id).join(", "));

/**
 * The Vectors tab filters by the IMPORTED constant, not by a literal.
 *
 * Two spellings of "Tectonics" is exactly how one list quietly stops matching
 * the other, so the string exists once and both panels read it from there.
 */
const polygons = readFileSync(join(HERE, "polygons.js"), "utf8");
check("the Vectors tab imports the group name rather than spelling it again",
  /import \{ TECTONICS_GROUP \} from "\.\/tectonics-panel\.js/.test(polygons));
check("and filters it out of its own catalogue",
  /\.filter\(\(\{ group \}\) => group !== TECTONICS_GROUP\)/.test(polygons));
check("with no second literal left behind",
  !/["']Tectonics["']/.test(polygons));

// The panel that DOES draw them selects the same way.
const panel = readFileSync(join(HERE, "tectonics-panel.js"), "utf8");
check("and the Geology subsection selects exactly that group",
  /\.filter\(\(\{ group \}\) => group === TECTONICS_GROUP\)/.test(panel));

/**
 * Every dataset still has a home.
 *
 * The Vectors tab is the list that shows EVERYTHING ELSE, so it is the safety
 * net: filter a second group out of it without building that group a panel of
 * its own and those datasets are still in the catalogue, still loadable by id,
 * and on no list anybody can find. Counting the exclusions is what says the
 * net is still whole — and it counts them in the SOURCE, because a filter
 * added later is exactly the change this is here to catch.
 */
const excluded = [...polygons.matchAll(/group !== (\w+)/g)].map((m) => m[1]);
check("the Vectors tab excludes one group and only one",
  excluded.length === 1 && excluded[0] === "TECTONICS_GROUP",
  excluded.join(", ") || "none");
check("so every catalogue group is drawn somewhere",
  GROUPS.every((g) => g === TECTONICS_GROUP || !excluded.includes(g)),
  `${DATASETS.length} datasets over ${GROUPS.length} groups`);

// The index page has to carry the host and load the module, or the panel is a
// file nothing runs.
const html = readFileSync(join(HERE, "../index.html"), "utf8");
check("the Geology section carries the host",
  /<details id="geology-tectonics"[\s\S]{0,400}id="tectonics-catalogue"/.test(html));
check("and the page loads the module that fills it",
  /src="gis\/tectonics-panel\.js/.test(html));

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
