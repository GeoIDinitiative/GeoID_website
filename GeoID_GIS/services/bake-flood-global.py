#!/usr/bin/env python3
"""Flood susceptibility for any ground on Earth: random forests trained on
floods mapped by Copernicus EMS in six regions, validated on the regions they
never saw.

Bake-flood-rf.py answered for Wales, from Wales's own flood record. A forest
trained on one country learns that country -- its rivers, its rain, its
mapping habits -- and says nothing defensible about the Mekong. So this one is
trained on COPERNICUS EMERGENCY MANAGEMENT SERVICE rapid-mapping delineations:
the flood extents analysts draw from satellite images during an activation,
each with the area they ANALYSED (area of interest, image footprint, minus the
"not analysed" cloud and gaps). Inside that, a cell outside the mapped flood
was looked at and was dry -- an observation, not an absence of record. EMS
products are free for any use with attribution (Copernicus data policy,
Regulation (EU) 2021/696), which a model sold by membership needs; the Global
Flood Database was the first candidate and is CC BY-NC, so it was set aside.

The open API serves activations from EMSR656 (2023) on; earlier ones need an
account. That is 90 floods, three quarters of them European -- which is why
Europe is three held-out regions and the scores for the Americas, Africa and
Asia rest on few activations and say so.

TWO TIERS, one recipe (the features are viewer/gis/flood-ml.js, run through
node by flood-ml-stack.mjs, so the page computes exactly what the forest was
trained on):

  fine    0.0025 deg (~250 m). Trained on each delineation's area of interest
          (at most 1 deg a side, centred on the flooding). The page runs it on
          demand over the view or a drawn area once the view is narrower than
          1.5 deg -- "resolution follows zoom", as the GFS and ECMWF layers do.
  coarse  0.1 deg. Trained on the 0.1-deg cells the delineations cover (a cell
          is flooded at >= 2% of its analysed area with a tenth of it analysed,
          dry below 0.2% with a quarter analysed), and run over the globe once: the layer you see before
          you zoom in.

THE STEPS:
  1 inputs    Terrarium DEM; Esri/Impact Observatory Sentinel-2 land cover
              (2020); Pelletier soil thickness; CPC 1991-2020 rain normal; CPC
              daily rain for each event; EMS observed flood extents
  2 one grid  per tier, flood-ml.js makeGrid
  3 no NaNs   flood-ml.js buildStack: nearest-valid fill, counted per feature,
              and the counts published
  4 train     random forest per tier on (cell, event) rows
  5 now       the coarse forest on the latest CPC week -> the global map; the
              fine forest in the page on Open-Meteo's
  6 validate  LEAVE ONE REGION OUT: for each region, a forest trained on the
              other five scores it, at a threshold fixed from that forest's own
              out-of-bag votes. Per-region accuracy, precision, recall, F1, AUC.

    python3 GeoID_GIS/services/bake-flood-global.py select     every EMS flood delineation (byte-range reads)
    python3 GeoID_GIS/services/bake-flood-global.py static     the global 0.1 deg stack (DEM, land cover, soil, rain normal)
    python3 GeoID_GIS/services/bake-flood-global.py build      features + labels, cached per event
    python3 GeoID_GIS/services/bake-flood-global.py train      LORO validation, final forests, entries
    python3 GeoID_GIS/services/bake-flood-global.py current    today's global map from the saved forest
    python3 GeoID_GIS/services/bake-flood-global.py area W S E N label   the 250 m tier over a box, as the page runs it

Everything downloaded is cached under data/global/.flood-global-work/; the
products go to data/global/flood-ml/ (publish with publish-data.py).
"""
import concurrent.futures as cf
import datetime
import json
import math
import os
import pathlib
import pickle
import re
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
WORK = DATA / ".flood-global-work"
OUT = DATA / "flood-ml"
SOIL_TIF = DATA / "soil-thickness" / "soil_thickness_1km.hotlink-ok.tif"
UA = {"User-Agent": "GeoID-bake/1.0 (geoidinitiative.com)"}

FINE_CELL, FINE_ZOOM, FINE_K, FINE_WINDOW = 0.0025, 10, 4, 1.0
COARSE_CELL, COARSE_ZOOM, COARSE_K = 0.1, 5, 4
GLOBAL = {"west": -180.0, "east": 180.0, "south": -60.0, "north": 84.0}
# Depth 10 and 100 trees because the fine forest is DOWNLOADED by the page:
# at depth 14 one tree ran to ~15k nodes and the forest to ~50 MB of JSON.
FOREST = dict(n_estimators=100, max_depth=10, min_samples_leaf=20, max_features="sqrt",
              oob_score=True, n_jobs=2, random_state=1)
POS_CAP, NEG_PER_POS = 2500, 2

# Held-out regions, by the activation's centroid, drawn where Copernicus EMS
# has mapped floods: the open API is three quarters European, so Europe is
# split three ways and the rest of the world is three regions of its own.
REGIONS = [
    ("americas", lambda lon, lat: lon < -30),
    ("asia", lambda lon, lat: lon >= 60),
    ("africa", lambda lon, lat: lat < 30 or lon >= 45),
    ("mediterranean", lambda lon, lat: lat < 44.5),
    ("europe-north-west", lambda lon, lat: lon < 12),
    ("europe-central-east", lambda lon, lat: True),
]


def region_of(lon, lat):
    if lon is None or lat is None:
        return None
    for name, test in REGIONS:
        if test(lon, lat):
            return name
    return None


def say(*a):
    print(*a, flush=True)


def get(url, timeout=300, tries=5):
    """A GET with backoff: the EMS backend answers 403 to a burst of requests
    (measured: half of one parallel pass refused, every one of them fine when
    asked again alone), and CPC's THREDDS drops the odd connection."""
    import time
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code not in (403, 429, 500, 502, 503, 504) or attempt == tries - 1:
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == tries - 1:
                raise
        time.sleep(5 * 2 ** attempt)


def cached(path, url, timeout=300):
    path = pathlib.Path(path)
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        data = get(url, timeout)
        tmp = path.with_suffix(path.suffix + ".part")
        tmp.write_bytes(data)
        tmp.replace(path)
    return path


# ── the flood record: Copernicus EMS rapid mapping ─────────────────────────

EMS = "https://rapidmapping.emergency.copernicus.eu/backend"
# The layers of a delineation product this bake reads; everything else in the
# product (PDF maps, geopackages, depth rasters) is never downloaded.
EMS_LAYERS = ("observedEventA", "areaOfInterestA", "notAnalysedA", "imageFootprintA", "hydrographyA")


class RangeFile:
    """A read-only, seekable view of a URL by HTTP byte ranges, so zipfile can
    read a central directory and one member without the rest of the archive."""

    def __init__(self, url, offset=0, size=None, resign=None):
        # `resign` mints a fresh address: the EMS backend's signed S3 URLs
        # EXPIRE TEN SECONDS after they are issued (Expires = now + 10,
        # measured), so a product read that takes longer is refused 403
        # half-way through unless the address is renewed.
        self.url, self.base, self.pos, self.resign = url, offset, 0, resign
        if size is None:
            req = urllib.request.Request(url, headers={**UA, "Range": "bytes=0-0"})
            with urllib.request.urlopen(req, timeout=120) as r:
                size = int(r.headers["Content-Range"].split("/")[1])
        self.size = size

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, pos, whence=0):
        self.pos = pos if whence == 0 else self.pos + pos if whence == 1 else self.size + pos
        return self.pos

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        n = max(0, min(n, self.size - self.pos))
        if not n:
            return b""
        a = self.base + self.pos
        for attempt in range(5):
            req = urllib.request.Request(self.url, headers={**UA, "Range": f"bytes={a}-{a + n - 1}"})
            try:
                with urllib.request.urlopen(req, timeout=180) as r:
                    data = r.read()
                break
            except urllib.error.HTTPError as e:
                if e.code == 403 and self.resign:
                    self.url = self.resign()
                    continue
                if attempt == 4:
                    raise
            except Exception:
                if attempt == 4:
                    raise
            import time
            time.sleep(3 * 2 ** attempt)
        self.pos += len(data)
        return data


def signed_url(code, tries=5):
    import time
    for attempt in range(tries):
        try:
            return _signed_url(code)
        except urllib.error.HTTPError as e:
            if e.code not in (403, 429, 500, 502, 503) or attempt == tries - 1:
                raise
        time.sleep(5 * 2 ** attempt)


def _signed_url(code):
    """The products zip's S3 address (the backend answers with a signed redirect)."""
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None
    opener = urllib.request.build_opener(NoRedirect)
    try:
        opener.open(urllib.request.Request(f"{EMS}/{code}/{code}_products.zip", headers=UA), timeout=60)
    except urllib.error.HTTPError as e:
        if e.code in (301, 302, 303, 307):
            return e.headers["Location"]
        raise
    raise RuntimeError(f"{code}: no redirect to the products archive")


def ems_list():
    path = WORK / "ems" / "activations.json"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(get(f"{EMS}/dashboard-api/public-activations-info/?limit=2000"))
    return [a for a in json.loads(path.read_text())["results"] if a.get("category") == "Flood"]


def ems_detail(code):
    path = WORK / "ems" / f"{code}.json"
    if not path.exists():
        path.write_bytes(get(f"{EMS}/dashboard-api/public-activations/?code={code}"))
    return json.loads(path.read_text())["results"][0]


def ems_products(code):
    """Delineation (DEL) and first-estimate (FEP) products in an activation,
    each with the layers above, read member by member out of the nested zips
    and cached as one small JSON per product."""
    import io
    import zipfile
    done = WORK / "ems" / f"{code}_products.json"
    if done.exists():
        return json.loads(done.read_text())
    resign = lambda: signed_url(code)                    # noqa: E731
    outer = RangeFile(resign(), resign=resign)
    oz = zipfile.ZipFile(outer)
    out = []
    for info in oz.infolist():
        name = info.filename
        if not re.search(r"_(DEL|FEP)_[A-Z]*_?v\d+\.zip$|_(DEL|FEP)_PRODUCT_v\d+\.zip$", name):
            continue
        if info.compress_type != 0:
            continue                                     # a deflated inner zip would have to come down whole
        outer.seek(info.header_offset)
        head = outer.read(30)
        start = info.header_offset + 30 + int.from_bytes(head[26:28], "little") + int.from_bytes(head[28:30], "little")
        inner = RangeFile(outer.url, start, info.file_size, resign=resign)
        iz = zipfile.ZipFile(inner)
        layers = {}
        for layer in EMS_LAYERS:
            member = next((m for m in iz.namelist() if m.endswith(f"_{layer}_v{name.split('_v')[-1][:-4]}.json")
                           or re.search(rf"_{layer}_v\d+\.json$", m)), None)
            if member:
                layers[layer] = json.loads(iz.read(member))["features"]
        if layers.get("observedEventA") and layers.get("areaOfInterestA"):
            path = WORK / "ems" / f"{name[:-4]}.json"
            path.write_text(json.dumps(layers))
            out.append({"product": name[:-4], "path": str(path),
                        "observed": len(layers["observedEventA"])})
    done.write_text(json.dumps(out))
    return out


def zipfile_error():
    import zipfile
    return zipfile.BadZipFile


def centroid_of(wkt):
    nums = re.findall(r"-?\d+\.?\d*", wkt or "")
    return (float(nums[0]), float(nums[1])) if len(nums) >= 2 else (None, None)


def select():
    """Every EMS flood activation the open API serves, with its delineations."""
    acts = ems_list()
    say(f"   {len(acts)} flood activations in the open EMS rapid-mapping API")
    events = []

    def one(a):
        try:
            d = ems_detail(a["code"])
            prods = ems_products(a["code"])
        except zipfile_error() as error:
            say(f"   skip {a['code']}: its products archive is not a zip ({error})")
            return []
        except Exception as error:
            say(f"   skip {a['code']}: {error}")
            return []
        lon, lat = centroid_of(d.get("centroid") or a.get("centroid"))
        return [{"code": a["code"], "product": p["product"], "path": p["path"], "name": d.get("name"),
                 "countries": a.get("countries"), "start": (d.get("eventTime") or a["eventTime"])[:10],
                 "region": region_of(lon, lat), "lon": lon, "lat": lat} for p in prods]

    with cf.ThreadPoolExecutor(2) as pool:
        for evs in pool.map(one, acts):
            events += evs
    unique = {}
    for e in events:                                   # an archive can list a product twice
        unique.setdefault(e["product"], e)
    events = list(unique.values())
    (WORK / "chosen.json").write_text(json.dumps(events, indent=1))
    by = {}
    for e in events:
        by.setdefault(e["region"], set()).add(e["code"])
    for region, _ in REGIONS:
        say(f"   {region:22s} {len(by.get(region, ())):3d} activations, "
            f"{sum(1 for e in events if e['region'] == region):4d} products")
    size = sum(os.path.getsize(e["path"]) for e in events)
    say(f"   {len(events)} delineation products, {size / 1e6:.0f} MB of layers")
    return events


# ── inputs ──────────────────────────────────────────────────────────────────

def tile_x(lon, n):
    return (lon + 180) / 360 * n


def tile_y(lat, n):
    return (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


def grid_of(bounds, cell):
    """flood-ml.js makeGrid, for sizing arrays here (node recomputes it)."""
    west = math.floor(bounds["west"] / cell) * cell
    east = math.ceil(bounds["east"] / cell) * cell
    south = math.floor(bounds["south"] / cell) * cell
    north = math.ceil(bounds["north"] / cell) * cell
    return {"west": west, "east": east, "south": south, "north": north, "cell": cell,
            "width": max(1, round((east - west) / cell)), "height": max(1, round((north - south) / cell))}


def dem_mosaic(grid, zoom):
    """Decoded Terrarium tiles over the grid, and the plan flood-ml.js reads them by."""
    from PIL import Image
    n = 2 ** zoom
    x0 = max(0, int(tile_x(grid["west"], n)))
    x1 = min(n - 1, int(tile_x(grid["east"] - 1e-9, n)))
    y0 = max(0, int(tile_y(min(85.05, grid["north"]), n)))
    y1 = min(n - 1, int(tile_y(max(-85.05, grid["south"] + 1e-9), n)))
    plan = {"zoom": zoom, "x0": x0, "x1": x1, "y0": y0, "y1": y1, "cols": x1 - x0 + 1, "rows": y1 - y0 + 1}
    mosaic = np.zeros((plan["rows"] * 256, plan["cols"] * 256), np.float32)

    def one(t):
        tx, ty = t
        path = cached(WORK / "terrarium" / f"{zoom}_{tx}_{ty}.png",
                      f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{zoom}/{tx}/{ty}.png")
        rgb = np.asarray(Image.open(path).convert("RGB"), np.float32)
        return tx, ty, rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768

    tiles = [(tx, ty) for ty in range(y0, y1 + 1) for tx in range(x0, x1 + 1)]
    with cf.ThreadPoolExecutor(8) as pool:
        for tx, ty, h in pool.map(one, tiles):
            mosaic[(ty - y0) * 256:(ty - y0 + 1) * 256, (tx - x0) * 256:(tx - x0 + 1) * 256] = h
    return mosaic, plan


LC_SERVICE = "https://ic.imagery1.arcgis.com/arcgis/rest/services/Sentinel2_10m_LandCover/ImageServer"
LC_YEAR = 2020


def land_cover(grid, k, key):
    """flood-ml.js landCoverUrl, in pieces of at most 4000 px a side."""
    import tifffile
    W, H = grid["width"] * k, grid["height"] * k
    out = np.zeros((H, W), np.uint8)
    t0 = int(datetime.datetime(LC_YEAR, 1, 1, tzinfo=datetime.timezone.utc).timestamp() * 1000)
    t1 = int(datetime.datetime(LC_YEAR, 12, 31, 23, 59, 59, tzinfo=datetime.timezone.utc).timestamp() * 1000)
    step = 4000 - 4000 % k
    jobs = []
    for py in range(0, H, step):
        for px in range(0, W, step):
            w, h = min(step, W - px), min(step, H - py)
            west = grid["west"] + px / k * grid["cell"]
            north = grid["north"] - py / k * grid["cell"]
            east, south = west + w / k * grid["cell"], north - h / k * grid["cell"]
            url = (f"{LC_SERVICE}/exportImage?bbox={west},{south},{east},{north}&bboxSR=4326&imageSR=4326"
                   f"&size={w},{h}&format=tiff&pixelType=U8&interpolation=RSP_NearestNeighbor"
                   f"&time={t0},{t1}&f=image")
            jobs.append((px, py, w, h, url, WORK / "lc" / f"{key}_{px}_{py}.tif"))

    def one(j):
        px, py, w, h, url, path = j
        a = tifffile.imread(cached(path, url))
        if a.ndim == 3:
            a = a[..., 0]
        return px, py, a[:h, :w]

    with cf.ThreadPoolExecutor(4) as pool:
        for px, py, a in pool.map(one, jobs):
            out[py:py + a.shape[0], px:px + a.shape[1]] = a
    return out


class SoilTif:
    """Pelletier's grid read tile by tile, so a window costs the tiles it touches."""

    def __init__(self):
        import tifffile
        self.tf = tifffile.TiffFile(SOIL_TIF)
        self.page = self.tf.pages[0]
        self.H, self.W = self.page.shape
        self.tile = self.page.tilewidth
        self.deg = 1 / 120

    def window(self, x0, y0, x1, y1):
        out = np.full((y1 - y0, x1 - x0), 255, np.uint8)
        fh = self.tf.filehandle
        tw = self.tile
        across = math.ceil(self.W / tw)
        for ty in range(y0 // tw, (y1 - 1) // tw + 1):
            for tx in range(x0 // tw, (x1 - 1) // tw + 1):
                idx = ty * across + tx
                fh.seek(self.page.dataoffsets[idx])
                data = fh.read(self.page.databytecounts[idx])
                tile, _, _ = self.page.decode(data, idx)
                tile = tile.reshape(tw, tw)
                ys, xs = ty * tw, tx * tw
                a0, a1 = max(y0, ys), min(y1, ys + tw)
                b0, b1 = max(x0, xs), min(x1, xs + tw)
                out[a0 - y0:a1 - y0, b0 - x0:b1 - x0] = tile[a0 - ys:a1 - ys, b0 - xs:b1 - xs]
        return out

    def native_for(self, grid):
        """soil-thickness.js thicknessGridFor's window, for flood-ml.js soilOnGrid."""
        x0 = max(0, math.floor((grid["west"] + 180) / self.deg))
        x1 = min(self.W, math.ceil((grid["east"] + 180) / self.deg))
        y0 = max(0, math.floor((90 - grid["north"]) / self.deg))
        y1 = min(self.H, math.ceil((90 - grid["south"]) / self.deg))
        meta = {"width": x1 - x0, "height": y1 - y0, "origin": {"x": x0, "y": y0}, "degrees": self.deg,
                "world": {"west": -180, "north": 90}, "noData": 255}
        return meta, self.window(x0, y0, x1, y1)

    def block_mean(self, grid):
        """The coarse tier: each 0.1 deg cell the mean of its 12 x 12 native cells."""
        f = round(grid["cell"] / self.deg)
        out = np.full((grid["height"], grid["width"]), np.nan, np.float32)
        y_start = round((90 - grid["north"]) / self.deg)
        for r in range(grid["height"]):
            y0 = y_start + r * f
            if y0 + f > self.H:
                break
            strip = self.window(0, y0, self.W, y0 + f).astype(np.float32)
            strip[strip == 255] = np.nan
            blocks = strip.reshape(f, self.W // f, f)
            with np.errstate(invalid="ignore"):
                out[r] = np.nanmean(blocks, axis=(0, 2))[:grid["width"]]
        return out


# CPC Global Unified Gauge-Based Analysis of Daily Precipitation (NOAA PSL,
# public domain): 0.5 deg, lat 89.75 .. -89.75 north to south, lon 0.25 .. 359.75.
CPC = "https://psl.noaa.gov/thredds/dodsC/Datasets/cpc_global_precip"


def cpc_normal():
    """Annual total, 1991-2020, from the daily long-term mean (every 5th day,
    times 365 over 73: the climatology is smooth enough that this is within a
    per cent of the full sum, at a fifth of the transfer). Baked once to a
    small asset the page reads too."""
    asset = OUT / "rain-normal-cpc.json"
    if asset.exists():
        d = json.loads(asset.read_text())
        return np.array(d["values"], np.float32).reshape(d["lattice"]["nLat"], d["lattice"]["nLon"]), d["lattice"]
    import netCDF4
    ds = netCDF4.Dataset(f"{CPC}/precip.day.1991-2020.ltm.nc")
    # One day per read: a STRIDED read over OPeNDAP (`[::5]`) came back as
    # zeros everywhere, ocean included -- unmasked zeros, so nothing flagged it
    # until the stack's rain column read 0 mm on every cell of the globe.
    days = [np.ma.filled(ds["precip"][t, :, :].astype(np.float64), np.nan) for t in range(0, 365, 5)]
    annual = np.nanmean(np.stack(days), axis=0) * 365
    if not np.nanmax(annual) > 1000:
        raise RuntimeError(f"CPC normal reads {np.nanmax(annual):.0f} mm at its wettest: the read is wrong")
    annual = np.roll(annual, 360, axis=1)          # lon 0..360 -> -180..180
    lattice = {"nLat": 360, "nLon": 720, "lat0": 89.75, "lon0": -179.75, "dLat": -0.5, "dLon": 0.5, "wrap": True}
    OUT.mkdir(parents=True, exist_ok=True)
    vals = [None if not np.isfinite(x) else int(round(x)) for x in annual.ravel()]
    asset.write_text(json.dumps({"about": "CPC Global Unified daily precipitation, 1991-2020 long-term mean, "
                                          "summed to an annual total (mm). NOAA PSL, public domain.",
                                 "lattice": lattice, "values": vals}, separators=(",", ":")))
    return annual.astype(np.float32), lattice


def cpc_days(bounds, start, end):
    """Daily CPC fields over a box, start..end inclusive, as {date: 2-D array}
    plus the lattice (north-to-south rows, columns running east from the box's
    west edge). CPC's columns run 0..360, so a box across the PRIME meridian
    (Valencia, the Thames) is two column ranges read and joined -- the first
    version called that "crossing the antimeridian" and dropped Spain."""
    i0 = max(0, int(math.floor((89.75 - bounds["north"]) / 0.5)) - 1)
    i1 = min(359, int(math.ceil((89.75 - bounds["south"]) / 0.5)) + 1)
    col = lambda lon: (lon % 360 - 0.25) / 0.5          # noqa: E731
    j0 = int(math.floor(col(bounds["west"]))) - 1
    j1 = int(math.ceil(col(bounds["east"]))) + 1
    if j1 < j0:
        j1 += 720
    pieces = [(j0 % 720, min(j1, (j0 // 720 + 1) * 720 - 1) % 720)]
    if j1 >= (j0 // 720 + 1) * 720:
        pieces.append((0, j1 % 720))
    out = {}
    d = start
    while d <= end:
        y = d.year
        y_end = min(end, datetime.date(y, 12, 31))
        t0 = (d - datetime.date(y, 1, 1)).days
        t1 = (y_end - datetime.date(y, 1, 1)).days
        parts = []
        for a, b in pieces:
            q = urllib.parse.quote(f"precip[{t0}:1:{t1}][{i0}:1:{i1}][{a}:1:{b}]", safe=":")
            key = f"{y}_{t0}_{t1}_{i0}_{i1}_{a}_{b}"
            text = cached(WORK / "cpc" / f"{key}.txt", f"{CPC}/precip.{y}.nc.ascii?{q}").read_text()
            vals = []
            for line in text.split("precip.precip")[1].splitlines()[1:]:
                if line.startswith("["):
                    vals.extend(float(v) for v in line.split(",")[1:])
                elif vals and not line.strip():
                    break
            nt, ny, nx = t1 - t0 + 1, i1 - i0 + 1, b - a + 1
            parts.append(np.array(vals[:nt * ny * nx], np.float32).reshape(nt, ny, nx))
        arr = np.concatenate(parts, axis=2)
        arr[(arr < 0) | (arr > 2000)] = np.nan
        for k in range(arr.shape[0]):
            out[datetime.date(y, 1, 1) + datetime.timedelta(days=t0 + k)] = arr[k]
        d = y_end + datetime.timedelta(days=1)
    lon0 = 0.25 + 0.5 * (j0 % 720)
    lattice = {"nLat": i1 - i0 + 1, "nLon": sum(b - a + 1 for a, b in pieces), "lat0": 89.75 - 0.5 * i0,
               "lon0": lon0 - 360 if lon0 > 180 else lon0, "dLat": -0.5, "dLon": 0.5}
    return out, lattice


def event_rain(bounds, start, end):
    """The event's wettest 3 days (window start-2 .. min(end, start+61)) and the
    30 days before it, as lattice fields -- flood-ml.js wettest3's definition."""
    s = datetime.date.fromisoformat(start)
    e = min(datetime.date.fromisoformat(end), s + datetime.timedelta(days=61))
    days, lattice = cpc_days(bounds, s - datetime.timedelta(days=30), e)
    seq = np.stack([days[s + datetime.timedelta(days=i)] for i in range(-2, (e - s).days + 1)
                    if (s + datetime.timedelta(days=i)) in days])
    r3 = np.max(np.stack([np.nansum(seq[i:i + 3], axis=0) for i in range(max(1, len(seq) - 2))]), axis=0)
    ante = np.stack([days[s - datetime.timedelta(days=i)] for i in range(1, 31)])
    a30 = np.nansum(ante, axis=0)
    a30[np.all(~np.isfinite(ante), axis=0)] = np.nan
    r3[np.all(~np.isfinite(seq), axis=0)] = np.nan
    return r3.astype(np.float32), a30.astype(np.float32), lattice


def lattice_on_cells(field, lattice, lons, lats):
    """flood-ml.js latticeOnGrid at given points (the coarse tier's event rain,
    which only the bake ever computes)."""
    nLat, nLon = lattice["nLat"], lattice["nLon"]
    fy = np.clip((lats - lattice["lat0"]) / lattice["dLat"], 0, nLat - 1)
    fx = (lons - lattice["lon0"]) / lattice["dLon"]
    if lattice.get("wrap"):
        fx = np.mod(fx, nLon)
    fx = np.clip(fx, 0, nLon - 1)
    y0 = np.minimum(np.floor(fy).astype(int), max(0, nLat - 2))
    x0 = np.minimum(np.floor(fx).astype(int), max(0, nLon - 2))
    ty, tx = fy - y0, fx - x0
    s = np.zeros_like(lons, dtype=np.float64)
    w = np.zeros_like(lons, dtype=np.float64)
    for dy, dx, wt in ((0, 0, (1 - tx) * (1 - ty)), (0, 1, tx * (1 - ty)), (1, 0, (1 - tx) * ty), (1, 1, tx * ty)):
        yy = np.minimum(y0 + dy, nLat - 1)
        xx = np.minimum(x0 + dx, nLon - 1)
        v = field[yy, xx]
        ok = np.isfinite(v) & (wt > 0)
        s += np.where(ok, v * wt, 0)
        w += np.where(ok, wt, 0)
    with np.errstate(invalid="ignore"):
        return np.where(w > 0, s / w, np.nan).astype(np.float32)


# ── the node bridge ─────────────────────────────────────────────────────────

FEATURES = None


def run_stack(job_dir, grid, mosaic, plan, lc, k, soil, rain):
    """Write the inputs, run flood-ml.js through node, read the stack back."""
    global FEATURES
    job_dir = pathlib.Path(job_dir)
    job_dir.mkdir(parents=True, exist_ok=True)
    mosaic.astype("<f4").tofile(job_dir / "dem_mosaic.f32")
    lc.astype(np.uint8).tofile(job_dir / "lc.u8")
    job = {"grid": {k2: grid[k2] for k2 in ("west", "east", "south", "north", "cell")}, "plan": plan, "lcK": k,
           "rain": {}}
    if isinstance(soil, tuple):
        meta, band = soil
        band.tofile(job_dir / "soil_window.u8")
        job.update(soil="window", soilWindow=meta)
    else:
        soil.astype("<f4").tofile(job_dir / "soil.f32")
        job["soil"] = "grid"
    for key, (field, lattice) in rain.items():
        np.ascontiguousarray(field, "<f4").tofile(job_dir / f"rain_{key}.f32")
        job["rain"][key] = {"file": f"rain_{key}.f32", "lattice": lattice}
    (job_dir / "job.json").write_text(json.dumps(job))
    subprocess.run(["node", "--max-old-space-size=4096", str(HERE / "flood-ml-stack.mjs"), str(job_dir)], check=True)
    meta = json.loads((job_dir / "stack.json").read_text())
    FEATURES = meta["features"]
    n = meta["grid"]["width"] * meta["grid"]["height"]
    feats = np.fromfile(job_dir / "features.f32", "<f4").reshape(len(FEATURES), n)
    mask = np.fromfile(job_dir / "mask.u8", np.uint8).astype(bool)
    for name in ("dem_mosaic.f32", "lc.u8", "features.f32"):
        (job_dir / name).unlink(missing_ok=True)       # large and re-derivable
    return feats, mask, meta


# ── building one delineation ───────────────────────────────────────────────

def burn(features, grid, value=1, img=None):
    """Polygon cells (centre inside) on a grid; holes honoured."""
    from PIL import Image, ImageDraw
    if img is None:
        img = Image.new("L", (grid["width"], grid["height"]), 0)
    draw = ImageDraw.Draw(img)

    def pix(ring):
        return [((x - grid["west"]) / grid["cell"] - 0.5, (grid["north"] - y) / grid["cell"] - 0.5) for x, y, *_ in ring]

    for f in features or []:
        g = f.get("geometry") or {}
        polys = [g["coordinates"]] if g.get("type") == "Polygon" else g.get("coordinates", []) if g.get("type") == "MultiPolygon" else []
        for poly in polys:
            if len(poly[0]) >= 3:
                draw.polygon(pix(poly[0]), fill=value)
            for hole in poly[1:]:
                if len(hole) >= 3:
                    draw.polygon(pix(hole), fill=0)
    return img


def layer_bounds(features):
    xs, ys = [], []

    def walk(c):
        if isinstance(c, (list, tuple)) and c and isinstance(c[0], (int, float)):
            xs.append(c[0]); ys.append(c[1])
        elif isinstance(c, (list, tuple)):
            for q in c:
                walk(q)
    for f in features or []:
        walk((f.get("geometry") or {}).get("coordinates"))
    return {"west": min(xs), "east": max(xs), "south": min(ys), "north": max(ys)} if xs else None


def analysed(layers, grid):
    """Cells the mappers ANALYSED: inside the area of interest and the image
    footprint (when the product has one), outside 'not analysed' (cloud, no
    image) and outside mapped permanent water. Returns (analysed, flooded)."""
    aoi = np.asarray(burn(layers["areaOfInterestA"], grid), bool)
    if layers.get("imageFootprintA"):
        aoi &= np.asarray(burn(layers["imageFootprintA"], grid), bool)
    if layers.get("notAnalysedA"):
        aoi &= ~np.asarray(burn(layers["notAnalysedA"], grid), bool)
    if layers.get("hydrographyA"):
        aoi &= ~np.asarray(burn(layers["hydrographyA"], grid), bool)
    wet = np.asarray(burn(layers["observedEventA"], grid), bool) & aoi
    return aoi.ravel(), wet.ravel()


def clamp_window(b, wet_layers, size):
    """At most `size` degrees a side, centred on the observed flooding."""
    fb = layer_bounds(wet_layers) or b
    cx, cy = (fb["west"] + fb["east"]) / 2, (fb["south"] + fb["north"]) / 2
    w = min(size, b["east"] - b["west"]); h = min(size, b["north"] - b["south"])
    west = min(max(b["west"], cx - w / 2), b["east"] - w)
    south = min(max(b["south"], cy - h / 2), b["north"] - h)
    return {"west": west, "east": west + w, "south": south, "north": south + h}


def sample(pos, neg, rng):
    if pos.size > POS_CAP:
        pos = rng.choice(pos, POS_CAP, replace=False)
    want = min(neg.size, max(300, NEG_PER_POS * pos.size))
    neg = rng.choice(neg, want, replace=False) if neg.size else neg
    return pos, neg


def activation_rain(events):
    """One CPC read per activation, over the union of its products' areas: the
    products of an activation share a date, and CPC answers each request in
    ~30 s whatever its size, so this is the difference between minutes and
    hours. The window is the event day -2 .. +7, clamped to the last day CPC
    has published."""
    by = {}
    for e in events:
        b = layer_bounds(json.loads(pathlib.Path(e["path"]).read_text())["areaOfInterestA"])
        u = by.setdefault(e["code"], {"start": e["start"], **b})
        u.update(west=min(u["west"], b["west"]), east=max(u["east"], b["east"]),
                 south=min(u["south"], b["south"]), north=max(u["north"], b["north"]))
    latest = datetime.date.today() - datetime.timedelta(days=7)    # CPC's realtime file lags by days

    def one(item):
        code, u = item
        start = datetime.date.fromisoformat(u["start"])
        end = min(start + datetime.timedelta(days=7), latest)
        pad = {"west": u["west"] - 0.5, "east": u["east"] + 0.5, "south": u["south"] - 0.5, "north": u["north"] + 0.5}
        try:
            return code, event_rain(pad, start.isoformat(), end.isoformat())
        except Exception as error:
            say(f"   rain for {code} failed: {error}")
            return code, None

    with cf.ThreadPoolExecutor(4) as pool:
        return dict(pool.map(one, by.items()))


def build_event(e, normal, rng, soil, coarse, rain):
    """Rows for one delineation product, in both tiers, cached."""
    path = WORK / "rows" / f"{e['product']}.npz"
    if path.exists():
        return dict(np.load(path, allow_pickle=True))
    if rain is None:
        raise RuntimeError("no event rain")
    layers = json.loads(pathlib.Path(e["path"]).read_text())
    b = layer_bounds(layers["areaOfInterestA"])
    start = e["start"]
    r3, a30, lat = rain
    out = {}

    # fine: the AOI at 250 m, at most FINE_WINDOW a side around the flooding
    win = clamp_window(b, layers["observedEventA"], FINE_WINDOW)
    g = grid_of(win, FINE_CELL)
    seen, wet = analysed(layers, g)
    pos = np.flatnonzero(wet)
    neg = np.flatnonzero(seen & ~wet)
    if pos.size >= 30 and neg.size >= 30:
        mosaic, plan = dem_mosaic(g, FINE_ZOOM)
        lc = land_cover(g, FINE_K, f"fine_{e['product']}")
        feats, mask, meta = run_stack(WORK / "jobs" / f"fine_{e['product']}", g, mosaic, plan, lc, FINE_K,
                                      soil.native_for(g), {"normal": normal, "r3": (r3, lat), "r30": (a30, lat)})
        pos, neg = pos[mask[pos]], neg[mask[neg]]
        # Water the land-cover service calls water is not dry land the flood
        # missed: a negative there would teach the forest that rivers stay dry.
        water = feats[FEATURES.index("water_frac")]
        neg = neg[water[neg] < 0.5]
        pos, neg = sample(pos, neg, rng)
        cells = np.concatenate([pos, neg])
        X = feats[:, cells].T
        ok = np.all(np.isfinite(X), axis=1)
        out["fine_X"] = X[ok]
        out["fine_y"] = np.r_[np.ones(pos.size), np.zeros(neg.size)][ok].astype(np.int8)
        out["fine_fills"] = json.dumps(meta["fills"])

    # coarse: the AOI's 0.1-degree cells, by the share of each cell analysed and flooded
    gx = coarse["grid"]
    sub = grid_of(b, FINE_CELL)
    seen, wet = analysed(layers, sub)
    lons = sub["west"] + (np.arange(sub["width"]) + 0.5) * FINE_CELL
    lats = sub["north"] - (np.arange(sub["height"]) + 0.5) * FINE_CELL
    cc = np.floor((lons - gx["west"]) / COARSE_CELL).astype(int)
    rr = np.floor((gx["north"] - lats) / COARSE_CELL).astype(int)
    idx = (rr[:, None] * gx["width"] + cc[None, :]).ravel()
    n = gx["width"] * gx["height"]
    per_cell = round((COARSE_CELL / FINE_CELL) ** 2)
    s_cnt = np.bincount(idx[seen], minlength=n)
    w_cnt = np.bincount(idx[wet], minlength=n)
    with np.errstate(invalid="ignore", divide="ignore"):
        frac = np.where(s_cnt > 0, w_cnt / s_cnt, 0)
    # An EMS area of interest is a few 0.1-degree cells, so the coarse rules
    # are loose enough to keep partly analysed cells: flooded at >= 2% of a cell
    # at least a tenth analysed, dry below 0.2% with a quarter analysed.
    pos = np.flatnonzero((s_cnt >= 0.10 * per_cell) & (frac >= 0.02))
    neg = np.flatnonzero((s_cnt >= 0.25 * per_cell) & (frac < 0.002))
    pos, neg = pos[coarse["mask"][pos]], neg[coarse["mask"][neg]]
    if pos.size and neg.size:
        cells = np.concatenate([pos, neg])
        X = coarse["feats"][:, cells].T.copy()
        clon = gx["west"] + (cells % gx["width"] + 0.5) * COARSE_CELL
        clat = gx["north"] - (cells // gx["width"] + 0.5) * COARSE_CELL
        X[:, FEATURES.index("rain_3day_max_mm")] = lattice_on_cells(r3, lat, clon, clat)
        X[:, FEATURES.index("rain_30day_mm")] = lattice_on_cells(a30, lat, clon, clat)
        ok = np.all(np.isfinite(X), axis=1)
        out["coarse_X"] = X[ok]
        out["coarse_y"] = np.r_[np.ones(pos.size), np.zeros(neg.size)][ok].astype(np.int8)
    out["meta"] = json.dumps({"dfo": e["product"], "code": e["code"], "region": e["region"], "start": start,
                              "window": win, "rain_3day_max_mm": float(np.nanmax(r3)) if np.isfinite(r3).any() else None})
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(path, **out)
    return out


def coarse_static(normal, soil):
    """The global 0.1-degree stack, once (rain columns are placeholders, set per
    event or from today's rain)."""
    path = WORK / "coarse_stack.npz"
    g = grid_of(GLOBAL, COARSE_CELL)
    if path.exists():
        z = np.load(path, allow_pickle=True)
        global FEATURES
        FEATURES = list(z["features"])
        return {"grid": g, "feats": z["feats"], "mask": z["mask"], "fills": json.loads(str(z["fills"]))}
    say("   coarse: global DEM (zoom 5), land cover, soil")
    mosaic, plan = dem_mosaic(g, COARSE_ZOOM)
    lc = land_cover(g, COARSE_K, "coarse")
    soil_grid = soil.block_mean(g)
    zero = (np.zeros((2, 2), np.float32), {"nLat": 2, "nLon": 2, "lat0": 90, "lon0": -180, "dLat": -180, "dLon": 360})
    feats, mask, meta = run_stack(WORK / "jobs" / "coarse", g, mosaic, plan, lc, COARSE_K, soil_grid,
                                  {"normal": normal, "r3": zero, "r30": zero})
    np.savez_compressed(path, feats=feats, mask=mask, features=np.array(FEATURES), fills=json.dumps(meta["fills"]))
    return {"grid": g, "feats": feats, "mask": mask, "fills": meta["fills"]}


def build():
    chosen = json.loads((WORK / "chosen.json").read_text())
    normal = cpc_normal()
    soil = SoilTif()
    coarse = coarse_static(normal, soil)
    say(f"   coarse stack: {int(coarse['mask'].sum()):,} land cells")
    rng = np.random.default_rng(1)
    todo = [e for e in chosen if e["region"] and not (WORK / "rows" / f"{e['product']}.npz").exists()]
    say(f"   event rain for {len({e['code'] for e in todo})} activations (CPC, 4 at a time)")
    rain = activation_rain(todo)
    for i, e in enumerate(chosen):
        try:
            out = build_event(e, normal, rng, soil, coarse, rain.get(e["code"]))
            say(f"   {i + 1}/{len(chosen)} {e['product']} {e['region']}: fine {len(out.get('fine_y', []))} rows, "
                f"coarse {len(out.get('coarse_y', []))}")
        except Exception as error:
            say(f"   {i + 1}/{len(chosen)} {e['product']} skipped: {error}")


# ── training, validation, export ───────────────────────────────────────────

def load_rows(tier):
    X, y, region, event = [], [], [], []
    fills = {}
    for path in sorted((WORK / "rows").glob("*.npz")):
        z = np.load(path, allow_pickle=True)
        if f"{tier}_X" not in z.files:
            continue
        meta = json.loads(str(z["meta"]))
        X.append(z[f"{tier}_X"])
        y.append(z[f"{tier}_y"])
        region += [meta["region"]] * len(z[f"{tier}_y"])
        event += [meta["dfo"]] * len(z[f"{tier}_y"])
        if f"{tier}_fills" in z.files:
            for k, v in json.loads(str(z[f"{tier}_fills"])).items():
                fills[k] = fills.get(k, 0) + v
    return np.vstack(X), np.concatenate(y), np.array(region), np.array(event), fills


def fit(X, y):
    from sklearn.ensemble import RandomForestClassifier
    rf = RandomForestClassifier(**FOREST)
    rf.fit(X, y)
    return rf


def loro(tier):
    """Leave one region out."""
    X, y, region, event, fills = load_rows(tier)
    say(f"   {tier}: {len(y):,} rows, {int(y.sum()):,} flooded, {len(set(event))} events")
    per = {}
    pooled_scores, pooled_y = [], []
    totals = dict(tp=0, fp=0, tn=0, fn=0)
    for name, _ in REGIONS:
        te = region == name
        if te.sum() == 0 or y[te].sum() < 30 or (y[te] == 0).sum() < 30:
            per[name] = {"assessable": False, "events": int(len(set(event[te]))), "n": int(te.sum()),
                         "message": "fewer than 30 flooded or 30 dry cells held out"}
            continue
        rf = fit(X[~te], y[~te])
        oob = rf.oob_decision_function_[:, 1]
        thr = hazard_metrics.youden(list(zip(oob.tolist(), y[~te].tolist())))
        p = rf.predict_proba(X[te])[:, 1]
        rep = hazard_metrics.report(list(zip(p.tolist(), y[te].tolist())), thr, "Youden on the other regions' OOB votes")
        rep["events"] = int(len(set(event[te])))
        rep["skill"] = "weak" if rep["auc"] < 0.7 else "fair" if rep["auc"] < 0.8 else "good"
        per[name] = rep
        for k in totals:
            totals[k] += rep[k]
        pooled_scores += p.tolist()
        pooled_y += y[te].tolist()
        say(f"     {name:20s} AUC {rep['auc']} acc {rep['accuracy']} prec {rep['precision']} "
            f"rec {rep['recall']} F1 {rep['f1']} (n {rep['n']}, {rep['events']} events)")
    tp, fp, tn, fn = totals["tp"], totals["fp"], totals["tn"], totals["fn"]
    n = tp + fp + tn + fn
    prec = tp / (tp + fp) if tp + fp else None
    rec = tp / (tp + fn) if tp + fn else None
    pooled = {"n": n, **totals,
              "accuracy": round((tp + tn) / n, 4) if n else None,
              "precision": round(prec, 4) if prec is not None else None,
              "recall": round(rec, 4) if rec is not None else None,
              "f1": round(2 * prec * rec / (prec + rec), 4) if prec and rec else None,
              "auc": round(float(np.mean([r["auc"] for r in per.values() if r.get("auc") is not None])), 4),
              "auc_pooled": hazard_metrics.roc_auc(list(zip(pooled_scores, pooled_y))),
              "auc_rule": "mean of the held-out regions' AUCs (each region's scores come from its own forest, so "
                          "pooling them mixes calibrations; the pooled figure is auc_pooled)"}
    pooled["kappa"] = hazard_metrics.confusion([(1, 1)] * tp + [(1, 0)] * fp + [(0, 0)] * tn + [(0, 1)] * fn, 0.5)["kappa"] if n else None
    pooled["positives"], pooled["negatives"] = tp + fn, tn + fp
    return X, y, region, event, fills, per, pooled


def export_forest(rf, path, n_check=64, X=None, threshold=None):
    """The forest as flood-ml.js decodeForest reads it, plus a check set of rows
    and scikit-learn's own answers so the page's evaluator can be held to it."""
    import base64
    b = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
    trees = []
    for est in rf.estimators_:
        t = est.tree_
        val = t.value[:, 0, :]
        val = val / val.sum(axis=1, keepdims=True)
        trees.append({"feature": b(t.feature.astype("<i2")), "threshold": b(t.threshold.astype("<f8")),
                      "left": b(t.children_left.astype("<i4")), "right": b(t.children_right.astype("<i4")),
                      "value": b(val[:, list(rf.classes_).index(1)].astype("<f4"))})
    doc = {"features": FEATURES, "threshold": threshold, "classes": [int(c) for c in rf.classes_], "params": {k: v for k, v in FOREST.items()},
           "trees": trees}
    if X is not None:
        sel = np.random.default_rng(3).choice(len(X), min(n_check, len(X)), replace=False)
        doc["check"] = {"rows": X[sel].astype(np.float32).tolist(),
                        "proba": rf.predict_proba(X[sel].astype(np.float32))[:, 1].tolist()}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, separators=(",", ":")))
    return path.stat().st_size


def train():
    entries = {}
    for tier in ("coarse", "fine"):
        X, y, region, event, fills, per, pooled = loro(tier)
        rf = fit(X, y)
        thr = hazard_metrics.youden(list(zip(rf.oob_decision_function_[:, 1].tolist(), y.tolist())))
        with open(WORK / f"forest_{tier}.pkl", "wb") as f:
            pickle.dump({"rf": rf, "threshold": thr, "features": FEATURES}, f)
        size = export_forest(rf, OUT / f"forest-{tier}.json", X=X, threshold=thr)
        say(f"   {tier}: final forest {size / 1e6:.1f} MB, threshold {thr:.3f}")
        entries[tier] = (X, y, region, event, fills, per, pooled, rf, thr)
    (WORK / "train_summary.pkl").write_bytes(pickle.dumps({k: v[4:7] + (v[8],) for k, v in entries.items()}))
    return entries


# ── today's global map ─────────────────────────────────────────────────────

def cpc_latest(days_back=45):
    """The last `days_back` days of CPC's realtime file, global, as the latest
    complete day and a (t, lat, lon) array (-180..180)."""
    import netCDF4
    year = datetime.date.today().year
    ds = netCDF4.Dataset(f"{CPC}/precip.{year}.nc")
    t = ds["time"]
    dates = netCDF4.num2date(t[:], t.units)
    v = np.ma.filled(ds["precip"][-days_back:, :, :].astype(np.float32), np.nan)
    v[(v < 0) | (v > 2000)] = np.nan
    v = np.roll(v, 360, axis=2)
    last = dates[-1]
    return datetime.date(last.year, last.month, last.day), v


def current():
    with open(WORK / "forest_coarse.pkl", "rb") as f:
        saved = pickle.load(f)
    normal = cpc_normal()
    coarse = coarse_static(normal, SoilTif())
    last, v = cpc_latest()
    week = v[-7:]
    r3 = np.max(np.stack([np.nansum(week[i:i + 3], axis=0) for i in range(5)]), axis=0)
    a30 = np.nansum(v[-37:-7], axis=0)
    lattice = {"nLat": 360, "nLon": 720, "lat0": 89.75, "lon0": -179.75, "dLat": -0.5, "dLon": 0.5, "wrap": True}
    g = coarse["grid"]
    cells = np.flatnonzero(coarse["mask"])
    lons = g["west"] + (cells % g["width"] + 0.5) * COARSE_CELL
    lats = g["north"] - (cells // g["width"] + 0.5) * COARSE_CELL
    X = coarse["feats"][:, cells].T.copy()
    X[:, FEATURES.index("rain_3day_max_mm")] = lattice_on_cells(r3, lattice, lons, lats)
    X[:, FEATURES.index("rain_30day_mm")] = lattice_on_cells(a30, lattice, lons, lats)
    ok = np.all(np.isfinite(X), axis=1)
    p = np.full(len(cells), np.nan, np.float32)
    for i in range(0, len(cells), 200000):
        sl = slice(i, i + 200000)
        good = ok[sl]
        if good.any():
            p_sl = np.full(good.size, np.nan, np.float32)
            p_sl[good] = saved["rf"].predict_proba(X[sl][good])[:, 1]
            p[sl] = p_sl
    grid = np.full(g["width"] * g["height"], np.nan, np.float32)
    grid[cells] = p
    grid = grid.reshape(g["height"], g["width"])
    np.save(WORK / "current_coarse.npy", grid)
    tif = OUT / "flood-susceptibility-0p1.hotlink-ok.tif"
    write_uint8_tif(grid, g, tif)
    png = WORK / "current_coarse.png"
    write_png(grid, png, saved["threshold"])
    summary = {"as_of": last.isoformat(), "rain": "CPC realtime: wettest 3 days of the last 7, and the 30 before",
               "cells": int(ok.sum()), "share_over_threshold": round(float(np.nanmean(p[ok] >= saved["threshold"])), 4),
               "threshold": round(saved["threshold"], 4), "file": f"data/global/flood-ml/{tif.name}", "preview": str(png)}
    (OUT / "current.json").write_text(json.dumps(summary, indent=1))
    say("   ", summary)
    return summary


def write_uint8_tif(grid, g, path):
    """0-250 = P(flooded) x 250, 255 no data; deflate-compressed, with overviews
    so the page can read a corner without the whole file."""
    import tifffile
    q = np.where(np.isfinite(grid), np.clip(np.round(grid * 250), 0, 250), 255).astype(np.uint8)
    geo = {33550: ("d", 3, (COARSE_CELL, COARSE_CELL, 0.0)),
           33922: ("d", 6, (0.0, 0.0, 0.0, g["west"], g["north"], 0.0)),
           34735: ("H", 16, (1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4326)),
           42113: ("s", 4, "255")}
    extratags = [(code, dtype, count, value, True) for code, (dtype, count, value) in geo.items()]
    path.parent.mkdir(parents=True, exist_ok=True)
    with tifffile.TiffWriter(path) as tw:
        tw.write(q, tile=(256, 256), compression="zlib", extratags=extratags,
                 metadata=None, description="GeoHUB flood susceptibility, P(flooded) x 250; 255 = no data")
    return path


def write_png(grid, path, threshold, mark_threshold=True):
    from PIL import Image
    v = np.nan_to_num(grid, nan=-1)
    ramp = np.array([[247, 251, 255], [198, 219, 239], [107, 174, 214], [33, 113, 181], [8, 48, 107]], np.float32)
    if not mark_threshold:
        # a continuous ramp, pale (unlikely) to dark red (likely), for a box
        # where the threshold alone would paint everything one colour
        ramp = np.array([[255, 255, 204], [254, 217, 118], [253, 141, 60], [227, 26, 28], [128, 0, 38]], np.float32)
        threshold = 2.0
    t = np.clip(v, 0, 1) * 4
    i = np.minimum(t.astype(int), 3)
    f = (t - i)[..., None]
    rgb = ramp[i] * (1 - f) + ramp[i + 1] * f
    rgb[v >= threshold] = [214, 39, 40]
    rgb[v < 0] = [30, 30, 34]
    Image.fromarray(rgb.astype(np.uint8)).save(path)


# ── a 250 m run over any box, as the page runs it ──────────────────────────

def live_rain_lattice(grid):
    """flood-ml-run.js liveRain: Open-Meteo at CPC's 0.5-degree centres around
    the box, the 30 days before today and the wettest 3 of the next 7."""
    i0 = max(0, math.floor((89.75 - grid["north"]) / 0.5) - 1)
    i1 = min(359, math.ceil((89.75 - grid["south"]) / 0.5) + 1)
    j0 = max(0, math.floor((grid["west"] + 179.75) / 0.5) - 1)
    j1 = min(719, math.ceil((grid["east"] + 179.75) / 0.5) + 1)
    lats = [89.75 - 0.5 * i for i in range(i0, i1 + 1) for _ in range(j0, j1 + 1)]
    lons = [-179.75 + 0.5 * j for _ in range(i0, i1 + 1) for j in range(j0, j1 + 1)]
    url = ("https://api.open-meteo.com/v1/forecast?latitude=" + ",".join(map(str, lats))
           + "&longitude=" + ",".join(map(str, lons)) + "&daily=precipitation_sum&past_days=30&forecast_days=7&timezone=UTC")
    rows = json.loads(get(url))
    rows = rows if isinstance(rows, list) else [rows]
    today = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    r3, a30 = [], []
    for row in rows:
        t, p = row["daily"]["time"], [np.nan if v is None else v for v in row["daily"]["precipitation_sum"]]
        past = [v for d, v in zip(t, p) if d < today][-30:]
        ahead = [v for d, v in zip(t, p) if d >= today]
        a30.append(float(np.nansum(past)))
        r3.append(max(float(np.nansum(ahead[i:i + 3])) for i in range(max(1, len(ahead) - 2))))
    shape = (i1 - i0 + 1, j1 - j0 + 1)
    lattice = {"nLat": shape[0], "nLon": shape[1], "lat0": 89.75 - 0.5 * i0, "lon0": -179.75 + 0.5 * j0,
               "dLat": -0.5, "dLon": 0.5}
    return (np.array(r3, np.float32).reshape(shape), lattice), (np.array(a30, np.float32).reshape(shape), lattice), \
        f"{rows[0]['daily']['time'][0]}..{rows[0]['daily']['time'][-1]}"


def area(west, south, east, north, label):
    with open(WORK / "forest_fine.pkl", "rb") as f:
        saved = pickle.load(f)
    normal = cpc_normal()
    g = grid_of({"west": west, "east": east, "south": south, "north": north}, FINE_CELL)
    mosaic, plan = dem_mosaic(g, FINE_ZOOM)
    lc = land_cover(g, FINE_K, f"area_{label}")
    r3, a30, window = live_rain_lattice(g)
    feats, mask, meta = run_stack(WORK / "jobs" / f"area_{label}", g, mosaic, plan, lc, FINE_K,
                                  SoilTif().native_for(g), {"normal": normal, "r3": r3, "r30": a30})
    cells = np.flatnonzero(mask)
    p = np.full(mask.size, np.nan, np.float32)
    p[cells] = saved["rf"].predict_proba(feats[:, cells].T)[:, 1]
    grid = p.reshape(meta["grid"]["height"], meta["grid"]["width"])
    png = WORK / f"area_{label}.png"
    write_png(grid, png, saved["threshold"], mark_threshold=False)
    share = float(np.nanmean(grid[np.isfinite(grid)] >= saved["threshold"]))
    say(f"   {label}: {len(cells):,} land cells, rain {window}, {share * 100:.1f}% over threshold -> {png}")
    return png


# ── the published entries ──────────────────────────────────────────────────

def entries(trained, now):
    common_inputs = [
        {"name": "Historical floods", "source": "Copernicus Emergency Management Service rapid mapping, delineation "
                                                 "and first-estimate products (observed flood extent, area of interest, "
                                                 "not-analysed areas)",
         "licence": "Copernicus data: free, full and open, any use with attribution "
                    "(© European Union, Copernicus Emergency Management Service)",
         "detail": "open API, activations EMSR656 (2023) onward"},
        {"name": "Elevation", "source": "Terrarium DEM (AWS Open Data; SRTM, GMTED, ETOPO1)",
         "licence": "public domain / attribution by source",
         "detail": "slope, HAND, upstream area, channel distance, TWI, curvature (flood-ml.js)"},
        {"name": "Satellite land cover", "source": "Esri / Impact Observatory / Microsoft Sentinel-2 10 m land cover, 2020",
         "licence": "CC BY 4.0",
         "detail": "class fractions per cell; chosen over ESA WorldCover because the page can read it (CORS)"},
        {"name": "Soil", "source": "Pelletier et al. 2016, soil and sediment thickness, 1 km (ORNL DAAC, doi:10.3334/ORNLDAAC/1304)",
         "licence": "NASA ORNL DAAC: free to use with citation"},
        {"name": "Rainfall, climate and events", "source": "NOAA CPC Global Unified Gauge-Based daily precipitation, 0.5°",
         "licence": "public domain (US Government)"},
    ]
    limits = [
        "The open EMS API covers activations from 2023 on: 90 floods, three quarters in Europe. The Americas, Africa "
        "and Asia are each scored on a handful of activations, and their numbers carry that uncertainty.",
        "Negatives are cells the analysts looked at and did not map as flooded. EMS areas of interest are drawn around "
        "the affected ground, so the dry cells sit beside the flood: harder to separate than random dry land, which "
        "makes AUC conservative -- and a mapper's omission (a flooded street under trees) is counted as dry.",
        "Flood traces and flooded areas are both taken as flooded; modelled extents are not used.",
        "Each activation is one region's rows; activations share rivers and mapping teams, which is why the hold-out is "
        "by REGION rather than by cell -- a random cell split would score near 0.99 and mean nothing.",
        "Probabilities are relative (two dry cells per flooded one in training); the threshold turns them into a map.",
        "Land cover is 2020 for every event.",
        "The 0.1° map leans European: most training floods are, so European lowlands read redder than ground of the "
        "same shape elsewhere -- the Africa held-out AUC (0.58 at 0.1°) is the measure of how far that carries.",
        "D8 on a 0.1° DEM draws parallel flow lines across very flat basins (the Congo, the Amazon floodplain): the "
        "streaks there are routing artefacts, not rivers.",
        "Terrain at a window's edge sees no upstream area beyond it, so a big river entering a 1° window reads smaller "
        "than it is -- the same on the page, which uses the same window logic.",
    ]
    out = []
    for tier, name, product, grid in (
            ("coarse", "Flood susceptibility — global (random forest, 0.1°)",
             f"data/global/flood-ml/flood-susceptibility-0p1.hotlink-ok.tif (as of {now['as_of']})",
             "0.1° global lattice, 60°S-84°N; Terrarium zoom 5"),
            ("fine", "Flood susceptibility — on demand (random forest, ~250 m)",
             "computed in the page over the view or a drawn area narrower than 1.5° (flood-ml-run.js)",
             "0.0025° (~250 m) lattice over the view; Terrarium zoom 10")):
        X, y, region, event, fills, per, pooled, rf, thr = trained[tier]
        imp = sorted(zip(FEATURES, rf.feature_importances_.round(4).tolist()), key=lambda kv: -kv[1])
        val = dict(pooled)
        val.update({
            "threshold": None,
            "threshold_rule": "per region: Youden's J on the out-of-bag votes of the forest trained on the OTHER regions",
            "holdout": f"leave one region out: {len([r for r in per.values() if r.get('assessable', True)])} of "
                       f"{len(REGIONS)} regions each scored by a forest that never saw it ({len(set(event))} EMS delineation "
                       f"products from {len({str(e).split('_')[0] for e in event})} activations)",
            "events": "Copernicus EMS: cells inside the observed flood extent = 1; cells analysed (area of interest ∩ image footprint, minus not-analysed and mapped water) and not flooded = 0",
            "regions": per, "region_unit": "products",
        })
        out.append({
            "id": "flood-susceptibility" if tier == "coarse" else "flood-susceptibility-fine",
            "name": name, "hazard": "flood", "product": product,
            "model": {
                "method": "Random forest on (cell, event) rows: terrain, land cover, soil and climate at the cell plus "
                          "that event's rainfall; trained on Copernicus EMS flood delineations in six regions.",
                "parameters": {**{k: v for k, v in FOREST.items() if k != "oob_score"},
                               "negatives_per_positive": NEG_PER_POS, "positives_per_event_cap": POS_CAP,
                               "positive_rule": "cell centre inside the observed flood" if tier == "fine" else "≥2% of the analysed cell flooded",
                               "channel_rule": "≥50 cells drain through it",
                               "decision_threshold_published": round(thr, 4),
                               "features": FEATURES, "feature_importance_gini": imp,
                               "training_rows": int(len(y)), "training_products": int(len(set(event)))},
                "inputs": common_inputs + ([{"name": "Rainfall, now", "source": "Open-Meteo forecast (the page)",
                                             "licence": "CC BY 4.0 (Open-Meteo.com)"}]
                                           if tier == "fine" else
                                           [{"name": "Rainfall, now", "source": f"CPC realtime, as of {now['as_of']}",
                                             "licence": "public domain (US Government)"}]),
                "grid": grid,
                "gap_fills": {k: {"method": "nearest valid cell (flood-ml.js fillNearest)", "cells": int(v)}
                              for k, v in (fills or {}).items()},
            },
            "validation": val,
            "current": now if tier == "coarse" else None,
            "limits": limits,
            "script": "GeoID_GIS/services/bake-flood-global.py",
        })
    return out


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "help"
    if cmd == "select":
        select()
    elif cmd == "static":
        c = coarse_static(cpc_normal(), SoilTif())
        say(f"   coarse stack: {int(c['mask'].sum()):,} land cells; fills {c['fills']}")
    elif cmd == "build":
        build()
    elif cmd == "train":
        global FEATURES
        z = np.load(WORK / "coarse_stack.npz", allow_pickle=True)
        FEATURES = list(z["features"])
        trained = train()
        now = current()
        coarse_fills = json.loads(str(z["fills"]))
        trained["coarse"] = trained["coarse"][:4] + (coarse_fills,) + trained["coarse"][5:]
        for e in entries(trained, now):
            say("   wrote", hazard_metrics.write_entry(e))
    elif cmd == "area":
        west, south, east, north = map(float, sys.argv[2:6])
        z = np.load(WORK / "coarse_stack.npz", allow_pickle=True)
        FEATURES = list(z["features"])
        area(west, south, east, north, sys.argv[6] if len(sys.argv) > 6 else "area")
    elif cmd == "current":
        z = np.load(WORK / "coarse_stack.npz", allow_pickle=True)
        FEATURES = list(z["features"])
        now = current()
        path = REPO / "data/global/hazard-validation/flood-susceptibility.json"
        e = json.loads(path.read_text())
        e["current"] = now
        e["product"] = f"data/global/flood-ml/flood-susceptibility-0p1.hotlink-ok.tif (as of {now['as_of']})"
        e.pop("generated", None)
        hazard_metrics.write_entry(e)
    else:
        print(__doc__)
    return 0


if __name__ == "__main__":
    sys.exit(main())
