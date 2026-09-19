#!/usr/bin/env python3
"""IAU named-feature OUTLINES for the planet viewers.

The planet viewers' labels come from the IAU Gazetteer of Planetary
Nomenclature (USGS Astrogeology), which publishes each named feature as a
centre point -- and, in the same S3 bucket, as an OUTLINE: a polygon for an
area feature (a crater's rim, a planitia's extent) and a line for a linear one
(a rupes, a fossa). The download page links only the centre points; the
outlines are `<BODY>_nomenclature_geometries[_internal].zip`.

    python3 GeoID_GIS/services/bake-nomenclature.py [moon mercury ...]

writes data/global/nomenclature/<body>.geojson, which publish-data.py puts in
the bucket gzipped. What it does to the source, and why:

- The PUBLIC file is used where one exists, the `_internal` one otherwise.
  Where both exist the public one is the larger (Venus 427 polygons against
  416, Pluto 64 against 56).
- Longitudes are EAST, 0-360 in the source; they leave as signed east
  -180..180, what GeoJSON and this app's importer mean by a longitude. A ring
  across the 180 meridian is unwrapped and cut there, or the importer would
  either file the layer as not georeferenced (a vertex at 321) or draw a chord
  back across the planet.
- Rings are simplified to a fraction of the feature's own size and written to
  4 decimals (about 100 m on the Moon), which is finer than the digitised
  outlines are good for: the Moon's 72 MB of internal outlines otherwise
  arrive as a file no page should fetch.
- Only the columns a reader wants are kept: name, type, diameter, origin,
  approval date, quadrangle and the gazetteer link.

Mars is absent on purpose: the gazetteer publishes no outlines for Mars, only
its centre points.
"""
import io, json, math, os, subprocess, sys, urllib.request, zipfile

from shapely.geometry import shape, mapping, box, MultiPolygon, Polygon, LineString, MultiLineString
from shapely import affinity

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "data", "global", "nomenclature")
WORK = os.path.join(ROOT, "data", "global", ".nomenclature-work")
BASE = "https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/"
# the bodies with a viewer of their own and a surface to draw on
BODIES = {"moon": "MOON", "mercury": "MERCURY", "venus": "VENUS", "pluto": "PLUTO"}
KEEP = ("name", "type", "diameter", "origin", "approvaldt", "quad_name", "link")


def fetch(body):
    os.makedirs(WORK, exist_ok=True)
    for suffix in ("", "_internal"):
        name = f"{body}_nomenclature_geometries{suffix}.zip"
        path = os.path.join(WORK, name)
        if not os.path.exists(path):
            try:
                with urllib.request.urlopen(BASE + name, timeout=300) as r:
                    data = r.read()
            except Exception:  # noqa: BLE001 -- the other variant may exist
                continue
            if not data.startswith(b"PK"):
                continue
            open(path, "wb").write(data)
        return path, suffix
    raise SystemExit(f"{body}: no outline file in the gazetteer bucket")


def read_layers(zpath):
    """Every .shp in the archive, as GeoJSON features, through GDAL."""
    names = [n for n in zipfile.ZipFile(zpath).namelist() if n.endswith(".shp")]
    feats = []
    for n in names:
        # The attribute tables are UTF-8 and not every archive says so (no
        # .cpg): read as Latin-1, "Lagerlöf" arrives as "LagerlÃ¶f".
        out = subprocess.run(["ogr2ogr", "--config", "SHAPE_ENCODING", "UTF-8", "-f", "GeoJSON",
                              "/vsistdout/", f"/vsizip/{zpath}/{n}"],
                             check=True, capture_output=True).stdout
        feats += json.loads(out)["features"]
    return feats


def unwrap_coords(coords):
    """Consecutive longitudes made continuous (a ring crossing 0/360 or 180)."""
    out, prev = [], None
    for x, y, *rest in coords:
        if prev is not None:
            while x - prev > 180:
                x -= 360
            while x - prev < -180:
                x += 360
        out.append((x, y))
        prev = x
    return out


def unwrap(geom):
    if isinstance(geom, Polygon):
        return Polygon(unwrap_coords(geom.exterior.coords), [unwrap_coords(r.coords) for r in geom.interiors])
    if isinstance(geom, LineString):
        return LineString(unwrap_coords(geom.coords))
    return type(geom)([unwrap(g) for g in geom.geoms])


def to_signed(geom):
    """Pieces of the unwrapped geometry, each shifted into -180..180."""
    geom = unwrap(geom)
    if not geom.is_valid:
        geom = geom.buffer(0) if geom.geom_type.endswith("Polygon") else geom
    pieces = []
    for k in range(-3, 4):
        window = box(-180 + 360 * k, -90, 180 + 360 * k, 90)
        part = geom.intersection(window)
        if part.is_empty:
            continue
        pieces.append(affinity.translate(part, xoff=-360 * k))
    keep = [p for p in pieces if not p.is_empty]
    if not keep:
        return None
    polys = [g for p in keep for g in getattr(p, "geoms", [p]) if g.geom_type == "Polygon" and g.area > 0]
    lines = [g for p in keep for g in getattr(p, "geoms", [p]) if g.geom_type == "LineString" and g.length > 0]
    if polys:
        return polys[0] if len(polys) == 1 else MultiPolygon(polys)
    if lines:
        return lines[0] if len(lines) == 1 else MultiLineString(lines)
    return None


def rounded(obj):
    if isinstance(obj, (list, tuple)):
        if obj and isinstance(obj[0], (int, float)):
            return [round(obj[0], 4), round(obj[1], 4)]
        return [rounded(o) for o in obj]
    return obj


def bake(key):
    body = BODIES[key]
    zpath, suffix = fetch(body)
    src = read_layers(zpath)
    out = []
    for f in src:
        if not f.get("geometry"):
            continue  # the gazetteer names it but has drawn no outline (28 on Venus)
        p = f["properties"]
        g = shape(f["geometry"])
        # a tolerance a hundredth of the feature's own span, capped: a basin
        # keeps its shape, a crater keeps its roundness
        span = max(g.bounds[2] - g.bounds[0], g.bounds[3] - g.bounds[1])
        g = g.simplify(min(0.02, max(0.0005, span / 100)), preserve_topology=True)
        g = to_signed(g)
        if g is None:
            continue
        props = {k: p.get(k) for k in KEEP if p.get(k) not in (None, "")}
        if "diameter" in props:
            props["diameter_km"] = round(float(props.pop("diameter")), 2)
        if "approvaldt" in props:
            props["approved"] = str(props.pop("approvaldt"))[:4]
        if "quad_name" in props:
            props["quadrangle"] = props.pop("quad_name")
        props["body"] = key
        out.append({"type": "Feature", "properties": props,
                    "geometry": {"type": g.geom_type, "coordinates": rounded(mapping(g)["coordinates"])}})
    # DRAW ORDER: largest first, lines last. The outlines nest (a regio holds
    # the planitia that holds a crater) and the renderer paints in array
    # order, so a small feature drawn first was washed under the region
    # around it.
    out.sort(key=lambda f: (f["geometry"]["type"].endswith("LineString"),
                            -shape(f["geometry"]).area))
    os.makedirs(OUT, exist_ok=True)
    doc = {"type": "FeatureCollection",
           "_source": (f"IAU Gazetteer of Planetary Nomenclature, USGS Astrogeology Science Center: "
                       f"{body}_nomenclature_geometries{suffix}.zip. Public domain (US Government work); "
                       f"longitudes signed east, rings cut at 180 and simplified to 1/100 of each feature's span."),
           "features": out}
    path = os.path.join(OUT, f"{key}.geojson")
    json.dump(doc, open(path, "w"), separators=(",", ":"))
    kinds = {}
    for f in out:
        kinds[f["geometry"]["type"]] = kinds.get(f["geometry"]["type"], 0) + 1
    xs = [c for f in out for c in json.dumps(f["geometry"]["coordinates"]).split(",")]
    print(f"{key}: {len(out)} of {len(src)} features {kinds}, {os.path.getsize(path) / 1e6:.2f} MB ({body}{suffix})")


if __name__ == "__main__":
    for k in (sys.argv[1:] or BODIES):
        bake(k)
