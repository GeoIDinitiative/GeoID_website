#!/usr/bin/env python3
"""
Test all UV convention combinations for each problem moon.
Generates annotated images with every combination so we can find the right one.
"""
import os
from PIL import Image, ImageDraw

OUT_DIR = "/tmp/moon_conv"
os.makedirs(OUT_DIR, exist_ok=True)

# Known features with USGS IAU coordinates (East-positive lat/lon)
FEATURES = {
    # ---- Miranda (Uranus) ----
    # Voyager 2 imaged the SOUTH polar hemisphere
    "Miranda": {
        "file": "/home/owen/GeoID_webpage/planet_explorer/uranus/viewer/assets/miranda_color_map.jpg",
        "feats": [
            {"name": "Arden Corona",     "lat": -35.0, "lon":   0.0},  # sub-Uranus point
            {"name": "Inverness Corona", "lat": -68.0, "lon": 325.8},
            {"name": "Elsinore Corona",  "lat": -20.0, "lon": 291.5},
            {"name": "Verona Rupes",     "lat": -22.8, "lon": 347.8},
        ],
    },
    # ---- Triton (Neptune) ----
    "Triton": {
        "file": "/home/owen/GeoID_webpage/planet_explorer/neptune/viewer/assets/triton_color_map.jpg",
        "feats": [
            {"name": "Cipango Planum",   "lat":  11.5, "lon":  34.0},
            {"name": "Hili Plume",       "lat": -57.0, "lon":  28.0},
            {"name": "S Polar Cap",      "lat": -90.0, "lon":   0.0},
            {"name": "Ruach Planitia",   "lat":  10.0, "lon": 310.0},  # known terrain
            {"name": "Bubembe Regio",    "lat":  18.0, "lon": 350.0},  # known terrain
        ],
    },
    # ---- Iapetus (Saturn) — verify centered vs left-edge ----
    "Iapetus": {
        "file": "/home/owen/GeoID_webpage/planet_explorer/saturn/viewer/assets/iapetus_color_map.jpg",
        "feats": [
            {"name": "Cassini Regio",    "lat": -28.1, "lon": 267.4},
            {"name": "Roncevaux Terra",  "lat":  37.0, "lon": 120.5},
            {"name": "Turgis Crater",    "lat":  16.9, "lon": 331.6},
        ],
    },
    # ---- Mimas (Saturn) — verify convention ----
    "Mimas": {
        "file": "/home/owen/GeoID_webpage/planet_explorer/saturn/viewer/assets/mimas_color_map.jpg",
        "feats": [
            # Herschel Crater dominates Mimas - distinctive large impact crater
            {"name": "Herschel Crater",  "lat":  -1.4, "lon": 109.0},  # ~109°W=251°E historically; 248.2°E in data
            {"name": "Herschel (data)",  "lat":  -1.4, "lon": 248.2},  # current data value
        ],
    },
    # ---- Rhea (Saturn) — verify convention ----
    "Rhea": {
        "file": "/home/owen/GeoID_webpage/planet_explorer/saturn/viewer/assets/rhea_color_map.jpg",
        "feats": [
            # Inktomi is a bright fresh crater — very recognizable
            {"name": "Inktomi",          "lat": -14.1, "lon": 247.9},  # current data (centered conv.)
            # Cross-check with the known position
            # Inktomi known: ~14°S, ~112°W = 248°E (East-positive) — consistent
        ],
    },
    # ---- Dione (Saturn) — verify convention ----
    "Dione": {
        "file": "/home/owen/GeoID_webpage/planet_explorer/saturn/viewer/assets/Dione_Color_Map.jpg",
        "feats": [
            {"name": "Wispy Terrain",    "lat":   0.0, "lon":  90.0},
            {"name": "Padua Chasmata",   "lat":  17.7, "lon": 112.8},
            {"name": "Aeneas Crater",    "lat":  25.9, "lon": 313.7},
        ],
    },
}


def dot(draw, px, py, radius, fill, label, coords="", label_color="yellow"):
    draw.ellipse([px-radius-2, py-radius-2, px+radius+2, py+radius+2], fill="white")
    draw.ellipse([px-radius, py-radius, px+radius, py+radius], fill=fill)
    draw.text((px+radius+4, py-8), label, fill=label_color)
    if coords:
        draw.text((px+radius+4, py+8), coords, fill="cyan")


def annotate_moon(moon_name, moon_data, label, uv_fn, dot_color="red"):
    fpath = moon_data["file"]
    if not os.path.exists(fpath):
        print(f"  MISSING: {fpath}")
        return
    img = Image.open(fpath).convert("RGB")
    w, h = img.size
    # Downscale large images for output
    max_w = 1600
    if w > max_w:
        scale = max_w / w
        img = img.resize((int(w*scale), int(h*scale)), Image.LANCZOS)
        w, h = img.size
    draw = ImageDraw.Draw(img)
    r = max(8, min(w, h)//60)
    for f in moon_data["feats"]:
        u, v = uv_fn(f["lat"], f["lon"])
        # clamp to image bounds
        px = max(r, min(w-r, int(u*w)))
        py = max(r, min(h-r, int(v*h)))
        dot(draw, px, py, r, dot_color, f["name"],
            f"({f['lat']:.1f}°,{f['lon']:.1f}°E)")
    out = f"{OUT_DIR}/{moon_name}_{label}.jpg"
    img.save(out, quality=88)
    print(f"  {moon_name} [{label}]: {out}  [{w}x{h}]")


# Build all 6 convention functions
CONVENTIONS = {
    "left_NorthTop":     lambda lat, lon: (lon/360,                        (90-lat)/180),
    "left_SouthTop":     lambda lat, lon: (lon/360,                        (lat+90)/180),
    "centered_NorthTop": lambda lat, lon: (((lon+180)%360)/360,            (90-lat)/180),
    "centered_SouthTop": lambda lat, lon: (((lon+180)%360)/360,            (lat+90)/180),
    "mirrorU_NorthTop":  lambda lat, lon: (1-(lon%360)/360,                (90-lat)/180),
    "mirrorU_SouthTop":  lambda lat, lon: (1-(lon%360)/360,                (lat+90)/180),
}

COLORS = ["red","red","orange","orange","cyan","cyan"]

for moon_name, moon_data in FEATURES.items():
    print(f"\n=== {moon_name} ===")
    for (conv_label, uv_fn), color in zip(CONVENTIONS.items(), COLORS):
        annotate_moon(moon_name, moon_data, conv_label, uv_fn, color)

print("\nDone.")
