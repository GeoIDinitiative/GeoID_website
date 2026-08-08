import * as store from "./project-store.js?v=20260808-a50f140";
import * as stats from "./stats.js?v=20260808-a50f140";
import * as dsp from "./dsp.js?v=20260808-a50f140";
import { parseTable, column } from "./table.js?v=20260808-a50f140";
import { linePlot, heatmap } from "./plot.js?v=20260808-a50f140";
import { el, findTables, saveFigure } from "./pages/common.js?v=20260808-a50f140";
import { createMap, BASEMAPS } from "./map2d.js?v=20260808-a50f140";

/**
 * The parts of a page the app builds while it runs.
 *
 * `qt-layout.py` recovers what `__init__` lays out, which is most of a page but
 * not all of it: CSV Plotter's dataset cards, MapPage's per-layer rows and
 * Signal Processing's series boxes are all built on demand, from a method, in
 * response to a click. A static layout tree cannot contain them — there is
 * nothing in the source to read until the click happens.
 *
 * So they are written here instead, against the same controls the tree already
 * rendered. `install(pageId, host, api)` runs after the tree is on the page and
 * wires the buttons that create things.
 *
 * The rule these follow: build the same widgets, in the same order, into the
 * same container the Qt method uses, and write to the same files. A row that
 * looks right but registers its dataset somewhere else is worse than no row.
 */

/** The Qt page's log pane, which every one of these reports into. */
function logger(api) {
  return (line) => {
    const log = api.controls.get("log");
    if (log) log.value = log.value ? `${log.value}\n${line}` : line;
    api.say(line);
  };
}

function selectOf(items, value) {
  const node = document.createElement("select");
  node.className = "input qt-select";
  items.forEach((item) => {
    const option = document.createElement("option");
    option.value = String(item);
    option.textContent = String(item);
    node.appendChild(option);
  });
  if (value !== undefined) node.value = String(value);
  return node;
}

function textInput(placeholder) {
  const node = document.createElement("input");
  node.className = "input qt-input";
  node.type = "text";
  node.placeholder = placeholder || "";
  return node;
}

function smallButton(label, onClick) {
  const node = el("button", "button secondary qt-button small", label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

/** Read a table out of the project, or off disk if it was picked locally. */
async function readTable(row) {
  if (row.file) return parseTable(await row.file.text());
  const text = await store.readProjectFile(row.path.value.trim());
  return parseTable(typeof text === "string" ? text : "");
}

/* ── CSV Plotter ──────────────────────────────────────────────────────────
 *
 * `GeoIDPlotPage._build_dataset_card` (app_qt.py:7597) and `plot_csv` (:7750).
 * One card per dataset, each with its own plot type and column mapping, and
 * one figure drawn from every card that is ticked.
 */

const PLOT_TYPES = ["line", "scatter", "bar", "hist", "spectrogram", "power-density"];

function csvPlotter(host, api) {
  const say = logger(api);
  const scroll = host.querySelector(".qt-scroll");
  if (!scroll) return;
  // The tree renders the scroll area's rows_widget with its trailing stretch;
  // cards go before it, exactly as `add_dataset_row` does. Find the stretch
  // first and take *its* parent -- the rows widget nests a level below the
  // scroll area's own layout, so the first `.qt-v` is the wrong box and
  // insertBefore threw on a node that was not its child.
  const stretch = scroll.querySelector(".qt-stretch");
  const container = stretch ? stretch.parentElement
    : (scroll.querySelector(".qt-v") || scroll);
  const rows = [];
  let lastFigure = null;

  function addRow() {
    const card = el("div", "qt-card-row");
    const select = document.createElement("input");
    select.type = "checkbox";
    select.checked = true;
    const path = textInput("Dataset path (csv/txt/json/tif...)");
    path.style.flex = "2 1 auto";
    const plotType = selectOf(PLOT_TYPES, "line");
    const xCol = selectOf([]);
    const yCol = selectOf([]);
    const zCol = selectOf(["(optional)"]);
    const tag = selectOf(["test", "queued", "main"], "test");
    const row = { card, select, path, plotType, xCol, yCol, zCol, tag, file: null };

    const browse = smallButton("Browse", async () => {
      // A project file if there is a project, a local file otherwise -- the Qt
      // page opens a file dialog, and this is the nearest honest equivalent.
      const tables = store.getActive() ? await findTables() : [];
      if (tables.length) {
        const pick = await chooseFrom(card, tables);
        if (pick) { path.value = pick; row.file = null; }
        return;
      }
      const picker = document.createElement("input");
      picker.type = "file";
      picker.accept = ".csv,.txt,.tsv,.json";
      const file = await new Promise((resolve) => {
        picker.addEventListener("change", () => resolve(picker.files?.[0] || null));
        picker.click();
      });
      if (file) { row.file = file; path.value = file.name; }
    });

    const loadCols = smallButton("Load Columns", async () => {
      let table;
      try { table = await readTable(row); }
      catch (error) { say(`[plot] file not found: ${path.value}`); return; }
      const cols = table.columns || [];
      [xCol, yCol].forEach((c) => { c.textContent = ""; });
      zCol.textContent = "";
      zCol.appendChild(new Option("(optional)", "(optional)"));
      if (!cols.length) { say(`[plot] no columns detected for ${path.value}`); return; }
      cols.forEach((name) => {
        xCol.appendChild(new Option(name, name));
        yCol.appendChild(new Option(name, name));
        zCol.appendChild(new Option(name, name));
      });
      // Qt selects the second column for Y, which is what a two-column series
      // almost always wants.
      if (cols.length > 1) yCol.selectedIndex = 1;
      // The tag the registry already holds for this file wins over the default.
      try {
        const entry = (await store.listData())
          .find((item) => item.path === path.value.trim());
        if (entry && ["test", "queued", "main"].includes(entry.tag)) tag.value = entry.tag;
      } catch (error) { /* no registry yet */ }
      say(`[plot] loaded columns for ${path.value}: ${cols.join(", ")}`);
    });

    const remove = smallButton("Remove", () => {
      const at = rows.indexOf(row);
      if (at >= 0) rows.splice(at, 1);
      card.remove();
    });

    card.append(select, path, browse,
      el("span", "qt-label", "Plot"), plotType,
      el("span", "qt-label", "X"), xCol,
      el("span", "qt-label", "Y"), yCol,
      el("span", "qt-label", "Z"), zCol,
      el("span", "qt-label", "Tag"), tag,
      loadCols, remove);
    if (stretch) container.insertBefore(card, stretch);
    else container.appendChild(card);
    rows.push(row);
    return row;
  }

  /** Pick one of the project's tables, inline rather than in a dialog. */
  function chooseFrom(anchor, options) {
    return new Promise((resolve) => {
      const menu = el("div", "qt-inline-menu");
      options.forEach((option) => {
        const item = el("button", "qt-inline-item", option);
        item.type = "button";
        item.addEventListener("click", () => { menu.remove(); resolve(option); });
        menu.appendChild(item);
      });
      const cancel = el("button", "qt-inline-item is-cancel", "Cancel");
      cancel.type = "button";
      cancel.addEventListener("click", () => { menu.remove(); resolve(null); });
      menu.appendChild(cancel);
      anchor.appendChild(menu);
    });
  }

  /**
   * The sampling rate the x column implies.
   *
   * Qt passes `Fs=1.0` because it has no idea what the x axis is; here the x
   * column was chosen deliberately, so an evenly-spaced one gives a real rate
   * and the frequency axis means something. Falls back to 1 when it does not.
   */
  function samplingOf(table, xName) {
    const xs = column(table, xName).filter(Number.isFinite);
    if (xs.length < 3) return 1;
    const step = (xs[xs.length - 1] - xs[0]) / (xs.length - 1);
    return step > 0 ? 1 / step : 1;
  }

  /** The x/y pair a row asks for, numeric rows only, as `_extract_xy` does. */
  function pairOf(table, xName, yName) {
    const xs = column(table, xName);
    const ys = column(table, yName);
    const outX = [];
    const outY = [];
    for (let i = 0; i < Math.min(xs.length, ys.length); i += 1) {
      if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) {
        outX.push(xs[i]); outY.push(ys[i]);
      }
    }
    return [outX, outY];
  }

  async function plotSelected() {
    const active = rows.filter((r) => r.select.checked);
    if (!active.length) { say("[plot] select at least one dataset row."); return; }
    const series = [];
    let spectro = null;
    for (const row of active) {
      const xName = row.xCol.value;
      const yName = row.yCol.value;
      if (!xName || !yName) continue;
      let table;
      try { table = await readTable(row); } catch (error) { continue; }
      const [xs, ys] = pairOf(table, xName, yName);
      if (!xs.length) continue;
      const name = `${row.path.value.split("/").pop()}:${yName}`;
      const mode = row.plotType.value;

      if (mode === "hist") {
        // A distribution, so the x axis stops being the x column. `histogram`
        // returns bin edges; a bar is drawn at the centre of its bin.
        const h = stats.histogram(ys, 40);
        const centres = h.counts.map((_, i) => (h.edges[i] + h.edges[i + 1]) / 2);
        series.push({ name: `${name} (hist)`, x: centres, y: h.counts, mode: "bar" });
      } else if (mode === "power-density") {
        // fs is positional, and the density comes back as `psd`.
        const spec = dsp.welch(ys, samplingOf(table, xName), { segment: 256 });
        series.push({ name: `${name}:psd`, x: Array.from(spec.freqs),
                      y: Array.from(spec.psd) });
      } else if (mode === "spectrogram") {
        spectro = { spec: dsp.spectrogram(ys, samplingOf(table, xName)), name };
      } else if (mode === "bar") {
        // `plt.bar(xs[:120], ys[:120])` -- Qt caps it, because a bar per sample
        // over a long series is a solid block.
        series.push({ name, x: xs.slice(0, 120), y: ys.slice(0, 120), mode: "bar" });
      } else {
        series.push({ name, x: xs, y: ys, mode: mode === "scatter" ? "scatter" : "line" });
      }

      if (store.getActive() && !row.file) {
        try {
          await store.registerData({
            path: row.path.value.trim(), tag: row.tag.value,
            source_stage: "Preprocessing Plotter",
          });
        } catch (error) { /* annotating must never fail the plot */ }
      }
    }

    if (!series.length && !spectro) { say("[plot] no numeric data plotted."); return; }
    const title = (api.controls.get("plot_title")?.value || "").trim();
    const canvas = spectro
      ? heatmap(spectro.spec.grid, {
          width: 880, height: 380,
          title: title || `Spectrogram: ${spectro.name}`,
          xRange: [spectro.spec.times[0] || 0,
                   spectro.spec.times[spectro.spec.times.length - 1] || 1],
          yRange: [spectro.spec.freqs[0] || 0,
                   spectro.spec.freqs[spectro.spec.freqs.length - 1] || 1],
          labels: { x: "Time", y: "Frequency" },
        })
      : linePlot(series, { width: 880, height: 380, title });

    let figure = host.querySelector(".qt-figure");
    if (!figure) {
      figure = el("div", "qt-figure");
      (host.querySelector(".qt-scroll") || host).insertAdjacentElement("afterend", figure);
    }
    figure.textContent = "";
    figure.appendChild(canvas);

    if (store.getActive()) {
      // Qt's `%Y%m%d_%H%M%S`. Slicing 15 kept the milliseconds' dot and gave
      // "…175402..png".
      const iso = new Date().toISOString();
      const stamp = `${iso.slice(0, 10).replace(/-/g, "")}_${iso.slice(11, 19).replace(/:/g, "")}`;
      try {
        lastFigure = await saveFigure(canvas, `preprocessing_plot_${stamp}.png`,
                                      "Preprocessing Plotter export");
        say(`[plot] saved: ${lastFigure}`);
      } catch (error) { say(`[plot] could not save: ${error.message}`); }
    } else {
      say("[plot] drawn. Open a project to save it into figures/.");
    }
  }

  async function preview() {
    const row = rows.find((r) => r.select.checked);
    if (!row) { say("[plot] no selected row."); return; }
    let table;
    try { table = await readTable(row); }
    catch (error) { say("[plot] file not found."); return; }
    const lines = [
      `path: ${row.path.value}`,
      `columns: ${(table.columns || []).join(", ") || "-"}`,
      "sample:",
      ...table.rows.slice(0, 12).map((r) => JSON.stringify(r).slice(0, 400)),
    ];
    say(lines.join("\n"));
  }

  async function sendToStoryboard() {
    if (!lastFigure) { say("[plot] no exported figure available yet."); return; }
    try {
      const board = await store.readJson("metadata/storyboard.json", { assets: [] });
      board.assets = board.assets || [];
      board.assets.push({ path: lastFigure, title: lastFigure.split("/").pop(),
                          added_at: new Date().toISOString() });
      await store.writeJson("metadata/storyboard.json", board);
      say(`[plot] sent to StoryBoard: ${lastFigure}`);
    } catch (error) { say(`[plot] could not reach the StoryBoard: ${error.message}`); }
  }

  bind(host, "+ Add Dataset", addRow);
  bind(host, "Plot Selected", plotSelected);
  bind(host, "Preview", preview);
  bind(host, "Send to StoryBoard", sendToStoryboard);
  addRow();   // the Qt page opens with one row
}

/** Give a tree-rendered button a handler, replacing whatever it had. */
function bind(host, label, handler) {
  Array.from(host.querySelectorAll("button")).forEach((node) => {
    if ((node.textContent || "").trim() !== label) return;
    const fresh = node.cloneNode(true);
    fresh.disabled = false;
    fresh.classList.remove("is-unwired");
    fresh.removeAttribute("title");
    fresh.addEventListener("click", async () => {
      try { await handler(); } catch (error) { console.error(error); }
    });
    node.replaceWith(fresh);
  });
}

/* ── Map Composer ─────────────────────────────────────────────────────────
 *
 * `MapPage` (app_qt.py:21296). The tree gives the toolbar, the layer panel and
 * the empty list; `_add_layer_row` (:21656) makes a card per layer and the five
 * add-layer methods (:21743 onward) create them.
 */

const LAYER_COLOURS = ["#16F4FF", "#FF1FB8", "#FFA500", "#00FF88", "#FF4444",
                       "#AA88FF", "#FFFF44", "#44AAFF", "#FF8844", "#88FF44"];

/** Pick a file, from the project when there is one. */
async function pickFile(anchor, accept, exts) {
  if (store.getActive()) {
    let entries = [];
    for (const dir of ["data/raw", "data/processed", "data/external", "exports",
                       "study_area", "metadata"]) {
      try {
        const found = await store.listProjectDir(dir);
        entries.push(...found.filter((f) => f.kind === "file"
          && exts.some((e) => f.name.toLowerCase().endsWith(e)))
          .map((f) => `${dir}/${f.name}`));
      } catch (error) { /* directory absent */ }
    }
    if (entries.length) {
      const chosen = await pickFrom(anchor, entries);
      if (chosen) return { path: chosen, text: await store.readProjectFile(chosen) };
      return null;
    }
  }
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = accept;
  const file = await new Promise((resolve) => {
    picker.addEventListener("change", () => resolve(picker.files?.[0] || null));
    picker.click();
  });
  if (!file) return null;
  return { path: file.name, text: await file.text() };
}

function pickFrom(anchor, options) {
  return new Promise((resolve) => {
    const menu = el("div", "qt-inline-menu");
    options.forEach((option) => {
      const item = el("button", "qt-inline-item", option);
      item.type = "button";
      item.addEventListener("click", () => { menu.remove(); resolve(option); });
      menu.appendChild(item);
    });
    const cancel = el("button", "qt-inline-item is-cancel", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", () => { menu.remove(); resolve(null); });
    menu.appendChild(cancel);
    anchor.appendChild(menu);
  });
}

/** Ask for a value inline, in place of a Qt input dialog. */
function askFor(anchor, fields) {
  return new Promise((resolve) => {
    const box = el("div", "qt-inline-menu is-form");
    const inputs = fields.map(({ label, value }) => {
      const wrap = el("label", "qt-stacked");
      wrap.appendChild(el("span", "qt-form-label", label));
      const input = document.createElement("input");
      input.className = "input qt-input";
      input.value = value || "";
      wrap.appendChild(input);
      box.appendChild(wrap);
      return input;
    });
    const row = el("div", "qt-h");
    const ok = el("button", "button qt-button small", "OK");
    ok.type = "button";
    ok.addEventListener("click", () => {
      box.remove();
      resolve(inputs.map((i) => i.value.trim()));
    });
    const cancel = el("button", "button secondary qt-button small", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", () => { box.remove(); resolve(null); });
    row.append(ok, cancel);
    box.appendChild(row);
    anchor.appendChild(box);
    inputs[0]?.focus();
  });
}

/**
 * The coordinate columns, exactly as `_add_layer_csv` (:21755) finds them:
 * lat/lon by name for EPSG:4326, x/easting and y/northing otherwise, with the
 * lat/lon names as the fallback either way.
 */
function coordColumns(columns, crs) {
  const lower = columns.map((c) => c.toLowerCase());
  const find = (test) => {
    const at = lower.findIndex(test);
    return at < 0 ? null : columns[at];
  };
  const latName = () => find((c) => c.includes("lat"));
  const lonName = () => find((c) => c.includes("lon") || c.includes("lng"));
  if (crs.toUpperCase() === "EPSG:4326") {
    return { x: lonName(), y: latName(), geographic: true };
  }
  return {
    x: find((c) => ["x", "easting", "e"].includes(c)) || lonName(),
    y: find((c) => ["y", "northing", "n"].includes(c)) || latName(),
    geographic: false,
  };
}

/** Every ring of a GeoJSON geometry, flattened into what the map draws. */
function geoShapes(geojson) {
  const shapes = [];
  const add = (geometry, props) => {
    if (!geometry) return;
    const { type, coordinates } = geometry;
    if (type === "Point") shapes.push({ kind: "point", coords: coordinates, props });
    else if (type === "MultiPoint") {
      coordinates.forEach((c) => shapes.push({ kind: "point", coords: c, props }));
    } else if (type === "LineString") {
      shapes.push({ kind: "line", rings: [coordinates], props });
    } else if (type === "MultiLineString") {
      shapes.push({ kind: "line", rings: coordinates, props });
    } else if (type === "Polygon") {
      shapes.push({ kind: "polygon", rings: coordinates, props });
    } else if (type === "MultiPolygon") {
      coordinates.forEach((poly) => shapes.push({ kind: "polygon", rings: poly, props }));
    } else if (type === "GeometryCollection") {
      (geometry.geometries || []).forEach((g) => add(g, props));
    }
  };
  const features = geojson.type === "FeatureCollection" ? geojson.features
    : geojson.type === "Feature" ? [geojson] : [];
  if (features.length) features.forEach((f) => add(f.geometry, f.properties || {}));
  else add(geojson, {});
  return shapes;
}

/** The bounding box of anything the map holds, for fitting the view. */
function boundsOf(layer) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const see = ([lon, lat]) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    west = Math.min(west, lon); east = Math.max(east, lon);
    south = Math.min(south, lat); north = Math.max(north, lat);
  };
  (layer.points || []).forEach(see);
  if (layer.bbox) { see([layer.bbox[0], layer.bbox[1]]); see([layer.bbox[2], layer.bbox[3]]); }
  (layer.shapes || []).forEach((shape) => {
    if (shape.kind === "point") see(shape.coords);
    else (shape.rings || []).forEach((ring) => ring.forEach(see));
  });
  return Number.isFinite(west) ? [west, south, east, north] : null;
}

function mapComposer(host, api) {
  const say = logger(api);
  // The QStackedWidget is the splitter's right-hand pane. Targeting
  // `.qt-container` instead matched the first container in the page and cleared
  // the toolbar -- basemap, Embedded, Open in Browser, Export PNG all vanished.
  const stack = host.querySelector(".qt-stack");
  const panel = host.querySelector(".qt-scroll");
  if (!panel || !stack) return;
  const listStretch = panel.querySelector(".qt-stretch");
  const list = listStretch ? listStretch.parentElement : panel;

  // The map replaces the Qt fallback label, which says the embedded map needs
  // PySide6-WebEngine -- untrue here, and a browser is the one place it is.
  const holder = el("div", "map2d");
  stack.textContent = "";
  stack.appendChild(holder);
  const map = createMap(holder, { basemap: "OpenStreetMap" });

  const layers = [];
  let colourAt = 0;
  const nextColour = () => LAYER_COLOURS[colourAt++ % LAYER_COLOURS.length];
  const crs = () => (api.controls.get("_crs_selector")?.value || "EPSG:4326");

  const basemap = api.controls.get("_basemap_combo");
  if (basemap) {
    // The tree gives the combo its five entries; make sure they are the ones
    // the map knows how to fetch.
    if (!BASEMAPS[basemap.value]) basemap.value = "OpenStreetMap";
    basemap.addEventListener("change", () => map.setBasemap(basemap.value));
  }

  function refresh() {
    map.setLayers(layers);
    list.querySelectorAll(".map-layer-row").forEach((n) => n.remove());
    layers.forEach((layer) => addLayerRow(layer));
  }

  function addLayer(layer) {
    layer.id = `l${layers.length}_${Date.now()}`;
    layer.visible = true;
    layer.opacity = layer.opacity ?? 0.9;
    layer.colour = layer.colour || nextColour();
    layers.unshift(layer);         // newest on top, as the Qt panel shows it
    const box = boundsOf(layer);
    if (box) map.fit(box);
    refresh();
    say(`[map] added ${layer.name} (${layer.type})`);
  }

  /** `_add_layer_row` (:21656): tick, colour, name, opacity, up, down, remove. */
  function addLayerRow(layer) {
    const card = el("div", "map-layer-row");

    const vis = document.createElement("input");
    vis.type = "checkbox";
    vis.checked = layer.visible;
    vis.addEventListener("change", () => { layer.visible = vis.checked; map.redraw(); });

    const swatch = el("button", "map-swatch");
    swatch.type = "button";
    swatch.style.background = layer.colour;
    swatch.title = "Layer colour";
    const colour = document.createElement("input");
    colour.type = "color";
    colour.value = layer.colour;
    colour.className = "map-colour-input";
    colour.addEventListener("input", () => {
      layer.colour = colour.value;
      swatch.style.background = colour.value;
      map.redraw();
    });
    swatch.addEventListener("click", () => colour.click());

    const name = el("span", "map-layer-name", layer.name);
    name.title = `Type: ${layer.type}\n${layer.path || ""}`;

    const opacity = document.createElement("input");
    opacity.type = "range";
    opacity.min = "0"; opacity.max = "100";
    opacity.value = String(Math.round(layer.opacity * 100));
    opacity.className = "map-opacity";
    opacity.addEventListener("input", () => {
      layer.opacity = Number(opacity.value) / 100;
      map.redraw();
    });

    const move = (delta) => () => {
      const at = layers.indexOf(layer);
      const to = at + delta;
      if (to < 0 || to >= layers.length) return;
      layers.splice(at, 1);
      layers.splice(to, 0, layer);
      refresh();
    };
    const up = el("button", "map-icon-btn", "↑");
    up.type = "button"; up.addEventListener("click", move(-1));
    const down = el("button", "map-icon-btn", "↓");
    down.type = "button"; down.addEventListener("click", move(1));
    const drop = el("button", "map-icon-btn is-danger", "✕");
    drop.type = "button";
    drop.addEventListener("click", () => {
      const at = layers.indexOf(layer);
      if (at >= 0) layers.splice(at, 1);
      refresh();
    });

    card.append(vis, swatch, colour, name, opacity, up, down, drop);
    if (layer.type === "geojson") {
      const table = el("button", "map-icon-btn", "⊞");
      table.type = "button";
      table.title = "Show attribute table";
      table.addEventListener("click", () => showAttributes(layer));
      card.appendChild(table);
    }
    if (listStretch) list.insertBefore(card, listStretch);
    else list.appendChild(card);
  }

  function showAttributes(layer) {
    const rows = (layer.shapes || []).map((s) => s.props).filter(Boolean);
    if (!rows.length) { say(`[map] ${layer.name} has no attributes.`); return; }
    const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r)))).slice(0, 12);
    let panel = host.querySelector(".map-attrs");
    if (!panel) {
      panel = el("div", "map-attrs");
      holder.appendChild(panel);
    }
    panel.textContent = "";
    const head = el("div", "map-attrs-head", `${layer.name} — ${rows.length} feature(s)`);
    const close = el("button", "map-icon-btn", "✕");
    close.type = "button";
    close.addEventListener("click", () => panel.remove());
    head.appendChild(close);
    const table = el("div", "map-attrs-table");
    table.style.gridTemplateColumns = `repeat(${keys.length}, minmax(0, 1fr))`;
    keys.forEach((k) => table.appendChild(el("span", "qt-table-head", k)));
    rows.slice(0, 200).forEach((r) => keys.forEach((k) =>
      table.appendChild(el("span", "map-attrs-cell", String(r[k] ?? "")))));
    panel.append(head, table);
  }

  // ── The five add-layer actions ────────────────────────────────────────────
  bind(host, "CSV", async () => {
    const file = await pickFile(host, ".csv,.txt,.tsv", [".csv", ".txt", ".tsv"]);
    if (!file) return;
    const table = parseTable(file.text);
    const cols = coordColumns(table.columns || [], crs());
    if (!cols.x || !cols.y) {
      say(`[map] no coordinate columns in: ${(table.columns || []).join(", ")}`);
      return;
    }
    if (!cols.geographic) {
      say(`[map] ${crs()} is projected — plotting the raw x/y, which is only `
        + "right if they are already degrees. Reproject on the Transforms page.");
    }
    const xs = column(table, cols.x);
    const ys = column(table, cols.y);
    const points = [];
    for (let i = 0; i < Math.min(xs.length, ys.length); i += 1) {
      if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) points.push([xs[i], ys[i]]);
    }
    if (!points.length) { say("[map] no valid coordinate rows found."); return; }
    addLayer({ name: file.path.split("/").pop().replace(/\.[^.]+$/, ""),
               type: "points", path: file.path, points });
  });

  bind(host, "GeoJSON", async () => {
    const file = await pickFile(host, ".geojson,.json", [".geojson", ".json"]);
    if (!file) return;
    let parsed;
    try { parsed = JSON.parse(file.text); }
    catch (error) { say(`[map] not valid JSON: ${error.message}`); return; }
    const shapes = geoShapes(parsed);
    if (!shapes.length) { say("[map] no geometry in that file."); return; }
    addLayer({ name: file.path.split("/").pop().replace(/\.[^.]+$/, ""),
               type: "geojson", path: file.path, shapes });
  });

  bind(host, "Raster BBox", async () => {
    const values = await askFor(host, [
      { label: "West", value: "-10" }, { label: "South", value: "35" },
      { label: "East", value: "20" }, { label: "North", value: "60" },
      { label: "Name", value: "raster bbox" },
    ]);
    if (!values) return;
    const bbox = values.slice(0, 4).map(Number);
    if (bbox.some((v) => !Number.isFinite(v))) { say("[map] bbox needs four numbers."); return; }
    addLayer({ name: values[4] || "raster bbox", type: "bbox", bbox });
  });

  bind(host, "WMS", async () => {
    const values = await askFor(host, [
      { label: "Tile URL template ({z}/{x}/{y})", value: "" },
      { label: "Name", value: "WMS" },
    ]);
    if (!values || !values[0]) return;
    if (!/\{z\}/.test(values[0])) {
      say("[map] that URL has no {z}/{x}/{y} placeholders.");
      return;
    }
    addLayer({ name: values[1] || "WMS", type: "wms", template: values[0], opacity: 0.75 });
  });

  bind(host, "Marker", async () => {
    say("[map] click the map to place the marker.");
    const once = ([lon, lat]) => {
      addLayer({ name: `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
                 type: "marker", points: [[lon, lat]] });
    };
    map.onClick(function handler(coords) {
      map.canvas.removeEventListener("click", handler);
      once(coords);
    });
  });

  bind(host, "Export PNG", async () => {
    await map.settled();
    if (!store.getActive()) { say("[map] open a project to save the map."); return; }
    const iso = new Date().toISOString();
    const stamp = `${iso.slice(0, 10).replace(/-/g, "")}_${iso.slice(11, 19).replace(/:/g, "")}`;
    try {
      const saved = await saveFigure(map.canvas, `map_${stamp}.png`, "Map Composer export");
      say(`[map] saved: ${saved}`);
    } catch (error) {
      // A tainted canvas is the one failure worth naming precisely.
      say(`[map] export failed: ${error.message}`);
    }
  });

  bind(host, "Open in Browser", async () => {
    await map.settled();
    map.canvas.toBlob((blob) => {
      if (!blob) { say("[map] could not render the map."); return; }
      window.open(URL.createObjectURL(blob), "_blank", "noopener");
    });
  });

  refresh();
}

export const RUNTIME = {
  "CSV Plotter": csvPlotter,
  "Map": mapComposer,
};

export function install(pageId, host, api) {
  const fn = RUNTIME[pageId];
  if (!fn) return;
  try { fn(host, api); }
  catch (error) {
    console.error(`runtime for "${pageId}" failed`, error);
  }
}
