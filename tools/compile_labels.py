#!/usr/bin/env python3
"""Compile every surface/moon label across all viewers into one CSV."""
import os, re, json, csv

VIEWERS = [
    ("mercury", "/home/owen/GeoID_webpage/planet_explorer/mercury/viewer"),
    ("venus",   "/home/owen/GeoID_webpage/planet_explorer/venus/viewer"),
    ("moon",    "/home/owen/GeoID_webpage/planet_explorer/moon/viewer"),
    ("mars",    "/home/owen/GeoID_webpage/planet_explorer/mars/viewer"),
    ("jupiter", "/home/owen/GeoID_webpage/planet_explorer/jupiter/viewer"),
    ("saturn",  "/home/owen/GeoID_webpage/planet_explorer/saturn/viewer"),
    ("uranus",  "/home/owen/GeoID_webpage/planet_explorer/uranus/viewer"),
    ("neptune", "/home/owen/GeoID_webpage/planet_explorer/neptune/viewer"),
    ("pluto",   "/home/owen/GeoID_webpage/planet_explorer/pluto/viewer"),
]
VIEWER_JS = {
    "mercury":"mercury-viewer.js","venus":"venus-viewer.js","moon":"moon-viewer.js",
    "mars":"mars-viewer.js","jupiter":"jupiter-viewer.js","saturn":"saturn-viewer.js",
    "uranus":"uranus-viewer.js","neptune":"neptune-viewer.js","pluto":"pluto-viewer.js",
}
THEME_COLOR = {
    "volcanic":"#ff5849","mission":"#62de84","moon":"#ffffff","moon-poi":"#3aeee8",
    "moon-feature":"#3aeee8","habitation":"#5cde76","crater":"#ff5faa","tectonic":"#d4965a",
    "fluvial":"#2d78e0","landing":"#ffe500","storm":"#ffaa55","polar":"#a8d0ff","band":"#c8a8e0",
    "surface":"#34d7d1","standard":"#34d7d1",
}
def crater_match(t):
    t = (t or "").lower().strip(); return t in ("impact crater","crater")
def volcanic_match(t, theme):
    return bool(re.search(r"(?:cryo)?volcan|patera|caldera|plume|vent|eruption|lava|basalt|fluctus|tholus|corona|farrum",
                          f"{t or ''} {theme or ''}".lower()))
_TECT_RE = re.compile(r"^(chasma|fossa|sulcus|rupes|dorsum|cavus|labyrinthus|linea|scopulus|tessera|graben)$")
_FLUV_RE = re.compile(r"^(vallis|catena|flumen|rima)$")
def derive_category(item, is_moon=False):
    t = (item.get("type") or "").strip().lower()
    if volcanic_match(item.get("type",""), item.get("theme","")): return "volcanic"
    if crater_match(t): return "crater"
    if _FLUV_RE.match(t): return "fluvial"
    if _TECT_RE.match(t): return "tectonic"
    if is_moon: return "moon-feature"
    theme = (item.get("theme") or "").lower()
    return theme if theme in {"landing","mission","habitation","storm","polar","band","moon","moon-poi","moon-feature"} else "surface"
def first_sentence(desc):
    if not desc: return ""
    txt = re.sub(r'["\;]+', "", str(desc))
    # Split only on sentence-ending punctuation followed by a space and uppercase
    # word — that way "C. Herschel" / "J.M. Barrie" don't get truncated.
    # Only split if at least two lowercase letters precede the period — avoids
    # truncating at abbreviated initials like "C. Herschel" or "J.M. Barrie".
    m = re.split(r"(?<=[a-z]{2}[.!?])\s+(?=[A-Z])", txt, maxsplit=1)
    return m[0].rstrip(".!? ").strip()[:140]

def js_to_json(arr_text):
    """Best-effort: quote unquoted object keys so json.loads accepts it."""
    # Insert quotes around bare identifier keys: { foo: ... } -> { "foo": ... }
    s = re.sub(r"([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:", r'\1"\2":', arr_text)
    # (Don't touch single quotes — descriptions contain apostrophes.)
    # Strip trailing commas
    s = re.sub(r",(\s*[\]\}])", r"\1", s)
    return s

def parse_array(js, var_name):
    pat = re.compile(rf"const\s+{var_name}\s*=\s*(\[.*?\n?\s*\]);", re.DOTALL)
    m = pat.search(js)
    if not m: return []
    arr = m.group(1)
    for fn in (lambda x: x, js_to_json):
        try: return json.loads(fn(arr))
        except Exception: continue
    return []

def load_json_file(path):
    if os.path.exists(path):
        try: return json.load(open(path))
        except Exception: return []
    return []

rows = []
for planet, vdir in VIEWERS:
    js_path = os.path.join(vdir, VIEWER_JS[planet])
    js = open(js_path).read()
    labels = parse_array(js, "labelData") or load_json_file(os.path.join(vdir, "label-data.json"))
    moon_feats = parse_array(js, "moonFeatureData")
    if not moon_feats:
        m = re.search(r"const\s+moonFeatureData\s*=\s*\[([^;]+?)\];", js)
        if m:
            for var in re.findall(r"\.\.\.(\w+)", m.group(1)):
                moon_feats.extend(parse_array(js, var))
    print(f"{planet}: {len(labels)} surface + {len(moon_feats)} moon features")
    for item in labels:
        cat = derive_category(item, is_moon=False)
        rows.append({"name": item.get("name",""), "body": planet.capitalize(),
            "kind": "surface", "type": item.get("type",""), "category": cat,
            "theme": item.get("theme",""), "color": THEME_COLOR.get(cat, "#34d7d1"),
            "lat": item.get("lat",""), "lon": item.get("lon",""),
            "lod": item.get("lod",""), "dimension": item.get("dimension",""),
            "description": first_sentence(item.get("description",""))})
    for item in moon_feats:
        cat = derive_category(item, is_moon=True)
        rows.append({"name": item.get("name",""),
            "body": item.get("moon_name") or item.get("parent_moon") or "",
            "kind": f"moon-of-{planet}", "type": item.get("type",""), "category": cat,
            "theme": item.get("theme",""), "color": THEME_COLOR.get(cat, "#3aeee8"),
            "lat": item.get("lat", item.get("anchor_lat","")),
            "lon": item.get("lon", item.get("anchor_lon","")),
            "lod": item.get("lod",""), "dimension": item.get("dimension",""),
            "description": first_sentence(item.get("description",""))})

out_path = "/home/owen/GeoID_webpage/location_check/labels_compiled.csv"
with open(out_path, "w", newline="") as fh:
    cols = ["name","body","kind","type","category","theme","color","lat","lon","lod","dimension","description"]
    w = csv.DictWriter(fh, fieldnames=cols); w.writeheader()
    for r in rows: w.writerow(r)
print(f"\nWrote {len(rows)} rows -> {out_path}")
