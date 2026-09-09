#!/usr/bin/env python3
"""Volcanic risk, as a map: how often ash reaches a point, from the eruption record.

The buffers in Hazards > Volcanic hazards are SCHEMATIC -- five fixed rings
round every Holocene volcano whatever it has done. This is the other product,
and the companion to the cyclone risk map: every confirmed, dated eruption in
the Smithsonian catalogue, each given a REACH that grows with its VEI, counted
at every lattice point it reaches and divided by the length of record over
which eruptions of its size are actually recorded. The answer is a rate per
year at a point, converted to the chance of at least one in a year (Poisson),
and drawn on the cyclone map's own variable-resolution quadtree.

THE VALUE IS AT A POINT, WITHIN A REACH -- never per cell -- for the reason
the cyclone map records at length: cells of different sizes are only
comparable when each is a sampling location and its size is display
resolution. The quadtree here is the cyclone bake's, ported line for line.

THE REACH IS SCHEMATIC AND ISOTROPIC, and says so. Ash falls in a plume, not
a circle; a circle of the plume's typical length is the honest fixed-radius
stand-in for it, and it is the same claim the buffers make. The radii are
order-of-magnitude distances at which fall of about a millimetre is reported
for eruptions of each VEI:

    VEI 0-1     5 km    near-vent effusion and small explosions
    VEI 2      15 km
    VEI 3      40 km
    VEI 4     120 km    (Eyjafjallajokull 2010, Calbuco 2015)
    VEI 5     300 km    (St Helens 1980, Pinatubo 1991 was VEI 6)
    VEI 6     600 km    (Pinatubo 1991, Novarupta 1912)
    VEI 7    1000 km    (Tambora 1815)

THE WINDOW DEPENDS ON THE SIZE, because the record does. Measured on the
catalogue, confirmed eruptions per fifty years: VEI <= 3 run 76 (1500s), 178
(1700s), 983 (1850-99), 1,318 (1900-49), 1,821 (1950-99) and 990 in the 26
years since 2000 -- the recording flattens only after 1950. VEI 4: 8, 10, 11,
9, 11, 19, 14, 21, 26, 27 per half-century from 1500, then 30 in 26 years --
flat from about 1850. VEI 5: 3, 5, 5, 3, 1, 4, 3, 3, 5 per half-century from
1550 -- flat for four and a half centuries. VEI 6: about one per fifty years
since 1550 (7 in 476 years), against 43 in the ten thousand years before 1000
CE from tephra studies. VEI 7: two since 1000 CE (Samalas 1257, Tambora 1815).
So:

    VEI <= 3 and unknown VEI    counted over 1950-2025   (76 complete years)
    VEI 4                       counted over 1900-2025   (126)
    VEI 5 and 6                 counted over 1550-2025   (476)
    VEI >= 7                    counted over the Holocene (11,700 years)

This is what lets a DORMANT volcano count: Vesuvius (VEI 5, 1631) and Fuji
(VEI 5, 1707) fall inside the window their size is recorded over, so Naples
and Tokyo carry a 1-in-476-year ashfall rate rather than nothing. A volcano
with only small eruptions before 1950 counts for nothing at those sizes,
because nothing says how often it did that compared with one somebody was
watching.

A quarter of the catalogue carries NO VEI (2,671 of 11,089). Those are
overwhelmingly small historical events; they are counted as VEI 2, and the
file says how many. "Uncertain" eruptions (1,173) are left out.

TWO PRODUCTS, ONE PASS. `--mode windowed` (the default) is the above. `--mode
holocene` writes volcanic-risk-holocene.geojson from THE FULL RECORD: every
confirmed dated eruption, no completeness windows, each volcano's frequency
taken over ITS OWN RECORD SPAN (first eruption to 2025) -- so Etna's two
hundred eruptions since 1500 read as a rate over five centuries and a volcano
known from one Holocene tephra reads as one in ten thousand years -- and the
MAGNITUDE carried as a tephra-volume proxy per VEI, so a cell's
`tephra_m3_yr` IS magnitude times frequency. What that trades: a volcano with
a short written record is measured as if it began erupting when somebody
started writing, which OVERSTATES it against one known from tephra alone; the
windowed map exists because that bias is real. Both are stated on the file.

Products: data/global/volcanic-risk.geojson -- the climatology, with `rate_yr`
and `p_yr` for all eruptions and `rate_large_yr` / `p_large_yr` for VEI >= 4
alone, plus `vents`, the number of distinct volcanoes whose reach covers the
cell. Published with publish-data.py; `data/global/*.geojson` is ignored.
"""
from __future__ import annotations

import json
import math
import pathlib
import sys
import time
import urllib.parse
import urllib.request

import numpy as np

import argparse

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT_GRID = ROOT / "data" / "global" / "volcanic-risk.geojson"
OUT_HOLOCENE = ROOT / "data" / "global" / "volcanic-risk-holocene.geojson"
VOLCANOES = ROOT / "data" / "global" / "volcanoes.geojson"

WFS = "https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows"
ERUPTIONS = "GVP-VOTW:Smithsonian_VOTW_Holocene_Eruptions"

EARTH_R_KM = 6371.0088
STEP = 0.25
NX = int(round(360 / STEP))
NY = int(round(180 / STEP))
ROW_LAT = 90.0 - (np.arange(NY) + 0.5) * STEP
COARSEST = 32
FINEST = 1
SPREAD = 0.02
PLACES = 6

REACH_KM = {0: 5.0, 1: 5.0, 2: 15.0, 3: 40.0, 4: 120.0, 5: 300.0, 6: 600.0, 7: 1000.0, 8: 1500.0}
UNKNOWN_VEI_AS = 2
# Geometric-mean tephra volume per VEI class, m3 (Newhall & Self 1982: VEI 2 is
# 1e6-1e7 m3, each step a decade; VEI 0 under 1e4, VEI 1 1e4-1e6).
TEPHRA_M3 = {0: 1e3, 1: 1e5, 2: 3e6, 3: 3e7, 4: 3e8, 5: 3e9, 6: 3e10, 7: 3e11, 8: 3e12}
HOLOCENE_START = -9700
LAST_COMPLETE = 2025
WINDOWS = {"small": (1950, LAST_COMPLETE), "vei4": (1900, LAST_COMPLETE),
           "vei56": (1550, LAST_COMPLETE), "vei7": (-9700, LAST_COMPLETE)}
LARGE_VEI = 4


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
        return json.load(r)


_DISCS = {}


def discs(radius_km):
    """The cyclone bake's per-row disc lookup, for any radius (cached per radius)."""
    if radius_km in _DISCS:
        return _DISCS[radius_km]
    span = int(math.ceil(radius_km / 111.32 / STEP)) + 1
    row_part, col_off = [], []
    hav_r = math.sin(0.5 * radius_km / EARTH_R_KM) ** 2
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
            if denom <= 0:
                half = NX // 2
            else:
                s = math.sqrt(min(1.0, room / denom))
                half = min(NX // 2, int(math.floor(math.degrees(2 * math.asin(s)) / STEP)))
            offs = np.arange(-half, half + 1)
            cols.append(offs)
            rows.append(np.full(offs.size, r2, dtype=np.int64))
        row_part.append(np.concatenate(rows) * NX if rows else np.zeros(0, dtype=np.int64))
        col_off.append(np.concatenate(cols) if cols else np.zeros(0, dtype=np.int64))
    _DISCS[radius_km] = (row_part, col_off)
    return _DISCS[radius_km]


def stamp(lon, lat, radius_km):
    """Every lattice cell whose centre is within radius_km of one point."""
    if not (np.isfinite(lon) and np.isfinite(lat) and abs(lat) <= 90):
        return None
    row_part, col_off = discs(radius_km)
    r = int(min(NY - 1, max(0, (90.0 - lat) / STEP)))
    c = int(((lon + 180.0) / STEP) % NX)
    return row_part[r] + np.mod(c + col_off[r], NX)


def main(mode="windowed") -> int:
    began = time.time()
    holocene = mode == "holocene"
    out_path = OUT_HOLOCENE if holocene else OUT_GRID
    print("  fetching the eruption catalogue...")
    payload = fetch_eruptions()
    feats = payload["features"]
    print("  {:,} eruptions in the catalogue ({:.0f}s)".format(len(feats), time.time() - began))

    volcano_names = {}
    if VOLCANOES.exists():
        for f in json.load(open(VOLCANOES))["features"]:
            volcano_names[str(f["properties"].get("gvp_number"))] = f["properties"].get("name")

    # In holocene mode a volcano's window is its OWN record span.
    first_year = {}
    for f in feats:
        p = f["properties"]
        if p.get("Activity_Type") != "Confirmed Eruption" or p.get("StartDateYear") is None:
            continue
        vn = str(p.get("Volcano_Number"))
        first_year[vn] = min(first_year.get(vn, 9999), int(p["StartDateYear"]))

    cells = NY * NX
    rate = np.zeros(cells, dtype=np.float64)
    tephra = np.zeros(cells, dtype=np.float64)
    vei_w = np.zeros(cells, dtype=np.float64)
    rate_large = np.zeros(cells, dtype=np.float64)
    vents = {}  # cell index -> {volcano number: [weight, vei_max, eruptions]} (kept sparse)
    vei_max = np.zeros(cells, dtype=np.int8)
    counted = {k: 0 for k in WINDOWS}
    unknown_vei = uncertain = undated = out_of_window = 0
    per_volcano = {}

    for f in feats:
        p = f["properties"]
        if p.get("Activity_Type") != "Confirmed Eruption":
            uncertain += 1
            continue
        year = p.get("StartDateYear")
        if year is None:
            undated += 1
            continue
        vei = p.get("ExplosivityIndexMax")
        if vei is None:
            unknown_vei += 1
            vei_used = UNKNOWN_VEI_AS
        else:
            vei_used = int(vei)
        cls = size_class(vei)
        vn = str(p.get("Volcano_Number"))
        if holocene:
            lo, hi = max(HOLOCENE_START, first_year[vn]), LAST_COMPLETE
            if year > hi:
                out_of_window += 1
                continue
        else:
            lo, hi = WINDOWS[cls]
            if year < lo or year > hi:
                out_of_window += 1
                continue
        geom = f.get("geometry") or {}
        coords = geom.get("coordinates") or [None, None]
        lon, lat = coords[0], coords[1]
        reach = REACH_KM.get(min(vei_used, 8), 5.0)
        hit = stamp(lon, lat, reach)
        if hit is None:
            continue
        weight = 1.0 / (hi - lo + 1)
        rate[hit] += weight
        tephra[hit] += weight * TEPHRA_M3[min(vei_used, 8)]
        vei_w[hit] += weight * vei_used
        if vei_used >= LARGE_VEI:
            rate_large[hit] += weight
        vei_max[hit] = np.maximum(vei_max[hit], vei_used)  # fancy-index out= writes a copy
        counted[cls] += 1
        per_volcano[vn] = per_volcano.get(vn, 0) + 1
        for idx in hit.tolist():
            d = vents.get(idx)
            if d is None:
                d = vents[idx] = {}
            rec = d.get(vn)
            if rec is None:
                d[vn] = [weight, vei_used, 1]
            else:
                rec[0] += weight
                rec[1] = max(rec[1], vei_used)
                rec[2] += 1

    print("  counted {}; skipped {:,} uncertain, {:,} undated, {:,} outside their window; "
          "{:,} with no VEI counted as VEI {}".format(
              ", ".join("{} {:,}".format(k, v) for k, v in counted.items()),
              uncertain, undated, out_of_window, unknown_vei, UNKNOWN_VEI_AS))
    rate = rate.reshape(NY, NX)
    rate_large = rate_large.reshape(NY, NX)
    tephra = tephra.reshape(NY, NX)
    vei_w = vei_w.reshape(NY, NX)
    vent_count = np.zeros(cells, dtype=np.int32)
    for idx, d in vents.items():
        vent_count[idx] = len(d)
    vent_count = vent_count.reshape(NY, NX)
    vei_max = vei_max.reshape(NY, NX)
    print("  peak {:.3f} eruptions/yr reaching a point; {:,} of {:,} lattice points ever reached "
          "({:.0f}s)".format(rate.max(), int((rate > 0).sum()), cells, time.time() - began))

    # -- the quadtree, the cyclone bake's own ------------------------------
    limit = SPREAD * rate.max()
    limit_large = SPREAD * max(rate_large.max(), 1e-12)
    blocks = []

    def flat(field, r0, c0, size, lim):
        block = field[r0:r0 + size, c0:c0 + size]
        lo, hi = block.min(), block.max()
        if lo == 0 and hi > 0:      # a block that is empty in part is not flat
            return False
        return (hi - lo) <= lim

    def flat_log(field, r0, c0, size, ratio=2.0):
        """A log quantity is flat when max/min is under a ratio (empty-in-part is not)."""
        block = field[r0:r0 + size, c0:c0 + size]
        lo, hi = block.min(), block.max()
        if lo == 0 and hi > 0:
            return False
        return hi <= ratio * lo

    def emit(r0, c0, size):
        # the largest eruption on record is a class, so a block holding two is not flat
        v = vei_max[r0:r0 + size, c0:c0 + size]
        if size > FINEST and not (flat(rate, r0, c0, size, limit)
                                  and flat(rate_large, r0, c0, size, limit_large)
                                  and flat_log(tephra, r0, c0, size)
                                  and v.min() == v.max()):
            half = size // 2
            for dr in (0, half):
                for dc in (0, half):
                    emit(r0 + dr, c0 + dc, half)
            return
        blocks.append((r0, c0, size))

    for r0 in range(0, NY, COARSEST):
        for c0 in range(0, NX, COARSEST):
            emit(r0, c0, COARSEST)
    print("  {:,} cells after coarsening (lattice is {:,})".format(len(blocks), cells))

    features = []
    for r0, c0, size in blocks:
        mean = float(rate[r0:r0 + size, c0:c0 + size].mean())
        if mean <= 0:
            continue
        large = float(rate_large[r0:r0 + size, c0:c0 + size].mean())
        teph = float(tephra[r0:r0 + size, c0:c0 + size].mean())
        vmean = float(vei_w[r0:r0 + size, c0:c0 + size].sum() / max(rate[r0:r0 + size, c0:c0 + size].sum(), 1e-30))
        vmax = int(vent_count[r0:r0 + size, c0:c0 + size].max())
        block = rate[r0:r0 + size, c0:c0 + size]
        rr, cc = np.unravel_index(int(block.argmax()), block.shape)
        top = vents.get((r0 + rr) * NX + c0 + cc, {})
        tv = max(top.items(), key=lambda kv: kv[1][0]) if top else None
        north = 90.0 - r0 * STEP
        south = north - size * STEP
        west = -180.0 + c0 * STEP
        east = west + size * STEP
        features.append({
            "type": "Feature",
            "properties": {
                "i": len(features),
                "deg": round(size * STEP, 4),
                "rate_yr": round(mean, PLACES),
                "p_yr": round(1.0 - math.exp(-mean), PLACES),
                "rate_large_yr": round(large, PLACES),
                "p_large_yr": round(1.0 - math.exp(-large), PLACES),
                "years_per": round(1.0 / mean, 1),
                "vei_max": int(vei_max[r0:r0 + size, c0:c0 + size].max()),
                "vei_mean": round(vmean, 2),
                # magnitude x frequency: tephra volume reaching the point per year
                "tephra_m3_yr": float("{:.3g}".format(teph)),
                "vents": vmax,
                "top_volcano": volcano_names.get(tv[0], tv[0]) if tv else None,
                "top_gvp": int(tv[0]) if tv and tv[0].isdigit() else None,
                "top_eruptions": tv[1][2] if tv else None,
                "top_vei_max": tv[1][1] if tv else None,
                "top_rate_yr": round(tv[1][0], PLACES) if tv else None,
            },
            "geometry": {"type": "Polygon", "coordinates": [[
                [round(west, 4), round(south, 4)], [round(east, 4), round(south, 4)],
                [round(east, 4), round(north, 4)], [round(west, 4), round(north, 4)],
                [round(west, 4), round(south, 4)],
            ]]},
        })

    grid = {
        "type": "FeatureCollection",
        "_source": {
            "mode": mode,
            "windows_note": ("every volcano's frequency over ITS OWN record span, first "
                             "eruption to {}; no completeness windows".format(LAST_COMPLETE)
                             if holocene else "per-VEI completeness windows"),
            "tephra_m3_by_vei": TEPHRA_M3,
            "dataset": "Smithsonian Global Volcanism Program, Volcanoes of the World "
                       "(Holocene eruption catalogue)",
            "publisher": "Smithsonian Institution",
            "citation": "Global Volcanism Program (2024). Volcanoes of the World, "
                        "v. 5.2.x. Smithsonian Institution. https://doi.org/10.5479/si.GVP.VOTW5-2024.5.2",
            "measure": "Confirmed, dated eruptions reaching a point, per year, each "
                       "eruption reaching a fixed radius set by its VEI and each counted "
                       "over the window in which eruptions of its size are recorded. "
                       "p_yr is 1 - exp(-rate), the chance of at least one in a year "
                       "on the Poisson assumption. vei_max is the largest VEI on record "
                       "reaching the cell; top_* describe the volcano contributing most.",
            "reach_km_by_vei": REACH_KM,
            "windows": {k: list(v) for k, v in WINDOWS.items()},
            "unknown_vei_counted_as": UNKNOWN_VEI_AS,
            "counted": counted,
            "skipped": {"uncertain": uncertain, "undated": undated,
                        "outside_window": out_of_window},
            "unknown_vei": unknown_vei,
            "large_vei": LARGE_VEI,
            "resolution": "variable, {} to {} degrees; a cell subdivides while the rate "
                          "inside it varies by more than {:.0%} of the global peak. Cell "
                          "size is display resolution only - the value is measured at a "
                          "point.".format(FINEST * STEP, COARSEST * STEP, SPREAD),
            "caveat": "Reach is schematic and isotropic: ash falls in a wind-driven "
                      "plume, and a circle of the plume's typical length is the "
                      "fixed-radius stand-in for it. The recording of small eruptions "
                      "is complete only where somebody was watching.",
        },
        "features": features,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(grid, separators=(",", ":")))
    print("  wrote {:,} cells, {:.1f} MB -> {}".format(len(features), out_path.stat().st_size / 1e6,
                                                    out_path.relative_to(ROOT)))

    # -- places anybody can check ----------------------------------------
    def at(lat, lon):
        r = int((90.0 - lat) / STEP)
        c = int(((lon + 180.0) / STEP) % NX)
        v = rate[r, c]
        return "{:.4f}/yr (1 in {:,} y), large {:.5f}/yr, VEI max {}, {:.3g} m3/yr, {} vents".format(
            v, int(round(1 / v)) if v > 0 else 0, rate_large[r, c], vei_max[r, c], tephra[r, c], vent_count[r, c])
    for name, lat, lon in [("Naples", 40.85, 14.27), ("Catania", 37.5, 15.09), ("Tokyo", 35.68, 139.69),
                           ("Yogyakarta", -7.8, 110.37), ("Reykjavik", 64.13, -21.9), ("Manila", 14.6, 120.98),
                           ("Quito", -0.18, -78.47), ("Seattle", 47.6, -122.33), ("Paris", 48.86, 2.35),
                           ("Sydney", -33.87, 151.21), ("Auckland", -36.85, 174.76)]:
        print("    {:<11} {}".format(name, at(lat, lon)))
    print("  done in {:.0f}s".format(time.time() - began))
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="volcanic risk: windowed (default) or the full Holocene record")
    ap.add_argument("--mode", choices=("windowed", "holocene"), default="windowed")
    sys.exit(main(ap.parse_args().mode))
