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

import { attributeHead, rankColourFields } from "./delimited.js?v=20260830-d29d5e8";
import {
  RAMPS, RAMP_NAMES, QUALITATIVE, QUALITATIVE_RAMP, METHODS,
  categoricalSymbology, buildSymbology, colourOf, legendInfoFrom, fmtBound,
} from "./symbology.js?v=20260830-d29d5e8";

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
/* No white scrollbars: the standard pair carries modern Chrome and Firefox,
   the webkit pseudos carry Safari, both in the panel cyan so it does not
   matter which answers -- the events panel's documented discipline. */
#gis-sym-dialog .sym-body,
#gis-sym-dialog .sym-head-wrap,
#gis-sym-dialog .sym-classes {
  scrollbar-width: thin;
  scrollbar-color: rgba(82, 228, 232, 0.38) transparent;
}
#gis-sym-dialog .sym-body::-webkit-scrollbar,
#gis-sym-dialog .sym-head-wrap::-webkit-scrollbar,
#gis-sym-dialog .sym-classes::-webkit-scrollbar { width: 8px; height: 8px; }
#gis-sym-dialog .sym-body::-webkit-scrollbar-thumb,
#gis-sym-dialog .sym-head-wrap::-webkit-scrollbar-thumb,
#gis-sym-dialog .sym-classes::-webkit-scrollbar-thumb { background: rgba(82, 228, 232, 0.38); border-radius: 4px; }
#gis-sym-dialog .sym-body::-webkit-scrollbar-track,
#gis-sym-dialog .sym-head-wrap::-webkit-scrollbar-track,
#gis-sym-dialog .sym-classes::-webkit-scrollbar-track { background: transparent; }

#gis-sym-dialog .sym-class {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
#gis-sym-dialog .sym-class input[type="text"] { flex: 1 1 auto; }
#gis-sym-dialog .sym-class-note {
  padding: 0.25rem 0.1rem 0;
  font: 400 0.58rem/1.4 'Exo 2', sans-serif;
  opacity: 0.7;
}
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
/**
 * Tell the page a layer's colours changed.
 *
 * The point labels wear the legend's colours, and they are built from
 * `legendInfo` at the moment they are added — which, now that labels arrive
 * automatically with the layer, is usually a beat BEFORE the catalogue's
 * default paint has written it. Without this event nothing ever told them the
 * colours had arrived, and every chip wore the theme's red. The same event
 * covers a user re-symbolising from the dialog: the labels follow the map.
 */
function announceSymbology() {
  window.dispatchEvent(new CustomEvent("geoid-gis:layers-changed", {
    detail: { reason: "symbology" },
  }));
}

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
  if (typeof window !== "undefined") {
    window.GeoIDLayerHierarchy?.render?.();
    announceSymbology();
  }
  return sym;
}

/**
 * Fields that are ANGLES, and want a ramp that comes back round.
 *
 * Matched by name because the range cannot say it: depth in metres and an
 * azimuth in degrees both live in 0–360, and only one of them wraps.
 */
const ANGULAR = /^(azimuth|shmax|shmax_deg|aspect|bearing|strike|dip_dir|direction|heading)$/i;

export const isAngularField = (field) => ANGULAR.test(String(field || ""));

/**
 * Colour a vector layer by a NUMERIC column, in classes.
 *
 * `paintByField` treats every column as a set of names, which is right for a
 * rock unit and wrong for a magnitude: 193 distinct values of `s1_mpa` came out
 * as twelve arbitrary hues plus an "other" holding most of the layer, and a
 * column with more than 200 distinct values was refused outright — so `depth_km`
 * could not be mapped at all. A measurement wants breaks, and the breaks
 * already exist in `symbology.js` for the rasters.
 *
 * The classing is `buildSymbology`'s, so a vector layer and a raster layer cut
 * the same numbers the same way and their legends agree.
 *
 * @returns the symbology, or `{ok: false, message}`
 */
export function paintByRange(layer, field, {
  method = "quantile", classes = 5, ramp = "viridis", reverse = false,
  overrides = null,
} = {}) {
  // `rampColour` answers for an unknown name by returning viridis, which means
  // a qualitative ramp asked for here paints a correct map under a legend that
  // names a palette it is not using. Refuse the substitution by making it
  // explicit instead.
  if (!RAMPS[ramp]) ramp = isAngularField(field) ? "cyclic" : "viridis";
  if (!layer?.features?.length || !field) {
    return { ok: false, message: "nothing to colour" };
  }
  const values = layer.features
    .map((f) => Number(f?.properties?.[field]))
    .filter((n) => Number.isFinite(n));
  if (values.length < 2) {
    return { ok: false, message: `${field} has no numbers to classify` };
  }
  const sym = buildSymbology(values, { method, classes, ramp, reverse });
  if (!sym.ok) return sym;
  if (overrides) {
    sym.rows.forEach((row, i) => {
      const chosen = overrides.get(i);
      if (chosen) row.colour = chosen;
    });
    sym.palette = sym.rows.map((r) => r.colour);
  }
  /**
   * A feature with NO value keeps no colour at all.
   *
   * 249 of the 32,464 stress records carry a magnitude. Painting the other
   * 32,215 the bottom class would say they were measured at the low end, which
   * is the one thing the database is careful not to claim — so they return
   * null and stay in the layer's base colour, visibly not part of the scale.
   */
  layer.repaint?.((feature) => {
    const raw = feature?.properties?.[field];
    const n = raw == null || String(raw).trim() === "" ? NaN : Number(raw);
    return Number.isFinite(n) ? colourOf(n, sym) : null;
  });
  // `field` alongside the legend, the same as the categorical path sets it:
  // the legend dock and the export both read it to say what the colours are
  // OF, and a key with bounds and no quantity is half a legend.
  layer.legendInfo = { ...legendInfoFrom(sym, { label: field }), field, categorical: false };
  layer.geologyField = field;
  layer.geologyRamp = ramp;
  layer.geologyLabels = null;
  // What the dialog must reopen on, so returning to adjust a classing does not
  // propose undoing it.
  layer.rangeSpec = { field, method, classes, ramp, reverse };
  layer.symbologySingle = null;
  if (typeof window !== "undefined") {
    window.GeoIDLayerHierarchy?.render?.();
    announceSymbology();
  }
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

/**
 * A column as the picker should offer it.
 *
 * "200+ values" is what a picker says when it has only counted. For a
 * measurement it is also the wrong thing to say: what a reader needs in order
 * to choose `s1_mpa` is its RANGE, and the count of distinct readings is an
 * accident of how many boreholes reported to one decimal place.
 */
function describeColumn(column) {
  if (column.numeric && column.distinct > 2) {
    return `${column.key} — ${fmtBound(column.min)} to ${fmtBound(column.max)}`;
  }
  return `${column.key} — ${column.capped ? `${column.distinct}+` : column.distinct} `
    + `value${column.distinct === 1 ? "" : "s"}`;
}

function buildVectorForm(layer, body, note, hooks) {
  const head6 = attributeHead(layer.features, { rows: 6 });
  const ranked = rankColourFields(head6);
  const lines = !hasAreas(layer);
  /**
   * Is there any column this layer could actually be coloured BY?
   *
   * The same test the option list applies, hoisted so the opening mode can
   * use it: a column needs two distinct values to be worth a palette. A
   * drawn shape is one feature, so every column holds one value and none of
   * them qualifies — opening such a layer on "By attribute" showed a picker
   * in which every entry was disabled.
   */
  const classable = head6.columns.some(
    (column) => column.distinct >= 2 && !(column.capped && !column.numeric));
  const columnOf = new Map(head6.columns.map((c) => [c.key, c]));
  /**
   * A column of NUMBERS is classed, not listed.
   *
   * `rankColourFields` refuses anything with more than sixty distinct values,
   * which is correct for names and exactly backwards for measurements — it is
   * the magnitudes and the depths that most want a legend. So the two kinds of
   * column take two different halves of this form, and which half is decided
   * here, once.
   */
  const isRange = (key) => {
    const column = columnOf.get(key);
    return Boolean(column?.numeric && column.distinct > 2);
  };
  /**
   * What a column should be coloured with before anybody says otherwise.
   *
   * A graduated legend along a qualitative palette is twelve unrelated hues
   * over an ordered scale, and a category list along a sequential one is four
   * consecutive shades of the same blue. An ANGLE wants a third thing again:
   * a ramp that ends where it started, so 0° and 180° — the same orientation —
   * are the same colour rather than the two ends of the scale.
   */
  const defaultRamp = (key) => {
    if (!isRange(key)) return QUALITATIVE_RAMP;
    return isAngularField(key) ? "cyclic" : "viridis";
  };
  /**
   * And how to cut it. Quantile everywhere except an angle, where the bands
   * would then depend on how densely each direction happens to have been
   * sampled — two maps of the same field over different subsets would disagree
   * about where the classes are. Equal bands of degrees are what a rose diagram
   * has always used, and they mean the same thing on every dataset.
   */
  const defaultMethod = (key) => (isAngularField(key) ? "equal" : "quantile");
  const state = {
    /**
     * A LINE layer opens on single colour; an area layer opens on its columns.
     *
     * Which of the two the layer is wearing wins over both — reopening must
     * not silently propose undoing the last Apply. Failing that, it is the
     * geometry that decides: rivers and coastlines are one thing drawn many
     * times, so twelve hues along them is a legend describing an accident of
     * the attribute table. Polygons are usually a map OF something.
     *
     * Unless there is nothing to be a map of. A shape somebody drew is ONE
     * feature, so every column holds exactly one value and every one of them
     * is disabled by the rule below — "By attribute" would open with a picker
     * where nothing can be picked. `classable` is that test, and it puts a
     * drawn area on One colour, which is also the only mode its swatch means
     * anything in.
     */
    mode: layer.symbologySingle ? "single"
      : (layer.geologyField ? "field" : ((lines || !classable) ? "single" : "field")),
    single: layer.symbologySingle || DEFAULT_SINGLE,
    field: layer.geologyField || ranked[0] || head6.columns[0]?.key,
    ramp: layer.geologyRamp || QUALITATIVE_RAMP,
    // The numeric half's own two controls, reopened on what the layer wears.
    method: layer.rangeSpec?.method || null,
    classes: layer.rangeSpec?.classes || 5,
    /**
     * Set by the ramp CONTROL, not by the layer.
     *
     * It was `Boolean(layer.geologyRamp)`, and every catalogue layer arrives
     * with one — so the flag was true before the dialog opened, the select
     * never followed the column, and picking a magnitude left it reading
     * "qualitative" while the classes drew in viridis. (`rampColour` falls back
     * to viridis for a name it does not know, so the map was right and the
     * control lied about it, which is the worse of the two.) A ramp the USER
     * picks is theirs and survives a change of column; otherwise the ramp
     * follows what the column is.
     */
    rampChosen: false,
    /**
     * Keyed by VALUE for categories and by class INDEX for ranges, which is
     * why they are two maps: a category's colour belongs to "Normal faulting"
     * however the classing changes, and a class's colour belongs to the third
     * band whatever numbers are in it.
     */
    overrides: new Map(),
    rangeOverrides: new Map(),
    labels: new Map(layer.geologyLabels || []),
  };
  /**
   * The colours the layer is ALREADY WEARING become the starting point.
   *
   * A catalogue entry may name the palette its discipline reads by — the WSM's
   * red normal / green strike-slip / blue thrust is thirty years of published
   * maps — and the dialog proposed the generic qualitative ramp over the top of
   * it. Opening Symbology to change the class COUNT and pressing Apply threw
   * the convention away, silently, having shown you the new colours in a list
   * most people scroll past.
   */
  const seedPalette = () => {
    const palette = layer.cataloguePalette;
    if (!palette?.colours || palette.field !== state.field) return;
    Object.entries(palette.colours).forEach(([value, colour]) => {
      state.overrides.set(String(value), colour);
    });
  };
  seedPalette();
  // Whatever the layer wears, if it cannot mean anything on this column it is
  // not what the dialog opens on: QUALITATIVE over a set of classes is the
  // fallback-to-viridis case above.
  if (isRange(state.field) === (state.ramp === QUALITATIVE_RAMP)) {
    state.ramp = defaultRamp(state.field);
  }
  if (!state.method) state.method = defaultMethod(state.field);

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

  /**
   * Filled, or just the edge.
   *
   * A filled polygon states what the ground IS — that is a geological map,
   * and the fill is the statement. An outlined one states where a boundary
   * is and leaves the ground visible, which is what a study area or an
   * extent needs: filling those hides the very thing they were drawn around.
   * Both are right, for different layers, so it is a control rather than a
   * rule — and anything somebody drew starts on the outline.
   *
   * Only offered where it can mean something. A layer with no polygons has
   * no fill to switch off, and the row would be a control that does nothing.
   * It also applies IMMEDIATELY rather than waiting for Apply: the mode is
   * independent of the palette (it re-runs the last paint), so there is
   * nothing to hold it back for, and seeing the change is the point.
   */
  const hasPolygons = typeof layer.setFillMode === "function";
  if (hasPolygons) {
    const fillRow = document.createElement("div");
    fillRow.className = "sym-row";
    const fillLabel = document.createElement("label");
    fillLabel.textContent = "Polygons";
    const fillSelect = document.createElement("select");
    const current = layer.getFillMode?.() || "solid";
    [["outline", "Outline only"], ["solid", "Solid fill"]].forEach(([value, text]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      if (value === current) option.selected = true;
      fillSelect.appendChild(option);
    });
    fillSelect.addEventListener("change", () => {
      layer.setFillMode(fillSelect.value);
      // The legend swatches describe fills; redrawing keeps the dock honest
      // about what is actually on the globe.
      document.dispatchEvent(new CustomEvent("geoid-gis:layers-changed",
        { detail: { reason: "symbology" } }));
    });
    fillRow.append(fillLabel, fillSelect);
    body.appendChild(fillRow);
  }

  /**
   * The writing inside the shape, on or off.
   *
   * Only for shapes somebody DREW. `gis/area-labels.js` annotates those and
   * nothing else, for the reason that file gives: a geological map is
   * thousands of polygons and an area written in each one is a wall of type
   * over the map it describes. Offering the switch on a layer that has no
   * label would be a control that does nothing — the same test the fill row
   * above makes.
   *
   * Applies immediately, like the fill mode: the label loop reads the flag
   * every frame, so there is nothing to hold back for and seeing it happen
   * is the point.
   */
  if (layer.ext === "drawn") {
    const textRow = document.createElement("div");
    textRow.className = "sym-row";
    const textLabel = document.createElement("label");
    textLabel.textContent = "Annotation";
    const textSelect = document.createElement("select");
    [["on", "Name and area"], ["off", "Hidden"]].forEach(([value, text]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      if ((layer.showAreaLabel !== false) === (value === "on")) option.selected = true;
      textSelect.appendChild(option);
    });
    textSelect.addEventListener("change", () => {
      layer.showAreaLabel = textSelect.value === "on";
    });
    textRow.append(textLabel, textSelect);
    body.appendChild(textRow);
  }

  const fieldRow = document.createElement("div");
  fieldRow.className = "sym-row";
  const fieldLabel = document.createElement("label");
  fieldLabel.textContent = "Colour by";
  const fieldSelect = document.createElement("select");
  head6.columns.forEach((column) => {
    const option = document.createElement("option");
    option.value = column.key;
    option.textContent = describeColumn(column);
    // A numeric column is never refused for having too many values — that is
    // the reason to CLASS it. `depth_km` was disabled outright at 200+.
    option.disabled = column.distinct < 2 || (column.capped && !column.numeric);
    if (column.key === state.field) option.selected = true;
    fieldSelect.appendChild(option);
  });
  fieldRow.append(fieldLabel, fieldSelect);

  /* The numeric half's controls: how to cut the range, and into how many. */
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
  const countInput = document.createElement("input");
  countInput.type = "number";
  countInput.min = "2";
  countInput.max = "12";
  countInput.value = String(state.classes);
  countInput.style.width = "3.5rem";
  countInput.addEventListener("keydown", (event) => event.stopPropagation());
  methodRow.append(methodLabel, methodSelect, countInput);

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
  body.append(fieldRow, methodRow, rampRow, headWrap, classes);

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

  /** The classing the numeric half is proposing, from the live controls. */
  const rangeSymbology = () => buildSymbology(
    layer.features.map((f) => Number(f?.properties?.[state.field]))
      .filter((n) => Number.isFinite(n)),
    {
      method: state.method,
      classes: Number(countInput.value) || state.classes,
      ramp: state.ramp,
    },
  );

  const drawRangeClasses = () => {
    const sym = rangeSymbology();
    classes.replaceChildren();
    if (!sym.ok) {
      classes.textContent = sym.message;
      return;
    }
    const withValue = layer.features.filter(
      (f) => Number.isFinite(Number(f?.properties?.[state.field])),
    ).length;
    sym.rows.forEach((row, i) => {
      const line = document.createElement("div");
      line.className = "sym-class";
      const swatch = document.createElement("input");
      swatch.type = "color";
      swatch.value = state.rangeOverrides.get(i) || row.colour;
      swatch.title = "Click to recolour this class";
      swatch.addEventListener("input", () => state.rangeOverrides.set(i, swatch.value));
      const label = document.createElement("input");
      label.type = "text";
      label.value = row.label;
      // The bounds are computed, not named: an editable box here would invite
      // somebody to type a range the renderer is not using.
      label.readOnly = true;
      const count = document.createElement("span");
      count.className = "sym-class-count";
      count.textContent = row.count.toLocaleString();
      line.append(swatch, label, count);
      classes.appendChild(line);
    });
    /**
     * How many features the scale actually covers.
     *
     * 249 of the 32,464 stress records carry an S1 magnitude. A legend of five
     * classes over a layer where 99% of the features have no value is not
     * wrong, but it is the single most important thing to know before reading
     * the map — so it is said here rather than left to be discovered.
     */
    if (withValue < head6.count) {
      const missing = document.createElement("div");
      missing.className = "sym-class-note";
      missing.textContent = `${withValue.toLocaleString()} of `
        + `${head6.count.toLocaleString()} features carry a value; the rest are `
        + "left in the layer's own colour.";
      classes.appendChild(missing);
    }
  };

  const drawClasses = () => {
    if (isRange(state.field)) { drawRangeClasses(); return; }
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
    const range = isRange(state.field);
    methodRow.hidden = !range;
    bar.style.background = rampBar(rampSelect.value);
    const column = columnOf.get(state.field);
    note.textContent = `${head6.count.toLocaleString()} features · ${head6.columns.length} columns`
      + (range ? ` · ${state.field} runs ${fmtBound(column.min)} to ${fmtBound(column.max)}` : "");
    drawClasses();
  };

  modeSelect.addEventListener("change", () => {
    state.mode = modeSelect.value;
    draw();
  });
  fieldSelect.addEventListener("change", () => {
    state.field = fieldSelect.value;
    state.overrides = new Map();
    state.rangeOverrides = new Map();
    state.labels = new Map();
    // Coming BACK to the column the catalogue named brings its palette with
    // it. Without this, a look at `method` and a return to `regime` left the
    // WSM's red/green/blue replaced by the generic ramp, one Apply from being
    // the map somebody kept.
    seedPalette();
    if (!state.rampChosen) {
      state.ramp = defaultRamp(state.field);
      rampSelect.value = state.ramp;
    }
    if (!state.methodChosen) {
      state.method = defaultMethod(state.field);
      methodSelect.value = state.method;
    }
    draw();
  });
  [methodSelect, countInput].forEach((control) => {
    control.addEventListener("change", () => {
      state.method = methodSelect.value;
      state.methodChosen = true;
      state.classes = Number(countInput.value) || state.classes;
      // A different cut is different classes; a colour pinned to the old ones
      // would land on an unrelated band of values.
      state.rangeOverrides = new Map();
      draw();
    });
  });
  rampSelect.addEventListener("change", () => {
    state.ramp = rampSelect.value;
    state.rampChosen = true;
    state.overrides = new Map();
    state.rangeOverrides = new Map();
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
      if (isRange(state.field)) {
        const range = paintByRange(layer, state.field, {
          method: state.method,
          classes: Number(countInput.value) || state.classes,
          ramp: state.ramp,
          overrides: state.rangeOverrides,
        });
        if (!range.ok) return { ok: false, message: range.message };
        hooks.status?.(`${layer.name} coloured by ${state.field}: `
          + `${range.rows.length} classes by ${METHODS[range.method]?.label || range.method}.`);
        return {
          ok: true,
          kind: "vector",
          rows: range.rows,
          field: state.field,
          ramp: state.ramp,
          method: range.method,
          classes: range.rows.length,
        };
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
