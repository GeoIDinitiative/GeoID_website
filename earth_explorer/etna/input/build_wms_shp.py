#!/usr/bin/env python3
"""
build_wms_shp.py

Constructs a brand-new Etna geology shapefile from the INGV EtnaGeoMap WMS
(geodb.ct.ingv.it/EtnaGeoMap/wms) entirely from scratch:

  1. Tile the WMS at maximum resolution (4096×4096 per tile, 2×2 grid → ~6m/px)
  2. Mosaic tiles into a single georeferenced raster
  3. Colour-snap every pixel to the nearest canonical legend colour (KD-tree)
  4. Morphological cleaning: remove anti-aliasing, text labels, and line artefacts
  5. Polygonize with rasterio
  6. Attribute each polygon (formation name, litho_type, litho_group, era)
  7. Dissolve small slivers, fix topology, simplify
  8. Export  etna_wms_classified/ *.shp

Outputs (in etna_wms_classified/):
  etna_geology_wms.shp     — classified polygons, WGS84
  etna_contacts_wms.shp    — contact lines between different litho_type units
  etna_geology_wms.tif     — cleaned colour-snapped GeoTIFF (for inspection)
  colour_map.json          — colour → formation → litho_type lookup
"""

import io, json, time, warnings
from pathlib import Path

import numpy as np
import requests
from PIL import Image
from scipy.spatial import KDTree
from scipy.ndimage import median_filter, label as nd_label, distance_transform_edt
import geopandas as gpd
import rasterio
from rasterio.transform import from_bounds
from rasterio.features import shapes as rio_shapes
from shapely.geometry import shape, MultiPolygon
from shapely.ops import unary_union, linemerge
from shapely.strtree import STRtree
from collections import Counter

warnings.filterwarnings('ignore')

INPUT_DIR   = Path(__file__).parent
OUT_DIR     = INPUT_DIR / 'etna_wms_classified'
OUT_DIR.mkdir(exist_ok=True)
MOSAIC_CACHE = OUT_DIR / 'mosaic_cache.npy'   # cached raw RGB so tiles aren't re-fetched
LABEL_CACHE  = OUT_DIR / 'label_cache.npy'   # cached colour-snap output (skips fetch + snap)

# ── WMS configuration ─────────────────────────────────────────────────────────

WMS_BASE  = 'https://geodb.ct.ingv.it/EtnaGeoMap/wms'
LAYER     = 'EtnaGeologicalMap'
# Native extent from GetCapabilities
LON_W, LAT_S = 14.768301, 37.483674
LON_E, LAT_N = 15.311688, 37.916573
TILE_PX   = 4096          # max WMS image dimension
TILE_GRID = 2             # NxN tile grid (2×2 = ~6 m/px effective)

# ── Formation → litho_type classification ─────────────────────────────────────
#
# Litho groups (coarse):
#   lava_flow     — all dated or undated effusive lava flows
#   scoria_tephra — cinder cones, pyroclastic fall/flow, volcaniclastic
#   intrusion     — subvolcanic bodies, domes, necks
#   sediment      — alluvial, fluvial, marine, flysch, clays
#   basement      — Paleozoic metamorphics (outside EtnaGeoMap extent)
#
# Litho sub-group (for lava_flow only):
#   recent        — Torre del Filosofo (<1600 AD historical summit flows)
#   historic      — Pietracannone Formation (1600–1900 AD peripheral flows)
#   prehistoric   — all older formations (undated or radiometric)
#
# Colour palette extracted from WMS GetLegendGraphic (see legend_colours below).
# Each entry: [R, G, B, formation_name, litho_type, litho_group]

LEGEND = [
    # R    G    B     Formation name                          litho_type     group
    (224,  73,  79,  'Torre del Filosofo Formation',         'lava_flow',   'recent'),
    (238, 154,  68,  'Pietracannone Formation',              'lava_flow',   'historic'),
    (220, 224, 239,  'Portella Giumenta formation',          'lava_flow',   'prehistoric'),
    (199, 131, 179,  'Monte Calvario formation',             'scoria_tephra','prehistoric'),
    (240, 207, 224,  'Simeto formation',                     'sediment',    'fluvial'),
    (186, 169, 202,  'Piano Provenzana Formation',           'lava_flow',   'prehistoric'),
    (170, 137, 186,  'Pizzi Deneri Formation',               'scoria_tephra','prehistoric'),
    (159,  65, 151,  'Serra delle Concazze Formation',       'lava_flow',   'prehistoric'),
    (213, 221, 180,  'Canalone della Montagnola Formation',  'scoria_tephra','prehistoric'),
    (123, 139,  24,  'Serra Cuvigghiuni Formation',          'lava_flow',   'prehistoric'),
    (214, 231, 198,  'Acqua della Rocca Formation',          'lava_flow',   'prehistoric'),
    (178, 219, 178,  'Serra del Salifizio Formation',        'lava_flow',   'prehistoric'),
    (108, 190, 108,  'Valle degli Zappini Formation',        'lava_flow',   'prehistoric'),
    (123, 168,  49,  'Serra Giannicola Grande Formation',    'lava_flow',   'prehistoric'),
    (164, 155,   0,  'Monte Fior di Cosimo formation',       'lava_flow',   'prehistoric'),
    (150, 158,  84,  'Monte Scorsone Formation',             'lava_flow',   'prehistoric'),
    (200, 228, 225,  'Piano del Trifoglietto formation',     'lava_flow',   'prehistoric'),
    (126, 204, 200,  'Rocche formation',                     'lava_flow',   'prehistoric'),
    (  0, 168, 156,  'Contrada Passo Cannelli formation',    'lava_flow',   'prehistoric'),
    (158, 219, 248,  'Valverde formation',                   'lava_flow',   'prehistoric'),
    ( 37, 203, 214,  'Moscarello formation',                 'lava_flow',   'prehistoric'),
    (  1, 137, 207,  'Calanna formation',                    'lava_flow',   'prehistoric'),
    (175, 172, 147,  'S. Maria degli Ammalati formation',    'sediment',    'alluvial'),
    (111, 155, 225,  'Timpa formation',                      'sediment',    'marine'),
    ( 29, 103, 177,  'Timpa di Don Masi formation',          'sediment',    'marine'),
    (242, 234, 226,  'San Placido Formation',                'sediment',    'alluvial'),
    (159, 109,  60,  'S. Maria di Licodia Formation',        'sediment',    'alluvial'),
    (175, 172, 147,  'Ghiaie di Monte Tiriti Formation',     'sediment',    'alluvial'),
    (243, 214, 185,  'S. Giorgio sands Formation',           'sediment',    'marine'),
    (155, 105,  56,  'Acicastello Formation',                'lava_flow',   'prehistoric'),
    (199, 193, 100,  'Argille grigio-azzurre Formation',     'sediment',    'marine'),
    (211, 215, 203,  'NODATA',                               'nodata',      'nodata'),
]

# Build KD-tree over legend RGB for fast nearest-colour lookup
_legend_rgb   = np.array([[r, g, b] for r, g, b, *_ in LEGEND], dtype=np.float32)
_legend_tree  = KDTree(_legend_rgb)
_legend_names = [row[3] for row in LEGEND]
_legend_ltypes = [row[4] for row in LEGEND]
_legend_groups = [row[5] for row in LEGEND]


def colour_snap(img_arr: np.ndarray, tolerance: float = 55.0) -> np.ndarray:
    """
    Map every pixel to its nearest legend colour index.
    Pixels whose nearest colour is further than `tolerance` in RGB space
    are assigned the NODATA index (last entry in LEGEND).
    Returns uint8 label array of same (H, W) shape.
    """
    h, w, _ = img_arr.shape
    flat = img_arr.reshape(-1, 3).astype(np.float32)
    dists, idxs = _legend_tree.query(flat, workers=-1)
    nodata_idx = len(LEGEND) - 1
    idxs = idxs.astype(np.uint8)
    idxs[dists > tolerance] = nodata_idx
    return idxs.reshape(h, w)


# ── Phase 1: Fetch WMS tiles ──────────────────────────────────────────────────

def fetch_tile(bbox_wgs84, width, height) -> np.ndarray:
    """Request one GetMap tile; return RGB numpy array."""
    lon_w, lat_s, lon_e, lat_n = bbox_wgs84
    params = dict(
        service='WMS', version='1.1.1', request='GetMap',
        layers=LAYER,
        bbox=f'{lon_w},{lat_s},{lon_e},{lat_n}',
        width=width, height=height,
        srs='EPSG:4326',
        format='image/png',
        transparent='false',
    )
    resp = requests.get(WMS_BASE, params=params, timeout=120)
    resp.raise_for_status()
    img = Image.open(io.BytesIO(resp.content)).convert('RGB')
    return np.array(img, dtype=np.uint8)


print('=== Phase 1: Fetching WMS tiles ===')
t_total = time.time()

N = TILE_GRID
lons = np.linspace(LON_W, LON_E, N + 1)
lats = np.linspace(LAT_S, LAT_N, N + 1)

full_w = TILE_PX * N
full_h = TILE_PX * N

if MOSAIC_CACHE.exists():
    print(f'  Loading cached mosaic from {MOSAIC_CACHE.name} …')
    mosaic = np.load(str(MOSAIC_CACHE))
    print(f'  Mosaic: {mosaic.shape}')
else:
    mosaic = np.full((full_h, full_w, 3), 211, dtype=np.uint8)  # grey = NODATA
    for row_i in range(N):
        lat_n_tile = lats[N - row_i]
        lat_s_tile = lats[N - row_i - 1]
        for col_i in range(N):
            lon_w_tile = lons[col_i]
            lon_e_tile = lons[col_i + 1]
            print(f'  tile [{row_i},{col_i}]: '
                  f'{lon_w_tile:.5f},{lat_s_tile:.5f} → {lon_e_tile:.5f},{lat_n_tile:.5f}')
            t0 = time.time()
            arr = fetch_tile((lon_w_tile, lat_s_tile, lon_e_tile, lat_n_tile), TILE_PX, TILE_PX)
            print(f'    fetched {arr.shape}  {time.time()-t0:.1f}s')
            y0, y1 = row_i * TILE_PX, (row_i + 1) * TILE_PX
            x0, x1 = col_i * TILE_PX, (col_i + 1) * TILE_PX
            mosaic[y0:y1, x0:x1] = arr
    np.save(str(MOSAIC_CACHE), mosaic)
    print(f'  Mosaic cached → {MOSAIC_CACHE.name}')

print(f'Mosaic: {mosaic.shape}  ({time.time()-t_total:.1f}s)')


# ── Phase 2: Colour snap + morphological cleaning ─────────────────────────────

print('\n=== Phase 2: Colour snap ===')
if LABEL_CACHE.exists():
    print(f'  Loading cached label array from {LABEL_CACHE.name} …')
    label_arr = np.load(str(LABEL_CACHE))
else:
    t0 = time.time()
    label_arr = colour_snap(mosaic, tolerance=45.0)
    np.save(str(LABEL_CACHE), label_arr)
    print(f'  Snap done + cached ({time.time()-t0:.1f}s)')
unique_labels, counts = np.unique(label_arr, return_counts=True)
print(f'  {len(unique_labels)} distinct labels:')
for lbl, cnt in zip(unique_labels, counts):
    pct = cnt / label_arr.size * 100
    print(f'    [{lbl:2d}] {_legend_names[lbl]:<45s}  {cnt:8d}px  ({pct:.1f}%)')

print('\n=== Phase 3: Gap-fill + morphological cleaning ===')
t0 = time.time()
nodata_idx_fill = len(LEGEND) - 1
nodata_mask = (label_arr == nodata_idx_fill)
print(f'  NODATA before fill: {nodata_mask.sum():,} px ({nodata_mask.mean()*100:.1f}%)')

# Identify exterior NODATA (sea / outside WMS extent) via connected-component
# labelling: any component touching the image border is "exterior".
nodata_labeled, _ = nd_label(nodata_mask)
border_vals = (
    set(np.unique(nodata_labeled[0, :])) |
    set(np.unique(nodata_labeled[-1, :])) |
    set(np.unique(nodata_labeled[:, 0])) |
    set(np.unique(nodata_labeled[:, -1]))
)
border_vals.discard(0)
exterior_mask = np.isin(nodata_labeled, list(border_vals))
interior_gap  = nodata_mask & ~exterior_mask
print(f'  Interior gaps:  {interior_gap.sum():,} px')
print(f'  Exterior NODATA: {exterior_mask.sum():,} px (sea / outside extent — preserved)')

# Fill interior gaps with nearest valid (non-NODATA) neighbour via EDT
_, nearest = distance_transform_edt(nodata_mask, return_indices=True)
label_filled = label_arr.copy()
label_filled[interior_gap] = label_arr[nearest[0][interior_gap], nearest[1][interior_gap]]
print(f'  Gap-fill done  ({time.time()-t0:.1f}s)')

# Median filter removes remaining anti-aliasing / text / thin-line artefacts.
# 13×9 first pass (coarser) then 5×5 (fine cleanup).
label_clean = median_filter(label_filled, size=13)
print(f'  Median 13×13 done  ({time.time()-t0:.1f}s)')
label_clean = median_filter(label_clean, size=5)
print(f'  Median 5×5 done')


# ── Phase 4: Save GeoTIFF for inspection ─────────────────────────────────────

tif_path = OUT_DIR / 'etna_geology_wms.tif'
transform = from_bounds(LON_W, LAT_S, LON_E, LAT_N, full_w, full_h)
with rasterio.open(
    str(tif_path), 'w',
    driver='GTiff', height=full_h, width=full_w,
    count=1, dtype=np.uint8,
    crs='EPSG:4326', transform=transform,
    compress='lzw',
) as dst:
    dst.write(label_clean, 1)
print(f'\nSaved {tif_path}')


# ── Phase 5: Polygonize ───────────────────────────────────────────────────────

print('\n=== Phase 4: Polygonize ===')
t0 = time.time()
nodata_idx = len(LEGEND) - 1

features = []
with rasterio.open(str(tif_path)) as src:
    data = src.read(1)
    tfm  = src.transform
    for geom_dict, val in rio_shapes(data, mask=(data != nodata_idx).astype(np.uint8), transform=tfm):
        lbl = int(val)
        if lbl >= len(LEGEND): continue
        name  = _legend_names[lbl]
        ltype = _legend_ltypes[lbl]
        group = _legend_groups[lbl]
        if ltype == 'nodata': continue
        geom = shape(geom_dict)
        if geom.is_empty: continue
        features.append({
            'formation':  name,
            'litho_type': ltype,
            'litho_grp':  group,
            'label_idx':  lbl,
            'geometry':   geom,
        })

print(f'  {len(features)} raw polygons ({time.time()-t0:.1f}s)')


# ── Phase 6: Build GeoDataFrame, area filter, simplify ────────────────────────

gdf = gpd.GeoDataFrame(features, crs='EPSG:4326')

# Project to UTM 33N for area calculation and simplification
gdf_utm = gdf.to_crs('EPSG:32633')
gdf['area_m2'] = gdf_utm.geometry.area.round(1)

# Drop micro-slivers (< 200 m²) — polygonisation artefacts
before = len(gdf)
gdf = gdf[gdf['area_m2'] >= 200].copy()
print(f'  After area filter (≥200m²): {len(gdf)} polygons  (removed {before-len(gdf)})')

# Simplify: 5m in UTM, then back to WGS84
gdf_utm = gdf.to_crs('EPSG:32633')
gdf_utm['geometry'] = gdf_utm['geometry'].simplify(5.0, preserve_topology=True)
gdf = gdf_utm.to_crs('EPSG:4326')
gdf = gdf[~gdf.geometry.is_empty & gdf.geometry.notna()].copy()
print(f'  After simplification: {len(gdf)} polygons')

# Summary
print('\nLitho-type distribution:')
for lt, n in Counter(gdf['litho_type']).most_common():
    print(f'  {lt}: {n}')


# ── Phase 7: Write SHP ────────────────────────────────────────────────────────

out_poly = OUT_DIR / 'etna_geology_wms.shp'
gdf[['formation','litho_type','litho_grp','area_m2','geometry']].to_file(str(out_poly))
print(f'\n[A] Wrote {out_poly}  ({len(gdf)} features)')


# ── Phase 8: Contact lines ────────────────────────────────────────────────────

print('\n=== Phase 5: Building contacts ===')
t0 = time.time()

# Dissolve by litho_type to find inter-class boundaries
dissolved = {}
for lt in gdf['litho_type'].unique():
    sub = gdf[gdf['litho_type'] == lt]
    try:
        u = unary_union(sub.geometry.values)
        if not u.is_empty:
            dissolved[lt] = u
    except Exception as e:
        print(f'  Warning dissolve {lt}: {e}')

lits  = list(dissolved.keys())
geoms = list(dissolved.values())
tree  = STRtree(geoms)

contact_feats = []
for i, (lt_i, geom_i) in enumerate(zip(lits, geoms)):
    for j in tree.query(geom_i, predicate='intersects'):
        if j <= i: continue
        lt_j   = lits[j]
        shared = geom_i.boundary.intersection(geoms[j].boundary)
        if shared.is_empty: continue
        parts = list(shared.geoms) if hasattr(shared, 'geoms') else [shared]
        for p in parts:
            if p.geom_type in ('LineString','MultiLineString') and p.length > 0.00005:
                contact_feats.append({'contact': f'{lt_i}|{lt_j}',
                                      'litho_a': lt_i, 'litho_b': lt_j,
                                      'geometry': p})

print(f'  {len(contact_feats)} contact segments  ({time.time()-t0:.1f}s)')

if contact_feats:
    cdf = gpd.GeoDataFrame(contact_feats, crs='EPSG:4326')
    out_contacts = OUT_DIR / 'etna_contacts_wms.shp'
    cdf.to_file(str(out_contacts))
    print(f'[B] Wrote {out_contacts}')


# ── Colour map JSON ───────────────────────────────────────────────────────────

colour_map = []
for r, g, b, name, ltype, group in LEGEND:
    colour_map.append({'hex': f'#{r:02x}{g:02x}{b:02x}', 'formation': name,
                       'litho_type': ltype, 'litho_grp': group})
with open(OUT_DIR / 'colour_map.json', 'w') as fh:
    json.dump(colour_map, fh, indent=2)

print(f'\n=== Done in {time.time()-t_total:.0f}s ===')
