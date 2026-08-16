#!/usr/bin/env python3
"""Prepare the prototype's input vectors for shipping with the site.

The bedrock geology went through this and the other two never did, so the
superficial-geology and rivers tick boxes pointed at files that were not
there — a 404 per press, which is what "geology polygons missing" was.

The rule is the same one the bedrock followed: simplify to about 50 m, well
below the 1:625k source's own precision, keep every attribute (the popup reads
them, so dropping a column removes a line from the description), and round
coordinates to five decimals — 1.1 m, an order of magnitude finer than the
simplification, so the rounding never decides a shape.

Rivers are cut to `waterway=river`. The 26,429 streams are real and they are
also 26,429 lines drawn across two degrees of globe; the rivers are what the
flood recipe used.

    python3 GeoID_GIS/docs/ni-prototype/ship-inputs.py

Reads ~/geoid_projects/earth/ni-prototype/data/raw/, writes ni-prototype/data/.
"""

import json
import pathlib
import sys

SRC = pathlib.Path.home() / "geoid_projects/earth/ni-prototype/data/raw"
DST = pathlib.Path(__file__).resolve().parents[3] / "ni-prototype/data"
TOL = 0.0005  # degrees ≈ 55 m of latitude; the source is 1:625,000.
DP = 5        # 1.1 m — finer than TOL by a decade, so it is never the deciding cut.


def perpendicular(p, a, b):
    """Distance from p to the segment ab, in degrees. Longitude is not scaled:
    at 55°N a degree of longitude is 0.57 of a degree of latitude, so this is
    mildly generous east-west. Being generous in one axis costs vertices, never
    accuracy of the retained ones."""
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return ((px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2) ** 0.5


def simplify(points, tol=TOL):
    """Douglas–Peucker, iterative so a 30,000-point ring cannot blow the stack."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        lo, hi = stack.pop()
        if hi <= lo + 1:
            continue
        worst, index = tol, -1
        for i in range(lo + 1, hi):
            d = perpendicular(points[i], points[lo], points[hi])
            if d > worst:
                worst, index = d, i
        if index >= 0:
            keep[index] = True
            stack.append((lo, index))
            stack.append((index, hi))
    return [p for p, k in zip(points, keep) if k]


def round_pt(p):
    return [round(p[0], DP), round(p[1], DP)]


def do_ring(ring, closed):
    out = [round_pt(p) for p in simplify([tuple(p[:2]) for p in ring])]
    if closed:
        # A ring that simplification has taken below a triangle is no longer a
        # ring. Returning it anyway produces a polygon with no area, which
        # every downstream op then has to special-case.
        if len(out) < 4:
            return None
        out[-1] = out[0]
    elif len(out) < 2:
        return None
    return out


def do_geometry(geom):
    kind = geom.get("type")
    c = geom.get("coordinates")
    if kind == "Polygon":
        rings = [r for r in (do_ring(x, True) for x in c) if r]
        return {"type": "Polygon", "coordinates": rings} if rings else None
    if kind == "MultiPolygon":
        polys = []
        for poly in c:
            rings = [r for r in (do_ring(x, True) for x in poly) if r]
            if rings:
                polys.append(rings)
        return {"type": "MultiPolygon", "coordinates": polys} if polys else None
    if kind == "LineString":
        line = do_ring(c, False)
        return {"type": "LineString", "coordinates": line} if line else None
    if kind == "MultiLineString":
        lines = [l for l in (do_ring(x, False) for x in c) if l]
        return {"type": "MultiLineString", "coordinates": lines} if lines else None
    return geom


def ship(name, keep=None):
    src = SRC / f"{name}.geojson"
    if not src.exists():
        print(f"  ! {src} is not there", file=sys.stderr)
        return
    data = json.loads(src.read_text())
    before = after = 0
    out = []
    for feature in data["features"]:
        if keep and not keep(feature["properties"]):
            continue
        geom = feature.get("geometry")
        if not geom:
            continue
        before += sum(len(json.dumps(geom)) for _ in (0,))
        simple = do_geometry(geom)
        if not simple:
            continue
        after += len(json.dumps(simple))
        out.append({"type": "Feature", "properties": feature["properties"],
                    "geometry": simple})
    dst = DST / f"{name}.geojson"
    dst.write_text(json.dumps({"type": "FeatureCollection", "features": out}))
    print(f"  {name}: {len(data['features'])} → {len(out)} features, "
          f"{src.stat().st_size / 1e6:.1f} MB → {dst.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    DST.mkdir(parents=True, exist_ok=True)
    ship("ni_superficial")
    ship("ni_rivers", keep=lambda p: p.get("waterway") == "river")
