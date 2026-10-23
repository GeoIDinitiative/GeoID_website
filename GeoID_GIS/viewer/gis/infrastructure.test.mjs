/**
 * Infrastructure: the exposure reading (infrastructure.js), the OSM bridge and
 * building connectors, Atlas's phrase reader, the catalogue home, and the
 * baked files where they are on disk.
 *
 *   node GeoID_GIS/viewer/gis/infrastructure.test.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  INSIDE_SCHEME, ASH_SCHEME, readFeature, exposeSource, summarise, describe, exposureCsv,
  compareItems, segmentKm, featureBox,
} from "./infrastructure.js";
import { SCHEMES, classIndex } from "./risk-assessment.js";
import { DEPOSIT_CLASSES } from "./ash-plume.js";
import {
  overpassBridgesQuery, overpassBridgesToGeoJSON, bridgeKind, BRIDGE_TIERS,
  overpassBuildingsQuery, overpassBuildingsToGeoJSON, buildingKind, BUILDING_MAX_SPAN,
} from "./research/connectors.js";
import { infrastructureCall, toolByName, checkArgs } from "./atlas-tools.js";
import { DATASETS, HOMES, GROUPS } from "./global-data.js";

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0; let fail = 0;
function check(msg, cond, detail = "") {
  if (cond) { pass += 1; console.log(`PASS  ${msg}`); } else { fail += 1; console.log(`FAIL  ${msg}${detail !== "" ? ` — ${detail}` : ""}`); }
}
process.on("exit", () => { console.log(`${pass} passed, ${fail} failed`); if (fail) process.exitCode = 1; });

const pt = (lon, lat, props = {}) => ({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: [lon, lat] } });
const line = (coords, props = {}) => ({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: coords } });
const square = (w, s, e, n, props = {}) => ({ type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } });

/* ── a flood: depth = 3 m west of lon 0.5, 0.3 m from 0.5 to 1, dry east of 1 ── */
const flood = (lon, lat) => {
  if (lat < 0 || lat > 1 || lon < 0 || lon > 2) return null;   // off the sheet
  return lon < 0.5 ? 3 : lon < 1 ? 0.3 : 0;
};
const F = SCHEMES.flood;

{
  const deep = readFeature(pt(0.2, 0.5), flood, F);
  check("a point in 3 m of water is in the flood's worst class", deep.k === 0 && deep.value === 3, JSON.stringify(deep));
  check("a point on dry ground on the sheet is on the map but not exposed", readFeature(pt(1.5, 0.5), flood, F).k === -2);
  check("a point off the sheet has no reading", readFeature(pt(5, 5), flood, F).k === -1);

  // A road from dry ground through shallow water into deep water: its class
  // is the worst it reaches, and its length is shared out segment by segment.
  const road = readFeature(line([[1.5, 0.5], [0.75, 0.5], [0.1, 0.5]]), flood, F);
  check("a line takes the worst class any of it reaches", road.k === 0, road.k);
  const shallow = F.classes.findIndex((c) => c.test(0.3));
  check("a line's length is shared between the classes it crosses",
    road.km[0] > 0 && road.km[shallow] === 0 && road.km.reduce((a, b) => a + b, 0) > 0,
    JSON.stringify(road.km));
  // The first segment's midpoint (1.125) is dry, the second's (0.425) is deep:
  // all of the second is counted deep and none of the first is classed.
  check("the deep share is the deep segment's length", Math.abs(road.km[0] - segmentKm([0.75, 0.5], [0.1, 0.5])) < 1e-6, road.km[0]);

  const house = readFeature(square(0.9, 0.4, 1.4, 0.6), flood, F);
  check("a polygon half in the water is in the water", house.k === shallow, house.k);
  check("a line across the antimeridian is not counted as 359° of road",
    readFeature(line([[179.9, 0], [-179.9, 0]]), () => 3, F).km[0] === 0);
}

{
  check("segmentKm: one degree of the equator is about 111 km", Math.abs(segmentKm([0, 0], [1, 0]) - 111.19) < 0.1, segmentKm([0, 0], [1, 0]));
  check("featureBox covers every coordinate", JSON.stringify(featureBox(line([[3, 1], [-2, 4]]))) === JSON.stringify({ west: -2, south: 1, east: 3, north: 4 }));
}

/* ── a whole source, summarised ── */
{
  const ports = {
    id: "infra-ports", noun: "Seaport", plural: "Seaports",
    features: [
      pt(0.1, 0.5, { name: "Deepharbour", type: "Large seaport", rank: 1 }),
      pt(0.2, 0.5, { name: "Littlequay", type: "Very small seaport", rank: 4 }),
      pt(0.7, 0.5, { name: "Midport", type: "Medium seaport", rank: 2 }),
      pt(1.5, 0.5, { name: "Dryport", type: "Small seaport", rank: 3 }),
      pt(40, 40, { name: "Faraway", type: "Large seaport", rank: 1 }),
    ],
  };
  const rail = { id: "infra-railways", noun: "Railway line", plural: "Railway lines", features: [line([[0.1, 0.2], [0.4, 0.2]], { type: "Main line", rank: 1 })] };
  const extent = { west: 0, south: 0, east: 2, north: 1 };
  const p = exposeSource(ports, flood, F, { extent });
  check("a source counts exposed features by class", p.total === 3 && p.count[0] === 2, JSON.stringify(p.count));
  check("features outside the extent are skipped, not read", !p.items.some((i) => i.name === "Faraway"));
  const r = exposeSource(rail, flood, F, { extent });
  check("a line source carries km per class", r.km && r.km[0] > 30, JSON.stringify(r.km));

  const s = summarise([p, r], F, { hazard: "Flood inundation", top: 3 });
  check("the list is worst class first, then most important, named before unnamed",
    s.top.map((i) => i.name || i.type).join(",") === "Deepharbour,Main line,Littlequay", s.top.map((i) => i.name || i.type).join(","));
  check("top is capped, all is kept", s.top.length === 3 && s.all.length === 4);
  const text = describe(s);
  check("the paragraph names what is inside", /Inside Flood inundation: 3 seaports, 1 railway line \(33 km\)/.test(text), text);
  check("the paragraph names the worst class reached", /worst class reached, Over 2 m of water/.test(text), text);
  check("the paragraph names the most exposed by name", /Deepharbour \(large seaport/.test(text), text);
  const csv = exposureCsv(s);
  check("the CSV has a row per exposed feature", csv.trim().split("\n").length === 2 + 4, csv);
  check("nothing inside is said plainly",
    /^Nothing on the infrastructure layers/.test(describe(summarise([exposeSource(ports, () => null, F)], F, { hazard: "X" }))));
}

{
  const crit = { k: 1, critical: true, rank: 1, population: null, name: "B" };
  const big = { k: 1, critical: false, rank: 1, population: 5e6, name: "A" };
  const worse = { k: 0, critical: false, rank: 5, population: null, name: "Z" };
  const sorted = [big, crit, worse].sort(compareItems).map((i) => i.name).join("");
  check("a worse class outranks a hospital, a hospital outranks a capital", sorted === "ZBA", sorted);
}

/* ── the schemes ── */
{
  check("the inside scheme has one class and reads 1 as inside", INSIDE_SCHEME.classes.length === 1
    && classIndex(INSIDE_SCHEME, 1) === 0 && classIndex(INSIDE_SCHEME, null) === -1);
  check("the ash scheme has a class per deposit class, worst first",
    ASH_SCHEME.classes.length === DEPOSIT_CLASSES.length && ASH_SCHEME.classes[0].test(500) && ASH_SCHEME.classes.at(-1).test(0.5));
  check("ash below a dusting is not exposed", classIndex(ASH_SCHEME, 0.05) === -2 && classIndex(ASH_SCHEME, 0.2) === ASH_SCHEME.classes.length - 1);
  check("ash class boundaries are half-open", classIndex(ASH_SCHEME, 10) === ASH_SCHEME.classes.findIndex((c) => /^10–100/.test(c.label)));
}

/* ── OSM bridges and buildings ── */
{
  const town = { minLon: 15.05, minLat: 37.48, maxLon: 15.15, maxLat: 37.55 };
  const region = { minLon: 14.5, minLat: 37, maxLon: 15.5, maxLat: 38 };
  const country = { minLon: 12, minLat: 36.5, maxLon: 16, maxLat: 40 };
  const t = overpassBridgesQuery(town);
  check("over a town every bridge is asked for", t.tier === BRIDGE_TIERS[0] && /way\["bridge"\]\["bridge"!="no"\]\(/.test(t.query), t.query);
  const r = overpassBridgesQuery(region);
  check("over a region, road bridges to tertiary and railway bridges", r.tier === BRIDGE_TIERS[1] && /tertiary/.test(r.query) && /railway/.test(r.query) && !/residential/.test(r.query), r.query);
  check("over a country, the main roads' bridges", overpassBridgesQuery(country).tier === BRIDGE_TIERS[2]);
  let refused = "";
  try { overpassBridgesQuery({ minLon: -10, minLat: 35, maxLon: 30, maxLat: 60 }); } catch (e) { refused = e.message; }
  check("a continent is refused in a sentence", /too large/.test(refused), refused);
  let noBox = "";
  try { overpassBridgesQuery(null); } catch (e) { noBox = e.message; }
  check("no box says to draw one", /draw one/.test(noBox));

  check("a railway bridge is a railway bridge of rank 1", bridgeKind({ bridge: "yes", railway: "rail" }).type === "Railway bridge" && bridgeKind({ railway: "rail" }).rank === 1);
  check("a motorway viaduct says so", bridgeKind({ bridge: "viaduct", highway: "motorway" }).type === "Road viaduct — motorway road");
  check("a footway bridge is a footbridge", bridgeKind({ bridge: "yes", highway: "footway" }).type === "Footbridge");
  check("a link road is ranked as its road", bridgeKind({ bridge: "yes", highway: "primary_link" }).rank === 2);

  const fc = overpassBridgesToGeoJSON({ elements: [
    { type: "way", id: 7, tags: { bridge: "yes", highway: "primary", name: "Ponte X", "bridge:structure": "arch", maxweight: "40 t" },
      geometry: [{ lat: 37.5, lon: 15.08 }, { lat: 37.5, lon: 15.09 }] },
    { type: "way", id: 8, tags: { bridge: "no", highway: "primary" }, geometry: [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }] },
    { type: "way", id: 9, tags: { bridge: "yes", highway: "primary" }, geometry: [{ lat: 1, lon: 1 }] },
  ] });
  const b = fc.features[0]?.properties;
  check("a bridge way becomes one line; bridge=no and single points are dropped", fc.features.length === 1);
  check("the bridge carries its card fields", b.name === "Ponte X" && b.type === "Road bridge — primary road" && b.structure === "arch"
    && b.maxweight_t === 40 && b.osm_id === "way/7", JSON.stringify(b));
  check("the bridge's deck is measured on the ground", Math.abs(b.deck_length_m - 884) < 5, b.deck_length_m);

  // One viaduct in three OSM ways: two sections end to end on one carriageway,
  // and the other carriageway 25 m beside them. A footbridge 300 m away and a
  // differently named bridge touching it stay their own.
  const way = (id, tags, pts) => ({ type: "way", id, tags: { bridge: "yes", ...tags }, geometry: pts.map(([lon, lat]) => ({ lon, lat })) });
  const d = 0.000225;   // ~25 m of latitude
  const merged = overpassBridgesToGeoJSON({ elements: [
    way(1, { highway: "motorway", name: "Big Viaduct" }, [[0, 0], [0.005, 0]]),
    way(2, { highway: "motorway", name: "Big Viaduct", ref: "I-45" }, [[0.005, 0], [0.01, 0]]),
    way(3, { highway: "motorway", name: "Big Viaduct" }, [[0.01, d], [0, d]]),
    way(4, { highway: "footway" }, [[0.003, 0.003], [0.0032, 0.003]]),
    way(5, { highway: "motorway", name: "Other Bridge" }, [[0.01, 0], [0.02, 0]]),
  ] }).features;
  const viaduct = merged.find((f) => f.properties.name === "Big Viaduct");
  check("a bridge's sections and carriageways are one structure", merged.length === 3 && viaduct.properties.sections === 3,
    merged.map((f) => `${f.properties.name || f.properties.type}:${f.properties.sections || 1}`).join(", "));
  check("the merged bridge keeps a ref any section carried, and every deck", viaduct.properties.ref === "I-45"
    && viaduct.geometry.type === "MultiLineString" && Math.abs(viaduct.properties.deck_length_m - 2226) < 10, viaduct.properties.deck_length_m);

  let tooBig = "";
  try { overpassBuildingsQuery(region); } catch (e) { tooBig = e.message; }
  check("buildings are refused over a region", /district/.test(tooBig), tooBig);
  const tiny = { minLon: 15.08, minLat: 37.5, maxLon: 15.09, maxLat: 37.51 };
  check("buildings are asked for over a district", /way\["building"\]/.test(overpassBuildingsQuery(tiny).query) && BUILDING_MAX_SPAN < 0.1);
  check("a hospital is critical whatever its building tag", buildingKind({ building: "yes", amenity: "hospital" }).critical
    && buildingKind({ building: "school" }).type === "School");
  check("an unknown building type is worded, not dropped", buildingKind({ building: "boathouse" }).type === "Boathouse building");
  const bf = overpassBuildingsToGeoJSON({ elements: [
    { type: "way", id: 1, tags: { building: "apartments", "building:levels": "5", name: "Block A" },
      geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1e-4 }, { lat: 1e-4, lon: 1e-4 }, { lat: 1e-4, lon: 0 }] },
    { type: "way", id: 2, tags: { highway: "primary" }, geometry: [{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }] },
  ] });
  const g = bf.features[0];
  check("a building way is closed into a polygon", bf.features.length === 1 && g.geometry.type === "Polygon"
    && JSON.stringify(g.geometry.coordinates[0][0]) === JSON.stringify(g.geometry.coordinates[0].at(-1)));
  check("a building carries its type and levels", g.properties.type === "Apartment block" && g.properties.levels === 5 && g.properties.critical === false);
}

/* ── Atlas ── */
{
  const flood = infrastructureCall("Which bridges and ports are inside the flood?");
  check("a question about bridges in a flood is an infrastructure call",
    flood?.name === "infrastructure_exposed" && flood.args.hazard === "flood" && flood.args.bridges === true, JSON.stringify(flood));
  const ash = infrastructureCall("what airports are under the ash");
  check("airports under the ash reads the ash", ash?.args.hazard === "ash" && !ash.args.bridges, JSON.stringify(ash));
  const area = infrastructureCall("how many hospitals are in the drawn area");
  check("the drawn area alone is read as the area", area?.args.area === "drawn" && !area.args.hazard && area.args.buildings === true, JSON.stringify(area));
  check("a road with no hazard is not a call", infrastructureCall("build a road to Catania") === null);
  check("a hazard with no infrastructure is not a call", infrastructureCall("model ash from Etna at 4pm") === null);
  const tool = toolByName("infrastructure_exposed");
  check("the tool is registered", Boolean(tool));
  check("a boolean argument is read as a boolean", checkArgs(tool, { bridges: "true" }).args.bridges === true
    && checkArgs(tool, { bridges: "no" }).args.bridges === false);
  const runner = readFileSync(join(HERE, "atlas-runner.js"), "utf8");
  check("the runner reaches the readout's seam", /GeoIDInfrastructure/.test(runner) && /infrastructure-panel\.js/.test(runner));
  const assistant = readFileSync(join(HERE, "atlas-assistant.js"), "utf8");
  check("the assistant asks the phrase reader before the intent reader",
    assistant.indexOf("infrastructureCall(q)") > 0 && assistant.indexOf("infrastructureCall(q)") < assistant.indexOf("callFromIntent(intent)"));
}

/* ── the catalogue ── */
{
  const html = readFileSync(join(HERE, "..", "index.html"), "utf8");
  check("Infrastructure is a home with a host, a status line and a readout",
    HOMES.infrastructure === "infrastructure-catalogue" && /id="infrastructure-catalogue"/.test(html)
    && /id="infrastructure-status"/.test(html) && /id="infrastructure-exposure"/.test(html));
  check("the page loads the readout", /gis\/infrastructure-panel\.js\?v=/.test(html));
  const home = DATASETS.filter((d) => d.home === "infrastructure");
  const want = ["infra-places", "infra-ports", "infra-airports", "infra-railways", "conn-osm-bridges", "conn-osm-buildings",
    "ne-roads-10m", "conn-osm-roads", "ne-urban-10m", "conn-submarine-cables", "conn-cable-landings"];
  check("roads, settlements, ports, airports, rail, bridges, buildings and cables live there",
    want.every((id) => home.some((d) => d.id === id)), want.filter((id) => !home.some((d) => d.id === id)).join(", "));
  check("every row names what its features are, for the card", home.every((d) => d.featureNoun));
  check("none is on at launch", home.every((d) => !d.defaultOn));
  check("their groups are groups the lists draw", home.every((d) => GROUPS.includes(d.group)));
  check("bridges and buildings take the drawn area or the view", ["conn-osm-bridges", "conn-osm-buildings"]
    .every((id) => DATASETS.find((d) => d.id === id)?.areaFrom === "drawn-or-view"));
}

/* ── the baked files, where they are on disk (gitignored; R2 in production) ── */
{
  const root = join(HERE, "..", "..", "..", "data", "global");
  for (const [file, min, fields] of [
    ["ports-wpi.geojson", 3500, ["name", "type", "country", "rank"]],
    ["airports_10m.geojson", 800, ["name", "type", "rank"]],
    ["populated_places_10m.geojson", 7000, ["name", "type", "country", "rank"]],
    ["railroads_10m.geojson", 20000, ["type", "rank"]],
  ]) {
    const path = join(root, file);
    if (!existsSync(path)) { console.log(`SKIP  ${file} not baked here`); continue; }
    const fc = JSON.parse(readFileSync(path, "utf8"));
    check(`${file}: ${fc.features.length.toLocaleString("en-GB")} features`, fc.features.length >= min);
    check(`${file}: every feature has ${fields.join(", ")}`, fc.features.every((f) => fields.every((k) => f.properties[k] != null)));
    check(`${file}: coordinates are signed degrees`, fc.features.every((f) => {
      const b = featureBox(f); return b && b.west >= -180 && b.east <= 180 && b.south >= -90 && b.north <= 90;
    }));
  }
}
