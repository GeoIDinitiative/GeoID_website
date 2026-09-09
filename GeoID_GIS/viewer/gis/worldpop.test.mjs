/**
 * The population layer: decades of people per km², a card in people, and its
 * place among the sheets the popup offers a click to.
 */
import { readFileSync } from "node:fs";
import {
  classOf, colourOf, legendFor, populationCard, cellAreaKm2, cellAt, DENSITY_EDGES, DENSITY_LABELS,
} from "./worldpop.js";
import { HOMES } from "./global-data.js";
import { mathsFor, PUBLISHED } from "./equations.js";

let pass = 0;
const failures = [];
const check = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass += 1;
  else failures.push(`${name}\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`);
};

check("decades of people per km²", DENSITY_EDGES, [1, 10, 100, 1000, 10000]);
check("one label more than the edges", DENSITY_LABELS.length, DENSITY_EDGES.length + 1);
check("nobody is not a class", classOf(0), -1);
check("a village and a city are four classes apart", [classOf(3), classOf(30000)], [1, 5]);
check("nodata is not painted, whichever float it arrives as", [colourOf(-99999, -99999), colourOf(-3.4028234663852886e+38, -3.4028235e+38)], [null, null]);
check("nobody is the dark none colour, never the ramp", colourOf(0, -99999), [0x2f, 0x3b, 0x46]);
const legend = legendFor([5, 1, 2, 3, 4, 5, 6]);
check("the key leads with nobody and reads in people", [legend.labels[0], legend.labels[3]], ["nobody", "10 – 100 per km²"]);
check("a 30 arcsecond cell at the equator is about 0.86 km²", Number(cellAreaKm2(0).toFixed(2)), 0.86);
check("and half that at 60°", Number((cellAreaKm2(60) / cellAreaKm2(0)).toFixed(2)), 0.5);
const card = populationCard({ lat: 51.5, lon: -0.12, count: 2880, density: 2880 / cellAreaKm2(51.5) }, { credit: "WorldPop" });
check("the card titles in people per km², from the count over the cell's ground", card.title, `${Math.round(2880 / cellAreaKm2(51.5)).toLocaleString()} people per km²`);
check("and reports the count itself", card.headline[0][1], `about 2,880 people over ${cellAreaKm2(51.5).toFixed(2)} km²`);
check("nobody says so", populationCard({ lat: 0, lon: 0, density: 0 }).title, "Fewer than 1 person per km²");
check("outside the model says so", populationCard({ outside: true }).title, "Outside the modelled area");
const info = { grid: [43200, 18720], bounds: { west: -180, east: 180, south: -72, north: 84 } };
check("a cell index is found", cellAt(51.5, -0.12, info), { x: 21585, y: 3900, lat: 51.5, lon: -0.12 });
check("Antarctica is outside", cellAt(-80, 0, info).outside, true);

const panels = readFileSync(new URL("./catalogue-panels.js", import.meta.url), "utf8");
check("the row is a TILED row under the exposure home", /"exposure": \[\{\s*id: "worldpop"/.test(panels), true);
check("the exposure home has a host", HOMES.exposure, "exposure-catalogue");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
check("the page carries the subtab and its status line", /id="exposure-catalogue"/.test(html) && /id="exposure-status"/.test(html), true);
const popup = readFileSync(new URL("./feature-popup.js", import.meta.url), "utf8");
check("a click on the sheet is offered to it", /GeoIDWorldPop\?\.probeAt\?\.\(at\.lat, at\.lon\)\) return;/.test(popup), true);
check("the working says whose model it is", mathsFor("worldpop").kind === PUBLISHED && /Southampton/.test(mathsFor("worldpop").citation), true);

process.on("exit", () => {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.log(`worldpop: ${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});
