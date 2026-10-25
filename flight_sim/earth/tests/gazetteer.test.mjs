// Earth Flight's gazetteer: places ranked into the significance hierarchy,
// each with a window -- how high and how far it is labelled from.
//
//   node flight_sim/earth/tests/gazetteer.test.mjs

import { rankFeature, rankWikipedia, dedupe, thinNearby, tilesAround, tilePointToLatLon, ringsFor, TIER_WINDOW, TIER_SIZE, WIKI_FROM_KM, nameKey } from "../game/gazetteer.js";

let passed = 0, failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + detail}`);
  if (ok) passed++; else failed++;
};
const shown = (r, altKm, km) => Boolean(r) && altKm <= r.maxAltKm && km <= r.reachKm;

// ── The hierarchy ─────────────────────────────────────────────────────────
for (let lod = 2; lod <= 7; lod++) {
  check(`tier ${lod} is seen from no higher than tier ${lod - 1}`, TIER_WINDOW[lod].maxAltKm <= TIER_WINDOW[lod - 1].maxAltKm);
  check(`tier ${lod} reaches no further than tier ${lod - 1}`, TIER_WINDOW[lod].reachKm <= TIER_WINDOW[lod - 1].reachKm);
  check(`tier ${lod} is drawn smaller than tier ${lod - 1}`, TIER_SIZE[lod] < TIER_SIZE[lod - 1]);
}

// ── OpenStreetMap places ──────────────────────────────────────────────────
const capital = rankFeature("place", { name: "Roma", name_en: "Rome", class: "city", capital: 2, rank: 1 }, 8);
check("a capital is tier 2, under its English name", capital?.lod === 2 && capital.name === "Rome", JSON.stringify(capital));
check("a town is tier 5", rankFeature("place", { name: "Tivoli", class: "town", rank: 11 }, 8)?.lod === 5);
check("a village is tier 6", rankFeature("place", { name: "Gallicano", class: "village" }, 11)?.lod === 6);
check("a hamlet is tier 7", rankFeature("place", { name: "Colle", class: "hamlet" }, 11)?.lod === 7);
check("countries and states are left to the HUD", rankFeature("place", { name: "Italia", class: "country" }, 8) === null && rankFeature("place", { name: "Lazio", class: "state" }, 8) === null);
check("an unnamed place is no label", rankFeature("place", { class: "town" }, 8) === null);
check("a 4,800 m peak is tier 4, a 1,200 m one tier 6",
  rankFeature("mountain_peak", { name: "Mont Blanc", class: "peak", ele: 4806 }, 8)?.lod === 4
  && rankFeature("mountain_peak", { name: "Monte Gennaro", class: "peak", ele: 1271 }, 11)?.lod === 6);
check("a volcano is in the volcanoes", rankFeature("mountain_peak", { name: "Etna", class: "volcano", ele: 3357 }, 8)?.category === "place-volcano");
check("a national park is an area at tier 4", (() => { const r = rankFeature("park", { name: "Gran Paradiso", class: "national_park" }, 8); return r?.lod === 4 && r.area; })());
check("an international airport is tier 5", rankFeature("aerodrome_label", { name: "Fiumicino", class: "international" }, 8)?.lod === 5);
check("a private airstrip is no label", rankFeature("aerodrome_label", { name: "Strip", class: "private" }, 11) === null);

// ── Wikipedia ─────────────────────────────────────────────────────────────
const page = (title, description, length, type = "landmark", lat = 38.8977, lon = -77.0365) =>
  ({ pageid: title.length, title, description, length, coordinates: [{ lat, lon, type }] });
const whiteHouse = rankWikipedia(page("White House", "Residence and workplace of the US president", 127808));
check("the White House is a tier-5 landmark", whiteHouse?.lod === 5 && whiteHouse.category === "place-landmark", JSON.stringify(whiteHouse));
// Owner: "the White House should be visible at low altitudes but not at high altitudes".
check("the White House is labelled at 1 km up, 3 km away", shown(whiteHouse, 1, 3));
check("the White House is not labelled from cruising height (10 km)", !shown(whiteHouse, 10, 3));
check("nor from 60 km away", !shown(whiteHouse, 1, 60));
check("Wikipedia is only asked below the highest wiki window", WIKI_FROM_KM >= whiteHouse.maxAltKm);
const plaque = rankWikipedia(page("Butt-Millet Memorial Fountain", "Memorial fountain in Washington, D.C.", 6000));
check("a small memorial is tier 7, labelled only close and low", plaque?.lod === 7 && shown(plaque, 1, 2) && !shown(plaque, 3, 2) && !shown(plaque, 1, 8));
check("an agency at its headquarters is not a place", rankWikipedia(page("Federal Bureau of Investigation", "U.S. federal law enforcement agency", 142181)) === null);
check("a think tank is not a place", rankWikipedia(page("Cato Institute", "American libertarian think tank", 112899)) === null);
check("an event is not a place", rankWikipedia(page("A photo op", "2020 controversial photo op", 262508, "event")) === null);
check("a room is part of its building", rankWikipedia(page("East Room", "Event and reception room in the Executive Residence", 98970)) === null);
check("a collection of buildings is a place", rankWikipedia(page("Federal Triangle", "Collection of buildings in Washington, D.C.", 134671, undefined)) !== null);
check("a museum is culture", rankWikipedia(page("National Air and Space Museum", "Museum in Washington, D.C.", 60000, undefined))?.category === "place-culture");
check("a cathedral is a place of worship", rankWikipedia(page("Washington National Cathedral", "Cathedral in Washington, D.C.", 50000))?.category === "place-worship");
check("a castle is historic", rankWikipedia(page("Castel Sant'Angelo", "Castle in Rome, Italy", 40000))?.category === "place-heritage");
check("a disambiguation is not part of the name",
  rankWikipedia(page("Old Post Office (Washington, D.C.)", "Hotel in Washington, DC", 161784))?.name === "Old Post Office"
  && rankWikipedia(page("Lafayette Square, Washington, D.C.", "Park in Washington, D.C.", 40000))?.name === "Lafayette Square");

// ── Duplicates ────────────────────────────────────────────────────────────
const curated = [{ name: "Rome", lat: 41.9028, lon: 12.4964 }];
const dup = dedupe([{ ...capital, lat: 41.89, lon: 12.49 }, { name: "Tivoli", lod: 5, lat: 41.96, lon: 12.80 }], curated);
check("a curated place is not doubled by the stream", dup.length === 1 && dup[0].name === "Tivoli", JSON.stringify(dup.map((d) => d.name)));
check("the same village from two zooms is one", dedupe([{ name: "Colle", lod: 7, lat: 42, lon: 12 }, { name: "Colle", lod: 6, lat: 42.002, lon: 12.001 }]).length === 1);
check("namesakes far apart are both kept", dedupe([{ name: "Colle", lod: 7, lat: 42, lon: 12 }, { name: "Colle", lod: 7, lat: 43, lon: 12 }]).length === 2);
check("names compare without accents or case", nameKey("Saint-Étienne") === nameKey("saint etienne"));
const thinned = thinNearby([whiteHouse, { ...plaque, lat: 38.8978, lon: -77.0366 }, { ...plaque, name: "Far", lat: 38.91, lon: -77.03 }]);
check("a minor place right beside a notable one is part of it", thinned.length === 2 && thinned[0].name === "White House", JSON.stringify(thinned.map((t) => t.name)));

// ── Tiles ─────────────────────────────────────────────────────────────────
const t11 = tilesAround(41.9, 12.5, 26, 11);
check("a 26 km ring at z11 is a handful of tiles", t11.length >= 9 && t11.length <= 25, String(t11.length));
const p = tilePointToLatLon(11, 1095, 760, 2048, 2048);
const back = tilesAround(p.lat, p.lon, 0.01, 11);
check("a tile's centre maps back into it", back.length === 1 && back[0].x === 1095 && back[0].y === 760, JSON.stringify(back));
check("the village ring streams only below 8 km", ringsFor(5).some((r) => r.z === 11) && !ringsFor(12).some((r) => r.z === 11));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
