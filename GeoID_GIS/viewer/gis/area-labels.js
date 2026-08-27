/**
 * A saved shape keeps its annotation.
 *
 * While you draw, the viewer writes the name and the area inside the polygon.
 * Press Done and the drawing overlay is cleared — and the writing went with
 * it, so the shape you just named became an anonymous outline and the only
 * way back to its area was the layer list. The label should survive the save,
 * because the reason for putting it on the shape does not stop when the shape
 * becomes a layer.
 *
 * So this draws the same annotation for every DRAWN polygon layer on the
 * globe, following it as the planet turns, and the symbology dialog can
 * switch it off per layer.
 *
 * Scoped to shapes somebody drew — `ext === "drawn"` — and that scope is the
 * design, not laziness. A geological map is thousands of polygons; writing an
 * area inside each one is a solid wall of type over the map it describes.
 * What earns a permanent label is a shape a person made on purpose, of which
 * there are a handful.
 *
 * The projection comes from `window.GeoIDProjectLatLon`, which the viewer
 * exposes from the same block that places the drag handles. That matters:
 * the measure frame carries the globe's spin, and a module deriving its own
 * screen position would be a second copy of an arithmetic this codebase has
 * already had wrong once — handles drawn in the baseline frame while the
 * shape sat in the spun one, 592 km apart on Mars.
 */

const HOST_ID = "gis-saved-area-labels";
const labels = new Map();   // layer id -> element

const isDrawn = (layer) => layer?.ext === "drawn";

/** Kilometres at a readable precision — 8.4, 340, 1,410,000. */
function areaNumber(value) {
  if (!Number.isFinite(value)) return null;
  if (value < 10) return value.toFixed(2);
  if (value < 1000) return value.toFixed(1);
  return Math.round(value).toLocaleString("en-GB");
}

function host() {
  let node = document.getElementById(HOST_ID);
  if (!node) {
    node = document.createElement("div");
    node.id = HOST_ID;
    Object.assign(node.style, {
      position: "fixed", inset: "0", zIndex: 4, pointerEvents: "none",
    });
    document.body.appendChild(node);
  }
  return node;
}

/**
 * An ANNOTATION, not a card — the same decision the live label makes.
 *
 * No background and no border: a filled box sits on top of the polygon and
 * hides the ground it was drawn around, which is the whole reason the number
 * is inside the shape rather than in the corner. Legibility comes from a dark
 * halo instead, three shadows deep, because one soft glow disappears against
 * bright imagery and one hard outline looks stamped-on over dark.
 *
 * z-index 4 puts these UNDER the live drawing label (5) — while you are
 * drawing a new shape over an old one, the one in your hand is the one to
 * read — and BOTH sit under every piece of chrome: the sidebar is z 10,
 * and at 12/13 the annotations painted straight over the nav bar whenever
 * a shape sat behind it. An annotation belongs to the map.
 */
function makeLabel() {
  const el = document.createElement("div");
  Object.assign(el.style, {
    position: "absolute", pointerEvents: "none", textAlign: "center",
    transform: "translate(-50%, -50%)", whiteSpace: "nowrap",
    color: "#ffffff", font: "700 0.86rem/1.25 'Exo 2', sans-serif",
    textShadow: "0 0 3px rgba(0,0,0,0.95), 0 0 7px rgba(0,0,0,0.85),"
      + " 0 1px 2px rgba(0,0,0,1)",
  });
  host().appendChild(el);
  return el;
}

/** The ring of a drawn layer's first polygon, in signed degrees. */
function ringOf(layer) {
  const ring = layer?.collection?.features?.[0]?.geometry?.coordinates?.[0];
  return Array.isArray(ring) && ring.length >= 3 ? ring : null;
}

/**
 * The screen box of the shape, sampled from its own ring.
 *
 * The centre of that box is where "inside the polygon" is to a reader — NOT
 * the lat/lon centroid, which on a curved surface projects above the middle
 * of the outline you can see (measured at a seventh of the shape's height on
 * a large box). A dozen samples is plenty for an extent.
 */
function screenBox(ring) {
  const project = window.GeoIDProjectLatLon;
  if (typeof project !== "function") return null;
  const step = Math.max(1, Math.floor(ring.length / 12));
  let minX = Infinity; let maxX = -Infinity;
  let minY = Infinity; let maxY = -Infinity;
  let hits = 0;
  for (let i = 0; i < ring.length; i += step) {
    const [lon, lat] = ring[i];
    const p = project(lat, lon);
    if (!p) continue;
    hits += 1;
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  // Partly over the limb is still worth labelling; entirely behind it is not,
  // and `GeoIDProjectLatLon` answers null past the horizon for every vertex.
  return hits >= 2 ? { minX, maxX, minY, maxY } : null;
}

/**
 * The shape's bounding dimensions, "W × H km" — the same second line the
 * live drawing annotation carries, so a saved fetch extent keeps saying how
 * big it is. Kilometres per degree comes off the BODY's own radius (the
 * seam every world carries), because this module runs on the planets too
 * and 111.32 is Earth's number and nobody else's. Short way round the seam
 * for a ring at the antimeridian.
 */
function dimsFor(layer) {
  const ring = layer?.collection?.features?.[0]?.geometry?.coordinates?.[0];
  if (!ring?.length) return "";
  const lats = ring.map((c) => c[1]);
  const lons = ring.map((c) => c[0]);
  const south = Math.min(...lats);
  const north = Math.max(...lats);
  let lonSpan = Math.max(...lons) - Math.min(...lons);
  if (lonSpan > 180) lonSpan = 360 - lonSpan;
  const kmPerDeg = ((window.GeoIDViewer?.bodyRadiusKm ?? 6371) * Math.PI) / 180;
  const midLat = (south + north) / 2;
  const w = Math.round(lonSpan * kmPerDeg * Math.cos((midLat * Math.PI) / 180));
  const h = Math.round((north - south) * kmPerDeg);
  return (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0)
    ? `${w} × ${h} km` : "";
}

function textFor(layer) {
  const props = layer?.collection?.features?.[0]?.properties || {};
  const area = areaNumber(Number(props.area_km2));
  const name = layer.name || props.name || "";
  if (!area && !name) return "";
  const dims = dimsFor(layer);
  return `<span style="display:block;font:600 0.56rem/1.3 'Exo 2',sans-serif;`
    + `letter-spacing:0.14em;text-transform:uppercase;opacity:0.8">${name}</span>`
    + (area ? `<span>${area} km²</span>` : "")
    + (dims ? `<br><span style="font-weight:500;font-size:0.7em;opacity:0.85;`
      + `letter-spacing:0.05em">${dims}</span>` : "");
}

function refresh() {
  const all = window.GeoIDImportManager?.getLayers?.() || [];
  const wanted = all.filter((layer) => isDrawn(layer)
    && layer.visible !== false
    && layer.showAreaLabel !== false
    && ringOf(layer));

  // Retire labels whose layer is gone, hidden, or switched off.
  const keep = new Set(wanted.map((l) => l.id));
  [...labels.keys()].forEach((id) => {
    if (keep.has(id)) return;
    labels.get(id)?.remove();
    labels.delete(id);
  });

  wanted.forEach((layer) => {
    const ring = ringOf(layer);
    const box = screenBox(ring);
    let el = labels.get(layer.id);
    if (!box) { if (el) el.style.display = "none"; return; }
    if (!el) { el = makeLabel(); labels.set(layer.id, el); }
    const html = textFor(layer);
    if (!html) { el.style.display = "none"; return; }
    // Written only when it changes: this runs every frame, and innerHTML is
    // a parse each time.
    if (el.dataset.html !== html) {
      el.innerHTML = html;
      el.dataset.html = html;
    }
    el.style.display = "block";
    /* Inside when it fits, above when it does not — the same rule the live
       label follows, so a shape does not move its own writing on save. */
    const fits = (box.maxX - box.minX) >= el.offsetWidth + 10
      && (box.maxY - box.minY) >= el.offsetHeight + 10;
    el.style.left = `${(box.minX + box.maxX) / 2}px`;
    el.style.top = `${fits ? (box.minY + box.maxY) / 2 : box.minY}px`;
    el.style.transform = `translate(-50%, ${fits ? "-50%" : "-115%"})`;
  });
}

function init() {
  // The globe turns, so the labels are placed every frame like the handles.
  // Nothing is written unless it changed, so the cost is a projection per
  // drawn shape — and there are a handful of those, by design.
  const loop = () => { try { refresh(); } catch (error) { /* keep drawing */ } window.requestAnimationFrame(loop); };
  window.requestAnimationFrame(loop);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}

export { refresh, areaNumber };
