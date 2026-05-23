#!/usr/bin/env python3
"""
fetch_ingv_geology.py

Downloads the INGV EtnaGeoMap layer verbatim from the WMS KML output (WFS is
disabled on the server), parses every Placemark for geometry and attributes,
applies web simplification + area filter, and writes:

  viewer/etna-geology-ingv.json

Feature format per element:
  [id, sigle_cart, name, type, age, formation, lithology, info_en1, color_hex, rings]

  0  id         – objectid (int)
  1  sigle_cart – map symbol code, e.g. "1610"
  2  name       – individual feature name, e.g. "1610 lava flow"
  3  type       – "Volcanic" / "Sedimentary" / ...
  4  age        – eruption year or age string, e.g. "1610"
  5  formation  – U_litost_1 stratigraphic formation name
  6  lithology  – LITHOLOGY per-feature description
  7  info_en1   – INFO_EN_1 English description
  8  color_hex  – "#rrggbb" from WMS SLD PolyStyle
  9  rings      – [[[lon,lat], ...], ...]  (exterior + holes; even-odd winding)
"""

import io, json, re, sys, time
import html as html_mod
from pathlib import Path
from xml.etree import ElementTree as ET

import requests
import numpy as np
from shapely.geometry import Polygon, MultiPolygon
from shapely.validation import make_valid

INPUT_DIR  = Path(__file__).parent
VIEWER_DIR = INPUT_DIR.parent / 'viewer'
KML_CACHE  = INPUT_DIR / 'ingv_geology_raw.kml'
OUT        = VIEWER_DIR / 'etna-geology-ingv.json'

WMS_URL = 'https://geodb.ct.ingv.it/EtnaGeoMap/wms'
LON_W, LAT_S = 14.768301, 37.483674
LON_E, LAT_N = 15.311688, 37.916573

SIMPLIFY_TOL = 0.0002   # ° ≈ 18 m
MIN_AREA     = 5e-7     # ° ² ≈ 5,000 m²  (keep small scoria cones)


# ── 1. Download KML ────────────────────────────────────────────────────────────

if KML_CACHE.exists():
    print(f'Using cached KML: {KML_CACHE}  ({KML_CACHE.stat().st_size/1e6:.1f} MB)')
    kml_text = KML_CACHE.read_text(encoding='utf-8')
else:
    print('Downloading KML from INGV WMS …')
    params = dict(
        SERVICE='WMS', VERSION='1.1.1', REQUEST='GetMap',
        LAYERS='EtnaGeologicalMap',
        BBOX=f'{LON_W},{LAT_S},{LON_E},{LAT_N}',
        WIDTH=4096, HEIGHT=4096,
        SRS='EPSG:4326',
        FORMAT='application/vnd.google-earth.kml+xml',
    )
    t0 = time.time()
    r = requests.get(WMS_URL, params=params, timeout=300, stream=True)
    r.raise_for_status()
    chunks = []
    for chunk in r.iter_content(chunk_size=1 << 20):
        chunks.append(chunk)
        sys.stdout.write(f'\r  {sum(len(c) for c in chunks)/1e6:.1f} MB')
        sys.stdout.flush()
    kml_text = b''.join(chunks).decode('utf-8')
    KML_CACHE.write_text(kml_text, encoding='utf-8')
    print(f'\n  Downloaded in {time.time()-t0:.0f}s  ({len(kml_text)/1e6:.1f} MB)')


# ── 2. Parse KML ───────────────────────────────────────────────────────────────

KML_NS  = 'http://www.opengis.net/kml/2.2'
KML_NS2 = 'http://www.opengis.net/kml/2.1'

def strip_ns(tag):
    return tag.split('}')[-1] if '}' in tag else tag

# Attribute extraction from HTML-encoded description
ATTR_RE = re.compile(
    r'<span class="atr-name">(.*?)</span>.*?<span class="atr-value">(.*?)</span>',
    re.DOTALL
)

def parse_description(raw_html):
    decoded = html_mod.unescape(raw_html)
    return {m.group(1).strip(): m.group(2).strip() for m in ATTR_RE.finditer(decoded)}

# KML color AABBGGRR → #RRGGBB
def kml_color_to_hex(kml_col):
    kml_col = kml_col.strip()
    if len(kml_col) == 8:
        rr = kml_col[6:8]; gg = kml_col[4:6]; bb = kml_col[2:4]
        return f'#{rr}{gg}{bb}'
    return '#888888'

# Parse coordinate string "lon,lat[,alt] ..." → [[lon,lat],...]
def parse_coords(coord_str):
    pts = []
    for tok in coord_str.strip().split():
        parts = tok.split(',')
        if len(parts) >= 2:
            pts.append([round(float(parts[0]), 6), round(float(parts[1]), 6)])
    return pts

def geom_to_rings(geom):
    rings = []
    parts = list(geom.geoms) if hasattr(geom, 'geoms') else [geom]
    for part in parts:
        if not isinstance(part, Polygon) or part.is_empty or part.area < MIN_AREA:
            continue
        ext = [[round(x, 6), round(y, 6)] for x, y in part.exterior.coords]
        if len(ext) >= 3:
            rings.append(ext)
        for hole in part.interiors:
            h = [[round(x, 6), round(y, 6)] for x, y in hole.coords]
            if len(h) >= 3:
                rings.append(h)
    return rings


print('Parsing KML …')
root = ET.fromstring(kml_text)

features = []
skipped  = 0
t0 = time.time()

for pm in root.iter('{http://www.opengis.net/kml/2.2}Placemark'):
    # Attributes from description
    desc_el = pm.find('{http://www.opengis.net/kml/2.2}description')
    if desc_el is None or not desc_el.text:
        skipped += 1; continue
    attrs = parse_description(desc_el.text)

    obj_id    = int(attrs.get('objectid', 0))
    sigle     = attrs.get('sigle_cart', '')
    name      = attrs.get('name', '')
    feat_type = attrs.get('Type', '')
    age       = attrs.get('AGE', '')
    formation = attrs.get('U_litost_1', '')
    lithology = attrs.get('LITHOLOGY', '')
    info_en1  = attrs.get('INFO_EN_1', '')

    # Fill color from inline Style
    color_hex = '#888888'
    style = pm.find('{http://www.opengis.net/kml/2.2}Style')
    if style is not None:
        poly_style = style.find('{http://www.opengis.net/kml/2.2}PolyStyle')
        if poly_style is not None:
            col_el = poly_style.find('{http://www.opengis.net/kml/2.2}color')
            if col_el is not None and col_el.text:
                color_hex = kml_color_to_hex(col_el.text)

    # Collect all polygon rings from MultiGeometry or Polygon
    raw_rings = []
    for poly_el in pm.iter('{http://www.opengis.net/kml/2.2}Polygon'):
        outer = poly_el.find('.//{http://www.opengis.net/kml/2.2}outerBoundaryIs'
                             '//{http://www.opengis.net/kml/2.2}coordinates')
        if outer is not None and outer.text:
            raw_rings.append(('outer', parse_coords(outer.text)))
        for inner in poly_el.findall('.//{http://www.opengis.net/kml/2.2}innerBoundaryIs'
                                     '//{http://www.opengis.net/kml/2.2}coordinates'):
            if inner.text:
                raw_rings.append(('inner', parse_coords(inner.text)))

    if not raw_rings:
        skipped += 1; continue

    # Build shapely polygon(s) for simplification
    polys = []
    # Group outer rings with their subsequent inner rings
    i = 0
    while i < len(raw_rings):
        kind, coords = raw_rings[i]
        if kind == 'outer' and len(coords) >= 3:
            holes = []
            j = i + 1
            while j < len(raw_rings) and raw_rings[j][0] == 'inner':
                if len(raw_rings[j][1]) >= 3:
                    holes.append(raw_rings[j][1])
                j += 1
            try:
                p = Polygon(coords, holes)
                if not p.is_valid:
                    p = make_valid(p)
                if p.is_valid and not p.is_empty:
                    polys.append(p)
            except Exception:
                pass
            i = j
        else:
            i += 1

    if not polys:
        skipped += 1; continue

    geom = polys[0] if len(polys) == 1 else MultiPolygon(polys)
    geom = geom.simplify(SIMPLIFY_TOL, preserve_topology=True)
    if geom.is_empty:
        skipped += 1; continue

    rings = geom_to_rings(geom)
    if not rings:
        skipped += 1; continue

    features.append([
        obj_id, sigle, name, feat_type, age,
        formation, lithology, info_en1, color_hex, rings,
    ])

    if len(features) % 500 == 0:
        print(f'  {len(features)} features  ({time.time()-t0:.0f}s)')

print(f'\n{len(features)} features parsed  ({skipped} skipped)  in {time.time()-t0:.0f}s')


# ── 3. Sort by objectid (original map order = painter's order) ─────────────────
features.sort(key=lambda f: f[0])


# ── 4. Write JSON ──────────────────────────────────────────────────────────────
output = {
    'type':       'ingv_etna_geological_map',
    'source':     'INGV EtnaGeoMap WMS — Branca et al. 2011/2015 (geodb.ct.ingv.it/EtnaGeoMap/wms)',
    'n_features': len(features),
    'fields':     ['id','sigle_cart','name','type','age','formation',
                   'lithology','info_en1','color_hex','rings'],
    'features':   features,
}

with open(OUT, 'w') as fh:
    json.dump(output, fh, separators=(',', ':'))

kb = OUT.stat().st_size / 1024
print(f'\nWrote {OUT}  ({kb:.0f} KB / {kb/1024:.1f} MB)')

# Summary
from collections import Counter
types = Counter(f[3] for f in features)
print('\nFeature types:')
for t, n in types.most_common():
    print(f'  {t or "(blank)":30s}  {n:5d}')
