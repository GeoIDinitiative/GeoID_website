/**
 * The tools, at a location.
 *
 * A catalogue of thirty-seven dialogs is a list of things you could do to a
 * dataset. The pipeline is different: you map, you click a place, and the
 * place decides what is worth doing — then the answer comes back as a number
 * at that point and a plot through it, not as a layer you have to go and find.
 *
 * So this module is a gate, not a menu. A tool is offered only when the pin
 * actually has an input of the type that tool consumes: a DEM under the point
 * earns slope, aspect, curvature and a profile; a classified raster earns
 * reclassify and a window's statistics; a polygon under the point earns the
 * vector operations. Nothing is offered that would open a dialog with an empty
 * input select, which is the failure mode a catalogue cannot avoid.
 *
 * Each suggestion carries WHY it is being offered, because a tool list that
 * cannot say what it saw in the data is indistinguishable from a tool list
 * that saw nothing.
 *
 * The shell's Analysis Hub drives all of this over postMessage — it owns the
 * pin, and the tools live here in the viewer with the layers they operate on.
 */

/* Which tools answer a question about a point, by the input they need.
   Ordered within each group by how often the answer is the one wanted. */
const TERRAIN = ["slope", "aspect", "hillshade", "curvature", "roughness", "contours",
  // Hydrology is the other question a height field answers about a place:
  // where does water go from here, and what drains to it.
  "fillSinks", "flowAccumulation", "watershed", "streams", "viewshed"];
const RASTER_ANY = ["focal", "reclassify", "zonalStatistics", "calculator", "clipByPolygon",
  "resample", "toPoints"];
const VECTOR_ANY = ["buffer", "centroids", "dissolve", "hull", "simplify", "spatialJoin",
  "reproject", "clip"];

/** A short reason, in the language of what was found rather than of the code. */
function because(kind, name) {
  if (kind === "dem") return `${name} is a height field under this point`;
  if (kind === "raster") return `${name} has a value at this point`;
  if (kind === "vector") return `this point is inside ${name}`;
  return name;
}

/**
 * What is worth running here, given the pin and the tool registry.
 *
 * Pure: takes the pin payload the viewer already emits (layers sampled at the
 * coordinate, features under it) and the descriptors, and returns
 * `[{ id, label, blurb, why, inputName, inputLayerId, group }]`.
 */
export function suggestFor(pin, tools = []) {
  const byId = new Map(tools.map((tool) => [tool.id, tool]));
  const out = [];
  const seen = new Set();

  const push = (toolId, layer, kind, group) => {
    const desc = byId.get(toolId);
    if (!desc) {
      // The registry is the authority, and an id that has drifted out of it
      // must be LOUD: silently offering four tools where eleven were intended
      // is indistinguishable from a location that supports four.
      if (typeof console !== "undefined") {
        console.warn(`[GeoID GIS] location tools: no descriptor for "${toolId}"`);
      }
      return;
    }
    const key = `${toolId}:${layer.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    const input = (desc.inputs || [])[0];
    if (!input) return;
    out.push({
      id: toolId,
      label: desc.label,
      blurb: desc.blurb || "",
      why: because(kind, layer.name),
      inputName: input.name,
      inputLayerId: layer.id,
      inputLayerName: layer.name,
      group,
      needsSidecar: Boolean(desc.engines?.sidecar && !desc.engines?.native),
    });
  };

  const layers = pin?.layers || [];
  const dems = layers.filter((l) => l.isDem);
  const others = layers.filter((l) => !l.isDem);

  // Terrain first when there is ground under the point: it is the question
  // people ask of a location more than any other.
  dems.forEach((layer) => TERRAIN.forEach((id) => push(id, layer, "dem", "Terrain here")));
  others.forEach((layer) => RASTER_ANY.forEach((id) => push(id, layer, "raster", "This raster")));
  dems.forEach((layer) => RASTER_ANY.forEach((id) => push(id, layer, "dem", "This raster")));

  (pin?.features || []).forEach((feature) => {
    const layer = { id: feature.layerId ?? feature.layer, name: feature.layer };
    VECTOR_ANY.forEach((id) => push(id, layer, "vector", "The feature here"));
  });

  return out;
}

/** Does the pin have anything a profile could be drawn through? */
export function profileCandidates(pin) {
  return (pin?.layers || []).map((l) => ({ id: l.id, name: l.name, isDem: l.isDem }));
}

/* ── impure: running one, and reading the answer back at the point ───────── */

let runnerPromise = null;
function runner() {
  if (!runnerPromise) {
    const stamp = new URL(import.meta.url).search;
    runnerPromise = import(`./tool-runner.js${stamp}`);
  }
  return runnerPromise;
}

function layerById(id) {
  const layers = window.GeoIDImportManager?.getLayers?.() || [];
  return layers.find((l) => String(l.id ?? l.name) === String(id)) || null;
}

function sampleAt(layer, lat, lon) {
  try {
    const reading = layer?.sampler?.(lat, lon);
    const value = (reading && typeof reading === "object") ? reading.value : reading;
    return Number.isFinite(value) ? value : null;
  } catch (error) {
    return null;
  }
}

/**
 * Run a tool for this location and answer with the value AT the point.
 *
 * A tool that reports "slope_dem added to the map" has made the user go and
 * look; at a pinned location the useful answer is "4.2°, here". The layer is
 * still produced and still lands on the globe — this is what it says about the
 * place, not a replacement for it.
 */
export async function runAt(pin, request) {
  const { id, inputName, inputLayerId, params } = request || {};
  const engine = await runner();
  const layer = layerById(inputLayerId);
  if (!layer) return { ok: false, message: `"${request?.inputLayerName}" is no longer loaded.` };
  const desc = engine.toolById?.(id);
  if (!desc) return { ok: false, message: `Unknown tool "${id}".` };

  const inputs = { [inputName || desc.inputs[0].name]: layer };
  const merged = {};
  (desc.params || []).forEach((p) => {
    if (p.default !== undefined) merged[p.name] = p.default;
  });
  Object.assign(merged, params || {});

  let result;
  try {
    result = await engine.runToolAuto(id, inputs, merged, {});
  } catch (error) {
    return { ok: false, message: error?.message || String(error) };
  }
  if (!result?.ok) return { ok: false, message: result?.message || "the tool declined" };

  const produced = result.layer || null;
  const value = produced ? sampleAt(produced, pin.lat, pin.lon) : null;
  return {
    ok: true,
    tool: desc.label,
    layerName: produced?.name || null,
    outputType: result.outputType || desc.outputType || null,
    value,
    unit: produced?.legendInfo?.unit || desc.outputUnit || null,
    message: result.message || `${desc.label} ran on ${layer.name}.`,
  };
}

/* ── a transect through the point, which is the plot a location deserves ─── */

const EARTH_KM_PER_DEG = 111.32;

/** Sample points along a great-circle-ish transect centred on the pin. */
export function transectPoints(lat, lon, lengthKm = 10, bearingDeg = 90, samples = 64) {
  const points = [];
  const half = lengthKm / 2;
  const rad = (bearingDeg * Math.PI) / 180;
  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i < samples; i += 1) {
    const t = samples === 1 ? 0 : (i / (samples - 1)) * 2 - 1;   // -1..1
    const alongKm = t * half;
    // Flat-earth offsets are exact enough over a few kilometres and keep the
    // distance axis honest: the x value IS the ground distance asked for.
    const dLat = (alongKm * Math.cos(rad)) / EARTH_KM_PER_DEG;
    const dLon = (alongKm * Math.sin(rad)) / (EARTH_KM_PER_DEG * cosLat);
    points.push({ km: Number((alongKm).toFixed(3)), lat: lat + dLat, lon: lon + dLon });
  }
  return points;
}

/** The values of one layer along that transect. */
export async function profileAt(pin, { layerId, lengthKm = 10, bearingDeg = 90, samples = 64 } = {}) {
  const layer = layerById(layerId);
  if (!layer?.sampler) return { ok: false, message: "that layer cannot be sampled." };
  const points = transectPoints(pin.lat, pin.lon, lengthKm, bearingDeg, samples);
  const series = points.map((p) => ({ km: p.km, value: sampleAt(layer, p.lat, p.lon) }));
  const known = series.filter((s) => Number.isFinite(s.value));
  if (!known.length) return { ok: false, message: `${layer.name} has no values along that line.` };
  return {
    ok: true,
    layerName: layer.name,
    unit: layer.legendInfo?.unit || null,
    lengthKm,
    bearingDeg,
    min: Math.min(...known.map((s) => s.value)),
    max: Math.max(...known.map((s) => s.value)),
    centre: sampleAt(layer, pin.lat, pin.lon),
    series,
  };
}

/* ── the bridge the hub talks to ────────────────────────────────────────── */

async function respond(type, payload) {
  if (window.self === window.top) return;
  try {
    window.parent.postMessage({ type, ...payload }, "*");
  } catch (error) {
    /* a cross-origin parent cannot be answered; nothing else to do */
  }
}

async function onMessage(event) {
  const msg = event?.data;
  if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("geoid:tools:")) return;
  try {
    if (msg.type === "geoid:tools:list") {
      const engine = await runner();
      respond("geoid:tools:suggestions", {
        token: msg.token,
        suggestions: suggestFor(msg.pin, engine.TOOLS || []),
        profiles: profileCandidates(msg.pin),
      });
    } else if (msg.type === "geoid:tools:run") {
      respond("geoid:tools:result", { token: msg.token, result: await runAt(msg.pin, msg.request) });
    } else if (msg.type === "geoid:tools:profile") {
      respond("geoid:tools:profile:result", {
        token: msg.token,
        result: await profileAt(msg.pin, msg.request || {}),
      });
    }
  } catch (error) {
    respond("geoid:tools:result", {
      token: msg.token,
      result: { ok: false, message: error?.message || String(error) },
    });
  }
}

if (typeof window !== "undefined") {
  window.GeoIDLocationTools = { suggestFor, runAt, profileAt, transectPoints, profileCandidates };
  // The bridge only exists where there is one: the unit run imports this file
  // for the pure gate above and has no message loop to join.
  window.addEventListener?.("message", onMessage);
}
