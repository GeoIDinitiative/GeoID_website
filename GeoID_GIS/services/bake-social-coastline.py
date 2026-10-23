#!/usr/bin/env python3
"""Bake the GeoHUB Social map's coastline: a light world outline in the style
of the old Earth Explorer hero tile (dark sea, faint land, thin coast).

    python3 GeoID_GIS/services/bake-social-coastline.py

Reads data/global/coastline_10m.geojson (Natural Earth 1:10m, public domain)
and writes social/assets/coastline.json: [[lon, lat, lon, lat, ...], ...],
one flat array per line, rounded to 0.01 deg.

WHY A BAKE AND NOT THE 10 MB FILE. The map draws the whole world at once on
a 2D canvas; 411,000 vertices is several seconds of parsing for a picture
that is a few hundred pixels wide. Douglas-Peucker at 0.12 deg keeps every
shape a reader would recognise at the zoom the page allows, and lines shorter
than ~2.5 deg of perimeter (rocks, atolls) are dropped -- they would be a
pixel each and only add noise to a map whose job is to locate people.

Closed rings (first point == last) are filled as land by the page; open lines
are only stroked, so a ring Natural Earth split at the antimeridian is never
filled as a wrong polygon.
"""
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "data" / "global" / "coastline_10m.geojson"
OUT = ROOT / "social" / "assets" / "coastline.json"
TOLERANCE = 0.12
MIN_PERIMETER = 2.5


def perpendicular(p, a, b):
    (x, y), (x1, y1), (x2, y2) = p, a, b
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)
    t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))


def simplify(points, tol):
    """Douglas-Peucker, iterative (a 50,000-point coastline recurses too deep)."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        i, j = stack.pop()
        best, idx = 0.0, -1
        for k in range(i + 1, j):
            d = perpendicular(points[k], points[i], points[j])
            if d > best:
                best, idx = d, k
        if best > tol and idx > 0:
            keep[idx] = True
            stack.append((i, idx))
            stack.append((idx, j))
    return [p for p, k in zip(points, keep) if k]


def perimeter(points):
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(points, points[1:]))


def stitch(segments):
    """Join segments back into whole coastlines, reversing pieces as needed.

    Natural Earth's 10m coastline is cut into pieces -- even Africa is
    several open lines -- and neighbouring pieces do not always run the same
    way, so the join is undirected: any chain end may meet any other chain
    end. Keys are rounded to 1e-4 deg against float noise.
    """
    key = lambda p: (round(p[0], 4), round(p[1], 4))
    chains = [list(seg) for seg in segments]
    alive = [True] * len(chains)
    ends = {}
    for i, c in enumerate(chains):
        ends.setdefault(key(c[0]), set()).add(i)
        ends.setdefault(key(c[-1]), set()).add(i)

    def closed(c):
        return key(c[0]) == key(c[-1])

    changed = True
    while changed:
        changed = False
        for i in range(len(chains)):
            if not alive[i] or closed(chains[i]):
                continue
            c = chains[i]
            for end_is_tail in (True, False):
                pt = key(c[-1] if end_is_tail else c[0])
                partner = next((j for j in ends.get(pt, ()) if j != i and alive[j]), None)
                if partner is None:
                    continue
                d = chains[partner]
                for e in (key(d[0]), key(d[-1])):
                    ends.get(e, set()).discard(partner)
                for e in (key(c[0]), key(c[-1])):
                    ends.get(e, set()).discard(i)
                # Orient d so it continues c at the shared point.
                if end_is_tail:
                    d = d if key(d[0]) == pt else d[::-1]
                    c = c + d[1:]
                else:
                    d = d if key(d[-1]) == pt else d[::-1]
                    c = d[:-1] + c
                alive[partner] = False
                chains[i] = c
                ends.setdefault(key(c[0]), set()).add(i)
                ends.setdefault(key(c[-1]), set()).add(i)
                changed = True
                break
    out = []
    for i, c in enumerate(chains):
        if not alive[i]:
            continue
        if closed(c):
            c[-1] = c[0]
        else:
            c = close_on_edge(c)
        out.append(c)
    return out


def close_on_edge(c):
    """Close a coast cut by the antimeridian along the map's edge.

    Both ends on the same edge (Chukotka): the edge between them is the cut,
    so a straight close is right. Ends on opposite edges (Antarctica): the
    ring goes round the pole, so close via the bottom (or top) corners.
    """
    (x0, y0), (x1, y1) = c[0], c[-1]
    if abs(abs(x0) - 180) > 1e-6 or abs(abs(x1) - 180) > 1e-6:
        return c
    if x0 == x1:
        return c + [c[0]]
    pole = -90.0 if (y0 + y1) < 0 else 90.0
    return c + [(x1, pole), (x0, pole), c[0]]


def main():
    data = json.loads(SRC.read_text())
    segments = []
    for feature in data["features"]:
        geom = feature["geometry"]
        parts = [geom["coordinates"]] if geom["type"] == "LineString" else geom["coordinates"]
        segments += [[(float(x), float(y)) for x, y, *_ in part] for part in parts if len(part) >= 2]
    lines = []
    for pts in stitch(segments):
            if len(pts) < 2 or perimeter(pts) < MIN_PERIMETER:
                continue
            closed = pts[0] == pts[-1]
            s = simplify(pts, TOLERANCE)
            if closed and s[0] != s[-1]:
                s.append(s[0])
            if len(s) < (4 if closed else 2):
                continue
            flat = []
            for x, y in s:
                flat += [round(x, 2), round(y, 2)]
            lines.append(flat)
    lines.sort(key=len, reverse=True)
    OUT.write_text(json.dumps(lines, separators=(",", ":")))
    n = sum(len(l) // 2 for l in lines)
    print(f"{OUT.relative_to(ROOT)}: {len(lines)} lines, {n} points, {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    sys.exit(main())
