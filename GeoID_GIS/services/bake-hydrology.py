"""
Global hydrography, baked into vector tiles: lakes, rivers and the ocean.

Three pyramids from the source archives mirrored in R2 under `shapefiles/`
(see GeoID_GIS/CLAUDE.md for why HydroRIVERS is not among them):

  hydrolakes  HydroLAKES v1.0 -- 1,427,688 lakes and reservoirs of 10 ha or
              more (Messager et al. 2016), CC BY 4.0
  grwl        GRWL v01.01 -- centrelines of rivers 30 m or wider, with widths
              (Allen & Pavelsky 2018), CC BY 4.0
  ocean       Natural Earth 1:10m ocean for the coarse levels, OpenStreetMap
              water polygons for the fine ones (ODbL)

and one small file, `marine_polys_10m.geojson` -- Natural Earth's 306 named
oceans, seas and bays -- which is a catalogue file rather than a pyramid.

    python3 GeoID_GIS/services/bake-hydrology.py grwl
    python3 GeoID_GIS/services/bake-hydrology.py hydrolakes
    python3 GeoID_GIS/services/bake-hydrology.py ocean
    python3 GeoID_GIS/services/bake-hydrology.py marine

ONE AT A TIME, AND NOTHING EXTRACTED. This machine has single-digit gigabytes
free, and HydroLAKES alone is 1.8 GB once unzipped. So a source zip is fetched
from our own R2 mirror into the scratch directory, every band reads it in
place through GDAL's `/vsizip/` with a WHERE clause selecting only that band's
features, and the zip is deleted when its pyramid is written. No GeoPackage
intermediate (the GLiM bake staged 3 GB of one).

BANDED BY SELECTION, the glacier pattern, not the soil pattern. Lakes and
rivers are SPARSE subjects -- islands of water in land -- so a polygon too small
to see at a level is left out of that level rather than simplified into a
sliver. The thresholds are pixel arithmetic: at zoom z a 256 px tile spans
360/2^z degrees, so at z2 a pixel is ~39 km and a lake under ~1,000 km2 is a
dot at best. The ocean is the opposite, CONTINUOUS, and is banded by
simplification like the soils: dropping a piece of sea would put a hole in it.

GDAL does the geometry on the command line; this machine's Python bindings
segfault (recorded in GeoID_GIS/CLAUDE.md).
"""

from __future__ import annotations

import json
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
GLOBAL = ROOT / "data" / "global"
WORK = GLOBAL / ".hydro-work"
MIRROR = "https://data.geoidinitiative.com/shapefiles"
EXTENT = 4096

# ── the classes each pyramid is drawn and legended by ─────────────────────
# Named in the order a key reads, and PUBLISHED in classes.json so the page's
# legend and the tiles' colours come from one table.
LAKE_CLASSES = [
    ("lake", "Natural lake", "#3d8fd1"),
    ("reservoir", "Reservoir", "#39b6c4"),
    ("regulated", "Natural lake, regulated by a dam", "#6a7fe0"),
]
RIVER_CLASSES = [
    # GRWL's median width at mean discharge. Blues darken with width, the
    # convention a river map already uses for size.
    ("w30", "30 – 100 m", "#9fd0f0", 30, 100),
    ("w100", "100 – 300 m", "#5fb0e8", 100, 300),
    ("w300", "300 m – 1 km", "#2f86d0", 300, 1000),
    ("w1000", "Wider than 1 km", "#1b5fa8", 1000, None),
]
OCEAN_CLASSES = [("ocean", "Ocean and seas", "#1e5a8c")]

DATASETS = {
    "hydrolakes": {
        "zip": "lakes/HydroLAKES_polys_v10_shp.zip",
        "inner": "HydroLAKES_polys_v10_shp/HydroLAKES_polys_v10.shp",
        "layer": "HydroLAKES_polys_v10",
        "tile_layer": "lakes",
        "max_zoom": 7,
        # (min zoom, max zoom, WHERE, simplify tolerance in degrees)
        "bands": [
            (0, 2, "Lake_area >= 1000", 0.02),
            (3, 4, "Lake_area >= 50", 0.004),
            (5, 6, "Lake_area >= 2", 0.0008),
            (7, 7, None, 0.0002),
        ],
        "select": (
            "Hylak_id AS id, Lake_name AS name, Country AS country, "
            "Lake_type AS lake_type, "
            "CASE Lake_type WHEN 2 THEN 'reservoir' WHEN 3 THEN 'regulated' "
            "ELSE 'lake' END AS class, "
            "CASE Lake_type WHEN 2 THEN '#39b6c4' WHEN 3 THEN '#6a7fe0' "
            "ELSE '#3d8fd1' END AS colour, "
            "Lake_area AS area_km2, Vol_total AS volume_mcm, "
            "Depth_avg AS depth_avg_m, Elevation AS elevation_m, "
            "Shore_len AS shore_km, Res_time AS residence_days, "
            "Wshd_area AS watershed_km2, Dis_avg AS discharge_m3s, "
            # 1 = reported by the lake's own survey, 2 = reported for a
            # reservoir (GRanD), 3 = HydroLAKES' geostatistical model. A card
            # that quotes a modelled volume must be able to say so.
            "Vol_src AS volume_source"),
        "classes": LAKE_CLASSES,
        "count_field": "class",
        "manifest": {
            "source": "HydroLAKES v1.0 (Messager et al. 2016)",
            "source_url": "https://www.hydrosheds.org/products/hydrolakes",
            "citation": "Messager, M.L., Lehner, B., Grill, G., Nedeva, I., "
                        "Schmitt, O. (2016). Estimating the volume and age of "
                        "water stored in global lakes using a geo-statistical "
                        "approach. Nature Communications 7: 13603. "
                        "doi:10.1038/ncomms13603",
            "licence": "CC BY 4.0",
            "scale": "shorelines of every lake and reservoir of 10 ha or more",
            "ours": "The colours and the size bands: lakes under 1,000 km2 "
                    "are left out of zooms 0-2, under 50 km2 out of 3-4 and "
                    "under 2 km2 out of 5-6, because they are under a pixel "
                    "there. Everything else is HydroLAKES'.",
        },
    },
    "grwl": {
        "zip": "rivers/GRWL_summaryStats_V01.01.zip",
        "inner": None,
        "layer": "GRWL_summaryStats",
        "tile_layer": "rivers",
        "max_zoom": 7,
        "bands": [
            (0, 2, "width_med_ >= 500", 0.02),
            (3, 4, "width_med_ >= 150", 0.004),
            (5, 7, None, 0.0006),
        ],
        "select": (
            # OBJECTID, not ID: GRWL's ID numbers a segment within its own
            # tile and repeats across the world (350 distinct values over
            # thousands of segments at z0). OBJECTID is the one unique key.
            "OBJECTID AS id, nSegPx AS measurements, "
            "CASE WHEN width_med_ >= 1000 THEN 'w1000' "
            "WHEN width_med_ >= 300 THEN 'w300' "
            "WHEN width_med_ >= 100 THEN 'w100' ELSE 'w30' END AS class, "
            "CASE WHEN width_med_ >= 1000 THEN '#1b5fa8' "
            "WHEN width_med_ >= 300 THEN '#2f86d0' "
            "WHEN width_med_ >= 100 THEN '#5fb0e8' ELSE '#9fd0f0' END AS colour, "
            "width_med_ AS width_median_m, width_mean AS width_mean_m, "
            "width_min_ AS width_min_m, width_max_ AS width_max_m, "
            "width_sd_m AS width_sd_m, lakeFlag AS lake_flag"),
        "classes": [(c, n, col) for c, n, col, _lo, _hi in RIVER_CLASSES],
        "count_field": "class",
        "manifest": {
            "source": "GRWL — Global River Widths from Landsat v01.01 "
                      "(Allen & Pavelsky 2018)",
            "source_url": "https://doi.org/10.5281/zenodo.1297434",
            "citation": "Allen, G.H., Pavelsky, T.M. (2018). Global extent of "
                        "rivers and streams. Science 361(6402): 585-588. "
                        "doi:10.1126/science.aat0636",
            "licence": "CC BY 4.0",
            "scale": "centrelines of rivers and streams at least 30 m wide at "
                     "mean discharge, from 30 m Landsat imagery",
            "ours": "The width classes and their colours, and the bands: "
                    "rivers under 500 m wide are left out of zooms 0-2 and "
                    "under 150 m out of 3-4. The widths are GRWL's.",
        },
    },
    "ocean": {
        "max_zoom": 6,
        # Covers the whole planet, so every tile at the coarse levels must
        # exist -- install() refuses a pyramid that lost one.
        "continuous": True,
        "tile_layer": "ocean",
        # Two sources in one pyramid, each for the levels it is right at: the
        # 1:10m ocean is one polygon and triangulates in a blink from orbit;
        # the OSM water polygons are coastline-exact and only worth their
        # bytes once a coast is more than a pixel wide.
        "sources": [
            {"zip": "ocean/ne_10m_ocean.zip", "inner": "ne_10m_ocean.shp",
             "layer": "ne_10m_ocean",
             "bands": [(0, 1, None, 0.05), (2, 3, None, 0.01)]},
            {"zip": "ocean/osm-water-polygons-split-4326-2026-09-10.zip",
             "inner": "water-polygons-split-4326/water_polygons.shp",
             "layer": "water_polygons",
             "bands": [(4, 5, None, 0.004), (6, 6, None, 0.0015)]},
        ],
        "select": "'ocean' AS class, '#1e5a8c' AS colour",
        "classes": OCEAN_CLASSES,
        "manifest": {
            "source": "Natural Earth 1:10m ocean (zooms 0-3); OpenStreetMap "
                      "water polygons, 2026-09-10 (zooms 4-6)",
            "source_url": "https://osmdata.openstreetmap.de/data/water-polygons.html",
            "citation": "© OpenStreetMap contributors, Open Database Licence "
                        "(ODbL) 1.0; Natural Earth (public domain)",
            "licence": "ODbL 1.0 for the OpenStreetMap-derived levels "
                       "(attribution required); public domain for the Natural "
                       "Earth levels",
            "scale": "1:10m at zooms 0-3, coastline-exact from zoom 4",
            "ours": "The choice of source per level and the simplification "
                    "per band. The sea is continuous, so it is simplified "
                    "rather than thinned.",
        },
    },
}


def run(args: list[str]) -> None:
    done = subprocess.run(args, capture_output=True, text=True)
    if done.returncode != 0:
        sys.exit(f"FAILED: {' '.join(args[:8])}…\n{done.stderr[:2000]}")


def fetch(zip_key: str) -> pathlib.Path:
    """Our own R2 mirror into the scratch directory -- once per source."""
    WORK.mkdir(parents=True, exist_ok=True)
    local = WORK / pathlib.Path(zip_key).name
    if local.exists() and local.stat().st_size > 0:
        return local
    print(f"  fetching {zip_key}…", flush=True)
    run(["curl", "-sSfL", "--retry", "3", "-o", str(local), f"{MIRROR}/{zip_key}"])
    return local


def vsi(local: pathlib.Path, inner: str | None) -> str:
    return f"/vsizip/{local}" + (f"/{inner}" if inner else "")


def bake_band(src: str, layer: str, select: str, tile_layer: str, low: int,
              high: int, where: str | None, tolerance: float,
              tiles: pathlib.Path) -> None:
    band = WORK / f"band-z{low}"
    if band.exists():
        shutil.rmtree(band)
    sql = f'SELECT {select}, GEOMETRY FROM "{layer}"' + (f" WHERE {where}" if where else "")
    run(["ogr2ogr", "-f", "MVT", str(band), src,
         "-dialect", "sqlite", "-sql", sql,
         "-nln", tile_layer,
         "-simplify", str(tolerance),
         # SIMPLIFICATION CAN MAKE A POLYGON INVALID, AND THE MVT WRITER THEN
         # DROPS IT FROM THE TILE WITHOUT A WORD. Measured on the 1:10m ocean:
         # simplified at 0.05 deg, z0 came out with NO tile and z1 with only
         # its two southern ones -- half the world's sea missing from orbit,
         # exit code 0, no warning even under CPL_DEBUG. -makevalid restores
         # all five. Every band, because a lake shoreline simplifies the same.
         "-makevalid",
         "-dsco", f"MINZOOM={low}", "-dsco", f"MAXZOOM={high}",
         "-dsco", "COMPRESS=NO",
         "-dsco", "MAX_SIZE=5000000", "-dsco", "MAX_FEATURES=1000000",
         "-dsco", f"EXTENT={EXTENT}"])
    for z in range(low, high + 1):
        if (band / str(z)).exists():
            shutil.move(str(band / str(z)), str(tiles / str(z)))
    shutil.rmtree(band, ignore_errors=True)
    print(f"  z{low}-{high}: {where or 'everything'}, simplified to {tolerance} deg",
          flush=True)


def tally(src: str, layer: str, select: str) -> dict[str, int]:
    done = subprocess.run(
        ["ogr2ogr", "-f", "CSV", "/vsistdout/", src, "-dialect", "sqlite",
         "-sql", f'SELECT class, count(*) AS n FROM (SELECT {select} FROM "{layer}") GROUP BY class'],
        capture_output=True, text=True)
    out: dict[str, int] = {}
    for line in done.stdout.strip().splitlines()[1:]:
        cls, _, n = line.rpartition(",")
        out[cls.strip('"')] = int(n)
    return out


def install(name: str, tiles: pathlib.Path, spec: dict, counts: dict[str, int]) -> None:
    out = GLOBAL / name
    # The manifest and classes table stay tracked; only the tile directories go.
    for child in list(out.glob("[0-9]*")) if out.exists() else []:
        shutil.rmtree(child)
    out.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, int] = {}
    total = 0
    for pbf in sorted(tiles.rglob("*.pbf")):
        z, x, y = pbf.parts[-3], pbf.parts[-2], pbf.stem
        dest = out / z / x / f"{y}.mvt"
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(pbf), dest)
        manifest[f"{z}/{x}/{y}"] = dest.stat().st_size
        total += dest.stat().st_size
    shutil.rmtree(tiles, ignore_errors=True)
    # A CONTINUOUS LAYER WITH A MISSING COARSE TILE IS A HOLE IN THE PLANET,
    # and the MVT writer makes one silently when a simplified polygon is
    # invalid (see bake_band). Checked here so the bake fails rather than the
    # map: at z0 and z1 every one of the 1 + 4 tiles must be there.
    if spec.get("continuous"):
        missing = [f"{z}/{x}/{y}" for z in (0, 1) for x in range(2 ** z)
                   for y in range(2 ** z) if f"{z}/{x}/{y}" not in manifest]
        if missing:
            sys.exit(f"{name}: coarse tiles missing from a continuous layer: "
                     f"{', '.join(missing)}")
    classes = {code: {"name": label, "colour": colour, "order": i,
                      "count": counts.get(code, 0)}
               for i, (code, label, colour) in enumerate(spec["classes"])}
    (out / "manifest.json").write_text(json.dumps({
        **spec["manifest"],
        "format": f"Mapbox Vector Tile, layer: {spec['tile_layer']}, Web "
                  "Mercator XYZ — the scheme mvt.js computes tile bounds on",
        "note": "Baked by GeoID_GIS/services/bake-hydrology.py from the source "
                "archives mirrored under shapefiles/ in R2. There is no "
                "remote behind this pyramid: past max_zoom there are no tiles.",
        "version": f"{len(manifest)}-{total}",
        "max_zoom": spec["max_zoom"],
        "features": sum(counts.values()),
        "classes": len(classes),
        "tiles": manifest,
    }))
    (out / "classes.json").write_text(json.dumps(classes))
    print(f"{name}: {len(manifest)} tiles, {total / 1e6:.1f} MB, "
          f"{sum(counts.values()):,} features -> {out}")


def bake(name: str) -> None:
    spec = DATASETS[name]
    tiles = WORK / f"{name}-tiles"
    if tiles.exists():
        shutil.rmtree(tiles)
    tiles.mkdir(parents=True)
    counts: dict[str, int] = {}
    sources = spec.get("sources") or [spec]
    for source in sources:
        local = fetch(source["zip"])
        src = vsi(local, source.get("inner"))
        for low, high, where, tolerance in source["bands"]:
            bake_band(src, source["layer"], spec["select"], spec["tile_layer"],
                      low, high, where, tolerance, tiles)
        # The count is of the SOURCE the finest levels come from -- for the
        # ocean that is the OSM polygons, which is what anyone clicking sees.
        if source is sources[-1]:
            counts = tally(src, source["layer"], spec["select"])
        local.unlink()
    install(name, tiles, spec, counts)


def marine() -> None:
    """Natural Earth's named oceans, seas and bays: a small file, not a pyramid."""
    local = fetch("ocean/ne_10m_geography_marine_polys.zip")
    out = GLOBAL / "marine_polys_10m.geojson"
    if out.exists():
        out.unlink()
    run(["ogr2ogr", "-f", "GeoJSON", str(out), vsi(local, None),
         "-dialect", "sqlite", "-sql",
         'SELECT name, featurecla AS kind, scalerank AS rank, GEOMETRY '
         'FROM "ne_10m_geography_marine_polys"',
         "-lco", "COORDINATE_PRECISION=4", "-lco", "RFC7946=NO"])
    local.unlink()
    tidy_marine(out)
    print(f"marine: {out} ({out.stat().st_size / 1e6:.1f} MB)")


def polygons_of(geometry: dict | None) -> list:
    """The polygon rings of any geometry: a collection keeps its polygon members."""
    if not geometry:
        return []
    kind = geometry.get("type")
    if kind == "Polygon":
        return [geometry["coordinates"]]
    if kind == "MultiPolygon":
        return list(geometry["coordinates"])
    if kind == "GeometryCollection":
        return [p for g in geometry.get("geometries", []) for p in polygons_of(g)]
    return []


def tidy_marine(path: pathlib.Path) -> None:
    """
    Two things Natural Earth's file does that a polygon layer cannot take.

    MIXED GEOMETRY. Three features are GeometryCollections -- the Southern
    Ocean, the South Atlantic and the Great Barrier Reef, polygons with stray
    lines inside -- and two are bare lines. `-nlt MULTIPOLYGON` passes the
    collections through untouched, and the importer then reads a feature with
    no `coordinates`. Every feature becomes a MultiPolygon of its polygon
    members; one with none is dropped (a line has no sea to fill).

    SHOUTED NAMES. The oceans are written in capitals ("SOUTHERN OCEAN"), a
    label style for the printed map rather than the name; title case here.
    """
    data = json.loads(path.read_text())
    kept, dropped = [], []
    for feature in data["features"]:
        polys = polygons_of(feature.get("geometry"))
        name = feature["properties"].get("name") or ""
        if name.isupper():
            feature["properties"]["name"] = name.title()
        if not polys:
            dropped.append(name)
            continue
        feature["geometry"] = {"type": "MultiPolygon", "coordinates": polys}
        kept.append(feature)
    data["features"] = kept
    path.write_text(json.dumps(data, separators=(",", ":")))
    print(f"  {len(kept)} named waters kept; dropped (no polygon): {dropped}")


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in (*DATASETS, "marine"):
        sys.exit(f"usage: bake-hydrology.py {{{'|'.join((*DATASETS, 'marine'))}}}")
    which = sys.argv[1]
    if which == "marine":
        marine()
    else:
        bake(which)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
