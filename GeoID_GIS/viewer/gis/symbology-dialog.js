/**
 * Symbology as a window you open on a layer, whatever the layer is.
 *
 * The geology tab had one and it was the right shape: a modal over the map,
 * the attribute table in front of you, the classes listed with their colours,
 * one Apply. Every other layer had to be symbolised from a panel folded three
 * deep in another tab, with a dropdown to find the layer in first. So this is
 * that dialog, lifted out and taught rasters — one window, any layer, opened
 * from wherever the layer is: the catalogues, the layer box, the geology tab.
 *
 * The two branches are genuinely different and neither collapses into the
 * other. A vector layer has CATEGORIES — a column of names, coloured one hue
 * each, and the useful controls are which column and which palette. A raster
 * has a RANGE — one continuous variable, and the controls are how to cut it
 * into classes and which ramp to run across them. Cutting a list of rock names
 * into five quantiles is meaningless, and asking a rainfall grid which of its
 * columns to colour by is asking about something it does not have.
 *
 * Applying goes through `layer.repaint` for both, because that is the one path
 * the rest of the app already trusts — the same call the import dialog and the
 * Analyse panel make. What it takes differs and the difference is a trap worth
 * naming: the VECTOR repaint wants a CSS colour string and the RASTER repaint
 * wants [r, g, b]. Handing an array to a vector layer is not an error; every
 * polygon comes out white with a perfectly correct legend beside it.
 */

import { attributeHead, rankColourFields } from "./delimited.js?v=20260825-9741868";
import {
  RAMPS, RAMP_NAMES, QUALITATIVE, QUALITATIVE_RAMP, METHODS,
  categoricalSymbology, buildSymbology, colourOf, legendInfoFrom,
} from "./symbology.js?v=20260825-9741868";

const STYLE = `
/* NEVER a backtick in this block -- it is a template literal and one ends it. */
#gis-sym-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(4, 2, 12, 0.62);
  backdrop-filter: blur(2px);
}
#gis-sym-dialog-backdrop[hidden] { display: none !important; }
#gis-sym-dialog {
  width: min(46rem, 92vw);
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(255, 45, 210, 0.45);
  border-radius: 0.55rem;
  background: linear-gradient(180deg, rgba(22, 6, 34, 0.98), rgba(10, 4, 20, 0.98));
  box-shadow: 0 1.4rem 3rem rgba(0, 0, 0, 0.55);
  color: #f2e9ff;
}
#gis-sym-dialog .sym-head,
#gis-sym-dialog .sym-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.55rem 0.85rem;
  flex: 0 0 auto;
}
#gis-sym-dialog .sym-head { border-bottom: 1px solid rgba(255, 255, 255, 0.12); }
#gis-sym-dialog .sym-foot { border-top: 1px solid rgba(255, 255, 255, 0.12); }
#gis-sym-dialog .sym-title {
  font: 600 0.72rem/1.3 'Exo 2', sans-serif;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
#gis-sym-dialog .sym-body {
  padding: 0.7rem 0.85rem;
  overflow-y: auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
/**
 * The hidden ATTRIBUTE is only a UA-level display:none, so ANY author rule
 * that sets display outranks it -- and half the things in this dialog are
 * flex rows. The attribute half was hidden in One colour mode and went on
 * rendering anyway: Colour by and Ramp sat under a Style select saying they
 * did not apply. The same trap the Research Hub hit with a collapsed panel,
 * and it is invisible to a probe that reads the property rather than the
 * computed display.
 */
#gis-sym-dialog [hidden] { display: none !important; }
#gis-sym-dialog .sym-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
#gis-sym-dialog .sym-row > label {
  flex: 0 0 6.5rem;
  font: 500 0.62rem/1.3 'Exo 2', sans-serif;
  opacity: 0.85;
}
/**
 * EVERY control in here is painted, and this is why.
 *
 * A bare input takes the browser's own white, and against a dark modal a row
 * of forty class-name boxes reads as a stack of white banners with the map
 * behind them -- which is exactly what it looked like. The skin paints
 * .button and .input with !important, so the ones this dialog builds by hand
 * -- text, number, colour -- are painted here by element rather than left to
 * inherit nothing.
 */
#gis-sym-dialog input[type="text"],
#gis-sym-dialog input[type="number"],
#gis-sym-dialog select {
  background: rgba(255, 255, 255, 0.06);
  color: #f2e9ff;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 0.25rem;
  padding: 0.18rem 0.35rem;
  font: 400 0.62rem/1.35 'Exo 2', sans-serif;
  min-width: 0;
}
/**
 * A select's POPUP is painted from opaque colours, and a translucent one is
 * not opaque.
 *
 * The closed control looked right -- 6% white over a dark card is a dark
 * control -- but the list the browser opens has no card behind it, so the same
 * rule composites over the platform's white and the near-white text goes with
 * it. The open menu was white on white and unreadable. The control keeps its
 * translucent fill; the popup and its options are painted solid.
 */
#gis-sym-dialog select {
  background-color: #1c0a2b;
  background-image: none;
}
#gis-sym-dialog select option,
#gis-sym-dialog select optgroup {
  background-color: #1c0a2b;
  color: #f2e9ff;
}
#gis-sym-dialog select option:disabled { color: rgba(242, 233, 255, 0.4); }
#gis-sym-dialog input[type="text"]:focus,
#gis-sym-dialog input[type="number"]:focus,
#gis-sym-dialog select:focus {
  outline: none;
  border-color: rgba(255, 45, 210, 0.6);
}
#gis-sym-dialog input[type="color"] {
  flex: 0 0 auto;
  width: 1.5rem;
  height: 1rem;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 0.15rem;
  background: transparent;
  cursor: pointer;
}
/* Chrome insets the swatch inside its own wrapper, which on a chip this small
   leaves more chrome than colour -- and the colour is the whole point of the
   row. These two make the chip read as solid paint. */
#gis-sym-dialog input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
#gis-sym-dialog input[type="color"]::-webkit-color-swatch { border: 0; }
#gis-sym-dialog .sym-ramp-bar {
  flex: 0 0 6rem;
  height: 0.7rem;
  border-radius: 0.15rem;
  border: 1px solid rgba(255, 255, 255, 0.15);
}
#gis-sym-dialog .sym-head-wrap {
  max-height: 11rem;
  overflow: auto;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 0.3rem;
}
#gis-sym-dialog table { border-collapse: collapse; width: max-content; min-width: 100%; }
#gis-sym-dialog th, #gis-sym-dialog td {
  padding: 0.2rem 0.4rem;
  text-align: left;
  font: 400 0.58rem/1.3 'Exo 2', sans-serif;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  max-width: 12rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#gis-sym-dialog th {
  position: sticky;
  top: 0;
  background: rgba(30, 8, 46, 0.98);
  cursor: pointer;
}
#gis-sym-dialog th small { display: block; font-size: 0.5rem; opacity: 0.6; }
#gis-sym-dialog .is-colour { background: rgba(255, 45, 210, 0.14); }
#gis-sym-dialog .sym-classes {
  max-height: 13rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
#gis-sym-dialog .sym-class {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
#gis-sym-dialog .sym-class input[type="text"] { flex: 1 1 auto; }
#gis-sym-dialog .sym-class-count {
  flex: 0 0 auto;
  font: 400 0.56rem/1.3 'Exo 2', sans-serif;
  opacity: 0.55;
}
#gis-sym-dialog .sym-note {
  font: 400 0.6rem/1.3 'Exo 2', sans-serif;
  opacity: 0.7;
}
`;

/**
 * One dialog on the page, not one per copy of this module.
 *
 * The page is loaded from cache-busted URLs, so a second query string is a
 * second module with its own top-level state — and a module-level `backdrop`
 * held privately meant each copy built its own, both under the same id.
 * `getElementById` then answered with whichever was first, so opening the
 * dialog from one copy showed the OTHER copy's card, still bearing the last
 * layer's name. Both are found by looking the element up rather than by
 * remembering it.
 */
const BACKDROP_ID = "gis-sym-dialog-backdrop";

function installStyle() {
  if (typeof document === "undefined") return;
  if (document.getElementById("gis-sym-dialog-style")) return;
  const tag = document.createElement("style");
  tag.id = "gis-sym-dialog-style";
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

function theBackdrop() {
  const found = document.getElementById(BACKDROP_ID);
  if (found) return found;
  const made = document.createElement("div");
  made.id = BACKDROP_ID;
  document.body.appendChild(made);
  made.addEventListener("click", (event) => {
    if (event.target === made) made.hidden = true;
  });
  // Escape closes it: a modal dismissable only by hitting the strip outside
  // the card is a modal people get stuck in.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !made.hidden) made.hidden = true;
  });
  return made;
}

function isVector(layer) {
  return Boolean(!layer?.raster && layer?.features?.length);
}

/**
 * The readable values in a raster, for classing.
 *
 * Sampled on a stride, as the panel does: a million-cell grid does not need
 * every cell to find its breaks, and the distribution's shape survives.
 */
function rasterValues(layer) {
  const band = layer?.raster?.band;
  if (!band) return [];
  const noData = layer.raster.noData;
  const out = [];
  const stride = Math.max(1, Math.floor(band.length / 40000));
  for (let i = 0; i < band.length; i += stride) {
    const value = band[i];
    if (!Number.isFinite(value)) continue;
    if (noData != null && Number.isFinite(noData) && value === noData) continue;
    out.push(value);
  }
  return out;
}

function rampBar(name) {
  if (name === QUALITATIVE_RAMP) {
    const step = 100 / QUALITATIVE.length;
    return `linear-gradient(to right, ${QUALITATIVE
      .map((c, i) => `${c} ${i * step}% ${(i + 1) * step}%`).join(", ")})`;
  }
  const stops = (RAMPS[name] || RAMPS[RAMP_NAMES[0]]).map((c) => `rgb(${c.join(",")})`);
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

/**
 * Open the dialog on a layer.
 *
 * @param {object} layer                an imported layer with `repaint`
 * @param {object} [hooks]
 * @param {function} [hooks.onApplied]  (layer, result) after a successful Apply
 * @param {function} [hooks.status]     a line of text for the caller's own panel
 */
export function openSymbologyDialog(layer, hooks = {}) {
  if (!layer || typeof document === "undefined") return false;
  if (typeof layer.repaint !== "function") {
    hooks.status?.(`${layer.name} cannot be recoloured.`);
    return false;
  }
  installStyle();
  const backdrop = theBackdrop();
  backdrop.innerHTML = "";
  backdrop.hidden = false;

  const card = document.createElement("div");
  card.id = "gis-sym-dialog";
  card.addEventListener("click", (event) => event.stopPropagation());

  const head = document.createElement("div");
  head.className = "sym-head";
  const title = document.createElement("span");
  title.className = "sym-title";
  title.textContent = `Symbology — ${layer.name}`;
  const shut = document.createElement("button");
  shut.type = "button";
  shut.className = "button";
  shut.textContent = "×";
  shut.setAttribute("aria-label", "Close");
  Object.assign(shut.style, { padding: "0 0.45rem", minWidth: "0", lineHeight: "1" });
  shut.addEventListener("click", () => { backdrop.hidden = true; });
  head.append(title, shut);

  const body = document.createElement("div");
  body.className = "sym-body";
  const foot = document.createElement("div");
  foot.className = "sym-foot";
  const note = document.createElement("span");
  note.className = "sym-note";
  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "button";
  apply.textContent = "Apply";
  foot.append(note, apply);

  const built = isVector(layer)
    ? buildVectorForm(layer, body, note, hooks)
    : buildRasterForm(layer, body, note, hooks);

  apply.addEventListener("click", () => {
    const result = built.apply();
    if (result?.ok) {
      backdrop.hidden = true;
      hooks.onApplied?.(layer, result);
    } else if (result?.message) {
      note.textContent = result.message;
    }
  });

  card.append(head, body, foot);
  backdrop.appendChild(card);
  built.draw();
  return true;
}

/* ── vectors: a column, a palette, a class per value ─────────────────────── */

/**
 * Colour a vector layer by one of its columns. The one implementation.
 *
 * The geology tab had this and so did the dialog, which is one copy too many
 * for something with a trap in it — so both call here now, and the geology
 * tab's own auto-paint on load goes through the same lines the Apply button
 * does.
 *
 * @param {object} layer
 * @param {string} field
 * @param {object} [options] ramp name, colour overrides by value, class labels
 * @returns the symbology, or `{ok: false, message}`
 */
export function paintByField(layer, field, {
  ramp = QUALITATIVE_RAMP, overrides = null, labels = null,
} = {}) {
  if (!layer?.features?.length || !field) {
    return { ok: false, message: "nothing to colour" };
  }
  const sym = categoricalSymbology(layer.features, field, { ramp });
  if (!sym.ok) return sym;
  if (overrides) {
    sym.rows.forEach((row) => {
      const chosen = overrides.get(String(row.value));
      if (chosen) row.colour = chosen;
    });
  }
  /**
   * Keyed by the STRING form, and looked up the same way.
   *
   * `categoricalSymbology` counts values as strings, so a row's value is "6"
   * where the feature carries the number 6 — and `Map.get(6)` misses "6". On a
   * layer whose chosen column is numeric that meant EVERY feature fell through
   * to the no-value grey: measured on Natural Earth coastlines by scalerank,
   * all 813,648 vertices came out 0x8a8a8a under a seven-class legend that was
   * itself correct. Long-standing, and invisible on geology because a survey's
   * unit names are text.
   */
  const lookup = new Map(sym.rows.filter((r) => !r.other).map((r) => [String(r.value), r.colour]));
  const other = sym.rows.find((r) => r.other)?.colour || null;
  // A CSS colour STRING. `renderFeatureCollection` does `scratch.set(css)`;
  // hand it the [r, g, b] a raster wants and THREE.Color.set swallows the
  // array, every polygon comes out white, and the legend beside it is
  // perfectly correct. The legend is not evidence that the map was painted.
  layer.repaint?.((feature) => {
    const raw = feature?.properties?.[field];
    const key = raw == null ? null : String(raw);
    return (key != null && lookup.has(key) ? lookup.get(key) : other) || null;
  });
  layer.legendInfo = {
    palette: sym.rows.map((r) => String(r.colour).replace("#", "")),
    // The name somebody gave the class, else the attribute's own value.
    labels: sym.rows.map((r) => labels?.get(String(r.value)) || String(r.value)),
    // The raw value stays alongside, so a renamed entry can still be traced
    // back to the attribute it was made from.
    values: sym.rows.map((r) => String(r.value)),
    counts: sym.rows.map((r) => r.count),
    categorical: true,
    classed: true,
    field,
  };
  layer.geologyField = field;
  layer.geologyRamp = ramp;
  layer.geologyLabels = labels ? [...labels.entries()] : null;
  // The two modes are exclusive, so classing clears the single colour and
  // vice versa — otherwise reopening proposes the mode you just left.
  layer.symbologySingle = null;
  if (typeof window !== "undefined") window.GeoIDLayerHierarchy?.render?.();
  return sym;
}

/** The colour a line layer is drawn in before anybody chooses one. */
export const DEFAULT_SINGLE = "#8ef6c4";

/**
 * "8,101 lines", "412 polygons, 2 points" — what a layer is made of.
 *
 * Written here rather than in `vector-render.js`, which owns the equivalent
 * `describeCollection`, only because that module imports three.js and this one
 * is reached from a Node test. Three places wanted the same sentence — the
 * legend row, this dialog's one-colour label, and the Polygons tab's list — and
 * three copies of a counting loop is how they start disagreeing about whether
 * a MultiPolygon is one polygon or several.
 */
export function geometrySummary(features) {
  const kinds = { polygon: 0, line: 0, point: 0 };
  (features || []).forEach((feature) => {
    const type = feature?.geometry?.type || "";
    if (type.includes("Polygon")) kinds.polygon += 1;
    else if (type.includes("LineString")) kinds.line += 1;
    else if (type.includes("Point")) kinds.point += 1;
  });
  const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
  const parts = [];
  if (kinds.polygon) parts.push(plural(kinds.polygon, "polygon"));
  if (kinds.line) parts.push(plural(kinds.line, "line"));
  if (kinds.point) parts.push(plural(kinds.point, "point"));
  return parts.join(", ");
}

/**
 * Paint a whole vector layer ONE colour.
 *
 * The other half of vector symbology, and for a line layer usually the half
 * that is wanted: a coastline is a coastline everywhere, and cutting it into
 * twelve hues by whichever column happened to rank first says something about
 * the data that is not true. Classing stays a press away; it is no longer the
 * only thing Apply can do.
 */
export function paintSingle(layer, colour = DEFAULT_SINGLE) {
  if (!layer?.repaint) return { ok: false, message: "nothing to colour" };
  const css = String(colour);
  layer.repaint(() => css);
  layer.legendInfo = {
    palette: [css.replace("#", "")],
    // A legend row says what its swatch is a swatch OF. The layer's own name is
    // already the card's title an inch above, so repeating it there is a row
    // that tells the reader nothing; what the colour covers is the geometry.
    labels: [geometrySummary(layer.features) || layer.name],
    categorical: true,
    classed: true,
    field: null,
  };
  layer.symbologySingle = css;
  layer.geologyField = null;
  if (typeof window !== "undefined") window.GeoIDLayerHierarchy?.render?.();
  return { ok: true, single: css };
}

/** Does this layer have any area to fill, or is it only lines and points? */
function hasAreas(layer) {
  return (layer?.features || []).some((f) => {
    const type = f?.geometry?.type;
    return type === "Polygon" || type === "MultiPolygon";
  });
}

function buildVectorForm(layer, body, note, hooks) {
  const head6 = attributeHead(layer.features, { rows: 6 });
  const ranked = rankColourFields(head6);
  const lines = !hasAreas(layer);
  const state = {
    /**
     * A LINE layer opens on single colour; an area layer opens on its columns.
     *
     * Which of the two the layer is wearing wins over both — reopening must
     * not silently propose undoing the last Apply. Failing that, it is the
     * geometry that decides: rivers and coastlines are one thing drawn many
     * times, so twelve hues along them is a legend describing an accident of
     * the attribute table. Polygons are usually a map OF something.
     */
    mode: layer.symbologySingle ? "single" : (layer.geologyField ? "field" : (lines ? "single" : "field")),
    single: layer.symbologySingle || DEFAULT_SINGLE,
    field: layer.geologyField || ranked[0] || head6.columns[0]?.key,
    ramp: layer.geologyRamp || QUALITATIVE_RAMP,
    overrides: new Map(),
    labels: new Map(layer.geologyLabels || []),
  };

  const modeRow = document.createElement("div");
  modeRow.className = "sym-row";
  const modeLabel = document.createElement("label");
  modeLabel.textContent = "Style";
  const modeSelect = document.createElement("select");
  [["single", "One colour"], ["field", "By attribute"]].forEach(([value, text]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    if (value === state.mode) option.selected = true;
    modeSelect.appendChild(option);
  });
  const singleSwatch = document.createElement("input");
  singleSwatch.type = "color";
  singleSwatch.value = state.single;
  singleSwatch.title = "The colour every feature is drawn in";
  singleSwatch.addEventListener("input", () => { state.single = singleSwatch.value; });
  modeRow.append(modeLabel, modeSelect, singleSwatch);
  body.appendChild(modeRow);

  const fieldRow = document.createElement("div");
  fieldRow.className = "sym-row";
  const fieldLabel = document.createElement("label");
  fieldLabel.textContent = "Colour by";
  const fieldSelect = document.createElement("select");
  head6.columns.forEach((column) => {
    const option = document.createElement("option");
    option.value = column.key;
    option.textContent = `${column.key} — ${column.capped ? `${column.distinct}+` : column.distinct} `
      + `value${column.distinct === 1 ? "" : "s"}`;
    option.disabled = column.distinct < 2 || column.capped;
    if (column.key === state.field) option.selected = true;
    fieldSelect.appendChild(option);
  });
  fieldRow.append(fieldLabel, fieldSelect);

  const rampRow = document.createElement("div");
  rampRow.className = "sym-row";
  const rampLabel = document.createElement("label");
  rampLabel.textContent = "Ramp";
  const rampSelect = document.createElement("select");
  [QUALITATIVE_RAMP, ...RAMP_NAMES].forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name === QUALITATIVE_RAMP ? "qualitative (distinct hues)" : name;
    if (name === state.ramp) option.selected = true;
    rampSelect.appendChild(option);
  });
  const bar = document.createElement("span");
  bar.className = "sym-ramp-bar";
  rampRow.append(rampLabel, rampSelect, bar);

  const headWrap = document.createElement("div");
  headWrap.className = "sym-head-wrap";
  const classes = document.createElement("div");
  classes.className = "sym-classes";
  body.append(fieldRow, rampRow, headWrap, classes);

  const drawHead = () => {
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    head6.columns.forEach((column) => {
      const th = document.createElement("th");
      th.textContent = column.key;
      const small = document.createElement("small");
      small.textContent = `${column.capped ? `${column.distinct}+` : column.distinct} `
        + `value${column.distinct === 1 ? "" : "s"}`;
      th.appendChild(small);
      th.title = column.capped
        ? `More than ${column.distinct} distinct values — too many to colour by`
        : "Click to colour the map by this column";
      // Nothing is coloured by a column while the layer is one flat colour,
      // so nothing in the table is marked as the one doing it.
      if (state.mode !== "single" && column.key === state.field) th.classList.add("is-colour");
      th.addEventListener("click", () => {
        if (column.distinct < 2 || column.capped) return;
        state.field = column.key;
        state.overrides = new Map();
        state.labels = new Map();
        fieldSelect.value = column.key;
        // Clicking a column IS asking to colour by it. Reading the table is
        // how the decision gets made, so the table is also where it is taken.
        state.mode = "field";
        modeSelect.value = "field";
        draw();
      });
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    const tbody = document.createElement("tbody");
    head6.rows.forEach((row) => {
      const tr = document.createElement("tr");
      head6.columns.forEach((column, i) => {
        const td = document.createElement("td");
        td.textContent = row[i] ?? "";
        td.title = row[i] ?? "";
        if (state.mode !== "single" && column.key === state.field) td.classList.add("is-colour");
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.append(thead, tbody);
    headWrap.replaceChildren(table);
  };

  const drawClasses = () => {
    const sym = categoricalSymbology(layer.features, state.field, { ramp: state.ramp });
    classes.replaceChildren();
    if (!sym.ok) {
      classes.textContent = sym.message;
      return;
    }
    sym.rows.forEach((row) => {
      const line = document.createElement("div");
      line.className = "sym-class";
      const swatch = document.createElement("input");
      swatch.type = "color";
      swatch.value = state.overrides.get(String(row.value)) || row.colour;
      swatch.title = "Click to recolour this class";
      swatch.addEventListener("input", () => {
        state.overrides.set(String(row.value), swatch.value);
      });
      const label = document.createElement("input");
      label.type = "text";
      label.value = state.labels.get(String(row.value)) ?? String(row.value);
      label.title = String(row.value);
      // The viewer eats the space bar globally; a name field must not.
      label.addEventListener("keydown", (event) => event.stopPropagation());
      label.addEventListener("change", () => {
        const text = label.value.trim();
        if (text && text !== String(row.value)) state.labels.set(String(row.value), text);
        else state.labels.delete(String(row.value));
      });
      const count = document.createElement("span");
      count.className = "sym-class-count";
      count.textContent = row.count.toLocaleString();
      line.append(swatch, label, count);
      classes.appendChild(line);
    });
  };

  const draw = () => {
    const single = state.mode === "single";
    // The CONTROLS of classing are hidden rather than disabled: greyed-out
    // controls still read as "this is what symbology is, and it is broken".
    singleSwatch.hidden = !single;
    [fieldRow, rampRow, classes].forEach((node) => { node.hidden = single; });
    /**
     * The attribute table stays up in BOTH modes, because it is not a control.
     *
     * It is the first six rows of the dataset, and reading them is how anyone
     * decides there is anything worth colouring by — which column holds rock
     * names, which holds an id, whether the layer carries attributes at all.
     * Hiding it in One colour mode hid the very thing that answers "should I
     * switch to By attribute?", so the choice had to be made blind and undone.
     */
    drawHead();
    if (single) {
      note.textContent = `${head6.count.toLocaleString()} features · `
        + `${head6.columns.length} columns · all one colour`;
      return;
    }
    bar.style.background = rampBar(rampSelect.value);
    note.textContent = `${head6.count.toLocaleString()} features · ${head6.columns.length} columns`;
    drawClasses();
  };

  modeSelect.addEventListener("change", () => {
    state.mode = modeSelect.value;
    draw();
  });
  fieldSelect.addEventListener("change", () => {
    state.field = fieldSelect.value;
    state.overrides = new Map();
    state.labels = new Map();
    draw();
  });
  rampSelect.addEventListener("change", () => {
    state.ramp = rampSelect.value;
    state.overrides = new Map();
    draw();
  });

  return {
    draw,
    apply() {
      if (state.mode === "single") {
        const out = paintSingle(layer, state.single);
        if (!out.ok) return out;
        hooks.status?.(`${layer.name}: one colour.`);
        return { ok: true, kind: "vector", single: state.single };
      }
      const sym = paintByField(layer, state.field, {
        ramp: state.ramp, overrides: state.overrides, labels: state.labels,
      });
      if (!sym.ok) return { ok: false, message: sym.message };
      hooks.status?.(`${layer.name} coloured by ${state.field}: ${sym.rows.length} classes.`);
      // The choice itself goes back to the caller: the geology tab remembers it
      // so a rebuilt tiled layer comes back in the colours it was left in.
      return {
        ok: true,
        kind: "vector",
        rows: sym.rows,
        field: state.field,
        ramp: state.ramp,
        overrides: new Map(state.overrides),
        labels: new Map(state.labels),
      };
    },
  };
}

/* ── rasters: a range, cut into classes ──────────────────────────────────── */

function buildRasterForm(layer, body, note, hooks) {
  const values = rasterValues(layer);
  const state = {
    // Reopened on a layer that has been symbolised, the controls show the
    // symbology it is WEARING -- not the defaults, which would invite somebody
    // to press Apply and silently undo the classing they came back to adjust.
    method: layer.symbologySpec?.method || "quantile",
    classes: layer.symbologySpec?.classes || 5,
    ramp: layer.symbologySpec?.ramp || RAMP_NAMES[0],
    overrides: new Map(),
  };

  const methodRow = document.createElement("div");
  methodRow.className = "sym-row";
  const methodLabel = document.createElement("label");
  methodLabel.textContent = "Classes by";
  const methodSelect = document.createElement("select");
  Object.entries(METHODS).forEach(([id, method]) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = method.label;
    if (id === state.method) option.selected = true;
    methodSelect.appendChild(option);
  });
  const continuous = document.createElement("option");
  continuous.value = "continuous";
  continuous.textContent = "Continuous (no classes)";
  methodSelect.appendChild(continuous);
  const count = document.createElement("input");
  count.type = "number";
  count.min = "2";
  count.max = "12";
  count.value = String(state.classes);
  count.style.width = "3.5rem";
  methodRow.append(methodLabel, methodSelect, count);

  const rampRow = document.createElement("div");
  rampRow.className = "sym-row";
  const rampLabel = document.createElement("label");
  rampLabel.textContent = "Ramp";
  const rampSelect = document.createElement("select");
  RAMP_NAMES.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    if (name === state.ramp) option.selected = true;
    rampSelect.appendChild(option);
  });
  const bar = document.createElement("span");
  bar.className = "sym-ramp-bar";
  rampRow.append(rampLabel, rampSelect, bar);

  const classes = document.createElement("div");
  classes.className = "sym-classes";
  body.append(methodRow, rampRow, classes);

  // "continuous" is a flag to buildSymbology, not one of its methods — passing
  // it as a method name falls through to jenks and quietly classes anyway.
  const compute = () => buildSymbology(values, {
    method: state.method === "continuous" ? "jenks" : state.method,
    continuous: state.method === "continuous",
    classes: Number(count.value) || state.classes,
    ramp: state.ramp,
  });

  const draw = () => {
    bar.style.background = rampBar(rampSelect.value);
    count.disabled = methodSelect.value === "continuous";
    const sym = compute();
    classes.replaceChildren();
    if (!sym.ok) {
      classes.textContent = sym.message;
      note.textContent = `${values.length.toLocaleString()} readable cells`;
      return;
    }
    note.textContent = `${values.length.toLocaleString()} cells · `
      + `${sym.rows.length} class${sym.rows.length === 1 ? "" : "es"}`;
    sym.rows.forEach((row, i) => {
      const line = document.createElement("div");
      line.className = "sym-class";
      const swatch = document.createElement("input");
      swatch.type = "color";
      swatch.value = state.overrides.get(i) || row.colour;
      swatch.addEventListener("input", () => state.overrides.set(i, swatch.value));
      const label = document.createElement("input");
      label.type = "text";
      label.value = row.label;
      label.readOnly = true;
      const cells = document.createElement("span");
      cells.className = "sym-class-count";
      cells.textContent = row.count ? row.count.toLocaleString() : "";
      line.append(swatch, label, cells);
      classes.appendChild(line);
    });
  };

  [methodSelect, count, rampSelect].forEach((control) => {
    control.addEventListener("change", () => {
      state.method = methodSelect.value;
      state.classes = Number(count.value) || state.classes;
      state.ramp = rampSelect.value;
      // A different cut is different classes; a colour pinned to the old ones
      // would land on an unrelated band of values.
      state.overrides = new Map();
      draw();
    });
  });

  return {
    draw,
    apply() {
      const sym = compute();
      if (!sym.ok) return { ok: false, message: sym.message };
      sym.rows.forEach((row, i) => {
        const chosen = state.overrides.get(i);
        if (chosen) row.colour = chosen;
      });
      // A classed palette IS the row colours; a continuous one is 24 samples of
      // the ramp and collapsing it to one row would flatten the gradient key.
      if (!sym.continuous) sym.palette = sym.rows.map((r) => r.colour);
      // [r, g, b]: the raster repaint takes the triple, not a CSS string.
      const painted = layer.repaint((value) => {
        const colour = colourOf(value, sym);
        if (!colour) return null;
        return [
          parseInt(colour.slice(1, 3), 16),
          parseInt(colour.slice(3, 5), 16),
          parseInt(colour.slice(5, 7), 16),
        ];
      });
      layer.legendInfo = legendInfoFrom(sym, { unit: layer.legendInfo?.unit || null });
      layer.symbologySpec = {
        method: state.method,
        classes: Number(count.value) || state.classes,
        ramp: state.ramp,
      };
      if (typeof window !== "undefined") window.GeoIDLayerHierarchy?.render?.();
      hooks.status?.(`${layer.name}: ${sym.rows.length} classes by `
        + `${METHODS[sym.method]?.label || sym.method}.`);
      return { ok: Boolean(painted), rows: sym.rows, kind: "raster" };
    },
  };
}

if (typeof window !== "undefined") {
  window.GeoIDSymbologyDialog = { open: openSymbologyDialog };
}
