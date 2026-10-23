#!/usr/bin/env python3
"""Bake the global infrastructure layers into data/global/.

What a hazard would hit, as point and line files the catalogue's
Hazards ▸ Infrastructure subtab offers and `infrastructure.js` counts inside a
hazard footprint:

  ports-wpi.geojson            NGA World Port Index (Pub. 150) — 3,807 ports
  airports_10m.geojson         Natural Earth 1:10m airports
  populated_places_10m.geojson Natural Earth 1:10m populated places (simple)
  railroads_10m.geojson        Natural Earth 1:10m railroads

Sources, all public domain:
  NGA Maritime Safety Information, World Port Index — a US Government work.
  Natural Earth — "no permission needed" (naturalearthdata.com/about/terms-of-use).

EVERY FEATURE CARRIES `type`, a sentence-sized noun for what it is ("Large
seaport — coastal, breakwater", "Major airport", "National capital"), because
`type` is the field the feature card heads itself with. A port whose card says
"Mapped point" has told the reader nothing they could not see.

`rank` is 1 for the most important and rises from there, the convention the
road connector already uses, so the exposure readout can list the biggest
ports and cities first whatever layer they come from.

Usage:  python3 bake-infrastructure.py [--work DIR] [--wpi PATH_OR_URL]
The work directory keeps the downloads, so a re-run fetches nothing it has.
"""
import argparse, csv, io, json, os, sys, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "data", "global")
NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
# The download key NGA's publications page links; it changes when NGA reissues
# the file, so --wpi takes a path or a newer URL.
WPI = ("https://msi.nga.mil/api/publications/download?type=view"
       "&key=16920959/SFH00000/UpdatedPub150.csv")
UA = "Mozilla/5.0 (GeoID-Initiative infrastructure bake; https://geoidinitiative.com)"


def fetch(url, work, name):
    path = os.path.join(work, name)
    if not os.path.exists(path):
        print(f"  fetching {url}")
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=300) as r, open(path, "wb") as f:
            f.write(r.read())
    return path


def rounded(coords, places):
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], places), round(coords[1], places)]
    return [rounded(c, places) for c in coords]


def thin(line, step):
    """Keep a vertex once the line has moved `step` degrees; always the ends."""
    if len(line) <= 2:
        return line
    out = [line[0]]
    for p in line[1:-1]:
        if abs(p[0] - out[-1][0]) + abs(p[1] - out[-1][1]) >= step:
            out.append(p)
    out.append(line[-1])
    return out


def blank(v):
    return v is None or str(v).strip() in ("", "Unknown", "0.0", "0")


def num(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x > 0 else None


def write(name, features, note):
    path = os.path.join(OUT, name)
    fc = {"type": "FeatureCollection", "_source": note, "features": features}
    with open(path, "w") as f:
        json.dump(fc, f, separators=(",", ":"), ensure_ascii=False)
    print(f"  {name}: {len(features):,} features, {os.path.getsize(path) / 1e6:.2f} MB")


# ── ports ────────────────────────────────────────────────────────────────────

PORT_RANK = {"Large": 1, "Medium": 2, "Small": 3, "Very Small": 4}
# The facilities a reader asks a port about when a hazard is near it: what it
# handles. The WPI's other eighty columns (pilotage, quarantine, cranes by
# tonnage) are a mariner's, and are a click away on the NGA record.
FACILITIES = [
    ("Facilities - Container", "containers"), ("Facilities - Oil Terminal", "oil terminal"),
    ("Facilities - LNG Terminal", "LNG terminal"), ("Facilities - Solid Bulk", "dry bulk"),
    ("Facilities - Liquid Bulk", "liquid bulk"), ("Facilities - Ro-Ro", "ro-ro"),
    ("Facilities - Breakbulk", "breakbulk"), ("Dry Dock", "dry dock"),
]


def port_type(size, harbour):
    noun = f"{size.lower()} seaport" if size else "seaport"
    noun = noun[0].upper() + noun[1:]
    if not harbour:
        return noun
    # "Coastal (Breakwater)" -> "coastal, breakwater"
    h = harbour.replace(" (", ", ").replace(")", "").lower()
    return f"{noun} — {h}"


def bake_ports(work, wpi):
    path = wpi if os.path.exists(wpi) else fetch(wpi, work, "wpi.csv")
    with open(path, encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    out = []
    for r in rows:
        try:
            lat, lon = float(r["Latitude"]), float(r["Longitude"])
        except ValueError:
            continue
        size = r["Harbor Size"].strip()
        harbour = r["Harbor Type"].strip()
        handles = [label for col, label in FACILITIES if r.get(col, "").strip() == "Yes"
                   or (col == "Dry Dock" and r.get(col, "").strip() not in ("", "Unknown", "None"))]
        props = {
            "name": r["Main Port Name"].strip(),
            "type": port_type(size, harbour),
            "country": r["Country Code"].strip(),
            "harbour_size": size or None,
            "harbour_type": harbour or None,
            "harbour_use": None if blank(r["Harbor Use"]) else r["Harbor Use"].strip(),
            "shelter": None if blank(r["Shelter Afforded"]) else r["Shelter Afforded"].strip(),
            "handles": ", ".join(handles) or None,
            "channel_depth_m": num(r["Channel Depth (m)"]),
            "max_vessel_length_m": num(r["Maximum Vessel Length (m)"]),
            "locode": None if blank(r["UN/LOCODE"]) else r["UN/LOCODE"].strip(),
            "water_body": r["World Water Body"].strip() or None,
            "wpi_number": int(float(r["World Port Index Number"])),
            "rank": PORT_RANK.get(size, 5),
        }
        out.append({"type": "Feature", "properties": {k: v for k, v in props.items() if v is not None},
                    "geometry": {"type": "Point", "coordinates": rounded([lon, lat], 4)}})
    out.sort(key=lambda f: f["properties"]["rank"])
    write("ports-wpi.geojson", out, "NGA World Port Index (Pub. 150), public domain; "
          "type and rank derived from Harbor Size and Harbor Type by bake-infrastructure.py")


# ── airports ─────────────────────────────────────────────────────────────────

def airport_type(t):
    t = (t or "").strip()
    if t == "spaceport":
        return "Spaceport", 2
    military = "military" in t
    size = "Major" if "major" in t else "Regional" if "mid" in t else "Small" if "small" in t else ""
    if military and "and military" in t:
        return f"{size} airport, shared with the military".strip(), 1 if size == "Major" else 2
    if military:
        return f"{size} military airfield".strip().capitalize(), 3
    return f"{size} airport".strip(), {"Major": 1, "Regional": 2}.get(size, 3)


def bake_airports(work):
    d = json.load(open(fetch(NE + "ne_10m_airports.geojson", work, "ne_10m_airports.geojson")))
    out = []
    for f in d["features"]:
        p = f["properties"]
        kind, rank = airport_type(p.get("type"))
        props = {
            "name": p.get("name_en") or p.get("name"),
            "type": kind,
            "iata": p.get("iata_code") or None,
            "icao": p.get("gps_code") or None,
            "wikipedia": p.get("wikipedia") or None,
            "rank": rank,
        }
        out.append({"type": "Feature", "properties": {k: v for k, v in props.items() if v is not None},
                    "geometry": {"type": "Point", "coordinates": rounded(f["geometry"]["coordinates"], 4)}})
    out.sort(key=lambda f: f["properties"]["rank"])
    write("airports_10m.geojson", out, "Natural Earth 1:10m ne_10m_airports, public domain")


# ── populated places ─────────────────────────────────────────────────────────

PLACE_TYPE = {
    "Admin-0 capital": "National capital", "Admin-0 capital alt": "National capital (second seat)",
    "Admin-0 region capital": "Territory capital", "Admin-1 capital": "Provincial capital",
    "Admin-1 region capital": "Regional capital", "Populated place": "City or town",
    "Populated Place": "City or town", "Scientific station": "Research station",
    "Meteorological Station": "Weather station", "Historic place": "Historic place",
}


def bake_places(work):
    d = json.load(open(fetch(NE + "ne_10m_populated_places_simple.geojson", work,
                             "ne_10m_populated_places_simple.geojson")))
    out = []
    for f in d["features"]:
        p = f["properties"]
        pop = int(p["pop_max"]) if (p.get("pop_max") or 0) > 0 else None
        kind = PLACE_TYPE.get(p.get("featurecla"), "City or town")
        if p.get("megacity") == 1 and kind == "City or town":
            kind = "Major city"
        props = {
            "name": p.get("name"),
            "type": kind,
            "country": p.get("adm0name"),
            "region": p.get("adm1name") or None,
            "population": pop,
            # Natural Earth's own significance rank (0 = world city); kept as
            # `rank` so the readout lists the biggest places first.
            "rank": int(p.get("scalerank", 10)) + 1,
        }
        out.append({"type": "Feature", "properties": {k: v for k, v in props.items() if v is not None},
                    "geometry": {"type": "Point", "coordinates": rounded(f["geometry"]["coordinates"], 4)}})
    out.sort(key=lambda f: (f["properties"]["rank"], -(f["properties"].get("population") or 0)))
    write("populated_places_10m.geojson", out, "Natural Earth 1:10m ne_10m_populated_places_simple, public domain")


# ── railroads ────────────────────────────────────────────────────────────────

RAIL_TYPE = {1: "Main line", 2: "Secondary line", 3: "Branch line", 6: "Rapid transit", 7: "Rapid transit",
             9: "Railway", 0: "Railway"}


def bake_rail(work):
    d = json.load(open(fetch(NE + "ne_10m_railroads.geojson", work, "ne_10m_railroads.geojson")))
    out = []
    for f in d["features"]:
        p = f["properties"]
        g = f["geometry"]
        if not g or g["type"] not in ("LineString", "MultiLineString"):
            continue
        cat = int(p.get("category") or 0)
        kind = RAIL_TYPE.get(cat, "Railway")
        if p.get("electric") == 1:
            kind += ", electrified"
        props = {"type": kind, "tracks": int(p["mult_track"]) if (p.get("mult_track") or 0) > 1 else None,
                 "continent": p.get("continent") or None, "rank": cat if cat in (1, 2, 3) else 4}
        # 3 decimals (110 m), and a vertex only where the line has moved 5 km
        # since the last one kept: the source is digitised far denser than a
        # 1:10m line can mean, and at full density this file was 26 MB.
        lines = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]
        lines = [thin(rounded(c, 3), 0.05) for c in lines]
        lines = [c for c in lines if len(c) >= 2]
        if not lines:
            continue
        geom = ({"type": "LineString", "coordinates": lines[0]} if len(lines) == 1
                else {"type": "MultiLineString", "coordinates": lines})
        out.append({"type": "Feature", "properties": {k: v for k, v in props.items() if v is not None},
                    "geometry": geom})
    write("railroads_10m.geojson", out, "Natural Earth 1:10m ne_10m_railroads, public domain")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--work", default=os.path.join(OUT, ".infrastructure-work"))
    ap.add_argument("--wpi", default=WPI, help="World Port Index CSV: a path, or the NGA download URL")
    a = ap.parse_args()
    os.makedirs(a.work, exist_ok=True)
    bake_ports(a.work, a.wpi)
    bake_airports(a.work)
    bake_places(a.work)
    bake_rail(a.work)


if __name__ == "__main__":
    sys.exit(main())
