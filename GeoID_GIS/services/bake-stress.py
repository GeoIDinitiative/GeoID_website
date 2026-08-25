#!/usr/bin/env python3
"""Bake the World Stress Map: the records, and the field they imply.

    python3 GeoID_GIS/services/bake-stress.py [--csv wsm2016.csv]

Writes two GeoJSON layers into ``data/global/``:

    stress-vectors.geojson   32,464 measurements, each an oriented bar
    stress-grid.geojson      the interpolated field, one bar per grid node

WHY BARS AND NOT A COLOURED RASTER
----------------------------------
This was a raster first — a hue per orientation, smoothed and draped over the
globe — and it was rebuilt three times before the answer turned out to be that
the PRODUCT was wrong rather than the arithmetic. A colour-filled orientation
map asks a reader to decode an angle from a hue, which nobody can do; across a
whole planet it reads as a lava lamp; and it buries the thing a stress map most
needs to show, which is where the data are and where they are not.

The World Stress Map's own maps — the database's and the smoothed ones in
Heidbach et al. — draw stress as **oriented bars**: a line lying along SHmax,
coloured by the faulting regime. An orientation drawn as an orientation needs
no key at all. So both layers here are bars:

* the RECORDS layer is one bar per measurement, which is the map the WSM is;
* the GRID layer is one bar per node of a uniformly spaced global grid, each
  the distance-weighted mean of the records around it — what the published
  smoothed maps show. It is a grid rather than a fill because a bar has to be
  drawn somewhere, and a regular lattice is the honest choice of somewhere.

Everything downstream comes free: both are ordinary vector layers, so the click
card reads a record, the symbology dialog recolours by any column, and the
legend, extraction and export already work on them.

WHAT THE ARITHMETIC HAS TO GET RIGHT
------------------------------------
1. **SHmax is an AXIS, not a vector.** 10° and 190° are the same orientation,
   and their arithmetic mean is 100° — exactly perpendicular to both, and a
   perfectly plausible-looking number. Every mean here is taken on the DOUBLED
   angle and halved back.

2. **The nodes are evenly spaced on the SPHERE.** A lat/lon mesh is not: at
   half a degree its cells are 55 km by 55 on the equator and 55 by 19 at 70°N.
   Rows of constant latitude spacing, each holding as many nodes as fit round
   its own parallel, keep every node the same distance from its neighbours and
   the search radius meaning the same thing everywhere.

3. **No data, no bar.** A distance-weighted mean will happily hand the middle
   of the Pacific the nearest continent's orientation. A node with less than
   one effective C-quality record inside the search radius gets nothing, so the
   map is empty where the data are.

4. **A mean of disagreeing records is not a measurement.** The resultant length
   R says how much the records near a node agree. It rides on every bar as a
   column, so it can be read, filtered and coloured by — rather than being
   folded into an opacity nobody can measure by eye.

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
# How far apart the grid nodes sit, on the ground, everywhere. 250 km is about
# as fine as a global field of bars can be drawn and still be read; the records
# layer is what anybody wanting to go closer should turn on.
NODE_KM = 250.0

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


def equal_area_nodes(spacing_km):
    """Nodes evenly spaced on the sphere, in rows of constant latitude step.

    A lat/lon mesh is the obvious grid and it is not evenly spaced: its cells
    shrink toward the poles, so a global field computed on one is sampled far
    more densely in the Arctic than in the tropics. Here each row holds as many
    nodes as fit round its own parallel at the same spacing — 160 on the
    equator, one at the pole — so every node has the same neighbourhood and the
    search radius means the same thing wherever it is applied.
    """
    deg_km = EARTH_KM * math.pi / 180.0
    rows = max(2, int(round(180.0 / (spacing_km / deg_km))))
    d_lat = 180.0 / rows
    lats = 90 - (np.arange(rows) + 0.5) * d_lat
    counts = np.maximum(1, np.round(
        np.cos(np.radians(lats)) * 360.0 / d_lat).astype(int))
    return [
        (float(lat), float(-180 + (i + 0.5) * (360.0 / n)))
        for lat, n in zip(lats, counts)
        for i in range(int(n))
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
            "regime": REGIME_KEYS[top],
            "regime_share": float(mix[top]) / total,
        })
    return out


def write_grid(nodes, spacing_km, radius_km, path):
    """The interpolated field: one bar per node, lying along the mean SHmax."""
    # A little over a third of the spacing each way, so neighbouring bars read
    # as a field without touching — at full spacing the lattice closes up into
    # lines and stops looking like a set of measurements.
    half = spacing_km * 0.36
    features = [{
        "type": "Feature",
        "geometry": {
            "type": "LineString",
            "coordinates": bar(node["lat"], node["lon"], node["azimuth"], half),
        },
        "properties": {
            "azimuth": round(node["azimuth"], 1),
            "regime": REGIME_NAME.get(node["regime"], node["regime"]),
            "regime_code": node["regime"],
            "regime_share": round(node["regime_share"], 2),
            "agreement": round(node["resultant"], 2),
            "records": node["records"],
            "support": round(node["support"], 1),
        },
    } for node in nodes]
    collection = {
        "type": "FeatureCollection",
        "_source": dict(SOURCE, **{
            "product": ("interpolated field: the distance-weighted circular mean of "
                        f"the A–C records within {radius_km:.0f} km of each node"),
            "grid": (f"equal-area nodes about {spacing_km:.0f} km apart, in rows of "
                     "constant latitude spacing"),
            "note": ("`azimuth` is the mean SHmax orientation and the bar lies along "
                     "it; `agreement` is the resultant length of the records behind "
                     "it — 1 where they all point the same way, 0 where they cancel; "
                     "`support` is how many C-quality records that is worth. A node "
                     "with less than one is not drawn at all."),
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
    parser.add_argument("--spacing", type=float, default=NODE_KM,
                        help="node spacing of the equal-area grid, km")
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
    print(f"{len(records)} A–C records with an SHmax azimuth")

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    points = equal_area_nodes(args.spacing)
    print(f"{len(points)} nodes about {args.spacing:.0f} km apart; "
          f"searching {args.radius:.0f} km around each")
    nodes = field_at(points, records, args.radius)
    written = write_grid(nodes, args.spacing, args.radius, OUT_DIR / "stress-grid.geojson")
    size = (OUT_DIR / "stress-grid.geojson").stat().st_size / 1024
    print(f"wrote stress-grid.geojson — {written} of {len(points)} nodes carry data "
          f"({100 * written / len(points):.0f}%), {size:.0f} KB")

    count = write_records(records, OUT_DIR / "stress-vectors.geojson")
    size = (OUT_DIR / "stress-vectors.geojson").stat().st_size / 1024 / 1024
    print(f"wrote stress-vectors.geojson — {count} measurements, {size:.1f} MB")

    check(records, args.radius)


if __name__ == "__main__":
    main()
