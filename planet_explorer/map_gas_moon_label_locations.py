#!/usr/bin/env python3
"""
map_gas_moon_label_locations.py  —  Produce annotated check maps for all gas
planet moon textures (Jupiter, Uranus, Neptune).

Coordinate convention (east-positive left-edge CRS, matching the viewers):
  - IAU CSVs give unsigned west-positive longitude (0–360°W).
  - Standard moons:
        stored_east = (360 − lon_w) % 360
        x = stored_east / 360 * W
  - TEXTURE_CENTERED moons (sub-planet at image centre):
        stored_east = (540 − lon_w) % 360
        x = stored_east / 360 * W
  - y = (90 − lat) / 180 * H   (for all moons)
  - Labels display the original west-positive value for verification.

Filtering:
  - "Satellite Feature" entries are skipped.
  - All remaining features are plotted as dots; all are labelled.

Usage:  python3 map_gas_moon_label_locations.py
Output: {planet}/viewer/feature_maps/{moon}_annotated.jpg
"""

import csv
import os
from PIL import Image, ImageDraw, ImageFont

Image.MAX_IMAGE_PIXELS = None

BASE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------------------
# Per-planet configuration
# ---------------------------------------------------------------------------
# moon_name → (texture_filename, is_texture_centered)
PLANETS = {
    "jupiter": {
        "Io":       ("io_color_map.jpg",       False),
        "Europa":   ("europa_color_map.jpg",    False),
        "Ganymede": ("ganymede_color_map.jpg",  True),
        "Callisto": ("callisto_color_map.jpg",  True),
        # Amalthea has no texture
    },
    "uranus": {
        "Ariel":    ("ariel_color_map.jpg",     False),
        "Miranda":  ("miranda_color_map.jpg",   False),
        "Umbriel":  ("umbriel_color_map.jpg",   False),
        "Titania":  ("titania_color_map.jpg",   True),
        "Oberon":   ("oberon_color_map.jpg",    True),
        # Puck has no texture
    },
    "neptune": {
        "Triton":   ("triton_color_map.jpg",    True),
    },
}

OUTPUT_WIDTH  = 2048
OUTPUT_HEIGHT = 1024

# ---------------------------------------------------------------------------
# CSV reader
# ---------------------------------------------------------------------------

def read_csv(planet_name, moon_name):
    """Return list of feature dicts from IAU CSV, skipping satellite sub-features."""
    csv_dir = os.path.join(BASE, planet_name, "viewer", "moon_label_locations")
    path    = os.path.join(csv_dir, moon_name.lower() + ".csv")
    if not os.path.exists(path):
        return []
    features = []
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            row = {" ".join(k.split()): v.strip() for k, v in row.items()}
            if row.get("Feature Type", "") == "Satellite Feature":
                continue
            try:
                lat   = float(row["Center Latitude"])
                lon_w = float(row["Center Longitude"])
            except (ValueError, KeyError):
                continue
            features.append({
                "name":  row["Feature Name"],
                "lat":   lat,
                "lon_w": lon_w,
            })
    return features


# ---------------------------------------------------------------------------
# Coordinate conversion
# ---------------------------------------------------------------------------

def latlon_to_xy(lat, lon_w, W, H, centered):
    """Convert IAU west-positive lon to viewer-storage pixel coordinates."""
    if centered:
        stored_east = (540.0 - lon_w) % 360.0
    else:
        stored_east = (360.0 - lon_w) % 360.0
    x = stored_east / 360.0 * W
    y = (90.0 - lat) / 180.0 * H
    return x, y


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
    lines  = text.split("\n")
    line_h = max(draw.textbbox((0, 0), ln, font=font)[3] for ln in lines) + 2
    max_w  = max(draw.textbbox((0, 0), ln, font=font)[2] for ln in lines)
    x, y   = xy
    draw.rectangle(
        [x - pad, y - pad, x + max_w + pad, y + line_h * len(lines) + pad],
        fill=bg,
    )
    for i, ln in enumerate(lines):
        draw.text((x, y + i * line_h), ln, font=font, fill=fg)


def draw_grid(draw, W, H, bright, centered, font):
    """30° lat/lon grid with west-positive lon labels, using the correct CRS."""
    fg   = (255, 255, 255, 150) if bright < 128 else (0, 0, 0, 150)
    thin = max(1, W // 800)
    fs   = max(10, W // 100)
    fnt  = load_font(fs)

    for lon_w in range(0, 360, 30):
        stored = (540 - lon_w) % 360 if centered else (360 - lon_w) % 360
        x = stored / 360.0 * W
        draw.line([(x, 0), (x, H)], fill=fg, width=thin)
        label = f"{lon_w}°W"
        tw = draw.textbbox((0, 0), label, font=fnt)[2]
        draw.text((x - tw // 2, 4), label, font=fnt, fill=fg)

    for lat in range(-60, 90, 30):
        y = (90.0 - lat) / 180.0 * H
        draw.line([(0, y), (W, y)], fill=fg, width=thin)
        draw.text((4, y + 2), f"{lat:+d}°", font=fnt, fill=fg)


def draw_features(draw, features, W, H, bright, centered, font):
    """Plot crosshair + label for every feature."""
    dot_r    = max(5, W // 120)
    ring     = max(2, dot_r // 3)
    dot_col  = (255, 70, 30, 255)
    ring_col = (255, 255, 255, 220)
    txt_col  = (255, 240, 200, 255)
    bg_col   = (0, 0, 0, 175)

    # Group by pixel position so coincident features stack vertically.
    from collections import defaultdict
    buckets = defaultdict(list)
    for f in features:
        px, py = latlon_to_xy(f["lat"], f["lon_w"], W, H, centered)
        key = (round(px), round(py))
        buckets[key].append((px, py, f))

    for key, items in buckets.items():
        for i, (x, y, f) in enumerate(items):
            y_label = y + i * (dot_r * 2 + 4)
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
            draw.ellipse([(x - dot_r, y - dot_r), (x + dot_r, y + dot_r)], fill=dot_col)
            label = f"{f['name']}\n{f['lat']:+.2f}°,  {f['lon_w']:.2f}°W"
            text_with_bg(
                draw, (x + dot_r + ring + 4, y_label - dot_r),
                label, font, txt_col, bg_col, pad=4,
            )


# ---------------------------------------------------------------------------
# Per-moon annotation
# ---------------------------------------------------------------------------

def annotate_moon(planet_name, moon_name, tex_filename, centered):
    src = os.path.join(BASE, planet_name, "viewer", "assets", tex_filename)
    if not os.path.exists(src):
        print(f"  [skip] {moon_name}: texture not found ({tex_filename})")
        return

    features = read_csv(planet_name, moon_name)
    if not features:
        print(f"  [skip] {moon_name}: no CSV features")
        return

    crs_label = "CENTERED" if centered else "standard"
    print(f"  {moon_name}: {len(features)} features  [{crs_label}]")

    img    = Image.open(src).convert("RGBA")
    img    = img.resize((OUTPUT_WIDTH, OUTPUT_HEIGHT), Image.LANCZOS)
    W, H   = img.size
    bright = sum(img.convert("L").resize((64, 32)).getdata()) / (64 * 32)

    fs_label = max(11, W // 100)
    font     = load_font(fs_label)

    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw    = ImageDraw.Draw(overlay)

    draw_grid(draw, W, H, bright, centered, font)
    draw_features(draw, features, W, H, bright, centered, font)

    out_dir  = os.path.join(BASE, planet_name, "viewer", "feature_maps")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, moon_name.lower() + "_annotated.jpg")
    Image.alpha_composite(img, overlay).convert("RGB").save(out_path, "JPEG", quality=92)
    print(f"  → {os.path.relpath(out_path, BASE)}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    for planet_name, moons in PLANETS.items():
        print(f"\n=== {planet_name.capitalize()} ===")
        for moon_name, (tex_file, centered) in moons.items():
            annotate_moon(planet_name, moon_name, tex_file, centered)
    print("\nDone.")


if __name__ == "__main__":
    main()
