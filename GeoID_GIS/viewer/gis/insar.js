/**
 * WHAT A RADAR SATELLITE WOULD HAVE SEEN: a displacement field read along a
 * satellite's line of sight, and wrapped into interferogram fringes.
 *
 * A volcano deformation model is judged against InSAR, and InSAR does not
 * measure a displacement vector. It measures ONE component of it, the change
 * in range along the direction from the ground to the satellite, and it
 * measures that modulo half a wavelength. So a model's |u| and a real
 * interferogram cannot be compared by eye until the model is put through the
 * same two steps. This module is those two steps, pure.
 *
 * Frame: the mesh's x is east, y is north and z is up (east/north/up metres,
 * the frame the Model Builder writes and GALES reads). Heading is the
 * satellite's flight direction, clockwise from north; incidence is the angle
 * at the ground between the vertical and the line of sight; radar looks to
 * the RIGHT of its track unless told otherwise (Sentinel-1, ALOS-2 and
 * COSMO-SkyMed all do in their standard modes).
 *
 * Sign: positive LOS displacement is TOWARD the satellite (the range
 * shortens), so uplift is positive from either pass. Phase conventions differ
 * between processors; the fringes here count range change in half
 * wavelengths, which is what one colour cycle of a wrapped interferogram is.
 */

/** Standard acquisition geometries. Headings and incidences are typical scene-centre values; λ in metres. */
export const PLATFORMS = [
  { id: "s1-asc", label: "Sentinel-1 ascending (C-band)", heading: -12, incidence: 39, wavelength: 0.05546 },
  { id: "s1-desc", label: "Sentinel-1 descending (C-band)", heading: -168, incidence: 39, wavelength: 0.05546 },
  { id: "alos2-asc", label: "ALOS-2 ascending (L-band)", heading: -10, incidence: 36, wavelength: 0.2424 },
  { id: "alos2-desc", label: "ALOS-2 descending (L-band)", heading: -170, incidence: 36, wavelength: 0.2424 },
  { id: "csk-asc", label: "COSMO-SkyMed ascending (X-band)", heading: -10, incidence: 33, wavelength: 0.03123 },
  { id: "csk-desc", label: "COSMO-SkyMed descending (X-band)", heading: -170, incidence: 33, wavelength: 0.03123 },
];

export const DEFAULT_GEOMETRY = { platform: "s1-asc", heading: -12, incidence: 39, wavelength: 0.05546, look: "right", scale: 1 };

const RAD = Math.PI / 180;

/**
 * Unit vector from the ground to the satellite, in east/north/up.
 * Right-looking: the radar looks at heading + 90°, so the satellite sits at
 * heading − 90° as seen from the ground.
 */
export function losVector({ heading = DEFAULT_GEOMETRY.heading, incidence = DEFAULT_GEOMETRY.incidence, look = "right" } = {}) {
  const az = (heading + (look === "left" ? 90 : -90)) * RAD;
  const s = Math.sin(incidence * RAD);
  return [s * Math.sin(az), s * Math.cos(az), Math.cos(incidence * RAD)];
}

/**
 * The displacement along the line of sight at every node.
 * `values` holds nb dofs per node together; `comps` names the dofs that are
 * the x, y (and z) displacement. A 2D field has no z, and reads zero there.
 */
export function losDisplacement(values, nodeCount, nbDofs, comps, geometry) {
  const [e, n, u] = losVector(geometry);
  const w = [e, n, u];
  const out = new Float32Array(nodeCount);
  for (let i = 0; i < nodeCount; i += 1) {
    let v = 0;
    for (let a = 0; a < comps.length && a < 3; a += 1) v += values[i * nbDofs + comps[a]] * w[a];
    out[i] = v;
  }
  return out;
}

/** Fringe position in [0, 1): range change counted in half wavelengths. NaN stays NaN. */
export function wrapFringes(los, wavelength) {
  const half = wavelength / 2;
  const out = new Float32Array(los.length);
  for (let i = 0; i < los.length; i += 1) {
    const v = los[i];
    if (v !== v) { out[i] = NaN; continue; }
    const c = -v / half; // range change: positive away from the satellite
    out[i] = c - Math.floor(c);
  }
  return out;
}

/** How many fringes a range of LOS displacement makes; the count a reader would see. */
export function fringeCount(lo, hi, wavelength) {
  return Math.abs(hi - lo) / (wavelength / 2);
}

/**
 * Whether the fringes can be drawn on this mesh at all: more than one fringe
 * across a surface edge is aliased, a pattern of the mesh rather than of the
 * deformation. Answers the worst fringes-per-edge ratio over the edges given
 * as flat node pairs.
 */
export function fringesPerEdge(los, edges, wavelength) {
  const half = wavelength / 2;
  let worst = 0;
  for (let k = 0; k < edges.length; k += 2) {
    const d = Math.abs(los[edges[k]] - los[edges[k + 1]]) / half;
    if (d > worst) worst = d;
  }
  return worst;
}

/** A cyclic map for wrapped phase: one lap of the hue wheel, first stop = last stop. */
export const FRINGE_MAP = [[255, 0, 0], [255, 255, 0], [0, 255, 0], [0, 255, 255], [0, 0, 255], [255, 0, 255], [255, 0, 0]];
