#!/usr/bin/env python3
"""Seismic hazard, gridded, one map per magnitude: how often an earthquake of
each size shakes a point -- the volcanic risk bake's method with magnitude in
place of VEI.

THE RECORD is the USGS ComCat catalogue (which folds in ISC-GEM and the PDE):
every event of M >= 5 since 1900, fetched through the FDSN event service in
yearly pages. Written whole to data/global/earthquakes.geojson for the
timeline (one point per event, with magnitude, depth and year), and stamped
into four quadtree grids -- M5 (5.0-5.9), M6, M7, M8 (8.0+) -- plus the
collective, each "earthquakes of that size per year shaking the point at
MMI >= VI or so".

THE REACH IS THE MAGNITUDE. Ground motion attenuates roughly as log10(R) =
0.5 M - 1.7 for the radius of damaging shaking (MMI VI) in the global
average; solved that is ~20 km at M5, 63 at M6, 200 at M7, 630 at M8.
Attenuation varies by a factor of two or three between regions (stable
continental crust carries motion further than a subduction margin), so the
reach is log-normal about R with sigma = 0.4 and an event counts at a point
as P(reach >= d) = 1 - Phi(ln(d/R)/sigma). Isotropic and depth-blind, and
the card says so: a proper hazard map (GEM's, PSHA) uses site-specific
ground-motion models and fault sources; this is the catalogue's own answer.

THE WINDOW DEPENDS ON THE SIZE, measured on the catalogue: M >= 5 is complete
globally from 1964 (the WWSSN); M >= 6 from about 1930; M >= 7 from 1900.
So M5 counts since 1964, M6 since 1930, M7 and M8 since 1900.

Every cell of the globe is drawn: a cell no event reaches is the "none on
record" class, listed in the key and invisible on the map.
"""
from __future__ import annotations

import json
import math
import pathlib
import sys
import time
import urllib.request

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
GLOBAL = ROOT / "data" / "global"
OUT_EVENTS = GLOBAL / "earthquakes.geojson"
STEM = "seismic-risk"
FDSN = "https://earthquake.usgs.gov/fdsnws/event/1/query"

EARTH_R_KM = 6371.0088
STEP = 0.25
NX = int(round(360 / STEP))
NY = int(round(180 / STEP))
ROW_LAT = 90.0 - (np.arange(NY) + 0.5) * STEP
COARSEST = 32
FINEST = 1
SPREAD = 0.04

FIRST_YEAR = 1900
LAST_COMPLETE = 2025
BANDS = {"m5": (5.0, 6.0), "m6": (6.0, 7.0), "m7": (7.0, 8.0), "m8": (8.0, 11.0)}
WINDOWS = {"m5": (1964, LAST_COMPLETE), "m6": (1930, LAST_COMPLETE),
           "m7": (1900, LAST_COMPLETE), "m8": (1900, LAST_COMPLETE)}
SIGMA = 0.4
STAMP_SIGMAS = 2.5          # P(reach >= d) is 0.6% at the stamp's edge
COUNTS_FROM_P = 0.01


def reach_km(mag):
    """Radius of damaging shaking (about MMI VI), km, from a global-average attenuation."""
    return 10 ** (0.5 * mag - 1.7)


def band_of(mag):
    for name, (lo, hi) in BANDS.items():
        if lo <= mag < hi:
            return name
    return None


def fetch_events():
    """Every M >= 5 event since 1900, a year at a time (the service caps a page at 20,000)."""
    feats = []
    for year in range(FIRST_YEAR, LAST_COMPLETE + 2):
        url = (f"{FDSN}?format=geojson&starttime={year}-01-01&endtime={year + 1}-01-01"
               f"&minmagnitude=5&orderby=time-asc&limit=20000")
        for attempt in range(3):
            try:
                with urllib.request.urlopen(url, timeout=120) as r:
                    payload = json.load(r)
                break
            except Exception as error:  # noqa: BLE001
                if attempt == 2:
                    raise
                time.sleep(3)
        got = payload.get("features", [])
        if len(got) >= 20000:
            raise RuntimeError(f"{year}: a page hit the cap; split the year")
        feats.extend(got)
    return feats


_DISCS = {}


def disc(radius_km):
    if radius_km in _DISCS:
        return _DISCS[radius_km]
    span = int(math.ceil(radius_km / 111.32 / STEP)) + 1
    hav_r = math.sin(0.5 * radius_km / EARTH_R_KM) ** 2
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
    _DISCS[radius_km] = (rows_out, cols_out)
    return _DISCS[radius_km]


_ERF = np.vectorize(math.erf)


def kernel(lon, lat, mag):
    if not (np.isfinite(lon) and np.isfinite(lat) and abs(lat) <= 90):
        return None, None
    reach = reach_km(mag)
    # radii are quantised to the band's middle so the disc cache stays small
    rows, cols = disc(round(reach * math.exp(STAMP_SIGMAS * SIGMA) / 10.0) * 10.0 + 10.0)
    r = int(min(NY - 1, max(0, (90.0 - lat) / STEP)))
    c = int(((lon + 180.0) / STEP) % NX)
    rr = rows[r]
    cc = np.mod(c + cols[r], NX)
    lat2 = np.radians(ROW_LAT[rr])
    lon2 = np.radians(-180.0 + (cc + 0.5) * STEP)
    la, lo = np.radians(lat), np.radians(lon)
    a = np.sin((lat2 - la) / 2) ** 2 + np.cos(la) * np.cos(lat2) * np.sin((lon2 - lo) / 2) ** 2
    d = np.maximum(2 * EARTH_R_KM * np.arcsin(np.sqrt(np.clip(a, 0, 1))), 0.01)
    z = np.log(d / reach) / SIGMA
    return rr * NX + cc, 0.5 * (1.0 - _ERF(z / math.sqrt(2.0)))


def quadtree(field, mag_max, extra):
    limit = SPREAD * float(field.max()) if field.max() > 0 else 0.0
    blocks = []

    def flat(r0, c0, rows, cols):
        block = field[r0:r0 + rows, c0:c0 + cols]
        lo, hi = block.min(), block.max()
        if hi == 0:
            return True
        if lo == 0:
            return False
        # No gate on the largest magnitude: it is a fact for the card, taken as
        # the block's max, and gating on it split every block along every
        # magnitude-unit boundary -- 108,000 cells and 30 MB for the collective.
        return (hi - lo) <= limit

    def emit(r0, c0, size):
        if r0 >= NY:
            return
        rows = min(size, NY - r0)
        if size > FINEST and not flat(r0, c0, rows, size):
            half = size // 2
            for dr in (0, half):
                for dc in (0, half):
                    emit(r0 + dr, c0 + dc, half)
            return
        blocks.append((r0, c0, rows, size))

    for r0 in range(0, NY, COARSEST):
        for c0 in range(0, NX, COARSEST):
            emit(r0, c0, COARSEST)

    sig = lambda x: float("{:.4g}".format(x)) if x > 0 else 0.0
    features = []
    for r0, c0, rows, size in blocks:
        sl = (slice(r0, r0 + rows), slice(c0, c0 + size))
        mean = float(field[sl].mean())
        north = 90.0 - r0 * STEP
        south = north - rows * STEP
        west = -180.0 + c0 * STEP
        east = west + size * STEP
        props = {"i": len(features), "deg": round(size * STEP, 4),
                 "rate_yr": sig(mean), "p_yr": sig(1.0 - math.exp(-mean)),
                 "mag_max": round(float(mag_max[sl].max()), 1), "none": int(mean <= 0)}
        for name, grid in extra.items():
            v = grid[sl]
            props[name] = int(v.max()) if name == "quakes" else round(float(v.mean()), 6)
        features.append({"type": "Feature", "properties": props,
                         "geometry": {"type": "Polygon", "coordinates": [[
                             [round(west, 4), round(south, 4)], [round(east, 4), round(south, 4)],
                             [round(east, 4), round(north, 4)], [round(west, 4), round(north, 4)],
                             [round(west, 4), round(south, 4)]]]}})
    return features


SOURCE = {
    "dataset": "USGS ComCat (ANSS Comprehensive Earthquake Catalog), via the FDSN event service; "
               "folds in ISC-GEM and the PDE for the historical record",
    "citation": "U.S. Geological Survey, Earthquake Hazards Program (2017), ANSS Comprehensive "
                "Earthquake Catalog (ComCat), https://doi.org/10.5066/F7MS3QZH",
    "reach": "log10(R_km) = 0.5 M - 1.7, the radius of damaging shaking (about MMI VI) in the global "
             "average; log-normal about R with sigma {} -- an event counts at a point as "
             "P(reach >= d) = 1 - Phi(ln(d/R)/sigma)".format(SIGMA),
    "windows": WINDOWS, "bands": BANDS, "stamp": f"to R exp({STAMP_SIGMAS} sigma)",
    "caveat": "Isotropic and depth-blind: attenuation differs by region and with depth, and a "
              "proper hazard map (GEM, PSHA) uses site-specific ground-motion models and fault "
              "sources. This is the catalogue's own answer at a point.",
    "resolution": "variable, 0.25 to 8 degrees; a cell subdivides while the band inside it varies by "
                  "more than 2% of its peak, is empty in part, or spans a whole magnitude unit of "
                  "largest-on-record. Cell size is display resolution only.",
}


def write_grid(path, features, band):
    grid = {"type": "FeatureCollection",
            "_source": {**SOURCE, "band": band,
                        "measure": ("earthquakes of {} per year shaking the point at about MMI VI or more".format(
                            "M 8 and above" if band == "m8" else "M {}-{}.9".format(band[1], band[1]))
                                    if band != "any" else "earthquakes of any size (M >= 5) per year shaking "
                                    "the point at about MMI VI or more")
                                   + "; p_yr is 1 - exp(-rate), the chance of at least one in a year"},
            "features": features}
    path.write_text(json.dumps(grid, separators=(",", ":")))
    return path.stat().st_size / 1e6


def main() -> int:
    began = time.time()
    print("  fetching USGS ComCat, M >= 5 since {}...".format(FIRST_YEAR))
    feats = fetch_events()
    print("  {:,} events ({:.0f}s)".format(len(feats), time.time() - began))

    events = []
    for f in feats:
        p = f["properties"]
        g = f.get("geometry") or {}
        c = g.get("coordinates") or [None, None, None]
        if p.get("mag") is None or c[0] is None:
            continue
        t = p.get("time")
        year = time.gmtime(t / 1000).tm_year if t else None
        events.append({"type": "Feature",
                       "properties": {"mag": round(float(p["mag"]), 1), "depth_km": round(float(c[2]), 1) if c[2] is not None else None,
                                      "time": t, "year": year, "place": p.get("place"), "id": f.get("id"),
                                      "tsunami": int(p.get("tsunami") or 0)},
                       "geometry": {"type": "Point", "coordinates": [round(float(c[0]), 4), round(float(c[1]), 4)]}})
    OUT_EVENTS.write_text(json.dumps({"type": "FeatureCollection", "_source": SOURCE, "features": events},
                                     separators=(",", ":")))
    print("  wrote {:,} events, {:.1f} MB -> {}".format(len(events), OUT_EVENTS.stat().st_size / 1e6,
                                                        OUT_EVENTS.relative_to(ROOT)))

    cells = NY * NX
    per_band = {b: np.zeros(cells, dtype=np.float64) for b in BANDS}
    mag_max = np.zeros(cells, dtype=np.float32)
    quakes = np.zeros(cells, dtype=np.int32)
    counted = {b: 0 for b in BANDS}
    skipped = 0
    for e in events:
        p = e["properties"]
        band = band_of(p["mag"])
        if band is None or p["year"] is None:
            skipped += 1
            continue
        lo, hi = WINDOWS[band]
        if p["year"] < lo or p["year"] > hi:
            skipped += 1
            continue
        lon, lat = e["geometry"]["coordinates"]
        hit, k = kernel(lon, lat, p["mag"])
        if hit is None:
            skipped += 1
            continue
        per_band[band][hit] += k / (hi - lo + 1)
        near = hit[k >= COUNTS_FROM_P]
        mag_max[near] = np.maximum(mag_max[near], p["mag"])
        quakes[near] += 1
        counted[band] += 1
    print("  counted {}; skipped {:,} (outside their window or unplaced) ({:.0f}s)".format(
        ", ".join(f"{b} {n:,}" for b, n in counted.items()), skipped, time.time() - began))

    grids = {b: per_band[b].reshape(NY, NX) for b in BANDS}
    grids["any"] = sum(per_band.values()).reshape(NY, NX)
    mm = mag_max.reshape(NY, NX)
    extra = {"quakes": quakes.reshape(NY, NX)}
    feats_any = quadtree(grids["any"], mm, {**extra, **{b: grids[b] for b in BANDS}})
    print("  any: {:,} cells, {:.1f} MB".format(len(feats_any), write_grid(GLOBAL / f"{STEM}.geojson", feats_any, "any")))
    for b in BANDS:
        fs = quadtree(grids[b], mm, extra)
        print("  {}: {:,} cells, {:.1f} MB".format(b, len(fs), write_grid(GLOBAL / f"{STEM}-{b}.geojson", fs, b)))
    reached = int((grids["any"] > 0).sum())
    print("  {:,} of {:,} lattice cells reached ({:.0f}%); the rest none on record".format(reached, cells, 100 * reached / cells))

    def at(lat, lon):
        r = int((90.0 - lat) / STEP); c = int(((lon + 180.0) / STEP) % NX)
        a = grids["any"][r, c]
        return "any {:.4f}/yr (1 in {:,} y) | {} | max M{}".format(
            a, int(round(1 / a)) if a > 0 else 0,
            " ".join(f"{b}:{grids[b][r, c]:.2g}" for b in BANDS if grids[b][r, c] > 0), mm[r, c])
    for name, lat, lon in [("Tokyo", 35.68, 139.69), ("San Francisco", 37.77, -122.42), ("Istanbul", 41.01, 28.98),
                           ("Kathmandu", 27.71, 85.32), ("Santiago", -33.45, -70.67), ("London", 51.5, -0.12),
                           ("Christchurch", -43.53, 172.63), ("Jakarta", -6.2, 106.85)]:
        print("    {:<14} {}".format(name, at(lat, lon)))
    print("  done in {:.0f}s".format(time.time() - began))
    return 0


if __name__ == "__main__":
    sys.exit(main())
