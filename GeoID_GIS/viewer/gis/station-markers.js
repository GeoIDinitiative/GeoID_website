/**
 * SAMPLING STATIONS ON THE GLOBE — a ▼ in the station's colour pointing at
 * its ground, and its name centred above it. No leader, no chip.
 *
 * The Mars flight sim's horizon tags are the model: a small outlined ▼ with
 * the name set directly over it, which reads as "here" at any zoom and never
 * needs a line to say which name belongs to which mark. The viewer's label
 * engine is built the other way round — a chip beside a dot, joined by a
 * leader, decluttered across a hemisphere — which is right for place names
 * and wrong for a handful of instruments the reader placed themselves.
 *
 * Screen space, so the mark is the same size at every altitude and the name
 * is never the far side of a leader from its point. Projected every frame
 * through the imported-layer group (which carries the globe's spin), culled at
 * the horizon by the tangent-plane test — `GeoIDProjectLatLon` does not cull
 * the far hemisphere, and a station round the back must not draw through the
 * planet.
 */

const STYLE = `
.gst-host { position: fixed; inset: 0; pointer-events: none; z-index: 12; }
.gst-mark { position: fixed; left: 0; top: 0; display: flex; flex-direction: column; align-items: center; pointer-events: auto; cursor: pointer; }
.gst-mark[hidden] { display: none !important; }
.gst-name { font: 600 12px "Exo 2", system-ui, sans-serif; letter-spacing: 0.02em; white-space: nowrap; line-height: 1;
  margin-bottom: 3px; color: var(--gst, #52e4e8);
  text-shadow: 0 0 2px rgba(8,10,14,0.95), 0 0 2px rgba(8,10,14,0.95), 0 0 3px rgba(8,10,14,0.9), 0 1px 2px rgba(0,0,0,0.9); }
.gst-name.is-muted { visibility: hidden; }
.gst-tri { display: block; filter: drop-shadow(0 1px 1.5px rgba(0,0,0,0.6)); }
.gst-mark:hover .gst-name, .gst-mark:focus-visible .gst-name { color: #fff; }
.gst-mark:focus-visible { outline: none; }
.gst-mark:focus-visible .gst-tri polygon { stroke: #fff; }
`;

/** Where a mark's element goes so its ▼'s tip sits on the point: bottom centre. */
export function markOffset(width, height) {
  return { dx: -width / 2, dy: -height };
}

/**
 * Names that would overlap an earlier one are muted, the ▼ kept: every station
 * stays findable, and two names are never drawn on top of each other.
 */
export function declutter(boxes, pad = 2) {
  const shown = [];
  return boxes.map((b) => {
    if (!b) return false;
    const clash = shown.some((s) => b.left < s.right + pad && b.right + pad > s.left && b.top < s.bottom + pad && b.bottom + pad > s.top);
    if (!clash) shown.push(b);
    return !clash;
  });
}

/**
 * Mount the overlay. `getStations()` returns `[{ id, name, lat, lon, colour }]`,
 * `isShown()` whether the stations' layer is visible, `onPick(station)` a
 * click on one. Returns `{ refresh, destroy }`.
 */
export function mountStationMarkers({ getStations, isShown = () => true, onPick = () => {}, size = 14 } = {}) {
  if (typeof document === "undefined") return { refresh() {}, destroy() {} };
  if (!document.getElementById("gst-style")) {
    const tag = document.createElement("style"); tag.id = "gst-style"; tag.textContent = STYLE; document.head.appendChild(tag);
  }
  const host = document.createElement("div");
  host.className = "gst-host";
  document.body.appendChild(host);
  const els = new Map();
  let raf = 0; let alive = true;

  const build = (st) => {
    const el = document.createElement("div");
    el.className = "gst-mark"; el.tabIndex = 0; el.setAttribute("role", "button");
    const w = size; const h = Math.round(size * 0.88);
    el.innerHTML = `<span class="gst-name"></span><svg class="gst-tri" width="${w + 2}" height="${h + 2}" viewBox="0 0 ${w + 2} ${h + 2}" aria-hidden="true">
      <polygon points="1,1 ${w + 1},1 ${w / 2 + 1},${h + 1}" stroke="rgba(8,10,14,0.92)" stroke-width="1.6" stroke-linejoin="round"></polygon></svg>`;
    el.addEventListener("click", (e) => { e.stopPropagation(); onPick(els.get(el.dataset.id)?.station || st); });
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(els.get(el.dataset.id)?.station || st); } });
    host.appendChild(el);
    return el;
  };

  const sync = () => {
    const list = getStations() || [];
    const keep = new Set(list.map((s) => s.id));
    for (const [id, rec] of els) if (!keep.has(id)) { rec.el.remove(); els.delete(id); }
    for (const st of list) {
      let rec = els.get(st.id);
      if (!rec) { rec = { el: build(st), station: st }; rec.el.dataset.id = st.id; els.set(st.id, rec); }
      rec.station = st;
      if (rec.name !== st.name) { rec.el.querySelector(".gst-name").textContent = st.name; rec.name = st.name; rec.el.setAttribute("aria-label", `Sampling station ${st.name}`); }
      if (rec.colour !== st.colour) { rec.el.style.setProperty("--gst", st.colour); rec.el.querySelector("polygon").setAttribute("fill", st.colour); rec.colour = st.colour; }
    }
  };

  const frame = () => {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    const v = window.GeoIDViewer;
    const geo = v?.scene?.getObjectByName?.("GeoID-ImportedGeoLayers");
    const off = !els.size || !v?.camera || !geo || !isShown()
      || document.body.classList.contains("studio-open") || document.body.classList.contains("research-open");
    if (off) { host.hidden = true; return; }
    host.hidden = false;
    const cam = v.camera; const canvas = v.renderer?.domElement;
    const box = canvas?.getBoundingClientRect?.();
    if (!box) return;
    const centre = new cam.position.constructor();
    (v.earthSceneGroup || v.globe)?.getWorldPosition?.(centre);
    const toCam = cam.position.clone().sub(centre);
    const placed = [];
    for (const [, rec] of els) {
      const st = rec.station;
      const local = v.surfacePoint?.(st.lat, st.lon, 0);
      if (!local) { rec.el.hidden = true; placed.push(null); continue; }
      const world = geo.localToWorld(local.clone());
      const n = world.clone().sub(centre);
      const r = n.length();
      // Tangent-plane horizon: visible only while the camera is on the outward
      // side of the plane touching the globe at the station.
      if (!(toCam.dot(n) / r > r * 0.9995)) { rec.el.hidden = true; placed.push(null); continue; }
      const p = world.project(cam);
      if (p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1) { rec.el.hidden = true; placed.push(null); continue; }
      const x = (p.x * 0.5 + 0.5) * box.width + box.left;
      const y = (-p.y * 0.5 + 0.5) * box.height + box.top;
      rec.el.hidden = false;
      const w = rec.el.offsetWidth; const h = rec.el.offsetHeight;
      const { dx, dy } = markOffset(w, h);
      rec.el.style.transform = `translate(${Math.round(x + dx)}px, ${Math.round(y + dy)}px)`;
      const nameEl = rec.el.firstElementChild;
      const nw = nameEl.offsetWidth; const nh = nameEl.offsetHeight;
      placed.push({ rec, box: { left: x - nw / 2, right: x + nw / 2, top: y + dy, bottom: y + dy + nh } });
    }
    const ok = declutter(placed.map((p) => p?.box || null));
    placed.forEach((p, i) => { if (p) p.rec.el.firstElementChild.classList.toggle("is-muted", !ok[i]); });
  };

  sync();
  raf = requestAnimationFrame(frame);
  return {
    refresh: sync,
    destroy() { alive = false; cancelAnimationFrame(raf); host.remove(); els.clear(); },
    host,
  };
}
