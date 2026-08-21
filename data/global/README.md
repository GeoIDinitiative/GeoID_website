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
