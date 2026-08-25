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

import { drape } from "./gee.js?v=20260825-7cf92a4";

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
    label: "SHmax orientation (World Stress Map)",
    path: "/data/global/stress-shmax.png",
    meta: "/data/global/stress-shmax.json",
    summary: "32,464 A–C quality measurements of the maximum horizontal stress "
      + "direction, interpolated to a 0.5° grid at a 450 km radius. Transparent "
      + "where there are no data and faint where the data disagree.",
    licence: "World Stress Map 2016 (Heidbach et al.) — CC BY 4.0",
    // Below the basemap's own detail rather than instead of it: at 0.85 the
    // field is legible and the coastlines under it are not, which makes a
    // global stress map hard to place. The slider is right there for anyone
    // who wants the colours flat.
    opacity: 0.7,
    cyclic: true,
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
export function pathOf(entry) {
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
export async function addMapLayer(id, onStatus = () => {}) {
  const entry = layerById(id);
  if (!entry) return { ok: false, message: "No such map layer." };
  if (layerForMap(id)) return { ok: true, message: `${entry.label} is already on the globe.` };
  const path = pathOf(entry);
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
    layer.info = { source: entry.licence, summary: entry.summary };
    if (entry.cyclic) {
      const key = azimuthLegend();
      layer.legendInfo = {
        palette: key.map((k) => k.colour.replace("#", "")),
        labels: key.map((k) => k.label),
        categorical: true,
        classed: true,
        field: "SHmax azimuth",
      };
    }
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

export function removeMapLayer(id) {
  const layer = layerForMap(id);
  if (!layer) return false;
  window.GeoIDImportManager?.removeLayer?.(layer.id);
  return true;
}

if (typeof window !== "undefined") {
  window.GeoIDMapLayers = {
    MAP_LAYERS, grouped, layerById, layerForMap, addMapLayer, removeMapLayer,
    azimuthColour, azimuthLegend, pathOf,
  };
}
