/**
 * A CLIPPED GEOLOGICAL MAP IS DRAWN LIKE THE ONE IT CAME FROM.
 *
 * `renderFeatureCollection` strokes every polygon's outline, and its default
 * mode is "match" — the polygon's own fill colour. For a catchment or a
 * coastline that is right. For geology it means the contacts are drawn in the
 * one colour that cannot be seen against what they bound: measured on a 47 km
 * clip, 4,286 line vertices in #FF9ACC on a #FF9ACC fill, beside a world layer
 * inking the same boundaries at #B86790. The lines were there the whole time.
 */
let pass = 0;
let fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.log(`FAIL ${name}${detail ? `  — ${detail}` : ""}`); }
};

globalThis.window = globalThis.window || {};
const { buildVectorLayerResult } = await import("./vector-render.js");

const square = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const fc = (features) => ({ type: "FeatureCollection", features });
const unit = (name, colour, ring) => ({ type: "Feature",
  properties: { name, color: colour, source_id: 23 },
  geometry: { type: "Polygon", coordinates: [ring] } });

const geology = () => fc([
  unit("Argyll Group", "#FF9BCD", square(0, 0, 1, 1)),
  unit("Tyrone Group", "#7FC64E", square(1, 0, 2, 1)),
]);

/** Every line vertex colour in a built layer, as hex. */
const strokeColours = (built) => {
  const out = new Set();
  built.object3D.traverse((n) => {
    // The seal is a ribbon of triangles, not a line, so it is found by its
    // flag; a plain line layer is still found by its type.
    if (!n.userData?.geoidSeam && !(n.isLineSegments || n.isLine)) return;
    const c = n.geometry?.attributes?.color;
    if (!c) return;
    for (let i = 0; i < c.count; i += 1) {
      out.add([c.getX(i), c.getY(i), c.getZ(i)]
        .map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join(""));
    }
  });
  return out;
};
const strokeCount = (built) => {
  let n = 0;
  built.object3D.traverse((x) => {
    if (x.userData?.geoidSeam || x.isLineSegments || x.isLine) {
      n += x.geometry?.attributes?.position?.count || 0;
    }
  });
  return n;
};

/* ── the default is unchanged ──────────────────────────────────────────── */
{
  const plain = buildVectorLayerResult(geology(), { name: "plain" });
  ok("a layer with no contact style still strokes its outlines", strokeCount(plain) > 0);
  ok("and reports no contact style", plain.getContacts() === null);
}

/* ── a style darkens the stroke ────────────────────────────────────────── */
{
  // The geology panel's own "subtle": the unit's colour multiplied by 0.62.
  const subtle = { mode: "shade", shade: 0.62, opacity: 0.55 };
  const inked = buildVectorLayerResult(geology(), { name: "inked", contacts: subtle });
  const plain = buildVectorLayerResult(geology(), { name: "plain" });

  ok("the style is carried on the layer", inked.getContacts() === subtle);
  ok("the same boundaries are drawn either way",
    strokeCount(inked) === strokeCount(plain),
    `${strokeCount(inked)} vs ${strokeCount(plain)}`);

  const before = strokeColours(plain);
  const after = strokeColours(inked);
  ok("an unstyled layer strokes in the fill's own colour — invisible",
    [...before].every((hex) => ["ff9bcd", "7fc64e"].includes(hex)),
    `got ${[...before].join(",")}`);
  ok("a shaded layer strokes in something darker",
    [...after].every((hex) => !["ff9bcd", "7fc64e"].includes(hex)),
    `got ${[...after].join(",")}`);

  // Darker, and still that unit's own colour — a contact belongs to the unit
  // it bounds, which is what keeps the map readable against its own legend.
  const lum = (hex) => parseInt(hex.slice(0, 2), 16) + parseInt(hex.slice(2, 4), 16)
    + parseInt(hex.slice(4, 6), 16);
  ok("every stroke is darker than every fill it could belong to",
    Math.max(...[...after].map(lum)) < Math.min(...[...before].map(lum)));
}

/* ── the one selector reaches it afterwards ────────────────────────────── */
{
  const built = buildVectorLayerResult(geology(), { name: "later" });
  // Nothing painted yet: the style is recorded, and the stroke follows the
  // first paint rather than needing a rebuild the caller cannot ask for.
  const style = { mode: "ink", colour: 0x140f1a, opacity: 0.8 };
  built.setContacts(style);
  ok("setContacts records the style", built.getContacts() === style);

  built.repaint((f) => f?.properties?.color || null);
  const after = strokeColours(built);
  // ONE colour for every contact, whatever unit it bounds — that is what
  // separates flat ink from a shade. The byte values are left to three.js,
  // which colour-manages a numeric hex and not a string one.
  ok("and a repaint after it strokes every contact in one flat ink",
    after.size === 1, `got ${[...after].join(",")}`);
  const lum = (hex) => parseInt(hex.slice(0, 2), 16) + parseInt(hex.slice(2, 4), 16)
    + parseInt(hex.slice(4, 6), 16);
  ok("and that ink is dark", lum([...after][0]) < 90, `got ${[...after][0]}`);

  // The reason this exists: a recolour must not quietly return the contacts
  // to invisible, the way it would if the style lived on the paint call.
  built.repaint(() => "#123456");
  ok("a second repaint keeps the contacts inked",
    strokeColours(built).size === 1 && [...strokeColours(built)][0] === [...after][0]);

  built.setContacts(null);
  built.repaint((f) => f?.properties?.color || null);
  // Compared against THIS build's own fills rather than against the source
  // hexes: a repaint puts colours through three.js and the first render does
  // not, so the two encode the same colour differently. What "match" means is
  // that the stroke equals the fill it bounds, whatever the encoding.
  const fills = new Set();
  built.object3D.traverse((n) => {
    if (!n.isMesh) return;
    const c = n.geometry?.attributes?.color;
    if (!c) return;
    for (let i = 0; i < c.count; i += 1) {
      fills.add([c.getX(i), c.getY(i), c.getZ(i)]
        .map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join(""));
    }
  });
  ok("and clearing the style goes back to the fill's own colour",
    [...strokeColours(built)].every((hex) => fills.has(hex)),
    `strokes ${[...strokeColours(built)].join(",")} vs fills ${[...fills].join(",")}`);
}

console.log(`${pass} passed`);
if (fail) console.log(`${fail} FAILED`);
process.exit(fail ? 1 : 0);
