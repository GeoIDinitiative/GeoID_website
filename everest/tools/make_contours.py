#!/usr/bin/env python3
"""Contour overlay for the interactive maps.

Reads Mapzen terrarium elevation tiles (AWS Open Data, attribution in the
title screen credits) covering the map bounds used by both interactive maps
(B = 86.780..87.070 E, 27.880..28.120 N — the same box hud.js and the start
map project into), decodes them to a height grid, and renders a transparent
PNG of contours in that exact extent so it overlays the orthophoto 1:1.

100 m intervals; every 500 m drawn heavier and labelled. Run once:

    python3 tools/make_contours.py
"""
import io
import math
import urllib.request

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image

B = {"W": 86.780, "E": 87.070, "N": 28.120, "S": 27.880}
Z = 12
OUT = "data/khumbu_contours.png"
# Match the ortho's pixel grid so the overlay never resamples against it.
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
    x0, y0 = int(x0f), int(y0f)
    x1, y1 = int(x1f), int(y1f)
    nx, ny = x1 - x0 + 1, y1 - y0 + 1
    grid = np.zeros((ny * 256, nx * 256))
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            grid[(ty - y0) * 256:(ty - y0 + 1) * 256,
                 (tx - x0) * 256:(tx - x0 + 1) * 256] = fetch(Z, tx, ty)
            print(f"tile {tx},{ty} ok")

    # Crop the mosaic to B exactly (fractional tile coordinates -> pixels).
    px0 = (x0f - x0) * 256
    px1 = ((x1f - x0)) * 256
    py0 = (y0f - y0) * 256
    py1 = ((y1f - y0)) * 256
    ix0, ix1 = int(round(px0)), int(round(px1))
    iy0, iy1 = int(round(py0)), int(round(py1))
    crop = grid[iy0:iy1, ix0:ix1]
    print("grid", crop.shape, "range", crop.min(), crop.max())

    fig = plt.figure(figsize=(OUT_W / 100, OUT_H / 100), dpi=100)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_axis_off()
    ax.invert_yaxis()
    levels_minor = np.arange(3000, 9000, 100)
    levels_major = np.arange(3000, 9000, 500)
    ax.contour(crop, levels=levels_minor, colors=[(0.42, 0.26, 0.10)],
               linewidths=0.55, alpha=0.55)
    cs = ax.contour(crop, levels=levels_major, colors=[(0.35, 0.20, 0.06)],
                    linewidths=1.25, alpha=0.8)
    labels = ax.clabel(cs, inline=True, fontsize=11, fmt="%d")
    for t in labels:
        t.set_color((0.28, 0.15, 0.04))
    ax.set_xlim(0, crop.shape[1])
    ax.set_ylim(crop.shape[0], 0)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", transparent=True, dpi=100)
    buf.seek(0)
    img = Image.open(buf).resize((OUT_W, OUT_H), Image.LANCZOS)
    img.save(OUT)
    print("wrote", OUT, img.size)


if __name__ == "__main__":
    main()
