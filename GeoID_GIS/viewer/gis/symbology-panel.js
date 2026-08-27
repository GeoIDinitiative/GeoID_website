/**
 * The symbology panel: choose how a layer is coloured, and see it change.
 *
 * It repaints the layer's own texture rather than producing a classified copy.
 * A copy would be a second layer on top of the first, and after three
 * adjustments the map is four maps deep — which is what "just make a new
 * derived layer" costs in practice.
 *
 * The legend follows from the same object the renderer uses, so the two cannot
 * disagree about what a colour means. That was the fault behind both earlier
 * symbology complaints.
 */

import {
  RAMPS,
  buildSymbology, colourOf, legendInfoFrom, METHODS, RAMP_NAMES,
  categoricalSymbology, suggestCategoryField, QUALITATIVE, QUALITATIVE_RAMP,
} from "./symbology.js?v=20260827-fce9819";

const HOST_ID = "gis-symbology-host";
/**
 * `overrides` and `edges` are the two things the user can say that no method
 * can compute: this class should be THAT colour, and the cut belongs THERE.
 *
 * Both are cleared whenever the classification itself changes -- a different
 * method, class count, ramp or field produces different classes, and carrying a
 * colour keyed to class 3 across that would paint an unrelated band of values.
 * That is also what QGIS does, and the alternative (silently reassigning) is
 * worse than starting again.
 */
const state = { layerId: null, last: null, overrides: new Map(), labels: new Map(), edges: null };

function resetChoices() {
  state.overrides = new Map();
  state.labels = new Map();
  state.edges = null;
}

/** Anything the user has said about these classes, colour or name. */
function hasChoices() {
  return state.overrides.size > 0 || state.labels.size > 0 || Boolean(state.edges);
}

/** A class's name: the user's, if they gave one, else the computed range. */
function labelFor(key, fallback) {
  const given = state.labels.get(String(key));
  return given === undefined || given === "" ? fallback : given;
}

/**
 * A class name you can type.
 *
 * "0 – 2" is a fact about the numbers and "Low" is what the map is for; a
 * legend that can only say the former makes every reader do the translation.
 * Keyed exactly as the colours are, so a class carries its name and its colour
 * together and they are discarded together.
 */
function labelInput(key, value, onChange) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "gis-sym-name";
  input.value = value;
  input.placeholder = "Name this class";
  input.title = "The name this class shows in the legend";
  input.setAttribute("aria-label", `Name for class ${key}`);
  input.addEventListener("change", () => {
    const text = input.value.trim();
    if (text) state.labels.set(String(key), text);
    else state.labels.delete(String(key));
    onChange();
  });
  return input;
}

/** A class row's colour: the user's, if they set one, else the ramp's. */
function colourFor(key, fallback) {
  return state.overrides.get(String(key)) || fallback;
}

/**
 * A swatch you can click.
 *
 * This is the ask the ramp cannot serve on its own: a ramp gives every class a
 * defensible starting colour, and then one class is "the one that matters" and
 * has to be red whatever the ramp thinks. `<input type="color">` is the native
 * picker, so it costs nothing and works on a phone.
 */
function swatchInput(key, colour, onChange) {
  const input = document.createElement("input");
  input.type = "color";
  input.className = "gis-sym-swatch-input";
  input.value = colour;
  input.title = "Click to recolour this class";
  input.setAttribute("aria-label", `Colour for ${key}`);
  input.addEventListener("input", () => {
    state.overrides.set(String(key), input.value);
    onChange();
  });
  return input;
}

function byId(id) { return document.getElementById(id); }

function paintable() {
  // Vector layers repaint too now, so the filter is "can this be redrawn",
  // not "is this a raster".
  return (window.GeoIDImportManager?.getLayers?.() || [])
    .filter((l) => l.status === "loaded" && typeof l.repaint === "function"
      && (l.raster || l.features?.length));
}

function isVector(layer) { return Boolean(!layer?.raster && layer?.features?.length); }

/** Fields a vector layer could be coloured by, the likely one first. */
function fillFieldSelect(layer) {
  const select = byId("gis-sym-field");
  if (!select) return;
  const held = select.value;
  select.innerHTML = "";
  if (!isVector(layer)) return;
  const names = [...new Set(layer.features.flatMap((f) => Object.keys(f.properties || {})))];
  const suggested = suggestCategoryField(layer.features, names);
  names.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  });
  select.value = held && names.includes(held) ? held : (suggested || names[0] || "");
}

function valuesOf(layer) {
  const band = layer.raster?.band;
  if (!band) return [];
  const noData = layer.raster.noData;
  const out = [];
  // A million-cell raster does not need every cell to find its breaks; an
  // even stride keeps the distribution's shape and keeps this instant.
  const stride = Math.max(1, Math.floor(band.length / 40000));
  for (let i = 0; i < band.length; i += stride) {
    const v = band[i];
    if (!Number.isFinite(v)) continue;
    if (noData != null && Number.isFinite(noData) && v === noData) continue;
    out.push(v);
  }
  return out;
}

function previewCategories(sym) {
  const host = byId("gis-symbology-preview");
  if (!host) return;
  host.innerHTML = "";
  const table = document.createElement("div");
  table.className = "gis-sym-rows is-editable";
  sym.rows.forEach((row) => {
    const line = document.createElement("div");
    line.className = "gis-sym-row";
    // Keyed by the category's own value rather than its position: the list is
    // ordered by count, so a new feature can reorder it and an index-keyed
    // colour would jump to a different unit.
    line.append(swatchInput(row.value, colourFor(row.value, row.colour), () => recompute(false)));
    // The category's own value stays visible as the thing being renamed -- a
    // row showing only "Basalt" cannot be checked against the attribute table.
    const text = document.createElement("span");
    text.className = "gis-sym-label";
    text.textContent = String(row.value);
    text.title = String(row.value);
    const count = document.createElement("span");
    count.className = "gis-sym-count";
    count.textContent = row.count.toLocaleString();
    line.append(text, count);
    table.appendChild(line);
    const named = document.createElement("div");
    named.className = "gis-sym-namerow";
    named.appendChild(labelInput(row.value, labelFor(row.value, ""), () => recompute(false)));
    table.appendChild(named);
  });
  host.appendChild(table);
  if (hasChoices()) {
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "button secondary gis-sym-reset";
    reset.textContent = "Reset names & colours";
    reset.addEventListener("click", () => { resetChoices(); recompute(false); });
    host.appendChild(reset);
  }
}

function preview(symbology) {
  const host = byId("gis-symbology-preview");
  if (!host) return;
  host.innerHTML = "";
  if (!symbology?.ok) return;

  const bar = document.createElement("div");
  bar.className = "gis-sym-bar";
  bar.style.background = symbology.continuous
    ? `linear-gradient(to right, ${symbology.palette.join(", ")})`
    : "";
  if (!symbology.continuous) {
    symbology.rows.forEach((row, i) => {
      const cell = document.createElement("span");
      cell.style.background = colourFor(i, row.colour);
      cell.title = `${row.from.toFixed(3)} to ${row.to.toFixed(3)} — ${row.count} cells`;
      bar.appendChild(cell);
    });
  }
  host.appendChild(bar);
  if (symbology.continuous) return;

  const fmt = (v) => (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0)
    ? v.toPrecision(3) : String(Number(v.toPrecision(4))));

  const table = document.createElement("div");
  table.className = "gis-sym-rows is-editable";
  symbology.rows.forEach((row, i) => {
    const line = document.createElement("div");
    line.className = "gis-sym-row";
    line.append(swatchInput(i, colourFor(i, row.colour), () => recompute(false)));

    // The lower edge of every class after the first IS a break, so editing it
    // moves the cut. The first class starts at the minimum and the last ends at
    // the maximum; neither is a choice, so neither is offered as one.
    if (i === 0) {
      const from = document.createElement("span");
      from.className = "gis-sym-edge is-fixed";
      from.textContent = fmt(row.from);
      from.title = "The layer's minimum";
      line.appendChild(from);
    } else {
      const edit = document.createElement("input");
      edit.type = "number";
      edit.step = "any";
      edit.className = "gis-sym-edge";
      edit.value = String(Number(row.from.toPrecision(6)));
      edit.title = "The threshold between this class and the one above";
      edit.addEventListener("change", () => {
        const edges = symbology.rows.slice(1).map((r, j) => (j === i - 1
          ? Number(edit.value) : r.from));
        // Colours are keyed by class index and the indices survive an edge move,
        // so overrides are deliberately kept here where a method change clears
        // them: the classes are the same classes, cut in a different place.
        state.edges = edges.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
        recompute(false);
      });
      line.appendChild(edit);
    }

    const to = document.createElement("span");
    to.className = "gis-sym-to";
    to.textContent = `– ${fmt(row.to)}`;
    line.appendChild(to);

    // The name goes on its own line under the numbers: at sidebar width a fifth
    // column left four characters for it, which is not a name.
    const named = document.createElement("div");
    named.className = "gis-sym-namerow";
    named.appendChild(labelInput(i, labelFor(i, ""), () => recompute(false)));
    const count = document.createElement("span");
    count.className = "gis-sym-count";
    count.textContent = row.count.toLocaleString();
    count.title = `${row.count.toLocaleString()} cells in this class`;
    named.appendChild(count);

    table.appendChild(line);
    table.appendChild(named);
  });
  host.appendChild(table);

  if (hasChoices()) {
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "button secondary gis-sym-reset";
    reset.textContent = "Reset names, colours & thresholds";
    reset.addEventListener("click", () => { resetChoices(); recompute(false); });
    host.appendChild(reset);
  }
}

/**
 * The ramps, as the thing they are.
 *
 * A dropdown of the words "viridis, magma, blues" asks the user to remember what
 * each looks like. The gallery draws each one as the gradient it is and the
 * select stays as the value store, so `currentSpec()` is unchanged and nothing
 * downstream needs to know the picker was replaced.
 */
function buildRampGallery() {
  const select = byId("gis-sym-ramp");
  if (!select || byId("gis-sym-ramp-gallery")) return;
  const row = select.closest(".row") || select.parentElement;
  const gallery = document.createElement("div");
  gallery.id = "gis-sym-ramp-gallery";
  gallery.setAttribute("role", "radiogroup");
  gallery.setAttribute("aria-label", "Colour ramp");
  // The qualitative set is a ramp you can choose, and it leads the list because
  // it is the right one for named categories. It was previously applied to every
  // categorical layer whatever the picker said, which made the picker furniture.
  if (!select.querySelector(`option[value="${QUALITATIVE_RAMP}"]`)) {
    const option = document.createElement("option");
    option.value = QUALITATIVE_RAMP;
    option.textContent = "qualitative (distinct hues)";
    select.insertBefore(option, select.firstChild);
  }
  [QUALITATIVE_RAMP, ...RAMP_NAMES].forEach((name) => {
    const step = 100 / QUALITATIVE.length;
    const stops = name === QUALITATIVE_RAMP
      // Hard stops: twelve separate colours, not a gradient between them.
      ? QUALITATIVE.map((c, i) => `${c} ${i * step}% ${(i + 1) * step}%`)
      : RAMPS[name].map((rgb) => `rgb(${rgb.join(",")})`);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gis-sym-ramp-option";
    button.dataset.ramp = name;
    button.title = name;
    button.setAttribute("aria-label", name);
    const bar = document.createElement("span");
    bar.className = "gis-sym-ramp-bar";
    bar.style.background = `linear-gradient(to right, ${stops.join(", ")})`;
    const label = document.createElement("span");
    label.className = "gis-sym-ramp-name";
    label.textContent = name;
    button.append(bar, label);
    button.addEventListener("click", () => {
      select.value = name;
      select.dispatchEvent(new Event("change"));
      syncRampGallery();
    });
    gallery.appendChild(button);
  });
  row?.parentElement?.insertBefore(gallery, row.nextSibling);
  // The select keeps the value and stops being furniture.
  if (row) row.hidden = true;
  syncRampGallery();
}

function syncRampGallery() {
  const current = byId("gis-sym-ramp")?.value;
  byId("gis-sym-ramp-gallery")?.querySelectorAll(".gis-sym-ramp-option")
    .forEach((b) => b.classList.toggle("is-active", b.dataset.ramp === current));
}

function currentSpec() {
  return {
    method: byId("gis-sym-method")?.value || "jenks",
    classes: Number(byId("gis-sym-classes")?.value) || 5,
    ramp: byId("gis-sym-ramp")?.value || "risk",
    reverse: Boolean(byId("gis-sym-reverse")?.checked),
    continuous: byId("gis-sym-method")?.value === "continuous",
    edges: state.edges,
  };
}

function recompute(apply) {
  const layer = paintable().find((l) => String(l.id ?? l.name) === state.layerId);
  const status = byId("gis-symbology-status");
  if (!layer) {
    if (status) status.textContent = "Pick a layer.";
    return;
  }
  // A vector layer has categories, not classes: geology is a list of units,
  // and cutting a list of names into five quantiles is meaningless.
  const vector = isVector(layer);
  ["gis-sym-method-row", "gis-sym-classes-row"].forEach((id) => {
    const row = byId(id);
    if (row) row.hidden = vector;
  });
  const fieldRow = byId("gis-sym-field-row");
  if (fieldRow) fieldRow.hidden = !vector;
  if (vector) {
    const field = byId("gis-sym-field")?.value;
    if (!field) { if (status) status.textContent = "That layer has no attributes."; return; }
    const sym = categoricalSymbology(layer.features, field, {
      ramp: byId("gis-sym-ramp")?.value || QUALITATIVE_RAMP,
    });
    if (!sym.ok) { if (status) status.textContent = sym.message; return; }
    state.last = sym;
    previewCategories(sym);
    if (!apply) { if (status) status.textContent = `${sym.message} Press Apply.`; return; }
    // The overrides go onto the rows AND the lookup is rebuilt from them.
    // `sym.colourOf` closes over a Map built when the symbology was created, so
    // mutating rows alone would recolour the legend and not the layer -- the two
    // disagreeing is precisely what this panel exists to prevent.
    sym.rows.forEach((r) => {
      r.colour = colourFor(r.value, r.colour);
      r.label = labelFor(r.value, String(r.value));
    });
    // Keyed by the STRING form, because that is what categoricalSymbology
    // counts by -- a row's value is "6" where the feature carries the number 6,
    // and Map.get(6) misses it, so a numeric column painted every feature the
    // no-value grey under a correct legend. See the note in symbology-dialog.js.
    const lookup = new Map(sym.rows.filter((r) => !r.other).map((r) => [String(r.value), r.colour]));
    const otherColour = sym.rows.find((r) => r.other)?.colour || null;
    // A CSS string, not [r,g,b]: this is the VECTOR repaint, which passes the
    // value to THREE.Color.set. Rewriting this branch to rebuild the lookup, I
    // also converted to RGB arrays to match the raster branch below -- and
    // every polygon went white while the legend stayed right, which is exactly
    // why the legend must never be the thing a paint is verified by.
    const painted = layer.repaint((feature) => {
      const raw = feature?.properties?.[field];
      const key = raw == null ? null : String(raw);
      return (key != null && lookup.has(key) ? lookup.get(key) : otherColour) || null;
    });
    layer.legendInfo = {
      palette: sym.rows.map((r) => r.colour.replace("#", "")),
      labels: sym.rows.map((r) => r.value),
      categorical: true, field,
    };
    window.GeoIDLayerHierarchy?.render?.();
    if (status) {
      status.textContent = painted
        ? `${layer.name} coloured by ${field}: ${sym.rows.length} categories.`
        : "That layer could not be repainted.";
    }
    return;
  }
  const symbology = buildSymbology(valuesOf(layer), currentSpec());
  if (!symbology.ok) {
    if (status) status.textContent = symbology.message;
    return;
  }
  // A per-class colour is the user's answer and outranks the ramp's, so it goes
  // onto the rows before anything reads them -- the preview, the repaint and the
  // legend then all see the same colours.
  symbology.rows.forEach((r, i) => {
    r.colour = colourFor(i, r.colour);
    r.label = labelFor(i, r.label);
  });
  symbology.palette = symbology.rows.map((r) => r.colour);
  state.last = symbology;
  preview(symbology);
  if (!apply) {
    if (status) {
      const bits = [];
      if (state.overrides.size) bits.push(`${state.overrides.size} recoloured`);
      if (state.labels.size) bits.push(`${state.labels.size} named`);
      if (state.edges) bits.push("thresholds edited");
      const edited = bits.length ? ` ${bits.join(", ")}.` : "";
      status.textContent = `${symbology.rows.length} classes ready — press Apply.${edited}`;
    }
    return;
  }
  const painted = layer.repaint((value) => {
    const colour = colourOf(value, symbology);
    if (!colour) return null;
    return [
      parseInt(colour.slice(1, 3), 16),
      parseInt(colour.slice(3, 5), 16),
      parseInt(colour.slice(5, 7), 16),
    ];
  });
  layer.legendInfo = legendInfoFrom(symbology, { unit: layer.legendInfo?.unit || null });
  window.GeoIDLayerHierarchy?.render?.();
  if (status) {
    status.textContent = painted
      ? `${layer.name}: ${symbology.rows.length} classes by ${METHODS[symbology.method]?.label || symbology.method}.`
      : "That layer could not be repainted.";
  }
}

/**
 * The symbology chosen on the way IN, applied to the layer that just loaded.
 *
 * This is deliberately the same path the panel's Apply uses -- `layer.repaint`,
 * `buildSymbology`, `legendInfoFrom` -- rather than a second implementation for
 * imports. Two paths would drift, and the first symptom would be a layer that
 * looks one way when added and another way the moment somebody opens the panel.
 *
 * The dialog offers a colour AND a ramp because a file can be either kind, and
 * only the file can settle which: a raster or a point cloud with a value is
 * GRADED and takes the ramp, while a polygon layer with nothing to grade takes
 * the flat colour. Applying both would mean one of them silently losing.
 */
export function applyImportSymbology(layer, symbology = {}) {
  if (!layer || typeof layer.repaint !== "function") return { ok: false, reason: "not repaintable" };
  const { ramp = "viridis", colour = null, opacity = null } = symbology;

  // Opacity is a material property and applies to every kind of layer, so it
  // is set whether or not there is anything to grade.
  if (Number.isFinite(opacity) && layer.object3D) {
    layer.object3D.traverse((node) => {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((m) => {
        if (!m) return;
        m.transparent = opacity < 1;
        m.opacity = opacity;
        m.needsUpdate = true;
      });
    });
  }

  const values = valuesOf(layer);
  if (values.length) {
    // Graded: equal intervals over five classes is the neutral default, and the
    // panel can reclassify it afterwards without repainting from scratch.
    const built = buildSymbology(values, { ramp, method: "equal", classes: 5 });
    if (!built.ok) return { ok: false, reason: built.message };
    const painted = layer.repaint((value) => {
      const hexColour = colourOf(value, built);
      if (!hexColour) return null;
      return [
        parseInt(hexColour.slice(1, 3), 16),
        parseInt(hexColour.slice(3, 5), 16),
        parseInt(hexColour.slice(5, 7), 16),
      ];
    });
    if (painted) layer.legendInfo = legendInfoFrom(built, { unit: layer.legendInfo?.unit || null });
    window.GeoIDLayerHierarchy?.render?.();
    return { ok: Boolean(painted), graded: true, ramp, classes: built.rows.length };
  }

  if (colour && isVector(layer)) {
    const rgb = [
      parseInt(colour.slice(1, 3), 16),
      parseInt(colour.slice(3, 5), 16),
      parseInt(colour.slice(5, 7), 16),
    ];
    const painted = layer.repaint(() => rgb);
    if (painted) {
      layer.legendInfo = { palette: [colour.replace("#", "")], labels: [layer.name], categorical: true };
    }
    window.GeoIDLayerHierarchy?.render?.();
    return { ok: Boolean(painted), graded: false, colour };
  }
  // Opacity may still have been applied, which is a real change.
  return { ok: Number.isFinite(opacity), graded: false };
}

function fillLayers() {
  const select = byId("gis-sym-layer");
  if (!select) return;
  const held = select.value;
  select.innerHTML = "";
  const layers = paintable();
  if (!layers.length) {
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "No raster layer loaded";
    select.appendChild(none);
    return;
  }
  layers.forEach((layer) => {
    const option = document.createElement("option");
    option.value = layer.id != null ? String(layer.id) : layer.name;
    option.textContent = layer.name;
    select.appendChild(option);
  });
  select.value = held && [...select.options].some((o) => o.value === held) ? held : select.options[0].value;
  state.layerId = select.value;
}

/**
 * Point this panel at a layer from somewhere else on the page.
 *
 * The panel could always symbolise any layer that can repaint; what it could
 * not do was be *asked* to. A dataset toggled on from a catalogue is three
 * panels away from here, and telling somebody to go and find the layer in a
 * dropdown is not wiring it up. This selects the layer, opens whatever the
 * panel is folded inside, and brings it into view.
 */
export function openFor(layer) {
  const select = byId("gis-sym-layer");
  if (!select || !layer) return false;
  const id = String(layer.id ?? layer.name);
  fillLayers();
  if (![...select.options].some((o) => o.value === id)) return false;
  select.value = id;
  select.dispatchEvent(new Event("change"));
  const host = byId(HOST_ID);
  /**
   * Selected is not the same as on screen.
   *
   * This panel lives several folds deep — inside a `<details>` tool section,
   * inside a `<details>` group, and the toolbox hides whole groups with the
   * `hidden` attribute when another tab is showing. Opening the folds is not
   * enough if an ancestor is hidden outright, so both are cleared on the way
   * up. Measured before this: the layer was selected and the panel's
   * `offsetParent` was null — nothing on screen had changed.
   */
  let node = host;
  while (node && node !== document.body) {
    if (node.tagName === "DETAILS") node.open = true;
    if (node.hasAttribute?.("hidden")) node.removeAttribute("hidden");
    node = node.parentElement;
  }
  host?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  return true;
}

export function init() {
  const host = byId(HOST_ID);
  if (!host || host.dataset.built) return;
  host.dataset.built = "1";

  const method = byId("gis-sym-method");
  if (method) {
    Object.entries(METHODS).forEach(([id, m]) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = m.label;
      method.appendChild(option);
    });
    const smooth = document.createElement("option");
    smooth.value = "continuous";
    smooth.textContent = "Continuous (no classes)";
    method.appendChild(smooth);
  }
  const ramp = byId("gis-sym-ramp");
  if (ramp) {
    RAMP_NAMES.forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      ramp.appendChild(option);
    });
  }

  buildRampGallery();
  fillLayers();
  fillFieldSelect(paintable().find((l) => String(l.id ?? l.name) === state.layerId));
  window.GeoIDImportManager?.onChange?.(() => {
    fillLayers();
    fillFieldSelect(paintable().find((l) => String(l.id ?? l.name) === state.layerId));
  });
  byId("gis-sym-layer")?.addEventListener("change", (e) => {
    state.layerId = e.target.value;
    // Another layer's classes are not this layer's classes.
    resetChoices();
    recompute(false);
  });
  byId("gis-sym-layer")?.addEventListener("change", () => {
    const layer = paintable().find((l) => String(l.id ?? l.name) === state.layerId);
    fillFieldSelect(layer);
    recompute(false);
  });
  // A new method, class count, ramp, direction or field means new classes, so a
  // colour or a threshold pinned to the old ones is discarded rather than
  // reassigned to an unrelated band of values.
  ["gis-sym-method", "gis-sym-classes", "gis-sym-ramp", "gis-sym-reverse", "gis-sym-field"].forEach((id) => {
    byId(id)?.addEventListener("change", () => {
      resetChoices();
      syncRampGallery();
      recompute(false);
    });
  });
  byId("gis-sym-apply")?.addEventListener("click", () => recompute(true));
}

if (typeof window !== "undefined") {
  window.GeoIDSymbologyPanel = { init, recompute };
  // The name the catalogues look for, so a dataset toggled on three panels away
  // can still be pointed at this one.
  window.GeoIDSymbology = { openFor, applyImportSymbology };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}
