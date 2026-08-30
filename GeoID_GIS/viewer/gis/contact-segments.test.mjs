/**
 * A CONTACT SEPARATES TWO DIFFERENT UNITS — and "different" means a different
 * UNIT, never merely a different colour.
 *
 * Every polygon inks its own rings, so where two abut the shared edge is drawn
 * twice, and where a unit was cut into pieces that doubled ink rules a line
 * through ground with no boundary in it.
 *
 * Keying this on COLOUR was a regression: this source paints many different
 * units alike, so it deleted boundaries that genuinely separate two formations
 * and the world map lost outline detail it had always drawn. The key is the
 * unit — map_id, else legend_id, else name.
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
const suppressed = (features, keyOf) => {
  const seen = new Map();
  const same = new Set();
  features.forEach((f) => {
    const css = keyOf(f);
    if (css === null || css === undefined) return;
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

const unitOf = (f) => f.unit;
// Two squares meeting along x = 1.
const left = (unit) => ({ unit, rings: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] });
const right = (unit) => ({ unit, rings: [[[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]]] });
const shared = segKey([1, 0], [1, 1]);

{
  const same = suppressed([left("A"), right("A")], unitOf);
  ok("two pieces of ONE unit do not get a boundary between them", same.has(shared));
  ok("and nothing else is suppressed", same.size === 1);
}
{
  const same = suppressed([left("A"), right("B")], unitOf);
  ok("two different units keep their contact", !same.has(shared));
  ok("so nothing is suppressed at all", same.size === 0);
}
{
  // THE REGRESSION: different units the map paints identically. Keying on
  // colour deleted this boundary and the world map lost outline detail.
  const painted = [{ unit: "A", colour: "#aaa", rings: left("A").rings },
                   { unit: "B", colour: "#aaa", rings: right("B").rings }];
  ok("a real contact survives even when both sides are painted alike",
    !suppressed(painted, unitOf).has(shared));
  ok("whereas keying on colour would have deleted it",
    suppressed(painted, (f) => f.colour).has(shared));
}
{
  const same = suppressed([left("A")], unitOf);
  ok("an edge no one else claims is never suppressed", same.size === 0);
}
{
  const flipped = { unit: "A", rings: [[[1, 1], [1, 0], [2, 0], [2, 1], [1, 1]]] };
  ok("winding direction does not hide a shared edge",
    suppressed([left("A"), flipped], unitOf).has(shared));
}
{
  const third = { unit: "C", rings: [[[1, 0], [1, 1]]] };
  ok("a third piece of another unit restores the contact",
    !suppressed([left("A"), right("A"), third], unitOf).has(shared));
}
{
  const near = { unit: "A", rings: [[[1.0000001, 0], [1.0000001, 1]]] };
  ok("coincident to within the projection's own rounding still pairs",
    suppressed([left("A"), near], unitOf).has(shared));
}
{
  ok("a feature with no identity is always drawn",
    suppressed([left("A"), { unit: null, rings: right("A").rings }], unitOf).size === 0);
}

console.log(`${pass} passed`);
if (fail) console.log(`${fail} FAILED`);
process.exit(fail ? 1 : 0);
