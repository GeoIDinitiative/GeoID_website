#!/usr/bin/env python3
"""Test all Uranus moon conventions to determine correct mapping."""
import os
from PIL import Image, ImageDraw

OUT_DIR = "/tmp/moon_uranus"
os.makedirs(OUT_DIR, exist_ok=True)

# Known USGS IAU East-positive coordinates for major Uranus moon features
URANUS_FEATURES = {
    "Miranda": {
        "file": "/home/owen/GeoID_webpage/planet_explorer/uranus/viewer/assets/miranda_color_map.jpg",
        "feats": [
            {"name": "Arden Corona",     "lat": -35.0, "lon":   0.0},
            {"name": "Inverness Corona", "lat": -68.0, "lon": 325.8},
            {"name": "Elsinore Corona",  "lat": -20.0, "lon": 291.5},
            {"name": "Verona Rupes",     "lat": -22.8, "lon": 347.8},
        ],
    },
    "Ariel": {
        "file": "/home/owen/GeoID_webpage/planet_explorer/uranus/viewer/assets/ariel_color_map.jpg",
        "feats": [
            # Major chasmata on Ariel (USGS Gazetteer IAU East-positive)
            {"name": "Kachina Chasmata",  "lat":  -9.0, "lon": 246.0},
            {"name": "Brownie Chasma",    "lat": -37.0, "lon": 240.0},
            {"name": "Sylph Chasma",      "lat": -43.0, "lon": 186.0},
            {"name": "Kewpie Chasma",     "lat": -11.0, "lon": 246.0},
            # Well-imaged crater Yangoor (~16°S, 295°E)
            {"name": "Yangoor Crater",    "lat": -16.0, "lon": 295.0},
        ],
    },
    "Titania": {
        "file": "/home/owen/GeoID_webpage/planet_explorer/uranus/viewer/assets/titania_color_map.jpg",
        "feats": [
            {"name": "Messina Chasma",   "lat": -33.3, "lon": 335.0},
            {"name": "Gertrude Crater",  "lat": -15.8, "lon":  44.4},  # large crater
            {"name": "Ursula Crater",    "lat": -12.0, "lon": 289.0},  # notable crater
        ],
    },
    "Umbriel": {
        "file": "/home/owen/GeoID_webpage/planet_explorer/uranus/viewer/assets/umbriel_color_map.jpg",
        "feats": [
            {"name": "Wunda Crater",     "lat":  -7.9, "lon": 273.6},  # bright ring feature
            {"name": "Vuver Crater",     "lat": -4.4,  "lon": 311.0},
            {"name": "Skynd Crater",     "lat": -1.4,  "lon": 330.0},
        ],
    },
    "Oberon": {
        "file": "/home/owen/GeoID_webpage/planet_explorer/uranus/viewer/assets/oberon_color_map.jpg",
        "feats": [
            {"name": "Mommur Chasma",    "lat":  16.0, "lon": 323.3},
            {"name": "Hamlet Crater",    "lat": -46.1, "lon": 44.4},
            {"name": "Othello Crater",   "lat": -66.0, "lon": 42.0},
            {"name": "Macbeth Crater",   "lat": -58.0, "lon": 97.7},
        ],
    },
}

def dot(draw, px, py, r, fill, label):
    draw.ellipse([px-r-2, py-r-2, px+r+2, py+r+2], fill="white")
    draw.ellipse([px-r,   py-r,   px+r,   py+r  ], fill=fill)
    draw.text((px+r+3, py-7), label, fill="yellow")

CONVS = {
    "left_N":    lambda lat, lon: (lon%360/360,                   (90-lat)/180),
    "left_S":    lambda lat, lon: (lon%360/360,                   (lat+90)/180),
    "mirrorU_N": lambda lat, lon: (1-lon%360/360,                 (90-lat)/180),
    "mirrorU_S": lambda lat, lon: (1-lon%360/360,                 (lat+90)/180),
}
COLORS = {"left_N": "red", "left_S": "orange", "mirrorU_N": "cyan", "mirrorU_S": "lime"}

for moon, data in URANUS_FEATURES.items():
    fpath = data["file"]
    if not os.path.exists(fpath):
        print(f"MISSING: {fpath}")
        continue
    for conv_name, uv_fn in CONVS.items():
        img = Image.open(fpath).convert("RGB")
        w, h = img.size
        if w > 1600:
            scale = 1600/w
            img = img.resize((int(w*scale), int(h*scale)), Image.LANCZOS)
            w, h = img.size
        draw = ImageDraw.Draw(img)
        r = max(8, min(w,h)//60)
        for f in data["feats"]:
            u, v = uv_fn(f["lat"], f["lon"])
            px = max(r, min(w-r, int(u*w)))
            py = max(r, min(h-r, int(v*h)))
            dot(draw, px, py, r, COLORS[conv_name], f["name"])
        out = f"{OUT_DIR}/{moon}_{conv_name}.jpg"
        img.save(out, quality=88)
        print(f"  {moon} [{conv_name}]: {out}")

print("Done.")
