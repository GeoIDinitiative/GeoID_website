#!/usr/bin/env python3
"""
build_etna_geology_shp.py

Re-processes the INGV EtnaGeoMap shapefile (etna_geology_shp/etna_geology.shp)
into a clean, lithology-first classified SHP suitable for QGIS styling and
as a viewer data source.

Outputs (in etna_geology_classified/):
  etna_geology_classified.shp  — classified polygons
  etna_geology_contacts.shp    — contact lines between different litho_type units

Lithology classes (top-level):
  lava_flow     — all individual eruption flow fields (the dominant type)
  scoria_tephra — cinder cones, pyroclastic fall/flow deposits, volcaniclastic
  intrusion     — subvolcanic bodies, domes, necks, plugs, salinelle
  sediment      — alluvial, fluvial, marine, flysch, marly, limestone (Sedimentary)
  basement      — metamorphic/Paleozoic rocks

Age era sub-field (lava_flow only):
  post1900, c19, c17c18, medieval, ancient, prehistoric, unknown
"""

import geopandas as gpd
import numpy as np
import re, json, time, shutil
from pathlib import Path
from shapely.geometry import MultiPolygon, Polygon
from shapely.ops import unary_union, linemerge
from shapely.strtree import STRtree
from collections import defaultdict, Counter

INPUT_DIR   = Path(__file__).parent
OUT_DIR     = INPUT_DIR / 'etna_geology_classified'
SHP_IN      = INPUT_DIR / 'etna_geology_shp' / 'etna_geology.shp'
CLIP_BOX    = (14.433, 37.305, 15.573, 38.205)
SIMPLIFY_M  = 0.00005   # ~5 m — light pass, keeps contacts sharp


# ── Classification ────────────────────────────────────────────────────────────

def _classify(row):
    name = str(row.get('name')      or '').lower()
    lith = str(row.get('lithology') or '').lower()
    typ  = str(row.get('type')      or '').lower()

    # Lava flows first — most common and most distinctive
    if any(k in name for k in ('lava flow', 'lva flow', 'lava folw')):
        return 'lava_flow'

    # Scoria cones and pyroclastic deposits
    if any(k in name for k in (
        'scoria cone', 'scoria flow', 'pyroclastic', 'fallout',
        'fall deposit', 'fall pyroclastic', 'volcaniclastic', 'volcanoclastic',
        'debris avalanche', 'autoclastic', 'epiclastic', 'pumice',
    )):
        return 'scoria_tephra'
    if any(k in lith for k in ('scoriaceous', 'scoriaceuos', 'spatter', 'pumice lapilli',
                                'ash', 'lapilli', 'paleosoil')):
        return 'scoria_tephra'

    # Intrusions / sub-volcanic / domes
    if any(k in name for k in (
        'dyke', 'dike', 'sill', 'intrusion', 'plug', 'neck',
        'subvolcanic', 'submarine', 'dome', 'salinelle',
    )):
        return 'intrusion'

    # Slope / alluvial deposits inside volcanic map extent → sediment
    if any(k in name for k in ('slope deposit', 'alluvial deposit', 'antropic deposit')):
        return 'sediment'

    # Sedimentary type (INGV field)
    if 'sediment' in typ:
        return 'sediment'

    # Metamorphic type
    if 'metamorphic' in typ:
        return 'basement'

    # Remaining volcanic (cataclastic lavas, generic volcanic) → scoria_tephra
    if 'volcanic' in typ or 'vulcanico' in typ:
        return 'scoria_tephra'

    return 'sediment'  # safe fallback


def _parse_year(age_str):
    """Return calendar year int or None.  -999 = clearly prehistoric."""
    if not age_str or not str(age_str).strip():
        return None
    s = str(age_str).strip()
    if re.search(r'\bka\b|\bMa\b|Radiometric|40Ar|39Ar|Ra/Th|Paleomag|Archeo-mag', s, re.I):
        # Try to pull an AD year from archeo/paleomagnetic strings first
        m_ad = re.search(r'(\d{3,4})\s*(?:AD|±)', s)
        if m_ad:
            y = int(m_ad.group(1))
            if 500 <= y <= 2100:
                return y
        return -999  # prehistoric / radiometric
    m = re.search(r'\b(\d{3,4})\b', s)
    if m:
        y = int(m.group(1))
        if 500 <= y <= 2100:
            return y
    return None


def _age_era(y):
    if y is None:  return 'unknown'
    if y == -999:  return 'prehistoric'
    if y >= 1900:  return 'post1900'
    if y >= 1800:  return 'c19'
    if y >= 1600:  return 'c17c18'
    if y >= 1000:  return 'medieval'
    return 'ancient'


# ── Suggested QGIS fill colours per class (RRGGBB) ───────────────────────────

LITHO_COLORS = {
    'lava_flow':     '#b04b2d',
    'scoria_tephra': '#d07840',
    'intrusion':     '#8c5e8c',
    'sediment':      '#cfc388',
    'basement':      '#7264b4',
}

LAVA_ERA_COLORS = {
    'post1900':   '#da2a0a',
    'c19':        '#ca4c14',
    'c17c18':     '#b4601c',
    'medieval':   '#984822',
    'ancient':    '#76372e',
    'prehistoric':'#622e1a',
    'unknown':    '#944224',
}


# ── Load & clip ───────────────────────────────────────────────────────────────

print(f"Reading {SHP_IN} …")
gdf = gpd.read_file(str(SHP_IN))
if gdf.crs and gdf.crs.to_epsg() != 4326:
    gdf = gdf.to_crs('EPSG:4326')

gdf = gdf.clip(CLIP_BOX).copy()
print(f"  {len(gdf)} features after clip")


# ── Fix invalid geometries ────────────────────────────────────────────────────

bad = ~gdf.is_valid
if bad.any():
    print(f"  Fixing {bad.sum()} invalid geometries (buffer(0)) …")
    gdf.loc[bad, 'geometry'] = gdf.loc[bad, 'geometry'].buffer(0)


# ── Classify ─────────────────────────────────────────────────────────────────

print("Classifying …")
gdf['litho_type'] = gdf.apply(_classify, axis=1)
gdf['age_year']   = gdf['age'].apply(_parse_year).astype('Int64')
gdf['age_era']    = gdf['age_year'].apply(lambda y: _age_era(int(y) if y is not None and not (isinstance(y, float) and np.isnan(y)) else None))

counts = Counter(gdf['litho_type'])
for k, v in counts.most_common():
    print(f"  {k}: {v}")


# ── Simplify ──────────────────────────────────────────────────────────────────

print(f"Simplifying (tolerance={SIMPLIFY_M}°) …")
gdf['geometry'] = gdf['geometry'].simplify(SIMPLIFY_M, preserve_topology=True)
# Drop any that collapsed to empty / null
gdf = gdf[~gdf['geometry'].is_empty & gdf['geometry'].notna()].copy()
print(f"  {len(gdf)} features after simplification")


# ── Select & rename output attributes ────────────────────────────────────────

# Project to UTM 33N for area calculation
gdf_utm = gdf.to_crs('EPSG:32633')
gdf['area_km2'] = (gdf_utm['geometry'].area / 1e6).round(4)

out = gdf[[
    'litho_type', 'age_era', 'age_year', 'name',
    'age', 'formation', 'syntem', 'supersynte',
    'area_km2', 'geometry',
]].copy()

# SHP field names max 10 chars
out = out.rename(columns={
    'litho_type': 'litho_type',
    'age_era':    'age_era',
    'age_year':   'age_year',
    'name':       'name',
    'age':        'age_str',
    'formation':  'formation',
    'syntem':     'syntem',
    'supersynte': 'suprsynt',
    'area_km2':   'area_km2',
})


# ── Write classified SHP ──────────────────────────────────────────────────────

OUT_DIR.mkdir(exist_ok=True)
out_shp = OUT_DIR / 'etna_geology_classified.shp'
out.to_file(str(out_shp))
print(f"\n[A] Wrote {out_shp}  ({len(out)} features)")


# ── Build contact lines between different litho_type units ───────────────────

print("\nBuilding contacts …")
t0 = time.time()

# Dissolve by litho_type to get one geometry per class
litho_geoms = {}
for lt in out['litho_type'].unique():
    sub = out[out['litho_type'] == lt]
    try:
        dissolved = unary_union(sub['geometry'].values)
        if not dissolved.is_empty:
            litho_geoms[lt] = dissolved
    except Exception as e:
        print(f"  Warning: dissolve failed for {lt}: {e}")

lits  = list(litho_geoms.keys())
geoms = list(litho_geoms.values())
tree  = STRtree(geoms)

contact_feats = []
for i, (lt_i, geom_i) in enumerate(zip(lits, geoms)):
    for j in tree.query(geom_i, predicate='intersects'):
        if j <= i:
            continue
        lt_j   = lits[j]
        shared = geom_i.boundary.intersection(geoms[j].boundary)
        if shared.is_empty:
            continue
        parts = (list(shared.geoms) if hasattr(shared, 'geoms') else [shared])
        for p in parts:
            if p.geom_type in ('LineString', 'MultiLineString') and p.length > 0.0001:
                contact_feats.append({
                    'contact':  f'{lt_i}|{lt_j}',
                    'litho_a':  lt_i,
                    'litho_b':  lt_j,
                    'geometry': p,
                })

print(f"  {len(contact_feats)} contact segments  ({time.time()-t0:.0f}s)")

if contact_feats:
    contacts_gdf = gpd.GeoDataFrame(contact_feats, crs='EPSG:4326')
    out_contacts = OUT_DIR / 'etna_geology_contacts.shp'
    contacts_gdf.to_file(str(out_contacts))
    print(f"[B] Wrote {out_contacts}  ({len(contacts_gdf)} features)")


# ── Write companion QGIS style hint (JSON) ───────────────────────────────────

style_hint = {
    "description": "Suggested fill colours for etna_geology_classified.shp",
    "litho_type_colors": LITHO_COLORS,
    "lava_era_colors": LAVA_ERA_COLORS,
    "contacts": {
        "lava_flow|scoria_tephra":  "#3a1e08",
        "lava_flow|sediment":       "#5a3a1a",
        "lava_flow|basement":       "#2a1a5a",
        "scoria_tephra|sediment":   "#6a4a2a",
        "sediment|basement":        "#4a3a7a",
    },
}
style_path = OUT_DIR / 'style_hints.json'
with open(style_path, 'w') as fh:
    json.dump(style_hint, fh, indent=2)
print(f"[C] Wrote {style_path}")

print("\nDone.")
