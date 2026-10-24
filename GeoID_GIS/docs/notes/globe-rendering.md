# Globe rendering: elevation, camera, drapes, lifts, raycasts, Core View

Working notes moved verbatim from GeoID_GIS/CLAUDE.md (2026-10-17), in their
original order. The index is GeoID_GIS/CLAUDE.md; ask the code graph first
(see there) and read the section here that it points you at.

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
## A raycast meets the sphere, not the terrain drawn on it

The globe's relief is applied in the VERTEX SHADER, and `raycaster.intersectObject`
tests the CPU-side geometry — the undisplaced ball. Every pick therefore resolved
to where the ray crosses radius 3.2, while the ground on screen stands up to
0.008 above it, and at an oblique angle those are different places.

Measured by projecting a known point to screen and asking what is under that
pixel: **median 11.07 km, max 16.71 km**, always displaced the same way. After
refining, **42 m median, 66 m max**.

The fix is a fixed point, not exact geometry: intersect a sphere of the current
radius, read the terrain height where that lands, use it as the next radius.
Two or three rounds converge, because the ground moves far less than the ray.
It belongs in `intersectAnySurface`, which every pick goes through — clicks,
hover, the feature picker and the drawing tools all at once.

And when a probe reports a wild number, suspect the FRAME first: deriving
lat/lon from a `measureGroup` child gave a 6,214 px offset, because that group
carries the globe's spin. Same trap as recovering lat/lon from a vertex.
## The diagonal line was a chord

`subtractPolygons` walks a ring and joins what survives, so where a concave
subject is cut into disjoint lobes they come back joined by a **chord** — a
straight edge through ground that is all one unit. Measured on the Inishowen
clip: unit 3146589, "Proterozoic III quartzite", is one part of 29 vertices
after clipping and left the precedence step as 12 parts and 1,673 vertices
carrying a 25.66 km straight edge, with a near-twin beside it. Clipping alone
never exceeds 9.4 km over this box, which is what placed it. This is also where
the export's self-touching rings come from.

The ground was all still there, so a check for LOST ground let it through. The
shape test is: **a real cut boundary separates covered ground from uncovered.**
Step 22 m off a long edge either way — if the two sides answer the same about
the finer survey, the edge separates nothing and the cut is refused.

Both directions of "the same" matter. Checking only "neither side covered"
caught most of them and left three behind in one feature ("Palaeocene
undifferentiated", 23.64 / 22.17 / 19.78 km) where the finer survey covered
BOTH sides — a chord through ground that should have been removed entirely.

After: worst interior edge **9.4 km**, equal to the clip-only figure, and zero
edges over 10 km. Coverage 100%, north-west quadrant 100%, picker finest-first
on **766 of 766** overlapping cells, run 11.8 s.

**The overlap is now 47.9% of the box.** Every cut that cannot be made safely
keeps its coarse feature whole underneath the fine one, and on a dense mosaic
that is most of them. It costs nothing visually or interactively and it does
double-count ground in a table, an area sum or an export. Three separate faults
have now been worked around rather than fixed, all of them the same missing
piece: a polygon boolean that is correct for concave clippers. That is a
vendored clipper and a dependency decision.
## Furniture that must stay on the ground is turned in ONE block

The selected geology unit's highlight — both parts, the boundary lines
(`selectedGeologyBoundaryGroup`) and the textured shell
(`selectedGeologyOutline.mesh`) — is built from the feature's own lat/lon into
the BASELINE frame and parked on `marsGroup`, which does not spin. Every other
piece of ground-glued furniture is turned in one block each frame: labels, user
pins, `gisBufferGroup`, contacts, structures, the CTX streamer, `measureGroup`.
These two were never added to it. Measured live: globe 7.92851, `_spinDelta`
4.78691, `GeoID-ImportedGeoLayers` 4.78691, the boundary group **0** — so the
outline was right for one frame and the map then turned out from under it.

`_spinDelta` is provably the right angle: `import-manager` sets the geo group
with `geoGroup.rotation.y = globeY - Math.PI`, which is the same expression, so
the two cannot diverge. The shell takes `globe.rotation.y`, being a textured
sphere in the globe's own frame like `geologyGlobe` beside it.

Fixed in both live Earth viewers (`GeoID_GIS/viewer`, `GeoID_Earth/viewer`).

**When a highlight, pin or label drifts, check the per-frame spin block first
and its ANCESTORS second.** This file already records four cases of a high
`renderOrder` being ignored because a Group above it was left at zero; this is
the same mistake in the rotation column.

The OTHER highlight — `GeoID-FeatureOutline` from `gis/feature-popup.js`, the
gold outline on a clicked GIS feature — was measured and is sound: parented to
`GeoID-ImportedGeoLayers`, drift 0 over a rotation, and its vertices sit at
exactly the radius of the layer's own fill (3.26169 against 3.26169, 0 km
apart), so it neither slides nor parallaxes. If a detaching outline is seen
again, note which layer was selected: these two are different objects with
different failure modes.
## A lift is an altitude, and an altitude parallaxes — for the third time

Two outlines floated clear of the surface, in two files, for one reason.

**The drawn polygon.** Its vertices were baked at the layer's own `drape` while
`attachReliefAttributes` recovered their displacement as if the drape were
nought — so the clearance was welded into `aDisp` and the shader could never
remove it. At the default 0.006 that is **11.9 km**. Measured on a drawn study
area over Inishowen: the outline stood **9.68 to 12.83 km** above the ground,
against a clipped map sitting on it at −1.87 to +3.17. Now baked at
`FILL_DRAPE` with the line material `lifted`, so `LINE_DRAPE` decides — about
3 m on the ground, the old 11.9 km only from orbit. After: **−2.27 to +0.88 km**,
the same band as the map it traces, and the two share one edge on screen.

That the comment above the code already claimed "a LineString still takes the
lifted path" while the call passed no `lifted` is the lesson in miniature:
**the bake and the attribute must agree on the drape, or the shader is lied to.**

**The selected unit's outline** (`rebuildSelectedGeologyBoundary`) was raised a
flat 0.0032 — **6.4 km**. It cannot be nought: it keeps the depth test, and a
depth-tested line at zero clearance sinks into the relief between its vertices.
It now takes the same clamped fraction of camera-to-surface distance, floored at
3 m and capped at the old value, computed at build time since the mesh is only
rebuilt on selection.

`feature-popup.js` already records this rule for the GIS highlight, and
`vector-render.js` for fills (`FILL_DRAPE = 0`) and lines. **Before adding any
clearance, convert it: one scene unit is 1,991 km, so 0.001 is two kilometres.**
## The ground moves, so anything pinned to it must be re-placed

The geology card could not be zoomed in on: measured over Inishowen, visible at
80 km and **hidden at 40 km and every altitude below**. The terrain
exaggeration eases off as the camera comes in to land, so the surface DROPS as
you descend — measured, the ground fell from radius 3.2626 to 3.2252, which is
74 km of it. The card's anchor was a world point captured at click time and
kept that radius. Its visibility test asks whether the camera is on the outward
side of the anchor, and once the camera is BELOW a stale anchor the answer is
no, so the card and its dot decided they were over the horizon and hid.

The anchor is now remembered as a **place** — `vectorToLatLon` at click time —
and the point rebuilt each frame by `getReliefPoint`, the same call the ground
itself is made with. Measured after: the ground under the anchor is
55.0163/−6.9852 at 90, 40, 20, 10, 5 and 2 km — identical to four decimals,
**0 km of drift**, with the card shown and titled throughout.

Rescaling the clicked point by the relief ratio instead —
`r = 3.2 + (r_built − 3.2) × (relief_now / relief_built)` — was tried first and
is nearly right: displacement does scale with the exaggeration. It left 2.4 km
of creep between 90 km and 2 km, because it is not the arithmetic the surface
is built with. **Ask the sampler the ground asks.**

Two scopes matter here. `vectorToLatLon` is visible from the click handler and
`getTerrainRelief` / `elevationSampler` are NOT — they are declared inside the
render scope. Reading `getTerrainRelief()` in `openGeoPopup` threw a
ReferenceError that aborted the rest of the function, so every field after that
line went unset and the card showed nothing but the kicker the PREVIOUS click
had left in the DOM. It looked like missing data and was a scope error; the
symptom is a card with a stale heading and no body.

**Two measuring traps met here, both mine, both worth remembering.** Screenshots
from the browser tool are 800×567 while the page is 1205×855 — comparing a tool
click to a CSS rect reports a 267 px error that does not exist. And a reference
point found by a coarse grid search was 5.4 km out, which read as the anchor
drifting 2,800 px at 2 km when it was the reference that was wrong. **Invert
the thing under test onto the ground and compare grounds, never pixels.**
## The ray hits a sphere; the reader is looking at the relief

Geology clicks were landing 20 km from the cursor. Terrain exaggeration is
applied in the **vertex shader**, so the globe's CPU geometry is still a plain
sphere of radius 3.2 while the surface on screen stands at 3.26 — about 120 km
of relief at the default setting. A ray aimed at something visible passes
through the ground the reader can see and reports where it pierced the sphere
underneath.

Raycasting every object under one cursor position showed it plainly:

| object hit | radius | lat/lon it yields |
|---|---|---|
| geology tile mesh | 3.2608 | 54.973 / −9.4016 |
| basemap refine mesh | 3.2602 | 54.9725 / −9.3986 |
| **bare globe mesh** | **3.1998** | **54.9111 / −9.0615** |

The last one is 20.4 km from the first two, and it was the hit the geology pick
and its card were built from.

`intersectAnySurface` had refined its globe hit onto the relief for a while —
which is why `surfaceLatLonAt` agreed with the projection to within 11 m — but
`intersectMarsSurface`, which the geology click handler and the card both go
through, never did. It now calls the same `refineGlobeHitToTerrain`. Measured
after, at four screen positions: **0.1, 3.2, 3.1, 3.1 px** between the click and
the anchor, and that residual is the globe turning during the one-second settle.

**Two traps when measuring this.** A click that hits nothing leaves the previous
card standing, so the "error" is measured against a stale anchor — press Escape
first and check the popup actually opened. And the anchor is placed by the
render loop, so measuring in the same tick as the click reads the old position:
settle a frame or two, or the number is meaningless (this produced a spurious
482 px and a spurious 291 px before I noticed).
## An outline has to follow the ground, not just start on it

Two separate faults make an outline float, and fixing the clearance only fixes
one of them.

**The clearance.** A lift is an altitude and an altitude parallaxes — recorded
above for the drawn polygons, the card's dot and the seal.

**The ground moving.** The terrain exaggeration eases as the camera comes in to
land, so the surface rises and falls a long way while you fly: measured over
Inishowen, the ground radius runs **3.2024 close in to 3.26199 pulled back**,
which is 119 km. Anything built as static geometry keeps the height it was
built at. Measured on the feature highlight — the gold ring on a clicked unit,
global map and clip alike — a ring that traced its unit to within 40 m close in
sat **118.6 km underneath the ground** once the camera pulled back.

The vector layers have always carried the answer: `aDir` and `aDisp` per vertex
and one shared relief uniform, so every vertex is re-placed on the GPU each
frame. The highlight and the viewer's selected-unit boundary now carry the same
two attributes and the same shader, at drape **0**, with `cullFarSide` doing
the work a depth test would otherwise have to do for a line that has no facing.

After: **−1.07 to +0.98 km** at every altitude from 30 km to 2,000 km, against
−118.6 km before. That residual is not a lift — it is the ring crossing ground
of different elevations, multiplied by the exaggeration, measured against a
single reference point.

`GeoID_Earth/viewer` is deliberately left alone: it has no `gis/` modules to
import the shader from, so its outline keeps its clearance rather than sitting
at nought with a depth test that would bury it.

**Where outlines live, and what each is:** fill and seal (drape 0, relief
shader) · the line buffer (lifted, relief shader) · `GeoID-FeatureOutline` from
`gis/feature-popup.js` (drape 0, relief shader now) · the viewer's
`selectedGeologyBoundaryGroup` (drape 0, relief shader now).
## A remembered view names a place ON THE BODY, never a point in the world

"The centre of view/anchor and user navigation is broken on the moon viewer."
Measured: `controls.target` sat **12.06 scene units off the Moon's centre** on a
globe of radius 3.2 — nearly four Moon radii — so drag-to-orbit pivoted around
empty space beside the Moon and swung it across the screen.

**The Moon is the only viewer whose body is not at the world origin.** Earth
holds that seat and the Moon orbits it on `moonOrbitPivot` at
`EARTH_MOON_ORBIT_DIST = 708`, moving every frame; a grep across all nine
planet viewers finds one `OrbitPivot` and one `<body>Group.position.set` away
from the origin, both in the Moon's. So on ten of the eleven worlds "world
space" and "the body's frame" are the same thing, and any code that confuses
them is correct everywhere except here.

Two places confused them, and the boot fault is in a SHARED module:

- **`model-studio.js`'s launch view.** `rememberGlobeView` captures the camera
  and target once and `restoreGlobeView` puts them back on every return to the
  globe — including at boot, through `mode-manager.setMode`. Stored as world
  coordinates, they name a place the Moon has since left.
- **The Moon viewer's own camera flights.** `animateCameraFlight` lerps toward
  world-space endpoints and overwrites BOTH `camera.position` and
  `controls.target` every frame, so the render loop's orbital follow is erased
  for as long as a flight runs and the camera lands where the Moon was when the
  flight began. `animateTourFlight` was worse: every radius in it
  (`startDist`, `endDist`, `CRUISE_DIST`) was measured from the world origin,
  so it read about **708 rather than 11.6**, the cruise bump was arithmetically
  dead and the great-circle slerp arced over EARTH.

Both are fixed the same way — hold the endpoints as offsets from the body and
re-anchor them to its live centre — and `viewer.globe` is the body mesh on all
eleven viewers, so the centre needs no new seam. On a body at the origin it is
arithmetic on zero and nothing changes.

**Measured, with the control that reproduces each fault.** Boot anchor error
12.06 → **0**, held through 19 s; camera 11.585 units from the body centre,
identical to Mars; the zoom pill 4,552 km against a camera that really is
4,552 km up, where before it read 4,552 against a true 10,030. A real drag
orbits at a constant 11.585 with the error still 0. A flight to Copernicus
lands at 9.62°N, 20.1°W — the crater's own coordinates — with the error 0 on
every sample; re-injecting the world-space flight and repeating the identical
click gives **0 → 0.285 units (155 km), permanent**. Mars, Jupiter and Earth
all measure body at the origin, error 0, unchanged.

### How it was found, because three plausible readings were wrong

- **The theme work was not the cause**, though it was blamed. Those commits
  touched four lines of each per-planet `styles.css` and nothing else in
  `planet_explorer/`; the only JS change was an inert `closeCards` seam. Check
  what a suspect commit actually touched before reasoning about how it could
  have done this.
- **`globe.parent.position` is the LOCAL position.** Reading it said the Moon
  sat still at [708, 0, 0] while the camera flew away around the origin — the
  opposite of the truth, which is that the Moon orbits and the camera follows
  it exactly. Read `matrixWorld` for a body hanging off a pivot; this file
  already records the same trap from the other side.
- **The orbital follow was innocent, and proving it was what narrowed the
  hunt.** Logging `controls.target.distanceTo(_prevMoonCtr)` at the top of the
  follow showed **0 on every frame** — the target is on the Moon when each
  frame begins — so the drift had to come from a writer between frames, and a
  frame-by-frame log put it in a single frame at ~10 s.

**The instrument that named the writer: accessors on the target's own x/y/z.**
`controls.target.x += dx` is a property write, so wrapping `set`/`copy`/
`lerpVectors` on the instance cannot see it, and the first attempt at that
filled its 25-entry cap with OrbitControls' own no-op `sub`/`add` pair before
the real write ever happened. `Object.defineProperty` on the three components,
recording `new Error().stack` when a component moves more than a unit and the
stack is not OrbitControls' `clampLength` round trip, named
`restoreGlobeView` → `mode-manager.setMode` → `boot` in one run. **When a value
moves and no method call explains it, trap the components, and filter the
vendor's own no-ops or the cap will fill before the culprit runs.**

**`geoid-gis:view-mode` is shared across every page on the origin.** Leaving
the GeoHUB in Model mode means the next planet viewer opened boots into the
Meshing Studio with no globe in sight, which reads as that viewer being broken.
Worth knowing before diagnosing one.
## Posing a viewer's own camera for a still — four things that bite

`services/bake-hero-tiles.py` renders the transit page's hero tiles from the
viewers themselves: headless Chrome over the smoke test's own hand-rolled CDP,
posing each viewer's camera and capturing the CANVAS (`toDataURL`), so no
panel, label or cursor can reach a tile. Rendering rather than sourcing
photographs keeps the tile on the same basemap the viewer wears, keeps the
licence question already-answered, and covers the four bodies with no surface
to photograph. Ten files, 220 KB.

Everything below was found by looking at the output, and every one of them
produces a plausible-looking wrong picture rather than an error:

- **The aim point must be inside the horizon.** From `alt` body-radii out the
  horizon is `acos(1/alt)` around the curve; aiming past it points the camera
  at sky. Half the first tile was black. Parametrise as a FRACTION of that
  angle and the rule holds at any altitude.
- **The oblique must swing the way the frame is tall.** `camera.up` is the
  body's pole, so up in the picture is pole-ward; swinging the aim due east
  moves the horizon sideways, and every trial came out as a disc pushed against
  the left edge. Then swing toward the FAR pole, or the ground fills the top of
  the frame and the sky sits under it.
- **`controls.update()` clamps to `minDistance`.** These viewers set a zoom
  floor well outside a still's altitude, so every pose was pushed back out to
  the floor and only the aim moved — a sweep from alt 1.14 to 1.50 produced
  four near-identical frames. Lift it for the shot, put it back after.
- **Pin the clock or the bake is not idempotent.** The globes turn with
  simulated UTC, so an angle from the camera's current direction names
  different ground on every run: Earth came out over the Mediterranean in one
  run and over the Sahel in the next from identical numbers.
  `setSimulatedUtcMs` where a viewer has it.

**And light the face being shot.** Choosing ground by turning the camera walks
it onto whatever the sun was already lighting; the first Mars tile came out on
the night side. Aim the key DirectionalLight down the shot's own axis, lifted
20-ish degrees so the relief still models — a directional light is a direction
only, so this is right whether or not the body sits at the origin.

**What belongs in a still: the body and the sky.** Keeping only the meshes
whose radius is within a fifth of the globe's drops the annotation wholesale.
Hiding sprites, lines and points is NOT enough — the marker dots are 0.03-radius
spheres and their hit targets 0.28, and both speckled the first tile. Saturn's
rings are the deliberate exception: a `RingGeometry`, neither surface nor sky,
and the most defining thing about that planet.

**A tuning sweep must vary ONE thing from one page load.** These viewers take
about ten seconds to boot and stream a basemap; several poses per load is the
difference between tuning and waiting. Spin is the number worth sweeping once
altitude and framing are settled — it is what decides whether a tile lands on a
cratered highland, an empty ocean, or the night side.

### Two page-level details, and a .gitignore that ate a file

**A gradient clipped to text takes a `filter: drop-shadow`, never a
`text-shadow`.** `-webkit-text-fill-color: transparent` with
`background-clip: text` means a text-shadow paints a solid slab of the letter
shapes behind them; `filter` follows the rendered alpha. It only started
mattering when the name moved onto a photograph.

**A `cover` crop is centred, and centred is usually wrong.** The transit tile
is about 3.7:1 against a 2.4:1 shot, so `cover` throws away two fifths of the
height — and centred it keeps the band of sky and limb and loses the surface
the shot is of. Bias it down.

**`.gitignore` carried a bare `moon.jpg`**, which matches every `moon.jpg` in
the tree. It silently swallowed the Moon's baked tile: the file was on disk,
the bake reported it, and it simply never reached a commit — found only by
counting the assets in the commit against the ones on disk. Negated for that
one path rather than loosening a rule that is presumably protecting something
larger. **After a bake, count what was COMMITTED, not what was written.**
## Real elevation, streamed — and the two questions it must not confuse

The globe's elevation was one shipped texture whose native sampling on Earth
measures **19.6 km**, so a study area smaller than that was a fraction of one
pixel and everything downstream inherited a precision nobody measured. The
source that fixes it was already in this repo: `everest/game/config.js` streams
**Mapzen Terrain Tiles from AWS Open Data**, keyless, and `gis/dem-tiles.js`
now does the same for the GIS globe.

Measured through the viewer's own seam, texture against streamed against
published:

| | texture | streamed | published |
| --- | --- | --- | --- |
| Everest | 6,049 m | **8,707 m** | 8,848.86 m |
| Mont Blanc | 2,415 m | **4,779 m** | 4,808 m |
| Etna | 1,674 m | **3,270 m** | 3,357 m |
| Ben Nevis | 518 m | **1,317 m** | 1,345 m |
| Slieve Donard | 153 m | **840 m** | 850 m |

The residual is the 30 m source smoothing a summit cone, which is the known
behaviour of SRTM-lineage data and the reason `config.js` records Everest's DEM
height as 8,749 beside its surveyed 8,848.86.

**The A/B that matters is the terrain tool**, same polygon over the Mournes,
same 60 m cells, with the DEM stubbed out to reproduce the old behaviour:

| | control | streamed |
| --- | --- | --- |
| DEM range | −35 to **267 m** | −15 to **845 m** |
| source sampling reported | 9,575 m, "INTERPOLATED" | 11 m |

Slieve Donard is 850 m. The shipped texture drew it as a 267 m hill.

### The rule the whole design rests on

**How high is this place, and where is the ground DRAWN, are two questions.**
The sphere is displaced from its own texture, so a height taken from a 30 m
pyramid and a surface drawn from a 19.6 km one are each right alone and ruinous
mixed inside one calculation — a pin placed from the first against ground drawn
from the second sits under the terrain. So the streamed DEM feeds
`sampleElevationMeters` and **never** `sampleElevationNormalized`; `surfacePoint`,
the drapes and a vector layer's baked `aDisp` all go on reading the texture.
`dem-tiles.test.mjs` pins both halves against the viewer's source.

`heightAt` answering **null** where nothing has been fetched is the other half
of that contract: a place nobody has streamed behaves exactly as it did before,
so this can never make an answer worse — only absent or better.

### What was measured rather than assumed

- **A pyramid that SERVES a level does not have data at that level.** The
  everest tool already measured this by subtracting each level from a bilinear
  upsample of its parent: z13 7.69 m RMS (real), z14 1.26 m (marginal), z15
  **0.74 m — the publisher's own resampling of 30 m source, at four times the
  tiles**. The cap is z14. The service answers to z15 and 404s at z16.
- **`Access-Control-Allow-Origin: *` on GET WITH an Origin header, and nothing
  on HEAD.** A `curl -I` probe reported the bucket as CORS-less and it is not.
  Probe a CORS claim with a GET carrying an Origin.
- **`crossOrigin = "anonymous"` is what makes the pixels readable** — without
  it the image loads, taints the canvas and `getImageData` throws, the same
  wall the Mars textures hit from the other side.
- **Copernicus GLO-30 COGs on AWS are better data and unreachable**: range
  requests work (206, internal overviews, so geotiff.js could stream them) and
  the bucket sends no CORS header at all. Sidecar or relay only. Esri's
  Terrain3D is CORS-open, LERC F32 to LOD 16 and finer in many regions, but
  carries the Esri MLA — the same "viewing only, no export" position this repo
  already takes for World Imagery — plus a LERC decoder to vendor. Mapbox,
  MapTiler, Cesium ion and OpenTopography all need a key, and a browser cannot
  hold a secret.

### Four faults of my own, each silent

- **A DESPIKE MUST NOT FLATTEN THE ARTIFACT'S NEIGHBOURS.** The 28.0000°N
  corrupt scanline is repaired by comparing each post with the rows above and
  below — and the obvious version, "differs from their midpoint", rewrites the
  GOOD rows either side, because a good row between real ground and an 8,150 m
  hole is 4,075 m from that midpoint. Measured on a planted spike: 24 posts
  rewritten where 8 were wrong. A post is the artifact only when it differs
  from BOTH neighbours, past the threshold, in the SAME DIRECTION.
- **A MARGIN OF A WHOLE TILE costs more than the fault it prevents.** The
  margin exists because a slope is read from four samples a few metres apart
  and a stencil straddling the covered edge would mix a 30 m height with a
  19.6 km one. Padding by a tile in every direction turned a 36-tile cover into
  64; padding the BOUNDS by four posts adds a row only where the box really
  sits near an edge.
- **`refineBox` IS NOT THE RUN'S GROUND.** The tool runner excludes anything
  answering `refineFor` from its area of interest, because a self-rebuilding
  layer's bounds are the world — and an imported file answers `refineFor` too
  ("already native"). So a terrain run over a drawn polygon had every input
  excluded and came out with no ground at all: measured, a null box with the
  study area's bounds sitting right there on the layer. What must be excluded
  is the layer that STREAMS its features, which is the test `refreshLiveInputs`
  already makes.
- **A THIRD BOX VOCABULARY, and `Number(null)` is 0.** `visibleBounds` answers
  in `minLon/minLat/maxLon/maxLat` — neither of the two spellings already
  documented here — and, where fewer than three rays meet the globe, hands back
  an object full of NULLS rather than a null. A truthy check passes that
  through; a coercing read then turns "I cannot see where you are looking" into
  a study of 0°N 0°E, silently and at the right number of tiles. The normaliser
  takes all three spellings and refuses a null field rather than coercing it,
  and the follow checks for finite fields before asking.

### What it does not do yet, stated plainly

The **drawn globe is unchanged** — this is the sampler, not the displacement.
Replacing the displacement means the relief shader, `REFERENCE_RELIEF`, the
altitude taper, drape registration and every vector layer's baked `aDisp`, and
it is a separate job.

The **view follow** (`gis/dem-stream.js`, on settle, twelve tiles) was verified
by its decision rather than by a descent: at the opening view `visibleBounds`
legitimately cannot answer and the follow correctly does nothing, and the
camera could not be driven below the 995 km no-drape floor in a hidden pane
where rAF is throttled to about one frame in 1.5 s. Its floor is zoom 6 —
2.4 km posts at 54°N, still eight times finer than the texture — because set at
8 it would have fired only in sessions that had already streamed a tile
basemap.

And at the EDGE of what has been fetched, a slope stencil can still straddle
the boundary and mix a 30 m height with a 19.6 km one. Inside a tool run it
cannot happen (the cover is the polygon plus four posts); for an ad-hoc reading
at the rim of a fetched area it can, and it is one reading.

### THE DEV PORT IS NOT A FREE CHOICE — 8125 or the elevation model is gone

Reported as "we have lost the DEM elevation reader and the vertical
exaggeration is greyed out again", with a cursor readout showing `n/a`.
Reproduced exactly on `http://localhost:8123` and not at all on 8125, and it is
not a code fault:

| Origin | the elevation PNG on R2 |
| --- | --- |
| `http://localhost:8123` | 200, **no `Access-Control-Allow-Origin`** |
| `http://localhost:8125` | 200 + `access-control-allow-origin: http://localhost:8125` |
| `https://geoidinitiative.com` | 200 + its own origin echoed |

`earth_elevation_sampler.png` lives in the bucket now, three.js loads every
texture with `crossOrigin="anonymous"`, and the sampler reads its pixels BACK
out of a canvas — so on an origin the bucket does not answer for, the image is
blocked, `elevationSampler` stays null, `sampleElevationMeters` returns null and
the exaggeration slider disables itself. Both symptoms, one cause.

**`serve.py` already defaults to 8125**, which is why the project's own
documented way to run the site has never shown this. The 8123 came from
`.claude/launch.json`, which is now a single entry on 8125 — a second dev server
on another port is not a convenience here, it is a broken elevation model.

Two things worth keeping from it. The app was ALREADY honest: the disabled
slider's tooltip names the cause down to `crossOrigin="anonymous"`, which is
what a control that greys itself out owes the reader — the diagnosis took one
look at a `title` attribute. And the general shape: **the site now depends on a
bucket allowlist, so any NEW origin — a staging domain, a preview URL, a second
dev port — silently loses the elevation model and the tiled sheets.** Check a
new origin against the bucket before believing what a page there is telling you.

Verified on production the same afternoon: `geoidinitiative.com` reads
-3,857 m at 50.54°N 335.07°E with the slider live, so main is unaffected.

### The stand-in: Terrarium carries the READER when the texture cannot be read

Four of the viewer's own assets come back with **status 0** on an origin the
bucket does not answer for — measured on `http://localhost:8123`:
`earth_color.jpg`, `earth_elevation.png`, `earth_geology_sim3292.png`,
`earth_hillshade.jpg`. One cause, four symptoms, and they arrive as four
separate-looking bugs: the base texture is gone (the globe reads as vanished),
the elevation model is gone (the readout says `n/a`, the exaggeration disables
itself), and with the model gone the relief is 0, so the zoom floor stops
knowing where the ground is.

Terrarium is on AWS and answers `Access-Control-Allow-Origin: *` to everybody,
so it can carry the reader anywhere. `hasElevationModel()` on the viewer seam is
the trigger — **"no model at all" and "no data here" are different answers and
a null cannot tell them apart**; the first means a page that should be streaming
its heights from somewhere else, the second is the sea floor.

Standing in, the follow drops its floor to zoom 3 (about 19 km posts, no worse
than the texture it replaces) and uses the VIEW CENTRE when `visibleBounds`
cannot see the globe, which at the opening view it cannot. Measured on the
broken origin: 4 tiles, 9.2 km posts, and the reader answering **399.7 m** at
20°N 0°E where it had been `n/a`. On a healthy origin the stand-in never fires —
0 tiles streamed, the texture answering as before.

**It cannot carry the DISPLACEMENT**, and that is stated rather than hidden: the
shader needs a texture, so the globe stays flat and the exaggeration stays
disabled. What comes back is the height of a PLACE, not the shape of the drawn
ground — the same division the whole DEM design rests on.

Three faults of my own, and the third took the test runner out of memory:

- **The centre box must speak the VIEWER's vocabulary.** `viewChangedEnough`
  reads `minLon/maxLon/minLat/maxLat` and nothing else, so a `west/east` box
  makes every span NaN, every comparison false, and the stand-in silently never
  fetches. Third spelling, third time today.
- **A floor of 4 in `chooseZoom` was a HOLE in the budget, not a floor**: a box
  that fits nothing gets zoom 4 anyway, and a hemisphere at zoom 4 is 36 tiles
  against a budget of 12 — measured, 54 fetched on the opening view. It goes
  down to 1 now, so the budget always binds; the stand-in's own box is capped at
  15° for the same reason.
- **COUNT tiles, never list them.** `chooseZoom` walks down from the cap asking
  what each level costs, and `tilesForBounds` MATERIALISES every tile: a
  hemisphere at zoom 14 is millions of objects, and node died on it. `tileSpan`
  and `tileCountForBounds` in mvt.js answer arithmetically, and
  `tilesForBounds` is now built from the same span — one range calculation,
  two uses.

#### The stand-in needs the WHOLE world, and the world is pinned

"Not mapped correctly, not 100% coverage" — measured, and both halves were the
same fault. The stand-in held the four tiles around the view centre and answered
**null for every other place on Earth**: a reader is the one consumer that
cannot live on the view's own tiles, because the cursor moves off them
constantly, and where it did answer it answered at whatever coarse level the
opening view resolved to.

The costs, measured against the texture being stood in for
(`earth_elevation_sampler.png`, **21 MB** for 19.6 km sampling):

| world cover | tiles | bytes | posts at the equator |
| --- | --- | --- | --- |
| zoom 2 | 16 | 1.5 MB | 39 km — worse than the texture |
| **zoom 3** | **64** | **5.8 MB** | **19.6 km — parity** |
| zoom 4 | 256 | 21 MB | 9.8 km, and 67 MB of decoded floats |

Zoom 3 it is: the same sampling as the texture, for a quarter of its bytes, on
any origin — and the view follow still refines wherever somebody is actually
looking. The world tiles are **PINNED** and the LRU never sees them, the same
rule the geology tiler already lives by ("the world is pinned under the view,
or the planet has an empty half").

Measured after, on the broken origin: 68 tiles held (64 pinned at zoom 3, 4 at
zoom 4 over the view), **zero nulls across ten points on six continents**, and
the values are the source's own at that spacing — Vostok 3,498 m against a
published 3,488, Denver 1,699 against ~1,600, the mid-Atlantic −3,344. On a
healthy origin none of it fires: **0 Terrarium requests**, the texture
answering as it always did.

**What a coarse reading is NOT is a mapping error.** Everest reads 5,252 m off
the zoom-3 world and 8,707 m once its own ground has been streamed, and both
are that level's honest answer — the texture's own number there is 6,049. So
the reader is multiresolution in the way the rest of this app already is, and
crossing from refined ground to unrefined ground steps the value. Where that
matters, `postMetresAt` says which spacing answered.

#### And it needed a ROW, because nothing you cannot point at is a layer

"Where is the streamed DEM, I cannot see it in Basemaps" — it was a sampler and
nothing else. It answered the cursor readout, the terrain tool and the Model
Builder, it pulled tiles, and it had no row in the list of what is on the
globe: no eye, no opacity, no place in the draw order, no legend, no credit
anybody could read. That is the fault the events feed was already fixed for,
in the same words.

**Basemaps ▸ Overlays ▸ Terrain ▸ "Elevation (streamed DEM)"** now. Ticking it
goes through `buildRasterLayer` — the same function a dropped GeoTIFF goes
through — so the elevation ramp, the legend with its own min and max in metres,
the layer row, the symbology dialog, the drape on the displaced surface and the
raster the terrain tools take as an input all come with it. Measured on the
live page: 1,024 × 512, **−9,504 to 6,061 m**, a legend card reading those
numbers, `metadata.source` carrying the Mapzen credit, and the sheet drawn over
Africa at 0.7.

Three things decided rather than defaulted:

- **A catalogue entry may BUILD its picture** (`builds: "dem"`) rather than
  naming a shipped image. A row that names neither is a tick that can only
  fail, which is what the test now checks.
- **The world cover is fetched on the TICK.** A global elevation layer with
  holes in it is not a layer, it is a report of where somebody has been
  looking. 5.8 MB, asked for because somebody asked for it.
- **It opens at 0.7, and a rebuild carries what the reader set.** The
  opening-opacity rule reads geometry and a raster is not an area, so nothing
  fades this one on its own — and a solid elevation sheet over the imagery is a
  second basemap rather than something to read the first one against. This
  layer replaces itself on every settle, so re-applying a DEFAULT each time
  would undo the slider seconds after it moved.

**The grid is sampled by LAT/LON, one cell at a time, never by copying tile
pixels** — which keeps the Mercator trap out of this module entirely. The
sphere's UVs are linear in latitude and the tiles are not; a pixel copy slides
every coastline poleward, and asking the sampler where a place is cannot.

Not observed: the settle-triggered REBUILD as the camera descends. The
machinery is the same `heightAt` that demonstrably prefers finer tiles once
they are streamed, but the pane's render loop would not advance the zoom for a
scripted descent — the third time today that has stopped a camera-driven check.

#### It floated because of the box, and `surfacePoint(NaN, NaN)` does not refuse

"It floats well above the surface", and it did: measured on the patch's own
vertices, radii of **0.45, 1.85 and 4.05 against a globe of 3.2** — a sheet
scattered up to 1,700 km off the ground.

Nothing about the drape was wrong. `buildDrapedPatch` reads
`minX/minY/maxX/maxY`; this module works in `west/south/east/north`, and it
handed over its own. Every lat and lon in the patch loop came out NaN, and
**`surfacePoint(NaN, NaN)` answers with finite garbage rather than refusing** —
so the mesh was built, registered, legended and drawn, out of numbers that mean
nothing. `drape()`'s own note warns about this from the other side, where the
same mistake paints *nothing at all* and is therefore easier to see.

Converted at the boundary, measured again over 196 vertices against
`surfacePoint` at the same coordinates: **mean 0.105 m, worst 0.251 m**. That
is the same touch-tight the raster drapes are held to.

**The fourth spelling of a box in one tree**, and the third time in two days it
has cost something: the tilers say `west/south/east/north`, a layer's bounds say
`minX/minY/maxX/maxY`, the viewer says `minLon/minLat/maxLon/maxLat`, and the
raster builder says `minX/maxY` again. Convert at every boundary; never hope.

#### Elevation is a subject, not a footnote under the basemap

The exaggeration slider, the contour interval and the streamed DEM all describe
the SHAPE of the ground; the Basemaps catalogue is PICTURES to dress the sphere
with. The three sat at the foot of that list looking like three unrelated
controls, and the DEM row was a tick in a catalogue of images that was not one.

**Map ▸ Elevation** holds them now — `#map-elevation-section`, between Basemap
and Overlays — with the streamed DEM as its own control (`gis/dem-panel.js`, one
tick and a status line) rather than a catalogue row. The `builds:` seam that
briefly let a catalogue entry make its own picture went with it: a seam with no
user is a seam that will be wrong when it finally gets one.

The tick is read back off the LAYER, never remembered in the panel — a tick
saying yes over a layer that failed to load is the fault the GLiM row already
cost. Verified after the move: the Elevation sub-tab holds the DEM tick, the
exaggeration and the contour select; Basemap holds its catalogue and no longer
holds the slider; and the DEM row is gone from the basemap catalogue.

#### A view box is not a box when the view crosses the antimeridian

A screenshot of the globe from over the Pacific with a bright stripe down the
limb: "the stream of the DEM tiles is well off". The sheet was built correctly
— over a box that was a lie.

`visibleBounds` answers in min/max longitude with no wrap, so a camera looking
at the middle of the ocean comes back as **164.2 to 180**: a 16° strip pinned
to the seam, on ground the camera is not pointed at. Every step after that is
faithful, which is why it drew a perfect stripe.

`sheetBoundsFor` is that decision, pulled out pure so it can be pinned:

- **A wide view gets the world.** Past about 20° the sheet is a global picture
  anyway (1,024 cells across the world is 39 km, across 20° it is 2 km), and a
  wide box is exactly where a raycast against a limb is least trustworthy.
- **A box touching ±180 gets the world**, because that is what a cut box looks
  like.
- **And so does a box that does not contain the VIEW CENTRE** — the one
  longitude that is always known and never wrapped wrongly. That is the general
  form of the same test, and it catches the cut wherever it happens to land.

Verified live at the opening view: the sheet is −180..180, −85..85, drawn as one
global elevation layer with no stripe; and over Sicily at 174 km it is
13.9–16.5°E, hugging the ground to a tenth of a metre.

**Both faults in this sheet came from a screenshot rather than from a check**,
and both were about a box: one handed to the wrong reader, one cut at the seam.
`dem-sheet.test.mjs` pins the second because it is pure; the first is pinned by
asserting the conversion exists at all.

#### A 200 km chord cannot hug the ground, and the sheet was stamping depth

Two faults behind the banded, see-through sheet, and the first is arithmetic
rather than opinion.

**The world sheet is 1.9° a quad.** `buildRasterLayer` caps the patch at
192 × 192, so a sheet spanning the globe has quads about **200 km** wide, and a
flat chord that long sags roughly **900 m below the sphere** between its
corners — the chord-sag rule this file already states for drawn lines, met from
the raster side. From orbit that is far under a pixel. At a grazing view it is
not: the sheet and the terrain interleave along the ROWS of the grid, which is
horizontal banding, and near the limb the sagging chords project outside the
silhouette, which is what reads as seeing the sheet through the planet.

900 m is under a pixel above about 3,000 km (a pixel is roughly a thousandth of
the altitude at this field of view), so that is where the world sheet is
honest. Below it the sheet follows the VIEW: measured at 697 km over the Alps,
a 12° box — 0.063° a quad, about 7 km, with a sag near a metre — and the ridges
line up with the imagery under them with no banding at all.

**And it was writing depth it never tested against.** The patch draws with
`depthTest: false` on purpose — a tessellated sheet cannot win against relief
with detail below any grid — and shipped with `depthWrite: true`, so it filled
the buffer from a surface that had ignored the buffer, and everything drawn
afterwards that DOES test was occluded by it. A layer that opts out of the
depth test opts out of both halves. Fixed on this sheet rather than in the
shared builder, because the other drapes are sub-hemisphere patches where the
same setting has never been reached.

What was ruled out by measuring rather than by argument: the sheet's triangles
all wind **outward** (753 of 753 sampled), so `side: FrontSide` culls the far
hemisphere exactly as intended and the bleed-through was never a winding fault;
and the band held **0 no-data cells of 524,288**, so the gaps were never holes
in the data.

**A note on reading the screenshots**: fine horizontal lines running across the
WHOLE frame, empty space included, are not the sheet — nothing drawn on the
globe can paint the sky. That is the viewer's own scanline skin. The artefacts
that were real are the ones that stop at the limb.

### The Elevation catalogue: three readings, one pyramid

Asked whether the streamed DEM should also produce slope and hillshade
basemaps. It should produce them; they should not be basemaps.

**Three READINGS of one source, not three sources.** Slope and hillshade are
arithmetic ON a DEM, and this app already owns that arithmetic:
`raster-analysis` exports the same `slope` and `hillshade` the tool registry
runs and the suite sweeps against closed-form fixtures. So a row derives its
band from the SAME streamed grid — one cover, one fetch, one set of lessons
about chord sag and depth. Measured with two rows ticked: **73 tiles held, not
146.**

**Not basemaps, for three reasons.** The GEBCO hillshade and slope already sit
in that catalogue, so two more rows would be four controls for two ideas — the
duplication rule this file keeps paying for. The engines exist and are tested,
so a pre-built pair would be a second implementation of arithmetic that has
one. And a GLOBAL streamed slope is no better than what ships: at a world view
the streamed cover is zoom 3, which is the 19.6 km GEBCO already is. **The gain
is local, which makes it a view-following layer rather than a basemap.**

Three things decided while building it:

- **A hillshade is three identical bands.** `buildTexture` treats three bands
  as RGB and one band as a value to run through a colour ramp — and a hillshade
  through a colour ramp is not a hillshade. Handing it the same greys three
  times is the whole trick.
- **A hillshade has no key.** Its values are shade rather than a measurement,
  so a card reading "82 to 248" beside a colour bar says nothing and the bar is
  wrong twice over, the layer being grey. `legendHidden` — the events feed's own
  seam — keeps the row, the eye, the opacity and the draw order, and drops only
  the card.
- **The range quoted is of what the row DRAWS**, not of the heights it came
  from. Slope reports "0 to 32°" over the Alps; quoting the elevation range
  under a slope map is a number about a different raster.

**And the light controls finally have a job.** `#hillshade-azimuth` and
`#hillshade-altitude` have been in the page, hidden, read by `earth-viewer.js`,
for as long as anyone can tell; the streamed hillshade reads them for its own
lighting with 315/45 as the fallback.

The shipped GEBCO pair stays in Basemaps: global, instant, no fetch. These are
the local answer at the view's own scale, which is a different product rather
than a better one.

#### The sheets fought the camera, and it was sixteen zoom levels to find two

"As we zoom in on the new slope, DEM, hillshade maps the camera fights us all
the way." Measured: **1,120 ms of blocked main thread per sheet, per settle** —
and with three ticked, three of those.

**`heightAt` walked every zoom from 15 down to 0**, building a `z/x/y` string
and missing two Maps with it at each level, when only ever two levels are held
(the pinned world and whatever the view pulled). Half a million samples a
rebuild at 2.14 µs each is the whole cost. Holding the set of zooms that
actually have tiles and walking only those took the same grid on the same tiles
from **1,120 ms to 97 ms — 11.6×**.

Three more, each measured rather than assumed:

- **The sampling is CHUNKED**, 48 rows a slice with a breath between them. The
  work is the same; what changes is that the render loop gets frames while it
  happens, which is the difference between a camera that stops dead at every
  settle and one that does not.
- **The grid is 768 × 384**, not 1,024 × 512. Everything downstream scales with
  it — the sampling, the slope arithmetic, the texture upload — and 768 is
  still finer than the screen shows it (1.5 km a cell over a 12° view against
  about 1 km a screen pixel), with the mesh under it 192 either way.
- **The settle is 900 ms**, not the tilers' 700. A descent is a RUN of settles
  and each one costs a rebuild per ticked sheet; waiting longer before starting
  is the cheapest way to stop a slow zoom becoming a queue of them.

Measured after, with the frame-gap instrument this file already uses. One full
build: **median 16.6 ms — 60 fps, identical to idle — with exactly one gap over
50 ms in 771 frames** (165 ms, which is the mesh re-lay and the texture upload,
both inside the shared raster builder). A real descent from 700 km to 159 km
with two sheets on: **median 16.7 ms, 10 frames of 300 over 50 ms**.

What is left is the shared drape re-lay: `registerDrape` re-lays a patch's
36,864 vertices whenever the ground moves 10 m, and the relief taper moves it
continuously all the way down, so each sheet pays 31–41 ms a few times a
second while descending. That is most of the 3% of frames that still hitch. It
is shared machinery and every drape uses it, so it was left alone rather than
tuned from here.
## Declining to refine is not the same as taking the picture down

"The streamed tiles for Sentinel-2 fail to disappear as we zoom back out."
Measured, and it is one distinction missing in one file.

A streamer has two ways to say "nothing to do here":

- **the view has not changed**, where leaving the picture alone is right;
- **the view has changed into one this picture does not describe**, where
  leaving it alone means a patch built at zoom 13 is still drawn over a globe
  seen from orbit.

`basemap-drape.js` had three of the second kind, all spelled `return null`:

| decline | what stayed on the globe |
| --- | --- |
| above `MIN_REFINE_ALTITUDE` (~2,000 km) | the close-in patch — the reported fault |
| `zoom <= BASE_GLOBE_ZOOM` | the same, one step earlier |
| the basemap is no longer a tile service | the previous service's imagery |

`retireRefine` disposes the mesh and clears the BOX with it, so coming back
down is a change from nothing and refines at once instead of being measured
against a view that is no longer on screen. Measured over a full cycle: patch
present at 498 km, **gone at 16,525 km**, present again at 498 km — and the
control against over-fixing, sitting still through six settles, keeps it every
time.

**And a change of SOURCE is a change.** The test compared boxes only, so
switching Sentinel-2 to OpenStreetMap from a camera that had not moved declined
to refine and left the previous service's imagery under the new service's name.

### The rest of the audit, and what was already right

- **The vector tiler is clean, and is the shape the imagery patch was
  missing.** Every `update` ends by turning on exactly the pinned set plus what
  the view wants, everything else off, then evicting — so zooming out puts the
  deep tiles away by construction rather than by a special case.
- **The GEE drape declines on purpose.** A drape is a LAYER somebody asked for
  over a chosen extent; it should not evaporate because the camera moved. The
  same words mean different things for a basemap patch (context, follows the
  view) and for a dataset (a thing you asked for), and only the first should
  retire itself.
- **The DEM stream draws nothing**, so declining costs nothing.
- **The elevation sheets rebuild to the world** when the view goes wide, so
  there is no stale-close-up state — but a rebuild that FAILS leaves the last
  sheet drawn over its own ground. That is left as it is: unlike the imagery
  patch it is a listed layer with a row, an eye and a remove button, so a
  reader can see it and take it off.

`tile-retire.test.mjs` pins the distinction on the source of both files: every
decline that follows a change of ground must retire, the one that follows an
unchanged view must not, and the tiler must keep its tidy-up pass.
## `camera.fov` is the VERTICAL field of view, and a screen is wider than tall

"Current streaming extents fail to efficiently cover the full camera view —
low resolution flanks the streamed tiles." Measured at 498 km over the Alps on
a 1.79 aspect: the box came out **8.6° wide against a screen covering 10.3°**,
with **six of eight sampled screen points outside it** — and their incidence a
perfectly ordinary 0.72, so this was not the horizon, it was the middle of the
view being left out.

`clampToForeground` cut longitude with the same span it cut latitude with, and
`camera.fov` is the VERTICAL one. So the box was about nine tenths of the
strict horizontal view before any context was added, and the tiles were fetched
for a window narrower than the window. The aspect goes into the longitude half
span now, ahead of the cosine, so the 1.6 ring of context means the same thing
on both axes.

**And a grazing ray is the horizon, not the view.** The clamp exists because
rays near the edge of a low view meet the sphere almost tangentially and blew
the box up twelvefold at 2.8 km — but the incidence says which is which
directly, being near 1 looking straight down, about 0.7 at the corners of an
ordinary view, and near 0 at the limb. Dropping samples under 0.12 leaves a box
made of ground somebody can actually see, which is what the clamp was working
around rather than measuring.

Measured after: **8 of 8 screen points inside**, the box 11.35° against the
screen's 10.32° — a ring of context rather than a shortfall — and the raycast
box, not the clamp, is now what decides it. This reaches every consumer of
`visibleBounds` at once: the imagery refine, the elevation sheets, the Earth
Engine refine and the DEM stream's own follow.

### The refine stopped three times too early, and the zoom gate already knew

"Should we map the Sentinel-2 imagery sooner at low resolution at higher
altitudes — at a 500 km scale bar the map is very very grainy." Yes, and the
old ceiling's own comment was the thing to check: it claimed that above about
2,000 km "the whole-globe basemap out-resolves the screen and a patch would be
identical to what is already there". Measured, it does not.

The global composite is zoom 4 — **9,784 m per pixel** at the equator. Against
the screen's own ground resolution on a 1,405 px canvas:

| altitude | | screen | the composite is |
| --- | --- | --- | --- |
| 796 km | 0.4u | 1,040 m/px | 9.4× coarser |
| 1,991 km | 1.0u — the old ceiling | 3,165 m/px | **3.1× coarser** |
| 3,982 km | 2.0u | 6,748 m/px | 1.45× coarser |
| 6,570 km | 3.3u | 11,135 m/px | finally finer |

So refining stopped while the picture was still three times coarser than the
screen could show. The ceiling is 3.2 now, past the crossover.

**And the real limit needs no altitude at all.** `chooseZoom` already weighs
the box against the tile budget, and it lands exactly where it should: zoom 5
at 2 units (77 tiles, 4,892 m/px against a 6,748 m/px screen — worth having),
and zoom 4 at 3.3 units and above, where the existing `zoom <=
BASE_GLOBE_ZOOM` gate declines and now retires. The altitude test survives only
as a cheap early-out that saves raycasting a hemisphere.

Verified live: a patch at 2,935 km and at 4,077 km where there was none before,
and none at 16,525 km. At 2,290 km with a 500 km scale bar — the reported view
— the imagery reads smooth where it was pixelated.

The cost is 77 tiles a refine at continental scale, inside the 256 the streamer
already caps at, and cached afterwards. **When a constant carries a claim about
resolution, measure the claim before trusting the constant**: this one had been
right about something (a patch IS pointless eventually) and wrong about where.

### The opening basemap: what can be changed and what cannot

"Ensure that only the Sentinel-2 basemap is mapped upon launch — currently we
see it switch from Earth Surface to Sentinel."

**The switch is structural.** The Sentinel-2 basemap is a composite of 256
tiles; it does not exist until they have been fetched, so *something* is on the
sphere for the second or two that takes. The choice is which shipped texture,
and how long it stays.

Measured on a warm load, before: the shipped texture up at **85 ms**, the first
Sentinel tile requested at **2,129 ms**, the composite complete at 2,699 ms —
so about two and a half seconds of Earth Surface. Most of that was waiting
rather than working: `initWhenReady` polls at 500 ms and the swap needs four or
five passes. The first second is polled at 120 ms now, and the same load
measures **first request 1,116 ms, composite 1,775 ms** — a second off the
window for a handful of no-op panel lookups.

**And Blue Marble is not available to open on.** It was the obvious candidate —
it ships with the site, so it needs no fetch at all, where the Earth Surface
texture is a bucket JPEG. Pointing both constants at it left the globe on Earth
Surface **for good**: `ALLOWED_BASEMAP_IDS` admits four shipped textures and
Blue Marble is not among them, so it is absent from the dropdown entirely
rather than merely hidden from the catalogue list, and the swap fires only when
it finds its own `SHIPPED_DEFAULT_ID` still selected. Measured within a minute
of making the change and reverted; the test now checks that the two constants
agree AND that the select actually offers what they name.

What would genuinely leave only Sentinel on screen is opening with **no**
imagery — a dark globe until the tiles land — which is a real trade rather than
a fix, and one for whoever owns the first impression to make.

**And the Workspace row says what it is.** "Sentinel-2 Cloudless TILES" reads
as a dataset with a format tag; it is the basemap, so it reads
**"Basemap: Sentinel-2 Cloudless"** and the `layer-kind` span is gone. The word
it dropped was doing the same job the prefix now does, and doing it in the
vocabulary of a file format.

#### And the opening is dark now, by request

"Open with a dark globe until Sentinel loads." The two-picture opening is gone:
the shipped texture is never painted, and the sphere is dark until the mosaic
is down. Measured on a warm reload, sampling the globe's own material:

| | |
| --- | --- |
| 781 ms | the globe appears, bare and SANDY (`#d0b18a`) — the viewer's own no-texture colour |
| 864 ms | dark (`#0a0f16`), Sentinel-2 selected |
| 1,317 ms | textured with the mosaic |

**A texture-less globe is sandy, not dark**, which is why the colour has to be
said at all — `syncBasemapVisibility` sets `0xd0b18a` wherever there is no map.
The viewer's own change handler puts it back to white the moment a texture
arrives, so nothing here has to watch for the end of the dark phase.

**The opening and a CHOICE are owed opposite things**, and one flag tells them
apart: the app's own opening swap leaves the sphere dark, while somebody
choosing a service keeps the map they were looking at until the new tiles are
down. That hold is why the two-picture opening existed in the first place — it
is right for a choice and wrong for a launch.

**And never permanently dark.** A service that does not answer restores the
shipped texture after 12 s, and one that fails outright restores it at once —
without that, the failure path swaps a two-picture opening for a black planet
for the life of the page, which is a worse trade than the one being fixed.

What is left is an **80 ms sandy flash** between the globe appearing and the
swap: the poll that darkens it cannot run before the material exists, and the
material is born with the viewer's own bare colour. Removing it means changing
that colour in `earth-viewer`, where it is the answer for every missing texture
rather than just this one — left alone deliberately, and measured so the choice
is visible.
## Core View cuts the planet, so it cuts every layer on it

"Ensure that all new layers cutaway relative to the activation of the core
view when required." Core View removes half the planet with one world-space
clipping plane so the interior shells can be read off the cut face — and that
plane was applied to a **HAND-WRITTEN LIST of the viewer's own materials**:
base texture, geology sheet, contacts, structures, minerals, sea, region mask,
selected outline.

Every layer the GIS page draws was outside that list. Measured live with the
cutaway up: the base material carried **1** plane and the plate boundaries,
the live event markers and the earthquake record carried **0 across 14
materials** — so a coastline, a marker cloud and a dot layer went on being
drawn across the removed half, hanging in the air over a planet cut open
beneath them.

**A LIST CANNOT BE THE ANSWER, because a layer's materials are not knowable
in advance.** They are built by the importer, the tilers, the drapes, the
repaints and the animators, and a new one appears whenever somebody ticks a
box. This is the `applyStack` fault in a second column — *stamped only the
nodes that existed when it ran* — and the same shape as every "a name lives
in as many places as there are surfaces that show it" note in this file.

So the plane is **published and stamped**: `getCutawayPlanes()` on the viewer
seam, `geoid-gis:cutaway-changed` when the toggle moves, and `gis/cutaway.js`
running a pass over whatever is on the globe now. Re-run on BOTH halves of the
question — the cutaway toggling, and the layer list changing — which is what
makes a dataset ticked on *after* the cutaway came up arrive already cut.

**The three places a material can appear between passes are wired directly,
because none of them announces a layer change:**

| | why the pass misses it |
| --- | --- |
| `vector-tiles.js`, on each new tile | a tile is a new child of a layer that has not CHANGED |
| `vector-render.js`, in `repaintVector` | a repaint replaces every child with fresh materials |
| a raster drape | nothing — it re-lays its vertices and keeps its material |

The first two sit beside the renderOrder and the opacity those files already
copy for exactly the same reason, which is the tell that this is one fault
class rather than three bugs.

**Read the planes, never remember them.** `applyPlanetViewMode` re-aims the
normal whenever the axial tilt changes, so a copy taken at install time cuts
along a tilt the planet has since left. three.js reads `clippingPlanes` in
**world space**, so the viewer's one plane object is correct for a layer in
any group — no frame conversion, which on this globe is worth stating.

**The count is what decides a recompile.** three.js compiles the clip count
into the shader, so none→one costs a rebuild and one→the-same-one costs
nothing. Without that test every hierarchy change would set `needsUpdate` on
every material of every layer — on a 312,500-point cloud, a stutter for no
change. Clearing writes `null` rather than `[]`, so a layer that has met the
cutaway and left it is byte-identical to one that never did.

**`keepUnclipped` excludes the whole SUBTREE**, which is why the walk is by
hand: `traverse` has no early exit. It is for geometry deliberately not on the
surface — the satellites orbit at up to three Earth radii, and cutting them at
the plane would take half of every orbit off a shell that was never part of
the ground being cut.

**GUARD ON THE LISTENER, NOT ON `window` — this tree has now paid for it
twice.** The install was gated on `typeof window !== "undefined"`, which is
TRUE in the three suites that stub `window = globalThis` — an object with no
`addEventListener` — so the call threw at IMPORT and took
`drape-registration`, `feature-popup` and `tool-runner` to **0 passed** on one
line. `volcanic-hazards.js` left this exact note and it was walked into
anyway; it is pinned now, on the source, in both directions.

**Ported to all ten worlds by generator, not by hand.** All nine planet
viewers already carried `coreToggle` and `cutawayClipPlane` under those exact
names with one toggle site each, so `port-viewer-seam.py` writes both halves —
gas giants included, since all ten have a core toggle and all ten take layers.
Its new block is anchored on the CARD block's last line rather than on
`bodyId`: anchored on the same line as the card block the two would swap order
on every run and `--check` would never settle.

Measured live on a committed stamp, A/B on one camera with the cutaway up:

| | |
| --- | --- |
| materials clipped, before / after the toggle | **0 / 13** → **13 / 13** |
| a catalogue row ticked WHILE cut | arrives **1/1 clipped** |
| after a repaint (every material rebuilt) | **14 / 14** |
| toggling back off | **0 / 14**, planes 0 |
| **fault re-injected — pixels drawn across the cut** | **21,307** |
| **restored** | **0** |

That last pair is the whole verification: a clean number means nothing here
without the control that reproduces the fault.
## Sea level on the streamed DEM and the real coastline

The paleo-sea overlay was a threshold on the shipped 19.6 km elevation
texture, and it was wrong in three ways:
- At 0 m it was not the coastline.
- It filled basins the sea cannot reach.
- It read a lake's bed as the lake.

It is hidden (earth-viewer reads its ids unguarded) and replaced by a
**Hydrology ▸ Sea level** subtab. Its catalogue row is a sheet of the
streamed DEM, and the level control sits in the row's drawer.

- **Today's sea IS the ocean polygons.** The bake-hydrology ocean pyramid
  (OSM water polygons from z4, Natural Earth below) is burned onto the
  sheet's own grid by scanline, even-odd, so the coastline at 0 m is exact
  whatever the DEM says under it.
- **A risen sea spreads by connectivity**, breadth-first and 8-neighbour,
  through ground below the level. Ground lower still but unreachable is
  reported as cut off and NOT drawn: a threshold fills a basin behind a
  ridge.
- **A lake stands at its surveyed SURFACE** (HydroLAKES `elevation_m`), not
  at the DEM's reading of its bed. A risen sea crosses a lake only when the
  lake's surface is below it.
- **What is drawn is only what CHANGES**: land under the new sea in blue by
  depth, or seabed above a fallen sea in sand by height. Today's sea is
  already on the imagery.
- **The world sheet wraps** across the antimeridian; a view does not, and
  its status line says only ground in view is considered.
- **Presets carry their sources in their tooltips**:
  - −125 m, the Last Glacial Maximum (Lambeck et al. 2014)
  - +1 m, AR6 SSP5-8.5 2100 likely range 0.63–1.01 m
  - +2 m, AR6 low-likelihood high-impact
  - +7 m, the Greenland ice sheet, 7.4 m
  - +65 m, all land ice

**The TILED projection in `catalogue-panels.js` dropped `settings`**, so a
tiled row could not dock a drawer at all. This is the fourth field a
projection there has cost. It is carried now, and pinned.
## "Floats, then disappears as we zoom in" was four faults, none at rest

Every rest-state measurement said the hydrology layers were on the ground: the
fills at drape 0, the sheets within a metre of `surfacePoint`, all five drawing
at 400, 40, 8 and 2 km over the Camargue, and the live site the same. The
faults were in what happens BETWEEN two states, and each was found by building
at one state and looking from another.

- **The world pin hid the view.** A layer off its own pyramid pins its zoom-2
  world in the BACKGROUND (view first), and `pin()` ended with
  `showTiles(pinned)` — so when the world landed after the view, the view's
  zoom-7 lakes and rivers were built and HIDDEN, and the world holds no lake
  under 1,000 km² and no river under a kilometre wide. Timing-dependent, which
  is why an earlier run drew them and a later one drew nothing. It shows the
  pinned set plus whatever the view has put up now, and leaves `seen` alone
  when a view has already landed. `tile-pin-order.test.mjs` is the A/B: old
  code, visible 1 → 16 (the world alone); new, 17.
- **The sea-level sheet flooded only from a coast inside the view.** Built
  from 400 km it drew 796,471 px of sea over the Camargue; rebuilt at 8 km,
  0 px, with 59 km² "cut off" — the view held no coastline to spread from. The
  status line even said so. It is now seeded at its EDGE (`edgeSeeds`) from a
  chain of coarser boxes (`contextBox`: eight times the view, rounded to a
  power of two degrees and snapped so neighbouring views share them, up to the
  world). Only the edge: seeding a coarse parent's interior would pour the sea
  over a dyke inside the view. After: 58 km² flooded, 1 km² cut off; 0.27 s
  cached, 3.8 s fresh (DEM streamed for each link at 12 tiles).
- **River zones lost floodplains reaching in from rivers out of shot.** A 5 km
  view 1.4 km east of the Rhône: 0 zone cells alone, 246,762 with the zones of
  the rivers OUTSIDE the view (one context box, four views across) merged by the
  innermost-wins rule (`mergeOuterZones`). The view's own rivers are excluded
  from the context so a coarse HAND cannot overrule the fine one.
- **Lines were still handed the altitude-scaled clearance** (`lifted: true`,
  2% of the distance to the ground, 11.9 km cap) while drawing with the depth
  test OFF — pure parallax, a constant ~8 px off the river in the imagery at
  the edge of every view. Drape 0 now; the far side is culled by facing.

**And a drape built close in was wrong from orbit.** `attachReliefAttributes`
recovers a displacement as (radius − base) / relief from a FLOAT32 position;
at relief 3.7e-6 (1 km up) that quantised in steps of 0.01 against a true
spread of a thousandth, so the sheet stood on a terrace up to 9 km off the
ground when the camera rose, until the next rebuild. `attachExactRelief` in
`geotiff-adapter.js` carries the terrain's own `elevationNormalized` and the
seam's `latLonToVector3` direction instead: built at 1 km and looked at from
400 km, worst vertex 0 m. It reaches every raster drape (the DEM sheets,
GeoTIFFs); a viewer without those two seam functions keeps the old path.

**Two probe traps.** A view that holds no coast draws no sea and no lake draws
no lake — pick test points with `GeoIDFeaturePopup.featuresAt` first (the
first "8 km over the Camargue" point had neither in frame, and read as the
layers vanishing). And a test stub must not hand geo-utils' `latLonToVector3`
back to the seam: it DEFERS to the seam, so it calls itself.

**`gee.js`'s `drape()` was never moved over, and every overlay it builds had
the fault** — the weather card (radar, precipitation, temperature, wind), the
Earth Engine layers, the map overlays catalogue, the imagery time-lapse and
the cyclone estimate. Measured on a weather drape built 2 km up (relief
1.5e-5) and viewed from 1,500 km: **up to 2,433 m off the ground, 836 m on
average** (45 m when built at 15 km). `attachExactReliefAttributes` in
`vector-render.js` is the shared form — each vertex's direction and the
terrain's own normalised height — with `globeFrame` for geometry parented to
the globe mesh (x and z negated, the half-turn `drape()` bakes). After: a real
2 m temperature overlay over the Apennines, built 3 km up, within **0.01 m**
of the ground from orbit, where the drawn relief there reaches 140 km. When a
drape "floats", build it CLOSE and measure it FAR — at the relief it was built
at, every form looks exact.

**The weather card reuses a captured "Fetch extent" before typed inputs** —
by design, and it will send a typed-centre fetch to wherever that saved box
is (an old one sat at 0°N 0°E). Remove it from the Workspace to type a box.
## "The weather maps still float" — the registration was exact and the facets were not

Reported on a screenshot of the landslide pipeline's rainfall map. Everything
that usually means "floating" measured clean, and it took all of them to get to
the one that did not:

| | |
| --- | --- |
| drape vertices against `surfacePoint` | **0.01 m** |
| the drawn layer's box against its own projected bounds | **1–3 px** |
| `getRenderRelief()` against `getEffectiveRelief()` | **0.11 = 0.11** |
| facet centres, 500 m posts | mean **1.7 m**, worst 55 m |

**So the pipeline's own maps are tight, and the fault is in the OTHER drape
path.** `gee.js`'s `drape()` — the weather card, the Earth Engine layers, the
map-overlay catalogue, the imagery time-lapse, the cyclone estimate — built a
SQUARE grid at whatever segment count its caller passed: 72 from the weather
card, 96 by default, 180 for a global shell. None of those numbers knows how
much ground a quad covers.

Measured over an 8° × 4° box across the Alps at the slider's default relief,
each facet's centre against the ground under it:

| segments | quad | mean off the ground | worst |
| --- | --- | --- | --- |
| **72** — the weather card's | 6.1 km | **555 m** | 9,379 m |
| 96 — `drape`'s old default | 4.6 km | 336 m | 5,150 m |
| 192 | 2.3 km | 85 m | 2,000 m |
| 384 | 1.2 km | 20 m | 910 m |

**The comment that stopped anyone tessellating was measured on the wrong
quantity.** It said 96 → 384 "only takes the gap from 0.0267 to 0.0234" — true
of the WORST case, a single peak poking through, and beside the point, because
the depth test is off and a peak cannot punch a hole. What carries a map away
from its ground is the MEAN, and that improves seventeenfold over the same
range. A worst case of a kilometre on one alpine summit is the irreducible part
and always was.

`patchSegments(box, floor)` sizes the grid from the ground the box covers, **per
axis** — a wide, shallow box should not spend its vertices where there is no
ground to follow — against a **vertex budget** rather than a per-axis cap.
`segments` survives as a floor a caller may raise, never as the answer. 122,000
vertices cost **149 ms** to place, on a patch whose image took seconds to fetch
(`surfacePoint` is 1.06 µs a call and dominates; `latLonToVector3` +
`elevationNormalized`, which is what the exact-relief attach uses, are 0.16).

Measured live on a real 2 m temperature map over the same box: **413 × 295, a
1.5 km quad, mean 26 m, worst 1,035 m** — against 555 m and 9,379 m before.

**A diagnosis that reads as a dead mechanism and is a REALM.** `getRenderRelief()`
returned 0 while `getEffectiveRelief()` was 0.11 and the pump was demonstrably
firing sixty times a second — which is precisely the shape of the fault this
file already records (the uniform every followed layer is drawn at, left at
zero). It was not: `await import(...)` inside `javascript_tool` evaluates in the
TOP document's realm, and a module registry is per realm, so the copy I was
reading was one nothing drives. `w.eval('import("...")')` reads the page's own
and it answered 0.11. The tell is that only ONE load of the file appears in the
iframe's `performance.getEntriesByType("resource")`; the second instance is in
another realm and leaves no entry there at all. Set a value through the suspect
copy and see whether the page's pump overwrites it — if it does not, it is not
the page's copy.
## Streamed 3D buildings near the ground (`gis/osm-buildings.js`)

Below **6 km above the drawn ground** the Earth globe streams OpenStreetMap
buildings (OpenFreeMap z14 vector tiles, keyless) around the camera; above
**8 km** every tile is unloaded; in between nothing new is fetched and nothing
held is dropped. Sun shadows below **4 km**. Budget: 16 tiles (2.5 km round the
camera's ground point plus 1.8 km round the view centre), 3 vector tiles in
flight, 6 roof-imagery requests. The decode/extrude worker, MVT decoder,
extruder and facade shader are Earth Flight's (`flight_sim/earth/game/`).

Three things found by measuring, each of which produced a plausible wrong
picture rather than an error:

- **"Altitude" must be above the drawn ground, not the sphere.**
  `getZoomAltitudeMetres` measures from radius 3.2, and the ground is displaced
  by the exaggeration until it tapers away close in. Posing a camera 1.1 km
  above `surfacePoint` over London read as 123 km, because the ground was drawn
  122 km up at that moment's relief. The module measures camera radius minus
  `|surfacePoint(eye)|`.
- **Draw order: groupOrder beats renderOrder.** At renderOrder 45 (above the
  streamed tiles' 40) the buildings were loaded, counted and invisible: the
  Sentinel-2 basemap is a LAYER in the imported stack (groupOrder 50+), drawn
  without a depth test after them. They now hang in one group at 190 — after
  every ground layer, before pins (199+) — and depth-test, which is also the
  physically right order.
- **Tiles are tangent planes in metres, placed by matrix.** A Float32 vertex at
  radius 3.2 is good to ~40 cm; tile-local is good to a millimetre. Only each
  tile's anchor follows the relief, re-read from `surfacePoint` every frame.

Shadows: a dedicated zero-intensity DirectionalLight placed 6 km sunward of the
camera's ground point (the viewer's key light sits 180 units out, where Float32
puts a shadow camera's position 20 m adrift), sun direction copied from the key
light. Zero intensity so no lit material in the globe changes; the building
materials multiply by `getShadowMask()` themselves, and a `ShadowMaterial`
catcher under each tile carries the ground shadows (the drapes are unlit).
`renderer.shadowMap.enabled` is switched on once, at first use, and left on —
toggling it recompiles every material in the globe.

**The ground under the buildings is the tile's own Esri imagery.** The
default basemap is Sentinel-2 at 10 m/px, soft from a few hundred metres, and
the refine cannot go deeper than its source. Each building tile already
fetches z17 (near, 2048 px, ~0.7 m/px) or z16 Esri imagery for its roofs, so
the same CanvasTexture is laid flat under the tile in a group at renderOrder
41 -- after the refine patch (40), before anything imported (50+), depth test
off like every drape. The canvas starts transparent so unloaded parts show the
globe; the roof shader paints grey where alpha is still zero. z18 would be
4096 px and 256 requests per tile, which sixteen tiles cannot carry.

The Explorer entry is the shared flight sim's own panel, titled Earth Flight
(see the next section); the buildings/shadows switches sit in it.

### Bridges and the London Eye on the globe

The globe's building tiles come from the same worker as Earth Flight's, so they
carry the same bridge decks (raised slabs and ribbons from the transportation
layer, with piers and an under-deck water patch) and the same wheel for the
London Eye in place of its ~150 floating parts. On the globe there is no DEM
under a tile (the ground is drawn at the tapered relief), so decks stand at
4–6 m above the tile plane. See `flight_sim/earth/game/structures.js`.

## Earth Flight is the shared flight sim, flown inside GeoHUB

Earth Flight used to be its own page. It is now `scripts/flightsim.js` -- the
mode Mars and every rocky world fly -- running on this globe:
`earth-viewer.js` publishes `window.__flightSimHooks` (this viewer descends
from Mars's, so the hooks are its own internals under the same names), calls
`__flightSim.update(camera)` after the orbit-camera rules in `render()`, and
skips the zoom easing while flying. `gis/earth-flight-entry.js` places the
sim's injected `#flightsim-section` first in Explorer as "Earth Flight", adds
the buildings/shadows/trees status, and answers `?flight=earth&lat=&lon=`
(which the shell carries into the frame; `/flight_sim/earth/` bounces there).

Unlike the other worlds it flies with the **chrome open** (asked for,
2026-10-24): `body.fs-open-chrome` exempts it from every "flight hides this"
rule in `styles/flightsim.css` and from the nav collapse, and the draw HUD
does not put its tools away. The nav, Workspace, rail and every GIS tool work
in the air; the throttle/boost meters step right of the Workspace box.

Things that bit, each measured:

- **The planet turned under the aircraft.** The sim spins the world at its
  real sidereal rate in flight; Earth's ground moves 290 m/s at London's
  latitude, so a ship at 120 m/s launched east drifted west. Earth's profile
  sets `coRotate`: the ship is carried round the axis each frame by the angle
  the globe turned.
- **A "1 km" launch came out at 2 km.** The drawn relief tapers with CAMERA
  height (`getEffectiveTerrainRelief`), and the spawn radius was read with the
  camera still up in pre-flight. `engage` now reads the ground with the camera
  placed at the provisional spawn (two passes).
- **Layers never refined in flight, then refined to the horizon.**
  `onViewSettled` never fires for a camera that never stops, and a cockpit
  frustum box runs to the horizon. `view-extent.js` now fires settled every
  2.5 s while flying and clips `visibleBounds` to `nearFieldBounds` -- a square
  1.2 x the horizon distance round the ship (25-600 km). Shorter than the
  horizon was tried: the base sphere's facets sag below the line of sight from
  a few hundred metres, so past the refined patch there was black space.
- **Trees** come from the same building tiles: OpenMapTiles `landcover`
  (`wood`, `grass/park`, `scrub`) scattered on a hashed jittered grid
  (`structures.js` `scatterTrees`, max 7,000 per tile), drawn as one
  InstancedMesh per tile with the buildings' matrix.

**Verifying from a worktree.** The viewer loads `/scripts/flightsim.js` and
`/styles/flightsim.css` by ABSOLUTE path, so through the shared 8125 server
they come from the main checkout, not the worktree. Rewrite them with CDP
`Fetch` -- and set `Network.setBypassServiceWorker`, because the root service
worker fetches on the page's behalf and the page's Fetch never sees it.
## Earth Flight flies over its own terrain, not the globe's relief

The globe's relief (a ~10 km GEBCO texture, normalised from the deepest trench
and eased to nothing below ~300 km by `getEffectiveTerrainRelief`) gives flat
ground at flight altitudes, and cannot simply be left on: true scale lifts
sea-level ground ~11 km off the sphere every other layer is drawn on. So flight
keeps its terrain BESIDE the globe (`gis/flight-terrain.js`):

- heights are the streamed DEM (`dem-tiles.js` Terrarium, z12-14 near the
  aircraft), sea held at 0, times the Vertical scale slider (1 = true scale);
  the globe's own relief is held at 0 in flight (`ownTerrain` profile flag in
  `scripts/flightsim.js`, so `applyVex` zeroes `terrainScale`);
- the three imagery bands ahead (`basemap-drape.js`, close / near / mid) are
  96x96 grids lifted to it, depth-tested, finer bands polygon-offset over
  coarser, and each coarser band DISCARDS where the next finer one is opaque
  (`updateCuts`) -- a coarse grid sits metres above a fine one in every valley
  and otherwise wins the depth test in dark blotches;
- building tiles carry a 65x65 height grid (metres x scale) to the worker, so
  buildings and the canopy stand on their own ground; their sharp ground drape
  and shadow catcher are lifted by the same grid; all tiles rebuild when the
  scale changes or terrain comes on/off (not on every DEM tile);
- the sim reads it through `hooks.flightTerrainUnits` (altitude, floor,
  collision) and `hooks.flightGroundMetres` (the GROUND readout, true metres);
  event markers (`events.js markerPoint`) and place labels add it radially.
  `viewer.surfacePoint` is deliberately unchanged: the drapes bake it into their
  relief shader and the building tiles are placed with it.

Known gaps: imported vector layers and geology still drape on the flat globe
(depthTest off), so in steep terrain a line can sit at the foot of a hill it
should cross; a place label is not hidden behind a mountain in front of it.
