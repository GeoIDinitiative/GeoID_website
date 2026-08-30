import {
  addDataset, grouped, datasetById, layerForDataset,
} from "./global-data.js?v=20260830-c879e4f";
import { renderCatalogue, openSymbologyFor } from "./catalogue-list.js?v=20260830-c879e4f";

/**
 * Polygons: the register of vector overlays -- coastlines, boundaries, basins,
 * anything that draws an outline over the globe rather than covering it.
 *
 * It is a view of the layer stack, not a second copy of it. An overlay added
 * here is an ordinary imported layer: it appears in the layer box, takes part
 * in extraction and export, and carries its own opacity and draw order. What
 * this tab adds is a place to keep them together and switch them on and off
 * without unloading them, which the layer box cannot express -- there, removing
 * is the only way to get something out of the way for good.
 */

const ACCEPT = ".shp,.dbf,.shx,.prj,.cpg,.zip,.geojson,.json,.kml,.gpx,.wkt";

function byId(id) {
  return document.getElementById(id);
}

/**
 * The import CARDS are gone — the Layer visibility hierarchy is nested in
 * this same tab now (toolbox.js dockLayers), and its rows carry strictly
 * more than the cards did (eye, opacity, reorder, and a drawer with
 * symbology, rename, remove and To Model). A card here beside a row there
 * was two controls for one layer — and the card's "1 polygon" count text
 * was reported as noise besides. The host div stays: the capture-drawn
 * error note still prepends into it.
 */
function render() {
  const host = byId("polygon-list");
  if (!host) return;
  host.textContent = "";
}

function say(message) {
  const node = byId("polygon-status");
  if (node) node.textContent = message;
}

/**
 * The catalogue as tick boxes: several datasets at once, on and off.
 *
 * It was a dropdown, which says "choose one" — and choosing one was most of
 * what it could do: no sight of what was already on, and no way to take one
 * off again without going to the layer box. Coastlines under rivers under
 * borders is the ordinary case, so the ordinary control is a list of toggles.
 */
function drawCatalogue() {
  const host = byId("polygon-catalogue");
  if (!host) return;
  /**
   * Only the datasets with NO home of their own.
   *
   * The tectonics layers are under Geology, the water bodies under Hydrology
   * and the volcanoes under Geology · Volcanoes, because filing a plate
   * boundary next to a coastline is a statement about its file format rather
   * than about what it is. What is left here is the shapes that really are
   * just shapes — the graticule, the borders, the country polygons — beside
   * whatever somebody imports, which is what this tab is for.
   *
   * Drawn there and NOT also here: two lists for one dataset is how a tick in
   * one place fails to explain the tick already showing in the other.
   */
  const entries = grouped()
    .flatMap(({ group, entries: list }) => list
      .filter((entry) => !entry.home)
      .map((entry) => ({
        id: entry.id,
        group,
        label: entry.label,
        title: `${entry.summary} — ${entry.licence}`,
        info: { summary: entry.summary, citation: entry.licence },
        // Carried, not dropped: the row's label-detail slider captions itself
        // from the DATASET's own words, and a projection that leaves this
        // behind silently falls back to generic wording — which is how the
        // submarine cables came to be captioned "Erupted since 1500".
        detailCopy: entry.detailCopy,
      })));
  renderCatalogue(host, entries, {
    // A lid over the list: nine datasets with their group headings filled the
    // panel, and the layers already on the globe — the part you work with —
    // were pushed off the bottom of it.
    title: "Overlays",
    // The catalogue owns this lookup: it knows a dataset is loaded under the
    // tidied name once the rename lands, and under the file name before it.
    layerFor: layerForDataset,
    add: (id) => addDataset(id, say),
    remove: (id) => {
      const layer = layerForDataset(id);
      if (!layer) return;
      window.GeoIDImportManager?.removeLayer?.(layer.id);
      say(`${datasetById(id)?.label || "Dataset"} taken off the globe.`);
    },
    symbology: (layer) => {
      if (!openSymbologyFor(layer)) say("This layer cannot be recoloured.");
    },
  });
  appendContourRows(host);
}

/**
 * The contour overlay, as catalogue rows.
 *
 * The three loose "Contour overlay / opacity / color" rows sat between the
 * two catalogues as furniture nobody filed; an elevation contour is an
 * OVERLAY, so it lists with the overlays, one row per interval, radio-like
 * (the viewer draws one interval at a time). The REAL controls stay in the
 * page hidden (`#contour-controls`) because earth-viewer reads them by id
 * unguarded — these rows are a face on them, exactly as the base-texture
 * list is a face on `#base-layer-select`. The Symbology… button unfolds a
 * shared line of colour + opacity proxies rather than the full dialog: a
 * contour is not a data layer with columns to classify.
 *
 * Rebuilt with the catalogue: `renderCatalogue` wipes the box on every
 * layer change, so this appends after every draw, reading its ticked state
 * from the hidden select each time — the select is the state, never the DOM.
 */
function appendContourRows(host) {
  const interval = document.getElementById("contour-interval-select");
  const colourSrc = document.getElementById("contour-color-select");
  const opacitySrc = document.getElementById("contour-opacity");
  const scroll = host.querySelector(".gis-catalogue-scroll");
  if (!interval || !colourSrc || !opacitySrc || !scroll) return;
  if (scroll.querySelector("[data-contour-row]")) return;

  const group = document.createElement("div");
  group.className = "gis-catalogue-group";
  group.dataset.contourRow = "1";
  group.textContent = "Terrain";
  scroll.appendChild(group);

  // One shared symbology line, unfolded under whichever row asked.
  const symRow = document.createElement("div");
  symRow.dataset.contourRow = "1";
  symRow.style.cssText = "display:none;gap:0.4rem;align-items:center;"
    + "padding:0.2rem 0.5rem 0.35rem;";
  const colour = document.createElement("select");
  colour.className = "input";
  colour.style.cssText = "flex:0 0 7rem;";
  [...colourSrc.options].forEach((o) => colour.appendChild(o.cloneNode(true)));
  colour.value = colourSrc.value;
  colour.addEventListener("change", () => {
    colourSrc.value = colour.value;
    colourSrc.dispatchEvent(new Event("change"));
  });
  const opacity = document.createElement("input");
  opacity.type = "range";
  opacity.className = "slider";
  opacity.min = "0"; opacity.max = "1"; opacity.step = "0.01";
  opacity.value = opacitySrc.value;
  opacity.style.flex = "1";
  opacity.title = "Contour opacity";
  opacity.addEventListener("input", () => {
    opacitySrc.value = opacity.value;
    opacitySrc.dispatchEvent(new Event("input"));
    opacitySrc.dispatchEvent(new Event("change"));
  });
  symRow.append(colour, opacity);

  const ticks = [];
  [...interval.options].filter((o) => o.value).forEach((option) => {
    const row = document.createElement("div");
    row.className = "gis-catalogue-row";
    row.dataset.contourRow = "1";
    const tick = document.createElement("input");
    tick.type = "checkbox";
    tick.checked = interval.value === option.value;
    tick.addEventListener("change", () => {
      // Radio-like: the viewer draws one interval at a time, so ticking one
      // stands the others down, and unticking the active one means "None".
      ticks.forEach((other) => { if (other !== tick) other.checked = false; });
      interval.value = tick.checked ? option.value : "";
      interval.dispatchEvent(new Event("change"));
    });
    ticks.push(tick);
    const name = document.createElement("span");
    name.textContent = `Elevation contours — ${option.textContent}`;
    name.style.cssText = "flex:1;min-width:0;";
    const sym = document.createElement("button");
    sym.type = "button";
    sym.className = "gis-catalogue-sym";
    sym.textContent = "Symbology…";
    sym.title = "Contour colour and opacity";
    sym.addEventListener("click", () => {
      const open = symRow.style.display !== "none" && symRow.previousElementSibling === row;
      row.after(symRow);
      symRow.style.display = open ? "none" : "flex";
    });
    row.append(tick, name, sym);
    scroll.appendChild(row);
  });
  scroll.appendChild(symRow);
}

function init() {
  const input = byId("polygon-file");
  const browse = byId("polygon-browse");
  if (input) input.setAttribute("accept", ACCEPT);

  drawCatalogue();

  browse?.addEventListener("click", () => input?.click());
  input?.addEventListener("change", async () => {
    if (!input.files?.length) return;
    // The same importer the Add / Import Data tab uses, so a shapefile's
    // sidecars, its projection and its attributes are all handled once.
    await window.GeoIDImportManager?.importFileList?.(input.files);
    input.value = "";
  });

    window.GeoIDImportManager?.onChange?.(() => {
    render();
    // Whoever took it off — this list, the layer box, a tab — the tick follows.
    drawCatalogue();
  });
  render();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
