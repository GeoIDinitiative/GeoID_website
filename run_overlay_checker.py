#!/usr/bin/env python3
"""
Overlay checker: plots BOTH reference coords (red) and viewer-JS coords (lime)
on the same texture image so any discrepancy is immediately visible.

  Red  dot = verified reference position (run_checker.py source)
  Lime dot = position encoded in the viewer JS file

Dots that coincide → coordinates are consistent.
Dots that are offset → the viewer JS has a wrong coordinate.

Output: test_maps_overlay/<planet>_<moon>.jpg
"""
import os
from PIL import Image, ImageDraw

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SCRIPT_DIR, "test_maps_overlay")
os.makedirs(OUT, exist_ok=True)

BASE = "/home/owen/GeoID_webpage"

# ── UV conventions ──────────────────────────────────────────────────────────
def uv_left_north(lat, lon):
    return ((lon % 360) / 360, (90 - lat) / 180)

def uv_centered_north(lat, lon):
    """Centered west-positive. Saturn USGS high-res textures are west-positive (old IAU).
    lon is east-positive (IAU 2015); converts to west-positive internally."""
    lon_west = (360 - lon) % 360
    return (((lon_west % 360) + 180) % 360 / 360, (90 - lat) / 180)

def uv_mirror_south(lat, lon):
    return (1 - (lon % 360) / 360, (lat + 90) / 180)

# ── Moon data: reference coords vs viewer-JS coords ─────────────────────────
# Each entry: tex path, conv fn, list of features.
# Each feature: name, ref=(lat,lon), viewer=(lat,lon)
# If ref == viewer the coords are in sync.
MOONS = [
    # ── Jupiter ──────────────────────────────────────────────────────────────
    dict(planet="Jupiter", name="Io", conv=uv_left_north,
         tex=f"{BASE}/planet_explorer/jupiter/viewer/assets/io_color_map.jpg",
         features=[
             dict(name="Loki Patera",      ref=(12.6, 51.2),   viewer=(12.6, 51.2)),
             dict(name="Prometheus Plume", ref=(-1.5, 206.1),  viewer=(-1.5, 206.1)),
         ]),
    dict(planet="Jupiter", name="Europa", conv=uv_left_north,
         tex=f"{BASE}/planet_explorer/jupiter/viewer/assets/europa_color_map.jpg",
         features=[
             dict(name="Conamara Chaos", ref=(9.7, 86.0),   viewer=(9.7, 86.0)),
             dict(name="Chaos Terrain",  ref=(0.0, 270.0),  viewer=(0.0, 270.0)),
         ]),
    dict(planet="Jupiter", name="Ganymede", conv=uv_left_north,
         tex=f"{BASE}/planet_explorer/jupiter/viewer/assets/ganymede_color_map.jpg",
         features=[
             dict(name="Galileo Regio", ref=(20.0, 235.0), viewer=(20.0, 235.0)),
             dict(name="Uruk Sulcus",   ref=(0.0, 160.0),  viewer=(0.0, 160.0)),
         ]),
    dict(planet="Jupiter", name="Callisto", conv=uv_left_north,
         tex=f"{BASE}/planet_explorer/jupiter/viewer/assets/callisto_color_map.jpg",
         features=[
             dict(name="Valhalla Basin", ref=(15.9, 304.0), viewer=(15.9, 304.0)),
             dict(name="Asgard Basin",   ref=(30.0, 218.0), viewer=(30.0, 218.0)),
         ]),

    # ── Saturn leftNorth ─────────────────────────────────────────────────────
    dict(planet="Saturn", name="Mimas", conv=uv_left_north,
         tex=f"{BASE}/planet_explorer/saturn/viewer/assets/mimas_color_map.jpg",
         features=[
             dict(name="Herschel Crater",    ref=(-1.4, 248.2), viewer=(-1.4, 248.2)),
             dict(name="Leading Hemisphere", ref=(0.0, 270.0),  viewer=(0.0, 270.0)),
         ]),
    dict(planet="Saturn", name="Iapetus", conv=uv_left_north,
         tex=f"{BASE}/planet_explorer/saturn/viewer/assets/iapetus_color_map.jpg",
         features=[
             dict(name="Cassini Regio",   ref=(-28.1, 267.4), viewer=(-28.1, 267.4)),
             dict(name="Roncevaux Terra", ref=(37.0, 120.5),  viewer=(37.0, 120.5)),
             dict(name="Turgis Crater",   ref=(16.9, 331.6),  viewer=(16.9, 331.6)),
         ]),

    # ── Saturn centeredNorth ─────────────────────────────────────────────────
    dict(planet="Saturn", name="Enceladus", conv=uv_centered_north,
         tex=f"{BASE}/planet_explorer/saturn/viewer/assets/enceladus_color_map.jpg",
         features=[
             dict(name="Damascus Sulcus",     ref=(-80.6, 74.1),  viewer=(-80.6, 74.1)),
             dict(name="Baghdad Sulcus",      ref=(-86.9, 129.5), viewer=(-86.9, 129.5)),
             dict(name="Cairo Sulcus",        ref=(-81.6, 205.5), viewer=(-81.6, 205.5)),
             dict(name="South Polar Plume",   ref=(-90.0, 0.0),   viewer=(-90.0, 0.0)),
         ]),
    dict(planet="Saturn", name="Tethys", conv=uv_centered_north,
         tex=f"{BASE}/planet_explorer/saturn/viewer/assets/tethys_color.jpg",
         features=[
             dict(name="Odysseus Crater",   ref=(32.8, 231.1), viewer=(32.8, 231.1)),
             dict(name="Ithaca Chasma",     ref=(-14.0, 353.9),viewer=(-14.0, 353.9)),
             dict(name="Telemachus Crater", ref=(54.0, 20.6),  viewer=(54.0, 20.6)),
         ]),
    dict(planet="Saturn", name="Dione", conv=uv_left_north,
         tex=f"{BASE}/planet_explorer/saturn/viewer/assets/Dione_Color_Map.jpg",
         features=[
             dict(name="Wispy Terrain",  ref=(0.0, 90.0),   viewer=(0.0, 90.0)),
             dict(name="Padua Chasmata", ref=(17.7, 112.8), viewer=(17.7, 112.8)),
             dict(name="Aeneas Crater",  ref=(25.9, 313.7), viewer=(25.9, 313.7)),
         ]),
    dict(planet="Saturn", name="Rhea", conv=uv_centered_north,
         tex=f"{BASE}/planet_explorer/saturn/viewer/assets/rhea_color_map.jpg",
         features=[
             dict(name="Inktomi Crater", ref=(-14.1, 247.9), viewer=(-14.1, 247.9)),
             dict(name="Tirawa Basin",   ref=(34.2, 208.3),  viewer=(34.2, 208.3)),
             dict(name="Mamaldi Crater", ref=(-14.0, 318.0), viewer=(-14.0, 318.0)),
         ]),
    dict(planet="Saturn", name="Titan", conv=uv_centered_north,
         tex=f"{BASE}/planet_explorer/saturn/viewer/assets/titan_color_map.jpg",
         features=[
             dict(name="Kraken Mare",     ref=(68.0, 50.0),  viewer=(68.0, 50.0)),
             dict(name="Ligeia Mare",     ref=(79.7, 112.1), viewer=(79.7, 112.1)),
             dict(name="Punga Mare",      ref=(85.1, 20.3),  viewer=(85.1, 20.3)),
             dict(name="Xanadu",          ref=(-15.0, 260.0),viewer=(-15.0, 260.0)),
             dict(name="Shangri-La",      ref=(-10.0, 195.0),viewer=(-10.0, 195.0)),
             dict(name="Belet",           ref=(-5.0, 105.0), viewer=(-5.0, 105.0)),
             dict(name="Huygens Landing", ref=(-10.3, 167.7),viewer=(-10.3, 167.7)),
         ]),

    # ── Uranus mirrorUSouth ───────────────────────────────────────────────────
    dict(planet="Uranus", name="Miranda", conv=uv_mirror_south,
         tex=f"{BASE}/planet_explorer/uranus/viewer/assets/miranda_color_map.jpg",
         features=[
             dict(name="Verona Rupes", ref=(-22.8, 347.8), viewer=(-22.8, 347.8)),
             dict(name="Arden Corona", ref=(-35.0, 0.0),   viewer=(-35.0, 0.0)),
         ]),
    dict(planet="Uranus", name="Ariel", conv=uv_mirror_south,
         tex=f"{BASE}/planet_explorer/uranus/viewer/assets/ariel_color_map.jpg",
         features=[
             dict(name="Kachina Chasmata", ref=(-9.0, 246.0), viewer=(-9.0, 246.0)),
         ]),
    dict(planet="Uranus", name="Umbriel", conv=uv_mirror_south,
         tex=f"{BASE}/planet_explorer/uranus/viewer/assets/umbriel_color_map.jpg",
         features=[
             dict(name="Wunda Crater", ref=(-7.9, 273.6), viewer=(-7.9, 273.6)),
         ]),
    dict(planet="Uranus", name="Titania", conv=uv_mirror_south,
         tex=f"{BASE}/planet_explorer/uranus/viewer/assets/titania_color_map.jpg",
         features=[
             dict(name="Messina Chasma", ref=(-33.3, 335.0), viewer=(-33.3, 335.0)),
         ]),
    dict(planet="Uranus", name="Oberon", conv=uv_mirror_south,
         tex=f"{BASE}/planet_explorer/uranus/viewer/assets/oberon_color_map.jpg",
         features=[
             dict(name="Hamlet Crater", ref=(-46.1, 44.4), viewer=(-46.1, 44.4)),
         ]),

    # ── Neptune ───────────────────────────────────────────────────────────────
    dict(planet="Neptune", name="Triton", conv=uv_left_north,
         tex=f"{BASE}/planet_explorer/neptune/viewer/assets/triton_color_map.jpg",
         features=[
             dict(name="Cipango Planum", ref=(11.5, 34.0),  viewer=(11.5, 34.0)),
             dict(name="Hili Plume",     ref=(-57.0, 28.0), viewer=(-57.0, 28.0)),
             dict(name="South Polar Cap",ref=(-75.0, 0.0),  viewer=(-75.0, 0.0)),
         ]),
]

# ── Render ──────────────────────────────────────────────────────────────────
MAX_W = 1400
MISMATCH_THRESHOLD_PX = 4  # dots closer than this are considered "same"


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
        draw.line([(0, y), (w, y)], fill=(255, 255, 255, 40), width=1)
    for lon in [0, 60, 120, 180, 240, 300]:
        u0, _ = moon["conv"](0, lon)
        x = int(u0 * w)
        draw.line([(x, 0), (x, h)], fill=(255, 255, 255, 30), width=1)

    mismatches = []

    for f in moon["features"]:
        ur, vr = moon["conv"](*f["ref"])
        uv, vv = moon["conv"](*f["viewer"])
        rx = max(r, min(w - r, int(ur * w)))
        ry = max(r, min(h - r, int(vr * h)))
        vx = max(r, min(w - r, int(uv * w)))
        vy = max(r, min(h - r, int(vv * h)))

        same = abs(rx - vx) <= MISMATCH_THRESHOLD_PX and abs(ry - vy) <= MISMATCH_THRESHOLD_PX

        if not same:
            mismatches.append(f["name"])
            # Orange line connecting the two positions
            draw.line([(rx, ry), (vx, vy)], fill="orange", width=2)

        # Always draw viewer dot first (lime, larger) then reference dot on top (red, smaller).
        # When coords match this produces a red bullseye inside a lime ring — both visible.
        # When coords differ the two dots are separate with an orange connector.
        ri = r        # inner radius for reference dot
        ro = r + 5    # outer radius for viewer dot

        # Viewer (lime) — drawn first so reference sits on top when overlapping
        draw.ellipse([vx - ro - 2, vy - ro - 2, vx + ro + 2, vy + ro + 2], fill="white")
        draw.ellipse([vx - ro,     vy - ro,     vx + ro,     vy + ro    ], fill="lime")

        # Reference (red) — drawn on top
        draw.ellipse([rx - ri, ry - ri, rx + ri, ry + ri], fill="red")

        # Label — anchor to the reference position
        if same:
            draw.text((rx + ro + 4, ry - 7), f["name"], fill="yellow")
            draw.text((rx + ro + 4, ry + 7),
                      f"({f['ref'][0]:.1f}°, {f['ref'][1]:.1f}°E) ✓", fill="#00ff88")
        else:
            draw.text((rx + ri + 4, ry - 14), f["name"] + " [REF]", fill="#ff8888")
            draw.text((rx + ri + 4, ry),
                      f"({f['ref'][0]:.1f}°, {f['ref'][1]:.1f}°E)", fill="#ff8888")
            draw.text((vx + ro + 4, vy - 7), f["name"] + " [VIEWER]", fill="#88ff88")
            draw.text((vx + ro + 4, vy + 7),
                      f"({f['viewer'][0]:.1f}°, {f['viewer'][1]:.1f}°E)", fill="#88ff88")

    status = "OK" if not mismatches else f"MISMATCH: {', '.join(mismatches)}"
    out = f"{OUT}/{moon['planet']}_{moon['name']}.jpg"
    img.save(out, quality=90)
    print(f"  {moon['planet']:8s} {moon['name']:10s}  {status}")
    return mismatches


print("Generating overlay consistency maps…\n")
all_mismatches = {}
for moon in MOONS:
    mm = annotate(moon)
    if mm:
        all_mismatches[f"{moon['planet']} {moon['name']}"] = mm

print(f"\nDone. Images in {OUT}/")
if all_mismatches:
    print("\n⚠  MISMATCHES DETECTED:")
    for body, feats in all_mismatches.items():
        print(f"   {body}: {', '.join(feats)}")
else:
    print("\n✓  All reference and viewer-JS coordinates are consistent.")
