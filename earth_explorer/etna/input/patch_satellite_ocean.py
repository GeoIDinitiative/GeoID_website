#!/usr/bin/env python3
"""
Patch satellite.jpg (7168×7680):
  — Replace the flat-blue ocean fallback area (x=6144–7168, y=4096–7680)
    with real Z=13 ESRI tiles from _tile_cache_z13_fallback/.
  — Feather the seam with 96-px cross-fade at top and left edges.

Z=13 tile (256×256 px) covers 4×4 Z=15 tiles in each direction.
In the 7168×7680 output (4× box-averaged from 28672×30720 raw Z=15),
each Z=15 tile → 64 px, so each Z=13 tile → 256×256 output px — no rescaling needed.

Gray-tile patch area (Z=15 coords → output px):
  columns 96–111  →  x = 6144–7168
  rows    64–119  →  y = 4096–7680
"""

import os, io
import numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS = None

SAT_PATH  = os.path.normpath(
    os.path.join(os.path.dirname(__file__),
                 '..', 'viewer', 'assets', 'satellite.jpg'))
Z13_CACHE = os.path.join(os.path.dirname(__file__), '_tile_cache_z13_fallback')

# ── Grid constants ────────────────────────────────────────────────────────────
TX0, TY0  = 17696, 12608     # Z=15 grid origin
TILE_OUT  = 64               # output px per Z=15 tile
GRAY_COL  = 96               # first gray Z=15 column (0-indexed)
GRAY_ROW  = 64               # first gray Z=15 row (0-indexed)
X_SEAM    = GRAY_COL * TILE_OUT   # 6144
Y_SEAM    = GRAY_ROW * TILE_OUT   # 4096

Z13_TX0, Z13_TX1 = 4448, 4451
Z13_TY0, Z13_TY1 = 3168, 3181
Z13_OUT   = 256              # output px per Z=13 tile (= 4 × TILE_OUT)

FEATHER_H = 96               # px — horizontal seam blend (top edge of patch)
FEATHER_V = 96               # px — vertical seam blend (left edge of patch)

# ── Load satellite ────────────────────────────────────────────────────────────
print(f'Loading satellite.jpg …')
img  = Image.open(SAT_PATH)
img.load()
arr  = np.array(img, dtype=np.float32)
print(f'  {img.size[0]}×{img.size[1]} px loaded')

# ── Save seam-reference strips BEFORE any patching ───────────────────────────
above_row = arr[Y_SEAM - 1, X_SEAM:].copy()      # (1024, 3) — row just above seam
left_col  = arr[Y_SEAM:, X_SEAM - 1].copy()      # (3584, 3) — col just left of seam

# ── Paste Z=13 tiles ─────────────────────────────────────────────────────────
print('Pasting Z=13 ocean tiles …')
placed = 0
for ty13 in range(Z13_TY0, Z13_TY1 + 1):
    for tx13 in range(Z13_TX0, Z13_TX1 + 1):
        path = os.path.join(Z13_CACHE, f'13_{tx13}_{ty13}.jpg')
        if not os.path.exists(path):
            print(f'  MISS {tx13},{ty13}')
            continue
        tile = np.array(Image.open(path).convert('RGB'), dtype=np.float32)
        # Output position: each Z=13 tile covers 4 Z=15 columns/rows = 256 output px
        x_out = (tx13 * 4 - TX0) * TILE_OUT   # = (17792..17804 - 17696)*64
        y_out = (ty13 * 4 - TY0) * TILE_OUT   # = (12672..12724 - 12608)*64
        arr[y_out:y_out + Z13_OUT, x_out:x_out + Z13_OUT] = tile
        placed += 1
print(f'  {placed} tiles placed  ({placed * Z13_OUT}×{placed * Z13_OUT // 4} px total)')

# ── Vertical feather — left edge (x = X_SEAM) ───────────────────────────────
print('Feathering vertical seam …')
for dx in range(FEATHER_V):
    x     = X_SEAM + dx
    alpha = dx / FEATHER_V                   # 0 at seam, 1 at seam+FEATHER_V
    z13   = arr[Y_SEAM:, x].copy()
    arr[Y_SEAM:, x] = (1.0 - alpha) * left_col + alpha * z13

# ── Horizontal feather — top edge (y = Y_SEAM) ───────────────────────────────
print('Feathering horizontal seam …')
for dy in range(FEATHER_H):
    y     = Y_SEAM + dy
    alpha = dy / FEATHER_H                   # 0 at seam, 1 at seam+FEATHER_H
    z13   = arr[y, X_SEAM:].copy()
    arr[y, X_SEAM:] = (1.0 - alpha) * above_row + alpha * z13

# ── Save ─────────────────────────────────────────────────────────────────────
print('Encoding JPEG …')
result = Image.fromarray(arr.clip(0, 255).astype(np.uint8))
result.save(SAT_PATH, 'JPEG', quality=88, optimize=True,
            progressive=True, subsampling=1)
size_mb = os.path.getsize(SAT_PATH) / 1e6

# Verify SE corner
se = arr[-200:, -200:].mean(axis=(0, 1))
print(f'Saved → {SAT_PATH}  ({size_mb:.1f} MB)')
print(f'SE corner: RGB({se[0]:.0f},{se[1]:.0f},{se[2]:.0f})')
print('Done.')
