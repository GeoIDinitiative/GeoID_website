#!/usr/bin/env python3
"""
Render a planet's color basemap with a lat/lon graticule and tier-1 label
markers under each plausible CRS convention. The correct convention is the
one where well-known features land on the visible terrain feature.

Usage:
    python3 check_basemap_crs.py <planet>
    e.g. python3 check_basemap_crs.py mercury

Outputs four PNGs to /tmp/crs_<planet>/, one per convention.
Conventions tested:
    A) lon east-positive, image left edge = lon 0   (center = 180)
    B) lon east-positive, image left edge = lon 180 (center = 0)   == 180-shift of A
    C) lon west-positive, image left edge = lon 0   (mirror of A)
    D) lon west-positive, image left edge = lon 180 (mirror of B)
"""
import json
import os
import sys
from PIL import Image, ImageDraw, ImageFont

ROOT = "/home/owen/GeoID_webpage/planet_explorer"


def load_font(size):
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def project(lat, lon_deg, w, h, convention):
    """Return pixel (x, y) for given lat/lon under the named convention."""
    east_positive = convention in ("A", "B")
    shift = 0.0 if convention in ("A", "C") else 180.0

    lon = lon_deg if east_positive else -lon_deg
    lon = (lon - shift) % 360.0
    x = lon / 360.0 * w
    y = (90.0 - lat) / 180.0 * h
    return x, y


def draw_graticule(draw, w, h, step=30):
    color = (0, 255, 255, 180)
    for lon in range(0, 360, step):
        x = lon / 360.0 * w
        draw.line([(x, 0), (x, h)], fill=color, width=2)
    for lat in range(-60, 90, step):
        y = (90.0 - lat) / 180.0 * h
        draw.line([(0, y), (w, y)], fill=color, width=2)


def draw_graticule_labels(draw, w, h, font, step=30):
    for lon in range(0, 360, step):
        x = lon / 360.0 * w
        draw.text((x + 4, 4), f"{lon}E", fill=(0, 255, 255, 220), font=font)
    for lat in range(-60, 90, step):
        y = (90.0 - lat) / 180.0 * h
        draw.text((4, y + 2), f"{lat:+d}", fill=(0, 255, 255, 220), font=font)


def draw_marker(draw, x, y, name, lat, lon, font):
    r = 12
    draw.ellipse([x - r, y - r, x + r, y + r], outline=(255, 60, 60), width=4)
    draw.ellipse([x - 3, y - 3, x + 3, y + 3], fill=(255, 60, 60))
    label = f"{name}\n({lat:+.1f}, {lon:.1f}E)"
    draw.multiline_text((x, y + r + 4), label, fill=(255, 255, 255), font=font,
                        anchor="ma", align="center",
                        stroke_width=3, stroke_fill=(0, 0, 0))


def render(planet):
    viewer = os.path.join(ROOT, planet, "viewer")
    # Find the default base layer color image via mercury-manifest pattern,
    # but fall back to common paths.
    candidates = [
        os.path.join(viewer, "assets", f"{planet}_color.jpg"),
        os.path.join(viewer, "assets", f"{planet}_color.png"),
    ]
    img_path = next((p for p in candidates if os.path.exists(p)), None)
    if img_path is None:
        print(f"No color basemap found for {planet}. Tried: {candidates}")
        return

    labels_path = os.path.join(viewer, "label-data.json")
    with open(labels_path) as f:
        labels = json.load(f)
    tier1 = [l for l in labels if l.get("lod") == 1 and isinstance(l.get("lat"), (int, float))
             and isinstance(l.get("lon"), (int, float))]
    print(f"{planet}: {len(tier1)} tier-1 labels")
    if not tier1:
        # fall back to tier 2 if no tier 1 exists
        tier1 = [l for l in labels if l.get("lod") == 2][:25]
        print(f"  (no tier-1; using {len(tier1)} tier-2)")

    base = Image.open(img_path).convert("RGB")
    w, h = base.size
    font_lbl = load_font(max(20, w // 110))
    font_grid = load_font(max(14, w // 180))

    out_dir = os.path.join(os.getcwd(), "location_check", planet)
    os.makedirs(out_dir, exist_ok=True)

    descriptions = {
        "A": "east-positive, left edge = lon 0  (center = 180)",
        "B": "east-positive, left edge = lon 180 (center = 0)",
        "C": "west-positive, left edge = lon 0  (mirror of A)",
        "D": "west-positive, left edge = lon 180 (mirror of B)",
        "viewer_current": "AS CURRENTLY MAPPED IN VIEWER (texture_offset_x=0.5 + west-positive labels)",
    }
    for conv, desc in descriptions.items():
        if conv == "viewer_current":
            # Replicate the in-viewer effect: texture_offset_x = 0.5 shifts the
            # basemap left by half its width. Project markers using convention C.
            shift_px = w // 2
            shifted = Image.new("RGB", (w, h))
            shifted.paste(base.crop((shift_px, 0, w, h)), (0, 0))
            shifted.paste(base.crop((0, 0, shift_px, h)), (w - shift_px, 0))
            canvas = shifted
            proj_conv = "C"
        else:
            canvas = base.copy()
            proj_conv = conv
        draw = ImageDraw.Draw(canvas, "RGBA")
        draw_graticule(draw, w, h)
        draw_graticule_labels(draw, w, h, font_grid)
        for l in tier1:
            x, y = project(l["lat"], l["lon"], w, h, proj_conv)
            draw_marker(draw, x, y, l["name"], l["lat"], l["lon"], font_lbl)
        banner = f"{planet.upper()}  convention {conv}: {desc}"
        draw.rectangle([0, h - 60, w, h], fill=(0, 0, 0, 180))
        draw.text((20, h - 50), banner, fill=(255, 255, 255), font=font_lbl)
        out = os.path.join(out_dir, f"{planet}_{conv}.jpg")
        canvas.save(out, quality=82)
        print(f"  wrote {out}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: check_basemap_crs.py <planet>")
        sys.exit(1)
    for planet in sys.argv[1:]:
        render(planet)
