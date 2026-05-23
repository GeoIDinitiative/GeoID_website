#!/usr/bin/env python3
"""
preprocess_wms_geology.py

Converts the WMS-derived etna_geology_wms.shp into compact viewer JSON files:

  viewer/etna-wms-geology.json   — polygon fills for the Etna geology layer
  viewer/etna-wms-contacts.json  — contact lines between formations

Format (geology):
  {"features": [[id, formation, litho_type, litho_grp, strat_idx, rings], ...]}
  rings = [[[lon,lat], ...], ...]   (one ring per polygon exterior + holes)

Format (contacts):
  {"features": [[id, tier, [[lon,lat], ...]], ...]}
  tier: "major" = lava/scoria/sediment boundaries (from litho_type contacts)
        "minor" = inter-formation boundaries (from polygon adjacency)
"""

import json, time
from pathlib import Path
from collections import defaultdict

import numpy as np
import geopandas as gpd
from shapely.geometry import MultiLineString, LineString
from shapely.ops import unary_union, linemerge
from shapely.strtree import STRtree

INPUT_DIR  = Path(__file__).parent
VIEWER_DIR = INPUT_DIR.parent / 'viewer'
SHP_IN     = INPUT_DIR / 'etna_wms_classified' / 'etna_geology_wms.shp'
CON_IN     = INPUT_DIR / 'etna_wms_classified' / 'etna_contacts_wms.shp'
OUT_GEO    = VIEWER_DIR / 'etna-wms-geology.json'
OUT_CON    = VIEWER_DIR / 'etna-wms-contacts.json'

# Web-simplification tolerance (degrees).
# 0.0002° ≈ 18 m — individual-polygon mode; slightly higher tolerance keeps file size manageable.
SIMPLIFY_WEB = 0.0002
MIN_LEN      = 0.0005   # ~50 m — drop micro contact segments

# Stratigraphic order: lower index = older (painted first / underneath).
# Derived from INGV EtnaGeoMap legend (legend bottom = oldest).
STRAT_ORDER = {
    'Argille grigio-azzurre Formation':       0,
    'S. Giorgio sands Formation':             1,
    'Acicastello Formation':                  2,
    'S. Maria di Licodia Formation':          3,
    'San Placido Formation':                  4,
    'Timpa di Don Masi formation':            5,
    'Timpa formation':                        6,
    'S. Maria degli Ammalati formation':      7,
    'Calanna formation':                      8,
    'Moscarello formation':                   9,
    'Valverde formation':                    10,
    'Contrada Passo Cannelli formation':     11,
    'Rocche formation':                      12,
    'Piano del Trifoglietto formation':      13,
    'Monte Scorsone Formation':              14,
    'Monte Fior di Cosimo formation':        15,
    'Serra Giannicola Grande Formation':     16,
    'Valle degli Zappini Formation':         17,
    'Serra del Salifizio Formation':         18,
    'Acqua della Rocca Formation':           19,
    'Serra Cuvigghiuni Formation':           20,
    'Canalone della Montagnola Formation':   21,
    'Serra delle Concazze Formation':        22,
    'Pizzi Deneri Formation':                23,
    'Monte Calvario formation':              24,
    'Simeto formation':                      25,
    'Piano Provenzana Formation':            26,
    'Portella Giumenta formation':           27,
    'Pietracannone Formation':               28,
    'Torre del Filosofo Formation':          29,
}


MIN_PART_AREA = 8e-6   # ~90,000 m² — drop small fragments; keeps meaningful cones & flows

def geom_to_rings(geom):
    """Return list-of-rings from a Polygon or MultiPolygon, skipping tiny parts."""
    rings = []
    parts = list(geom.geoms) if hasattr(geom, 'geoms') else [geom]
    for part in parts:
        if part.is_empty or part.area < MIN_PART_AREA:
            continue
        ext = [[round(x, 6), round(y, 6)] for x, y in part.exterior.coords]
        if len(ext) >= 3:
            rings.append(ext)
        for interior in part.interiors:
            hole = [[round(x, 6), round(y, 6)] for x, y in interior.coords]
            if len(hole) >= 3:
                rings.append(hole)
    return rings


def extract_lines(shared, min_len=MIN_LEN):
    """Return list of LineString parts from any geometry."""
    parts = []
    if shared.is_empty:
        return parts
    gt = shared.geom_type
    items = list(shared.geoms) if hasattr(shared, 'geoms') else [shared]
    for g in items:
        if g.geom_type == 'LineString' and g.length > min_len:
            parts.append(g)
    return parts


# ── Load & simplify ───────────────────────────────────────────────────────────

print(f'Loading {SHP_IN} …')
gdf = gpd.read_file(str(SHP_IN))
print(f'  {len(gdf)} features')

# Fix any invalid geometries
bad = ~gdf.is_valid
if bad.any():
    gdf.loc[bad, 'geometry'] = gdf.loc[bad, 'geometry'].buffer(0)

# Web simplification
gdf['geometry'] = gdf['geometry'].simplify(SIMPLIFY_WEB, preserve_topology=True)
gdf = gdf[~gdf.geometry.is_empty & gdf.geometry.notna()].copy()
gdf = gdf.reset_index(drop=True)
print(f'  {len(gdf)} features after web simplification')


# ── Build geology JSON ────────────────────────────────────────────────────────

features = []
for idx, row in gdf.iterrows():
    fm   = row['formation']
    lt   = row['litho_type']
    grp  = row['litho_grp']
    si   = STRAT_ORDER.get(fm, 15)   # default mid-stack if unknown
    rings = geom_to_rings(row.geometry)
    if not rings:
        continue
    features.append([idx, fm, lt, grp, si, rings])

# Sort by strat_idx so JSON is already in painter's order
features.sort(key=lambda f: f[4])

formation_counts = defaultdict(int)
for f in features:
    formation_counts[f[1]] += 1

output_geo = {
    'type':    'wms_geology',
    'source':  'INGV EtnaGeoMap WMS (geodb.ct.ingv.it/EtnaGeoMap/wms) — polygonised at ~6 m/px',
    'n_features': len(features),
    'features': features,
}

with open(OUT_GEO, 'w') as fh:
    json.dump(output_geo, fh, separators=(',', ':'))

kb = OUT_GEO.stat().st_size / 1024
print(f'\n[A] {OUT_GEO.name}  —  {len(features)} features  ({kb:.0f} KB)')
for fm, n in sorted(formation_counts.items(), key=lambda x: -x[1]):
    si = STRAT_ORDER.get(fm, '?')
    lt = next((f[2] for f in features if f[1] == fm), '?')
    print(f'     [{si:2}] {fm:<45s} {n:4d}  ({lt})')


# ── Build contacts JSON ───────────────────────────────────────────────────────
# Two tiers:
#   major — litho_type class boundaries (from etna_contacts_wms.shp)
#   minor — inter-formation boundaries computed from polygon adjacency

print(f'\nBuilding contacts …')
t0 = time.time()
contact_feats = []
fid = 0

# — Major tier: litho_type contacts from contacts SHP —
if CON_IN.exists():
    cdf = gpd.read_file(str(CON_IN))
    for _, crow in cdf.iterrows():
        geom = crow.geometry
        if geom is None or geom.is_empty:
            continue
        parts = list(geom.geoms) if hasattr(geom, 'geoms') else [geom]
        for p in parts:
            if p.geom_type != 'LineString' or p.length < MIN_LEN:
                continue
            s = p.simplify(SIMPLIFY_WEB, preserve_topology=True)
            if s.is_empty or s.length < MIN_LEN:
                continue
            coords = [[round(x, 6), round(y, 6)] for x, y in s.coords]
            if len(coords) >= 2:
                contact_feats.append([fid, 'major', coords])
                fid += 1
    print(f'  major tier: {fid} segments from litho_type contacts')

# — Minor tier: inter-formation boundaries from polygon adjacency —
n = len(gdf)
sindex = gdf.sindex
minor_lines = []
for i in range(n):
    geom_i = gdf.geometry.iloc[i]
    fm_i   = gdf['formation'].iloc[i]
    for j in sindex.query(geom_i, predicate='intersects'):
        if j <= i:
            continue
        fm_j = gdf['formation'].iloc[j]
        if fm_i == fm_j:
            continue
        shared = geom_i.boundary.intersection(gdf.geometry.iloc[j].boundary)
        minor_lines.extend(extract_lines(shared))
    if (i + 1) % 1000 == 0:
        print(f'  … {i+1}/{n}  ({time.time()-t0:.0f}s)')

print(f'  {len(minor_lines)} raw minor segments')

if minor_lines:
    merged = linemerge(unary_union(MultiLineString(minor_lines)))
    parts  = list(merged.geoms) if hasattr(merged, 'geoms') else [merged]
    for p in parts:
        s = p.simplify(SIMPLIFY_WEB, preserve_topology=True)
        if s.is_empty or s.length < MIN_LEN:
            continue
        coords = [[round(x, 6), round(y, 6)] for x, y in s.coords]
        if len(coords) >= 2:
            contact_feats.append([fid, 'minor', coords])
            fid += 1

major_n = sum(1 for f in contact_feats if f[1] == 'major')
minor_n = sum(1 for f in contact_feats if f[1] == 'minor')
print(f'  total: {major_n} major + {minor_n} minor = {len(contact_feats)} contact segments')

output_con = {
    'type':   'wms_contacts',
    'source': 'Derived from INGV EtnaGeoMap WMS polygons',
    'major_count': major_n,
    'minor_count': minor_n,
    'features': contact_feats,
}

with open(OUT_CON, 'w') as fh:
    json.dump(output_con, fh, separators=(',', ':'))

kb2 = OUT_CON.stat().st_size / 1024
print(f'[B] {OUT_CON.name}  —  {len(contact_feats)} contacts  ({kb2:.0f} KB)')
print(f'\nDone in {time.time()-t0:.0f}s')
