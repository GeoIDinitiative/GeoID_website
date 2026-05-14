#!/usr/bin/env python3
"""
Build moon_geology_features.json from USGS Unified Geologic Map shapefiles.
Output matches the schema expected by moon-viewer.js geologyInteractiveState.
"""

import json, math, sys, os
from osgeo import ogr
sys.path.insert(0, os.path.dirname(__file__))
from un2_colors import UN2_COLORS_HEX, DEFAULT_HEX

try:
    from shapely.geometry import shape, MultiPolygon, Polygon, mapping
    from shapely.ops import unary_union
    HAS_SHAPELY = True
except ImportError:
    HAS_SHAPELY = False
    print("WARNING: shapely not available — polygons will not be simplified")

MOON_R = 1737400.0  # metres

SHP_DIR = os.path.join(os.path.dirname(__file__),
    "Unified_Geologic_Map_of_the_Moon_GIS_v2/"
    "Unified_Geologic_Map_of_the_Moon_GIS/"
    "Lunar_GIS/Shapefiles")

OUT = os.path.join(os.path.dirname(os.path.dirname(__file__)), "moon_geology_features.json")

RASTER_W, RASTER_H = 4096, 2048


ERA_INFO = {
    "Pre-Nectarian": {
        "rock_type": "Pre-Nectarian",
        "description": "Oldest mapped terrain (>3.92 Ga). Heavily cratered highlands, ancient basin material, and crater units predating the Nectarian epoch.",
        "color": "#875B40",
    },
    "Nectarian": {
        "rock_type": "Nectarian",
        "description": "Basin-forming era (3.92–3.85 Ga). Includes the Nectaris and other multi-ring impact basins with associated ejecta and crater units.",
        "color": "#B39070",
    },
    "Imbrian": {
        "rock_type": "Imbrian",
        "description": "Major volcanism and basin fill (3.85–3.2 Ga). Includes the Imbrium and Orientale impacts, widespread mare basalts, and associated crater units.",
        "color": "#7090B8",
    },
    "Eratosthenian": {
        "rock_type": "Eratosthenian",
        "description": "Younger mare flows and degraded craters (3.2–1.1 Ga). Lower crater density than Imbrian terrain.",
        "color": "#78B0E0",
    },
    "Copernican": {
        "rock_type": "Copernican",
        "description": "Freshest mapped craters with bright ray systems (<1.1 Ga). The youngest stratigraphic epoch recognised on the Moon.",
        "color": "#F0F0F0",
    },
    "Eratosthenian-Imbrian": {
        "rock_type": "Eratosthenian-Imbrian",
        "description": "Transitional plateau units spanning the Imbrian–Eratosthenian boundary.",
        "color": "#A8C0A0",
    },
    "Imbrian-Nectarian": {
        "rock_type": "Imbrian-Nectarian",
        "description": "Transitional plains and terra units spanning the Nectarian–Imbrian boundary.",
        "color": "#A0B0C0",
    },
}


def m_to_deg(x_m, y_m):
    """Equidistant Cylindrical (Moon) projected metres → (lon_deg, lat_deg)."""
    K = 180.0 / (math.pi * MOON_R)
    lon = x_m * K
    lat = y_m * K
    # Shift to 0-360
    if lon < 0:
        lon += 360.0
    return round(lon, 4), round(lat, 4)


def ring_to_lonlat(ring_pts):
    """Convert an OGR ring point list (x_m, y_m) → [[lon, lat], ...] in 0-360."""
    return [list(m_to_deg(p[0], p[1])) for p in ring_pts]


def simplify_ring(pts, tol_m=8000, max_verts=120):
    """Simplify a projected ring using shapely, return lon/lat pairs."""
    if HAS_SHAPELY and len(pts) > 6:
        try:
            poly = Polygon(pts)
            simp = poly.simplify(tol_m, preserve_topology=True)
            if simp.is_empty or simp.area == 0:
                simp = poly
            ext = list(simp.exterior.coords)
        except Exception:
            ext = pts
    else:
        ext = pts

    # Decimate if still too many vertices
    if len(ext) > max_verts:
        step = max(1, len(ext) // max_verts)
        ext = ext[::step]
        if ext[-1] != ext[0]:
            ext.append(ext[0])

    return [list(m_to_deg(p[0], p[1])) for p in ext]


def compute_bounds(lonlat_rings):
    """Compute selection_bounds dict from a list of [[lon, lat]] rings."""
    all_lons = [p[0] for ring in lonlat_rings for p in ring]
    all_lats = [p[1] for ring in lonlat_rings for p in ring]
    if not all_lons:
        return None
    lat_min = round(min(all_lats), 4)
    lat_max = round(max(all_lats), 4)
    lon_center = round((max(all_lons) + min(all_lons)) / 2, 4)
    def norm(a):
        while a > 180: a -= 360
        while a < -180: a += 360
        return a
    offsets = [norm(lon - lon_center) for lon in all_lons]
    return {
        "lat_min": lat_min,
        "lat_max": lat_max,
        "lon_center": lon_center,
        "lon_min_offset": round(min(offsets), 4),
        "lon_max_offset": round(max(offsets), 4),
    }


def era_from_system(system_str):
    s = str(system_str or "")
    for k in ERA_INFO:
        if k.lower() in s.lower():
            return k
    return "Unknown"


def build_rock_type(unit_code, era):
    """Map unit code + era to a concise rock type string."""
    desc = str(unit_code or "")
    lower = desc.lower()
    if "mare" in lower or unit_code.startswith(("Im", "Em", "Ibm")) or "m" in unit_code[1:2]:
        sub = "Mare basalt"
    elif "crater" in lower or unit_code.endswith(("c","c1","c2","cc")) :
        sub = "Crater material"
    elif "basin" in lower or unit_code.endswith(("b","bm","bl","bsc")):
        sub = "Basin material"
    elif "terra" in lower or unit_code.endswith(("t","tp","td")):
        sub = "Highland terrain"
    elif "plains" in lower or unit_code.endswith("p"):
        sub = "Plains material"
    elif "dark mantling" in lower or unit_code == "Id":
        sub = "Dark mantling"
    else:
        sub = "Mapped unit"
    return f"{era} — {sub}"


# ── LINEAR FEATURE TYPE MAPPING ────────────────────────────────────────────
def classify_linear(type_str, comment_str):
    t = str(type_str or "").lower()
    c = str(comment_str or "").lower()
    if "graben" in t:
        return "tectonic", "graben trace", "#f08b2f"
    if "ridge crest" in t:
        return "tectonic", "ridge crest", "#ddd0b0"
    if "crest of crater rim" in t:
        return "impact", "crater rim crest", "#f2c14e"
    if "crest of buried crater" in t:
        return "impact", "buried crater rim", "#b8a060"
    if "basin ring" in t:
        return "impact", "basin ring", "#f2c14e"
    if "channel" in t and "volcanic" in t:
        return "volcanic", "volcanic channel", "#f06a57"
    if "lineament" in t:
        if "catena" in c:
            return "impact", "crater chain (catena)", "#f2c14e"
        if "rille" in c:
            return "volcanic", "rille lineament", "#f06a57"
        return "tectonic", "lineament", "#ddd0b0"
    return "tectonic", t, "#ddd0b0"


# ────────────────────────────────────────────────────────────────────────────

def main():
    print("Building moon_geology_features.json …")

    # 1. ── GeoUnits → features dict + unit_legend ──────────────────────────
    ds = ogr.Open(os.path.join(SHP_DIR, "GeoUnits.shp"))
    lyr = ds.GetLayer(0)
    total = lyr.GetFeatureCount()
    print(f"  GeoUnits: {total} features")

    features = {}
    unit_accum = {}   # unit_code → {era, un2, area, count}
    un2_accum  = {}   # FIRST_Un_2 → {area, count, eras}

    for i, feat in enumerate(lyr):
        if (i + 1) % 1000 == 0:
            print(f"    {i+1}/{total} …")

        unit_code  = feat.GetField("FIRST_Unit") or "?"
        era_str    = feat.GetField("FIRST_Un_1") or ""
        unit_desc  = feat.GetField("FIRST_Un_2") or ""
        area_geo   = feat.GetField("AREA_GEO") or 0.0

        era = era_from_system(era_str)
        color = UN2_COLORS_HEX.get(unit_desc, DEFAULT_HEX)

        if unit_code not in unit_accum:
            unit_accum[unit_code] = {"era": era, "un2": unit_desc, "area": 0.0, "count": 0, "color": color}
        unit_accum[unit_code]["area"] += area_geo / 1e6
        unit_accum[unit_code]["count"] += 1

        if unit_desc not in un2_accum:
            un2_accum[unit_desc] = {"area": 0.0, "count": 0, "eras": set()}
        un2_accum[unit_desc]["area"] += area_geo / 1e6
        un2_accum[unit_desc]["count"] += 1
        un2_accum[unit_desc]["eras"].add(era_str)

        geom = feat.GetGeometryRef()
        if not geom:
            continue

        polygons = []
        if geom.GetGeometryType() in (ogr.wkbPolygon, ogr.wkbPolygon25D):
            geom_list = [geom]
        elif geom.GetGeometryType() in (ogr.wkbMultiPolygon, ogr.wkbMultiPolygon25D):
            geom_list = [geom.GetGeometryRef(j) for j in range(geom.GetGeometryCount())]
        else:
            geom_list = []

        all_outer_pts = []
        for poly in geom_list:
            ext_ring = poly.GetGeometryRef(0)
            if not ext_ring:
                continue
            pts = ext_ring.GetPoints()
            if not pts or len(pts) < 4:
                continue
            outer = ring_to_lonlat(pts)
            all_outer_pts.extend(outer)

            holes = []
            for h in range(1, poly.GetGeometryCount()):
                hole_ring = poly.GetGeometryRef(h)
                h_pts = hole_ring.GetPoints()
                if h_pts and len(h_pts) >= 4:
                    holes.append(ring_to_lonlat(h_pts))
            polygons.append({"outer": outer, "holes": holes})

        if not polygons:
            continue

        bounds = compute_bounds([[p for poly in polygons for p in poly["outer"]]])
        anchor_lon = bounds["lon_center"] if bounds else 0.0
        anchor_lat = round((bounds["lat_min"] + bounds["lat_max"]) / 2, 4) if bounds else 0.0

        era_detail = ERA_INFO.get(era, {}).get("description", "")
        fid = str(i + 1)
        features[fid] = {
            "id": i + 1,
            "name": unit_desc,                  # FIRST_Un_2 — primary classification
            "type": "Geologic unit polygon",
            "unit": unit_code,                  # FIRST_Unit — code for reference
            "epoch": era_str,                   # FIRST_Un_1 — shown in popup epoch row
            "description": era_detail,
            "unit_description": unit_desc,
            "rock_type": unit_desc,             # FIRST_Un_2 — drives legend grouping
            "rock_type_detail": era_detail,
            "era": era,
            "mapped_area_km2": round(area_geo / 1e6, 1),
            "polygon_objectid": i + 1,
            "anchor_lat": anchor_lat,
            "anchor_lon": anchor_lon,
            "selection_bounds": bounds,
            "polygons": polygons,
        }

    print(f"  Converted {len(features)} polygon features")

    # 2. ── unit_legend + rock_legend — both keyed by FIRST_Un_2 ─────────────
    # unit_legend: one entry per unit code, colour from FIRST_Un_2
    unit_legend = []
    for code, info in sorted(unit_accum.items()):
        unit_legend.append({
            "unit": code,
            "label": info["un2"],
            "description": info["un2"],
            "rock_type": info["un2"],   # matches feature.rock_type for sampler lookup
            "era": info["era"],
            "color": info["color"],
            "mapped_area_km2": round(info["area"], 1),
        })

    # rock_legend: one entry per unique FIRST_Un_2 value, ordered by area desc
    rock_legend = []
    for un2, info in sorted(un2_accum.items(), key=lambda x: -x[1]["area"]):
        rock_legend.append({
            "rock_type": un2,
            "label": un2,
            "description": un2,
            "color": UN2_COLORS_HEX.get(un2, DEFAULT_HEX),
            "epochs": sorted(info["eras"]),
            "mapped_area_km2": round(info["area"], 1),
        })

    # 3. ── GeoContacts → contacts ──────────────────────────────────────────
    print("  Processing GeoContacts …")
    ds2 = ogr.Open(os.path.join(SHP_DIR, "GeoContacts.shp"))
    lyr2 = ds2.GetLayer(0)
    contacts = []
    cid = 0
    SKIP_TYPES = {"map boundary", "dnd", "internal"}
    for feat in lyr2:
        ct = str(feat.GetField("ContactTyp") or "").lower()
        if ct in SKIP_TYPES:
            continue
        geom = feat.GetGeometryRef()
        if not geom:
            continue
        pts = geom.GetPoints()
        if not pts or len(pts) < 2:
            continue

        # Simplify line
        if HAS_SHAPELY and len(pts) > 10:
            from shapely.geometry import LineString
            ls = LineString(pts)
            ls_s = ls.simplify(6000, preserve_topology=False)
            pts = list(ls_s.coords) if len(list(ls_s.coords)) >= 2 else pts
        if len(pts) > 200:
            step = max(1, len(pts)//200)
            pts = pts[::step]

        seg = [list(m_to_deg(p[0], p[1])) for p in pts]
        is_approx = ct in ("approximate", "inferred", "buried")
        cid += 1
        anchor = m_to_deg(pts[len(pts)//2][0], pts[len(pts)//2][1])
        contacts.append({
            "id": f"contact-{cid}",
            "name": "Approx contact" if is_approx else "Certain contact",
            "type": "Geologic contact",
            "contact_type": ct.capitalize(),
            "description": f"USGS Unified Geologic Map of the Moon contact, type: {ct}.",
            "length_km": round(feat.GetField("Shape_Leng") / 1000, 1) if feat.GetField("Shape_Leng") else 0,
            "anchor_lat": anchor[1],
            "anchor_lon": anchor[0],
            "color": "#aab8c6" if is_approx else "#f3f1d8",
            "segments": [seg],
        })

    print(f"  Contacts: {len(contacts)}")

    # 4. ── Linear_Features → structures ───────────────────────────────────
    print("  Processing Linear_Features …")
    ds3 = ogr.Open(os.path.join(SHP_DIR, "Linear_Features.shp"))
    lyr3 = ds3.GetLayer(0)
    structures = []
    sid = 0
    for feat in lyr3:
        ltype = feat.GetField("TYPE") or ""
        comment = feat.GetField("COMMENT") or ""
        origin, interpretation, color = classify_linear(ltype, comment)
        geom = feat.GetGeometryRef()
        if not geom:
            continue
        pts = geom.GetPoints()
        if not pts or len(pts) < 2:
            continue
        if HAS_SHAPELY and len(pts) > 10:
            from shapely.geometry import LineString
            ls = LineString(pts)
            ls_s = ls.simplify(5000, preserve_topology=False)
            pts = list(ls_s.coords) if len(list(ls_s.coords)) >= 2 else pts
        seg = [list(m_to_deg(p[0], p[1])) for p in pts]
        slen = feat.GetField("Sph_Len") or 0
        sid += 1
        anchor = m_to_deg(pts[len(pts)//2][0], pts[len(pts)//2][1])
        structures.append({
            "id": f"structure-{sid}",
            "name": interpretation.title(),
            "type": "Geologic structure",
            "origin": origin,
            "interpretation": interpretation,
            "preservation": feat.GetField("Preservati") or "",
            "dimension": "",
            "description": f"USGS Unified Geologic Map of the Moon linear feature. Type: {ltype}. {('Comment: '+comment) if comment else ''}",
            "length_km": round(slen / 1000, 1),
            "anchor_lat": anchor[1],
            "anchor_lon": anchor[0],
            "color": color,
            "segments": [seg],
        })

    print(f"  Structures: {len(structures)}")

    # 5. ── Assemble and write ──────────────────────────────────────────────
    output = {
        "width": RASTER_W,
        "height": RASTER_H,
        "feature_count": len(features),
        "features": features,
        "unit_legend": unit_legend,
        "rock_legend": rock_legend,
        "contacts": contacts,
        "structures": structures,
        "landing_sites": [],
    }

    print(f"Writing {OUT} …")
    with open(OUT, "w") as f:
        json.dump(output, f, separators=(",", ":"))

    size_mb = os.path.getsize(OUT) / 1e6
    print(f"Done. File size: {size_mb:.1f} MB")
    print(f"  features={len(features)}, units={len(unit_legend)}, eras={len(rock_legend)}")
    print(f"  contacts={len(contacts)}, structures={len(structures)}")


if __name__ == "__main__":
    main()
