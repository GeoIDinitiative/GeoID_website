/**
 * The Points tool: click the globe, drop a point; Done files the set.
 *
 * The third way data comes in, beside uploading a file and drawing a shape:
 * marking PLACES. Sample sites, boreholes, observation stations — a handful
 * of coordinates somebody knows by looking, which used to mean typing a CSV
 * by hand. A rail button arms the tool; each click on the globe drops a
 * numbered point (live preview dots, spin-aware); Done imports them as an
 * ordinary Workspace layer through the same `importFileList` a dropped
 * GeoJSON uses — so symbology, extraction, the project registry and the
 * data-tag card all just happen, and Cancel or Escape throws them away.
 *
 * Built on existing seams and nothing else:
 *  - Earth: `surfaceLatLonAt(x, y)` — the viewer's own ground pick, taps
 *    gated so orbit drags stay drags;
 *  - the rocky planets: `pickOnGlobe()` — the seam every world carries —
 *    chained in a loop while the tool is armed. Its one-shot pick resolves
 *    on pointerdown and swallows the event, so orbiting while armed is not
 *    possible there: arm, click your points, Done. Gas giants have no
 *    surface to mark and never build the button;
 *  - `GeoIDProjectLatLon` — the spin-aware projection the drag handles and
 *    area labels already use, so the preview dots ride the turning globe
 *    without this module owning any 3D;
 *  - `importFileList(files, { name })` — the one importer.
 *
 * It replaced the Workspace "Custom" button, whose only unique moment was
 * "shape drawn but not yet captured" — which the Draw HUD's Done already
 * answers — and whose empty-handed press could only nag ("Draw an area
 * first…", stacking a note per press).
 */

const byId = (id) => document.getElementById(id);

const state = {
  armed: false,
  points: [],           // { lat, lon } in the viewer's own convention
  overlay: null,        // fixed full-screen div holding the preview dots
  chip: null,           // the floating Done/Cancel bar
  raf: 0,
  savedCursor: "",
  pickPending: false,
  epoch: 0,
  counter: 1,           // "Points N" layer naming across one session
};

/* ── The GeoJSON the set becomes — pure, for the test ───────────────────── */

export function pointsToGeoJSON(points, signedLon = (lon) => ((lon + 540) % 360) - 180) {
  return {
    type: "FeatureCollection",
    features: points.map((p, i) => ({
      type: "Feature",
      // Rounded to ~1 m: the modulo in signedLon leaves float residue
      // (45.1 → 45.10000000000002), and a hand-clicked point carries no
      // precision past the fifth decimal anyway.
      geometry: { type: "Point", coordinates: [+signedLon(p.lon).toFixed(5), +p.lat.toFixed(5)] },
      properties: {
        name: `Point ${i + 1}`,
        lat: +p.lat.toFixed(5),
        lon: +signedLon(p.lon).toFixed(5),
        placed_at: new Date().toISOString(),
      },
    })),
  };
}

/* ── Preview: HTML dots reprojected per frame ───────────────────────────── */

function ensureOverlay() {
  if (state.overlay) return state.overlay;
  const el = document.createElement("div");
  el.id = "point-tool-overlay";
  // Under the chrome (sidebar is 10), over the canvas — the annotation rule.
  el.style.cssText = "position:fixed;inset:0;z-index:5;pointer-events:none;";
  document.body.appendChild(el);
  return (state.overlay = el);
}

function redrawPreview() {
  const project = window.GeoIDProjectLatLon;
  const overlay = ensureOverlay();
  const dots = overlay.children;
  state.points.forEach((p, i) => {
    let dot = dots[i];
    if (!dot) {
      dot = document.createElement("div");
      dot.style.cssText = "position:absolute;width:11px;height:11px;margin:-5.5px 0 0 -5.5px;"
        + "border-radius:50%;background:#ffd166;border:2px solid rgba(10,10,18,0.9);"
        + "box-shadow:0 0 6px rgba(255,209,102,0.8);";
      overlay.appendChild(dot);
    }
    const at = project?.(p.lat, p.lon);
    dot.style.display = at ? "block" : "none";   // behind the limb: hidden
    if (at) { dot.style.left = `${at.x}px`; dot.style.top = `${at.y}px`; }
  });
  while (overlay.children.length > state.points.length) overlay.lastChild.remove();
}

function previewLoop() {
  if (!state.armed && !state.points.length) return;
  redrawPreview();
  state.raf = requestAnimationFrame(previewLoop);
}

/* ── The floating chip: count, Done, Cancel ─────────────────────────────── */

function ensureChip() {
  if (state.chip) return state.chip;
  const chip = document.createElement("div");
  chip.id = "point-tool-chip";
  chip.style.cssText = "position:fixed;top:4.4rem;left:50%;transform:translateX(-50%);"
    + "z-index:12;display:flex;gap:0.45rem;align-items:center;padding:0.35rem 0.6rem;"
    + "border:1px solid rgba(var(--nav-accent-rgb,255,43,214),0.55);border-radius:999px;"
    + "background:rgba(12,10,22,0.92);font:600 0.66rem/1 'Exo 2',sans-serif;color:var(--text,#eee);";
  const count = document.createElement("span");
  count.dataset.role = "count";
  const done = document.createElement("button");
  done.type = "button";
  done.className = "button";
  done.textContent = "Done";
  done.addEventListener("click", finish);
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "button secondary";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => disarm(true));
  chip.append(count, done, cancel);
  document.body.appendChild(chip);
  return (state.chip = chip);
}

function syncChip() {
  const chip = ensureChip();
  chip.hidden = !state.armed;
  const n = state.points.length;
  chip.querySelector("[data-role=count]").textContent = n
    ? `${n} point${n === 1 ? "" : "s"} — click to add more`
    : "Click the globe to drop a point";
}

/* ── Arming, clicking, finishing ────────────────────────────────────────── */

let downAt = null;

function onPointerDown(event) {
  if (!state.armed || event.button !== 0) return;
  // The CANVAS only: these are window-level captures, and without this a
  // click on any panel button would drop a point under the sidebar.
  if (event.target !== window.GeoIDViewer?.renderer?.domElement) return;
  downAt = { x: event.clientX, y: event.clientY };
}

function onPointerUp(event) {
  if (!state.armed || !downAt) return;
  const moved = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y);
  downAt = null;
  if (moved > 6) return;                       // a drag is the orbit's, not ours
  // A measure tool armed alongside would ALSO take this tap; stand down to it.
  if (document.querySelector(".tool-rail-btn.is-active[data-measure-mode]")) return;
  const at = window.GeoIDViewer?.surfaceLatLonAt?.(event.clientX, event.clientY);
  if (!at) return;                             // missed the globe
  state.points.push({ lat: at.lat, lon: at.lon });
  redrawPreview();
  syncChip();
}

function onKey(event) {
  if (!state.armed) return;
  if (event.key === "Escape") disarm(true);
  if (event.key === "Enter" && state.points.length) finish();
}

/** Which pick path this world offers. */
function pickMode() {
  const v = window.GeoIDViewer;
  if (v?.surfaceLatLonAt) return "taps";
  if (v?.pickOnGlobe && window.GeoIDProjectLatLon && v?.setStudyAreaPolygon) return "picker";
  return null;
}

/**
 * The planet path: chain the seam's one-shot pick while armed. The epoch
 * guards a stale loop — Done during a pending pick leaves that pick armed
 * until its next click, and its resolution must not write into a set that
 * has since been filed.
 */
async function pickLoop() {
  const epoch = state.epoch;
  while (state.armed && state.epoch === epoch) {
    let at;
    try {
      state.pickPending = true;
      at = await window.GeoIDViewer.pickOnGlobe();
    } catch (error) {
      // Escape inside the pick: the tool stands down with it.
      if (state.epoch === epoch) disarm(true);
      return;
    } finally {
      state.pickPending = false;
    }
    if (!state.armed || state.epoch !== epoch) return;
    state.points.push({ lat: at.lat, lon: at.lon });
    redrawPreview();
    syncChip();
  }
}

function arm() {
  if (state.armed) return;
  state.armed = true;
  // One tool at a time: an armed measure tool would eat the same taps.
  document.querySelector(".tool-rail-btn.is-active[data-measure-mode]")?.click();
  byId("tool-rail-points-btn")?.classList.add("is-active");
  const canvas = window.GeoIDViewer?.renderer?.domElement;
  if (canvas) {
    state.savedCursor = canvas.style.cursor;
    canvas.style.cursor = "crosshair";
  }
  syncChip();
  cancelAnimationFrame(state.raf);
  previewLoop();
  if (pickMode() === "picker") pickLoop();
}

function disarm(discard) {
  state.armed = false;
  state.epoch += 1;
  // A pending one-shot pick keeps its own listeners until it settles; its
  // Escape path is the one handle we have on it from outside.
  if (state.pickPending) {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  }
  if (discard) state.points = [];
  byId("tool-rail-points-btn")?.classList.remove("is-active");
  const canvas = window.GeoIDViewer?.renderer?.domElement;
  if (canvas) canvas.style.cursor = state.savedCursor;
  if (state.chip) state.chip.hidden = true;
  redrawPreview();
  if (!state.points.length) cancelAnimationFrame(state.raf);
}

async function finish() {
  if (!state.points.length) { disarm(true); return; }
  const name = `Points ${state.counter}`;
  const geojson = pointsToGeoJSON(state.points);
  const file = new File([JSON.stringify(geojson)], `${name}.geojson`, { type: "application/geo+json" });
  state.points = [];
  disarm(true);
  // frame:false — the points were just placed on screen; flying the camera
  // to their bounds would move the very view they were placed in.
  await window.GeoIDImportManager?.importFileList?.([file], { name, frame: false });
  state.counter += 1;
}

/* ── The rail button, with the measure tools it belongs beside ──────────── */

function buildRailButton() {
  const rail = byId("tool-rail");
  if (!rail || byId("tool-rail-points-btn")) return false;
  const item = document.createElement("div");
  item.className = "tool-rail-item";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tool-rail-btn";
  button.id = "tool-rail-points-btn";
  button.title = "Points: click the globe to drop points, Done files them as a layer";
  button.setAttribute("aria-label", button.title);
  // A dot being placed: pin cross-hairs around a filled centre.
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">'
    + '<circle cx="12" cy="12" r="3.1" fill="currentColor"/>'
    + '<path d="M12 3.4v4M12 16.6v4M3.4 12h4M16.6 12h4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'
    + '</svg><span>Points</span>';
  button.addEventListener("click", () => (state.armed ? disarm(true) : arm()));
  item.appendChild(button);
  // With the measure tools, before the workbench buttons.
  const firstPanelItem = rail.querySelector("[data-panel-item]");
  if (firstPanelItem) rail.insertBefore(item, firstPanelItem);
  else rail.appendChild(item);
  return true;
}

if (typeof document !== "undefined") {
  // The rail exists in markup; the seams boot async. Retry until both stand.
  let tries = 0;
  const attempt = () => {
    const ready = pickMode() && buildRailButton();
    if (ready) {
      window.addEventListener("pointerdown", onPointerDown, true);
      window.addEventListener("pointerup", onPointerUp, true);
      window.addEventListener("keydown", onKey, true);
      return;
    }
    if ((tries += 1) < 80) setTimeout(attempt, 500);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attempt);
  else attempt();
}
