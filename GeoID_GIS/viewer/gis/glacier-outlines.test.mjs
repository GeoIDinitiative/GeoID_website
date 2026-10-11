/**
 * A GLACIER IS EVERY PIECE OF ITS OUTLINE.
 *
 * Reported on Katla: "only half of Mýrdalsjökull is mapped and animated". GLIMS
 * stores a glacier boundary as ROWS, one polygon each, under one `glac_id` — an
 * ice cap digitised in two parts is two rows, often on two analyses and two
 * imagery dates. Every reader of the archive kept ONE row per id: the cover map
 * the latest, the time-lapse the latest at or before each frame, the ghost the
 * first seen, the change layer the latest as its geometry. So whichever half
 * was filed last was the whole glacier, everywhere.
 *
 * And the renderer's half of the same symptom: a ring a GeoJSON file writes as
 * a hole when it is really a second outer ring was refused by `fillTriangles`
 * (rightly — it would bridge) and then never drawn at all.
 *
 * Run: node GeoID_GIS/viewer/gis/glacier-outlines.test.mjs
 */

globalThis.window = {
  GeoIDViewer: { elevationNormalized: () => 0.5, surfacePoint: null },
  addEventListener() {},
  dispatchEvent() {},
};

const outlines = await import("./glacier-outlines.js");
const lapse = await import("./glacier-timelapse.js");
const { glimsOutlinesToGeoJSON, glimsChangeToGeoJSON } = await import("./research/connectors.js");
const { renderFeatureCollection, regroupRings } = await import("./vector-render.js");

let pass = 0;
const failed = [];
function ok(name, cond, detail = "") {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { failed.push(name); console.log(`FAIL ${name}${detail ? `  — ${detail}` : ""}`); }
}
process.on("exit", () => {
  console.log(`\n${pass} passed${failed.length ? `\n${failed.length} FAILED` : ""}`);
  if (failed.length) process.exitCode = 1;
});

/** A lon/lat box as a closed ring. */
const box = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
/** A GLIMS row: one polygon of one glacier, on one date. */
const row = (id, date, ring, extra = {}) => ({
  type: "Feature",
  properties: { glac_id: id, src_date: `${date}T00:00:00Z`, line_type: "glac_bound",
    db_area: 300, anlys_id: extra.anlys ?? 1, ...extra },
  geometry: { type: "Polygon", coordinates: [ring] },
});

// Mýrdalsjökull, roughly: 63.55–63.75°N, 19.4–18.8°W. Split at 19.1°W — two
// halves sharing the divide between them, as two scenes or two analysts would.
const WEST = box(-19.4, 63.55, -19.1, 63.75);
const EAST = box(-19.1, 63.55, -18.8, 63.75);
const KATLA = "G340900E63630N";

// --- the ledger: halves coexist, a remapping supersedes ---
{
  const west = row(KATLA, "2000-08-28", WEST, { anlys: 11 });
  const east = row(KATLA, "2000-08-28", EAST, { anlys: 11 });
  const { features } = outlines.latestGlaciers([west, east]);
  ok("two halves of one ice cap are ONE glacier", features.length === 1, String(features.length));
  ok("drawn with BOTH halves",
    features[0].geometry.type === "MultiPolygon" && features[0].geometry.coordinates.length === 2,
    JSON.stringify(features[0].geometry.type));
  ok("halves sharing a divide are not the same ice", !outlines.sameIce(east, west));

  // The same halves filed on two different dates: the later one must not
  // erase the earlier, because it does not cover it.
  const west99 = row(KATLA, "1999-09-09", WEST, { anlys: 7 });
  const east03 = row(KATLA, "2003-07-16", EAST, { anlys: 9 });
  const later = outlines.latestGlaciers([east03, west99]).features;
  ok("halves on two dates still make the whole ice cap",
    later.length === 1 && later[0].geometry.coordinates?.length === 2);
  ok("and the feature says it is assembled from pieces",
    later[0].properties.outline_pieces === 2
    && later[0].properties.outline_dates.join(",") === "1999-09-09,2003-07-16");

  // A real remapping: the whole cap in 1999, the cap retreated in 2010. The
  // newer outline lies inside the older one, so it REPLACES it.
  const whole99 = row(KATLA, "1999-09-09", box(-19.4, 63.55, -18.8, 63.75));
  const whole10 = row(KATLA, "2010-08-01", box(-19.38, 63.56, -18.83, 63.74));
  const remapped = outlines.latestGlaciers([whole99, whole10]).features;
  ok("a remapped outline replaces the one it remaps",
    remapped.length === 1 && remapped[0].geometry.type === "Polygon"
    && remapped[0].properties.mapped_times === 2);

  // Advance as well as retreat: the newer outline contains the older.
  ok("an advanced outline is the same ice too", outlines.sameIce(whole99, whole10)
    && outlines.sameIce(whole10, whole99));

  // With no polygon to compare, the id decides — the old rule, unchanged.
  const pt = (date) => ({ properties: { glac_id: "P", outline_date: date },
    geometry: { type: "Point", coordinates: [0, 0] } });
  ok("a point outline keeps the old rule: same id, same ice",
    outlines.latestGlaciers([pt("2000-01-01"), pt("2010-01-01")]).features.length === 1
    && outlines.latestGlaciers([pt("2000-01-01"), pt("2010-01-01")]).features[0]
      .properties.outline_date === "2010-01-01");

  // The area is measured off the polygon: a 0.3° × 0.2° box at 63.65°N.
  const a = outlines.pieceAreaKm2(west);
  const expect = (0.3 * Math.PI / 180) * 6371.0088 * Math.cos(63.65 * Math.PI / 180)
    * (0.2 * Math.PI / 180) * 6371.0088;
  ok("a piece's area is the polygon's own", Math.abs(a - expect) / expect < 0.01,
    `${a.toFixed(1)} against ${expect.toFixed(1)} km²`);
}

// --- the time-lapse: half of Katla must never be the frame ---
{
  const west99 = row(KATLA, "1999-09-09", WEST, { anlys: 7 });
  const east03 = row(KATLA, "2003-07-16", EAST, { anlys: 9 });
  const other = row("G341024E63606N", "1999-09-09", box(-19.7, 63.6, -19.5, 63.7));
  const features = [east03, west99, other];
  const { epochs } = lapse.epochsFrom(features);
  const frames = lapse.stateAsOf(features, epochs);
  const katlaAt = (i) => frames[i].features.find((f) => f.properties.glac_id === KATLA);
  ok("1999: the half mapped then, and only that",
    katlaAt(0).geometry.type === "Polygon");
  ok("2003: the east half joins the west rather than replacing it",
    katlaAt(1).geometry.type === "MultiPolygon" && katlaAt(1).geometry.coordinates.length === 2);
  ok("the count is GLACIERS, and it never falls",
    frames.map((f) => f.features.length).join(" ") === "2 2");
  ok("what was remapped is counted by glacier, not by row",
    [...frames[1].fresh].join(",") === KATLA);

  const ghost = lapse.ghostFeatures(features);
  const ghostKatla = ghost.find((f) => f.properties.glac_id === KATLA);
  ok("the ghost carries the whole ice cap, not the first row seen",
    ghostKatla.geometry.type === "MultiPolygon" && ghostKatla.geometry.coordinates.length === 2);

  // A glacier filed as two halves on two dates was mapped ONCE: measured
  // against its first row it would read "gained 100%".
  const firstArea = lapse.firstAreas(features);
  ok("two halves are one mapping, not two", firstArea.get(KATLA).outlines === 1,
    JSON.stringify(firstArea.get(KATLA)));
  const change = lapse.colouringFor("change", { date: "2003-07-16", firstArea });
  ok("so the change map leaves it in the no-value grey",
    change.colourFor(katlaAt(1)) === "#8a8a8a", change.colourFor(katlaAt(1)));

  // Then the WEST half is remapped smaller: the change is measured against
  // what that half replaced, with the untouched east half on both sides.
  const westSmaller = row(KATLA, "2015-08-01", box(-19.4, 63.57, -19.1, 63.73), { anlys: 12 });
  const later = [...features, westSmaller];
  const ep2 = lapse.epochsFrom(later).epochs;
  const fr2 = lapse.stateAsOf(later, ep2);
  const k = fr2[fr2.length - 1].features.find((f) => f.properties.glac_id === KATLA);
  const westA = outlines.pieceAreaKm2(west99);
  const eastA = outlines.pieceAreaKm2(east03);
  const smallA = outlines.pieceAreaKm2(westSmaller);
  const want = ((smallA + eastA) - (westA + eastA)) / (westA + eastA) * 100;
  const got = (k.properties.area_now_km2 - k.properties.first_area_km2)
    / k.properties.first_area_km2 * 100;
  ok("a half remapped is a change of the WHOLE glacier", Math.abs(got - want) < 1e-6
    && k.properties.mapped_times === 2 && k.geometry.coordinates.length === 2,
    `${got.toFixed(2)}% against ${want.toFixed(2)}%`);
  ok("and it colours as the loss it is",
    lapse.colouringFor("change", { date: "2015-08-01", firstArea: lapse.firstAreas(later) })
      .colourFor(k) === "#fddbc7");
}

// --- the connectors: the cover map and the change layer ---
{
  const archive = { type: "FeatureCollection", features: [
    row(KATLA, "1999-09-09", WEST, { anlys: 7 }),
    row(KATLA, "2003-07-16", EAST, { anlys: 9 }),
  ] };
  const cover = glimsOutlinesToGeoJSON(archive);
  ok("the outlines row draws all of Katla",
    cover.features.length === 1 && cover.features[0].geometry.coordinates.length === 2);
  ok("with the card's own words filled in",
    cover.features[0].properties.kind === "Glacier outline (GLIMS)"
    && Number.isFinite(cover.features[0].properties.area_km2));

  const changed = glimsChangeToGeoJSON({ type: "FeatureCollection", features: [
    ...archive.features,
    row(KATLA, "2015-08-01", box(-19.4, 63.57, -19.1, 63.73), { anlys: 12 }),
  ] });
  const c = changed.features[0];
  ok("the change layer draws the whole glacier as last mapped",
    changed.features.length === 1 && c.geometry.type === "MultiPolygon"
    && c.geometry.coordinates.length === 2);
  ok("and measures the change of the whole, not of one half against the other",
    c.properties.change_pct < 0 && c.properties.change_pct > -20, String(c.properties.change_pct));

  // Two halves alone are ONE mapping: no change to report.
  ok("halves alone are not a change", glimsChangeToGeoJSON(archive).features.length === 0);
}

// --- the renderer: a ring written as a hole that is not one ---
{
  const A = box(10, 40, 11, 41);
  const B = box(12, 40, 13, 41);
  const wellFormed = [[box(0, 0, 4, 4), box(1, 1, 2, 2)]];
  ok("a well-formed polygon is returned untouched", regroupRings(wellFormed) === wellFormed);
  const mis = regroupRings([[A, B]]);
  ok("a second OUTER ring written as a hole becomes its own polygon",
    mis.length === 2 && mis.every((p) => p.length === 1));
  const swapped = regroupRings([[box(1, 1, 2, 2), box(0, 0, 4, 4)]]);
  ok("rings in the wrong order: the big one is the outer, the small one its hole",
    swapped.length === 1 && swapped[0].length === 2 && swapped[0][0][2][0] === 4);
  const misfiled = regroupRings([[box(0, 0, 4, 4)], [box(10, 10, 14, 14), box(1, 1, 2, 2)]]);
  ok("a hole filed under the wrong part is given to the part that holds it",
    misfiled.length === 2 && misfiled.find((p) => p[0][2][0] === 4).length === 2);
  // An island in a lake, its ring filed under an unrelated part.
  const island = regroupRings([[box(20, 20, 21, 21), box(5, 5, 6, 6)],
    [box(0, 0, 10, 10), box(2, 2, 8, 8)]]);
  ok("an island in a lake in a polygon is an outer again",
    island.length === 3 && island.filter((p) => p.length === 2).length === 1
    && island.some((p) => p.length === 1 && p[0][0][0] === 5));

  /** Fill vertices the renderer actually built, which is what is drawn. */
  const fillVerts = (geometry) => {
    const built = renderFeatureCollection({ type: "FeatureCollection", features: [
      { type: "Feature", properties: { name: "x" }, geometry },
    ] }, { colourFor: () => "#8fd3f4" });
    let n = 0;
    (built.object3D || built).traverse((child) => {
      if (child.isMesh && !child.userData?.geoidSeam) n += child.geometry.attributes.position.count;
    });
    return n;
  };
  const asMulti = fillVerts({ type: "MultiPolygon", coordinates: [[A], [B]] });
  const asHole = fillVerts({ type: "Polygon", coordinates: [A, B] });
  const firstOnly = fillVerts({ type: "Polygon", coordinates: [A] });
  ok("the misfiled part is FILLED, not dropped", asHole === asMulti && asHole > firstOnly,
    `${asHole} against ${asMulti} (one part alone ${firstOnly})`);
}
