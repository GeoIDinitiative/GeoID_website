#!/usr/bin/env python3
"""
make_hillshade_slope.py
-----------------------
Produces hillshade.jpg and slope.jpg basemaps for the Etna viewer,
aligned pixel-for-pixel with the existing satellite.jpg tile grid.

Pipeline
  1. Reproject SRTM DEM → UTM Zone 33N (EPSG:32633) for metric pixel scale
  2. Run gdaldem hillshade + slope in UTM space (accurate gradients)
  3. Warp outputs back to EPSG:4326 snapped to the tile grid extent/size
  4. Apply colour-ramp to slope; render hillshade as grayscale
  5. Save as JPEG (hillshade.jpg, slope.jpg, hillshade_blend.jpg) in viewer/assets/
"""

import subprocess, sys, os, math
import numpy as np
from PIL import Image

# ── Paths ───────────────────────────────────────────────────────────────────
HERE     = os.path.dirname(os.path.abspath(__file__))
ROOT     = os.path.join(HERE, '..', 'viewer', 'assets')
SRTM_IN  = os.path.join(HERE, 'etna_srtm.tif')
WORK_DIR = os.path.join(HERE, '_hillshade_work')
os.makedirs(WORK_DIR, exist_ok=True)
os.makedirs(ROOT, exist_ok=True)

# ── Target grid (must match satellite.jpg exactly) ───────────────────────────
# Tile grid: zoom 13, X=4424-4451, Y=3152-3181  →  28×30 tiles = 7168×7680 px
SAT_Z, SAT_X0, SAT_X1, SAT_Y0, SAT_Y1 = 13, 4424, 4451, 3152, 3181
def tile_lon(tx): return tx / 2**SAT_Z * 360 - 180
def tile_lat(ty): return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * ty / 2**SAT_Z))))

GRID_LON_W = tile_lon(SAT_X0)
GRID_LON_E = tile_lon(SAT_X1 + 1)
GRID_LAT_N = tile_lat(SAT_Y0)
GRID_LAT_S = tile_lat(SAT_Y1 + 1)
GRID_W = (SAT_X1 - SAT_X0 + 1) * 256   # 7168
GRID_H = (SAT_Y1 - SAT_Y0 + 1) * 256   # 7680

print(f"Target grid: {GRID_W}×{GRID_H} px")
print(f"  LON {GRID_LON_W:.6f}° → {GRID_LON_E:.6f}°")
print(f"  LAT {GRID_LAT_S:.6f}° → {GRID_LAT_N:.6f}°")

# ── Helper: run shell command ────────────────────────────────────────────────
def run(cmd, desc=''):
    if desc: print(f"  {desc}...")
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"ERROR: {r.stderr.strip()}")
        sys.exit(1)

# ── Step 1: Reproject SRTM → UTM 33N ────────────────────────────────────────
UTM_DEM = os.path.join(WORK_DIR, 'dem_utm.tif')
run(
    f'gdalwarp -q -t_srs EPSG:32633 -r bilinear '
    f'-tr 30 30 '       # 30 m native SRTM resolution
    f'-of GTiff -co COMPRESS=DEFLATE '
    f'{SRTM_IN} {UTM_DEM}',
    'Reprojecting DEM to UTM 33N (30 m)'
)

# ── Step 2a: Hillshade in UTM space ─────────────────────────────────────────
HS_UTM = os.path.join(WORK_DIR, 'hillshade_utm.tif')
run(
    f'gdaldem hillshade '
    f'-z 1.5 '          # vertical exaggeration (1.5× emphasises Etna relief)
    f'-az 315 '         # sun azimuth: NW (standard cartographic)
    f'-alt 45 '         # sun elevation: 45°
    f'-combined '       # combined hillshading (better for complex topography)
    f'-compute_edges '  # avoid edge artefacts
    f'{UTM_DEM} {HS_UTM} -of GTiff -q',
    'Computing hillshade'
)

# ── Step 2b: Slope in UTM space ──────────────────────────────────────────────
SL_UTM = os.path.join(WORK_DIR, 'slope_utm.tif')
run(
    f'gdaldem slope '
    f'-compute_edges '
    f'{UTM_DEM} {SL_UTM} -of GTiff -q',
    'Computing slope (degrees)'
)

# ── Step 3: Warp both outputs back to EPSG:4326 at target pixel grid ─────────
def warp_to_grid(src, dst, resample='bilinear'):
    run(
        f'gdalwarp -q '
        f'-t_srs EPSG:4326 '
        f'-r {resample} '
        f'-te {GRID_LON_W} {GRID_LAT_S} {GRID_LON_E} {GRID_LAT_N} '
        f'-ts {GRID_W} {GRID_H} '
        f'-of GTiff -co COMPRESS=DEFLATE '
        f'{src} {dst}',
        f'Warping {os.path.basename(src)} → grid'
    )

HS_WGS = os.path.join(WORK_DIR, 'hillshade_wgs.tif')
SL_WGS = os.path.join(WORK_DIR, 'slope_wgs.tif')
warp_to_grid(HS_UTM, HS_WGS)
warp_to_grid(SL_UTM, SL_WGS)

# ── Step 4a: Read hillshade and export as JPEG ────────────────────────────────
print("  Rendering hillshade.jpg...")
import rasterio
with rasterio.open(HS_WGS) as src:
    hs = src.read(1).astype(np.float32)
    nodata = src.nodata

if nodata is not None:
    hs[hs == nodata] = np.nan

# gdaldem hillshade outputs 0-255 uint8; fill NaN with 128 (mid-grey)
hs = np.nan_to_num(hs, nan=128.0).clip(0, 255).astype(np.uint8)
hs_img = Image.fromarray(hs, mode='L').convert('RGB')
out_hs = os.path.join(ROOT, 'hillshade.jpg')
hs_img.save(out_hs, 'JPEG', quality=88, optimize=True)
print(f"  → {out_hs}  ({os.path.getsize(out_hs)//1024} KB)")

# ── Step 4b: Read slope and apply colour ramp ─────────────────────────────────
print("  Rendering slope.jpg...")
with rasterio.open(SL_WGS) as src:
    sl = src.read(1).astype(np.float32)
    nodata = src.nodata

if nodata is not None:
    sl[sl == nodata] = np.nan
sl = np.nan_to_num(sl, nan=0.0)

# Colour ramp: flat(0°)=dark-navy → gentle(10°)=teal → moderate(25°)=yellow → steep(45°+)=red
# Uses a 5-stop ramp normalised to 0-60° range (Etna max ~40°)
RAMP = [
    (0.00, (10,  15,  35)),   # 0° – flat, dark navy
    (0.10, (20,  80, 110)),   # 6° – gentle slopes, deep teal
    (0.25, (30, 160, 140)),   # 15° – moderate, teal-green
    (0.45, (220, 200,  50)),  # 27° – steep, yellow
    (0.70, (210,  60,  20)),  # 42° – very steep, orange-red
    (1.00, (180,  20,  20)),  # 60°+ – cliff, red
]
MAX_SLOPE = 60.0  # degrees — saturates at this value

def apply_ramp(sl_norm):
    """Vectorised linear-interpolation colour ramp on 0-1 normalised slope."""
    h, w = sl_norm.shape
    rgb = np.zeros((h, w, 3), dtype=np.float32)
    stops = [(v, np.array(c, dtype=np.float32)) for v, c in RAMP]
    for i in range(len(stops) - 1):
        v0, c0 = stops[i]
        v1, c1 = stops[i + 1]
        mask = (sl_norm >= v0) & (sl_norm < v1)
        t = np.where(mask, (sl_norm - v0) / (v1 - v0), 0.0)
        for ch in range(3):
            rgb[:, :, ch] += mask * (c0[ch] + t * (c1[ch] - c0[ch]))
    # final stop fills values >= last stop
    rgb[sl_norm >= stops[-1][0]] = stops[-1][1]
    return rgb.clip(0, 255).astype(np.uint8)

sl_norm = (sl / MAX_SLOPE).clip(0, 1)
sl_rgb  = apply_ramp(sl_norm)

# Blend a faint hillshade on top to preserve topographic texture
hs_f = hs.astype(np.float32) / 255.0
# Multiply blend at 40% weight — keeps the colour ramp dominant
sl_blended = (sl_rgb.astype(np.float32) * (0.60 + 0.40 * hs_f[:, :, np.newaxis])).clip(0, 255).astype(np.uint8)

sl_img = Image.fromarray(sl_blended, mode='RGB')
out_sl = os.path.join(ROOT, 'slope.jpg')
sl_img.save(out_sl, 'JPEG', quality=88, optimize=True)
print(f"  → {out_sl}  ({os.path.getsize(out_sl)//1024} KB)")

# ── Step 4c: Hillshade-blend over satellite (shaded relief) ─────────────────
print("  Rendering hillshade_blend.jpg (shaded-relief over satellite)...")
sat_path = os.path.join(ROOT, 'satellite.jpg')
if os.path.exists(sat_path):
    sat = np.array(Image.open(sat_path), dtype=np.float32)
    # Normalise hillshade to 0.5–1.0 range (avoid total blackout in shadow areas)
    hs_blend = 0.50 + 0.50 * (hs.astype(np.float32) / 255.0)
    blended = (sat * hs_blend[:, :, np.newaxis]).clip(0, 255).astype(np.uint8)
    Image.fromarray(blended).save(
        os.path.join(ROOT, 'hillshade_blend.jpg'), 'JPEG', quality=88, optimize=True
    )
    sz = os.path.getsize(os.path.join(ROOT, 'hillshade_blend.jpg')) // 1024
    print(f"  → hillshade_blend.jpg  ({sz} KB)")
else:
    print("  satellite.jpg not found — skipping blend")

# ── Step 5: Quick sanity stats ────────────────────────────────────────────────
print("\n── Summary ─────────────────────────────────────────────────────────────")
print(f"  Hillshade range : {hs.min()} – {hs.max()} (uint8)")
print(f"  Slope range     : {sl.min():.1f}° – {sl.max():.1f}°")
print(f"  Output size     : {GRID_W}×{GRID_H} px")
print(f"  Grid extent     : {GRID_LON_W:.4f}°–{GRID_LON_E:.4f}° lon,  {GRID_LAT_S:.4f}°–{GRID_LAT_N:.4f}° lat")
print("Done.\n")
