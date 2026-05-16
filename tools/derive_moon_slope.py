#!/usr/bin/env python3
"""Derive a slope basemap for the Moon from the LDEM grayscale image.

Reads:    planet_explorer/moon/viewer/assets/ldem_3_8bit.jpg
Writes:   planet_explorer/moon/viewer/assets/moon_slope.jpg (2048x1024, RGB)

Slope is computed in degrees from the horizontal, accounting for the
spherical geometry (longitude steps shrink at high latitude). A perceptual
colour ramp is applied so steep terrain reads as bright/warm against the
darker flat-mare areas.

Notes on the LDEM 8-bit JPG used here:
- Standard LDEM_3 (LOLA-derived) covers approximately -9 km to +10.7 km
  elevation. The 8-bit JPG quantises that range linearly to 0-255.
- That gives a scale of ~78 m / DN, which is the value used below.
- JPG compression introduces some smoothing — fine, since this is a
  visual basemap not a quantitative dataset.
"""
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC  = ROOT / "planet_explorer/moon/viewer/assets/ldem_3_8bit.jpg"
DST  = ROOT / "planet_explorer/moon/viewer/assets/moon_slope.jpg"

# Physical constants -----------------------------------------------------
R_MOON_M       = 1_737_400.0          # lunar mean radius, metres
ELEV_RANGE_M   = 19_700.0             # full DN→elevation span (≈-9 to +10.7 km)
M_PER_DN       = ELEV_RANGE_M / 255.0 # ~77.3 m per grey-level

# Read DEM ---------------------------------------------------------------
dem = np.array(Image.open(SRC).convert("L"), dtype=np.float64) * M_PER_DN
H, W = dem.shape                       # 512 × 1024 for the supplied asset
print(f"DEM loaded: {W}×{H}px, dtype={dem.dtype}")

# Lat/lon spacing in radians (equidistant cylindrical projection)
dlat = np.pi      / H                  # rows span -90 → +90
dlon = 2 * np.pi  / W                  # cols span -180 → 180

# Per-row latitude (centre of pixel)
lat  = (np.arange(H) + 0.5) / H * np.pi - (np.pi / 2)   # +π/2 at row 0 (north pole)
cos_lat = np.cos(lat)[:, None]
# Avoid divide-by-zero exactly at the poles
cos_lat = np.clip(cos_lat, 1e-3, None)

# Spatial gradients (metres per metre = dimensionless slope components) --
# np.gradient returns (dz/d_row, dz/d_col). Convert to metres/metre.
dz_drow, dz_dcol = np.gradient(dem)
dz_dy = dz_drow / (R_MOON_M * dlat)              # y-component (north-south)
dz_dx = dz_dcol / (R_MOON_M * dlon * cos_lat)    # x-component (east-west, latitude-corrected)

slope_rad = np.arctan(np.sqrt(dz_dx**2 + dz_dy**2))
slope_deg = np.degrees(slope_rad)
print(f"Slope range: min={slope_deg.min():.2f}°  median={np.median(slope_deg):.2f}°  p95={np.percentile(slope_deg, 95):.2f}°  max={slope_deg.max():.2f}°")

# Colour-ramp ------------------------------------------------------------
# Normalise slope to 0-1. Most lunar terrain is < 15°, so saturate above
# 25° to keep the ramp readable across the mare-vs-highlands contrast.
SLOPE_MAX = 25.0
t = np.clip(slope_deg / SLOPE_MAX, 0.0, 1.0)

# Three-stop ramp: dark navy (flat) → teal (moderate) → warm orange (steep).
# Stop colours chosen to harmonise with the GeoID Explorer accent palette.
stops = np.array([
    [0.06, 0.10, 0.18],   # 0%   — dark navy (mare flats)
    [0.18, 0.42, 0.50],   # 50%  — muted teal
    [0.95, 0.62, 0.28],   # 100% — warm orange / amber (steep)
])
# Two-segment piecewise linear interpolation
def ramp(x):
    out = np.empty(x.shape + (3,), dtype=np.float64)
    lo = x < 0.5
    s1 = x[lo] / 0.5
    s2 = (x[~lo] - 0.5) / 0.5
    out[lo]  = stops[0] * (1 - s1[:, None]) + stops[1] * s1[:, None]
    out[~lo] = stops[1] * (1 - s2[:, None]) + stops[2] * s2[:, None]
    return out

rgb = ramp(t)
rgb_u8 = np.clip(rgb * 255, 0, 255).astype(np.uint8)

# Save (resample up to 2048×1024 to match other planet slope basemaps) ---
out_img = Image.fromarray(rgb_u8)
out_img = out_img.resize((2048, 1024), Image.BICUBIC)
out_img.save(DST, "JPEG", quality=88, optimize=True)
print(f"Wrote {DST.relative_to(ROOT)} ({out_img.size[0]}×{out_img.size[1]}px)")
