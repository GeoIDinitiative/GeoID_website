/**
 * A GLACIER IS EVERY PIECE OF ITS OUTLINE, NOT THE LAST ROW FILED UNDER ITS ID.
 *
 * GLIMS stores a glacier's boundary as ROWS, one polygon each, under one
 * `glac_id`: an ice mass in two disjoint parts is two rows, and an ice cap
 * digitised off two scenes is two rows — often with two analyses and two
 * imagery dates. Every reader of the archive here used to keep ONE row per
 * `glac_id` (the latest, or the first seen), which is right when the rows are
 * successive outlines of the same ice and silently deletes the rest of the
 * glacier when they are pieces of it. Reported on Katla: "only half of
 * Mýrdalsjökull is mapped and animated" — the half that was filed last.
 *
 * So the question "does this outline replace that one" is answered by the
 * GROUND, not by the id: a newer outline SUPERSEDES the pieces it overlaps
 * (a remapping of the same ice, retreated or advanced), and leaves the pieces
 * it does not touch where they are (the rest of the glacier). Nothing is
 * invented — every polygon drawn is a real outline with a real date.
 *
 * An outline with no polygon to compare (a point, or a test fixture) keeps the
 * old rule — same id, same ice — because there is no ground to ask.
 */

import { pointInRing } from "./geometry.js?v=20261017-9debac0";
import { sphericalPolygonAreaKm2 } from "./geo-utils.js?v=20261017-9debac0";

/** The imagery date an outline was drawn from, however the archive spelt it. */
export function outlineDateOf(feature) {
  const date = String(feature?.properties?.outline_date
    || feature?.properties?.src_date || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function polygonsOf(geometry) {
  if (geometry?.type === "Polygon") return [geometry.coordinates];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

/** Per-feature facts, worked out once: its polygons, box and an interior sample. */
const facts = new WeakMap();
const GRID = 9;

function factsOf(feature) {
  if (!feature || typeof feature !== "object") return { polys: [] };
  let held = facts.get(feature);
  if (held) return held;
  const polys = polygonsOf(feature.geometry)
    .filter((poly) => Array.isArray(poly?.[0]) && poly[0].length >= 4);
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const poly of polys) {
    for (const [x, y] of poly[0]) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  held = { polys, minX, minY, maxX, maxY, sample: null };
  facts.set(feature, held);
  return held;
}

function insidePolys(point, polys) {
  for (const poly of polys) {
    if (!pointInRing(point, poly[0])) continue;
    let inHole = false;
    for (let i = 1; i < poly.length; i += 1) {
      if (pointInRing(point, poly[i])) { inHole = true; break; }
    }
    if (!inHole) return true;
  }
  return false;
}

/**
 * Points spread over the INSIDE of an outline — a grid over its box, kept
 * where it lands on ice. Vertices would not do: two halves of one ice cap
 * share the divide between them, and its vertices sit on both boundaries.
 */
function interiorSample(feature) {
  const f = factsOf(feature);
  if (f.sample) return f.sample;
  const out = [];
  const dx = (f.maxX - f.minX) / (GRID + 1);
  const dy = (f.maxY - f.minY) / (GRID + 1);
  for (let i = 1; i <= GRID; i += 1) {
    for (let j = 1; j <= GRID; j += 1) {
      const p = [f.minX + dx * i, f.minY + dy * j];
      if (insidePolys(p, f.polys)) out.push(p);
    }
  }
  // A sliver the grid missed still has a vertex.
  if (!out.length && f.polys.length) out.push(f.polys[0][0][0]);
  f.sample = out;
  return out;
}

/** Share of `a`'s interior that lies on `b`. */
function shareOn(a, b) {
  const sample = interiorSample(a);
  if (!sample.length) return 0;
  const target = factsOf(b).polys;
  let hits = 0;
  for (const p of sample) if (insidePolys(p, target)) hits += 1;
  return hits / sample.length;
}

/**
 * DOES `newer` MAP THE SAME ICE AS `older`?
 *
 * Yes when either lies mostly on the other: a retreated outline lies inside
 * the one before it, an advanced one contains it. Two pieces of one glacier
 * share at most a boundary, so neither lies on the other. With no polygon on
 * either side there is nothing to compare and the id decides, as it always
 * did.
 */
export const SAME_ICE_SHARE = 0.3;

export function sameIce(newer, older) {
  const a = factsOf(newer);
  const b = factsOf(older);
  if (!a.polys.length || !b.polys.length) return true;
  if (a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY) return false;
  return shareOn(newer, older) >= SAME_ICE_SHARE || shareOn(older, newer) >= SAME_ICE_SHARE;
}

/**
 * An outline's own area, km². Measured off the polygon where there is one,
 * because GLIMS's `db_area` belongs to the ANALYSIS and is repeated on every
 * row of it — summing it over the pieces of one analysis would count the
 * glacier once per piece. The archive's figure is the fallback.
 */
export function pieceAreaKm2(feature) {
  const { polys } = factsOf(feature);
  if (polys.length) {
    let total = 0;
    for (const poly of polys) {
      poly.forEach((ring, i) => {
        const area = sphericalPolygonAreaKm2(ring.slice(0, -1).map(([lon, lat]) => ({ lon, lat })), 6371.0088);
        total += i === 0 ? area : -area;
      });
    }
    if (total > 0) return total;
  }
  const area = Number(feature?.properties?.area_km2 ?? feature?.properties?.db_area);
  return Number.isFinite(area) && area > 0 ? area : null;
}

/**
 * THE LEDGER: what each glacier looks like as outlines are folded in, oldest
 * first. Each held piece remembers the area of the outline(s) it descends
 * from, so "change since first mapped" compares like with like: a glacier
 * whose two halves were filed on two dates did not double in size between
 * them, and a lineage of one has no change to show.
 */
export function createLedger() {
  const held = new Map();         // id -> [{ feature, date, root, generations }]
  const merged = new Map();       // id -> the frame feature, until the id changes
  return {
    held,
    /** Fold one outline in. Returns false if it carried no id or date. */
    add(feature) {
      const id = feature?.properties?.glac_id;
      const date = outlineDateOf(feature);
      if (!id || !date) return false;
      const pieces = held.get(id) || [];
      const kept = [];
      let root = 0;
      let generations = 0;
      let superseded = 0;
      for (const piece of pieces) {
        if (sameIce(feature, piece.feature)) {
          superseded += 1;
          root += piece.root ?? 0;
          generations = Math.max(generations, piece.generations);
        } else kept.push(piece);
      }
      const own = pieceAreaKm2(feature);
      kept.push({
        feature,
        date,
        root: superseded ? root : own,
        generations: generations + 1,
      });
      held.set(id, kept);
      merged.delete(id);
      return true;
    },
    /** How many glaciers are held. */
    get size() { return held.size; },
    /** One feature per glacier, as it stands now. */
    features() {
      const out = [];
      for (const [id, pieces] of held) {
        let feature = merged.get(id);
        if (!feature) {
          feature = glacierFeature(pieces);
          merged.set(id, feature);
        }
        out.push(feature);
      }
      return out;
    },
  };
}

/**
 * A glacier's pieces as ONE feature, so a frame, a card and a count all see
 * one glacier. A single piece that has never superseded anything is passed
 * through untouched; anything else is a new feature carrying the combined
 * area, the area it is measured against, and how many times it was mapped.
 */
function glacierFeature(pieces) {
  const areas = pieces.map((p) => pieceAreaKm2(p.feature));
  const area = areas.every(Number.isFinite) ? areas.reduce((s, a) => s + a, 0) : null;
  const roots = pieces.map((p) => p.root);
  const first = roots.every(Number.isFinite) ? roots.reduce((s, a) => s + a, 0) : null;
  const generations = Math.max(...pieces.map((p) => p.generations));
  const newest = pieces.reduce((a, b) => (b.date > a.date ? b : a));
  if (pieces.length === 1 && generations === 1) return newest.feature;
  const polygons = pieces.flatMap((p) => polygonsOf(p.feature.geometry));
  const geometry = pieces.length === 1 ? newest.feature.geometry
    : polygons.length ? { type: "MultiPolygon", coordinates: polygons }
      : newest.feature.geometry;
  return {
    ...newest.feature,
    geometry,
    properties: {
      ...newest.feature.properties,
      ...(pieces.length > 1 && area !== null ? { area_km2: Math.round(area * 1000) / 1000 } : {}),
      outline_pieces: pieces.length,
      outline_dates: [...new Set(pieces.map((p) => p.date))].sort(),
      // Both on ONE basis (the outline's own area), so a change is never a
      // difference between the archive's figure and a measured one.
      area_now_km2: area,
      first_area_km2: first,
      mapped_times: generations,
    },
  };
}

/**
 * The final state of every glacier in a set of outlines — the cover map's
 * "latest outline per glacier", piece-aware. Only boundaries are outlines.
 */
export function latestGlaciers(features) {
  const ledger = createLedger();
  const sorted = (features || [])
    .filter((f) => (f?.properties?.line_type || "glac_bound") === "glac_bound")
    .map((f, i) => ({ f, i, date: outlineDateOf(f) || "" }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.i - b.i));
  const loose = [];
  for (const { f } of sorted) if (!ledger.add(f)) loose.push(f);
  return { ledger, features: ledger.features(), loose };
}
