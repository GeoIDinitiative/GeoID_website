/**
 * THE SEABED UNDER A STUDY AREA.
 *
 * The streamed DEM is a land DEM: over the sea it reads ~0 m (measured on
 * Mapzen in the Gulf of Izmit: 0.0 m at z11–z13, −3.6 m at z9–z10 from
 * ETOPO1), so a water volume built on it has no depth. This reads a real
 * bathymetry grid for the box instead.
 *
 * THE SOURCE IS THE EMODnet BATHYMETRY WCS: keyless, CORS-open (`*`), a
 * GeoTIFF of metres (negative below sea level) at 1/16 arc-minute, ~115 m.
 * It is EMODnet's own survey compilation over the European seas (the
 * Mediterranean, Marmara, Black, Baltic and North Seas and the NE Atlantic)
 * and filled from GEBCO around them, and a pixel over land is the land. Where
 * it has nothing the answer is NaN, and the caller keeps the DEM.
 */

import { loadGeoTiffLibrary } from "./geotiff-adapter.js?v=20260920-4149ca7";

export const EMODNET_WCS = "https://ows.emodnet-bathymetry.eu/wcs";
export const BATHYMETRY_CREDIT = "EMODnet Bathymetry Consortium — EMODnet Digital Bathymetry (DTM), GEBCO elsewhere";

/** The WCS 2.0.1 GetCoverage URL for a box, padded a cell so edge nodes interpolate. */
export function emodnetUrl({ west, east, south, north }, pad = 0.01) {
  const q = [
    "SERVICE=WCS", "VERSION=2.0.1", "REQUEST=GetCoverage", "COVERAGEID=emodnet__mean",
    "FORMAT=image/tiff",
    `SUBSET=Lat(${(south - pad).toFixed(5)},${(north + pad).toFixed(5)})`,
    `SUBSET=Long(${(west - pad).toFixed(5)},${(east + pad).toFixed(5)})`,
  ];
  return `${EMODNET_WCS}?${q.join("&")}`;
}

/**
 * Bilinear read of a north-up grid; NaN off it or where a corner has no data.
 * `grid` is { values, width, height, west, east, south, north }.
 */
export function gridAt(grid, lat, lon) {
  const { values, width, height, west, east, south, north } = grid;
  const fx = ((lon - west) / (east - west)) * width - 0.5;
  const fy = ((north - lat) / (north - south)) * height - 0.5;
  if (!(fx >= -0.5 && fx <= width - 0.5 && fy >= -0.5 && fy <= height - 0.5)) return NaN;
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(fy)));
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = Math.max(0, Math.min(1, fx - x0));
  const ty = Math.max(0, Math.min(1, fy - y0));
  const v = (x, y) => values[y * width + x];
  const a = v(x0, y0); const b = v(x1, y0); const c = v(x0, y1); const d = v(x1, y1);
  if (![a, b, c, d].every(Number.isFinite)) return NaN;
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/** The bathymetry grid over a box, or null when the service has nothing there. */
export async function bathymetryGrid(box, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(emodnetUrl(box));
  if (!response.ok) return null;
  if (!/tiff/i.test(response.headers.get("content-type") || "")) return null;
  const GeoTIFF = await loadGeoTiffLibrary();
  const tiff = await GeoTIFF.fromArrayBuffer(await response.arrayBuffer());
  const image = await tiff.getImage();
  const [raster] = await image.readRasters();
  const [west, south, east, north] = image.getBoundingBox();
  const noData = Number(image.getGDALNoData?.());
  const values = Float32Array.from(raster, (v) => (
    !Number.isFinite(v) || (Number.isFinite(noData) && v === noData) || Math.abs(v) > 12000 ? NaN : v));
  if (!values.some(Number.isFinite)) return null;
  return { values, width: image.getWidth(), height: image.getHeight(), west, east, south, north, credit: BATHYMETRY_CREDIT };
}
