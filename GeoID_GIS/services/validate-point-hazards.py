#!/usr/bin/env python3
"""Do the cyclone, seismic and volcanic risk maps predict what happened NEXT?

The four baked maps are rates counted from a catalogue. Checking a map against
the events it was counted from is circular -- every place it calls dangerous
had an event there by construction -- so each map is REBUILT here from a
TRAINING window that ends at a cutoff, with the bake's own reach law, windows
and weights (the bake modules are imported, not transcribed), and scored
against the events of the years after it, which the rebuilt map never saw.

    score     the training window's annual rate at a point
    positive  the point was reached by >= 1 event in the test window, by the
              bake's own criterion: within RADIUS_KM of a cyclone track; for
              earthquakes and eruptions, inside the median reach (d <= R, i.e.
              P(reach >= d) >= 0.5)
    predicted 1 - exp(-rate * T_test) >= 0.5 -- the Poisson chance of at least
              one event over the test window's length, at evens

WHY A LATTICE AND NOT THE GRID'S CELLS. The published grids are quadtrees:
coarse where the field is flat, a quarter degree where it varies. Counting
cells would let one 8-degree ocean cell weigh as much as one quarter-degree
coastal cell, so every statistic would be partly a statement about the
quadtree. The points are a Fibonacci lattice on the sphere -- equal area per
point -- so each count is an area.

    python3 GeoID_GIS/services/validate-point-hazards.py [--data DIR] [--only cyclone,seismic,volcanic]
                                                         [--fetch-eruptions]

The volcanic maps need the GVP eruption catalogue, which the volcanic bake
fetches live and never keeps. `--fetch-eruptions` makes the bake's own WFS
call once and caches it under data/global/.volcanic-risk-work/ (gitignored).
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import pathlib
import sys
import time

import numpy as np
from scipy.special import erf
from sklearn.neighbors import BallTree

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
import hazard_metrics as hm  # noqa: E402

MAIN_DATA = pathlib.Path("/home/owen/GeoID_webpage_v1/data/global")
EARTH_R_KM = 6371.0088
MIN_POSITIVES = 30          # the NI validator's floor: below it, no verdict


def load_bake(name):
    """A bake module by file name -- `bake-seismic.py` is not an importable name."""
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), HERE / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def default_data():
    local = ROOT / "data" / "global"
    return local if (local / "cyclone-risk.geojson").exists() else MAIN_DATA


def fibonacci(n):
    """n points of equal area on the sphere: (lat, lon) in degrees."""
    i = np.arange(n) + 0.5
    lat = np.degrees(np.arcsin(1 - 2 * i / n))
    lon = (np.degrees(np.pi * (1 + 5 ** 0.5) * i) + 180.0) % 360.0 - 180.0
    return lat, lon


def spacing_km(n):
    return math.sqrt(4 * math.pi * EARTH_R_KM ** 2 / n)


def rad(lat, lon):
    return np.radians(np.column_stack([lat, lon]))


def survival(z):
    """1 - Phi(z): the bakes' own expression, with SciPy's erf for speed."""
    return 0.5 * (1.0 - erf(z / math.sqrt(2.0)))


def assess(score, positive, t_test, extra=None):
    """The report at the Poisson-evens threshold, plus Youden's corner."""
    pairs = list(zip(score.tolist(), positive.tolist()))
    n_pos = int(positive.sum())
    # rate at which P(>=1 in T) = 0.5
    threshold = math.log(2.0) / t_test
    rule = "predicted when 1 - exp(-rate x {:g} yr) >= 0.5, i.e. rate >= {:.4g}/yr".format(t_test, threshold)
    if n_pos < MIN_POSITIVES:
        return {"assessable": False, "verdict": "NOT ASSESSABLE",
                "message": "{} positive points in the test window; the floor is {}".format(n_pos, MIN_POSITIVES),
                "positives": n_pos, "negatives": int(len(positive) - n_pos), "threshold_rule": rule,
                "extra": extra or {}}
    out = hm.report(pairs, threshold, rule)
    y = hm.youden(pairs)
    yc = hm.confusion(pairs, y) if y is not None else None
    out["assessable"] = True
    out["extra"] = dict(extra or {})
    if yc:
        out["extra"]["youden"] = {k: yc[k] for k in ("threshold", "tp", "fp", "tn", "fn", "accuracy",
                                                    "precision", "recall", "f1", "kappa")}
    return out


def pairs_within(tree, lat, lon, radius_km):
    """(event index, point index, distance km) for every point within radius of each event."""
    ind, dist = tree.query_radius(rad(lat, lon), r=radius_km / EARTH_R_KM, return_distance=True)
    lens = np.fromiter((len(a) for a in ind), dtype=np.int64, count=len(ind))
    if not lens.sum():
        return np.empty(0, np.int64), np.empty(0, np.int64), np.empty(0)
    ev = np.repeat(np.arange(len(ind)), lens)
    return ev, np.concatenate(ind).astype(np.int64), np.concatenate(dist) * EARTH_R_KM


def haversine_km(lat1, lon1, lat2, lon2):
    la1, lo1, la2, lo2 = map(np.radians, (lat1, lon1, lat2, lon2))
    a = np.sin((la2 - la1) / 2) ** 2 + np.cos(la1) * np.cos(la2) * np.sin((lo2 - lo1) / 2) ** 2
    return 2 * EARTH_R_KM * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


# ── cyclones: the published grid's own per-season counts ───────────────────

def validate_cyclone(data, cutoff=2009, n_points=40000):
    bake = load_bake("bake-cyclone-risk")
    grid = json.load(open(data / "cyclone-risk.geojson"))
    years = json.load(open(data / "cyclone-risk-years.json"))
    src = grid["_source"]
    first, partial = years["_source"]["from"], years["_source"].get("partial")
    seasons = sorted(int(y) for y in years["years"] if int(y) != partial)
    train = [y for y in seasons if first <= y <= cutoff]
    test = [y for y in seasons if y > cutoff]

    # Cell index on the bake's quarter-degree lattice, from each cell's own box.
    cell = np.full((bake.NY, bake.NX), -1, dtype=np.int32)
    feats = grid["features"]
    centres = []
    for f in feats:
        ring = f["geometry"]["coordinates"][0]
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        c0 = int(round((min(xs) + 180.0) / bake.STEP))
        c1 = int(round((max(xs) + 180.0) / bake.STEP))
        r0 = int(round((90.0 - max(ys)) / bake.STEP))
        r1 = int(round((90.0 - min(ys)) / bake.STEP))
        cell[r0:r1, c0:c1] = f["properties"]["i"]
        centres.append(((max(ys) + min(ys)) / 2, (max(xs) + min(xs)) / 2))
    n_cells = len(feats)
    train_sum = np.zeros(n_cells)
    test_sum = np.zeros(n_cells)
    for y in train:
        for k, v in years["years"][str(y)].items():
            train_sum[int(k)] += v
    for y in test:
        for k, v in years["years"][str(y)].items():
            test_sum[int(k)] += v

    lat, lon = fibonacci(n_points)
    # The domain: within 500 km of ground any storm reached in the whole record
    # -- the basins and their margins. The rest of the planet is a true negative
    # the map gets right by doing nothing, and would only inflate accuracy.
    ctree = BallTree(rad(*np.array(centres).T), metric="haversine")
    near = ctree.query_radius(rad(lat, lon), r=500.0 / EARTH_R_KM, count_only=True) > 0
    lat, lon = lat[near], lon[near]
    r = np.clip(((90.0 - lat) / bake.STEP).astype(int), 0, bake.NY - 1)
    c = (((lon + 180.0) / bake.STEP).astype(int)) % bake.NX
    idx = cell[r, c]
    has = idx >= 0
    score = np.where(has, train_sum[np.maximum(idx, 0)] / len(train), 0.0)
    positive = has & (test_sum[np.maximum(idx, 0)] > 0)

    v = assess(score, positive, len(test), {
        "train_seasons": [train[0], train[-1]], "test_seasons": [test[0], test[-1]],
        "lattice_points": int(len(lat)), "lattice_spacing_km": round(spacing_km(n_points), 1)})
    v.update({
        "holdout": "temporal: rates from the {}-{} seasons ({}), scored against storms of {}-{} ({} complete "
                   "seasons the training never saw)".format(train[0], train[-1], len(train), test[0], test[-1], len(test)),
        "events": "IBTrACS v04r01 storms within {:g} km, read from the published grid's own per-season counts "
                  "(cyclone-risk-years.json)".format(bake.RADIUS_KM),
        "sample": "{:,} equal-area Fibonacci-lattice points ({:.0f} km apart) within 500 km of any ground a storm "
                  "reached 1980-{}; each takes the published cell it falls in".format(
                      int(len(lat)), spacing_km(n_points), seasons[-1]),
    })
    return {
        "id": "cyclone-risk", "name": "Cyclone risk", "hazard": "tropical cyclone",
        "product": "data/global/cyclone-risk.geojson (+ cyclone-risk-years.json)",
        "model": {
            "method": "Poisson rate of distinct storms passing within a fixed radius of a point, over complete "
                      "seasons; p_yr = 1 - exp(-rate)",
            "parameters": {"radius_km": bake.RADIUS_KM, "first_season": bake.FIRST_SEASON,
                           "hurricane_kts": bake.HURRICANE_KTS, "lattice_deg": bake.STEP,
                           "track_densify_km": bake.LEG_KM, "quadtree_deg": [bake.FINEST * bake.STEP, bake.COARSEST * bake.STEP],
                           "quadtree_spread": bake.SPREAD, "seasons_in_map": src.get("seasons")},
            "inputs": [{"name": src["dataset"], "publisher": src.get("publisher"), "citation": src.get("citation")}],
            "grid": src.get("resolution"),
        },
        "validation": v,
        "limits": [
            "Per-season counts are cell means: in a coarse (flat) cell a lattice point is called reached when "
            "any part of the cell was, which flatters recall there.",
            "Lattice points are spatially autocorrelated (one storm reaches dozens), so n overstates the "
            "number of independent tests; read AUC and the rates, not significance.",
            "A 30-season training window is short for the rarest basins' edges; a storm track's year-to-year "
            "shift (ENSO, basin activity) is real variance the map cannot know.",
        ],
        "script": "GeoID_GIS/services/validate-point-hazards.py",
    }


# ── earthquakes: re-stamped from the bake's own columns ────────────────────

def validate_seismic(data, cutoff=2005, n_points=200000):
    bake = load_bake("bake-seismic")
    cols_path = data / ".seismic-work" / "events.npy"
    if not cols_path.exists():
        raise SystemExit(f"no {cols_path}: run bake-seismic.py once to leave its columns")
    cols = np.load(cols_path)
    lon_a, lat_a, mag_a, year_a, hist_a = (cols[:, i] for i in range(5))
    keep = (hist_a == 0) & np.isfinite(lon_a) & np.isfinite(lat_a) & (np.abs(lat_a) <= 90) \
        & (year_a > -9000) & (mag_a >= bake.BANDS["m5"][0])
    lon_a, lat_a, mag_a, year_a = lon_a[keep], lat_a[keep], mag_a[keep], year_a[keep]
    last = bake.LAST_COMPLETE

    lat, lon = fibonacci(n_points)
    tree = BallTree(rad(lat, lon), metric="haversine")
    rate = np.zeros(n_points)
    reached = np.zeros(n_points, dtype=bool)

    # TRAINING: each band's window, cut at the cutoff; the bake's kernel, the
    # bake's stamp truncation, the bake's per-year normalisation.
    train_windows = {b: (lo, min(hi, cutoff)) for b, (lo, hi) in bake.WINDOWS.items()}
    bands = np.array([bake.band_of(m) or "" for m in mag_a])
    lo_y = np.array([train_windows.get(b, (1e9, 0))[0] for b in bands])
    hi_y = np.array([train_windows.get(b, (1e9, 0))[1] for b in bands])
    tr = (year_a >= lo_y) & (year_a <= hi_y)
    radii = np.array([bake.stamp_radius(m) for m in mag_a])
    for rr_km in np.unique(radii[tr]):
        sel = np.flatnonzero(tr & (radii == rr_km))
        ev, pt, d = pairs_within(tree, lat_a[sel], lon_a[sel], rr_km)
        if not len(ev):
            continue
        k = sel[ev]
        d = np.maximum(d, 0.01)
        w = survival(np.log(d / bake.reach_km(mag_a[k])) / bake.SIGMA) / (hi_y[k] - lo_y[k] + 1)
        np.add.at(rate, pt, w)
    n_train = int(tr.sum())

    # TEST: every M >= 5 after the cutoff, reaching a point inside its median reach.
    te = (year_a > cutoff) & (year_a <= last)
    reach = bake.reach_km(np.round(mag_a / bake.MAG_BIN) * bake.MAG_BIN)
    for rk in np.unique(reach[te]):
        sel = np.flatnonzero(te & (reach == rk))
        _, pt, _ = pairs_within(tree, lat_a[sel], lon_a[sel], rk)
        reached[pt] = True
    t_test = last - cutoff

    active = rate > 0
    v = assess(rate, reached, t_test, {
        "train_events": n_train, "test_events": int(te.sum()), "test_years": [cutoff + 1, last],
        "lattice_points": n_points, "lattice_spacing_km": round(spacing_km(n_points), 1),
        "active_ground_only": {k: val for k, val in hm.report(
            list(zip(rate[active].tolist(), reached[active].tolist())), math.log(2) / t_test,
            "same threshold, only where the training map is non-zero").items()
            if k in ("n", "auc", "accuracy", "precision", "recall", "f1", "kappa")},
    })
    v.update({
        "holdout": "temporal: rates re-stamped from events up to {} (each band's own completeness window "
                   "cut there: {}), scored against the {:,} M>=5 events of {}-{}".format(
                       cutoff, ", ".join(f"{b} {a}-{z}" for b, (a, z) in train_windows.items()),
                       int(te.sum()), cutoff + 1, last),
        "events": "the merged ComCat/ISC-GEM record (bake-seismic.py's own columns); a point is reached "
                  "when a test event lies inside its median damaging-shaking radius, d <= 10^(0.5M - 1.7) km",
        "sample": "{:,} equal-area Fibonacci-lattice points over the whole globe ({:.0f} km apart). Stable "
                  "interiors and open ocean are true negatives the map gets right for free, which inflates "
                  "accuracy and specificity -- active_ground_only repeats the scores where the training "
                  "map is non-zero".format(n_points, spacing_km(n_points)),
    })
    meta = {}
    try:
        with open(data / "seismic-risk.geojson") as fh:
            head = fh.read(6000)
        meta = json.loads(head[head.index('"_source":') + 10: head.index(',"features"')])
    except (OSError, ValueError):
        meta = bake.SOURCE
    return {
        "id": "seismic-risk", "name": "Seismic risk", "hazard": "earthquake shaking",
        "product": "data/global/seismic-risk.geojson (+ -m5..-m8 bands)",
        "model": {
            "method": "catalogue rate of earthquakes per magnitude band shaking a point at about MMI VI, each "
                      "event weighted by P(reach >= d) under a log-normal reach; summed over bands",
            "parameters": {"reach_law": "log10(R_km) = 0.5 M - 1.7", "sigma": bake.SIGMA,
                           "stamp": f"R exp({bake.STAMP_SIGMAS} sigma)", "magnitude_bin": bake.MAG_BIN,
                           "bands": {k: list(v) for k, v in bake.BANDS.items()},
                           "windows": {k: list(v) for k, v in bake.WINDOWS.items()},
                           "min_magnitude": bake.BANDS["m5"][0], "lattice_deg": bake.STEP,
                           "quadtree_spread": bake.SPREAD},
            "inputs": [{"name": meta.get("dataset", bake.SOURCE["dataset"]),
                        "citation": meta.get("citation", bake.SOURCE["citation"]),
                        "licence": meta.get("licence", bake.SOURCE["licence"])}],
            "grid": meta.get("resolution", bake.SOURCE["resolution"]),
        },
        "validation": v,
        "limits": [
            "Isotropic and depth-blind reach: attenuation differs by region and with depth, so a deep or "
            "stable-crust event is mis-sized either way.",
            "Twenty test years is short against M7+ recurrence; most positives come from M5-6 events, which "
            "is what the score mostly rewards.",
            "Aftershock sequences are not declustered, in training or test: a sequence counts many times, "
            "and it recurs where it trained, which flatters the hold-out.",
            "Lattice points are spatially autocorrelated; n is not the number of independent tests.",
        ],
        "script": "GeoID_GIS/services/validate-point-hazards.py",
    }


# ── eruptions: the volcanic bake's own counting, cut at a year ──────────────

def eruptions_cache(data):
    return data / ".volcanic-risk-work" / "eruptions.json"


def validate_volcanic(data, mode, cutoff=1999, n_points=1_300_000, domain_km=200.0):
    bake = load_bake("bake-volcanic-risk")
    cache = eruptions_cache(data)
    if not cache.exists():
        raise FileNotFoundError(f"{cache} (run with --fetch-eruptions)")
    feats = json.load(open(cache))
    catalogue = json.load(open(data / "volcanoes.geojson"))["features"]
    holocene = mode == "holocene"
    last = bake.LAST_COMPLETE

    # The bake's windows, cut at the cutoff (the Holocene window keeps its start).
    windows = {k: (lo, min(hi, cutoff)) for k, (lo, hi) in bake.WINDOWS.items()}
    first_year, in_window = {}, {}
    for f in feats:
        p = f["properties"]
        y = p.get("StartDateYear")
        if y is None or int(y) > cutoff:
            continue
        vn = str(p.get("Volcano_Number"))
        first_year[vn] = min(first_year.get(vn, 9999), int(y))
        cls = bake.size_class(p.get("ExplosivityIndexMax"))
        lo, hi = windows[cls]
        if lo <= int(y) <= hi:
            in_window[(vn, cls)] = True

    # Rows to stamp: (lat, lon, vei, weight per year).
    rows, seen = [], set()
    test = []
    for f in feats:
        p = f["properties"]
        y = p.get("StartDateYear")
        coords = (f.get("geometry") or {}).get("coordinates") or [None, None]
        if y is None or coords[0] is None:
            continue
        y = int(y)
        vei = p.get("ExplosivityIndexMax")
        vei_used = bake.UNKNOWN_VEI_AS if vei is None else int(vei)
        confirmed = p.get("Activity_Type") == "Confirmed Eruption"
        if cutoff < y <= last:
            if confirmed:
                test.append((coords[1], coords[0], vei_used))
            continue
        cls = bake.size_class(vei)
        vn = str(p.get("Volcano_Number"))
        lo, hi = windows[cls]
        if holocene and not in_window.get((vn, cls)):
            lo, hi = max(bake.HOLOCENE_START, first_year[vn]), cutoff
        if y < lo or y > hi:
            continue
        rows.append((coords[1], coords[0], vei_used,
                     (1.0 if confirmed else bake.UNCERTAIN_WEIGHT) / (hi - lo + 1)))
        seen.add(vn)
    for name, la, lo in bake.VEI8_SOURCES:
        rows.append((la, lo, 8, 1.0 / (bake.VEI8_RETURN_YEARS * len(bake.VEI8_SOURCES))))
    n_prior = 0
    for f in catalogue:
        p = f["properties"]
        if str(p.get("gvp_number")) in seen:
            continue
        c = (f.get("geometry") or {}).get("coordinates") or [None, None]
        if c[0] is None:
            continue
        kind = "holocene" if str(p.get("epoch", "")).lower().startswith("holocene") else "pleistocene"
        rows.append((c[1], c[0], bake.PRIOR[kind]["vei"], 1.0 / bake.PRIOR[kind]["span"]))
        n_prior += 1
    R = np.array(rows, dtype=np.float64)

    # Lattice, kept within domain_km of a catalogue volcano: a 15 km VEI 2 reach
    # needs points ~20 km apart to be seen at all, and a global lattice that
    # fine would be millions of points of open ocean.
    lat, lon = fibonacci(n_points)
    vol = np.array([(f["geometry"]["coordinates"][1], f["geometry"]["coordinates"][0]) for f in catalogue
                    if (f.get("geometry") or {}).get("coordinates")])
    vtree = BallTree(np.radians(vol), metric="haversine")
    near = vtree.query_radius(rad(lat, lon), r=domain_km / EARTH_R_KM, count_only=True) > 0
    lat, lon = lat[near], lon[near]
    tree = BallTree(rad(lat, lon), metric="haversine")
    rate = np.zeros(len(lat))
    vei_r = R[:, 2].astype(int)
    for v in np.unique(vei_r):
        sel = np.flatnonzero(vei_r == v)
        reach = bake.REACH_KM[min(int(v), 8)]
        if v >= bake.GLOBAL_FROM_VEI:
            # The bake stamps these over the whole globe; so does this, in chunks.
            for k in sel:
                d = np.maximum(haversine_km(R[k, 0], R[k, 1], lat, lon), 0.01)
                rate += R[k, 3] * survival(np.log(d / reach) / bake.SIGMA)
        else:
            ev, pt, d = pairs_within(tree, R[sel, 0], R[sel, 1], reach * math.exp(bake.STAMP_SIGMAS * bake.SIGMA))
            if len(ev):
                d = np.maximum(d, 0.01)
                np.add.at(rate, pt, R[sel[ev], 3] * survival(np.log(d / reach) / bake.SIGMA))

    T = np.array(test, dtype=np.float64).reshape(-1, 3)
    reached = np.zeros(len(lat), dtype=bool)
    reached_small = np.zeros(len(lat), dtype=bool)
    reached_large = np.zeros(len(lat), dtype=bool)
    for v in np.unique(T[:, 2].astype(int)):
        sel = np.flatnonzero(T[:, 2].astype(int) == v)
        _, pt, _ = pairs_within(tree, T[sel, 0], T[sel, 1], bake.REACH_KM[min(int(v), 8)])
        reached[pt] = True
        (reached_small if v <= 3 else reached_large)[pt] = True
    t_test = last - cutoff
    by_size = {}
    for label, pos in (("VEI <= 3 (and unknown, as 2)", reached_small), ("VEI >= 4", reached_large)):
        npos = int(pos.sum())
        if npos < MIN_POSITIVES:
            by_size[label] = {"verdict": "NOT ASSESSABLE", "positives": npos}
        else:
            r = hm.report(list(zip(rate.tolist(), pos.tolist())), math.log(2) / t_test, "Poisson evens")
            by_size[label] = {k: r[k] for k in ("positives", "auc", "accuracy", "precision", "recall", "f1")}
    v = assess(rate, reached, t_test, {
        "train_rows": int(len(R)), "floor_priors": n_prior, "test_eruptions": int(len(T)),
        "test_years": [cutoff + 1, last], "lattice_points": int(len(lat)),
        "lattice_spacing_km": round(spacing_km(n_points), 1), "by_test_size": by_size})
    v.update({
        "holdout": "temporal: rates rebuilt from eruptions up to {} ({} mode; windows {}), scored against "
                   "the {:,} confirmed eruptions of {}-{}".format(
                       cutoff, mode, ", ".join(f"{k} {a}-{z}" for k, (a, z) in windows.items()),
                       len(T), cutoff + 1, last),
        "events": "GVP Volcanoes of the World, confirmed eruptions; a point is reached when it lies inside "
                  "the eruption's median 1 mm ash reach, R by VEI",
        "sample": "{:,} equal-area Fibonacci-lattice points ({:.0f} km apart) within {:g} km of a catalogue "
                  "volcano".format(int(len(lat)), spacing_km(n_points), domain_km),
    })
    stem = bake.STEM[mode]
    return {
        "id": stem, "name": "Volcanic risk" + (" (full Holocene record)" if holocene else ""),
        "hazard": "volcanic ash fall",
        "product": f"data/global/{stem}.geojson (+ -vei1..-vei8 frames)",
        "model": {
            "method": "eruptions per year depositing >= 1 mm of ash at a point, each eruption weighted by "
                      "P(reach >= d) under a log-normal reach per VEI; windows by size class"
                      + ("; where a volcano has no eruption of a size inside its window, its own record span"
                         if holocene else ""),
            "parameters": {"reach_km_by_vei": bake.REACH_KM, "sigma": bake.SIGMA,
                           "stamp": f"VEI < {bake.GLOBAL_FROM_VEI} to R exp({bake.STAMP_SIGMAS} sigma); "
                                    f"VEI >= {bake.GLOBAL_FROM_VEI} global",
                           "windows": {k: list(v) for k, v in bake.WINDOWS.items()},
                           "uncertain_weight": bake.UNCERTAIN_WEIGHT, "unknown_vei_as": bake.UNKNOWN_VEI_AS,
                           "floor_prior": bake.PRIOR, "vei8_return_years": bake.VEI8_RETURN_YEARS,
                           "mode": mode, "lattice_deg": bake.STEP, "quadtree_spread": bake.SPREAD},
            "inputs": [{"name": bake.SOURCE["dataset"], "citation": bake.SOURCE["citation"]}],
            "grid": bake.SOURCE["resolution"],
        },
        "validation": v,
        "limits": [
            "Isotropic ash: a plume goes downwind, so the reach disc is wrong in shape for every real "
            "eruption, and recall/precision read that as misses and false alarms.",
            "An eruption in GVP is an episode: a volcano erupting through the cutoff (Etna, Sakurajima) "
            "trains and tests on the same activity, which flatters the hold-out.",
            "The test eruptions are dominated by VEI <= 2, whose reach is a few lattice spacings; most of "
            "the map's large-VEI reach is never tested in 26 years.",
            "Lattice points are spatially autocorrelated; n is not the number of independent tests.",
        ],
        "script": "GeoID_GIS/services/validate-point-hazards.py",
    }


def summary(entry):
    v = entry["validation"]
    if not v.get("assessable", True) and v.get("verdict"):
        return f"{entry['id']}: {v['verdict']} ({v.get('message')})"
    return "{}: AUC {} | acc {} prec {} rec {} F1 {} kappa {} | n {} ({} positive)".format(
        entry["id"], v["auc"], v["accuracy"], v["precision"], v["recall"], v["f1"], v["kappa"],
        v["n"], v["positives"])


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--data", type=pathlib.Path, default=None)
    ap.add_argument("--only", default="cyclone,seismic,volcanic")
    ap.add_argument("--fetch-eruptions", action="store_true",
                    help="make the volcanic bake's own GVP WFS call once and cache it")
    args = ap.parse_args()
    data = args.data or default_data()
    only = set(args.only.split(","))
    print(f"  data: {data}")
    began = time.time()
    if "cyclone" in only:
        e = validate_cyclone(data)
        hm.write_entry(e)
        print("  " + summary(e), f"({time.time() - began:.0f}s)", flush=True)
    if "seismic" in only:
        e = validate_seismic(data)
        hm.write_entry(e)
        print("  " + summary(e), f"({time.time() - began:.0f}s)", flush=True)
    if "volcanic" in only:
        cache = eruptions_cache(data)
        if args.fetch_eruptions and not cache.exists():
            cache.parent.mkdir(parents=True, exist_ok=True)
            feats = load_bake("bake-volcanic-risk").fetch_eruptions()
            cache.write_text(json.dumps(feats))
            print(f"  cached {len(feats):,} eruptions -> {cache}")
        if not cache.exists():
            print(f"  volcanic: skipped -- no eruption catalogue at {cache}; run with --fetch-eruptions")
        else:
            for mode in ("windowed", "holocene"):
                e = validate_volcanic(data, mode)
                hm.write_entry(e)
                print("  " + summary(e), f"({time.time() - began:.0f}s)", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
