// `?show=<feature>` on the GeoHUB's address: open the globe with that feature
// already on. The pages under /explore/ (one per tool, so a search for "live
// earthquake map" or "3D satellite tracker" lands on a page about exactly
// that) send their "Open" button here; without it the reader arrives on the
// bare globe and has to find the layer themselves.
//
// Read from the top page's address (the viewer is framed by it), as
// earth-flight-entry.js reads `?flight=`. Only the names below do anything;
// anything else in the query is ignored.

const SHOW = {
  earthquakes: () => window.GeoIDGlobalData?.addDataset?.("earthquakes"),
  volcanoes: () => window.GeoIDGlobalData?.addDataset?.("volcanoes"),
  cyclones: () => window.GeoIDGlobalData?.addDataset?.("cyclone-tracks"),
  geology: () => window.GeoIDGeology?.setActive?.(true),
  events: () => window.GeoIDEvents?.setActive?.(true, { remember: false }),
  satellites: () => {
    const box = document.getElementById("satellites-toggle");
    if (!box || box.checked) return;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
  },
};

/** The feature a link asks for, or null. */
export function requestedFeature(search) {
  try {
    const name = (new URLSearchParams(search).get("show") || "").toLowerCase();
    return Object.prototype.hasOwnProperty.call(SHOW, name) ? name : null;
  } catch (e) {
    return null;
  }
}

function topSearch() {
  try { return window.top.location.search; } catch (e) { return window.location.search; }
}

// Wait for the pieces the feature needs (the catalogue, the feed, the
// satellites' switch) -- they arrive over the first seconds -- then ask once.
const READY = {
  earthquakes: () => window.GeoIDGlobalData?.addDataset,
  volcanoes: () => window.GeoIDGlobalData?.addDataset,
  cyclones: () => window.GeoIDGlobalData?.addDataset,
  geology: () => window.GeoIDGeology?.setActive,
  events: () => window.GeoIDEvents?.setActive,
  satellites: () => document.getElementById("satellites-toggle") && window.GeoIDSatellites,
};

if (typeof window !== "undefined") {
  const feature = requestedFeature(topSearch());
  if (feature) {
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > 45000) { clearInterval(timer); return; }
      if (!window.GeoIDViewer || !READY[feature]()) return;
      clearInterval(timer);
      // A beat after the viewer is up, so the launch defaults land first and
      // the requested layer is drawn over them.
      setTimeout(() => { try { SHOW[feature](); } catch (e) { /* the layer row still offers it */ } }, 1500);
    }, 400);
  }
}
