/**
 * A clipped geology layer must behave like the map it was cut from.
 *
 * The refine box is the whole of the arithmetic here and it is easy to get
 * wrong in two opposite directions: the VIEW alone streams tiles for ground
 * the mask is about to throw away, and the MASK alone means flying into one
 * corner of a large study area asks for the whole thing at the corner's zoom.
 * It is the intersection, and a view that has left the study area must answer
 * null rather than an inside-out box.
 */
let pass = 0;
let fail = 0;
const ok = (name, cond) => {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.log(`FAIL ${name}`); }
};

const { __refineBox: refineBox, __boundsOfCollection: boundsOf } =
  await import("./clip-stream.js");

const mask = { west: -8, south: 54, east: -5, north: 56 };

{
  const box = refineBox({ west: -7, south: 54.5, east: -6, north: 55 }, mask);
  ok("a view inside the mask is the view",
    box.west === -7 && box.east === -6 && box.south === 54.5 && box.north === 55);
}
{
  const box = refineBox({ west: -20, south: 40, east: 10, north: 70 }, mask);
  ok("a view containing the mask is the mask",
    box.west === -8 && box.east === -5 && box.south === 54 && box.north === 56);
}
{
  const box = refineBox({ west: -9, south: 55, east: -6, north: 60 }, mask);
  ok("a straddling view is the intersection",
    box.west === -8 && box.east === -6 && box.south === 55 && box.north === 56);
}
{
  ok("a view that has left the mask answers null",
    refineBox({ west: 10, south: 54, east: 12, north: 56 }, mask) === null);
  ok("touching edge-on is not an overlap",
    refineBox({ west: -5, south: 54, east: -3, north: 56 }, mask) === null);
}
{
  // No view at all -- the first build, before the camera has been asked.
  ok("no view falls back to the whole study area", refineBox(null, mask) === mask);
}

{
  const fc = { type: "FeatureCollection", features: [
    { geometry: { type: "Polygon", coordinates: [[[-7, 54], [-6, 54], [-6, 55], [-7, 55], [-7, 54]]] } },
    { geometry: { type: "MultiPolygon", coordinates: [[[[-9, 53], [-8, 53], [-8, 53.5], [-9, 53.5], [-9, 53]]]] } },
  ] };
  const b = boundsOf(fc);
  ok("bounds span every part of every feature",
    b.west === -9 && b.south === 53 && b.east === -6 && b.north === 55);
  ok("an empty collection has no bounds", boundsOf({ features: [] }) === null);
}


/**
 * THE PINNED LEVEL IS THE CLIMB'S OWN, and the fill-in mesh carries coverage.
 *
 * An earlier version pinned the fullest-COVERING level and capped the refine
 * there. It did cover the ground — with zoom 8 polygons where the clip had been
 * drawing zoom 11, so a map of real boundaries became flat blocks with straight
 * edges. Detail and coverage do not have to be bought with each other: the
 * tiles draw the finest level, and the surveys that level lacks are drawn
 * beneath it from their own best level.
 *
 * So the rule under test is the SELECTION, not the level: whatever the pinned
 * tiles will not draw is what the mesh must draw.
 */
{
  const { __fillInSurveys: fill } = await import("./clip-stream.js");
  const key = (f) => String(f.src);
  const f = (src, id) => ({ src, id });

  // Measured on the north coast: the merged list held surveys 23 and 147 while
  // the drawn level carried only 23, and the northern third drew nothing.
  ok("a survey the pinned level lacks is filled in",
    fill([f(23, "a"), f(147, "b")], [f(23, "a")], key)
      .map((x) => x.id).join() === "b");
  ok("a survey the tiles already draw is NOT duplicated underneath",
    fill([f(23, "a"), f(23, "b")], [f(23, "a")], key).length === 0);
  ok("every missing survey is filled, not just the first",
    fill([f(1, "a"), f(2, "b"), f(3, "c")], [f(1, "a")], key).length === 2);
  ok("when the pinned level carries everything there is no mesh at all",
    fill([f(1, "a"), f(2, "b")], [f(1, "a"), f(2, "b")], key).length === 0);
  // A level that fetched nothing must not suppress the fill — that is the
  // failure where the clip drew a bare box.
  ok("an empty drawn set fills in everything",
    fill([f(1, "a"), f(2, "b")], [], key).length === 2);
  ok("an empty merged list asks for no mesh",
    fill([], [f(1, "a")], key).length === 0);
  ok("missing lists are survivable",
    fill(null, null, key).length === 0);

  /**
   * THE CASE THAT MEMBERSHIP GOT WRONG.
   *
   * Measured on the north coast: survey 147 is present at the pinned zoom 12
   * and covers only part of the study area there, because the deeper tiles for
   * the rest of its extent are empty. Membership called it drawn; the pixels
   * called it 404 unpainted sample points.
   */
  const bounds = { west: 0, east: 1, south: 0, north: 1 };
  // A stand-in for the real grid measure: each feature declares its reach.
  const cov = (list) => Math.max(0, ...(list || []).map((f) => f.reach || 0));
  const g = (src, reach, id) => ({ src, reach, id });

  ok("a survey drawn over only part of its ground is filled in",
    fill([g(147, 1.0, "full")], [g(147, 0.64, "part")], key, { bounds, coverage: cov })
      .map((x) => x.id).join() === "full");
  ok("a survey the tiles already cover is not drawn a second time",
    fill([g(23, 1.0, "a")], [g(23, 1.0, "a")], key, { bounds, coverage: cov }).length === 0);
  ok("a hair less reach is not worth a second copy under a semi-opaque layer",
    fill([g(23, 1.0, "a")], [g(23, 0.99, "a")], key, { bounds, coverage: cov }).length === 0);
  ok("a survey absent from the pinned level is still filled in when measuring",
    fill([g(154, 1.0, "a")], [g(23, 1.0, "b")], key, { bounds, coverage: cov }).length === 1);
}

console.log(`${pass} passed`);
if (fail) console.log(`${fail} FAILED`);
process.exit(fail ? 1 : 0);
