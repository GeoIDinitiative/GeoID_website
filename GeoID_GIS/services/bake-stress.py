#!/usr/bin/env python3
"""Bake the World Stress Map into an interpolated SHmax raster.

    python3 GeoID_GIS/services/bake-stress.py [--csv wsm2016.csv] [--degree 0.5]

Writes ``data/global/stress-shmax.png`` and ``stress-shmax.json``.

WHY A RASTER AT ALL
-------------------
The World Stress Map is 42,870 point measurements of the orientation of the
maximum horizontal compressive stress, SHmax — from earthquake focal
mechanisms, borehole breakouts, overcoring, hydraulic fracturing. Drawn as
points it is what it is: forty thousand tick marks, dense along the plate
boundaries and absent over most of the ocean, and a reader cannot see the
pattern for the data. The field between them is what people actually want, and
it is what the WSM's own publications show — smoothed maps of the stress
orientation, which is a first-order fact about a region and changes slowly
across it.

THREE THINGS THIS HAS TO GET RIGHT
----------------------------------
1. **SHmax is an AXIS, not a vector.** 10° and 190° are the same orientation.
   Averaging them arithmetically gives 100° — perpendicular to both, which is
   the worst possible answer and a perfectly plausible-looking number. Every
   average here is taken on the DOUBLED angle: sum cos(2θ) and sin(2θ), and
   halve the resulting direction. This is the standard treatment for axial
   data and there is no shortcut around it.

2. **The interpolation must not invent a field where there are no data.** Most
   of the Pacific has no measurements at all; a distance-weighted mean happily
   returns the nearest continent's stress direction for it. Every cell
   therefore carries a WEIGHT, and a cell whose weight is below a floor — no
   data close enough — is written transparent. The picture has holes in it
   because the data have holes in it.

3. **A mean of disagreeing measurements is not a measurement.** The resultant
   length R (the length of the summed unit vectors over the sum of weights)
   says how much the data in a cell agree: R near 1 is a coherent field, R near
   0 is scatter. It is carried into the ALPHA, so a well-constrained region is
   solid and a contested one fades — rather than both being painted the same
   confident colour.

METHOD
------
Distance-weighted circular mean on a lat/lon grid, computed as two separable
convolutions of the accumulated sin/cos grids. The longitude kernel widens with
latitude by 1/cos(lat), so the smoothing radius is in KILOMETRES on the ground
rather than in degrees — without that a 500 km kernel at 70°N would be three
times too wide east–west. This is a simplification of the WSM's own
wavelength-dependent smoothing (Heidbach et al.), which varies the radius with
the local data density; the fixed radius is stated on the layer.

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
# The repo root's own data folder, which is where every shipped global dataset
# already lives (coastlines, countries, volcanoes) and what `/data/global/...`
# resolves to in a browser. A second copy under the viewer would be a second
# place to look the next time one of them moved.
OUT_DIR = pathlib.Path(__file__).resolve().parents[2] / "data" / "global"
CACHE_DIR = pathlib.Path(__file__).resolve().parent / ".cache"

# The WSM's own quality classes, and the weights its own maps use: A is
# +/-15 degrees, B +/-20, C +/-25, and D/E are not reliable enough to
# interpret. Anything below C is dropped rather than down-weighted -- the
# database's own documentation says D is "questionable" and E is "no reliable
# information", and averaging in noise to make a map look fuller is not a
# service to the reader.
QUALITY_WEIGHT = {"A": 4.0, "B": 3.0, "C": 2.0}

# Kilometres. Roughly the scale over which SHmax is coherent in an intraplate
# region; the WSM's smoothed maps use a comparable search radius before their
# wavelength analysis widens it.
SEARCH_KM = 450.0
EARTH_KM = 6371.0

# Effective C-quality measurements a cell must see before it is drawn at all.
# One is deliberately low: the point is to draw where there IS data, and a
# single B-quality breakout is a real constraint on the orientation. What it
# rules out is the tail of the kernel reaching a thousand kilometres into an
# empty ocean and painting the nearest continent's stress field over it.
WEIGHT_FLOOR = 1.0
# And this much agreement among whatever is there. Below it the orientations
# in range contradict each other and a mean of them says nothing.
RESULTANT_FLOOR = 0.35


def load(path):
    """The A-C records that carry an SHmax azimuth."""
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
                azi = float(azimuth)
            except (TypeError, ValueError):
                continue
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                continue
            kept.append((lat, lon, azi % 180.0, QUALITY_WEIGHT[row["QUALITY"]],
                         (row.get("REGIME") or "U").strip(), row))
    return kept


def gaussian(width_cells):
    """A normalised Gaussian kernel, truncated at two sigma of useful range."""
    sigma = max(0.35, width_cells)
    half = max(1, int(math.ceil(sigma * 2.0)))
    x = np.arange(-half, half + 1, dtype=float)
    k = np.exp(-0.5 * (x / sigma) ** 2)
    return k / k.sum()


def convolve_rows_wrapping(grid, kernel):
    """Along longitude, which WRAPS: the map has no left or right edge."""
    half = len(kernel) // 2
    padded = np.concatenate([grid[:, -half:], grid, grid[:, :half]], axis=1)
    out = np.zeros_like(grid)
    for i, weight in enumerate(kernel):
        out += weight * padded[:, i:i + grid.shape[1]]
    return out


def convolve_cols(grid, kernel):
    """Along latitude, which does NOT wrap: the poles are edges, not seams."""
    half = len(kernel) // 2
    padded = np.pad(grid, ((half, half), (0, 0)), mode="edge")
    out = np.zeros_like(grid)
    for i, weight in enumerate(kernel):
        out += weight * padded[i:i + grid.shape[0], :]
    return out


def smooth(grid, lats, degree, radius_km):
    """Separable smoothing with a longitude kernel that widens toward the poles.

    A kernel measured in DEGREES is a kernel that shrinks on the ground as it
    moves away from the equator: 4 degrees of longitude is 445 km at the
    equator and 152 km at 70 degrees north. Smoothing a global grid with one
    longitude kernel therefore over-smooths the tropics or under-smooths the
    Arctic, and the Arctic is where a good part of the Scandinavian and
    Canadian data sit. So longitude is convolved row by row.
    """
    deg_km = EARTH_KM * math.pi / 180.0
    out = np.zeros_like(grid)
    for row, lat in enumerate(lats):
        # 1/cos, bounded: at the pole itself the factor is infinite and the
        # whole row is one place anyway.
        widen = min(20.0, 1.0 / max(math.cos(math.radians(lat)), 0.05))
        cells = (radius_km / deg_km) * widen / degree
        out[row:row + 1, :] = convolve_rows_wrapping(grid[row:row + 1, :], gaussian(cells))
    return convolve_cols(out, gaussian((radius_km / deg_km) / degree))


def hsv_to_rgb(h, s, v):
    """Vectorised HSV, so the azimuth ramp can be a hue and stay cyclic."""
    i = np.floor(h * 6.0).astype(int) % 6
    f = h * 6.0 - np.floor(h * 6.0)
    p = v * (1 - s)
    q = v * (1 - f * s)
    t = v * (1 - (1 - f) * s)
    r = np.select([i == 0, i == 1, i == 2, i == 3, i == 4, i == 5], [v, q, p, p, t, v])
    g = np.select([i == 0, i == 1, i == 2, i == 3, i == 4, i == 5], [t, v, v, q, p, p])
    b = np.select([i == 0, i == 1, i == 2, i == 3, i == 4, i == 5], [p, p, t, v, v, q])
    return r, g, b


# What the database's codes mean, spelled out. A layer whose regime column
# reads "TF" is a layer nobody can read without the manual open beside them.
REGIME_NAME = {
    "NF": "Normal faulting",
    "NS": "Normal with strike-slip",
    "SS": "Strike-slip",
    "TS": "Thrust with strike-slip",
    "TF": "Thrust faulting",
    "U": "Undetermined",
}

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

# Half-length of the tick drawn for each measurement, in kilometres. The WSM's
# own maps scale the symbol by quality; here the whole set is one length and
# quality is a column you can colour or filter by instead, because a global
# layer of forty thousand segments at four different lengths is a texture
# rather than a map.
TICK_HALF_KM = 30.0


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


def tick(lat, lon, azimuth, half_km=TICK_HALF_KM):
    """A short segment centred on the site and oriented along SHmax.

    A stress measurement is a DIRECTION at a place, so the symbol every stress
    map has used for fifty years is an oriented tick rather than a dot — and
    drawn as a LineString it needs no new rendering: the vector layer that
    draws a coastline draws this.

    The east–west half is divided by cos(lat) so the tick keeps its bearing on
    the ground rather than being sheared toward the meridian as it goes north;
    without it a NE-trending measurement in Svalbard is drawn nearly north.
    """
    deg = half_km / (EARTH_KM * math.pi / 180.0)
    d_north = deg * math.cos(math.radians(azimuth))
    d_east = deg * math.sin(math.radians(azimuth)) / max(math.cos(math.radians(lat)), 0.05)
    return [
        [round(lon - d_east, 4), round(lat - d_north, 4)],
        [round(lon + d_east, 4), round(lat + d_north, 4)],
    ]


def write_vectors(data):
    """The measurements themselves, annotated, as oriented ticks.

    The raster answers "what is the stress field here"; this answers "who says
    so" — the method, the quality class, the depth, the faulting regime, and
    the principal-stress magnitudes for the few hundred records that have any.
    Both are wanted and neither replaces the other: an interpolated field with
    no way back to its data is a picture, and a picture is not evidence.
    """
    features = []
    for lat, lon, azi, _w, regime, row in data:
        props = {
            "azimuth": round(azi, 1),
            "regime": REGIME_NAME.get(regime, regime or "Undetermined"),
            "regime_code": regime,
            "quality": (row.get("QUALITY") or "").strip(),
            "method": METHOD_NAME.get((row.get("TYPE") or "").strip(),
                                      (row.get("TYPE") or "").strip()),
            "depth_km": number(row, "DEPTH"),
            "site": (row.get("SITE") or "").strip() or None,
            "country": (row.get("COUNTRY") or "").strip() or None,
            "wsm_id": (row.get("ID") or "").strip(),
        }
        # The magnitudes exist for well under one per cent of the records, so
        # they are carried where they are present and simply absent elsewhere.
        # Filling them with a placeholder would put a number in a column that
        # a reader would then average.
        for field, name in (("MAG_INT_S1", "s1_mpa"), ("MAG_INT_S2", "s2_mpa"),
                            ("MAG_INT_S3", "s3_mpa")):
            value = number(row, field)
            if value is not None:
                props[name] = value
        features.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": tick(lat, lon, azi)},
            "properties": {k: v for k, v in props.items() if v is not None},
        })

    collection = {
        "type": "FeatureCollection",
        "_source": {
            "name": "World Stress Map Database Release 2016",
            "doi": "https://doi.org/10.5880/WSM.2016.001",
            "licence": "CC BY 4.0",
            "citation": ("Heidbach, O., Rajabi, M., Reiter, K., Ziegler, M., WSM Team "
                         "(2016): World Stress Map Database Release 2016. V. 1.1. "
                         "GFZ Data Services."),
            "selection": "quality A-C with a determined SHmax azimuth",
            "geometry": (f"each record drawn as a {2 * TICK_HALF_KM:.0f} km segment "
                         "centred on the site and oriented along SHmax"),
            "magnitudes": ("s1_mpa/s2_mpa/s3_mpa are present on the few hundred "
                           "records that carry in-situ magnitudes; stress is a "
                           "tensor and the database is overwhelmingly a record of "
                           "its ORIENTATION and regime, not its size"),
        },
        "features": features,
    }
    path = OUT_DIR / "stress-vectors.geojson"
    path.write_text(json.dumps(collection, separators=(",", ":")), encoding="utf-8")
    with_mag = sum(1 for f in features if "s1_mpa" in f["properties"])
    print(f"wrote {path} ({path.stat().st_size / 1024 / 1024:.1f} MB, "
          f"{len(features)} ticks, {with_mag} with a magnitude)")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", default=None, help="wsm2016.csv (downloaded if absent)")
    parser.add_argument("--degree", type=float, default=0.5, help="grid step in degrees")
    parser.add_argument("--radius", type=float, default=SEARCH_KM, help="smoothing radius, km")
    args = parser.parse_args()

    # NOT into the data directory: that folder is published, and the 9 MB
    # source csv has no business being served to a browser that only ever
    # wants the 300 KB raster baked from it.
    path = pathlib.Path(args.csv) if args.csv else CACHE_DIR / "wsm2016.csv"
    if not path.exists():
        print(f"downloading {WSM_CSV}")
        path.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(WSM_CSV, path)

    data = load(path)
    if not data:
        sys.exit("no usable records — is that the WSM 2016 csv?")
    print(f"{len(data)} A-C records with an SHmax azimuth")

    step = args.degree
    width = int(round(360 / step))
    height = int(round(180 / step))
    lats = 90 - (np.arange(height) + 0.5) * step

    # Accumulate the DOUBLED angle. This is the whole trick with axial data:
    # doubling makes 10 and 190 degrees the same direction, so a vector sum
    # means what it should, and halving the answer brings it back.
    sin2 = np.zeros((height, width))
    cos2 = np.zeros((height, width))
    weight = np.zeros((height, width))
    for lat, lon, azi, w, _regime, _row in data:
        row = min(height - 1, max(0, int((90 - lat) / step)))
        col = int((lon + 180) / step) % width
        two = math.radians(2 * azi)
        sin2[row, col] += w * math.sin(two)
        cos2[row, col] += w * math.cos(two)
        weight[row, col] += w

    print(f"smoothing at {args.radius:.0f} km over a {width}x{height} grid")
    sin_s = smooth(sin2, lats, step, args.radius)
    cos_s = smooth(cos2, lats, step, args.radius)
    weight_s = smooth(weight, lats, step, args.radius)

    with np.errstate(invalid="ignore", divide="ignore"):
        resultant = np.where(weight_s > 0,
                             np.sqrt(sin_s ** 2 + cos_s ** 2) / np.maximum(weight_s, 1e-12),
                             0.0)
        azimuth = (np.degrees(np.arctan2(sin_s, cos_s)) / 2.0) % 180.0

    # The kernel is normalised, so the smoothed weight is a WEIGHTED DENSITY
    # and not a count -- and a density is a number nobody can put a threshold
    # on honestly. Undoing the normalisation turns it back into "how many
    # C-quality measurements this cell effectively sees", which is a sentence
    # with a meaning. The factor is per ROW, because the longitude kernel
    # widens toward the poles and a wider kernel is a smaller peak.
    deg_km = EARTH_KM * math.pi / 180.0
    sigma_lat = max(0.35, (args.radius / deg_km) / step)
    row_factor = np.array([
        2 * math.pi * sigma_lat
        * max(0.35, sigma_lat * min(20.0, 1.0 / max(math.cos(math.radians(lat)), 0.05)))
        for lat in lats
    ]).reshape(-1, 1)
    coverage = weight_s * row_factor / QUALITY_WEIGHT["C"]

    drawn = (coverage >= WEIGHT_FLOOR) & (resultant >= RESULTANT_FLOOR)
    print(f"{drawn.sum()} of {drawn.size} cells carry data "
          f"({100 * drawn.mean():.1f}% of the globe)")

    # Hue runs once round the wheel per 180 degrees of azimuth, which is what
    # makes the colour cyclic in the same way the quantity is: north-south and
    # north-south are the same colour whichever way you approach 180.
    hue = (azimuth / 180.0) % 1.0
    # Agreement drives saturation as well as alpha, so a contested region reads
    # as washed out at a glance rather than only in the transparency.
    sat = np.clip(0.35 + 0.65 * resultant, 0, 1)
    val = np.full_like(hue, 0.98)
    r, g, b = hsv_to_rgb(hue, sat, val)

    # Opacity carries BOTH kinds of confidence, and it has to.
    #
    # The resultant length says how well the data in a cell agree — but one
    # measurement agrees with itself perfectly, so agreement alone paints a
    # lone oceanic focal mechanism as solidly as the San Andreas, where six
    # hundred records sit within the radius. Measured: the South Pacific gyre
    # has exactly one record within 450 km and came out at the same opacity as
    # California. So support (how much data) multiplies agreement (how well it
    # agrees), with three C-equivalents taken as fully supported.
    support = np.clip(coverage / 3.0, 0, 1)
    agreement = np.clip((resultant - RESULTANT_FLOOR) / (1 - RESULTANT_FLOOR), 0, 1)
    alpha = np.where(drawn, np.clip(agreement * support * 0.92, 0.10, 0.92), 0.0)

    rgba = np.dstack([
        (r * 255).astype(np.uint8),
        (g * 255).astype(np.uint8),
        (b * 255).astype(np.uint8),
        (alpha * 255).astype(np.uint8),
    ])
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    png = OUT_DIR / "stress-shmax.png"
    Image.fromarray(rgba, "RGBA").save(png, optimize=True)
    print(f"wrote {png} ({png.stat().st_size / 1024:.0f} KB)")

    meta = {
        "id": "stress-shmax",
        "title": "SHmax orientation (World Stress Map 2016)",
        "bounds": {"west": -180, "east": 180, "south": -90, "north": 90},
        "grid": {"degree": step, "width": width, "height": height},
        "method": {
            "interpolation": "distance-weighted circular mean of the doubled azimuth",
            "radiusKm": args.radius,
            "qualityWeights": QUALITY_WEIGHT,
            "weightFloor": WEIGHT_FLOOR,
            "resultantFloor": RESULTANT_FLOOR,
            "note": ("SHmax is an axis: every mean is taken on 2*theta and halved. "
                     "Cells with no data within the radius, or whose data disagree, "
                     "are transparent rather than filled."),
        },
        "records": len(data),
        "cellsWithData": int(drawn.sum()),
        "coverage": round(float(drawn.mean()), 4),
        "colour": {
            "quantity": "SHmax azimuth, degrees clockwise from north",
            "cyclic": True,
            "period": 180,
            "ramp": "hue = azimuth / 180",
            "alpha": "resultant length (agreement) of the data in the cell",
        },
        "source": {
            "name": "World Stress Map Database Release 2016",
            "doi": "https://doi.org/10.5880/WSM.2016.001",
            "licence": "CC BY 4.0",
            "citation": ("Heidbach, O., Rajabi, M., Reiter, K., Ziegler, M., WSM Team "
                         "(2016): World Stress Map Database Release 2016. V. 1.1. "
                         "GFZ Data Services."),
        },
    }
    (OUT_DIR / "stress-shmax.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"wrote {OUT_DIR / 'stress-shmax.json'}")

    write_vectors(data)
    check(data, azimuth, coverage, resultant, step, width, height)


# Places whose stress orientation is not in dispute, and what is known about
# SHmax there. This is the check that matters: an interpolation can be
# arithmetically perfect and still be turned inside out by an axial average
# done wrong — and the result looks like a map either way.
REFERENCES = [
    (36.0, -120.0, "San Andreas, California", "N-S to NNE, ~010"),
    (35.0, 138.0, "central Honshu", "E-W, ~100"),
    (54.5, -6.5, "Northern Ireland", "NW-SE, ~135 (NW European field)"),
    (48.0, 8.0, "Upper Rhine Graben", "NW-SE, ~145"),
    (-24.0, 134.0, "central Australia", "E-W to ENE (Hillis & Reynolds)"),
]


def check(data, azimuth, coverage, resultant, step, width, height):
    """Compare the interpolated field with the raw records around each place."""
    print("\ncheck — interpolated against the records within the radius:")
    lats = np.array([d[0] for d in data])
    lons = np.array([d[1] for d in data])
    azis = np.array([d[2] for d in data])
    weights = np.array([d[3] for d in data])
    for lat, lon, name, expected in REFERENCES:
        row = min(height - 1, max(0, int((90 - lat) / step)))
        col = int((lon + 180) / step) % width
        d_lat = np.radians(lats - lat)
        d_lon = np.radians(lons - lon)
        hav = (np.sin(d_lat / 2) ** 2
               + math.cos(math.radians(lat)) * np.cos(np.radians(lats))
               * np.sin(d_lon / 2) ** 2)
        km = 2 * EARTH_KM * np.arcsin(np.sqrt(np.clip(hav, 0, 1)))
        # Weighted the way the SMOOTHING weights them, not by a hard cutoff.
        # The kernel is a Gaussian of sigma = the radius and reaches about
        # twice that, so a hard 450 km sample is a different quantity and
        # comparing against it invites the wrong conclusion — measured in
        # central Australia, where the field rotates across the continent: the
        # hard sample said 47° and the grid said 92°, and the grid was the one
        # agreeing with the literature.
        near = km < SEARCH_KM * 2
        if near.any():
            gauss = np.exp(-0.5 * (km[near] / SEARCH_KM) ** 2) * weights[near]
            two = np.radians(2 * azis[near])
            direct = math.degrees(math.atan2(
                float((gauss * np.sin(two)).sum()),
                float((gauss * np.cos(two)).sum()))) / 2 % 180
            # Axial difference: 5° and 175° are ten degrees apart, not 170.
            off = abs(azimuth[row, col] - direct) % 180
            off = min(off, 180 - off)
            raw = f"{direct:6.1f}° direct from {int(near.sum()):4d} records (off by {off:4.1f}°)"
        else:
            raw = "no records in range"
        print(f"  {name:26s} grid {azimuth[row, col]:6.1f}°  |  {raw}"
              f"  |  R={resultant[row, col]:.2f} n≈{coverage[row, col]:.0f}"
              f"  |  expected {expected}")


if __name__ == "__main__":
    main()
