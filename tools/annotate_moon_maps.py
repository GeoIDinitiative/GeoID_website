#!/usr/bin/env python3
"""
Annotate moon basemap textures with feature markers, using the SAME UV
mapping the viewer applies (`moonLatLonToVector3` + default SphereGeometry UVs).

For each moon listed below:
  - Loads basemap JPG from the planet's viewer/assets/.
  - Pulls feature lat/lon from the viewer's moonFeatureData inline JSON.
  - Computes texture pixel via the viewer's convention.
  - Draws a dot, name, and (lat°, lon°W) and writes to
    location_check/<planet>/<moon>_annotated.jpg

Run:  python3 tools/annotate_moon_maps.py
"""
import os, re, json, math
from PIL import Image, ImageDraw, ImageFont

ROOT = "/home/owen/GeoID_webpage/planet_explorer"
OUT_ROOT = "/home/owen/GeoID_webpage/location_check"

# Per-moon longitude offset matching MOON_LON_OFFSET in label-layer.js and
# MOON_DATA_LON_OFFSET in <planet>-viewer.js. Empty means standard west-positive.
MOON_LON_OFFSET = {
    # "Deimos": 180,  # currently empty
}

# Targets: (planet, moon, basemap-asset filename). Auto-discovered from each
# planet's viewer/assets/ directory at run time, but we keep an explicit
# canonical list for the moons users actually care about visually.
TARGETS = [
    ("mars",    "Phobos",    "phobos_color_map.jpg"),
    ("mars",    "Deimos",    "deimos_color_map.jpg"),
    ("jupiter", "Io",        "io_color_map.jpg"),
    ("jupiter", "Europa",    "europa_color_map.jpg"),
    ("jupiter", "Ganymede",  "ganymede_color_map.jpg"),
    ("jupiter", "Callisto",  "callisto_color_map.jpg"),
    ("saturn",  "Mimas",     "mimas_color_map.jpg"),
    ("saturn",  "Enceladus", "enceladus_color_map.jpg"),
    ("saturn",  "Tethys",    "tethys_color_map.jpg"),
    ("saturn",  "Dione",     "dione_color_map.jpg"),
    ("saturn",  "Rhea",      "rhea_color_map.jpg"),
    ("saturn",  "Titan",     "titan_color_map.jpg"),
    ("saturn",  "Iapetus",   "iapetus_color_map.jpg"),
    ("saturn",  "Phoebe",    "phoebe_color_map.jpg"),
    ("saturn",  "Hyperion",  "hyperion_color_map.jpg"),
    ("uranus",  "Miranda",   "miranda_color_map.jpg"),
    ("uranus",  "Ariel",     "ariel_color_map.jpg"),
    ("uranus",  "Umbriel",   "umbriel_color_map.jpg"),
    ("uranus",  "Titania",   "titania_color_map.jpg"),
    ("uranus",  "Oberon",    "oberon_color_map.jpg"),
    ("neptune", "Triton",    "triton_color_map.jpg"),
]


def load_font(size):
    for p in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def extract_moon_feature_data(viewer_path):
    with open(viewer_path) as fh:
        text = fh.read()
    m = re.search(r"const\s+moonFeatureData\s*=\s*\[", text)
    if not m:
        return []
    start = m.end() - 1
    depth = 0
    i = start
    while i < len(text):
        c = text[i]
        if c == "[":
            depth += 1
        elif c == "]":
            depth -= 1
            if depth == 0:
                return json.loads(text[start:i+1])
        i += 1
    return []


def lat_lon_to_texture_uv(lat_deg, lon_w_deg, moon_name, image_w, image_h):
    """Where this feature's marker visually lands in the basemap texture.

    Pipeline that ends up determining this:
      1. `moonLatLonToVector3` places the marker at body-local
         (-cos(lat)·cos(360−W), sin(lat), cos(lat)·sin(360−W)) in marsGroup frame.
      2. The moonMesh has `rotation.y = Math.PI − angle`; at the moon's reference
         pose (angle=0) that's π. The marker stays in marsGroup frame, but the
         mesh vertex that displays at the marker's world position is the one at
         body-local R_y(−π) · marker_local.
      3. SphereGeometry UV for that vertex: u = atan2(z_v, −x_v) / (2π).

    Combining: u = ((180 − (W + offset)) mod 360) / 360.
    """
    offset = MOON_LON_OFFSET.get(moon_name, 0)
    lon_w = (lon_w_deg + offset) % 360
    u = (((180 - lon_w) % 360) + 360) % 360 / 360.0
    v = (90 - lat_deg) / 180.0
    return u * image_w, v * image_h


def annotate(planet, moon_name, asset_name):
    viewer_path = os.path.join(ROOT, planet, "viewer", f"{planet}-viewer.js")
    asset_path = os.path.join(ROOT, planet, "viewer", "assets", asset_name)
    if not os.path.exists(asset_path):
        print(f"  skip {moon_name}: missing asset {asset_path}")
        return
    data = extract_moon_feature_data(viewer_path)
    # Include features tagged lod=1 OR features missing a lod field entirely
    # (Mars moons aren't tiered, treat their handful of named craters as tier-1).
    features = [
        d for d in data
        if d.get("moon_name") == moon_name and (d.get("lod") == 1 or "lod" not in d)
    ]
    if not features:
        print(f"  skip {moon_name}: no LOD-1 features in viewer")
        return

    base = Image.open(asset_path).convert("RGB")
    w, h = base.size
    canvas = base.copy()
    draw = ImageDraw.Draw(canvas, "RGBA")
    name_font = load_font(max(11, w // 110))
    coord_font = load_font(max(9, w // 140))
    grid_font = load_font(max(10, w // 130))

    # Light graticule for orientation.
    grid_color = (110, 200, 255, 110)
    for lon_w in range(0, 360, 30):
        x = (1 - lon_w / 360.0) * w  # west-positive: lon=0 at right edge if u=lon/360 maps east
        # Match viewer convention: feature at W=lon_w maps to texture u based on the chain above.
        # Use a fake feature at the equator to find the correct x for this lon line.
        gx, _ = lat_lon_to_texture_uv(0, lon_w, moon_name, w, h)
        draw.line([(gx, 0), (gx, h)], fill=grid_color, width=1)
        draw.text((gx + 3, 3), f"{lon_w}°W", fill=(180, 220, 255, 200), font=grid_font)
    for lat in range(-60, 90, 30):
        y = (90 - lat) / 180.0 * h
        draw.line([(0, y), (w, y)], fill=grid_color, width=1)
        draw.text((3, y + 2), f"{lat:+d}°", fill=(180, 220, 255, 200), font=grid_font)

    # Dots + labels (skip duplicates that overlap).
    placed = []
    for f in features:
        lat = float(f.get("lat", 0))
        lon = float(f.get("lon", 0))
        x, y = lat_lon_to_texture_uv(lat, lon, moon_name, w, h)
        r = 6
        draw.ellipse([x - r, y - r, x + r, y + r], outline=(255, 70, 70), width=2)
        draw.ellipse([x - 2, y - 2, x + 2, y + 2], fill=(255, 70, 70))
        label = f.get("name", "")
        coord = f"({lat:+.1f}°, {lon:.1f}°W)"
        # Find a non-overlapping placement.
        dy = 10
        for trial in (12, -22, 22, -32):
            tx = x + 8
            ty = y + trial
            box = [tx, ty, tx + 8 + len(label) * 6, ty + 22]
            if not any(_overlap(box, b) for b in placed):
                placed.append(box)
                draw.rectangle(box, fill=(0, 0, 0, 170))
                draw.text((tx + 3, ty + 1), label, fill=(255, 255, 255), font=name_font)
                draw.text((tx + 3, ty + 11), coord, fill=(200, 220, 255), font=coord_font)
                break

    banner_h = 26
    draw.rectangle([0, h - banner_h, w, h], fill=(0, 0, 0, 200))
    draw.text((10, h - banner_h + 5),
              f"{planet.upper()} / {moon_name}  —  {len(features)} LOD-1 features  "
              f"({'no offset' if moon_name not in MOON_LON_OFFSET else f'offset +{MOON_LON_OFFSET[moon_name]}°'})",
              fill=(255, 255, 255), font=grid_font)

    out_dir = os.path.join(OUT_ROOT, planet)
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"{moon_name.lower()}_annotated.jpg")
    canvas.save(out_path, quality=84)
    print(f"  wrote {out_path}  ({w}x{h}, {len(features)} features)")


def _overlap(a, b):
    return not (a[2] < b[0] or a[0] > b[2] or a[3] < b[1] or a[1] > b[3])


if __name__ == "__main__":
    for planet, moon, asset in TARGETS:
        print(f"=== {planet} / {moon} ===")
        annotate(planet, moon, asset)
