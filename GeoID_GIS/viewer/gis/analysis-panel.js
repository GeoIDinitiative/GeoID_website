import {
  extractPolygonSamples,
  rowsToCsv,
  rowsToGeoJson,
  downloadText,
} from "./extraction.js?v=20260816-63ad70a";
import { rectangleVertices } from "./draw-area.js?v=20260816-63ad70a";

let lastResult = null;

/**
 * The preset box: a size rather than a shape.
 *
 * It hands the polygon to the viewer's own Draw tool rather than keeping a
 * second geometry of its own, so from here on a box and a hand-drawn area are
 * the same thing — same overlay, same area readout, same extraction. A second
 * geometry would have to be taught every one of those separately, and would
 * disagree with the drawn one the first time either changed.
 */
function drawBox() {
  const viewer = window.GeoIDViewer;
  const say = (message) => {
    const node = document.getElementById("gis-box-status");
    if (node) node.textContent = message;
  };
  if (!viewer?.setStudyAreaPolygon) {
    say("Viewer is not ready yet.");
    return;
  }
  const mode = document.getElementById("gis-box-centre")?.value || "view";
  let centre = null;
  if (mode === "manual") {
    const lat = Number(document.getElementById("gis-box-lat")?.value);
    const lon = Number(document.getElementById("gis-box-lon")?.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)
      || document.getElementById("gis-box-lat")?.value === ""
      || document.getElementById("gis-box-lon")?.value === "") {
      say("Enter a latitude and a longitude, or centre the box on the view.");
      return;
    }
    centre = { lat, lon };
  } else {
    centre = viewer.getViewCentreLatLon?.() || null;
    if (!centre) {
      // The middle of the screen is off the globe. Asking is the honest answer;
      // guessing a centre would put the box somewhere never looked at.
      say("The middle of the view is not on the globe — turn to it, or enter coordinates.");
      return;
    }
  }

  // A square is one number, which is what most study areas actually are.
  const square = document.getElementById("gis-box-shape")?.value !== "rectangle";
  const widthKm = Number(document.getElementById("gis-box-width")?.value);
  const box = rectangleVertices({
    lat: centre.lat,
    lon: centre.lon,
    widthKm,
    heightKm: square ? widthKm : Number(document.getElementById("gis-box-height")?.value),
    // Sized on whichever world this is. Without it a 200 km box on Mars came
    // out 106 km across, because a degree there is 59 km and not 111.
    radiusKm: viewer.bodyRadiusKm || undefined,
  });
  if (!box) {
    say("Give the box a width and a height in kilometres.");
    return;
  }
  // The shape joins the layer list as well as becoming the study area. An
  // area is both a place you are working and a polygon you can operate on,
  // and the user should not have to capture it twice.
  const alsoALayer = () => {
    const out = window.GeoIDDrawnLayers?.captureDrawn?.();
    if (out?.ok) setStatus(`${out.message}`);
  };
  if (!viewer.setStudyAreaPolygon(box.vertices)) {
    say("The viewer would not take that box.");
    return;
  }
  alsoALayer();
  const east = ((centre.lon % 360) + 360) % 360;
  say(`${box.areaHintKm2.toLocaleString()} km² box at `
    + `${centre.lat.toFixed(3)}°, ${east.toFixed(3)}°E. Run the extraction below.`);
}

function setStatus(message) {
  const node = document.getElementById("gis-extract-status");
  if (node) {
    node.textContent = message;
  }
}

function setExportsEnabled(enabled) {
  ["gis-extract-csv", "gis-extract-geojson"].forEach((id) => {
    const button = document.getElementById(id);
    if (button) {
      button.disabled = !enabled;
    }
  });
}

/** Layers the user ticked in the source list. */
function selectedLayers() {
  const checked = new Set(
    [...document.querySelectorAll("#gis-extract-sources input[type=checkbox]:checked")]
      .map((input) => input.value),
  );
  return (window.GeoIDImportManager?.getLayers() || [])
    .filter((layer) => layer.sampler && checked.has(String(layer.id)));
}

function builtInChecked(id) {
  const node = document.getElementById(id);
  return node ? node.checked : false;
}

/**
 * Rebuilds the source checkbox list from the sampleable imported layers, so the
 * panel always reflects what is currently loaded.
 */
function renderSources() {
  const host = document.getElementById("gis-extract-sources");
  if (!host) {
    return;
  }
  const previous = new Map(
    [...host.querySelectorAll("input[type=checkbox]")].map((input) => [input.value, input.checked]),
  );
  host.innerHTML = "";
  const layers = window.GeoIDImportManager?.getSampleableLayers?.() || [];
  if (!layers.length) {
    const note = document.createElement("p");
    note.className = "tool-copy import-empty-note";
    note.textContent = "No sampleable imported layers. Import a GeoTIFF or shapefile to add sources.";
    host.appendChild(note);
    return;
  }
  layers.forEach((layer) => {
    const id = `gis-extract-src-${layer.id}`;
    const row = document.createElement("label");
    row.className = "gis-extract-source";
    row.htmlFor = id;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = id;
    input.value = String(layer.id);
    input.checked = previous.has(String(layer.id)) ? previous.get(String(layer.id)) : true;
    const text = document.createElement("span");
    // What the column will actually hold, said plainly. A GEE drape's value is
    // read back out of the rendered palette, which is a few percent off the
    // source band — the list says so rather than letting a column of
    // millimetres imply it came from the archive.
    const info = layer.info || {};
    let kind = "values";
    if (info.valueKind === "attributes") kind = "attributes";
    else if (info.valueKind === "colour") kind = "colour only";
    else if (info.recoveredFromPalette) kind = `${info.unit || "values"}, read from the palette`;
    text.textContent = `${layer.name} (${kind})`;
    row.appendChild(input);
    row.appendChild(text);
    host.appendChild(row);
  });
}

function runExtraction() {
  const viewer = window.GeoIDViewer;
  if (!viewer?.getExtractionGeometry) {
    setStatus("Viewer is not ready yet.");
    return;
  }
  // Whatever the Draw tool currently holds -- clicked out, or a preset box --
  // or a buffer. There is deliberately no second polygon workflow here.
  const geometry = viewer.getExtractionGeometry("study") || viewer.getExtractionGeometry("buffer");
  if (!geometry) {
    setStatus("Mark out an area first — the Draw tool, or the box above.");
    setExportsEnabled(false);
    return;
  }

  const stepKm = Number(document.getElementById("gis-extract-step")?.value) || 1;
  setStatus("Sampling...");
  setExportsEnabled(false);

  // Yield once so the status paints before a potentially long synchronous pass.
  window.requestAnimationFrame(() => {
    const result = extractPolygonSamples({
      vertices: geometry.vertices,
      center: geometry.center,
      stepKm,
      includeBuiltIn: builtInChecked("gis-extract-builtin"),
      includeGeology: builtInChecked("gis-extract-geology"),
      includeClimate: builtInChecked("gis-extract-climate"),
      layers: selectedLayers(),
    });
    lastResult = result.ok ? result : null;
    const area = result.areaKm2
      ? ` over ${result.areaKm2.toLocaleString(undefined, { maximumFractionDigits: 1 })} km2`
      : "";
    setStatus(result.ok ? `${result.message}${area}.` : result.message);
    setExportsEnabled(result.ok);
  });
}

function exportAs(kind) {
  if (!lastResult?.rows?.length) {
    return;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  if (kind === "csv") {
    downloadText(`geoid_extract_${stamp}.csv`, rowsToCsv(lastResult.rows), "text/csv");
  } else {
    downloadText(`geoid_extract_${stamp}.geojson`, rowsToGeoJson(lastResult.rows), "application/geo+json");
  }
}

/**
 * A small card, beside the rail button, holding the Draw tool's own settings.
 *
 * The controls are MOVED rather than cloned, and that is not a detail: they are
 * already wired by id, and a clone would put a second #gis-box-draw on the page
 * — the exact duplicate-id fault that once had the extraction dialog's Run
 * button silently driving the panel's. A comment node marks where they came
 * from so putting the tool down returns them to the panel, which therefore
 * stays complete for anyone who goes looking there instead.
 */
function drawOptionsCard() {
  let card = null;
  let home = null;
  let section = null;

  const place = () => {
    const anchor = document.getElementById("tool-rail-area");
    if (!anchor || !card) return;
    const r = anchor.getBoundingClientRect();
    card.style.top = Math.round(r.top) + "px";
    card.style.right = Math.round(window.innerWidth - r.left + 10) + "px";
  };

  const close = () => {
    if (!card || card.hidden) return;
    if (section && home && home.parentNode) home.parentNode.insertBefore(section, home);
    card.hidden = true;
    window.removeEventListener("resize", place);
  };

  const build = () => {
    card = document.createElement("div");
    card.id = "gis-draw-options";
    card.hidden = true;
    // Above the legend and the hover tooltip, below every popup and modal —
    // the stacking order in CLAUDE.md, which is numeric because all of these
    // are siblings under body.
    Object.assign(card.style, {
      position: "fixed", zIndex: "15", width: "17rem", maxWidth: "calc(100vw - 2rem)",
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
    title.textContent = "Draw options";
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
    shut.addEventListener("click", close);
    head.append(title, shut);

    const body = document.createElement("div");
    body.className = "gis-draw-options-body";
    body.style.padding = "0.5rem 0.6rem 0.6rem";

    card.append(head, body);
    document.body.appendChild(card);
    return body;
  };

  const open = () => {
    section = section || document.getElementById("gis-box-draw")?.closest("details");
    if (!section) return;
    const body = card ? card.querySelector(".gis-draw-options-body") : build();
    if (!home) {
      home = document.createComment("draw options live with the tool while it is up");
      section.parentNode?.insertBefore(home, section);
    }
    body.appendChild(section);
    section.open = true;
    card.hidden = false;
    place();
    window.addEventListener("resize", place);
  };

  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  return { open, close };
}

function init() {
  document.getElementById("gis-box-draw")?.addEventListener("click", drawBox);

  const shape = document.getElementById("gis-box-shape");
  const heightRow = document.getElementById("gis-box-height-row");
  const widthLabel = document.getElementById("gis-box-width-label");
  const syncShape = () => {
    const square = shape?.value !== "rectangle";
    if (heightRow) heightRow.hidden = square;
    if (widthLabel) widthLabel.textContent = square ? "Side (km)" : "Width (km)";
  };
  shape?.addEventListener("change", syncShape);
  syncShape();

  /**
   * Picking up the Draw tool shows the Draw tool's options — and nothing else.
   *
   * Raising the whole Analyse workbench was the old answer to a real problem:
   * the box presets sat two collapsed <details> deep, so from the rail there
   * was no sign they existed ("no square preset option"). That answer stopped
   * being proportionate the moment the workbench grew to forty-six tools —
   * picking up a pencil should not open the toolbox, and it reads as a bug
   * because it behaves like one.
   *
   * Deferred a tick because the viewer toggles the mode on the same click, and
   * only opened when the tool ends up ON — otherwise putting it down would
   * open the card too.
   */
  const drawOptions = drawOptionsCard();
  document.getElementById("tool-rail-area")?.addEventListener("click", () => {
    setTimeout(() => {
      const on = document.getElementById("tool-rail-area")?.classList.contains("is-active");
      if (on) drawOptions.open(); else drawOptions.close();
    }, 80);
  });
  const centreMode = document.getElementById("gis-box-centre");
  const manualRow = document.getElementById("gis-box-manual");
  const syncCentreMode = () => {
    if (manualRow) manualRow.hidden = centreMode?.value !== "manual";
  };
  centreMode?.addEventListener("change", syncCentreMode);
  syncCentreMode();

  document.getElementById("gis-extract-run")?.addEventListener("click", runExtraction);
  document.getElementById("gis-extract-csv")?.addEventListener("click", () => exportAs("csv"));
  document.getElementById("gis-extract-geojson")?.addEventListener("click", () => exportAs("geojson"));
  setExportsEnabled(false);
  renderSources();
  window.GeoIDImportManager?.onChange?.(renderSources);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

window.GeoIDAnalysis = {
  runExtraction,
  getLastResult: () => lastResult,
  renderSources,
};
