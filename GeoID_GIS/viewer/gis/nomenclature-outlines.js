/**
 * Explorer ▸ Locations ▸ Feature outlines (IAU): the named features' OUTLINES
 * on the planet viewers AND on the moons they open, beside -- not inside --
 * the label list above them.
 *
 * The labels on these worlds are the IAU Gazetteer of Planetary Nomenclature's
 * centre points. The same gazetteer draws each named feature's extent: a
 * crater's rim, a planitia's reach, a rupes as a line. bake-nomenclature.py
 * turns them into one GeoJSON per world, published to the data bucket.
 *
 * ONE TICK, OFF WHEN THE PAGE OPENS. The Moon's is 9,060 outlines, and the
 * label list above it is how most people read these worlds; the outlines are
 * a layer somebody asks for.
 *
 * AND ONCE ON IT IS AN ORDINARY LAYER. It goes in through the importer a
 * dropped file uses, so it has a Workspace row, an eye, opacity, draw order,
 * symbology and export, the click card and its highlight, and it is drawn on
 * the relief the way every imported vector is: fills at the ground, following
 * the terrain. The tick is read back off the layer, never remembered here --
 * removing the row in the Workspace unticks it.
 *
 * Earth is not here: its names are its own gazetteer, not the IAU's. Every
 * other world with a surface is, MARS INCLUDED -- this file said for a while
 * that the IAU publishes no Mars outlines, and the bucket holds 1,720 polygons
 * and 203 lines for it. The gas giants have no surface to draw one on; what
 * they have instead is MOONS, and the moons have outlines.
 *
 * ── A MOON IS ANOTHER BODY, AND ITS OUTLINES ARE NOT ON THIS PLANET ─────────
 *
 * The same rule this tree already keeps for a drawn shape: a coordinate means
 * nothing off the body it was taken on. So a moon's outlines are
 *
 *   - RENDERED FLAT (`flat: true`), on a plain sphere of the globe's radius.
 *     This world's terrain and its exaggeration say nothing about a moon, and
 *     a layer built on them would breathe with the planet's relief slider.
 *   - REPARENTED under the moon's own mesh, through one holder whose matrix is
 *     the rotation taking the importer's frame to the mesh's, times the scale
 *     taking 3.2 to the moon's radius. That rotation is FITTED to the moon's
 *     own feature markers rather than derived from a convention -- see
 *     `fitEastToMesh`, and the seven moons that convention got backwards. The mesh carries the moon's orbit and
 *     its tidal-locked spin, so the outlines turn with the ground they trace
 *     rather than being re-placed every frame.
 *   - PICKED BY THEIR OWN HANDLER (`groundPick: false`). `featuresAt` tests a
 *     lat/lon against every visible vector layer, and a moon layer's
 *     coordinates are the MOON's -- left in, a click on the planet would open
 *     a crater on Io. The satellites' own seam, for the same reason.
 */
import * as THREE from "../vendor/three.module.js";
import { dataUrl } from "./data-base.js?v=20260920-84ebb99";
import { currentBodyId, getBody } from "./bodies.js?v=20260920-84ebb99";
import { latLonToVector3 } from "./geo-utils.js?v=20260920-84ebb99";
import { pointInPolygon } from "./geometry.js?v=20260920-84ebb99";
import { paintByField } from "./symbology-dialog.js?v=20260920-84ebb99";

export const OUTLINE_BODIES = {
  moon: { path: "/data/global/nomenclature/moon.geojson", name: "Moon" },
  mars: { path: "/data/global/nomenclature/mars.geojson", name: "Mars" },
  mercury: { path: "/data/global/nomenclature/mercury.geojson", name: "Mercury" },
  pluto: { path: "/data/global/nomenclature/pluto.geojson", name: "Pluto" },
};

/**
 * THE WORLDS WITH NO ROW, AND THE COUNT THAT DECIDED EACH ONE.
 *
 * The gazetteer publishes two kinds of polygon under one name: a digitised
 * OUTLINE, and the feature's BOUNDING BOX -- a five-point axis-aligned
 * rectangle round it. A box drawn is a claim about a shape nobody drew, and
 * unfilled it makes the claim more quietly and still makes it.
 *
 * So a body is offered when the gazetteer outlined MOST of it, and withheld
 * when most of what it publishes for that body is boxes. Counted from the
 * baked files as boxes/features, the split falls in a real gap rather than on
 * a number somebody picked -- 1.5%, then 36.5%, then 52.2%:
 *
 *   OFFERED   moon 0/9060      mars 0/1923     mercury 0/581   io 0/254
 *             pluto 0/71       charon 0/15     triton 0/2
 *             ganymede 3/196   enceladus 31/85
 *   WITHHELD  titan 145/278    callisto 90/154 iapetus 20/30   europa 96/114
 *             rhea 40/44       venus 385/414   ariel 24/25     mimas 40/41
 *             dione 96/98      tethys 53/53    phobos 20/20    umbriel 11/11
 *             titania 16/16    miranda 13/13   oberon 8/8      hyperion 1/1
 *
 * WHAT THIS COSTS IS REAL: Titan's 133 digitised outlines go with its 145
 * boxes, Callisto's 64, Venus's 29. A body cannot offer half a map without the
 * reader having to know which half they are looking at. The files are
 * unchanged -- a key moved out of this set brings its row back.
 *
 * The MINORITY boxes on the two mixed bodies are not drawn either: the guard
 * on `withoutExtents` removes Ganymede's 3 and Enceladus's 31 before the
 * importer sees them, so no box reaches the globe on any world.
 */
export const BOX_ONLY = new Set([
  "venus", "europa", "callisto", "titan", "iapetus", "phobos",
  "mimas", "tethys", "dione", "rhea", "hyperion",
  "miranda", "ariel", "umbriel", "titania", "oberon",
]);

/**
 * EVERY MOON THE GAZETTEER HAS DRAWN AN OUTLINE FOR, which is a fact about the
 * bucket rather than a choice. The nine others these viewers open -- Deimos,
 * Phoebe, Janus, Epimetheus, Puck, Proteus, Nix, Amalthea, Thebe -- have a
 * `_geometries.kmz` and no shapefile, and every placemark in it is a POINT: 2
 * for Deimos, 25 for Phoebe, not one polygon or line between them. There is
 * nothing to fetch for those, and a row offering them would be a tick that can
 * only fail.
 */
export const OUTLINE_MOONS = {
  charon: "Charon",
  io: "Io", ganymede: "Ganymede",
  enceladus: "Enceladus",
  triton: "Triton",
};

/**
 * The worlds that open a moon in a moon viewer. A gas giant has no surface of
 * its own to outline and is here for its moons alone.
 *
 * URANUS IS GONE and MARS NO LONGER FOLLOWS ITS MOONS, because every moon they
 * host is boxes -- Miranda, Ariel, Umbriel, Titania and Oberon; Phobos, whose
 * 20 features are 20 boxes. Mars keeps its row for the PLANET, whose 1,923
 * features carry none. Saturn stays for Enceladus alone: Mimas, Tethys, Dione,
 * Rhea, Titan, Hyperion and Iapetus are all withheld.
 */
export const MOON_HOSTS = new Set(["pluto", "jupiter", "saturn", "neptune"]);

/**
 * THE GAZETTEER DRAWS TWO KINDS OF POLYGON AND CALLS THEM ONE THING.
 *
 * Most are digitised outlines. Many are the feature's BOUNDING BOX instead --
 * a five-point axis-aligned rectangle -- and the file says which
 * (`bake-nomenclature.py`, `is_extent`). Measured at the bake: Venus 373 of
 * 414, Mimas 93%, Tethys 96%, Dione 95%, Titania and Oberon 100%; the Moon,
 * Mars, Mercury, Io, Pluto, Charon and Triton have none at all.
 *
 * It matters because a FILLED rectangle claims to be the feature's shape.
 * Aphrodite Terra's box is 166 degrees wide; painted solid over the imagery
 * it reads as a map of Aphrodite Terra, and it is a map of the smallest box
 * that holds it. So an extent is drawn unfilled and its card says so.
 */
const boxRing = (ring) => {
  if (!Array.isArray(ring) || ring.length !== 5) return false;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const c of ring) {
    if (!Array.isArray(c)) return false;
    x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0]);
    y0 = Math.min(y0, c[1]); y1 = Math.max(y1, c[1]);
  }
  if (x0 === x1 || y0 === y1) return false;   // a degenerate sliver is not a box
  return ring.every(([x, y]) => (x === x0 || x === x1) && (y === y0 || y === y1));
};

/**
 * A FEATURE WHOSE EVERY PART IS AN AXIS-ALIGNED RECTANGLE, read off the
 * geometry rather than off the flag.
 *
 * The bake sets `extent` and MISSES the ones it cut: `to_signed` splits a ring
 * at 180, so a box across the antimeridian arrives as a two-part MultiPolygon
 * and `is_extent` refuses it for having more than one part. Measured on the
 * shipped files -- 12 of Venus's, 26 of Europa's, 7 of Phobos's 20, 4 of
 * Enceladus's -- and every one of them was drawn FILLED, which is what "they
 * are still blocky rectangles" was.
 *
 * Judging the geometry needs no re-bake and cannot be missed the same way: a
 * box cut into two boxes is still two boxes.
 */
export const isBoxGeometry = (geometry) => {
  const parts = geometry?.type === "Polygon" ? [geometry.coordinates]
    : geometry?.type === "MultiPolygon" ? geometry.coordinates : null;
  if (!parts || !parts.length) return false;
  return parts.every((rings) => boxRing(rings?.[0]));
};

export const isExtent = (feature) =>
  feature?.properties?.extent === true || isBoxGeometry(feature?.geometry);

/**
 * What a layer HOLDS, said before anybody clicks a feature to find out. On a
 * world that is mostly boxes, "414 named features outlined" is the sentence a
 * reader would otherwise take away, and it would be wrong about 373 of them.
 */
export function outlineSummary(features, hidden = 0) {
  const drawn = (features || []).length;
  const boxes = (features || []).filter(isExtent).length;
  const n = drawn.toLocaleString();
  const held = Number(hidden) || 0;
  const h = held.toLocaleString();
  // EVERY named feature on this body is a box (Titania, Oberon, Hyperion), so
  // hiding them draws nothing. Saying "0 features" would read as a failed
  // fetch; what is true is that the gazetteer has outlined none of them.
  if (held && !drawn) {
    return `The gazetteer has outlined none of this body's ${h} named features -- every one is `
      + "its BOUNDING BOX, so none is drawn";
  }
  if (held) {
    return `${n} outlined features. ${h} more are the gazetteer's BOUNDING BOX rather than an `
      + "outline and are not drawn";
  }
  if (!boxes) return `${n} named features outlined`;
  return `${n} named features, ${boxes.toLocaleString()} of them the gazetteer's `
    + "EXTENT (the box around the feature) rather than an outline -- those are drawn unfilled";
}

/**
 * THE BOXES ARE HELD BACK BY DEFAULT, and that is a decision about what the
 * map CLAIMS rather than about tidiness.
 *
 * Measured across the 25 baked bodies, the gazetteer splits in two: the Moon,
 * Mars, Mercury, Io, Pluto, Charon and Triton are digitised outlines with no
 * box among them, and eighteen others are mostly or entirely boxes -- Venus
 * 373 of 414, Dione 95%, Tethys 96%, Titania and Oberon every one. Drawn, a
 * box says "this is the shape of the feature" in the one language a map has,
 * and it is the shape of the smallest rectangle that holds it: Aphrodite
 * Terra's is 166 degrees wide. Unfilled it says it more quietly and still
 * says it.
 *
 * So a body's outlines are the features somebody actually drew, and the boxes
 * are one tick away with the count in front of it. Nothing is invented and
 * nothing is lost -- the file is unchanged and the tick draws all of it.
 */
export function withoutExtents(fc) {
  const features = (fc?.features || []).filter((f) => !isExtent(f));
  return { ...(fc || {}), type: "FeatureCollection", features };
}

/**
 * A GUARD, not a mode. No body that still offers a row carries a box, so on
 * today's files this filter never removes anything -- `BOX_ONLY` is what keeps
 * the boxes off the globe, by not offering their body at all.
 *
 * It stays because the FILE can change under us: the gazetteer revises these
 * products, and a Mars re-issue that swapped an outline for a box would
 * otherwise be drawn as Mars's shape without anybody pressing anything. If it
 * ever fires, the status line says how many it held back.
 *
 * There is deliberately no tick to draw them: a control that can do nothing on
 * every body that offers it is worse than no control.
 */

export const layerNameFor = (body) => `Named feature outlines — ${OUTLINE_BODIES[body]?.name || body} (IAU)`;
export const moonLayerNameFor = (key) => `Named feature outlines — ${OUTLINE_MOONS[key] || key} (IAU)`;
const moonPath = (key) => `/data/global/nomenclature/${key}.geojson`;
const CREDIT = "IAU Gazetteer of Planetary Nomenclature, USGS Astrogeology Science Center (public domain)";

const byId = (id) => document.getElementById(id);
const layers = () => window.GeoIDImportManager?.getLayers?.() || [];
const namedLayer = (name) => layers().find((l) => l.name === name) || null;

function layerOf(body) {
  return namedLayer(layerNameFor(body));
}

/**
 * A WEST-POSITIVE WORLD READS A LONGITUDE THE OTHER WAY. The file is the
 * gazetteer's east longitudes; Mercury's viewer places a coordinate by its
 * west longitude, as its own labels are stored. Measured before this, every
 * Mercury outline stood about 100° from its label (Beethoven 101°); with the
 * longitude negated the outline and the label land on the same point.
 */
export const isWestPositive = (body) => /^west/.test(getBody(body)?.lonConvention || "");

export function toWestPositive(fc) {
  const flip = (c) => (typeof c[0] === "number" ? [c[0] === 0 ? 0 : -c[0], c[1]] : c.map(flip));
  return { ...fc, features: fc.features.map((f) => (f.geometry
    ? { ...f, geometry: { ...f.geometry, coordinates: flip(f.geometry.coordinates) } } : f)) };
}

/**
 * The item the viewer's own card reads, for a feature it does not already
 * label (where it does, the viewer opens its own entry by name). Longitude as
 * the viewer's labels store it: 0-360, west on a west-positive world -- which
 * is what the layer's coordinates already are there, since they were negated.
 */
/**
 * The centre of a feature's bounding box: latitude signed, longitude 0-360 as
 * the viewers store one. Used BOTH for the card's coordinates and for matching
 * an outline against the marker the viewer drew for the same feature, so the
 * two cannot disagree about where a named feature is.
 */
export function bboxCentre(geometry) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === "number") {
      minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]);
      minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]);
    } else c.forEach(walk);
  };
  if (geometry?.coordinates) walk(geometry.coordinates);
  if (!Number.isFinite(minX)) return null;
  // a feature cut at 180 spans the whole range: its centre is across the seam
  const lon = (maxX - minX > 180) ? 180 : (minX + maxX) / 2;
  return { lat: (minY + maxY) / 2, lon: ((lon % 360) + 360) % 360 };
}

export function sceneItem(feature, extra = null) {
  const p = feature?.properties || {};
  if (!p.name) return null;
  const c = bboxCentre(feature.geometry);
  if (!c) return null;
  const bits = [];
  // FIRST, because it qualifies every other number on the card: a diameter
  // read off a bounding box is the box's, not the feature's.
  if (p.extent) {
    bits.push("The gazetteer publishes this feature's EXTENT -- the box around it -- rather than a digitised outline, so the shape drawn is a bounding box.");
  }
  if (p.origin) bits.push(`Named for ${String(p.origin).replace(/\.$/, "")}.`);
  if (p.diameter_km) bits.push(`About ${Math.round(p.diameter_km).toLocaleString()} km across.`);
  if (p.approved) bits.push(`Name approved by the IAU in ${p.approved}.`);
  return {
    name: p.name, type: String(p.type || "").split(",")[0] || "Named feature",
    lat: +c.lat.toFixed(2), lon: +c.lon.toFixed(2),
    description: bits.join(" "), theme: "standard",
    ...(extra || {}),
  };
}

/* ── The moon's frame ──────────────────────────────────────────────────── */

const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
const wrap360 = (d) => ((d % 360) + 360) % 360;

/**
 * A direction in the MOON MESH's own local frame.
 *
 * The inverse of the `atan2(z, -x)` every viewer reads a moon longitude back
 * with, and the same expression `moonMeshWorldPoint` builds a measure point
 * from -- so a point placed by this and one placed by the viewer's own measure
 * code are the same point, rather than two derivations that agree today.
 */
export function meshDir(latDeg, meshLonDeg) {
  const la = (latDeg * Math.PI) / 180;
  const lo = (meshLonDeg * Math.PI) / 180;
  const c = Math.cos(la);
  return { x: -c * Math.cos(lo), y: Math.sin(la), z: c * Math.sin(lo) };
}

/**
 * THE VIEWER'S OWN °W RULE, READ BACKWARDS.
 *
 * Each moon-hosting viewer FITS `flightMoonLonRule` from that moon's own
 * feature markers -- `W = wrap360(sgn·meshLon + b)`, kept only when it holds
 * to under a degree -- and the flight HUD reads its longitude through it.
 * Inverting that rule rather than deriving a second one is what makes an
 * outline, a marker and the HUD agree by construction; the first-guess rules
 * this tree tried by hand were up to 180° out on three of these worlds.
 *
 * Two probes are enough because the rule is affine with |slope| 1: `w0` is the
 * offset and the sign of `wrap180(w90 - w0)` is the handedness.
 */
export function eastToMeshLon(rule) {
  if (typeof rule !== "function") return null;
  const at = (m) => Number(rule(m)?.value);
  const w0 = at(0);
  const w90 = at(90);
  if (!Number.isFinite(w0) || !Number.isFinite(w90)) return null;
  const sgn = wrap180(w90 - w0) > 0 ? 1 : -1;
  // the gazetteer is east-positive; the rule speaks west
  return (east) => sgn * (wrap360(-east) - w0);
}

/**
 * THE PAIRS AN OUTLINE AND ITS OWN MARKER MAKE: the gazetteer's east longitude
 * for a named feature, against the mesh longitude the viewer drew that feature
 * at. Matched by NAME, which is the one thing both sides certainly agree on.
 *
 * Read with the same `atan2(z, -x)` in the moon mesh's own local frame that
 * `flightMoonLonRule` reads a marker with, so a pair is the viewer's own
 * placement rather than a second derivation of it.
 */
export function markerPairs(scene, moonName, features, mesh) {
  if (!scene?.traverse || !mesh?.worldToLocal) return [];
  const exact = new Map();
  const bare = new Map();
  for (const f of features || []) {
    const name = f?.properties?.name;
    const c = bboxCentre(f?.geometry);
    if (!name || !c) continue;
    exact.set(nameKey(name), c);
    const k = bareKey(name);
    // a stripped name that two features share cannot identify either of them
    bare.set(k, bare.has(k) ? null : c);
  }
  const pairs = [];
  const seen = new Set();
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    // the label sprite sits beside its feature; the marker sits on it
    if (o.isSprite) return;
    const f = o.userData?.feature;
    if (!f || f.moon_name !== moonName || !f.name) return;
    const key = nameKey(f.name);
    if (seen.has(key)) return;
    const c = exact.get(key) || bare.get(bareKey(f.name));
    if (!c) return;
    const q = mesh.worldToLocal(o.getWorldPosition(v)).normalize();
    if (!Number.isFinite(q.x) || !Number.isFinite(q.z)) return;
    seen.add(key);
    pairs.push({ name: f.name, east: c.lon, lat: c.lat,
      meshLon: (Math.atan2(q.z, -q.x) * 180) / Math.PI });
  });
  return pairs;
}

const nameKey = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();
/**
 * A marker is named "Stickney Crater" where the gazetteer says "Stickney": the
 * viewers append the feature TYPE, which the gazetteer keeps in a column of its
 * own. Both sides are stripped the same way, so a name that really ends in its
 * term ("Messina Chasmata") still matches itself.
 */
const bareKey = (s) => nameKey(s).replace(
  / (crater|craters|catena|catenae|chasma|chasmata|dorsum|dorsa|fossa|fossae|labyrinthus|linea|lineae|macula|maculae|mensa|mensae|mons|montes|patera|paterae|planitia|planum|regio|regiones|rupes|sulcus|sulci|terra|tholus|vallis|valles|corona|coronae|fluctus|flexus|planum)$/,
  "");

/**
 * THE MAPPING FROM THE GAZETTEER'S EAST LONGITUDE TO THIS MOON'S MESH, FITTED
 * FROM THE MARKERS RATHER THAN ASSUMED.
 *
 * `eastToMeshLon` above inverts the viewer's own °W rule, which is right only
 * where that rule really does report a WEST longitude. MEASURED AGAINST THE
 * VIEWERS' OWN MARKERS, IT DOES ON THIRTEEN OF THESE TWENTY MOONS AND NOT ON
 * SEVEN, two ways:
 *
 *   - Miranda, Ariel, Umbriel, Titania and Oberon are in the Uranus viewer's
 *     `MARS_STYLE_MOONS`, which passes a stored longitude through as west --
 *     and theirs are stored EAST (Ariel's Abans is 251.3 in both the viewer
 *     and the gazetteer). Triton is the same through `TEXTURE_CENTERED_MOONS`.
 *   - The Mars and Pluto viewers define no `moonLonToW` AT ALL, so the rule is
 *     fitted to the stored value itself. Phobos stores west and comes out
 *     right; Charon stores east and does not.
 *
 * Negating an east longitude MIRRORS every outline about the prime meridian --
 * a fault the orthogonality check below cannot catch, because a reflection is
 * orthogonal too. Measured with each viewer's own rule: 46° out on Ariel, 70°
 * on Titania, 92° on Charon, 110° on Triton.
 *
 * So the relationship is measured. `meshLon = sgn·east + b` is affine with
 * |slope| 1; `b` is the circular mean of the residual for each handedness and
 * the handedness is whichever leaves the smaller MEDIAN error -- median,
 * because a bbox centre and a gazetteer centre differ by degrees on a long
 * linear feature and by a whole hemisphere on one cut at the seam.
 */
export function fitEastToMesh(pairs, tolDeg = 5) {
  // longitude is ill-conditioned near a pole, where the meridians converge
  const use = (pairs || []).filter((p) => Number.isFinite(p.east)
    && Number.isFinite(p.meshLon) && (!Number.isFinite(p.lat) || Math.abs(p.lat) < 60));
  if (use.length < 2) return null;
  let best = null;
  for (const sgn of [1, -1]) {
    const fit = fitOffset(use, sgn);
    if (!best || fit.median < best.median) best = { sgn, ...fit };
  }
  if (!best || !(best.median < tolDeg)) return null;
  const { sgn, b } = best;
  const toMesh = (east) => sgn * east + b;
  toMesh.median = best.median;
  toMesh.count = best.count;
  return toMesh;
}

/**
 * The offset for one handedness, taken TWICE: a circular mean, then the same
 * mean over the pairs that agree with it.
 *
 * The mean alone is not robust, and the outliers here are not noise. A feature
 * cut at 180 has its bbox centre put ON the seam rather than at its middle,
 * which is a whole hemisphere out; a long linear feature's bbox centre sits
 * degrees from the point the gazetteer named. Measured on Europa, most pairs
 * agree to 1.5° and a handful are 100° adrift. One such pair pulls the mean
 * far enough to fail the tolerance and refuse a fit that is really there.
 *
 * The second pass keeps what lies within three times the first pass's MEDIAN
 * error (never under 5°, or a near-perfect fit rejects its own rounding), and
 * only when at least half the pairs survive -- a subset small enough to fit
 * anything is not evidence.
 */
function fitOffset(use, sgn) {
  const mean = (set) => {
    let sx = 0; let sy = 0;
    for (const p of set) {
      const d = ((p.meshLon - sgn * p.east) * Math.PI) / 180;
      sx += Math.cos(d); sy += Math.sin(d);
    }
    return (Math.atan2(sy, sx) * 180) / Math.PI;
  };
  const errs = (set, b) => set.map((p) => Math.abs(wrap180(p.meshLon - (sgn * p.east + b))));
  const median = (xs) => [...xs].sort((x, y) => x - y)[xs.length >> 1];

  const b0 = mean(use);
  const e0 = errs(use, b0);
  const m0 = median(e0);
  const cut = Math.max(5, 3 * m0);
  const inliers = use.filter((p, i) => e0[i] <= cut);
  if (inliers.length < Math.max(2, Math.ceil(use.length / 2))) {
    return { b: b0, median: m0, count: use.length };
  }
  const b = mean(inliers);
  return { b, median: median(errs(inliers, b)), count: inliers.length };
}

/**
 * The 3×3 taking a direction in the IMPORTER's frame to the moon mesh's.
 *
 * Derived from three reference points rather than written out, because the
 * importer's frame is whatever this viewer's own `latLonToVector3` makes it
 * (Mercury's is west-positive, Pluto's carries a half-turn) and a hand-written
 * rotation would be right on one world. D·S⁻¹ asks both frames the same three
 * questions and cannot disagree with either.
 *
 * It must come out ORTHOGONAL -- both sets are unit directions with the same
 * mutual angles -- so `Mᵀ M ≈ I` is a real check on the longitude rule rather
 * than a formality: a rule with the wrong SCALE fails it. It is NOT a check on
 * the handedness: a reflection satisfies it too, which is why the mapping is
 * fitted from the markers (`fitEastToMesh`) rather than assumed.
 */
export function moonFrame(toMesh, latLonToDir) {
  if (typeof toMesh !== "function") return null;
  const REF = [[0, 0], [0, 90], [90, 0]];
  const s = [];
  const d = [];
  for (const [lat, lon] of REF) {
    const v = latLonToDir(lat, lon);
    const n = Math.hypot(v.x, v.y, v.z) || 1;
    s.push([v.x / n, v.y / n, v.z / n]);
    const m = meshDir(lat, toMesh(lon));
    d.push([m.x, m.y, m.z]);
  }
  const S = new THREE.Matrix3().set(
    s[0][0], s[1][0], s[2][0],
    s[0][1], s[1][1], s[2][1],
    s[0][2], s[1][2], s[2][2],
  );
  const D = new THREE.Matrix3().set(
    d[0][0], d[1][0], d[2][0],
    d[0][1], d[1][1], d[2][1],
    d[0][2], d[1][2], d[2][2],
  );
  const M = D.multiply(S.invert());
  // Mᵀ M against the identity, worst element.
  const e = M.elements;
  let worst = 0;
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      const dot = e[i * 3] * e[j * 3] + e[i * 3 + 1] * e[j * 3 + 1] + e[i * 3 + 2] * e[j * 3 + 2];
      worst = Math.max(worst, Math.abs(dot - (i === j ? 1 : 0)));
    }
  }
  return worst < 1e-6 ? M : null;
}

/**
 * Lat/lon back out of a direction in the IMPORTER's frame.
 *
 * Projected onto the three axes `latLonToVector3` itself answers with, so the
 * pick is the exact inverse of the placement whatever convention this viewer
 * keeps -- the rule `port-viewer-seam.py` already writes into every planet's
 * surface pick, applied to a moon.
 */
export function dirToLatLon(dir, latLonToDir) {
  const unit = (v) => {
    const n = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / n, y: v.y / n, z: v.z / n };
  };
  const ux = unit(latLonToDir(0, 0));
  const uy = unit(latLonToDir(90, 0));
  const uz = unit(latLonToDir(0, 90));
  const d = unit(dir);
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const lat = (Math.asin(Math.max(-1, Math.min(1, dot(d, uy)))) * 180) / Math.PI;
  const lon = (Math.atan2(dot(d, uz), dot(d, ux)) * 180) / Math.PI;
  return { lat, lon };
}

/**
 * The named feature under a point: the SMALLEST polygon containing it, else a
 * line within tolerance.
 *
 * The same answer `feature-popup`'s `pickSmallest` gives and a separate
 * implementation of it, because that one asks in the PLANET's coordinates off
 * a layer list this layer has opted out of. A regio holds the planitia that
 * holds the crater, and the name the pointer means is the smallest.
 */
export function featureUnder(features, lat, lon, tolDeg = 0.6) {
  const point = [lon, lat];
  let best = null;
  let bestArea = Infinity;
  let nearest = null;
  let nearestD = tolDeg;
  const span = (ring) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of ring) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return (x1 - x0) * (y1 - y0);
  };
  for (const f of features || []) {
    const g = f?.geometry;
    if (!g) continue;
    const polys = g.type === "Polygon" ? [g.coordinates]
      : g.type === "MultiPolygon" ? g.coordinates : null;
    if (polys) {
      for (const poly of polys) {
        if (!poly?.[0]?.length || !pointInPolygon(point, poly)) continue;
        const a = span(poly[0]);
        if (a < bestArea) { bestArea = a; best = f; }
      }
      continue;
    }
    const lines = g.type === "LineString" ? [g.coordinates]
      : g.type === "MultiLineString" ? g.coordinates : null;
    if (!lines) continue;
    for (const line of lines) {
      for (let i = 1; i < line.length; i += 1) {
        const d = segmentDistance(point, line[i - 1], line[i]);
        if (d < nearestD) { nearestD = d; nearest = f; }
      }
    }
  }
  return best || nearest;
}

function segmentDistance([px, py], [ax, ay], [bx, by]) {
  const vx = bx - ax;
  const vy = by - ay;
  const len = vx * vx + vy * vy;
  const t = len > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len)) : 0;
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

/* ── Loading ──────────────────────────────────────────────────────────── */

let busy = false;

/**
 * THE OUTLINES ANSWER SEARCH AND TOUR MODE, for as long as they are loaded.
 *
 * A viewer ships the places it was written around -- Mars's own label data,
 * Earth's curated forty-five -- and the gazetteer is a layer somebody ticks on
 * beside them. Registering a PROVIDER rather than handing over a list is what
 * lets the features go when the layer does: unticked, the search stops
 * offering craters that are no longer on the globe.
 *
 * Built on the first ask and kept, because the Moon's file is 9,060 features
 * and a search runs on every keystroke. The cache dies with the registration.
 *
 * A MOON'S OUTLINES ARE DELIBERATELY NOT OFFERED HERE. Their coordinates are
 * the MOON's, and this viewer's search flies the PLANET to a lat/lon -- the
 * same reason the moon layer carries `groundPick: false`. Each viewer already
 * ships its moons' own feature data for that.
 */
const searchHandles = new Map();

function offerToSearch(key, layer) {
  const viewer = window.GeoIDViewer;
  if (typeof viewer?.registerFeatureSource !== "function" || !layer) return;
  stopOfferingToSearch(key);
  let cache = null;
  searchHandles.set(key, viewer.registerFeatureSource(`iau-${key}`, () => {
    cache ||= (layer.features || []).map((f) => sceneItem(f)).filter(Boolean);
    return cache;
  }));
}

function stopOfferingToSearch(key) {
  const off = searchHandles.get(key);
  if (off) { off(); searchHandles.delete(key); }
}

/**
 * One import for a planet and for a moon: the same file the importer takes
 * from a drop, so both arrive with a Workspace row, symbology and export.
 */
async function fetchOutlines(path, { west = false } = {}) {
  const response = await fetch(await dataUrl(path));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const all = await response.json();
  const total = (all.features || []).length;
  let fc = withoutExtents(all);
  const hidden = total - (fc.features || []).length;
  if (west) fc = toWestPositive(fc);
  return { fc, total, hidden };
}

/**
 * One import for a planet and for a moon: the same file the importer takes
 * from a drop, so both arrive with a Workspace row, symbology and export.
 *
 * `unfilled` stays even though the boxes are hidden by default: the tick draws
 * them, and drawn they are still the box rather than the shape.
 */
async function importOutlines(fc, name, { flat = false } = {}) {
  const manager = window.GeoIDImportManager;
  const blob = new Blob([JSON.stringify(fc)], { type: "application/geo+json" });
  await manager.importFileList([new File([blob], `${name}.geojson`, { type: "application/geo+json" })],
    { name, frame: false, hold: false, flat, unfilled: isExtent });
  const layer = namedLayer(name);
  if (!layer || layer.status === "error") {
    if (layer) manager.removeLayer(layer.id);
    throw new Error(layer?.message || "the importer did not take it");
  }
  return layer;
}

async function load(body, say) {
  const manager = window.GeoIDImportManager;
  if (!manager?.importFileList) { say("The GIS layer is still starting — try again in a moment."); return false; }
  if (layerOf(body)) return true;
  busy = true;
  try {
    say("Loading the outlines…");
    const west = isWestPositive(body);
    const { fc, hidden } = await fetchOutlines(OUTLINE_BODIES[body].path, { west });
    // Nothing to draw is an ANSWER here, not a failure: this body's every
    // named feature is a box. Importing an empty collection would register a
    // layer with no geometry and a row that explains nothing.
    if (!fc.features.length) { say(outlineSummary([], hidden) + "."); return false; }
    const layer = await importOutlines(fc, layerNameFor(body), { flat: false });
    layer.metadata = { ...(layer.metadata || {}), source: CREDIT, citation: CREDIT,
      crs: `${OUTLINE_BODIES[body].name} 2000 geographic, longitude ${west ? "WEST-positive (this viewer's convention)" : "east"}` };
    // a regio holds the planitia that holds the crater: the name the pointer
    // means is the smallest one under it (feature-popup honours the flag)
    layer.pickSmallest = true;
    // a click opens the VIEWER's card for the place (feature-popup)
    layer.sceneItemFor = (feature) => sceneItem(feature);
    // one colour per feature type, the question an outline map is read for
    paintByField(layer, "type");
    offerToSearch(body, layer);
    say(`${outlineSummary(layer.features, hidden)}. Source: ${CREDIT}.`);
    return true;
  } catch (error) {
    say(`The outlines did not load (${error.message || error}).`);
    return false;
  } finally {
    busy = false;
  }
}

/* ── The moon in view ─────────────────────────────────────────────────── */

// { key, name, layerId, holder, highlight, mesh }
let moon = null;

/** The moon the viewer has open, where the gazetteer has drawn it. */
function openMoon() {
  const hooks = window.__flightSimHooks;
  const m = typeof hooks?.getFlightMoon === "function" ? hooks.getFlightMoon() : null;
  if (!m?.mesh || !m.name) return null;
  const key = String(m.name).toLowerCase();
  return OUTLINE_MOONS[key] ? { ...m, key } : null;
}

function moonLayer() {
  return moon ? layers().find((l) => l.id === moon.layerId) || null : null;
}

function dropMoon() {
  const layer = moonLayer();
  clearMoonHighlight();
  if (moon?.holder?.parent) moon.holder.parent.remove(moon.holder);
  moon = null;
  if (layer) window.GeoIDImportManager?.removeLayer?.(layer.id);
}

async function loadMoon(target, say) {
  const manager = window.GeoIDImportManager;
  if (!manager?.importFileList) return false;
  busy = true;
  try {
    say(`Loading ${target.name}'s outlines…`);
    const name = moonLayerNameFor(target.key);
    const { fc, hidden } = await fetchOutlines(moonPath(target.key));
    if (!fc.features.length) { say(`${target.name}: ${outlineSummary([], hidden)}.`); return false; }
    const layer = await importOutlines(fc, name, { flat: true });
    layer.metadata = { ...(layer.metadata || {}), source: CREDIT, citation: CREDIT,
      crs: `${target.name} geographic, longitude east (drawn on the moon's own mesh)` };
    layer.pickSmallest = true;
    // ITS COORDINATES ARE THE MOON'S. `featuresAt` walks every visible vector
    // layer for a lat/lon on THIS planet; left in, a click on the planet would
    // answer with a crater on a moon. It gets the picker below instead.
    layer.groundPick = false;
    layer.sceneItemFor = (feature) => sceneItem(feature, { moon_name: target.name });
    paintByField(layer, "type");
    if (!hangOnMoon(layer, target, say)) { manager.removeLayer(layer.id); return false; }
    say(`${outlineSummary(layer.features, hidden)} on ${target.name}. Source: ${CREDIT}.`);
    return true;
  } catch (error) {
    say(`${target.name}'s outlines did not load (${error.message || error}).`);
    return false;
  } finally {
    busy = false;
  }
}

/** Reparent a flat-rendered layer onto the moon's mesh. */
function hangOnMoon(layer, target, say) {
  const mesh = target.mesh;
  /**
   * THE MOON'S OWN MARKERS FIRST. They ARE this viewer's placement of these
   * very features, so a frame fitted to them lands the outline on the ground
   * the marker points at by construction, whatever longitude convention this
   * moon's data happens to be stored in. The °W rule is the fallback, for a
   * moon with too few named features to fit one (Hyperion has a single
   * outline, and its rule is one of the thirteen that really do report west).
   */
  const fitted = fitEastToMesh(
    markerPairs(window.__flightSimHooks?.scene, target.name, layer.features, mesh));
  const toMesh = fitted || eastToMeshLon(target.displayLon);
  const from = fitted
    ? `frame fitted to ${fitted.count} of its own markers, median ${fitted.median.toFixed(2)}°`
    : "frame inverted from this viewer's own °W rule";
  const M = moonFrame(toMesh, (lat, lon) => latLonToVector3(lat, lon, 1));
  if (!M) {
    say(`${target.name}'s longitude rule is not settled yet — turn the moon and tick again.`);
    return false;
  }
  if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
  const meshRadius = mesh.geometry.boundingSphere.radius;
  const base = Number(window.GeoIDViewer?.GLOBE_RADIUS ?? 3.2);
  // A hair above the surface, in the moon's own proportion: the outlines draw
  // with the depth test off, so this is against the mesh's own facets rather
  // than against terrain there is none of.
  const k = (meshRadius / base) * 1.004;
  const holder = new THREE.Group();
  holder.name = `GeoID-MoonOutlines-${target.key}`;
  holder.matrixAutoUpdate = false;
  const e = M.elements;
  holder.matrix.set(
    k * e[0], k * e[3], k * e[6], 0,
    k * e[1], k * e[4], k * e[7], 0,
    k * e[2], k * e[5], k * e[8], 0,
    0, 0, 0, 1,
  );
  holder.matrixWorldNeedsUpdate = true;
  holder.add(layer.object3D);
  mesh.add(holder);
  layer.metadata = { ...(layer.metadata || {}),
    crs: `${target.name} geographic, longitude east (drawn on the moon's own mesh; ${from})` };
  moon = { key: target.key, name: target.name, layerId: layer.id, holder, mesh, highlight: null, M, k, from };
  return true;
}

/* ── A click on a moon outline ────────────────────────────────────────── */

const HIGHLIGHT_COLOUR = 0xffbf6f;

function clearMoonHighlight() {
  if (!moon?.highlight) return;
  moon.highlight.parent?.remove(moon.highlight);
  moon.highlight.traverse?.((n) => { n.geometry?.dispose?.(); n.material?.dispose?.(); });
  moon.highlight = null;
}

function drawMoonHighlight(feature) {
  clearMoonHighlight();
  if (!moon?.holder || !feature?.geometry) return;
  const base = Number(window.GeoIDViewer?.GLOBE_RADIUS ?? 3.2) * 1.0015;
  const pts = [];
  const strip = (ring) => {
    for (let i = 1; i < ring.length; i += 1) {
      const [ax, ay] = ring[i - 1];
      const [bx, by] = ring[i];
      // a ring cut at the seam has a segment running the whole way round it
      if (Math.abs(bx - ax) > 180) continue;
      pts.push(latLonToVector3(ay, ax, base), latLonToVector3(by, bx, base));
    }
  };
  const g = feature.geometry;
  const rings = g.type === "Polygon" ? g.coordinates
    : g.type === "MultiPolygon" ? g.coordinates.flat()
      : g.type === "LineString" ? [g.coordinates]
        : g.type === "MultiLineString" ? g.coordinates : [];
  rings.forEach(strip);
  if (!pts.length) return;
  const line = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: HIGHLIGHT_COLOUR, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false }),
  );
  line.renderOrder = 400;
  line.frustumCulled = false;
  moon.holder.add(line);
  moon.highlight = line;
}

let downAt = null;

function onPointerDown(event) {
  downAt = { x: event.clientX, y: event.clientY };
}

function onPointerUp(event) {
  const from = downAt;
  downAt = null;
  const layer = moonLayer();
  if (!layer || !moon?.holder || layer.visible === false) return;
  // a drag is a turn of the moon, not a pick
  if (from && Math.hypot(event.clientX - from.x, event.clientY - from.y) > 4) return;
  const hooks = window.__flightSimHooks;
  const camera = hooks?.camera;
  const renderer = hooks?.renderer;
  if (!camera || !renderer || event.target !== renderer.domElement) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(moon.mesh, false)[0];
  if (!hit) return;
  const local = moon.holder.worldToLocal(hit.point.clone());
  const { lat, lon } = dirToLatLon(local, (a, b) => latLonToVector3(a, b, 1));
  const feature = featureUnder(layer.features, lat, lon);
  if (!feature) return;
  // one card per click: the GIS stack card must not also answer this pixel
  window.GeoIDFeaturePopup?.suppress?.(800);
  const item = layer.sceneItemFor?.(feature);
  if (item && window.GeoIDViewer?.openSceneFeature?.(item)) drawMoonHighlight(feature);
}

/**
 * The highlight belongs to the CARD, so it goes when the card does. The same
 * observer the planet outlines use: a card is closed four ways and wiring into
 * each of them is how one of them gets missed.
 */
function watchCard() {
  const card = byId("scene-popup");
  if (!card) return;
  new MutationObserver(() => { if (card.hidden) clearMoonHighlight(); })
    .observe(card, { attributes: true, attributeFilter: ["hidden"] });
}

/* ── The panel ────────────────────────────────────────────────────────── */

function install(body, tries = 0) {
  const section = byId("locations-section");
  const body_ = section?.querySelector(":scope > .section-body");
  if (!body_) {
    if (tries < 80) setTimeout(() => install(body, tries + 1), 250);
    return;
  }
  if (byId("nomenclature-outlines")) return;
  const hasPlanet = Boolean(OUTLINE_BODIES[body]);
  const hasMoons = MOON_HOSTS.has(body);
  // Its own card, straight after the label rows and before the density
  // slider: the labels are points, this is a layer, and a tick among the label
  // rows would read as one more label type. The TICK IS ON THE CARD'S HEADER,
  // as the Locations master is on its own: folded at the foot of the list with
  // its tick inside, it was measured on screen and still reported missing.
  const wrap = document.createElement("details");
  wrap.id = "nomenclature-outlines";
  wrap.className = "gis-tool-section";
  wrap.dataset.toolIcon = "1";
  const moonLine = hasMoons
    ? `<p class="compact-copy">Open a moon in the Moon viewer and its own outlines are drawn on it${hasPlanet ? " too" : ""}.</p>`
    : "";
  wrap.innerHTML = `
    <summary style="display:flex;align-items:center;gap:0.5rem;">
      <span style="flex:1 1 auto;min-width:0;">Feature outlines (IAU)</span>
      <input id="nomenclature-outlines-toggle" type="checkbox"
        aria-label="Show the named feature outlines" title="Show the named feature outlines">
    </summary>
    <div class="gis-tool-body">
      <p class="compact-copy">The extent of each named feature -- craters, plains, ridges -- as the IAU
        gazetteer draws it. A layer: it joins the Workspace, where it can be recoloured and exported.</p>
      <p class="compact-copy">Only the worlds the gazetteer has actually drawn are offered here.
        Where it has published the feature's BOUNDING BOX instead -- Venus, Europa, Callisto, Titan and
        most of the mapped moons -- there is no row, because a rectangle is the smallest box that holds
        a feature and not its shape.</p>
      ${moonLine}
      <p class="compact-copy" id="nomenclature-outlines-status" aria-live="polite"></p>
    </div>`;
  const stack = body_.querySelector(".control-stack") || body_;
  const before = stack.querySelector(":scope > .lod-slider-row");
  if (before) stack.insertBefore(wrap, before); else stack.appendChild(wrap);
  // a press on the tick is a tick, not a fold of the card it sits on
  const tick = byId("nomenclature-outlines-toggle");
  ["click", "pointerdown"].forEach((type) => tick.addEventListener(type, (event) => event.stopPropagation()));
  const status = byId("nomenclature-outlines-status");
  const say = (m) => { if (status) status.textContent = m; };
  // no boxes tick: see the guard above `withoutExtents`
  tick.addEventListener("change", async () => {
    if (tick.checked) {
      let ok = true;
      if (hasPlanet) ok = await load(body, say);
      if (hasMoons) await followMoon(say);
      if (hasPlanet) tick.checked = ok && Boolean(layerOf(body));
      else tick.checked = true;
      if (!hasPlanet && !moonLayer()) say("Open a moon in the Moon viewer to see its outlines.");
    } else {
      const layer = hasPlanet ? layerOf(body) : null;
      if (layer) window.GeoIDImportManager.removeLayer(layer.id);
      stopOfferingToSearch(body);
      dropMoon();
      say("");
    }
  });
  // the tick follows the layer: removed in the Workspace, it unticks here
  const follow = () => {
    if (busy) return;
    if (hasPlanet) {
      const layer = layerOf(body);
      tick.checked = Boolean(layer);
      // Removed from the Workspace rather than here, so the search has to be
      // told the same way the tick is.
      if (!layer) stopOfferingToSearch(body);
    } else if (!moonLayer() && moon) { dropMoon(); }
  };
  const hook = (n = 0) => {
    if (window.GeoIDImportManager?.onChange) window.GeoIDImportManager.onChange(follow);
    else if (n < 80) setTimeout(() => hook(n + 1), 250);
  };
  hook();

  if (!hasMoons) return;
  watchCard();
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointerup", onPointerUp);
  /**
   * WHICH MOON IS OPEN IS NOT ANNOUNCED, so it is polled. The moon viewer is
   * opened from a label, from the moon list and by closing another one, and a
   * listener on each is a listener to miss.
   */
  setInterval(() => { if (tick.checked && !busy) followMoon(say); }, 700);
}

async function followMoon(say) {
  const target = openMoon();
  if (!target) { if (moon) dropMoon(); return; }
  if (moon && moon.key === target.key && moonLayer()) return;
  if (moon) dropMoon();
  await loadMoon(target, say);
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  const start = () => {
    const body = currentBodyId();
    if (OUTLINE_BODIES[body] || MOON_HOSTS.has(body)) install(body);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}
