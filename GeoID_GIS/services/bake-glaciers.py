#!/usr/bin/env python3
"""Bake the world's glacier outlines into the site.

    python3 GeoID_GIS/services/bake-glaciers.py            # download, bake
    python3 GeoID_GIS/services/bake-glaciers.py --work /tmp/rgi   # keep the sources
    python3 GeoID_GIS/services/bake-glaciers.py --check    # report, write nothing

WHY THIS EXISTS. The Ice cover layer was the ice polygons Macrostrat happens to
carry in its geological compilation — which is a geological map's idea of ice,
not an inventory of it. Measured over Iceland: it maps the big ice caps as a
handful of blobs and does not have Eyjafjallajokull or Myrdalsjokull at all.
That is not a fault in the compilation; nobody drew it to be a glacier map.

WHAT THIS IS INSTEAD. The **Randolph Glacier Inventory 7.0** — the reference
global inventory, one outline per glacier around the year 2000, compiled by the
GLIMS community and published by NSIDC under CC BY 4.0. Measured on the baked
merge: **192,869 glacier complexes over 706,744 km2**, which is the published
global total to a fraction of a percent.

THREE THINGS THAT ARE DECISIONS, not conveniences:

- **Complexes (`C`), not glaciers (`G`).** RGI publishes both: `G` splits an ice
  mass into flow units by ice divide (274,000 of them), `C` keeps a contiguous
  ice mass whole. This layer answers "where is there ice", so a contiguous ice
  cap should be one polygon rather than eleven wedges meeting at a dome.
- **RGI DOES NOT INCLUDE THE TWO ICE SHEETS.** It maps the glaciers and ice caps
  around them — Greenland's periphery is region 05 — but the Greenland and
  Antarctic ice sheets themselves are out of scope by definition, and they are
  about 96% of the ice on Earth. Leaving that gap would make a "world ice cover"
  layer that is missing almost all of the world's ice, so the two ice sheets
  come from **Natural Earth 10m glaciated areas** (public domain), taken by
  their own names rather than by a bounding box.
- **VECTOR TILES, not a file, for the reason the geology already records.**
  192,869 polygons is not one layer: measured, the inventory as a single
  simplified GeoJSON is tens of megabytes and twenty times the geology sheet's
  triangulation budget, and a cut by size (complexes of 2 km2 and up are 11,467
  of 192,869 and carry 93.7% of the area) is an overview pretending to be an
  inventory. So this bakes an MVT pyramid — GDAL's own writer, on the site's own
  EPSG:4326 2x1 scheme — and the layer streams and refines exactly as the
  geology does, off `data/global/ice`. Ice is sparse, so the pyramid is sparse:
  only tiles with ice in them exist, and `manifest.json` is what stops the
  client asking for the rest.

GLIMS AND RGI ARE THE SAME LINEAGE, and it is worth knowing which to reach
for. **GLIMS** (glims.org/glacierdata) is the archive: every outline anybody has
submitted, MULTI-TEMPORAL, so one glacier may carry a dozen outlines from
different years and different analysts — the right source for measuring change,
and the wrong one for drawing "where is there ice today", because a naive draw
stacks a glacier's 1985, 2001 and 2018 outlines on top of each other. **RGI** is
that community's own curated answer to exactly that question: one outline per
ice mass, as close to the year 2000 as the imagery allows, quality-checked and
gap-filled. This bake is RGI for that reason, and GLIMS is where to go for
repeat outlines.

WHERE THE OUTLINES COME FROM. NSIDC serves RGI behind an Earthdata login, which
a bake script cannot answer, so the files are taken from the RGI working
mirror at the University of Bremen (the OGGM group's, the same files). The
CITATION is the dataset's own, not the mirror's:

    RGI Consortium (2023). Randolph Glacier Inventory - A Dataset of Global
    Glacier Outlines, Version 7.0. Boulder, Colorado USA. NSIDC.
    https://doi.org/10.5067/f6jmovy5navz    (CC BY 4.0)

GDAL does the geometry (`ogr2ogr` on the command line -- this machine's GDAL
Python bindings segfault on import, which `CLAUDE.md` records).
"""

from __future__ import annotations

import argparse
import json
import pathlib
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "global" / "ice"

RGI_MIRROR = ("https://cluster.klima.uni-bremen.de/~fmaussion/misc/"
              "rgi7_data/l4_rgi7b0_tar")
NE_GLACIATED = ("https://naciscdn.org/naturalearth/10m/physical/"
                "ne_10m_glaciated_areas.zip")
#: The floating half of Antarctica's ice. `ne_10m_glaciated_areas` holds the
#: GROUNDED sheet only — measured on the shipped file, 12,059,468 km2 against a
#: published grounded figure of about 12.3 million, with Ross, Filchner-Ronne
#: and Amery all absent. The shelves are roughly another 1.6 million km2 of ice
#: cover, and leaving them out of a layer called ice cover is a hole the size of
#: Iran in the one place the subject is largest.
NE_SHELVES = ("https://naciscdn.org/naturalearth/10m/physical/"
              "ne_10m_antarctic_ice_shelves_polys.zip")

# RGI's own first-order regions, in its own order and its own words.
REGIONS = [
    ("01", "alaska"), ("02", "western_canada_usa"), ("03", "arctic_canada_north"),
    ("04", "arctic_canada_south"), ("05", "greenland_periphery"), ("06", "iceland"),
    ("07", "svalbard_jan_mayen"), ("08", "scandinavia"), ("09", "russian_arctic"),
    ("10", "north_asia"), ("11", "central_europe"), ("12", "caucasus_middle_east"),
    ("13", "central_asia"), ("14", "south_asia_west"), ("15", "south_asia_east"),
    ("16", "low_latitudes"), ("17", "southern_andes"), ("18", "new_zealand"),
    ("19", "subantarctic_antarctic_islands"),
]

# The ice sheets, by their own names in Natural Earth rather than by a bounding
# box: a box round Greenland also catches its peripheral ice caps, which RGI
# maps properly and which would then be drawn twice.
SHEETS = ("Antarctic Ice Sheet", "Greenland Ice Sheet")

#: The layer name INSIDE each tile. `ice-cover-panel.js` asks for this exact
#: string, and `ice-cover.test.mjs` pins the two together.
TILE_LAYER = "ice"

#: WHAT EACH LEVEL CARRIES, and this is the fix for two reports at once.
#:
#: Baked with every complex at every level, the low zooms were both heavy and
#: useless: a zoom-2 tile held tens of thousands of polygons quantised to
#: 0.022 degrees — about 2.4 km — so the world backdrop took **33 seconds to
#: fetch and triangulate 15 tiles before the view's own tiles were even asked
#: for**, and what it drew in the meantime was ice displaced by kilometres from
#: the ground. Reported as exactly that: "not tight to the surface, view
#: offset. Theres a latency in load time too."
#:
#: A polygon smaller than a pixel is not detail, it is bytes. At zoom 2 a pixel
#: is about 20 km of ground at 65 north, where most of this ice is, so nothing
#: under 200 km2 can be seen there at all. Measured on the inventory: the 323
#: complexes of 200 km2 and up carry **75.7% of the world's glacier area**, and
#: 1,638 of 20 km2 and up carry 86.4% — so the coarse levels lose almost
#: nothing that could have been drawn, and the fine levels still carry
#: everything.
LEVELS = (
    # (min zoom, max zoom, smallest complex in km2 — None means all of them,
    #  tile extent — the grid a vertex is placed on inside the tile)
    (0, 2, 200.0, 4096),
    (3, 4, 20.0, 4096),
    (5, 5, 5.0, 4096),
    # THE DEEPEST LEVEL IS PLACED ON A FINER GRID, and this is the cheap half
    # of "tight to the surface". An MVT tile quantises every vertex onto its
    # own grid, 4096 units across by convention — at zoom 6 that is about 65 m
    # at 65 north, so below roughly 100 m per pixel the outline shows the grid
    # as a staircase. Doubling the extent halves the step to about 32 m for
    # 17 MB (43 -> 60), where a whole extra zoom level would have cost 28 MB
    # for the largest 1,638 complexes alone and left every other glacier
    # stepped. `mvt.js` reads each layer's own extent, so nothing else changes.
    (6, 6, None, 8192),
)

#: SEVEN, and the level is a size decision made with the numbers in front of it.
#:
#: A Web Mercator tile spans 360/2^z degrees over 4096 units, so zoom 7 places a
#: vertex to 0.00069 degrees — about 76 m at the equator and 32 m at 65 north,
#: which is where most of this ice is. RGI's outlines are digitised from 15-30 m
#: imagery, so a deeper level would be storing precision the source has not got.
MAX_ZOOM = 7

#: THE SCHEME IS GDAL'S DEFAULT, which is Web Mercator XYZ — and that is not
#: what a comment in `CLAUDE.md` claimed.
#:
#: The first bake was made on EPSG:4326 with two tiles across at zoom 0, on the
#: strength of a note in this repo's own working file. `mvt.js`'s
#: `tilesForBounds` is the truth and it is the ordinary slippy-map formula:
#: `x = (lon + 180) / 360 * 2^z` with a Mercator `y`, one tile at zoom 0. The
#: mismatch is silent — every tile decodes, every polygon is valid, and Iceland
#: lands in the Laptev Sea. Measured on the wrong bake: an Icelandic complex
#: (`o1region` 06) decoded to 142 E, 78 N.
TILING_SCHEME = None


def run(args: list[str]) -> None:
    done = subprocess.run(args, capture_output=True, text=True)
    if done.returncode != 0:
        sys.exit(f"FAILED: {' '.join(args[:6])}…\n{done.stderr[:2000]}")


def fetch(url: str, dest: pathlib.Path) -> pathlib.Path:
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  fetching {url.rsplit('/', 1)[-1]} …", flush=True)
    with urllib.request.urlopen(url, timeout=1800) as answer, dest.open("wb") as out:
        shutil.copyfileobj(answer, out)
    return dest


def sources(work: pathlib.Path) -> pathlib.Path:
    """Every RGI region and the Natural Earth glaciated areas, on disk."""
    raw = work / "raw"
    unpacked = work / "src"
    unpacked.mkdir(parents=True, exist_ok=True)
    for code, slug in REGIONS:
        name = f"RGI2000-v7.0-C-{code}_{slug}.tar.gz"
        tar = fetch(f"{RGI_MIRROR}/{name}", raw / name)
        if not (unpacked / f"RGI2000-v7.0-C-{code}_{slug}").exists():
            with tarfile.open(tar) as bundle:
                bundle.extractall(unpacked)
    for url, stem in ((NE_GLACIATED, "ne_10m_glaciated_areas"),
                      (NE_SHELVES, "ne_10m_antarctic_ice_shelves_polys")):
        zipped = fetch(url, raw / f"{stem}.zip")
        if not (unpacked / f"{stem}.shp").exists():
            with zipfile.ZipFile(zipped) as bundle:
                bundle.extractall(unpacked)
    return unpacked


def merge(unpacked: pathlib.Path, work: pathlib.Path) -> pathlib.Path:
    """One table of every ice polygon, 2D, with the columns worth carrying.

    `-dim 2` is not tidiness: RGI ships 3D polygons whose Z is always zero, so
    a third of every coordinate would be a number saying nothing.

    `kind` and `source` are written in as constants because the two halves come
    from two datasets at two scales, and a reader clicking a polygon should be
    told which one they are looking at rather than having to know.
    """
    gpkg = work / "ice.gpkg"
    if gpkg.exists():
        gpkg.unlink()
    for index, (code, slug) in enumerate(REGIONS):
        layer = f"RGI2000-v7.0-C-{code}_{slug}"
        shp = unpacked / layer / f"{layer}.shp"
        if not shp.exists():
            sys.exit(f"missing source: {shp}")
        sql = (f'select rgi_id, o1region, area_km2, '
               f"'Glacier or ice cap' as kind, null as name, 'RGI 7.0' as source "
               f'from "{layer}"')
        args = ["ogr2ogr", "-f", "GPKG", str(gpkg), str(shp),
                "-nln", TILE_LAYER, "-nlt", "MULTIPOLYGON", "-dim", "2",
                "-sql", sql]
        if index:
            # BEFORE `-f`, not after it: inserted after, the flags land between
            # `-f` and `GPKG` and the driver name becomes "-update".
            args[1:1] = ["-update", "-append"]
        run(args)
        print(f"  merged {layer}", flush=True)

    names = ", ".join(f"'{n}'" for n in SHEETS)
    run(["ogr2ogr", "-update", "-append", "-f", "GPKG", str(gpkg),
         str(unpacked / "ne_10m_glaciated_areas.shp"),
         "-nln", TILE_LAYER, "-nlt", "MULTIPOLYGON", "-dim", "2",
         "-dialect", "sqlite", "-sql",
         "select geometry, null as rgi_id, null as o1region, null as area_km2, "
         "'Ice sheet' as kind, name, 'Natural Earth 10m' as source "
         f"from ne_10m_glaciated_areas where name in ({names})"])
    print("  merged the two ice sheets", flush=True)
    return gpkg


def tally(gpkg: pathlib.Path) -> dict:
    """What went in, read back off the merge rather than remembered."""
    done = subprocess.run(
        ["ogr2ogr", "-f", "CSV", "/vsistdout/", str(gpkg), "-dialect", "sqlite",
         "-sql", "select kind, count(*) n, round(sum(coalesce(area_km2, 0)), 1) km2 "
                 f"from {TILE_LAYER} group by kind"],
        capture_output=True, text=True)
    rows = [line.split(",") for line in done.stdout.strip().splitlines()[1:]]
    return {r[0]: {"count": int(r[1]), "area_km2": float(r[2])} for r in rows}


def bake_tiles(gpkg: pathlib.Path, work: pathlib.Path, max_zoom: int) -> pathlib.Path:
    """The pyramid, from GDAL's own MVT writer — one run per LEVELS band.

    GDAL bakes a zoom RANGE in one pass and has no per-zoom filter, so the bands
    are separate runs merged into one tree. They cannot collide: each band owns
    its own zoom directories.

    Nothing is re-encoded afterwards: what lands on disk is a tile as the
    decoder in `mvt.js` reads it, which is the same discipline `bake-geology.py`
    keeps with Macrostrat's tiles.
    """
    tiles = work / "tiles"
    if tiles.exists():
        shutil.rmtree(tiles)
    tiles.mkdir(parents=True)
    for low, high, smallest, extent in LEVELS:
        if low > max_zoom:
            continue
        band = work / f"tiles-z{low}"
        if band.exists():
            shutil.rmtree(band)
        where = "kind = 'Glacier or ice cap'"
        if smallest:
            where += f" AND area_km2 >= {smallest}"
        _bake_band(gpkg, band, low, min(high, max_zoom), where, extent)
        for z in range(low, min(high, max_zoom) + 1):
            if (band / str(z)).exists():
                shutil.move(str(band / str(z)), str(tiles / str(z)))
        shutil.rmtree(band, ignore_errors=True)
        print(f"  z{low}-{min(high, max_zoom)}: {where} (extent {extent})",
              flush=True)
    return tiles


def _bake_band(gpkg: pathlib.Path, dest: pathlib.Path, low: int, high: int,
               where: str, extent: int = 4096) -> None:
    args = ["ogr2ogr", "-f", "MVT", str(dest), str(gpkg), TILE_LAYER,
            # THE GLACIERS ONLY. The two ice sheets are in the same table for
            # the count and the credit, and they do NOT go in the pyramid: Web
            # Mercator stops at 85.05 degrees, so a tiled Antarctic ice sheet is
            # a ring of ice round a hole at the pole. They ship as their own
            # small GeoJSON instead — five polygons that reach 90 south.
            "-where", where,
            "-dsco", f"MINZOOM={low}", "-dsco", f"MAXZOOM={high}",
            # UNCOMPRESSED, because these are served as files off a static site
            # and the browser only ungzips what the SERVER declares. A gzipped
            # .mvt served as-is reaches the decoder as noise.
            "-dsco", "COMPRESS=NO",
            # Generous, because the default caps drop features from a tile to
            # keep it small — which for a glacier map means glaciers quietly
            # missing.
            "-dsco", "MAX_SIZE=3000000", "-dsco", "MAX_FEATURES=500000",
            "-dsco", f"EXTENT={extent}"]
    if TILING_SCHEME:
        args += ["-dsco", f"TILING_SCHEME={TILING_SCHEME}"]
    run(args)


def _selection(shp: pathlib.Path, where: str, work: pathlib.Path, *,
               simplify: float | None) -> list:
    """One Natural Earth selection, read back as features.

    Two things this does NOT do, both settled by measurement:

    - **It does not simplify the shelves.** At 0.002 degrees (about 220 m) the
      narrow ones degenerate: measured on the 159-polygon shelf layer, one came
      back as a LINESTRING and two as features with no geometry at all, in a
      source that has no lines in it. Unsimplified they are 0.6 MB, which is not
      a saving worth a hole in the map. The two ice sheets are vast and take it
      without harm.
    - **It does not ask for `RFC7946`.** Natural Earth has already split its
      antimeridian polygons — the Ross Ice Shelf ships as two, at -180..-147 and
      158..180 — and asking GDAL to normalise them again EMPTIED one of the two
      halves: the largest ice shelf on Earth, half of it a valid feature with
      null geometry. On the ice sheets it changes nothing at all (measured
      identical: Antarctica 12,059,468 km2 and Greenland 1,746,539 km2 either
      way), so there is nothing to weigh against that.
    """
    tmp = work / "ne-selection.geojson"
    if tmp.exists():
        tmp.unlink()
    args = ["ogr2ogr", "-f", "GeoJSON", str(tmp), str(shp), "-where", where,
            "-lco", "COORDINATE_PRECISION=5"]
    if simplify:
        args += ["-simplify", str(simplify)]
    run(args)
    rows = json.loads(tmp.read_text())["features"]
    tmp.unlink()
    # A polygon layer's features are polygons. Anything else here is a
    # degenerate remnant, and a feature with no geometry is a hole wearing a
    # legend entry.
    kept = [f for f in rows
            if (f.get("geometry") or {}).get("coordinates")
            and f["geometry"]["type"] in ("Polygon", "MultiPolygon")]
    if len(kept) != len(rows):
        print(f"    dropped {len(rows) - len(kept)} feature(s) with no usable "
              "geometry", flush=True)
    return kept


def write_sheets(unpacked: pathlib.Path, work: pathlib.Path) -> pathlib.Path:
    """The ice sheets AND the ice shelves, as one small file rather than tiles.

    Two reasons they are not tiled, and the second decides it: they are a few
    dozen polygons that change on no timescale this map cares about, and Web
    Mercator cannot hold them — its own limit is 85.05 degrees and the Antarctic
    ice sheet runs to the pole, so tiled it would be a ring of ice around a hole
    exactly where the subject is.

    GROUNDED AND FLOATING ARE KEPT APART, because they are different ice: a
    shelf is the sheet's outflow afloat on the sea, it is already displacing its
    own weight of water, and the distinction is the whole of why a shelf
    collapse and an ice-sheet loss mean different things for sea level. Both are
    ice cover, so both are here — under their own `kind`, coloured apart.
    """
    dest = ROOT / "data" / "global" / "ice-sheets.geojson"
    names = ", ".join(f"'{n}'" for n in SHEETS)
    sheets = _selection(unpacked / "ne_10m_glaciated_areas.shp",
                        f"name IN ({names})", work, simplify=0.002)
    shelves = _selection(unpacked / "ne_10m_antarctic_ice_shelves_polys.shp",
                         "1 = 1", work, simplify=None)
    features = [{
        "type": "Feature",
        "properties": {
            "name": f["properties"].get("name"),
            "kind": "Ice sheet",
            "source": "Natural Earth 10m",
            "note": "Grounded ice. RGI maps the glaciers and ice caps around "
                    "the ice sheets, not the ice sheets themselves.",
        },
        "geometry": f["geometry"],
    } for f in sheets] + [{
        "type": "Feature",
        "properties": {
            "name": f["properties"].get("name"),
            "kind": "Ice shelf",
            "source": "Natural Earth 10m",
            "note": "Floating ice — the ice sheet's outflow afloat on the sea, "
                    "already displacing its own weight of water.",
        },
        "geometry": f["geometry"],
    } for f in shelves]
    out = {"type": "FeatureCollection", "features": features}
    dest.write_text(json.dumps(out))
    print(f"  ice sheets and shelves: {len(sheets)} + {len(shelves)} polygons, "
          f"{dest.stat().st_size / 1e6:.2f} MB -> {dest}")
    return dest


def install(tiles: pathlib.Path, counts: dict, max_zoom: int) -> None:
    """Move the pyramid into the site, and write the index the client reads.

    The extension changes from GDAL's `.pbf` to the `.mvt` the tiled layer asks
    for, so both baked pyramids on this site are addressed the same way.
    """
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
        size = dest.stat().st_size
        manifest[f"{z}/{x}/{y}"] = size
        total += size

    glaciers = counts.get("Glacier or ice cap", {})
    sheets = counts.get("Ice sheet", {})
    (OUT / "manifest.json").write_text(json.dumps({
        "source": "Randolph Glacier Inventory 7.0 (glacier complexes), with the "
                  "Greenland and Antarctic ice sheets from Natural Earth",
        "citation": "RGI Consortium (2023). Randolph Glacier Inventory - A "
                    "Dataset of Global Glacier Outlines, Version 7.0. Boulder, "
                    "Colorado USA. NSIDC. https://doi.org/10.5067/f6jmovy5navz",
        "licence": "CC BY 4.0 (RGI 7.0); public domain (Natural Earth 10m)",
        "format": f"Mapbox Vector Tile, layer: {TILE_LAYER} (polygons), "
                  "Web Mercator XYZ — the scheme mvt.js computes tile bounds on",
        "note": "Baked by GeoID_GIS/services/bake-glaciers.py. There is no "
                "remote behind this pyramid: past max_zoom there are no tiles, "
                "and the layer's ceiling is set from this file.",
        # A CACHE-BUSTER FOR THE TILES THEMSELVES.
        #
        # `?v=` versions the MODULES; a tile is an ordinary file at an ordinary
        # URL, so a browser that has one keeps it. Measured after a re-bake: the
        # page went on drawing the old, coarser tiles from cache while the disk
        # held finer ones — which reads as a bake that did nothing. This is a
        # fingerprint of what the pyramid holds, and `vector-tiles.js` appends
        # it to every local tile request.
        "version": f"{len(manifest)}-{total}",
        "max_zoom": max_zoom,
        "glaciers": glaciers.get("count", 0),
        "area_km2": glaciers.get("area_km2", 0.0),
        "ice_sheets": sheets.get("count", 0),
        "ice_sheets_file": "../ice-sheets.geojson",
        "ice_sheet_source": "Natural Earth 10m glaciated areas — RGI maps the "
                            "glaciers and ice caps around the ice sheets, not "
                            "the ice sheets themselves.",
        "glims": "https://www.glims.org/glacierdata/ — the multi-temporal "
                 "archive RGI is curated from; the place to go for repeat "
                 "outlines and change over time.",
        "tiles": manifest,
    }))
    print(f"{len(manifest)} tiles, {total / 1e6:.1f} MB -> {OUT}")
    print(f"manifest: {glaciers.get('count', 0):,} complexes, "
          f"{glaciers.get('area_km2', 0):,.0f} km2, "
          f"{sheets.get('count', 0)} ice-sheet polygons")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default=None,
                    help="where the downloads and the merge live (default: "
                         ".glacier-bake at the repo root, kept so a re-bake is "
                         "cheap and git-ignored because it is 400 MB)")
    ap.add_argument("--max-zoom", type=int, default=MAX_ZOOM)
    ap.add_argument("--check", action="store_true",
                    help="report what is on disk and write nothing")
    args = ap.parse_args()

    if args.check:
        path = OUT / "manifest.json"
        if not path.exists():
            sys.exit("no glacier bake on disk")
        body = json.loads(path.read_text())
        missing = [key for key in body["tiles"]
                   if not (OUT / f"{key}.mvt").exists()]
        size = sum((OUT / f"{k}.mvt").stat().st_size
                   for k in body["tiles"] if (OUT / f"{k}.mvt").exists())
        print(f"{len(body['tiles'])} tiles to zoom {body['max_zoom']}, "
              f"{size / 1e6:.1f} MB, {body['glaciers']:,} complexes")
        if missing:
            sys.exit(f"{len(missing)} tiles in the manifest are not on disk")
        return

    work = pathlib.Path(args.work) if args.work else ROOT / ".glacier-bake"
    work.mkdir(parents=True, exist_ok=True)
    print("sources …", flush=True)
    unpacked = sources(work)
    print("merging …", flush=True)
    gpkg = merge(unpacked, work)
    counts = tally(gpkg)
    print(f"  {counts}", flush=True)
    print("ice sheets and shelves …", flush=True)
    write_sheets(unpacked, work)
    print(f"baking tiles z0-{args.max_zoom} …", flush=True)
    tiles = bake_tiles(gpkg, work, args.max_zoom)
    install(tiles, counts, args.max_zoom)


if __name__ == "__main__":
    main()
