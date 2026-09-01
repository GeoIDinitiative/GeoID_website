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

// --- how much ice is in each complex ---
const thickPath = path.join(iceDir, "thickness.json");
ok("the ice volumes ship beside the tiles", fs.existsSync(thickPath));
if (fs.existsSync(thickPath)) {
  const vols = JSON.parse(fs.readFileSync(thickPath, "utf8"));
  const keys = Object.keys(vols);
  ok("with a row for every complex", keys.length > 190000, `${keys.length}`);
  /**
   * The totals are the check on the JOIN, not statistics for their own sake:
   * 149,318 km³ against Farinotti's consensus of about 158,000, and 343 mm of
   * sea-level equivalent against a published ~324 mm. A join that had silently
   * dropped or doubled a region would not land there.
   */
  let volume = 0;
  let below = 0;
  for (const [v, , b = 0] of Object.values(vols)) { volume += v; below += b; }
  ok("summing to the world's glacier ice", volume > 120000 && volume < 190000,
    `${Math.round(volume)} km3`);
  const sle = ((volume - below) * 0.917) / 361.8;
  ok("and to about a third of a metre of sea level", sle > 280 && sle < 400,
    `${sle.toFixed(0)} mm`);
  ok("Vatnajökull is one of the biggest of them", (vols["06-00209"]?.[0] ?? 0) > 2000,
    JSON.stringify(vols["06-00209"]));
  ok("every row carries its uncertainty",
    Object.values(vols).every((r) => r.length >= 2 && Number.isFinite(r[1])));
}

{
  const card = await import("./ice-card.js");
  card.useIceVolumes(() => ({ volumeKm3: 88.6, errorKm3: 8.9, belowSeaLevelKm3: 0,
    seaLevelMm: 0.2246 }));
  const c = card.iceCard({ kind: "Glacier or ice cap",
    rgi_id: "RGI2000-v7.0-C-06-00201", o1region: "06", area_km2: 596.6 });
  const head = Object.fromEntries(c.headline);
  // The volume never appears without its uncertainty: the model's own runs to
  // tens of percent, and a bare number would be read as a measurement.
  ok("the card leads with volume and its uncertainty",
    head["Ice volume"] === "88.6 ± 8.9 km³", JSON.stringify(c.headline));
  ok("mean thickness is derived from the published area",
    head["Mean thickness"] === "149 m", head["Mean thickness"]);
  ok("and the sea-level equivalent is there", head["Sea-level equivalent"] === "0.22 mm");
  ok("with the source named in the rows",
    c.rows.some(([k, v]) => k === "Ice volume source" && /IceBoost/.test(v)));
  card.useIceVolumes(null);
  const none = card.iceCard({ kind: "Glacier or ice cap", rgi_id: "x", o1region: "06" });
  ok("a complex with no volume says nothing about volume", none.headline.length === 0);
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

// --- change over time, out of the same archive ---
const { glimsChangeToGeoJSON } = await import("./research/connectors.js");
const outline = (id, date, area, extra = {}) => ({
  type: "Feature",
  properties: { glac_id: id, src_date: `${date}T00:00:00Z`, db_area: area,
    line_type: "glac_bound", ...extra },
  geometry: { type: "Point", coordinates: [0, 0] },
});
const changed = glimsChangeToGeoJSON({
  type: "FeatureCollection",
  features: [
    outline("A", "1990-08-01", 10), outline("A", "2010-08-01", 8),
    // One outline is not a change.
    outline("B", "2000-01-01", 5),
    // Two readings of one summer are not a change either.
    outline("C", "2000-06-01", 3), outline("C", "2000-11-01", 2.9),
    // An internal rock outcrop is not the glacier's edge.
    outline("D", "1990-01-01", 4), outline("D", "2015-01-01", 6),
    outline("D", "2016-01-01", 99, { line_type: "intrnl_rock" }),
  ],
});
ok("only glaciers the archive holds twice, years apart",
  changed.features.length === 2, String(changed.features.length));
const byId = Object.fromEntries(changed.features.map((f) => [f.properties.glac_id, f.properties]));
ok("shrinking is negative", byId.A.change_pct === -20 && byId.A.change_pct_yr === -1,
  JSON.stringify([byId.A.change_pct, byId.A.change_pct_yr]));
ok("growing is positive", byId.D.change_pct === 50);
ok("both dates ride on the feature",
  byId.A.first_date === "1990-08-01" && byId.A.last_date === "2010-08-01");
ok("and the geometry is the LATEST outline — the ice as last mapped",
  byId.A.last_area_km2 === 8 && byId.D.last_area_km2 === 6);
ok("an internal outcrop never becomes an outline", byId.D.outlines === 2);

/**
 * A glacier does not change by a fifth of itself in a year. Measured over the
 * Valais Alps, a handful of pairs came out at +244 and +432% a year — two
 * outlines of different things under one id, usually an early submission that
 * digitised one tributary — and a quantile legend running that far makes every
 * real value one colour.
 */
const wild = glimsChangeToGeoJSON({
  type: "FeatureCollection",
  features: [outline("E", "2000-01-01", 0.2), outline("E", "2003-01-01", 4)],
});
// --- the date window, which the server applies ---
const { glimsDateClause } = await import("./research/connectors.js");
ok("both ends are a DURING", glimsDateClause("1990-01-01", "2020-12-31")
  === "src_date DURING 1990-01-01T00:00:00Z/2020-12-31T23:59:59Z",
  String(glimsDateClause("1990-01-01", "2020-12-31")));
// One end alone is a real question — "everything since 1990".
ok("one end is an AFTER", /^src_date AFTER 1990/.test(glimsDateClause("1990-01-01", null)));
ok("the other is a BEFORE", /^src_date BEFORE 2020/.test(glimsDateClause(null, "2020-12-31")));
ok("no dates is no clause", glimsDateClause(null, null) === null);
ok("and rubbish is no clause", glimsDateClause("last tuesday", "") === null);

/**
 * THE BOX GOES INSIDE THE FILTER, in lat,lon order — both measured against the
 * live server: `bbox` and `cql_filter` are mutually exclusive there (HTTP 500),
 * and BBOX() in lon,lat order returns a confident zero features.
 */
const windowed = CONNECTORS["glims-change"].url({
  bbox: { minLon: 7.4, minLat: 45.7, maxLon: 8.6, maxLat: 46.6 },
  from: "1990-01-01", to: "2020-12-31",
});
const readable = decodeURIComponent(windowed);
ok("a windowed request filters on the server",
  /cql_filter=BBOX\(entity_geom,45.7,7.4,46.6,8.6\)/.test(readable)
  // `URLSearchParams` writes a space as `+`, which `decodeURIComponent` leaves
  // alone — so the readable form is `src_date+DURING+1990-...`.
  && /src_date\+DURING\+1990-01-01/.test(readable), readable.slice(-90));
ok("and never sends both bbox and cql_filter", !/[?&]bbox=/.test(windowed));
ok("an unwindowed one is the plain bbox",
  /[?&]bbox=7.4/.test(CONNECTORS["glims-change"].url({
    bbox: { minLon: 7.4, minLat: 45.7, maxLon: 8.6, maxLat: 46.6 } })));

// The window is applied again on the way in, so an outline outside it can
// never become an endpoint if the server filter is ever dropped.
const outside = glimsChangeToGeoJSON({
  type: "FeatureCollection",
  features: [outline("H", "1850-01-01", 20), outline("H", "1995-01-01", 12),
    outline("H", "2015-01-01", 9)],
}, { from: "1990-01-01", to: "2020-12-31" });
ok("the pair is taken from inside the window only",
  outside.features[0].properties.first_date === "1995-01-01"
  && outside.features[0].properties.first_area_km2 === 12,
  JSON.stringify(outside.features[0].properties.first_date));
ok("and the card can say which window it read",
  outside.features[0].properties.window === "1990-01-01 to 2020-12-31");

/**
 * NO SILENT CAP. GeoServer says how many it had — measured over the Valais
 * Alps, 15,568 matched against 4,000 returned — and a quarter of an archive
 * drawn as though it were all of it is a map answering a different question.
 */
const capped = glimsChangeToGeoJSON({
  type: "FeatureCollection", numberMatched: 15568, numberReturned: 2,
  features: [outline("F", "1990-01-01", 9), outline("F", "2010-01-01", 7)],
});
ok("a truncated fetch says so on the feature",
  /2 of 15,568 outlines/.test(capped.features[0].properties.archive_coverage || ""),
  String(capped.features[0].properties.archive_coverage));
ok("and a complete one claims nothing",
  glimsChangeToGeoJSON({ type: "FeatureCollection", numberMatched: 2, numberReturned: 2,
    features: [outline("G", "1990-01-01", 9), outline("G", "2010-01-01", 7)] })
    .features[0].properties.archive_coverage === null);

ok("an impossible rate is dropped, not drawn", wild.features.length === 0,
  JSON.stringify(wild.features.map((f) => f.properties.change_pct_yr)));

{
  const card = await import("./ice-card.js");
  const c = card.iceCard(byId.A);
  ok("the change card leads with both areas and the span",
    /Area change/.test(JSON.stringify(c.headline)) && /Between/.test(JSON.stringify(c.headline)));
  /**
   * The kicker names the SUBJECT, not the method. "Repeat outlines" is how the
   * layer is made; and it is not "vol. change" either, because two outlines
   * give an area and volume through time is not in this data.
   */
  ok("the kicker says what the card is about", c.kicker === "Glacier — change over time", c.kicker);
  ok("and the id and the tally are rows, not the card's second line",
    c.meta === "" && c.rows.some(([k]) => k === "GLIMS id")
    && c.rows.some(([k]) => k === "Outlines in the archive"));
  /**
   * AND IT SAYS WHAT IT IS NOT. An outline moving is not ice being weighed:
   * a glacier can thin for a decade without its edge shifting, and late-lying
   * snow can make an outline larger than the ice under it.
   */
  ok("and says an area change is not a mass balance",
    c.rows.some(([, v]) => /not a mass balance/i.test(v)));
}

// --- the time-lapse: which imagery, and which dates ---
const lapse = await import("./glacier-timelapse.js");
/**
 * Sentinel-2 is 10 m and starts in 2015; Landsat reaches 1984 and is what the
 * older half of any glacier record needs. Before that there is no imagery at
 * all, and the bar says so rather than drawing the wrong decade.
 */
ok("2020 is Sentinel-2", lapse.datasetForYear(2020).id === "COPERNICUS/S2_SR_HARMONIZED");
ok("2014 is Landsat 8", lapse.datasetForYear(2014).id === "LANDSAT/LC08/C02/T1_L2");
ok("2005 is Landsat 7", lapse.datasetForYear(2005).id === "LANDSAT/LE07/C02/T1_L2");
ok("1990 is Landsat 5", lapse.datasetForYear(1990).id === "LANDSAT/LT05/C02/T1_L2");
ok("1850 has no satellite", lapse.datasetForYear(1850) === null);

const seq = lapse.epochsFrom([
  { properties: { outline_date: "2000-08-01" } },
  { properties: { outline_date: "2000-08-01" } },
  { properties: { outline_date: "2016-09-01" } },
  { properties: { src_date: "1985-07-01T00:00:00Z" } },
  { properties: { outline_date: "not a date" } },
]);
ok("epochs are the distinct dates, in order",
  seq.epochs.map((e) => e.date).join(" ") === "1985-07-01 2000-08-01 2016-09-01",
  seq.epochs.map((e) => e.date).join(" "));
ok("and each keeps its own outlines", seq.epochs[1].features.length === 2);
ok("a date that is not a date is not an epoch", seq.epochs.length === 3);

/**
 * A slider with two hundred stops is not a control, so the fullest dates win —
 * and what was dropped is RETURNED rather than swallowed, the way every other
 * cap in this file is reported.
 */
const many = lapse.epochsFrom(
  Array.from({ length: 40 }, (_, i) => ({
    properties: { outline_date: `20${String(10 + i).padStart(2, "0")}-08-01` },
  })), { max: 5 });
ok("the sequence is capped", many.epochs.length === 5);
ok("and says how many dates it left out", many.dropped === 35, String(many.dropped));

/**
 * A FRAME IS THE STATE OF THE ICE, not the outlines filed that day.
 *
 * Measured on the Valais box, 410 outlines were filed on 2003-08-13 and 8 on
 * 2018-09-01, so drawing each date's own filings made whole glaciers appear
 * and vanish between frames — reported as the fills jumping around. Carrying
 * each glacier's latest outline forward is what removes that, and the two
 * properties below are what "carried forward" has to mean.
 */
{
  const feats = [
    { properties: { glac_id: "A", outline_date: "2000-01-01" } },
    { properties: { glac_id: "B", outline_date: "2000-01-01" } },
    { properties: { glac_id: "A", outline_date: "2010-01-01" } },
    { properties: { glac_id: "C", outline_date: "2015-01-01" } },
  ];
  const { epochs } = lapse.epochsFrom(feats);
  const frames = lapse.stateAsOf(feats, epochs);
  const shown = frames.map((f) => f.features.length);
  ok("a glacier nobody remapped keeps its outline",
    shown.join(" ") === "2 2 3", shown.join(" "));
  // The count may never fall: a falling count IS a glacier blinking out, which
  // is the whole fault, and it is invisible in a still frame.
  ok("so the drawn count never falls",
    shown.every((n, i) => i === 0 || n >= shown[i - 1]));
  ok("and a remapped glacier shows its NEW outline",
    frames[1].features.find((f) => f.properties.glac_id === "A")
      .properties.outline_date === "2010-01-01");
  // Every polygon drawn is a real outline with a real date — nothing is
  // interpolated, and the frame only ever holds outlines at or before its own.
  ok("nothing is drawn before it was filed",
    frames.every((f, i) => f.features.every(
      (x) => x.properties.outline_date <= epochs[i].date)));
  ok("what was remapped THIS date is marked",
    [...frames[1].fresh].join(",") === "A" && [...frames[2].fresh].join(",") === "C");
}

/**
 * THE BOX VOCABULARY, pinned — because getting it wrong is silent. Handed
 * `{west, south, east, north}`, `basemap-drape` reads `undefined` for every
 * edge, `chooseZoom` falls to 0, and the composite reports "no tiles for this
 * area", which reads as a service with no coverage.
 */
{
  // The player is where both animators meet the drape, so the pins live
  // against IT — the glacier driver hands it a box and nothing else.
  const playerSource = fs.readFileSync(path.join(here, "timelapse-player.js"), "utf8");
  ok("the time-lapse converts to the drape's own bbox shape",
    /minLon: bounds\.west, minLat: bounds\.south/.test(playerSource));
  ok("and to Earth Engine's, which is a third one",
    /minX: bounds\.west, minY: bounds\.south/.test(playerSource));
}

/**
 * THE MELT SEASON, not a few weeks around the date. Measured on the service:
 * Sentinel-2 over Iceland answered "no imagery" for a 90-day window in 2016 and
 * returned a picture for the summer — one satellite over one glacier in six
 * weeks is mostly cloud.
 */
ok("a northern season is that year's summer",
  JSON.stringify(lapse.seasonFor("2016-08-28", 64))
  === JSON.stringify({ from: "2016-05-01", to: "2016-10-31" }));
// Southern ice melts in the other half of the year, and a season that ran
// May-October there would composite the middle of its winter.
ok("a southern season crosses the new year",
  JSON.stringify(lapse.seasonFor("2016-02-01", -50))
  === JSON.stringify({ from: "2015-11-01", to: "2016-04-30" }));

ok("the imagery source is a choice, not just a fallback",
  Object.keys(lapse.IMAGERY_SOURCES).join(",") === "auto,gee,gibs,none");
{
  const playerSource = fs.readFileSync(path.join(here, "timelapse-player.js"), "utf8");
  // The GIBS credit is BURNT INTO the texture, which on a frame of a sequence
  // is a caption stamped across the ground; the bar names the source instead.
  ok("the banner is not burnt into a frame", /credit: false/.test(playerSource));
  ok("and the bar still names GIBS", /NASA EOSDIS GIBS/.test(playerSource));
  // Nothing is taken away until its replacement is in hand, or every step is
  // imagery → bare basemap → imagery, which reads as a blink.
  ok("the previous frame is only hidden once the next has arrived",
    playerSource.indexOf("scene.object3D.visible = true")
      < playerSource.indexOf("held.object3D.visible = false"));
  ok("and the next frame is fetched while this one is being looked at",
    /void sceneOf\(next\)/.test(playerSource));
}

const { gibsSourceFor, GIBS_IMAGERY_FROM } = await import("./tile-sources.js");
ok("GIBS covers 2000 onward", Boolean(gibsSourceFor("2005-08-01")));
ok("VIIRS takes over from 2012", /viirs/.test(gibsSourceFor("2016-08-01") || ""));
ok("MODIS carries the years before it", /modis/.test(gibsSourceFor("2005-08-01") || ""));
ok("and nothing at all before the archive starts",
  gibsSourceFor("1985-07-01") === null && GIBS_IMAGERY_FROM === "2000-02-24");

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
