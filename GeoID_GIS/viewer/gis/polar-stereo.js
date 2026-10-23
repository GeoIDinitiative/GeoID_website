/**
 * POLAR STEREOGRAPHIC, both ways — EPSG:3031 (Antarctica) and EPSG:3413
 * (Greenland), on WGS84.
 *
 * The ice-sheet grids arrive in the projection they were made in, and they are
 * DRAWN in it: a lattice is laid over the grid in projected metres, every
 * vertex is carried back to latitude and longitude here, and the texture is
 * the grid itself with UVs linear in x and y. So a cell lands where its
 * producer put it, nothing is resampled to lat/lon on the way, and the pole —
 * a single point in the grid and a whole row in a lat/lon raster — is just
 * another vertex.
 *
 * Snyder (1987), "Map Projections — A Working Manual", §21, the ellipsoidal
 * form with a standard parallel (variant B). Checked against PROJ and against
 * the lat/lon arrays CPOM ship inside their own files: agreement to well under
 * a millimetre on the ground (polar-stereo.test.mjs).
 */

const A = 6378137.0;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const E = Math.sqrt(E2);
const RAD = Math.PI / 180;

/**
 * The two grids this app reads. `south` is which pole the plane touches;
 * `latTs` the latitude of true scale; `lon0` the meridian that points "up"
 * (EPSG:3031: +y along 0°E; EPSG:3413: −y along 45°W).
 */
export const PROJECTIONS = {
  "EPSG:3031": { south: true, latTs: -71, lon0: 0 },
  "EPSG:3413": { south: false, latTs: 70, lon0: -45 },
};

function spec(crs) {
  const p = typeof crs === "string" ? PROJECTIONS[crs] : crs;
  if (!p) throw new Error(`unknown polar projection ${crs}`);
  return p;
}

/** Snyder 15-9, for a latitude already folded into the north frame. */
function tFor(phi) {
  const s = Math.sin(phi);
  return Math.tan(Math.PI / 4 - phi / 2) / Math.pow((1 - E * s) / (1 + E * s), E / 2);
}

/** Radius scale a·m_c / t_c, which the forward and the inverse share. */
function scaleFor(p) {
  const phiC = Math.abs(p.latTs) * RAD;
  const s = Math.sin(phiC);
  const mc = Math.cos(phiC) / Math.sqrt(1 - E2 * s * s);
  return (A * mc) / tFor(phiC);
}

/** Latitude and longitude (degrees) → projected metres { x, y }. */
export function forward(lat, lon, crs = "EPSG:3031") {
  const p = spec(crs);
  // The south-pole case is the north-pole case with latitude folded over.
  const phi = (p.south ? -lat : lat) * RAD;
  const rho = scaleFor(p) * tFor(phi);
  const dl = (lon - p.lon0) * RAD;
  const x = rho * Math.sin(dl);
  const y = p.south ? rho * Math.cos(dl) : -rho * Math.cos(dl);
  return { x, y };
}

/** Projected metres → { lat, lon } in degrees, longitude in [−180, 180]. */
export function inverse(x, y, crs = "EPSG:3031") {
  const p = spec(crs);
  const rho = Math.hypot(x, y);
  let lon = p.lon0;
  if (rho > 0) lon = p.lon0 + Math.atan2(x, p.south ? y : -y) / RAD;
  lon = ((lon + 540) % 360) - 180;
  const t = rho / scaleFor(p);
  // Snyder 7-9, iterated: five rounds take the error below 1e-12 rad, which is
  // a few nanometres; the loop stops as soon as it has converged.
  let phi = Math.PI / 2 - 2 * Math.atan(t);
  for (let i = 0; i < 8; i += 1) {
    const s = Math.sin(phi);
    const next = Math.PI / 2 - 2 * Math.atan(t * Math.pow((1 - E * s) / (1 + E * s), E / 2));
    if (Math.abs(next - phi) < 1e-13) { phi = next; break; }
    phi = next;
  }
  const lat = phi / RAD;
  return { lat: p.south ? -lat : lat, lon };
}

/**
 * THE DRAPE'S LATTICE, over a grid described the way the bake's manifest does:
 * `{ nx, ny, dx, x0, y0 }` with (x0, y0) the CENTRE of the top-left cell and
 * rows running north-up (y descending).
 *
 * The lattice spans the grid's outer EDGES, so UV (0,0) is the top-left corner
 * of the top-left cell and (1,1) the bottom-right corner of the last — the
 * same convention a texture of nx × ny texels uses, which is what makes the
 * texel under each vertex the cell under it.
 *
 * Returns typed arrays a mesh builder can use directly: lat/lon per vertex and
 * UV per vertex, row-major from the top-left, (sx + 1) × (sy + 1) of them.
 */
export function gridLattice(grid, { sx = 128, sy = 128, crs = "EPSG:3031" } = {}) {
  const { nx, ny, dx } = grid;
  const dy = grid.dy || dx;
  const left = grid.x0 - dx / 2;
  const top = grid.y0 + dy / 2;
  const width = nx * dx;
  const height = ny * dy;
  const count = (sx + 1) * (sy + 1);
  const lats = new Float64Array(count);
  const lons = new Float64Array(count);
  const uvs = new Float32Array(count * 2);
  for (let j = 0; j <= sy; j += 1) {
    const v = j / sy;
    const y = top - v * height;
    for (let i = 0; i <= sx; i += 1) {
      const u = i / sx;
      const x = left + u * width;
      const k = j * (sx + 1) + i;
      const ll = inverse(x, y, crs);
      lats[k] = ll.lat;
      lons[k] = ll.lon;
      // Three.js samples v = 0 at the BOTTOM of an image with flipY on, the
      // default for a canvas texture; v is written so row 0 is the top.
      uvs[k * 2] = u;
      uvs[k * 2 + 1] = 1 - v;
    }
  }
  return { lats, lons, uvs, sx, sy };
}

/**
 * The grid cell under a point on the ground, or null off the grid. Integer
 * row/col into a north-up band, the inverse of the lattice above.
 */
export function cellAt(grid, lat, lon, crs = "EPSG:3031") {
  const { x, y } = forward(lat, lon, crs);
  const dy = grid.dy || grid.dx;
  const col = Math.round((x - grid.x0) / grid.dx);
  const row = Math.round((grid.y0 - y) / dy);
  if (col < 0 || row < 0 || col >= grid.nx || row >= grid.ny) return null;
  return { row, col, index: row * grid.nx + col, x, y };
}

/**
 * The geographic box a polar grid covers, for the app's {west, south, east,
 * north} bookkeeping (extent pickers, zoom-to). A polar cap is not a lat/lon
 * box, so this is the honest one: every longitude, from the pole to the
 * grid's lowest-latitude corner.
 */
export function gridBounds(grid, crs = "EPSG:3031") {
  const p = spec(crs);
  const dy = grid.dy || grid.dx;
  const left = grid.x0 - grid.dx / 2;
  const top = grid.y0 + dy / 2;
  const right = left + grid.nx * grid.dx;
  const bottom = top - grid.ny * dy;
  const corners = [[left, top], [right, top], [left, bottom], [right, bottom]]
    .map(([x, y]) => inverse(x, y, crs).lat);
  return p.south
    ? { west: -180, east: 180, south: -90, north: Math.max(...corners) }
    : { west: -180, east: 180, south: Math.min(...corners), north: 90 };
}
