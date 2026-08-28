/**
 * The Draw HUD: one compact bar over the canvas whenever a drawing tool is
 * armed, carrying the whole grammar in one place — which SHAPE a drag
 * draws (box, circle, or polygon-by-taps), a hint line that always says
 * the next step, and Done / Cancel.
 *
 * This is the front door the scattered forms could never be: the Extract
 * panel's box preset and the weather card's size inputs remain as the
 * PRECISE path (they drive the same geometry engine), but the hands-first
 * path starts here. Done captures the shape as a relief-hugging layer via
 * the same `captureDrawn` the Custom button uses; Cancel clears the
 * overlay and puts the tool away.
 *
 * The shape choice travels to the viewer as `window.GeoIDDrawShape` —
 * "box" and "circle" drag-draw, "poly" leaves drags to the orbit controls
 * so taps place vertices in peace.
 */

const byId = (id) => document.getElementById(id);

const HINTS = {
  box: "Press and drag on the globe to draw a box · corners resize, edges move",
  circle: "Press the centre and drag the radius",
  triangle: "Press the centre and drag the size",
  square: "Press the centre and drag the size",
  pentagon: "Press the centre and drag the size",
  hexagon: "Press the centre and drag the size",
  poly: "Click to place vertices · Done saves the shape",
  shaped: "Drag corners to resize, edges to move · Done saves it as a layer · Enter = Done",
  line: "Click two points for a transect · the measure panel exports it",
};

let shape = "box";
let visible = false;
let initTries = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function installStyle() {
  if (byId("gis-draw-hud-style")) return;
  const style = document.createElement("style");
  style.id = "gis-draw-hud-style";
  style.textContent = `
#gis-draw-hud {
  position: fixed;
  top: 4.6rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 14;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.28rem;
}
#gis-draw-hud[hidden] { display: none !important; }
.draw-hud-row {
  display: flex;
  gap: 0.3rem;
  padding: 0.3rem 0.4rem;
  border-radius: 0.6rem;
  border: 1px solid rgba(82, 228, 232, 0.4);
  background: rgba(8, 13, 20, 0.94);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.4);
}
.draw-hud-btn {
  padding: 0.26rem 0.6rem;
  border-radius: 0.4rem;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: transparent;
  color: #d5e8ee;
  font: 600 0.64rem/1 'Exo 2', sans-serif;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
}
.draw-hud-btn:hover { border-color: rgba(82, 228, 232, 0.7); color: #ffffff; }
.draw-hud-btn.is-glyph { padding: 0.2rem 0.42rem; line-height: 0; }
.draw-hud-btn.is-glyph svg { width: 1rem; height: 1rem; display: block; }
#gis-draw-export-slot { display: flex; align-items: center; gap: 0.3rem; }
#gis-draw-export-slot:empty { display: none; }
/* Export CSV as its icon — a tray taking an arrow — and ONLY while it is
   parked here. The button belongs to the viewer, which shows and hides it as
   a measurement comes and goes; restyling the node itself would follow it
   home to the rail, where it sits under its button and needs its words. So
   the text is hidden by the SLOT's rule and the glyph is a mask on ::before,
   which takes currentColor and therefore the button's own hover and accent. */
#gis-draw-export-slot .tool-rail-action-btn {
  font-size: 0 !important;
  width: 1.85rem;
  min-width: 0;
  height: 1.55rem;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
#gis-draw-export-slot .tool-rail-action-btn::before {
  content: "";
  width: 0.95rem;
  height: 0.95rem;
  background: currentColor;
  -webkit-mask: var(--export-glyph) center / contain no-repeat;
  mask: var(--export-glyph) center / contain no-repeat;
}
#gis-draw-export-slot {
  --export-glyph: url("data:image/svg+xml;utf8,\
<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>\
<path d='M12 3v10.5' stroke='black' stroke-width='2' stroke-linecap='round' fill='none'/>\
<path d='M7.5 9.5 12 14l4.5-4.5' stroke='black' stroke-width='2' stroke-linecap='round' \
stroke-linejoin='round' fill='none'/>\
<path d='M4 16v3.2h16V16' stroke='black' stroke-width='2' stroke-linecap='round' \
stroke-linejoin='round' fill='none'/></svg>");
}
#gis-draw-export-slot::before {
  content: "";
  width: 1px;
  align-self: stretch;
  margin: 0.1rem 0.15rem 0.1rem 0.05rem;
  background: rgba(255, 255, 255, 0.16);
}
.draw-hud-btn.is-on {
  border-color: rgba(82, 228, 232, 0.9);
  background: rgba(82, 228, 232, 0.18);
  color: #ffffff;
}
.draw-hud-btn.is-done {
  border-color: rgba(255, 43, 214, 0.6);
  color: #ff9bea;
}
.draw-hud-btn.is-done:hover { background: rgba(255, 43, 214, 0.16); color: #ffffff; }
#gis-draw-hint {
  padding: 0.18rem 0.6rem;
  border-radius: 0.35rem;
  background: rgba(8, 13, 20, 0.85);
  color: rgba(190, 226, 232, 0.9);
  font: 500 0.6rem/1.3 'Exo 2', sans-serif;
  letter-spacing: 0.04em;
}
`;
  document.head.appendChild(style);
}

function areaArmed() {
  return byId("tool-rail-area")?.classList.contains("is-active") || false;
}
function lineArmed() {
  return byId("tool-rail-distance")?.classList.contains("is-active") || false;
}

function hasShape() {
  return (window.GeoIDViewer?.getExtractionGeometry?.()?.vertices?.length || 0) >= 3;
}

function setShape(next) {
  shape = next;
  window.GeoIDDrawShape = next === "line" ? "poly" : next;
  if (next === "line" && !lineArmed()) byId("tool-rail-distance")?.click();
  if (next !== "line" && !areaArmed() && lineArmed()) byId("tool-rail-area")?.click();
  refresh();
}

function done() {
  if (!areaArmed()) return;
  const result = window.GeoIDDrawnLayers?.captureDrawn?.();
  const hint = byId("gis-draw-hint");
  if (result?.ok) {
    window.GeoIDViewer?.clearStudyArea?.();
    if (hint) hint.textContent = `Saved: ${result.layer.name} — in Layer Visibility, ready for any tool.`;
  } else if (hint && result?.message) {
    hint.textContent = result.message;
  }
}

function cancel() {
  window.GeoIDViewer?.clearStudyArea?.();
  if (areaArmed()) byId("tool-rail-area")?.click();
  if (lineArmed()) byId("tool-rail-distance")?.click();
}

function build() {
  if (byId("gis-draw-hud")) return;
  installStyle();
  const hud = el("div");
  hud.id = "gis-draw-hud";
  hud.hidden = true;
  const row = el("div", "draw-hud-row");
  const make = (id, label, title) => {
    const button = el("button", "draw-hud-btn", label);
    button.type = "button";
    button.dataset.shape = id;
    button.title = title;
    button.addEventListener("click", () => setShape(id));
    row.appendChild(button);
    return button;
  };
  /**
   * The SHAPES are glyphs; only the two that are not shapes keep words.
   *
   * A row of eight shape names runs past 700 px and off a narrow screen, and
   * a triangle says "triangle" better than the word does. What stays written
   * is Custom — click your own vertices, which no glyph states plainly — and
   * the actions, because Done is a decision and deserves a word.
   *
   * BOX is drawn as a RECTANGLE and the square as a square, on purpose: they
   * are two different gestures (drag out any aspect / drag a regular shape
   * from its centre) and giving both the same picture would be a lie about
   * which one you are picking up.
   */
  const icon = (id, label, inner, hint) => {
    const button = make(id, "", `${label} — ${hint}`);
    button.classList.add("is-glyph");
    button.setAttribute("aria-label", label);
    button.innerHTML = `<svg viewBox="0 0 22 22" aria-hidden="true">${inner}</svg>`;
    return button;
  };
  const ngon = (id, label, sides, spin) => {
    const points = [];
    for (let i = 0; i < sides; i += 1) {
      const a = ((spin + (i * 360) / sides) * Math.PI) / 180;
      points.push(`${(11 + 7.2 * Math.sin(a)).toFixed(2)} ${(11 - 7.2 * Math.cos(a)).toFixed(2)}`);
    }
    return icon(id, label, `<path d="M${points.join("L")}Z" fill="none"`
      + ' stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
    "press the centre, drag the size");
  };

  icon("box", "Box",
    '<rect x="2.6" y="5.6" width="16.8" height="10.8" rx="1" fill="none"'
    + ' stroke="currentColor" stroke-width="1.8"/>',
    "press and drag out a box");
  icon("circle", "Circle",
    '<circle cx="11" cy="11" r="7.2" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    "press the centre, drag the radius");
  ngon("triangle", "Triangle", 3, 0);
  ngon("square", "Square", 4, 45);
  ngon("pentagon", "Pentagon", 5, 0);
  ngon("hexagon", "Hexagon", 6, 0);
  make("poly", "Custom", "Click out your own vertices");
  icon("line", "Line",
    '<path d="M4.5 17 17.5 5" fill="none" stroke="currentColor" stroke-width="1.8"'
    + ' stroke-linecap="round"/><circle cx="4.5" cy="17" r="1.9" fill="currentColor"/>'
    + '<circle cx="17.5" cy="5" r="1.9" fill="currentColor"/>',
    "a transect through the Distance tool");
  const doneBtn = el("button", "draw-hud-btn is-done", "Done");
  doneBtn.type = "button";
  doneBtn.title = "Save the shape as a layer (Enter)";
  doneBtn.addEventListener("click", done);
  const cancelBtn = el("button", "draw-hud-btn", "✕");
  cancelBtn.type = "button";
  cancelBtn.title = "Clear and put the tool away";
  cancelBtn.addEventListener("click", cancel);
  // Where the viewer's own Export CSV is parked while the bar is up. Empty
  // until there is something to export, and `:empty` keeps the divider off.
  const exportSlot = el("div");
  exportSlot.id = "gis-draw-export-slot";
  row.append(doneBtn, cancelBtn, exportSlot);
  const hint = el("div", "", "");
  hint.id = "gis-draw-hint";
  hud.append(row, hint);
  document.body.appendChild(hud);

  document.addEventListener("keydown", (event) => {
    if (hud.hidden) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (event.key === "Enter" && areaArmed() && hasShape()) {
      event.preventDefault();
      done();
    }
  });
}

/**
 * Export CSV is the VIEWER'S OWN button, moved in rather than copied.
 *
 * The viewer holds a live reference to that node and shows or hides it as a
 * measurement comes and goes, so a copy here would be a dead twin of a
 * working control. A comment marks where it came from, so it goes back when
 * the bar stands down. Lifted verbatim from the preset card this replaced —
 * it is the one part of that card worth keeping.
 */
const EXPORT_SELECTOR = '[data-measure-actions="area"]';
let exportHome = null;

function borrowExport() {
  const actions = document.querySelector(EXPORT_SELECTOR);
  const slot = byId("gis-draw-export-slot");
  if (!actions || !slot || actions.parentNode === slot) return;
  if (!exportHome) {
    exportHome = document.createComment("export csv lives on the draw bar while it is up");
    actions.parentNode?.insertBefore(exportHome, actions);
  }
  slot.appendChild(actions);
}

function returnExport() {
  const actions = byId("gis-draw-export-slot")?.firstElementChild;
  if (actions && exportHome?.parentNode) {
    exportHome.parentNode.insertBefore(actions, exportHome);
  }
}

function refresh() {
  const hud = byId("gis-draw-hud");
  if (!hud) return;
  const area = areaArmed();
  const line = lineArmed();
  const show = area || line;
  if (hud.hidden === show) hud.hidden = !show;
  /**
   * Borrow on the TRANSITION, not on every tick.
   *
   * `refresh` is polled, and the viewer moves and rebuilds
   * `.measure-rail-actions` itself as a measurement comes and goes — so
   * calling borrow/return each pass had the two of them passing the node
   * back and forth: measured, Done sent it to the rail and standing the
   * tool down sent it back to the bar, the exact opposite of both. The
   * card this replaced borrowed on open and returned on close; so does this.
   */
  if (show !== visible) {
    visible = show;
    if (show) borrowExport(); else returnExport();
  }
  if (!show) return;
  const current = line ? "line" : shape;
  hud.querySelectorAll("[data-shape]").forEach((button) => {
    button.classList.toggle("is-on", button.dataset.shape === current);
  });
  const hint = byId("gis-draw-hint");
  if (hint && !hint.dataset.hold) {
    hint.textContent = line ? HINTS.line
      : (hasShape() && current !== "poly" ? HINTS.shaped : HINTS[current]);
  }
}

/**
 * A world that cannot hold a study area gets no HUD.
 *
 * The four gas giants carry the Draw button in their markup but have no
 * `activateStudyArea` behind it — there is no surface to draw on, which is
 * a fact about the bodies rather than a gap. Keying on the BUTTON would
 * put Box, Circle, Polygon and Done on Jupiter, all four inert. The seam
 * is the honest test, and it is the same one every drawing path here goes
 * through.
 */
function canDraw() {
  return typeof window.GeoIDViewer?.setStudyAreaPolygon === "function";
}

function init() {
  if (!byId("tool-rail-area") || !canDraw()) {
    // The viewer boots async, so a missing seam this early is usually just
    // early. Keep looking, and stop after a minute rather than polling a
    // gas giant for the life of the page.
    if (initTries < 120) {
      initTries += 1;
      window.setTimeout(init, 500);
    }
    return;
  }
  build();
  window.GeoIDDrawShape = shape;
  // Tool state changes come from rail clicks, key shortcuts and other
  // modules arming the tool on the user's behalf; a poll keeps the HUD
  // honest against every one of them without wiring into each.
  window.setInterval(refresh, 250);
  refresh();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}
