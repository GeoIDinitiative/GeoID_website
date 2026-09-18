/**
 * ANY LAYER, ASKED FOR A VALUE AT A PLACE -- so any layer can become a field
 * on a mesh.
 *
 * The Model Builder gave every Workspace layer a ROLE (initial condition,
 * boundary condition, material region) and then did nothing with three of
 * them: the role was written into the run's provenance BY NAME and the layer's
 * values never reached a node. A rainfall map "used as a boundary condition"
 * was a string in a JSON file.
 *
 * What stood in the way is that "what is the value here" is asked five
 * different ways in this app, and each consumer had learnt one of them:
 *
 *   sampler     an Earth Engine drape (read back through its palette), a
 *               GeoTIFF, a streamed sheet -- `layer.sampler(lat, lon)`
 *   raster      a tool's output -- `layer.raster` and its bounds
 *   polygons    a shapefile or a catalogue map -- point in polygon, then a
 *               COLUMN, which somebody has to choose
 *   tiled       the world geology, the soil map, GLiM -- the features must be
 *               FETCHED for the ground first (`featuresIn`), and given back
 *   nothing     a mesh, a picture with no legend, a point cloud
 *
 * This module is the one reader over all of them. It says which way a layer
 * can be asked (`describeQuery`), opens a reader over a box (`openReader`),
 * and samples it onto nodes (`sampleAtNodes`). A layer that cannot be asked
 * says WHY, by name: a colour-only drape is a picture, and rasterising a
 * picture is inventing numbers.
 *
 * Pure: no DOM, no scene. The pipeline supplies the layers and the nodes.
 */

const POLY = (g) => g?.type === "Polygon" || g?.type === "MultiPolygon";

function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * A point-in-polygon sampler over GeoJSON features (bbox first, holes
 * honoured). The FIRST containing polygon answers, so the caller's order is
 * the precedence -- the survey-precedence rule the pickers already live by.
 */
export function samplerOver(features, pick = (p) => p) {
  const list = (features || []).map((f) => {
    const polys = polygonsOf(f.geometry);
    if (!polys.length) return null;
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    polys.forEach((rings) => rings[0].forEach(([x, y]) => {
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }));
    return { props: f.properties || {}, polys, minX, minY, maxX, maxY };
  }).filter(Boolean);
  return (lat, lon) => {
    for (const e of list) {
      if (lon < e.minX || lon > e.maxX || lat < e.minY || lat > e.maxY) continue;
      for (const rings of e.polys) {
        if (!inRing(rings[0], lon, lat)) continue;
        if (rings.slice(1).some((h) => inRing(h, lon, lat))) continue;
        return pick(e.props);
      }
    }
    return null;
  };
}

/** The app's own bookkeeping columns, which are never a field of the data. */
const OWN_COLUMNS = new Set(["data_type", "data_note", "color", "colour", "fill", "stroke", "id", "objectid", "fid", "map_id", "legend_id", "source_id"]);

/**
 * The columns a polygon layer could be read by: numeric ones first (a field a
 * solver can take as it is), then categorical ones with few enough values to
 * be classes. `Number("")` is 0, so a blank is never a number here.
 */
export function queryFields(features, { maxClasses = 64, sample = 400 } = {}) {
  const seen = new Map();
  const step = Math.max(1, Math.floor((features?.length || 0) / sample));
  for (let i = 0; i < (features?.length || 0); i += step) {
    const props = features[i]?.properties || {};
    Object.keys(props).forEach((key) => {
      if (OWN_COLUMNS.has(key.toLowerCase())) return;
      const v = props[key];
      if (v === null || v === undefined || v === "" || typeof v === "object") return;
      let e = seen.get(key);
      if (!e) { e = { name: key, n: 0, numeric: 0, values: new Set() }; seen.set(key, e); }
      e.n += 1;
      if (typeof v === "number" ? Number.isFinite(v) : (String(v).trim() !== "" && Number.isFinite(Number(v)))) e.numeric += 1;
      if (e.values.size <= maxClasses) e.values.add(String(v));
    });
  }
  const out = [];
  seen.forEach((e) => {
    const numeric = e.numeric === e.n && e.n > 0;
    if (numeric && e.values.size > 1) out.push({ name: e.name, kind: "number", distinct: e.values.size });
    else if (!numeric && e.values.size > 1 && e.values.size <= maxClasses) out.push({ name: e.name, kind: "class", distinct: e.values.size });
  });
  // Numbers first; among classes, the fewest values first (a legend, not a name list).
  return out.sort((a, b) => (a.kind === b.kind ? a.distinct - b.distinct : (a.kind === "number" ? -1 : 1)));
}

/**
 * HOW a layer can be asked, without asking it. `how` is one of sampler,
 * raster, polygons, tiled or none; `why` is the sentence a panel shows.
 */
export function describeQuery(layer) {
  if (!layer) return { how: "none", why: "no layer" };
  const features = layer.collection?.features || layer.features || [];
  const polygons = features.some((f) => POLY(f?.geometry));
  if (typeof layer.featuresIn === "function") {
    return { how: "tiled", why: "a streamed map: its polygons are fetched for the study area, then read by a column" };
  }
  if (polygons) {
    const fields = queryFields(features);
    return fields.length
      ? { how: "polygons", fields, why: `polygons, read by a column (${fields.length} usable)` }
      : { how: "polygons", fields: [], presence: true, why: "polygons with no usable column: read as inside (1) or outside (0)" };
  }
  if (layer.raster?.band && layer.raster?.bounds) {
    return { how: "raster", unit: layer.unit || layer.info?.unit || "", why: `a ${layer.raster.width} × ${layer.raster.height} grid, read bilinearly` };
  }
  if (typeof layer.sampler === "function") {
    if (layer.info?.valueKind === "colour") {
      return { how: "none", why: "a picture with no legend to read numbers back through — fetch it as a dataset with a legend, or import the raster" };
    }
    return {
      how: "sampler", unit: layer.info?.unit || layer.unit || "",
      why: layer.info?.recoveredFromPalette
        ? "an Earth Engine drape: values read back through its own palette (a few percent off the source band)"
        : "a sampled layer, read at each node",
    };
  }
  if (features.some((f) => f?.geometry?.type === "Point")) {
    return { how: "none", points: true, why: "points: embed them (Embedded points), or interpolate them to a raster first (IDW / kriging) to make a field" };
  }
  if (features.some((f) => /LineString/.test(f?.geometry?.type || ""))) {
    return { how: "none", lines: true, why: "lines: a fault trace (Fault plane), or a refine region — a line has no value over an area" };
  }
  return { how: "none", why: "nothing to ask: a mesh or a display-only layer" };
}

function numberOf(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object") {
    if (Number.isFinite(v.value)) return v.value;
    return null; // an {r, g, b} is a colour, and a row needs a column
  }
  const n = Number(v);
  return String(v).trim() !== "" && Number.isFinite(n) ? n : null;
}

function bilinearRaster(raster) {
  const { band, width, height, bounds, noData = null } = raster;
  const ok = (v) => Number.isFinite(v) && (noData === null || v !== noData);
  return (lat, lon) => {
    let x = lon;
    if (x > 180 && bounds.maxX <= 180) x -= 360; else if (x < 0 && bounds.minX >= 0) x += 360;
    if (x < bounds.minX || x > bounds.maxX || lat < bounds.minY || lat > bounds.maxY) return null;
    const u = ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * (width - 1);
    const v = ((bounds.maxY - lat) / (bounds.maxY - bounds.minY)) * (height - 1);
    const x0 = Math.floor(u); const y0 = Math.floor(v);
    const x1 = Math.min(width - 1, x0 + 1); const y1 = Math.min(height - 1, y0 + 1);
    const fx = u - x0; const fy = v - y0;
    const c = [band[y0 * width + x0], band[y0 * width + x1], band[y1 * width + x0], band[y1 * width + x1]];
    if (!c.every(ok)) { const first = c.find(ok); return first === undefined ? null : first; }
    return (c[0] * (1 - fx) + c[1] * fx) * (1 - fy) + (c[2] * (1 - fx) + c[3] * fx) * fy;
  };
}

/**
 * Open a reader over a box. `read(lat, lon)` answers a NUMBER or null; a
 * categorical column answers its class's integer id, and `classes` is the
 * table (id → name) so the mesh field stays numeric and the names travel
 * beside it. `close()` gives a streamed layer its own features back -- a
 * borrowed study area left on the layer is the amputated-map fault.
 *
 * `bounds` is { west, south, east, north } in signed degrees.
 */
/**
 * WHICH COLUMN, when nobody chose one. A material region wants a CLASS (a
 * lithology, a soil unit) and a condition wants a NUMBER, and the first
 * numeric column of a geological map is an age in millions of years -- a
 * perfectly valid number that is nobody's initial condition. So the role says
 * which kind it prefers, and among classes the columns a survey actually
 * names its units by come first.
 */
const CLASS_HINTS = ["lith", "lithology", "unit", "class", "name", "soil", "type", "descrip"];
export function pickField(fields, { field = null, prefer = "number" } = {}) {
  if (field) return fields.find((f) => f.name === field) || { name: field, kind: "class" };
  const want = fields.filter((f) => f.kind === prefer);
  if (prefer === "class" && want.length) {
    for (const hint of CLASS_HINTS) {
      const hit = want.find((f) => f.name.toLowerCase() === hint) || want.find((f) => f.name.toLowerCase().includes(hint));
      if (hit) return hit;
    }
  }
  return want[0] || fields[0] || null;
}

/** A reader that needs no fetch: a sampler or a grid. Null for everything else. */
export function syncReader(layer) {
  const q = describeQuery(layer);
  if (q.how === "raster") return bilinearRaster(layer.raster);
  if (q.how === "sampler") return (lat, lon) => numberOf(layer.sampler(lat, lon));
  return null;
}

export async function openReader(layer, bounds, { field = null, prefer = "number" } = {}) {
  const q = describeQuery(layer);
  if (q.how === "none") return { ok: false, how: "none", message: q.why };
  if (q.how === "sampler") {
    return { ok: true, how: "sampler", kind: "number", unit: q.unit, note: q.why, read: (lat, lon) => numberOf(layer.sampler(lat, lon)), close() {} };
  }
  if (q.how === "raster") {
    return { ok: true, how: "raster", kind: "number", unit: q.unit, note: q.why, read: bilinearRaster(layer.raster), close() {} };
  }
  let features = layer.collection?.features || layer.features || [];
  let borrowed = false;
  if (q.how === "tiled") {
    try {
      const got = await layer.featuresIn({ minX: bounds.west, maxX: bounds.east, minY: bounds.south, maxY: bounds.north });
      if (got?.features?.length) { features = got.features; borrowed = typeof layer.restoreLive === "function"; }
    } catch (error) { /* what the layer holds stands */ }
  }
  features = features.filter((f) => POLY(f?.geometry));
  if (!features.length) return { ok: false, how: q.how, message: "no polygons over this ground" };
  const fields = queryFields(features);
  const close = () => { if (borrowed) { try { layer.restoreLive(); } catch (e) { /* keep */ } } };
  const chosen = pickField(fields, { field, prefer });
  if (!chosen) {
    const inside = samplerOver(features, () => 1);
    return { ok: true, how: q.how, kind: "presence", unit: "", field: null, fields, note: "no usable column: 1 inside a polygon, 0 outside", read: (lat, lon) => (inside(lat, lon) ? 1 : 0), close };
  }
  if (chosen.kind === "number") {
    const at = samplerOver(features, (p) => numberOf(p[chosen.name]));
    return { ok: true, how: q.how, kind: "number", unit: "", field: chosen.name, fields, note: `polygons read by "${chosen.name}"`, read: at, close };
  }
  // Classes: ids in NAME order over the box's own features, so the table is
  // complete before a node is read and the same study gives the same ids.
  const names = [...new Set(features.map((f) => f.properties?.[chosen.name]).filter((v) => v !== null && v !== undefined && v !== "").map(String))].sort();
  const ids = new Map(names.map((name, i) => [name, i + 1]));
  const classes = names.map((name, i) => ({ id: i + 1, name }));
  const at = samplerOver(features, (p) => {
    const v = p[chosen.name];
    return v === null || v === undefined || v === "" ? null : (ids.get(String(v)) ?? null);
  });
  return { ok: true, how: q.how, kind: "class", unit: "", field: chosen.name, fields, classes, note: `polygons read by "${chosen.name}" as classes`, read: at, close };
}

/**
 * Read a reader at every node. NaN where the layer has no value -- never 0,
 * which is a measurement. `coverage` is the share of nodes that got one, and
 * it is the number that says whether the layer reaches this ground at all.
 */
export function sampleAtNodes(reader, lats, lons) {
  const n = lats.length;
  const values = new Float64Array(n).fill(NaN);
  let got = 0; let min = Infinity; let max = -Infinity; let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const v = reader.read(lats[i], lons[i]);
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    values[i] = v; got += 1; sum += v;
    if (v < min) min = v; if (v > max) max = v;
  }
  return {
    values, nodes: n, withValue: got, coverage: n ? got / n : 0,
    min: got ? min : null, max: got ? max : null, mean: got && reader.kind === "number" ? sum / got : null,
  };
}

/** One tidy file: a row per surface node, the value beside where it is. */
export function fieldCsv({ name, unit = "", xs, ys, zs, lats, lons, values, classes = null }) {
  const col = `${String(name || "value").replace(/[^A-Za-z0-9_]+/g, "_")}${unit ? `_${String(unit).replace(/[^A-Za-z0-9]+/g, "")}` : ""}`;
  const byId = classes ? new Map(classes.map((c) => [c.id, c.name])) : null;
  const lines = [`node,x_m,y_m,z_m,lat,lon,${col}${byId ? ",class" : ""}`];
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    const cell = Number.isFinite(v) ? (Number.isInteger(v) ? String(v) : Number(v).toPrecision(7).replace(/\.?0+$/, "")) : "";
    const label = byId ? `,${JSON.stringify(byId.get(v) ?? "")}` : "";
    lines.push(`${i},${xs[i].toFixed(2)},${ys[i].toFixed(2)},${zs[i].toFixed(2)},${lats[i].toFixed(6)},${lons[i].toFixed(6)},${cell}${label}`);
  }
  return `${lines.join("\n")}\n`;
}

export function slugOf(name) {
  return String(name || "layer").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "layer";
}
