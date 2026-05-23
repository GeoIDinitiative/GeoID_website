#!/usr/bin/env python3
"""
preprocess_contacts.py

Generates etna-contacts.json — geological contact lines for the Etna viewer.

Two source tiers:
  major    — INGV EtnaGeoMap: boundaries between Volcanic/Sedimentary/Metamorphic types
  minor    — INGV EtnaGeoMap: boundaries between different formations within same type
  regional — ISPRA CARG 1:100k: boundaries between dissolved lithology-type polygons
             (same-type polygons dissolved first so map-sheet grid artifacts disappear)

Output: earth_explorer/etna/viewer/etna-contacts.json
Format: {"features": [[id, tier, [[lon,lat],...]], ...], "meta": {...}}
"""

import geopandas as gpd
import numpy as np
import json, os, time, sys
from collections import defaultdict
from pathlib import Path
from shapely.geometry import LineString, MultiLineString, Polygon, MultiPolygon
from shapely.ops import unary_union, linemerge

INPUT_DIR  = Path(__file__).parent
VIEWER_DIR = INPUT_DIR.parent / 'viewer'

SHP_PATH      = INPUT_DIR / 'etna_geology_shp' / 'etna_geology.shp'
REGIONAL_JSON = VIEWER_DIR / 'etna-regional-geology.json'
OUT_PATH      = VIEWER_DIR / 'etna-contacts.json'

CLIP_BOX  = (14.433, 37.305, 15.573, 38.205)
SIMPLIFY  = 0.00015   # ~16 m
MIN_LEN   = 0.001     # ~100 m — drop micro-segments


# ── Helpers ──────────────────────────────────────────────────────────────────

def extract_lines(shared, min_len=MIN_LEN):
    """Return list of LineString parts from any geometry."""
    parts = []
    if shared.is_empty:
        return parts
    gt = shared.geom_type
    if gt == 'LineString':
        if shared.length > min_len:
            parts.append(shared)
    elif gt in ('MultiLineString', 'GeometryCollection'):
        for g in (shared.geoms if hasattr(shared, 'geoms') else []):
            if g.geom_type == 'LineString' and g.length > min_len:
                parts.append(g)
    return parts


def process_tier(lines, tolerance):
    if not lines:
        return []
    merged = linemerge(unary_union(MultiLineString(lines)))
    parts  = list(merged.geoms) if hasattr(merged, 'geoms') else [merged]
    result = []
    for p in parts:
        s = p.simplify(tolerance, preserve_topology=True)
        if not s.is_empty and s.length > MIN_LEN:
            result.append(s)
    return result


# ── PART A: INGV EtnaGeoMap contacts ─────────────────────────────────────────

features = []
fid = 0

if SHP_PATH.exists():
    print("[A] INGV EtnaGeoMap contacts …")
    gdf = gpd.read_file(str(SHP_PATH))
    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs('EPSG:4326')
    gdf = gdf.clip(CLIP_BOX).reset_index(drop=True)
    gdf['type'] = gdf['type'].str.strip()
    gdf.loc[gdf['type'] == 'Vulcanico',    'type'] = 'Volcanic'
    gdf.loc[gdf['type'] == 'Sedimentario', 'type'] = 'Sedimentary'
    gdf['formation'] = gdf['formation'].fillna('').str.strip()
    print(f"  {len(gdf)} polygons after clip")

    sindex = gdf.sindex
    t0 = time.time()
    major_lines, minor_lines = [], []
    n = len(gdf)
    for i in range(n):
        geom_i = gdf.geometry.iloc[i]
        type_i = gdf['type'].iloc[i]
        form_i = gdf['formation'].iloc[i]
        for j in list(sindex.query(geom_i, predicate='intersects')):
            if j <= i:
                continue
            shared = geom_i.boundary.intersection(gdf.geometry.iloc[j].boundary)
            parts  = extract_lines(shared)
            if not parts:
                continue
            if type_i != gdf['type'].iloc[j]:
                major_lines.extend(parts)
            elif form_i and gdf['formation'].iloc[j] and form_i != gdf['formation'].iloc[j]:
                minor_lines.extend(parts)
        if (i + 1) % 500 == 0:
            print(f"  … {i+1}/{n} ({time.time()-t0:.0f}s)")

    print(f"  Done ({time.time()-t0:.0f}s) — raw major={len(major_lines)}, minor={len(minor_lines)}")
    major_proc = process_tier(major_lines, SIMPLIFY)
    minor_proc = process_tier(minor_lines, SIMPLIFY * 1.5)
    print(f"  major: {len(major_lines)} → {len(major_proc)}")
    print(f"  minor: {len(minor_lines)} → {len(minor_proc)}")

    def add_lines(lines, tier):
        global fid
        for line in lines:
            parts = list(line.geoms) if hasattr(line, 'geoms') else [line]
            for part in parts:
                coords = [[round(x, 6), round(y, 6)] for x, y in part.coords]
                if len(coords) >= 2:
                    features.append([fid, tier, coords])
                    fid += 1

    add_lines(major_proc, 'major')
    add_lines(minor_proc, 'minor')
else:
    print("[A] INGV shapefile not found — skipping INGV contacts")


# ── PART B: ISPRA dissolved lithology-type contacts ───────────────────────────

if REGIONAL_JSON.exists():
    print("\n[B] ISPRA dissolved lithology contacts …")
    with open(REGIONAL_JSON) as f:
        geo_data = json.load(f)

    ispra_feats = [feat for feat in geo_data['features'] if feat[5] == 'ispra']
    print(f"  {len(ispra_feats)} ISPRA features")

    # Reconstruct Shapely polygons from compact ring arrays.
    # Each feat[6] = list of rings; each ring = [[lon,lat],...].
    # geom_to_compact() flattens MultiPolygon rings, so we treat every ring
    # independently as a simple polygon — holes are thus filled, which slightly
    # over-covers but is acceptable for computing inter-type contact lines.
    litho_polys = defaultdict(list)
    for feat in ispra_feats:
        lit = feat[2] or 'unknown'
        for ring in feat[6]:
            if len(ring) < 3:
                continue
            try:
                poly = Polygon(ring)
                if poly.is_valid and not poly.is_empty and poly.area > 1e-8:
                    litho_polys[lit].append(poly)
            except Exception:
                pass

    print(f"  {len(litho_polys)} distinct lithology types")

    # Dissolve each lithology group
    dissolved = {}
    for lit, polys in litho_polys.items():
        try:
            u = unary_union(polys)
            if not u.is_empty:
                dissolved[lit] = u
        except Exception as e:
            print(f"  Warning: dissolve failed for '{lit}': {e}")

    print(f"  {len(dissolved)} dissolved type polygons")

    # Find inter-type boundary lines using spatial index
    lits   = list(dissolved.keys())
    geoms  = list(dissolved.values())
    from shapely.strtree import STRtree
    tree   = STRtree(geoms)

    t0 = time.time()
    regional_lines = []
    for i, (lit_i, geom_i) in enumerate(zip(lits, geoms)):
        cands = list(tree.query(geom_i, predicate='intersects'))
        for j in cands:
            if j <= i:
                continue
            lit_j  = lits[j]
            if lit_i == lit_j:
                continue
            shared = geom_i.boundary.intersection(geoms[j].boundary)
            regional_lines.extend(extract_lines(shared))
        if (i + 1) % 50 == 0:
            print(f"  … {i+1}/{len(lits)} ({time.time()-t0:.0f}s)")

    print(f"  {len(regional_lines)} raw regional boundary segments")

    regional_proc = process_tier(regional_lines, SIMPLIFY * 1.5)
    print(f"  → {len(regional_proc)} merged regional contact lines")

    def add_regional(lines):
        global fid
        for line in lines:
            parts = list(line.geoms) if hasattr(line, 'geoms') else [line]
            for part in parts:
                coords = [[round(x, 6), round(y, 6)] for x, y in part.coords]
                if len(coords) >= 2:
                    features.append([fid, 'regional', coords])
                    fid += 1

    add_regional(regional_proc)
else:
    print("[B] etna-regional-geology.json not found — run preprocess_geology.py first")


# ── Output ───────────────────────────────────────────────────────────────────

major_count    = sum(1 for f in features if f[1] == 'major')
minor_count    = sum(1 for f in features if f[1] == 'minor')
regional_count = sum(1 for f in features if f[1] == 'regional')

output = {
    "type": "contacts",
    "source": "INGV EtnaGeoMap (Branca et al. 2011/2015) + ISPRA CARG 1:100k",
    "major_count":    major_count,
    "minor_count":    minor_count,
    "regional_count": regional_count,
    "features": features,
}

with open(OUT_PATH, 'w') as fh:
    json.dump(output, fh, separators=(',', ':'))

kb = OUT_PATH.stat().st_size / 1024
print(f"\n[Output] {OUT_PATH}")
print(f"  {len(features)} total contact segments ({kb:.0f} KB)")
print(f"  major (INGV type boundaries):        {major_count}")
print(f"  minor (INGV formation boundaries):   {minor_count}")
print(f"  regional (ISPRA dissolved litho):    {regional_count}")
