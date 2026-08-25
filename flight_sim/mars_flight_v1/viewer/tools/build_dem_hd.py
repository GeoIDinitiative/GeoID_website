#!/usr/bin/env python3
"""Rebuild the Mars DEM as a smooth, 16-bit-precision local asset.

The shipped DEM (assets/mars_elevation_upscaled.png) is 8-bit greyscale over
29,442 m of relief, i.e. 115.5 m per level. 74% of adjacent pixels sit on the
same level, so the surface is a staircase of flat plateaus. At the vertical
exaggerations the flight sim uses (up to x10) every one of those 115 m risers
becomes a 1.1 km cliff and the terrain reads as blocky terraces.

This script reconstructs a continuous surface from the quantised data by
constrained smoothing: repeatedly blur the height field, then project every
sample back into the quantisation bin it came from. The result is the smoothest
surface that is still consistent with the source data -- no sample ever moves
further than half a level (57.8 m) from its measured height, but the staircase
is gone.

The output is written as an RG-encoded PNG (R = high byte, G = low byte). PNG's
own 16-bit mode is not usable here: browsers decode 16-bit PNGs down to 8 bits
on the <img>/ImageBitmap path, which would throw away exactly the precision we
just recovered. Two 8-bit channels survive that path losslessly.
"""

import json
import pathlib

import numpy as np
from scipy.ndimage import gaussian_filter

ASSETS = pathlib.Path(__file__).resolve().parent.parent / "assets"
SRC = ASSETS / "mars_elevation_upscaled.png"
SRC_STATS = ASSETS / "mars_elevation_upscaled_stats.json"
DST = ASSETS / "mars_elevation_hd.png"
DST_STATS = ASSETS / "mars_elevation_hd_stats.json"

ITERATIONS = 80
SIGMA = 1.1


def smooth_longitude_wrap(field, sigma):
    """Gaussian blur that wraps in longitude and reflects at the poles."""
    return gaussian_filter(field, sigma=sigma, mode=("reflect", "wrap"))


def main():
    from PIL import Image

    stats = json.loads(SRC_STATS.read_text())
    min_m, max_m = stats["min_m"], stats["max_m"]
    relief = max_m - min_m

    src = np.asarray(Image.open(SRC).convert("L")).astype(np.float64)
    h, w = src.shape
    step = 1.0 / 255.0

    # Bin each measured level: the true height was rounded to this level, so it
    # lies within half a step either side.
    lo = np.clip((src - 0.5) * step, 0.0, 1.0)
    hi = np.clip((src + 0.5) * step, 0.0, 1.0)

    x = (lo + hi) * 0.5
    for _ in range(ITERATIONS):
        x = smooth_longitude_wrap(x, SIGMA)
        np.clip(x, lo, hi, out=x)

    # Poles are a single point on the sphere; force each polar row flat so the
    # mesh does not fan out into a spike there.
    x[0, :] = x[0, :].mean()
    x[-1, :] = x[-1, :].mean()

    q = np.rint(x * 65535.0).astype(np.uint16)
    rgb = np.zeros((h, w, 3), dtype=np.uint8)
    rgb[..., 0] = (q >> 8).astype(np.uint8)
    rgb[..., 1] = (q & 0xFF).astype(np.uint8)

    Image.fromarray(rgb, mode="RGB").save(DST, optimize=True)

    orig = src * step
    residual_m = np.abs(x - orig) * relief
    flat_before = float((src[:, 1:] == src[:, :-1]).mean())
    flat_after = float((q[:, 1:] == q[:, :-1]).mean())

    out_stats = {
        "min_m": min_m,
        "max_m": max_m,
        "relief_m": relief,
        "width": w,
        "height": h,
        "encoding": "rg16",
        "quantisation_m": relief / 65535.0,
        "source": SRC.name,
        "source_quantisation_m": relief / 255.0,
        "max_residual_m": float(residual_m.max()),
        "mean_residual_m": float(residual_m.mean()),
        "flat_neighbour_fraction_before": flat_before,
        "flat_neighbour_fraction_after": flat_after,
    }
    DST_STATS.write_text(json.dumps(out_stats, indent=2) + "\n")

    print(f"wrote {DST} ({DST.stat().st_size / 1e6:.2f} MB)")
    for k, v in out_stats.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
