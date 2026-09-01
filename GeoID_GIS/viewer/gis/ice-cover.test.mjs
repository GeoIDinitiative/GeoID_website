/**
 * THE ICE LAYER AND ITS BAKE, PINNED TO EACH OTHER.
 *
 * Three things can drift here and none of them fails loudly: the manifest the
 * panel fetches, the layer name inside the tiles it asks for, and the ceiling
 * past which there is nothing to fetch. A wrong layer name gives an empty map
 * with no error at all — the decoder is simply asked for a layer the tile does
 * not carry — which is exactly the class of fault this file exists to catch.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.log(`FAIL ${name}${detail ? `  — ${detail}` : ""}`); }
};

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const iceDir = path.join(root, "data", "global", "ice");
const manifestPath = path.join(iceDir, "manifest.json");

const panel = fs.readFileSync(path.join(here, "ice-cover-panel.js"), "utf8");
const baker = fs.readFileSync(
  path.join(root, "GeoID_GIS", "services", "bake-glaciers.py"), "utf8");

// --- the two halves agree about where the tiles are and what is in them ---
const bakedLayer = /TILE_LAYER = "([^"]+)"/.exec(baker)?.[1];
const askedLayer = /tiles: \{ manifest: MANIFEST, kind: "([^"]+)" \}/.exec(panel)?.[1];
ok("the bake names a tile layer", Boolean(bakedLayer), String(bakedLayer));
ok("the panel asks for the layer the bake writes",
  bakedLayer && askedLayer === bakedLayer, `panel ${askedLayer} / bake ${bakedLayer}`);

const askedManifest = /const MANIFEST = "([^"]+)"/.exec(panel)?.[1];
ok("the panel reads the manifest the bake writes",
  askedManifest === "/data/global/ice/manifest.json", String(askedManifest));

/**
 * THE SCHEME IS WEB MERCATOR XYZ, which is what `tilesForBounds` computes tile
 * bounds on — and the first bake was made on EPSG:4326 because a note in
 * CLAUDE.md said so. Nothing failed: every tile decoded, every polygon was
 * valid, and an Icelandic complex landed at 142 E, 78 N. So the check is that
 * the bake states NO tiling scheme, i.e. takes GDAL's Mercator default.
 */
ok("the bake leaves GDAL on its Web Mercator default",
  /TILING_SCHEME = None/.test(baker));
ok("and mvt.js really is slippy-map XYZ, one tile at zoom 0",
  /\(\(lon \+ 180\) \/ 360\) \* scale/.test(
    fs.readFileSync(path.join(here, "mvt.js"), "utf8")));
ok("and the tiles are left uncompressed for a static host",
  /COMPRESS=NO/.test(baker));

// --- the bake on disk ---
if (!fs.existsSync(manifestPath)) {
  ok("the glacier bake is on disk", false, `${manifestPath} is missing`);
} else {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const keys = Object.keys(manifest.tiles || {});
  ok("the manifest indexes its tiles", keys.length > 100, `${keys.length} tiles`);
  ok("it states a ceiling", Number.isFinite(manifest.max_zoom) && manifest.max_zoom >= 6,
    String(manifest.max_zoom));

  /**
   * The published global figure is about 705,000 km2 over roughly 200,000 ice
   * masses. A bake that has silently lost a region still looks like a glacier
   * map, so the total is the check.
   */
  ok("it holds the whole inventory",
    manifest.glaciers > 150000 && manifest.glaciers < 300000,
    `${manifest.glaciers} complexes`);
  ok("with the published global area",
    manifest.area_km2 > 600000 && manifest.area_km2 < 800000,
    `${manifest.area_km2} km2`);
  /**
   * RGI DOES NOT MAP THE TWO ICE SHEETS, which are about 96% of the ice on
   * Earth. Their absence is the one gap that would make this layer wrong at a
   * glance, so the bake carries them and this counts them.
   */
  ok("and the two ice sheets, which RGI does not map",
    (manifest.ice_sheets || 0) >= 2, String(manifest.ice_sheets));

  ok("it cites RGI 7.0 and its licence",
    /Randolph Glacier Inventory/i.test(manifest.citation || "")
    && /CC BY 4\.0/.test(manifest.licence || ""));

  // Every tile the manifest promises is a tile the client will ask for, and
  // there is no remote behind this pyramid to answer if it is not there.
  const sample = keys.filter((_, i) => i % Math.ceil(keys.length / 40) === 0);
  const missing = sample.filter((key) => !fs.existsSync(path.join(iceDir, `${key}.mvt`)));
  ok("every tile it promises is on disk", missing.length === 0,
    missing.slice(0, 3).join(" "));

  /**
   * THE ICE SHEETS ARE A FILE, NOT TILES, and the reason is the pole: Web
   * Mercator stops at 85.05 degrees, so a tiled Antarctic ice sheet is a ring
   * of ice around a hole exactly where the subject is.
   */
  const sheets = path.join(root, "data", "global", "ice-sheets.geojson");
  ok("the ice sheets ship as their own file", fs.existsSync(sheets));
  if (fs.existsSync(sheets)) {
    const body = JSON.parse(fs.readFileSync(sheets, "utf8"));
    const kinds = body.features.reduce((seen, f) => {
      seen[f.properties.kind] = (seen[f.properties.kind] || 0) + 1;
      return seen;
    }, {});
    ok("with both ice sheets in it", (kinds["Ice sheet"] || 0) >= 2,
      JSON.stringify(kinds));
    /**
     * AND THE FLOATING ICE. `ne_10m_glaciated_areas` is the GROUNDED sheet
     * only — measured, Ross, Filchner-Ronne and Amery were all absent from the
     * first version of this file, about 1.6 million km2 of ice cover missing
     * from a layer called ice cover.
     */
    ok("and the ice shelves around them", (kinds["Ice shelf"] || 0) > 100,
      JSON.stringify(kinds));

    let south = 90;
    const walk = (c) => {
      if (typeof c[0] === "number") south = Math.min(south, c[1]);
      else c.forEach(walk);
    };
    body.features.forEach((f) => walk(f.geometry.coordinates));
    ok("reaching past Mercator's own limit", south < -85.05, `${south}`);

    /**
     * EVERY FEATURE HAS GEOMETRY, and this is not paranoia: simplifying the
     * thin shelves turned one into a LineString and two into features with no
     * geometry at all, and asking GDAL to re-split the antimeridian emptied
     * half of the Ross Ice Shelf. Each of those is a valid-looking feature
     * with nothing to draw.
     */
    ok("every feature is a polygon with coordinates in it",
      body.features.every((f) => f.geometry?.coordinates?.length
        && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon")));

    // The named shelves, by point-in-polygon on their own middles — the check
    // that the antimeridian split survived is Ross, which straddles it.
    const inRing = (lon, lat, ring) => {
      let inside = false;
      // `j = i, i += 1` — NOT `j = i += 1`, which assigns the INCREMENTED i to
      // j and tests every edge against itself. It reports every point outside
      // every polygon, which reads as missing data rather than as a broken test.
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (((yi > lat) !== (yj > lat))
          && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    };
    const nameAt = (lon, lat) => {
      for (const f of body.features) {
        const parts = f.geometry.type === "Polygon"
          ? [f.geometry.coordinates] : f.geometry.coordinates;
        for (const part of parts) if (inRing(lon, lat, part[0])) return f.properties.name;
      }
      return null;
    };
    for (const [label, lon, lat, want] of [
      ["Ross, west of the dateline", -175, -81.5, "Ross Ice Shelf"],
      ["Ross, east of the dateline", 175, -80.5, "Ross Ice Shelf"],
      ["Ronne", -60, -78, "Ronne Ice Shelf"],
      ["Filchner", -40, -79.5, "Filchner Ice Shelf"],
      ["Amery", 71, -70, "Amery Ice Shelf"],
      ["the East Antarctic interior", 90, -80, "Antarctic Ice Sheet"],
      ["the South Pole", 0, -89.9, "Antarctic Ice Sheet"],
      ["the Greenland interior", -40, 72, "Greenland Ice Sheet"],
    ]) ok(`${label} is covered`, nameAt(lon, lat) === want, String(nameAt(lon, lat)));
  }

  /**
   * THE COARSE LEVELS MUST STAY LIGHT, and this is a regression check with a
   * measurement behind it.
   *
   * Baked with every complex at every level, the world backdrop was 15 tiles
   * holding tens of thousands of polygons: **33 seconds from the tick before
   * the view's own tiles were even requested**, and what it drew meanwhile was
   * quantised to about 2.4 km — reported as "not tight to the surface, view
   * offset. Theres a latency in load time too." The bake now drops what cannot
   * be seen at a level: nothing under 200 km2 below zoom 3, under 20 km2 below
   * zoom 5, under 5 km2 at zoom 5.
   */
  const bytesAt = (zoom) => keys
    .filter((k) => k.startsWith(`${zoom}/`))
    .reduce((sum, k) => sum + manifest.tiles[k], 0);
  const worldBytes = bytesAt(0) + bytesAt(1) + bytesAt(2);
  ok("the world backdrop is light enough to arrive at once",
    worldBytes < 2e6, `${Math.round(worldBytes / 1e3)} kB across zooms 0-2`);
  /**
   * A coarse tile covers a continent, so one over the Greenland or Canadian
   * Arctic archipelago is genuinely full of ice — 653 kB is the largest at
   * zoom 4 and that is a fetch, not a download. The line is drawn at 1 MB: past
   * that a single tile is the wait rather than part of it. The deep tiles are
   * exempt by design (the worst is 1.9 MB over the Karakoram) — those are
   * fetched only by a view small enough to want them.
   */
  const coarse = keys.filter((k) => Number(k.split("/")[0]) <= 4);
  ok("and no single coarse tile is a download of its own",
    coarse.every((k) => manifest.tiles[k] < 1e6),
    `${Math.round(Math.max(...coarse.map((k) => manifest.tiles[k])) / 1e3)} kB`);

  const zooms = new Set(keys.map((k) => Number(k.split("/")[0])));
  ok("the world is there at zoom 0", zooms.has(0));
  ok("and so is the deepest level", zooms.has(manifest.max_zoom));
}

// --- the names the complexes do not carry themselves ---
const namesPath = path.join(iceDir, "names.json");
ok("the glacier names ship beside the tiles", fs.existsSync(namesPath));
if (fs.existsSync(namesPath)) {
  const names = JSON.parse(fs.readFileSync(namesPath, "utf8"));
  const entries = Object.entries(names);
  ok("with a name for a fifth of the inventory",
    entries.length > 30000, `${entries.length} named`);
  ok("each carrying where the name came from",
    entries.every(([, v]) => Array.isArray(v) && v[0] && ["RGI", "GeoNames"].includes(v[1])));
  /**
   * AN OUTLET'S NAME IS NOT THE ICE CAP'S NAME, and this is the check that the
   * rule held. Vatnajökull is 99 glaciers in RGI, nine of them named — every
   * one an outlet (Skeiðarárjökull, Brúarjökull…). Naming the complex after
   * the largest would be wrong in the way that is hardest to notice.
   */
  for (const [id, want] of [["06-00209", "Vatnajökull"], ["06-00201", "Mýrdalsjökull"],
    ["06-00200", "Eyjafjallajökull"]]) {
    ok(`${want} is named as itself`, names[id]?.[0] === want, JSON.stringify(names[id]));
  }
  ok("the ice caps are matched from the gazetteer, not from an outlet",
    names["06-00209"]?.[1] === "GeoNames");
  // The key drops the constant prefix — 14 bytes on every one of forty thousand.
  ok("keys are the bare complex id", entries.every(([k]) => !k.startsWith("RGI2000")));
}

// The card reads that table through an injected lookup, so it stays pure.
{
  const card = await import("./ice-card.js");
  card.useIceNames((id) => (id === "RGI2000-v7.0-C-06-00201"
    ? { name: "Mýrdalsjökull", source: "GeoNames" } : null));
  const named = card.iceCard({
    kind: "Glacier or ice cap", rgi_id: "RGI2000-v7.0-C-06-00201",
    o1region: "06", area_km2: 596.6,
  });
  ok("a named complex is titled by its name", named.title === "Mýrdalsjökull", named.title);
  ok("and says the name was matched by position",
    named.rows.some(([k, v]) => k === "Name from" && /GeoNames/.test(v)));
  const bare = card.iceCard({
    kind: "Glacier or ice cap", rgi_id: "RGI2000-v7.0-C-06-00999", o1region: "06",
  });
  ok("an unnamed one still says where it is",
    bare.title === "Glacier complex, Iceland", bare.title);
  card.useIceNames(null);
}

// --- the GLIMS connector: one outline per glacier, and no global pull ---
const { CONNECTORS, glimsOutlinesToGeoJSON } = await import("./research/connectors.js");
ok("GLIMS is a registered connector", Boolean(CONNECTORS["glims-outlines"]));
let refused = false;
try { CONNECTORS["glims-outlines"].url({}); } catch { refused = true; }
ok("a global pull is refused — the archive is fetched over a study area", refused);
/**
 * The bbox vocabulary is `minLon/minLat/maxLon/maxLat`, and it has to be the
 * one `global-data.js` BUILDS: it used to hand these builders an ARRAY, so
 * every live row that takes a study area sent `undefined` in its box and the
 * service answered as though none had been given. Nothing threw.
 */
ok("with an area it asks GLIMS for GeoJSON in the box",
  /bbox=1%2C2%2C3%2C4|bbox=1,2,3,4/.test(
    CONNECTORS["glims-outlines"].url(
      { bbox: { minLon: 1, minLat: 2, maxLon: 3, maxLat: 4 } })));
const globalData = fs.readFileSync(path.join(here, "global-data.js"), "utf8");
ok("and the catalogue builds a box in that same vocabulary",
  /minLon: Math\.min\(\.\.\.lons\)/.test(globalData)
  && /maxLat: Math\.max\(\.\.\.lats\)/.test(globalData));

/**
 * The archive holds every outline anybody has submitted, so one glacier can
 * carry several — measured over Iceland, 675 outlines for 608 glaciers, one of
 * them mapped six times. Drawn raw that is the same ice counted six times.
 */
const archive = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { glac_id: "G1", src_date: "1999-08-01T00:00:00Z", line_type: "glac_bound", db_area: 9 }, geometry: { type: "Point", coordinates: [0, 0] } },
    { type: "Feature", properties: { glac_id: "G1", src_date: "2004-07-16T00:00:00Z", line_type: "glac_bound", db_area: 7 }, geometry: { type: "Point", coordinates: [0, 0] } },
    { type: "Feature", properties: { glac_id: "G2", src_date: "2000-01-01T00:00:00Z", line_type: "glac_bound", db_area: 3 }, geometry: { type: "Point", coordinates: [1, 1] } },
    { type: "Feature", properties: { glac_id: "G2", src_date: "2001-01-01T00:00:00Z", line_type: "intrnl_rock", db_area: 1 }, geometry: { type: "Point", coordinates: [1, 1] } },
  ],
};
const thinned = glimsOutlinesToGeoJSON(archive);
ok("one outline per glacier", thinned.features.length === 2, String(thinned.features.length));
ok("and it is the LATEST imagery date",
  thinned.features.find((f) => f.properties.glac_id === "G1").properties.outline_date === "2004-07-16");
ok("an internal rock outcrop is not a glacier boundary",
  thinned.features.every((f) => f.properties.line_type === "glac_bound"));
ok("the card's own words are filled in",
  thinned.features.every((f) => f.properties.kind === "Glacier outline (GLIMS)"
    && Number.isFinite(f.properties.area_km2)));

// --- the card an ice polygon opens ---
const { isIceFeature, iceCard, RGI_REGIONS } = await import("./ice-card.js");

ok("RGI's nineteen regions are all named", Object.keys(RGI_REGIONS).length === 19);
ok("a rock is not ice", !isIceFeature({ lith: "basalt" }) && !isIceFeature(null));
ok("each of the four ice kinds is", ["Glacier or ice cap", "Ice sheet",
  "Ice shelf", "Glacier outline (GLIMS)"].every((kind) => isIceFeature({ kind })));

const complex = iceCard({
  kind: "Glacier or ice cap", rgi_id: "RGI2000-v7.0-C-06-00200",
  o1region: "06", area_km2: 80.4,
});
/**
 * An unnamed glacier is not a nameless one — RGI names about a tenth of its
 * complexes — so it is titled by WHERE it is. "Unnamed" says nothing and reads
 * like a fault in the data.
 */
ok("an unnamed complex is titled by its region",
  complex.title === "Glacier complex, Iceland", complex.title);
ok("and carries its published area and id",
  complex.rows.some(([k, v]) => k === "Published area (RGI)" && v === "80.4 km²")
  && complex.rows.some(([k, v]) => k === "RGI id" && v.endsWith("00200")));

/**
 * FLOATING OR GROUNDED IS THE FIRST THING THE CARD SAYS about the big ice.
 * Before this existed, a click on the Ross Ice Shelf read "Continental" —
 * `crustalSetting` answering about a polygon afloat on 500 m of seawater.
 */
const shelf = iceCard({ kind: "Ice shelf", name: "Ross Ice Shelf" });
ok("a shelf says it is floating", shelf.kicker === "Ice shelf — floating", shelf.kicker);
ok("and it is named", shelf.title === "Ross Ice Shelf");
// The meta line says who mapped it rather than repeating the kicker.
ok("with its source under the name", shelf.meta === "Natural Earth 10m", shelf.meta);
ok("a sheet says it is grounded",
  iceCard({ kind: "Ice sheet", name: "Antarctic Ice Sheet" }).kicker === "Ice sheet — grounded");

const glims = iceCard({
  kind: "Glacier outline (GLIMS)", glac_id: "G340285E63628N",
  outline_date: "2000-08-28", db_area: 1.63497,
});
// The DATE is the fact that separates a GLIMS outline from RGI's, so it is on
// the card's own meta line rather than buried in the rows.
ok("a GLIMS outline leads with its id and imagery date",
  /G340285E63628N/.test(glims.meta) && /imagery 2000-08-28/.test(glims.meta), glims.meta);
ok("a rock never reaches the ice card", iceCard({ lith: "granite" }) === null);

// Both card paths must use it, or an ice polygon reads one way from the tiles
// and another way from the file.
for (const [file, what] of [["feature-popup.js", "the imported ice layers"],
  ["geology-panel.js", "the tiled inventory"]]) {
  const body = fs.readFileSync(path.join(here, file), "utf8");
  ok(`${what} build their card through ice-card.js`,
    /isIceFeature\(props\)/.test(body) && /iceCard\(props\)/.test(body));
}

// --- the predicate that keeps ice out of the geological map ---
const { isIceCover, isNotIceCover } = await import("./ice-cover.js");
const f = (lith, name) => ({ properties: { lith, name } });
ok("a unit whose lithology is ice is ice", isIceCover(f("ice", "Phanerozoic ice")));
ok("a unit named ice with no lithology is ice", isIceCover(f("", "Phanerozoic ice")));
ok("a glacial DEPOSIT is geology", !isIceCover(f("glacial till", "Till")));
ok("so is ice-contact sand", !isIceCover(f("sand", "Ice-contact glaciofluvial sand")));
ok("Iceland is not ice", !isIceCover(f("basalt", "Iceland basalt")));
ok("pumice is not ice", !isIceCover(f("pumice", "Pumice deposit")));
ok("the complement is the complement",
  isNotIceCover(f("basalt", "x")) && !isNotIceCover(f("ice", "y")));

console.log(`${pass} passed`);
if (fail) console.log(`${fail} FAILED`);
process.exit(fail ? 1 : 0);
