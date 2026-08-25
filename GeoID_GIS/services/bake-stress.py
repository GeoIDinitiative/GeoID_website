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
# How far apart the interpolation nodes sit, on the ground, everywhere. 55 km
# is half a degree at the equator, which is the resolution the published raster
# ends up at -- so the nodes are as dense as the picture and no denser.
NODE_KM = 55.0
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


class EqualAreaGrid:
    """A grid whose cells are the same size everywhere on the sphere.

    A lat/lon grid is not one. At 0.5 degrees its cells are 55 km by 55 km on
    the equator and 55 by 19 at 70 degrees north, so a global interpolation on
    it samples the Arctic nine times more densely than the tropics, spends most
    of its work there, and invites every mistake that comes of confusing a
    degree with a distance -- which is how the first two versions of this file
    went wrong.

    So the nodes are laid out in ROWS of constant latitude spacing, each row
    holding as many cells as fit round its own parallel at the same spacing:
    720 at the equator, 246 at 70 degrees, one at the pole. Every cell is
    about `spacing_km` across in both directions, every node carries the same
    weight of evidence, and the smoothing radius means the same thing at every
    latitude because it is measured in kilometres against nodes that are
    themselves evenly spread.

    The picture that comes out is still equirectangular -- that is what a
    texture on a sphere has to be -- but it is RESAMPLED from this, rather than
    computed on it. Along a row that resampling is exact: the row's cells are
    uniform in longitude, so each output pixel takes the cell it falls in.
    """

    def __init__(self, spacing_km):
        deg_km = EARTH_KM * math.pi / 180.0
        self.spacing_km = spacing_km
        self.d_lat = spacing_km / deg_km
        self.rows = max(2, int(round(180.0 / self.d_lat)))
        self.d_lat = 180.0 / self.rows

        self.lats = 90 - (np.arange(self.rows) + 0.5) * self.d_lat
        # Cells per row, proportional to the length of that parallel. Rounded up
        # to at least one, because a row that touches the pole is one place.
        circumference = np.cos(np.radians(self.lats)) * 360.0
        self.counts = np.maximum(1, np.round(circumference / self.d_lat).astype(int))
        self.starts = np.concatenate([[0], np.cumsum(self.counts)])
        self.size = int(self.starts[-1])

        # Every node's own position, flattened, so the scatter can address them
        # without a per-row Python loop.
        self.node_lat = np.repeat(self.lats, self.counts)
        self.node_lon = np.concatenate([
            -180 + (np.arange(n) + 0.5) * (360.0 / n) for n in self.counts
        ])
        self.node_lat_rad = np.radians(self.node_lat)
        self.node_lon_rad = np.radians(self.node_lon)
        self.cos_node_lat = np.cos(self.node_lat_rad)

    def row_of(self, lat):
        return int(np.clip((90 - lat) / self.d_lat, 0, self.rows - 1))

    def indices_near(self, lat, lon, reach_km):
        """The nodes within reach of a point, and their distances in km.

        Row-banded rather than tested against every node: a 450 km reach is
        eight rows at this spacing, and the columns inside those rows are a
        contiguous run because each row is uniform in longitude. The whole
        database costs a few million distance evaluations this way.
        """
        deg_km = EARTH_KM * math.pi / 180.0
        reach_deg = reach_km / deg_km
        row0 = max(0, self.row_of(lat + reach_deg))
        row1 = min(self.rows - 1, self.row_of(lat - reach_deg))
        picks = []
        for row in range(row0, row1 + 1):
            n = self.counts[row]
            step = 360.0 / n
            row_lat = self.lats[row]
            # How far round this parallel the reach carries, which is further
            # in longitude the closer the row is to a pole.
            span = math.cos(math.radians(min(abs(row_lat), 89.9)))
            if span <= 1e-6:
                width = n
            else:
                width = min(n, int(math.ceil(reach_deg / span / step)) * 2 + 1)
            if width >= n:
                cols = np.arange(n)
            else:
                centre = int(round((lon + 180) / step))
                cols = (np.arange(centre - width // 2, centre + width // 2 + 1)) % n
            picks.append(self.starts[row] + cols)
        if not picks:
            return np.empty(0, dtype=int), np.empty(0)
        idx = np.concatenate(picks)
        phi = math.radians(lat)
        d_lat = self.node_lat_rad[idx] - phi
        d_lon = self.node_lon_rad[idx] - math.radians(lon)
        d_lon = (d_lon + math.pi) % (2 * math.pi) - math.pi
        hav = (np.sin(d_lat / 2) ** 2
               + math.cos(phi) * self.cos_node_lat[idx] * np.sin(d_lon / 2) ** 2)
        km = 2 * EARTH_KM * np.arcsin(np.sqrt(np.clip(hav, 0, 1)))
        inside = km <= reach_km
        return idx[inside], km[inside]

    def to_raster(self, values, width, height):
        """Nodes back onto an equirectangular image, for the drape to wear.

        Nearest node along the row, which for these rows is exact rather than
        an approximation: the cells are uniform in longitude, so an output
        pixel falls in exactly one of them. Latitude takes the nearest row for
        the same reason.
        """
        out = np.zeros((height, width))
        for y in range(height):
            lat = 90 - (y + 0.5) * (180.0 / height)
            row = self.row_of(lat)
            n = self.counts[row]
            lons = -180 + (np.arange(width) + 0.5) * (360.0 / width)
            cols = np.floor((lons + 180) / (360.0 / n)).astype(int) % n
            out[y, :] = values[self.starts[row] + cols]
        return out


def accumulate(data, grid, radius_km, classes):
    """Every record scattered onto the nodes within reach of it.

    One pass over the database. For each record: find the nodes inside the
    search radius, weight them by `exp(-d²/2σ²)` on the great-circle distance
    with σ half the radius, and add the record's DOUBLED angle, its regime
    class and its weight to each. The doubling is what makes an average of
    axes mean anything — 10° and 190° are the same orientation, and a plain
    mean of them is 100°, exactly perpendicular to both.

    The weight is in units of C-quality records, so a node's total is a
    sentence: "this node effectively has three C-quality measurements within
    450 km". Nothing is normalised by cell area — the cells are all the same
    size — and nothing is stretched by latitude, because the nodes are evenly
    spread and the distances are real.
    """
    sigma_km = radius_km / 2.0
    sin2 = np.zeros(grid.size)
    cos2 = np.zeros(grid.size)
    weight = np.zeros(grid.size)
    regime = {key: np.zeros(grid.size) for key in classes}

    for lat, lon, azi, w, code, _row in data:
        idx, km = grid.indices_near(lat, lon, radius_km)
        if idx.size == 0:
            continue
        contribution = np.exp(-0.5 * (km / sigma_km) ** 2) * (w / QUALITY_WEIGHT["C"])
        two = math.radians(2 * azi)
        # `np.add.at` rather than `+=`: a record near a pole reaches every node
        # in a row, and buffered addition applies a repeated index ONCE.
        np.add.at(sin2, idx, contribution * math.sin(two))
        np.add.at(cos2, idx, contribution * math.cos(two))
        np.add.at(weight, idx, contribution)
        for key, share in REGIME_SPLIT.get(code, {"U": 1.0}).items():
            np.add.at(regime[key], idx, contribution * share)

    return sin2, cos2, weight, regime


# The cyclic ramp the orientation map is painted in.
#
# Full-saturation HSV round the wheel is the obvious choice for a cyclic
# quantity and it produced a lava lamp: every hue at maximum chroma, so the
# picture read as noise and the basemap under it was gone. These four stops
# wrap the same way -- the first and last are the same colour, because 179° and
# 1° are two degrees apart -- while staying at moderate saturation and roughly
# even lightness, so no orientation is louder than another and none of them
# looks like an absence of data.
AZIMUTH_RAMP = [
    (0.00, (70, 120, 190)),    # N-S
    (0.25, (110, 190, 130)),   # NE-SW
    (0.50, (225, 190, 90)),    # E-W
    (0.75, (200, 110, 150)),   # NW-SE
    (1.00, (70, 120, 190)),    # back to N-S
]


def azimuth_rgb(azimuth):
    """Vectorised lookup along the cyclic ramp, azimuth in degrees."""
    t = (np.asarray(azimuth) % 180.0) / 180.0
    positions = [p for p, _ in AZIMUTH_RAMP]
    out = []
    for channel in range(3):
        out.append(np.interp(t, positions, [c[channel] for _, c in AZIMUTH_RAMP]))
    return out


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


# The WSM's own regime colours, and the reason to keep them: anybody who has
# read a stress map has read this key. Red is extension, blue is shortening,
# green is neither -- and the published maps of the last thirty years all say
# so, which is worth more than a palette chosen here for looking nice.
REGIME_COLOUR = {
    "NF": (226, 68, 74),
    "SS": (58, 160, 58),
    "TF": (58, 107, 214),
    "U": (150, 150, 158),
}
# The two mixed classes are counted as half of each of the pair they name,
# because that is what they mean: a normal-with-strike-slip measurement is
# evidence for both and it should not be a fourth colour on a three-colour key.
REGIME_SPLIT = {
    "NF": {"NF": 1.0},
    "SS": {"SS": 1.0},
    "TF": {"TF": 1.0},
    "NS": {"NF": 0.5, "SS": 0.5},
    "TS": {"TF": 0.5, "SS": 0.5},
    "U": {"U": 1.0},
}


def regime_image(regime_grids, has_data, coverage):
    """Which way the crust is failing, as the dominant regime in each cell.

    An orientation map answers "which way is SHmax" and cannot answer "so
    what": the same NNE compression means a rift or a thrust belt depending on
    which principal stress is vertical. This is the other half, and it is the
    map the WSM itself publishes — red where the crust is pulling apart, blue
    where it is shortening, green where it is shearing past itself.

    A category cannot be averaged, and nothing here averages one. Each class
    was accumulated on its own grid with the same kernel, so what has been
    interpolated is each class's DENSITY, which is a number; the winner at a
    cell is the class with the most weight near it. The argmax of densities is
    a legitimate answer where the mean of category codes is not.
    """
    keys = list(REGIME_COLOUR)
    stack = np.stack([regime_grids[key] for key in keys])
    total = stack.sum(axis=0)
    winner = stack.argmax(axis=0)
    with np.errstate(invalid="ignore", divide="ignore"):
        share = np.where(total > 0, stack.max(axis=0) / np.maximum(total, 1e-12), 0.0)

    height, width = has_data.shape
    rgb = np.zeros((height, width, 3), dtype=np.uint8)
    for i, key in enumerate(keys):
        for channel in range(3):
            rgb[:, :, channel] = np.where(winner == i, REGIME_COLOUR[key][channel],
                                          rgb[:, :, channel])
    # How clearly it won, times how much data said so: a cell where 40% of the
    # weight is thrust and 35% is strike-slip has not chosen, and must not be
    # drawn as though it had.
    decisive = np.clip((share - 0.34) / 0.5, 0, 1)
    support = np.clip(coverage / 3.0, 0, 1)
    alpha = np.where(has_data, np.clip(decisive * support * 0.92, 0.08, 0.92), 0.0)
    return np.dstack([rgb, (alpha * 255).astype(np.uint8)])


def ramp_image(values, drawn, stops):
    """A single-variable grid as a colour ramp with a transparent mask."""
    t = np.clip(values, 0, 1)
    rgb = np.zeros(t.shape + (3,), dtype=float)
    positions = [p for p, _ in stops]
    for channel in range(3):
        rgb[:, :, channel] = np.interp(t, positions, [c[channel] for _, c in stops])
    alpha = np.where(drawn, 0.9, 0.0)
    return np.dstack([rgb.astype(np.uint8), (alpha * 255).astype(np.uint8)])


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
    parser.add_argument("--radius", type=float, default=SEARCH_KM,
                        help="search radius in km; records beyond it are not used")
    parser.add_argument("--spacing", type=float, default=NODE_KM,
                        help="node spacing of the equal-area grid, km")
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

    # The interpolation happens on nodes that are evenly spread over the
    # SPHERE, not on a lat/lon mesh: see EqualAreaGrid for why that distinction
    # is not pedantry. The picture is resampled from it afterwards, because a
    # texture on a globe has to be equirectangular whatever the maths was done
    # on.
    grid = EqualAreaGrid(args.spacing)
    print(f"{grid.size} nodes at {grid.spacing_km:.0f} km spacing "
          f"({grid.rows} rows, {grid.counts.max()} cells on the equator, "
          f"{grid.counts.min()} at the pole)")
    print(f"scattering {len(data)} records, {args.radius:.0f} km search radius")
    sin_n, cos_n, cover_n, regime_n = accumulate(data, grid, args.radius, REGIME_COLOUR)

    with np.errstate(invalid="ignore", divide="ignore"):
        resultant_n = np.where(cover_n > 0,
                               np.sqrt(sin_n ** 2 + cos_n ** 2) / np.maximum(cover_n, 1e-12),
                               0.0)
        azimuth_n = (np.degrees(np.arctan2(sin_n, cos_n)) / 2.0) % 180.0

    # Onto the image. Nearest node, which is exact along a row rather than an
    # approximation -- and it must be nearest rather than an average, because
    # an azimuth is cyclic and averaging 179 with 1 gives 90.
    azimuth = grid.to_raster(azimuth_n, width, height)
    coverage = grid.to_raster(cover_n, width, height)
    resultant = grid.to_raster(resultant_n, width, height)
    regime_grids = {key: grid.to_raster(value, width, height)
                    for key, value in regime_n.items()}

    # THREE masks, because the four pictures are asked three questions.
    #
    # The orientation and regime maps must not draw a mean of records that
    # disagree -- that is a number, not a measurement. But the AGREEMENT map
    # exists to show exactly those cells, and hiding them is self-defeating;
    # and the DENSITY map answers "is there data here", which does not depend
    # on whether the data concur. One mask for all four put a hole in the
    # middle of Australia on a map of HOW MUCH DATA THERE IS -- where what
    # Australia has is plenty of records and a field that rotates across the
    # continent, which is a fact about the stress and not about the coverage.
    has_data = coverage >= WEIGHT_FLOOR
    drawn = has_data & (resultant >= RESULTANT_FLOOR)
    shown_any = coverage >= WEIGHT_FLOOR / 2
    print(f"{drawn.sum()} of {drawn.size} cells carry a usable orientation "
          f"({100 * drawn.mean():.1f}% of the globe); "
          f"{100 * has_data.mean():.1f}% carry any data at all")

    # The ramp runs once round per 180 degrees, which is what makes the colour
    # cyclic in the same way the quantity is: an orientation approached from
    # either side of 180 is the same orientation and the same colour.
    r, g, b = azimuth_rgb(azimuth)
    r, g, b = r / 255.0, g / 255.0, b / 255.0
    # Agreement washes the colour toward grey as well as driving the alpha, so
    # a contested region reads as uncertain at a glance rather than only in the
    # transparency -- which is invisible over a dark ocean.
    mix = np.clip(0.35 + 0.65 * resultant, 0, 1)
    grey = 0.62
    r = grey + (r - grey) * mix
    g = grey + (g - grey) * mix
    b = grey + (b - grey) * mix

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
    # ── the other ways of mapping the same data ─────────────────────────────
    #
    # One field, four questions, and no single picture answers more than one of
    # them. Which way is SHmax (the azimuth), what is that doing to the crust
    # (the regime), do the measurements agree (the resultant), and is there
    # anything here at all (the density). The last two are the map of the map:
    # a reader who cannot see where the data are cannot tell an interpolation
    # from an observation.
    # Masked by whether there is DATA, not by whether the orientations agree.
    # A subduction zone mixes SHmax directions -- the Japan trench measures
    # R = 0.30 -- while agreeing perfectly about the regime: 60% thrust, which
    # is the least surprising fact in seismology. Using the orientation's mask
    # here put a hole in the regime map exactly over the trenches.
    Image.fromarray(regime_image(regime_grids, has_data, coverage)).save(
        OUT_DIR / "stress-regime.png", optimize=True)
    print(f"wrote {OUT_DIR / 'stress-regime.png'}")

    Image.fromarray(ramp_image(
        (resultant - RESULTANT_FLOOR) / (1 - RESULTANT_FLOOR), has_data,
        [(0.0, (40, 20, 70)), (0.5, (120, 60, 200)), (1.0, (255, 233, 168))],
    )).save(OUT_DIR / "stress-agreement.png", optimize=True)
    print(f"wrote {OUT_DIR / 'stress-agreement.png'}")

    # Log, because the density spans four orders of magnitude: California has a
    # thousand effective measurements and the mid-Atlantic has one, and on a
    # linear ramp everything outside a subduction zone is the same black.
    density = np.log10(np.maximum(coverage, 0.1) + 1) / np.log10(1000)
    Image.fromarray(ramp_image(
        density, shown_any,
        [(0.0, (12, 30, 50)), (0.5, (40, 160, 190)), (1.0, (255, 255, 220))],
    )).save(OUT_DIR / "stress-density.png", optimize=True)
    print(f"wrote {OUT_DIR / 'stress-density.png'}")

    meta["variants"] = {
        "shmax": "orientation of the maximum horizontal stress, hue cyclic over 180°",
        "regime": "dominant faulting regime — red normal, green strike-slip, blue thrust",
        "agreement": "resultant length: how consistently the records in a cell agree",
        "density": "effective C-quality measurements within the radius, log scale",
    }
    (OUT_DIR / "stress-shmax.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"wrote {OUT_DIR / 'stress-shmax.json'}")

    write_vectors(data)
    check(data, azimuth, coverage, resultant, step, width, height)
    check_regimes(data, regime_grids, drawn, step, width, height)


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


# Places where the faulting regime is not in dispute either. An orientation can
# be right while the regime map is inside out -- they are computed differently
# and only one of them is checked by the azimuth test above.
REGIME_REFERENCES = [
    (-2.0, 36.0, "East African rift", "NF"),
    (40.0, -114.0, "Basin and Range (Utah)", "NF"),
    (28.0, 85.0, "southern Tibet rifts", "NF"),
    (36.0, -120.0, "San Andreas", "SS"),
    (40.5, 31.0, "North Anatolian fault", "SS"),
    (30.0, 80.0, "western Himalaya", "TF"),
    (38.5, 142.0, "Japan trench", "TF"),
    (-1.0, 100.0, "Sumatra", "TF"),
]
# Two of these started out wrong and the map was right, which is the failure
# mode a reference list has: 39N 117W was filed as Basin and Range extension
# and is in the Walker Lane, where the records are 62% strike-slip; 28N 85E was
# filed as the Himalayan thrust front and is in southern Tibet, which extends.
# The grid reproduced the raw records to a percent in both cases. A check that
# disagrees with the data is a claim about the checker until it is measured.


def check_regimes(data, regime_grids, drawn, step, width, height):
    """The regime map against the raw records, at places with a known style.

    Two comparisons in one line, and they answer different questions. The GRID
    against the RECORDS is a check on the arithmetic — the same weighting, done
    twice, must agree. The winner against the EXPECTATION is a check on the
    geology, and it is the softer of the two: a reference point can be filed
    under the wrong tectonics, which is exactly what happened twice here.
    """
    print("\ncheck — dominant regime, grid against records:")
    keys = list(REGIME_COLOUR)
    stack = np.stack([regime_grids[key] for key in keys])
    lats = np.array([d[0] for d in data])
    lons = np.array([d[1] for d in data])
    weights = np.array([d[3] for d in data])
    codes = [d[4] for d in data]
    right = 0
    for lat, lon, name, expected in REGIME_REFERENCES:
        row = min(height - 1, max(0, int((90 - lat) / step)))
        col = int((lon + 180) / step) % width
        column = stack[:, row, col]
        total = float(column.sum())
        if total <= 0:
            print(f"      {name:24s} nothing in range")
            continue
        order = np.argsort(column)[::-1]
        won = keys[order[0]]

        d_lat = np.radians(lats - lat)
        d_lon = np.radians(lons - lon)
        hav = (np.sin(d_lat / 2) ** 2
               + math.cos(math.radians(lat)) * np.cos(np.radians(lats))
               * np.sin(d_lon / 2) ** 2)
        km = 2 * EARTH_KM * np.arcsin(np.sqrt(np.clip(hav, 0, 1)))
        kernel = np.exp(-0.5 * (km / (SEARCH_KM / 2)) ** 2)
        kernel[km > SEARCH_KM] = 0
        direct = {key: 0.0 for key in keys}
        for i in np.nonzero(kernel)[0]:
            for key, share in REGIME_SPLIT.get(codes[i], {"U": 1.0}).items():
                direct[key] += kernel[i] * weights[i] * share
        raw_total = sum(direct.values()) or 1.0
        raw_top = max(direct, key=direct.get)

        agree = "ok " if won == expected else "OUT"
        right += won == expected
        print(f"  {agree} {name:24s} grid {won} {100 * column[order[0]] / total:3.0f}%"
              f"  |  records {raw_top} {100 * direct[raw_top] / raw_total:3.0f}%"
              f"  |  expected {expected}  drawn={bool(drawn[row, col])}")
    print(f"      {right} of {len(REGIME_REFERENCES)} match the expectation")


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
        # Weighted exactly as the interpolation weights them: a Gaussian of
        # sigma = HALF the search radius, cut at the radius. This is a check
        # on the arithmetic, so a differently weighted sample tests nothing —
        # and it was measuring nothing for a while, because the kernel was
        # tightened here and not there: the offsets went from under a degree
        # to sixty-three in Australia, which is the check reporting on two
        # different questions rather than on an error.
        near = km < SEARCH_KM
        if near.any():
            gauss = np.exp(-0.5 * (km[near] / (SEARCH_KM / 2)) ** 2) * weights[near]
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
