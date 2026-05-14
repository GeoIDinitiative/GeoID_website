#!/usr/bin/env python3
"""
Annotate moon color-map textures with a lat/lon grid and feature markers.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PIPELINE COORDINATE CONVENTION  (canonical reference for all annotation work)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Texture layout
  • Equirectangular projection.
  • Prime meridian (lon = 0°W) is at the IMAGE CENTRE  (x = W/2).
    This is the sub-planet-face-centred orientation used by USGS/NASA for
    tidally-locked moons (Phobos, Deimos, and all major planetary satellites).
  • Anti-meridian (180°) sits at BOTH the left edge (x = 0) and right edge (x = W).

Source coordinates  (USGS Gazetteer CSVs)
  • Latitudes  : north-positive  (–90 … +90°).
  • Longitudes : WEST-POSITIVE   (0 … 360°W).
    Do NOT convert to east-positive before mapping — use the raw CSV value.

Pixel mapping  (the ONLY formulas to use)
  • x = ((180 − lon_W) % 360) / 360 × W     lon_W = 0°W  → x = W/2  (centre)
  • y = (90 − lat)            / 180 × H     lat   = +90° → y = 0    (top)

Grid and label convention
  • 30° lat/lon grid; thick lines at prime meridian and anti-meridian.
  • Labels west  of centre  → "°W"   (e.g. "30°W", "60°W", …)
  • Labels east  of centre  → "°E"   (e.g. "30°E", "60°E", …)
  • Prime meridian label    → "0°"
  • Anti-meridian label     → "180°"

Feature labels display the original west-positive value via lon_label().
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Outputs are written to ../feature_maps/ as JPEG files.

Usage
-----
    cd planet_explorer/mars/viewer/scripts
    python annotate_moon_maps.py

Dependencies: Pillow  (pip install Pillow)
"""

import csv
import os
from PIL import Image, ImageDraw, ImageFont

Image.MAX_IMAGE_PIXELS = None   # suppress decompression-bomb warning

# ── paths ─────────────────────────────────────────────────────────────────────

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
VIEWER_DIR = os.path.dirname(SCRIPT_DIR)
ASSETS_DIR = os.path.join(VIEWER_DIR, "assets")
CSV_DIR    = os.path.join(VIEWER_DIR, "moon_locations")
OUT_DIR    = os.path.join(VIEWER_DIR, "feature_maps")
os.makedirs(OUT_DIR, exist_ok=True)

# ── moon texture filenames ────────────────────────────────────────────────────

MOON_TEXTURES = {
    "Phobos": "phobos_color_map.jpg",
    "Deimos": "deimos_color_map.jpg",
}

MAX_OUTPUT_WIDTH = 4096

# ── CSV loading ───────────────────────────────────────────────────────────────

def load_features_from_csv(moon_name):
    """
    Load features from moon_locations/<moon>.csv.
    Returns list of {"name", "lat", "lon_w"} where lon_w is west-positive (0–360).
    The USGS Gazetteer header "Center          Longitude" contains extra spaces
    which are collapsed via split/join normalisation.
    """
    csv_path = os.path.join(CSV_DIR, f"{moon_name.lower()}.csv")
    if not os.path.exists(csv_path):
        print(f"  [warn] CSV not found: {csv_path}")
        return []

    features = []
    with open(csv_path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        # Collapse any runs of whitespace inside header names.
        reader.fieldnames = [" ".join(h.split()) for h in reader.fieldnames]
        for row in reader:
            row = {" ".join(k.split()): v.strip() for k, v in row.items() if k}
            try:
                lat   = float(row["Center Latitude"])
                lon_w = float(row["Center Longitude"]) % 360.0
            except (KeyError, ValueError):
                continue
            features.append({
                "name":  row.get("Feature Name", "?"),
                "lat":   lat,
                "lon_w": lon_w,
                "type":  row.get("Feature Type", ""),
            })
    return features

# ── coordinate helpers ────────────────────────────────────────────────────────

def lonw_to_x(lon_w, W):
    """West-positive longitude → pixel x.  lon_w=0 maps to x=W/2 (centre)."""
    return ((180.0 - lon_w) % 360.0) / 360.0 * W

def lat_to_y(lat, H):
    return (90.0 - lat) / 180.0 * H

def lon_label(lon_w):
    """Human-readable label for a west-positive longitude value."""
    lon_w = lon_w % 360
    if lon_w == 0:
        return "0°"
    if lon_w == 180:
        return "180°"
    if lon_w < 180:
        return f"{int(lon_w)}°W"
    return f"{int(360 - lon_w)}°E"   # east side of centre

# ── drawing helpers ───────────────────────────────────────────────────────────

def avg_brightness(img):
    thumb = img.convert("L").resize((128, 64), Image.LANCZOS)
    return sum(thumb.getdata()) / (128 * 64)


def load_font(size):
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "C:/Windows/Fonts/arialbd.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def text_with_bg(draw, xy, text, font, fg, bg=(0, 0, 0, 180), pad=4):
    x, y = xy
    lines = text.split("\n")
    bboxes  = [draw.textbbox((x, y), ln, font=font) for ln in lines]
    line_h  = max((b[3] - b[1]) for b in bboxes) if bboxes else 0
    total_h = line_h * len(lines) + 2 * (len(lines) - 1)
    max_w   = max((b[2] - b[0]) for b in bboxes) if bboxes else 0
    draw.rectangle((x - pad, y - pad, x + max_w + pad, y + total_h + pad), fill=bg)
    cy = y
    for ln in lines:
        draw.text((x, cy), ln, font=font, fill=fg)
        cy += line_h + 2


def draw_grid(draw, W, H, bright, font_axis):
    """
    30° lat/lon grid centred on lon=0°W (image centre).
    Prime meridian (0°W) drawn thick at x=W/2.
    Anti-meridian (180°) drawn thick at x=0 and x=W.
    Labels: °W left of centre, °E right of centre.
    """
    line_w  = max(1, W // 1400)
    thick_w = max(2, line_w * 3)
    fg = (255, 255, 255, 240) if bright < 140 else (20, 20, 20, 240)
    gl = (255, 255, 255, 100) if bright < 140 else (30, 30, 30, 90)

    # Longitude lines: iterate west-positive 0–360 in 30° steps.
    for lw in range(0, 360, 30):
        x = int(lonw_to_x(lw, W))
        w = thick_w if lw in (0, 180) else line_w
        draw.line([(x, 0), (x, H)], fill=gl, width=w)
        label = lon_label(lw)
        bbox  = draw.textbbox((0, 0), label, font=font_axis)
        tw    = bbox[2] - bbox[0]
        text_with_bg(draw, (x - tw // 2, 6), label, font_axis, fg)

    # Latitude lines
    for lat in range(90, -91, -30):
        y = int(lat_to_y(lat, H))
        w = thick_w if lat == 0 else line_w
        draw.line([(0, y), (W, y)], fill=gl, width=w)
        label = f"{lat:+d}°"
        bbox  = draw.textbbox((0, 0), label, font=font_axis)
        th    = bbox[3] - bbox[1]
        text_with_bg(draw, (6, y - th // 2), label, font_axis, fg)


def draw_features(draw, features, W, H, font_label):
    """Cross-hair marker + label for each feature. Label shows °W (CSV convention)."""
    dot_r    = max(5, W // 220)
    ring     = max(2, dot_r // 3)
    dot_col  = (255,  70,  30, 255)
    ring_col = (255, 255, 255, 220)
    txt_col  = (255, 240, 200, 255)
    bg_col   = (0,     0,   0, 175)

    for f in features:
        x = lonw_to_x(f["lon_w"], W)
        y = lat_to_y(f["lat"], H)
        arm = dot_r * 3

        draw.line([(x - arm, y), (x + arm, y)], fill=ring_col, width=ring)
        draw.line([(x, y - arm), (x, y + arm)], fill=ring_col, width=ring)
        draw.line([(x - arm, y), (x + arm, y)], fill=dot_col,  width=max(1, ring - 1))
        draw.line([(x, y - arm), (x, y + arm)], fill=dot_col,  width=max(1, ring - 1))
        draw.ellipse(
            [(x - dot_r - ring, y - dot_r - ring),
             (x + dot_r + ring, y + dot_r + ring)],
            outline=ring_col, width=ring,
        )
        draw.ellipse(
            [(x - dot_r, y - dot_r), (x + dot_r, y + dot_r)],
            fill=dot_col,
        )

        label = f"{f['name']}\n{f['lat']:+.1f}°,  {lon_label(f['lon_w'])}"
        text_with_bg(
            draw,
            (x + dot_r + ring + 4, y - dot_r),
            label, font_label, txt_col, bg_col, pad=5,
        )

# ── main ──────────────────────────────────────────────────────────────────────

def annotate_moon(moon_name, tex_filename):
    src = os.path.join(ASSETS_DIR, tex_filename)
    if not os.path.exists(src):
        print(f"  [skip] {moon_name}: texture not found ({src})")
        return

    features = load_features_from_csv(moon_name)

    img = Image.open(src).convert("RGBA")
    if img.width > MAX_OUTPUT_WIDTH:
        scale = MAX_OUTPUT_WIDTH / img.width
        img   = img.resize((MAX_OUTPUT_WIDTH, int(img.height * scale)), Image.LANCZOS)

    W, H   = img.size
    bright = avg_brightness(img)

    font_axis  = load_font(max(14, W // 57))
    font_label = load_font(max(12, W // 70))

    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw    = ImageDraw.Draw(overlay)

    draw_grid(draw, W, H, bright, font_axis)
    if features:
        draw_features(draw, features, W, H, font_label)

    result   = Image.alpha_composite(img, overlay).convert("RGB")
    out_path = os.path.join(OUT_DIR, f"{moon_name.lower()}_annotated.jpg")
    result.save(out_path, "JPEG", quality=92)

    n = len(features)
    print(f"  ✓ {moon_name:10s}  {W}×{H}  {n} feature{'s' if n != 1 else ''}  → {os.path.relpath(out_path, VIEWER_DIR)}")


if __name__ == "__main__":
    print(f"Input CSVs  : {os.path.relpath(CSV_DIR)}")
    print(f"Input assets: {os.path.relpath(ASSETS_DIR)}")
    print(f"Output dir  : {os.path.relpath(OUT_DIR)}\n")

    for moon, tex in MOON_TEXTURES.items():
        annotate_moon(moon, tex)

    print("\nDone.")
