/**
 * ROCK PROPERTIES — its own subtab in the Geology tab.
 *
 * A rock-property map is a different MAP, not a different colouring of the
 * geology, and the first version got that wrong: it put a "Colour by" select on
 * the world geology's own row, which would have repainted the sheet a reader
 * had loaded to look at the geology. Reported in one line — "the original world
 * geology map should be untouched, the rock property map should have its own
 * sub tab".
 *
 * So each property is a ROW here, and ticking one loads a SEPARATE layer: its
 * own entry in Workspace, its own legend, its own eye, opacity and place in the
 * draw order, stackable over or under the geology it was derived from. The
 * world geology is never touched, and both can be on the globe at once — which
 * is the comparison anybody would actually want to make.
 *
 * It is the geology's OWN loader underneath (`loadDerivedGeologyMap`), so a
 * property map streams, refines on settle, clips and exports exactly as the
 * sheet does. Nothing here knows about tiles.
 *
 * THE COST, stated because it is real: a second layer is a second
 * triangulation of the same ground. The tiles themselves are already cached, so
 * there is almost no network in it, but the build is genuine work — which is
 * why these are opt-in rows rather than something that arrives with the map.
 */

import { loadRockProperties } from "./rock-properties.js?v=20260903-601a7cc";
import { propertyPaint } from "./rock-property-map.js?v=20260903-601a7cc";
import { loadDerivedGeologyMap, removeDerivedGeologyMap }
  from "./geology-panel.js?v=20260903-601a7cc";

const LAYER_PREFIX = "rock-property-";

/** The order the list reads in, and the heading each group takes. */
const GROUPS = [
  ["strength", "Strength"],
  ["residual", "Residual — after failure"],
  ["deformation", "Deformation"],
  ["hydraulic", "Hydrogeology"],
  ["rockmass", "Rock mass"],
  ["physical", "Physical"],
  ["durability", "Durability"],
];

let database = null;
let statusNode = null;

function say(message) {
  if (statusNode) statusNode.textContent = message || "";
}

function idFor(parameter) {
  return `${LAYER_PREFIX}${parameter}`;
}

function isOn(parameter) {
  return (window.GeoIDImportManager?.getLayers?.() || [])
    .some((l) => l.geologyDataset === idFor(parameter));
}

/**
 * One row per property: a tick, a name, and the unit it is measured in.
 *
 * Deliberately the catalogue's own row shape rather than a select — several
 * of these are worth having on the globe at once (strength over permeability,
 * peak over residual), and a select can only ever express one.
 */
function buildRow(parameter, meta) {
  const row = document.createElement("label");
  row.className = "gis-catalogue-row";
  const tick = document.createElement("input");
  tick.type = "checkbox";
  tick.checked = isOn(parameter);
  const name = document.createElement("span");
  name.className = "gis-catalogue-name";
  name.textContent = `${meta.label} (${meta.unit})`;
  /**
   * The parameter's own note is the tooltip, because half of these have a
   * common name that hides the distinction that matters — "hydraulic
   * conductivity" is two different numbers and the note is what says which.
   */
  row.title = meta.note;

  tick.addEventListener("change", async () => {
    if (!tick.checked) {
      removeDerivedGeologyMap(idFor(parameter));
      say(`${meta.label} removed.`);
      return;
    }
    tick.disabled = true;
    say(`${meta.label}: building from the geology tiles…`);
    try {
      const paint = propertyPaint(parameter, database);
      if (!paint) { say(`No range is published for ${meta.label}.`); tick.checked = false; return; }
      const layer = await loadDerivedGeologyMap({
        id: idFor(parameter),
        label: `${meta.label} — from lithology`,
        colourFor: paint.colourOf,
        legendInfo: paint.legendInfo,
      });
      if (!layer) { say(`${meta.label} could not be added.`); tick.checked = false; return; }
      /**
       * HOW MUCH OF THE MAP GOT AN ANSWER, said out loud.
       *
       * A strength map over an alluvial basin is mostly blank because a soil
       * has no uniaxial compressive strength, and that is a CORRECT map.
       * Without the count it reads as a broken one.
       */
      const { countPainted } = await import(
        `./rock-property-map.js${new URL(import.meta.url).search}`);
      const tally = countPainted(layer, paint);
      /**
       * EVERY POLYGON GETS AN ANSWER, and the line says which kind. A cell is
       * a value, a "does not apply to this material", or a lithology the
       * database could not name — and after the alias table the last of those
       * is a handful in eleven thousand.
       */
      const parts = [`${tally.painted.toLocaleString()} of `
        + `${tally.total.toLocaleString()} units valued`];
      if (tally.prior) {
        parts.push(`${tally.prior.toLocaleString()} on a no-lithology prior`);
      }
      if (tally.notApplicable) {
        parts.push(`${tally.notApplicable.toLocaleString()} where the quantity `
          + `does not apply`);
      }
      if (tally.unknown) parts.push(`${tally.unknown.toLocaleString()} unrecognised`);
      say(`${meta.label}: ${parts.join(", ")}. Ranges for a rock NAME — a prior `
        + `for screening, not a measurement of this ground.`);
    } catch (error) {
      say(`${meta.label} could not be built.`);
      tick.checked = false;
    } finally {
      tick.disabled = false;
    }
  });

  row.append(tick, name);
  return row;
}

function buildSection() {
  const node = document.createElement("details");
  node.className = "gis-tool-section";
  node.id = "rock-properties-section";
  const summary = document.createElement("summary");
  summary.textContent = "Rock properties";
  node.appendChild(summary);

  const body = document.createElement("div");
  body.className = "gis-tool-body";

  const copy = document.createElement("p");
  copy.className = "tool-copy";
  /**
   * The card says what the map IS before it offers one. These are published
   * ranges for a rock name resampled onto the geology, not measurements of
   * this ground, and a reader meeting a coloured planet should be told that
   * before they read a number off it.
   */
  copy.textContent = "The same Macrostrat tiles read as engineering properties: "
    + "each unit's own lithology looked up in a cited database, and painted at "
    + "every zoom. Each is a SEPARATE layer, so the geology sheet is untouched "
    + "and both can be on the globe at once. Published ranges for a rock NAME "
    + "— a prior for screening and regional modelling, to be replaced by site "
    + "investigation before any design.";
  body.appendChild(copy);

  const list = document.createElement("div");
  list.className = "control-stack";
  const byKind = new Map();
  for (const [key, meta] of Object.entries(database.parameters)) {
    if (!byKind.has(meta.kind)) byKind.set(meta.kind, []);
    byKind.get(meta.kind).push([key, meta]);
  }
  for (const [kind, heading] of GROUPS) {
    const entries = byKind.get(kind);
    if (!entries?.length) continue;
    const title = document.createElement("p");
    title.className = "gis-catalogue-group";
    title.textContent = heading;
    list.appendChild(title);
    for (const [key, meta] of entries) list.appendChild(buildRow(key, meta));
  }
  body.appendChild(list);

  statusNode = document.createElement("p");
  statusNode.className = "tool-status";
  body.appendChild(statusNode);

  /**
   * WHERE THE NUMBERS CAME FROM, one click away.
   *
   * A property database whose citations are not reachable from the map is a
   * database of assertions. The bibliography is folded rather than omitted:
   * it is long, and it is the thing somebody checks once and then trusts.
   */
  const sources = document.createElement("details");
  sources.className = "gis-tool-section";
  const sourcesSummary = document.createElement("summary");
  sourcesSummary.textContent = `Sources (${Object.keys(database.bibliography).length})`;
  sources.appendChild(sourcesSummary);
  const sourceBody = document.createElement("div");
  sourceBody.className = "gis-tool-body";
  for (const entry of Object.values(database.bibliography)) {
    const line = document.createElement("p");
    line.className = "tool-copy";
    if (entry.url) {
      const link = document.createElement("a");
      link.href = entry.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = entry.citation;
      line.appendChild(link);
    } else {
      line.textContent = entry.citation;
    }
    sourceBody.appendChild(line);
  }
  sources.appendChild(sourceBody);
  body.appendChild(sources);

  node.appendChild(body);
  return node;
}

/**
 * Mount when the host exists, however it got there.
 *
 * `geology-panel.js` builds its own section and `panels.js` writes the markup;
 * there is no one event meaning "the panels are up", so this polls and stops
 * itself once the card has landed — the pattern `earth-data-panel.js`
 * documents, and the reason its SoilGrids card sits in this same tab.
 */
function whenHost(selector, place) {
  let tries = 0;
  const tick = () => {
    const host = document.querySelector(selector);
    if (host) { place(host); return; }
    if ((tries += 1) < 50) window.setTimeout(tick, 300);
  };
  tick();
}

export async function init() {
  if (document.getElementById("rock-properties-section")) return;
  try {
    database = await loadRockProperties();
  } catch (error) {
    // No database, no subtab. A control that cannot do its job must not appear.
    return;
  }
  whenHost("#geology-section .section-body .control-stack", (host) => {
    if (document.getElementById("rock-properties-section")) return;
    host.appendChild(buildSection());
  });
}

if (typeof window !== "undefined") {
  window.GeoIDRockPropertiesPanel = { init };
  // Self-starting, like every other panel that mounts into a tab it does not
  // own: there is no event meaning "the panels are up", and `whenHost` polls.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}
