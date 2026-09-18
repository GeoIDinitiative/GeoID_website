// Any layer asked for a value at a place: each of the five ways a layer can
// answer, the ones that cannot and why, and what reaches the nodes.
import {
  samplerOver, queryFields, describeQuery, openReader, sampleAtNodes, fieldCsv, slugOf, pickField, syncReader,
} from "./layer-query.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name} ${extra}`); } };
process.on("exit", () => {
  console.log(`layer-query: ${pass} passed${fail ? `, ${fail} failed` : ""}`);
  if (fail) process.exitCode = 1;
});

const square = (x0, y0, x1, y1, properties, hole = null) => ({
  type: "Feature", properties,
  geometry: { type: "Polygon", coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], ...(hole ? [hole] : [])] },
});

// ── Point in polygon, holes and precedence ──────────────────────────────────
{
  const hole = [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6], [0.4, 0.4]];
  const at = samplerOver([square(0, 0, 1, 1, { k: "fine" }, hole), square(-1, -1, 2, 2, { k: "coarse" })], (p) => p.k);
  ok("the first containing polygon answers", at(0.2, 0.2) === "fine");
  ok("a hole is not inside, so the next polygon answers", at(0.5, 0.5) === "coarse");
  ok("outside everything is null", at(5, 5) === null);
}

// ── Which columns a polygon layer can be read by ────────────────────────────
{
  const feats = [
    square(0, 0, 1, 1, { lith: "granite", k_ms: 1e-6, note: "", color: "#aa0000", id: 1, blank: "" }),
    square(1, 0, 2, 1, { lith: "basalt", k_ms: "2e-5", note: "", color: "#00aa00", id: 2, blank: "" }),
  ];
  const fields = queryFields(feats);
  ok("a numeric column comes first, a numeric STRING counts, a blank never does",
    fields[0]?.name === "k_ms" && fields[0].kind === "number" && !fields.some((f) => f.name === "blank" || f.name === "note"));
  ok("a name column is a class; the app's own bookkeeping is not a field",
    fields.some((f) => f.name === "lith" && f.kind === "class") && !fields.some((f) => f.name === "color" || f.name === "id"));
}

// ── How each kind of layer says it can be asked ─────────────────────────────
{
  ok("an Earth Engine drape with a legend is a sampler, and says values come through the palette",
    describeQuery({ sampler: () => 1, info: { valueKind: "values", recoveredFromPalette: true, unit: "mm" } }).how === "sampler"
    && /palette/.test(describeQuery({ sampler: () => 1, info: { valueKind: "values", recoveredFromPalette: true } }).why));
  ok("a picture with no legend is refused BY NAME",
    describeQuery({ sampler: () => ({ r: 1, g: 2, b: 3 }), info: { valueKind: "colour" } }).how === "none"
    && /picture/.test(describeQuery({ sampler: () => 0, info: { valueKind: "colour" } }).why));
  ok("a tool's raster is a grid", describeQuery({ raster: { band: new Float32Array(4), width: 2, height: 2, bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 } } }).how === "raster");
  ok("a streamed map is fetched for the ground", describeQuery({ featuresIn: async () => ({ features: [] }), features: [] }).how === "tiled");
  ok("points say embed or interpolate", describeQuery({ collection: { features: [{ geometry: { type: "Point", coordinates: [0, 0] }, properties: {} }] } }).points === true);
  ok("lines say fault or refine", describeQuery({ collection: { features: [{ geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] }, properties: {} }] } }).lines === true);
  ok("a mesh has nothing to ask", describeQuery({ object3D: {} }).how === "none");
}

// ── Readers ─────────────────────────────────────────────────────────────────
{
  // A raster: bilinear in the middle, null outside, no-data is not a value.
  const raster = { band: Float32Array.from([0, 10, 20, 30]), width: 2, height: 2, bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 }, noData: null };
  const r = await openReader({ raster }, { west: 0, east: 1, south: 0, north: 1 });
  ok("a raster reads bilinearly (row 0 is the NORTH edge)", r.ok && Math.abs(r.read(0.5, 0.5) - 15) < 1e-9 && r.read(1, 0) === 0 && r.read(0, 1) === 30);
  ok("outside a raster is null", r.read(2, 2) === null);
  const holed = await openReader({ raster: { ...raster, band: Float32Array.from([0, -9999, 20, 30]), noData: -9999 } }, {});
  ok("a no-data corner falls back to a valid neighbour, never to the sentinel", holed.read(0.9, 0.9) !== -9999 && Number.isFinite(holed.read(0.9, 0.9)));

  // A sampler: numbers, {value}, and a colour that is refused per reading.
  const s = await openReader({ sampler: (lat) => (lat > 0 ? { value: 7 } : { r: 1, g: 2, b: 3 }), info: { valueKind: "values" } }, {});
  ok("a sampler's {value} is a number and its colour is null", s.read(1, 0) === 7 && s.read(-1, 0) === null);

  // Polygons by a numeric column, by a class column, and by presence.
  const feats = [square(0, 0, 1, 1, { lith: "granite", k: 5 }), square(1, 0, 2, 1, { lith: "basalt", k: 9 })];
  const n = await openReader({ collection: { features: feats } }, {}, { field: "k" });
  ok("polygons by a number", n.kind === "number" && n.read(0.5, 0.5) === 5 && n.read(0.5, 1.5) === 9 && n.read(5, 5) === null);
  const c = await openReader({ collection: { features: feats } }, {}, { field: "lith" });
  ok("polygons by a class: integer ids, the table beside them",
    c.kind === "class" && c.read(0.5, 0.5) === 2 && c.read(0.5, 1.5) === 1 && c.classes[0].name === "basalt" && c.classes[1].name === "granite");
  const p = await openReader({ collection: { features: [square(0, 0, 1, 1, {})] } }, {});
  ok("polygons with no column read as inside or outside", p.kind === "presence" && p.read(0.5, 0.5) === 1 && p.read(5, 5) === 0);

  // A streamed map: fetched for the box, in the app's own bound names, and given back.
  let asked = null; let restored = 0;
  const tiled = {
    features: [],
    featuresIn: async (b) => { asked = b; return { features: feats }; },
    restoreLive: () => { restored += 1; },
  };
  const t = await openReader(tiled, { west: 0, east: 2, south: 0, north: 1 }, { field: "lith" });
  ok("a streamed map is asked about the GROUND, in minX/maxX/minY/maxY", asked && asked.minX === 0 && asked.maxX === 2 && asked.minY === 0 && asked.maxY === 1);
  ok("and reads like any polygon layer, ids in name order", t.ok && t.read(0.5, 1.5) === 1 && t.read(0.5, 0.5) === 2);
  t.close();
  ok("closing gives the map its own features back, once", restored === 1);
  const none = await openReader({ sampler: () => 0, info: { valueKind: "colour" } }, {});
  ok("a picture opens no reader and says why", !none.ok && /picture/.test(none.message));
}

// ── Onto the nodes ──────────────────────────────────────────────────────────
{
  const reader = { kind: "number", read: (lat) => (lat < 0 ? null : lat * 10) };
  const out = sampleAtNodes(reader, [-1, 0, 1, 2], [0, 0, 0, 0]);
  ok("no value is NaN, never zero", Number.isNaN(out.values[0]) && out.values[1] === 0);
  ok("coverage counts the nodes that got a value", out.withValue === 3 && Math.abs(out.coverage - 0.75) < 1e-12 && out.min === 0 && out.max === 20 && out.mean === 10);
  const csv = fieldCsv({ name: "Rainfall (CHIRPS)", unit: "mm", xs: [0, 1], ys: [0, 1], zs: [5, 6], lats: [1, 2], lons: [3, 4], values: Float64Array.from([NaN, 12.5]) });
  const rows = csv.trim().split("\n");
  ok("a row per node, the unit in the column name, a blank where there is no value",
    rows[0] === "node,x_m,y_m,z_m,lat,lon,Rainfall_CHIRPS__mm" && rows[1].endsWith(",") && rows[2].endsWith(",12.5"));
  const classed = fieldCsv({ name: "lith", xs: [0], ys: [0], zs: [0], lats: [0], lons: [0], values: Float64Array.from([2]), classes: [{ id: 1, name: "granite" }, { id: 2, name: "basalt, vesicular" }] });
  ok("a class field carries its name beside its id, quoted", classed.trim().split("\n")[1].endsWith(',2,"basalt, vesicular"'));
  ok("a slug is a file-safe name", slugOf("Rainfall (CHIRPS) · 2025") === "rainfall_chirps_2025");
}

// ── Which column a role prefers ─────────────────────────────────────────────
{
  const fields = [{ name: "t_age", kind: "number" }, { name: "b_age", kind: "number" }, { name: "descrip", kind: "class" }, { name: "lith", kind: "class" }];
  ok("a material region takes the survey's own unit column, not the first class it meets", pickField(fields, { prefer: "class" }).name === "lith");
  ok("a condition takes a number", pickField(fields, { prefer: "number" }).name === "t_age");
  ok("a chosen column wins over any preference", pickField(fields, { field: "descrip", prefer: "number" }).name === "descrip");
  ok("with no class to prefer, what there is", pickField([{ name: "k", kind: "number" }], { prefer: "class" }).name === "k");
  const sync = syncReader({ raster: { band: Float32Array.from([1, 1, 1, 1]), width: 2, height: 2, bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 } } });
  ok("a grid and a sampler read without a fetch; polygons do not", sync(0.5, 0.5) === 1 && syncReader({ collection: { features: [] } }) === null);
}
