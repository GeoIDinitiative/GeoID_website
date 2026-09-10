#!/usr/bin/env python3
"""Seismic hazard, gridded, one map per magnitude: how often an earthquake of
each size shakes a point -- the volcanic risk bake's method with magnitude in
place of VEI.

THE RECORD IS THREE SOURCES, because no single catalogue is both complete and
current, and each of the three is the best available at what it does:

  ComCat, M >= 4.5 since 1900   the density and the currency. 311,675 events
                                (measured), public domain, but its magnitudes
                                are MIXED -- about 82% of modern events at
                                this threshold are body-wave mb, which
                                saturates near 6 and reads low against Mw.
  ISC-GEM v12, 1904-2021        the homogenised backbone. 84,000 events, every
                                one Mw, recomputed from the original station
                                bulletins. Joined onto ComCat by ComCat's OWN
                                `ids` field, which lists every contributing id
                                of a merged event -- so there is no fuzzy
                                space-time matching and no double count.
  GEM GHEC v1.0, 1008-1903      the deep history. 825 events of about M >= 7,
                                the only global pre-instrumental catalogue.
                                Its last event is 1903-12-28 and ISC-GEM's
                                first is 1904-01-20: the two were built as a
                                pair and the seam needs no dedup at all.

Each event therefore carries TWO magnitudes: `mag`, ComCat's preferred (always
there, current), and `mw`, ISC-GEM's homogenised Mw where that catalogue
reaches. Everything downstream reads `mw` where it exists and falls back.

GHEC IS IN THE RECORD AND NOT IN THE RATES. A rate needs a COMPLETE window,
and GHEC is a catalogue of the large events somebody knows about rather than a
complete record of a period -- counting nine centuries of partial coverage
would divide a handful of events by 900 years and understate every rate it
touched. It plays in the timeline, where each event is a real event with a
date, and the card says what it is.

Written whole to data/global/earthquakes.geojson for the timeline (one point
per event), and the instrumental part stamped into four quadtree grids -- M5
(5.0-5.9), M6, M7, M8 (8.0+) -- plus the collective, each "earthquakes of that
size per year shaking the point at MMI >= VI or so".

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

import calendar
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
MIN_MAG = 4.5               # the record's floor; the RATE bands still start at 5
ISCGEM_YEARS = (1904, 2022)  # v12 runs 1904-04-04 to 2021-12-31
GHEC_URL = "https://emidius.eu/GEH/download/GEM-GHEC-v1.txt"
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


def _page(url):
    """One FDSN page, retried: the service 504s under load rather than failing."""
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=180) as r:
                return json.load(r)
        except Exception:  # noqa: BLE001
            if attempt == 3:
                raise
            time.sleep(4 * (attempt + 1))
    return {"features": []}


def _yearly(params, first, last, label):
    """Walk a catalogue a year at a time.

    The service caps a page at 20,000 and the busiest year at M >= 4.5 holds
    about 15,500, so a year is a safe page -- and the cap is CHECKED rather
    than trusted, because a page silently truncated is a year of the record
    quietly missing.
    """
    out = []
    for year in range(first, last + 1):
        url = (f"{FDSN}?format=geojson&starttime={year}-01-01&endtime={year + 1}-01-01"
               f"&orderby=time-asc&limit=20000&{params}")
        got = _page(url).get("features", [])
        if len(got) >= 20000:
            raise RuntimeError(f"{label} {year}: a page hit the cap; split the year")
        out.extend(got)
        if year % 20 == 0:
            print(f"    {label} {year}: {len(out):,} so far", flush=True)
    return out


def fetch_iscgem_mw():
    """iscgem id -> homogenised Mw, from the two ISC-GEM catalogues ComCat mirrors.

    The MAIN catalogue and the SUPPLEMENTARY one are separate `catalog=`
    values and both are wanted: the supplement is the events that did not meet
    the main catalogue's own cut-off but were still recomputed.
    """
    mw = {}
    for cat in ("iscgem", "iscgemsup"):
        feats = _yearly(f"catalog={cat}", ISCGEM_YEARS[0], ISCGEM_YEARS[1], cat)
        for f in feats:
            m = f.get("properties", {}).get("mag")
            if f.get("id") and m is not None:
                mw[f["id"]] = round(float(m), 2)
        print(f"    {cat}: {len(feats):,} events", flush=True)
    return mw


def fetch_ghec():
    """GEM's global historical catalogue, 1008-1903, as (lon, lat, depth, mag, t, place).

    Tab-separated with a commented header. The magnitude is NOT homogenised --
    Mw, Ms and Mjma sit in one column with an MType beside them -- so the type
    rides on the event rather than being flattened into a number that would
    read as an Mw.
    """
    with urllib.request.urlopen(GHEC_URL, timeout=120) as r:
        text = r.read().decode("utf-8", "replace")
    rows, head = [], None
    for line in text.splitlines():
        if line.startswith("#") or not line.strip():
            continue
        cells = line.rstrip("\n").split("\t")
        if head is None:
            head = [c.strip() for c in cells]
            continue
        row = dict(zip(head, [c.strip() for c in cells]))
        try:
            lat, lon, mag = float(row["Lat"]), float(row["Lon"]), float(row["M"])
            year = int(row["Year"])
        except (KeyError, ValueError):
            continue
        month = int(row.get("Mo") or 1) or 1
        day = int(row.get("Da") or 1) or 1
        try:
            t = int(calendar.timegm((year, month, day, 0, 0, 0, 0, 1, 0)) * 1000)
        except (ValueError, OverflowError):
            t = None
        # `Area` is GHEC's own place column and `GEHid` its own id; the names
        # were read off the file's header rather than guessed, after a first
        # pass keyed on EqName/Region and wrote 825 blank places.
        depth = None
        try:
            depth = float(row["Dep"]) if row.get("Dep") else None
        except ValueError:
            depth = None
        rows.append((lon, lat, depth, mag, row.get("MType") or "", t, year,
                     row.get("Area") or "", row.get("GEHid") or ""))
    return rows


def fetch_events():
    """The three sources, merged into one list of trimmed event tuples.

    Tuples rather than dicts: three hundred thousand of the latter is most of a
    gigabyte of Python objects, and this machine has been taken down by a bake
    before.
    """
    began = time.time()
    print("  ISC-GEM (the homogenised Mw backbone)...", flush=True)
    mw_by_id = fetch_iscgem_mw()
    print("  {:,} ISC-GEM magnitudes ({:.0f}s)".format(len(mw_by_id), time.time() - began), flush=True)

    print(f"  ComCat, M >= {MIN_MAG} since {FIRST_YEAR}...", flush=True)
    feats = _yearly(f"minmagnitude={MIN_MAG}", FIRST_YEAR, LAST_COMPLETE + 1, "comcat")
    print("  {:,} ComCat events ({:.0f}s)".format(len(feats), time.time() - began), flush=True)

    events, joined = [], 0
    for f in feats:
        p = f.get("properties") or {}
        c = ((f.get("geometry") or {}).get("coordinates") or [None, None, None])
        if p.get("mag") is None or c[0] is None:
            continue
        # The join: ComCat lists every contributing id of a merged event, so an
        # ISC-GEM Mw is looked up rather than matched in space and time.
        mw = None
        for part in (p.get("ids") or "").strip(",").split(","):
            if part.startswith("iscgem") and part in mw_by_id:
                mw = mw_by_id[part]
                joined += 1
                break
        t = p.get("time")
        events.append((float(c[0]), float(c[1]), c[2], float(p["mag"]), p.get("magType") or "",
                       t, time.gmtime(t / 1000).tm_year if t else None, p.get("place") or "",
                       f.get("id") or "", mw))
    print("  {:,} carry an ISC-GEM Mw ({:.0%})".format(joined, joined / max(1, len(events))), flush=True)

    print("  GEM GHEC v1.0 (1008-1903)...", flush=True)
    hist = fetch_ghec()
    for lon, lat, depth, mag, mtype, t, year, place, eid in hist:
        events.append((lon, lat, depth, mag, mtype, t, year, place, f"ghec{eid}", None))
    print("  {:,} historical events; {:,} in all ({:.0f}s)".format(len(hist), len(events), time.time() - began), flush=True)
    return events


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
    "dataset": "Three catalogues merged: USGS ComCat (M >= {} since {}) for density and currency, "
               "ISC-GEM v12 (1904-2021) joined on ComCat's own contributing ids for homogenised Mw, "
               "and GEM GHEC v1.0 (1008-1903) for the pre-instrumental record".format(MIN_MAG, FIRST_YEAR),
    "citation": "U.S. Geological Survey, Earthquake Hazards Program (2017), ANSS Comprehensive "
                "Earthquake Catalog (ComCat), https://doi.org/10.5066/F7MS3QZH · "
                "International Seismological Centre (2025), ISC-GEM Earthquake Catalogue, "
                "https://doi.org/10.31905/d808b825 (Storchak et al. 2013, 2015; Di Giacomo et al. 2018) · "
                "GEM Foundation (2013), GEM Global Historical Earthquake Catalogue v1.0, "
                "https://doi.org/10.13127/ghea/ghec.1.0",
    "licence": "ComCat is US Government public domain. ISC-GEM and GEM GHEC are CC-BY-SA 3.0, so "
               "anything derived from them -- these grids included -- is offered under CC-BY-SA 3.0 "
               "with the citations above.",
    "magnitude": "Each event carries ComCat's preferred `mag` and, where ISC-GEM reaches it, that "
                 "catalogue's homogenised `mw`. The rates are computed on `mw` where it exists: "
                 "about 82% of modern ComCat at this threshold is body-wave mb, which saturates near "
                 "6 and reads low against Mw, so events land in the wrong band under the raw number.",
    "historical": "GHEC's 825 events play in the timeline and are HELD OUT of the rates: a rate needs "
                  "a complete window, and a catalogue of the large events somebody knows about across "
                  "nine centuries is not one.",
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
    events = fetch_events()

    # ── the record, streamed out ──────────────────────────────────────────
    #
    # Streamed rather than assembled: a FeatureCollection of three hundred
    # thousand features built as one Python object and then serialised is the
    # peak this bake would be measured at, and it is avoidable.
    OUT_EVENTS.parent.mkdir(parents=True, exist_ok=True)
    with OUT_EVENTS.open("w") as out:
        out.write('{"type":"FeatureCollection","_source":')
        out.write(json.dumps(SOURCE))
        out.write(',"features":[')
        for i, (lon, lat, depth, mag, mtype, t, year, place, eid, mw) in enumerate(events):
            # ONE COLUMN TO COLOUR BY. The symbology reads a property NAME,
            # not a function, so the choice between ISC-GEM's Mw and ComCat's
            # preferred magnitude is made here rather than in every consumer --
            # and both are still carried, so the card can say which it showed.
            props = {"mag": round(mag, 1), "magType": mtype,
                     "mag_best": round(mw if mw is not None else mag, 2),
                     "time": t, "year": year, "place": place, "id": eid}
            if depth is not None:
                props["depth_km"] = round(float(depth), 1)
            # ISC-GEM's own Mw, where that catalogue reaches. Absent rather
            # than filled: a magnitude nobody homogenised must not read as one.
            if mw is not None:
                props["mw"] = mw
            if eid.startswith("ghec"):
                props["historical"] = 1
            if i:
                out.write(",")
            out.write(json.dumps({"type": "Feature", "properties": props,
                                  "geometry": {"type": "Point",
                                               "coordinates": [round(lon, 3), round(lat, 3)]}},
                                 separators=(",", ":")))
        out.write("]}")
    print("  wrote {:,} events, {:.1f} MB -> {}".format(len(events), OUT_EVENTS.stat().st_size / 1e6,
                                                        OUT_EVENTS.relative_to(ROOT)), flush=True)

    cells = NY * NX
    per_band = {b: np.zeros(cells, dtype=np.float64) for b in BANDS}
    mag_max = np.zeros(cells, dtype=np.float32)
    quakes = np.zeros(cells, dtype=np.int32)
    counted = {b: 0 for b in BANDS}
    skipped = historical = on_mw = 0
    for lon, lat, depth, mag, mtype, t, year, place, eid, mw in events:
        # THE HISTORICAL RECORD IS NOT A RATE. GHEC is the large events
        # somebody knows about across nine centuries, not a complete record of
        # them; counted here it would divide a handful by 900 years and
        # understate every rate it touched.
        if eid.startswith("ghec"):
            historical += 1
            continue
        # ISC-GEM's Mw where it reaches, ComCat's preferred otherwise. This is
        # what the richer catalogue buys the HAZARD: about 82% of modern
        # ComCat at this threshold is body-wave mb, which saturates near 6 and
        # reads low -- so events land in the wrong band under the raw number.
        best = mw if mw is not None else mag
        if mw is not None:
            on_mw += 1
        band = band_of(best)
        if band is None or year is None:
            skipped += 1
            continue
        lo, hi = WINDOWS[band]
        if year < lo or year > hi:
            skipped += 1
            continue
        hit, k = kernel(lon, lat, best)
        if hit is None:
            skipped += 1
            continue
        per_band[band][hit] += k / (hi - lo + 1)
        near = hit[k >= COUNTS_FROM_P]
        mag_max[near] = np.maximum(mag_max[near], best)
        quakes[near] += 1
        counted[band] += 1
    print("  counted {}; {:,} on an ISC-GEM Mw; {:,} historical held out of the rates;"
          " {:,} skipped (below M5, outside their window, or unplaced) ({:.0f}s)".format(
              ", ".join(f"{b} {n:,}" for b, n in counted.items()), on_mw, historical,
              skipped, time.time() - began), flush=True)

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
