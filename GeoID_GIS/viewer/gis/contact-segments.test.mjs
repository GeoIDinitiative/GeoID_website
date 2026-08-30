/**
 * A CONTACT SEPARATES TWO DIFFERENT UNITS.
 *
 * Every polygon inks its own rings, so where two abut, the shared edge is
 * drawn twice — and when both are the same unit, or two units the map paints
 * alike, that ink lands in the middle of what a reader sees as one area.
 * Measured on a 45 km clip of Macrostrat: of 1,801 distinct segments, 717
 * divided different colours and 265 divided identical ones. The 265 are the
 * "outlines that don't exist in reality": the only lines crossing a flat field
 * of colour.
 *
 * The pairing rule is what is tested here, on the same arithmetic the renderer
 * uses, because the renderer itself needs a WebGL context to run.
 */
let pass = 0;
let fail = 0;
const ok = (name, cond) => {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.log(`FAIL ${name}`); }
};

const SEG_ROUND = 1e6;
const segKey = (a, b) => {
  const ka = `${Math.round(a[0] * SEG_ROUND)},${Math.round(a[1] * SEG_ROUND)}`;
  const kb = `${Math.round(b[0] * SEG_ROUND)},${Math.round(b[1] * SEG_ROUND)}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
};

/** The renderer's pre-pass, verbatim in behaviour. */
const suppressed = (features, colourOf) => {
  const seen = new Map();
  const same = new Set();
  features.forEach((f) => {
    const css = colourOf(f);
    (f.rings || []).forEach((ring) => {
      for (let i = 0; i + 1 < ring.length; i += 1) {
        const key = segKey(ring[i], ring[i + 1]);
        const had = seen.get(key);
        if (had === undefined) seen.set(key, css);
        else if (had === css) same.add(key);
        else same.delete(key);
      }
    });
  });
  return same;
};

const colourOf = (f) => f.colour;
// Two squares meeting along x = 1.
const left = (colour) => ({ colour, rings: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] });
const right = (colour) => ({ colour, rings: [[[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]]] });
const shared = segKey([1, 0], [1, 1]);

{
  const same = suppressed([left("#aaa"), right("#aaa")], colourOf);
  ok("a shared edge between two polygons painted alike is suppressed", same.has(shared));
  ok("and nothing else is", same.size === 1);
}
{
  const same = suppressed([left("#aaa"), right("#bbb")], colourOf);
  ok("a shared edge between different colours is a real contact", !same.has(shared));
  ok("so nothing is suppressed at all", same.size === 0);
}
{
  // The outer boundary of a lone polygon is drawn: nothing shares it.
  const same = suppressed([left("#aaa")], colourOf);
  ok("an edge no one else claims is never suppressed", same.size === 0);
}
{
  // Direction must not matter: rings wind opposite ways along a shared edge.
  const flipped = { colour: "#aaa", rings: [[[1, 1], [1, 0], [2, 0], [2, 1], [1, 1]]] };
  const same = suppressed([left("#aaa"), flipped], colourOf);
  ok("winding direction does not hide a shared edge", same.has(shared));
}
{
  // Three-way: same, then different, must end up DRAWN — a real contact wins.
  const same = suppressed([left("#aaa"), right("#aaa"), { colour: "#ccc", rings: [[[1, 0], [1, 1]]] }], colourOf);
  ok("a third polygon of another colour restores the contact", !same.has(shared));
}
{
  const near = { colour: "#aaa", rings: [[[1.0000001, 0], [1.0000001, 1]]] };
  const same = suppressed([left("#aaa"), near], colourOf);
  ok("coincident to within the projection's own rounding still pairs", same.has(shared));
}

console.log(`${pass} passed`);
if (fail) console.log(`${fail} FAILED`);
process.exit(fail ? 1 : 0);
