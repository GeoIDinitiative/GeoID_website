# Global vector datasets

The layers offered by **Data · Vectors & Shapes ▸ Global catalogue** in the GIS
viewer. Everything here is derived from a public source, and this file is how it
was derived — so the set can be rebuilt, updated or checked without guessing.

The catalogue itself lives in `GeoID_GIS/viewer/gis/global-data.js`. Datasets
under a licence of their own are **not** copied here: they are fetched live from
their canonical source when asked for, and the catalogue shows the credit. Those
are listed at the end.

## What is in this folder

| file | features | vertices | source |
| --- | --- | --- | --- |
| `coastline_10m.geojson` | 4,133 | 410,957 | Natural Earth 1:10m `ne_10m_coastline` |
| `rivers_10m.geojson` | 4,224 | 260,393 | Natural Earth 1:10m `ne_10m_rivers_lake_centerlines_scale_rank` |
| `lakes_10m.geojson` | 1,355 | 162,391 | Natural Earth 1:10m `ne_10m_lakes` |
| `boundaries_10m.geojson` | 515 | 77,288 | Natural Earth 1:10m `ne_10m_admin_0_boundary_lines_land` |
| `countries_50m.geojson` | 242 | 99,613 | Natural Earth 1:50m `ne_50m_admin_0_countries` |
| `graticule_lines.geojson` | 6 | 2,630 | Natural Earth 1:10m `ne_10m_geographic_lines` |

**Natural Earth is public domain** ("no permission needed", naturalearthdata.com/about/terms-of-use).
Crediting it is courtesy rather than a condition, and the catalogue does.

Two choices worth stating, because both look like mistakes otherwise:

- **The rivers are the `scale_rank` variant**, which carries the smaller rivers
  the plain file drops — 4,224 lines against 1,455. On a globe you can fly to
  the ground, the plain file is a sketch.
- **Countries are 1:50m while everything else is 1:10m.** The 1:10m polygons are
  12.5 MB and say the same thing as the 1:10m coastline for anything you would
  look at; this file is for clipping and for naming which country a point is in,
  and 1:50m does that at 2.3 MB. The *borders* are 1:10m, because a border is a
  line you look at.

## Rebuilding

Requires `ogr2ogr` (GDAL). Each source is a zipped shapefile, read straight out
of the zip with GDAL's `/vsizip/`, so nothing has to be unpacked:

```bash
for f in physical/ne_10m_coastline \
         physical/ne_10m_rivers_lake_centerlines_scale_rank \
         physical/ne_10m_lakes \
         physical/ne_10m_geographic_lines \
         cultural/ne_10m_admin_0_boundary_lines_land; do
  curl -O "https://naciscdn.org/naturalearth/10m/$f.zip"
done
curl -O "https://naciscdn.org/naturalearth/50m/cultural/ne_50m_admin_0_countries.zip"

ogr2ogr -f GeoJSON -lco RFC7946=YES -lco COORDINATE_PRECISION=4 \
  coastline_10m.geojson /vsizip/./ne_10m_coastline.zip \
  -sql "SELECT featurecla AS kind, scalerank FROM ne_10m_coastline"

ogr2ogr -f GeoJSON -lco RFC7946=YES -lco COORDINATE_PRECISION=4 \
  rivers_10m.geojson /vsizip/./ne_10m_rivers_lake_centerlines_scale_rank.zip \
  -sql "SELECT featurecla AS kind, name, scalerank, strokeweig AS width_rank \
        FROM ne_10m_rivers_lake_centerlines_scale_rank"

ogr2ogr -f GeoJSON -lco RFC7946=YES -lco COORDINATE_PRECISION=4 \
  lakes_10m.geojson /vsizip/./ne_10m_lakes.zip \
  -sql "SELECT featurecla AS kind, name, scalerank, admin FROM ne_10m_lakes"

ogr2ogr -f GeoJSON -lco RFC7946=YES -lco COORDINATE_PRECISION=4 \
  boundaries_10m.geojson /vsizip/./ne_10m_admin_0_boundary_lines_land.zip \
  -sql "SELECT featurecla AS kind, name, adm0_left AS side_a, adm0_right AS side_b \
        FROM ne_10m_admin_0_boundary_lines_land"

ogr2ogr -f GeoJSON -lco RFC7946=YES -lco COORDINATE_PRECISION=4 \
  countries_50m.geojson /vsizip/./ne_50m_admin_0_countries.zip \
  -sql "SELECT NAME AS name, ADMIN AS admin, ISO_A3 AS iso_a3, CONTINENT AS continent, \
        POP_EST AS pop_est FROM ne_50m_admin_0_countries"

ogr2ogr -f GeoJSON -lco RFC7946=YES -lco COORDINATE_PRECISION=4 \
  graticule_lines.geojson /vsizip/./ne_10m_geographic_lines.zip \
  -sql "SELECT name, featurecla AS kind FROM ne_10m_geographic_lines"
```

**The `-sql` is not tidying.** Natural Earth ships 40 name translations and 150
administrative code columns; keeping them triples the download for fields no
panel in this app reads. **`COORDINATE_PRECISION=4`** is 11 m at the equator —
below the precision of a 1:10,000,000 source, so nothing is lost and the files
are about a third smaller than GDAL's default seven decimals.

## Fetched live, not copied here

| dataset | source | licence |
| --- | --- | --- |
| Plate boundaries (PB2002) | `raw.githubusercontent.com/fraxen/tectonicplates` | Bird (2003) — cite the paper; the redistributing repository states no licence of its own |
| Active faults | `raw.githubusercontent.com/GEMScienceTools/gem-global-active-faults` | CC BY-SA 4.0 |
| Geologic map units | `macrostrat.org/api/v2` | CC BY 4.0, plus the credit each source map carries |

All three answer with `Access-Control-Allow-Origin: *`, which is what makes
fetching them from a page work at all. Fetching rather than copying also keeps
them current: an active-fault compilation is edited, and a copy taken today is
a copy of today.

## Baked from a service

| dataset | file | source | licence |
| --- | --- | --- | --- |
| Volcanoes of the World | `volcanoes.geojson` | Smithsonian GVP WFS | Smithsonian Institution — free for non-commercial use with citation |

```bash
python3 GeoID_GIS/services/bake-volcanoes.py
```

2,666 records — 1,214 Holocene and 1,452 Pleistocene — from
`webservices.volcano.si.edu`, in one file with an `epoch` field telling them
apart. Baked rather than fetched live because the catalogue is revised on an
editorial cycle rather than by the minute, so a copy is a copy of the
catalogue and not a stale frame of a stream; and because a baked file works
offline and cannot be taken out by a CORS header going missing on a cache hit.

**Three fields are ours, not GVP's**, and the script says so in `_source`:

- `activity` is a RECENCY BAND derived from `Last_Eruption_Year` — "Erupted
  since 1980", "Historical (since 1500)", "Holocene, undated". It is not
  active/dormant/extinct: GVP declines to publish those terms because they
  have no agreed definition and "extinct" has been wrong often enough to be
  dangerous. 366 Holocene volcanoes have no dated eruption at all, which is a
  fact about the record rather than about the volcano.
- `type_group` collapses 28 primary types to 9, because `categoricalSymbology`
  folds everything past twelve classes into one grey "other" that would
  swallow half the map. The raw `Primary_Volcano_Type` is kept beside it.
- `summary` is clipped to about 460 characters on a sentence boundary. The
  full text runs to 1,776 and was 39% of the file; `gvp_url` links each record
  to its own page on volcano.si.edu, which is the citable version.

## `ice/` and `ice-sheets.geojson` — the world's glaciers

    python3 GeoID_GIS/services/bake-glaciers.py          # ~400 MB down, ~15 min
    python3 GeoID_GIS/services/bake-glaciers.py --check   # what is on disk

**`ice/`** is a Mapbox Vector Tile pyramid, z0–6, **806 tiles, 82 MB** —
**192,869 glacier complexes over 706,744 km²**, which is the Randolph Glacier
Inventory 7.0's own global total to a fraction of a percent. One layer inside
each tile, named `ice`. Streamed by the Ice cover subtab through the same
controller the geology uses, so it refines as you fly in.

**Each level carries only what can be seen at it**, which is what makes the
world backdrop 1.4 MB rather than 5 MB of polygons quantised to kilometres:

| levels | smallest complex | complexes | share of the world's glacier area |
| --- | --- | --- | --- |
| z0–2 | 200 km² | 323 | 75.7% |
| z3–4 | 20 km² | 1,638 | 86.4% |
| z5 | 5 km² | 4,978 | 90.9% |
| z6 | everything | 192,869 | 100% |

The deepest level is baked at `EXTENT=8192` rather than the conventional 4096,
which halves the grid a vertex is placed on (about 32 m at 65°N) for 17 MB —
`mvt.js` reads each layer's own extent. `manifest.json` carries a `version`
fingerprint that the client appends to every tile request, because a tile is an
ordinary file at an ordinary URL and a browser that has one keeps it.

- **RGI 7.0, complexes (`C`) not glaciers (`G`).** `G` splits an ice mass into
  flow units by ice divide (274,000 of them); `C` keeps a contiguous ice mass
  whole, which is what a map of "where is there ice" wants.
- **RGI Consortium (2023), NSIDC, doi:10.5067/f6jmovy5navz, CC BY 4.0.** NSIDC
  serves it behind an Earthdata login that a bake script cannot answer, so the
  files come from the RGI working mirror at the University of Bremen — the same
  files; the DOI is the citation.
- **Web Mercator XYZ**, which is what `mvt.js` computes tile bounds on. Baked on
  EPSG:4326 the first time, on the strength of a note in `GeoID_GIS/CLAUDE.md`
  that was wrong: every tile decoded, every polygon was valid, and Iceland
  landed in the Laptev Sea.
- Zoom 6 places a vertex to about 150 m at the equator and 65 m at 65°N, where
  most of this ice is. Zoom 7 would halve that and cost 163 MB against a
  tracked site of 582 MB and a GitHub Pages ceiling of 1 GB; where the source's
  own 15–30 m outline is wanted, the GLIMS row fetches it live.

**`ice-sheets.geojson`** is the rest of the world's ice from Natural Earth 10m
(public domain), **161 polygons, 1.3 MB**: the two grounded ice sheets — taken
by their own names rather than by a bounding box — and the 156 floating ice
shelves around Antarctica.

|  | area |
| --- | --- |
| Antarctic Ice Sheet (grounded) | 12,059,468 km² |
| Greenland Ice Sheet | 1,746,539 km² |
| Antarctic ice shelves | 1,555,136 km² |

Two reasons it is a file and not tiles: **RGI does not map any of this** — it
maps the glaciers and ice caps around them, and this is about 96% of the ice on
Earth — and **Web Mercator stops at 85.05°**, so tiled, Antarctica would be a
ring of ice around a hole at the pole. This file reaches 90°S.

`kind` separates **grounded** from **floating**, and the catalogue row colours
them apart: a shelf is the sheet's outflow afloat on the sea, already displacing
its own weight of water, which is why a shelf collapse and an ice-sheet loss
mean different things for sea level.

Two GDAL options are deliberately NOT used on this pair, both settled by
measurement: `-simplify` on the thin shelves turned one polygon into a
LineString and two into features with no geometry at all, and `RFC7946=YES`
re-split antimeridian geometry Natural Earth had already split, emptying half
of the Ross Ice Shelf — while changing nothing whatever on the ice sheets.

**`ice/names.json`** is what the complexes are CALLED — 38,016 of 192,869
(19.7%), 1.25 MB, written by `services/name-glaciers.py`. RGI's complexes have
no name column, so the names come from RGI's own glacier names where a complex
IS a glacier (37,219), and from GeoNames' ice caps and single glaciers where it
is not (797). Each entry carries its source, because "this complex is that
named glacier" and "a gazetteer point falls inside it" are different claims and
the card says which. Not baked into the tiles: a correction would otherwise
mean re-baking 82 MB.

**`ice/thickness.json`** is how much ice is in each complex — 192,869 rows,
5.5 MB, `[volume km³, uncertainty km³, volume below sea level km³]`, written by
`services/bake-ice-thickness.py` from **IceBoost v2.0** (Maffezzoli 2026,
CC BY 4.0, doi:10.5281/zenodo.21220985), which is published per RGI 7.0 complex
— the same key the tiles carry, so the join is by identity. Totals as a check
on that join: 149,318 km³ of ice (Farinotti's consensus: ~158,000) and 343 mm
of sea-level equivalent (published: ~324 mm).

**GLIMS is the third door and ships nothing.** `www.glims.org/geoserver` answers
WFS with `Access-Control-Allow-Origin: *`, so the archive RGI is curated from is
fetched live over a drawn study area (`glims-outlines` in `research/
connectors.js`). It is MULTI-TEMPORAL — measured over Iceland, 675 outlines for
608 glaciers, one of them mapped six times — so the connector keeps one outline
per `glac_id`, the latest `src_date`, and only `line_type = glac_bound`.
