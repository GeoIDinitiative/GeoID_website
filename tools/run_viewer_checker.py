#!/usr/bin/env python3
"""
Second test-map collection: annotates each moon's texture using the EXACT
coordinates and UV conventions found in the viewer JS files.

Cross-check this output against run_checker.py output — any dot that lands
in a visually different spot indicates a coordinate error in the viewer JS.

Output: test_maps_viewer/<planet>_<moon>.jpg
"""
import os
from PIL import Image, ImageDraw

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SCRIPT_DIR, "test_maps_viewer")
os.makedirs(OUT, exist_ok=True)

BASE = "/home/owen/GeoID_webpage"

# ── UV convention functions — must match viewer JS exactly ──────────────────
def uv_left_north(lat, lon):
    return ((lon % 360) / 360, (90 - lat) / 180)

def uv_centered_north(lat, lon):
    return (((lon % 360) + 180) % 360 / 360, (90 - lat) / 180)

def uv_mirror_south(lat, lon):
    return (1 - (lon % 360) / 360, (lat + 90) / 180)

# ── Feature data extracted verbatim from each viewer JS (line 63) ───────────
# jupiter-viewer.js
JUPITER_FEATURES = [
    {"moon": "Io",       "lat":  12.6, "lon":  51.2, "name": "Loki Patera"},
    {"moon": "Io",       "lat":  -1.5, "lon": 206.1, "name": "Prometheus Plume"},
    {"moon": "Europa",   "lat":   0.0, "lon": 270.0, "name": "Chaos Terrain"},
    {"moon": "Europa",   "lat":   9.7, "lon":  86.0, "name": "Conamara Chaos"},
    {"moon": "Ganymede", "lat":  20.0, "lon": 235.0, "name": "Galileo Regio"},
    {"moon": "Ganymede", "lat":   0.0, "lon": 160.0, "name": "Uruk Sulcus"},
    {"moon": "Callisto", "lat":  15.9, "lon": 304.0, "name": "Valhalla Basin"},
    {"moon": "Callisto", "lat":  30.0, "lon": 218.0, "name": "Asgard Basin"},
]

# saturn-viewer.js
SATURN_FEATURES = [
    {"moon": "Mimas",     "lat":  -1.4, "lon": 248.2, "name": "Herschel Crater"},
    {"moon": "Mimas",     "lat":   0.0, "lon": 270.0, "name": "Mimas Leading Hemisphere"},
    {"moon": "Enceladus", "lat": -80.6, "lon":  74.1, "name": "Damascus Sulcus"},
    {"moon": "Enceladus", "lat": -86.9, "lon": 129.5, "name": "Baghdad Sulcus"},
    {"moon": "Enceladus", "lat": -81.6, "lon": 205.5, "name": "Cairo Sulcus"},
    {"moon": "Enceladus", "lat": -90.0, "lon":   0.0, "name": "South Polar Plume Source"},
    {"moon": "Tethys",    "lat":  32.8, "lon": 231.1, "name": "Odysseus Crater"},
    {"moon": "Tethys",    "lat": -14.0, "lon": 353.9, "name": "Ithaca Chasma"},
    {"moon": "Tethys",    "lat":  54.0, "lon":  20.6, "name": "Telemachus Crater"},
    {"moon": "Dione",     "lat":   0.0, "lon":  90.0, "name": "Wispy Terrain"},
    {"moon": "Dione",     "lat":  17.7, "lon": 112.8, "name": "Padua Chasmata"},
    {"moon": "Dione",     "lat":  25.9, "lon": 313.7, "name": "Aeneas Crater"},
    {"moon": "Rhea",      "lat": -14.1, "lon": 247.9, "name": "Inktomi Crater"},
    {"moon": "Rhea",      "lat":  34.2, "lon": 208.3, "name": "Tirawa Basin"},
    {"moon": "Rhea",      "lat": -14.0, "lon": 318.0, "name": "Mamaldi Crater"},
    {"moon": "Titan",     "lat":  68.0, "lon":  50.0, "name": "Kraken Mare"},
    {"moon": "Titan",     "lat":  79.7, "lon": 112.1, "name": "Ligeia Mare"},
    {"moon": "Titan",     "lat":  85.1, "lon":  20.3, "name": "Punga Mare"},
    {"moon": "Titan",     "lat": -15.0, "lon": 260.0, "name": "Xanadu"},
    {"moon": "Titan",     "lat": -10.0, "lon": 195.0, "name": "Shangri-La"},
    {"moon": "Titan",     "lat":  -5.0, "lon": 105.0, "name": "Belet"},
    {"moon": "Titan",     "lat": -10.3, "lon": 167.7, "name": "Huygens Landing"},
    {"moon": "Iapetus",   "lat": -28.1, "lon": 267.4, "name": "Cassini Regio"},
    {"moon": "Iapetus",   "lat":  37.0, "lon": 120.5, "name": "Roncevaux Terra"},
    {"moon": "Iapetus",   "lat":  16.9, "lon": 331.6, "name": "Turgis Crater"},
]

# uranus-viewer.js
URANUS_FEATURES = [
    {"moon": "Miranda",  "lat": -22.8, "lon": 347.8, "name": "Verona Rupes"},
    {"moon": "Miranda",  "lat": -35.0, "lon":   0.0, "name": "Arden Corona"},
    {"moon": "Ariel",    "lat":  -9.0, "lon": 246.0, "name": "Kachina Chasmata"},
    {"moon": "Umbriel",  "lat":  -7.9, "lon": 273.6, "name": "Wunda Crater"},
    {"moon": "Titania",  "lat": -33.3, "lon": 335.0, "name": "Messina Chasma"},
    {"moon": "Oberon",   "lat": -46.1, "lon":  44.4, "name": "Hamlet Crater"},
]

# neptune-viewer.js (Triton only; Proteus/Nereid skipped — no texture)
NEPTUNE_FEATURES = [
    {"moon": "Triton", "lat": -75.0, "lon":   0.0, "name": "South Polar Cap"},
    {"moon": "Triton", "lat": -57.0, "lon":  28.0, "name": "Hili Plume"},
    {"moon": "Triton", "lat":  11.5, "lon":  34.0, "name": "Cipango Planum"},
]

# ── Moon definitions: texture path + convention + features ──────────────────
MOONS = [
    # Jupiter
    dict(planet="Jupiter", name="Io",
         conv=uv_left_north,
         tex=f"{BASE}/planet_explorer/jupiter/viewer/assets/io_color_map.jpg",
         features=[f for f in JUPITER_FEATURES if f["moon"] == "Io"]),
    dict(planet="Jupiter", name="Europa",
         conv=uv_left_north,
         tex=f"{BASE}/planet_explorer/jupiter/viewer/assets/europa_color_map.jpg",
         features=[f for f in JUPITER_FEATURES if f["moon"] == "Europa"]),
    dict(planet="Jupiter", name="Ganymede",
         conv=uv_left_north,
         tex=f"{BASE}/planet_explorer/jupiter/viewer/assets/ganymede_color_map.jpg",
         features=[f for f in JUPITER_FEATURES if f["moon"] == "Ganymede"]),
    dict(planet="Jupiter", name="Callisto",
         conv=uv_left_north,
         tex=f"{BASE}/planet_explorer/jupiter/viewer/assets/callisto_color_map.jpg",
         features=[f for f in JUPITER_FEATURES if f["moon"] == "Callisto"]),

    # Saturn — leftNorth
    dict(planet="Saturn", name="Mimas",
         conv=uv_left_north,
         tex=f"{BASE}/planet_explorer/saturn/viewer/assets/mimas_color_map.jpg",
         features=[f for f in SATURN_FEATURES if f["moon"] == "Mimas"]),
    dict(planet="Saturn", name="Iapetus",
         conv=uv_left_north,
         tex=f"{BASE}/planet_explorer/saturn/viewer/assets/iapetus_color_map.jpg",
         features=[f for f in SATURN_FEATURES if f["moon"] == "Iapetus"]),

    # Saturn — centeredNorth (CENTERED_PROJECTION_MOONS in viewer JS)
    dict(planet="Saturn", name="Enceladus",
         conv=uv_centered_north,
         tex=f"{BASE}/planet_explorer/saturn/viewer/assets/enceladus_color_map.jpg",
         features=[f for f in SATURN_FEATURES if f["moon"] == "Enceladus"]),
    dict(planet="Saturn", name="Tethys",
         conv=uv_centered_north,
         tex=f"{BASE}/planet_explorer/saturn/viewer/assets/tethys_color.jpg",
         features=[f for f in SATURN_FEATURES if f["moon"] == "Tethys"]),
    dict(planet="Saturn", name="Dione",
         conv=uv_centered_north,
         tex=f"{BASE}/planet_explorer/saturn/viewer/assets/Dione_Color_Map.jpg",
         features=[f for f in SATURN_FEATURES if f["moon"] == "Dione"]),
    dict(planet="Saturn", name="Rhea",
         conv=uv_centered_north,
         tex=f"{BASE}/planet_explorer/saturn/viewer/assets/rhea_color_map.jpg",
         features=[f for f in SATURN_FEATURES if f["moon"] == "Rhea"]),
    dict(planet="Saturn", name="Titan",
         conv=uv_centered_north,
         tex=f"{BASE}/planet_explorer/saturn/viewer/assets/titan_color_map.jpg",
         features=[f for f in SATURN_FEATURES if f["moon"] == "Titan"]),

    # Uranus — mirrorUSouth
    dict(planet="Uranus", name="Miranda",
         conv=uv_mirror_south,
         tex=f"{BASE}/planet_explorer/uranus/viewer/assets/miranda_color_map.jpg",
         features=[f for f in URANUS_FEATURES if f["moon"] == "Miranda"]),
    dict(planet="Uranus", name="Ariel",
         conv=uv_mirror_south,
         tex=f"{BASE}/planet_explorer/uranus/viewer/assets/ariel_color_map.jpg",
         features=[f for f in URANUS_FEATURES if f["moon"] == "Ariel"]),
    dict(planet="Uranus", name="Umbriel",
         conv=uv_mirror_south,
         tex=f"{BASE}/planet_explorer/uranus/viewer/assets/umbriel_color_map.jpg",
         features=[f for f in URANUS_FEATURES if f["moon"] == "Umbriel"]),
    dict(planet="Uranus", name="Titania",
         conv=uv_mirror_south,
         tex=f"{BASE}/planet_explorer/uranus/viewer/assets/titania_color_map.jpg",
         features=[f for f in URANUS_FEATURES if f["moon"] == "Titania"]),
    dict(planet="Uranus", name="Oberon",
         conv=uv_mirror_south,
         tex=f"{BASE}/planet_explorer/uranus/viewer/assets/oberon_color_map.jpg",
         features=[f for f in URANUS_FEATURES if f["moon"] == "Oberon"]),

    # Neptune
    dict(planet="Neptune", name="Triton",
         conv=uv_left_north,
         tex=f"{BASE}/planet_explorer/neptune/viewer/assets/triton_color_map.jpg",
         features=[f for f in NEPTUNE_FEATURES if f["moon"] == "Triton"]),
]

# ── Render ──────────────────────────────────────────────────────────────────
MAX_W = 1400

def annotate(moon):
    if not os.path.exists(moon["tex"]):
        print(f"  MISSING: {moon['tex']}")
        return
    img = Image.open(moon["tex"]).convert("RGB")
    w, h = img.size
    if w > MAX_W:
        s = MAX_W / w
        img = img.resize((int(w * s), int(h * s)), Image.LANCZOS)
        w, h = img.size

    draw = ImageDraw.Draw(img)
    r = max(8, min(w, h) // 50)

    # Grid lines
    for lat in [-60, -30, 0, 30, 60]:
        _, v0 = moon["conv"](lat, 0)
        y = int(v0 * h)
        draw.line([(0, y), (w, y)], fill=(255, 255, 255, 50 if lat != 0 else 80), width=1)
    for lon in [0, 60, 120, 180, 240, 300]:
        u0, _ = moon["conv"](0, lon)
        x = int(u0 * w)
        draw.line([(x, 0), (x, h)], fill=(255, 255, 255, 40), width=1)

    for f in moon["features"]:
        u, v = moon["conv"](f["lat"], f["lon"])
        px = max(r, min(w - r, int(u * w)))
        py = max(r, min(h - r, int(v * h)))
        draw.ellipse([px - r - 3, py - r - 3, px + r + 3, py + r + 3], fill="white")
        draw.ellipse([px - r, py - r, px + r, py + r], fill="lime")
        draw.text((px + r + 4, py - 7), f["name"], fill="yellow")
        draw.text((px + r + 4, py + 7), f"({f['lat']:.1f}°, {f['lon']:.1f}°E)", fill="cyan")

    out = f"{OUT}/{moon['planet']}_{moon['name']}.jpg"
    img.save(out, quality=90)
    print(f"  {moon['planet']:8s} {moon['name']:10s} → {out}  [{w}×{h}]")

print("Generating viewer-coords annotations…")
for moon in MOONS:
    annotate(moon)
print(f"\nDone. All images in {OUT}/")
