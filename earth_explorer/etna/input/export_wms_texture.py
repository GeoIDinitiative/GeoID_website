#!/usr/bin/env python3
"""
export_wms_texture.py

Fetches the INGV EtnaGeoMap WMS directly as RGBA tiles (transparent=true),
mosaics them, and saves a viewer-ready PNG with proper alpha transparency.

Using transparent=true gives the correct WMS alpha mask (areas with no geology
mapping are properly transparent) rather than the white-threshold heuristic.

Output: earth_explorer/etna/viewer/etna-wms-texture.png
"""

import io, time
import numpy as np
import requests
from PIL import Image
from pathlib import Path

INPUT_DIR  = Path(__file__).parent
VIEWER_DIR = INPUT_DIR.parent / 'viewer'
OUT        = VIEWER_DIR / 'etna-wms-texture.png'

WMS_BASE  = 'https://geodb.ct.ingv.it/EtnaGeoMap/wms'
LAYER     = 'EtnaGeologicalMap'
LON_W, LAT_S = 14.768301, 37.483674
LON_E, LAT_N = 15.311688, 37.916573
TILE_PX   = 4096
TILE_GRID = 2        # 2×2 = 8192×8192 effective, downsampled to 4096 for output
OUT_SIZE  = 4096


def fetch_tile_rgba(bbox, width, height):
    lon_w, lat_s, lon_e, lat_n = bbox
    params = dict(
        service='WMS', version='1.1.1', request='GetMap',
        layers=LAYER,
        bbox=f'{lon_w},{lat_s},{lon_e},{lat_n}',
        width=width, height=height,
        srs='EPSG:4326',
        format='image/png',
        transparent='true',        # proper alpha mask from the WMS server
    )
    resp = requests.get(WMS_BASE, params=params, timeout=120)
    resp.raise_for_status()
    img = Image.open(io.BytesIO(resp.content)).convert('RGBA')
    return np.array(img, dtype=np.uint8)


N    = TILE_GRID
lons = np.linspace(LON_W, LON_E, N + 1)
lats = np.linspace(LAT_S, LAT_N, N + 1)
full_w = TILE_PX * N
full_h = TILE_PX * N
mosaic = np.zeros((full_h, full_w, 4), dtype=np.uint8)   # RGBA, default transparent

t0 = time.time()
for row_i in range(N):
    lat_n_tile = lats[N - row_i]
    lat_s_tile = lats[N - row_i - 1]
    for col_i in range(N):
        lon_w_tile = lons[col_i]
        lon_e_tile = lons[col_i + 1]
        print(f'  tile [{row_i},{col_i}]: {lon_w_tile:.5f},{lat_s_tile:.5f}'
              f' → {lon_e_tile:.5f},{lat_n_tile:.5f}', flush=True)
        arr = fetch_tile_rgba((lon_w_tile, lat_s_tile, lon_e_tile, lat_n_tile), TILE_PX, TILE_PX)
        print(f'    fetched {arr.shape}  alpha non-zero: {(arr[:,:,3]>0).sum():,} px')
        y0, y1 = row_i * TILE_PX, (row_i + 1) * TILE_PX
        x0, x1 = col_i * TILE_PX, (col_i + 1) * TILE_PX
        mosaic[y0:y1, x0:x1] = arr

print(f'Mosaic: {mosaic.shape}  ({time.time()-t0:.1f}s)')

# Downsample to 4096×4096
img = Image.fromarray(mosaic, 'RGBA')
img = img.resize((OUT_SIZE, OUT_SIZE), Image.LANCZOS)

img.save(str(OUT), 'PNG', optimize=True)
kb = OUT.stat().st_size / 1024
print(f'Saved {OUT}  ({kb:.0f} KB  /  {kb/1024:.1f} MB)')
