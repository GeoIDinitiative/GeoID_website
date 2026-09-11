#!/usr/bin/env python3
"""
GLiM — the world's SURFACE lithology, baked into vector tiles.

The alternative to the FAO soil map, and genuinely a different subject: FAO
maps the SOIL, Macrostrat maps the BEDROCK, and GLiM maps what the rock at the
surface actually IS — 1,235,259 polygons, about a hundred times the detail of
previous global lithological maps. It is the layer to reach for when the
question is what material is exposed rather than what soil formed on it or
what formation lies beneath.

WHERE IT COMES FROM, AND WHY NOT THE DOI. The PANGAEA DOI usually cited for
GLiM — 10.1594/PANGAEA.788537 — publishes only the **0.5 degree GRIDDED**
version: a 38 kB zip holding one ASCII grid and a list of class codes. Half a
degree is about 55 km, so it is far COARSER than the 1:5,000,000 FAO soil map
already on this site, and baking it would have been a step backwards wearing a
DOI. The polygons are distributed as an ESRI file geodatabase linked from the
authors' own project page at the University of Hamburg (1.1 GB), and that is
what this reads.

THREE THINGS ABOUT THE SOURCE that the DSMW did not prepare you for:

  * **It is projected, not geographic.** The geodatabase is in World Eckert IV
    — an equal-area projection in METRES — where the FAO shapefile was plain
    degrees with no `.prj` at all. Baked without reprojecting, every polygon
    lands in the Gulf of Guinea at coordinates in the millions. `-t_srs` is not
    optional here, and `-wrapdateline` with it, or the polygons that straddle
    the antimeridian come back as ribbons across the whole map.
  * **The names are in a `.lyr` INSIDE the geodatabase.** `GLiM_v1_1.lyr`
    carries all sixteen level-1 classes as `Unconsolidated Sediments (SU)` —
    the same `Name (CODE)` shape the DSMW's miscellaneous units used — so they
    are read rather than remembered, exactly as FAO's are.
  * **`Litho` is a three-level code in one string.** `scpu__` is carbonate
    sedimentary (`sc`) + a level-2 subclass + a level-3 subclass, padded with
    underscores. The level-1 half is the one with a published name, so that is
    what the map is drawn and legended by; the full code rides on the feature
    for anyone who wants it.

A GLiM UNIT IS A ROCK, which is the difference that matters downstream. The FAO
soil map needed a card of its own because rock-mechanics properties do not
apply to a Podzol; these polygons ARE rock, so they go through the ordinary
geology card, `rock-class.js` and the rock-property database like any other
lithology.

    python3 GeoID_GIS/services/bake-glim.py

GDAL does the geometry, as it does for the glaciers and the soils: `ogr2ogr` on
the command line, no Python bindings (this machine's segfault on
`from osgeo import ogr` is recorded in GeoID_GIS/CLAUDE.md).
"""

from __future__ import annotations

import io
import json
import pathlib
import re
import shutil
import subprocess
import sys
import time
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "global" / "glim"
WORK = ROOT / "data" / "global" / ".glim-work"

# Linked from https://www.geo.uni-hamburg.de/en/geologie/forschung/
# aquatische-geochemie/glim.html — the authors' own project page. 1.1 GB, so it
# is NOT fetched automatically: this script expects the geodatabase already
# unpacked into WORK, and says so if it is not.
SOURCE_PAGE = ("https://www.geo.uni-hamburg.de/en/geologie/forschung/"
               "aquatische-geochemie/glim.html")

# The geodatabase the project page links to, READ WHERE IT LIES when it is not
# unpacked locally. GDAL opens a file geodatabase straight out of a remote zip
# (`/vsizip/{/vsicurl/…}/…`), so the 1.1 GB download never touches the disk —
# which matters on a machine that cannot hold the zip AND the 3 GB reprojected
# GeoPackage at once. The PANGAEA store link now answers 404; this is the
# authors' own Dropbox link from the page above.
SOURCE_ZIP = ("https://www.dropbox.com/scl/fi/5v00i8op7a9brmn4qeg8b/"
              "LiMW_GIS-2015.gdb.zip?rlkey=89q1aj8zfpmiv82y41xe6ttmp&dl=1")
SOURCE_GDB_IN_ZIP = "LiMW_GIS 2015.gdb"

TILE_LAYER = "glim"
GDB_LAYER = "GLiM_export"

MIN_ZOOM = 0
MAX_ZOOM = 5

# The same reasoning as the soil bake: the ceiling is the SOURCE'S, not the
# format's. GLiM's average mapping scale is about 1:3,750,000 — a couple of
# kilometres of positional accuracy — so zoom 5 at the 4096 convention, roughly
# 300 m at the equator, is already an order of magnitude finer than the map.
EXTENT = 4096

# Banded by SIMPLIFICATION, not by selection, for the reason the soil bake
# records: this is a CONTINUOUS map, so dropping a polygon puts a hole in it
# rather than thinning it.
#
# THE FLOOR IS THE SOURCE'S ACCURACY, NOT THE TILE GRID — and getting that
# backwards is what made the first bake 245 MB. The soil map's rule is "a
# fraction of a pixel at the band's coarsest zoom", which is right while the
# tile grid is the coarser of the two and degenerates the moment it is not:
# measured, that rule put the z3 and z5 tolerances at 0.9 of ONE MVT unit,
# i.e. essentially no simplification at all, on a map whose own positional
# accuracy is 1.9 km. The deep bands were storing vertices GLiM cannot support
# and no screen can show.
#
# 0.017 degrees IS that 1.9 km. At z5 it is 6 MVT units and still 0.77 of a
# screen pixel, so nothing visible moves; below z2 the tile grid is coarser
# again and takes over. The same statement the soil bake makes about max_zoom,
# one level down: a format that can hold more precision than the source has is
# not a reason to store it.
SOURCE_ACCURACY_DEG = 0.017
LEVELS = [(0, 0, 0.2), (1, 1, 0.08), (2, 3, SOURCE_ACCURACY_DEG),
          (4, 5, SOURCE_ACCURACY_DEG)]

# Ours, and the manifest says so. The families are grouped by colour the way a
# geological map groups them — sediments warm, volcanics red, plutonics pink to
# orange, metamorphics green — because that is the convention a reader already
# has, and GLiM's own `.lyr` symbology is locked in an ESRI binary.
#
# Water, ice and no-data are deliberately drab: they are not lithologies, and
# giving them a rock's saturation would put three false classes at the top of
# the legend by area.
CLASS_COLOURS = {
    "su": "#f2e4bd",   # unconsolidated sediments
    "ss": "#e8c98a",   # siliciclastic sedimentary
    "sm": "#dcb45f",   # mixed sedimentary
    "sc": "#9fd4e8",   # carbonate sedimentary
    "ev": "#d9b3d9",   # evaporites
    "py": "#f0a07a",   # pyroclastics
    "va": "#f2726f",   # acid volcanic
    "vi": "#e05a4f",   # intermediate volcanic
    "vb": "#a83c32",   # basic volcanic
    "pa": "#f4a6c8",   # acid plutonic
    "pi": "#e07aa0",   # intermediate plutonic
    "pb": "#b5537a",   # basic plutonic
    "mt": "#7fbf7f",   # metamorphic
    "wb": "#a8c8dd",   # water bodies
    "ig": "#eaf2f7",   # ice and glaciers
    "nd": "#d5d5d5",   # no data
}
UNKNOWN_COLOUR = "#bdbdbd"

# THE LEGEND ABBREVIATES TWO NAMES so they fit a printed map key, and a card is
# not a printed map key. Expanded here, named so the change is arguable rather
# than silent — the same treatment the FAO legend's two misspellings get.
LEGEND_EXPANSIONS = {
    "Intermediate Plutonic R.": "Intermediate Plutonic Rocks",
    "Intermediate Volcanic R.": "Intermediate Volcanic Rocks",
}


def run(args: list[str]) -> None:
    done = subprocess.run(args, capture_output=True, text=True)
    if done.returncode != 0:
        sys.exit(f"FAILED: {' '.join(args[:6])}…\n{done.stderr[:2000]}")


def find_gdb():
    """A local unpacked geodatabase if there is one, else the remote zip.

    The remote form is a GDAL path STRING, never a pathlib.Path: Path collapses
    the "//" in "https://" and the open fails with "does not exist".
    """
    for path in sorted(WORK.glob("*.gdb")) if WORK.exists() else []:
        if path.is_dir():
            return path
    return f"/vsizip/{{/vsicurl/{SOURCE_ZIP}}}/{SOURCE_GDB_IN_ZIP}"


class _RangeFile(io.RawIOBase):
    """A seekable read-only view of a URL by HTTP Range, so `zipfile` can pull
    one entry out of a 1.1 GB archive without downloading the rest."""

    def __init__(self, url: str):
        # A one-byte range rather than HEAD: urllib turns a redirected HEAD into
        # a GET of the whole archive. Content-Range carries the total size.
        with urllib.request.urlopen(urllib.request.Request(
                url, headers={"Range": "bytes=0-0"})) as probe:
            # The ORIGINAL link, never the one it redirects to: Dropbox's
            # temporary content URL answers 403 to a second request.
            self.url = url
            self.size = int(probe.headers["Content-Range"].rsplit("/", 1)[1])
        self.pos = 0

    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos

    def seek(self, offset, whence=0):
        self.pos = offset if whence == 0 else self.pos + offset if whence == 1 else self.size + offset
        return self.pos

    def readinto(self, buf):
        if self.pos >= self.size:
            return 0
        end = min(self.pos + len(buf), self.size) - 1
        req = urllib.request.Request(self.url, headers={"Range": f"bytes={self.pos}-{end}"})
        for attempt in range(5):
            try:
                data = urllib.request.urlopen(req, timeout=60).read()
                break
            except OSError:
                if attempt == 4:
                    raise
                time.sleep(3 * (attempt + 1))
        buf[:len(data)] = data
        self.pos += len(data)
        return len(data)


def read_lyr(gdb) -> bytes:
    """The legend file's bytes, from disk or out of the remote zip."""
    if isinstance(gdb, pathlib.Path):
        lyr = gdb / "GLiM_v1_1.lyr"
        if not lyr.exists():
            sys.exit(f"No GLiM_v1_1.lyr in {gdb} — the class names live in it.")
        return lyr.read_bytes()
    with zipfile.ZipFile(io.BufferedReader(_RangeFile(SOURCE_ZIP), 1 << 20)) as zf:
        entry = next((n for n in zf.namelist() if n.endswith("GLiM_v1_1.lyr")), None)
        if not entry:
            sys.exit("No GLiM_v1_1.lyr in the remote geodatabase zip.")
        return zf.read(entry)


def legend_from_lyr(gdb: pathlib.Path) -> dict[str, str]:
    """
    GLiM'S OWN NAMES, from the `.lyr` the geodatabase carries.

    One pattern this time — `Unconsolidated Sediments (SU)` — where the FAO
    legend needed two. The codes are upper-case in the legend and lower-case in
    the data, so the key is folded.
    """
    if not shutil.which("strings"):
        sys.exit("`strings` is needed to read the GLiM legend out of the .lyr")
    raw = subprocess.run(["strings", "-e", "l"], input=read_lyr(gdb),
                         capture_output=True).stdout.decode("utf-8", "replace")
    names: dict[str, str] = {}
    for line in raw.splitlines():
        match = re.match(r"^\s*([A-Za-z][A-Za-z .,/-]+?)\s*\(([A-Z]{2})\)\s*$", line)
        if match:
            name = match.group(1).strip()
            names.setdefault(match.group(2).lower(),
                             LEGEND_EXPANSIONS.get(name, name))
    return names


def to_wgs84(gdb: pathlib.Path, names: dict[str, str]) -> pathlib.Path:
    """
    Reproject to degrees and attach the legend, in one pass into a GPKG.

    A GeoPackage rather than the GeoJSON the soil bake uses: 1.2 million
    polygons is a couple of gigabytes as text, on a machine with single-digit
    gigabytes free, and nothing downstream reads it by hand.
    """
    WORK.mkdir(parents=True, exist_ok=True)
    gpkg = WORK / "glim.gpkg"
    # REUSED WHEN IT IS ALREADY THERE. Reprojecting 1.2 million polygons out of
    # Eckert IV is the expensive half of this bake by a wide margin, and every
    # tuning pass on the tile bands would otherwise pay for it again. Delete
    # the file to force it.
    if gpkg.exists() and gpkg.stat().st_size > 1_000_000:
        print(f"  reusing {gpkg.name} ({gpkg.stat().st_size / 1e6:.0f} MB); "
              "delete it to reproject again")
        return gpkg
    if gpkg.exists():
        gpkg.unlink()
    # The CASE arms are built from the legend that was just READ, so a class
    # the source stops publishing simply stops appearing rather than carrying a
    # name this file remembers for it.
    def case(expr: str, table: dict[str, str], fallback: str) -> str:
        arms = " ".join(f"WHEN '{code}' THEN '{value}'"
                        for code, value in sorted(table.items()))
        return f"CASE lower(xx) {arms} ELSE '{fallback}' END AS {expr}"

    sql = (
        "SELECT Shape, "
        "lower(xx) AS class, Litho AS code, "
        + case("name", {k: v.replace("'", "''") for k, v in names.items()}, "Unclassified")
        + ", "
        + case("colour", CLASS_COLOURS, UNKNOWN_COLOUR)
        + f" FROM \"{GDB_LAYER}\""
    )
    run(["ogr2ogr", "-f", "GPKG", str(gpkg), str(gdb),
         "-dialect", "sqlite", "-sql", sql,
         "-nln", TILE_LAYER,
         # THE WHOLE REASON THIS STEP EXISTS. The source is World Eckert IV in
         # metres; the tiler computes tile bounds in degrees.
         "-t_srs", "EPSG:4326",
         # And a polygon that straddles the antimeridian comes back as a ribbon
         # across the entire map without this — the same seam the stress-map
         # bake had to cut by hand.
         "-wrapdateline",
         "-nlt", "MULTIPOLYGON",
         "-skipfailures"])
    return gpkg


def tally(gpkg: pathlib.Path) -> dict:
    done = subprocess.run(
        ["ogr2ogr", "-f", "CSV", "/vsistdout/", str(gpkg), "-dialect", "sqlite",
         "-sql", f"select class, name, colour, count(*) n from {TILE_LAYER} "
                 "group by class, name, colour order by n desc"],
        capture_output=True, text=True)
    rows = [line.split(",") for line in done.stdout.strip().splitlines()[1:]]
    # ORDERED AS A GEOLOGICAL KEY, not by frequency. `CLASS_COLOURS` is written
    # in the order a legend reads — sediments, then volcanics, plutonics,
    # metamorphics, then the three that are not lithologies — and that order is
    # published here rather than restated in the page, so the key and the
    # palette cannot drift apart. Sorting by count instead would put water
    # between two sedimentary classes.
    order = {code: i for i, code in enumerate(CLASS_COLOURS)}
    return {r[0]: {"name": r[1], "colour": r[2], "count": int(r[3]),
                   "order": order.get(r[0], len(order))}
            for r in rows if len(r) >= 4}


def bake_tiles(gpkg: pathlib.Path) -> pathlib.Path:
    tiles = WORK / "tiles"
    if tiles.exists():
        shutil.rmtree(tiles)
    tiles.mkdir(parents=True)
    for low, high, tolerance in LEVELS:
        band = WORK / f"tiles-z{low}"
        if band.exists():
            shutil.rmtree(band)
        run(["ogr2ogr", "-f", "MVT", str(band), str(gpkg),
             # `lith` IS THE CLASS NAME, and it is what makes these polygons
             # behave like the rocks they are. The geology card heads itself
             # with `lith`, `rock-class.js` classifies from it, and the
             # rock-property database looks the material up by it — so without
             # this column a GLiM polygon would read "Unit" with no
             # classification, exactly as a soil polygon did before it got a
             # card of its own. GLiM's own level-1 name IS the lithology, so
             # this restates rather than invents.
             "-dialect", "sqlite",
             "-sql", f"SELECT *, name AS lith FROM {TILE_LAYER}",
             "-nln", TILE_LAYER,
             "-simplify", str(tolerance),
             # Simplification can make a polygon self-touch, and GDAL's MVT
             # writer then leaves it out of the tile with no error and exit 0.
             # That lost the ocean's zoom-0 tile in bake-hydrology.py; here it
             # was a hole wherever it happened. See GeoID_GIS/CLAUDE.md.
             "-makevalid",
             "-dsco", f"MINZOOM={low}", "-dsco", f"MAXZOOM={high}",
             # Uncompressed: served as files off a static site, and the browser
             # only ungzips what the SERVER declares.
             "-dsco", "COMPRESS=NO",
             "-dsco", "MAX_SIZE=5000000", "-dsco", "MAX_FEATURES=1000000",
             "-dsco", f"EXTENT={EXTENT}"])
        for z in range(low, high + 1):
            if (band / str(z)).exists():
                shutil.move(str(band / str(z)), str(tiles / str(z)))
        shutil.rmtree(band, ignore_errors=True)
        print(f"  z{low}-{high}: simplified to {tolerance}deg", flush=True)
    return tiles


def install(tiles: pathlib.Path, classes: dict, polygons: int) -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    manifest: dict[str, int] = {}
    total = 0
    for pbf in sorted(tiles.rglob("*.pbf")):
        z, x, y = pbf.parts[-3], pbf.parts[-2], pbf.stem
        dest = OUT / z / x / f"{y}.mvt"
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(pbf, dest)
        manifest[f"{z}/{x}/{y}"] = dest.stat().st_size
        total += dest.stat().st_size

    (OUT / "manifest.json").write_text(json.dumps({
        "source": "GLiM — Global Lithological Map v1.1 (Hartmann & Moosdorf 2012)",
        "source_url": SOURCE_PAGE,
        "citation": "Hartmann, J. & Moosdorf, N. (2012). The new global "
                    "lithological map database GLiM: A representation of rock "
                    "properties at the Earth surface. Geochemistry, Geophysics, "
                    "Geosystems 13, Q12004. doi:10.1029/2012GC004370",
        "licence": "CC BY 3.0 for the 0.5-degree gridded version published at "
                   "doi:10.1594/PANGAEA.788537. The polygon geodatabase is "
                   "distributed free from the authors' project page and carries "
                   "no separate licence statement — attributed here in full, and "
                   "worth confirming with the authors before commercial use.",
        "scale": "about 1:3,750,000 on average, varying by region",
        "format": f"Mapbox Vector Tile, layer: {TILE_LAYER} (polygons), "
                  "Web Mercator XYZ — the scheme mvt.js computes tile bounds on",
        "ours": "The COLOURS (one per level-1 class, on the convention a "
                "geological map already uses) and the expansion of two "
                "abbreviated legend names. Everything else is GLiM's.",
        "theirs": "The polygons, the three-level lithological code, and the "
                  "level-1 class names (read from GLiM_v1_1.lyr).",
        "note": "Baked by GeoID_GIS/services/bake-glim.py from the ESRI "
                "geodatabase, reprojected from World Eckert IV. There is no "
                "remote behind this pyramid: past max_zoom there are no tiles.",
        "version": f"{len(manifest)}-{total}",
        "max_zoom": MAX_ZOOM,
        "polygons": polygons,
        "classes": len(classes),
        "tiles": manifest,
    }))
    (OUT / "classes.json").write_text(json.dumps(classes))
    print(f"{len(manifest)} tiles, {total / 1e6:.1f} MB -> {OUT}")


def main() -> int:
    gdb = find_gdb()
    print(f"Baking GLiM from {gdb.name if isinstance(gdb, pathlib.Path) else 'the remote zip'}…")
    names = legend_from_lyr(gdb)
    print(f"  legend: {len(names)} classes named by GLiM's own .lyr")
    if len(names) < 16:
        print("  WARNING: GLiM publishes 16 level-1 classes; fewer were read")

    print("  reprojecting from World Eckert IV and attaching the legend…")
    gpkg = to_wgs84(gdb, names)
    classes = tally(gpkg)
    polygons = sum(c["count"] for c in classes.values())
    print(f"  {polygons:,} polygons over {len(classes)} classes")
    unnamed = sum(c["count"] for c in classes.values()
                  if c["name"] == "Unclassified")
    if unnamed:
        print(f"  WARNING: {unnamed:,} polygons carry a class the legend "
              "did not name")

    tiles = bake_tiles(gpkg)
    install(tiles, classes, polygons)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
