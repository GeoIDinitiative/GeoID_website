#!/usr/bin/env python3
"""
fetch_egdi_geology.py

Downloads the EGDI 1:1M pan-European surface geology (gsmlp:GeologicUnitView)
from GeoZS GeoServer via WFS, clips to the Etna viewer domain, simplifies, and
writes viewer/etna-regional-geology.json.

Feature format:
  [id, name, lithology, age, source, color_hex, rings]

  0  id          – WFS feature integer id (for PIP)
  1  name        – map symbol / unit code (e.g. "GM11")
  2  lithology   – INSPIRE lithology short code (e.g. "impureLimestone")
  3  age         – INSPIRE geochronologic era short code (e.g. "langhian")
  4  source      – data provider (e.g. "IT-ISPRA")
  5  color_hex   – "#rrggbb" assigned by lithology group
  6  rings       – [[[lon,lat], ...], ...]

Run from this directory (or any):
  python3 fetch_egdi_geology.py
"""

import json, re, time
from pathlib import Path
from collections import defaultdict

import numpy as np
import requests
from shapely.geometry import shape, box, Polygon, MultiPolygon, Point
from shapely.ops import unary_union
from shapely.strtree import STRtree
from shapely.validation import make_valid

INPUT_DIR  = Path(__file__).parent
VIEWER_DIR = INPUT_DIR.parent / 'viewer'
OUT        = VIEWER_DIR / 'etna-regional-geology.json'
CACHE      = INPUT_DIR / 'egdi_geology_raw.geojson'

WFS_URL   = 'https://geoserver.geo-zs.si/egdi-surface-geology/gsmlp/ows'
LAYER     = 'gsmlp:GeologicUnitView'

# Domain = SAT_GRID tile extent (what _lonLatToCanvas maps to).
# SAT_GRID = tileToLon/Lat(SAT_X0/Y0, SAT_X1+1/Y1+1) at zoom 13, tiles 4424-4451 × 3152-3181.
# This is WIDER than SAT_LON/LAT (the declared geographic domain): the tile grid
# extends ~7 km south, ~7 km north, ~2 km west, ~8 km east beyond the declared bounds.
# Using SAT_GRID here ensures geology covers the full canvas — no bare fringe strips.
LON_W, LAT_S, LON_E, LAT_N = 14.414063, 37.230328, 15.644531, 38.272689
CLIP_BOX = box(LON_W, LAT_S, LON_E, LAT_N)

SIMPLIFY_TOL = 0.001   # 1:1M scale — ~100 m, appropriate for this source
MIN_AREA     = 5e-5    # ~0.4 km² — drop slivers


# ── INSPIRE lithology → viewer color ──────────────────────────────────────────
# Groups derived from the INSPIRE LithologyValue codelist.

LITH_COLOR = {
    # Volcanic / igneous intrusive
    'basalt':                       '#b84a2d',
    'tephrite':                     '#c25030',
    'phonolite':                    '#c85535',
    'rhyolite':                     '#d46040',
    'dacite':                       '#ca5838',
    'andesite':                     '#cc5c3c',
    'trachyte':                     '#cf5f3e',
    'volcanicRock':                 '#c05535',
    'pyroclasticRock':              '#d87845',
    'tuff':                         '#d88050',
    'igneousRock':                  '#c05535',
    'granitoid':                    '#e8a090',
    'granite':                      '#e8a090',
    'diorite':                      '#d898a8',
    'gabbro':                       '#9870a8',
    'ultramaficIgneousRock':        '#7850a0',
    'intrusiveRock':                '#d090a0',

    # Metamorphic
    'metamorphicRock':              '#9060c8',
    'schist':                       '#9868c8',
    'phyllite':                     '#a070c8',
    'gneiss':                       '#8858c0',
    'marble':                       '#d8d8f0',
    'quartzite':                    '#c8c0e8',
    'hornfels':                     '#a880d0',

    # Carbonates
    'limestone':                    '#78bede',
    'impureLimestone':              '#88c8e0',
    'dolomite':                     '#9bcce8',
    'chalk':                        '#b8dff0',
    'carbonateRock':                '#80c8e8',
    'marlstone':                    '#8ca8c0',
    'calcareousShale':              '#90b0c0',

    # Clastics / siliciclastic
    'sandstone':                    '#e89050',
    'quartzArenite':                '#f0b060',
    'arkose':                       '#e08848',
    'conglomerate':                 '#c87840',
    'breccia':                      '#c07838',
    'mudstone':                     '#b09080',
    'shale':                        '#a88878',
    'siltstone':                    '#c09878',
    'claystoneMudstone':            '#c09878',
    'claystone':                    '#c09878',
    'flysch':                       '#c0a870',
    'turbidite':                    '#c0a870',
    'pelite':                       '#b89878',

    # Evaporites / chemical
    'evaporite':                    '#f5eaa0',
    'rocksalt':                     '#f8f0c0',
    'gypsum':                       '#f5eaa0',

    # Unconsolidated / Quaternary
    'unconsolidatedMaterial':       '#d8c898',
    'gravel':                       '#d0c090',
    'sand':                         '#e0d0a0',
    'silt':                         '#c8b888',
    'clay':                         '#c0b080',
    'alluvium':                     '#d8c898',
    'peat':                         '#a08848',
    'anthropogenicMaterial':        '#b0a898',

    # Clastic / mixed sedimentary (INSPIRE compound terms)
    'clasticSediment':              '#d0b878',
    'clasticSedimentaryRock':       '#c8a868',
    'carbonateSedimentaryRock':     '#90c8dc',
    'impureCarbonateSediment':      '#a0c8d8',
    'micaSchist':                   '#9868c8',
    'pelite':                       '#b89878',
    'peliteSandstone':              '#c0a070',
    'mixtureOfRockTypes':           '#b0a898',

    # Catch-all
    'rock':                         '#b0a898',
    'sedimentaryRock':              '#c8b870',
    'unknown':                      '#a8a090',
}

def lith_short(uri_or_code):
    """Extract short code from INSPIRE URI or pass through if already short."""
    if not uri_or_code or uri_or_code in ('unknown', ''):
        return 'unknown'
    # e.g. http://inspire.ec.europa.eu/codelist/LithologyValue/impureLimestone
    if '/' in uri_or_code:
        return uri_or_code.rstrip('/').split('/')[-1]
    return uri_or_code

def age_short(uri_or_code):
    if not uri_or_code or 'unknown' in uri_or_code.lower() or 'nil' in uri_or_code.lower():
        return ''
    if '/' in uri_or_code:
        return uri_or_code.rstrip('/').split('/')[-1]
    return uri_or_code

def lith_color(lith_code):
    if lith_code in LITH_COLOR:
        return LITH_COLOR[lith_code]
    # Try prefix match (e.g. "basalticAndesite" → "basalt" group)
    for key in LITH_COLOR:
        if lith_code.lower().startswith(key.lower()):
            return LITH_COLOR[key]
    return LITH_COLOR['unknown']

def geom_to_rings(geom, min_area=MIN_AREA):
    rings = []
    parts = list(geom.geoms) if hasattr(geom, 'geoms') else [geom]
    for part in parts:
        if not isinstance(part, Polygon) or part.is_empty or part.area < min_area:
            continue
        ext = [[round(x, 6), round(y, 6)] for x, y in part.exterior.coords]
        if len(ext) >= 3:
            rings.append(ext)
        for hole in part.interiors:
            h = [[round(x, 6), round(y, 6)] for x, y in hole.coords]
            if len(h) >= 3:
                rings.append(h)
    return rings


# ── 1. Fetch (or load from cache) ─────────────────────────────────────────────

if CACHE.exists():
    print(f'Using cached GeoJSON: {CACHE}  ({CACHE.stat().st_size/1e6:.2f} MB)')
    raw = json.loads(CACHE.read_text())
else:
    print('Fetching EGDI WFS (gsmlp:GeologicUnitView) …')
    params = dict(
        SERVICE='WFS', VERSION='2.0.0', REQUEST='GetFeature',
        TYPENAMES=LAYER,
        BBOX=f'{LON_W},{LAT_S},{LON_E},{LAT_N},EPSG:4326',
        srsName='EPSG:4326',
        outputFormat='application/json',
        count=5000,
    )
    t0 = time.time()
    r = requests.get(WFS_URL, params=params, timeout=120)
    r.raise_for_status()
    raw = r.json()
    CACHE.write_text(json.dumps(raw))
    print(f'  {len(raw["features"])} features in {time.time()-t0:.1f}s  ({CACHE.stat().st_size/1e3:.0f} KB)')

feats_raw = raw.get('features', [])
print(f'Raw features: {len(feats_raw)}')


# ── 2. Parse + clip + simplify ─────────────────────────────────────────────────

features   = []
feat_geoms = []   # parallel list of shapely geoms, kept for gap-fill step
skipped    = 0
fid        = 0

lith_counts = defaultdict(int)
age_counts  = defaultdict(int)
src_counts  = defaultdict(int)

for f in feats_raw:
    props = f.get('properties', {})
    geom_raw = f.get('geometry')
    if not geom_raw:
        skipped += 1; continue

    try:
        geom = shape(geom_raw)
    except Exception:
        skipped += 1; continue

    if not geom.is_valid:
        geom = make_valid(geom)
    if geom.is_empty:
        skipped += 1; continue

    # Clip to domain
    geom = geom.intersection(CLIP_BOX)
    if geom.is_empty:
        skipped += 1; continue

    # Simplify
    geom = geom.simplify(SIMPLIFY_TOL, preserve_topology=True)
    if geom.is_empty:
        skipped += 1; continue

    rings = geom_to_rings(geom)
    if not rings:
        skipped += 1; continue

    lith_uri = props.get('representativeLithology_uri') or props.get('lithology') or ''
    age_uri  = props.get('representativeAge_uri') or ''

    lith = lith_short(lith_uri)
    age  = age_short(age_uri)
    src  = props.get('source') or ''
    name = props.get('name') or ''
    color = lith_color(lith)

    lith_counts[lith] += 1
    age_counts[age]   += 1
    src_counts[src]   += 1

    features.append([fid, name, lith, age, src, color, rings])
    feat_geoms.append(geom)   # keep shapely geom for gap-fill
    fid += 1

print(f'Parsed: {len(features)} features  ({skipped} skipped)')


# ── 3. Gap-fill: assign each contiguous gap polygon to its nearest EGDI feature ──
# EGDI source is missing ~33% of the domain (Catania coastal plain, S/NW margins).
# Strategy: split the gap into contiguous parts; for each part sample a dense grid
# of interior points, find each point's nearest EGDI feature (by geometry distance),
# count votes → assign gap part to the plurality feature.  This gives smooth
# natural boundaries and a compact output (one polygon per gap part × feature split).

from shapely.ops import unary_union

# feat_geoms was built alongside features during parse step (same shapely geoms).
covered  = make_valid(unary_union(feat_geoms))
gap      = CLIP_BOX.difference(covered)
gap_area = gap.area
print(f'\nDomain coverage gap: {gap_area/CLIP_BOX.area*100:.1f}%')

GAP_FILL_FEATURES = []
if gap_area > 1e-6:
    tree = STRtree(feat_geoms)

    gap_parts = list(gap.geoms) if hasattr(gap, 'geoms') else [gap]
    print(f'  Contiguous gap parts: {len(gap_parts)}')

    SAMPLE_SPACING = 0.02   # ~2 km sample grid per gap part — enough to capture colour variation
    for part in gap_parts:
        b = part.bounds   # minx, miny, maxx, maxy
        # Sample a grid of interior points to vote on nearest feature per sub-region
        xs = np.arange(b[0] + SAMPLE_SPACING / 2, b[2], SAMPLE_SPACING)
        ys = np.arange(b[1] + SAMPLE_SPACING / 2, b[3], SAMPLE_SPACING)
        votes = defaultdict(int)
        for x in xs:
            for y in ys:
                pt = Point(x, y)
                if not part.contains(pt):
                    continue
                nearest_idx = tree.nearest(pt)
                votes[nearest_idx] += 1

        if not votes:
            # Fallback: use centroid's nearest feature
            c = part.centroid
            nearest_idx = tree.nearest(c)
            votes[nearest_idx] = 1

        # Assign the whole gap part to the plurality feature
        feat_idx = max(votes, key=votes.__getitem__)
        rings_fill = geom_to_rings(part.simplify(SIMPLIFY_TOL, preserve_topology=True),
                                   min_area=MIN_AREA / 10)
        if not rings_fill:
            continue
        f = features[feat_idx]
        GAP_FILL_FEATURES.append([fid, f[1], f[2], f[3], f[4], f[5], rings_fill])
        fid += 1

    print(f'  Gap-fill polygons added: {len(GAP_FILL_FEATURES)}')

features.extend(GAP_FILL_FEATURES)


# ── 4. Write JSON ──────────────────────────────────────────────────────────────

output = {
    'type':       'egdi_surface_geology',
    'source':     'EGDI 1:1M pan-European Surface Geology — GeoZS / INSPIRE WFS (CC-BY 4.0)',
    'n_features': len(features),
    'fields':     ['id', 'name', 'lithology', 'age', 'source', 'color_hex', 'rings'],
    'features':   features,
}

with open(OUT, 'w') as fh:
    json.dump(output, fh, separators=(',', ':'))

kb = OUT.stat().st_size / 1024
print(f'\nWrote {OUT}  ({kb:.0f} KB)')

print('\nLithology breakdown:')
for k, n in sorted(lith_counts.items(), key=lambda x: -x[1])[:20]:
    print(f'  {n:4d}  {k}  → {lith_color(k)}')

print('\nAge breakdown:')
for k, n in sorted(age_counts.items(), key=lambda x: -x[1])[:15]:
    print(f'  {n:4d}  {k}')

print('\nSource breakdown:')
for k, n in sorted(src_counts.items(), key=lambda x: -x[1]):
    print(f'  {n:4d}  {k}')
