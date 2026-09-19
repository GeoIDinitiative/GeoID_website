#!/usr/bin/env python3
"""Remove the stray points ogr2ogr leaves in a LINE dataset.

Written at COORDINATE_PRECISION=4 (about 11 m), a border or graticule segment
shorter than that rounds to one coordinate, and GDAL writes it as a Point --
on its own, or as a Point inside a GeometryCollection beside the feature's
real lines. A line layer then draws those as markers: two dots on Cyprus
where Northern Cyprus meets the Dhekelia base area, one on the Date Line.

Points are dropped; a collection keeps its lines as a LineString or a
MultiLineString; a feature left with nothing is removed. Line vertices are
untouched. Idempotent.

    python3 GeoID_GIS/services/strip-stray-points.py data/global/boundaries_10m.geojson ...
"""
import json, sys

def lines_of(g):
    if not g: return []
    t = g["type"]
    if t == "LineString": return [g["coordinates"]]
    if t == "MultiLineString": return list(g["coordinates"])
    if t == "GeometryCollection": return [p for x in g["geometries"] for p in lines_of(x)]
    return []

def clean(path):
    d = json.load(open(path))
    kept, dropped = [], 0
    for f in d["features"]:
        g = f.get("geometry")
        if g and g["type"] in ("LineString", "MultiLineString"):
            kept.append(f); continue
        parts = [p for p in lines_of(g) if len(p) >= 2]
        dropped += 1
        if not parts: continue
        f["geometry"] = {"type": "LineString", "coordinates": parts[0]} if len(parts) == 1 \
            else {"type": "MultiLineString", "coordinates": parts}
        kept.append(f)
    d["features"] = kept
    with open(path, "w") as out:
        json.dump(d, out, separators=(",", ":"))
    print(f"{path}: {dropped} feature(s) cleaned, {len(kept)} kept")

for p in sys.argv[1:]: clean(p)
