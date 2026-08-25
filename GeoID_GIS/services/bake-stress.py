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
            # How far the CLOSEST record is. The support number says how much
            # evidence a cell has; this says how local it is, and the two come
            # apart exactly where it matters -- a cell can sit on twenty
            # records that are all four hundred kilometres away.
            "nearest_km": float(km[near].min()),
            "regime": REGIME_KEYS[top],
            "regime_share": float(mix[top]) / total,
        })
    return out


def ring(north, south, west, east, fill):
    """One cell as a polygon ring, inset by how well supported it is.

    The inset is the confidence, drawn. A cell shrunk to half its slot leaves a
    visible gap round itself and reads as tentative; a fully supported one
    fills its square and tiles seamlessly with its neighbours. That is legible
    over any basemap, which transparency is not — an alpha of 0.2 over a dark
    ocean is invisible, and it was carrying this same meaning before.

    Edges are subdivided at about a degree. A straight segment across eight
    degrees of arc — which is what a cell is at seventy north — sags below the
    globe's surface and the fill disappears into the terrain.
    """
    mid_lat = (north + south) / 2
    mid_lon = (west + east) / 2
    half_lat = (north - south) / 2 * fill
    half_lon = (east - west) / 2 * fill
    n, s2 = mid_lat + half_lat, mid_lat - half_lat
    w, e = mid_lon - half_lon, mid_lon + half_lon

    def edge(lat0, lon0, lat1, lon1):
        span = max(abs(lat1 - lat0), abs(lon1 - lon0))
        steps = max(1, int(math.ceil(span)))
        return [[round(lon0 + (lon1 - lon0) * i / steps, 3),
                 round(lat0 + (lat1 - lat0) * i / steps, 3)] for i in range(steps)]

    points = (edge(n, w, n, e) + edge(n, e, s2, e)
              + edge(s2, e, s2, w) + edge(s2, w, n, w))
    points.append(points[0])
    return points


# Ordered classes, because "how much evidence is under this cell" is the
# question the World Stress Map's own coverage forces a reader to ask, and a
# class somebody can name is more use than a number they have to bin by eye.
EVIDENCE_CLASSES = [
    (2, "1–2 records"),
    (10, "3–10 records"),
    (30, "11–30 records"),
    (100, "31–100 records"),
    (float("inf"), "over 100 records"),
]


def evidence_class(count):
    for ceiling, label in EVIDENCE_CLASSES:
        if count <= ceiling:
            return label
    return EVIDENCE_CLASSES[-1][1]


def write_mesh(mesh, records, radius_km, path):
    """The interpolated field as CELLS you can click, not a picture of it.

    A raster shows the answer and cannot be asked where it came from. These are
    ordinary polygons, so every existing part of the app works on them: the
    click card reads the provenance, the symbology dialog colours by any column
    including the two that describe the EVIDENCE, and extraction and export
    take them like any other vector layer.

    That is what makes the sampling bias visible without a second layer or a
    caveat nobody reads. The World Stress Map is not evenly sampled — 63% of
    its records lie within 100 km of a plate boundary and the interiors are
    half empty — so `records` and `nearest_km` ride on every cell, and colouring
    by either one turns the map into a map of its own coverage.
    """
    features = []
    for row in mesh:
        # A polar row spans most of the planet in longitude, and a quad that
        # wide is not a cell, it is a band. There is next to no data there.
        if row["count"] < 8:
            continue
        d_lon = 360.0 / row["count"]
        points = [(row["lat"], lon) for lon in row["centres"]]
        for cell in field_at(points, records, radius_km):
            support = cell["support"]
            fill = 0.45 + 0.55 * min(1.0, support / 3.0)
            west = cell["lon"] - d_lon / 2
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [ring(row["north"], row["south"],
                                         west, west + d_lon, fill)],
                },
                "properties": {
                    "shmax_deg": round(cell["azimuth"], 1),
                    "regime": REGIME_NAME[cell["regime"]],
                    "regime_code": cell["regime"],
                    "regime_share": round(100 * cell["regime_share"]),
                    "records": cell["records"],
                    # The same count as a CLASS, because the symbology dialog
                    # colours a vector by categories: handed a numeric column
                    # it lists the twelve commonest values and folds the rest
                    # into "other", which over a range of 1 to 1,030 is not a
                    # coverage map, it is a histogram of coincidences.
                    "evidence": evidence_class(cell["records"]),
                    "support": round(support, 1),
                    "nearest_km": round(cell["nearest_km"]),
                    "agreement": round(cell["resultant"], 2),
                },
            })

    collection = {
        "type": "FeatureCollection",
        "_source": dict(SOURCE, **{
            "product": ("the World Stress Map interpolated onto a mesh of cells "
                        f"about {MESH_KM:.0f} km across, uniform on the sphere"),
            "method": ("each cell is the distance-weighted circular mean of the "
                       f"records within {radius_km:.0f} km, sigma half that; the "
                       "mean is taken on the doubled angle because SHmax is an "
                       "axis, and the regime is the class with the most weight "
                       "behind it rather than an average of category codes"),
            "support": ("`records` counts the measurements in range, `support` "
                        "weights them by distance and quality in units of "
                        "C-quality records, and `nearest_km` is how far the "
                        "closest one is. A cell is drawn INSET in proportion to "
                        "its support, so a tentative cell leaves a gap round "
                        "itself and a well-supported one fills its square."),
            "coverage": ("the WSM is global in extent and not in sampling: 63% of "
                         "its records lie within 100 km of a plate boundary, and "
                         "plate interiors — 41% of the surface — have a median "
                         "537 km to the nearest measurement. Colour by `records` "
                         "or `nearest_km` to see it."),
        }),
        "features": features,
    }
    path.write_text(json.dumps(collection, separators=(",", ":")), encoding="utf-8")
    return len(features)


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
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"1. {len(records)} A–C records with an SHmax azimuth")
    bars = write_records(records, OUT_DIR / "stress-vectors.geojson")
    size = (OUT_DIR / "stress-vectors.geojson").stat().st_size / 1024 / 1024
    print(f"   stress-vectors.geojson — {bars} bars, {size:.1f} MB")

    mesh = equal_area_mesh(args.cell)
    total = sum(row["count"] for row in mesh if row["count"] >= 8)
    print(f"2. mesh of {total} cells about {args.cell:.0f} km across, uniform on "
          f"the sphere ({len(mesh)} rows, {mesh[len(mesh) // 2]['count']} on the equator)")

    print(f"3. interpolating, {args.radius:.0f} km search radius")
    cells = write_mesh(mesh, records, args.radius, OUT_DIR / "stress-mesh.geojson")
    size = (OUT_DIR / "stress-mesh.geojson").stat().st_size / 1024 / 1024
    print(f"   stress-mesh.geojson — {cells} cells with data "
          f"({100 * cells / total:.0f}% of the mesh), {size:.1f} MB")

    check(records, args.radius)


if __name__ == "__main__":
    main()
