#!/usr/bin/env python3
"""Fill the ortho's uncaptured south band with DEM hillshade.

The Sentinel-2 scene behind data/khumbu_s2_20260615.png ends ~24% short of
the map bounds' southern edge — the file's last 719 rows are black. This
composites a hypsometric-tinted hillshade (from the same Mapzen terrarium
tiles the contours use) into every near-black pixel, with a soft blend at
the seam, and writes data/khumbu_map.png for both interactive maps.

Run once, after make_contours.py's fetch logic proves the tiles reachable:

    python3 tools/make_basefill.py
"""
import io
import math
import urllib.request

import numpy as np
from PIL import Image, ImageFilter

B = {"W": 86.780, "E": 87.070, "N": 28.120, "S": 27.880}
Z = 12
SRC = "data/khumbu_s2_20260615.png"
OUT = "data/khumbu_map.png"


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

    ortho = Image.open(SRC).convert("RGB")
    W, H = ortho.size
    dem_img = Image.fromarray(dem).resize((W, H), Image.BILINEAR)
    dem = np.asarray(dem_img, dtype=np.float64)

    # Hillshade, sun from the northwest at 45° — SOFTENED: full-range
    # shading read as wet slate against the sunlit Sentinel snow, so the
    # relief term only modulates the top half of the brightness range.
    gy, gx = np.gradient(dem, 8.83)          # metres per output pixel
    slope = np.pi / 2 - np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az, alt = math.radians(315), math.radians(45)
    shade = np.sin(alt) * np.sin(slope) + np.cos(alt) * np.cos(slope) * np.cos(az - aspect)
    shade = 0.60 + 0.40 * np.clip(shade, 0, 1)

    # Hypsometric tint, biased bright: these are snowfields and lit rock.
    t = np.clip((dem - 4000) / 4000, 0, 1)
    r = 196 + t * 52
    g = 198 + t * 50
    b = 196 + t * 54
    fill = np.stack([r * shade, g * shade, b * shade], axis=-1)

    src = np.asarray(ortho, dtype=np.float64)
    lum = src.mean(axis=2)

    # Tone-match: scale the fill so its mean equals the mean of the last
    # 150 rows of real imagery — the two sides of the seam then differ in
    # texture, not in exposure.
    valid_rows = np.where(lum.mean(axis=1) > 8)[0]
    band = src[valid_rows[-160]:valid_rows[-10], :, :]
    target = band.mean(axis=(0, 1))
    current = fill.mean(axis=(0, 1))
    fill = np.clip(fill * (target / current) * 0.97, 0, 255)

    # Void mask feathered over ~90 px so the hand-off is a gradient the
    # eye reads as haze, not a horizon line.
    mask = (lum < 4).astype(np.float64)
    mask_img = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(42))
    m = np.asarray(mask_img, dtype=np.float64)[..., None] / 255
    # Blend against a source whose void is ALREADY filled, or the feather
    # zone mixes fill with the black it is trying to hide and the seam
    # reads as a grey stripe. With the hard fill underneath, the gradient
    # is imagery-to-fill all the way across.
    src2 = np.where(mask[..., None] > 0.5, fill, src)
    out = src2 * (1 - m) + fill * m
    Image.fromarray(out.astype(np.uint8)).save(OUT)
    print("wrote", OUT, ortho.size)


if __name__ == "__main__":
    main()
