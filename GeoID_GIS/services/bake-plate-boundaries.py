#!/usr/bin/env python3
"""Plate boundaries by KIND, with the map symbols that say which kind.

Bird (2003) PB2002 ships two files. The one this layer used to fetch live,
`PB2002_boundaries.json`, is 241 segments named by their two plates, and its
`Type` column is blank on 176 of them -- only subduction is marked. So the
layer could not say what any other boundary DOES, and a ridge, a transform and
a collision were the same faint line.

The companion `PB2002_steps.json` classifies every ~30 km step (5,824 of them)
into Bird's seven classes. Those are grouped into the four kinds a reader
knows, and each kind gets the symbol geological maps have always used:

  Subduction zone        SUB             teeth on the OVERRIDING plate, pointing
                                          into it (the trench's barbs)
  Convergent (collision) OCB, CCB        teeth on both sides, alternating
  Divergent (ridge/rift) OSR, CRB        bars across the line
  Transform (conservative) OTF, CTF      paired half-arrows, one each side,
                                          showing the sense of slip

WHICH PLATE OVERRIDES is in the step's name. The first-named plate is on the
LEFT of the digitising direction (checked on known trenches: NZ\\SA runs north
with Nazca to the west, NA/PA runs east-south-east with North America to the
north). Bird writes a backslash when the LEFT plate subducts and a slash when
the RIGHT one does, so the teeth go on the other side.

THE SENSE OF SLIP on a transform is VELOCITYRI, the right-lateral component in
mm/yr: positive is dextral. For a dextral fault the left block moves forward
along the digitising direction and the right block back; sinistral reverses
both arrows.

The symbols are GEOMETRY in this file -- short lines in the boundary's own
kind, flagged `symbol: true` -- rather than a renderer of their own, so they
take the layer's colour, opacity, clipping and visibility with no new code,
and the legend lists four kinds because the file holds four kinds. Their size
is on the ground (teeth ~70 km), which is how a printed tectonic map reads
when you zoom it.

    python3 GeoID_GIS/services/bake-plate-boundaries.py

Writes `data/global/plate-boundaries.geojson` (the real boundary lines only)
and `data/global/plate-boundary-symbols.geojson` (the map symbols), both
gitignored and published to the bucket by services/publish-data.py.
"""
import json
import math
import sys
import urllib.request
from pathlib import Path

SRC = "https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_steps.json"
OUT = Path(__file__).resolve().parents[2] / "data" / "global" / "plate-boundaries.geojson"
# THE SYMBOLS ARE A SEPARATE FILE (2026-10-18). Baked into the boundary file
# they were read as boundary segments -- by the map, the click card and any
# tool reading the layer (reported: "symbols are being read as real faults").
# The boundary file now holds only the real lines; the barbs, bars and arrows
# go here, each named as a symbol, and load as their own catalogue row.
SYMBOLS_OUT = OUT.with_name("plate-boundary-symbols.geojson")

KIND = {
    "SUB": "Subduction zone",
    "OCB": "Convergent (collision)", "CCB": "Convergent (collision)",
    "OSR": "Divergent (ridge or rift)", "CRB": "Divergent (ridge or rift)",
    "OTF": "Transform (conservative)", "CTF": "Transform (conservative)",
}
CLASS_NAME = {
    "SUB": "subduction zone", "OCB": "oceanic convergent boundary",
    "CCB": "continental convergent boundary", "OSR": "oceanic spreading ridge",
    "CRB": "continental rift", "OTF": "oceanic transform fault",
    "CTF": "continental transform fault",
}
SPACING_KM = 420      # one symbol per this much boundary
TOOTH_H, TOOTH_W = 115, 130
BAR_HALF = 90
ARROW_OFF, ARROW_LEN, HEAD = 55, 170, 45
KM_LAT = 110.57


def km_to_deg(lat, east_km, north_km):
    c = max(math.cos(math.radians(lat)), 0.05)
    return east_km / (111.32 * c), north_km / KM_LAT


def frame(a, b):
    """Unit along-line and LEFT-normal vectors, in local east/north km."""
    lat = (a[1] + b[1]) / 2
    dlon = ((b[0] - a[0] + 540) % 360) - 180
    e = dlon * 111.32 * math.cos(math.radians(lat))
    n = (b[1] - a[1]) * KM_LAT
    L = math.hypot(e, n) or 1.0
    t = (e / L, n / L)
    return t, (-t[1], t[0])


def at(p, *vecs):
    """Point p moved by the sum of (km, unit-vector) pairs."""
    e = sum(k * v[0] for k, v in vecs)
    n = sum(k * v[1] for k, v in vecs)
    dx, dy = km_to_deg(p[1], e, n)
    return [round(p[0] + dx, 4), round(p[1] + dy, 4)]


def wraps(coords):
    return any(abs(c[0]) > 180 for c in coords) or \
        max(c[0] for c in coords) - min(c[0] for c in coords) > 180


def symbol(code, name, ri, p, t, nl):
    """Short lines drawing this kind's symbol at p."""
    if code == "SUB":
        # Teeth on the overriding plate: right of the line for "\" (left
        # subducts), left of it for "/" (right subducts).
        side = -1 if "\\" in name else 1
        n = (nl[0] * side, nl[1] * side)
        return [[at(p, (-TOOTH_W / 2, t)), at(p, (TOOTH_H, n)), at(p, (TOOTH_W / 2, t))]]
    if code in ("OCB", "CCB"):
        out = []
        for side, shift in ((1, -0.6), (-1, 0.6)):
            n = (nl[0] * side, nl[1] * side)
            c = at(p, (shift * TOOTH_W, t))
            out.append([at(c, (-TOOTH_W / 3, t)), at(c, (TOOTH_H * 0.7, n)), at(c, (TOOTH_W / 3, t))])
        return out
    if code in ("OSR", "CRB"):
        return [[at(p, (-20, t), (-BAR_HALF, nl)), at(p, (-20, t), (BAR_HALF, nl))],
                [at(p, (20, t), (-BAR_HALF, nl)), at(p, (20, t), (BAR_HALF, nl))]]
    # Transform: the left block moves +t when dextral (ri > 0), the right -t.
    sense = 1 if (ri or 0) >= 0 else -1
    out = []
    for side, direction in ((1, sense), (-1, -sense)):
        base = at(p, (ARROW_OFF * side, nl))
        tail = at(base, (-direction * ARROW_LEN / 2, t))
        tip = at(base, (direction * ARROW_LEN / 2, t))
        barb = at(tip, (-direction * HEAD, t), (HEAD * 0.6 * side, nl))
        out.append([tail, tip, barb])
    return out


def main():
    print("fetching PB2002 steps ...", file=sys.stderr)
    with urllib.request.urlopen(SRC, timeout=120) as r:
        steps = json.load(r)["features"]
    steps.sort(key=lambda f: f["properties"]["SEQNUM"])

    # Runs of consecutive steps on one boundary and one class.
    runs, cur = [], None
    for f in steps:
        p = f["properties"]
        a = [p["STARTLONG"], p["STARTLAT"]]
        b = [p["FINALLONG"], p["FINALLAT"]]
        key = (p["PLATEBOUND"], p["STEPCLASS"])
        joined = cur and cur["key"] == key and abs(cur["pts"][-1][0] - a[0]) < 1e-3 \
            and abs(cur["pts"][-1][1] - a[1]) < 1e-3 and abs(b[0] - a[0]) < 180
        if joined:
            cur["pts"].append(b); cur["v"].append(p["VELOCITYLE"]); cur["ri"].append(p["VELOCITYRI"])
        else:
            cur = {"key": key, "pts": [a, b], "v": [p["VELOCITYLE"]], "ri": [p["VELOCITYRI"]]}
            runs.append(cur)

    features, symbol_features, symbols = [], [], 0
    for run in runs:
        name, code = run["key"]
        plates = name.replace("\\", "-").replace("/", "-").split("-")
        speed = round(sum(run["v"]) / len(run["v"]), 1)
        props = {
            "kind": KIND[code],
            "class": CLASS_NAME[code],
            "boundary": name,
            "plates": " | ".join(plates),
            "speed_mm_yr": speed,
            "source": "Bird (2003) PB2002",
        }
        # A step that crosses the seam is cut there rather than drawn across.
        pts = run["pts"]
        line = [pts[0]]
        for q in pts[1:]:
            if abs(q[0] - line[-1][0]) > 180:
                if len(line) > 1:
                    features.append({"type": "Feature", "properties": dict(props),
                                     "geometry": {"type": "LineString", "coordinates": line}})
                line = [q]
            else:
                line.append(q)
        if len(line) > 1:
            features.append({"type": "Feature", "properties": dict(props),
                             "geometry": {"type": "LineString", "coordinates": line}})

        # Symbols every SPACING_KM, measured along the run, half a spacing in.
        walked, nextAt = 0.0, SPACING_KM / 2
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            if abs(b[0] - a[0]) > 180:
                continue
            t, nl = frame(a, b)
            seg = math.hypot(((b[0] - a[0]) * 111.32 * math.cos(math.radians((a[1] + b[1]) / 2))),
                             (b[1] - a[1]) * KM_LAT)
            while walked + seg >= nextAt:
                f = (nextAt - walked) / (seg or 1)
                p = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
                nextAt += SPACING_KM
                if abs(p[1]) > 78 or abs(p[0]) > 177:
                    continue
                for coords in symbol(code, name, run["ri"][i], p, t, nl):
                    if wraps(coords):
                        continue
                    symbol_features.append({"type": "Feature",
                                     "properties": {
                                         "kind": props["kind"],
                                         "name": f"Map symbol: {props['kind'].lower()}",
                                         "symbol_of": name,
                                         "note": "A map symbol showing the boundary's type, not a fault or boundary itself.",
                                     },
                                     "geometry": {"type": "LineString", "coordinates": coords}})
                    symbols += 1
            walked += seg

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": features},
                              separators=(",", ":")), encoding="utf-8")
    SYMBOLS_OUT.write_text(json.dumps({"type": "FeatureCollection", "features": symbol_features},
                                      separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT} -- {len(features)} boundary lines, "
          f"{OUT.stat().st_size / 1e6:.2f} MB; {SYMBOLS_OUT.name} -- {symbols} symbol strokes",
          file=sys.stderr)


if __name__ == "__main__":
    main()
