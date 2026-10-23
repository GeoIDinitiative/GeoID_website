#!/usr/bin/env python3
"""Can AI predict flooding? A random forest on Wales's recorded floods, run on
today's rain.

The recipe, step by step, and where each step is in this file:

  1. INPUTS          fetch_*()     satellite land cover (ESA WorldCover 2021,
                                   Sentinel-1/2), rainfall (NOAA CPC daily
                                   gauge analysis for the past, Open-Meteo for
                                   now, HadUK-Grid 1991-2020 normals for the
                                   climate), elevation (Mapzen/AWS Terrarium,
                                   the DEM the globe streams) and its
                                   derivatives, superficial geology (BGS 625k)
                                   and the historical flood record (NRW
                                   Historic Flood Map: 1,223 dated outlines).
  2. ONE GRID        GRID, resample_*()
                                   everything goes onto one lon/lat lattice,
                                   0.003 x 0.002 deg (~205 x 222 m), masked to
                                   Wales's high-water-mark polygon.
  3. NO NaNs         fill_nearest(), idw()
                                   every gap is filled and COUNTED; the counts
                                   go into the published entry. Which method,
                                   where, and why is in FILLS below.
  4. TRAIN           train()       a random forest on (cell, event) pairs: a
                                   cell inside an event's outline is a 1, a
                                   cell of Wales outside it on the same dates
                                   is a 0, and each row carries that event's
                                   own rainfall.
  5. NOW             current()     the same forest fed the live rainfall
                                   (the past 30 days and the next 7 from
                                   Open-Meteo, the feed GeoHUB's Forecast panel
                                   reads) -> the susceptibility map for today.
  6. VALIDATE        validate()    a TEMPORAL hold-out: trained on events
                                   before 2005, scored on events from 2005 on,
                                   threshold fixed from the training data's own
                                   out-of-bag predictions before the test set
                                   is touched. hazard_metrics.report() makes
                                   the numbers the Analysis Hub shows.

    python3 GeoID_GIS/services/bake-flood-rf.py            fetch (cached), train, validate, map
    python3 GeoID_GIS/services/bake-flood-rf.py --current  refresh only today's map

Downloads are cached under data/global/.flood-rf-work/ (gitignored) in the
main checkout, the way every bake keeps its sources. Small on purpose: ~460k
land cells, ~60k training rows, 300 trees on two cores, about a minute.
"""
import argparse
import datetime
import heapq
import io
import json
import math
import os
import pathlib
import pickle
import subprocess
import sys
import urllib.parse
import urllib.request

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hazard_metrics  # noqa: E402

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent.parent
MAIN_DATA = pathlib.Path("/home/owen/GeoID_webpage_v1/data/global")
DATA = (REPO / "data" / "global") if (REPO / "data" / "global" / "cyclone-risk.geojson").exists() else MAIN_DATA
WORK = DATA / ".flood-rf-work"

# ── step 2: the one grid ────────────────────────────────────────────────────
BOUNDS = {"minX": -5.35, "maxX": -2.65, "minY": 51.35, "maxY": 53.45}
D_LON, D_LAT = 0.003, 0.002
W = round((BOUNDS["maxX"] - BOUNDS["minX"]) / D_LON)     # 900
H = round((BOUNDS["maxY"] - BOUNDS["minY"]) / D_LAT)     # 1050
MID_LAT = (BOUNDS["minY"] + BOUNDS["maxY"]) / 2
MX = D_LON * 111320 * math.cos(math.radians(MID_LAT))     # metres per cell east-west
MY = D_LAT * 110574
CELL_KM2 = MX * MY / 1e6

CHANNEL_KM2 = 2.0          # upstream area at which a cell is a channel (HAND, distance)
HOLDOUT_YEAR = 2005        # train on events before, test on events from
POS_CAP = 4000             # cells taken from one event's outline, at most
NEG_PER_POS = 2            # negatives per positive, same event, same rain
FOREST = dict(n_estimators=300, min_samples_leaf=10, max_features="sqrt",
              oob_score=True, n_jobs=2, random_state=1)

FEATURES = [
    ("elevation_m", "Terrarium DEM, bilinear onto the grid"),
    ("slope_deg", "Horn-style central differences of the DEM"),
    ("hand_m", "height above the nearest channel reached by D8 flow"),
    ("log10_upstream_km2", "D8 flow accumulation on the priority-flood-filled DEM"),
    ("channel_distance_m", "Euclidean distance to a cell draining >= 2 km2"),
    ("twi", "topographic wetness index ln(a / tan b)"),
    ("curvature", "Laplacian of the DEM (m per cell^2), negative in hollows"),
    ("deposit_score", "BGS 625k superficial unit scored as GeoHUB's NI flood map scores it"),
    ("alluvium", "BGS 625k: alluvium or tidal-flat deposit at the cell (0/1)"),
    ("peat", "BGS 625k: peat at the cell (0/1)"),
    ("built_frac", "WorldCover 2021: fraction of the cell built-up"),
    ("water_frac", "WorldCover 2021: fraction open water"),
    ("wetland_frac", "WorldCover 2021: fraction herbaceous wetland"),
    ("tree_frac", "WorldCover 2021: fraction tree cover"),
    ("crop_frac", "WorldCover 2021: fraction cropland"),
    ("rain_normal_mm", "HadUK-Grid 1991-2020 annual normal, IDW onto the grid"),
    ("rain_3day_max_mm", "the event's wettest 3 days (CPC past / Open-Meteo now)"),
    ("rain_30day_mm", "the 30 days before the event (antecedent wetness)"),
]
STATIC = [f for f, _ in FEATURES[:-2]]

# GeoHUB's NI flood screening table (viewer/gis/ni-flood.js DEPOSIT_SCORE),
# with the GB 625k codes that sheet never needed.
DEPOSIT_SCORE = {"ALV": 1.0, "TFD": 0.95, "LDE": 0.9, "MBD": 0.85, "RMD": 0.7, "SAMU": 0.7,
                 "RTDU": 0.6, "PEAT": 0.55, "BSA": 0.4, "GFDU": 0.3, "GSG": 0.3,
                 "TILL": 0.25, "HEAD": 0.2, "SLIP": 0.15, "UNKND": 0.2}
BEDROCK_SCORE = 0.2
ALLUVIAL = {"ALV", "TFD", "MBD", "SAMU", "LDE"}

FILLS = {}   # layer -> {"method", "cells", "why"}; published in the entry


def say(*a):
    print(*a, flush=True)


# ── fetching (step 1), every download cached ────────────────────────────────

def cached(name, url, binary=True, timeout=300):
    WORK.mkdir(parents=True, exist_ok=True)
    path = WORK / name
    if not path.exists():
        say(f"   fetch {name}")
        req = urllib.request.Request(url, headers={"User-Agent": "GeoID-bake/1.0 (geoidinitiative.com)"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = r.read()
        path.write_bytes(data)
    return path


def wfs_wales(type_name, file):
    url = ("https://datamap.gov.wales/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature"
           f"&typeName={type_name}&srsName=EPSG:4326&outputFormat=application/json")
    return json.loads(cached(file, url).read_text())


def fetch_floods():
    """NRW Historic Flood Map: every recorded outline in Wales, with dates."""
    return wfs_wales("inspire-nrw:NRW_HISTORIC_FLOODMAP", "nrw_historic_floodmap.geojson")["features"]


def fetch_wales():
    return wfs_wales("inspire-wg:wales_hwm", "wales_hwm.geojson")["features"]


def fetch_superficial():
    feats = []
    offset = 0
    b = BOUNDS
    while True:
        url = ("https://ogcapi.bgs.ac.uk/collections/bgsgeology625ksuperficial/items"
               f"?bbox={b['minX']},{b['minY']},{b['maxX']},{b['maxY']}&limit=1000&offset={offset}&f=json")
        page = json.loads(cached(f"bgs625k_superficial_{offset}.json", url).read_text())
        feats += page["features"]
        if len(page["features"]) < 1000:
            return feats
        offset += 1000


def fetch_rain_normals():
    b = BOUNDS
    url = ("https://services.arcgis.com/Lq3V5RFuTBC9I7kv/arcgis/rest/services/"
           "Annual_Precipitation_Observations_1991_2020/FeatureServer/0/query?where=1%3D1"
           f"&geometry={b['minX']},{b['minY']},{b['maxX']},{b['maxY']}&geometryType=esriGeometryEnvelope"
           "&inSR=4326&outSR=4326&outFields=*&f=geojson")
    return json.loads(cached("haduk_annual_normals.geojson", url).read_text())["features"]


def fetch_dem():
    """Terrarium tiles at zoom 10 (~95 m at 52 N), mosaicked in Web Mercator."""
    from PIL import Image
    z = 10
    n = 2 ** z

    def tile_x(lon):
        return (lon + 180) / 360 * n

    def tile_y(lat):
        return (1 - np.arcsinh(np.tan(np.radians(lat))) / np.pi) / 2 * n

    x0, x1 = int(tile_x(BOUNDS["minX"])), int(tile_x(BOUNDS["maxX"]))
    y0, y1 = int(tile_y(BOUNDS["maxY"])), int(tile_y(BOUNDS["minY"]))
    mosaic = np.zeros(((y1 - y0 + 1) * 256, (x1 - x0 + 1) * 256), np.float32)
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            path = cached(f"terrarium_{z}_{tx}_{ty}.png",
                          f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{tx}/{ty}.png")
            rgb = np.asarray(Image.open(path).convert("RGB"), np.float32)
            mosaic[(ty - y0) * 256:(ty - y0 + 1) * 256, (tx - x0) * 256:(tx - x0 + 1) * 256] = \
                rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768
    lons, lats = cell_centres()
    px = (tile_x(lons) - x0) * 256 - 0.5
    py = (tile_y(lats) - y0) * 256 - 0.5
    return bilinear(mosaic, px, py)


def fetch_worldcover():
    """ESA WorldCover 2021 v200, the two 3-degree tiles over Wales, read at their
    third level (1/3000 deg, ~33 m) and aggregated to class FRACTIONS per cell:
    9 x 6 pixels per cell exactly, because the grid's origin and steps were chosen
    to fall on the tile's pixel edges."""
    import tifffile
    tiles = []
    for lon in ("W006", "W003"):
        name = f"ESA_WorldCover_10m_2021_v200_N51{lon}_Map.tif"
        path = cached(name, f"https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/{name}")
        with tifffile.TiffFile(path) as tf:
            tiles.append(tf.series[0].levels[2].asarray())
    full = np.concatenate(tiles, axis=1)                  # lat 54..51, lon -6..0, 3000 px/deg
    c0 = round((BOUNDS["minX"] + 6) * 3000)
    r0 = round((54 - BOUNDS["maxY"]) * 3000)
    fx, fy = round(D_LON * 3000), round(D_LAT * 3000)
    block = full[r0:r0 + H * fy, c0:c0 + W * fx].reshape(H, fy, W, fx)
    valid = (block > 0).sum(axis=(1, 3)).astype(np.float32)
    out = {}
    for name, code in (("built_frac", 50), ("water_frac", 80), ("wetland_frac", 90),
                       ("tree_frac", 10), ("crop_frac", 40)):
        with np.errstate(invalid="ignore", divide="ignore"):
            out[name] = np.where(valid > 0, (block == code).sum(axis=(1, 3)) / valid, np.nan).astype(np.float32)
    return out


# CPC Global Unified Gauge-Based Analysis of Daily Precipitation, 0.5 deg,
# 1979-present (NOAA PSL; public domain). Rows 73..77 are 53.25..51.25 N, cols
# 709..714 are 354.75..357.25 E: the 30 half-degree cells over Wales.
CPC_LATS = np.array([53.25, 52.75, 52.25, 51.75, 51.25])
CPC_LONS = np.array([354.75, 355.25, 355.75, 356.25, 356.75, 357.25]) - 360


def fetch_cpc(year):
    days = 366 if year % 4 == 0 else 365
    if year == datetime.date.today().year:
        days = (datetime.date.today() - datetime.date(year, 1, 1)).days - 3   # the file grows daily
    url = ("https://psl.noaa.gov/thredds/dodsC/Datasets/cpc_global_precip/"
           f"precip.{year}.nc.ascii?" + urllib.parse.quote(f"precip[0:1:{days - 1}][73:1:77][709:1:714]", safe=":"))
    text = cached(f"cpc_{year}.txt", url).read_text()
    vals = []
    for line in text.split("precip.precip")[1].splitlines()[1:]:
        if line.startswith("["):
            vals.extend(float(v) for v in line.split(",")[1:])
        elif line.strip().startswith("precip.time") or line.strip() == "":
            if vals:
                break
    arr = np.array(vals, np.float32)
    n = arr.size // 30
    arr = arr[:n * 30].reshape(n, 5, 6)
    arr[(arr < 0) | (arr > 1000)] = np.nan                 # the file's fill value
    start = datetime.date(year, 1, 1)
    return {start + datetime.timedelta(days=i): arr[i] for i in range(min(n, days))}


def fetch_live_rain():
    """Open-Meteo at the same 30 half-degree centres: 30 days back, 7 ahead."""
    lat = ",".join(f"{la}" for la in CPC_LATS for _ in CPC_LONS)
    lon = ",".join(f"{lo}" for _ in CPC_LATS for lo in CPC_LONS)
    url = ("https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lon
           + "&daily=precipitation_sum&past_days=30&forecast_days=7&timezone=UTC")
    req = urllib.request.Request(url, headers={"User-Agent": "GeoID-bake/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        rows = json.loads(r.read())
    today = datetime.datetime.now(datetime.timezone.utc).date()
    dates = [datetime.date.fromisoformat(d) for d in rows[0]["daily"]["time"]]
    series = np.array([[np.nan if v is None else v for v in row["daily"]["precipitation_sum"]]
                       for row in rows], np.float32).reshape(5, 6, -1)
    past = np.array([d < today for d in dates])
    a30 = np.nansum(series[..., past][..., -30:], axis=-1)
    ahead = series[..., ~past]
    r3 = np.max(np.stack([np.nansum(ahead[..., i:i + 3], axis=-1) for i in range(ahead.shape[-1] - 2)]), axis=0)
    return {"rain_3day_max_mm": r3, "rain_30day_mm": a30, "issued": today.isoformat(),
            "window": f"{dates[0]}..{dates[-1]}"}


# ── step 2 helpers: the lattice, resampling, rasterising ────────────────────

def cell_centres():
    lons = BOUNDS["minX"] + (np.arange(W) + 0.5) * D_LON
    lats = BOUNDS["maxY"] - (np.arange(H) + 0.5) * D_LAT
    return np.meshgrid(lons, lats)


def bilinear(img, px, py):
    """Sample `img` at fractional pixel coordinates; NaN outside."""
    h, w = img.shape
    x0 = np.floor(px).astype(int)
    y0 = np.floor(py).astype(int)
    fx, fy = px - x0, py - y0
    ok = (x0 >= 0) & (y0 >= 0) & (x0 < w - 1) & (y0 < h - 1)
    x0c, y0c = np.clip(x0, 0, w - 2), np.clip(y0, 0, h - 2)
    v = (img[y0c, x0c] * (1 - fx) * (1 - fy) + img[y0c, x0c + 1] * fx * (1 - fy)
         + img[y0c + 1, x0c] * (1 - fx) * fy + img[y0c + 1, x0c + 1] * fx * fy)
    return np.where(ok, v, np.nan).astype(np.float32)


def resample_cpc(field, lons, lats):
    """A 5 x 6 half-degree field onto arbitrary points, bilinear, clamped at the
    edge (a Pembrokeshire cell west of the last CPC centre takes that centre)."""
    px = np.clip((lons - CPC_LONS[0]) / 0.5, 0, 5)
    py = np.clip((CPC_LATS[0] - lats) / 0.5, 0, 4)
    x0 = np.minimum(np.floor(px).astype(int), 4)
    y0 = np.minimum(np.floor(py).astype(int), 3)
    fx, fy = px - x0, py - y0
    f = field
    return (f[y0, x0] * (1 - fx) * (1 - fy) + f[y0, x0 + 1] * fx * (1 - fy)
            + f[y0 + 1, x0] * (1 - fx) * fy + f[y0 + 1, x0 + 1] * fx * fy).astype(np.float32)


def polygons(geometry):
    if not geometry:
        return []
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiPolygon":
        return geometry["coordinates"]
    return []


def rasterise(features, value_of=lambda f: 1, dtype=np.int16, fill=0):
    """Burn polygons onto the grid (cell centre inside), holes honoured, later
    features over earlier ones."""
    from PIL import Image, ImageDraw
    img = Image.new("I", (W, H), fill)
    draw = ImageDraw.Draw(img)

    def pix(ring):
        return [((x - BOUNDS["minX"]) / D_LON - 0.5, (BOUNDS["maxY"] - y) / D_LAT - 0.5) for x, y, *_ in ring]

    for f in features:
        v = int(value_of(f))
        for poly in polygons(f.get("geometry")):
            if len(poly[0]) >= 3:
                draw.polygon(pix(poly[0]), fill=v)
            for hole in poly[1:]:
                if len(hole) >= 3:
                    draw.polygon(pix(hole), fill=fill)
    return np.asarray(img, np.int32).astype(dtype)


# ── step 3: no NaNs, and a count of every one filled ────────────────────────

def fill_nearest(arr, mask, layer, why):
    """Gaps inside `mask` take the value of the nearest valid cell (a categorical
    or fractional field has no meaningful in-between)."""
    from scipy import ndimage
    gap = mask & ~np.isfinite(arr)
    FILLS[layer] = {"method": "nearest valid cell", "cells": int(gap.sum()), "why": why}
    if not gap.any():
        return arr
    idx = ndimage.distance_transform_edt(~np.isfinite(arr), sampling=(MY, MX),
                                         return_distances=False, return_indices=True)
    out = arr[idx[0], idx[1]]
    return np.where(gap, out, arr).astype(np.float32)


def idw(xy_known, values, xy_query, k=8, power=2.0):
    """Inverse-distance weighting over the k nearest known points (metres)."""
    from scipy.spatial import cKDTree
    tree = cKDTree(xy_known)
    k = min(k, len(values))
    d, i = tree.query(xy_query, k=k)
    if k == 1:
        d, i = d[:, None], i[:, None]
    exact = d[:, 0] < 1e-6
    w = 1.0 / np.maximum(d, 1e-6) ** power
    out = (w * values[i]).sum(axis=1) / w.sum(axis=1)
    out[exact] = values[i[exact, 0]]
    return out


def metres(lons, lats):
    return np.column_stack([lons * 111320 * math.cos(math.radians(MID_LAT)), lats * 110574])


# ── elevation derivatives ───────────────────────────────────────────────────

D8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def priority_flood(z, mask):
    """Fill depressions (Barnes et al. 2014, priority-flood + epsilon) so every
    cell drains to the sea or the grid's edge; returns the filled surface and the
    order cells were settled in, which is a downstream-to-upstream order."""
    h, w = z.shape
    filled = np.where(mask, z, -np.inf).astype(np.float64)
    done = ~mask.copy()
    heap = []
    edge = np.zeros_like(mask)
    edge[0, :] = edge[-1, :] = edge[:, 0] = edge[:, -1] = True
    from scipy import ndimage
    edge |= mask & ndimage.binary_dilation(~mask)          # next to sea / off-mask
    for r, c in zip(*np.nonzero(edge & mask)):
        heapq.heappush(heap, (filled[r, c], r, c))
        done[r, c] = True
    order = []
    eps = 1e-4
    while heap:
        v, r, c = heapq.heappop(heap)
        order.append(r * w + c)
        for dr, dc in D8:
            rr, cc = r + dr, c + dc
            if 0 <= rr < h and 0 <= cc < w and not done[rr, cc]:
                done[rr, cc] = True
                if filled[rr, cc] <= v:
                    filled[rr, cc] = v + eps
                heapq.heappush(heap, (filled[rr, cc], rr, cc))
    return filled, np.array(order, np.int64)


def d8_receivers(filled, mask):
    h, w = filled.shape
    best = np.full((h, w), -1, np.int64)
    drop = np.zeros((h, w))
    pad = np.pad(filled, 1, constant_values=-np.inf)
    for dr, dc in D8:
        dist = math.hypot(dr * MY, dc * MX)
        nb = pad[1 + dr:1 + dr + h, 1 + dc:1 + dc + w]
        s = (filled - nb) / dist
        better = s > drop
        rr = np.arange(h)[:, None] + dr
        cc = np.arange(w)[None, :] + dc
        target = rr * w + cc
        best = np.where(better & np.isfinite(nb), target, best)
        drop = np.where(better & np.isfinite(nb), s, drop)
    best[~mask] = -1
    return best.ravel()


def terrain(z, mask):
    say("   terrain: fill, D8, accumulation, HAND")
    filled, order = priority_flood(z, mask)
    recv = d8_receivers(filled, mask)
    acc = mask.ravel().astype(np.float64)
    for i in order[::-1]:                                  # upstream first
        j = recv[i]
        if j >= 0:
            acc[j] += acc[i]
    acc = acc.reshape(z.shape)
    channel = mask & (acc * CELL_KM2 >= CHANNEL_KM2)
    zf = z.ravel().astype(np.float64)
    drain = np.full(zf.size, np.nan)
    ch = channel.ravel()
    for i in order:                                        # downstream first
        j = recv[i]
        drain[i] = zf[i] if (ch[i] or j < 0) else drain[j]
    hand = np.maximum(0, zf - drain).reshape(z.shape)
    gy, gx = np.gradient(np.where(mask, z, np.nan), MY, MX)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    from scipy import ndimage
    dist = ndimage.distance_transform_edt(~channel, sampling=(MY, MX))
    zz = np.where(mask, z, np.nan)
    lap = (np.roll(zz, 1, 0) + np.roll(zz, -1, 0) + np.roll(zz, 1, 1) + np.roll(zz, -1, 1) - 4 * zz)
    a = acc * CELL_KM2 * 1e6 / math.sqrt(MX * MY)          # specific catchment area, m
    twi = np.log(a / np.tan(np.radians(np.maximum(slope, 0.1))))
    return {"slope_deg": slope, "hand_m": hand, "log10_upstream_km2": np.log10(acc * CELL_KM2),
            "channel_distance_m": dist, "twi": twi, "curvature": lap}, channel


# ── assembling the stack ────────────────────────────────────────────────────

def build_stack():
    say("step 1-3: inputs onto one grid, gaps filled")
    lons, lats = cell_centres()
    wales = rasterise(fetch_wales()) > 0
    dem = fetch_dem()
    # Terrarium carries BATHYMETRY under water, and the high-water-mark polygon
    # takes in the estuaries (Dee, Burry, Severn): a cell reading -270 m is the
    # sea floor, not land that floods, so it leaves the mask rather than being
    # filled -- and with it the curvature spike it put on every neighbour.
    seabed = wales & np.isfinite(dem) & (dem < -5)
    mask = wales & np.isfinite(dem) & ~seabed
    FILLS["elevation_m"] = {"method": "none needed; seabed cells dropped from the mask",
                            "cells": int((wales & ~np.isfinite(dem)).sum() + seabed.sum()),
                            "why": "Terrarium has no voids over Wales; cells below -5 m inside the high-water mark "
                                   "are estuary bathymetry and are not modelled"}
    stack = {"elevation_m": dem}
    t, channel = terrain(dem, mask)
    stack.update(t)
    for k in ("slope_deg", "curvature", "twi"):
        stack[k] = fill_nearest(stack[k].astype(np.float32), mask, k,
                                "the coastal ring where a central difference reaches the sea")

    sup = fetch_superficial()
    codes = sorted({f["properties"].get("lex") or "UNKND" for f in sup})
    code_id = {c: i + 1 for i, c in enumerate(codes)}
    unit = rasterise(sup, lambda f: code_id[f["properties"].get("lex") or "UNKND"])
    score = np.full(unit.shape, BEDROCK_SCORE, np.float32)
    for c, i in code_id.items():
        score[unit == i] = DEPOSIT_SCORE.get(c, 0.2)
    stack["deposit_score"] = score
    stack["alluvium"] = np.isin(unit, [code_id[c] for c in ALLUVIAL if c in code_id]).astype(np.float32)
    stack["peat"] = (unit == code_id.get("PEAT", -1)).astype(np.float32)
    FILLS["deposit_score"] = {"method": "not a gap: no superficial unit means bedrock at surface, scored 0.2",
                              "cells": int((mask & (unit == 0)).sum()),
                              "why": "the NI acceptance run lost two thirds of South Wales treating this as no-data"}

    wc = fetch_worldcover()
    for k, v in wc.items():
        stack[k] = fill_nearest(v, mask, k, "WorldCover no-data pixels (none expected over land)")

    normals = fetch_rain_normals()
    pts, vals = [], []
    for f in normals:
        pr = f["properties"].get("pr") or f["properties"].get("PR")
        rings = [p[0] for p in polygons(f["geometry"])]
        if pr is None or not rings:
            continue
        ring = np.array(rings[0])[:, :2]
        pts.append(ring.mean(axis=0))
        vals.append(float(pr))
    pts = np.array(pts)
    q = mask.ravel()
    rain = np.full(W * H, np.nan, np.float32)
    rain[q] = idw(metres(pts[:, 0], pts[:, 1]), np.array(vals), metres(lons.ravel()[q], lats.ravel()[q]))
    stack["rain_normal_mm"] = rain.reshape(H, W)
    FILLS["rain_normal_mm"] = {"method": "inverse-distance weighting, power 2, 8 nearest 12 km cells",
                               "cells": int(q.sum()),
                               "why": "HadUK-Grid's 12 km cells do not tile the coast or lakes (Lough Neagh and "
                                      "Slieve Donard came back empty in NI); every land cell is interpolated "
                                      f"from {len(vals)} cell centres so none is left out"}
    for k in STATIC:
        bad = mask & ~np.isfinite(stack[k])
        if bad.any():
            stack[k] = fill_nearest(stack[k].astype(np.float32), mask, k, "residual gaps after derivation")
    return stack, mask, channel


# ── step 4: the training table ──────────────────────────────────────────────

def event_windows(floods):
    """Outlines grouped by their recorded dates. Undated, pre-CPC (before
    February 1979, which leaves no 30-day antecedent) and placeholder dates (a
    single day on 1 January, which is how a year with no day gets recorded) are
    kept out of the event model and counted."""
    groups, skipped = {}, {"before 1979-02": 0, "1 January placeholder": 0, "undated": 0}
    for f in floods:
        p = f["properties"]
        s, e = p.get("start_date"), p.get("end_date") or p.get("start_date")
        if not s:
            skipped["undated"] += 1
            continue
        if s < "1979-02-01":
            skipped["before 1979-02"] += 1
            continue
        if s == e and s[5:] == "01-01":
            skipped["1 January placeholder"] += 1
            continue
        groups.setdefault((s, e), []).append(f)
    return groups, skipped


def rain_features(daily, s, e):
    """The event's wettest 3 days and the 30 days before it, as 5 x 6 fields."""
    s = datetime.date.fromisoformat(s)
    e = min(datetime.date.fromisoformat(e), s + datetime.timedelta(days=61))
    days = [s + datetime.timedelta(days=i) for i in range(-2, (e - s).days + 1)]
    seq = np.stack([daily[d] for d in days if d in daily])
    r3 = np.nanmax(np.stack([np.nansum(seq[i:i + 3], axis=0) for i in range(max(1, len(seq) - 2))]), axis=0)
    ante = [daily[s - datetime.timedelta(days=i)] for i in range(1, 31) if (s - datetime.timedelta(days=i)) in daily]
    return r3, np.nansum(np.stack(ante), axis=0)


def fill_cpc_day(field):
    """A CPC day with a missing cell: IDW from that day's other cells."""
    bad = ~np.isfinite(field)
    if not bad.any() or bad.all():
        return field, int(bad.sum())
    gx, gy = np.meshgrid(CPC_LONS, CPC_LATS)
    xy = metres(gx.ravel(), gy.ravel())
    out = field.copy().ravel()
    out[bad.ravel()] = idw(xy[~bad.ravel()], field.ravel()[~bad.ravel()], xy[bad.ravel()])
    return out.reshape(field.shape), int(bad.sum())


def training_table(stack, mask, floods, rng):
    say("step 4: (cell, event) table")
    groups, skipped = event_windows(floods)
    years = sorted({int(s[:4]) for s, _ in groups} | {int(s[:4]) - 1 for s, _ in groups})
    daily = {}
    for y in years:
        if y >= 1979:
            daily.update(fetch_cpc(y))
    filled = 0
    for d in list(daily):
        daily[d], n = fill_cpc_day(daily[d])
        filled += n
    FILLS["cpc_daily"] = {"method": "inverse-distance weighting across that day's other half-degree cells",
                          "cells": filled, "why": "a CPC cell with no gauge report on a day"}
    lons, lats = cell_centres()
    land = np.flatnonzero(mask.ravel())
    X, y, year, event_id = [], [], [], []
    static = np.column_stack([stack[k].ravel() for k in STATIC])
    events = []
    for n, ((s, e), feats) in enumerate(sorted(groups.items())):
        burned = (rasterise(feats) > 0).ravel() & mask.ravel()
        pos = np.flatnonzero(burned)
        if not pos.size:
            continue
        if pos.size > POS_CAP:
            pos = rng.choice(pos, POS_CAP, replace=False)
        outside = land[~burned[land]]
        neg = rng.choice(outside, min(outside.size, max(500, NEG_PER_POS * pos.size)), replace=False)
        cells = np.concatenate([pos, neg])
        r3f, a30f = rain_features(daily, s, e)
        r3 = resample_cpc(r3f, lons.ravel()[cells], lats.ravel()[cells])
        a30 = resample_cpc(a30f, lons.ravel()[cells], lats.ravel()[cells])
        X.append(np.column_stack([static[cells], r3, a30]))
        y.append(np.r_[np.ones(pos.size), np.zeros(neg.size)])
        year.append(np.full(cells.size, int(s[:4])))
        event_id.append(np.full(cells.size, n))
        events.append({"start": s, "end": e, "outlines": len(feats), "cells": int(burned.sum()),
                       "rain_3day_max_mm": round(float(np.nanmax(r3f)), 1)})
    return (np.vstack(X).astype(np.float32), np.concatenate(y).astype(np.int8),
            np.concatenate(year), np.concatenate(event_id), events, skipped)


def train(X, y):
    from sklearn.ensemble import RandomForestClassifier
    rf = RandomForestClassifier(**FOREST)
    rf.fit(X, y)
    return rf


# ── step 6: validate on held-out years ──────────────────────────────────────

def validate(X, y, year, events):
    say(f"step 6: temporal hold-out at {HOLDOUT_YEAR}")
    tr, te = year < HOLDOUT_YEAR, year >= HOLDOUT_YEAR
    rf = train(X[tr], y[tr])
    oob = rf.oob_decision_function_[:, 1]
    threshold = hazard_metrics.youden(list(zip(oob.tolist(), y[tr].tolist())))
    p = rf.predict_proba(X[te])[:, 1]
    pairs = list(zip(p.tolist(), y[te].tolist()))
    rep = hazard_metrics.report(pairs, threshold,
                                "Youden's J on the TRAINING events' out-of-bag predictions, fixed before the test set was scored")
    # the same test set scored with no rain at all: what the event rainfall adds
    rf_static = train(X[tr][:, :len(STATIC)], y[tr])
    auc_static = hazard_metrics.roc_auc(list(zip(rf_static.predict_proba(X[te][:, :len(STATIC)])[:, 1].tolist(),
                                                 y[te].tolist())))
    from sklearn.inspection import permutation_importance
    sub = np.random.default_rng(2).choice(np.flatnonzero(te), min(20000, int(te.sum())), replace=False)
    imp = permutation_importance(rf, X[sub], y[sub], scoring="roc_auc", n_repeats=3, random_state=1, n_jobs=2)
    importance = sorted(((FEATURES[i][0], round(float(imp.importances_mean[i]), 4)) for i in range(len(FEATURES))),
                        key=lambda kv: -kv[1])
    tr_events = sorted({e["start"] for e in events if int(e["start"][:4]) < HOLDOUT_YEAR})
    te_events = sorted({e["start"] for e in events if int(e["start"][:4]) >= HOLDOUT_YEAR})
    rep.update({"holdout": f"temporal: trained on {len(tr_events)} events before {HOLDOUT_YEAR}, "
                           f"scored on {len(te_events)} events from {HOLDOUT_YEAR} to {te_events[-1][:4]}",
                "events": "NRW Historic Flood Map outlines (cells inside an event's outline = 1; cells of Wales "
                          "outside it on the same dates = 0, two per positive and at least 500 per event)",
                "extra": {"oob_auc_training": hazard_metrics.roc_auc(list(zip(oob.tolist(), y[tr].tolist()))),
                          "auc_without_rainfall": auc_static,
                          "permutation_importance_auc": importance,
                          "train_rows": int(tr.sum()), "test_rows": int(te.sum())}})
    return rep


# ── step 5: today's map ─────────────────────────────────────────────────────

def current(rf, stack, mask, threshold):
    say("step 5: live rainfall -> today's susceptibility")
    live = fetch_live_rain()
    lons, lats = cell_centres()
    q = np.flatnonzero(mask.ravel())
    cols = [stack[k].ravel()[q] for k in STATIC]
    cols.append(resample_cpc(live["rain_3day_max_mm"], lons.ravel()[q], lats.ravel()[q]))
    cols.append(resample_cpc(live["rain_30day_mm"], lons.ravel()[q], lats.ravel()[q]))
    Xq = np.column_stack(cols).astype(np.float32)
    p = np.concatenate([rf.predict_proba(Xq[i:i + 100000])[:, 1] for i in range(0, len(q), 100000)])
    grid = np.full(W * H, np.nan, np.float32)
    grid[q] = p
    grid = grid.reshape(H, W)
    WORK.mkdir(parents=True, exist_ok=True)
    np.save(WORK / "current.npy", grid)
    tif = DATA / "flood-susceptibility-wales-current.tif"
    write_tif(grid, tif)
    png = WORK / "current.png"
    write_png(grid, png, threshold)
    summary = {"issued": live["issued"], "rain_window": live["window"],
               "rain_3day_max_mm": round(float(np.nanmax(live["rain_3day_max_mm"])), 1),
               "rain_30day_max_mm": round(float(np.nanmax(live["rain_30day_mm"])), 1),
               "cells_over_threshold": int(np.nansum(grid >= threshold)),
               "share_over_threshold": round(float(np.nansum(grid >= threshold) / len(q)), 4),
               "file": f"data/global/{tif.name}", "preview": str(png)}
    say("   ", summary)
    return summary


def write_tif(grid, path):
    """Through GeoHUB's own GeoTIFF writer, so the file a user opens is what the
    viewer would export."""
    raw = WORK / "current.f32"
    grid.astype("<f4").tofile(raw)
    js = (f"import {{ writeGeoTiff }} from '{(REPO / 'GeoID_GIS/viewer/gis/geotiff-writer.js').as_uri()}';"
          "import { readFileSync, writeFileSync } from 'node:fs';"
          f"const b = new Float32Array(readFileSync('{raw}').buffer.slice(0));"
          f"const r = {{ width: {W}, height: {H}, band: b, noData: null, bounds: {json.dumps(BOUNDS)} }};"
          f"writeFileSync('{path}', Buffer.from(writeGeoTiff(r, {{ noDataOut: -9999 }})));")
    subprocess.run(["node", "--input-type=module", "-e", js], check=True)


def write_png(grid, path, threshold):
    from PIL import Image
    v = np.nan_to_num(grid, nan=-1)
    ramp = np.array([[247, 251, 255], [198, 219, 239], [107, 174, 214], [33, 113, 181], [8, 48, 107]], np.float32)
    t = np.clip(v, 0, 1) * 4
    i = np.minimum(t.astype(int), 3)
    f = (t - i)[..., None]
    rgb = ramp[i] * (1 - f) + ramp[i + 1] * f
    rgb[v >= threshold] = [214, 39, 40]
    rgb[v < 0] = [40, 40, 40]
    Image.fromarray(rgb.astype(np.uint8)).resize((W, H)).save(path)


# ── the published entry ─────────────────────────────────────────────────────

def entry(rep, events, skipped, rf_all, threshold, now):
    imp = sorted(zip([f for f, _ in FEATURES], rf_all.feature_importances_.round(4).tolist()), key=lambda kv: -kv[1])
    return {
        "id": "flood-susceptibility-wales",
        "name": "Flood susceptibility — Wales (random forest on NRW records)",
        "hazard": "flood",
        "product": "data/global/flood-susceptibility-wales-current.tif — today's map; the NI prototype's "
                   "weighted overlay (ni-flood.js) remains the in-browser screening map",
        "model": {
            "method": "Random forest classifier on (cell, event) pairs: static terrain, geology, land cover and "
                      "climate at the cell plus that event's own rainfall; the output is the share of trees "
                      "voting 'flooded'.",
            "parameters": {"trees": FOREST["n_estimators"], "min_samples_leaf": FOREST["min_samples_leaf"],
                           "max_features": FOREST["max_features"], "random_state": FOREST["random_state"],
                           "negatives_per_positive": NEG_PER_POS, "positives_per_event_cap": POS_CAP,
                           "channel_threshold_km2": CHANNEL_KM2, "decision_threshold_published_map": round(threshold, 4),
                           "features": [f for f, _ in FEATURES],
                           "feature_importance_gini": imp},
            "inputs": [
                {"name": "Historical floods", "source": "Natural Resources Wales, Historic Flood Map (OGL v3)",
                 "detail": f"{len(events)} dated events used; excluded: {skipped}"},
                {"name": "Satellite land cover", "source": "ESA WorldCover 2021 v200 (Sentinel-1/2, CC BY 4.0)",
                 "detail": "10 m classes read at 33 m, as fractions per cell"},
                {"name": "Elevation", "source": "Terrarium DEM (AWS Open Data; SRTM/GMTED/OS Terrain), zoom 10",
                 "detail": "slope, HAND, upstream area, channel distance, TWI, curvature derived here"},
                {"name": "Superficial geology", "source": "BGS Geology 625k (OGL; Contains British Geological Survey materials © UKRI)"},
                {"name": "Rainfall, climate", "source": "Met Office HadUK-Grid 1991-2020 annual normals (OGL)"},
                {"name": "Rainfall, past events", "source": "NOAA CPC Global Unified Gauge-Based Daily Precipitation, 0.5° (public domain)"},
                {"name": "Rainfall, now", "source": "Open-Meteo forecast API, the feed GeoHUB's Forecast panel reads",
                 "detail": f"issued {now['issued']}, window {now['rain_window']}"},
            ],
            "grid": f"{W} x {H} cells of {D_LON} x {D_LAT} deg (~{MX:.0f} x {MY:.0f} m), Wales high-water-mark mask",
            "gap_fills": FILLS,
        },
        "validation": rep,
        "current": now,
        "limits": [
            "An outline's absence is not a dry record: NRW maps the floods it knows of, so some negatives were wet.",
            "Event rainfall is a 0.5° gauge analysis; a convective storm smaller than a cell is smoothed away.",
            "Repeat floods in the same towns put correlated cells in train and test; the temporal split keeps the "
            "events apart, not the places.",
            "The hold-out tests WHERE a storm floods, not WHETHER: each event's dry cells share its rain, so "
            "rainfall barely moves the held-out AUC (see auc_without_rainfall). How the map responds to today's "
            "rain is the forest's learnt between-event contrast and is not separately validated here.",
            "Negatives run at least 500 per event, so small events carry many more than two per positive; "
            "accuracy and specificity are read at that mix (positives/negatives on the card).",
            "Probabilities are relative (two negatives per positive in training), not annual chances; the decision "
            "threshold is what turns them into a map.",
            "Trained on Wales; transfer elsewhere (the NI prototype area) is an extrapolation of the same recipe, "
            "as the landslide recipe's South Wales validation was.",
        ],
        "script": "GeoID_GIS/services/bake-flood-rf.py",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--current", action="store_true", help="refresh today's map with the saved forest")
    args = ap.parse_args()
    rng = np.random.default_rng(1)
    stack_path = WORK / "stack.npz"
    if stack_path.exists():
        z = np.load(stack_path, allow_pickle=True)
        stack = {k: z[k] for k in z.files if k not in ("mask", "channel", "fills")}
        mask = z["mask"]
        FILLS.update(json.loads(str(z["fills"])))
    else:
        stack, mask, channel = build_stack()
        np.savez_compressed(stack_path, mask=mask, channel=channel, fills=json.dumps(FILLS), **stack)
    say(f"   {int(mask.sum()):,} land cells on a {W} x {H} grid")
    model_path = WORK / "forest.pkl"
    if args.current:
        with open(model_path, "rb") as f:
            saved = pickle.load(f)
        now = current(saved["rf"], stack, mask, saved["threshold"])
        prev = json.loads((REPO / "data/global/hazard-validation/flood-susceptibility-wales.json").read_text())
        prev["current"] = now
        prev.pop("generated", None)
        hazard_metrics.write_entry(prev)
        return 0
    floods = fetch_floods()
    X, y, year, _, events, skipped = training_table(stack, mask, floods, rng)
    say(f"   {len(y):,} rows, {int(y.sum()):,} flooded, {len(events)} events; skipped {skipped}")
    rep = validate(X, y, year, events)
    say("   held-out:", {k: rep[k] for k in ("auc", "accuracy", "precision", "recall", "f1", "kappa", "n")})
    rf_all = train(X, y)
    threshold = hazard_metrics.youden(list(zip(rf_all.oob_decision_function_[:, 1].tolist(), y.tolist())))
    with open(model_path, "wb") as f:
        pickle.dump({"rf": rf_all, "threshold": threshold, "features": [f for f, _ in FEATURES]}, f)
    now = current(rf_all, stack, mask, threshold)
    out = hazard_metrics.write_entry(entry(rep, events, skipped, rf_all, threshold, now))
    say("   wrote", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
