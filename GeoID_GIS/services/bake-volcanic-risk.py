#!/usr/bin/env python3
"""Volcanic risk, as rasters: how often an eruption of each VEI happens near a point.

Two Cloud-Optimised GeoTIFFs on a 0.25 degree lattice (1440 x 720), one band
per VEI number 0..7 holding ERUPTIONS OF THAT SIZE PER YEAR near the point,
plus `any` (all sizes), `vei_max` (the largest on record reaching the point),
`vents` (distinct volcanoes reaching it) and `prior_only` (1 where nothing but a
floor prior reaches it). Read whole by the page and coloured by whichever band
a reader asks for, on one return-period scale -- no derived index, no proxy.

ONE SCALE FOR EVERY ERUPTION. An eruption counts exp(-d / R) of itself at
distance d, with R = 100 km for every eruption whatever its size, dropped past
4R. Scaling R by VEI drew overlapping discs of five sizes each with its own
edge, and the map read as a pile of radii rather than as a field. Size lives
in WHICH BAND an eruption falls in, not in how far it reaches; a reader who
wants "large eruptions" reads the VEI 5, 6 and 7 bands.

THE WINDOW DEPENDS ON THE SIZE, because the record does (--mode windowed, the
default). Measured on the catalogue, confirmed eruptions per fifty years: VEI
<= 3 flatten only after 1950; VEI 4 runs 8, 10, 11, 9, 11, 19, 14, 21, 26, 27
per half-century from 1500 (flat from ~1850); VEI 5 runs 3, 5, 5, 3, 1, 4, 3,
3, 5 from 1550 -- flat for four and a half centuries; VEI 6 about one per
fifty years since 1550. So:

    VEI <= 3 and unknown VEI    counted over 1950-2025   (76 complete years)
    VEI 4                       counted over 1900-2025   (126)
    VEI 5 and 6                 counted over 1550-2025   (476)
    VEI >= 7                    counted over the Holocene (11,700 years)

--mode holocene takes THE FULL RECORD instead: every dated eruption back to
9700 BCE with no windows, each volcano's rate over its OWN record span (first
recorded eruption to 2025). That overstates a volcano with a short written
record against one known from tephra alone; the windowed map corrects for
it. Both ship, and each file says which it is.

EVERY VOLCANO IS IN. The eruption list names 915 of the catalogue's 2,666; the
rest take a stated FLOOR PRIOR -- a Holocene volcano with no dated eruption,
one VEI 2 over the Holocene; a Pleistocene one, one VEI 3 over the Pleistocene
(2.58 My) -- and `prior_only` marks where nothing else reaches. Uncertain
eruptions (1,173 of 11,089) count at half weight. A quarter carry no VEI and
are counted as VEI 2.

Written through GDAL's CLI (the Python bindings segfault here). The scratch
lives in data/global/.volcanic-risk-work, which .gitignore holds out.
"""
from __future__ import annotations

import argparse
import json
import math
import pathlib
import subprocess
import sys
import time
import urllib.parse
import urllib.request

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
GLOBAL = ROOT / "data" / "global"
VOLCANOES = GLOBAL / "volcanoes.geojson"
WORK = GLOBAL / ".volcanic-risk-work"
# `.hotlink-ok.` is Cloudflare's exemption from Hotlink Protection, which 403s
# an image by Referer from any origin but the zone -- measured on the soil
# thickness COG: 200 from production, 403 from localhost.
OUT = {"windowed": GLOBAL / "volcanic-risk.hotlink-ok.tif",
       "holocene": GLOBAL / "volcanic-risk-holocene.hotlink-ok.tif"}

WFS = "https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows"
ERUPTIONS = "GVP-VOTW:Smithsonian_VOTW_Holocene_Eruptions"

EARTH_R_KM = 6371.0088
STEP = 0.25
NX = int(round(360 / STEP))
NY = int(round(180 / STEP))
ROW_LAT = 90.0 - (np.arange(NY) + 0.5) * STEP

SCALE_KM = 100.0
KERNEL_REACH = 4.0
UNKNOWN_VEI_AS = 2
UNCERTAIN_WEIGHT = 0.5
LAST_COMPLETE = 2025
HOLOCENE_START = -9700
WINDOWS = {"small": (1950, LAST_COMPLETE), "vei4": (1900, LAST_COMPLETE),
           "vei56": (1550, LAST_COMPLETE), "vei7": (HOLOCENE_START, LAST_COMPLETE)}
PRIOR = {"holocene": {"vei": 2, "span": LAST_COMPLETE - HOLOCENE_START + 1},
         "pleistocene": {"vei": 3, "span": 2_580_000}}
VEIS = list(range(8))
BANDS = [f"vei{v}" for v in VEIS] + ["any", "vei_max", "vents", "prior_only"]


def size_class(vei):
    if vei is None or vei <= 3:
        return "small"
    if vei == 4:
        return "vei4"
    if vei <= 6:
        return "vei56"
    return "vei7"


def fetch_eruptions():
    url = (f"{WFS}?service=WFS&version=2.0.0&request=GetFeature"
           f"&typeName={urllib.parse.quote(ERUPTIONS)}&outputFormat=json&count=50000")
    with urllib.request.urlopen(url, timeout=180) as r:
        return json.load(r)["features"]


_DISC = None


def disc():
    """Per grid row, the cells within KERNEL_REACH * SCALE_KM of a point on that row."""
    global _DISC
    if _DISC is not None:
        return _DISC
    radius = SCALE_KM * KERNEL_REACH
    span = int(math.ceil(radius / 111.32 / STEP)) + 1
    hav_r = math.sin(0.5 * radius / EARTH_R_KM) ** 2
    rows_out, cols_out = [], []
    for r in range(NY):
        lat = ROW_LAT[r]
        rows, cols = [], []
        for drow in range(-span, span + 1):
            r2 = r + drow
            if r2 < 0 or r2 >= NY:
                continue
            lat2 = ROW_LAT[r2]
            room = hav_r - math.sin(math.radians(lat2 - lat) / 2) ** 2
            if room < 0:
                continue
            denom = math.cos(math.radians(lat)) * math.cos(math.radians(lat2))
            half = NX // 2 if denom <= 0 else min(
                NX // 2, int(math.floor(math.degrees(2 * math.asin(math.sqrt(min(1.0, room / denom)))) / STEP)))
            offs = np.arange(-half, half + 1)
            cols.append(offs)
            rows.append(np.full(offs.size, r2, dtype=np.int64))
        rows_out.append(np.concatenate(rows))
        cols_out.append(np.concatenate(cols))
    _DISC = (rows_out, cols_out)
    return _DISC


def kernel(lon, lat):
    """Cell indices within reach of (lat, lon), and exp(-d/R) at each."""
    if not (np.isfinite(lon) and np.isfinite(lat) and abs(lat) <= 90):
        return None, None
    rows, cols = disc()
    r = int(min(NY - 1, max(0, (90.0 - lat) / STEP)))
    c = int(((lon + 180.0) / STEP) % NX)
    rr = rows[r]
    cc = np.mod(c + cols[r], NX)
    lat2 = np.radians(ROW_LAT[rr])
    lon2 = np.radians(-180.0 + (cc + 0.5) * STEP)
    la, lo = np.radians(lat), np.radians(lon)
    a = np.sin((lat2 - la) / 2) ** 2 + np.cos(la) * np.cos(lat2) * np.sin((lon2 - lo) / 2) ** 2
    d = 2 * EARTH_R_KM * np.arcsin(np.sqrt(np.clip(a, 0, 1)))
    return rr * NX + cc, np.exp(-d / SCALE_KM)


def write_cog(path, grids, mode):
    WORK.mkdir(parents=True, exist_ok=True)
    raw = WORK / (path.stem + ".bin")
    with open(raw, "wb") as fh:
        for name in BANDS:
            fh.write(np.ascontiguousarray(grids[name], dtype=np.float32).tobytes())
    bands = "".join(
        '<VRTRasterBand dataType="Float32" band="{}" subClass="VRTRawRasterBand">'
        '<SourceFilename relativeToVRT="1">{}</SourceFilename>'
        '<ImageOffset>{}</ImageOffset><PixelOffset>4</PixelOffset><LineOffset>{}</LineOffset>'
        '<Description>{}</Description></VRTRasterBand>'.format(
            i + 1, raw.name, i * NY * NX * 4, NX * 4, name)
        for i, name in enumerate(BANDS))
    vrt = WORK / (path.stem + ".vrt")
    vrt.write_text(
        '<VRTDataset rasterXSize="{}" rasterYSize="{}"><SRS>EPSG:4326</SRS>'
        '<GeoTransform>-180.0, {}, 0.0, 90.0, 0.0, -{}</GeoTransform>{}</VRTDataset>'.format(
            NX, NY, STEP, STEP, bands))
    subprocess.run(
        ["gdal_translate", str(vrt), str(path), "-of", "COG",
         "-co", "COMPRESS=DEFLATE", "-co", "PREDICTOR=3", "-co", "BLOCKSIZE=512",
         "-mo", f"MODE={mode}", "-mo", "BANDS=" + ",".join(BANDS),
         "-mo", f"KERNEL=exp(-d/{SCALE_KM:.0f}km) to {KERNEL_REACH:.0f}R, one scale for every eruption",
         "-mo", "UNITS=eruptions of that VEI per year, weighted by the kernel",
         "-mo", "WINDOWS=" + (json.dumps({k: list(v) for k, v in WINDOWS.items()}) if mode == "windowed"
                              else "each volcano's own record span, first eruption to 2025"),
         "-mo", f"UNCERTAIN_WEIGHT={UNCERTAIN_WEIGHT}", "-mo", f"UNKNOWN_VEI_AS={UNKNOWN_VEI_AS}",
         "-mo", "FLOOR_PRIOR=" + json.dumps(PRIOR),
         "-mo", "SOURCE=Global Volcanism Program, Smithsonian Institution, Volcanoes of the World v5.2 (2024), CC BY 4.0"],
        check=True, capture_output=True, text=True)
    raw.unlink()


def main(mode) -> int:
    began = time.time()
    holocene = mode == "holocene"
    print("  fetching the eruption catalogue...")
    feats = fetch_eruptions()
    catalogue = json.load(open(VOLCANOES))["features"] if VOLCANOES.exists() else []
    print("  {:,} eruptions, {:,} catalogue volcanoes ({:.0f}s)".format(
        len(feats), len(catalogue), time.time() - began))

    first_year = {}
    for f in feats:
        p = f["properties"]
        if p.get("StartDateYear") is None:
            continue
        vn = str(p.get("Volcano_Number"))
        first_year[vn] = min(first_year.get(vn, 9999), int(p["StartDateYear"]))

    cells = NY * NX
    per_vei = np.zeros((8, cells), dtype=np.float64)
    vei_max = np.zeros(cells, dtype=np.int8)
    vents = {}          # cell -> set of volcano numbers
    prior_cells = np.zeros(cells, dtype=bool)
    record_cells = np.zeros(cells, dtype=bool)
    counted = {"small": 0, "vei4": 0, "vei56": 0, "vei7": 0, "prior": 0}
    uncertain = undated = out_of_window = unknown_vei = 0

    def count(lon, lat, vei_used, vn, weight, cls, is_prior=False):
        hit, k = kernel(lon, lat)
        if hit is None:
            return False
        w = k * weight
        per_vei[min(vei_used, 7), hit] += w
        vei_max[hit] = np.maximum(vei_max[hit], vei_used)
        (prior_cells if is_prior else record_cells)[hit] = True
        counted[cls] += 1
        for idx in hit.tolist():
            s = vents.get(idx)
            if s is None:
                vents[idx] = {vn}
            else:
                s.add(vn)
        return True

    seen = set()
    for f in feats:
        p = f["properties"]
        confirmed = p.get("Activity_Type") == "Confirmed Eruption"
        uncertain += 0 if confirmed else 1
        year = p.get("StartDateYear")
        if year is None:
            undated += 1
            continue
        vei = p.get("ExplosivityIndexMax")
        unknown_vei += vei is None
        vei_used = UNKNOWN_VEI_AS if vei is None else int(vei)
        cls = size_class(vei)
        vn = str(p.get("Volcano_Number"))
        if holocene:
            lo, hi = max(HOLOCENE_START, first_year[vn]), LAST_COMPLETE
        else:
            lo, hi = WINDOWS[cls]
        if year < lo or year > hi:
            out_of_window += 1
            continue
        coords = (f.get("geometry") or {}).get("coordinates") or [None, None]
        weight = (1.0 if confirmed else UNCERTAIN_WEIGHT) / (hi - lo + 1)
        if count(coords[0], coords[1], vei_used, vn, weight, cls):
            seen.add(vn)

    priors = {"holocene": 0, "pleistocene": 0}
    for f in catalogue:
        p = f["properties"]
        vn = str(p.get("gvp_number"))
        if vn in seen:
            continue
        coords = (f.get("geometry") or {}).get("coordinates") or [None, None]
        kind = "holocene" if str(p.get("epoch", "")).lower().startswith("holocene") else "pleistocene"
        if count(coords[0], coords[1], PRIOR[kind]["vei"], vn, 1.0 / PRIOR[kind]["span"], "prior", True):
            priors[kind] += 1

    print("  counted {}; {:,} uncertain at half weight, {:,} undated, {:,} outside their window, "
          "{:,} with no VEI as VEI {}; floor priors {:,} Holocene + {:,} Pleistocene".format(
              ", ".join(f"{k} {v:,}" for k, v in counted.items()), uncertain, undated,
              out_of_window, unknown_vei, UNKNOWN_VEI_AS, priors["holocene"], priors["pleistocene"]))

    vent_count = np.zeros(cells, dtype=np.float32)
    for idx, s in vents.items():
        vent_count[idx] = len(s)
    grids = {f"vei{v}": per_vei[v].reshape(NY, NX) for v in VEIS}
    grids["any"] = per_vei.sum(axis=0).reshape(NY, NX)
    grids["vei_max"] = vei_max.astype(np.float32).reshape(NY, NX)
    grids["vents"] = vent_count.reshape(NY, NX)
    grids["prior_only"] = (prior_cells & ~record_cells).astype(np.float32).reshape(NY, NX)
    out = OUT[mode]
    write_cog(out, grids, mode)
    reached = int((grids["any"] > 0).sum())
    print("  wrote {} bands, {:.1f} MB -> {}; {:,} of {:,} cells reached ({:.0f}%), "
          "{:,} by a floor prior alone".format(
              len(BANDS), out.stat().st_size / 1e6, out.relative_to(ROOT), reached, cells,
              100 * reached / cells, int(grids["prior_only"].sum())))

    def at(lat, lon):
        r = int((90.0 - lat) / STEP)
        c = int(((lon + 180.0) / STEP) % NX)
        a = grids["any"][r, c]
        bands = " ".join(f"v{v}:{grids[f'vei{v}'][r, c]:.2g}" for v in VEIS if grids[f"vei{v}"][r, c] > 0)
        return "any {:.4f}/yr (1 in {:,} y) | {} | max {} | {:.0f} vents".format(
            a, int(round(1 / a)) if a > 0 else 0, bands, int(grids["vei_max"][r, c]), grids["vents"][r, c])
    for name, lat, lon in [("Naples", 40.85, 14.27), ("Catania", 37.5, 15.09), ("Tokyo", 35.68, 139.69),
                           ("Yogyakarta", -7.8, 110.37), ("Reykjavik", 64.13, -21.9), ("Manila", 14.6, 120.98),
                           ("Seattle", 47.6, -122.33), ("Paris", 48.86, 2.35), ("Sydney", -33.87, 151.21)]:
        print("    {:<11} {}".format(name, at(lat, lon)))
    print("  done in {:.0f}s".format(time.time() - began))
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="volcanic risk rasters, one band per VEI")
    ap.add_argument("--mode", choices=("windowed", "holocene"), default="windowed")
    sys.exit(main(ap.parse_args().mode))
