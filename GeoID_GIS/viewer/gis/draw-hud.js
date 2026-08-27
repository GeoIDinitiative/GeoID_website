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
  poly: "Click to place vertices · Done saves the shape",
  shaped: "Drag corners to resize, edges to move · Done saves it as a layer · Enter = Done",
  line: "Click two points for a transect · the measure panel exports it",
};

let shape = "box";
let visible = false;

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
  make("box", "Box", "Press and drag to draw a box");
  make("circle", "Circle", "Press the centre, drag the radius");
  make("poly", "Polygon", "Click out vertices");
  make("line", "Line", "A transect through the Distance tool");
  const doneBtn = el("button", "draw-hud-btn is-done", "Done");
  doneBtn.type = "button";
  doneBtn.title = "Save the shape as a layer (Enter)";
  doneBtn.addEventListener("click", done);
  const cancelBtn = el("button", "draw-hud-btn", "✕");
  cancelBtn.type = "button";
  cancelBtn.title = "Clear and put the tool away";
  cancelBtn.addEventListener("click", cancel);
  row.append(doneBtn, cancelBtn);
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

function refresh() {
  const hud = byId("gis-draw-hud");
  if (!hud) return;
  const area = areaArmed();
  const line = lineArmed();
  const show = area || line;
  if (hud.hidden === show) hud.hidden = !show;
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

function init() {
  if (!byId("tool-rail-area")) {
    window.setTimeout(init, 500);
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
