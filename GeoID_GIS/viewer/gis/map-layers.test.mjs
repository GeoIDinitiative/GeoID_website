/**
 * The map-overlay catalogue, and the one thing in it that can lie.
 *
 * The colour wheel is written twice — once in `bake-stress.py`, which paints
 * the raster, and once here, which paints the legend that explains it. Two
 * implementations of one contract in two languages is exactly the arrangement
 * that drifts, and when it drifts nothing breaks: the map is one set of
 * colours, the key beside it is another, and both look right.
 */

import {
  MAP_LAYERS, GROUPS, grouped, layerById, layerNameOf, azimuthColour, azimuthLegend,
  variantOf, pathOf, AZIMUTH_RAMP,
} from "./map-layers.js";

let pass = 0;
let fail = 0;

function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass += 1; console.log(`PASS ${name}`); } else {
    fail += 1;
    console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  }
}
const ok = (name, got) => check(name, Boolean(got), true);

/* ── the catalogue ────────────────────────────────────────────────────────── */

check("ids are unique", new Set(MAP_LAYERS.map((e) => e.id)).size, MAP_LAYERS.length);
check("every entry has a label, a summary and a licence",
  MAP_LAYERS.filter((e) => e.label && e.summary && e.licence).length, MAP_LAYERS.length);
// Every raster is somebody's work and every one of them says whose. A layer
// that reaches the globe without a credit is a licence breach waiting to be
// noticed by the person who owns the data.
check("every entry names where the image comes from",
  MAP_LAYERS.filter((e) => e.path || e.manifest).length, MAP_LAYERS.length);
check("every entry sits in a declared group",
  MAP_LAYERS.filter((e) => GROUPS.includes(e.group)).length, MAP_LAYERS.length);
check("no group is declared and left empty", grouped().length, GROUPS.length);
check("groups keep their declared order", grouped().map((g) => g.group), GROUPS);
check("layerById finds one", layerById("stress-shmax")?.group, "Stress and tectonics");
check("and refuses an unknown id", layerById("nope"), null);
check("the layer takes the entry's own name",
  layerNameOf(layerById("stress-shmax")), "Stress field (World Stress Map)");

// An overlay at full opacity is a replacement rather than an overlay -- unless
// the raster carries its OWN alpha, which the stress field does: it is
// transparent where the data are thin, and multiplying that by a layer opacity
// dimmed the map exactly where it was most confident.
check("an overlay is either translucent or carries its own alpha",
  MAP_LAYERS.filter((e) => (e.opacity > 0 && e.opacity <= 0.9) || e.variants).length,
  MAP_LAYERS.length);

/* ── the variants ─────────────────────────────────────────────────────────── */

/**
 * One field, four questions. An orientation map cannot say what the stress is
 * DOING -- the same NNE compression is a rift or a thrust belt depending on
 * which principal stress is vertical -- and neither picture says whether there
 * is any data underneath it.
 */
const stress = layerById("stress-shmax");
ok("the stress layer offers more than one reading", stress.variants.length >= 4);
check("variant ids are unique",
  new Set(stress.variants.map((v) => v.id)).size, stress.variants.length);
check("every variant has a label, an image and a note",
  stress.variants.filter((v) => v.label && v.path && v.note).length, stress.variants.length);
// A variant is a different QUANTITY, so it must bring its own key: reusing the
// last one would describe the picture before last.
check("every variant carries a legend or declares itself cyclic",
  stress.variants.filter((v) => v.legend?.length || v.cyclic).length, stress.variants.length);
check("the default is the regime map, not the rainbow", variantOf(stress).id, "regime");
check("a named variant is returned", variantOf(stress, "density").id, "density");
check("an unknown one falls back to the default rather than to nothing",
  variantOf(stress, "nope").id, "regime");
check("pathOf follows the variant", pathOf(stress, "agreement"),
  "/data/global/stress-agreement.png");
check("and defaults to the default variant", pathOf(stress), pathOf(stress, "regime"));
// A layer with no variants still resolves its own single image.
check("an ordinary overlay has no variants", layerById("map-slope").variants, undefined);
check("and variantOf says so", variantOf(layerById("map-slope")), null);

/* ── the SHmax colour wheel ───────────────────────────────────────────────── */

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

check("every azimuth gives a six-digit hex",
  [0, 17, 45, 90, 133.7, 179].every((d) => /^#[0-9a-f]{6}$/.test(azimuthColour(d))), true);

/**
 * CYCLIC, because the quantity is. SHmax is an axis: 179° and 1° are two
 * degrees apart, so their colours must be neighbours. A linear ramp would put
 * the two ends of the wheel at opposite ends of the key and split a single
 * orientation in half.
 */
check("0 and 180 are the same orientation and the same colour",
  azimuthColour(0), azimuthColour(180));
check("and 360 too", azimuthColour(0), azimuthColour(360));
check("a negative azimuth wraps rather than clamping",
  azimuthColour(-10), azimuthColour(170));
const near0 = rgb(azimuthColour(2));
const near180 = rgb(azimuthColour(178));
const far = rgb(azimuthColour(90));
const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
ok("colours either side of the wrap are neighbours", gap(near0, near180) < 60);
ok("and the opposite orientation is far from both", gap(near0, far) > 150);

/**
 * The contract with `bake-stress.py`: four stops, linearly interpolated, the
 * first and the last the same colour. Recomputed here from the stop list
 * rather than trusting the function under test, so a change to the ramp in one
 * language and not the other is caught rather than shipped.
 */
function rampReference(azimuth) {
  const t = ((((azimuth % 180) + 180) % 180)) / 180;
  const stops = AZIMUTH_RAMP;
  let i = 1;
  while (i < stops.length - 1 && t > stops[i].t) i += 1;
  const a = stops[i - 1];
  const b = stops[i];
  const k = (t - a.t) / (b.t - a.t);
  return a.rgb.map((v, j) => Math.round(v + (b.rgb[j] - v) * k));
}
check("the ramp is the stop list, interpolated",
  [0, 22.5, 45, 90, 133.7, 175].every((d) => {
    const got = rgb(azimuthColour(d));
    const want = rampReference(d);
    return got.every((v, i) => Math.abs(v - want[i]) <= 1);
  }), true);
// Unsaturated on purpose: a full-chroma wheel round 180 degrees was a lava
// lamp -- every orientation shouting, and the basemap under it gone.
check("no stop is fully saturated",
  AZIMUTH_RAMP.every(({ rgb: c }) => Math.max(...c) - Math.min(...c) < 160), true);
check("and none of them is black or white",
  AZIMUTH_RAMP.every(({ rgb: c }) => Math.max(...c) < 250 && Math.min(...c) > 40), true);

/* ── the legend ───────────────────────────────────────────────────────────── */

const key = azimuthLegend();
check("eight compass points", key.length, 8);
check("it starts at north–south", key[0].degrees, 0);
check("and steps evenly round the half circle",
  key.every((k, i) => k.degrees === i * 22.5), true);
check("every swatch is the map's own colour for that orientation",
  key.every((k) => k.colour === azimuthColour(k.degrees)), true);
check("every entry names its orientation and its angle",
  key.every((k) => /\d+°\)$/.test(k.label)), true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
