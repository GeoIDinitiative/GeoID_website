#!/usr/bin/env python3
"""
Generate flat-map annotations for every moon in every viewer.
Uses the exact same UV conventions as each viewer's JS code.
Output: test_maps/<planet>_<moon>.jpg  (alongside this script)
"""
import os
from PIL import Image, ImageDraw

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SCRIPT_DIR, "test_maps")
os.makedirs(OUT, exist_ok=True)

BASE = "/home/owen/GeoID_webpage"

# ── UV convention functions (must match viewer JS exactly) ──────────────────
def uv_left_north(lat, lon):
    """Left-edge, North-at-top. Jupiter, Saturn left-edge, Neptune."""
    return ((lon % 360) / 360, (90 - lat) / 180)

def uv_centered_north(lat, lon):
    """Centered west-positive, North-at-top. Saturn USGS high-res textures use west-positive
    longitude (old IAU standard). lon is east-positive (IAU 2015); converts internally.
    Matches the saturn-viewer texture flip (repeat.x=-1, offset.x=1) + rotation.y=π."""
    lon_west = (360 - lon) % 360
    return (((lon_west % 360) + 180) % 360 / 360, (90 - lat) / 180)

def uv_mirror_south(lat, lon):
    """Mirror-U, South-at-top. Uranus moons (repeat(-1,-1), offset(1,1))."""
    return (1 - (lon % 360) / 360, (lat + 90) / 180)

# ── Moon database ───────────────────────────────────────────────────────────
MOONS = [
    # Jupiter
    dict(planet="Jupiter", name="Io", conv=uv_left_north,
         tex=f"{BASE}/planet_explorer/jupiter/viewer/assets/io_color_map.jpg",
         features=[
             dict(name="Loki Patera",      lat= 12.6, lon=  51.2),
             dict(name="Prometheus Plume", lat= -1.5, lon= 206.1),
         ]),
    dict(planet="Jupiter", name="Europa", conv=uv_left_north,
         tex=f"{BASE}/planet_explorer/jupiter/viewer/assets/europa_color_map.jpg",
         features=[
             dict(name="Conamara Chaos", lat=  9.7, lon=  86.0),
             dict(name="Chaos Terrain",  lat=  0.0, lon= 270.0),
         ]),
    dict(planet="Jupiter", name="Ganymede", conv=uv_left_north,
         tex=f"{BASE}/planet_explorer/jupiter/viewer/assets/ganymede_color_map.jpg",
         features=[
             dict(name="Galileo Regio", lat= 20.0, lon= 235.0),
             dict(name="Uruk Sulcus",   lat=  0.0, lon= 160.0),
         ]),
    dict(planet="Jupiter", name="Callisto", conv=uv_left_north,
         tex=f"{BASE}/planet_explorer/jupiter/viewer/assets/callisto_color_map.jpg",
         features=[
             dict(name="Valhalla Basin", lat= 15.9, lon= 304.0),
             dict(name="Asgard Basin",   lat= 30.0, lon= 218.0),
         ]),

    # Saturn left-edge
    dict(planet="Saturn", name="Mimas", conv=uv_left_north,
         tex=f"{BASE}/planet_explorer/saturn/viewer/assets/mimas_color_map.jpg",
         features=[
             dict(name="Herschel Crater",    lat= -1.4, lon= 248.2),
             dict(name="Leading Hemisphere", lat=  0.0, lon= 270.0),
         ]),
    dict(planet="Saturn", name="Iapetus", conv=uv_left_north,
         tex=f"{BASE}/planet_explorer/saturn/viewer/assets/iapetus_color_map.jpg",
         features=[
             dict(name="Cassini Regio",   lat= -28.1, lon= 267.4),
             dict(name="Roncevaux Terra", lat=  37.0, lon= 120.5),
             dict(name="Turgis Crater",   lat=  16.9, lon= 331.6),
         ]),

    # Saturn centered (USGS high-res, rotation.y=π)
    dict(planet="Saturn", name="Enceladus", conv=uv_centered_north,
         tex=f"{BASE}/planet_explorer/saturn/viewer/assets/enceladus_color_map.jpg",
         features=[
             dict(name="Damascus Sulcus",   lat= -80.6, lon=  74.1),
             dict(name="Baghdad Sulcus",    lat= -86.9, lon= 129.5),
             dict(name="Cairo Sulcus",      lat= -81.6, lon= 205.5),
             dict(name="South Polar Plume", lat= -90.0, lon=   0.0),
         ]),
    dict(planet="Saturn", name="Tethys", conv=uv_centered_north,
         tex=f"{BASE}/planet_explorer/saturn/viewer/assets/tethys_color.jpg",
         features=[
             dict(name="Odysseus Crater",   lat=  32.8, lon= 231.1),
             dict(name="Ithaca Chasma",     lat= -14.0, lon= 353.9),
             dict(name="Telemachus Crater", lat=  54.0, lon=  20.6),
         ]),
    dict(planet="Saturn", name="Dione", conv=uv_left_north,
         tex=f"{BASE}/planet_explorer/saturn/viewer/assets/Dione_Color_Map.jpg",
         features=[
             dict(name="Wispy Terrain",  lat=  0.0, lon=  90.0),
             dict(name="Padua Chasmata", lat= 17.7, lon= 112.8),
             dict(name="Aeneas Crater",  lat= 25.9, lon= 313.7),
         ]),
    dict(planet="Saturn", name="Rhea", conv=uv_centered_north,
         tex=f"{BASE}/planet_explorer/saturn/viewer/assets/rhea_color_map.jpg",
         features=[
             dict(name="Inktomi Crater", lat= -14.1, lon= 247.9),
             dict(name="Tirawa Basin",   lat=  34.2, lon= 208.3),
             dict(name="Mamaldi Crater", lat= -14.0, lon= 318.0),
         ]),
    dict(planet="Saturn", name="Titan", conv=uv_centered_north,
         tex=f"{BASE}/planet_explorer/saturn/viewer/assets/titan_color_map.jpg",
         features=[
             dict(name="Kraken Mare",     lat=  68.0, lon=  50.0),
             dict(name="Ligeia Mare",     lat=  79.7, lon= 112.1),
             dict(name="Punga Mare",      lat=  85.1, lon=  20.3),
             dict(name="Xanadu",          lat= -15.0, lon= 260.0),
             dict(name="Shangri-La",      lat= -10.0, lon= 195.0),
             dict(name="Belet",           lat=  -5.0, lon= 105.0),
             dict(name="Huygens Landing", lat= -10.3, lon= 167.7),
         ]),

    # Uranus (West-positive + south-at-top)
    dict(planet="Uranus", name="Miranda", conv=uv_mirror_south,
         tex=f"{BASE}/planet_explorer/uranus/viewer/assets/miranda_color_map.jpg",
         features=[
             dict(name="Verona Rupes", lat= -22.8, lon= 347.8),
             dict(name="Arden Corona", lat= -35.0, lon=   0.0),
         ]),
    dict(planet="Uranus", name="Ariel", conv=uv_mirror_south,
         tex=f"{BASE}/planet_explorer/uranus/viewer/assets/ariel_color_map.jpg",
         features=[
             dict(name="Kachina Chasmata", lat= -9.0, lon= 246.0),
         ]),
    dict(planet="Uranus", name="Umbriel", conv=uv_mirror_south,
         tex=f"{BASE}/planet_explorer/uranus/viewer/assets/umbriel_color_map.jpg",
         features=[
             dict(name="Wunda Crater", lat= -7.9, lon= 273.6),
         ]),
    dict(planet="Uranus", name="Titania", conv=uv_mirror_south,
         tex=f"{BASE}/planet_explorer/uranus/viewer/assets/titania_color_map.jpg",
         features=[
             dict(name="Messina Chasma", lat= -33.3, lon= 335.0),
         ]),
    dict(planet="Uranus", name="Oberon", conv=uv_mirror_south,
         tex=f"{BASE}/planet_explorer/uranus/viewer/assets/oberon_color_map.jpg",
         features=[
             dict(name="Hamlet Crater", lat= -46.1, lon=  44.4),
         ]),

    # Neptune
    dict(planet="Neptune", name="Triton", conv=uv_left_north,
         tex=f"{BASE}/planet_explorer/neptune/viewer/assets/triton_color_map.jpg",
         features=[
             dict(name="Cipango Planum", lat=  11.5, lon=  34.0),
             dict(name="Hili Plume",     lat= -57.0, lon=  28.0),
             dict(name="South Polar Cap",lat= -75.0, lon=   0.0),
         ]),
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
        s = MAX_W / w; img = img.resize((int(w*s), int(h*s)), Image.LANCZOS); w, h = img.size

    draw = ImageDraw.Draw(img)
    r = max(8, min(w, h) // 50)

    # Grid lines
    for lat in [-60, -30, 0, 30, 60]:
        u0, v0 = moon["conv"](lat, 0)
        y = int(v0 * h)
        draw.line([(0, y), (w, y)], fill=(255,255,255, 50 if lat != 0 else 80), width=1)
    for lon in [0, 60, 120, 180, 240, 300]:
        u0, v0 = moon["conv"](0, lon)
        x = int(u0 * w)
        draw.line([(x, 0), (x, h)], fill=(255,255,255,40), width=1)

    for f in moon["features"]:
        u, v = moon["conv"](f["lat"], f["lon"])
        px = max(r, min(w-r, int(u*w)))
        py = max(r, min(h-r, int(v*h)))
        # White halo
        draw.ellipse([px-r-3, py-r-3, px+r+3, py+r+3], fill="white")
        # Colored dot
        draw.ellipse([px-r, py-r, px+r, py+r], fill="red")
        # Label
        draw.text((px+r+4, py-7), f["name"], fill="yellow")
        draw.text((px+r+4, py+7), f"({f['lat']:.1f}°, {f['lon']:.1f}°E)", fill="cyan")

    out = f"{OUT}/{moon['planet']}_{moon['name']}.jpg"
    img.save(out, quality=90)
    print(f"  {moon['planet']:8s} {moon['name']:10s} → {out}  [{w}×{h}]")

print("Generating annotations…")
for moon in MOONS:
    annotate(moon)
print(f"\nDone. All images in {OUT}/")
