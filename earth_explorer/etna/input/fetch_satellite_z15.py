#!/usr/bin/env python3
"""
Fetch ESRI World Imagery tiles at Z=15 covering the Etna viewer domain,
composite and downsample to 14336×15360 px (~7 m/px), save as satellite.jpg.

Domain:  LON_W=14.433  LON_E=15.573   LAT_S=37.305  LAT_N=38.205
Z=15 range:  TX 17696–17807  (112 tiles wide)
             TY 12608–12727  (120 tiles tall)
Raw:    28 672 × 30 720 px   (112×256 × 120×256)
Output: 14 336 × 15 360 px   (2× box-averaged — lossless exact downsample)

Memory-efficient: processes one row of tiles at a time (28 672×256 strip
= ~22 MB), box-downsamples to 14 336×128, and writes the result into a
pre-allocated output array (~660 MB).  Peak RAM ≈ 700 MB.

Gray-tile fallback: ESRI returns flat RGB(205,205,205) for deep-offshore
areas with no high-res coverage.  These are replaced by the corresponding
128×128 quadrant of the cached Z=14 tile (from _tile_cache_z14/), upscaled
2× to fill the 256×256 Z=15 slot.

Run time: ~13 440 tiles × 80 ms ≈ 18 min first run; instant thereafter
(tiles are cached in _tile_cache_z15/).
"""

import os, io, time
import numpy as np
import requests
from PIL import Image

# ── Paths ─────────────────────────────────────────────────────────────────────
BASE      = os.path.dirname(os.path.abspath(__file__))
OUT_PATH  = os.path.normpath(os.path.join(BASE, '..', 'viewer', 'assets', 'satellite.jpg'))
CACHE_Z15 = os.path.join(BASE, '_tile_cache_z15')
CACHE_Z14 = os.path.join(BASE, '_tile_cache_z14')
os.makedirs(CACHE_Z15, exist_ok=True)

# ── Grid constants ────────────────────────────────────────────────────────────
Z   = 15
TX0, TX1 = 17696, 17807   # 112 columns
TY0, TY1 = 12608, 12727   # 120 rows
PX  = 256                 # px per tile
COLS = TX1 - TX0 + 1      # 112
ROWS = TY1 - TY0 + 1      # 120
OUT_W = COLS * PX // 2    # 14 336
OUT_H = ROWS * PX // 2    # 15 360

ESRI = ('https://server.arcgisonline.com/ArcGIS/rest/services/'
        'World_Imagery/MapServer/tile/{z}/{ty}/{tx}')
HDR  = {'User-Agent': 'GeoID-viewer/1.0 (academic; geoid.initiative@gmail.com)',
        'Referer': 'https://geoidinitiative.github.io/'}
DELAY = 0.08   # s


# ── Helpers ───────────────────────────────────────────────────────────────────
def is_gray(arr):
    f = arr.astype(np.float32).mean(axis=(0, 1))
    return f.mean() > 155 and (f.max() - f.min()) < 20


def load_jpg(path):
    with open(path, 'rb') as f:
        return np.array(Image.open(io.BytesIO(f.read())).convert('RGB'), dtype=np.uint8)


def fetch(tx, ty, session):
    path = os.path.join(CACHE_Z15, f'15_{tx}_{ty}.jpg')
    if os.path.exists(path):
        return load_jpg(path)
    url = ESRI.format(z=Z, tx=tx, ty=ty)
    for attempt in range(3):
        try:
            r = session.get(url, headers=HDR, timeout=30)
            r.raise_for_status()
            with open(path, 'wb') as f: f.write(r.content)
            time.sleep(DELAY)
            return load_jpg(path)
        except Exception as e:
            if attempt == 2:
                print(f'  ERR {tx},{ty}: {e}')
                return None
            time.sleep(2 ** attempt)


def z14_fallback(tx15, ty15):
    """128×128 quadrant of the Z=14 parent tile, upscaled to 256×256."""
    tx14, ty14 = tx15 // 2, ty15 // 2
    path = os.path.join(CACHE_Z14, f'14_{tx14}_{ty14}.jpg')
    if not os.path.exists(path):
        return np.full((PX, PX, 3), [9, 25, 38], dtype=np.uint8)  # deep ocean fallback
    parent = load_jpg(path)
    qx, qy = tx15 % 2, ty15 % 2
    crop = parent[qy*128:(qy+1)*128, qx*128:(qx+1)*128]
    return np.array(Image.fromarray(crop).resize((PX, PX), Image.BILINEAR), dtype=np.uint8)


def box2x(strip):
    """Exact 2× box-average downsample: (H, W, 3) → (H//2, W//2, 3)."""
    H, W = strip.shape[:2]
    s = strip.astype(np.uint16)
    return ((s[0::2, 0::2] + s[0::2, 1::2] + s[1::2, 0::2] + s[1::2, 1::2]) >> 2
            ).astype(np.uint8)


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    cached = sum(1 for tx in range(TX0, TX1+1) for ty in range(TY0, TY1+1)
                 if os.path.exists(os.path.join(CACHE_Z15, f'15_{tx}_{ty}.jpg')))
    print(f'[z15] Z={Z}  tiles={COLS*ROWS}  cached={cached}')
    print(f'[z15] Output: {OUT_W}×{OUT_H}  →  {OUT_PATH}')
    print(f'[z15] Peak RAM ≈ 700 MB')

    # Pre-allocate output array (660 MB)
    out = np.zeros((OUT_H, OUT_W, 3), dtype=np.uint8)

    session   = requests.Session()
    fetched   = gray_hits = errors = 0

    for row_i, ty in enumerate(range(TY0, TY1 + 1)):
        # Build one horizontal strip of Z=15 tiles: (256, 112*256, 3) = 22 MB
        strip = np.zeros((PX, COLS * PX, 3), dtype=np.uint8)

        for col_i, tx in enumerate(range(TX0, TX1 + 1)):
            already_cached = os.path.exists(
                os.path.join(CACHE_Z15, f'15_{tx}_{ty}.jpg'))
            arr = fetch(tx, ty, session)
            if not already_cached: fetched += 1

            if arr is None:
                errors += 1
                arr = z14_fallback(tx, ty)
            elif is_gray(arr):
                gray_hits += 1
                arr = z14_fallback(tx, ty)

            strip[:, col_i*PX:(col_i+1)*PX] = arr

        # Box-downsample strip: (256, 28672, 3) → (128, 14336, 3)
        ds = box2x(strip)
        out_row = row_i * (PX // 2)
        out[out_row:out_row + PX//2] = ds

        pct = (row_i + 1) / ROWS * 100
        print(f'  row {row_i+1:3d}/{ROWS}  ({pct:5.1f}%)  '
              f'net={fetched}  gray→z14={gray_hits}  err={errors}', flush=True)

    # ── Save as progressive JPEG ──────────────────────────────────────────────
    print(f'[z15] Encoding JPEG …')
    Image.fromarray(out).save(
        OUT_PATH, 'JPEG', quality=85, optimize=True,
        progressive=True, subsampling=1)   # 4:2:2 for sharper colour edges

    size_mb = os.path.getsize(OUT_PATH) / 1e6
    print(f'[z15] Saved → {OUT_PATH}  ({size_mb:.1f} MB)')

    se = out[OUT_H*7//8:, OUT_W*7//8:].astype(float).mean(axis=(0,1))
    print(f'[z15] SE corner: RGB({se[0]:.0f},{se[1]:.0f},{se[2]:.0f})')
    print(f'[z15] Done.  {gray_hits} gray tiles replaced with Z=14 fallback data.')


if __name__ == '__main__':
    main()
