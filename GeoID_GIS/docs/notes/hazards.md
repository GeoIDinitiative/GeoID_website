# Hazards: soil thickness, cyclones, volcanoes, seismic, landslides, flood, exposure, risk reader, total risk

Working notes moved verbatim from GeoID_GIS/CLAUDE.md (2026-10-17), in their
original order. The index is GeoID_GIS/CLAUDE.md; ask the code graph first
(see there) and read the section here that it points you at.

## Soil and sediment thickness: the one dataset that needed no bake

Pelletier et al. (2016), ORNL DAAC, doi:10.3334/ORNLDAAC/1304 — the modelled
thickness of the permeable layers above bedrock on a 30-arcsecond grid, 0 to
50 m, clipped at 60°S. It is the companion to the SLOPE map rather than to the
soil map it sits beside: FAO says what the soil IS, this says how much there is
to move.

**It is behind Earthdata Login and no amount of cleverness gets past that.**
Every `.tif` sits under `/protected/` and a request 302s to
`urs.earthdata.nasa.gov` — the "200" you get is the login page wearing a `.tif`
name. The `/public/` tree holds only the documentation PDF, the THREDDS
catalogue 400s, `webmap.ornl.gov` does not connect, there is no open mirror on
OpenTopography or Zenodo, and it is not among the 1,142 datasets in the baked
GEE catalogue. The file arrived because the reader downloaded it.

**File 6 of the six is the one to draw**, and that is a decision rather than a
default: it is a weighted mosaic of the hillslope soil and valley-bottom
sediment grids, weighted by area AND topographic wetness index, because all the
water leaves through the valley bottoms whatever fraction of the ground they
are. The others are the components and an experimental regolith grid.

### No pyramid, because the file already is one

Everything else global here is cut into tiles — vectors that a browser cannot
window, or rasters with no other way in. This is **one Cloud-Optimised GeoTIFF
with seven internal overviews**, the bucket answers byte ranges, and the
vendored geotiff.js reads the window at the level a view deserves. The work a
bake would have done is in the file, done by the people who published it.

    gdalwarp -ot Byte -srcnodata -1 -dstnodata 255 -of COG \
      -co COMPRESS=DEFLATE -co PREDICTOR=2 -co BLOCKSIZE=512 \
      -co RESAMPLING=AVERAGE -co OVERVIEW_RESAMPLING=AVERAGE ...

**Byte with 255 as nodata, not the source's Int8 with −1.** Values are 0–50 so
they fit a byte exactly, and `-ot Byte` alone would have CLAMPED −1 to 0 —
turning "not modelled" into "no soil", silently, over every ocean. `gdalwarp`'s
`-srcnodata/-dstnodata` is what carries the distinction across. 73 MB in, 99 MB
out with the overviews; verified against the source at five coordinates before
it was uploaded (Alps 1 m, London 50, NI 1, Amazon 27, Dead Sea nodata).

Published with `publish-data.py`, which grew a `NESTED_FILES` list: a dataset
that is a single large file has no pyramid to ride with, and it still needs a
fingerprint in `sources.json` because the bucket serves it immutable for a year.

### Two walls between the file and the page, and neither says what it is

- **The vendored geotiff.js is a UMD bundle.** `import("../vendor/geotiff.js")`
  resolves to an EMPTY namespace and the error is `fromUrl is not a function`,
  which reads as a broken library rather than as the wrong loader. It attaches
  to `window.GeoTIFF`, and `geotiff-adapter.js` has always had the loader for
  it — now exported, because a second script tag would fetch 317 kB twice.
- **Cloudflare's hotlink protection 403s a `.tif` by REFERER.** Measured on the
  same URL, varying only the Referer: **none → 206, `localhost:8125` → 403,
  `geoidinitiative.com` → 206**, while a `.json` on the same bucket with the
  same Referer returns 200. In a browser that 403 carries no CORS header, so it
  arrives as a bare `TypeError: Failed to fetch`. The object is named
  `soil_thickness_1km.hotlink-ok.tif` — the same exemption the viewer assets
  use, applied to a filename rather than a directory.

Verified live over the Alps: a 1,600 × 670 window read from the 94 MB file,
legend 0–50 m, and the values are the ground rather than a picture of it —
**Alps 1 m, Rhône valley 16 m, Po valley and Milan 50 m**, which is bare rock
on the ridges and the basin fill at the model's ceiling.

**And a heredoc ate the backticks in this module's comments.** An unquoted
`<<EOF` runs command substitution, so every `` `fromUrl` `` and `` `readRasters` ``
in the prose was executed by the shell and replaced with nothing — the file
parsed perfectly and its comments had holes. Quote the delimiter (`<<'EOF'`)
and substitute the stamp afterwards. Same family as the STYLE-literal backtick,
which this file records five times.

#### The layer sat beside the coast, and it was the window's own snapping

"The mapping of the soil thickness isn't fully coupled to the surface — see the
offset as we zoom in." It was, and the fix is one line about which bounds the
image is labelled with.

`readWindow` snaps the request OUT to whole source pixels — `floor` on the west
and north, `ceil` on the east and south — because a COG is read in pixels. The
image that comes back therefore covers up to one source pixel more than was
asked for on every side, and it was being labelled with the REQUEST. Stretching
it onto those bounds is a fixed error of up to 30 arcseconds: **930 m at the
equator**, invisible from orbit and the whole story at a fjord, where the land
colouring slides off the shoreline and paints the water.

It reports the bounds of the pixels it actually read now. Verified over the
Marlborough Sounds at 199 km: the layer's own bounds land on whole pixel
indices — west 172.05833° is grid column **42,247.0**, north −40.2° is row
**15,624.0** — and the colouring follows the coast with the sea left clear.

#### And 0 m is not nothing

Asked whether a raster calculator should drop zero-thickness cells. **No**, and
the file is the reason: it distinguishes them deliberately. The sea is −1
(stored 255 here) and bare rock is 0, and measured over a 3° × 2° window on New
Zealand there are 47,151 valid cells of which **16.4% are exactly 0** — the
Southern Alps, which is precisely the ground a landslide study is about. A cell
that says "modelled, and there is nothing above the bedrock" is an answer;
turning it into nodata would delete that answer from the data as well as from
the picture, and every tool downstream reads the band.

What the zeros were doing in that screenshot was nothing: the pale ground over
the water was the misregistration above, not the low end of the ramp.

### A raster answers a click

"Can we implement the interactive feature used for the geology polygons — only
this time each click samples the thickness raster at that exact point?" Yes,
and it took one line in the click path, because the machinery around it was
already right.

`feature-popup.js` hit-tests in COORDINATES, not in geometry: a click asks the
viewer for the lat/lon of the pixel and tests it against each visible layer's
GeoJSON. **A raster has no GeoJSON**, so a sheet always fell into the branch
that dismisses the card for landing on nothing — the soil-thickness map was a
picture with a legend, unclickable by construction rather than by oversight.
Sheets are offered the click there, before the dismissal, and answer TRUE
synchronously to claim it; the read and the card follow on their own. The next
sheet that wants a click adds its line in the order it draws.

**The value comes from the file, not from the picture.** The drawn sheet is
resampled to at most 1,600 px across the view, so at a wide view one of its
pixels is dozens of source cells and its colour is their blend — sampling it
would answer a question about a point with a number that exists nowhere in the
data. `sampleAt` reads a one-pixel window at full resolution: the COG is tiled,
so that is one byte range, and geotiff.js keeps the tile. Measured: **3.7 s**
for the first read of a session (opening the file), **35–60 ms** after it, and
**2 ms** for a second click in the same tile.

Read back against ground truth: Amazon lowland **27 m**, Malian basin **50 m**
(the model's ceiling), Sahara hamada **0 m**, mid-Atlantic **nodata**, the high
Himalaya **nodata** — the model excludes ice — and 60°S+ outside the grid
altogether. Three answers, three cards: a number, "Not modelled here", and
"Outside the model". Zero keeps its number and gets a line saying what the
model means by it; nodata never gets one, which is the same distinction the
file makes and the bake preserves.

#### `rockClass` reads the description, so `written` has to cover the basis too

The card was headed correctly and then announced, three rows down,
**"Basis — Interpreted: rock class from the unit's own lithology."** There is
no unit and no lithology: `rockClass(lithology, description, name)` also reads
the DESCRIPTION, and the thickness card's own line — "Above bedrock: soil,
regolith and sedimentary deposits" — matched on the word *sedimentary*.

`written` (`feature.ice || feature.soil`) already stops the kicker and title
being re-derived. The classification BASIS row was outside that guard, so a
card that had written its own three lines still stated the basis of a
classification it never made. It is inside it now. The general form: a card
that opts out of classification opts out of everything downstream of the
classifier, and prose fed to a keyword matcher will eventually match.

#### The first click is a different click

Steady state is **48–165 ms**, which is imperceptible. The FIRST click of a
session was **3–7 seconds**, because the sheet is drawn from an overview and a
click reads full resolution: the two share the open file and nothing else, so
level 0's tile directory is fetched by the first click that needs it.

Two things, and both were needed. `addThickness` fires one throwaway read at
the view centre while the reader is still watching the sheet appear, which
pays off the directory — that alone took the first click to 2.3 s. And a
placeholder card on a **250 ms fuse** says "Reading…" at the point, replaced
in place when the value lands. Measured on a fresh page: card at **+268 ms**,
value at **+3.6 s**; and on warm clicks the placeholder never appears at all,
because 48–118 ms never reaches the fuse. A click that does nothing for two
seconds has told the reader the map is not clickable, and they do not click it
again.

### The sheet moved because the ground did

"Thickness map still moves as we zoom in and out, needs to be tight to surface
and stable." Every measurement I had taken said it was tight — 0.11 m at the
vertices, 0.3 m across the facets, nothing lost to the depth test. **Every one
of them was taken at rest**, which is the only moment the old mechanism was
correct, and that is why two reports in a row read as unreproducible.

The globe's terrain exaggeration eases off continuously as the camera
descends, so the surface is at a different height in every frame of a zoom. A
raster patch is laid on that surface once, at build time, and was corrected by
a **250 ms poll** with a 10 m tolerance. Measured over a three-second zoom from
145 km to 20 km: the relief the sheet's vertices were laid at differed from the
one the globe was drawn with by a **mean of 4.1 km** and a **worst of 20 km**,
and the trace sawtooths — 0 m, 8.2 km, 3.3 km, 14.6 km, 7.7 km, 2.3 km — the
patch falling behind the ground, being snapped back, and falling behind again.
Four corrections a second against a surface that moves sixty times a second.

The imported vector layers solved this long ago and the fix is to stop having
two mechanisms: each vertex carries its direction and its displacement as a
FRACTION of the relief it was built with, and one uniform — set from the
viewer's own relief in the same loop that spins the globe — places them on the
GPU every frame, for free. A drape is that problem with a texture on it.
`attachReliefAttributes` + `followRelief`, and `registerDrape` demoted to the
fallback.

After: **0.00 m of lag in all 181 frames** of the same zoom, and the GPU path
reproduces `surfacePoint` to a **mean of 3.1 m, worst 7.1 m** across a swing of
relief worth 74 km of vertical movement — which is float32 storage, not
modelling: one ulp at a radius of 3.2 units is 0.95 m of ground.

Two things the follow needs and the poll did not. A patch built at **zero
relief** cannot be followed — dividing it out gives every vertex a
displacement of zero, which pins the patch to the bare sphere while the terrain
rises 219 km away from it — so that case is refused and polled, and promoted
the moment a rebuild catches it at a live relief. And the bounding sphere is
computed from `position`, which the shader no longer draws at, so a followed
drape stops being frustum culled rather than blinking out at a grazing view.

This was never about the soil sheet. Every raster drape on the globe — the
elevation, slope and hillshade sheets, every imported GeoTIFF, every GEE
export — went through the same builder and had the same fault.

### The basemap card asked to be folded and was refused

"Ensure on the legend that the basemap entry is always formatted as a drop
down (collapsed by default)." It had asked to be, since the day it was
written: `legendFold = "collapsed"` and `legendAutoOpen = "never"` are both on
the card in `basemapCard()`. Nothing read them.

`makeFoldable` opens with a rule that earns its place — **one entry does not
fold**, because a chevron over a line that is already visible offers a choice
between seeing it and not seeing it. The basemap card has exactly one symbol
row, so the rule marked it `static` and RETURNED before the card's own request
was ever looked at. Underneath that one row sits the licence the streamed
imagery is free only on condition of: a paragraph, open in the key,
permanently, pushing the layers a reader actually loaded down the panel.

The count rule now yields to an explicit request. A card that sets
`legendFold` is saying something the count cannot see — that what hangs off its
one row is worth putting away — and everything else with a single entry still
gets no chevron. Verified: `foldable="1"`, folded on first paint, the licence
hidden, the caret and pointer cursor present, opens on click, and a re-render
does not shut it again while it is being read.

### A modelled layer shows its working

"When we activate a modelled dataset — slope, landslide risk — the ⓘ beside it
should detail the equations used in its calculation, in full."

The reason it matters more than it sounds: **a slope map is not a
measurement.** It is Horn's estimator run over a resampled grid at whatever
cell size the current view happens to give, and the same hillside reads 21° on
a 30 m grid and 14° on a 90 m one — pinned as a test, not asserted. Neither is
wrong. A reader who cannot see the arithmetic cannot tell which they are
holding, and a screening model whose method is a secret has authority it has
not earned.

`equations.js` is the one registry, keyed by dataset id, and every entry says
which of two things it is. **Computed here** — the streamed DEM's Terrarium
decode, slope, hillshade, and the infinite-slope Factor of Safety — prints the
expressions, every symbol, and the assumptions. **Modelled elsewhere** — the
Pelletier thickness — names the model, cites it, and states only what our own
bake did to its numbers, which is a different claim and must not read as ours.
A dataset with nothing to state gets no fold at all: a survey is not a model,
and an empty "How it is calculated" would suggest everything here is one.

#### The test RUNS the card

A comment drifts from its function silently. Published on a layer's ⓘ as how a
number was produced, that stops being untidy and becomes a false statement
about data somebody may act on. So `equations.test.mjs` transcribes each
printed expression — from the card, not from the source it documents — and
runs it against the real function over a synthetic surface, every interior cell.
It found two things immediately: the bands come back as `Float32Array`, so the
app's own answer is already rounded to seven digits and a double-precision
comparison fails on storage rather than arithmetic; and the FoS card's "flat
ground returns no answer" is really **below 5°**, which the card now says,
pinned to the code's own `minSlopeDeg`.

#### And a card that grew had nowhere to grow into

The popover was placed once, at open, which was safe while every card was a
summary and a citation. Unfolding the working changes its height afterwards:
measured on the slope card, **157 px shut and 665 px open**, running 459 px
past the bottom of an 860 px window — the symbol list and the citation off the
end of a `position: fixed` element with no way to scroll to them. It is capped
at `100vh - 1rem` with `overflow-y: auto` now, and the placement re-runs on the
fold's `toggle`. Verified: opening it moves the card from y=506 to y=8 and it
lands fully on screen, and under an imposed 300 px cap it scrolls and the
citation is still reachable.

#### The ⓘ follows the layer, not the row that started it

A catalogue row is a tab you tick once; the layer then lives in the Workspace
for the rest of the session, where there was no ⓘ at all. And the layer with
the most to explain never had a catalogue row in the first place — **GeoID
mode BUILDS its Factor of Safety layer**, so the one surface on the globe
carrying an engineering model was the only one with nowhere to say which model.

A layer carrying `info.maths` draws the same button, opening the same card,
from wherever it is: the FoS layer, the streamed slope and hillshade sheets,
and the thickness sheet.

**"Only those" was wrong, and so was excluding a catalogue layer.** The
reasoning — an ⓘ on every row is a column of buttons most of which repeat the
row, and a catalogue layer already has one in its nav tab — was about the
wrong question. A row says a name, a kind and an opacity; it says nothing
about **where the layer came from, under what licence, in what CRS, or how
much it holds**, which is what somebody asking "what IS this" of a row wants.
And a catalogue tab may have been ticked once and never opened again while the
layer lives in the Workspace for the session. **Every row draws one now**, on
request.

There is still ONE card: two doors to one card is not the fault, two CARDS
would be. `provenanceOf(layer)` is the single builder — metadata first, then
`info` (which is where an ADOPTED layer states its provenance), then the layer
— and the Metadata tab reads it too, with the citation as a row rather than
its own line. Pinned by COUNTING: the CRS row may be built exactly once in the
file, since a second list anywhere is the drift. The card shows the working
where there is working, the provenance always, the citation where one is
stated, and `entry.info.rows` is the seam that carries it.

**THE BASEMAP IS A WORKSPACE ENTRY TOO**, drawn by its own path, so the imagery
every visitor is looking at was the one row without an ⓘ — and the one that
most needs it, since Esri's World Imagery and EOX's Sentinel-2 mosaic are both
free only on terms. Its row holds four children rather than eight and takes a
template of its own, or the stack's gives the slack to the ⓘ and squeezes the
name to its text. Two traps in its card, both found by reading it live: the
field on a tile source is **`credit`, not `attribution`**, and `credit` itself
falls back to the LICENCE — so a plausible `attribution` read gave the card no
attribution at all and printed the licence twice, once as a row and again as
the source line under it. Who made it goes on the source line, on what terms
in the rows.

Two things it needed. The stylesheet is installed by `renderCatalogue`, so an
ⓘ on a layer row was an unstyled letter until the reader happened to open a
catalogue tab; `datasetInfoButton` asks for it itself now. And the row is a
fixed **seven-column grid** — an eighth child without an eighth column pushes
the move buttons onto a second line, measured at **32 px becoming 58 px**, and
only on that row, so a modelled layer would sit a step taller than its
neighbours. `has-info` carries the extra column, and the test pins the two
templates to differ by exactly one.

### The geometric patterns on the poles

"What are these geometric patterns on the poles of the soils dataset?" — a
diamond drawn across the Arctic with fainter arcs behind it. Three things
compounding, and only the last is fixed here.

**The belts are real.** The soil map's Arctic units — Lithosols, Gelic
Gleysols, Regosols — run for thousands of kilometres and are a tenth of a
degree wide.

**The bake flattens them.** `bake-soil.py` simplifies in degrees: 0.2° at zoom
0, 0.08 at 1, 0.01 at 2–3, 0.0025 at 4–5. The tolerance is wider than the belt,
so Douglas–Peucker deletes every vertex between its ends and what survives is a
five-point rectangle. Dumped whole out of tile `2/2/0`:

    Gelic Gleysols  [0,68.753] [90,68.784] [90,68.712] [0,68.712] [0,68.753]

**The tiler clips them to tile edges**, so a surviving edge is exactly one tile
wide at every level — and it is exact: **359.9° at z0, 180.0 at z1, 90.0 at z2,
45.0 at z3, 22.5 at z4, and none at z5.** The four 90° chords of zoom 2 ARE the
diamond. The same signature is in the world geology and GLiM pyramids (four 90°
spans apiece at z2), where thicker units make it less visible.

**And the renderer drew them as chords.** A straight line between two points on
a sphere passes under the surface, and across ninety degrees it passes through
the planet. The fill draws with `depthTest: false` — it relies on `FrontSide`
culling instead — so the triangle is painted anyway, over the ocean and the
pole. Counted in one view: **437 triangles with an edge over 400 km, the worst
3,873.**

#### Densifying the ring does not fix it

The obvious move — split ring edges before triangulating, the way `pushSegment`
has done for lines since the sag was first measured — **does not work**, and
that is the part worth keeping. With ninety vertices along the top of the strip
and ninety along the bottom, ear clipping is still free to answer with a
triangle joining one end to the other: measured, the densified ring gave 180
triangles whose worst edge was still **3,263 km**, at 18× the triangle count.

A triangulation is a choice among many, so the invariant has to hold on the
OUTPUT. `splitLongEdges` bisects any triangle carrying too long an edge across
that edge until none does.

Two numbers were measured rather than chosen. **The depth cap**: longest-edge
bisection needs about two levels per halving on a sliver, so a cap of 12 bought
only six and left 5.6° edges; at 20 the recursion ends on the edge rule instead
and the cap is only a guard against a NaN. **The threshold**: 2°, not the line
rule's 1° — a line is thin and lifted, a fill only needs its sag invisible, and
2° sags 130 m against 147 km for the original chord. At 1° the pathological
whole-world sliver costs 39,366 triangles; at 2°, 13,122; at 3° the sag reaches
half a kilometre for little more saving.

**The real cost is not the synthetic one.** On the actual soil map, whole:

| | before | after |
| --- | --- | --- |
| fill triangles | 1,680,141 | 1,771,376 (+5.4%) |
| load | 23.8 s | 25.1 s |
| edges over 400 km | **2,170** | **0** |
| worst edge | **3,873 km** | 306 km |

It does NOT fix the data: a belt reduced to a rectangle is still the wrong
shape, now lying on the ground instead of cutting under it. The bake-side fix
is to drop a polygon whose simplified area has collapsed, and that needs the
source and a re-bake.

#### And then the arcs, which were the same fault wearing the ground

"Geometric seam still exists on world soil map." The diamond was gone and a set
of fine concentric arcs remained — because the chord fix had done exactly what
it said and no more: the collapsed belts now **lie on the ground**, and a
rectangle 90° wide lying on the ground traces its own parallel.

The shape was always the problem, and a shape with no area cannot be drawn
correctly. Measured in tile coordinates, where the claim is exact: of 248,268
rings in the soil pyramid, 424 run 90% of a tile, and splitting those by
vertex count separates them completely —

| vertices | rings | thinnest |
| --- | --- | --- |
| 40+ | 131 | 746 units of 4096 |
| 13–40 | 1 | 4096 |
| 7–12 | 10 | 23 |
| 4–6 | 282 | 2 |

Nothing with many vertices is thin: a belt digitised at 1:5,000,000 and
spanning ten thousand kilometres has hundreds of them. And among rings with
twelve or fewer, thinness runs 2, 3, 3 … 202, 204 and then jumps straight to
4096 — eight units that legitimately fill their tile. `mvt.js` drops rings in
that gap: full-tile run, ≤12 vertices, under an eighth of a tile thick.

**284 rings of 248,268 go — 0.11%** — and the soil pyramid's collapsed slivers
fall from 285 to 1, geology to 3, GLiM to 7, with exactly 280 features fewer of
209,324. Two thresholds were tried and rejected on measurement first: a plain
thinness rule dropped 14,000 real rings at zoom 0 (one unit is ten kilometres
there) while missing the artefacts, and an aspect rule would have taken the
Nile valley with it.

### A merged soil map is a profile, not a layer

"Should we create a unified soil map combining thickness, soils of the world
and the superficial geology polygons?" Yes — and **not as a blended raster**.

The three answer different questions at different resolutions over different
extents: BGS superficial (1:625,000, **UK only**), FAO's soils (1:5,000,000,
global), Pelletier's thickness (1 km, global, modelled). Blending them makes a
map whose meaning changes at the UK border with nothing on the pixel to say
which — the same fault as a picture claiming a precision its source never had —
and it destroys the most useful thing in the set: where BGS maps 3 m of till
and Pelletier models 12 m, the DISAGREEMENT is the signal.

So `ground-profile.js` assembles them per point, every line naming its own
source and scale, plus the slope. Three things it does that a blend cannot:

**The strength comes from the best-mapped answer, and says which.** Superficial
where it exists, because it is eight times the scale and it is what the
strength table is keyed on; the soil map elsewhere. A c′ from a 1:625,000 map
and a c′ from a 1:5,000,000 one are not the same claim.

**A FAO unit name is not a material — its texture is.** "Dystric Cambisols"
matches no lithology word, so every point outside the UK fell to the strength
table's no-information default. FAO publishes the topsoil's sand, silt and clay
per unit and the dominant fraction IS a keyword the table holds: measured over
Donegal, 37% clay → c′ 10 kPa, φ′ 22°, γ 18 kN/m³, and the card says it came
from a typical texture rather than a mapped deposit.

**The thickness is not the failure depth.** Pelletier models the whole
permeable column — 50 m in a valley fill — and the infinite-slope model assumes
a plane parallel to the ground. The profile offers `min(thickness, 3 m)` to FoS
and prints both numbers with the reason, rather than quietly substituting one
for the other.

#### Two things only the globe could have told me

**The card has three parents and I hooked the wrong one.** The FAO soils arrive
as a `geologyDataset`, so their click card is built by `geology-panel.js` and
raised by the viewer — the vector popup's path never runs for them, and a hook
there never fired. `openGeoPopup` is where every card meets: tiled maps,
imported vectors, the thickness sheet. One hook there reaches all of them.

**And the tiled maps are held twice.** The viewer keeps an interactive
catalogue of the polygons; the import manager keeps the layer's features. The
card is drawn from the first and the profile read the second — measured, three
seconds after flying to Donegal the card said Dystric Cambisols while
`featuresAt` found nothing at the same coordinate, and the profile silently
dropped the two rows the click was most about. It falls back to the catalogue
the card itself came from, reading FAO's texture back off the card's own rows.

Also fixed while finding that: a profile appended to one card **outlived it**.
`openGeoPopup` rebuilds by refilling its named elements, so anything added
alongside them survives — a click on Donegal showed the profile of a click made
in the Bering Sea, every field plausible and every field wrong. It is cleared
on every card now, not only before appending a new one.

#### The depth was the last term that was not a property of the place

The Factor of Safety takes c′, φ′ and γ from the mapped lithology, β from the
DEM and m from the weather — and **z from a constant**: 1.0 to 2.5 m by
lithology class, the same number over a whole map, because there was nothing
spatial to put there. Pelletier's raster is spatial, and it is not that number:
it models the entire permeable column, up to 50 m in a valley fill, while an
infinite-slope model assumes a plane parallel to the ground and long compared
with its depth.

So it enters as `min(thickness, 3 m)` — a real spatial floor where the cover is
thin, which is where shallow failures happen and where the constant was most
wrong, and the model's own assumption where it is deep. `failureDepth` returns
both the number and where it came from; where the model has no reading the
class default stands and the run says how many cells were modelled rather than
assumed. Measured over a 1° × 0.6° study area: **2,515 of 2,596 cells** took a
modelled depth, spanning 0 to 3 m, where every one of them had been 2.5 m.

**A sampler reads the source cells; the drawn sheet does not have to.** Forty
thousand byte ranges is not a way to fill in a column, so the study area is
read once — but `readWindow` asks for a SIZE, and geotiff.js then answers from
whichever overview fits it, which is right for a picture and wrong for a
reading. Measured over Northern Ireland: five of six probes matched `sampleAt`
and Belfast came back **27 m against 45**, a resampled average of the Lagan
valley fill and the slope above it. `thicknessGridFor` reads the window with no
size at all — the native cells — with a four-million-cell ceiling past which it
falls back and says `native: false`.

**And then the index rounded differently.** Scaling a fraction of the window
(`(north − lat) / (north − south) × height`) is the same algebra as dividing by
the cell size and floors one row earlier at some latitudes: Belfast again, 27
against 45. `metresIn` now computes the absolute cell exactly as `cellAt` does
and subtracts the window's own origin, so agreement is by construction. It
lives in `thickness-probe.js` beside the function it must agree with. Verified
on a 120-point lattice over Northern Ireland: **zero disagreements**.

#### The merged map, complete

All three sources answering at one point, over the Sperrins, with the finer map
taking the strength:

    Superficial deposit    Peat — BGS 1:625,000, UK only
    Soil unit              Dystric Cambisols — FAO/UNESCO DSMW, 1:5,000,000
    Thickness above bedrock 1 m — Pelletier et al. (2016), 1 km grid, modelled
    Slope                  0.4° — Streamed DEM
    Screening strength     peat: c′ 5 kPa, φ′ 20°, γ 11 kN/m³
                           — from the superficial map's own deposit
    Depth to failure plane 1 m — the modelled thickness, under the 3 m cap

Peat rather than the soil map's clay, because a 1:625,000 mapped deposit beats
a texture inferred from a 1:5,000,000 unit — and the card says which, because
those are not the same claim.

### The Model Builder: elements where the ground needs them

Most of the pipeline was already there — six steps, a role per layer, a
watertight terrain-plus-skirt-plus-base STL, embedded points, and physical
groups named `top`/`base`/`north`/`south`/`east`/`west`/`domain` that the
conditions step writes boundary conditions against. Three things were missing.

#### The DEM was whatever the view had loaded

`sampleElevationMeters` answers from the pyramid's current contents, which is
whatever the VIEW asked for — so a model built while zoomed out was carved from
zoom-6 posts however small its study area, and nothing said so. The Surface
step now clips first: `ensureBestDem` loads the study bounds before sampling
and reads through `heightAt`, the pyramid's own answer rather than the viewer's
interpolation of it.

**More tiles, not a higher ceiling.** The budget goes from 48 to 256 because a
study area is worth more than a glance, but the CAP stays `INFO_ZOOM`.
`dem-tiles` measured where the information runs out — z13 carries 7.69 m RMS of
real detail, z14 1.26, z15 **0.74, "interpolation, nothing more"** — so asking
for z15 would quadruple the tiles to buy the publisher's own resampling and let
this step report 2.8 m posts over ground surveyed at 30. Verified over the
Mournes: zoom 14, 5.6 m posts, 850 m at Slieve Donard, six seconds.

#### A hole in the source is not a landform

`dem-tiles` despikes each tile as it decodes and **cannot catch a block**: its
test is that a post's neighbours disagree with it, which fails when they are
bad too. Measured over the Mournes at zoom 14, a void two posts wide and four
tall — reading −448 to −3,042 m against ground at 4 to 13 — arrived in the
model grid as one node at **−3,173 m**. The relief read 4 km, and the new mesh
grading promptly spent its finest elements on the **88°** walls of a pit that
is not there.

On the model's own grid the block is a single node, because the grid is coarser
than the source's posts, so a median of the eight neighbours finds it exactly.
The tolerance scales with the spacing: at 57 m a 325 m step between nodes is an
80° wall and therefore a hole; at a kilometre the same step is a mountainside
and is left alone. Where the grid is too coarse to tell one from the other this
does nothing, which is the honest behaviour rather than a failure. Verified on
the real artifact: **1 node repaired, worst 3,187 m**, elevation −9 to 850
instead of −3,173 to 850, steepest slope 46.5° instead of 88°.

#### One mesh size for a study area is the wrong shape

It spends the same element count on a plateau as on the headwall above it.
`sizeField` computes a target size per node on the same lattice the terrain was
sampled on — no second sampling, no registration to get wrong — and
`structuredFieldText` writes it as gmsh's `Field.Structured`, a third file
beside the STL and the script.

The map from slope to size is linear in the **tangent**, not the angle: tan is
the rise the mesh has to resolve across a cell, and it separates 30° from 45°
the way degrees do not (0.58 against 1.0, where the angles are only a third
apart).

Three things have to be true together or the field is written and ignored —
and the mesh still builds, which is why this is worth naming:

- **`setAsBackgroundMesh`**, or the field is computed and no element consults it.
- **gmsh's own size sources off.** `MeshSizeExtendFromBoundary`,
  `MeshSizeFromPoints` and `MeshSizeFromCurvature` all default to on and win in
  exactly the places the field was written for — the terrain's own rim.
- **`createGeometry`** to regrade the ground. An STL merged and classified is a
  DISCRETE surface: its triangles ARE the mesh, so a field can otherwise only
  refine the volume underneath while the ground keeps whatever spacing the STL
  was written at. It is optional because it is also the slow step.

Refine regions come from a layer given the new `refine` role — a landslide
scar, a dam footprint — as a `Field.Box` with a taper, because a hard edge to a
refined box is a column of bad tetrahedra along it. `Field.Min` combines them,
so a box inside a coarse area refines it and the background field cannot undo
a box. Measured over the Mournes: 25 m on the slopes against 200 m on the flat.

#### And then it was run, which corrected it

gmsh 4.11.1 on the emitted package — a 25,290-triangle ridge STL, its size
field and its script — meshed in one pass: **44,301 nodes, 262,795 elements,
"No ill-shaped tets in the mesh :-)"**.

The grading is real, and the control is what proves it. The same domain and the
same sizes with **no field**:

| | tets | steep | flat | ratio |
| --- | --- | --- | --- | --- |
| no field | 17,967 | 380 m | 378 m | **0.99** |
| with the field | 240,582 | 55 m | 389 m | **7.09** |

With a refine box added over a notional dam site, the three regimes come out
40 m / 55 m / 361 m, and every physical group survives into the mesh — base,
domain, east, north, south, top, west, observation_points — with the embedded
gauge present as **one node at exactly (0, 0, 750)** rather than only as a
group that exists.

**The run also falsified a claim I had written into the code.** `remeshSurface`
existed on the belief that an STL merged into gmsh stays a discrete surface, so
a size field could only refine the volume while the ground kept the STL's own
spacing. Measured: the ground grades either way, because the script already
runs `classifySurfaces` and `createGeometry` before the field is consulted —
without a field the terrain came back at **267 m and 279 m** on a surface
written at a uniform 60, and with one at **40 m against 294**. The flag changed
the result by 1 m in 294. It is gone rather than kept as a comfort, and the
comment now says what was measured instead of what was expected.

#### The flags are the study's, and a name is not a flag

Compared against `etna_3d/input/gmsh_mesh.py`, the emitted script followed the
same recipe and differed in four ways — and one of them meant the mesh could
not enter GALES at all.

`gmsh_to_gales.py` reads the integer TAG, not the name: `int(result[5])` out of
the `$Entities` block, with an explicit refusal — *"gmsh did not write the
right physical tag for the i-th point"*. Measured on our own mesh before this:

    points     13   with a physical tag: 1
    curves     20   with a physical tag: 0
    surfaces   10   with a physical tag: 10
    volumes     1   with a physical tag: 1

A physical group on a FACE does not reach the curves and points beneath it,
which is exactly what etna's `addPhysicalGroup(1, [c1..c4], 5)` and
`addPhysicalGroup(0, [p1..p4], 5)` are for. So every face, the volume and every
embedded point now carries a number the study chooses, and the edges and
corners inherit their face's. After: **14/14 points, 20/20 curves, 10/10
surfaces, 1/1 volume**, and the GALES check passes.

**One flag is one group, and gmsh says so with an error.** Asking for a second
group at a number already used is not a merge — `Physical surface 5 already
exists`, which is how this was found, four sides into one lateral boundary.
Faces are gathered by number before any group is made, so four sides at 5 is a
single boundary named `east+north+south+west`, and distinct numbers keep them
apart. It is also how a shared edge is decided: the LOWEST flag owns the curve
and its corners, so the study settles that too by choosing its numbers.

The defaults follow etna's convention — volume 10, lateral boundaries together
at 5 — because a deck written against that pipeline already means those
integers.

Three differences remain, and they are choices rather than gaps. Etna builds
the box below the terrain in the geo kernel from a terrain-only STL, where we
bake the skirt and base into the STL: exact CAD walls against a footprint that
need not have four sides. Etna has `box_hole`, a rotatable internal cavity
subtracted from the domain — we have no internal volumes, only size fields,
which change element size and create no surface a BC can name. And etna sets
`Algorithm3D = 10` with `NumThreads`, and `MeshSizeFromCurvature = 20` — we
leave the algorithm to gmsh and switch curvature OFF deliberately, because it
overrides the background field in the places the field was written for.

### Subsurface and atmosphere: etna's box, and why it is built here instead

The requirement is etna's: the GIS page hands over the ground, and the model
page extends the boundary **down and up** into subsurface and atmosphere
domains. `etna_3d/input/gmsh_mesh.py` does that inside gmsh — `outer_box`
assembles four bottom points, four lines and five plane surfaces from
built-in CAD entities whose boundary is the STL's own discrete rim.

It was written out and **run, and it fails on real ground**:

    addPlaneSurface    → "Unable to recover the edge 23826 on curve 6"
    addSurfaceFilling  → "Cannot interpolate ruled surface with discrete
                          bounding curves"

The reason is measurable rather than mysterious. A side face's boundary
contains the terrain's rim, and a rim is only planar where the ground happens
to be flat as it leaves the study area. Probed on a ridge that crosses its own
boundary, **two of the four rim curves spanned 593 m in z** — a "plane surface"
through them is not a plane, its projection self-intersects, and the 2D mesher
cannot recover the constrained edges. The ruled alternative refuses discrete
curves outright. etna gets away with it because its footprint's rim is nearly
level; ours is not, and neither is most real terrain.

**A triangulated skirt conforms to any rim.** So the walls stay here, and what
moves to the model page is the DECISION — how far down, how far up — as a
parameter of the package rather than geometry baked into an STL that cannot be
changed without going back and resampling a DEM.

#### One file cannot carry both, and the STL invariant said so first

Writing the terrain once with a skirt going down from it and another going up
gives an interface shared by both volumes, conforming by construction. It is
also unreadable: those rim edges are then incident to **three** triangles, and
`classifySurfaces` refuses the file — *"wrong topology of triangulation for
parametrization"*. `stlStats.closed` had already gone false on exactly those
edges, which is what the invariant is for.

So each domain is its own watertight solid, its own volume, its own flags. They
share the ground exactly — same grid, same triangles, same flag — but they are
two meshes. A run needing ONE conforming mesh across the interface is further
work, not a flag.

#### A flat lid is named by where it sits

The position classifier was written for a subsurface shell, where the flat lid
is at the bottom and the ground is on top. Run against an atmosphere it put the
sky and the ground it stands on in the same boundary condition. A flat surface
is now `base` or `sky` by which half of the model it sits in, and whatever is
neither flat nor vertical is the ground — `top` in both shells, so a package
holding both keeps one flag for the one interface.

Verified with gmsh on both: every point, curve, surface and volume tagged, the
GALES check passing, and the groups distinct — subsurface `top 1 / base 2 /
sides 5 / domain 10`, atmosphere `top 1 / sky 4 / sides 6 / domain 11`.

### The live events wore the legend's colours and none of its shapes

"Aside from the earthquakes, none of the EONET live events have the
symbologies mapped as they should be as shown in the legend." Two independent
causes, and both were silent.

**Every category that was not an earthquake shared one round blob.** The
seismicity had its own texture — three concentric rings, the ◎ the panel shows
— and everything else took `markerTexture()`, a soft radial dot. So a legend
offering ▲ for a volcano, ◉ for a storm, ◆ for ice, ▬ for a flood, ▼ for a
landslide, ❄ for snow and ■ for something manmade drew seven identical dots,
and hue was the only thing separating them on the globe. There is a texture
per GLYPH now — painted white and tinted by the material exactly as the quake
rings are, so the wildfires and the volcanoes share one canvas because they
share one symbol. Verified by the ink itself: the triangle is **8 px wide at
30% of its height and 34 px at 72%**, while the ring and the diamond are
symmetric at 32 and 18.

**And two of them were white.** The volcanoes and the severe storms take their
hue from the skin, so the feed follows the theme. In the panel that works —
`style="color:var(--skin-chrome)"` is ordinary CSS. On the globe it does not,
and it does not throw: `new THREE.Color("var(--skin-chrome)")` warns to the
console and keeps the colour it was constructed with, which is **white**.
Measured against the live skin — the panel drew `#ff2bd6` and `#00e5ff`, the
markers `#ffffff`.

`resolveColour` lives in `event-sources.js` rather than beside the symbols,
because that file is the one a test can import: `events.js` wants a whole
document to load. Its reader is injected for the same reason. An unresolvable
`var()` is returned unchanged rather than replaced — THREE then warns about it,
which is better than drawing the wrong colour quietly, and that is exactly the
failure this was.

#### The floods were earthquakes, and the glyphs were centred on the wrong thing

"The floods still have the same symbol as the earthquakes." They *were*
earthquakes, as far as the marker code was concerned. `markerKey` banded by
magnitude whenever an event had a `sourceId` — which meant "did not come from
EONET", and that was true of the seismicity and of nothing else, until the
GDACS flood feed arrived. A flood has a source id, **no magnitude**, and landed
in the `quake-3` band: drawn with the earthquake's concentric rings, coloured
from the middle of the magnitude ramp, and listed under the earthquake symbol.
The test is now the thing the banding is *for* — a magnitude to band by — and
the floods are their own cloud, 43 of them at `#2f6bff` with the bar glyph.

**And the glyphs were centred on the em box rather than on their ink.**
`textBaseline: "middle"` centres the box the font declares, which a letter
fills and a geometric glyph does not. Measured on the first cut: the wildfire
dot came out **6 px of ink near the top of the canvas and nothing at all in the
lower half**, and the flood bar sat entirely below the middle. Both were
centred exactly as asked, and both drew as a smudge in the corner of an
eight-pixel sprite — which at globe scale is a marker in the wrong place.

Each glyph is drawn once to find where its ink lands, then redrawn scaled to a
common height and moved so that ink is centred. Verified: all five sit at
(32, 32) of a 64² canvas at 38–40 px across, and the wildfire's ink is **28.0%**
of the canvas against the 27.7% a filled disc of that diameter must be.

Wildfires are an orange round dot; volcanoes are red and pulse, which the
symbol table now says with `pulse: true` rather than a condition in the draw
code — the seismicity and the volcanoes are the two feeds reporting something
still happening while you look at them. Measured over 40 frames: the volcano
cloud's opacity swings 0.204 while the wildfires hold exactly steady.

### The markers stopped growing before the ground did

"These event symbols suffer as we zoom in — they become less distinct… note
these event location dots should be tight to surface (currently float)." Both
halves were one measurement away, and the measurement named the cause.

**Size was driven by the wrong variable.** `dotSizePx` scaled with the globe's
projected radius, which is right for the far field and says nothing near the
ground: measured, the globe covers **815 px at a thousand kilometres and 945 px
at three**, so `globePx * 0.022` was pinned at its 16 px cap through the entire
close range while the imagery under it gained three hundred times the detail.
Everything else sharpened and the markers did not.

Raising the cap changed nothing — the measurement caught that too — because
with `globePx` saturated, `globePx * 0.022` **is** the limit at 20.8 px. The
near-field size has to be *generated* rather than merely permitted, so the
larger of two rules wins: the projection above a thousand kilometres, and an
altitude ramp below it, 16 px growing to 34 by twenty. Now 9.2 px at 8,000 km,
18 at 1,000, 26.6 at 100, and 34 from ten down.

**And the lift was a constant 11.9 km.** `MARKER_LIFT = 0.006` of a 3.2 radius,
which reads as on the ground from orbit and puts the marker four times higher
than the camera at three kilometres up. The clearance only exists to cover the
gap between the elevation sampler and the rendered mesh — metres — so it is a
fraction of the distance to the surface now, capped at the old value so the far
field is untouched: **11.95 km at 8,000, 2 km at 100, 600 m at 30, 60 m at 3**.
The same rule and the same 0.006 that `vector-render` arrived at for the fault
traces, met a second time.

#### Annotation, and the three rules that stop it becoming a mess

A symbol says the CATEGORY and never which event, and close in that is the
question — standing over Vanuatu you want to know it is Ambae. The risk is
clustering, so this is deliberately timid: **only below 150 km**, **at most
eight**, taken nearest the middle of the view, and **never overlapping** — a
chip whose box clashes with one already placed is simply not drawn, because
dropping a label always beats stacking two.

Verified on the worst case in the live feed: the densest square degree held
**20 events** (the Aleutians), and at 150, 80, 40 and 15 km it drew 7–8 chips
with **zero overlapping pairs** at every altitude.

Screen-space DOM rather than the viewer's own label engine, which hangs a
sphere marker beside every chip — over a marker that IS the symbol, that draws
the event twice. The chips are `pointer-events: none`, so the marker underneath
still takes the click, and they come down with the frame loop when the feed is
switched off; DOM outlives a cancelled animation frame.

The pure halves — `liftForAltitude`, `dotSizePx`, `nearSizePx` — live in
`event-sources.js` beside `resolveColour`, for the same reason: `events.js`
wants a whole document before it will load, and these are the parts worth
pinning.

### The legend and the events feed are one slot, not two

Side by side they cost the top of the map twice over — two buttons always
showing, and a layout that moved: the feed placed itself by MEASURING the
legend, so opening the legend shifted the events button and a layer arriving
shifted it again. Neither is ever read at the same time as the other; they ask
different questions about the same globe.

They are a shuffle now. One card is in front at full size and contrast and is
the only one that may open a panel; the other sits behind it, moved up and
left, scaled to 0.86, turned −6° and greyed to 55%. Pressing the one at the
back deals it forward, opens it, and sends the other behind — closed, whatever
state it was left in, because two open panels is the thing being removed.

**The offset has to beat the width difference.** The cards are right-aligned
and the transform origin is their shared corner, so scaling alone pulls the
back card's left edge INWARDS. At 0.55rem it cleared the front card by five
pixels and read as a drop shadow rather than a card; at 1.7rem it peeks 12 px
to the left and 9 above — measured on the page with both buttons up, which is
the only way to get that number. Up and left, never down: the front card's
panel hangs below its button, and a back card offset downwards hides behind
the very thing it should be peeking out of.

**Capture, and it has to be.** Each card's own handler flips its own panel,
which for a card at the back is wrong twice: it would open a panel the stack
keeps hidden, and leave the card behind. So the shuffle runs first, in the
capture phase, opens the panel itself and stops the click — otherwise the
card's own listener fires immediately afterwards and toggles it straight shut.
A click on the front card is left alone; opening and closing its own panel is
exactly what its handler is for.

It lives in its own file because which card is in front belongs to neither of
them. The legend owns its toggle in `legend-dock.js` and the feed owns its own
in `events.js`, and each is right to; putting the order in one would make that
one the parent of the other, and the next card added to this corner would have
to be taught about both.

One consequence worth knowing: the legend auto-opens when a layer arrives, and
it cannot do that while it is at the back — the stack shuts it. That is the
intended reading. A card is at the back because somebody put it there, and
yanking it forward because a layer loaded is the "fights the user rather than
ignoring them" failure `legend-dock.js` already records about its own
auto-open.

#### The clearance is a ground measurement, not a camera one

"They are floating well above the surface currently" — still, after the lift
was made to shrink with altitude. The measurement said why, and it was not
that the rule had failed: over Nevados del Chillán at **123 km**, the marker
sat **2,490 m** above the rendered ground, and `liftForAltitude(123 km)` asks
for 2,470. The rule was working perfectly and the rule was wrong.

A fraction of the altitude fixes the close range and leaves the middle distance
exactly as bad, because the clearance was never a function of where the camera
is. What it is for is the disagreement between the elevation sampler and the
mesh the globe draws — measured at the same place and moment as **20 m**. So it
is a constant 30 m of ground, at every altitude. Nothing is hidden by having
almost none: these markers do not depth-test.

Verified against the sampler at 400, 150, 73, 22 and 6 km, with the relief
tapering 0.11 → 0.00013 across that range: **30 m at every one of them.**

(Raycasting the globe mesh for this is not the check it looks like — the same
five altitudes gave +983 m, −71 km, −51 km, +2,546 m and +30 m, because a ray
through a marker meets whatever terrain patch is in front of it. The sampler's
own surface is what `markerPoint` writes against and what the reading has to
be taken against.)

#### Twelve pixels of peek is hidden

"Now the live event button is hidden." It was not hidden — it was 12 px of dark
chip behind a dark chip, at 55% opacity under 75% grey, which is the same thing.
The offset is 2.9rem now and the dimming lighter, giving **29 px of card and
13 px of top edge**: the icon and an edge, enough to be a corner you can press.
Reported rather than measured, which is the lesson — the 12 px measured fine.

And a bug the report shook out: **a hidden card cannot be the front one.** The
feed's card exists only while Live Events is armed, so switching the feed off
while it was in front left the legend at the back — greyed, turned and shrunk,
with nothing in front of it to explain why. The stack now deals to the first
card that is actually on screen.

#### Two faults behind one word, and the geometry was never one of them

"At zoomed views the location dots are far too small", then "the rest of the
event locations are still floating too". Neither was about where the markers
are: every cloud, every marker, measured **exactly 30 m** above `surfacePoint`.

**The size, and it was my own doing.** The frame step read
`pulsing ? Math.min(size, QUAKE_BASE_CAP) : size` — the cap exists because an
earthquake then multiplies that base by 2.1 to 6.8 for magnitude and symbol,
and it is what stops a close-range M8 reaching 103 px. It was never about
breathing; it read `pulsing` only because for a long time the seismicity was
the only thing that breathed. Giving the volcanoes a pulse therefore capped
them at eight pixels with nothing to multiply it back: measured at 20 km, every
other category was 34 px and the volcanoes **8.9**. The cap belongs to the
multiplier, so it is keyed on the bands now, and the volcanoes match the other
categories to a tenth of a pixel at every altitude.

**The float, which was the size again in a different costume.** A
`THREE.Points` sprite is a screen-aligned quad CENTRED on its coordinate, so
half the symbol always sits above the ground it marks. That is invisible at
8.9 px and glaring at 34: seventeen pixels at 20 km altitude is about **750 m**
of apparent height. Making them bigger — which is what the previous report
asked for — is what made them float.

A category symbol stands on its point now: the ink is fitted into the UPPER
half of the canvas with its base on the centre, and the sprite is asked for at
twice the size so the ink keeps the pixels it was meant to have. Square canvas,
because a Points quad is square and a 1:2 texture would be squashed into it.
Measured on all five: ink base at y=31 of a 64 px canvas whose centre is 32,
centred horizontally, 34 px of ink in a 68 px quad.

The earthquake rings keep their centre. Concentric rings mean energy radiating
FROM a point, and standing them on the epicentre would say something else —
the one symbol here whose meaning is that it is centred.

**And a note on how not to measure this.** Raycasting the globe for the ground
under a marker gave +983 m, −71 km, −51 km, +2,546 m and +30 m at five
altitudes, then a clean ~10 km for every cloud at once. The globe displaces its
terrain on the GPU, so a CPU raycast hits the undisplaced sphere and the answer
is the relief itself. `surfacePoint` is the viewer's own answer for where the
ground is and the only thing a marker's placement can honestly be checked
against.

#### The globe is a sphere, and the ground you see is a drape

"Wildfires and the other event dots are NOT TIGHT TO THE SURFACE." They were
30 m above `surfacePoint` the whole time, which is why three attempts at this
found nothing — the reference was wrong.

**The globe's own mesh is not displaced at all.** Measured: 37,249 vertices,
`radiusMin === radiusMax === 3.2`, no displacement uniform. What you look at
close in is `GeoID-BasemapRefine`, a separate patch whose vertices DO carry the
terrain — 3.2315 to 3.2815 in the same view. Every raycast against `v.globe`
in this file's earlier notes was hitting a perfect sphere, which is why they
returned the relief itself (~10 km) and called it float.

Against the drape that is actually drawn, the markers measured **−675 m to
+1,219 m, mean +489** — some floating, some sunk.

**And the cause was a gate.** The watcher rewrote marker positions when the
RELIEF changed, and a relief change is not what moves the ground under a
marker: **the DEM refines as you fly in.** New tiles arrive, the basemap's
drape is rebuilt from the better elevations, and the markers keep the ones they
were placed with — no relief change, no clearance change, nothing rewrote them.
Which markers floated and which sank depended on where the DEM had been coarse
when the feed loaded, which is exactly the scatter that was measured.

The gate is gone: every tick re-samples every marker. Four hundred sampler
lookups two and a half times a second is nothing next to being wrong about
where they are. After: **27 to 50 m above the drape, mean 35** — the 30 m
clearance and a little drape interpolation.

The floods are a dot rather than a bar now, sharing the wildfires' glyph and
carrying their own blue — a flood alert is a place, and the bar read as a
legend swatch that had wandered onto the map.

#### A follower with nothing driving it

"Appears this floating dot problem is related to the mapping of the basemap —
see image theres 2 layers with an offset between." The photograph was of the
limb, and it was two Earths: a blue-green shell and a tan band offset from it.

**The markers were never the floating thing.** Measured, every marker in every
category sat at ground + 30.0 m, worst 30.2 — exactly the clearance it is given.
What had moved was the ground you look at. `getEffectiveRelief()` was 0.3 and
`getRenderRelief()` — the uniform every followed layer is actually drawn at —
was **0**. A followed vertex is placed at `aDir * (base + aDisp * uRelief)`, so
at zero it is placed on the bare sphere: the basemap drew **180 to 276 km below
the terrain** at the slider's maximum, and the dots stood correctly on a surface
whose imagery had sunk out from under them.

The uniform was pumped from `import-manager`'s frame step, and that step is
installed by `ensureGroups` when the first IMPORTED layer creates its group. A
page whose only follower is the basemap drape never installed it. Load a
geology layer and the offset vanishes, which is why this survived so long.

**The missing call was not the bug; that a follower could exist with nothing
driving it was.** So the pump moved to live with the uniform it feeds, in
`vector-render.js`: `followRelief` installs it, idempotent per scene, chained
onto whatever is already on `scene.onBeforeRender` so the import manager's own
step keeps running. Following the relief is now what drives it.

After: drape to ground **mean 0.10 m, worst 0.26 m** over all 625 vertices, and
across a 2,500 km → 37 km zoom the relief lag was **exactly zero** every frame
with a worst gap of 0.35 m.

**Four wrong references in one session, and this is the pattern.** Raycasting
`v.globe` hits an undisplaced sphere. Reading a drape's baked vertices reads
geometry the shader is about to override. And here, twice: the drape is built
in the GLOBE frame, so `buildMesh` negates x and z, and a direction read back
out is 180° from where you think it is — then the viewer's own longitude is
`180 - atan2(z, x)`, not `atan2(z, x)`. Those two together put my ground samples
32° from the patch and manufactured a 14 km "residual" that did not exist.
**Calibrate the conversion against `surfacePoint` on known lat/lons before
trusting a single number derived from a vertex.** Two probe calls would have
saved both rounds.

#### The shuffle was reverted, and the ring had to follow the symbol

Two reports in one turn, and the second was caused by a fix from the last one.

**"Ensure the legend and events buttons dont slant and hide behind the active
one, keep in line and side by side."** The shuffle is gone: no transform, no
scale, no rotation, no grey, no z-index, and `overlay-stack.js` injects no
stylesheet at all. What is kept is the rule that was worth having — **at most
one panel open**, since both are wide enough to overlap — and it is now
additive rather than a takeover: the capture handler shuts the OTHER card and
lets the click through to each toggle's own handler, instead of stopping it and
reimplementing both.

**"We still need the events and legend button to occupy a single drop down area
where only one can be active at a time."** Taking turns was not enough: a panel
that FLOWS under its own button is at that button's x, and the two buttons are
not in the same place, so the corner still held two drop-downs in two places.
Both panels are pinned into ONE rectangle — `position: fixed` out of their own
card's flow, at one width, placed from the buttons themselves (under the
lowest, right-aligned to the rightmost) so the slot cannot drift from the row
it hangs off. The arithmetic is `slotFrom(rects, viewportWidth, gap)`, pure and
pinned — including the case that would otherwise throw the slot into the
top-left corner: a card that is not on screen has no button to measure, and a
zero rect is not a measurement. Measured live: the legend's panel and the
feed's both land at **x=1037, y=51, 280 px wide**, switching back and forth,
with the buttons at y=16.

**The row moved, and that is what sent them into a stack in the first place.**
`placeOverlay` measured the legend's CARD, and a card is as wide as whatever is
open inside it — so opening the legend moved the events button and a layer
arriving moved it again. It measures the **toggle**: a fixed-width button with
the panel hanging BELOW it, so the row cannot move whatever either panel is
doing. Measured through a full open/close cycle on both: the events button at
x=1107 in every state, both buttons at y=16, 7 px apart, transform `none`,
opacity 1, filter `none`.

**And then the selection halo was off.** The ring is one point sprite centred
on the coordinate, which was right until the category glyphs were made to STAND
on their point — after that it circled the right PLACE and the wrong PICTURE,
reported on a flood as a ring with the dot on its top edge. So there are two
rings, chosen by the same `isQuakeBand(markerKey(event))` test the marker's own
texture is chosen by: the ring cannot disagree with the symbol about where the
symbol is.

The foot ring is asked for **half again as large** (`HALO_FOOT_SCALE = 3`) with
the annulus drawn small inside it. A sprite is square and a ring standing clear
of a symbol that already stands on its point needs more room above the
coordinate than below — at the centred scale the ring runs off the top of its
own canvas and draws with a bite out of it. The floor also moved from the ring
to the DOT (`Math.max(9, dot) * scale` rather than `Math.max(18, dot * scale)`),
so the proportion against the symbol holds at every size instead of breaking
exactly where the sprite is smallest.

Measured by A/B on the framebuffer, one wildfire with its 9 px neighbour parked
so the diff isolates a single symbol: ink centre **6.16 px** above the
coordinate, ring centre **6.09**, **ring − ink = −0.07 px**, both sideways 0.00,
ring 22 px tall around 11 px of ink. An earthquake, unchanged: **0.00, 0.00**.

**Two measurement traps, both mine.** A colour test for the cyan ring found 76
pixels of it and put the centroid 2.2 px sideways — the additive blend
saturates over bright ground and fails any threshold. **Diff the frame with the
sprite hidden**: 332 pixels, no colour guessing, and it is the instrument this
file already prescribes. And hiding a CLOUD to isolate one marker hides every
marker of that category in the window — there was another wildfire 9.4 px away,
which is what made the first ink reading disagree with its own prediction.

#### "Should we really have a spectrogram for a flood event?"

No — and asking it found the same fault in four places. `event.sourceId` means
"did not come from EONET", which was true of the seismicity and of nothing else
until the GDACS flood feed arrived. It has now been read as "is an earthquake"
three separate times: first in `markerKey`, where it put the floods in the
`quake-3` band wearing the concentric rings; and then, unnoticed, everywhere
the CARD decides what an event is.

Measured on the live feed, on "Flood in China — Orange alert":

| what the card said | what it is |
| --- | --- |
| Magnitude **undetermined**, Depth **not reported** | an earthquake's answers to an earthquake's questions |
| **Open the USGS record** | a GDACS link |
| **TQ.TQ05..HHZ, 687 km · 100 Hz · 302 s**, a waveform, a spectrogram, "P read from the trace" | ground motion with nothing to do with the flood |
| status line: 221 natural events in 4 categories · **180 earthquakes** | 39 of those were GDACS floods |

The seismogram is the worst of them and not by a little. `seismogramNear`
always finds SOMETHING — that is its job — so the flood got a real trace from a
real station at the flood's own time, drawn under a spectrogram with an arrival
PICKED on it. Every part of that picture says it is the record of the flood.
The count was the quietest: floods were added to the earthquakes AND left out
of the natural events they are, so one sentence was wrong twice and its
category tally short by one.

**`isQuake(event)` is `event.categoryId === "earthquakes"`**, and it is what
all four ask now. `sourceId` keeps its one real job — looking the FEED up for
its credit, which is as true of GDACS as of the USGS — and the test pins that
it has exactly two readers, both on that line.

**A card that cannot say what a seismogram would MEAN does not fetch one.**

`publisherOf(source)` is the other half: the link text and the provenance row
name the same organisation and had drifted into a hard-coded `USGS : EONET`
ternary. One map, two lengths — a citation wants the catalogue named ("USGS
earthquake catalogue"), a link is read as a phrase and "Open the USGS
earthquake catalogue record" is not one.

After, measured: the flood card carries **0 canvases**, no magnitude or depth,
and "Open the GDACS record"; the status reads **260 natural events in 5
categories · 141 earthquakes** against the same 401 total, the fifth category
being the floods that had been missing from it. And the earthquake path is
untouched — an M4.5 off Taiwan drew both pictures from TQ.TQ05 166 km away,
with its own S−P check reading 19.5 s → about 159 km against that 166.

**The general shape, for the third time.** A field that happens to correlate
with a category is not that category, and it will keep answering plausibly
until a feed arrives that breaks the correlation. When one turns up, grep every
reader of it rather than fixing the one that was reported — `markerKey` was
fixed alone, and these four sat there for as long again.

#### What the page opens with, and the ring that stayed behind

**"Ensure that the live events are active by default."** `armOnLaunch` in
events.js. It takes the feed and NONE OF THE FURNITURE, and each omission is
argued at the branch that skips it: no unfolded sidebar section, no open
drop-down, no stopped globe. Every one of those is right for somebody arming
the mode to go and look at something — "the feeds that were JUST SWITCHED ON"
is a sentence about a gesture — and at boot they are the app deciding what you
came for. It waits for `window.GeoIDViewer` (the markers hang off the globe's
spin frame) with a bounded retry, and only arms over a globe: the page restores
whatever mode it was left in, and arming a globe overlay while the Model studio
is up fetches sixteen feeds for a page that cannot show them.

**A default is not an imposition.** `restoreActive` remembers an explicit OFF
and nothing else, so switching the feed off and finding it back the next
morning cannot happen — the rule `restoreSources` already applies to a feed
somebody unticked. Leaving GIS is NOT a choice about the feed and is not
stored: persisted, it would switch the feed off for good the first time
somebody opened the Model page.

**"Plate boundaries also active upon launch at 30% opacity."** `defaultOn` and
`opacity` on the catalogue entry, loaded by `loadLaunchDefaults`. They are the
one dataset that is context for the others rather than a subject — 63% of the
seismicity is within 100 km of a boundary — which is also why they are faint:
241 segments at full strength is a net drawn OVER the map, and the point of
them is to be underneath what you are reading. An explicit untick is
remembered, keyed off the shared catalogue ROW builder so every host records it.

Three faults in getting that on screen, and the first two are the same shape as
the events arm:

- **`importFileList` fails WITHOUT THROWING.** With no `viewer.scene`,
  `ensureGroups` returns null, the layer is marked `error` with "Viewer is not
  ready yet." and the function RETURNS — so `addDataset` answered `ok: true`
  over an import that produced nothing, and `loadLaunchDefaults`' try/catch
  never saw it. Measured at launch: the plates registered, took their 30%, and
  carried no geometry, while the identical call by hand a minute later loaded
  all 241 segments. Gate on what the importer itself requires, and take a layer
  that lands in `error` back off rather than leaving a dead row nobody asked
  for.
- **`holdTheGlobe` stopped the planet at boot.** "You add a shapefile in order
  to LOOK at it" is the whole argument for it and it is a sentence about a
  gesture. Measured: `isSpinPaused` true on a page nobody had touched. A launch
  default passes `hold: false`, beside the `frame: false` that stops a GLOBAL
  layer throwing the opening camera out to the whole planet on every load.
- **`entry.opacity` only fired inside the `colourBy` branch**, so a dataset
  with one flat colour — which is most lines — could not ask for a weight at
  all. Hoisted.

**"Ensure the event selection halo scales all the way with zoom. Currently it
drops from view at a certain altitude."** The halo is its own object in the
spin frame rather than a member of `markers`, so `watchRelief`'s traversal
never reached it and it kept the position it was BUILT with — the very fault
that traversal exists to prevent, missed for the one marker somebody is
actually looking at.

It shows on the way in because the exaggeration TAPERS as the camera lands: the
ground and its dot come down, the ring stays at the radius it was selected at.
Measured at 3 km altitude, the halo sat at 3.26561 against its own marker at
**3.20003 — 65 km above it**, long out of frame, while the dot sat on the
ground in front of you. After: **30 m above the ground at every exaggeration**
across a swing from 3.212 to 3.379, which is 334 km of ground movement.

The SIZE was never the fault — it tracks the dot by construction at three times
its width, 30.6 px at 6,632 km up to the 102 it shares the dot's cap with.

**Four wrong instruments in one hunt, and they cost most of it.** Driving this
by camera is what went wrong every time: `camera.position` written by hand is
undone by the render loop, which eases toward `zoomTargetSurfaceDistance`, so
the altitude never moved and three readings were taken at the view I started
from. Then with the spin running — which the launch change had just stopped
pausing — the globe turned 3°/s under a thirty-second descent and put the
marker 59° off axis, so both the halo AND its dot were correctly culled and it
read as a halo bug. **Move the ground, not the camera:** the exaggeration
slider does exactly what the taper does, in one tick, with nothing else
changing. And the point-size ceiling was ruled out by measuring rather than
assuming — this driver CLAMPS at 255 (12,410 px at 256, 300 and 400 alike)
rather than dropping the sprite, so that documented trap was not this one.

**And a hole in the net, found while adding to it.** `event-sources.test.mjs`
printed its summary and set `process.exitCode` a THIRD of the way down the
file. The ninety checks below it ran, printed, and counted into `fail` — and
were never looked at, because the exit code had already been decided. Proved by
appending a deliberately failing check to the last line: the file exited 0 and
the suite reported it green. Moved to the end. **A TEST FILE'S VERDICT IS ITS
LAST STATEMENT**; anything after it is decoration. Same family as this file's
note about `geoprocessing.test.mjs`, whose summary calls `process.exit` and
silently skips whatever follows — checked, and no other test file has it.

#### The cyclone, and how big a storm is drawn

**The tropical storms wear `assets/cyclone_icon.png`, in white.** Every other
category here is a font character, which is right when a shape that means the
category already exists in a typeface. A cyclone does not: the one Unicode has
is U+1F300, which browsers render as a COLOUR emoji, so it would ignore the
tint every other marker takes and read as a sticker dropped on the map.

The file is already exactly what this needs — measured before using it, an
opaque WHITE silhouette on transparency with the eye punched out of the alpha —
so nothing recolours it: white is what the marker material tints, and the alpha
is what a legend row masks with. Resolved against `import.meta.url`, because
the viewer is two directories below the site root and a document-relative path
lands inside `GeoID_GIS/viewer/` and 404s; `crossOrigin` because the ink fit
READS the canvas back, and a tainted canvas throws on `getImageData`.

**A file arrives LATE, and a character stands in until it does.** An empty
sprite and a category that failed to load look identical, and one of them is a
bug. The texture is rebuilt in place when the image lands — same canvas, same
texture, `needsUpdate` — because otherwise every marker keeps whichever symbol
happened to be available in the frame it was created in. A file that never
arrives is not polled for; the character is a legible symbol, and a feed
retrying an asset it cannot have is worse than either.

**The list masks with the same file.** A legend that disagrees with the markers
is the fault this feed has already been reported for, so the mark reaches the
rows from the SAME source — as a `mask` with `background: currentColor`, so it
takes the row's colour exactly as a character does.

**How to prove a texture is the icon and not the stand-in.** Ink coverage does
not separate them (0.64 against a dot's 0.78 says little). Symmetry does: the
cyclone is an S, so it is symmetric under 180° and NOT under 90°. Measured on
the built textures — storms **0.98 under 180°, 0.64 under 90°**; the wildfire
dot 0.95 and 0.97, as a circle must be.

**"The storm icons should be larger for hurricanes (dynamically size icons
relative to magnitude of storm) — currently these icons are far too small to be
seen."** Two things, and the second is why the first was needed.

EONET publishes a magnitude per geometry and `latestPoint` was DROPPING it —
for a severe storm that is the wind speed in knots, and measured on the live
feed every open storm carries one (30 to 110 kts across six). Knots are what
Saffir–Simpson is defined in, so the bands are that scale rather than a ramp
somebody chose: a Category 3 is one because 96 knots is where that category
starts. Banded exactly as the earthquakes are, and for the same reason — one
`PointsMaterial` carries one size, so drawing every storm together draws a
Category 5 the same size as a tropical depression.

And bigger than a category dot at every strength, because the cyclone is a
SPIRAL: it needs area to be a shape at all, where a filled dot reads at five
pixels. Measured at the opening view, sprite sizes went from **11.5 px for
every storm** to **17.2 / 21.5 / 30.2** for a tropical storm, a Category 1 and
a Category 3 — against a wildfire dot's 11.5 beside them.

**The base is capped per BAND**, replacing one shared `capBase` boolean. The
multiplier is what should decide how big a storm looks, so letting the zoom's
own growth through as well would put a close-range Category 5 past 255 px,
which this file already records the driver clamping at. A storm caps at 16
where an earthquake caps at 8: its symbol carries more detail and goes
illegible sooner.

**A masked span is not a character, and the line box knows it.** At 0.9rem
square on the baseline the mark stood 15.9 px against a text row's 13 and
pushed every storm row taller than its neighbours. Measured on the live list:
baseline 15.5, `-0.1em` 14.5, `middle` 13.7, **`text-bottom` 13** — the one
that lands on the text rows exactly.

**And the verdict hole came back while I was fixing it.** Rewriting the test
block with a slice put the summary in the middle again, and a later repair left
an orphaned copy of its comment. Both were caught by re-running the A/B — a
deliberately failing check appended to the last line must exit 1, and one
placed after the verdict must not be counted. **When a test file's end is
edited, re-run that A/B rather than trusting the diff.**

#### The selection ring is sized from the MARKER, not from the dot

"Selection halo for the storms needs resized." It was `dot * 3`, which assumes
every marker is drawn at `dot * GLYPH_FOOT_SCALE` — true of every category
until one got a size of its own. Measured on Hurricane Marie: a **40.2 px ring
around a 50.3 px symbol**, inside the thing it exists to encircle, and the same
40.2 around the Category 3's 70.4.

So it asks the cloud (`markerSpriteFor`). That number is the truth by
construction, it is already updated every frame by the size step, and a band
added later needs nothing done here.

**The ratios are derived, not chosen**, from the ring's radius within its own
texture and how much of a sprite each kind of symbol fills. Foot-anchored: the
ink is `GLYPH_INK` of the marker and the ring is 1.43× the ink, so the ring's
drawn diameter wants 0.658 of the marker, and the foot texture draws at 0.22 of
its sprite — 0.658/(2×0.22) = **1.5**, which is exactly
`HALO_FOOT_SCALE / GLYPH_FOOT_SCALE`, the ratio that texture's geometry was
derived at. That is why the measured ring-on-ink of −0.07 px holds at any
marker size rather than only at the one it was tuned for. Centred: the
earthquake rings fill their quad, so the ring wants to be a little outside it
(1.04) and the centred texture draws at 0.33 — **1.58**.

**The earthquakes had the same fault, quieter.** Their ring was also computed
from the dot, so it did not grow with the magnitude their marker grows with:
before, an M2.5 and an M4.8 both got 26.8 px. After, **27.6 and 48.6**, at a
constant 1.58 of each marker — and the wildfires are unchanged at exactly 1.50,
which is the check that nothing else moved.

**`node --check` passed a temporal dead zone.** `HALO_OVER_MARKER_FOOT` is
derived from `HALO_FOOT_SCALE`, which is declared eighty lines further down —
a `const` evaluated before its dependency exists throws at MODULE LOAD and
takes the whole feed out. It parses either way, because `--check` does not
evaluate. Moved below what it derives from; `applyHaloScale` reads it when
called, so a hoisted function above the constants is fine. **The browser is the
only thing that says whether a module loads** — this file already records that
for the backtick and the octal escape, and the same rule catches this.

**One honest consequence worth not mistaking for a bug.** The band follows the
CURRENT wind, not the name: "Hurricane Karina" reads 45 kts on the feed, so it
is drawn and labelled as a tropical storm. EONET's title keeps the name it was
given; its `magnitudeValue` is the latest observation, and the marker is sized
by the observation.

#### Every cyclone on record, and the feeds that went back to Live

**"The EONET datasets should not be in the hazards tab — they are already
covered in the events tab."** Right, and the note that had defended them was
the argument for the duplication rather than against it: Hazards ▸ Flood and
▸ Drought carried `data-feed-toggle` proxies onto the Live tab's own state, so
one dataset sat in two places. The tabs already divide cleanly — **Live holds
what HAPPENED**, with a time and a place; **Hazards holds what COULD** — and a
live feed is the first of those wherever it is ticked from. The markup, the
`syncFeedProxies` machinery and its 900 ms interval all went; Drought had
nothing else in it and went with them.

**In their place, the historical record.** IBTrACS v04r01 (NOAA NCEI) is the
authoritative archive — every agency's best track, reconciled — and it answers
`Access-Control-Allow-Origin: *` at every size, so nothing here needs a key.
Measured: **713,155 segments over 13,513 storms, 1842 to 2026**.

**It is BAKED where the plate boundaries and the GEM faults are fetched live,
and three measurements decided that.** Each is a wrong map rather than a slow
one:

- **A feature is a THREE-HOUR SEGMENT, not a storm.** Hurricane Melissa is 92
  of them. Drawn raw a click gives three hours of one storm's life, and nothing
  can be coloured by a storm's peak intensity because no feature knows it.
- **Longitudes run past 180** — the file's own extent is −179.9 to **183.3**,
  because a track crossing the antimeridian is continued rather than wrapped.
  `looksLikeGeographic` allows ±180.5, so the layer is filed as NOT
  georeferenced and lands in the local-models group. That is the World Stress
  Map fault exactly, and it is silent.
- **Wrapping alone is not enough**: a fix at 179.9 followed by one at −179.9
  draws a chord back across every meridian between them, so the track is SPLIT
  at the seam. 511 of the 13,513 needed it.

After: 13,513 features, 726,506 vertices, longitudes −180.000 to 179.900 with
**0 outside the gate**, and a worst longitude step of 8.4° — a chord would be
~350°. Checked against records anybody can look up: **Katrina 2005 at 902 mb,
Haiyan 2013 at 895 mb**, both exactly the accepted minima.

**NOTHING LARGE TOUCHES THE DISK, and that is not tidiness.** The extracted
shapefile is ~700 MB and an intermediate GeoJSON is a few hundred more — it
filled the working drive on the first attempt and the bake died with ENOSPC.
GDAL reads the archive WHERE IT LIES (`/vsizip//vsicurl/`) and writes
`GeoJSONSeq` to `/vsistdout/`, so 713,155 features stream through a pipe and
the only thing ever held is the 12.6 MB output. 90 seconds, disk unchanged.

**Classed on the SCALE, not on the file's own quantiles.** `paintByRange` now
forwards explicit `edges` to `buildSymbology`, which has accepted them all
along, and the entry hands it `SAFFIR_SIMPSON_KTS` — the same constant the
live storm markers band by. So the archive and the feed cut intensity at the
same knots, and a Category 3 in 1972 is the colour a Category 3 today is. A
quantile of 6,246 peak winds would have put a boundary at 62 or 71 and called
it a class. Verified in the legend: 0–64, 64–83, 83–96, 96–113, 113–137,
137–185.

**A CATALOGUE ROW, not a bespoke tick.** `hazards` is the first home outside
Geology and Hydrology, so the layer arrives with the ⓘ, the symbology button,
the legend, the provenance and the eye that every other dataset has — the same
argument that turned the glacier inventory and the contacts layer into rows.

Measured live: parent `GeoID-ImportedGeoLayers` (the spinning geo group, so the
georeferencing trap is genuinely avoided), 13,513 features at the declared 0.55,
and **median frame 16.7 ms with the layer on against 16.7 hidden** — 726,506
vertices in 17 draw calls is free.

#### The archive, played a season at a time

**"Is there time data with these tracks?"** Yes — every storm carries `season`,
`start` and `end`. **Per-FIX times are not in the file**, so this steps SEASONS
and a storm appears whole in its own year rather than drawing as it happened.
Animating a track fix by fix wants the 726,506 observation times, which is a
re-bake and a bigger file; it is worth doing and it is not this.

**A THIRD DRIVER FOR THE ONE PLAYER**, which is the whole reason there is one.
`timelapse-player.js` already owned the bar, the slider, the play loop, the
scene cache, the world-clock hold and the spin hold; the glacier and imagery
animators are the other two. A driver supplies a box, ordered epochs and
optionally a node per epoch — this supplies a node per season and asks for
`source: "none"`, because the subject is the lines and a picture behind them
would cost a request a frame to answer a question nobody asked.

Measured: **47 seasons built in 502 ms**, exactly one of 47 frames visible at
every step, and play advancing 2005 → 2013 on its own.

**ONE PALETTE ACROSS EVERY FRAME**, the glacier animator's own lesson, and here
it is the same Saffir-Simpson edges the static layer and the LIVE storm markers
use. Rebuilt per frame, the same 90-knot storm is one colour in a quiet season
and another in a busy one, and the map becomes about the frame rather than
about the storms.

**The full layer stands down while a season is on screen** and comes back as it
was when the bar closes — left visible it draws all 13,513 tracks behind the
one season being shown, which is the web the animation exists to take apart.
The feature list follows the frame for the reason the glacier driver records:
`featuresAt` walks `layer.features`, so a list left on the whole span answers a
click with a storm from a season that is not on screen.

**AND THE SPAN IS A CLAIM, so it defaults to the one the record supports.**
IBTrACS is a best-track archive, not a census: before the satellites a storm
was recorded where ships and coasts were, so its own storm count rises through
the twentieth century for reasons that are mostly OBSERVATIONAL. Measured on
the archive — **1842 holds ONE storm and 2021 holds 111** — and played from
1842 that reads as a world getting steadily stormier, which this data cannot
say. So the default span is 1980, the whole archive is offered beside it rather
than instead of it, and every pre-satellite frame says what it is on the frame:
"1 storm(s) — pre-satellite: recorded where ships and coasts were". The honest
answer to "why are there so few" belongs where the few are, not in a footnote.

**A season with nothing in it is not a frame.** Counting a range off from a
start year makes a frame for every year whether the archive has one or not, and
a frame that draws nothing reads as the player having broken rather than as a
quiet year. The epochs come from the seasons that are actually there.
## The cyclone risk map: a variable-resolution grid that is still comparable

The tracks layer says where every storm went. Thirteen thousand lines cannot
say **how often that happens here**, which is the question a reader has in
front of them, so `bake-cyclone-risk.py` counts it: `cyclone-risk.geojson` (the
climatology) and `cyclone-risk-years.json` (a sparse count per cell per
season), both from one 137-second pass over IBTrACS read where it lies.

**THE VALUE IS MEASURED AT A POINT, WITHIN A FIXED RADIUS — never per cell.**
That one decision is what makes the rest legal. "Storms in this cell" is not
comparable between an eight-degree cell and a quarter-degree one: the big cell
catches more storms by BEING BIG, so a variable-resolution map of it would be a
picture of its own resolution rather than of the hazard. Measured at a point,
a cell is a sampling location and its size is display resolution and nothing
more — 28 km over Florida and the Philippines, 444 km over the open ocean,
which is what "higher res around Florida, lower where there are no
occurrences" actually requires.

**And a single season is not a probability.** A cell either had a storm in 1992
or it did not; there is no frequency in one year to take. So the per-season
file holds COUNTS, is labelled as counts everywhere it surfaces, and the LEGEND
CHANGES WITH THE MAP when the animation follows it — the climatology's classes
are return periods and a season's are numbers of storms, and drawing one under
the other's key is the whole failure the file is written to avoid.

### Three things that would have made it a wrong map

- **A BLOCK THAT IS EMPTY IN PART IS NOT FLAT, whatever its spread.** The trap
  above, reappearing at the other end of the scale. One lattice point can
  report no less than one storm in the window — 1/46, about 0.022 a year — so a
  coarse cell reporting 0.0003 is not a rate anywhere inside it: it is one
  point's rate divided by the thousand beside it that no storm ever reached.
  Measured before the gate: **177 cells of 2 degrees and up claiming rates down
  to "once every 3,623 years"**, and **1,485 doing the same with the hurricane
  rate**. The absolute spread test cannot catch it and correctly so — 0.022
  against a peak of 6.17 is a third of a percent, genuinely flat. What is wrong
  is not the variation but the MEAN. Gated on BOTH fields: gating the storm
  rate alone leaves the hurricane rate diluted under a cell whose other number
  is sound (79,114 cells → 90,445, and worth it).
- **THE DISC IS IN KILOMETRES, AND IT IS SOLVED ON THE SPHERE.** A fixed column
  count is a 200 km disc at the equator, 100 km at 60° and meaningless at the
  pole. Inverting the haversine for the longitude difference is closed form,
  and the flat approximation is wrong exactly where a disc has most of its
  cells: **a cell computed at 199 km is 216 km of real ground**. And a cell is
  in the disc when its CENTRE is within the radius — `ceil` adds up to a cell
  and a half of reach, measured at **240 km under a layer claiming 200**, and
  inflates every rate on the map. Measured after: worst included cell
  196.6–199.9 km, **none over 200**, equator to 85°, ground covered 99–103% of
  πr² at every latitude.
- **THE SEASON IN PROGRESS IS EXCLUDED from the climatology**, or 46 seasons of
  storms divided by 47 years understates every cell. It is still emitted in the
  per-year file, because a year's own count is a count whether or not the year
  has finished.

### Precompute the disc PER ROW, not per fix

Three million densified fixes each solving the same 720 shapes is an hour of
arithmetic to arrive at 720 answers. The disc's shape depends only on the grid
ROW, so it is a lookup built once (0.1 s) and the stamping is batched by row —
the points sharing a row share a shape, so a row is one broadcast rather than
one loop iteration each. Whole bake: **137 s, nothing staged to disk**.

### What it is checked against

Places whose climatology is published, and the answers have to be recognisable
before the file is believed: **Cape Hatteras 1.67 storms/yr and a hurricane 1
in 2 years** (the most exposed point on the US East Coast), **Manila 3.16**,
**Miami 0.95 and a hurricane 1 in 3**, **Mumbai 0.30 with a hurricane 1 in 32**,
**Lisbon 0.20 with none on record**. The **South Atlantic has no cell at all**
except at **Catarina's 2004 landfall**, which is the one South Atlantic
hurricane there has ever been. Basins rank as the record does, with the eastern
North Pacific highest by point density.

And the SEASONS invert the way history says: 2005 gives Miami 3.5 and New
Orleans 2 while Manila has 2; **2013 gives Miami 1 and Manila 3.5** — Haiyan's
year against the record-quiet Atlantic. Two locations swapping in the right
direction across two years is worth more than any single number.

### A repaint, not a rebuild — and the grey needed a row

Following the animation swaps the COLOUR of the same 91,156 cells: measured,
**1,540,636 vertices before and after**, 2.2 s a season. The sidecar is fetched
only when the toggle is first used (5.6 MB gzipped), and the whole thing is a
no-op when the risk layer is not on the globe — the season animation is worth
watching on its own, and fetching a 23 MB map because somebody pressed play is
the app deciding what they came for.

**A cell the season never reached keeps NO colour, and that needed a legend row
of its own.** Unpainted cells take the app's no-value grey `#8a8a8a`, which
everywhere else means NOT MEASURED and here means measured, and zero — every
cell in the file was reached by some storm at some point or the bake would not
have drawn it. Measured on 2005: **43,039 of 91,156 cells**, half the map in a
colour meaning one thing under a key that did not mention it. The "no storm
that season" row leads the key and carries its own count, so the classes now
sum to the cells drawn (43,039 + 729 + 21,306 + 13,341 + 7,349 + 5,392 =
91,156).

### `paintByRange` gained `labels` and `legendLabel`

The companion to `edges`, and needed for the same reason: a published scale is
published in a VOCABULARY. These classes are return periods, so "about 1 in 10
years" is the class and "0.0951 – 0.1813" is the arithmetic underneath it, and
`p_yr` is a column name rather than a quantity anybody reads. `legendInfoFrom`
already prefers a row's own label over its bounds, so the labels only had to
reach the rows. Verified live: six drawn colours for six classes, **zero in the
no-value grey**, and the bounds are exactly 1 − exp(−1/T) for 10, 5, 2, 1 and
0.5 years.

### A modelled catalogue dataset shows its working, BY ITS OWN ID

`addDataset` sets `layer.info.maths = mathsFor(entry.id)`, so this is a seam
rather than one more special case: a catalogue entry with an `equations.js`
entry gets the ⓘ on its Workspace row and one without gets no button. Most of
that catalogue is a survey, and a survey has no arithmetic to show — an "How it
is calculated" fold over Natural Earth's coastlines would suggest everything
there is computed. Verified both ways: the risk map carries it, the coastlines
do not.

### A TEST FILE'S VERDICT BELONGS IN AN EXIT HOOK

This tree has lost checks twice to a summary that stopped being the last
statement — `event-sources.test.mjs` printed 89 of them into a decided exit
code, and `geoprocessing.test.mjs` calls `process.exit` and silently skips
whatever follows. Both were caught by an A/B rather than by reading, and both
fixes were discipline: *put the verdict last and keep it there*.

`process.on("exit", …)` makes the ordering stop mattering, so a check appended
anywhere by anyone still counts. Proved by the same A/B that exposed the trap:
with the verdict written inline a deliberate failure appended after it **ran,
counted, printed nothing and exited 0**; through the exit hook the identical
append exits 1 and names the failure. New test files should take the hook.
## Hurricanes only: a PART OF A TRACK, not a class of storm

Both maps now answer the hurricane question, and the whole job was making them
mean the same thing by it.

**The risk half needed no re-bake** — every cell already carried `rate_hur_yr`
and `p_hur_yr` beside its all-storms pair, so "hurricanes only" is a REPAINT of
the layer already loaded. A second catalogue entry over the same path would
fetch and triangulate 23 MB and 91,156 polygons again for a column that is in
memory, which is the duplication the home rule exists to prevent wearing a
different colour. `entry.viewToggle` is the seam — same shape as `entry.play`,
gated on the layer, reading its state back off the layer rather than
remembering it.

**The tracks half did need one, and this is the reason.** The tracks file kept
only each storm's PEAK, so a filter on it would draw every hurricane's whole
life — including the days it spent as a depression. Measured, that over-draws
by two to eight times:

| | at hurricane force | whole track | |
| --- | --- | --- | --- |
| Katrina 2005 | 1,607 km | 3,404 km | **47%** |
| Sandy 1985 | 560 km | 4,316 km | **13%** |
| Haiyan 2013 | 4,263 km | 6,752 km | 63% |
| Irma 2017 | 5,971 km | 7,720 km | 77% |

So `bake-cyclone-tracks.py` keeps the wind WITH EACH FIX — it was reading it
per segment and throwing it away — and emits the unbroken runs at 64 kt and
above as their own file. That is the exact definition the risk map's hurricane
rate counts, so **the two agree by construction rather than by looking
similar**: laid over each other the lines end where the red ends.

**A storm that weakens and re-intensifies gives MORE THAN ONE RUN** — 3,700
runs over 2,929 storms, so about a quarter of them — because it was not a
hurricane in between and joining them would draw hurricane force across the
gap. A run of a single fix is dropped: a real observation, and not a line.

### The key has to account for the cells, exactly once each

On the all-storms view every drawn cell has a rate. On the hurricane view a
third do not — 29,138 of 91,156 — and they come back in the app's no-value
grey, which everywhere else means NOT MEASURED and here means measured, and
never. Lisbon names itself: 0.20 storms a year and no hurricane on record. So
there is a "no hurricane on record" row with its own count.

**And the zeros had to leave the CLASSING when they gained a row**, or they are
counted twice. Measured before the fix: the key summed to **120,294 over a
layer of 91,156 cells**, with the bottom class reading 50,253 where 21,115 of
it was ground with no rate at all. A legend making a false arithmetic claim
about its own map is worse than a missing row, because it looks like a
measurement. Pinned: both keys must sum to the feature count.

### Class labels are the scale's words, not the column's

`peak_wind_kts` is a column name; "Category 3" is what the scale calls it. Both
track layers now pass `labels` and `legendLabel` through `colourRange` — and
they differ by one band, which is the honest part: the all-storms layer opens
BELOW hurricane force so it has six ("Tropical storm or weaker" first), and the
hurricane runs have five, because every value in that file is already at or
above 64 knots and there is nothing for a lower band to hold.
## A risk cell is not a rock, and the number is the title

Clicked, a cell opened the ordinary geology card: kicked off **"OCEANIC"** —
`crustalSetting` answering from the elevation about a cell that is not crust —
titled **"Mapped area"**, with the one thing anybody clicked for four rows down
as `p_yr` among `rate_yr`, `deg` and `i`. Column names, under a heading about
the sea floor.

`cyclone-risk-card.js` writes the three lines instead, the third card in this
tree to do it (`ice-card`, `soil-card`) and for the same reason each exists.

- **The number is said TWICE on purpose**: "1 in 13 years" is how a hazard is
  quoted and weighed; "7.3% a year" is what the map is coloured by. A reader
  with one and not the other cannot check the map against the key.
- **A chance with no radius and no window is not a chance**, so the meta line
  carries both: within 200 km, over the complete seasons 1980–2025.
- **Never is not zero.** "0.0" is a measurement; "Not once on record" is what
  the file holds, and the difference matters most on the cells somebody checks
  because they were surprised.
- **The reading not on screen is on the card**, because it is the obvious next
  question — the hurricane rate beside the all-storm one, and the reverse.
- **The cell says how big it is.** The grid is variable, so a reader comparing
  two cells is entitled to know they are not the same patch of ground.
## The record plots itself: three step sizes, four rates, and ticks you can read

"Fully develop the hurricane time slider — many more x ticks, rate buttons, and
plot the tracks by each occurrence, then monthly, then yearly."

**A step size is what a frame MEANS**, so it is a control rather than a
constant. `STEPS` in `cyclone-timelapse.js` holds three, and each carries its
own play interval because they are not the same amount of change per frame — a
storm at 90 ms, a month at 200, a season at 900. Measured on the archive from
1980: **354 frames each storm, 282 by month, 47 by season**.

**Past `MAX_FRAMES` (360) the sequence is STRIDED and the bar says by how
much** — "354 frames, each storm — one frame per 12 storms". Truncating would
quietly change which span is being played, which is the imagery driver's own
rule; a stride that is not reported is a control saying one thing while the
sequence does another.

**Plotting is CUMULATIVE, because that is what "the record plots itself"
means.** Frame *i* shows every group up to *i*, so the map fills in rather than
flickering one storm at a time — and the counter is the honest reading of that:
`105 / 13,513`. Measured stepping through: 15 → 576 → 1,726 → 3,394 → 4,982
across 1979-08-26 to 2026-08-27.

**The ticks are drawn where the YEAR TURNS**, not at even intervals, and the
label count is fitted to the track's measured width (`width / 34`, at least
two) so a narrow bar thins its labels instead of overprinting them. Measured:
5 ticks by season, **48 with 8 labels** by storm and by month.

**The rate pill multiplies the DRIVER'S interval and restarts the timer**, so
the new rate takes effect on the frame you are looking at rather than the next
one. `1x → 2x → 4x → 8x → 1x`, measured as 90 / 45 / 23 / 11 ms on the storm
step and 900 / 450 / 225 / 113 on the season step — the pill is a factor, not a
number of milliseconds, or it would mean different things per step.

### THE ONLY CONTROLS LEFT HAVE TO ACT

Retiring the play button retired the thing that READ the two selects. Nothing
replaced it, and both were measured **inert**: the step could be moved to "Each
storm" and the bar went on reading "47 frames, by season". A control that
changes nothing is worse than one that is not there, and it is the exact cost
of removing a press — everything the press used to gather at that moment now
needs a listener of its own.

Delegated on the document, because the subtab is redrawn whenever the catalogue
is and a handler bound to the node goes stale on the first tick. Only while the
bar is up: with no sequence there is nothing to rebuild, and the value is read
at the next build regardless.

### A REBUILD IS NOT A DISMISSAL

`animated-layers.js` decides a bar was closed by the reader when `owner` is set
and no `#geoid-timelapse` exists. That is also true for the whole of a build —
`owner` is claimed before the open is awaited, and a sequence takes seconds —
so the poll marked the entry **dismissed a few hundred milliseconds in**, and
the sequence that then finished building was never allowed to reopen. Reported
as the bar simply not opening; `dismissed: ["cyclone-tracks"]` over a ticked,
loaded layer is the tell.

Two halves, and the second is the general one:

- **`opening` suppresses the watcher as well as the sync.** The same "opening
  is not yet running" gap both drivers needed their own flag for.
- **`hold(work)` on the seam**, so a driver rebuilding its own sequence can say
  so. Changing the step takes the bar down and puts it back, which from outside
  is indistinguishable from a ✕ — without the hold, changing the step marked
  the layer dismissed and the bar never came back.

Verified after: three step changes in a row leave `dismissed` empty and `owner`
set; ✕ still sticks across eight polls; unticking forgets the dismissal and
re-ticking reopens.

### REGISTERED IS NOT LOADED

`importFileList` puts a layer in the list when the import STARTS, so a driver
opened on the first `layers-changed` finds a row with no features and reports
"Tick the cyclone tracks on first" — over a layer that is on its way. `armed`
waits for `status === "loaded"` and something to play.

### One dataset, one key — met from the other side

The risk map's rule, and the tracks broke it the opposite way round. On the All
frame the plot is invisible and the archive is what is drawn, and the plot's
legend card was **still listed**: two keys for one layer, with the one
describing what was actually drawn second. `legendHidden` follows the frame, so
the card names whichever of the two is up. Measured: one cyclone card on the
All frame, one on a season frame, and it changes name between them.

### The note keeps its own width

`.tl-note` is the only part of the bar that says anything about the frame, and
as an ordinary flex item it gave its width away — 104 px of a 130 px sentence,
so "13513 storms, 5733 named" reached the reader as "…5733…". `flex: 0 1 auto`
with `min-width: max-content` and the long form on the `title`. Measured across
five frames at three step sizes: **nothing clipped**, with `.tl-scale` widened
to a 17rem floor so the ticks have room to be read.

### A transport pair is MIRRORED, and a centred bar may not resize

Two reports on the same row of controls, and both are about a dimension rather
than a behaviour.

**Step back and step forward are one gesture in two directions.** They were
`◀` and `▶|` — a bare triangle against a triangle with a bar — so the boxes
matched at 33.6 px and the INK did not, and the left read as a scrub where the
right read as a step. The bar is the half that says "one frame" and it belongs
on both or neither: `|◀` and `▶|`, with the titles a matching pair as well
("The frame before" / "The frame after").

**The bar is centred (`left: 50%; translateX(-50%)`), so anything that changes
its width walks BOTH its edges.** Measured while scrubbing: **671.8 → 693.8 px
with the left edge sliding 427.1 → 416.1**, on every single frame. `.tl-date`
had solved this long ago with `min-width: 6.2rem` and tabular figures; the note
still carried `min-width: max-content`, which is max-content of THIS frame's
text — and the counter changes width as it gains digits (`2 / 13,513` at 45 px
against `2,508 / 13,513` at 67).

A constant cannot serve it, because every driver writes a different kind of
sentence. So the note reserves **the widest note this sequence will ever
show**, which the player can compute exactly because it holds every epoch.
Three parts, each load-bearing:

- **Measured on a CANVAS, not in the DOM.** Writing 354 epochs into the element
  in turn is 354 forced reflows, and this runs while a sequence is building.
  `measureText` needs no layout at all.
- **`flex: 0 0 auto`**, so the reservation cannot then be squeezed away by a
  neighbour — which is what the old `max-content` note was written to prevent.
- **It only ever GROWS.** A driver whose note arrives WITH THE SCENE (the
  imagery animator prints whatever the fetch reports) cannot be measured ahead,
  so the reservation is raised as those land. The bar settles at its widest and
  stays there rather than breathing.

Measured after, 15 samples across all three step sizes at five positions each:
**bar width 696.7 with a spread of 0.0, left edge 414.6 with a spread of 0.0**,
the note holding 70 px throughout.

**When a floating control changes size, ask what inside it is sized by its own
content** — this tree has now paid for it three times (the legend and events
buttons measuring a CARD whose width follows its open panel, and here).

### The track in the middle, and the date on the bar's edge

The date sat in the row between the transport and the track, so it was a third
cluster — the track could not be centred, and the widest thing on the bar was
sitting where a reader looks for the handle. It is a pill on the bar's TOP EDGE
now, centred over the track it names, and MERGED rather than floating: no
bottom border, pulled down a pixel so its own ground covers the bar's top
border across its width. A tab, not a chip.

**Centring the track is a fact about the two clusters either side of it**, not
about the track. `balanceRow` measures the lead and the trail and gives both
the wider one's `min-width` — measured rather than declared, because their
contents differ by driver: the overlay toggle exists only where there is an
overlay, so any constant would centre the bar for one driver and lean it for
the next. Re-run whenever the note grows, since a wider trail is an off-centre
track. Measured over 12 samples across all three step sizes: **lead 163 =
trail 163, and the track's midpoint on the bar's midpoint to 0.00 px at every
one**.

**AND A RESERVED BOX IS NOT THE INK.** `reserveText` writes `style.width`, the
page sets `box-sizing: border-box`, and the pill has 25.6 px of padding — so a
reservation of 38 px left **36 px of box for 48 px of "2000"** and the year
clipped, silently. The note has no padding, which is exactly why the same
function worked there and failed here. The reservation adds the element's own
padding and border when the box is border-box. Measured after: nothing clipped
at any frame, at any step size.

**The pill is reserved too, though it cannot move the bar.** It is absolutely
positioned, so its width reaches nothing — but a pill resizing under a still
slider is the same jitter one step out. One width per sequence: 65 px for
years, 89 for months, 113 for full dates.

**And the backtick trap, for the SIXTH time in this file's history** — my own
new comment said `balanceRow` in backticks inside the STYLE literal, which ends
the string. `node --input-type=module --check` named it immediately, which is
the argument for running it on every edit to a file with CSS-in-JS rather than
trusting a diff. The patch script now asserts the STYLE literal is
backtick-free before writing.

### A shrink-to-fit bar has no room to give its track

"So much space to extend the slider into" — and the track could not take any of
it, because the bar had no width of its own. Shrink-to-fit, a flex row has NO
free space by definition, so `flex: 1 1 auto` on the scale grows it by nothing
and it sits on its `min-width` for ever. Measured: **272 px of track inside a
640 px bar**, the rest spent on the two clusters and the air between them.

**The ceiling is the SIDEBAR, and it is arithmetic rather than taste.** The bar
is centred, so to clear a 25rem column it has to give up that column on BOTH
sides — `100vw - 50rem`, plus a rem of air each way. Measured at 48rem the left
edge landed **5 px inside the panel**, which is exactly what the subtraction
says it must; at 52rem it clears by 16.

| | before | after |
| --- | --- | --- |
| bar | 640 | **694** |
| track | 272 | **326** |
| tick labels (storm step) | 8 | 8, over a longer track |
| track off-centre | 0.00 | **0.00** |
| gap between track and note | ~50 | **9** |

**And then the padding that centred it went too, because it was the space.**
Equal clusters centre the track exactly and cost the difference between them —
51 px of nothing, sitting where the track wanted to be, first pooled beside the
slider and then spread as a hole between the note and the close. Both readings
were reported. A centred track is not worth a shorter one.

So neither cluster is padded, the count sits against the close
(`justify-content: flex-end`), and **what is centred is the DATE PILL, over the
track's own middle rather than the bar's** — which is the honest place for it
anyway, since it names the frame the handle is on. `alignDate` measures it,
because the lead carries four controls and the trail two or three (the overlay
toggle exists only for a driver that draws an overlay), so no constant places
it for every driver.

| | as reported | now |
| --- | --- | --- |
| track | 326 | **377** |
| tick labels, storm step | 8 | **10** |
| gap between note and close | ~42 | **9** |
| pill over the track's centre | — | **0.0 px** |
## The cyclone subtab, put in order — and what fell out of doing it

"Why are you incapable of keeping things organised today?" Fair: the tracks'
Plot-by and Season-span selects sat under the RISK row, and the live-storm
proxy was a hand-written `.row` at the foot of the tab wearing its own idiom.

**A layer's settings hang UNDER ITS OWN ROW, as a drawer, only while it is
loaded.** `entry.settings` names a block of page markup; `catalogue-list`
docks it in a `.gis-catalogue-settings` drawer straight after the row when the
layer is on the globe and parks it home, hidden, when it is not. Markup rather
than built, because the selects hold state that a rebuild per tick would throw
away — measured, the step stays "storm" through the redraw a second tick
causes. Two things that bite: the block must be RESCUED before the list is
cleared (`host.textContent = ""` would destroy it with the rows), and BOTH
catalogue projections must carry `settings` — the third field this trap has
now cost, after `detailCopy` and `play`.

**The live feed is Live's own row, seen again.** `data-feed-proxy` on a host;
events.js fills it with the SAME `sourceRow` template the feed panel draws, so
the glyph, the type and the tick are identical by construction (measured:
computed row and name styles equal, cyclone mask present) rather than an
imitation that drifts. A side effect worth having: the feed panel's own rows
drew a literal "●" for every source, and now go through `glyphSpan` too — the
storm row in Live wears the cyclone.

### Two callers, one sequence, and a poll that read a handover as a ✕

Ticking the risk map cold left TWO "estimate" sheets registered — two
Workspace rows, two drapes — and the timeline named it: `addDataset` applies
the entry's default view (`setView → play`, sheet 6 at 16.3 s), whose
`startPlayer` takes the TRACKS' bar down; the 700 ms poll in `animated-layers`
then sees an owner with no bar, calls that a dismissal, and `sync` opens the
risk entry ITSELF (sheet 7 at 17.5 s). Two guards in two files cannot close a
window a third file is polling through. Three fixes, each load-bearing:

- **One drape per dataset BY CONSTRUCTION** — `open_` takes any sheet of its
  own name off before registering. The guards may lose their race; the globe
  still holds one.
- **A dismissal is ANNOUNCED, never inferred.** `stopPlayer({ reason })`
  dispatches `geoid-gis:timelapse-stopped`; only `"dismiss"` (the ✕) marks the
  owner dismissed. The poll that inferred one from an empty bar is gone. Before
  this, unticking the risk gave the tracks NO bar back while they were still on
  the globe — held "dismissed" by a handover.
- **A held open CLAIMS the bar** (`hold(work, id)`), so an open made from
  outside the module — the catalogue's default view — records who owns it.

### The bar that never came up, and the throw nobody saw

On the cold path only, the risk's bar then never appeared at all and the sheet
was orphaned. `setView` writes `cycloneView = "estimate"` BEFORE the sequence
opens; the tracks' teardown, run by the risk's `startPlayer`, calls
`showClimatology()` bare — "put back what the grid was wearing" — and the grid
was wearing "estimate", which is not a paintable view: `VIEWS.estimate.field`
threw inside `stopPlayer`, after the tracks' bar was removed and before the
risk's was built or the stop announced. **`addDataset` wraps `views.apply` in
a bare try/catch, so the whole broken open vanished without a line of console.**
Cached, there was no tracks bar to tear down, so it worked — which is why it
looked intermittent. Two fixes: a bare `showClimatology()` leaves a layer
wearing the estimate alone (the sequence owns what the grid shows), and
`stopPlayer` runs a driver's `onStop` under try/catch and ALWAYS completes and
announces. **A try/catch that says "the layer keeps whatever it had" is where a
broken feature goes to be silent.**

### The frames were off by one, and the opening frame was the wrong one

`unhandledrejection` capture — installed only to hunt the race — caught
`Invalid sample index '47'`. geotiff.js samples are 0-based; the bake's VRT
numbers bands from 1; `open()` read the descriptions 0-based and the epochs
counted from 1. Measured on the file: **sample 0 is "1980" (128,307 cells
reached), sample 46 is "2026" (384,060 — the full record), 47 is invalid.** So
every frame showed the estimate a season later than its label, the last frame
— the one the bar OPENS on — failed and was swallowed, and the sheet every
reader saw first was sample 1: "1981", 175,184 cells, captioned "after 47
seasons". Fixed to 0-based throughout and draped with the LAST band first.
Verified cold: opening frame 384,060 opaque cells = band 46 exactly, frame 0
128,307 = band 0, zero errors.

### Measuring this cost four instruments' worth of lessons

- **The browser tool has a 45 s window and its locals die with it.** A reload
  plus a 40 s wait is over it, and the log was a `const`. Stash the log on
  `window`, split the run into steps, and sample at 100 ms into a trace that
  records only CHANGES.
- **`python -m http.server` serves no byte ranges**, so geotiff.js cannot open
  a COG from the dev server ("Request failed"); resolve the bucket URL through
  the app's own `dataUrl`, imported in the IFRAME's realm under the live stamp.
- **A `cd` into `gis/` in one command leaks into the next**, and then
  `GeoID_GIS/tests/run.mjs` and `stamp.py` are not found — twice this session,
  once letting a commit through with a failing pin because a `;` stood where
  `&&` belonged. Absolute paths, and gate the commit on the suite's own line.
- **`node --check` cannot see a missing function that only the `window` block
  references.** My slice replacement deleted `hold()` along with `watchBar()`;
  the seam still named it, the module would have thrown at load in the
  browser, and the only thing that caught it was a source-text pin.

### A frame is its own group; the archive is the All frame alone

The season plot was made CUMULATIVE for a turn — every group up to the frame,
"the record draws itself in" — and it was reported as the tracks never
leaving. Right: by the last season the map was the whole archive again, so the
animation showed nothing a still map did not, and a season's storms could not
be read as that season's. Each frame now drops the one before it in its wake.
Verified live, by season and by storm: **exactly one group visible at every
frame**, the counter the frame's own (105, 120, 120, 75 — not a running
total), the click list following it, and the whole archive only on the
terminal All frame (base layer back, plot hidden, "13,513 storms").

The reasoning that made it cumulative was about the COUNTER reading well as it
grew. A counter is not a reason to change what is drawn.

### Tick labels are placed in PIXELS, and the origin always carries a mark

"The timeline is a mess when we visualise the whole archive — the x ticks get
crowded." Measured: "1842" and "1880" drawn on top of each other at the left
end, with room to spare on the right. The labels were chosen every nth MARK
by count, which assumes the marks are evenly spaced along the track — and
they are not. A frame is a season WITH storms in it, so 1842 to 1880 is a
handful of frames that are decades apart in name.

`pickLabels(marks, width, gap)` in the player decides in pixels: walking left
to right, a label goes only where it stands 34 px clear of the last one
placed. Round years first — decades are what a reader looks for on a time
axis — and other marks fill in only where a decade is not within reach, which
is the short spans, where "1980, 1990" would otherwise be two labels on a bar
that holds eight. Pure and pinned on a sparse fixture (1842 at 0 px, 1880 at
12 px: the second is refused).

**And the first frame is always MARKED**, whatever the step: the season step
marked decades only, so on the 1842 span the marks began at 1860 while the
slider began at 1842. A scale with no origin is not a scale, and the rule has
to hold at the mark as well as at the label.

Measured after, by the label boxes themselves:

| span · step | ticks | labels | overlaps | min edge gap |
| --- | --- | --- | --- | --- |
| 1980 · season | 5 | 1980 1990 2000 2010 2020 | **0** | 61.3 px |
| 1842 · season | 18 | 1842 1870 1890 … 2010 | **0** | 17.0 |
| 1842 · storm | 166 | 1842 1900 1930 … 2025 | **0** | 17.5 |
| 1842 · month | 177 | 1842 1880 1910 … 2010 | **0** | 20.9 |

The gap after 1842 is wide on purpose: the record between 1842 and 1900 is a
few dozen frames, so that is where the track genuinely has the least ground
to give a label.
## Volcanic hazards: a second subtab built the cyclone way, and a merge by stencil

Hazards ▸ Volcanic hazards reads, top to bottom: **Volcanic activity
(EONET)** — Live's own eruption row seen again, the `data-feed-proxy`
mechanism the cyclone subtab uses — then the **Smithsonian volcano row**, and
under it, docked while the layer is loaded, the **hazard buffers**.

**A catalogue row seen from a second tab is DECLARED, not duplicated.** The
volcanoes are geology — that is their home and where they light the tab —
and they are also what the buffers are drawn around. `MIRRORS` in
`global-data.js` names the home that may show the row again, and
`catalogue-panels` draws it into that host with the SAME hooks: same tick,
same layer (`layerForDataset`), same Symbology button. Measured: ticking from
Hazards ticks Geology and the reverse, and unticking from either takes the
layer and the buffers with it. A mirror may dock its OWN settings block under
the row in its tab alone — a block is one element and can hang under one row
— so the buffers live under the mirror and not under Geology's copy. The
"exactly one list" test now reads: once as itself, once per declared mirror,
nowhere else.

**The zones are Etna Explorer's, verbatim** — 0–5, 5–10, 10–20, 20–35 and
35–50 km with INGV's hazards per band — and the test reads them back out of
`etna-viewer.js` rather than trusting a copy. Which volcanoes get them is the
catalogue's own `label_rank` (eruption recency: 5 = since 2000 … 1 = undated
Holocene), defaulting to "erupted since 1900"; a Pleistocene volcano never
does. Measured: 438 volcanoes → 2,190 zone polygons; every Holocene volcano →
**1,214 → 6,070**, which is the catalogue's own Holocene count to the unit.

### Overlaps merge in the STENCIL BUFFER, not in geometry

A union of a thousand discs through the boolean engine is a fault this tree
has paid for three times over (concave subjects, chords, slivers) — and a
union is the wrong product: the reader's question is "what is the WORST
hazard reaching this ground", a per-pixel minimum over distance. So the
zones are drawn innermost first (a fractional `renderLift` per zone, which
`applyStack` carries through every redraw), each fill writes stencil 1 where
it paints, and every later fill is refused where the stencil already reads 1
(`NotEqual` / `Replace`). One paint per pixel, highest hazard wins, nothing
double-darkens at 50%, and every disc stays its own clickable feature. The
per-polygon seal is switched off — at 50% a seam doubled along every disc
edge is the alpha-accumulation fault already recorded.

**three r163 turned the renderer's stencil buffer OFF by default.** Measured
on this page: `getContextAttributes().stencil === false`, 0 bits. Every
`WebGLRenderer` attempt in earth-viewer now passes `stencil: true`; it packs
with the 24-bit depth buffer (measured 8 bits after) and costs nothing. Any
material-level stencil work is silent without it — the properties are set,
nothing tests them, and the discs simply double-blend.

### Two probe traps, both mine

- **The volcano row's first `<input>` is the label-detail RANGE**, not the
  tick. `querySelector('input').checked` read false on rows that were plainly
  ticked, and I chased a mirror-sync fault that did not exist for a round.
  Ask for `input[type=checkbox]`.
- **The import manager announces through `onChange`, not the DOM event.**
  `geoid-gis:layers-changed` is dispatched by the symbology and the
  hierarchy; a layer REMOVED through the catalogue never fires it. The
  buffers' follow was on the event and the buffers stayed on the globe round
  volcanoes no longer drawn. `im.onChange(follow)` — the list every catalogue
  subscribes to — with a bounded retry, since the manager may not exist at
  module load.

### Far-field ash: not as a fixed buffer

Asked whether to add one. No — a fixed-radius ring past 50 km says ash falls
in a circle, and ash falls in a PLUME: wind-driven, anisotropic, and sized by
the eruption. A circle there claims a symmetry the phenomenon does not have,
which is the same fault as a map claiming a precision its source never had.
The honest far-field product is a plume from the live wind field — the
Open-Meteo GFS winds are already fetched for the weather card — as a separate
piece of work, drawn as a sector downwind and labelled for the eruption size
it assumes. The 35–50 km band already carries "trace ash" as its own text.

### "Failed to fetch" on a catalogue row is an ORIGIN, not the data

"Tropical cyclone tracks (IBTrACS) did not load: Failed to fetch." Measured
before believing any of it: the file is in the bucket byte-for-byte with disk
(12,606,046), listed in `sources.json` with its fingerprint, served **206
with CORS** to `https://geoidinitiative.com`, `https://www.geoidinitiative.com`
and `http://localhost:8125`, `vary: Origin` and `cf-cache-status: DYNAMIC` (so
no cached CORS-less variant), and fetched whole from the page on 8125. It is
served **206 WITHOUT the CORS header** to `http://localhost:8123`,
`http://geoidinitiative.com` and `geoidinitiative.github.io` — and a
cross-origin response with no `Access-Control-Allow-Origin` reaches the page
as a bare `TypeError: Failed to fetch`, no status attached. An HTTP failure
would have read "HTTP 404".

So the row now says what that means: `explainFetchFailure` (data-base.js,
pure, pinned) names the bucket and the page's origin and states both causes —
the network, or an origin off the bucket's CORS allowlist — with the two that
are on it. The allowlist is an account-level setting; nothing in this repo can
add an origin to it, which is why the sentence is the fix rather than a
config change. Check the address bar before anything else.

### The zone card is Etna's, the legend names the ash, and every Holocene volcano is buffered

Three reports off one click on a buffer. **"Why are some volcanoes missing
buffers — are these not active?"** They were the ones whose last eruption was
before 1900, the default band — Ilopango, VEI 6 in the fifth century, had no
zone at all. The Smithsonian's working definition of "potentially active" is a
Holocene eruption, so that is the default now: **1,214 volcanoes → 6,070
zones**; the narrower bands stay on the select. **"Where's the ashfall
extent?"** In the 10–20, 20–35 and 35–50 km bands, which the legend labelled
by risk level alone; it now carries Etna Explorer's own legend words beside
each range ("High Risk · 10–20 km · Ash fall, lahars, airport closures").
**"Buffer zone pop-up undeveloped."** It opened the generic rock card —
CONTINENTAL / Mapped area / an area. `volcanic-zone-card.js` is the fourth
card in this tree to write its own lines, carrying Etna Explorer's zone text
verbatim: the band and its distance from the named volcano, the volcano's
last eruption, INGV's hazard list, the detail paragraph, and what a schematic
buffer is not. The test reads bands, colours, labels, hazard lists, detail
paragraphs AND legend words back out of `etna-viewer.js` and its page.
Verified by a real click 15 km east of Etna at 382 km: "Volcanic hazard zone
· 10–20 km from Etna / High Risk / Etna — last known eruption 2026 · Ash fall,
lahars, airport closures", five hazards, the paragraph.

**The generic area ignores a hole.** The card read **1,255 km²** for the
10–20 km band — π·20², the outer disc — where the annulus is 942. Each zone
now carries its exact spherical-cap area on the feature and the card reads
that, pinned to 0.1% of the planar figure.

**A module that throws at import takes every test importing its importer
down with it.** `feature-popup.test.mjs` stubs `window = globalThis`, which has
no `addEventListener`; the volcanic module's `typeof window` guard passed and
`window.addEventListener(...)` threw at import — 0 passed, with the stack
pointing at the volcanic file. Guard on the LISTENER, not on `window`.

**And that test takes 35.7 s with or without the volcanic import** — seven
checks done in three, the process alive for thirty more; `_getActiveHandles`
shows only stdio. Pre-existing, not chased here; flagged as its own task.

**Placing a click by projection: use the viewer's own `GeoIDProjectLatLon`.**
`surfacePoint` + `localToWorld` + `project` put Etna at x = 3,002 on a
1,526-px page — the baseline-frame trap, again. The viewer's projector carries
the spin. And at the default view 15 km is under a pixel; framing a small
helper layer (`importFileList` with `frame: true`) is the reliable way in, and
the helper must be REMOVED before clicking — it sat over the zone and the
picker returned it first.

### The picker names the zone that is drawn, and the highlight is the merged shape

"Ensure the buffers merge fully — when we hover over one, the circular
structure beneath still shows even when merged." Two faults behind that, and
the first was invisible until the sheet was merged.

**The picker and the painter disagreed.** The sheet paints the WORST hazard
reaching a pixel; `featuresAt` returns the first containing polygon in the
feature array, which was build order — so 15 km from one volcano, inside
another's 35–50 km band, the card could name the far volcano's mild band over
the colour under the cursor. The features are sorted innermost-first now (the
survey-precedence rule, met again), pinned.

**The hover was the circle.** The generic highlight OUTLINES the picked
feature — for an annulus, two circles — cut straight across the neighbours it
had merged with. That is exactly the structure the stencil merge exists to
remove, redrawn on top of it by the one control that says "this". So a layer
may draw its own highlight (`layer.highlightFor(feature, {colour, opacity})`,
a seam in `buildHighlight`, answering LEAF MESHES because the popup's pulse
animates the opacity of what it is handed). The buffers answer with the same
zone for every volcano in the picked one's GROUP — union-find over volcanoes
within twice the widest band, transitive, so the Aeolian arc is one shape —
as fills painted once through a second stencil ref (2). The lit region has
only the merged boundary.

Measured on Panarea's 20–35 km band at 382 km: the selection holder holds
**one fill mesh** (2,688 vertices against 130 ring points for a single
annulus), stencil ref 2 / NotEqual / band 239, pulsing; the group is Palinuro,
Panarea, Lipari, Stromboli, Vulcano, Etna and Marsili. Worldwide: the largest
group is 107 volcanoes, and 185 stand alone.

### "Not a clean buffer merge" — the highlight was, the sheet was not

Two claims in one screenshot, and only one was true.

**The hover was lighting ground the sheet does not paint in that zone.** The
merged highlight was the UNION of one zone's annuli across the group — and a
neighbour's worse band sits inside those annuli, so lit whole they showed the
base through as crescents: the circular structure back again, drawn by the
one control that says "this". The highlight is now built exactly as the sheet
is: the group's zones BELOW the picked one are drawn first with colour off,
writing stencil 2 where they cover (`Always`/`Replace`, opaque pass), and the
zone fill is refused there (`NotEqual 2`). What lights is exactly the ground
the sheet paints in that zone, merged. Measured on Panarea's 20–35 km band:
one colourless mask of 6,678 vertices ahead of one fill of 2,688.

**The sheet itself was right all along, and it took four instruments to be
sure.** Pixels solved by `2·shown − base` (layer shown / hidden) came out
WHITE at the crescents — that was the hover holder, drawn outside the layer
and surviving its being hidden; with it hidden the crescents solved EXACTLY to
zone colours (#ff6600, #ffaa00). A pixel two green annuli share paints green
once with the stencil on ([68,204,102]) and twice with it off. Every fill
draws once per frame; the stencil is auto-cleared. A transect from Stromboli's
vent reads 0,0,1,1,2,2,2,3,3,3,3,4,4 eastward, and westward its deviations
are Panarea's and Lipari's worse bands taking precedence. And a 25×25 grid at
2.5 km over ±30 km scored against the analytic worst-wins expectation over
every vent within 120 km: **395 of 403 match**; the eight are two exact
boundary ties at 5.0 km and six pixels under the "Stromboli" label chip.

So the arcs are the honest shape of a dissolved multi-ring buffer: one
volcano's band cut by a neighbour's severer one. That is the map, not a fault
in it.

**The annuli leak into their own holes.** Measured on the Aeolian group's
5–10 km ring: 0 of 896 triangles outside the outer ring, **34 inside the
hole** (190 of 896 for 20–35 km) — the same with the hole ring reversed, and
none for a plain disc. Invisible under the stencil, because a volcano's inner
zones paint first and refuse them, and it is why the stencil-off A/B shows
full discs. Not fixed here; it would show the day a zone is drawn without the
ones inside it.

**The pane's `computer` hover does not reach the canvas.** No hover holder
appeared for a hover the tool reported as done; the click does reach it. A
hover state has to be driven by dispatching `mousemove` on the canvas, or read
from the user's own screenshot.

### The mask drew in the wrong PASS, and same-colour buffers looked unclipped

"In the merge process the overlapping buffers of the same colour do not clip
each other" — with a screenshot of the hovered Low-Risk band lying over every
inner zone of the group, and red BOW-TIES where the cores should be.

The mask was right and drawn at the wrong moment. Its material was opaque, so
three.js drew it in the OPAQUE pass — before the base sheet's transparent
pass — and the sheet then overwrote the mask's stencil 2 with its own 1
everywhere it painted. By the time the highlight fill was tested, nothing was
masked, and the bow-ties were the few places the base had not painted at all.
Render order within a pass cannot fix an object that is in the other pass.

The mask is transparent now (colour off, opacity 0, so its blending is moot),
which puts it in the same pass as the sheet and the fill, at 239 between the
sheet's 51.xx and the fill's 239.5 — the only order that works.

Measured with the hover driven by a synthetic `pointermove` on the canvas
(the pane's own hover tool never reaches it), the Low-Risk band hovered at
110 km: the pixels at Stromboli's vent, Panarea's vent and Stromboli's
10–20 km band are BYTE-IDENTICAL with and without the hover, the zone-4 pixel
goes [38,108,62] → [95,184,168], and an eight-bearing sweep at 2, 7 and 15 km
round Stromboli, Panarea and Vulcano finds **0 of 68** samples lit inside a
worse zone. The lit shape has only the merged region's boundary.

**When a stencil trick "does nothing", ask which PASS each party draws in
before asking about order or refs.** `transparent` decides the pass, and the
pass decides before `renderOrder` gets a say.

### A vent is a triangle, and a marker sits 30 m off its ground

"The volcano location dots should be triangular and touch-tight to the
surface (currently float)." Two changes in the renderer's point path, and the
second is the event markers' own finding met in the vector layers.

**A marker's clearance is a ground measurement, not a camera one.** Markers
shared the lines' altitude-scaled clearance — 2% of the distance to the
surface, 12 km from orbit — which a depth-tested LINE needs to clear the
relief between its vertices. A marker does not depth-test; nothing can bury
it; the clearance bought nothing and cost parallax, and at 110 km up a
volcano's mark stood **2.2 km** off its vent. `lifted: "marker"` now takes a
constant **30 m** (`MARKER_DRAPE_UNIFORM`, its own program cache key), the
figure the event markers settled on for the gap between the sampler and the
drawn mesh. Measured through the material's own `uDrape`: **30 m at 14,016 km
and 30 m at 60 km**. Measure the uniform, never the buffer — the baked
vertex is not the drawn position.

**`pointSymbol: "triangle"` on a catalogue entry** rides through `addDataset`
→ `importFileList` → the geojson parser → `buildVectorLayerResult` (both
paint paths) → `renderFeatureCollection`, exactly the road `pointStyle` takes;
a field left out of any link falls back to the disc silently, so all five are
pinned. `markerTriangleTexture` is built as the disc is — white ink tinted by
the vertex colour, the outline underlay the same shape larger, shared and
never disposed — and CENTRED on its coordinate by its CENTROID, not its
bounding box, so the popup's hover ring and selection halo still fit it. Ink
measured on the texture: 12 px wide at the top row, 34 at the middle, none
below the base at 72%: an equilateral, apex up.
## The volcanic risk map: magnitude AND frequency, from the record

Hazards ▸ Volcanic hazards carries two products now, and they answer
different questions. The BUFFERS are five fixed rings round every Holocene
volcano whatever it has done. `bake-volcanic-risk.py` → `volcanic-risk.geojson`
is what each volcano has actually DONE, and how often: every confirmed, dated
eruption in the Smithsonian catalogue (9,916 of 11,089; 'Uncertain' left out)
reaches a schematic radius set by its VEI and is counted over the years
eruptions of ITS size are recorded. Built the cyclone map's way — a point
within a reach, never per cell; `P = 1 − exp(−λ)`; the quadtree ported line
for line — and three readings of one 3.9 MB file on the symbology row:
ashfall from any eruption, from large ones (VEI 4+), and the largest VEI on
record reaching the cell.

**THE WINDOW IS PER SIZE, and it is what lets a DORMANT volcano count.** The
first bake used one window per broad class and Naples and Tokyo came out at
ZERO — Vesuvius (VEI 5, 1631) and Fuji (VEI 5, 1707) fell outside "since
1900". Measured on the catalogue, confirmed eruptions per fifty years: VEI ≤ 3
flatten only after 1950; VEI 4 runs 8, 10, 11, 9, 11, 19, 14, 21, 26, 27 from
1500 (flat from ~1850); VEI 5 runs 3, 5, 5, 3, 1, 4, 3, 3, 5 from 1550 — flat
for four and a half centuries; VEI 6 about one per fifty years since 1550
against 43 in the ten thousand years before 1000 CE. So VEI ≤ 3 since 1950,
VEI 4 since 1900, VEI 5–6 since 1550, VEI 7+ the whole Holocene. Naples and
Tokyo read 1 in 476 years; Catania 1 in 19; Yogyakarta 1 in 15; Paris and
Sydney nothing. A quarter of the catalogue carries no VEI and is counted as
VEI 2, said in the file.

**THE REACH IS SCHEMATIC AND ISOTROPIC, and the card and the ⓘ both say so.**
5 km at VEI 0–1, 15 at 2, 40 at 3, 120 at 4, 300 at 5, 600 at 6, 1,000 at 7 —
order-of-magnitude distances at which about a millimetre of ash is reported.
Ash falls in a wind-driven plume; the circle is the fixed-radius stand-in, and
a real eruption today wants the plume product from the live wind field, which
is separate work.

**`np.maximum(a[idx], v, out=a[idx])` writes to a COPY.** Fancy indexing
materialises `a[idx]`, so `out=` lands in a temporary and the array is
untouched: every cell shipped `vei_max: 0` and the quadtree gate on it did
nothing. `a[idx] = np.maximum(a[idx], v)`. Caught by a histogram of the
output, not by the bake, which printed nothing wrong.

**The magnitude is ORDINAL, so the quadtree gates on it as a CLASS** — a
block holding two VEIs is not flat whatever its rates — and it is painted in
VEI order with a fixed palette, never through `categoricalSymbology`, which
ranks by frequency and folds the rest into "(other)": a scale ranked by count
has lost its order.

**A volcanic cell carries the cyclone card's three columns.** `isRiskFeature`
tests `p_yr`/`rate_yr`/`deg`, so tested second the volcanic grid would open as
a TROPICAL CYCLONE. `feature-popup` asks `isVolcanicRiskFeature` (which also
needs `vei_max`) first, and the test pins the order in the source. Two
existing pins had to learn the third entry: "both cyclone entries declare
their readings" counted `views:` blocks, and the cyclone card's pin matched
`const risk = !ice && !soil && isRiskFeature` verbatim.

Verified live on 8125: fetched from `data.geoidinitiative.com` with its
fingerprint in 11.9 s, 9,989 cells at 0.6 under `GeoID-ImportedGeoLayers`,
every key summing to 9,989 in all three views (the large view's "no large
eruption's ash on record" row 365 = 9,989 − 9,624 drawn; the magnitude view 8
VEI rows matching the bake's histogram), the ⓘ on the row, and a real click
on Catania reading "1 in 19 years · 5.1% a year / large 1 in 11,765 / VEI 7 on
record / Etna — 4 counted eruptions, up to VEI 3". Etna's 4 is honest: only
its VEI 3 eruptions (40 km reach) cover Catania at 27 km.

Not done, stated: no per-year sidecar or COG animation of the estimate as the
cyclone map has — the eruption record's per-year counts are cheap to bake the
same way if wanted. And the plume product above.

### The full-record map beside it: magnitude × frequency, no windows

"Can't we utilise the full Smithsonian record — dating back thousands of
years, active or not?" Yes, as a SEPARATE layer, because it answers a
different question and carries a different bias. `--mode holocene` on the
same bake writes `volcanic-risk-holocene.geojson` (13,501 cells, 5.9 MB):
every confirmed eruption back to 9700 BCE, each volcano's frequency over ITS
OWN RECORD SPAN (first eruption → 2025) rather than a completeness window,
and the magnitude carried as a tephra volume per VEI (a decade per step,
VEI 2 ≈ 3 million m³) summed at each eruption's rate — so `tephra_m3_yr` IS
magnitude × frequency and is the layer's opening view. `vei_mean` (rate-
weighted) rides beside `vei_max`.

**What the two maps trade, stated on both cards.** The full record measures a
volcano with a short written record as if it began erupting when somebody
started writing, which overstates it against one known from tephra alone —
Catania reads 1 in 19 years windowed and 1 in 339 on the full record, because
Etna's dated Holocene tephra pushes its span to 8,000 years. The windowed
map corrects for that; the full one keeps every eruption. Neither is wrong.

**Two layers, one module.** `riskLayer(layers, id)` finds each by its own
name (`LAYER_NAMES`), `setView(view, { id })` and `currentView(layers, id)`
are keyed the same way, and `viewOf(props)` tells the card which grid a
clicked cell came from by feature identity — so a view set on one layer
cannot repaint the other, and the card names the record it is reading.
Pinned: the entries' layer names match the module's patterns.

**A log quantity is gated by RATIO.** The quadtree's absolute spread test is
meaningless on a field spanning eleven orders of magnitude, so the tephra
rate is flat when max ≤ 2 × min (and never when empty in part). Its classes
are orders of magnitude for the same reason.

Both files are in R2 through `publish-data.py` (fingerprints in
`sources.json`; `rclone lsf` shows 4,331,234 and 5,867,072 bytes, matching
disk). Verified live on 8125: 13,501 cells at 0.6 from
`data.geoidinitiative.com`, four keys each summing to 13,501, the windowed
layer untouched by the other's views, and a click on Sicily reading
"83.3 million m³ a year · VEI 7 on record · typical VEI 4.6 · Etna — 21
counted eruptions, up to VEI 5".

### "Underdeveloped": a hard disc is a picture of the radii, not of the hazard

The first two bakes drew a scatter of islands — 9,989 and 13,501 cells with
nothing between them — because an eruption counted at a point only INSIDE its
radius (15 km at VEI 2) and stopped dead at it, and because the eruption list
names 915 of the catalogue's 2,666 volcanoes. Three changes, all in the bake:

- **A KERNEL, not a cut-off.** Each eruption counts `exp(−d/R)` of itself
  and is dropped past 4R (1.8%). Ashfall thins with distance; it does not
  stop. The disc lookup now carries row indices so the haversine is solved per
  cell at stamp time.
- **Every volcano is in.** The 1,751 with no dated eruption take a stated
  FLOOR PRIOR — a Holocene one, one VEI 2 over the Holocene; a Pleistocene
  one, one VEI 3 over the Pleistocene (2.58 My) — and a cell that nothing else
  reaches carries `prior_only: 1`, which the card names as its Basis. That is
  the rock-property database's "prior gets its own class" rule again.
- **Uncertain eruptions count at half weight** rather than being dropped.

Measured after: 32,868 and 29,289 cells covering 48–57% of the lat/lon plane
(14.5 and 13.0 MB); Paris 1 in 30,000 years, New York, Moscow and São Paulo
carrying a VEI 7 tail; Delhi and the southern Indian Ocean genuinely nothing
within 4R. The return-period scale gained a 1-in-10,000 class because the
tails put most of the map below one in a thousand. A `flat_log` gate (max ≤
2·min, never empty-in-part) coarsens the tephra field, which spans eleven
orders of magnitude and cannot be gated on an absolute spread.

**`first_year` must include the uncertain eruptions once they count** — a
volcano whose only dated record is uncertain otherwise KeyErrors in holocene
mode. And a module-level constant cannot read one defined below it
(`PRIOR_HOLOCENE` reading `LAST_COMPLETE`): the bake raised at import.

Verified live: the full-record map from the bucket at 29,289 cells, its
tephra key summing to 29,289, and a click on Nairobi reading "2.57 million m³
a year · VEI 6 on record · Olkaria contributing most · 18 volcanoes reaching
here".

### "This is a mess": three ideas removed, and a raster with a band per VEI

Reported three ways in one sitting, and each report named a real fault:

- **"Maybe a tiff raster is a better format for global risk."** The quadtree
  grid is the cyclone map's and is right for a SPARSE field; once the kernel
  made this field smooth and global, 30,000 cells of six sizes read as a
  mess. A smooth field wants a lattice: the bake writes the 0.25° lattice
  itself as a Float32 COG (1440 × 720 × 12 bands, 6–7 MB deflated), and
  `volcanic-risk-raster.js` reads it whole and drapes it — the cyclone
  estimate's own arrangement (`gee.drape`, register, then `globe.add`, one
  mesh retextured per view). The geojson grids are gone from disk and bucket.
- **"Maybe the issue is that you dynamically estimated the ashfall extents
  by VEI."** Yes: five radii drew five sizes of overlapping disc, each with
  its own edge, and the map was a picture of the radii. ONE kernel scale
  (100 km, dropped past 400) for every eruption; size is which BAND an
  eruption falls in, not how far it reaches.
- **"The symbology is all off — create risk maps for occurrences of each VEI
  number per year."** The tephra-volume proxy and the "large eruptions"
  reading were derived quantities under keys nobody could read. A band is now
  a plain rate of ONE size of eruption per year — `vei0`…`vei7`, plus `any`,
  `vei_max`, `vents`, `prior_only` — coloured on one return-period scale
  (1 in 100,000 to 1 in 5 years, since a VEI 7 band lives at the top). The
  card lists every size's rate at the point, largest first.

Kept from the earlier rounds because each was right: per-VEI completeness
windows (and the full-record twin over each volcano's own span), every
catalogue volcano with a floor prior drawn at half alpha and named on the
card, uncertain eruptions at half weight.

**Two sheets, one module, keyed by dataset id** — `state[id]`, `sheetLayer(id)`,
`setView(id, view)` — as TILED rows under the volcanic-hazards home (a raster
is not a file `global-data.js` can describe; the soil-thickness row is the
precedent), each carrying `maths: mathsFor(id)`. `probeAt` is the popup's
sheet-click seam beside the thickness sheet's, answering from the bands in
memory rather than the picture.

**Bake rewritten rather than patched a fourth time.** Three rounds of patches
had left two windows tables, two stamping paths and a `main()` that wrote two
products; the rewrite is 250 lines and writes one. When a script's third
patch has to work around its second, rewrite it.

Verified live on 8125: the windowed sheet from `data.geoidinitiative.com` in
2.2 s, each band's key summing EXACTLY to its painted pixels (any 226,412 ·
VEI 5 17,184 · VEI 7 5,109 of 1,036,800), ten readings on the symbology row,
opacity 0.7, and a click on Catania reading "VEI 5 · 1 in 17,498 years ·
0.0057% a year / any 1 in 4.2 years / VEI 3 1 in 23 / VEI 2 1 in 9.5 / VEI 1
1 in 11 / 21 volcanoes within reach".

### Gridded again: one map per VEI, played through the bar

"Gridded was better. I meant maybe we need 5 different maps to map risk by
each VEI — compiled into one animation like the hurricane animations, by
instead of date we go through VEI 1–5 and a collective." That is the shape,
and it is the cyclone tracks' arrangement exactly: `volcanic-risk-frames.js`
is a third driver for the one player, with the VEI in place of the date and
the COLLECTIVE (the catalogue layer itself) as the terminal frame the bar
parks on when the layer is ticked. The raster is gone — the grid coarsens
where a band is flat, and a VEI 5 map is flat over almost all of its extent.

The bake writes six quadtrees per record — `vei1`…`vei5` and `any` — each
over ONE band alone, so the frames are 2–9 MB and the collective 14–16 MB;
frames are fetched when the bar first reaches them, drawn once and kept,
and the frame before goes in its wake. The collective carries every band's
rate on each cell, so a click on it lists every size at the point; a frame's
cell is titled for its band, which `bandOf` reads off the plot by feature
identity. Kept from the earlier rounds: one 100 km kernel for every eruption
(size is which map a cell is on, not how far it reaches), per-VEI windows and
the full-record twin, every catalogue volcano with a stated floor prior,
uncertain eruptions at half weight.

**A frame's key is built FROM THE SCALE, never from the frame.**
`buildSymbology` drops the classes outside a file's own range, and a VEI 5
map lives entirely below one in a thousand years — its key would have opened
on "rarer than 1 in 100,000" for a row that was really the fourth class, with
the labels assigned by index. Caught by the test before the browser:
`framePaint` classes with `classOf` over the fixed edges, so every frame
carries all eight classes with counts and a colour means one thing in every
frame. Measured: VEI 5 counts `[0, 1685, 4908, 1759, 66, 0, 0, 0]`, VEI 3
`[608, 86, 3066, 2558, 1298, 2481, 1675, 103]`, both on the same key.

**A bar writes its note when the frame is SHOWN, and a frame fetched on
demand has no count yet.** "VEI 5 · … cells" stayed on the bar after the
frame landed; the count is now written back into the note the bar is still
showing. And a hidden layer keeps its card, so the collective's key had to
be withheld while a frame is up — the risk raster's own lesson, met again.

**A patch script's anchor must be unique, and a failed assert leaves the
earlier patches applied.** `import {` matched five times in global-data.js;
the script died there with the catalogue rows already removed and the
entries already added, so the second run had to skip what the first had
done. Anchor on a whole line.

Verified live on 8125 (stamp 5b7fb53): tick → the collective from the bucket
in 4.0 s, 42,431 cells at 0.6 with an eight-class key summing to 42,431, bar
parked on All; three presses of the step-back button fetch `vei5`, `vei4`,
`vei3` from the bucket (8,418 / 11,560 / 26,428 cells), the plot visible and
the collective hidden at each, each key labelled for its VEI; a click on
Sicily on the VEI 3 frame reads "VEI 3 · 1 in 22 years · 4.5% a year · VEI 7
on record · 45 volcanoes within reach".

### VEI 6, 7 and 8: the bar steps through every size, one of them empty

The frames now run VEI 1–8 and the collective. VEI 6 and 7 are in the record
(59 and 7 Holocene eruptions → 3,572 and 3,405 cells on the windowed map,
sitting in the two rarest classes of the shared key, which is why the scale
reaches 1 in 100,000). **VEI 8 is a frame with nothing in it, on purpose**:
no eruption in the Holocene catalogue reached that size (Toba, ~74,000 years
ago, is Pleistocene). The bake still writes its file (0 features, 1 KB), the
driver renders an empty group rather than calling `renderFeatureCollection`
on nothing, and the note, its title and the status line all say why — "VEI 8
· none in the Holocene record". A size the bar silently skipped would read
as a missing map; a frame that says there is nothing is the answer.

Verified live on 8125: three step-backs from All fetch `vei8`, `vei7`,
`vei6` from the bucket; the VEI 8 frame reads its note with the collective
hidden; VEI 7 counts `[1774, 1631, 0, …]` and VEI 6 `[0, 897, 2497, 178, 0, …]`
on the same eight-class key.

### The reach is the eruption's size, as a probability of a millimetre of ash

"The size/radius of each of the eruptions appear to be very similar. These
cannot be uniform, they have to relate to the magnitude/volume. Is this the
best method?" Both halves answered:

**No, it is not the best method, and the card and ⓘ say what is.** The proper
probabilistic tephra extent is an advection–diffusion dispersal model
(Tephra2 / FALL3D / HAZMAP) over a wind climatology with Monte-Carlo source
parameters — GAR15's global tephra hazard (Jenkins et al. 2015) — and it is
anisotropic. Without a wind field the honest reduction is **Pyle's
exponential thinning**, `T(d) = T₀·exp(−d/b)`, with `T₀` and `b` scaling with
the eruption: solved for 1 mm it gives a reach per VEI (5 km at VEI 1, 15 at
2, 50 at 3, 150 at 4, 350 at 5, 800 at 6, 1,800 at 7; checked against
Eyjafjallajökull, Pinatubo, Tambora), and since `T₀` and `b` each vary by
~2× within a VEI the reach is log-normal (σ 0.5). An eruption counts at a
point as `P(reach ≥ d) = 1 − Φ(ln(d/R)/σ)` — the chance it drops ≥ 1 mm
there — stamped to `R·e^{1.25}` (0.6%). A frame is therefore "eruptions of
VEI n per year depositing ≥ 1 mm of ash at the point", a quantity with a
threshold and a unit. The next real step is an ERA5 wind climatology per
volcano to stretch the kernel downwind; not faked here.

**The uniform 100 km kernel was an over-correction.** "A pile of radii" was
a symptom of drawing every size on ONE map; on a per-VEI frame every
eruption shares a size, so the reach being the eruption's own is exactly
right, and the collective sums smooth survival curves rather than nested
rings. Measured on the windowed frames: 19 deg² at VEI 1, 526 at VEI 2,
3,997 at VEI 3, 7,194 at VEI 5, 13,258 at VEI 6, 50,894 at VEI 7 — the
extent IS the magnitude. Sydney is reached only by a VEI 7 tail at 1 in
171,841 years.

**Two lessons from the measuring.** A slice-replace between two anchors took
`quadtree` and `write_grid` with it — restored from `git show HEAD:`; when
replacing a span, list what the span contains. And **a project restores the
layers it registered**: a holocene collective from an earlier session was
back on the globe at load, armed its own bar, and the plot I read under the
windowed row was the OTHER record's — counts matched the holocene bake
exactly while the collective was the windowed one. Remove stale layers
before measuring, and read the plot by its record, not by "the first one".

Verified live on 8125 (stamp b06fbec), stale layer removed: the windowed
collective (8,829 cells) parks the bar on All; eight step-backs fetch
`vei8`…`vei1` from the bucket with the windowed bake's own counts (0 /
35,366 / 27,906 / 27,891 / 14,686 / 15,212 / 5,467 / 300), each key
"Ashfall ≥ 1 mm from VEI n eruptions — per year" on the shared classes.

### "The occurrences at Etna are 1 in 1,000 years" — the denominator was the wrong record

Two things behind it, and only one was a fault.

**The fault: the full-record map divided every volcano by its own record
span.** Etna's tephra record reaches back to 6190 BCE, so its four modern
VEI 3 episodes over 8,000 years read "1 in 1,733 years" on a 2° cell — for a
volcano that does it every twenty. A denominator is the record that supports
it. The full-record map now decides per volcano AND size: where the modern
completeness window holds eruptions of that size at that volcano, the window
(complete for them) is used; only a volcano with none in the window falls
back to its own span. So the full record can only ADD a dormant volcano's
ancient eruptions and never dilute an active one's modern rate. Measured
after: Etna summit any 1 in 10, VEI 3 1 in 19 on both records, and the full
record still adds Etna's Holocene VEI 5 at 1 in 726.

**Not a fault: an eruption in the catalogue is an EPISODE.** GVP files Etna
1971–1993 as one eruption, so Etna is 22 eruptions since 1950 and the
windowed collective at the summit reads 1 in 10 years — episodes per year,
not paroxysms. The card says so now, because a reader who knows Etna will
otherwise read the number as wrong.

**Read the plot by its record, not "the first plot".** The holocene numbers
under the windowed row in the previous session were a stale holocene layer
restored from the open project, armed with its own bar. Remove stale layers
before measuring.

### "Why are there grey areas (VEI 3)? Ensure the total map has no gaps"

Two faults, and a third found while fixing them.

- **The grey was ROUNDING.** A far tail at 3e-8 a year rounded to six
  decimals is 0.000000 — no class, so the app's not-measured grey. Rates and
  chances are written to four SIGNIFICANT figures now; a figure a cell was
  drawn for must survive into the file. Measured on the VEI 3 frame after:
  10,820 cells in the bottom class that had been grey, and 0 grey vertices.
- **A cell nothing reaches is DRAWN, as a class.** Left out, ocean and far
  interiors showed basemap through a hazard map, which reads as a gap. The
  cyclone map's own rule: "no eruption's ash on record" leads every key with
  its count, in its own slate (`NONE_COLOUR`, never the app's grey, which
  means not measured). The collective is painted by the same `framePaint`
  as the frames once the bar opens and keeps it after; the card titles such
  a cell "No eruption's ash on record here". Every file, VEI 8's blank globe
  included, now sums to exactly 1.0000 of the lat/lon plane.
- **And the grid ran past the south pole.** 180 is not a multiple of the 8°
  coarsest block, so the last row of blocks reached −94°: the cells summed
  to 1.022 of the plane, and the cyclone bake shares the block size (check
  it). Clipping the block to the lattice with ONE size for both axes then
  halved the last row's columns (0.9889): rows and columns are clipped
  separately. **A coverage sum is the test for a tiling — 1.022 and 0.9889
  each named their own bug.** Empty blocks are also flat whatever their
  largest-VEI class now, which took the VEI 8 file from 9,822 cells to 1,035.

Verified live (stamp d6a403c): the windowed collective 13,257 cells,
coverage 1.0000, none row leading with 4,428; the VEI 3 frame 30,342 cells,
coverage 1.0000, 0 grey vertices, counts `[15130, 10837, 308, …]` summing to
the cells.

### "Ensure the no-record grids are invisible" — a class in the key, nothing on the map

The none cells had been PAINTED, in their own slate, so the globe read as a
dark slab under the reach islands. They are still in the layer — a click on
open ocean answers "No eruption's ash on record here", and the key leads
with their count — and they are drawn nowhere.

**`colourFor` returning `"transparent"` skips a feature in the renderer
entirely** — no fill, no seal, no line, no dot — where `null` is the no-value
grey. Two different statements: grey is "not measured", transparent is
"nothing here, and it is known". It works through `repaint` too, because
`repaintVector` re-runs `renderFeatureCollection`. Measured on the windowed
collective: fill vertices 232,614 → 175,236 with the 4,428 none cells
skipped, 0 dark vertices, the key unchanged. The none row's label says "not
drawn" so a swatch with nothing on the map beside it is not read as missing.

Worth knowing: at the bottom class the collective is green over most of the
globe, because a VEI 7 kernel is stamped to R·e^{1.25} ≈ 6,300 km at a chance
of 0.6% — one in a million years, honestly. A cell nothing reaches at all is
the transparent one.
## Seismic hazards: the same tab, the same driver, magnitude in place of VEI

Hazards ▸ Seismic hazards is the volcanic subtab's shape: Live's own
past-week USGS row as a proxy, then two catalogue rows. **The record** is
USGS ComCat through the FDSN event service — every M ≥ 5 since 1900, 107,239
events fetched a year at a time (`bake-seismic.py`, 96 s; the service caps a
page at 20,000 and the busiest year is under 3,000) — as one point file
played a year at a time through the bar (`seismic-timelapse.js`, the cyclone
tracks' arrangement: a year's events and nothing else, the whole catalogue
as the terminal All frame, a decade tick, the span docked under the row).
**The risk map** is four quadtree grids, M5/M6/M7/M8+, plus the collective:
each event counts at a point as the chance its damaging radius reaches that
far — `log₁₀(R km) = 0.5 M − 1.7` for about MMI VI in the global average
(20 km at M5, 630 at M8), log-normal about it (σ 0.4) — over the years each
size is recorded globally (M5 since 1964, M6 since 1930, M7–8 since 1900).

**`risk-frames.js` is the driver now, and a hazard is a SPEC.** The volcanic
frames driver was generalised rather than copied: a spec names where the
grids live, the layer's name, the frames (one grid each), the scale, the
words for a frame and the status line; `volcanic-risk-frames.js` registers
the two volcanic records and `seismic-risk.js` the seismic one. "Built the
same way" is a mechanism, so the one-key rule, the fetch-on-demand, the
transparent none class and the note write-back cannot drift between hazards.

**A stamped import and a bare one are two modules, so a registry is global.**
The tests import `risk-frames.js` bare; the hazards import it stamped; a spec
registered in one was invisible to the other, and the same file registered
twice under two instances yields two spec OBJECTS — compare by field, never
by identity. The registry lives on `globalThis`.

**`global-data.js` must not import anything that imports the player.** The
popup test stubs `window` bare, and `feature-popup → volcanic-zone-card →
volcanic-hazards → global-data → seismic-risk → risk-frames →
timelapse-player` threw at load on `window.addEventListener`. The catalogue
paint lives in the pure `seismic-bands.js`; a chain like that is found by
walking the static imports, not by reading the stack.

**The largest-magnitude class must not gate the quadtree.** Gated, it split
every block along every magnitude-unit boundary: 108,000 cells and 30 MB for
the collective. Ungated (the max is a fact for the card), 73,437 cells and
20 MB, and the frames 7–22 MB.

Verified live on 8125 (stamp 33e673c): the record 107,239 points in 13 s
from the bucket, key `[92055, 13469, 1607, 108]`, bar on All, 2025 reading
"2,129 / 107,239 · largest M 8.8"; the risk map 73,437 cells in 5.8 s, key
summing to the cells, M 8+ and M 7 frames fetched on demand with the
subduction margins in the top classes, and a click near Tokyo on the M 7
frame reading "1 in 1,714 years · largest on record M 8.8 · 3 earthquakes
within reach" on a 2° cell.
## WorldPop as a layer: the file is a COUNT, read from an overview

Hazards ▸ Exposure ▸ "Population density (WorldPop 2020, 1 km)" is the 809 MB
global count grid as a Cloud-Optimised GeoTIFF in the bucket
(`bake-worldpop.py`: gdalwarp to COG with `GDAL_CACHEMAX 512`, and the
`meta.json` grid/bounds/nodata REWRITTEN from gdalinfo rather than typed),
read through the vendored geotiff.js like the soil-thickness sheet.

- **Read from an OVERVIEW, never the base.** `readRasters` over the world at
  level 0 asked for 3.2 GB of Float32 and threw "Array buffer allocation
  failed". `levelFor(spanPx, needPx)` picks the overview whose span covers
  what the view can show; the sheet is 4.3 s cold, 1 s warm.
- **The file is people PER CELL, not per km².** A 1 km cell at 60°N is half
  a km²; `sampleAt` converts count → density with `cellAreaKm2` per row, and
  the build does the same per row before the log-decade classes. Tokyo reads
  15,150/km², a London cell 1,193.
- **Nodata is −3.4e38 as a FLOAT**, and `v === noData` is false after the
  float32 round trip. `isNoData` tests `!finite || v <= -1e30 || v === noData
  || v < 0`.
- The `.tif` carries `hotlink-ok` in its name (Cloudflare 403s an image by
  Referer), and `publish-data.py`'s NESTED_FILES lists it for its fingerprint.
- The click goes through the sheet-click chain in `feature-popup.js`
  (`GeoIDWorldPop.probeAt` beside the thickness sheet's), answering from the
  file at full resolution rather than from the drawn overview.
## Forecast landslide risk: a query pipeline, and the click it had to win

Hazards ▸ Landslides ▸ "Forecast landslide risk" (`landslide-pipeline.js`,
host `#landslide-pipeline`) is six cards read top to bottom, each unlocked by
the one above — area, rainfall, ground, hydrogeological model, run — and it
is deliberately a FLOWCHART rather than one button: every step's answer is
printed on its card so the reader can see what the next step is being fed.

- **Extent** through `extent-picker` (drawn, or any loaded layer by name).
- **Rainfall** by extent AND date: Open-Meteo GFS forecast (hourly, N days)
  or the ERA5 archive by start/end, sampled on a lattice of points over the
  box (`archiveUrl` is pure and pinned). Storm Desmond over the Mournes,
  2015-12-01..15: 360 hourly steps, 106–107 mm.
- **Ground**: the DEM is ENSURED at the level the box deserves
  (`GeoIDDem.ensure` then `heightAt`, 82 m cells at zoom 14 over a 16 km
  box); the material comes from whichever geological or soil map is on the
  globe (`featuresIn` over the box, then `samplerOver`); depth from the
  thickness model where it answers, else the lithology's default.
- **The hydrogeological model is a bucket per cell from the ROCK-PROPERTIES
  database**: capacity `n·z`, drainage per day `K·86400·sinβ/(n·z)` clamped
  0.02–0.95, with n and K overridable. **The database's porosity is a
  PERCENT** (felsic rock = 1) — read as a fraction it gave every cell a 1%
  bucket; `/100` at read, clamped 0.02–0.6.
- **Run**: `runSteps` wets each bucket through the hourly rain, `fos.js`
  infinite slope per step, a raster layer per step through `buildRasterLayer`,
  played through the ONE player (`startPlayer`, parked on the WORST step —
  Desmond: 2015-12-05T11:00, lowest FoS 0.83 on a 38.8° felsic slope).

**The click had to be claimed TWICE, and the second place is the one that
mattered.** A risk cell sits over the geology it was built from, and the
geology answers first: in `feature-popup.js` the vector hits run before the
sheets, so `GeoIDLandslidePipeline.probeAt` moved ahead of `geologyHit` —
and the card STILL opened as "SEDIMENTARY — CONTINENTAL / Paleozoic
sedimentary rocks", because the tiled world geology's click is answered by
`earth-viewer.js`'s OWN handler (`getGeologyFeatureAtPoint` → `openGeoPopup`)
before feature-popup ever runs. That handler now asks the pipeline first
through `surfaceLatLonAt`; `probeAt` answers true only while its sheet is
visible and the point is inside its grid. Verified by a REAL click at 25 km:
"FORECAST LANDSLIDE RISK / 0.83 — failure / slope 38.8° / felsic-rock → c′ 8
kPa, φ′ 30° / depth 2 m / bucket 40 mm, 14% a day". Fifth instance in this
file of "the button you are pressing is not the code you changed".

**Two slopes on one card, and both are honest once labelled.** The ground
profile appended under every geology-style card reads the viewer's
`estimateSurfaceSlopeDegrees`, a central difference over a 0.08° stencil —
about 18 km — so it read 0.6° under the pipeline's 38.8° at the same point.
It was labelled "Streamed DEM, Horn 3x3"; it says "regional gradient, not the
hillside" now.

**`global-data.js` must not import anything that imports the player**, and
the pipeline's import chain was checked for it: `feature-popup.test.mjs`
stubs a bare `window`, and `timelapse-player` throws at load on it.
## Forecast landslide risk is a static hydrogeological model under GFS maps

Hazards ▸ Landslides ▸ Forecast landslide risk (`landslide-pipeline.js`, the
physics in `slope-hydrology.js`, the rain in `gfs-rain.js`, MFD routing in
`hydrology.js`). **The first build of this pipeline could not produce a
landslide**: over the 14–18 May 2023 Emilia-Romagna storm (hundreds of mm,
over a thousand landslides) it found **0 of 30,810 cells failing at every one
of 120 steps**, wetness never above 0.43. It was a bucket per cell — no
upslope, so a hollow and the nose beside it filled alike — fed ERA5 (not GFS)
from 36 points that collapsed onto 14 model nodes, with material from a
keyword table and 149 m cells.

It is now the SHALSTAB/SINMAP static model (Montgomery & Dietrich 1994; Pack
et al. 1998), built once from the ground and run once per rainfall map:
recharge r = min(P/Δt, Ks), routed by multiple flow directions (Quinn 1991,
Freeman p = 1.1) over the area plus an upslope margin; a steady Darcy water
table h = q/(b·F·Ks·sin β) on bedrock; the water above the failure plane;
infinite-slope FoS; and per cell the RAINFALL TO FAIL, which needs no forecast.

- **One GFS door for every window.** Open-Meteo's historical-forecast endpoint
  answers from 2016 to today + 15 — past dates are the first hours of
  successive runs stitched, future dates the latest run — so a past storm, the
  week ahead, and a window straddling today are one request. Real GFS begins
  late March 2021 (January 2021 comes back all nulls). `models=gfs_global` is
  the T1534 grid, 0.1171875° (~13 km); `gfs025` answers zeros in the archive.
- **A rainfall map is the model's grid, not a scatter.** Open-Meteo snaps each
  coordinate to the nearest node, so the request lattice is at HALF the node
  spacing (at the spacing two neighbours snap to one node and leave a hole),
  de-duplicated to nodes and interpolated bilinearly. Each map is the rain
  summed over a window (24 h default), because the model is a steady state.
- **Material: never the database's intact rock.** A soil-state deposit the map
  names, else the FAO map's topsoil texture, else the database's REGOLITH.
  GLiM's "Unconsolidated Sediments" resolves to nothing in the database and
  would take the no-information prior — φ′ 40°, c′ 8 MPa — so it reads as
  alluvium.
- **LATERAL FLOW IS NOT THE MATRIX, and this is the fault that decided it.**
  With Cosby's pedotransfer Ks used for lateral flow, every map from 9 mm to
  228 mm read as fully saturated (mean h/z 1.00) and the failing set never
  moved: a 2 m loam at 3.5e-6 m/s saturates at about 1 mm a day on any slope.
  Hillslope soils drain through macropores one to two orders faster than the
  matrix; T = F·Ks·z_s with F a control, default 30 — a typical loam at the low
  end of Montgomery & Dietrich's 17–65 m²/day. The soil map's field Ks now
  outranks the database's intact value for a mapped clay (1e-11 m/s, which the
  database's own note says a weathered clay exceeds by orders).
- **Slope at the DEM's posts, not the model's grid.** Thinned to 120 m the
  median slope was 12.8° and nothing reached 35°, while a saturated sand fails
  at 19° and the clays at 22°. Horn at the 27 m posts at four points a
  quarter-cell from each centre, averaged in tan β (one stencil read as
  speckle): median 14.7°, 99th percentile 31°, max 44°. Routing stays coarse.
- **`featuresIn` borrows; the pipeline gives back** in a `finally` — measured,
  the world geology holds its 9,104 features after a ground read.
- **Test harness trap, again:** the tests load the database into the BARE
  `rock-properties.js` while the pipeline reads a STAMPED instance with none —
  `stateOf(text, resolve)` takes the resolver so a test can hand its own.
- **A card that carries its own ground declines the shared profile**
  (`profile: false`): the ground profile appended an 18 km regional slope of
  2.0° under the model's own 15.6°.

- **Every cell is modelled — no slope threshold, no "bare rock".** The first
  answer to the channel gaps was a slate "flat ground" class; the second, on
  request, is to model them: the infinite-slope FoS grows without bound as
  β → 0, which is a true statement that the ground cannot slide, so it is
  CAPPED at 100 and reads as "stable" rather than leaving a hole. And
  Pelletier's 0 m is not bare rock — the grid is whole metres, so 0 is soil
  under a metre, exactly the thin colluvium shallow slides start in; it is a
  0.5 m veneer and the card says so. `fos.js` (GeoID mode) still has its 5°
  floor.
- **The straight-edged bands are the SOIL MAP, not the model.** At the peak,
  FAO "sand" topsoil fails at 25%, silt 5.8%, the mapped clay deposit 0.3%: the
  database gives sand c′ = 0, so it fails saturated above ~19°, and the edge of
  the red is a 1:5,000,000 polygon outline. Root cohesion is the control that
  moves it.

- **Two rainfall sources, one date range.** The rainfall step takes Auto
  (Earth Engine for every day it holds, GFS after), GFS alone, or an Earth
  Engine archive alone. Every map is a SUM OF PIECES — GFS hour ranges or
  Earth Engine days — so a window can straddle the handover, and a map that
  does is marked "mixed". Earth Engine is daily, so a series with any Earth
  Engine day in it is one map a day; Auto with none stays hourly GFS.
- **The GEE service renders pictures, so rainfall comes back through the
  palette.** Each day is one billed render through the service's own CHIRPS
  entry (0–300 mm, four stops) and is inverted with `gee-sample.js`'s own ramp
  — one colour at a time, since a CHIRPS render over a study area is tens of
  distinct pixels scaled up (14 colours over 1024 × 805 measured). Cached per
  dataset, box and day. The thumbnails answer CORS for the page's origin.
- **Only CHIRPS renders on the DEPLOYED service.** IMERG V07, ERA5-Land,
  GSMaP all answer "Unknown or unsupported dataset"; entries for IMERG and
  ERA5-Land (with a `multiply` into mm) are in services/gee-tiles for when it
  is redeployed, which is the user's to do (billed). CHIRPS runs ~6 weeks
  behind (last 2026-07-31 on 2026-09-11) and stops at 50° of latitude — Auto
  hands those areas to GFS, a named archive refuses.
- **CHIRPS badly under-reads the May 2023 Emilia-Romagna storm**: its wettest
  day over the study box is 24 mm where GFS had 228 mm in 24 h and gauges
  recorded 200–300 mm, and the model peaks at 295 failing cells against 3,742
  under GFS — on the right day, at a tenth the size. CHIRPS is infrared plus
  station blending and is known to miss mid-latitude orographic extremes; the
  highest resolution is not the most faithful here, and the status line shows
  the wettest day so a reader can see it.

Measured over the storm (32 × 28 km, 51,926 modelled cells, 7 s to read the
ground, 1.5 s for 20 maps): **15 failing in the lull on 15 May, 3,742 at the
17 May 06:00 peak (228 mm in 24 h), 14 after it**, the failures tracing the
valley sides and drainage heads; a dry July week on the same ground never
exceeds 29. No memory between maps beyond the window — that is what "a series
of static models" means, and the 48/72 h windows are the antecedent control.

### Mapped at the DEM's posts, informed at each dataset's own resolution

"If there's a dataset at 10 m and one at 30 m, use the 30 m one to inform the
model but map at 10 m." The first build mapped at whatever a 90,000-cell budget
allowed — 120 m over the storm box — so the finest dataset was thrown away
before the model saw it. Now:

- **The grid step IS the DEM's post spacing** (`demGridFor(..., { minStepM:
  post })`, `post = metresPerPixel(zoom)` of the level `ensure` loaded) up to a
  2M-cell budget, and only coarsened past it — which the Ground card says. Over
  the storm box that is 27 m, about native SRTM in Italy; finer zooms would be
  the publisher's own resampling (`dem-tiles`' z14 cap), and the 256-tile cover
  caps the zoom for large areas. When the grid IS native, slope is Horn on the
  grid itself; the four-stencil read survives only for a coarsened grid.
- **Material, thickness and rain sit on an INFORMING LATTICE** of
  `INFORM_M = 100 m` blocks (`cells.block[i]` → `cells.props`), finer than any
  of those sources resolves (geology 1:1M, soil 1:5M, thickness 1 km, rain
  5–13 km) and ~16× fewer point-in-polygon tests. `staticStep` reads
  `P = cells.props || cells` through `j = B ? B[i] : i`, so the old per-cell
  shape still runs and the tests pin the two equal.
- **Performance, because 2M cells found every O(n log n) with a constant in
  it.** `fillSinks` is a typed-array binary heap (the class-based MinHeap was
  the whole ground read); `mfdTopology` keeps receivers in compressed rows
  (`offsets`/`recv`/`frac`) instead of an array per cell; `routeFlux` can route
  in place; `staticStep` reuses its scratch buffers across the series. Over the
  storm box at 27 m: 1,175,328 cells (1,736,316 with the margin), ground 10 s,
  20 maps 12 s, one map drawn in 0.6 s, the pipeline's retained arrays 148 MB
  (`performance.memory` reads ~1.85 GB and is not a measure of anything).

GFS peak at 27 m: **82,279 failing** where 120 m found 3,742 — the difference
is slope, which the coarse grid flattened below the failure angle almost
everywhere.

### Auto walks the Earth Engine archives in order, then GFS

`planRain` takes an ORDERED list (`AUTO_GEE_ORDER = ["chirps", "imerg"]`):
each day goes to the first archive that holds it, and GFS takes the rest. A
series with any Earth Engine day in it is daily; one with none stays hourly
GFS. The status names every archive passed over and why (`CHIRPS holds … to
2026-07-31; IMERG: the deployed Earth Engine service does not render IMERG
yet …`) — a silent fallback to GFS for the recent past would read as
satellite rainfall that is not.

**The "7 days before / 7 after" demo is GFS on both sides until the service is
redeployed.** Run on 2026-09-11 for 4–18 Sep over the storm box (1,175,328
cells, 24 h every 6 h, 60 maps): CHIRPS ends 2026-07-31, and IMERG (to
2026-09-10), GSMaP and ERA5-Land are in `services/gee-tiles` but not deployed.
Worst map 2026-09-11 00:00: 10,823 failing under 30 mm/24 h; 458 on the dry
days; 7,036 at 10 Sep 12:00 (26 mm); 1,153 by 18 Sep. After the (user-gated,
billed) redeploy the same Auto fetch uses IMERG for 4–10 Sep with no code
change.

### Sampling stations: the same answer as the map, without re-routing the map

Step 7 of the pipeline records every rainfall map's static model at named
points: clicked on the globe (armed until Escape), the study centre, the five
weakest cells over the window (kept ≥300 m apart and clear of stations
already placed, so asking twice gives the next five), every point of a loaded
point layer, or a CSV (`name,lat,lon`, any delimiter). Plotted per parameter
(FoS, m, h/z_s, water table, rain, recharge, flux) with the bar's frame
marked; a click on the plot moves the bar (`seekPlayer`, new in
`timelapse-player`, so bar and plot cannot disagree); one tidy CSV out.

- **Routing is linear in the source**, so a station's flux is
  Σ w_u · r_u · A over its own catchment, with w_u the fraction of cell u's
  water reaching it. `upslopeWeights` walks the topology's `order` backwards
  (receivers are strictly lower, so always met first) once per station and
  keeps it on the ground object; a station added after a run then reads all
  28 maps in milliseconds instead of re-routing 1.7M cells per map.
  **It must equal `staticStep`**, and the test holds it there on a
  block-lattice V-valley with varying rain and material: flux to 1e-9, FoS to
  1e-6. Live: every station equal to the map cell under it to ~1e-8 (the map
  stores Float32). `cellAnswer` moved into `slope-hydrology.js` so the map and
  the stations call one function.
- **Model-agnostic series** (`station-series.js`): stations, a series shape,
  the tidy CSV (row per station per time, a column per parameter with its
  unit, the station's ground repeated so the file stands alone, an unread
  station kept with its note). `geoid-gis:station-series` is dispatched on
  every recording and `GeoIDLandslidePipeline.series()` returns it — the seam
  the myGeoID analysis hub is meant to read. `time-series-plot.js` is a date
  axis (`timeTicks` lands on midnights / six-hourly marks) with FoS clipped at
  3, a value above drawn on the top edge rather than flattening the plot.
- **A canvas in an `auto` grid column sizes the column, which sizes the
  canvas**: every redraw set its width attribute from its CSS box and the box
  grew to it, so the plot ran out of the sidebar. `minmax(0, 1fr)` again —
  fourth time this file has paid for it.
- **The larger plot is moved onto `document.body`** (a transformed or
  filtered sidebar ancestor makes `position: fixed` relative to it) and placed
  from the time-lapse bar's MEASURED top — including its date pill, which
  stands above the bar's own edge; a fixed `bottom` landed 36 px on the bar at
  a shorter window. Children with no layout report a top of 0 and are skipped.
- Playing the bar updates only the readings (`updateReadings`), never the name
  fields, so a rename survives playback. A placing click is swallowed by
  `probeAt` for 800 ms and the popup suppressed, so it opens no card.

**"The rainfall isn't being fetched" was a dry forecast.** Checked against the
raw API at the node over Imola: the historical-forecast and live forecast
endpoints agree hour for hour (28.2 mm 10 Sep, 5.9, 1.5, then 0.0 for 13–16
Sep, 7.8 on the 17th), Open-Meteo's best-match blend is drier still, and the
page's 24 h windows reproduce the raw sums exactly (28.2, 12.5, 7.2, 4.7, 0.2
… 0.9). With no ground maps on the globe the material falls to the database's
regolith (c′ 20 kPa), and at 72 m nothing fails in that week at all — which
reads as broken and is not.

**The rainfall opens on 7 days either side of today, on Auto**, and every map
says which it is: `periodOf(time)` — "record" once its window has ended,
"forecast" if it reaches past now — on the bar's date pill, the note's title,
a shaded "record | forecast" split at now on the station plot, and `period`
and `source` columns in the station CSV. The record half is Earth Engine only
where the DEPLOYED service renders a day: re-probed on 2026-09-11, IMERG,
GSMaP and ERA5-Land still answer "Unknown or unsupported dataset" and CHIRPS
ends 2026-07-31, so 4–11 Sep is GFS's own record until `services/gee-tiles`
is redeployed (user-gated, billed); then Auto takes IMERG with no code change.

**The rainfall maps are a layer of their own**, put in the Workspace the
moment they are fetched: "Rainfall maps — landslide forecast (mm)", 55%
opacity, dry ground (< 0.5 mm) not drawn, on a ~1 km display lattice over the
fetched cover (study area + upslope margin). Before a run the bar plays the
rain alone, parked on the wettest map; after a run the layer steps with the
model's frames (`paintRain` in `showStep`). The model's blocks and the display
lattice read the rain through ONE function, `rainAtPoints(frame, pts)`, which
caches its GFS interpolation weights and Earth Engine pixel tables on the
points per fetch — so what is drawn is what the model is fed. A new fetch, a
new area and a full clear take the old maps off.

**Station labels wear their dot's colour.** `point-labels`' `legendColour`
matched on `legend.values`, which a legend built from a DECLARED style does not
carry (only `labels`), so every station's chip and leader fell back to the
volcanic theme's red. A categorical legend without `values` now matches on its
labels, and a feature may name its own `label_colour` (hex only), which
outranks the legend.

### Stations are ▼ markers, every term is recorded, and plots are panels

**The markers are a DOM overlay, not the label engine** (`station-markers.js`):
an outlined ▼ in the station's colour pointing at its ground with the name
centred above — the Mars flight sim's horizon tags, with no leader. Projected
each frame through `GeoID-ImportedGeoLayers` (it carries the spin), culled at
the horizon by the tangent-plane test (`GeoIDProjectLatLon` does not cull the
far side), names that would overlap muted, the ▼ kept. Measured: tips within
~1 px of the viewer's own projection. **z-index 5** — over the canvas and
under every panel (sidebar 10, Workspace 11, corner furniture 13); at 12 a
station behind the sidebar was drawn on top of it. A click opens the station
card (every variable at the map in view, the lowest FoS and when).

**The stations' layer is BUILT WITHOUT GEOMETRY** and handed its real points
afterwards (`layer.collection`/`features`) for the table and export, with
`groundPick = false`. Hiding its dots after the build lost to the first
repaint, which replaces every child — measured, two point objects back on the
globe after they had been hidden.

**Every term of the model is recorded at a station**, because a factor of
safety that moves says nothing about why until the terms under it are
plotted: rain at the cell, rain over its catchment (flow-weighted mean — what
the water table is fed), recharge, flow per metre of contour, saturation h/z_s,
water-table height and depth, water on the plane m, pore pressure, effective
normal stress, shear strength, driving stress. `slopeStresses` in
`slope-hydrology.js` is the one computation of those terms and
`factorOfSafety` is its ratio, so the map and the station cannot disagree;
test: strength/stress = FoS, pore + effective = γ·z_f·cos²β.

**Plots are interchangeable panels**: two by default (FoS, rain), up to six,
each switching between every variable (grouped) or strength against driving
stress (solid/dashed, one pair per station); ⧉ pops one out over the map
(moved onto `document.body`, z-index 20 — under the cards at 22 — dragged by a
grip, its frame or its readout, never by the select or the plot, which a click
on seeks the bar); ⇲ docks it. Hover and the frame marker are shared.
**A panel head that is all select cannot be dragged by** — measured, a real
drag on it moved nothing; the grip is what makes it holdable.

### Rainfall at the finest step each source has, unless a coarser one is asked

`rain-steps.js` plans a series from UNITS, one per step, each source read at
its own native step (GFS 1 h, CHIRPS 1 day, IMERG 30 min, GSMaP 1 h, the
service's ERA5-Land entry 1 day) — never finer, and coarser only where the
reader picks a step (30 min … 1 week, 1 month, 1 year; calendar-aligned). A
unit is split into PARTS where the source changes inside it (a month in which
CHIRPS runs out). A map sums the whole units covering its window, so near a
change of source a window can run up to one step long — each map carries its
exact `from`/`time`/`hours`, and **the model converts each map's rain over
its own window** (`windowH: frames[k].hours`), not one global number.
Default is now 360 hourly maps for 7 days either side, where it was 60
six-hourly ones; the old "every 6 h" was only a sampling default.

- **An Earth Engine part is one composite render** over its exact window —
  the service sums (`reducer: "sum"`) any `from`/`to` Date.parse accepts, full
  ISO instants included (verified live: three CHIRPS days as three renders).
  So a day, a month and a year each cost one render; half-hourly IMERG for a
  week costs ~380.
- **Billed renders are counted before they are spent**: past
  `RENDER_BUDGET = 60` the card states the count and the per-source steps and
  fetches on a second press (the button says "Fetch — spend N renders").
- **A long composite runs off a 300 mm ramp.** The service now takes a `max`
  for summed mm composites (`rampMaxFor`: 300 a day … 10,000 a year) and
  returns it in the legend it decodes against; **not deployed yet**, so the
  deployed service ignores it — the reader counts pixels at the ramp's top
  (`capped`) and the status says they read as 300 mm.
- A span too long for its step (thirty years half-hourly) is refused rather
  than hanging the planner.



Hazards-style brief, answered in the GIS page's Model Builder tab: draw the
study area, sample the DEM into a surface at a resolution that VARIES by
place, embed points at the surface's own interpolated heights, package the
surface with subsurface and atmosphere volumes, and hand the same surface to
the model page as a solid.

**`surface-sampling.js` is the pure half**, tested against a plane and the
closed-surface invariant (66 checks). Step 3 ▸ Sampling offers *Uniform* (the
old grid) or *Variable*: a base step everywhere, and inside BUFFERS the reader
draws — a square (side) or a circle (diameter) about a point, picked on the
globe or added at the study centre — the DEM's native step or a coarser one,
GRADED linearly back to the base over a distance. Layers given the refine role
join as square buffers over their bounding box. The finest buffer wins where
they overlap; a buffer coarser than the base cannot coarsen it.

- **The lattice is a QUADTREE, and its root is the COARSEST spacing.** A cell
  splits until it is no larger than the spacing at its centre; the leaves'
  corners are the nodes. Sized by the spacing at the box centre the root was
  7 m everywhere — the centre is exactly where a reader puts a fine buffer —
  and nothing was left to split: measured, 0 levels and one spacing class.
  The root is sized by the maximum over a 9 × 9 sample.
- **The budget COARSENS everything together, never truncates.** Past the node
  budget the spacing is scaled by √(nodes/budget) and the lattice rebuilt; the
  status says by how much (×1.71 on the Mournes with a 1.5 km native square).
- **Delaunay in the local frame, heights at each node's own lat/lon, a
  neighbour-median despike** (the grid's 80°-wall rule on the TIN), and the
  rim as ONE counter-clockwise loop from the edges used once. The shells —
  ground, skirt walls along the rim, a fan lid at the base or the sky — come
  from one `shellFacets` generator that both the STL writer and the studio's
  display read, so the shell meshed is the shell looked at.
- **The size field over a TIN** is the slope-graded field on a lattice laid
  over it, taken to the MINIMUM with the sampling spacing: a buffer drawn fine
  stays fine in the volume, and a steep slope is refined whether or not it is
  in one. Pinned: no cell of the field is coarser than the sampling there.

**Everything the builder decides is DRAWN on the globe as it is decided**:
the buffers (outlines by resolution), the sampling as every triangle edge
coloured by its spacing class with a legend (7 classes on the Mournes, 7 m to
477 m), the embedded points, and the extended boundary. `loadedLayers()`
must EXCLUDE the builder's own previews — the points preview is a point layer,
took the "points" role by default, and fed itself back: one placed point
embedded three times, twice from its own picture.

**Extend the boundary is etna's `outer_box` as a DECISION.** Step 4 takes a
depth below the lowest ground and, if asked, a height above the highest; the
rim's four corners are carried to those levels (`extendBoundary`), previewed as
an x-ray box through the ground at TRUE vertical scale (the globe's relief is
exaggerated, the box is not, and the status says so), and both shells are
written watertight (95,458 triangles each on the Mournes). Every gmsh script
carries etna's `outer_box(z_bd, h)` verbatim in its recipe under
`USE_OUTER_BOX = False`, with the measured reason it is off (a plane through a
rim that spans 593 m in z fails) and the baked skirt as the default; the
atmosphere gets its own script with the sides at 6 and the volume at 11.

**The default element size is twice the COARSE spacing.** Derived from the
finest buffer it was 15 m over a 16 km box — MeshSizeMax caps every element,
and the size FIELD is what brings a buffer down. 953 m now.

**The Meshing Studio adopts the surface as a SOLID** ("Open in the Meshing
Studio", `GeoIDMeshStudio.adoptTerrainSolid`): the subsurface and the
atmosphere as inside-tests against the heightfield, displayed from the same
facets, with a card on the model page to change the depth and height and
rebuild. Two things measured there: **1 unit = 1 METRE** in the studio (its
ground is the planet to scale; handed over in km the terrain sat as a
sixteen-metre model on a 2,000 km grid), with the mesher's cells set from the
surface's coarse spacing on adoption; and **`modelFocus` fitted the view to
EVERY visible layer** — the GIS launch defaults and the previews sit at the
world origin, the anchored terrain at 6,371 km out, so the target landed at
y = 3,187,423 and the camera 8,000 km away looking at nothing. It fits the
studio's own meshes now: 31 km out, 10 km scale bar, 114,240 tets in 501 ms.

Verified end to end on 8125, all through the page's own controls: 16.3 × 16.7
km over the Mournes, a 1.5 km native square and a 3 km 60 m circle on Slieve
Donard, 47,590 nodes / 95,038 triangles at 7.4–477 m over 6 levels, −15 to
849 m; a point placed by a real click at 54.1818°, −5.9434° reading 508.9 m
from the TIN; the package (surface, domain, atmosphere, size field, two
scripts, spec) filed into a browser-storage project; the studio meshing both
volumes and rebuilding at 6 km with no atmosphere from its own card.

### "In the model page we cannot see the surface STL — no distinguishing the domains"

Right, and both halves had one cause: the two shells SHARE the ground
triangles, so the interface was inside their union, and both wore pale
opaque colours — one grey block. Three things now, each measured on the live
page: the rock is opaque earthen (`a8703f`), the air a translucent sky
(`7fc8ff` at 0.22, `depthWrite` off — a translucent volume that writes depth
culls the very ground it is meant to be seen through, drawn last), and the
surface STL itself is drawn once more as a lit green skin (`6fbf73`, 95,038
triangles, polygon-offset so it wins the depth fight with the rock's top).
850 m of relief over 16 km is a 5% ripple, and only shading makes it legible
at true scale. After Mesh 3D the lattice mesher's stair-stepped boundary is
drawn over the solids as it always was; Clear mesh or hide it to see the
surface again.

### "Anything below 0 is clipped by the floor" — the studio's ground is the model's base

The studio's ground is an OPAQUE sphere tangent to z = 0 and the camera is
held above it (`keepCameraAboveGround`, the dolly floor), so nothing under
z = 0 can ever be seen — and a subsurface is all under the ground. Anchored
at sea level, 4 km of rock was clipped away whole. The terrain is SHIFTED on
adoption so its base (the subsurface's lid, else the lowest ground) is z = 0,
the origin is told that elevation so readouts stay true, and the GIS package's
absolute metres are untouched; the log says what z counts from. Measured
after: subsurface 0 to 4,864 m, surface skin 4,000 to 4,864, atmosphere 4,000
to 7,864, the rock standing on the grid in the screenshot.

### The floor was the model page's fault, and the shift was a workaround

"It's a fault of the model page that we cannot navigate below z = 0" — right,
and the base-at-zero shift above was working around it rather than fixing
it; that shift is gone. Three limits held the camera above the ground: the
position clamp (`keepCameraAboveGround`), the dolly floor, and
`maxPolarAngle` at the horizon. `applyBelowGround` now reads the model's own
bounds: where it reaches under z = 0 the floor drops to its base, the orbit
may swing to `π − MIN_POLAR_RAD`, and the ground stops writing depth (drawn
first, as a backdrop) so the rock beneath is painted over it. A model that
sits on the ground keeps every old limit. Re-read on every tree redraw, on
the orbit-limit pass and when the ground is built. Measured: camera parked
4,015 m under the ground on a model whose base is −4,015 m (the floor is the
base), polar range 0.14–3.00 rad, `depthWrite` false on the ground.

**And the GIS page draws the FULL MODEL itself** — "Show the full model on
the globe" in step 4: the surface STL as a lit skin, the subsurface shell to
its base, the atmosphere shell to its lid, through the ground at true
vertical scale with a legend naming each level. From straight above the
three project as one translucent rectangle; the studio's oblique view is
where the volumes read as volumes, and the studio now lets you get there.

### "The gridlines fail the depth test" / "we cannot navigate to the underside"

Two reports on the same ground, and both were the fix before them being
half right. Turning the ground's `depthWrite` off let the rock be seen
through it and drew its lines over anything nearer — the failed depth test.
The ground writes depth again; while the model reaches below it the shader
DISCARDS the fill between the lines (`uOpen`), so the floor is a ruled grid
seen through, with lines that depth-test like anything else, and it has a
HOLE under the model's plan footprint (`uHole`), because a reference plane at
z = 0 otherwise cuts through the subsurface and its lines show inside the
block wherever the wall below the plane is what is in front. Measured: with
the ground opaque and depth-writing, `uOpen` 1 and the hole set, the grid
ends at the block's walls from above.

And a floor AT the base lets the camera reach the underside's plane and no
further. The floor drops below the base by the model's own diagonal when it
reaches under the ground. Verified with a REAL mouse drag (the pane's drag
tool on the canvas): 15,963 m above the ground to **28,607 m below** it in one
gesture, the screenshot showing the base of the subsurface from beneath. The
ground is `FrontSide` only, so from under it there is no grid at all, which
is the honest view of a ruled surface seen from its back.

### "The ground gridlines are very harsh"

They were the skin's chrome and data colours at full strength, 1.2 px wide,
with a bloom under every line. A reference surface should sit UNDER the
model, not compete with it. Now: hairlines (0.7 of `fwidth`), the minor
lines the theme's data colour at 0.34 and the major lines the accent at 0.5
(`themeColour` reads `GeoIDTheme.hex`, so a skin restyles the floor), the
bloom cut from 0.35 to 0.05, and the ruling fades with view distance
(`uFadeM`, twelve coarse steps) so the far field is a tone rather than a
moiré.

**In the see-through mode only each line's CORE survives, painted in its own
colour.** Discarding the fill but keeping the anti-aliased edge and the bloom
left those pixels as base-plus-almost-nothing -- near-black, opaque -- and
wherever the plane passed in front of the rock they painted dark bands across
the walls. Measured on the screenshot before believing the shader.

### "Very laggy as we rotate" — every pointer move of the drag was a raycast

The studio's cursor readout raycast every solid on every `pointermove`, and a
drag is how the view is rotated: with a GIS terrain up that was three meshes
of 95,000 triangles each, no acceleration structure, at pointer rate.
Measured on the live page: **25.8 ms per pointer move** — a slideshow at any
drag speed. The readout now skips any move with a button down (nobody reads a
coordinate under a cursor they are dragging) and answers at most a dozen
times a second: 0.07 ms per move while dragging. The air shell also stopped
drawing its floor, which is the ground the skin already shows — terrain
triangles 286,374 → 190,916.

**And this pane cannot measure frame rate today**: `requestAnimationFrame`
fired at 3–5 Hz in BOTH modes with the main thread idle (a 4 ms interval
ticked 980 times in 3 s, zero long tasks), which is the browser throttling
the pane, not the app. Measure the COST OF THE HANDLER — time a synthetic
event — when the frame rate is not yours to read.

**The grid, minimal at last**: one family of hairlines in a dim slate
(`0x8a97ad` at 0.16, majors at 0.3), no bloom at all, no theme colour split,
fading with distance. "Not any better than before" was fair about the
two-colour theme ruling; a reference grid is furniture, not a subject.

### "Still very laggy" — what the model page was drawing, counted

The pane's own frame rate is throttled to a few frames a second today in
every mode, so the instrument is `renderer.info` after a frame and a timed
`render()` with a `readPixels` sync. Model mode with the terrain up, before:
**8 draw calls, 381,620 triangles, 148,972 lines** — of which the lines were
the GIS page's surface-sampling preview and the other georeferenced layers,
still drawn under a model that cannot show where they are, and the
triangles were the 95,000-triangle TIN drawn three times (rock top, skin,
air floor) DoubleSide. After: **5 calls, 119,296 triangles, 0 lines**, 4.5 ms
a render on this GPU.

- **The studio hides `GeoID-ImportedGeoLayers` while it is up** and puts it
  back as it was on the way out; model mode keeps the import groups because
  the studio's own meshes live in one, so this has to be the studio's own
  rule.
- **What is drawn is a stand-in; what is tested is the surface.** A TIN over
  40,000 triangles is resampled onto a 129 x 129 grid for display (33,000
  triangles a copy); the inside-tests, the mesher and the package read the
  full TIN. `tinToGrid` now carries enough for `gridAsTin` to read it back.
- The air shell draws no floor; the rock keeps its top so a click on the
  terrain still finds the rock.

### The studio is empty space, and the two pages share one frame

"Maybe we should remove the gridlines. Remove the stars background option too.
Check that there's a clear separation between the model space and the GIS
space (same CRS)." All three done and measured:

- **No ground, no stars, no floor.** The Ground and Stars toggles are gone
  from the page; `applyStudioScene` switches both off; with no ground there
  is no camera floor and the orbit may reach `π − MIN_POLAR_RAD`. Model mode
  now draws 4 calls, 70,144 triangles, 0 lines.
- **Separation, both ways.** The studio hides the georeferenced import group
  while it is up (the sampling mesh and the plate boundaries were still being
  drawn under the model), AND its own anchor is shown only with the model
  page — measured before: three `geoid_*` terrain meshes in metres visible in
  GIS mode under a globe of radius 3.2. After: nothing of the studio drawn in
  GIS mode, nothing of the GIS drawn in the studio.
- **One CRS.** The Model Builder's frame is local east/north metres about the
  study centre, equirectangular scaled at the origin's latitude on the body's
  radius, z metres above sea level — the frame every file in the package is
  written in, and `spec.json` now states it in words. The studio's own
  conversion was azimuthal-equidistant about the same origin: exact at the
  centre and **9 m off at 9 km** (measured). Once a terrain is adopted the
  studio reads and writes through the terrain's frame, so both pages compute
  lat/lon from one function: measured after, 0.000 m at three probes.
- **Coming back to a model.** The GIS page scales local models to its globe
  (`userData.baseScale`), so a terrain returned to the studio after a trip to
  GIS was 0.0003 of its size — a 16 km block in a 6 m box, with the view
  centred on nothing. Entering model mode restores the metres and fits the
  view to the solids.

### Coming back to the studio, the camera snapped to 12 m — three writers, found by trapping

A fitted 31 km view read back as 12 m after every GIS-and-back round trip.
Three separate things, each found by trapping the camera's own components
and reading the stack, and each invisible to the one before:

1. **The GIS page scales local models to its globe** (`userData.baseScale`),
   so the terrain came back at 0.00003 of its size. `refreshStudioScale()` on
   entry, and the fit deferred a tick so it runs after the switch.
2. **The globe's pending zoom target eased the camera down**, a few metres a
   frame — no single write large enough to trap. `clearZoomTarget()` on the
   viewer seam, called on entry.
3. **The embedded-frame re-fit** (`applyEmbeddedFrameState` →
   `animateCameraDistance`) fires when the frame changes shape — which a
   mode switch does, by moving the panels — and 600 ms into Model mode it
   flew the camera to 11.5 units from the world origin with the target at
   (0, 0, 0), in ONE step. It returns in Model mode now, and a flight already
   in progress is cancelled with the zoom target. The studio owns its camera.

Measured after: three round trips at 31,487 m each, scale 1, the studio's
anchor shown and the GIS group hidden. **Trap the components with a stack,
filter the vendor's own no-op writes (`OrbitControls.update` copies the
position back onto itself every frame), and arm the trap only after the
state you are defending has landed** — the first trap filled its cap with
those no-ops and named nothing.

### "Still very very laggy" — the lag was the pane, and the numbers that proved it

Measured in three places before believing any of them:

- **The desktop app's browser pane delivers frames in bursts about once a
  second for ANY page.** A plain text file (`shell.css`) in the pane: 2.3 fps,
  gaps of 5 s. The GIS globe: 3.6 fps. The studio with a box: 3.7 fps. A
  real mouse drag on the canvas during a 9 s recording: 3–4 frames per second
  throughout, in bursts. The user's screenshots are of this pane (the chat
  is visible beside them), so what they see as the model page lagging is the
  pane's frame delivery — and it cannot show any WebGL page smoothly.
- **The user's real Chrome** (`claude-in-chrome`, same machine, Intel Xe,
  1920 × 811): the GIS scene renders in **8.1 ms**; the studio with the
  adopted terrain, once its shaders are compiled, in **5.3 ms** (4 draw
  calls, 70,144 triangles), with `controls.update` at 0.35 ms. That is a
  60 fps scene. The first frames after adoption cost 37.5 ms — shader
  compilation and the first upload, not steady state, and a trap for anyone
  timing the first render.
- The translucent atmosphere shell is ~3.8 ms of the 5.3 (DoubleSide
  transparent over most of the screen); the skin ~1.7. Worth halving with
  front-face winding if it ever matters; it does not today.

**Three traps in measuring it.** `requestAnimationFrame` never fires in a
hidden tab (`document.hidden` true — the extension's tab sat behind the
app), so any probe that awaits a frame times out and reads as "the renderer
is frozen". A page can be driven on timers instead, but only for loops that
schedule THROUGH the patched `requestAnimationFrame`; a loop already waiting
on the original one stays waiting. And the Model Builder's own build step
runs inside `requestAnimationFrame`, so in a hidden tab it never builds
unless the seam is patched first.

### The ground came back as a dark lattice, by request

"Maybe we should add in subtle dark grey ground gridlines — dense lattice."
The ground plane is back as LINES ONLY (`uOpen` is always 1: a lattice has
no fill, so what is under the plane shows through it), hairlines in a dark
grey (`#30343c`, majors `#4a4f59`), no bloom, one notch denser (about twenty
cells across the view rather than ten), fading with distance, with the hole
under a buried model kept. A **Grid** toggle on the studio bar switches it
off; Stars stays gone. With the ground back, the camera floor rules return
with it — a floor under the model's base when it reaches below the ground,
the plane itself otherwise. Measured live: step 500 m at the fitted view,
`uOpen` 1, the lattice visible through the atmosphere and ending at the
block's walls.

### The studio's readout read the sky

"The model page elevation reader is definitely broken." It was: the cursor
readout raycast every solid and took the nearest hit, and from above the
nearest hit is the ATMOSPHERE'S LID — a translucent shell is still a mesh to
a raycaster. Measured at three ground points of 279, 508 and 158 m: every
one read **3,849 m**, the sky's height, at the lid's own lat/lon; a point
past the lid read the wall at 2,288. The readout now asks the surface skin
first, skips any translucent solid, takes its height from the FULL TIN
rather than the display stand-in, and prints longitude in degrees east
(0..360) as the globe's readout does — "−6.00°E" was a signed longitude in
an east-positive format. Measured after: 279 / 506 / 158 m, lat/lon to 0.01°.

The lattice is light grey now (`#8e959f`, majors `#c4c9d1`), by request.

### The studio's model is parts: click a face, get its card; tick a row, hide it

"Interact by clicking the domains (pop-up descriptions), toggle the
visibility of each layer, flagged elements, points — the whole model should
be interactive and customisable." Each domain was one undivided mesh. Now:

- **A domain is its FACES.** The rock is a top (the ground, flag 1), a base
  (flag 2) and its sides (flag 5); the air is a sky (flag 4) and its sides
  (flag 6); the surface STL is its own part; every embedded point is a small
  sphere (flag 20). Each face is its own mesh with its own Workspace row, so
  the eye there and the tick in the studio's **Model parts** list are one
  state seen twice (`partVisible` commits through `GeoIDLayerHierarchy.setVisible`).
- **A click asks the parts first** (`partAt`, translucent hits yielding to an
  opaque one beneath), opens a card beside the click — what the part is, its
  physical flag and the condition that names it, its elevation and extent,
  a point's lat/lon, ground, depth and node — and selects the owning domain.
  A row in the list does the same. Escape, ✕ or a click on nothing closes it.
- A domain's `object3D` is now a GROUP: `pickAt` intersects recursively and
  resolves the owner by ancestry, the selection highlight traverses to every
  face material, and delete disposes the children.

Verified live: eight parts listed; a synthetic press-and-release on the
study-centre point opened "Point — centre" (279 m, flag 20); one on the rock's
south wall opened "Subsurface — sides" (flag 5, −4,015 to 849 m); unticking
the sky hid its mesh and the Workspace row read hidden with it.

### "Its execution is poor — should be like the GIS main tab bar"

Two things in one report. The part list was a flat run of rows at the foot
of the Add tab; it is a **Domains panel** now, at the top of the Model tab,
in the sidebar's own idiom — one `gis-tool-section` per domain (Subsurface,
Atmosphere, Surface, Embedded points) with a three-state master tick in its
head (like a Live-events group) and a row per face or point beneath, each a
tick, a swatch, its flag and an ⓘ for the card. The icon painter picks the
sections up on its own. Adopting a terrain brings the Model tab forward.

**And the depth "precedence" was a coplanar pair.** The rock drew its own
copy of the ground's triangles under the surface skin, held apart by polygon
offset, and whichever won the depth test took precedence wherever the offset
lost. The ground is ONE mesh now — the surface STL, the rock's top and the
air's floor, flag 1 on both — and nothing shares its plane. Verified live:
untick the Atmosphere master and both its faces go; untick the rock's base
and the Subsurface master reads indeterminate; the surface, sides and points
draw with no fighting.

### 2D models: surface only, or a cross-section along a line

"We should have an option for 2D or 3D models in the model builder." Step 1
carries a **Model** select: a 3D block (as before), a 2D SURFACE ONLY, or a
2D CROSS-SECTION. Surface-only is the 3D path writing the terrain STL and
nothing under or over it — the depth and atmosphere controls say they are
kept for when the kind changes. The section is `section-model.js`, pure and
tested against a plane (31 checks with the structural pins):

- **The line is A–B on the globe**, picked through `pickPoint` or defaulted
  west–east through the study centre; `profileAlong` samples the DEM at N
  points along it in the SAME local frame as the 3D package (the study
  centre's — `profileAlong` takes the frame and reports its origin, so the
  spec's `crs` names one frame for both kinds). The DEM is clipped to the
  line's box at the finest level first (`ensureBestDem`), the same rule as
  the 3D surface step.
- **The subsurface and the atmosphere are FACES, not volumes**:
  `sectionPolygons` closes the profile down to a flat base and up to a flat
  sky as two CCW rings in (s, z); `sectionPositions` stands them in the
  vertical plane through the line; `sectionGmshScript` is a 2D script —
  the profile as `top` curves and points (flag 1), base 2, sides 5,
  subsurface surface 10, sky 4, sides 6, atmosphere 11, embedded points
  through `isInside(2, …)` and `embed(0, …, 2, …)`, `generate(2)`.
- **The package** is `_section.csv` (s, lat, lon, z), `_section.stl` (both
  faces, for anything that opens an STL), `_section_gmsh.py` and a spec
  with `dim: 2`. On the globe the line is drawn as the section preview and
  the faces as x-ray lines through the ground at true vertical scale, the
  extended boundary's own treatment.
- **The studio adopts it** (`adoptSectionModel`): the rock face brown, the
  air face translucent, the profile a green ribbon, points as spheres —
  the same parts, cards and Domains panel as the 3D terrain. A face has no
  inside, so each domain's solid here is a slab one sample step thick about
  the plane, which is what lets the inside-tests and the 3D mesher still
  answer. `terrainFrame()` and `terrainHeightAt()` read the section's frame
  and profile where the TIN would be, so the readout and the conversions
  are one function for both kinds; `extendTerrain` re-adopts by kind.

### Every part's flag is edited where the part is

"We should be able to click on any face, line, surface, point within the
model and edit/assign a flag number with ease." The card's "Physical flag"
row is a number box now (Enter or blur commits); the Domains panel carries
one per row and one in each domain's head (the volume flag, the ground's,
the points' default); a section face's card also edits its EDGES (base and
sides, or sky and sides) — the lines the 2D script tags. `flagKeysOf(part)`
maps a part to its key in the study's flag table, `assignFlag` writes it to
every part sharing the key (the walls are one flag), refreshes the rows and
tells the GIS page through `GeoIDModelPipeline.setFlag(key, n)` /
`setPointFlag(name, n)` — so the package written there carries the number
chosen here. A point's flag is kept BY NAME (`pointFlagByName`) and wins
over its layer's. Number inputs stop keydown propagation, or the studio's
own shortcuts eat the digits.

**A render must never draw a preview.** `stepArea` drew the section line on
every render; `addDerivedLayer` announces the change SYNCHRONOUSLY, the
announcement re-renders the builder, and the render saw no preview id yet
(it is written after the call returns) — unbounded recursion that hung the
page twice, in a way the browser tool reports as "Internal error" and then a
45 s timeout. The line is drawn when picked or defaulted, once, behind a
re-entrancy guard (`sectionLineBusy`). Any preview a step draws has to be
drawn by a gesture, not by the render that shows the step.

**The domain's own flag is a ROW, not a box in the head.** In the studio's
narrow left deck a 3.4rem input in the summary left "Subsurface" three
letters wide. It leads the domain's list as "volume" (or "default for new
points"), which has the room and reads like the face rows.

Verified live on 8125 (stamp a4cc46f), Mournes 13.67 km line through Slieve
Donard: 300 samples at 45.7 m, 4–851 m, every sample equal to the DEM's own
`heightAt` (worst 0.00 m); a point at the centre projects to 6,834 m along
and 50 m under; the package is four files with `dim: 2` and the 2D script's
physical groups; the studio shows the rock face, the air face, the profile
ribbon and the point, the readout on the ribbon reading the profile's own
358 / 295 / 450 m; editing the subsurface row to 42, the base edge on its
card to 7 and the point's row to 33 rewrote the GIS package's `flags` line
and the point's embed entry with those numbers.

### "The atmosphere and subsurface clash" — a fan across a ridge

The section's faces were triangulated as a FAN from one corner of each
ring, on the note that "both faces are monotone in s, so every fan triangle
lies inside the ring" — true of a monotone polygon fanned from the right
vertex and false of these: the air ring fanned from A has the chord from A
over the peak to B for a triangle's base and the mountain inside it.
Measured on the Mournes profile, **182 of the air face's 300 fan triangles
sat in the rock, up to 399 m deep** — the two domains drawn over each other
and read as one mesh. `triangulateRing` is ear clipping over the CCW ring,
pinned against a synthetic ridge (area tiled, n − 2 triangles, no centroid
on the wrong side, and the fan failing the same check as the control), and
measured live after: 0 of 300 on the wrong side for both faces. The STL and
the studio read the same triangulation; the 2D gmsh script never fanned.

### Mesh size fields: gmsh's own vocabulary, user-defined

"You have it that we HAVE to define the element size, min and max, whereas
gmsh allows mesh size fields at points, at a flagged boundary or surface, by
polygon — develop this to be super flexible." `mesh-size-fields.js` is the
pure emitter (26 checks) and step 6 of the Model Builder is its GUI:

| field | gmsh | what the card asks |
| --- | --- | --- |
| at a point | MathEval distance + Threshold | size, held to a distance, graded out to another; a picked point or an embedded one by name; a depth |
| along a boundary | Distance (entities by physical FLAG) + Threshold | the boundary by the study's own key — top / base / sides / sky |
| in a box | Box | two picked corners or a layer's bounds, an elevation range, size in/out, a blend |
| in a circle | Ball | a centre, a radius, size in/out, a blend |
| a formula | MathEval | any F(x, y, z), the user's own |
| finer on slopes | Structured (file) | the terrain-graded field, as before |

Combined by `Min` (or `Max`, a control) and set as the background mesh.
The **cap is optional** (blank = gmsh decides), the floor is auto (half the
smallest field size) or a number, and gmsh's own size sources — extend from
boundary, from points, from curvature — are controls that default OFF beside
a field, because they win exactly where a field was written for. The 2D and
3D algorithms are selects. Coordinates are resolved by the caller into the
script's own frame (east/north/up for a block, (s, z, 0) for a section), so
one emitter serves both scripts; a boundary field goes only into the script
whose flag it names (`SCRIPT_KEYS`). A field that cannot be placed yet is
LEFT OUT and named in the status and the spec's `left_out`. The fields draw
on the globe (rings at a point's inner and outer reach, circles, boxes) with
a key by size; the model page's part card carries "Mesh size here" — a face
adds a boundary field, a point a point field and its node size — through
`addSizeField` / `setPointSize` on the seam. A point's chosen node size
(`pointSizeByName`) wins over the spacing default.

**Measured with gmsh 4.11.1 on an emitted 2D script** (a ridge profile,
3 km of rock, 2 km of air, cap 400 m): a point field of 10 m graded to
800 m, a boundary field of 40 m along `top`, a ball of 25 m — the mesh
reads **10.0 m at the borehole, 177 m half-way out, 401 m in the far rock,
25.0 m in the vent** (7,934 triangles). The fields do what they say.

**A section's later steps were blocked on a surface it never builds.**
`blockedReason` gated domain, conditions and build on `state.surface`; a
section's surface is its profile, so the whole lower half of the builder
stayed shut for a 2D model while `build()` worked from the seam. The gate
reads the kind. **And a section face's "mesh size here" is a BOX over the
face**, not a boundary field: a face of a 2D mesh is a surface, its flag is a
surface flag, and a Distance from `getEntitiesForPhysicalGroup(1, 11)` is a
distance from nothing. The card writes a box over the face's (s, z) extent —
base to the profile's top for the rock, the profile's bottom to the sky for
the air — blended over the reach. A 3D face keeps the boundary field.

Verified live on 8125 (stamp fc6a32e→e725b57): three fields added through
the builder's own buttons — 8 m at the embedded point "centre" graded to
600 m, 30 m along `top` to 500 m, a 20 m ball of 500 m radius 1,200 m down —
drawn on the globe with a key by size (8 m, 20 m), the cap set to 300 from
the panel, and the emitted 2D script carrying MathEval+Threshold,
Distance(CurvesList by flag 1)+Threshold, Ball, Min(2, 4, 5) as background,
the three sources off, cap 300 and the auto floor 4 (half the smallest).

### The Meshing Studio's chrome is the GIS page's

"The formatting, theme and arrangement of the model page's tabs is
underdeveloped — two tab bars along the central header; remove the Ask
Atlas input; allow all the tab bars to expand/collapse; consistent theme
with the main GIS page." Four changes, one markup for both pages:

- **One RIBBON, not two toolbars.** The nineteen actions are four menus —
  File, Edit, Boolean, Export — beside the view controls (Pick, Edges, Grid,
  Wire, Gizmo, Fit/X/Y/Z/Iso, Clip). A menu opens one at a time and shuts on
  an action, a click elsewhere or Escape; the ribbon folds to a pill. The
  decks hang under it at whatever height it wraps to (`--studio-ribbon-h`,
  kept true by a ResizeObserver) rather than at a constant written for two
  rows.
- **Every strip folds.** Each deck has a fold button in its tab strip that
  drops it to its tabs (a tab press unfolds it); every section inside a pane
  is the sidebar's own `gis-tool-section` card, wrapped at boot from the
  group titles (`foldPaneSections`, ids untouched so `byId` still finds every
  control); ribbon, decks and sections are remembered in
  `geoid-studio:folds`.
- **The accent is the chrome.** Frames, tab strips and menus carry the nav
  bar's magenta — the tiles wore the skin's cyan, which the legend fix
  already recorded as "this box is a reading". Tab strips speak the sub-tab
  voice (Exo 2, 600, uppercase, letterspaced) and the active tab is the
  accent filled solid with dark ink, as an open tab is. The styles are ONE
  block appended to both stylesheets and pinned equal, because the planets'
  copy of the studio markup had already drifted (it still offered Stars and
  Ground); the markup is regenerated into `index.html` and `gis/shell.html`
  from one template and pinned equal too.
- **The Atlas box is gone.** Its phrase matcher is `buildFromText` on the
  studio seam, and the Atlas launcher's grounded layer answers "build a
  volcano with a chamber" by switching to the model page and calling it.

**An absolutely positioned box at `left: 50%` shrinks to fit HALF the
screen.** The ribbon is centred with `left: 50%; transform: translateX(-50%)`
and its available width for shrink-to-fit is the containing block minus that
left — half the viewport — so it wrapped into two rows at 705 px on a
1,411 px screen with 1,088 px allowed. `width: max-content` makes the
max-width the only wrap. And centred, it clears the mode bar on the left and
the Atlas column on the right by the same margin (`calc(100vw - 38rem)`);
below 1,180 px it stands beside the mode bar, right-aligned, clear of the
launcher. Measured: 304..1,107 on 1,411 with the mode bar ending at 269.

### The studio's own gmsh environment: a primitive is its faces, and the script carries every choice

"The template and primitive presets need the same functionality as the
Model Builder — the atmosphere domain, click-and-edit flags for every
surface, volume, line, embedded points — fully two-way between the GIS and
model pages, one modular gmsh environment." `studio-gmsh.js` (20 checks),
proven under gmsh 4.11.1 rather than assumed:

- **A primitive is its FACES.** `faceParts` clusters the display surface by
  normal: a box is six faces named by the axis they face, a cylinder its
  caps and one side, a sphere one surface, a volcano edifice the crust's six
  and the cone's side. Curved against planar is decided by the NEIGHBOURS —
  a revolved facet has another a few degrees away, a box face nothing nearer
  than 90° — because counting triangles read a crust's two-triangle faces as
  curved beside a 96-triangle cone. Each face is its own mesh in the entity's
  group, with a flag, a Workspace row, a Domains-panel row and a card; each
  entity carries a volume flag (10, 11, … as added). `allParts()` is what
  the picker, the panel and the cards read, GIS terrain and studio alike.
- **The script is OCC, in the studio's order.** Every primitive as an OCC
  solid (an ellipsoid a dilated sphere, a dike a rotated thin box, a layered
  halfspace ONE BOX PER LAYER), the booleans as applied (a cut tool KEPT as
  a volume of its own — a chamber is a domain), the atmosphere a box over the
  ground cut by the model, everything fragmented, then physical groups:
  volumes by the last entity containing their centre of mass (the AIR first
  by its bounding box — measured, a cone in a symmetric air box put the
  air's centroid inside the cone), faces by nearest declared part in
  centroid and normal, edges and corners inheriting the lowest flag, the
  embedded points, and the size fields through the shared emitter.
  **JSON `true/false/null` are not Python**: `PYL` writes True/False/None.
- **Measured:** volcano + chamber + 4 m of air + a probe + a point field →
  edifice 10, chamber 12, atmosphere 11 (12 once the page chose it), faces
  top 1 / base 2 / sky 4 / sides 5 / sides_above 6 / cone side 7 / chamber
  surface 30, the probe a node, 0.28 m elements at it against 2.4 far.
- **The model page grew Atmosphere and Embedded points cards** (the
  studio's own; a GIS terrain brings its own), a fields pane in the
  builder's vocabulary, and Export ▸ Model package — the builder's file set
  (an STL of every face, the script, a spec) into the project; a
  GIS-derived model goes back through the builder's writer, so a
  DEM-derived and a built model leave the same files. Save/Open carry
  flags, air, points and fields.
- **`init()` runs at module end and now reads `gisTerrain`**, whose `let`
  sat below that call — a TDZ that took the whole module out (the seam never
  appeared, no console error in the page; the error only showed by importing
  the module inside the iframe's realm). Declared beside `state` now.

### The studio's chrome and controls ARE the GIS page's, measured off it

"There are clashes between pills/tab bars — ensure the model page replicates
the same theme, font and colour scheme as the GIS page; currently displays red
pills." Four faults, all measured rather than eyed:

- **The mode bar and the ribbon were positioned separately** and both sat over
  the left deck: the mode bar ran to y = 104 with the dock starting at 96, so
  the GIS/MODEL/RESEARCH pills lay on the Add/Model/Label/History strip. They
  are ONE flex row now (`.studio-topbar`, left 0.9rem to right 3.8rem, clear of
  the Atlas launcher) and both decks hang under its measured height
  (`--studio-chrome-h`), so they start level and nothing above can reach them.
- **A DECK IS A COLUMN AND ITS TAB STRIP MUST NOT SHRINK.** The dock is a flex
  column; with a tall pane the strip was squeezed to **9 px around 18 px
  buttons** — which is most of what "the tab bars clash" looked like. `flex: 0 0
  auto` on the strip, `flex: 1 1 auto; min-height: 0` on the pane.
- **The red pills were the studio's own primary at 2.5x the page's alphas.**
  The GIS page's `.tool-button` is `rgba(255,103,88,.16) → rgba(102,18,28,.34)`;
  the studio's was `.4 → .58`, which reads as a solid brick pill beside it. Every
  control now carries the page's own measured values — background, border,
  radius, padding — and the fields sit on the page's own field ground.
- **The ink and the borders come from the app's control skin, not from a
  copy.** `styles/viewer-skin.css` paints `.tool-button, .button, .input, …`
  with `!important` (cyan ink, `rgba(var(--skin-data-rgb),0.40)` border); the
  studio's classes were simply not on that list. Added there, so a theme
  restyles the studio with everything else. Chrome stays magenta and controls
  stay cyan — the skin's own division, which the studio had been ignoring.
- **A section head keeps the GUI's own open-is-filled rule** (side-panels.js):
  the studio's invented tint is gone, so an open head is the solid accent in
  dark ink here as everywhere. Domain heads also carry `data-tool-icon` so the
  shared painter's fallback bracket stays off them, and a name too long for a
  16rem deck says itself on hover.

**AND THE SHARED SKIN SHEET HAD NEVER BEEN CACHE-BUSTED.** `stamp.py` only
rewrites a `?v=` that already exists, so `/styles/viewer-skin.css` and
`/styles/viewer-themes.css` carried none: the rule was on disk, the page went
on serving its cached sheet, and the studio's ink stayed white while the file
said cyan. The tell is a computed value that disagrees with the file —
`[...document.styleSheets]` says what is LOADED, `fetch(url, {cache:"reload"})`
says what is on disk. Given a stamp by hand once on the ten pages `stamp.py`
sweeps (the GIS viewer and the nine planets); it keeps them fresh from here.
Any future edit to the app-wide skin needs that stamp to exist or it is
invisible to everyone who has been to the site before.

### "The model page appears to be broken" — it opened on the Earth's centre

Entering Model mode on a fresh page gave a black viewport, no ground lattice
and a 2,000 km scale bar: the camera sat 6,371 km from the anchor with its
target on the world origin. Two faults, both about framing:

- **`object3D.visible` is the NODE'S OWN FLAG.** Model mode hides the whole
  `GeoID-ImportedGeoLayers` group and never touches its children, so every GIS
  layer inside it still reported visible. With the launch defaults loaded and
  no model yet, `modelFocus`'s `own.length ? own : all` fallback framed the
  plate boundaries at the world origin. It counts only layers whose EVERY
  ANCESTOR is visible now, so an empty studio falls through to its own default
  working area (250 m of ground) as it was written to.
- **`updateMatrixWorld(true)` refreshes DESCENDANTS, not ancestors.** A group
  added to the anchor in the same tick still carries the identity, so boxing
  its meshes put them at the ORIGIN — and the new "frame the first solid" fit
  flew the camera to the Earth's centre. `updateWorldMatrix(true, true)` walks
  the parents first, which is the question being asked.

**The first solid is framed and later ones are not**: the studio opens on a
working area and a default 1 m box in it is a speck, but a fit on every add
would yank the view away from what is being worked on. Measured: arrival
850 m from the anchor with a 200 m bar, first add 3 m with a 0.5 m bar, a
second add leaving the view where it was, Fit then framing all three at 38 m.

**A studio deck collapses INTO ITS MARGIN, the GIS sidebar's own gesture.**
Folding it to a strip of tabs still spent the column on a panel nobody was
reading. Each deck now slides off its own edge
(`translateX(calc(-100% - 1.4rem))`, the sidebar's rule) and leaves the GIS
page's vertical handle there — `#nav-tab`'s shape, in the studio's Exo 2 —
which opens it again; the fold button in the tab strip is the other door, and
the state is remembered. Measured on a 981 px viewport: the left deck 14..214
open and −208..−8 shut with its handle at 0..37, the right deck 767..967 and
989..1189 with its handle at 944..981.

**The worlds strip opens COLLAPSED.** It is a place to go rather than a thing
to read, and it sat open across the foot of every page for a choice most
sessions never make. `storedCollapsed()` treats an absent key as collapsed;
an explicit choice is still remembered in both directions.

**And a transform read after a class toggle is the transition, twice over.**
Two readings 500-600 ms after the fold reported the deck unmoved while the
rule was applying correctly — this file already records the trap for the
chevrons. Wait a clear second, or read the rule rather than the box.

**And the toolbar's collapse is the worlds strip's toggle, verbatim.** Two
collapse gestures on one page that looked different were two things to learn.
The ribbon's fold is the planet dock's control now — the same 2.4 x 1.2rem
pill, the same caret rotating 180°, the same accent fill with dark ink once it
is the only thing left — and the bar's own frame goes with the bar, so folded
there is nothing but the pill. The caret points the way the bar will go (up
from the header, down from the footer). Measured: both toggles 38.4 x 19.2 px
at 999px radius, both filling `rgb(255,43,214)` on `rgb(43,0,48)` when shut.

### The studio's layout is the GIS page's: one bar, and two tab columns

"The GUI is very inefficient with its use of space — the GIS/Model/Research
button could merge with the header pill; the left pill could be the main tab
bar of the GIS page, with its contents nested inside as subtabs."

- **ONE TOP BAR.** The mode switch had a tile of its own beside the ribbon,
  spending a band of the screen on three pills and colliding with the deck
  under it. It sits in the bar now, after the studio's name, with the four
  action menus, the view controls, what the model holds (`#studio-status`)
  and the collapse pill. `#studio-mode-slot` keeps its id, so mode-manager
  parks the switcher exactly as before; `.view-mode-switch.is-in-studio` is a
  row of three small pills rather than a stacked block.
- **A DECK IS THE GIS PAGE'S TAB COLUMN.** A horizontal strip of four labels
  over one pane kept three quarters of each deck behind a click. Every pane is
  a `control-section toolbox-group` — the sidebar's own tab, so its chrome
  comes from the GUI-wide rules and matches by construction (measured against
  a live GIS tab: same accent fill, same dark ink, same Exo 2 12.16px 600) —
  with its sections nested inside as `gis-tool-section` cards. One open per
  deck, remembered; `showGroup(side, name)` is what "bring the Model tab
  forward" means now, and the two callers use it.
- **A NESTED COLUMN NEEDS THE ROOM.** Four levels of padding (deck, tab, pane,
  card) left a domain row with 186 px of content in 135 px of space and a
  scrollbar inside a scrollbar. Measured at every level: the deck is
  `min(17rem, 27vw)`, the pane and cards carry less inset, a row's NAME is
  what gives way (ellipsis plus a title), and the flag box never shrinks.
  A span reporting `scrollWidth > clientWidth` there is the ellipsis working,
  not an overflow.
- The dead `.studio-tabs`, `.studio-tab` and `.studio-modebar` rules are gone
  from both stylesheets rather than left to mislead.

### The Add tab: a prebuilt scenario and a shape, each with its own numbers

"Do the Parameters relate to the presets or the primitives?" They only ever
drove the PRIMITIVE — the templates built from hard-coded numbers, so the one
prebuilt thing in the studio was the one somebody else had sized (a volcano
was always 3 km tall on a 20 km crust). The pane read Templates / Primitives /
Parameters and left the reader to guess which of the two the third belonged
to. Two cards now, each complete:

- **Prebuilt scenarios** — a button per scenario, the chosen one's sentence,
  its own parameters, and Add this scenario. Each `TEMPLATES` entry declares
  `params` in the same shape a primitive does and `build(p)` maps them onto
  the entities it expands into: the volcano's crust, edifice and chamber; the
  layered block's thicknesses and its dike's geometry.
- **Build your own** — the shapes under the heading each one already declared
  (`PRIMITIVES[kind].group`: Basic, Geological), the chosen shape's
  parameters, and Add this shape.

`renderParamRows(host, spec, values, mark)` draws both, so the two cards
cannot drift, and **what is typed is kept on the state** — adding a scenario
re-renders the pane, and before that the numbers just typed came back as the
defaults. The base `.studio-palette` is two columns, so a blurb appended to it
sat BESIDE the button grid until the studio's own rule said one column.

Verified live: a volcano scenario customised to a 30 km crust, a 1.5 km
edifice, an 8 km base and a 2 km-deep 3 km chamber built as two entities with
those numbers, a cylinder of my own added on top of it, and the emitted script
carrying three volumes at flags 10, 11 and 12.

### One deck, two bands — the mesh tabs joined the build tabs

"Can we combine the mesh pill into the build tab?" The right deck is gone. Its
four groups (Mesh, Structured, Refine, Log) live in the single left deck under
a `Mesh` caption, with Add, Model, Label and History under `Build`, and the
edge handle reads STUDIO. `showGroup(name)` lost its side argument; the right
dock's rules, its edge tab and `.studio-dock-right` went with it.

**The accordion opens one per BAND, not one per deck.** A reader wants a build
tab and a mesh tab in view together — that is the whole reason the two decks
were tolerable — so a group carries `data-band` and opening one closes only its
own band's siblings. Two panes open at once, in one column, in the order the
work is done.

**NOTHING IN A DECK BODY SHRINKS.** As a grid the deck distributed its height
among its items, so two open panes shared it: measured, an Add tab **113 px
tall around a pane that wanted 846**, clipped by the card's own `overflow`,
with the deck itself reporting nothing to scroll — the panes had been made to
fit rather than the column made to hold them. A flex column with
`flex: 0 0 auto` on every child and `overflow-y: auto` on the body is the fix.
Measured after: deck scrollHeight 1850 against a client of 601, the Add tab
926 around 879 and the Mesh tab 550 around 503, neither clipped.

This is the `.gis-tool-body` and `.qt-v` lesson in a third place: **a container
that lays its children out (grid or flex) will size them to itself unless it is
told not to, and the symptom is a clipped pane rather than a scrollbar.**

### A nested subtab arrives shut, the bands lose their words, and the deck is the nav bar

Three changes to the one column, each measured on the live page.

**COLLAPSED IS THE TAB COLUMN'S OWN RULE, and four defaults broke it.** A
nested subtab said what was inside its tab and then showed it anyway: the pane
folds defaulted open (`folds[key] === undefined ? true`), so did each domain
in the Domains panel (`domainOpen.get(id) ?? true`), and the Atmosphere and
Embedded points cards were built with `open = true`. Opening the Add tab was
therefore opening its whole parameter list. All four now default shut, and a
remembered state still wins in both directions — the state is what a reader
chose, the default is what they are handed. Measured on a fresh fold store:
**0 of 12 nested subtabs open**, with the eight tabs unchanged at one open per
band.

**The BUILD and MESH captions are gone, and a HAIRLINE IS NOT AVAILABLE
THERE.** The obvious replacement — a border-top on the first mesh-band tab,
selected on the CHANGE of band (`[data-band="build"] + [data-band="mesh"]`) so
nothing in the markup has to be kept in step — draws nothing: the shared chrome
paints a tab's own frame `!important`, so the computed border-top is the accent
in both states. Measured open and shut before the rule was replaced by a wider
gap, which is the one separator nothing can overrule. **18.4 px at the band
change against 6.4 px within a band.**

**The deck is the GIS nav bar's own dimensions.** `#ui` is
`min(24rem, calc(100vw - 2rem))` at `left: 1rem`; the deck was
`min(17rem, 27vw)` at `0.9rem` — a width picked to fit a nested column rather
than to match anything, with two narrow-screen narrowings the nav bar has no
equivalent of. Measured after, in the same viewport: **both 384 px wide at
left 16**. The top and bottom are still the model page's own — the deck hangs
under the studio's top bar and clears the worlds strip — because those are
facts about that page rather than about the column.

**AND THEN IT SILENTLY WENT BACK TO 16rem FOR TWO COMMITS.** Reported as "the
model nav bar is much skinnier than the GIS page one", and measured at 256px
against 384 while every grep of the file still said 24rem.

Deleting the `.view-mode-switch.is-in-studio` rules left the last one's
selector PREFIX behind — `#model-studio#model-studio`, the doubled id that was
its specificity trick — with no `{` after it. **That is not a parse error.**
CSS reads the fragment and the next rule's selector as ONE selector with a
descendant combinator between them, so

    #model-studio .studio-dock { width: min(24rem, calc(100vw - 2rem)); }

was parsed as `#model-studio#model-studio #model-studio .studio-dock` — a
`#model-studio` inside a `#model-studio`, which cannot exist. The rule was in
the sheet, matched nothing, and the older unscoped `.studio-dock { width:
16rem }` won by default.

**A TEXT PIN CANNOT SEE THIS, and one was passing throughout.** What settles it
is the browser's own parse: `dock.matches("#model-studio .studio-dock")` was
TRUE while no rule with that `selectorText` existed in `document.styleSheets` —
that disagreement is the whole diagnosis, and it takes one measurement.
`theme.test.mjs` now checks the SOURCE invariant instead: in a multi-line
selector list every line but the last ends with a comma, so a dangling fragment
(or a descendant combinator split across lines, which is legal and has now cost
this tree once) fails. The check is asserted against the fault itself before it
is trusted.

**It found a second one, older and live.** `gis/shell.css` carried a comment
whose opening `/*` and first line and a half had been eaten — the backtick trap
this file records six times, here in a plain stylesheet rather than a template
literal. The surviving tail was read as a selector and swallowed the rule after
it, so `.row[hidden], .toolbox-group-body [hidden] { display: none !important }`
— the override the `[hidden]` note exists for — has never applied on any of the
nine planet pages. Earth's copy of the comment is intact, which is what it was
restored from.

**When a stylesheet's rule is right in the file and absent from the page, the
fault is usually ABOVE it.** CSS error recovery swallows forward, so the
damaged line and the dead rule are never the same line.

**A computed border that disagrees with the rule that set it is an
`!important` you have not found yet.** Enumerating `document.styleSheets` for
rules the element matches listed mine and no other border rule, and the
computed value was still the accent: a module-injected sheet or an `!important`
the scan could not attribute. When a border loses and nothing in the cascade
explains it, stop hunting the source and pick a property that cannot be
overruled.

### The frame is its contents, and every tab arrives shut

**A FIXED `bottom` IS A FIXED HEIGHT.** `.studio-dock` was `top: … ; bottom:
3.2rem`, so the deck stood at full height whatever was in it — eight shut tabs
in a box two thirds empty, which is what "the outline is not tight" was.
Shrink-wrapped now (`bottom: auto`) with the strip's clearance kept as a CAP
(`max-height: calc(100% - top - 3.2rem)`), so the frame grows to whatever is
opened and the body scrolls only once the cap binds. Measured on one viewport:
**454 px shut, 537 with one tab open, 619 with two, 648 at the cap** — where
648 is exactly the room between the top bar and the worlds strip, with the body
scrolling and 8 px of slack under the last tab when nothing is open.

**Nothing opens itself.** The markup carried `open` on Add and Mesh, so a fresh
deck arrived with two panes showing. Both are gone; only a remembered choice
opens a tab. And SHUTTING the band's open tab is a decision too — the store
kept the name whatever the reader did with it, so the next load reopened the
tab just put away; closing the stored tab now clears it.

**One spacing down the column.** The wider gap at the band change went with the
BUILD/MESH captions: measured **6.4 px between all eight**. The band survives
as behaviour alone — one tab open per band, so a build tab and a mesh tab can be
read together — which needs no mark of its own in a column where every tab
arrives shut.

**A frame that hugs its contents is the whole reason the earlier fix worked.**
The deck body is a flex column whose children are `flex: 0 0 auto`; with the
height no longer imposed from outside, the panes size themselves and the cap is
the only thing that can make anything scroll. A grid, or a fixed `bottom`, and
the panes are sized to the box instead — the same fault this file already
records for `.gis-tool-body` and `.qt-v`, met from the container's side.

### The page opens on the events drop-down, which needed the corner arbitrated

"Ensure that upon launch the events drop-down is shown initially over the
legend." The feed was already armed at launch and deliberately opened NO panel,
and the note explaining that named the real obstacle rather than a preference:
**the corner is one slot, and the two openers are not equals at boot.** The
feed is armed on purpose by `armOnLaunch`; the legend opens ITSELF whenever a
layer arrives, which at launch is the launch defaults landing a second or two
later. Opened without arbitration the feed was simply overwritten by whichever
fetch finished last — which is why it used to arm shut.

**A CLAIM, in the file that already owns which of the two is open.**
`overlay-stack.js` says in its own header that this decision belongs to neither
card, and it is where the launch's choice belongs too: `claim(id)` opens a card
and holds the slot for it, `mayAutoOpen(id)` is what the OTHER card asks before
an automatic open, and `releaseClaim()` is called by the stack itself on the
first press of either toggle.

- **It is a DEFAULT, not a lock.** A press is a decision and this is not, so
  the reader's first press of either toggle ends it, in both directions.
- **A press never goes through the gate.** Only the arrival path is gated
  (`if (fresh.length && mayOpen)`); `legend-dock`'s own toggle handler calls
  `setOpen` directly and is untouched.
- **The legend ASKS rather than knows.** `window.GeoIDOverlayStack?.mayAutoOpen
  ?.("map-legend") ?? true` — that file has no business knowing the events feed
  exists, and a page without the stack answers yes, which is the behaviour that
  was there before.
- **IT EXPIRES.** Nothing announces that a launch is over, and a suppression
  with no end would stop the legend opening for a layer somebody ticks ten
  minutes later. The bound is `armOnLaunch`'s own twelve seconds — the wait it
  already gives up a viewer after — rather than a number invented for it.
  Expiry only stops the claim suppressing; it closes nothing.

**And the pin that asserted the old behaviour was INVERTED, not deleted.**
`event-sources.test.mjs` checked `if (active && panel && !launch)` — the branch
that skipped the open — and it was right to, so it now checks that the launch
opens the panel AND claims the slot. A pin that guards a decision has to be
re-argued when the decision changes; deleting it would leave the new behaviour
unguarded and the old one free to come back.

Verified on a real launch: the feed's panel open at 280x312 with "252 natural
events in 5 categories · 134 earthquakes", the legend's panel hidden, both
toggles side by side — then a press of the legend takes the corner (legend
open, feed shut, claim released), a press of the feed takes it back, and a
second press leaves both shut.

### The Model Builder is linked to the drawer, and a dead Export CSV is shown nowhere

"Ensure that the model builder is linked to the new draw tool implementation —
not the old — the export csv button is popping up below (old)." Three faults,
and the second is one I introduced while fixing the third.

**THE STEP READ A SHAPE AND COULD NOT RAISE THE TOOL THAT MAKES ONE.** Step 1
had exactly one button, "Use this area", over `getExtractionGeometry` — so
"draw a study area" was an instruction to go and find a tool on the other side
of the screen, and whichever one was found first decided which flow the reader
was in. It has a **Draw on the globe** button now, calling `promptDrawTool()`
from `extent-picker` — which presses the tool rail's OWN button, so there is
one drawer armed one way whether the press comes from a hand on the rail, the
extent picker or here. Verified: the press arms the rail and raises the shape
bar.

**AND DONE HAD TO BE PRESSED TWICE.** Every creator of a study area flows
through `setStudyAreaPolygon`, so the builder listens for its announcement and
takes the shape — the reader draws, presses Done, and step 1 is answered.
Guarded three ways, each a fault already paid for here: only while the picker
is on "drawn" (a reader who chose a polygon LAYER has not asked for whatever is
being sketched beside it), only while the builder is on screen, and debounced
with a re-entrancy flag, because a drag edit announces on every pointermove and
`render()` is what draws this builder's previews — a render that draws is a
render that announces, which is the recursion that hung this page once.

**`geoid-study-area-edited` IS DISPATCHED ON `document`, AS A PLAIN `Event`.**
So it does not bubble, and a `window` listener hears nothing at all —
measured on the live page as zero events for a shape that had plainly landed,
while `getExtractionGeometry` returned its four vertices. `pipeline-sync` and
the weather card both listen on `document` and were right to.

**A DEAD BUTTON IS SHOWN NOWHERE, and the first attempt put it somewhere
worse.** The viewer disables its own export until there is a measurement to
write, so arming the tool put a greyed "Export CSV" on the bar before anything
was drawn — the one control there that could not be pressed. The first fix left
it at HOME while dead, which was worse: the viewer un-hides it on arming, so
the disabled button then stood in the tool rail, measured visible at
(1346, 107) — which is the "popping up below" being complained about. It is now
always borrowed off the rail and the SLOT is what hides, so it is nowhere until
it works. `disabled` joined the watched attributes with `subtree`, because it
flips on the button inside rather than on the row.

**And the slot's `hidden` needed spelling out** — `#gis-draw-export-slot` sets
`display: flex`, which outranks the attribute's UA-level `display: none`, so a
hidden slot still laid the dead button out at (903, 79). Fifth instance of that
trap in this file.

Verified end to end: armed with nothing drawn, the export is in the slot and
not laid out and never in the rail; a shape drawn through the viewer's own seam
lands as "the drawn area — model domain 15…", the builder advances to step 2 by
itself, and the export becomes live on the bar.
## The seismic record is three catalogues, and the bake that made it crashed the laptop

"Find the most comprehensive and complete and up to date historic seismic
catalogue possible." No single one is both complete and current, so the record
is three, and each is the best available at what it does:

| | | |
| --- | --- | --- |
| **ComCat**, M ≥ 4.5 since 1900 | 311,675 events, public domain | density and currency |
| **ISC-GEM v12**, 1904–2021 | 84,000, every one Mw | the homogenised backbone |
| **GEM GHEC v1.0**, 1008–1903 | 825, about M ≥ 7 | the only global pre-instrumental catalogue |

**THE JOIN NEEDS NO FUZZY MATCHING, and that is the whole reason this shape
works.** ComCat's `ids` field lists every contributing id of a merged event, so
an ISC-GEM Mw is LOOKED UP rather than matched in space and time — measured on
one event, `,choy19950101065955,gcmtc010195a,usp0006qpv,gcmt19950101065954,`
`iscgem122054,` against ISC-GEM's own `iscgem122054` at Mw 6.42. No duplicate
markers, no tolerance to tune. And GHEC's last event is 1903-12-28 against
ISC-GEM's first at 1904-01-20: the two were built as a pair and the seam needs
no dedup either. Live: **312,500 events, 77,659 carrying an ISC-GEM Mw.**

**WHY IT BUYS THE HAZARD ANYTHING.** About 82% of modern ComCat at M ≥ 4.5 is
body-wave mb, which saturates near 6 and reads low against Mw — so events land
a band low under the raw number. The rates are computed on `mw` where ISC-GEM
reaches. The record's floor moved to 4.5 for the TIMELINE; the bands still
start at 5, so 200,000 of the events never reach a footprint.

**THE HISTORICAL RECORD IS IN THE TIMELINE AND NOT IN THE RATES.** A rate needs
a COMPLETE window; GHEC is the large events somebody knows about across nine
centuries, and counted it would divide a handful by 900 years and understate
every rate it touched. Each frame says which regime it sits in — pre-1904 is
GEM's, pre-1964 is complete only above about M 6.

**LICENCE, and it is a real obligation rather than a footnote.** ComCat is US
Government public domain; **ISC-GEM and GEM GHEC are CC BY-SA 3.0**, which is
SHARE-ALIKE — so the grids, being derived from them, are offered under CC BY-SA
3.0 with the citations. It is stated on the layer, in the bake's own `_source`,
and in the ⓘ. Dropping to ComCat-only would return the whole thing to public
domain and cost the homogenised Mw before ~1970 and the pre-1900 record
entirely; that is the trade, and it is the reader's to make.

Rejected, each for a measured reason: the **ISC Bulletin** is 24 months behind,
not homogenised, FEWER events than ComCat at M ≥ 4.5 (468 against 554 for one
month), and grants **no redistribution licence anywhere** — read the citing
page and the full Data Management Policy. **EMSC** is "All rights reserved" and
starts in 1998. **Global CMT** is pure Mw and current and publishes no licence
at all.

### The bake took the machine down, and the cause was a 720× multiple

**`disc(radius)` built a footprint for EVERY ONE OF THE 720 CENTRE ROWS and
cached the lot under one key, while `kernel` used exactly one of them.** Held
for the 91 distinct radii that ISC-GEM's 2-decimal Mw produced, that is
**7.46 GB**, of which a single M 9 radius is **1.0 GB on its own** — on a
laptop with about 7 GB free. Nothing ever evicted it. The old bake survived
because 1-decimal magnitudes over M ≥ 5 produced far fewer radii.

**My first estimate was wrong by that same 720, and only reading the loop
fixed it.** A spherical-cap estimate of one footprint per radius came to
0.01 GB and said the cache was innocent. Count what the code BUILDS, not what
the geometry implies.

Four changes, and the peak is now **614 MB, 12.8 seconds** for the stamping:

- **The footprint is per (radius, CENTRE ROW)**, which is the smallest correct
  unit — longitude is a rotation and the columns were already offsets — and the
  events are **stamped in groups of that pair**, sorted, so each footprint is
  built once, used by the ~15 events sharing it, and dropped. Measured: 6,918
  footprints for 111,718 stampable events, one alive at a time.
- **The magnitude is binned to 0.1 before the reach is taken**, and that is
  honesty rather than economy: the reach is a global-average attenuation with
  σ = 0.4, so the radius is uncertain by about a factor of 1.5 and resolving it
  to ISC-GEM's 0.01 is false precision by two orders of magnitude. 91 radii
  become 38.
- **The fetch is a GENERATOR.** It held every ComCat feature — 311,675 dicts of
  two dozen properties — while building a second list of tuples beside them. A
  year is converted and dropped now.
- **What survives into the stamping is four numpy columns**: 312,500 × 5
  float64 is **12.5 MB** against most of a gigabyte. Written to
  `data/global/.seismic-work/events.npy` (gitignored) so **`--stamp-only`
  re-runs the grids with no network and no laptop** — which is how all of this
  was tested.

**AND THE FIX EXPOSED A SILENT WRONG ANSWER.** `order` and `rowsi` live in the
FILTERED space and `mag_a`/`year_a` in the full one; reading the second with an
index from the first takes a different event's magnitude and year entirely.
Nothing throws — both are the right dtype and the wrong length is never
reached. It put **San Francisco at one damaging shake in 24 million years with
no largest event on record**, beside a Tokyo M7 rate five times too high. The
sanity print is what caught it, which is the argument for having one.

Measured after, and the peak magnitudes are the check that means something —
they are recognisable events: Tokyo 1 in 14 y (max **M 9.09**, Tōhoku),
Santiago 1 in 13 y (**M 9.55**, Valdivia), Jakarta 1 in 79 y (**M 9.31**,
Sumatra), San Francisco 1 in 106 y (M 7.7), Istanbul 1 in 119 y, London
nothing.

### Two more faults the rename and the scale surfaced

**A LAYER ASKED FOR BY NAME BREAKS ON A RENAME, and reports itself as
absent.** `eventsLayer` matched `/earthquakes \(USGS ComCat/i`; the record
became three catalogues, the layer was renamed with it, and the animation said
"tick the earthquake catalogue on first" over a layer sitting on the globe with
312,500 features in it — the same sentence a genuinely missing layer produces.
It asks `layerForDataset("earthquakes")` now, which follows the entry's own
name by construction. Same shape as the cyclone tracks' variant, and the second
time this file has paid for it.

**A SORT KEY REBUILT PER COMPARISON is millions of allocations.**
`.sort((a, b) => isoOf(a).localeCompare(isoOf(b)))` calls the key builder twice
per comparison — at 312,500 events roughly twelve million `Date` objects — and
it presented as the step control doing nothing at all. Decorated once and
sorted on the number the instant already is.

**And the class labels were assigned by INDEX.** `buildSymbology` drops a class
that falls outside the data's own range, so a span holding nothing under M 5
comes back with four rows and an index-keyed list then calls the M 5–5.9 class
"M 4.5–4.9" and loses "M 8+" off the end. Labelled by the class's own floor.

### The record plots itself, at three step sizes

The cyclone tracks' own apparatus with the earthquake in place of the storm:
**Each earthquake / By month / By year**, each with its own play interval, past
360 frames STRIDED and the stride REPORTED. Verified live: the whole record
from 1008 gives 232 frames at one per 2 years, the earliest frame reads
"2 / 312,500 · largest M 7.4" with the pre-instrumental caption on it, and the
event step gives 360 frames at one per 832 with the date pill reading
"2016-09-07 20:47" — an epoch millisecond is not a date to anybody, so the key
groups and a `show` reads.

All six files are in R2 (`rclone check`: **6 matching files, 0 differences**),
served with the bucket's fingerprint — the record fetched live from
`data.geoidinitiative.com/earthquakes.geojson?v=175241fb729c`.

### A seismic point said "mapped point", because the generic card had only geometry

Clicking an event of the merged record opened the fall-through card: kicker
**CONTINENTAL** (`crustalSetting` answering from the elevation), title
**Mapped point**, and the magnitude, the year and the place — the three things
the click was for — nowhere on the face. Everything the card said was true of
any point on that hemisphere and nothing was about the earthquake.

`earthquake-card.js` is the FIFTH self-writing card in this tree (after ice,
soil, the volcanic zone and the cyclone cell), and it exists for the same
reason each of those does: what the generic card derives is derived about the
GROUND, and an epicentre is an event that happened over ground rather than a
property of it.

- **The title leads with the magnitude and the year** — `M 7.9 — 1923` — and
  the place is the line under it, because "which earthquake" is answered by
  those two and a place name is how you recognise it afterwards.
- **`mag_best` is the discriminator**, and it is the one column only the
  merged bake writes. A risk CELL carries `mag_max` and rates; the LIVE USGS
  feed carries `mag` and `time` and has its own card with a seismogram on it.
  Testing on `mag` alone would have taken the live feed's cards over.
- **The magnitude row says which SCALE**, and names both where they differ.
  82% of modern ComCat at this threshold is body-wave mb, which saturates near
  6 — a card showing one number without saying what it is on hides the most
  consequential thing about this record. ISC-GEM's Mw is named as ISC-GEM's;
  ComCat's own appears only where it disagrees, because repeating 7.9 against
  7.94 is a row that says nothing.
- **No clock on a historical one.** GEM gives a year and often a month and
  day; where its source gave neither the bake wrote 1 January, so a time
  against a 1008 event is a reading nobody took. The row says "as the
  historical record gives it" instead, and the kicker reads HISTORICAL
  EARTHQUAKE.
- **`soil: true`** is the established seam meaning "this card wrote its own
  lines": it stops `earth-viewer` re-deriving a kicker and a title from the
  elevation and keeps the rock-property fold off a point made of nothing.

**A specialised card accretes at the HEAD of the dispatch chain**, so
`volcanic-hazards.test.mjs`'s pin on `const feature = zone ? {` broke the
moment the quake branch went in front of it. Loosened to `/[=:]\s*zone \? \{/`
with the reason written beside it — a pin that names its neighbour is a pin
that fails on the next neighbour.

**`featuresAt(lat, lon)` takes COORDINATES, not pixels**, and it cost most of
a verification. Fed screen coordinates it answers null at the exact pixel of
an event and — worse — answered a real feature at one other pixel by accident
of the wrap arithmetic, which reads as "the picker works here and not there"
and sends the hunt into the renderer. Read the signature before probing a
picker.

Verified by REAL clicks on 8125, both variants: an instrumental one reading
**"EARTHQUAKE / M 4.5 — 2006 / 34 km E of Kýthira, Greece"** with When,
Magnitude `4.5 md`, Depth `64.0 km — shallow`, the ComCat catalogue line and
its event id; and a historical one reading **"HISTORICAL EARTHQUAKE / M 7.0 —
1008 / Dinavar"**, When `27 Apr 1008 — as the historical record gives it`,
Magnitude `7.0 s`, no depth row (GHEC has none), and GEM's citation with its
CC BY-SA 3.0.

### The magnitudes are ticks, and filtering a ramp respreads it

"In the seismicity record we should be able to turn on/off by magnitude
categories to reduce noise." The tick list is the volcano type list's own
mechanism generalised (`applyClassFilter` + `drawClassRows` in
`catalogue-panels.js`, shared by both callers), and the whole difficulty is
in one place: **the colours must not move when a class is hidden.**

**THE RAMP-RESPREAD TRAP.** `buildSymbology` filters a supplied edge list to
`b > min && b < max` — dropping every class outside the data's own range —
and spreads the ramp as `t = i / (edges.length - 2)`. So filtering a layer
and repainting it through the ordinary path RECOLOURS EVERY BAND THAT IS
LEFT, under a key that has quietly lost a row: hide M 4.5–4.9 and the green
that meant "small" is handed to M 5–5.9, which is a map saying something
different from the one before the click. Measured on the real record, hiding
the bottom band respread the four survivors across the whole ramp.

**So the symbology is PINNED to a fixed spread and only the counts are
read off the data.** `seismic-magnitude.js` classifies `SPREAD = [4.5, 5.5,
6.5, 7.5, 9]` — one value inside each band, so five rows and five colours
exist whatever is on screen — and then counts the real values into them.
`bandOf(props)` is the one classifier the paint, the filter, the legend and
the timelapse all read, so none of them can disagree about which band an
event is in.

**A LAYER FILTERS AGAINST A MASTER LIST, never against itself.**
`layer._allFeatures` is captured once; every pass filters THAT and writes the
result to both `layer.features` and `layer.collection.features`, so the dots,
the click picker and the animation answer from one filtered set and
re-ticking a band restores it exactly. Filtering `layer.features` in place is
a one-way door.

**An event with no magnitude is always KEPT.** A tick list is about what is
being hidden; a null is not a band and hiding it would be a silent third
rule. Same shape as the no-value grey elsewhere in this file.

**And the animation's own note must stop naming a floor the filter has
moved.** The All frame read "312,500 earthquakes M ≥ 4.5", which is a claim
about the CATALOGUE, and with a band hidden the plot is not the catalogue.
It reads the ratio form ("299,820 of 312,500 earthquakes") whenever the held
set differs from the total, and the rebuild runs under
`window.GeoIDAnimatedLayers.hold` so the bar is not read as dismissed —
a rebuild is not a ✕, which this file already records for the step control.

Measured live, hiding a MIDDLE band (M 6–6.9), which is the case a respread
shows worst: features 312,500 → 299,820, the four survivors keeping their
EXACT counts and their exact drawn colours (`#1a9850` 199,957 · `#a6d96a`
97,604 · `#fdae61` 2,077 · `#d7191c` 182 — the ±1 is the documented
linear↔sRGB round trip), the legend still listing all five rows including the
hidden one, the status reading "299,820 of 312,500 drawn — M 6–6.9 hidden."
and the bar note the ratio form. Hiding the bottom band earlier gave the same
result at 112,543.

**`GeoIDProjectLatLon` DOES NOT CULL THE FAR HEMISPHERE.** A point on the
back of the globe projects to a plausible on-canvas pixel, so a probe that
picks a feature's screen position and clicks it can be aiming at the other
side of the planet — measured while verifying this, a Bismarck Sea event
projecting into frame with the camera over Morocco. Cross-check each
candidate pixel's own `surfaceLatLonAt` against the feature's coordinates
before believing it.
## Hydrology ▸ Water bodies: three baked pyramids, a named-seas file, one card

`services/bake-hydrology.py {hydrolakes|grwl|ocean|marine}` bakes each source
straight out of its zip (`/vsizip/`, the zip fetched from our own mirror and
deleted after), and `gis/hydrology-cover.js` streams all three pyramids through
`loadDerivedGeologyMap` — one module for three layers, because they differ only
in a manifest, a tile-layer name, a paint and a credit.

| row | source | tiles | features |
| --- | --- | --- | --- |
| Lakes and reservoirs | HydroLAKES v1.0, CC BY 4.0 | 5,668, 298 MB | 1,427,688 |
| Rivers by width | GRWL v01.01, CC BY 4.0 | 4,514, 35 MB | 42,077 |
| Ocean and seas | NE 1:10m z0–3, OSM water polygons z4–6 (ODbL) | 3,917, 19.6 MB | 53,328 |
| Named oceans, seas and bays | NE 1:10m marine areas, a loose file | — | 304 |

**Lakes are banded by SELECTION, the sea by SIMPLIFICATION** — the glacier and
soil lesson applied to each. Lakes are sparse islands, so a lake under a pixel
is left off the coarse levels (≥1,000 km² at z0–2, ≥50 at z3–4, ≥2 at z5–6,
all at z7); the sea is continuous, so dropping a polygon would put a hole in
it and it is simplified instead. The whole HydroLAKES bake is **6 min 49 s**
and never extracts the 1.8 GB shapefile.

**The Natural Earth LAKES row went**, superseded: 1,355 lakes against 1.4
million, the same lakes twice in one list. The NE RIVERS row stays, because
GRWL is a width survey and carries no names.

**THE BASIS OF A NUMBER IS PART OF THE NUMBER.** HydroLAKES reports a surveyed
volume for the largest lakes and reservoirs and models nearly all the rest, and
the first bake dropped `Vol_src`, the column that says which. It was stopped
and re-run to carry it (plus `Dis_avg`), because a modelled volume printed bare
reads as a measurement — and mean depth is that volume over the area, so it
inherits the basis. The card now says "(modelled)" on the face for both.

**GRWL's `lakeFlag` is 0 river, 1 lake/reservoir, 2 TIDAL, 3 CANAL** — from its
own Zenodo record. A search summary gave 2 as canal: that is SWORD's coding,
built on GRWL and numbered the other way round. Check the dataset's own record,
not a summary of a neighbour.

### `water-card.js`, the sixth self-writing card, and a flag of its own

A lake through the rock card was headed from the elevation and handed the
rock-property prior. `water-card.js` recognises each bake by the columns only
it writes (`volume_mcm`+`lake_type`, `width_median_m`, a bare `class:"ocean"`,
a marine `kind` with a `rank`) and is wired into BOTH builders — the tiled-map
builder in `geology-panel.js` and the vector path in `feature-popup.js`. A
river line from a tiled layer has no polygons, so the tiled builder skips it
and `showStack` sends it to the vector path; that is why both are needed.

**`soil: true` is what `ground-profile.attachToCard` reads as "a ground card",**
so a card that borrows the flag to mean "I wrote my own lines" also grows a
soil-thickness-slope profile. Water carries `water: true` as well, and the
profile refuses it. The risk, zone and earthquake cards borrow `soil: true`
the same way.

### GDAL's MVT writer drops a polygon that simplification made invalid, silently

The first ocean bake had **no zoom-0 tile and only two of the four zoom-1
tiles**: the sea missing from half the planet from orbit, on a continuous
layer. The log had nothing in it, the exit code was 0, and CPL_DEBUG added
nothing either. It reproduced on the NE ocean polygon alone. Without
`-simplify` all five tiles came back. With `-simplify` and `-makevalid` they
also all came back. `-explodecollections` changed nothing.

Douglas–Peucker at 0.05° makes a polygon self-touch, and the MVT writer
leaves an invalid polygon out of the tile rather than failing. **Every band
in `bake-hydrology.py` now passes `-makevalid` after `-simplify`.**
`install()` also refuses a `continuous` layer that is missing any z0/z1 tile,
because a sea with a hole in it looks like data rather than a fault.

The same drop was in the first HydroLAKES bake, one lake at a time. It was
measured by counting unique `id`s per zoom within a band that selects the same
lakes at every zoom (`scratchpad/count-ids.mjs`): **z0 178 but z2 177, z3 3,399
but z4 3,400.** The counts inside a band should be identical. It was re-baked
with `-makevalid`.

**Soil and GLiM now pass `-makevalid` too, measured as an A/B** (the tile
count of every tile, before and after, from the same source). **The soil map
had lost exactly one polygon**: the northern part of a 68,935 km² "Water
Bodies" polygon, the Amazon's water near 67°W on the equator, which was
missing from zoom-1 tile `1/0/0`. The other 561 tiles came back
identical feature for feature. Most of the 3,890 polygons missing at zoom 0
(30,222 of 34,112) collapse under the 0.2° tolerance and are smaller than a
seventh of a pixel. The fault here is only the invalid ones.

**GLiM had lost more, spread thin.** The same A/B on all 927 tiles:
**22 features restored at zoom 0, 20 at z1, 3 at z2, 23 at z3, 60 at z4 and
166 at z5**, gained in 89 tiles. Two tiles came back one piece lighter: the
repair turning a polygon that had collapsed to a line into nothing at all,
which is what should happen to it.

**The GLiM bake now reads its geodatabase where it lies.** The PANGAEA
link answers 404, and the authors' Dropbox link is what their page offers.
GDAL opens a file geodatabase straight out of a remote zip
(`/vsizip/{/vsicurl/…}/LiMW_GIS 2015.gdb`, with the braces because the URL
has a query string), so the 1.1 GB download never lands on a disk that
cannot hold it and the 3 GB GeoPackage together. Three things bit:

- **`pathlib.Path` collapses the `//` in `https://`**, and the open fails
  with "does not exist". The remote source is a string.
- **Dropbox's temporary content URL answers 403 to a second request.** The
  legend's `.lyr` is pulled out of the zip by HTTP Range through `zipfile`,
  and every range goes through the ORIGINAL link and follows the redirect
  again. Python also turns a redirected HEAD into a GET of the whole archive,
  so the size probe is a one-byte ranged GET.
- **A deflated zip read over HTTP inflates FORWARDS.** A lookup deep into
  the table ran past three minutes. The bake reads the table in order, which
  is the one access pattern that suits it, and it took 12 minutes for the
  GeoPackage.

**The glacier map had lost nothing**, measured the same way. Every one
of 806 tiles came back with the same feature count at every zoom, and even
the byte total was identical (`806-82456877`). The bake never simplifies
tiles (it bands by area), and RGI's outlines survive the tiler as they are.
`-makevalid` is passed anyway, so an invalid outline in a future RGI release
cannot drop silently.

Re-baking it found two traps in `bake-glaciers.py`, both fixed:

- **`install()` removed the whole `data/global/ice/` folder**, which also
  holds `names.json` and `thickness.json`. Those are other bakes' outputs:
  gitignored and published. The next `publish-data` dropped them from
  `sources.json`, so the deployed site would 404 every glacier's name and
  volume. Both were pulled back from the bucket, fingerprint-identical, and
  install now clears only the zoom directories and the manifest.
- **`MAX_ZOOM` is 7 and the deepest band is 6**, so a default run wrote
  `max_zoom: 7` over a pyramid with no zoom-7 tiles. The viewer reads an
  unwritten tile as EMPTY, so the glaciers would have vanished close in. The
  ceiling written is now the deepest band actually baked.

**`pkill -f <script name>` kills the shell that ran it.** The shell's own
command line contains the string. Stop a bake by its PID.

For any pyramid, the check that settles it is the soil one: count the features in
every tile, re-bake with the flag, and compare
(`scratchpad/tile-counts.mjs` in the session that did it: features per tile
as JSON). A per-zoom unique-id count needs an id, and neither soil nor GLiM
carries one.

### GRWL's `ID` is not a record key

GRWL's `ID` numbers a segment within its own Landsat tile and repeats across
the world: **350 distinct values over 7,446 pieces at z0**. `OBJECTID` is the
one unique key, so the bake writes that as `id` and the card calls it
"GRWL record", not "segment". `nSegPx` is carried as `measurements`, the
number of width readings behind the median. Before this, two unrelated
rivers could show the same id on their cards.
## The TEMP and PRESSURE readouts read a reanalysis, not a formula

Before, they were 27 − 40·sin²(lat) minus a lapse rate, and a barometric curve
off 101,325 Pa. Every place at one latitude and height was the same place.
They also read the height from the streamed DEM, which reports the SEABED over
the ocean, so a cursor over deep tropical sea applied the lapse rate from
−4,000 m and said about +50 °C.

`gis/climate-normals.js` reads NASA POWER's MERRA-2 climatology instead: 2 m
temperature and surface pressure, 2001–2020 annual means, on MERRA-2's own
0.5° × 0.625° grid. `services/bake-climate.py` writes it to
`data/global/climate-normals.json`, which is published gzipped. It then
DOWNSCALES to the ground under the cursor:

    T(z) = T_cell − 6.5 K/km · (z − z_cell)
    p(z) = p_cell · exp(−g (z − z_cell) / (R_d · T̄))

- **The grid cell's OWN height is the whole trick.** A cell's mean describes
  the cell's mean height, so a summit inside it is colder by the height it
  stands above THAT, not above sea level. POWER hands every cell's elevation
  over as the third coordinate of each point, which is why this source and
  not another.
- **At sea the surface is the sea.** A negative DEM height is read as the
  sea surface unless the cell around it stands more than 50 m up, which is
  what a depression is: the Dead Sea (−430 m) keeps its depth and the
  Caspian (−28 m) reads as water, which costs 0.2 °C.
- **Why POWER.** ERA5 needs a CDS key, WorldClim forbids redistribution,
  NCEP's long-term means are 1.9°, and POWER's analysis-ready Zarr on AWS
  answers 403. The API refuses two parameters in one request, so the bake
  makes 1,296 requests one at a time and caches each one on disk.
- **The readout's context line says which it is**: "EARTH SURFACE · MEAN
  2001–2020" or "SEA SURFACE · MEAN 2001–2020", and "ESTIMATED" for the
  second or so before the grid lands.

**The map is the same function over a grid.** Earth System ▸ Atmosphere
carries two catalogue rows, one for mean temperature and one for mean
pressure. They are new readings in `dem-layer.js`'s SHEETS, alongside
elevation, slope and hillshade, and `climateGrid()` is `readAt()` run over
the streamed DEM's grid. So the colour under the cursor and the number
beside it are one calculation at one height, not two estimates that happen
to be close. **The scale is FIXED** (−40 to +35 °C, 50 to 103 kPa). A
stretch to the view would paint two different climates the same colour in
two different views.

**The Surface Conditions temperature and pressure maps were dead code.**
Their PNGs 404, and `ALLOWED_BASEMAP_IDS` never offers them. They were not
revived. The real map is a layer.

`dem-layer.js`'s sheets grew three optional hooks to hold these:
- `prepare(bounds, w, h)` fetches what a reading needs besides the heights.
- `scale` gives a fixed ramp for the repaint and the key.
- `paint`/`status` give a reading its own colours and its own sentence.

A sheet can also carry its own `credit`. `rebuildSheet(kind)` rebuilds a
sheet whose INPUTS moved without the view moving. It waits out a build
already running rather than dropping the request.
## River corridor zones: sized by the river, cut by the terrain

Hydrology ▸ Water bodies ▸ "River corridor zones (GRWL)" draws three toggleable
incremental zones around every GRWL river. It is a reading of the streamed
DEM, like the sea level: `dem-layer.js` SHEETS `riverzones`, with the pure
half in `river-zones.js`. Each zone is measured from the MEAN-FLOW WATER
EDGE (the centreline plus half GRWL's width W, which is the width at mean
discharge):

| zone | reach from the bank | why |
| --- | --- | --- |
| seasonal margin | max(10 m, ¼ W) | low flow to bankfull: width ∝ Q^0.26 (Leopold & Maddock 1953) moves the edge 0.1–0.25 W a side; 10 m is the bank and the works strip (8 m non-tidal, 16 m tidal in England) |
| migration belt | 3 W | meander belts are 6–8 W wide, B ≈ 4.3 W^1.12 (Williams 1986); not for canals |
| floodplain | 10 W, AND ≤ 5 m above the nearest channel | HAND ≤ 5 m is the floodplain class (Nobre et al. 2011); distance alone paints valley sides |

- **Why relative, not fixed.** GRWL runs from 30 m streams to Amazon reaches
  kilometres wide. Seasonal stage is a VERTICAL swing, from under a metre on
  a small stream to 10–15 m on the Amazon, and its horizontal footprint
  scales with the channel. A fixed buffer is the whole valley of one river
  and less than the sandbars of another.
- **The transform runs per width band** (30/100/300/1,000/3,000 m). A
  cell's nearest river is not always the one whose zone covers it: a stream
  200 m away must not hide the floodplain of a 2 km river 5 km away. It is
  a two-pass nearest-source propagation in METRES, with the east–west step
  taken at the mean latitude of the two rows.
- **The sea and lakes are never painted**. They come from the same ocean
  and HydroLAKES masks the sea-level sheet uses. A reach GRWL flags as
  running through a lake is not a source.
- **A tick recolours; it does not rebuild** (19 ms, measured). The classes
  are unchanged when a zone is hidden, so `layer.repaint` and the legend
  follow the ticks.
- **A zone narrower than the view's cell is not drawn**, and the status line
  says so with the cell size. At 160 km over Memphis the cells are 270 m, so
  the Mississippi's 200 m margin shows only as an edge.

Measured over the Mississippi at 160 km: built in 4.3 s, with the margin at
116 km², the belt at 1,264 km² and the floodplain at 1,095 km², and the
floodplain following low ground rather than a band.
## River flood inundation: a stage from the river's own size, set by sliders

Hazards ▸ Flood ▸ "River flood inundation on the streamed DEM" (`inundation.js`,
a SHEET in `dem-layer.js`, controls in `flood-panel.js`). Every GRWL river's
water is raised by a stage and spread over the streamed heights through ground
that is under it and joined to the channel:

    D(W) = 0.27 (W/7.2)^0.6          Moody & Troutman (2002), Q eliminated
    rise = D(W)·((Q/Q̄)^f − 1) + e    at-a-station depth ∝ Q^f, f = 0.40
    flooded ⇔ h(c) < h(r) + rise, bank ≤ k·W, joined to the channel

**The global depth law is d = 0.27 Q^0.30, not 0.39.** I had it from memory as
0.39 and checked before building on it (quoted as Equations 1–2 in a NOAA
paper on channel dimensions): 0.39 would have made every depth, and so every
flood, the wrong size. Check a coefficient against a source before a model
rests on it.

**Scenarios are discharge ratios and they are ASSUMED**: seasonal high 2,
winter (annual, ≈ bankfull) 5, 1-in-10 8, 1-in-100 12.5 (growth factors 1.6
and 2.5, humid-temperate), flash 25 on channels ≤ 100 m. Every one is a slider,
and the drawer says in METRES what the setting does to a 50 m, 300 m and 2 km
river — a multiple of mean flow means nothing to most readers.

**Ground already below the river is not flooded every day, so something the
heights cannot see holds it.** The first run flooded 336 km² round Avignon at
the SEASONAL high, 117 km² of it over 3 m deep: the Rhône runs on levees above
the Camargue, and a narrow centreline cell also reads its bank high. Two
changes: the river's surface is the lowest ground in the 3×3 round its cell,
and ground below that surface is DEFENDED (left dry, counted, a toggle to fail
the defences). After: seasonal 18 km², winter 270, 1-in-100 533 with 76 km²
defended, 621 with defences failing.

**Only geometry is kept per view.** The per-band nearest-river fields are the
expensive part and do not depend on the flood, so a slider or scenario costs
arithmetic: 0.5 s a redraw against 5 s for the first build. Rivers just out of
shot flood in through the same one-link context as the corridor zones.

**Every plain `.button` in the sidebar is painted the accent** (`.button:not(.secondary)`,
`!important`), so `is-active` on a button shows nothing. A choice among
buttons uses the app's own pair: `secondary` for the rest, filled for the one.

**A flood has no hole where the river is.** The channel cells (bank ≤ 0) were
left unpainted as "water already", so every flood had a gap down its middle
exactly along the river — reported off a screenshot as the overlay missing
where the river shapefile would be. They now take the river's rise above its
normal level (the surface the banks see), and `floodAreas` leaves them out of
the flooded area and the deepest reading, since they are water every day.

**A coarse flood comes in as a LEVEL, interpolated.** The flood from rivers
just out of shot is computed on the context's coarse grid; pasting its depth
drew it as blocks a context cell wide, and reading its level at the coarse cell
alone still stopped it square at the coarse cell's edge. The level is
interpolated from whichever of the four surrounding coarse centres are under
water and read against the view's own heights, so the fine ground decides the
edge. A rebuild with the outer flood switched off is the A/B that showed the
squares were all from it.
## River flood by discharge: one river, a flow in m³/s

Hazards ▸ Flood ▸ "River flood by discharge" is the inundation model run for
ONE river at a discharge the reader sets — a `discharge` SHEET beside
`inundation` in `dem-layer.js`, its drawer (`#flood-discharge-controls`) wired
in `flood-panel.js`, the pure half in `inundation.js`.

- **GRWL names no rivers, so "this river" is traced.** `selectRiver` takes the
  river cell nearest the pick and grows through 8-joined cells within ×2.5 of
  its width: the river's own widening stays in, a tributary a fifth its size
  stays out (it carries its own flow). A known width (`pick.width`) keeps the
  same river on the coarse grid round the view, where a nearer river of another
  size may sit. Only that river seeds the flood; every other river keeps its
  normal level.
- **The mean flow is from width, and says so.** `meanFlowFromWidth` inverts
  Moody & Troutman's w = 7.2 Q^0.5. Measured on the Rhône at Avignon: 457 m
  wide → **4,020 m³/s estimated against ~1,700 gauged at Beaucaire** — an
  order of magnitude, as the drawer states. A typed gauge mean replaces it;
  blank goes back to the estimate. The discharge in m³/s is kept when the mean
  changes, so what changes is how big a flood that water is for this river.
- **Below its mean a river falls.** `stageRise` floors the ratio at 0.01, not
  at 1, so half the mean gives a negative rise and nothing floods.
- **The pick is a pointerup on the canvas, with a 4 px drag gate**, never a
  `stopPropagation` (OrbitControls needs the release), and
  `GeoIDFeaturePopup.suppress(800)` so the same click does not also raise a
  geology card. Escape stands it down.
- **The watcher rebuilds with no status callback**, so a drawer reporting what
  the last build found went stale on every pan. `build()` now dispatches
  `geoid-gis:sheet-built` (on `document`, guarded on the METHOD) and the drawer
  listens for its own kind.

Measured on 8125: the Rhône found at 457 m, 11,500 m³/s (the December 2003
peak) against a gauged 1,700 rising it 3.7 m and flooding 104 km² in view;
a real click on the Durance swapped the river to 84 m and left the Rhône at its
normal level.

### The flood carried in from out of shot was metres too deep — both sheets

The Durance read **12.2 m deepest on a 1.1 m rise**, and the cells were all at
the view's edge, which is the tell that they came from the coarse grid round
the view rather than from the view's own model. Two faults, shared by the
scenario sheet:

- **A channel cell's level was its own height plus its depth.** A centreline
  cell holds the bank and reads high — which is exactly why the fine model
  takes the lowest ground in the 3×3 as the river's surface — and `outerLevel`
  undid that for the level it handed on. `inundate` now returns `level`
  (surface + rise in the channel, height + depth on flooded ground) and
  `normal` (the river's normal level behind each wet cell), and `outerLevel`
  passes both through.
- **The merge had no defences.** Fine ground below the river's normal level
  is dry in the view's own model while the defences hold; read against the
  interpolated outer level it was flooded — every pit, quarry and neighbouring
  channel lower than the river the water came from. `mergeOuterDepth` takes
  `{ defended }` and interpolates `normal` at the same wet centres as `level`.

After: Durance deepest **1.1 m** on its 1.1 m rise, Rhône 3.0 on 2.9. With
defences holding, depth cannot exceed the rise, and now it does not. The
1-in-100 scenario over the same 40 km Rhône view reads **230 km², deepest
5.8 m** where it read 533 km² before — the earlier figures in this file were
inflated by this fault.



"Certain events' click radius covers other points." The event picker was a
raycaster with `params.Points.threshold = camera.position.length() / height *
12` — the camera's distance to the planet's CENTRE, which stays about 3.2 units
however close the ground is. Measured 60 km above an Oklahoma wildfire: a reach
of **99 km, about 1,553 px**, wider than the screen, so that one marker took
every click in view — and because `markerAt` is asked FIRST by the other
pickers (so one click raises one card), it also took clicks meant for volcano
dots and polygons beside it. It also returned the first hit along the ray, not
the marker nearest the cursor.

`markerAt` is a screen-space test now: every visible marker projected from its
`truePositions` (far side dropped by the tangent-plane test), a hit circle on
its INK at its drawn size (`markerHitGeometry`: a glyph stands on its point,
its centre 0.23 of the sprite above it; the quake rings are centred), and the
nearest centre wins (`nearestHit`). Measured after: hit on the ink and on the
coordinate, hit 1 px inside the 16.3 px circle, nothing 2 px outside or 40 px
away.

**The vector point picker had the same fault in a milder form**: one radius for
every point layer, about 13 px of ground, so a 3.4 px fire detection answered
clicks far outside its dot. Each layer's reach is now half its widest
screen-sized point material plus 2 px, in metres through the camera's own
field of view (`pointReachPx`, `layerPointTolerance`). The lines' 30 m floor
does not apply to points: close in it is hundreds of pixels.
## The flood is the slope model's other half: one rainfall map, two hazards

"Use the hydrogeological model along with river channel data to produce a flood
FOS model." It is not a second pipeline. **The slope model already computes the
water the ground cannot take**, and it was throwing it away:

    r = min(P/Δt, Ks)          the recharge cap — what it turns away is Horton runoff
    W = steadyWetness(...)     held at 1 exactly where the hillslope is full
    e = (P/Δt − r) + r·W       infiltration excess + saturation excess (Dunne)

`partition()` in `flood-fos.js` is that one line, and `infiltrated + runoff = P`
at every wetness is pinned. So the two hazards cannot disagree about the storm:
where the slope model says the ground is saturated, the flood model is fed the
rain that lands there. A separate flood pipeline would have fetched the rain
twice (a GEE render is billed), read the DEM twice, filled the sinks twice,
built the topology twice — and double-counted the storm's water.

**A FLOOD IS A WAVE, so the maps must be walked in ORDER.** A linear-reservoir
cascade per cell over the same MFD topology, marched once inside `run()`:

    S(t+Δt) = S·a + u·k·(1 − a),   a = e^(−Δt/k),   Q = (S + u·Δt − S′)/Δt

That is the **exact integral** for a constant arrival over the step, and it had
to be: the first version dumped the step's water in and released a share of the
total, so a reservoir under steady rain settled on `I·a/(1−a)` instead of `u·k`.
Measured, hourly steps released 4 % more water and held **65 % less** than the
same ten hours at five-minute steps — a model whose answer depended on how
finely somebody happened to sample the forecast. The Δt-independence check is
what caught it and is pinned in both `flood-fos.test.mjs` and
`equations.test.mjs`.

**The residence time is a property of the CHANNEL, not of the storm.**
Eliminating Q from `w = 7.2 Q^0.5` and `d = 0.27 Q^0.3` — the same Moody &
Troutman relations `inundation.js` already uses — gives `v = Q/(w·d) =
0.514 Q^0.2`, and 0.5 + 0.3 + 0.2 = 1 is Leopold & Maddock's closure, which the
test checks as arithmetic rather than trusting. A channel cell takes its own
**bankfull** discharge, so `k` is fixed once from the ground; a hillslope cell
takes `k_v·√(sin β)`. (My first equations pin compared `cellVelocity(capacity)`
against `Q/(w·d)` at the MEAN flow and read as a 38 % error in the code — the
code was right and the assertion was evaluated at the wrong discharge.)

**FoS = Q_bankfull / Q**, with `Q_bankfull = 5 × meanFlowFromWidth(width)` —
the same "annual flood ≈ bankfull" multiple the inundation scenarios use, so a
forecast flood and a scenario flood speak one language. The stage above it goes
through `inundate`'s own connectivity and defences: `riseAt` is a new optional
argument and `riseFrom(s, w)` the single helper both paths read, so there is
ONE inundation rather than a second copy that drifts.

**Storage: per-frame discharge at RIVER CELLS ONLY** (thousands, not millions),
so scrubbing the bar after a run is free. The full-grid Q map is never kept.

### A catchment is closed under donors, and that is what a station rests on

A sampling station cannot re-route two million cells per map. It does not have
to: **if a cell's water reaches the station, so does the water of every cell
draining into it**, so a march over the catchment alone reproduces the whole
grid's answer at the station exactly. `catchmentTopology` builds the
sub-topology in LOCAL indices (`upslopeWeights`' `idx` is already in the
topological order, which is what makes the local march a forward loop), each
station keeps its own `store`, and one `floodScratch` sized to the largest
catchment is shared.

Pinned by running both: the station's discharge against a whole-grid
`routeFlux` + `steadyWetness` + `partition` + `waveStep`, from rest, over two
frames so the reservoir stores have to agree as well as the arrivals. **`routeFlux`
does not mutate its source unless asked** — the first version of that check read
the UNROUTED recharge and reported a 5.4× disagreement that was entirely the
test's.

**Off a channel there is no bankfull capacity**, so `floodFos` and `stage` are
NaN rather than invented, and that is pinned too: a stage over dry ground is a
number nobody could act on.

### Two pins had to be re-argued rather than deleted

The flood work broke two checks in `landslide-stations.test.mjs`, and both were
guarding a decision that had genuinely changed:

- `import { cellAnswer, planeWetness, slopeStresses }` matched the whole import
  list; `stationFlood` legitimately needs `steadyWetness` beside them. The pin
  is about ONE `cellAnswer` being shared, so it matches that name inside the
  list rather than the list.
- "every recorded variable is finite" ran `stationStep` alone — the SLOPE half.
  What the page records is the merge of `stationStep` and `stationFlood`, which
  is what `recordStations` does, so that is what the pin now checks.

### The subtab is no longer a landslide product — and that was the wrong call

Three failure models from one storm, so the flowchart was given its own Hazards
subtab ("Storm hazards") rather than nesting under Landslides, on the argument
that a flood forecast filed under landslides is the "one dataset, one home"
fault.

**Reverted, on report: "why isn't the landslide/rockfall risk mapping procedure
implemented within the landslide tab? should be there in full."** The argument
is true of the MODEL and wrong about the READER. The soil slide and the rock
slope are what this pipeline is FOR — it is `landslide-pipeline.js`, its layer
is "Landslide risk — forecast" — and the channel flood is what the same
rainfall and the same water balance also yield on the way. Somebody looking for
the landslide procedure opens Landslides, finds a worked example of it
(NI prototype) and concludes the procedure is not built.

So it sits in the Landslides subtab, FIRST, with the NI prototype nested under
it, and Landslides is collapsed so nothing opens eight cards deep uninvited.
**The host id `#landslide-pipeline` is unchanged** through both moves: an id is
a storage key. The "storm hazards" glyph went with the subtab.

The general form, since this file keeps arriving at the taxonomy from the other
side: **"one dataset, one home" decides where a thing may appear TWICE, not
which home it gets.** Which home is a question about what a reader came looking
for, and the answer to that is the product's own name.

### A long-lived `python3 -m http.server` wedges, and every UI check then lies

`tests/ui.py` came back **4 failed** — "earth: the page answered — no result"
and, on Mars, every seam absent, 0 of 49 tools shown, no style tag. That is the
shape of an app that has stopped booting, and none of it was true: the dev
server had been up for eight hours and was **accepting connections and closing
them without a reply** (`curl: (52) Empty reply from server`, while `ss` still
showed it LISTENing, so "is the port up" answers yes). Restarted, the same tree
measured **14 passed, 0 failed**.

Two things worth keeping. `ss -ltn` showing a listener is not evidence the
server answers — probe it with a real request before believing a page-level
failure. And when a structural check reports that a whole page has no seams, no
styles and no tools, suspect the transport before the code: a change to one
subtab cannot remove `GeoIDViewer` from a planet nobody touched.
## The flood ran on the wrong cells, and three faults stood between it and a number

The flood model went in complete and untested against real ground, and the
first live run died on its first frame. Everything below was found by running
it, not by reading it.

### An answer must carry the input the next stage reads off it

`modelFrame` built the static answer, then called `splitRain(out, frame)` — the
pass that works out what the ground could not take — and `splitRain` read the
rainfall map off `out.rainMm`, which `modelFrame` attached only to the object it
returned afterwards. So **every run died on frame 0** with
`Cannot read properties of undefined (reading '0')`, and the flood half never
ran once. `staticStep`'s answer carries the map it was fed now, which is a seam
a test can hold; the pin fails on the exact fault.

**A caught error has no stack anywhere**, so none of this was visible: the run's
`catch` prints `error.message` and the object is gone. Two diagnostic traps cost
most of the hunt:

- **A MutationObserver's callback is a microtask, so it BATCHES.** Watching the
  status line recorded only the error, and I read that as "it threw before the
  first `say`" — it means nothing of the kind. Every synchronous mutation up to
  the first `await` is delivered in one callback.
- **`clear()` re-renders, so the node being observed is detached** before the
  run writes to it.

What settled it in one reload: add `console.error(error)` to the catch, confirm
the DEV SERVER is serving the edited file (`fetch(url, {cache:"reload"})` and
grep the text — `python3 -m http.server` revalidates on Last-Modified, so an
edit reaches a reloaded page at the same `?v=`), reload, re-run, read the stack
off a wrapped `console.error`. Remove it before committing.

### THE WATER IS ROUTED DOWN THE RIVERS THAT ARE THERE

Measured on the Rhône at Avignon, the **474 m river's own burned cell had a
contributing area of ONE CELL**. GRWL's centrelines are a survey; a flow network
from heights alone is an inference, and on a floodplain the DEM's drainage line
wanders a few posts to the side of the channel. The channel model was reading
discharge at cells no water passes through, and calling 42 m³/s the peak on a
river that carries thousands — under a bankfull capacity of 20,100 m³/s, so the
map said "well within bank" whatever the storm did.

The mapped network is **burned into the heights** (a uniform `RIVER_BURN_M`
drop) before `fillSinks` and `mfdTopology`, which is why the rivers are fetched
by the ground read rather than by `buildFlood` — that now reuses them. After:
the same cell drains **206,004 cells**, and the grid's largest catchment is on
the 474 m river rather than beside it.

**The trench belongs to the routing and to nothing else.** Slope comes from the
DEM's own posts, the flood depth from the unburned band, and the filled surface
`rockfallReach` reads has the burn **added straight back** at the cells it was
taken from — a hundred-metre canyon down every river would otherwise hand a
falling block a gorge to run into. The burn is uniform so the channel keeps its
own downstream gradient, and `fillSinks` cannot fill a trench that drains off
the grid.

### A river cell reports its REACH, by snapping to the thalweg

A 474 m river at 18 m posts is twenty-six cells across and the flow is in one
line down the trench; the cells beside it drain their own few metres of bank. So
every river cell takes its discharge and its provenance from the nearest cell of
its own reach that the ground actually drains through, and a station clicked on
a river snaps the same way — a click lands anywhere across a burned width.

- **Nearest, not largest.** Accumulation grows downstream, so the window's
  maximum snaps every cell to the far end of its own window and walks the whole
  reach's discharge half a width down the river. A bank cell carries a few
  cells' worth against the channel's thousands, so half the window's maximum
  separates the two by orders of magnitude and the tie is broken by distance —
  which leaves a channel cell reporting itself. The test pins both.
- **Spreading a flag along connected river cells was tried and is WRONG**, and
  the Ardèche said so: a network is connected all the way to its trunk, so
  headwaters whose catchment really is inside the area were made open by joining
  the Rhône twenty kilometres downstream. Openness travels DOWNSTREAM with the
  water; what the side cells needed was snapping, not spreading.

### A factor of safety is only worth the basin behind it

The model routes only the rain that fell on the ground it mapped, while a brim
read from a river's WIDTH is the brim of a channel cut by its whole basin.
Comparing the two where the study area is smaller than the catchment is an
artefact of where the box was drawn.

`openCatchments` is the exact test: a cell is OPEN when water can reach it from
outside the mapped ground — seeded on every data cell at the edge of the data
region and pushed downslope over the same MFD topology the water takes, one
pass. An open reach keeps its **discharge as a lower bound** and is given **no
factor of safety**, with a class of its own on the map, a sentence on the
channel card, a line on the cell card and a column in the station CSV.

**The peak discharge is taken BEFORE the brim is withheld.** It was inside the
same skip, so the report read "peak discharge 0 m³/s" over a map plainly
carrying tens.

**What the flag cannot catch is a FRAGMENT** — a reach whose basin lies wholly
outside the data region, so no inflow crosses into it and it reads as closed.
Measured near Montélimar, GRWL calls one reach 393 m wide and the model drains
11 km² to it; against a 14,900 m³/s brim that is "well within bank" for ever.
There is no relation-free gate for it: a width-to-flow law has an order of
magnitude of scatter and would withhold the real rivers too. So the number is
put where a reader can weigh it — every river cell carries **the ground the
model routes to its reach**, on the cell card beside the discharge and the brim,
in the station CSV, and on the channel card, which names the widest reach the
model will answer for with its catchment area.

### What it measures, once it is measuring the right cells

The Ardèche basin, 63 × 83 km at 58 m posts, GFS every 3 h over the October 2024
Cévennes event (up to 55 mm in 24 h at the model's blocks, 88 mm at a node):

| | |
| --- | --- |
| river cells with a whole catchment | **1,216 of 3,480** |
| over their brim at the worst map | **343**, and 347 at some point |
| peak discharge | **651 m³/s** |
| the channel's worst map | **9 h after the wettest** — the catchment's lag |
| soil / rock-slope cells below FoS 1 | 28 / 0, 49 at some point |
| rockfall | 27 source cells, 120 within reach |
| runoff | up to **100%** — the ground is full |

Every key accounts for its cells exactly once (floodfos and minfloodfos both sum
to 3,480; runoff to the 1,539,615 modelled cells), and a cell card reads
*"54 m wide (GRWL); 284.0 m³/s arriving from the 616.2 km² the model routes to
this reach. FoS 0.99 against a 281 m³/s brim"* — 0.46 m³/s per km², which is a
Cévennes flash flood. The open twin reads *"393 m wide; 50.6 m³/s from 274.9 km²
… no factor of safety here"*.

**The station and the map agree at the same cell to the digit** (3.4 against
3.4), which is the closed-under-donors invariant holding live rather than only
in the suite — and it was how the 393 m fragment was found, because the number
they agreed on was absurd for the river GRWL had drawn.

**Read a probe's fields before believing its answer.** `station.cell` does not
exist — a station carries `lat`/`lon` and the cell is looked up — and
`JSON` drops `undefined`, so the probe returned `sameAsCell: true` from
`undefined === undefined` and sent the hunt after a phantom for a round. And the
pipeline's card is `#geo-popup`, not `#scene-popup`: a probe that reads the
wrong one reports "no card" over a card that is open.
## Watershed and runoff (Hazards ▸ Flood)

`gis/catchment.js` holds the pure half, with 27 checks against closed forms;
`gis/watershed-panel.js` is the subtab. Pick an outlet and the catchment is
extracted by **D8 on the sink-filled streamed DEM**. D8 rather than MFD,
because a catchment boundary is hard: a cell drains to the outlet or it does
not.
- **The outlet is snapped** to the largest accumulation within a radius, and a
  basin under 1 km² is reported as a probable miss rather than presented.
- **The box doubles until the basin no longer touches its edge**, up to "Search
  up to". A basin still touching the edge is reported CLIPPED.

Four layers:
- **catchment** — an outline traced along cell edges, so it holds exactly the
  masked cells
- **stream network** — Strahler order, reaches cut at junctions
- **flow vectors** — about 900 arrows, coloured by travel time
- **runoff (animated)** — an adopted `THREE.Points` in the imported geo group

Runoff is the SCS curve number and a **time–area hydrograph**, linear and
unrouted, and the panel says so. Velocities are TR-55 shallow concentrated
flow (`v = K·√S`) on hillslopes and a channel velocity on streams. The
particles are released at spawn times drawn from the rain excess and carried
down the D8 paths at each cell's velocity, in step with a marker on the
hydrograph.

- **The sea is not ground.** A coastal outlet at −1 m routed the flat sea into
  itself: on the Shimna at Newcastle it returned 160 km², clipped at 30 km.
  Ocean cells (`water-mask.js`) become no-data, so the coast is where water
  leaves. GRWL rivers are burned 20 m in before routing, and stats read the
  unburned heights.
- **A particle waiting to spawn goes past the far plane**, not to a zero
  direction: with the depth test off, the planet's centre is drawn.
- **Measured** on the Shimna (snap 1,200 m): 36.2 km², relief 846 m (Slieve
  Donard), longest path 15.1 km, Strahler 3, time of concentration 165 min on
  the model's velocities against Kirpich's 116. A 50 mm / 3 h storm at CN 75
  gives 9.3 mm of runoff. The hydrograph volume is 336,100 m³, which matches
  9.3 mm × 36.19 km² = 336,600 m³. Particles drew 7,491 framebuffer pixels in
  an A/B with the layer hidden.
- `GeoIDLayerHierarchy.setVisible` takes the LAYER OBJECT, not its id: passing
  an id throws "Cannot create property 'visible' on number".
## People exposed (Hazards ▸ Exposure)

The pieces:
- `gis/exposure.js` is the pure half (21 checks).
- `gis/exposure-panel.js` is the panel.
- `gis/exposure-annotation.js` is the label over the area.
- `worldpop.js` gains `readCounts`, the native-resolution counts.
- The landslide pipeline gains an `exposureSource()` seam.

Pick a study area and any hazard on the globe:
- **A raster layer** (the factor of safety, flood depth): people by class, the
  area's people counted on the hazard's own cells, and the part the grid does
  not reach reported apart.
- **Any layer whose features carry `p_yr`** (cyclone, seismic and volcanic
  risk): expected people reached a year (Σ people × p) and people by return
  period.
- **"Landslide forecast — every map"**: people on failing and marginal ground
  map by map, plotted with a CSV. The annotation over the area follows the
  time-lapse step.

- **A hazard cell takes its AREA SHARE of its population cell's count**, not
  the count divided by however many hazard cells sit inside it. The second is
  exact where a grid covers whole cells and INFLATES every edge where it stops
  part-way. On a 10 km landslide sub-grid it measured 5,956 people against
  3,117 from the same model's margin grid; with area shares both read 3,094.
  Pinned: a grid over half a population cell takes half its people.
- **Counting whole 1 km cells by their centres** read 2,386 for the same
  box. The panel uses it only for the part of a polygon a hazard grid does
  not cover.
- **`fosAt(k)` recomputes a map through `modelFrame`**, which writes the
  ground's SHARED scratch buffers, the arrays the globe's map is painted
  from. Callers must `restore()`, which re-shows the step the reader was on.
- A long series is strided to at most 120 integrated maps, and the panel says
  so.
- **A first range read against a cold bucket can fail** with "Request
  failed" where the same read a moment later succeeds, so `countsUnder`
  retries once.
- Verified on Miami's cyclone risk: 2.41 million people in the box, 1.47
  million reached in an average year (p = 1 − e^−0.95 = 0.61), all in the
  "more often than 1 in 2 years" class. On a Mournes forecast, 28 maps were
  integrated in 3.5 s, the step was restored, and the annotation date followed
  `showStep`.
## The risk reader: every risk map is read for people as it is developed

The analytics left the Exposure tab. `gis/risk-reader.js` is the engine,
`risk-reader-view.js` the one way an assessment is shown, and
`risk-reader-window.js` a draggable window with a TAB PER MAP. Doors: automatic,
the Workspace header's shield (badge = maps read), "Risk to people" in any
readable layer's drawer, and Hazards ▸ Exposure, which is now a thin door plus
the forecast-as-series it alone holds.

- **What kind of map is read off the map** (`riskMapKind`): the forecast (by
  name AND a live `exposureSource`), a flood/FoS grid (by name), river corridor
  zones, any `p_yr` grid (cyclone/seismic/volcanic by columns), volcanic
  buffers (`zone` + `outer_km`), storm tracks (`peak_wind_kts`) — or VALUE
  BANDS for any other raster, which is `auto: false`: read from its drawer only,
  because banding a DEM unasked is noise.
- **Which ground** (`autoArea`): the drawn area (live overlay, else the last
  drawn polygon), else the forecast's own area, else a raster's own extent if it
  is local (≤ 6°), else nothing — the tab says "draw a study area" rather than
  reading a continent. The report and the view say when the map's own extent
  was used.
- **When**: import-manager `onChange`, `geoid-gis:sheet-built`, a 700 ms poll of
  the forecast's step (it announces nothing), and `geoid-study-area-edited`
  debounced 1.5 s (a drag announces on every pointermove). A tab re-reads when
  its signature changes (layer id, band length, feature count, active view,
  forecast step). The window OPENS for a newly read map only; updates re-read
  in place. One reading at a time; WorldPop counts cached per box.
- **A flood sheet and the river zones write no-data for "nothing here"** (dry
  ground, no zone — `NO_DATA = -32768`). Read as no-data, everyone on dry land
  inside the sheet is "no reading"; the engine reads it as zero (not exposed)
  and keeps "no reading" for ground off the sheet. The landslide FoS keeps its
  no-data as no reading: there it means "not modelled".
- The forecast tab reads BOTH the map on screen and each cell's lowest FoS over
  the window, and re-reads as the time-lapse steps.
- **Cyclone risk is membership-gated**: with no unlock key the tick does
  nothing visible and no tab ever appears — check the layer list before
  debugging the reader.

Verified live: a drawn Miami box, cyclone risk ticked → the window opened by
itself with 2,096,125 people, 100% "p ≥ 0.5"; a flood-depth raster imported →
a second tab, active, 275,821 / 1,044,473 / 446,650 / 217,640 / 101,167 by
level; redrawing the area re-read both (852,522 and 875,014 — the probability
path counts population cell centres, the grid path shares cells by area); a
zones layer shaped like the volcanic buffers read by zone; the drawer door on
the flood layer reopened the closed window on its tab and was absent on the
plate boundaries.

### The reader follows the map you touch, and a tab is a hazard, not a layer

A tab per LAYER showed one hazard twice, e.g. the cyclone grid beside the estimate sheet that stands in for it, or a record's collective beside its frame plot. It also left the window on whichever map was read last. So now:

- **Tabs are keyed by `hazardKey`**:
  - `forecast`;
  - `record:<spec id>`, matched through `riskRecord` or through the spec's `name`/`plotName` in `globalThis.__geoidRiskSpecs`;
  - `cyclone-risk`;
  - otherwise `layer:<name>`.
- **"Reading from" picks the member.** It appears only when a tab has more than one member. `readableMember` chooses a hand pick first, then a shown framed layer (`riskFrame`/`riskRecord`), then any shown layer.
- **The follow rule is `chooseFollowed`, which is pure and pinned:**
  1. a tab chosen by hand;
  2. otherwise the shown map touched last, while the touch is under 90 s old;
  3. otherwise the top map in view: the highest `renderOrder` whose read area meets `visibleBounds`, re-evaluated when the view settles;
  4. otherwise the most severe map.
- **A hand-chosen tab holds until another map is touched.** "Follow the globe" returns to automatic.
- **What counts as a touch:**
  - `geoid-gis:layer-touched` from `card-owner`, when a card claims its layer;
  - a click inside `#layer-dock [data-layer-id]` or `#map-legend-panel [data-legend-key]`, delegated in capture. Note that a static legend card has no `.legend-entry-head`, so the click is keyed on the card itself;
  - a layer being shown again;
  - a new map;
  - a signature part changing: `view` (a symbology reading) or `frame` (`riskBand`, `riskFrame.label`, the forecast step). A change to the `rebuilt` part re-reads the map without touching it, because a sheet refining is not something a person did.
- **The estimate sheet carries the band it draws** as `layer.riskFrame {values, width, height, scale: 255, label, last}`. `assessRisk` reads the primary chance from it, and says the secondary readings are the full record.
- **The indices are 0-based.** The last band is the still map, so its frame label is null.
- **A hidden map keeps its reading.** `enqueue` refuses a hidden tab and marks it stale. Showing the map again re-reads it only if it is stale.
- **A tab going grey is not a change of follow**, so `scan` must redraw the tabs itself. The first build only redrew them when the followed tab changed, so a hidden map's chip stayed coloured.
- **The window opens by itself once per session** (sessionStorage `geoid-gis:risk-reader-opened`). After that, new maps pulse the shield.

Verified live: a Miami box with cyclone risk gave one tab holding both layers and the chooser shown. Stepping the bar to 2006 read "Following Cyclone risk — 2006 — the estimate after 27 seasons · its frame stepped". A flood `.asc` added a tab. Hiding both cyclone layers greyed that tab with its reading kept, and showing it again triggered no re-read. A legend click, a Workspace row click and a tab pin with "Follow the globe" each behaved as designed. A map arriving while the window was shut pulsed the shield and left the window shut.

### A tab per study area, a row per hazard map over it

Reported as "the Risk to people button and pop-up serve no function". Measured
before the rework: with a drawn Naples study area and a raised sea on the
globe, the window said "No risk map on the globe yet". Sea level was not a
hazard the reader knew, and only the LAST drawn polygon was ever read.

The window is now organised by the thing a reader drew:

- **A tab per study area.** `studyAreas()` lists every shown drawn polygon
  layer (`layer:<id>`), plus the live drawing where its box differs. With
  nothing drawn, the ground in view is read, as before.
- **A row per hazard map that reaches it.** `coversBox` is the test, and a
  global vector map reaches an area only where one of its own features does,
  never by its whole-world bounds. A map that has moved off an area (a sheet
  rebuilt over another view) keeps its last reading, marked.
- **Every row is read through `assessOver(layer, area)`**, the same dispatch
  `assessLayer` uses.

Sea level gained its own scheme (depth of sea over land dry today), and its
dry ground is a reading of zero, like the flood sheets. A FALLING sea draws
seabed, which is nobody's home, so `riskMapKind` refuses it by its legend
label.

**A map too coarse to see the area says so.** Loading a global dataset zooms
the camera out, the view-built sheets rebuild at half-degree cells, and a
20 km area fell between their centres and read "0 people". It now throws
"Too coarse here … zoom in", and the reading is retried when the sheet
rebuilds.

**A HAZARD GRID NOT FINER THAN WORLDPOP IS READ AT THE PEOPLE'S CELLS.**
`peopleOnGrid`'s coarse branch hands each hazard cell the WHOLE population
cells whose centres fall in it. Masked by hazard-cell centre, a top row of
hazard cells centred inside the area then takes a whole row of people from
outside it. Measured on a 22 x 16 km Amalfi coast box, through a sea-level
sheet only 1.14 times coarser than WorldPop: **170,554 people against 110,233**.
The densest row of the Sorrento plain, just north of the box, held 103,182 of
them.

`readsAtPopulation(pop, grid)` decides: at or above half a population cell of
area, each population cell whose centre is inside the area looks the hazard up
under that centre (`gridValueAt`). That is exactly how a risk polygon map is
read, so the rows of one area agree. After: 110,233 on all four rows. Below it,
the grid's own cells are the better edge. At 330 m cells the same box reads
119,282, an 8% edge difference rather than whole rows. The forecast's
worst-map reading goes through the same `readAlso`, so it cannot differ from
the map-on-screen reading beside it.

**A touched map brings its area forward.** Touching a legend card or a
Workspace row opens that map's row in every area it reaches. When the area on
screen is not one of them, the first that is comes forward. A touch that
changes nothing visible reads as a map with no reading.

### The FEM results are in the Model page's Visibility box

The box listed the studio's own domains and mesh, but not the GALES results drawn over them, so there was no way to hide those results from where everything else is hidden.

- **`GeoIDMeshStudio.registerVisibility(id, provider)` is the seam.** A provider returns a group of parts, or null when it has nothing open, and `refreshVisibility()` redraws the box. An external group gets eyes and counts, but no part card.
- **Each results part sits in its own group:** surface, slice/clip cut, mesh edges, and points/probes. `refresh()` sets the surface, slice and edges meshes visible by the display choice on every step, so a switch written onto the mesh itself was undone by the next step. The group above each mesh holds the reader's choice and nothing else.
- **A part arrives visible when it first appears** (a slice shown, a first point placed). A "Hide results" pressed before that part existed was not about it.
- **The legend, the ground lattice's hole, the probe raycast and the panel's Hide/Show button** all read the part groups, so they stay in step with the box.
- **The box is redrawn when its title or rows change**, never on every step of a play.
- **Also fixed:** `partVisible` passed a layer id to `GeoIDLayerHierarchy.setVisible`, which takes the layer object.

Verified live with the Etna run (mesh_4core plus two steps of u, opened through `GeoIDGalesResults.openFolder`):
- The box lists "FEM results — solid/u".
- The surface switched off stayed off through a refresh.
- The master eye and the Hide/Show button agree.
- Switching to Both lists "Slice / clip cut", visible.
## The master key is a card, and exposure is a property of every risk map

**"To test the live member functions we need a master key for ourselves and
to store the GEE keys etc."** Membership's development unlock
(`localStorage["geoid:unlock"] = "owner"`) had always existed and was only
ever set from a console — and every test stint cleared it, which is what
"wiped" the Earth Engine endpoint: `credential-wipe.js` and `gee.js` clear
stored credentials only where `may("gee")` is false, so with the unlock in
place they keep them. Settings ▸ **Master key** (`gis/master-key.js`, on
every world) is the door now: the key makes this browser the master account
until "Lock again", the endpoint, sidecar and hub stay stored, and **"Wipe
everything before going live"** removes the unlock and every stored
credential in one press — the only version of that instruction that gets
followed on the day. The key is the fixed word membership already reads; a
browser cannot hold a secret and this page is public, so it weakens nothing
the module's own header does not already call a courtesy. The Earth Engine
endpoint needs no storing: `gee.js` carries the deployed function's address
as its default and only refuses it while locked.

**"The Risk to people button shouldn't exist — exposure is always
estimated."** The drawer's button was a second door to a reading the risk
reader already made unasked; it is gone, and the reading no longer needs a
drawn area: `autoArea` falls through drawn → the forecast's box → the map's
own extent (≤ 6°) → **the ground in view** (≤ 15°), and a tab read over the
view is read again where the view settles, as the map's own refine is.
Wider than 15° is a continent and is refused with a sentence that says to
zoom in or draw. Measured over Miami at 382 km with nothing drawn and the
cyclone risk ticked: **9,549,751 people in 224,084 km² of view, 6,088,524
reached in an average year**, read at the layer's arrival and again after
the camera moved.

Two shapes of one box, again: the window keeps the view as `{west, east,
south, north}` and `chooseFollowed` takes `[minLon, maxLon, minLat, maxLat]`
— the first `viewArea` read the array alone and the view never counted.
And the box a read uses is the camera's NOW (`readView()` inside the read),
not the last settle's, which before the first settle was null.

**`tests/ui.py` run BESIDE the unit suite fails on Mars, differently each
time** ("no style tag", then "absent: GeoIDLayerHierarchy") and passes 14 of
14 alone, twice. Headless Chrome booting a planet page under the suite's
load is a boot race, not a fault in either seam; run the two in sequence,
and read a Mars-only structural failure as load before reading it as code.
## Total risk here: one factor of safety from every model that can answer for a place

Hazards ▸ myGeoID ▸ "Total risk here" (`total-risk.js`, pure, 25 checks;
`total-risk-panel.js` gathers). Every hazard is a DEMAND over its own capacity,
h = demand / capacity (1 = act), and the total is FoS = 1 / Σ wᵢ hᵢ — a linear
interaction rule, so two hazards each at half their capacity make a total of 1.
Classes: act < 1, watch < 1.5, aware < 3, low.

- **A forecast is discounted for its lead**: ×1 inside a day, then
  exp(−(lead − 24)/48). A risk map's yearly chance is read over the horizon,
  P = 1 − exp(−p_yr·hours/8766), against a 10% reference.
- **Weather levels are the hazard sheets' own** (rain 50 mm/24 h, gust
  24.5 m/s, heat 39 °C, cold −25, snow 10 cm, CAPE 2500), pinned against
  `flow-layer.js`. The lead of a 24 h total is the first WET hour of its worst
  window, not the window's start.
- **What it gathers**, each through the seam that owns it: the GFS point
  forecast (fetched here), `GeoIDCycloneForecast.threatAt` (a Holland-type
  decay from the centre, zero distance inside the cone), aftershocks from the
  live USGS feed (Reasenberg & Jones, M ≥ 5.5 in 30 days, the magnitude that
  reaches the place from log₁₀R = 0.5M − 1.7), an eruption or a fire nearby
  from EONET, the slope from myGeoID's run (`GeoIDMode.fosNear`, nearest cell,
  worst step in the window) or the forecast pipeline
  (`GeoIDLandslidePipeline.lowestAt`), whichever is worse, and any risk map on
  the globe whose cells carry `p_yr`.
- **What did not answer is listed with what would let it** — "switch on Live
  Events", "tick a risk map" — rather than read as safe.
- **A weight is a control**, 0–3, kept per browser; changing one recombines
  the readings in hand and fetches nothing.

Verified on 8125 with a mocked forecast (12 h of 8 mm/h and 31 m/s gusts,
30 h out): rain 1.73, gust 1.14, CAPE 0.65 → FoS 0.31 "Act", main danger rain
at 54%; rain's weight set to 0 → 0.68 with no refetch.

### The total is summed HOUR BY HOUR, and the score is the worst hour

The first build added each model's own worst moment, so rain on day 1 and a
gale on day 3 were scored as one storm. `combineInTime` sums every model's
demand per hour, each discounted for that hour's lead, and takes the worst:

    H(t) = Σ wᵢ hᵢ(t) · imminence(t − now) ,   FoS = 1 / max_t H(t)

- **A term carries its own time**: weather terms an hourly `series` (24 h
  totals as the CENTRED sum, whose maximum equals the worst forward window's,
  so series and peak agree); a cyclone its forecast track, read hour by hour
  at each point's distance (the closest point at the centre where the place is
  in the cone); a river its flood-wave frames. A term with only a time holds
  its peak 12 h either side; one with no time (a risk map, an aftershock
  chance over the window, an open eruption) stands for the whole horizon.
- **What adding the peaks would have said is kept** (`peaksFos`) and the card
  says so when it differs; each row shows its demand at the worst hour and,
  in brackets, its own peak.
- **Fire weather** is a new model: the US NWS Red Flag thresholds (RH ≤ 15%
  with wind ≥ 11.2 m/s) as h = min(2, 15/RH) × min(2, wind/11.2), 0 in a wet
  hour. The weather half of fire danger only; the fuel is not known.
- **River flood** reads the forecast pipeline's own flood wave
  (`GeoIDLandslidePipeline.floodAt`): the nearest CLOSED reach within 2 km,
  its channel FoS = Q_bankfull / Q every frame. An open reach has no FoS on
  the map and none here.

Measured with a mocked forecast (fire weather at +10 h, 96 mm of rain at +30,
a gale at +55): the sum of peaks reads 0.25; the worst hour, +30 h, reads
0.43. A stubbed run with a 100 m³/s brim and a 160 m³/s peak reads FoS 0.63
at +6 h.

**Gaps that remain, and why they are not filled yet**: no storm-surge or wave
model (no surge forecast reachable from a page); no ensemble, so a GFS
deterministic run is read as certain (Open-Meteo's ensemble API is the way);
seismic and volcanic background count only if their risk maps are ticked;
ash fall from an open eruption is a 15 km circle, not a plume down the wind;
and the score is HAZARD, not risk — it does not know who or what is there.

### The rest of the gaps: the ensemble, the coast, ash, every risk map, people

- **The GFS ensemble** (`ensemble-api.open-meteo.com`, `models=gfs025`, 31
  members): `ensembleMembers` splits the `_memberNN` suffixes into whole
  forecasts, and `combineEnsemble` scores EVERY member hour by hour with the
  non-weather terms every future shares. A member's rain and wind are one
  storm, which is what keeps their co-occurrence honest. The card reads the
  member at a chosen quantile (90% by default — one future in ten worse, the
  characteristic value a code designs for; or the median, or the worst), says
  what share of futures reach act, and shades the ensemble's 10–90% band on
  the curve. Without the ensemble the single run is used and the card says it
  is being read as certain.
- **The coast**: the marine API asked at the place and eight points 10 km
  round it in one request; a land cell answers nulls, so the cells that answer
  say where the sea is. Waves: Hs / 4 m at the nearest sea cell. Surge
  SCREEN, per hour and per member: inverse barometer 0.0099 m/hPa below
  1013.25 plus the onshore wind's set-up C_d ρ_a u|u| L / (ρ_w g d) over a
  50 km × 25 m shelf, against 1 m; no tide. The waves are a single marine run
  shared by every member, and the card says so.
- **Ash**: an open EONET vent within 500 km is read down its forecast 500 hPa
  wind, hour by hour — a plume widening at 2 km + 0.15x, R/x on its axis with
  R = 50 km (1 mm from a VEI 3), nothing upwind. The 15 km circle became a
  10 km near-vent screen for ballistics and flows.
- **Every risk map, ticked or not** (`background-risk.js`): the cyclone,
  seismic and volcanic collectives from the bucket (fingerprinted, so cached
  after the first read), indexed by whole degree, the smallest containing
  cell answering. A map ticked on the globe is read where it is drawn and
  its grid is skipped, so a map is never counted twice.
- **People**: WorldPop within 1 and 5 km (`readCounts`, imported on demand
  under the module's own stamp, as the risk reader does), an exposure class
  from 5 km, and RISK = hazard level × exposure level on the 5 × 5 matrix.

Verified with every service mocked (no network in the sandbox): 13 readings,
ten storm futures in 31, the 90th-percentile member 0.24 against a median of
0.43 and the single run's 0.31, waves 1.1 at the nearest sea to the west, a
0.6 m surge screen, ash 1.25 while the wind blew toward the place, the seismic
and volcanic grids read untickled, and "Very high risk to people" at 21,900
within 5 km.
## Study Area Reports: the risk reader written up, per area, in the project

Research ▸ Publish ▸ **Study Area Reports** (`research/pages/reports.js`; the
pure half `research/study-report.js`, 48 checks). One report per study area
the GIS page holds, built from `GeoIDRiskReader.areas()` (the readings) joined
by id to `studyAreas()` (the polygons; an area read over the view takes its
readings' own `mapGroups` rings). A web-only page in the Publish stage — the Qt
app has no risk reader, so the stage list says why it drifts there.

- **The numbers are the reader's, not re-derived**: every figure under
  Findings is read off the same assessment object the window, CSV and print
  report read, so the document cannot disagree with the window.
- **Geo-context is measured at a lattice inside the area** (`latticeInside`,
  ~240 points, square in ground distance): elevation off the streamed DEM
  (ensured over the box first), the climate normal at the centroid, what EVERY
  polygon layer on the globe says there (`featuresAt`, the unit's own name
  column, shares of sample points — so whatever the reader loaded, geology,
  soils, GLiM, contributes), and the gazetteer's places inside (largest first)
  and nearest outside with distance and bearing (`GeoIDEarthPlaces.places()`).
- **The reader's sections are separate sections** (`WRITING`: Setting,
  Limitations, Discussion, Recommendations), each built holding only its ✎
  prompt. A rebuild (`mergeWriting`) replaces every numbers section whole and
  carries those four across verbatim if changed — so fresh readings can never
  leave a stale figure inside a paragraph somebody wrote. A first attempt that
  diffed lines inside mixed sections was abandoned for exactly that reason.
- **A draft says when it is stale**: the header comment records the readings'
  signature (`key@generated`), and the page compares it with the GIS page's.
- Saved to `reports/<area>.md` (registered as kind `report`), copied to
  `notes/` on request, downloaded as Markdown, printed through the browser
  (`printableHtml`, A4). The risk reader's window has **Write it up**
  (`GeoIDStudyReports.open(areaId)`), which opens the page on that area and
  builds at once unless a draft exists.
- `el()` in `pages/common.js` takes TEXT as its third argument, not children:
  passing nodes printed "[object HTMLElement]".

Verified headless with the reader's readings stubbed (the sandbox reaches no
WorldPop): built, saved, readings changed → stale banner, rebuilt with the new
signature and the written Discussion kept; all 65 hub pages mount.

## Flight route risk: the hazard field integrated along a route

Hazards ▸ Exposure ▸ Flight route risk (`gis/flight-risk-panel.js`, gathering
and drawing) over `gis/route-risk.js` (the maths, pinned by
`route-risk.test.mjs`). Atlas reaches it as the `flight_risk` tool ("how
risky is a flight from London to New York today").

- **The integral.** Each hazard is a utilisation u = demand/capacity (1/FoS)
  at every 25 km sample of the route, at the aircraft's height and time; the
  risk density is h(u) = 0 below ½, smoothstep ½→1, then u; the route's risk
  is ∫ Σ h ds by the trapezoid rule, in **equivalent km flown at the limit**.
  Per-100 km segment increments, the cumulative curve and the lowest FoS come
  from the same pass.
- **Where it lives.** Inside the Exposure subtab, under People exposed: a
  flight's exposure along its route. The infrastructure session's
  Hazards ▸ Infrastructure subtab sits directly after Exposure.
- **Capacities** (`CAPACITY`): cyclone 64 kt EXPECTED wind (Gaussian wind
  profile convolved with the cone's position error, σ = r⅔ / √(2 ln 3));
  Richardson number 0.25 on GFS's 50 hPa layers; CAPE 1500 J/kg or a forecast
  thunderstorm (WMO 95–99); ash 2 mg/m³ from the last Atlas ash run. Ri_c = 1,
  then 0.5, put a third to a half of ordinary long-haul routes past the limit
  (measured 2026-10-23, JFK–LHR and HKG–NRT); 0.25 leaves only strong jets.
- **The route.** A great circle between two of ~215 airports in
  `gis/airports.js` (no fetch), flown at FL350 with a 200 km climb and 250 km
  descent; or a live aircraft (`GeoIDTraffic.aircraft()`) to a To airport, or
  along its track for 3 h. The open ADS-B feeds do not say where a flight is
  going, and adsb.lol's routeset answered empty with no CORS headers.
- **GFS** comes in ONE Open-Meteo request for ≤ 40 points along the route
  (multi-location `latitude=a,b,…`), nearest point and hour per sample.
- **Drawn as a corridor, one quad per 25 km step.** A draped LineString lost on
  depth to the displaced ocean and came out dashed; one long thin ring per
  segment triangulated with gaps; and a step straddling a segment boundary
  must be assigned by its midpoint (as the integral is) or it is never drawn.
- **GDACS changed shape** (seen 2026-10-23): fixes are small circles
  (`featuretype: "PointRadii"`, Class `Point_Polygon_Point_n`) dated only in
  their label ("22/10 21:00 UTC", no year), and strength is only on the track
  segments (`Line_Line_n`, labelled TS/HU…). `readGdacsGeometry` reads both
  shapes; the advisory time is the circles' `polygondate` (the wind polygons
  are dated by their own valid times). Every feature carries the EVENT's
  `severitydata` — the lifetime peak — so it is read off the centroid only.

## Infrastructure exposure (Hazards ▸ Infrastructure)

What a hazard hits besides people. `global-data.js` home `infrastructure`
holds the settlements, ports (NGA World Port Index), airports, railways
(baked by `services/bake-infrastructure.py`, not on at launch), the roads,
urban areas and city outlines (moved from the Vectors tab), the OSM bridges and
buildings connectors, and the submarine cables (moved from Exposure, which is
now people and flight routes).

- **The engine is `gis/infrastructure.js`, pure**: a hazard is
  `read(lon, lat)` + a risk-assessment scheme; each feature is classed by the
  worst reading on it (points at themselves, lines at vertices and segment
  midpoints with km shared per class, polygons at outline + centre).
  `gis/infrastructure-panel.js` turns layers into readers: every `riskMaps()`
  kind, the Atlas ash deposit (on `ASH_SCHEME`, the deposit's own impact
  classes), any other polygon layer ("inside", one class), or the drawn area.
- **Cities, ports and airports are read even when not ticked** (small shipped
  files, fetched once); railways, roads, bridges, buildings and cables only
  when on the globe, and the readout says which were not.
- **Atlas**: tool `infrastructure_exposed` (atlas-tools.js), runner calls
  `window.GeoIDInfrastructure.ask`; the grounded phrase reader
  `infrastructureCall` runs BEFORE `readIntent`, because "airports under the
  ash" would otherwise be heard as a request to model an eruption.
- **OSM bridge sections are merged** (`mergeBridgeSections`): same kind and
  name, ends within 60 m. Unmerged, Houston read as 4,988 bridges with one
  BNSF trestle listed nineteen times.
- **The viewer has no lat/lon `flyTo`** (`viewer.flyTo` is undefined; a call
  in geoid-mode.js is a silent no-op). `flyToPoint` in infrastructure-panel.js
  is social-bridge.js's flight through `flyCameraTo`.
- Verified 2026-10-23 headless against a storm-surge polygon over
  Houston–Galveston: 5 cities, 8 seaports, 1 airport, plus OSM bridges.

## Can AI predict flooding? A random forest on recorded floods, and every hazard map scored

Asked for: the flood maps to follow the "can AI predict flooding?" recipe
(inputs → one grid → no NaNs → a random forest on historical floods → today's
rain in → a current map), and EVERY published hazard map validated with
accuracy, precision, recall, F1 and AUC, shown in the Analysis Hub beside each
model's parameters.

### Where it is

| piece | file |
| --- | --- |
| the metric arithmetic, Python | `services/hazard_metrics.py` (`confusion`, `roc`, `youden`, `report`, `write_entry`) |
| the same, JS (the page's own validator) | `viewer/gis/validation.js` |
| the two held equal, plus hand-worked matrices | `services/hazard-metrics.test.mjs` |
| flood random forest, steps 1–5 + validation | `services/bake-flood-rf.py` (`--current` refreshes only today's map) |
| landslide Recipe A, spatial hold-out | `services/validate-landslide.py` |
| cyclone, seismic, volcanic ×2, temporal hold-out | `services/validate-point-hazards.py` |
| what the hub reads | `data/global/hazard-validation.json` (tracked; one fragment per map in `data/global/hazard-validation/`) |
| the hub's Models tab | `viewer/gis/hazard-models.js` (+ `.test.mjs`), panel `#hub-panel-models` in `/index.html` |

Every validator writes ONE fragment and `write_entry` rebuilds the combined
file from all of them, so two validators run side by side cannot overwrite each
other. The hub computes nothing: the card shows what the bake wrote.

### The flood recipe, as built

**Why Wales, not Northern Ireland.** The NI historic flood outlines (DfI
Rivers, Flood Maps NI "Historical Flooding") are a file geodatabase whose
commercial re-use goes through LPS, and membership sells these maps. NRW's
**Historic Flood Map** is OGL v3, live on DataMapWales WFS
(`inspire-nrw:NRW_HISTORIC_FLOODMAP`), and carries a start and end date on each
of its 1,223 outlines — exactly the record a supervised model needs. It is the
landslide recipe's move again: validate where the inventory is, apply the
method elsewhere and say so.

1. **Inputs.** Satellite: ESA WorldCover 2021 v200 (Sentinel-1/2) — the two
   3° COGs are only 29 MB and 108 MB, read at their third level (33 m) and
   reduced to class FRACTIONS per cell. Rainfall: NOAA CPC Global Unified
   daily gauge analysis (0.5°, 1979–, public domain) for past events, read as a
   5 × 6 subset by OPeNDAP ASCII (the brackets must be URL-encoded, and the
   time index runs to 364 in a non-leap year — `[0:365]` is a 400); HadUK-Grid
   1991–2020 normals for the climate; Open-Meteo for now. Elevation: the
   Terrarium tiles the globe streams, zoom 10, and from them slope, HAND,
   upstream area, channel distance, TWI and curvature (priority-flood + ε,
   D8). Geology: BGS 625k superficial, scored by `ni-flood.js`'s own
   `DEPOSIT_SCORE` plus alluvium/peat flags.
2. **One grid**: 900 × 1050 cells of 0.003° × 0.002° (~205 × 222 m), Wales's
   high-water-mark polygon (`inspire-wg:wales_hwm`) as the mask — 462k land
   cells. The grid's origin and steps fall on WorldCover's pixel edges, so each
   cell is exactly 9 × 6 of its pixels and needs no resampling at all.
3. **No NaNs, each fill counted** (the counts are in the entry's
   `model.gap_fills` and on the hub card):
   - **HadUK normals → IDW** (power 2, 8 nearest of 190 cell centres) at every
     land cell: the 12 km cells do not tile coasts or lakes, the NI trap again.
   - **Slope, TWI, curvature → nearest valid cell** on the coastal ring where a
     central difference reaches the sea (~7,100 cells).
   - **CPC days with a missing cell → IDW** across that day's other cells.
   - **No superficial unit is NOT a gap**: bedrock at surface, scored 0.2 —
     the acceptance run lost two thirds of South Wales treating it as no-data.
   - **Terrarium carries bathymetry**: the high-water mark takes in the
     estuaries, and cells reading −270 m are sea floor. They leave the mask
     rather than being filled (below −5 m), which also removed a −1,473
     curvature spike on every neighbour.
4. **Train.** The unit is a (cell, event) pair, not a cell: an event is the
   outlines sharing one recorded date window; a cell inside it is a 1, two
   cells of Wales outside it on the same dates are 0s, and every row carries
   THAT event's rain (its wettest 3 days, and the 30 days before it). That is
   what lets the same forest answer for a different storm. Excluded and
   counted: windows before February 1979 (no CPC antecedent) and single-day
   1 January dates (how a year without a day is recorded — `1964-01-01` holds
   40 outlines). 300 trees, `min_samples_leaf` 10, `max_features` sqrt.
5. **Now.** Open-Meteo (the feed `forecast.js` already reads) at the same 30
   half-degree centres: the past 30 days and the wettest 3 of the next 7,
   bilinear onto the grid, through the saved forest →
   `data/global/flood-susceptibility-wales-current.tif`, written by the app's
   own `geotiff-writer.js` through node.

**Validation is TEMPORAL**: trained on events before 2005, scored on events
from 2005 on. The decision threshold is Youden's J on the TRAINING events'
out-of-bag votes, fixed before the test set is touched — choosing it on the
test set would flatter every rate under it.

Measured (run 2026-10-23): 48,831 training rows from 37 events before 2005, 46,343 test rows
from 72 events 2005–2025 (3,663 flooded cells, 42,680 dry). Threshold 0.338 from the
training OOB votes.

| | TP | FP | TN | FN | AUC | acc | prec | rec | F1 | kappa |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| held-out | 2,508 | 1,731 | 40,949 | 1,155 | 0.959 | 0.938 | 0.592 | 0.685 | 0.635 | 0.601 |

- **Rainfall barely moves the held-out AUC** (0.958 with no rain columns at all). That
  is the design, not a failure: every dry cell in a row block shares its event's rain, so the test asks WHERE
  a storm floods. Whether today's rain is enough is the forest's between-event contrast, which this split does
  not score — said on the card. Permutation importance on the test set ranks elevation, the 30-day antecedent
  rain, HAND and the climate normal first.
- **Today's map** (2026-10-23, rain 2026-09-23..2026-10-29: wettest 3 days up to 91.7 mm, 30-day
  totals up to 128.2 mm) puts 5.6% of Wales's cells over the
  threshold, along the floodplains of the Dee, Conwy, Dyfi, Tywi and the South Wales valleys.
- Negatives are at least 500 per event, so a small event carries far more than two per positive; accuracy
  is read at that mix.

### Every map, scored

| map | hold-out | AUC | acc | prec | rec | F1 | kappa | n (events) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| flood-susceptibility | events 2005–2025 (trained <2005) | 0.959 | 0.938 | 0.592 | 0.685 | 0.635 | 0.601 | 46,343 (3,663) |
| landslide-susceptibility | Mid/North Wales slides (tuned on South Wales) | 0.534 | 0.503 | 0.505 | 0.317 | 0.390 | 0.006 | 2,826 (1,413) |
| cyclone-risk | seasons 2010–2025 (trained 1980–2009) | 0.941 | 0.876 | 0.941 | 0.874 | 0.906 | 0.723 | 25,421 (17,448) |
| seismic-risk | M≥5 2006–2025 (trained ≤2005) | 0.960 | 0.972 | 0.623 | 0.439 | 0.515 | 0.501 | 200,000 (6,863) |
| volcanic-risk | eruptions 2000–2025 (trained ≤1999) | 0.809 | 0.960 | 0.567 | 0.280 | 0.375 | 0.357 | 141,023 (6,049) |
| volcanic-risk-holocene | eruptions 2000–2025 (trained ≤1999) | 0.847 | 0.959 | 0.543 | 0.315 | 0.399 | 0.379 | 141,023 (6,049) |

- **The landslide recipe does not transfer north.** South Wales (where the
  slope gate and quantile classes were chosen) reproduces the acceptance report
  on this grid — AUC 0.832 against 0.841, 76% of slides in the worst 24% of the
  ground. Held out, Mid and North Wales score **AUC 0.53**: 59% of those slides
  sit on cells under 5° at 210 m (stream banks in Ceredigion, coastal till
  cliffs) against 16% in the south, and the gate floors them. The lithology
  factor also barely discriminates in Wales: `/^MUDSTONE/` scores the Lower
  Palaeozoic "MUDSTONE, SILTSTONE AND SANDSTONE" 5, about three quarters of
  the land. Reported as measured; the recipe needs a stream-bank term and a
  finer slope before it is trusted outside South Wales.
- **Seismic accuracy is flattered** by free negatives (stable interiors,
  open ocean); the entry carries an "active ground only" repeat. It ranks well
  and is cautious at evens over a 20-year test window.
- **Cyclone** is scored on the published grid's own per-season counts
  (`cyclone-risk-years.json`), seasons 1980–2009 → 2010–2025.
- **Volcanic** needed the GVP eruption list, which the bake fetches live and
  never kept: `validate-point-hazards.py --only volcanic --fetch-eruptions`
  makes the bake's own WFS call once and caches it in
  `data/global/.volcanic-risk-work/`.
- **Points, not quadtree cells**, for the four baked grids: an equal-area
  Fibonacci lattice, so an 8° ocean cell does not weigh as much as a
  quarter-degree coastal one.

### The hub's Models tab

`#hub-panel-models` is location-independent, so it is filled on load rather
than by a pin, and the tab is in the `panels` map (the Tools and Forecast tabs
are not in that map, which is a separate fault). One card per map: method,
AUC verdict, hold-out sentence, six metrics, the 2 × 2 matrix with its
threshold rule, the parameters (`formatParam` flattens nested objects and
`[name, value]` pairs), inputs, gap fills and limits. A map that could not be
scored shows NOT ASSESSABLE and no matrix. `hazard-models.test.mjs` also opens
the published file and fails if any of the six maps is missing or if a card's
accuracy, precision or recall disagrees with its own confusion matrix.

## The flood forest goes global: Copernicus EMS floods, six held-out regions, two tiers

Asked for next: flood susceptibility for ANY ground, and for the whole globe at
coarse resolution, trained on multi-region floods and validated on held-out
REGIONS. The Wales forest above stays as a regional product
(`flood-susceptibility-wales`); this is `flood-susceptibility` (0.1° global)
and `flood-susceptibility-fine` (~250 m on demand).

### Choices, and why

| need | chosen | why not the alternative |
| --- | --- | --- |
| flood records | **Copernicus EMS rapid mapping** delineations (observed flood extent + the area ANALYSED) | The Global Flood Database (913 MODIS events, public bucket) was the first candidate — and is **CC BY-NC**; membership sells these maps. Owner's call: EMS. |
| elevation | Terrarium tiles (zoom 10 fine, 5 coarse) | the page already streams them, CORS-open, global |
| land cover | **Esri / Impact Observatory Sentinel-2 10 m** (2020), ImageServer `exportImage` | ESA WorldCover's bucket sends **no CORS header**, so the page could not compute the same feature the bake trained on |
| soil | Pelletier soil thickness (the Soil panel's own COG) | already served |
| rain | CPC Global Unified daily 0.5° (events), CPC 1991–2020 LTM (climate), Open-Meteo (now, in the page) | public domain, global, OPeNDAP |

**One feature implementation.** `viewer/gis/flood-ml.js` computes every
feature (D8 + priority-flood, HAND, upstream area, exact Euclidean channel
distance, TWI, curvature, land-cover fractions, soil, rain on the CPC lattice)
and evaluates the exported forest. The bake runs it through node
(`services/flood-ml-stack.mjs`), the page imports it (`flood-ml-run.js`), and
`flood-ml.test.mjs` pins it — plus, once a forest is baked, JS
`predictForest` against scikit-learn's `predict_proba` on 64 check rows.

**Negatives, and their bias.** EMS draws an area of interest round the
affected ground, analyses the images inside it, and marks what it could not
see ("not analysed": cloud, no image). A cell inside the AOI ∩ image footprint,
outside not-analysed, outside mapped hydrography, outside the observed flood
and below half water in the land cover is a DRY OBSERVATION. Two biases, both
stated on the card: the dry cells sit beside the flood (harder than random dry
land → AUC is conservative), and a mapper's omission is counted dry.

**Resolution follows zoom**, in two tiers because a forest answers only at
the scale it was trained: the baked 0.1° world, and a 250 m run over the view
or a drawn area once it is ≤ 1.5° across (600 × 600 cells). Hazards ▸ Flood ▸
"Susceptibility (machine learning)" holds both rows; "Run here again" in the
second row's drawer re-runs after moving.

### Traps met building it

- **A strided OPeNDAP read returns zeros.** `ds["precip"][::5]` on the CPC
  long-term mean came back as unmasked 0.0 everywhere, ocean included; the
  first global stack had a rain normal of 0 mm on every cell and no error
  anywhere. Read a day at a time, and the bake now refuses a normal whose
  wettest cell is under 1,000 mm.
- **Channel distance across an ocean.** An island with no 50-cell channel
  measured to a river on the next continent (10,430 km at 0.1°). Capped at
  100 km in `flood-ml.js`, before any forest was trained on it.
- **EMS product archives are nested zips stored uncompressed**, so the five
  layers a product needs (observedEventA, areaOfInterestA, notAnalysedA,
  imageFootprintA, hydrographyA) are read by HTTP byte range — ~1–3 MB each —
  and the ~50 MB of PDF maps and geopackages per activation never come down.
- **The EMS backend refuses a burst** (403 on half of a 4-thread pass, every
  one fine alone): backoff and two threads. The open API serves EMSR656 (2023)
  on; earlier activations answer "Authentication credentials were not provided".
- **CPC answers each OPeNDAP request in ~30 s whatever its size**, so event
  rain is read once per ACTIVATION over the union of its products, four
  activations at a time.

### What it measures (run 2026-10-23)

66 activations and 281 delineation products came through (of 90 flood
activations; one 2026 activation was too recent for CPC's realtime file, a few
archives are not zips or 404). Products per region: Europe 3 regions, the rest
of the world 3.

**Fine tier, ~250 m** (684,109 rows, 226,834 flooded):

| held-out region | AUC | acc | prec | rec | F1 | products |
| --- | --- | --- | --- | --- | --- | --- |
| americas | 0.713 | 0.624 | 0.462 | 0.713 | 0.561 | 24 |
| asia | 0.754 | 0.633 | 0.470 | 0.796 | 0.591 | 32 |
| africa | 0.702 | 0.581 | 0.433 | 0.836 | 0.570 | 25 |
| mediterranean | 0.775 | 0.710 | 0.545 | 0.725 | 0.622 | 78 |
| europe-north-west | 0.793 | 0.722 | 0.559 | 0.722 | 0.630 | 58 |
| europe-central-east | 0.743 | 0.679 | 0.510 | 0.675 | 0.581 | 45 |
| **pooled** | 0.751 | 0.659 | 0.491 | 0.753 | 0.595 | 684,109 rows |

**Coarse tier, 0.1°** (3,023 rows — an EMS area of interest is only a few 0.1° cells):

| held-out region | AUC | acc | prec | rec | F1 | products |
| --- | --- | --- | --- | --- | --- | --- |
| americas | 0.708 | 0.628 | 0.506 | 0.727 | 0.597 | 15 |
| asia | 0.708 | 0.604 | 0.749 | 0.568 | 0.646 | 18 |
| africa | 0.584 | 0.632 | 0.674 | 0.895 | 0.769 | 14 |
| mediterranean | 0.747 | 0.665 | 0.736 | 0.571 | 0.643 | 43 |
| europe-north-west | 0.653 | 0.594 | 0.665 | 0.402 | 0.501 | 23 |
| europe-central-east | 0.697 | 0.632 | 0.573 | 0.739 | 0.645 | 29 |
| **pooled** | 0.674 | 0.628 | 0.651 | 0.628 | 0.640 | 3,023 rows |

- **Every region is scored by a forest that never saw it**, and the fine
  tier holds 0.70–0.79 everywhere — fair, not good. The coarse tier is
  weaker (0.58–0.75) on a fiftieth of the rows; Africa at 0.1° is the weak
  one and is marked so on the card. Read the global layer as screening.
- **Compare the Wales forest (AUC 0.959)**: a temporal split inside one
  country, where every test flood is on a river the forest has seen. The
  region hold-out is the honest number for "global".
- **Feature importance** (fine): HAND 0.24, water fraction 0.17, elevation
  0.14, channel distance 0.07, soil 0.06 — terrain first, as expected.
- **Today's global map** (`data/global/flood-ml/flood-susceptibility-0p1.hotlink-ok.tif`,
  1.4 MB, uint8 P×250, deflate) is CPC as of 2026-10-21: 17.8%
  of land cells over the threshold. It looks right where it should (Ganges,
  North China Plain, Mekong, Mississippi, Po, Danube, Pampas) and shows two
  faults, both on the card: European lowlands read redder than their shape
  earns (the training mix), and flat basins carry D8 parallel-flow streaks.
- **Page and bake agree to the cell.** The same 0.5° × 0.4° box over Sylhet
  run in headless Chrome through `flood-ml-run.js runArea` and through
  `bake-flood-global.py area`: 31,992 land cells both, 81.6% over the
  threshold both. `flood-ml.test.mjs` holds the JS forest to scikit-learn's
  predict_proba on 64 rows per tier.
- **A box can saturate.** The Mekong delta in October is 99.3% over the
  threshold — flat, low, wet season; true and uninformative. The area PNGs
  use a continuous ramp so a saturated box still shows its gradient.

### Licences, where a reader looks

Every model input now carries a `licence` field; the Models tab prints it
under each input, and the hub's **Metadata** panel lists every source once
with its licence and the maps that use it (`#metadata-licences`, filled by
`hazard-models.js renderLicences`). The flood forests' inputs: Copernicus EMS
(free and open, attribution), Terrarium (public domain / by source), Esri/IO
land cover (CC BY 4.0), Pelletier soil (ORNL DAAC, cite), CPC (public domain),
Open-Meteo (CC BY 4.0). `hazard-models.test.mjs` fails if a flood input has
none.

### Products and publishing

`data/global/flood-ml/` (gitignored, publish with `publish-data.py`):
`flood-susceptibility-0p1.hotlink-ok.tif`, `forest-fine.json` (3.4 MB, the
page downloads it), `forest-coarse.json`, `rain-normal-cpc.json`,
`current.json`. Refresh today's map with `bake-flood-global.py current`.


## Landslide susceptibility rebuilt as a random forest; the flood products published

Asked for: Recipe A (AUC 0.534 on held-out Mid/North Wales, and sold by
membership) rebuilt the way flood was — a random forest on inventoried
landslides, validated on held-out REGIONS — with commercially usable
inventories only; and the global flood products published to R2.

### The inventories, and their terms

| inventory | coverage | licence | used for |
| --- | --- | --- | --- |
| BGS National Landslide Database (OGC API `landslideindex`) | Great Britain, ~19,000 points with ± metres | **OGL v3** (the collection's own description) | 250 m tier (±≤100 m), absences |
| NASA Global Landslide Catalog 1997–2016 (data.gov export, 11,033 events) | global, news-compiled | US Government work; the export asks the user to accept NASA's "Terms and Conditions", **whose text the catalogue page does not publish — TO CONFIRM** before the map is sold | both tiers (exact → 250 m; ≤5 km → 0.1°) |
| GLiM v1.0 gridded 0.5° (PANGAEA.788537) | global lithology | **CC BY 3.0** | lithology feature |

The polygon GLiM the Geology panel draws "carries no separate licence
statement" (its own manifest), so the forest uses the 0.5° grid: the dominant
class per cell, coarse and said so. NASA's COOLR ArcGIS services and the old
gpm.nasa.gov landslide pages now 404; the data.gov export redirects to a
signed S3 URL and still works.

### The model

`viewer/gis/landslide-ml.js` = `flood-ml.js buildStack` (terrain, land cover,
soil, rain climate) **plus relief** (height range within ~1 km, separable
running max/min) **and GLiM one-hot groups**; no storm rain (the inventories'
dates are unreliable, and susceptibility is where, not when). Run by the bake
through `services/landslide-ml-stack.mjs` and by the page through
`landslide-ml-run.js`, which reuses `flood-ml-run.js`'s fetchers.

**Absences are pseudo-absences**: land in the same windows as the slides,
≥ 1 km (fine) / ≥ 30 km (coarse) from any inventoried point of any accuracy.
Drawing them near reports controls for where people report; an unreported
slide among them still counts against the model.

**The coarse tier is trained on NASA's catalogue alone.** With BGS's points
too, the first 0.1° map painted Great Britain solid red — the forest had
learnt the island where the survey was dense — and GB's held-out set was nearly
all slides. BGS still keeps absences off its slides and trains the 250 m tier.

**The headline AUC is the mean of the held-out regions' AUCs.** Pooling the
held-out scores mixes forests trained on different regions, whose
probabilities are not on one scale: pooled, the 250 m tier read 0.493 ("no
skill") while every region it could score was 0.64–0.80. The pooled figure
stays on the card as `auc_pooled`; the flood entries were changed the same way
(0.683 / 0.747 mean against 0.674 / 0.751 pooled).

### What it measures

**0.1° tier** (11,820 cells; mean AUC 0.810):

| held-out region | AUC | acc | prec | rec | F1 | cells |
| --- | --- | --- | --- | --- | --- | --- |
| great-britain | not assessable | | | | | 203 |
| americas-north | 0.765 | 0.673 | 0.702 | 0.473 | 0.565 | 3978 |
| americas-south | 0.847 | 0.706 | 0.431 | 0.784 | 0.557 | 1024 |
| asia-south | 0.892 | 0.771 | 0.868 | 0.580 | 0.696 | 1536 |
| oceania | 0.817 | 0.743 | 0.613 | 0.669 | 0.640 | 417 |
| asia-east | 0.756 | 0.509 | 0.304 | 0.909 | 0.456 | 2675 |
| europe | 0.753 | 0.639 | 0.283 | 0.749 | 0.411 | 1182 |
| africa-middle-east | 0.839 | 0.814 | 0.359 | 0.755 | 0.486 | 805 |

**250 m tier** (59,103 rows, 10,863 slides, 175 windows; mean AUC 0.718):

| held-out region | AUC | acc | prec | rec | F1 | windows |
| --- | --- | --- | --- | --- | --- | --- |
| great-britain | 0.647 | 0.664 | 0.489 | 0.176 | 0.259 | 35 |
| americas-north | 0.715 | 0.906 | 0.209 | 0.080 | 0.116 | 35 |
| americas-south | 0.802 | 0.975 | 0.000 | 0.000 | — | 13 |
| asia-south | 0.640 | 0.989 | 0.081 | 0.073 | 0.077 | 33 |
| oceania | not assessable | | | | | 20 |
| asia-east | 0.783 | 0.977 | 0.018 | 0.029 | 0.022 | 19 |
| europe | not assessable | | | | | 16 |
| africa-middle-east | not assessable | | | | | 4 |

- **On Recipe A's own held-out ground** (Mid/North Wales windows held out,
  everything else trained): **AUC 0.674, F1 0.511** against Recipe A's 0.534.
  The absence protocols differ (Recipe A drew them 1:1 at random from the
  region; here from the same windows ≥ 1 km from any slide), and the card says so.
- **Where the 250 m tier is valid**: only Great Britain and the Americas/Asia
  windows have 30+ well-located slides; Oceania, Europe outside GB and Africa
  cannot be scored at 250 m and say "not assessable". The 0.1° tier scores in
  seven of eight regions (GB: too few absences 30 km from any report).
- **Precision and recall at 250 m are low outside GB** at the OOB Youden
  threshold (a GB-dominated training set puts the threshold where GB's
  prevalence is); AUC, which does not depend on the threshold, is the number
  to read there.
- **The maps**: the 0.1° world lights the Himalayan front, Andes, Central
  America, Japan, Taiwan, the Philippines, Indonesia, south-west China, the
  Pacific Northwest, the Western Ghats, the East African highlands; the
  eastern US reads warmer than its relief earns (reporting density). The 250 m
  run over Oso, Washington highlights river bluffs and valley margins and rates
  the steep Cascade interior lower — the inventories' road-and-valley bias.

### Publishing (both forests)

`publish-data.py` gained two things, both for this:

- `GEOID_DATA_GLOBAL` / `GEOID_SOURCES` — a git worktree holds no gitignored
  data, so a publish from one reads the main checkout's `data/global` and writes
  the worktree's tracked `sources.json`.
- `--only PATTERN` (repeatable) — the normal flow uploads every loose file, and
  the dry run showed four OTHER sessions' unpublished files (airports, places,
  ports, railroads) it would have pushed. With `--only 'flood-ml/*'` and
  `--only 'landslide-ml/*'` it uploaded exactly 9 new keys (dry-run first;
  `rclone lsl` confirmed none existed), kept every other fingerprint, and
  `hazard-validation.json` is now KEEP_LOCAL (tracked, fetched from the site).

Verified on **localhost:8125** (the only origin the bucket's CORS allows
locally) with one headless viewer load through CDP: `sources.json` answered
with this branch's copy (and, for the landslide check, the branch's viewer
modules), the global flood and landslide layers loaded from
`data.geoidinitiative.com` with 200s and landed in the Workspace. JSON is
stored gzipped (`content-encoding: gzip`, strong length), the TIFs plain for
range reads.
