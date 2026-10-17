# Data and hosting: global data, live connectors, the R2 bucket, hotlinking, CORS

Working notes moved verbatim from GeoID_GIS/CLAUDE.md (2026-10-17), in their
original order. The index is GeoID_GIS/CLAUDE.md; ask the code graph first
(see there) and read the section here that it points you at.

## Real data — GEE cache and live connectors

**GEE loads from `assets/gee-cache/` first.** The page was hardwired to a live
credentialed endpoint that fails; nine rendered snapshots sat unused. `gee.js`
now reads the manifest and drapes the PNGs from disk (offline, no key), merging
the live service in when it answers. Two traps: (1) **`fetch` and TextureLoader
resolve against the document base, not the module** — the viewer index is one
dir up, so a document-relative `../assets/…` misses; anchor to `import.meta.url`
(`new URL("../assets/gee-cache/", import.meta.url)`), the way dynamic `import()`
already does. (2) A cache PNG can be a **saved error** — SMAP was 117 bytes of
JSON with a `.png` name, a failed snapshot written verbatim, which is exactly
why it read as broken. The manifest is validated by PNG magic bytes; keep only
real images.

**Live connectors are `connectors.js` + a `qt-runtime` module, not the
catalogue.** `ingest-catalogue.js` mirrors the desktop app, which only *links*
to portals — so the connectors (a web-only capability) are injected onto the
tree-rendered ingest pages by `ingestConnectors` in qt-runtime.js, a "Live
sources" card, exactly like the FEM Run wiring. Editing the catalogue does
nothing: those pages are tree-rendered and the catalogue edit is shadowed.
`connectors.js` holds the open, key-free, CORS-friendly sources — USGS
earthquakes (native GeoJSON) and NASA EONET volcanoes/wildfires — each a pure
URL builder + pure converter (unit-tested in `connectors.test.mjs`) with the one
impure `runConnector` on top. A pull files GeoJSON into `data/pulled/<slug>/`
with provenance (endpoint, query, timestamp, count), registers it **kind
`vector`** so it restores and shows on the globe, and appends `_lineage.json`.
`store.registerData` **flattens `extra` onto the record** (via `...entry.extra`),
so provenance fields end up top-level (`record.endpoint`, not
`record.extra.endpoint`). The connector uses the study area as its bbox when set
— so a project scoped to an ocean box correctly returns no earthquakes; test a
global pull with no study area.
## Global vector data, and world geology from tiles

Two routes, and which one a dataset takes is decided by its **licence**, not by
convenience. `gis/global-data.js` is the catalogue behind Data · Vectors &
Shapes:

- **Shipped** — Natural Earth is public domain, so coastlines, rivers, lakes,
  borders, countries and the geographic lines are converted once into
  `data/global/*.geojson` (ogr2ogr commands in `data/global/README.md`) and
  served with the site. 24 MB on disk, about 6 MB over the wire.
- **Fetched live** — plate boundaries (Bird 2003) and GEM's active faults are
  under their authors' terms, so they are pulled from their own sources with
  the credit shown. All the live sources answer `Access-Control-Allow-Origin: *`,
  which is the only reason a page can fetch them at all.

Everything goes in through the SAME `importFileList` a dropped file uses.
Measured: coastlines 4,133 lines / 813,648 GPU vertices in one draw object,
rivers 4,224, GEM faults 13,696, all under the 6M-vertex line cap.

**World geology is vector tiles, and that is not a shortcut.** There is no
global geological map you can download: the open compilations are hundreds of
megabytes, and Macrostrat's Burwell — the current global one — is published as
MVT. `gis/mvt.js` decodes that format (about 200 lines, no protobuf runtime,
`mvt.test.mjs` encodes tiles against the spec and decodes them back) and
`gis/macrostrat.js` turns the tiles covering a box into GeoJSON. Downstream
nothing is special: the click card, the legend, symbology, clipping, sampling,
extraction and export all already work on a vector layer.

Four things there were measured rather than assumed, and each one is a bug if
reversed:

- **The world base loads at zoom 1, not zoom 0.** The single z0 tile holds
  5,792 units and *sounds* like the world, but the tiler generalises so hard
  that point-in-polygon finds nothing under Northern Ireland or Alice Springs.
  Four z1 tiles (7,929 units, ~1.6 MB) answer everywhere.
- **Some Macrostrat tiles are cached WITHOUT their CORS header.** `carto/1/0/0`
  returns no `Access-Control-Allow-Origin` on a Varnish hit, so the browser
  blocks it while curl fetches it happily — and that tile is the quarter of the
  planet holding Ireland and North America. `fetchTile` retries once under a
  query string (a cache miss, which does carry the header). Never loop: it is
  somebody else's tile server.
- **The polygons keep the colours their own survey chose.** Macrostrat ships a
  `color` per unit; `categoricalSymbology` would assign its own and fold
  everything past twelve classes into one grey "other" — over a global map that
  is most of the world painted a colour that means nothing, under a legend that
  looks right. `paintFromSource` repaints from `properties.color` and builds
  `legendInfo` by counting units, and the card says "12 of 94 units" so the key
  is not read as the whole map.
- **Refresh is a press, not a settle hook.** Rebuilding re-triangulates
  thousands of polygons; doing that on every view change would stutter the
  flight it was meant to serve. The imagery refine can be automatic because a
  texture upload is cheap. This is not.

The first load is the world; the layer then refines **on rest** (`onViewSettled`,
700 ms) whenever the view or the zoom it deserves has changed, and "Refresh for
this view" forces it. Measured flying in: z1 → z2 → z3 → z5 → z8 (650 features,
0.70 km median edge) with one rebuild per settle and no thrash.

**An import frames what arrived, and that is a trap for any self-rebuilding
layer.** `frameResult` moved the camera on every import, so each refine framed
the world layer's bounds — the whole planet — throwing the camera back out,
which changed the view, which settled, which rebuilt again. It presents as
"mapping is super unstable, jumps back zoom views" and reads like a rendering
bug. `importFileList` now takes `frame: false`, and the geology tab always
passes it: ticking a tab is not choosing a file, and flying to Northern Ireland
because a Northern Irish sheet is a default is the app deciding where you are
looking. The layer row's focus button is how you go to a layer on purpose.

**The test for this is an IDLE phase.** Dispatch nothing and assert the camera
does not move by one metre — altitude and view centre sampled at 100 ms.
Anything else is the app moving itself, and it is the only way to tell a
feedback loop from ordinary lag. Measured after the fix: 0 m drift and 0
altitude rises across six idle phases, through load, zoom, drag and tick-off.

**A rebuild is a new layer object, so anything the user chose must be carried
over**: `styleChoice` keeps a hand-picked field/ramp against the DATASET (not
the layer) and reapplies it, and opacity and visibility are copied from the
layer being replaced. Without that, colouring the world geology by age and then
flying anywhere put it back to source colours, a faded sheet back to solid, and
a switched-off one back on. Verified: colour by age + 45% opacity survive a
forced refresh into a new layer id.

**Two rendering faults made the polygons look torn, and neither was in the
data.** An independent rasterisation of the same decoded tiles — matplotlib,
same rings, same hole grouping — had no scratches at all, which is what said to
look at our drawing rather than at Macrostrat:

- **Winding.** The fill is `side: FrontSide`, so the far hemisphere is culled
  without a depth test — and `ShapeUtils.triangulateShape` inherits its winding
  from the ring it was given, while a survey winds its rings however it likes.
  A triangle facing into the globe is not drawn, and ear clipping makes
  slivers, so what is left is a thin curved scratch along the triangulation.
  Measured over Britain: **1,087 of 228,990 triangles faced inward**, 0.47% by
  count. `fillTriangles` now turns every triangle outward — one cross product
  and a dot, since on a sphere the outward direction is the position itself.
- **Neighbouring units do not share their boundary.** Each survey, then each
  tile generalisation, simplifies a polygon on its own: only **32% of edges at
  zoom 4 are used by two polygons**, and the strays sit within about 30 m.
  Thirty metres is a fraction of a pixel, and with no multisampling a sub-pixel
  gap still leaves whole pixels with nothing drawn — a broken 1px black line
  along the boundary. Each filled polygon now strokes its own outline in its
  own fill colour at the fill's own height (the `seal` buffer).

**One EONET request cannot show the world.** `?status=open&limit=200` sounds
global and is not: the feed returns newest first, and **7,014 of the 7,082 open
events are wildfires** because US incident reporting posts continuously — so
the newest two hundred measured as 197 wildfires, **98% of them in North
America**, with every volcano, iceberg and storm crowded out. Dropping the
limit is no answer either: the open wildfire list alone is **4.74 MB**, served
uncompressed. `events.js` therefore asks twice over — once per category (twelve
small requests; volcanoes are 20 KB) and once per region for wildfires (six
bboxes, 25 each), merged by id. Measured after: 218 events in 4 categories, the
wildfires spread 25 to a continent.

**`followRelief` does not work on a `PointsMaterial`.** The points stay
submitted — `renderer.info.render.points` counts all of them — and nothing is
drawn, with no shader error logged. Event markers therefore keep the plain
material and a watcher rewrites their positions when
`getEffectiveRelief()` changes; two hundred points are nothing to recompute.
Without that they are stranded at whatever exaggeration was live when the feed
last refreshed: built low they sink into the mountains when the camera rises,
built high they float when the relief tapers away under close-range imagery.
Markers sat at renderOrder **230** and were still painted over by a geological
map, because renderOrder is not what decides it — see **groupOrder beats
renderOrder** below. The frame diff that appeared to verify this measured the
whole canvas, where the layer box and legend redraw on a toggle; it was
counting its own noise.

**Build vector geometry at a FIXED exaggeration, never at the live one.**
`surfacePoint` bakes in the relief of the moment, and that moment is not
stable: `getEffectiveTerrainRelief` tapers to nothing below ~300 km whenever
there is close-range imagery. A layer built down there came out flat, every
`aDisp` was zero — the shader then has nothing to scale — and it stayed flat
when the camera rose and the terrain returned, so the map sank into its own
ground. The viewer exposes `elevationNormalized(lat, lon)` (the terrain before
the slider) and `vector-render` builds at `REFERENCE_RELIEF = 0.11`, letting
the shader re-apply whatever is live. Measured on a square over the Alps:
vertices sit on the displaced surface to **1 m**, both at the exaggeration they
were built for and at one they were not (0.02, where the surface span is
2,662 m rather than 14,639 m).

**groupOrder beats renderOrder, and a Group has no material.**
`reversePainterSortStable` compares **`groupOrder` first**, and `projectObject`
takes groupOrder from the nearest ancestor that `isGroup`, using that Group's
own `renderOrder`. `applyStack` stamped only nodes WITH A MATERIAL — and a
`THREE.Group` has none — so every intermediate group stayed at 0, and a layer
whose geometry hangs under an inner group sorted at groupOrder 0 whatever its
meshes said.

That is what buried the event markers: their point clouds sit in a `markers`
group inside the spin frame, so they sorted at 0, while the geology tiles —
whose own builder traverses ALL children, groups included — sorted at 51 and
painted over them. Raising the points to 230 could not fix it and never did.

**Measure this at the markers' own projected pixels, never on the whole
frame.** Project each marker through the camera, keep the front-facing ones,
and compare those pixels with the layer toggled — with a control over the plain
basemap, or the test proves nothing when the visible hemisphere simply has few
events on it. Two traps in that harness: the canvas box is measured inside the
IFRAME while the screenshot is of the top page (~72 px of header, and without
it every sample reads the sky), and `import()` in the top realm cannot resolve
the viewer's `vendor/three.module.js`. Measured: **19 of 93 markers visible
over a geological map before, 93 of 93 after; 93 of 93 over the basemap
throughout.** `applyStack` now stamps every node.

**The events feed is a LAYER, adopted rather than added.** It was the one thing
on the globe with no row in the list of what is on the globe: no eye, no
opacity, no place in the draw order anybody could see or change, and its
markers held above everything by a hard-coded `renderOrder = 230` — the right
default and the wrong rule, since "always on top" is a decision the layer box
exists to let somebody take. `adoptLayer(name, object3D, opts)` in
`import-manager.js` records a layer WITHOUT touching the scene graph, because
the markers hang in `eonet-spin-frame`, which carries the spin its own way —
reparenting them into the imported group, which carries it differently, slides
every marker off its ground. Re-adopting the same name replaces the object, so
a five-minute refresh keeps the row, its place in the stack and its
visibility. An adopted layer's geometry is not ours to dispose: `removeLayer`
calls its `onRemove` instead, which for events turns the feed off.

**Every band is a DEFAULT, and dragging a row overrides it.** Events get a
fourth band above everything, so a geological map loaded afterwards cannot bury
what the feed was switched on to show. The first attempt made that band
conditional on a `stackMoved` flag and fell back to the ordinary band — still
band 2, above geology's band 1 — so pressing Down on the events row with only
geology beneath it **moved nothing and looked broken**. A dragged layer now
takes the BAND OF THE ROW IT DISPLACED (`bandOverride`, read before the splice),
so it lands where it was dropped and stays there through any redraw. Measured:
events above geology at 52/51 by default, and 51/52 after one press of Down,
with the order surviving a re-render.

**Three draw-order bands inside the imported range**: imagery (`ext` of `tiles`
or `gee` — a tile drape, an Earth Engine snapshot) UNDER geology, geology under
everything anybody added. Measured: drape 51, world geology 52, a shapefile 53.
The streamed basemap refine patch sits below all of it at 40.

**Detail is limited by TRIANGULATION, not by bandwidth.** A baked tile is
20-250 KB off disk; building it costs **60-85 ms per thousand features**. So
the zoom is chosen by weighing the view before fetching it: the manifest
records every baked tile's size, and size predicts feature count almost exactly
(measured across five zooms: 6.5, 7.4, 7.5, 6.9, 8.0 features per KB). A view
over budget (24,000 features, about 1.5 s) is refused a level rather than
freezing the tab. Two traps in that: the step from zoom 2 to zoom 3 is **nine
times** the data, not four, because that is where the compilation stops
generalising — any x4 scaling rule walks into 49,000 features — and a tile the
bake skipped is EMPTY, not unknown, so reading a missing manifest entry as
unknown threw the estimate away for every view with a coastline in it.

Measured at five altitudes over Europe, before and after: 15,290 km zoom 0 →
**2** (36 → 22 km between vertices), 7,645 km zoom 1 → 2 (36 → 22), 3,823 km
zoom 2 → **3** (25 → 10), 2,230 km zoom 3 → **5** (10 → 4.5), 995 km zoom 4 →
**5** (6.6 → 4.5).

**A tile goes up when it lands**, rather than the view waiting for its slowest
one — safe only because the backdrop is underneath, so there is nothing for an
early tile to fight with. And the backdrop is cut away exactly where the view's
own tiles paint, as a WINDOW in the shader: two latitudes as a range on the
direction's y, two meridians as plane normals from the viewer's own
`latLonToVector3`. Per-tile hiding cannot do this — a zoom-2 tile is a thousand
times the area of the view replacing it, so hiding one leaves a rectangular
hole and keeping it double-draws the moment the layer is translucent. Both were
reported, in that order, and the window is the fix for both.

**A layer that gains its geometry late still needs its place in the stack.**
`applyStack` skips a layer with no `object3D`, and a layer joins the list when
its import STARTS: the stack was applied while it was an empty row, the count
never changed again, and it kept renderOrder 0 — under the basemap. The
hierarchy poll now watches how many layers are drawable, not how many exist.
And geology sorts under every other imported layer, because a geological map is
the ground a study is about, not something to put over what somebody just
loaded.

**The world is PINNED under the view, or the planet has an empty half.**
`visibleBounds` is a hemisphere at best, so a tiled layer that holds only the
view's tiles has no geology on the far side: turn the globe and half of it is
blank until it settles and fetches, which reads as "it maps in two halves with
a huge latency between them". The controller keeps the world at `WORLD_ZOOM`
(four tiles, already baked to disk), never hides or evicts it, and draws the
view's tiles **half a renderOrder step above** it — renderOrder is a float, so
the two sets stack inside one layer without needing a second one. `features()`
returns only the finest zoom on screen, so an extraction never counts the same
ground twice. Measured: after refining to zoom 3 over Africa, the drawn set is
`1/0/0 1/0/1 1/1/0 1/1/1 3/3/3 3/4/3` — and it is the same set the instant the
camera is thrown to 110°E, which draws China immediately.

**A hole belongs to the ring that CONTAINS it, never to the one before it.**
Ear clipping joins each hole to its outer ring with a bridge, so a hole
attached to the wrong ring makes a triangle stretching all the way between
them — the bright slivers seen shooting across the ocean, which read as
geometry failing the depth test and are nothing of the kind. Measured on the
real tiles: **1-2% of holes are not inside the ring arrival order gives them**
(2 of 301 in one zoom-1 tile, 1 of 169 at zoom 4), which is a handful of rays
per view. `mvt.js` groups rings by containment (smallest containing ring wins;
a ring inside nothing becomes its own polygon) and `fillTriangles` refuses a
hole that is not inside its contour, so no source — tile or GeoJSON — can make
a bridge. Verified over the North Atlantic: 184 holes, **0 stray**.

**The seam is culled by FACING, not by depth, and that is not interchangeable.**
A fill can skip the depth test because `side: FrontSide` culls the far
hemisphere for it. A line has no facing, so nothing culls it: the seam drawn
that way put Australia's outline across the Atlantic. Depth-testing it instead
means lifting it clear of the terrain, and the lift is a fraction of the
altitude (`LINE_DRAPE`, 0.02 x altitude) — 600 m at 30 km up, which at a
grazing angle slides the seam off the hairline it exists to cover. So the seam
hugs the fill and `followRelief(..., { cullFarSide: true })` discards the half
facing away, using `aDir` as the outward normal, a hair inside the silhouette
(0.02) because at the limb the sign is decided by rounding. Measured over
Africa: the seam adds 3,613 px, of which 52 are isolated — sub-pixel islands,
not a continent.

**The marks vanish as you zoom in, and that is the data telling you where they
came from.** Every level below the source's native scale is generalised, and
the generalisation is per polygon. Measured with the flat-colour test: at zoom
4, 280 holes; at zoom 9, **zero, with or without the seam**, because at native
scale the polygons still share their boundaries.

**Two draw-order faults found by the same hunt.** The streamed imagery patch
sat at renderOrder 60 — inside the imported band, which starts at 50 — so
zooming in with a tile basemap buried every imported layer under the map
(`REFINE_ORDER = 40` now). And `applyStack` stamps a layer's renderOrder onto
the children that exist when it runs, so a tile built later started at zero,
under the basemap, at full opacity beside faded neighbours; `vector-tiles.js`
now copies the group's order and the layer's opacity onto each new tile.

**Paint every unit one flat colour to tell a hole from a seam.** A dark line
between two colours could be either; with the whole layer magenta, anything
dark is a hole. That test took the count from **280 dark pixels surrounded by
fill to 2**, and is the regression check for both faults.

Rebuild cost, measured as the longest gap between animation frames on the
software renderer: 524 ms for the 7,929-polygon world build, 326 ms for a
view-sized refine against a 246 ms idle median — a refine is not a freeze.
## The World Stress Map: the measurements, and nothing else

One layer, in Data · Vectors & Shapes under Tectonics:
`stress-vectors.geojson`, **32,464 A–C measurements**, each a 60 km bar along
the SHmax azimuth it recorded, carrying its method, quality class, depth,
faulting regime and — for the few hundred that have any — the principal stress
magnitudes (9 MB raw, **0.9 MB gzipped**).

**There was an interpolated field as well, six times over, and it is gone.**
Not for want of correct arithmetic; each version was a wrong product:

- a fine-grid raster of SHmax azimuth as a HUE — asks a reader to decode an
  angle from a colour, and across a planet it is a lava lamp;
- the same, rebuilt three times as the interpolation was corrected — a smooth
  field also hides its own resolution, claiming a precision a 450 km search
  does not have;
- bars on a lattice — thousands of ticks at global zoom is a texture, not a
  map;
- a flat-celled raster, legible at last, and a picture cannot be asked where it
  came from;
- a polygon mesh that could be asked, and still read as a basemap of a field
  that mostly is not measured.

The last one is the point. **Interpolating the WSM paints the 80% of Earth
nobody has measured in the same colours as the 20% somebody has**, and every
device for admitting that — an evidence class, an inset, an alpha — is a
footnote on a picture that has already made its claim. The bars claim only
where they are. Empty ocean stays empty, and that is the honest map.

### The WSM is global in extent and not in sampling

Measured, because it is why the interpolation went:

- **82%** of the usable records are focal mechanisms — they exist only where
  earthquakes do — and most of the rest are borehole breakouts, which exist
  only where somebody drilled.
- **63%** of records lie within 100 km of a plate boundary, 83% within 500 km.
- Plate margins (<300 km from a boundary, 24% of the surface) are **99%**
  covered within 450 km. Plate interiors (>1000 km, 41% of the surface) are
  **42%** covered, with a median **537 km** to the nearest measurement.
- Globally, only **20%** of the surface is within 100 km of any record; the
  median is 301 km and the worst tenth is over 930 km from anything.

**The colours are the WSM's own, not a palette by frequency.** Red normal,
green strike-slip, blue thrust — thirty years of published stress maps. A
catalogue entry may now carry a `colours` map that `addDataset` passes to
`paintByField` as `overrides`; without it `categoricalSymbology` assigns by how
common each class is, which put normal faulting in orange and thrust in green.

### The bars must stay ON THE MAP, and that is not a detail

A 60 km bar drawn either side of a record near the antimeridian walks off the
end of the coordinate system: the file shipped `minX = -180.6028` and
`maxX = 180.5904`. `looksLikeGeographic` allows ±180.5 for rounding, so six
tenths of a degree failed it, `import-manager` filed the layer as NOT
georeferenced, and it went to the local-models group instead of
`GeoID-ImportedGeoLayers` — **the group that is turned to the globe's rotation
every frame**. The whole map then sat 38.8° west of the planet: the Iberian
records out in the Atlantic, and the shape of Iberia still legible in them,
which is how it was spotted.

Nothing was logged, and nothing should have been: the guard exists to catch a
shapefile in UTM metres, and a silent answer is right for that. The fix is on
both sides — the bake wraps its own longitudes and splits the 31 bars that
cross the seam into two pieces meeting at ±180, and
`global-data-bounds.test.mjs` now checks every shipped `.geojson` against the
viewer's own rule, so a bake that leaves the map fails in the test run rather
than in somebody's screenshot.

### What the arithmetic still has to get right

- **SHmax is an AXIS.** 10° and 190° are the same orientation; their arithmetic
  mean is 100°, exactly perpendicular to both. Every mean is on the doubled
  angle. This survives the mesh because the bake's own check still averages.
- **A bar is 60 km on the GROUND.** The east–west half-length is divided by
  cos(latitude), or a bar at 70°N is a third the length of one on the equator.
- **The seam is cut in the UNWRAPPED frame.** Read off the wrapped endpoints a
  bar across the antimeridian is 359° long, and the cut lands hundreds of
  degrees from where it belongs.

### The check is in the tool, and it has been wrong about the map

`bake-stress.py` no longer writes a field, but it still COMPUTES one — at nine
places with a published answer, as the regression test that the records mean
what the layer says they mean: **7 of 7 named regimes agree**. **Two reference
points were wrong before the data was** — 39°N 117°W was filed as Basin and
Range extension and is in the Walker Lane, where the records are 62%
strike-slip; 28°N 85°E was filed as the Himalayan thrust front and is in
southern Tibet, which extends. A check that disagrees with the data is a claim
about the checker until it has been measured.

### Stress is a TENSOR, and what that means for what can be mapped

Stress is not a force — a force is a vector in newtons; stress is force per
unit area and a second-rank tensor. What can be measured almost anywhere is the
ORIENTATION of the maximum horizontal component and the REGIME; magnitudes need
an in-situ borehole test, and the database shows it: **249 of 32,464 A–C
records carry an S1 magnitude, under 1%**. They ride on the records that have
them and are ABSENT elsewhere — a placeholder in a numeric column is a number
somebody will average. The labels do not assert the ranking either: by
convention S1 ≥ S2 ≥ S3, but wsm00025 carries S1 11.5, S2 5.5, S3 6.3 MPa, and
"intermediate" over a number smaller than the one below it is the app inventing
an order the record does not have.
## The globe opens on Esri imagery, and the labels are the planet viewers'

**Default basemap.** `blue-marble` still paints the first frame — it ships with
the site, so it is on the sphere before any network call, and a bare globe for
the two seconds a tile fetch takes is a worse opening than one that improves.
`basemap-drape.js` then selects ESRI Satellite once the option exists and the
watcher is listening, and the watcher holds the old map up until the tiles are
down. Once only, and only from the shipped default: a user who changed the
basemap in the first twenty seconds is not overruled.

**Licence, because a default is not the same decision as an option.** Esri's
World Imagery is free of charge on this endpoint and `tile-sources.js` marks it
`freeToStream: false` — not licensed for unrestricted or commercial embedding,
and explicitly not for offline tile export. As an option somebody picks that is
their choice; as the default it is every visitor to a public page. Esri's
supported route is ArcGIS Location Platform with an API key.

### Labels: the viewer's own engine, not an imitation of it

`point-labels.js` drew its own labels twice — first a plain name over a dot,
then a hand-rolled copy of the planet viewers' chip — and both were reported
as a mess, because they were: chips overflowing the screen edge, names
overlapping, a different app bolted onto this one. The lesson is the module's
header now: **an implementation that imitates another one is wrong wherever
they differ, and they differ everywhere you did not look.**

So the imitation is deleted. `earth-viewer.js` exposes `addSurfaceLabels`,
which feeds a dataset's items through the SAME `buildLabelLayer` the curated
labels use — same pill texture, same per-frame declutter with priority sorting
and LOD density, same hit targets on the same raycaster, same scene card in
the bottom-right corner on click. `point-labels.js` is now only a translation
(`toLabelItems`): GVP feature → the item shape the engine reads, where `type`
becomes the card's kicker, `summary` its copy, `label_rank` the LOD priority
AND a size (`label_scale`, 0.91→1.15), and `category: "dataset"` a new clause
in `updateLabelVisibility` that frees these from the Locations checkboxes —
the Names button that added them is their switch.

Capped at 250 items (rank first, recency second): every label is a 4x canvas
texture on the GPU, and 2,666 would be roughly half a gigabyte for names the
declutter would never show. The adapter also follows the layer: hide it and
the labels go, show it and they return, remove it and the handle is disposed.

**Two per-item seams the volcano labels drive** (curated items carry neither
and are untouched): `label_colour`/`label_palette` colour the marker, leader
and chip accent from the LAYER'S OWN legend (`legendInfo`, never recomputed),
so a stratovolcano's name wears the stratovolcano blue the legend already
explains. And `label_distance: 0.14` — the curated default of 0.52 world units
was set for ~45 labels read from orbit; at a continental zoom it is ~600 px,
measured as Aira's name off the left edge of the canvas while Kyushu sat in
view.

**The detail slider** (Geology · Volcanoes) maps to `DETAIL_LEVELS`: minRank
reaches deeper into `label_rank` and the texture cap grows with it, because
either alone lies — a deeper rank under a fixed cap changes nothing, a bigger
cap at a fixed rank adds nothing. The captions are the rank's own bands from
bake-volcanoes.py ("Erupted since 2000" … "Every Holocene volcano"), and the
level is a REBUILD on `change`, not a filter on `input`. Set before the Names
button, it is remembered and does not switch the names on uninvited.

**Close zoom belongs to the mosaic layout, whatever the basemap.** Below a
~200 km scale bar the far-range placement stops working — its offsets are
WORLD units (0.52 along the surface, 0.22 of lift = 440 km), so labels vanish
exactly as you descend toward the thing you meant to read. The screen-space
close layout existed and was gated on the CTX mosaic basemap, which Earth
never shows; `useMosaicCloseLayout` is now a fact about altitude. Verified: the
Vesuvius chip sits beside the crater at 157 m.

**Points follow the relief the way lines always did.** `surfaceAt` bakes the
reference exaggeration into the vertex and the elevation is normalised over
the full GEBCO range, so sea level is ~0.6 of it: every coastal dot carried
~130 km of baked altitude (Vesuvius's at local radius 3.2691 on a 3.2 globe).
Invisible from orbit; at 14 km up the whole layer was overhead and gone. The
Points now get `attachReliefAttributes` + `followRelief(lifted)`, the same
paragraph the lines were already using, and marker points draw as round dots
(shared disc texture, `alphaTest` for the corners) so labelled and unlabelled
volcanoes wear one symbol.

**Clicking ANY dot of a nameable catalogue opens the scene card.** A labelled
volcano answered through its label's hit target and the corner card; an
unlabelled dot of the same layer got the GIS anchored card — two card styles
decided by which dot happened to rank a name. `sceneItemFor` (point-labels)
maps the feature through the same `featureToItem` the labels use and
`feature-popup` hands it to `viewer.openSceneFeature`, so both clicks read the
same card.

**"Force" is for the curated few, never for a dataset.** The far-range
layout's force path draws a label anyway when it cannot be fitted — right for
~45 hand-placed labels in an awkward viewport, and fed a thousand catalogue
entries it drew every volcano on a subduction arc on top of its neighbours: a
solid stripe of chips, reported as "no labels at all", which is what an
unreadable pile is. Dataset labels that cannot be placed cleanly are skipped;
the rank ordering means what survives is the most significant that fits.

**A program cache key must name the material type.** `followRelief` stamps
every lifted material `geoid-relief-live`, and the vendored three does not
fully disambiguate beyond it: the volcano dots' PointsMaterial silently took
the LINES' compiled program and rendered nothing — no error, no warning, an
entire layer invisible while its geometry, its visibility flags and its
legend were all correct. Found by bisection (the same shader injection
inlined with a unique key drew perfectly). The key now includes
`material.type`. This is the second silent-cache fault in this file's
history; treat "compiled but draws nothing" as a cache-key suspect first.

**The labels' colours race the symbology, and the symbology now announces
itself.** Labels arrive automatically, which means EARLY: the first
layer-change event fires before the catalogue's default paint has written
`legendInfo`, so the first build had no colours to read and every chip wore
the volcanic theme's red — reported with a screenshot full of red accent
bars beside a nine-colour legend. `paintByField` and `paintByRange` dispatch
`geoid-gis:layers-changed` (reason "symbology") when they finish, and
`point-labels.js` keeps a fingerprint of the legend each label set was built
from (`field|palette`), rebuilding the set when they differ. The same
mechanism makes labels follow a user re-symbolising from the dialog.

**Names are automatic, not opt-in.** The Names button is gone: a layer whose
data ranks its points (`label_rank`) gets its labels the moment it is loaded
and visible, at the default detail — level 3, the middle of the slider. The
tick that put the layer on the globe is the decision; a button that toggled
what the tick implies was a second switch for one choice. The Label detail
slider is the one remaining control, and the chosen level is remembered by
layer NAME, not id — a layer unticked and re-ticked is a new id for the same
dataset, and an id-keyed level evaporated with the old one.

**A dataset label's hit sphere must not reach the raycaster.** A curated
label is the only presence its feature has, so its whole apparatus is
clickable. A dataset label stands over a vector dot with a pixel-true hit
test of its own — give its ~100 km hit sphere to the raycaster and it steals
every click aimed at a NEIGHBOURING dot: select Vesuvius, click Campi Flegrei
25 km away, get Vesuvius again — reported as "cannot hop to another volcano".
Only the chip sprite is raycast for dataset entries, and a click on nothing
closes the scene card and the temporary label both.

**A labelless dot's selection is a TEMPORARY label.** The pulsing golden halo
and highlighted chip are built on a label entry, so `openSceneFeature` gives
an unlabelled volcano one for as long as it is selected — `addSurfaceLabels`
with just that item, cleared when another feature opens, when the card
closes, and when a click lands on nothing. Where the same volcano already
wears a label, that entry's OWN item is opened instead, because
`selectedLabelEntry` matches by object identity and a fresh object naming the
same place would open the card and leave the label unpulsed.

**A dot's hit radius is its drawn size, at any altitude.** The line-pick
ceiling (20 km) exists so an orbital click cannot select a sub-pixel river
400 km away — but a marker dot is drawn at a FIXED pixel size, so from orbit
the dot you can plainly see spans ~100 km of ground and the ceiling left only
its centre pixel clickable. `pointToleranceMetres` scales with altitude and
has no ceiling. The dataset label hit-spheres are also scaled to 0.28 of the
curated ones — 0.18 world units is ~360 km of ground, and a thousand of those
blanketed the arcs, claiming every click for whichever invisible sphere sat
closest.

**No count cap on the detail levels.** There was one and it cut Vesuvius:
level 3 admitted rank ≥ 3 but kept the 360 most recent, and 1944 is old among
post-1900 eruptions. A level must mean what its caption says; the texture bill
is bounded by `label_backing: 2` on dataset chips instead (half the backing,
a quarter of the memory, still 2× the drawn size).

**A dataset label group must live INSIDE `labelLayer.group`.** The render loop
turns that group to the spin every frame; a sibling group under marsGroup gets
no such turn, and every label sat ~35° west of its volcano — the whole map
displaced, growing with the clock, and nothing anywhere said why.

`feature-popup.js` yields the click when `interactiveFeatureAt` says a viewer
label claimed it — a label and the feature it names occupy the same ground,
and two cards for one click was the alternative.
## Native resolution is a property of the LAYER, and it is measured

Extraction resampled every layer onto one uniform grid whose spacing the user
typed. That is right for a JOINED table — one row per sample, a column per
layer, which is what the built-in elevation/geology/climate columns live on
and what a model wants — and it is not what the DATASET says. Read a 30 m
GeoTIFF at 1 km and 99.9% of it never appears; read a global Earth Engine
snapshot at 1 km and ONE pixel is spread over thousands of identical rows.
Both come back looking equally authoritative.

`nativeGridOf(layer)` answers what grid a layer actually holds, and **nothing
about it is declared**:

- a RASTER layer (GeoTIFF, `.asc`, any tool output) IS its grid;
- a DRAPE's grid is the DELIVERED image behind it — a cached global snapshot
  is 1024 px for the whole world however fine the archive is, so the number
  must come from the image in hand and never from the catalogue's
  `nativeScale`. Measured on the real CHIRPS cache: 1024x484, **39,136 m per
  pixel**;
- a VECTOR returns null and says so. It has no resolution; it is clipped
  exactly, never sampled.

`extractNative` walks the polygon's own box **in the layer's grid indices**,
not the layer — a global drape is millions of cells and a study area is a
handful, and iterating the layer to find the handful is the difference
between an answer and a hung tab. Where the polygon is smaller than one cell
the answer is ONE ROW: that is what the dataset knows about this ground, and
padding it out is how a single pixel comes to look like a survey.

Both run on every extraction now — the uniform grid as before, plus one
native table per sampled layer, reported in the status and exported as
`geoid_native_<layer>` beside it. Verified through the panel itself over a
drawn study area on the Congo, with a GEE drape and a local DEM ticked:
*"12,508 samples over 1,234,862 km² · Rainfall (CHIRPS) at its own 39,136 m
cells: 784 cells; local_dem at its own 9,200 m cells: 14,641 cells."* The
uniform grid would have spread those 784 real readings across 12,508 rows.

**What native CANNOT do is make a coarse fetch finer.** 39 km a pixel is the
cached snapshot's own resolution, not CHIRPS's 5.5 km; the way to a finer
grid is to FETCH the dataset over the drawn extent through the GEE dialog,
which `resolutionNote` already states as a shortfall against the published
`nativeScale`. Extraction reports what arrived, which is the only thing it
can honestly report.
## The tiles moved to a bucket, and a rendering layer proves nothing about where

GLiM (169 MB) and the FAO soil map (27 MB) stream from Cloudflare R2 now —
`https://data.geoidinitiative.com/{glim,soil}` — and the repo is 173 MB of
tracked `data/global` against 199 before. `services/publish-tiles.py <name>
--base <url>` uploads the pyramid through a configured **rclone** remote and
rewrites the local manifest's `tiles_base` in place; `--check` asks the bucket
the two questions rclone cannot answer, and `--unpublish` drops the field so
the pyramid is read locally again.

**THE MANIFEST STAYS WITH THE SITE AND THE TILES MOVE.** That split is the
whole design: `manifest.json` is 10–20 KB and carries `has()` — which stops the
client asking for the thousands of ocean tiles that were never baked — and
every tile's SIZE, which is what `chooseZoom` weighs a view against BEFORE it
fetches anything. Put the manifest in the bucket too and a slow or unreachable
bucket stalls the zoom chooser rather than merely costing tiles. The legend
sidecars (`units.json`, `classes.json`) stay for the same reason: the key is
drawn before any tile lands.

**CREDENTIALS ARE RCLONE'S, NEVER THE SCRIPT'S.** `publish-tiles.py` shells out
to a named remote and reads no key, token or secret of its own — there is
nowhere in the file for one to be typed. Public access, the custom domain and
the CORS policy are account-level settings it cannot set, which is why `--check`
exists as a command rather than as an instruction to look at the dashboard.

### A LAYER THAT RENDERS SAYS NOTHING ABOUT WHERE ITS TILES CAME FROM

The local tile directories are still on disk (only untracked), and the browser
caches a tile like any other file — so "the map draws" is satisfied by three
different worlds and cannot tell them apart. Measured the wrong way first: the
network recorder reported **zero tile traffic** while GLiM drew 249,601
polygons, because **it does not see cross-origin requests**. Read literally that
says the bucket is not being used, which is the opposite of the truth.

**Wrap the iframe's own `fetch` and count BY HOST.** Installed before the tick,
recording every `.mvt`:

| | tile requests | host |
| --- | --- | --- |
| soil | 24 of 24 | `data.geoidinitiative.com` |
| GLiM | 20 of 20 | `data.geoidinitiative.com` |
| both at once | 44 of 44 | `data.geoidinitiative.com`, **none to localhost** |

with soil at 21,157 polygons over 27 legend rows and GLiM at 249,601 over 16,
both status lines counted from the file rather than typed. That is the only
instrument that answers the question actually being asked.

**Two traps in driving it.** Ticking both layers at once triangulates 270,000
polygons and blocks the renderer past the tool's 45 s eval timeout — the state
is intact, so read it back in a second call rather than concluding a hang. And
the whole verification has to run on a COMMITTED stamp: the stamp is the git
sha, so an uncommitted edit re-stamps to the same value and the browser serves
its cached module. The stamp names the PRE-amend sha, which is what the commit →
stamp → amend dance produces and is not drift.

### Cloudflare 403s the `Python-urllib` User-Agent

`--check` reported **HTTP 403 — is it publicly readable?** about a bucket that
was serving perfectly. Isolated on the identical URL and Origin: `curl/7.81.0`
→ 200, `Mozilla/5.0` → 200, **`Python-urllib/3.10` → 403.** Cloudflare's bot
rules, not the bucket. A false negative that sends somebody into the dashboard
hunting a permission problem which does not exist, so the checker sends a
browser-shaped User-Agent — the point of the command is to answer the question a
BROWSER would ask, so it has to look like one.

The `Origin` header is the other half: fetched without one, a bucket looks fine
and the page still fails, because the reply's CORS header is only meaningful in
answer to an Origin. Measured on the live bucket, `access-control-allow-origin`
echoes both `https://geoidinitiative.com` and `http://localhost:8125`.

### `cache-control` is set at UPLOAD, and that is safe because of `?v=`

`public, max-age=31536000, immutable`, written by rclone's `--header-upload`.
Safe only because the client appends the bake's own version fingerprint
(`<tiles>-<bytes>`) to every tile it asks for, so a re-bake is a different URL
and can never be served from a stale cache. A pyramid uploaded without that
header is served with whatever default the bucket has, which for a tile that
never changes is a wasted round trip on every view. The REMOTE tile path
deliberately gets no `?v=` — that is Macrostrat's cache key, not ours — which is
why a published pyramid has to travel the LOCAL path, and why setting `base`
rather than `remote` is the correct seam. Pinned in `tiles-base.test.mjs`.

### A manifest is stamped ONCE, and by exactly one of the two places that can

`bakedTiles` in `geology-panel.js` appends the module stamp to the manifest URL
deliberately — a re-bake is invisible to a browser holding the old manifest, and
that has cost a whole verify loop before. `soil-cover.js` and `glim-cover.js`
each appended one as well, so the manifest was fetched as
**`manifest.json?v=X?v=X`**. This server ignores the query and a stricter one
need not; `ice-cover-panel.js` already had it right by not appending.

The rule generalises past this bug: when two layers of a call chain can both
decorate a URL, exactly one of them may. The sidecar tables (`units.json`,
`classes.json`) DO carry the stamp in these modules, because nothing else
stamps them.

### What `.gitignore` holds out, and on what terms

`data/global/{glim,soil}/[0-9]*/` — the TILES only, never `manifest.json` or the
legend sidecar. `tiles-base.test.mjs` asserts that no rule matches a whole baked
pyramid, because a rule one character broader takes the manifest with it and
defeats the split above.

**Note the history still carries the objects that were committed before.**
Untracking stops them deploying and stops them growing; shrinking the pack is a
rewrite and a separate decision. And after any bake, count what was
COMMITTED rather than what was written — `git status` being clean is exactly
what being fully committed looks like, which is how 376 MB of soil scratch
reached a commit in the first place.

### Untracking a file does not remove it from the commits being pushed

The push to `origin/gis-viewer-mygeoid` failed every time, and not for any
reason visible in the working tree: `git status` was clean, `.soil-work` was
gitignored, and nothing oversized was tracked. **GitHub hard-rejects any single
file over 100 MB**, and the 52 unpushed commits carried four —
`dsmw.geojson` 137.2 MB and `soil.geojson` at 131.2 / 130.5 / 130.4 MB — swept
in by `git add -A` in the soil bake and only UNTRACKED four commits later.
Untracking stops a file growing and stops it deploying; the blob stays in every
commit that already held it, so the push was 860 MB of blobs and could never
succeed. Retrying is not a strategy here — the refusal is a permanent property
of the history.

**The diagnosis is one command**, and worth reaching for before reading any
error text:

    git rev-list <remote>..HEAD --objects \
      | git cat-file --batch-check='%(objecttype) %(objectsize) %(rest)' \
      | awk '$1=="blob" && $2>100000000 {print $2, $3}'

`git filter-repo --invert-paths --path data/global/.soil-work --refs
<remote>..HEAD --force` purged it: 860 MB → **271 MB**, nothing over 100 MB, all
52 commits and their messages kept. Three things made that safe rather than
brave, and all three were checked FIRST:

- **The blobs were confined to unpushed commits.** Every remote branch —
  `gis-viewer-mygeoid`, `-staging`, `main`, `flight-sim-mars` — was measured to
  contain zero `.soil-work` objects, so the rewrite could not touch history
  anyone else holds. `--refs <remote>..HEAD` scopes it to that range.
- **The TREE must come out byte-identical**, and that is the correctness check
  rather than the commit count: `git rev-parse HEAD^{tree}` before and after
  were the same hash (`8f4459b6`), which says the purge changed nothing about
  the deliverable. A rewrite that alters the tree has removed something real.
- **A backup ref before the rewrite**, not a bundle. A tag plus a branch at the
  old HEAD keeps the old objects reachable at zero extra bytes, which matters on
  a disk at 99%; `git bundle` would have written another gigabyte. Deleting that
  ref and running `gc` is what finally reclaims the ~580 MB.

**And the branch's upstream was not the branch of the same name.**
`gis-viewer-mygeoid` tracks `origin/gis-viewer-mygeoid-staging`, 831 commits
behind, so a bare `git push` aims somewhere quite different from
`origin/gis-viewer-mygeoid`, which is 52 behind. Push by explicit refspec here,
or read `git rev-parse --abbrev-ref @{upstream}` before believing a push
targeted what its branch name suggests.

### 190 MB IS the whole pyramid — the gigabytes are the source and the scratch

Worth stating because the bucket looks too small to be holding two global maps.
Measured, `rclone size` against the manifests' own byte counts:

| | bucket | objects | manifest says |
| --- | --- | --- | --- |
| GLiM | 165.7 MB | 929 = 927 tiles + manifest + classes | 927 tiles, 165.7 MB |
| soil | 25.0 MB | 564 = 562 tiles + manifest + units | 562 tiles, 25.0 MB |

`rclone check` matches every tile byte for byte (928/929 and 563/564), and the
single difference in each is `manifest.json` — expected, because `publish-tiles`
stamps `tiles_base` into the LOCAL copy after uploading, and the site reads the
local one by design. The bucket's copy is never fetched.

GLiM ships as a 1.1 GB geodatabase, becomes a ~3 GB reprojected GeoPackage and
leaves 4.4 GB of scratch — and bakes to 169 MB, a hundredfold collapse that is
the whole point rather than a loss: banded simplification at the source's own
0.017° accuracy, vertices quantised onto the 4096 grid, only the level-1 class
name carried, protobuf varints. **A pyramid is not the size of its source, and
comparing the two is how a complete upload comes to look like a failed one.**
The check that answers it is object COUNT against the manifest's own tile count,
never total bytes against the download.
## Everything under data/global now streams, and 173 MB became 88 KB

Four baked pyramids and the loose vector files all live in the bucket. What is
still tracked is 88 KB: five manifests, two legend tables and `sources.json`.

| | in the bucket | stays with the site |
| --- | --- | --- |
| geology | 1,089 tiles, 48 MB | `manifest.json` |
| glaciers (`ice`) | 806 tiles, 80 MB | `manifest.json` |
| GLiM | 927 tiles, 169 MB | `manifest.json`, `classes.json` |
| soil | 562 tiles, 27 MB | `manifest.json`, `units.json` |
| loose files | 12 files, 43.9 MB | `sources.json` |

**THE BUCKET ROOT MIRRORS `data/global/`.** That is what lets one rule serve
both kinds: `data/global/glim/0/0/0.mvt` is `<base>/glim/0/0/0.mvt` and
`data/global/coastline_10m.geojson` is `<base>/coastline_10m.geojson`. Nothing
downstream has to know which it is holding.

`services/publish-data.py` is `publish-tiles.py`'s counterpart for what has no
manifest, and `gis/data-base.js` is the one resolver. Verified live by wrapping
the iframe's `fetch`: volcanoes, coastlines and rivers each from
`data.geoidinitiative.com` with their fingerprints and **zero** local data
fetches, drawing 2,666 / 4,133 / 4,224 features — the counts this file already
records; the two ice sidecars returning 38,016 named glaciers and 192,869
thickness rows; the GEE catalogue 1,142 datasets. Only `sources.json` is read
from the site, which is the design.

### The metadata cannot live in the bucket it describes

Three separate reasons, and each was paid for somewhere else first:

- **A manifest carries `has()` and every tile's SIZE**, which `chooseZoom`
  weighs a view against BEFORE fetching anything. In the bucket, a slow or
  unreachable bucket stalls the chooser rather than merely costing tiles.
- **`sources.json` carries a CONTENT FINGERPRINT per file**, which is what makes
  the bucket's `immutable, max-age=1 year` safe. These files have no version of
  their own, so a re-baked `volcanoes.geojson` at a bare URL would be invisible
  for a year.
- **It is read before any fetch**, so it cannot be behind the thing it is
  describing. It is a few hundred bytes; the split costs nothing and buys the
  layer an honest refusal instead of a blank map.

**PUBLISHING IS WHAT ARMS THE CACHE TRAP, so publishing is where it is
disarmed.** `geology`'s manifest predates the `<tiles>-<bytes>` convention and
carried no `version`, so its tiles were about to be served at a bare URL for a
year — `publish-tiles.py` now DERIVES one from the manifest's own byte counts
(`1089-47682086`) and says so. Uploading with a long cache and no fingerprint is
the single most expensive mistake available here, because it cannot be undone by
re-uploading.

### Resolution fails SAFE, at every step

`dataUrl` returns the LOCAL path unchanged when there is no `sources.json`, no
base, or no entry for that file. So a deployment that has published nothing
behaves exactly as it always did, and a file added since the last publish is
still found rather than 404ing. The two ice sidecars and the GEE catalogue keep
their module stamp when unpublished and drop it when published — the published
URL already carries its own fingerprint, and appending both is the
`manifest.json?v=X?v=X` fault.

**The invariant that will break silently later is pinned in
`data-base.test.mjs`:** any file `.gitignore` holds out of `data/global/` must be
reached through `dataUrl`, checked across every module in `gis/`. Add a shipped
file, publish it, forget to wire it, and the fetch 404s IN PRODUCTION ONLY — the
file is still on the developer's disk and the dev server serves it happily,
which is exactly the shape that makes it invisible until deploy. The scan strips
comments first, or the resolver's own header (which names an example path) fails
its own test.
## CLOUDFLARE HOTLINK PROTECTION BLOCKS IMAGES BY REFERER

Moving a viewer's textures to the bucket is the first thing here that put
IMAGES behind the custom domain, and it failed in a way that looked like a
broken upload. Measured on one object, varying only the Referer:

| Referer | |
| --- | --- |
| none (curl's default) | 200 |
| `http://localhost:8125/…` | **403** |
| `https://geoidinitiative.com/` | 200 |
| a `.wav` under the same prefix, from localhost | 200 |

So it is images only, and it keys on the Referer being a domain other than the
zone. That is why the tiles and the vectors never met it: `.mvt` and `.geojson`
are not images. All 66 Mars objects answer 200 with the production Referer, so
the deployed site is fine — **local development is what breaks**, and the fix is
a Cloudflare setting rather than anything in this repository.

**In the browser this presents as `TypeError: Failed to fetch`, not as a 403**,
because the 403 carries no CORS header, so the page cannot see the status. Two
requests from the SAME page separate it in one measurement: a `.mvt` from the
bucket answers `200 type=cors` while a `.jpg` from the same bucket throws. If
one asset kind works and another does not, suspect a rule keyed on content type
before suspecting the upload.

### A zero exit is not evidence the files arrived

`rclone --min-size 262144` means **256 GiB**, because rclone reads a bare number
as KiB. It matched nothing, copied nothing, exited 0 — and the script went on to
rewrite every reference to a bucket prefix holding **zero objects**. The suffix
is load-bearing: `--min-size 262144B`.

`publish-viewer-assets.py` now LISTS the prefix and refuses to rewrite unless
every file it meant to upload is really there. Verifying after rewriting would
have been useless anyway: the untracked originals are still on the developer's
disk, so the dev server keeps serving them and the page looks perfect while
shipping references to nothing.

**And requesting a URL before its object exists poisons the CDN cache with the
404.** Cloudflare served cached negatives for minutes after the objects landed,
which reads exactly like a failed upload. Check the bucket with `rclone lsf`
before believing an HTTP 404, and bust the query when re-testing.
## What is still in git, and what it is

After moving `data/global`, Etna's bake inputs, the flight_sim duplication and
the Mars textures: **781 MB**, from 1,743 MB. The remaining large items are
NOT all maps, and the distinction decides whether the bucket is the answer:

| | | |
| --- | --- | --- |
| `assets/etna_viewer_demo.webm` | 79 MB | video |
| `exoplanets/NASA_exoplanets.csv` | 74 MB | a table |
| `flight_sim/enterprise` | 70 MB | `.obj`/`.max`/`.fbx` models, one a proprietary 3ds Max source |
| `earth_explorer/etna` | 71 MB | viewer imagery — a map |
| `GeoID_Earth/assets` | 45 MB | Earth textures — a map |
| `planet_explorer/moon` and the other eight | ~190 MB | textures — maps |

`du -ch` over a large file list is NOT how to measure this: xargs splits the
list and `tail -1` reads only the last batch's total, which understated the
repository by 500 MB and was quoted twice before it was caught. Sum the bytes.
## The audit is a tool, and its first run found three faults in itself

`services/audit-published.py` asks, of everything moved to the bucket, the
questions in the order they fail: is the object there, does it match the local
bytes, does it answer over HTTPS, does it carry CORS, is anything still naming a
LOCAL path that is no longer tracked, and is the metadata that must ship still
tracked. `--full` checks every tile rather than a sample.

Measured, `--full`: **geology 1089/1089, GLiM 927/927, ice 806/806, soil
562/562 tiles all 200, drift 0** on all four; the 12 loose files 200; the 56
referenced Mars asset URLs 200; 0 dangling local references; 7 metadata files
all tracked. Runtime, in the browser: **79 data fetches to the bucket and
exactly 3 to the site** — `sources.json`, `glim/classes.json`, `soil/units.json`
— which is the split by design.

**Its first run reported 98 problems and all of them were the instrument.**
Worth writing down, because each is a way to audit something and learn nothing:

- **`dict(r.headers)` keeps the wire casing.** `urllib`'s header object is
  case-insensitive; converting it to a plain dict is not, so a lookup for
  `access-control-allow-origin` missed `Access-Control-Allow-Origin` and 35
  objects read as CORS-less while curl showed the header on both HEAD and GET.
- **`assets/<word>/` is not ours by default.** The regex matched any host, so the
  Mars manifest's citation of `d9-wret.s3.amazonaws.com/assets/palladium/…`
  became a failing audit of somebody else's CDN. The host now comes from what
  was actually published.
- **A published file NAMED by its local path is the design, not a dangling
  reference.** `global-data.js` names `/data/global/coastline_10m.geojson`
  because that string is what `dataUrl` is HANDED; it resolves to the bucket at
  runtime. Flagging it reported 24 faults in a mechanism working exactly as
  built.

The shape is the same each time: **a check that does not know what correct looks
like reports the difference between its author's assumptions and reality, and
calls it a defect.** Run a new instrument against a state you have already
verified by other means before believing what it says about a state you have
not.
## `hotlink-ok` is how images live in the bucket without touching the zone

Cloudflare exempts any path containing `hotlink-ok` from Hotlink Protection, so
`services/publish-viewer-assets.py` publishes under `assets/hotlink-ok/<key>/`.
That keeps the public site's protection exactly as it is and needs no dashboard
change. Measured on one file, path the only variable: **403** at
`assets/planet-mars/…`, **200** at `assets/hotlink-ok/planet-mars/…`, from a
localhost Referer — and 200 nested or at the root, so the layout stays tidy.

The cost is that those specific objects are hotlinkable, which on R2 is free
egress and, for public map textures already served to every visitor, is nothing.

**Migrate an existing prefix with a server-side `rclone copy` between two remote
paths** rather than re-uploading: Mars moved 229 MB without touching the wire.

### A publisher must walk the INDEX, not the directory

`assets/` folders also hold the raw material somebody baked them from. Walking
the directory uploaded **1,065 MB of untracked working files** — a 631 MB ArcGIS
project package under venus, 120 MB of shapefiles and geodatabase tables under
the moon — none of it tracked, none of it referenced, all of it published
because it happened to be sitting there. Files are named to rclone explicitly
now (`--files-from`), never selected by `--min-size`.

**And `tracked` alone is right the first time and wrong every time after.**
Publishing untracks the files, so a cleanup keyed on it purged **all 66 of
Mars's live objects** — they were untracked precisely BECAUSE they were
published. What a site ships is what its code NAMES, so `already_published()`
reads the bucket URLs already in the source and unions them with the tracked
set. Restored from the 56 URLs Mars's code names.

### Moving an asset means moving it in the SERVICE WORKER too

`sw-ctx-tiles.js` (three copies) precaches a list of default assets. After the
planet move, 12 entries per copy named paths that no longer exist. **Nothing
broke** — the install is `Promise.allSettled(… cache.add …)`, so a failed entry
is skipped rather than failing the worker — but those assets silently stopped
being precached, which is a performance regression with no error anywhere. Had
it been `cache.addAll`, one missing file would have failed the whole install.

Auditing that list found a fault **older than this session**: every Venus and
Mercury entry was missing its `/viewer/` segment, so neither planet had ever
been precached. Confirmed pre-existing by diffing `HEAD~6`. **When a list of
paths is maintained by hand, check the whole list rather than the part you
changed.**

### Where it ended

**1,743 MB → 643 MB tracked**, against a 1 GB GitHub Pages limit, with the
bucket at 497 MB. Deliberately NOT moved, and the reason is the same for both:
`GeoID_Earth/assets` (44 MB) is read by the main GIS viewer, its manifest AND
three service workers, and `earth_explorer/etna/viewer/assets` (38 MB) has a
service worker of its own with its own precache list. Both are reachable with
the technique above; neither is worth doing at the end of a long session on the
one surface everything else depends on.
## Cross-origin images TAINT a canvas, and WebGL refuses the upload

Moving a viewer's textures to the bucket is the first thing that made them
cross-origin, and it broke the flight_sim Mars viewer outright:

    SecurityError: Failed to execute 'texSubImage2D' on 'WebGL2RenderingContext':
    Tainted canvases may not be loaded.

An `Image` loaded without `crossOrigin` taints any canvas it is drawn into, and
a tainted canvas cannot be uploaded as a texture. The path was
`new Image()` → `drawImage(img, …)` → `texture.needsUpdate = true`, with no
`crossOrigin` anywhere on it. **`map2d.js` has carried that exact line for years
for the same reason** — the lesson was already in this tree and it was walked
into from the other side.

41 `Image()` loads across 21 files now set `crossOrigin = "anonymous"`; the
bucket already allows the origin, so an anonymous request is all that was
needed. **Set it BEFORE the assets move, not after** — `earth-viewer.js` had
three such loads and not one of them set it, so publishing `GeoID_Earth/assets`
would have killed the main GIS globe exactly as it killed Mars.

**It does not present as a 403 or a 404.** The fetch succeeds; the failure is at
texture upload, so the symptom is a viewer that boots, reports every asset
present, and draws nothing — with the real message buried in the console.

### `layer.features` can be empty over a map that is fully painted

GLiM reported **"0 in view"** while sixteen tile objects were on the globe with
**541,082 features** in the controller and every legend class visible. The
status line reads `layer.features`, which is a SNAPSHOT the tiled layer keeps
for the pickers, and on a dense pyramid it is empty. Reported as "GLiM fails to
import/map", and the map was working the whole time.

`glim-cover` and `soil-cover` count `tiled.featureCount()` now. This is this
file's own rule met from a new direction: **count the things drawn; do not ask
the drawing what it holds.** Worth knowing the consequence is not only cosmetic
— `featuresAt` walks that same snapshot, so a dense tiled layer's polygons are
not clickable while it is empty.

### Check WHICH SITE is being looked at before diagnosing a regression

Three regressions were reported against a live site that could not have had any
of them: **`geoidinitiative.com` serves `main`**, which is 51 commits behind and
predates GLiM and soil entirely — `data/global/glim/manifest.json` answers 404
there. `origin/main` carries 1,910 files under `data/global`; the working branch
carries 8. So the failures were local, against a working tree that was being
rewritten at that moment. **`git ls-remote` and one curl of a file that only the
new branch has settles it in seconds**, and is worth doing before reading any
code.

### `earth-viewer.js` has TWO copies of the seven-layer intersection block

One is tab-indented and is the real picker, `getInteractiveFeatureHit`
(~15610); the other is space-indented and belongs to a `geologyLineIntersections`
branch inside a click handler (~21400). A patch anchored on the space-indented
form asserted **"exactly one match"**, passed, and went into the wrong function —
where it would have made a core-view label open a *geology* popup.

The assert was not wrong, it was answering a different question: the anchor text
was unique **as written**, because indentation is part of the match. So a
uniqueness check proves the anchor is unambiguous, **it does not prove the
anchor is the intended site**. After any patch of this file, confirm the change
landed inside the function it was meant for — `awk 'NR>=<fn start> && NR<=<fn
end>'` and grep for the marker — before believing the edit.

The tell that it was wrong was available immediately and I did not read it: the
zoom half of the same commit worked live while the picker half did nothing,
which localises the fault to the picker before any browser work.

### A `try/catch` returning null makes an error and a miss identical

`interactiveFeatureAt` wraps the picker in `try { … } catch { return null; }`.
With `cutawayResult` in question that swallowed the interesting case entirely:
a scope error and "nothing under the cursor" both answer `null`. Temporarily
stashing the error on `window` was what ruled out a TDZ problem in one reload —
worth doing FIRST whenever a picker returns nothing, because it splits "did not
run" from "ran and found nothing", and those have no diagnoses in common.

### The scene card's close button was covered by its own kicker

`.scene-popup-close` is absolutely positioned with no `z-index`; `.feature-kicker`
is a full-width static paragraph whose box (718→1026 px) runs under the button
(1005→1033). The kicker won the hit test, so a real click on the ✕ did nothing
while `btn.click()` closed the card instantly — proof the handler was fine and
the BUTTON was unreachable, keyboard-only.

**`document.elementFromPoint(centre of the control) === the control`** is the
check, and it is worth running on any control that sits over flowing text. A
click-through test alone would have blamed the handler.

This one only surfaced because the label fix worked: until a card could stay
open, nothing had ever needed to close one.

### The screenshot frame is not the page frame

Screenshots come back 800×635 for a 1077×855 canvas — a 0.7428 scale. The
`computer` tool maps its own coordinates, but any pixel read OFF a screenshot by
eye and then passed to page-space JS (`interactiveFeatureAt`, `elementFromPoint`)
is wrong by a third, and lands plausibly enough to look like a real miss. Twice
this cost a "the fix does not work" that was only a bad coordinate.

Locate targets by projecting the scene objects instead: `getWorldPosition` →
`project(camera)` → rect maths gives the exact page pixel for every label, and
the hover handler's own `clientX/clientY` confirms the mapping.

### A layer without a `collection` does not exist to this app

An imported CSV of points drew perfectly and was inert: `layersByType("vector")`
filters on `l.collection`, so IDW's Points list read **"None available"** over
two hundred points visible on the globe, and every other vector tool agreed —
buffer, hull, voronoi, centroids, TIN, kriging, rasterize, spatial join, zonal
statistics, and "sample raster at points", the one anybody would reach for
first. `layerKind` then fell through to **"mesh"**, so the export menu offered
STL and OBJ: the CSV could not be written back out as a CSV.

**The test that localised it in one step was importing the same 200 points as
GeoJSON**, which every tool accepted immediately. Same coordinates, same
attributes, one difference — a FeatureCollection. When an imported layer is
ignored by tools, compare formats before reading any tool code.

Both `layer.features` and `layer.collection` must be set: the popup's picker
walks the first and the tool runner reads the second, and a layer that answers
one and not the other is clickable but untoolable, or the reverse.

### Constants in a point cloud's rendering, and what each one cost

Three separate numbers, all wrong in the same way — a value that suited one
dataset, applied to every dataset:

- **`size: 0.012`** scene units is ~24 km at the globe's scale. Every CSV drew
  as overlapping squares covering far more ground than the survey. World-space
  sizing meant zoom changed only how many were in shot, which is exactly what
  "more squares when I zoom out" is.
- **`baseRadius + height * 0.12`** spreads any Z range across 239 km of
  altitude. Earthquakes 0.8–13 km deep were drawn 10–249 km up, most of them
  **above the camera**: 37 of 200 inside the frustum. It read as "most of my
  points did not import".
- **no `map` on the PointsMaterial**, so each point is a hard quad. The squares
  were literally squares.

All three now read off the survey's own span (dot = span/√n, clamped; slab =
span/4). The rule this leaves: **a point cloud's rendering constants belong to
the data's extent, never to the scene.** Z stays normalised rather than placed
at true height on purpose — `depth_km`, `elev_ft` and a bare `z` are all just
numbers, and no column name can be trusted for units.

### `--check` a refactor's declaration ORDER, not just its syntax

Hoisting the span maths above the placement loop put it above
`const baseRadius`, which is a TDZ error — `node --check` passes, the tests pass
(nothing covers this module in node: it needs THREE and a document), and the
import silently lands as `status: "error"` with a null message. The live import
caught it in one reload. **For modules the node tests cannot reach, "it parses
and the suite is green" is not evidence of anything.**

### The stamp rewrites the very strings a patch anchors on

An import line was added by replacing `"./vector-render.js?v=20260904-d983da6"`
— a stamp that `stamp.py` had already rewritten to a different hash two commits
earlier. `str.replace` does not raise when it matches nothing, so the edit
silently did nothing, the file still parsed, all 98 tests still passed, and the
import failed at runtime with `registerDrape is not defined`.

Two rules follow. **Assert the match count on every replace, not just the ones
that look risky** — an anchor that includes a stamp is guaranteed to go stale.
And **never anchor on a stamped URL**: match the import with a regex that treats
`?v=...` as optional and reuse whatever stamp is live.

This is the second silent-anchor failure in two sessions; the other matched the
wrong copy of a duplicated block. The shape is the same both times — the edit
reported success and the change was not there.

### What "touch tight" means for each layer type here

Measured against `surfacePoint(lat, lon, 0)`, in metres off the ground:

- **Raster drapes** — 0 m, terrain-following, re-laid whenever the ground moves
  more than 10 m beneath them.
- **Imported point clouds** — ~3 m (`LINE_DRAPE_MIN`), the same treatment, and
  registered in the same drape registry. Was a flat 9,950 m on a plain sphere.
- **Vector markers** — altitude-scaled per frame by `setLineDrapeFromAltitude`:
  11.9 km from orbit down to a couple of metres on the ground, so a baked vertex
  reading 11,945 m is NOT the drawn position. Measure the uniform, not the
  buffer.
- **Polygon fills** — `FILL_DRAPE = 0`.

The rule the codebase keeps arriving at: **a layer that does not depth-test
needs no clearance, and any clearance it has it pays for in parallax.**

### A highlight has to be told what it is highlighting

The hover mark for a point was `new THREE.PointsMaterial({ size: 14,
sizeAttenuation: false })` — no map, so it drew its own quad as a hard square,
at a constant 14 screen pixels over marks whose size is never constant. A vector
marker's size is driven by altitude, an imported cloud's is world-space and
derived from the survey's spacing; 14 px was a fraction of one and a swamping of
the other.

`featuresAt` has always returned `{ layer, feature }` and every call site
already held the layer — it simply was not passed down. With it, the highlight
reads the source layer's own `size` and `sizeAttenuation`. Note a marker layer
draws TWO point objects (the white underlay a few pixels wider than the tinted
disc), so take the WIDEST or the ring lands inside the mark.

The texture is a ring rather than the existing disc for a reason worth keeping:
a filled circle at halo size replaces the mark with a coloured blob, which is a
highlight that hides its own subject.

### "Loaded, visible, unculled, in front of the camera — and paints nothing"

A point edit rebuilt its layer and the map went blank. Every property said the
layer was fine: `status: "loaded"`, 200 features, `object3D.visible` true,
`frustumCulled` false, camera layer masks matching, all 200 vertices projecting
inside the viewport with `z < 1`, and `renderer.info.render.points` rising by
exactly 200 when it was shown. **`info.render` counts what was SUBMITTED, not
what survived rasterisation** — it is not evidence that anything was drawn.

The one measurement that settles it is the framebuffer:

```js
gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, buf)
```

taken twice, once with the layer shown and once hidden, counting pixels that
differ. Colour-matching a specific hue is worse — a viridis ramp is not one
colour, and a wrong guess reads as "nothing drawn". The difference is robust and
gives a number to compare between two layers.

Two traps inside that: measure a layer with every OTHER layer hidden, or two
copies at the same coordinates hide each other's contribution (a fresh import
measured 90 px against 13,873 purely because a twin was drawn on top of it); and
a point sprite whose computed `gl_PointSize` exceeds
`gl.ALIASED_POINT_SIZE_RANGE[1]` — 255 here — is silently DROPPED, so "make it
huge to find it" hides what it was meant to reveal.

The cause was `transparent: opacity < 1`. At three metres above a 6,371 km
radius a cloud is inside the depth buffer's noise, so an opaque one draws in the
opaque pass and loses to the globe; the same 200 points painted 0 pixels opaque
and 29,144 transparent. It had only ever worked because the Add-data dialog
defaults opacity to 0.85 — **the touch-tight change made visibility depend on a
symbology default**, and the first caller that imported without symbology found
it. Anything drawn that close to the ground must be transparent-pass and
`depthWrite: false`, which is what the markers already did.
## A 23 MB GeoJSON through an uncached Cloudflare is a map that never arrives

"The hazard risk maps don't load on the live site." Every check said they
should: the objects were in the bucket byte for byte, `sources.json` carried
their fingerprints, every URL answered 206 with the right CORS header to the
production origin, and `audit-published.py` passed. None of that measures TIME.

**Cloudflare does not edge-cache `.geojson` or `.json`** — neither is on its
default list of cacheable extensions — so every request goes back to R2
(`cf-cache-status: DYNAMIC`) and is compressed **on the fly**. Measured on the
live bucket, one file, three encodings:

| cyclone-risk.geojson (23 MB) | |
| --- | --- |
| uncompressed | 93 KB/s, 4 s to first byte — about four minutes |
| gzip on the fly | **3.8 KB/s** |
| br/zstd, as a browser asks | 30 s for the 2.26 MB compressed body |

The page said "Loading…" the whole time and nothing errored. The 4.7 MB
volcanic grid loaded in seconds, which is why it looked like "some risk maps
are broken" rather than "big files are slow".

**Stored gzipped (`Content-Encoding: gzip`), Cloudflare passes the object
straight through**: 1.8 MB, **0.6 s**, and a browser's `fetch()` decodes it
transparently (91,156 features parsed in 510 ms). `publish-data.py` now does
that for every `.geojson` and `.json` — deterministic gzip, so an unchanged
file re-uploads as the same bytes — and never for a `.tif`, because a byte range
of a gzip stream is not a byte range of the file. **The fingerprint stays on the
uncompressed file**: an encoding is not a content change, so the fix went live
with no change to `sources.json` and no push of the site.

Measured on production after: cyclone risk **8.6 s** to a drawn 91,156-cell
layer, seismic risk 7.3 s (72,765), full-Holocene volcanic 6.3 s (13,650) — the
remainder is triangulation, not transfer.

**`content-encoding: gzip` does not prove an object is STORED gzipped** —
on-the-fly compression answers with it too, which is how the first version of
`publish-data.py --check` reported "all 40 stored gzipped" over a bucket where
none were. Stored gzip is served as the object itself: a `content-length` and a
strong ETag. On-the-fly is chunked with a **weak** ETag (`W/"…"`). The check
keys on that now, and it is the regression test for this whole fault.

**What is still slow, and the lasting cure.** Throughput from R2 still falls
away past a few MB stored: `cyclone-risk-years.json` is 5.9 MB even gzipped and
takes 12–37 s (it only loads when a season animation drives the risk map), and
the tile pyramids are `.mvt`, equally uncached — GLiM's 4.4 MB world tile took
25 s under on-the-fly compression. The cure for all of it is a Cloudflare
**Cache Rule** making `data.geoidinitiative.com` eligible for cache: every
object already carries `max-age=31536000, immutable` and a `?v=` fingerprint,
so edge caching is safe. That is an account setting, not something the repo can
do.

**When a live layer "doesn't load" and every status code is right, time the
body.** A `fetch` whose headers answer in 88 ms and whose body trickles in at
110 KB/s looks, from every other instrument, exactly like success.
## Global hydrography source files in R2, and the licence that kept rivers out

`r2:geoid-maps/shapefiles/`, which is public at
`https://data.geoidinitiative.com/shapefiles/`, holds the UNMODIFIED source
archives with a `README.txt` of attributions. Each was streamed in with
`rclone copyurl` (nothing staged on local disk, which had 5 GB free) and read
back in place with `ogrinfo` over `/vsizip//vsicurl/`:

| key | what | features | licence |
| --- | --- | --- | --- |
| `ocean/ne_10m_ocean.zip` | the ocean polygon | 1 | public domain |
| `ocean/ne_10m_geography_marine_polys.zip` | named oceans, seas, bays | 306 | public domain |
| `ocean/osm-water-polygons-split-4326-2026-09-10.zip` | coastline-exact sea | 53,328 | ODbL 1.0 |
| `lakes/HydroLAKES_polys_v10_shp.zip` | lakes and reservoirs of 10 ha or more | 1,427,688 | CC BY 4.0 |
| `rivers/GRWL_summaryStats_V01.01.zip` | river centrelines 30 m or wider, with widths | 42,077 | CC BY 4.0 |

**HydroRIVERS is deliberately NOT there.** It is free for commercial use,
which reads like permission to mirror it, but the HydroSHEDS licence
(Technical Documentation v1.4, Appendix A, §2.1.2–2.1.3) permits distribution
only "incorporated into any Derivative Works" to End Users under an EULA at
least as protective, says "in no event" as a "stand-alone product", and requires
the licensee to "protect against unauthorized copying and/or distribution". A
raw zip on a public bucket breaks all three. The upload was stopped mid-stream,
before it landed, and `list-multipart-uploads` confirmed that no parts were left.
HydroLAKES comes from the same group and is CC BY 4.0 in its own right, so it
IS fine. **Read the licence of each product, not the family's front page.**
GRWL is the redistributable global rivers source; the full network would need
a private bucket.

Two instrument notes. The shapefiles in HydroLAKES and the OSM water polygons
sit inside a folder in the zip, so `ogrinfo /vsizip/…zip` alone prints nothing:
give the nested `.shp` path. And a `curl -r 0-3` sent WITH a Referer came back
200 with the whole body on two of these objects, downloading 1.7 GB to
/dev/null. Check `size_download` before assuming a range was honoured.

These are source files, and the next section is what became of them.
## rclone strips an unchanged object's headers, and a publish armed it

Publishing ONE new file (the climate normals) left **41 of 42 JSON files
served uncompressed with no Cache-Control**, including the 23 MB cyclone grid
the live site reads. The same thing had happened to most tiles of every
pyramid re-baked today: **soil 12 of 12 sampled tiles, GLiM 9 of 12,
HydroLAKES 10 of 12**.

The mechanism is a feature. `rclone copy` skips an object that matches by
size and hash, but if its MTIME differs, rclone "updates" the mtime with a
server-side S3 copy that **REPLACES the metadata**. The `--header-upload`
values (`Content-Encoding: gzip`, the immutable Cache-Control) are dropped.
Our gzip is deterministic and a re-bake rewrites every tile, so an unchanged
file always differs by mtime alone. Every publish after the first therefore
stripped the headers from exactly the files that had not changed.

- **`--no-update-modtime`** on both scripts: an identical object is never
  touched.
- **`publish-data.py` stamps the staged gzip with the source file's mtime**,
  so an unchanged file matches and is skipped.
- **`--force`** (`--ignore-times`) is the repair. `publish-data` forces only
  the gzipped copy: the plain files go up from disk with real mtimes and were
  never touched, and forcing them re-sends the 800 MB population COG for
  nothing.
- **`publish-tiles --check` samples 24 tiles.** The one tile it used to read
  is the world tile, which a re-bake always changes, so it could never see
  this.

Verified: a normal publish after the repair leaves all 42 JSON files stored
gzipped with their cache header. Last-Modified on an object you did not mean
to change is the tell.
## A gitignored asset is a broken image on the live site and a perfect one here

"Why does the dashboard not match what is live?" The layout matched exactly.
What differed was one tile: the Etna card was a broken image on
geoidinitiative.com and fine on localhost.

**`earth_explorer/etna/viewer/assets/subsurface.png` is gitignored by name**
(.gitignore, beside the other nine Etna assets), because that viewer's imagery
was published to `assets/hotlink-ok/etna/` in the bucket. The dashboard tile
still named the LOCAL path. So the file was never committed, never deployed,
404 in production -- and invisible to every check made on this machine, where
the untracked file is still sitting on disk.

That is the whole shape of the fault, and it is worth stating as a rule: **a
path that is on disk AND untracked will serve locally and 404 in production.**
It cannot be caught by looking at a page in a dev server. The instrument is
git: take every asset path the site's HTML and CSS name, and check each against
`git ls-files`.

`audit-published.py` has a check for this and it did not fire. Its regex
anchors on a quote followed by `assets/` or `data/global/`, and this path
begins `/earth_explorer/`, so the `assets/` in it is mid-string and the pattern
never matched. **Widening it to any path is not the fix** -- tried, and it
reports 3,988 hits from CMake's own vendored documentation, then 52 more from
the planet manifests, whose bare filenames (`uranus_body_color.jpg`) are
resolved against the bucket at runtime and are not references to local files at
all. A correct check has to know which paths are RESOLVED and which are
FETCHED; that is a real piece of work rather than a wider regex, and it is not
done.

**A second breakage from the same migration, found beside it.** The Etna
landing page carried

    background: url('viewer/https://data.geoidinitiative.com/.../etna.jpg?v=...')

-- the publisher rewrote `viewer/assets/etna.jpg` into an absolute bucket URL
and left the `viewer/` in front of it. Live since the move. Grep for
`viewer/https://` after any such rewrite.
