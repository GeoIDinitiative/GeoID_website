import * as store from "./project-store.js?v=20260905-36e4cce";
import * as stats from "./stats.js?v=20260905-36e4cce";
import * as dsp from "./dsp.js?v=20260905-36e4cce";
import { parseTable, column } from "./table.js?v=20260905-36e4cce";
import { linePlot, heatmap } from "./plot.js?v=20260905-36e4cce";
import { el, findTables, saveFigure } from "./pages/common.js?v=20260905-36e4cce";
import { createMap, BASEMAPS } from "./map2d.js?v=20260905-36e4cce";
import * as sidecar from "./sidecar.js?v=20260905-36e4cce";
import * as bridge from "./bridge.js?v=20260905-36e4cce";
import { runConnector, studyBbox, CONNECTORS } from "./connectors.js?v=20260905-36e4cce";

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

/**
 * Pick one of a list, inline rather than in a file dialog.
 *
 * Module-scope because two pages need it: the CSV Plotter chooses a table and
 * the Figure Composer chooses a figure. It lived inside csvPlotter and was
 * therefore invisible to the second — a scope error `node --check` cannot see,
 * because syntax is fine and only the call at runtime fails.
 */
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

/* ── Live Monitor ─────────────────────────────────────────────────────────
 *
 * `LiveMonitorPage` puts a matplotlib canvas under its controls and redraws it
 * as the watched file grows. The tree holds the controls and the status row;
 * the canvas was added at runtime, so the page rendered as two rows and a blank
 * screen — 7% of its height used.
 */
function liveMonitor(host, api) {
  const say = logger(api);
  const holder = el("div", "monitor-plot");
  const empty = el("p", "research-note",
    "Pick a table and press Start. The plot redraws each time the file grows.");
  holder.appendChild(empty);
  const status = host.querySelector(".research-status");
  host.insertBefore(holder, status || null);

  let timer = null;
  let lastRows = -1;

  async function draw() {
    const chosen = (api.controls.get("_path")?.value
      || api.controls.get("_watch_path")?.value || "").trim();
    let path = chosen;
    if (!path) {
      const tables = await findTables();
      if (!tables.length) return;
      path = tables[0];
    }
    let table;
    try { table = parseTable(await store.readProjectFile(path)); }
    catch (error) { return; }
    if (table.rows.length === lastRows) return;
    lastRows = table.rows.length;

    const numeric = table.columns
      .map((name, i) => ({ name, i }))
      .filter(({ i }) => table.numeric[i]);
    if (!numeric.length) return;
    // The page names its own x and y columns; fall back to the first two.
    const xName = (api.controls.get("_x_col")?.value || "").trim();
    const yNames = (api.controls.get("_y_cols")?.value || "").trim();
    const xs = xName && table.columns.includes(xName)
      ? column(table, xName)
      : column(table, numeric[0].name);
    const wanted = yNames ? yNames.split(",").map((s) => s.trim()).filter(Boolean)
      : numeric.slice(xName ? 0 : 1).map((c) => c.name);
    const series = wanted
      .filter((name) => table.columns.includes(name))
      .slice(0, 4)
      .map((name) => ({ name, x: xs, y: column(table, name) }))
      .filter((s) => s.y.some(Number.isFinite));
    if (!series.length) return;

    const canvas = linePlot(series, { width: 900, height: 360,
      title: `${path.split("/").pop()} — ${lastRows} rows`,
      labels: { x: xName || numeric[0].name, y: "" } });
    holder.textContent = "";
    holder.appendChild(canvas);
  }

  bind(host, "Start", async () => {
    if (timer) { say("Already watching."); return; }
    await draw();
    const seconds = Math.max(2, Number(api.controls.get("_interval_spin")?.value) || 10);
    timer = setInterval(draw, seconds * 1000);
    say(`Watching every ${seconds}s.`);
  });
  bind(host, "Stop", async () => {
    if (!timer) { say("Not watching."); return; }
    clearInterval(timer);
    timer = null;
    say("Stopped watching.");
  });
  // The page can be left at any time; a timer outliving it would redraw into a
  // node that is no longer on screen.
  new MutationObserver((records, observer) => {
    if (!host.isConnected) {
      if (timer) clearInterval(timer);
      observer.disconnect();
    }
  }).observe(document.getElementById("research-page"), { childList: true });

  void draw();
}

/* ── Sidecar-backed execution ─────────────────────────────────────────────
 *
 * These are the verbs that need a real interpreter — run a training script, run
 * an external script or one of its functions. When the sidecar is connected
 * (Settings ▸ Sidecar) the button starts a real subprocess and streams its
 * output into the page's own log pane; when it is not, the button says what to
 * do instead of failing silently. The page renders the controls either way, so
 * the wiring only ever attaches behaviour to a button the tree already drew.
 */

/** Stream a job into the page's log pane, and remember it for a Stop button. */
function runJob(api, host, start, { on = "log" } = {}) {
  const say = logger(api);
  const logNode = api.controls.get(on) || host.querySelector(".qt-textarea[readonly], .qt-textarea");
  const write = (line) => {
    if (logNode) {
      logNode.value = logNode.value ? `${logNode.value}
${line}` : line;
      logNode.scrollTop = logNode.scrollHeight;
    }
  };
  (async () => {
    let jobId;
    try { jobId = await start(); }
    catch (error) { say(`Could not start: ${error.message}`, true); return; }
    write(`▶ job ${jobId} started.`);
    host._sidecarJob = jobId;
    sidecar.streamJob(jobId, {
      onLine: (text) => write(text),
      onStatus: (status, code) => {
        write(`■ ${status}${code == null ? "" : ` (exit ${code})`}.`);
        say(`Job ${status}${code == null ? "" : ` — exit ${code}`}.`);
        host._sidecarJob = null;
      },
    });
  })();
}

/** A page whose real work is a subprocess: bind its run/stop to the sidecar. */
function makeRunner(pageId, plan) {
  return function runnerPage(host, api) {
    const say = logger(api);
    // The path field the plan needs, read fresh at click time.
    const val = (name) => (api.controls.get(name)?.value || "").trim();

    plan.runs.forEach(({ label, start, needs }) => {
      bind(host, label, async () => {
        if (!sidecar.isConnected()) {
          say("This runs a Python process — connect the sidecar in Settings ▸ "
            + "Sidecar first (python3 GeoID_GIS/sidecar/geoid_sidecar.py).", true);
          return;
        }
        const missing = (needs || []).filter((f) => !val(f.var));
        if (missing.length) {
          say(`Fill in: ${missing.map((f) => f.label).join(", ")}.`, true);
          return;
        }
        runJob(api, host, () => start(val));
      });
    });

    if (plan.stop) {
      bind(host, plan.stop, async () => {
        if (!host._sidecarJob) { say("Nothing running."); return; }
        await sidecar.stopJob(host._sidecarJob).catch(() => {});
        say("Stop requested.");
      });
    }
  };
}

const aiTrainer = makeRunner("AI Trainer", {
  runs: [{
    label: "Run Training Script",
    needs: [{ var: "trainer_script", label: "Trainer Script" },
            { var: "dataset_path", label: "Training Dataset" },
            { var: "export_dir", label: "Output Directory" }],
    start: (val) => sidecar.runTraining({
      script: val("trainer_script"), dataset: val("dataset_path"),
      output: val("export_dir"), args: val("command_args"),
    }),
  }],
});

const externalRunner = makeRunner("Signal Processing", {
  runs: [
    {
      label: "Run Script Main",
      needs: [{ var: "external_path", label: "Source path" }],
      start: (val) => sidecar.runScript({
        script: val("external_path"), cwd: val("external_workdir") || undefined,
        label: "external script",
      }),
    },
    {
      label: "Run Function",
      needs: [{ var: "external_path", label: "Source path" },
              { var: "external_function", label: "Function" }],
      start: (val) => sidecar.runFunction({
        script: val("external_path"), func: val("external_function"),
        cwd: val("external_workdir") || undefined,
        kwargs: (() => {
          const raw = (val("external_args") || "").trim();
          if (!raw) return {};
          try { return JSON.parse(raw); } catch (e) { throw new Error("JSON kwargs are not valid JSON."); }
        })(),
      }),
    },
  ],
  stop: "Stop External Run",
});

/* ── Settings: connect the sidecar ────────────────────────────────────────
 *
 * A card above the credential groups: paste the line the sidecar prints, press
 * Connect, and the hub probes it and — on success — switches the project store
 * to the sidecar's filesystem, so from then on the hub reads and writes the
 * same folder the desktop app uses.
 */
function settingsSidecar(host, api) {
  const say = logger(api);
  const page = host.querySelector(".qt-page") || host;
  const card = el("section", "qt-groupbox sidecar-card");
  card.appendChild(el("h3", "qt-groupbox-title", "Local Sidecar — run Python here"));
  card.appendChild(el("p", "qt-card-desc",
    "The training scripts, the external runner and live jobs need a Python "
    + "process on this machine. Start it with "
    + "\u201cpython3 GeoID_GIS/sidecar/geoid_sidecar.py --root <your projects "
    + "folder>\u201d and paste the line it prints below."));

  const row = el("div", "qt-h");
  const input = document.createElement("input");
  input.className = "input qt-input";
  input.placeholder = "http://127.0.0.1:8137?token=\u2026";
  input.style.flex = "1 1 auto";
  const cfg = sidecar.getConfig();
  if (cfg.url) input.value = cfg.token ? `${cfg.url}?token=${cfg.token}` : cfg.url;
  const connect = el("button", "button qt-button", "Connect");
  connect.type = "button";
  const forget = el("button", "button secondary qt-button", "Disconnect");
  forget.type = "button";
  row.append(input, connect, forget);
  card.appendChild(row);

  const status = el("p", "sidecar-status");
  card.appendChild(status);
  const paint = (c) => {
    status.textContent = c.connected
      ? `Connected — ${c.root || "sidecar"} (v${c.version || "?"}). The hub is using it as the project store.`
      : c.url ? "Configured, not connected. Press Connect, or check the sidecar is running."
      : "Not configured.";
    status.classList.toggle("is-on", !!c.connected);
  };
  paint(cfg);
  sidecar.onChange(paint);

  connect.addEventListener("click", async () => {
    sidecar.configure(input.value);
    status.textContent = "Probing\u2026";
    const result = await sidecar.probe();
    if (result.ok) {
      // Switch the store to the sidecar's filesystem and reopen from it.
      try {
        store.useAdapter(sidecar.sidecarAdapter());
        say("Sidecar connected — the hub is now reading the projects folder "
          + "through it.");
      } catch (error) { say(`Connected, but could not switch the store: ${error.message}`, true); }
    } else {
      say(result.reason === "bad-token" ? "The token was not accepted."
        : result.reason === "unreachable" ? "Could not reach the sidecar at that address."
        : "Sidecar not configured.", true);
    }
  });
  forget.addEventListener("click", async () => {
    sidecar.configure("");
    say("Sidecar forgotten. Reopen a project to fall back to the browser store.");
  });

  // Sit the card at the very top of the page body.
  const body = page.querySelector(":scope > .qt-layout") || page;
  body.insertBefore(card, body.firstChild);
}

/* ── Pipeline Editor ──────────────────────────────────────────────────────
 *
 * `PipelineEditorPage` (app_qt.py:20574). A node library on the left, a
 * pipeline list on the right, and the toolbar that moves between them. The
 * library is filled at runtime from the class constant `_AVAILABLE_NODES`
 * (name, category, colour), which the extractor now carries on the page as
 * `class_consts`, so the catalogue stays in step with the app.
 */
const PIPELINE_DOC = "metadata/pipeline_definition.json";

function pipelineEditor(host, api) {
  const say = logger(api);
  const nodeList = api.controls.get("_node_list")
    || host.querySelector(".qt-listwidget");
  const pipeList = api.controls.get("_pipeline_list")
    || Array.from(host.querySelectorAll(".qt-listwidget"))[1];
  const runLog = api.controls.get("_run_log");
  if (!nodeList || !pipeList) return;

  const catalog = (api.spec?.class_consts?._AVAILABLE_NODES || [])
    .map(([name, category, color]) => ({ name, category, color }));
  let pipeline = [];
  let nodeSel = -1;
  let pipeSel = -1;

  const write = (line) => {
    if (!runLog) { say(line); return; }
    runLog.value = runLog.value ? `${runLog.value}\n${line}` : line;
    runLog.scrollTop = runLog.scrollHeight;
  };

  // ── The node library, coloured as the app colours it ──────────────────────
  nodeList.textContent = "";
  catalog.forEach((node, index) => {
    const row = el("button", "pipe-node", node.name);
    row.type = "button";
    row.style.setProperty("--node", node.color);
    row.title = node.category;
    row.addEventListener("click", () => {
      nodeSel = index;
      nodeList.querySelectorAll(".pipe-node").forEach((n, i) =>
        n.classList.toggle("is-selected", i === index));
    });
    nodeList.appendChild(row);
  });

  function renderPipeline() {
    pipeList.textContent = "";
    if (!pipeline.length) {
      pipeList.appendChild(el("p", "research-note", "Add nodes from the library."));
    }
    pipeline.forEach((node, index) => {
      const row = el("button", "pipe-node is-step", `▶  ${node.name}`);
      row.type = "button";
      row.style.setProperty("--node", node.color);
      row.classList.toggle("is-selected", index === pipeSel);
      row.addEventListener("click", () => {
        pipeSel = index;
        pipeList.querySelectorAll(".pipe-node").forEach((n, i) =>
          n.classList.toggle("is-selected", i === index));
      });
      pipeList.appendChild(row);
    });
  }
  renderPipeline();

  const persist = async () => {
    if (store.getActive()) await store.writeJson(PIPELINE_DOC, pipeline).catch(() => {});
  };

  bind(host, "Add to Pipeline →", async () => {
    if (nodeSel < 0) { say("Select a node in the library first."); return; }
    pipeline.push({ ...catalog[nodeSel] });
    pipeSel = pipeline.length - 1;
    renderPipeline();
    await persist();
  });
  bind(host, "Remove Selected", async () => {
    if (pipeSel < 0) { say("Select a step to remove."); return; }
    pipeline.splice(pipeSel, 1);
    pipeSel = Math.min(pipeSel, pipeline.length - 1);
    renderPipeline();
    await persist();
  });
  const move = (delta) => async () => {
    const to = pipeSel + delta;
    if (pipeSel < 0 || to < 0 || to >= pipeline.length) return;
    [pipeline[pipeSel], pipeline[to]] = [pipeline[to], pipeline[pipeSel]];
    pipeSel = to;
    renderPipeline();
    await persist();
  };
  bind(host, "▲", move(-1));
  bind(host, "▼", move(1));

  bind(host, "Save", async () => {
    if (!store.getActive()) { say("Open a project to save the pipeline."); return; }
    await store.writeJson(PIPELINE_DOC, pipeline);
    write(`Pipeline saved to ${PIPELINE_DOC} (${pipeline.length} step(s)).`);
  });
  bind(host, "Load", async () => {
    if (!store.getActive()) { say("Open a project first."); return; }
    pipeline = await store.readJson(PIPELINE_DOC, []);
    if (!Array.isArray(pipeline)) pipeline = [];
    pipeSel = -1;
    renderPipeline();
    write(`Loaded ${pipeline.length} step(s) from ${PIPELINE_DOC}.`);
  });
  bind(host, "Run Pipeline", async () => {
    if (!pipeline.length) { say("The pipeline is empty."); return; }
    if (runLog) runLog.value = "";
    const now = new Date().toLocaleTimeString();
    write(`Pipeline run started — ${now}`);
    pipeline.forEach((node, i) => {
      write(`  [${i + 1}/${pipeline.length}] ${node.name} (${node.category})  … queued`);
    });
    write("\nEach stage runs from its own page, or on the sidecar when it "
      + "maps to a script. Full auto-run wires to the stage pages.");
    await persist();
  });

  // Open with whatever the project already holds.
  if (store.getActive()) {
    store.readJson(PIPELINE_DOC, []).then((saved) => {
      if (Array.isArray(saved) && saved.length) { pipeline = saved; renderPipeline(); }
    });
  }
}

/* ── Pipeline Runner ──────────────────────────────────────────────────────
 *
 * `AutoPipelineRunnerPage` (app_qt.py:21136). Five fixed stages, each a
 * checkbox + name + description + status pill, built in a loop over the class
 * constant `_STAGES` — so the tree carried one empty template row. The runtime
 * fills the stage frame from `class_consts._STAGES` and wires Run Pipeline /
 * Reset Status, driving each enabled stage queued → running → done as
 * `_run_pipeline` does.
 */
function pipelineRunner(host, api) {
  const say = logger(api);
  const page = host.querySelector(".qt-page") || host;
  // The stage frame is the container that held the single template row.
  const frame = page.querySelector(".qt-container, .qt-source-card")
    || page.querySelector(":scope > .qt-layout > *");
  const stages = (api.spec?.class_consts?._STAGES || [])
    .map(([name, desc]) => ({ name, desc }));
  const logNode = api.controls.get("log")
    || page.querySelector(".qt-textarea[readonly], .qt-textarea");
  if (!frame || !stages.length) return;

  const rows = [];
  // Replace the template row with the real five.
  const grid = frame.querySelector(".qt-layout") || frame;
  grid.textContent = "";
  stages.forEach((stage) => {
    const row = el("div", "pipe-run-row");
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = true;
    const name = el("span", "pipe-run-name", stage.name);
    const desc = el("span", "pipe-run-desc", stage.desc);
    const status = el("span", "qt-pill pipe-run-status", "queued");
    row.append(check, name, desc, status);
    grid.appendChild(row);
    rows.push({ ...stage, check, status });
  });

  const write = (line) => {
    if (logNode) { logNode.value = logNode.value ? `${logNode.value}\n${line}` : line; logNode.scrollTop = logNode.scrollHeight; }
    else say(line);
  };
  const setStatus = (row, text, cls) => {
    row.status.textContent = text;
    row.status.className = `qt-pill pipe-run-status ${cls || ""}`;
  };

  bind(host, "Reset Status", async () => {
    rows.forEach((row) => setStatus(row, "queued", ""));
    if (logNode) logNode.value = "";
  });

  bind(host, "▶  Run Pipeline", async () => {
    if (logNode) logNode.value = "";
    rows.forEach((row) => setStatus(row, "queued", ""));
    const enabled = rows.filter((row) => row.check.checked);
    if (!enabled.length) { write("No stages enabled."); return; }
    write(`Pipeline run started — ${new Date().toLocaleTimeString()}`);
    for (const row of enabled) {
      setStatus(row, "running…", "is-running");
      write(`  ${row.name} … running`);
      // Each stage runs from its own page; a brief pause makes the progression
      // visible, as processEvents does in the app.
      await new Promise((r) => setTimeout(r, 250));
      setStatus(row, "✅ done", "is-done");
      write(`  ${row.name} … done`);
    }
    write("\nEach stage runs in full from its own page; this chains their status.");
  });
}

/* ── Run Existing: the FEM stage's execute step ───────────────────────────
 *
 * The Qt "Run Existing" page is a command runner — a working directory, a
 * command, a Run button and a Log tab — which is exactly how the desktop app
 * launches GALES (`mpirun -n N gales <deck>`). This wires that page to the
 * sidecar: Run executes the command in the run folder as a streamed job, its
 * output filling the Log tab, and the sidecar files a status.json beside the
 * deck. Browse rotates through the project's fem_runs/ so a run is one click
 * rather than a typed path, and the command is pre-filled from the deck it
 * finds. Without a sidecar the button says how to start one — the tree still
 * drew the page, so this only ever attaches behaviour to controls that exist.
 */
function galesRunner(host, api) {
  const say = logger(api);
  const val = (name) => (api.controls.get(name)?.value || "").trim();
  const setVal = (name, v, { force = false } = {}) => {
    const node = api.controls.get(name);
    if (node && (force || !node.value)) node.value = v;
  };

  async function runsInProject() {
    return (await store.listProjectDir("fem_runs").catch(() => []))
      .filter((e) => e.kind === "directory").map((e) => e.name);
  }
  // The command a run implies. A GALES sim is a *built executable* reading
  // setup.txt/props.txt from its folder — `mpirun -n N ./executable` — which is
  // how every reference sim runs; there is no deck file. A run.sh wrapper wins
  // if the run has one, and a `.in` is only a legacy fallback.
  async function commandFor(run) {
    const files = await store.listProjectDir(`fem_runs/${run}`).catch(() => []);
    if (files.some((e) => e.name === "run.sh")) return "./run.sh";
    const ranks = Number(api._galesRanks?.()) || 4;
    if (files.some((e) => e.name === "executable")) return `mpirun -n ${ranks} ./executable`;
    const deck = files.find((e) => e.name.endsWith(".in"));
    if (deck) return `mpirun -n ${ranks} gales ${deck.name}`;
    // Nothing built yet — say what to press rather than suggest a command that
    // cannot work.
    return null;
  }
  async function selectRun(run, { force = false } = {}) {
    const active = store.getActive();
    if (!active) return;
    setVal("workdir", `${active.dir}/fem_runs/${run}`, { force });
    const cmd = await commandFor(run);
    if (cmd) setVal("cmd", cmd, { force });
  }

  // Pre-fill from the first run on mount. Forced, because a freshly rendered
  // field holds only the tree's placeholder default ("./run.sh"), never typed
  // input — so replacing it with the run's real command is safe and useful.
  (async () => {
    const runs = await runsInProject();
    if (runs.length) await selectRun(runs[0], { force: true });
  })();

  // Browse can't open a native dialog against a sandboxed sidecar, so it steps
  // through the project's runs instead — press again for the next one.
  bind(host, "Browse", async () => {
    const runs = await runsInProject();
    if (!runs.length) { say("No FEM runs yet — create one under FEM ▸ Setup.", true); return; }
    const current = val("workdir").split("/").pop();
    const next = runs[(runs.indexOf(current) + 1) % runs.length];
    await selectRun(next, { force: true });
    say(`Run: ${next} (${runs.length} in project). Press Browse for the next.`);
  });

  bind(host, "Run", async () => {
    if (!sidecar.isConnected()) {
      say("This runs the solver as a real process — connect the sidecar in "
        + "Settings ▸ Sidecar first (python3 GeoID_GIS/sidecar/geoid_sidecar.py).", true);
      return;
    }
    const dir = val("workdir");
    const cmd = val("cmd");
    if (!dir) { say("Set a working directory — a run folder under the project.", true); return; }
    if (!cmd) { say("Enter a command to run.", true); return; }
    // Where, and with how many ranks, comes from the compute card below.
    const target = api._galesTarget?.() || undefined;
    const cores = api._galesRanks?.();
    // A remote target rebuilds the command for the server, so the local box's
    // rank count and paths do not travel with it.
    runJob(api, host, () => sidecar.runGales(
      target ? { dir, target, cores } : { dir, cmd, cores }));
  });

  // "Generate & build deck": turn the run's spec.json into a runnable, compiled
  // GALES sim — setup.txt, props.txt, the solver boilerplate, the converted mesh
  // and the build. The Qt command-runner page has no such button, so it is
  // injected. Uses the rank count from the command's `mpirun -n`.
  const prep = el("section", "research-card gis-live-sources");
  prep.appendChild(el("h2", "research-card-title", "Prepare GALES deck"));
  prep.appendChild(el("p", "research-note",
    "Generate the deck (setup.txt, props.txt, solver boilerplate) from this "
    + "run's spec.json, convert its mesh and build it — then Run solves it. "
    + "Needs the sidecar started with a GALES tree (--gales)."));
  const prepBtn = el("button", "button", "⚙ Generate & build deck");
  prepBtn.type = "button";
  prepBtn.addEventListener("click", () => {
    if (!sidecar.isConnected()) {
      say("Connect the sidecar first (Settings ▸ Sidecar).", true); return;
    }
    const dir = val("workdir");
    if (!dir) { say("Choose a run folder first (Browse).", true); return; }
    // The mesh must be partitioned for the rank count the solve will use, so
    // this takes the compute card's ranks rather than the typed command's.
    const cores = api._galesRanks?.()
      || Number((val("cmd").match(/-n\s+(\d+)/) || [])[1]) || 4;
    runJob(api, host, () => sidecar.prepareGales({ dir, cores }));
  });
  const prepRow = el("div", "gis-btn-row");
  prepRow.appendChild(prepBtn);
  prep.appendChild(prepRow);
  host.insertBefore(prep, host.firstChild);

  // ── Where it runs ─────────────────────────────────────────────────────────
  // A solve outgrows a laptop fast, so the machine is a choice: mpirun here, or
  // a server you already have. The sidecar pushes the deck over ssh, solves
  // there and brings the results back, so everything downstream is unchanged.
  const compute = el("section", "research-card gis-live-sources");
  compute.appendChild(el("h2", "research-card-title", "Where it runs"));
  compute.appendChild(el("p", "research-note",
    "Solve on this machine with mpirun, or on a server (a Hetzner box, a lab "
    + "workstation, a cluster login node). The deck is sent over, solved there, "
    + "and the results come back into this run folder."));
  const targetPick = selectOf(["This machine (mpirun)"], "This machine (mpirun)");
  const ranksInput = textInput("ranks");
  ranksInput.type = "number";
  ranksInput.min = "1";
  ranksInput.value = "4";
  ranksInput.style.maxWidth = "7rem";
  const testBtn = el("button", "button secondary", "Test");
  testBtn.type = "button";
  const addBtn = el("button", "button secondary", "+ Add a server");
  addBtn.type = "button";
  const row1 = el("div", "gis-btn-row");
  row1.append(el("span", "qt-label", "Run on"), targetPick,
    el("span", "qt-label", "MPI ranks"), ranksInput, testBtn, addBtn);
  compute.appendChild(row1);

  // The saved targets, by display label. "local" is always offered and is not
  // stored — it needs no configuration.
  let targets = {};
  const labelFor = (name, t) => (t.kind === "local"
    ? `${name} (this machine)`
    : `${name} — ${t.user ? `${t.user}@` : ""}${t.host}${t.ranks ? ` · ${t.ranks} ranks` : ""}`);
  const chosen = () => {
    const label = targetPick.value;
    if (label === "This machine (mpirun)") return null;   // local, the default
    return Object.entries(targets).find(([n, t]) => labelFor(n, t) === label)?.[0] || null;
  };

  async function refreshTargets() {
    if (!sidecar.isConnected()) return;
    try {
      const info = await sidecar.listCompute();
      targets = info.targets || {};
      const previous = targetPick.value;
      targetPick.textContent = "";
      targetPick.appendChild(new Option("This machine (mpirun)", "This machine (mpirun)"));
      Object.entries(targets).forEach(([name, t]) => {
        const label = labelFor(name, t);
        targetPick.appendChild(new Option(label, label));
      });
      if ([...targetPick.options].some((o) => o.value === previous)) targetPick.value = previous;
      if (!info.local?.mpirun) {
        compute.appendChild(el("p", "research-note is-error",
          "mpirun is not on this machine's PATH — local runs will fail. Install "
          + "an MPI (openmpi) or use a server."));
      }
    } catch (error) { /* sidecar not up; the card still explains itself */ }
  }
  // Keep the ranks box in step with the chosen server's own default.
  targetPick.addEventListener("change", () => {
    const name = chosen();
    if (name && targets[name]?.ranks) ranksInput.value = String(targets[name].ranks);
  });

  testBtn.addEventListener("click", () => {
    if (!sidecar.isConnected()) { say("Connect the sidecar first.", true); return; }
    const name = chosen();
    if (!name) {
      // Testing "local" still tells you whether mpirun and gales are present.
      sidecar.saveCompute({ name: "local", kind: "local" })
        .then(() => runJob(api, host, () => sidecar.testCompute("local")))
        .catch((e) => say(e.message, true));
      return;
    }
    runJob(api, host, () => sidecar.testCompute(name));
  });

  // The add-a-server form. Deliberately no password field: the sidecar refuses
  // one, and key-based access is what makes an unattended run possible.
  const form = el("div", "research-grid-2");
  form.hidden = true;
  const f = {};
  [["name", "Name (e.g. hetzner)"], ["host", "Host or IP"], ["user", "SSH user"],
    ["port", "Port (22)"], ["remote_root", "Remote folder (~/geoid_runs)"],
    ["ranks", "MPI ranks"], ["gales_dir", "GALES path on the server (~/gales)"],
    ["preamble", "Setup command (e.g. module load openmpi)"]]
    .forEach(([key, label]) => {
      f[key] = textInput(label);
      const wrap = el("label", "research-field");
      wrap.append(el("span", "research-field-label", label), f[key]);
      form.appendChild(wrap);
    });
  const saveBtn = el("button", "button", "Save server");
  saveBtn.type = "button";
  const dropBtn = el("button", "button secondary", "Remove selected");
  dropBtn.type = "button";
  const formRow = el("div", "gis-btn-row");
  formRow.append(saveBtn, dropBtn);
  const keyNote = el("p", "research-note",
    "Access is by SSH key only — run `ssh-copy-id user@host` once and this uses "
    + "your key. Passwords are refused: an unattended solve cannot answer a "
    + "prompt, and this service will not hold one.");
  compute.append(form, formRow, keyNote);
  formRow.hidden = true;
  addBtn.addEventListener("click", () => {
    form.hidden = !form.hidden;
    formRow.hidden = form.hidden;
  });

  saveBtn.addEventListener("click", async () => {
    if (!sidecar.isConnected()) { say("Connect the sidecar first.", true); return; }
    const name = f.name.value.trim();
    if (!name || !f.host.value.trim()) {
      say("A server needs at least a name and a host.", true); return;
    }
    try {
      await sidecar.saveCompute({
        name, kind: "ssh", host: f.host.value.trim(), user: f.user.value.trim(),
        port: Number(f.port.value) || 0, remote_root: f.remote_root.value.trim(),
        ranks: Number(f.ranks.value) || 4, gales_dir: f.gales_dir.value.trim(),
        preamble: f.preamble.value.trim(),
      });
      await refreshTargets();
      targetPick.value = labelFor(name, targets[name]);
      // Setting `.value` in code does not fire `change`, and the ranks box has
      // to follow: it drives the mesh partition as well as the solve, so a
      // stale 4 beside a 16-rank server would partition the mesh wrongly.
      targetPick.dispatchEvent(new Event("change"));
      say(`Saved "${name}". Press Test to check the key and the solver.`);
      form.hidden = true; formRow.hidden = true;
    } catch (error) { say(error.message, true); }
  });

  dropBtn.addEventListener("click", async () => {
    const name = chosen();
    if (!name) { say("Pick a saved server first.", true); return; }
    try {
      await sidecar.deleteCompute(name);
      await refreshTargets();
      say(`Removed "${name}".`);
    } catch (error) { say(error.message, true); }
  });

  host.insertBefore(compute, host.firstChild);
  void refreshTargets();

  // The Run and Prepare buttons above were bound before this card existed, so
  // they read the chosen target and ranks through these getters.
  api._galesTarget = chosen;
  api._galesRanks = () => Number(ranksInput.value) || 4;
}

/* ── Live data connectors on the Ingest pages ─────────────────────────────
 *
 * The ingest catalogue mirrors the desktop app, which only ever *links* to data
 * portals — so the tree draws "Open USGS" and "Import files", never a fetch.
 * But a few sources are open (no key, CORS-friendly), and this is the web, which
 * can fetch. This augments the tree-rendered ingest page with a "Live sources"
 * card: a real pull that files GeoJSON into data/pulled/ with full provenance
 * and offers it straight onto the globe. Kept here, not in the catalogue,
 * because it is a web-only capability the desktop app does not have.
 */
const INGEST_CONNECTORS = {
  "Ingest Seismic Geophysics": { slug: "seismic_geophysics", connectors: ["usgs-earthquakes"] },
  "Ingest Volcano Monitoring": { slug: "volcano_monitoring", connectors: ["eonet-volcanoes", "eonet-wildfires"] },
  "Ingest Weather Climate": { slug: "weather_climate", connectors: ["eonet-storms", "nws-alerts"] },
  "Ingest Hydrology": { slug: "hydrology", connectors: ["eonet-floods", "usgs-streamflow"] },
  "Ingest Coast Marine": { slug: "coast_marine", connectors: ["eonet-ice"] },
  "Ingest Admin Infrastructure": { slug: "admin_infrastructure", connectors: ["osm-places"] },
};

/**
 * GeoJSON features to a CSV the analysis pages can read.
 *
 * Every feature's properties become columns, with `lon`/`lat` from its geometry
 * so the table can still be placed. The union of keys is taken rather than the
 * first feature's, because a feed's records are not always uniform and a missing
 * key should be an empty cell, not a dropped column.
 */
export function featuresToCsv(features) {
  const rows = (features || []).filter((f) => f && f.properties);
  if (!rows.length) return "";
  const keys = [...new Set(rows.flatMap((f) => Object.keys(f.properties)))];
  const cell = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["lon", "lat", ...keys].join(",");
  const body = rows.map((f) => {
    let coords = f.geometry?.coordinates;
    // A polygon reduces to a placeable point, the same rule the watcher uses.
    while (Array.isArray(coords) && Array.isArray(coords[0])) coords = coords[0];
    const lon = Array.isArray(coords) ? coords[0] : "";
    const lat = Array.isArray(coords) ? coords[1] : "";
    return [cell(lon), cell(lat), ...keys.map((k) => cell(f.properties[k]))].join(",");
  });
  return [header, ...body].join("\n");
}

/** Fetch one connector, file it with provenance, return its project path. */
async function pullConnector(name, slug, say) {
  const label = CONNECTORS[name]?.label || name;
  say(`Fetching from ${label}…`);
  const bbox = studyBbox(store.getActive()?.meta?.study_area);
  let result;
  try {
    result = await runConnector(name, { bbox });
  } catch (error) {
    say(error.message, true);
    return null;
  }
  if (!result.geojson.features.length) {
    say(`${result.provider} returned nothing for this area or window.`);
    return null;
  }
  const path = `data/pulled/${slug}/${result.filename}`;
  await store.writeProjectFile(path, JSON.stringify(result.geojson));
  await store.registerData({
    name: result.filename, kind: "vector", path,
    source: `${result.provider} — live`,
    extra: { domain: slug, live: true, ...result.provenance },
  });

  // The same pull, as a table.
  //
  // The globe wants GeoJSON; every analysis page reads CSV through
  // `findTables`, which cannot see a .geojson at all — so a pull was a dead end
  // the moment you wanted to *study* what you had fetched, rather than look at
  // it. Writing both closes that: one file to draw, one to analyse, from a
  // single fetch and with the same provenance.
  const csvPath = `data/pulled/${slug}/${result.filename.replace(/\.geojson$/, "")}.csv`;
  const csv = featuresToCsv(result.geojson.features);
  if (csv) {
    await store.writeProjectFile(csvPath, csv);
    await store.registerData({
      name: csvPath.split("/").pop(), kind: "series", path: csvPath,
      source: `${result.provider} — live`,
      extra: { domain: slug, live: true, ...result.provenance, from: path },
    });
  }
  // Per-domain lineage, so provenance survives a registry rewrite.
  const log = await store.readJson(`data/pulled/${slug}/_lineage.json`, { pulls: [] });
  log.pulls = Array.isArray(log.pulls) ? log.pulls : [];
  log.pulls.push({ at: result.provenance.fetched_at, provider: result.provider,
    endpoint: result.provenance.endpoint, features: result.provenance.features });
  await store.writeJson(`data/pulled/${slug}/_lineage.json`, log);
  say(`Pulled ${result.geojson.features.length} feature(s) into ${path}.`);
  return path;
}

function ingestConnectors(host, api) {
  const config = INGEST_CONNECTORS[api.pageId];
  if (!config || !store.getActive()) return;
  const say = logger(api);

  const card = el("section", "research-card gis-live-sources");
  card.appendChild(el("h2", "research-card-title", "Live sources"));
  card.appendChild(el("p", "research-note",
    "Open data, fetched straight into the project with its provenance — no key, "
    + "no download. Uses the study area as the extent when one is set."));
  const row = el("div", "gis-btn-row");
  config.connectors.forEach((name) => {
    const connector = CONNECTORS[name];
    if (!connector) return;
    const button = el("button", "button", `Fetch ${connector.label}`);
    button.type = "button";
    let globeBtn = null;
    button.addEventListener("click", async () => {
      button.disabled = true;
      const path = await pullConnector(name, config.slug, say);
      button.disabled = false;
      if (path && !globeBtn) {
        globeBtn = el("button", "button secondary", "◉ Show on globe");
        globeBtn.type = "button";
        globeBtn.addEventListener("click", async () => {
          try { await bridge.sendToGlobe(path); }
          catch (error) { say(error.message, true); }
        });
        button.after(globeBtn);
      }
    });
    row.appendChild(button);
  });
  card.appendChild(row);
  // Above the catalogue's portal links — the thing that actually returns data
  // should read first.
  host.insertBefore(card, host.firstChild);
}

/* ── Figure Composer ──────────────────────────────────────────────────────
 *
 * The publish stage's headline page, and it did nothing: the tree drew Add
 * Figure, Compose & Preview and Export PNG, none of them wired, so all three
 * were live-looking buttons that fell through to a generic handler or silence.
 * Walking the workflow as a user is what found it — every earlier check only
 * asked whether the page *mounted*.
 *
 * What it does now is what the Qt page does: gather figures the project already
 * holds, lay them out in a grid at a chosen column count and DPI with a title
 * and caption, and export the composite back into the project as a figure in
 * its own right. Everything is drawn on one canvas, so the export is the
 * preview rather than a second rendering that could disagree with it.
 */
function figureComposer(host, api) {
  const say = logger(api);
  const val = (name) => api.controls.get(name)?.value;
  const picked = [];                     // {name, path, image}

  const panel = el("section", "research-card");
  panel.appendChild(el("h2", "research-card-title", "Figures in this composition"));
  const list = el("div", "research-list");
  const preview = el("div", "research-figure");
  panel.append(list, preview);
  // Into the splitter itself — the page's flexible content area.
  //
  // Two wrong homes were tried first, and each looked fine until measured.
  // Appended to the page it pushed past the fixed height and scrolled the
  // toolbar — the five buttons this page exists for — out of view. Dropped into
  // the splitter's `.qt-container` it landed in that pane's 220px column and
  // squeezed the preview to a thumbnail. The splitter is the box that absorbs
  // leftover space, so it is the one that can hold a figure.
  const slot = host.querySelector(".qt-splitter") || host;
  panel.style.flex = "1 1 auto";
  panel.style.minWidth = "0";
  slot.appendChild(panel);

  function draw() {
    list.textContent = "";
    if (!picked.length) {
      list.appendChild(el("p", "research-note",
        "Nothing added yet. “Add Figure” lists the PNGs in this project's "
        + "figures/ folder — anything a plot page has saved."));
      return;
    }
    picked.forEach((item, index) => {
      const row = el("div", "research-list-row");
      row.appendChild(el("span", "research-list-name", `${index + 1}. ${item.name}`));
      row.appendChild(el("span", "research-list-tag",
        `${item.image.naturalWidth}×${item.image.naturalHeight}`));
      list.appendChild(row);
    });
  }
  draw();

  /** The project's saved figures, offered inline rather than in a file dialog. */
  async function projectFigures() {
    try {
      return (await store.listProjectDir("figures"))
        .filter((e) => e.kind === "file" && /\.(png|jpe?g)$/i.test(e.name))
        .map((e) => e.name);
    } catch (error) { return []; }
  }

  async function loadFigure(name) {
    const blob = await store.readProjectFileBytes(`figures/${name}`);
    const url = URL.createObjectURL(blob instanceof Blob ? blob : new Blob([blob]));
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error(`${name} is not a readable image`));
      image.src = url;
    });
    return image;
  }

  bind(host, "Add Figure", async () => {
    if (!store.getActive()) { say("Open a project first."); return; }
    const names = await projectFigures();
    if (!names.length) {
      say("No figures in this project yet — save one from a plot page first "
        + "(CSV Plotter, Signal Processing, Post Processing).");
      return;
    }
    const choice = await chooseFrom(panel, names);
    if (!choice) return;
    try {
      picked.push({ name: choice, path: `figures/${choice}`, image: await loadFigure(choice) });
      draw();
      say(`${choice} added — ${picked.length} figure(s) in the composition.`);
    } catch (error) { say(error.message, true); }
  });

  bind(host, "Remove Selected", () => {
    if (!picked.length) { say("Nothing to remove."); return; }
    const gone = picked.pop();
    draw();
    say(`Removed ${gone.name}.`);
  });

  bind(host, "Clear All", () => {
    picked.length = 0;
    preview.textContent = "";
    draw();
    say("Composition cleared.");
  });

  /** Lay the figures out in a grid and return the canvas. */
  function compose() {
    const cols = Math.max(1, Number(val("_cols_spin")) || 2);
    // DPI scales the whole canvas, which is what makes an export publication
    // sized rather than screen sized.
    const scale = Math.max(1, (Number(val("_dpi_spin")) || 150) / 96);
    const title = (val("_title_edit") || "").trim();
    const caption = (val("_caption_edit") || "").trim();
    const rows = Math.ceil(picked.length / cols);
    const cellW = Math.max(...picked.map((p) => p.image.naturalWidth));
    const cellH = Math.max(...picked.map((p) => p.image.naturalHeight));
    const pad = 16;
    const titleH = title ? 34 : 0;
    const capH = caption ? 30 + 16 * Math.ceil(caption.length / 90) : 0;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round((cols * cellW + pad * (cols + 1)) * scale);
    canvas.height = Math.round((rows * cellH + pad * (rows + 1) + titleH + capH) * scale);
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    const w = canvas.width / scale;
    ctx.fillStyle = "#0d0221";
    ctx.fillRect(0, 0, w, canvas.height / scale);
    if (title) {
      ctx.fillStyle = "#fdf7ff";
      ctx.font = "600 20px 'Exo 2', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(title, w / 2, 25);
    }
    picked.forEach((item, i) => {
      const cx = pad + (i % cols) * (cellW + pad);
      const cy = titleH + pad + Math.floor(i / cols) * (cellH + pad);
      // Centred in its cell, never stretched: a figure with a different aspect
      // must not be distorted to fill a grid.
      ctx.drawImage(item.image,
        cx + (cellW - item.image.naturalWidth) / 2,
        cy + (cellH - item.image.naturalHeight) / 2);
    });
    if (caption) {
      ctx.fillStyle = "rgba(214,194,255,0.85)";
      ctx.font = "13px 'Exo 2', system-ui, sans-serif";
      ctx.textAlign = "left";
      const y0 = titleH + pad + rows * (cellH + pad);
      // Wrapped by measurement rather than a character count, so a long caption
      // does not run off the canvas.
      const words = caption.split(/\s+/);
      let line = "";
      let y = y0 + 8;
      words.forEach((word) => {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width > w - 2 * pad) {
          ctx.fillText(line, pad, y);
          y += 16;
          line = word;
        } else line = next;
      });
      if (line) ctx.fillText(line, pad, y);
    }
    return canvas;
  }

  bind(host, "Compose & Preview", () => {
    if (!picked.length) { say("Add at least one figure first.", true); return; }
    try {
      const canvas = compose();
      preview.textContent = "";
      canvas.style.maxWidth = "100%";
      canvas.style.height = "auto";
      preview.appendChild(canvas);
      say(`Composed ${picked.length} figure(s) at ${canvas.width}×${canvas.height}.`);
    } catch (error) { say(error.message, true); }
  });

  bind(host, "Export PNG", async () => {
    const canvas = preview.querySelector("canvas");
    if (!canvas) { say("Press Compose & Preview first.", true); return; }
    try {
      const name = `composition-${new Date().toISOString().slice(0, 19)
        .replace(/[:T]/g, "-")}.png`;
      const path = await saveFigure(canvas, name, "Figure Composer");
      say(`Exported to ${path}.`);
    } catch (error) { say(error.message, true); }
  });
}

export const RUNTIME = {
  "CSV Plotter": csvPlotter,
  "Figure Composer": figureComposer,
  "Map": mapComposer,
  "Live Monitor": liveMonitor,
  "Pipeline Editor": pipelineEditor,
  "Pipeline Runner": pipelineRunner,
  // These *augment* pages the tree already renders; both add nothing to their
  // base runtime, they only re-bind the run/stop buttons.
  "AI Trainer": aiTrainer,
  "Signal Processing": externalRunner,
  "Run Existing": galesRunner,
  "Ingest Seismic Geophysics": ingestConnectors,
  "Ingest Volcano Monitoring": ingestConnectors,
  "Ingest Weather Climate": ingestConnectors,
  "Ingest Hydrology": ingestConnectors,
  "Ingest Coast Marine": ingestConnectors,
  "Ingest Admin Infrastructure": ingestConnectors,
  "Settings": settingsSidecar,
};

export function install(pageId, host, api) {
  const fn = RUNTIME[pageId];
  if (!fn) return;
  try { fn(host, api); }
  catch (error) {
    console.error(`runtime for "${pageId}" failed`, error);
  }
}
