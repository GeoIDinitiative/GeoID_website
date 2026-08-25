/**
 * Map overlays: the raster layers that go OVER the basemap, several at once.
 *
 * The Basemap and Relief tab offered one dropdown, and a dropdown is a
 * statement that these things are alternatives. Some of them are — a sphere
 * has one texture and choosing Blue Marble instead of Earth Surface is a real
 * either/or. Most of the interesting ones are not: a hillshade UNDER a stress
 * map UNDER a coastline is the ordinary way anybody reads a tectonic map, and
 * the dropdown made it impossible to say.
 *
 * So the basemap keeps its dropdown — that is the sphere's own texture, and
 * there is genuinely one of it — and everything else is a tick in a catalogue
 * exactly like Data · Vectors & Shapes, each becoming its own layer with its
 * own eye, opacity and place in the draw order. The mechanism is the same one
 * the Earth Engine drapes use, because the traps of putting an image on a
 * displaced sphere are answered once in `gee.js` and must not be answered
 * twice.
 *
 * The stress map is why this was built now. Everything else here is a texture
 * the viewer already shipped and could only ever show alone.
 */

import { drape } from "./gee.js?v=20260825-e3e4927";

// In the shape the drape and the layer record both read: this app says
// west/south/east/north in most places and Earth Engine answers
// minX/minY/maxX/maxY, and `drape` now takes either -- but a layer's own
// `bounds` is read by extraction and framing, which want this one.
const GLOBAL_BOUNDS = { minX: -180, maxX: 180, minY: -90, maxY: 90 };

/**
 * A shell round the whole planet needs a finer grid than a patch over a study
 * area: at 96 segments each one spans nearly four degrees of longitude, and
 * the seam between flat facets shows against a curved horizon.
 */
const GLOBAL_SEGMENTS = 180;

export const MAP_LAYERS = [
  {
    id: "stress-shmax",
    group: "Stress and tectonics",
    label: "Stress field (World Stress Map)",
    path: "/data/global/stress-shmax.png",
    meta: "/data/global/stress-shmax.json",
    /**
     * ONE field, four questions, and no single picture answers more than one.
     *
     * A rainbow of orientations is the obvious map and the least useful one to
     * arrive at: it says which way SHmax points and cannot say what that does
     * to the crust — the same NNE compression is a rift or a thrust belt
     * depending on which principal stress is vertical. And neither picture
     * says whether there is any data underneath it, which over an ocean is the
     * first thing worth knowing. So the variants are a symbology choice on the
     * layer rather than four entries in the catalogue: it is the same layer,
     * read four ways.
     */
    variants: [
      {
        id: "regime",
        label: "Faulting regime",
        path: "/data/global/stress-regime.png",
        note: "What the stress is doing: red where the crust is pulling apart, "
          + "blue where it is shortening, green where it is shearing past itself. "
          + "The WSM's own colours, and the map most people mean.",
        legend: [
          { label: "Normal faulting (extension)", colour: "#e2444a" },
          { label: "Strike-slip", colour: "#3aa03a" },
          { label: "Thrust faulting (shortening)", colour: "#3a6bd6" },
          { label: "Undetermined", colour: "#96969e" },
        ],
      },
      {
        id: "shmax",
        label: "SHmax orientation",
        path: "/data/global/stress-shmax.png",
        note: "Which way the maximum horizontal stress points. The hue wraps "
          + "every 180° because the quantity does — an orientation is an axis.",
        cyclic: true,
      },
      {
        id: "agreement",
        label: "Agreement between records",
        path: "/data/global/stress-agreement.png",
        note: "How consistently the measurements in each cell point the same "
          + "way. Bright is a coherent field; dark is a mean of records that "
          + "disagree, which is a number rather than a measurement.",
        legend: [
          { label: "Records disagree", colour: "#281446" },
          { label: "Mixed", colour: "#783cc8" },
          { label: "Consistent", colour: "#ffe9a8" },
        ],
      },
      {
        id: "density",
        label: "How much data",
        path: "/data/global/stress-density.png",
        note: "Effective measurements within the search radius, on a log scale "
          + "— the map OF the map. An interpolated field is only as good as "
          + "what is under it, and over the oceans that is often one record.",
        legend: [
          { label: "One or two records", colour: "#0c1e32" },
          { label: "Tens", colour: "#28a0be" },
          { label: "Hundreds", colour: "#ffffdc" },
        ],
      },
    ],
    summary: "32,464 A–C quality measurements of the maximum horizontal stress "
      + "direction, interpolated to a 0.5° grid at a 450 km radius. Transparent "
      + "where there are no data and faint where the data disagree.",
    licence: "World Stress Map 2016 (Heidbach et al.) — CC BY 4.0",
    /**
     * FULL opacity, because the raster carries its own.
     *
     * Every one of these pictures is already transparent where the data are
     * thin — that is the whole point of the alpha channel in them — so a layer
     * opacity of 0.7 multiplied the two together and a well-constrained region
     * came out at 40% of its colour. The map went dim in exactly the places it
     * was most confident. The slider is still there to take it down.
     */
    opacity: 1,
  },
  {
    id: "map-hillshade",
    group: "Terrain",
    label: "GEBCO hillshade",
    manifest: "derived-hillshade",
    summary: "Relief shading from the GEBCO 2025 grid. Over a colour basemap at "
      + "half opacity it is what makes the terrain read as terrain.",
    licence: "GEBCO 2025 — free to use with attribution",
    opacity: 0.5,
  },
  {
    id: "map-slope",
    group: "Terrain",
    label: "GEBCO slope",
    manifest: "derived-slope",
    summary: "Steepness from the same grid: the continental shelves, the trenches "
      + "and the mountain fronts as edges rather than as colours.",
    licence: "GEBCO 2025 — free to use with attribution",
    opacity: 0.55,
  },
  {
    id: "map-relief-context",
    group: "Terrain",
    label: "GEBCO relief context",
    manifest: "gebco-bathy-context",
    summary: "Bathymetry and topography together, as a tinted relief overlay.",
    licence: "GEBCO 2025 — free to use with attribution",
    opacity: 0.6,
  },
  {
    id: "map-earth-surface",
    group: "Imagery",
    label: "Earth surface (NASA)",
    manifest: "earth-visible",
    summary: "NASA's surface texture, which can sit over the basemap at partial "
      + "opacity rather than replacing it.",
    licence: "NASA — public domain",
    opacity: 0.7,
  },
];

export const GROUPS = ["Stress and tectonics", "Terrain", "Imagery"];

export const layerById = (id) => MAP_LAYERS.find((entry) => entry.id === id) || null;

/** The catalogue as the shared list renderer wants it, grouped and ordered. */
export function grouped() {
  return GROUPS
    .map((group) => ({ group, entries: MAP_LAYERS.filter((e) => e.group === group) }))
    .filter(({ entries }) => entries.length);
}

/**
 * Where the image is.
 *
 * The terrain overlays are textures the viewer already ships and already
 * stamps, so their paths come from the manifest rather than being written out
 * here — a second copy would be a second thing to update the next time an
 * asset moves, and the manifest is what the basemap dropdown reads.
 */
/**
 * Which reading of the layer this is — the named one, or the first declared.
 *
 * The FIRST is the default on purpose: the regime map leads because it is the
 * one that answers "so what". An orientation rainbow is the obvious picture
 * and the least useful one to arrive at.
 */
export function variantOf(entry, id = null) {
  const list = entry?.variants || [];
  if (!list.length) return null;
  return list.find((v) => v.id === id) || list[0];
}

export function pathOf(entry, variantId = null) {
  const variant = variantOf(entry, variantId);
  if (variant?.path) return variant.path;
  // Site-root absolute, the same convention `global-data.js` uses for every
  // shipped dataset — they all live in one `/data/global/` and a relative path
  // would resolve against whichever directory happened to ask. (`gis/` for a
  // module URL, `viewer/` for the document: neither is where the data is.)
  if (entry?.path) return entry.path;
  if (!entry?.manifest) return null;
  const layers = window.__earthViewerManifest?.layers || [];
  return layers.find((layer) => layer.id === entry.manifest)?.path || null;
}

/** What the layer is called once it is on the globe. */
export const layerNameOf = (entry) => entry?.label || entry?.id || "Map overlay";

export function layerForMap(id) {
  const entry = layerById(id);
  if (!entry) return null;
  const name = layerNameOf(entry);
  return (window.GeoIDImportManager?.getLayers?.() || [])
    .find((layer) => layer.name === name) || null;
}

/**
 * The SHmax colour wheel, which must agree with the raster it explains.
 *
 * `bake-stress.py` paints hue = azimuth / 180 and this reads the same ramp
 * back for the legend. The two are written out separately in two languages, so
 * the contract is stated here and pinned by a test: an orientation's colour on
 * the map and its swatch in the legend are the same colour or the legend is
 * furniture.
 *
 * It is CYCLIC because the quantity is: 179° and 1° are two degrees apart, so
 * their colours must be adjacent. A linear ramp would put the two ends of the
 * wheel at opposite ends of the key and split one orientation in half.
 */
export function azimuthColour(degrees) {
  const hue = (((Number(degrees) || 0) % 180) + 180) % 180 / 180;
  const i = Math.floor(hue * 6) % 6;
  const f = hue * 6 - Math.floor(hue * 6);
  const v = 0.98;
  const s = 1;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const rgb = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i];
  return `#${rgb.map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** Eight compass points, which is as fine as a legend this size can be read. */
export function azimuthLegend() {
  const names = ["N–S", "NNE", "NE", "ENE", "E–W", "WNW", "NW", "NNW"];
  return names.map((label, i) => {
    const degrees = i * 22.5;
    return { degrees, label: `${label} (${degrees.toFixed(0)}°)`, colour: azimuthColour(degrees) };
  });
}

/**
 * Put one on the globe.
 *
 * Parented to the GLOBE mesh rather than to the imported group, exactly as the
 * Earth Engine drapes are: the globe carries the spin its own way, and a shell
 * held in the other frame drifts a degree every four minutes.
 */
export async function addMapLayer(id, onStatus = () => {}, variantId = null) {
  const entry = layerById(id);
  if (!entry) return { ok: false, message: "No such map layer." };
  if (layerForMap(id)) return { ok: true, message: `${entry.label} is already on the globe.` };
  const path = pathOf(entry, variantId);
  if (!path) return { ok: false, message: `${entry.label} has no image on this build.` };

  onStatus(`Draping ${entry.label}…`);
  try {
    const object3D = await drape(path, GLOBAL_BOUNDS, { segments: GLOBAL_SEGMENTS });
    const layer = window.GeoIDImportManager?.addDerivedLayer?.(
      layerNameOf(entry),
      { object3D, bounds: GLOBAL_BOUNDS, georeferenced: true },
      // The imagery band, under geology and under anything anybody imported:
      // these are context to read other layers against, not the subject.
      "tiles",
    );
    if (!layer) throw new Error("the layer could not be registered");
    object3D.userData.geoidLayer = true;
    window.GeoIDViewer?.globe?.add?.(object3D);
    window.GeoIDLayerHierarchy?.setOpacity?.(layer, entry.opacity ?? 1);
    // Carried on the layer so the symbology dialog can offer the other
    // readings of the same field without knowing where they came from.
    layer.mapEntryId = entry.id;
    applyVariant(layer, entry, variantOf(entry, variantId)?.id || null);
    window.GeoIDLayerHierarchy?.render?.();
    const message = `${entry.label} added. ${entry.licence}.`;
    onStatus(message);
    return { ok: true, layer, message };
  } catch (error) {
    const message = `${entry.label} could not be drawn: ${error.message}`;
    onStatus(message);
    return { ok: false, message };
  }
}

/**
 * What the legend says, for whichever reading is on.
 *
 * A variant is not a re-colouring of one quantity — it is a DIFFERENT
 * quantity — so the key has to change with it or it describes the picture
 * before last.
 */
function legendFor(variant) {
  if (variant?.cyclic) {
    const key = azimuthLegend();
    return {
      palette: key.map((k) => k.colour.replace("#", "")),
      labels: key.map((k) => k.label),
      categorical: true,
      classed: true,
      field: "SHmax azimuth",
    };
  }
  if (!variant?.legend?.length) return null;
  return {
    palette: variant.legend.map((k) => k.colour.replace("#", "")),
    labels: variant.legend.map((k) => k.label),
    categorical: true,
    classed: true,
    field: variant.label,
  };
}

function applyVariant(layer, entry, variantId) {
  const variant = variantOf(entry, variantId);
  layer.mapVariant = variant?.id || null;
  layer.legendInfo = legendFor(variant);
  layer.info = { source: entry.licence, summary: variant?.note || entry.summary };
}

/**
 * Swap the picture without rebuilding the layer.
 *
 * The mesh is 32,761 vertices of sphere, and rebuilding it to change a texture
 * would throw away the layer's place in the stack, its opacity and its row —
 * everything somebody had set. Only the map on the material changes. The old
 * texture is disposed explicitly, because a GPU texture is not freed by
 * dropping the reference to it.
 */
export async function setMapVariant(layerOrId, variantId) {
  const layer = typeof layerOrId === "string" ? layerForMap(layerOrId) : layerOrId;
  const entry = layerById(layer?.mapEntryId
    || (typeof layerOrId === "string" ? layerOrId : ""));
  const variant = variantOf(entry, variantId);
  if (!layer?.object3D || !variant) return { ok: false, message: "No such variant." };

  const THREE = await import("../vendor/three.module.js");
  const texture = await new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(variant.path, resolve, undefined,
      () => reject(new Error("the image could not be loaded")));
  });
  texture.colorSpace = THREE.SRGBColorSpace;
  layer.object3D.traverse?.((node) => {
    if (!node.material?.map) return;
    node.material.map.dispose?.();
    node.material.map = texture;
    node.material.needsUpdate = true;
  });
  applyVariant(layer, entry, variant.id);
  window.GeoIDLayerHierarchy?.render?.();
  return { ok: true, message: `${entry.label}: ${variant.label}.`, variant };
}

export function removeMapLayer(id) {
  const layer = layerForMap(id);
  if (!layer) return false;
  window.GeoIDImportManager?.removeLayer?.(layer.id);
  return true;
}

if (typeof window !== "undefined") {
  window.GeoIDMapLayers = {
    MAP_LAYERS, grouped, layerById, layerForMap, addMapLayer, removeMapLayer,
    azimuthColour, azimuthLegend, pathOf, variantOf, setMapVariant,
  };
}
