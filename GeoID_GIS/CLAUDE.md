# GeoID_GIS — working notes

Facts that are expensive to re-derive and easy to get wrong. Everything here has
been verified in the browser, not inferred.

## Coordinate frames

Three frames stack, and mixing them is the most common bug in this viewer:

| frame | carries | what lives in it |
| --- | --- | --- |
| baseline | nothing | what `latLonToVector3` and `surfacePoint` return |
| globe spin | `rotation.y = getSpinDeltaRadians()` | where a coordinate *currently* is |
| `earthSceneGroup` | 23.44° axial tilt | world space |

`latLonToVector3(lat, lon, r)` and `surfacePoint(lat, lon, lift)` answer in the
**baseline** frame — where the texture is laid out, not where that place is now.
The globe turns with simulated UTC, so anything pinned to a coordinate must also
carry `getSpinDeltaRadians()` about Y. Parenting to the `globe` mesh is *not* the
shortcut: it carries a half-turn (`π + spin`) on top.

Symptom of getting this wrong: an offset that **grows through the day** rather
than being a fixed amount — it reads as a coordinate-convention error but isn't.
The viewer's own pin path (`earth-viewer.js:14041`) is the reference.

Groups that already hold the spin: `eonet-spin-frame` (events),
`GeoID-ImportedGeoLayers` (imports). GEE drapes instead parent to `globe` and
bake the π back in themselves.

When comparing geometry against coordinates in a test, compare **raw local
positions**, not `matrixWorld` — the latter adds the 23.44° tilt and will show a
spurious ~23° error.

## Draping onto the globe

Never `radius + offset`. The basemap is displaced by the relief: at the default
setting its surface spans **3.2095–3.2989** against a base radius of 3.2, so a
flat `3.2 + 0.006` sits under the terrain everywhere, ocean included. Use
`viewer.surfacePoint(lat, lon, lift)`, which follows the relief and the terrain
slider.

Two further traps for surface-hugging geometry:

- **Chords sag.** A straight segment across 12° of arc dips 0.0175 below the
  surface — well past any sane clearance. Split long spans (1° keeps sag at
  0.0001).
- **Flat facets lose to displaced terrain.** A tessellated patch cannot win on
  depth against relief that has detail below any grid: 96→384 segments only
  moves the worst gap 0.0267→0.0234. The GEE drapes therefore use
  `depthTest: false` plus single-sided rendering so the far hemisphere is still
  culled, rather than trying to out-clearance the problem.

## Draw order

| band | what |
| --- | --- |
| 0–7 | viewer basemap shells |
| 39–40 | streamed tiles |
| **50+** | imported / GEE layers (`IMPORTED_BASE` in `layer-hierarchy.js`) |
| 199–222 | viewer pins, labels, selection rings |
| **230** | event markers |

`applyStack()` overwrites `renderOrder` on imported layers, so setting it at
build time in an adapter does nothing.

## Switching the basemap off

Drops `colorWrite`, not `visible`. A mesh that is not drawn writes no depth and
the planet stops occluding — the moon's orbit line and far-side event markers
then show through it.

## The myGeoID disclaimer is armed by myGeoID, not by the page

The gate in `geohub/index.html` ran on EVERY LOAD and held the whole shell
inert until acknowledged — which is why it had been switched off in
development (`DEMO_DISCLAIMER_GATE = false`, the modal `.remove()`d). Both
states were wrong: on, it stood in front of Earth exploration, the Model
Builder and the Research Hub, none of which show a synthetic hazard value;
off, the page went on presenting myGeoID's made-up numbers as though they
were readings, which is the one thing the gate exists to say out loud.

It is scoped to its subject now, and the trigger is exact rather than
approximate. **myGeoID IS "the GIS page with the hub armed"** — mode-manager's
own `armed = currentMode === "gis" && hubArmed` — and the viewer already
reports precisely that to the shell as mode `"geoid"` over the postMessage
bridge. So arming raises the gate and nothing else does. (Worth checking
before trusting: `"geoid"` looks like it might conflate the myGeoID MODE with
"GIS + hub armed", and it does not — they are the same state.)

- **Acknowledged once per SESSION** (`sessionStorage`), not per arming: a
  modal that returns on every toggle is a nag, and one that never returns
  after a restart makes a claim about somebody's memory that a disclaimer
  should not make. A storage that throws (private window) asks again rather
  than failing open.
- **"Leave myGeoID" is the second door.** A gate whose only action is Continue
  is a notice wearing a gate's clothes. It stands the mode down through
  `setHubArmed` — the same seam the Enter button uses — via a `message`
  listener in mode-manager, so declining cannot leave the mode running behind
  a dismissed warning.
- **`.demo-disclaimer-backdrop` is `display: flex`, which outranks the `hidden`
  attribute**, so `[hidden]` is spelled out with `!important`. Without it the
  modal shows on every load — exactly the behaviour being removed.

Verified live end to end: nothing on load (page live, `pointer-events: auto`);
arming raises it with the rest of the shell inert and Continue disabled until
the box is ticked; Cancel closes it, leaves the key unset AND disarms the
mode; Accept closes it, keeps the mode armed, and re-arming does not ask
again this session.

## The names: GeoHUB, and myGeoID inside it

**GeoHUB is the workspace; myGeoID is a product made in it.** The page at
`/geohub/` is the whole thing — the GIS globe, the planetary explorers, the
Mesh Studio and the Research Hub. **myGeoID** is the risk mapping built on that
GIS page: the Factor-of-Safety pipeline in `geoid-mode.js` and
`geoid-pipeline.js`, which is why the sidebar section that arms it is named
myGeoID and the page is not.

What that means when editing copy: a mention of myGeoID that describes a
personal hazard dashboard, a Factor of Safety, or the funding case is **the
product** and keeps its name — `about_myGeoID/` is entirely about that and did
not move. A mention that names the app, the page or the shell is **GeoHUB**. The
tell is usually the link: text on an `href="/geohub/"` names the workspace.

**The old path still answers.** `/myGeoID/` is a stub that redirects to
`/geohub/`, carries `rel=canonical` to it and `noindex` on itself, because that
path is in bookmarks, in shared links and in search results. Internal links all
point at `/geohub/`. The service-worker cache version had to move with it
(`geoid-site-v40`) or a returning visitor keeps a precached nav that still says
myGeoID and still links to the old path.

Internal identifiers were deliberately NOT renamed: `geoid-gis:view-mode`, the
`geoid` mode id, `#gis-group-geoid`, `geoid-mode.js`. They are storage keys and
element ids with no user-visible surface, and churning them risks behaviour for
no gain. The CSS wordmark classes gained `.geohub-word`/`.geohub-prefix`
alongside the `.mygeoid-*` pair rather than replacing it, since the product may
still want the same two-tone treatment.

## Where things actually live

- Runtime manifest: **`earth-manifest.js`** (inline object). `manifest.json` on
  disk is stale and unused.
- Basemap assets resolve to `/GeoID_Earth/assets/…`, shared with the Earth
  Explorer and Moon viewers — do not delete them when swapping a layer out.
- The Analysis Hub is in the **shell** (`geohub/index.html`), not the viewer.
  Opening it shrinks the iframe to ~400px, which trips
  `@media (max-height: 560px) and (orientation: landscape)` in `styles.css` —
  that block restyles `#ui` (narrower, 0.5rem inset, z-index 20) and anything
  positioned relative to the panel must be given matching overrides there.

## The viewer eats the space bar

Every viewer binds a document-level `keydown` that intercepts **Space** to
pause/resume the globe spin, `preventDefault()`s it, and **blurs the focused
element** so a repeated press cannot accumulate on a control
(`earth-viewer.js:1107` and its equivalent in each planet viewer).

The Research Hub and the GIS panels live in that same document, so every text
field inherited it: typing a space vanished and the field lost focus, and a
project description could only ever be **one word long**. The handler now bails
out for text entry — `textarea`, `contenteditable`, and `input` except
checkbox/radio/button/submit/reset/range/file/color — and is otherwise
unchanged, so space still pauses the globe from a focused checkbox rather than
toggling it.

The Saturn/Jupiter/Neptune/Uranus lineage was written differently and already
guarded INPUT/TEXTAREA/SELECT, so it never had the bug. Any *new* document-level
key handler must make the same exemption.

## Cache-busting

**Run `python3 GeoID_GIS/services/stamp.py`** after editing anything under
`GeoID_GIS/viewer/`. Never edit a `?v=` by hand.

**A backtick inside a CSS template literal ends the string.** A comment in
zoom-bar.js's `STYLE` referred to `` `fitLabel()` `` in backticks; the module
became unparseable from that point, `installZoomBar` never ran, and the control
vanished from the page entirely while the script tag still loaded and the seam
still reported ready — it looks like a placement bug, not a syntax error. The
unit suite imports every one of these modules and says so in one line; that
change was committed without re-running it. **Run `tests/run.mjs` before the
commit, not after the browser disagrees.**

Every import carries `?v=<stamp>`; a stale one serves an old module. Worse, a
*split* one duplicates it: module identity is by URL, so
`project-store.js?v=a` and `project-store.js?v=b` are two modules with two
`active` projects, and the GIS page and the Research Hub silently stop sharing
a store. That is exactly what a hand-run find-and-replace caused — launched
from inside `gis/research/`, it missed `gis/shell.js` and left half the tree on
each stamp. `stamp.py --check` exits non-zero when the tree is not uniform and
is the thing to put in a pre-commit hook.

Never version `../vendor/three.module.js` — `earth-viewer.js` imports it
unversioned and a second copy breaks class identity.

**The stamp is the git sha, so an uncommitted edit re-stamps to the SAME
value** — and the browser then serves its cached copy of anything at that URL.
A whole verify loop ran against a stale `qt-spec.json` this way, chasing two
ghost buttons that the disk no longer contained; grep said clean, the fetch
said Thesis, and both were right. Commit first (the amend dance), stamp, then
verify. Never trust a verification made on a reused stamp.

**A factory parameter bound to a literal is a constant inside the body.**
`_make_input_card("Training Dataset", "CSV / NetCDF…", field, …)` passes the
card's title and description as strings; binding only variables left every
card's `QLabel(title)` with no text, which is most of why AI Trainer "looked a
mess" next to its reference. Renames must also cover the spec's plain string
lists — "buttons" — or the completion appends the old name as a disabled ghost
beside its renamed, wired twin.

**A control the tree rendered is recognised by its data-var, not its text.** A
`<select>` has no placeholder attribute, so the text-based scrape could not see
AI Trainer's live data-bus combo and appended a dead duplicate.

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

## Satellites: a live layer through the ordinary machinery

The Satellites tab (`gis/satellites.js`) fetches TLEs from CelesTrak
(stations + the ~100 brightest + the navigation constellations, CORS-open)
and propagates them in the browser with the vendored `satellite.js` (SGP4,
MIT). Elements-plus-SGP4 IS the live position — nobody streams coordinates
without a key.

The satellites are the one thing on this globe genuinely NOT on the surface
— a GPS satellite orbits three Earth radii up — so the layer draws its own
round dots at `3.2 × (1 + altitude/6371)`, parented into the imported-geo
group so the existing per-frame spin sync carries them like a coastline.
What it keeps of the ordinary machinery: the layer row and eye
(`addDerivedLayer`), the legend, and the corner card — a raycast pick (the
one picker in the app that targets true 3D points, because `featuresAt`
answers ground coordinates and an oblique satellite is nowhere near its
sub-satellite point on screen) hands the same item to the same
`openSceneFeature`. Items carry `no_flash`: the temporary golden ground
label would mark the wrong place. Orbit paths are a togglable single merged
LineSegments — each orbit sampled once in ECI, frozen to the ground frame at
build, then the ring group counter-rotates by the sidereal angle per tick,
because an orbit plane is fixed among the stars: one rotation instead of
forty thousand re-propagations.

Satellite labels are the viewer's OWN pill after all —
`makeLabelTexture` through the seam, category colour as the accent bar,
darker HUD backing, backingScale 2 (forty names, not four), 15→11 px on
screen. Two bespoke themes were tried first (a chamfered strip, then bare
haloed micro-type) and each was reported worse than the engine's chip —
oversized, then smeared and uninteractive. Labels are CLICKABLE via
`tagAt()`, a SCREEN-space rect test (a raycast cannot pick
sizeAttenuation:false sprites — their drawn size is a screen fact), tried
between the dots and the rings. And the dots/rings/tags live in nested
keepRenderOrder bands 198/199/206: `applyStack` stamps every node on each
hierarchy change and was flattening them into the data band, where a
depth-test-off tile drape (the Esri refine patch) painted straight over
dots and orbits at close zoom — nodes carrying `userData.keepRenderOrder`
are now skipped by the stamp, a flag strictly for deliberate nested
bands. The
tags render depth-test-OFF in a nested group with renderOrder 206 — the
nested-group groupOrder reset, used deliberately this time, lifts them out
of the data band the hierarchy stamps on the layer, or every orbit line
draws over them — and the occlusion the depth buffer would have done is
answered geometrically (`occludedByGlobe`), so far-side satellites carry no
tags. Earlier the labels were the module's own sprites wearing the viewer's
own chip: the
label engine anchors to surface points at build time, which is exactly wrong
for dots that float at altitude and move every tick, so `makeLabelTexture`
is exposed on the seam and the satellites draw the pill themselves with the
category colour as the accent. A Labels slider (0–3) picks which categories
compete; a per-tick screen declutter caps 40. Seven groups now (~1,700
objects) — fetched SEQUENTIALLY with a beat between requests, because
CelesTrak throttles rapid parallel queries into empty 200s (`geo` and
`science` arrived blank until spaced). Every group draws rings now — a dot
with no line was reported as broken, whatever the restraint behind it —
with OneWeb's 651 near-identical polar orbits FADED (per-category ring
opacity, 0.09 against the 0.35 default) so the shell reads as the lattice
it is without drowning every other orbit.

**Rings are sampled uniformly in ECCENTRIC ANOMALY, and complete rings are
closed by hand.** Uniform time IS uniform mean anomaly, so an eccentric
orbit gets almost no samples at perigee — its fastest, tightest arc.
Measured: Cluster II (e ≈ 0.9) drew 5.9-unit straight chords against a
1.05-unit ring mean, slicing across the whole scene — reported as "broken
orbit lines". `sampleOrbitPoints` steps the eccentric anomaly (the
ellipse's own parametric angle: smooth chords everywhere, identical to
uniform time at e = 0) from the satellite's CURRENT mean anomaly through
Kepler's equation (`eccentricFromMean`, Newton, pinned in the test), so
the dense samples land on the true perigee. And nodal precession moves the
plane ~0.4° during the very period sampled, so a ring's last point never
met its first — a ~6 px notch in every LEO ring at the default view; the
seam is snapped shut, since the half-degree of physics is invisible and
the gap is not. Both the mass rings and the solo hover/selection overlays
draw from this one sampler. Measured after: 1,614 of 1,614 live satellites
ringed, zero segments over 4× their ring's mean, zero open seams.

The orbit rings are interactive: the merged mesh records a per-SEGMENT owner
at build (the raycaster answers with a vertex index; index/2 is the segment),
so a click on any ring resolves its satellite and opens the same card the dot
would. Hover copies that orbit's own vertices into a small overlay line
(brightened, cursor to pointer) — throttled, because a raycast against 30k
segments per mousemove turns a pan into a slideshow. Selection pulses the dot
(a one-vertex gold Points overlay) and the orbit (a second overlay) in the
same gold the label selection wears; both overlays are CHILDREN of the ring
mesh so they inherit the sidereal counter-rotation, and the pulse loop ends
itself by polling the scene card's visibility — one boolean a frame against
wiring into every close path the viewer has.

Per-category toggles (the Locations pattern): a checklist with legend
swatches hides a category's dots (parked at the planet's centre, like
decayed objects, with `hidden` excluding them from pickers and tags), its
ring mesh — the merged ring buffer became ONE MESH PER CATEGORY so a toggle
is a visibility flip, not a rebuild — and its selection. The volcano layer
got the same: type toggles filter `layer.features` against a kept master
list so dots, picks and labels answer from one filtered set, with colours
looked up from the WORN legend rather than re-derived (`categoricalSymbology`
assigns by frequency, and filtering changes the frequencies). The type list
draws on the `symbology` announce event, because the legend it is built from
lands a beat after the layer registers.

**The satellites master toggle: set BOTH boxes before telling EITHER.** The
old master handler ticked the tracker, then POLLED for `active` before
ticking the orbits — and the poll was the bug, not just redundant. While it
waited, the tracker's own handler finished start() and ran syncMaster, which
saw tracker-on/orbits-off, unticked the master ("all" was not yet true), and
the poll's stale-check read that untick as the user changing their mind and
aborted: dots plotted, master off, orbits never drawn. start() reads the
orbits box ITSELF at its finish line, so with both checked states set first
one start plots dots and paths together, any mid-start sync sees settled
intent, and no poll exists. The orbits box is `checked` from birth in the
markup — the paths are half of what the tracker shows. Verified: every state
sample through a full CelesTrak load reads master/tracker/orbits = 1/1/1.

**Satellite labels: three faults, one report.** (1) `tagAt` computed the
pill's centre and then subtracted ANOTHER half width — the hit zone sat half
a pill left of the pill, right half dead. (2) The layer's feature
coordinates are live SUBSATELLITE points, so the shared ground picker
(hover + click) caught clicks on the SURFACE three Earth radii under the
dot and drew its highlight down there — and a missed pill click closed the
card the satellites' own picker had just opened. `groundPick: false` on the
layer record opts it out; `featuresAt` honours the flag. (3) Pick order is
PAINT order: tags render at 206 above the dot cloud, but dots were tried
first with a 12 px threshold, so a dot near a pill's face stole its click —
measured, a click on FREGAT DEB's pill opened ONEWEB-0085's card. Tags
first now; a bare dot still answers through the dot path since its own pill
sits beside it, not over it. Also the pill FONT — and the blur was
ARITHMETIC, not (only) the face. The engine bakes a 34-logical-px pill; at
backingScale 4 that is a 136 px texture drawn at 13–18 px — a 7.5×
minification whose mip chain softens ANY font. Crisp HUD text is baked AT
its drawn size: backingScale = ceil(devicePixelRatio), `generateMipmaps =
false`, plain LinearFilter. Two attempts got this wrong before the number
was right: backingScale 4 (7.5× minified, mush), then ceil(DPR) with mipmaps
OFF (2.08× UNDERSAMPLED — thin strokes drop texels, the type reads crunchy
and vertically stretched; no-mipmap linear is only safe at ≤1.3×). The
answer is texel-for-pixel: `backingScale = (TAG_HEIGHT_PX × DPR) / 34`,
fractional and all, so the canvas rasteriser hints the glyphs at their final
size, with the engine's mipmaps kept for the far-zoom shrink. Measured:
77×24 texture drawn at 72.5×22.4 CSS on DPR 1 — 1.07 texels per device
pixel, aspect matched to 0.8%. And the SIZE was half of every "change the
font" report: at 18 px pills the title was ~8 px tall, below what any face
can carry; TAG_HEIGHT_PX settled at **17** — 24 was legible
and reported MASSIVE, reading as UI rather than annotation. The reference is
the curated location labels, which are world-sized (0.112 units) and measure
~18 px at the default globe view; 17 puts the two kinds of chip at the same
visual weight where they are seen together (measured side by side: pills
15.9 px, curated 13.7 px at one view). The texel-for-pixel baking scales
WITH the constant, so the size is now a pure look decision — sharpness no
longer rides on it. The face is **'Exo 2'** — which viewer-skin serves
as Chakra Petch glyphs; there is NO family loaded under the name "Chakra
Petch", so naming it first fell through the stack while looking like a
choice (my own first fix did exactly that, and "the labels are unchanged"
was the report). `makeLabelTexture` takes `titleFont`; cache key v6.

**The selected pill goes GOLD and glows — it does not breathe.** A label
that changes size cannot be read while you look at it, so the scale pulse
was replaced the day after it shipped: select() swaps the sprite's map to a
REBAKED chip in the selection gold (#ffbf6f, the dot and orbit's own) —
never a material tint, which multiplies the whole texture and muddies the
text — and the pulse loop varies opacity alone (0.72–1.0). The rest-state
map rides on the sprite; deselect swaps it back. Deselect-on-card-close is
the pulse loop's own rAF poll, the mechanism the dot and orbit always used
— which also means NONE of the glow is measurable in a hidden pane, where
rAF is throttled to ~1 frame/1.5 s (measured); state checks (map swapped,
scale constant) are the verifiable part there. The pill is the engine's default chip VERBATIM
now — palette included: the category-coloured space-HUD skin was the last
custom piece and, like the chamfered strip and the bare haloed type before
it, it read as a different app beside the Explorer labels. The category
colour lives on the dot, the ring and the legend, where it always did; the
gold SELECTION variant is the one re-inked chip that remains, and the only
custom parameter left is the texel-for-pixel backing, which changes
sharpness and not looks. Verified side by side in one screenshot: satellite
chips and curated location chips indistinguishable in design and scale.
One engine constant had to become an option for the marriage to work:
`makeLabelTexture`'s **110 px minimum width** suits the curated place names
it was set for and swamps a three-letter satellite name — "HST" was a chip
mostly made of empty backing, reported as oversized. `minWidth` (default
110, satellites pass 0) lets short names hug their text: measured, SWAS at
44 px against the ~70 the floor forced. And a selection-gold coincidence
worth knowing: Hubble's old CATEGORY colour was #ffc400 amber, a near-match
for the selection gold #ffbf6f — a selected HST reads as "the old amber
chip is back" when it is the gold variant doing its job.
Verified: 4 of 4 clicks on pill right-thirds open that pill's own card.

**"Copy the labels verbatim" includes the SIZING LAW, and that was the last
and largest gap.** Five rounds of texture fixes (font, backing, palette,
minimum width) all landed while the pills were still pinned to a fixed
screen size (`sizeAttenuation: false`, 13.6–17 px) — and the curated chips
are WORLD-SIZED sprites whose scale runs the engine's own easing
(`labelScale` 0.12 → 1.35 on `((distance − 0.2)/6.2)^0.85`, capped at 24 px
drawn). Two chips can share every texel and still not match anywhere but
the single view the constant was tuned for; from any other zoom, every
texture fix reads as "zero change", which is exactly what was reported. The
pills now carry the curated base scale (`texture/200 × 0.66` world units,
sizeAttenuation default TRUE) and earth-viewer's scale pass verbatim,
against each tag's own camera distance (its anchor is the dot, not the
ground). With the sizes now matching by construction the bespoke
texel-for-pixel bake went too — the engine default backing IS the matching
sharpness. `tagAt` converts the world scale back to pixels through the same
`fovScale / distance` the scale pass uses. Measured: 13–19 px at the
default view (curated band 13.7–18), ~21 px at 4,000 km easing into the
cap, 2–6 px with the whole GNSS shell in frame — and a click on ASTROSAT's
pill opens ASTROSAT. When a chip "looks wrong" beside a reference chip,
diff the SIZING MODEL before the texture: a screen-pinned sprite and a
world-sized one can never agree at more than one distance.

**The rotation control is ONE pill in a three-state loop** — LIVE (real
rate, clock snapped to now; the BOOT DEFAULT) → ×720 (the two-minute
showcase day) → PAUSED (rotation held) → LIVE. It absorbed the old
`#spin-toggle` pause button, which stays in the page hidden (the viewer
reads and writes it unguarded, and the space bar still runs through the
same `pauseSpin` the pill reports — `pauseSpin`/`resumeSpin` call
`syncTimeRateBtn`, which looks its element up per call to dodge the TDZ of
setup-order). The camera "freeze view" snowflake is retired from the
corner too — hidden, its element and wiring intact. The DIGITAL CLOCK sits top-centre,
showing the model's moment at whatever rate the pill chose (250 ms
writes, so ×720 does not stutter). Its face is the ASCENT corner clock's
DRAWN seven-segment display (everest/game/hud.js), not a font — lit
segments with a glow over ghosted unlit ones, the canvas skewed −8° —
re-inked in this page's data cyan, redrawn only when the text changes.
(A collapse caret existed briefly and was removed as clutter — the box is
date over digits over a small tracked UTC, every row centred, and tracked
text needs its trailing letter-space pulled back or it sits off-centre.)
Clicking the clock opens the SCRUBBER: a UTC datetime field with Go/Now, driving `setSimulatedUtcMs(ms)`
on the seam —
same rebase as entering real time with an arbitrary target, so the spin
phase, sun, readout and satellites land on that moment together (verified:
scrub +1 day re-propagated all dots, none dead). Scrubbed away from now at
the real rate the pill reads ×1, because LIVE claims "now".

**TLEs are cached in localStorage per group** (`geoid-tle-<group>`, 5-day
shelf life): a successful fetch saves the raw text, a failed or empty one
falls back to the stored copy, and the status SAYS so with the age ("7 of
7 groups from stored elements (3 h old) — CelesTrak is rate-limiting")
rather than letting stored data pass as fresh. Only when there is neither
an answer nor a cache does the tracker give up, and that message now
explains the rate-limiting instead of the bare "CelesTrak did not answer."

**The globe has a time rate, and the corner pill switches it.** Everything
temporal — spin delta, simulated UTC, the sun and so the terminator, the
GMT readout — derives from `getSpinTime()`, so the rate is layered there
and nowhere else (`timeRateFactor` over the pause-aware wall clock, rebased
on every switch). "×720" is the showcase: a day every two minutes. "LIVE"
is real time: the true 15°/hour, and entering it SNAPS the clock to actual
UTC now (a real rate against a wrong phase still lights the wrong
hemisphere); leaving it keeps continuity — the clock runs on from where it
stands, just faster. Seams: `setTimeRate("real"|"lapse")` / `getTimeRate()`
beside `setSpinPaused`. The satellites propagate at `getSimulatedUtcMs()`
(via `simNow()`), not the wall clock — one clock for everything, which is
what forecast playback will hang off (scrub the base, pick a rate).
Tracking auto-drops to real time and remembers the switch was its own, so
stop() restores the time-lapse only if nobody chose otherwise meanwhile.
Verified by measurement: 0.05236 rad/s in lapse and 7.272e-5 in real —
2π/120 and 2π/86400 exactly — clock snapped to within 0.3 ms of Date.now(),
pause frozen at zero drift under both rates.

**The satellites open the ordinary symbology dialog.** The tab's Symbology
button hands the live layer to `openSymbologyDialog`, wired through three
things on the layer: `features` (the records' own feature objects, whose
properties tick() refreshes), `repaint` (the vector contract — a
colour-of-feature function returning a CSS string — which writes each
record's `colour` and calls `recolourAll()`: dot vertex colours, every ring
mesh's per-segment colours, the baked tag textures dropped for redraw, and
the tab's category swatches), and `cataloguePalette` so opening on the
category column proposes the colours the layer already wears. Everything
that inks a colour goes through `colourFor(record)` — the dialog's choice,
else `CATEGORY_COLOURS` — so rings built after a paint inherit it and rings
built before are rewritten in place. The default palette is VIVID on
purpose (the pastel first draft was reported as indistinguishable);
OneWeb stays muted because 650 identical dots flood any hue.

**CelesTrak escalates from throttle to 403.** Rapid parallel queries get
empty 200s; sustained volume (a day of testing) gets **403 Forbidden for
the whole IP**, curl and browser alike, lasting hours. The tab reports it
as "CelesTrak did not answer." — that status is the diagnosis, not a bug.
To verify satellite features while blocked, snapshot or synthesise TLEs
(vary catalog number + RAAN off a known-good line, recompute the mod-10
digit-sum checksum), serve them locally and monkeypatch `window.fetch` for
celestrak URLs in the page.

Three traps, all found by measuring:

- **The import COPIES the collection** (`importFileList` serialises to a
  File and the layer parses its own copy) — learned in the first, draped
  version, and the reason the rewrite keeps its own feature objects and
  never round-trips them through the importer.
- **`label_rank: 0` on every feature** is the layer's declaration that its
  points speak the card contract WITHOUT ever growing labels (which would go
  stale in 1.5 s). `sceneItemFor`'s gate accepts a layer where the column
  exists, not only where something ranks above zero; `featureToItem` maps
  `kind` (the kicker for non-volcano layers) and `dimension`.
- satellite.js v5 calls the mean motion `no`, not `no_kozai`.

**The active-data fill reaches SUB-tabs too** (`markSubsections` in
section-activity). Level 1 is marked from the import manager by subject;
a sub-tab cannot be found that way, so it reads its own controls — but
only ones that mean "a dataset is ON", listed in `DATA_CONTROLS` rather
than inferred. Two false-positive classes were measured and excluded: a
first pass counted every ticked box and lit Geoprocessing, Map View and
Extract From Layers, whose ticks are OPTIONS; and the satellite CATEGORY
filters plus the orbit-paths default lit Satellites before the tracker
was running. Base-texture rows are excluded for the same reason (a sphere
always wears one). And a section the LAYER pass owns keeps that answer —
`markSubsections` ORs it in rather than overwriting, or the Satellites
sub-tab would go dark the moment the layer pass and the tick pass
disagreed.

## The nav bar is the subject taxonomy, two tiers deep

**The &#9432; help modal (`#viewer-help-overlay`) documents THIS UI.** It
described the pre-GIS viewer for months ("open the Tools panel from the
right-hand tab") and was rewritten to walk the real one: the taxonomy
bar, the Workspace box and its icon doorways, the rail tools, fetch by
extent, the timezone clock, the live feeds and the workflow into the
Model Builder. When the GUI moves again, this modal moves with it — a
guide describing a previous app is worse than none.

The tab column reads: **Workspace** first (Vector & Shapefiles renamed —
the working set opens the column), then **Live** (the Events group renamed),
then Explorer,
**Hazards** (Geohazards renamed, the myGeoID mode bar nested at its top),
**Earth System Observation** (Atmosphere renamed, reading Atmosphere /
Hydrology / Satellites as level-2 sub-tabs — the Atmosphere one wraps the
weather card, which mounts into `#atmosphere-weather-host`, and the Earth
Engine datasets; the GEE **Service** endpoint form is configuration, so it
lives in the Settings group markup, shipped `hidden` and un-hidden by
gee.js, which only runs on Earth — that gate is what keeps a dead
endpoint form off the nine planet pages), **Geology**,
**Basemaps** (Basemap and Relief renamed — the imagery, GEBCO and the GEE
DEM share), then Basemaps, Geology, Earth System Observation, Hazards (Workspace
holds imports and drawn shapes only: the homeless global catalogue of reference shapes, graticule,
borders, countries and the submarine cables, mounts in Basemaps now via
the `#polygon-catalogue` host moved into Earth's markup, which also stops
Earth reference shapes being offered on Mars), then Meshes and Metadata.
Inside the Basemaps tab the CONTOUR controls are catalogue rows now: a
"Terrain" group at the foot of the Overlays list, one row per interval,
radio-like (the viewer draws one at a time; unticking the active one is
"None"), each row's Symbology… unfolding a shared line of colour+opacity
PROXIES. The real `#contour-*` controls stay in the page hidden inside
`#contour-controls` — earth-viewer reads all three by id unguarded — and
the rows are re-appended after every `renderCatalogue` wipe, reading
ticked state from the hidden select each time (the select is the state).
Only the Terrain relief slider sits between the two catalogues.
The two catalogues are titled for what they hold —
**Basemaps** (the base-texture radio plus raster overlays, from
map-layers-panel) over **Overlays** (the vector reference shapes, from
polygons.js) — and the old "Street map & satellite imagery" collapsible is
GONE: its whole-globe path was the catalogue tick said twice. The footer
then slimmed AGAIN on report ("what is all this? … remove"): the
detail-from select, sharpen toggle, study-area drape button and the
tile-count status are gone — sharpening simply runs whenever a tile
basemap is selected, and `drapeStudyArea` survives exported but doorless.
The attribution briefly
lived as a corner overlay and was then REINSTATED under the Basemaps box
by request (`#basemap-attribution`, after `#basemap-catalogue-status`).
What it shows is one compact credit line and a short-form licence tag
(full text in the tooltip; split on dash or SENTENCE stop — a bare [.]
split cut "CC BY-NC-SA 4.0" at its own decimal). The attribution CANNOT
be removed outright: EOX and Esri license on condition of being named,
and it still tracks `base-layer-select` both ways. The
rule that filed it: Live holds what HAPPENED (timestamped feeds), Hazards
what COULD, Geology what the ground IS — one dataset, one home. Metadata
stays a single tab on purpose: provenance is a property of a layer, not a
subject, and each layer's row already carries its own source line —
splitting it per tab is seven filtered copies of one registry.

Mechanics worth knowing before touching it: the nests are MOVES entries
(`sea-level-section` → `earth-system-water-host`, `satellites-section` →
`earth-system-satellites-host`, `gis-group-geoid` →
`hazards-mygeoid-host` — the myGeoID mode bar leads the Hazards tab,
because the FoS pipeline IS the landslide product, and the tracker lives
with the sensors it flies) carrying **`unlessDropped`** — on a body whose
registry drops the parent tab, the child is NOT nested into a hidden tab;
`tabsForBody` re-lists it as a top tab at the parent's own position, which
is how Mars keeps its Sea Level reachable while Earth folds it into Earth
System — and a section a body drops in its own right is never re-listed
by that rule, or Mars would resurrect the Earth-only myGeoID bar. Section
IDS ARE UNCHANGED everywhere (the `sea-level-section`
lesson: three modules address them by id); only heading text moved.
`section-activity` propagates a nested section's `has-active-data` to its
closest `.toolbox-group` ancestor read from the DOM — the nesting is
per-body, and the DOM is the one place that knows which shape this world
got. Status copy naming the old tab ("Listed in Vectors & Shapes") moved
with it ("Listed in My Data") in gee.js and gee-live.js.

**An ADOPTED layer states its provenance on `info`, and the panel read
only `metadata`.** So Live events showed "Source: user import, CRS:
unstated" over a NASA feed while the correct credits sat one property
away, unread — the same for the satellite tracker. Layer Provenance now
reads BOTH (metadata first, so an import that states both is unchanged),
and the live layers state their sources BY NAME as well as by licence:
`sourceNames()` maps each feed's kind to its publisher ("USGS earthquake
catalogue · GDACS (EC JRC) · NASA EONET") while `sourceCredits()` keeps
the licence line, and both go onto `metadata` with CRS, format and count
— restated on every refresh, because which feeds are on IS the
provenance and it changes as they are ticked. Verified rendered: "Format
live GeoJSON feed · Source USGS earthquake catalogue · GDACS (EC JRC) ·
NASA EONET · CRS EPSG:4326 · Features 428 · Citation …".

## The attribute table is a window, and a CSV had nothing in it to edit

`gis/table-editor.js` — "Table" in a layer's own drawer — opens the rows over
the globe. The window was the small half of this.

**A CSV's columns were thrown away on import.** `csv`/`xyz`/`pts`/`txt` all
go through `loadXyzPoints`, which keeps x, y, z and a magnitude and drops
everything else: right for a point cloud, and it means a list of sample sites
arrives on the globe with its names, depths and notes already gone — the
values existed only in a file the app no longer held. The reader keeps the
source TEXT on the layer now (`layer.source`, capped at 8 MB; a LiDAR dump is
not a spreadsheet) and the window edits that: every column, as it came.

**A delimited layer saves as a file of the SAME KIND**, re-read by the same
reader with `columns: layer.source.mapping` — the mapping it was read with,
or the reader re-guesses and a hand-chosen lat/lon pairing is undone by a save
that changed nothing else. Saving it as GeoJSON would quietly change what the
layer IS: a point cloud becoming a feature collection, drawn and sampled
differently, on an edit that was only ever about its numbers.

Feature layers are edited as features, lat and lon first for point layers
because that is where a CSV puts them. Lines and polygons keep their
geometry. Saving goes through `importFileList` — the one importer — so this
is not a second path into the renderer; the edit is therefore a NEW layer and
visibility, opacity, the data tag and its note are carried across by hand,
which is the rebuild rule the tiled geology documents.

Four ways a grid editor loses data silently, all pinned in
`table-editor.test.mjs`:

- **Geometry looked up by INDEX** hands row 3's outline to row 2 the moment a
  row above them is deleted — every attribute right, every shape one place
  out. It rides on the row instead.
- **`Number("")` is ZERO**, so a blanked latitude passes `isFinite` and
  writes a point at 0°N 0°E. This codebase has been to the Gulf of Guinea
  once already, with a station list whose blank rows came back as real
  stations; an emptied cell means "no coordinate" and the row is dropped,
  counted, and reported.
- **Rows past the display cap** are kept, or a save deletes the part of the
  layer nobody could see.
- **`data_type`/`data_note` are the app's own bookkeeping** (data-tags mirrors
  the classification into the first feature so a project restores it). Hidden
  from the grid, since the drawer owns that control and two places to edit one
  value is how they drift — and carried through a save untouched.

**The drawer opens from the row's `[data-role="disclose"]`, not from the
row.** A probe that clicks the row finds nothing and reads as a missing
button; the same trap the layer-drawer note already records.

## Workspace IS the corner box, and every input wears a data tag

The always-visible corner box (`#layer-dock`, headed "Workspace") holds
the whole data workflow: `dockLayers` moves the old Workspace tab's
control-stack (+ Data / + GEE / Custom, status, notes) into the dock body
after `#workspace-add-host` (which add-data.js targets for the vector
role — by DOCUMENT lookup, since the row no longer lives in the panel it
is keyed to), then the layer hierarchy under it; the emptied
`gis-group-polygons` shell hides and its id left TAB_ORDER. **The merger
ran the other way first — hierarchy nested into a Workspace TAB — and was
rejected in one look: the box, not the tab, is the thing that must stay
visible while the nav bar is open.** The import cards stay dead (a card
beside a hierarchy row was two controls for one layer; their "N polygons"
count text was noise), and the dock body grew to min(42vh, 20rem) for its
new contents (both stylesheets).

**An empty status line is not a line, and it was two thirds of the dock's
head gap.** A band of dead space sat between the Workspace head and the first
layer row — measured at **21.6 px** on a dock holding two layers, of which
only the body's own 7.2 px of padding was intentional. The rest was
scaffolding for content that was not there: `#polygon-file`, `#polygon-status`
and `#polygon-list` stay in the dock body because polygons.js addresses them
by id, and for most of a session all three are empty — but an empty paragraph
keeps its 4 px top margin, and the `.control-stack` around them is a GRID,
which lays its 10.4 px gap between two zero-height rows exactly as it would
between two full ones. `#polygon-status:empty` / `#polygon-list:empty` are
hidden in layer-hierarchy's own sheet, which collapses the grid to nothing.
Deliberately `:empty` rather than a blanket `gap: 0`: the moment polygons.js
writes a message the rule stops matching and the line returns at full height
with its spacing intact (measured 7.2 → 28.8 px and back on clearing). When a
container looks too tall, measure its EMPTY children before its padding — a
grid gap does not care that its rows have no height.

**The Add-data dialog is FORMAT-ADAPTIVE and asks for classification.**
One dialog, never subwindows: on file choice it says what it understood
("— imported as a 3D mesh (local model) / a raster, draped on the terrain
/ a table of points — map the columns below / a vector layer"), flips CRS
to "none" for meshes AND back to EPSG:4326 when a georeferenced file
replaces one ("none" was the mesh's answer, not a choice about this
file), keeps the CSV column mapper, and hides whichever symbology row
does not apply (ramp for flat-colour vectors, colour for graded rasters)
instead of merely disclaiming it. A **Classification** fieldset carries
the data-tags type — guessed live from the file via `inferType`, frozen
once the user touches it (`dtypeTouched`) — and the note; on submit the
tag lands on the imported layers found by DIFFING ids (the importer names
layers its own way), and `suppressNextArrival(1)` keeps the arrival card
quiet for an import the dialog already classified — one question, one
box.

**The Workspace add row is the ONE doorway for user data.** The per-tab
+ Data / + GEE pairs are gone — `add-data.js` injects only the vector
role's row, into `#workspace-add-host` — and that role's dialog became
"Add data" with the UNION of every old role's accept list (vectors,
rasters, meshes). The per-tab narrowing was the one thing those buttons
did that the master must not lose, and the mesh role's other job moved
into `takeFiles`: all-mesh selections flip the CRS default to "none". The
other ROLES entries survive as dialog configurations (`roleById` still
resolves them). The fetch-polygon buttons (`#gee-draw-area`, the weather
card's draw) are NOT add buttons — they choose ground, not files — and
stay in their cards.

**`gis/data-tags.js` classifies every input AS IT ARRIVES.** `inferType`
is pure (extension → source → name, in that order of authority; pinned in
data-tags.test.mjs); every layer wears its type as a coloured chip in the
hierarchy row (replacing the old `layer-kind` column); ONLY the Add-data dialog asks — its Classification fieldset,
where somebody is already choosing what to import. An arrival card was
tried and REMOVED: it fired over prebuilt datasets the app itself defines
(the Macrostrat world geology arrives through `addDerivedLayer` and is in
no catalogue registry, so the heuristic took it for an upload). With it
went the heuristic: `isUserInput` is now an explicit FLAG set by the
three doorways user data actually enters through — the dialog, a drawn
capture, the Points tool — because a heuristic here fails OPEN, and
failing open means asking somebody to file data they did not bring. The
drawer carries the same controls forever The tag row also claims a full-width WRAPPED line in the
drawer: jammed into the drawer's nowrap flex line, the note field was
crushed to nothing. Tags mirror into
`layer.metadata` (dataType, description) and, for layers that own their
GeoJSON, into the first feature's properties (`data_type`, `data_note`) —
so drawn shapes bring their classification back with the project. Three
traps this cost: (1) the arrival baseline is taken AT SUBSCRIBE TIME, not
on the first change event — the first user capture WAS the first event and
silently primed instead of asking; (2) the card must NOT live in
`#polygon-list` — polygons.js clears that list on every layer change and
the card is born on one (measured: added then wiped in the same event);
it anchors after `#workspace-add-host` instead; (3) the hierarchy bakes
the chip into its row template and does not hear the tag event —
`applyTag` calls `GeoIDLayerHierarchy.render()` itself.

**ONE GAP BETWEEN SUB-TABS, and it has to be spelled out per wrapper.**
Explorer's column measured 17.6, then 7.2, then 10.4 seven times — three
spacings in one list, all structural: a tab body is a grid at 7.2 px, but the
later sub-tabs sit in a `.controls` wrapper with a 10.4 px gap and a 12 px top
margin, and the first section carries a 10.4 px bottom margin nothing else
has. Checking the other viewers then found the nine planets uniform at 10.4
and EARTH carrying three values — 8 px in the Live Events feed groups, 9.6 in
Explorer, Geology and Hazards, 10.4 in the plain bodies. Each list was even in
isolation, which is why nothing looked broken.

CSS cannot select "the parent of a run of sections", so every wrapper the
column uses is named in the rule — `.controls`, `.control-stack`,
`.event-sources`, the body itself, and `#geoid-controls-host`. **A new wrapper
will need adding there**; that is the cost of the approach and the rule says
so. Measured after: Earth 13 gaps across four tabs and Mars 7, one value each.

**Against another `!important`, SPECIFICITY decides — and an id always wins.**
Earth's stylesheet pins `#geoid-controls-host > .controls` at `0.6rem
!important`, which no length of class list can outrank; the fix is to match
the id and rely on being the later sheet. Finding it needed printing the
MATCHING MEMBER of a six-selector list: `el.matches(rule.selectorText)` says
the element matches the rule, and the reason was the one id-bearing selector
hidden in a truncated string.

**A pseudo-element is not reached by `> summary *`, and the chevron is one.**
A tier-1 tab holding a hidden active layer takes the solid accent fill and
puts its title and icon into dark ink — but the chevron sets its OWN colour
(the accent at 0.9) rather than inheriting, so it came out
rgba(255,43,214,0.9) on a rgb(255,43,214) header: the same colour, and
therefore no arrow. Reported as "the arrow is lost", which is exactly how it
presents — the rest of the header looks right, so nothing says the fill is at
fault. `::before`/`::after` are on the dark-ink list in section-activity.js
now, for both tiers. The sub-tabs never had it (their chevron inherits,
measured rgb(43,0,48)) and are on the rule anyway so the tiers cannot drift.
Third instance of magenta-on-magenta in this file; when a mark disappears on
a FILLED header, look for something setting the accent as its own colour.

**A BLOCK around an inline-flex row baseline-aligns it, at BOTH tiers.**
The level-2 fix was noted long ago and the same fault sat in tier 1
unnoticed: `.section-title` is a block, the row inside it sits on the line
box's baseline, and the strut's descender makes that box taller than the row
(23.5 px against 19.5) — so the icon and the name rode 2 px above the
chevron, which is a flex item of the toggle and therefore properly centred.
Making the title `display: flex; align-items: center` collapses the box onto
its content. Measured across every tab on Earth and Mars: 0.00 px. When a
mark and its label look a hair out, measure the ROW against the TOGGLE
centre before touching either one's padding.

**The Workspace tile folds like a tab, so it says so like a tab.** It wore a
"▾" on the far RIGHT — a second fold language in a column that had settled
on one, and on the wrong edge. It takes the tabs' own left chevron now. Two
things that bite: the `::after` has to be EMPTIED at the specificity
styles.css and shell.css draw their `+/-` at
(`#layer-dock:not(.is-collapsed) > .layer-dock-head::after`), or the tab
marker comes straight back; and the polarity is inverted against a
`<details>` — `.is-collapsed` is the CLOSED state, so the chevron rotates
BACK on that class rather than forward on an open one.

**`\203A` needs a DOUBLE backslash in these stylesheets, and `node --check`
will not tell you.** Single, it is an octal escape inside a template literal
— `import()` reports "Octal escape sequences are not allowed in template
strings", `node --check` passes it happily, and the module simply never
loads. That took the whole layer-hierarchy module out, so the Workspace
layer LIST vanished along with the chevron being styled, and the `+/-` the
new rule was meant to replace came back looking like a cascade problem. Run
`tests/run.mjs` after touching a CSS-in-JS block; it imports every module
and it is what caught this. Third time this trap has been paid for.

**Reading a transform straight after toggling a class reads the TRANSITION,
not the target.** These chevrons carry `transition: transform 0.15s`, so a
`getComputedStyle` immediately after `classList.add` returns an interpolated
matrix — the collapsed state measured as though the rule had not applied at
all. Wait past the transition before believing the number.

**Every SUB-tab speaks the Live groups' language**: a LEFT chevron ("›"
turning down on open — moved from the right on report), the level-2
heading type matched to the tool-summary voice (Exo 2 600 0.76rem/0.1em,
full ink, skin glow killed with !important), and icons throughout — the
six feed groups gained their own 16px glyphs (rings, volcano, flame,
snowflake, raincloud, leaf) carried on FEED_GROUPS as `icon` and drawn
into each summary. Level-1 tabs kept a +/- for a while as a tier mark and then took the
chevron too, on report: the column was speaking two fold languages at
once, and the tier is already said by a tab's fill, size and icon. One
mark, one edge, one direction, with chevron-icon-name spacing matched
across both tiers (8.8 px, `!important` — the base `.section-toggle` sets
`gap: 0` and `justify-content: space-between`), and an OPEN tab's
`::before` added to the dark-ink list its filled bar needs; the feed groups' native chevron rule still stands and
mine excludes them, or they would wear two. On a further report the
LEVEL-2 SECTIONS BECAME THE TOOL CARD VERBATIM — border, 0.78rem radius
(!important; the page sheets pin 0.6rem at higher specificity), ground,
0.7rem summary padding, chevron in the card's own ink — and their open
state is the tool sections' solid accent fill with dark ink, replacing
the old deep-gradient level-2 treatment. Measured equal, computed value
for computed value, against a live feed group — and getting there took a
property-by-property DIFF rather than eyeballing, which found what the
first pass had missed: the rules had been aimed at the `.section-title`
SPAN while the toggle was the element that differed (46 px tall, 16 px
inherited type, no gap or letterspacing, near-white border, 20 px icon
wrapper), and the last 2.8 px was `.section-title` being a BLOCK around
an inline-flex row, so it took a line box taller than its content. A head
that carries a control (Tour Mode's ENTER) sizes it down to the row.

**And the last difference was not a style at all — it was POSITION.**
Every property matched and the cards still looked different colours: the
cards were 3% white over `#ui`, which paints a VERTICAL GRADIENT (light
at the top, dark at the foot), so the same translucent fill composites
differently depending on where the card sits. Measured: an events card
275 px down the panel rendered ~rgb(24,13,47); an Explorer card 698 px
down rendered ~rgb(17,9,32). Sub-tab cards now take an OPAQUE fill (the
events card's own rendered colour, rgb(24,13,47)), so a card is the same
colour at the top of the column and at the bottom. The tab BODIES behind
them needed the same treatment for the same reason (measured: the events
body sits at -1% of the panel, Explorer's at 61%) — one opaque ground,
rgb(16,7,36), a shade under the cards so those still read as raised —
applied to every surface that holds these cards: the tab bodies, the
Workspace tile's body and the rail workbenches. Because the rules live in
the shared module the planets inherit them; verified on Mars (7 grounds,
56 cards) and Earth (10 grounds, 72 cards), one distinct value each.
When computed styles agree and the eye does not, suspect a translucent
fill over a gradient before suspecting the rules.

**Three more differences, found by walking the ANCESTOR CHAIN** rather
than comparing the two cards alone: Explorer's sub-tabs sit inside a
`.controls` wrapper that paints its own magenta ring and bloom (the
events chain has no equivalent wrapper — reported as "a larger box
enclosing Search, Locations and Core View"), an open level-2 BODY is
filled solid black with an accent hairline where the events body is
transparent, and an open level-2 header kept near-white ink where the
events pill writes DARK ink on its accent fill, so the two solid pills
never read as the same colour. When two cards measure equal and still
look different, diff their ancestors.

**A closed level-2 section draws NO shadow.** The page sheets give one a
1px magenta inset ring plus an outer bloom — reported as "interior
outlines and purple glow" beside the events cards, whose shadow computes
to `none`. Killed with `box-shadow: none !important`; only the OPEN state
keeps a glow, which the feed groups have too. Verified: Search,
Locations, Core View, Tour Mode and Atmosphere all MATCH a feed group on
background, border, radius and shadow, closed AND open.

**Not every title takes a glyph, and a loose row is not a subtab.** The
burned-area catalogue sat directly in the Hazards body under a heading
while every other entry in the column lives in a `gis-tool-section`; it
is now a **Wildfires** subtab (flame, the Live Events wildfire glyph),
and the group heading inside it names the SOURCE ("Earth Engine")
because the subtab already names the subject. The NI prototype then nested inside a
**Landslides** subtab of its own (a slope shedding debris): the prototype
is a worked example OF landslide susceptibility, so the SUBJECT takes the
subtab and the glyph. `NO_TOOL_ICON` is the other half of that rule —
"NI prototype" is a named example rather than a subject, so it keeps a
bare title inside; the fallback bracket would be furniture. Hazards now
reads: myGeoID mode, Wildfires, Landslides, Flood, Drought. **Flood took
the NI prototype's flood-susceptibility map** — it had been sitting in
the landslide list, which is a statement about where it was built rather
than what it is. And where a subject has no product of its own yet, the
subtab offers what it HONESTLY has: the live feed. `data-feed-toggle`
(events.js) makes a tick box a PROXY for an event source — it mirrors the
same `enabled` set and commits through `setSourceEnabled`, so the Flood
and Drought boxes and the Live Events tab's own rows are one state seen
twice, never two states to keep in step. Verified: ticking the Hazards
proxy flips `isSourceEnabled` and the Live tab's row shows checked.

**Icons on EVERY subsection, and one gap value.** The ~54 (Earth) / 39
(Mars) `gis-tool-section` summaries had no glyphs while the level-2
sections and feed groups did, so a column mixing them read as two
systems. `TOOL_ICONS` in side-panels keys a 16px glyph by lower-case
TITLE — these summaries are plain text across ten markup files and a
shared template, and the title is the only handle they share — with a
neutral bracket fallback so a NEW subsection is never a gap; painted on
a 700 ms poll because the panels rebuild constantly, each summary marked
so a pass is cheap. Icon-to-text gap is 0.55rem everywhere (level-2 rows,
tool rows, feed groups, and the outer toggle) — and it takes
`!important`, because the line-box flattening rule that zeroes the
toggle-main GRID gap had `.section-title-row` in its selector list too,
which jammed every glyph against its words (measured 0 px, now 9). The terrain slider is
**Vertical exaggeration** on all ten pages. Because the styling lives in
the shared module, the planets inherit it — verified on Mars: every
level-2 section MATCHES the tool-summary voice property for property,
all 39 subsections carry icons. Two escaping traps in one edit, both
caught by the module actually loading: emitting JS strings by swapping
quote characters breaks embedded quotes (use json.dumps), and a
`src.find("\\n\`;")` in a quoted heredoc searches for a literal
backslash-n, so the backtick guard silently passed nothing.

**And the whole stylesheet was silently dead for two rounds**: a CSS
comment I added said `.section-icon` IN BACKTICKS — inside the STYLE
template literal, which ends it — so the module threw "icon is not
defined", never ran, and every rule it injects vanished, making the
parity work look like it had changed nothing. The file's own header warns
about exactly this; the edit script now asserts no backtick survives
inside the literal, and `import()` in the browser console is the fastest
way to see a module that is not running at all.
Trap paid for twice in one edit: "\203A" inside a JS template literal is
an OCTAL escape and a SyntaxError — the file needs a double backslash —
and a `;` instead of `&&` before the commit let the broken file commit
while a stale /tmp test log read "all passed".

## Workbenches: the rail owns what you pick up and put down

**An open workbench pushes the corner furniture left.** Settings and
Export open over the top-right corner, where the legend drop-down and the
events list live, and they sat UNDER it. The hazard readout had already
solved this shape — publish the clearance as a LENGTH and let the
stylesheet consume it — so `place()` publishes `--workbench-w` (viewport
edge → panel left edge → plus the panel's own width and a gap, measured,
never written down) and `.map-legend` takes `max()` of that and whatever
corner clearance it already had, so neither shift is lost when both
apply. The events drop-down needs no rule of its own: it positions from
the legend's measured box and just needs `GeoIDEvents.reflow()` after the
legend moves. Measured: legend 1204 → 837 px with a panel at 947, events
1066 → 699, both back on close.

**Every basemap row carries the same ⓘ the overlay rows do** — tile
services answer from their own TILE_SOURCES records (credit + licence,
matched by the `tiles-<slug>` id basemap-drape registers), shipped
textures from `SHIPPED_BASE_INFO` in map-layers-panel — whose keys are
the SELECT'S OWN option values (`earth-visible`, `derived-hillshade`,
`gebco-bathy-context`), not the display names; guessing them cost a
round. A texture in neither table gets a row without the ⓘ rather than a
button opening an empty card. And the Settings gear lives in the
Workspace header icons on EVERY world (+ Data, + GEE, Export, ⚙ on
Earth; + Data, Export, ⚙ on the planets — add-data builds it,
side-panels' entry is `rail: false` so no rail button exists anywhere).

**The Workspace tile wears the theme, and every boxed header speaks one
language.** The dock's deliberately-quiet skin (muted head, faint border)
was reported as out of keeping once the tile became THE workspace: it now
carries an accent border with a glow, a magenta gradient head, the icon
and caret at full accent, and the title in full-ink uppercase Exo 2 —
vibrant without borrowing the tab bar's solid fill. The workbench panels'
collapse (‹) and close (✕) marks became the same small bordered icon
squares the Workspace header buttons wear (side-panels.js STYLE).

**The Workspace doorways are ICON buttons in the box's header** — plus
(+ Data), cloud (+ GEE, Earth only), tray (Export) — pinned right of the
WORKSPACE title with names in the tooltips: three full-width text buttons
dominated the tile. Three mechanics: the row APPENDS in header mode
(first-child insertion put the icons left of the title), it swallows
click/pointerdown so a press never folds the box, and the head's caret
::after carries `margin-left: auto` in layer-hierarchy's sheet — two autos
SPLIT the slack and parked the icons mid-header, so add-data overrides the
caret's to a fixed gap with !important at matched specificity.
`#workspace-add-host` in the body survives as the arrival card's anchor.

**Export's door moved into the Workspace row** — third button on Earth
(+ Data, + GEE, Export), second on the planets — because exporting is an
act on the working set the box holds. The workbench PANEL survives in
side-panels.js under `rail: false` (panel built, no rail button; setOpen
tolerates a button-less entry), and the Workspace button opens it via
`GeoIDSidePanels.open("export")`.

`gis/side-panels.js` moves whole sidebar groups onto the right-hand tool
rail as workbenches — Pre-processing, Extraction & Analysis, and now
**Export and Settings** (the gear). The group is MOVED, never rebuilt, so
every id and handler inside survives (settings-panel.js, the export
wiring, toolbox.js's own MOVES all keep working untouched), and the panel
shell is read off `#ui` at build time so it is the sidebar on the other
side of the screen. Adding one is a PANELS entry plus removing the id from
toolbox.js's `TAB_ORDER` — leaving it in that list re-appends the group to
the sidebar on the next mode change, and a group in neither place stays
behind in `gis-panel-host`, the toolbox's first child, pinned to the top
of the column (which is how Settings originally earned its TAB_ORDER
entry). One workbench opens at a time; the rail shrinks to icons while one
is up. The Settings copy also carried a double-escaped `\\u2014` in
panels.js's MARKUP string that rendered literally — remember the markup is
a JS string, so an escape typo survives to the DOM. And verifying any of
this needs a COMMITTED stamp: the uncommitted edit re-stamps to the same
sha and the browser serves its cached module (the reused-stamp trap, hit
again here).

## The Geology tab is subsections, and dead controls are gone

The tab's top level held a dropdown, an "Add to globe" button, a manual
"Refresh for this view", a permanently greyed "Structures and faults" row and
an unimplemented mineral-map pair. What remains is three subsections —
**Geology** (one tick: the Macrostrat tiled world geology, which loads on
tick, refines itself when the view settles, and unloads on untick),
**Tectonics** and **Volcanoes**.

- The dropdown was a list of one once its other entries found homes: the
  Macrostrat **contacts-and-faults line layer is a row in Tectonics** now
  (appended by `catalogue-panels.js` after `renderCatalogue`, because it is a
  tile service driven by `geology-panel.js`'s machinery, not a file
  `global-data.js` could list). Its row matches the layer by dataset id AND
  name — `geologyDataset` is stamped a beat after the layer registers, and
  the redraw fires in between.
- The subsection tick and the header master box answer DIFFERENT questions:
  the tick is "is the world geology on the globe" and unloads only the units
  layer — unticking it must not take the contacts-and-faults out of the
  Tectonics list where somebody else put it on. The header box keeps its
  all-mapped-geology meaning.
- The greyed structures row and the mineral controls are removed from view;
  their INPUTS stay in the page hidden, because `earth-viewer.js` reads
  `geology-structures-toggle`, `mineral-select` and `mineral-opacity`
  unguarded at boot — the same trap `geology-toggle` documents.

**The Locations master must not count the Moons row.** The master's boot
sync ORs every box in the section, and Moons boots checked — so a fresh
page showed the master ticked over a globe with every label layer off,
and the first click appeared to do nothing (it unticked a lie). The sync
and the master's set-all both skip the moon toggle now: Moons is a
visibility choice, not a location-label default. Earth only — the planet
viewers boot with their labels genuinely on, so their ticked masters are
truthful. Explorer (`geoid-controls-group`) is also on section-activity's
status board now, read straight from the label tick boxes (they are the
viewer's own layers, invisible to the import manager) via a bubbled
document-level change listener — which lands after the viewer's element
listener has synced the sibling boxes.

## The catalogue is filed by SUBJECT, not by file format

Data · Vectors & Shapes began as the one list of everything, which made it a
list sorted by what a dataset arrives as: a plate boundary beside a coastline
beside a volcano, because all three are GeoJSON. Nobody looks for the world's
faults under "Vectors & Shapes", or for its rivers under a heading that also
holds country borders.

So a dataset names its **home** in `global-data.js`, `catalogue-panels.js`
mounts one list per home, and `polygons.js` draws only what has NO home:

| home | where it appears |
| --- | --- |
| `hydrology` | Hydrology · Water bodies — coastlines, rivers, lakes |
| `geology-tectonics` | Geology · Tectonics — plates, faults, stress |
| `geology-volcanoes` | Geology · Volcanoes — the Smithsonian GVP |

What is left in the Vectors tab is the shapes that really are just shapes — the
graticule, the borders, the country polygons — beside whatever somebody
imports, which is what that tab is for.

**The move is only a move if the old list stops drawing them.** Two lists for
one dataset is how a tick in one place fails to explain the tick already
showing in the other, and nothing about it looks wrong until both panels are
open at once. `catalogue-panels.test.mjs` checks that every dataset appears on
exactly one list, that every home named has a host in the page, and that the
page loads the module that fills them.

Two casualties, both deliberate. `tectonics-panel.js` was this for one home,
and the second and third would have been two more copies of the same forty
lines. `locations-panel.js` and the "Mapped locations" heading held one dataset
— the volcanoes — and a heading over an empty list is worse than no heading; the
LABEL layers under Locations stay, because a word on the sphere is not a layer
you can interrogate.

**Sea Level is Hydrology, and keeps its id.** A coastline is where the sea meets
the land and the slider moves that line, so they belong in one tab. The id stays
`sea-level-section` because `toolbox.js` moves the section into the tab bar by
id and orders the column by id, and `mode-manager.js` lists it among the
sections a mode shows — three lists to keep in step for a word the user never
sees, against a heading that is right there in the markup.

**`.gis-tool-body` was overflowing every tool section, and this is what showed
it.** The rule was `display: grid` with no `grid-template-columns`, so the
implicit column is `auto` — which sizes to the MAX-CONTENT of its widest item
and refuses to shrink below it. Measured: the catalogue laid out 351 px wide
inside a 291 px content box, and `.gis-tool-section`'s `overflow: hidden`
clipped the rest — the Symbology button cut to "Sy" and the status line running
off the panel. `grid-template-columns: minmax(0, 1fr)`, which the
`.gis-tool-grid` rule immediately below it already carried. It had simply never
shown, because no tool section had held a label long enough to prove it. Both
copies fixed (`styles.css` for Earth, `gis/shell.css` for the planet shells);
after it, no `.gis-tool-section` on the page overflows.

## "Mapped line" was the card's answer for everything

The click card had only the geometry to go on, so a stress measurement, a
coastline, a river, a border and a named fault were all headed **Mapped line** —
a word that cannot be wrong and cannot help. Two fixes, both small:

- A catalogue entry carries a **`featureNoun`**, put on the layer by
  `addDataset` and preferred by `featureKind`. The geometry stays as the
  fallback, because a file somebody dropped on the globe really is just a line
  until it says otherwise.
- **`kindOf` learned `slip_type` and `method`** — a GEM fault says how it moves
  and a WSM record says how it was measured, and both are the answer to "what
  IS this". Measured: a fault now reads *ACTIVE FAULT / Tazimi Fault / Normal*
  and a stress record *STRESS MEASUREMENT / Focal mechanism (single event)*.

## Symbology: a column of NUMBERS is not a column of names

The dialog had one vector mode — categories — and it was quietly refusing the
most interesting half of a scientific layer. `attributeHead` counted distinct
values and nothing else, so `s1_mpa` (193 readings) came out as twelve
arbitrary hues plus an "other" holding the rest, and `depth_km` (200+) was
**disabled outright**: a stress magnitude could not be mapped at all. The
breaks already existed for the rasters.

- `attributeHead` now reports `numeric` and the column's `min`/`max`. That is
  the discriminator the count could never be: `s1_mpa` and `wsm_id` are both
  "too many values" and only one of them wants classes.
- `paintByRange` is the graduated counterpart to `paintByField`, over the same
  `buildSymbology` the rasters use, so a vector and a raster cut the same
  numbers the same way. The picker offers a numeric column by its RANGE
  ("s1_mpa — -21.5 to 146") rather than by a count of readings.
- **A feature with no value is left uncoloured.** 249 of the 32,464 stress
  records carry a magnitude; painting the other 32,215 the bottom class would
  say they were measured at the low end. The dialog says so in words under the
  class list.

**An orientation is not a quantity.** SHmax at 1° and at 179° are two degrees
apart, and every sequential ramp paints them at opposite ends of the scale — a
false seam through the one map the WSM exists to make. So there is a `cyclic`
ramp whose first and last stops are the same colour, angular fields default to
it, and they class by EQUAL INTERVAL rather than quantile: quantile bands would
depend on how densely each direction happened to be sampled, and two maps of
the same field over different subsets would disagree about where the classes
are.

Two traps found by measuring rather than reading:

- **`rampColour` answers for an unknown ramp name with viridis.** So a
  qualitative ramp asked for on a numeric classing painted a perfectly correct
  map under a control that said "qualitative" — the map right and the legend
  lying, which is the worse of the two. Refused explicitly in `paintByRange`
  now, and the select follows the column.
- **The dialog proposed throwing the WSM's colours away.** A catalogue entry's
  palette rides on the layer as `cataloguePalette` (with the field it belongs
  to) and re-seeds whenever that column is selected — including on the way BACK
  from exploring another one, which is where it was lost.

Five WSM method codes had no name and showed in the legend as bare
abbreviations: BOC, BOT, GFS, GFM, HFG, 299 records. They are named by their
FAMILY and no further — the code's stem is unambiguous, what each variant
letter means is not something to infer, and a wrong method name on a scientific
layer is worse than an abbreviation.

## Basemap and Relief is ONE list

The tab offered one dropdown, and a dropdown says these things are
alternatives. Everything except the sphere's own texture is an OVERLAY, and
hillshade under a stress map under coastlines is the ordinary way a tectonic
map is read, which the dropdown made impossible to say.

**A dropdown beside a tick list is two kinds of control for one question**, so
the base textures are now the FIRST GROUP of the same catalogue: ticking one
swaps it and unticks the last, which is exactly what a radio group is — and it
falls out of `layerFor` rather than being enforced, since only one id can match
the select's value. The entries are read from the `<select>` **live**, not from
the manifest, because `basemap-drape.js` registers OpenStreetMap, CartoDB and
Esri into it at runtime and a manifest-built list would be missing precisely
what somebody went looking for. Unticking the base is refused with a sentence
(a sphere always wears a texture) rather than left to snap back looking broken.
**The `<select>` stays in the page, hidden**: `earth-viewer`, `layer-hierarchy`
and `basemap-drape` all read it, and deleting it throws on the first frame —
the same reason the geology toggles are still there. Measured: 15 entries in
one list, ten of them base textures. `map-layers.js` is a catalogue of raster overlays drawn
by the same `renderCatalogue` the vector tabs use, so a tick means the same
thing in all three and each overlay arrives in the layer box with its own eye,
opacity and place in the draw order. Four entries: three GEBCO products and
NASA's surface texture, all of which the viewer already shipped and could only
ever show alone. (The stress field was briefly a fifth; it is a layer of
measurement bars in the vector tab now, because neither a raster nor a mesh can
be asked where it came from.)

**`drape()` is exported from `gee.js` rather than copied.** Every trap of
putting an image on a displaced sphere is answered in that one function — the
relief attributes, the single-sided culling that makes turning the depth test
off safe, the frustum-culling exemption for a patch spanning a hemisphere — and
a second copy would drift from it the first time either was fixed. Two things
it needed to serve a global shell: **three.js loaded on demand** (the module
fetches it lazily when its own flow first runs, so a caller from outside hit
`THREE is null`), and **bounds in either shape**. That second one cost a whole
verify loop: Earth Engine answers `{minX, minY, maxX, maxY}` and the rest of
this app says `{west, south, east, north}`, and handed the wrong one every
lat/lon came out `undefined`, every vertex NaN, and the layer registered, drew
its legend, took its row in the layer box and painted **nothing**. It now takes
either and refuses anything else loudly.

**A module-relative path is one directory too deep.** `import.meta.url` in
`gis/map-layers.js` is `…/viewer/gis/`, so `data/global/…` resolves inside
`gis/` and 404s — the same trap the GEE cache hit from the other side, where a
document-relative path missed because the document is a directory up. Neither
default is right; say which root is meant.

## Symbology is a window, and there is one of it

`gis/symbology-dialog.js` — `openSymbologyDialog(layer)` — is the symbology
control for **every** layer: the global vector catalogue, the Earth Engine
catalogue, a shapefile somebody dragged in, a derived raster, the world geology.
It is the geology tab's old modal, lifted out and taught rasters.

It replaced two other ways in, both of which were worse for the same reason.
The Symbology **panel** is an accordion section down the side of the page: to
point it at a layer you had to select that layer in its own dropdown, unfold
whatever it was folded inside and scroll it into view — and revealing it
mid-stack pushed everything below it down and left a run of half-styled sections
open behind it (the "white banners"). A modal has none of those problems because
it is not in the page's flow. The panel still exists and still works; it is
simply not the way in. The buttons that open the dialog are on the catalogue
rows (`catalogue-list.js`), the Polygons tab's own rows, the layer box's drawer,
and the geology tab's layer cards.

**The two branches are not one branch.** A vector has CATEGORIES — a column of
names, one hue each; the controls are which column and which palette. A raster
has a RANGE — one variable; the controls are how to cut it and which ramp runs
across it. Quantiling a list of rock names is meaningless, and asking a rainfall
grid which column to colour by is asking about something it does not have.

**The repaint trap, stated once more because it is still the easiest way to
break this.** A VECTOR `layer.repaint` wants a **CSS colour string**; a RASTER
`layer.repaint` wants **[r, g, b]**. Hand the array to a vector layer and it is
not an error: `THREE.Color.set` swallows it, every polygon comes out white, and
the legend beside it is perfectly correct. The legend is not evidence that the
map was painted. `paintByField()` in this module is now the ONE vector
implementation — `geology-panel.applyField` calls it too, so the auto-paint on
load and the Apply button cannot drift apart.

**A numeric column matched nothing, and the legend said otherwise.**
`categoricalSymbology` counts values as STRINGS, so a row's value is `"6"`
where the feature carries the number `6` — and a lookup keyed by the raw value
misses it. Every feature then fell through to the no-value grey while the
legend beside it named seven classes correctly. Measured on Natural Earth
coastlines by `scalerank`: **all 813,648 vertices 0x8a8a8a**, seven legend rows.
Long-standing, in BOTH Apply paths, and invisible on geology because a survey's
unit names are text. Both now key and look up by `String(value)`, and
`symbology-dialog.test.mjs` pins it — the paint functions take a fake layer
whose `repaint` records what each feature was given, so the check is on the
colours rather than on the legend.

**One colour is a mode, and for a line layer it is the default.** A coastline
is a coastline everywhere; cutting it into twelve hues by whichever column
ranked first states something about the data that is not true. The vector form
opens on **One colour** when the layer has no polygons and has never been
classed, on **By attribute** otherwise, and on whichever it is currently wearing
before either. The two are exclusive — `paintSingle` clears `geologyField` and
`paintByField` clears `symbologySingle` — or reopening proposes undoing the
Apply you just made. Note this is only the DIALOG's default: an untouched line
layer already lands in one flat colour, because `defaultSymbology` returns null
with no polygons and the renderer uses a single material.

**The catalogue is a scrolling dropdown.** Nine datasets under four group
headings filled the panel and pushed the layers already on the globe off the
bottom of it, which is the part you work with. `renderCatalogue` takes a
`title` and wraps the list in a `<details>` with a scrolling body (the
max-height is on the BODY — on the `<details>` it clips the summary too). The
list is redrawn on every tick, so the open/shut state is kept in a module Map
keyed by host id: on the element it would not survive being replaced, and the
dropdown would spring shut under someone working down it. The Earth Engine
catalogue passes no title because it already sits inside its own disclosure.

**A legend row says what its swatch is a swatch OF, so a layer with a legend
does not also get the stand-in row.** The stand-in exists for a layer with no
symbology at all — one swatch and `geometrySummary(features)`, so the dock can
still say something. The moment a palette exists the classes below carry their
own swatches and names, and the stand-in becomes "8,101 lines" beside a colour
it does not describe: the count listed as a legend entry, which is how it was
reported. It used to be suppressed only past two palette entries, on the
reasoning that a continuous ramp contradicts a single swatch — as true of one
class as of three. `paintSingle` labels its one row with the geometry summary
rather than the layer name, which is already the card's title an inch above.

**A select's POPUP is painted from opaque colours.** `background:
rgba(255,255,255,0.06)` is a dark control on a dark card and a WHITE list when
the browser opens it — the popup has no card behind it, so the same rule
composites over the platform's white and near-white text goes with it. The
control keeps its translucent fill; `select`, `option` and `optgroup` are given
a solid `background-color`.

**`hidden` needs `[hidden] { display: none !important }` here too** — the same
rule the Research Hub needed. The attribute is only a UA-level display:none, so
`.sym-row { display: flex }` outranks it: the attribute half of the vector form
was set hidden in One colour mode and went on rendering, with Colour by and
Ramp sitting under a Style select saying they did not apply. **A probe that
reads `el.hidden` cannot see this** — it reported `classes_hidden: true` for
controls that were plainly on screen in the same run's screenshot. Measure the
computed `display`.

**Data arriving stops the planet.** `holdTheGlobe()` in `import-manager.js`
runs on every completed import and every `addDerivedLayer`: you add a shapefile
in order to look at it, and a globe turning at 3°/s walks it off the limb. It
asks the viewer's own `setSpinPaused` rather than turning the globe from
outside, so the corner toggle stays truthful (`pauseSpin` syncs it) and there
is still one rotation and one thing that stops it. **The nine planet viewers
had `pauseSpin`/`resumeSpin` internally but no seam**, so each gained
`setSpinPaused`/`isSpinPaused` beside `getSpinDeltaRadians`. It is not a
one-shot — resuming and then adding another layer means wanting to see that one
too — and it is safe against the self-rebuilding layers because both the tiled
geology and the basemap drape call `addDerivedLayer` once and reuse the layer
afterwards.

**The file keeps its extension; the layer does not.** The importer picks its
parser from the extension, so the File `addDataset` builds has to be
`NI rivers (OpenStreetMap).geojson` — but nothing downstream is showing a file
somebody chose, it is showing a dataset they ticked, and ".geojson" in every
row is plumbing on display. `importFileList` already had the seam
(`options.name`, honoured by `importDataset`), so the layer is named right from
the frame it lands rather than renamed a moment later in front of the user.
`layerNameOf(entry)` derives it rather than being a second field, and
`layerForDataset(id)` matches EITHER name — the file's while the import is in
flight, the tidied one after.

**One layer, one control.** The Polygons tab listed every loaded vector layer,
catalogue ones included, so a ticked dataset appeared twice on the same panel:
its catalogue row with a tick and a Symbology button, and a card below the
status line with a second tick, a second Symbology button and a different name.
The second tick was VISIBILITY where the first was on-the-globe, which is why
unticking one appeared to leave the layer in the layer box — two controls that
do different things, wearing the same box. `overlays()` now excludes
`isCatalogueLayer`, so the catalogue row is the only control for a catalogue
layer and the card is only for a shapefile somebody brought.

**The attribute head is not a control, so it stays up in both symbology
modes.** It is the first six rows of the dataset, and reading them is how
anyone decides whether there is anything worth colouring by. Hiding it in One
colour mode hid the very thing that answers "should I switch to By attribute?".
Clicking a column header switches to By attribute and selects it, because
reading the table is where that decision gets made; nothing is marked
`is-colour` while the layer is one flat colour.

**Checking the colour: read the geometry, not the material.** `renderFeatureCollection`
draws with `vertexColors: true`, so `material.color` is white on a correctly
painted layer. A probe that reads materials reports "all white" for a map that
is fine. Read the geometry's `color` attribute instead — the verification run
that passed this shows 8 distinct vertex colours for countries-by-continent.

**One dialog on the page, found by id, not held in a variable.** Modules load
from cache-busted URLs, so a second query string is a second module instance
with its own top-level state. Held privately, each instance built its own
backdrop under the same id; `getElementById` answered with whichever came first,
so opening the dialog from one copy showed the OTHER copy's card, still bearing
the last layer's name. Measured exactly that way — a raster open that reported
`opened: true` and a card titled "Countries (Natural Earth 50m)". `theBackdrop()`
looks the element up.

**Every control in the dialog is painted by element.** A bare input takes the
browser's white, and against a dark modal a column of class-name boxes is a
stack of white banners with the map behind them. Text, number and colour inputs
and the selects are all styled in this module's own STYLE block.

Reopening shows the symbology the layer is WEARING, not the defaults — vectors
from `layer.geologyField`/`geologyRamp`/`geologyLabels`, rasters from
`layer.symbologySpec`. Pressing Apply on a dialog that had silently reset to
five quantiles would undo the classing you came back to adjust.

## Earth Engine is filed by SUBJECT, and every tab has a GEE doorway

The Atmosphere tab (the old "Data · Earth Engine") holds only the
atmospheric datasets now. `GEE_HOMES` in `gee.js` files each dataset by the
TAB whose subject it is — imagery and both DEMs in Basemap and Relief,
burned area and NDVI in Geohazards, SMAP in Hydrology, rainfall/LST and
the anomalies staying in Atmosphere — and the entries MERGE into each
tab's own catalogue — one list per tab, never a second "Earth Engine"
dropdown (that existed for an hour and was reported as exactly that).
`window.GeoIDGeeCatalogue` is the seam: `entriesFor(home)` / `owns(id)` /
`add` / `remove` / `layerFor`; `map-layers-panel.js` folds the basemap
share in as an "Earth Engine" GROUP inside Maps and overlays, and
`catalogue-panels.js` does the same for hydrology (`GEE_SHARE`), both
routing any id the seam owns back to gee.js — one request path. Both
redraw on the `geoid-gee:catalogue` event, dispatched when the live
service grows the list. gee.js itself draws only Atmosphere (its own tab)
and Geohazards (which had no list). Rows cite "via Google Earth Engine"
in the tooltip and every GEE layer's `metadata.source` records
"Google Earth Engine · <dataset>" on import. Anything unmapped defaults
to atmosphere so a new live dataset is never invisible.

Beside each tab's add-data controls sits an **"Add data via GEE…"** button
(`data-gee-add="<home>"`, an empty value meaning the whole catalogue —
that one is on Vector & Shapefiles). All of them open ONE window
(`openGeeDialog` in gee.js), which is a BROWSER now rather than three
controls in a 24rem card: the catalogue on the left — searchable by name or
Earth Engine id, filtered by the subject chips, each card saying whether it
drapes from disk or comes from the live service — and the Map Composer's own
slippy map (`research/map2d.js`) on the right, where a drag draws the fetch
extent in place. It drives the SAME hidden form and the same `request()` the
Atmosphere tab's own controls use — the hidden `#gee-dataset` select still
carries the state, the dialog's status mirrors `#gee-status` via a
MutationObserver, and there is deliberately no second request path. It stays
OPEN after a request, because browsing a catalogue means pulling more than
one thing. Verified end to end: a box drawn on the map, SMAP requested live
over it, "Soil moisture (SMAP) · 2025-04-28–2025-06-27" draped and
"Fetch extent 23.3×15.0°" in Workspace.

**The catalogue is GOOGLE'S WHOLE ONE, not the thirteen someone typed out.**
The service held an allowlist and the page read it, so the app offered 13 of
the 1,139 datasets Earth Engine publishes and answered 400 for every other
id. Two halves, and both were needed — a browser listing everything over a
service that serves thirteen is a shop window onto a locked room.

`services/bake-gee-catalogue.py` walks Earth Engine's public STAC catalogue
(keyless, `access-control-allow-origin: *`) and writes
`data/global/gee-catalogue.json` — 975 KB, 136 KB over the wire — carrying
each dataset's id, title, one-line summary, type, status, Google's own
categories and keywords, extent, resolution, licence, and its DEFAULT
VISUALISATION. It is baked because it cannot be walked in a page: the tree is
1 root + 130 provider catalogs whose entries are flattened ids with no title,
so a browser would need eleven hundred requests before it could show a
searchable list. Same discipline as the volcano and geology bakes. Re-run it
to refresh; the file records `baked` so the panel can say how old it is.

`gis/gee-catalogue-index.js` owns that file (fetched on FIRST OPEN of the
dialog, not at module load — most sessions never open it) and holds the
search. The ordering rule that matters: a title or id PREFIX beats a body
match and a shorter id wins ties, or "landsat 8" puts
`LANDSAT/LC08/C02/T1_L2/LC08_001004_20140524` — one scene — above the
collection somebody meant. `gee-catalogue-index.test.mjs` pins that against
the real baked file.

**The service resolves anything outside the curated list from that same
STAC**, at request time. The allowlist existed so the service could not be
pointed at arbitrary assets, and that boundary is KEPT and stated
differently: an id has to appear in Google's published catalogue to be
requestable, so a private or user asset still cannot be named. The rendering
is the publisher's own `gee:visualizations` — bands, stretch, palette, gamma
— so an arbitrary dataset arrives looking the way its publisher meant it to
rather than under a guess. `?dates` for a catalogue dataset is READ from the
published extent rather than queried: the same answer without a round trip.
`services/gee-tiles/stac.test.mjs` runs the whole resolution against real
records with no Earth Engine, credential or deployment.

Four things measured rather than assumed, each of which is a wrong map:

- **The record URL cannot be derived from the id.** 109 of the 1,139 are
  named `projects/<owner>/assets/…` and filed under a provider folder named
  nothing like their first path segment. The bake carries the href; the
  service tries the derived URL and falls back to an index it builds once
  per warm instance (131 requests, ~2 s, then never again).
- **Land cover publishes NO stretch.** The band carries `gee:classes` — a
  value, a colour and a name each — and that is what Earth Engine's own
  catalogue draws it from. The values are arbitrary (10, 20, … 95), so the
  service remaps them onto 0..n-1 and hands `visualize` a palette in class
  order; stretching the raw values paints a land cover map as a grey ramp.
  The layer then takes the dock's OWN classed `legendInfo` shape (`classed`
  + `categorical` + parallel palette/labels), because a ramp would invent an
  order between "grassland" and "built-up".
- **LANDFIRE publishes 24,201 classes**, and three such datasets took the
  baked file from 869 KB to 8.5 MB. Past 200 a class table is neither a
  legend nor a palette, so those keep their entry and are marked as having
  no default rendering — as are the 68 records that publish bands and
  nothing to draw them with. 947 of the 1,139 are drapeable by default.
- **The old service's error names the DATASET**, which is the one thing not
  at fault when a real published dataset meets an older deployment. The
  updated build names the catalogue in its `?list` reply; the browser reads
  that and says what is actually wrong, in the list before anything is
  pressed and again if a request is made anyway. **Deploying the function is
  what turns the other thousand on** — the page half works without it and
  says so.

The list stays honest rather than tidy: 60 cards are drawn and the remainder
COUNTED ("1,021 more match — add a word"), 253 superseded datasets are hidden
behind a tick and counted, and the tables and unrenderable rasters are
counted too rather than being offered and then failing. The subject filter is
Google's own taxonomy with counts, because deciding which of 1,139 datasets
is "geology" would be 1,139 judgements nobody here is qualified to make and
every wrong one invisible.

**A modal covers the globe — so the modal grew its own ground.** The old ✏
button had to CLOSE the whole dialog to arm the Draw tool and restore state
through a `pendingDialog` on the way back; that round trip is gone with the
state it carried. The box drawn on the 2D map is pushed to the globe through
`setStudyAreaPolygon` as it is dragged (a ring subdivided at 1°, the
chord-sag rule), so the planet behind the window shows the same extent and
the request then travels the ORDINARY "drawn" path — which is what makes the
extent land in Workspace on success without a line of code for it.
`map2d.js` gained `setDrawMode(on, onBox)` plus `project`/`unproject` rather
than a second copy of the projection maths living in the dialog.

Four faults found building it, each silent:

- **`+ GEE` was a dead button, and had been.** The Workspace header row stops
  `click` and `pointerdown` so a press cannot fold the box — which also
  stopped the one event gee.js's document-level listener was waiting for, so
  the app's only Earth Engine doorway opened nothing. Anything in that row
  must be wired DIRECTLY, as Export and Settings always were; the catalogue
  seam gained `open(home)` for it.
- **`refreshPolygonOptions` never adds a "drawn" option** — it appends the
  named polygon layers and nothing else, so `<option value="drawn">` has to
  be in the markup. Without it the draw completed, the ring reached the
  globe, and the extent select fell back to nothing.
- **The availability probe must be AWAITED, not slept past.** Choosing a
  dataset fires a `?dates` call that writes the status line and fills the
  date boxes when it lands; a window that chooses a dataset and requests it
  in one gesture gets that landing MID-REQUEST — "Requesting…" replaced by
  "Static dataset — the date range is ignored." for the thirty seconds a live
  pull takes, and a typed date range overwritten by the probe's own sixty-day
  window. `datesProbe` is the promise handle.
- **`viewBounds` needs THREE loaded**, and gee.js imports it lazily on the
  first request — so "Current globe view" answered null and did nothing at
  all on a page where nothing had been requested yet.

Two things about `map2d.js` a caller has to know: `drawLayer` returns early
on `!layer.visible`, so a bbox layer without `visible: true` is computed,
handed over and never painted; and **CARTO's free tile CDN now answers 200
with an "API KEY REQUIRED" watermark** rather than a tile (measured: 17
distinct colours in a zoom-3 `dark_all` tile), which is why this map opens on
OpenStreetMap. The globe's own basemap catalogue still offers CartoDB Dark
and Positron through `basemap-drape.js` and will wear the same watermark.

## "Which patch of ground?" is asked once — `extent-picker.js`

**Workspace and the fetchers are one loop, in both directions.** Every
extent select — the Atmosphere tab's `#gee-extent`, the GEE dialog's
`#gee-add-extent` AND the weather card's `#weather-extent` — passes
`{ allLayers: true }`, so any loaded Workspace layer (an uploaded
shapefile, a catalogue tick, a drawn shape) is offered as an extent by its
bounding box. And the reverse: a GEE pull whose extent is the LIVE drawn
overlay calls `persistExtent(..., { mark: "fetchExtent" })` on success —
the weather card's keep-the-ground rule — so the shape becomes a named,
project-registered Workspace layer ("Fetch extent W×H°", ▱-listed in the
selects, idempotent by shape) and the floating overlay stands down.
Guarded on `drawnOverlayBounds()`: an extent chosen from a named layer has
no overlay, so nothing double-captures. Verified end to end with a mocked
service: fetch over a drawn box → "Fetch extent 5.0×4.0°" lands in
Workspace, is offered ▱-marked in the extent select, and resolves back to
its own ring.

The weather card grew a good answer to that question and Earth Engine had a
third of one: a "Drawn polygon" option that read the live overlay and
**returned null** when there was not one — a dead end wearing the clothes of a
control, with the status line saying nothing. `gis/extent-picker.js` is the
weather card's answer lifted out so both ask it. Not copied: copied is how the
polygon-area formula came to be wrong in ten files and how the credit and
licence lines came to describe different maps.

The fallback chain is the whole point, and every step of it fails silently
without one: the live overlay, else the last CAPTURED extent still visible on
the globe, else arm the Draw tool and say so. Above that, any drawn polygon
still on the globe can be chosen BY NAME (`layer:<id>`, listed as "▱ Drawn
area 1"), so re-running a dataset over the same box next week is a choice
rather than a guess about which one a fallback would take. A `layer:` id whose
layer has been removed is an ERROR, not a silent resolve to undefined that
lets the request go out global. A hidden polygon is never the fallback — it is
not on the globe to be reused.

**It fixed a real longitude bug in gee.js.** `requestBounds` read the viewer's
`getExtractionGeometry` and passed those numbers straight through, but the
viewer carries **east-positive 0–360** — so a polygon over the Atlantic asked
Earth Engine for a bbox at longitude 315, the middle of Asia. Same trap
`signedLon` in bridge.js exists for; the conversion is inside the picker now
and `extent-picker.test.mjs` pins it (`resolvePolygonExtent` over a 350–355°
overlay must answer −10 to −5).

**A modal covers the globe, so "draw an area" cannot be done WITH the dialog
open.** The GEE dialog's ✏ button therefore arms the tool, stands the dialog
down, and holds the dataset, dates and tab subject in `pendingDialog` — so
reopening comes back to what you had, with the extent preselected to the shape
you just drew and the status saying "Using the area you just drew." Losing a
chosen dataset because somebody drew a box is exactly the side quest the
weather card was built to avoid. Verified live: SMAP + 2026-01-05/2026-02-05
survived the round trip, extent came back "drawn".

The Atmosphere tab's own `#gee-extent` gets the same list and the same
arm-on-select, because "any GEE pull" means that control too. Its option was
renamed `polygon` → `drawn`; `resolvePolygonExtent` accepts BOTH spellings, or
the rename would have broken the tab it was meant to improve. The GFS card
(`gee-live.js`) is deliberately untouched — it already has a broader picker
listing every vector layer, plus its own draw button.

**The GFS forecast (Earth Engine) subsection is GONE**, removed from the
panels.js MARKUP — the one source all ten worlds render from, so one edit
removed it everywhere. Its checked-first precondition held: `gee-live.js`
guards every control lookup (`if (!select) return`, `?.` throughout) and
nothing else reads `gee-gfs-*`, so no hidden-input dance was needed — unlike
`geology-structures-toggle`, which earth-viewer reads unguarded. The module
stays for its pure, unit-tested half; its wiring no-ops without the card.
What the card uniquely had — a DRAW-AREA button — moved to the Atmospheric
datasets section as `#gee-draw-area`, wired in gee.js: one press arms the
Draw tool, points `#gee-extent` at "drawn", and the next Request uses the
shape. The button is the GFS card's own TWO-PRESS
gesture, kept exactly: first press with nothing drawn arms the tool and says
"press this again to claim it"; second press CAPTURES the shape as a layer
named "Earth Engine fetch area" (Vectors & Shapes, project-restorable,
idempotent by shape), points the extent select at that layer by name, and
reports the bounds to the status line. And the extent select keeps the GFS
card's other rule — **every loaded vector layer is a possible extent**, not
only drawn shapes: `refreshPolygonOptions(select, fallback, { allLayers })`
lists them after the ▱-marked drawn shapes, and `resolvePolygonExtent`
answers a non-drawn `layer:` id from the layer's own `bounds`, CONVERTING
`{minX..maxY}` to this module's `{west..north}` there rather than leaking two
bound vocabularies to callers — the exact trap `drape()` documents. Verified
live: two presses set "Fetch area set: 8.09–29.49°N… Listed in Vectors &
Shapes", and a ticked Natural Earth countries layer appears as an extent and
resolves to its own bounding box.

## Live fetch: the hub's connectors in the catalogues, and weather by extent

**The Research Hub's fetch services are catalogue rows now.** Six of the
twelve `research/connectors.js` connectors (pure URL builder + converter,
CORS-verified, unit-tested) are DATASETS entries in `global-data.js` with a
`connector` field: USGS streamflow (hydrology), OSM places, BGS bedrock +
superficial 625k (geology-tectonics, group "UK geology (BGS)"), HadUK
rainfall normals, NWS alerts. `addDataset` routes them through
`runConnector`, passing the DRAWN study area as the bbox when one exists
(viewer lon is 0–360 east; every connector API wants signed — convert),
and writes the returned provenance (endpoint, time, feature count,
attribution) onto `layer.metadata`. EONET categories and USGS earthquakes
are deliberately absent: the Events tab already serves them as live feeds.
When a project is open, the bridge's registerImportedLayer hook records
these imports into the project registry automatically — that IS the
GIS↔hub pipeline connection, no extra plumbing.

**"Fetch most recent map by extent" is `gis/weather-maps.js`** — a card in
the Atmosphere tab (built by the module, Earth-only; the section markup is
shared with nine worlds that have no weather radar). Extent = the drawn
area or typed N/S/W/E bounds. Sources are a registry, the seam a Hetzner
relay (the old continuous-fetch scripts' home) can slot into later:

- **RainViewer radar composite** — `weather-maps.json` names the newest
  ten-minute frame; its Web Mercator tiles (≤48 per fetch, zoom chosen to
  fit) are composited then ROW-RESAMPLED to equirectangular before
  `drape()` — the sphere's UVs are linear in latitude and an unresampled
  Mercator canvas slides echoes poleward (the basemap's documented trap).
- **Open-Meteo GFS/ICON fields** (precipitation, 2 m temperature, 10 m
  wind) — one multi-location call sampling a 16×16 grid over the box,
  drawn at its own resolution (a coarse field PRESENTED coarse — the
  interpolated-WSM lesson) with a real legendInfo min/max/unit.
- **NOMADS GRIB is not CORS-reachable** from a page and never will be —
  measured; that is what the Hetzner scripts were for, and the relay
  route is the upgrade path for native-resolution GFS.

A re-fetch REPLACES the source's previous layer (two radar frames stacked
is a smear). Verified live: a 22:40 UTC radar frame draped over typed UK
bounds one minute after it was taken; a temperature field 12.8–22.5 °C
with its legend; HadUK pulling 112 cells with the full ArcGIS endpoint in
its metadata.

## Drawing: press-drag boxes, visible handles, one gesture grammar

**The Points tool** (`gis/point-tool.js`, Earth's page only) is the third
way data comes in: a rail button arms it, each CANVAS tap (window-level
capture gated on `event.target === renderer.domElement`, or every panel
click drops a point under the sidebar) picks the ground through the
viewer's own `surfaceLatLonAt`, live preview dots ride the spin through
`GeoIDProjectLatLon` (HTML overlay at z 5 — no THREE owned), and Done
files the set through `importFileList` as "Points N" (`frame: false` — the
points were just placed on screen), so symbology, extraction, the project
registry and the data-tag arrival card all just happen. Escape/Cancel
discards; an armed measure tool is stood down on arm and yields taps
either way. `pointsToGeoJSON` is pure and pinned (viewer 0–360 → signed).
The tool runs on the PLANETS too (boot.js MODULES): where
`surfaceLatLonAt` is absent it chains the world's own `pickOnGlobe` seam
in a loop — that pick resolves on pointerdown and swallows the event, so
orbiting while armed is not possible there (arm, click, Done), an epoch
counter guards the stale pick a mid-pick Done leaves armed, and disarm
synthesises Escape to settle it. Gas giants (no `setStudyAreaPolygon`)
never build the button. The Workspace + GEE button is Earth-gated in
add-data.js — gee.js never runs on the planet pages. Verified: Mars picks
two points into "Points 1" with Mars coordinates; Jupiter builds no
button. It REPLACED the Workspace "Custom" capture button, whose only unique
moment — shape drawn but not captured — the Draw HUD's Done already
answers, and whose empty press could only nag, stacking a note per press.

**Point letters are PROFILE furniture; the clocks can wear a zone.** The
A/B/C letters `addMeasureMarker` drew on every measure point now draw only
in profile mode — a profile is read against its chart whose axis runs
A→B, while a polygon's own annotation and the distance/route readouts
already say everything (verified: 4 dots 0 letters on a drawn box, 2 dots
2 letters on a profile). The letterless visuals push `labelSprite: null`
and the per-frame scaler now scales the dot before bailing on the label —
the old guard skipped the WHOLE visual. This is Earth-only code (outside
the porter's block; planets keep their own copies). And Settings ▸ Clock
timezone (`#gis-clock-tz`, stored as minutes in
`geoid-gis:utc-offset-min`) offsets BOTH clock displays — the
seven-segment corner clock and `#gmt-clock`, each naming the zone it
shows ("UTC+1") — while the model, the scrubber field and every fetch
date stay UTC on purpose: a request stamped in somebody's summer time is
the ambiguity zones exist to cause. The offset is read per tick, so a
Settings change shows within a quarter second, no reload.

With the Draw tool armed, PRESS on the globe and DRAG — a box grows live
under the pointer with its size in km beside the cursor; release and it
stands with eight visible handles (four corner squares that resize, four
edge dots that move). A TAP without movement still places a polygon
vertex — the decision is 5 px of movement, controls stand down at press
(in draw mode a drag draws), and a press-start stray vertex left by what
becomes a drag is erased by the first rect rebuild. Esc cancels any drag.

Three measured traps live in this apparatus:

- **Classify grabs by the PICTURE, not the ground.** The handles project
  the LIFTED surface point; the raycast hits the ground beneath — at
  oblique views they part by tens of pixels, so a grab classified by
  ground tolerance misses the very square it shows. `handleAt()` tests
  the pointer against the DOM dots; the drag itself still moves by ground
  hits.
- **Corners move by the drag's DELTA**, anchored to the corner's original
  position — the absolute ground hit sits a parallax-width inside the
  box, and min/max against it SHRINKS the span you meant to grow.
- **The vertex add is the canvas's own `pointerup`** (≤10 px gate against
  its recorded pointerdown) — a synthetic pointerup dispatched on
  `window` never reaches it, which reads as a broken tap and is a broken
  TEST. Target the canvas.

**The Draw HUD** (`gis/draw-hud.js`) is the gesture bar over the canvas
whenever a drawing tool is armed: Box / Circle / Polygon / Line, Done,
Cancel, and a hint line that always says the next step. The shape choice
travels as `window.GeoIDDrawShape` — box and circle drag-draw, "poly"
leaves drags to the orbit controls so taps place vertices. Circle is
press-centre-drag-radius (48-segment ring, live "⌀ N km" chip). Done =
`captureDrawn` → relief-hugging layer + overlay cleared (Enter works);
Cancel clears and puts the tool away. The HUD polls tool state at 250 ms
— rail clicks, shortcuts and modules all arm the tool, and polling beats
wiring into each. A persistent dimensions chip ("W × H km") rides the
rect's north-mid handle whenever a rect stands un-dragged. The side DRAW
card stays as the preset/precise path (regular polygons, exact km); the
HUD is the hands-first one — complementary, not duplicates.

Rect editing is wrap-safe (bounds renormalise on rebuild; corner/edge/
delta comparisons use wrapped lon distance) and hand-drawn polygons are
left alone — no corners a rectangle rule may move. The zoom pill's ends
are − and + now, not arrows.

### A drawn polygon is an OUTLINE, and its annotation survives the save

A saved shape came back as an opaque fill over the ground it was drawn
around — which is the opposite of what an extent is for. A geological unit
wants a fill because the fill IS the statement; a study area wants an edge.
`renderFeatureCollection` takes `outlineOnly`, which sends the rings to the
lifted depth-tested LINE buffer (with their colour) instead of to
`fillTriangles` and the coplanar `seal` — the seal has nothing to seal
against with no fill beneath it. `captureDrawn` passes it; ordinary imports
are unchanged.

**The mode rides with the LAYER, not with a paint call.** `repaint` is called
by every symbology path — the default paint on load, the dialog's Apply, a
catalogue palette — and none of them knows or should know whether this layer
is filled. `setFillMode`/`getFillMode` hold it on the layer and re-run the
LAST paint, so the fill mode and the palette are independent: verified that
applying an orange changed the colour and left the layer an outline.

The dialog gained two rows, both applying immediately (they are independent
of the palette, so there is nothing to hold back for): **Polygons**
(outline/solid, offered only where `setFillMode` exists — a layer with no
polygons would get a control that does nothing) and **Annotation** (on/off,
offered only for `ext === "drawn"`).

**Its Style row now opens on One colour.** A drawn shape is ONE feature, so
every column holds exactly one value and every one is disabled by the
two-distinct-values rule — "By attribute" opened a picker in which nothing
could be picked. `classable` is that test hoisted out of the option list.

**`gis/area-labels.js` keeps the writing on a saved shape**, following it as
the planet turns, scoped to `ext === "drawn"` on purpose: a geological map is
thousands of polygons and an area written in each is a wall of type over the
map it describes. It projects through **`window.GeoIDProjectLatLon`**, which
the viewer exposes from the same block that places the drag handles — a
module deriving its own screen position would be a second copy of an
arithmetic this file already records getting wrong. A plain global rather
than a viewer-seam property because the seam literal is built BEFORE that
block on the planet viewers and AFTER it on Earth; assigning into it would
work on five worlds and miss the sixth. That seam sits ABOVE the three
listener registrations, which are the porter's end anchor — put it below and
it never reaches the planets.

`vector-fill-mode.test.mjs` asserts on the GEOMETRY (a fill is a Mesh, an
outline is LineSegments) rather than on the option being accepted, because a
silently-ignored option draws exactly as before with no error anywhere.

### The Draw bar reaches every rocky world already, and arms UNDECIDED

**Nothing here needs porting by hand.** `draw-hud.js` is one shared module
loaded by `gis/boot.js` on the planets and by a script tag on Earth, so the
bar — icons, order, Custom, the export slot — is the same object everywhere.
The gesture behind it lives in the ported block, so `port-draw-tools.py`
carries it. Verified live rather than assumed: Mars and Mercury show the
identical eleven-item bar at 471 px and draw their own shapes on their own
constants (a hexagon reads 993 × 1134 km on Mars, where Earth's 111.32 would
have said about 2,100), and Jupiter builds no bar at all because it has no
`setStudyAreaPolygon`.

**A grep across `planet_explorer/*/viewer/*-viewer.js` can lie.** More than
one file matches that glob per folder, so `head -1` checked the wrong one and
reported four of the five worlds as missing a change the porter had in fact
made. Name the file (`$p-viewer.js`), which is what the porter's own table
does.

**The bar arms with NOTHING chosen.** It used to arrive on Rectangle — a
decision made for somebody before they had made it, and the first press drew
one. It resets to undecided every time the tool is picked up, not just the
first: coming back to whatever was drawn last is the same decision made twice.

Three states, and the third is the point: `GeoIDDrawShape` UNSET still means
"box", so a world that loads no Draw bar behaves exactly as it always did,
while "" is the bar saying it has not been told yet. `chosenDrawShape()` is
the one reading of that.

**Both gestures have to be held back, and the tap is the awkward one.** The
drag returns early from `drawPointerDown`; the tap is swallowed in
`drawPointerUp`, which is a WINDOW CAPTURE-phase listener and therefore runs
before the viewer's own bubble-phase vertex-add on the canvas — so a stray
click on an undecided bar cannot start a polygon. Doing it there rather than
in the click handler is also what carries it to the five rocky worlds, since
the porter copies that block and not the viewer's click handling.

### The preset card is gone — the shapes drag out on the Draw bar

It sized a triangle by typing a number into a field, which is a different
grammar from the one the rest of this tool uses, and it was where every fault
below lived. **The bar was reported as working perfectly, so the shapes moved
to the bar rather than the bar growing a card.**

Triangle, square, pentagon and hexagon are the CIRCLE'S OWN GESTURE with one
number changed — `DRAG_RING_SIDES` maps a shape id to a segment count, and the
ring branch that drew a 48-segment circle now draws any of them. A hexagon is
therefore drawn exactly as a circle is and there is no second path to keep
working. The square is turned 45° so a drag gives the axis-aligned box
everybody means by "square"; the odd-sided ones point north. Verified with
REAL mouse drags (`computer left_click_drag`): 3, 4, 5, 6 and 48 vertices.

They come in as GLYPHS and the original four keep their words: four more
words takes the bar from ~300 px to over 700 and off a narrow screen, and
"Triangle" says nothing a triangle does not.

**Export CSV is MOVED onto the bar, never copied** — the viewer holds a live
reference to `[data-measure-actions="area"]` and shows it as a measurement
comes and goes, so a copy is a dead twin. Borrow it on the TRANSITION, not on
every pass: `refresh` is polled and the viewer re-parents that node itself, so
borrowing each tick had the two passing it back and forth — measured, Done
sent it to the rail and standing the tool down sent it to the bar, the
opposite of both. The card did it on open/close and so does this.

**Synthetic pointer events do not exercise this drag.** A dispatched
pointerdown/move/up sequence left the shape untouched and read as a broken
feature through two rounds of debugging; the same gesture through
`computer left_click_drag` drew every shape first time. Where a drag is being
verified, drive the real mouse. (The clamp at ±85° is also real: a ring
dragged out near a pole collapses its vertices onto the limit, which looks
like a broken shape and is the clamp doing its job.)

### stopPropagation in a WINDOW CAPTURE listener also hides the event from OrbitControls

Picking up the Draw tool and pressing once left the globe following the bare
cursor with nothing held down — reported as "the globe navigation/spin
becomes fully coupled to the cursor movement".

`drawPointerUp` is registered `window.addEventListener("pointerup", …, true)`.
The undecided-shape branch called `event.stopPropagation()` to stop a stray
tap placing a polygon vertex — and in the CAPTURE phase on `window` that does
not merely hide the release from the viewer's own vertex-add. It hides it
from **OrbitControls**, which is mid-gesture because the press reached it
normally. Never told the button came up, it stays latched in `STATE.ROTATE`
and every later `pointermove` turns the planet. EVERY press-release while the
bar was undecided left it that way, so one stray click made the globe
unusable until the next press.

The fix is the mechanism that was already sitting ten lines below:
`suppressDrawClick`, whose capture-phase `click` swallower on the canvas the
drag path uses so one gesture is not also a vertex. **The CLICK is what adds
the vertex and it fires after the pointerup**, so suppressing the click stops
the vertex while OrbitControls still receives the release it needs to
unlatch. Inside the ported block, so `port-draw-tools.py` carried it to all
five rocky worlds.

**The A/B is the whole verification, and it needs a REAL mouse.** Synthetic
pointer events do not exercise OrbitControls here (this file's own warning),
so the check re-injected the fault live — a window capture-phase `pointerup`
calling `stopPropagation` while `GeoIDDrawShape === ""` — and drove real
clicks and hovers through `computer`. Measured, with the spin PAUSED so any
motion is the cursor's doing: **10.545 units of camera drift with the fault
injected, 0.000 with it removed on the identical gesture**, the tap still
placing no vertex and creating no layer, and a real drag with Square chosen
still drawing a 4-vertex shape with 0 camera drift. A clean number means
nothing here without the control that reproduces the fault.

### A preset shape is a DRAFT, and it has to re-sample as you fly in

"The header draw pill works perfectly, the issues lie in the preset shapes"
is the most useful bug report in this file: two paths make the same geometry
and only one looked right, so the difference is never in the maths. Four
faults, all in the preset path:

- **Placing COMMITTED.** `place()` called `captureDrawn()` the moment a
  preset was pressed, so choosing "square" stamped a permanent Study area N
  before you had said what size you wanted — and the capture is idempotent
  by SHAPE, so a resized box is a different shape and stamped ANOTHER.
  Measured: three presses left three layers on one patch of ground, one size
  change took 2 to 3, and at close zoom those stacked rings at different
  sizes are what "deformed" looked like. The standing overlay is the draft
  now, exactly as a drag-drawn box is; the HUD's Done is the one thing that
  saves it. One gesture grammar for both ways of making a shape.
- **A preset had no handles.** `rectFromMeasurePoints` needed EIGHT points;
  a drag-drawn box arrives subdivided and clears it, a preset square is its
  four corners. The floor is four now, with a sparse shape having to be a
  rectangle EXACTLY — every point at both extremes, i.e. a corner — because
  a triangle's three vertices all touch their own bounding box and rectangle
  handles would let a drag turn it into something it is not. This gate is
  INSIDE the ported block, so `port-draw-tools.py` re-runs with it.
- **The size field fired on `change` only**, so typing 25 left the 10 km box
  on screen until you clicked elsewhere and the field read as inert. It
  re-places on `input`, debounced, skipping half-typed values.
- **No preset took an XY extent.** Every one was regular, so a single side
  said everything about it, and a study area rarely is. The Rectangle uses
  `rectangleVertices`, which draw-area.js had exported and nothing used.

**And the lift is baked at build time, which is why a preset floated.**
`getMeasureDisplayLift` is a fraction of the distance to the surface — right,
and `activateStudyArea` samples each vertex ONCE. Measured on a 40 km square
placed at 3,006 km and then viewed from 20 km: the ring sat at radius 3.23591
where the ground is 3.2006, **about seventy kilometres above the terrain**,
and obliquely that reads as a deformed shape rather than a floating one. A
drag never showed it because a drag rebuilds on every pointermove at the
distance you are drawing from. `refreshMeasureForViewDistance` makes the
render loop rebuild when the viewing distance changes by a third either way,
never mid-drag — the same call the terrain slider already made for the other
input that moves the ground. Verified: the shape comes down 70.2 km by
itself. **Earth only**: the planet viewers re-project every measure point
with the CURRENT lift (`projectMeasurePoint`'s default) instead of baking
one, so they never had it.

### The area fill's APEX was round-tripped through lat/lon, and landed on the far side

A three-point polygon on Mercury drew a correct triangle with a long spike
trailing out of it — "the trailing kink outside of the 3 defined points". The
vertex list was innocent: three points, no wrap, no stray, because the OUTLINE
is built from boundary points that are never converted. The FILL is not. It is
a triangle FAN — one triangle per edge, all sharing an apex — and that apex was
derived by `vectorToLatLon` on the centroid direction and then
`sampleMeasureSurfacePoint` to turn the lat/lon back into a position.

**Those two do not agree about which way longitude runs on a west-positive
world.** Measured on Mercury: apex `(2.833, -0.199, -1.476)` against a true
centroid of `(-2.833, -0.199, -1.475)`. X negated exactly — the apex lands on
the OPPOSITE SIDE OF THE PLANET, 5.67 units away on a globe of radius 3.2,
while the shape itself spans 0.137. All 121 triangles ran to it, and that is
the kink.

The fix is to never leave the frame: the centroid direction and the boundary
are already in one, so the apex goes along that direction at the MEAN BOUNDARY
RADIUS. No lat/lon, no convention to disagree about, and it sits on the same
terrain the boundary was sampled from. The `kind === "moon"` branch a few lines
above already refuses the round trip for exactly this reason and says so — the
same lesson, learned once and not carried across to the planet branch.

Measured after: Mercury apex-to-centroid **5.6668 → 0.0000**, and Mars (which
never showed the fault, being east-positive) also 0.0000 with the apex radius
equal to the boundary mean to four decimals — the fix costs the working worlds
nothing. Applied to all six viewers that can draw; the four gas giants have no
such code because they have no surface to draw on.

**The diagnostic that found it**: read the fill mesh's own positions, take the
first vertex of every triangle as the apex, and compare it with the centroid
recomputed from the other two. An apex further from the centroid than the
shape is wide is the spike, stated as a number. The vertex list looked
perfect throughout — the geometry the USER sees and the geometry the app
RECORDS are two different things, and only one of them was wrong.

### The handles were drawn in the WRONG FRAME

`measureGroup` carries the globe's spin — `rotation.y = _spinDelta`, set every
frame — and the drawn outline is its child. `studyRectScreenPoint` projected
through `marsGroup`, the parent, which does not. So the handles were drawn in
the BASELINE frame and the shape in the spun one, and the two parted by
exactly however far the planet had turned since the page opened.

Measured on Mars against the viewer's own cursor readout, hovering each
handle: every corner off by the same **~10° of longitude — 592 km** — with
latitude exact to a fraction of a degree. *Latitude exact and longitude
uniformly wrong is the signature of a rotation about the pole*, which is what
separates this from a coordinate-convention error; look for that before
suspecting the CRS. Reported as "the click and drag to resize points have a
massive offset from the actual bounds of the shape", and it was.

`measureFrameGroup(context)` returns the frame the geometry actually went
into — `moonMeasureGroup` for a moon, `measureGroup` otherwise. The variable
is called `measureGroup` in all six viewers and is parented to each body's own
group, so this needs **no per-body rewrite**; the porter's group substitution
now only touches comment prose. `draw-port.test.mjs` pins both halves: it must
project through `measureFrameGroup`, and it must NOT project through the body
group above it. After the fix, with the planet still spinning, every corner is
within 0.8° on Mars and 0.25° on Earth — the documented sub-degree marker
parallax, not a frame error.

### The area is written ON the polygon, not in the corner

A number describing a shape belongs on the shape. The area used to arrive as
a card pinned to the corner of the window and the dimensions as a "W x H km"
chip clipped to the rect's top edge — so the one thing not near the polygon
was the number about it, and with two boxes drawn neither box said which card
was its own. `updateAreaLabel` replaces both with one ANNOTATION at the shape's
centre: its name, the area as the headline, and beneath that the BOUNDING
width x height — for free shapes as well as rectangles. Perimeter ("N km
around") was tried on free shapes and reported as noise: a fetch extent's
size is width by height, whatever the outline's wiggle. The saved-shape
annotation (area-labels.js) carries the same "W × H km" line, computed
with km-per-degree off the BODY's own radius, because that module runs on
the planets and 111.32 is Earth's number and nobody else's (the live
label's literal is per-body via the porter rewrite instead).

**An annotation, not a card.** A fill and a border sit on top of the polygon
and hide the ground it was drawn to look at, which is the whole reason for
putting the number inside the shape at all. So there is no background and no
border — the text is written on the map the way a place name is, staying
legible by carrying its own dark halo (three shadows: one soft glow vanishes
against bright imagery, one hard outline looks stamped-on over dark).

**The name is the one the shape will KEEP.** `nextDrawnName()` is exported
from drawn-layers.js and used by BOTH the annotation and `drawnFeature`, so
what is labelled while drawing is what the layer row says after Done. The
prefix is "Study area N" rather than the old "Drawn area N" because that is
the app's own word for this thing — the panel, `setStudyAreaPolygon` and
`activateStudyArea` all say so — and a label predicting a different name from
the one the layer takes is the two-names-for-one-thing fault `renameLayer`
documents at length.

Nothing is lost by dropping the card. What it also held — elevation range,
mean slope, geology, the histogram — is in the Study Area panel, which
carries strictly more of it. The split is the point: the label says what the
shape IS, the panel says what is UNDER it. Distance and Route keep their
cards, because a line has no inside to write in.

**The centroid is the wrong centre for placement.** `polygonCentroidLatLon`
is right for arithmetic and wrong for a label: the globe curves away, so the
projected midpoint of a large box sits ABOVE the middle of the outline you
can see. Measured on a 225 x 144 px box: horizontally exact, vertically
**20 px high** — a seventh of the shape, and it read as sitting on the top
edge. Placement samples the shape's own SCREEN box instead (a dozen vertices
is plenty, and it runs every frame), which measured 0 px offset in both axes;
the centroid survives only as the fallback for when the projection cannot
answer.

**Inside when it fits, above when it does not.** Measured: a box dragged out
14 x 10 px on screen was given a 94 x 38 px label — text swamping its own
shape and covering the corner handles you would reach for next. The label
steps above the top edge when the shape cannot hold it, which is what a map
does; "always above" would be worse, because a label inside its polygon needs
no leader line to say what it belongs to. Hidden entirely while a drag is
live — the chip at the cursor is already reporting the size, and two numbers
moving together is noise.

Being inside the ported block, one edit reached all six worlds. Verified on
Mars: centred to 3 px, and 2,333 km where Earth's constant would have said
4,389.

### The drawing tools are on the rocky worlds too, by GENERATOR

The press-drag box, the eight handles, the size chips, the hover cursors
and the Escape cancel now run on Mars, the Moon, Mercury, Venus and Pluto.
There is no module they could share — every planet viewer is a
self-contained copy, and `stamp.py` deliberately does not sweep
`planet_explorer/**/*.js` — so the choice was five hand-maintained copies
or one generator. **`services/port-draw-tools.py` is the generator**: it
lifts the block out of earth-viewer.js between two fixed anchors, rewrites
the three things that are per-body, and writes it between markers so
re-running REPLACES rather than duplicates. `--check` exits non-zero when a
copy is stale. **Edit Earth's copy and re-run it; never edit a generated
block** — that is the lesson the polygon-area formula cost, the same
arithmetic written out in ten places and corrected in one.

The three per-body rewrites, each a real bug if skipped:

- **Kilometres.** 111.32 is Earth's and nobody else's, so it comes off each
  viewer's own mean-radius constant. Measured on Mars: the same box reads
  697 x 1410 km with Mars's radius and would have claimed 1312 x 2654 with
  Earth's — the exact shape of the `MARS_MEAN_RADIUS_KM = 58232` fault, and
  invisible without a number to check it against.
- **The scene group.** The handles project through it; Mercury, Venus and
  Pluto each have their own, and the wrong one puts every handle off the
  canvas. Verified on Mercury: 8 of 8 handles inside the canvas box.
- **`lonDelta`.** These files already have a `const lonDelta`, and a
  hoisted function declaration beside it is a SyntaxError — one that would
  have bitten only the worlds whose file happens to have both.

**A gas giant gets no HUD, and the test is the SEAM not the button.** All
four carry `tool-rail-area` in their markup but have no
`activateStudyArea` behind it, so keying the HUD on the button put Box,
Circle, Polygon and Done on Jupiter with all four inert — "wire it or
leave it disabled". `draw-hud.js` gates on
`window.GeoIDViewer.setStudyAreaPolygon` instead, with a bounded retry
(the viewer boots async, so a missing seam early is usually just early;
120 tries then stop, rather than polling Jupiter for the life of the
page). Verified: Jupiter builds no HUD and keeps its zoom.

Two seams the port had to add to all five: `clearStudyArea` (the HUD's
Done and Cancel call it) and the `geoid-study-area-edited` dispatch inside
`setStudyAreaPolygon`, which is what `gis/pipeline-sync.js` listens for —
without it the planets drew shapes the project never heard about.

`draw-port.test.mjs` asserts each generated block is byte-for-byte what
the porter would write today, that no Earth kilometres survive in any of
them, and that the four gas giants are untouched.

**The pipeline follows the pen: drawing syncs GIS, Model and Research live**

Three seams keep what the user draws and what the pipeline knows in step,
with no button between them:

- **`setStudyAreaPolygon` announces** (`geoid-study-area-edited`) — every
  creator flows through it (presets, the weather box, restored areas) and
  drag edits already announced, so one dispatch covers all of them.
  `gis/pipeline-sync.js` listens and, 900 ms after the shape settles,
  writes the OPEN project's `study_area` bounds and
  `metadata/study_area.geojson` via the bridge's own captureStudyArea.
  Silent when no project is open (the ordinary state) and when the bridge
  refuses an antimeridian-crossing area.
- **`captureDrawn` registers the shape as a DATASET**: alongside the
  processed artefact it now calls `registerImportedLayer` with a File
  built from the GeoJSON, so the drawn shape lands in the project's data
  registry with a `data/raw/` copy — the same standing as any import.
- **"To Model" in the layer drawer** for drawn polygon layers hands the
  ring's bounds to the Meshing Studio through the same `sendToStudio` the
  Research Hub's button uses.

Drawn layers were ALREADY live inputs to clipping, zonal statistics and
extraction (they are ordinary vector layers; the tool selects list them
on layers-changed) — measured, not assumed. The layer drawer's tile is
`.layer-options` opened from the ROW; a probe that greps page-wide
buttons reads the catalogue's Symbology and misses the drawer entirely.

## Active fires, and the two things that made the first attempt unreadable

**A large CATALOGUE is not a point CLOUD, and the count cannot tell them
apart.** `renderFeatureCollection` switched to world-space sizing above 20,000
points — right for a LiDAR return or an XYZ surface, where the points ARE the
ground and a fixed pixel size would paint the globe solid. Applied to 90,987
fire detections it drew each one at 0.018 WORLD units: sub-pixel from orbit,
enormous up close, and never the same size twice. Ninety thousand detections
are ninety thousand PLACES. `pointStyle: "places"` on the entry overrides the
count; past 20,000 the mark shrinks to 3.4 screen pixels and drops its white
ring, because below about six pixels the disc and its outline are the same
three pixels of screen and the ring only doubles the fill.

**And confidence was the wrong variable.** It answers "is this real"; FRP
answers "how big is it", which is what a fire map is for. Measured today,
0.08 to 443 MW on VIIRS and up to 10,407 on MODIS — a spread no categorical
palette can show. Entries may now carry `colourRange` (field, method, classes,
ramp), which routes to `paintByRange` — the same classing the rasters use, so
a vector and a raster cut the same numbers the same way. **Quantile, not equal
interval**: a handful of enormous fires would otherwise put every ordinary one
in the bottom class and the map would be one colour.

### Real mapped polygons exist, for the United States

A detection is a hot pixel; a **perimeter** is a surveyed boundary with a
name, a cause and a containment figure — the one thing the satellite feeds
cannot give. NIFC's WFIGS layer is public ArcGIS, CORS `*`, no key: measured,
**234 current perimeters**, and Big Grass in Oregon reads 575,163 acres at 93%
contained. `attr_` is the incident record and `poly_` the mapped polygon, and
they disagree about size on purpose — the declared acreage and the drawn one
are different facts, so both are kept and both are labelled. Discovery time
arrives as epoch MILLISECONDS; a bare number in a card is not a date.

US only, and the layer's own name says so. EFFIS/GWIS publishes burnt AREA
rather than active perimeter and its services are fragmented per country, so
there is no browser-reachable global equivalent to promise.

### Why not the FIRMS API, given a key

**It sends no `Access-Control-Allow-Origin` header at all** — measured on both
the area endpoint and data-availability, on the error responses too. A browser
cannot call it with a key or without one; it would need the sidecar or a
relay. Esri's Living Atlas hosts the same VIIRS stream with CORS `*` and 2.6
million rolling records, and it is refused for a different reason: Esri's own
FAQ lists Living Atlas commercial use under "you may not". GIBS is NASA's own,
keyless, and carries no commercial clause.

## Active fires: FIRMS through GIBS vector tiles, not through FIRMS

The Events tab's EONET wildfires do NOT cover this, and the two are different
kinds of thing. EONET is curated NAMED EVENTS — measured on one day, **496 of
500 open wildfires in North America**, so it will essentially never show a fire
in Northern Ireland or the Congo. FIRMS is raw observation: every pixel that
looked hot, with its intensity. Both belong; neither replaces the other.

**FIRMS' own routes are closed to a browser.** The bulk CSVs answer 200 to
curl and send **no `Access-Control-Allow-Origin` header** (and VIIRS is
17.7 MB a day); the API and WFS are CORS-open but need a MAP_KEY, and a
browser cannot hold a secret. **GIBS publishes the same detections as Mapbox
Vector Tiles** — keyless, CORS `*` — and `gis/mvt.js`, written for Macrostrat,
already decodes them.

Four things there are measured and each is a bug reversed:

- **The world is TWO tiles.** EPSG:4326 is 2x1 at zoom zero, so `0/0/0` and
  `0/0/1`. Fetching one returns the western hemisphere and calls it global.
- **The matrix set is the 4326 endpoint's own** — `1km` for MODIS, `500m` for
  VIIRS — NOT the `GoogleMapsCompatible_Level7/8` names the 3857 capabilities
  document lists. Asking for `1km` on a VIIRS layer is a 400.
- **The two tiles OVERLAP**: 16,905 raw features deduplicated to 13,720, so
  19% were carried twice. Keyed on FIRMS' own `UID` plus position and time.
- **The tiles are gzipped.** `fetch` undoes it transparently; curl hands back
  the compressed bytes and the decoder reports "unsupported wire type 7",
  which reads as a corrupt tile and is a testing artefact.

MODIS and VIIRS name the same measurements differently — `BRIGHTNESS` vs
`BRIGHT_TI4`, confidence 0-100 vs `l`/`n`/`h` — so a converter written against
one gives the other a column of nulls under a correct-looking legend.
`confidenceBand` is one vocabulary across both (FIRMS' own thresholds), which
is why `colourBy` can be `confidence` and the two layers share a legend. FRP
is the more interesting variable and is one click away in Symbology, which
classes numeric columns. `label_rank: 0` on every detection: ninety thousand
names is a white planet, and a thermal anomaly has no name.

`runConnector` gained a **`load`** branch. The existing shape — one URL,
`res.json()`, one pure converter — covers everything that speaks JSON over a
single request, which was all of them; binary vector tiles over two requests
would have meant a fetch wrapper returning something other than what it
fetched.

**`registerMarkerMaterial` on a non-marker cloud cost 52 fps.** It writes the
shared marker size — 7, in SCREEN pixels, which is what that means for
`sizeAttenuation: false`. Applied to the >20,000-point path, which attenuates
and sizes in WORLD units, every point became seven units across on a globe of
radius 3.2: more than twice the planet each. Measured on the 90,987-point
VIIRS layer, **60 fps to 6**, and the diagnosis is FILL RATE rather than
vertex count — a tenth of the points at that size ran at 50 fps while all of
them at a twentieth of the size ran at 61. The registration is gated on
`asMarkers` now. Introduced by the far-side-cull change one commit earlier,
which is the shape to watch for: a helper that sets a property as a side
effect, reused on a path that means something else by it.

## The theme audit is a MEASUREMENT, and the planets pass it

The instrument: inventory every visible element's computed font family, size
and colour, grouped by tag.class, and flag any role with MIXED signatures or
a non-app face. It finds what an eye pass cannot — five 16 px inputs beside
eight themed ones, a chip whose children are styled while its host button
sits in UA Arial-on-ButtonFace, two monospace stacks one rule apart. Two
flags it always raises are DESIGN, not defects: the `.button`
cyan-at-rest / dark-ink-primary split (the viewer skin's own convention) and
the cyan-caption/white-value span split (the label/readout language).

Run on ALL TEN WORLDS, the workbenches came back clean first pass — the
whole Earth theme rode in on the shared modules, which is what shared
modules are for. And the GIS tools genuinely run everywhere: on every world
including the four gas giants, a point layer imported through
`importFileList` is offered in the tools dialog and Buffer runs through the
real form to a real layer (measured, 2 features out on each of the ten).
The gas giants lack the DRAW tools — no surface to draw on — but the
import-and-process pipeline is whole there; drawing is the only per-body
gate. The page-wide sweep found one real category on every world:
**form controls default to the UA's Arial**, hidden on checkboxes and
sliders, visible the moment a control carries a glyph or a word. And
`font-family: inherit` DOES NOT FIX IT — measured still-Arial on Mars,
because a control's parent chain often sets no family and inherit just
fetches the UA default from further up. The explicit stack on the bare type
selector does, and still loses to any classed rule, so deliberate faces
(the monospace fields) survive. Verified after: zero alien-font controls and
zero white scrollbars on Mars and Mercury alike.

## A half-parsed stylesheet looks like a half-implemented theme

"The theming of the gis tools is still incomplete" — it was complete and
UNREAD. `.gis-sym-swatch` in panel-styles.js never closed its brace, and CSS
error recovery swallowed every rule from there to the next stray close —
which existed: an orphaned `border: ...; }` fragment with no selector further
down. The two faults CANCELLED into a sheet that parsed without an error
anywhere and simply lacked eleven rules, so the ramp gallery fell back to
platform-white ButtonFace chips while its gradient bars, names, hover and
active states sat in the same style tag.

The diagnosis that works: compare `tag.sheet.cssRules.length` against the
selectors in the tag's own TEXT and find where they diverge (40 parsed, 51
written). Nothing throws, the module runs, module-css.test.mjs's end-of-block
checks pass — this failure is quieter than the backtick and the octal escape.
**module-css.test.mjs balances braces now** (comments stripped) in every
STYLE literal, and it caught the orphan half of the pair the moment the
missing brace was restored.

The `.gis-tool-body` form rows also carry the tools-window voice from
panel-styles.js — stacked rows, Exo 2 uppercase data-cyan captions above
full-width fields, checkbox rows inline — so Analysis, Preprocess and the
tools window speak as one.

## The tools window wears the sub-tab voice, and scrollbars are settled at the root

`#gis-tool-dialog`'s form rows are scoped in tool-dialog.js: labels ABOVE
full-width fields (this panel's labels are sentences — "Outcome field (blank
= all are occurrences)" — and the page's generic two-column `.row` squeezed
"Observations" to "Observatio"), Exo 2 uppercase letterspaced data-cyan
captions, fields on the workbench ground with an accent hairline, and Run as
the one accented act — which needs `!important` because viewer-skin paints
every `.tool-button`'s colour with `!important` of its own (measured: accent
fill under CYAN ink without it).

Three sizing traps in that window, each measured: `.gis-btn-row .button`
stretches only Defaults (Run is a `.tool-button` no flex rule touches — 56 px
of RUN beside 180 px of Defaults); the chain chips inherit
`.measure-actions`, a THREE-column grid for the rail's short verbs, so two
sentence-length buttons rendered as 99 px towers; and the window's scroller
is the FALLBACK shell body, which had no scrollbar colour of its own.

**`scrollbar-color` is an INHERITED property — settle it at `:root`.** The
audit (walk every element whose computed overflow can scroll, flag
`scrollbarColor === "auto"`) found four modal windows and thirteen
viewer-level scrollables wearing the platform's white bar after the panels
had each been fixed by hand. One `:root` declaration in styles.css and
shell.css reaches every scroller the app ever makes; per-element fixing is a
treadmill. Verified: 51 scrollables, zero `auto`. And the verification
itself hit the reused-stamp trap AGAIN — the pre-commit re-audit read "22
still white" from a CACHED stylesheet; after commit-stamp-amend the same
rule measured clean everywhere. Commit first, then verify.

## The tool registry was swept from the DIALOG, and that is the test that counts

All 47 tools run through `openTool`, the real controls and the real Run
button, against fixtures with closed-form answers (a collinear polygon pair,
attributed points, a line, a gaussian-hill DEM imported as `.asc` — the ASCII
grid is the cheap way to a genuine raster fixture). Six faults, none of which
a seam test had shown, all fixed:

- **The boolean degeneracy is now guarded in ALL THREE ops.** Collinear
  overlapping edges defeat `segmentIntersection` (zero denominator), leaving
  an odd crossing count; the traversal then returns the subject whole OR
  shreds into near-zero fragments. `unionRings` accepts exactly two shapes of
  answer (one ring covering both, or the inputs back with area intact);
  `intersectRings` bounds-checks every piece against the overlap box;
  `subtractRings` audits by TILING against the checked intersection. All
  retry against a ~0.1 mm nudged mask and fall back honestly. Clip +
  difference of any subject must tile it — that invariant is pinned.
- **`{ value, label }` options passed the dialog and failed the validator**
  (`o.id === value` only): mosaic refused every choice INCLUDING ITS DEFAULT
  from the day it shipped. A registry with two option spellings needs every
  consumer to read both.
- **A field param can be `optional: true`** — blank reaches the engine as
  "whole layer". Dissolve (merge-everything had no door) and rocAuc/confusion
  (whose labels promised blank worked while validation refused it) carry it;
  the dialog offers a "— whole layer —" row.
- **`of:` on a field param is not decoration**: without it the field list is
  built from the FIRST input, and for raster-first tools that is a layer with
  no fields — an empty select and a refusal for a value that could never be
  chosen.
- **An error message must name the actual fault**: reclassify's comma-only
  split kept "a; b" whole and taught `min..max:class` when the SYNTAX was
  right and the separator was the problem. Separators are commas, semicolons
  or whitespace now.
- **The dialog's output-name resolver got only the FIRST input**, so
  templates naming a second (`dist_{features}`) reached the Workspace with
  braces in the layer name.

The sweep also proved the answers, not just the runs: clip 2225.5 vs 2225
km², difference 1731 vs 1731, blank dissolve 3832.9 vs 3833, ROC AUC 0.5 on
deliberately uncorrelated observations — which is the CORRECT answer, and a
tidy reminder that a validation tool agreeing with chance is sometimes the
data, not a bug.

## A container cannot be sized by a child that refuses to give way

The layer drawer under a Workspace row pushed straight through the tile it
lives in. Measured: a **428 px drawer inside a 382 px dock**, 78 px of it
past the right edge — while nothing overflowed inside the drawer at all
(`scrollWidth === clientWidth`). That is why it presents as "the drop-down
does not fit in its margins" rather than as a row of buttons overflowing:
the row was not overflowing, it was SIZING its parent.

`.layer-options-actions` was `flex-wrap: nowrap` with `flex: 0 0 auto` — a
child that can neither wrap nor shrink, so its min-content width becomes the
drawer's min-content width and the drawer grows to whatever the buttons
happen to add up to. That was right when the comment beside it was written
and there were THREE buttons ("the three are alternatives to one another").
There are eight: Hide, Focus, Symbology, Table, Export, To project, To
raster, Remove — 383 px of button plus gaps, in 360 px of room.

They wrap now, and the drawer and its sibling `.layer-props-inline` each
carry `box-sizing: border-box` with a `max-width`, so neither can exceed its
row whatever is added to them next. The rule generalises: **when a box is wider than its container and
nothing inside it is clipped, look for an unshrinkable child, not for a
missing overflow.** And since this CSS lives in `layer-hierarchy.js`'s STYLE
block, the fix reached all ten worlds.

**Then it went to ONE line, by removing two things rather than by shrinking
one.** The feature count ("1 features") claimed the drawer's whole first line
to restate what the layer's own row and its legend entry both already carry —
gone the same way the format badge went, and for the same reason: a drawer is
the things you can DO to a layer. And the 1.35rem left indent lined the drawer
up with the row's TEXT rather than with the row, which reads as a drawer
untucked on one side and was 22 px of exactly the width the buttons needed.
With both gone, eight buttons fit one line at 0.55rem / 0.24rem padding /
0.16rem gap — measured 337 px of buttons in 348 px of drawer, flush with the
row at both edges, 36 px tall against 81. Wrapping stays as the fallback: at
the 20rem dock the short-landscape rule imposes, one line is not
arithmetically possible, and two whole buttons beat eight clipped ones.

**Measure ROWS, not widths, when sizing a row to its container.** The first
sweep compared the button run against `tile.clientWidth` and every candidate
"fit" — because a `nowrap` child inflates the tile that holds it, so that
comparison answers itself. Counting the distinct `top` values of the buttons
is the question actually being asked.

**And the backtick trap, for the FOURTH time in this file's history** — my own
new comment said "wrap" in backticks INSIDE the STYLE literal, which ends the
string and takes the whole module out. `module-css.test.mjs` caught it in the
same minute, which is the only reason it cost nothing. An edit that touches a
STYLE literal should ASSERT the literal is backtick-free rather than trusting
anyone to remember.

## A drape is painted ON the ground — two constants, neither read in metres

"The mapping of the rasters looks like it's not tight to the surface"
measured out exactly, and neither half was in the placement: four raster
layers sitting still at 95 km were every one **142 m BELOW** the terrain
they paint, and forcing the relief rebuild snapped all four onto their
intended heights to the metre. They were never mis-placed. They were STALE.

- **The rebuild threshold was 796 METRES.** It reads as 0.0004 — borrowed
  from the viewer's own terrain re-sync — and relief scales a NORMALISED
  elevation, so 0.0004 / 3.2 x 6371 km is 796 m of ground movement at a peak,
  tolerated before anything re-lays the patch. Descending tapers the
  exaggeration away continuously, so a drape drifts the entire time it is
  being flown toward. `REBUILD_METRES = 10` now, stated in metres with the
  conversion beside it, and compared **per mesh** against the relief that mesh
  was built at (`userData.builtRelief`): one shared `lastRelief` measured a
  drape created between two rebuilds against a number that was never its own,
  and never corrected a drape built while the global sat inside its
  threshold. Measured after, flying 2,000 → 8 km through the whole taper
  (relief 0.11 → 0.0002, some 700 m of ground movement): worst offset
  **0.3–1.5 m** at every altitude.
- **The stack lift was pure parallax.** 30 m a layer, so the twelfth map sat
  **329 m** off the ground. It existed to stop two maps fighting for the same
  pixels — which is a DEPTH fight, and this material stopped depth-testing
  long ago. With `depthTest: false` the buffer is never consulted, the higher
  `renderOrder` wins outright, and the layer box's own draw order was already
  doing the stacking. Zero now.

`drape-registration.test.mjs` pins both in the only terms that mean anything
— metres between a drape's vertices and the ground under them — including
the twelfth drape of a stack, and a drape whose ground moves under it.

**And the OTHER half of that report was not a rendering fault at all.** A
slope map over an 11 km study reads as a smooth colour ramp with one hard
straight seam through it, which looks like a bug and is a source pixel
boundary: measured on the Valais box, **2 curvature kinks in 200 samples
across 0.1°**, so the whole study area is about ONE global-DEM pixel wide and
a 92 m grid over it is interpolation, not ground anybody surveyed. The
sampler answers at any spacing asked of it, and everything downstream —
slope, aspect, hillshade, contours — inherits the false precision. So the
`terrain` tool quotes the source's own MEASURED sampling beside the cell size
it produced and says outright when the grid is interpolated between pixels
("93 m cells, 84x121. The source's own sampling here is about 9,575 m, so
this grid is INTERPOLATED between its pixels"). The Model Builder's Surface
step already measured this, so `probeNativeStepM` **moved into
`model-build.js`** — the pure half both callers import — rather than being
written a second time. Same discipline as the imagery zoom ceiling and Earth
Engine's `scale`: a service will always answer; whether it KNOWS anything at
that spacing is a separate question, and the one worth printing.

**A green slab over the whole study area is the study-area POLYGON, not the
raster.** It cost a round: an imported polygon fills by default, draws above
the drapes, and its legend swatch is the tell. Check what is actually on top
before diagnosing the layer underneath it.

## The sharp tiles' half step, and the flattening that hid under a window

The map kept showing coarse, misshapen polygons where the streamed fine ones
belong. Counted BY ZOOM at that view: 16 zoom-2 backdrop tiles visible at
renderOrder **51**, and the one visible zoom-7 tile also at **51** rather than
51.5.

`applyStack` re-stamps every node on each hierarchy change and was flattening
the half step the tiler puts between the view's sharp tiles and the coarse
backdrop they replace. With both on the same order the winner is TRAVERSAL
ORDER, so the coarse map could draw over the fine one. It went unnoticed for
as long as it did because the backdrop used to be CUT AWAY under the sharp
tiles — the two never overlapped, so the flattened lift cost nothing. Keeping
the backdrop for opaque layers, which is what closes the hairline seams,
turned a harmless flattening into the visible fault. **A latent bug is only
latent until something removes the thing that was hiding it.**

`keepRenderOrder` is the wrong tool here: these nodes must still track the
stack or dragging the layer stops working. They record a fractional
`userData.renderLift` and `applyStack` adds it to the band, so the offset
rides the band wherever the row is dragged to — pinned in
`draw-order.test.mjs` at both 51 and 55.

**And the verification before it was circular, which is why it reported a fix
that was not there.** It asked whether any feature covered each sampled
screen point using `features()` — which returns whatever tiles are SHOWN. With
only the backdrop shown, that test passes ON the backdrop and says nothing
about the sharp tiles. **When checking whether the right thing is drawn, count
the things drawn; do not ask the drawing what it contains.** Counting visible
tile groups by zoom is the question that was actually being asked, and it
answered in one pass.

## A zoom the view cannot be COVERED at is not a zoom

The map broke at a 20 km scale bar: a coarse slab across half the screen with
the fine map beside it. Measured at that view, the diagnosis was the opposite
of missing data — "Southern Highland Group" covered EVERY sampled point of
the grey area, and the sharp tiles were built, coloured and carrying
`visible: true` while their PARENT node was hidden. Only the zoom-2 backdrop
was drawing.

`update` fetches `tilesForBounds(bounds, z).slice(0, maxTiles)` — a
**TRUNCATION, not a refusal** — so a zoom needing more tiles than the cap
paints part of the view sharply and abandons the rest to the backdrop.
`chooseZoom` only ever weighed the FEATURE budget, which is how long the
triangulation takes; it never asked whether the view could be covered at all.
That did not matter while the feature budget was the binding constraint, and
the per-tile fix above made the deeper levels reachable — which are exactly
the levels needing more tiles than the cap allows. **The per-tile fix did not
create the truncation; it walked the map into it.**

Two limits, and they are not the same kind: the feature budget decides how
SLOW a view is, the tile cap decides whether the picture is WHOLE. Only the
second can make the map wrong rather than merely sluggish, so it is checked
first. Measured after, at the reported 20 km scale bar: **30 of 30 sampled
screen points carry geology, 100% coverage**, no slab.

**And the window change made this legible rather than causing it.** With the
backdrop cut away the uncovered ground was BLACK, which reads as tearing;
keeping it turns the same fault into the coarse map showing through, which
reads as what it is — coverage. A fault that shows its own shape is worth
more than one that hides in a colour you already distrust.

## "The clipping is riddled with errors" — the clip was clean, the map was not

Reported against the clipped geology, and the clip is not what is wrong.
Measured on its output: 52 features, 58 rings, 318 triangles, **zero
inward-facing, zero degenerate, no bridge triangles**, longest edge 0.009 on a
shape spanning 0.02. There is nothing torn in it.

What is torn is the map underneath. **The tiled world geology stops refining
at zoom SIX** while `zoomForBounds` says a 0.5° study area deserves eleven —
so at any close view you are looking at heavily generalised polygons, and
their triangulation slivers are what read as tears.

`chooseZoom` refuses the deeper levels, and the reason is a constant that is
right about the wrong thing. `BEYOND_BAKE_GROWTH = 8` is measured from the
WORLD's own totals — 18.2 MB baked at zoom 5 against about 150 MB at zoom 6 —
but that 8 is two things multiplied: **four times as many tiles, each
carrying twice the content.** A view smaller than one tile gets none of the
first half: `tilesForBounds` returns one tile at zoom 5, one at 6 and one at 7
for that box. Charging it 8x a level therefore over-predicts by four times a
level, and the map is refused detail that costs nothing.

Measured on that box, features actually TOUCHING it:

| zoom | tiles | features in box | vertices | units |
| --- | --- | --- | --- | --- |
| 5 | 1 | 11 | 283 | 9 |
| 6 | 1 | 81 | 1,314 | 22 |
| 7 | 1 | 88 | 1,853 | 22 |
| 8 | 1 | 88 | 1,856 | 22 |
| 9 | 1 | 88 | 1,793 | 22 |
| 10 | 4 | 106 | 2,177 | 22 |
| **11** | 16 | **151** | **2,543** | 22 |
| 12 | 49 | 123 | 1,466 | 15 |
| 13 | 156 | 38 | 325 | 8 |

**I first read this curve at zoom 9 and concluded it plateaued at 7. It does
not** — it dips at 9 and then climbs to its real peak at ELEVEN, nearly
double the boundary detail of the zoom 6 the display was pinned to. Reading a
curve to its first flat stretch is how a measurement gets stopped one level
short of its own answer. Past 11 the compilation goes THINNER rather than
finer: 123 features at 12, 38 at 13, with the unit count collapsing 22 to 15
to 8. The ceiling is the data's, and it is a peak rather than a plateau.

The extrapolation is per TILE now, multiplied by the tiles the view actually
needs — a wide view still pays the tile count, a small one pays only for the
content. Measured after: the same view reaches **zoom 9** and is refused 10
and 11, with feature counts of 9,273-10,103 against the 24,000 budget.

**And clipping must not take the SCREEN's level at all.** `featuresIn` asked
`chooseZoom`, whose feature budget exists to protect the frame rate and is
irrelevant to an extraction that draws nothing — so a clip captured 81
features and 1,314 vertices where 151 and 2,543 were there to be had.
"As deep as possible" is equally wrong, for the reason the table shows.

So it CLIMBS while the ground gets more detailed and stops when the source
has run out, and two details decide whether that works:

- **Detail is counted in VERTICES of the features touching the box, never in
  feature count.** A deeper tile can hold fewer, larger pieces of the same
  ground, and counting pieces would call that an improvement.
- **The curve dips before it peaks** (1,853 at 7, 1,856 at 8, 1,793 at 9,
  2,177 at 10, 2,543 at 11), so stopping at the first level that gives less
  returns zoom 8 and throws away the best of the map two levels on. Two
  barren levels in a row is the ceiling; the best seen is kept.

A probe costing more tiles than the whole view is refused, and an explicit
zoom is still honoured exactly, because the display path depends on that.
Measured through the real Clip tool afterwards: **151 features and 22 units
against 81 features before**, in 2.4 s.

**A run BORROWS the study area's features; it must give them back.**
`featuresIn` swaps them onto the layer so the synchronous readers beside it —
a tool engine, a clip — see the right ground, and nothing put them back.
Measured: `layer.collection` reading **216 features while the map drew
9,137**. `featuresAt`, the click picker, walks exactly that list, so a click
anywhere outside the last study box matched a leftover from inside it and the
highlight and pin went with the leftover — reported as the interactive
element degrading and the pin dropping far from the target. `runToolAuto`
restores in a `finally` (a throwing engine cannot leave the map amputated
either) and the extraction panel restores after its package is built;
`liveCollection()` reads the tiler rather than any snapshot. Verified: 9,137
before a clip and 9,137 after, the clip still capturing 151, and a real click
at 54.8951, −6.1968 opening the card for the unit independently computed to
contain that point.

**And the black wedges are NOT the triangulation — I measured that wrong
twice.** The first pass compared drawn triangles against `vertices − 2` per
ring and reported 3.9% missing; the second used `n + 2h − 2` for holed
polygons and reported a 7.89% shortfall. Both formulas are wrong: ear
clipping BRIDGES each hole into the contour, so a polygon with n outer and h
hole vertices yields **n + h** triangles, not n + 2h − 2. Measured against
outer rings alone, where the arithmetic is unambiguous: **55 polygons of
8,997 lose any triangle at all — 57 triangles out of 106,131.** Nothing
throws, no hole is rejected, no ring is too short. The triangulator is doing
its job.

**When a shortfall is computed rather than counted, check the formula before
believing the shortfall.** Two rounds of hunting for missing geometry that
was never missing.

**The gaps: an attempt that had to be REVERTED, recorded so it is not
retried.**
They are real but tiny — measured on the live tiles, **44.9% of edges are
shared by two polygons** and the strays sit tens of metres apart. The seal
that exists to cover them is a LINE, and **WebGL draws every line one device
pixel wide whatever `linewidth` says** — about 20 m of ground at a 35 km view
and less as you descend. The seal loses that race by construction, so a wider
line is not available and would not be the fix if it were.

What makes those seams BLACK rather than merely visible is the window: the
view's tiles cut the coarse backdrop away exactly where they paint, so behind
a hairline gap there is nothing at all. Keeping the backdrop for opaque
layers closed the seams — verified at 45 km and 120 km — **and was wrong**.

It also paints the coarse map over every place the fine tiles deliberately
leave BLANK, which is most of the ocean. Measured at a 500 m scale bar off
the Antrim coast: a continental-scale generalised unit painted green across
half the screen, over SEA at −37 m, where the zoom-9 tile correctly has no
polygon at all — and unclickable, because every picker reads the finest
zoom's features and the backdrop's are not among them. **A hairline seam
traded for geology over water is not a trade.** Reverted; the comment in
`maskBackdrop` says why not to retry it.

The seams stay until the seal is a ground-width RIBBON instead of a line.
There is no version of the current approach that scales, because **WebGL
draws every line one device pixel wide whatever `linewidth` says** — 20 m of
ground at a 35 km view, and less as you descend.

**What the gaps were NOT**, each ruled out by measurement rather than by
argument: the triangulation (55 of 8,997 polygons lose any triangle at all,
57 of 106,131); backface culling (the fill is `DoubleSide`, so an inward
triangle still draws); a dark unit in the palette (the darkest is a purple at
luminance 44); and the clip, whose own mesh is clean.

**The flat-colour test is only conclusive if the seal is flat too.** Painting
every unit magenta showed no holes — and could not have, because the seal was
magenta as well and covers exactly the gaps in question. What told the story
was the A/B: identical camera, flat versus real colours, dark only in the
second. A test that hides the thing it is testing for passes for the wrong
reason.

**What this does NOT settle.** The fill is `DoubleSide`, so the black
scratches are not backface culling; every tile carries its boundary seal; and
the clip's own mesh is clean. The seams are back with the revert, and
that is the honest state: the fix is a ribbon seal, not a backdrop.

### The clipped map went GREY because a new layer re-classes by frequency

"The clipped geology map fails to capture all the data verbatim as it is
defined within its source global layer... when we reduce the opacity we see
clearer polygons, polylines that pulse when clicked etc that never manifest
themselves on the surface." Every word of that is the same fault, and none of
it is the clip.

**The clip is faithful; its RENDERING was not.** A tool output is a NEW layer,
so it took the default `categoricalSymbology` — which ranks values by FEATURE
COUNT, keeps twelve, and folds everything else into one `"(other)"` at
`#8a8a8a`. The world geology underneath is painted by `paintFromSource` from
each unit's OWN published `properties.color`, all of them. So the clip of a map
was drawn in a different language from the map.

**A map is read by AREA and the cap counts POLYGONS**, which is what makes this
so much worse than "twelve is not many". Measured on the real z9 tiles over
Northern Ireland — 23 units over 4,146 km2:

| unit | polygons | km2 | fate |
| --- | --- | --- | --- |
| Hibernian Greensands / Ulster White Limestone | 45 | 58 | **kept, ranked first** |
| Unnamed Igneous Intrusion, Late Silurian–Early Devonian | 6 | **240** | grey |
| Kirkcolm Formation | 3 | 88 | grey |
| Lough Neagh Clays Group | 3 | 78 | grey |
| Stewartry Group | 1 | 76 | grey |

**11 units and 572 km2 — 13.8% of the map — folded into one grey**, while the
unit with the most polygons and a seventh of the area took rank one. The
ordering is not merely capped, it is close to inverted against what a reader
sees.

`paintFromSource` now STATES the column it paints from (`sourceColourField`,
with `sourceLabelField` beside it) and `register()` in tool-runner inherits it:
a derived layer whose features still carry that column is repainted from it and
given `legendFrom`'s legend, on the sidecar path as well as the native one, or
the same clip comes back coloured or grey depending only on how big it was. The
descriptor's own `paint` still wins — that describes a value the tool COMPUTED,
where this carries a value the input already had. Carried onto the output too,
so a clip of a clip is painted the same way again.

**Naming the column instead of re-deriving the paint** is the point: the
geology panel and the tool runner now read the same `properties.color` through
the same `legendFrom`, rather than a second implementation drifting from the
first. `legendFrom` took a `colourField` option to make that possible.

Verified live, A/B on IDENTICAL geometry — 891 features and 45,123 vertices
either way, one camera, the marker deleted to reproduce the fault:

| | control (pre-fix) | with the fix |
| --- | --- | --- |
| units in the clip | 60 | 60 |
| distinct colours drawn | 13 | **53** |
| grey vertices | **19,650 = 43.5%** | **0** |
| colours that are the survey's own | **0 of 13** | **53 of 53** |
| legend | none | "12 of 60 units" |

**Zero of thirteen** is the number that says what was really happening:
`categoricalSymbology` was not losing the source's colours at the margin, it
was replacing every one of them with its own qualitative ramp.

**Read the vertex colours, and convert linear to sRGB.** The check is on
`geometry.attributes.color`, never on the material (which is white under
`vertexColors`) and never on the legend — a correct legend over a wrongly
painted map is this file's longest-running trap, and here the legend was
ABSENT while the map looked plausible. `THREE.Color.set` converts on the way
in, so the attribute must be converted back out or every colour reads far more
saturated than it is drawn.

**And a weak A/B is worth noticing before believing it.** The first control ran
over a box holding exactly 13 units, so only ONE fell past the cap and the
grey measured 15 vertices — 0.2%, which reads as "the fault is negligible". The
same code over a study-area-sized box measured 43.5%. When an A/B says a known
fault is small, check whether the fixture is big enough to express it.

### The gaps are WEDGES inside one unit, and the clip is exact

Asked whether the contact polylines are at fault and whether they should be
dropped in favour of polygons. **They are not, and dropping them would change
nothing** — only `macrostrat-units` is loaded, and the line objects in it are
the per-unit SEAL, whose vertex colours are the units' own
(`0.20,0.57,0.17`, `0.44,0.43,0.16`, …), not dark. Contacts-and-faults is a
separate opt-in layer in the Tectonics tab.

Four measurements on the real z9 tiles over Northern Ireland, each ruling out
the layer above it:

- **Neighbouring units DO share their boundaries** — the opposite of what this
  file said for months. **68.4% of vertices lie at 0.00 m from a different
  unit's edge**, another 1.2% within 20 m, and then it jumps: p75 258 m,
  p90 977 m, which is the coastline and the edge of the mapped area, not a
  contact. There is no 5–50 m near-miss population.
- **So a vertex SNAP cannot help, and it was tried and reverted.** Rounding
  decoded tile coordinates onto a coarser lattice (2, 4 and 8 tile units) moved
  shared edges 39.04% → 39.19% → 39.58% and dropped five rings. A fifth of a
  percent is not a trade; the theory that the 9 m median was one quantisation
  step (extent 4096, ≈11 m of ground at z9) was arithmetic that happened to
  agree with a number it had nothing to do with.
- **Adjacent tiles OVERLAP rather than gap.** Tile 247 runs to −5.62225 and
  248 begins at −5.62775 against a seam at −5.62500 — about 176 m of encoder
  buffer each way, so there is no seam to close there either.
- **The decode and the triangulation are both airtight.** Rasterised at
  **3.6 m over 810,000 cells** of pure land: the rings cover every cell, and so
  do the triangles `fillTriangles` produces from them — 0 empty, 0 interior
  holes, no throws, no rejected holes.

**And the clip is exact, cell for cell.** Over a study-area-sized box the
coverage before and after `GP.clip` is **identical**: 84,730 empty of 490,000,
30 interior holes, 28 of them fully surrounded. The clip reproduces the
source's own emptiness and adds none of its own — so "the clipped polygons
show gaps" is the clip faithfully showing gaps that were already there.

**What the gaps actually are.** The 28 isolated holes are not stipple: they
all lie on ONE corridor, 3,775 m long, and measured perpendicular at 0.25 m
its width grows **linearly from 4.00 m to 12.25 m** along its length. The unit
on BOTH SIDES is the same one — "Unnamed Extrusive Rocks, Palaeogene".

A wedge opening at a constant rate between two pieces of the SAME unit is one
boundary drawn twice and generalised independently: two straight chords at
marginally different bearings, with the gap between them growing in proportion
to how far you are from where they last agreed. Nothing about it is a contact,
which is why removing contact lines would not touch it.

**That also says what the ribbon seal may honestly do.** Where the same unit
stands on both sides of a gap, filling it with that unit is not inventing
geology — it is naming ground between two pieces of Palaeogene extrusives as
Palaeogene extrusives. A ground-width ribbon of about 12 m closes this whole
corridor at every zoom, where the present 1-device-pixel line loses by
construction below ~12 m/px. The earlier attempt at *reshaping* polygons to
close gaps was reverted for misshaping them at 20 km; a seal drawn in the
polygon's own colour changes no polygon at all.

**The instrument, since it is reusable.** Rasterise the decoded rings and the
triangulated faces separately over the same window and count cells covered by
neither, then require an empty cell's whole 8-ring to be covered before calling
it a hole — a 4-neighbour test counts every notch in a shoreline. And run the
UNCLIPPED source through the identical grid as the control: without it, 17.3%
empty reads as the clip losing ground when it is Lough Neagh.

**And there is no finer geology to stream at that scale.** Measured over a
2 km view off the Antrim coast, features falling inside it: 3 at zoom 7, 1 at
9, 1 at 11, 2 at 12, 3 at 13, with vertices peaking at 74. A huge polygon
with a dead-straight contact at a 500 m scale bar is not a rendering fault —
it is Macrostrat's own generalisation seen at a scale it was never drawn for.
Streaming deeper cannot help, and interpolating a boundary the source does
not have would be inventing geology.

**Two probe mistakes worth not repeating.** `repaint(null)` does not restore
the default colours — it removes the colour function, and with it every fill
mesh, leaving only seals; measure a layer only after checking it still has
fills. And `update({ zoom: null })` hits the same `Math.round(null)` that
`featuresIn` was fixed for, fetching the single WORLD tile for a study area —
production computes a zoom so it never sees this, but a probe that passes
null measures the coarsest thing on the planet and calls it the view.

## The whole chain, run end to end through the UI

Draw a polygon, take the DEM inside it, take the geology inside it, extract
the data within. Run on Northern Ireland through the real controls — the Draw
bar with a real mouse drag, the tools window, the extraction panel — and every
number below is what the page reported.

| step | how | result |
| --- | --- | --- |
| geology on the globe | Geology tab tick | World geology (Macrostrat) |
| draw the polygon | Draw bar, Rectangle, real drag, Done | Study area 1, **610.158 km²** |
| DEM within | tools window → Terrain to raster | **121x111 at 215 m**, −39 to 265 m |
| geology within | tools window → Clip | **52 polygons, 17 units** |
| data within | Extract From Layers, 0.5 km | **2,496 samples, 34 columns** |
| native tables | automatic | dem at its own **213 m** cells, 13,431 |
| elevation per unit | Zonal statistics | 52 zones, painted by `zonal_mean` |

Checks that make the run mean something rather than merely complete:

- **The area is right by hand**: 0.4015° of longitude at 54.73° is 25.8 km,
  0.2129° of latitude is 23.7 km, so 612 km² against the 610.158 reported.
- **The clip fetched the right ground first**: the geology layer held 7,534
  features (the view it last rebuilt for) and 966 after being asked about the
  polygon — the `featuresIn` path, working through the dialog.
- **The geology is real and local**: Tyrone Group, Armagh Group, Sherwood
  Sandstone Group, Mercia Mudstone Group, Ulster White Limestone, Palaeogene
  extrusives, Argyll Group, Moine Supergroup.
- **The column agrees with the clip**: `geoid_geology` filled for 2,465 of
  2,496 samples (98.8%), 16 distinct units against the clip's 17 — one unit
  is too small to catch a 0.5 km sample, which is the honest difference.
- **The answer is geologically coherent.** Elevation by unit: Lough Neagh
  Clays −34.5 m (the lough itself, and the lowest thing in the box),
  Palaeogene extrusives 13.1 m at its margin, Sherwood Sandstone 48.7,
  Armagh Group 53.8, Tyrone Group 112.3, Roe Valley 128.1, Moine Supergroup
  131.8, Argyll Group 142.8, Ordovician extrusives 196.4 m — basin low,
  uplands high, in the order the map says.
- **The exporter writes four files**: the joined grid (2,496 x 34), the DEM's
  native table (13,431 x 3), and one per clipped vector layer.

**One honest caveat about the numbers, not the chain**: the elevations under
Lough Neagh are NEGATIVE (−39 m) where the lough surface is about 15 m above
sea level. That is the global DEM's own treatment of inland water, not
something the extraction did — the same class of limit as the 9,575 m native
sampling the terrain tool reports beside its 215 m grid. The chain reports
what the source says; the source is coarse and wet-blind here.

## The Export CSV button flashed in the rail before reaching the bar

Reported as the old redundant Export CSV button flickering beneath the draw
tool when selected, and it measured as exactly that: on arming, the button is
visible in its HOME in the right-hand rail at **(1340, 260) at 23 ms**, and
only reaches the draw bar at (860, 79) by **101 ms**. The viewer un-hides
that node the instant the Area tool is armed; the HUD borrowed it on its next
250 ms poll. Between the two it sat in the rail — directly beneath the very
button that had just been pressed, which is why it read as a second,
redundant control rather than as the same one moving.

**A MutationObserver on the node borrows it in the mutation's own microtask,
before the browser paints**, so there is no frame in which it is in the wrong
place. An observer rather than a click handler on the rail button, because
arming comes from rail clicks, key shortcuts and other modules alike — the
same reason this file polls at all rather than wiring into each of them.

The borrow-on-transition rule is untouched: the node is still MOVED and never
copied (a copy is a dead twin — the viewer holds a live reference), and still
goes home when the tool is put away. This only closes the window between the
reveal and the move. Measured after, three arm cycles on Earth and three on
Mars: **never visible in the rail**, on either.

**Two false trails worth recording**, because both cost a round: a synthetic
pointer drag showed no flicker at all, and neither did a REAL
`left_click_drag` — the fault is not in drawing, it is in ARMING, and a
watcher installed after the arm has already missed it. And a snapshot every
1.5 s reported one stable state four times running; the whole event lasts
78 ms. **When something is reported as flickering, sample faster than the
thing being reported and start the watch BEFORE the gesture.**

## The gas giants: what is absent by design, and the one thing that lied

Audited on Jupiter and Neptune. **What works there, measured:** every radius
is the correct IAU mean (Jupiter 69,911 — the Saturn mix-up stays fixed;
Saturn 58,232, Uranus 25,362, Neptune 24,622); the import pipeline is whole;
buffer, clip and IDW all run on imported data; and an imported polygon's area
is computed on that body's own radius (Neptune: 2,909,274 km² against a
predicted 2,909,865, ratio 1.000). `terrain` refuses honestly — "this world
exposes no elevation to sample" — and the draw HUD is correctly absent,
because a gas giant has no `setStudyAreaPolygon` and no surface to draw on.

**But the Draw button itself was still live, and lying.** Gating the HUD was
only half the job: on Jupiter the button was enabled, labelled "Activate draw
tool", and took the active state on click. Measured — armed, then three
clicks on the globe produced ZERO measure points, no line and an empty
readout. That is this tree's own rule pointed at itself: *wire it or leave it
disabled.*

**Only AREA is dead, and that distinction is the whole fix.** Distance and
Profile go through the ordinary measure path and work perfectly on Jupiter —
measured, two points each — so disabling the row wholesale would have taken
away two tools that do their job. `draw-hud.js` (shared, so one edit reaches
all four) disables the Area button and titles it with what still works.

**Ten seconds, not sixty.** The retry runs to 120 tries because a seam can
genuinely be late, but a button must not sit there enabled and lying for a
minute: measured on Mars, both the seam and the HUD are up before a probe
fired immediately after load could even look. Stood down at 20 tries, watched
to 120, and a seam that does turn up late takes the button back.

**The draw bar on the rocky worlds is Earth's, byte for byte.** Reported as
not matching, and it does: Mars and Earth both render eleven buttons in the
same order with the same shapes, titles and widths (31/31/31/31/31/31/31/67/
52/30/31) in a 471x65 bar — Line, Circle, Triangle, Square, Rectangle,
Pentagon, Hexagon, Custom, Done, Export CSV and close. It is one shared
module and there is nothing per-body left in it. Where the bar is missing,
the body is a gas giant and the reason is the surface, not the code.

## The same audit on the planets: two faults, both per-body

Running the Earth audit on Mars first. **What already worked, measured rather
than assumed:** the seam is complete (34 keys, none of
`surfacePoint`/`getEffectiveRelief`/`elevationNormalized`/`sampleElevationMeters`/
`getGeologyFeatureAtLatLon`/`setStudyAreaPolygon`/`pickOnGlobe` missing);
geology answers real unit codes (Ave, eHv, HNhu, Nhu); `terrain` reads
Olympus Mons at 19,837 m and reports **Mars's own** source sampling as
5,325 m; slope, zonal statistics and the drawn-shape band all behave as on
Earth, because they are shared modules.

**Every area on a planet was measured on EARTH's radius.** A 4x3 degree study
box near Olympus Mons recorded 140,689 km² against a true 39,826 — exactly
the 3.533 that (R⊕/R♂)² predicts; on the Moon it would be 13.4x, on Mercury
6.8x. `sphericalPolygonAreaKm2` defaults to the Earth mean radius and FOUR
callers took the default: drawn-layers' `area_km2`, the geology card's mapped
area, and both of feature-popup's. The number rides on the layer, so it
reached the annotation, the exports and the project registry alike.

Fixing callers one at a time is what left three wrong after the first was
found, so **the DEFAULT is what changed**: it reads `bodyRadiusKm` off the
viewer seam and falls back to Earth only where there is no viewer to ask,
which is Node and the tests. `area-labels.js` had already taken its
km-per-degree from `bodyRadiusKm` for the live label — that was the SECOND
area computation and only it had been made per-body. Same shape as the
polygon-area formula in ten files: **when a body constant is fixed in one
place, grep for the others.** Verified on Mercury: 21,318 km² against a true
21,321 on a 2,439.7 km radius, ratio 1.000.

**And the measure furniture Earth changed never reached the planets**, because
it lives OUTSIDE `port-draw-tools`' block: the study-area corner card still
popped up and polygon points still wore A, B, C. Measured on Mars —
`#measurement-result-card` visible reading "Study Area: 39821 km² / Perimeter
803.6 km / …" where the same shape on Earth leaves it hidden and unpopulated.

The porter carries four rewrites now, applied verbatim per viewer and
idempotent (a rewrite already present is skipped, so a re-run is a no-op and
`--check` tells stale from ported):

1. no corner card for an AREA — `hideMeasurementResultCard()`, not show;
2. point letters are PROFILE furniture only;
3. **a letterless point still scales its DOT** — the planets' guard was
   `!visual.marker || !visual.labelSprite`, which bails on the WHOLE visual,
   so without this every marker rewrite 2 creates would freeze at its build
   size. That is precisely the trap Earth's own note records;
4. the sprite work is guarded on its own, after the marker work.

Each viewer keeps its own scaler body — the planets carry clamping and
flight-sim attenuation Earth does not have — because the point is to port the
DECISION, not to overwrite the arithmetic around it. Verified on Mars and
Mercury: card hidden, 41 marker dots and **0 letter sprites** in the measure
group, and the dots still resize with the camera (2.728 → 2.586).

**A change made on Earth is only shared if it is inside the ported block.**
When an Earth fix touches `earth-viewer.js`, check whether it falls between
the porter's anchors; if it does not, it needs a REWRITES entry or nine
worlds keep the old behaviour indefinitely.

## An extraction asks about GROUND, never about the screen

Reported as drawing a square polygon and getting no geology data at all out
of the geology source map. It reproduced first try, with everything as
shipped: *"Within the drawn area — 7,567 samples over 7,511 km² · 1 vector
layer: 0 of 0 features within"* — with the geological map plainly drawn on
the globe, and the panel's OWN tick list beside it reading "9,137 features".
Both numbers were true and the answer was still nothing.

**Four faults, and each one hid the next.**

- **The geology COLUMN was off by default.** It shipped unchecked, labelled
  "GeoID geology class (slower)", so the main table — the file anyone
  actually opens — had no geology column at all whatever was on the globe.
- **`features()` answers "what is on screen".** That is right for a click
  card and catastrophic for an extraction: `collection` is a SNAPSHOT of
  whatever the camera was showing when the layer last rebuilt itself, and the
  tiled geology rewrites itself on every settle. The tick list counted the
  screen; the clip read the same screen a moment later, after a rebuild had
  emptied `visible`. `featuresIn(bounds)` asks the tiler about GROUND
  instead — it chooses the zoom the box deserves, fetches what is missing
  (cached, so a second extraction over the same area is free) and returns
  those features **without touching `visible`, `generation` or the scene**,
  so extracting never changes the picture. A layer that can do this says so
  by carrying `featuresIn`, and the panel asks every such layer about the
  study area before anything is clipped.
- **`Math.round(null)` is ZERO.** Passing "no particular zoom" to
  `chooseZoom` asked for the single world tile — 5,792 units for the whole
  planet, generalised so hard this file already records point-in-polygon
  finding nothing under Northern Ireland. Measured: 3 features clipped, all
  of them things like "Precambrian-Phanerozoic crystalline metamorphic
  rocks". The same shape as NaN-compares-false: a missing value that means
  the worst possible answer instead of erroring. `zoomForBounds` lives in
  mvt.js with the rest of the tiling arithmetic and is pinned there.
- **The geology column asked the VIEWER**, whose `getGeologyFeatureAtLatLon`
  answers from the map it currently has DRAWN. With the camera over Indonesia
  and the study area over Northern Ireland it returned nothing for all 7,567
  samples while the clip beside it returned real units. It reads the features
  covering the polygon now — the same ones the clip uses — so the column and
  the clipped layer are ONE SOURCE OF TRUTH and cannot disagree.

Verified under the hardest case available: geology loaded over Northern
Ireland, camera then flown to Indonesia (7,807 features on screen, all of
them the wrong ground), study area drawn over Northern Ireland, extraction
run with nothing touched. **966 features fetched for the box, 358 clipped
within the polygon, and the geology column filled for 7,477 of 7,567
samples — 98.8% — with Tyrone Group, Armagh Group, Leitrim Group, Gala
Group.** The 1.2% empty are samples over sea, which is the honest answer.

**The general rule this leaves:** a self-rebuilding layer's `collection` is a
snapshot with a timestamp nobody can see. Any consumer that asks a question
about a PLACE — extraction, clipping, sampling, zonal statistics — must ask
the layer about that place, not read whatever the layer last happened to
hold.

**The TOOLS had the same fault one layer down, and the fix cannot live in an
engine.** `runTool` calls `engines.native(...)` WITHOUT awaiting, so an
engine is synchronous and can fetch nothing. The refresh goes at the top of
`runToolAuto` — before the sidecar decision, before any engine, and on the
path the tools window already takes. Every input carrying `featuresIn` is
asked about the ground THIS RUN is about, and that ground is the extent of
the OTHER inputs: clipping geology by a drawn box is about the box, zonal
statistics of a raster over geological zones is about the raster. A
self-rebuilding layer's own bounds are the world and say nothing, so they are
excluded from that calculation; where every input rebuilds itself there is no
extent and nothing is fetched, which leaves the tool where it was rather than
guessing.

That extent falls back to the coordinates a layer actually HOLDS where it
carries no `bounds` — a derived or hand-built vector layer need not have
them, and failing through on that silently skips the fetch and leaves the
tool on the stale snapshot, which is the exact fault being closed. Found
because a fixture had no bounds and `clip` alone failed while
`zonalStatistics` passed.

And the SYNCHRONOUS path now refuses a self-rebuilding layer holding nothing
rather than running: an empty snapshot means "the camera is elsewhere", not
"this ground has no geology", and of the three available outcomes the
confident empty one is the worst.

Verified live with the camera over Indonesia and the study area over Northern
Ireland: the geology layer held **2** features at the moment the tool was
pressed, the tool fetched **966** for the box, clip kept **358** (Southern
Highland Group, Tyrone Group, Argyll Group, Leitrim Group, Roe Valley Group,
Gala Group) and zonal statistics of a DEM over those units returned **358
zones** — Southern Highland Group 192 cells at a mean of 103.7 m, Tyrone
Group 94 cells at 37.4 m. That is the whole workflow: map, draw, clip,
summarise per unit.

## A GROUP sorts before its children do — the measure group at zero

The polygon being DRAWN was hidden behind the geology: its handles showed,
its outline did not, and it could not be dragged or resized. The handles are
DOM elements and the outline is WebGL, which is exactly why one survived and
the other did not — and it is the tell that this is a scene-graph fault, not
a pointer one.

The live measure geometry carries renderOrder 96-203 of its own, well above
the imported band. **None of it mattered.** `reversePainterSortStable`
compares groupOrder FIRST, `projectObject` takes groupOrder from the nearest
`isGroup` ancestor, and `measureGroup` was constructed with no renderOrder at
all — so it sorted at ZERO while every imported layer group carries its band
(51 and up, and 51.5 for the sharp tiles). The shape being drawn went
underneath the map it was being drawn on.

This is the event-markers fault in a new place, and the constructor itself
shows the pattern: `geologyBoundaryGroup`, three lines below, sets an
explicit 111 for precisely this reason. `measureGroup` and `moonMeasureGroup`
take **199** — the viewer's own furniture band, where the pins, labels and
selection rings live, which is what a study area being drawn is.

Applied to all six worlds that can draw and carried by `port-draw-tools`, with
the porter's replacement text lifted from Earth's own copy so the two cannot
disagree. **NOT the depth buffer**: nothing in either the geology or the
overlay writes depth and both draw with depth testing off. It was sorting, not
occlusion — and reaching for `depthTest` here would have changed nothing while
looking like a fix.

**When something with a high renderOrder is buried, read its ancestors before
its material.** A Group has no material, its order is decided before any
child's renderOrder is read, and its default is zero.

## A drawn shape draws over every dataset mapped

A study area is not a dataset, it is the QUESTION being asked of the
datasets — the boundary every extraction, clip and zonal statistic is scoped
to. It sat in band 2 with every ordinary import, so it was above whatever had
been loaded before it and under everything loaded after. Measured live: a
captured study area at renderOrder 54 and a DEM mapped a moment later at 55 —
and because a drape does not depth-test it paints straight OVER the outline
rather than fighting it for pixels. Drawing a boundary and then mapping the
data inside it is the ordinary order of work, so the ordinary order of work
was hiding the boundary every time.

Drawn shapes take a fifth band, above the live feeds, and it is a DEFAULT
like the other four — `bandOverride` still wins, so a row dragged below
something lands where it was dropped. Verified with a GEE drape, three
derived rasters and a late vector import all mapped afterwards: the drawn
shape stays top at 56 against a highest dataset of 55.

**renderOrder alone would not have proved it.** A drape is
`depthTest: false, depthWrite: true`; the outline is `depthTest: true`. So
the outline is only visible if it draws LAST *and* sits above the depth the
drape wrote. Measured at both: the outline's lowest vertex is **11,945 m**
above the ground where the drape's highest is **0.2 m**, and it draws at 56
against 51. Two conditions, both checked, because either alone is satisfiable
while the thing stays invisible.

**And the number that really decides is groupOrder, not renderOrder.**
`reversePainterSortStable` compares groupOrder first, taken from the nearest
`isGroup` ancestor. Measured: a vector layer's `object3D` IS a Group, so it
carries its band as its groupOrder (drawn 56, a late import 55) — while a
raster drape is a bare Mesh under the shared `GeoID-ImportedGeoLayers`
container, whose renderOrder is 0, so **every drape sorts at groupOrder 0**
and is ordered among its peers by renderOrder alone. The drawn guarantee
holds either way (56 beats 0 and beats 55), but it means vector layers
currently outrank raster drapes regardless of the hand order in the layer
box. Left as found and recorded rather than fixed in passing: making it
consistent changes how dragging behaves between the two kinds, which is a
decision about the layer box and not about drawn shapes.

The live, uncaptured overlay needed nothing: measured at renderOrder **80–96**
in the viewer's own measure band, well clear of the imported band's 56.

`bandOf` moved into `draw-order.js` — its own module, because it is a
classification and nothing else: no DOM, no scene, no state. Trying to test
it in place hung the runner on layer-hierarchy's page wiring, which is the
argument for the split rather than against it.

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

## Which maps the tools can actually see — audited by asking the seams

"Are all pre-loaded maps and those imported via GEE available for the GIS
tools, extraction and the Model Builder?" Measured with a user import, a
Natural Earth catalogue vector, a CHIRPS rainfall drape and a GEBCO overlay
all on the globe at once — asking `layersByType`, the extraction panel's own
filter and the Model Builder's list what each one returns:

| layer | `collection` | `raster` | `sampler` | tools | extraction | model |
| --- | --- | --- | --- | --- | --- | --- |
| user vector import | yes | no | yes | vector | yes | yes |
| catalogue vector (coastlines) | yes | no | no | vector | clip | yes |
| user GeoTIFF / `.asc` | no | **yes** | — | **all 30 raster** | yes | yes |
| Earth Engine drape (CHIRPS) | no | **no** | yes | **NONE** | yes | yes |
| shipped overlay (GEBCO relief) | no | no | no | **NONE** | **NONE** | listed only |

**`layersByType("raster")` returned an EMPTY LIST** with a rainfall map and a
bathymetry overlay drawn on the globe. An Earth Engine layer carries a
`sampler` — `gee-sample` recovers real numbers from the palette it was
painted with, which is why extraction has always read it — but it carries no
GRID, and the thirty raster tools admit a layer only if `layer.raster`
exists. Slope on a GEE elevation map, reclassify on rainfall, zonal
statistics over NDVI: none of them could see the layer they exist for.

**`sampleLayer` is the bridge, and it is `terrain` over a different reader.**
The area says where, the layer says what, and the answer is an ordinary
raster that chains into everything. `sampled` is a third input KIND that both
`matchesType` and `layersByType` understand, so the dialog fills that select
for free (it populates straight from `layersByType(input.type)`) and a drape
can never pass as a grid. Verified live on a real CHIRPS layer over the Congo
basin: raster layers 0 → a 121x121 grid at 14.8 km cells, 14,549 of 14,641
cells carrying a value, 8.2–300 mm — CHIRPS's own range — and reclassify,
zonal statistics and slope all running off it.

**A colour-only drape is refused BY NAME.** `makeSampler` returns a number
where the palette is invertible, `null` off-ramp, and an `{r,g,b}` where
there is no legend at all; rasterising that third case would be inventing
numbers. The shipped GEBCO and hillshade overlays are in exactly that
position — pictures with no legend — so they stay pictures, and that is a
statement about those files rather than a gap in the tools.

The general shape, worth keeping: **a layer's capabilities here are three
independent booleans** — `collection`, `raster`, `sampler` — and every panel
filters on one of them. When something "is not available", ask which of the
three it is missing before looking at the panel.

## Every tool, individually, IN THE SUITE — and what that found

The browser sweeps each found faults the one before had passed, and a sweep
somebody re-drives by hand stops being run. `tool-runner.test.mjs` is that
sweep in the suite: all 48 tools through the REAL runner, asserting on
VALUES against fixtures with closed-form answers (a plane has zero
curvature; the mean of a symmetric window on a ramp is the centre;
interpolating a constant field returns that constant; a perfectly separating
raster scores AUC 1 and the same raster upside down scores 0; clip and
difference must TILE the subject).

**The runner needs only a `window`.** `resolveLayer` takes a layer RECORD as
readily as an id, and `addDerivedLayer` is the one seam `register` writes
through — stubbed in the shape import-manager really returns, so an output
chains into the next tool exactly as it does on the page. A canvas stub
covers `buildRasterLayer`'s preview; nothing reads the picture, because the
`raster` the engine produced rides on the layer record beside it.

**Two STRUCTURAL checks, in both directions, and they are the last two bugs
generalised.** Every `p.<name>` an engine reads must be a declared param
(watershed read `p.lat`/`p.lon` while declaring none); every declared param
must be read by its own tool (viewshed collected `height` and read
`p.observerHeight`). The scanner strips COMMENTS first — viewshed's own note
about the bug contains the string `p.observerHeight`, and prose is not a
read. Five faults on the first run, none of them visible to any browser
sweep:

- **`difference` returned the subject WHOLE**, silently, whenever the mask
  shared the subject's y-range — the commonest overlap there is, and the one
  this file already documents and defends against inside `unionRings`,
  `intersectRings` and `subtractRings`. **The defence was never reached.**
  `ringEdgesIntersect`, the gate deciding whether the audited subtraction
  runs at all, counted only a strictly-interior, non-parallel crossing — and
  two rectangles sharing a y-range meet ONLY at vertices, so `punchHoles`
  concluded "disjoint" and handed back the untouched subject. Measured: A
  minus B returned 123.643 km² of a 123.643 km² subject while clip on the
  SAME pair correctly returned 24.729. The gate had been written on the same
  primitive the defence exists to work around. It falls back to sampling
  now — a boundary with points strictly inside the other ring and points
  strictly outside CROSSES it, whatever its edges do at the vertices — which
  also keeps the hole and disjoint branches right by construction (a
  contained ring has no outside point, a disjoint one no inside point).
  Sampled at three points per edge, never at the vertices, where a
  point-in-ring test on a shared boundary is a coin toss; and only after a
  bounds check, so a map of thousands of polygons pays nothing. Verified
  live: clip 17.178 + difference 68.712 = 85.890 = the subject, exactly.
- **A boundary-touching mask used to land on the right ANSWER by accident.**
  `geoprocessing.test.mjs`'s "difference removes both masks" got exactly 4
  because the masks read as disjoint and a first-vertex coin toss filed each
  as a HOLE — a hole touching the outer boundary, a degenerate polygon with
  the right area. It goes through the audited subtraction now and comes out
  as one comb-shaped ring whose notches are joined by 1e-9-tall slivers,
  which is what the nudge strategy has always produced. So the area check
  carries the nudge's own tolerance, and what the test asserts is WHERE THE
  GROUND WENT — masked ground gone, unmasked ground kept.
- **Kriging's two controls were BOTH dead.** The engine read
  `p.cellSizeDeg`, which no param declares, so the grid was always 0.01°
  whatever "Cells across" said; and the model select never reached
  `krigeGrid`, which called `sphericalModel` unconditionally and then
  REPORTED "spherical variogram" however Exponential was set. The sidecar
  honoured both, so one form gave two different answers depending on which
  engine ran. `exponentialModel` exists now and the family is FITTED as well
  as applied — a range fitted under one family and used under another is a
  third model nobody chose — and `krigeGrid`'s message, which carries the
  fitted nugget/sill/range and is the only way to judge whether the surface
  is worth believing, reaches the user instead of being computed and
  dropped.
- **Kriging was then UNFINISHABLE, which is what honouring its own default
  exposed.** The kriging matrix depends only on the samples and the
  variogram, never on the cell being estimated, and it was rebuilt and fully
  eliminated for EVERY CELL — 65,536 of them at the default 256 across. LU
  once, substitution per cell: same arithmetic, same answer, O(n³) once plus
  O(n²) a cell. A performance fault that reads as a hang is still a fault.
- **A zero-variance field came back as an EMPTY raster reported as
  success** — every semivariance zero, the system singular, every weight
  null. The kriging estimate of a constant field is that constant, so it is
  answered directly; and a grid where nothing was estimated is a refusal
  now, not a blank map that looks like an answer. Same family as watershed.
- **`rasterize` required an attribute**, so a fault trace or a road network —
  a line layer with no numeric column at all — could not be rasterized.
  Blank means PRESENCE. Verified live: 104 cells from a line, no column.

**A raster layer starts a 250 ms relief poll, and that is why any headless
run hung.** `registerDrape`'s watcher is right on a page and kept the test
process alive forever with all its work done and printed — 200 s against
0.44 s. `watcher?.unref?.()` is a no-op in a browser (a browser timer is a
number) and the whole point outside one: a poll that redraws drapes must
never be the reason a process cannot exit. **When a headless run of page
code "hangs" after printing its results, look for a poll, not a deadlock.**

## The full-development sweep: check OUTPUTS, not ok flags

Every tool run through the real runner with pure DEFAULTS (auto-resolved
inputs, untouched params) and its OUTPUT inspected — band stats for rasters,
feature counts for vectors, row shapes for tables — then all 48 dialogs
opened and their input/field selects checked for real options. Final state:
**48/48 run with defaults and produce non-empty outputs; 48/48 forms open
with every select populated.** Six real faults on the way, each invisible to
an ok-flag sweep:

- **`watershed` had shipped EMPTY since day one.** Its engine read `p.lat`
  and `p.lon` while the tool declared NO params, so every run walked in with
  `(NaN, NaN)`: NaN compares false against every bound, the range check
  passed vacuously, `out[NaN] = 1` seeded nothing, and an empty basin
  returned as `ok: true`. Outlet params exist now; the untouched default
  means "the main river's exit" (fill once, flow accumulation, argmax cell,
  stated in the message with the catchment area), and `hydrology.watershed`
  refuses a non-finite outlet outright (pinned). Every earlier sweep counted
  this tool as passing.
- **`viewshed` ignored the observer height it collected** — the engine read
  `p.observerHeight`/`p.radiusKm` against params named `height` and nothing:
  a form field an engine never reads is the quietest dead control. And the
  observer defaulted to (0, 0), the Gulf of Guinea, so the untouched form
  always answered "outside the DEM". The default now means the DEM centre
  and says so; a typed point off the DEM keeps the honest error.
- **`reclassify`'s default rules were the NI slope classes** — a worked
  example that silently assumed the input was slope in degrees; on the
  obvious first raster (a DEM in metres) not one cell matched. Blank rules
  now mean "cut into N quantile classes" (zero typing on ANY raster;
  quantile because most rasters here are skewed — the FRP lesson), and a
  rules miss names the raster's actual range. Two follow-up faults in the
  fix itself, both caught live and neither by the unit suite: the quantile
  rules were `{min,max,value}` objects where `RA.reclassify` destructures
  `[min, max, class]` ARRAYS, and the success note still read the variable
  the edit had renamed.
- **`rasterize` was polygon-only**, so an OCCURRENCE layer of points — the
  commonest rasterize in a susceptibility workflow — produced an empty grid
  behind an error about polygon overlap. Points stamp their containing cell,
  lines are walked at half-cell steps (pinned: a diagonal stamps every
  column it crosses).
- **`rocAuc` refused presence-only observations** ("ROC needs both
  outcomes") — exactly what a landslide inventory is. Seeded random
  background cells now stand in as pseudo-absences (the South Wales
  validation's own method), and the message says the negatives are
  background, not observed. Measured on deliberately uncorrelated fixtures:
  AUC 0.47, which is the CORRECT answer.
- **`zonalStatistics` answers as the ZONES now, not a discarded table** —
  the polygons with `zonal_cells/min/max/mean/sum/std` written back as
  attributes, painted by `zonal_mean` on arrival through the same `paint`
  seam the multi-ring buffer uses. The join back to features is by IDENTITY
  of the properties object the engine already carries — results skip
  zone-less features, so index pairing would hand zone 3's numbers to
  zone 2. Verified: two symmetric zones, 2,014 cells each, west mean 2,812 m
  against east 2,044 m over ground that really does fall eastward.

**Harness traps, paid for again in one session:** importing `tool-dialog.js`
under a fresh `?v=` makes a SECOND instance whose backdrop poisons the
page's own (every later open "fails"); read the stamp off a live script tag
and import THAT. And close a dialog through its own button — forcing
`hidden = true` desyncs the module's internal state so nothing reopens.

## "Not easily used" measured out as: 30 tools waiting on a raster nobody had

Asking what each tool DEMANDS was more revealing than asking what it produces.
**30 of the 47 need a raster** — 17 raster-only, 8 raster+vector, 5
raster+raster — and `layersByType("raster")` admits a layer only if it carries
`layer.raster`, which arrived by exactly ONE route: the user importing a
GeoTIFF or `.asc` themselves.

So on a fresh page, and on every planet, Slope / Hillshade / Contours /
Watershed — the obvious first things anyone opens — could not run at all. The
palette was two thirds inert, and that is what "too many of these are not
easily used" is: not obscure parameters, a missing input.

Meanwhile every world already HAS elevation. It displaces the globe, the
cursor readout quotes it, the extraction panel samples it, and (since the seam
work) `surfacePoint`/`elevationNormalized` publish it. It was simply never
offered as a LAYER.

**`terrain` — "Terrain to raster (DEM)"** takes any polygon layer and samples
this world's elevation into a DEM, so the first tool a reader opens produces
the input the other thirty were waiting for. It reuses the Model Builder's
`buildSurface` rather than rewriting it — the body-radius conversion, the node
cap that holds, and the fill-and-count for nodes the DEM cannot answer all
come with it. Two details that are bugs if reversed:

- **The band is FLIPPED on the way out.** `buildSurface` indexes
  south-to-north; a raster row runs top-down. Unflipped, every terrain map
  derived from it is upside down while looking perfectly plausible.
- **The engine must be SYNCHRONOUS.** `runTool` calls
  `desc.engines.native(...)` **without awaiting it**, so an `async` engine
  hands `register()` a Promise and the raster comes out `undefined` — measured
  as "Cannot read properties of undefined (reading 'length')". `model-build.js`
  is pure and DOM-free, so it is imported STATICALLY: the module stays
  Node-clean and the engine stays sync.

Verified end to end in the browser from a drawn box: a 40 km study area over
the Valais Alps produced a 121x121 DEM spanning **1,088-3,612 m** (right for
that ground), and Slope, Hillshade and Contours (27 features at 200 m) then
ran off it — the raster layer count going 0 to 1 and the rest following.

## Which of the 47 tools belong on a MAP page: the output type decides

Audited by reading what each descriptor takes and produces, then following the
result to where it lands. **42 of 47 produce a map layer** (18 vector, 24
raster) and are unarguably GIS work. **Five produce `outputType: "table"`** —
`zonalStatistics`, `histogram`, `rocAuc`, `successRate`, `confusion` — and the
runner says what that means in its own comment: *"outputType table returns
rows, registers no layer"*, returning `layer: null`.

**Those rows are then discarded.** tool-dialog's result handler reads
`result.message` and `result.layer` and nothing else; grepping every consumer
of `.rows` in the tree finds the extraction panel's own rows and tool-search's
UI list, and no reader of a tool result's rows anywhere. So on the GIS page
those five compute a real answer, print a one-line status, and throw the
answer away: no layer, no table, no export, no project file. That is the
concrete test for "does it belong here" — **a GIS tool's output is a map
layer, and a page that cannot hold the answer is not that tool's home.**

The five split three ways, and they are not the same case:

- **`rocAuc`, `successRate`, `confusion` — Research.** These score a MODEL
  against observations; they say nothing about the map. Research already has
  the home: `stats.js` (correlation, t-test, Mann-Whitney, KS, ANOVA, PCA)
  and the plotting the Analysis page uses, where a curve and a table can
  actually be drawn. A success-rate curve is a chart, and there is no chart
  on the globe.
- **`zonalStatistics` — belongs in GIS, and is the one to FIX rather than
  move.** "Raster values inside each polygon" is canonical GIS (ArcGIS's own
  Zonal Statistics), and its answer is keyed BY POLYGON — which means the
  right output is the polygon layer with the statistics written back as
  ATTRIBUTES, i.e. a vector output that draws, symbolises and exports like
  any other. As a bare table it is the right tool wearing the wrong return
  type.
- **`histogram` — re-home rather than move.** A raster's distribution is what
  you consult to CHOOSE CLASS BREAKS, so its natural place is the symbology
  dialog beside the classing it informs, not a geoprocessing tool whose table
  evaporates.

Two entries look like they belong elsewhere and do not: `randomSample` and
`stratifiedSample` sit in the Validation category but output VECTOR points.
They are model preparation by intent, and they produce a layer, so the map
page can hold them honestly — category is not the test, output is.

## Buffers have SHAPES, and the multi-ring is graded on arrival

`GP.buffer(fc, m, { shape })` — "round" | "square" | "flat" — and
`GP.multiRingBuffer(fc, [m...], { shape, rings })`, surfaced as the Buffer
tool's Shape select and the new Multi-ring buffer tool. What each word
honestly means per geometry, stated rather than discovered: points get
circles or axis-aligned squares (`squareAround`); lines get flat caps, SQUARE
caps (the corridor extended one distance past each end — ArcGIS's SQUARE end
type, done by extending the endpoints before offsetting), or ROUND caps built
by UNIONING end circles onto the flat corridor — stitching semicircle arcs
into the ring by hand is exactly the seam arithmetic the boolean ops exist to
avoid. A polygon outline is offset along its own boundary whichever shape is
asked for; "square" does not mean a bounding box and the param blurb says so.

**Multi-ring bands are TRUE RINGS by default** (each disk minus the previous)
because solid nested disks STACK: three translucent fills over one centre
render the drawing order, not the distance. Each band carries `buffer_m` and
`buffer_min_m`; bands over colliding sources merge through the checked union.
Distances are cleaned, not trusted — sorted, deduplicated, non-positives
dropped.

**A tool may declare how its output is READ**: `paint: { field, ramp }` on
the descriptor, and `register()` grades the new layer through the symbology
dialog's own `paintByRange` (equal interval, one class per band, capped 12).
Dynamically imported so tool-runner stays Node-clean, and best-effort so a
failed paint never fails the run that produced the layer. This is the seam
any future tool with a self-describing output should use rather than
repainting from its panel.

Every constant checked against a closed form (square point 402 vs 400 km²,
square caps +402 vs +400, round caps +314 = one circle, annuli to a fraction
of a percent) — 14 checks in geoprocessing.test.mjs, which must sit ABOVE
that file's summary line: it calls process.exit, so anything appended after
it silently never runs.

**Distance bands are CATEGORIES that happen to be numbers.** The multi-ring
paint first graded `buffer_km` with equal-interval classes — one class per
band only when the distances are evenly spaced. Typed into the dialog as
"5, 15, 40", the breaks fell at 16.67 and 28.33: the 5 and 15 km bands shared
a colour under a legend claiming three classes, and one class contained no
band at all. `paint.discrete` colours one class per DISTINCT VALUE (ranked
along the ramp so near-to-far still reads as a sequence), labels each with
its own span off `buffer_min_km` ("5–15 km"), and re-sorts the legend by
distance — categorical legends order by frequency, and for rings frequency
is meaningless. Found only by driving the DIALOG with a custom list; the
seam test used even spacing and could never have shown it.

**Units are km at the tool boundary, SI underneath.** Buffer's Distance and
Multi-ring's list are kilometres, converted in the engine call; features
carry `buffer_km`/`buffer_min_km` beside `buffer_m` because the legend is
read by a person ("10–20" is a distance, "10000–20000" is an axis label).
When a param's unit changes, grep the BLURB too — the tool's still said
"metres" after the field said km, and a field disagreeing with its blurb is
how a unit bug gets typed in.

**Two realm traps in one verify loop, both already documented elsewhere and
both walked into again.** `import()` in the harness's top realm gets a module
whose `window` has no GeoIDImportManager — "Input is required" from a layer
that plainly existed; import in the IFRAME realm (`fw.eval("import(...)")`).
And after a reload the spin is BACK ON: a hand-placed camera then reads as
the zoom "throwing the view away" when it is the planet turning under a
paused probe that never re-paused it. The layer drawer's own
`frameLayer` is the reliable way to a layer; hand-building camera positions
against the zoom easing is not.

## Submarine cables, and why NOT from submarinecablemap.com

**The source is Greg's Cable Map**, served as an ArcGIS FeatureServer that
answers `f=geojson` with CORS `*` — **285 cables and 737 landing stations**,
each complete in one request, under the **GNU GPL** (commercial use permitted
with attribution; the item's own `licenseInfo` says so). An OpenStreetMap
version came first and was replaced: ODbL and honest, but 199 systems and no
landing points at all. The two layers are the PATH and the DOT, the pair the
satellite tracker draws.

TeleGeography is still out, for two independent reasons either of which is
fatal: `submarinecablemap.com` answers 200 to curl and sends **no
`Access-Control-Allow-Origin` header**, so a browser cannot read it whatever
the licence says — and they sell an annual licence for the geocoded data, the
map itself being CC BY-NC-SA. Their ~600 systems remains the fuller map,
behind that licence. Greg's own currency is the honest limit here: `InService`
years run to the late 2010s.

### The interactions that make a vector layer feel alive

All of this is in `feature-popup.js`, on the SHARED vector path, so every
layer gets it — coastlines, faults, cables, landings — rather than the
satellites having it alone:

- **`buildHighlight` draws any geometry**, not just polygon rings. It drew
  rings and nothing else, so a click on a line or a point highlighted nothing:
  the card opened and the map of three hundred lines gave no sign which.
- **Selection PULSES**, one shared phase across the overlay's nodes (per-node
  phases read as shimmer), 1.6 s, ending itself when the selection clears.
- **Hover brightens** what is under the cursor in cyan against the selection's
  gold — two states must look like two states — throttled to 90 ms because
  `featuresAt` walks every feature of every vector layer, and keyed by feature
  IDENTITY rather than by a name (an unnamed feature has no name to key on).
- **The highlight does not care which card wins.** A labelled layer's click is
  claimed by the viewer's own label path, and standing down took the highlight
  with it. Marking what was picked belongs to the pick.
- **A label is not where its feature is.** The chip is drawn beside the thing
  it names, so `surfaceLatLonAt` at the clicked pixel answers with the ground
  under the LABEL — open ocean, some way off the cable. The label's own item
  carries the anchor it was placed from, and that is on the feature by
  construction. Verified: clicking AKORN Alaska-Oregon's pill opens the card
  and pulses the line together.

### A marker is a NODE, and it may not be depth-tested

The triangle is gone; markers are a disc in the symbology colour inside a
heavy white ring. The triangle existed because a plain circle vanished into
round terrain features on imagery — sound about a *plain* circle, and what it
lacked was a hard edge. `MARKER_OUTLINE_EXTRA` went 3.4 → 5.2, because a
triangle carries its own silhouette and a circle has none.

Making them bigger exposed the event markers' lesson again: **every fragment
of a point sprite carries the CENTRE's depth**, so a depth-tested marker is
sliced wherever terrain in front of it is nearer the camera than its own
centre — most of the ground around it, on a sphere seen obliquely. A small dot
got away with it; a ringed node takes visible bites out of the curve. Lifting
it would trade the cut for parallax, so `depthTest: false` and the far
hemisphere is culled by FACING (`followRelief(..., { cullFarSide: true })`),
which on a sphere is exact — every vertex's outward normal is its own
direction, already carried as `aDir`.

### The label detail slider is per-DATASET, and so are its words

The slider was bespoke markup in the Volcanoes subsection, the only place it
could be while volcanoes were the only labelled catalogue. It is a control on
any catalogue ROW whose layer `canLabel` now, so the cables get one and so
does every future labelled dataset.

**Generalising the control without generalising its words put "Erupted since
1500" on the submarine cables.** `DETAIL_COPY` is the VOLCANOES' wording, read
off `label_rank`'s bands in bake-volcanoes.py; `label_rank` means eruption
recency there and cable length here. So an entry may carry its own
`detailCopy` (the cables', matching `submarineCablesToGeoJSON`'s thresholds
exactly), with `GENERIC_DETAIL_COPY` as a fallback that claims nothing about
what the rank measures. **Both catalogue projections had to carry it** —
`polygons.js` and `catalogue-panels.js` each reshape entries into a reduced
object, and a field dropped there falls back silently.

### Where a LINE's name goes

`featureToItem` read `coordinates[1]` as a latitude, which for a LineString is
a POSITION ARRAY — every label at NaN, silently. `labelAnchor` takes the
middle vertex of the longest part: the MIDDLE because a name at a line's end
reads as belonging to whatever else is at that coast, the LONGEST part because
a system is often a trunk plus a stub. That one helper is what makes labelled
polylines work through the engine the volcanoes already use.

### The OSM attempt, kept for the licence reasoning



Asked for TeleGeography's map; shipped OpenStreetMap's, because that request
is blocked twice over and either block alone is fatal:

- **No CORS.** `submarinecablemap.com/api/v3/cable/cable-geo.json` answers 200
  with 739 KB to curl and sends **no `Access-Control-Allow-Origin` header**, so
  a browser cannot read it whatever the licence says. Same wall as
  EarthScope/IRIS and NOMADS GRIB.
- **Licence.** TeleGeography sells an annual licence for the geocoded map data;
  the map itself is CC BY-NC-SA — NonCommercial. The public forks of their old
  repo are stale (2013–2022) and carry NO licence, so using one would be
  shipping years-old data scraped from a NonCommercial source.

OSM is ODbL — free, commercial use included, attribution required — and
Overpass is already a service here. The cost is coverage and it is stated in
the catalogue row rather than left to be discovered: **199 named systems
against TeleGeography's roughly 600**, the well-mapped third of the world's
cables. The tagging is `communication=line` + `submarine=yes` (656 ways);
`man_made=submarine_cable` exists but is 195 objects with one name among them.

**Global, not bbox-scoped** — unlike the other Overpass connector here, which
refuses without a study area. A cable is thousands of kilometres long and
clipping it to a drawn box cuts the very thing that makes it legible; 656 ways
is small enough to ask for whole (766 KB as GeoJSON).

**One feature per SYSTEM, not per way.** 656 ways carry 199 names — MAYA-1
alone is three ways — so one feature per way writes the same name on the map
three times and counts one cable as three. Grouped by name into a
MultiLineString: one feature, one label, one row, one click. Unnamed ways are
kept at `label_rank: 0` — real cable on the seabed, never competing for a name.
`label_rank` is LENGTH in bands, which is significance the geometry itself
supports: measured, Seabras-1 9,986 km, Southeast Asia-Japan 8,815 km over 6
parts.

**A LINE's label anchor is not its coordinates.** `featureToItem` read
`coordinates[1]` as a latitude, which for a LineString is a POSITION ARRAY —
every label at NaN, silently. `labelAnchor` takes the middle vertex of the
longest part: the MIDDLE because a name at a line's end reads as belonging to
whatever else is at that coast, the LONGEST part because a system is often a
trunk plus a stub and the stub must not claim the name. That one helper is
what makes labelled polylines work through the engine the volcanoes already
use — same pill, same declutter, same card — rather than a second one.
Verified live: 199 label items, every anchor finite, 112 chips surviving the
declutter, and a click on a cable opening "Submarine cable / Atlantic Crossing
1 (AC1) Seg.A".

## Volcanoes, and three services asked about a place

**The Smithsonian catalogue is BAKED** (`services/bake-volcanoes.py` →
`data/global/volcanoes.geojson`, 2,666 records, 2.8 MB), for the reasons the
geology tiles are. Three fields in it are ours, and the file says so in
`_source`: `activity` is a RECENCY BAND from `Last_Eruption_Year` and is
**never** active/dormant/extinct — GVP declines to publish those terms because
they have no agreed definition and "extinct" has been wrong often enough to be
dangerous; `type_group` collapses 28 types to 9 so a twelve-class palette can
hold them; `summary` is clipped on a sentence boundary from up to 1,776
characters, with `gvp_url` carrying anyone who wants the rest to the citable
record.

It is an ordinary catalogue layer, so symbology, the layer box, the legend,
extraction and export work on it already — and, since the fixes below, clicking
and naming as well.

**POINT FEATURES WERE NOT CLICKABLE, and nothing said so.** `featureInLayer` in
`feature-popup.js` searched polygons and lines and returned null for anything
else, so every point layer on the globe was inert: 2,666 volcanoes each with a
name, a type, an eruption history and a paragraph of geology, and a click on
Vesuvius behaved exactly like a click on open ocean. A point has no interior,
so the test is distance against the same screen-derived tolerance the lines
use. The card that opens is the VIEWER's own (`showFeatureCard`), not
`#gis-feature-popup` — `showStack` prefers it and hides the local one, which is
worth knowing before spending an hour probing for the wrong element.

**Labels: `point-labels.js`, and the job is CHOOSING.** 2,666 names is a white
globe. Two filters, because neither is enough alone: RANK, from a `label_rank`
property the bake computes (eruption recency — 231 rank-5 volcanoes, and the
layer never invents significance the record does not support), and ROOM, since
rank alone still puts 231 names on one hemisphere. A candidate is dropped if a
higher-ranked one has already claimed the screen space near it, both re-decided
as the camera moves — so zooming in frees room and the next rank down appears,
and the density is the same at every scale. Measured: 231 candidates, 37
labels at a global view, no two overlapping. Any point layer carrying
`label_rank` gets the control; cities or landforms would need nothing added.

**`sizeAttenuation: false` sizes a sprite in CLIP space, not pixels** — a scale
of 1 fills the viewport. Taking the scale from world units instead makes the
type grow as you zoom in, which is the one thing a label must not do.

**One catalogue, two lists, and a control that changes something the import
manager cannot see.** Ticking already stayed in step because both lists redraw
on the manager's change event; the Names toggle does not go through the
manager, so pressing it in Locations left Vectors & Shapes still offering to
turn labels on. `refreshCatalogues()` redraws every mounted list. A catalogue entry may now name a
`colourBy` column: `rankColourFields` would have picked `country` for this one
— a hundred hues saying nothing about volcanoes.

**Two renderer faults it surfaced, both shapes this file has had before.**
POINTS NEVER TOOK A COLOUR: `colourFor` was consulted for fills and lines and
skipped for points, so 2,666 volcanoes drew in one flat yellow under a correct
nine-class legend — zero colour attributes on the geometry. And A CATALOGUE IS
NOT A POINT CLOUD: `sizeAttenuation` scales a point with distance, so the
markers were sub-pixel from orbit. Under **20,000 points** a layer is a set of
places and is sized in screen pixels; above it, world space, or a fixed pixel
size paints the globe solid at a distance.

## Events is a list of feeds, and the services are filed where they are asked

**A mode with one feed in it is a mode with no choice in it.** Events used to
be EONET and nothing else: enter, and you got every open natural event whether
you came for wildfires or not. `gis/event-sources.js` is the registry —
one row per feed, each declaring where it fetches from, how to convert the
answer, and what colour it is — and `events.js` draws the union of the ones
that are ticked, remembered in `geoid-gis:event-sources` because a feed
somebody chose is a preference, not a state. Adding a feed is an entry in
SOURCES and nothing else.

Fifteen are there now: an EONET row per category and three USGS summary
feeds. **All three seismicity windows — past day, past week,
significant month — are on by default, and they overlap on purpose.** They are
three views of one catalogue, not three catalogues; the day feed alone opens on
a quiet map (a few dozen small earthquakes, none of the ones anybody remembers)
which makes global seismicity look like something that barely happens. Measured
on a first visit: **172 earthquakes with all three, 32 with the day feed
alone.** Merging is safe only because a USGS event carries the same id in all
three; keyed by anything else, a big
earthquake yesterday draws three markers on one epicentre and is counted three
times. Verified live: `access-control-allow-origin: *`, coordinates
`[lon, lat, depthKm]`, `properties.time` in epoch **milliseconds**.

**The feed controls are the sidebar's Events TAB, not the drop-down.** They
started in the drop-down beside the legend, which was wrong twice over: that
overlay exists to list what arrived, and it only exists while the mode is on —
so the control that turns a feed on lived inside the thing it turns on. The tab
is now a folding `<details>` like Geology (`events-section` in index.html, body
filled by `renderFeeds()`), with the Enter button in its summary; the drop-down
lists events and points at the sidebar when there is nothing to list. **The
Enter button needs `stopPropagation` + `preventDefault`** — inside a `<summary>`
a click on it is also a click on the summary, so entering the mode folded away
the panel of feeds you entered it to use.

**Seventeen tick boxes in one column is a list to be read; seven named
subsections is a thing to be used.** `FEED_GROUPS` — Seismicity, Volcanic
activity, Wildfires, Ice and snow, Storms and water, Land and climate — is a
**`gis-tool-section`**, the same card every other tool in
that column already is, so its padding, type, accent and filled-when-open
header come from the theme rather than from rules of its own (measured
identical: 11.2/12.48 px padding, 12.16 px Exo 2, dark ink on `#ff2bd6` open,
near-white closed). The first version invented hairline rows and read as
something bolted on beside them, and carried an "on/total" count that was
noise on a header whose own tick boxes are one scroll away. Each carries a
**master toggle with three states**:
`groupState()` returns `indeterminate` for a partial group, because a box
showing "off" over two-of-five-on says something false about the map, and
pressing anything short of all-on turns the group on. A group's press moves
five rows, so `refetchSoon()` debounces to **one** fetch round — measured, 11
category requests and 1 USGS for a five-row press, not five passes.

**The mode is a TICK BOX, not an Enter button.** Everything under it is a tick
box and "is the live view on" is the same kind of question; the Enter/Exit pair
was inherited from the myGeoID mode bar, which this section stopped being when
it gained a body. It is **set** from `setActive` rather than read there, because
the mode is also entered by ticking a feed, and left by leaving GIS or removing
the layer — the box has to say what is true after any of those. Ticking opens
the section (what it switched on should be in front of you); unticking does not
close it, since putting the controls away the moment somebody switches the view
off is the app deciding they are finished with them. Like the group masters it
needs `stopPropagation`: inside a `<summary>`, a click on it is a click on the
summary.

### The earthquake symbol

**Three concentric rings, not a dot.** A dot says "something is here", which is
what every other category needs; an earthquake is a point source with energy
radiating from it, and three rings say that in the shorthand seismicity maps
have used for a century. They also survive crowding — a dozen overlapping along
a subduction zone stay countable, because you can see through them.

One white texture tinted per point by the vertex colour, so one canvas serves
the whole ramp. Two details in drawing it: **the inner rings are stroked
heavier** (0.085 / 0.062 / 0.045 of the canvas), because at a marker's real size
on screen an even weight loses the centre — which is the part that says where
the earthquake was; and **the soft bloom is baked into the texture** rather than
being a second cloud, which is what makes the pulse read as a glow instead of a
marker changing size. Earthquakes also run `QUAKE_SYMBOL_SCALE` (1.9×) larger
than a category dot: three rings inside eight pixels is a smudge.

**Size is a RATIO per magnitude unit, never a number of pixels.** Magnitude is
logarithmic, so a linear mapping — the first version — spends most of its range
on the difference between an M2.5 and an M4, which nobody needs to see, and has
almost nothing left for M6 to M8, which is the difference between a news item
and a catastrophe. The physics cannot be drawn at true scale and the file says
so rather than pretending: moment goes as 10^1.5M, so rupture length goes as
about 10^0.5M — 3.2× per unit, 560× across the range drawn. The chosen
compression is **width doubling every three magnitude units** (a thousandfold in
energy), pinned at both ends: an M2.5 is the base size, an M8.5 is four times
it, nothing grows past that. Measured at two zooms, the M3→M8 ratio is 3.17
(= 2^5/3) at both — the law is scale-free, which is the property a linear one
cannot have.

**The dot cap is capped again for earthquakes.** `dotSizePx` tops out at 16 px,
right for a dot; an earthquake then multiplies it by up to 4 for magnitude and
1.9 for the symbol, which put a close-range M8 at **103 px** — a ring wider
than the island it happened on. `QUAKE_BASE_CAP` (8 px) caps the BASE rather
than the result, so the magnitude ratios stay exact at every zoom: what stops
growing on the way in is the whole family together, not the big ones catching
the small ones up. The far field is untouched — at a global view the dot is
5.7 px, well under it.

**`magnitudeColour` runs GREEN through yellow into RED**, the reading every
hazard map has trained people in, so it needs no legend: a green ring is
something the ground does all day, a red one is not. Two rules the stops answer
to. It moves in **hue, not brightness** — an earlier ramp ended at a deep
crimson (#820f2e), the obvious way to say "more" on paper and the wrong way on
a black globe, since the recency fade then takes the biggest earthquake on the
map down to #6a0a24. And it goes **through yellow rather than through mud**:
green interpolated straight to red crosses a dark olive at the midpoint, which
is exactly where the M5s are, so the middle of the ramp would be its least
legible part.

**Reading vertex colours back gives LINEAR values, not sRGB.** `THREE.Color`
converts on `set()` under colour management, so a probe that formats
`color.array` as hex reports something far more saturated than what is drawn —
sRGB #ffbe28 reads back as #ff8005. That is what makes a "the colours are
wrong" reading look convincing when nothing is wrong; convert before comparing,
or compare ratios rather than hexes. (The 0.65 recency fade is a multiply in
that same linear space, which is a proper luminance scale rather than a
sRGB-space fudge.)

**The recency floor moved 0.4 → 0.65** for the same reason. 0.4 was right when
the only feed was the past 24 hours and everything drawn was recent; with the
week and month feeds on, most of the map sits at the floor — including every
significant earthquake — so 0.4 of a colour was dimming the subject. Old is
quieter, not absent.

**A point sprite is cut by the GROUND, not by the sphere, and that is a depth
fact rather than a geometry one.** Every fragment of a point sprite carries the
CENTRE's depth, so a depth-tested marker is sliced wherever the terrain in
front of it is nearer the camera than its own centre — which, on a sphere seen
obliquely, is most of the ground around it. A five-pixel dot got away with that
for years because five pixels of quad is five pixels of ground; a thirty-pixel
ring came out with bites taken out of it along the curve, and so did the
selection halo, which is the widest sprite the feed draws.

Lifting the markers higher trades the cut for parallax — a marker standing tens
of kilometres off its own epicentre at close range, which is the lesson the
measure marker already cost. So the depth test comes OFF and
`cullBehindGlobe()` works out the horizon instead: a point is in front of the
limb when **`p · camera ≥ R²`**, the tangent-plane condition for a sphere,
exact rather than a fudge, computed in the marker's own frame because the spin
frame is turning. Anything behind it is moved to `OVER_THE_HORIZON` (1e9) and
clipped by the frustum — a `PointsMaterial` has no per-point size or alpha, so
hiding a point means moving it, and the clouds carry `frustumCulled = false` so
they are not culled for the bounding sphere those strays drag out with them.

The positions as built are kept in `userData.truePositions`; the geometry holds
those minus whatever is round the back, rewritten per frame and uploaded only
when something moved. The relief watcher writes the TRUTH rather than the
geometry for the same reason. Measured over Indonesia: 144 markers drawn, 248
hidden, every ring whole. A side effect worth having: far-side markers no
longer depend on the planet writing depth, so switching the basemap off (which
drops `colorWrite`) stops showing them through the globe.

**Only the seismicity pulses**, on the rAF loop that already runs for the spin
and the marker size, with **one phase shared by every cloud**: per-marker phases
read as shimmer. Shallow (±16% size, ±0.3 opacity) and slow (1.6 s), because a
map that will not sit still cannot be read and a fast pulse reads as an alarm.
Measured live: size 17.9 ↔ 20.8 px, opacity 0.65 ↔ 0.95.

**Every subsection arrives FOLDED.** Six open cards is a column of forty tick
boxes and the tab reads as a wall; folded it reads as six subjects, and the
master toggle beside each name is enough to work with without opening one at
all. Opening one on the grounds that something in it is on — the first
version's rule — meant arriving with five of the six open, which is the wall.

**Which subsections are folded open is kept in a module Map**, not on the
element: the list is rebuilt on every tick and every refresh, so DOM-held state
springs shut under somebody working down it. Same reason the catalogue dropdown
keeps its own.

**Renaming a source id is a MIGRATION, and this one shipped without one.**
EONET used to be a single row stored as `"eonet"`; splitting it into a row per
category renamed that id out of existence while the restore was still a plain
`saved.filter(sourceById)`. Anybody who had used the mode before the split
therefore came back to a stored set whose only surviving ids were the
earthquakes — every EONET feed silently off, no error, the panel and the globe
agreeing with each other and both wrong. Reported exactly as "activating the
events tab only adds the earthquakes to the map and legend", and reproduced by
writing the old value into localStorage.

`restoreSources()` is that migration, pure and tested: the legacy id is
**expanded** rather than dropped, because it is a positive record of an intent
("show me EONET") and every category is what it meant; an **empty** result
falls back to the defaults, since a stored set that leaves nothing on is
indistinguishable from a stale one and a mode drawing nothing reads as broken;
and a set that simply LACKS EONET rows is left alone, because that is what
switching them all off looks like and second-guessing it would undo a decision
somebody made by hand. Verified against the real stale value: 161 earthquakes
before, 222 natural events in 4 categories plus 161 earthquakes after.

**EONET is one row per CATEGORY**, so turning one off is one fewer request —
`feedUrls()` is derived from what is ticked rather than from a list in
`events.js`. EONET's own `earthquakes` category is deliberately absent: it is
nearly always empty (EONET curates by hand, the USGS publishes within the
minute) and where it did carry one it would double a USGS event under a
different id.

**GDACS floods** (kind "gdacs") joined the Storms and water group:
point-located flood events from the EC JRC with Green/Orange/Red alert
levels riding in the title — measured at 63 events for one month against
EONET's curated handful. SEARCH is the GDACS endpoint that answers with
parameters (MAP with arguments returns 400, measured), CORS `*`. It
overlaps the EONET floods row the way the seismicity windows overlap:
two registries, one hazard, both worth having. `gdacsPoints` is pure and
pinned in event-sources.test.mjs; the registry test's "kinds that are
events" list must learn each new kind or it fails the suite.

**Everything in this list HAPPENED**, with a time and a place. Faults and plate
boundaries were briefly rows in it, on the reasoning that seismicity is read
against them — true, and not a reason to file them here: a fault is a permanent
feature of the ground, so it is a vector layer the way a coastline is. They
were already in `global-data.js` under Tectonics and offered from Data ·
Vectors & Shapes, so the Events rows were a second doorway to the same dataset
and a second thing to keep in step. The `kind: "layer"` machinery went with
them rather than being left behind unused.

**Ticking a feed arms the mode.** A control that fills a list nobody has opened
is a control that appears to do nothing.

**One category opens at a time, and the others stay on screen.** The drop-down
showed twelve rows per category and then "+138 more", which named what it was
withholding and offered no way to see it; showing everything instead lets one
busy category (150 wildfires, 172 earthquakes) push every other group off the
bottom of a 60vh panel, and seeing what KINDS of event are happening is what
the list is for. So "Show all 150" opens that category into a `max-height: 34vh`
box of its own and folds the rest to their headers — still listed, still one
press away, and pressing one of them moves the open list there. **The panel's
height does not change**: measured 467 px before and after.

Two details that are only visible when they are missing: the scroll position is
kept across the five-minute refresh (`expandedScroll`), or anybody halfway down
a hundred and fifty wildfires is thrown to the top by a rebuild they did not
ask for; and a `<button>` centres its text, so with the label span at `flex: 1`
the folded headers read centred while the open one read from the left, in a
column that is otherwise perfectly aligned.

**A default scrollbar is the brightest thing on a dark legend**, and there are
two of them here — the panel's own and the open category's. Both are given the
panel's cyan, twice over: **Chrome 121+ ignores the `::-webkit-scrollbar`
pseudo-elements entirely on any element that also sets `scrollbar-width` or
`scrollbar-color`**, so the standard properties carry modern Chrome and Firefox
while the pseudos carry Safari and older Chrome, and the two are given matching
colours so it does not matter which answers. Verified on Chrome 148: computed
`scrollbar-color: rgba(82, 228, 232, 0.38) transparent` on both.

**Magnitude is logarithmic and a marker is not.** A `PointsMaterial` has one
size for the whole cloud, so seismicity is split into magnitude bands — one
cloud each, `magnitudeSize` for the scale, which `trackScale` multiplies
rather than overwrites. The panel still groups by category, because that is
how a list reads; only the globe needs the bands. Measured: 6.9 px at M3 up to
10.7 px at M6 against a base of 5.7.

**Recent is brighter, as a COLOUR rather than an opacity.** Per-point alpha
needs a four-component vertex colour that not every path here honours; a
dimmed hue does the same job in the channel that certainly arrives. A week of
earthquakes drawn identically is a map of where faults are, which the fault
layer already says — what the feed adds is *when*.

**The feed is NOT in the legend, because it is already a legend.** Its
drop-down lists every category being drawn with the same glyph and the same
colour, so the legend card beside it was that key a second time, in a second
place, for a reader to keep in step by eye. `layer.legendHidden` is the seam —
`renderLegend` filters on it — and it is deliberately not the same as being
invisible: the layer keeps its row in the layer box, its eye, its opacity and
its place in the draw order, and only the legend card goes. Verified: the
legend holds the basemap alone while the feed draws 222 events and 161
earthquakes, and hiding the layer from the box still hides the markers.

The layer row is `Live events` (renamed from `Events (NASA EONET)`, which is no
longer what it is) and its credit is the deduplicated licence line of whatever
is on — three USGS feeds are one credit. `status()` writes to **both** status
nodes, the drop-down's and the sidebar's, because the two are visible at
different times: the sidebar one is what reports a fault layer being fetched
with the mode off.

**An open section's header is already filled with the accent**, so
`.is-armed .section-title-row { color: var(--nav-accent) }` — carried over from
the mode bar, whose header had no fill — painted "Events" magenta on magenta and
made the title vanish. Measured: `rgb(255,43,214)` text on an
`rgb(255,43,214)` summary.

### The three services are filed where their question is asked

**"Data · Earth systems" is gone, and being a tab was the whole fault.** A tab
is a place you go to do a kind of work, and none of soil, seismograms and
population is a kind of work: soil is a fact about the ground under the view,
a seismogram is a time series for the analysis pages, and people in a polygon
is a number about the study area. Filed together they were a fourth place to
look for something that belonged beside what it answers, and the last place
anybody would look.

`earth-data-panel.js` therefore **builds its own cards and mounts each one**
where its question already is — soil into Geology (`#geology-section`, Earth
only, which is correct: SoilGrids maps this planet), seismograms into
Analyse · Tools & Results, population into Extract From Layers beside the study
area it counts. Two of those hosts are themselves built at runtime, so markup
in any one file could only ever reach one of them; `whenHost()` polls and stops
once each card lands.

### The seismogram in the card

**A magnitude and a depth are what an earthquake is FILED as; a seismogram is
what it IS.** That record was three panels and a form away, so almost nobody
saw it — the popup now draws it under the numbers that describe it.

Two pictures, because neither answers the other's question. The **waveform** is
when and how hard: the P arrival, the S arrival, the coda dying away. The
**spectrogram** is at what frequencies, which is what separates a local event
from a teleseism — distance is a low-pass filter, so a far earthquake arrives
with its high frequencies stripped off however large it was.
`gis/seismogram-plot.js` draws both; `research/dsp.js` supplies the STFT
(`spectrogram(signal, fs, …)` — **fs is positional**), and both modules are
imported dynamically, since most sessions never open one.

**A decimated trace must keep its peak, and this is the whole reason
`envelope()` exists.** A 30,000-sample record in a 300-pixel box is 100 samples
a pixel; taking every hundredth — the obvious thing — is decimation with no
filter, and on a seismogram it does not merely look wrong, it draws a flat line
exactly where the P arrival is and looks perfectly convincing. The test plants
a two-sample spike and asserts that naive subsampling loses it (max 0) while
the min/max envelope keeps both the peak and the trough, in the same column.

Three more things that are only visible when they are missing: the trace is
**detrended by its mean** before plotting, because a channel's counts sit on
whatever offset its digitiser has and a raw plot is a flat line against one
edge; **most of the dB ramp is dark on purpose** (magenta does not arrive until
0.78), because spread evenly it painted a station's ordinary background noise
full magenta and the picture read as "loud everywhere"; and the spectrogram is
painted through **one ImageData** scaled by the canvas rather than a rect per
cell — a 300-column grid is 30,000 fills, which stutters visibly in a popup
that is meant to open at once.

**The trace is asked before the model, and the two never look alike.** The
first version drew PREDICTED P and S — hypocentral distance, 6.0 km/s Pg below
200 km, 8.0 km/s Pn beyond, Vs = Vp/√3 — and they were reported as looking
wrong, because they are: a straight line at a crustal velocity takes no account
of the ray travelling down through the crust and back, so at 240 km the model
ran **fourteen seconds early** against a pick anybody could see on the picture.

So both marks are now picked from the trace where they can be — **solid means
read off this record, dashed means where a rule of thumb says it should have
been** — and the model is kept for the fallback and for bounding the search.
`arrivalTimes` still **refuses past 1500 km** rather than drawing two lines
somebody would read as fact: past about 15° the ray turns through the mantle
and a straight-line divide is nonsense.

**A crossing is not an arrival, and a real trace is what taught it.** On
GE.MATE over an M4.4 in Albania the ratio crossed **100 s before the
earthquake**, on a tick in the station's own noise: STA/LTA is relative, so a
small glitch in a very quiet minute is a large ratio. An absolute floor was
tried first — a fraction of the loudest short window anywhere in the trace —
and was worse than useless, because a single-sample spike sets that floor: it
pushed the pick to 269 s, into the quiet after the coda. What separates a tick
from an arrival is **duration**, so a candidate must hold most of its ratio
across the next two seconds, which is network practice and needs no absolute
scale. Measured after: 139.5 s on that trace, against an energy profile that
rises at ~144 s — and +14 s on the crude Pn prediction, reported as such.

**S needs its own detector, and this is why.** S is not "louder than the
noise" — it is louder than the **coda already running**, and `detectOnset`'s
long-term average is the quiet *before* the earthquake, which everything after
P clears. Pointed at the seconds after P it triggers immediately on the P coda
still ramping up: measured on the Albanian trace, 142.5 s — three seconds after
P and twenty-six before the real S. `detectSecondary` takes its reference from
the early coda itself and picks the first place the energy holds at twice that
for six seconds.

**A wide window looks ahead, so the crossing is early.** Four seconds of energy
held for six is a sound test for an arrival and a bad estimate of when it
started: the window crosses the bar as soon as its leading edge touches the
onset, which on a planted S at 50.0 s gave a coarse pick of 46.3. The crossing
says roughly where; a half-second window walked forward from it says exactly
where.

**The search is BOUNDED by the model, not answered by it** — a quarter to three
times the S−P the known distance predicts — which is what lets one detector
serve a local event four seconds out and a regional one thirty seconds out.

**S−P is the card's own distance measurement**, and the point of showing it is
that it is INDEPENDENT: one second of separation is about 8.2 km
(`1/(1/Vs − 1/Vp)` for the crustal pair), needing no origin time, no network
and no model of where the earthquake was — so it is a check on the USGS
location made from the picture in front of you. Measured on GE.MATE over the
Albanian M4.4: **S−P 29.7 s → about 243 km, against a station 239 km from the
epicentre.**

**Marker labels take the first row they fit in.** At 240 km the predicted P and
S are 22 s apart, which on a 305 s trace is twenty pixels: at one height the
later label paints over the earlier one and an arrival appears to have no name.
Measured on that trace, "onset" covered "S" completely.

**The card is placed twice.** It changes size after it is positioned: the trace
lands seconds later and roughly doubles its height, so a card opened low would
hang off the bottom of the window with the spectrogram — the part that was
asked for — below the fold. `placePopup` remembers the anchor and re-clamps.
And every fetch carries a ticket (`tracePass`) checked against the card's
`dataset.eventId`: a trace takes seconds over two archives, and an answer drawn
into a card that has moved on is a picture of the wrong earthquake under the
right title.

Measured end to end on an M4.4 near Lushnjë, Albania: GE.MATE HHZ, 100 Hz,
305 s, both canvases drawn, saved to the project, card 490 px inside a 779 px
window.

**An earthquake's card fetches its own seismogram**, and there is no button in
front of it. "Seismogram near here" stood between a reader and the only thing
on the card that is not already in the title — the magnitude, depth and place
are the two lines above it — so it was a button asking whether you meant it.
It stays polite about the archives all the same: one card is one trace, the
result is cached per event id (`traceCache`, bounded at 8, since a trace is
tens of thousands of samples), and nothing is fetched for a card nobody
opened.

Getting that to actually return a trace took four separate corrections, each
found by measuring against the 2023 Kahramanmaraş M7.8:

- **A station service asked with no window returns every instrument that has
  EVER been there.** The four nearest to that epicentre are an aftershock
  deployment installed days *after* it — real stations, correctly returned,
  holding nothing for the minute being asked about, and the waveform request
  that follows comes back 204 with no hint why. `stationUrl` now takes
  `start`/`end`.
- **Two degrees is the right first question and the wrong last one.** With the
  window applied, *nothing* within 2° of that epicentre was recording. The
  search widens 2° → 6° → 15° until something answers; a trace from 600 km away
  is a trace, an empty circle is not.
- **A station having a RECORD is not an archive having its DATA**, and no
  metadata distinguishes them. GEOFON lists GE.ARPR and GE.MALT as operating
  that minute and returns 204 for both. So both nodes are asked in turn —
  GEOFON carries GE and its partners, ORFEUS routes to Europe's regional and
  temporary networks — and which one holds a given trace is not something
  anybody should have to know.
- **One channel per STATION.** The list holds BHZ, HHZ and VHZ for the same
  instrument, so walking four *channels* was asking one dead station four
  times; and a 0.1 Hz very-long-period channel cannot show a body wave. The
  list is sorted by distance (labelled with it) and the walk takes four
  distinct stations at ≥1 Hz, one request at a time.

Measured end to end after all four: ORFEUS, **TU.ANDN HHZ at 72 km, 30,199
samples at 100 Hz over 302 s, 168 records, no integrity failures**, written
into the project as a CSV the Signal pages list.

### CORS decides which services exist

`earth-data.js` holds SoilGrids, FDSN and WorldPop — pure builders and parsers,
three `fetch` wrappers at the bottom, tested without a network. Verified before
anything was written:

- **EarthScope/IRIS sends no `Access-Control-Allow-Origin`.**
  `service.iris.edu` 307s to `service.earthscope.org` and neither answers a
  browser, so the largest seismic archive on Earth is unreachable from a page.
  **GEOFON and ORFEUS both do send it** and are the nodes.
- **GHSL has no browser-reachable global service.** WorldPop answers the
  population question instead, and better: people in a POLYGON rather than a
  picture, and the polygon is the study area somebody drew.
- **SoilGrids returns INTEGERS and the divisor is in the response**
  (`unit_measure.d_factor`): clay 212 means 21.2%, bulk density 95 means 0.95.
  Two different factors in one response, so a remembered constant is wrong for
  one of them and every number still looks plausible.
- **WorldPop is a two-step task API, and FINISHED IS NOT SUCCEEDED** — `error`
  is a separate field, and a Feature instead of a bare geometry returns a task
  that fails two polls later.

### miniSEED, and why it can be trusted

`mseed.js` reads the fixed header, blockette 1000, the four uncompressed
encodings and Steim-1/Steim-2. Broadband data is Steim-2 almost everywhere, so
a reader without it opens the metadata channels and none of the seismograms.

**A Steim frame stores DIFFERENCES**, so one wrong nibble corrupts everything
after it and the result still plots as a convincing wiggle. The format's own
answer is that each record carries its first and last sample as plain integers:
integrating from `x0` must land exactly on `xn`. That check is returned rather
than hidden, and `mseed.test.mjs` asserts it on a real record — GE.STU BHZ from
GEOFON over the 2023 Kahramanmaraş M7.8, eight 512-byte records, all eight
passing independently, plus a bit-flip proving a corrupted record is reported.

Three traps pinned there:

- **The record length is in each record's blockette 1000, not the response
  size.** Reading a 4,096-byte reply as one record loses seven eighths of the
  earthquake — which is exactly what the first Python reference decode did,
  and the JS was right before the test was.
- **The sample rate is a factor AND a multiplier with four sign cases.** 20 Hz
  is (20, 1) but 1.85 Hz is (50, −27); reading it as a product gives 1350 Hz
  and every spectrum is wrong by 729× with the shape unchanged.
- **`Number("")` is 0, not NaN**, so a station row with a blank latitude came
  back as a finite station at 0°N 0°E, in the Gulf of Guinea, clickable.

A fetched trace is written to `post_processing/extracted_dofs/` — the folder
`findTables` lists for the Signal and Spectral pages — so the DSP written for
FEM probe output works on a real earthquake with nothing added.

## Atlas — the assistant

`gis/atlas-assistant.js` puts a fixed launcher bottom-right on **every** page
(Earth's index lists it as a script tag; the planet pages get it from `boot.js`'s
MODULES). It loads its own CSS, so adding it to a page is one tag.

**It is grounded, not mocked, and that is the whole design.** `ECOSYSTEM`
describes the workflow once — each link's `produces`, `needs`, `has(state)`,
`act` — and `probe()` reads the live truth across all three modes (project,
study area, datasets, meshes, runs, built decks, results, series, analysis,
figures, globe layers, sidecar, compute targets). Every answer is derived from
those two: `nextStep()` is the first unmet link whose prerequisites are met,
`blockers()` walks the chain for "why can't I…". So it cannot invent a page, it
is always about *this* project right now, and **adding a capability is a row in
that table, not a new branch.** Each answer carries the button that performs it.

A model is optional and additive. With an Atlas hub configured
(`GeoIDAtlas.connect(url)`), anything the grounded layer cannot answer goes to
its `POST /api/chat/simple` with `{messages, context}` — the shape that endpoint
documents for exactly this ("the Research Hub's project/page/selection"). It has
its own reflex layer, so trivial intents never reach a model there either.
Without a hub Atlas says what it can and cannot do rather than improvising.

**Page search must be intent-weighted or it lies confidently.** Matching the
question's words against page *blurbs* made "**where** do I do meshing?" return
Metadata & Lineage, whose blurb begins "**Where** every file came from" — the
grammar outvoted the subject. So: strip interrogatives/auxiliaries (`STOPWORDS`,
deliberately excluding real page words like run/data/mesh), light-stem
(`meshing`→`mesh`), score a **name** hit 5× a blurb hit, and require ≥3 — a
floor only a name match clears. That floor is what makes "I don't know" possible
at all; without it an unanswerable question matched some blurb and got a
confident wrong answer.

`window.GeoIDAtlas.notify(message, actions)` is the seam the watcher pushes
hazard alerts through.

### The watcher

`gis/atlas-watch.js` polls the connectors on a timer against the study area.
Driven conversationally — "watch this area", "watch every 5 minutes", "watch
status", "stop watching". Three rules decide everything, each because the naive
version is actively harmful, and **all three fail silently**, so
`atlas-watch.test.mjs` pins them (16 checks):

1. **The first pass never announces**, it records a baseline. Measured on the
   live feeds: a global area baselines **2,209 events** — without this rule that
   is 2,209 alerts on open, and the user stops reading them, which is worse than
   no monitoring at all.
2. **Only new events announce**, keyed by a stable id (a USGS event url, an
   EONET id) and persisted to `metadata/atlas_watch.json`, so a reload does not
   re-announce the same eruption. The seen-set is trimmed to 500 per feed.
3. **New is not significant**: a magnitude floor (M4) and a severity floor
   (Severe/Extreme). A feed of every M0.5 tremor is noise wearing the clothes of
   information.

`triage()` is pure — no clock, network or storage — which is what makes those
rules testable rather than hoped for; the polling around it is the only impure
part, and one unreachable feed never stops the others.

**A narrower intent must be checked before a broader one.** "watch status" was
swallowed by the generic `status` branch and answered with the *project* status;
that branch now excludes watch/monitor. Any new intent sharing a keyword needs
the same care.

### The watcher in the sidecar, and your own model key

`sidecar/atlas_watch.py` is the same three rules where they can run **with every
tab closed**. `atlas-assistant.js` prefers it whenever the sidecar is connected
and falls back to the in-page watcher otherwise; `drainAlerts()` catches the
browser up on what it missed, keyed by a cursor in localStorage. State persists
to `.atlas_watch.json` beside the projects, so a sidecar restart does not
re-announce.

**Bring your own subscription** — Claude, ChatGPT or Gemini — following Atlas
AI's own procedure (`hub/secrets_config.py`), deliberately mirrored so the two
agree: an allowlist of key names, a JSON file outside git at **mode 0600**, and
status masked to `••••••last4`. The key is set *into the sidecar* and stays
there: never written to the page, never returned, never logged. That is why
`/atlas/chat` exists at all — **a browser cannot hold a secret**, so the call
that needs one is made on that side.

**The bbox must be applied per feed or the promise is a lie.** Only USGS takes a
bbox parameter; NWS and EONET are global. Unfiltered, "watching your study area"
was really watching 300 global wildfires and 122 nationwide alerts, so the study
area is now applied in `_nws`/`_eonet` against each event's own geometry
(`_first_point` reduces any geometry to a placeable point, and an alert with no
geometry cannot be placed, so it is not claimed to be nearby). Measured to prove
it narrows rather than silently dropping everything: western US 30 quakes / 1
alert / 155 fires against 416 / 121 / 300 worldwide.

**The Earth page's script tag needs its own `?v=`.** `atlas-assistant.js` was
added unstamped, so it imported an *unstamped* `sidecar.js` — a second module
instance with its own connection state, and Atlas insisted the sidecar was not
connected while the hub was talking to it happily. Exactly the module-identity
trap above: `stamp.py` only rewrites stamps that already exist, so a new tag must
be given one by hand once.

## Extraction within ANY polygon, from every active layer

Extract From Layers packages a study area: a **Within** select (the drawn or
boxed area, or any loaded POLYGON layer by name), tick lists per dataset with
per-column folds, and Run producing one package — the sample grid, every
ticked vector layer truly clipped, every ticked point cloud filtered. Export
CSV / Export GeoJSON write the WHOLE package, one file per layer, each filed
into the open project through `downloadText`. `window.GeoIDExtraction`
(`run`, `getLastPackage`) is the Model Builder's seam — a package is
`{bounds, grid, vectors, clouds}` already cut to the study area.

- **`overlay()` dropped LINES whole in clip and ALL points in difference.**
  Clip kept a line only if a vertex was inside (a crossing transect vanished);
  difference had no point branch at all. `clipLineToMasks` cuts each segment
  at every mask-edge crossing and classifies runs by midpoint (holes
  honoured); points are kept by containment in BOTH modes. Pinned closed-form
  in geoprocessing.test.mjs: clip of [-1,0.5]→[2,0.5] through the unit square
  is exactly [[0,0.5],[1,0.5]] and the difference is the two outside stubs.
- **A point cloud extracts from the FILE, not the renderer.** The delimited
  reader keeps `layer.source` (the table window's seam); `extractDelimitedWithin`
  re-parses it, so every column the file had is a tick — not the x/y/z/mag
  the renderer kept. `delimitedColumns` is the ONE naming rule (header row,
  else `column_N`) shared by the panel's tick list and the extractor, and
  lat/lon always ride along whatever is unticked.
- **The bounds layer excludes itself** from the vector list at run time —
  clipping a polygon by itself returns itself, which is a copy, not an
  extract. Drawn bounds have no layer id, so there every polygon layer
  (the captured study area included) is an ordinary extract subject.
- **Fields narrow properties, never geometry**, and `fields: null` means
  "all" — the panel passes null when every column is ticked, so a layer
  with more properties than the FIELD_CAP lists is not silently stripped.
- **`pointInAnyRing(lat, lon, rings)` — LAT FIRST.** The test suite itself
  passed (lon, lat) and read a correct membership function as broken for a
  round; the extraction module speaks {lat, lon} objects and lat-first calls
  throughout, unlike GeoJSON's [lon, lat].

**The workflow test (new project -> geology + elevation -> 10 km box ->
extract -> export) found two more per-body faults**, both invisible on Earth:
the rocky worlds all hold `getGeologyFeatureAtLatLon` internally and NONE put
it on the seam, so the extraction's geology tick wrote an empty column on
every planet (the seam entry closes over `geologyInteractiveState`, live once
that world's geology map loads); and `extractPolygonSamples` converted its
step with Earth's 111.32 km/deg everywhere, so a 0.5 km grid on Mars was
really 0.27 km — 1,444 rows claiming a resolution nobody asked for. The step
now derives from `viewer.bodyRadiusKm` (pi*R/180). Measured after: Mars 21
rows over a 10 km box, step 0.5000 km on Mars's radius, geology 430/430
("Mixed layered sedimentary rock"), export filed in `mars/extract-wf-mars`'s
own exports/. The grid's elevation and geology are the SAME uniform-ground
grid by construction — one table, one resolution, no interpolation step.

**The five rocky planet pages still carried the dead `#gis-extract-modal`**
that Earth removed — the second instance of the documented id-collision:
`getElementById("gis-extract-run")` found the modal's button first, the
shared panel's listener bound to it, and Run Extraction did nothing on any
planet while every list around it rendered perfectly (renders look elements
up per call; wiring happens once at init). The modal markup is gone from all
five, their Extract buttons open the Extract From Layers panel (via
`GeoIDSidePanels.open("analysis")` — on the planets the section lives in the
workbench, so un-hiding the section alone is not enough), and the modal-only
wiring is removed so the freed ids cannot rebind to the panel's controls.
When a shared-panel control is dead on ONE lineage of pages, count its id
(`querySelectorAll`) before reading any code.

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

## The events feed's offset was computed, written, and never reached layout

With the legend open the feed sat on top of it — **102 px of overlap**,
measured. `placeOverlay` was innocent throughout: it read the legend's live
box, computed the right offset, wrote it to `style.right`, and the value could
be read straight back off the element. It simply never reached layout.

**A plain inline `right` on that element is IGNORED.** Measured both ways, in
one synchronous block so nothing could interleave: writing `right: 500px`
inline left the box exactly where it was — right edge 1306 of a 1394 viewport,
which is the stylesheet's own 5.5rem — while the identical value written
`!important` put it at 894, to the pixel. So the write is the fault and the
arithmetic never was.

The overriding declaration does not surface through enumeration: no rule in
`document.styleSheets` sets `right` or `inset` with priority (checked by
`getPropertyPriority`, not by text, so a shorthand could not hide), there are
no `adoptedStyleSheets`, and the element has no animations. So `placeOverlay`
writes with `setProperty(..., "important")` — the fix the A/B supports rather
than a guess at which sheet is at fault — and says so where it does it.

Two traps this cost, both worth remembering:

- **Do not measure a `display: none` element.** Most of the hunt was spent on
  an overlay whose feed was switched off: `getComputedStyle` reported a stale
  `right` that disagreed with the inline value, which looked like the bug and
  was an artefact of reading a box that had never been laid out. Switch the
  thing ON, then measure.
- **A probe that cleans up after itself can erase its own evidence.** One
  round restored `style.right = ""` at the end and the next read was taken
  against the restored state, which produced a contradiction that sent the
  hunt sideways. Read, then restore, and never in the same expression.

Verified after: legend closed, feed 956..1196 against a legend at 1204;
legend open, feed 778..1018 against a legend at 1026 — the feed slides left
by exactly the 178 px the legend grew, and the gap is 8 px in every state.

## The GIS tools are one shared module set; the SEAM was the gap

Asked whether the tools and the draw procedure are identical on the planets,
the answer measured out as: the tools yes, the seam no.

**Already identical**, verified live rather than read: 51 shared modules under
`viewer/gis/` with **none planet-only** (the 9 Earth-only ones are all
Earth-specific data services — EONET, GEE, satellites, weather, SoilGrids,
the Earth catalogues); the **same 47-tool registry** with the same ids on
Earth and Mars; the **same eleven-button draw bar** in the same order. The
per-viewer draw/measure functions diff clean once body names and Mars's moon
argument are normalised — `activateStudyArea` differs by the string "Mars" vs
"Mercury" and nothing else — and the planets' `measureDisplayLiftForView`
implements Earth's parallax-scaled lift with the SAME constants (0.0015,
floor 5e-7, ceiling 0.012); Earth's version only generalises the distance so
it also works in a moon's frame.

**The gap was `window.GeoIDViewer`.** Measured live on Mars: 31 seam keys, and
three names the shared modules call were simply absent —

| seam | who asks | what breaks |
| --- | --- | --- |
| `surfacePoint` | vector-render, drapes | geometry cannot hug the ground |
| `getEffectiveRelief` | vector-render, geotiff-adapter | relief-following is blind |
| `elevationNormalized` | vector-render | ditto |

Each is already COMPUTED in every planet viewer — `measureSurfaceRadius`,
`getEffectiveTerrainRelief`, `sampleElevationNormalized` — and simply never
published, so a shared module loaded on a planet asked and got `undefined`.

`services/port-viewer-seam.py` publishes them, idempotent with a `--check`
like the draw-tools porter. **Exposed, never re-derived**: a second copy of
the radius rule in a shared module is exactly how the polygon-area formula
came to be wrong in ten files. `surfacePoint` passes an explicit
`{ kind: "planet" }` rather than letting `measureSurfaceRadius` default to
`getActiveMeasureContext()`, which would answer in a MOON's frame whenever a
moon is the active measure target. The four gas giants are untouched: no
elevation map, no terrain to hug.

Verified on Mars: 34 seam keys, Olympus Mons normalising to 0.9523 against
0.1671 on the plains, and `surfacePoint` returning radius 3.30475 = exactly
`3.2 + 0.9523 x 0.11`, the viewer's own rule, with the lift honoured to the
digit.

**Two lessons about the instrument.** A regex scan of the viewer sources for
seam names gives FALSE NEGATIVES — it reported `setStudyAreaPolygon` missing
on all ten worlds while the browser was calling it happily — because the seam
is built by `Object.assign` in shapes a pattern does not catch. Ask the
running page (`Object.keys(window.GeoIDViewer)`), never the source. And when
comparing per-viewer copies, normalise what is legitimately per-body (body
name, radius constant, group name, moon arguments) or every function reads as
drift.

## The planets inherit the GUI work, except what lives in a stylesheet

A useful division came out of checking whether the recent UI work had reached
the nine planet viewers. **Everything carried by a shared MODULE was already
there** — measured on Mars, identical to Earth to the pixel: the legend's
magenta frame `rgba(255,43,214,0.34)` on `rgb(16,7,36)`, the card at
`rgb(24,13,47)`/12.48px, the head bar spanning 258.4 of 260.4 at 12.16px/600,
the grouped drawn-areas card with real swatch colours, the Workspace head gap
at 7.2px and the empty control-stack at 0. Mercury and Jupiter the same
(Jupiter builds no draw bar, which is the documented per-body gate, and its
legend frame and collapsed stack are right).

**What did NOT carry was the one thing written in a stylesheet.** Earth's
`@media (max-height: 560px) and (orientation: landscape)` block — the one the
Analysis Hub trips by shrinking the iframe to ~400px — pulls the panel and the
dock in to 0.5rem and 20rem, lifts the dock in front of the panel and caps its
body at 30vh. That block is in `styles.css`, which only Earth reads; the nine
planets read `gis/shell.css` and had no answer. Measured side by side in the
same shell at 1200x520: panel and dock at **16px/384px against Earth's
8px/320px**, dock **z-index 11 against 21**, dock body **218px against 122px**.
Not broken — their own `--layer-dock-space` reservation still kept panel and
dock apart — but visibly a different application beside Earth's.

Ported into shell.css's existing copy of that media query, and verified after:
Mars matches Earth on every property, with the dock body at 30vh of its own
frame and no panel/dock overlap.

**The rule of thumb this gives**: after a UI change, ask which FILE it landed
in. A module under `gis/` reaches all ten worlds for free; anything in
`styles.css` reaches exactly one, and its twin in `gis/shell.css` has to be
written by hand. That is the same split the `.gis-tool-body` overflow fix and
the `:root` scrollbar rule both had to pay for.

## The legend tile speaks the GUI's own language

The legend was the last surface still wearing a look of its own. The diff
against a LIVE `.gis-tool-section` was the whole brief — measured, not eyed:

| | was | now |
| --- | --- | --- |
| panel frame | cyan `rgba(82,228,232,0.3)` | the accent, at the Workspace tile's own values |
| card ground | translucent white 5% | opaque `rgb(24,13,47)` |
| card border | white 8% | accent 18% |
| radius | 0.7rem | 0.78rem |
| head | Exo 2 **400** / 0.73rem / 0.08em | **600** / 0.76rem / 0.1em |
| open state | nothing | filled accent head, dark ink |

**The frame mattered most, and it is a rule rather than a preference.** The
skin's own division is magenta for CHROME — frames, headings, active states —
and cyan for DATA: field labels, readouts, values. A cyan border says "this
box is a reading" about the one thing on screen that is a container. The
replacement values are the Workspace tile's, copied rather than invented, so
the two floating tiles are one object seen twice.

The card structure already mapped onto the house pattern and nobody had
noticed: `.legend-entry` is the card, `.legend-entry-head` is the summary,
`.legend-entry-body` is the body and `.is-folded` is the inverse of `[open]`.
So an open card now fills its head with the accent in dark ink — how the rail
buttons, the nav tabs and the sub-tab cards all say open — and which head
belongs to which body is never in question with several stacked. The caret is
the column's own left `\203A` chevron turning the same way, not a second fold
language.

Verified by comparing like with like: a FOLDED legend card against a CLOSED
`.gis-tool-section` matches on ground, border and radius exactly, and the
head matches the reference summary on family, size, weight and tracking. The
first comparison read "false" only because it put an open card beside a
closed reference; compare the same STATE or the number means nothing.

**Matching the computed values was not enough, and the first attempt looked
unfinished.** Two things a property diff does not catch:

- **`.layer-type-badge` is a CHIP by definition** — `inline-flex`,
  `width: fit-content`, `border-radius: 999px`, its own 1px border — which is
  right where it labels a layer inline and wrong as the lid of a tile. Setting
  colour and type on it left a rounded pill floating inside a rounded card
  with a gap all round: measured **157.9 px of head inside a 260.4 px card**.
  Every chip property has to be undone BY NAME (`display`, `width`, `border`,
  `border-radius`, `background`); the card's `overflow: hidden` then clips the
  bar into the tile's own corners, so the head needs no radius of its own.
- **ONE loud thing per tile.** In the sidebar an open card takes a filled head
  AND a bright border AND a glow, and it can: it sits on a flat panel with no
  frame of its own. Inside a bordered floating tile the same rules stack three
  magenta rings inside one another — panel, card, head — which is what read as
  messy. The filled head alone says open here; the card keeps its quiet
  hairline in both states and the panel frame is a hairline with a soft bloom.
  Copying a rule is not the same as copying its CONTEXT.

## Drawn shapes are ONE legend entry, and a swatch reads the geometry

A card per drawn shape was the legend describing the reader's own working
set back to them a line at a time — each with a heading and a full-width
ramp bar under it, so a handful of study areas pushed the datasets the map
is about off the bottom of the panel. They are all the same KIND of thing,
which is what a legend groups. `drawnAreasCard` (layer-hierarchy) collapses
every `ext === "drawn"` layer into one card built in the CLASSED legend's
shape — swatch left, name right, the geology key's own `legend-class` rows —
placed where the first drawn layer sat so the legend still reads in draw
order.

- **The card's key is FIXED** (`dataset.legendKey = "Drawn areas"`, with the
  count only in the badge). `titleOf` prefers that dataset key, and the dock
  springs the panel open when a key it has not seen appears — so a title
  carrying the count would be a new key on every capture and the legend
  would fly open each time somebody drew a box. The first drawn shape still
  opens it, because that entry genuinely is new.
- **Past ten rows it scrolls** (`.legend-classes.is-scrolling`, 12.4rem —
  ten single-line rows plus their gaps). A drawn set has no upper bound and
  the panel does. Scrolling, never truncating: every row stays in the list.
- The rows carry no `.legend-symbol-label`, so `signatureOf` falls back to
  the title and the card cannot collide with another source's.

**Every swatch was WHITE, and that is this file's own documented trap read
from the other end.** `renderFeatureCollection` draws with
`vertexColors: true`, so a vertex-coloured material's own colour is white —
it is the MULTIPLIER, not the paint — and `layerColour` was reading exactly
that. Four study areas came out as four identical blank boxes: the swatch
column present and carrying no information at all. The note "read the
geometry, not the material" already existed for *checking* a paint; the
legend itself was not following it.

`layerColour` now takes the first vertex colour off `geometry.attributes.color`
and converts **linear → sRGB** on the way out, because `THREE.Color.set`
converts on the way IN under colour management and formatting the attribute
straight to hex reports something far more saturated than what is drawn. A
material colour is consulted only where that material is NOT vertex-coloured.
Verified live by painting one shape `#ff8c1a` through its own `repaint` and
reading the swatch back as `rgb(255, 140, 26)` — exact — while the untouched
shapes showed the drawn default `#4e79a7`.

## The music player, and the tracks that were not there

`music.js` (one copy per viewer, ten of them) shuffles a playlist and
plays it. Two tracks — Andromeda.mp3 and infinity.mp3, 9.1 MB and 6.9 MB
— were deleted from `assets/music/` in a size cleanup on 25 Aug 2026
while every viewer went on listing them. Because the playlist is
SHUFFLED, whenever it started on one of the dead entries the audio
element errored, `ended` never fired (an error is not an end), and the
button sat there doing nothing: reported simply as "music player is
broken", and intermittent by construction. The dead entries are gone from
all ten modules, and an `error` listener now ADVANCES to the next track —
with a consecutive-failure count so a playlist where everything fails
stops rather than spinning. Verified by wrapping `window.Audio` to catch
the element the module creates: Nebula (1).mp3 loads, plays, clock
advancing, no error. Note the paths differ by viewer on purpose: Earth's
copy uses `/assets/music/...` (absolute) and the planet copies
`../../../assets/music/...`, because a planet page is three directories
deep.

## Running and testing

`python3 serve.py` (repo root) starts the static site *and* the sidecar together
and prints the URL — the one-command way to run the whole thing. Stdlib only.
`QUICKSTART.md` is the user-facing version.

Two committed test commands, no dependencies (`GeoID_GIS/tests/`):

- `node GeoID_GIS/tests/run.mjs` — runs every `*.test.mjs` under `viewer/` (dsp,
  stats, postprocess) and aggregates. The analysis correctness net.
- `python3 GeoID_GIS/tests/sidecar.py` — drives a throwaway sidecar end to end:
  the fs contract, the **path sandbox** (escapes must 403), token auth, compute
  targets and the password refusal, run-command resolution, deck generation per
  family, and the binary reader against a synthetic mesh whose answers are exact.
  Needs no network, Trilinos or GALES binary. **Use `-u` when reading a
  sidecar's banner from a pipe** — it prints then blocks in serve_forever, so a
  block-buffered pipe never delivers the token line and the read hangs.
- `python3 GeoID_GIS/tests/smoke.py` — boots the real site in headless Chrome and
  asserts all 64 Research pages mount. It drives CDP over a **hand-rolled
  stdlib WebSocket** (no puppeteer, no chromium download); finds Chrome by name
  or `$GEOID_CHROME`, and skips green if none is installed. This is the guard
  against a page rotting silently — the registry shape makes that easy and this
  is the only thing that catches it.

## Verifying

There is a headless-Chrome + CDP harness (`shoot.py` in the session scratchpad):
it drives `http://localhost:8125/geohub/`, runs a setup script inside the
iframe, and saves a PNG. Points worth knowing:

- Test the **embedded** page, not the standalone viewer — several code paths
  early-return when `window.self === window.top`.
- Use a fresh browser profile per run; a reused one serves stale CSS and makes a
  working change look broken.
- The globe spins off wall-clock UTC, so two separate runs are **not**
  comparable pixel-for-pixel. Toggle within one session, or pause with
  `setSpinPaused(true)`.
- Prefer asking the viewer's own picking what coordinate is under a pixel
  (`#cursor-readout`, format `"42.47°, 238.27°E | 1534 m"` — signed latitude,
  east-positive 0–360 longitude) over re-deriving geometry, and always run a
  control that reproduces the bug so a clean result means something.

## Research Hub and the project spine

A project is a **real folder on disk**, in the layout the Qt Research app uses
(`/home/owen/atlas-ai/apps/GeoID_Research/app_qt.py`, `geoid_project_structure`
at :692 and the metadata schema at :723). Both are ported verbatim into
`gis/research/project-store.js` — twenty directories and `metadata/project.json`
field for field — so a project made in either app opens in the other. Changing
either shape breaks that interchange; change both together or not at all.

**Projects are filed by world**: `geoid_projects/<body>/<name>/`, not flat.
`bodyFolder()` in the store decides the folder and `createProject` stamps
`body` into the metadata; `listProjects()` defaults to the current world and
takes `null` for all of them. The desktop app writes the flat layout, so point
it at `geoid_projects/earth/` (or whichever world) rather than at the root — at
the root it will list the world folders as though they were projects.

The store writes through `gis/research/fs-adapter.js` rather than to
`FileSystemDirectoryHandle` directly, because `showDirectoryPicker` needs a
native dialog no headless browser can drive. `memoryAdapter()` stands in for
tests: `store.useMemoryAdapter()` then everything downstream of the picker is
the real code path.

**`showDirectoryPicker` needs a SECURE CONTEXT, and this is the single most
expensive trap in the project.** `http://0.0.0.0:8125` is not one;
`http://localhost:8125` — the same server, the same files, four characters
different — is. On the insecure origin the API is simply `undefined`, so no
folder could be chosen, no project created, and all twenty-nine project-scoped
pages sat empty looking broken. The API is also absent from Firefox and Safari
entirely. Never diagnose a missing picker as a browser problem without checking
`window.isSecureContext` first; `folderSupport()` in the store does that and
returns the reason, and every surface that offers the picker must report it.

Because of that, **a project does not have to be on disk**:
`indexedDbAdapter()` implements the same adapter interface and
`store.useBrowserStorage()` selects it, so the hub works on any origin and in
any browser. It is not equivalent and must never be presented as such — the
desktop app cannot see it and clearing site data destroys it — so every offer of
it says so.

**Bridge contract** (`gis/research/bridge.js`) — what makes the three pages one
workspace:

| from | to | what |
| --- | --- | --- |
| GIS Area tool | `study_area` + `metadata/study_area.geojson` | `captureStudyArea()` |
| import-manager | `data/raw/` + `metadata/data_registry.json` | `registerImportedLayer()`, called on every completed import |
| extraction | `exports/` | `saveExport()`, called from `downloadText()` |
| Meshing Studio | `meshes/` | `saveMesh()` |
| project | globe camera | `frameStudyArea()` |

**The return paths (project → globe) close the loop.** For a long time
everything flowed GIS/Model → project and nothing came back, so analysis
dead-ended in a folder. Three bridge calls reverse it:

- **`sendToGlobe(entry|path)`** reads a project file as *bytes* and hands it to
  the **same** `window.GeoIDImportManager.importFileList` a dropped file uses —
  no second georeferencing path. A GeoTIFF drapes, a GeoJSON draws, exactly as
  on import. Wired as "Show on globe" (Workspace recent feed, Data Repository
  toolbar), gated by `isGeoFile`. Needed a binary read: `readFileBytes` across
  all four adapters + `store.readProjectFileBytes`, because the disk/sidecar
  `readFile` returns `.text()` and a raster cannot survive that.
- **`restoreLayers()`** re-drapes a project's layers when it opens. The data
  registry already records each imported layer's project path (kind
  raster/vector/layer), so restore re-imports those, skipping any already on the
  globe — idempotent. Triggered by a `store.onChange` listener in `project.js`
  keyed on the project *folder* (once per switch, not per metadata write), which
  waits for `window.GeoIDViewer` because on a cold load the project resolves
  before the globe exists. `restoreSession()` already reopened the project; this
  is what makes the reload feel like resuming.
- **`pickOnGlobe()`** fills a coordinate by clicking instead of typing. The pick
  lives on each viewer's seam because the inverse — `<group>.worldToLocal(hit)`,
  undo `globe.rotation.y - π`, `vectorToLatLon` — must match that viewer's cursor
  readout, and those helpers are in its closure. Returns the viewer's own
  longitude; the bridge adds the signed value the schema wants. **All ten worlds
  have it.** Earth uses `intersectAnySurface` (hits the displaced terrain); the
  nine planet viewers use a uniform block that raycasts a sphere at the globe
  radius instead — equivalent to a fraction of a degree, verified against Mars's
  cursor readout (`5.32°, 61.08°` pick vs `5.32°, 61.27°E` readout). Only the
  **group name differs per lineage**: `marsGroup` (mars/moon and all four gas
  giants), `mercuryGroup`, `plutoGroup`, `venusGroup`. Verify headlessly by
  dispatching a `pointerdown` at the canvas centre and asserting the lat/lon is
  in range. **One convention caveat:** the pick returns the viewer's *internal*
  `vectorToLatLon` longitude, which round-trips correctly through
  `latLonToVector3` (so study-area → frame-on-globe is consistent), but on a
  west-positive world like Mercury it is not the `°W` value the readout shows —
  the display applies a further east→west conversion the pick does not. Correct
  for Earth (east-positive), round-trip-correct everywhere; cosmetic only.

Two things to keep right when touching it:

- **Longitude.** The viewer carries east-positive 0–360; EPSG:4326, GeoJSON and
  the Qt app all mean signed −180..180. Anything leaving the viewer for a file
  must be converted (`signedLon` in bridge.js) — unconverted, a study area over
  Sicily records as longitude 315 and reads as mid-Atlantic downstream.
- **Never fail the host action.** The import and export hooks are annotations;
  a project that is closed, full or unwritable must not break the import or the
  download it is recording.

**Imported layers lag the globe by one frame.** `holdSpin()` in
`import-manager.js` sets the group's rotation from its own rAF callback, which
cannot be ordered against the viewer's render loop. Measured: 0.08 degrees at
60 fps, 0.6 degrees at the ~8 fps the headless software renderer manages. Not
worth restructuring the render loop for, but do not write a test that asserts
the two match to better than a frame's worth of rotation -- that is what a
"regression" here will usually turn out to be.

**FEM is configured here and executed elsewhere.** The browser cannot run a
native solver, so the FEM pages write `fem_runs/<run>/spec.json` — plain JSON,
no browser-specific fields — and read results back from the same folder. Every
FEM page edits the same spec, so a page must merge into it rather than
overwrite it.

**The FEM loop runs through the project folder**, not through memory: FEM
pages write `fem_runs/<run>/spec.json` → the desktop solver writes results back
beside it → Post Processing extracts probe time series into
`post_processing/extracted_dofs/` → the Signal and Spectral pages read those as
ordinary series. Any page that lists "time series in this project" must include
`post_processing/extracted_dofs`, or the loop stops one step short of the
analysis it exists for.

**DSP has real tests.** `node GeoID_GIS/viewer/gis/research/dsp.test.mjs` checks
`dsp.js` against signals whose answers are known, and
`postprocess.test.mjs` checks the DOF interpolation against hand-worked
answers. Run them after touching either file; three of the cases in it started as genuine bugs (bin scalloping, a
resolution-blind band width, and an undetrended spectrum calling instrumental
drift the dominant component).

**Pages are laid out as the Qt pages are**, via primitives in
`pages/common.js`: `pageHeader` (title + one line, optional status pill),
`toolbar`, `collapsible` (the Qt `CollapsibleSection` — folding is the design,
not decoration: unfolded, these pages are unreadable), `splitPanes` (the
QSplitter, 1:2, stacking under 1100px), `tabbedPanel` (a Card with a heading and
a secondary tab bar, which remembers its tab), `editorCard`, `editorHero`,
`fieldGrid`, `slider`, `editTable`, `dataTable`, `console_`.

**The hub renders the page header itself**, from `page-blurbs.js`, so all
sixty-four have one. A page that draws its own sets `ownHeader = true` on its
mount function — `projects`, `repository`, `docs`, `qaqc` and every `crossPage`
do, and forgetting the flag gives that page two titles.

**A page's structure is the Qt app's own layout tree, not a guess.**
`services/qt-layout.py` walks `app_qt.py`'s AST and recovers how each page is
actually built — `sel.addWidget(self._file_edit, 1)`, `layout.addLayout(sel)`,
`tabs.addTab(file_tab, "File QA")` — in source order, into
`gis/research/qt-layout.json`: 62 pages, 2811 nodes. `qt-render.js` walks that,
and the mapping is nearly one to one: QVBoxLayout is a flex column, QHBoxLayout
a flex row, `addWidget(w, 2)` is `flex: 2`, addStretch a spacer, QGridLayout a
grid with each child at the row and column the app placed it at.

This replaced building pages from `qt-spec.json`, which is an **inventory** —
which buttons, which fields. The inventory was right and the pages still looked
nothing like the app, because the arrangement is most of what a page is and the
arrangement was invented here. If a page looks wrong, fix the extractor or the
renderer; do not hand-write a layout for it.

**`qt-layout.json` and `qt-spec.json` are fetched with a `?v=` too.** They were
not, so the browser served a stale tree against freshly stamped modules and a
regenerated layout looked like it had changed nothing — form rows rendered with
their captions and no fields for exactly that reason. Both take the reading
module's stamp off `import.meta.url`; any new data file must do the same.

**Measure the tree against the source, don't eyeball it.**
`scratchpad/coverage.py` counts what each page class constructs against what
reached the tree, excluding runtime rows, cells, dialogs and colours. The first
honest reading was 63%; it is now **90%** (1752 of 1561 constructions, the tree
running ahead because the Ingest provider tabs are generated). Every jump came
from an idiom the extractor was silently swallowing, and each one had eaten a
visible part of a page:

- `CollapsibleSection`'s API is `add_widget` / `add_layout`, not `addWidget` —
  Signal Processing was four empty sections.
- A `QSplitter` takes `addWidget` directly rather than owning a layout —
  Projects was an empty splitter.
- `addRow("Input file", in_row)` hands a QFormLayout a **layout** as the field.
  One `render_child` resolves either; before it, Preprocessing Transforms lost
  53 of its 67 widgets.
- `for w in [save_btn, stamp_btn, QFrame(), h1_btn, …]: toolbar.addWidget(w)`
  adds through the loop variable. Research Notes' whole Markdown toolbar.
- `for w in (a, b): w.setFixedWidth(88)` sets properties the same way.
- `stacked_field("Source URL", self.source_url)` is a module-level helper, not a
  Qt class — the entire Ingest provenance grid.
- `QScrollArea.setWidget(w)` never calls addWidget. CSV Plotter's dataset area.
- `CollapsibleSection(title, collapsed=False)` says it opens on arrival.
- `addWidget(btn, 0, Qt.AlignLeft)` keeps the button at its size hint.
- **A factory method is inline code.** A page builds part of itself in a helper
  that *returns* a widget or a layout — `_series_box` (:10750) returns a
  QGroupBox holding a three-row form, `_browse_row` returns a field and its
  Browse button — and `__init__` shows only the call. `inline_method()` reads the
  body with its own reader, renames its variables, binds its parameters to the
  caller's arguments (keywords included) and its return to the caller's targets,
  tuple returns and all. The factory can be the child of addWidget/addLayout
  **or the field of an addRow**, which is how most of Signal Processing's form is
  written.

**The eleven Ingest pages are one class constructed eleven times** with
different `providers` lists, their tabs generated by `_build_provider_tab` from
the dicts. Those lists are plain literals in `ingest_domain_specs`, so the tabs
are static content arriving by another route: `qt-layout.py` rebuilds them, and
the action travels with each button so the renderer performs it rather than
disabling it — `url` fills Source URL and opens the link; `import_files` /
`import_dir` write into `data/ingest/<slug>` and register each file with the
tag, the provider as source stage, and the provenance grid's fields, which is
the same registry contract the desktop app reads.

- **A loop over literal data builds a widget per item.**
  `for label, slot in [("CSV", self._add_layer_csv), …]` is how Map's five
  add-layer buttons are written; each pass binds the item to the loop variable
  so the constructor reads the label it was given.
- **A property set outside `__init__` is runtime state, not initial state.**
  MapPage sets `setChecked(True)` on its Embedded toggle in the constructor and
  `setChecked(False)` in `_ensure_view`, its fallback for a missing WebEngine.
  Source order let the fallback win and the page started with Embedded off. The
  constructor has the last word on every property.

Coverage is now **91%**. What is left out is genuinely built in response to a
click, so there is nothing in the source to read until it happens: MapPage's
dialogs and CSV Plotter's dataset cards.

**`qt-runtime.js` is where those live.** `install(pageId, host, api)` runs after
the tree is on the page and fills in what a click creates, against the controls
the tree already rendered. The rule: build the same widgets in the same order
into the same container the Qt method uses, and write to the same files — a row
that looks right but registers its dataset somewhere else is worse than no row.
CSV Plotter is the worked example (`_build_dataset_card` :7597, `plot_csv`
:7750): a card per dataset with its own plot type and column mapping, Load
Columns taking the tag from the data registry, and one figure into `figures/`.

**Map Composer** is the other one. `map2d.js` is a canvas Web Mercator tile map
rather than a vendored Leaflet, because Export PNG is the point of that page — a
figure-quality flat map bound for the Storyboard — and a canvas exports itself
where a Leaflet map means rasterising a tree of DOM tiles with a second library.
Tiles carry `crossOrigin = "anonymous"`; without it the first tile taints the
canvas and `toBlob` throws, taking the export with it. The globe does not make
this redundant: a drape is how you see where something is, a flat map is how you
lay one out for print.

**A page with a runtime module sets `specComplete`.** Map's leftover spec
controls are the fields of its bbox and WMS dialogs, which the runtime asks for
inline; appending them too gave the page a dead duplicate of a form that works.

**`.qt-h` centres its children**, which is right for a toolbar and wrong for the
panes of a QSplitter — Map's layer panel and map both sat at content height with
the page empty below them.

Its own traps, each caught by measuring rather than reading: `welch` and
`spectrogram` take `fs` **positionally** and welch returns `psd` not `power`;
`histogram` returns bin *edges* with no centres; plot.js had no bar mode, so
both "bar" and "hist" silently drew as lines — caught by comparing rendered ink
between two modes and finding it identical to the pixel. Verified end to end on
a planted 3 Hz + 17 Hz signal: the PSD peaks land at 3.13 and 17.19 Hz, within
one bin of a correctly derived 100 Hz rate.

**Nine pages keep their hand-written module** — `KEEP_HANDBUILT` in
`spec-page.js`. Each is a tool rather than a form: it holds state, parses files
or drives a multi-step flow. The list was measured, not chosen: across all 62
pages 238 of 310 buttons in the tree already have a handler matched by label,
and these are where that falls below half (Build New 0/8, Projects 5/18, Data
Hub 4/14, Data Repository 1/8, Docs & Sheets 1/6, QA/QC 1/5, Post Processing
0/2, plus Notebook and Dashboard). Do not add to that list to avoid wiring a
page — wire it, or let its controls render honestly disabled.

**A tree-rendered page is a fixed-height flex column**, as a Qt page is: the
window sets the height, stretch children absorb what is left, everything else
takes its size hint. `min-height: 0` on every layout is what lets a flex child
shrink at all — without it `min-height: auto` floors each child at its content
height and the page overflows again. 53 of 53 fit 1920x1080 with no page-level
scrolling.

**A Qt stretch factor is `flex-grow`, and the basis must stay `auto`.**
`addWidget(w, 1)` gives the widget its size hint *and* a share of the leftover
space; `flex: 1` sets the basis to 0 and throws the size hint away. Ingest's
registry section collapsed to 2px under it while its neighbours kept full
height. `flex: N 1 auto`.

**A QFormLayout row is label-left, field-right**, captions aligned down the
column, as Qt draws it. Stacking the caption above the field made every form
twice as tall and read as a list rather than a form.

Two further traps found the hard way: `.research-page`'s grid rule sets
`align-content: start`, which computes to `align-items: start` in a flex column
and shrank every page to 954px of an 1824px pane; and `#research-hub .input`
sets `width: 100%` with an **id**, which outranks any class-only rule, so a
combo in a spacer'd row spanned the row until the override carried
`#research-hub` too.

**Do not rebuild a page from memory.** `services/qt-extract.py` parses
`app_qt.py`'s AST into `qt-spec.json` — every page's title, subtitle, tabs,
collapsible sections, group boxes, button labels, field placeholders, dropdown
options and table headers. Read that page's entry before writing it, and run
`geoidQtAudit()` (`services/qt-audit.js`, in the browser) after. The baseline
when the audit was built was 19% — 642 missing of 788; it is now **98%**, 17
missing, 32 of 38 pages exact.

That came from `spec-page.js`, not from rewriting pages. `completeAllPages()`
wraps every page after the hand-written modules register: the page runs and
keeps what it does, then anything in the spec it did not render is appended in
an "Also in the desktop app" section — **disabled, titled with why, bucketed by
its Qt tab**. Never make those look live. A page that scores 100% may still do
almost nothing; the audit measures inventory, never behaviour, and the honest
signal is the disabled control rather than the percentage.

**`tabbedPanel` keeps every panel in the DOM**, hidden rather than rebuilt.
It used to rebuild on switch, so anything wanting to know what a page contains
had to *click* through the tabs — and a tab whose handler does more than switch
a view then fired that side effect. The Build New wizard's phase strip
navigates, so scraping it rendered the wizard three times over. Nothing clicks
to scrape any more; do not reintroduce it.

**Measure page height at 1920x1080, not in the harness's default window.**
The preview iframe is ~966x705, which is far narrower than any real screen; the
grid gives two columns there and four at 1920, so a page that "scrolls" in the
harness usually does not on a desktop. Quote the number with the size it was
measured at.

**Two layout changes were tried and reverted, both worse:** letting a tabbed
panel flow into a column instead of spanning (the tab strip wrapped and every
field stacked, taking Post Processing from 1.28 screens to 2.16), and a 21rem
column floor (five columns of ~350px, too narrow to read a labelled input in).

**Nothing may be cut, and the width must be used.** Two faults with one cause:
every child of a flex column could shrink below its own content, so a section
that did not fit was *clipped* rather than scrolled — thirteen pages, Signal
Processing losing 623px of its Event Correlation toolkit and every Ingest page
95px of its registry. Qt does not do this: a widget gets its sizeHint and only a
widget given a stretch factor absorbs what is spare. So in a `.qt-v` nothing
shrinks except `.qt-grow` and the scrolling boxes, and those **scroll rather
than clip**.

At 1200px and up a tree-rendered page becomes **two columns**, with the primary
surfaces — tab widgets, splitters, tables, toolbars, anything Qt gave a stretch
factor — spanning both, because halving those is what made the earlier attempt
worse. Fields stop at 42rem; an empty table states its shape in 8rem.

**Qt size policies are the layout, and getting them wrong looks like bad
design.** A QPlainTextEdit, table, tree, list or scroll area is **Expanding**:
the log pane at the foot of a page *is* the rest of the page. Rendering them at
content height left the average page filling **49%** of its height, GIS Explorer
5% — which reads as sloppy formatting and is actually a modelling error. A
QTabWidget by contrast is **Preferred**: it takes its size hint and yields the
leftover to whatever wants it, so it fills only when nothing else on the page
does (`packRoot()`). Average fill is now **99%**, with no page under 50%.

**The root layout must stay a flex column.** An earlier pass made it a
two-column grid, and `flex` means nothing to a grid item — the grid was actively
preventing the size policies above from working. Density now comes from
`packRoot()`, which wraps runs of **adjacent** short panels into a two-up block:
nothing moves past anything else, so a page still reads in the app's order, and
a card holding a tab strip, splitter, table, list or scroll area keeps the full
width because it is the page's main surface. A card whose only expanding widget
is a text pane still pairs — excluding those put the Ingest pages back into one
column.

**Learn the app's own widget classes, don't list them.** `CodeEditor` is a
QPlainTextEdit, `ToolInfoButton` a QPushButton, `PlotlyViewer` a QWidget.
`custom_widgets()` derives them from their bases (page classes excluded) and
records the Qt class each extends, so the renderer draws a custom widget as its
base and expands it if the base expands. Module Builder's Editor tab was an
empty 20px box purely because its only child was a `CodeEditor`.

**A ToolInfoButton's first argument is the tool's name, not its label** — the
class always calls `super().__init__("ⓘ")`. Taking it as the text painted
"Correlation Matrix" across a 20px icon. The second argument resolves against
the app's `*_INFO` dict literals, so the button shows the requirements it exists
for.

**Fields stop at a readable measure**, and it is the form's *field column* that
is capped, not just the form: a 58rem form still put a 780px ruler behind eight
characters of "Target directory". Forty fields across 34 pages were over 700px
wide; now none is.

**Three labels are never rendered** — "Embedded map requires PySide6-WebEngine",
"matplotlib not available", "rasterio not installed". Each is false here: the
map is a canvas, the plots are canvases, the rasters go through geotiff.js.

**The control metric.** `--ctl: 30px` on `#research-hub`: every `.button` and
every `.input` (bar textareas) is exactly that tall, so toolbars centre on one
line by construction. Before it existed one page held four control heights —
21, 28, 30, 32 — and nothing reads as "messy" faster than controls that almost
line up. Icon affordances (ⓘ, ↑↓✕, tabs) and tree rows are not inline controls
and keep their own size. A CollapsibleSection is **full width, always** —
closed it is a bar, open the bar is the lid of a contained panel. Tables are
boxes with a lid. A multi-line field takes its own grid row. The status line is
the page's last word — `completedMount` moves it to the foot.

**Chromium mis-sizes auto grid rows for these children.** With the auto-fill
grid, the rows holding repo-tree and every open CollapsibleSection came out at
roughly their first line (~36-53px) while the items were 95-384px tall, and
sections painted over each other — grid items that all span `1 / -1` are not
supposed to be able to overlap at all. The identical DOM under a flex column
has zero overlaps; the hand-built pages are flex columns now, children
`flex: 0 0 auto` (a closed bar was otherwise squeezed to 10px of its 34), and
an open `.qt-grow` section keeps an 11rem working minimum with the page root
scrolling instead. If sibling overlap ever appears again, suspect the container
before the children.

**When measuring for clipping, check whether an ancestor scrolls.** A box whose
own overflow is visible but whose parent scrolls has lost nothing; counting it
as clipped chases a fault that is not there.

**A grid item with `overflow: hidden` has an automatic minimum size of ZERO**,
so its row may be shorter than its content. That is how an *open*
CollapsibleSection still lost 399px inside an otherwise fixed page, after the
flex-shrink fix. `.qt-section[open]` overflows visibly, which restores the
content-based minimum. Measured at 1920x1080: 50 of 53 pages two-column, **zero
clipping**, one page scrolling and that one honestly.

**The page area is a grid, not a stack.** `.research-page` flows its cards into
`minmax(25rem, 1fr)` columns with `align-items: start`, and the wide items
(header, toolbar, splitter, big tabbed cards, `research-grid-2`) span. Stacking
made every page taller than the window while the width went unused; at 1920px
this puts 60 of 63 pages on one screen. 25rem is deliberate — 21rem gave five
columns of ~350px and a labelled input is unreadable in one.

**Nothing says "also in the desktop app".** The spec's controls are part of the
page: actions join the toolbar under the header, inputs go into the group card
they belong to, tabbed groups become tabs. There is no elsewhere for a feature
to live, and framing them as a separate list read as though the hub were a
preview of something else. The only remaining mentions of the desktop app are
statements of fact about shared file formats (`experiments.jsonl`,
`pipeline.json`, the project layout), which are worth keeping.

**A page that shows one step at a time sets `mount.specComplete = true`.**
The completion finds only the visible controls, so without the flag it appends a
disabled duplicate of every button on the steps that are not showing. Build New,
Notebook, Projects and QA/QC carry it. The cost is honest and worth naming: the
audit can only see what the DOM shows, so a stacked wizard reads as ~3 points of
"missing" that are not missing at all.

**A page-specific handler beats a pattern, which is a trap as well as a
feature.** A stub for Research Notes' H1 — "Select text in the editor first.",
which inserted nothing — shadowed the working markdown pattern on the one page
whose entire toolbar is those buttons. And half the pattern's labels were
guessed: the app says "Timestamp", "</>" and "•", not "Time Stamp", "Code" and
"Bullets". Neither was visible until the extractor started following the loop
that builds that toolbar. **Click the buttons; counting them finds neither.**

**Verify an analysis against an answer you planted.** Compute, Detect Events
and Fit were checked on a CSV holding a 4 Hz unit sine, two rectangular bursts
at 3.00–3.40 s and 7.00–7.60 s, and `y = 3t + 7`: the spectrum peaks at
4.0039 Hz (a quarter of a bin) with amplitude 0.999, which also confirms the
window-gain correction; detection returns exactly those two intervals; the fit
returns p1 = 2.999999999999995 and p0 = 7.000000000000021 with R² = 1. A first
attempt used one column carrying both the sine *and* the bursts and the peak
came back at 0.49 Hz — correct for that signal, since 3.0 bursts dwarf a 0.2
sine, and useless as a test. Plant the answer in a column that isolates it.

**Those pages need Browse to fill their column combos.** The tree renders
`_time_col`, `_signal_col`, `_x_col` and `_y_col` empty because the Qt page
fills them from a file header after its own dialog. Without that the analysis
handlers fall back to the project's first table and first numeric column —
which runs, and analyses whatever happened to be there.

Behaviour goes in `wiring.js`. Three hundred-odd controls are not three hundred
behaviours: the app reuses the same verbs everywhere, so `wirePattern(/^Refresh$/, fn)`
wires them once by label across every page, and `wire(pageId, handlers)` covers
the ones that genuinely differ — a page-specific handler always wins.

**The Event Correlation Toolkit is native.** `event-correlation.js` ports
`scripts/thesis/comprehensive_signal_analysis_complete.py` — the peaks loader,
the synchronous-event clustering, the three candidate scorings, cumulative
metrics, dataset comparison, station summaries, contamination and a Morlet CWT.
Ported **against that file, not from memory**, and its constants are kept
verbatim (`SYNC_TOLERANCE_SEC` 300, `MIN_STATIONS` 2, `MIN_CORRELATION` 0.2,
`MIN_SNR_LINEAR` 3.16, and the 0.50/0.50, 0.25/0.25/0.50, 0.35/0.35/0.30
weightings). If that script changes these must change with it, or the two apps
will disagree about which candidate is best — worse than not having it.

Two details that look like tidying and are not: peaks inside a *discarded* sync
window are consumed rather than returned to the pool (the `-999` marker), and
pywt is absent so the CWT is convolved directly with pywt's `morl` centre
frequency of 0.8125.

Only **four** controls remain disabled, and they are a group: Run Function, Run
Script Main and Stop External Run are the external script runner — it exists to
execute arbitrary Python a user points it at, the one thing a browser tab
genuinely cannot do — and AI Outline needs a model.

**Two shape assumptions cost a whole debugging pass, both caught by running the
code rather than reading it.** `parseTable` returns each row as an **array**,
not an object keyed by column, so every `row.peak_corr` was undefined and eight
analyses reported "no readable rows" from files they had just read. And
`findTables()` lists the known data folders **without walking into them**, while
a peaks tree is `data/raw/<dataset>/<station>/<sim>/…` — the plotting buttons
called the project empty while the loaders beside them were reading those files.

**A transform must pick its series, and refuse a series too short.** Taking the
first table found meant transforming whichever analysis CSV had just been
written — a spectrogram of an 11-row ranking, saved with **zero frames** and
reported as a success. Taking the longest column then meant transforming `t`, a
monotonic ramp. Ignore `analysis/` outputs, skip time/index/rank columns unless
nothing else exists, and refuse below 64 points for a spectrogram or 32 for a
wavelet.

**A `redraw()` eats the message the handler just wrote.** `redraw()` empties
the host and mounts again, building a *new* status node, so `say()` wrote to the
orphaned old one — in both orderings (`redraw(); say()` and `say(); redraw()`).
Every Refresh, every Import Files and every Add reported success into a node
that was no longer on the page. `persistentStatus(host, pageId)` in
`pages/common.js` writes to whichever status node is currently mounted and
parks the text on the host, which survives `textContent = ""`. **There are three
mount paths and they all need it** — fixing only `spec-page.js` left all 53
tree-rendered pages silent, because those come from `qt-render.js`. The nine
hand-built pages build their own status node during an async remount, so the
message is re-applied 300 ms later into a node that is still empty.

**Clicking every button is the only way to find a dead one, and most "dead"
buttons are not.** A full pass over all 64 pages produced 281 silent controls;
classified, 75 were tab switches, ~50 file dialogs (a cancelled picker correctly
does nothing), 11 info popovers, and most of the rest were the redraw bug above.
Exactly six were genuinely inert. Judge silence by whether the DOM, the project
or a `hidden` attribute changed — not by the absence of a status line, and never
by reading the code alone.

**The Draw tool takes a size as well as a shape.** Clicking out a polygon is
right when the shape matters and wrong when it does not — "sample 10 km around
this volcano" is a size, and drawing it by hand gives an approximate box with a
made-up area. `gis/draw-area.js` builds the polygon from a width and a height in
km, centred on the view or on typed coordinates, and hands it to the viewer's
**own** `activateStudyArea` through `setStudyAreaPolygon`. That routing is the
point: a box and a hand-drawn area are then the same object — same overlay, same
stats, same `getExtractionGeometry` — where a second geometry would have to be
taught each of those separately. Edges longer than 1° are subdivided, per the
chord-sag rule above.

The width is exact **at the centre latitude and only there**: a lat/lon box is
not a rectangle on a sphere, and its north edge is shorter on the ground than
its south edge. That is what every GIS means by a bounding box, and the test
pins it rather than letting someone "fix" it into a claim the geometry cannot
support.

**Centre the box on the sub-camera point, not on a middle-pixel raycast.** The
globe does not sit at the centre of the canvas — the panels take the left of it
— so that ray misses and returns nothing at the default view. Measured: null.
The hemisphere locator has always called the sub-camera point "Center", so
`getViewCentreLatLon` returns *that*, from the same function, and the box lands
where the readout says you are.

**`sphericalPolygonAreaKm2` summed interior angles, and diverged with vertex
count.** The formula — Σ(interior angles) − (n−2)π — is right on paper and
unusable in practice: subdividing an edge drives every angle toward π, so the
result becomes the difference of two large, nearly equal numbers. Measured on
one 300 km box: **89,806 km² at four vertices, then 58,939 / 96,124 / 113,026 at
twelve, twenty-four and forty-four**, and 2.2× over on a 40°×40° box at 160
vertices. Every hand-drawn area with more than a handful of points was quoted
wrongly, silently, in the readout, the saved study area and the extraction
summary. It is now the line-integral form in `gis/geo-utils.js` — exact against
the closed form and **identical at 4, 12, 24, 44 and 108 vertices** — with
earth-viewer importing it rather than keeping a second copy, which is the same
mistake the zoom floor made. `geo-utils.test.mjs` pins subdivision invariance,
the hemisphere, and the antimeridian taking the short way round.

**The GIS controls are on every world, and three things had to be true for
that.** The shell carried an **empty** `#analysis-tools-host`: `toolbox.js`
moves `#gis-analysis-section` into it, and that section only ever existed on the
Earth page — so the Draw box and the extraction did not exist on any planet.
The panel now lives in `gis/shell.html`. Each viewer's seam gained
`get/setZoomAltitudeMetres` (measured from `controls.target`), and the five
**rocky** bodies also `setStudyAreaPolygon`, `getViewCentreLatLon` and the
extraction helpers. The four gas giants have no `activateStudyArea` and no
surface to draw on, so they take zoom only — that is a fact about the bodies,
not a gap.

**Only the Earth page marked itself as framed.** `is-embedded` comes from a
one-line inline script, and it lived in Earth's index.html alone — so every
`body.is-embedded` rule was dead on the nine planet pages, which are standalone
pages that are ALSO framed by the GeoHUB GUI. Framed, they now drop the Planet
Explorer wordmark and Return Home (the shell provides both) and move rotation
and freeze into the space Return Home had, which is where Earth puts them.
Hiding the wordmark is also what lifts the Atlas mark and the tool rail:
`placeLauncher` yields to whatever occupies that corner, and the wordmark was
pushing them from 16/78 down to 85/147. The rules live in `gis/shell.css` — the
one stylesheet every planet page loads and Earth's does not — because nine
per-planet copies would drift the first time one was edited. The marker has to
stay inline in each page: nothing loaded as a module runs early enough to avoid
a flash of the standalone layout.

**The rail label is per page.** Renaming Area → Draw on the Earth page left all
nine planets saying "Area", because each has its own copy of that markup. The
internal `measureMode` is still `"area"` everywhere — it is threaded through the
project schema and `getExtractionGeometry`.

**The planet viewers have no eased zoom target**, so `targetMetres` is null
there and the pill compounds on the *achieved* altitude. On Earth that would
collapse the travel rate to the easing rate; with nothing to lag behind it is
exact, and a held arrow issues a small step every frame, which is the glide.
Verified: Mars 8,881 → 530 km, Jupiter 194,557 → 28,401 km, Pluto 3,114 → 44 km.

**The zoom pill is not gated on `isEarth()`.** `installZoomBar` already refuses
to mount when the seam cannot answer the zoom questions, which is a truer test
than a hard-coded body.

**A kilometre is not a degree anywhere except Earth.** The preset box had
Earth's 111.32 km/degree hard-coded, so a 200 km box on Mars came out 106 km
across and reported 11,296 km² against the 40,000 asked for — exactly
(R⊕/R♂)² out. The radius is a parameter now, carried on every seam as
`bodyRadiusKm`. Verified after: Mars 39,994 km² for a 200 km box, Pluto
9,997 km² for a 100 km one.

**Jupiter, Uranus and Neptune all defined `MARS_MEAN_RADIUS_KM = 58232` —
Saturn's.** The gas viewers were cloned from Saturn's and the constant kept its
value along with its (Mars-lineage) name; Jupiter's own comment beside it said
69911. Every kilometre those three reported was scaled by it: distances, polygon
areas, and now the zoom readout. **Saturn's copy was correct, which is why it
went unnoticed.** Corrected to the IAU means (69911 / 25362 / 24622). The name
is still `MARS_MEAN_RADIUS_KM` on all four — renaming it touches eight call
sites per file for no behaviour.

**`stamp.py` does not sweep `planet_explorer/**/*.js`, and must not.** Those
files carry **epoch-second** stamps (`?v=1773813890`) from a different tooling
convention; the sweep's 8-digit regex matches the first eight and leaves the
rest, mangling 21 of them. That is why the corrected polygon-area formula is
written out again in each planet viewer rather than imported from `geo-utils` —
a cross-tree import would need a stamp, and a stale one is a second instance of
the module. If the formula changes, change it in both; `geo-utils.test.mjs` is
what proves it.

**The zoom bands are absolute altitudes, so they read Earth-ish on other
worlds.** "Global" begins at 8,000 km everywhere, which is right for Earth and
early for Jupiter, whose radius is 69,911 km. Coarse enough to be usable, worth
scaling by body radius if it ever grates.

**Picking up the Draw tool opens the panel that completes it.** The box and the
extraction sat two collapsed `<details>` deep — Extraction & Analysis, then
Extract From Layers — so from the tool there was no sign either existed, and it
was reported, fairly, as "no square preset option". The tool is on the rail and
its settings are in the sidebar; something has to connect them. Square is the
default shape and takes one number, because most study areas are one.

**A measure marker's lift is an altitude, and an altitude parallaxes.** The lift
was a flat `0.012` — **23.9 km above the ground**. Looking straight down that
costs nothing, which is why it survived: from orbit the marker sits 0.2 px from
the point it marks. Obliquely and close in it is ruinous — measured at 4 km
altitude, clicks across the canvas put the marker **235, 248 and 334 px** from
where they were made. It is now a fixed fraction of the distance to the surface,
so the parallax is a constant small angle at every scale, with the old value as
the ceiling so the far field is unchanged. The Mars mosaic branch already did
exactly this. `measureSurfaceRadius` also read the terrain slider **raw** while
the globe is drawn with `getEffectiveTerrainRelief()` — the tapered value — so
points landed on terrain the viewer had already flattened.

**Clicks are still not exact off-centre, and here is why.** After both fixes,
measured marker-versus-click: **0 px dead centre at every altitude**, 4.5–7 px
from orbit, but 24–45 px at 4 km and 94–177 px at 150 km near the edges of the
view. The cause is `refineMeasureHitLocalPoint`: the raycast meets an
**undisplaced sphere**, so its direction is not the direction of the terrain on
screen, and the refinement then corrects only the *radius* — moving the point
along its own radius can never recover a wrong direction. The signature is a
radial spread from the middle of the view that grows with obliquity, which is
what the numbers show.

A ray-march against the DEM was written and **reverted**: it measured 0 px at
4 km and 150 km on one run and 14–155 px on the next. The relief taper moves the
ground as drape tiles arrive, so the surface being solved against changes
underneath the solver, and an unconverged walk lands worse than where it began.
Fixing this properly means raycasting geometry that is actually displaced —
not iterating against a moving sampler. Do not retry the march alone.

**Extraction spans every active layer, including GEE drapes.** A drape is a
*picture* of data, so `gee.js` registered layers with no sampler and rainfall
could not be extracted at all. The cache manifest records how the picture was
made — palette stops plus legend min/max/unit — and Earth Engine ramps a single
band linearly between those, so `gis/gee-sample.js` inverts it. Measured round
trip: CHIRPS 0–300 mm to within **1.18 mm**, a five-stop LST palette to within
**0.14 °C**.

Two rules keep that from being a lie, and both are load-bearing:

- **A colour further than 60 from the ramp is not a reading.** The nearest ramp
  colour always exists, so without a distance test every pixel returns a
  confident number — ocean under a rainfall layer becomes millimetres.
- **No legend, no inverse.** The sampler then returns the colour *as* a colour
  and the source list says "colour only", rather than inventing a scale.

The column carries the unit (`Rainfall_CHIRPS_mm`) and the list says the value
was read from the palette, because it is a few percent off the source band and
must never pass as the archive. Verified end to end: a 300 km box over the Congo
basin yields one table of lat, lon, elevation, slope, geology, the modelled
climate group and `Rainfall_CHIRPS_mm` at 135–148 mm.

**`geoid_model_*` columns are models, not observations** — a cosine of latitude
with a 6.5 K/km lapse rate, and the barometric formula. They are worth having
and they now sit beside columns that *are* readings, so the prefix and the
checkbox label both say what they are.

**There was a second extraction dialog, and it was half-dead.** `gis-extract-step`
and `gis-extract-run` existed twice — in the sidebar panel and in that dialog.
`getElementById` returns the first in the document, so the dialog's own Run
button and step field did nothing while its handler had silently bound itself to
the **panel's** button: one click ran the panel's extraction *and* downloaded the
dialog's CSV. The panel does strictly more, so the dialog is gone along with the
two functions whose only caller it was, and its Extract buttons open the panel.

**The study-area drape is how the globe gets real resolution.**
`gis/basemap-drape.js` fetches XYZ tiles for the open project's study area,
composites them into one canvas and drapes it as an ordinary derived layer
(`addDerivedLayer`, ext `tiles`), which is what gives it the layer list,
opacity, visibility, removal and the draw-order stack for nothing. Measured over
Etna: 90 tiles at zoom 13, 15.1 m/px, against a basemap of ~8 km/px.

Two things make it cheap, and both are easy to get wrong:

- **No reprojection.** The mesh's rows are spaced evenly in *Mercator y* and
  their latitudes come from the inverse projection, so the plane's default UVs
  line up with a Mercator canvas exactly and not one pixel is resampled. Verified
  on the interior rows, not just the corners — corners agree under either
  convention, which is what makes this failure silent. The two conventions
  differ by 17 m on the ground over a 0.3° box.
- **The geo group already holds the spin**, so vertices go in the baseline frame
  `surfacePoint` answers in, with no half-turn to bake in. That is the opposite
  of the GEE drapes, which parent to the globe mesh and must bake it. Getting
  this backwards puts the imagery half a world away.

Everything the GEE drapes learnt still applies: `surfacePoint` not
`radius + offset`, no depth test against displaced terrain, single-sided so that
is safe, recomputed bounding sphere so the patch is not culled.

**A basemap is not a layer, and the difference is reprojection.**
`registerBaseLayer()` on the viewer seam puts a texture into the private
`baseLayers`/`layerTextures` pair, which is the only way into the Basemap
dropdown; re-registering an id swaps the texture in place, so a basemap can be
refreshed without the selection changing. But the sphere's UVs are **linear in
latitude**, so a Web Mercator composite must be resampled row by row
(`toEquirectangular`) or every coastline slides polewards — at 60°N the Mercator
row is 1190 where the linear one is 341. The *drape* path deliberately avoids
this by spacing its mesh rows in Mercator instead; do not copy one path's
approach into the other. Beyond ±85.05° Mercator has nothing, so those rows
repeat the edge — a stretched cap reads as a pole, where transparency shows the
sphere's fallback colour as a bright ring.

**A basemap cannot carry its own credit.** A drape burns the licence line into
the image, which is right when there is no corner to put it in; reprojected, the
bottom of a texture is the south pole, so the same trick would hide it exactly
where it must not be. The basemap path shows it in the panel and tracks the
**dropdown**, not the button that installed it — hooking it to the button left
the credit gone whenever the layer was re-selected later.

**Resolution refines with zoom, in two tiers.** The basemap texture is one
image at one resolution (global 9.8 km/px); a second tier fetches a patch for
the *visible* extent at the zoom that extent deserves and replaces it whenever
the view settles somewhere new. Measured end to end: OpenStreetMap chosen from
the dropdown gives 256 tiles at zoom 4 (10 km/px), flying in drops the camera to
235 km, and settling produces `Detail at zoom 8 (564 m/px)` — an 18x
improvement, unattended.

Three things keep that from being a bulk downloader, and each is load-bearing:
it fires on **rest** (`onViewSettled`), never per frame, so a drag issues one
round of tiles at the end rather than thousands on the way; `viewChangedEnough`
gates on a real change by **scale or position**, since a view can shift without
resizing and shrink without moving; and nothing happens above ~2000 km or below
zoom 4, which the base texture already covers.

**The refine patch parents to the globe mesh, not the imported-layers group.**
`import-manager` creates `GeoID-ImportedGeoLayers` lazily on the first import,
so in a session with no imports it does not exist — the patch had nowhere to go,
`refineOnce` returned null silently, and the status sat on "Refining to zoom 7…"
forever while the tiles had actually arrived in 243 ms. The globe mesh is always
there. The cost is its half turn, so `buildMesh` takes a `frame` — `"geo"` for
the baseline frame the geo group wants, `"globe"` for the π-baked one.

**`hasDrape()` decides the zoom floor, so it must count every kind of close-range
imagery.** Counting only registered `tiles` *layers* meant a tile **basemap**
did not unlock the closer floor, and flying in still stopped at 995 km — detail
was being fetched that nobody could get close enough to see. A tile basemap and
a live refine patch both count. It must still NOT be conditioned on layer
*visibility*: keying it on `visible` made switching a layer off move the camera,
measured at 71% of the frame's pixels.

**The Basemap dropdown lists the services before any is used.** They used to be
created by `installBaseLayer`, i.e. on first use, so the dropdown offered them
only *after* someone had found the panel and pressed a button — reported, fairly,
as "no sign of street view in the basemaps dropdown". `registerBaseLayer` takes
an optional texture so an entry can be listed unfetched, and
`watchBaseLayerSelection` loads on selection. Two traps there: the viewer's own
change listener is registered first and has **already** blanked the sphere by the
time ours runs, so holding the old map on screen needs a re-**dispatch**, not
just resetting `.value`; and both the listing and the watcher must be retried
from `initWhenReady`, because `buildPanel` runs its body once and the viewer
boots async — retrying only the panel gave the options a second chance and the
watcher none, which left choosing a service showing bare ground.

**Show the tiles as they arrive, not after.** Measured on a 90-tile patch: the
first tile lands at 122 ms and the last at 1524 ms, and nothing was drawn until
the last one — the imagery existed for 1.4 s before it could be seen, then
popped. The composite canvas is therefore **not** given a backdrop: unfetched
tiles stay transparent so the globe shows through, which is what makes it safe
to hang the mesh up front and re-upload the texture as tiles land. With the
settle cut to 250 ms, stop-to-first-detail went from about 2 s to **119 ms**.
The previous patch is dropped only when the new one completes, so the new draws
over the old and the old shows through the gaps until they close.

A tile cache of our own is **not** needed: the browser's HTTP cache already
returns a repeated 90-tile view in 11 ms against 1524 ms cold.

**The streamer is ported, as architecture rather than mechanism.**
`gis/tile-streamer.js` takes what the Mars fork arrived at
(`flight_sim/mars/viewer/STREAMING-DESIGN.md`): rings painted coarsest-first
into one canvas, a single scheduler over one in-flight budget, an LRU cache of
*decoded* images with request coalescing, the coarse-under-fine paint guard,
retire-don't-abort, and an ancestor fallback floor of target−4.

Two of that doc's section 5 traps are honoured rather than rediscovered, and
both are load-bearing:

- **No per-tile mesh quadtree.** It "drowned the old fork". Tiles composite into
  a canvas and the canvas is one texture on one mesh — the visual result of a
  quadtree at a fraction of the cost.
- **A shared fetch is never cancellable by one caller.** Two rings routinely
  want the same tile, so retiring stops *scheduling* and aborts nothing; a
  superseded pass leaves its work in the cache for the next one.

Deliberately **not** ported: ship-anchored windows, speed-scaled spans, heading
prefetch. An orbit camera has no heading and stops between moves.

Measured on a 205-tile, zoom-15 target: first paint at level 12 in **92 ms**,
level 13 at 141 ms, level 14 at 274 ms, the target at 1396 ms, all of it at
2421 ms — a cascade where there used to be a cliff. Revisiting the same ground:
**3 ms, 205 of 205 from cache, nothing requested.**

Honest limits that remain, and the doc predicts them: full sharpness still takes
seconds on a fresh region, because 15 tiles/s is the roof on this transport; and
nothing is fetched during motion, which is a tile-policy choice rather than a
technical one.

**Sampling rays across the viewport asks for the horizon, not the view.**
`visibleBounds` raycasts a grid through the screen, which is right from orbit
and wrong low down: the rays near the top graze the horizon. Measured at 2.78 km
altitude, where the view is 2.3 km across, the box came out **28 km wide —
twelve times too big**. Two consequences, and the second is the one people
report:

- the zoom chosen for that box is far coarser than the view deserves — 10 m/px
  where 0.8 m/px was available;
- the box is set by the horizon rather than by altitude, so zooming **in** barely
  changes it, `viewChangedEnough` concludes nothing happened, and no tiles are
  fetched at all. Zooming **out** does change it, so tiles arrive then — which
  presents as "I have to zoom out for new tiles to stream in".

`clampToForeground` intersects the raycast box with what the camera can actually
see: distance to the surface along the **centre** ray times the field of view,
×1.6 for a ring of context so a small pan does not immediately need new tiles.
Measured after: 2 m/px at 1.79 km, up from 10 m/px. High up the geometric span
exceeds the raycast box and the clamp does nothing — at the default 16,694 km
view it would allow 22,127 km against a 13,681 km box — so the far field is
untouched by construction rather than by a special case.

`visibleBounds` returns **null** when fewer than three rays hit, which happens at
extreme zoom-out where the globe subtends almost nothing. Pre-existing, and every
caller already guards it; do not treat it as a failure.

**Drag speed is an angle at the planet's centre, so it must be scaled by
altitude or it is unusable up close.** OrbitControls turns `2π × rotateSpeed`
radians per screen-height drag; the ground that covers is fixed however low you
are. At the old near-ground floor of 0.012 a full drag swept 4.3° — about
480 km — while the view from 1.8 km up is roughly 1 km across. Four hundred
screens per drag, which is arithmetic rather than taste. The rate is now capped
by the angle subtending the *visible ground*, and damping rises the same way,
because inertia that is pleasant from orbit overshoots what you were centring
when a screen is a kilometre wide. Measured with the same drag: 0.73 screens per
half-drag high up (unchanged), 0.35 down at 1.8 km, against ~480 before.

The cap is **faded in on descent, not applied throughout** — held everywhere it
also slows the far field fivefold, and up there sweeping most of the planet in
one drag is the point. Above ~300 km the numbers are identical to before.

**Two things wanted different answers from `_controlSurfaceDistance`.** It was
borrowing `_distToMaxSurface`, which carries a floor so the near plane can never
reach zero — and at the zoom floor that floor is exactly what it returns: 0.3 km
while the camera is really 1.9 km up. Scaling the control rates from it made the
drag six times gentler than designed, so the navigation went from jumpy to stuck.
The rates take an unclamped distance above the local ground; the near plane keeps
its floor.

**Zoom moves a target; the render loop closes the distance.** The custom wheel
handler had replaced OrbitControls' dolly and taken its damping with it, writing
`camera.position` outright — so every notch was a discontinuity, and a trackpad,
which sends a burst of small deltas, produced a burst of small jumps. A notch
now sets `zoomTargetSurfaceDistance` and the loop eases toward it **geometrically**
(a constant fraction of the remaining *ratio* per frame, frame-rate corrected):
the same absolute step is imperceptible at 10,000 km and a leap at 2 km, so only
a multiplicative rate reads as one steady glide at every scale. Notches compound
on the target rather than on the camera, or a fast scroll fights its own easing.

**A floor-limited zoom request must stay alive.** Descending lowers the floor —
the relief taper shrinks the terrain as you come in — so a request for "all the
way" is satisfied at whatever the floor was *on the way down* and then forgotten.
Measured twice, from both ends: the request is now stored **unclamped** and only
cleared when the clamped target equals it, and the zoom bar's track ends ask for
0 / max rather than the current floor. One drag now arrives at 1.81 km instead of
stalling at 130 km with the floor settling at 53 km a moment later.

**`gis/zoom-bar.js` is a hold-to-zoom pill in the top-right corner.** A 556 px
track across the map was furniture for a value that is glanced at, not dragged;
it is a 149 px `‹ SITE ›` pill whose arrows zoom **while held** and whose middle
names the scale (Site · Local · Regional · Continental · Global), so the
annotation answers "how far in am I?" without anyone reading a number.

**It sits directly above the scale bar and is exactly as wide as it** — the two
answer the same question, how big is what I am looking at, so they read as one
instrument. Placed and sized from the bar's own measured box, never as
coordinates: `#scale-readout` is `grid-area: scale` inside the bottom HUD and
its width changes with the breakpoint (10.5rem, 7rem, 5rem embedded), so a hard
offset drifts off it at every other size. `box-sizing: border-box`, or the 1px
border puts the two out by two pixels everywhere.

**Matching the bar's width means the label must fit whatever that width is.**
At 660px the bar is 112px and "Continental" needed 86px in a 69px box — simply
cut off. `fitLabel()` steps the type down against the **longest** band name
rather than the current one, so it does not resize as you zoom past Continental,
and only re-measures when the width changes. Below the 0.5rem floor it stops
shrinking text and adds `is-tight`, taking the width back from the arrows'
padding and the label's tracking instead; that buys enough that the type goes
back **up** to 0.7rem and all five names fit.

**`#top-right-controls` is not in the top right**, which is what the first
attempt assumed. Despite the id, `body.is-embedded` sets `left:` and clears
`right:`, so in the shell — the way anyone actually sees this — that cluster is
pinned beside the sidebar: measured at x=412 while `#tool-rail`, the real
top-right furniture, was at x=822. `.map-legend` also lives in that corner
(`top: 1rem; right: 5.5rem`), so it is busier than it looks.

**z-index 12, below every popup.** All ten of the viewer's popups and modals are
siblings of this pill under `body` — one stacking context, so paint order is
purely numeric — and the lowest is `.map-legend` at 13, rising through
`#hover-tooltip` 14, `#scene-popup` 20, `#geo-popup` 22, the modals at 62 and
`#measurement-result-card` at 140. Sitting at 12 puts a description window above
the zoom arrows without depending on DOM order. **Do not hit-test this with
`elementFromPoint`**: `#hover-tooltip` and `#measurement-result-card` are
`pointer-events: none`, so they read as "behind" a control they in fact paint
over, and that reads as a stacking bug that is not there.

**Holding compounds on the pending target, never on the camera.** The camera is
always easing along behind the target, so compounding on where it has *got to*
converges on a fixed lag and the travel rate collapses to the easing rate.
`getZoomAltitudeMetres()` therefore reports `targetMetres` alongside `metres`.
The request is bounded to `LEAD` (2.2×) either side of the camera: at the floor
the camera stops while a held arrow would go on compounding, and without the
bound, releasing left it flying on for seconds into ground it can never reach.

**A frame-delta cap of 0.05 s silently undoes the frame-rate correction it sits
inside.** Both the hold loop and the render loop's zoom easing capped `dt` at
50 ms — shorter than a real frame below 20 fps, so each step advanced a fraction
of its elapsed time and the zoom crawled at a quarter speed. Measured in the
preview at 5 fps: 0.25 e-folds/s against the 1.1 asked for, which reads as a
sticky control rather than as a frame-rate problem. The cap is a **stall** guard
and belongs at 0.25 s, well clear of any real frame; it cannot overshoot,
because the easing exponent saturates at 1 and the hold is bounded by its lead.
Tile streaming is exactly what drops a real machine into that range.
`zoom-bar.test.mjs` simulates 60, 30 and 5 fps and asserts the same 3.2 s.

**Nothing greys out for being close.** `minMetres` is the floor of *this moment*
and descending lowers it, so disabling the zoom-in arrow against it disables the
button at 999 km — where the floor is still 995 km and one more press would have
moved it. Only the ceiling, which nothing lifts, is a real end. Same trap as the
clamped request, wearing a different hat: **any control that asks to go closer
must express the request without the floor in it.** Measured with an OSM
basemap: one unbroken hold runs 6,116 km → 1.8 km while the floor walks down
84.6 km → 1.8 km alongside it, and parks there with no coast on release.

**The terrain slider is the zoom wall, not the floor logic.** It exaggerates
relief roughly tenfold, so at its 0.11 default the ground stands about 219 km
tall in render units — and a camera that may not enter terrain is therefore held
~126 km up however clever the floor is. That is the 50 km scale bar. Measured:
same flight with the slider at zero reaches 1.8 km and the bar reads 500 m, a
hundredfold difference and nothing to do with imagery. `getEffectiveTerrainRelief`
now smoothsteps the exaggeration to nothing below ~300 km, but **only when
close-range imagery is on the globe** — otherwise there is nothing down there to
fly to and the default globe keeps its relief. The CTX mosaic already did the
blunt version by returning 0 outright. It is stable rather than a feedback loop
because the taper keys on altitude above the BASE SPHERE, which does not depend
on relief; descending shrinks the terrain, which lowers the floor, which allows
more descent, converging on the margin. Consequence to remember: a study-area
drape is a static mesh built at one relief, so it does not shrink with the
terrain — the refine patch is rebuilt each settle and does.

**Clamp to the ground under the camera, not the highest ground anywhere.**
`groundRadiusUnderCamera()` samples the displaced surface beneath the camera;
the floor was previously `3.2 + globalMaxRelief + margin`, which assumed Everest
everywhere. Three things had to move together or it clipped instead of
descending: the floor, the near plane (held at 10 km off the global maximum),
and the drape's own lift — 10 km down to 1.2 km, because **a 10 km lift IS a
10 km floor**; the camera cannot get under its own basemap. Safe to shrink
because the drape material does not depth test.

**The globe opens on Sentinel-2 Cloudless, not Esri.** A default is not the
same decision as an option: what every visitor is handed without choosing it
should carry the fewest strings, and Esri's own FAQ conditions every
permission on holding an ArcGIS subscription. Esri stays in the list one
click away, where picking it is a choice somebody made. Verified on a cold
load: the globe settles on Sentinel-2 and **zero** tiles are requested from
`arcgisonline.com`. The cost is real and visible — Sentinel-2 caps at zoom
14 (the sensor's own 10 m) where Esri reaches 19, so full zoom is ~7.5 m/px
rather than 0.3. Measured flying to 120 km: "Detail at zoom 11 (72 m/px)
over 5 levels", nothing requested above 14, because both the drape and the
refine read `source.maxZoom`. Note this default is NonCommercial-licensed;
`NASA VIIRS Daily` is the only unconditional imagery here and is the right
default for a deployment that would rather not make that judgement.

**Two imagery alternatives sit beside Esri, and their licences are not
alike.** `Sentinel-2 Cloudless` (EOX, a cloud-free Copernicus mosaic) is the
nearest thing to Esri's imagery that does not go through Esri — and it is
**CC BY-NC-SA: NonCommercial**, with commercial use sold separately under
EOX's own Attribution-RestrictedUse licence. Only the 2016 edition was
CC BY 4.0 and `s2cloudless-2016` now 404s; the unversioned `s2cloudless_3857`
answers but cannot be shown to BE that edition, so it is not offered wearing
a licence we cannot prove. `NASA VIIRS Daily` (GIBS) is the one imagery layer
with no condition at all — open data, no key, no commercial clause — at the
cost of stopping at zoom 9.

**A server answering is not the same as the sensor having seen it.** EOX
serves s2cloudless to zoom 18; Sentinel-2 is a 10 m instrument and zoom 14
over Etna is already 7.55 m/px. Measured bytes down that ladder — 17,710 at
z10, 8,553 at z12, 5,226 at z14, then 4,863 / 6,017 / 4,257 / 2,143 — fall to
noise rather than carrying detail, so its `maxZoom` is the honest 14. Third
instance of this lesson after RainViewer's placeholder tiles and Earth
Engine's `scale`.

**GIBS dates its daily layers and TODAY is not ready** — measured, 2026-08-27
returned 404 while 2026-08-26 returned a JPEG. `GIBS_DATE` resolves to
yesterday UTC once at module load, so both consumers get a complete template;
teaching two separate `tileUrl` implementations about a `{time}` placeholder
is exactly the drift that file's header warns about. Wall clock, never the
viewer's simulated time: a scrubbed clock pointed at next week would ask for
a photograph nobody has taken. Expect ~208 of 256 tiles at zoom 4 — the gaps
are polar night, where the sensor genuinely saw nothing.

**THE CREDIT AND THE LICENCE MUST NAME THE SAME MAP.** They did not. The
credit line followed `base-layer-select` — what is actually on the globe —
while the licence line followed only the drape tool's own source select
beside it, so choosing a basemap from the catalogue left the two describing
different services. Measured with Sentinel-2 selected: EOX's credit above
OpenStreetMap's "ODbL. Free to use with attribution", which tells a reader
that NonCommercial imagery is free to use commercially. It read as
authoritative precisely because the credit beside it was right. Both now
derive from one `sourceForId`. `tile-sources.test.mjs` pins the whole
discipline — every source attributed, every constrained source explaining its
constraint, and names restricted to characters that slugify cleanly, after
"NASA VIIRS (yesterday)" produced the id `tiles-nasa-viirs-yesterday-`.

**Esri World Imagery is free of charge and not licensed for this.** Its ArcGIS
item record puts it under the **Esri Master License Agreement** and states it is
"not intended for offline tile export" — so no charge and no key on
`server.arcgisonline.com` today, but that is not permission for unrestricted
embedding, and compositing tiles into a canvas that gets saved into a project is
closer to export than to viewing. It stays on the list because looking at it is
fine and it is the best imagery there; the default is OpenStreetMap (ODbL,
unambiguous) and every source carries its `licence` next to the picker. Esri's
supported route is ArcGIS Location Platform with an API key and a metered free
tier. OSM's own servers remain best-effort with no bulk pre-fetching.

**`controls.enableZoom` is false — OrbitControls does not zoom this globe.**
A custom wheel handler does (`handleSurfaceWheelZoom`), which makes
`controls.minDistance` decorative: setting it changes a number nobody enforces.
The floor that matters is `zoomContext.minSurfaceDistance`, and the rule behind
it was written out **twice**, identically — once in the render loop's per-frame
clamp and once inside `getActiveZoomContext`. That duplication is why lowering
the floor in the render loop moved `controls.minDistance` to 3.316 and left the
camera stopping dead at 3.7. Both now call `computeSafeMinDistance()`; if a
third enforcement point ever appears, it must call it too.

A drape lowers the floor, exactly as the CTX mosaic already did: 3.7 (about
1000 km up) is right for an 8 km/px basemap and makes metres-per-pixel imagery
unreachable. Measured through real wheel events: **995 km with no drape,
235 km with one**, and the no-drape case is unchanged. The margin clears the
drape's own 0.005 lift, not just the terrain, so the camera cannot end up
underneath the imagery. `hasDrape()` must NOT be conditioned on layer
*visibility* — keying it on `visible` meant switching the layer off moved the
camera, measured at 71% of the frame's pixels.

`CTX_ZOOM_STEPS` and its four companions at the top of earth-viewer.js are
declared and never read. Dead, and misleading while hunting a zoom clamp.

**`scale` from Earth Engine is the dataset's resolution, not the picture's.**
The panel reported it as though it described what arrived — "Added NASADEM
elevation at 30 m" — while every shipped cache snapshot is 1024 px covering the
whole world, a delivered sample of **39 km per pixel**. Over-claimed by 1305×,
and never noticed because 30 m is a true fact about NASADEM. Measured across the
cache: NASADEM 1305× coarser than native, MCD64A1 78×, the MODIS 1 km products
39×, CHIRPS 8×. `deliveredMetresPerPixel()` computes it from the bounds and the
image, quoted the same way as the tile drape (latitude convergence included) so
the two surfaces can be compared. The client also sends no scale or dimensions
with a request, so the extent is asked for but the resolution is entirely the
service's choice — a small study area gets the same pixel budget as a global one.

**When diffing rendered frames, pause the spin and run a control.** Two frames
taken moments apart differ everywhere because the globe turns with UTC — the
first attempt read 44,859 changed pixels of pure rotation. With
`setSpinPaused(true)` the same comparison gives a noise floor of **0**, and the
drape then shows as 26 pixels in a 6×7 box at the exact centre of the frame,
which is the whole measurement.

**Tile basemaps are attribution-conditional, and the credit is data.** Every
source in `map2d.js` is free *on condition* of a specific credit line, which an
exported PNG then carries into print. Esri's is the `copyrightText` its own
service returns (`.../MapServer?f=json`) — "Esri" alone credits neither Vantor
and Earthstar for the imagery nor the fifteen agencies behind the topo map. The
credit is wrapped rather than truncated, because a truncated licence is not one.
OSM's own tiles are governed by the OSMF Tile Usage Policy: fine for interactive
viewing, but no bulk pre-fetching and no guarantee for a product — a real
deployment self-hosts or buys tiles.

**Wire it or leave it disabled.** A handler that pops a message and does nothing
turns an honest disabled button into a dishonest live one. Where the desktop app
shells out to a native binary or a Python interpreter — Gmsh, GALES, plugin
install, a training script — the control stays disabled, and `CANNOT_WIRE` in
wiring.js records why.

`stats.js` is what "not vendored" should mean in practice: PCA, k-means,
Welch's t, Mann-Whitney, KS and one-way ANOVA are each a short algorithm, so
they are written out rather than shipped as disabled buttons waiting on SciPy.
`stats.test.mjs` checks them **against SciPy's own answers on the same inputs**
— run `python3 -c "from scipy import stats; ..."` to produce a reference before
adding a case. The first draft of that file guessed its expected values from
memory and six of them were wrong while the implementations were exact; the
lesson is that a reference value is a measurement, not a recollection.

The page-class mapping is **derived, not written**: `derive_page_classes()`
joins MainWindow's `self.<attr> = SomePage()` assignments to its
`("Page Name", self.<attr>)` registry. A hand-written table had missed
twenty-five pages — the entire Analysis stage among them, which is why those
pages looked untouched after the first pass.

`pages/projects.js` is the worked example — it mirrors `GeoIDProjectsPage` (app_qt.py:4570) tab for
tab and field for field. Match the Qt page when building a new one; someone who
knows one app should know the other, and that breaks the moment a field moves.
`tabbedPanel` remembers the active tab per heading, because pages re-mount often
and every remount used to throw you back to the first tab.

**Docs & Sheets** (`pages/docs.js`) is the Google workspace, and it has a real
nested window.

**Google does NOT refuse to be framed** — an earlier note here said it did, and
that was wrong. Measured against a public Sheet: `docs.google.com` sends no
`X-Frame-Options` and no `frame-ancestors` in its CSP, and both `/edit` and
`/preview` render in a cross-origin iframe. `/edit` brings the entire editor and
is editable when the browser has a Google session; signed out it degrades to
read-only by itself. `frameUrl()` in `google-credentials.js` maps a pasted URL
to the right embed endpoint (Drive files get `drive.google.com/…/preview`,
published-to-web keeps `embedded=true`).

The link registry lives in the project at `metadata/links.json` in the hub's own
`{docs, sheets}` shape, since there is no Atlas hub to hold it — which keeps the
interchange with the desktop app. Sheets round-trip through the clipboard as
TSV, which is what Sheets natively copies and pastes.

**Credentials: Client ID only, and never in the project.** `google-credentials.js`
stores the OAuth Client ID in `localStorage` — per browser, because a project is
meant to be moved, shared and opened by the desktop app, and a credential is the
person not the study. `save()` **throws** on anything shaped like a client
secret (`GOCSPX-…`, or a bare 24-char token) rather than warning: a secret in a
page served to a browser is a published secret. The browser token flow does not
use one; the redirect-origin allowlist in the Google console is what protects a
public client.

Pages register into `gis/research/stages.js`; the twelve stages mirror the Qt
`base_stage_structure` and must not drift from it. An unregistered page renders
a labelled "not built yet" panel — do not replace that with a plausible-looking
empty form.

## The sidecar

The hub is a static site with no interpreter, so its heavy verbs had nowhere to
run. `sidecar/geoid_sidecar.py` is the second process the job-spec design always
implied — a **stdlib-only** HTTP service (`python3 geoid_sidecar.py`, no pip)
that runs beside a `geoid_projects` folder and lends the browser a subprocess, a
filesystem and a job that outlives one click.

- **Loopback only, token, path sandbox.** Binds 127.0.0.1; CORS limited to
  localhost; every `/fs/*` confined under the projects root; a Bearer token gates
  everything but `/health`. Script execution is deliberately unrestricted — that
  is the feature — but only on an explicit request.
- **SSE over `fetch`, not `EventSource`.** `EventSource` cannot set headers, so
  it would force the token into the URL; `sidecar.js` parses the SSE stream out
  of a `fetch` body so the token stays in an `Authorization` header. The
  memory-note rule "never a secret in a URL" is why.
- **`/fs/*` is the project layout `project-store` speaks.** When connected the
  hub `store.useAdapter(sidecarAdapter())` and reads/writes the SAME folder the
  desktop app uses — no picker, no IndexedDB, no drift. `--root` may be the
  projects parent or the `geoid_projects` folder itself; `_safe()` strips a
  leading `geoid_projects/` when root is already it.
- **Wired at four seams:** Settings ▸ Local Sidecar (connect), AI Trainer's Run
  Training Script + Signal Processing's Run Script Main / Run Function / Stop
  External Run (real jobs, streamed into the page log — `makeRunner` in
  qt-runtime.js), the FEM **Run** page (GALES, below), and the Jobs drawer (live
  processes with Stop). `hub.js` reprobes a sidecar from last session on load.

**GALES runs through the sidecar** — this is the FEM stage's execute step, and
the reason the Model side is real rather than a spec editor. `POST /jobs/gales`
takes `{dir, cmd?, deck?, cores?}`: it runs `cmd` in the run folder as a
streamed job, or — with no `cmd` — builds `mpirun -n N gales <deck>` from the
sole `.in` in the folder (the desktop app's own `atlas_run_gales` form). It
writes a `status.json` beside the deck through a completion hook on the job
(`Runner.start(..., on_finish=)`), lifecycle `running → done|failed|stopped`
with exit code, seconds and a produced-file manifest. The Qt **Run Existing**
page is already a command runner (working dir, command, Run, Log tab), so the
wiring is a `qt-runtime.js` module (`galesRunner`), not a hand-built page —
Browse steps through `fem_runs/`, the command pre-fills from the deck (`run.sh`
if present, else the `mpirun` line), and Run streams into the Log tab via
`runJob`. **Deck generation is wired** — `POST /jobs/gales/prepare` turns a run's
`spec.json` into a runnable, compiled GALES sim by **cloning the reference sim
for its physics and patching in the spec's values**. This beats generating each
family from scratch: fluid's ~30 stabilisation parameters and its
`mueluOptions.xml` come from a real working sim, and only the mesh, time step,
`dim` and materials are overwritten (`_patch_lines`, first-token line rewrite).
`spec.physics` maps to a family (`GALES_FAMILIES`): `fluid`→`fluid_sc`,
`thermal`→`heat_equation`, everything else→`solid_es` (volcano deformation is
the domain). It rewrites the reference's `../../../src` includes to the
`GALES_SRC` symlink, copies the project mesh, runs `gales_mesh.py N` and builds
(`cmake && make`) as one streamed job. Verified across all three families: each
clones the right reference (correct mesh key, fluid's XML), patches setup.txt
(mesh→`mesh_Ncore.txt`, times, dim) and props.txt (solid: rho/E/nu/plane_strain;
fluid: rho/mu/Isothermal_T; heat keeps reference rho/cp/kappa — the web spec has
no heat props). The FEM Run page's "⚙ Generate & build deck" (injected by
`galesRunner`) calls it. The sidecar finds the tree via `--gales`, `$GALES_DIR`,
or the copy beside it (`GeoID_GIS/gales`). The build needs **Trilinos**; the
*generation* is independent of it and is what the sidecar test covers. FSI (two
meshes) still needs manual setup; it falls back to a solid deck.

**A GALES sim is a built executable, not a deck file.** There is **not one
`.in` file in the whole GALES tree** — every reference sim under `sim/` is
`cmake && make` → `executable`, run as `mpirun -n N ./executable`, reading
`setup.txt` and `props.txt` from the working directory. The `gales <deck>.in`
form comes from the desktop app's example command text and matches nothing on
disk; it survives only as a last-resort fallback. So the run path prefers
`./executable`, then `run.sh`, then a `.in`, and when none exists it says
"press Generate & build deck" rather than inventing a command. Getting this
wrong meant a correctly prepared sim could not be run at all.

Consequence for remote solves: **the executable must be built on the machine
that runs it** — one compiled here is bound to this box's MPI and Trilinos. The
remote run therefore rsyncs *sources only* (excluding `executable`, `GALES_SRC`
and the CMake artefacts) and builds on the server against that target's
`gales_dir`. For the same reason the local prepare's build step is **non-fatal**:
the mesh conversion it also does is portable and is what a remote solve needs,
so a machine without Trilinos must still be able to prepare a run destined for
a server.

**Where a solve runs is a choice** — `.compute_targets.json` at the projects
root holds named targets: `local` (mpirun here) or `ssh` (a Hetzner box, a lab
workstation, a cluster login node). `/compute` lists them and probes for a local
mpirun; `/compute/save`, `/compute/delete`, `/compute/test` manage and prove
them. Passing `target` to `/jobs/gales` switches the run remote: it rsyncs the
deck up (`--exclude results/`, so an earlier run's output is never re-uploaded),
solves over ssh, and rsyncs `results/` back — the same streamed job and the same
`status.json`, which gains `where`. The command is **rebuilt for the far side**
(`mpirun -n <ranks> gales <deck>`) unless one was typed, because the local box's
rank count and paths rarely suit the server.

**Keys only, never passwords.** `/compute/save` rejects a `password` field
outright, and every ssh/rsync carries `BatchMode=yes` so a missing key fails in
about a second instead of hanging on a prompt an unattended solve could never
answer. `StrictHostKeyChecking=accept-new` keeps a first connection from
blocking. Setup is `ssh-copy-id user@host`, once.

The FEM Run page's "Where it runs" card (in `galesRunner`) exposes all of it,
and the **ranks box drives the mesh partition too** — prepare converts to
`mesh_<ranks>core.txt`, so a stale rank count partitions the mesh wrongly.
Selecting a server syncs the box, and the save handler must
`dispatchEvent(new Event("change"))` because setting `.value` in code does not.

**`hidden` needs `#research-hub [hidden] { display: none !important }`.** The
attribute is only a UA-level `display:none`, so any author rule setting
`display` (`.research-grid-2 { display: grid }`, the flex rows) outranks it and
a panel built collapsed renders open — which is exactly what happened to the
add-a-server form.

**Post-processing closes the loop** — `POST /jobs/gales/postprocess` reads a
solved run's **binary** results and writes the CSVs the analysis pages consume.
`results/<field>/<timestep>` is a flat `3·N` little-endian float64 array (node i's
displacement at `u[3i:3i+3]`, `N` the mesh node count, confirmed against etna:
6027528 B = 3×251147 doubles). For each probe it finds the nearest mesh node
(coords from `input/mesh_Ncore.txt`, `Node <i> x y z flag` lines) and reads that
node across the timesteps, writing `post_processing/extracted_dofs/<probe>.csv`
(`t, ux, uy, uz, magnitude`) — the long-format the Signal and Spectral pages
already list via `findTables`. Verified against the real etna results (t=0 all
zero, t=1 `uz≈-80`). Probe coordinates are the mesh's own metric frame, not
lat/lon. Wired as "Extract from GALES results" on the Post Processing page,
reusing its probe list. The client-side `extractSeries`/`idwSample` path stays
for long-format CSVs; this is the binary path the browser cannot do.
The GALES box has `mpirun`; the solver binary is `gales` on PATH (the Qt app's
`GALES_BASE_DIR` is `~/gales`).

**A registered page mount is shadowed by the Qt layout tree.**
`completeAllPages()` re-registers every page in the spec, and for any page with
a `qt-layout.json` entry that is not in `KEEP_HANDBUILT` it uses the *tree*
(`qtMount`), discarding whatever a `pages/*.js` module registered. So the FEM
`pages/fem.js` mounts (Setup, Properties, IC/BC, Run Existing) never render —
the tree does. To add behaviour to such a page, wire the tree page in
`qt-runtime.js` (`RUNTIME[pageId]`, which also sets `specComplete`), or, only for
a genuinely stateful tool, add it to `KEEP_HANDBUILT`. Do not "fix" a shadowed
mount by editing the module — edit the runtime or the extractor.

**Testing the sidecar wiring from the harness: `import()` runs in the caller's
realm.** `javascript_tool` executes in the *top* document, but the hub runs in
the viewer **iframe**, and ES module registries are per-realm — so
`await import('…/sidecar.js?v=…')` from the top window gives a *different*
`sidecar` instance than the page uses, and configuring it leaves the page's Run
button reporting "no sidecar". Configure the iframe's instance instead: inject a
`<script type="module">` into the iframe document that imports the same URL and
calls `configure()`/`probe()` there. The store (`w.GeoIDResearch.store`) is the
iframe's, so its adapter can be set from either realm; only the *sidecar
connection state* is realm-bound.
- **Everything degrades cleanly without it.** The run buttons say to start the
  sidecar rather than failing; the browser store backs the project. The static
  deploy is unchanged.

Verified end to end in the browser against a live sidecar: a real training
script ran, streamed its epochs live into the page, wrote `model.json` to disk,
and Stop terminated a long job (SIGTERM, exit -15).

## The Research Hub's look

**Structure** comes from the Qt app; **palette and type** come from the viewers.
Those are two different sources and it matters which one a change is answering
to.

*Palette* is `/styles/viewer-skin.css`, which every viewer already loads, so its
tokens are on the page wherever the hub is: purple-black ground `--skin-bg`,
**magenta `--skin-chrome` = chrome** (frames, headings, active states) and
**cyan `--skin-data` = data** (field labels, readouts, values). The rule the
skin holds throughout, and so does the hub: **glow the chrome, not the data.**
Type is the site's own faces — `"Orbitron"` (served as Audiowide) for display
headings and `"Exo 2"` (Chakra Petch) for everything else, both re-pointed by
viewer-skin.css. Instrument labels are uppercase letterspaced Exo 2, exactly as
the GIS sidebar's section titles are.

This deliberately **inverts** the Atlas design system
(`/home/owen/atlas-ai/.claude/skills/atlas-design-system/SKILL.md`), where cyan
is interactive and magenta is the project thread, and it drops Atlas's Inter +
JetBrains Mono pairing. The viewer wins because the hub sits one click from the
GIS sidebar and looked like a different application beside it. The Qt values
(`THEME` at `app_qt.py:56`, `build_app_stylesheet()` at `:26170`) are kept in a
comment in atlas.css; the desktop app has not changed.

**viewer-skin.css paints `.button` and `.input` with `!important`** — cyan at
rest, white with a cyan bloom on hover, magenta when active. Restating those
colours inside the hub loses silently, so atlas.css gives buttons geometry and
fill only and lets the skin have the colour. Primary and secondary are told
apart by their fill.

**The rail is the third source: the Atlas *hub's* Dock**, not the Qt rail and
not the skin (`hub/frontend/src/components/layout/Dock.tsx`, `.dock-item` and
`.dock-band` in its `global.css`). Each stage is a bordered card carrying its
own capability colour in `--cap`, which drives the border, the hover wash and
the active fill; bands group them with a hairline and a quiet label. **Active is
a solid fill of the cap with dark ink** — which flatly contradicts the
design-system skill's "NEVER a solid fill with dark text". The shipped Dock is
the newer answer and is what was asked for, so it wins; don't "fix" it back.

The cap values reuse the hub's own wherever a stage matches one of its
capabilities (mesh, metrics, earth, settings, briefing, files, agents), so both
products colour the same idea the same way. `RAIL` in `hub.js` holds cap, band, an optional `hidden`
and a 24px stroked icon per stage — presentation, deliberately kept out of
`stages.js`, which stays a straight mirror of the Qt `base_stage_structure`.
The **GIS stage is `hidden`** in RAIL: the header's GIS button already goes to
the globe and the stage held nothing but hand-offs to it. It stays in
`stages.js`, which mirrors the Qt structure — Qt has no header switch, so it
needs the rail entry and this does not.

Band headers are emitted the first time a band appears **walking the stages in
their existing order**; the order is the Qt pipeline's and is never re-sorted to
suit the grouping. Twelve banded stages are taller than most windows, so the
rail fades the edge it continues past (`has-more-above` / `has-more-below`,
`mask-image` on the rail itself so it cannot swallow a click).

The rest of the shell mirrors `WorkspaceShell` (`:3597`): one row carrying the
page tabs, the page filter, the magenta project chip and the five shell actions
(Jobs, Alerts, + New Note, Copilot, Data Shelf). Qt's stage tab bar and stage
caption are both `hide()`n there — the rail says where you are — so they are
absent here too rather than reproduced as dead widgets.

**The Atlas mark is top-right, in the RAIL'S OWN COLUMN, and it does not
move.** It used to step aside for an open workbench — 441 px left, across the
middle of the screen, and back again on close (measured: right 16 to right
457 and home) — and it was dodging something guaranteed never to be there.
`side-panels.place()` puts a workbench LEFT OF THE RAIL, sharing its gap
(`innerWidth - rail.left + 10`), so the rail's column is reserved at every
breakpoint BY CONSTRUCTION, and the mark lives in that column directly above
the rail. Measured at 1394 px with a workbench open: the panel ends at 1331
and the launcher starts at 1340 — it was crossing the screen to avoid a 9 px
gap it was already on the right side of; at 900 px the same numbers are 837
and 846, because both derive from the rail. It is also z-index 900 over the
panel's 12, so it was never at risk of being buried. With the sidestep gone
the clash-with-the-freeze-button branch went too: that existed only to catch
where the sidestep had landed. **Before adding a dodge, check whether the
thing being dodged is already positioned to avoid you.**

What placement still does: clears the hazard readout and the wordmark
VERTICALLY (they really do take that corner on the pages that have them),
pushes the rail down to make room, and drops the panel from the mark. It
writes `top`/`right` only when they change, so the poll leaves no trace when
there is nothing to do. `placeLauncher()` in atlas-assistant.js. The panel drops **from** the mark rather than
rising to it, and takes the height that is left rather than the stylesheet's
bottom-anchored guess — with the hub armed the rail moves down and everything
measured from it follows. It is polled at 500ms rather than hooked to an event,
since arming the hub and switching mode both move the rail without a resize.

**All of it lives in `gis/research/atlas.css`, loaded by `gis/shell.js`.** It
used to be a block in `styles.css` and a second copy in `gis/shell.css`, one for
Earth and one for the planets, and they drifted. Do not put Research Hub rules
back into either file.

The hub rebinds `--text`, `--soft-light`, `--nav-accent` and `--nav-accent-rgb`
on `#research-hub`, which is how sixty-four page modules get the palette without
one of them changing — and why the ember variant and the flight-amber override
reach the hub for free. Two base rules need overriding by name because an
explicit value beats a flex default: `.gis-btn-row .button { flex: 1 }` (which
stretched every button to full width) and `.research-stat`'s inline spans.

**A page must re-mount when a different project is opened** — the Atlas chip
follows the store, and the page behind it used to keep reporting the project
before. `watchProject()` in hub.js keys that on the project's *folder*, not on
every store announcement: `updateMetadata()` also announces, and it fires while
someone is typing into a metadata form.
