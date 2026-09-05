/**
 * THE MERGED GROUND ANSWER, and the reason it is a profile rather than a layer.
 *
 * Three maps describe the ground at a point and each answers a different
 * question at a different resolution over a different extent: BGS superficial
 * deposits (1:625,000, UK only), FAO's soils (1:5,000,000, global), and
 * Pelletier's modelled thickness (1 km, global). Blending them into one raster
 * would make a map whose meaning changes at the UK border with nothing on the
 * pixel to say so — and would destroy the most useful thing in the set, which
 * is where the two disagree.
 *
 * So every field keeps its source, and these are the rules that must hold.
 *
 * Run: node GeoID_GIS/viewer/gis/ground-profile.test.mjs
 */

let passed = 0;
const failures = [];
const check = (name, fn) => {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (e) { failures.push(`${name}: ${e.message}`); console.log(`FAIL ${name}: ${e.message}`); }
};
const ok = (c, what) => { if (!c) throw new Error(what); };

/* The page's seams, stubbed: this module reads the world through them. */
function stubWorld({ layers = [], thickness = null, slope = null, carded = null } = {}) {
  globalThis.window = {
    GeoIDFeaturePopup: { featuresAt: () => layers },
    GeoIDSoilThickness: { sampleAt: async () => thickness },
    GeoIDViewer: {
      estimateSurfaceSlopeDegrees: () => slope,
      getGeologyFeatureAtLatLon: () => carded,
    },
  };
  globalThis.document = undefined;
}

const hit = (name, properties) => ({ layer: { name }, feature: { properties } });
const SUPERFICIAL = hit("BGS superficial geology 625k.geojson",
  { rcs_d: "TILL, DEVENSIAN - DIAMICTON", lex_d: "Till" });
const SOIL = hit("Soils of the world (FAO/UNESCO)",
  { code: "Gx", name: "GELIC GLEYSOLS", group: "Gleysols" });

stubWorld();
const { profileAt, profileRows, isGroundLayer, SHALLOW_FAILURE_CAP_M }
  = await import("./ground-profile.js");

const rowsFor = async (world) => {
  stubWorld(world);
  return profileRows(await profileAt(54.98, -7.66));
};
const find = (rows, key) => (rows.find(([k]) => k === key) || [])[1] || "";

/* ── every line says where it came from ──────────────────────────────────── */

const superficialRows = await rowsFor({
  layers: [SUPERFICIAL, SOIL],
  thickness: { metres: 12, outside: false },
  slope: 21.4,
});

check("each field names its own source and scale", () => {
  ok(/1:625,000/.test(find(superficialRows, "Superficial deposit")), "the BGS scale");
  ok(/1:5,000,000/.test(find(superficialRows, "Soil unit")), "the FAO scale");
  ok(/Pelletier/.test(find(superficialRows, "Thickness above bedrock")), "the thickness model");
  ok(/DEM/.test(find(superficialRows, "Slope")), "the slope's own source");
});

/**
 * THE MATERIAL IS THE BEST-MAPPED ANSWER, NOT A BLEND — superficial where it
 * exists, because it is eight times the scale and it is what the strength
 * table is keyed on. And the card says which, because a c′ from a 1:625,000
 * map and a c′ from a 1:5,000,000 one are not the same claim.
 */
check("the strength comes from the finer map where there is one", () => {
  const strength = find(superficialRows, "Screening strength");
  ok(/till/i.test(strength), `matched the till: ${strength}`);
  ok(/superficial map/.test(strength), "and says where it came from");
});

const soilOnly = await rowsFor({
  layers: [SOIL], thickness: { metres: 4, outside: false }, slope: 9,
});
/**
 * A LAYER THAT IS NOT LOADED IS NOT A PLACE THAT IS NOT MAPPED. "Not mapped
 * here" over County Donegal reads as a statement about Donegal; it was a
 * statement about which tabs are ticked.
 */
check("an absent map says it is absent, not that the ground is unmapped", () => {
  const line = find(soilOnly, "Superficial deposit");
  ok(/no superficial map loaded/.test(line), line);
  ok(!/not mapped here/.test(line), "which is a different claim");
});

check("and the strength then comes from the soil map", () => {
  ok(/soil unit's typical texture|soil map/.test(find(soilOnly, "Screening strength")),
    find(soilOnly, "Screening strength"));
});

/**
 * A FAO unit NAME is not a material -- "Dystric Cambisols" matches no
 * lithology word, so every point outside the UK fell to the strength table's
 * no-information default. FAO publishes the topsoil's sand, silt and clay per
 * unit, and the dominant fraction is a keyword the table already holds.
 */
check("the soil unit's own texture answers where its name cannot", async () => {
  const rows = await rowsFor({
    layers: [hit("Soils of the world (FAO/UNESCO)",
      { code: "Bd", name: "DYSTRIC CAMBISOLS", sand_pct: 52, silt_pct: 30, clay_pct: 18 })],
    thickness: { metres: 2, outside: false },
    slope: 12,
  });
  const strength = find(rows, "Screening strength");
  ok(/^sand:/.test(strength), `the dominant fraction is the keyword: ${strength}`);
  ok(/52% sand/.test(strength), "and the card shows what it was read from");
  ok(!/no-information default/.test(strength), "so the default is not used");
});

/* ── the cap, which is the one place a number is changed ─────────────────── */

/**
 * Pelletier models the whole permeable column — up to 50 m in a valley fill —
 * and the infinite-slope model assumes a plane parallel to the ground. Handing
 * it 50 m answers a question nobody asked, about a rotational failure the
 * model cannot represent.
 */
const deep = await rowsFor({
  layers: [SOIL], thickness: { metres: 50, outside: false }, slope: 30,
});
check("the failure depth is capped, and both numbers are shown", () => {
  ok(/50 m/.test(find(deep, "Thickness above bedrock")), "the model's own number survives");
  const depth = find(deep, "Depth to the failure plane");
  ok(depth.startsWith(`${SHALLOW_FAILURE_CAP_M} m`), `capped: ${depth}`);
  ok(/shallow plane/.test(depth), "and says why it is not the thickness");
});

const thin = await rowsFor({
  layers: [SOIL], thickness: { metres: 1, outside: false }, slope: 30,
});
check("a thin column is used as it is, not padded to the cap", () => {
  ok(find(thin, "Depth to the failure plane").startsWith("1 m"),
    find(thin, "Depth to the failure plane"));
});

/* ── absences are answers ────────────────────────────────────────────────── */

const sea = await rowsFor({ layers: [], thickness: { metres: null, outside: false } });
const antarctic = await rowsFor({ layers: [], thickness: { metres: null, outside: true } });
check("nodata and outside-the-model are not zero", () => {
  ok(/not modelled here/.test(find(sea, "Thickness above bedrock")), find(sea, "Thickness above bedrock"));
  ok(/outside the model/.test(find(antarctic, "Thickness above bedrock")),
    find(antarctic, "Thickness above bedrock"));
  ok(!/\b0 m\b/.test(find(sea, "Thickness above bedrock")), "and neither prints a zero");
});

check("only the three ground maps claim the profile", () => {
  ok(isGroundLayer({ name: "BGS superficial geology 625k.geojson" }), "superficial");
  ok(isGroundLayer({ name: "Soils of the world (FAO/UNESCO)" }), "the soil map");
  ok(isGroundLayer({ name: "Soil and sediment thickness (Pelletier)" }), "the thickness sheet");
  ok(!isGroundLayer({ name: "World geology (Macrostrat)" }), "not the bedrock map");
  ok(!isGroundLayer({ name: "my-points.geojson" }), "not an import");
});

/**
 * THE TILED MAPS ARE HELD TWICE. The FAO soils arrive as a geologyDataset, so
 * the viewer keeps a catalogue of their polygons and the import manager keeps
 * the layer's features; the card is drawn from the first and this module reads
 * the second. Measured on the globe: three seconds after flying to Donegal the
 * card named Dystric Cambisols while `featuresAt` found nothing at the same
 * coordinate, and the profile silently dropped the two rows the click was most
 * about.
 */
const lagging = await rowsFor({
  layers: [],
  carded: {
    soil: true,
    source_layer: "Soils of the world (FAO/UNESCO)",
    rock_type: "Dystric Cambisols",
    rows: [["Sand", "52 %"], ["Silt", "30 %"], ["Clay", "18 %"], ["pH (H\u2082O)", "5.4"]],
  },
  thickness: { metres: 2, outside: false },
  slope: 11,
});
check("the card's own catalogue answers when the layer's features lag", () => {
  ok(/Dystric Cambisols/.test(find(lagging, "Soil unit")), find(lagging, "Soil unit"));
  const strength = find(lagging, "Screening strength");
  ok(/^sand:/.test(strength), `the texture is read back off the card: ${strength}`);
  ok(/52% sand/.test(strength), "with the number it came from");
});

if (failures.length) {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
