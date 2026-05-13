#!/usr/bin/env python3
"""Convert raw Pluto TIF downloads to viewer-ready assets."""
import subprocess, sys, os
from pathlib import Path

ASSETS = Path(__file__).parent
W, H = 4096, 2048

def run(cmd, desc):
    print(f"  {desc}...", flush=True)
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  ERROR: {result.stderr[:300]}", file=sys.stderr)
        sys.exit(1)
    print(f"  Done.", flush=True)

# ── Color texture ──────────────────────────────────────────────────────────
print("1. Color texture")
run([
    "gdal_translate",
    "-of", "JPEG",
    "-outsize", str(W), str(H),
    "-scale",
    "-co", "QUALITY=90",
    str(ASSETS / "pluto_color_raw.tif"),
    str(ASSETS / "pluto_color.jpg"),
], "Resizing & converting to JPG (4096×2048)")
print(f"   -> {(ASSETS/'pluto_color.jpg').stat().st_size/1e6:.1f} MB")

# ── Elevation PNG ──────────────────────────────────────────────────────────
print("2. Elevation map")
# First get the actual min/max of the DEM
result = subprocess.run(
    ["gdalinfo", "-mm", str(ASSETS / "pluto_dem_raw.tif")],
    capture_output=True, text=True,
)
print("  DEM stats:", result.stdout[result.stdout.find("Min/Max"):result.stdout.find("Min/Max")+60])

run([
    "gdal_translate",
    "-of", "PNG",
    "-outsize", str(W), str(H),
    "-scale",    # auto-scale to 0-255 8-bit
    "-ot", "UInt16",  # keep 16-bit for precision
    str(ASSETS / "pluto_dem_raw.tif"),
    str(ASSETS / "pluto_elevation.png"),
], "Resizing & converting to 16-bit PNG (4096×2048)")
print(f"   -> {(ASSETS/'pluto_elevation.png').stat().st_size/1e6:.1f} MB")

# ── Hillshade ──────────────────────────────────────────────────────────────
print("3. Hillshade")
# First create a temp resampled DEM for gdaldem
run([
    "gdal_translate",
    "-outsize", str(W), str(H),
    str(ASSETS / "pluto_dem_raw.tif"),
    str(ASSETS / "_dem_resized.tif"),
], "Resizing DEM for hillshade")
run([
    "gdaldem", "hillshade",
    "-z", "3",          # vertical exaggeration
    "-az", "315",       # azimuth
    "-alt", "45",       # altitude
    "-compute_edges",
    str(ASSETS / "_dem_resized.tif"),
    str(ASSETS / "_hillshade_raw.tif"),
], "Computing hillshade")
run([
    "gdal_translate",
    "-of", "JPEG",
    "-co", "QUALITY=88",
    str(ASSETS / "_hillshade_raw.tif"),
    str(ASSETS / "pluto_hillshade.jpg"),
], "Converting hillshade to JPG")
print(f"   -> {(ASSETS/'pluto_hillshade.jpg').stat().st_size/1e6:.1f} MB")

# ── Slope map ──────────────────────────────────────────────────────────────
print("4. Slope map")
run([
    "gdaldem", "slope",
    "-compute_edges",
    str(ASSETS / "_dem_resized.tif"),
    str(ASSETS / "_slope_raw.tif"),
], "Computing slope")
run([
    "gdal_translate",
    "-of", "JPEG",
    "-scale", "0", "60",  # 0-60 degree range → 0-255
    "-co", "QUALITY=88",
    str(ASSETS / "_slope_raw.tif"),
    str(ASSETS / "pluto_slope.jpg"),
], "Converting slope to JPG")
print(f"   -> {(ASSETS/'pluto_slope.jpg').stat().st_size/1e6:.1f} MB")

# ── Cleanup temp files ─────────────────────────────────────────────────────
for tmp in ["_dem_resized.tif", "_hillshade_raw.tif", "_slope_raw.tif"]:
    p = ASSETS / tmp
    if p.exists():
        p.unlink()

print("\nAll assets ready.")
for f in ["pluto_color.jpg", "pluto_elevation.png", "pluto_hillshade.jpg", "pluto_slope.jpg"]:
    p = ASSETS / f
    if p.exists():
        print(f"  {f}: {p.stat().st_size/1e6:.1f} MB")
