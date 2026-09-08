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
  const epoch = { year: 1900, count: 3, named: 0, total: 13513 };
  // The CLAIM stays on the bar, which is 104px wide; the reason it rests on
  // goes to the title, because a sentence that gets cut is cut at the end.
  ok(/pre-satellite/.test(tl.noteFor(epoch)), tl.noteFor(epoch));
  ok(/ships and coasts/.test(tl.noteTitle(epoch)), tl.noteTitle(epoch));
});

check("and a modern one does not", () => {
  const epoch = { year: 2005, count: 120, named: 94, total: 13513 };
  ok(!/pre-satellite/.test(tl.noteFor(epoch)), tl.noteFor(epoch));
  ok(/120 \/ 13,513/.test(tl.noteFor(epoch)), tl.noteFor(epoch));
  ok(/94 named/.test(tl.noteTitle(epoch)), tl.noteTitle(epoch));
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
  eq(tl.noteFor({ year: 2000, count: 4, named: 0, total: 13513 }), "4 / 13,513",
    "no empty clause");
  ok(!/named/.test(tl.noteTitle({ year: 2000, count: 4, named: 0, total: 13513 })),
    "nor on the title");
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
    ok(/const paint = colouring\(plan\.groups\.flatMap/.test(code), "once");
    ok(/colourFor: paint\.colourFor/.test(code), "and reused by every frame");
  });
  check("on the same edges the layer and the live markers use",
    () => ok(/edges: SAFFIR_SIMPSON_KTS/.test(code), "Saffir-Simpson"));

  /* `featuresAt` walks `layer.features`, so a list left on the whole span
     answers a click with a storm from a season that is not on screen. */
  check("the feature list follows the frame", () => {
    ok(/onShow: \(index\) =>/.test(code), "on every step");
    ok(/const shown = whole \? \[\] : plan\.groups\.slice\(0, index \+ 1\)/.test(code),
      "pointed at the frame");
    ok(/now\.features = shown;/.test(code), "and the layer told");
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
    ok(/built\.forEach\(\(node\) => \{ node\.visible = false; \}\);/.test(code),
      "every plotted group stands down on it");
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

  /**
   * A COUNTER AGAINST THE TOTAL, because the note is 104px of a 130px
   * sentence: "13513 storms, 5733 named" reached the reader as "13513 storms,
   * 5733..." -- and the half that got cut was the half the other half needed.
   */
  check("a season frame counts itself against the archive", () => {
    eq(tl.noteFor({ year: 2000, count: 105, total: 13513 }), "105 / 13,513",
      "this frame of the whole");
    ok(tl.noteFor({ year: 2000, count: 105, total: 13513 }).length < 16, "and it is short");
  });
  // "13,513 / 13,513" says nothing a reader cannot see. The All frame is the
  // archive, so it names it.
  check("the All frame names the archive rather than dividing it by itself", () => {
    eq(tl.noteFor({ all: true, count: 13513, total: 13513 }), "13,513 storms");
    eq(tl.noteFor({ all: true, count: 3700, total: 3700, noun: "run" }), "3,700 runs");
  });
  // 3,700 hurricane RUNS over 2,929 storms: calling them storms overstates the
  // count by a quarter and misnames every one of them.
  check("the bar names what the frame actually holds", () => {
    ok(/runs/.test(tl.noteFor({ all: true, count: 3, total: 3, noun: "run" })), "runs where runs");
    ok(/storms/.test(tl.noteFor({ all: true, count: 3, total: 3 })), "storms by default");
    ok(/hurricane tracks\/i\.test\(layer\.name/.test(code), "chosen from the layer");
  });
  /**
   * THE SENTENCE TOO LONG FOR THE BAR GOES ON THE TOOLTIP rather than being
   * cut -- and what gets cut is always the end, which is where a qualification
   * lives. The pre-satellite claim stays visible in short form, because it is
   * a claim about the number beside it.
   */
  check("the long form is carried, not dropped", () => {
    const early = { year: 1900, count: 4, total: 13513 };
    ok(/pre-satellite/.test(tl.noteFor(early)), "the claim stays on the bar");
    ok(/ships\s+and\s+coasts/.test(tl.noteTitle(early)), "and the reason on the title");
    ok(/79 named/.test(tl.noteTitle({ year: 2000, count: 105, named: 79, total: 13513 })),
      "with what the bar had no room for");
  });
  check("and a count equal to the total is not stated as a fraction of itself",
    () => ok(!/of 13,513/.test(tl.noteTitle({ all: true, count: 13513, total: 13513 })),
      "no 13,513 of 13,513"));
  check("the player carries a driver's title through", () => {
    const player = readFileSync(new URL("./timelapse-player.js", import.meta.url), "utf8");
    ok(/state\.bar\.note\.title = state\.noteTitle\?\.\(epoch\)/.test(player), "set on show");
    ok(/flex: 0 0 auto/.test(player), "and the note is never squeezed");
  });
  /**
   * THE BAR IS CENTRED, so a note that resizes walks both its edges — measured
   * at 671.8 to 693.8 px while scrubbing, with the left edge sliding 427 to
   * 416 on every frame. The reservation is the fix and all three parts of it
   * are load-bearing: it is computed from the epochs the player holds (a
   * constant cannot serve drivers that write different kinds of sentence), it
   * is measured on a canvas (354 epochs written into the element in turn is
   * 354 forced reflows, during a build), and it only ever grows (a note that
   * arrives with a fetched scene cannot be predicted, so the bar has to settle
   * at its widest rather than breathe).
   */
  check("the bar reserves its widest note rather than resizing", () => {
    const player = readFileSync(new URL("./timelapse-player.js", import.meta.url), "utf8");
    ok(/reserveNote\(state\.bar\.note, epochs, noteFor\)/.test(player),
      "reserved from the sequence's own epochs");
    ok(/measureText/.test(player), "measured without laying the element out");
    ok(/note\.scrollWidth > note\.clientWidth/.test(player), "and it only grows");
    ok(!/min-width: max-content/.test(player),
      "the per-frame max-content width is gone");
  });

/* ── the record is PLOTTED, at three step sizes ──────────────────────────── */
{
  const storm = (start, season, kts) => ({
    properties: { start, season, peak_wind_kts: kts, name: "S" },
  });
  const set = [
    storm("1980-06-02", 1980, 70), storm("1980-06-20", 1980, 90),
    storm("1980-09-11", 1980, 45), storm("1981-01-04", 1981, 120),
    storm("1981-08-30", 1981, 60), storm("1979-05-01", 1979, 80),
  ];
  const by = (step) => tl.framesFor(set, { from: 1980, step });

  check("each storm is its own frame", () => {
    eq(by("storm").groups.length, 5, "five in the span, one out of it");
  });
  check("months group them", () => eq(by("month").groups.length, 4));
  check("and seasons group them further", () => eq(by("season").groups.length, 2));

  // SORTED BY THE DATE, never by the order the file holds: the bake sorts by
  // season and then storm id, so playing it unsorted steps through a season's
  // storms in an order that is nobody's -- least of all time's.
  check("frames run in time order", () => {
    const labels = by("storm").groups.map((g) => g.label);
    eq(labels.join(","), [...labels].sort().join(","), labels.join(","));
  });
  // A storm whose season is 1980 can begin in 1979 -- the southern season
  // spans the new year -- so the span filter is on the SEASON and the order is
  // on the date. Both, and they disagree by design.
  check("a storm is kept by its season and ordered by its date", () => {
    ok(!by("storm").groups.some((g) => g.label === "1979-05-01"), "1979 season out");
    ok(by("storm").groups.some((g) => g.label === "1981-01-04"), "1981 season in");
  });

  /* CUMULATIVE: frame N holds what ARRIVES in it, and the player shows every
     frame up to N -- so the archive draws itself in. */
  check("the frames plot rather than replace", () => {
    ok(/for \(let i = 0; i <= index; i \+= 1\) nodeFor\(i\)\.visible = true;/.test(code),
      "every group up to here");
    ok(/plan\.groups\.slice\(0, index \+ 1\)/.test(code), "and the feature list with it");
  });

  /* STRIDED, NEVER TRUNCATED, and the stride is REPORTED. 4,982 frames is a
     slider whose every pixel is nine storms; a sequence that quietly steps
     twelve at a time under a control saying "each storm" is the silent cap
     this tree keeps paying for. */
  check("a long record is strided, and the far end kept", () => {
    // DISTINCT dates, or they group and there is nothing to stride: 4,000
    // storms sharing 28 days is 28 frames, which is the fixture agreeing with
    // itself rather than exercising the cap.
    const many = Array.from({ length: 4000 }, (_, i) => {
      const year = 1990 + Math.floor(i / 140);
      const month = String((i % 12) + 1).padStart(2, "0");
      const day = String((i % 28) + 1).padStart(2, "0");
      return storm(`${year}-${month}-${day}-${i}`, year, 60);
    });
    const plan = tl.framesFor(many, { from: 1980, step: "storm" });
    ok(plan.groups.length <= tl.MAX_FRAMES, `${plan.groups.length} frames`);
    ok(plan.stride > 1, `stride ${plan.stride}`);
    eq(plan.total, many.length, "nothing dropped");
  });
  check("and the stride is said out loud",
    () => ok(/one frame per \$\{plan\.stride\}/.test(code), "reported"));

  /* Each step opens at its own pace: 4,982 storms at the 1.2s a 47-season
     sequence wants is a hundred minutes. */
  check("each step carries its own opening rate", () => {
    ok(tl.STEPS.storm.interval < tl.STEPS.month.interval, "storms faster than months");
    ok(tl.STEPS.month.interval < tl.STEPS.season.interval, "months faster than seasons");
    ok(/interval: plan\.spec\.interval/.test(code), "and the driver hands it over");
  });
  /* Ticks where the YEAR turns -- per frame on a 354-frame slider they are a
     solid bar, and the season step is one frame a year already. */
  check("the slider is ticked where the year turns", () => {
    ok(/tick: plan\.step === "season"/.test(code), "decades on the season step");
    ok(/String\(year\) !== prev/.test(code), "years on the finer ones");
  });
}

  check("pressing play without the layer explains itself",
    () => ok(/Tick the cyclone tracks on first/.test(src), "says so"));
}

if (failures.length) {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.error(`${failures.length} failed, ${pass} passed`);
  process.exit(1);
}
console.log(`${pass} passed`);
