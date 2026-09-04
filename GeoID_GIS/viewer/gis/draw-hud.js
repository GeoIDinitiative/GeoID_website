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
  box: "Press and drag on the globe to draw a rectangle · corners resize, edges move",
  circle: "Press the centre and drag the radius",
  triangle: "Press the centre and drag the size",
  square: "Press the centre and drag the size",
  pentagon: "Press the centre and drag the size",
  hexagon: "Press the centre and drag the size",
  poly: "Click to place vertices · Done saves the shape",
  shaped: "Drag corners to resize, edges to move · Done saves it as a layer · Enter = Done",
  line: "Click along your line · every leg states its own length · the export button writes the CSV",
  profile: "Click two points for a terrain section · the export button writes the CSV",
  points: "Click the globe to drop points · Done files them as a layer",
  none: "Choose a shape, or a measure tool on the right",
};

/**
 * No shape until one is chosen. The bar used to arm on Rectangle, so picking
 * up the tool had already decided for you and the first press drew one.
 */
let shape = "";
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
  border: 1px solid rgba(var(--skin-data-rgb), 0.4);
  background: var(--skin-tab-ground, rgb(16, 7, 36));
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
.draw-hud-btn:hover { border-color: rgba(var(--skin-data-rgb), 0.7); color: #ffffff; }
.draw-hud-btn.is-glyph { padding: 0.2rem 0.42rem; line-height: 0; }
.draw-hud-btn.is-glyph svg { width: 1rem; height: 1rem; display: block; }
/* The measure tools are their own group, told apart by a rule rather than by
   a gap — the same hairline the export slot draws, so the bar reads as three
   runs (shapes · measures · actions) rather than eleven equal buttons. */
.draw-hud-measure { display: flex; align-items: center; gap: 0.25rem; }
.draw-hud-measure::before {
  content: "";
  width: 1px;
  align-self: stretch;
  margin: 0.1rem 0.2rem 0.1rem 0.1rem;
  background: rgba(255, 255, 255, 0.16);
}
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
  /* The arrow LEAVES the tray. It pointed down into it, which is the glyph
     every browser and file manager uses for a download — so the one control
     on this bar that sends data OUT was wearing the icon for bringing data
     in. Reported as exactly that. Same tray, arrowhead at the top. */
  --export-glyph: url("data:image/svg+xml;utf8,\
<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>\
<path d='M12 4v10.5' stroke='black' stroke-width='2' stroke-linecap='round' fill='none'/>\
<path d='M7.5 8.5 12 4l4.5 4.5' stroke='black' stroke-width='2' stroke-linecap='round' \
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
  border-color: rgba(var(--skin-data-rgb), 0.9);
  background: rgba(var(--skin-data-rgb), 0.18);
  color: #ffffff;
}
.draw-hud-btn.is-done {
  border-color: rgba(var(--skin-chrome-rgb), 0.6);
  color: #ff9bea;
}
.draw-hud-btn.is-done:hover { background: rgba(var(--skin-chrome-rgb), 0.16); color: #ffffff; }
#gis-draw-hint {
  padding: 0.18rem 0.6rem;
  border-radius: 0.35rem;
  background: var(--skin-tab-ground, rgb(16, 7, 36));
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
function profileArmed() {
  return byId("tool-rail-profile")?.classList.contains("is-active") || false;
}
function pointsArmed() {
  return byId("tool-rail-points-btn")?.classList.contains("is-active") || false;
}

/**
 * WHICH TOOL IS ARMED, read off the rail rather than remembered here.
 *
 * The rail's `is-active` is the viewer's own answer, and every path that arms
 * a tool goes through it — rail clicks, key shortcuts, this bar's own buttons
 * and other modules alike. Remembering the last press instead is how a bar
 * comes to disagree with the globe it is sitting on.
 */
function armedMode() {
  if (areaArmed()) return "area";
  // The Distance tool arms `route`: one multi-point line, so drawing a
  // polyline and measuring a distance are one act. The rail button keeps its
  // id — several modules address it — and only what it arms has changed.
  if (lineArmed()) return "route";
  if (profileArmed()) return "profile";
  if (pointsArmed()) return "points";
  return null;
}

function hasShape() {
  return (window.GeoIDViewer?.getExtractionGeometry?.()?.vertices?.length || 0) >= 3;
}

function setShape(next) {
  shape = next;
  // "" travels as "": the viewer reads an unset property as the old default
  // and an empty one as "waiting", which is the difference that lets a world
  // with no Draw bar behave exactly as it always did.
  window.GeoIDDrawShape = next ? (next === "line" ? "poly" : next) : "";
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

  /**
   * Ordered BY NUMBER OF SIDES: a line, a circle, then three, four, four
   * again, five, six — and Custom last, because it has as many as you draw.
   * The two four-sided ones sit together, the regular square before the
   * rectangle you drag out to any aspect.
   */
  icon("circle", "Circle",
    '<circle cx="11" cy="11" r="7.2" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    "press the centre, drag the radius");
  ngon("triangle", "Triangle", 3, 0);
  ngon("square", "Square", 4, 45);
  icon("box", "Rectangle",
    '<rect x="2.6" y="5.6" width="16.8" height="10.8" rx="1" fill="none"'
    + ' stroke="currentColor" stroke-width="1.8"/>',
    "press and drag out a rectangle");
  ngon("pentagon", "Pentagon", 5, 0);
  ngon("hexagon", "Hexagon", 6, 0);
  make("poly", "Custom", "Click out your own vertices");

  /**
   * THE MEASURE TOOLS, on the same bar as the shapes.
   *
   * Distance and Profile were rail buttons on the other side of the screen
   * while the bar held everything else the pointer does over the globe — and
   * the bar was already showing for Distance, because the old "Line" shape
   * armed exactly that mode. So Line IS this button: keeping both would have
   * been two controls for one mode, which is the fault this tree records
   * paying for in the Polygons tab and the clip tools.
   *
   * They ARM through the rail's own buttons rather than re-implementing it.
   * One arming path, the way `setShape` already reaches for the same clicks —
   * and it is what keeps the rail's active state, the viewer's own mode and
   * this bar from ever disagreeing.
   */
  const measure = el("div", "draw-hud-measure");
  const mode = (id, label, glyph, hint) => {
    const button = el("button", "draw-hud-btn is-glyph", "");
    button.type = "button";
    button.dataset.mode = id;
    button.title = `${label} — ${hint}`;
    button.setAttribute("aria-label", label);
    button.innerHTML = `<svg viewBox="0 0 22 22" aria-hidden="true">${glyph}</svg>`;
    button.addEventListener("click", () => {
      // Pressing the mode you are already in is not a request to leave it:
      // that would stand the bar down under the hand that just pressed.
      if (armedMode() === id) return;
      setShape("");
      // The Points tool builds its own rail button and names it differently;
      // everything else is `tool-rail-<mode>`.
      byId(id === "points" ? "tool-rail-points-btn" : `tool-rail-${id}`)?.click();
      refresh();
    });
    measure.appendChild(button);
    return button;
  };
  mode("distance", "Distance",
    '<path d="M4.5 17 17.5 5" fill="none" stroke="currentColor" stroke-width="1.8"'
    + ' stroke-linecap="round"/><circle cx="4.5" cy="17" r="1.9" fill="currentColor"/>'
    + '<circle cx="17.5" cy="5" r="1.9" fill="currentColor"/>',
    "click out a line of points; every leg states its own length");
  mode("points", "Points",
    '<circle cx="11" cy="11" r="2.9" fill="currentColor"/>'
    + '<path d="M11 2.9v3.6M11 15.5v3.6M2.9 11h3.6M15.5 11h3.6" fill="none"'
    + ' stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    "click the globe to drop points; Done files them as a layer");
  mode("profile", "Profile",
    '<path d="M3.5 15h3l2.1-5 2.6 2.5 2-5.7 2.3 2.9h3" fill="none"'
    + ' stroke="currentColor" stroke-width="1.8" stroke-linecap="round"'
    + ' stroke-linejoin="round"/>',
    "click two points for a terrain section");
  row.appendChild(measure);

  const doneBtn = el("button", "draw-hud-btn is-done", "Done");
  doneBtn.type = "button";
  doneBtn.title = "Save what you have drawn as a layer (Enter)";
  doneBtn.addEventListener("click", () => {
    /**
     * Done means "file what I placed", and for the Points tool that is its
     * OWN finish — Enter, which is the gesture that tool already answers to.
     * Calling `captureDrawn` there would try to make a polygon out of points
     * that were never a polygon.
     */
    if (armedMode() === "points") {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      return;
    }
    done();
  });
  const cancelBtn = el("button", "draw-hud-btn", "✕");
  cancelBtn.type = "button";
  cancelBtn.title = "Clear and put the tool away";
  cancelBtn.addEventListener("click", cancel);
  // Where the viewer's own Export CSV is parked while the bar is up. Empty
  // until there is something to export, and `:empty` keeps the divider off.
  const exportSlot = el("div");
  exportSlot.id = "gis-draw-export-slot";
  row.append(doneBtn, exportSlot, cancelBtn);
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
const EXPORT_MODES = ["area", "route", "profile", "points"];
const exportSelector = (mode) => `[data-measure-actions="${mode}"]`;
/**
 * One comment per mode, because each node has its own home to go back to.
 * A single marker would send whichever node was borrowed last back to
 * whichever rail item was borrowed from first.
 */
const exportHomes = new Map();

/**
 * Park the ARMED mode's own export button, and send any other one home.
 *
 * It used to borrow `area`'s unconditionally — while the bar has always shown
 * for the Distance tool too, so measuring a distance offered a button that
 * exports an AREA. The wrong file, from a control that looked right.
 */
function borrowExport(mode = armedMode()) {
  const slot = byId("gis-draw-export-slot");
  if (!slot) return;
  // Anything already parked that is not this mode's goes back first, or two
  // modes' buttons sit side by side and neither says which it belongs to.
  [...slot.children].forEach((node) => {
    if (node.dataset?.measureActions !== mode) returnOne(node);
  });
  if (!mode) return;
  const actions = document.querySelector(exportSelector(mode));
  if (!actions || actions.parentNode === slot) return;
  if (!exportHomes.has(mode)) {
    const marker = document.createComment(`export csv (${mode}) lives on the draw bar`);
    actions.parentNode?.insertBefore(marker, actions);
    exportHomes.set(mode, marker);
  }
  slot.appendChild(actions);
}

/** Put one borrowed node back beside its own marker. */
function returnOne(node) {
  const home = exportHomes.get(node?.dataset?.measureActions);
  if (node && home?.parentNode) home.parentNode.insertBefore(node, home);
}

let exportWatch = null;
// The mode whose export button is currently parked on the bar.
let lastMode = null;

/**
 * Borrow the instant the viewer reveals it, not on the next poll tick.
 *
 * `refresh` runs every 250 ms, and the viewer un-hides this node the moment
 * the Area tool is armed — so between the two the button was visible in its
 * HOME, in the right-hand rail, directly beneath the very button that had
 * just been pressed. Measured on Mars: visible at (1340, 260) at 23 ms and
 * gone to the bar at (860, 79) by 101 ms. Reported, accurately, as the old
 * Export CSV button flickering beneath the draw tool.
 *
 * An observer rather than a click handler on the rail button, because arming
 * comes from rail clicks, key shortcuts and other modules alike — the same
 * reason this file polls at all. The callback runs in the mutation's own
 * microtask, before the browser paints, so there is no frame in which the
 * button is in the wrong place.
 */
function watchExportHome() {
  if (exportWatch || typeof MutationObserver !== "function") return;
  const nodes = EXPORT_MODES.map(exportSelector)
    .map((sel) => document.querySelector(sel)).filter(Boolean);
  if (!nodes.length) return;
  exportWatch = new MutationObserver(() => {
    if (armedMode()) borrowExport();
  });
  // All three, because the tool that is armed decides which one is wanted and
  // any of them may be revealed while the bar is up.
  nodes.forEach((node) => exportWatch.observe(node,
    { attributes: true, attributeFilter: ["hidden", "style", "class"] }));
}

function returnExport() {
  const slot = byId("gis-draw-export-slot");
  if (slot) [...slot.children].forEach(returnOne);
}

function refresh() {
  const hud = byId("gis-draw-hud");
  if (!hud) return;
  const area = areaArmed();
  const line = lineArmed();
  const mode = armedMode();
  // Profile joins the two that already raised the bar, now that its button is
  // on it: a bar that hides the tool you just armed from it is worse than no
  // button at all.
  const show = Boolean(mode);
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
    if (show) {
      borrowExport(mode);
      // Every time the tool is picked up, not just the first: coming back to
      // whatever was drawn last is the same decision made for somebody twice.
      if (mode === "area") setShape("");
    } else {
      returnExport();
    }
  }
  if (!show) return;
  /**
   * The armed MODE can change without the bar coming down — pressing Profile
   * while Distance is up — and the parked export button has to follow it, or
   * the bar offers the previous tool's file.
   */
  if (mode !== lastMode) {
    lastMode = mode;
    borrowExport(mode);
  }
  const current = shape;
  hud.querySelectorAll("[data-shape]").forEach((button) => {
    button.classList.toggle("is-on",
      mode === "area" && Boolean(current) && button.dataset.shape === current);
  });
  hud.querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("is-on", button.dataset.mode === mode);
  });
  const hint = byId("gis-draw-hint");
  if (hint && !hint.dataset.hold) {
    hint.textContent = mode === "points" ? HINTS.points
      : mode === "route" ? HINTS.line
      : mode === "profile" ? HINTS.profile
        : !current ? HINTS.none
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

/**
 * A button that cannot do its job is stood down, and says why.
 *
 * Gating the HUD was only half of it: the Draw button itself stayed live on
 * the gas giants, enabled, labelled "Activate draw tool", and taking the
 * active state on click. Measured on Jupiter — armed, then three clicks on
 * the globe produced ZERO measure points, no line and an empty readout,
 * because area routes through `activateStudyArea` and there is none. That is
 * this file's own rule pointed at itself: wire it or leave it disabled.
 *
 * Only AREA. Distance and Profile go through the ordinary measure path and
 * work perfectly there — measured, two points each on Jupiter — so
 * disabling the row wholesale would take away two tools that do their job.
 */
function standDownDrawButton() {
  const button = byId("tool-rail-area");
  if (!button || button.disabled) return;
  button.disabled = true;
  button.title = "This world has no surface to draw a study area on. "
    + "Distance and Profile still work.";
  button.setAttribute("aria-disabled", "true");
  button.classList.remove("is-active");
}

/** A seam that turned up late: give the button back before building. */
function reviveDrawButton() {
  const button = byId("tool-rail-area");
  if (!button || !button.disabled) return;
  button.disabled = false;
  button.removeAttribute("aria-disabled");
  button.title = "";
}

/**
 * Ten seconds, not sixty.
 *
 * The retry runs to 120 tries because a seam can genuinely be late, but a
 * button must not sit there enabled and lying for the whole of that: measured
 * on Mars, both the seam and the HUD are up before a probe fired immediately
 * after load could even look. So the button is stood down at 20 tries and the
 * watch continues to 120 — a late seam takes it back.
 */
const STAND_DOWN_AFTER = 20;

function init() {
  if (!byId("tool-rail-area") || !canDraw()) {
    // The viewer boots async, so a missing seam this early is usually just
    // early. Keep looking, and stop after a minute rather than polling a
    // gas giant for the life of the page.
    if (initTries >= STAND_DOWN_AFTER) standDownDrawButton();
    if (initTries < 120) {
      initTries += 1;
      window.setTimeout(init, 500);
    }
    return;
  }
  // The seam is here, however late: the button is usable again.
  reviveDrawButton();
  build();
  watchExportHome();
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
