/**
 * Explorer ▸ Locations ▸ Feature outlines (IAU): the named features' OUTLINES
 * on the planet viewers, beside -- not inside -- the label list above them.
 *
 * The labels on these worlds are the IAU Gazetteer of Planetary Nomenclature's
 * centre points. The same gazetteer draws each named feature's extent: a
 * crater's rim, a planitia's reach, a rupes as a line. bake-nomenclature.py
 * turns them into one GeoJSON per world, published to the data bucket.
 *
 * ONE TICK, OFF WHEN THE PAGE OPENS. The Moon's is 9,060 outlines, and the
 * label list above it is how most people read these worlds; the outlines are
 * a layer somebody asks for.
 *
 * AND ONCE ON IT IS AN ORDINARY LAYER. It goes in through the importer a
 * dropped file uses, so it has a Workspace row, an eye, opacity, draw order,
 * symbology and export, the click card and its highlight, and it is drawn on
 * the relief the way every imported vector is: fills at the ground, following
 * the terrain. The tick is read back off the layer, never remembered here --
 * removing the row in the Workspace unticks it.
 *
 * Earth is not here (its names are its own gazetteer), nor Mars: the IAU
 * publishes no outlines for Mars, only centre points.
 */
import { dataUrl } from "./data-base.js?v=20260919-6aa21d5";
import { currentBodyId, getBody } from "./bodies.js?v=20260919-6aa21d5";
import { paintByField } from "./symbology-dialog.js?v=20260919-6aa21d5";

export const OUTLINE_BODIES = {
  moon: { path: "/data/global/nomenclature/moon.geojson", name: "Moon" },
  mercury: { path: "/data/global/nomenclature/mercury.geojson", name: "Mercury" },
  venus: { path: "/data/global/nomenclature/venus.geojson", name: "Venus" },
  pluto: { path: "/data/global/nomenclature/pluto.geojson", name: "Pluto" },
};

export const layerNameFor = (body) => `Named feature outlines — ${OUTLINE_BODIES[body]?.name || body} (IAU)`;
const CREDIT = "IAU Gazetteer of Planetary Nomenclature, USGS Astrogeology Science Center (public domain)";

const byId = (id) => document.getElementById(id);

function layerOf(body) {
  const name = layerNameFor(body);
  return (window.GeoIDImportManager?.getLayers?.() || []).find((l) => l.name === name) || null;
}

/**
 * A WEST-POSITIVE WORLD READS A LONGITUDE THE OTHER WAY. The file is the
 * gazetteer's east longitudes; Mercury's viewer places a coordinate by its
 * west longitude, as its own labels are stored. Measured before this, every
 * Mercury outline stood about 100° from its label (Beethoven 101°); with the
 * longitude negated the outline and the label land on the same point.
 */
export const isWestPositive = (body) => /^west/.test(getBody(body)?.lonConvention || "");

export function toWestPositive(fc) {
  const flip = (c) => (typeof c[0] === "number" ? [c[0] === 0 ? 0 : -c[0], c[1]] : c.map(flip));
  return { ...fc, features: fc.features.map((f) => (f.geometry
    ? { ...f, geometry: { ...f.geometry, coordinates: flip(f.geometry.coordinates) } } : f)) };
}

let busy = false;

async function load(body, say) {
  const manager = window.GeoIDImportManager;
  if (!manager?.importFileList) { say("The GIS layer is still starting — try again in a moment."); return false; }
  if (layerOf(body)) return true;
  busy = true;
  try {
    say("Loading the outlines…");
    const response = await fetch(await dataUrl(OUTLINE_BODIES[body].path));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    let blob = await response.blob();
    const west = isWestPositive(body);
    if (west) blob = new Blob([JSON.stringify(toWestPositive(JSON.parse(await blob.text())))]);
    await manager.importFileList([new File([blob], `${body}-nomenclature.geojson`, { type: "application/geo+json" })],
      { name: layerNameFor(body), frame: false, hold: false });
    const layer = layerOf(body);
    if (!layer || layer.status === "error") {
      if (layer) manager.removeLayer(layer.id);
      throw new Error(layer?.message || "the importer did not take it");
    }
    layer.metadata = { ...(layer.metadata || {}), source: CREDIT, citation: CREDIT,
      crs: `${OUTLINE_BODIES[body].name} 2000 geographic, longitude ${west ? "WEST-positive (this viewer's convention)" : "east"}` };
    // a regio holds the planitia that holds the crater: the name the pointer
    // means is the smallest one under it (feature-popup honours the flag)
    layer.pickSmallest = true;
    // one colour per feature type, the question an outline map is read for
    paintByField(layer, "type");
    say(`${layer.features?.length?.toLocaleString?.() || ""} named features outlined. Source: ${CREDIT}.`);
    return true;
  } catch (error) {
    say(`The outlines did not load (${error.message || error}).`);
    return false;
  } finally {
    busy = false;
  }
}

function install(body, tries = 0) {
  const section = byId("locations-section");
  const body_ = section?.querySelector(":scope > .section-body");
  if (!body_) {
    if (tries < 80) setTimeout(() => install(body, tries + 1), 250);
    return;
  }
  if (byId("nomenclature-outlines")) return;
  // Its own subsection, after the list: the labels are points, this is a
  // layer, and a tick among the label rows would read as a sixth label type.
  const wrap = document.createElement("details");
  wrap.id = "nomenclature-outlines";
  wrap.className = "gis-tool-section";
  wrap.innerHTML = `
    <summary>Feature outlines (IAU)</summary>
    <div class="gis-tool-body">
      <div class="row">
        <label for="nomenclature-outlines-toggle">Named feature outlines</label>
        <span class="checkbox-wrap"><input id="nomenclature-outlines-toggle" type="checkbox"></span>
      </div>
      <p class="compact-copy">The extent of each named feature -- craters, plains, ridges -- as the IAU
        gazetteer draws it. A layer: it joins the Workspace, where it can be recoloured and exported.</p>
      <p class="compact-copy" id="nomenclature-outlines-status" aria-live="polite"></p>
    </div>`;
  body_.appendChild(wrap);
  const tick = byId("nomenclature-outlines-toggle");
  const status = byId("nomenclature-outlines-status");
  const say = (m) => { if (status) status.textContent = m; };
  tick.addEventListener("change", async () => {
    if (tick.checked) {
      const ok = await load(body, say);
      tick.checked = ok && Boolean(layerOf(body));
    } else {
      const layer = layerOf(body);
      if (layer) window.GeoIDImportManager.removeLayer(layer.id);
      say("");
    }
  });
  // the tick follows the layer: removed in the Workspace, it unticks here
  const follow = () => { if (!busy) tick.checked = Boolean(layerOf(body)); };
  const hook = (n = 0) => {
    if (window.GeoIDImportManager?.onChange) window.GeoIDImportManager.onChange(follow);
    else if (n < 80) setTimeout(() => hook(n + 1), 250);
  };
  hook();
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  const start = () => {
    const body = currentBodyId();
    if (OUTLINE_BODIES[body]) install(body);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}
