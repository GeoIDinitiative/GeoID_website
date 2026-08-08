/**
 * The worlds this GIS can open, and what differs between them.
 *
 * Everything body-specific reads from here rather than assuming Earth, so
 * adding a world is a record instead of a refactor. Radii are IAU mean radii in
 * metres -- the Model page sizes its ground patch and scale bar from them, and
 * a Mars horizon drawn at Earth's radius is wrong by a factor of two.
 *
 * `group` is the name the viewer gives the object carrying the planet's tilt
 * and spin. It differs by lineage (`marsGroup` in the Mars and Saturn viewers,
 * `mercuryGroup` in Pluto's) and the seam needs it to hand the right frame to
 * the shared modules.
 *
 * `tabs.drop` lists panels that make no sense off Earth. A section that simply
 * does not exist in a viewer needs no entry -- `orderTabs()` already skips
 * missing ids -- so this is only for panels that exist but should not be shown.
 */

/** Panels that are Earth-only wherever they appear. */
const OFF_EARTH_DROP = [
  "gis-group-geoid",      // the Analysis Hub describes an Earth hazard model
  "gis-group-events",     // NASA EONET has no equivalent for other bodies
  "gis-group-modelled",   // Earth Engine
  "modelled-data-section",
];

export const BODIES = [
  {
    id: "mercury", name: "Mercury", icon: "/assets/mercury_icon.png",
    path: "/planet_explorer/mercury/viewer/",
    radiusM: 2439700, group: "mercuryGroup",
    // West-positive 0-360 with the central meridian at 180: see the Mercury
    // CRS note in CLAUDE.md. Displays carry a degrees-west suffix.
    lonConvention: "west-positive-360",
    tabs: { drop: OFF_EARTH_DROP },
  },
  {
    id: "venus", name: "Venus", icon: "/assets/venus_icon.png",
    path: "/planet_explorer/venus/viewer/",
    radiusM: 6051800, group: "venusGroup",
    lonConvention: "east-positive-360",
    tabs: { drop: OFF_EARTH_DROP },
  },
  {
    id: "earth", name: "Earth", icon: "/assets/earth_icon.png",
    path: "/GeoID_GIS/viewer/",
    radiusM: 6371000, group: "earthSceneGroup",
    lonConvention: "east-positive-360",
    // Earth is the one body that keeps everything.
    tabs: { drop: [] },
  },
  {
    id: "moon", name: "Moon", icon: "/assets/moon_icon.png",
    path: "/planet_explorer/moon/viewer/",
    radiusM: 1737400, group: "marsGroup",
    lonConvention: "east-positive-360",
    tabs: { drop: OFF_EARTH_DROP },
  },
  {
    id: "mars", name: "Mars", icon: "/assets/mars_icon.png",
    path: "/planet_explorer/mars/viewer/",
    radiusM: 3389500, group: "marsGroup",
    lonConvention: "east-positive-360",
    tabs: { drop: OFF_EARTH_DROP },
  },
  {
    id: "jupiter", name: "Jupiter", icon: "/assets/jupiter_icon.png",
    path: "/planet_explorer/jupiter/viewer/",
    radiusM: 69911000, group: "marsGroup",
    lonConvention: "west-positive-360",
    tabs: { drop: OFF_EARTH_DROP },
  },
  {
    id: "saturn", name: "Saturn", icon: "/assets/saturn_icon.png",
    path: "/planet_explorer/saturn/viewer/",
    radiusM: 58232000, group: "marsGroup",
    lonConvention: "west-positive-360",
    tabs: { drop: OFF_EARTH_DROP },
  },
  {
    id: "uranus", name: "Uranus", icon: "/assets/uranus_icon.png",
    path: "/planet_explorer/uranus/viewer/",
    radiusM: 25362000, group: "marsGroup",
    lonConvention: "east-positive-360",
    tabs: { drop: OFF_EARTH_DROP },
  },
  {
    id: "neptune", name: "Neptune", icon: "/assets/neptune_icon.png",
    path: "/planet_explorer/neptune/viewer/",
    radiusM: 24622000, group: "marsGroup",
    lonConvention: "east-positive-360",
    tabs: { drop: OFF_EARTH_DROP },
  },
  {
    id: "pluto", name: "Pluto", icon: "/assets/pluto_icon.png",
    path: "/planet_explorer/pluto/viewer/",
    radiusM: 1188300, group: "plutoGroup",
    lonConvention: "east-positive-360",
    tabs: { drop: OFF_EARTH_DROP },
  },
];

export function getBody(id) {
  return BODIES.find((b) => b.id === id) || null;
}

/**
 * Which world this page is. Taken from what the viewer declared, falling back
 * to the URL, because a planet page that has not yet declared itself should
 * still not be mistaken for Earth.
 */
export function currentBodyId() {
  const declared = window.GeoIDViewer?.bodyId || document.body?.dataset?.body;
  if (declared && getBody(declared)) return declared;
  const match = /\/planet_explorer\/([a-z]+)\//.exec(window.location.pathname);
  if (match && getBody(match[1])) return match[1];
  return "earth";
}

export function currentBody() {
  return getBody(currentBodyId());
}

export function isEarth() {
  return currentBodyId() === "earth";
}

/** Metres per scene unit, given the viewer's globe radius in scene units. */
export function metresPerUnit(body, globeRadiusUnits) {
  return body.radiusM / (globeRadiusUnits || 1);
}
