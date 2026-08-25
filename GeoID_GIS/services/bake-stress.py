#!/usr/bin/env python3
"""Bake the World Stress Map: the measurements, and a mesh raster from them.

    python3 GeoID_GIS/services/bake-stress.py [--csv wsm2016.csv]

Writes into ``data/global/``:

    stress-vectors.geojson   32,464 measurements, each an oriented bar
    stress-raster.png        the interpolated field on a low-resolution mesh
    stress-raster.json       what that mesh is and how it was made

THREE STEPS, IN THIS ORDER
--------------------------
1. **The measurements.** Every A-C record with a determined azimuth, drawn as
   a bar lying along the SHmax it recorded and carrying its method, quality,
   depth and faulting regime. This is the World Stress Map as the WSM
   publishes it, and it is the evidence for everything below.

2. **A uniformly spaced, LOW RESOLUTION mesh.** Cells about 300 km across,
   everywhere -- rows of constant latitude spacing, each holding as many cells
   as fit round its own parallel, so a cell in the Arctic is the same size as
   one on the equator. Low resolution on purpose: 300 km is roughly the scale
   over which SHmax is coherent, and a finer mesh would be inventing structure
   the records cannot support. Because it is coarse and uniform, the mesh is
   VISIBLE in the picture, which is the point -- a reader can see the
   resolution of the thing they are being shown.

3. **The raster.** Each cell takes the distance-weighted circular mean of the
   records within the search radius, and is painted flat in its dominant
   faulting regime. Cells with too little data are left transparent.

Earlier versions of this file interpolated onto a fine grid and painted a
smooth hue field of SHmax azimuth. That asks a reader to decode an angle from
a colour, produces a lava lamp across a planet, and hides the resolution of the
interpolation behind a smooth gradient. A coarse mesh of flat cells says what
it knows and, just as importantly, at what scale it knows it.

WHAT THE ARITHMETIC HAS TO GET RIGHT
------------------------------------
* **SHmax is an AXIS.** 10 and 190 degrees are the same orientation, and their
  arithmetic mean is 100 -- exactly perpendicular to both, and a perfectly
  plausible-looking number. Every mean is taken on the DOUBLED angle.
* **The cells are uniform on the SPHERE.** A lat/lon mesh is not: at half a
  degree its cells are 55 km by 55 on the equator and 55 by 19 at 70 north.
* **The search radius is a cutoff, and sigma is half of it.** Using the radius
  as sigma and reaching twice it paints a cell with no record inside 450 km
  from records between 450 and 900.
* **No data, no cell.** Under one effective C-quality record within the radius
  and the cell stays transparent, so the map is empty where the data are.
* **A category cannot be averaged**, so the regime is not averaged: each class
  is summed with the same weights and the cell takes the one with the most
  behind it, fading where nothing clearly wins.

Data: World Stress Map Database Release 2016, CC BY 4.0.
Heidbach, O., Rajabi, M., Reiter, K., Ziegler, M., WSM Team (2016).
https://doi.org/10.5880/WSM.2016.001
"""

import argparse
import csv
import json
import math
import pathlib
import sys
import urllib.request

import numpy as np
from PIL import Image

WSM_CSV = ("https://datapub.gfz-potsdam.de/download/10.5880.WSM.2016.001/"
           "wsm2016.csv")
OUT_DIR = pathlib.Path(__file__).resolve().parents[2] / "data" / "global"
CACHE_DIR = pathlib.Path(__file__).resolve().parent / ".cache"

EARTH_KM = 6371.0

# The WSM's own quality classes, and the weights its own maps use: A is
# ±15°, B ±20, C ±25. D and E are dropped rather than down-weighted — the
# database calls them "questionable" and "no reliable information", and
# averaging in noise to make a map look fuller is not a service to anybody.
QUALITY_WEIGHT = {"A": 4.0, "B": 3.0, "C": 2.0}

# Records further than this from a node are not used by it. Roughly the scale
# over which SHmax stays coherent within a plate.
SEARCH_KM = 450.0
# Effective C-quality records a node needs before it gets a bar at all.
SUPPORT_FLOOR = 1.0
# How wide a mesh cell is, on the ground, everywhere. Low resolution on
# purpose: 300 km is roughly the scale over which SHmax stays coherent, and a
# finer mesh would be inventing structure the records cannot support. It is
# also coarse enough to SEE, which is what lets a reader judge the resolution
# of what they are looking at rather than being shown a smooth gradient.
MESH_KM = 300.0

# The WSM's own regime colours: red where the crust is pulling apart, blue
# where it is shortening, green where it is shearing past itself. Anybody who
# has read a stress map has read this key.
REGIME_COLOUR = {
    "NF": (226, 68, 74),
    "SS": (58, 160, 58),
    "TF": (58, 107, 214),
    "U": (150, 150, 158),
}

REGIME_NAME = {
    "NF": "Normal faulting",
    "NS": "Normal with strike-slip",
    "SS": "Strike-slip",
    "TS": "Thrust with strike-slip",
    "TF": "Thrust faulting",
    "U": "Undetermined",
}

# The mixed classes count half to each of the pair they name, because that is
# what they mean: a normal-with-strike-slip record is evidence for both, and it
# should not become a fourth colour on a three-colour key.
REGIME_SPLIT = {
    "NF": {"NF": 1.0},
    "SS": {"SS": 1.0},
    "TF": {"TF": 1.0},
    "NS": {"NF": 0.5, "SS": 0.5},
    "TS": {"TF": 0.5, "SS": 0.5},
    "U": {"U": 1.0},
}
REGIME_KEYS = ["NF", "SS", "TF", "U"]

METHOD_NAME = {
    "FMS": "Focal mechanism (single event)",
    "FMA": "Focal mechanism (average)",
    "FMF": "Focal mechanism (formal inversion)",
    "BO": "Borehole breakout",
    "DIF": "Drilling-induced fracture",
    "OC": "Overcoring",
    "HF": "Hydraulic fracturing",
    "HFM": "Hydraulic fracturing (mini-frac)",
    "HFP": "Hydraulic fracturing (pre-existing fracture)",
    "GFI": "Geological fault-slip inversion",
    "GVA": "Volcanic vent alignment",
    "BS": "Borehole slotter",
    "SWB": "Shear wave splitting",
    "PC": "Petal centreline fracture",
}

SOURCE = {
    "name": "World Stress Map Database Release 2016",
    "doi": "https://doi.org/10.5880/WSM.2016.001",
    "licence": "CC BY 4.0",
    "citation": ("Heidbach, O., Rajabi, M., Reiter, K., Ziegler, M., WSM Team "
                 "(2016): World Stress Map Database Release 2016. V. 1.1. "
                 "GFZ Data Services."),
}


def load(path):
    """The A–C records that carry an SHmax azimuth."""
    kept = []
    with open(path, newline="", encoding="utf-8", errors="replace") as handle:
        for row in csv.DictReader(handle):
            if row.get("QUALITY") not in QUALITY_WEIGHT:
                continue
            azimuth = (row.get("AZI") or "").strip()
            # 999 is the database's own "not determined".
            if azimuth in ("", "999"):
                continue
            try:
                lat = float(row["LAT"])
                lon = float(row["LON"])
                azi = float(azimuth) % 180.0
            except (TypeError, ValueError):
                continue
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                continue
            kept.append({
                "lat": lat,
                "lon": lon,
                "azi": azi,
                "weight": QUALITY_WEIGHT[row["QUALITY"]],
                "regime": (row.get("REGIME") or "U").strip() or "U",
                "row": row,
            })
    return kept


def number(row, field):
    """A WSM numeric field, or None. 999 is the database's own 'not given'."""
    raw = (row.get(field) or "").strip()
    if raw in ("", "999", "999.0"):
        return None
    try:
        value = float(raw)
    except ValueError:
        return None
    return None if value == 999 else value


def bar(lat, lon, azimuth, half_km):
    """A short segment centred on a point and lying along an orientation.

    The east–west half is divided by cos(lat) so the bar keeps its BEARING on
    the ground rather than being sheared toward the meridian as it goes north:
    without it a NE-trending measurement in Svalbard is drawn nearly north.
    """
    deg = half_km / (EARTH_KM * math.pi / 180.0)
    d_north = deg * math.cos(math.radians(azimuth))
    d_east = deg * math.sin(math.radians(azimuth)) / max(math.cos(math.radians(lat)), 0.05)
    return [
        [round(lon - d_east, 4), round(lat - d_north, 4)],
        [round(lon + d_east, 4), round(lat + d_north, 4)],
    ]


def equal_area_mesh(cell_km):
    """A mesh of roughly square cells, the same size everywhere on the sphere.

    Rows of constant latitude spacing; each row holds as many cells as fit
    round its own parallel at that same spacing — 133 on the equator, one at
    the pole. A lat/lon mesh is the obvious alternative and its cells shrink
    toward the poles, so the same interpolation would be sampled nine times
    more densely in the Arctic than in the tropics.

    Returns the rows, each a list of `(lat, lon)` centres, plus the latitude
    bounds of the row — everything the raster needs to paint flat cells.
    """
    deg_km = EARTH_KM * math.pi / 180.0
    rows = max(2, int(round(180.0 / (cell_km / deg_km))))
    d_lat = 180.0 / rows
    mesh = []
    for r in range(rows):
        north = 90 - r * d_lat
        south = north - d_lat
        lat = (north + south) / 2
        count = max(1, int(round(math.cos(math.radians(lat)) * 360.0 / d_lat)))
        mesh.append({
            "lat": lat,
            "north": north,
            "south": south,
            "count": count,
            "centres": [(-180 + (i + 0.5) * (360.0 / count)) for i in range(count)],
        })
    return mesh


def field_at(points, records, radius_km):
    """The distance-weighted axial mean of the records around each point.

    Vectorised over the RECORDS, once per point. A few thousand points is small
    enough to ask the question the way it is actually posed — what do the
    records near HERE say — instead of scattering every record onto a grid and
    reasoning backwards, which is what made the raster versions of this so easy
    to get wrong.
    """
    if not records:
        return []
    sigma = radius_km / 2.0
    lat = np.array([r["lat"] for r in records])
    lon = np.array([r["lon"] for r in records])
    azi = np.array([r["azi"] for r in records])
    weight = np.array([r["weight"] for r in records]) / QUALITY_WEIGHT["C"]
    lat_rad = np.radians(lat)
    lon_rad = np.radians(lon)
    cos_lat = np.cos(lat_rad)
    sin2 = np.sin(np.radians(2 * azi))
    cos2 = np.cos(np.radians(2 * azi))
    # One column per regime class, so the dominant style falls out of the same
    # weighted sum as the orientation rather than needing a pass of its own.
    shares = np.zeros((len(records), len(REGIME_KEYS)))
    for i, record in enumerate(records):
        for key, share in REGIME_SPLIT.get(record["regime"], {"U": 1.0}).items():
            shares[i, REGIME_KEYS.index(key)] = share

    out = []
    for node_lat, node_lon in points:
        phi = math.radians(node_lat)
        d_lat = lat_rad - phi
        d_lon = lon_rad - math.radians(node_lon)
        # The short way round, or a point near the antimeridian measures its
        # own neighbours as most of a planet away.
        d_lon = (d_lon + math.pi) % (2 * math.pi) - math.pi
        hav = (np.sin(d_lat / 2) ** 2
               + math.cos(phi) * cos_lat * np.sin(d_lon / 2) ** 2)
        km = 2 * EARTH_KM * np.arcsin(np.sqrt(np.clip(hav, 0, 1)))
        near = km <= radius_km
        if not near.any():
            continue
        k = np.exp(-0.5 * (km[near] / sigma) ** 2) * weight[near]
        support = float(k.sum())
        if support < SUPPORT_FLOOR:
            continue
        s = float((k * sin2[near]).sum())
        c = float((k * cos2[near]).sum())
        mix = (k[:, None] * shares[near]).sum(axis=0)
        total = float(mix.sum()) or 1.0
        top = int(np.argmax(mix))
        out.append({
            "lat": node_lat,
            "lon": node_lon,
            "azimuth": math.degrees(math.atan2(s, c)) / 2 % 180,
            "resultant": math.hypot(s, c) / support,
            "support": support,
            "records": int(near.sum()),
            "regime": REGIME_KEYS[top],
            "regime_share": float(mix[top]) / total,
        })
    return out


def paint_raster(mesh, cells, width, height, path):
    """The mesh, painted flat, one colour per cell.

    Every output pixel takes the colour of the cell it falls in — nearest, not
    interpolated, because the point of a low-resolution mesh is that its
    resolution is visible. A smoothed picture of a coarse interpolation claims
    a precision the records do not have.
    """
    rgba = np.zeros((height, width, 4), dtype=np.uint8)
    d_lat = 180.0 / len(mesh)
    for y in range(height):
        lat = 90 - (y + 0.5) * (180.0 / height)
        row = min(len(mesh) - 1, max(0, int((90 - lat) / d_lat)))
        count = mesh[row]["count"]
        found = cells.get(row)
        if not found:
            continue
        step = 360.0 / count
        lons = -180 + (np.arange(width) + 0.5) * (360.0 / width)
        columns = (np.floor((lons + 180) / step).astype(int)) % count
        for x in range(width):
            cell = found.get(int(columns[x]))
            if cell is None:
                continue
            rgba[y, x, :3] = REGIME_COLOUR[cell["regime"]]
            rgba[y, x, 3] = cell["alpha"]
    Image.fromarray(rgba).save(path, optimize=True)
    return path.stat().st_size


def describe(mesh, cells, radius_km, drawn, path):
    """What the mesh is, beside the picture of it."""
    meta = {
        "id": "stress-raster",
        "title": "Stress field, interpolated (World Stress Map 2016)",
        "bounds": {"west": -180, "east": 180, "south": -90, "north": 90},
        "mesh": {
            "cellKm": MESH_KM,
            "rows": len(mesh),
            "cells": sum(row["count"] for row in mesh),
            "withData": drawn,
            "note": ("uniform on the sphere: rows of constant latitude spacing, each "
                     "holding as many cells as fit round its own parallel"),
        },
        "method": {
            "interpolation": "distance-weighted circular mean of the doubled azimuth",
            "searchRadiusKm": radius_km,
            "sigmaKm": radius_km / 2,
            "supportFloor": SUPPORT_FLOOR,
            "colour": "dominant faulting regime, WSM colours",
            "note": ("cells are painted flat and not smoothed, so the resolution of "
                     "the interpolation is visible rather than hidden behind a "
                     "gradient"),
        },
        "legend": [
            {"code": key, "label": REGIME_NAME[key],
             "colour": "#%02x%02x%02x" % REGIME_COLOUR[key]}
            for key in REGIME_KEYS
        ],
        "source": SOURCE,
    }
    path.write_text(json.dumps(meta, indent=2), encoding="utf-8")


def write_records(records, path, half_km=30.0):
    """The measurements themselves, annotated, as oriented bars."""
    features = []
    for record in records:
        row = record["row"]
        props = {
            "azimuth": round(record["azi"], 1),
            "regime": REGIME_NAME.get(record["regime"], record["regime"]),
            "regime_code": record["regime"],
            "quality": (row.get("QUALITY") or "").strip(),
            "method": METHOD_NAME.get((row.get("TYPE") or "").strip(),
                                      (row.get("TYPE") or "").strip()),
            "depth_km": number(row, "DEPTH"),
            "country": (row.get("COUNTRY") or "").strip() or None,
            "wsm_id": (row.get("ID") or "").strip(),
        }
        # Magnitudes exist for well under one per cent of the records. They are
        # carried where they are present and simply absent elsewhere: a
        # placeholder in a numeric column is a number somebody will average.
        for field, name in (("MAG_INT_S1", "s1_mpa"), ("MAG_INT_S2", "s2_mpa"),
                            ("MAG_INT_S3", "s3_mpa")):
            value = number(row, field)
            if value is not None:
                props[name] = value
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": bar(record["lat"], record["lon"], record["azi"], half_km),
            },
            "properties": {k: v for k, v in props.items() if v is not None},
        })
    collection = {
        "type": "FeatureCollection",
        "_source": dict(SOURCE, **{
            "product": "the measurements themselves, quality A–C with a determined azimuth",
            "geometry": (f"each record drawn as a {2 * half_km:.0f} km bar centred on "
                         "the site and lying along SHmax"),
            "magnitudes": ("s1_mpa/s2_mpa/s3_mpa are present on the few hundred records "
                           "that carry in-situ magnitudes; stress is a tensor and this "
                           "database is overwhelmingly a record of its ORIENTATION and "
                           "regime, not its size"),
        }),
        "features": features,
    }
    path.write_text(json.dumps(collection, separators=(",", ":")), encoding="utf-8")
    return len(features)


# Places whose stress orientation and faulting style are not in dispute. An
# interpolation can be arithmetically perfect and still be turned inside out by
# an axial mean done wrong, and the result looks like a map either way.
REFERENCES = [
    (36.0, -120.0, "San Andreas", "SS", "NNE compression"),
    # The Japan TRENCH rather than central Honshu: 35N 138E is the Izu
    # collision zone, where the records say strike-slip and a reference filed
    # under "subduction, therefore thrust" is the checker being wrong.
    (38.5, 143.0, "Japan trench", "TF", "E-W, ~110"),
    (54.5, -6.5, "Northern Ireland", None, "NW-SE, ~135"),
    (48.0, 8.0, "Upper Rhine Graben", None, "NW-SE, ~145"),
    (-2.0, 36.0, "East African rift", "NF", "E-W extension"),
    (40.0, -114.0, "Basin and Range", "NF", "E-W extension"),
    (30.0, 80.0, "western Himalaya", "TF", "N-S shortening"),
    (-1.0, 100.0, "Sumatra", "TF", "NE-SW shortening"),
    (40.5, 31.0, "North Anatolian fault", "SS", "NW-SE compression"),
]


def check(records, radius_km):
    """The field where the answer is known, recomputed from the records.

    Two comparisons, answering different questions. Evaluating the weighted
    mean AT the reference point checks the arithmetic; the expectation from the
    literature checks the geology. The second is the softer of the two — a
    reference can be filed under the wrong tectonics, which happened twice
    while this was being built and each time the map was right — so both are
    printed rather than one verdict.
    """
    print("\ncheck — the field at places with a published answer:")
    named = [r for r in REFERENCES if r[3]]
    agreed = 0
    for lat, lon, name, regime, expected in REFERENCES:
        found = field_at([(lat, lon)], records, radius_km)
        if not found:
            print(f"      {name:24s} nothing within {radius_km:.0f} km")
            continue
        node = found[0]
        ok = regime is None or node["regime"] == regime
        agreed += bool(regime and ok)
        mark = "   " if regime is None else ("ok " if ok else "OUT")
        print(f"  {mark} {name:24s} SHmax {node['azimuth']:5.1f}°  "
              f"{node['regime']} {100 * node['regime_share']:3.0f}%  "
              f"R={node['resultant']:.2f}  n={node['records']:4d}  "
              f"| expected {expected}" + (f", {regime}" if regime else ""))
    print(f"      {agreed} of {len(named)} regimes match the expectation")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", default=None, help="wsm2016.csv (downloaded if absent)")
    parser.add_argument("--radius", type=float, default=SEARCH_KM,
                        help="search radius in km; records beyond it are not used")
    parser.add_argument("--cell", type=float, default=MESH_KM,
                        help="mesh cell size in km")
    parser.add_argument("--width", type=int, default=1440,
                        help="raster width in pixels (height is half)")
    args = parser.parse_args()

    # NOT into the data directory: that folder is published, and the 9 MB
    # source csv has no business being served to a browser that only wants the
    # layers baked from it.
    path = pathlib.Path(args.csv) if args.csv else CACHE_DIR / "wsm2016.csv"
    if not path.exists():
        print(f"downloading {WSM_CSV}")
        path.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(WSM_CSV, path)

    records = load(path)
    if not records:
        sys.exit("no usable records — is that the WSM 2016 csv?")
    print(f"1. {len(records)} A–C records with an SHmax azimuth")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    count = write_records(records, OUT_DIR / "stress-vectors.geojson")
    size = (OUT_DIR / "stress-vectors.geojson").stat().st_size / 1024 / 1024
    print(f"   wrote stress-vectors.geojson — {count} bars, {size:.1f} MB")

    mesh = equal_area_mesh(args.cell)
    total = sum(row["count"] for row in mesh)
    print(f"2. mesh of {total} cells about {args.cell:.0f} km across "
          f"({len(mesh)} rows, {mesh[len(mesh) // 2]['count']} on the equator)")

    print(f"3. interpolating, {args.radius:.0f} km search radius")
    cells = {}
    drawn = 0
    for r, row in enumerate(mesh):
        points = [(row["lat"], lon) for lon in row["centres"]]
        found = field_at(points, records, args.radius)
        by_lon = {}
        for cell in found:
            column = int(round((cell["lon"] + 180) / (360.0 / row["count"]) - 0.5))
            # How clearly the regime won, times how much data said so: a cell
            # where 40% of the weight is thrust and 35% strike-slip has not
            # chosen, and must not be painted as though it had.
            decisive = min(1.0, max(0.0, (cell["regime_share"] - 0.34) / 0.5))
            support = min(1.0, cell["support"] / 3.0)
            by_lon[column % row["count"]] = {
                "regime": cell["regime"],
                "alpha": int(round(min(0.9, max(0.15, decisive * support * 0.9)) * 255)),
            }
        if by_lon:
            cells[r] = by_lon
            drawn += len(by_lon)
    print(f"   {drawn} of {total} cells carry data ({100 * drawn / total:.0f}%)")

    height = args.width // 2
    size = paint_raster(mesh, cells, args.width, height, OUT_DIR / "stress-raster.png")
    print(f"   wrote stress-raster.png — {args.width}x{height}, {size / 1024:.0f} KB")
    describe(mesh, cells, args.radius, drawn, OUT_DIR / "stress-raster.json")
    print(f"   wrote stress-raster.json")

    check(records, args.radius)


if __name__ == "__main__":
    main()
