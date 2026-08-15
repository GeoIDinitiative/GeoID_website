# Acceptance-Test Analyses for GeoID GIS — Northern Ireland Prototype

Design of the two acceptance tests named in the phase plan (`/home/owen/.claude/plans/dapper-questing-quokka.md`, "Requirements added by the user after approval"), expressed strictly in terms of the tools that exist in `GeoID_GIS/viewer/gis/` today (`toolbox-ops.js`, `raster-analysis.js`, `geoprocessing.js`, `extraction.js`) plus the plan's Phase 3/4 commitments. Every step names the tool as the UI exposes it; every step with no tool is a numbered entry in the gap table.

---

## 1. Methodology summary

Both maps are **multi-criteria weighted overlays** (weighted linear combination, WLC): each causal factor is gridded, reclassified to a common 1–5 ordinal scale, multiplied by an expert weight (AHP-derived), summed, and classified into five susceptibility classes. This is the standard screening-level method when an event inventory is too sparse for statistical models, and it is exactly the workload the plan's acceptance test is meant to exercise (reclassify → rasterize → overlay → classify → validate).

**Landslide susceptibility (A).** Heuristic/index WLC per van Westen et al. (2006) and the factor canon reviewed in Reichenbach et al. (2018); AHP weighting per Saaty (1980); factor set (slope, lithology, rainfall, land cover, drainage proximity) is the recurring core of GIS susceptibility studies (e.g. Ayalew & Yamagishi 2005). NI specifics: the recorded inventory (GSNI landslide database) clusters on the Antrim Plateau scarps, where Palaeogene basalts overlie Lias mudstones — the classic weak-horizon geometry — plus peat slides on blanket bog in the Sperrins/Antrim uplands.

**Flood susceptibility (B).** Index-based AHP flood mapping per Kazakis et al. (2015) (the FIGUSED-style flood hazard index), with the ensemble-method factor canon of Tehrany et al. (2014): elevation, slope, flow accumulation, rainfall, permeability of superficial deposits. Honest scope note: operational NI flood mapping (DfI Rivers, EU Floods Directive 2007/60/EC second-cycle NIFRA) is hydraulic modelling; this WLC is a *susceptibility screening* map and must be labelled as such in the output legend. Elevation-above-nearest-drainage (HAND, Nobre et al. 2011) is the natural upgrade once the Phase 4 hydrology stack exists.

**Citations**
- van Westen, van Asch & Soeters (2006), *Bull. Eng. Geol. Environ.* 65:167–184.
- Reichenbach, Rossi, Malamud, Mihir & Guzzetti (2018), *Earth-Sci. Rev.* 180:60–91.
- Saaty (1980), *The Analytic Hierarchy Process*.
- Ayalew & Yamagishi (2005), *Geomorphology* 65:15–31.
- Kazakis, Kougias & Patsialis (2015), *Sci. Total Environ.* 538:555–563.
- Tehrany, Pradhan & Jebur (2014), *J. Hydrol.* 512:332–343.
- Nobre et al. (2011), *J. Hydrol.* 404:13–29 (HAND; stretch goal).
- Operational context: EU Floods Directive 2007/60/EC; DfI NI Flood Risk Assessment; GSNI landslide database; BGS GeoSure.

### Scale and DEM assumptions (both recipes)

- **AOI**: NI bbox lon −8.20…−5.35, lat 54.02…55.32 (~185 × 145 km).
- **Working grid**: 100 m, EPSG:4326 → ~1,850 × 1,450 = **2.7 M cells**, ~10.7 MB Float32 per layer. Comfortably in-browser for `slope()`'s O(n) pass and the calculator chain; zonal stats over ~10² polygons with bbox prefilter is fine.
- **DEM source**: OSNI Open Data 50 m DTM (OGL) or Copernicus GLO-30, pre-clipped/resampled to the working grid. Slope from Horn's 3×3 (`raster-analysis.js:slope`, same estimator as QGIS/ArcGIS) is only meaningful at ≤100 m cells — at 1 km, 30° scarps attenuate to single digits and Recipe A is void. **This is why Gap G1 is ranked first: today's GeoTIFF import path downsamples to a 192-cell grid (~1 km over NI), which caps the entire prototype below usefulness.**
- **Rainfall**: HadUK-Grid 1 km annual average (1991–2020), GeoTIFF, OGL. The GEE CHIRPS drape + palette inversion works today (±1.18 mm verified) but the cached snapshot is a global 1024 px image (~39 km/px delivered) — ~5 px across NI. Usable for the Variant-0 smoke test only.
- **Geology**: GSNI 1:250k bedrock + superficial (open, OGL) — arrives in Irish Grid (EPSG:29902/29903) or ITM (2157); the browser transformer is WGS84-UTM/LAEA only, so reprojection is external until Phase 3 (Gap G7).
- **Land cover**: CORINE 2018 100 m raster (or UKCEH LCM).
- **Drainage**: OSM waterways via the existing Overpass connector (`waterway=river|stream` in the AOI bbox).

---

## 2. Recipe A — Landslide susceptibility map

### A.0 Variant 0 — runnable today, wired tools only (point-lattice MCDA)

A degraded but *complete* chain that exercises "every output is every input" with zero new code. Resolution is the lattice spacing; output is a scored point layer, not a raster.

1. **Draw tool** → NI study area box.
2. **Extraction panel** (`extraction.js:extractPolygonSamples`), step 1 km, include built-in elevation + slope (+ CHIRPS drape column if loaded) → ~26 k rows (under the 250 k cap) → export GeoJSON points, re-import.
3. Import GSNI bedrock (externally reprojected to WGS84). **Spatial join** (points ← lithology polygons) → each point gains `join_UNIT_NAME` etc.
4. **Buffer** the Overpass rivers layer at 250 m (merged, as the UI does); **Spatial join** points ← buffer → crude in/out drainage-proximity flag. (Repeat at 100/500 m for a 3-step factor if wanted.)
5. **Field calculator** on the point layer — one expression with nested ternaries computes all five factor scores and the weighted sum, e.g.
   `0.35*(geoid_slope_deg<5?1:geoid_slope_deg<12?2:geoid_slope_deg<20?3:geoid_slope_deg<30?4:5) + 0.25*(litho_score) + …`
6. Style/inspect; **export CSV/GeoJSON**.

Limits to state honestly: built-in geology is the coarse global layer unless GSNI is joined; rainfall is the 39 km/px CHIRPS read; no true distance factor. This variant is the smoke test, not the acceptance test.

### A.1 Full recipe (target state; gap IDs mark missing steps)

**Step 1 — Ingest.** Import DEM GeoTIFF at the 100 m working grid (**G1**: import currently downsamples to 192 cells). Import GSNI bedrock shapefile (**G7**: Irish Grid → WGS84 needs external `ogr2ogr` until Phase 3 `/jobs/gdal`). Import HadUK rainfall GeoTIFF, CORINE GeoTIFF. Pull rivers via Overpass connector.

**Step 2 — Slope.** Raster ops → **Slope (degrees)** on the DEM → `slope_dem`.

**Step 3 — Reclassify slope** to 1–5. Engine call: `reclassify(slope_dem, [[0,5,1],[5,12,2],[12,20,3],[20,30,4],[30,90,5]])`. The engine takes N rules; the wired UI ("Reclassify (above/below)") offers only one threshold → **G4** (multi-rule reclassify UI).

| Slope | Score | Rationale (NI) |
|---|---|---|
| 0–5° | 1 | drumlin lowlands, interfluves |
| 5–12° | 2 | till slopes, rare shallow failures |
| 12–20° | 3 | rotational failures in glacial till begin |
| 20–30° | 4 | Antrim scarp aprons, debris slides |
| >30° | 5 | scarp faces, rock-fall/debris-slide sources |

**Step 4 — Lithology raster.** (a) **Field calculator** on GSNI layer adds `ls_score` (wired; DBF names pass the identifier filter): nested ternary on unit name. (b) Rasterize `ls_score` onto the working grid → **G2** (no vector→raster in the browser; Phase 3 names `gdal_rasterize`).

| Score | GSNI 1:250k units |
|---|---|
| 5 | Waterloo Mudstone Fm (Lias), Penarth Gp, Mercia Mudstone Gp — the weak staircase under the Antrim basalts |
| 4 | Antrim Lava Gp scarp zones + interbasaltic laterites; Carboniferous mudstones/shales (Fermanagh escarpments) |
| 3 | Southern Uplands–Longford-Down greywackes; Dalradian metasediments (Sperrins) |
| 2 | Ulster White Limestone; Sherwood Sandstone; competent sediments |
| 1 | Mourne granites; Slieve Gullion/Carlingford complexes; massive intrusives |

**Step 5 — Rainfall.** Align HadUK 1 km grid to the 100 m working grid → **G5** (no resample/align; and `rasterCalculator` zips band indices with *no grid check*, so misaligned inputs fail silently). Then reclassify (**G4**): `[[0,900,1],[900,1100,2],[1100,1300,3],[1300,1600,4],[1600,4000,5]]` (NI range ~750–2000 mm; uplands >1600).

**Step 6 — Land cover.** Align CORINE (**G5**), reclassify categorically (**G4**), first-match rules exploiting the engine's ordered scan:
`[[412,412,5],[411,411,1],[421,423,1],[511,523,1],[311,313,1],[321,324,4],[331,335,5],[231,244,3],[211,223,2],[111,142,1]]`
(peat bog 412 = 5 for peat slides; forest = 1 for root cohesion; bare/sparse = 5; heath/rough grazing = 4; pasture/mosaic = 3; arable = 2; urban/water = 1).

**Step 7 — Distance to drainage.** Euclidean distance raster from the rivers layer → **G8** (no distance tool; `gdal_proximity` is *not* in the Phase 3 allowlist). Interim: nested **Buffer** rings (50/100/250/500 m) + rasterize-per-ring once G2 lands — noting `unionAll`'s pairwise re-scan merge will crawl on the full NI river network, so the distance transform is the right owner. Reclassify: `[[0,50,5],[50,100,4],[100,250,3],[250,500,2],[500,1e9,1]]`.

**Step 8 — Weighted overlay.** Weights (AHP, slope-dominant per the literature): slope 0.35, lithology 0.25, rainfall 0.15, land cover 0.15, drainage 0.10 (Σ=1.00). `rasterCalculator` exists but is unwired (**G6a**, Phase 1 item 4) and is strictly two-input, so the sum chains pairwise:

```
t1  = calc(slope_c,  litho_c, "0.35*a + 0.25*b")
t2  = calc(t1,       rain_c,  "a + 0.15*b")
t3  = calc(t2,       lc_c,    "a + 0.15*b")
LSI = calc(t3,       dist_c,  "a + 0.10*b")
```

Four error-prone steps → **G6b**, an N-input weighted-overlay convenience tool (named in the plan's acceptance-test paragraph, unscheduled).

**Step 9 — Classify.** Reclassify LSI (equal interval on 1–5): `[[1,1.8,1],[1.8,2.6,2],[2.6,3.4,3],[3.4,4.2,4],[4.2,5,5]]` → Very Low…Very High (**G4** again).

**Step 10 — Validate.** Import GSNI landslide inventory points; sample LSI at each point → **G9** (no extract-values-to-points; workaround — per-slide buffers + **Zonal statistics** — is blocked by the buffer UI not exposing `dissolve:false`, a sub-gap of G9). Acceptance criterion: **≥70 % of inventory landslides in High+Very High, with those classes covering ≤30 % of area**; sanity via **Zonal statistics** of LSI over lithology polygons (Lias-adjacent units must rank top).

---

## 3. Recipe B — Flood susceptibility map

Variant 0 mirrors A.0 (points + spatial joins; river-corridor buffers stand in for flow accumulation; superficial geology joined like bedrock) and must be labelled *degraded — no flow accumulation*.

### Full recipe

**Step 1 — Ingest** as A.1 (DEM, HadUK, GSNI *superficial*, rivers). Same G1/G7/G5 dependencies.

**Step 2 — Elevation factor.** Reclassify DEM directly (**G4**): `[[-10,10,5],[10,30,4],[30,75,3],[75,150,2],[150,900,1]]` — <10 m captures estuarine Foyle/Lagan and the Lough Neagh fringe; the Bann/Blackwater floodplains sit in 10–30 m.

**Step 3 — Slope factor.** **Slope (degrees)** → reclassify inverted: `[[0,1,5],[1,3,4],[3,8,3],[8,15,2],[15,90,1]]` (ponding on <1°).

**Step 4 — Flow accumulation.** Pit-fill → D8 → accumulation on the DEM → **G3**. Nothing exists in the browser; Phase 4 item 5 (`sidecar/tools/hydrology.py`, pure numpy) covers it exactly. This is the map's top-weighted factor — until it lands, Recipe B cannot exceed Variant-0 quality. Reclassify in cells (100 m grid: 100 cells = 1 km² upstream): `[[0,1,1],[1,10,2],[10,100,3],[100,1000,4],[1000,1e9,5]]` i.e. breaks at 0.01/0.1/1/10 km² upstream area; ≥10 km² is the Bann/Foyle/Lagan/Blackwater main-stem class.

**Step 5 — Rainfall.** As A.1 Step 5, same table, same score direction (wetter → higher).

**Step 6 — Permeability / superficial deposits.** Field-calculate `perm_score` on GSNI superficial, rasterize (**G2**):

| Score | Units |
|---|---|
| 5 | alluvium; lacustrine/estuarine silt & clay (floodplain by definition) |
| 4 | till/diamicton (low infiltration, high runoff); peat (saturated blanket bog); glaciolacustrine clay |
| 2 | glaciofluvial / raised-beach sand & gravel |
| 1 | bedrock at surface over permeable aquifers (karstic Ulster White Limestone, Sherwood Sandstone) |

**Step 7 — Weighted overlay** (Kazakis-style, accumulation-dominant): flow accumulation 0.30, elevation 0.25, permeability 0.20, rainfall 0.15, slope 0.10 (Σ=1.00). Chain as in A.1 Step 8 (**G6**).

**Step 8 — Classify** to five classes (same equal-interval rules; **G4**).

**Step 9 — Validate.** Overlay DfI historic flood outlines where obtainable (import, **Clip by layer** / **Zonal statistics** of the index inside vs outside outlines); minimum sanity: CORINE water bodies and the Lough Neagh fringe must fall in Very High, the Antrim plateau top in Very Low. Stretch: HAND once hydrology exists.

---

## 4. Gap table

Ranked by how much of the prototype each blocks. "Owner" = where the fix belongs given the plan's browser-degrades-gracefully rule.

| # | Gap | Blocks | Rank rationale | In plan? | Proposed owner |
|---|---|---|---|---|---|
| **G1** | **Raster import resolution ceiling** — GeoTIFF is fully read then downsampled to a 192-cell grid (~1 km over NI) | Every raster step of both recipes; slope from 1 km cells voids Recipe A at step 2 | Kills both maps before any tool runs; everything below assumes it fixed | Phase 7 (COG/range reads) — **too late for the acceptance test**; pull a full-resolution decode (bounded by a cell budget) forward | **Native JS** (`geotiff-adapter`/import path) |
| **G2** | **Vector→raster (rasterize by attribute)** | A: lithology (w=0.25); B: permeability (w=0.20); the buffer-ring distance workaround | Two of ten factor layers plus a workaround path; no browser tool at all | **Yes** — Phase 3 `/jobs/gdal` allowlists `gdal_rasterize`; also named in the acceptance-test paragraph | **Sidecar GDAL** primary; **native JS fallback** is ~40 lines reusing `clipRasterByPolygon`'s cell loop (burn field value instead of masking) so the demo runs sidecar-less |
| **G3** | **Flow accumulation (pit-fill + D8 + accumulation)** | B's top-weighted factor (0.30); HAND stretch goal | Recipe B is capped at Variant-0 quality without it; A unaffected | **Yes** — Phase 4 item 5, `sidecar/tools/hydrology.py` (numpy) | **Sidecar Python** (priority-flood pit-fill is the hard part; keep it out of the browser) |
| **G4** | **Multi-rule reclassify UI** — engine (`RA.reclassify`) takes N `[min,max,value]` rules; wired UI offers one threshold → binary | Every factor-scoring step and both final classifications: 7 of A's 10 steps, 6 of B's 9 | Touches more steps than any other gap, but is a UI table-editor over working code — highest value per line | Named in the acceptance-test paragraph; **not scheduled in any phase** | **Native JS/UI** (toolbox rule-table editor; trivial) |
| **G5** | **Raster align/resample to a common grid** + no grid-match guard in `rasterCalculator` (zips `band[i]` by index, silently wrong on mismatched grids) | Every multi-source calculator step (HadUK 1 km vs DEM 100 m vs CORINE 100 m-different-grid) | Silent-wrong-answer class, worse than missing; blocks step 5/6 of both | Partially — Phase 3 item 5 (`gdalwarp` resample) | **Both**: sidecar `gdalwarp` for real resampling; **native** nearest-neighbour `resampleToGrid(raster, template)` (~20 lines) *and* make `rasterCalculator` refuse mismatched grids |
| **G6** | (a) `rasterCalculator` implemented, zero UI; (b) two-input only → weighted overlay is a 4-call chain; no N-layer weighted-overlay convenience | The overlay core of both recipes (one step each, but the *central* one) | Chaining works once (a) is wired, so moderate; (b) removes three error-prone intermediate layers | (a) **Yes** — Phase 1 item 4; (b) named in acceptance-test paragraph, unscheduled | **Native JS**; (b) as a Phase-2 tool-runner descriptor (N inputs + weights → one call, provenance-friendly) |
| **G7** | **Arbitrary-CRS ingest** — GSNI/OSNI data arrives in Irish Grid (EPSG:29902/29903) or ITM (2157); browser transform is WGS84-UTM/LAEA only, no `.prj` detection | Step 1 of both (every local dataset); workaround = external `ogr2ogr`, which undercuts "runnable with this app's toolset" | Hard external dependency, but a one-time prep step per dataset | **Yes** — Phase 3 item 5 (arbitrary-EPSG vector reproject); Phase 7 (`.prj` detection) | **Sidecar GDAL** (`ogr2ogr`); `.prj` sniffing native |
| **G8** | **Distance-to-drainage (Euclidean distance raster)** | A factor (lowest weight, 0.10); B's interim flow-accumulation proxy | Lowest-weighted factor + has a buffer-ring workaround (which itself needs G2 and will crawl through `unionAll` on the full river network) | **No** — `gdal_proximity` absent from the Phase 3 allowlist | **Native JS** two-pass chamfer distance transform (~50 lines, grid-friendly); alternatively add `gdal_proximity.py` to the allowlist |
| **G9** | **Sample raster at points** (extract-values-to-points) for validation; sub-gap: buffer UI doesn't expose `dissolve:false`, so the per-slide zonal-stats workaround collapses to one merged zone | Validation step of both (the acceptance *criterion* itself); not the maps | Blocks proving the map, not making it | **No** | **Native JS** — either a toolbox op over layer samplers, or expose the existing `GP.buffer` `dissolve` option in the UI (one checkbox) |
| **G10** | **BGS/GSNI + HadUK connectors** (direct pull instead of manual download) | Convenience only — manual download + drag-in works today | Zero-blocker; pure ergonomics | Named in acceptance-test paragraph ("BGS connector") | **Native JS** (`connectors.js` row, same pattern as USGS/Overpass) |
| G11 | Bounded GEE snapshot (client sends no scale/dimensions; NI-extent request would yield ~190 m/px vs the 39 km/px global cache) | Rainfall Variant-0 quality only (HadUK supersedes it for the real run) | Data-quality note more than a tool gap | No | Native JS (request params) — optional |

**Bottom line.** Phase 1 (calculator wiring) + Phase 3 (rasterize, warp, reproject) + Phase 4 (hydrology) cover G2, G3, G5-sidecar, G6a, G7 as planned. The acceptance test additionally *requires* four unscheduled items — G1 (pull forward, it gates everything), G4, G6b, G9 — all cheap native work, plus G8 as the one genuinely unplanned algorithm, best done as a native distance transform. Recipe A is fully runnable at target quality after Phases 1–3 + G1/G4; Recipe B additionally waits on Phase 4's `hydrology.py` for its top-weighted factor.