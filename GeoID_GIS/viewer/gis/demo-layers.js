/**
 * Shipped demonstrations: layers that load with one press and no setup.
 *
 * The sidecar earns its place for the three things a browser genuinely cannot
 * do — run a subprocess (GDAL, gmsh, GALES), hold a secret, and write to a
 * folder of your choosing. **Reading a file is not one of them.** The NI
 * prototype needed it only because that project lives in `~/geoid_projects/`,
 * outside the web root, where a page has no way to reach it; so looking at a
 * finished map cost a launcher, a token and an open project.
 *
 * These datasets are served with the site instead. They go in through the SAME
 * `importFileList` a dropped file uses — no second georeferencing path, no
 * special-case layer — so a demo layer is an ordinary layer the moment it
 * lands: it can be clipped, sampled, reclassified, charted and exported like
 * anything else.
 *
 * The full project stays where it was for anyone who wants to re-run the
 * analysis or open it in the desktop app. This is the read path, and it is
 * free.
 */

const DEMOS = {
  "ni-prototype": {
    label: "Northern Ireland prototype",
    // Ranked first: it is the map to read, and it is the one the page shows.
    files: [
      // 0-2: the results.
      { path: "/ni-prototype/data/ni_landslide_susceptibility_quantile.tif",
        name: "NI landslide susceptibility (ranked).tif" },
      { path: "/ni-prototype/data/ni_flood_susceptibility.tif",
        name: "NI flood susceptibility.tif" },
      { path: "/ni-prototype/data/ni_landslide_susceptibility.tif",
        name: "NI landslide susceptibility (absolute).tif" },
      // 3-7: what they were made from.
      { path: "/ni-prototype/data/ni_bedrock.geojson",
        name: "NI bedrock geology (BGS 625k).geojson" },
      { path: "/ni-prototype/data/ni_superficial.geojson",
        name: "NI superficial geology (BGS 625k).geojson" },
      { path: "/ni-prototype/data/ni_dem_100m.tif",
        name: "NI elevation 100 m (Copernicus).tif" },
      { path: "/ni-prototype/data/ni_rainfall.geojson",
        name: "NI rainfall 1991-2020 (HadUK).geojson" },
      { path: "/ni-prototype/data/ni_rivers.geojson",
        name: "NI rivers (OpenStreetMap).geojson" },
    ],
    /**
     * The INPUTS, indexed on from the outputs.
     *
     * A prototype that ships only its three finished pictures is a claim, not
     * a demonstration: the geology, rainfall, drainage and terrain the maps
     * were made from have to be on the globe too, or nobody can check the
     * result against what produced it. Geometry is simplified to about 50 m —
     * well below the 1:625k source's own precision — and the DEM is Int16,
     * because a 100 m grid carries no sub-metre vertical detail.
     */
    // Where to look once they are on the globe.
    view: { lat: 54.67, lon: -6.775, spanDeg: 2.9 },
    note: "Susceptibility screening from open BGS, Met Office, Copernicus and "
      + "OpenStreetMap data. Not a hazard map.",
  },
};

/** Status goes wherever the caller has room for it, or to the console. */
function say(message) {
  const node = document.getElementById("demo-status")
    || document.getElementById("import-status");
  if (node) node.textContent = message;
  else console.info(`[GeoID demo] ${message}`);
}

/**
 * Fetch the demo's files and hand them to the import manager as real Files.
 *
 * Sequential rather than parallel: each import builds geometry and uploads a
 * texture, and three at once on a cold page competes with the globe's own
 * tiles for the same frame budget.
 */
export async function load(id = "ni-prototype") {
  const demo = DEMOS[id];
  if (!demo) {
    say(`No demo called "${id}".`);
    return null;
  }
  const manager = window.GeoIDImportManager;
  if (!manager?.importFileList) {
    say("The GIS layer is still starting — try again in a moment.");
    return null;
  }
  const already = new Set((manager.getLayers?.() || []).map((l) => l.name));
  let loaded = 0;
  for (const entry of demo.files) {
    if (already.has(entry.name)) continue;
    try {
      say(`Loading ${demo.label}: ${entry.name}…`);
      const response = await fetch(entry.path);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      await manager.importFileList([new File([blob], entry.name, { type: "image/tiff" })]);
      loaded += 1;
    } catch (error) {
      // One unreachable file must not stop the others.
      console.warn(`[GeoID demo] ${entry.name} did not load:`, error.message);
    }
  }
  if (!loaded) {
    say(`${demo.label} is already loaded.`);
    return demo;
  }
  // Framed more than once, on purpose: the viewer runs its own opening move
  // after boot, and a camera set during it is quietly overridden a second
  // later — the layers were on the globe and the view was over Greenland.
  // Re-asserting costs nothing and is idempotent.
  frame(demo.view);
  [1200, 3000, 6000].forEach((delay) => setTimeout(() => frame(demo.view), delay));
  say(`${demo.label}: ${loaded} layers on the globe. ${demo.note}`);
  return demo;
}

/**
 * Fly to the demo's extent.
 *
 * One forward transform, no feedback: baseline -> spin about Y -> the viewer's
 * own `baselineToWorld`, which is the same call its focus path makes. An
 * earlier version aimed by correcting against the on-screen readout, and that
 * readout can be a cached sample — so it converged on a stale answer and the
 * picture disagreed with the number. A transform the viewer itself uses cannot
 * drift from the viewer.
 */
function frame({ lat, lon, spanDeg = 3 }) {
  const viewer = window.GeoIDViewer;
  if (!viewer?.latLonToVector3 || !viewer.camera) return;
  /**
   * Stop the globe first, and this is the whole trick.
   *
   * The camera is fixed in world space while the globe turns beneath it on
   * simulated time — which advances far faster than the clock — so a place
   * framed correctly rotates out of view within seconds. Three transforms were
   * blamed for that before the drift was: each put the camera exactly right,
   * and by the time anyone looked, Ireland had moved. Pausing is also what the
   * viewer's own pin tracking exists to avoid needing.
   *
   * The Freeze control shows the state, so this is visible and reversible
   * rather than a mystery setting.
   */
  viewer.setSpinPaused?.(true);
  const point = viewer.latLonToVector3(lat, lon, viewer.GLOBE_RADIUS);
  // Vector3 borrowed from the camera: importing three.js here would put a
  // second copy of the library on the page and break class identity.
  const yAxis = viewer.camera.position.clone().set(0, 1, 0);
  point.applyAxisAngle(yAxis, viewer.getSpinDeltaRadians?.() || 0);
  const world = viewer.baselineToWorld ? viewer.baselineToWorld(point) : point;
  const distance = viewer.GLOBE_RADIUS * Math.max(1.35, Math.min(4, 1.2 + spanDeg / 18));
  viewer.camera.position.copy(world).setLength(distance);
  viewer.controls?.target.set(0, 0, 0);
  viewer.controls?.update();
}


/**
 * One dataset on or off — what a tick box means.
 *
 * Ticking maps it and unticking takes it off the globe entirely rather than
 * hiding it, so the layer list stays a list of what is actually there. The
 * first tick also frames the region; later ones do not, because moving the
 * camera under someone who is comparing two maps is rude.
 */
export async function toggle(id, index, on) {
  const demo = DEMOS[id];
  const entry = demo?.files?.[index];
  const manager = window.GeoIDImportManager;
  if (!entry || !manager?.importFileList) return false;

  const find = () => (manager.getLayers?.() || []).find((l) => l.name === entry.name);
  if (!on) {
    const layer = find();
    if (layer && manager.removeLayer) manager.removeLayer(layer.id);
    say(`${entry.name.replace(/\.tif$/, "")} removed.`);
    return false;
  }
  if (find()) return true;
  try {
    say(`Loading ${entry.name.replace(/\.tif$/, "")}…`);
    const response = await fetch(entry.path);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await manager.importFileList([
      new File([await response.blob()], entry.name, { type: "image/tiff" }),
    ]);
  } catch (error) {
    say(`${entry.name} did not load: ${error.message}`);
    return false;
  }
  const others = (manager.getLayers?.() || [])
    .filter((l) => demo.files.some((f) => f.name === l.name)).length;
  if (others <= 1) frame(demo.view);
  say(`${entry.name.replace(/\.tif$/, "")} mapped. ${demo.note}`);
  return true;
}

export function list() {
  return Object.entries(DEMOS).map(([id, d]) => ({ id, label: d.label, note: d.note }));
}

/**
 * `?demo=ni-prototype` on either the viewer or the page framing it.
 *
 * The viewer runs in an iframe whose src carries no query of its own, so the
 * parameter is read from the parent too — same origin, so this is a read, not
 * a reach across a boundary, and it is wrapped anyway because a viewer opened
 * standalone has no parent to ask.
 */
function requestedDemo() {
  const fromHere = new URLSearchParams(window.location.search).get("demo");
  if (fromHere) return fromHere;
  try {
    if (window.parent && window.parent !== window) {
      return new URLSearchParams(window.parent.location.search).get("demo");
    }
  } catch {
    /* a cross-origin parent simply cannot be asked */
  }
  return null;
}

function init() {
  const wanted = requestedDemo();
  if (!wanted) return;
  // The import manager and the viewer both arrive asynchronously; the retry is
  // the same shape every module here uses rather than a race.
  let attempts = 0;
  const attempt = () => {
    if (window.GeoIDImportManager?.importFileList && window.GeoIDViewer?.camera) {
      void load(wanted);
      return;
    }
    if (attempts++ > 60) return;
    setTimeout(attempt, 500);
  };
  attempt();
}

if (typeof window !== "undefined") {
  window.GeoIDDemo = { load, list, toggle };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}
