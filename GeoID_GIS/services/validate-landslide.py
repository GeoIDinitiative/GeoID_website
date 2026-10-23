#!/usr/bin/env python3
"""The landslide susceptibility map, validated against the BGS National
Landslide Database on ground it was not tuned on.

The map is GeoHUB's Recipe A (docs/ni-prototype/methodology.md, run by
recipe.mjs): an expert-weighted overlay of slope, bedrock lithology, rainfall
and drainage proximity, floored below 2 degrees of slope and capped below 5,
ranked into quantile classes so that High + Very High is the worst 30% of the
ground. Nothing in it is fitted, EXCEPT the slope gate and the quantile classes,
which were chosen because they raised the South Wales success-rate AUC from
0.826 to 0.841. Scoring it on South Wales again would be scoring it on its own
tuning set, so the headline is the SPATIAL HOLD-OUT: the landslides of Mid and
North Wales (north of 51.95 N), which played no part in any choice. South
Wales is reported beside it for continuity with the acceptance report.

The recipe is transcribed here from recipe.mjs -- same breaks, same weights,
same gate, same quantile shares -- onto the flood bake's common grid
(bake-flood-rf.py: same DEM, same rainfall interpolation, same mask), so both
Welsh maps are validated on one stack.

    python3 GeoID_GIS/services/validate-landslide.py      (after bake-flood-rf.py has built its stack)

Confusion matrix: predicted positive = class >= 4 (High or Very High, the
methodology's own criterion). Negatives are an equal number of land cells
drawn at random (seed 1) from cells holding no inventoried slide: an inventory
records failures and never the slopes that held, so the absences are sampled,
and 1:1 makes accuracy, precision and F1 readable as balanced figures.
"""
import importlib.util
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hazard_metrics  # noqa: E402

spec = importlib.util.spec_from_file_location("bake_flood_rf", os.path.join(os.path.dirname(__file__), "bake-flood-rf.py"))
F = importlib.util.module_from_spec(spec)
spec.loader.exec_module(F)

HOLDOUT_LAT = 51.95
SLOPE_BREAKS = [(0, 5, 1), (5, 12, 2), (12, 20, 3), (20, 30, 4), (30, 90, 5)]
RAIN_BREAKS = [(0, 900, 1), (900, 1100, 2), (1100, 1300, 3), (1300, 1600, 4), (1600, 4000, 5)]
DIST_BREAKS = [(0, 50, 5), (50, 100, 4), (100, 250, 3), (250, 500, 2), (500, 1e9, 1)]
WEIGHTS = {"slope": 0.35, "lithology": 0.25, "rainfall": 0.15, "drainage": 0.10}
QUANTILE_SHARES = [0.35, 0.20, 0.15, 0.20, 0.10]


def reclass(arr, breaks):
    out = np.full(arr.shape, np.nan, np.float32)
    for lo, hi, v in breaks:
        out[(arr >= lo) & (arr < hi)] = v
    return out


def lithology_score(rcs):
    """recipe.mjs lithologyScore(), verbatim in regex order."""
    import re
    t = str(rcs or "").upper()
    if not t:
        return 3
    if re.search(r"MUDSTONE, CHERT|SMECTITE|CLAYSTONE", t):
        return 5
    if re.search(r"^MUDSTONE|MUDSTONE, SILTSTONE|MUDSTONE AND |SHALE", t):
        return 5
    if re.search(r"MAFIC LAVA|MAFIC TUFF|MAFIC IGNEOUS", t):
        return 4
    if re.search(r"LIMESTONE, MUDSTONE|MUDSTONE, SILTSTONE, LIMESTONE|SILTSTONE AND MUDSTONE", t):
        return 4
    if re.search(r"SANDSTONE, SILTSTONE AND MUDSTONE|SANDSTONE, MUDSTONE", t):
        return 4
    if re.search(r"WACKE|PSAMMITE|SEMIPELITE|PELITE|SCHIST|GNEISS", t):
        return 3
    if re.search(r"CHALK|LIMESTONE|SANDSTONE|CONGLOMERATE|METALIMESTONE|QUARTZITE", t):
        return 2
    if re.search(r"FELSIC|GRANITE|GABBRO|DOLERITE|INTRUSI|MICROGRANITE|SYENITE", t):
        return 1
    return 3


def fetch_bedrock():
    feats, offset, b = [], 0, F.BOUNDS
    while True:
        url = ("https://ogcapi.bgs.ac.uk/collections/bgsgeology625kbedrock/items"
               f"?bbox={b['minX']},{b['minY']},{b['maxX']},{b['maxY']}&limit=1000&offset={offset}&f=json")
        page = json.loads(F.cached(f"bgs625k_bedrock_{offset}.json", url).read_text())
        feats += page["features"]
        if len(page["features"]) < 1000:
            return feats
        offset += 1000


def fetch_inventory():
    feats, offset, b = [], 0, F.BOUNDS
    while True:
        url = ("https://ogcapi.bgs.ac.uk/collections/landslideindex/items"
               f"?bbox={b['minX']},{b['minY']},{b['maxX']},{b['maxY']}&limit=1000&offset={offset}&f=json")
        page = json.loads(F.cached(f"bgs_nld_{offset}.json", url).read_text())
        feats += page["features"]
        if len(page["features"]) < 1000:
            return feats
        offset += 1000


def quantile_classes(index, mask):
    vals = np.sort(index[mask & np.isfinite(index)])
    breaks, acc = [], 0.0
    for s in QUANTILE_SHARES[:-1]:
        acc += s
        breaks.append(vals[min(len(vals) - 1, int(acc * len(vals)))])
    cls = np.full(index.shape, np.nan, np.float32)
    ok = mask & np.isfinite(index)
    cls[ok] = len(QUANTILE_SHARES)
    for b in range(len(breaks) - 1, -1, -1):
        cls[ok & (index <= breaks[b])] = b + 1
    return cls, [float(b) for b in breaks]


def main():
    z = np.load(F.WORK / "stack.npz", allow_pickle=True)
    mask = z["mask"]
    slope, rain, dist = z["slope_deg"], z["rain_normal_mm"], z["channel_distance_m"]
    bedrock = fetch_bedrock()
    lith = F.rasterise(bedrock, lambda f: lithology_score(f["properties"].get("rcs_d")), fill=0).astype(np.float32)
    lith_gap = mask & (lith == 0)
    lith[lith == 0] = np.nan
    lith = F.fill_nearest(lith, mask, "lithology", "cells between BGS 625k bedrock polygons at the coast")
    factors = {"slope": reclass(slope, SLOPE_BREAKS), "lithology": lith,
               "rainfall": reclass(rain, RAIN_BREAKS), "drainage": reclass(dist, DIST_BREAKS)}
    total = sum(WEIGHTS.values())
    index = sum(WEIGHTS[k] * factors[k] for k in WEIGHTS) / total
    index = np.where(slope < 2, 1.0, np.where(slope < 5, np.minimum(index, 2.5), index))   # the slope gate
    index[~mask] = np.nan
    cls, breaks = quantile_classes(index, mask)

    lons, lats = F.cell_centres()
    inv = fetch_inventory()
    rows, cols, north = [], [], []
    for f in inv:
        x, y = f["geometry"]["coordinates"][:2]
        c = int((x - F.BOUNDS["minX"]) / F.D_LON)
        r = int((F.BOUNDS["maxY"] - y) / F.D_LAT)
        if 0 <= r < F.H and 0 <= c < F.W and mask[r, c]:
            rows.append(r)
            cols.append(c)
            north.append(y >= HOLDOUT_LAT)
    rows, cols, north = np.array(rows), np.array(cols), np.array(north)
    slide_cells = np.zeros(mask.shape, bool)
    slide_cells[rows, cols] = True
    rng = np.random.default_rng(1)

    def score(sel, region):
        # absences from the same region, cells with no slide, as many as slides
        region_mask = mask & ~slide_cells & ((lats >= HOLDOUT_LAT) if region == "north" else (lats < HOLDOUT_LAT))
        cand = np.flatnonzero(region_mask.ravel())
        neg = rng.choice(cand, sel.sum(), replace=False)
        pos_cls = cls[rows[sel], cols[sel]]
        neg_cls = cls.ravel()[neg]
        pos_idx = index[rows[sel], cols[sel]]
        neg_idx = index.ravel()[neg]
        pairs_cls = [(v, 1) for v in pos_cls] + [(v, 0) for v in neg_cls]
        rep = hazard_metrics.report(pairs_cls, 4, "class >= 4 (High + Very High, the worst 30% of the ground by "
                                                  "quantile construction) is 'predicted landslide'")
        rep["auc"] = hazard_metrics.roc_auc([(v, 1) for v in pos_idx] + [(v, 0) for v in neg_idx])
        region_cells = cls[(lats >= HOLDOUT_LAT) if region == "north" else (lats < HOLDOUT_LAT)]
        region_cells = region_cells[np.isfinite(region_cells)]
        rep["share_of_slides_in_high_classes"] = round(float((pos_cls >= 4).mean()), 4)
        rep["share_of_area_in_high_classes"] = round(float((region_cells >= 4).mean()), 4)
        sr = hazard_metrics.roc([(v, 1) for v in pos_idx] + [(v, 0) for v in index[region_mask & np.isfinite(index)][::7]])
        rep["success_rate_auc"] = sr["auc"]
        return rep

    held = score(north, "north")
    south = score(~north, "south")
    held.update({
        "holdout": f"spatial: {int(north.sum())} inventoried slides in Mid and North Wales (north of "
                   f"{HOLDOUT_LAT} N), ground that played no part in choosing the slope gate or the class rule",
        "events": "BGS National Landslide Database, Wales (OGL); absences sampled 1:1 from cells with no record",
        "extra": {"south_wales_tuning_region": {k: south[k] for k in
                                               ("n", "tp", "fp", "tn", "fn", "accuracy", "precision", "recall",
                                                "f1", "kappa", "auc", "share_of_slides_in_high_classes",
                                                "share_of_area_in_high_classes")},
                  "south_wales_slides": int((~north).sum()),
                  "acceptance_criterion": ">= 70% of slides in High + Very High, those classes <= 30% of area",
                  "criterion_met_holdout": bool(held["share_of_slides_in_high_classes"] >= 0.70
                                                and held["share_of_area_in_high_classes"] <= 0.305)},
    })
    say = print
    say("held-out (Mid/North Wales):", {k: held[k] for k in ("n", "auc", "accuracy", "precision", "recall", "f1",
                                                             "share_of_slides_in_high_classes")})
    say("tuning region (South Wales):", held["extra"]["south_wales_tuning_region"])
    F.FILLS["lithology"]["cells"] = int(lith_gap.sum())
    entry = {
        "id": "landslide-susceptibility",
        "name": "Landslide susceptibility (Recipe A, ranked classes)",
        "hazard": "landslide",
        "product": "ni-prototype/data/ni_landslide_susceptibility_quantile.tif (NI), validated on Wales",
        "model": {
            "method": "Weighted overlay of reclassified factors (1-5), slope-gated, ranked into quantile classes "
                      "(docs/ni-prototype/methodology.md Recipe A; recipe.mjs)",
            "parameters": {"weights": WEIGHTS, "weights_renormalised_over": total,
                           "slope_classes_deg": "0-5:1, 5-12:2, 12-20:3, 20-30:4, >30:5",
                           "rainfall_classes_mm": "<900:1, 900-1100:2, 1100-1300:3, 1300-1600:4, >1600:5",
                           "drainage_classes_m": "<50:5, 50-100:4, 100-250:3, 250-500:2, >500:1",
                           "lithology": "BGS 625k rcs_d scored 1-5 by recipe.mjs lithologyScore()",
                           "slope_gate": "index = 1 below 2°, capped at 2.5 below 5°",
                           "quantile_shares": QUANTILE_SHARES, "quantile_breaks_wales": breaks,
                           "land_cover": "not used (CORINE not fetched); weights renormalise over the four"},
            "inputs": [
                {"name": "Elevation and slope", "source": "Terrarium DEM, the flood bake's common grid"},
                {"name": "Bedrock geology", "source": "BGS Geology 625k (OGL; Contains British Geological Survey materials © UKRI)"},
                {"name": "Rainfall", "source": "Met Office HadUK-Grid 1991-2020 annual normals, IDW (OGL)"},
                {"name": "Drainage", "source": "channels draining >= 2 km² on the DEM (recipe.mjs uses OSM waterways)"},
                {"name": "Landslide inventory", "source": "BGS National Landslide Database index (OGL)"},
            ],
            "grid": f"{F.W} x {F.H} cells of {F.D_LON} x {F.D_LAT} deg (~{F.MX:.0f} m); recipe.mjs ran at 100 m",
            "gap_fills": {k: F.FILLS[k] for k in ("lithology", "rain_normal_mm", "slope_deg") if k in F.FILLS},
        },
        "validation": held,
        "limits": [
            "THE RECIPE DOES NOT TRANSFER NORTH. 59% of the Mid/North Wales slides sit on cells under 5° at this "
            "grid (stream-bank and coastal slides in Ceredigion and the till cliffs), against 16% in South Wales, "
            "so the slope gate -- tuned on South Wales valley sides -- floors most of them. The South Wales figure "
            "reproduces the acceptance report; the held-out figure is the one to believe outside it.",
            "The lithology factor barely discriminates in Wales: the Lower Palaeozoic 'MUDSTONE, SILTSTONE AND "
            "SANDSTONE' units score 5 under recipe.mjs's /^MUDSTONE/ rule, about three quarters of the land.",
            "Slope at ~210 m reads lower than at 100 m, so fewer cells reach the steep slope classes than in the "
            "NI/South Wales runs; the quantile classes are rank-based and absorb most of it.",
            "The inventory is biased to roads, railways and surveyed valleys; absences sampled at random include "
            "unrecorded slides.",
            "Drainage proximity here is DEM channels, not the OSM waterways recipe.mjs used.",
            "Northern Ireland itself cannot be scored: GSNI publishes no open inventory (n = 1 in the BGS index).",
        ],
        "script": "GeoID_GIS/services/validate-landslide.py",
    }
    say("wrote", hazard_metrics.write_entry(entry))


if __name__ == "__main__":
    main()
