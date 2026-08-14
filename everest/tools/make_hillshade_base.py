#!/usr/bin/env python3
"""Full-extent hillshade basemap for the map view.

Same DEM, same extent, same pixel grid as the contour sheet, rendered as
a hypsometric-tinted hillshade — the map view drapes this instead of the
satellite composite, with the contours over it.

    python3 tools/make_hillshade_base.py
"""
import io
import math
import urllib.request

import numpy as np
from PIL import Image

B = {"W": 86.780, "E": 87.070, "N": 28.120, "S": 27.880}
Z = 12
OUT = "data/khumbu_hillshade.png"
OUT_W, OUT_H = 3228, 3026


def tile_xy(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    r = math.radians(lat)
    y = (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n
    return x, y


def fetch(z, x, y):
    url = f"https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png"
    with urllib.request.urlopen(url, timeout=30) as r:
        img = Image.open(io.BytesIO(r.read())).convert("RGB")
    a = np.asarray(img, dtype=np.float64)
    return a[:, :, 0] * 256 + a[:, :, 1] + a[:, :, 2] / 256 - 32768


def main():
    x0f, y0f = tile_xy(B["W"], B["N"], Z)
    x1f, y1f = tile_xy(B["E"], B["S"], Z)
    x0, y0, x1, y1 = int(x0f), int(y0f), int(x1f), int(y1f)
    grid = np.zeros(((y1 - y0 + 1) * 256, (x1 - x0 + 1) * 256))
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            grid[(ty - y0) * 256:(ty - y0 + 1) * 256,
                 (tx - x0) * 256:(tx - x0 + 1) * 256] = fetch(Z, tx, ty)
    ix0, iy0 = int(round((x0f - x0) * 256)), int(round((y0f - y0) * 256))
    ix1, iy1 = int(round((x1f - x0) * 256)), int(round((y1f - y0) * 256))
    dem = grid[iy0:iy1, ix0:ix1]
    dem = np.asarray(Image.fromarray(dem).resize((OUT_W, OUT_H), Image.BILINEAR), dtype=np.float64)

    gy, gx = np.gradient(dem, 8.83)
    slope = np.pi / 2 - np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az, alt = math.radians(315), math.radians(45)
    shade = np.sin(alt) * np.sin(slope) + np.cos(alt) * np.cos(slope) * np.cos(az - aspect)
    shade = 0.55 + 0.45 * np.clip(shade, 0, 1)

    # Hypsometric tint: valley grey-green, high ground toward white — the
    # same family the basefill uses, a shade cooler so contours read.
    t = np.clip((dem - 4200) / 4400, 0, 1)
    r = 188 + t * 58
    g = 192 + t * 55
    b = 192 + t * 58
    img = np.stack([r * shade, g * shade, b * shade], axis=-1)
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(OUT)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
