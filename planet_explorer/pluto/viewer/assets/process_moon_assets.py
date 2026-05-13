#!/usr/bin/env python3
"""
Generate viewer-ready moon textures for the Pluto system.

Charon
------
  Downloads the USGS New Horizons global color mosaic (300 m/px) and converts
  it to a 4096×2048 JPEG with a Charon-appropriate colorisation LUT
  (grey water-ice, dark Mordor Macula tholin polar cap).

  If the automatic download fails, place charon_color_raw.tif in this directory
  manually and re-run.  Source page:
    https://astrogeology.usgs.gov/search/map/Pluto/NewHorizons/
    Charon_NewHorizons_Global_Mosaic_300m_Oct2020

Small moons (Nix, Hydra, Styx, Kerberos)
-----------------------------------------
  New Horizons imaged these at only 2–15 px across; no global mosaic exists.
  We generate 512×256 procedural textures using each moon's known albedo,
  surface colour index, and subtle noise so the sphere looks plausible.

Coordinate convention (all moons)
----------------------------------
  Equirectangular, sub-Pluto face (0°W) at image centre (u = 0.5).
  This matches the USGS/IAU tidally-locked-moon convention and the viewer's
  moon mesh rotation (rotation.y = Math.PI at angle = 0).

Usage
-----
    cd planet_explorer/pluto/viewer/assets
    python3 process_moon_assets.py

Dependencies
------------
    Pillow          — pip install Pillow
    GDAL CLI tools  — required only for Charon (gdal_translate)
"""

import os
import random
import subprocess
import sys
from pathlib import Path

try:
    from PIL import Image, ImageFilter
except ImportError:
    sys.exit("pip install Pillow")

ASSETS = Path(__file__).parent
W, H = 4096, 2048  # Charon output size


# ── helpers ────────────────────────────────────────────────────────────────────

def run_gdal(cmd, desc):
    print(f"  {desc}...", flush=True)
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  GDAL ERROR: {result.stderr[:400]}", file=sys.stderr)
        sys.exit(1)
    print("  Done.", flush=True)


def try_download(url, dest):
    """Download url → dest via curl (handles redirects); return True on success."""
    if dest.exists():
        print(f"  [skip] {dest.name} already exists")
        return True
    print(f"  Downloading {dest.name} …", flush=True)
    result = subprocess.run(
        ["curl", "-L", "-o", str(dest), url],
        capture_output=True, text=True,
    )
    if result.returncode != 0 or not dest.exists() or dest.stat().st_size < 1000:
        print(f"  [warn] Download failed", file=sys.stderr)
        if dest.exists():
            dest.unlink()
        return False
    print(f"  -> {dest.stat().st_size / 1e6:.0f} MB", flush=True)
    return True


# ── 1. Charon ──────────────────────────────────────────────────────────────────

print("1. Charon — USGS New Horizons Global Mosaic (300 m/px)")

CHARON_RAW   = ASSETS / "charon_color_raw.tif"
CHARON_GREY  = ASSETS / "_charon_grey.png"
CHARON_COLOR = ASSETS / "charon_color.jpg"

CHARON_URL = (
    "https://planetarymaps.usgs.gov/mosaic/"
    "Charon_NewHorizons_Global_Mosaic_300m_Jul2017_8bit.tif"
)

if CHARON_COLOR.exists():
    print(f"  [skip] charon_color.jpg ({CHARON_COLOR.stat().st_size/1e6:.1f} MB)")

elif not CHARON_RAW.exists():
    ok = try_download(CHARON_URL, CHARON_RAW)
    if not ok:
        print("  Place charon_color_raw.tif in this directory and re-run.")

if CHARON_RAW.exists() and not CHARON_COLOR.exists():
    run_gdal([
        "gdal_translate",
        "-of", "PNG",
        "-outsize", str(W), str(H),
        "-scale",
        str(CHARON_RAW),
        str(CHARON_GREY),
    ], f"Resizing to {W}×{H} greyscale PNG")

    img = Image.open(CHARON_GREY).convert("L")

    # Colorise LUT:
    #   dark pixels  (tholins, Mordor Macula)  → warm reddish-brown
    #   mid pixels   (ancient impact terrain)  → brownish grey
    #   bright pixels (water-ice plains)       → cool blue-grey / near-white
    r_lut, g_lut, b_lut = [], [], []
    for i in range(256):
        t = i / 255.0
        if t < 0.35:
            blend = t / 0.35
            r = int(60  + blend * 60)
            g = int(25  + blend * 30)
            b = int(20  + blend * 25)
        elif t < 0.65:
            blend = (t - 0.35) / 0.30
            r = int(120 + blend * 55)
            g = int(115 + blend * 50)
            b = int(110 + blend * 50)
        else:
            blend = (t - 0.65) / 0.35
            r = int(175 + blend * 68)
            g = int(175 + blend * 70)
            b = int(178 + blend * 74)
        r_lut.append(r)
        g_lut.append(g)
        b_lut.append(b)

    rgb = Image.merge("RGB", [
        img.point(r_lut),
        img.point(g_lut),
        img.point(b_lut),
    ])
    rgb.save(str(CHARON_COLOR), "JPEG", quality=90)
    print(f"   -> charon_color.jpg  {CHARON_COLOR.stat().st_size / 1e6:.1f} MB")

    if CHARON_GREY.exists():
        CHARON_GREY.unlink()


# ── 2. Small moon procedural textures ─────────────────────────────────────────

print("\n2. Small moon procedural textures (512×256)")

SW, SH = 512, 256

# (base_rgb, polar_bright, warm_equator)
# Colours derived from New Horizons / Hubble albedo and colour indices.
SMALL_MOONS = {
    "nix":      ((215, 210, 208), True,  False),   # bright white-grey water ice
    "hydra":    ((200, 195, 190), True,  False),   # similar to Nix, slightly darker
    "styx":     ((188, 184, 180), False, False),   # mid grey, limited data
    "kerberos": ((140, 132, 126), False, True),    # distinctly darker; warm tint
}


def make_small_moon(name, base_rgb, polar_bright, warm_equator):
    out = ASSETS / f"{name}_color.jpg"
    if out.exists():
        print(f"  [skip] {out.name}")
        return

    rng = random.Random(hash(name) & 0xFFFF)
    br, bg, bb = base_rgb
    pixels = []

    for y in range(SH):
        lat = 90.0 - (y / (SH - 1)) * 180.0
        abs_lat = abs(lat)
        for x in range(SW):
            noise = rng.gauss(0, 0.055)
            brightness = 1.0 + noise

            if polar_bright and abs_lat > 55:
                cap = ((abs_lat - 55) / 35.0) ** 0.7
                brightness += 0.18 * cap

            r_extra = 0
            if warm_equator:
                eq = max(0.0, 1.0 - abs_lat / 40.0)
                r_extra = int(12 * eq)

            r = max(0, min(255, int(br * brightness) + r_extra))
            g = max(0, min(255, int(bg * brightness)))
            b = max(0, min(255, int(bb * brightness)))
            pixels.append((r, g, b))

    img = Image.new("RGB", (SW, SH))
    img.putdata(pixels)
    img = img.filter(ImageFilter.GaussianBlur(radius=1.5))
    img.save(str(out), "JPEG", quality=88)
    print(f"  ✓ {out.name}  ({SW}×{SH})")


for name, (rgb, pb, we) in SMALL_MOONS.items():
    make_small_moon(name, rgb, pb, we)


# ── Summary ────────────────────────────────────────────────────────────────────
print("\nMoon assets:")
for f in ["charon_color.jpg", "nix_color.jpg", "hydra_color.jpg",
          "styx_color.jpg", "kerberos_color.jpg"]:
    p = ASSETS / f
    status = f"{p.stat().st_size / 1e6:.2f} MB" if p.exists() else "MISSING"
    print(f"  {f}: {status}")
