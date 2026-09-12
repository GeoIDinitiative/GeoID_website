/**
 * THE CARD'S EQUATIONS ARE RUN, NOT READ.
 *
 * A comment drifts from its function silently: the function is edited, the
 * paragraph above it is not, and nothing fails. Published on a layer's ⓘ as
 * "how it is calculated", that stops being an untidy comment and becomes a
 * false statement about how a number a reader may act on was produced.
 *
 * So this test implements each printed expression LITERALLY -- transcribed
 * from `equations.js`, not from the source it documents -- and runs it against
 * the real function on a synthetic surface. If the two disagree anywhere on
 * the grid, the card is wrong and this fails.
 *
 * Run: node GeoID_GIS/viewer/gis/equations.test.mjs
 */

import { mathsFor, modelledIds, COMPUTED } from "./equations.js";
import { makeRaster, slope, hillshade } from "./raster-analysis.js?v=t";
import { decodeTerrarium } from "./dem-tiles.js?v=t";
import { factorOfSafety, WATER_UNIT_WEIGHT } from "./fos.js?v=t";
import { partition, cellVelocity, floodFos, bankfullCapacity, meanFlowFromWidth, waveStep, CHANNEL_V_COEF, CHANNEL_V_EXP, BANKFULL_RATIO } from "./flood-fos.js?v=t";
import { readFileSync } from "node:fs";

let passed = 0;
const failures = [];
const check = (name, fn) => {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (e) { failures.push(`${name}: ${e.message}`); console.log(`FAIL ${name}: ${e.message}`); }
};
const ok = (c, what) => { if (!c) throw new Error(what); };
const near = (a, b, tol, what) => {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${what}: ${a} vs ${b}`);
};
/**
 * The bands come back as Float32Array, so the app's own answer is rounded to
 * about seven digits before this ever sees it. Comparing at double precision
 * fails on storage rather than on arithmetic.
 */
const nearF32 = (a, b, what) => near(a, b, Math.max(1e-4, Math.abs(b) * 1e-6), what);

/* ── a surface with a bit of everything: a tilt, a bump and a hollow ─────── */

const W = 24, H = 18;
const BOUNDS = { minX: -8.4, maxX: -8.0, minY: 54.8, maxY: 55.1 };
const band = new Float32Array(W * H);
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    band[y * W + x] = 40 * x + 12 * y
      + 180 * Math.exp(-(((x - 9) ** 2 + (y - 7) ** 2) / 9))
      - 90 * Math.exp(-(((x - 17) ** 2 + (y - 12) ** 2) / 6));
  }
}
const dem = makeRaster(band, W, H, BOUNDS, null);

/* ── the card's own arithmetic, transcribed from what it prints ──────────── */

/** Δx = |(lon_max − lon_min)| · 111320 · cos(φ) / width, and Δy likewise. */
function cellFromCard(raster) {
  const phi = (raster.bounds.minY + raster.bounds.maxY) / 2;
  return {
    x: Math.abs((raster.bounds.maxX - raster.bounds.minX)
      * 111320 * Math.cos((phi * Math.PI) / 180)) / raster.width,
    y: Math.abs((raster.bounds.maxY - raster.bounds.minY) * 110574) / raster.height,
  };
}

/** ∂z/∂x = [(z₃ + 2z₆ + z₉) − (z₁ + 2z₄ + z₇)] / (8·Δx), and ∂z/∂y likewise. */
function hornFromCard(raster, x, y, cell) {
  const z = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const cx = x + dx, cy = y + dy;
      if (cx < 0 || cy < 0 || cx >= raster.width || cy >= raster.height) return null;
      z.push(raster.band[cy * raster.width + cx]);
    }
  }
  // The card numbers the window z1..z9 left to right, top to bottom.
  const [z1, z2, z3, z4, , z6, z7, z8, z9] = z;
  return {
    dzdx: ((z3 + 2 * z6 + z9) - (z1 + 2 * z4 + z7)) / (8 * cell.x),
    dzdy: ((z7 + 2 * z8 + z9) - (z1 + 2 * z2 + z3)) / (8 * cell.y),
  };
}

const everyInteriorCell = (fn) => {
  let compared = 0;
  for (let y = 1; y < H - 1; y += 1) {
    for (let x = 1; x < W - 1; x += 1) { fn(x, y); compared += 1; }
  }
  ok(compared > 300, `only ${compared} cells compared`);
};

/* ── slope ───────────────────────────────────────────────────────────────── */

check("the slope card reproduces the slope the app computes", () => {
  const got = slope(dem, { degrees: true });
  const cell = cellFromCard(dem);
  everyInteriorCell((x, y) => {
    const g = hornFromCard(dem, x, y, cell);
    // slope = arctan( sqrt( (dz/dx)^2 + (dz/dy)^2 ) ), in degrees
    const fromCard = Math.atan(Math.sqrt(g.dzdx * g.dzdx + g.dzdy * g.dzdy)) * (180 / Math.PI);
    nearF32(got.band[y * W + x], fromCard, `cell ${x},${y}`);
  });
});

check("and the percentage form it offers is the same gradient", () => {
  const got = slope(dem, { degrees: false });
  const cell = cellFromCard(dem);
  everyInteriorCell((x, y) => {
    const g = hornFromCard(dem, x, y, cell);
    nearF32(got.band[y * W + x],
      100 * Math.sqrt(g.dzdx * g.dzdx + g.dzdy * g.dzdy), `cell ${x},${y}`);
  });
});

/**
 * The claim the cell-size lines make is that a slope depends on the grid it is
 * read from -- which is why the card states them at all. Pinned as a fact:
 * the same ground, sampled coarser, is measurably gentler.
 */
check("the cell size is part of the answer, not bookkeeping", () => {
  const coarse = makeRaster(band, W, H,
    { ...BOUNDS, maxX: BOUNDS.minX + (BOUNDS.maxX - BOUNDS.minX) * 3,
      maxY: BOUNDS.minY + (BOUNDS.maxY - BOUNDS.minY) * 3 }, null);
  const fine = slope(dem, { degrees: true }).band[7 * W + 9];
  const wide = slope(coarse, { degrees: true }).band[7 * W + 9];
  ok(wide < fine / 2, `the same cell reads ${fine.toFixed(1)}° and ${wide.toFixed(1)}°`);
});

/* ── hillshade ───────────────────────────────────────────────────────────── */

check("the hillshade card reproduces the shading the app draws", () => {
  const azimuth = 315, altitude = 45;
  const got = hillshade(dem, { azimuth, altitude });
  const cell = cellFromCard(dem);
  const zenith = ((90 - altitude) * Math.PI) / 180;
  const azStar = ((360 - azimuth + 90) * Math.PI) / 180;
  everyInteriorCell((x, y) => {
    const g = hornFromCard(dem, x, y, cell);
    const slopeRad = Math.atan(Math.sqrt(g.dzdx * g.dzdx + g.dzdy * g.dzdy));
    let aspectRad = Math.atan2(g.dzdy, -g.dzdx);
    if (aspectRad < 0) aspectRad += 2 * Math.PI;
    const shade = 255 * (Math.cos(zenith) * Math.cos(slopeRad)
      + Math.sin(zenith) * Math.sin(slopeRad) * Math.cos(azStar - aspectRad));
    nearF32(got.band[y * W + x], Math.max(0, Math.min(255, shade)), `cell ${x},${y}`);
  });
});

check("the light the card names is the light the sheet uses by default", () => {
  const src = readFileSync(new URL("./dem-layer.js", import.meta.url), "utf8");
  ok(/readLight\("hillshade-azimuth", 315\)/.test(src), "315 degrees");
  ok(/readLight\("hillshade-altitude", 45\)/.test(src), "45 degrees");
  const card = mathsFor("dem-hillshade");
  ok(card.terms.some(([, t]) => /default 45/.test(t)), "the card says 45");
  ok(card.terms.some(([, t]) => /default 315/.test(t)), "the card says 315");
});

/* ── the elevation decode ────────────────────────────────────────────────── */

check("the decode on the card is the decode the tiles go through", () => {
  for (const [r, g, b] of [[128, 0, 0], [128, 100, 128], [130, 55, 200], [0, 0, 0]]) {
    // h = (R*256 + G + B/256) - 32768
    near(decodeTerrarium(r, g, b), (r * 256) + g + (b / 256) - 32768, 1e-12, `${r},${g},${b}`);
  }
  // The offset is what lets it carry the sea floor, which the card says.
  ok(decodeTerrarium(0, 0, 0) === -32768, "the zero pixel is the bottom of the range");
  ok(decodeTerrarium(128, 0, 0) === 0, "and mid-red is sea level");
});

/* ── factor of safety ────────────────────────────────────────────────────── */

check("the FoS card reproduces the model the app runs", () => {
  const cases = [
    { cohesion: 10, friction: 22, unitWeight: 18, depth: 2, slopeDeg: 24, wetFraction: 0.4 },
    { cohesion: 0, friction: 36, unitWeight: 20, depth: 1.5, slopeDeg: 33, wetFraction: 1 },
    { cohesion: 25, friction: 37, unitWeight: 23, depth: 1.2, slopeDeg: 8, wetFraction: 0 },
  ];
  for (const c of cases) {
    const beta = (c.slopeDeg * Math.PI) / 180;
    const phi = (c.friction * Math.PI) / 180;
    // FoS = [ c' + (y - m*yw)*z*cos^2(B)*tan(phi') ] / [ y*z*sin(B)*cos(B) ]
    const fromCard = (c.cohesion
      + (c.unitWeight - c.wetFraction * WATER_UNIT_WEIGHT) * c.depth * Math.cos(beta) ** 2 * Math.tan(phi))
      / (c.unitWeight * c.depth * Math.sin(beta) * Math.cos(beta));
    near(factorOfSafety(c), fromCard, 5e-5, `${c.slopeDeg}° at m=${c.wetFraction}`);
  }
});

check("the honesty rules the card states are the ones the code enforces", () => {
  // Flat ground: no answer rather than infinity.
  const gentle = { cohesion: 10, friction: 30, unitWeight: 18, depth: 2, wetFraction: 0.5 };
  ok(factorOfSafety({ ...gentle, slopeDeg: 0 }) === null, "flat ground returns null");
  // The threshold the card names, pinned to the code's own default.
  ok(factorOfSafety({ ...gentle, slopeDeg: 4.9 }) === null, "and so does 4.9 degrees");
  ok(Number.isFinite(factorOfSafety({ ...gentle, slopeDeg: 5.1 })), "5.1 degrees answers");
  ok(/below 5°/.test(mathsFor("geoid-fos").note), "the card states the threshold");
  // m capped at 1: more rain than saturation changes nothing.
  const saturated = { cohesion: 5, friction: 28, unitWeight: 18, depth: 2, slopeDeg: 26 };
  near(factorOfSafety({ ...saturated, wetFraction: 4 }),
    factorOfSafety({ ...saturated, wetFraction: 1 }), 1e-12, "m is capped");
  ok(/capped at 1/.test(mathsFor("geoid-fos").note), "and the card says both");
  ok(/no answer rather than infinity/.test(mathsFor("geoid-fos").note), "flat ground");
  ok(/capped at 1/.test(mathsFor("geoid-fos").note), "and saturation");
});

check("the channel card reproduces the flood model the app runs", () => {
  // e = (P/Dt - r) + r*W, and the balance the card claims: infiltrated + runoff = P.
  for (const K of [1e-6, 5e-6, 2e-5]) {
    for (const P of [0, 3e-7, 1e-6, 4e-6, 2e-5]) {
      for (const W of [0, 0.25, 0.7, 1]) {
        const p = partition({ rainMs: P, K, W });
        const r = Math.min(P, K);
        const fromCard = (P - r) + r * W;
        near(p.runoff, fromCard, 1e-12, `P=${P} K=${K} W=${W}`);
        near(p.infiltrated + p.runoff, P, 1e-12, "infiltrated + runoff = P");
      }
    }
  }
  // v_channel = 0.514 * Q^0.2, and it IS Q/(w*d) on the same hydraulic geometry.
  // A channel cell takes its own BANKFULL discharge, which is what the card says,
  // so that is the discharge both sides of the comparison are evaluated at.
  for (const Qb of [0.5, 12, 340, 9000]) {
    const w = 7.2 * Qb ** 0.5; const d = 0.27 * Qb ** 0.3;
    near(CHANNEL_V_COEF * Qb ** CHANNEL_V_EXP, Qb / (w * d), 1e-9, `v at Q=${Qb}`);
    near(cellVelocity({ slopeRad: 0.1, capacity: Qb }), Qb / (w * d), 1e-6, `cellVelocity at Q=${Qb}`);
  }
  near(CHANNEL_V_COEF, 1 / (7.2 * 0.27), 1e-12, "the coefficient is the geometry's");
  near(0.5 + 0.3 + CHANNEL_V_EXP, 1, 1e-12, "Leopold & Maddock's closure");
  // FoS = Q_bankfull / Q, with Q_bankfull = 5 * (w/7.2)^2.
  for (const w of [30, 120, 900]) {
    near(meanFlowFromWidth(w), (w / 7.2) ** 2, 1e-9, `mean flow from ${w} m`);
    const cap = bankfullCapacity(w);
    near(cap, BANKFULL_RATIO * (w / 7.2) ** 2, 1e-9, "bankfull is 5 x mean");
    near(floodFos(cap, cap / 3), 3, 1e-12, "capacity over arrival");
  }
});

check("the wave is the exact integral the card prints, at any step", () => {
  // One reservoir under a steady arrival: the card's S*a + u*k*(1 - a).
  const topo = { order: Int32Array.from([0]), offsets: Int32Array.from([0, 0]), recv: new Int32Array(0), frac: new Float32Array(0) };
  const u = 0.004; const k = Float32Array.from([900]);
  const run = (dt, steps) => {
    const store = new Float64Array(1); let released = 0;
    for (let i = 0; i < steps; i += 1) {
      const q = waveStep({ topo, store, source: Float64Array.from([u]), k, dtS: dt });
      released += q[0] * dt;
    }
    return { store: store[0], released };
  };
  const hourly = run(3600, 10);
  const fine = run(300, 120);              // the same ten hours, stepped finely
  nearF32(hourly.released, fine.released, "the same hours release the same water");
  near(hourly.store, fine.store, 1e-9, "and hold the same");
  // Against the continuous answer: u*t - u*k*(1 - e^(-t/k)).
  const t = 36000;
  nearF32(hourly.released, u * t - u * 900 * (1 - Math.exp(-t / 900)), "the closed form");
  near(hourly.store, u * 900 * (1 - Math.exp(-t / 900)), 1e-9, "held = u*k*(1 - e^(-t/k))");
  ok(/EXACT integral/.test(mathsFor("landslide-forecast").lines.map((l) => l.note).join(" ")),
    "and the card says it is exact");
});

/* ── the registry, and what carries it ───────────────────────────────────── */

check("every modelled entry states its kind, its lines and its symbols", () => {
  for (const id of modelledIds()) {
    const m = mathsFor(id);
    ok(m.kind, `${id} has no kind`);
    ok((m.lines || []).length, `${id} prints no equation`);
    ok((m.terms || []).length, `${id} defines no symbols`);
    // Every symbol a line uses should be defined, or the card is a wall of
    // Greek. Checked loosely: the terms must at least mention what appears.
    ok(m.intro && m.note, `${id} is missing its prose`);
  }
});

check("a layer computed here does not read as somebody else's model", () => {
  ok(mathsFor("dem-slope").kind === COMPUTED, "slope is ours");
  ok(mathsFor("soil-thickness").kind !== COMPUTED, "the thickness is not");
  ok(/Pelletier/.test(mathsFor("soil-thickness").intro), "and says whose it is");
});

check("the rows that show a model actually pass it to the card", () => {
  const panel = readFileSync(new URL("./dem-panel.js", import.meta.url), "utf8");
  ok(/maths: mathsFor\(spec\.id\)/.test(panel), "the three streamed sheets");
  const cat = readFileSync(new URL("./catalogue-panels.js", import.meta.url), "utf8");
  ok(/maths: mathsFor\("soil-thickness"\)/.test(cat), "the thickness row");
  const list = readFileSync(new URL("./catalogue-list.js", import.meta.url), "utf8");
  ok(/if \(entry\.info\.maths\) pop\.appendChild\(mathsBlock/.test(list), "and the card draws it");
});

/* ── the working travels with the layer ──────────────────────────────────── */

/**
 * A catalogue row is a tab you tick once; the layer then lives in the
 * Workspace for the rest of the session. And the layers with the MOST to
 * explain never had a catalogue row at all -- GeoID mode builds its Factor of
 * Safety layer, so the one surface on the globe carrying an engineering model
 * was the one with nowhere to say which model.
 */
const hierarchy = readFileSync(new URL("./layer-hierarchy.js", import.meta.url), "utf8");
check("the Workspace row draws an ⓘ for a layer that has working to show", () => {
  ok(/if \(layer\.info\?\.maths && !isCatalogueLayer\(layer\)\) \{/.test(hierarchy),
    "gated on the maths being there");
  ok(/datasetInfoButton\(\{/.test(hierarchy), "and it is the catalogue's own button");
});

/**
 * AND NOT WHERE THE CATALOGUE ALREADY DRAWS ONE.
 *
 * The rule above was written for the layers with nowhere else to say it -- the
 * Factor of Safety layer, the streamed DEM sheets, the thickness sheet, none of
 * which has a catalogue row. A catalogue dataset does: its row in the nav tab
 * has carried the ⓘ all along, so a second in the Workspace is two doors to one
 * card on one screen. It showed up the moment a catalogue dataset first carried
 * `maths`, and it was reported.
 */
check("but not a second one for a layer whose catalogue row already has it", () => {
  ok(/!isCatalogueLayer\(layer\)/.test(hierarchy), "the Workspace row stands down");
  ok(/import \{ isCatalogueLayer \}/.test(hierarchy), "from the catalogue's own test");
  // The layers the rule exists FOR must keep theirs: none of them is in the
  // catalogue, so none is excluded by it.
  const data = readFileSync(new URL("./global-data.js", import.meta.url), "utf8");
  for (const id of ["geoid-fos", "soil-thickness", "dem-slope"]) {
    ok(!new RegExp(`id: "${id}"`).test(data), `${id} has no catalogue row to defer to`);
  }
});

/**
 * The row is a fixed seven-column grid. An eighth child without an eighth
 * column pushes the move buttons onto a second line: measured, 32 px becomes
 * 58 px, and only that row -- so a modelled layer would sit a step taller than
 * its neighbours.
 */
check("and gives it a column, so the row does not grow a second line", () => {
  ok(/node\.classList\.add\("has-info"\)/.test(hierarchy), "the row is marked");
  const rule = hierarchy.match(
    /\.layer-row\.has-info \{\s*grid-template-columns:([^;]+);/);
  ok(rule, "and has its own template");
  const base = hierarchy.match(
    /\.layer-stack \.layer-row \{\s*grid-template-columns:([^;]+);/);
  const count = (t) => t.trim().split(/\s+/).length;
  ok(count(rule[1]) === count(base[1]) + 1,
    `one more column: ${count(base[1])} then ${count(rule[1])}`);
});

check("the modelled layers all carry theirs", () => {
  const cases = [
    ["geoid-mode.js", /maths: mathsFor\("geoid-fos"\)/, "the Factor of Safety layer"],
    ["dem-layer.js", /maths: mathsFor\(spec\.id\)/, "the streamed sheets"],
    ["soil-thickness.js", /maths: mathsFor\("soil-thickness"\)/, "the thickness sheet"],
    // By the ENTRY'S OWN ID, so a catalogue dataset with an equations entry
    // gets the button and one without gets none. The cyclone risk map is the
    // one entry in that catalogue whose numbers this repository produces.
    ["global-data.js", /const maths = mathsFor\(entry\.id\)/, "any modelled catalogue dataset"],
  ];
  for (const [file, pattern, what] of cases) {
    const src = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    ok(pattern.test(src), `${what} (${file})`);
  }
});

check("the button styles itself away from the catalogue that owns its CSS", () => {
  const list = readFileSync(new URL("./catalogue-list.js", import.meta.url), "utf8");
  const fn = list.slice(list.indexOf("export function datasetInfoButton"),
    list.indexOf("function infoButton("));
  ok(/installStyle\(\)/.test(fn), "an ⓘ on a layer row is not an unstyled letter");
});

/**
 * THE CARD IS WHERE A MODEL SHOWS ITS WORKING, and three of the channel
 * model's decisions change what its numbers MEAN without appearing as a
 * control anywhere: the mapped rivers are burnt into the heights before the
 * flow directions are worked out, a river cell reports its reach rather than
 * its own bank, and a factor of safety is withheld where the catchment reaches
 * outside the mapped ground. A reader who cannot see those cannot tell what
 * the map is claiming.
 */
check("the channel card states the decisions that have no control", () => {
  const m = mathsFor("landslide-forecast");
  const terms = (m.terms || []).map((t) => `${t[0]} ${t[1]}`).join(" | ");
  ok(/the network/.test(terms) && /before the flow\s+directions|BEFORE the flow/i.test(terms.replace(/\s+/g, " ")),
    "the burn into the heights is stated");
  ok(/the reach/.test(terms) && /own bank/.test(terms), "reporting the reach is stated");
  ok(/a whole catchment/.test(terms) && /LOWER BOUND/.test(terms), "the withheld factor of safety is stated");
});

check("and the burn depth it names is the one the pipeline uses", () => {
  const src = readFileSync(new URL("./landslide-pipeline.js", import.meta.url), "utf8");
  const m = /const RIVER_BURN_M = (\d+);/.exec(src);
  ok(m, "the pipeline names a burn depth");
  const terms = (mathsFor("landslide-forecast").terms || []).map((t) => t[1]).join(" ");
  ok(new RegExp(`${m[1]} m into the heights`).test(terms),
    `the card says ${m[1]} m, as the code does`);
});

if (failures.length) {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
