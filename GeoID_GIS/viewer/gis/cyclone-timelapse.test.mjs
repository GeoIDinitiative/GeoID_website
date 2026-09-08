/**
 * PLAYING THE ARCHIVE A SEASON AT A TIME.
 *
 * The tracks layer holds 13,513 storms at once, which is the whole record and
 * therefore a web. Played by season it is a year of storms, then the next.
 *
 * The two pure halves are here; the rest of the driver is scene graph and is
 * checked on the source, because the shape of what it hands the player is what
 * the player's own contract turns on.
 *
 * Run: node GeoID_GIS/viewer/gis/cyclone-timelapse.test.mjs
 */

import { readFileSync } from "node:fs";

let pass = 0;
const failures = [];
const check = (name, fn) => {
  try { fn(); pass += 1; console.log(`PASS ${name}`); }
  catch (e) { failures.push(`${name}: ${e.message}`); console.log(`FAIL ${name}: ${e.message}`); }
};
const ok = (c, what) => { if (!c) throw new Error(what); };
const eq = (a, b, what) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: ${JSON.stringify(a)}`);
};

/* The module guards its DOM wiring, so it imports without one. */
const tl = await import("./cyclone-timelapse.js");

const storm = (season, name = "") => ({ properties: { season, name } });

/* ── which seasons become frames ─────────────────────────────────────────── */

check("storms are grouped by their own season", () => {
  const got = tl.seasonsIn([storm(1990), storm(1991), storm(1990)], 1900);
  eq(got.map(([y, l]) => [y, l.length]), [[1990, 2], [1991, 1]], "grouped");
});

check("and the seasons come out in order", () => {
  const got = tl.seasonsIn([storm(2001), storm(1975), storm(1990)], 1900);
  eq(got.map(([y]) => y), [1975, 1990, 2001], "ascending");
});

check("anything before the chosen span is left out", () => {
  const got = tl.seasonsIn([storm(1950), storm(1980), storm(2000)], 1980);
  eq(got.map(([y]) => y), [1980, 2000], "from 1980");
});

/**
 * A RANGE COUNTED OFF FROM A START YEAR would make a frame for every year
 * whether the archive has one or not, and a frame that draws nothing reads as
 * the player having broken rather than as a quiet year.
 */
check("a season with nothing in it is not a frame", () => {
  const got = tl.seasonsIn([storm(1980), storm(1985)], 1980);
  eq(got.map(([y]) => y), [1980, 1985], "no empty years between");
});

check("a storm with no season is dropped rather than defaulted", () => {
  const got = tl.seasonsIn([storm(1990), { properties: {} }, { properties: { season: null } }], 1900);
  eq(got.map(([y, l]) => [y, l.length]), [[1990, 1]], "only the real one");
});

/* ── what the bar says, which is where the honesty lives ─────────────────── */

/**
 * IBTrACS is a best-track archive, not a census: before the satellites a storm
 * was recorded where ships and coasts were, so the count rises through the
 * twentieth century for reasons that are mostly OBSERVATIONAL. Played from
 * 1842 that reads as a world getting steadily stormier, which this data cannot
 * say — measured on the archive, 1842 has ONE storm in it and 2021 has 111.
 */
check("a pre-satellite season says what it is", () => {
  const note = tl.noteFor({ year: 1900, count: 3, named: 0 });
  ok(/pre-satellite/.test(note), note);
  ok(/ships and coasts/.test(note), note);
});

check("and a modern one does not", () => {
  const note = tl.noteFor({ year: 2005, count: 120, named: 94 });
  ok(!/pre-satellite/.test(note), note);
  ok(/120 storm/.test(note) && /94 named/.test(note), note);
});

check("the boundary is the first weather satellites, not a round number", () => {
  ok(tl.SATELLITE_ERA === 1966, String(tl.SATELLITE_ERA));
  ok(!/pre-satellite/.test(tl.noteFor({ year: tl.SATELLITE_ERA, count: 1, named: 0 })), "on it");
  ok(/pre-satellite/.test(tl.noteFor({ year: tl.SATELLITE_ERA - 1, count: 1, named: 0 })), "under it");
});

/* The default span is the satellite era, so the sequence somebody gets without
   choosing anything is the one the record supports. */
check("and the default span is the modern record", () => {
  ok(tl.MODERN >= tl.SATELLITE_ERA, `${tl.MODERN} vs ${tl.SATELLITE_ERA}`);
});

check("a season with no named storms says only the count", () => {
  eq(tl.noteFor({ year: 2000, count: 4, named: 0 }), "4 storms", "no empty clause");
});

/* ── what it hands the one player ────────────────────────────────────────── */
{
  const src = readFileSync(new URL("./cyclone-timelapse.js", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  /* A THIRD DRIVER, not a third player: the bar, the slider, the play loop,
     the world-clock hold and the spin hold are all in `timelapse-player.js`. */
  check("it drives the shared player rather than building a bar", () => {
    ok(/startPlayer\(\{/.test(code), "starts the player");
    ok(!/document\.createElement\("style"\)/.test(code), "and injects no bar of its own");
  });
  check("with no imagery, because the subject is the lines",
    () => ok(/source: "none"/.test(code), "source none"));

  /**
   * ONE PALETTE ACROSS EVERY FRAME. Rebuilt per frame, the same 90-knot storm
   * is a different colour in a quiet year and a busy one, and the map becomes
   * about the frame rather than about the storms.
   */
  check("the colouring is built once, over the whole span", () => {
    ok(/const paint = colouring\(seasons\.flatMap/.test(code), "once");
    ok(/colourFor: paint\.colourFor/.test(code), "and reused by every frame");
  });
  check("on the same edges the layer and the live markers use",
    () => ok(/edges: SAFFIR_SIMPSON_KTS/.test(code), "Saffir-Simpson"));

  /* `featuresAt` walks `layer.features`, so a list left on the whole span
     answers a click with a storm from a season that is not on screen. */
  check("the feature list follows the frame", () => {
    ok(/onShow: \(index\) =>/.test(code), "on every step");
    ok(/const list = whole \? \[\] : seasons\[index\]\[1\];/.test(code),
      "pointed at the frame");
    ok(/now\.features = list;/.test(code), "and the layer told");
  });

  /* The whole-record layer would draw every storm behind the one season being
     shown — the web the animation exists to take apart. */
  check("the full layer stands down while a season is on screen", () => {
    ok(/setVisible\?\.\(layer, whole \? wasVisible : false\)/.test(code),
      "hidden on a season");
    ok(/setVisible\?\.\(back, wasVisible\)/.test(code), "and put back as it was");
  });

  /**
   * THE BAR OPENS BECAUSE THE LAYER WAS TICKED, so it has to park on a frame
   * that leaves the layer saying what its own name says. The last SEASON is
   * not that: 2026 alone is 75 storms of 13,513, so opening there would answer
   * a tick for "every storm on record" with 0.6% of it.
   */
  check("the sequence ends on a frame that IS the whole record", () => {
    ok(/all: true/.test(code), "a terminal All epoch");
    ok(/const ALL = epochs\.length - 1;/.test(code), "which is the last one");
    ok(/startAt: startAt === null \? ALL/.test(code), "and the bar opens there");
  });
  check("and on that frame the archive is shown, not a season", () => {
    ok(/const whole = index === ALL;/.test(code), "the All frame is known");
    ok(/if \(!whole\) nodeFor\(index\)\.visible = true;/.test(code),
      "no season node is raised on it");
  });

  /**
   * BUILT ON DEMAND. Building all 47 up front cost half a second and twice the
   * geometry, which is a bill nobody asked for when the bar opens on a tick
   * rather than on a press.
   */
  check("a season is built the first time it is shown, and kept", () => {
    ok(/if \(built\.has\(index\)\) return built\.get\(index\);/.test(code), "cached");
    ok(/built\.set\(index, node\);/.test(code), "and remembered");
  });
  check("and the frames are disposed rather than left on the GPU",
    () => ok(/geometry\?\.dispose\?\.\(\)/.test(code), "disposed"));
  check("with the derived layer removed on stop",
    () => ok(/removeLayer\?\.\(now\.id\)/.test(code), "removed"));

  /* Pressing play with nothing loaded must say so: a button that appears to do
     nothing invites a second press. */
  /**
   * ASKED, NOT MATCHED BY NAME. The entry has two variants and the hurricane
   * one is called "Hurricane tracks" -- a name pattern misses it, and a driver
   * that cannot find its layer says exactly what one that has none says, so
   * the bar simply did not reopen after the switch.
   */
  check("the driver asks the catalogue which layer its entry is loaded as", () => {
    ok(/layerForDataset\?\.\("cyclone-tracks"\)/.test(code), "by entry id");
  });

  // 3,700 hurricane RUNS over 2,929 storms: calling them storms overstates the
  // count by a quarter and misnames every one of them.
  check("the bar names what the frame actually holds", () => {
    ok(/3 runs/.test(tl.noteFor({ year: 2000, count: 3, noun: "run" })), "runs where runs");
    ok(/3 storms/.test(tl.noteFor({ year: 2000, count: 3 })), "storms by default");
    ok(/1 storm\b/.test(tl.noteFor({ year: 2000, count: 1 })), "and one is singular");
    // The driver picks the noun from the layer it is actually playing.
    ok(/hurricane tracks\/i\.test\(layer\.name/.test(code), "chosen from the layer");
  });

  check("pressing play without the layer explains itself",
    () => ok(/Tick the cyclone tracks on first/.test(src), "says so"));
}

if (failures.length) {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.error(`${failures.length} failed, ${pass} passed`);
  process.exit(1);
}
console.log(`${pass} passed`);
