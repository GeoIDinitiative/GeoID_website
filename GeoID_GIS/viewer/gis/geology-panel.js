/**
 * The Geology tab, as a geology tab rather than a pair of checkboxes.
 *
 * What it replaced: two toggles labelled "NI bedrock geology" and "NI
 * superficial geology" that loaded a file each. Everything a geological map is
 * actually for was missing — you could not choose what to colour by, see what
 * the attributes were, read a legend, or ask a polygon what it was. The BGS
 * bedrock sheet carries **fifty-seven** columns and the toggle picked none of
 * them, so the map arrived in one flat colour.
 *
 * So: a catalogue you choose from, opacity per layer, and a symbology dialog
 * that shows the attribute table's head and lets you colour by any column.
 *
 * Three things it deliberately does NOT reimplement, because they already work
 * for every vector layer and a second copy would drift:
 *
 * - **Click a polygon and it tells you what it is.** `feature-popup.js` already
 *   does this, and its `PREFERRED` field order was already tuned for BGS data —
 *   it leads with `lex_d`, `rcs_d`, `bgstype` and the age columns. This is the
 *   same pattern the Mars and Moon viewers use for their geology, arrived at
 *   from the other end: they carry a features JSON beside a raster, and here the
 *   vector layer IS the features.
 * - **The legend.** `categoricalSymbology` writes `legendInfo` and the layer
 *   card draws one row per class with its name and colour. Colouring by a column
 *   is what makes the legend, rather than something to be kept in step with it.
 * - **Opacity, visibility, order and removal.** A geology layer is an ordinary
 *   layer, so the layer list already owns those; the slider here is a shortcut
 *   to the one the list has, not a second source of truth.
 */

import { attributeHead, rankColourFields } from "./delimited.js?v=20260820-3c6add6";
import { RAMPS, RAMP_NAMES, QUALITATIVE, QUALITATIVE_RAMP } from "./symbology.js?v=20260820-3c6add6";
import { currentBodyId } from "./bodies.js?v=20260820-3c6add6";
import { sphericalPolygonAreaKm2 } from "./geo-utils.js?v=20260820-3c6add6";

/* ── The catalogue ───────────────────────────────────────────────────────────
 *
 * A record per dataset rather than a checkbox per dataset: adding the BGS
 * 1:50k sheets, or another country's survey, is a row here and nothing else.
 * `colourBy` is the column that makes the map read as a geological map — the
 * ranking in `delimited.js` would find something reasonable, but the lithology
 * column is a fact about BGS data and worth stating.
 */
const CATALOGUE = [
  {
    id: "ni-bedrock",
    // Which WORLD this belongs to. The panel loads from boot.js on all ten, so
    // without it Northern Ireland's bedrock was offered on Mars and drawn on
    // it -- a BGS sheet pinned to Martian coordinates, in full colour.
    body: "earth",
    scope: "regional",
    region: "Northern Ireland",
    label: "Northern Ireland — bedrock",
    path: "/ni-prototype/data/ni_bedrock.geojson",
    name: "NI bedrock geology (BGS 625k).geojson",
    colourBy: "lex_d",
    credit: "BGS 1:625 000 bedrock geology, © UKRI.",
    // Loaded on open: the tab should show a geological map rather than an empty
    // dropdown, and until the global base exists this IS the map we have.
    default: true,
  },
  {
    id: "ni-faults",
    body: "earth",
    scope: "regional",
    region: "Northern Ireland",
    label: "Northern Ireland — faults",
    path: "/ni-prototype/data/ni_faults.geojson",
    name: "NI bedrock faults (BGS 625k).geojson",
    // The only column that distinguishes one line from another: 279 faults at
    // rockhead and 2 thrusts. Every fault in this sheet is unnamed
    // (`fltname_d` is blank on all 281), so colouring by name would paint one
    // class and call it a legend.
    colourBy: "feature_d",
    credit: "BGS 1:625 000 bedrock faults, © UKRI.",
    // Not loaded on open: the two sheets are the map, and faults are an overlay
    // you ask for on top of it.
    default: false,
  },
  {
    id: "ni-superficial",
    body: "earth",
    scope: "regional",
    region: "Northern Ireland",
    label: "Northern Ireland — superficial",
    path: "/ni-prototype/data/ni_superficial.geojson",
    name: "NI superficial geology (BGS 625k).geojson",
    colourBy: "lex_d",
    credit: "BGS 1:625 000 superficial deposits, © UKRI.",
    default: true,
  },
];

/**
 * The global base, when there is one.
 *
 * The shape this tab is built for: a merged world geology underneath, and
 * regional surveys added from the dropdown on top of it — a national sheet is
 * better than the global compilation over the same ground, and the two should
 * be stackable rather than alternatives. Nothing fills this yet, so the panel
 * says what is missing instead of pretending the regional sheets are global
 * coverage. Adding it is a record here, not a rewrite: it takes the same fields
 * as a regional entry and `scope: "global"`.
 */
const GLOBAL_BASE = null;

/** This world's datasets. A body with none gets a panel that says so. */
const forThisBody = () => CATALOGUE.filter((d) => (d.body || "earth") === currentBodyId());
const regional = () => forThisBody().filter((d) => d.scope === "regional");

const entryById = (id) => CATALOGUE.find((d) => d.id === id) || null;

/* ── Style ───────────────────────────────────────────────────────────────── */

const STYLE = `
/* NEVER a backtick in this block -- it is a template literal and one ends it.
   module-css.test.mjs catches that; a browser does not. */
#gis-geology-panel { display: flex; flex-direction: column; gap: 0.4rem; }
#gis-geology-panel .row { margin: 0; }
#gis-geology-loaded {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin-top: 0.2rem;
}
.gis-geo-layer {
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 0.35rem;
  padding: 0.35rem 0.4rem;
}
.gis-geo-layer-head {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.gis-geo-layer-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 500 0.66rem/1.3 'Exo 2', sans-serif;
}
.gis-geo-layer-by {
  font: 400 0.58rem/1.3 'Exo 2', sans-serif;
  opacity: 0.7;
}
.gis-geo-opacity { width: 100%; }
#gis-geology-status {
  font: 400 0.62rem/1.35 'Exo 2', sans-serif;
  opacity: 0.8;
}
#gis-geology-status:empty { display: none; }
.gis-geo-base {
  font: 400 0.6rem/1.35 'Exo 2', sans-serif;
  opacity: 0.7;
  padding: 0.25rem 0.35rem;
  border-left: 2px solid rgba(var(--nav-accent-rgb), 0.5);
}

/* The symbology dialog: the attribute head, and the column that paints it. */
#gis-geo-sym-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: rgba(4, 3, 10, 0.72);
}
#gis-geo-sym-backdrop[hidden] { display: none !important; }
#gis-geo-sym {
  width: min(46rem, 100%);
  max-height: calc(100vh - 3rem);
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  overflow: hidden;
  background: rgba(12, 10, 22, 0.98);
  border: 1px solid rgba(var(--nav-accent-rgb), 0.45);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.6);
}
#gis-geo-sym .sym-head,
#gis-geo-sym .sym-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.6rem 0.85rem;
}
#gis-geo-sym .sym-head { border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
#gis-geo-sym .sym-foot { border-top: 1px solid rgba(255, 255, 255, 0.1); }
#gis-geo-sym .sym-title {
  font: 600 0.76rem/1.2 'Exo 2', sans-serif;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}
#gis-geo-sym .sym-body { padding: 0.7rem 0.85rem; overflow-y: auto; min-height: 0; }
#gis-geo-sym .sym-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
#gis-geo-sym .sym-row > label {
  flex: 0 0 7rem;
  font: 500 0.66rem/1.25 'Exo 2', sans-serif;
  color: var(--skin-data, #7ee7ff);
}
#gis-geo-head-wrap { overflow: auto; max-height: 14rem; }
#gis-geo-head-wrap table {
  border-collapse: collapse;
  font: 400 0.6rem/1.3 'Exo 2', sans-serif;
  width: max-content;
  min-width: 100%;
}
#gis-geo-head-wrap th, #gis-geo-head-wrap td {
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 0.18rem 0.4rem;
  white-space: nowrap;
  text-align: left;
  max-width: 14rem;
  overflow: hidden;
  text-overflow: ellipsis;
}
#gis-geo-head-wrap th { color: var(--skin-data, #7ee7ff); font-weight: 600; cursor: pointer; }
#gis-geo-head-wrap th small { display: block; opacity: 0.55; font-weight: 400; }
/* The column being painted is marked in the table itself, so the head and the
   picker cannot disagree about which one is in force. */
#gis-geo-head-wrap .is-colour { background: rgba(var(--nav-accent-rgb), 0.2); }
#gis-geo-sym-preview {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  margin-top: 0.55rem;
  max-height: 12rem;
  overflow-y: auto;
}
#gis-geo-sym-preview .geo-class { display: flex; align-items: center; gap: 0.4rem; }
#gis-geo-sym-preview input[type="color"] {
  width: 1.3rem;
  height: 1.05rem;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 0.15rem;
  background: none;
  cursor: pointer;
}
input.geo-class-label {
  flex: 1 1 auto;
  min-width: 0;
  padding: 0.08rem 0.25rem;
  font: 400 0.63rem/1.35 'Exo 2', sans-serif;
  color: var(--text, #e8f4ff);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 0.15rem;
  text-overflow: ellipsis;
}
input.geo-class-label:focus {
  outline: none;
  border-color: rgba(var(--nav-accent-rgb), 0.85);
}
#gis-geo-sym-preview .geo-class-count { font-size: 0.6rem; opacity: 0.55; }
`;

function installStyle() {
  if (document.getElementById("gis-geology-style")) return;
  const tag = document.createElement("style");
  tag.id = "gis-geology-style";
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

/* ── Panel ───────────────────────────────────────────────────────────────── */

let panel = null;
let nodes = null;

const say = (message) => { if (nodes?.status) nodes.status.textContent = message || ""; };

const loadedLayers = () => (window.GeoIDImportManager?.getLayers?.() || [])
  .filter((l) => l.status === "loaded" && l.geologyDataset);

async function loadDataset(entry) {
  const manager = window.GeoIDImportManager;
  if (!manager?.importFileList) {
    say("The globe is still starting — try again in a moment.");
    return;
  }
  const existing = (manager.getLayers?.() || []).find((l) => l.geologyDataset === entry.id);
  if (existing) {
    say(`${entry.label} is already loaded.`);
    return;
  }
  say(`Loading ${entry.label}…`);
  try {
    const response = await fetch(entry.path);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const before = new Set((manager.getLayers?.() || []).map((l) => l.id));
    await manager.importFileList(
      [new File([blob], entry.name, { type: "application/geo+json" })],
      { role: "geology", name: entry.label },
    );
    const layer = (manager.getLayers?.() || []).find((l) => !before.has(l.id));
    if (!layer) throw new Error("the layer did not arrive");
    // Tagged so this panel can find its own layers again without matching on a
    // name somebody is free to change -- which they now are, from the list.
    layer.geologyDataset = entry.id;
    layer.credit = entry.credit;
    applyField(layer, entry.colourBy);
    publishInteractive();
    say(`${entry.label} — ${layer.features?.length || 0} polygons. ${entry.credit}`);
  } catch (error) {
    say(`${entry.label} did not load: ${error.message}`);
  }
  render();
}

/**
 * Colour a layer by one of its columns.
 *
 * Straight through `categoricalSymbology` and `layer.repaint`, which is the same
 * path the symbology panel's Apply uses — so the legend the layer card draws is
 * produced by the act of colouring rather than kept in step with it.
 */
async function applyField(layer, field, { ramp = QUALITATIVE_RAMP, overrides = null, labels = null } = {}) {
  if (!layer?.features?.length || !field) return null;
  const { categoricalSymbology } = await import(`./symbology.js${new URL(import.meta.url).search}`);
  const sym = categoricalSymbology(layer.features, field, { ramp });
  if (!sym.ok) { say(sym.message); return null; }
  if (overrides) {
    sym.rows.forEach((r) => {
      const chosen = overrides.get(String(r.value));
      if (chosen) r.colour = chosen;
    });
  }
  const lookup = new Map(sym.rows.filter((r) => !r.other).map((r) => [r.value, r.colour]));
  const other = sym.rows.find((r) => r.other)?.colour || null;
  // A VECTOR repaint wants a CSS colour string -- `renderFeatureCollection`
  // does `scratch.set(css)`. A raster repaint wants an [r,g,b] array. Handing
  // the array to a vector layer is not an error: THREE.Color.set swallows it
  // and every polygon comes out WHITE, with a perfectly correct legend beside
  // it. The legend is not evidence that the map was painted.
  layer.repaint?.((feature) => {
    const value = feature?.properties?.[field];
    return (lookup.has(value) ? lookup.get(value) : other) || null;
  });
  layer.legendInfo = {
    palette: sym.rows.map((r) => r.colour.replace("#", "")),
    // The name the user gave the unit, else the attribute's own value.
    labels: sym.rows.map((r) => labels?.get(String(r.value)) || String(r.value)),
    // The raw value stays alongside, so a renamed legend entry can still be
    // traced to the attribute it was made from.
    values: sym.rows.map((r) => String(r.value)),
    counts: sym.rows.map((r) => r.count),
    categorical: true, classed: true, field,
  };
  layer.geologyField = field;
  layer.geologyRamp = ramp;
  layer.geologyLabels = labels ? [...labels.entries()] : null;
  window.GeoIDLayerHierarchy?.render?.();
  // The card and the legend name the unit the map is coloured by, so the
  // catalogue is rebuilt whenever that column changes.
  publishInteractive();
  return sym;
}


/* ── Into the viewer's own interactive-geology catalogue ─────────────────────
 *
 * Mars and Moon get the whole behaviour -- click a unit, it outlines, a card
 * rises from a pin and tracks the point as the globe turns, the legend lists
 * the units -- from ONE thing: a catalogue at
 * `manifest.geology_interactive.feature_path`. Earth's manifest says
 * `feature_count: 0`, so that machinery has always been on this page and never
 * had anything to read.
 *
 * So rather than reimplementing any of it, the mapped geology is converted into
 * exactly that shape and handed over. Earth then runs the same code path as the
 * other worlds, and a fix to it fixes all eleven.
 *
 * The shape is not guessed: `pointInPolygonFeature` wants
 * `polygons: [{ outer, holes }]` with rings as [lon, lat];
 * `pointWithinFeatureBounds` wants `selection_bounds` with a longitude CENTRE
 * and offsets, because a unit crossing the antimeridian cannot be described by
 * a min and a max; and the popup reads name, rock_type, description and
 * mapped_area_km2.
 */

/** Longitude difference wrapped to -180..180, so an offset is the short way. */
function wrapLon(delta) {
  let d = Number(delta);
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

function boundsOfRings(rings) {
  let latMin = Infinity;
  let latMax = -Infinity;
  let lonRef = null;
  let offMin = Infinity;
  let offMax = -Infinity;
  rings.forEach((ring) => ring.forEach(([lon, lat]) => {
    if (lat < latMin) latMin = lat;
    if (lat > latMax) latMax = lat;
    if (lonRef === null) lonRef = lon;
    const off = wrapLon(lon - lonRef);
    if (off < offMin) offMin = off;
    if (off > offMax) offMax = off;
  }));
  if (lonRef === null) return null;
  // Re-centre so the offsets straddle the middle rather than the first vertex.
  const centre = lonRef + (offMin + offMax) / 2;
  const half = (offMax - offMin) / 2;
  return {
    lat_min: latMin, lat_max: latMax,
    lon_center: centre, lon_min_offset: -half, lon_max_offset: half,
  };
}

/**
 * A dataset's short name: whatever follows the last dash in its title.
 *
 * The catalogue's labels are "<region> — <part of the record>", so the tail is
 * the part that distinguishes one sheet from another over the same ground —
 * bedrock from superficial — which is exactly what a card listing both needs to
 * key its rows on. A name with no dash keeps its own name.
 */
function datasetLabel(name) {
  const text = String(name || "").trim();
  const tail = text.split(/\s[—–-]\s/).pop().trim() || text;
  return tail ? tail.charAt(0).toUpperCase() + tail.slice(1) : "Dataset";
}

/**
 * One layer's features as the viewer's catalogue.
 *
 * `field` is whatever the layer is coloured by, so the unit named in the card
 * is the unit named in the legend -- if they were chosen separately they would
 * disagree the first time somebody recoloured the map.
 */
function toInteractiveCatalogue(layers) {
  const features = {};
  const unitSeen = new Map();
  let n = 0;
  layers.forEach((layer) => {
    const field = layer.geologyField || "lex_d";
    // The colour a unit is PAINTED in, looked up by the value it was painted
    // from. Taking `palette[unitSeen.size]` instead paired the nth unit the
    // scan happened to meet with the nth colour of a palette ordered by feature
    // count -- a key that disagrees with the map it is a key to.
    const paint = new Map((layer.legendInfo?.values || [])
      .map((value, i) => [String(value), `#${String(layer.legendInfo.palette?.[i] || "8a8a8a").replace("#", "")}`]));
    const made = [];
    (layer.features || []).forEach((f) => {
      const geometry = f?.geometry;
      const polys = geometry?.type === "Polygon" ? [geometry.coordinates]
        : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
      if (!polys.length) return;
      const polygons = polys
        .map((poly) => ({ outer: poly[0], holes: poly.slice(1) }))
        .filter((p) => Array.isArray(p.outer) && p.outer.length >= 3);
      if (!polygons.length) return;
      const props = f.properties || {};
      /**
       * A field of WHITESPACE is a field with nothing in it.
       *
       * `props.rcs_d || props.rock_d` looks like it handles a missing value and
       * does not: **200 of the 801 superficial polygons carry rcs_d as a single
       * space**, and a space is truthy. Those became a card whose title, meta
       * and copy were all one space -- an empty box, which is indistinguishable
       * from a click that did nothing. ALLUVIUM is the biggest group of them, so
       * every river valley on the sheet opened blank.
       *
       * Everything read off a feature goes through here, and `null` means the
       * card falls back to the next thing it knows: the unit name.
       */
      const val = (...candidates) => {
        for (const c of candidates) {
          const text = String(c ?? "").trim();
          if (text) return text;
        }
        return null;
      };
      const name = val(props[field], props.lex_d, props.rcs_d) || "Unit";
      let km2 = 0;
      polygons.forEach((p) => {
        km2 += sphericalPolygonAreaKm2(p.outer.map(([lon, lat]) => ({ lat, lon })));
      });
      n += 1;
      made.push({
        id: `geo-${layer.id}-${n}`,
        name,
        type: "Geologic unit polygon",
        unit: val(props.lex, props.map_code),
        // The card's meta line is "description · name", and with the lithology
        // blank both halves came from the same column: "ALLUVIUM  ·  ALLUVIUM".
        unit_description: val(props.lex_d) === name ? null : val(props.lex_d),
        rock_type: val(props.rcs_d, props.rock_d),
        rock_type_detail: val(props.lex_rcs_d),
        description: val(props.rcs_d, props.bgstype),
        origin: val(layer.credit, layer.name),
        dimension: val(props.max_period) && val(props.min_period)
          ? (props.max_period === props.min_period ? val(props.max_period)
            : `${val(props.min_period)} – ${val(props.max_period)}`)
          : null,
        mapped_area_km2: km2 > 0 ? Number(km2.toFixed(1)) : null,
        polygons,
        selection_bounds: boundsOfRings(polygons.map((p) => p.outer)),
        source_layer: layer.name,
        // What to CALL this dataset in a card that names several of them.
        // "Northern Ireland — superficial" is the layer's name and too long to
        // be a key beside a rock type; "Superficial" is what the row is about.
        dataset_label: datasetLabel(layer.name),
      });
      if (!unitSeen.has(name)) {
        unitSeen.set(name, paint.get(String(props[field])) || "#8a8a8a");
      }
    });
    // Smallest first WITHIN the layer, so a polygon lying inside a larger one
    // is still reachable: the pick takes the first feature that contains the
    // point, and a big unit listed ahead of an inlier answers for it forever.
    made.sort((a, b) => (a.mapped_area_km2 || 0) - (b.mapped_area_km2 || 0));
    made.forEach((feature) => { features[feature.id] = feature; });
  });
  return {
    features,
    featureList: Object.values(features),
    unit_legend: [...unitSeen.entries()].map(([label, colour]) => ({ label, colour })),
    rock_legend: [],
  };
}

/**
 * Visibility goes through the layer hierarchy, never straight onto the layer.
 *
 * It is the single writer: it sets the flag and the object, redraws the rows
 * and the legend, and announces the change so this panel and the clickable
 * geology follow. The direct write is only for a page where the hierarchy has
 * not loaded, so a tick box still does something.
 */
function setLayerVisible(layer, visible) {
  const hierarchy = window.GeoIDLayerHierarchy;
  if (hierarchy?.setVisible) { hierarchy.setVisible(layer, visible); return; }
  layer.visible = visible;
  if (layer.object3D) layer.object3D.visible = visible;
  render();
  publishInteractive();
}

/**
 * Push whatever mapped geology is loaded into the viewer's own click path.
 *
 * **Order is the whole behaviour.** `getGeologyFeatureAtLatLon` takes the FIRST
 * feature in the list that contains the point, so the list decides which unit a
 * click reports and, for anything underneath it, whether it can be clicked at
 * all. Handed over in layer order, bedrock (id 1) came before superficial
 * (id 2) and won every click -- measured: **793 of 1,559 features, the entire
 * superficial sheet, could not be reached by any click**, and every click over
 * superficial cover named the bedrock beneath it instead of the unit painted on
 * screen.
 *
 * So the list is built top of the draw stack first, which is the layer you are
 * looking at. `renderOrder` is what `applyStack` writes, so this follows the
 * layer list rather than keeping a second idea of which layer is on top.
 * Hiding the top layer both un-draws it and takes it out of here, so the one
 * underneath answers again -- switching superficial off is how you click
 * bedrock everywhere, exactly as in any GIS.
 */
function publishInteractive() {
  const viewer = window.GeoIDViewer;
  if (!viewer?.setGeologyInteractive) return false;
  const layers = loadedLayers().filter((l) => l.visible !== false && l.features?.length)
    .sort((a, b) => (b.object3D?.renderOrder || 0) - (a.object3D?.renderOrder || 0));
  if (!layers.length) return viewer.setGeologyInteractive(null);
  return viewer.setGeologyInteractive(toInteractiveCatalogue(layers));
}

/* ── The symbology dialog ────────────────────────────────────────────────── */

let symBackdrop = null;

function openSymbology(layer) {
  installStyle();
  if (!symBackdrop) {
    symBackdrop = document.createElement("div");
    symBackdrop.id = "gis-geo-sym-backdrop";
    document.body.appendChild(symBackdrop);
    symBackdrop.addEventListener("click", (e) => {
      if (e.target === symBackdrop) symBackdrop.hidden = true;
    });
  }
  symBackdrop.innerHTML = "";
  symBackdrop.hidden = false;

  const card = document.createElement("div");
  card.id = "gis-geo-sym";
  card.addEventListener("click", (e) => e.stopPropagation());

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
  shut.addEventListener("click", () => { symBackdrop.hidden = true; });
  head.append(title, shut);

  const body = document.createElement("div");
  body.className = "sym-body";

  const head6 = attributeHead(layer.features, { rows: 6 });
  const ranked = rankColourFields(head6);
  const state = {
    field: layer.geologyField || ranked[0] || head6.columns[0]?.key,
    ramp: layer.geologyRamp || QUALITATIVE_RAMP,
    overrides: new Map(),
    // Keyed by the unit's own value, so a renamed entry survives a reordering
    // of the class list -- which is ordered by count and does reorder.
    labels: new Map(layer.geologyLabels || []),
  };

  // ── Colour by ──
  const fieldRow = document.createElement("div");
  fieldRow.className = "sym-row";
  const fieldLabel = document.createElement("label");
  fieldLabel.textContent = "Colour by";
  const fieldSelect = document.createElement("select");
  fieldSelect.className = "input";
  head6.columns.forEach((c) => {
    const o = document.createElement("option");
    o.value = c.key;
    // The class count is the fact that decides whether a column is worth
    // colouring by, so it is on the option rather than left to be discovered.
    o.textContent = `${c.key} — ${c.capped ? `${c.distinct}+` : c.distinct} `
      + `value${c.distinct === 1 ? "" : "s"}`;
    o.disabled = c.distinct < 2 || c.capped;
    if (c.key === state.field) o.selected = true;
    fieldSelect.appendChild(o);
  });
  fieldRow.append(fieldLabel, fieldSelect);

  // ── Ramp ──
  const rampRow = document.createElement("div");
  rampRow.className = "sym-row";
  const rampLabel = document.createElement("label");
  rampLabel.textContent = "Ramp";
  const rampSelect = document.createElement("select");
  rampSelect.className = "input";
  // The qualitative set leads the list because it is what named units should be
  // coloured with; the sequential ramps below it are for a column that is
  // ordered, and now actually take effect when chosen.
  [QUALITATIVE_RAMP, ...RAMP_NAMES].forEach((n) => {
    const o = document.createElement("option");
    o.value = n;
    o.textContent = n === QUALITATIVE_RAMP ? "qualitative (distinct hues)" : n;
    if (n === state.ramp) o.selected = true;
    rampSelect.appendChild(o);
  });
  const rampBar = document.createElement("span");
  rampBar.style.cssText = "flex:0 0 6rem;height:0.7rem;border-radius:0.15rem;";
  const paintBar = () => {
    // Hard stops for the qualitative set: it is twelve separate colours, and a
    // gradient between them would claim an order the categories do not have.
    if (rampSelect.value === QUALITATIVE_RAMP) {
      const step = 100 / QUALITATIVE.length;
      rampBar.style.background = `linear-gradient(to right, ${QUALITATIVE
        .map((c, i) => `${c} ${i * step}% ${(i + 1) * step}%`).join(", ")})`;
      return;
    }
    const stops = RAMPS[rampSelect.value].map((c) => `rgb(${c.join(",")})`);
    rampBar.style.background = `linear-gradient(to right, ${stops.join(", ")})`;
  };
  paintBar();
  rampRow.append(rampLabel, rampSelect, rampBar);

  // ── The attribute head ──
  const headWrap = document.createElement("div");
  headWrap.id = "gis-geo-head-wrap";
  const preview = document.createElement("div");
  preview.id = "gis-geo-sym-preview";

  const drawHead = () => {
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    head6.columns.forEach((c) => {
      const th = document.createElement("th");
      th.textContent = c.key;
      const small = document.createElement("small");
      // "200+" rather than "200": the count stops at a cap, and reporting a
      // floor as a total is a small lie the picker would be built on.
      small.textContent = `${c.capped ? `${c.distinct}+` : c.distinct} `
        + `value${c.distinct === 1 ? "" : "s"}`;
      th.appendChild(small);
      th.title = c.capped
        ? `More than ${c.distinct} distinct values — too many to colour by`
        : "Click to colour the map by this column";
      if (c.key === state.field) th.classList.add("is-colour");
      // Clicking the column IS choosing it: the head is the natural place to
      // decide, having just read the values.
      th.addEventListener("click", () => {
        if (c.distinct < 2 || c.capped) return;
        state.field = c.key;
        state.overrides = new Map();
        // A different column is different units; a name pinned to the old ones
        // would label an unrelated rock.
        state.labels = new Map();
        fieldSelect.value = c.key;
        redraw();
      });
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    const tbody = document.createElement("tbody");
    head6.rows.forEach((row) => {
      const tr = document.createElement("tr");
      head6.columns.forEach((c, i) => {
        const td = document.createElement("td");
        td.textContent = row[i] ?? "";
        td.title = row[i] ?? "";
        if (c.key === state.field) td.classList.add("is-colour");
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.append(thead, tbody);
    headWrap.replaceChildren(table);
  };

  const drawPreview = async () => {
    const { categoricalSymbology } = await import(`./symbology.js${new URL(import.meta.url).search}`);
    const sym = categoricalSymbology(layer.features, state.field, { ramp: state.ramp });
    preview.replaceChildren();
    if (!sym.ok) {
      preview.textContent = sym.message;
      return;
    }
    sym.rows.forEach((r) => {
      const line = document.createElement("div");
      line.className = "geo-class";
      const swatch = document.createElement("input");
      swatch.type = "color";
      swatch.value = state.overrides.get(String(r.value)) || r.colour;
      swatch.title = "Click to recolour this unit";
      swatch.addEventListener("input", () => {
        state.overrides.set(String(r.value), swatch.value);
      });
      // The unit's name is editable, because a BGS lithostratigraphic string is
      // not a legend entry: "HIBERNIAN GREENSANDS FORMATION AND ULSTER WHITE
      // LIMESTONE FORMATION (UNDIFFERENTIATED)" is 84 characters and the map is
      // read at a glance. The original stays as the title, so a renamed entry
      // can still be checked against the attribute it came from.
      const label = document.createElement("input");
      label.type = "text";
      label.className = "geo-class-label";
      label.value = state.labels.get(String(r.value)) ?? String(r.value);
      label.title = String(r.value);
      label.addEventListener("keydown", (e) => e.stopPropagation());
      label.addEventListener("change", () => {
        const text = label.value.trim();
        if (text && text !== String(r.value)) state.labels.set(String(r.value), text);
        else state.labels.delete(String(r.value));
      });
      const count = document.createElement("span");
      count.className = "geo-class-count";
      count.textContent = r.count.toLocaleString();
      line.append(swatch, label, count);
      preview.appendChild(line);
    });
  };

  const redraw = () => { drawHead(); void drawPreview(); };

  fieldSelect.addEventListener("change", () => {
    state.field = fieldSelect.value;
    state.overrides = new Map();
    state.labels = new Map();
    redraw();
  });
  rampSelect.addEventListener("change", () => {
    state.ramp = rampSelect.value;
    state.overrides = new Map();
    paintBar();
    void drawPreview();
  });

  body.append(fieldRow, rampRow, headWrap, preview);

  const foot = document.createElement("div");
  foot.className = "sym-foot";
  const note = document.createElement("span");
  note.style.cssText = "font:400 0.6rem/1.3 'Exo 2',sans-serif;opacity:0.7;";
  note.textContent = `${head6.count.toLocaleString()} polygons · ${head6.columns.length} columns`;
  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "button";
  apply.textContent = "Apply";
  apply.addEventListener("click", async () => {
    const sym = await applyField(layer, state.field,
      { ramp: state.ramp, overrides: state.overrides, labels: state.labels });
    if (sym) {
      say(`${layer.name} coloured by ${state.field}: ${sym.rows.length} units.`);
      symBackdrop.hidden = true;
      render();
    }
  });
  foot.append(note, apply);

  card.append(head, body, foot);
  symBackdrop.appendChild(card);
  redraw();
}

/* ── Rendering the panel ─────────────────────────────────────────────────── */

function render() {
  if (!nodes?.loaded) return;
  const layers = loadedLayers();
  nodes.loaded.replaceChildren();
  layers.forEach((layer) => {
    const box = document.createElement("div");
    box.className = "gis-geo-layer";
    const row = document.createElement("div");
    row.className = "gis-geo-layer-head";
    const eye = document.createElement("input");
    eye.type = "checkbox";
    eye.checked = layer.visible !== false;
    eye.title = "Visible";
    // Through the hierarchy, which is the one writer -- it sets the state,
    // redraws the rows and the legend, and announces the change, which brings
    // this list and the clickable geology back in step. Writing the flag here
    // as well is what let the surfaces drift apart.
    eye.addEventListener("change", () => { setLayerVisible(layer, eye.checked); });
    const name = document.createElement("span");
    name.className = "gis-geo-layer-name";
    name.textContent = layer.name;
    name.title = layer.credit || layer.name;
    const sym = document.createElement("button");
    sym.type = "button";
    sym.className = "button secondary";
    sym.textContent = "Symbology…";
    sym.style.fontSize = "0.6rem";
    sym.addEventListener("click", () => openSymbology(layer));
    row.append(eye, name, sym);

    const by = document.createElement("div");
    by.className = "gis-geo-layer-by";
    by.textContent = layer.geologyField
      ? `Coloured by ${layer.geologyField} · ${layer.legendInfo?.labels?.length || 0} units`
      : "Not coloured yet — open Symbology.";

    const opacity = document.createElement("input");
    opacity.type = "range";
    opacity.className = "gis-geo-opacity";
    opacity.min = "0";
    opacity.max = "1";
    opacity.step = "0.05";
    opacity.value = String(layer.opacity ?? 1);
    opacity.title = "Opacity";
    opacity.addEventListener("input", () => {
      const value = Number(opacity.value);
      layer.opacity = value;
      // Through the hierarchy where it exists, so the list's own slider and
      // this one cannot disagree; the direct traverse is the fallback.
      if (window.GeoIDLayerHierarchy?.setOpacity) {
        window.GeoIDLayerHierarchy.setOpacity(layer, value);
        return;
      }
      layer.object3D?.traverse?.((n) => {
        const materials = Array.isArray(n.material) ? n.material : [n.material];
        materials.forEach((m) => {
          if (!m) return;
          // Switched on when needed and never off again -- see setOpacity in
          // layer-hierarchy.js. Turning blending off at full opacity moves the
          // layer into the opaque pass, which is drawn before every transparent
          // layer whatever the stack says, so the sheet underneath paints over
          // it and the layer looks like it vanished.
          if (value < 1) m.transparent = true;
          m.opacity = value;
          m.needsUpdate = true;
        });
      });
    });

    box.append(row, by, opacity);
    nodes.loaded.appendChild(box);
  });
}

/**
 * The datasets a fresh page opens with.
 *
 * Sequential rather than parallel, and each one skipped if it is already there,
 * so this is safe to call again and cannot double-load on a re-init.
 */
async function loadDefaults() {
  if (GLOBAL_BASE) await loadDataset(GLOBAL_BASE);
  for (const entry of forThisBody().filter((d) => d.default)) {
    if (!window.GeoIDViewer) return;
    await loadDataset(entry);
  }
}

/** Is any mapped-geology layer loaded and showing? The tab's tick box asks. */
export function isActive() {
  return loadedLayers().some((l) => l.visible !== false);
}

/**
 * Turn the mapped geology on or off.
 *
 * Loading is done once and then kept: unticking hides rather than removes, so
 * re-ticking does not re-fetch and re-parse 2.8 MB, and any symbology, renamed
 * units and hand-picked colours survive being switched off.
 */
/**
 * Did WE stop the globe, or was it already stopped?
 *
 * Only what this tab paused may this tab restart. Someone who froze the planet
 * with the corner button or the space bar, then looked at the geology, would
 * otherwise have it start turning again when they put the geology away.
 */
let pausedSpinForGeology = false;

/**
 * Reading a map is not something you do on a moving planet.
 *
 * The globe turns at 3 degrees a second -- 193 km of ground a second at
 * Northern Ireland's latitude -- so a unit you are looking at crosses the
 * screen while you read its card, and a polygon you meant to click has moved by
 * the time you click it. Switching the geology on is a statement that the map
 * is the thing being used, so the spin stops; switching it off gives it back.
 *
 * Through the viewer's own `setSpinPaused`, which is the one thing that stops
 * the rotation and which keeps the corner button in step -- rather than
 * freezing the globe here and leaving that button claiming it still turns.
 */
function holdGlobeStill(on) {
  const viewer = window.GeoIDViewer;
  if (!viewer?.setSpinPaused) return;
  if (on) {
    if (viewer.isSpinPaused?.()) return;      // already still, and not ours to resume
    viewer.setSpinPaused(true);
    pausedSpinForGeology = true;
    return;
  }
  if (!pausedSpinForGeology) return;
  pausedSpinForGeology = false;
  viewer.setSpinPaused(false);
}

async function setActive(on) {
  if (on && !loadedLayers().length) {
    say("Loading mapped geology…");
    await loadDefaults();
  }
  loadedLayers().forEach((layer) => { setLayerVisible(layer, on); });
  holdGlobeStill(on);
  render();
  publishInteractive();
  if (!on) say("Mapped geology hidden — tick the box to bring it back.");
}

export function init() {
  const host = document.getElementById("geology-section");
  if (!host || document.getElementById("gis-geology-panel")) return false;
  const body = host.querySelector(".section-body .control-stack") || host.querySelector(".section-body");
  if (!body) return false;
  installStyle();

  panel = document.createElement("div");
  panel.id = "gis-geology-panel";

  const intro = document.createElement("div");
  intro.className = "section-summary-copy";
  intro.textContent = "Mapped geology as vector units: choose what to colour by, "
    + "and click a polygon to read what it is.";

  // What the base is, stated rather than implied. A tab that silently shows two
  // Northern Irish sheets invites the reading that this is world coverage.
  const base = document.createElement("div");
  base.className = "gis-geo-base";
  base.textContent = GLOBAL_BASE
    ? `Base: ${GLOBAL_BASE.label}`
    : "No global base yet — regional surveys only. "
      + "A merged world geology will sit under these when it exists.";

  const pickRow = document.createElement("div");
  pickRow.className = "row";
  const pickLabel = document.createElement("label");
  pickLabel.textContent = "Dataset";
  pickLabel.setAttribute("for", "gis-geology-dataset");
  const select = document.createElement("select");
  select.id = "gis-geology-dataset";
  select.className = "input";
  regional().forEach((entry) => {
    const o = document.createElement("option");
    o.value = entry.id;
    o.textContent = entry.label;
    select.appendChild(o);
  });
  pickRow.append(pickLabel, select);

  const add = document.createElement("button");
  add.type = "button";
  add.className = "tool-button";
  add.textContent = "Add to globe";
  add.addEventListener("click", () => {
    const entry = entryById(select.value);
    if (entry) void loadDataset(entry);
  });

  const loaded = document.createElement("div");
  loaded.id = "gis-geology-loaded";
  const status = document.createElement("div");
  status.id = "gis-geology-status";

  panel.append(intro, base, pickRow, add, loaded, status);
  // Above the legacy bathymetry controls: this is what the tab is for now.
  body.insertBefore(panel, body.firstChild);
  nodes = { select, loaded, status };

  window.GeoIDImportManager?.onChange?.(render);
  render();
  /**
   * The tab's tick box governs the mapped geology, rather than it arriving
   * whether or not anybody asked.
   *
   * Preloading two 1.4 MB sheets on every page open is a decision made for the
   * user: it costs the first frames of a page nobody has touched, and there was
   * no way to say no -- unticking did nothing because nothing was listening.
   * First tick loads; after that it is a visibility switch, so the second tick
   * is instant and the parse is paid once.
   */
  if (!regional().length) {
    base.textContent = `No mapped geology for ${currentBodyId()} yet.`;
    pickRow.hidden = true;
    add.hidden = true;
  }

  /**
   * Whoever switched a layer, this panel follows it.
   *
   * The clickable catalogue is filtered by visibility, so a sheet switched off
   * in the layer list went on answering clicks until something else happened to
   * republish it -- the map said one thing and the popup another. The tab's own
   * tick box is the fourth surface: `isActive()` is "any mapped geology still
   * showing", so switching the last sheet off anywhere clears it.
   */
  window.addEventListener("geoid-gis:layers-changed", (event) => {
    if (event.detail?.reason !== "visibility") return;
    render();
    publishInteractive();
    const box = document.getElementById("geology-master-toggle");
    if (box) box.checked = isActive();
  });

  const master = document.getElementById("geology-master-toggle");
  master?.addEventListener("change", () => { void setActive(master.checked); });
  if (master?.checked) void setActive(true);
  return true;
}

if (typeof document !== "undefined") {
  // The section arrives with the markup on Earth and with the shell on a planet
  // page, and toolbox.js moves it afterwards -- so this retries rather than
  // assuming a moment, the same shape side-panels.js uses.
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
  window.GeoIDGeology = {
    init, render, openSymbology, applyField,
    catalogue: () => CATALOGUE.map((c) => c.id),
    publishInteractive,
    toInteractiveCatalogue,
    loadDefaults,
    isActive,
    setActive,
    globalBase: () => GLOBAL_BASE,
    load: (id) => { const e = entryById(id); return e ? loadDataset(e) : null; },
  };
}
