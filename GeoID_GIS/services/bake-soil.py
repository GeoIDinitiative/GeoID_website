#!/usr/bin/env python3
"""
The world's soils as a POLYGON MAP, baked into vector tiles.

The app had a soil card that sampled SoilGrids at ONE POINT — press a button,
get numbers for the middle of the view. Useful, and not a map: you cannot see
where a soil begins or ends, cannot clip to it, cannot extract by it, and
cannot put it beside the geology it sits on. This bakes the map instead, into
the same shape the world geology and the glacier inventory already take, so
everything downstream — the click card, the legend, symbology, clipping,
zonal statistics and export — works on it with nothing added.

THE SOURCE IS THE FAO/UNESCO SOIL MAP OF THE WORLD (the DSMW, FAO's digitised
1:5,000,000 sheets): **34,112 polygons, 123 dominant soil units**, the
reference global soil polygon map. Every field this writes is FAO's own —
including the names, which is the part worth insisting on.

WHY NOT SOMETHING FINER, since finer plainly exists. Measured rather than
assumed, because the answer decides the whole design:

  * **SoilGrids 250 m** (ISRIC) is twenty times the resolution and is a
    RASTER. Its WMS at `maps.isric.org` is CORS-open and its capabilities
    advertise `application/vnd.mapbox-vector-tile` — which looks like polygons
    at 250 m until you ask for one: the `MostProbable` layer returns **0 bytes**
    as MVT and a perfectly good PNG (21 classes over Ireland) as an image,
    because it is a raster layer and MapServer only vectorises vector ones.
  * **GLDAS soils** is coarser still — 0.25 degree texture classes.
  * **HWSD v2.0** is 30 arc-second and is also a raster with a side database.

So "a polygon map" and "the highest resolution" are two different products,
not one, and the honest thing is to say so rather than to hand over a raster
wearing a polygon map's clothes. This is the polygon map. The 250 m raster is
the right companion to it and belongs on the drape path, not here.

WHAT IS FAO'S AND WHAT IS OURS, because a soil map that blurs the two is worse
than none. FAO's: the polygons, the unit codes, the unit NAMES (read out of the
`.lyr` legend that ships in the download, not from anybody's memory of the
FAO-74 legend), and the per-unit soil properties in `SU_Info.xls` — sand, silt,
clay, pH, organic carbon, CEC and bulk density, topsoil and subsoil. Ours: the
COLOURS, assigned by major grouping because the download's symbology is locked
in an ESRI binary, and the `major` field, which is the legend's own capitalised
grouping row matched to each unit's first letter. The manifest says so.

    python3 GeoID_GIS/services/bake-soil.py

GDAL does the geometry, as it does for the glaciers: `ogr2ogr` on the command
line, no Python bindings (this machine's segfault on `from osgeo import ogr` is
recorded in GeoID_GIS/CLAUDE.md).
"""

from __future__ import annotations

import json
import pathlib
import re
import shutil
import subprocess
import sys
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "global" / "soil"
WORK = ROOT / "data" / "global" / ".soil-work"

# Measured working, 23 MB: FAO's own catalogue copy of the DSMW.
SOURCE = ("https://storage.googleapis.com/fao-maps-catalog-data/uuid/"
          "446ed430-8383-11db-b9b2-000d939bc5d8/resources/DSMW.zip")

TILE_LAYER = "soil"

MIN_ZOOM = 0
MAX_ZOOM = 5

# BANDED BY SIMPLIFICATION, NOT BY SELECTION, and the distinction is the whole
# difference between this map and the glacier one.
#
# The glacier bake drops small complexes at coarse zooms, which is right for a
# SPARSE subject: ice is islands in an empty sea, and a complex under a pixel
# is bytes rather than detail. Soil is CONTINUOUS — it covers every continent —
# so dropping a polygon does not thin the map, it puts a HOLE in it, and a hole
# in a soil map reads as "nothing here" about ground that certainly has soil.
#
# What is genuinely wasted at a coarse zoom is VERTICES. Baked flat, every
# level carried all 34,112 polygons at full detail and the pyramid came out at
# 43.9 MB with a **4.2 MB world tile** — which is the glacier bake's own
# measured fault (33 seconds of world tiles before the view's own were even
# requested), reproduced exactly. At zoom 0 one MVT unit is 0.088 degrees,
# about 10 km, so a vertex pair 2 km apart cannot be drawn differently however
# faithfully it is stored.
#
# The tolerance per band is roughly half an MVT unit at the band's COARSEST
# zoom, in degrees — fine enough that nothing visible moves, coarse enough that
# the redundant vertices go. Every polygon survives at every level.
#
# Simplifying independently per polygon does part neighbours along a shared
# boundary, which is the hairline the renderer's ribbon seal already exists to
# cover (see the Macrostrat notes: only 45% of edges are shared even in the
# source). So this costs nothing that is not already paid for.
# Four bands rather than three, because the world tile is the one everybody
# waits for: it is fetched before the view's own and nothing draws until it
# lands. Read as a fraction of a PIXEL at the band's coarsest zoom, every one
# of these is invisible — z0 draws the whole planet in a few hundred pixels, so
# 0.2 degrees is about a seventh of one.
LEVELS = [(0, 0, 0.2), (1, 1, 0.08), (2, 3, 0.01), (4, 5, 0.0025)]

# THE CEILING IS THE SOURCE'S, NOT THE FORMAT'S, and this is the one number
# here worth arguing about. The glacier bake doubles the MVT grid to 8192 and
# goes to zoom 6, because RGI's outlines are digitised from 15-30 m imagery and
# the quantisation really was visible as a staircase. This map is 1:5,000,000 —
# its own positional accuracy is a couple of kilometres — so at zoom 6 and
# extent 8192 the tiles were placing vertices to about 32 m: 55 MB of a
# precision FAO never claimed, on a repo already over the Pages limit.
#
# Zoom 5 at the 4096 convention puts the step at roughly 300 m at the equator,
# still an order of magnitude finer than the source, and the pyramid costs a
# fraction of it. Past zoom 5 there are no tiles and `max_zoom` in the manifest
# says so, which is the same honest ceiling the glaciers publish.
EXTENT = 4096

# Ours, and the manifest says so. One hue per major grouping — the legend's own
# capitalised rows — because 123 units is far past what any palette can
# separate, and because the grouping is the thing a reader can actually hold in
# mind. A unit keeps its own full name; only the colour is generalised.
#
# The miscellaneous land units are deliberately drab: water, ice, rock, salt
# and dunes are NOT soils, and giving them a soil's saturation would put five
# false classes at the top of every legend by area.
# KEYED BY THE CODE'S FIRST LETTER, NOT BY THE GROUPING'S NAME.
#
# The FAO legend is systematic — the first letter IS the major grouping, and
# every subunit inherits it — so a letter is an exact key that needs no
# spelling. Keying on the name instead cost eight units their colour and took
# two rounds to see, for two separate reasons:
#
#   * A GROUPING WITH ONE UNIT HAS NO CAPITALISED ROW. Lithosols is just `I`;
#     the legend never writes `I -LITHOSOLS`, so a lookup by grouping name
#     found nothing — and Lithosols is the commonest unit on the whole map,
#     4,266 polygons of thin mountain soil, every one of them drawn in the
#     no-value grey.
#   * FAO'S OWN LEGEND IS MISSPELT, twice: it writes `KASTAZNOZEMS` for
#     Kastanozems and `VERTSOLS` for Vertisols. Any palette keyed on the
#     correct spelling misses both, and any palette keyed on the source's
#     spelling is one silent correction away from missing them again.
#
# Ours, and the manifest says so. One hue per grouping, because 123 units is
# far past what a palette can separate and the grouping is what a reader can
# hold in mind. The miscellaneous land units are deliberately drab: water, ice,
# rock, salt and dunes are NOT soils, and giving them a soil's saturation would
# put five false classes at the top of every legend by area.
GROUP_COLOURS = {
    "A": "#c96f3f",   # Acrisols
    "B": "#d9a05b",   # Cambisols
    "C": "#3b2a20",   # Chernozems
    "D": "#a68fb0",   # Podzoluvisols
    "E": "#9fae8f",   # Rendzinas
    "F": "#b5442f",   # Ferralsols
    "G": "#5f8fa8",   # Gleysols
    "H": "#5a4632",   # Phaeozems
    "I": "#9a9a93",   # Lithosols
    "J": "#7fb8d4",   # Fluvisols
    "K": "#a4703c",   # Kastanozems
    "L": "#d98f4f",   # Luvisols
    "M": "#8c8f7a",   # Greyzems
    "N": "#a8542f",   # Nitosols
    "O": "#4d3b2a",   # Histosols
    "P": "#8e7f9e",   # Podzols
    "Q": "#e8cf87",   # Arenosols
    "R": "#c9bda0",   # Regosols
    "S": "#c2a878",   # Solonetz
    "T": "#6b4a2f",   # Andosols
    "U": "#8f9a7d",   # Rankers
    "V": "#4a4a45",   # Vertisols
    "W": "#b0a884",   # Planosols
    "X": "#dcc79a",   # Xerosols
    "Y": "#e2d3a8",   # Yermosols
    "Z": "#d7cfc0",   # Solonchaks
}

# THE SOURCE'S OWN TYPOS, corrected for DISPLAY and named so the correction is
# arguable rather than silent. These are the legend's strings verbatim on the
# left; a legend row reading "Kastaznozems" reads as our mistake, and carrying
# it faithfully would be faithfulness nobody can act on.
LEGEND_TYPOS = {
    "KASTAZNOZEMS": "KASTANOZEMS",
    "VERTSOLS": "VERTISOLS",
}

MISC_COLOURS = {
    "DS": "#efe4c4",   # dunes / shifting sand
    "GL": "#eaf2f7",   # glaciers
    "ND": "#d5d5d5",   # no data
    "RK": "#b3b0aa",   # rock debris
    "ST": "#e6e0d2",   # salt flats
    "WR": "#a8c8dd",   # water bodies
    "WA": "#a8c8dd",   # the legend's spelling of the same thing
}
UNKNOWN_COLOUR = "#bdbdbd"

# THE DATA AND THE LEGEND DISAGREE ABOUT ONE CODE, and it is the commonest
# miscellaneous unit on the map. The polygons carry `WR` for water; the legend
# in the .lyr writes "Water Bodies (WA)". Unaliased, 3,350 polygons — a tenth
# of the map, every lake and inland sea — came through as the bare string "WR"
# with no name, which reads as a hole in the legend rather than as a spelling.
# Aliased rather than special-cased at the lookup, so the mapping is one line
# to check against the source.
CODE_ALIASES = {"WR": "WA"}


def run(args: list[str]) -> None:
    done = subprocess.run(args, capture_output=True, text=True)
    if done.returncode != 0:
        sys.exit(f"FAILED: {' '.join(args[:6])}…\n{done.stderr[:2000]}")


def fetch(url: str, dest: pathlib.Path) -> pathlib.Path:
    if dest.exists() and dest.stat().st_size > 0:
        print(f"  have {dest.name} ({dest.stat().st_size / 1e6:.1f} MB)")
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  fetching {url}")
    with urllib.request.urlopen(url, timeout=300) as response:
        dest.write_bytes(response.read())
    print(f"  {dest.name}: {dest.stat().st_size / 1e6:.1f} MB")
    return dest


def legend_from_lyr(lyr: pathlib.Path) -> dict[str, str]:
    """
    FAO'S OWN NAMES, read out of the ESRI layer file that ships beside the
    shapefile — never written from memory.

    The `.lyr` is a binary, but its labels are plain UTF-16LE, and it carries
    the legend in TWO shapes, which is the only subtlety here:

        `Af-Ferric Acrisols`      the soil units, code first
        `Water Bodies (WA)`       the miscellaneous land units, code last

    Reading only the first pattern names 117 of the 123 codes the polygons
    carry and leaves water, ice, rock, salt, dunes and no-data — 5,505
    polygons, a sixth of the map — as bare abbreviations. The capitalised rows
    (`A -ACRISOLS`) are the major groupings and are kept apart from the units.
    """
    if not shutil.which("strings"):
        sys.exit("`strings` is needed to read the FAO legend out of DSMW.lyr")
    raw = subprocess.run(["strings", "-e", "l", str(lyr)],
                         capture_output=True, text=True).stdout
    names: dict[str, str] = {}
    for line in raw.splitlines():
        code_first = re.match(r"^\s*([A-Za-z]{1,2})\s*-\s*([A-Za-z' ()/-]+?)\s*$", line)
        if code_first:
            names.setdefault(code_first.group(1), code_first.group(2).strip())
            continue
        code_last = re.match(r"^\s*([A-Za-z][A-Za-z /]+?)\s*\(([A-Z]{2})\)\s*$", line)
        if code_last:
            names.setdefault(code_last.group(2), code_last.group(1).strip())
    return names


def properties_from_workbook(xls: pathlib.Path) -> dict[str, dict]:
    """
    FAO's measured soil properties per unit symbol, from `SU_Info.xls`.

    Twenty-four columns, topsoil and subsoil. Six are kept — the ones that say
    what the material IS and how it will behave: the texture triangle, how acid
    it is, how much organic carbon it holds, and its bulk density. The rest
    (CEC, base saturation, CaCO3, C/N) are agronomic and would be a wall of
    numbers on a card nobody reads.

    Keyed by the symbol as the workbook writes it, upper-cased: the sheet says
    `AF` where the polygons say `Af`.
    """
    try:
        import xlrd                                       # noqa: PLC0415
    except ImportError:
        print("  xlrd not installed — skipping the soil property table")
        return {}
    sheet = xlrd.open_workbook(str(xls)).sheet_by_index(0)
    # Row 1 holds the headers, and its first two cells are blank.
    headers = [str(sheet.cell_value(1, c)).strip() for c in range(sheet.ncols)]
    wanted = {
        "sand % topsoil": "sand_pct", "silt % topsoil": "silt_pct",
        "clay % topsoil": "clay_pct", "pH2O topsoil": "ph",
        "OC % topsoil": "organic_carbon_pct", "BD topsoil": "bulk_density",
    }
    columns = {headers.index(h): key for h, key in wanted.items() if h in headers}
    table: dict[str, dict] = {}
    for r in range(2, sheet.nrows):
        symbol = str(sheet.cell_value(r, 1)).strip().upper()
        # `AF 1` and `AF 2` are texture-phase variants of `AF`; the polygons
        # carry the plain symbol, so only the unqualified row is taken.
        if not symbol or " " in symbol:
            continue
        row = {}
        for col, key in columns.items():
            try:
                value = float(str(sheet.cell_value(r, col)).strip())
            except ValueError:
                continue
            # FAO WRITES -1 FOR "NOT MEASURED", and it reached the map: a card
            # read "bulk density -1", which is not a low density, it is an
            # absence wearing a number's clothes. Every one of these six is a
            # percentage, a pH or a density, so none can be zero or negative
            # and the test is the same for all of them. Same family as
            # `Number("")` being 0 — a missing value that arrives as a
            # plausible measurement is worse than one that arrives as nothing.
            if value <= 0:
                continue
            row[key] = round(value, 1)
        if row:
            table.setdefault(symbol, row)
    return table


def build_geojson(shp: pathlib.Path, names: dict[str, str],
                  props: dict[str, dict], work: pathlib.Path) -> tuple[pathlib.Path, dict]:
    """The polygons, with the legend and the properties joined onto each one."""
    plain = work / "dsmw.geojson"
    if plain.exists():
        plain.unlink()
    run(["ogr2ogr", "-f", "GeoJSON", str(plain), str(shp),
         # The shapefile carries no .prj. It is plain geographic degrees —
         # its extent is -180..180, -56..83.6 — so the CRS is DECLARED rather
         # than guessed at, or GDAL bakes the tiles against an unknown frame.
         "-a_srs", "EPSG:4326",
         "-select", "SNUM,FAOSOIL,DOMSOI,PHASE1,PHASE2,PERMAFROST,SQKM"])

    data = json.loads(plain.read_text())
    groups = {code: name for code, name in names.items() if name.isupper()}
    counts = {"named": 0, "unnamed": 0, "with_properties": 0}
    seen_units: dict[str, dict] = {}

    for feature in data["features"]:
        p = feature["properties"]
        code = (p.get("DOMSOI") or "").strip()
        name = names.get(code) or names.get(CODE_ALIASES.get(code, ""))
        # The major grouping is the legend's own capitalised row for this
        # unit's FIRST letter — `Af` is an Acrisol because `A` is ACRISOLS.
        # A miscellaneous unit has no grouping and must not borrow one: `WR`
        # would otherwise be filed under W for PLANOSOLS.
        misc = code in MISC_COLOURS
        letter = code[:1].upper()
        # The legend's own capitalised row where it has one; otherwise the
        # unit's own name, because a grouping with a single unit (Lithosols)
        # never gets a row of its own.
        group = None if misc else (groups.get(letter) or (name or "").upper())
        group = LEGEND_TYPOS.get(group, group)
        colour = (MISC_COLOURS.get(code)
                  or (None if misc else GROUP_COLOURS.get(letter))
                  or UNKNOWN_COLOUR)
        counts["named" if name else "unnamed"] += 1

        new = {
            "code": code,
            "name": name or code or "Unmapped",
            "group": group or ("Not a soil" if misc else None),
            "colour": colour,
            "unit": (p.get("FAOSOIL") or "").strip() or None,
            "area_km2": round(float(p.get("SQKM") or 0), 1),
        }
        # A FLAG IS ONLY WORTH CARRYING WHEN IT IS SET. The column is "0" or
        # "1", and "Permafrost 0" on a card is a row that says nothing while
        # looking like it says something.
        if str(p.get("PERMAFROST") or "").strip() not in ("", "0"):
            new["permafrost"] = "yes"
        # PHASE IS A NUMERIC CODE AND NOTHING NAMES IT. The `.lyr` legend that
        # names every soil unit carries no phase list, and neither does any
        # workbook in the download — so the card read "Re33-1a · 06", where the
        # `06` is a bare code a reader can do nothing with. Dropped rather than
        # displayed, on the same rule `rock-class.js` keeps: an abbreviation
        # beats a name that was inferred, and no line beats an abbreviation
        # that names nothing.
        soil = props.get(code.upper())
        if soil:
            new.update(soil)
            counts["with_properties"] += 1
        feature["properties"] = {k: v for k, v in new.items() if v is not None}
        seen_units.setdefault(code, {"name": new["name"], "group": new["group"],
                                     "colour": colour})

    joined = work / "soil.geojson"
    joined.write_text(json.dumps(data))
    counts["units"] = len(seen_units)
    counts["features"] = len(data["features"])
    counts["units_table"] = seen_units
    return joined, counts


def bake_tiles(geojson: pathlib.Path, work: pathlib.Path) -> pathlib.Path:
    """One ogr2ogr run per band, merged into one tree.

    GDAL bakes a zoom RANGE in a single pass and has no per-zoom simplify, so
    the bands are separate runs. They cannot collide: each owns its own zoom
    directories, which is the arrangement `bake-glaciers.py` arrived at for the
    same reason.
    """
    tiles = work / "tiles"
    if tiles.exists():
        shutil.rmtree(tiles)
    tiles.mkdir(parents=True)
    for low, high, tolerance in LEVELS:
        band = work / f"tiles-z{low}"
        if band.exists():
            shutil.rmtree(band)
        run(["ogr2ogr", "-f", "MVT", str(band), str(geojson),
             "-nln", TILE_LAYER,
             "-simplify", str(tolerance),
             "-dsco", f"MINZOOM={low}", "-dsco", f"MAXZOOM={high}",
             # Uncompressed: these are served as files off a static site, and
             # the browser only ungzips what the SERVER declares.
             "-dsco", "COMPRESS=NO",
             # Generous, or GDAL's default caps drop features to keep a tile
             # small — which on a continuous map means holes.
             "-dsco", "MAX_SIZE=5000000", "-dsco", "MAX_FEATURES=500000",
             "-dsco", f"EXTENT={EXTENT}"])
        for z in range(low, high + 1):
            if (band / str(z)).exists():
                shutil.move(str(band / str(z)), str(tiles / str(z)))
        shutil.rmtree(band, ignore_errors=True)
        print(f"  z{low}-{high}: simplified to {tolerance}deg", flush=True)
    return tiles


def install(tiles: pathlib.Path, counts: dict) -> None:
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
        "source": "FAO/UNESCO Digital Soil Map of the World (DSMW), "
                  "FAO's digitised 1:5,000,000 sheets",
        "source_url": "https://www.fao.org/soils-portal/data-hub/"
                      "soil-maps-and-databases/faounesco-soil-map-of-the-world/en/",
        "citation": "FAO/UNESCO (2007). Digital Soil Map of the World, "
                    "version 3.6. FAO, Rome.",
        "licence": "FAO — CC BY 4.0, attribution required",
        "scale": "1:5,000,000",
        "format": f"Mapbox Vector Tile, layer: {TILE_LAYER} (polygons), "
                  "Web Mercator XYZ — the scheme mvt.js computes tile bounds on",
        # THE HONEST SPLIT, restated where the client can read it.
        "ours": "The COLOURS (one hue per major grouping; the download's own "
                "symbology is locked in an ESRI binary) and the `group` field "
                "(the legend's capitalised grouping matched to each unit's "
                "first letter). Everything else is FAO's.",
        "theirs": "The polygons, the unit codes, the unit names (read from the "
                  "legend in DSMW.lyr) and the soil properties (sand, silt, "
                  "clay, pH, organic carbon and bulk density, topsoil, from "
                  "SU_Info.xls).",
        "resolution_note": "A 1:5,000,000 polygon map. SoilGrids (ISRIC) is "
                           "250 m and is a RASTER — measured: its WMS returns "
                           "0 bytes for vector tiles and a PNG for images — so "
                           "it is a companion to this map, not a finer version "
                           "of it.",
        "note": "Baked by GeoID_GIS/services/bake-soil.py. There is no remote "
                "behind this pyramid: past max_zoom there are no tiles.",
        # The tile cache-buster the glacier bake documents: `?v=` versions the
        # modules, and a tile is an ordinary file at an ordinary URL.
        "version": f"{len(manifest)}-{total}",
        "max_zoom": MAX_ZOOM,
        "polygons": counts["features"],
        "units": counts["units"],
        "tiles": manifest,
    }))
    (OUT / "units.json").write_text(json.dumps(counts["units_table"]))
    print(f"{len(manifest)} tiles, {total / 1e6:.1f} MB -> {OUT}")


def main() -> int:
    WORK.mkdir(parents=True, exist_ok=True)
    print("Baking the FAO/UNESCO Soil Map of the World…")
    archive = fetch(SOURCE, WORK / "DSMW.zip")
    unpacked = WORK / "dsmw"
    if not (unpacked / "DSMW.shp").exists():
        unpacked.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(archive) as zf:
            zf.extractall(unpacked)

    names = legend_from_lyr(unpacked / "DSMW.lyr")
    print(f"  legend: {len(names)} codes named by FAO's own .lyr")
    props = properties_from_workbook(unpacked / "SU_Info.xls")
    print(f"  properties: {len(props)} units carry measured soil values")

    joined, counts = build_geojson(unpacked / "DSMW.shp", names, props, WORK)
    print(f"  {counts['features']:,} polygons, {counts['units']} dominant units; "
          f"{counts['named']:,} named, {counts['unnamed']:,} unnamed; "
          f"{counts['with_properties']:,} carry soil properties")
    if counts["unnamed"]:
        print("  WARNING: unnamed polygons mean the legend did not cover the data")

    tiles = bake_tiles(joined, WORK)
    install(tiles, counts)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
