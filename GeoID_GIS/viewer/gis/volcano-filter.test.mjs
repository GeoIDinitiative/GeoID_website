/**
 * The volcano year filter: which volcanoes are PLOTTED, and so which the
 * hazard buffers are drawn around. Run: node GeoID_GIS/viewer/gis/volcano-filter.test.mjs
 */
import {
  YEAR_FILTER, DEFAULT_YEAR_RANK, yearRankOf, inTimeFrame, filterVolcanoes, yearWords,
} from "./volcano-filter.js";

let pass = 0; const failures = [];
const check = (name, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { failures.push(name); console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
};
process.on("exit", () => {
  if (failures.length) {
    console.log(`\n${failures.length} failed, ${pass} passed`);
    process.exitCode = 1;
  } else console.log(`✓  volcano-filter.test.mjs  —  ${pass} passed`);
});

const v = (name, rank, type = "Stratovolcano") => ({
  type: "Feature", properties: { name, label_rank: rank, type_group: type },
  geometry: { type: "Point", coordinates: [15, 37.75] },
});
const fs = [v("A", 5), v("B", 4), v("C", 3), v("D", 2), v("E", 1), v("P", 0), v("U", undefined)];
const names = (list) => list.map((f) => f.properties.name).join("");

check("the default plots every volcano, Pleistocene and unranked included", DEFAULT_YEAR_RANK === 0
  && filterVolcanoes(fs).length === fs.length);
check("each time frame keeps rank >= its own and REMOVES the rest", names(filterVolcanoes(fs, { minRank: 4 })) === "AB"
  && names(filterVolcanoes(fs, { minRank: 1 })) === "ABCDE" && names(filterVolcanoes(fs, { minRank: 5 })) === "A");
check("an unranked volcano counts as rank 0: in the whole catalogue, out of every narrower frame",
  inTimeFrame(v("U", undefined), 0) && !inTimeFrame(v("U", undefined), 1));
check("types switched off leave the plot whatever the frame", names(filterVolcanoes(
  [v("S", 5), v("H", 5, "Shield"), v("O", 1, "Shield")], { minRank: 0, typesOff: new Set(["Shield"]) })) === "S");
check("year and type filters combine (AND)", names(filterVolcanoes(
  [v("S", 5), v("s", 1), v("H", 5, "Shield")], { minRank: 4, typesOff: new Set(["Shield"]) })) === "S");
check("a select's value reads as a rank; anything else is the default",
  yearRankOf("4") === 4 && yearRankOf(5) === 5 && yearRankOf("") === 0 && yearRankOf("7") === 0 && yearRankOf("x") === 0 && yearRankOf(null) === 0);
check("the six options are the catalogue's bands, oldest-inclusive first", Object.keys(YEAR_FILTER).join() === "0,1,2,3,4,5"
  && /Every volcano/.test(YEAR_FILTER[0]) && /since 1900/.test(YEAR_FILTER[4]));
check("the status words read as a phrase", yearWords(4) === "erupted since 1900" && yearWords("nonsense") === yearWords(0));
check("the filter returns a new list and never mutates its input", (() => {
  const input = [v("A", 5), v("B", 1)];
  const out = filterVolcanoes(input, { minRank: 5 });
  return out !== input && input.length === 2 && out.length === 1;
})());
