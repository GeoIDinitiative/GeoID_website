/**
 * Data tags: every input classified AS IT ARRIVES, and correctable forever.
 *
 * As layers multiply, "which of these six is my rainfall" stops being
 * answerable from names alone — the Model Builder and the Research Hub
 * pipeline both need inputs that say what they ARE. So every layer gets a
 * TYPE (basemap, vector, shapefile, raster, atmospheric, hydrology,
 * geology, hazard, Earth observation, study area) and an optional free-text
 * DESCRIPTION, and three rules decide how they are asked for:
 *
 *  1. **The machine guesses first, in real time.** File extension, source
 *     and name classify most inputs without a question being asked — a
 *     `.shp` is a shapefile, a GEE pull is filed by its own catalogue home,
 *     a drawn ring is a study area. `inferType` is pure and unit-tested.
 *  2. **Only the Add-data dialog ASKS.** Its Classification fieldset is
 *     the one prompt, shown where somebody is already choosing what to
 *     import. Everything else — a catalogue tick, a GEE pull, a live feed,
 *     a tiled geology layer — is classified silently. A card that appeared
 *     on arrival was tried and removed: it fired over prebuilt datasets
 *     the app itself defines (the Macrostrat world geology), which is
 *     exactly the data nobody should be asked to file.
 *  3. **A USER input's tag stays editable** in its drawer; a prebuilt
 *     dataset's is fixed. `isUserInput` is that gate and it is an explicit
 *     FLAG (`markUserInput`, set by the three doorways user data enters
 *     through) rather than a heuristic — see its note.
 *
 * Where it lives on the layer: `layer.dataType` / `layer.description`,
 * mirrored into `layer.metadata` (the provenance surface the registry and
 * the Metadata tab read) and — for layers that own their GeoJSON, like
 * drawn shapes — into the first feature's properties, so a saved project
 * brings the classification back with the file.
 */

/** The taxonomy, aligned with the nav bar's own subjects. */
export const DATA_TYPES = {
  "study-area": { label: "Study area", colour: "#ffd166" },
  vector: { label: "Vector", colour: "#8ef6ff" },
  shapefile: { label: "Shapefile", colour: "#6fd08c" },
  raster: { label: "Raster", colour: "#c26bff" },
  basemap: { label: "Basemap", colour: "#9aa7ff" },
  atmospheric: { label: "Atmospheric", colour: "#3f8cff" },
  hydrology: { label: "Hydrology", colour: "#52e4e8" },
  geology: { label: "Geology", colour: "#e0a05c" },
  hazard: { label: "Hazard", colour: "#ff5c4d" },
  observation: { label: "Earth observation", colour: "#2ee06a" },
  other: { label: "Other", colour: "#9aa0ab" },
};

/**
 * The guess, from a plain descriptor so it is testable without a DOM:
 * `{ ext, name, raster, drawnAt, geeHome }`. Order matters — what a thing
 * IS (a drawn extent, a basemap) outranks what its file was, and the name
 * heuristics come last because names lie more than extensions do.
 */
export function inferType(desc = {}) {
  const ext = String(desc.ext || "").toLowerCase();
  const name = String(desc.name || "");
  if (ext === "drawn" || desc.drawnAt) return "study-area";
  if (ext === "tiles") return "basemap";
  if (ext === "gee") {
    return {
      atmosphere: "atmospheric", hydrology: "hydrology", geology: "geology",
      geohazards: "hazard", basemap: "basemap",
    }[desc.geeHome] || "observation";
  }
  if (/^live satellites/i.test(name)) return "observation";
  if (name === "Live events") return "hazard";
  if (/fire|flood|susceptib|hazard|perimeter|landslide|quake|seism/i.test(name)) return "hazard";
  if (/geolog|fault|stress|volcan|macrostrat|bedrock|superficial|tectonic|plate/i.test(name)) return "geology";
  if (/river|lake|coast|streamflow|rainfall|precip|smap|soil moisture|water/i.test(name)) return "hydrology";
  if (/temperature|wind|weather|atmos|radar|lst|anomal/i.test(name)) return "atmospheric";
  if (["shp", "zip", "dbf"].includes(ext)) return "shapefile";
  if (["tif", "tiff", "png", "jpg"].includes(ext) || desc.raster) return "raster";
  if (["geojson", "json", "kml", "gpx", "wkt", "csv", "xyz"].includes(ext)) return "vector";
  return "other";
}

function descriptorOf(layer) {
  return {
    ext: layer?.ext,
    name: layer?.name,
    raster: Boolean(layer?.raster),
    drawnAt: layer?.collection?.features?.[0]?.properties?.drawn_at,
    geeHome: layer?.ext === "gee"
      ? window.GeoIDGeeCatalogue?.homeOfLayerName?.(layer.name) : undefined,
  };
}

/** The layer's type: the user's word if given, the machine's guess if not. */
export function typeOf(layer) {
  const chosen = layer?.dataType;
  if (chosen && DATA_TYPES[chosen]) return chosen;
  // A saved shape carries its tag in its own properties — a project
  // reopened elsewhere restores the classification with the file.
  const stored = layer?.collection?.features?.[0]?.properties?.data_type;
  if (stored && DATA_TYPES[stored]) return stored;
  return inferType(descriptorOf(layer));
}

export function descriptionOf(layer) {
  return layer?.description
    || layer?.collection?.features?.[0]?.properties?.data_note || "";
}

/** Write the tag everywhere downstream reads: layer, metadata, GeoJSON. */
export function applyTag(layer, { type, description } = {}) {
  if (!layer) return;
  if (type && DATA_TYPES[type]) layer.dataType = type;
  if (description !== undefined) layer.description = String(description || "");
  const finalType = typeOf(layer);
  layer.metadata = {
    ...(layer.metadata || {}),
    dataType: DATA_TYPES[finalType].label,
    ...(descriptionOf(layer) ? { description: descriptionOf(layer) } : {}),
  };
  const props = layer.collection?.features?.[0]?.properties;
  if (props) {
    props.data_type = finalType;
    if (descriptionOf(layer)) props.data_note = descriptionOf(layer);
  }
  document.dispatchEvent(new CustomEvent("geoid-gis:layers-changed", { detail: { reason: "tag" } }));
  // The hierarchy bakes the chip into its row template, and it does not
  // listen for the event above — redraw it so the new tag shows at once.
  window.GeoIDLayerHierarchy?.render?.();
}

/** The chip, as markup for a row template. Title carries the note. */
export function chipHtml(layer) {
  const type = typeOf(layer);
  const { label, colour } = DATA_TYPES[type];
  const note = descriptionOf(layer);
  return `<span class="data-tag-chip" data-type="${type}" title="${
    (note || label).replace(/"/g, "&quot;")}" style="--tag: ${colour}">${label}</span>`;
}

/** The same select everywhere a tag can be chosen. */
export function typeSelect(layer) {
  const select = document.createElement("select");
  select.className = "input data-tag-select";
  Object.entries(DATA_TYPES).forEach(([id, t]) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = t.label;
    select.appendChild(option);
  });
  select.value = typeOf(layer);
  return select;
}

/* ── Chip styling ────────────────────────────────────────────────────── */

const STYLE = `
.data-tag-chip {
  display: inline-block; margin: 0 0.3rem; padding: 0.05rem 0.4rem;
  border: 1px solid var(--tag); border-radius: 999px;
  color: var(--tag); font: 600 0.52rem/1.5 "Exo 2", sans-serif;
  letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap;
  flex: 0 0 auto;
}
.data-tag-card {
  border: 1px solid rgba(var(--nav-accent-rgb), 0.45); border-radius: 8px;
  padding: 0.45rem 0.55rem; margin: 0.3rem 0;
  display: flex; flex-direction: column; gap: 0.35rem;
  background: rgba(255, 255, 255, 0.04);
}
.data-tag-card .data-tag-head {
  display: flex; align-items: center; gap: 0.3rem;
  font: 600 0.62rem/1.3 "Exo 2", sans-serif; letter-spacing: 0.06em;
}
.data-tag-card .data-tag-head .data-tag-name {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
}
.data-tag-card .data-tag-row { display: flex; gap: 0.35rem; align-items: center; }
.data-tag-card .data-tag-row .data-tag-select { flex: 0 0 9rem; }
.data-tag-card .data-tag-row input { flex: 1; min-width: 0; }
.data-tag-dismiss {
  background: none; border: none; cursor: pointer; color: inherit;
  opacity: 0.6; margin-left: auto; padding: 0 0.2rem; font-size: 0.8rem;
}
.data-tag-dismiss:hover { opacity: 1; }
`;

let styleInjected = false;
function injectStyle() {
  if (styleInjected || typeof document === "undefined") return;
  styleInjected = true;
  const tag = document.createElement("style");
  tag.dataset.geoidDataTags = "";
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

/**
 * Is this the USER'S own input? An explicit flag, set where user data
 * actually enters — the Add-data dialog, a drawn capture, the Points tool
 * — and nowhere else.
 *
 * It was a heuristic first (not a catalogue layer, not GEE, not a tile
 * drape, not named "Live …"), and heuristics fail open: the Macrostrat
 * world geology arrives through `addDerivedLayer` from the Geology panel,
 * is in no catalogue registry, and so was taken for an upload — it raised
 * the classification prompt over a dataset the app itself defines. A flag
 * cannot make that mistake: anything the app loads is prebuilt unless the
 * doorway that created it says otherwise.
 */
export function isUserInput(layer) {
  return layer?.userInput === true;
}

/** Stamp a layer as the user's own; the doorways call this. */
export function markUserInput(layer) {
  if (layer) layer.userInput = true;
}

const seen = new Set();

/**
 * The Add-data dialog asks for type and note UP FRONT now, so an import it
 * ran must not also raise the arrival card — the same question twice in two
 * boxes. The dialog claims the next arrival before importing.
 */
/**
 * Kept as a no-op: the arrival card is gone, so there is nothing to
 * suppress, and add-data still calls this. Removing the export would be a
 * second edit for no behaviour.
 */
export function suppressNextArrival() {}

function watchArrivals() {
  const manager = window.GeoIDImportManager;
  if (!manager?.onChange) { setTimeout(watchArrivals, 800); return; }
  /**
   * The baseline is taken AT SUBSCRIBE TIME, not on the first change event —
   * what is already loaded was not just added, so it gets no card (the Atlas
   * watcher's first-pass rule). Primed-on-first-event was tried and the very
   * first user capture WAS the first event, silently priming instead of
   * asking.
   */
  (manager.getLayers?.() || []).forEach((layer) => seen.add(layer.id));
  manager.onChange(() => {
    (manager.getLayers?.() || []).forEach((layer) => {
      if (seen.has(layer.id) || layer.status !== "loaded") return;
      seen.add(layer.id);
      // Tag every arrival in real time, silently. Nothing is ASKED here:
      // the only prompt is the Add-data dialog's own Classification
      // fieldset, where somebody is already choosing what to import.
      applyTag(layer, {});
    });
  });
}

if (typeof document !== "undefined") {
  injectStyle();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watchArrivals);
  } else {
    watchArrivals();
  }
}
