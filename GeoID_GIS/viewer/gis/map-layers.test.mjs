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
  layerNameOf(layerById("stress-shmax")), "SHmax orientation (World Stress Map)");

// An overlay at full opacity is a replacement, not an overlay: the point of
// the tab is stacking them.
check("every overlay arrives partly transparent",
  MAP_LAYERS.filter((e) => e.opacity > 0 && e.opacity <= 0.9).length, MAP_LAYERS.length);

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
 * The contract with `bake-stress.py`: hue = azimuth / 180, full saturation,
 * value 0.98. If that file's ramp changes, this must change with it — the
 * check below is the one that would notice, because it recomputes the same
 * HSV independently rather than trusting the function under test.
 */
function hsvReference(azimuth) {
  const h = ((azimuth % 180) + 180) % 180 / 180;
  const v = 0.98;
  const i = Math.floor(h * 6) % 6;
  const f = h * 6 - Math.floor(h * 6);
  const p = 0;
  const q = v * (1 - f);
  const t = v * f;
  const table = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]];
  return table[i].map((c) => Math.round(c * 255));
}
check("the ramp is hue = azimuth / 180 at full saturation",
  [0, 30, 60, 90, 120, 150, 175].every((d) => {
    const got = rgb(azimuthColour(d));
    const want = hsvReference(d);
    return got.every((v, i) => Math.abs(v - want[i]) <= 1);
  }), true);

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
