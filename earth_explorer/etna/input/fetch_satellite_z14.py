#!/usr/bin/env python3
"""
Fetch ESRI World Imagery tiles at Z=14 covering the Etna viewer domain,
composite them, downsample to 7168×7680, and write as JPEG to
earth_explorer/etna/viewer/assets/satellite.jpg.

Domain:  LON_W=14.433  LON_E=15.573   LAT_S=37.305  LAT_N=38.205
Z=14 tile range:  X 8848–8903 (56 tiles wide)
                  Y 6304–6363 (60 tiles tall)
Raw composite:    56*256 × 60*256 = 14336 × 15360 px
Output:           7168 × 7680 px  (2× downsampled — same file size, 2× source detail)

ESRI tile URL:  https://server.arcgisonline.com/ArcGIS/rest/services/
                World_Imagery/MapServer/tile/{Z}/{TY}/{TX}
Note: ESRI tile Y=0 is at the north pole (TMS-style Y=0 = top of web mercator).
"""

import math
import os
import time
import requests
from PIL import Image
import io

# ── Constants ────────────────────────────────────────────────────────────────
Z   = 14
TX0 = 8848;  TX1 = 8903   # inclusive range → 56 tiles wide
TY0 = 6304;  TY1 = 6363   # inclusive range → 60 tiles tall

TILE_PX     = 256
RAW_W       = (TX1 - TX0 + 1) * TILE_PX   # 56 * 256 = 14336
RAW_H       = (TY1 - TY0 + 1) * TILE_PX   # 60 * 256 = 15360
OUT_W       = 7168
OUT_H       = 7680

OUT_PATH    = os.path.join(os.path.dirname(__file__),
                           '..', 'viewer', 'assets', 'satellite.jpg')
CACHE_DIR   = os.path.join(os.path.dirname(__file__), '_tile_cache_z14')

ESRI_URL    = ('https://server.arcgisonline.com/ArcGIS/rest/services/'
               'World_Imagery/MapServer/tile/{z}/{ty}/{tx}')

HEADERS     = {
    'User-Agent': 'GeoID-viewer/1.0 (academic; geoid.initiative@gmail.com)',
    'Referer':    'https://geoidinitiative.github.io/',
}

TOTAL_TILES = (TX1 - TX0 + 1) * (TY1 - TY0 + 1)   # 56 × 60 = 3360
DELAY       = 0.05    # 50 ms between requests (~3360 × 50 ms ≈ 2.8 min total)

# ── Tile cache ────────────────────────────────────────────────────────────────
os.makedirs(CACHE_DIR, exist_ok=True)

def tile_path(tx, ty):
    return os.path.join(CACHE_DIR, f'{Z}_{tx}_{ty}.jpg')

def fetch_tile(tx, ty, session, retries=3):
    path = tile_path(tx, ty)
    if os.path.exists(path):
        with open(path, 'rb') as f:
            return Image.open(io.BytesIO(f.read())).convert('RGB')
    url = ESRI_URL.format(z=Z, tx=tx, ty=ty)
    for attempt in range(retries):
        try:
            resp = session.get(url, headers=HEADERS, timeout=30)
            resp.raise_for_status()
            with open(path, 'wb') as f:
                f.write(resp.content)
            return Image.open(io.BytesIO(resp.content)).convert('RGB')
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
            else:
                raise RuntimeError(f'Failed to fetch tile {tx},{ty}: {e}')

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    # Check how many tiles are already cached
    cached = sum(1 for tx in range(TX0, TX1+1) for ty in range(TY0, TY1+1)
                 if os.path.exists(tile_path(tx, ty)))
    print(f'[satellite] Z={Z}  tiles={TOTAL_TILES}  cached={cached}  '
          f'raw={RAW_W}×{RAW_H}  out={OUT_W}×{OUT_H}')

    canvas = Image.new('RGB', (RAW_W, RAW_H))

    session = requests.Session()
    fetched = 0
    errors  = 0

    for row_i, ty in enumerate(range(TY0, TY1 + 1)):
        for col_i, tx in enumerate(range(TX0, TX1 + 1)):
            px = col_i * TILE_PX
            py = row_i * TILE_PX
            need_delay = not os.path.exists(tile_path(tx, ty))
            try:
                tile = fetch_tile(tx, ty, session)
                canvas.paste(tile, (px, py))
                if need_delay:
                    fetched += 1
                    time.sleep(DELAY)
            except RuntimeError as e:
                print(f'  ERROR: {e}')
                errors += 1
                # Leave that region blank (black)

        done = (row_i + 1) * (TX1 - TX0 + 1)
        pct  = done / TOTAL_TILES * 100
        new_cached = sum(1 for tx in range(TX0, TX1+1)
                         if os.path.exists(tile_path(tx, ty)))
        print(f'  row {row_i+1:2d}/60  ({pct:5.1f}%)  fetched={fetched}  errors={errors}',
              flush=True)

    if errors:
        print(f'[satellite] WARNING: {errors} tiles failed — output may have blank patches')

    # Downsample to target dimensions with LANCZOS (high quality)
    print(f'[satellite] Downsampling {RAW_W}×{RAW_H} → {OUT_W}×{OUT_H} …')
    out = canvas.resize((OUT_W, OUT_H), Image.LANCZOS)

    out_path = os.path.normpath(OUT_PATH)
    out.save(out_path, 'JPEG', quality=88, optimize=True, progressive=True)
    size_mb = os.path.getsize(out_path) / 1e6
    print(f'[satellite] Saved: {out_path}  ({size_mb:.1f} MB)')
    print('[satellite] Done.')

if __name__ == '__main__':
    main()
