/**
 * VOLCANIC HAZARD BUFFERS: Etna Explorer's five zones, around every volcano
 * the reader admits, merged where they overlap.
 *
 * The zones are the ones `earth_explorer/etna/viewer/etna-viewer.js` draws
 * round Etna's summit -- 0-5, 5-10, 10-20, 20-35 and 35-50 km, with the
 * hazards INGV assigns to each band -- carried over verbatim as the
 * schematic they are. They are not a hazard MAP: a real extent depends on
 * eruption style, vent location, wind and topography, and the ⓘ says so.
 *
 * WHICH VOLCANOES is the reader's choice and it is a fact about the record,
 * not a taste: the catalogue's own `label_rank` is eruption recency (5 =
 * erupted since 2000 ... 1 = an undated Holocene eruption, 0 = Pleistocene),
 * so "erupted since 1900" is rank 4 and up. A Pleistocene volcano never gets
 * a buffer, because nothing in the Holocene record says it is active.
 *
 * MERGED WITH THE STENCIL BUFFER, not with geometry. A union of a thousand
 * discs through the boolean engine is a fault this tree has already paid for
 * (concave subjects, chords, slivers), and a union is the wrong product
 * anyway: the reader's question is "which is the WORST hazard reaching this
 * ground", which is a per-pixel minimum over distance. So the zones are drawn
 * innermost first, each fill writes stencil 1 where it paints, and every
 * later fill is refused where the stencil already reads 1. One paint per
 * pixel, highest hazard wins, nothing double-darkens at 50% -- and every
 * disc stays its own feature, so a click still names its volcano.
 */

import { renderFeatureCollection } from "./vector-render.js?v=20260909-a118d3c";
import { layerForDataset } from "./global-data.js?v=20260909-a118d3c";

const search = new URL(import.meta.url).search;

/** Etna Explorer's zones, verbatim: the ranges, the colours, the hazards. */
export const ZONES = [
  { label: "Extreme risk", inner: 0, outer: 5, colour: "#ff1a1a",
    hazards: "ballistics, pyroclastic density currents, lava flows, extreme gas" },
  { label: "Very high risk", inner: 5, outer: 10, colour: "#ff6600",
    hazards: "heavy tephra, PDC run-out along valleys, gas corridors" },
  { label: "High risk", inner: 10, outer: 20, colour: "#ffaa00",
    hazards: "moderate to heavy ash fall, lahars, roof loading, transport disruption" },
  { label: "Moderate risk", inner: 20, outer: 35, colour: "#ddcc00",
    hazards: "light ash fall, reduced air quality and visibility, acid rain" },
  { label: "Low risk", inner: 35, outer: 50, colour: "#44cc66",
    hazards: "trace ash, volcanic aerosol, air quality" },
];

/** The select's values: the lowest `label_rank` admitted, and its words. */
export const AROUND = {
  5: "erupted since 2000",
  4: "erupted since 1900",
  3: "erupted since 1500",
  2: "any dated Holocene eruption",
  1: "every Holocene volcano",
};

const DEG = Math.PI / 180;

/**
 * A GEODESIC CIRCLE, as [lon, lat] points. The destination-point formula on
 * the sphere: exact at every latitude, where a lon/lat ellipse is only right
 * at the equator (the WSM bars' lesson, cos(latitude)).
 */
export function circleRing(lat, lon, km, radiusKm = 6371, n = 64) {
  const d = km / radiusKm;
  const p1 = lat * DEG, l1 = lon * DEG;
  const ring = [];
  for (let i = 0; i < n; i += 1) {
    const b = (i / n) * 2 * Math.PI;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1),
      Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    // CONTINUOUS around the centre, never wrapped here: wrapping a ring that
    // straddles the antimeridian draws a chord across every meridian between.
    let lonOut = l2 / DEG;
    while (lonOut - lon > 180) lonOut -= 360;
    while (lonOut - lon < -180) lonOut += 360;
    ring.push([lonOut, p2 / DEG]);
  }
  ring.push([...ring[0]]);
  return ring;
}

/** Sutherland-Hodgman against one vertical line, keeping the side `keep`. */
function clipLon(ring, x, keep) {
  const inside = (p) => (keep === "west" ? p[0] <= x : p[0] >= x);
  const out = [];
  for (let i = 0; i < ring.length - 1; i += 1) {
    const a = ring[i], b = ring[i + 1];
    const ia = inside(a), ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (x - a[0]) / (b[0] - a[0]);
      out.push([x, a[1] + t * (b[1] - a[1])]);
    }
  }
  if (out.length) out.push([...out[0]]);
  return out;
}

/**
 * A RING THAT CROSSES THE ANTIMERIDIAN IS SPLIT AT IT, into a part on each
 * side, each within +-180. Left whole, the layer's bounds reach past 180.5
 * and `looksLikeGeographic` files it as NOT georeferenced -- the World Stress
 * Map's own fault, which put Iberia in the Atlantic. Returns one ring for the
 * ordinary case.
 */
export function splitAtSeam(ring) {
  const lons = ring.map((p) => p[0]);
  const min = Math.min(...lons), max = Math.max(...lons);
  if (max <= 180 && min >= -180) return [ring];
  if (max > 180) {
    const west = clipLon(ring, 180, "west");
    const east = clipLon(ring, 180, "east").map(([x, y]) => [x - 360, y]);
    return [west, east].filter((r) => r.length > 3);
  }
  const east = clipLon(ring, -180, "east");
  const west = clipLon(ring, -180, "west").map(([x, y]) => [x + 360, y]);
  return [east, west].filter((r) => r.length > 3);
}

/**
 * THE ZONE POLYGONS for one set of volcanoes. An annulus is an outer ring
 * with the inner ring as its hole; zone 0 is a disc. A ring across the seam
 * becomes a MultiPolygon of its two halves (holes are dropped there -- at the
 * seam a hole would need clipping too, and the four rings within 50 km of
 * the antimeridian are not worth the arithmetic; the merge covers them).
 */
export function zonesFor(features, minRank, { radiusKm = 6371, n = 64 } = {}) {
  const admitted = (features || []).filter((f) => {
    const rank = Number(f?.properties?.label_rank);
    const lat = f?.geometry?.coordinates?.[1], lon = f?.geometry?.coordinates?.[0];
    return Number.isFinite(rank) && rank >= minRank && rank > 0
      && Number.isFinite(lat) && Number.isFinite(lon);
  });
  const out = [];
  admitted.forEach((f) => {
    const [lon, lat] = f.geometry.coordinates;
    const name = f.properties?.name || f.properties?.volcano_name || "Volcano";
    ZONES.forEach((zone, z) => {
      const outer = circleRing(lat, lon, zone.outer, radiusKm, n);
      const parts = splitAtSeam(outer);
      const properties = {
        volcano: name, zone: z, zone_label: zone.label,
        inner_km: zone.inner, outer_km: zone.outer, hazards: zone.hazards,
        label_rank: f.properties?.label_rank ?? null,
        last_eruption: f.properties?.last_eruption ?? f.properties?.Last_Eruption_Year ?? null,
      };
      if (parts.length === 1) {
        const rings = [parts[0]];
        if (zone.inner > 0) rings.push(circleRing(lat, lon, zone.inner, radiusKm, n).reverse());
        out.push({ type: "Feature", properties, geometry: { type: "Polygon", coordinates: rings } });
      } else {
        out.push({ type: "Feature", properties,
          geometry: { type: "MultiPolygon", coordinates: parts.map((r) => [r]) } });
      }
    });
  });
  return { features: out, volcanoes: admitted.length };
}

/** What the legend says, one row per zone, in the zones' own colours. */
export function legendFor() {
  return {
    palette: ZONES.map((z) => z.colour.slice(1)),
    labels: ZONES.map((z) => `${z.label} · ${z.inner}–${z.outer} km`),
    label: "Schematic hazard zones around each volcano (INGV bands for Etna)",
    classed: true, categorical: true, unit: null,
  };
}

/* ── the layer ─────────────────────────────────────────────────────────────── */

const LAYER_NAME = "Volcanic hazard buffers";
let three = null;
let current = null;   // { layer, group, rank }
let building = false;

const byId = (id) => document.getElementById(id);
const say = (text) => { const el = byId("volcano-buffers-status"); if (el) el.textContent = text; };
const volcanoLayer = () => layerForDataset("volcanoes");
const chosenRank = () => Number(byId("volcano-buffers-around")?.value) || 4;

/**
 * THE MERGE. Fills are drawn innermost zone first (a fractional `renderLift`,
 * which `applyStack` adds to the band so the order survives a redraw); each
 * fill writes stencil 1 where it paints and is refused where it already reads
 * 1. The per-polygon seal is switched off: at 50% a seam doubled along every
 * disc edge is the alpha-accumulation fault this tree already records, and
 * the merged sheet has no edges to seal.
 */
function armMerge(node, zoneIndex) {
  node.traverse((n) => {
    if (n.userData?.geoidSeam) { n.visible = false; return; }
    if (!n.material) return;
    n.userData.renderLift = zoneIndex * 0.01;
    const m = n.material;
    m.stencilWrite = true;
    m.stencilRef = 1;
    m.stencilFunc = three.NotEqualStencilFunc;
    m.stencilFail = three.KeepStencilOp;
    m.stencilZFail = three.KeepStencilOp;
    m.stencilZPass = three.ReplaceStencilOp;
    m.needsUpdate = true;
  });
}

export async function build({ rank = chosenRank() } = {}) {
  if (building) return null;
  const source = volcanoLayer();
  if (!source?.features?.length) { say("Tick the volcanoes on first."); return null; }
  building = true;
  try {
    if (!three) three = await import("../vendor/three.module.js");
    remove();
    const radiusKm = window.GeoIDViewer?.bodyRadiusKm || 6371;
    const { features, volcanoes } = zonesFor(source.features, rank, { radiusKm });
    if (!features.length) { say("No volcano in that band."); return null; }
    const group = new three.Group();
    group.name = "GeoID-VolcanicHazardBuffers";
    // One draw per ZONE, so each zone is one stencil pass: the zone's discs
    // merge with each other, and zone order decides which zone wins a pixel.
    ZONES.forEach((zone, z) => {
      const fc = { type: "FeatureCollection", features: features.filter((f) => f.properties.zone === z) };
      if (!fc.features.length) return;
      const made = renderFeatureCollection(fc, { colourFor: () => zone.colour, outlineOnly: false });
      const node = made?.object3D || made;
      armMerge(node, z);
      group.add(node);
    });
    const layer = window.GeoIDImportManager?.addDerivedLayer?.(LAYER_NAME, {
      object3D: group,
      georeferenced: true,
      bounds: { minX: -180, minY: -90, maxX: 180, maxY: 90 },
      features,
      collection: { type: "FeatureCollection", features },
      legendInfo: legendFor(),
      // Half strength by request, and by the area rule: a filled sheet is
      // read against the ground it covers.
      opacity: 0.5,
      home: "volcanic-hazards",
      metadata: {
        source: "Schematic zones after INGV's Etna hazard bands, as drawn in "
          + "Etna Explorer; volcano positions and eruption recency from the "
          + "Smithsonian Global Volcanism Program",
        dataType: "model",
        description: "Five fixed-radius zones around each volcano, merged where they "
          + "overlap. Not a hazard map: real extents depend on eruption style, "
          + "vent, wind and topography.",
      },
    }, "derived");
    current = { layer, group, rank };
    say(`${ZONES.length} zones around ${volcanoes.toLocaleString()} volcanoes `
      + `(${AROUND[rank]}), merged where they meet.`);
    const box = byId("volcano-buffers-on");
    if (box) box.checked = true;
    return layer;
  } finally {
    building = false;
  }
}

export function remove() {
  if (!current) return;
  const { layer, group } = current;
  current = null;
  if (layer) window.GeoIDImportManager?.removeLayer?.(layer.id);
  group?.traverse?.((n) => { n.geometry?.dispose?.(); n.material?.dispose?.(); });
  group?.parent?.remove(group);
  say("");
  const box = byId("volcano-buffers-on");
  if (box) box.checked = false;
}

export const layerOf = () => current?.layer || null;

/**
 * WIRED BY DELEGATION: the block is page markup the catalogue docks under the
 * volcano row and parks again, so a handler bound to its nodes goes stale.
 * The buffers follow the volcanoes: when that layer leaves the globe they go
 * with it, because a buffer round a volcano that is no longer drawn is a
 * claim with nothing under it.
 */
if (typeof window !== "undefined") {
  document.addEventListener("change", (event) => {
    const id = event.target?.id;
    if (id === "volcano-buffers-on") {
      if (event.target.checked) void build(); else remove();
    } else if (id === "volcano-buffers-around" && current) {
      void build({ rank: chosenRank() });
    }
  });
  /**
   * THE IMPORT MANAGER ANNOUNCES THROUGH `onChange`, NOT THE DOM EVENT.
   * `geoid-gis:layers-changed` is what the symbology and the hierarchy
   * dispatch; a layer REMOVED through the catalogue never fires it. Measured:
   * unticking the volcanoes from the Geology row cleared both rows and parked
   * the block, and the buffers stayed on the globe round volcanoes no longer
   * drawn. The manager's own listener list is the seam every catalogue uses.
   */
  const follow = () => {
    if (current && !volcanoLayer()) remove();
    // The buffers' own Workspace row removed: forget them rather than hold a
    // handle to a layer that is gone.
    if (current && !window.GeoIDImportManager?.getLayers?.().some((l) => l === current.layer)) {
      current = null; say(""); const box = byId("volcano-buffers-on"); if (box) box.checked = false;
    }
  };
  window.addEventListener("geoid-gis:layers-changed", follow);
  // The manager may not exist yet at module load; a bounded retry, not a poll.
  let tries = 0;
  const subscribe = () => {
    const im = window.GeoIDImportManager;
    if (im?.onChange) { im.onChange(follow); return; }
    if (tries++ < 120) setTimeout(subscribe, 250);
  };
  subscribe();
  window.GeoIDVolcanicHazards = { build, remove, layerOf, zonesFor, circleRing, splitAtSeam, ZONES, AROUND };
}
