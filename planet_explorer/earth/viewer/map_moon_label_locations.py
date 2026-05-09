#!/usr/bin/env python3
"""
map_moon_label_locations.py  —  Read IAU Moon nomenclature CSV and produce an
annotated check map for the Moon texture.

Coordinate convention (east-positive, lon=0 at image centre):
  - IAU gives Moon coordinates as signed east-positive longitude (−180 to +180°E).
  - The texture is equirectangular with the sub-Earth point (lon=0°E) at the
    IMAGE CENTRE.  Left edge = −180°E (= far side); right edge = +180°E (far side).
  - Pixel mapping:
        x = (lon_e + 180) / 360 * W
        y = (90 − lat) / 180 * H
  - Labels display west-positive for consistency with the wider project convention:
        lon_w = (−lon_e) % 360

Filtering:
  - Satellite features (e.g. "Abbe H") are excluded.
  - All remaining features are plotted as small dots.
  - Features with diameter ≥ LABEL_MIN_KM are labelled.
  - Features with diameter = 0 (unconfirmed size) are plotted but not labelled
    unless they are in the ALWAYS_LABEL set.

Usage:  python3 map_moon_label_locations.py
Output: feature_maps/moon_annotated.jpg
"""

import csv
import os
from PIL import Image, ImageDraw, ImageFont

Image.MAX_IMAGE_PIXELS = None

HERE    = os.path.dirname(os.path.abspath(__file__))
ASSETS  = os.path.join(HERE, "assets")
CSV_DIR = os.path.join(HERE, "moon_location_labels")
OUT_DIR = os.path.join(HERE, "feature_maps")
os.makedirs(OUT_DIR, exist_ok=True)

TEXTURE_FILE = "moon_texture_1024.jpg"
OUTPUT_FILE  = os.path.join(OUT_DIR, "moon_annotated.jpg")

# Upscale the output so labels are legible despite the modest source texture.
OUTPUT_WIDTH  = 4096
OUTPUT_HEIGHT = 2048

# Label features with confirmed diameter >= this threshold (km).
LABEL_MIN_KM  = 100

# Always label these regardless of diameter (the current viewer feature set).
ALWAYS_LABEL = {
    "Tycho",
    "Mare Tranquillitatis",
    "Mare Imbrium",
    "Oceanus Procellarum",
    "South Pole-Aitken Basin",
    "Copernicus",
    "Shackleton",
    "Aristarchus",
}


# ---------------------------------------------------------------------------
# CSV reader
# ---------------------------------------------------------------------------

def read_csv():
    """Return list of feature dicts from IAU Moon nomenclature CSV."""
    path = os.path.join(CSV_DIR, "moon.csv")
    features = []
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            row = {" ".join(k.split()): v.strip() for k, v in row.items()}
            feat_type = row.get("Feature Type", "")
            # Skip satellite sub-features (e.g. "Abbe H")
            if "Satellite" in feat_type:
                continue
            try:
                lat   = float(row["Center Latitude"])
                lon_e = float(row["Center Longitude"])
                diam  = float(row["Diameter"])
            except (ValueError, KeyError):
                continue
            features.append({
                "name":   row["Feature Name"],
                "type":   feat_type,
                "lat":    lat,
                "lon_e":  lon_e,
                "diam":   diam,
            })
    return features


# ---------------------------------------------------------------------------
# Coordinate mapping
# ---------------------------------------------------------------------------

def latlon_to_xy(lat, lon_e, W, H):
    """IAU east-positive signed lon → pixel (x, y) for a centred texture."""
    x = (lon_e + 180.0) / 360.0 * W
    y = (90.0 - lat) / 180.0 * H
    return x, y


def display_lon_w(lon_e):
    """Convert signed east-positive to west-positive 0–360 for display."""
    return (-lon_e) % 360.0


# ---------------------------------------------------------------------------
# Drawing helpers
# ---------------------------------------------------------------------------

def load_font(size):
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for p in candidates:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def text_with_bg(draw, xy, text, font, fg, bg=(0, 0, 0, 180), pad=3):
    lines = text.split("\n")
    line_h = max(draw.textbbox((0, 0), ln, font=font)[3] for ln in lines) + 2
    total_h = line_h * len(lines)
    max_w   = max(draw.textbbox((0, 0), ln, font=font)[2] for ln in lines)
    x, y = xy
    draw.rectangle([x - pad, y - pad, x + max_w + pad, y + total_h + pad], fill=bg)
    for i, ln in enumerate(lines):
        draw.text((x, y + i * line_h), ln, font=font, fill=fg)


def draw_grid(draw, W, H, font):
    """30° lat/lon grid with west-positive lon labels."""
    fg   = (255, 255, 255, 140)
    thin = max(1, W // 1200)

    for lon_e_step in range(-180, 180, 30):
        x = (lon_e_step + 180) / 360.0 * W
        draw.line([(x, 0), (x, H)], fill=fg, width=thin)
        lon_w = display_lon_w(lon_e_step)
        label = f"{int(lon_w)}°W"
        tw = draw.textbbox((0, 0), label, font=font)[2]
        draw.text((x - tw // 2, 4), label, font=font, fill=fg)

    for lat in range(-60, 90, 30):
        y = (90.0 - lat) / 180.0 * H
        draw.line([(0, y), (W, y)], fill=fg, width=thin)
        draw.text((4, y + 2), f"{lat:+d}°", font=font, fill=fg)


def draw_features(draw, features, W, H, font_label, font_small):
    """Plot all features as dots; label those meeting the threshold."""
    dot_small  = max(2, W // 600)   # unlabelled features
    dot_label  = max(4, W // 200)   # labelled features
    dot_hero   = max(6, W // 130)   # always-label (viewer) features

    col_dot    = (180, 180, 255, 200)   # faint blue — unlabelled
    col_named  = (255, 140, 50, 255)    # orange — labelled by diameter
    col_hero   = (255, 60, 60, 255)     # red — viewer feature set
    col_ring   = (255, 255, 255, 220)
    txt_col    = (255, 240, 200, 255)
    hero_col   = (255, 220, 120, 255)
    bg_col     = (0, 0, 0, 175)

    for f in features:
        x, y = latlon_to_xy(f["lat"], f["lon_e"], W, H)
        name = f["name"]
        is_hero   = name in ALWAYS_LABEL
        do_label  = is_hero or f["diam"] >= LABEL_MIN_KM

        if is_hero:
            r   = dot_hero
            col = col_hero
        elif do_label:
            r   = dot_label
            col = col_named
        else:
            r   = dot_small
            col = col_dot

        # Ring + dot
        ring = max(1, r // 3)
        draw.ellipse([(x-r-ring, y-r-ring), (x+r+ring, y+r+ring)],
                     outline=col_ring, width=ring)
        draw.ellipse([(x-r, y-r), (x+r, y+r)], fill=col)

        if do_label:
            lon_w = display_lon_w(f["lon_e"])
            diam_str = f"{f['diam']:.0f} km" if f["diam"] > 0 else "diam unknown"
            label = f"{name}\n{f['lat']:+.1f}°,  {lon_w:.1f}°W  ({diam_str})"
            fnt   = font_label if is_hero else font_small
            tcol  = hero_col if is_hero else txt_col
            text_with_bg(draw, (x + r + ring + 3, y - r), label, fnt, tcol,
                         bg_col, pad=3)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    src = os.path.join(ASSETS, TEXTURE_FILE)
    if not os.path.exists(src):
        print(f"ERROR: texture not found: {src}")
        return

    features = read_csv()
    print(f"Loaded {len(features)} non-satellite features from CSV")
    labelled = [f for f in features if f["name"] in ALWAYS_LABEL or f["diam"] >= LABEL_MIN_KM]
    print(f"  → {len(labelled)} will be labelled "
          f"({len(ALWAYS_LABEL)} viewer features + {len(labelled)-len([f for f in labelled if f['name'] in ALWAYS_LABEL])} "
          f"with diameter ≥ {LABEL_MIN_KM} km)")

    img = Image.open(src).convert("RGBA")
    img = img.resize((OUTPUT_WIDTH, OUTPUT_HEIGHT), Image.LANCZOS)
    W, H = img.size

    fs_grid  = max(14, W // 180)
    fs_label = max(12, W // 220)
    fs_small = max(10, W // 290)
    font_grid  = load_font(fs_grid)
    font_label = load_font(fs_label)
    font_small = load_font(fs_small)

    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw    = ImageDraw.Draw(overlay)

    draw_grid(draw, W, H, font_grid)
    draw_features(draw, features, W, H, font_label, font_small)

    result = Image.alpha_composite(img, overlay).convert("RGB")
    result.save(OUTPUT_FILE, "JPEG", quality=90)
    print(f"→ {os.path.relpath(OUTPUT_FILE, HERE)}")


if __name__ == "__main__":
    main()
