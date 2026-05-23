#!/usr/bin/env python3
"""
Etna viewer geology preprocessing pipeline
==========================================
Outputs three viewer-ready compact JSON files:

  etna-lavaflows.json          – lava flow polygons (INGV EtnaGeoMap)
  etna-regional-geology.json   – non-lava geology: INGV base units + ISPRA CARG 1:100k fill
  etna-tectonic-faults.json    – regional tectonic faults (ITHACA + GEM regional lineaments)

Run from this directory:
  python3 preprocess_geology.py

Dependencies: geopandas, fiona, shapely, requests
"""

import json
import math
import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd
import requests
from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union

# ─── Paths ────────────────────────────────────────────────────────────────────

INPUT_DIR  = Path(__file__).parent
VIEWER_DIR = INPUT_DIR.parent / "viewer"
GEOLOGY_SRC = INPUT_DIR / "etna_geology.geojson"

OUT_LAVA    = VIEWER_DIR / "etna-lavaflows.json"
OUT_GEOLOGY = VIEWER_DIR / "etna-regional-geology.json"
OUT_FAULTS  = VIEWER_DIR / "etna-tectonic-faults.json"

# ─── Domain clip extent (matches SAT_LON_W/E, SAT_LAT_S/N in etna-viewer.js) ──

CLIP_LON_W, CLIP_LAT_S, CLIP_LON_E, CLIP_LAT_N = 14.433, 37.305, 15.573, 38.205
CLIP_BOX = box(CLIP_LON_W, CLIP_LAT_S, CLIP_LON_E, CLIP_LAT_N)

# Extended fetch bbox for fault data — broader south/west/east to capture
# the Gela-Catania thrust front, Hyblean escarpment and Malta Escarpment
# which begin south of the viewer domain boundary.
FAULT_LON_W, FAULT_LAT_S, FAULT_LON_E, FAULT_LAT_N = 13.5, 36.0, 16.5, 38.5
FAULT_FETCH_BOX = box(FAULT_LON_W, FAULT_LAT_S, FAULT_LON_E, FAULT_LAT_N)

# EtnaGeoMap geographic footprint (actual data extent)
ETNA_LON_W, ETNA_LAT_S, ETNA_LON_E, ETNA_LAT_N = 14.768, 37.484, 15.312, 37.917
ETNA_BOX = box(ETNA_LON_W, ETNA_LAT_S, ETNA_LON_E, ETNA_LAT_N)

# Geometry simplification tolerance (°) — ≈ 11 m, good for web rendering
SIMPLIFY_TOL = 0.0001

# ─── Helpers ──────────────────────────────────────────────────────────────────

def log(msg):
    print(f"  {msg}", flush=True)


def round_coords(coords, dp=6):
    """Recursively round coordinate values to dp decimal places."""
    if coords and isinstance(coords[0], (int, float)):
        return [round(coords[0], dp), round(coords[1], dp)]
    return [round_coords(c, dp) for c in coords]


def safe_str(val):
    """Return empty string for None/NaN, otherwise str(val)."""
    if val is None:
        return ""
    try:
        if pd.isna(val):
            return ""
    except (TypeError, ValueError):
        pass
    return str(val).strip()


def safe_int(val):
    try:
        if pd.isna(val):
            return 0
    except (TypeError, ValueError):
        pass
    try:
        return int(val)
    except Exception:
        return 0


def geom_to_compact(geom):
    """Return simplified coordinate array from a shapely geometry."""
    m = mapping(geom)
    t = m["type"]
    if t == "Polygon":
        return [round_coords(ring) for ring in m["coordinates"]]
    elif t == "MultiPolygon":
        # Flatten multi-polygon: return list of polygon coordinate arrays
        return [round_coords(ring) for poly in m["coordinates"] for ring in poly]
    elif t == "LineString":
        return [round_coords(m["coordinates"])]      # always list-of-segments
    elif t == "MultiLineString":
        return [round_coords(seg) for seg in m["coordinates"]]
    return None


def wfs_fetch(url, layer, bbox, crs="EPSG:4326", max_features=5000):
    """Fetch a WFS layer as a GeoDataFrame, handling pagination."""
    bbox_str = f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]},EPSG:4326"
    params = {
        "service": "WFS",
        "version": "1.1.0",
        "request": "GetFeature",
        "typeName": layer,
        "BBOX": bbox_str,
        "outputFormat": "application/json",
        "maxFeatures": max_features,
    }
    try:
        r = requests.get(url, params=params, timeout=60)
        r.raise_for_status()
        gdf = gpd.read_file(r.text, driver="GeoJSON")
        if gdf.crs and gdf.crs.to_epsg() != 4326:
            gdf = gdf.to_crs(epsg=4326)
        return gdf
    except Exception as e:
        log(f"  WFS fetch failed for {layer}: {e}")
        return None


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 1 — Load and clip INGV EtnaGeoMap
# ═══════════════════════════════════════════════════════════════════════════════

print("\n[1/5] Loading INGV EtnaGeoMap …")
log(f"Source: {GEOLOGY_SRC}")

gdf = gpd.read_file(str(GEOLOGY_SRC))
log(f"Loaded {len(gdf)} features, CRS: {gdf.crs}")

# Ensure WGS84
if gdf.crs and gdf.crs.to_epsg() != 4326:
    gdf = gdf.to_crs(epsg=4326)

# Clip to domain
gdf = gdf.clip(CLIP_BOX)
log(f"After clip to domain: {len(gdf)} features")


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 2 — Split lava flows from base geology
# ═══════════════════════════════════════════════════════════════════════════════

print("\n[2/5] Splitting lava flows …")

lava_mask = gdf["name"].str.contains("lava flow", case=False, na=False)
lava_gdf  = gdf[lava_mask].copy()
base_gdf  = gdf[~lava_mask].copy()

log(f"Lava flow features : {len(lava_gdf)}")
log(f"Base geology features: {len(base_gdf)}")

# Spot-check classification
sample_lava = lava_gdf["name"].dropna().unique()[:5].tolist()
sample_base = base_gdf["name"].dropna().unique()[:5].tolist()
log(f"Sample lava names : {sample_lava}")
log(f"Sample base names : {sample_base}")


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 3 — Simplify EtnaGeoMap geometries
# ═══════════════════════════════════════════════════════════════════════════════

print("\n[3/5] Simplifying geometries …")

lava_gdf["geometry"] = lava_gdf.geometry.simplify(SIMPLIFY_TOL, preserve_topology=True)
base_gdf["geometry"] = base_gdf.geometry.simplify(SIMPLIFY_TOL, preserve_topology=True)

# Drop null/empty geometries
lava_gdf = lava_gdf[~lava_gdf.geometry.is_empty & lava_gdf.geometry.notna()]
base_gdf = base_gdf[~base_gdf.geometry.is_empty & base_gdf.geometry.notna()]
log(f"After simplify — lava: {len(lava_gdf)}, base: {len(base_gdf)}")


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 4 — Fetch ISPRA CARG 1:100k for domain margins
# ═══════════════════════════════════════════════════════════════════════════════

print("\n[4/5] Fetching ISPRA CARG litologia100k via WFS …")

ISPRA_URL   = "https://sgi2.isprambiente.it/geoserver/ge-core8/wfs"
ISPRA_LAYER = "ge-core8:litologia100k"

ispra_gdf = wfs_fetch(
    ISPRA_URL, ISPRA_LAYER,
    (CLIP_LON_W, CLIP_LAT_S, CLIP_LON_E, CLIP_LAT_N)
)

if ispra_gdf is not None and len(ispra_gdf):
    log(f"ISPRA: fetched {len(ispra_gdf)} features")
    log(f"ISPRA fields: {list(ispra_gdf.columns)}")

    # Clip to domain only — no INGV exclusion needed.
    # In the JS renderer, ISPRA is drawn first and INGV (lava + non-lava) is
    # painted on top, so INGV naturally covers ISPRA in the volcanic zone without
    # any expensive geometric difference operations.
    ispra_gdf = ispra_gdf.clip(CLIP_BOX)
    log(f"ISPRA after domain clip: {len(ispra_gdf)} features")

    ispra_fill = ispra_gdf.copy()
    ispra_fill["geometry"] = ispra_fill.geometry.simplify(SIMPLIFY_TOL, preserve_topology=True)
    ispra_fill = ispra_fill[~ispra_fill.geometry.is_empty & ispra_fill.geometry.notna()]
    log(f"ISPRA fill features: {len(ispra_fill)}")
else:
    log("ISPRA WFS unavailable — regional fill will be EtnaGeoMap only")
    ispra_fill = None


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 5 — Fetch GEM Global Active Faults (tectonic fault lines)
# ═══════════════════════════════════════════════════════════════════════════════

print("\n[5/6] Fetching ISPRA ITHACA capable faults …")

# ITHACA = ITaly HAzards from CApable faults — ISPRA national capable-fault catalogue.
# Fetch with an extended bbox (south to 36°N) so the Gela-Catania and Hyblean thrust
# fronts just south of the viewer domain are included and clipped at the domain edge.
ITHACA_URL   = "https://sgi2.isprambiente.it/geoserver/ge-core1/wfs"
ITHACA_LAYER = "ge-core1:ITHACA"

ithaca_gdf = wfs_fetch(
    ITHACA_URL, ITHACA_LAYER,
    (FAULT_LON_W, FAULT_LAT_S, FAULT_LON_E, FAULT_LAT_N),
    max_features=2000,
)

if ithaca_gdf is not None and len(ithaca_gdf):
    log(f"ITHACA: fetched {len(ithaca_gdf)} capable fault features (extended bbox)")
    # Clip to viewer domain — WFS bbox returns full geometry for any intersecting feature.
    ithaca_gdf = ithaca_gdf.clip(CLIP_BOX)
    ithaca_gdf = ithaca_gdf[~ithaca_gdf.geometry.is_empty & ithaca_gdf.geometry.notna()]
    log(f"ITHACA after viewer-domain clip: {len(ithaca_gdf)} features")
    from collections import Counter
    kin_counts = Counter(str(v) for v in ithaca_gdf["kinematics"])
    log(f"Kinematics: {dict(kin_counts)}")
else:
    log("ITHACA WFS unavailable")
    ithaca_gdf = None


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 6 — GEM Global Active Faults (regional lineaments not in ITHACA)
# ═══════════════════════════════════════════════════════════════════════════════

print("\n[6/6] Fetching GEM Global Active Faults (regional lineaments) …")

# GEM Styron & Pagani 2020 — CC-BY 4.0.  Provides large-scale tectonic lineaments
# (subduction thrust, Gela-Catania foredeep, Tindari-Letojanni, etc.) that ITHACA
# doesn't cover because it focuses on onshore capable faults.
GEM_URL = (
    "https://raw.githubusercontent.com/GEMScienceTools/gem-global-active-faults"
    "/master/geojson/gem_active_faults_harmonized.geojson"
)

# Curated name table keyed by GEM catalog_id.  Derived from SHARE / DISS literature
# cross-referencing catalog positions and slip types.
GEM_NAMES = {
    "EUR_ITCS006":  "Malta Channel Thrust",
    "EUR_ITCS014":  "Calabrian Arc Thrust (NE)",
    "EUR_ITCS016":  "Ionian Coast — Malta Escarpment (N segment)",
    "EUR_ITCS017":  "Malta Channel Sinistral Fault",
    "EUR_ITCS029":  "Sicilian Chain Thrust Front",
    "EUR_ITCS035":  "Scicli Sinistral Fault",
    "EUR_ITCS036":  "Hyblean-Catania Thrust",
    "EUR_ITCS042":  "Tindari-Letojanni Fault",
    "EUR_ITCS053":  "Calabria Normal Fault (W)",
    "EUR_ITCS055":  "Messina Straits Fault Zone",
    "EUR_ITCS068":  "Peloritani Thrust (NE)",
    "EUR_ITCS080":  "Calabria Normal Fault (E)",
    "EUR_ITCS082":  "Ionian Calabrian Normal Fault",
    "EUR_ITCS095":  "Ionian Subduction Front (S)",
    "EUR_ITCS096":  "Ionian Subduction Front (C)",
    "EUR_ITCS097":  "Ionian Subduction Front (N)",
    "EUR_ITCS222":  "North Sicily Offshore Thrust",
    "EUR_MTCS001":  "Malta-Tunisia Dextral Zone",
    "PB_409.0":     "Ionian Subduction Thrust (Calabrian Arc)",
    "PB_410.0":     "Ionian Subduction Thrust (Calabrian Arc)",
    "PB_419.0":     "Ionian Subduction Thrust (Calabrian Arc)",
    "PB_420.0":     "Ionian Subduction Thrust (Calabrian Arc)",
    "PB_421.0":     "Ionian Subduction Thrust (Calabrian Arc)",
}

# Map GEM slip_type → ITHACA-style kinematics string (used for JS colour coding)
GEM_KINE_MAP = {
    "Reverse":           "Reverse",
    "Normal":            "Normal",
    "Sinistral":         "Strike Slip SX",
    "Dextral":           "Strike Slip DX",
    "Sinistral-Normal":  "Normal Oblique SX",
    "Sinistral-Reverse": "Oblique Reverse SX",
    "Dextral-Normal":    "Normal Oblique DX",
    "Dextral-Reverse":   "Oblique Reverse DX",
    "Subduction_Thrust": "Reverse",
    "Strike-Slip":       "Strike Slip DX",
}

gem_records = []
try:
    resp = requests.get(GEM_URL, timeout=60)
    resp.raise_for_status()
    gem_raw = resp.json()
    n_total = len(gem_raw.get("features", []))
    log(f"GEM: loaded {n_total} global features")

    for feat in gem_raw.get("features", []):
        props = feat.get("properties", {})
        cid = props.get("catalog_id", "")
        slip = props.get("slip_type", "")
        geom_raw = feat.get("geometry")
        if not geom_raw or not cid:
            continue

        geom_shape = shape(geom_raw)
        # Keep only features that intersect the extended fault fetch bbox
        if not geom_shape.intersects(FAULT_FETCH_BOX):
            continue
        # Clip to viewer domain
        clipped = geom_shape.intersection(CLIP_BOX)
        if clipped.is_empty:
            continue

        name = GEM_NAMES.get(cid, cid)
        kinematics = GEM_KINE_MAP.get(slip, slip)
        coords = geom_to_compact(clipped)
        if not coords:
            continue

        gem_records.append([
            cid,
            name,
            kinematics,
            "Regional",
            "",
            "gem",
            coords,
        ])

    log(f"GEM: {len(gem_records)} features intersect viewer domain")
    from collections import Counter
    gem_kin = Counter(r[2] for r in gem_records)
    log(f"GEM kinematics: {dict(gem_kin)}")

except Exception as e:
    log(f"GEM fetch failed: {e}")
    gem_records = []


# ═══════════════════════════════════════════════════════════════════════════════
# SERIALISE — Write compact JSON outputs
# ═══════════════════════════════════════════════════════════════════════════════

print("\n[Output] Serialising compact JSON files …")

# ── etna-lavaflows.json ───────────────────────────────────────────────────────

lava_records = []
for _, row in lava_gdf.iterrows():
    geom = row.geometry
    if geom is None or geom.is_empty:
        continue
    coords = geom_to_compact(geom)
    if not coords:
        continue
    lava_records.append([
        safe_int(row.get("objectid", 0)),
        safe_str(row.get("name")),
        safe_str(row.get("formation")),
        safe_str(row.get("age")),
        safe_str(row.get("sigle_cart")),
        coords,
    ])

lava_out = {
    "meta": {
        "source": "INGV EtnaGeoMap (Branca et al. 2011/2015)",
        "license": "CC-BY 4.0",
        "fields": ["id", "name", "formation", "age", "code", "coords"],
        "count": len(lava_records),
        "bbox": [CLIP_LON_W, CLIP_LAT_S, CLIP_LON_E, CLIP_LAT_N],
    },
    "features": lava_records,
}

with open(OUT_LAVA, "w") as f:
    json.dump(lava_out, f, separators=(",", ":"))

log(f"etna-lavaflows.json — {len(lava_records)} features, {OUT_LAVA.stat().st_size/1024:.0f} KB")


# ── etna-regional-geology.json ────────────────────────────────────────────────

def serialize_geo_row(row, source_tag):
    geom = row.geometry
    if geom is None or geom.is_empty:
        return None
    coords = geom_to_compact(geom)
    if not coords:
        return None
    if source_tag == "ingv":
        return [
            safe_int(row.get("objectid", 0)),
            safe_str(row.get("name")),
            safe_str(row.get("type")),
            safe_str(row.get("formation")),
            safe_str(row.get("sigle_cart")),
            source_tag,
            coords,
        ]
    else:  # ispra
        return [
            safe_int(row.get("OBJECTID", 0)),
            safe_str(row.get("nome_ulf")),
            safe_str(row.get("litologia")),
            safe_str(row.get("eta_geol")),
            safe_str(row.get("cod_lito")),
            source_tag,
            coords,
        ]

geo_records = []
for _, row in base_gdf.iterrows():
    r = serialize_geo_row(row, "ingv")
    if r:
        geo_records.append(r)

if ispra_fill is not None:
    for _, row in ispra_fill.iterrows():
        r = serialize_geo_row(row, "ispra")
        if r:
            geo_records.append(r)

geo_out = {
    "meta": {
        "sources": [
            "INGV EtnaGeoMap (Branca et al. 2011/2015) — CC-BY 4.0",
            "ISPRA CARG 1:100k litologia100k — CC-BY 4.0",
        ],
        "fields": ["id", "name", "type_or_lithology", "formation_or_age", "code", "source", "coords"],
        "count": len(geo_records),
        "bbox": [CLIP_LON_W, CLIP_LAT_S, CLIP_LON_E, CLIP_LAT_N],
    },
    "features": geo_records,
}

with open(OUT_GEOLOGY, "w") as f:
    json.dump(geo_out, f, separators=(",", ":"))

log(f"etna-regional-geology.json — {len(geo_records)} features, {OUT_GEOLOGY.stat().st_size/1024:.0f} KB")


# ── etna-tectonic-faults.json ─────────────────────────────────────────────────
# Merged ITHACA (local capable faults) + GEM (regional lineaments).
# Fields: [id, name, kinematics, rank, url, source, coords]
# coords = list-of-segments: [[[lon,lat],...], ...] (consistent for Line/MultiLine)

fault_records = []
if ithaca_gdf is not None:
    for _, row in ithaca_gdf.iterrows():
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue
        coords = geom_to_compact(geom)
        if not coords:
            continue
        fault_records.append([
            safe_int(row.get("faultcode", 0)),
            safe_str(row.get("faultname")),
            safe_str(row.get("kinematics")),
            safe_str(row.get("rank")),
            safe_str(row.get("url")),
            "ithaca",
            coords,
        ])

# Append GEM regional lineaments (they have unique catalog IDs, no dedup needed)
fault_records.extend(gem_records)

fault_out = {
    "meta": {
        "sources": [
            "ISPRA ITHACA — ITaly HAzards from CApable faults (CC-BY 4.0)",
            "GEM Global Active Faults — Styron & Pagani 2020 (CC-BY 4.0)",
        ],
        "fields": ["id", "name", "kinematics", "rank", "url", "source", "coords"],
        "coords_format": "list-of-segments: [[[lon,lat],...],...]",
        "count": len(fault_records),
        "ithaca_count": len(fault_records) - len(gem_records),
        "gem_count": len(gem_records),
        "bbox": [CLIP_LON_W, CLIP_LAT_S, CLIP_LON_E, CLIP_LAT_N],
    },
    "features": fault_records,
}

with open(OUT_FAULTS, "w") as f:
    json.dump(fault_out, f, separators=(",", ":"))

log(f"etna-tectonic-faults.json — {len(fault_records)} features "
    f"(ITHACA: {len(fault_records)-len(gem_records)}, GEM: {len(gem_records)}), "
    f"{OUT_FAULTS.stat().st_size/1024:.0f} KB")


# ═══════════════════════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════════════════════

print("\n── Summary ──────────────────────────────────────────────────────────────")
print(f"  etna-lavaflows.json        : {len(lava_records):>5} features")
print(f"  etna-regional-geology.json : {len(geo_records):>5} features  "
      f"(INGV: {len(base_gdf)}, ISPRA fill: {len(ispra_fill) if ispra_fill is not None else 0})")
print(f"  etna-tectonic-faults.json  : {len(fault_records):>5} features  "
      f"(ITHACA: {len(fault_records)-len(gem_records)}, GEM regional: {len(gem_records)})")
print(f"\n  Output directory: {VIEWER_DIR}")
print("\nDone. Verify outputs in QGIS before wiring JS toggles.")
