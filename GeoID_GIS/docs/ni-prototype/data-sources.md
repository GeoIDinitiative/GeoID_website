# NI Open Data Access — verified sources (all endpoints fetched live, 2026-08-15)

## Summary table

| # | Need | Source (verified) | Endpoint | Auth | CORS (tested w/ Origin) | NI payload | Integration path |
|---|------|-------------------|----------|------|--------------------------|------------|------------------|
| 1a | Bedrock + superficial vectors, 250k (best detail) | **GSNI 250K Geology, OpenDataNI** | CKAN downloads (URLs below) | none | **Broken for `fetch()`** — 302 has `ACAO:*` but final R2 response has **no CORS headers** | bedrock 11.4 MB, superficial 13.1 MB, faults/lines 1.0 MB (GeoJSON, CRS84) | **One-off download filed into project** (or sidecar/Cloud Run proxy) |
| 1b | Bedrock + superficial vectors, 625k (browser-live) | **BGS OGC API – Features** | `https://ogcapi.bgs.ac.uk/collections/bgsgeology625kbedrock/items` and `...625ksuperficial/items` | none | **Works** — echoes Origin | bedrock 758 feats / 6.0 MB; superficial 801 feats / 7.7 MB (one page at `limit=1000`) | **Direct browser GeoJSON import** (the "WFS-to-GeoJSON" role) |
| 1c | Geology as image tiles incl. 10k | **GSNI Geology WMS** | `https://map.bgs.ac.uk/arcgis/services/GeoIndex_GSNI/GSNI_Geology_Landsat_WMS/MapServer/WMSServer` | none | **Works** — echoes Origin (+credentials) → `crossOrigin="anonymous"` canvas-safe | GetMap PNG ~100 KB/tile | WMS tiles |
| 2 | Hydrogeology | **GSNI Hydrogeology WMS** | `https://map.bgs.ac.uk/arcgis/services/GeoIndex_GSNI/GSNI_Hydrogeology/MapServer/WMSServer` | none | **Works** (same server as 1c; GetMap tested: 200, 104 KB PNG over NI) | PNG tiles; no vector export | **WMS tiles + GetFeatureInfo** (view-only licence) |
| 3 | DEM 10 m | **OSNI Open Data 10m DTM, OpenDataNI** | 6 zips, sheets 1–293 | none | Same R2 problem as 1a | ~164 MB/zip, ~1 GB all-NI; **XYZ ASCII, Irish Grid, 10 m** | **One-off download** → existing XYZ adapter |
| 4a | Rainfall grid (open, CORS) | **Met Office Climate Data Portal (HadUK-Grid 12 km)** | `https://services.arcgis.com/Lq3V5RFuTBC9I7kv/arcgis/rest/services/Annual_Precipitation_Observations_1991_2020/FeatureServer/0/query` | none | **Works** — `ACAO:*` | 112 cells over NI, `f=geojson` | Direct browser GeoJSON import |
| 4b | Rainfall timeseries (open, CORS) | **Open-Meteo archive API** (ERA5) | `https://archive-api.open-meteo.com/v1/archive` | none | **Works** — `ACAO:*` | ~KB per point/query | Live point queries |
| 4c | Cached CHIRPS route | shipped GEE cache | — | — | — | **ZERO** — see gotchas | **Do not use for NI** |

## Per-source notes

### 1a. GSNI 250K Geology (OpenDataNI) — the primary geology source
- Dataset: `https://www.opendatani.gov.uk/dataset/gsni-250k-geology`. Direct GeoJSON (verified by download, CRS84 lon/lat, attributes `LEX`, `LEX_D`, `LEX_RCS`):
  - Bedrock polygons (11,365,042 B): `https://admin.opendatani.gov.uk/dataset/7c00c1f5-6cd3-405d-b79e-61c19c4990b9/resource/d85d4090-77b1-4807-a551-b2849aeb2eaf/download/ni250kbedrockgeologypolygons.geojson`
  - Superficial polygons (13,085,812 B): `.../resource/19b4e12e-0e00-4091-8419-0c744d72cb96/download/ni250ksuperficialgeologypolygons.geojson`
  - Bedrock lines/faults (990,454 B): `.../resource/a1ea4f61-bfff-4ef1-98f7-84552f7c1911/download/ni250kbedrockgeologylines.geojson`
  - GeoPackage + zipped shapefile + QGIS/ArcGIS style files also on the page.
- Licence: UK Open Government Licence. GSNI's stated request (from its own metadata record): *"acknowledge that the resource contains Geological Survey of Northern Ireland materials provided under the Open Government Licence"* — practical line: **"Contains Geological Survey of Northern Ireland materials © Crown copyright, licensed under the Open Government Licence v3.0."**
- CORS reality (measured): CKAN answers `302` **with** `Access-Control-Allow-Origin: *`, redirecting to a presigned `*.eu.r2.cloudflarestorage.com` URL whose `200` has **no ACAO header at all** (and it 403s HEAD). Browser `fetch()` therefore fails at the redirect hop; `<a href>` download and curl both work.

### 1b. BGS OGC API — 625k covers NI (verified, contrary to the usual GB-only caveat)
- `https://ogcapi.bgs.ac.uk/collections?f=json`; relevant collections: `bgsgeology625kbedrock`, `bgsgeology625ksuperficial`, `bgsgeology625kdykes`, `bgsgeology625kfaults`.
- NI bbox probe `?bbox=-8.2,54.0,-5.4,55.4&limit=1000&f=json` returned genuinely Northern Irish units (HIBERNIAN GREENSANDS / ULSTER WHITE LIMESTONE, SHERWOOD SANDSTONE, TILL) — 758 bedrock / 801 superficial features, complete in a single page. GeoJSON in CRS84.
- CORS verified: response carried `Access-Control-Allow-Origin: https://example.github.io` (origin echo). This is the one geology source the static site can pull live with no proxy.
- Licence OGL; exact BGS attribution (from bgs.ac.uk): **"Contains British Geological Survey materials © UKRI [year]"**.
- Trade-off vs 1a: 625k generalisation vs 250k; use 1b for live/browser, 1a as the filed project asset.

### 1c/2. GSNI GeoIndex WMS (map.bgs.ac.uk) — geology tiles incl. 10k, and the only hydrogeology source
- Geology service layers (capabilities verified): `5` Bedrock 250k, `6` Superficial 250k, `7` Structural 250k, `9` Bedrock **10k**, `10` Superficial **10k**, `11` Artificial Ground 10k, `12` **Mass Movement 10k** (directly useful for the landslide prototype), `4` Bedrock Ireland 500k.
- Hydrogeology service layers: `0` Groundwater vulnerability screening, `1` Superficials aquifer, `2` Bedrock aquifer, `3` Karst tracer lines, `4` Karst features, `5` Groundwater Data Repository, `6` Hydrogeology Reports. GetMap + GetFeatureInfo; **no WFS** — this data is view-only.
- CRS: `CRS:84`, `EPSG:4326`, `EPSG:29902`, `EPSG:29900`. Formats: PNG/JPEG/TIFF. Verified GetMap: `...&crs=CRS:84&bbox=-8.2,54.0,-5.4,55.4&width=600&height=300&format=image/png` → 200, 104 KB.
- Licence: *"Available to view under the Open Government Licence"* — same GSNI attribution as 1a. BGS's GB 625k hydrogeology was **not** found in the OGC API and its NI coverage is unverified; use GSNI.

### 3. OSNI Open Data 10m DTM
- Six datasets, e.g. sheets 1–50: `https://admin.opendatani.gov.uk/dataset/bea57cd0-c9aa-45cd-b048-3b6d60b04fbe/resource/2974c9cb-0027-4ee4-9095-02c50b6b73a7/download/osni_10m_dtm_sheets_1-50.zip` (172,289,465 B; others named `osni-open-data-10m-dtm-sheets-51-100` … `-251-293` on opendatani.gov.uk).
- Contents verified by ranged read: `SheetNNNv4.txt`, plain **XYZ ASCII** (`E N Z`, 10 m spacing, metres, **Irish Grid** — sample first line `293465.0 444005.0 1.6954`). The app's XYZ point-cloud adapter reads this as-is; the projection module needs Irish Grid (EPSG:29903/29902) inverse, or preconvert once with GDAL via the sidecar.
- Licence OGL; attribution: **"Contains Ordnance Survey of Northern Ireland data © Crown copyright and database right"** (OGL v3). Same no-CORS R2 redirect → one-off download filed into the project; pull only the sheets covering the study catchment (~3–4 MB compressed each).

### 4. Rainfall — the honest picture
- **The cached CHIRPS route supports NI not at all.** CHIRPS covers 50°S–50°N; sampled the shipped `assets/gee-cache/UCSB-CHG_CHIRPS_DAILY.png` at Belfast/Omagh: fully transparent `(0,0,0,0)` (Congo/Nigeria return palette values). Any NI rainfall claim from that layer would be fabricated by the palette-inverter's distance guard refusing — correctly — to read it. Don't route NI rainfall through it, and don't touch the billed GEE function.
- **Met Office Climate Data Portal (verified working replacement):** `Annual_Precipitation_Observations_1991_2020/FeatureServer/0/query?...&geometry=-8.2,54.0,-5.4,55.4&inSR=4326&f=geojson` → 112 12-km HadUK-Grid cells over NI, field `pr` (mm/yr, e.g. 862.7), `ACAO:*`. A Monthly variant exists on the same org (`services.arcgis.com/Lq3V5RFuTBC9I7kv`, owner `MetOffice_data`). Licence: OGL per the portal (service `copyrightText` is empty — state **"Contains Met Office data licensed under the Open Government Licence v3.0; HadUK-Grid © Crown copyright"**). This is climatology (1991–2020 normals), not live rain — right for susceptibility/flood-risk weighting.
- **Open-Meteo archive API (verified):** daily `precipitation_sum` for any NI point back to 1940 (ERA5), no key, `ACAO:*`; free for non-commercial, attribution "Weather data by Open-Meteo.com" (CC BY 4.0). Good for time-series panels; ~9 km reanalysis, not gauge-quality.
- **HadUK-Grid 1km NetCDF** (CEDA) is OGL but sits behind CEDA registration/auth with no CORS — only worth a sidecar one-off if 1 km grids become necessary.

## Gotchas
1. **OpenDataNI downloads are un-fetchable from a browser page** despite the portal advertising `ACAO:*`: the CORS header dies at the R2 presigned redirect (no ACAO on the final 200, HEAD 403s). File them into the project once, or fetch via the sidecar / existing Cloud Run proxy. Presigned URLs expire (7 days) — never hardcode the `Location`.
2. **BGS 625k *does* include NI** (this project's earlier assumption to the contrary is wrong at 625k) — but BGS's detailed 50k product and GB hydrogeology remain GB-only/unverified for NI; GSNI is the NI authority for anything finer.
3. **WMS 1.3.0 axis order:** on these ArcGIS servers `EPSG:4326` means lat,lon order. Use `CRS:84` (lon,lat) and skip the whole class of bug.
4. **GSNI hydrogeology is view-only**: tiles + GetFeatureInfo, no feature download. Pixel-classifying the aquifer PNG into "data" would repeat the CHIRPS-palette trap *without* a published legend ramp — keep it as a visual layer and per-click queries.
5. **The two geology sources disagree by design** (250k vs 625k generalisation); pick one per analysis, don't mix boundaries.
6. **DTM sheets are Irish Grid, not UTM** — the current projection module (UTM/LAEA) can't inverse them yet; either add EPSG:29903 or preconvert via sidecar GDAL before import.
7. Met Office ArcGIS layers are **normals**, not observations of a given storm; for event rainfall the only free live option verified with CORS is Open-Meteo (reanalysis/forecast, non-commercial terms).