#!/usr/bin/env python3
"""
Replace the gray ESRI Z=14 tiles (no-data, Ionian Sea) with Z=13 tiles
that have real satellite ocean imagery.

Confirmed gray range: TX 8896-8903, TY 6336-6363 (Z=14)
Corresponding Z=13:   TX 4448-4451, TY 3168-3181 (4×7 = 28 tiles)

Output satellite.jpg is 7168×7680 (2× downsampled from Z=14 raw).
  Each Z=14 tile → 128×128 px cell in output.
  Each Z=13 tile → 256×256 px region in output (covers 2×2 Z=14 cells).
"""

import os, io, time
import numpy as np
import requests
from PIL import Image

IMG_PATH  = os.path.normpath(
    os.path.join(os.path.dirname(__file__), '..', 'viewer', 'assets', 'satellite.jpg'))
CACHE_DIR = os.path.join(os.path.dirname(__file__), '_tile_cache_z13_fallback')
os.makedirs(CACHE_DIR, exist_ok=True)

Z14_TX0, Z14_TY0 = 8848, 6304
CELL14 = 128   # px per Z=14 tile in the output image

GRAY_TX14_MIN, GRAY_TX14_MAX = 8896, 8903
GRAY_TY14_MIN, GRAY_TY14_MAX = 6336, 6363

Z13_TX_MIN = GRAY_TX14_MIN // 2   # 4448
Z13_TX_MAX = GRAY_TX14_MAX // 2   # 4451
Z13_TY_MIN = GRAY_TY14_MIN // 2   # 3168
Z13_TY_MAX = GRAY_TY14_MAX // 2   # 3181
CELL13 = CELL14 * 2               # 256 px per Z=13 tile in output

ESRI_URL = ('https://server.arcgisonline.com/ArcGIS/rest/services/'
            'World_Imagery/MapServer/tile/{z}/{ty}/{tx}')
HEADERS  = {'User-Agent': 'GeoID-viewer/1.0 (academic; geoid.initiative@gmail.com)',
            'Referer': 'https://geoidinitiative.github.io/'}


def fetch_tile(tx, ty, session):
    path = os.path.join(CACHE_DIR, f'13_{tx}_{ty}.jpg')
    if os.path.exists(path):
        return Image.open(path).convert('RGB')
    url = ESRI_URL.format(z=13, tx=tx, ty=ty)
    for attempt in range(3):
        try:
            r = session.get(url, headers=HEADERS, timeout=30)
            r.raise_for_status()
            with open(path, 'wb') as f: f.write(r.content)
            time.sleep(0.08)
            img = Image.open(io.BytesIO(r.content)).convert('RGB')
            mean = np.array(img).astype(float).mean()
            print(f'  Z=13 {tx},{ty}: size={img.size}, mean={mean:.0f}')
            return img
        except Exception as e:
            if attempt == 2: raise
            time.sleep(2 ** attempt)


def main():
    print(f'[z13fix] Loading {IMG_PATH} …')
    img_orig = Image.open(IMG_PATH).convert('RGB')
    W, H = img_orig.size
    print(f'[z13fix] {W}×{H}')

    # Save original for boundary feathering BEFORE we modify
    orig = np.array(img_orig, dtype=np.float32)
    arr  = orig.copy().astype(np.uint8)

    n = (Z13_TX_MAX - Z13_TX_MIN + 1) * (Z13_TY_MAX - Z13_TY_MIN + 1)
    print(f'[z13fix] Fetching {n} Z=13 tiles …')

    session = requests.Session()
    for ty13 in range(Z13_TY_MIN, Z13_TY_MAX + 1):
        for tx13 in range(Z13_TX_MIN, Z13_TX_MAX + 1):
            tile = fetch_tile(tx13, ty13, session)

            # Resize to exactly 256×256 if needed
            if tile.size != (256, 256):
                tile = tile.resize((256, 256), Image.LANCZOS)

            # Output pixel position: Z=13 tile (tx13,ty13) starts at
            # Z=14 tile (tx13*2, ty13*2) → pixel (col14*CELL14, row14*CELL14)
            px = (tx13 * 2 - Z14_TX0) * CELL14
            py = (ty13 * 2 - Z14_TY0) * CELL14

            arr[py : py+CELL13, px : px+CELL13] = np.array(tile, dtype=np.uint8)

    # ── Feather: blend left boundary (transition from real Z=14 to new Z=13) ──
    FEATHER = 32   # px
    left_px  = (Z13_TX_MIN * 2 - Z14_TX0) * CELL14   # first column of replaced area
    top_py   = (Z13_TY_MIN * 2 - Z14_TY0) * CELL14
    bot_py   = (Z13_TY_MAX * 2 + 2 - Z14_TY0) * CELL14

    for dx in range(FEATHER):
        col = left_px + dx
        if col >= W: break
        alpha = dx / FEATHER   # 0=fully new tile content, 1=fully original
        row_s, row_e = top_py, min(bot_py, H)
        blended = (alpha * orig[row_s:row_e, col] +
                   (1 - alpha) * arr[row_s:row_e, col].astype(float))
        arr[row_s:row_e, col] = np.clip(blended, 0, 255).astype(np.uint8)

    # Also feather the top boundary (horizontal, where TY 6336 meets 6335)
    top_py_gray = (GRAY_TY14_MIN - Z14_TY0) * CELL14
    for dy in range(FEATHER):
        row = top_py_gray + dy
        if row >= H: break
        alpha = dy / FEATHER
        col_s = left_px
        col_e = min((Z13_TX_MAX * 2 + 2 - Z14_TX0) * CELL14, W)
        blended = (alpha * orig[row, col_s:col_e] +
                   (1 - alpha) * arr[row, col_s:col_e].astype(float))
        arr[row, col_s:col_e] = np.clip(blended, 0, 255).astype(np.uint8)

    out = Image.fromarray(arr)
    out.save(IMG_PATH, 'JPEG', quality=88, optimize=True, progressive=True)
    size_mb = os.path.getsize(IMG_PATH) / 1e6
    print(f'[z13fix] Saved → {IMG_PATH}  ({size_mb:.1f} MB)')

    # Verify corner
    check = np.array(out).astype(float)
    corner = check[H*7//8:, W*7//8:].mean(axis=(0,1))
    print(f'[z13fix] SE corner mean: RGB({corner[0]:.0f},{corner[1]:.0f},{corner[2]:.0f})')
    print('[z13fix] Done.')


if __name__ == '__main__':
    main()
