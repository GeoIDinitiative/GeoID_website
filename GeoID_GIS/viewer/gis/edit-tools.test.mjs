/**
 * The editing core, against geometry whose answers were planted.
 *
 * Every expected value here is either constructed (a square whose corners were
 * chosen, so what a delete must leave behind is arithmetic) or derived on paper
 * (0.1° of pick tolerance at 111.32 km altitude, because a tenth of that
 * altitude is a tenth of a degree by the definition of the constant). None is
 * a recollection of what the code did when it was run.
 *
 * The UI half is not exercised: it needs a document, a globe and the import
 * manager, and the parts of it that can be wrong silently — closure, address
 * arithmetic, the snapshot cap, the antimeridian — are all down here.
 *
 * Run: node GeoID_GIS/viewer/gis/edit-tools.test.mjs
 */

import {
  makeEditSession, ops, snapTo, nearestVertex, degreeDistance,
  buildGeometry, pendingGeometry, pickToleranceDeg, signedLon,
  MAX_SNAPSHOTS, DEFAULT_PICK_TOLERANCE_DEG,
} from "./edit-tools.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const near = (name, got, want, tol) =>
  check(name, Math.abs(got - want) <= tol, `got ${got}, want ${want} ±${tol}`);
const json = (v) => JSON.stringify(v);

/* ── fixtures ──────────────────────────────────────────────────────────────
   A three-vertex line along the equator, a unit square with its closing
   vertex written out, and a single point. Nothing here is near a pole or the
   antimeridian, so any wrap that shows up is the code's, not the data's. */

const lineFeature = () => ({
  type: "Feature",
  properties: { name: "line" },
  geometry: { type: "LineString", coordinates: [[0, 0], [1, 0], [2, 0]] },
});
const squareFeature = () => ({
  type: "Feature",
  properties: { name: "square" },
  geometry: {
    type: "Polygon",
    coordinates: [[[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]]],
  },
});
const pointFeature = () => ({
  type: "Feature",
  properties: { name: "point" },
  geometry: { type: "Point", coordinates: [-5, -5] },
});
const fixture = () => ({
  type: "FeatureCollection",
  features: [lineFeature(), squareFeature(), pointFeature()],
});

const ringOf = (session, featureIndex = 1) =>
  session.collection().features[featureIndex].geometry.coordinates[0];
const lineOf = (session, featureIndex = 0) =>
  session.collection().features[featureIndex].geometry.coordinates;
const closed = (ring) => ring.length > 3
  && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];

/* ── the session copies, and keeps copying ───────────────────────────────── */

{
  const source = fixture();
  const session = makeEditSession(source);
  source.features[0].geometry.coordinates[0][0] = 999;
  check("the session copies its input — the source can be mutated afterwards",
    lineOf(session)[0][0] === 0, `got ${lineOf(session)[0][0]}`);

  const handed = session.collection();
  handed.features.length = 0;
  check("collection() hands out a copy, so a caller cannot empty the session",
    session.collection().features.length === 3);

  check("a fresh session has nothing to undo", session.canUndo() === false);
  check("and nothing to redo", session.canRedo() === false);
  check("count() reports the features", session.count() === 3);
  check("depth() starts at zero on both stacks",
    json(session.depth()) === json({ undo: 0, redo: 0 }));
}
{
  check("an array of features is accepted as a collection",
    makeEditSession([lineFeature()]).count() === 1);
  check("nothing at all is an empty collection", makeEditSession(null).count() === 0);
  check("and an empty collection is still a FeatureCollection",
    makeEditSession(null).collection().type === "FeatureCollection");
}

/* ── addFeature / deleteFeature ──────────────────────────────────────────── */

{
  const session = makeEditSession(fixture());
  const result = session.apply(ops.addFeature(
    { type: "Point", coordinates: [3, 4] }, { name: "new" },
  ));
  check("addFeature succeeds", result.ok === true, result.message);
  check("and reports where it landed", result.featureIndex === 3);
  check("the feature is there", session.count() === 4);
  const added = session.collection().features[3];
  check("with its geometry", json(added.geometry.coordinates) === json([3, 4]));
  check("and its properties", added.properties.name === "new");
  check("undo is now available", session.canUndo() === true);

  session.undo();
  check("undo removes it", session.count() === 3);
  check("and redo becomes available", session.canRedo() === true);
  session.redo();
  check("redo puts it back", session.count() === 4);

  session.undo();
  session.apply(ops.deleteFeature(0));
  check("a new edit clears the redo stack", session.canRedo() === false);
  check("deleteFeature removes exactly one", session.count() === 2);
  check("and it removes the one asked for",
    session.collection().features[0].properties.name === "square");
}
{
  const session = makeEditSession(fixture());
  check("addFeature refuses a geometry with no type",
    session.apply(ops.addFeature({ coordinates: [1, 2] })).ok === false);
  check("addFeature refuses a two-vertex ring",
    session.apply(ops.addFeature({ type: "Polygon", coordinates: [[[0, 0], [1, 1]]] })).ok === false);
  check("deleteFeature refuses an index past the end",
    session.apply(ops.deleteFeature(3)).ok === false);
  check("deleteFeature refuses a negative index",
    session.apply(ops.deleteFeature(-1)).ok === false);
  check("a refused op leaves the undo stack alone", session.canUndo() === false);
  check("and leaves the collection alone", json(session.collection()) === json(fixture()));
  check("an unknown op type is refused, not thrown",
    session.apply({ type: "explode" }).ok === false);
  check("and so is no op at all", session.apply(null).ok === false);
}

/* ── moveVertex ──────────────────────────────────────────────────────────── */

{
  const session = makeEditSession(fixture());
  check("moveVertex succeeds on a line",
    session.apply(ops.moveVertex(0, 0, 1, [1.5, 0.5])).ok === true);
  check("the vertex moved", json(lineOf(session)[1]) === json([1.5, 0.5]));
  check("its neighbours did not",
    json(lineOf(session)[0]) === json([0, 0]) && json(lineOf(session)[2]) === json([2, 0]));
}
{
  const session = makeEditSession(fixture());
  session.apply(ops.moveVertex(1, 0, 0, [9, 9]));
  const ring = ringOf(session);
  check("moving a ring's first vertex moves its closing vertex too",
    json(ring[4]) === json([9, 9]), json(ring));
  check("and the ring is still closed", closed(ring));
  check("the other corners are untouched", json(ring[2]) === json([11, 11]));
}
{
  const session = makeEditSession(fixture());
  session.apply(ops.moveVertex(1, 0, 4, [8, 8]));
  const ring = ringOf(session);
  check("moving the closing vertex moves the first one too", json(ring[0]) === json([8, 8]));
  check("and that ring is still closed too", closed(ring));
}
{
  const session = makeEditSession(fixture());
  check("a Point takes a move at (0, 0)", session.apply(ops.moveVertex(2, 0, 0, [7, 7])).ok === true);
  check("and the point is there",
    json(session.collection().features[2].geometry.coordinates) === json([7, 7]));
  check("a Point refuses any other address", session.apply(ops.moveVertex(2, 0, 1, [1, 1])).ok === false);
}
{
  const session = makeEditSession(fixture());
  check("moveVertex refuses a vertex index past the end",
    session.apply(ops.moveVertex(0, 0, 3, [1, 1])).ok === false);
  check("moveVertex refuses a ring index past the end",
    session.apply(ops.moveVertex(1, 2, 0, [1, 1])).ok === false);
  check("moveVertex refuses a feature index past the end",
    session.apply(ops.moveVertex(9, 0, 0, [1, 1])).ok === false);
  check("moveVertex refuses a non-finite position",
    session.apply(ops.moveVertex(0, 0, 0, [Number.NaN, 0])).ok === false);
  check("moveVertex refuses a position that is not a pair",
    session.apply(ops.moveVertex(0, 0, 0, [1])).ok === false);
  check("none of those refusals recorded a snapshot", session.canUndo() === false);
}

/* ── insertVertex ────────────────────────────────────────────────────────── */

{
  const session = makeEditSession(fixture());
  const result = session.apply(ops.insertVertex(0, 0, 0, [0.5, 0]));
  check("insertVertex succeeds", result.ok === true, result.message);
  check("and says where it went", result.vertexIndex === 1);
  check("the vertex sits after the one named",
    json(lineOf(session)) === json([[0, 0], [0.5, 0], [1, 0], [2, 0]]));
}
{
  const session = makeEditSession(fixture());
  session.apply(ops.insertVertex(1, 0, 4, [10.5, 9.5]));
  const ring = ringOf(session);
  check("inserting after a ring's closing vertex inserts on the last edge",
    json(ring[4]) === json([10.5, 9.5]), json(ring));
  check("so the ring stays closed", closed(ring));
  check("and grew by one", ring.length === 6);
}
{
  const session = makeEditSession(fixture());
  check("insertVertex refuses an afterIndex past the end",
    session.apply(ops.insertVertex(0, 0, 3, [1, 1])).ok === false);
  check("insertVertex refuses a Point", session.apply(ops.insertVertex(2, 0, 0, [1, 1])).ok === false);
  check("insertVertex refuses a non-finite position",
    session.apply(ops.insertVertex(0, 0, 0, [0, Number.POSITIVE_INFINITY])).ok === false);
}

/* ── deleteVertex ────────────────────────────────────────────────────────── */

{
  const session = makeEditSession(fixture());
  check("deleteVertex succeeds on a line with three vertices",
    session.apply(ops.deleteVertex(0, 0, 1)).ok === true);
  check("and removes exactly that vertex",
    json(lineOf(session)) === json([[0, 0], [2, 0]]));
  check("a two-vertex line refuses to lose another",
    session.apply(ops.deleteVertex(0, 0, 0)).ok === false);
}
{
  const session = makeEditSession(fixture());
  session.apply(ops.deleteVertex(1, 0, 2));
  const ring = ringOf(session);
  check("a five-position ring drops to four", ring.length === 4, json(ring));
  check("the deleted corner is gone", !ring.some((p) => p[0] === 11 && p[1] === 11));
  check("and it is still closed", closed(ring));
  check("a four-position ring refuses to lose another",
    session.apply(ops.deleteVertex(1, 0, 0)).ok === false);
}
{
  // Deleting the shared corner: the ring must re-close on what is now first,
  // so [A,B,C,D,A] minus A is [B,C,D,B] — four positions, three corners.
  const session = makeEditSession(fixture());
  session.apply(ops.deleteVertex(1, 0, 0));
  const ring = ringOf(session);
  check("deleting a ring's first vertex re-closes it on the new first",
    json(ring) === json([[11, 10], [11, 11], [10, 11], [11, 10]]), json(ring));
}
{
  const session = makeEditSession(fixture());
  session.apply(ops.deleteVertex(1, 0, 4));
  check("deleting the closing vertex does the same thing",
    json(ringOf(session)) === json([[11, 10], [11, 11], [10, 11], [11, 10]]));
}
{
  const session = makeEditSession(fixture());
  check("deleteVertex refuses a Point", session.apply(ops.deleteVertex(2, 0, 0)).ok === false);
  check("deleteVertex refuses a vertex index past the end",
    session.apply(ops.deleteVertex(0, 0, 5)).ok === false);
}

/* ── multi-part addressing ───────────────────────────────────────────────── */

{
  const multiLine = {
    type: "Feature",
    properties: {},
    geometry: {
      type: "MultiLineString",
      coordinates: [[[0, 0], [1, 1]], [[5, 5], [6, 6], [7, 7]]],
    },
  };
  const session = makeEditSession([multiLine]);
  session.apply(ops.moveVertex(0, 1, 0, [50, 50]));
  const parts = session.collection().features[0].geometry.coordinates;
  check("ringOrLineIndex 1 is the second line of a MultiLineString",
    json(parts[1][0]) === json([50, 50]), json(parts));
  check("and the first line is untouched", json(parts[0]) === json([[0, 0], [1, 1]]));
}
{
  const multiPolygon = {
    type: "Feature",
    properties: {},
    geometry: {
      type: "MultiPolygon",
      coordinates: [
        [[[0, 0], [1, 0], [1, 1], [0, 0]]],
        [[[20, 20], [21, 20], [21, 21], [20, 20]]],
      ],
    },
  };
  const session = makeEditSession([multiPolygon]);
  // Rings flatten across polygons in order, so index 1 is the SECOND polygon's
  // outer ring — one integer reaches every ring of every part.
  session.apply(ops.moveVertex(0, 1, 1, [99, 99]));
  const polys = session.collection().features[0].geometry.coordinates;
  check("a MultiPolygon's rings flatten across its polygons",
    json(polys[1][0][1]) === json([99, 99]), json(polys));
  check("the first polygon is untouched",
    json(polys[0][0]) === json([[0, 0], [1, 0], [1, 1], [0, 0]]));
}
{
  const withHole = {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
        [[2, 2], [4, 2], [4, 4], [2, 2]],
      ],
    },
  };
  const session = makeEditSession([withHole]);
  session.apply(ops.moveVertex(0, 1, 0, [3, 3]));
  const rings = session.collection().features[0].geometry.coordinates;
  check("ring 1 of a Polygon is its first hole", json(rings[1][0]) === json([3, 3]));
  check("and the hole re-closed on the moved corner", json(rings[1][3]) === json([3, 3]));
  check("the outer ring is untouched", json(rings[0][0]) === json([0, 0]));
}

/* ── undo/redo depth and the snapshot cap ────────────────────────────────── */

{
  const start = fixture();
  const session = makeEditSession(start);
  const before = json(session.collection());
  for (let i = 0; i < 5; i += 1) {
    session.apply(ops.addFeature({ type: "Point", coordinates: [i, i] }));
  }
  session.apply(ops.moveVertex(0, 0, 0, [0.25, 0.25]));
  session.apply(ops.deleteVertex(1, 0, 1));
  check("seven edits, seven snapshots", session.depth().undo === 7);
  for (let i = 0; i < 7; i += 1) session.undo();
  check("undoing all of them restores the collection exactly",
    json(session.collection()) === before);
  check("and there is nothing left to undo", session.canUndo() === false);
  check("while all seven can be redone", session.depth().redo === 7);
  for (let i = 0; i < 7; i += 1) session.redo();
  check("redoing all of them is a round trip", session.count() === 8);
}
{
  check("the documented cap is 50", MAX_SNAPSHOTS === 50);
  const session = makeEditSession([lineFeature()]);
  for (let i = 0; i < MAX_SNAPSHOTS + 1; i += 1) {
    session.apply(ops.addFeature({ type: "Point", coordinates: [i, 0] }));
  }
  check("the undo stack stops at the cap", session.depth().undo === MAX_SNAPSHOTS);
  check("all 51 edits still applied", session.count() === 52);
  for (let i = 0; i < MAX_SNAPSHOTS; i += 1) session.undo();
  check("50 undos exhaust it", session.canUndo() === false);
  // The oldest snapshot dropped was the state before edit 1, so the furthest
  // back reachable is the state AFTER edit 1: the line plus one point.
  check("and the furthest back reachable is the state after the first edit",
    session.count() === 2, `got ${session.count()}`);
}
{
  const session = makeEditSession([lineFeature()], { limit: 2 });
  session.apply(ops.addFeature({ type: "Point", coordinates: [1, 1] }));
  session.apply(ops.addFeature({ type: "Point", coordinates: [2, 2] }));
  session.apply(ops.addFeature({ type: "Point", coordinates: [3, 3] }));
  check("the cap is configurable", session.depth().undo === 2);
  session.undo(); session.undo();
  check("and holds exactly that many steps", session.canUndo() === false && session.count() === 2);
}
{
  const session = makeEditSession([lineFeature()]);
  session.apply(ops.addFeature({ type: "Point", coordinates: [1, 1] }));
  session.apply(ops.moveVertex(9, 0, 0, [0, 0]));   // refused
  session.undo();
  check("undo after a refused op undoes the last real edit", session.count() === 1);
  check("undo on an empty stack reports false, not an error", session.undo() === false);
  check("redo on an empty stack does too",
    makeEditSession([lineFeature()]).redo() === false);
}

/* ── degreeDistance and the antimeridian ─────────────────────────────────── */

{
  near("a degree east is a degree away", degreeDistance([0, 0], [1, 0]), 1, 1e-12);
  near("and a degree north is too", degreeDistance([0, 0], [0, 1]), 1, 1e-12);
  near("3-4-5 holds on the graticule", degreeDistance([0, 0], [3, 4]), 5, 1e-12);
  near("179.99 and −179.99 are 0.02 apart, not 359.98",
    degreeDistance([179.99, 0], [-179.99, 0]), 0.02, 1e-9);
  near("and it is symmetric", degreeDistance([-179.99, 0], [179.99, 0]), 0.02, 1e-9);
}

/* ── snapTo ──────────────────────────────────────────────────────────────── */

{
  const fc = fixture();
  const query = [1.001, 0.001];
  const snapped = snapTo(fc, query, 0.01);
  check("a click inside the tolerance snaps to the vertex",
    json(snapped) === json([1, 0]), json(snapped));
  check("and the snapped position is a copy, not the collection's own array",
    fc.features[0].geometry.coordinates[1] !== snapped);
  snapped[0] = 500;
  check("so mutating it cannot reach the collection",
    fc.features[0].geometry.coordinates[1][0] === 1);
}
{
  const fc = fixture();
  const query = [1.5, 0.5];
  check("a click outside the tolerance returns the INPUT array itself",
    snapTo(fc, query, 0.01) === query);
  const q2 = [1.0000001, 0];
  check("a tolerance of zero never snaps, however close the vertex",
    snapTo(fc, q2, 0) === q2);
  check("a negative tolerance never snaps either", snapTo(fc, q2, -1) === q2);
  check("a missing tolerance never snaps", snapTo(fc, q2) === q2);
  check("an empty collection has nothing to snap to", snapTo({ features: [] }, q2, 5) === q2);
  check("nor has no collection at all", snapTo(null, q2, 5) === q2);
}
{
  // Two candidates inside the tolerance: [1,0] at 0.10 and [2,0] at 0.90.
  const fc = { type: "FeatureCollection", features: [lineFeature()] };
  const snapped = snapTo(fc, [1.1, 0], 1);
  check("the NEAREST vertex wins when several are in range",
    json(snapped) === json([1, 0]), json(snapped));
}
{
  const fc = { type: "FeatureCollection", features: [{
    type: "Feature", properties: {},
    geometry: { type: "Point", coordinates: [179.99, 0] },
  }] };
  const snapped = snapTo(fc, [-179.99, 0], 0.05);
  check("snapping crosses the antimeridian", json(snapped) === json([179.99, 0]), json(snapped));
}
{
  const fc = fixture();
  check("a non-position is handed straight back", snapTo(fc, "nowhere", 1) === "nowhere");
}

/* ── nearestVertex ───────────────────────────────────────────────────────── */

{
  const fc = fixture();
  const hit = nearestVertex(fc, [-5.1, -5.1]);
  check("nearestVertex crosses features to find the closest",
    hit.featureIndex === 2 && hit.ringOrLineIndex === 0 && hit.vertexIndex === 0,
    json(hit));
  near("and reports how far it was", hit.distanceDeg, Math.hypot(0.1, 0.1), 1e-9);
}
{
  const fc = fixture();
  // The square's shared corner is written twice; a click on it must address the
  // FIRST one, or moving it tears the ring open.
  const hit = nearestVertex(fc, [10.01, 10.01]);
  check("a ring's closing vertex is never the one offered",
    hit.featureIndex === 1 && hit.vertexIndex === 0, json(hit));
}
{
  check("nearestVertex over an empty collection is null",
    nearestVertex({ features: [] }, [0, 0]) === null);
  check("and a bad query position is null too", nearestVertex(fixture(), [0]) === null);
  const hit = nearestVertex(fixture(), [10.9, 11.1]);
  check("an interior ring vertex is addressable", hit.vertexIndex === 2, json(hit));
}
{
  // The address a click resolves to must be the one the op takes: pick, move,
  // and the picked corner is where it was put.
  const session = makeEditSession(fixture());
  const hit = nearestVertex(session.collection(), [2.05, 0.05]);
  const result = session.apply(
    ops.moveVertex(hit.featureIndex, hit.ringOrLineIndex, hit.vertexIndex, [2.5, 0.5]),
  );
  check("a nearestVertex address feeds moveVertex directly", result.ok === true);
  check("and the picked vertex is the one that moved",
    json(lineOf(session)[2]) === json([2.5, 0.5]));
}

/* ── buildGeometry / pendingGeometry ─────────────────────────────────────── */

{
  check("one position is a Point",
    json(buildGeometry("point", [[1, 2]])) === json({ type: "Point", coordinates: [1, 2] }));
  check("no position is no point", buildGeometry("point", []) === null);
  check("two positions are a LineString",
    buildGeometry("line", [[0, 0], [1, 1]]).type === "LineString");
  check("one position is not a line", buildGeometry("line", [[0, 0]]) === null);
  const polygon = buildGeometry("polygon", [[0, 0], [1, 0], [1, 1]]);
  check("three positions are a Polygon", polygon.type === "Polygon");
  check("whose ring the builder closes", closed(polygon.coordinates[0]));
  check("adding exactly one position", polygon.coordinates[0].length === 4);
  const already = buildGeometry("polygon", [[0, 0], [1, 0], [1, 1], [0, 0]]);
  check("an already-closed run is not closed twice", already.coordinates[0].length === 4);
  check("two positions are not a polygon", buildGeometry("polygon", [[0, 0], [1, 0]]) === null);
  check("an unknown mode builds nothing", buildGeometry("blob", [[0, 0], [1, 1]]) === null);
  check("non-positions are filtered out",
    buildGeometry("line", [[0, 0], ["x", "y"], [1, 1]]).coordinates.length === 2);
}
{
  check("one pending vertex previews as a point",
    pendingGeometry("polygon", [[0, 0]]).type === "Point");
  check("two pending vertices preview as a line, even in polygon mode",
    pendingGeometry("polygon", [[0, 0], [1, 1]]).type === "LineString");
  check("three close into a polygon preview",
    pendingGeometry("polygon", [[0, 0], [1, 0], [1, 1]]).type === "Polygon");
  check("three in line mode stay a line",
    pendingGeometry("line", [[0, 0], [1, 0], [1, 1]]).type === "LineString");
  check("nothing pending previews nothing", pendingGeometry("line", []) === null);
}

/* ── pickToleranceDeg ────────────────────────────────────────────────────── */

{
  // A tenth of the altitude in km over 111.32 km/degree: at exactly 111.32 km
  // up that is 0.1° by construction of the constant.
  near("a tenth of a degree at 111.32 km up", pickToleranceDeg(111320), 0.1, 1e-12);
  near("and a hundredth at 11.132 km", pickToleranceDeg(11132), 0.01, 1e-12);
  check("higher is looser", pickToleranceDeg(200000) > pickToleranceDeg(100000));
  check("clamped at 5 degrees however high", pickToleranceDeg(1e12) === 5);
  check("and at 0.0002 however low", pickToleranceDeg(1) === 0.0002);
  check("a viewer that cannot say gets the default",
    pickToleranceDeg(undefined) === DEFAULT_PICK_TOLERANCE_DEG);
  check("as does a nonsense altitude", pickToleranceDeg(Number.NaN) === DEFAULT_PICK_TOLERANCE_DEG);
  check("and a zero one", pickToleranceDeg(0) === DEFAULT_PICK_TOLERANCE_DEG);
}

/* ── signedLon ───────────────────────────────────────────────────────────── */

{
  near("315 east is 45 west", signedLon(315), -45, 1e-12);
  near("45 east is 45 east", signedLon(45), 45, 1e-12);
  near("0 stays 0", signedLon(0), 0, 1e-12);
  near("360 is 0", signedLon(360), 0, 1e-12);
  near("180 lands on −180, the same meridian", signedLon(180), -180, 1e-12);
  near("an already-signed value survives", signedLon(-45), -45, 1e-12);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
