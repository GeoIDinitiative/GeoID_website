/**
 * The Draw tool's own card, beside its rail button.
 *
 * What this replaces, and why: picking up Draw used to MOVE the whole "Extract
 * From Layers" panel into a floating card. That was the answer to a real
 * problem — the box preset sat two collapsed `<details>` deep, so from the rail
 * there was no sign it existed — but it made picking up a pencil open the
 * extraction workbench: source checkboxes, sample spacing, Run Extraction. None
 * of that is drawing. It also emptied the Analysis workbench while Draw was up,
 * because the section can only be in one place at a time.
 *
 * So the card is built here, from nothing the extraction panel owns, and holds
 * only what the tool needs: freehand, and the basic geometries.
 *
 * **Freehand stays the default.** Picking up Draw arms the viewer's own
 * click-out-a-polygon, exactly as before; the card opens beside it offering
 * shapes, and nothing is drawn until one is chosen. A tool that placed a square
 * the moment you picked it up would be a tool you had to undo.
 *
 * Every closed shape goes through the SAME `setStudyAreaPolygon` a hand-drawn
 * one does, so the overlay, the area readout and the extraction cannot tell them
 * apart. A line cannot: it encloses nothing, so it becomes a LineString layer
 * instead of a study area (`captureDrawnLine`), which is what a transect is.
 */

import { regularPolygonVertices, lineVertices } from "./draw-area.js?v=20260817-e6905f9";

/* ── The shapes ──────────────────────────────────────────────────────────────
 *
 * Icons are DERIVED from the same `sides` the geometry uses, so the picture on
 * the button cannot drift from the shape it draws — adding an octagon is a row
 * in this table, not a row and a hand-drawn path that agree until someone edits
 * one of them.
 *
 * `rotationDeg` is the bearing of the first vertex: 0 points a corner north,
 * which gives a flat-bottomed triangle and a pointy-top hexagon, and 45 on a
 * square is the axis-aligned box everyone means by "square".
 */
const ICON_R = 7.6;

function polygonPath(sides, rotationDeg, r = ICON_R, cx = 12, cy = 12) {
  const points = [];
  for (let i = 0; i < sides; i += 1) {
    // Screen space, so north is -y. Same bearing convention as the geometry.
    const a = ((rotationDeg + (i * 360) / sides) * Math.PI) / 180;
    points.push(`${(cx + r * Math.sin(a)).toFixed(2)} ${(cy - r * Math.cos(a)).toFixed(2)}`);
  }
  return `<path d="M${points.join("L")}Z" fill="none" stroke="currentColor"`
    + ` stroke-width="1.7" stroke-linejoin="round"/>`;
}

const SHAPES = [
  {
    id: "freehand",
    label: "Freehand",
    hint: "Click the shape out on the globe, point by point",
    // The rail's own draw glyph: an irregular quad with its vertices showing.
    icon: '<path d="M6 17.5 8 6.2l9 2.4-2.2 9.2z" fill="none" stroke="currentColor"'
      + ' stroke-width="1.7" stroke-linejoin="round"/>'
      + '<circle cx="6" cy="17.5" r="1.5" fill="currentColor"/>'
      + '<circle cx="8" cy="6.2" r="1.5" fill="currentColor"/>'
      + '<circle cx="17" cy="8.6" r="1.5" fill="currentColor"/>'
      + '<circle cx="14.8" cy="17.8" r="1.5" fill="currentColor"/>',
  },
  {
    id: "line",
    label: "Line",
    hint: "A straight transect — a line layer, not a study area",
    sizeLabel: "Length (km)",
    line: true,
    icon: '<path d="M5.5 18 18.5 6" fill="none" stroke="currentColor" stroke-width="1.7"'
      + ' stroke-linecap="round"/>'
      + '<circle cx="5.5" cy="18" r="1.6" fill="currentColor"/>'
      + '<circle cx="18.5" cy="6" r="1.6" fill="currentColor"/>',
  },
  { id: "triangle", label: "Triangle", sides: 3, rotationDeg: 0 },
  { id: "square", label: "Square", sides: 4, rotationDeg: 45 },
  { id: "pentagon", label: "Pentagon", sides: 5, rotationDeg: 0 },
  { id: "hexagon", label: "Hexagon", sides: 6, rotationDeg: 0 },
  {
    id: "circle",
    label: "Circle",
    // Sixty-four segments is within 0.2% of a circle's area and still one
    // segment per 5.6°, so nothing is subdivided at a study-area size.
    sides: 64,
    rotationDeg: 0,
    sizeLabel: "Diameter (km)",
    bySpan: true,
    icon: `<circle cx="12" cy="12" r="${ICON_R}" fill="none" stroke="currentColor" stroke-width="1.7"/>`,
  },
];

const shapeById = (id) => SHAPES.find((s) => s.id === id) || SHAPES[0];

/* ── Style ───────────────────────────────────────────────────────────────────
 *
 * Injected from the module rather than written into a stylesheet, for the
 * reason `side-panels.js` records at length: Earth loads `viewer/styles.css`
 * and the nine planet pages load their own plus `gis/shell.css`, so anything
 * put in one has to be put in the other, and six defects in this codebase have
 * come from exactly that. One source, every page.
 *
 * Active is a SOLID fill of the accent with dark ink — the same answer the rail
 * buttons and the mode switch give, so a chosen shape reads as chosen and not
 * as hovered.
 */
const STYLE = `
/* The card carries an inline display:flex, for the column that scrolls when a
   short window cannot hold seven shapes -- and an inline style OUTRANKS the
   hidden attribute, which is only a UA-level display:none. So close() set
   hidden, the card stayed painted, and neither the x nor putting the tool down
   appeared to do anything. CLAUDE.md records the same trap against
   #research-hub; this is the second time it has been paid for.
   Assert it, and never assert the PROPERTY in a test -- assert the paint. */
#gis-draw-options[hidden] { display: none !important; }

/* One column. A shape strip reads as a strip -- four across made it a keypad,
   and the eye had to search a grid for a picture it could otherwise walk. */
#gis-draw-shapes {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.3rem;
}
.gis-draw-shape {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 2.25rem;
  padding: 0.28rem;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.03);
  color: var(--skin-data, #7ee7ff);
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.gis-draw-shape svg { width: 1.2rem; height: 1.2rem; display: block; }
.gis-draw-shape:hover {
  border-color: rgba(var(--nav-accent-rgb), 0.75);
  background: rgba(var(--nav-accent-rgb), 0.14);
}
.gis-draw-shape.is-active {
  background: rgb(var(--nav-accent-rgb));
  border-color: rgb(var(--nav-accent-rgb));
  color: var(--skin-chrome-ink, #2b0030);
}
/* The card is a narrow strip now, so a caption beside its field would leave the
   field four characters wide. Stacked is the right answer at this width, which
   it is NOT at a page width -- see CLAUDE.md on the Research forms. */
#gis-draw-options .row {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.15rem;
  margin: 0.4rem 0 0;
}
#gis-draw-options .row label {
  font: 500 0.6rem/1.2 'Exo 2', sans-serif;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  opacity: 0.8;
  color: var(--skin-data, #7ee7ff);
}
#gis-draw-options .row .input { width: 100%; min-width: 0; }
#gis-draw-options .row.is-pair { flex-direction: row; flex-wrap: wrap; }
#gis-draw-options .row.is-pair label { flex: 1 0 100%; }
#gis-draw-options .row.is-pair .input { flex: 1 1 0; }

/* Export CSV is the viewer's own button, MOVED in from the rail rather than
   copied -- the viewer holds a live reference to this node and toggles it as a
   measurement comes and goes, so a copy would be a dead twin of a working
   control. It keeps its own hidden state, which is why nothing shows here
   until there is something to export. */
#gis-draw-export {
  margin-top: 0.45rem;
  padding-top: 0.45rem;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}
#gis-draw-export:empty { display: none; }
#gis-draw-export .measure-rail-actions { width: 100%; }
#gis-draw-export .tool-rail-action-btn {
  width: 100%;
  font-size: 0.62rem;
  letter-spacing: 0.05em;
  padding: 0.34rem 0.3rem;
}

/* No prose. The card said the same sentence every time it opened, which is a
   label for the tool rather than news -- the tooltip on the freehand icon says
   it, to whoever asks. This line is for failures only, and takes no room when
   there are none. */
#gis-draw-status {
  margin-top: 0.45rem;
  font: 400 0.62rem/1.35 'Exo 2', sans-serif;
  color: var(--skin-data, #7ee7ff);
}
#gis-draw-status:empty { display: none; }

/* Freehand's finish row. The count is the only running feedback the drawing
   has -- the viewer draws the outline but never says how many points are in it,
   and three is the number at which a polygon exists at all. */
#gis-draw-finish {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-top: 0.5rem;
  padding-top: 0.45rem;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}
#gis-draw-finish[hidden] { display: none !important; }
#gis-draw-count {
  font: 400 0.6rem/1.3 'Exo 2', sans-serif;
  letter-spacing: 0.03em;
  opacity: 0.75;
}
#gis-draw-finish-btn { width: 100%; font-size: 0.63rem; }
#gis-draw-finish-btn:disabled { opacity: 0.45; cursor: default; }
`;

function installStyle() {
  if (document.getElementById("gis-draw-panel-style")) return;
  const tag = document.createElement("style");
  tag.id = "gis-draw-panel-style";
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

/* ── The card ────────────────────────────────────────────────────────────── */

const state = { shape: "freehand" };
let card = null;
let nodes = null;

/**
 * Failures only.
 *
 * The card used to narrate every success — "Square, 100 km² at 20.000°, …" —
 * and that is already on screen: every shape goes through the viewer's own
 * `activateStudyArea`, which puts the measured area in its readout. Saying it
 * twice made a strip of icons into a paragraph. What is NOT reported anywhere
 * else is the refusals ("the middle of the view is not on the globe"), so those
 * still land here, and the line takes no room when there are none.
 */
function say(message) {
  if (nodes?.status) nodes.status.textContent = message || "";
}
const clear = () => say("");

/** Where the shape goes: the middle of the view, or typed coordinates. */
function centreLatLon(viewer) {
  if (nodes?.centre?.value === "manual") {
    const lat = Number(nodes.lat.value);
    const lon = Number(nodes.lon.value);
    if (nodes.lat.value === "" || nodes.lon.value === ""
      || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      say("Enter a latitude and a longitude, or centre on the view.");
      return null;
    }
    return { lat, lon };
  }
  const centre = viewer.getViewCentreLatLon?.() || null;
  if (!centre) {
    // Asking is the honest answer. Guessing would put the shape somewhere the
    // user has never looked.
    say("The middle of the view is not on the globe — turn to it, or enter coordinates.");
    return null;
  }
  return centre;
}

function place(shape) {
  const viewer = window.GeoIDViewer;
  if (!viewer?.setStudyAreaPolygon) {
    say("The globe is not ready yet.");
    return;
  }
  const centre = centreLatLon(viewer);
  if (!centre) return;
  const sizeKm = Number(nodes.size.value);
  if (!(sizeKm > 0)) {
    say(`Give the shape a ${(shape.sizeLabel || "Side (km)").toLowerCase()}.`);
    return;
  }
  // Sized on whichever world this is. Without the body radius a 200 km shape on
  // Mars comes out 106 km across -- exactly (R_earth/R_mars) out.
  const radiusKm = viewer.bodyRadiusKm || undefined;

  if (shape.line) {
    const line = lineVertices({
      lat: centre.lat, lon: centre.lon, lengthKm: sizeKm,
      bearingDeg: Number(nodes.bearing?.value) || 0, radiusKm,
    });
    if (!line) {
      say("Give the line a length in kilometres.");
      return;
    }
    const out = window.GeoIDDrawnLayers?.captureDrawnLine?.(line.vertices);
    // A line makes a layer rather than a study area, so the layer list is where
    // it reports; only the refusal needs saying here.
    if (out?.ok) say(`Line · ${sizeKm} km · ${out.layer?.name || "added"}`);
    else say(out?.message || "The line could not be added.");
    return;
  }

  const built = regularPolygonVertices({
    lat: centre.lat,
    lon: centre.lon,
    sides: shape.sides,
    rotationDeg: shape.rotationDeg,
    ...(shape.bySpan ? { spanKm: sizeKm } : { sideKm: sizeKm }),
    radiusKm,
  });
  if (!built) {
    say(`Give the ${shape.label.toLowerCase()} a size in kilometres.`);
    return;
  }
  if (!viewer.setStudyAreaPolygon(built.vertices)) {
    say("The viewer would not take that shape.");
    return;
  }
  // A shape is both the place you are working and a polygon you can operate on,
  // and it should not have to be captured twice.
  window.GeoIDDrawnLayers?.captureDrawn?.();
  // Not prose, but not silence either. The card said nothing at all after a
  // placement, so changing the size and pressing a shape again looked like it
  // had done nothing -- a 10 km box and a 100 km box are the same handful of
  // pixels from orbit. The numbers are the confirmation.
  say(`${shape.label} · ${sizeKm} km · ${Math.round(built.areaHintKm2).toLocaleString()} km²`);
}


/* ── Freehand: knowing where you are, and saying when you are done ────────────
 *
 * The viewer has no notion of a finished polygon: `getExtractionGeometry`
 * returns the area from the THIRD point onward and keeps returning a bigger one
 * with every click. So there was never a moment the drawing was complete, no
 * signal that it had started, and no way to say "that one, keep it" -- the
 * shape existed only as a study area and joining the layer list was something
 * the preset shapes did for you and freehand did not.
 *
 * Polled rather than hooked, because the points are added inside the viewer's
 * own pointer handling and it publishes no event when they change.
 */
let freehandTimer = null;

function freehandGeometry() {
  return window.GeoIDViewer?.getExtractionGeometry?.("study") || null;
}

function watchFreehand() {
  stopWatchingFreehand();
  const tick = () => {
    if (!card || card.hidden || state.shape !== "freehand") return stopWatchingFreehand();
    const geometry = freehandGeometry();
    const points = geometry?.vertices?.length || 0;
    nodes.finish.disabled = points < 3;
    // "the current shape", not "your drawing": the viewer keeps ONE study area,
    // so a preset placed a moment ago is what this counts until the next click
    // on the globe. Calling a 12-vertex square "12 points" read as though the
    // user had clicked them out.
    nodes.finishCount.textContent = points === 0
      ? "Click the globe to start drawing"
      : `Current shape: ${points} point${points === 1 ? "" : "s"}`
        + (points < 3 ? " — 3 needed" : "");
    return undefined;
  };
  tick();
  freehandTimer = setInterval(tick, 300);
}

function stopWatchingFreehand() {
  if (freehandTimer) clearInterval(freehandTimer);
  freehandTimer = null;
}

function finishFreehand() {
  const geometry = freehandGeometry();
  if (!geometry || geometry.vertices.length < 3) {
    say("Click out at least three points on the globe first.", true);
    return;
  }
  const out = window.GeoIDDrawnLayers?.captureDrawn?.();
  say(out?.ok ? out.message : (out?.message || "That shape could not be saved."));
}

function selectShape(id) {
  state.shape = id;
  const shape = shapeById(id);
  nodes.buttons.forEach((button, key) => button.classList.toggle("is-active", key === id));
  const freehand = id === "freehand";
  nodes.sizeRow.hidden = freehand;
  nodes.bearingRow.hidden = freehand || !shape.line;
  nodes.centreRow.hidden = freehand;
  nodes.manualRow.hidden = freehand || nodes.centre.value !== "manual";
  nodes.sizeLabel.textContent = shape.sizeLabel || "Side (km)";
  // Freehand is the only mode with a drawing in progress, so it is the only one
  // that needs a finish button and a running count.
  nodes.finishRow.hidden = !freehand;
  if (freehand) {
    clear();
    watchFreehand();
    return;
  }
  stopWatchingFreehand();
  place(shape);
}

function buildCard() {
  installStyle();
  card = document.createElement("div");
  card.id = "gis-draw-options";
  card.hidden = true;
  // Above the legend and the hover tooltip, below every popup and modal — the
  // stacking order recorded in CLAUDE.md, numeric because these are all
  // siblings under body.
  Object.assign(card.style, {
    // A strip, not a panel: one column of shapes sets the width, and the
    // controls under them stack their captions to suit it.
    position: "fixed", zIndex: "15", width: "8.6rem", maxWidth: "calc(100vw - 2rem)",
    // Seven shapes plus the controls can outrun a short window, and a card that
    // runs off the bottom loses its last shape with no way to reach it.
    maxHeight: "calc(100vh - 2rem)", display: "flex", flexDirection: "column",
    borderRadius: "10px", overflow: "hidden",
    background: "rgba(12, 10, 22, 0.96)",
    border: "1px solid rgba(255, 255, 255, 0.14)",
    boxShadow: "0 10px 30px rgba(0, 0, 0, 0.45)",
  });

  const head = document.createElement("div");
  Object.assign(head.style, {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: "0.5rem", padding: "0.45rem 0.6rem",
    borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
  });
  const title = document.createElement("span");
  title.textContent = "Draw";
  Object.assign(title.style, {
    font: "600 0.68rem/1 'Exo 2', sans-serif", letterSpacing: "0.08em",
    textTransform: "uppercase", opacity: "0.85",
  });
  const shut = document.createElement("button");
  shut.type = "button";
  shut.className = "button";
  shut.textContent = "×";
  shut.setAttribute("aria-label", "Close draw options");
  Object.assign(shut.style, { padding: "0 0.45rem", minWidth: "0", lineHeight: "1" });
  shut.addEventListener("click", dismiss);
  head.append(title, shut);

  const body = document.createElement("div");
  body.style.padding = "0.5rem 0.55rem 0.6rem";
  body.style.overflowY = "auto";
  body.style.minHeight = "0";

  const grid = document.createElement("div");
  grid.id = "gis-draw-shapes";
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", "Shape to draw");
  const buttons = new Map();
  SHAPES.forEach((shape) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gis-draw-shape";
    button.dataset.shape = shape.id;
    button.title = shape.hint || `${shape.label} — click to place one`;
    button.setAttribute("aria-label", shape.label);
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">`
      + (shape.icon || polygonPath(shape.sides, shape.rotationDeg))
      + `</svg>`;
    button.addEventListener("click", () => selectShape(shape.id));
    grid.appendChild(button);
    buttons.set(shape.id, button);
  });

  const row = (labelText, ...controls) => {
    const wrap = document.createElement("div");
    wrap.className = "row";
    const label = document.createElement("label");
    label.textContent = labelText;
    wrap.append(label, ...controls);
    return { wrap, label };
  };

  const size = document.createElement("input");
  size.className = "input";
  size.type = "number";
  size.min = "0.05";
  size.step = "1";
  size.value = "10";
  size.id = "gis-draw-size";
  const sizeRow = row("Side (km)", size);
  sizeRow.label.htmlFor = size.id;

  const bearing = document.createElement("input");
  bearing.className = "input";
  bearing.type = "number";
  bearing.step = "1";
  bearing.value = "90";
  bearing.id = "gis-draw-bearing";
  bearing.title = "Compass bearing: 0 is north, 90 is east";
  const bearingRow = row("Bearing (°)", bearing);
  bearingRow.label.htmlFor = bearing.id;

  const centre = document.createElement("select");
  centre.className = "input";
  centre.id = "gis-draw-centre";
  centre.innerHTML = '<option value="view">Middle of the view</option>'
    + '<option value="manual">Coordinates below</option>';
  const centreRow = row("Centred on", centre);
  centreRow.label.htmlFor = centre.id;

  const lat = document.createElement("input");
  lat.className = "input";
  lat.type = "number";
  lat.step = "0.0001";
  lat.placeholder = "lat";
  lat.setAttribute("aria-label", "Shape centre latitude");
  const lon = document.createElement("input");
  lon.className = "input";
  lon.type = "number";
  lon.step = "0.0001";
  lon.placeholder = "lon °E";
  lon.setAttribute("aria-label", "Shape centre longitude east");
  const manualRow = row("Lat / lon", lat, lon);
  manualRow.wrap.classList.add("is-pair");

  // Where the rail's own Export CSV is parked while the card is up. Empty until
  // then, and `:empty` hides it, so the separator does not draw over nothing.
  const exportSlot = document.createElement("div");
  exportSlot.id = "gis-draw-export";

  // Freehand's own row: how far the drawing has got, and the button that keeps
  // it. Hidden for every preset shape, which is placed complete.
  const finishRow = document.createElement("div");
  finishRow.id = "gis-draw-finish";
  const finishCount = document.createElement("div");
  finishCount.id = "gis-draw-count";
  const finish = document.createElement("button");
  finish.type = "button";
  finish.className = "button";
  finish.id = "gis-draw-finish-btn";
  finish.textContent = "Finish & save shape";
  finish.title = "Keep the current shape as a layer you can style, sample and export";
  finish.disabled = true;
  finish.addEventListener("click", finishFreehand);
  finishRow.append(finishCount, finish);

  const status = document.createElement("div");
  status.id = "gis-draw-status";

  body.append(grid, sizeRow.wrap, bearingRow.wrap, centreRow.wrap, manualRow.wrap,
    finishRow, exportSlot, status);
  card.append(head, body);
  document.body.appendChild(card);

  nodes = {
    buttons, size, sizeLabel: sizeRow.label, sizeRow: sizeRow.wrap,
    bearing, bearingRow: bearingRow.wrap,
    centre, centreRow: centreRow.wrap, manualRow: manualRow.wrap, lat, lon,
    exportSlot, status, finishRow, finish, finishCount,
  };
  centre.addEventListener("change", () => {
    nodes.manualRow.hidden = state.shape === "freehand" || centre.value !== "manual";
  });
  // Changing a size re-places the shape that is up, so the number and the thing
  // on the globe agree without a second button to press.
  const replace = () => { if (state.shape !== "freehand") place(shapeById(state.shape)); };
  size.addEventListener("change", replace);
  bearing.addEventListener("change", replace);
}

/** Anchored to the Draw button, on the sidebar side of the rail. */
function position() {
  const anchor = document.getElementById("tool-rail-area");
  if (!anchor || !card) return;
  const r = anchor.getBoundingClientRect();
  card.style.right = `${Math.round(window.innerWidth - r.left + 10)}px`;
  // A column of seven is tall enough to reach past the bottom of a short
  // window, so it rides up rather than off. 16px is the same inset the card
  // keeps from every other edge.
  const height = card.offsetHeight || 0;
  const top = Math.min(Math.round(r.top), Math.max(16, window.innerHeight - height - 16));
  card.style.top = `${top}px`;
}

/**
 * The rail's Export CSV, borrowed for as long as the card is up.
 *
 * MOVED, never copied. `earth-viewer.js` captures this node once at boot
 * (`measureRailActionGroups`) and toggles it as a measurement comes and goes,
 * so a copy would be a dead twin beside a working control — the same
 * duplicate-id fault that once had the extraction dialog's Run button silently
 * driving the panel's. A comment marks where it came from so it goes back.
 */
const EXPORT_SELECTOR = '[data-measure-actions="area"]';
let exportHome = null;

function borrowExport() {
  const actions = document.querySelector(EXPORT_SELECTOR);
  if (!actions || !nodes?.exportSlot || actions.parentNode === nodes.exportSlot) return;
  if (!exportHome) {
    exportHome = document.createComment("export csv lives with the draw card while it is up");
    actions.parentNode?.insertBefore(exportHome, actions);
  }
  nodes.exportSlot.appendChild(actions);
}

function returnExport() {
  const actions = nodes?.exportSlot?.firstElementChild;
  if (actions && exportHome?.parentNode) {
    exportHome.parentNode.insertBefore(actions, exportHome);
  }
}

function open() {
  if (!card) buildCard();
  card.hidden = false;
  // Freehand every time it is picked up. The tool the rail just armed IS
  // freehand, so opening on the last shape would describe something the viewer
  // is not doing -- and re-placing it would drop a polygon nobody asked for.
  selectShape("freehand");
  borrowExport();
  position();
  window.addEventListener("resize", position);
  /**
   * The rail steps back while the card is up, exactly as it does for the
   * Process and Analysis workbenches: every button shrinks to its icon, and the
   * solid fill on the active one is what says which tool you are holding.
   *
   * A class of its own rather than `has-open-panel`, which `side-panels.js`
   * owns and recomputes from its own panels -- sharing it would have the two
   * switch each other off. The rules are in that module's stylesheet, which is
   * the one place that reaches all ten pages.
   */
  document.getElementById("tool-rail")?.classList.add("has-draw-card");
}

function close() {
  if (!card || card.hidden) return;
  stopWatchingFreehand();
  returnExport();
  card.hidden = true;
  window.removeEventListener("resize", position);
  document.getElementById("tool-rail")?.classList.remove("has-draw-card");
}

/**
 * Dismissing the card puts the tool down with it.
 *
 * `close()` alone left the rail button filled -- the solid accent that means
 * "you are holding this" -- with no card and the globe still armed for a
 * polygon. It also cost a click: the button was already ON, so the next press
 * of Draw disarmed it rather than bringing the card back, which reads as a
 * button that does nothing.
 *
 * The measure mode belongs to the viewer, so this asks the rail button for it
 * rather than reaching into that state: the click toggles the tool off, which
 * clears `is-active`, and the button's own listener then calls `close()`. The
 * direct `close()` below is for the case where the tool is already down.
 */
function dismiss() {
  const button = document.getElementById("tool-rail-area");
  if (button?.classList.contains("is-active")) button.click();
  close();
}

export function init() {
  const button = document.getElementById("tool-rail-area");
  if (!button) return false;
  /**
   * Deferred a tick because the viewer toggles the measure mode on this same
   * click, and only opened when the tool ends up ON — otherwise putting the
   * tool down would open the card.
   */
  button.addEventListener("click", () => {
    setTimeout(() => {
      if (button.classList.contains("is-active")) open(); else close();
    }, 80);
  });
  // Escape is the same dismissal as the x, so it puts the tool down too --
  // leaving one of them armed and the other not would be a difference nobody
  // could predict.
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") dismiss(); });
  return true;
}

if (typeof document !== "undefined") {
  // The rail arrives with the shell on a planet page and with the markup on
  // Earth's, so this retries rather than assuming a moment -- the same shape
  // side-panels.js uses for the same reason.
  let tries = 0;
  const attempt = () => {
    if (init() || (tries += 1) > 60) return;
    setTimeout(attempt, 400);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attempt);
  } else {
    attempt();
  }
}

if (typeof window !== "undefined") {
  window.GeoIDDrawPanel = { open, close, shapes: () => SHAPES.map((s) => s.id) };
}
