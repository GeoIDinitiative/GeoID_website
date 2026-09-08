/**
 * THE ESTIMATE SETTLING DOWN — the cyclone risk map, played as it was learned.
 *
 * A DIFFERENT QUESTION FROM THE SEASON ANIMATION, and worth being clear which
 * is which. `cyclone-timelapse.js` steps what HAPPENED in each year — a count.
 * This steps the ESTIMATE: the climatology recomputed over 1980..Y for every Y,
 * so what moves between frames is how well the hazard is known rather than
 * what the weather did. Watching it, the map stops moving — measured, the mean
 * difference from the final estimate falls from 0.076 after one season to
 * 0.0015 after forty-six.
 *
 * WHY A RASTER HERE AND THE GRID THERE. The static map's cells are a quadtree
 * that coarsens where the field is flat — and the field CHANGES every year, so
 * a quadtree rebuilt per frame changes its own geometry between frames. Half
 * of what a reader would see moving is then the resolution rather than the
 * hazard, which is the glacier animation's own fault ("what moved between
 * frames was which analyst had been working"). A fixed lattice cannot have it:
 * every frame is the same 1440x720 cells, so a difference between two frames
 * is a difference in the estimate. The grid stays as the static map, where
 * nothing is being compared frame to frame and its variable resolution is
 * exactly what makes it readable.
 *
 * AND THE EARLY FRAMES ARE NOT A HAZARD MAP. One season of record gives
 * P = 0.63 anywhere a single storm passed, because that is what one arrival in
 * one year means; it is sampling noise wearing a probability's clothes. Every
 * frame says how many seasons it stands on, and the first few say outright
 * that they are mostly noise — the same rule the pre-satellite track frames
 * follow.
 */

import { loadGeoTiffLibrary } from "./geotiff-adapter.js?v=20260908-2125c8a";
import { dataUrl } from "./data-base.js?v=20260908-2125c8a";
import { riskEdges, RISK_LABELS } from "./cyclone-risk.js?v=20260908-2125c8a";
import { rampColour } from "./symbology.js?v=20260908-2125c8a";
import { startPlayer, stopPlayer } from "./timelapse-player.js?v=20260908-2125c8a";

const FILE = "/data/global/cyclone-risk-cumulative.hotlink-ok.tif";
const WORLD = { west: -180, south: -90, east: 180, north: 90 };

/**
 * Below this many seasons the estimate is mostly sampling noise, and the frame
 * says so. Ten years is not a threshold anybody has published — it is the
 * point at which one extra storm stops moving a cell by a tenth of its own
 * value, and it is stated as a rule of thumb rather than as a standard.
 */
export const THIN_SEASONS = 10;

let image = null;
let seasons = null;
let running = false;
let three = null;

const byId = (id) => document.getElementById(id);

function say(message) {
  const node = byId("cyclone-play-status");
  if (node) node.textContent = message;
}

/**
 * The value is a BYTE and the classes are the static map's own, so the lookup
 * is 256 entries built once. Sharing `riskEdges()` is what stops the animation
 * and the map it animates disagreeing about where a class begins — two
 * implementations of one scale is how they drift.
 */
export function buildLut(edges = riskEdges()) {
  const lut = new Uint8Array(256 * 4);
  for (let v = 0; v < 256; v += 1) {
    const p = v / 255;
    let band = 0;
    edges.forEach((edge, i) => { if (p >= edge) band = i + 1; });
    const [r, g, b] = rampColour("risk", band / Math.max(1, edges.length));
    lut[v * 4] = r; lut[v * 4 + 1] = g; lut[v * 4 + 2] = b;
    // A cell no storm has ever reached is not the bottom class -- it is
    // outside the map. Drawn transparent, the basemap shows through and the
    // reader can see it is ground rather than a low reading.
    lut[v * 4 + 3] = v === 0 ? 0 : 235;
  }
  return lut;
}

/** What the bar says under the year. */
export function noteFor(epoch) {
  const n = epoch.count;
  const tail = n < THIN_SEASONS
    ? ` — ${n} season${n === 1 ? "" : "s"} of record, mostly sampling noise`
    : ` — the estimate after ${n} seasons`;
  return `${epoch.year}${tail}`;
}

async function open() {
  if (image) return image;
  const GeoTIFF = await loadGeoTiffLibrary();
  const tiff = await GeoTIFF.fromUrl(await dataUrl(FILE));
  image = await tiff.getImage();
  // The seasons are the BANDS' own descriptions, written by the bake. Counting
  // forward from a start year instead would be a second place that has to know
  // where the record begins, and it would be silently wrong the day the window
  // moves.
  const meta = image.getGDALMetadata ? image.getGDALMetadata() : null;
  const count = image.getSamplesPerPixel();
  seasons = [];
  for (let b = 0; b < count; b += 1) {
    const own = image.getGDALMetadata ? image.getGDALMetadata(b) : null;
    const named = Number(own?.DESCRIPTION ?? meta?.DESCRIPTION);
    seasons.push(Number.isFinite(named) ? named : null);
  }
  return image;
}

/** One band, painted through the shared classes into an RGBA canvas. */
export async function frameCanvas(band, lut) {
  const [data] = await image.readRasters({ samples: [band] });
  const w = image.getWidth(), h = image.getHeight();
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  const px = ctx.createImageData(w, h);
  for (let i = 0; i < data.length; i += 1) {
    const v = data[i] & 255;
    px.data[i * 4] = lut[v * 4];
    px.data[i * 4 + 1] = lut[v * 4 + 1];
    px.data[i * 4 + 2] = lut[v * 4 + 2];
    px.data[i * 4 + 3] = lut[v * 4 + 3];
  }
  ctx.putImageData(px, 0, 0);
  return canvas;
}

export async function play() {
  if (running) { stopPlayer(); running = false; }
  say("Opening the record…");
  await open();
  if (!three) three = await import("../vendor/three.module.js");
  const gee = await import(`./gee.js${new URL(import.meta.url).search}`);
  const lut = buildLut();

  const first = await frameCanvas(1, lut);
  const mesh = await gee.drape(first.toDataURL(), WORLD);
  if (!mesh) { say("The globe is not ready yet."); return null; }

  /**
   * REGISTERED for its row and its key, then PARENTED TO THE GLOBE.
   *
   * Both halves, and the second is the one that bites. `drape` builds its
   * vertices in the GLOBE's frame and bakes that half-turn in itself, while
   * `addDerivedLayer` reparents what it is given into
   * `GeoID-ImportedGeoLayers`, which carries the spin a different way — so
   * registering alone puts the sheet half a world from the ground it maps.
   * gee.js does exactly this pair for the same reason; it is not belt and
   * braces.
   */
  const legend = {
    palette: RISK_LABELS.map((_, i) => {
      const [r, g, b] = rampColour("risk", i / Math.max(1, riskEdges().length));
      return [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
    }),
    labels: [...RISK_LABELS],
    label: "Chance of a storm passing within 200 km",
    classed: true, categorical: false, unit: null,
  };
  const layer = window.GeoIDImportManager?.addDerivedLayer?.(
    "Cyclone risk — the estimate over time", {
      object3D: mesh, bounds: WORLD, georeferenced: true, legendInfo: legend,
    }, "ibtracs");
  if (layer) {
    mesh.userData.geoidLayer = true;
    window.GeoIDViewer?.globe?.add?.(mesh);
  }

  const epochs = seasons.map((year, i) => ({
    date: String(year), label: String(year), dataset: null,
    from: `${year}-01-01`, to: `${year}-12-31`,
    year, count: i + 1, band: i + 1,
  }));

  running = true;
  await startPlayer({
    bounds: WORLD,
    epochs,
    // The subject is the field. A picture behind it would be a request a frame
    // to answer a question nobody asked of this layer.
    source: "none",
    noteFor,
    onStatus: say,
    /**
     * OPENS ON THE LAST BAND, which is the full-record climatology — the very
     * map the layer draws. So ticking the risk map on changes nothing about
     * what is on screen and puts the record's own history one drag away. No
     * special terminal frame is needed here, unlike the season sequence: this
     * one already ends on the answer.
     */
    startAt: epochs.length - 1,
    /**
     * A REPAINT, not a rebuild. Every band is the same 1440x720 lattice over
     * the same ground, so the geometry is built once and only the texture
     * changes — 47 global drapes would be some two hundred megabytes of
     * texture for a sequence that shows one at a time.
     */
    onShow: async (index) => {
      const canvas = await frameCanvas(epochs[index].band, lut);
      const next = new three.CanvasTexture(canvas);
      next.colorSpace = three.SRGBColorSpace;
      mesh.traverse?.((n) => {
        if (!n.material || !("map" in n.material)) return;
        n.material.map?.dispose?.();
        n.material.map = next;
        n.material.needsUpdate = true;
      });
    },
    onStop: () => {
      running = false;
      if (layer) window.GeoIDImportManager?.removeLayer?.(layer.id);
      mesh.parent?.remove(mesh);
      mesh.traverse?.((n) => {
        n.geometry?.dispose?.();
        n.material?.map?.dispose?.();
        n.material?.dispose?.();
      });
      say("");
    },
  });
  return { frames: epochs.length };
}

/**
 * NOTHING TO WIRE. The button that starts this lives on the catalogue row of
 * the layer it plays (`entry.play` in global-data.js), so the catalogue builds
 * and binds it -- and it exists only while that layer is on the globe, which
 * is what retired both the standing button and the sentence telling the reader
 * which box to tick first. The module is reached through its window seam.
 */
if (typeof window !== "undefined") {
  window.GeoIDCycloneRiskRaster = { play, buildLut, noteFor, THIN_SEASONS };
}
