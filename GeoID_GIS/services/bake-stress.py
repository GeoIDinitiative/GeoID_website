#!/usr/bin/env python3
"""Bake the World Stress Map into a layer of oriented measurements.

    python3 GeoID_GIS/services/bake-stress.py [--csv wsm2016.csv]

Writes ``data/global/stress-vectors.geojson``: every A–C record with a
determined azimuth, drawn as a bar lying along the SHmax it recorded and
carrying its method, quality class, depth, faulting regime and — for the few
hundred that have any — its principal stress magnitudes.

WHAT THIS FILE NO LONGER DOES, AND WHY
--------------------------------------
It interpolated. Five times, in five presentations: a fine hue raster of SHmax
azimuth, the same rebuilt three times as the arithmetic was corrected, bars on
a regular lattice, a flat-celled raster, and finally a mesh of clickable
polygons carrying their own provenance. The arithmetic ended up right —
uniform cells on the sphere, great-circle distances, the doubled angle, the
search radius as a cutoff — and it was still the wrong thing to publish:

* Whatever it was made of, a field of filled cells over half the planet reads
  as a basemap, and it covers the map somebody is reading it against.
* The World Stress Map is global in EXTENT and not in SAMPLING: 82% of its
  records are focal mechanisms, 63% of them lie within 100 km of a plate
  boundary, and plate interiors have a median 537 km to the nearest
  measurement. An interpolated surface over that is mostly a picture of the
  search radius.
* The measurements do not need it. A bar per record IS the World Stress Map —
  it is how the WSM itself publishes — and every one of them is a thing
  somebody measured rather than something this file inferred.

The check below stays: it is what proves the records were read correctly, and
it costs nothing.

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
                        help="search radius the CHECK uses, km")
    args = parser.parse_args()

    # NOT into the data directory: that folder is published, and the 9 MB
    # source csv has no business being served to a browser that only wants the
    # layer baked from it.
    path = pathlib.Path(args.csv) if args.csv else CACHE_DIR / "wsm2016.csv"
    if not path.exists():
        print(f"downloading {WSM_CSV}")
        path.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(WSM_CSV, path)

    records = load(path)
    if not records:
        sys.exit("no usable records — is that the WSM 2016 csv?")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"{len(records)} A–C records with an SHmax azimuth")
    bars = write_records(records, OUT_DIR / "stress-vectors.geojson")
    size = (OUT_DIR / "stress-vectors.geojson").stat().st_size / 1024 / 1024
    print(f"wrote stress-vectors.geojson — {bars} bars, {size:.1f} MB")

    check(records, args.radius)


if __name__ == "__main__":
    main()
