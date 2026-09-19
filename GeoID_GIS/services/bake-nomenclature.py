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

WHICH BODIES HAVE OUTLINES AT ALL is a fact about the bucket, not a guess.
Listed, it holds a `_geometries[_internal].zip` for every world below and for
nothing else the viewers show: the nine moons whose only file is a `.kmz`
(Deimos, Phoebe, Janus, Epimetheus, Puck, Proteus, Nix, Amalthea, Thebe) carry
POINTS ONLY -- 2 placemarks for Deimos, 25 for Phoebe, all of them `<Point>`
-- so the gazetteer has drawn no outline for them and there is nothing to
fetch. The gas giants have no surface to draw one on.

MARS WAS LEFT OUT OF THIS FILE ON A CLAIM THAT IS FALSE: the note here said
the gazetteer publishes no Mars outlines, and `MARS_nomenclature_geometries.zip`
is in the bucket with 1,720 polygons and 203 lines. Check the listing before
believing a body has none.
"""
import io, json, math, os, subprocess, sys, urllib.request, zipfile

from shapely.geometry import shape, mapping, box, MultiPolygon, Polygon, LineString, MultiLineString
from shapely import affinity

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "data", "global", "nomenclature")
WORK = os.path.join(ROOT, "data", "global", ".nomenclature-work")
BASE = "https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/"
# the bodies with a viewer of their own and a surface to draw on
BODIES = {"moon": "MOON", "mars": "MARS", "mercury": "MERCURY",
          "venus": "VENUS", "pluto": "PLUTO"}
# the moons the planet viewers open in their moon viewer, every one the bucket
# holds a shapefile for (the rest are points-only .kmz; see the header)
MOONS = {m.lower(): m for m in (
    "PHOBOS", "CHARON", "IO", "EUROPA", "GANYMEDE", "CALLISTO",
    "MIMAS", "ENCELADUS", "TETHYS", "DIONE", "RHEA", "TITAN", "HYPERION", "IAPETUS",
    "MIRANDA", "ARIEL", "UMBRIEL", "TITANIA", "OBERON", "TRITON")}
BODIES.update(MOONS)
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


def is_extent(geom):
    """
    IS THIS THE FEATURE'S SHAPE, OR JUST THE BOX AROUND IT?

    The gazetteer publishes two kinds of polygon under one name, and says so
    nowhere. Most worlds are digitised outlines; on others it has drawn the
    BOUNDING BOX instead -- a five-point axis-aligned rectangle whose every
    vertex is at a bbox extreme. Measured against the source shapefiles:
    Venus 385 of 399, Europa 90%, Callisto 60%, Titan 53%, and Phobos, Mimas,
    Tethys, Dione, Rhea, Iapetus, Hyperion and all five Uranian moons at 100%.
    The Moon, Mars, Mercury, Io, Pluto, Charon and Triton have none.

    A 166-degree rectangle filled over Aphrodite Terra claims to be the shape
    of Aphrodite Terra, which it is not, so an extent is flagged here and the
    viewer draws it unfilled and says what it is on the card.

    Read off the geometry as PUBLISHED, because that is what anything
    downstream will see; measured, it gives the same answer as the source
    (the simplify caps at 0.02 degrees and cannot flatten an outline into a
    box, nor does it move a box's own corners).
    """
    if geom["type"] == "Polygon":
        ring = geom["coordinates"][0]
    elif geom["type"] == "MultiPolygon":
        # one part only: a multipart feature is not a single box
        if len(geom["coordinates"]) != 1:
            return False
        ring = geom["coordinates"][0][0]
    else:
        return False
    if len(ring) != 5:
        return False
    xs = [c[0] for c in ring]
    ys = [c[1] for c in ring]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    if x1 == x0 or y1 == y0:
        return False          # a degenerate sliver is not an extent box
    return all(x in (x0, x1) and y in (y0, y1) for x, y in ring)


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
        geom = {"type": g.geom_type, "coordinates": rounded(mapping(g)["coordinates"])}
        # absent unless it IS one: a flag on every feature of the Moon's 8,870
        # would be 140 kB of "false"
        if is_extent(geom):
            props["extent"] = True
        out.append({"type": "Feature", "properties": props, "geometry": geom})
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
                       f"longitudes signed east, rings cut at 180 and simplified to 1/100 of each feature's span. "
                       f"A feature marked `extent` is the gazetteer's BOUNDING BOX, not a digitised outline."),
           "features": out}
    path = os.path.join(OUT, f"{key}.geojson")
    json.dump(doc, open(path, "w"), separators=(",", ":"))
    kinds = {}
    for f in out:
        kinds[f["geometry"]["type"]] = kinds.get(f["geometry"]["type"], 0) + 1
    boxes = sum(1 for f in out if f["properties"].get("extent"))
    share = f", {boxes} EXTENTS ({100 * boxes / len(out):.0f}%)" if boxes else ""
    print(f"{key}: {len(out)} of {len(src)} features {kinds}{share}, "
          f"{os.path.getsize(path) / 1e6:.2f} MB ({body}{suffix})")


if __name__ == "__main__":
    for k in (sys.argv[1:] or BODIES):
        bake(k)
