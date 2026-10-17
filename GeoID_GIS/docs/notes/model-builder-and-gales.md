# Model Builder, Meshing Studio and GALES results

Working notes moved verbatim from GeoID_GIS/CLAUDE.md (2026-10-17), in their
original order. The index is GeoID_GIS/CLAUDE.md; ask the code graph first
(see there) and read the section here that it points you at.

## The Model Builder is a PIPELINE, and it ends in a real mesh

The tab was a `+ Data`/`Custom` row and nothing else. It is six numbered
steps now, each unlocked by the one before — **study area → layers and roles
→ surface → domain → conditions and points → build** — because packaging a
study for a solver is a sequence where every decision depends on an earlier
one (a boundary condition needs surfaces, surfaces need a domain, a domain
needs ground), and a flat panel of eighteen controls hides that order behind
the reader's guesswork. A blocked step says which step would unblock it.

`model-build.js` is the pure half and is checked in Node against closed
forms; `model-pipeline.js` is the panel and the project writes. What comes
out: `meshes/<name>_surface.stl` (the terrain skin), `meshes/<name>_domain.stl`
(watertight), `meshes/<name>_gmsh.py`, and `fem_runs/<run>/spec.json` in the
shape the FEM pages AND the sidecar's deck prepare already read — never a
format of its own.

- **A FEM domain is a BLOCK, in metres.** The polygon says where; the model
  is the axis-aligned box over it, because a mesh that follows a hand-drawn
  outline inherits every jag as a sliver element. The frame is local
  east/north metres about the study centre on THIS body's radius.
- **gmsh meshes a WATERTIGHT surface, so the terrain skin alone is useless.**
  `classifySurfaces` + `createGeometry` + one `addVolume` needs the boundary
  closed: the domain STL is terrain + skirt walls + base. The base is a FAN
  from its own centre to the perimeter nodes, not two big triangles — two
  would leave the walls' subdivisions meeting one long edge, T-junctions that
  read as watertight to the eye and open to a mesher. `stlStats` MEASURES it
  (every edge in exactly two triangles, V−E+F=2) rather than assuming.
- **Wind every facet against a known outward direction.** `triangleWriter`
  takes a hint and flips the winding when the computed normal disagrees;
  deriving winding by hand per face is where a closed surface silently
  becomes an inside-out one. The test catches it as a NEGATIVE enclosed
  volume.
- **The boundary NAMES are the whole point of the physical groups.** A FEM
  condition names a surface, and `classifySurfaces` numbers its output
  arbitrarily, so the script assigns top/base/north/south/east/west by where
  each surface sits. Verified in a real mesh: 8 physical groups, and the
  spec's `boundary[].surface` refers to names that exist.
- **An embedded point is a mesh NODE, not a coordinate in a file.**
  `gmsh.model.mesh.embed` forces one exactly there, which is what makes a
  borehole or a probe worth recording. Measured on real gmsh output: both
  points 0.000000 m from a node.
- **A node cap must actually hold.** One scaled guess put 51×51 against a
  2500 ceiling (the +1 and the rounding), so the step is walked up until it
  fits. Coarsen, never truncate: a clipped domain is a different study.

**Native resolution is MEASURED, and on Earth it is 19.6 km.** The sampler
interpolates bilinearly, so between pixel centres the values run exactly
linearly and every kink in the second difference is a pixel boundary; the
median spacing of those kinks is the raster's own sampling, needing no seam
any viewer would have to grow. The consequence is the honest part: a 10 km
study is a fraction of ONE global-DEM pixel, so sampling at 83 m is a smooth
mesh and NOT new ground detail, and the surface step says which it is rather
than letting a 121×121 grid imply the ground was measured that finely. Same
discipline as the imagery zoom ceiling and Earth Engine's `scale`.

**Two faults the live run showed, both invisible to a seam test**: the Build
surface handler CLOSED OVER the step computed when its card was rendered —
which is before step 2's measurement exists — so measuring the native
resolution changed the quoted number and not the sampling (read the plan at
press, and re-render after the probe). And `window.GeoIDResearch.sidecar`
**was never published**: the Meshing Studio's gmsh button had addressed it
for as long as it has existed and always reported "connect the sidecar"
with one connected, probed and answering. A seam a module addresses is part
of the contract whether or not it was written down.

**The step NUMBER is the card's mark**, so the pipeline stamps
`summary.dataset.toolIcon` — the shared icon painter's own documented skip —
rather than wearing its fallback bracket beside a numbered chip.

Verified end to end, not inferred: the browser wrote its package into a
sidecar-backed project on disk, real gmsh (4.11.1) meshed the browser's OWN
STL and script — **1,524 nodes, 8,315 elements, 8 physical groups, both
400 m boreholes exact nodes** — and the sidecar's GALES prepare then took
that spec and mesh into a deck (`setup.txt` patched to `dim 3`,
`mesh_2core.txt`, the spec's time stepping; `props.txt` carrying the
domain step's materials).
## The model page's visibility box, and two studio faults it exposed

**`#studio-visibility` is the model page's Workspace, and it sits where the
Workspace sits**: the foot of the left column, at the deck's width. It opened
at the top right first, and was moved on request. The deck is told the box's
height through `--studio-vis-space` on `#model-studio`, which mirrors the GIS
dock's `--layer-dock-space`: ResizeObserver plus a MutationObserver on
`hidden`/`class`, the box height plus 32 px, or 3.2rem when the box is gone.
The deck stops above the box. Measured: a 16 px gap whether the deck is at its
cap or the box is fully expanded. The box follows the deck into the margin
(`is-away` mirrors the deck's `is-folded`), as the Workspace follows the
sidebar. Its body is capped at the Workspace's own `min(42vh, 20rem)`. It uses the Workspace tile's own frame, head, chevron and
row classes (`layer-dock-head`, `layer-row`, `layer-disclose`, `layer-eye`), so
the two pages' boxes are one object seen twice. There is a row per domain, carrying a
three-state eye and a shown/total count. A disclosure opens the domain's surfaces and
points, each with its own eye, and clicking a part's name opens its card. The meshed
result is a row too, because hiding the mesh is how you see the surfaces beneath it.
The box is built at runtime inside `#model-studio`, so it shows and hides with the
page. Its CSS is appended identically to both stylesheets inside the pinned
studio block, and its fold state is remembered in
`geoid-studio:visibility-collapsed`.

- **One domain list.** `domainGroups()` is factored out of the Domains panel
  and both read it, so they cannot disagree about which parts a domain holds.
  Every eye commits through `partVisible`, and every render reads the state
  back off the meshes. `renderDomainsPanel` renders the box first, so each
  existing call site keeps both in step.
- **A head with nothing at its right end needs `justify-content: flex-start`.**
  The shared `.section-toggle` rule spreads its children with space-between.
  The Workspace head hides that behind its icon buttons; this head has none, so
  its title was pushed to the far edge.
- **Place a card by its MEASURED size.** A guessed 300 px width left it
  overlapping the box by 75 px. Opened from the box, the card now sits 8 px to
  the box's right and is clamped on screen.

**One mesh view at a time.** Each Mesh press added another display over the
last, so hiding one still showed the one beneath it. Clear mesh also cleared
only the data and left the picture drawn. `state.meshView` now holds the one
display, and `removeMeshView()` is called on re-mesh, on Clear, and on New.
Measured: meshing twice leaves 1 layer and 1 object in the scene; Clear leaves 0.

**Deleting an entity threw halfway through its faces.** `deleteEntities`
removed each face's Workspace layer inside `traverse`, and removing a layer
takes its mesh out of the group being walked, so the walk read an undefined child.
Every multi-face entity (every primitive since faces became parts) left
layers behind on delete. Collect first, then remove.

**And fixing that exposed the atmosphere resize.** `applyStudioAtmosphere`
"kept" `state.atmosphere` across the delete by holding the SAME object, and the
delete switches that object off, so a resize removed the air instead of
rebuilding it. It went unnoticed only because the throw above happened first.
Keeping state across a call that mutates it needs a COPY. Measured after: 8 m
then 5 m rebuilds at 5 m, with the layer count unchanged at 11.

**`cmd | tail -1` swallows cmd's exit code.** A suite that could not even be
found reported nothing, the `&&` chain went on, and a commit landed unstamped
because the next relative path was also wrong. Use `set -o pipefail`
and absolute paths — this file has now recorded that trap three times.
## The layered model: soil over bedrock, and water, on one TIN

`gis/layered-model.js` is the pure half, with 29 checks.

**Heights.** Per surface node:
- `solid` — the land surface, seabed, lake bed or river bed
- `water` — 0 m on the sea (ocean mask, z ≤ 0), a lake's surveyed level, or
  the DEM on a GRWL river
- `bedrock` — `solid − max(min soil, Pelletier thickness)`
- `top` — `max(solid, water)`, the air's floor

**Volumes.** Each is a closed shell between two of those arrays on the SAME
triangulation, so the interfaces conform by construction. `betweenFacets`
builds top, bottom and rim walls, and a wall collapses where the two
surfaces meet.

**Wiring.** The Model Builder's domain step gains the "Soil over bedrock" and
"Water bodies" toggles and "Read the layers" (`readLayers` samples every
node). The package writes `<name>_{bedrock,soil,water,atmosphere}.stl`, each
with a `_gmsh.py`, plus `<name>_bedrock_top.stl`, and records them under
`spec.provenance.layers`. `openInStudio` passes the layers, and the studio
draws each volume as its own domain with inside-tests.

- **A wall faces away from ITS OWN triangle** (the third vertex), not from
  the TIN's centre. The centre is right on the outer rim and wrong on a
  shoreline: a 2,000,000 m³ strip of sea measured 666,667 m³ with one wall
  wound inward.
- **Name faces, don't classify them.** A multi-solid STL (one `solid` per face
  name) makes gmsh create one named discrete surface per block. The script
  runs `createTopology` + `createGeometry` without `classifySurfaces` and tags
  faces by `getEntityName`. Classifying by shape files the soil's ground and
  its bedrock top both as "top".
- **Points on closed curves have no curve boundary**, so they are tagged
  through `getAdjacencies`, or GALES refuses them.
- **Thin volumes need thin elements** (measured, gmsh 4.11.1, 2 km block):
  - A 2–12 m soil skin failed at 150 m and meshed at 60 m.
  - Water 1–37 m deep failed at 149 m ("intersections in the 1D mesh") and
    meshed at 60 m.
  - Rule: `thinLayerSizeM` = 20 × the tenth-percentile thickness.
- **Minimum water depth (1 m)**, or shore walls pinch to zero height and
  gmsh fails. **`minGap` is 1 mm**, the STL's writing precision, or rounding
  makes zero-area slivers.
- **Verified live** on a 6 × 6 km box over Belfast Lough (14,036 nodes,
  −7.7 to 75 m):
  - 7,934 sea nodes, 412 of them deepened to the 1 m minimum
  - soil 4.8 m mean where modelled
  - all four volumes watertight on the real surface: bedrock 17.09 km³,
    soil 0.088, water 0.068, air 11.79
  - the studio listing Bedrock / Soil / Water / Atmosphere / Surface
- **Not done:** gmsh was run only on a synthetic surface, not on the Belfast
  STLs. Faults as dip/strike planes and World Stress Map boundary conditions
  remain future work. Volcanic chambers are the studio's existing primitives
  and combine with these volumes as before.

### "Water bodies have no depth" — the bed came from a land DEM

Measured on Izmit–Sapanca: all 188 sea nodes had been deepened to the 1 m
minimum, because a land DEM reads ~0 m over the sea (Mapzen: 0.0 m in the gulf
from z11 up, −3.6 m at z9–10 from ETOPO1). Every lake was hard-coded 2 m deep.

- **Sea: `bathymetry.js` reads the EMODnet Bathymetry WCS.** It is keyless and
  CORS `*`, and returns a GeoTIFF of metres at about 115 m, filled from GEBCO
  outside EMODnet's seas. `seaBedAt` takes it wherever it is deeper than the
  DEM. After the fix: the gulf goes to 29 m, and 105 of 120 sea nodes take
  their bed from bathymetry.
- **Lakes: HydroLAKES `depth_avg_m` was already baked into the pyramid and
  never read.** `waterMasks` now also returns `lakeDepth`. `lakeBasins` shapes
  each connected lake as a cone: depth ∝ shortest path to a dry node, scaled so
  the mean over its nodes IS the published mean. Sapanca: 13 m mean, 35 m
  deepest.
- **A DEM only counts as lake bathymetry when it is WELL below the level**:
  max(3 m, a quarter of the mean depth). The land DEM reads Sapanca's surface
  at 29.1 m against HydroLAKES' 30 m, and the old 0.5 m test took that surface
  for a 1 m bed.

### The Layer view: soil and water as bodies, display only

At true scale 12 m of soil over a 6 km block is a coat of paint. The studio's
Visibility box ends in three sliders: soil thickness ×, water depth ×, and a
gap that lifts soil (with the ground skin), water and air off the bedrock
(`applyLayerView`). Each vertex is mapped through its own column (base →
bedrock top → ground → water surface), read from the TRUE layers, so the
bedrock, the faults and the points follow, and no wall tears. The package, the
inside-tests and the mesh keep true heights. The soil's top IS the ground skin
(drawn once, to avoid a coplanar pair), so hiding "Surface" leaves the soil
open on top.

**The site must be served on localhost:8125.** The data bucket
(data.geoidinitiative.com) sends CORS for that origin only. On any other port
the soil, lake and ocean pyramids fail silently, and the layers read as "0 sea,
0 lake, 0 river, default soil".
## GALES results in the Meshing Studio

Model page ▸ Results (mesh band): open a GALES simulation folder (or a
`fem_runs/` run in the open project) and read what the solver wrote — the
ParaView pass on the page the model was built on. `gis/gales-results.js` is
the pure half (91 checks, the real Etna run among them when the gitignored
GALES tree is beside the site), `gis/gales-worker.js` parses and slices off the
main thread, `gis/gales-results-panel.js` is the panel. Everything below was
read off the GALES source rather than assumed.

- **The text mesh** (`custom_gales_mesh_reader.hpp`): `MESH! 3D|2D`, counts,
  bounds rows, then `Node gid x y z flag` — **2D nodes have NO z column**
  (`gid x y flag`; the reader takes the flag at `result[dim+2]`), `Element gid
  pid nb n.. flag`, `Side gid pid nb n.. flag`. Ids are 0-based.
- **A `.msh` maps node gid = tag − 1**, which is `gmsh_to_gales.py`'s own rule
  (`int(line) - 1`) — not "the order the file lists them". Etna's
  `mesh_4core.txt` Node 0 is `mesh.msh` node 1 to 1.5e-11. 4.1's side flags are
  the ENTITY's physical group from `$Entities`, not the entity tag.
- **Results are `results/<field>/<time>`, raw little-endian float64,
  `nodes × nb_dofs`, a node's dofs together** (`io.hpp`). `write2` fields
  (`fluid_mesh`, `sec_dofs/*`) are CONCATENATED BY COMPONENT (all x, then all
  y) — only the name says which, so `describeField` decides by name and the
  dofs per node come from the byte count; a count that does not divide the
  mesh is named "another mesh" (the fluid mesh of an FSI run) rather than read.
- **Fluid dof order** is p, v…, T (absent isothermal), then mass fractions.
- **The Side records ARE the boundary**: measured on Etna, 103,074 sides equal
  the tet faces seen once, exactly. So nothing is derived on a mesh that has
  them; a mesh without sides has its boundary derived through an
  open-addressed table of sorted node triples — a Map of strings over four
  million faces is the machine's memory.
- **Parse bytes, not text.** An 87 MB mesh as a JS string is twice that before
  a number is read. The byte cursor reads Etna's 1.4 M tets in 0.4 s in the
  worker, and a float parse that keeps mantissa and exponent apart agrees with
  `parseFloat` on survey coordinates (1e-320 included).
- **A slice is edge interpolants, not positions** — (node a, node b, t) per
  vertex — so field, step and warp re-colour the same cut. `sliceTets`
  normalises the normal AND the constant: normalising n alone moves the plane
  (x+y+z = 1.5 is not x̂·x = 1.5), which the test caught as a corner triangle of
  area 0.14 where the hexagon is 3√3/4.
- **A buffer handed to a worker is TRANSFERRED**, so it is detached on this
  side: the project source reads a mesh `fresh` rather than out of its
  one-file cache, or a second open of the same mesh reads a zero-length buffer.
- **A clip keeps the half whose cut faces the studio's own view** — Fit and
  Iso look from +x, model −y and above, so x ≤ d, y ≥ d, z ≤ d. Kept the other
  way the cut faces away and the clip looks like the whole model. Three's
  clipping discards negative distance: keep n·x ≥ d is `Plane(n, −d)`.
- **Things drawn in the studio's frame that are not solids need their own
  bounds seam.** The ground lattice cut its hole and let the camera below only
  from `combinedBounds()` (the solids), so a 50 km-deep result had the lattice
  ruled across it; but `combinedBounds` is also the mesher's and the
  atmosphere's model, so the results go through `setExternalBounds` →
  `sceneBounds()`, read only by the ground hole and the camera floor. A 2D
  mesh lies IN the ground plane and z-fought every lattice line until its box
  was given a hair of depth.
- **The probe never stops `pointerup`** (OrbitControls needs the release) and
  reads a node's own bytes for its time series (`File.slice`), so a probe
  through hundreds of 6 MB steps reads 24 bytes each.

Verified live on 8125 with the Etna run opened through the panel's own seam:
|u| 0–85.41 m on the surface; a y = 50 km clip with 31,316 slice triangles in
70 ms; a real click on the cut probing node 25018 at (-3.514, -3.262, -80.658) m
— numpy's values exactly; auto warp ×88.5; the face-on slice showing the
chamber cavity; and a synthetic 2D run (fluid_dofs p,vx,vy,T; blocked
fluid_mesh warp) drawn in plan with the lattice cut under it.
## FEM points to time series, and the risk assessment reader

### GALES results ▸ Points and time series

A run is read at points. Stations come from five doors and all end at a node:
a **node flag**, the Model Builder's **spec.json** `geoid_model.embedded_points`
(which now carry their `flag`), the **studio's** points, the **probed** node
("Add as a point"), or a **typed** list (`name, x, y, z`). Each non-node point
is taken to its nearest node and the distance is written beside it in the CSV.
Every chosen field is extracted at every step as one CSV per point, one per
step, or one tidy file; filed into the open project's
`post_processing/extracted_dofs/` (flat, because `findTables` does not walk
into subfolders) and downloaded — several files as one zip, gated like every
save.

- **An embedded point's flag is ON ITS NODE** because `gmsh_to_gales.py`
  assigns node flags faces → lines → POINTS, the points last. The `.msh`
  reader now does the same, so a flag names a point in either format. Etna's
  mesh carries only boundary flags (4, 5), which is why the flag list is
  ordered fewest nodes first: a point group is small.
- **The nearest node is a bucket grid**, not a scan (a thousand points against
  a quarter of a million nodes). Ring search stops once the best distance is
  inside the next ring's inner radius; pinned against brute force for queries
  outside the mesh's box too. Live, all three typed Etna points agreed with a
  numpy argmin to the millimetre — one of them 3,030 m off, because it asked
  for a point inside the chamber cavity, and the file says so.
- **A few points read their own bytes, many read the step once** (≤ 24).
- Verified: summit node 25018 and chamber-wall node 51462 at t = 1 read
  (-3.514, -3.262, -80.658) and (-1.684, -2.506, -67.372) m, numpy's values.

**Downloads are membership-gated in development too**: with no unlock key the
zip is refused with the membership sentence, which reads like a broken button
until the status line is looked at. Test with `geoid:unlock=owner`, remove it.

### Hazards ▸ Exposure is a risk assessment

`gis/risk-assessment.js` (59 checks) decides what an exposure answer is SAID
as; `exposure-panel.js` integrates and shows it.

- **A level is a scheme, stated**: every class carries its level AND its
  threshold in the hazard's own units (FoS < 1; depth ≥ 2 m; p ≥ 0.5; ≥ 113 kt;
  M ≥ 8; VEI ≥ 6), and the report prints both. A raster whose direction is
  not known gets VALUE BANDS with no level — calling its top band "Very high"
  claims more of it is worse.
- **Not exposed and no reading are two rows, never a class.** Off-grid people
  inside the polygon enter the grid tally as no reading (`assessGrid`'s
  `outside`), so ground the map does not cover is never read as safe.
- **Second readings per risk map**, from columns the bakes already write:
  cyclone `p_hur_yr` (hurricane-force chance) and, when the tracks layer is on,
  the strongest storm within 200 km (`windLookup`: segments bucketed by
  degree, strongest first, so a query stops at the first track in reach —
  labelled as each storm's LIFETIME peak, which the track file holds, not its
  strength where it passed); seismic `mag_max`; volcanic `vei_max`, handed
  over as −1 where `p_yr` is zero so "VEI 0 on record" and "nothing" differ.
- **People-weighted statistics** (mean, median, p10–p90), the edge share on
  BOTH paths — the population path had none and printed "0.0% in edge cells"
  on a 1,784 km² area — and each polygon of a multi-polygon layer on its own
  (`groupByFeature`, named by its own name field).
- **The report is one self-contained A4 HTML page** (print CSS, editable title,
  summary, notes and sign-off) opened as a blob with `#print`, so the browser's
  Save as PDF is the PDF writer and nothing is vendored. Its map is an SVG of
  the polygons coloured by share at very high/high, with key, scale bar and
  north arrow: the globe snapshot it started with showed the whole planet, not
  the area, and was dropped.
- Verified on 8125 against three named Miami polygons: cyclone risk 2,704,423
  people, 1,650,993 reached a year, 100% "p ≥ 0.5", hurricane-force 1 in 2–10,
  strongest storm Cat 4–5; a synthetic flood-depth `.asc` (the name picks the
  flood scheme) classed 468,491 / 1,139,834 / 502,929 / 306,068 / 143,403 with
  93,021 not exposed, summing to the total, and the per-polygon shares 0.90 /
  0.42 / 0.02 drawn darkest on the coast.

**Two trap-shaped things met while verifying.** A blob URL cannot be opened
by the Browser pane's `navigate`; carry the HTML to a same-origin tab over a
`BroadcastChannel` and `document.write` it. And a screenshot taken straight
after `document.write` + scroll can show the previous page's paint: take it
again before believing a blank or truncated report.
## The model definition goes to GALES as generated files, and a solve is not run here

`gis/fem-setup.js` (pure, 33 checks) turns the Model page's setup into what a
GALES sim reads: a material library (18 materials, each with rho/E/nu or
rho/mu, and k and cp), the physics (solid, heat, fluid) with their
conditions, `props.txt`, and the `*_ic_bc.hpp` header. `studySpec` returns the
sidecar's spec shape with `gales: { family, files, setup }`.

- **A boundary condition in GALES is compiled, not read.** `dirichlet_<dof>(nd)`
  is keyed on the NODE flag and `neumann_<fn>(bd_nodes, side_flag)` on the SIDE
  flag. The header must define every function the reference sim's does, or
  the build fails.
- **Stacked domains of different materials become `heterogeneous_layers
  z-wise`, bottom first.** Overlapping domains cannot be expressed to GALES.
  They are made uniform, and the plan names the material that was dropped.
- **Sidecar prepare writes only `props.txt` or `[a-z_]+_ic_bc.hpp`** from
  `spec.gales.files`. It removes the reference's other ic_bc headers, rewrites
  `../../../src/` to `GALES_SRC/src/`, and patches `delta_t`, `final_time`,
  `print_freq` and `n_max_it`.
- **`gmsh_to_gales.py` fails on a `$PhysicalNames` block**, so prepare strips it
  (`_strip_physical_names`). The setup's mesh key is
  `<mesh stem>_<cores>core.txt`, not a fixed name.
- **Host cmake could not find Trilinos or gmsh.h**, so `_cmake_hints()` globs
  the Trilinos dir and adds `-I~/.local/include`. A header generated this way
  is proven to compile. A real solve is not proven locally.
- **NEVER RUN A REAL-SIZE SOLVE ON THIS LAPTOP.** A 4-rank Etna solve inside
  the atlas-build-mesh container rebooted the machine (15 GB RAM). Verify FEM
  work on tiny meshes (a few hundred nodes, 1 rank), or stop at "compiles" and
  say so; solves belong on the sidecar's ssh compute targets. Stop processes by
  PID, never `pkill -f`.
## Mesh quality: a ribbon toggle, and where the poor elements are

`gis/mesh-quality.js` is the arithmetic (pure). `gis/mesh-quality-panel.js` is
the studio ribbon's **Quality** toggle and the card it opens.

- **Metrics.** Each is normalised so a regular element scores its ideal:
  - shape quality γ;
  - radius ratio;
  - edge aspect ratio;
  - minimum and maximum dihedral angle (corner angle in 2D);
  - element size.
  Each metric carries the direction it gets worse in, a default threshold and
  the reason for it. A threshold is a control, not a verdict.
- **Inverted means the MINORITY sign**, because a mesher writes one
  orientation, whichever sign the file happens to use.
- **Either mesh on the page.** The card reads the studio's tetrahedra or a
  GALES mesh opened in Results, and says which. With both present it offers a
  choice. `elementsOf` keeps only cells of the mesh's own dimension, because a
  3D GALES mesh's triangles are its boundary.
- **Where, not just how many.** Poor elements are drawn as their own faces with
  `depthTest: false`, because the elements a mesher gets wrong are usually
  inside the volume. The studio mesh is drawn under the model anchor, turned by
  `MODEL_TO_SCENE`. A GALES mesh is drawn in the results frame
  (`GeoIDGalesResults.frame()`, which already carries the centring). Zoom to
  worst and the worst-element list fit the camera to one element.
- **The studio mesh is analysed on the page; a GALES mesh in its reader.**
  The results panel never hands the page its cells. `S.mesh` is `{coords,
  surface, tets: <a COUNT>}`, not the parsed `cells`/`cellOffsets`. So the
  worker answers a `quality` request, `GeoIDGalesResults.quality()` is the
  seam, and only the metrics and a copy of the connectivity cross back
  (`qualityForTransfer` copies the reader's own coordinates rather than
  detaching them). A studio mesh past 250,000 elements, or a GALES mesh past
  1.5 million, waits for a press. At most 20,000 poor elements are drawn, and
  the card says so.
- **Follows the page.** The studio dispatches `geoid-studio:mesh-changed` on
  re-mesh and on Clear, and a 1 s identity poll catches a results run opened or
  closed. The overlay goes when the card closes.
## GALES results can be opened a piece at a time

"The u dofs haven't been loaded" had one door behind it. "Open simulation
folder…" was the only way in, and it wanted the exact GALES layout: the mesh
in `input/mesh_*.txt` and every step under `results/<field>/<time>`. A pick of
`results/solid`, or of the `u` folder on its own, matched no `results/`
directory and was DROPPED WITHOUT A WORD. A mesh not named `mesh*` was never
offered. There was no way to put dof files onto a mesh already loaded.

- **Three doors beside it, and a drop zone.** Open mesh file… (`.txt`/`.msh`,
  any name). Add results folder… (`results/`, `results/solid`, or one field's
  folder). Add result files… (steps picked one by one, filed under the "Loose
  steps are" field, default `solid/u`). Drop a run folder, a mesh or step
  files.
- **Every door maps its files onto the canonical run paths.** A mesh goes to
  `input/<name>` and a step to `results/<field>/<time>`
  (`filesSource`/`composeSources`), so planning, reads, the probe and
  extraction are unchanged. Results added to a loaded mesh are classified
  against it without re-reading the mesh. Results added before a mesh wait,
  and the status says to open the mesh. A mesh opened onto a run that already
  has one starts a NEW run, or the old fields sit there as "another mesh".
- **`groupResultFiles` falls back only when NO path passes through
  `results/`.** Then a directory of numbered files is a field named by its own
  path, while `build`/`input`/`CMakeFiles`/`src` never are. A numbered file with
  no directory belongs to `looseField` or to nothing, because a bare "1" says
  nothing about which field it is.
- **`describeField` reads the LEAF.** `u`, `mine/solid/u` and `solid/u` are all
  displacement, with a magnitude and a warp. The same goes for `v` and `a`.
- Verified on the real Etna run: the mesh opened by hand, then only its `u`
  folder, read Displacement from 0 to 85.41 m on step 1, set as the warp
  field. Opening the results first and the mesh second gave the same.
- **STL is not a results mesh.** An STL has no node numbering for dofs to
  land on, so it is geometry, imported through File ▸ Import CAD.
## The model tree: Materials, Physics and Study between building and meshing

`gis/studio-setup-panel.js` draws `fem-setup.js`'s decisions as three tabs in
their own deck band (`data-band="physics"`, one tab open per band). They sit
between the build tabs and Mesh, which is the order a finite-element model is
defined in.

- **Targets are read off the model, never kept.** `setupTargets()` gives the
  domains (volume flags) and face groups (face flags), polled every 1.5 s by
  fingerprint. So a solid added, or a flag changed in Domains, reaches the
  tabs within a beat. The setup itself is kept in
  `localStorage["geoid-studio:fem-setup"]`, keyed by flag.
- **Badges beside each tab** (`setupSummary`): materials assigned of the solid
  domains, faces with a real condition of the flagged faces, and errors
  standing between the model and a solve. A tree that only lists steps makes
  the reader open each one to find the gap.
- **A condition card lights its faces** (`highlightFlag`) on hover and while
  open, so a flag number is never the only way to tell which face is meant.
- **Study runs the pipeline the sidecar already has:**
  - write `fem_runs/<name>/spec.json` and `input/<name>_gmsh.py`;
  - gmsh through `/jobs/gmsh`, with the mesh copied into the run's `input/`,
    because prepare otherwise takes the first `.msh` in the project's
    `meshes/`;
  - `/jobs/gales/prepare`;
  - `/jobs/gales`;
  - Results on the run.
  The sidecar gets `dir` as `<project.dir>/fem_runs/<name>`, which is
  qt-runtime's form. The seam `gmshScriptFor(name)` writes `<name>.msh`, and
  answers null for a GIS terrain, whose script is the Model Builder's package.
- **A LOCAL SOLVE ASKS FIRST** (`window.confirm`, naming the risk). A compute
  target does not. Nothing in this session ran a solve.
- **A subscription made at install can be made to NOTHING.**
  `GeoIDResearch.store` and `.sidecar` load after this module on some pages,
  so `store()?.onChange` subscribed to undefined and the Study tab never saw
  the project open: "Write study" stayed disabled over an open project. The
  project dir and the sidecar's connection are in the poll's context string
  instead.
- **`createProject` takes a NAME STRING.** Given an object it throws "name.trim
  is not a function", after the membership gate has already passed (the gate
  needs `geoid:unlock=owner` in development).
- Verified live on a box: granite on flag 10, the base (flag 2) fixed, and
  pressure on the top (flag 1) turned the checklist to "ready". Write study
  put a spec with both conditions named by their faces, a header with
  `nd.flag() == 2` dirichlet ×3 and `side_flag == 1` pressure, and an 8.8 kB
  gmsh script writing `study_1.msh` into an in-memory project. Meshing,
  preparing and solving were not run here (no sidecar connected, and no local
  solves).
## Build and Analyse: the Model page's two workspaces, and the pipeline strip

`gis/studio-workspaces.js` puts a Build | Analyse switch at the top of the
deck, and under it a PIPELINE STRIP: GIS ▸ Geometry ▸ Materials ▸ Physics ▸
Mesh ▸ Study ▸ Results ▸ Research. Each step shows a state dot and is a button
to that step.
- **Build** means model and mesh, and it leads in from the GIS page.
- **Analyse** means results and dofs, and it leads out to the Research hub.
- **The strip's ends leave the page**, through `GeoIDModeManager.setMode`.

- **Nothing is moved.** A tab says which workspace it belongs to (`SPACE_OF`,
  written onto `data-space` at runtime) and CSS hides the other workspace's
  tabs, so every id and handler survives. Study and Log belong to both, because
  Study is where one workspace hands over to the other. A test checks that
  every tab in the markup is assigned.
- **A tab opened by any door brings its workspace forward.** A
  MutationObserver on `open` does it, so a checklist line or "Open results"
  cannot open a tab that stays hidden.
- **The strip reads the same summary as the Study checklist**
  (`GeoIDFemSetup.summary()` = `setupSummary` plus the solver mesh's
  `flagCheck`). When they read different things, the strip showed Study green
  over a checklist error.
## The solver mesh: what gmsh wrote, on the model and checked

The lattice Mesh 3D is a preview. `gis/real-mesh-panel.js` (in the Mesh pane,
`#studio-realmesh-host`) opens a gmsh `.msh` or a GALES text mesh, or runs the
model's own script in the sidecar and opens the result.
- **Drawing.** It draws one mesh per face flag, each a row in the Visibility
  box, with optional element edges.
- **Report.** `mesh-flags.js` gives elements by kind, cells by volume flag,
  sides by face flag, and flags carried only by nodes.
- **Check.** `flagCheck` sets the setup against those flags. A condition on a
  flag the mesh has no face for is an ERROR naming the flags it does have,
  because GALES builds and runs a deck whose condition reaches nothing.
- **Quality.** The Quality card offers the mesh as a source.

Verified: a gmsh 1 m box (341 nodes, 1,140 tets, faces 1/2/5 at 90/90/360)
loaded and drew by flag. A condition on flag 7 turned Physics and Study red.
## Tomography: the material at depth, in the order GALES reads it

GALES's solid takes `heterogeneous_pointwise { input_file 3d <file> }` in
`props.txt`, and reads `input/<file>` as a count line followed by
`x y z rho E nu` rows (`solid_properties.hpp`).
- **Indexing.** It sorts the unique x, y and z and INDEXES THE ROWS BY
  POSITION: row = iz·nx·ny + iy·nx + ix, every index ascending. Nothing checks
  the rows really are in that order.
- **Interpolation.** It is trilinear. A fixed mantle (3300 kg/m³, 125.51 GPa)
  applies below z = −25 km, hard-coded in the reader.

**THE `etna_3d_atlas` COPY OF THE ETNA GRID IS WRITTEN z-DESCENDING.**
GALES would read it upside down: 125 GPa at the surface and 14 GPa at 25 km,
with no error. That sim's `props.txt` is uniform and does not read the file.
`etna_3D_DTGEO`, which does read its grid, and
`earth_explorer/etna/input/tomography_elasticity_data.txt` are both in the
right order. `tomography.test.mjs` pins all three.

`gis/tomography.js` (pure) never passes rows through:
- **Rebuilds the grid.** It reorders the rows into the reader's order, refuses
  a grid with a missing node (a gap would shift every row after it), and
  checks ρ > 0, E > 0 and −1 < ν < 0.5.
- **Two kinds of input:**
  - elastic: `x y z rho E nu`, in any order, with or without the count line or
    a header;
  - velocity: `x y z Vp [Vs]`, converted by Brocher (2005). Nafe–Drake gives
    density, Vs comes from Vp when absent, then the dynamic isotropic moduli,
    with an optional static/dynamic ratio on E.
- **Frame controls.** Coordinates in m or km, z as elevation or depth, and an
  offset to subtract (for example a UTM origin).

**In the page.** The Materials card shows ranges, a mean depth profile of E
and ρ, and the grid nodes on the model coloured by E. `fem-setup.js` writes
the pointwise block in `props.txt`, lets the grid stand in for domain
materials (solid only, with dimension and z-extent checks), and records the
grid in the spec. Write study puts the grid in the run's `input/`. The
sidecar's prepare refuses a `props.txt` that names an `input_file` the run
does not have.

The built grid text is kept in `localStorage["geoid-studio:fem-tomography"]`
and restored with the setup. The raw file is not kept, so changing the frame
options after a reload means loading the file again.
## The Model page's panels have ONE stylesheet: `gis/studio-ui.css`

The panels the studio builds at runtime had each grown a style block of
their own, laid over layered `styles.css` rules. The result read as inconsistent
and generated:
- a second magenta fill inside an open tab, which made chips vanish
  pink-on-pink;
- every sentence in its own bordered box, some of them duplicates;
- a 6.2rem field column that cut "— no material —" to "— no materi";
- a two-line ragged pipeline.

The panels are the workspace header, Materials, Physics, Study, the solver
mesh and the Results reader.

`studio-ui.css` is now the one design source. `studio-workspaces.js` links it
last, under its own `?v=` stamp, on both pages. The runtime modules carry no
style blocks, and a test pins that. The rules it states:
- **One loud level.** A deck tab's head fills when open. A section inside it
  stays an outline, and gains an accent spine when open. This needs
  `!important` against side-panels.js's GUI-wide open-is-filled rule.
- **State is a mark.** Chips and checklist lines carry a coloured dot, and a
  status line a coloured spine. The text stays ink.
- **Prose is a note.** Unboxed, muted, short. Facts are an aligned `<dl
  class="st-facts">`.
- **One control height** (`--st-h`), one label/field split (0.95fr/1.05fr) and
  one button family, primary or secondary.
- **Header.** The Build | Analyse pills ARE the deck's head row: they took the
  "Studio" label's place, beside the fold. The six-step stepper sits under
  them. There are no GIS or Research links in the deck, because the page's
  mode bar already has both. A copy beside it was reported as a duplicate and
  removed.

**Moving a style block into a stylesheet moves EVERY rule in it.** The rule
that hides the other workspace's tabs lived in the removed block. Analyse
went on showing every Build tab while the switch read Analyse. It is pinned
now.

Every rule in the file is scoped to `#model-studio`. The pin's selector split
has to skip commas inside `:is(…)`, or it reports scoped rules as unscoped.
## Analysis: plot over line and vector glyphs, beside Results

`gis/results-analysis-panel.js` is the Analysis tab in the Analyse workspace
(`data-band="analysis"`, so it can sit open beside Results).

**Plot over line.** The field, component and step shown in Results are
sampled along a line.
- **How it samples.** Each point is LOCATED in its element, and the element's
  nodal values are weighted barycentrically (`cellLocator`, `locatePoints`,
  `sampleLocated` in gales-results.js). The worker does this, because the
  cells never cross to the page. It is exact for a first-order mesh, not
  nearest-node. The test checks that a linear field is reproduced exactly and
  that a point outside the mesh is NaN.
- **Controls.** Presets run along x, along y, or vertically through the
  centre, and either end can be the probed node. A first or previous step can
  be overlaid. It exports CSV and re-plots when the Results selection changes.
- **Store the weights as Float64.** Float32 weights cost about 1e-7 of the
  solution, and the exactness test caught it.

**A break in a profile is the mesh, not the locator.** On Etna, a vertical line
through the centre has no values from −1.5 to −9.3 km. Brute force in numpy
found no tet containing those points either: the cavity in `mesh_4core.txt` is
larger than `gmsh_mesh.py`'s 3 km box parameter suggests. The panel counts
breaks and says what they are.

Verified against the solver's nodal |u| on Etna at four depths, within the
spread of the nearest nodes: 58.9 against 57.9–59.7 m, 41.4 against 40.6–42.2,
and 23.6 against 22.4–25.0, then 0 at the fixed base. 101 samples through
1.4M tets took 0.8 s, including building the locator.

**Vector glyphs.** One InstancedMesh of shaft-and-head arrows on the surface
nodes, subsampled to 500, 2,000 or 8,000.
- **Size and colour.** The longest arrow is 8% of the model's diagonal times
  a size factor, and arrows are coloured by magnitude on the Results colour
  map.
- **Placement.** They sit on the warped surface when the warp uses the same
  field, and they follow the step.
- **Etna.** Its surface displacement is mostly vertical, so from above the
  arrows read as dots. That is the solution, not a fault.
## Stress and strain, derived from u in the reader

GALES's solid writes `results/solid/u` and nothing else, so the Results reader
derives stress and strain itself. `gis/strain-stress.js` is the pure half
(14 checks), the worker's `derive` request runs it, and the panel offers one
extra field per 3D displacement: "Stress and strain · derived from solid/u".
It has 16 components: εxx εyy εzz εxy εyz εxz, σxx σyy σzz σxy σyz σxz, von
Mises, σ₁, σ₃ and volumetric strain. It opens on von Mises.

- **Linear tets have constant strain.** Each element's strain is sym(∇u), its
  stress is λ tr(ε) I + 2μ ε, and element values go to the nodes as a
  volume-weighted average. The principal stresses come from the analytic
  symmetric eigen solution. The checks: uniaxial strain, simple shear, and a
  rigid rotation reading zero strain. A 2D mesh is refused rather than guessed
  at (plane strain against plane stress).
- **The material is the run's own.** `parseSolidProps` reads `props.txt` in all
  three GALES forms: uniform, `heterogeneous_layers z-wise`, and
  `heterogeneous_pointwise` with its grid file, sampled through
  `tomography.sampleGrid`. With no solid props the field is strain only, and
  its label says so.
- **A derived step has no bytes on disk.** Its steps carry `source` (the u file)
  and a `derived:` path. `valuesAt` computes them, and the probe series and
  station extraction skip the byte-range read for them.
- **Verified exactly against numpy** on Etna node 25018 (8 incident tets). exx
  −5.397079965e-4, ezz −1.30540898e-3, sxx −34,785,544.22 Pa, szz −50,099,563.98
  Pa and ev −2.39913843e-3 agree to all printed digits. Etna's props.txt is
  uniform (E 25 GPa, ν 0.25). All 1.4M tets take 780 ms in the worker, and von
  Mises reads 0 to 256 MPa on step 1.
- **Legend ticks drop the digits they do not need** (`tickLabel`): 5.000e+7
  beside 1.000e+8 overprinted its neighbours under a 15rem bar, while 5e7 and
  1e8 do not. The min/max line keeps `formatValue`'s precision.
## What a radar satellite would see: LOS and fringes in Results

A volcano deformation model is judged against InSAR, and InSAR measures only
ONE component of the displacement: the range change along the line of sight,
modulo half a wavelength. A model's |u| cannot be compared with a real
interferogram until it goes through the same two steps.
`gis/insar.js` (pure, 13 checks) does both. The Results component list offers
"Satellite line of sight (InSAR)" and "Interferogram fringes (wrapped)" for
any displacement field. Their controls are:

- **satellite presets** — Sentinel-1, ALOS-2 and COSMO-SkyMed, each ascending
  or descending;
- **custom geometry** — heading, incidence, wavelength and look side;
- **a solution scale.**

- **Frame and sign.** The mesh is read as x east, y north, z up. The LOS unit
  vector points from the ground to the satellite, and the satellite is at
  heading − 90° for a right-looking radar. Positive LOS means toward the
  satellite, so uplift is positive from either pass. Sentinel-1 ascending gives
  (−0.615, −0.131, 0.777), the published values. One fringe is λ/2 of range
  change, drawn on a cyclic map over [0, 1] with no bands and no log scale.
- **Wrap after interpolating, never before.** A slice interpolates the LOS
  onto the cut and wraps the result. Interpolating wrapped values puts a
  whole rainbow between two neighbouring nodes.
- **Aliasing is measured, not guessed.** The note gives the worst
  fringes-per-edge over the surface triangles. Above half a fringe per edge it
  says the pattern is ALIASED, meaning a picture of the mesh. Etna's synthetic
  run carries 66 m of LOS, which is 2,382 C-band fringes and 334 across a single
  edge.
- **The scale is legitimate for linear elasticity**, where u scales with the
  source. It changes only what the satellite sees. Picking a scale keeps the
  named platform, while any geometry edit turns it to Custom. Etna ×0.0014 from
  Sentinel-1 descending gives 95 mm of LOS and 3.4 fringes, concentric on the
  summit.
- Settings are kept in `localStorage["geoid-studio:insar"]`, so clear it after
  testing. The geometry is read when the module loads, so a value written to
  storage afterwards has no effect until the page reloads.
## Statistics by domain, and anything that averages must not average fringes

Analysis ▸ Statistics by domain summarises the field shown in Results over
each volume flag. For each flag it gives volume (area in 2D), a
volume-weighted mean and standard deviation, the min and max the field takes
on that domain's nodes, and a volume histogram. The bins are shared by every
domain, and each domain's curve is its own share of volume on a square-root
axis. `domainStats` in gales-results.js is the pure half (10 checks: a
linear field over a Kuhn-split cube averages to its value at the centre); the
worker's `stats` request runs it where the cells are; CSV via
`domainStatsCsv`.

- **Weighted by volume, not by node.** A mesher puts nodes where the geometry
  is difficult, so a node mean lets a 20 m chamber wall outvote a 2 km
  crust. Each linear element takes the mean of its nodes, which is exact for
  a first-order element's integral. Non-simplex elements and elements
  touching NaN are counted and left out.
- **Checked against numpy on Etna:**

  | flag | tets | volume | mean \|u\| | std |
  | --- | --- | --- | --- | --- |
  | 0 | 1,290,687 | 475,483 km³ | 21.47385533 m | 18.98818200 |
  | 1 | 104,767 | 24,746 km³ | 7.87809277 m | 18.88961093 |

  Every figure agrees to the digits shown. The worker takes 0.26 s for all
  1.4M tets.
- **The seam copies the scalar before transferring it.** A component view can
  share the cached field's buffer, and transferring that buffer would detach
  the cache.
- **Wrapped fringes are never interpolated or averaged.** The seam's
  `samplingScalar` returns the LOS for the fringe component. Callers
  interpolate or average that, and `afterSampling` wraps the result: the
  profile does this, while stats are reported in LOS metres. The slice
  already worked this way.
- **`refresh()` keeps its own `losHere`.** The analysis tab calls the scalar
  between refresh's awaits, and that call overwrites `S.losRaw` for another
  step.
- **The analysis follows the satellite geometry.** Heading, incidence,
  wavelength, look side and scale are in its signature, so changing any of
  them re-plots and re-summarises.
- **A press during a run is queued, not dropped.** An early return on
  `busy` meant a probe's own `computeStats()` came back holding the previous
  selection's answer, measured as a magnitude result while fringes were
  selected.
## Compare with observations: a model is judged against the ground

Analysis ▸ Compare with observations reads a GNSS or InSAR line-of-sight
table at its stations in the open displacement. `observations.js` is the pure
half (15 checks); the placement, arrows and card live in
`results-analysis-panel.js`.

- **One least-squares number, and why it is enough to start.** For a linear
  elastic model every displacement scales with the source's strength, so
  k = Σ w·d·m / Σ w·m² is the best strength for the geometry. The misfit
  before and after it says whether the SHAPE fits even where the size does
  not, which is what to ask before changing the geometry. Weights are 1/σ²
  only when every component carries a sigma. A mix is flagged and fitted
  unweighted rather than half-weighted.
- **A header is words past the first cell.** "A 0 0 10 …" is a named data
  row, not a header. Unheaded rows are read by count: 6+ numbers are GNSS
  with z, 5 are GNSS without z, and 3–4 are LOS. The status says the columns
  were read by position.
- **A station with z is interpolated in its element** (`locate` plus
  `sampleLocated`, the profile's path). A station without z, or with a height
  the mesh does not contain, reads THE GROUND BELOW it: the highest surface
  node among those horizontally nearest. The base and the sides are surface
  too, so the nearest node alone can sit 50 km under the station.
- **The reach for "nearest" is twice the nearest distance, not a slack in
  model units.** With 0.002 of the diagonal (about 280 m on Etna), a station
  standing exactly on a node was passed to a higher neighbour. Measured: a
  synthetic 0.4× table came back 0.3995 with 33 mm of residual. With the
  local reach it came back **0.4000000, residual 5e-7 mm**.
- **Beyond the mesh's plan extent a station is not placed**, rather than
  given a distant node's value, and its row says so.
- **LOS uses the Results satellite geometry** (`losVector(S.insar)`). The
  Results LOS scale is not applied: the fit finds the scale. Verified on Etna
  with 40 stations at their node heights (inside the mesh) and a model scaled
  2.5×, Sentinel-1 ascending: k = 2.5000000, RMS 4 µm.
- **A 2D mesh is refused.** Its plane could be a map or a section, and
  guessing which puts every station in the wrong place.
## Export for ParaView: a run leaves as VTK

Results ▸ Export for ParaView writes the open run as an XML UnstructuredGrid
(`.vtu`) per step. `vtk-export.js` is the pure half (12 checks); the reader
worker builds the file, since it holds the cells.

- **One file** for a single step. **Several steps** go in a zip with a `.pvd`
  naming each step's time, which ParaView opens as one time series.
- **Appended raw binary with UInt64 headers.** It is never base64 (a third
  larger, and a string the size of the file on the heap), and the file
  leaves the worker as Blob PARTS, so a 58 MB volume is never copied into one
  buffer first.
- **Every node is a point**, even for the surface-only part, so point data
  lines up with the solver's node numbering. Only cells of the mesh's own
  dimension are written: a 3D GALES mesh's triangles are its boundary, and a
  4-node cell is a tet in 3D and a quad in 2D.
- **A displacement is ONE three-component array** (`solid_u`), which Warp By
  Vector and Glyph take directly. Other components (the 16 derived
  stress/strain readings, fluid pressure, temperature) are scalars. A field
  written by component is re-interleaved. `node_flag` and `volume_flag` (or
  `surface_flag`) go with the data.
- **Float64 for the solution.** Float32 moved Etna's u by 3.8 µm against
  numpy.
- **Verified by VTK's own reader** (python vtk 9.2 on the full Etna volume):
  - 251,147 points and 1,395,454 cells, all type 10;
  - the flag counts match domain stats (1,290,687 / 104,767);
  - summed cell volumes total 500,229 km³ = 475,483 + 24,746, with none
    inverted.
- **A zip holds its entries in one buffer with 32-bit offsets**, so anything
  over 1.5 GB is refused with the way round it: fewer steps, or the surface.
## The Mogi source: a benchmark for the model, and an inversion for the data

Analysis ▸ Analytical source (Mogi). `analytic-sources.js` is the pure half
(15 checks). The surface displacement of a point source in an elastic
half-space is u = (1 − ν) ΔV / π · (dx, dy, d) / R³ (Segall 2010, eq. 7.14),
with ΔV = π a³ ΔP / G for a sphere under pressure. McTigue's finite-sphere
correction is not applied, and the note says so.

- **Compare with model.** The model's top surface is sampled as the highest
  surface node per plan cell, away from the walls (`topSurfaceNodes`, since
  walls and base are surface too). It is plotted against Mogi by distance from
  the source, with an optional fitted ΔV: u is linear in ΔV, so the best ΔV
  for a geometry is one least-squares number.
- **Invert.** A grid over position and log-spaced depth, refined five rounds,
  with ΔV solved at every trial. It uses a grid rather than a descent because
  a point source's misfit has a long depth–ΔV valley. It reports the misfit
  along depth at the best position, so a broad trough reads as an
  undetermined depth. It inverts either the model surface (the model's
  effective source) or the stations compared above (GNSS or LOS).
- **Refinement must stay inside the search it was given.** A window allowed
  to grow walked Etna's answer to 99 km deep in a 50 km box. It is clamped
  now, and a best answer on the edge is reported as the edge rather than a
  minimum (`atEdge`).
- **Etna is not a point source, and the card says so.** Its 50 MPa chamber is
  kilometres across a few kilometres down: the best fit sits on the 50 km
  depth limit, 88% explained. The page recovered a synthetic source from 121
  GNSS stations over the Etna mesh in 0.2 s: 43,004 / 56,996 m against
  43,000 / 57,000 m, depth 6,998 against 7,000 m, and ΔV 29.99 × 10⁶ against
  30 × 10⁶ m³.
- **The flat-box FEM benchmark is not done.** `sim/solid_es/mogi_test_3d`
  (a 1 km sphere at 4 km under 10 MPa) has no results, and it is not to be
  solved on this laptop. Solve it on a compute target and load it through
  Results to benchmark.
- **The inner loop allocates nothing** (`packStations` plus typed arrays).
  The allocating version took 4 s for 49 stations; this one takes 0.2 s for
  4,000 nodes.
## The model report: one page that leaves with the study

Analysis ▸ Report opens one self-contained A4 HTML page. It prints through
the browser's own Save as PDF, as the risk assessment report does, and is
filed into the open project.

- **Contents:** the Model page's setup (materials, conditions and its own
  checks), the mesh, the view snapshot with a drawn colour bar, and every
  analysis that has a result, each with its figure and numbers, a methods
  line and references.
- **Sign-off:** title, summary, notes and sign-off are editable before
  printing.
- **Layout is pure; the facts are the cards' own.** `model-report.js` lays out
  pre-formatted rows (9 checks). `obsFacts`, `obsTable`, `sourceFacts`,
  `inversionFacts`, `profileFacts` and `statsTable` are shared by the card and
  the report, so the two cannot disagree. A section with no data is left out.
- **Figures are redrawn off screen at print size.** Each draw function takes a
  size, because a detached canvas has no `clientWidth`. The view is one fresh
  `renderer.render` followed by `toDataURL`, the studio's own snapshot path.
- **The page's legend is an overlay, so the snapshot has none.** The report
  draws the colour bar from `results.colormap()` over the step's own range.
- **The setup is the PAGE's, and it says so.** Nothing ties the Model page's
  setup to a run opened from a folder, so the section carries that note.
  Verified: an empty studio's setup prints its own errors ("Add geometry…")
  rather than looking ready.
- **Verified on Etna** with the profile, stats, observations and Mogi cards
  run: 349 kB, eight sections, five figures. The snapshot is 28% lit (not a
  black canvas), the colour bar reads 0–80 m, and building it takes 0.1 s.
- **To look at a blob report in the Browser pane**: open a second tab on the
  same origin, listen on a `BroadcastChannel`, and `document.write` the HTML.
  `navigate` cannot open a blob URL.
## Comparing two runs: the difference is an ordinary field

Results ▸ Compare with another run opens a reference run's folder. For every
field both runs hold, a `compare/<field>` field is added whose step is this
run's step minus the reference's step at the same time (the latest at or
before it). Every view, analysis, probe, report and VTK export reads it as it
reads any field. `referencePlan` and `differenceOf` in gales-results.js are
the pure half.

- **Matching:** by exact field name, else by leaf where the leaf is unique on
  both sides, so a reference opened as its bare `u` folder is still solid/u.
  An ambiguous leaf matches nothing.
- **A difference has no bytes of its own.** Like the derived stress it is
  computed in `valuesAt`, so the probe's byte-range read is skipped for it
  (`!f.derived && !f.compare`). An old pin matched the exact
  `!f.derived ? nodeByteRange` shape and had to be loosened; its intent
  holds.
- **Only sizes can be checked**, and a different mesh with the same node count
  would subtract unrelated nodes. So the card says what was checked:
  - no reference mesh ("assumed the same, node for node");
  - a mesh file of the same name and size;
  - or a warning when the mesh file differs.
- **Every label says it is a difference.** The component and vector labels
  carry "Δ"; otherwise the legend read "Displacement magnitude" over a
  subtraction. The report names the reference and adds a methods line.
- **The VTK export's field ticks follow the field shown until one is ticked
  by hand.** Before this, the export went on writing `solid_u` after the view
  had moved to the difference.
- **Verified on Etna** with a reference whose step 1 is exactly half of u:
  node 25018 reads (−1.757, −1.631, −40.329), half the solved value, in the
  reader, in the `compare_solid_u` VTK array and in the report. A reference
  with a 5 m summit bump reads 0–4.98 m by domain.
## Contour lines and isosurfaces in Results

Results ▸ Display draws two things:
- **Contour lines** on the surface and the slice: marching triangles in
  `contourSegments`, on the page.
- **Isosurfaces** through the volume: `isoTets` in the worker.

Both are at levels in the field's own units. They follow the step, the
component and the warp, and they have rows in the Visibility box.

- **An isosurface is a slice of a different function.** `sliceTets` computes
  signed distance to a plane and hands it to `cutTets`; `isoTets` hands it
  value minus level. Both answer the same edge interpolants, so positions,
  the warp and colours go through `interpolateOnSlice` unchanged. A tet
  touching a NaN node is left out.
- **Contour levels are round numbers strictly inside the step's range**
  (`contourLevels` via niceTicks). A value exactly on a level counts as above
  it, so a line through shared vertices is drawn once per triangle, not twice
  along the edge. Typed iso levels win; blank means a quarter, half and three
  quarters of the range.
- **Not on fringes.** A fringe already is a contour of range, and contouring a
  wrap draws every jump as a line.
- **In clip view both are cut by the surface's own clip plane.** Uncut, the
  isosurfaces floated outside the half taken away. The surface material
  carries a polygon offset so lines drawn on it are not buried.
- **Verified on Etna:**
  - contours at 10…80 m (11,208 vertices);
  - isosurfaces at 40 and 70 m (214,683 vertices), sampled vertices on their
    level to 1.3e-7 m;
  - one refresh in 0.14 s.

  The 20 and 50 m isosurfaces are broad bowls under the whole top, which is
  the same load-of-the-box shape the Mogi inversion reported.
## Ground tilt joins the derived field

The derived field is now "Stress, strain and tilt", with 19 components.
Components 16–18 are tilt east ∂u_z/∂x, tilt north ∂u_z/∂y and their
magnitude, in radians, which is what a volcano's tiltmeters record. They come
from the same per-tet gradient H = ∇u the strain uses (H[6], H[7]).
`DERIVED_DOFS` in gales-results.js is the one count the panel reads; a
hard-coded 16 used to sit in the field, its size and a pin.

- **A magnitude is the length of the averaged components, not an average of
  lengths.** Averaging each element's |∇u_z| to the node gave 3.2592e-4 rad
  at Etna node 25018; the length of the node's own tilt is 3.25887e-4. That
  is what numpy's volume-weighted gradient gives, to every printed digit:
  (1.5025e-4, 2.8918e-4) over 8 tets. The magnitude is computed after
  averaging. Von Mises and the principal stresses still average per element,
  which is the convention they were verified under.
- **Tilt and strain are independent readings.** A rigid rotation tilts the
  ground and strains nothing; the test pins both halves. A run without solid
  props still gets strain and tilt, and its label says "strain and tilt
  only".
## Parameter sweeps: written from Study, read back in Analysis

**Study ▸ Parameter sweep** varies one number, keeps everything else as set,
and writes one study per value. The parameter can be a domain's property or a
set condition's value, over a range (linear or log) or a typed list. Runs go
in `fem_runs/<base>_sweep_NN/`, with a manifest at
`fem_runs/<base>_sweep.json`. "Mesh, prepare and solve all" meshes the shared
geometry once, files the mesh into every run, and prepares and solves each in
turn. Locally it asks first. **Analysis ▸ Sweep response** reads each run's
last written step down to one number: the peak over the mesh, or the value at
the probed or a typed node. It plots that against the value, fits the slope
of log|reading| on log(value), and exports CSV. The report carries it.
`sweepParameters`/`sweepValues`/`sweepSetups`/`sweepManifest` (fem-setup.js)
and `stepReading`/`powerLawSlope` (gales-results.js) are the pure half.

- **The sweep writes through the ordinary `writeStudy`**, with the module's
  `setup` swapped for the run's copy and put back in a `finally`
  (`withSetup`). One writer, so a sweep run's spec, header, props and gmsh
  script are what a single study's would be. Verified: the page's pressure is
  still 1e7 after writing 5e6 / 1.25e7 / 2e7, and each run's header carries
  its own value.
- **A material value is an override** on the domain's assignment, so it
  reaches `domainProperties` and the generated props.txt (pinned).
- **The slope is a check as well as a sensitivity.** For linear elasticity
  displacement ∝ pressure (slope 1) and ∝ 1/E (slope −1). Verified on Etna
  results scaled per run: peak 85.41 m then 213.53 m, node 25018 u_z −80.658
  m, slope 1.0000000000000009; the unsolved third run is reported as "not
  solved", not dropped.
- **The node count comes from the run open in Results.** A step file's size
  cannot say how many dofs a node carries.
- **BYTES CAN COME FROM ANOTHER REALM.** `asBytes` used `instanceof
  Uint8Array` / `instanceof ArrayBuffer`. Bytes written by another document
  fail both, so the object was encoded as the TEXT "[object Uint8Array]" and
  failed as "Not a whole number of float64 values" on a perfectly whole file.
  It now tests `ArrayBuffer.isView` and the object tag, neither realm-bound,
  and a `node:vm` foreign-realm check pins it. Found by writing test results
  from the top document into the iframe's store, which a project adapter or a
  frame can equally do.
## Threshold: the cells in a range, or of chosen domains

Results ▸ Display ▸ View ▸ Threshold draws the closed skin of the cells
kept. A cell is kept when its value lies in a range (at every node, any node,
or on average) and/or it carries one of the ticked volume flags. It can be
coloured by the field or by volume flag, which is also how a model's domains
are shown on their own. `thresholdKeep`, `exposedFaces` and `keptTriangles`
are the pure half; the worker builds the skin because it holds the cells.

- **A subset's boundary is not a subset of the boundary.** `exposedTetFaces`
  became `exposedFaces(mesh, keep)`: faces seen once among the KEPT cells, so
  a domain carved out of the interior is drawn closed, including the faces it
  shared with its neighbours. Each face carries its owning cell, for flag
  colours.
- **The volume flags are counted at parse** (`volumeFlags` on the mesh), so the
  domain list and its counts exist before anything is thresholded. Etna:
  flag 0 1,290,687, flag 1 104,767, the domain statistics' own counts.
- **Verified on Etna:** flag 1 keeps 104,767 elements (207,600 faces, 0.15 s);
  |u| ≥ 50 m on every node keeps 281,664 elements, with 0 of the drawn
  vertices below 50 m (0.22 s). A blank bound is open, and the key ignores the
  field when only flags are used, so stepping does not rebuild a flag-only
  threshold.
## The Calculator: new fields from expressions, parsed, never eval'd

Results ▸ Calculator makes a field from an expression over the open fields,
for example `sqrt(ux^2 + uy^2)`, `(stress.sxx - stress.szz) / 1e6` or
`-z / 1000`. It joins the field list as `calc/<name>`, steps with the field it
was made on, reads each named field at the matching time, and works in every
view, analysis and export. `field-calculator.js` is the pure half (10
checks).

- **A parser, not eval.** A saved or shared expression is text somebody else
  may have written. It is tokenised, parsed by recursive descent and compiled
  to closures over typed arrays, and a pin asserts the panel has no
  `eval(`/`new Function(`. `^` is right-associative and binds tighter than
  unary minus (`-2^2` is −4). Errors name the place.
- **`in` READS THE PROTOTYPE.** `name in CONSTANTS` was true for
  `constructor` and `toString`, so those names resolved to Object's own
  functions rather than being refused, which a test caught. The function and
  constant tables are null-prototype and tested with `hasOwnProperty`; any
  lookup table keyed by user text needs the same.
- **Names:** each component is `<field alias>.<key>` (`u.ux`, `stress.vm`) and
  bare where the key is unique; `x`, `y`, `z`, `pi`, `e`. A field not yet read
  has no description and so no names, and the error says so.
- **Verified on Etna at node 25018:** sqrt(ux²+uy²) = 4.7946 m;
  (σxx − σzz)/1e6 = 15.314 MPa, against the numpy stresses to 1e-9; an
  unknown name refused with its reason and the field list restored.
- **Every "not byte-read" test grows a clause per synthetic field kind**
  (`!f.derived && !f.compare && !f.calc`). Two pins matched the exact
  condition and were loosened to `(?: && !f\.\w+)*`; their intent holds.
## Spreadsheet, screenshot and animation

**Analysis ▸ Spreadsheet** shows the field in Results as a table of nodes:
node, x, y, z, node flag, every component and the vector's length. It sorts
by any column, with NaN always last whichever way, pages 25–200 rows, can be
limited to surface nodes, and exports every row in the order shown. A row
click probes that node through `GeoIDGalesResults.probeNode`. The values are
the solver's own at the nodes. Etna: 251,147 rows in 35 ms, and |u|
descending puts node 8292 (85.4122 m) first, the known peak.

**Analysis ▸ Screenshot and animation** composes the view with a footer
carrying the field, the time and the colour bar, since the page's legend is
an overlay no canvas capture holds. It exports a PNG, or a WebM (VP9 where
supported) that either steps through every step or turns once round the
model.

- **Frames are pushed by hand**: `captureStream(0)` and `requestFrame()`
  after each composed render. A slow step read therefore does not drop or
  stretch frames, and the clip holds exactly the frames drawn. Verified: 2
  steps × 0.5 s × 24 fps = 24 frames, decoding to 1.15 s at 960 × 650.
- **The camera and the step are put back** in a `finally`. A turn left the
  camera position identical to 1e-6. A MediaRecorder WebM reports an Infinity
  duration until it is seeked to the end, so a check must seek before reading
  it.
- **The probe also picks the threshold skin now.** It was surface and slice
  only, so in threshold view nothing could be probed.
## Saved state: the page as it stands, applied to a run again later

Analysis ▸ State saves the Model page's post-processing as a JSON file (a
`.pvsm` in spirit): the Results display (field and step, component, colour map,
range, view and slice, warp, contours, isosurfaces, threshold, calculated
fields, probe and points, the satellite geometry), the camera, and every
analysis card's settings with a flag for which had a result. `model-state.js`
is the pure half (`makeState`, `readState`, `stateFileName`); Results exposes
`getState`/`applyState`, Analysis `currentState`/`saveState`/`loadState`.
Saved through the save gate, downloaded and filed into the open project's
`post_processing/`; loaded from a file or picked from that folder.

- **The data is not in it.** A state names the run it was saved on and is
  APPLIED to whatever run is open; what cannot be matched (a field the run does
  not hold, a step time it lacks, a different node count) is listed in the
  status rather than guessed. A reference run is not saved, so a `compare/`
  field needs its reference opened first, and the note says so.
- **Fields are restored by NAME, never by index** — the field list is rebuilt
  from what the run holds plus the saved calculated fields (`classifyFields`
  after restoring `S.calcs`), so an index from another session points at
  another field.
- **Analyses are re-run, not deserialised**: a profile, statistics, the
  observation fit, the Mogi comparison or inversion, the spreadsheet and the
  sweep reading are recomputed from their saved inputs in the page's own order,
  so a state cannot carry a number the current run would not produce.
- **The State card exists only while a run is open**, because loading one means
  applying it to a run.

Verified on Etna: a calculated field (`sqrt(ux^2+uy^2)`), Viridis, a y = 0.4
slice, contours and a plotted profile saved, the page reset, and the state
loaded back with the field, view, colours, camera (to 1e-6) and profile all
restored and no notes; a JSON of the wrong kind refused by name; a state filed
into a memory project and offered back from "From project".
## Stream tracer: tangent curves of a vector field, traced through the tets

Analysis ▸ Stream tracer. `streamlines` and `streamSeeds` in gales-results.js
are the pure half (a uniform field traces a straight line, a rotation its circle
to 1e-8, a seed outside is counted, a zero field stalls); the reader worker's
`stream` request runs it, because the element search needs the cells.

- **RK4 on the UNIT field**, dx/ds = v/|v|, with the field interpolated in each
  element barycentrically (the profile's own path). A step is therefore a length
  in space (the diagonal over "steps per diagonal"), and a line's shape does not
  depend on the field's size. It stops where it leaves the mesh, where |v| falls
  below 1e-6 of the largest nodal magnitude, at the length asked or the steps.
- **Both ways from a seed is one polyline**: the backward half reversed onto the
  forward, the seed once.
- **Seeds** along the Plot-over-line line, or in a sphere (a Fibonacci set
  uniform in volume) about the probed node, else the mesh's centre.
- **The field is looked up at every RK4 stage** — the locator's bucket search,
  so a line is about four locates a step; the end point's lookup is carried into
  the next step's first stage.
- **Drawn through the UNDEFORMED mesh**, depth-test off, coloured by |v| on the
  Results colour map; re-traced when the step, field or seeds change; saved in a
  page state; CSV of line, point, arc length, x, y, z, magnitude.

Verified on Etna, u at t=1: 40 seeds in a 22.7 km sphere about the centre give
39 lines (one seed sits in the chamber cavity) of 5,284 points in 0.84 s, all
leaving through the top; at eight lines' midpoints the segment direction against
the element-interpolated u has a worst |cos| of 0.99999999995.
## Temporal statistics: a run's steps summarised per node, as a field

Results ▸ Temporal statistics adds `temporal/<field>:<component>` — each node's
minimum, maximum, mean and standard deviation over every step of the field and
component shown, with the time of the minimum and of the maximum (ParaView's
Temporal Statistics). `temporalAccumulator` in gales-results.js is the pure half.

- **One step at a time.** The accumulator takes a scalar per step and keeps six
  running arrays, so a run of hundreds of 6 MB steps is never held at once; the
  summary's single step ("all N steps") is computed in `valuesAt` like the
  derived, difference and calculated kinds, and is never byte-read by the probe.
- **The mean is over STEPS**, each written step counted once, not weighted by
  the time between steps — as ParaView's filter does, and the note says so.
- **A tie keeps the earliest time.** A NaN at a node is skipped there; a node
  NaN at every step stays NaN.
- **Not fed to the Calculator** (a summary of a calculated field is allowed; a
  calculation over a summary would step with nothing), and kept in a saved state.

Verified on Etna, u_z at node 25018 (0 at t=0, −80.658 m at t=1): min −80.658
at t=1, max 0 at t=0, mean −40.329, std 40.329; both steps read in 30 ms.
## Selection: a box over the view, and what the field does there

Analysis ▸ Selection. "Select in a box" arms a rectangle drag on the studio's
canvas; the release selects the nodes whose DRAWN position (the frame's world
matrix, the warp if one is on) projects inside it and in front of the camera —
the surface nodes in the box, front and back, or every node through the volume
(ParaView's frustum selection). `selectInRect` and `selectionSummary` in
gales-results.js are the pure half.

- **The gesture owns the canvas while armed**: OrbitControls is disabled for the
  drag and restored on release or Escape, and the click the release produces is
  swallowed once in capture, or the studio's own picker takes it.
- **Read back**: count, min, max and mean of the Results scalar over the
  selection (the LOS, not the wrap, for fringes); "Over time" reads every step
  into a mean line and min–max band; CSV of the selected nodes' values (plus the
  series); the Spreadsheet can keep only the selected nodes. The selection is
  re-summarised when the step or field changes.
- **The highlight is thin on purpose** (2 px at 0.45): thousands of selected
  nodes at 4 px drew one solid slab over the very values being selected.

Verified on Etna: a centre box of ±0.1 in NDC selected 2,001 surface nodes, the
same count three.js's own `Vector3.project` gives; over time the mean |u| went
0 → 15.94 m; a real mouse drag over the summit selected 17,683 nodes in 14 ms,
mean 76.1 m, with the orbit restored afterwards.
## Results opens VTK: ParaView's own .vtu, .pvd and legacy .vtk, from any solver

Every Results door (Open simulation folder, Open mesh file, a drop, the
`openFolder` seam) now takes XML UnstructuredGrid `.vtu` files, one or a series,
with or without a `.pvd`. `vtk-read.js` is the reader (pure, 16 checks against
files python-vtk 9.2 wrote in all six encodings, kept in `fixtures/vtk/`); the
reader worker builds the mesh from the first file; the panel's `vtkSource`
presents the series as a run, so every view, filter, analysis and export works
on it unchanged.

- **Every encoding VTK writes**: ascii; inline base64 ("binary"); appended raw
  or base64; uncompressed or zlib (`DecompressionStream("deflate")`, block by
  block); UInt32 or UInt64 headers. No DOMParser (a worker has none): the head
  is scanned up to `<AppendedData>` and the appended bytes read in place.
- **A compressed array's header and data are SEPARATE base64 streams**
  (`…==eF5…`). The header chunk's own padding says which; where the header is a
  multiple of three bytes the two encodings coincide. And an inline DataArray can
  carry `<InformationKey>` children after its data — its text stops at the first
  `<`. Both are in the real writer's output and both broke a naive reader.
- **Cells are reduced to linear simplices on their corner nodes**: a hex (and a
  voxel, re-ordered) to 6 tets along its 0–6 diagonal, a wedge to 3, a pyramid to
  2, quadratic cells to their corners; quads and polygons to triangles; 2D cells
  in a 3D grid become flagged sides; lines and vertices are skipped and counted.
  The status line says what was reduced. The 0–6 split is conforming on a
  consistently ordered structured grid; an arbitrary hex mesh can leave hairline
  cracks on a slice where neighbours split a shared face differently.
- **Domains** come from a cell array named like a flag (gmsh:physical, material,
  MaterialIds, region, block_id…), else the first integer cell array, else 0.
- **Fields**: each point array is a field, each file a step (a `.pvd`'s
  timesteps, else the number in the file name, else file order), decoded from its
  own `.vtu` when read and cached six deep. A 3-component array named like a
  displacement is read as `<name>/u` (magnitude, warp, derived strain), a
  velocity as `<name>/v`; a single-component array is labelled by its own name.
- **Refused by name**: PolyData and other dataset types, multi-piece files
  (Merge Blocks in ParaView first), big-endian files, LZ4 and LZMA compression.
  Cell data other than the flag array is not shown.

Verified live with the fixtures' `.pvd` series (12 hexes, two steps): 36 nodes,
72 tets, 64 boundary triangles (the block's 32 quad faces), domains 1 and 2 from
"material"; displacement at node 17 read 0.2, 0, −0.2 at t = 2.5 (twice t = 0);
the derived strain read ε_xx 0.01 and ε_zz −0.02 at every node; domain
statistics of temperature gave 3,000 m³ each at means 302.5 and 307.5.

**Legacy `.vtk` too** (`readLegacyVtk`): UNSTRUCTURED_GRID in ASCII or BINARY —
and legacy binary is BIG-endian, unlike the XML files — in the 4.2 cell layout
(a count before each cell's ids) or 5.1's OFFSETS (n + 1 START offsets, turned
into VTU-style end offsets) and CONNECTIVITY; point and cell data from SCALARS
(with its LOOKUP_TABLE line), VECTORS, NORMALS, TENSORS and FIELD blocks, which
is what vtkUnstructuredGridWriter writes for arrays that are not the active
scalars. LOOKUP_TABLE, COLOR_SCALARS, TEXTURE_COORDINATES and METADATA are read
past. Verified against python-vtk's own ASCII 5.1, ASCII 4.2 and binary files:
the binary file's cells equal the XML file's node for node, and it opens in
Results with the same displacement at node 17.
## Gradient: ∇ of any field, as a field

Results ▸ Gradient adds `gradient/<field>:<component>` — ∂/∂x, ∂/∂y, ∂/∂z and
|∇| of the field and component shown, at every one of its steps (ParaView's
Gradient filter). `nodalGradient` in strain-stress.js is the pure half (a linear
scalar exact at every node in 3D; a 2D triangle mesh giving ∂z = 0; a cell with a
NaN node left out); the reader worker's `gradient` request runs it.

- **Per element, volume- (area-) weighted to the nodes, the magnitude after
  averaging** — the tilt's rule, for the same reason.
- **It is a vector field** (`desc.vector` over its three components), so the
  glyphs draw its arrows and the stream tracer its lines: a temperature's
  gradient lines are the heat-flux paths reversed.
- Not offered of a gradient or a temporal summary; kept in a saved state; never
  byte-read by the probe or the station extraction.

Verified on the VTK fixture series: ∇(300 + z) read (0, 0, 1) with |∇| 1 at all
36 nodes, and ∂u_x/∂x of the displacement at t = 2.5 read 0.02 (to 2e-9, the
float32 of the display path).
## Warp by scalar: a 2D result read as a surface

Results ▸ Deformed shape, on a 2D mesh, offers "Warp by the field shown": each
node lifted along z by the shown component (the LOS for fringes, never the
wrap) times a height scale, added to any warp by displacement; "Auto height"
draws the largest value as a fifth of the model. 2D only: in a volume the lift
has no direction that is not an invention. Kept in a saved state. Verified on
`fixtures/vtk/plane2d.vtu` (a 21 × 11 quad grid, head 0–30 m): at ×10 the drawn
surface rises to exactly 300 m.
## Reflect: the symmetric whole of a half or quarter model

Results ▸ Display ▸ Reflect about: each axis off, or mirrored about its minimum,
maximum or 0; the copies are every combination of the mirrored axes (one for a
half model, three for a quarter). `reflectionMatrices` and `reflectedBounds` in
gales-results.js are the pure half.

- **A mirror is a LINKED copy, not a copy.** Each part (surface, slice, edges,
  contours, isosurfaces, threshold) is copied with its geometry and material
  SHARED, so a step's new colours and positions appear in the mirror with no
  work, and its `visible` is a getter onto the part it copies, so the display
  choice and the Visibility box govern both. Copies are rebuilt after each
  refresh, because contours, isosurfaces and the threshold skin are new meshes
  every step. three.js flips the winding of a negative-determinant matrix
  itself.
- **It is a picture, and it says so**: colours are copied, so a vector component
  normal to the mirror plane shows its own sign rather than the flipped sign the
  symmetric field has; probes, analyses and exports read the solved half. A clip
  plane is not mirrored. The studio's ground hole and camera floor take the
  grown box.

Verified on Etna mirrored about x = max: one copy beside the model sharing the
surface's geometry, the slice copy following a change of view.
## A second view: another field, the camera linked

Results ▸ Display ▸ "Open a second view" floats a viewport (draggable, resizable)
showing a field and component of its own on the SAME geometry, with its camera
copied from the main one every frame — ParaView's split view with linked
cameras. `results-second-view.js`.

- **Its own renderer and scene, the main view's buffers.** Its surface and slice
  meshes share the main meshes' position, index and normal attributes (re-linked
  whenever the main view replaces one), so the warp, the slice and each step's
  geometry need no work; only the colour buffers are its own, painted from its
  field at the main view's time on the Results colour map with a range of its
  own. The two WebGL contexts each upload the shared buffers once.
- **Repainted on `geoid-gales:refreshed`**, which the panel dispatches at the end
  of every refresh. The panel's `scalarFor(values, desc, component)` takes the
  component from the caller, where `scalar` reads the panel's own.
- **Same camera, not the same framing**: the viewport's aspect is its own, so a
  narrower window shows more around the model.
- Surface and slice only: contours, isosurfaces, the threshold skin and glyphs
  stay in the main view, and fringes are not offered. Kept in a saved state.

Verified on Etna: |u| in the main view, von Mises in the second (0 to 256 MPa,
the derived field's known range), the second view's position buffer the main
surface's own object.
## The Model page opens on a launchpad, not on an empty grid

`gis/studio-launchpad.js` draws a card over the viewport while the studio holds
no solid and Results no run: four doors (start from the GIS page, build a shape,
open a results folder, open result files), the Etna example where the gitignored
GALES tree answers a HEAD, the open project's runs (▶ solved, ○ to prepare) and
saved states, and a GIS → Model → Research strip whose three steps go there.
**Every door is a door that exists elsewhere** — `setMode`, `showGroup`,
`openFolder`, `openProjectRun` — and the test pins that it parses, fetches and
builds nothing itself. It goes the moment a solid or a run arrives (polled at
1.5 s and on `geoid-gales:refreshed`), and ✕ stands it down for the session.
Placed in the room right of the 24rem deck, centred there, never over it
(measured: 492 px against the deck's 400 on a 1,273 px viewport).
## The results toolbar: field, component, time and colour in the ribbon's second row

`gis/results-toolbar.js` puts the things changed a hundred times a session —
the field, the component drawn, the transport and step slider with its readout,
the colour map, reverse, and auto-range — in a row under the ribbon while a run
is open (ParaView's arrangement). It is a SECOND FACE of the panel's "Field and
time" and "Colour map" sections, not a second implementation: every control
writes `GeoIDGalesResults.state` and calls the panel's own `refresh`, and the
panel re-renders its sections through `renderControls`, so the two cannot
disagree; the bar is rebuilt only when what its selects list changes and
otherwise synced in place on `geoid-gales:refreshed`. Keys while a run is open
and nothing is being typed: `.`/`→` next step, `,`/`←` previous, Home/End,
space plays. The topbar wraps and the bar takes a full-width basis, or it lands
beside the ribbon and squeezes both.
## The Visibility box is the page's pipeline browser

A provider's group and parts may carry `onSettings` (and a `settingsTitle`), and
the Visibility box draws a ⚙ on that row which opens what made the thing — the
results parts open their Display or Points section, the group its Field and
time, and a new "Analysis overlays" group (registered by the analysis panel)
lists the vector arrows, stream lines, the selection and the second view, each
with an eye on its own mesh and a gear that opens its card. So everything drawn
is one list, ParaView's pipeline browser, with the controls one press away. The
second view's "mesh" is a proxy whose `visible` opens and closes the window. The
overlay group is redrawn when an overlay comes or goes (a 0.8 s key), never per
frame. Verified live: two groups, four overlay rows, six gears; the eye hid the
arrows' mesh; the stream-lines gear opened Analysis on the Stream tracer card.
## The hand-off to Research is visible, and the pipeline strip has both ends

Analysis opens on a **Hand-off to Research** card: what the open project holds
for the Research pages, counted from its folders — series in
`post_processing/extracted_dofs/`, tables in `exports/` (every CSV a card
writes goes there through `downloadText`), figures, reports and saved states —
and a door per page (Signal, Spectral, Statistics, Plotter, Figures) that sets
the research mode and `GeoIDResearch.setPage(id)` a beat later. Screenshots are
now FILED into `figures/` and registered (kind `figure`) as well as downloaded,
so the Storyboard and the Figure Composer read them. With no project open the
card says where things go instead. The pipeline strip reads GIS ▸ Geometry …
Results ▸ Research, the two ends being doors to the other pages (`go` on a
step), and Research lights on anything filed (`handoffFiled`, polled with the
rest). Geometry is no longer red on a page holding only a run somebody opened
to read. Verified live in a memory project: one screenshot → figures 1 on the
card and the Research dot lit on the next poll; the Signal door landed on the
hub's Signal Processing page.
## Help, provenance and the tabs' names

- **`?` in the ribbon** (`gis/studio-help.js`) opens one overlay: the journey
  from the GIS page to the Research hub as ten steps each with a "show me" that
  opens the real door (a mode, a workspace tab, the start page), the mouse and
  the keys, and where things are filed. It reads the page's seams for its
  doors, so it cannot describe a page that is not there — the lesson the
  viewer's own ⓘ modal paid for. `?` toggles it, Escape closes it.
- **The Geometry tab shows a GIS terrain's provenance** (`renderProvenanceCard`,
  drawn from `renderDomainsPanel` so it follows every adopt and clear): origin,
  footprint, nodes and triangles, the sampling range and levels, the relief,
  DEM holes repaired, what was extended below and above, layers, points, and
  the terrain's OWN flags (not the twenty defaults the studio knows), with the
  way back to the Model Builder. Verified through the builder's own controls:
  a 6 km box on the Mournes → 14,641 nodes at 50 m, 845 m of relief, 5 km below.
- **The deck's tabs are named for what they hold**: Geometry, Domains and faces,
  Labels, Study and solve, Structured mesh, Refinement (ids unchanged; both
  index.html and gis/shell.html, pinned equal by the test).
## The command palette: find a control by name

`gis/studio-palette.js` — Ctrl/⌘-K, or ⌕ in the ribbon — opens a box that finds
anything on the Model page and goes there: the ribbon's menu actions and view
buttons, the deck's tabs, the Results panel's sections, the Analysis cards, the
display views and the analyses' own verbs by seam, the other pages, the help
and the start page. The list is GATHERED FROM THE PAGE WHEN THE BOX OPENS (the
buttons and sections that exist), so a control added anywhere is found without
being registered, and nothing here can name a control that is not there. Every
word of the query must match; a label hit outranks a keyword hit and a shorter
label wins a tie (`search` is pure and pinned). Enter runs the highlighted
entry: a button is clicked, a section or card is opened in its tab and scrolled
to. The box swallows its own keys, or the studio's Delete and the toolbar's
`.`/`,` would fire while typing.
## Right-click on a result, drop a run anywhere, and the view by key

- **Right-click on a result's surface, slice or threshold skin** opens a menu of
  the panel's own verbs AT THE POINT: probe the node, slice through here with a
  normal on each axis (the slider position set from the picked point), clip
  through here, start or end the profile line here, seed stream lines here (a
  sphere about the node), add the node as a station, select in a box. `hitAt`
  is the probe's pick factored out (node, the point in the mesh's frame, the
  object). The studio's own menu for its solids runs first and preventDefaults
  when it takes a click, so a right-click on a terrain solid is left to it.
- **A run dropped anywhere on the Model page** — a GALES folder, a mesh, VTK
  files — opens in Results, with the whole viewport saying so while the drag
  is over it; the Results tab's own drop zone is unchanged.
- **The view by key** (results-toolbar.js, on the Model page whatever is open,
  never with a modifier): F fit, X Y Z I the axis views, G W E the grid,
  wireframe and edges toggles — each pressing the ribbon's own button.
Verified live: a synthetic right-click on Etna's summit listed ten verbs,
"Slice here, normal y" set the slice view at the picked y (0.589), "Add as a
station" kept the node under the pixel (25,502), X moved the camera, and a
`plane2d.vtu` dropped on the page replaced the run. **Probing a drawn surface
in a test**: read the node's position off the surface geometry's own buffer
(the surface is auto-warped, ×88 on Etna, so the undeformed coordinate
projects kilometres off the picture), refresh `camera.matrixWorldInverse` by
hand (the pane's throttled loop leaves it stale mid-flight), wait for a view
flight to settle, and remember `new Vector3(undefined)` is the ORIGIN — a
node id that is not on the surface projects silently to (0, 0, 0).
## Toasts: what just happened, where the eye is

The studio's `log`, the Results panel's `status` and the Study panel's `say`
each also dispatch `geoid-studio:notice` (their own readouts unchanged), and
`gis/studio-toast.js` shows the last few at the foot of the viewport, centred
in the room right of the deck (clear of the Visibility box): ONE toast per
source, replaced in place (a progress line does not stack forty cards), at most
four, a few seconds for news and longer for an error, a click to dismiss.
`worthAToast` decides what is news (progress, a change with a number or a verb,
every error) against what is furniture. Animated by a class on the next frame,
because a `@keyframes` rule cannot carry the stylesheet's `#model-studio` scope
and fails the pin.
## The first solve from Study to Results, and the four things standing in its way

A 1 m box, 144 nodes, granite, base fixed, 1 MPa on the top, one rank — run
through the page's own buttons (Write study → Mesh with gmsh → Prepare deck →
Solve → Results opened itself). It reads u_z = −1.963e-5 m at the top against
the free-column −2.0e-5 m; the container solve takes 15 s. None of the four
faults below was visible to a unit test, because each is about a process the
page hands off to.

- **A prepare's build failure was reported as "Prepare: done."** The build is
  non-fatal by design (a deck bound for a server need not build here), so its
  failure was only in the streamed log, and `waitFor` read `snap.output ||
  snap.log`, neither of which a job snapshot carries. The snapshot has a
  `tail` now (its last three lines) and the Study tab prints it.
- **This host cannot LINK against GALES's Trilinos.** The compile succeeds; the
  link fails on `__isoc23_*@GLIBC_2.38` and `GLIBCXX_3.4.32`: the tpl was built
  inside `atlas-build-mesh` (Debian 13, glibc 2.41, GCC 14) and the host is
  Ubuntu 22.04. So the sidecar has a third compute target, `docker` — the ssh
  target's own "build where it runs", with the run folder and the GALES tree
  mounted AT THEIR OWN PATHS (the run's absolute `GALES_SRC` link and the
  cmake hints then mean the same thing inside), the host's CMake cache dropped
  first, `chown` back to the caller on exit, and OpenMPI told it may run as
  root. `_start_gales` also resolved the command from the run folder BEFORE
  looking at the target and refused a remote run for having no local
  executable — which made every remote solve of a run that could not build
  locally impossible, ssh included. And GALES links Trilinos SHARED with no
  rpath: `_gales_env()` puts `tpl/tpl/*/lib` on `LD_LIBRARY_PATH` for local
  and container runs alike (measured: built, then exit 127 on `libmuelu.so.14`).
- **SIDE FLAG 1 IS GALES'S FLUID–SOLID INTERFACE.** `solid_es`, `solid_ed` and
  `thermoelasticity` all do `if(side_flag==1) ic_bc_.get_fluid_tr(...)` for
  every boundary side carrying it; the base `ic_bc` leaves the traction empty
  and the element loop indexes it — a segfault in `solid::execute` at the first
  step, on 1 rank and on 2. Etna's own mesh has no side flagged 1 (its free
  surface is untagged; 61,094 at 4, 41,980 at 5). Every default that put a
  face on 1 moved to **3** (`DEFAULT_FACE_FLAGS.top`, `DEFAULT_FLAGS.top` and
  `.terrain`, the section's profile, `LAYER_FLAGS.top`, with the water's sides
  moved 3 → 14), and `checkSetup` refuses a solid study whose model carries a
  face on 1, naming the face and the reason.
- **The Study tab's target list read `Object.values` of a NAME-keyed map**, so
  every server was offered as "[object Object]". The name is the key.

Traps in driving it: `kill` on the `nohup … &` PID kills the wrapper shell and
leaves the python serving the OLD code (the new one dies on "address already in
use") — `pgrep -f` the python and kill that; a module edited under the same
`?v=` is served from the browser's cache until `fetch(url, {cache: "reload"})`
refreshes it; and the run's `execute` frame was named by `addr2line -f -C -e
executable <offset>` on the host, which needs no debugger and no `-g`.
## The first transient, Study to Research: heat conduction, and what stood in its way

A 1 m granite box, top held at 100, base at 0, ten BDF1 steps of 20,000 s
(α = κ/ρc = 1.39e-6 m²/s, so L²/α ≈ 7e5 s), run through the page's own
buttons on the container target and read against the analytic slab series:
at t = 200,000 s the mesh gives 22.06 / 45.86 / 71.99 at z = 0.25 / 0.5 / 0.75
against 22.08 / 45.87 / 72.08; the first step is 2–3 °C high, which is
implicit Euler's own first-step error at that Δt and decays as it should.
`solid_es` is elastostatic — its time loop is pseudo-time — so heat is the
honest transient here. Then two points extracted to
`post_processing/extracted_dofs/` (node 134's series equal to the solver's
bytes to the last digit), found by the Research hub's `findTables`, offered by
the CSV Plotter's Browse, plotted, filed into `figures/`; the pipeline strip
lit Results and Research. Five faults on the way, none reachable by a unit
test:

- **`sim/heat_equation/test_3d` is stale against its own tree.** Its
  `main.cpp` includes `src/solvers/heat_equation/solver.hpp`, which is
  `heat_conduction/` now; prepare maps the include onto the directory that
  exists (`SOLVER_DIR_RENAMES`). And the current solver passes its Neumann
  functions NODE POINTERS (`vector<shared_ptr<node<dim>>>`) where the
  reference header takes `vector<int>` — the base `ic_bc` declares both, and
  a derived class declaring one HIDES the other. The generated header now
  emits both overloads for every Neumann function, all physics.
- **Heat conduction reserves side flag 1 too** (`get_fluid_heat_flux`), so
  the checklist rule covers solid and heat; the fluid solver has no such branch.
- **`element<3>::compute_min_h` measured a tetrahedron's edges in x and y
  only.** A tet with a vertical edge — sixteen of them in a 1 m box — got
  h = 0, `1/alpha` was infinite and the GLS `csi` was inf − inf: Belos aborted
  with "NaN has been detected" at the first solve, on 1 rank and on 2, with
  `n_max_it 1` and with CG — every solver setting was innocent. The fix is in
  the local GALES source and kept as
  `sidecar/patches/gales-element-min_h-3d.patch`, because the tree is
  gitignored; the same element serves thermoelasticity. Found by
  `addr2line`-free reasoning: read the assembly for a division, then count
  the mesh's vertical edges.
- **The hub closed the Model page's project the moment the hand-off reached
  Research.** Its install re-probes the sidecar and swapped the sidecar
  adapter in again; `useAdapter` closes the open project (a project is a
  folder on the old filesystem). It asks `adapterKind()` first now and, when
  it does switch, reopens the project it had.
- **A run opened from a project lost its field descriptions on every rebuild
  of the field list.** The sidecar adapter's listing dropped each entry's
  size, a field's dofs per node come from its step sizes, and
  `classifyFields` rebuilds from the plan — so a temporal summary answered
  "no such component" over a field the view was drawing. The size travels
  through the adapter, `projectSource` carries it, and a read writes it back
  onto the plan's step.

Two traps in driving it: clicking the rail's "Plotter" TAB while looking for
the page's "Plot Selected" BUTTON remounts the page and empties its dataset
row (search buttons inside `.research-page`); and `R.values()` on the seam is
not the per-node array — read a value through the probe or the legend range.
## The first fluid solve: a duct at Re 10, and what the fluid family needed

Water (μ raised to 1 Pa·s) through the 1 m box: inlet v_z = 0.01 m/s on the
base, p = 0 on the top, no-slip sides, ten BDF1 steps of 0.05 s on the
container target through the page's own buttons. Mass balance holds — the
outlet's mean v_z is 0.0102 → 0.0097 against the inlet's 0.0100 from the
second step on, its interior 0.0122 (a developing profile) — and the inlet
pressure rings down from the acoustic start (160 Pa) to 12 Pa. Not a
validation of the flow on 144 nodes; a proof that the family runs and
conserves. Four things it needed:

- **A 3D spec clones the 3D reference.** The sidecar's fluid family was the
  2D cylinder (`fixed_cylinder_2d`: a header knowing only the 2D stresses,
  MueLu and its XML); `GALES_FAMILIES_3D` points a `dim: 3` spec at
  `pipe_flow_3d` (current header, ILU).
- **β = 0 IS AN INFINITE SOUND SPEED.** GALES's fluid is weakly compressible
  (c = 1/√(ρβ)); the page's props wrote rho and mu only, the reader defaults
  the rest to 0, and the first solve was NaN in Belos. Every fluid material
  carries `alpha` and `beta` now (water's handbook values, the ideal gas's for
  air, silicate-melt values for the magmas), the props text writes cp, kappa,
  alpha and beta, and the checklist requires them.
- **Δt is bounded by the acoustics, not the flow.** At Δt = 50 s (7×10⁴
  sound transits of the box) the speeds grew 92 → 14,511 → 5×10¹² and the
  sixth step was NaN; at 0.05 s (≈ 75 transits, the reference's own order)
  it is stable. The page does not yet warn about this; the note is here.
- **`steady_state T` in the cloned deck drops the time term from the
  stabilisation.** With it the transient's outflow crawled (0.0009 after ten
  steps); prepare patches it F for a study of more than one step, T otherwise
  (`_steady_state_flag`), only where the key exists.

And **a re-solve starts from a clean `results/`**: GALES writes a file per
step and removes none, so a shorter re-run left the exploded attempt's later
steps beside the new ones — the Results page showed 16 steps with a range of
5×10¹². What was there is moved to `results_<time>/`, never deleted, and
`status.json` names it.
## The first sweep, Study to Analysis: three pressures, one slope, and a Blob

A parameter sweep run through the page's own button ("Mesh, prepare and
solve all"): the 144-node granite box, base fixed, the top's pressure varied
over 0.5, 1 and 2 MPa, one rank on the container target. The geometry was
meshed once and filed into each run, each run prepared and solved in turn
(33–34 s each), and Analysis ▸ Sweep response read the three back: peak |u|
9.987e-6, 1.997e-5 and 3.995e-5 m, **slope 1.0000, R² 1.0000** — linear
elasticity holding on real solves, where the same card had only ever been
checked against scaled copies of Etna's result.

**The sweep reader could not read the sidecar's runs.** "Not a whole number
of float64 values" over a whole 3,456-byte step: `readProjectFileBytes`
returned whatever the adapter answered, and the four adapters answer four
shapes — the sidecar a Blob, the disk a buffer, memory a Uint8Array, a
fallback a string. The Results reader had grown its own `asArrayBuffer` and
so never noticed; the sweep reader handed the Blob straight to a float64
view. `toBytes` in the store is the one conversion now, by tag and shape
(never `instanceof`, the foreign-realm lesson), and every adapter's answer
is a Uint8Array to its callers — pinned against a Blob, a buffer, a string
and a DataView's own window.

Two cosmetic things noticed and left: while a sweep is being written, the
Study tab's preview line reads `sweep_sweep_0_sweep_0 … 2`, because
`withSetup` swaps the page's setup for the run's and a `say` mid-write
re-renders against it — it reads right again the moment the sweep finishes;
and the pipeline strip's Mesh dot stays unlit through a sweep, since the
solver mesh is meshed and filed by the sweep without being opened in the
Mesh tab.
## The GALES contract, and the terrain and section solved through the page

"Confer with the Atlas AI to ensure the GALES code is flexible and its
requirements are well defined within the model pipeline in the GUI." The
Atlas brain held no lesson on GALES at all (`brain_search` empty); what
Atlas holds is its **solver index** (`GeoID_Research/metadata/
solver_index.json`, scanned from `src/solvers`: dofs, boundary-condition
markers, setup keys, mesh keys, coupling per family) and the architecture
note beside it. `gis/gales-contract.js` carries that scan for the six
families this page could offer — solid_es, heat_conduction, fluid_sc,
thermoelasticity, solid_ed, fsi — plus what only a solve could teach:
which side flag is reserved, which property is a NaN at the reader's 0
default, what bounds the time step, which reference sim is cloned per
dimension. The checklist reads its reserved flags from it, the Study tab
draws "What GALES needs" from it, the sidecar's family table is pinned to
it, and its test checks it against the GALES tree whenever the tree is
beside the site (solver dirs, reference sims, setup.txt mesh keys, the
`side_flag == 1` coupling branches, and that no reference header declares a
Neumann function the contract does not list).

- **`sim/solid_es/mogi_test_2d` cannot be cloned**: it holds an ic_bc.txt
  and no main.cpp. A 2D solid study clones the 3D reference patched to
  `dim 2`; the page's header and props.txt (plane strain) replace the
  reference's. The contract says so rather than naming a sim that would
  fail at prepare.
- **A reference header declares only what its dimension calls** (a 2D deck
  has no tau13, an isothermal fluid no q1), so the engine check runs the
  other way: nothing a reference declares is outside the contract's list.
- **Three families are described and not offered**, each with the reason on
  the card: thermoelasticity needs two conditions per face; solid_ed needs
  rho_inf/constant_v/zero_a and the damping pair the page does not ask for;
  FSI needs two meshes on one interface.

**The first GIS terrain solved.** A 4 × 4 km box over Slieve Donard, DEM at
400 m posts (121 surface nodes), 2 km of rock below, packaged by the Model
Builder, opened in the studio, granite, base fixed, self-weight: gmsh made
207 nodes / 1,062 tets from the package's own script, the container target
solved it in 35 s, and the summit settled **1.33 m against a 1.65 m
uniaxial-column estimate** on a mesh three elements tall, base at zero, no
NaN. The Study tab meshes a terrain BY PATH now (`terrainName()` on the
studio seam → `meshes/<name>_gmsh.py`, run with the gmsh job's cwd in
meshes/ so the STL merges resolve); it used to say "put its .msh in the
run's input/" and stop.

**The first 2D section solved.** The same box as a west–east section, 40
samples over 3.5 km, 2 km of rock: 138 nodes / 316 triangles, plane strain,
base fixed, sides rollered, self-weight — **1.23 m at the crest against a
1.35 m uniaxial-strain column**, 34 s. Two things it needed: a section's
boundaries are its EDGES (profile, base, sides, sky), and `setupTargets`
listed only faces, so the base could not be given a condition — it lists
the edges from the section's own flags now; and the 2D deck is the 3D
reference patched, which worked without a 2D reference of its own.

**The Mesh dot lights for a run open in Results** (a sweep meshes and files
without opening the Mesh tab), and the sweep preview keeps the study's
name while the runs are being written.

**ssh is still untested**, and honestly cannot be from this machine: no key
of this user's is authorised on any host reachable from here (ssh to
localhost refuses publickey), and adding one is a security setting that is
not mine to change. The path is exercised up to the point of a real host —
rsync, the rebuilt command, BatchMode — by `tests/sidecar.py`; the first run
against a machine with a key is the remaining proof.

**Four ranks give the one-rank answer.** The section re-solved as `section4`
with ranks 4: prepare wrote `section4_4core.txt`, the container ran
`mpirun -n 4`, and the displacement field matched the one-rank run to
**6.9e-11 m** over all 138 nodes — the partition changes the work, not the
answer.

**The Mogi benchmark, through the page.** A 16 × 16 × 10 km granite box with
a 500 m sphere CUT at 2 km, 10 MPa on its wall, base fixed, sides and top
free; a ball size field of 300 m at the chamber, 2 km elsewhere: 1,098 nodes
/ 6,240 tets, solved in 33 s. The surface uplift has the point source's
shape and **0.61 of its amplitude** — a 500 m sphere meshed at 300 m is a
crude polyhedron, and its pressure work is under-resolved; a pipeline
proof, not a validation. The page's own card then recovered the GEOMETRY
from the FEM surface: Analysis ▸ Analytical source inverted the 70 surface
nodes to **2,010 m deep at (−16, −16) m** against the true 2,000 m at the
origin, 97.4% explained, with ΔV 1.29 × 10⁵ m³ against the nominal
1.96 × 10⁵ — the same 0.66 as the amplitude. `sim/solid_es/mogi_test_3d`
itself has no results and is not to be solved on this laptop.

Two things the cavity needed: **a cut tool's faces took the SIDES' flag** (5)
— measured, "surface: 5" on a sphere cut from a box — so a pressure meant
for a chamber wall would have landed on the box's sides too;
`DEFAULT_FACE_FLAGS.cavity` (7) is a cut's own default. And **nothing on the
page could make a cut a cavity**: `flags.void` was honoured by the gmsh
emitter (`removeTool`) and set only by a template. A cut's domain row now
carries a "cavity — no elements inside" tick, and `setVoid` is on the studio
seam. A Neumann condition reaches boundary sides only, so a pressure on a
KEPT chamber's wall — a face between two volumes — would act on nothing.
## Any layer onto the mesh, and faults into the rock: the pipeline audited end to end

Audited live on one study (Izmit–Sapanca, 46 × 21 km, 966 km²): GEE fetch →
layers → stations → Model Builder → package → Meshing Studio. Three defects
found by running it, each silent:

- **Earth Engine: a cached dataset was never rendered live.** A dataset with a
  shipped snapshot was excluded from the live list, so a chosen extent over
  CHIRPS draped the 39 km world PNG. `servedFromCache(select)` in `gee.js` is
  the one rule now: cached AND NOT (the live service offers it AND the extent
  is not global). Measured after: 45 m/px delivered over the study area.
- **`spec.geoid_model` had two `layers` keys.** The roles list overwrote the
  layered-volume record (an object literal keeps the last). The roles are
  `layer_roles`; `layers` is the volumes. Pinned in `fault-planes.test.mjs`
  — the pin must search from the provenance block's own start, because
  `indexOf("built_at:")` finds an earlier occurrence and reads an empty slice.
- **Fields and faults never reached the mesh.** Roles were recorded and nothing
  was sampled. Both are below.

### `layer-query.js`: one way to ask any layer for a value at a place

A layer's capabilities are `sampler`, `raster`, `collection`, or a tiled map's
`featuresIn`. `describeQuery(layer)` says which (`how`) and WHY in a sentence
the Layers step prints; `openReader(layer, bounds, { field, prefer })` answers
`read(lat, lon)` for all of them; `sampleAtNodes` writes **NaN, never zero**,
where there is no value.

- **A colour-only drape is refused by name** (`info.valueKind === "colour"`):
  the NASADEM render has no legend, so it is a picture, and the role select
  does not offer it as a value source.
- **A tiled map is asked about the GROUND** in `minX/maxX/minY/maxY`, and
  `close()` calls `restoreLive` — the borrow-and-give-back rule. Measured:
  the world geology holds the same 109 live features before and after a read.
- **Class ids are in NAME order over the box's features**, not read order, or
  the same unit gets a different id depending on where the first node fell.
  Classes are trimmed to those present on the nodes.
- **A palette-recovered value at the top of its ramp is counted**
  (`atRampTop`). A three-month CHIRPS sum saturated the 0–300 mm ramp (max
  exactly 300); the status line and the spec (`nodes_at_ramp_top`) say so. A
  one-month window read 68–105 mm with 0 nodes at the top.
- `samplerOver` moved here from `landslide-pipeline.js`, which re-exports it.

The Conditions step's "Read them onto the surface nodes" writes one
`<name>_field_<slug>.csv` per field-role layer (node, x, y, z, lat, lon, value
with the unit in the column name, class name quoted), and the spec gains
`boundary[] {surface: "top", type: "field", source}`, `initial.fields`,
`properties.regions` and `geoid_model.surface_fields`. The studio's terrain
card colours the surface by any of them (`colourSurfaceBy`, viridis for
numbers, golden-angle hues for classes, grey for no value; `tinValueAt` when
the display TIN is a stand-in).

### `fault-planes.js`: a trace becomes a surface embedded in the rock

A layer given the `fault` role (offered only where `hasLines`) has its traces
clipped to the box, simplified, and swept down-dip into a plane.

- **Defaults come from the catalogue where it has them**: `faultDefaultsFrom`
  reads GEM's `average_dip`, `dip_dir` and `lower_seis_depth` TUPLES
  ("(84,,)"). GEM gives no dip direction for these two faults, so the side
  defaulted to right of the trace (S) and the card says which parts came from
  the catalogue.
- **gmsh's embedded surfaces must not touch the boundary or each other.** The
  trace is pulled in by `max(25 m, size/4)`, the top sits `max(5 m, size/8)`
  below its ceiling, the depth is capped above the base, and `nonCrossing`
  (Möller–Trumbore both ways, bbox reject first) drops the shorter of any
  crossing pair and reports it.
- **With soil present the plane hangs from the BEDROCK surface** and is embedded
  in the bedrock volume only; embedded points go to the volume that contains
  them (`volumeOf`: above the bedrock surface → soil).
- **HXT ignores embedded surfaces**, so a script with faults sets
  `Algorithm3D = 1`. Every fault is a physical group `fault:<name>` with its
  own flag (30, 31, …), and its curves and points inherit it — GALES reads
  integer tags on every entity.
- In the studio a fault is a part (`kind: "fault"`, domain "Fault planes"),
  drawn x-ray (`depthTest: false`) so it reads through the rock, with a card
  (strike, dip, length, depth, area, editable flag → `setFaultFlag`).

Verified with gmsh 4.11.1 on the REAL Izmit bedrock volume, coarsened for the
laptop (MeshSizeMax 2000): 5.5 s, 1,640 nodes, 10,082 elements, 0 untagged
entities, `fault:ME_TRCS012` 744 triangles at flag 30, `fault:ME_TRCS009` 49 at
31, and the four bedrock stations exact nodes (0.000000 m).

**Thin layers were NOT meshed here, and that is a limit, not a pass.** The
water volume ran to 601,044 nodes and the 240 s timeout; the soil script asks
20 m elements over 966 km² (`thinLayerSizeM` = 20 × the tenth-percentile
thickness). Those are compute-target jobs, and the package now SAYS so before
anybody presses Mesh: `estimateElements` (layered-model.js) takes the larger of
two floors — volume / 0.1178 a³ (a regular tet), and 3 tets per top-surface
triangle, A / (0.433 a²) — because a thin layer cannot be counted by its
volume. Each volume's estimate is in the spec (`estimated_tets`,
`estimated_nodes`, `estimate_basis`, `run_on`: laptop / slow > 300k / compute
> 2M), in the build status line, and as comment lines heading its `_gmsh.py`.
A layer stops being a skin once its elements are as thin as it is (10 m of soil
at 10 m elements is counted by volume), which the test pins. An order of
magnitude: 6,150 against gmsh's 7,505 on the Izmit bedrock at 2 km.

### The clean run, on the committed stamp

Run twice through the page's own controls (the Browser pane and the headless
harness): 13,696 GEM faults loaded, 2 crossing the box; CHIRPS 2025-12 and SMAP
2025-05 live at 45 m/px; role gating per capability (faults → fault only,
stations → points only); surface 154 × 71 = 10,934 nodes at 300 m in 7 s, −0.8
to 1,579 m; layers read in 1 s (sea 188, lake 518, river 119 nodes, soil mean
12.1 m, Pelletier); ME_TRCS012 strike 90° dip 84° S, 45.9 km × 5,760 m;
fields in 1.7 s; 17 package files in 2.8 s; the studio shows 20 parts over
Bedrock, Soil and regolith, Water, Atmosphere, Surface, Fault planes and
Embedded points, with no page errors.

**Driving this from the Browser pane: every `javascript_tool` call has a ~45 s
window**, so a stage that waits (a GEE render, the fault load) is split into
"start it" and "poll it", with anything carried between calls stashed on the
iframe's `window`. And the page reopens in whatever mode it was left in —
set GIS mode before driving the sidebar.
