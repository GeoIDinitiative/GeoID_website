#!/usr/bin/env python3
"""
map_moon_label_locations.py  —  Read IAU nomenclature CSVs and produce annotated
check maps for Janus and Epimetheus.

Coordinate convention (west-positive, lon=0 at image centre):
  - IAU gives coordinates as west-positive longitude (0–360°W).
  - Both textures are equirectangular with the sub-Saturn point (lon=0°W) at the
    IMAGE CENTRE.  East edge of image = 180°W = anti-Saturn point.
  - Conversion from IAU west-positive to pixel x:
        stored_lon_east = (540 - lon_w) % 360
        x = stored_lon_east / 360 * W
        y = (90 - lat) / 180 * H
  - Labels display the original west-positive value for verification.

Usage:  python3 map_moon_label_locations.py
Output: feature_maps/{moon}_annotated.jpg   (overwrites existing)
"""

import csv
import os
from PIL import Image, ImageDraw, ImageFont

Image.MAX_IMAGE_PIXELS = None

HERE    = os.path.dirname(os.path.abspath(__file__))
ASSETS  = os.path.join(HERE, "assets")
CSV_DIR = os.path.join(HERE, "moon_label_locations")
OUT_DIR = os.path.join(HERE, "feature_maps")
os.makedirs(OUT_DIR, exist_ok=True)

MOONS = {
    "Janus":      "janus_color_map.jpg",
    "Epimetheus": "epimetheus_color_map.jpg",
}


# ---------------------------------------------------------------------------
# CSV reader
# ---------------------------------------------------------------------------

def read_csv(moon_name):
    """Return list of {name, lat, lon_w} dicts from IAU nomenclature CSV."""
    path = os.path.join(CSV_DIR, moon_name.lower() + ".csv")
    features = []
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        # Header has 'Center          Longitude' with extra internal spaces; normalise.
        for row in reader:
            row = {" ".join(k.split()): v.strip() for k, v in row.items()}
            lat   = float(row["Center Latitude"])
            lon_w = float(row["Center Longitude"])
            features.append({
                "name":  row["Feature Name"],
                "lat":   lat,
                "lon_w": lon_w,
            })
    return features


# ---------------------------------------------------------------------------
# Coordinate conversion  (west-positive, centred → pixel x/y)
# ---------------------------------------------------------------------------

def latlon_to_xy(lat, lon_w, W, H):
    """Convert IAU west-positive lon (centred texture) to pixel coordinates."""
    stored_east = (540.0 - lon_w) % 360.0
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


def text_with_bg(draw, xy, text, font, fg, bg=(0, 0, 0, 180), pad=4):
    """Draw text with a dark backing rectangle."""
    lines = text.split("\n")
    line_h = max(draw.textbbox((0, 0), ln, font=font)[3] for ln in lines) + 2
    total_h = line_h * len(lines)
    max_w   = max(draw.textbbox((0, 0), ln, font=font)[2] for ln in lines)
    x, y = xy
    draw.rectangle([x - pad, y - pad, x + max_w + pad, y + total_h + pad], fill=bg)
    for i, ln in enumerate(lines):
        draw.text((x, y + i * line_h), ln, font=font, fill=fg)


def draw_grid(draw, W, H, bright, font):
    """Draw lat/lon grid every 30° with west-positive labels."""
    fg   = (255, 255, 255, 160) if bright < 128 else (0, 0, 0, 160)
    thin = max(1, W // 800)

    # Longitude lines — every 30°W; centred texture → x = (540-lon_w)%360/360*W
    for lon_w in range(0, 360, 30):
        stored = (540 - lon_w) % 360
        x = stored / 360.0 * W
        draw.line([(x, 0), (x, H)], fill=fg, width=thin)
        label = f"{lon_w}°W"
        fs = max(10, W // 80)
        fnt = load_font(fs)
        tw = draw.textbbox((0, 0), label, font=fnt)[2]
        draw.text((x - tw // 2, 4), label, font=fnt, fill=fg)

    # Latitude lines — every 30°
    for lat in range(-60, 90, 30):
        y = (90.0 - lat) / 180.0 * H
        draw.line([(0, y), (W, y)], fill=fg, width=thin)
        label = f"{lat:+d}°"
        fs = max(10, W // 80)
        fnt = load_font(fs)
        draw.text((4, y + 2), label, font=fnt, fill=fg)


def draw_features(draw, features, W, H, bright, font):
    """Plot crosshair + label for each feature."""
    dot_r    = max(6, W // 100)
    ring     = max(2, dot_r // 3)
    dot_col  = (255, 70, 30, 255)
    ring_col = (255, 255, 255, 220)
    txt_col  = (255, 240, 200, 255)
    bg_col   = (0, 0, 0, 175)

    # Slight vertical offset so stacked features (all 0,0) remain readable.
    for i, f in enumerate(features):
        x, y = latlon_to_xy(f["lat"], f["lon_w"], W, H)
        y_label = y + i * (dot_r * 2 + 4)  # stack labels vertically when coincident

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

        label = f"{f['name']}\n{f['lat']:+.2f}°,  {f['lon_w']:.2f}°W"
        lx = x + dot_r + ring + 4
        text_with_bg(draw, (lx, y_label - dot_r), label, font, txt_col, bg_col, pad=5)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def annotate_moon(moon_name, tex_filename):
    src = os.path.join(ASSETS, tex_filename)
    if not os.path.exists(src):
        print(f"  [skip] {moon_name}: texture not found ({tex_filename})")
        return

    features = read_csv(moon_name)
    print(f"  {moon_name}: {len(features)} features from CSV")
    for f in features:
        print(f"    {f['name']}: lat={f['lat']:+.2f}, lon={f['lon_w']:.2f}°W")

    img  = Image.open(src).convert("RGBA")
    W, H = img.size
    bright = sum(img.convert("L").resize((64, 32)).getdata()) / (64 * 32)

    fs_label = max(12, W // 60)
    font     = load_font(fs_label)

    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw    = ImageDraw.Draw(overlay)

    draw_grid(draw, W, H, bright, font)
    draw_features(draw, features, W, H, bright, font)

    result = Image.alpha_composite(img, overlay).convert("RGB")
    out_path = os.path.join(OUT_DIR, moon_name.lower() + "_annotated.jpg")
    result.save(out_path, "JPEG", quality=92)
    print(f"  → {os.path.relpath(out_path, HERE)}")


def main():
    for moon_name, tex_file in MOONS.items():
        print(f"\n=== {moon_name} ===")
        annotate_moon(moon_name, tex_file)
    print("\nDone.")


if __name__ == "__main__":
    main()
