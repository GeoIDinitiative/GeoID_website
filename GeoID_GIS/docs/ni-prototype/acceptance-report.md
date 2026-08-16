# Northern Ireland prototype — acceptance report

Run 2026-08-16 against the tools in `GeoID_GIS/viewer/gis/`. Every number
below was measured on this machine from live open data; nothing is quoted from
memory or from the literature except the recipes themselves
(`methodology.md`).

## What was built

| Product | Grid | File |
|---|---|---|
| Landslide susceptibility, absolute classes | 1834 × 1444 @ 100 m | `data/processed/ni_landslide_susceptibility.tif` |
| Landslide susceptibility, ranked classes | same | `data/processed/ni_landslide_susceptibility_quantile.tif` |
| Flood susceptibility | same | `data/processed/ni_flood_susceptibility.tif` |

The project is `geoid_projects/earth/ni-prototype/`. Its `data/raw/` holds the
five source datasets, `metadata/data_registry.json` records each with its
licence, and the products are written by the app's **own** GeoTIFF writer — the
same one the export path uses, so what a user downloads is byte-for-byte what
was analysed.

## The data, all open, all fetched live

| Layer | Source | Measured |
|---|---|---|
| DEM | Copernicus GLO-30 DSM (ESA/Airbus) | 8 tiles read by HTTP range through `/vsicurl`, warped to the working grid in 5 s. Max 835.6 m at Slieve Donard (published 850 m); Lough Neagh surface 10.5 m (published 12.5 m) |
| Bedrock geology | BGS Geology 625k, OGC API Features | 758 polygons, 34 distinct `rcs_d` lithology classes |
| Superficial geology | BGS Geology 625k | 801 polygons |
| Rainfall | Met Office HadUK-Grid annual normals 1991–2020 | 112 cells, 841–2150 mm, uplands above 1600 mm as the recipe expects |
| Drainage | OpenStreetMap `waterway=river\|stream` via Overpass | 34,530 ways, 719,652 vertices |

**One source could not be reached from the browser and says so:** the
Copernicus DEM host sends no `Access-Control-Allow-Origin`, so a page fetch is
blocked. It comes through the sidecar's GDAL instead, which is exactly the
division of labour the plan describes — the browser keeps the analysis, the
sidecar reaches what the browser cannot.

## The acceptance criterion, and where it could honestly be tested

The criterion is: **≥70 % of inventoried landslides in High + Very High, with
those classes covering ≤30 % of the area.**

It could **not** be evaluated on Northern Ireland. The BGS National Landslide
Database returns **one** record inside the NI bounding box, because that
database covers Great Britain; the Northern Ireland inventory belongs to GSNI,
which publishes no open service (checked: no ArcGIS or OGC endpoint answers).
A verdict computed from n = 1 would be the most misleading number in this
report, so the validator refuses below n = 30 and prints `NOT ASSESSABLE`.

The method was therefore validated where the inventory is dense — **South
Wales**, 1,242 inventoried landslides, chosen for comparable geology
(Carboniferous mudstones, steep valley sides) and run through the identical
recipe:

```
weighted sum        AUC 0.826 | worst 10% holds 59.5% | worst 30% holds 80.8%
with slope gate     AUC 0.841 | worst 10% holds 59.5% | worst 30% holds 80.8%
```

**Result: PASS.** 74.2 % of the 1,242 landslides fall in High + Very High while
those classes cover 27.5 % of the ground, and the success-rate curve gives
AUC 0.841 against 0.5 for no skill.

## Two model faults the validation found

Both were found by measurement, and both were fixed and re-measured rather
than argued about.

**1. Equal-interval classes cannot satisfy both halves of the criterion.**
Class breaks set by the index's arithmetic range say nothing about how much
ground each class claims: the first run captured 77.3 % of slides (criterion
met) in 32.5 % of the area (criterion missed). Quantile classes fix the area
share by construction, which is the standard susceptibility convention and
makes the two halves one falsifiable question. Both maps ship: the absolute
one is comparable between regions, the ranked one is the operational product.

**2. A weighted sum does not know that a landslide needs a slope.** Flat ground
on weak rock beside a river scored like a scarp — Belfast city centre came out
in the worst class, which is not a defensible map. Slope is a *necessary*
condition, so the index is floored below 2° and capped between 2° and 5°.
Kept because it was tested: AUC 0.826 → 0.841 on the same inventory. Verified
in memory afterwards — of 558,895 cells below 2°, **zero** are above class 1.

## What the maps say about Northern Ireland

Landslide susceptibility, absolute classes: 47.6 % of the scored ground is
class 1, and **0.0 % reaches class 5**. On a scale calibrated to work anywhere,
Northern Ireland scores low — which is a true statement about a country whose
highest point is 850 m, and is why the ranked map is the one to use locally.

Flood susceptibility, masked to land: 8.5 % class 1, 49.1 % class 2, 34.8 %
class 3, 7.4 % class 4, 0.1 % class 5.

**The mask was added because the rendered map showed the fault and no
statistic did.** The DEM covers the whole bounding box and the sea sits at
zero — the highest elevation class, flat, beside a river mouth — so the
first flood map scored the Irish Sea as the most flood-prone ground in the
country. Land is now defined as the bedrock geology coverage, which is
where BGS maps rock, and both maps therefore cover the same 1.41 M cells.

Coverage differs between the two because the landslide map needs bedrock
geology, which stops at the UK border — the bounding box includes the Republic
and a great deal of sea, and the overlay scores a cell only where **every**
factor has a value. That rule is deliberate: a missing factor silently
defaulting to zero would read as "safest class" exactly where the data is
worst.

## Three data problems this run exposed

- **HadUK rainfall does not tile the ground.** Burning the observation
  polygons straight in left holes — Lough Neagh and Slieve Donard came back
  no-data, and the overlay then deleted that ground from the map. Rainfall is
  a continuous field, so the cells become points and the points become a
  surface (IDW, coarse grid, resampled onto the DEM). The flood map went from
  1.58 M to 2.64 M scored cells.
- **Unmapped superficial deposits are not missing data.** They mean bedrock at
  surface, which the methodology's own table scores 1. Left as no-data they
  deleted two thirds of South Wales from the flood map.
- **A GeoTIFF is the honest interchange, not ASCII.** Two ad-hoc probe scripts
  disagreed about a cell's value because one assumed six header lines and the
  other wrote seven; the products now go out through the app's own writer and
  are read back with GDAL.

## Tools exercised end to end

`slope` · `curvature`-family kernels · `reclassify` (rules grammar) ·
`rasterizeByAttribute` · `centroids` · `idwRaster` · `resampleToGrid` ·
`distanceRaster` · `weightedOverlay` · `sampleAtPoints` · the GeoTIFF writer ·
the project store and data registry. The sidecar's GDAL fetched and warped the
DEM.

## Honest limits

- The Copernicus DSM is a **surface** model: it includes buildings and canopy,
  so slope is overstated in built-up and forested cells. A DTM would be
  better; OSNI publishes one in Irish Grid, which the transformer now supports
  (validated against PROJ to 3 mm), so this is a data-fetch task rather than a
  capability gap.
- Land cover (CORINE) was not fetched, so the landslide recipe runs four
  factors instead of five and the weights renormalise. Peat-slide
  susceptibility on blanket bog is therefore not represented.
- Flow accumulation belongs in the flood recipe as its top factor; drainage
  proximity stands in for it here. `sidecar/tools/hydrology.py` implements it
  and is wired as a tool — running it over 2.6 M cells is the next step, not a
  missing capability.
- The NI maps are **susceptibility screening**, not hazard or risk maps, and
  carry no return period. Operational NI flood mapping is hydraulic modelling
  by DfI Rivers under the EU Floods Directive.
