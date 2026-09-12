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

import { renderFeatureCollection } from "./vector-render.js?v=20260912-7310b6e";
import { layerForDataset } from "./global-data.js?v=20260912-7310b6e";

const search = new URL(import.meta.url).search;

/** Etna Explorer's zones, verbatim: the ranges, the colours, the hazards. */
export const ZONES = [
  { label: "Extreme Risk", inner: 0, outer: 5, colour: "#ff1a1a",
    // The legend's own words in Etna Explorer, and its hazard list and detail
    // paragraph verbatim -- the test reads them back out of etna-viewer.js.
    hazards: "Ballistics, PDCs, lava flows",
    hazardList: [
      "Ballistic projectiles — blocks and bombs > 30 cm",
      "Pyroclastic density currents (PDCs)",
      "Lava flow inundation",
      "Extreme volcanic gas concentrations (SO₂, HCl, H₂S, CO₂)",
      "Ground deformation and structural collapse",
      "Phreatic explosions without warning",
    ],
    detail: "The primary exclusion zone during any eruptive or unrest phase. Ballistics from lava fountains and Strombolian explosions can be ejected over 1 km from active vents. Pyroclastic density currents — fast-moving avalanches of hot gas and rock — regularly travel 3–5 km down Etna's flanks during paroxysmal episodes. Emergency evacuation is mandatory when eruptive activity intensifies." },
  { label: "Very High Risk", inner: 5, outer: 10, colour: "#ff6600",
    hazards: "Heavy tephra, PDC run-out",
    hazardList: [
      "Heavy tephra and scoria fall (5–20 cm depth in major events)",
      "Smaller ballistic ejecta during explosive episodes",
      "PDC run-out into deep valleys (Valle del Bove)",
      "Volcanic gas corridors concentrated along valleys",
      "Acid rain and aerosol deposition",
      "Infrastructure damage from lava flows on active fissures",
    ],
    detail: "Encompasses Etna's upper flanks, including Rifugio Sapienza and Piano Provenzana ski station — both were partially destroyed by lava flows in 2001 and 2002. During major paroxysms, heavy tephra fall can begin within minutes. The Valle del Bove depression channels lava flows and occasional PDC overflow toward the inhabited eastern coast." },
  { label: "High Risk", inner: 10, outer: 20, colour: "#ffaa00",
    hazards: "Ash fall, lahars, airport closures",
    hazardList: [
      "Moderate–heavy ash fall (1–5 cm depth)",
      "Roof loading and structural stress from prolonged tephra",
      "Volcanic gas and acid rain affecting crops and water",
      "Lahar risk along river valleys after heavy rainfall",
      "Airport and road transport disruption",
    ],
    detail: "Towns including Nicolosi, Zafferana Etnea, Linguaglossa, and Randazzo fall within this band. Ash deposits of 1–5 cm damage crops, contaminate water supplies, and stress building roofs. Catania International Airport (25 km south) regularly suspends operations during major eruptive episodes due to ash ingestion risk in aircraft engines." },
  { label: "Moderate Risk", inner: 20, outer: 35, colour: "#ddcc00",
    hazards: "Light ash, acid rain, visibility",
    hazardList: [
      "Light–moderate ash fall (millimetres to 1 cm)",
      "Reduced air quality and visibility",
      "Vehicle and machinery damage from fine ash",
      "Acid rain affecting vegetation and open water sources",
      "Near-field aviation hazard from dispersing ash cloud",
    ],
    detail: "Catania city centre and coastal towns are regularly affected by ash fall during sustained eruptive episodes. Even a few millimetres of ash disrupts road transport, irritates respiratory systems, and contaminates open water. The volcanic ash cloud can extend hundreds of kilometres downwind — this zone captures the near-field deposition footprint." },
  { label: "Low Risk", inner: 35, outer: 50, colour: "#44cc66",
    hazards: "Trace ash, aerosol, air quality",
    hazardList: [
      "Trace ash fall and volcanic dust (< 1 mm)",
      "Volcanic aerosol, SO₂ odour, and fine particulates (PM₂.₅)",
      "Reduced air quality for sensitive individuals",
      "Potential disruption to coastal marine traffic",
    ],
    detail: "At this distance the primary hazards are trace ash fall during prolonged eruptions and volcanic aerosols that may temporarily affect air quality. Messina (~40 km NE), southern Calabria, and the Aeolian Islands can experience these effects when winds blow northeastward. No life-threatening hazard is expected here under normal eruptive scenarios." },
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
/** The area of a spherical cap of radius `km` on the ground, exactly. */
export const capAreaKm2 = (km, radiusKm = 6371) =>
  2 * Math.PI * radiusKm * radiusKm * (1 - Math.cos(km / radiusKm));

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
        // THE ANNULUS'S OWN AREA, exact. The generic area on the card is the
        // outer ring's alone -- it ignores the hole -- so the 10-20 km band
        // read 1,255 km² (π·20²) where the ground in it is 942. Written here
        // rather than derived from a 64-gon, and the same whether or not the
        // ring was split at the seam.
        area_km2: Number((capAreaKm2(zone.outer, radiusKm) - capAreaKm2(zone.inner, radiusKm)).toFixed(1)),
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
  /**
   * INNERMOST FIRST, so the PICKER agrees with the PAINTER. The sheet paints
   * the worst hazard reaching a pixel; `featuresAt` returns the first
   * containing polygon in this array, so left in build order a click 15 km
   * from one volcano inside another's 35-50 km band could name the far one's
   * mild band over the near one's severe one -- a card disagreeing with the
   * colour under the cursor. The rule this tree already records for surveys.
   */
  out.sort((a, b) => a.properties.zone - b.properties.zone);
  return {
    features: out, volcanoes: admitted.length,
    centres: admitted.map((f) => ({ name: f.properties?.name || f.properties?.volcano_name || "Volcano",
      lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] })),
  };
}

/**
 * WHICH VOLCANOES' ZONES CAN TOUCH. Two volcanoes closer than the sum of
 * their outer radii (twice the widest band) overlap somewhere, and overlap is
 * transitive through a chain -- the Aeolian arc is one merged shape, not
 * seven. Union-find over the admitted volcanoes, answering for each volcano
 * the set of volcanoes in its group. What the merged HIGHLIGHT lights.
 */
export function mergedGroups(volcanoes, reachKm = 2 * ZONES[ZONES.length - 1].outer, radiusKm = 6371) {
  const parent = volcanoes.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const d = Math.PI / 180;
  const km = (a, b) => {
    const dLat = (b.lat - a.lat) * d, dLon = (b.lon - a.lon) * d;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * d) * Math.cos(b.lat * d) * Math.sin(dLon / 2) ** 2;
    return 2 * radiusKm * Math.asin(Math.sqrt(Math.min(1, h)));
  };
  // A latitude-sorted sweep keeps this from being 1,214² haversines.
  const order = volcanoes.map((v, i) => i).sort((a, b) => volcanoes[a].lat - volcanoes[b].lat);
  const latReach = (reachKm / radiusKm) / d;
  for (let x = 0; x < order.length; x += 1) {
    for (let y = x + 1; y < order.length; y += 1) {
      const a = volcanoes[order[x]], b = volcanoes[order[y]];
      if (b.lat - a.lat > latReach) break;
      if (km(a, b) <= reachKm) parent[find(order[x])] = find(order[y]);
    }
  }
  const groups = new Map();
  volcanoes.forEach((v, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, new Set());
    groups.get(root).add(v.name);
  });
  const of = new Map();
  volcanoes.forEach((v, i) => of.set(v.name, groups.get(find(i))));
  return of;
}

/** What the legend says, one row per zone, in the zones' own colours. */
export function legendFor() {
  return {
    palette: ZONES.map((z) => z.colour.slice(1)),
    // The row says WHAT the band is, not only how far: "10-20 km" is the
    // arithmetic, "ash fall, lahars" is what a reader is looking for.
    labels: ZONES.map((z) => `${z.label} · ${z.inner}–${z.outer} km · ${z.hazards}`),
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
// EVERY HOLOCENE VOLCANO BY DEFAULT. The Smithsonian's own working
// definition of "potentially active" is a Holocene eruption; a hazard map
// that buffered only the ones erupting since 1900 left Ilopango -- VEI 6 in
// the fifth century -- with no zone at all, and was read as those volcanoes
// being inactive. The narrower bands stay on the select for a reader who
// wants only the recently restless.
const chosenRank = () => Number(byId("volcano-buffers-around")?.value) || 1;

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
    const { features, volcanoes, centres } = zonesFor(source.features, rank, { radiusKm });
    const groups = mergedGroups(centres, undefined, radiusKm);
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
    /**
     * THE HIGHLIGHT IS THE MERGED SHAPE, not the circle underneath it.
     *
     * The generic hover outlines the picked polygon -- for an annulus, two
     * circles -- which cuts straight across the neighbours it has merged
     * with and shows the circular structure the merge was there to remove.
     * So the layer supplies its own: the SAME zone for every volcano in the
     * picked one's group, as fills, painted once through a second stencil
     * ref, so the lit shape has only the merged region's outer boundary.
     * Leaf meshes rather than a group, because the popup's pulse animates
     * the opacity of what it is handed.
     */
    if (layer) {
      layer.highlightFor = (feature, { colour, opacity = 0.5 } = {}) => {
        const picked = Number(feature?.properties?.zone);
        const names = groups.get(feature?.properties?.volcano) || new Set([feature?.properties?.volcano]);
        const ours = features.filter((f) => names.has(f.properties.volcano));
        const same = ours.filter((f) => f.properties.zone === picked);
        if (!same.length) return null;
        const css = typeof colour === "number" ? `#${colour.toString(16).padStart(6, "0")}` : (colour || "#ffffff");
        const leaves = [];
        const collect = (fc, arm) => {
          const made = renderFeatureCollection(fc, { colourFor: () => css, outlineOnly: false, fillOpacity: opacity });
          const node = made?.object3D || made;
          node.traverse((n) => {
            if (n.userData?.geoidSeam) { n.visible = false; return; }
            if (!n.material) return;
            arm(n.material); n.material.needsUpdate = true;
            n.userData.keepRenderOrder = true; n.frustumCulled = false;
            leaves.push(n);
          });
        };
        /**
         * THE WORSE ZONES CLAIM THEIR PIXELS FIRST, colourlessly. The union of
         * one zone's annuli covers ground the sheet draws in a NEIGHBOUR'S
         * severer band -- Vulcano's 20-35 km ring runs over Lipari's core --
         * and lit whole it showed those bands through as crescents, which is
         * the circular structure back again. So the group's zones below the
         * picked one are drawn first with colour off, writing stencil 2 where
         * they cover, and the zone fill is refused there. What lights is
         * exactly the ground the sheet paints in that zone, merged.
         */
        const worse = ours.filter((f) => f.properties.zone < picked);
        if (worse.length) {
          collect({ type: "FeatureCollection", features: worse }, (m) => {
            /**
             * TRANSPARENT, or it draws in the WRONG PASS. Opaque, the mask
             * ran in the opaque pass -- before the base sheet's transparent
             * pass -- and the sheet then overwrote its stencil 2 with its own
             * 1 everywhere it painted, so by the time the fill arrived
             * nothing was masked: the highlight covered every inner zone of
             * the group. Measured as red bow-ties left where the base had not
             * painted and pale highlight over everything else. In the
             * transparent pass at 239 it draws after the sheet (51.xx) and
             * before the fill (239.5), which is the only order that works.
             * Colour off, so its opacity is moot.
             */
            m.colorWrite = false; m.transparent = true; m.opacity = 0;
            m.depthTest = false; m.depthWrite = false;
            m.stencilWrite = true; m.stencilRef = 2; m.stencilFunc = three.AlwaysStencilFunc;
            m.stencilFail = three.ReplaceStencilOp; m.stencilZFail = three.ReplaceStencilOp;
            m.stencilZPass = three.ReplaceStencilOp;
          });
          leaves.forEach((n) => { n.renderOrder = 239; });
        }
        collect({ type: "FeatureCollection", features: same }, (m) => {
          m.transparent = true; m.opacity = opacity; m.depthTest = false; m.depthWrite = false;
          m.stencilWrite = true; m.stencilRef = 2; m.stencilFunc = three.NotEqualStencilFunc;
          m.stencilFail = three.KeepStencilOp; m.stencilZFail = three.KeepStencilOp;
          m.stencilZPass = three.ReplaceStencilOp;
        });
        leaves.forEach((n) => { if (n.material.colorWrite !== false) n.renderOrder = 239.5; });
        return leaves;
      };
    }
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
// Guarded on the LISTENER, not merely on `window`: the popup test stubs a
// bare `window` with no event methods, and a module that throws at import
// takes every test importing feature-popup.js down with it.
if (typeof window !== "undefined" && typeof window.addEventListener === "function"
  && typeof document !== "undefined" && typeof document.addEventListener === "function") {
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
    // `unref`, or the retry keeps a headless test process alive for thirty
    // seconds after its work is done -- the same poll trap `registerDrape`
    // records. A browser timer is a number and ignores it.
    if (tries++ < 120) setTimeout(subscribe, 250)?.unref?.();
  };
  subscribe();
  window.GeoIDVolcanicHazards = { build, remove, layerOf, zonesFor, circleRing, splitAtSeam, mergedGroups, ZONES, AROUND };
}
