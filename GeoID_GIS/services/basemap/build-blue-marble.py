#!/usr/bin/env python3
"""Give the Blue Marble basemap an ocean.

The supplied blue-marble-Aug8km.tif is NASA's *land surface* product: it has
no ocean data at all, just a flat fill of exactly (2, 5, 20) across 58% of the
image. On the globe that read as a black planet with continents on it.

The ocean is painted back in from the GEBCO bathymetry the viewer already
ships, so its colour follows depth -- pale over the shelves, deep navy over
the abyssal plains and trenches -- rather than being one flat blue. Land is
left exactly as supplied; only pixels matching the fill value are touched.

Re-run after replacing either input:

    python3 GeoID_GIS/services/basemap/build-blue-marble.py
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "GeoID_GIS/viewer/assets/blue-marble-Aug8km.tif"
BATHY = ROOT / "GeoID_Earth/assets/earth_elevation_sampler.png"
OUT = ROOT / "GeoID_GIS/viewer/assets/blue-marble-Aug8km.jpg"

# The flat value the land-surface product uses over the open ocean. Matched
# exactly, because it is a fill rather than a measurement.
OCEAN_FILL = (2, 5, 20)

# The fill only covers open water. Coastal and shelf seas -- the North Sea, the
# Channel, the Baltic, the Gulf -- carry real radiance instead, and it is very
# dark: luminance 6 to 20 against 27 for the fill itself. Left out of the mask
# they stayed black while the ocean around them turned blue.
#
# So those are caught by being both dark and below sea level. The threshold has
# a lot of room: the darkest land in the image is Congo rainforest at 84, and
# the Netherlands -- the case that would suffer from a bathymetry-only test --
# reads 123 and sits at +4 m, so it stays land either way. Anything bright over
# water, such as sea ice, is water that should keep the colour it was measured
# with, and does.
WATER_LUMA_MAX = 60
WATER_DEPTH_MIN_M = 5

# How the sampler packs metres, from the viewer's manifest.
ELEV_MIN_M, ELEV_MAX_M = -10930.0, 8627.0

# Depth in metres -> colour. Stops crowd the surface because that is where the
# interesting structure is: shelves, banks and margins all sit above 200 m,
# while everything below 3000 m is featureless deep water.
RAMP = [
    (0,     (122, 186, 214)),
    (50,    (86, 156, 198)),
    (200,   (54, 120, 178)),
    (1000,  (32, 86, 152)),
    (3000,  (18, 58, 122)),
    (6000,  (10, 36, 94)),
    (11000, (6, 24, 74)),
]


def ocean_colour(depth_m: np.ndarray) -> np.ndarray:
    """Piecewise-linear ramp over the stops above."""
    out = np.zeros(depth_m.shape + (3,), dtype=np.float32)
    stops = [d for d, _ in RAMP]
    colours = [c for _, c in RAMP]
    out[depth_m <= stops[0]] = colours[0]
    out[depth_m >= stops[-1]] = colours[-1]
    for i in range(len(RAMP) - 1):
        d0, d1 = stops[i], stops[i + 1]
        c0, c1 = np.array(colours[i], np.float32), np.array(colours[i + 1], np.float32)
        band = (depth_m > d0) & (depth_m < d1)
        if not band.any():
            continue
        t = ((depth_m[band] - d0) / (d1 - d0)).astype(np.float32)[:, None]
        out[band] = c0 + (c1 - c0) * t
    return out


def main() -> None:
    marble = Image.open(SOURCE).convert("RGB")
    width, height = marble.size
    rgb = np.asarray(marble).astype(np.uint8)

    fill = (
        (rgb[:, :, 0] == OCEAN_FILL[0])
        & (rgb[:, :, 1] == OCEAN_FILL[1])
        & (rgb[:, :, 2] == OCEAN_FILL[2])
    )

    # Bathymetry is coarser than the image; ocean colour is smooth, so a plain
    # bilinear resample is enough.
    bathy = Image.open(BATHY).convert("RGB").resize((width, height), Image.BILINEAR)
    packed = np.asarray(bathy).astype(np.float64)
    norm = (packed[:, :, 0] * 65536 + packed[:, :, 1] * 256 + packed[:, :, 2]) / 16777215.0
    metres = ELEV_MIN_M + norm * (ELEV_MAX_M - ELEV_MIN_M)

    luma = rgb.astype(np.int32).sum(axis=2)
    coastal = (metres < -WATER_DEPTH_MIN_M) & (luma < WATER_LUMA_MAX)
    water = fill | coastal
    print(f"{SOURCE.name}: {width}x{height}")
    print(f"  open-ocean fill {100 * fill.mean():.1f}%"
          f" + dark coastal water {100 * (coastal & ~fill).mean():.1f}%"
          f" = {100 * water.mean():.1f}% painted")

    # Clamped at the shoreline: where the two sources disagree about the coast,
    # a pixel the image calls water but GEBCO calls hillside becomes the
    # shallowest blue rather than reaching off the end of the ramp.
    depth = np.clip(-metres, 0.0, 11000.0)

    out = rgb.astype(np.float32)
    out[water] = ocean_colour(depth[water])
    Image.fromarray(out.astype(np.uint8)).save(OUT, quality=92, progressive=True)
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
