#!/usr/bin/env python3
"""
Cut a high-resolution DEM into the terrarium PNG tiles the game already reads.

    python3 make_dem_tiles.py HMA_DEM8m_MOS_everest.tif ../assets/dem --max-zoom 17

WHY THIS EXISTS
    The game streams elevation from AWS terrain tiles, which top out at zoom
    15 over roughly 30 m SRTM-lineage source data. Everything the game draws
    below 30 m — every sastrugi, every crevasse lip, the shape of the Hillary
    Step — is invented, because there is nothing else there.

    NASA's High Mountain Asia 8 m DEM covers the Everest massif, is built
    from DigitalGlobe stereo pairs, and validates against ICESat-2 at 1.94 m
    RMSE. That is four times finer linearly and about sixteen times the
    information. It is the single biggest available upgrade to this game and
    it is free.

    It is NOT anonymously downloadable: NSIDC requires an Earthdata Login,
    and OpenTopography's API requires a key. So this script is the second
    half of the job — you fetch the GeoTIFF, this turns it into tiles the
    engine can already stream, and `config.js` points at them.

GET THE DATA
    1. Register for a free NASA Earthdata Login.
    2. https://nsidc.org/data/hma_dem8m_mos/versions/1
       Subset to roughly 86.75–87.05 E, 27.90–28.10 N (the massif plus a
       margin) and download the GeoTIFF.
    3. Run this script.
    4. In config.js, point ELEVATION.url at the output and raise maxZoom.

WHAT IT PRODUCES
    <out>/<z>/<x>/<y>.png, terrarium encoded — height = R*256 + G + B/256
    − 32768, in metres — which is byte-for-byte the format dem.js already
    decodes. Nothing in the engine changes except a URL.

DEPENDENCIES
    rasterio and numpy, or GDAL's gdalwarp on PATH for the reprojection step.
    Both are ordinary pip installs; neither is needed to *play* the game.
"""

import argparse
import math
import os
import sys

try:
    import numpy as np
except ImportError:
    sys.exit("needs numpy:  pip install numpy")

try:
    import rasterio
    from rasterio.warp import calculate_default_transform, reproject, Resampling
except ImportError:
    sys.exit("needs rasterio:  pip install rasterio")

from PIL import Image

TILE = 256
WEB_MERCATOR = "EPSG:3857"


def lonlat_to_tile(lon, lat, z):
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    y = (1.0 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2.0 * n
    return x, y


def tile_bounds_3857(x, y, z):
    """Web Mercator bounds of a tile, in metres."""
    n = 2 ** z
    half = 20037508.342789244
    return (
        -half + x / n * 2 * half,
        half - (y + 1) / n * 2 * half,
        -half + (x + 1) / n * 2 * half,
        half - y / n * 2 * half,
    )


def encode_terrarium(h):
    """height (metres) -> RGB, exactly as dem.js decodes it."""
    v = np.clip(h + 32768.0, 0, 65535.999)
    r = np.floor(v / 256.0)
    g = np.floor(v - r * 256.0)
    b = np.floor((v - np.floor(v)) * 256.0)
    return (r.astype(np.uint8), g.astype(np.uint8), b.astype(np.uint8))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", help="input DEM GeoTIFF (any CRS)")
    ap.add_argument("out", help="output tile directory")
    ap.add_argument("--min-zoom", type=int, default=12)
    ap.add_argument("--max-zoom", type=int, default=17,
                    help="8 m data supports z17 (1.05 m/px) without inventing detail")
    ap.add_argument("--nodata-fill", type=float, default=None,
                    help="replace nodata with this height instead of skipping the tile")
    args = ap.parse_args()

    with rasterio.open(args.src) as src:
        print(f"source: {src.width}x{src.height} {src.crs} nodata={src.nodata}")
        transform, width, height = calculate_default_transform(
            src.crs, WEB_MERCATOR, src.width, src.height, *src.bounds)
        merc = np.full((height, width), np.nan, dtype=np.float32)
        reproject(
            source=rasterio.band(src, 1),
            destination=merc,
            src_transform=src.transform, src_crs=src.crs,
            dst_transform=transform, dst_crs=WEB_MERCATOR,
            # Bilinear, not nearest: a DEM is a continuous field and nearest
            # neighbour puts 8 m stair-steps into every slope, which the
            # game's normals then turn into visible terraces.
            resampling=Resampling.bilinear,
            src_nodata=src.nodata, dst_nodata=np.nan)

    if src.nodata is not None:
        merc[merc == src.nodata] = np.nan
    valid = np.isfinite(merc)
    if not valid.any():
        sys.exit("no valid pixels after reprojection")
    print(f"mercator grid: {width}x{height}  elevation {np.nanmin(merc):.0f}..{np.nanmax(merc):.0f} m")

    left, top = transform.c, transform.f
    px, py = transform.a, transform.e          # metres per pixel (py is negative)

    written = skipped = 0
    for z in range(args.min_zoom, args.max_zoom + 1):
        # Which tiles the grid covers at this zoom.
        half = 20037508.342789244
        n = 2 ** z
        span = 2 * half / n
        x0 = int((left + half) / span)
        x1 = int((left + width * px + half) / span)
        y0 = int((half - top) / span)
        y1 = int((half - (top + height * py)) / span)

        for tx in range(x0, x1 + 1):
            for ty in range(y0, y1 + 1):
                bx0, by0, bx1, by1 = tile_bounds_3857(tx, ty, z)
                # Sample the reprojected grid on this tile's own lattice.
                xs = np.linspace(bx0, bx1, TILE, endpoint=False) + (bx1 - bx0) / TILE / 2
                ys = np.linspace(by1, by0, TILE, endpoint=False) - (by1 - by0) / TILE / 2
                cols = ((xs - left) / px).astype(np.int32)
                rows = ((ys - top) / py).astype(np.int32)
                ok_c = (cols >= 0) & (cols < width)
                ok_r = (rows >= 0) & (rows < height)
                if not ok_c.any() or not ok_r.any():
                    skipped += 1
                    continue
                grid = merc[np.clip(rows, 0, height - 1)[:, None],
                            np.clip(cols, 0, width - 1)[None, :]]
                grid[~(ok_r[:, None] & ok_c[None, :])] = np.nan

                if not np.isfinite(grid).any():
                    skipped += 1
                    continue
                if args.nodata_fill is not None:
                    grid = np.where(np.isfinite(grid), grid, args.nodata_fill)
                else:
                    # Leave gaps at the median rather than at zero: a hole
                    # encoded as 0 m is a 5 km cliff in the middle of a glacier.
                    grid = np.where(np.isfinite(grid), grid, np.nanmedian(grid))

                r, g, b = encode_terrarium(grid)
                img = Image.fromarray(np.dstack([r, g, b]), "RGB")
                d = os.path.join(args.out, str(z), str(tx))
                os.makedirs(d, exist_ok=True)
                img.save(os.path.join(d, f"{ty}.png"), optimize=True)
                written += 1
        print(f"  z{z}: {written} tiles so far")

    print(f"done — {written} tiles written, {skipped} empty")
    print()
    print("Now, in everest/game/config.js:")
    print('  ELEVATION.url = "/everest/assets/dem/{z}/{x}/{y}.png"')
    print(f"  ELEVATION.maxZoom = {args.max_zoom}")
    print("  and raise DEM_TIERS' near tier zoom to match.")


if __name__ == "__main__":
    main()
