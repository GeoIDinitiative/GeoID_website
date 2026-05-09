#!/usr/bin/env python3
"""
Annotate moon texture images with expected feature label positions.
Saves annotated images to /tmp/moon_annotations/ for visual review.

UV mapping rules:
  - Jupiter (no rotation): U = lon / 360
  - Saturn (rotation.y=PI): U = ((lon + 180) % 360) / 360
  - Uranus (no rotation): U = lon / 360
  - Neptune (no rotation): U = lon / 360

V mapping (same for all):
  V = (90 - lat) / 180   (V=0 = top of image = 90°N, V=1 = bottom = 90°S)
"""

import json, os, math
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = "/tmp/moon_annotations"
os.makedirs(OUT_DIR, exist_ok=True)

# -----------------------------------------------------------------
# Feature data from each viewer
# -----------------------------------------------------------------

saturn_features = [
    {"name": "Herschel Crater",        "moon": "Mimas",    "lat": -1.4,  "lon": 248.2},
    {"name": "Mimas Leading Hemi",     "moon": "Mimas",    "lat":  0.0,  "lon": 270.0},
    {"name": "Damascus Sulcus",        "moon": "Enceladus","lat": -80.6, "lon":  74.1},
    {"name": "Baghdad Sulcus",         "moon": "Enceladus","lat": -86.9, "lon": 129.5},
    {"name": "Cairo Sulcus",           "moon": "Enceladus","lat": -81.6, "lon": 205.5},
    {"name": "S Polar Plume",          "moon": "Enceladus","lat": -90.0, "lon":   0.0},
    {"name": "Odysseus Crater",        "moon": "Tethys",   "lat":  32.8, "lon": 231.1},
    {"name": "Ithaca Chasma",          "moon": "Tethys",   "lat": -14.0, "lon": 353.9},
    {"name": "Telemachus Crater",      "moon": "Tethys",   "lat":  54.0, "lon":  20.6},
    {"name": "Wispy Terrain",          "moon": "Dione",    "lat":   0.0, "lon":  90.0},
    {"name": "Padua Chasmata",         "moon": "Dione",    "lat":  17.7, "lon": 112.8},
    {"name": "Aeneas Crater",          "moon": "Dione",    "lat":  25.9, "lon": 313.7},
    {"name": "Inktomi Crater",         "moon": "Rhea",     "lat": -14.1, "lon": 247.9},
    {"name": "Tirawa Basin",           "moon": "Rhea",     "lat":  34.2, "lon": 208.3},
    {"name": "Mamaldi Crater",         "moon": "Rhea",     "lat": -14.0, "lon":  42.0},
    {"name": "Kraken Mare",            "moon": "Titan",    "lat":  68.0, "lon":  50.0},
    {"name": "Ligeia Mare",            "moon": "Titan",    "lat":  79.7, "lon": 112.1},
    {"name": "Punga Mare",             "moon": "Titan",    "lat":  85.1, "lon":  20.3},
    {"name": "Xanadu",                 "moon": "Titan",    "lat": -15.0, "lon": 260.0},
    {"name": "Shangri-La",             "moon": "Titan",    "lat": -10.0, "lon": 195.0},
    {"name": "Belet",                  "moon": "Titan",    "lat":  -5.0, "lon": 105.0},
    {"name": "Huygens Landing",        "moon": "Titan",    "lat": -10.3, "lon": 167.7},
    {"name": "Cassini Regio",          "moon": "Iapetus",  "lat": -28.1, "lon": 267.4},
    {"name": "Roncevaux Terra",        "moon": "Iapetus",  "lat":  37.0, "lon": 120.5},
    {"name": "Turgis Crater",          "moon": "Iapetus",  "lat":  16.9, "lon": 331.6},
]

jupiter_features = [
    {"name": "Loki Patera",      "moon": "Io",       "lat":  12.6, "lon":  51.2},
    {"name": "Prometheus Plume", "moon": "Io",       "lat":  -1.5, "lon": 206.1},
    {"name": "Chaos Terrain",    "moon": "Europa",   "lat":   0.0, "lon": 270.0},
    {"name": "Conamara Chaos",   "moon": "Europa",   "lat":   9.7, "lon":  86.0},
    {"name": "Galileo Regio",    "moon": "Ganymede", "lat":  20.0, "lon": 235.0},
    {"name": "Uruk Sulcus",      "moon": "Ganymede", "lat":   0.0, "lon": 160.0},
    {"name": "Valhalla Basin",   "moon": "Callisto", "lat":  15.9, "lon": 304.0},
    {"name": "Asgard Basin",     "moon": "Callisto", "lat":  30.0, "lon": 218.0},
]

uranus_features = [
    {"name": "Verona Rupes",      "moon": "Miranda",  "lat": -22.8, "lon": 347.8},
    {"name": "Inverness Corona",  "moon": "Miranda",  "lat": -67.0, "lon": 325.0},
    {"name": "Kachina Chasmata",  "moon": "Ariel",    "lat":  -9.0, "lon": 246.0},
    {"name": "Messina Chasma",    "moon": "Titania",  "lat": -33.3, "lon": 335.0},
]

neptune_features = [
    {"name": "Cipango Planum",    "moon": "Triton",   "lat":  11.5, "lon":  34.0},
    {"name": "Hili Plume",        "moon": "Triton",   "lat": -57.0, "lon":  28.0},
    {"name": "South Polar Cap",   "moon": "Triton",   "lat": -90.0, "lon":   0.0},
]

# Texture file paths
TEXTURES = {
    # Saturn
    "Mimas":    "/home/owen/GeoID_webpage/planet_explorer/saturn/viewer/assets/mimas_color_map.jpg",
    "Enceladus":"/home/owen/GeoID_webpage/planet_explorer/saturn/viewer/assets/enceladus_color_map.jpg",
    "Tethys":   "/home/owen/GeoID_webpage/planet_explorer/saturn/viewer/assets/tethys_color.jpg",
    "Dione":    "/home/owen/GeoID_webpage/planet_explorer/saturn/viewer/assets/Dione_Color_Map.jpg",
    "Rhea":     "/home/owen/GeoID_webpage/planet_explorer/saturn/viewer/assets/rhea_color_map.jpg",
    "Titan":    "/home/owen/GeoID_webpage/planet_explorer/saturn/viewer/assets/titan_color_map.jpg",
    "Iapetus":  "/home/owen/GeoID_webpage/planet_explorer/saturn/viewer/assets/iapetus_color_map.jpg",
    # Jupiter
    "Io":       "/home/owen/GeoID_webpage/planet_explorer/jupiter/viewer/assets/io_color_map.jpg",
    "Europa":   "/home/owen/GeoID_webpage/planet_explorer/jupiter/viewer/assets/europa_color_map.jpg",
    "Ganymede": "/home/owen/GeoID_webpage/planet_explorer/jupiter/viewer/assets/ganymede_color_map.jpg",
    "Callisto": "/home/owen/GeoID_webpage/planet_explorer/jupiter/viewer/assets/callisto_color_map.jpg",
    # Uranus
    "Miranda":  "/home/owen/GeoID_webpage/planet_explorer/uranus/viewer/assets/miranda_color_map.jpg",
    "Ariel":    "/home/owen/GeoID_webpage/planet_explorer/uranus/viewer/assets/ariel_color_map.jpg",
    "Titania":  "/home/owen/GeoID_webpage/planet_explorer/uranus/viewer/assets/titania_color_map.jpg",
    # Neptune
    "Triton":   "/home/owen/GeoID_webpage/planet_explorer/neptune/viewer/assets/triton_color_map.jpg",
}


def uv_saturn(lat, lon):
    """UV for Saturn moons with rotation.y = PI (centered convention)."""
    u = ((lon + 180) % 360) / 360
    v = (90 - lat) / 180
    return u, v


def uv_leftedge(lat, lon):
    """UV for left-edge convention (Jupiter, Uranus, Neptune — no rotation)."""
    u = (lon % 360) / 360
    v = (90 - lat) / 180
    return u, v


def annotate(img_path, features, uv_fn, label=""):
    if not os.path.exists(img_path):
        print(f"  MISSING: {img_path}")
        return
    img = Image.open(img_path).convert("RGB")
    w, h = img.size
    draw = ImageDraw.Draw(img)

    for f in features:
        u, v = uv_fn(f["lat"], f["lon"])
        px = int(u * w)
        py = int(v * h)
        r = max(8, min(w, h) // 50)
        # Red dot with white outline
        draw.ellipse([px-r-2, py-r-2, px+r+2, py+r+2], fill="white")
        draw.ellipse([px-r, py-r, px+r, py+r], fill="red")
        # Label text
        name = f["name"]
        coords = f"({f['lat']:.1f}°, {f['lon']:.1f}°E)"
        draw.text((px+r+4, py-8), name, fill="yellow")
        draw.text((px+r+4, py+6), coords, fill="cyan")

    moon = features[0]["moon"] if features else "unknown"
    fname = f"{OUT_DIR}/{label}_{moon}.jpg"
    img.save(fname, quality=90)
    print(f"  Saved: {fname}  [{w}x{h}]")


print("=== Saturn moons (rotation.y=PI → centered convention) ===")
for moon in ["Mimas", "Enceladus", "Tethys", "Dione", "Rhea", "Titan", "Iapetus"]:
    feats = [f for f in saturn_features if f["moon"] == moon]
    if feats and moon in TEXTURES:
        annotate(TEXTURES[moon], feats, uv_saturn, "saturn")

print("\n=== Jupiter moons (no rotation → left-edge convention) ===")
for moon in ["Io", "Europa", "Ganymede", "Callisto"]:
    feats = [f for f in jupiter_features if f["moon"] == moon]
    if feats and moon in TEXTURES:
        annotate(TEXTURES[moon], feats, uv_leftedge, "jupiter")

print("\n=== Uranus moons (no rotation → left-edge convention) ===")
for moon in ["Miranda", "Ariel", "Titania"]:
    feats = [f for f in uranus_features if f["moon"] == moon]
    if feats and moon in TEXTURES:
        annotate(TEXTURES[moon], feats, uv_leftedge, "uranus")

print("\n=== Neptune moons (no rotation → left-edge convention) ===")
for moon in ["Triton"]:
    feats = [f for f in neptune_features if f["moon"] == moon]
    if feats and moon in TEXTURES:
        annotate(TEXTURES[moon], feats, uv_leftedge, "neptune")

# Also generate Saturn with LEFT-EDGE (no rotation) to compare
print("\n=== Saturn moons (ALT: left-edge convention, for comparison) ===")
for moon in ["Tethys", "Iapetus"]:
    feats = [f for f in saturn_features if f["moon"] == moon]
    if feats and moon in TEXTURES:
        annotate(TEXTURES[moon], feats, uv_leftedge, "saturn_norot")

print("\nDone.")
