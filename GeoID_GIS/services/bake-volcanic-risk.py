#!/usr/bin/env python3
"""Volcanic risk, gridded, one map per VEI: how often an eruption of each size
happens near a point.

For each record (--mode windowed or holocene) a set of variable-resolution
GRIDS -- the cyclone risk map's quadtree, one file per band: `vei1`..`vei8`,
each holding ERUPTIONS OF THAT SIZE PER YEAR near the point, and `any` (every
size, VEI 0 and 6-7 included), which is the catalogue layer itself. The page
plays the five VEI grids through the time-lapse bar with the VEI in place of
the date and the collective as the terminal frame -- the cyclone tracks'
arrangement. A raster was tried between the two gridded versions and the grid
was preferred: a quadtree coarsens where a band is flat, and a VEI 5 band is
flat over almost all of its extent.

THE VALUE IS AT A POINT, WITHIN A KERNEL -- never per cell -- for the reason
the cyclone map records: cells of different sizes are only comparable when
each is a sampling location and its size is display resolution.

THE REACH IS THE ERUPTION'S SIZE, AND IT IS A PROBABILITY. Tephra thins
exponentially with distance (Pyle 1989): T(d) = T0 exp(-d / b), with both the
near-vent thickness T0 and the thinning distance b scaling with the eruption.
Solved for a 1 mm damage threshold that gives a reach R per VEI -- about 5 km
at VEI 1, 15 at 2, 50 at 3, 150 at 4, 350 at 5, 800 at 6, 1,800 at 7 -- and
because T0 and b each vary by a factor of about two between eruptions of one
VEI, the reach is LOG-NORMAL about R with sigma = 0.5. An eruption therefore
counts at a point as P(reach >= d) = 1 - Phi(ln(d/R) / sigma): the chance
that this eruption deposits at least a millimetre of ash there. A band is
then "eruptions of VEI n per year depositing >= 1 mm of ash at the point".

This is the isotropic model the global tephra hazard studies (Jenkins et al.
2015, GAR15) reduce to without a wind field; a plume is anisotropic and goes
downwind, and that is the next step (an ERA5 wind climatology per volcano),
not something to fake. A single 100 km scale was tried for every eruption and
rejected: on a per-VEI frame every eruption shares a size, so a reach that is
the eruption's own is exactly right there.

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

--mode holocene takes THE FULL RECORD as well: for each volcano and size
class, the window above where the window holds eruptions of that size at
that volcano, and otherwise EVERY dated eruption of that size over the
volcano's own record span (first recorded eruption to 2025). So the full
record can only ADD -- a dormant volcano whose one VEI 4 is in 1400 counts,
where the windowed map drops it -- and never dilute: the first version
divided Etna's VEI 3 eruptions by its 8,000 years of tephra record and read
"1 in 1,733 years" for a volcano that does it every twenty, which is the
denominator being the wrong record. Both ship, and each file says which.

AN ERUPTION IN THE CATALOGUE IS AN EPISODE. GVP files Etna 1971-1993 as one
eruption, so a rate here is episodes per year, not paroxysms: Etna reads 22
eruptions since 1950. The card says so.

EVERY VOLCANO IS IN. The eruption list names 915 of the catalogue's 2,666; the
rest take a stated FLOOR PRIOR -- a Holocene volcano with no dated eruption,
one VEI 2 over the Holocene; a Pleistocene one, one VEI 3 over the Pleistocene
(2.58 My) -- and `prior_only` marks where nothing else reaches. Uncertain
eruptions (1,173 of 11,089) count at half weight. A quarter carry no VEI and
are counted as VEI 2.

Products: data/global/volcanic-risk[-holocene].geojson (the collective, the
catalogue layer) and data/global/volcanic-risk[-holocene]-vei{1..5}.geojson
(the frames), all gitignored and published with publish-data.py.
"""
from __future__ import annotations

import argparse
import json
import math
import pathlib
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
STEM = {"windowed": "volcanic-risk", "holocene": "volcanic-risk-holocene"}
FRAME_VEIS = [1, 2, 3, 4, 5, 6, 7, 8]
COARSEST = 32
FINEST = 1
SPREAD = 0.02
PLACES = 6

WFS = "https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows"
ERUPTIONS = "GVP-VOTW:Smithsonian_VOTW_Holocene_Eruptions"

EARTH_R_KM = 6371.0088
STEP = 0.25
NX = int(round(360 / STEP))
NY = int(round(180 / STEP))
ROW_LAT = 90.0 - (np.arange(NY) + 0.5) * STEP

# Reach to 1 mm of ash, km, by VEI: Pyle's T(d) = T0 exp(-d/b) with T0 ~ 3 cm
# (VEI 1) rising a decade every two VEI and b ~ 1.5 km (VEI 1) rising ~2x per
# VEI, solved for 1 mm. Order-of-magnitude checks: Eyjafjallajokull 2010 (VEI
# 4) ~ 1 mm to 100-200 km; St Helens 1980 (VEI 5) traces to ~400 km; Pinatubo
# 1991 (VEI 6) ~ 1 mm at 500-900 km; Tambora 1815 (VEI 7) ~ 1 mm past 1,300 km.
REACH_KM = {0: 2.0, 1: 5.0, 2: 15.0, 3: 50.0, 4: 150.0, 5: 350.0, 6: 800.0, 7: 1800.0, 8: 3000.0}
SIGMA = 0.5                 # log-normal spread of the reach within one VEI
STAMP_SIGMAS = 2.5          # stamp out to R exp(2.5 sigma): P(>= 1 mm) = 0.6% there
UNKNOWN_VEI_AS = 2
UNCERTAIN_WEIGHT = 0.5
LAST_COMPLETE = 2025
HOLOCENE_START = -9700
WINDOWS = {"small": (1950, LAST_COMPLETE), "vei4": (1900, LAST_COMPLETE),
           "vei56": (1550, LAST_COMPLETE), "vei7": (HOLOCENE_START, LAST_COMPLETE)}
PRIOR = {"holocene": {"vei": 2, "span": LAST_COMPLETE - HOLOCENE_START + 1},
         "pleistocene": {"vei": 3, "span": 2_580_000}}
VEIS = list(range(9))   # 0..8; no Holocene eruption is VEI 8, and its frame says so
BANDS = [f"vei{v}" for v in VEIS] + ["any", "vei_max", "vents", "prior_only"]
SOURCE = {
    "dataset": "Smithsonian Global Volcanism Program, Volcanoes of the World (Holocene eruption catalogue)",
    "citation": "Global Volcanism Program (2024). Volcanoes of the World, v. 5.2. Smithsonian "
                "Institution. https://doi.org/10.5479/si.GVP.VOTW5-2024.5.2",
    "kernel": "each eruption counts P(reach >= d) = 1 - Phi(ln(d/R)/sigma) at distance d: the chance "
              "it deposits at least 1 mm of ash there, with R by VEI (Pyle exponential thinning solved "
              "for 1 mm) and sigma = {}".format(SIGMA),
    "reach_km_by_vei": REACH_KM,
    "measure_unit": "eruptions of that VEI per year depositing >= 1 mm of ash at the point",
    "uncertain_weight": UNCERTAIN_WEIGHT, "unknown_vei_counted_as": UNKNOWN_VEI_AS,
    "floor_prior": PRIOR,
    "resolution": "variable, {} to {} degrees; a cell subdivides while the band inside it varies by "
                  "more than {:.0%} of its peak, or is empty in part, or spans two largest-VEI "
                  "classes. Cell size is display resolution only.".format(FINEST * STEP, COARSEST * STEP, SPREAD),
}


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


_DISCS = {}


def disc(radius_km):
    """Per grid row, the cells within radius_km of a point on that row (cached per radius)."""
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


def survival(z):
    """1 - Phi(z) for a standard normal, vectorised."""
    return 0.5 * (1.0 - np.vectorize(math.erf)(z / math.sqrt(2.0)))


def kernel(lon, lat, vei):
    """Cells within the stamp radius of (lat, lon) and, at each, the chance that an
    eruption of this VEI there deposits at least 1 mm of ash: P(reach >= d)."""
    if not (np.isfinite(lon) and np.isfinite(lat) and abs(lat) <= 90):
        return None, None
    reach = REACH_KM[min(int(vei), 8)]
    rows, cols = disc(reach * math.exp(STAMP_SIGMAS * SIGMA))
    r = int(min(NY - 1, max(0, (90.0 - lat) / STEP)))
    c = int(((lon + 180.0) / STEP) % NX)
    rr = rows[r]
    cc = np.mod(c + cols[r], NX)
    lat2 = np.radians(ROW_LAT[rr])
    lon2 = np.radians(-180.0 + (cc + 0.5) * STEP)
    la, lo = np.radians(lat), np.radians(lon)
    a = np.sin((lat2 - la) / 2) ** 2 + np.cos(la) * np.cos(lat2) * np.sin((lon2 - lo) / 2) ** 2
    d = np.maximum(2 * EARTH_R_KM * np.arcsin(np.sqrt(np.clip(a, 0, 1))), 0.01)
    return rr * NX + cc, survival(np.log(d / reach) / SIGMA)


def quadtree(field, vei_max, extra):
    """The cyclone bake's quadtree over ONE band: blocks merge while the band is
    flat, never while empty in part, never across two largest-VEI classes."""
    limit = SPREAD * float(field.max()) if field.max() > 0 else 0.0
    blocks = []

    def flat(r0, c0, size):
        block = field[r0:r0 + size, c0:c0 + size]
        lo, hi = block.min(), block.max()
        if lo == 0 and hi > 0:
            return False
        v = vei_max[r0:r0 + size, c0:c0 + size]
        return (hi - lo) <= limit and v.min() == v.max()

    def emit(r0, c0, size):
        if size > FINEST and not flat(r0, c0, size):
            half = size // 2
            for dr in (0, half):
                for dc in (0, half):
                    emit(r0 + dr, c0 + dc, half)
            return
        blocks.append((r0, c0, size))

    for r0 in range(0, NY, COARSEST):
        for c0 in range(0, NX, COARSEST):
            emit(r0, c0, COARSEST)

    features = []
    for r0, c0, size in blocks:
        sl = (slice(r0, r0 + size), slice(c0, c0 + size))
        mean = float(field[sl].mean())
        # A CELL NOTHING REACHES IS DRAWN, AS "NONE ON RECORD". Left out, the
        # ocean and the far interiors showed basemap through a hazard map,
        # which reads as a gap rather than as an answer; every cell of the
        # globe carries one, and the key names the class.
        north = 90.0 - r0 * STEP
        south = north - size * STEP
        west = -180.0 + c0 * STEP
        east = west + size * STEP
        # SIGNIFICANT FIGURES, not fixed decimals: a far tail at 3e-8 a year
        # rounded to six decimals is 0.000000, which has no class and drew in
        # the app's no-value grey -- the "grey areas on VEI 3".
        sig = lambda x: float("{:.4g}".format(x)) if x > 0 else 0.0
        props = {
            "i": len(features), "deg": round(size * STEP, 4),
            "rate_yr": sig(mean), "p_yr": sig(1.0 - math.exp(-mean)),
            "vei_max": int(vei_max[sl].max()),
            "none": int(mean <= 0),
        }
        for name, grid in extra.items():
            v = grid[sl]
            props[name] = int(v.max()) if name in ("vents", "prior_only") else round(float(v.mean()), PLACES)
        # prior-only when EVERY lattice point in the block is reached by a prior alone
        props["prior_only"] = int(extra["prior_only"][sl].min() == 1)
        features.append({
            "type": "Feature", "properties": props,
            "geometry": {"type": "Polygon", "coordinates": [[
                [round(west, 4), round(south, 4)], [round(east, 4), round(south, 4)],
                [round(east, 4), round(north, 4)], [round(west, 4), round(north, 4)],
                [round(west, 4), round(south, 4)]]]},
        })
    return features


def write_grid(path, features, mode, band):
    windows = ({k: list(v) for k, v in WINDOWS.items()} if mode == "windowed"
               else "per volcano and size: the size's window where it holds eruptions of that size "
                    "there, else the volcano's own record span (first eruption to 2025)")
    grid = {"type": "FeatureCollection",
            "_source": {**SOURCE, "mode": mode, "band": band, "windows": windows,
                        "measure": ("eruptions of VEI {} per year near the point".format(band[3:])
                                    if band.startswith("vei") else "eruptions of any size per year near the point")
                                   + "; p_yr is 1 - exp(-rate), the chance of at least one in a year"},
            "features": features}
    path.write_text(json.dumps(grid, separators=(",", ":")))
    return path.stat().st_size / 1e6


def main(mode) -> int:
    began = time.time()
    holocene = mode == "holocene"
    print("  fetching the eruption catalogue...")
    feats = fetch_eruptions()
    catalogue = json.load(open(VOLCANOES))["features"] if VOLCANOES.exists() else []
    print("  {:,} eruptions, {:,} catalogue volcanoes ({:.0f}s)".format(
        len(feats), len(catalogue), time.time() - began))

    first_year = {}
    in_window = {}      # (volcano, size class) -> has an eruption of that size inside its window
    for f in feats:
        p = f["properties"]
        if p.get("StartDateYear") is None:
            continue
        vn = str(p.get("Volcano_Number"))
        year = int(p["StartDateYear"])
        first_year[vn] = min(first_year.get(vn, 9999), year)
        cls = size_class(p.get("ExplosivityIndexMax"))
        lo, hi = WINDOWS[cls]
        if lo <= year <= hi:
            in_window[(vn, cls)] = True

    cells = NY * NX
    per_vei = np.zeros((9, cells), dtype=np.float64)
    vei_max = np.zeros(cells, dtype=np.int8)
    vents = {}          # cell -> set of volcano numbers
    prior_cells = np.zeros(cells, dtype=bool)
    record_cells = np.zeros(cells, dtype=bool)
    counted = {"small": 0, "vei4": 0, "vei56": 0, "vei7": 0, "prior": 0}
    uncertain = undated = out_of_window = unknown_vei = 0

    def count(lon, lat, vei_used, vn, weight, cls, is_prior=False):
        hit, k = kernel(lon, lat, vei_used)
        if hit is None:
            return False
        w = k * weight
        per_vei[min(vei_used, 8), hit] += w
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
        lo, hi = WINDOWS[cls]
        if holocene and not in_window.get((vn, cls)):
            # no eruption of this size inside its window at this volcano: the
            # volcano's own span is the only record there is, so it is used
            lo, hi = max(HOLOCENE_START, first_year[vn]), LAST_COMPLETE
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
    for idx, st in vents.items():
        vent_count[idx] = len(st)
    grids = {f"vei{v}": per_vei[v].reshape(NY, NX) for v in VEIS}
    grids["any"] = per_vei.sum(axis=0).reshape(NY, NX)
    vmax = vei_max.reshape(NY, NX)
    extra = {"vents": vent_count.reshape(NY, NX),
             "prior_only": (prior_cells & ~record_cells).astype(np.float32).reshape(NY, NX)}
    stem = STEM[mode]
    # THE COLLECTIVE carries every band's rate as well, so a click on it can
    # list every size at the point; the frames carry their own band alone.
    feats_any = quadtree(grids["any"], vmax, {**extra, **{f"vei{v}": grids[f"vei{v}"] for v in VEIS}})
    mb = write_grid(GLOBAL / f"{stem}.geojson", feats_any, mode, "any")
    print("  any: {:,} cells, {:.1f} MB".format(len(feats_any), mb))
    for v in FRAME_VEIS:
        # A band with nothing in it still gets its file -- every cell "none on
        # record" -- so the VEI 8 frame draws the whole globe in that class and
        # the note says why, rather than the frame being absent.
        feats = quadtree(grids[f"vei{v}"], vmax, extra)
        mb = write_grid(GLOBAL / f"{stem}-vei{v}.geojson", feats, mode, f"vei{v}")
        print("  vei{}: {:,} cells, {:.1f} MB".format(v, len(feats), mb))
    reached = int((grids["any"] > 0).sum())
    print("  {:,} of {:,} lattice cells reached ({:.0f}%), {:,} by a floor prior alone; the rest drawn as none on record".format(
        reached, cells, 100 * reached / cells, int(extra["prior_only"].sum())))

    def at(lat, lon):
        r = int((90.0 - lat) / STEP)
        c = int(((lon + 180.0) / STEP) % NX)
        a = grids["any"][r, c]
        bands = " ".join(f"v{v}:{grids[f'vei{v}'][r, c]:.2g}" for v in VEIS if grids[f"vei{v}"][r, c] > 0)
        return "any {:.4f}/yr (1 in {:,} y) | {} | max {} | {:.0f} vents".format(
            a, int(round(1 / a)) if a > 0 else 0, bands, int(vmax[r, c]), extra["vents"][r, c])
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
