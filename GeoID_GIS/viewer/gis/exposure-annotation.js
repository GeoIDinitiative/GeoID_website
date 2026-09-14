/**
 * An annotation standing over a study area: who is under the hazard, said on
 * the map where the area is, not in a panel somebody has to look away to.
 *
 * It hangs above the polygon's TOP EDGE with a short leader down to it, and
 * follows the globe every frame. The position comes from
 * `window.GeoIDProjectLatLon` — the viewer's own projection, the one the drag
 * handles and the saved-area labels use — sampled round the ring, because the
 * projected centroid of a large polygon sits above the middle of the outline
 * the reader can see (area-labels.js measured 20 px on a 144 px box). A ring
 * the projection cannot place is behind the planet, and the annotation hides.
 *
 * Styled inline from the skin's tokens rather than from a STYLE literal: one
 * element, a handful of properties, and no CSS-in-JS template to put a
 * backtick into.
 */

const notes = new Map();   // id -> { node, ring, lines }
let raf = 0;

function screenBox(ring) {
  const project = window.GeoIDProjectLatLon;
  if (typeof project !== "function" || !ring?.length) return null;
  const step = Math.max(1, Math.floor(ring.length / 24));
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity; let hits = 0;
  for (let i = 0; i < ring.length; i += step) {
    const [lon, lat] = ring[i];
    const p = project(lat, lon);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    hits += 1;
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  return hits >= 2 ? { minX, maxX, minY, maxY } : null;
}

function build(id) {
  const node = document.createElement("div");
  node.className = "gis-exposure-note";
  node.dataset.note = id;
  node.setAttribute("role", "status");
  Object.assign(node.style, {
    position: "fixed", zIndex: "12", pointerEvents: "none", transform: "translate(-50%, -100%)",
    maxWidth: "18rem", padding: "0.45rem 0.6rem 0.5rem", borderRadius: "6px",
    background: "var(--skin-card-ground, rgb(24, 13, 47))", color: "var(--skin-ink, #f2f5f8)",
    border: "1px solid rgba(var(--skin-chrome-rgb, 255, 43, 214), 0.55)",
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.45)", font: "12px/1.35 'Exo 2', system-ui, sans-serif",
  });
  const leader = document.createElement("span");
  Object.assign(leader.style, {
    position: "absolute", left: "50%", bottom: "-9px", width: "1px", height: "9px",
    background: "rgba(var(--skin-chrome-rgb, 255, 43, 214), 0.8)",
  });
  node.append(leader);
  document.body.append(node);
  return node;
}

function paint(entry) {
  const { node } = entry;
  const keep = node.lastChild;
  node.replaceChildren();
  if (entry.kicker) {
    const k = document.createElement("div");
    k.textContent = entry.kicker;
    Object.assign(k.style, { font: "600 10px 'Exo 2', system-ui, sans-serif", letterSpacing: "0.09em", textTransform: "uppercase", opacity: "0.72", marginBottom: "0.15rem" });
    node.append(k);
  }
  const t = document.createElement("div");
  t.textContent = entry.title;
  Object.assign(t.style, { fontWeight: "700", fontSize: "13px" });
  node.append(t);
  for (const line of entry.lines || []) {
    const l = document.createElement("div");
    if (line.colour) {
      const sw = document.createElement("span");
      Object.assign(sw.style, { display: "inline-block", width: "8px", height: "8px", marginRight: "0.35rem", borderRadius: "2px", background: line.colour, verticalAlign: "0" });
      l.append(sw);
    }
    l.append(document.createTextNode(line.text));
    node.append(l);
  }
  node.append(keep);
}

function frame() {
  raf = 0;
  if (!notes.size) return;
  for (const entry of notes.values()) {
    const box = screenBox(entry.ring);
    if (!box || entry.hidden) { entry.node.style.display = "none"; continue; }
    entry.node.style.display = "block";
    entry.node.style.left = `${Math.round((box.minX + box.maxX) / 2)}px`;
    entry.node.style.top = `${Math.round(box.minY - 12)}px`;
  }
  raf = requestAnimationFrame(frame);
}

/**
 * Show or update an annotation. `ring` is the study polygon's outer ring as
 * [lon, lat]; `lines` are `{ text, colour? }`.
 */
export function showAnnotation(id, { ring, kicker = "", title = "", lines = [], hidden = false } = {}) {
  if (typeof document === "undefined") return;
  let entry = notes.get(id);
  if (!entry) { entry = { node: build(id) }; notes.set(id, entry); }
  Object.assign(entry, { ring: ring || entry.ring, kicker, title, lines, hidden });
  paint(entry);
  if (!raf) raf = requestAnimationFrame(frame);
}

export function removeAnnotation(id) {
  const entry = notes.get(id);
  if (!entry) return;
  entry.node.remove();
  notes.delete(id);
}

export function hasAnnotation(id) { return notes.has(id); }
