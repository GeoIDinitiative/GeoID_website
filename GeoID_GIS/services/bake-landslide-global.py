#!/usr/bin/env python3
"""Landslide susceptibility by random forest, trained on inventoried landslides
and validated on held-out REGIONS -- the replacement for Recipe A.

Recipe A (a weighted overlay of slope, lithology, rainfall and drainage, tuned
on South Wales) reproduced its acceptance AUC of 0.83 where it was tuned and
scored 0.53 on held-out Mid/North Wales (validate-landslide.py): a map sold by
membership that was a coin toss outside its tuning ground. This bake replaces
it the way bake-flood-global.py replaced the flood overlay.

THE INVENTORIES, and what each permits:
  BGS National Landslide Database (Great Britain)   Open Government Licence v3:
      any use, attribution ("Contains British Geological Survey materials
      © UKRI"). Points with their stated positional error.
  NASA Global Landslide Catalog (1997-2016)          a US Government work,
      exported from data.gov; the export asks the user to accept NASA's
      "Terms and Conditions", whose text the catalogue page does not carry.
      Only the coordinates and the location accuracy are used. RECORDED AS
      TO CONFIRM before the map is sold -- if NASA's terms bar it, the model
      shrinks to Great Britain, and the per-region table says where that
      leaves it valid.
  GLiM 0.5° lithology                               CC BY 3.0.

NEGATIVES ARE PSEUDO-ABSENCES. An inventory records failures and never the
slopes that held, so the dry examples are land cells drawn from the SAME
windows as the slides, at least ~1 km (fine) or ~30 km (coarse) from any
inventoried point of any accuracy. Drawing them near the reports controls
for WHERE people report (the Global Landslide Catalog is compiled from news,
so it follows roads and towns); it cannot remove an unreported slide from the
absences, which is a bias against the model (absences that are really
slides), and the card says so.

TWO TIERS, the flood forest's:
  fine    0.0025° (~250 m) over 0.5° windows round the best-located slides
          (NASA "exact", BGS within 100 m). The page runs it over the view.
  coarse  0.1° over the globe, trained on every slide located to 5 km.

    python3 GeoID_GIS/services/bake-landslide-global.py inventory   fetch BGS + read NASA, assign regions
    python3 GeoID_GIS/services/bake-landslide-global.py build       window features (fine) + coarse rows
    python3 GeoID_GIS/services/bake-landslide-global.py train       LORO validation, forests, global map, entries
    python3 GeoID_GIS/services/bake-landslide-global.py wales       the fine forest on Recipe A's held-out ground
"""
import concurrent.futures as cf
import csv
import importlib.util
import json
import math
import os
import pathlib
import pickle
import subprocess
import sys

import numpy as np

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import hazard_metrics  # noqa: E402

_spec = importlib.util.spec_from_file_location("bake_flood_global", HERE / "bake-flood-global.py")
F = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(F)

REPO = F.REPO
DATA = F.DATA
WORK = DATA / ".landslide-work"
OUT = DATA / "landslide-ml"
GLC_CSV = WORK / "glc.csv"
GLC_URL = "https://data.nasa.gov/docs/legacy/Global_Landslide_Catalog_Export/Global_Landslide_Catalog_Export_rows.csv"
GLIM_URL = "https://hdl.handle.net/10013/epic.39939.d001"
NLD = "https://ogcapi.bgs.ac.uk/collections/landslideindex/items"
GB = {"west": -8.7, "east": 2.0, "south": 49.8, "north": 61.0}

FINE_CELL, FINE_ZOOM, FINE_K, WINDOW = 0.0025, 10, 4, 0.5
COARSE_CELL = 0.1
WINDOWS_PER_REGION = 35
NEAR_FINE_CELLS = 4          # ~1 km at 250 m
NEAR_COARSE_CELLS = 3        # ~30 km at 0.1°
FOREST = dict(F.FOREST)
NEG_PER_POS = 2
LS_FEATURES = None
FINE_ENTRY = WORK / "landslide-susceptibility-fine.entry.json"

REGIONS = [
    ("great-britain", lambda lon, lat: -8.7 <= lon < 2.0 and 49.8 <= lat < 61.0),
    ("americas-north", lambda lon, lat: lon < -30 and lat > 15),
    ("americas-south", lambda lon, lat: lon < -30),
    ("asia-south", lambda lon, lat: 60 <= lon < 95 and lat < 40),
    ("oceania", lambda lon, lat: lon >= 95 and lat < -11),
    ("asia-east", lambda lon, lat: lon >= 60),
    ("europe", lambda lon, lat: lat >= 35),
    ("africa-middle-east", lambda lon, lat: True),
]


def region_of(lon, lat):
    for name, test in REGIONS:
        if test(lon, lat):
            return name
    return None


say = F.say


# ── the inventories ─────────────────────────────────────────────────────────

def fetch_nld():
    feats, offset = [], 0
    b = GB
    while True:
        url = f"{NLD}?bbox={b['west']},{b['south']},{b['east']},{b['north']}&limit=1000&offset={offset}&f=json"
        page = json.loads(F.cached(WORK / "nld" / f"{offset}.json", url).read_text())
        feats += page["features"]
        if len(page["features"]) < 1000:
            return feats
        offset += 1000


def inventory():
    """Every slide as (lon, lat, accuracy_m, source, region)."""
    path = WORK / "inventory.json"
    if path.exists():
        return json.loads(path.read_text())
    F.cached(GLC_CSV, GLC_URL)
    acc_m = {"exact": 50, "1km": 1000, "5km": 5000, "10km": 10000, "25km": 25000, "50km": 50000}
    pts = []
    with open(GLC_CSV, encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            a = acc_m.get(row.get("location_accuracy"))
            try:
                lon, lat = float(row["longitude"]), float(row["latitude"])
            except (TypeError, ValueError):
                continue
            if a is None or not (-180 <= lon <= 180 and -60 <= lat <= 84):
                continue
            pts.append({"lon": lon, "lat": lat, "acc": a, "src": "nasa-glc"})
    for feat in fetch_nld():
        g = feat.get("geometry") or {}
        if g.get("type") != "Point":
            continue
        pm = feat["properties"].get("plus_or_minus_metres")
        pts.append({"lon": g["coordinates"][0], "lat": g["coordinates"][1],
                    "acc": float(pm) if pm else 500.0, "src": "bgs-nld"})
    for p in pts:
        p["region"] = region_of(p["lon"], p["lat"])
    WORK.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(pts))
    return pts


def glim_asset():
    """GLiM 0.5° dominant class, as the JSON lattice landslide-ml.js reads."""
    import zipfile
    asset = OUT / "glim-0p5.json"
    if asset.exists():
        return str(asset), json.loads(asset.read_text())
    z = zipfile.ZipFile(F.cached(WORK / "glim05.zip", GLIM_URL))
    lines = z.read("glim_wgs84_0point5deg.txt.asc").decode().splitlines()
    vals = [int(v) for line in lines[6:] for v in line.split()]
    doc = {"about": "GLiM v1.0 gridded to 0.5 deg, dominant lithological class per cell (Hartmann & Moosdorf "
                    "2012, doi:10.1594/PANGAEA.788537, CC BY 3.0). Codes as Classnames.txt; -9999 no data.",
           "lattice": {"nLat": 360, "nLon": 720, "lat0": 89.75, "lon0": -179.75, "dLat": -0.5, "dLon": 0.5},
           "values": vals}
    OUT.mkdir(parents=True, exist_ok=True)
    asset.write_text(json.dumps(doc, separators=(",", ":")))
    return str(asset), doc


# ── the node bridge (landslide-ml-stack.mjs) ────────────────────────────────

def run_stack(job_dir, grid, mosaic, plan, lc, k, soil, normal, glim_path):
    global LS_FEATURES
    job_dir = pathlib.Path(job_dir)
    job_dir.mkdir(parents=True, exist_ok=True)
    mosaic.astype("<f4").tofile(job_dir / "dem_mosaic.f32")
    lc.astype(np.uint8).tofile(job_dir / "lc.u8")
    meta_w, band = soil
    band.tofile(job_dir / "soil_window.u8")
    field, lattice = normal
    np.ascontiguousarray(field, "<f4").tofile(job_dir / "rain_normal.f32")
    job = {"grid": {k2: grid[k2] for k2 in ("west", "east", "south", "north", "cell")}, "plan": plan, "lcK": k,
           "soil": "window", "soilWindow": meta_w, "glim": glim_path,
           "rain": {"normal": {"file": "rain_normal.f32", "lattice": lattice}}}
    (job_dir / "job.json").write_text(json.dumps(job))
    subprocess.run(["node", "--max-old-space-size=2048", str(HERE / "landslide-ml-stack.mjs"), str(job_dir)], check=True)
    meta = json.loads((job_dir / "stack.json").read_text())
    LS_FEATURES = meta["features"]
    n = meta["grid"]["width"] * meta["grid"]["height"]
    feats = np.fromfile(job_dir / "features.f32", "<f4").reshape(len(LS_FEATURES), n)
    mask = np.fromfile(job_dir / "mask.u8", np.uint8).astype(bool)
    for name in ("dem_mosaic.f32", "lc.u8", "features.f32", "soil_window.u8"):
        (job_dir / name).unlink(missing_ok=True)
    return feats, mask, meta


# ── fine windows ───────────────────────────────────────────────────────────

def windows(pts):
    """0.5° windows round the best-located slides, the busiest per region."""
    fine = [p for p in pts if p["acc"] <= 100]
    by = {}
    for p in fine:
        key = (math.floor(p["lon"] / WINDOW), math.floor(p["lat"] / WINDOW))
        by.setdefault(key, []).append(p)
    out = []
    for region, _ in REGIONS:
        keys = [k for k, v in by.items() if region_of((k[0] + 0.5) * WINDOW, (k[1] + 0.5) * WINDOW) == region]
        keys.sort(key=lambda k: -len(by[k]))
        for k in keys[:WINDOWS_PER_REGION]:
            out.append({"key": f"{k[0]}_{k[1]}", "region": region, "west": k[0] * WINDOW, "south": k[1] * WINDOW,
                        "east": (k[0] + 1) * WINDOW, "north": (k[1] + 1) * WINDOW, "slides": len(by[k])})
    return out


def burn_points(points, grid, radius=0):
    """Cells holding a point; dilated by `radius` cells."""
    m = np.zeros((grid["height"], grid["width"]), bool)
    for p in points:
        c = int((p["lon"] - grid["west"]) / grid["cell"])
        r = int((grid["north"] - p["lat"]) / grid["cell"])
        if 0 <= r < grid["height"] and 0 <= c < grid["width"]:
            m[r, c] = True
    if radius:
        from scipy import ndimage
        m = ndimage.binary_dilation(m, iterations=radius)
    return m.ravel()


def build_window(w, pts, normal, soil, glim_path, rng):
    path = WORK / "rows" / f"fine_{w['key']}.npz"
    if path.exists():
        return dict(np.load(path, allow_pickle=True))
    g = F.grid_of(w, FINE_CELL)
    pad = 0.05
    inside = [p for p in pts if w["west"] - pad <= p["lon"] < w["east"] + pad and w["south"] - pad <= p["lat"] < w["north"] + pad]
    mosaic, plan = F.dem_mosaic(g, FINE_ZOOM)
    lc = F.land_cover(g, FINE_K, f"ls_{w['key']}")
    feats, mask, meta = run_stack(WORK / "jobs" / w["key"], g, mosaic, plan, lc, FINE_K, soil.native_for(g), normal,
                                  glim_path)
    pos = np.flatnonzero(burn_points([p for p in inside if p["acc"] <= 100], g) & mask)
    near = burn_points(inside, g, NEAR_FINE_CELLS)
    cand = np.flatnonzero(mask & ~near)
    neg = rng.choice(cand, min(cand.size, max(200, NEG_PER_POS * pos.size)), replace=False) if cand.size else cand
    cells = np.concatenate([pos, neg])
    X = feats[:, cells].T
    ok = np.all(np.isfinite(X), axis=1)
    out = {"X": X[ok], "y": np.r_[np.ones(pos.size), np.zeros(neg.size)][ok].astype(np.int8),
           "meta": json.dumps({**w, "fills": meta["fills"]})}
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(path, **out)
    return out


# ── the coarse tier, off the flood bake's global stack ─────────────────────

def coarse_stack(glim):
    """The flood bake's 0.1° stack, re-cut to the landslide features: relief
    from the 3 x 3 neighbourhood, lithology from GLiM, no event rain."""
    path = WORK / "coarse_ls.npz"
    if path.exists():
        z = np.load(path, allow_pickle=True)
        return {"grid": F.grid_of(F.GLOBAL, COARSE_CELL), "feats": z["feats"], "mask": z["mask"],
                "features": list(z["features"])}
    z = np.load(F.WORK / "coarse_stack.npz", allow_pickle=True)
    ff, fm, fnames = z["feats"], z["mask"], list(z["features"])
    g = F.grid_of(F.GLOBAL, COARSE_CELL)
    H, W = g["height"], g["width"]
    elev = np.where(fm, ff[fnames.index("elevation_m")], np.nan).reshape(H, W)
    pad = np.pad(elev, 1, constant_values=np.nan)
    stackn = np.stack([pad[1 + dy:1 + dy + H, 1 + dx:1 + dx + W] for dy in (-1, 0, 1) for dx in (-1, 0, 1)])
    with np.errstate(invalid="ignore"):
        relief = (np.nanmax(stackn, axis=0) - np.nanmin(stackn, axis=0)).ravel()
    lats = g["north"] - (np.arange(H) + 0.5) * COARSE_CELL
    lons = g["west"] + (np.arange(W) + 0.5) * COARSE_CELL
    gy = np.clip(np.round((lats - 89.75) / -0.5).astype(int), 0, 359)
    gx = np.clip(np.round((lons + 179.75) / 0.5).astype(int), 0, 719)
    codes = np.array(glim["values"]).reshape(360, 720)[gy[:, None], gx[None, :]].ravel()
    groups = {"lith_unconsolidated": [1], "lith_siliciclastic": [3], "lith_mixed_sedimentary": [5, 14],
              "lith_carbonate": [6], "lith_metamorphic": [8], "lith_plutonic": [4, 9, 13], "lith_volcanic": [2, 7, 10, 12]}
    names = ["elevation_m", "slope_deg", "hand_m", "log10_upstream_km2", "channel_distance_m", "twi", "curvature",
             "relief_m", "water_frac", "trees_frac", "flooded_veg_frac", "crops_frac", "built_frac", "bare_frac",
             "range_frac", "soil_thickness_m", "rain_normal_mm", *groups]
    cols = []
    for name in names:
        if name == "relief_m":
            cols.append(relief)
        elif name in groups:
            cols.append(np.isin(codes, groups[name]).astype(np.float32))
        else:
            cols.append(ff[fnames.index(name)])
    feats = np.stack(cols).astype(np.float32)
    feats[:, ~fm] = np.nan
    np.savez_compressed(path, feats=feats, mask=fm, features=np.array(names))
    return {"grid": g, "feats": feats, "mask": fm, "features": names}


def coarse_rows(pts, coarse, rng):
    # NASA's catalogue ONLY trains the coarse tier. The first run took BGS's
    # 18,000 points too, and at 0.1° they cover Great Britain wall to wall: the
    # forest learnt "Britain" (the whole island red on the global map, and a
    # held-out GB set that was nearly all slides). One inventory reported at
    # one density keeps the coarse tier about ground rather than about who
    # surveyed it. BGS's points still keep absences off GB's slides, and they
    # train the 250 m tier, where their density is the point.
    g, mask = coarse["grid"], coarse["mask"]
    glc = [p for p in pts if p["src"] == "nasa-glc"]
    good = [p for p in glc if p["acc"] <= 5000]
    pos_m = burn_points(good, g) & mask
    near = burn_points(pts, g, NEAR_COARSE_CELLS)
    reported = burn_points(glc, g, 10)                       # within ~1° of some report
    pos = np.flatnonzero(pos_m)
    cand = np.flatnonzero(mask & reported & ~near)
    neg = rng.choice(cand, min(cand.size, NEG_PER_POS * pos.size), replace=False)
    cells = np.concatenate([pos, neg])
    lon = g["west"] + (cells % g["width"] + 0.5) * COARSE_CELL
    lat = g["north"] - (cells // g["width"] + 0.5) * COARSE_CELL
    X = coarse["feats"][:, cells].T
    y = np.r_[np.ones(pos.size), np.zeros(neg.size)].astype(np.int8)
    region = np.array([region_of(a, b) for a, b in zip(lon, lat)])
    ok = np.all(np.isfinite(X), axis=1)
    return X[ok], y[ok], region[ok], cells[ok]


def build():
    pts = inventory()
    glim_path, glim = glim_asset()
    normal = F.cpc_normal()
    soil = F.SoilTif()
    ws = windows(pts)
    say(f"   {len(pts):,} slides; {len(ws)} fine windows")
    rng = np.random.default_rng(1)
    for i, w in enumerate(ws):
        try:
            out = build_window(w, pts, normal, soil, glim_path, rng)
            say(f"   {i + 1}/{len(ws)} {w['key']} {w['region']}: {int(out['y'].sum())} slides, {int((out['y'] == 0).sum())} absences")
        except Exception as error:
            say(f"   {i + 1}/{len(ws)} {w['key']} skipped: {error}")
    coarse_stack(glim)


# ── training and the published entries ─────────────────────────────────────

def load_fine():
    X, y, region, key = [], [], [], []
    fills = {}
    for path in sorted((WORK / "rows").glob("fine_*.npz")):
        z = np.load(path, allow_pickle=True)
        meta = json.loads(str(z["meta"]))
        if not len(z["y"]) or z["y"].sum() == 0:
            continue
        X.append(z["X"]); y.append(z["y"])
        region += [meta["region"]] * len(z["y"]); key += [meta["key"]] * len(z["y"])
        for k, v in meta["fills"].items():
            fills[k] = fills.get(k, 0) + v
    return np.vstack(X), np.concatenate(y), np.array(region), np.array(key), fills


def loro(X, y, region, group):
    per, totals = {}, dict(tp=0, fp=0, tn=0, fn=0)
    scores, truth = [], []
    for name, _ in REGIONS:
        te = region == name
        if y[te].sum() < 30 or (y[te] == 0).sum() < 30:
            per[name] = {"assessable": False, "events": int(len(set(group[te]))), "n": int(te.sum()),
                         "message": f"{int(y[te].sum())} slides and {int((y[te] == 0).sum())} absences held out — "
                                    "a score needs 30 of each"}
            continue
        rf = F.fit(X[~te], y[~te])
        thr = hazard_metrics.youden(list(zip(rf.oob_decision_function_[:, 1].tolist(), y[~te].tolist())))
        p = rf.predict_proba(X[te])[:, 1]
        rep = hazard_metrics.report(list(zip(p.tolist(), y[te].tolist())), thr, "Youden on the other regions' OOB votes")
        rep["events"] = int(len(set(group[te])))
        per[name] = rep
        for k in totals:
            totals[k] += rep[k]
        scores += p.tolist(); truth += y[te].tolist()
        say(f"     {name:20s} AUC {rep['auc']} acc {rep['accuracy']} prec {rep['precision']} rec {rep['recall']} "
            f"F1 {rep['f1']} (n {rep['n']})")
    tp, fp, tn, fn = (totals[k] for k in ("tp", "fp", "tn", "fn"))
    n = tp + fp + tn + fn
    prec = tp / (tp + fp) if tp + fp else None
    rec = tp / (tp + fn) if tp + fn else None
    pooled = {"n": n, **totals, "accuracy": round((tp + tn) / n, 4), "precision": round(prec, 4) if prec else None,
              "recall": round(rec, 4) if rec else None,
              "f1": round(2 * prec * rec / (prec + rec), 4) if prec and rec else None,
              "auc": round(float(np.mean([r["auc"] for r in per.values() if r.get("auc") is not None])), 4),
              "auc_pooled": hazard_metrics.roc_auc(list(zip(scores, truth))),
              "auc_rule": "mean of the held-out regions' AUCs (each region's scores come from its own forest, so "
                          "pooling them mixes calibrations; the pooled figure is auc_pooled)", "positives": tp + fn, "negatives": tn + fp,
              "kappa": hazard_metrics.confusion([(1, 1)] * tp + [(1, 0)] * fp + [(0, 0)] * tn + [(0, 1)] * fn, 0.5)["kappa"]}
    return per, pooled


INPUTS = [
    {"name": "Landslides, Great Britain", "source": "BGS National Landslide Database (index)",
     "licence": "Open Government Licence v3 — Contains British Geological Survey materials © UKRI"},
    {"name": "Landslides, global", "source": "NASA Global Landslide Catalog 1997–2016 (data.gov export)",
     "licence": "NASA terms: pending owner confirmation (a US Government work; the data.gov export asks the user "
                "to accept NASA's Terms and Conditions, whose text is not published with the catalogue)"},
    {"name": "Lithology", "source": "GLiM v1.0 gridded 0.5° (Hartmann & Moosdorf 2012, doi:10.1594/PANGAEA.788537)",
     "licence": "CC BY 3.0"},
    {"name": "Elevation", "source": "Terrarium DEM (AWS Open Data)", "licence": "public domain / attribution by source"},
    {"name": "Satellite land cover", "source": "Esri / Impact Observatory Sentinel-2 10 m land cover 2020",
     "licence": "CC BY 4.0"},
    {"name": "Soil", "source": "Pelletier et al. 2016 soil and sediment thickness (ORNL DAAC)",
     "licence": "NASA ORNL DAAC: free to use with citation"},
    {"name": "Rainfall, climate", "source": "NOAA CPC Global Unified daily precipitation, 1991–2020 mean",
     "licence": "public domain (US Government)"},
]
LIMITS = [
    "The 0.1° tier is trained on NASA's catalogue alone: with BGS's 18,000 points it learnt Great Britain (the island solid red on the map) rather than ground. Great Britain cannot be scored at 0.1° (too few absences lie 30 km from any report there); the 250 m tier, trained on both inventories, is the product for Great Britain.",
    "Negatives are pseudo-absences: land drawn near the reports but at least ~1 km (fine) / ~30 km (coarse) from "
    "any. An unreported slide among them counts against the model.",
    "NASA's catalogue is compiled from news and follows roads and towns; slides in empty mountains are under-"
    "represented, and the forest learns some of where people are.",
    "Lithology is GLiM's dominant class per 0.5° cell: a valley of weak shale in a granite cell reads as granite.",
    "Slope at 250 m reads valley sides gentler than at 30 m; relief over ~1 km carries what the cell slope loses.",
    "Rain is the climate only: this is where ground fails, not when.",
    "NASA's export terms are not published with the catalogue; until confirmed, regions other than Great Britain "
    "rest on data whose commercial terms are unknown.",
]


def entry(tier, per, pooled, rf, thr, n_rows, groups, fills, product, grid):
    imp = sorted(zip(LS_FEATURES, rf.feature_importances_.round(4).tolist()), key=lambda kv: -kv[1])
    val = dict(pooled)
    val.update({
        "threshold": None, "threshold_rule": "per region: Youden's J on the OOB votes of the forest trained on the OTHER regions",
        "holdout": f"leave one region out: {sum(1 for r in per.values() if r.get('assessable', True))} of {len(REGIONS)} "
                   f"regions each scored by a forest that never saw it",
        "events": "inventoried landslides = 1; pseudo-absences (land near the reports, away from any) = 0",
        "regions": per, "region_unit": "windows" if tier == "fine" else "cells",
    })
    return {
        "id": "landslide-susceptibility-global" if tier == "coarse" else "landslide-susceptibility-fine",
        "name": ("Landslide susceptibility — global preview (random forest, 0.1°)" if tier == "coarse"
                 else "Landslide susceptibility — on demand (random forest, ~250 m)"),
        "hazard": "landslide", "product": product,
        "model": {
            "method": "Random forest on terrain (slope, relief, curvature, HAND, TWI, upstream area), GLiM lithology, "
                      "Sentinel-2 land cover, soil thickness and the rain climate, trained on inventoried landslides; "
                      "replaces Recipe A's weighted overlay.",
            "parameters": {**{k: v for k, v in FOREST.items() if k != "oob_score"},
                           "negatives_per_positive": NEG_PER_POS,
                           "absence_rule": (f"≥{NEAR_FINE_CELLS} cells (~1 km) from any slide, inside its window"
                                            if tier == "fine" else f"≥{NEAR_COARSE_CELLS} cells (~30 km) from any slide, "
                                                                     "within ~1° of a report"),
                           "positive_rule": ("slides located within 100 m (NASA exact, BGS ±≤100 m)" if tier == "fine"
                                             else "NASA catalogue slides located within 5 km (BGS kept out: see limits)"),
                           "decision_threshold_published": round(thr, 4), "features": LS_FEATURES,
                           "feature_importance_gini": imp, "training_rows": int(n_rows),
                           "training_windows" if tier == "fine" else "training_cells": int(groups)},
            "inputs": INPUTS, "grid": grid,
            "gap_fills": {k: {"method": "nearest valid cell (flood-ml.js fillNearest)", "cells": int(v)}
                          for k, v in (fills or {}).items()},
        },
        "validation": val, "limits": LIMITS, "script": "GeoID_GIS/services/bake-landslide-global.py",
        "membership": "preview: free, not part of membership (until the owner confirms NASA's catalogue terms)",
    }


def train():
    global LS_FEATURES
    pts = inventory()
    _, glim = glim_asset()
    coarse = coarse_stack(glim)
    LS_FEATURES = coarse["features"]
    F.FEATURES = LS_FEATURES
    rng = np.random.default_rng(2)
    results = {}

    say("   coarse tier")
    X, y, region, cells = coarse_rows(pts, coarse, rng)
    per, pooled = loro(X, y, region, cells)
    rf = F.fit(X, y)
    thr = hazard_metrics.youden(list(zip(rf.oob_decision_function_[:, 1].tolist(), y.tolist())))
    F.export_forest(rf, OUT / "forest-coarse.json", X=X, threshold=thr)
    g = coarse["grid"]
    q = np.flatnonzero(coarse["mask"])
    Xq = coarse["feats"][:, q].T
    okq = np.all(np.isfinite(Xq), axis=1)
    p = np.full(g["width"] * g["height"], np.nan, np.float32)
    pq = np.full(q.size, np.nan, np.float32)
    for i in range(0, q.size, 200000):
        sl = slice(i, i + 200000)
        if okq[sl].any():
            part = np.full(okq[sl].size, np.nan, np.float32)
            part[okq[sl]] = rf.predict_proba(Xq[sl][okq[sl]])[:, 1]
            pq[sl] = part
    p[q] = pq
    grid = p.reshape(g["height"], g["width"])
    F.write_uint8_tif(grid, g, OUT / "landslide-susceptibility-0p1.hotlink-ok.tif")
    F.write_png(grid, WORK / "global.png", thr)
    say(f"   coarse: {int(okq.sum()):,} cells mapped, {float(np.nanmean(pq >= thr)) * 100:.1f}% over threshold {thr:.3f}")
    results["coarse"] = entry("coarse", per, pooled, rf, thr, len(y), len(y),
                              json.loads(str(np.load(F.WORK / "coarse_stack.npz", allow_pickle=True)["fills"])),
                              "data/global/landslide-ml/landslide-susceptibility-0p1.hotlink-ok.tif",
                              "0.1° global lattice, 60°S–84°N (the flood bake's stack + relief + GLiM)")

    say("   fine tier")
    X, y, region, key, fills = load_fine()
    say(f"   {len(y):,} rows, {int(y.sum()):,} slides, {len(set(key))} windows")
    per, pooled = loro(X, y, region, key)
    rf = F.fit(X, y)
    thr = hazard_metrics.youden(list(zip(rf.oob_decision_function_[:, 1].tolist(), y.tolist())))
    size = F.export_forest(rf, OUT / "forest-fine.json", X=X, threshold=thr)
    say(f"   fine: forest {size / 1e6:.1f} MB, threshold {thr:.3f}")
    with open(WORK / "forest_fine.pkl", "wb") as f:
        pickle.dump({"rf": rf, "threshold": thr, "features": LS_FEATURES}, f)
    results["fine"] = entry("fine", per, pooled, rf, thr, len(y), len(set(key)), fills,
                            "computed in the page over the view or a drawn area narrower than 1.5° (landslide-ml-run.js)",
                            "0.0025° (~250 m) lattice over the view; Terrarium zoom 10")
    say("   wrote", hazard_metrics.write_entry(results["coarse"]))
    # The 250 m tier is HIDDEN by the owner's call (weak held-out skill): its
    # entry is kept beside the bake's cache, not in the file the hub publishes.
    FINE_ENTRY.write_text(json.dumps(results["fine"], indent=1))
    say("   kept (unpublished)", FINE_ENTRY)


def wales():
    """The 250 m forest on the ground Recipe A failed on: Mid and North Wales
    windows held out, every other window trained on. Recorded on the fine
    entry beside the regional table, so the replacement and the map it
    replaces are scored on one place."""
    X, y, region, key, _ = load_fine()
    centre = {k: ((int(k.split("_")[0]) + 0.5) * WINDOW, (int(k.split("_")[1]) + 0.5) * WINDOW) for k in set(key)}
    held = np.array([(-5.4 <= centre[k][0] <= -2.6) and (51.95 <= centre[k][1] <= 53.5) for k in key])
    rf = F.fit(X[~held], y[~held])
    thr = hazard_metrics.youden(list(zip(rf.oob_decision_function_[:, 1].tolist(), y[~held].tolist())))
    p = rf.predict_proba(X[held])[:, 1]
    rep = hazard_metrics.report(list(zip(p.tolist(), y[held].tolist())), thr, "Youden on the training windows' OOB votes")
    rep.update({"windows": int(len({k for k, h in zip(key, held) if h})),
                "compare": "Recipe A on Mid/North Wales: AUC 0.534 (validate-landslide.py; absences drawn 1:1 at random "
                           "from the region, here from the same windows >= 1 km from any slide)"})
    e = json.loads(FINE_ENTRY.read_text())
    e["validation"].setdefault("extra", {})["mid_north_wales_holdout"] = rep
    FINE_ENTRY.write_text(json.dumps(e, indent=1))
    say(f"   Mid/North Wales held out: AUC {rep['auc']} (Recipe A 0.534), F1 {rep['f1']}, n {rep['n']}")


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "help"
    if cmd == "inventory":
        pts = inventory()
        glim_asset()
        from collections import Counter
        c = Counter((p["region"], "fine" if p["acc"] <= 100 else "coarse" if p["acc"] <= 5000 else "coarser") for p in pts)
        for region, _ in REGIONS:
            say(f"   {region:20s} fine {c[(region, 'fine')]:6d}  coarse {c[(region, 'coarse')]:6d}  "
                f"coarser {c[(region, 'coarser')]:6d}")
    elif cmd == "build":
        build()
    elif cmd == "train":
        train()
        wales()
    elif cmd == "wales":
        wales()
    else:
        print(__doc__)
    return 0


if __name__ == "__main__":
    sys.exit(main())
